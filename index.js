/**
 * 微信读书 DSH 插件（Host 半）
 * 由 weread-vscode 0.1.2（MIT）移植：微信读书笔记同步、Markdown 导出、笔记搜索、
 * 阅读洞察与笔记漫游。Host 负责 API/登录/同步/索引/统计，并通过 webServer
 * 向 Client（client.js，main 面板 weread）提供 JSON API，同时注册 Agent 工具。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createStore } from './lib/store.js';
import { createAuthManager } from './lib/auth.js';
import * as api from './lib/api.js';
import { createIndexService } from './lib/indexsvc.js';
import { createSyncService } from './lib/sync.js';
import { createAnalyticsService } from './lib/analytics.js';
import { createRoamingService } from './lib/roaming.js';
import { createCleanupService } from './lib/cleanup.js';
import * as markdown from './lib/markdown.js';
import { createGatewayClient, apiKeyTail, SKILL_VERSION } from './lib/gateway.js';
import { createReaderWindow } from './lib/readerWindow.js';
import { createWsBus } from './lib/wsbus.mjs';
import { createSvg as createQrSvg } from './lib/vendor/qrcode/index.cjs'; // v1.8.8：本地二维码（去 qrserver.com 外网依赖）
import { collectDirEntries, writeZipFile } from './lib/zip.mjs';

// 不声明 schemastery Config(本地链接安装时裸 JSON schema 无 .validate 会激活失败);
// 配置默认值在 apply(rawConfig) 内联,运行时改动经 /api/config 写入 stateDir/prefs.json。
export const inject = ['webServer', 'tools', 'systemPrompt', 'commands', 'fs', 'agents'];
// systemPrompt 为可选增强（A2 阅读上下文注入），在 apply 内经 ctx.inject 可选接入。

/** v1.9.11 宿主调用方认证：常时比较两个令牌字符串（timing-safe；长度差异提前返回不泄密）。 */
export function safeTokenEqual(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * v1.9.12 宿主调用方认证判定（导出供单测）：Bearer（MCP/本地工具）或 admit（宿主签名
 * cookie，经 ctx.inject(['connection']) 动态注入捕获，绝不直接读 ctx.connection——Cordis
 * 代理对未声明 inject 的服务属性访问直接抛错，?. 无法绕过）其一通过。
 * @param {{ bearerOk: (t: string) => boolean, getAdmit: () => null | ((req: any) => Promise<void>) }} deps
 * @returns {(req: any) => Promise<boolean>}
 */
export function createCallerAuthenticated({ bearerOk, getAdmit }) {
  return async (req) => {
    const authHeader = String(req.headers?.authorization || '');
    if (authHeader.startsWith('Bearer ') && bearerOk(authHeader.slice(7))) return true;
    const admit = getAdmit();
    if (typeof admit !== 'function') return false;
    // dshopen #522 复审：DSH connection.admit 拒绝时不抛异常而是返回 { rejection: 401|403 }，
    // 明确准入才返回 { peer }。必须「仅在明确准入时继续」——把 rejection 结果当成功会放行
    // 未认证请求；throw 只是兜底（await 兼容未来异步化）。
    try {
      const admission = await admit(req);
      if (!admission || typeof admission !== 'object') return false;
      if ('rejection' in admission) return false;
      return admission.peer !== undefined;
    } catch { return false; }
  };
}


const DEFAULT_THEMES = [
  { id: 'white', name: '纯白', bg: '#FFFFFF', primary: '#312927', weekday: '#5A514D', divider: '#D5CEC4', watermark: '#757575' },
  { id: 'gray', name: '浅灰', bg: '#F5F5F5', primary: '#312927', weekday: '#5A514D', divider: '#D5CEC4', watermark: '#757575' },
  { id: 'yellow', name: '暖黄', bg: '#FDF6E3', primary: '#382C24', weekday: '#5C4A3D', divider: '#E6D3B8', watermark: '#8C7765' },
  { id: 'green', name: '浅绿', bg: '#EAF4EC', primary: '#1E3624', weekday: '#3D5C45', divider: '#C2DBC7', watermark: '#6F8C76' },
  { id: 'dark', name: '暗夜黑', bg: '#1E1E1E', primary: '#E0E0E0', weekday: '#B0B0B0', divider: '#404040', watermark: '#808080' },
  { id: 'blue', name: '深蓝', bg: '#1A2332', primary: '#DDE2ED', weekday: '#A9B4C7', divider: '#34415B', watermark: '#7887A1' },
  { id: 'pink', name: '莫兰迪粉', bg: '#F6EBEA', primary: '#4A3130', weekday: '#6B4A49', divider: '#E0CACA', watermark: '#9C7A79' },
  { id: 'kraft', name: '牛皮纸', bg: '#E8DCC8', primary: '#3B2F23', weekday: '#594A3A', divider: '#C9B8A1', watermark: '#8A7B68' },
];

const INTERVAL_MS = { '12h': 12 * 3600_000, '24h': 24 * 3600_000, '72h': 72 * 3600_000 };

export function apply(ctx, rawConfig = {}) {
  const disposers = [];
  const track = (d) => { disposers.push(d); return d; };

  // ---------- 状态目录与偏好 ----------
  const stateDir = (rawConfig.stateDir && String(rawConfig.stateDir).trim()) || path.join(os.homedir(), '.dsh', 'weread');
  fs.mkdirSync(stateDir, { recursive: true });
  const store = createStore(stateDir);

  const prefsFile = path.join(stateDir, 'prefs.json');
  const readPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; } };
  const writePrefs = (next) => fs.writeFileSync(prefsFile, JSON.stringify(next, null, 2));
  let prefs = readPrefs();

  const config = () => ({
    outputPath: prefs.outputPath ?? rawConfig.outputPath ?? '',
    fileNameTemplate: prefs.fileNameTemplate ?? rawConfig.fileNameTemplate ?? '{{title}}',
    noteTemplate: prefs.noteTemplate ?? rawConfig.noteTemplate ?? '',
    autoSync: prefs.autoSync ?? rawConfig.autoSync ?? true,
    syncInterval: prefs.syncInterval ?? rawConfig.syncInterval ?? '24h',
    categoryMode: prefs.categoryMode ?? rawConfig.categoryMode ?? 'level1',
    showCover: prefs.showCover ?? rawConfig.showCover ?? true,
    multiAccountEnabled: prefs.multiAccountEnabled ?? rawConfig.multiAccountEnabled ?? true,
    uiSidebarKpi: prefs.uiSidebarKpi ?? rawConfig.uiSidebarKpi ?? true,
    uiComposerRoaming: prefs.uiComposerRoaming ?? rawConfig.uiComposerRoaming ?? true,
    uiRoamingScrollMode: prefs.uiRoamingScrollMode ?? rawConfig.uiRoamingScrollMode ?? 'marquee',
    uiRoamingFontSize: Math.min(16, Math.max(10, Number(prefs.uiRoamingFontSize ?? rawConfig.uiRoamingFontSize ?? 12) || 12)),
    uiRoamingScrollSpeed: Math.min(100, Math.max(20, Number(prefs.uiRoamingScrollSpeed ?? rawConfig.uiRoamingScrollSpeed ?? 48) || 48)),
    uiRoamingRotateEnabled: prefs.uiRoamingRotateEnabled ?? rawConfig.uiRoamingRotateEnabled ?? true,
    uiRoamingRotateSec: Math.min(1800, Math.max(30, Number(prefs.uiRoamingRotateSec ?? rawConfig.uiRoamingRotateSec ?? 30) || 30)),
    // v0.5 AI 集成配置（A2 上下文注入可配置化）
    ctxInjectEnabled: prefs.ctxInjectEnabled ?? rawConfig.ctxInjectEnabled ?? true,
    ctxBookCount: Math.min(10, Math.max(1, Math.floor(Number(prefs.ctxBookCount ?? rawConfig.ctxBookCount ?? 5)) || 5)),
    ctxIncludeHighlights: prefs.ctxIncludeHighlights ?? rawConfig.ctxIncludeHighlights ?? true,
    ctxHighlightCount: Math.min(10, Math.max(1, Math.floor(Number(prefs.ctxHighlightCount ?? rawConfig.ctxHighlightCount ?? 3)) || 3)),
    ctxExcludeTitles: String(prefs.ctxExcludeTitles ?? rawConfig.ctxExcludeTitles ?? ''),
    // v1.8.7：语言默认 auto（跟随 DSH 宿主语言）；存量 prefs 已存具体值的用户不受影响
    language: prefs.language ?? rawConfig.language ?? 'auto',
    exportThemes: prefs.exportThemes ?? rawConfig.exportThemes ?? DEFAULT_THEMES,
    // v1.0 阅读目标（每周笔记条数，0=关闭）
    weeklyGoalNotes: Math.min(10000, Math.max(0, Math.floor(Number(prefs.weeklyGoalNotes ?? rawConfig.weeklyGoalNotes ?? 0)) || 0)),
    // v1.8.20：关窗即退出阅读窗口实例（默认开——关窗后程序坞不留 Chrome 图标；关掉=实例常驻重开秒回）
    readerWindowQuitOnClose: prefs.readerWindowQuitOnClose ?? rawConfig.readerWindowQuitOnClose ?? true,
  });
  const configGetter = config;

  // ---------- 日志（内存环形缓冲，对应原 OutputChannel×4） ----------
  const LOG_CHANNELS = { op: '操作', roaming: '漫游', dedupe: '去重', cleanup: '清理' };
  const logBufs = Object.fromEntries(Object.keys(LOG_CHANNELS).map((k) => [k, []]));
  const log = (channel) => (level, message) => {
    const buf = logBufs[channel] ?? logBufs.op;
    buf.push(`[${new Date().toISOString()}] [${level}] [WeRead:${channel}] ${message}`);
    if (buf.length > 400) buf.splice(0, buf.length - 400);
    if (level === 'ERROR') console.error(`[weread:${channel}] ${message}`);
  };
  const logOp = log('op'); const logRoam = log('roaming'); const logDedupe = log('dedupe'); const logCleanup = log('cleanup');

  // ---------- 服务装配 ----------
  // v1.1 官方网关客户端：apiKey 取自活跃账号（secrets.json/Keychain），upgrade_info 落 scoped KV（state 轮询带走）
  const gateway = createGatewayClient({
    log: logOp,
    getState: (key) => store.getState(store.getActiveAccountId(), key, null),
    setState: (key, value) => store.setState(store.getActiveAccountId(), key, value),
  });
  /** 活跃账号的 Key 注入网关；返回是否在场 */
  const syncGatewayKey = () => {
    const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
    if (key) gateway.setApiKey(key);
    else gateway.clearApiKey();
    return !!key;
  };
  const index = createIndexService({
    store, markdown, configGetter, log: logDedupe,
    // v1.4.6：索引内容变化重建后清漫游池缓存（roaming 在下方创建，回调执行时已就绪）
    onRebuilt: () => { try { roaming?.invalidatePools?.(); } catch { /* ignore */ } },
  });
  const cleanup = createCleanupService({ store, markdown, configGetter, log: logCleanup });
  const sync = createSyncService({
    api, store, index, markdown, cleanup, configGetter: config, log: logOp, gateway,
    // v1.9.1 修复参数错位：sync.updateProgress 的调用签名是 (step, currentIndex, total, p)——
    // 进度对象在第 4 参。原 `(p) => { syncProgress = p; }` 把第 1 参的阶段字符串当对象存了，
    // stateView.syncProgress 恒为字符串 → 客户端 totalBooks 恒 undefined → v1.8.10 的「X/N 本」
    // 进度显示从未真正工作过（书架只显示「同步中」转圈，真机 2026-11-10 反馈）。
    onProgress: (_step, _currentIndex, _total, p) => {
      if (!p || typeof p !== 'object') return;
      syncProgress = p;
      try { // §11-6：调度自动同步也会走这里——相位变化即广播（手动路径由 sync 路由显式广播）
        const ph = String(p.currentStep ?? '');
        if (ph && ph !== lastSyncPhase) { lastSyncPhase = ph; wsBus.broadcast('sync', { phase: ph }); }
      } catch { /* 广播失败不影响同步 */ }
    },
  });
  const analytics = createAnalyticsService({ index });
  const roaming = createRoamingService({ index, store, log: logRoam });
  // v1.7.6 阅读窗口会话互通原语：任意 vid/skey 的服务端裁决（x-vid/x-skey 裸接口，不动 apiClient 状态）
  const checkSessionByHeaders = async (vid, skey) => {
    try {
      if (!vid || !skey) return undefined;
      const info = await api.fetchUserInfo(String(vid), String(skey));
      const user = info?.user || info?.data || info;
      return !!(user?.userId || user?.userVid);
    } catch { return undefined; } // 网络异常：不裁决（保守，不覆盖窗内会话）
  };
  // v1.5.0 单例阅读窗口（WebBar 单 panel 模型）：Chrome app 窗口 + 专用 profile + CDP 复用导航
  let lastReaderAskAt = 0; // v1.7.7 选中即问限频
  const lastReaderAskDiag = { at: 0, ok: null, msg: '', roots: -1 }; // v1.7.10 诊断：最近一次问 DSH 的结果
  // v1.7.6 反向同步 + v1.8.10 登录弹层共享：窗内会话有效而插件 Cookie 通道缺失/已死 → 采纳窗内会话
  // （窗内扫码一次，插件/窗内/弹层三处同步活）。auth 在下方创建——此函数只在事件后调用，惰性可达。
  // v1.9.2 #1（对抗审查）：确定性拒绝加 1h 冷却——A2 回流守护每 10min 上报不同源会话，若插件凭据
  // 已死且窗内会话不可采纳（vid 不匹配/窗内也死），原逻辑每轮都重复 mineOk 服务端探测（日增上百次
  // 裸接口请求，违背风控哲学）。冷却按上报指纹（vid|skey）记：同指纹 1h 内直接跳过；网络异常
  // （winOk=undefined）不冷却——不惩罚瞬时故障。插件凭据换血/窗内换新会话 → 指纹变 → 不受影响。
  const adoptRejectCooldown = new Map(); // `vid|skey` -> 拒绝时间
  const ADOPT_REJECT_COOLDOWN_MS = 60 * 60 * 1000;
  const markAdoptRejected = (key) => {
    if (adoptRejectCooldown.size >= 32) adoptRejectCooldown.delete(adoptRejectCooldown.keys().next().value);
    adoptRejectCooldown.set(key, Date.now());
  };
  const adoptWindowSession = async ({ wrVid, wrSkey }) => {
    try {
      if (!wrVid || !wrSkey) return false;
      const current = (() => { try { return store.getCookies(); } catch { return undefined; } })();
      const cur = current ? api.extractSessionFromCookies(current) : undefined;
      if (cur?.skey === wrSkey) return true; // 已同源
      const fingerprint = `${wrVid}|${wrSkey}`;
      const rejectedAt = adoptRejectCooldown.get(fingerprint) ?? 0;
      // P2（时钟回拨）：冷却时间戳在未来 → 判定回拨失效，不再阻塞采纳探测
      if (Date.now() - rejectedAt < ADOPT_REJECT_COOLDOWN_MS && rejectedAt <= Date.now() + 60_000) {
        return false; // 冷却中：该窗内会话近期已被确定性拒绝，不再探测（回流守护每 10min 重报同指纹）
      }
      // 插件凭据仍有效 → 不打扰（窗内是另一会话，可能另一账号；数据通道以插件为准）
      if (current && cur?.skey) {
        const mineOk = await checkSessionByHeaders(cur.vid, cur.skey);
        if (mineOk) { markAdoptRejected(fingerprint); return false; }
      }
      // 账号保护：窗内 vid 必须匹配活跃账号（无账号记录时放行）——防把别的账号会话挂到当前账号下
      const acc = activeAccount().account;
      if (acc?.wrVid && String(acc.wrVid) !== String(wrVid)) {
        logOp('INFO', `reader-window 窗内会话 vid=${wrVid} 与当前账号 vid=${acc.wrVid} 不同，跳过同步`);
        markAdoptRejected(fingerprint);
        return false;
      }
      const winOk = await checkSessionByHeaders(wrVid, wrSkey);
      if (winOk === false) { markAdoptRejected(fingerprint); return false; } // 窗内会话确定性已死：不采纳 + 冷却
      if (winOk !== true) return false; // 网络异常：不采纳也不冷却（下次照试）
      // 采纳：走统一登录落账（账号记录 + Cookie 通道 + apiClient + 登录态广播）。
      // 不手写 saveCookies——stateView 的 loggedIn 要求账号在场（loginState && acc.id）。
      const res = await auth.handleLoginSuccess({
        cookies: `wr_vid=${wrVid}; wr_skey=${wrSkey}`,
        vid: String(wrVid),
        skey: String(wrSkey),
        token: String(wrSkey),
        session: String(wrVid),
        source: 'window', // v1.9.0 B2：来源标记（authMeta.cookieOrigin 供设置页展示）
      }).catch((e) => { logOp('WARN', `reader-window 窗内会话采纳失败：${e?.message || e}`); return undefined; });
      if (res) logOp('INFO', `reader-window 窗内会话已同步回插件 Cookie 通道（${res.name ?? ''}）——扫码/换血后三处一致，免重登`);
      return !!res;
    } catch { return false; /* best effort */ }
  };
  const readerWindow = createReaderWindow({
    stateDir,
    log: logOp,
    // v1.8.10：多账号隔离——profile/state 按活跃账号分目录，切账号后窗口登录态独立。
    // 测试可经 rawConfig.getAccountId 注入固定值（会话互通世界保持单账号语义）
    getAccountId: typeof rawConfig.getAccountId === 'function' ? rawConfig.getAccountId
      : () => { try { return store.getActiveAccountId() ?? ''; } catch { return ''; } },
    getCookies: () => { try { return store.getCookies(); } catch { return undefined; } },
    deps: {
      // v1.8.20：关窗即退出（默认开）——设置页「关窗即退出 Chrome 实例」开关，决策时实时读
      quitOnClose: () => { try { return config().readerWindowQuitOnClose !== false; } catch { return true; } },
      // v1.7.6 会话互通：窗内 skey 与插件不同时服务端裁决（死→换血注入，活→上报宿主）
      checkSession: ({ wrVid, wrSkey }) => checkSessionByHeaders(wrVid, wrSkey),
      // v1.7.6 反向同步 + v1.8.10 登录弹层共享（adoptWindowSession 见上方）
      onWindowSession: (s) => { void adoptWindowSession(s); },
      // v1.7.7 选中即问：阅读窗口「问 DSH」队列项 → 解析本地书 → followup 唤醒会话作答。
      // 差异化（vs 微信读书自带 AI问书）：以本地笔记为据、带用户划线上下文、要求标章节出处、
      // 引其他书必须标明书名（实测官方 AI问书会把其他书内容当本书内容作答，chatid=search_entrance）。
      onReaderAsk: async (item) => {
        const diag = (ok, msg, roots) => {
          lastReaderAskDiag.at = Date.now(); lastReaderAskDiag.ok = ok;
          lastReaderAskDiag.msg = String(msg ?? ''); lastReaderAskDiag.roots = roots ?? -1;
          if (ok !== true) logOp('WARN', `reader-ask 失败：${lastReaderAskDiag.msg}（roots=${lastReaderAskDiag.roots}）`);
        };
        try {
          const q = String(item?.q || '').trim();
          const sel = String(item?.sel || '').trim();
          if (!q && !sel) { const m = '内容为空'; diag(false, m); return { ok: false, msg: m }; }
          if (Date.now() - lastReaderAskAt < 10_000) { const m = '发送太频繁，请稍候再试'; diag(false, m); return { ok: false, msg: m }; }
          lastReaderAskAt = Date.now();
          // v1.7.10：双通道取 agents 服务（inject 声明的 ctx.agents 优先，ctx.get 兜底）——
          // 首版真机失败无日志，此路径全部留痕
          const agentsSvc = ctx.agents ?? (typeof ctx.get === 'function' ? ctx.get('agents') : undefined);
          const roots = agentsSvc?.roots?.() ?? [];
          if (!agentsSvc) { const m = 'DSH 会话服务不可用（ctx.agents/ctx.get 均无）'; diag(false, m, -1); return { ok: false, msg: m }; }
          const agent = roots[roots.length - 1];
          if (!agent || typeof agent.followup !== 'function') { const m = '没有活跃的 DSH 会话（先打开/唤醒 DSH 对话再试）'; diag(false, m, roots.length); return { ok: false, msg: m }; }
          const accountId = store.getActiveAccountId() ?? undefined;
          const pageBook = String(item.book || '').split(' - ')[0].trim();
          const books = await index.queryBooks(accountId).catch(() => []);
          const hit = books.find((b) => String(b.title || '') === pageBook)
            ?? books.find((b) => pageBook && String(b.title || '').includes(pageBook))
            ?? books.find((b) => b.title && pageBook.includes(String(b.title)));
          const ctxLines = [];
          if (hit) {
            ctxLines.push(`本地笔记：bookId=${hit.bookId}${hit.localFilePath ? `，笔记文件=${hit.localFilePath}` : ''}（可用 weread 工具 notes/ask 动作查全书）`);
            try {
              const notes = await index.getNotesByBookId(hit.bookId, accountId) ?? [];
              const hls = notes.filter((n) => n.highlightText).slice(-3)
                .map((n) => `「${String(n.highlightText).slice(0, 60).replace(/\n/g, ' ')}」${n.chapterTitle ? `（${n.chapterTitle}）` : ''}`);
              if (hls.length) ctxLines.push(`用户在本书的近期划线：${hls.join('；')}`);
            } catch { /* ignore */ }
          }
          const lines = [
            '[微信读书·选中即问]（用户在阅读窗口发起的提问，请直接回答）',
            `《${hit?.title ?? (pageBook || '当前阅读')}》${item.chapter ? ` · ${item.chapter}` : ''}`,
            sel ? `选中内容：「${sel.slice(0, 1200)}」` : '',
            q ? `用户问题：${q.slice(0, 500)}` : '',
            ...ctxLines,
            '要求：优先基于本书的本地笔记/Markdown 文件回答；只引用本书内容并注明章节出处；若确需引用其他书，必须明确标注来源书名，不得与本书内容混同。',
          ].filter(Boolean);
          const message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: lines.join('\n') }],
            source: { kind: 'weread-reader' },
          };
          try {
            agent.followup(message);
          } catch (e) {
            const m = `followup 投递异常：${e?.message || e}`;
            diag(false, m, roots.length);
            return { ok: false, msg: '推送会话失败（详见插件日志）' };
          }
          // v1.7.13：回执标明送达了哪个会话（多会话并行时用户不再找不到答案）
          const titlesSvc = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : undefined;
          let destTitle = '';
          try { destTitle = titlesSvc?.get?.(agent.session) || ''; } catch { /* 无标题服务即省略 */ }
          const destLabel = destTitle ? `「${String(destTitle).slice(0, 24)}」` : ` ${String(agent.id ?? '').slice(0, 10)} `;
          diag(true, `已推送会话 ${String(agent.id ?? '').slice(0, 10)}（${destTitle || '无标题'}）（《${hit?.title ?? pageBook}》）`, roots.length);
          logOp('INFO', `reader-ask ${lastReaderAskDiag.msg}`);
          return { ok: true, msg: `已送达 DSH${destLabel}，回答见该会话` };
        } catch (e) {
          const m = e?.message || String(e);
          diag(false, m);
          return { ok: false, msg: m };
        }
      },
      ...(rawConfig.readerDeps ?? {}), // 测试注入口（覆盖默认裁决/上报原语；生产不传）
    },
  });
  track(() => readerWindow.dispose()); // v1.5.4：停掉 bounds 守护定时器

  // 漫游会话视图适配：roaming 服务导出细粒度方法，这里组装为 Client 需要的快照
  const roamingKey = (accountId) => accountId || store.getActiveAccountId() || 'default';
  const roamingView = (session) => {
    const nowMs = Date.now();
    const view = {
      card: session.history?.[session.currentIndex] ?? null,
      index: session.currentIndex + 1,
      total: session.history?.length ?? 0,
      poolSize: session.pool?.length ?? 0,
      statsPoolSize: session.statsPool?.length ?? 0,
      metrics: { ...(session.metrics ?? {}) },
      filter: session.filter,
      reviewMode: !!session.reviewMode,
      dueCount: (session.statsPool ?? []).filter((c) => c.meta?.sm2Due > 0 && c.meta.sm2Due <= nowMs).length,
      stats: roaming.buildStats(session.accountId),
    };
    if (session.reviewMode) {
      const seen = new Set((session.history ?? []).map((c) => c.noteKey));
      view.dueRemaining = (session.pool ?? []).filter((c) => !seen.has(c.noteKey)).length;
    }
    return view;
  };
  const roamingExtras = (r) => {
    const out = {};
    if (r?.tip !== undefined) out.tip = r.tip;
    if (r?.empty) { out.empty = true; out.reason = r.reason; }
    return out;
  };
  const roamingSessionView = async (accountId) => {
    const key = roamingKey(accountId);
    // v1.7.3：① 池为空（重启续读后台重建中）→ 等待建好；② 池建在最近索引重建之前（部分数据）→ 自动重载自愈。
    // 修「初始 1/1、切标签才变 1/58」的残留路径：不依赖用户切标签。
    if (roaming.isSessionStale(roaming.getSession(key))) {
      const r = await roaming.reloadSession(key, roaming.getSession(key).filter);
      const session = roaming.getSession(key);
      return { ...roamingView(session), ...roamingExtras(r) };
    }
    let session = await roaming.ensurePoolsReady(key);
    if (!session.history.length) {
      const r = await roaming.reloadSession(key);
      session = roaming.getSession(key);
      return { ...roamingView(session), ...roamingExtras(r) };
    }
    return roamingView(session);
  };
  const roamingAction = async (action, accountId, body = {}) => {
    const key = roamingKey(accountId);
    // P2-8（对抗审查 v2）：非法 grade 直接拒绝——原版非 'forgot' 一律按 'good' 计，拼写错静默污染 SM-2 间隔
    if (action === 'review' && body.grade !== undefined && !['good', 'forgot'].includes(String(body.grade))) {
      throw new Error(`非法复习评分：${body.grade}（仅支持 good / forgot）`);
    }
    let r;
    if (action === 'next' || action === 'skip') r = await roaming.sessionNext(key);
    else if (action === 'prev') r = await roaming.sessionPrev(key);
    else if (action === 'review') r = await roaming.sessionReview(key, body.grade === 'forgot' ? 'forgot' : 'good');
    else if (action === 'reviewStart') r = await roaming.startReviewSession(key);
    else if (action === 'reviewEnd') r = await roaming.reloadSession(key);
    else if (action === 'favorite' || action === 'unfavorite') r = await roaming.sessionToggleFavorite(key);
    else if (action === 'openSource' || action === 'openEdit') r = await roaming.sessionOpenSource(key);
    else if (action === 'refresh') r = await roaming.reloadSession(key);
    else throw new Error(`未知漫游操作：${action}`);
    if (r?.error) throw new Error(r.error);
    const session = roaming.getSession(key);
    return { ...roamingView(session), ...roamingExtras(r) };
  };
  const roamingApplyFilter = async (filter, accountId) => {
    const key = roamingKey(accountId);
    const r = await roaming.reloadSession(key, filter);
    const session = roaming.getSession(key);
    return { ...roamingView(session), ...roamingExtras(r) };
  };

  const auth = createAuthManager(store, api, logOp, gateway);
  auth.setMultiAccountPolicy?.(() => config().multiAccountEnabled !== false); // v1.8.7：假开关转真行为

  let syncProgress = null;
  let lastSyncPhase = '';
  let loginState = { loggedIn: false, expired: false };
  auth.onDidChangeLoginState((v) => {
    loginState.loggedIn = v;
    if (v) {
      loginState.expired = false; // 登录成功广播即视为有效
      // v1.9.0 A1：登录成功即推窗——打开中的窗口若还挂着死会话，立即换血+重载（免等下次开书）。
      // 窗口不在场/同源健康时是廉价 no-op；loginByApiKey 触发也无害（无新 Cookie 可推）。
      try { void readerWindow.pushSession?.(); } catch { /* best effort */ }
    }
  });
  // 启动：本地有 cookie 或 API Key 即注入并后台校验（v1.1 三通道）
  try {
    const cookies = store.getCookies();
    const apiKey = syncGatewayKey();
    if (cookies) api.apiClient.setCookies(cookies);
    if (cookies || apiKey) {
      loginState.loggedIn = true;
      // v1.9.0 C2：启动后台校验后，凭据若已死先试从阅读窗口救活（孤儿窗口场景）再定性
      void classifyLoginState().then(() => tryRescueFromWindow('startup')).catch(() => {});
    }
  } catch { /* ignore */ }
  ctx.effect(() => track(() => { try { auth.dispose?.(); } catch { /* ignore */ } }));

  // ---------- 接口健康（区分「接口不可达」与「本地无数据/凭据失效」，供 UI 降级横幅与工具 status） ----------
  let apiHealth = { ok: null, checkedAt: 0, reason: '' }; // ok: null 未知 / true 可达 / false 不可达
  const NETWORK_ERR_RE = /network|timeout|abort|enotfound|econnrefused|etimedout|eai_again|fetch failed|请求失败|网络/i;
  const markApiHealth = (ok, reason = '') => {
    apiHealth = { ok, checkedAt: Date.now(), reason: ok ? '' : String(reason || '网络异常').slice(0, 200) };
  };
  const probeApi = async () => {
    try { await api.measureWereadTtfb(3000); markApiHealth(true); return true; }
    catch (e) { markApiHealth(false, e?.message || e); return false; }
  };

  // ---------- v1.0.6 登录态真实性分类 ----------
  // v1.9.0 C2：凭据失效时的窗内会话救活——exportWindowSession + adoptWindowSession 复用
  // （弹层核验 v1.8.10 同款逻辑搬到启动/同步复核路径）。窗口关着时 export 秒回 null（零成本）；
  // 窗口在场（孤儿实例/用户正读着）时窗内会话往往比插件凭据新——救活免重扫码。
  const tryRescueFromWindow = async (reason) => {
    try {
      if (loginState.loggedIn && !loginState.expired) return false;
      const winSession = await readerWindow.exportWindowSession?.().catch(() => null);
      if (!winSession) return false;
      const adopted = await adoptWindowSession(winSession);
      if (adopted) logOp('INFO', `reader-window 插件凭据失效，已从窗内会话救活（${reason}）——免重扫码`);
      return adopted;
    } catch { return false; /* best effort */ }
  };
  // 宽限期（7 天）内 checkLoginStatus 会因 lastVerifiedAt 新鲜而返回 true（保数据可用，防网络抖动误登出），
  // 但服务端可能已判凭据无效（errCode -2010）。expired 单独暴露：UI 显示「登录已过期」，同步入口 401。
  // v1.0.9 同步前实时复核：上次裸校验超过 2 分钟即重问服务端（宽限/缓存不得掩盖过期）
  const ensureLoginFresh = async () => {
    try {
      if (!store.getCookies() && !store.getApiKey()) { loginState.loggedIn = false; loginState.expired = false; return; }
      const raw = auth.getLastRawCheck?.();
      if (raw && raw.at && Date.now() - raw.at < 2 * 60_000) return; // 刚验过
      const ok = await auth.verifyNow();
      if (ok === true) { loginState.loggedIn = true; loginState.expired = false; markApiHealth(true); }
      else if (ok === false) {
        loginState.loggedIn = false; loginState.expired = true;
        // v1.9.0 C2：凭据判死时尝试从阅读窗口救活（窗口在场=用户可能刚在窗内活跃过；
        // 窗口关着则 export 秒回 null，零成本）。采纳成功会广播登录态，本函数下次复核即转绿。
        void tryRescueFromWindow('sync-verify');
      }
      // null（网络异常）：保持现状，交由 apiHealth 降级路径
    } catch { /* ignore */ }
  };

  // v1.9.0 修复存量 TDZ：原 `const classifyLoginState = ...` 声明在启动调用点（上方 ~L369）之后，
  // 启动分类的 ReferenceError 被外层 try/catch 静默吞掉——v1.0.6 的启动校验从未真正执行。
  // 改为函数声明（整体提升），启动/30min 复检两条路径都真实跑起来。
  async function classifyLoginState() {
    try {
      const ok = await auth.checkLoginStatus().catch(() => null);
      if (ok === null) { await probeApi(); return; } // 校验异常：只更新接口健康，登录态保持
      const raw = auth.getLastRawCheck?.();
      if (ok) {
        const expired = raw?.ok === false; // 管理器宽限 true 但底层 API 已判无效
        loginState.loggedIn = !expired;
        loginState.expired = expired;
        if (!expired) markApiHealth(true);
      } else {
        loginState.loggedIn = false;
        loginState.expired = false;
        await probeApi(); // false：区分凭据过期（接口可达）与接口不可达
      }
    } catch { /* ignore */ }
  }

  const activeAccount = () => {
    const id = store.getActiveAccountId();
    const accounts = store.listAccounts();
    const acc = accounts.find((a) => a.accountId === id) ?? accounts[0];
    return { id: acc?.accountId ?? null, account: acc ?? null, accounts };
  };

  const currentAccountView = () => {
    const { id, account, accounts } = activeAccount();
    return {
      id,
      name: account?.displayName ?? account?.userId ?? null,
      avatar: account?.avatar ?? null,
      accounts: accounts.map((a) => ({ id: a.accountId, name: a.displayName ?? a.userId, avatar: a.avatar ?? null, active: a.accountId === id })),
    };
  };

  const validationView = () => {
    if (!config().outputPath) {
      return { status: 'unknown', failReason: '', summary: '未配置笔记存储路径' };
    }
    return {
      status: prefs.lastValidationStatus ?? 'passed',
      failReason: prefs.lastValidationFailReason ?? '',
      summary: prefs.lastValidationSummary ?? 'passed',
    };
  };
  const persistValidation = (status, reason) => {
    prefs = { ...prefs, lastValidationStatus: status, lastValidationFailReason: reason ?? '', lastValidationSummary: status === 'passed' ? 'passed' : `failed: ${reason || '未知原因'}` };
    writePrefs(prefs);
  };

  // ---------- 输出路径校验（对应 validateAndApplyOutputPath） ----------
  const normalizeOutputPath = (p) => {
    let s = String(p ?? '').trim().replace(/^["']|["']$/g, '');
    if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
    return path.resolve(s);
  };
  const validateAndApplyOutputPath = async (input) => {
    const trimmed = String(input ?? '').trim();
    if (!trimmed) { persistValidation('failed', '路径不能为空'); return { ok: false, reason: '路径不能为空' }; }
    const normalized = normalizeOutputPath(trimmed);
    try {
      let st = await fs.promises.stat(normalized).catch(() => null);
      if (!st) await fs.promises.mkdir(normalized, { recursive: true });
      st = await fs.promises.stat(normalized);
      if (!st.isDirectory()) throw new Error('目标不是目录');
      await fs.promises.access(normalized, fs.constants.R_OK | fs.constants.W_OK);
    } catch (e) {
      const reason = `路径不可读/不可写：${normalized}（${e.message}）`;
      persistValidation('failed', reason);
      logOp('ERROR', `outputPath.validation.failed ${reason}`);
      return { ok: false, reason };
    }
    prefs = { ...prefs, outputPath: normalized };
    writePrefs(prefs);
    persistValidation('passed', '');
    void setupOutputWatch();
    logOp('INFO', `outputPath.validation.passed ${normalized}`);
    try { await index.rebuildFromConfiguredPath(store.getActiveAccountId() ?? undefined); } catch { /* ignore */ }
    return { ok: true, path: normalized };
  };

  // ---------- 书架分组（对应 BookshelfProvider） ----------
  const extractPrimaryCategory = (category) => {
    const m = String(category ?? '').match(/^(.*?)\s*(?:\/|｜|\||>|·|•|：|:|—|–|－|-)\s*.+$/);
    const first = m ? m[1].trim() : '';
    return first || String(category ?? '').trim();
  };
  const categoryName = (book, mode) => {
    if (String(book.bookId ?? '').startsWith('article:')) return '公众号';
    const cat = String(book.category ?? '').trim();
    if (!cat) return '未分类';
    return mode === 'level2' ? cat : extractPrimaryCategory(cat);
  };
  // ---------- B1 搜索预筛缓存（v1.7.4 修复：此前 getSearchableMap 被引用但从未定义，
  // ReferenceError 被 try/catch 静默吞掉 → 预筛从未生效，每次搜索全量逐条扫描） ----------
  // 按快照指纹缓存 bookId → { hayMeta（书目字段）, hay（含全部笔记文本）}；快照变化自动重建。
  // P2-15：单槽改 3 槽 LRU——双账号来回搜索不再每次整库重建（haystack 构建秒级 CPU）
  const searchMapCache = new Map(); // cacheKey → map（容量 3，新键挤最旧；LRU touch）
  const getSearchableMap = async (accountId) => {
    const signature = index.getSnapshotSignature?.(accountId) ?? null;
    if (!signature) return null;
    const cacheKey = `${String(accountId ?? '')}|${signature}`;
    if (searchMapCache.has(cacheKey)) {
      const hit = searchMapCache.get(cacheKey);
      searchMapCache.delete(cacheKey); searchMapCache.set(cacheKey, hit); // LRU touch
      return hit;
    }
    const books = await index.queryBooks(accountId).catch(() => []);
    const map = new Map();
    for (const book of books) {
      const meta = [book.title, book.author, book.category, book.publisher];
      const parts = meta.slice();
      try {
        const notes = await index.getNotesByBookId(book.bookId, accountId) ?? [];
        for (const n of notes) parts.push(n.highlightText, n.thoughtText, n.chapterTitle);
      } catch { /* 单书失败退回书目字段 */ }
      map.set(book.bookId, {
        hayMeta: meta.filter(Boolean).join(' ').toLowerCase(),
        hay: parts.filter(Boolean).join(' ').toLowerCase(),
      });
    }
    if (searchMapCache.size >= 3) searchMapCache.delete(searchMapCache.keys().next().value);
    searchMapCache.set(cacheKey, map);
    return map;
  };
  const buildBookshelf = async (query, modeOverride) => {
    const mode = modeOverride ?? config().categoryMode;
    const accountId = store.getActiveAccountId() ?? undefined;
    let books = [];
    try { books = await index.queryBooks(accountId); } catch { books = []; }
    const q = (query ?? '').trim().toLowerCase();
    let filtered = books;
    if (q) {
      let map = null;
      try { map = await getSearchableMap(accountId); } catch { map = null; }
      filtered = [];
      for (const book of books) {
        const entry = map && map.get(book.bookId);
        const hit = entry
          ? entry.hayMeta.includes(q)
          : [book.title, book.author, book.category, book.publisher].join(' ').toLowerCase().includes(q);
        if (hit) filtered.push(book);
      }
    }
    const groups = new Map();
    for (const book of filtered) {
      const cat = categoryName(book, mode);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(book);
    }
    const list = [...groups.entries()].map(([category, bs]) => ({ category, books: bs }));
    list.sort((a, b) => {
      if (a.category === '公众号') return -1;
      if (b.category === '公众号') return 1;
      if (a.category === '未分类') return 1;
      if (b.category === '未分类') return -1;
      return a.category.localeCompare(b.category, 'zh-CN');
    });
    for (const g of list) g.books.sort((a, b) => (b.lastReadTime ?? 0) - (a.lastReadTime ?? 0));
    return { groups: list, total: books.length, filtered: filtered.length };
  };

  // ---------- 笔记搜索（对应 searchNotes QuickPick） ----------
  const searchNotes = async (q, limit = 20) => {
    const accountId = store.getActiveAccountId() ?? undefined;
    const books = await index.queryBooks(accountId);
    const keywords = String(q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    let searchMap = null;
    try { searchMap = await getSearchableMap(accountId); } catch { searchMap = null; }
    const results = [];
    for (const book of books) {
      // B1: 整书 haystack 预筛，未命中直接跳过逐条打分
      if (searchMap && keywords.length) {
        const entry = searchMap.get(book.bookId);
        const hay = entry ? entry.hay : [book.title, book.author].join(' ').toLowerCase();
        if (!keywords.some((kw) => hay.includes(kw))) continue;
      }
      let notes = [];
      try { notes = await index.getNotesByBookId(book.bookId, accountId) ?? []; } catch { continue; }
      for (const note of notes) {
        const hl = String(note.highlightText ?? '').toLowerCase();
        const th = String(note.thoughtText ?? '').toLowerCase();
        const ch = String(note.chapterTitle ?? '').toLowerCase();
        let score = 0;
        if (!keywords.length) score = 1;
        for (const kw of keywords) {
          let s = 0;
          if (hl.includes(kw)) s += 1;
          if (th.includes(kw)) s += 2;
          if (ch.includes(kw)) s += 2;
          if (!s && `${book.title}${book.author}`.toLowerCase().includes(kw)) s += 1;
          score += s;
        }
        if (score > 0) results.push({ note, bookTitle: book.title, bookId: book.bookId, score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  };

  // ---------- 协议扫码登录状态机（Host 侧轮询） ----------
  let protocolLogin = null; // {uid, runId, phase, message, otp, timer, startedAt}
  const stopProtocolLogin = () => { if (protocolLogin?.timer) clearInterval(protocolLogin.timer); };
  track(() => stopProtocolLogin()); // P1-9：dispose 清扫扫码轮询（原版漏登记，重载后旧实例最长 5min 继续打外网）
  const progressText = (logicCode) => {
    if (['SCAN_SUCCESS', 'SCANNED'].includes(logicCode)) return '已扫码，请在手机上确认登录';
    if (['CONFIRMED', 'LOGIN_CONFIRM'].includes(logicCode)) return '已确认，正在同步登录状态';
    return '等待扫码中…';
  };
  const pollProtocolLogin = async () => {
    const run = protocolLogin;
    if (!run || ['success', 'expired', 'error'].includes(run.phase)) return; // v1.7.4：error（登录成功但保存失败）也是终态，不再空转外网轮询
    if (run.inFlight) return; // P2-2：防重入（原版 1.5s interval 无守卫，弱网下请求越堆越多）
    if (Date.now() - run.startedAt > 5 * 60_000) { run.phase = 'expired'; run.message = '二维码已过期'; stopProtocolLogin(); return; }
    run.inFlight = true;
    try {
      if (run.cancelled) return; // P2-2：取消后 in-flight 回包不再落账
      const info = await api.getLoginInfo(run.uid, run.otp);
      const logicCode = String(info?.logicCode ?? '');
      if (info?.succeed === true && info?.accessToken && info?.webLoginVid) {
        if (run.cancelled) return; // P2-2：取消与回包竞态——落账前终检
        const cookies = `wr_vid=${info.webLoginVid}; wr_skey=${info.accessToken}`;
        let expiresAt = info.expireAt ?? info.expireTime;
        if (expiresAt && expiresAt < 1e12) expiresAt *= 1000;
        run.phase = 'success';
        stopProtocolLogin();
        try {
          const res = await auth.handleLoginSuccess({
            cookies, vid: String(info.webLoginVid), skey: String(info.accessToken),
            token: info.accessToken, refreshToken: info.refreshToken, session: info.session || info.webLoginVid, expiresAt,
          });
          run.account = { id: res.accountId, name: res.name };
          run.message = `登录成功！欢迎 ${res.name}`;
        } catch (e) {
          run.phase = 'error'; run.message = `登录成功但保存失败：${e.message}`;
          stopProtocolLogin(); // P1-9：error 也是终态，停轮询（原版 interval 空转到进程结束）
        }
        return;
      }
      if (logicCode === 'NEED_OTP') { run.phase = 'needOtp'; run.message = '需要验证码'; return; }
      if (logicCode === 'OTP_NOT_MATCH') { run.otp = undefined; run.phase = 'needOtp'; run.message = '验证码错误，请重新输入'; return; }
      if (logicCode === 'OTP_EXPIRED' || logicCode === 'LOGIN_TIMEOUT') { run.phase = 'expired'; run.message = '二维码已过期'; stopProtocolLogin(); return; }
      run.phase = run.phase === 'needOtp' && !run.otp ? 'needOtp' : (['SCAN_SUCCESS', 'SCANNED', 'CONFIRMED', 'LOGIN_CONFIRM'].includes(logicCode) ? 'scanned' : 'waiting');
      run.message = progressText(logicCode);
    } catch { run.message = '等待扫码中…'; }
    finally { run.inFlight = false; } // P2-2：防重入释放
  };

  // ---------- 洞察月报 ----------
  const buildInsightsReport = (data, filter) => {
    const k = data.kpis ?? {};
    const lines = [
      '# 阅读洞察月报', '',
      `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
      `- 筛选：${filter.days ? `最近 ${filter.days} 天` : '全部数据'}${filter.category && filter.category !== 'all' ? ` · ${filter.category}` : ''}${filter.finishedOnly ? ' · 仅完读' : ''}`, '',
      '## 核心指标', '',
      `- 活跃天数：${k.activeDays ?? 0} 天`, `- 最长连续：${k.longestStreakDays ?? 0} 天`,
      `- 笔记总数：${k.totalNotes ?? 0}`, `- 笔记密度：${k.noteDensityPer100Pages ?? 0} /100页`,
      `- 深度笔记占比：${k.deepNoteRatio ?? 0}%`, `- 平均完成率：${k.averageCompletionRate ?? 0}%`,
      `- 平均每本笔记数：${k.averageNotesPerBook ?? 0}`, '',
      '## 高价值书籍 Top10', '',
      '| 书籍 | 笔记 | 完成率 | 深度占比 | 价值分 |', '|---|---|---|---|---|',
      ...(data.topBooks ?? []).map((b) => `| ${b.title} | ${b.notesCount} | ${Math.round(b.completionRate)}% | ${Math.round(b.deepNoteRatio)}% | ${Math.round(b.valueScore)} |`),
      '',
      '## 最近笔记时间线', '',
      ...(data.timeline ?? []).slice(0, 20).map((t) => `- ${t.createdAt > 0 ? new Date(t.createdAt).toLocaleString('zh-CN') : '时间未知'} 《${t.bookTitle}》${t.chapterTitle ? ` · ${t.chapterTitle}` : ''}：${(t.highlightText || t.thoughtText || '').slice(0, 80)}`),
    ];
    return lines.join('\n');
  };

  // ---------- 月报构建（HTTP 与 /weread-report 命令共用） ----------
  const buildInsightsReportFile = async (filter = {}) => {
    const data = await analytics.getDashboardData(filter, store.getActiveAccountId() ?? undefined);
    const dir = path.join(config().outputPath || os.homedir(), '阅读洞察报告');
    await fs.promises.mkdir(dir, { recursive: true });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const file = path.join(dir, `阅读洞察月报-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`);
    await fs.promises.writeFile(file, buildInsightsReport(data, filter), 'utf8');
    return { path: file, data };
  };

  // ---------- 周报（v0.3：每周首个调度 tick 自动生成一次，本周 vs 上周同期） ----------
  const isoWeekKey = (d = new Date()) => {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  };
  const buildWeeklyReportFile = async () => {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // 周一=0
    const thisWeekDays = dayOfWeek + 1; // 含今天
    const accountId = store.getActiveAccountId() ?? undefined;
    const thisWeek = await analytics.getDashboardData({ days: thisWeekDays }, accountId);
    const lastTwo = await analytics.getDashboardData({ days: thisWeekDays + 7 }, accountId);
    const tk = thisWeek.kpis ?? {}; const lk = lastTwo.kpis ?? {};
    const diff = (a, b) => Math.max(0, (a ?? 0) - (b ?? 0)); // 两周窗口 − 本周 = 上周同期（估算）
    const lines = [
      '# 阅读周报', '',
      `- 生成时间：${now.toLocaleString('zh-CN')}`,
      `- 周期：本周（周一起，${thisWeekDays} 天）vs 上周同期（窗口差值估算）`, '',
      '## 本周核心', '',
      `- 笔记：${tk.totalNotes ?? 0} 条（上周同期约 ${diff(lk.totalNotes, tk.totalNotes)} 条）`,
      `- 活跃天数：${tk.activeDays ?? 0} 天（上周同期约 ${Math.min(7, diff(lk.activeDays, tk.activeDays))} 天）`,
      `- 最长连续：${tk.longestStreakDays ?? 0} 天`,
      `- 深度笔记占比：${tk.deepNoteRatio ?? 0}%`, '',
      '## 高价值书籍 Top5', '',
      '| 书籍 | 笔记 | 完成率 | 价值分 |', '|---|---|---|---|',
      ...(thisWeek.topBooks ?? []).slice(0, 5).map((b) => `| ${b.title} | ${b.notesCount} | ${Math.round(b.completionRate)}% | ${Math.round(b.valueScore)} |`),
      '',
      '## 最近笔记', '',
      ...(thisWeek.timeline ?? []).slice(0, 10).map((t) => `- ${t.createdAt > 0 ? new Date(t.createdAt).toLocaleString('zh-CN') : '时间未知'} 《${t.bookTitle}》${t.chapterTitle ? ` · ${t.chapterTitle}` : ''}：${(t.highlightText || t.thoughtText || '').slice(0, 80)}`),
    ];
    const dir = path.join(config().outputPath || os.homedir(), '阅读洞察报告');
    await fs.promises.mkdir(dir, { recursive: true });
    const pad = (n) => String(n).padStart(2, '0');
    const file = path.join(dir, `阅读周报-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`);
    await fs.promises.writeFile(file, lines.join('\n'), 'utf8');
    return { path: file };
  };
  const maybeWeeklyReport = async () => {
    const week = isoWeekKey();
    if (prefs.lastWeeklyReportWeek === week) return;
    if (!config().outputPath) return; // 未配置目录：下个 tick 再试（不记进度）
    try {
      const { path: file } = await withWriteSuppress(() => buildWeeklyReportFile());
      prefs = { ...prefs, lastWeeklyReportWeek: week };
      writePrefs(prefs);
      logOp('INFO', `weekly report generated: ${file}`);
    } catch (e) { logOp('WARN', `weekly report failed: ${e.message}`); }
  };

  // ---------- v1.0 全量备份（zip 笔记目录 + 状态文件；凭据与机器信息不进备份） ----------
  const buildBackupZip = async (targetDir) => {
    const out = config().outputPath;
    if (!out) throw new Error('未配置笔记存储路径');
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const destDir = targetDir && path.isAbsolute(targetDir) ? targetDir : path.join(os.homedir(), 'Downloads');
    await fs.promises.mkdir(destDir, { recursive: true });
    const zipPath = path.join(destDir, `微信读书备份-${stamp}.zip`);
    // 自写 zip（store + UTF-8 EFS）：系统 zip CLI 对中文文件名会乱码
    const entries = [
      ...collectDirEntries(out),
      ...collectDirEntries(stateDir, 'weread-state', (abs, name) => name !== 'secrets.json' && name !== 'endpoint.json'),
    ];
    if (!entries.length) throw new Error('无可备份内容（笔记目录为空）');
    writeZipFile(entries, zipPath);
    logOp('INFO', `backup zip generated: ${zipPath} (${entries.length} files)`);
    return { path: zipPath, files: entries.length };
  };

  // ---------- v1.0 卸载清理（Keychain 条目 + ~/.dsh/weread 状态文件；不动用户笔记目录） ----------
  const uninstallCleanup = async () => {
    const summary = { keychain: [], files: [], notesDir: config().outputPath || null };
    // 顺序：Keychain 删除（仅启用时）→ 登出（会重写 secrets.json）→ 最后统一删文件
    if (keychainEnabled) {
      const ids = new Set(['default', ...store.listAccounts().map((a) => a.accountId)]);
      for (const id of ids) {
        const r = await kcRun(['delete-generic-password', '-s', kcService, '-a', id]);
        const r2 = await kcRun(['delete-generic-password', '-s', 'dsh-weread-apikey', '-a', id]); // v1.1
        if (r !== null || r2 !== null) summary.keychain.push(id);
      }
    }
    try { await auth.logout(); } catch { /* 已无凭据 */ }
    loginState.loggedIn = false;
    try {
      for (const f of fs.readdirSync(stateDir)) {
        if (!f.endsWith('.json')) continue;
        try { fs.rmSync(path.join(stateDir, f)); summary.files.push(f); } catch { /* 尽力而为 */ }
      }
    } catch { /* 目录不可读 */ }
    logOp('WARN', `uninstall cleanup done: keychain=${summary.keychain.length} files=${summary.files.length}`);
    return summary;
  };

  // ---------- 笔记目录实时联动（fs.watch，外部编辑自动重建索引） ----------
  let watchAbort = null; let watchDebounce = null; let watchedPath = '';
  let writeSuppress = 0; let pendingWatchRebuild = false;
  const withWriteSuppress = async (fn) => {
    writeSuppress += 1;
    try { return await fn(); } finally {
      writeSuppress -= 1;
      if (writeSuppress === 0 && pendingWatchRebuild) {
        pendingWatchRebuild = false;
        refreshIndexFromWatch(); // 抑制期结束后补一次（捕获外部变更）
      }
    }
  };
  const refreshIndexFromWatch = () => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(async () => {
      if (writeSuppress > 0) { pendingWatchRebuild = true; logOp('INFO', 'fs.watch 跳过自身写入触发的重建'); return; }
      try {
        const r = await index.rebuildFromConfiguredPath(store.getActiveAccountId() ?? undefined, { skipIfUnchanged: true });
        if (r.unchanged) { logOp('INFO', 'fs.watch 重建：内容未变，跳过落盘'); return; }
        analytics.clearCache();
        logOp('INFO', 'fs.watch 触发索引重建完成');
      } catch (e) { logOp('WARN', `fs.watch 索引重建失败：${e.message}`); }
    }, 800);
  };
  const setupOutputWatch = async () => {
    const out = config().outputPath;
    if (!ctx.fs?.watch || !out || out === watchedPath) return;
    try {
      if (watchAbort) watchAbort.abort();
      watchAbort = new AbortController();
      const target = await ctx.fs.resolve(out);
      const unwatch = await ctx.fs.watch(target, (error) => {
        if (error) { logOp('WARN', `fs.watch 错误：${error.message}`); return; }
        refreshIndexFromWatch();
      }, watchAbort.signal);
      if (watchAbort.signal.aborted) { await unwatch().catch(() => {}); return; }
      watchedPath = out;
      const ac = watchAbort;
      const stop = () => { watchedPath = ''; try { unwatch().catch(() => {}); } catch { /* ignore */ } };
      ac.signal.addEventListener('abort', stop);
      logOp('INFO', `fs.watch 已监听笔记目录：${out}`);
    } catch (e) { logOp('WARN', `fs.watch 启动失败：${e.message}`); }
  };
  void setupOutputWatch();
  ctx.effect(() => track(() => { if (watchAbort) watchAbort.abort(); clearTimeout(watchDebounce); }));

  // ---------- 人类斜杠命令（commands service） ----------
  if (ctx.commands?.register) {
    const reg = (def) => { try { ctx.effect(() => track(ctx.commands.register(def))); } catch (e) { logOp('WARN', `命令 /${def.name} 注册失败：${e.message}`); } };
    reg({
      name: 'weread-sync',
      description: '微信读书：立即同步笔记到本地',
      input: { hint: '无参数：回车立即执行同步' },
      async handler() {
        const acc = activeAccount();
        if (!acc.id) return { kind: 'error', text: '未登录微信读书，请先在微信读书面板登录。' };
        if (!config().outputPath) return { kind: 'error', text: '未配置笔记存储路径。' };
        const r = await withWriteSuppress(() => sync.fullSync(acc.id));
        return r.success
          ? { kind: 'success', text: `同步完成：${r.syncedBooks} 本书、${r.syncedNotes} 条笔记有更新。` }
          : { kind: 'error', text: `同步失败：${r.error}` };
      },
    });
    reg({
      name: 'weread-roaming',
      description: '微信读书：抽一张笔记漫游卡片',
      input: { hint: '可选：书名/作者关键词（如 程苓峰），留空全池随机' },
      async handler(inv) {
        const kw = String(inv?.rawInput ?? '').trim();
        const acc = store.getActiveAccountId() ?? undefined;
        const key = roamingKey(acc);
        const currentFilter = roaming.getSession(key)?.filter ?? {};
        let view;
        if (kw) view = await roamingApplyFilter({ ...currentFilter, query: kw }, acc);
        else if (currentFilter.query) view = await roamingApplyFilter({ ...currentFilter, query: undefined }, acc); // 裸命令清关键词，回全池
        else view = await roamingAction('next', acc);
        const card = view.card;
        if (!card) {
          const base = kw
            ? `关键词「${kw}」没有匹配的笔记（书名/作者/分类均不含）。`
            : (view.reason ? `漫游池为空：${view.reason}` : '漫游池为空，请先同步笔记。');
          return { kind: 'error', text: base };
        }
        const scope = kw
          ? `（关键词「${kw}」· 过滤后池 ${view.poolSize} 张）`
          : (view.filter?.query ? `（仍按关键词「${view.filter.query}」过滤）` : `（全池 ${view.poolSize} 张）`);
        return { kind: 'success', text: `《${card.bookTitle}》${card.bookAuthor ? ` ${card.bookAuthor}` : ''}${card.chapterTitle ? ` · ${card.chapterTitle}` : ''}\n${card.text}\n${scope}` };
      },
    });
    reg({
      name: 'weread-report',
      description: '微信读书：生成阅读洞察月报（Markdown 落盘）',
      input: { hint: '可选：统计天数（如 30），留空用默认' },
      async handler(inv) {
        if (!config().outputPath) return { kind: 'error', text: '未配置笔记存储路径，报告无处保存。' };
        const days = Number.parseInt(String(inv?.rawInput ?? '').trim(), 10);
        try {
          const { path: file, data } = await buildInsightsReportFile(Number.isFinite(days) && days > 0 ? { days } : {});
          const k = data.kpis ?? {};
          return { kind: 'success', text: `阅读洞察月报已生成：${file}\n活跃 ${k.activeDays ?? 0} 天 · 最长连续 ${k.longestStreakDays ?? 0} 天 · 笔记 ${k.totalNotes ?? 0} 条 · 深度占比 ${k.deepNoteRatio ?? 0}% · 平均完成率 ${k.averageCompletionRate ?? 0}%。可让 AI 解读：@这个文件 给出阅读习惯分析与建议。` };
        } catch (e) { return { kind: 'error', text: `月报生成失败：${e.message}` }; }
      },
    });
  }

  // ---------- 自动同步调度 ----------
  let schedulerTimer = null;
  const maybeAutoSync = async () => {
    const cfg = config();
    if (!cfg.autoSync) return;
    const outReady = !!cfg.outputPath;
    const last = prefs.lastAutoSyncAt ?? 0;
    const interval = INTERVAL_MS[cfg.syncInterval] ?? INTERVAL_MS['24h'];
    // P2（时钟回拨）：last 处于未来（回拨后追不上）→ 视为失效重置，自动同步不停摆
    if (last > Date.now() + 60_000) {
      prefs = { ...prefs, lastAutoSyncAt: 0 };
      writePrefs(prefs);
    } else if (Date.now() - last < interval) return;
    if (!loginState.loggedIn || !outReady) return;
    const prev = prefs.lastAutoSyncAt ?? 0;
    prefs = { ...prefs, lastAutoSyncAt: Date.now() };
    writePrefs(prefs);
    try {
      const r = await withWriteSuppress(() => sync.incrementalSync(store.getActiveAccountId() ?? undefined));
      logOp('INFO', `auto sync done: books=${r.syncedBooks ?? 0} notes=${r.syncedNotes ?? 0}${r.error ? ` error=${r.error}` : ''}`);
    } catch (e) {
      // P2-3（对抗审查 v2）：失败不吞整周期——回滚并设 30 分钟短退避（原版一次断网罚掉 24h 自动同步）
      const interval2 = INTERVAL_MS[cfg.syncInterval] ?? INTERVAL_MS['24h'];
      prefs = { ...prefs, lastAutoSyncAt: Math.max(prev, Date.now() - interval2 + 30 * 60_000) };
      writePrefs(prefs);
      logOp('ERROR', `auto sync failed: ${e.message}（30 分钟后重试）`);
    }
  };
  const loginRecheck = setInterval(() => { void classifyLoginState(); }, 30 * 60_000);
  ctx.effect(() => track(() => clearInterval(loginRecheck)));
  ctx.effect(() => track(() => { if (schedulerTimer) clearInterval(schedulerTimer); }));
  try {
    maybeAutoSync();
    void maybeWeeklyReport();
    schedulerTimer = setInterval(() => { void maybeAutoSync(); void maybeWeeklyReport(); }, 10 * 60_000); // 每 10 分钟检查同步间隔与周报
  } catch { /* ignore */ }

  // ---------- 打开文件夹 ----------
  const revealInFileManager = (filePath) => new Promise((resolve) => {
    const cmd = process.platform === 'darwin' ? ['open', ['-R', filePath]]
      : process.platform === 'win32' ? ['explorer', [`/select,${filePath}`]]
        : ['xdg-open', [path.dirname(filePath)]];
    execFile(cmd[0], cmd[1], (err) => resolve(!err));
  });

  // ---------- HTTP API ----------
  const sendJson = (res, status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
  // P0-1（开源前对抗审查 v3）：Host/Origin 头 loopback 白名单（localhost/127.0.0.1/::1，允许带端口）。
  const isLoopbackHostHeader = (h) => {
    if (!h) return false;
    let s = String(h).trim().toLowerCase();
    if (s.startsWith('[')) { const end = s.indexOf(']'); if (end < 0) return false; s = s.slice(1, end); }
    else { const parts = s.split(':'); if (parts.length > 2) return false; s = parts[0]; } // host:port 或裸 IPv6（无冒端口场景）
    return s === 'localhost' || s === '127.0.0.1' || s === '::1' || s === '0:0:0:0:0:0:0:1';
  };
  const readBody = (req) => new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    req.on('data', (c) => { raw += c; if (raw.length > 5 * 1024 * 1024) { finish({}); try { req.destroy(); } catch { /* ignore */ } } });
    req.on('end', () => { try { finish(raw ? JSON.parse(raw) : {}); } catch { finish({}); } });
    req.on('error', () => finish({})); // P2-14：客户端断开/destroy 后 'end' 不触发——原版 promise 永挂（每请求漏一份闭包）
    req.on('close', () => finish({})); // P2-14：兜底 settle（已 end 时为 no-op）
  });

  // v1.4.4：统一站内链接计算——hash 型 bookId（≥20 位十六进制）用 web/bookDetail 路由（实测 200），
  // 数字/混合型该路由 404（实测），改用 buildPcUrl 生成的 web/reader 链接（与本地书同算法，可跳转）
  const detailUrlFor = (bookId) => {
    const id = String(bookId || '').trim();
    if (!id) return undefined;
    if (/^[0-9a-f]{20,}$/i.test(id)) return `https://weread.qq.com/web/bookDetail/${id}`;
    try { return api.buildPcUrl(id); } catch { return undefined; }
  };

  // v1.2.3 各登录通道有效状态（stateView 与 /api/login/verify 共用）：
  // cookie: present=有凭据；valid=最近真实校验通过且非 Key 营救（via!=='gateway'）
  // apiKey: bound=已绑定；valid=已绑定且最近校验通过（含 Key 营救场景）
  const loginChannelsView = () => {
    const raw = auth.getLastRawCheck?.() ?? {};
    const cookies = (() => { try { return !!store.getCookies(); } catch { return false; } })();
    const apiKey = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
    const checkedRecently = raw.at > 0 && Date.now() - raw.at < 24 * 3600_000;
    return {
      cookie: {
        present: cookies,
        valid: cookies && checkedRecently && raw.ok === true && raw.via !== 'gateway',
        expired: loginState.expired || (cookies && checkedRecently && (raw.ok === false || raw.via === 'gateway')),
        // v1.9.0 B2：Cookie 来源指纹（上次换血时间与来源）——设置页「上次续命」展示
        origin: auth.getCookieOrigin?.() ?? null,
      },
      apiKey: {
        bound: !!apiKey,
        keyTail: apiKeyTail(apiKey),
        valid: !!apiKey && checkedRecently && raw.ok === true,
      },
      lastCheckAt: raw.at || 0,
    };
  };

  const stateView = async () => {
    const acc = currentAccountView();
    const cfg = config();
    let syncState = null; let booksCount = 0;
    try {
      syncState = sync.getSyncState(acc.id ?? undefined);
      booksCount = (await index.queryBooks(acc.id ?? undefined)).length;
    } catch { /* ignore */ }
    return {
      loggedIn: loginState.loggedIn && !!acc.id,
      loginExpired: !!loginState.expired,
      loginChannels: loginChannelsView(),
      account: { id: acc.id, name: acc.name, avatar: acc.avatar },
      accounts: acc.accounts,
      config: cfg,
      syncState, syncProgress,
      validation: validationView(),
      outputPath: cfg.outputPath || '',
      booksCount,
      apiHealth: { ...apiHealth },
      // v1.4.5 App 窗口授权状态（'granted'|'denied'|undefined=未检测）；v1.4.8 附完整错误供诊断
      appWindowAuth: prefs.appWindowAuth,
      appWindowAuthErr: prefs.appWindowAuthErr || '',
      // v1.1 官方通道（API Key）状态：绑定态/尾号/版本/升级提示 + 最近一次对账
      gateway: (() => {
        const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
        return {
          enabled: !!key,
          keyTail: apiKeyTail(key),
          skillVersion: SKILL_VERSION,
          upgrade: gateway.lastUpgradeInfo?.() ?? null,
        };
      })(),
    };
  };

  let apiEndpointSaved = false;
  // v1.9.11 宿主调用方认证（dshopen #522 审核要求）：本机任意进程都能匿名访问 loopback 的
  // /weread/api（含读取完整 API Key 与私人笔记的接口）——插件账号已登录不代表请求来自宿主
  // 所有者。双通道收口：
  //   ① 浏览器（宿主页面）：经 ctx.connection.admit（dsh-auth 签名 cookie，同源请求自动携带）；
  //   ② MCP/本地工具：经插件自签 Bearer token（随机 32 字节，随 endpoint.json 分发，0600 目录）。
  // 二者其一通过才放行；ctx.connection 不在（headless 组合）且无 Bearer 时 fail-closed（503）。
  // token 仅存内存与 endpoint.json，绝不写日志。rawConfig.apiToken 可显式指定（供测试/托管
  // 场景固定凭据；生产配置无此项时随机生成）。
  const localApiToken = (typeof rawConfig.apiToken === 'string' && rawConfig.apiToken.trim().length >= 16)
    ? rawConfig.apiToken.trim()
    : randomBytes(32).toString('hex');
  const bearerOk = (presented) => safeTokenEqual(presented, localApiToken);
  // v1.9.12 修复：ctx.connection 是 Cordis 服务属性，未声明 inject 直接访问会抛
  // `cannot get property "connection" without inject`（?. 可选链无法绕过代理 get 拦截）。
  // 用动态注入 ctx.inject 捕获 admit：desktop 有 connection 服务则激活；headless 没有
  // 则 admitFn 保持 null，插件照常工作、认证降级为仅 Bearer（fail-closed 503）。
  let admitFn = null;
  ctx.inject(['connection'], (ctx2) => {
    admitFn = typeof ctx2.connection?.admit === 'function' ? ctx2.connection.admit.bind(ctx2.connection) : null;
    return () => { admitFn = null; };
  });
  const writeEndpoint = (baseUrl) => {
    try {
      fs.writeFileSync(path.join(stateDir, 'endpoint.json'), JSON.stringify({ baseUrl, token: localApiToken, savedAt: Date.now() }, null, 2));
    } catch { /* 尽力而为 */ }
  };
  // 激活即写一份（getOrigin 可用时）；首个请求再按 Host 头刷新（覆盖无 getOrigin 的宿主形态）
  try { writeEndpoint(ctx.webServer?.getOrigin?.()); apiEndpointSaved = !!ctx.webServer?.getOrigin?.(); } catch { /* ignore */ }
  const callerAuthenticated = createCallerAuthenticated({ bearerOk, getAdmit: () => admitFn });
  const clientDiagWindow = { at: 0, n: 0 }; // P2-18：client-diag 节流窗口状态
  // A2 上下文注入缓存（声明在 webServer 路由闭包可见的作用域；配置变更时路由内置零）
  let readingCtxCache = { at: 0, text: '' };
  let readingCtxBuilding = false;
  // §11-6 面板实时化：/weread/ws 广播总线（sync/roaming 事件推送；注册失败客户端自动降级轮询）
  const wsBus = createWsBus({ log: logOp });
  ctx.effect(() => {
    let off = null;
    try {
      off = ctx.webServer.registerUpgrade({
        path: '/weread/ws',
        // v1.9.11：升级握手同认证（浏览器 cookie 自动携带；admit 异步判定后转交，失败拆线）
        // v1.9.12 对抗审查加固：① admit 悬挂时 5s 超时拆线（防慢速占用连接）；② 补 .catch
        // 兜底（callerAuthenticated 未来重构若 reject 也不悬挂 socket/未处理拒绝）；③ settled
        // 防护——超时拆线后迟到的认证成功不再对已销毁 socket 转交 wsBus。
        handler: (req, socket, head) => {
          let settled = false;
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            if (ok) { try { wsBus.handler(req, socket, head); } catch { try { socket.destroy(); } catch { /* ignore */ } } }
            else { try { socket.destroy(); } catch { /* ignore */ } }
          };
          const timer = setTimeout(() => finish(false), 5000);
          timer.unref?.();
          callerAuthenticated(req).then(
            (ok) => { clearTimeout(timer); finish(ok); },
            () => { clearTimeout(timer); finish(false); },
          );
        },
      });
      logOp('INFO', 'weread ws 总线已注册（/weread/ws）');
    } catch (e) { logOp('WARN', `weread ws 注册失败（客户端降级轮询）：${e.message}`); }
    track(() => { try { off?.(); } catch { /* ignore */ } try { wsBus.dispose(); } catch { /* ignore */ } });
  });
  ctx.effect(() => track(ctx.webServer.register({
    kind: 'prefix',
    path: '/weread',
    async handler(req, res) {
      try {
        // P0-1（开源前对抗审查 v3）：Host 头必须是 loopback（防 DNS rebinding——攻击域解析到
        // 127.0.0.1 时 Origin=Host=evil.com，旧的「Origin.host === Host」校验恒过）。
        // 带 Origin 的浏览器请求：Origin host 也须等于 Host 且为 loopback；无 Origin 的本地
        // 工具（MCP 等）仅凭 loopback Host 放行。
        if (!isLoopbackHostHeader(req.headers?.host)) {
          return sendJson(res, 403, { error: 'host not allowed' });
        }
        const origin = req.headers?.origin;
        if (origin) {
          try {
            const originHost = new URL(origin).host;
            if (originHost !== String(req.headers.host) || !isLoopbackHostHeader(originHost)) {
              return sendJson(res, 403, { error: 'origin not allowed' });
            }
          } catch { return sendJson(res, 403, { error: 'origin not allowed' }); }
        }
        // v0.4 MCP 端点发现：首个请求记录 base URL（mcp-server.mjs 据此找到本 API）
        if (!apiEndpointSaved && req.headers?.host) {
          apiEndpointSaved = true;
          writeEndpoint(`http://${req.headers.host}`);
        }
        // v1.9.11 宿主调用方认证（dshopen #522）：Bearer token（MCP/本地工具）或
        // ctx.connection.admit（宿主签名 cookie）其一通过；均不可用/均失败 → 401（fail-closed：
        // 宿主无 connection 服务时 503，避免无认证裸奔）。此检查覆盖全部 /weread/api/* 路由，
        // 包括读取完整 API Key（/api/gateway/key）与私人笔记（notes/book/search 等）。
        if (!(await callerAuthenticated(req))) {
          const admitAvailable = typeof admitFn === 'function';
          return sendJson(res, admitAvailable ? 401 : 503, { error: admitAvailable ? 'authentication required' : 'authentication unavailable' });
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = url.pathname;
        const method = (req.method ?? 'GET').toUpperCase();
        const seg = (p) => p.split('/').filter(Boolean);
        const J = (payload) => sendJson(res, 200, payload);

        if (method === 'GET' && pathname === '/weread/api/state') return J(await stateView());

        if (method === 'GET' && pathname === '/weread/api/bookshelf') {
          const query = url.searchParams.get('query') ?? '';
          const mode = url.searchParams.get('categoryMode') ?? undefined;
          if (url.searchParams.get('refresh') === '1') {
            // P2-16（对抗审查 v2）：全库重建设 8s 上限（大库秒级阻塞 → 客户端超时重试叠加）。
            // 超时即先返回当前数据；重建仍在后台进行，完成后经 WS 广播 + 客户端轮询兜底拿到新数据。
            const rebuildP = index.rebuildFromConfiguredPath(store.getActiveAccountId() ?? undefined)
              .then((r) => { try { analytics.clearCache(); } catch { /* ignore */ } wsBus.broadcast('bookshelf', { action: 'refresh' }); return r; })
              .catch(() => {});
            await Promise.race([rebuildP, new Promise((r) => setTimeout(r, 8000))]);
          }
          return J(await buildBookshelf(query, mode));
        }

        if (method === 'GET' && pathname.startsWith('/weread/api/book/')) {
          const rest = decodeURIComponent(pathname.slice('/weread/api/book/'.length));
          if (rest === 'search' || rest === 'folder' || rest === 'sync' || rest === 'delete') { /* fallthrough to POST routes */ }
          else {
            const accountId = store.getActiveAccountId() ?? undefined;
            const book = await index.getBookById(rest, accountId);
            if (!book) return sendJson(res, 404, { error: '未找到该书的本地笔记，请先同步' });
            let notes = []; try { notes = await index.getNotesByBookId(rest, accountId) ?? []; } catch { /* ignore */ }
            const chapterMap = new Map();
            for (const n of notes) {
              const title = n.chapterTitle || '未分类章节';
              chapterMap.set(title, (chapterMap.get(title) ?? 0) + 1);
            }
            const chapters = [...chapterMap.entries()].map(([title, count], i) => ({ chapterUid: i, title, count }));
            return J({ book, chapters, notes, filePath: book.localFilePath ?? null });
          }
        }

        if (method === 'POST' && pathname === '/weread/api/sync') {
          await ensureLoginFresh();
          const acc = activeAccount();
          if (!loginState.loggedIn) return sendJson(res, 401, { error: loginState.expired ? '登录已过期，请重新登录' : '未登录，请先在微信读书面板登录', loginExpired: loginState.expired });
          if (!acc.id) return sendJson(res, 400, { error: '未设置活跃账号，请先登录' });
          if (!config().outputPath) return sendJson(res, 400, { error: '未配置笔记存储路径，请先在设置中配置' });
          if (sync.isSyncingInProgress(acc.id)) return sendJson(res, 409, { error: '同步正在进行中' });
          syncProgress = null; lastSyncPhase = 'started'; // v1.9.2 #2：清上一轮 Completed 旧帧——否则第二轮同步首秒显示「100% N/N · 同步完成」
          wsBus.broadcast('sync', { phase: 'started' });
          void withWriteSuppress(() => sync.fullSync(acc.id))
            .then((r) => {
              wsBus.broadcast('sync', { phase: r?.cancelled ? 'cancelled' : 'done', success: !!r?.success });
              if (r?.success) markApiHealth(true);
              else if (r?.error && NETWORK_ERR_RE.test(String(r.error))) markApiHealth(false, r.error);
            })
            .catch(() => {});
          return J({ ok: true, started: true });
        }

        // v1.9.3 软取消：置标志 → worker 在书边界检查 → 在飞书自然完成（几秒内到 cancelled 终态）。
        // 已写盘的书保留（书级原子写）；索引重建在收尾路径照常执行；对账跳过。取消后立即可重新同步。
        if (method === 'POST' && pathname === '/weread/api/sync/cancel') {
          // v1.9.5 修复：acc 是上方 sync 路由块内的局部变量，本分支原样引用 → 登录态必抛
          // ReferenceError「acc is not defined」（真机：点同步条取消按钮 toast 报错）。冒烟只测了
          // 401 分支未触达——现自取账号引用，并补登录态冒烟断言（见 13.79）。
          if (!loginState.loggedIn) return sendJson(res, 401, { error: '未登录' });
          const accCancel = activeAccount(); // 外层 {id, account, accounts}——id 即 accountId（account 上无 id 字段）
          if (!accCancel.id) return sendJson(res, 400, { error: '未设置活跃账号，请先登录' });
          if (!sync.isSyncingInProgress(accCancel.id)) return J({ ok: true, cancelling: false, note: 'no-sync-in-progress' });
          sync.requestCancel(accCancel.id);
          logOp('INFO', `sync cancel requested (account ${accCancel.id})——在飞书完成后停止，已完成部分保留`);
          return J({ ok: true, cancelling: true });
        }

        if (method === 'GET' && pathname === '/weread/api/notes/search') {
          const q = url.searchParams.get('q') ?? '';
          const items = (await searchNotes(q)).map((r) => ({
            bookId: r.bookId, bookTitle: r.bookTitle, chapterTitle: r.note.chapterTitle,
            highlightText: r.note.highlightText, thoughtText: r.note.thoughtText,
            createTime: r.note.createTime, score: r.score,
          }));
          return J({ items });
        }

        if (method === 'GET' && pathname === '/weread/api/insights') {
          const filter = {
            days: Number(url.searchParams.get('days') ?? 0) || 0,
            category: url.searchParams.get('category') ?? '',
            noteType: url.searchParams.get('noteType') ?? 'all',
            finishedOnly: url.searchParams.get('finishedOnly') === 'true',
            trendGranularity: url.searchParams.get('granularity') === 'week' ? 'week' : 'day',
          };
          const data = await analytics.getDashboardData(filter, store.getActiveAccountId() ?? undefined);
          // v1.0 阅读目标：本周（周一起）笔记进度 + 连续达标周数（近 8 周趋势聚合）
          const goalNotes = Number(config().weeklyGoalNotes) || 0;
          if (goalNotes > 0) {
            try {
              const accountId = store.getActiveAccountId() ?? undefined;
              const dayOfWeek = (new Date().getDay() + 6) % 7;
              const weekDays = dayOfWeek + 1;
              const thisWeek = await analytics.getDashboardData({ days: weekDays }, accountId);
              const long = await analytics.getDashboardData({ days: 56 }, accountId);
              const weekSum = new Map(); // isoWeek → 笔记数
              for (const p of long.trend ?? []) {
                if (!p.date) continue;
                const d = new Date(p.date + 'T00:00:00');
                const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
                weekSum.set(monday.toISOString().slice(0, 10), (weekSum.get(monday.toISOString().slice(0, 10)) ?? 0) + (p.notesCount || 0));
              }
              const weeks = [...weekSum.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
              const currentMonday = new Date(); currentMonday.setDate(currentMonday.getDate() - dayOfWeek);
              const thisMondayKey = currentMonday.toISOString().slice(0, 10);
              let streak = 0;
              for (const [mondayKey, sum] of weeks) {
                if (mondayKey === thisMondayKey) continue; // 本周进行中不计入连续
                if (sum >= goalNotes) streak += 1; else break;
              }
              data.goal = {
                weeklyGoalNotes: goalNotes,
                thisWeekNotes: thisWeek.kpis?.totalNotes ?? 0,
                streakWeeks: streak,
                achieved: (thisWeek.kpis?.totalNotes ?? 0) >= goalNotes,
              };
            } catch (e) { logOp('WARN', `goal compute failed: ${e.message}`); }
          }
          return J(data);
        }

        if (method === 'POST' && pathname === '/weread/api/insights/report') {
          const body = await readBody(req);
          const r = await withWriteSuppress(() => buildInsightsReportFile(body.filter ?? {}));
          return J({ path: r.path });
        }
        if (method === 'POST' && pathname === '/weread/api/open-file') {
          // v1.7.8：命令卡片路径点击的兜底打开（doc-reader 面板未接管时用系统默认应用）。
          // 安全面：仅允许笔记输出目录内的文件，防任意路径打开。
          const body = await readBody(req);
          const raw = String(body?.path ?? '').trim();
          const base = path.resolve(config().outputPath || os.homedir());
          const target = raw ? path.resolve(raw) : '';
          if (!target || !target.startsWith(base + path.sep)) return sendJson(res, 403, { error: '路径不在笔记输出目录内，已拒绝' });
          const opener = process.platform === 'darwin' ? ['/usr/bin/open', [target]]
            : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
            : ['xdg-open', [target]];
          const okOpen = await new Promise((resolve) => {
            try { execFile(opener[0], opener[1], (err) => resolve(!err)); } catch { resolve(false); }
          });
          return okOpen ? J({ ok: true }) : sendJson(res, 500, { error: '系统打开失败' });
        }
        if (method === 'POST' && pathname === '/weread/api/insights/weekly-report') {
          if (!config().outputPath) return sendJson(res, 400, { error: '未配置笔记存储路径' });
          const r = await withWriteSuppress(() => buildWeeklyReportFile());
          prefs = { ...prefs, lastWeeklyReportWeek: isoWeekKey() };
          writePrefs(prefs);
          return J({ path: r.path });
        }
        if (method === 'POST' && pathname === '/weread/api/backup') {
          if (!config().outputPath) return sendJson(res, 400, { error: '未配置笔记存储路径' });
          try {
            const body = await readBody(req);
            const r = await buildBackupZip(body.dir && path.isAbsolute(String(body.dir)) ? String(body.dir) : undefined);
            return J({ ok: true, path: r.path });
          } catch (e) { return sendJson(res, 500, { error: `备份失败：${e.message}` }); }
        }
        if (method === 'POST' && pathname === '/weread/api/uninstall/cleanup') {
          // P1-5（开源前对抗审查 v3）：销毁性操作须带确认标记，防误触/盲打。
          const body = await readBody(req);
          if (body?.confirm !== true) return sendJson(res, 400, { error: '缺少确认参数（confirm: true）' });
          const summary = await uninstallCleanup();
          return J({ ok: true, ...summary });
        }

        if (method === 'GET' && pathname === '/weread/api/roaming/session') {
          return J(await roamingSessionView(store.getActiveAccountId() ?? undefined));
        }
        if (method === 'POST' && pathname === '/weread/api/roaming/action') {
          const body = await readBody(req);
          const r = await roamingAction(body.action, store.getActiveAccountId() ?? undefined, body);
          wsBus.broadcast('roaming', { action: body.action });
          return J(r);
        }
        if (method === 'GET' && pathname === '/weread/api/roaming/card') {
          const key = roamingKey(store.getActiveAccountId() ?? undefined);
          try {
            const pool = await roaming.getCandidatePool({}, key);
            const pick = roaming.pickNext(pool, { cooldownMs: 6 * 3600_000 });
            const nowMs = Date.now();
            const dueCount = pool.filter((c) => c.meta?.sm2Due > 0 && c.meta.sm2Due <= nowMs).length;
            return J({ card: pick.candidate ?? null, poolSize: pool.length, dueCount });
          } catch (e) { return sendJson(res, 500, { error: e.message }); }
        }
        if (method === 'POST' && pathname === '/weread/api/roaming/filter') {
          const body = await readBody(req);
          const r = await roamingApplyFilter(body, store.getActiveAccountId() ?? undefined);
          wsBus.broadcast('roaming', { action: 'filter' });
          return J(r);
        }

        if (method === 'POST' && pathname === '/weread/api/login/protocol/start') {
          stopProtocolLogin();
          try {
            const uid = await api.getLoginUid();
            protocolLogin = { uid, phase: 'waiting', message: '等待扫码中…', otp: undefined, startedAt: Date.now() };
            const timer = setInterval(() => { void pollProtocolLogin(); }, 1500);
            protocolLogin.timer = timer;
            return J({ uid, confirmUrl: `https://weread.qq.com/web/confirm?uid=${uid}` });
          } catch (e) { return sendJson(res, 500, { error: e.message }); }
        }
        if (method === 'GET' && pathname === '/weread/api/login/protocol/status') {
          if (!protocolLogin) return sendJson(res, 400, { error: '尚未开始扫码登录' });
          return J({ phase: protocolLogin.phase, message: protocolLogin.message, account: protocolLogin.account ?? null });
        }
        if (method === 'POST' && pathname === '/weread/api/login/protocol/cancel') {
          if (protocolLogin && protocolLogin.phase !== 'success') {
            protocolLogin.cancelled = true; // P2-2：标记后 in-flight 的 succeed 回包不再落账
            stopProtocolLogin();
            protocolLogin = null;
            logOp('INFO', 'protocol login polling cancelled by client');
          }
          return J({ ok: true });
        }
        if (method === 'GET' && pathname === '/weread/api/login/protocol/qrcode') {
          // v1.8.8：登录二维码本地生成（vendored qrcode SVG）。原客户端 img 直连境外 api.qrserver.com，
          // 网络不可达时二维码破损（真机实况：alt="login qr" 占位符）。同源端点彻底去除该外网依赖。
          const data = url.searchParams.get('data') || '';
          if (!data || data.length > 512) return sendJson(res, 400, { error: '缺少或超长 data 参数' });
          if (!/^https:\/\/weread\.qq\.com\//.test(data)) return sendJson(res, 400, { error: '仅支持微信读书域名链接' });
          const svg = createQrSvg(data, { ecc: 'M', margin: 2 });
          res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(svg);
          return undefined;
        }
        if (method === 'POST' && pathname === '/weread/api/login/protocol/otp') {
          const body = await readBody(req);
          if (!protocolLogin) return sendJson(res, 400, { error: '尚未开始扫码登录' });
          protocolLogin.otp = String(body.otp ?? '').trim();
          return J({ ok: true });
        }
        if (method === 'POST' && pathname === '/weread/api/login/cookie') {
          const body = await readBody(req);
          try {
            const r = await auth.loginByCookie({ wrVid: String(body.wrVid ?? ''), wrSkey: String(body.wrSkey ?? '') });
            loginState.loggedIn = true;
            loginState.expired = false;
            markApiHealth(true);
            return J({ ok: true, account: { id: r.accountId, name: r.name } });
          } catch (e) {
            return sendJson(res, 400, { error: `Cookie 校验失败：${e.message}` });
          }
        }
        // v1.1：API Key 官方通道登录（已登录=绑定当前账号；未登录=独立账号）
        if (method === 'POST' && pathname === '/weread/api/login/apikey') {
          const body = await readBody(req);
          const key = String(body.apiKey ?? '').trim();
          if (!key) return sendJson(res, 400, { error: '请填写 API Key（官网 weread.qq.com/r/weread-skills 登录后复制 wrk- 开头的 Key）' });
          try {
            const r = await auth.loginByApiKey({ apiKey: key });
            loginState.loggedIn = true;
            loginState.expired = false;
            markApiHealth(true);
            logOp('INFO', `apikey.login ok account=${r.accountId} attached=${r.attached}`);
            return J({ ok: true, account: { id: r.accountId, name: r.name }, attached: !!r.attached });
          } catch (e) {
            return sendJson(res, 400, { error: `API Key 登录失败：${e.message}` });
          }
        }
        // v1.1：官方网关自检（ping + /_list）——真机字段验证闸门（roadmap §8A Go/No-Go）
        if (method === 'POST' && pathname === '/weread/api/gateway/test') {
          const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
          if (!key) return sendJson(res, 400, { error: '未绑定 API Key（先在登录弹层用 API Key 登录或绑定）' });
          syncGatewayKey();
          const t0 = Date.now();
          try {
            await gateway.ping();
            let apis;
            try { apis = await gateway.listApis(); } catch (e) { apis = { error: e.message }; }
            const list = Array.isArray(apis) ? apis : undefined;
            logOp('INFO', `gateway.test ok latency=${Date.now() - t0}ms apiCount=${list?.length ?? 'n/a'}`);
            return J({ ok: true, latencyMs: Date.now() - t0, skillVersion: SKILL_VERSION, apiCount: list?.length, apis: list ? list.slice(0, 50) : apis });
          } catch (e) {
            markApiHealth(false, `官方网关：${e.message}`);
            return J({ ok: false, error: e.message, latencyMs: Date.now() - t0 });
          }
        }
        if (method === 'POST' && pathname === '/weread/api/open-reader') {
          const body = await readBody(req);
          const url = String(body.url ?? '').trim();
          if (!/^https?:\/\/weread\.qq\.com\//i.test(url)) {
            return sendJson(res, 400, { ok: false, error: '仅支持微信读书域名链接' });
          }
          // v1.5.0 单例阅读窗口（WebBar 模型迁移）：专用 profile 的 Chrome app 窗口 + CDP 复用导航，
          // 不开多窗、不落默认浏览器；Chrome 完全不可用才回落同窗口页签（v1.4.9 机制）。
          // v1.9.0 C1：开书前预热刷新（>30min 未续命才触发，退避保护仍生效）——注入窗口的是最新血。
          try { await auth.warmupRefreshForOpen(); } catch { /* 预热失败不阻断开窗 */ }
          const r = await readerWindow.open(url);
          if (!r.ok) return sendJson(res, 503, r);
          // v1.7.18：Cookie 通道服务端已死——窗口能开但书页一律「加载失败」，明确归因引导重扫，别让用户误判窗口坏了
          if (r.loginExpired) logOp('WARN', 'open-reader: 微信读书 Cookie 已在服务端过期（窗口能开、书页「加载失败」）——设置页重新扫码即恢复；API Key 同步通道不受影响');
          logOp('INFO', `open-reader: ${r.mode}${r.fallback ? '(fallback)' : ''} ${url.slice(0, 60)}`);
          return J(r);
        }
        if (method === 'GET' && pathname === '/weread/api/open-reader/diagnose') {
          const agentsSvc = ctx.agents ?? (typeof ctx.get === 'function' ? ctx.get('agents') : undefined);
          const roots = agentsSvc?.roots?.() ?? [];
          const titlesSvc = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : undefined;
          const rootsDetail = roots.map((a) => ({
            id: String(a.id ?? '').slice(0, 24),
            status: a.status ?? null,
            title: (() => { try { return titlesSvc?.get?.(a.session) ?? null; } catch { return null; } })(),
          }));
          return J({ ...(await readerWindow.diagnose()), askAgents: { available: !!agentsSvc, roots: roots.length, rootsDetail, last: lastReaderAskDiag } });
        }
        if (method === 'POST' && pathname === '/weread/api/open-reader/close') {
          return J(await readerWindow.closeWindow());
        }
        // v1.2.5：登录弹层打开即核验各通道（verifyNow 实时问服务端），「未复核」秒级消解
        if (method === 'POST' && pathname === '/weread/api/login/verify') {
          let v = await auth.verifyNow().catch(() => null);
          // v1.8.10：跨端状态共享——插件 Cookie 通道核验失败而阅读窗口会话有效时，
          // 先采纳窗内会话（同源校验+账号匹配+服务端裁决），再复核呈现真实状态。
          // 场景：窗内扫码登录过、插件侧 cookie 旧死 → 弹层不再误报「已过期」。
          if (v !== true) {
            const winSession = await readerWindow.exportWindowSession?.().catch(() => null);
            if (winSession) await adoptWindowSession(winSession);
            v = await auth.verifyNow().catch(() => null);
          }
          // v1.9.1 修复状态分裂：核验结论同步回 loginState——弹层显示「有效」而书架横幅
          // 仍报「登录已过期」（真机 2026-11-10 反馈）。原路径只返回通道状态、不动 loginState：
          // expired 一旦被同步 401 设置就再无撤销路径（核验≠登录，不走 fireLoginState），
          // 书架横幅只能靠下次同步/登录才可能恢复。
          if (v === true) { loginState.loggedIn = true; loginState.expired = false; }
          else if (v === false) {
            // 只有「有凭据但判死」才标过期——从未登录的用户显示「未登录」而非「登录已过期」
            loginState.loggedIn = false;
            loginState.expired = !!(store.getCookies() || store.getApiKey());
          }
          return J({ ok: v === true, result: v, loginChannels: loginChannelsView() });
        }
        // ---------- v1.3 发现 / v1.2 统计（官方网关只读；未绑 Key 统一 400 引导） ----------
        const requireGateway = () => {
          const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
          if (!key) return { key: null, fail: sendJson(res, 400, { ok: false, error: '未绑定 API Key（先在登录弹层绑定）' }) };
          syncGatewayKey();
          return { key };
        };
        if (method === 'GET' && pathname === '/weread/api/gateway/stats') {
          const g = requireGateway(); if (!g.key) return g.fail;
          const mode = ['weekly', 'monthly', 'annually', 'overall'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'monthly';
          try {
            const data = await gateway.readdata(mode, url.searchParams.get('baseTime') || undefined);
            return J({ ok: true, mode, data });
          } catch (e) { return J({ ok: false, error: e?.message || String(e) }); }
        }
        if (method === 'GET' && pathname === '/weread/api/gateway/progress') {
          const g = requireGateway(); if (!g.key) return g.fail;
          const bookId = url.searchParams.get('bookId') || '';
          if (!bookId) return sendJson(res, 400, { ok: false, error: '缺少 bookId' });
          try { return J({ ok: true, data: await gateway.bookProgress(bookId) }); }
          catch (e) { return J({ ok: false, error: e?.message || String(e) }); }
        }
        if (method === 'GET' && pathname === '/weread/api/gateway/search') {
          const g = requireGateway(); if (!g.key) return g.fail;
          const keyword = (url.searchParams.get('keyword') || '').trim();
          if (!keyword) return sendJson(res, 400, { ok: false, error: '缺少 keyword' });
          try {
            const data = await gateway.storeSearch({
              keyword,
              scope: Number(url.searchParams.get('scope') ?? 10),
              maxIdx: url.searchParams.get('maxIdx') || undefined,
            });
            // v1.4.3：搜索结果个别条目可能缺 readerLink——统一补全；v1.4.4 补 detailUrl（hash→详情路由，其他→阅读页）
            for (const g2 of data?.results ?? []) {
              for (const b of g2?.books ?? []) {
                if (b?.bookInfo && !b.bookInfo.readerLink && b.bookInfo.bookId) {
                  b.bookInfo.readerLink = api.buildPcUrl(String(b.bookInfo.bookId));
                }
                if (b?.bookInfo?.bookId) b.bookInfo.detailUrl = detailUrlFor(b.bookInfo.bookId);
              }
            }
            return J({ ok: true, data });
          } catch (e) { return J({ ok: false, error: e?.message || String(e) }); }
        }
        if (method === 'GET' && pathname === '/weread/api/gateway/recommend') {
          const g = requireGateway(); if (!g.key) return g.fail;
          try {
            const data = await gateway.recommend({ count: Number(url.searchParams.get('count') ?? 12) });
            // v1.4.3：官方 recommend 回包无 readerLink（实测）——用与本地书一致的 buildPcUrl 算法补全
            for (const b of data?.books ?? []) {
              if (!b.readerLink && b.bookId) b.readerLink = api.buildPcUrl(String(b.bookId));
              if (b.bookId) b.detailUrl = detailUrlFor(b.bookId) || b.readerLink;
            }
            return J({ ok: true, data });
          } catch (e) { return J({ ok: false, error: e?.message || String(e) }); }
        }
        if (method === 'GET' && pathname === '/weread/api/gateway/similar') {
          const g = requireGateway(); if (!g.key) return g.fail;
          const bookId = url.searchParams.get('bookId') || '';
          if (!bookId) return sendJson(res, 400, { ok: false, error: '缺少 bookId' });
          try { return J({ ok: true, data: await gateway.similarBooks(bookId, { count: 12, maxIdx: 0 }) }); }
          catch (e) { return J({ ok: false, error: e?.message || String(e) }); }
        }
        if (method === 'GET' && pathname === '/weread/api/gateway/reviews') {
          const g = requireGateway(); if (!g.key) return g.fail;
          const bookId = url.searchParams.get('bookId') || '';
          if (!bookId) return sendJson(res, 400, { ok: false, error: '缺少 bookId' });
          try {
            const data = await gateway.publicReviews(bookId, {
              reviewListType: Number(url.searchParams.get('listType') ?? 0),
              count: Number(url.searchParams.get('count') ?? 20),
            });
            return J({ ok: true, data });
          } catch (e) { return J({ ok: false, error: e?.message || String(e) }); }
        }
        if (method === 'GET' && pathname === '/weread/api/gateway/bestbookmarks') {
          const g = requireGateway(); if (!g.key) return g.fail;
          const bookId = url.searchParams.get('bookId') || '';
          if (!bookId) return sendJson(res, 400, { ok: false, error: '缺少 bookId' });
          try { return J({ ok: true, data: await gateway.bestBookmarks(bookId) }); }
          catch (e) { return J({ ok: false, error: e?.message || String(e) }); }
        }
        // v1.2.1：取当前绑定的 Key（本机同源；登录弹层「已绑定」态预填输入框，避免重新复制）
        if (method === 'GET' && pathname === '/weread/api/gateway/key') {
          // P2-17（对抗审查 v2）：完整 Key 只对已登录（有活跃账号）的会话返回——预填功能依赖它，
          // 未登录态不再吐出（缩小本地 API 面的凭据暴露窗口）
          if (!store.getActiveAccountId()) return J({ apiKey: '' });
          const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
          return J({ apiKey: key || '' });
        }
        // v1.1：解绑当前账号的 API Key（不动 cookie 登录态）
        if (method === 'POST' && pathname === '/weread/api/gateway/unbind') {
          const accountId = store.getActiveAccountId();
          if (!accountId) return sendJson(res, 400, { error: '无活跃账号' });
          try { store.clearApiKey(accountId); } catch { /* ignore */ }
          syncGatewayKey();
          loginState.loggedIn = !!(store.getCookies(accountId));
          return J({ ok: true, loggedIn: loginState.loggedIn });
        }
        if (method === 'POST' && pathname === '/weread/api/logout') {
          await auth.logout();
          loginState.loggedIn = false;
          try { await index.rebuildFromConfiguredPath(undefined); } catch { /* ignore */ }
          return J({ ok: true });
        }

        if (method === 'POST' && pathname === '/weread/api/accounts/switch') {
          const body = await readBody(req);
          await auth.switchAccount(String(body.accountId ?? ''));
          loginState.loggedIn = await auth.checkLoginStatus().catch(() => false);
          // v1.9.2 F3：切号即清进度帧——syncProgress 是闭包变量不分账号，旧账号的
          // 「X/N 本」残留到新账号书架会误导（syncing=false 不显示，但状态字段仍在泄漏）
          syncProgress = null;
          lastSyncPhase = '';
          try { await index.rebuildFromConfiguredPath(String(body.accountId)); } catch { /* ignore */ }
          return J({ ok: true });
        }
        if (method === 'POST' && pathname === '/weread/api/accounts/remove') {
          const body = await readBody(req);
          await auth.removeAccount(String(body.accountId ?? ''));
          try { await index.rebuildFromConfiguredPath(store.getActiveAccountId() ?? undefined); } catch { /* ignore */ }
          return J({ ok: true });
        }

        if (method === 'POST' && pathname === '/weread/api/config') {
          const body = await readBody(req);
          const allowed = ['fileNameTemplate', 'noteTemplate', 'autoSync', 'syncInterval', 'categoryMode', 'showCover', 'multiAccountEnabled', 'language', 'exportThemes', 'uiSidebarKpi', 'uiComposerRoaming', 'uiRoamingScrollMode', 'uiRoamingFontSize', 'uiRoamingScrollSpeed', 'uiRoamingRotateEnabled', 'uiRoamingRotateSec', 'ctxInjectEnabled', 'ctxBookCount', 'ctxIncludeHighlights', 'ctxHighlightCount', 'ctxExcludeTitles', 'weeklyGoalNotes', 'readerWindowQuitOnClose', 'keychain'];
          const patch = {};
          for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
          prefs = { ...prefs, ...patch };
          writePrefs(prefs);
          if (Object.keys(patch).some((k) => k.startsWith('ctx'))) readingCtxCache.at = 0; // AI 注入配置变更即失效缓存
          // A2: outputPath 走同一校验通道，失败即报错而非静默丢弃
          if (typeof body.outputPath === 'string' && body.outputPath.trim() && body.outputPath.trim() !== config().outputPath) {
            const v = await validateAndApplyOutputPath(body.outputPath);
            if (!v.ok) return sendJson(res, 400, { error: `笔记存储路径未保存：${v.reason}`, config: config(), validation: validationView() });
            return J({ ok: true, config: config(), validation: validationView() });
          }
          return J({ ok: true, config: config(), validation: validationView() });
        }

        if (method === 'POST' && pathname === '/weread/api/output-path/validate') {
          const body = await readBody(req);
          return J(await validateAndApplyOutputPath(body.path));
        }

        if (method === 'POST' && pathname === '/weread/api/book/delete') {
          const body = await readBody(req);
          const accountId = store.getActiveAccountId() ?? undefined;
          const book = await index.getBookById(String(body.bookId ?? ''), accountId);
          if (!book?.localFilePath) return sendJson(res, 404, { error: '未找到该笔记文件' });
          await fs.promises.unlink(book.localFilePath).catch(() => {});
          try { await index.rebuildFromConfiguredPath(accountId); } catch { /* ignore */ }
          logOp('INFO', `book.note.deleted ${book.title}`);
          return J({ ok: true });
        }
        if (method === 'POST' && pathname === '/weread/api/book/sync') {
          const body = await readBody(req);
          await ensureLoginFresh(); // v1.0.9：详情页刷新同样实时复核，过期即 401 引导登录（原路由无守卫）
          if (!loginState.loggedIn) return sendJson(res, 401, { error: loginState.expired ? '登录已过期，请重新登录' : '未登录，请先在微信读书面板登录', loginExpired: loginState.expired });
          const r = await withWriteSuppress(() => sync.syncBook(String(body.bookId ?? ''), store.getActiveAccountId() ?? undefined));
          return J(r);
        }
        if (method === 'POST' && pathname === '/weread/api/book/folder') {
          const body = await readBody(req);
          const accountId = store.getActiveAccountId() ?? undefined;
          const book = await index.getBookById(String(body.bookId ?? ''), accountId);
          if (!book?.localFilePath) return sendJson(res, 404, { error: '未找到该笔记文件，请先同步或检查导出目录配置' });
          const ok = await revealInFileManager(book.localFilePath);
          return ok ? J({ ok: true }) : sendJson(res, 500, { error: '打开文件管理器失败' });
        }

        if (method === 'POST' && pathname === '/weread/api/client-diag') {
          // v1.8.2：客户端半的信使——inputTriggers 注册等关键节点回报宿主日志（防静默失败再浪费一轮排查）
          const body = await readBody(req);
          const msg = String(body?.msg ?? '').slice(0, 300);
          // P2-18：轻节流（60s 窗口 ≤30 条）——防同源页面刷屏覆盖 400 行环形日志的真实诊断信息
          if (msg && (Date.now() - clientDiagWindow.at > 60_000 || clientDiagWindow.n < 30)) {
            if (Date.now() - clientDiagWindow.at > 60_000) clientDiagWindow.n = 0;
            clientDiagWindow.n += 1; clientDiagWindow.at = Date.now();
            logOp('INFO', `[client] ${msg}`);
          }
          return J({ ok: true });
        }
        if (method === 'GET' && pathname === '/weread/api/logs') {
          const channel = url.searchParams.get('channel') ?? 'op';
          return J({ lines: [...(logBufs[channel] ?? [])] });
        }
        if (method === 'POST' && pathname === '/weread/api/logs/clear') {
          const body = await readBody(req);
          const channel = body.channel ?? 'op';
          logBufs[channel] = ['日志已清空，等待下一次操作'];
          return J({ ok: true });
        }

        if (method === 'POST' && pathname === '/weread/api/cleanup/duplicates') {
          const body = await readBody(req);
          const r = await withWriteSuppress(() => cleanup.cleanupDuplicateBookFilesForAccount(store.getActiveAccountId() ?? undefined, { dryRun: body.dryRun !== false }));
          return J(r);
        }
        if (method === 'POST' && pathname === '/weread/api/cleanup/restore') {
          const r = await cleanup.restoreLatest(store.getActiveAccountId() ?? undefined);
          return J(r);
        }

        if (method === 'GET' && pathname === '/weread/api/fs/list') {
          const raw = url.searchParams.get('path') || os.homedir();
          const dir = normalizeOutputPath(raw);
          // P2（信息泄露面）：目录浏览限定 $HOME 子树（防配合本地面枚举任意目录）
          {
            const home = os.homedir();
            if (dir !== home && !dir.startsWith(home + path.sep)) {
              return sendJson(res, 403, { error: '仅允许浏览用户主目录' });
            }
          }
          let entries = [];
          try {
            entries = (await fs.promises.readdir(dir, { withFileTypes: true }))
              .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
              .map((e) => e.name).sort((a, b) => a.localeCompare(b, 'zh-CN'));
          } catch (err) { return sendJson(res, 400, { error: `无法读取目录：${err.message}` }); }
          const parent = path.dirname(dir);
          return J({ path: dir, parent: parent === dir ? null : parent, dirs: entries });
        }
        if (method === 'POST' && pathname === '/weread/api/fs/mkdir') {
          const body = await readBody(req);
          const name = String(body.name ?? '').trim().replace(/[/\\:*?"<>|]/g, '_');
          if (!name) return sendJson(res, 400, { error: '文件夹名不能为空' });
          const target = path.join(normalizeOutputPath(String(body.parent ?? os.homedir())), name);
          try { await fs.promises.mkdir(target, { recursive: true }); } catch (err) { return sendJson(res, 400, { error: err.message }); }
          return J({ path: target });
        }
        if (method === 'GET' && pathname === '/weread/api/openapi.json') {
          return J({
            name: 'dsh-weread', version: '1.8.5',
            description: '微信读书笔记插件公开 JSON API（同源；供其他工具/MCP 包装消费）',
            auth: '浏览器同源 Cookie；非浏览器调用需带 Host 一致的 Origin 或无 Origin',
            endpoints: {
              'GET /weread/api/state': '总状态（登录/账号/配置/同步/校验/书数）',
              'GET /weread/api/bookshelf?query=&refresh=1': '书架分组（分类/书籍）',
              'GET /weread/api/book/:bookId': '书籍详情+章节+笔记',
              'GET /weread/api/notes/search?q=': '全文笔记搜索（打分）',
              'GET /weread/api/insights?days=&category=&noteType=&finishedOnly=&granularity=': '阅读洞察全指标',
              'GET /weread/api/roaming/session': '漫游当前卡',
              'POST /weread/api/roaming/action {action: next|prev|review|favorite|unfavorite|skip|openSource|refresh}': '漫游操作',
              'POST /weread/api/roaming/filter {noteTypes?,favoriteOnly?,minDaysUnreviewed?}': '漫游筛选',
              'POST /weread/api/sync': '触发同步（异步，轮询 state 看 progress）',
              'POST /weread/api/login/cookie {wrVid,wrSkey}': 'Cookie 登录',
              'POST /weread/api/login/apikey {apiKey}': 'API Key 官方通道登录（已登录=绑定当前账号）',
              'POST /weread/api/gateway/test': '官方网关自检（ping + /_list，验证闸门）',
              'POST /weread/api/gateway/unbind': '解绑当前账号的 API Key',
              'POST /weread/api/login/verify': '实时核验各登录通道有效状态',
              'GET /weread/api/gateway/stats?mode=weekly|monthly|annually|overall': '官方阅读统计（v1.3）',
              'GET /weread/api/gateway/progress?bookId=': '精确阅读进度（v1.3）',
              'GET /weread/api/gateway/search?keyword=&scope=&maxIdx=': '书城搜索：scope 0全部/10电子书/14听书/6作者/12全文/2公众号（v1.3）',
              'GET /weread/api/gateway/recommend?count=': '个性化推荐（v1.3）',
              'GET /weread/api/gateway/similar?bookId=': '相似书推荐（v1.3）',
              'GET /weread/api/gateway/reviews?bookId=&listType=': '公开书评（v1.3）',
              'GET /weread/api/gateway/bestbookmarks?bookId=': '全书热门划线 Top20（v1.3）',
              'POST /weread/api/open-reader {url}': '单例阅读窗口打开书籍（v1.5：Chrome app 窗口复用导航，不开多窗/不用默认浏览器）',
              'GET /weread/api/open-reader/diagnose': '阅读窗口自检（Chrome/CDP/窗口存活）',
              'POST /weread/api/open-reader/close': '关闭单例阅读窗口',
              'POST /weread/api/output-path/validate {path}': '校验并应用输出目录',
            },
          });
        }
        return sendJson(res, 404, { error: `no route: ${method} ${pathname}` });
      } catch (e) {
        sendJson(res, 500, { error: e?.message ?? String(e) });
      }
    },
  })));

  // ---------- A2: 阅读上下文注入（systemPrompt 动态 context，10 分钟缓存；v0.5 可配置） ----------
  if (ctx.systemPrompt?.context) {
    const rebuildReadingContext = async () => {
      if (readingCtxBuilding) return;
      readingCtxBuilding = true;
      try {
        const cfg = config();
        let text = '';
        if (cfg.ctxInjectEnabled) {
          const accountId = store.getActiveAccountId() ?? undefined;
          const books = await index.queryBooks(accountId) ?? [];
          const excludeWords = String(cfg.ctxExcludeTitles || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
          const visible = excludeWords.length ? books.filter((b) => !excludeWords.some((w) => String(b.title ?? '').includes(w))) : books;
          const recent = [...visible].sort((a, b) => (b.lastReadTime ?? 0) - (a.lastReadTime ?? 0)).slice(0, cfg.ctxBookCount);
          if (recent.length) {
            const lines = recent.map((b) => `- 《${b.title}》${b.author ? ` ${b.author}` : ''}${b.progress ? `（进度 ${b.progress}%）` : ''}`);
            let hl = '';
            if (cfg.ctxIncludeHighlights) {
              try {
                const firstWithNotes = recent.find((b) => (b.noteCount ?? 0) > 0) ?? recent[0];
                const notes = await index.getNotesByBookId(firstWithNotes.bookId, accountId) ?? [];
                const pick = notes.filter((n) => n.highlightText).slice(-cfg.ctxHighlightCount);
                if (pick.length) {
                  hl = '\n用户近期划线（' + firstWithNotes.title + '）：\n' + pick.map((n) => '- ' + String(n.highlightText).slice(0, 80).replace(/\n/g, ' ')).join('\n');
                }
              } catch { /* ignore */ }
            }
            text = `用户近期阅读（微信读书插件提供，供对话参考；用户未提及时不必主动展开）：\n${lines.join('\n')}${hl}`;
          }
        }
        readingCtxCache = { at: Date.now(), text };
      } catch { /* 无数据则不注入 */ }
      finally { readingCtxBuilding = false; }
    };
    // text() 为同步签名（systemPrompt 约定）：未命中缓存时返回旧值并触发异步重建
    const buildReadingContext = () => {
      if (Date.now() - readingCtxCache.at >= 10 * 60_000) void rebuildReadingContext();
      return readingCtxCache.text;
    };
    try {
      ctx.effect(() => track(ctx.systemPrompt.context({
        name: 'weread:reading',
        order: 220,
        text: () => buildReadingContext(),
      })));
    } catch (e) { logOp('WARN', `systemPrompt.context 注册失败：${e.message}`); }
  }

  // ---------- A3: 凭据优先存 macOS Keychain（符合设备级约定，失败回退文件） ----------
  const keychainEnabled = process.platform === 'darwin' && prefs.keychain !== false;
  const kcService = 'dsh-weread';
  const kcRun = (args) => new Promise((resolve) => {
    execFile('/usr/bin/security', args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout));
  });
  if (keychainEnabled) {
    const kcAccountId = (id) => id || store.getActiveAccountId() || 'default';
    const kcApiKeyService = 'dsh-weread-apikey';
    const origSave = store.saveCookies.bind(store);
    const origClear = store.clearCookies.bind(store);
    // 读保持同步（文件）；写时镜像 Keychain；清时同步删 Keychain
    store.saveCookies = (accountId, cookies) => {
      origSave(accountId, cookies);
      void kcRun(['add-generic-password', '-U', '-s', kcService, '-a', kcAccountId(accountId), '-w', cookies])
        .then((out) => { if (out === null) logOp('WARN', 'Keychain 写入失败，凭据仅保存在本地 secrets.json'); });
    };
    store.clearCookies = (accountId) => {
      origClear(accountId);
      void kcRun(['delete-generic-password', '-s', kcService, '-a', kcAccountId(accountId)]);
    };
    // v1.1：API Key 镜像（独立服务名，避免与 cookie 条目串号）
    const origSaveKey = store.saveApiKey.bind(store);
    const origClearKey = store.clearApiKey.bind(store);
    store.saveApiKey = (accountId, key) => {
      origSaveKey(accountId, key);
      void kcRun(['add-generic-password', '-U', '-s', kcApiKeyService, '-a', kcAccountId(accountId), '-w', String(key ?? '')])
        .then((out) => { if (out === null) logOp('WARN', 'Keychain 写入 API Key 失败，仅保存在本地 secrets.json'); });
    };
    store.clearApiKey = (accountId) => {
      origClearKey(accountId);
      void kcRun(['delete-generic-password', '-s', kcApiKeyService, '-a', kcAccountId(accountId)]);
    };
    // 启动补水：文件无凭据而 Keychain 有 → 恢复到文件（保持同步读路径）
    void (async () => {
      try {
        const ids = ['default', ...store.listAccounts().map((a) => a.accountId)];
        for (const id of ids) {
          if (!store.getCookies(id)) {
            const out = await kcRun(['find-generic-password', '-s', kcService, '-a', id, '-w']);
            if (out && out.trim()) { origSave(id, out.trim()); logOp('INFO', `credentials: 从 Keychain 恢复账号 ${id} 的 cookie`); }
          }
          if (!store.getApiKey(id)) {
            const outKey = await kcRun(['find-generic-password', '-s', kcApiKeyService, '-a', id, '-w']);
            if (outKey && outKey.trim()) { origSaveKey(id, outKey.trim()); logOp('INFO', `credentials: 从 Keychain 恢复账号 ${id} 的 API Key`); }
          }
        }
        const cookies = store.getCookies();
        if (cookies) api.apiClient.setCookies(cookies);
        syncGatewayKey();
        if (cookies || store.getApiKey()) loginState.loggedIn = true;
      } catch { /* ignore */ }
    })();
    logOp('INFO', 'credentials: macOS Keychain mirror enabled (cookies + apikey, fallback secrets.json)');
  }

  // ---------- Agent 工具 ----------
  const textOutput = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  };
  ctx.effect(() => track(ctx.tools.register({
    name: 'weread',
    description: '微信读书笔记插件：同步微信读书笔记到本地 Markdown、查询书架、搜索笔记、查看阅读洞察、抽一张笔记漫游卡片。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['sync', 'status', 'books', 'search', 'notes', 'insights', 'roaming', 'ask', 'stats', 'store', 'recommend'], description: '要执行的操作；ask=基于本地笔记检索回答问题；stats=官方阅读统计；store=书城搜索（含全文/听书/作者）；recommend=个性化荐书' },
        query: { type: 'string', description: 'search / ask 时的关键词或问题；stats 时可传 weekly/monthly/annually/overall（默认 monthly）' },
        scope: { type: 'number', description: 'store 动作搜索范围：0 全部/10 电子书(默认)/14 听书/6 作者/12 全文/2 公众号' },
        bookId: { type: 'string', description: 'notes 动作：书籍 ID（books 结果中的 bookId）' },
      },
      required: ['action'],
    },
    output: textOutput,
    async execute(args) {
      // §11-2 富渲染：结构化卡片以 HTML 注释首行随文本下发给客户端 WereadToolView（模型可无视）
      const withCard = (card, text) => `<!--wr-card:${JSON.stringify(card).replace(/--/g, '- -')}-->\n${text}`;
      const acc = currentAccountView();
      if (args.action === 'status') {
        const cfg = config();
        let booksCount = 0; try { booksCount = (await index.queryBooks(acc.id ?? undefined)).length; } catch { /* ignore */ }
        const ss = sync.getSyncState(acc.id ?? undefined);
        const apiKey = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
        const reconcile = ss?.reconcile;
        return [
          `登录态：${loginState.loggedIn && acc.id ? `已登录（${acc.name ?? acc.id}）` : '未登录'}`,
          `账号：${acc.accounts.map((a) => `${a.name}${a.id === acc.id ? '(活跃)' : ''}`).join('、') || '无'}`,
          ...(apiKey
            ? [`官方通道：API Key 已绑定（尾号 ${apiKeyTail(apiKey)}，skill v${SKILL_VERSION}）`]
            : ['官方通道：未绑定 API Key（可选；绑定后同步走官方网关并启用对账）']),
          `输出目录：${cfg.outputPath || '未配置'}（校验：${validationView().summary}）`,
          `本地书籍：${booksCount} 本`,
          `最近同步：${ss?.lastSyncTime ? new Date(ss.lastSyncTime).toLocaleString('zh-CN') : '从未'}（${ss?.status ?? 'idle'}）`,
          ...(reconcile
            ? [`同步对账：${reconcile.mismatchedCount === 0
                ? `${reconcile.checkedBooks} 本书与服务端计数一致`
                : `${reconcile.mismatchedCount}/${reconcile.checkedBooks} 本不一致（本地条数 < 服务端=可能漏采，> 服务端=本地含手工内容），详见面板`}`]
            : []),
          `自动同步：${cfg.autoSync ? `开（${cfg.syncInterval}）` : '关'}`,
          ...(apiHealth.ok === false ? [`接口状态：不可达（${apiHealth.reason || '网络异常'}）—— 正在以本地数据运行`] : []),
        ].join('\n');
      }
      if (args.action === 'sync') {
        if (!acc.id) return '未登录，请先在微信读书面板登录。';
        if (!config().outputPath) return '未配置笔记存储路径。';
        const r = await withWriteSuppress(() => sync.fullSync(acc.id)); // P1-10：与其余三路同步入口一致（原版裸调致 fs.watch 自触发全库重建回归）
        return r.success
          ? `同步完成：${r.syncedBooks} 本书、${r.syncedNotes} 条笔记有更新。`
          : `同步失败：${r.error}`;
      }
      if (args.action === 'books') {
        const shelf = await buildBookshelf('');
        if (!shelf.groups.length) return '书架为空（未同步或目录未配置）。';
        const flat = shelf.groups.flatMap((g) => g.books).slice(0, 12)
          .map((b) => ({ t: b.title, id: b.bookId, p: b.progress ?? 0, h: b.highlightCount ?? 0, c: b.cover || '' }));
        return withCard({ kind: 'books', books: flat }, shelf.groups.map((g) => `${g.category}（${g.books.length}）\n` + g.books.slice(0, 10).map((b) => `  - ${b.title} · ${b.author || '佚名'} · 进度${b.progress ?? 0}% · 划线${b.highlightCount ?? 0}`).join('\n')).join('\n'));
      }
      if (args.action === 'search') {
        if (!args.query) return '请提供 query 关键词。';
        const items = await searchNotes(args.query);
        if (!items.length) return `没有匹配「${args.query}」的笔记。`;
        return withCard({ kind: 'search', hits: items.slice(0, 6).map((r) => ({ t: r.bookTitle, id: r.bookId, ch: r.note.chapterTitle || '', x: String(r.note.highlightText || r.note.thoughtText || '').slice(0, 60) })) },
          items.map((r) => `《${r.bookTitle}》${r.note.chapterTitle ? ` · ${r.note.chapterTitle}` : ''}\n${r.note.highlightText ?? ''}${r.note.thoughtText ? `\n💭 ${r.note.thoughtText}` : ''}`).join('\n---\n'));
      }
      if (args.action === 'ask') {
        // v0.5：本地打分检索 top-k（D1 决策：不引入向量/嵌入），带编号出处交由模型组织答案
        if (!args.query) return '请提供 query（问题或关键词）。';
        const items = await searchNotes(args.query, 12);
        if (!items.length) return `没有检索到与「${args.query}」相关的笔记。可换关键词，或先用 books 动作确认书架非空。`;
        const cited = items.map((r, i) => `[${i + 1}] 《${r.bookTitle}》${r.note.chapterTitle ? ` · ${r.note.chapterTitle}` : ''}\n${r.note.highlightText ?? ''}${r.note.thoughtText ? `\n💭 ${r.note.thoughtText}` : ''}`).join('\n\n');
        return `已检索 ${items.length} 条与「${args.query}」相关的本地笔记（按相关度排序）。请基于以下材料回答用户问题，注明出处编号，不要编造材料之外的内容：\n\n${cited}`;
      }
      if (args.action === 'insights') {
        const d = await analytics.getDashboardData({}, acc.id ?? undefined);
        const k = d.kpis ?? {};
        return withCard({ kind: 'insights', k: { a: k.activeDays ?? 0, s: k.longestStreakDays ?? 0, t: k.totalNotes ?? 0 } },
          `活跃 ${k.activeDays} 天 · 最长连续 ${k.longestStreakDays} 天 · 笔记 ${k.totalNotes} 条 · 深度占比 ${k.deepNoteRatio}% · 平均完成率 ${k.averageCompletionRate}%\nTop：${(d.topBooks ?? []).slice(0, 5).map((b) => `${b.title}(${b.notesCount})`).join('、')}`);
      }
      if (args.action === 'notes') {
        if (!args.bookId) return '请提供 bookId（可先用 books 动作查书架）。';
        const b = await index.getBookById(String(args.bookId), acc.id ?? undefined);
        if (!b) return `未找到书籍 ${args.bookId}`;
        const notes = await index.getNotesByBookId(String(args.bookId), acc.id ?? undefined);
        if (!notes.length) return `《${b.title}》暂无本地笔记。`;
        const body = notes.map((n) => `${n.chapterTitle ? `[${n.chapterTitle}] ` : ''}${n.highlightText ?? ''}${n.thoughtText ? `\n💭 ${n.thoughtText}` : ''}`).join('\n---\n');
        return withCard({ kind: 'notes', book: { t: b.title, id: b.bookId, n: notes.length } }, `《${b.title}》${b.author ?? ''} 共 ${notes.length} 条笔记：\n${body.slice(0, 8000)}`);
      }
      if (args.action === 'roaming') {
        const session = await roamingSessionView(acc.id ?? undefined);
        const card = session.card;
        if (!card) return session.reason ? `漫游池为空：${session.reason}` : '漫游池为空，请先同步笔记。';
        return withCard({ kind: 'roaming', card: { t: card.bookTitle, id: card.bookId, x: String(card.text || '').slice(0, 60), i: session.index, n: session.total } },
          `《${card.bookTitle}》${card.chapterTitle ? ` · ${card.chapterTitle}` : ''}（${session.index}/${session.total}，池 ${session.poolSize}）\n${card.text}`);
      }
      // ---------- v1.3：官方网关三动作（未绑 Key 给出引导语） ----------
      const fmtDur = (sec) => {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        return s >= 3600 ? `${Math.floor(s / 3600)} 小时 ${Math.round((s % 3600) / 60)} 分` : `${Math.floor(s / 60)} 分钟`;
      };
      if (args.action === 'stats') {
        const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
        if (!key) return '未绑定 API Key——请先在微信读书面板用 API Key 登录/绑定，再用 stats 查询官方阅读统计。';
        syncGatewayKey();
        const mode = ['weekly', 'monthly', 'annually', 'overall'].includes(String(args.query)) ? String(args.query) : 'monthly';
        try {
          const d = await gateway.readdata(mode);
          const lines = [
            `官方阅读统计（${mode}）：`,
            `- 总时长：${fmtDur(d.totalReadTime)} · 有效天数：${d.readDays ?? '-'} 天 · 日均：${fmtDur(d.dayAverageReadTime)}`,
            typeof d.compare === 'number' ? `- 环比上期：${d.compare >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(d.compare * 100))}%` : '',
            ...(Array.isArray(d.readStat) ? [`- ${d.readStat.map((s) => `${s.stat} ${s.counts}`).join(' · ')}`] : []),
            ...(Array.isArray(d.readLongest) && d.readLongest.length
              ? [`- 读得最多：${d.readLongest.slice(0, 3).map((b) => `《${b.book?.title ?? '?'}》${fmtDur(b.readTime)}`).join('、')}`] : []),
            ...(Array.isArray(d.preferCategory) && d.preferCategory.length
              ? [`- 偏好分类：${d.preferCategory.slice(0, 5).map((c) => `${c.categoryTitle}(${c.readingCount}本)`).join('、')}`] : []),
            d.preferTimeWord ? `- ${d.preferTimeWord}` : '',
          ].filter(Boolean);
          return lines.join('\n');
        } catch (e) { return `官方统计获取失败：${e?.message || e}`; }
      }
      if (args.action === 'store') {
        if (!args.query) return '请提供 query（书名/作者/关键词）。';
        const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
        if (!key) return '未绑定 API Key——书城搜索需要官方通道，请先在面板绑定。';
        syncGatewayKey();
        try {
          const d = await gateway.storeSearch({ keyword: args.query, scope: Number(args.scope ?? 10) });
          const rows = [];
          for (const g of d?.results ?? []) {
            for (const b of g.books ?? []) {
              const info = b.bookInfo ?? {};
              rows.push(`《${info.title}》${info.author ? ` ${info.author}` : ''} · ⭐${(b.newRating / 10).toFixed(1)} · ${b.readingCount ?? 0} 人在读 · ${info.category ?? ''}${info.readerLink ? ` · [打开阅读](${info.readerLink})` : info.deepLink ? ` · [详情](${info.deepLink})` : ''}`);
            }
          }
          if (!rows.length) return `没有找到与「${args.query}」相关的结果。`;
          return `书城搜索「${args.query}」（${rows.length} 条）：\n` + rows.map((r, i) => `${i + 1}. ${r}`).join('\n');
        } catch (e) { return `书城搜索失败：${e?.message || e}`; }
      }
      if (args.action === 'recommend') {
        const key = (() => { try { return store.getApiKey(); } catch { return undefined; } })();
        if (!key) return '未绑定 API Key——个性化推荐需要官方通道，请先在面板绑定。';
        syncGatewayKey();
        try {
          const d = await gateway.recommend({ count: 12 });
          const books = d?.books ?? [];
          if (!books.length) return '暂无推荐结果。';
          return '为你推荐：\n' + books.map((b, i) => `${i + 1}. 《${b.title}》${b.author ? ` ${b.author}` : ''} · ⭐${((b.newRating ?? 0) / 10).toFixed(1)}${b.reason ? ` · ${b.reason}` : ''}${b.readerLink ? ` · [打开](${b.readerLink})` : ''}`).join('\n');
        } catch (e) { return `推荐获取失败：${e?.message || e}`; }
      }
      return `未知操作：${args.action}`;
    },
  })));

  logOp('INFO', 'weread plugin applied');
  return () => { for (const d of disposers) { try { d?.(); } catch { /* ignore */ } } };
}
