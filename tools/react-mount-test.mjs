/* 真实 React 挂载 client.js 的 App：复现面板空白崩溃 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
class EB extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.log('[Boundary 捕获]', err && (err.stack || err.message || String(err)).split('\n').slice(0, 10).join('\n')); }
  render() { return this.state.err ? h_null() : this.props.children; }
}
function h_null() { return null; }
import { create, act } from 'react-test-renderer';
const origErr = console.error;
console.error = (...a) => { origErr('[console.error]', ...a); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let code = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');

const STATE = {
  loggedIn: true,
  account: { id: '2100000002', name: '测试', avatar: null },
  accounts: [{ id: '2100000002', name: '测试', active: true }],
  config: {
    outputPath: '/tmp/x', autoSync: true, syncInterval: '24h', categoryMode: 'level1',
    showCover: true, multiAccountEnabled: true, language: 'zh-CN',
    exportThemes: [{ id: 'white', name: '纯白', bg: '#fff', primary: '#333', weekday: '#666', divider: '#ddd', watermark: '#999' }, { id: 'dark', name: '暗夜黑', bg: '#111', primary: '#eee', weekday: '#aaa', divider: '#444', watermark: '#888' }],
    uiSidebarKpi: true, uiComposerRoaming: true, uiRoamingScrollMode: 'marquee',
    uiRoamingFontSize: 12, uiRoamingScrollSpeed: 48, uiRoamingRotateEnabled: true, uiRoamingRotateSec: 30,
  },
  syncState: { lastSyncTime: Date.now(), status: 'success' },
  syncProgress: null,
  validation: { status: 'passed', failReason: '', summary: 'passed' },
  outputPath: '/tmp/x',
  booksCount: 24,
};
const BOOKSHELF = { groups: [{ category: '科技', books: [{ bookId: 'b1', title: '书A', author: '甲', cover: '', progress: 40, readingStatus: 1, highlightCount: 3, noteCount: 5, lastReadTime: 1 }, { bookId: 'b2', title: '书B', author: '乙', cover: '', progress: 0, readingStatus: 0, highlightCount: 0, noteCount: 0, lastReadTime: 2 }] }], total: 2, filtered: 2 };

const routes = (p) => {
  if (p === '/state') return STATE;
  if (p.startsWith('/bookshelf')) return BOOKSHELF;
  if (p === '/roaming/card') return { card: null, poolSize: 0 };
  if (p.startsWith('/insights')) return { filter: {}, kpis: { activeDays: 1 }, topBooks: [], timeline: [], availableCategories: ['科技'], trend: [], heatmap: [], categoryShare: [], scatter: [], authorCloud: [], categoryRadar: [] };
  if (p === '/roaming/session') return { card: null, index: 0, total: 0, poolSize: 0, statsPoolSize: 0, filter: {}, stats: { recentDailyReviews: [] } };
  return {};
};

let W = null; let registered = {};
const listeners = new Map();
const sandbox = {
  window: {
    addEventListener: (t, f) => { (listeners.get(t) || listeners.set(t, []).get(t)).push(f); },
    removeEventListener: (t, f) => { const a = listeners.get(t); if (a) listeners.set(t, a.filter((x) => x !== f)); },
    dispatchEvent: (e) => { (listeners.get(e.type) || []).forEach((f) => f(e)); return true; },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem: () => {} },
  },
  document: { createElement: () => ({ click() {}, style: {} }), addEventListener() {}, removeEventListener() {}, body: { appendChild() {}, removeChild() {} } },
  navigator: { clipboard: { write: async () => {} } },
  fetch: async (url) => {
    const p = String(url).replace(/^.*?\/weread\/api/, '').split('?')[0] || '/state';
    await new Promise((r) => setTimeout(r, 1));
    return { ok: true, json: async () => routes(p) };
  },
  setInterval: () => 0, clearInterval: () => {},
  // E-F2/@选书防抖需要真 timer（原假 setTimeout 不执行回调 → 防抖 Promise 永不 resolve）。
  // 上限 500ms 防慢测试；unref 不阻进程退出。
  setTimeout: (fn, ms) => { const t = setTimeout(fn, Math.min(Number(ms) || 0, 500)); t.unref?.(); return t; },
  clearTimeout: (id) => { try { clearTimeout(id); } catch (e) { /* ignore */ } },
  CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
  matchMedia: () => ({ matches: false }),
  console, URL, URLSearchParams,
};
sandbox.window.__ModuleLoader__ = { load(mod) { const ret = mod.factory((n) => (n === 'react' ? React : (() => { throw new Error('req ' + n); })())); sandbox.__ret = ret; } };
sandbox.window.matchMedia = sandbox.matchMedia;
// E-F2/@选书防抖：模块闭包里的裸 setTimeout 解析到 sandbox 顶层——vm 默认骨架存在但不执行回调，
// 顶层必须注入真 timer（上限 500ms 防慢测试；unref 不阻进程退出）。
sandbox.setTimeout = (fn, ms) => { const t = setTimeout(fn, Math.min(Number(ms) || 0, 500)); t.unref?.(); return t; };
sandbox.clearTimeout = (id) => { try { clearTimeout(id); } catch (e) { /* ignore */ } };
sandbox.reportError = (e) => { origErr('[reportError 原始错误]', e && (e.stack || e.message || String(e))); };
sandbox.window.reportError = sandbox.reportError;
vm.createContext(sandbox);
try {
  code = code.replace('return {\n      inject:', 'window.__W = W; return {\n      inject:');
vm.runInContext(code, sandbox, { filename: 'client.js' });
} catch (e) {
  console.error('[模块加载崩溃]', e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
const ret = sandbox.__ret;
const slots = [];
// E-F2（对抗审查 v2）：@选书回归守卫——v1.8.3 真机事故（DSH 菜单对 item.name 无守卫解引用，
// 候选缺 name 崩整个 @ 菜单）与 v1.8.1 双门禁（缺 inject 声明注册被静默吞）都发生在这一层。
// fake inputTriggers 捕获注册源，断言候选条目含 {name,label,value} 安全形状。
const registeredSources = [];
const fakeTriggers = {
  registerSource(src) { registeredSources.push(src); return () => { const i = registeredSources.indexOf(src); if (i >= 0) registeredSources.splice(i, 1); }; },
};
const fakeSlotCtx = {
  slots: {
    inject: (name, fn) => { try { const g = fn(); if (g && typeof g.next === 'function') { const r = g.next(); if (!r.done && r.value) slots.push(r.value); } else if (g) slots.push(g); } catch (e) { console.error(`[槽位 ${name} 注册崩溃]`, e.stack.split('\n').slice(0, 4).join('\n')); } },
    register: (opt, comp) => (slots.push({ opt, comp }), { opt, comp }),
  },
  locale: { register() {} },
  get: (svc) => (svc === 'inputTriggers' ? fakeTriggers : undefined),
  effect: (fn) => { fn(); return () => {}; },
};
ret.apply(fakeSlotCtx);
const appReg = slots.find((s) => s.opt && s.opt.key === 'weread') || slots.find((s) => s.comp && String(s.comp.name || '').includes('App'));
if (!appReg) { console.error('未找到 App 注册；slots=', slots.map((s) => s.opt && s.opt.key)); process.exit(1); }
const App = appReg.comp ?? appReg;
try {
  const W_ = sandbox.window.__W;
  await act(async () => {
    const r0 = create(React.createElement(EB, null, React.createElement(W_.Bookshelf, { state: STATE, onNavigate: () => {}, onToast: () => {}, refreshState: async () => {} })));
    await new Promise((res) => setTimeout(res, 30));
    const j0 = JSON.stringify(r0.toJSON?.() ?? null); console.log('[Bookshelf 直挂] 树大小:', j0 ? j0.length : 'NULL');
  });
} catch (e) { console.error('[Bookshelf 直挂崩溃]', e.stack.split('\n').slice(0, 12).join('\n')); process.exit(1); }
try {
  let r;
  await act(async () => {
    r = create(React.createElement(EB, null, React.createElement(App)));
    await new Promise((res) => setTimeout(res, 50));
  });
  const json = JSON.stringify(r.toJSON?.() ?? null) ?? '';
  console.log('[App 挂载] 树大小:', json.length, '| 含书架按钮:', json.includes('树状') || json.includes('卡片'), '| 含tabs:', json.includes('洞察'));
  if (json.length < 1000) { console.error('✗ App 挂载树过小（疑似错误边界吞掉渲染崩溃）'); process.exitCode = 1; }
} catch (e) { console.error('[App 挂载崩溃]', e.stack.split('\n').slice(0, 10).join('\n')); process.exit(1); }
// 降级横幅：apiHealth.ok=false 时 App 顶部应出现「接口不可达」提示
try {
  let r2;
  STATE.apiHealth = { ok: false, checkedAt: Date.now(), reason: 'ENOTFOUND' };
  await act(async () => {
    r2 = create(React.createElement(EB, null, React.createElement(App)));
    await new Promise((res) => setTimeout(res, 50));
  });
  const j2 = JSON.stringify(r2.toJSON?.() ?? null) ?? '';
  const has = j2.includes('接口不可达');
  console.log('[降级横幅]', has ? '✓ 渲染' : '✗ 未渲染');
  if (!has) process.exitCode = 1;
} catch (e) { console.error('[降级横幅检查崩溃]', e.stack.split('\n').slice(0, 8).join('\n')); process.exitCode = 1; }
// 再渲染 dock/侧栏组件
for (const maker of ['WereadRoamingDock', 'WereadFooterPill']) {
  const C = sandbox.window.__W?.[maker] || (W && W[maker]);
  if (!C) { console.log(`(${maker} 未导出到 W，跳过)`); continue; }
  await act(async () => {
    try { const r = create(React.createElement(C)); await act(async () => { await new Promise((res) => setTimeout(res, 20)); }); console.log(`[${maker} 挂载成功]`); }
    catch (e) { console.error(`[${maker} 崩溃]`, e.stack.split('\n').slice(0, 6).join('\n')); process.exitCode = 1; }
  });
}
// v1.1.1 回归：跨页签登录引导——设置页发 weread:open-login（tab=apikey）时书架未挂载，
// 事件只被 App 层暂存；切回书架后弹层必须打开且直达 API Key tab（修复：只跳页不弹窗）
try {
  let r3;
  await act(async () => {
    r3 = create(React.createElement(EB, null, React.createElement(App)));
    await new Promise((res) => setTimeout(res, 50));
  });
  const findTab = (label) => r3.root.findAll((n) => typeof n.props?.className === 'string' && n.props.className.includes('wr-tab'))
    .find((n) => (n.children ?? []).some((c) => String(c).includes(label)));
  const settingsTab = findTab('设置');
  if (!settingsTab) throw new Error('未找到设置 tab 按钮');
  await act(async () => { settingsTab.props.onClick(); await new Promise((res) => setTimeout(res, 20)); });
  // 此时书架已卸载：模拟设置页「绑定 API Key」按钮派发事件
  await act(async () => {
    sandbox.window.dispatchEvent({ type: 'weread:open-login', detail: { tab: 'apikey' } });
    await new Promise((res) => setTimeout(res, 30));
  });
  const j3 = JSON.stringify(r3.toJSON?.() ?? null) ?? '';
  const hasModal = j3.includes('API Key（wrk- 开头）') && j3.includes('此 Key 将绑定到当前账号');
  console.log('[跨页签登录引导]', hasModal ? '✓ 弹层打开且直达 API Key tab' : '✗ 弹层未出现或 tab 不对');
  if (!hasModal) process.exitCode = 1;
  if (sandbox.window.__W.__pendingLogin) { console.error('✗ __pendingLogin 未被消费'); process.exitCode = 1; }
  else console.log('[暂存消费] ✓ __pendingLogin 已清');
} catch (e) { console.error('[跨页签登录引导检查崩溃]', e.stack.split('\n').slice(0, 8).join('\n')); process.exitCode = 1; }

// ---------- E-F2：@选书 inputTriggers 注册形状守卫（v1.8.1/1.8.3 真机事故回归线） ----------
try {
  const src = registeredSources.find((s) => s && s.trigger === '@' && s.name === 'weread-book');
  if (!src) { console.error('✗ @选书：inputTriggers 源未注册（inject 门禁或注册路径回归）'); process.exitCode = 1; }
  else if (typeof src.candidates !== 'function' || typeof src.onPick !== 'function') { console.error('✗ @选书：源缺 candidates/onPick'); process.exitCode = 1; }
  else {
    // 注：candidates 返回 vm sandbox realm 的 Promise，跨 realm 直接 await 有适配怪癖——
    // 经 Node realm 的 Promise.race 包装后行为正常（超时 3s 兜底防测试挂死）
    const callCands = (q) => Promise.race([
      src.candidates({}, { query: q, signal: undefined }),
      new Promise((rr) => setTimeout(() => rr(null), 3000)),
    ]).catch((e2) => { console.error('✗ @选书：candidates 抛错', e2?.message); process.exitCode = 1; return []; });
    const cands = (await callCands('微信读书')) ?? [];
    const bad = cands.filter((c) => !c.name || !c.label || c.value === undefined);
    if (!cands.length) { console.error('✗ @选书：候选为空/超时（防抖或 fetch 链在 sandbox 挂起）'); process.exitCode = 1; }
    else if (bad.length) { console.error(`✗ @选书：${bad.length} 条候选缺 name/label/value（DSH 菜单 item.name 无守卫解引用会崩整个 @ 菜单）`); process.exitCode = 1; }
    else console.log(`[@选书] ✓ 源已注册，候选 ${cands.length} 条形状合规（name/label/value 齐全）`);
    const noMatch = (await callCands('别的词')) ?? [];
    if (noMatch.length) { console.error('✗ @选书：非前缀词不应出候选（前缀门控回归）'); process.exitCode = 1; }
    else console.log('[@选书] ✓ 前缀门控（非 @微信读书/@weread 前缀不出本组）');
  }
} catch (e) { console.error('[@选书 检查崩溃]', e.stack.split('\n').slice(0, 6).join('\n')); process.exitCode = 1; }
console.log('DONE');
