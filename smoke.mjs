/* 全链冒烟：fake ctx 启动 Host 插件，走 HTTP 路由验证 wiring（不触网）。跑完即删。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { apply } from './index.js';
import { createReaderWindow } from './lib/readerWindow.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-smoke-'));
const outDir = path.join(tmp, 'notes');
// P2-39（对抗审查 v2）：全局超时兜底——任一 await 挂死则 180s 强退非零（防 CI 永挂）
const smokeKiller = setTimeout(() => { console.error('SMOKE GLOBAL TIMEOUT (180s)'); process.exit(1); }, 180_000);
smokeKiller.unref?.();
const registrations = { web: [], tools: [], systemPrompt: [], upgrade: [] };
// v1.9.11：全场景固定自签 token（经 rawConfig.apiToken 注入；生产无此配置时插件随机生成）
const SMOKE_TOKEN = 'smoke-fixed-token-0123456789abcdef0123456789abcdef';
// v1.9.13：admit 按宿主真实语义返回 { rejection: 401 }（拒绝是返回值不是异常——
// dshopen #522 复审要求「仅在明确准入时继续」），冒烟全链必须持 Bearer token。
const admitDeny = async () => ({ rejection: 401 });
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  webServer: { register: (r) => registrations.web.push(r), registerUpgrade: (r) => { registrations.upgrade.push(r); return () => {}; } },
  tools: { register: (t) => registrations.tools.push(t) },
  systemPrompt: { context: (d) => { registrations.systemPrompt.push(d); return () => {}; } },
  // v1.9.12：admit 经 ctx.inject(['connection']) 动态注入捕获（mock 立即激活，语义等价）
  inject: (deps, cb) => cb({ connection: { admit: admitDeny } }),
  connection: { admit: admitDeny },
};
const dispose = apply(ctx, { stateDir: path.join(tmp, 'state'), outputPath: '', apiToken: SMOKE_TOKEN });

let route = registrations.web.find((r) => r.path === '/weread');
if (!route) throw new Error('webServer 路由未注册');
let tool = registrations.tools.find((t) => t.name === 'weread');
if (!tool) throw new Error('工具 weread 未注册');

let asserts = 0; const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); asserts++; console.log('  ✓', msg); };

// v1.9.11 宿主调用方认证：固定 token 全链携带；验证无凭据/错 token 两条拒绝路径 + endpoint 分发。
let API_TOKEN = SMOKE_TOKEN;
{
  const seed = await call('GET', '/weread/api/state', null, null, '');
  ok(seed.status === 401 && seed.payload?.error === 'authentication required', '无凭据请求被拒（401，admit 拒绝 + 无 Bearer）');
  const ep = JSON.parse(fs.readFileSync(path.join(tmp, 'state', 'endpoint.json'), 'utf8'));
  ok(ep.token === SMOKE_TOKEN, 'endpoint.json 分发自签 token（与配置一致）');
  const bad = await call('GET', '/weread/api/state', null, null, 'Bearer wrong-token-xxx');
  ok(bad.status === 401, '错误 Bearer token 被拒（401）');
}

async function call(method, pathname, body, routeOverride, bearerOverride) {
  const chunks = body ? [JSON.stringify(body)] : [];
  // P0-1 伴生：路由现在强校验 loopback Host（防 DNS rebinding），伪造 req 须带真实形状的 headers。
  // v1.9.11：默认携带插件 Bearer token（种子/负面用例经 bearerOverride 控制）。
  const headers = { host: '127.0.0.1:65414' };
  if (bearerOverride !== null) headers.authorization = bearerOverride ?? `Bearer ${API_TOKEN}`;
  const req = { method, url: pathname, headers, on: (ev, cb) => { if (ev === 'data') for (const c of chunks) cb(c); if (ev === 'end') setTimeout(cb, 0); } };
  let status = 0; let payload = null;
  const res = { writeHead: (s) => { status = s; }, end: (txt) => { payload = txt ? JSON.parse(txt) : null; } };
  await (routeOverride ?? route).handler(req, res);
  return { status, payload };
}

// 1. state 初始
let r = await call('GET', '/weread/api/state');
ok(r.status === 200 && r.payload.loggedIn === false, 'state 初始未登录');
ok(r.payload.apiHealth && 'ok' in r.payload.apiHealth && 'checkedAt' in r.payload.apiHealth, 'state 含 apiHealth（接口健康）');
ok(r.payload.loginExpired === false, 'state 含 loginExpired（初始未过期）');
ok(Array.isArray(r.payload.config?.exportThemes) && r.payload.config.exportThemes.length === 8, '默认 8 套主题');
ok(r.payload.config?.language === 'auto', "语言默认 auto（跟随 DSH 宿主；v1.8.7 前 'zh-CN'）");
ok(registrations.upgrade.some((u) => u?.path === '/weread/ws' && typeof u?.handler === 'function'),
  'ws 总线 upgrade 钩子已注册（/weread/ws；E-F6：原 fake ctx 缺 registerUpgrade，接线从未被测到）');
// client-diag 信使路由（E-F2：端点此前零覆盖）
r = await call('POST', '/weread/api/client-diag', { msg: 'smoke 测试信使' });
ok(r.status === 200 && r.payload.ok === true, 'client-diag 路由可达（200）');
r = await call('GET', '/weread/api/logs?channel=op');
ok(r.payload.lines.some((l) => l.includes('[client] smoke 测试信使')), 'client-diag 消息落入 op 日志环形缓冲');
// v1.8.8：登录二维码本地生成端点（原 img 直连境外 qrserver.com，不可达时破损）
{
  const { createSvg } = await import('./lib/vendor/qrcode/index.cjs');
  const svg = createSvg('https://weread.qq.com/web/confirm?uid=smoke123', { margin: 2 });
  ok(svg.startsWith('<svg') && svg.includes('</svg>') && svg.includes('shape-rendering'), 'vendored qrcode 生成合法 SVG（本地无外网依赖）');
  const req2 = { method: 'GET', url: '/weread/api/login/protocol/qrcode?data=' + encodeURIComponent('https://weread.qq.com/web/confirm?uid=smoke123'), headers: { host: '127.0.0.1:65414', authorization: `Bearer ${API_TOKEN}` } };
  let code2 = 0; let body2 = '';
  const res2 = { writeHead: (c) => { code2 = c; }, end: (t) => { body2 = String(t ?? ''); } };
  await route.handler(req2, res2);
  ok(code2 === 200 && body2.startsWith('<svg'), 'qrcode 端点返回本地生成 SVG（200）');
}
r = await call('GET', '/weread/api/login/protocol/qrcode?data=' + encodeURIComponent('https://evil.example.com/x'));
ok(r.status === 400, 'qrcode 端点拒绝非微信读书域（防滥用）');

// 2. 校验输出目录
r = await call('POST', '/weread/api/output-path/validate', { path: outDir });
ok(r.status === 200 && r.payload.ok === true, '输出目录校验+自动创建');
r = await call('GET', '/weread/api/state');
ok(r.payload.outputPath === outDir && r.payload.validation.status === 'passed', 'validation 三字段 passed');

// 3. 空书架
r = await call('GET', '/weread/api/bookshelf');
ok(r.status === 200 && r.payload.groups.length === 0, '空书架');

// 4. 未登录同步应被拒
r = await call('POST', '/weread/api/sync');
ok(r.status === 401, '未登录同步拒绝(401)');

// 4.1 v1.9.2：无凭据时核验失败不误标「登录已过期」（verify 回写 loginState 的守卫分支）
r = await call('POST', '/weread/api/login/verify');
ok(r.status === 200 && r.payload.ok === false, '无凭据核验 → ok:false');
r = await call('GET', '/weread/api/state');
ok(r.payload.loggedIn === false && r.payload.loginExpired === false, 'v1.9.2：无凭据核验失败仍显示「未登录」而非「登录已过期」（首次使用引导不被过期文案误导）');

// 4.5 详情刷新未登录守卫（v1.0.9：原路由无守卫，过期时会静默"无更新"）
r = await call('POST', '/weread/api/book/sync', { bookId: 'x' });
ok(r.status === 401 && typeof r.payload.loginExpired === 'boolean', '详情刷新未登录 401 + loginExpired 标记');

// 5. 手写两本笔记（含分类目录）→ 索引重建 → 书架分组
const catDir = path.join(outDir, '科技');
fs.mkdirSync(catDir, { recursive: true });
const note1 = `---
title: 测试书A
author: 张三
doc_type: epub
bookid: 3300012345
category: 科技-互联网
progress: 42%
noteCount: 2
readingStatus: 阅读中
---
# 测试书A

### 第一章

🖍️ 划线
> 这是一条测试划线，用于验证解析闭环。

_记录时间：2026-11-01 10:00:00_

### 第二章

💬 评论：这是想法。

_记录时间：2026-11-02 11:30:00_
`;
fs.writeFileSync(path.join(catDir, '测试书A.md'), note1);
fs.mkdirSync(path.join(outDir, '文学'), { recursive: true });
fs.writeFileSync(path.join(outDir, '文学', '测试书B.md'), note1.replace(/测试书A/g, '测试书B').replace('3300012345', '3300099999').replace('科技-互联网', '文学-小说'));
r = await call('GET', '/weread/api/bookshelf?refresh=1');
ok(r.payload.groups.length >= 2, '分组=2');
ok(r.payload.groups[0].category === '科技' || r.payload.groups[0].category === '文学', `level1 一级分类（得到 ${r.payload.groups.map((g) => g.category).join(',')}）`);
const bookA = r.payload.groups.flatMap((g) => g.books).find((b) => b.title === '测试书A');
ok(!!bookA, '索引命中测试书A');

// 5.5 上下文注入可配置化（A2，须在首实例存活期间验证；text() 同步返回缓存，异步重建后生效）
const sysCtx = registrations.systemPrompt.find((d) => d.name === 'weread:reading');
ok(!!sysCtx && typeof sysCtx.text === 'function', 'systemPrompt.context 已注册');
const settle = () => new Promise((res) => setTimeout(res, 50));
sysCtx.text(); await settle();
ok(sysCtx.text().includes('用户近期阅读') && sysCtx.text().includes('测试书'), '上下文注入含近期书目');
r = await call('POST', '/weread/api/config', { ctxInjectEnabled: false });
ok(r.payload.config?.ctxInjectEnabled === false, '关闭上下文注入配置生效');
sysCtx.text(); await settle();
ok(sysCtx.text() === '', '关闭后注入为空（缓存已失效）');
r = await call('POST', '/weread/api/config', { ctxInjectEnabled: true, ctxExcludeTitles: '测试书A' });
sysCtx.text(); await settle();
ok(sysCtx.text().includes('测试书B') && !sysCtx.text().includes('《测试书A》'), '排除书名后注入不含被排除书');
r = await call('POST', '/weread/api/config', { ctxExcludeTitles: '', ctxBookCount: 1 });
sysCtx.text(); await settle();
ok(sysCtx.text().split('\n').filter((l) => l.startsWith('- 《')).length === 1, '注入书数配置生效');
r = await call('POST', '/weread/api/config', { ctxBookCount: 5 });
ok(r.payload.config.ctxBookCount === 5, '恢复默认注入书数');

// 5.6 v1.8.20 关窗即退出可配置（默认开）——路由持久化 + 回读
ok(r.payload.config.readerWindowQuitOnClose !== false, '默认：关窗即退出实例（开）');
r = await call('POST', '/weread/api/config', { readerWindowQuitOnClose: false });
ok(r.payload.config.readerWindowQuitOnClose === false, '关闭「关窗即退出」持久化生效');
r = await call('POST', '/weread/api/config', { readerWindowQuitOnClose: true });
ok(r.payload.config.readerWindowQuitOnClose === true, '恢复默认（开）');

// 6. 书籍详情
r = await call('GET', `/weread/api/book/${encodeURIComponent(bookA.bookId)}`);
ok(r.status === 200 && r.payload.notes.length === 2, '详情取到 2 条笔记');
ok(r.payload.chapters.length === 2, '章节派生 2');

// 7. 搜索（书名+关键词）
r = await call('GET', '/weread/api/notes/search?q=测试划线');
ok(r.payload.items.length >= 1, '笔记搜索命中');

// 8. 洞察
r = await call('GET', '/weread/api/insights?days=0');
ok(r.status === 200 && r.payload.kpis && Number.isFinite(r.payload.kpis.totalNotes), '洞察 KPI');
ok(Array.isArray(r.payload.timeline) && r.payload.timeline.length >= 1, '时间线非空');
ok(Array.isArray(r.payload.availableCategories), 'availableCategories');

// 9. 月报导出
r = await call('POST', '/weread/api/insights/report', { filter: {} });
ok(r.status === 200 && fs.existsSync(r.payload.path), '月报落盘');

// 9.5 周报（v0.3：本周 vs 上周同期）
r = await call('POST', '/weread/api/insights/weekly-report');
ok(r.status === 200 && fs.existsSync(r.payload.path) && r.payload.path.includes('阅读周报'), '周报落盘');
ok(fs.readFileSync(r.payload.path, 'utf8').includes('## 本周核心'), '周报含本周对比内容');

// 10. 漫游会话
r = await call('GET', '/weread/api/roaming/session');
ok(r.status === 200 && r.payload.card, '漫游抽到卡片');
ok(typeof r.payload.statsPoolSize === 'number' && r.payload.statsPoolSize >= 2, '漫游池大小');
r = await call('POST', '/weread/api/roaming/action', { action: 'review' });
ok(r.payload.tip && r.payload.tip.includes('已标记为已复习') && r.payload.tip.includes('1 天后再见'), '复习标记（SM-2 首复 1 天）');
r = await call('POST', '/weread/api/roaming/action', { action: 'review' });
ok(r.payload.tip === '今日已复习', '复习当日幂等');
r = await call('POST', '/weread/api/roaming/action', { action: 'next' });
ok(r.payload.index >= 1, 'next 前进');

// 10.5 会话持久化：dispose（模拟插件重启）→ 同 stateDir 重新 apply → 会话续读
const beforeRestart = r.payload;
dispose();
const reg2 = { web: [], tools: [] };
const ctx2 = { effect: (fn) => { fn(); return () => {}; }, inject: () => () => {}, webServer: { register: (x) => reg2.web.push(x) }, tools: { register: (x) => reg2.tools.push(x) } };
const dispose2 = apply(ctx2, { stateDir: path.join(tmp, 'state'), outputPath: '', apiToken: SMOKE_TOKEN });
route = reg2.web.find((x) => x.path === '/weread');
tool = reg2.tools.find((x) => x.name === 'weread');
ok(!!route && !!tool, '重启后路由/工具重新注册');
// v1.9.11：重启后插件重新生成自签 token——种子请求触发 endpoint.json 重写（认证前写入），重取后继续
await call('GET', '/weread/api/state', null, null, 'Bearer stale-token-after-restart');
API_TOKEN = JSON.parse(fs.readFileSync(path.join(tmp, 'state', 'endpoint.json'), 'utf8')).token;
r = await call('GET', '/weread/api/roaming/session');
ok(r.status === 200 && r.payload.card?.noteKey === beforeRestart.card?.noteKey, '重启后漫游续读（同一张卡）');
ok(r.payload.index === beforeRestart.index && r.payload.total === beforeRestart.total, '重启后位置/总数保持');
ok(r.payload.metrics?.skipped === beforeRestart.metrics?.skipped && r.payload.metrics?.reviewed === beforeRestart.metrics?.reviewed, '重启后 metrics 保持');
const sessionFile = path.join(tmp, 'state', 'roaming.default.session.json');
ok(fs.existsSync(sessionFile), '会话文件落盘（roaming.default.session.json）');

r = await call('POST', '/weread/api/roaming/filter', { favoriteOnly: true });
ok(r.payload.empty === true || r.payload.card === null || r.payload.poolSize === 0, '收藏筛选空池');

// 10.6 SM-2 与今日复习
r = await call('POST', '/weread/api/roaming/action', { action: 'reviewEnd' });
ok(r.payload.reviewMode === false && r.payload.card, '结束复习回普通模式');
r = await call('POST', '/weread/api/roaming/action', { action: 'reviewStart' });
ok(r.payload.empty === true && r.payload.reason === 'no_due_cards', '无到期卡时今日复习空态');
// 把复习过的卡（sm2Due 在未来）拨到过去，模拟到期；再模拟重启（第三次 apply）
const metaFile = path.join(tmp, 'state', 'roaming.default.meta.json');
const metaRaw = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const dueKeys = Object.values(metaRaw.records).filter((m) => m.sm2Due > 0);
ok(dueKeys.length >= 1, 'SM-2 字段落盘（sm2Due）');
ok(dueKeys.every((m) => Number.isFinite(m.sm2EF) && m.sm2EF >= 1.3 && m.sm2Reps >= 1 && m.sm2Interval >= 1), 'SM-2 调度字段完整（ef/reps/interval）');
for (const m of dueKeys) m.sm2Due = Date.now() - 1000;
fs.writeFileSync(metaFile, JSON.stringify(metaRaw));
dispose2();
const reg3 = { web: [], tools: [] };
const ctx3 = { effect: (fn) => { fn(); return () => {}; }, inject: () => () => {}, webServer: { register: (x) => reg3.web.push(x) }, tools: { register: (x) => reg3.tools.push(x) } };
const dispose3 = apply(ctx3, { stateDir: path.join(tmp, 'state'), outputPath: '', apiToken: SMOKE_TOKEN });
route = reg3.web.find((x) => x.path === '/weread');
tool = reg3.tools.find((x) => x.name === 'weread');
// v1.9.11：第三次 apply 同样重生成 token——种子重取（endpoint 写入先于认证）
await call('GET', '/weread/api/state', null, null, 'Bearer stale-token-restart-3');
API_TOKEN = JSON.parse(fs.readFileSync(path.join(tmp, 'state', 'endpoint.json'), 'utf8')).token;
r = await call('POST', '/weread/api/roaming/action', { action: 'reviewStart' });
ok(r.payload.reviewMode === true && r.payload.card, '今日复习出到期卡');
ok(typeof r.payload.dueRemaining === 'number' && r.payload.dueRemaining >= 0, '复习模式剩余计数');
r = await call('POST', '/weread/api/roaming/action', { action: 'review', grade: 'forgot' });
ok(r.payload.tip && r.payload.tip.includes('忘记') && r.payload.tip.includes('明天'), '忘记分级（间隔重置 1 天）');
const forgotRec = Object.values(JSON.parse(fs.readFileSync(metaFile, 'utf8')).records).find((m) => m.sm2Due > Date.now());
ok(!!forgotRec && forgotRec.sm2Interval === 1 && forgotRec.sm2Lapses >= 1, '忘记后 SM-2 重置（interval=1，lapses+1）');

// 11. 工具
let out = await tool.execute({ action: 'status' });
ok(out.includes('未登录') && out.includes('本地书籍：2 本'), '工具 status');
out = await tool.execute({ action: 'search', query: '想法' });
ok(out.includes('这是想法') || out.includes('没有匹配') || out.length > 0, '工具 search 返回');
out = await tool.execute({ action: 'insights' });
ok(out.includes('笔记'), '工具 insights');
out = await tool.execute({ action: 'roaming' });
ok(out.length > 0, '工具 roaming');
out = await tool.execute({ action: 'ask', query: '测试划线' });
ok(out.includes('已检索') && out.includes('[1]') && out.includes('《测试书A》'), '工具 ask（本地打分检索+编号出处）');
// §11-2 富渲染：books/roaming 文本首行带结构化卡片标记（客户端 WereadToolView 解析为可点 chip）
out = await tool.execute({ action: 'books' });
ok(out.startsWith('<!--wr-card:'), '工具 books 带 wr-card 富渲染标记');
ok((out.match(/"kind":"books"/) || []).length === 1, 'wr-card 标记为合法 JSON 头（kind=books）');
out = await tool.execute({ action: 'roaming' });
ok(out.startsWith('<!--wr-card:'), '工具 roaming 带 wr-card 富渲染标记');
{
  const mm = /^<!--wr-card:(.*?)-->\n/.exec(out);
  ok(mm && (() => { try { return JSON.parse(mm[1].replace(/- -/g, '--')).kind === 'roaming'; } catch (e) { return false; } })(), 'wr-card 标记可解析回结构化卡片');
}

// 12. 删除书
r = await call('POST', '/weread/api/book/delete', { bookId: bookA.bookId });
ok(r.status === 200, '删除笔记文件');
r = await call('GET', '/weread/api/bookshelf');
ok(r.payload.groups.flatMap((g) => g.books).find((b) => b.title === '测试书A') === undefined, '删除后索引刷新');

// 13. 日志
r = await call('GET', '/weread/api/logs?channel=op');
ok(r.status === 200 && r.payload.lines.length > 0, '日志缓冲');

// 13.5 阅读目标（v1.0）
r = await call('POST', '/weread/api/config', { weeklyGoalNotes: 2 });
ok(r.payload.config?.weeklyGoalNotes === 2, '周目标配置生效');
// v1.7.11 修日期敏感：固定时间戳的测试笔记在跨周瞬间会掉出「本周」窗口（00:04 实测翻车）——
// 改为写入当下时间戳的笔记再断言（任何时刻都属本周），断完即删恢复现场
{
  const now2 = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const nowStr = `${now2.getFullYear()}-${pad(now2.getMonth() + 1)}-${pad(now2.getDate())} ${pad(now2.getHours())}:${pad(now2.getMinutes())}:${pad(now2.getSeconds())}`;
  fs.writeFileSync(path.join(outDir, 'zz-goal-week.md'), `---\ntitle: 目标周书\nbookid: GOALW1\n---\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 目标周划线内容\n\n_记录时间：${nowStr}_\n`);
  await call('GET', '/weread/api/bookshelf?refresh=1');
}
r = await call('GET', '/weread/api/insights?days=0');
ok(r.payload.goal && r.payload.goal.weeklyGoalNotes === 2 && r.payload.goal.thisWeekNotes >= 1, '洞察含阅读目标进度');
fs.rmSync(path.join(outDir, 'zz-goal-week.md'), { force: true });
await call('GET', '/weread/api/bookshelf?refresh=1');
ok(typeof r.payload.goal.streakWeeks === 'number' && typeof r.payload.goal.achieved === 'boolean', '目标连续周/达标字段');

// 13.6 全量备份（v1.0：自写 zip——store + UTF-8 EFS；系统 zip CLI 中文会乱码）
const backupDir = path.join(tmp, 'backups');
r = await call('POST', '/weread/api/backup', { dir: backupDir });
ok(r.status === 200 && r.payload.ok && fs.existsSync(r.payload.path), '备份 zip 落盘');
{
  // macOS Info-ZIP unzip 对 UTF-8 名显示有缺陷，用 python zipfile 做中立验证
  const { execFile } = await import('node:child_process');
  const listing = await new Promise((resolve) => {
    execFile('python3', ['-c', 'import zipfile,sys;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', r.payload.path], (err, stdout) => resolve(err ? '' : stdout));
  });
  ok(listing.includes('测试书B.md'), '备份含笔记文件（UTF-8 名完整）');
  ok(listing.includes('weread-state/'), '备份含状态文件目录');
  ok(!listing.includes('secrets.json') && !listing.includes('endpoint.json'), '备份排除凭据与端点文件');
}

// 13.65 单书刷新数据保护（v1.0.5）：远端返回空笔记列表时不得清空本地（原 bug：详情页刷新变"暂无笔记"）
{
  const { createStore } = await import('./lib/store.js');
  const { createIndexService } = await import('./lib/indexsvc.js');
  const { createSyncService } = await import('./lib/sync.js');
  const markdownLib = await import('./lib/markdown.js');
  const store2 = createStore(path.join(tmp, 'state'));
  const index2 = createIndexService({ store: store2, markdown: markdownLib, configGetter: () => ({ outputPath: outDir }), log: () => {} });
  await index2.rebuildFromConfiguredPath(undefined);
  const bookB = await index2.getBookById('3300099999');
  ok(!!bookB, '单书刷新用例：测试书B在索引中');
  const before = (await index2.getNotesByBookId('3300099999', undefined)).length;
  ok(before >= 1, `单书刷新用例：本地有 ${before} 条笔记`);
  const fakeApi = {
    getBookNotes: async () => ({ bookmarks: [] }), // 远端空列表（公众号书常见）
    getBookInfo: async () => { throw new Error('offline'); },
    transformNotes: () => [],                      // 远端空 → 变换后仍为空
    apiClient: { setCookies() {} },
  };
  const sync2 = createSyncService({ api: fakeApi, store: store2, index: index2, markdown: markdownLib, cleanup: { cleanupDuplicateBookFilesForAccount: async () => ({}) }, configGetter: () => ({ outputPath: outDir }), log: () => {}, onProgress: () => {} });
  const r = await sync2.syncBook('3300099999', undefined);
  const after = (await index2.getNotesByBookId('3300099999', undefined)).length;
  ok(after === before && r.length === before, `远端空列表不清空本地笔记（${before} → ${after}）`);
}

// 13.66 登录态真实性（v1.0.6）：凭据存在 + 服务端判无效 → 管理器宽限返回 true（保数据）但 lastRawCheck.ok=false（UI 据此显示"登录已过期"）
{
  const { createAuthManager } = await import('./lib/auth.js');
  const { createStore } = await import('./lib/store.js');
  const tmpAuth = path.join(tmp, 'state-auth');
  fs.mkdirSync(tmpAuth, { recursive: true });
  const store3 = createStore(tmpAuth);
  store3.addAccount({ accountId: '999', displayName: '过期测试', createdAt: 1, lastUsedAt: 1 });
  store3.setActiveAccountId('999');
  store3.saveCookies('999', 'wr_vid=1; wr_skey=dead');
  store3.setState('999', 'authMeta', { lastVerifiedAt: Date.now() - 11 * 60_000, refreshFailureCount: 0, refreshBackoffUntil: 0 }); // 11 分钟前：过 10 分钟校验缓存、仍在 7 天宽限内
  const fakeApi2 = {
    checkLoginStatus: async () => false, // 服务端已判无效
    apiClient: { setCookies() {} },
    refreshCookiesFromServer: async () => null,
    getUserProfileByToken: async () => { throw new Error('x'); },
    getUserProfile: async () => { throw new Error('x'); },
  };
  const auth3 = createAuthManager(store3, fakeApi2, () => {});
  const verdict = await auth3.checkLoginStatus();
  const raw = auth3.getLastRawCheck();
  ok(verdict === true, '宽限期内管理器返回 true（数据可用性保护）');
  ok(raw.ok === false && raw.at > 0, 'lastRawCheck 暴露底层已判无效（供 UI 显示登录已过期）');
  // 宽限期外（lastVerifiedAt=0）：清凭据返回 false
  store3.setState('999', 'authMeta', { lastVerifiedAt: 0, refreshFailureCount: 0, refreshBackoffUntil: 0 });
  const verdict2 = await auth3.checkLoginStatus();
  ok(verdict2 === false && !!store3.getCookies('999'), '宽限期外返回 false（cookie 按原设计保留供刷新复活，仅登出状态）');
  const freshRaw = auth3.getLastRawCheck();
  const now1 = await auth3.verifyNow();
  const freshRaw2 = auth3.getLastRawCheck();
  ok(now1 === false && freshRaw2.ok === false && freshRaw2.at >= (freshRaw.at || 0), 'verifyNow 绕过宽限实时判无效（供同步入口复核）');
}

// 13.66b v1.9.0 B2/C1：Cookie 来源指纹（login/head-refresh/window）+ 开书预热 30min 门 + simpleBrowserAuth 快照同步
{
  const { createAuthManager } = await import('./lib/auth.js');
  const { createStore } = await import('./lib/store.js');
  const dirW = path.join(tmp, 'state-warmup');
  fs.mkdirSync(dirW, { recursive: true });
  const storeW = createStore(dirW);
  storeW.addAccount({ accountId: 'W1', displayName: '预热账号', wrVid: 'V1', createdAt: 1, lastUsedAt: 1 });
  storeW.setActiveAccountId('W1');
  let headCalls = 0;
  const fakeApiW = {
    checkLoginStatus: async () => true,
    apiClient: { setCookies() {}, clearCookies() {} },
    refreshCookiesFromServer: async () => { headCalls += 1; return `wr_vid=V1; wr_skey=SK${headCalls}`; }, // 每次 HEAD 都换新 skey
    fetchUserInfo: async () => ({ user: { userId: 'W1', userVid: 'V1', name: '预热账号' } }),
    getUserProfileByToken: async () => ({ userId: 'W1', name: '预热账号' }),
    getUserProfile: async () => { throw new Error('x'); },
  };
  const authW = createAuthManager(storeW, fakeApiW, () => {});
  await authW.handleLoginSuccess({ cookies: 'wr_vid=V1; wr_skey=SK0', vid: 'V1', skey: 'SK0', token: 'SK0', session: 'V1' });
  ok(authW.getCookieOrigin()?.source === 'login' && authW.getCookieOrigin()?.skeyTail === 'SK0', 'B2：登录记录 cookieOrigin（source=login + skey 尾号）');
  // C1 预热：lastRefreshAt=0 → 强制 HEAD → 续命换血 + 来源翻转
  await authW.warmupRefreshForOpen();
  ok(headCalls === 1 && String(storeW.getCookies('W1')).includes('SK1'), 'C1：>30min 未续命 → 预热触发 HEAD 换血');
  ok(authW.getCookieOrigin()?.source === 'head-refresh' && authW.getCookieOrigin()?.skeyTail === 'SK1', 'B2：续命记录 source=head-refresh + 新 skey 尾号');
  ok(String(storeW.getSimpleBrowserAuth('W1')?.cookies ?? '').includes('SK1'), 'B2：续命同步 simpleBrowserAuth 快照（原「只写不更」的僵尸数据激活）');
  // C1 30min 门：立即再预热 → 不重复 HEAD
  await authW.warmupRefreshForOpen();
  ok(headCalls === 1, 'C1：30min 内开书预热不重复 HEAD（频繁开书不打爆服务端）');
  // B2 window 来源
  await authW.handleLoginSuccess({ cookies: 'wr_vid=V1; wr_skey=SKW', vid: 'V1', skey: 'SKW', token: 'SKW', session: 'V1', source: 'window' });
  ok(authW.getCookieOrigin()?.source === 'window', 'B2：窗内采纳记录 source=window（设置页「来源：阅读窗口回流」）');
  // v1.9.2 F1：登出即清指纹——凭据都没了，「上次续命」不应残留
  await authW.logoutAccount('W1');
  ok(authW.getCookieOrigin('W1') === null, 'F1：登出清 cookieOrigin（设置页不再显示旧账号的「上次续命」）');
  ok(storeW.getCookies('W1') === undefined, 'F1 前置复核：登出后凭据已清');
  // v1.9.2 C1 补盲区：无凭据 → 预热 no-op
  headCalls = 0;
  await authW.warmupRefreshForOpen();
  ok(headCalls === 0, 'C1：无凭据时预热 no-op（不空打 HEAD）');
  // v1.9.2 C1 补盲区：退避期内预热不强制（风控退避优先于开书预热）
  await authW.handleLoginSuccess({ cookies: 'wr_vid=V1; wr_skey=SK2', vid: 'V1', skey: 'SK2', token: 'SK2', session: 'V1' });
  storeW.setState('W1', 'authMeta', { lastRefreshAt: 0, refreshFailureCount: 3, refreshBackoffUntil: Date.now() + 3600_000 });
  await authW.warmupRefreshForOpen();
  ok(headCalls === 0, 'C1：退避期内预热被抑制（backoffUntil 优先于 30min 门）');
  authW.dispose();
}

// 13.66c v1.9.2 C1 inFlight 合并 + B1 裁决缓存语义（不缓存网络异常）
{
  const { createAuthManager } = await import('./lib/auth.js');
  const { createStore } = await import('./lib/store.js');
  const dirI = path.join(tmp, 'state-warmup-inflight');
  fs.mkdirSync(dirI, { recursive: true });
  const storeI = createStore(dirI);
  storeI.addAccount({ accountId: 'I1', displayName: '并发', createdAt: 1, lastUsedAt: 1 });
  storeI.setActiveAccountId('I1');
  let headCalls = 0;
  let releaseHead;
  const gate = new Promise((r) => { releaseHead = r; }); // 手动闸：挂住第一次 HEAD
  const fakeApiI = {
    checkLoginStatus: async () => true,
    apiClient: { setCookies() {} },
    refreshCookiesFromServer: async () => { headCalls += 1; await gate; return 'wr_vid=V1; wr_skey=INF'; },
    fetchUserInfo: async () => ({ user: { userId: 'I1', userVid: 'V1', name: '并发账号' } }),
    getUserProfileByToken: async () => ({ userId: 'I1', name: '并发账号' }),
    getUserProfile: async () => { throw new Error('x'); },
  };
  const authI = createAuthManager(storeI, fakeApiI, () => {});
  await authI.handleLoginSuccess({ cookies: 'wr_vid=V1; wr_skey=I0', vid: 'V1', skey: 'I0', token: 'I0', session: 'V1' });
  storeI.setState('I1', 'authMeta', { lastRefreshAt: 0 }); // 强制预热路径生效
  const p1 = authI.warmupRefreshForOpen();
  const p2 = authI.warmupRefreshForOpen(); // 第一笔在飞时并压进来
  await new Promise((r) => setTimeout(r, 20));
  ok(headCalls === 1, 'C1：inFlight 合并——并发预热只打一次底层 HEAD');
  releaseHead();
  await Promise.all([p1, p2]);
  ok(String(storeI.getCookies('I1')).includes('INF'), 'C1：合并的两笔预热都等到同一结果');
  authI.dispose();
}

// 13.68 v1.1 官方通道（API Key）：网关客户端 / apiKey 存取 / 想法三分类与归并 / 对账 / 登录绑定 / 补采落盘
{
  const { createGatewayClient, normalizeApiKey, apiKeyTail } = await import('./lib/gateway.js');
  const { transformMyReviews, mergeReviewsIntoNotes, computeReconcile } = await import('./lib/sync.js');
  const { createStore } = await import('./lib/store.js');
  const { transformNotes } = await import('./lib/api.js');

  // --- 网关客户端（假 fetch，不触网）---
  const calls = [];
  const resp = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    const body = JSON.parse(init.body);
    if (body.api_name === '/user/notebooks') {
      if (body.lastSort === undefined) return resp({ errcode: 0, books: [{ bookId: 'b1', sort: 100 }, { bookId: 'b2', sort: 50 }], hasMore: 1, totalBookCount: 3, totalNoteCount: 10 });
      return resp({ errcode: 0, books: [{ bookId: 'b3', sort: 10 }], hasMore: 0, totalBookCount: 3, totalNoteCount: 10 });
    }
    if (body.api_name === '/review/list/mine') {
      return resp(body.synckey === 0
        ? { errcode: 0, reviews: [{ review: { reviewId: 'rvA', content: 'a' } }], hasMore: 1, synckey: 77 }
        : { errcode: 0, reviews: [{ review: { reviewId: 'rvB', content: 'b' } }], hasMore: 0, synckey: 88 });
    }
    if (body.api_name === '/boom') return resp({ errcode: -1, errMsg: '炸了' });
    if (body.api_name === '/upgrade') return resp({ errcode: 0, data: 1, upgrade_info: { message: '请升级' } });
    return resp({ errcode: 0 });
  };
  const upgrades = [];
  const gwState = new Map();
  const gw = createGatewayClient({
    fetchImpl: fakeFetch,
    onUpgradeInfo: (i) => upgrades.push(i),
    getState: (k) => gwState.get(k),
    setState: (k, v) => gwState.set(k, v),
  });
  gw.setApiKey('WEREAD_API_KEY=  "wrk-test1234" ');
  ok(normalizeApiKey('WEREAD_API_KEY=  "wrk-test1234" ') === 'wrk-test1234', 'apiKey 规范化（export 前缀/引号/空白）');
  ok(gw.getApiKey() === 'wrk-test1234', '客户端持有规范化 Key');
  await gw.ping();
  ok(calls[0].init.headers.Authorization === 'Bearer wrk-test1234', '网关请求 Bearer 鉴权');
  const pingBody = JSON.parse(calls[0].init.body);
  ok(pingBody.api_name === '/user/notebooks' && pingBody.count === 1, 'ping 走 /user/notebooks 最小请求');
  const nb = await gw.notebooksAll();
  const nbBody = calls.map((c) => JSON.parse(c.init.body)).find((b) => b.api_name === '/user/notebooks' && b.count === 50);
  ok(nbBody && nbBody.skill_version === '1.0.5' && nbBody.params === undefined, '请求体：api_name/参数平铺 + skill_version');
  ok(nb.books.length === 3 && calls.some((c) => JSON.parse(c.init.body).lastSort === 50), 'notebooks 翻页（lastSort=末项 sort 游标，禁 offset）');
  const rv = await gw.myReviewsAll('b1');
  ok(rv.length === 2 && calls.some((c) => JSON.parse(c.init.body).synckey === 77), 'myReviews 翻页（synckey 游标）');
  let boomErr; try { await gw.call('/boom'); } catch (e) { boomErr = e; }
  ok(boomErr?.name === 'GatewayError' && boomErr.message === '炸了' && boomErr.errcode === -1, 'errcode 非 0 → GatewayError（中文信息）');
  await gw.call('/upgrade');
  ok(upgrades.length === 1 && gwState.get('gatewayUpgrade')?.info?.message === '请升级', 'upgrade_info 捕获并落 state');
  ok(apiKeyTail('wrk-abcd') === 'abcd', 'apiKeyTail 尾号脱敏');

  // --- store：apiKey 按账号存取 ---
  const dirGw = path.join(tmp, 'state-gw');
  fs.mkdirSync(dirGw, { recursive: true });
  const sGw = createStore(dirGw);
  sGw.addAccount({ accountId: '111' });
  sGw.saveApiKey('111', 'wrk-k1');
  ok(sGw.getApiKey('111') === 'wrk-k1', 'apiKey 按账号存取');
  sGw.setActiveAccountId('111');
  ok(sGw.getApiKey() === 'wrk-k1', '活跃账号无参读取');
  sGw.clearApiKey('111');
  ok(sGw.getApiKey('111') === undefined, '清 apiKey');
  sGw.saveApiKey('111', 'wrk-k2');
  sGw.clearAll('111');
  ok(sGw.getApiKey('111') === undefined && sGw.listAccounts().length === 0, 'clearAll 连带清 apiKey 与账号');

  // --- 纯函数：三分类 / 归并 / 对账 ---
  const rawReviews = [
    { review: { reviewId: 'rv1', range: '100-120', abstract: '划线原文A', content: '想法1', createTime: 1700000001 } },
    { review: { reviewId: 'rv2', chapterName: '第二章', content: '章节点评', createTime: 1700000002 } },
    { review: { reviewId: 'rv3', content: '整本书评', star: 80, createTime: 1700000003, isFinish: 1 } },
    { review: { reviewId: 'rv4', range: '9-9', abstract: '未命中划线', content: '独立想法', createTime: 1700000004 } },
  ];
  const t = transformMyReviews(rawReviews, 'b1');
  ok(t.attached.length === 2 && t.chapterComments.length === 1 && t.bookReviews.length === 1, '想法三分类（划线想法/章节点评/书评）');
  const baseNotes = [
    { noteId: 'bm1', range: '100-120', highlightText: '划线原文A', type: 1, createTime: 1700000000 },
    { noteId: 'bm2', range: '200-220', highlightText: '划线原文B', type: 1, thoughtText: '旧想法', createTime: 1700000000 },
  ];
  const m = mergeReviewsIntoNotes(baseNotes, t);
  ok(m.notes.find((n) => n.noteId === 'bm1')?.thoughtText === '想法1', '划线想法按 range 归并到既有笔记');
  const standalone = m.notes.find((n) => n.noteId === 'rv4');
  ok(standalone?.thoughtText === '独立想法' && standalone?.highlightText === '未命中划线', '未命中想法 → 独立笔记（保留原文）');
  const cc = m.notes.find((n) => n.noteId === 'rv2');
  ok(cc?.chapterTitle === '第二章' && cc?.thoughtText === '章节点评', '章节点评 → 独立想法笔记');
  ok(m.bookReview?.content === '整本书评', '整本书评单独返回（接 renderBookMarkdown review 钩子）');
  ok(m.notes.length === 4 && !m.notes.some((n) => n.noteId === 'rv1'), '归并不产生重复笔记');
  const rec = computeReconcile(
    [{ bookId: 'b1', noteCount: 2, reviewCount: 1, book: { title: '书1' } }, { bookId: 'b2', noteCount: 5, reviewCount: 0, book: { title: '书2' } }],
    [{ bookId: 'b1', localCount: 2 }, { bookId: 'b2', localCount: 5 }],
  );
  ok(rec.checked === 2 && rec.mismatchedCount === 1 && rec.mismatched[0].title === '书1' && rec.mismatched[0].expected === 3 && rec.mismatched[0].local === 2, '对账：差异定位（expected=noteCount+reviewCount）');

  // --- auth：API Key 登录（独立/绑定/登出清 Key）---
  const { createAuthManager } = await import('./lib/auth.js');
  const fakeGw = {
    _key: '',
    setApiKey(k) { this._key = String(k || ''); }, getApiKey() { return this._key; },
    clearApiKey() { this._key = ''; }, hasApiKey() { return !!this._key; },
    async ping() { if (!this._key.startsWith('wrk-')) throw new Error('bad key'); return true; },
    async call(api) { if (api === '/user/profile') throw new Error('not open'); throw new Error(`unexpected ${api}`); },
    async notebooksAll() { return { books: [{ bookId: 'bx1' }, { bookId: 'bx2' }], totalBookCount: 2, totalNoteCount: 7 }; },
    async myReviewsAll() { return []; },
  };
  const fakeApiGw = { checkLoginStatus: async () => false, apiClient: { setCookies() {}, clearCookies() {} } };
  const stGw1 = createStore(path.join(tmp, 'state-auth-gw1'));
  const authGw1 = createAuthManager(stGw1, fakeApiGw, () => {}, fakeGw);
  let rejected = false;
  try { await authGw1.loginByApiKey({ apiKey: 'bad-key' }); } catch { rejected = true; }
  ok(rejected, '非法 Key 登录被拒（ping 校验）');
  const lr1 = await authGw1.loginByApiKey({ apiKey: 'wrk-good' });
  ok(lr1.accountId.startsWith('wrk-') && stGw1.getApiKey(lr1.accountId) === 'wrk-good', '独立登录：签名伪账号 + Key 落盘');
  ok(authGw1.isLoggedIn() === true, 'apiKey-only isLoggedIn');
  ok((await authGw1.verifyNow()) === true, 'apiKey-only verifyNow 走网关 ping');
  const stGw2 = createStore(path.join(tmp, 'state-auth-gw2'));
  stGw2.addAccount({ accountId: '777', displayName: 'Cookie 账号' });
  stGw2.setActiveAccountId('777');
  stGw2.saveCookies('777', 'wr_vid=7; wr_skey=s');
  const authGw2 = createAuthManager(stGw2, fakeApiGw, () => {}, fakeGw);
  const lr2 = await authGw2.loginByApiKey({ apiKey: 'wrk-good' });
  ok(lr2.attached === true && lr2.accountId === '777' && stGw2.getApiKey('777') === 'wrk-good', '已登录时绑定当前账号（复用账号目录）');
  await authGw2.logoutAccount('777');
  ok(stGw2.getApiKey('777') === undefined, '登出清 Key');

  // --- 同步管线集成：web 兜底拉想法 → Markdown 含 💭 与 ## 书评 ---
  const { createIndexService } = await import('./lib/indexsvc.js');
  const { createSyncService } = await import('./lib/sync.js');
  const markdownLib = await import('./lib/markdown.js');
  const outRv = path.join(tmp, 'notes-reviews');
  fs.mkdirSync(outRv, { recursive: true });
  const stRv = createStore(path.join(tmp, 'state-rv'));
  const idxRv = createIndexService({ store: stRv, markdown: markdownLib, configGetter: () => ({ outputPath: outRv }), log: () => {} });
  stRv.addAccount({ accountId: '555' }); stRv.setActiveAccountId('555'); stRv.saveCookies('555', 'wr_vid=5; wr_skey=x');
  const fakeApiRv = {
    getShelfList: async () => ({ books: [{ book: { bookId: '33000555', rawBookId: '33000555', title: '想法补采书', author: '作者', category: '测试', reviewCount: 2, progress: 10, pcUrl: 'https://weread.qq.com/web/reader/x' } }], totalCount: 1 }),
    getArticleBooks: async () => [],
    getBookNotes: async () => ({
      updated: [{ bookmarkId: 'bm1', bookId: '33000555', chapterUid: 1, chapterTitle: '第一章', markText: '划线原文A', type: 1, range: '100-120', createTime: 1700000000 }],
      chapters: [{ chapterUid: 1, title: '第一章', chapterIdx: 0 }],
    }),
    getWebReviewListMine: async () => ({
      reviews: [
        { review: { reviewId: 'rv1', range: '100-120', abstract: '划线原文A', content: '划线想法', createTime: 1700000001 } },
        { review: { reviewId: 'rv2', chapterName: '第一章', content: '章节点评内容', createTime: 1700000002 } },
        { review: { reviewId: 'rv3', content: '我的书评内容', star: 80, createTime: 1700000003 } },
      ],
      hasMore: 0, synckey: 9,
    }),
    getBookInfo: async () => { throw new Error('offline'); },
    transformNotes,
    buildPcUrl: () => 'https://weread.qq.com/web/reader/x',
    apiClient: { setCookies() {} },
  };
  const syncRv = createSyncService({ api: fakeApiRv, store: stRv, index: idxRv, markdown: markdownLib, cleanup: { cleanupDuplicateBookFilesForAccount: async () => ({}) }, configGetter: () => ({ outputPath: outRv }), log: () => {}, onProgress: () => {}, gateway: null });
  const resRv = await syncRv.fullSync('555');
  ok(resRv.success === true, `补采同步成功${resRv.error ? '（' + resRv.error + '）' : ''}`);
  const findMd = (dir) => {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) out.push(p); } };
    walk(dir); return out;
  };
  const mdRv = fs.readFileSync(findMd(outRv)[0], 'utf8');
  ok(mdRv.includes('划线想法'), '划线想法进 Markdown');
  ok(mdRv.includes('章节点评内容'), '章节点评进 Markdown');
  ok(mdRv.includes('## 书评') && mdRv.includes('我的书评内容'), '整本书评进 Markdown（## 书评 区块首次接线）');

  // --- v1.1.2 网关驱动同步：计数订正 + 缺失书补齐 + 文件名回退 + 对账归零 ---
  const outGw2 = path.join(tmp, 'notes-gw2');
  fs.mkdirSync(outGw2, { recursive: true });
  const stGw3 = createStore(path.join(tmp, 'state-gw3'));
  stGw3.addAccount({ accountId: '666' }); stGw3.setActiveAccountId('666');
  stGw3.saveCookies('666', 'wr_vid=6; wr_skey=y');
  stGw3.saveApiKey('666', 'wrk-live');
  const idxGw3 = createIndexService({ store: stGw3, markdown: markdownLib, configGetter: () => ({ outputPath: outGw2 }), log: () => {} });
  const fakeGw3 = {
    _key: '', setApiKey(k) { this._key = k; }, getApiKey() { return this._key; },
    clearApiKey() { this._key = ''; }, hasApiKey() { return !!this._key; },
    async notebooksAll() {
      return {
        books: [
          // B1：cookie 书架也在，但 cookie 计数滞后（reviewCount=0）→ 网关订正为 1 → 触发补采
          { bookId: 'B1', noteCount: 1, reviewCount: 1, readingProgress: 0.5, markedStatus: 0, sort: 1700000100, book: { title: '计数订正书' } },
          // B2：cookie 书架完全没有（只有 1 条书评无划线）→ 追加进同步清单
          { bookId: '26639874', noteCount: 0, reviewCount: 1, readingProgress: 0, markedStatus: 0, sort: 1572533138, book: { title: '阿加莎式书评书', author: '某作者' } },
          // B3：服务端无标题的公众号 → 文件名回退 bookId
          { bookId: 'MP_WXS_TEST1', noteCount: 1, reviewCount: 0, sort: 1555196435, book: { title: '', author: '公众号' } },
        ],
        totalBookCount: 3, totalNoteCount: 5,
      };
    },
    async myReviewsAll(bookId) {
      if (bookId === 'B1') return [{ review: { reviewId: 'g-r1', range: '10-20', abstract: '原文一', content: '网关想法', createTime: 1700000101 } }];
      if (bookId === '26639874') return [{ review: { reviewId: 'g-r2', content: '只有书评的书评内容', star: 80, createTime: 1572533138 } }];
      return [];
    },
  };
  const fakeApi4 = {
    getShelfList: async () => ({
      books: [{ book: { bookId: 'B1', rawBookId: 'B1', title: '计数订正书', author: '甲', category: '科技', reviewCount: 0, highlightCount: 1, noteCount: 1, progress: 50, pcUrl: 'https://x' } }],
      totalCount: 1,
    }),
    getArticleBooks: async () => [],
    getBookNotes: async (bookId) => {
      if (bookId === 'B1') return { updated: [{ bookmarkId: 'gbm1', bookId: 'B1', chapterUid: 1, chapterTitle: '章一', markText: '原文一', type: 1, range: '10-20', createTime: 1700000000 }], chapters: [{ chapterUid: 1, title: '章一' }] };
      if (bookId === 'MP_WXS_TEST1') return { updated: [{ bookmarkId: 'gbm2', bookId: 'MP_WXS_TEST1', chapterUid: 1, markText: '无标题文章的划线', type: 1, createTime: 1555196435 }], chapters: [{ chapterUid: 1, title: '第一章' }] };
      return { updated: [], chapters: [] }; // B2 无划线（只有书评）
    },
    getWebReviewListMine: async () => ({ reviews: [], hasMore: 0 }),
    getBookInfo: async () => { throw new Error('offline'); },
    transformNotes,
    buildPcUrl: (id) => `https://weread.qq.com/web/reader/${id}`,
    apiClient: { setCookies() {} },
  };
  const syncGw3 = createSyncService({ api: fakeApi4, store: stGw3, index: idxGw3, markdown: markdownLib, cleanup: { cleanupDuplicateBookFilesForAccount: async () => ({}) }, configGetter: () => ({ outputPath: outGw2 }), log: () => {}, onProgress: () => {}, gateway: fakeGw3 });
  fakeGw3.setApiKey('wrk-live'); // 对齐真实链路：index.js 启动/登录时 syncGatewayKey() 注入
  const resGw3 = await syncGw3.fullSync('666');
  ok(resGw3.success === true, `网关驱动同步成功${resGw3.error ? '（' + resGw3.error + '）' : ''}`);
  const gwFiles = findMd(outGw2).map((p) => path.basename(p));
  ok(gwFiles.some((f) => f.includes('MP_WXS_TEST1')), `无标题 MP 文章文件名回退 bookId（得到 ${gwFiles.join(',')}）`);
  const agathaFile = findMd(outGw2).find((p) => fs.readFileSync(p, 'utf8').includes('bookid: 26639874'));
  ok(!!agathaFile, 'cookie 书架缺失的书评书被网关补进同步清单并落盘');
  ok(fs.readFileSync(agathaFile, 'utf8').includes('只有书评的书评内容'), '书评内容写入 ## 书评 区块');
  const b1File = findMd(outGw2).find((p) => fs.readFileSync(p, 'utf8').includes('bookid: B1'));
  ok(!!b1File && fs.readFileSync(b1File, 'utf8').includes('网关想法'), 'cookie 计数滞后被网关订正后触发想法补采');
  const syncStateGw3 = stGw3.getState('666', 'syncState', {});
  ok(syncStateGw3.reconcile && syncStateGw3.reconcile.mismatchedCount === 0 && syncStateGw3.reconcile.checkedBooks === 3, `网关驱动对账归零（checked=${syncStateGw3.reconcile?.checkedBooks} mismatch=${syncStateGw3.reconcile?.mismatchedCount}）`);
  // 文件名回退纯函数
  ok(markdownLib.buildFileName({ title: '', bookId: 'MP_WXS_X', rawBookId: 'MP_WXS_X' }) === 'MP_WXS_X'
    && markdownLib.buildFileName({ title: '未命名书籍', bookId: '3300012345' }) === '3300012345'
    && markdownLib.buildFileName({ title: '正常书名', bookId: 'b9' }) === '正常书名', 'buildFileName 无实义标题回退 bookId');

  // --- v1.2 cookie 全挂（登录过期）→ 网关数据通道兜底（书架 notebooks + 划线 /book/bookmarklist）---
  const outFb = path.join(tmp, 'notes-fallback');
  fs.mkdirSync(outFb, { recursive: true });
  const stFb = createStore(path.join(tmp, 'state-fb'));
  stFb.addAccount({ accountId: '888' }); stFb.setActiveAccountId('888');
  stFb.saveCookies('888', 'wr_vid=8; wr_skey=dead'); // cookie 在但已失效
  stFb.saveApiKey('888', 'wrk-live');
  const idxFb = createIndexService({ store: stFb, markdown: markdownLib, configGetter: () => ({ outputPath: outFb }), log: () => {} });
  const fakeGw4 = {
    _key: '', setApiKey(k) { this._key = k; }, getApiKey() { return this._key; },
    clearApiKey() { this._key = ''; }, hasApiKey() { return !!this._key; },
    async notebooksAll() {
      return { books: [{ bookId: 'B1', noteCount: 1, reviewCount: 0, sort: 1700000100, book: { title: '网关兜底书', author: '乙' } }], totalBookCount: 1, totalNoteCount: 1 };
    },
    async myReviewsAll() { return []; },
    async call(apiName, params) {
      if (apiName === '/book/bookmarklist') {
        return { updated: [{ bookmarkId: 'fbm1', bookId: params.bookId, chapterUid: 1, markText: '网关兜底划线', type: 1, createTime: 1700000000 }], chapters: [{ chapterUid: 1, title: '兜底章', chapterIdx: 0 }] };
      }
      throw new Error('unexpected ' + apiName);
    },
  };
  const expiredErr = new Error('登录已过期，请重新登录');
  const fakeApi5 = {
    getShelfList: async () => { throw expiredErr; }, // cookie 书架 401
    getArticleBooks: async () => { throw expiredErr; },
    getBookNotes: async () => { throw expiredErr; }, // cookie 划线 401
    getWebReviewListMine: async () => { throw expiredErr; },
    getBookInfo: async () => { throw expiredErr; },
    transformNotes,
    buildPcUrl: (id) => `https://weread.qq.com/web/reader/${id}`,
    apiClient: { setCookies() {} },
  };
  fakeGw4.setApiKey('wrk-live');
  const syncFb = createSyncService({ api: fakeApi5, store: stFb, index: idxFb, markdown: markdownLib, cleanup: { cleanupDuplicateBookFilesForAccount: async () => ({}) }, configGetter: () => ({ outputPath: outFb }), log: () => {}, onProgress: () => {}, gateway: fakeGw4 });
  const resFb = await syncFb.fullSync('888');
  ok(resFb.success === true, `cookie 全挂时网关兜底同步成功${resFb.error ? '（' + resFb.error + '）' : ''}`);
  const fbFile = findMd(outFb).find((p) => fs.readFileSync(p, 'utf8').includes('网关兜底划线'));
  ok(!!fbFile, '网关 bookmarklist 兜底：划线落盘');
  ok(fs.readFileSync(fbFile, 'utf8').includes('兜底章'), '网关 chapters 章节名进文件');

  // --- v1.2 verifyNow Key 营救：cookie 判无效 + 网关 ping 有效 → true（同步入口不再被死 cookie 拦截）---
  {
    const { createAuthManager: cam } = await import('./lib/auth.js');
    const stR = createStore(path.join(tmp, 'state-rescue'));
    stR.addAccount({ accountId: '999' }); stR.setActiveAccountId('999');
    stR.saveCookies('999', 'wr_vid=9; wr_skey=dead');
    stR.saveApiKey('999', 'wrk-live');
    const fakeGw5 = {
      _key: '', setApiKey(k) { this._key = k; }, getApiKey() { return this._key; },
      clearApiKey() { this._key = ''; }, hasApiKey() { return !!this._key; },
      async ping() { return true; }, async call() { throw new Error('x'); },
      async notebooksAll() { return { books: [], totalBookCount: 0, totalNoteCount: 0 }; },
      async myReviewsAll() { return []; },
    };
    const fakeApiR = { checkLoginStatus: async () => false, apiClient: { setCookies() {}, clearCookies() {} }, refreshCookiesFromServer: async () => null };
    const authR = cam(stR, fakeApiR, () => {}, fakeGw5);
    ok((await authR.verifyNow()) === true, 'verifyNow Key 营救：cookie 无效 + Key 有效 → 登录保持');
  }
}

// 13.685 v1.1.3 markdown 写→解析幂等（多行划线/想法：写侧逐行前缀 + 解析侧续行归并 + 旧文件追溯恢复）
{
  const mdLib = await import('./lib/markdown.js');
  const rtNotes = [
    { noteId: 'a', type: 1, chapterTitle: '章一', highlightText: '单行划线', createTime: 1700000000 },
    { noteId: 'b', type: 1, chapterTitle: '章一', highlightText: '多行划线第一行\n第二行\n第三行', createTime: 1700000001 },
    { noteId: 'c', type: 1, chapterTitle: '章一', highlightText: '\n换行开头\n组主在群里', createTime: 1700000002 },
    { noteId: 'd', type: 1, chapterTitle: '章一', highlightText: '内部空行\n\n第二段', createTime: 1700000003 },
    { noteId: 'e', type: 2, chapterTitle: '章一', thoughtText: '多行想法一\n想法二', createTime: 1700000004 },
  ];
  const rtBook = { bookId: 'RT1', rawBookId: 'RT1', title: '往返书', author: 'A', category: '科技', progress: 10, noteCount: rtNotes.length, pcUrl: 'https://x' };
  const rtMd = mdLib.renderBookMarkdown(rtBook, rtNotes, {});
  const rtBack = mdLib.parseBookMarkdownContent(rtMd, '/tmp/rt1.md');
  const rtHl = (rtBack?.notes ?? []).filter((n) => String(n.highlightText ?? '').trim());
  const rtTh = (rtBack?.notes ?? []).filter((n) => String(n.thoughtText ?? '').trim());
  ok(rtHl.length === 4, `多行划线写→解析条数保持（${rtHl.length}/4）`);
  ok(rtHl.some((n) => n.highlightText === '多行划线第一行\n第二行\n第三行'), '多行划线文本逐字节还原');
  ok(rtHl.some((n) => n.highlightText === '换行开头\n组主在群里'), '换行开头文本规范化还原');
  ok(rtHl.some((n) => n.highlightText === '内部空行\n第二段'), '内部空行折叠后往返一致');
  ok(rtTh.length === 1 && rtTh[0].thoughtText === '多行想法一\n想法二', '多行想法续行归并还原');
  const legacyMd = '# 旧格式\n\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> \n裸文本续行一\n续行二\n\n_记录时间：2026-11-01 10:00:00_\n';
  const legacyBack = mdLib.parseBookMarkdownContent(legacyMd, '/tmp/legacy.md');
  const legacyHl = (legacyBack?.notes ?? []).filter((n) => String(n.highlightText ?? '').trim());
  ok(legacyHl.length === 1 && legacyHl[0].highlightText.replace(/^\n/, '') === '裸文本续行一\n续行二', '旧版文件裸 `> ` + 续行追溯找回（不改文件恢复数据）');
}

// 13.686 P0-1（对抗审查 v2）：noteId 互逆性——写盘锚点 + 💬 并入 + 第二轮幂等 + merge 保留 local-only
{
  const mdLib = await import('./lib/markdown.js');
  const syncLib = await import('./lib/sync.js');
  const remoteNotes = [
    { noteId: 'bm1', type: 1, chapterTitle: '第一章', highlightText: '划线A', thoughtText: '想法A', createTime: 1700000000, modifyTime: 1700000000 },
    { noteId: 'bm2', type: 1, chapterTitle: '第一章', highlightText: '划线B\n第二行', createTime: 1700000001, modifyTime: 1700000001 },
    { noteId: 'rv9', type: 2, chapterTitle: '第一章', thoughtText: '独立想法', createTime: 1700000002, modifyTime: 1700000002 },
  ];
  const p01Book = { bookId: 'P01', rawBookId: 'P01', title: '锚点书', author: 'A', category: '科技', progress: 10, noteCount: 3, pcUrl: 'https://x' };
  const p01Md = mdLib.renderBookMarkdown(p01Book, remoteNotes, {});
  const p01Back = (mdLib.parseBookMarkdownContent(p01Md, '/tmp/p01.md')).notes ?? [];
  ok(p01Back.length === 3, `划线+想法同条不拆分（${p01Back.length}/3，原版拆 2 条致条数永不相等）`);
  ok(new Set(p01Back.map((n) => n.noteId)).size === 3, 'noteId 锚点读回全还原（bm1/bm2/rv9，不再被 local_<sha1> 覆盖）');
  const p01Diff = syncLib.detectNoteChanges(p01Back, remoteNotes);
  ok(p01Diff.added.length === 0 && p01Diff.modified.length === 0 && p01Diff.deleted.length === 0,
    `数据不变的第二轮 diff 全零（原版 a:${p01Diff.added.length || 'N'}/d:${p01Diff.deleted.length || 'N'} 恒全量）`);
  const rv9Back = p01Back.find((n) => n.noteId === 'rv9');
  const bm2Back = p01Back.find((n) => n.noteId === 'bm2');
  ok(!!rv9Back && rv9Back.thoughtText === '独立想法' && !rv9Back.highlightText, '独立想法不误并入前条划线（时间行=终结符）');
  ok(!!bm2Back && !bm2Back.thoughtText && bm2Back.highlightText === '划线B\n第二行', '纯划线往返内容逐字节一致');
  const remoteEdited = remoteNotes.map((n) => (n.noteId === 'bm1' ? { ...n, thoughtText: '想法A改' } : n));
  const editedDiff = syncLib.detectNoteChanges(p01Back, remoteEdited);
  ok(editedDiff.modified.length === 1, '真实内容变更仍检出（modified=1）');
  // merge 保留 local-only（原版 remoteNotes.map 静默丢弃手加笔记）
  const withManual = [...p01Back, { noteId: 'local_manual1', type: 1, chapterTitle: '第一章', highlightText: '我手加的', createTime: 1 }];
  const merged = syncLib.mergeWithLocalNotes(withManual, remoteNotes);
  ok(merged.some((n) => n.noteId === 'local_manual1'), 'merge 保留 local-only 笔记（原版每轮静默丢弃）');
  // 第三轮稳态：从读回再渲染再读回仍幂等
  const p01Md2 = mdLib.renderBookMarkdown(p01Book, p01Back, {});
  const p01Back2 = (mdLib.parseBookMarkdownContent(p01Md2, '/tmp/p01b.md')).notes ?? [];
  const diff3 = syncLib.detectNoteChanges(p01Back2, remoteNotes);
  ok(diff3.added.length === 0 && diff3.modified.length === 0 && diff3.deleted.length === 0, '第三轮稳态 diff 仍全零（锚点自持）');
}

// 13.686b v1.8.15：创建时间不伪造（web 新管线划线无 createTime）+ 远端权威修复 + 未知时间聚合豁免
{
  const mdLib = await import('./lib/markdown.js');
  const syncLib = await import('./lib/sync.js');
  const { transformNotes } = await import('./lib/api.js');
  const { createAnalyticsService } = await import('./lib/analytics.js');

  // --- transformNotes：缺 createTime 不落 Date.now（同步时刻冒充创建时间的根因） ---
  const noTime = transformNotes({ updated: [{ bookmarkId: 'nb1', bookId: 'B', chapterUid: 1, markText: '无时间划线', type: 0, range: '1-2' }] }, 'B');
  ok(noTime.length === 1 && noTime[0].createTime === 0 && noTime[0].highlightText === '无时间划线',
    'transformNotes 缺 createTime → 0（不伪造同步时刻）');
  const withTime = transformNotes({ updated: [{ bookmarkId: 'nb2', bookId: 'B', chapterUid: 1, markText: 'x', type: 1, createTime: 1700000000 }] }, 'B');
  ok(withTime[0].createTime === 1700000000, 'transformNotes 有 createTime 原样透传');

  // --- 解析层：无「记录时间」行 → createTime=0 + noteId 跨解析稳定 ---
  const mdNoTime = '---\ntitle: 无时间书\nbookid: NTBOOK1\n---\n\n# 无时间书\n\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 手写无时间划线\n';
  const bk1 = (mdLib.parseBookMarkdownContent(mdNoTime, '/tmp/nt1.md')).notes ?? [];
  const bk2 = (mdLib.parseBookMarkdownContent(mdNoTime, '/tmp/nt2.md')).notes ?? [];
  ok(bk1.length === 1 && bk1[0].createTime === 0, '无记录时间笔记 → createTime=0（不取解析时刻）');
  ok(bk1[0].noteId === bk2[0].noteId, '无时间无锚点笔记 noteId 跨解析稳定（内容哈希不含时刻）');

  // --- merge：远端真实 createTime 权威修复；远端无时间不反向清零 ---
  const poisoned = [{ noteId: 'bm1', type: 1, highlightText: '划线A', createTime: 1794236435 }];
  const remoteReal = [{ noteId: 'bm1', type: 1, highlightText: '划线A', createTime: 1794206332 }];
  const repaired = syncLib.mergeWithLocalNotes(poisoned, remoteReal);
  ok(repaired[0].createTime === 1794206332, 'merge：本地时间戳虽新，createTime 仍以远端真实值为准（污染自愈）');
  const keptLocal = syncLib.mergeWithLocalNotes(poisoned, [{ noteId: 'bm1', type: 1, highlightText: '划线A', createTime: 0 }]);
  ok(keptLocal[0].createTime === 1794236435, 'merge：远端无时间（0）不清零本地已有时间');
  ok(syncLib.detectNoteChanges(poisoned, remoteReal).modified.length === 1, '远端真实时间到达 → 检出 modified（触发 md 重写）');
  ok(syncLib.detectNoteChanges(
    [{ noteId: 'bm1', type: 1, highlightText: '划线A', createTime: 1700000000 }],
    [{ noteId: 'bm1', type: 1, highlightText: '划线A', createTime: 1700000000 }],
  ).modified.length === 0, 'createTime 一致不误报（秒级往返无损）');

  // --- 记录时间写盘规范格式 + 秒级往返 ---
  const tBook = { bookId: 'T', rawBookId: 'T', title: '时间书', author: 'A', category: '科技', progress: 10, noteCount: 1, pcUrl: 'https://x' };
  const tMd = mdLib.renderBookMarkdown(tBook, [{ noteId: 'tb1', type: 1, chapterTitle: '章', highlightText: '内容', createTime: 1794206332 }], {});
  ok(/_记录时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}_/.test(tMd), '记录时间规范格式 YYYY-MM-DD HH:mm:ss（locale 无关）');
  const tBack = (mdLib.parseBookMarkdownContent(tMd, '/tmp/t.md').notes ?? [])[0];
  ok(tBack.createTime === 1794206332, '记录时间秒级无损往返（新格式）');
  const legacyLocaled = '# 旧locale书\n\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 内容\n\n_记录时间：11/9/2026, 11:00:35 PM_\n';
  const legacyBack = (mdLib.parseBookMarkdownContent(legacyLocaled, '/tmp/tl.md').notes ?? [])[0];
  ok(legacyBack.createTime === new Date(2026, 10, 9, 23, 0, 35).getTime() / 1000, '旧 locale 格式记录时间仍可解析');

  // --- 洞察聚合：未知时间笔记——时间线在场且置前、计数包含、热力/活跃日豁免 ---
  const aggNotes = [
    { noteId: 'k1', bookId: 'KB', type: 1, chapterTitle: '章', highlightText: '旧划线', createTime: 1700000000 },
    { noteId: 'k2', bookId: 'KB', type: 1, chapterTitle: '章', highlightText: '新划线无时间', createTime: 0 },
  ];
  const aggBooks = [{ bookId: 'KB', title: '聚合书', author: 'A', category: '科技', progress: 10, noteCount: 2, lastReadTime: 1700000000 }];
  const analytics = createAnalyticsService({ index: { queryBooks: async () => aggBooks, getNotesByBookId: async () => aggNotes } });
  const dash = await analytics.getDashboardData({ days: 0 });
  const tl = dash.timeline;
  ok(tl.some((t) => t.noteId === 'k2' && t.createdAt === 0), '时间线含未知时间笔记（createdAt=0）');
  ok(tl.findIndex((t) => t.noteId === 'k2') < tl.findIndex((t) => t.noteId === 'k1'), '未知时间笔记置前（最新批次语义）');
  ok(dash.kpis.totalNotes === 2, '未知时间笔记计入 totalNotes');
  ok(dash.kpis.activeDays === 1, '活跃日只统计有时间笔记（无 1970 假日）');
  ok(dash.heatmap.reduce((s, c) => s + c.value, 0) === 1, '热力图豁免未知时间（epoch 假热区=0）');
}

// 13.687 v1.8.7 多账号真行为 + 语言默认 auto
{
  const { createAuthManager } = await import('./lib/auth.js');
  const { createStore } = await import('./lib/store.js');
  const tmpMa = path.join(tmp, 'state-multiacc');
  fs.mkdirSync(tmpMa, { recursive: true });
  const storeM = createStore(tmpMa);
  const fakeApiM = {
    apiClient: { setCookies() {}, clearCookies() {} },
    fetchUserInfo: async () => ({ user: { userId: 'B', name: '账号B' } }), // 登录即返回固定账号 B
    checkLoginStatus: async () => true,
    refreshCookiesFromServer: async () => null,
  };
  const authM = createAuthManager(storeM, fakeApiM, () => {});
  // 预置账号 A
  storeM.addAccount({ accountId: 'A', displayName: '账号A', createdAt: 1, lastUsedAt: 1 });
  storeM.setActiveAccountId('A');
  storeM.saveCookies('A', 'wr_vid=a; wr_skey=sa');
  // 多账号开（默认）：登录 B → A、B 并存
  authM.setMultiAccountPolicy(() => true);
  await authM.handleLoginSuccess({ cookies: 'wr_vid=b; wr_skey=sb', vid: 'b', skey: 'sb', token: 'sb', session: 'b' });
  ok(storeM.listAccounts().length === 2, `多账号开：登录新账号后并存（${storeM.listAccounts().length}/2）`);
  ok(storeM.getActiveAccountId() === 'B', '多账号开：新登录账号成为活跃账号');
  // 多账号关：再登录 A → 只剩 A（B 连凭据一起清理）
  const fakeApiM2 = { ...fakeApiM, fetchUserInfo: async () => ({ user: { userId: 'A', name: '账号A' } }) };
  const authM2 = createAuthManager(storeM, fakeApiM2, () => {});
  authM2.setMultiAccountPolicy(() => false);
  await authM2.handleLoginSuccess({ cookies: 'wr_vid=a; wr_skey=sa2', vid: 'a', skey: 'sa2', token: 'sa2', session: 'a' });
  ok(storeM.listAccounts().length === 1 && storeM.listAccounts()[0].accountId === 'A', `多账号关：登录另一账号即替换（剩 ${storeM.listAccounts().map((x) => x.accountId).join(',')}）`);
  ok(storeM.getActiveAccountId() === 'A', '多账号关：活跃账号为最后登录者');
}

// 13.688 v1.3 发现/统计封装（假 fetch）+ 路由与工具守卫
{
  const { createGatewayClient: cgc } = await import('./lib/gateway.js');
  const callsG = [];
  const respG = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
  const fakeFetchG = async (u, init) => {
    const body = JSON.parse(init.body);
    callsG.push(body);
    const api = body.api_name;
    if (api === '/readdata/detail') return respG({ errcode: 0, totalReadTime: 7200, readDays: 3, dayAverageReadTime: 2400, compare: 0.2, readStat: [{ stat: '读过', counts: '5本' }], readLongest: [{ book: { title: '书X' }, readTime: 3600 }], preferCategory: [{ categoryTitle: '科技', readingCount: 4, readingTime: 100 }] });
    if (api === '/book/getprogress') return respG({ errcode: 0, book: { chapterUid: 3, progress: 45, recordReadingTime: 600, updateTime: 1700000000 } });
    if (api === '/store/search') return respG({ errcode: 0, hasMore: 0, results: [{ title: '电子书', books: [{ searchIdx: 1, bookInfo: { title: '三体', author: '刘慈欣', readerLink: 'https://r' }, newRating: 90, readingCount: 1000 }] }] });
    if (api === '/book/recommend') return respG({ errcode: 0, books: [{ bookId: 'b1', title: '推荐书', author: '甲', reason: '读过类似', newRating: 85 }] });
    if (api === '/book/similar') return respG({ errcode: 0, booksimilar: { sessionId: 's1', books: [{ idx: 1, book: { bookInfo: { bookId: 'b2', title: '相似书' } } }] } });
    if (api === '/review/list') return respG({ errcode: 0, reviewsCnt: 2, reviews: [{ idx: 1, review: { review: { reviewId: 'r1', content: '好看', star: 80, author: { name: '张三' } } } }] });
    if (api === '/book/bestbookmarks') return respG({ errcode: 0, totalCount: 1, items: [{ bookmarkId: 'bm', chapterUid: 1, markText: '金句', totalCount: 99 }], chapters: [{ chapterUid: 1, title: '第一章' }] });
    return respG({ errcode: 0 });
  };
  const gwG = cgc({ fetchImpl: fakeFetchG, log: () => {} });
  gwG.setApiKey('wrk-t');
  const st = await gwG.readdata('weekly');
  ok(st.totalReadTime === 7200 && callsG.at(-1).mode === 'weekly', 'readdata(mode) 官方统计透传');
  const pr = await gwG.bookProgress('b1');
  ok(pr.progress === 45 && pr.recordReadingTime === 600, 'bookProgress 拍平 book.*');
  const sr = await gwG.storeSearch({ keyword: '三体', scope: 10 });
  ok(sr.results[0].books[0].bookInfo.title === '三体' && callsG.at(-1).scope === 10, 'storeSearch scope 显式传');
  const rc = await gwG.recommend({});
  ok(rc.books[0].reason === '读过类似', 'recommend 个性化推荐');
  const sm = await gwG.similarBooks('b1', {});
  ok(sm.books[0].book.bookInfo.title === '相似书' && callsG.at(-1).count === 12 && callsG.at(-1).maxIdx === 0, 'similar 显式 count/maxIdx（官方硬性要求）');
  const rv = await gwG.publicReviews('b1', {});
  ok(rv.reviews[0].content === '好看' && rv.reviews[0].author.name === '张三', 'publicReviews 双层 review 拍平');
  const bb = await gwG.bestBookmarks('b1');
  ok(bb.items[0].markText === '金句', 'bestBookmarks 热门划线');
}
// 13.695 v1.4.6 漫游池缓存失效（修「初始 1/1、切标签才变 1/58」：部分索引瞬间构建的池被 TTL 缓存钉死）
{
  const { createRoamingService } = await import('./lib/roaming.js');
  const { createIndexService } = await import('./lib/indexsvc.js');
  const { createStore: createStorePool } = await import('./lib/store.js');
  const markdownLib = await import('./lib/markdown.js');
  const tmpPool = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-pool-'));
  const outPool = path.join(tmpPool, 'notes');
  fs.mkdirSync(outPool, { recursive: true });
  const stPool = createStorePool(path.join(tmpPool, 'state'));
  let rebuiltCalls = 0;
  let roamPool;
  const idxPool = createIndexService({
    store: stPool, markdown: markdownLib, configGetter: () => ({ outputPath: outPool }), log: () => {},
    onRebuilt: () => { rebuiltCalls += 1; roamPool?.invalidatePools?.(); },
  });
  fs.writeFileSync(path.join(outPool, 'a.md'), '---\ntitle: 书A\nbookid: PA1\n---\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 第一条\n\n_记录时间：2026-11-01 10:00:00_\n');
  await idxPool.rebuildFromConfiguredPath('ACC');
  ok(rebuiltCalls === 1, 'onRebuilt 钩子在内容重建时触发');
  roamPool = createRoamingService({ index: idxPool, store: stPool, log: () => {} });
  await roamPool.reloadSession('ACC');
  ok(roamPool.getSession('ACC').statsPool.length === 1, '部分索引瞬间建池=1（复现原症状）');
  fs.writeFileSync(path.join(outPool, 'b.md'), '---\ntitle: 书B\nbookid: PB1\n---\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 第二条\n\n_记录时间：2026-11-02 10:00:00_\n');
  await idxPool.rebuildFromConfiguredPath('ACC');
  await roamPool.reloadSession('ACC'); // reloadSession 现强制清缓存（不靠切标签换 cacheKey）
  ok(roamPool.getSession('ACC').statsPool.length === 2, '同 filter 重载后池=2（缓存不再钉死旧值）');

  // v1.7.3 场景 B：会话已建好池 → 索引再重建 → 会话被标记过期（视图层自愈依据）
  ok(roamPool.isSessionStale(roamPool.getSession('ACC')) === false, '刚建好的会话不过期');
  fs.writeFileSync(path.join(outPool, 'c.md'), '---\ntitle: 书C\nbookid: PC1\n---\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 第三条\n\n_记录时间：2026-11-03 10:00:00_\n');
  await idxPool.rebuildFromConfiguredPath('ACC'); // onRebuilt → invalidatePools → 会话过期
  ok(roamPool.isSessionStale(roamPool.getSession('ACC')) === true, '索引重建后旧会话被标记过期（无需切标签）');
  await roamPool.reloadSession('ACC');
  ok(roamPool.getSession('ACC').statsPool.length === 3 && roamPool.isSessionStale(roamPool.getSession('ACC')) === false, '重载后池=3 且会话恢复新鲜');

  // v1.7.3 场景 A：池构建期间索引重建（代际变化）→ 守卫重试，不落部分池
  {
    const callGen = { n: 0 };
    const stubIndex = {
      queryBooks: async () => [{ bookId: 'S1', title: 'S1', localFilePath: 'x' }, { bookId: 'S2', title: 'S2', localFilePath: 'y' }],
      getNotesByBookId: async (bookId) => [{ bookId, noteId: bookId + '-n', type: 0, highlightText: '文本 ' + bookId, createTime: 1700000000 }],
      getIndexGeneration: () => { callGen.n += 1; return callGen.n <= 2 ? 1 : 2; }, // 前两次报 1，之后报 2：模拟构建中途重建
    };
    const roamRace = createRoamingService({ index: stubIndex, store: stPool, log: () => {} });
    const pool = await roamRace.getCandidatePool({}, 'RACE');
    ok(pool.length === 2, `代际守卫：构建期重建→重试到稳定快照（池=${pool.length}，应为 2 而非部分数据）`);
  }
}

// 13.69 v1.1 路由守卫与 state 暴露（不触网：空 Key/未绑定直接 400）
r = await call('GET', '/weread/api/gateway/stats');
ok(r.status === 400 && r.payload.ok === false, 'v1.3 stats 未绑 Key 400（引导绑定）');
r = await call('GET', '/weread/api/gateway/search');
ok(r.status === 400, 'v1.3 search 未绑 Key/缺参 400');
out = await tool.execute({ action: 'stats' });
ok(out.includes('未绑定'), '工具 stats 未绑定给出引导语');
out = await tool.execute({ action: 'store', query: '三体' });
ok(out.includes('未绑定'), '工具 store 未绑定给出引导语');
out = await tool.execute({ action: 'recommend' });
ok(out.includes('未绑定'), '工具 recommend 未绑定给出引导语');
r = await call('POST', '/weread/api/login/apikey', { apiKey: '' });
ok(r.status === 400, 'apikey 登录空 Key 400');
r = await call('POST', '/weread/api/gateway/test', {});
ok(r.status === 400, 'gateway/test 未绑定 400');
r = await call('GET', '/weread/api/state');
ok(r.payload.gateway && r.payload.gateway.enabled === false && r.payload.gateway.skillVersion === '1.0.5', 'state 含 gateway 状态（未绑定+版本）');

// 13.6955 v1.5 单例阅读窗口（lib/readerWindow.js，全假依赖：不拉真 Chrome）
{
  const rwDir = path.join(tmp, 'rw');
  fs.mkdirSync(rwDir, { recursive: true });
  const calls = { launch: 0, open: [], kill: [], ws: [], closed: [], sessions: 0 };
  // 假世界：launch 后 CDP 活；targets 可变模拟「窗口开关」；cookies 模拟 profile 登录态；bounds 可变模拟用户调整窗口
  const world = { alive: false, targets: [], url: 'https://weread.qq.com/web/reader/abc', cookies: [], pids: [], bounds: { left: 10, top: 20, width: 800, height: 600, windowState: 'normal' } };
  const tgt = (i) => ({ id: `T${i}`, type: 'page', url: world.url, webSocketDebuggerUrl: `ws://127.0.0.1:48113/devtools/page/T${i}` });
  const deps = {
    fetchJson: async (port, pathname) => {
      if (!world.alive) throw new Error('ECONNREFUSED');
      if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/b` };
      if (pathname === '/json/list') return world.targets;
      throw new Error('unexpected ' + pathname);
    },
    wsCall: async (wsUrl, commands) => {
      for (const c of commands) {
        const code = c.params?.source ?? c.params?.expression ?? '';
        const marker = code.includes('wr-readerbar') ? ':readerbar' : '';
        calls.ws.push(c.method + (c.params?.name ? `:${c.params.name}` : '') + (c.params?.url ? `:${c.params.url}` : '') + marker);
      }
      return commands.map((c, i) => ({ id: i + 1, result:
        c.method === 'Network.getCookies' ? { cookies: world.cookies }
        : c.method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: '1' }
        : c.method === 'Browser.getWindowForTarget' ? { windowId: 7, bounds: world.bounds }
        : {} }));
    },
    launchProcess: async (bin, args) => { calls.launch++; calls.lastArgs = args; world.alive = true; if (!world.targetsKeep) world.targets = [tgt(0)]; return { pid: 4242 }; },
    execOpen: async (args) => { calls.open.push(args); return { ok: true }; },
    listPids: async () => world.pids,
    killPid: (pid) => { calls.kill.push(pid); world.alive = false; },
    sleep: async () => { world.sleeps = (world.sleeps ?? 0) + 1; },
    closeTarget: async (port, id) => { calls.closed.push(id); },
    chromeExecutable: () => '/fake/Chrome',
    timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 15, injectWatch: 15, jamWatch: 15 },
  };
  const rw = createReaderWindow({ stateDir: rwDir, log: () => {}, getCookies: () => 'wr_vid=1; wr_skey=2; other=x', deps });

  let res = await rw.open('https://weread.qq.com/web/reader/abc');
  ok(res.ok && res.mode === 'reader-window' && calls.launch === 1, 'v1.5 首次打开=tier1 拉起单例窗口');
  ok(calls.lastArgs.some((a) => a.startsWith('--app=https://weread.qq.com/web/reader/abc'))
    && calls.lastArgs.some((a) => a.startsWith('--remote-debugging-port='))
    && calls.lastArgs.some((a) => a.startsWith('--user-data-dir=')), '拉起参数含 --app/--remote-debugging-port/--user-data-dir（专用 profile）');
  const boot = rw._internal.BOOTSTRAP_SCRIPT;
  new Function(boot); // 语法编译守卫（防脚本字符串拼坏）
  ok(boot.includes('window.close = wrClose') && boot.includes('function close() { [native code] }') && boot.includes('wr-readerbar') && boot.includes('history.back()') && boot.includes('#home'), '注入脚本：护甲（含 nativeness 伪装，P2-28）+ 工具条四动作（后退/前进/刷新/回首页）');
  ok(/top = '0px'/.test(boot) && /right = '0px'/.test(boot), '工具条默认贴顶右上角（标题栏正下方）');
  ok(boot.includes("readyState === 'loading'") && boot.includes('__wrBarTimer'), '注入脚本等 DOM 就绪再挂载 + 自愈定时器单次注册');
  ok(calls.ws.includes('Runtime.evaluate:readerbar'), '首屏经 Runtime.evaluate 注入（无 addScript 注册、无域启用）');
  ok(!calls.ws.includes('Page.enable') && !calls.ws.includes('Network.enable') && !calls.ws.some((m2) => m2.startsWith('Page.addScriptToEvaluateOnNewDocument')), '零附着：不 enable 任何域、不注册任何脚本（工具条由扩展原生注入，页面无检视开销）');
  ok(calls.ws.some((m) => m.startsWith('Network.setCookie:wr_vid')) && calls.ws.some((m) => m.startsWith('Network.setCookie:wr_skey')), 'profile 无 Cookie 时注入 wr_vid/wr_skey');
  const st1 = JSON.parse(fs.readFileSync(path.join(rwDir, 'reader-window.json'), 'utf8'));
  ok(!!st1.port && st1.lastUrl.includes('reader/abc'), '状态文件记录端口与 lastUrl');

  res = await rw.open('https://weread.qq.com/web/reader/xyz');
  ok(res.ok && calls.launch === 1, '换书不重复拉起（单例复用，WebBar 同 panel 模型）');
  ok(calls.ws.includes('Page.navigate:https://weread.qq.com/web/reader/xyz'), '原窗口内 Page.navigate 到新书');
  ok(calls.ws.includes('Page.bringToFront'), '复用时置前窗口');
  ok(!calls.ws.includes('Network.enable'), '安静附着：不启用 Network 域（避免调试插桩拖慢 Service Worker 导航）');
  world.targets = [{ id: 'OMX', type: 'page', url: 'chrome://omnibox-popup.top-chrome/', webSocketDebuggerUrl: 'ws://127.0.0.1:48113/devtools/page/OMX' }, tgt(0)];
  {
    const launchBefore = calls.launch, closedBefore = calls.closed.length;
    res = await rw.open('https://weread.qq.com/web/reader/xyz');
    ok(res.ok && calls.launch === launchBefore && calls.closed.length === closedBefore, 'chrome:// 内部目标不算窗口（不误判多窗、不误关）');
  }
  // v1.7.0 注入守护：URL 变化（模拟新文档/SPA 路由）→ 轮询周期内自动补注入（真定时器等待）
  {
    const injBefore = calls.ws.filter((m) => m === 'Runtime.evaluate:readerbar').length;
    world.url = 'https://weread.qq.com/web/reader/next'; // 模拟新文档（URL 变化）
    world.targets = [tgt(0)]; // tgt() 读 world.url，需重建目标对象
    await new Promise((r2) => setTimeout(r2, 90)); // injectWatch=15ms，等几个周期
    ok(calls.ws.filter((m) => m === 'Runtime.evaluate:readerbar').length > injBefore, '注入守护：URL 变化后自动补注入（常态零附着）');
  }

  const setCookiesBefore = calls.ws.filter((m) => m.startsWith('Network.setCookie')).length;
  world.cookies = [{ name: 'wr_skey', value: 'fresh', expires: Math.floor(Date.now() / 1000) + 86400 }]; // 窗内会话在期
  await rw.open('https://weread.qq.com/web/reader/xyz');
  ok(calls.ws.filter((m) => m.startsWith('Network.setCookie')).length === setCookiesBefore, '窗口 wr_skey 在期跳过注入（不覆盖窗内新会话）');

  const reInjectBefore = calls.ws.filter((m) => m.startsWith('Network.setCookie')).length;
  world.cookies = [{ name: 'wr_skey', value: 'stale', expires: 1000 }]; // 窗内 skey 已过期
  await rw.open('https://weread.qq.com/web/reader/xyz');
  ok(calls.ws.filter((m) => m.startsWith('Network.setCookie')).length > reInjectBefore, '窗口 wr_skey 过期→自动重注入插件凭据（免扫码复活）');
  world.cookies = [];

  world.targets = []; // 用户关了窗口（实例还在、CDP 活）
  const killBefore = calls.kill.length;
  res = await rw.open('https://weread.qq.com/web/reader/xyz');
  ok(res.ok && res.mode === 'reader-window' && calls.kill.length === killBefore && calls.launch === 2, '窗口关后重开=复用既有实例（不清进程，同端口）');

  world.targets = [tgt(0), { ...tgt(1), id: 'T1', url: 'https://weread.qq.com/#home' }];
  await rw.open('https://weread.qq.com/web/reader/xyz');
  ok(calls.closed.includes('T1'), '多窗口收敛：多余的页面目标被关闭');

  world.alive = false; world.targets = []; world.pids = [999]; // 实例死透但有僵尸进程
  res = await rw.open('https://weread.qq.com/web/reader/xyz');
  ok(res.ok && calls.kill.includes(999), '僵尸实例被清理后重拉');

  const d = await rw.diagnose();
  ok(d.chromeFound === true && d.cdpAlive === true && d.windowAlive === true, 'diagnose 报告 Chrome/CDP/窗口存活');
  ok(d.bounds && d.bounds.width === 800 && d.bounds.left === 10, 'diagnose 带回记忆的窗口 bounds');

  // 窗口位置大小记忆（v1.5.3）：实例死透后重新拉起 → 还原 bounds 且不再传 --window-size
  const restoreBefore = calls.ws.filter((m) => m === 'Browser.setWindowBounds').length;
  world.alive = false; world.targets = []; world.pids = [];
  res = await rw.open('https://weread.qq.com/web/reader/xyz');
  ok(res.ok && calls.ws.filter((m) => m === 'Browser.setWindowBounds').length === restoreBefore + 1, '重新拉起时还原记忆的位置大小（setWindowBounds）');
  ok(!calls.lastArgs.includes('--window-size=1240,900'), '有记忆 bounds 后不再传 --window-size（不覆盖还原值）');

  // v1.5.4 bounds 守护：阅读期间（无任何点击/关窗动作）调整窗口 → 周期内自动记忆
  world.bounds = { left: 99, top: 88, width: 700, height: 500, windowState: 'normal' };
  await new Promise((r) => setTimeout(r, 90)); // boundsWatch=15ms，等几个守护周期（真定时器）
  const stB = JSON.parse(fs.readFileSync(path.join(rwDir, 'reader-window.json'), 'utf8'));
  ok(stB.bounds && stB.bounds.width === 700 && stB.bounds.left === 99, 'bounds 守护：阅读中调整窗口即被记忆（修复 1.5.3 只在 open/close 时捕获的缺陷）');
  rw.dispose();
  const c = await rw.closeWindow();
  ok(c.ok === true, 'closeWindow 走通（Browser.close）');

  // 拉起彻底失败 → 唯一兜底 = Chrome 同窗口页签（绝不用默认浏览器）
  const rwDir2 = path.join(tmp, 'rw2');
  fs.mkdirSync(rwDir2, { recursive: true });
  const opens2 = [];
  const rw2 = createReaderWindow({
    stateDir: rwDir2, log: () => {}, getCookies: () => undefined,
    deps: {
      ...deps,
      launchProcess: async () => { calls.launch++; return { pid: 1 }; }, // 拉了但 CDP 永远不活
      execOpen: async (args) => { opens2.push(args); return { ok: true }; },
      listPids: async () => [],
    },
  });
  res = await rw2.open('https://weread.qq.com/web/reader/abc');
  ok(res.ok && res.mode === 'chrome-tab' && res.fallback === true, '拉起彻底失败→回落 Chrome 页签（非默认浏览器）');
  ok(opens2.some((a) => a[0] === '-a' && a[a.length - 1] === 'https://weread.qq.com/web/reader/abc'), '兜底用 open -a Chrome 打开目标 URL');

  // 无 Chrome → 明确报错，不开任何浏览器
  const rw3 = createReaderWindow({ stateDir: path.join(tmp, 'rw3'), deps: { ...deps, chromeExecutable: () => null } });
  res = await rw3.open('https://weread.qq.com/web/reader/abc');
  ok(res.ok === false && res.mode === 'no-chrome', '无 Chrome 时明确报错（不用默认浏览器）');

  // 回归（1.5.1 线上 bug）：不注入 chromeExecutable 时默认实现必须是「函数」且可调用
  // （曾误写成 IIFE → 变量成字符串，open() 抛 chromeExecutable is not a function）
  {
    const { chromeExecutable: _drop, ...depsNoChrome } = deps;
    world.alive = false; world.targets = []; world.pids = []; // 复位共享假世界
    const rw4 = createReaderWindow({
      stateDir: path.join(tmp, 'rw4'),
      deps: {
        ...depsNoChrome,
        launchProcess: async () => { world.alive = true; world.targets = [tgt(0)]; return { pid: 1 }; }, // 防真 spawn
        listPids: async () => [],
      },
    });
    ok(typeof rw4._internal.chromeExecutable === 'function', '默认 chromeExecutable 是函数（非 IIFE 字符串）');
    const bin = rw4._internal.chromeExecutable();
    ok(bin === null || typeof bin === 'string', `默认 chromeExecutable() 可调用 → ${String(bin)}`);
    const r4 = await rw4.open('https://weread.qq.com/web/reader/abc');
    if (bin) ok(r4.ok === true && r4.mode === 'reader-window', '默认解析路径下 open() 全链路无异常（本机有 Chrome → 单例窗口）');
    else ok(r4.ok === false && r4.mode === 'no-chrome', '默认解析路径下 open() 全链路无异常（本机无 Chrome → 明确报错）');
  }

  // v1.7.3 渲染 watchdog：连续 2 次探针失败 → 自愈（关页 + 重开）
  {
    const origWsCall = deps.wsCall;
    let failFirst = true; // 第一击探针失败，第二击（恢复期）正常
    const worldJam = world;
    worldJam.wsFailForProbe = true;
    const closedBefore = calls.closed.length;
    const launchBeforeJ = calls.launch;
    // 让探针（Runtime.evaluate expression '1'）失败，其余命令照常
    worldJam.probeFail = 0;
    const depsJam = { ...deps };
    depsJam.wsCall = async (wsUrl, commands) => {
      if (commands.length === 1 && commands[0].method === 'Runtime.evaluate' && commands[0].params?.expression === '1' && worldJam.probeFail < 2) {
        worldJam.probeFail += 1;
        throw new Error('evaluate timeout');
      }
      return origWsCall(wsUrl, commands);
    };
    depsJam.closeTarget = async (port, id) => { calls.closed.push(id); worldJam.targets = []; }; // 关页=目标消失
    const rwJam = createReaderWindow({ stateDir: rwDir, log: () => {}, getCookies: () => undefined, deps: depsJam });
    world.url = 'https://weread.qq.com/web/reader/jam'; world.targets = [tgt(0)];
    await rwJam.open('https://weread.qq.com/web/reader/jam');
    await new Promise((r2) => setTimeout(r2, 120)); // jamWatch=15ms：两击探针 + 自愈重开
    ok(calls.closed.length > closedBefore && calls.launch > launchBeforeJ, '渲染主线程无响应×2 → watchdog 自愈（关页重开）');
    rwJam.dispose();
  }


  // 路由守卫：非微信读书域名 400
  r = await call('POST', '/weread/api/open-reader', { url: 'https://evil.example.com/x' });
  ok(r.status === 400, 'open-reader 域名守卫 400');
}

// 13.72 v1.7.4 单元测试：readerWindow 纯函数 + watchdog/bounds/dispose 边界（独立假世界，不共享计数器）
{
  // --- 纯函数：buildArgs 参数组合 ---
  const rwUnit = createReaderWindow({ stateDir: path.join(tmp, 'rw-unit'), deps: {} });
  const a1 = rwUnit._internal.buildArgs('https://weread.qq.com/web/reader/x', 48113);
  ok(a1.includes('--window-size=1240,900') && a1.includes('--app=https://weread.qq.com/web/reader/x'), 'buildArgs 首次拉起带 --window-size/--app');
  ok(a1.includes('--disable-background-timer-throttling') && a1.includes('--disable-backgrounding-occluded-windows') && a1.includes('--disable-renderer-backgrounding'), 'buildArgs 恒带防冻结三件套');
  const a2 = rwUnit._internal.buildArgs('https://weread.qq.com/', 47834, { firstLaunch: false });
  ok(!a2.includes('--window-size=1240,900'), 'buildArgs 有记忆 bounds 后不带 --window-size');

  // --- 纯函数：parseCookieHeader 只认 weread 凭据前缀 ---
  const ph = rwUnit._internal.parseCookieHeader('wr_vid=1; wr_skey=2; rq=3; qq_header=4; other=x; =novalue; novalue=');
  ok(ph.map((c) => c.name).join(',') === 'wr_vid,wr_skey,rq,qq_header', 'parseCookieHeader 只留 wr_/rq/qq_ 前缀');
  ok(rwUnit._internal.parseCookieHeader(undefined).length === 0 && rwUnit._internal.parseCookieHeader('').length === 0, 'parseCookieHeader 空输入安全');
  const boot2 = rwUnit._internal.BOOTSTRAP_SCRIPT;
  ok(!/\)\(\);\s*;\s*inject\(\)/.test(boot2) && !boot2.trimEnd().endsWith('inject();'), '注入脚本结尾不再调用作用域外 inject()（原每次注入必抛 ReferenceError）');

  // --- 独立假世界 v2：可门控的 watchdog 自愈 sleep，用于确定性复现 dispose 竞态 ---
  const mkWorld = (dirName, port) => {
    const dir = path.join(tmp, dirName);
    fs.mkdirSync(dir, { recursive: true });
    const c = { launch: 0, closed: [], methods: [], ws: 0 };
    const w = { alive: false, targets: [], url: `https://weread.qq.com/web/reader/${dirName}`, cookies: [], bounds: { left: 5, top: 6, width: 900, height: 700, windowState: 'normal' }, probeFailRemaining: 0 };
    const t = (i) => ({ id: `P${i}`, type: 'page', url: w.url, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/P${i}` });
    let jamWaiters = null; // 门控：watchdog 自愈 sleep(1500) 挂起等待放行
    const depsX = {
      fetchJson: async (p, pathname) => {
        c.fetchN = (c.fetchN || 0) + 1;
        if (!w.alive) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return w.targets;
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (wsUrl, commands) => {
        c.ws++;
        c.liveNow = (c.liveNow || 0) + 1;
        c.maxLive = Math.max(c.maxLive || 1, c.liveNow);
        try {
          if (w.evalDelayMs && commands.some((cmd) => cmd.method === 'Runtime.evaluate' && cmd.params?.expression?.includes('wr-readerbar'))) {
            c.evalLive = (c.evalLive || 0) + 1;
            c.maxEvalLive = Math.max(c.maxEvalLive || 1, c.evalLive);
            try { await new Promise((r3) => setTimeout(r3, w.evalDelayMs)); } // 模拟页面卡顿：注入 evaluate 慢
            finally { c.evalLive -= 1; }
          }
          for (const cmd of commands) {
            c.methods.push(cmd.method
              + (cmd.params?.expression?.includes('wr-readerbar') ? ':bar' : cmd.params?.expression === '1' ? ':probe' : ''));
            if (cmd.method === 'Browser.close') { w.alive = false; w.targets = []; }
            if (cmd.method === 'Runtime.evaluate' && cmd.params?.expression === '1' && w.probeFailRemaining > 0) {
              w.probeFailRemaining -= 1;
              throw new Error('evaluate timeout'); // 模拟渲染主线程假死
            }
          }
          return commands.map((cmd, i) => ({ id: i + 1, result:
            cmd.method === 'Network.getCookies' ? { cookies: w.cookies }
            : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 9, bounds: w.bounds }
            : {} }));
        } finally { c.liveNow -= 1; }
      },
      launchProcess: async () => { c.launch += 1; w.alive = true; w.targets = [t(0)]; return { pid: 6000 + c.launch }; },
      execOpen: async () => ({ ok: false, error: 'no-open' }),
      listPids: async () => [],
      killPid: () => {},
      syncKill: () => false, // v1.7.18：不真调 ps（dispose 的退出兜底走这里，恒不命中）
      sleep: async (ms) => { if (ms === 1500 && jamWaiters) { await new Promise((r2) => jamWaiters.push(r2)); } },
      closeTarget: async (p2, id) => { c.closed.push(id); w.targets = []; },
      chromeExecutable: () => '/fake/Chrome',
      timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 40, injectWatch: 40, jamWatch: 30 },
    };
    return { dir, c, w, depsX, holdJamSleep: () => { jamWaiters = []; }, releaseJamSleep: () => { (jamWaiters ?? []).forEach((r2) => r2()); jamWaiters = null; } };
  };
  // --- watchdog 单击恢复：1 次探针失败后恢复 → 不触发自愈 ---
  {
    const { dir, c, w, depsX } = mkWorld('rw-sr', 47850);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open(w.url);
    w.probeFailRemaining = 1; // 只失败 1 次（<2 击）
    await new Promise((r2) => setTimeout(r2, 130)); // jamWatch=30ms：数个周期
    ok(c.closed.length === 0 && c.launch === 1, 'watchdog 单次探针失败后恢复 → 不自愈（strike 复位）');
    rw.dispose();
  }

  // --- dispose 竞态：自愈走到关页等待期时宿主退出 → 不得复活窗口 ---
  {
    const { dir, c, w, depsX, holdJamSleep, releaseJamSleep } = mkWorld('rw-race', 47851);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open(w.url);
    holdJamSleep(); // 让自愈路径的 sleep(1500) 挂起
    w.probeFailRemaining = 2; // 连续 2 击 → 进入自愈：closeTarget → sleep(1500) 挂起
    await new Promise((r2) => setTimeout(r2, 100)); // 等两击+进入等待
    ok(c.closed.length === 1, '自愈已关页并进入重开等待（sleep 挂起）');
    rw.dispose(); // 宿主此刻退出（清定时器 + Browser.close）
    await new Promise((r2) => setTimeout(r2, 30));
    const launchAtDispose = c.launch;
    releaseJamSleep(); // 放行被挂起的自愈回调
    await new Promise((r2) => setTimeout(r2, 80));
    ok(c.launch === launchAtDispose, `dispose 后在飞的自愈不复活窗口（launch=${c.launch}）`);
  }

  // --- dispose 后全部守护定时器停摆（无残留轮询） ---
  {
    const { dir, c, w, depsX } = mkWorld('rw-quite', 47852);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open(w.url);
    await new Promise((r2) => setTimeout(r2, 90)); // 守护跑起来 + dispose 异步收尾完成
    rw.dispose();
    await new Promise((r2) => setTimeout(r2, 50));
    const wsAfterDispose = c.ws, methodsAfter = c.methods.length;
    await new Promise((r2) => setTimeout(r2, 160)); // 4 个周期无任何新调用 → 定时器确已全清
    ok(c.ws === wsAfterDispose && c.methods.length === methodsAfter, 'dispose 后 inject/bounds/jam 守护全部停摆');
  }

  // --- bounds 守护变更才写盘（同 bounds 周期静默，变化即记忆） ---
  {
    const { dir, c, w, depsX } = mkWorld('rw-bw', 47853);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open(w.url);
    await new Promise((r2) => setTimeout(r2, 110)); // open 捕获 + 首个守护周期落盘
    const sf = path.join(dir, 'reader-window.json');
    const stable = fs.readFileSync(sf, 'utf8');
    await new Promise((r2) => setTimeout(r2, 140)); // boundsWatch=40ms：多个周期 bounds 未变
    ok(fs.readFileSync(sf, 'utf8') === stable, 'bounds 未变周期不重复写盘（含 updatedAt 不动）');
    w.bounds = { left: 77, top: 88, width: 640, height: 480, windowState: 'normal' };
    await new Promise((r2) => setTimeout(r2, 110));
    const after = JSON.parse(fs.readFileSync(sf, 'utf8'));
    ok(after.bounds && after.bounds.width === 640 && after.bounds.left === 77, 'bounds 变化后周期内记忆新值');
    rw.dispose();
  }

  // --- 并发 open 串行化 + 同 URL 不重导航 ---
  {
    const { dir, c, w, depsX } = mkWorld('rw-conc', 47854);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    const [r1, r2] = await Promise.all([rw.open(w.url), rw.open(w.url)]);
    ok(r1.ok && r2.ok && c.launch === 1, '并发 open 串行化：只拉起一次');
    const navCount = () => c.methods.filter((m) => m === 'Page.navigate').length;
    const navAfterOpen = navCount(); // 首次 open 也可能 0 次（同 URL 不导航）
    await rw.open(w.url); // 再次同 URL
    ok(navCount() === navAfterOpen, '同 URL 复用不重导航（保滚动位置）');
    await rw.open('https://weread.qq.com/web/reader/other'); // 换书
    ok(navCount() === navAfterOpen + 1, '换书才导航一次');
    rw.dispose();
  }

  // --- v1.7.4 审查修复①：用户关窗后守护自动停摆（原：三定时器空转到 DSH 退出，≈158k HTTP/天） ---
  {
    const { dir, c, w, depsX } = mkWorld('rw-stop', 47855);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open(w.url);
    await new Promise((r2) => setTimeout(r2, 120)); // 守护跑起来
    ok(c.fetchN > 0, '守护运行中（探测计数 > 0）');
    w.targets = []; // 用户红钮关窗（Chrome 实例还在）
    await new Promise((r2) => setTimeout(r2, 350)); // 连续缺席 ≥5 轮 → 自动停摆
    const f0 = c.fetchN;
    await new Promise((r2) => setTimeout(r2, 200));
    ok(c.fetchN === f0, `关窗后守护自动停摆（200ms 内新增探测 ${c.fetchN - f0} 次）`);
    const res = await rw.open(w.url); // 再开书：reopen + 守护重启
    ok(res.ok && c.launch === 2, '停摆后再 open 正常重开（同实例 reopen）');
    await new Promise((r2) => setTimeout(r2, 120));
    ok(c.fetchN > f0, 'open 后守护重启（探测恢复）');
    rw.dispose();
    await new Promise((r2) => setTimeout(r2, 30));
  }

  // --- v1.7.4 审查修复①b：closeWindow 主动停摆 ---
  {
    const { dir, c, depsX } = mkWorld('rw-cw', 47856);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open('https://weread.qq.com/web/reader/cw');
    await new Promise((r2) => setTimeout(r2, 90));
    await rw.closeWindow(); // Browser.close（wsCall 置 alive=false）
    await new Promise((r2) => setTimeout(r2, 80)); // 收尾余波
    const f0 = c.fetchN;
    await new Promise((r2) => setTimeout(r2, 200));
    ok(c.fetchN === f0, 'closeWindow 后守护立即停摆');
    rw.dispose();
  }

  // --- v1.7.4 审查修复②：守护防重入（慢 evaluate 期间不叠并发注入） ---
  {
    const { dir, c, w, depsX } = mkWorld('rw-busy', 47857);
    w.evalDelayMs = 120; // 注入 evaluate 慢 120ms（模拟重页面/接近卡顿）
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open(w.url);
    await new Promise((r2) => setTimeout(r2, 60));
    const barBefore = c.methods.filter((m) => m === 'Runtime.evaluate:bar').length;
    w.url = 'https://weread.qq.com/web/reader/busy2'; // 新文档（URL 变化）
    w.targets = [{ id: 'P0', type: 'page', url: w.url, webSocketDebuggerUrl: 'ws://127.0.0.1:47857/devtools/page/P0' }];
    await new Promise((r2) => setTimeout(r2, 1600)); // injectWatch=40ms：无防重入将叠 3+ 轮；P2-22 后 probe 有 700ms 成功缓存，窗口放宽到 ≥1.6s
    const barAfter = c.methods.filter((m) => m === 'Runtime.evaluate:bar').length;
    ok((c.maxEvalLive || 0) === 1, `防重入：慢注入期间并发 evaluate 峰值=1（max=${c.maxEvalLive}）`);
    ok(barAfter === barBefore + 1, `同一文档只注入一次（新增 ${barAfter - barBefore} 次）`);
    rw.dispose();
  }

  // --- v1.7.4 审查修复③：自愈进行中不叠加第二轮（恢复链可超 20s 周期） ---
  {
    const { dir, c, w, depsX, holdJamSleep, releaseJamSleep } = mkWorld('rw-overlap', 47858);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    await rw.open(w.url);
    holdJamSleep(); // 门控自愈重开等待
    w.probeFailRemaining = 9999; // 持续假死
    await new Promise((r2) => setTimeout(r2, 160)); // 两击 → 自愈：关页 + sleep 挂起
    ok(c.closed.length === 1, '自愈关页一次（进入重开等待）');
    await new Promise((r2) => setTimeout(r2, 150)); // 再过多个 jamWatch 周期
    ok(c.closed.length === 1 && c.launch === 1, `自愈进行中不叠加第二轮（closed=${c.closed.length}, launch=${c.launch}）`);
    w.probeFailRemaining = 0; // 探针恢复
    releaseJamSleep();
    await new Promise((r2) => setTimeout(r2, 150)); // 恢复完成：重开 + 注入
    ok(c.launch === 2 && c.methods.includes('Runtime.evaluate:bar'), '恢复完成后窗口重开 + 注入');
    rw.dispose();
    await new Promise((r2) => setTimeout(r2, 30));
  }
}

// 13.81 v1.7.18 退出兜底：'exit' 钩子 + 同步进程组击杀（宿主 5s 强退也带走 Chrome）
{
  const dir = path.join(tmp, 'rw-quit');
  fs.mkdirSync(dir, { recursive: true });
  const kills = [];
  const depsQ = {
    fetchJson: async () => { throw new Error('ECONNREFUSED'); },
    wsCall: async () => [{}],
    launchProcess: async () => ({ pid: 4242 }),
    execOpen: async () => ({ ok: false, error: 'no-open' }),
    listPids: async () => [],
    killPid: () => {},
    sleep: async () => {},
    syncKill: (pid) => { kills.push(pid); return true; },
    chromeExecutable: () => '/fake/Chrome',
    timeouts: { tier1: 10, tier2: 10, ready: 10, injectWatch: 100000, boundsWatch: 100000, jamWatch: 100000 },
  };
  const rwQ = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsQ });
  ok(process.listeners('exit').includes(rwQ._internal.exitKillAll), "'exit' 兜底钩子已注册（进程级，整个进程仅一次）");
  const r = await rwQ.open('https://weread.qq.com/web/reader/quit1');
  ok(!r.ok && r.mode === 'no-chrome', '假世界拉不起窗口（fetchJson 全拒）——本节专测退出兜底');
  ok(rwQ._internal.ownedPids()[0] === 4242, 'tier1 spawn 后 ownedPids 已记录（CDP 未就绪也算：进程真实存在过；v1.8.10 多实例集合）');

  // v1.8.10：多账号 profile/state 隔离——getAccountId 变化 → scope 目录/文件随账号切换
  {
    const { createReaderWindow: crwMA } = await import('./lib/readerWindow.js');
    const dirMA = path.join(tmp, 'rw-multiacc');
    fs.mkdirSync(dirMA, { recursive: true });
    let accNow = '';
    const rwMA = crwMA({ stateDir: dirMA, log: () => {}, getAccountId: () => accNow, deps: {} });
    rwMA._internal.refreshAccountScope();
    const scopeNone = rwMA._internal.currentScope();
    ok(scopeNone.profileDir.endsWith('reader-profile') && scopeNone.stateFile.endsWith('reader-window.json'), '无账号场景沿用旧 profile/state 路径（存量兼容）');
    accNow = '111';
    rwMA._internal.refreshAccountScope();
    const scopeA = rwMA._internal.currentScope();
    accNow = '222';
    rwMA._internal.refreshAccountScope();
    const scopeB = rwMA._internal.currentScope();
    ok(scopeA.profileDir.endsWith('reader-profile-111') && scopeA.stateFile.endsWith('reader-window.111.json'), '账号 111 scope：reader-profile-111 / reader-window.111.json');
    ok(scopeB.profileDir.endsWith('reader-profile-222') && scopeB.stateFile.endsWith('reader-window.222.json'), '账号 222 scope：独立目录/文件（登录态隔离）');
    ok(scopeA.profileDir !== scopeB.profileDir && scopeA.stateFile !== scopeB.stateFile, '多账号 profile/state 互不冲突');
    rwMA.dispose();
  }
  ok(rwQ._internal.killOwnedSync('test') === true && kills.includes(4242), 'killOwnedSync 同步击杀（经身份核验钩子）');
  const liveAtDispose = rwQ._internal.liveKillCount();
  rwQ.dispose();
  ok(kills.length === 2 && kills.every((k) => k === 4242), 'dispose 同步先杀进程组（不等异步 CDP 往返）');
  ok(rwQ._internal.liveKillCount() === liveAtDispose - 1, 'dispose 后从 liveKills 摘除（防插件重载监听泄漏）');
}

// 13.82 v1.7.18 Cookie 过期裁决：注入前先问服务端——死凭据不注入，open 结果带 loginExpired
{
  const mkExp = (dirName, port, checkSession) => {
    const dir = path.join(tmp, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'reader-window.json'), JSON.stringify({ port }));
    const setCookies = [];
    const now = Date.now() / 1000;
    const deps = {
      fetchJson: async (p, pathname) => {
        if (p !== port) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return [{ id: 'P0', type: 'page', url: 'https://weread.qq.com/web/reader/exp1', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/P0` }];
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (u, commands) => commands.map((cmd, i) => ({ id: i + 1, result:
        cmd.method === 'Network.getCookies' ? { cookies: [{ name: 'wr_skey', value: 'dead-old', expires: now - 9999 }, { name: 'wr_vid', value: 'v1', expires: now - 9999 }] }
        : cmd.method === 'Network.setCookie' ? (setCookies.push(cmd.params.name), { success: true })
        : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 9, bounds: { left: 1, top: 2, width: 900, height: 700 } }
        : {} })),
      checkSession,
      launchProcess: async () => ({ pid: 900 }),
      execOpen: async () => ({ ok: false, error: 'no-open' }),
      listPids: async () => [],
      killPid: () => {},
      sleep: async () => {},
      syncKill: () => false,
      chromeExecutable: () => '/fake/Chrome',
      timeouts: { tier1: 10, tier2: 10, ready: 10, injectWatch: 100000, boundsWatch: 100000, jamWatch: 100000 },
    };
    return { dir, deps, setCookies };
  };
  const expUrl = 'https://weread.qq.com/web/reader/exp1';
  // A：窗内 skey 日期已死 + 插件凭据服务端也死 → 不注入、带 loginExpired（客户端 toast 引导重扫）
  {
    const { dir, deps, setCookies } = mkExp('rw-exp-a', 47890, async () => false);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => 'wr_vid=v1; wr_skey=dead-mine', deps });
    const r = await rw.open(expUrl);
    ok(r.ok && r.mode === 'reader-window' && r.loginExpired === true, 'A：凭据判死 → 窗口照开但带 loginExpired');
    ok(setCookies.length === 0, 'A：死凭据零注入（Network.setCookie 未调用）');
    rw.dispose();
  }
  // B：窗内日期死 + 插件凭据裁决为活 → 原行为注入换血
  {
    const { dir, deps, setCookies } = mkExp('rw-exp-b', 47891, async () => true);
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => 'wr_vid=v1; wr_skey=live-mine', deps });
    const r = await rw.open(expUrl);
    ok(r.ok && !('loginExpired' in r), 'B：凭据活着 → 正常注入换血，无 loginExpired 字段');
    ok(setCookies.join(',') === 'wr_vid,wr_skey', `B：注入插件凭据（${setCookies.join(',')}）`);
    rw.dispose();
  }
  // C：裁决通道网络异常（undefined）→ 不裁决维持原行为，不误报 loginExpired
  {
    const { dir, deps, setCookies } = mkExp('rw-exp-c', 47892, async () => { throw new Error('net'); });
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => 'wr_vid=v1; wr_skey=maybe', deps });
    const r = await rw.open(expUrl);
    ok(r.ok && setCookies.length === 2 && !('loginExpired' in r), 'C：裁决异常 → 保守注入（原行为）、无 loginExpired');
    rw.dispose();
  }
}

// 13.73 v1.7.4 单元测试：漫游池重试上限 / TTL 缓存 / 失效重建 + 索引代际稳定性
{
  const { createRoamingService } = await import('./lib/roaming.js');
  const { createIndexService } = await import('./lib/indexsvc.js');
  const { createStore: createStoreX } = await import('./lib/store.js');
  const storeStub = { getActiveAccountId: () => 'A', readAux: () => undefined, getState: () => undefined };

  // --- 代际永不稳定 → 重试有上限（3 次构建后放行，不死循环） ---
  {
    let qbCalls = 0, genCounter = 0;
    const stub = {
      queryBooks: async () => { qbCalls += 1; return [{ bookId: 'G1', title: 'g1', localFilePath: 'x' }]; },
      getNotesByBookId: async (id) => [{ bookId: id, noteId: id + '-n', type: 0, highlightText: 't', createTime: 1 }],
      getIndexGeneration: () => (genCounter += 1), // 每次读取都变：模拟重建永不停
    };
    const svc = createRoamingService({ index: stub, store: storeStub, log: () => {} });
    const pool = await svc.getCandidatePool({}, 'A');
    ok(pool.length === 1 && qbCalls === 3, `代际永不稳定→重试上限 3 次后放行（builds=${qbCalls}）`);
  }

  // --- TTL 内缓存命中 + invalidatePools 强制重建 ---
  {
    let qbCalls = 0;
    const stub = {
      queryBooks: async () => { qbCalls += 1; return [{ bookId: 'C1', title: 'c1', localFilePath: 'x' }]; },
      getNotesByBookId: async (id) => [{ bookId: id, noteId: id + '-n', type: 0, highlightText: 't', createTime: 1 }],
      getIndexGeneration: () => 7, // 稳定代际
    };
    const svc = createRoamingService({ index: stub, store: storeStub, log: () => {} });
    await svc.getCandidatePool({}, 'A');
    await svc.getCandidatePool({}, 'A');
    ok(qbCalls === 1, 'TTL 30s 内同 filter 池命中缓存（不重建）');
    svc.invalidatePools();
    await svc.getCandidatePool({}, 'A');
    ok(qbCalls === 2, 'invalidatePools 后缓存重建');
  }

  // --- v1.7.4 审查修复④：noteId→record 索引查表（原线性扫 O(笔记×记录) 实测 1.2s/次）语义不变 ---
  {
    const metaRaw = { version: 1, updatedAt: 1, records: { OLDKEY: { noteId: 'N1', favorite: true, favoriteAt: 123, updatedAt: 5 } } };
    const storeMeta = { getActiveAccountId: () => 'A', readAux: () => metaRaw, writeAux: () => {}, getState: () => undefined };
    const stub2 = {
      queryBooks: async () => [{ bookId: 'M1', title: 'm1', localFilePath: 'x' }],
      getNotesByBookId: async (id) => [{ bookId: id, noteId: 'N1', type: 0, highlightText: 't', createTime: 1 }],
      getIndexGeneration: () => 1,
    };
    const svc2 = createRoamingService({ index: stub2, store: storeMeta, log: () => {} });
    const pool2 = await svc2.getCandidatePool({ favoriteOnly: true }, 'A');
    ok(pool2.length === 1 && pool2[0].meta.favorite === true, 'noteId 索引命中旧 noteKey 收藏记录（O(1) 查表，语义与线性扫一致）');
  }

  // --- 索引代际：内容变化才自增；skipIfUnchanged 空转不自增（守卫不误触发重试） ---
  {
    const tmpGen = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-gen-'));
    const outGen = path.join(tmpGen, 'notes'); fs.mkdirSync(outGen, { recursive: true });
    const stGen = createStoreX(path.join(tmpGen, 'state'));
    const idx = createIndexService({ store: stGen, markdown: await import('./lib/markdown.js'), configGetter: () => ({ outputPath: outGen }), log: () => {} });
    const write = (name, title, bid, note) => fs.writeFileSync(path.join(outGen, name), `---\ntitle: ${title}\nbookid: ${bid}\n---\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> ${note}\n\n_记录时间：2026-11-01 10:00:00_\n`);
    ok(idx.getIndexGeneration('ACCT') === 0, '未知账号初始代际 0');
    write('a.md', '书A', 'GA1', '第一条');
    await idx.rebuildFromConfiguredPath('ACCT');
    const g1 = idx.getIndexGeneration('ACCT');
    ok(g1 === 1, '首次重建代际=1');
    await idx.rebuildFromConfiguredPath('ACCT', { skipIfUnchanged: true });
    ok(idx.getIndexGeneration('ACCT') === g1, '内容未变 skipIfUnchanged 不自增代际（fs.watch 空转不扰动守卫）');
    write('a.md', '书A', 'GA1', '第一条（改）');
    await idx.rebuildFromConfiguredPath('ACCT', { skipIfUnchanged: true });
    ok(idx.getIndexGeneration('ACCT') === g1 + 1, '内容变化 skipIfUnchanged 仍自增代际');
    fs.rmSync(tmpGen, { recursive: true, force: true });
  }
}

// 13.83 v1.8.18 端口分区/双栈探测/越界拒复用/垂死实例清理
// 真机事故：两账号实例同分到 48113（IPv4/IPv6 分占双栈），probe 只探 v4 → 复用/重开/清理
// 互相劫持 → tier1/2 全败 → 兜底 open -a Chrome = 浏览器页签（用户点击悬浮球复现）。
{
  const { createReaderWindow: crw } = await import('./lib/readerWindow.js');
  const { portRangeFor } = crw({ stateDir: '/tmp/wr-nonexist-833', log: () => {}, deps: { fetchJson: async () => { throw 0; } } })._internal;
  const A = '2100000001', B = '2100000002'; // 端口分区回归（账号已脱敏为假 ID）
  const [rA, rB] = [portRangeFor(A), portRangeFor(B)];
  ok(rA !== rB, `事故账号端口区不重叠（${A}→${rA}..${rA + 7}，${B}→${rB}..${rB + 7}）`);
  ok(Math.abs(rA - rB) >= 8, '两区至少隔一个完整区宽（8 端口），区内扫描不可能互相踩号');

  // 双栈 probe：v4 拒答、v6 应答 → ok；双栈全拒 → !ok
  {
    const dir = path.join(tmp, 'rw-v6');
    fs.mkdirSync(dir, { recursive: true });
    const seenHosts = [];
    const rw = crw({
      stateDir: dir, log: () => {},
      deps: {
        fetchJson: async (p, pathname, host) => {
          seenHosts.push(host);
          if (host !== '[::1]') throw new Error('ECONNREFUSED');
          if (pathname === '/json/version') return { Browser: 'Chrome/157.0.0.0', webSocketDebuggerUrl: 'ws://[::1]:47999/devtools/browser/x' };
          if (pathname === '/json/list') return [{ id: 'P1', type: 'page', url: 'https://weread.qq.com/', webSocketDebuggerUrl: 'ws://[::1]:47999/devtools/page/P1' }];
          throw new Error('unexpected');
        },
      },
    });
    const p = await rw._internal.probe(47999);
    ok(p.ok === true && p.targets.length === 1, `双栈 probe：v4 拒答 v6 应答仍可达（hosts=${seenHosts.join(',')}）`);
    const rw2 = crw({ stateDir: dir, log: () => {}, deps: { fetchJson: async () => { throw new Error('refused'); } } });
    ok((await rw2._internal.probe(47000)).ok === false, '双栈全拒 → 端口不可达');
    rw.dispose(); rw2.dispose();
  }

  // 越界端口绝不复用：账号 B 的 state 记着 48113（A 区端口，且 48113 上有「活窗口」=A 的实例）
  // → open() 必须废弃该端口走 fresh，绝不 navigateExisting 别人的窗口
  {
    const dir = path.join(tmp, 'rw-foreign');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `reader-window.${B}.json`), JSON.stringify({ port: 48113, lastUrl: 'https://weread.qq.com/' }));
    const wsCommands = [];
    let spawnedPort = 0;
    const chromeAt = (p, pathname) => {
      if (pathname === '/json/version') return { Browser: 'Chrome/157.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
      return [{ id: 'T1', type: 'page', url: 'https://weread.qq.com/web/reader/new', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/T1` }];
    };
    const rw = crw({
      stateDir: dir, log: () => {}, getAccountId: () => B,
      deps: {
        fetchJson: async (p, pathname) => {
          if (p === 48113) return chromeAt(p, pathname); // 别人的活窗口（真实事故：A 的实例在 v4 应答）
          if (spawnedPort && p === spawnedPort) return chromeAt(p, pathname);
          throw new Error('ECONNREFUSED');
        },
        wsCall: async (u, commands) => { commands.forEach((c) => wsCommands.push(c.method)); return commands.map((c, i) => ({ id: i + 1, result: {} })); },
        launchProcess: async (bin, args) => { spawnedPort = Number(/--remote-debugging-port=(\d+)/.exec(args.join(' '))[1]); return { pid: 4321 }; },
        execOpen: async () => ({ ok: true }),
        checkSession: async () => true,
        listPids: async () => [],
        timeouts: { ready: 150, tier1: 150, tier2: 150 },
      },
    });
    const r = await rw.open('https://weread.qq.com/web/reader/abc');
    const stAfter = JSON.parse(fs.readFileSync(path.join(dir, `reader-window.${B}.json`), 'utf8'));
    ok(r.ok === true && r.mode === 'reader-window', `越界端口场景仍以专用窗口打开（mode=${r.mode}）`);
    ok(spawnedPort >= rB && spawnedPort < rB + 8, `fresh 落在本账号区（spawn=${spawnedPort}，区 ${rB}..${rB + 7}）`);
    ok(stAfter.port !== 48113, `state 已废弃越界端口（现为 ${stAfter.port}）`);
    ok(!wsCommands.includes('Page.navigate') && !wsCommands.includes('Target.createTarget'), '绝不导航别人的窗口（无 Page.navigate/Target.createTarget）');
    ok(!r.fallback, '不落浏览器页签兜底');
    rw.dispose();
  }

  // 垂死实例（CDP 应答但窗口已关 = 空 targets）不再被 P2-24 守卫 spared——单例锁持有者必须让位
  {
    const dir = path.join(tmp, 'rw-zombie');
    fs.mkdirSync(dir, { recursive: true });
    const inScopePort = portRangeFor(A); // 48113..（恰含事故端口；A 区内即可）
    fs.writeFileSync(path.join(dir, `reader-window.${A}.json`), JSON.stringify({ port: inScopePort }));
    const killed = [];
    let revived = false;
    const rw = crw({
      stateDir: dir, log: () => {}, getAccountId: () => A,
      deps: {
        fetchJson: async (p, pathname) => {
          if (p !== inScopePort) throw new Error('ECONNREFUSED');
          if (pathname === '/json/version') return { Browser: 'Chrome/157.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
          // list：僵尸阶段空 targets；被杀后（模拟重拉）出现窗口
          return revived ? [{ id: 'T2', type: 'page', url: 'https://weread.qq.com/', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/T2` }] : [];
        },
        wsCall: async (u, commands) => commands.map((c, i) => ({ id: i + 1, result: {} })),
        launchProcess: async () => ({ pid: 5555 }),
        execOpen: async () => ({ ok: true }),
        checkSession: async () => true,
        listPids: async () => [777],
        killPid: (pid) => { killed.push(pid); revived = true; },
        sleep: async () => {},
        timeouts: { ready: 120, tier1: 120, tier2: 120 },
      },
    });
    const r = await rw.open('https://weread.qq.com/');
    ok(killed.includes(777), `空 targets 垂死实例被清理（killed=${killed.join(',')}）`);
    ok(r.ok === true, `清理后 fresh 拉起成功（mode=${r.mode}）`);
    rw.dispose();
  }
}

// 13.84 v1.8.19 关窗即退实例：窗口关闭（targets 空）连续缺席 → Browser.close 优雅退出 +
// SIGTERM 兜底 + state 摘端口——独立 profile Chrome 不再常驻程序坞（真机反馈图标滞留）
{
  const { createReaderWindow: crw } = await import('./lib/readerWindow.js');
  const dir = path.join(tmp, 'rw-dock-quit');
  fs.mkdirSync(dir, { recursive: true });
  const acc = '2100000001';
  const inScope = 48113; // 该账号区内首个端口
  let windowOpen = false;
  let instanceAlive = false;
  const wsMethods = [];
  const rw = crw({
    stateDir: dir, log: () => {}, getAccountId: () => acc,
    deps: {
      fetchJson: async (p, pathname) => {
        if (!instanceAlive || p !== inScope) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/157.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return windowOpen
          ? [{ id: 'T1', type: 'page', url: 'https://weread.qq.com/web/reader/x', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/T1` }]
          : [];
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (u, commands) => {
        commands.forEach((c) => { wsMethods.push(c.method); if (c.method === 'Browser.close') { windowOpen = false; instanceAlive = false; } });
        return commands.map((c, i) => ({ id: i + 1, result: {} }));
      },
      launchProcess: async (bin, args) => {
        if (Number(/--remote-debugging-port=(\d+)/.exec(args.join(' '))[1]) === inScope) { instanceAlive = true; windowOpen = true; }
        return { pid: 777 };
      },
      execOpen: async () => ({ ok: true }),
      checkSession: async () => true,
      listPids: async () => [777],
      killPid: () => {},
      sleep: async () => {},
      timeouts: { ready: 120, tier1: 120, tier2: 120, boundsWatch: 25, injectWatch: 25, jamWatch: 200 },
    },
  });
  const r = await rw.open('https://weread.qq.com/web/reader/x');
  ok(r.ok === true && r.mode === 'reader-window', `开窗成功（mode=${r.mode}）`);
  ok(!wsMethods.includes('Browser.close'), '窗口在场期间绝不退出实例');
  windowOpen = false; // 用户关闭窗口（实例仍在：CDP 应答、targets 空）
  await new Promise((res) => setTimeout(res, 900)); // 守护缺席 5 轮（25ms×多循环）→ 退出流程（sleep 即时）
  ok(wsMethods.includes('Browser.close'), '窗口关闭后实例被优雅退出（Browser.close）');
  const st = JSON.parse(fs.readFileSync(path.join(dir, `reader-window.${acc}.json`), 'utf8'));
  ok(!('port' in st), `state 已摘除端口（程序坞图标随窗消失；下次 open 重新拉起）keys=${Object.keys(st).join(',')}`);
  rw.dispose();
}

// 13.85 v1.8.20 关窗即退出可配置：开关关闭时回到「实例常驻待 reopen」——关窗不退出、端口保留
{
  const { createReaderWindow: crw } = await import('./lib/readerWindow.js');
  const dir = path.join(tmp, 'rw-dock-keep');
  fs.mkdirSync(dir, { recursive: true });
  const acc = '2100000001';
  const inScope = 48113;
  let windowOpen = false;
  let instanceAlive = false;
  const wsMethods = [];
  const rw = crw({
    stateDir: dir, log: () => {}, getAccountId: () => acc,
    deps: {
      quitOnClose: () => false, // 设置关闭：实例常驻
      fetchJson: async (p, pathname) => {
        if (!instanceAlive || p !== inScope) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/157.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return windowOpen
          ? [{ id: 'T1', type: 'page', url: 'https://weread.qq.com/web/reader/x', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/T1` }] : [];
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (u, commands) => { commands.forEach((c) => wsMethods.push(c.method)); return commands.map((c, i) => ({ id: i + 1, result: {} })); },
      launchProcess: async (bin, args) => {
        if (Number(/--remote-debugging-port=(\d+)/.exec(args.join(' '))[1]) === inScope) { instanceAlive = true; windowOpen = true; }
        return { pid: 778 };
      },
      execOpen: async () => ({ ok: true }),
      checkSession: async () => true,
      listPids: async () => [778],
      killPid: () => {},
      sleep: async () => {},
      timeouts: { ready: 120, tier1: 120, tier2: 120, boundsWatch: 25, injectWatch: 25, jamWatch: 200 },
    },
  });
  const r = await rw.open('https://weread.qq.com/web/reader/x');
  ok(r.ok === true && r.mode === 'reader-window', `开窗成功（mode=${r.mode}）`);
  windowOpen = false; // 用户关窗（实例仍在）
  await new Promise((res) => setTimeout(res, 800));
  ok(!wsMethods.includes('Browser.close'), '设置关闭时：关窗不退出实例（常驻待 reopen）');
  const st = JSON.parse(fs.readFileSync(path.join(dir, `reader-window.${acc}.json`), 'utf8'));
  ok(st.port === inScope, `state 保留端口（reopen 快开路径可用，port=${st.port}）`);
  rw.dispose();
}

// 13.74 v1.7.4 路由级回归：漫游 stale 会话自动重载（「1/1 切标签才变 1/58」接线层闭环）
{
  let rr = await call('GET', '/weread/api/roaming/session');
  const before = rr.payload.statsPoolSize;
  fs.writeFileSync(path.join(outDir, 'zz-stale-heal.md'), '---\ntitle: 自愈书\nbookid: ZHEAL1\n---\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 自愈验证条目\n\n_记录时间：2026-11-07 10:00:00_\n');
  await call('GET', '/weread/api/bookshelf?refresh=1'); // 触发索引重建 → invalidatePools → 会话标记过期
  rr = await call('GET', '/weread/api/roaming/session');
  ok(rr.payload.statsPoolSize === before + 1, `stale 会话视图自动重载（${before}→${rr.payload.statsPoolSize}，无需切标签/手动刷新）`);
  // v1.7.4 审查修复⑤：getSearchableMap 此前被引用但从未定义（ReferenceError 被吞 → 预筛从未生效），现为真实现
  out = await tool.execute({ action: 'search', query: '自愈验证' });
  ok(out.includes('自愈书') || out.includes('自愈验证条目'), '搜索预筛缓存生效：笔记文本命中（getSearchableMap 真实现不抛错）');
}

// 13.75 v1.7.4 路由级回归：open-reader 503 / diagnose / close（readerDeps 注入，不拉真 Chrome）
{
  const regRW = { web: [], tools: [] };
  const ctxRW = { effect: (fn) => { fn(); return () => {}; }, inject: () => () => {}, webServer: { register: (x) => regRW.web.push(x) }, tools: { register: (x) => regRW.tools.push(x) } };
  const disposeRW = apply(ctxRW, { stateDir: path.join(tmp, 'state-rw-route'), outputPath: '', apiToken: SMOKE_TOKEN, readerDeps: { chromeExecutable: () => null } });
  const routeRW = regRW.web.find((x) => x.path === '/weread');
  // v1.9.11：隔离 stateDir 场景有独立自签 token——种子重取（局部持有，不动主场景 API_TOKEN）
  await call('GET', '/weread/api/state', null, routeRW, 'Bearer stale-rw');
  const rwToken = JSON.parse(fs.readFileSync(path.join(tmp, 'state-rw-route', 'endpoint.json'), 'utf8')).token;
  const rwAuth = `Bearer ${rwToken}`;
  let rq = await call('POST', '/weread/api/open-reader', { url: 'https://weread.qq.com/web/reader/route' }, routeRW, rwAuth);
  ok(rq.status === 503 && rq.payload.ok === false && rq.payload.mode === 'no-chrome', 'open-reader 无 Chrome → 503 + mode=no-chrome（不用默认浏览器）');
  rq = await call('GET', '/weread/api/open-reader/diagnose', undefined, routeRW, rwAuth);
  ok(rq.status === 200 && rq.payload.chromeFound === false && rq.payload.windowAlive === false, 'diagnose 路由返回自检结构');
  rq = await call('POST', '/weread/api/open-reader/close', {}, routeRW, rwAuth);
  ok(rq.status === 200 && rq.payload.ok === false, 'close 路由：窗口未运行时 ok=false 不误报');
  disposeRW();
}

// 13.76 v1.7.5 书评回读：## 书评 区块 → type-4 笔记（详情页/漫游可见；不双写、noteId 稳定）
{
  const mdLib2 = await import('./lib/markdown.js');
  const rvBook = { bookId: 'RVB1', rawBookId: 'RVB1', title: '书评往返书', author: 'A', category: '科技', progress: 10, noteCount: 1, pcUrl: 'https://x' };
  const rvNotes = [{ noteId: 'a', type: 1, chapterTitle: '章一', highlightText: '一条划线', createTime: 1700000000 }];
  const md1 = mdLib2.renderBookMarkdown(rvBook, rvNotes, { review: { content: '这是我的整本书评\n\n第二段' } });
  const back1 = mdLib2.parseBookMarkdownContent(md1, '/tmp/rv1.md');
  const reviewNotes = (back1?.notes ?? []).filter((n) => n.type === 4);
  ok(reviewNotes.length === 1 && reviewNotes[0].thoughtText === '这是我的整本书评\n\n第二段', '## 书评 区块回读为 type-4 笔记（多段完整）');
  ok(reviewNotes[0].chapterTitle === '书评', '书评笔记章节归入「书评」');
  const stableId = reviewNotes[0].noteId;
  const back1b = mdLib2.parseBookMarkdownContent(md1, '/tmp/rv1.md');
  ok(back1b.notes.filter((n) => n.type === 4)[0].noteId === stableId, '书评 noteId 跨解析稳定（漫游键不漂移）');
  const md2 = mdLib2.renderBookMarkdown(rvBook, back1.notes, { review: { content: '这是我的整本书评\n\n第二段' } });
  ok((md2.match(/## 书评/g) || []).length === 1 && !/###\s*书评/.test(md2), 'type-4 不进章节区（## 书评 仅一次，无双写）');
  const md3 = mdLib2.renderBookMarkdown(rvBook, back1.notes, {});
  ok(!md3.includes('书评往返书评') && !/###\s*书评/.test(md3) && !md3.includes('这是我的整本书评'), '无 review 参数时书评不泄漏进章节（渲染器只认 review 通道）');

  // 路由级：详情页与漫游可见
  const poolBefore = (await call('GET', '/weread/api/roaming/session')).payload.statsPoolSize;
  fs.appendFileSync(path.join(outDir, 'zz-stale-heal.md'), '\n## 书评\n\n这本书的整本书评内容（回读验证）。\n');
  await call('GET', '/weread/api/bookshelf?refresh=1');
  r = await call('GET', '/weread/api/book/ZHEAL1');
  const rvDetail = (r.payload?.notes ?? []).filter((n) => n.type === 4);
  ok(rvDetail.length === 1 && String(rvDetail[0].thoughtText).includes('回读验证'), '详情路由返回 type-4 书评笔记');
  ok((r.payload?.chapters ?? []).some((c) => c.title === '书评'), '详情章节列表含「书评」章');
  await call('POST', '/weread/api/roaming/action', { action: 'refresh' });
  r = await call('GET', '/weread/api/roaming/session');
  ok(r.payload.statsPoolSize === poolBefore + 1, `漫游池纳入书评候选（${poolBefore}→${r.payload.statsPoolSize}）`);
  r = await call('POST', '/weread/api/roaming/filter', { noteTypes: ['review'] });
  ok(r.payload.poolSize === 1, `漫游「仅书评」筛选生效（pool=${r.payload.poolSize}，应为 1）`);
  r = await call('POST', '/weread/api/roaming/filter', {});
  ok(r.payload.poolSize === poolBefore + 1, '清筛选后池恢复全量（书评在池）');
}

// 13.77 v1.7.5 索引快照拆独立文件（state.json 瘦身）+ 旧数据自动迁移
{
  const { createIndexService: cis2 } = await import('./lib/indexsvc.js');
  const { createStore: cs2 } = await import('./lib/store.js');
  const mdS = await import('./lib/markdown.js');
  const tmpSnap = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-snap-'));
  const outS = path.join(tmpSnap, 'notes'); fs.mkdirSync(outS, { recursive: true });
  const stS = cs2(path.join(tmpSnap, 'state'));
  const idxS = cis2({ store: stS, markdown: mdS, configGetter: () => ({ outputPath: outS }), log: () => {} });
  fs.writeFileSync(path.join(outS, 's1.md'), '---\ntitle: 书S\nbookid: SN1\n---\n## 读书笔记\n\n### 章\n\n🖍️ 划线\n> 内容\n\n_记录时间：2026-11-01 10:00:00_\n');
  await idxS.rebuildFromConfiguredPath('ACC1');
  ok(fs.existsSync(path.join(tmpSnap, 'state', 'index.ACC1.snapshot.json')), '快照落独立文件 index.ACC1.snapshot.json');
  let scopedRaw = '';
  try { scopedRaw = fs.readFileSync(path.join(tmpSnap, 'state', 'state.ACC1.json'), 'utf8'); } catch { /* 可能根本没建过 */ }
  ok(!scopedRaw.includes('index.snapshot'), 'state.<account>.json 不再携带索引快照（MB 级大文件瘦身）');
  ok((await idxS.queryBooks('ACC1')).length === 1, 'aux 快照读取正常（queryBooks）');

  // 迁移：旧版快照在 state.json → 首读搬家到独立文件 + 删键（其余键保留）
  const tmpMig = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-mig-'));
  fs.mkdirSync(path.join(tmpMig, 'notes'), { recursive: true });
  const stM = cs2(path.join(tmpMig, 'state'));
  stM.setState('ACCM', 'index.snapshot', { builtAt: 1, books: [{ bookId: 'M1', title: '迁移书', filePath: '/tmp/x.md', fileMtimeMs: 1, fileSize: 1, noteCount: 1 }] });
  stM.setState('ACCM', 'syncState', { lastSyncTime: 5 });
  const idxM = cis2({ store: stM, markdown: mdS, configGetter: () => ({ outputPath: path.join(tmpMig, 'notes') }), log: () => {} });
  const snapM = idxM.getIndexSnapshot('ACCM');
  ok(snapM?.books?.length === 1, '旧版 state.json 快照仍可读（迁移前兼容）');
  ok(fs.existsSync(path.join(tmpMig, 'state', 'index.ACCM.snapshot.json')), '迁移：快照搬到独立文件');
  const afterM = JSON.parse(fs.readFileSync(path.join(tmpMig, 'state', 'state.ACCM.json'), 'utf8'));
  ok(!('index.snapshot' in afterM) && afterM.syncState?.lastSyncTime === 5, '迁移：state.json 删快照键、其余键原样保留');
  fs.rmSync(tmpSnap, { recursive: true, force: true });
  fs.rmSync(tmpMig, { recursive: true, force: true });
}

// 13.78 v1.7.6 阅读窗口会话互通（服务级）：三态裁决 + 同 URL 换血重载 + 反向同步上报
{
  const mkSess = (port) => {
    const dir = path.join(tmp, 'rw-sess-' + port);
    fs.mkdirSync(dir, { recursive: true });
    const c = { methods: [], checkCalls: [], reports: [], verdict: undefined };
    const w = { alive: false, targets: [], url: `https://weread.qq.com/web/reader/s${port}`, cookies: [] };
    const t = () => ({ id: 'S0', type: 'page', url: w.url, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/S0` });
    let mineCookie = undefined;
    const depsX = {
      fetchJson: async (p, pathname) => {
        if (!w.alive) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return w.targets;
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (wsUrl, commands) => {
        for (const cmd of commands) {
          if (cmd.method === 'Network.setCookie') c.methods.push('setCookie:' + cmd.params.name);
          else c.methods.push(cmd.method);
        }
        return commands.map((cmd, i) => ({ id: i + 1, result:
          cmd.method === 'Network.getCookies' ? { cookies: w.cookies }
          : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 11, bounds: { left: 1, top: 2, width: 800, height: 600 } }
          : {} }));
      },
      launchProcess: async () => { w.alive = true; w.targets = [t()]; return { pid: 7100 }; },
      execOpen: async () => ({ ok: false, error: 'no-open' }),
      listPids: async () => [], killPid: () => {}, sleep: async () => {},
      closeTarget: async () => { w.targets = []; },
      chromeExecutable: () => '/fake/Chrome',
      timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 60_000, injectWatch: 60_000, jamWatch: 60_000 },
      checkSession: async ({ wrSkey }) => { c.checkCalls.push(String(wrSkey)); return c.verdict; },
      onWindowSession: (s) => { c.reports.push(s); },
    };
    const rw = () => createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => mineCookie, deps: depsX });
    return { c, w, rw, setMine: (v) => { mineCookie = v; } };
  };
  const FUTURE = Math.floor(Date.now() / 1000) + 86400;

  // A) 窗内旧会话服务端已死 + 插件有新凭据 → 换血注入 + 首/同 URL 均重载
  {
    const m = mkSess(47860);
    m.c.verdict = false;
    m.setMine('wr_vid=V1; wr_skey=S_NEW');
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTURE }, { name: 'wr_skey', value: 'S_OLD', expires: FUTURE }];
    const rw = m.rw();
    let res = await rw.open(m.w.url); // 首启路径
    ok(res.ok && m.c.methods.includes('setCookie:wr_skey') && m.c.checkCalls.includes('S_OLD'), '窗内旧会话服务端已死 → 换血注入插件凭据（服务端裁决）');
    ok(m.c.methods.includes('Page.reload'), '首启换血后重载页面（ Cookie 在开载后注入）');
    const reloadsBefore = m.c.methods.filter((x) => x === 'Page.reload').length;
    res = await rw.open(m.w.url); // 同 URL 复用路径（窗口内仍是旧 S_OLD——假世界 setCookie 不回写）
    ok(res.ok && m.c.methods.filter((x) => x === 'Page.reload').length > reloadsBefore, '同 URL 换血也强制重载（撕掉「假已登录」旧页面）');
    ok(m.c.reports.length === 0, '换血路径不上报窗内会话（已判死）');
    rw.dispose();
  }

  // B) 窗内新会话（扫码）服务端有效 → 不覆盖 + 上报宿主
  {
    const m = mkSess(47861);
    m.c.verdict = true;
    m.setMine('wr_vid=V1; wr_skey=S_OLD');
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTURE }, { name: 'wr_skey', value: 'S_WIN', expires: FUTURE }];
    const rw = m.rw();
    const res = await rw.open(m.w.url);
    ok(res.ok && !m.c.methods.includes('setCookie:wr_skey'), '窗内扫码新会话不被插件旧凭据覆盖（v1.5.2 保护保持）');
    ok(m.c.reports.length === 1 && m.c.reports[0].wrSkey === 'S_WIN' && m.c.reports[0].wrVid === 'V1', '反向同步：窗内会话上报宿主（供采纳判定）');
    ok(!m.c.methods.includes('Page.reload'), '会话未变血不重载（保滚动位置）');
    rw.dispose();
  }

  // C) 裁决网络异常（undefined）→ 保守不动窗内会话，仅上报（宿主二道校验）
  {
    const m = mkSess(47862);
    m.c.verdict = undefined;
    m.setMine('wr_vid=V1; wr_skey=S_OLD');
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTURE }, { name: 'wr_skey', value: 'S_X', expires: FUTURE }];
    const rw = m.rw();
    const res = await rw.open(m.w.url);
    ok(res.ok && !m.c.methods.includes('setCookie:wr_skey') && m.c.reports.length === 1, '裁决网络异常 → 不覆盖窗内会话（保守），上报交宿主复核');
    rw.dispose();
  }

  // D) 窗内无 Cookie（全新 profile）：v1.7.18 注入前先裁决自家凭据——活着/未知照注入，判死不注入
  {
    const m = mkSess(47863);
    m.setMine('wr_vid=V1; wr_skey=S_NEW');
    m.w.cookies = [];
    const rw = m.rw();
    const res = await rw.open(m.w.url);
    ok(res.ok && m.c.methods.includes('setCookie:wr_skey') && !('loginExpired' in res), '空 profile：凭据未判死 → 直接注入（裁决未知不误报）');
    rw.dispose();
  }
  {
    const m = mkSess(47864);
    m.c.verdict = false;
    m.setMine('wr_vid=V1; wr_skey=S_DEAD');
    m.w.cookies = [];
    const rw = m.rw();
    const res = await rw.open(m.w.url);
    ok(res.ok && res.loginExpired === true && !m.c.methods.includes('setCookie:wr_skey'), '空 profile + 插件凭据判死 → 不注入、带 loginExpired（死 Cookie 注了书页也是「加载失败」）');
    rw.dispose();
  }
}

// 13.78b v1.9.0 B1/A1/A2（服务级）：同值死会话提前归因 + 裁决缓存 + 登录推窗 + 会话回流守护
{
  const mkSess2 = (port) => {
    const dir = path.join(tmp, 'rw-sess2-' + port);
    fs.mkdirSync(dir, { recursive: true });
    const c = { methods: [], checkCalls: [], reports: [], verdict: undefined };
    const w = { alive: false, targets: [], url: `https://weread.qq.com/web/reader/b${port}`, cookies: [] };
    const t = () => ({ id: 'U0', type: 'page', url: w.url, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/U0` });
    let mineCookie = undefined;
    const depsX = {
      fetchJson: async (p, pathname) => {
        if (!w.alive) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return w.targets;
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (wsUrl, commands) => {
        for (const cmd of commands) {
          if (cmd.method === 'Network.setCookie') c.methods.push('setCookie:' + cmd.params.name);
          else c.methods.push(cmd.method);
        }
        return commands.map((cmd, i) => ({ id: i + 1, result:
          cmd.method === 'Network.getCookies' ? { cookies: w.cookies }
          : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 21, bounds: { left: 1, top: 2, width: 800, height: 600 } }
          : {} }));
      },
      launchProcess: async () => { w.alive = true; w.targets = [t()]; return { pid: 7300 }; },
      execOpen: async () => ({ ok: false, error: 'no-open' }),
      listPids: async () => [], killPid: () => {}, sleep: async () => {},
      closeTarget: async () => { w.targets = []; },
      chromeExecutable: () => '/fake/Chrome',
      timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 60_000, injectWatch: 60_000, jamWatch: 60_000 },
      checkSession: async ({ wrSkey }) => { c.checkCalls.push(String(wrSkey)); return c.verdict; },
      onWindowSession: (s) => { c.reports.push(s); },
    };
    const rw = () => createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => mineCookie, deps: depsX });
    return { c, w, rw, setMine: (v) => { mineCookie = v; } };
  };
  const FUTUREX = Math.floor(Date.now() / 1000) + 86400;

  // B1：插件与窗口同值 skey 服务端已死 → 开书带 loginExpired（提前归因，不撞「加载失败」墙）
  {
    const m = mkSess2(47880);
    m.c.verdict = false;
    m.setMine('wr_vid=V1; wr_skey=S_SAME');
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTUREX }, { name: 'wr_skey', value: 'S_SAME', expires: FUTUREX }];
    const rw = m.rw();
    const res = await rw.open(m.w.url);
    ok(res.ok && res.loginExpired === true && !m.c.methods.includes('setCookie:wr_skey'), 'B1：同值 skey 服务端已死 → 开书带 loginExpired（同值注入无意义，跳过）');
    ok(m.c.checkCalls.filter((s) => s === 'S_SAME').length === 1, 'B1：同值裁决发生（一次）');
    await rw.open(m.w.url);
    ok(m.c.checkCalls.filter((s) => s === 'S_SAME').length === 1, 'B1：裁决 10min 缓存——重复开书零服务端往返');
    rw.dispose();
  }

  // B1：同值活会话 → 正常打开，无 loginExpired、无注入、无上报
  {
    const m = mkSess2(47881);
    m.c.verdict = true;
    m.setMine('wr_vid=V1; wr_skey=S_OK');
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTUREX }, { name: 'wr_skey', value: 'S_OK', expires: FUTUREX }];
    const rw = m.rw();
    const res = await rw.open(m.w.url);
    ok(res.ok && !('loginExpired' in res) && !m.c.methods.includes('setCookie:wr_skey') && m.c.reports.length === 0, 'B1：同值活会话 → 正常打开（归因不误报）');
    rw.dispose();
  }

  // A1：登录成功推窗——窗内死会话 + 插件新凭据 → 换血注入 + 重载；同源健康时 no-op
  {
    const m = mkSess2(47882);
    m.c.verdict = false;
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTUREX }, { name: 'wr_skey', value: 'S_DEADWIN', expires: FUTUREX }];
    const rw = m.rw();
    m.setMine(undefined);
    let res = await rw.open(m.w.url); // 先开窗（无凭据：窗内死会话留着）
    ok(res.ok, 'A1 前置：窗口已打开（窗内挂死会话）');
    const reloadsBefore = m.c.methods.filter((x) => x === 'Page.reload').length;
    m.setMine('wr_vid=V1; wr_skey=S_FRESH'); // 模拟宿主登录成功
    res = await rw.pushSession();
    ok(res.ok === true && res.injected === true && m.c.methods.includes('setCookie:wr_skey'), 'A1：登录成功推窗 → 窗内死会话换血注入（免等下次开书）');
    ok(m.c.methods.filter((x) => x === 'Page.reload').length > reloadsBefore, 'A1：换血后重载页面（撕掉「加载失败」旧页）');
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTUREX }, { name: 'wr_skey', value: 'S_FRESH', expires: FUTUREX }]; // 假世界模拟 Chrome 落盘
    m.c.verdict = true;
    const reloadsAfter = m.c.methods.filter((x) => x === 'Page.reload').length;
    res = await rw.pushSession();
    ok(res.ok === true && res.injected === false, 'A1：同源健康时推窗 no-op（缓存裁决）');
    ok(m.c.methods.filter((x) => x === 'Page.reload').length === reloadsAfter, 'A1：no-op 推窗不重载（保滚动位置）');
    rw.dispose();
  }

  // A1：窗口不在场 → pushSession 廉价 no-op
  {
    const m = mkSess2(47883);
    const rw = m.rw();
    const res = await rw.pushSession();
    ok(res.ok === false && res.reason === 'no-window', 'A1：窗口不在场 → pushSession 秒回 no-window');
    rw.dispose();
  }

  // A2：会话回流守护——窗内会话与插件不同源 → 上报宿主（只读，不动页面）
  {
    const m = mkSess2(47884);
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTUREX }, { name: 'wr_skey', value: 'S_HARVEST', expires: FUTUREX }];
    m.setMine('wr_vid=V1; wr_skey=S_OLD');
    const rw = m.rw();
    await rw.open(m.w.url);
    m.c.reports.length = 0; // 清掉开窗路径的上报，只看回流守护
    const r1 = await rw._internal.harvestNow();
    ok(r1.ok === true && m.c.reports.length === 1 && m.c.reports[0].wrSkey === 'S_HARVEST' && m.c.reports[0].wrVid === 'V1', 'A2：回流守护上报窗内会话（窗→插件，页内连读数日也不落后）');
    ok(!m.c.methods.includes('Page.reload'), 'A2：回流不动页面（换血只在导航事件，不打扰阅读）');
    m.setMine('wr_vid=V1; wr_skey=S_HARVEST');
    const r2 = await rw._internal.harvestNow();
    ok(r2.ok === false && m.c.reports.length === 1, 'A2：同源时回流 no-op');
    m.w.targets = []; m.w.alive = false;
    const r3 = await rw._internal.harvestNow();
    ok(r3.ok === false && m.c.reports.length === 1, 'A2：窗口不在场时回流 no-op');
    rw.dispose();
  }

  // v1.9.2 B1 缓存语义：网络异常（undefined）不缓存——下次开书照问；确定性结论才缓存
  {
    const m = mkSess2(47885);
    m.setMine('wr_vid=V1; wr_skey=S_FLAP');
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: FUTUREX }, { name: 'wr_skey', value: 'S_FLAP', expires: FUTUREX }];
    const rw = m.rw();
    m.c.verdict = undefined; // 网络异常
    let res = await rw.open(m.w.url);
    ok(res.ok && !('loginExpired' in res), 'B1：裁决网络异常 → 不误报过期（保守不动）');
    ok(m.c.checkCalls.filter((s) => s === 'S_FLAP').length === 1, 'B1：第一次裁决发生');
    m.c.verdict = true; // 网络恢复判活
    await rw.open(m.w.url);
    ok(m.c.checkCalls.filter((s) => s === 'S_FLAP').length === 2, 'B1：undefined 未被缓存——下次开书重新裁决');
    await rw.open(m.w.url);
    ok(m.c.checkCalls.filter((s) => s === 'S_FLAP').length === 2, 'B1：true 被缓存——后续开书零往返');
    m.c.verdict = false; // 服务端此刻判死（缓存仍是 10min 前的 true——可接受：过期后自然重裁）
    res = await rw.open(m.w.url);
    ok(res.ok && !('loginExpired' in res), 'B1：缓存有效期内信任旧结论（10min 语义边界，过期自动重裁）');
    rw.dispose();
  }

  // v1.9.2 A2 补盲区：窗内 skey 日期已死 → 不回流死值（留给开窗注入换血）
  {
    const m = mkSess2(47886);
    const PAST = Math.floor(Date.now() / 1000) - 3600;
    m.w.cookies = [{ name: 'wr_vid', value: 'V1', expires: PAST }, { name: 'wr_skey', value: 'S_STALE', expires: PAST }];
    m.setMine('wr_vid=V1; wr_skey=S_OLD');
    const rw = m.rw();
    const r = await rw._internal.harvestNow();
    ok(r.ok === false && m.c.reports.length === 0, 'A2：日期已死的窗内 cookie 不回流（死值无采纳意义）');
    rw.dispose();
  }

  // v1.9.2 #4（对抗审查）：verdictCache 上限 64 FIFO 淘汰——超限删最旧，被删 key 重新裁决
  {
    const m = mkSess2(47887);
    m.c.verdict = true;
    const rw = m.rw();
    for (let i = 0; i < 70; i++) await rw._internal.adjudicate('V1', `S_${i}`);
    ok(rw._internal.verdictCacheSize() === 64, 'F2：verdictCache 上限 64（常驻实例不无界增长）');
    const before = m.c.checkCalls.length;
    await rw._internal.adjudicate('V1', 'S_0'); // 最旧条目已被淘汰 → 重新裁决
    ok(m.c.checkCalls.length === before + 1, 'F2：FIFO 淘汰后旧 key 重新裁决（缓存语义无损）');
    await rw._internal.adjudicate('V1', 'S_69'); // 最新条目仍在缓存 → 零往返
    ok(m.c.checkCalls.length === before + 1, 'F2：缓存内 key 不重复裁决');
    rw.dispose();
  }

  // v1.9.2 #6（对抗审查）：open 换血进行中（setCookie 挂住）并发 harvest——互不踩踏、不抛错
  {
    const dir6 = path.join(tmp, 'rw-sess2-47888b');
    fs.mkdirSync(dir6, { recursive: true });
    let releaseSetCookie;
    const setCookieGate = new Promise((r) => { releaseSetCookie = r; }); // 手动闸：挂住换血注入
    const FUT6 = Math.floor(Date.now() / 1000) + 86400;
    const c6 = { reports: [] };
    const w6 = { alive: false, targets: [], url: 'https://weread.qq.com/web/reader/b6' };
    const t6 = () => ({ id: 'W0', type: 'page', url: w6.url, webSocketDebuggerUrl: 'ws://127.0.0.1:47889/devtools/page/W0' });
    const winCookies6 = () => [{ name: 'wr_vid', value: 'V1', expires: FUT6 }, { name: 'wr_skey', value: 'S_DEAD6', expires: FUT6 }];
    const deps6 = {
      fetchJson: async (p, pathname) => {
        if (!w6.alive) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/147', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return w6.targets;
        throw new Error('unexpected');
      },
      wsCall: async (wsUrl, commands) => {
        for (const cmd of commands) {
          if (cmd.method === 'Network.setCookie') await setCookieGate; // 换血挂住：制造 harvest 并发窗口
        }
        return commands.map((cmd, i) => ({ id: i + 1, result:
          cmd.method === 'Network.getCookies' ? { cookies: winCookies6() }
          : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 61, bounds: { left: 0, top: 0, width: 800, height: 600 } }
          : {} }));
      },
      launchProcess: async () => { w6.alive = true; w6.targets = [t6()]; return { pid: 7600 }; },
      execOpen: async () => ({ ok: false, error: 'no-open' }),
      listPids: async () => [], killPid: () => {}, sleep: async () => {},
      closeTarget: async () => { w6.targets = []; },
      chromeExecutable: () => '/fake/Chrome',
      timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 60_000, injectWatch: 60_000, jamWatch: 60_000 },
      checkSession: async () => false, // 窗内死会话 → open 即触发换血注入（挂闸）
      onWindowSession: (s) => { c6.reports.push(s); },
    };
    const rw6 = createReaderWindow({ stateDir: dir6, log: () => {}, getCookies: () => 'wr_vid=V1; wr_skey=S_NEW6', deps: deps6 });
    const openPromise = rw6.open(w6.url); // 换血流程启动并在 setCookie 处挂住
    await new Promise((r) => setTimeout(r, 30));
    const hv = await rw6._internal.harvestNow(); // 并发回流：读 cookie → 判不同源 → 上报（不碰 setCookie）
    ok(typeof hv.ok === 'boolean', '#6：换血进行中并发 harvest 不抛错（读写互不踩踏）');
    releaseSetCookie();
    const openRes = await openPromise;
    ok(openRes.ok === true, '#6：换血流程不受并发 harvest 干扰，正常完成');
    rw6.dispose();
  }
}

// 13.79 v1.7.6 反向同步采纳（apply 级，fetch 桩裁决）：窗内有效会话救活插件 Cookie 通道
{
  const regS = { web: [], tools: [] };
  const ctxS = { effect: (fn) => { fn(); return () => {}; }, inject: () => () => {}, webServer: { register: (x) => regS.web.push(x) }, tools: { register: (x) => regS.tools.push(x) } };
  const FUTURE2 = Math.floor(Date.now() / 1000) + 86400;
  const worldS = { alive: false, targets: [], url: 'https://weread.qq.com/web/reader/sync1' };
  const tgtS = () => ({ id: 'SY0', type: 'page', url: worldS.url, webSocketDebuggerUrl: 'ws://127.0.0.1:47865/devtools/page/SY0' });
  const depsS = {
    fetchJson: async (p, pathname) => {
      if (!worldS.alive) throw new Error('ECONNREFUSED');
      if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
      if (pathname === '/json/list') return worldS.targets;
      throw new Error('unexpected ' + pathname);
    },
    wsCall: async (wsUrl, commands) => commands.map((cmd, i) => ({ id: i + 1, result:
      cmd.method === 'Network.getCookies' ? { cookies: [{ name: 'wr_vid', value: 'V1', expires: FUTURE2 }, { name: 'wr_skey', value: 'S_WIN', expires: FUTURE2 }] }
      : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 12, bounds: { left: 0, top: 0, width: 800, height: 600 } }
      : {} })),
    launchProcess: async () => { worldS.alive = true; worldS.targets = [tgtS()]; return { pid: 7200 }; },
    execOpen: async () => ({ ok: false, error: 'no-open' }),
    listPids: async () => [], killPid: () => {}, sleep: async () => {},
    closeTarget: async () => { worldS.targets = []; },
    chromeExecutable: () => '/fake/Chrome',
    timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 60_000, injectWatch: 60_000, jamWatch: 60_000 },
  };
  const origFetch = globalThis.fetch;
  const seen = [];
  const validSet = new Set(['S_WIN', 'S_KEY']); // v1.9.1：动态有效集合（verify 修正断言要临时判死 S_KEY）
  let shelfOn = true; // v1.9.1：书架桩开关——checkLoginStatus 第一跳就是 notebook，判死阶段需一并关闭
  // v1.9.3 增量/取消测试设施：书架数据可变 + 笔记端点按书计数
  const shelfBooks = () => [
    { bookId: 'PB1', title: '进度书一', author: '甲', noteCount: shelfPB1Notes, highlightCount: shelfPB1Notes, progress: 0.1, lastReadTime: 1 },
    { bookId: 'PB2', title: '进度书二', author: '乙', noteCount: 0, highlightCount: 0, progress: 0.2, lastReadTime: 2 },
    { bookId: 'PB3', title: '增量书三', author: '丙', noteCount: 1, highlightCount: 1, progress: 0.3, lastReadTime: 3 },
  ];
  let shelfPB1Notes = 1;
  const noteFetches = []; // bookmarklist 调用的 bookId 列表
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    if (u.includes('/api/userInfo')) {
      const h = init.headers ?? {};
      const skey = typeof h.get === 'function' ? h.get('x-skey') : h['x-skey'];
      seen.push(String(skey));
      const valid = validSet.has(String(skey));
      return { ok: true, text: async () => JSON.stringify(valid ? { user: { userId: 'U1', userVid: 'V1', name: '同步账号' } } : { errCode: -2012 }) };
    }
    // v1.9.1 进度链路：书架端点（notebook 极简结构；v1.9.3 起数据可变供增量判定）
    if (u.includes('/api/user/notebook')) {
      if (!shelfOn) return { ok: true, text: async () => JSON.stringify({ errCode: -2012 }) };
      return { ok: true, text: async () => JSON.stringify({ books: shelfBooks() }) };
    }
    // v1.9.3：笔记端点按书计数（增量断言的核心观测点）——PB1 条数随书架计数联动（自洽），
    // PB3 恒 1 条；内容恒定（跨轮内容比对不变），PB2 无笔记
    if (u.includes('bookmarklist')) {
      const bid = new URL(u).searchParams.get('bookId') || '?';
      noteFetches.push(bid);
      const n = bid === 'PB1' ? shelfPB1Notes : bid === 'PB3' ? 1 : 0;
      const books = Array.from({ length: n }, (_, i) => ({ bookmarkId: `${bid}-bm${i + 1}`, bookId: bid, chapterUid: 1, chapterTitle: '第一章', type: 0, markText: `${bid} 的稳定划线 ${i + 1}`, createTime: 1700000000 + i, range: '1-10' }));
      return { ok: true, text: async () => JSON.stringify({ books }) };
    }
    // v1.9.0 C1：开书预热 HEAD（无 Set-Cookie → 凭据值不变，测试世界封闭无外网）
    if (u === 'https://weread.qq.com/' && init.method === 'HEAD') {
      seen.push('HEAD');
      return { ok: true, headers: { getSetCookie: () => [], get: () => null } };
    }
    // v1.9.1：其余 weread 端点一律空体兜底（同步链路的 book/info 等），绝不打真网
    if (u.startsWith('https://weread.qq.com')) return { ok: true, status: 200, text: async () => '' };
    return origFetch(input, init);
  };
  try {
    const disposeS = apply(ctxS, { stateDir: path.join(tmp, 'state-sess-sync'), outputPath: '', apiToken: SMOKE_TOKEN, readerDeps: depsS, getAccountId: () => '' }); // v1.8.10：固定单账号（会话互通断言基于同窗复用）
    const routeS = regS.web.find((x) => x.path === '/weread');
    // v1.9.11：隔离 stateDir 场景局部 token（种子重取，不动主场景 API_TOKEN）
    await call('GET', '/weread/api/state', null, routeS, 'Bearer stale-sess');
    const sToken = JSON.parse(fs.readFileSync(path.join(tmp, 'state-sess-sync', 'endpoint.json'), 'utf8')).token;
    const sAuth = `Bearer ${sToken}`;
    let rs = await call('POST', '/weread/api/open-reader', { url: 'https://weread.qq.com/web/reader/sync1' }, routeS, sAuth);
    ok(rs.payload.ok === true, '开窗成功（会话互通链路）');
    await new Promise((r2) => setTimeout(r2, 80)); // onWindowSession 异步采纳
    rs = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
    ok(rs.payload.loggedIn === true, '窗内有效会话反向同步：插件登录态点亮（登录弹窗芯片随之转绿）');
    const winCalls = seen.filter((s) => s === 'S_WIN').length;
    ok(winCalls >= 1, `宿主对窗内会话做了服务端裁决（S_WIN × ${winCalls}）`);
    await call('POST', '/weread/api/open-reader', { url: 'https://weread.qq.com/web/reader/sync1' }, routeS, sAuth);
    await new Promise((r2) => setTimeout(r2, 80));
    // v1.9.0 B1 新语义：同源会话开书做一次同值裁决（10min 缓存首次 miss）——不再断言零往返
    const same1 = seen.filter((s) => s === 'S_WIN').length;
    ok(same1 <= winCalls + 1, `v1.9.0 B1 同源裁决：采纳后开书最多补 1 次同值核验（+${same1 - winCalls}）`);
    await call('POST', '/weread/api/open-reader', { url: 'https://weread.qq.com/web/reader/sync1' }, routeS, sAuth);
    await new Promise((r2) => setTimeout(r2, 80));
    ok(seen.filter((s) => s === 'S_WIN').length === same1, 'v1.9.0 B1 同源裁决 10min 缓存：后续开书零服务端往返');
    // v1.9.0 C1：开书预热——带凭据开书触发一次 HEAD 续命；30min 门内再开不重复
    ok(seen.filter((s) => s === 'HEAD').length === 1, 'v1.9.0 C1：带凭据开书触发预热 HEAD 恰好一次（首开无凭据不预热、30min 门生效）');
    // v1.9.0 B2：stateView 暴露 Cookie 来源（本轮来自窗内采纳）
    rs = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
    ok(rs.payload.loginChannels?.cookie?.origin?.source === 'window', 'v1.9.0 B2：state 暴露 cookie 来源=window（设置页「上次续命 · 来源」）');

    // 账号/凭据保护：插件自身凭据有效时，窗内另一会话不打扰（不覆盖数据通道）
    rs = await call('POST', '/weread/api/login/cookie', { wrVid: 'V1', wrSkey: 'S_KEY' }, routeS, sAuth);
    ok(rs.payload.ok === true, 'Cookie 通道登录成功（S_KEY，fetch 桩有效）');
    rs = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
    ok(rs.payload.loginChannels?.cookie?.origin?.source === 'login', 'v1.9.0 B2：Cookie 登录后来源翻转为 login');
    await call('POST', '/weread/api/open-reader', { url: 'https://weread.qq.com/web/reader/sync1' }, routeS, sAuth); // 窗内 S_WIN
    await new Promise((r2) => setTimeout(r2, 80));
    ok(seen.filter((s) => s === 'S_KEY').length >= 1, '插件自身凭据被服务端复核（有效 → 不采纳窗内会话）');
    const keyCalls = seen.filter((s) => s === 'S_KEY').length;
    await call('POST', '/weread/api/open-reader', { url: 'https://weread.qq.com/web/reader/sync1' }, routeS, sAuth);
    await new Promise((r2) => setTimeout(r2, 80));
    // v1.9.2 #1（对抗审查）：确定性拒绝加 1h 冷却——同指纹上报不再重复 mineOk 探测。
    // 原断言「每次开窗都重新复核」正是审查点名的问题：回流守护每 10min 重报同指纹 = 日增上百次裸接口探测。
    ok(seen.filter((s) => s === 'S_KEY').length === keyCalls, '#1：拒绝冷却生效——同指纹窗内会话重报不再重复探测插件凭据（风控面收口）');

    // v1.9.1 修复①：同步进度参数错位——onProgress 第 4 参才是进度对象（原把第 1 参阶段字符串存进
    // syncProgress → stateView 恒字符串 → 书架「X/N 本」从未显示过）。跑一轮真实 /api/sync 验证对象形状。
    rs = await call('POST', '/weread/api/output-path/validate', { path: path.join(tmp, 'out-progress') }, routeS, sAuth);
    ok(rs.payload?.ok === true, '进度链路前置：输出目录已配置');
    rs = await call('POST', '/weread/api/sync', undefined, routeS, sAuth);
    ok(rs.payload?.started === true, '手动同步异步启动（started:true）');
    let syncSettled = null;
    for (let i = 0; i < 30 && !syncSettled; i++) {
      await new Promise((r2) => setTimeout(r2, 60));
      const s3 = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
      if (s3.payload.syncState?.status && s3.payload.syncState.status !== 'syncing') syncSettled = s3.payload;
    }
    ok(!!syncSettled, '同步到达终态');
    const spFinal = syncSettled?.syncProgress;
    ok(!!spFinal && typeof spFinal === 'object' && typeof spFinal.currentStep === 'string' && spFinal.currentStep.length > 0,
      'v1.9.1：syncProgress 是进度对象（currentStep 在场）——不再是阶段字符串');
    ok(spFinal && spFinal.totalBooks === 3 && spFinal.currentBookIndex === 3,
      `v1.9.1：进度带书计数（${spFinal?.currentBookIndex ?? '?'}/${spFinal?.totalBooks ?? '?'} 本）——书架「X/N 本」恢复显示`);
    ok(syncSettled?.syncState?.status === 'success', '同步成功（首轮 3 本全拉：PB3 有笔记计数）');
    const round1NoteFetches = noteFetches.length;
    ok(round1NoteFetches >= 1 && noteFetches.includes('PB3'), '首轮全量：有笔记的书拉了 bookmarklist（PB3 在场）');

    // v1.9.2 #2（对抗审查）：第二轮同步 started 即清上一轮 Completed 旧帧——
    // 原保留旧帧时，第二次点同步首秒显示「100% 3/3 · 同步完成」约 1s 才被新帧覆盖。
    // 桩世界 fullSync 毫秒级推进，GET 时可能已有新帧——断言语义为「绝非上一轮的 completed 帧」
    rs = await call('POST', '/weread/api/sync', undefined, routeS, sAuth);
    ok(rs.payload?.started === true, '第二轮同步启动');
    const rs2 = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
    const sp2 = rs2.payload.syncProgress;
    ok(sp2 === null || sp2.currentStep !== 'completed', '#2：started 即清旧帧——第二轮同步首秒不再闪上一轮「100% N/N」');
    for (let i = 0; i < 30; i++) { // 等第二轮到达终态，避免影响后续断言
      await new Promise((r2) => setTimeout(r2, 60));
      const s4 = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
      if (s4.payload.syncState?.status && s4.payload.syncState.status !== 'syncing') break;
    }

    // v1.9.3 增量：第二轮（服务端计数全同）——bookmarklist 零请求。
    // 修复前：shouldRefreshMetadata(remoteBook) 对书架数据每轮恒 true → 全部书进队列全量拉笔记。
    const round2NoteFetches = noteFetches.length - round1NoteFetches;
    ok(round2NoteFetches === 0,
      `增量修复：计数未变的书不再拉笔记（第二轮 bookmarklist × ${round2NoteFetches}，修复前 ≈ 每本一次）`);
    // v1.9.3 增量：第三轮（PB1 划线 1→2）——只有 PB1 精确拉取
    shelfPB1Notes = 2;
    await call('POST', '/weread/api/sync', undefined, routeS, sAuth);
    for (let i = 0; i < 30; i++) {
      await new Promise((r2) => setTimeout(r2, 60));
      const s5 = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
      if (s5.payload.syncState?.status && s5.payload.syncState.status !== 'syncing') break;
    }
    const round3 = noteFetches.slice(round1NoteFetches + round2NoteFetches);
    ok(round3.length === 1 && round3[0] === 'PB1',
      `增量精确性：计数变化的书被拉取（仅 PB1 × ${round3.length}，未变化的书零请求）`);
    // v1.9.3 增量兜底：清空 noteSyncMarks → 计数未变的书因超 30 天重新全拉一轮
    const accNow = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.join(tmp, 'state-sess-sync'), 'meta.json'), 'utf8')).activeAccountId; } catch { return ''; } })();
    try {
      const stateDir2 = path.join(tmp, 'state-sess-sync');
      const stFile = path.join(stateDir2, accNow ? `state.${accNow}.json` : 'state.json');
      const stData = JSON.parse(fs.readFileSync(stFile, 'utf8'));
      delete stData.noteSyncMarks;
      fs.writeFileSync(stFile, JSON.stringify(stData));
    } catch { /* ignore */ }
    await call('POST', '/weread/api/sync', undefined, routeS, sAuth);
    for (let i = 0; i < 30; i++) {
      await new Promise((r2) => setTimeout(r2, 60));
      const s6 = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
      if (s6.payload.syncState?.status && s6.payload.syncState.status !== 'syncing') break;
    }
    const round4 = noteFetches.slice(round1NoteFetches + round2NoteFetches + round3.length);
    ok(round4.includes('PB3'),
      '增量兜底：30 天未全量拉取的书强制重拉一轮（PB3 无计数变化也被拉，覆盖「计数不变内容变」边缘）');

    // v1.9.5：cancel 路由登录态冒烟——修复 acc 未定义（原只在未登录 401 路径测过，
    // 登录态点取消必抛 ReferenceError「acc is not defined」，真机反馈）
    rs = await call('POST', '/weread/api/sync/cancel', undefined, routeS, sAuth);
    ok(rs.status === 200 && rs.payload?.ok === true && rs.payload?.cancelling === false,
      'v1.9.5：登录态取消端点可用（无同步在跑 → cancelling:false，不再 acc is not defined）');

    // v1.9.1 修复②：verify 核验结论回写 loginState——弹层「有效」而横幅仍「登录已过期」的状态分裂
    validSet.delete('S_KEY'); shelfOn = false; // 服务端判死 S_KEY（书架+裸接口双跳全判死）
    worldS.targets = []; worldS.alive = false; // 关窗：隔离「窗内救活」路径，纯测修正分支
    rs = await call('POST', '/weread/api/login/verify', undefined, routeS, sAuth);
    ok(rs.payload?.ok === false, 'verify：凭据判死 → ok:false');
    rs = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
    ok(rs.payload.loggedIn === false && rs.payload.loginExpired === true, 'v1.9.1：核验失败回写 loginState（横幅如实显示过期）');
    validSet.add('S_KEY'); shelfOn = true; // 凭据恢复（如续命/救活后）
    rs = await call('POST', '/weread/api/login/verify', undefined, routeS, sAuth);
    ok(rs.payload?.ok === true, 'verify：凭据恢复 → ok:true');
    rs = await call('GET', '/weread/api/state', undefined, routeS, sAuth);
    ok(rs.payload.loggedIn === true && rs.payload.loginExpired === false,
      'v1.9.1：核验成功撤销过期状态——弹层全绿时横幅不再僵死在「登录已过期」（真机反馈修复）');
    disposeS();
  } finally {
    globalThis.fetch = origFetch;
  }
}

// 13.79b v1.9.0 C2：启动救活——插件凭据已死 + 窗口孤儿实例在场（窗内会话有效）→ 启动后台校验后自动采纳
{
  const regR = { web: [], tools: [] };
  const ctxR = { effect: (fn) => { fn(); return () => {}; }, inject: () => () => {}, webServer: { register: (x) => regR.web.push(x) }, tools: { register: (x) => regR.tools.push(x) } };
  const FUTURE4 = Math.floor(Date.now() / 1000) + 86400;
  // 预置：插件凭据 S_OLD（服务端将判死）+ 孤儿窗口在场（S_ORPH 有效）
  // 注意：目录名必须全新（不能撞早期测试用过的 state-rescue——那里预置过账号 999，meta 会把 cookie 查到 999 scope 上）
  const dirR = path.join(tmp, 'state-rescue-c2');
  fs.mkdirSync(dirR, { recursive: true });
  fs.writeFileSync(path.join(dirR, 'secrets.json'), JSON.stringify({ 'weread.vscode.cookies': 'wr_vid=V1; wr_skey=S_OLD' }));
  fs.writeFileSync(path.join(dirR, 'reader-window.json'), JSON.stringify({ port: 47890, lastUrl: 'https://weread.qq.com/web/reader/res1' }));
  const worldR = { alive: true, targets: [{ id: 'R0', type: 'page', url: 'https://weread.qq.com/web/reader/res1', webSocketDebuggerUrl: 'ws://127.0.0.1:47890/devtools/page/R0' }] };
  const depsR = {
    fetchJson: async (p, pathname) => {
      if (!worldR.alive) throw new Error('ECONNREFUSED');
      if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
      if (pathname === '/json/list') return worldR.targets;
      throw new Error('unexpected ' + pathname);
    },
    wsCall: async (wsUrl, commands) => commands.map((cmd, i) => ({ id: i + 1, result:
      cmd.method === 'Network.getCookies' ? { cookies: [{ name: 'wr_vid', value: 'V1', expires: FUTURE4 }, { name: 'wr_skey', value: 'S_ORPH', expires: FUTURE4 }] }
      : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 31, bounds: { left: 0, top: 0, width: 800, height: 600 } }
      : {} })),
    launchProcess: async () => { worldR.alive = true; return { pid: 7500 }; },
    execOpen: async () => ({ ok: false, error: 'no-open' }),
    listPids: async () => [], killPid: () => {}, sleep: async () => {},
    closeTarget: async () => { worldR.targets = []; },
    chromeExecutable: () => '/fake/Chrome',
    timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 60_000, injectWatch: 60_000, jamWatch: 60_000 },
  };
  const origFetchR = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input);
    if (u.includes('/api/userInfo')) {
      const h = init.headers ?? {};
      const skey = typeof h.get === 'function' ? h.get('x-skey') : h['x-skey'];
      const valid = String(skey) === 'S_ORPH';
      return { ok: true, text: async () => JSON.stringify(valid ? { user: { userId: 'U9', userVid: 'V1', name: '救活账号' } } : { errCode: -2012 }) };
    }
    if (u.includes('/api/user/notebook')) return { ok: true, status: 200, text: async () => JSON.stringify({ errCode: -2012 }) }; // 无 books 数组 → 立即落到 x-skey 裸接口（勿用 throw：会触发 ApiClient 重试退避拖慢链路）
    if (u === 'https://weread.qq.com/' && init.method === 'HEAD') return { ok: true, headers: { getSetCookie: () => [], get: () => null } };
    return origFetchR(input, init);
  };
  try {
    const disposeR = apply(ctxR, { stateDir: dirR, outputPath: '', apiToken: SMOKE_TOKEN, readerDeps: depsR, getAccountId: () => '' });
    const routeR = regR.web.find((x) => x.path === '/weread');
    await new Promise((r2) => setTimeout(r2, 400)); // 启动 classify → C2 救活链（异步）
    const rs = await call('GET', '/weread/api/state', undefined, routeR);
    ok(rs.payload.loggedIn === true, 'C2：插件凭据已死 + 孤儿窗口会话有效 → 启动即自动采纳（免重扫码）');
    ok(rs.payload.loginChannels?.cookie?.origin?.source === 'window', 'C2：救活来源标记为 window（B2 指纹联动）');
    disposeR();
  } finally {
    globalThis.fetch = origFetchR;
  }
}

// 13.79c v1.9.3 软取消（sync 级）：书边界检查点 + 在飞书自然完成 + cancelled 终态 + 互斥释放
{
  const { createSyncService } = await import('./lib/sync.js');
  const { createStore } = await import('./lib/store.js');
  const { transformNotes, buildPcUrl } = await import('./lib/api.js');
  const { createIndexService } = await import('./lib/indexsvc.js');
  const markdownC = await import('./lib/markdown.js');
  const dirC = path.join(tmp, 'state-sync-cancel');
  const outC = path.join(tmp, 'out-sync-cancel');
  fs.mkdirSync(dirC, { recursive: true }); fs.mkdirSync(outC, { recursive: true });
  const storeC = createStore(dirC);
  storeC.addAccount({ accountId: 'C1', displayName: '取消账号', createdAt: 1, lastUsedAt: 1 });
  storeC.setActiveAccountId('C1');
  const indexC = createIndexService({ store: storeC, markdown: markdownC, configGetter: () => ({ outputPath: outC }), log: () => {} });
  // 5 本书、bookmarklist 挂闸：第一本挂住制造取消窗口，放行后逐本放行
  let releaseFirst;
  const firstGate = new Promise((r) => { releaseFirst = r; });
  let gateOn = true;
  const noteCallsC = [];
  const mkBook = (i) => ({ bookId: `CB${i}`, title: `取消书${i}`, author: 'x', noteCount: 1, highlightCount: 1, progress: 0.1, lastReadTime: i });
  const fakeApiC = {
    getShelfList: async () => ({ books: [1, 2, 3, 4, 5].map((i) => ({ book: mkBook(i), lastReadTime: i })), totalCount: 5, syncTime: Date.now() }),
    getArticleBooks: async () => [],
    getBookInfo: async () => { throw new Error('stub offline'); }, // enrich 软失败（不打真网）
    getWebReviewListMine: async () => [],
    getBookNotes: async (bookId) => {
      noteCallsC.push(bookId);
      if (gateOn) await firstGate; // 闸期所有拉取挂住：3 worker 各持一本在飞、2 本留队列（单闸 resolve 全放行）
      return { books: [{ bookmarkId: `${bookId}-bm1`, bookId, chapterUid: 1, chapterTitle: '第一章', type: 0, markText: `${bookId} 划线`, createTime: 1700000000, range: '1-10' }] };
    },
    transformNotes, buildPcUrl,
  };
  const syncC = createSyncService({
    api: fakeApiC, store: storeC, index: indexC, markdown: markdownC,
    cleanup: { cleanupDuplicateBookFilesForAccount: async () => ({}) },
    configGetter: () => ({ outputPath: outC }), log: () => {}, onProgress: () => {}, gateway: null,
  });  const syncPromise = syncC.fullSync('C1');
  await new Promise((r) => setTimeout(r, 40)); // 等 worker 取到第一本并挂住
  ok(syncC.isSyncingInProgress('C1'), '取消前置：同步在跑');
  syncC.requestCancel('C1');
  gateOn = false; releaseFirst(); // 放行：在飞的第一本自然完成，worker 回到书边界见取消标志即停
  const resC = await syncPromise;
  ok(resC.cancelled === true && resC.success === false, '取消终态：结果带 cancelled=true、success=false（区别于 failed）');
  ok(storeC.getState('C1', 'syncState', {}).status === 'cancelled', '取消终态：syncState.status=cancelled（UI 不显示红色错误）');
  ok(noteCallsC.length >= 1 && noteCallsC.length < 5, `书边界语义：在飞书完成（${noteCallsC.length}/5 本拉取）——队列剩余书零请求`);
  ok(syncC.isSyncingInProgress('C1') === false, '取消后互斥释放——立即可重新同步');
  // 取消后的已完成部分确实落盘（第一本书的文件在场）
  const walkC = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walkC(path.join(d, e.name)) : [e.name]); } catch { return []; } };
  ok(walkC(outC).some((f) => String(f).includes('取消书')), '取消后已完成部分保留（书文件已落盘）');
  // 重新同步：取消标志已随轮释放，未完成的书自然补齐
  const resC2 = await syncC.fullSync('C1');
  ok(resC2.success === true && !resC2.cancelled, '重新同步不受上一轮取消影响（标志随轮释放）');
  ok(noteCallsC.length === 5, `重新同步补齐剩余书（累计拉取 ${noteCallsC.length}/5）——增量语义下取消=无损续传`);
}

// 13.79d v1.9.3 取消路由（薄层）：无同步在跑 → no-op；未登录 → 401
{
  const rs = await call('POST', '/weread/api/sync/cancel');
  ok(rs.status === 401, '取消端点未登录 401（与同步路由同守卫）');
}

// 13.80 v1.7.7 选中即问：工具条「问 DSH」+ 页面队列排空 + followup 推送会话
{
  // a) Bootstrap 标记与语法
  const rwBoot = createReaderWindow({ stateDir: path.join(tmp, 'rw-boot-ask'), deps: {} });
  const bootAsk = rwBoot._internal.BOOTSTRAP_SCRIPT;
  new Function(bootAsk);
  ok(bootAsk.includes('问 DSH') && bootAsk.includes('__wrAskDSH') && bootAsk.includes('__wrAskFeedback'), '注入脚本：问 DSH 按钮 + 页面队列 + 回执函数');
  ok(bootAsk.includes('wr-ask-input') && bootAsk.includes('readerTopBar_title_chapter'), '无选中时的输入兜底 + 章节自动携带');
  ok(bootAsk.includes('__wrSelSnap') && bootAsk.includes('selectionchange'), 'v1.7.12 选区快照：划线消费选区后仍可自动带走（120s）');
  ok(bootAsk.includes("box.style.display = 'flex'") && bootAsk.includes('wrAskBoxTouch') && bootAsk.includes("box.style.display !== 'none'") , 'v1.7.12 预渲染 + v1.7.19 开合切换：框开着再点=收起（不论就绪期是否过期）');
  ok(bootAsk.includes('__wrAskBoxGuards') && bootAsk.includes('setTimeout(wrAskBoxHide, 90000)') && bootAsk.includes("e.key !== 'Escape'"), 'v1.7.19 收纳三保险：90s 无输入自动收起 / 点框外收起 / Esc 收起（监听每文档仅挂一次）');
  ok(bootAsk.includes('wr-ask-item') && bootAsk.includes('toolbarItem.query') && bootAsk.includes('__wrPopupInject'), 'v1.7.13 划选弹条注入：克隆官方 AI问书 按钮注入「问 DSH」');
  ok(bootAsk.includes('DataTransfer.prototype.setData') && bootAsk.includes('__wrClipSnap'), 'v1.7.14 剪贴板钩：截获官方「复制」的 setData（canvas 书选区通路）');
  ok(bootAsk.indexOf('__wrClipSnap.at < 120000') > 0, 'v1.7.14 触发链兜底：DOM选区→选区快照→剪贴板快照→输入框');
  ok(bootAsk.includes('wrArmed') && bootAsk.includes('wrSnapArrived') && bootAsk.includes('截到选区即自动发送'), 'v1.7.15 就绪-自动发：先点问DSH再点复制（时序反转，复制收弹条不再阻碍）');
  ok(bootAsk.includes('wrToolbarAsk') && bootAsk.includes("addEventListener('blur'") && bootAsk.includes('问 DSH：输入问题') && !/askBtn[^;]*wrAskTrigger/.test(bootAsk), 'v1.7.20 工具条✦专职开合输入框：点开/再点收起/失焦自动收起（其余功能已移除）');
  ok(bootAsk.includes('wrPopupAsk') && bootAsk.includes("indexOf('复制')") && bootAsk.includes('items[i].click()'), 'v1.7.20 弹条借道官方复制：真实点击的瞬时激活让 execCommand 放行 → copy 钩截获 → 自动发送+送达');
  ok(bootAsk.includes('__wrCopyCapHooked') && bootAsk.includes("addEventListener('copy'") && bootAsk.includes('官方临时元素选区'), 'v1.7.16 capture-copy：每事件包裹 setData + 复制瞬间选区直读（双保险）');
  ok(bootAsk.includes('__wrApiHooked') && bootAsk.includes('XMLHttpRequest.prototype.send') && bootAsk.includes('__wrApiSnap'), 'v1.7.17 划线接口自捕获：fetch/XHR 钩截获 abstract/markText（点马克笔=文本出口）');
  ok(bootAsk.indexOf('__wrApiSnap.at < 120000') > 0, 'v1.7.17 触发链新增划线快照层');
  ok(bootAsk.includes('wrNavGuard') && bootAsk.includes('wr-nav-hint') && bootAsk.includes('已是最早一页'), 'v1.8.4 导航四键：反馈+连点去抖+死历史兜底（后退无可退→书架）');
  ok(bootAsk.includes('__wrBarObserver') && bootAsk.includes('MutationObserver'), 'v1.8.4 工具栏失联自愈：MutationObserver 即时补回（替代 3s 轮询死窗）');

  // b) 服务级：注入守护轮询排空队列 → onReaderAsk → 回执 evaluate 回写
  {
    const dir = path.join(tmp, 'rw-ask-drain'); fs.mkdirSync(dir, { recursive: true });
    const c = { asks: [], feedbackExprs: [], drained: 0 };
    const w = { alive: false, targets: [], url: 'https://weread.qq.com/web/reader/ask1' };
    const t = () => ({ id: 'A0', type: 'page', url: w.url, webSocketDebuggerUrl: 'ws://127.0.0.1:47870/devtools/page/A0' });
    const depsX = {
      fetchJson: async (p, pathname) => {
        if (!w.alive) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return w.targets;
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (wsUrl, commands) => {
        const cmd = commands[0];
        if (cmd.method === 'Runtime.evaluate' && cmd.params?.expression?.includes('__wrAskDSH') && cmd.params?.expression?.includes('splice')) {
          c.drained += 1;
          const payload = c.drained === 1 ? JSON.stringify([{ seq: 42, q: '', sel: '被选中的书摘原文', book: '书A - 微信读书', chapter: '第一章', url: w.url, at: 1 }]) : null;
          return [{ id: 1, result: { result: { type: 'string', value: payload } } }]; // 真实 CDP 形状：RemoteObject 双层
        }
        if (cmd.method === 'Runtime.evaluate' && cmd.params?.expression?.includes('__wrAskFeedback && window.__wrAskFeedback(')) {
          c.feedbackExprs.push(cmd.params.expression);
          return [{ id: 1, result: {} }];
        }
        return [{ id: 1, result: {} }];
      },
      launchProcess: async () => { w.alive = true; w.targets = [t()]; return { pid: 7300 }; },
      execOpen: async () => ({ ok: false, error: 'no-open' }),
      listPids: async () => [], killPid: () => {}, sleep: async () => {},
      closeTarget: async () => { w.targets = []; },
      chromeExecutable: () => '/fake/Chrome',
      timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 60_000, injectWatch: 40, jamWatch: 60_000 },
      onReaderAsk: async (item) => { c.asks.push(item); return item.sel ? { ok: true, msg: '已送达' } : { ok: false, msg: '内容为空' }; },
    };
    const rw = createReaderWindow({ stateDir: dir, log: () => {}, getCookies: () => undefined, deps: depsX });
    const res = await rw.open(w.url);
    ok(res.ok, '开窗（问 DSH 链路世界）');
    await new Promise((r2) => setTimeout(r2, 200)); // injectWatch=40ms：首轮排空
    ok(c.asks.length === 1 && c.asks[0].sel === '被选中的书摘原文' && c.asks[0].chapter === '第一章', '守护轮询排空页面队列 → onReaderAsk 收到完整载荷');
    ok(c.feedbackExprs.length === 1 && c.feedbackExprs[0].includes('"ok":true'), '回执 evaluate 回写页面（__wrAskFeedback）');
    await new Promise((r2) => setTimeout(r2, 120));
    ok(c.asks.length === 1 && c.drained >= 2, '队列为空后不再触发 onReaderAsk（轮询继续但零重复）');
    rw.dispose();
  }

  // c) apply 级：onReaderAsk 解析本地书 → followup 推送到会话（消息含 bookId/选中/出处要求）
  {
    const regAK = { web: [], tools: [] };
    const followups = [];
    const ctxAK = {
      effect: (fn) => { fn(); return () => {}; }, inject: () => () => {},
      get: (name) => (name === 'agents' ? { roots: () => [{ id: 'sess-live-9', session: 'sess-live-9', status: 'idle', followup: (m) => followups.push(m) }] } : undefined),
      webServer: { register: (x) => regAK.web.push(x) },
      tools: { register: (x) => regAK.tools.push(x) },
    };
    const FUTURE3 = Math.floor(Date.now() / 1000) + 86400;
    const worldA = { alive: false, targets: [], url: 'https://weread.qq.com/web/reader/ak1', drained: 0 };
    const tA = () => ({ id: 'AK0', type: 'page', url: worldA.url, webSocketDebuggerUrl: 'ws://127.0.0.1:47871/devtools/page/AK0' });
    const depsA = {
      fetchJson: async (p, pathname) => {
        if (!worldA.alive) throw new Error('ECONNREFUSED');
        if (pathname === '/json/version') return { Browser: 'Chrome/147.0.0.0', webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/browser/b` };
        if (pathname === '/json/list') return worldA.targets;
        throw new Error('unexpected ' + pathname);
      },
      wsCall: async (wsUrl, commands) => {
        const cmd = commands[0];
        if (cmd.method === 'Runtime.evaluate' && cmd.params?.expression?.includes('__wrAskDSH') && cmd.params?.expression?.includes('splice')) {
          worldA.drained += 1;
          const payload = worldA.drained === 1 ? JSON.stringify([{ seq: 7, q: '这段话什么意思？', sel: '', book: '问询书 - 某作者 - 微信读书', chapter: '第一章', url: worldA.url, at: 1 }]) : null;
          return [{ id: 1, result: { result: { type: 'string', value: payload } } }]; // 真实 CDP 形状：RemoteObject 双层
        }
        return [{ id: 1, result:
          cmd.method === 'Network.getCookies' ? { cookies: [] }
          : cmd.method === 'Browser.getWindowForTarget' ? { windowId: 13, bounds: { left: 0, top: 0, width: 800, height: 600 } }
          : {} }];
      },
      launchProcess: async () => { worldA.alive = true; worldA.targets = [tA()]; return { pid: 7400 }; },
      execOpen: async () => ({ ok: false, error: 'no-open' }),
      listPids: async () => [], killPid: () => {}, sleep: async () => {},
      closeTarget: async () => { worldA.targets = []; },
      chromeExecutable: () => '/fake/Chrome',
      timeouts: { tier1: 20, tier2: 20, ready: 20, boundsWatch: 60_000, injectWatch: 40, jamWatch: 60_000 },
    };
    fs.writeFileSync(path.join(outDir, 'zz-ask-book.md'), '---\ntitle: 问询书\nbookid: AKBOOK1\n---\n## 读书笔记\n\n### 第一章\n\n🖍️ 划线\n> 问询书的划线内容\n\n_记录时间：2026-11-08 10:00:00_\n');
    const disposeAK = apply(ctxAK, { stateDir: path.join(tmp, 'state-ask'), outputPath: outDir, apiToken: SMOKE_TOKEN, readerDeps: depsA });
    const routeAK = regAK.web.find((x) => x.path === '/weread');
    const rs = await call('POST', '/weread/api/open-reader', { url: 'https://weread.qq.com/web/reader/ak1' }, routeAK);
    ok(rs.payload.ok === true, '开窗（ask apply 世界）');
    await new Promise((r2) => setTimeout(r2, 300)); // 轮询排空 + host 异步 followup
    ok(followups.length === 1, `onReaderAsk → agent.followup 恰好一次（${followups.length}）`);
    const msg = followups[0];
    const text = msg?.content?.[0]?.text ?? '';
    ok(msg?.role === 'user' && msg?.source?.kind === 'weread-reader' && typeof msg?.id === 'string', 'followup 消息形状（user 角色 + 来源标记 + 稳定 id）');
    ok(text.includes('问询书') && text.includes('bookId=AKBOOK1') && text.includes('问询书的划线内容'), '消息带本地书解析（bookId + 文件 + 近期划线上下文）');
    ok(text.includes('这段话什么意思？') && text.includes('标注来源书名'), '消息带用户问题 + 引用规范要求（防跨书混同）');
    // 限频：10s 内第二条被拒
    const q2 = await new Promise((r3) => setTimeout(r3, 60));
    worldA.drained = 0; // 复位让下轮再吐一条
    // 直接再喂一条：把 drained 重置后下一轮返回新载荷
    await new Promise((r2) => setTimeout(r2, 100));
    ok(followups.length === 1, '限频生效：10 秒内第二条不推送（页面收到失败回执）');
    disposeAK();
  }
}

// 13.7 卸载清理（v1.0，最后执行：先关 Keychain 镜像避免动真实钥匙串，再验证清理）
r = await call('POST', '/weread/api/config', { keychain: false });
dispose3();
const reg4 = { web: [], tools: [] };
const ctx4 = { effect: (fn) => { fn(); return () => {}; }, inject: () => () => {}, webServer: { register: (x) => reg4.web.push(x) }, tools: { register: (x) => reg4.tools.push(x) } };
const dispose4 = apply(ctx4, { stateDir: path.join(tmp, 'state'), outputPath: '', apiToken: SMOKE_TOKEN });
route = reg4.web.find((x) => x.path === '/weread');
r = await call('POST', '/weread/api/uninstall/cleanup');
ok(r.status === 400, '卸载清理缺 confirm 确认参数被拒（P1-5）');
r = await call('POST', '/weread/api/uninstall/cleanup', { confirm: true });
ok(r.status === 200 && r.payload.ok === true, '卸载清理执行');
ok(r.payload.files.length >= 1, `清理移除 ${r.payload.files.length} 个状态 JSON`);
const remaining = fs.readdirSync(path.join(tmp, 'state')).filter((f) => f.endsWith('.json'));
ok(remaining.length === 0, `状态目录 JSON 已清空（剩 ${remaining.length}）`);
dispose4();

// 14. §11-6 面板实时化：wsbus 端到端（真 http upgrade + 真 WebSocket 客户端）
{
  const { createServer } = await import('node:http');
  const { createWsBus } = await import('./lib/wsbus.mjs');
  const bus = createWsBus({ log: () => {} });
  const server = createServer();
  server.on('upgrade', (req, socket, head) => bus.handler(req, socket, head));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // P2-13（对抗审查 v2）：Origin 校验——跨源握手被拒（与 HTTP 路由同源策略对齐）
  const port0 = server.address().port;
  const evil = new WebSocket(`ws://127.0.0.1:${port0}/weread/ws`, { headers: { Origin: 'https://evil.example.com' } });
  const evilClosed = await new Promise((r) => { evil.onclose = () => r(true); evil.onerror = () => r(true); });
  ok(evilClosed, 'wsbus 跨源 Origin 握手被拒（非同源即断）');
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/weread/ws`);
  const got = [];
  ws.onmessage = (ev) => { try { got.push(JSON.parse(ev.data)); } catch (e) { /* ignore */ } };
  await new Promise((r, rej) => { ws.onopen = r; ws.onerror = rej; });
  const n = bus.broadcast('roaming', { action: 'next' });
  ok(n === 1 && bus.clientCount() === 1, 'wsbus broadcast 送达在线客户端（握手 + 注册成功）');
  await new Promise((r) => setTimeout(r, 200));
  ok(got.some((m) => m.type === 'hello'), 'wsbus 连接即推 hello');
  ok(got.some((m) => m.type === 'roaming' && m.payload.action === 'next'), 'wsbus 业务事件全链路（真 WS 客户端收到）');
  // P2-12（对抗审查 v2）：异常大帧拆线——>1MB 客户端帧直接断连（防滥用），连接被移出广播列表
  ws.send('x'.repeat((1 << 20) + 64));
  await new Promise((r) => setTimeout(r, 300));
  ok(bus.clientCount() === 0, 'wsbus 超大帧（>1MB）客户端被拆线（clientCount 归零）');
  try { ws.close(); } catch (e) { /* ignore */ }
  bus.dispose();
  await new Promise((r) => server.close(r));
}

dispose4();
fs.rmSync(tmp, { recursive: true, force: true });
clearTimeout(smokeKiller);
console.log(`\nALL PASS (${asserts} asserts)`);
