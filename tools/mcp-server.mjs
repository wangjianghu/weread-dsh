#!/usr/bin/env node
/* 微信读书 DSH 插件 · MCP server（v0.4，stdio JSON-RPC）
 *
 * 把插件 Host 暴露的 /weread/api/* JSON API 包装为 MCP 工具，供 Claude Code / Codex
 * 等其他 Agent 宿主直接查询本地微信读书笔记（只读）。
 *
 * Base URL 解析顺序：--url 参数 > WEREAD_DSH_URL 环境变量 > ~/.dsh/weread/endpoint.json
 * （插件在收到第一个 HTTP 请求时写入该文件）。
 *
 * 用法：
 *   node tools/mcp-server.mjs [--url http://127.0.0.1:PORT]
 *   node tools/mcp-server.mjs --selftest   # 本地假 API 全链路自测（npm test 会跑）
 *
 * MCP 消息格式：每行一个 JSON-RPC 2.0 对象（newline-delimited），响应写 stdout。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const VERSION = '0.5.0';

// v1.9.11 宿主调用方认证：/weread/api 须带插件 Bearer token（随 endpoint.json 分发）。
// 解析顺序：--token 参数 > WEREAD_DSH_TOKEN 环境变量 > endpoint.json 的 token 字段。
function resolveToken(args) {
  const tokenArgIdx = args.indexOf('--token');
  if (tokenArgIdx >= 0 && args[tokenArgIdx + 1]) return args[tokenArgIdx + 1];
  if (process.env.WEREAD_DSH_TOKEN) return process.env.WEREAD_DSH_TOKEN;
  const endpointFile = path.join(os.homedir(), '.dsh', 'weread', 'endpoint.json');
  try {
    const ep = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
    if (ep && typeof ep.token === 'string' && ep.token.length > 0) return ep.token;
  } catch { /* 无文件 */ }
  return null;
}

function resolveBaseUrl(args) {
  const urlArgIdx = args.indexOf('--url');
  if (urlArgIdx >= 0 && args[urlArgIdx + 1]) return args[urlArgIdx + 1].replace(/\/+$/, '');
  if (process.env.WEREAD_DSH_URL) return process.env.WEREAD_DSH_URL.replace(/\/+$/, '');
  const endpointFile = path.join(os.homedir(), '.dsh', 'weread', 'endpoint.json');
  try {
    const ep = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
    if (ep && typeof ep.baseUrl === 'string' && ep.baseUrl.startsWith('http')) return ep.baseUrl.replace(/\/+$/, '');
  } catch { /* 无文件 */ }
  return null;
}

async function apiFetch(baseUrl, token, pathname, searchParams = '') {
  const res = await fetch(`${baseUrl}/weread/api${pathname}${searchParams}`, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(authHint(res.status, body?.error));
  return body;
}

// §11-5 写路径：POST 同构封装
async function apiPost(baseUrl, token, pathname, body = {}) {
  const res = await fetch(`${baseUrl}/weread/api${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body2;
  try { body2 = JSON.parse(text); } catch { body2 = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(authHint(res.status, body2?.error));
  return body2;
}

// v1.9.11：401/503 时给可操作的提示（旧版 endpoint.json 无 token 字段 → 升级插件后重开 DSH）
function authHint(status, error) {
  if (status === 401 || status === 503) {
    return `${error || `HTTP ${status}`}（需 Bearer token：endpoint.json 的 token 字段，或 WEREAD_DSH_TOKEN / --token；若 endpoint.json 无 token 字段，重启 DSH 让插件重写后再试）`;
  }
  return error || `HTTP ${status}`;
}

// ---------- MCP 工具定义（只读，全部映射到现有 GET 端点） ----------
const TOOLS = [
  {
    name: 'weread_search',
    description: '全文搜索本地微信读书笔记（划线与想法），返回带出处的匹配（打分排序前 20）。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '关键词（按空白分词）' } }, required: ['query'] },
    async run(args, baseUrl, token) {
      const data = await apiFetch(baseUrl, token,'/notes/search', `?q=${encodeURIComponent(args.query ?? '')}`);
      const items = data.items ?? [];
      return `命中 ${items.length} 条：\n` + items.map((r, i) => `${i + 1}. 《${r.bookTitle}》${r.chapterTitle ? ` · ${r.chapterTitle}` : ''}\n   ${r.highlightText || ''}${r.thoughtText ? `\n   💭 ${r.thoughtText}` : ''}`).join('\n');
    },
  },
  {
    name: 'weread_books',
    description: '列出本地书架（按分类分组，含进度/划线数）。',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, baseUrl, token) {
      const data = await apiFetch(baseUrl, token,'/bookshelf');
      if (!data.groups?.length) return '书架为空（未同步或目录未配置）。';
      return `共 ${data.total} 本：\n` + data.groups.map((g) => `${g.category}（${g.books.length}）\n` + g.books.slice(0, 10).map((b) => `  - ${b.title} · ${b.author || '佚名'} · 进度${b.progress ?? 0}% · 划线${b.highlightCount ?? 0}`).join('\n')).join('\n');
    },
  },
  {
    name: 'weread_notes',
    description: '读取某本书的本地笔记全文（先 weread_books 或 weread_search 拿 bookId）。',
    inputSchema: { type: 'object', properties: { bookId: { type: 'string', description: '书籍 ID' } }, required: ['bookId'] },
    async run(args, baseUrl, token) {
      const data = await apiFetch(baseUrl, token,`/book/${encodeURIComponent(String(args.bookId ?? ''))}`);
      const notes = data.notes ?? [];
      return `《${data.book?.title ?? args.bookId}》共 ${notes.length} 条笔记：\n` + notes.map((n) => `${n.chapterTitle ? `[${n.chapterTitle}] ` : ''}${n.highlightText ?? ''}${n.thoughtText ? `\n💭 ${n.thoughtText}` : ''}`).join('\n---\n').slice(0, 16000);
    },
  },
  {
    name: 'weread_insights',
    description: '阅读洞察摘要（活跃天数/笔记数/深度占比/高价值书 Top）。',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: '统计窗口天数，0=全部' } } },
    async run(args, baseUrl, token) {
      const data = await apiFetch(baseUrl, token,'/insights', `?days=${Number(args.days) || 0}`);
      const k = data.kpis ?? {};
      return `活跃 ${k.activeDays ?? 0} 天 · 最长连续 ${k.longestStreakDays ?? 0} 天 · 笔记 ${k.totalNotes ?? 0} 条 · 深度占比 ${k.deepNoteRatio ?? 0}% · 平均完成率 ${k.averageCompletionRate ?? 0}%\nTop：${(data.topBooks ?? []).slice(0, 5).map((b) => `${b.title}(${b.notesCount})`).join('、')}`;
    },
  },
  {
    name: 'weread_status',
    description: '插件状态（登录/账号/输出目录/书籍数/最近同步/接口健康）。',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, baseUrl, token) {
      const s = await apiFetch(baseUrl, token,'/state');
      const ss = s.syncState;
      return [
        `登录：${s.loggedIn ? `已登录（${s.account?.name ?? s.account?.id}）` : '未登录（本地数据仍可查）'}`,
        `本地书籍：${s.booksCount} 本`,
        `输出目录：${s.outputPath || '未配置'}`,
        `最近同步：${ss?.lastSyncTime ? new Date(ss.lastSyncTime).toLocaleString('zh-CN') : '从未'}（${ss?.status ?? 'idle'}）`,
        s.apiHealth?.ok === false ? `接口状态：不可达（${s.apiHealth.reason || '网络异常'}）` : '接口状态：正常/未知',
      ].join('\n');
    },
  },
  // ---------- §11-5 写路径（roadmap）：同步触发 + 漫游/复习操作 ----------
  {
    name: 'weread_sync',
    description: '触发一次笔记同步（异步启动立即返回；结果稍后用 weread_status 查询）。',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, baseUrl, token) {
      const r = await apiPost(baseUrl, token,'/sync', {});
      return r?.ok ? '同步已启动（后台进行，稍后用 weread_status 查看结果）' : `响应异常：${JSON.stringify(r).slice(0, 200)}`;
    },
  },
  {
    name: 'weread_roaming_card',
    description: '抽一张当前笔记漫游卡片（与面板「换一张」同池，不推进漫游会话进度）。',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, baseUrl, token) {
      const d = await apiFetch(baseUrl, token,'/roaming/card');
      const c = d?.card;
      if (!c) return '暂无可漫游的笔记（先同步）';
      return `《${c.bookTitle || '微信读书'}》${c.chapterTitle ? ` · ${c.chapterTitle}` : ''}\n${c.text || ''}${d.dueCount > 0 ? `\n🎯 今日到期复习卡：${d.dueCount} 张（weread_roaming_action reviewStart 开始）` : ''}`;
    },
  },
  {
    name: 'weread_roaming_action',
    description: '漫游/复习写操作：next=下一张 prev=上一张 favorite/unfavorite=收藏切换 review=复习评分(grade: good|forgot) reviewStart=开始今日复习 reviewEnd=结束复习 refresh=重载会话。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['next', 'prev', 'favorite', 'unfavorite', 'review', 'reviewStart', 'reviewEnd', 'refresh'] },
        grade: { type: 'string', enum: ['good', 'forgot'], description: 'review 动作的评分' },
      },
      required: ['action'],
    },
    async run(args, baseUrl, token) {
      const r = await apiPost(baseUrl, token,'/roaming/action', { action: args.action, grade: args.grade });
      const c = r?.card;
      return `已执行 ${args.action}${c ? `，当前：《${c.bookTitle || ''}》${c.text ? ' ' + String(c.text).slice(0, 80) : ''}` : ''}`;
    },
  },
  {
    name: 'weread_roaming_filter',
    description: '设置漫游池过滤条件（noteTypes: highlight/thought/review 数组；favoriteOnly 只看收藏；minDaysUnreviewed 最小复习间隔天数；query 关键词）。',
    inputSchema: {
      type: 'object',
      properties: {
        noteTypes: { type: 'array', items: { type: 'string', enum: ['highlight', 'thought', 'review'] } },
        favoriteOnly: { type: 'boolean' },
        minDaysUnreviewed: { type: 'number' },
        query: { type: 'string' },
      },
    },
    async run(args, baseUrl, token) {
      await apiPost(baseUrl, token,'/roaming/filter', args);
      return `漫游过滤已应用：${JSON.stringify(args)}`;
    },
  },
];

// ---------- JSON-RPC 分发 ----------
function makeDispatcher(baseUrl, token) {
  return async (msg) => {
    const { id, method, params } = msg ?? {};
    const isNotification = id === undefined || id === null;
    try {
      if (method === 'initialize') {
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dsh-weread', version: VERSION } } };
      }
      if (method === 'notifications/initialized' || method === 'initialized') return isNotification ? undefined : { jsonrpc: '2.0', id, result: {} };
      if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
      if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
      }
      if (method === 'tools/call') {
        const name = params?.name;
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) throw new Error(`unknown tool: ${name}`);
        try {
          const text = await tool.run(params?.arguments ?? {}, baseUrl, token);
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(text) }] } };
        } catch (e) {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `工具执行失败：${e.message}` }], isError: true } };
        }
      }
      if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } };
      if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } };
      throw new Error(`method not found: ${method}`);
    } catch (e) {
      if (isNotification) return undefined;
      return { jsonrpc: '2.0', id, error: { code: -32603, message: e?.message || String(e) } };
    }
  };
}

async function main() {
  const args = process.argv.slice(2);

  // --selftest：本地假 API 全链路自测（不依赖运行中的 DSH）
  if (args.includes('--selftest')) return selftest();

  const baseUrl = resolveBaseUrl(args);
  if (!baseUrl) {
    process.stderr.write('未找到插件 API 端点。请先在 DSH 中打开一次微信读书面板（生成 ~/.dsh/weread/endpoint.json），或用 --url http://127.0.0.1:<port> / 环境变量 WEREAD_DSH_URL 指定。\n');
    process.exit(1);
  }
  const token = resolveToken(args); // v1.9.11：可为 null（--url 手动模式无 token 时将收到 401 提示）
  process.stderr.write(`[mcp] dsh-weread MCP server → ${baseUrl}${token ? ' (bearer)' : ' (no token)'}\n`);
  const dispatch = makeDispatcher(baseUrl, token);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    Promise.resolve().then(async () => {
      let msg;
      try { msg = JSON.parse(text); } catch { process.stderr.write(`[mcp] 非 JSON 行：${text.slice(0, 120)}\n`); return; }
      const res = await dispatch(msg);
      if (res) process.stdout.write(JSON.stringify(res) + '\n');
    }).catch((e) => process.stderr.write(`[mcp] 处理失败：${e?.message}\n`));
  });
  rl.on('close', () => process.exit(0));
}

// ---------- 自测 ----------
async function selftest() {
  const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓', msg); };
  const { createServer } = await import('node:http');
  const books = [{ bookId: 'b1', title: '测试书', author: '甲', progress: 40, highlightCount: 2 }];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/^\/weread\/api/, '');
    const send = (payload) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (route === '/state') return send({ loggedIn: true, account: { id: '1', name: '测试' }, booksCount: 1, outputPath: '/tmp/x', syncState: { status: 'success', lastSyncTime: Date.now() }, apiHealth: { ok: true } });
    if (route === '/bookshelf') return send({ groups: [{ category: '科技', books }], total: 1, filtered: 1 });
    if (route === '/notes/search') return send({ items: [{ bookTitle: '测试书', chapterTitle: '第一章', highlightText: '认知负荷' }] });
    if (route.startsWith('/book/')) return send({ book: { title: '测试书' }, notes: [{ chapterTitle: '第一章', highlightText: '认知负荷' }] });
    if (route === '/insights') return send({ kpis: { activeDays: 3, longestStreakDays: 2, totalNotes: 10, deepNoteRatio: 40, averageCompletionRate: 60 }, topBooks: [{ title: '测试书', notesCount: 5 }] });
    if (req.method === 'POST' && route === '/sync') return send({ ok: true, started: true });
    if (route === '/roaming/card') return send({ card: { bookId: 'b1', bookTitle: '测试书', chapterTitle: '第一章', text: '认知负荷' }, dueCount: 2 });
    if (req.method === 'POST' && route === '/roaming/action') {
      // P2-38（对抗审查 v2）：grade=boom 模拟服务端 500——断言工具异常走 isError:true 而非 JSON-RPC 错误
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (body.includes('boom')) { res.writeHead(500); res.end(JSON.stringify({ error: '模拟服务端故障' })); return; }
        send({ card: { bookId: 'b2', bookTitle: '测试书2', text: '下一条' } });
      });
      return;
    }
    if (req.method === 'POST' && route === '/roaming/filter') return send({ ok: true, total: 3 });
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dispatch = makeDispatcher(baseUrl, 'selftest-token'); // 假 API 不校验，token 走形状覆盖

  const call = async (method, params) => dispatch({ jsonrpc: '2.0', id: 1, method, params });
  let r = await call('initialize', { protocolVersion: '2024-11-05' });
  assert(r.result?.serverInfo?.name === 'dsh-weread' && r.result.capabilities?.tools, 'initialize 握手');
  r = await call('tools/list');
  const names = r.result.tools.map((t) => t.name);
  assert(names.length === 9 && names.includes('weread_search') && names.includes('weread_status') && names.includes('weread_roaming_action'), `tools/list 九个工具（${names.join(',')}）`);
  r = await call('tools/call', { name: 'weread_search', arguments: { query: '认知' } });
  assert(r.result?.content?.[0]?.text?.includes('测试书') && r.result.content[0].text.includes('认知负荷'), 'tools/call search 返回带出处结果');
  r = await call('tools/call', { name: 'weread_status', arguments: {} });
  assert(r.result.content[0].text.includes('已登录') && r.result.content[0].text.includes('本地书籍：1 本'), 'tools/call status');
  r = await call('tools/call', { name: 'weread_notes', arguments: { bookId: 'b1' } });
  assert(r.result.content[0].text.includes('《测试书》共 1 条笔记'), 'tools/call notes');
  r = await call('tools/call', { name: 'weread_sync', arguments: {} });
  assert(r.result.content[0].text.includes('同步已启动'), 'tools/call sync（写路径）');
  r = await call('tools/call', { name: 'weread_roaming_card', arguments: {} });
  assert(r.result.content[0].text.includes('认知负荷') && r.result.content[0].text.includes('2 张'), 'tools/call roaming card');
  r = await call('tools/call', { name: 'weread_roaming_action', arguments: { action: 'next' } });
  assert(r.result.content[0].text.includes('已执行 next') && r.result.content[0].text.includes('测试书2'), 'tools/call roaming action（写路径）');
  r = await call('tools/call', { name: 'weread_roaming_filter', arguments: { favoriteOnly: true } });
  assert(r.result.content[0].text.includes('漫游过滤已应用'), 'tools/call roaming filter（写路径）');
  r = await call('tools/call', { name: 'weread_roaming_action', arguments: { action: 'next', grade: 'boom' } });
  assert(r.result?.isError === true && r.result.content?.[0]?.text?.includes('工具执行失败') && !r.error, '工具异常返回 isError:true（非 JSON-RPC 协议错误）');
  r = await call('tools/call', { name: '不存在', arguments: {} });
  assert(r.error?.code === -32603, '未知工具返回 JSON-RPC 错误');
  r = await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert(r === undefined, '通知不产生响应');
  server.close();
  console.log('MCP SELFTEST PASS');
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
