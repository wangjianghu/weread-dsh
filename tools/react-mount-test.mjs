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

let logsOverride = null; // v1.9.17 日志复制测试：置为数组可覆盖 /logs 返回（null=用默认两行）
let stateOverride = null; // v1.9.19 Skill 升级测试：覆盖 /state 返回（null=用默认 STATE）
let fetchHook = null;     // v1.9.19：按需模拟失败响应（返回非 null 即直接采用）
const routes = (p) => {
  if (p === '/state') return stateOverride ?? STATE;
  if (p.startsWith('/bookshelf')) return BOOKSHELF;
  if (p === '/roaming/card') return { card: null, poolSize: 0 };
  if (p === '/gateway/skill-upgrade') return { ok: true, changed: true, from: '1.0.5', to: '1.0.6' }; // v1.9.19 Skill 升级
  if (p === '/logs') return { lines: logsOverride ?? ['[2026-11-25T12:00:00.000Z] [INFO] [WeRead:op] LOG-LINE-ALPHA 排障样例一', '[2026-11-25T12:00:01.000Z] [warn] [WeRead:op] LOG-LINE-BETA 排障样例二'] }; // v1.9.17 日志复制
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
  fetch: async (url, init) => {
    const hooked = fetchHook ? await fetchHook(String(url), init) : null;
    if (hooked) return hooked;
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


// ---------- v1.9.17：设置页日志「复制」按钮（真实 React 挂载 + 桩剪贴板） ----------
// 验证：① 未加载日志时按钮禁用；② 加载后可点；③ 复制内容=所见日志（带头行）+ 成功提示；
// ④ 剪贴板不可用时给出失败提示而非静默。
try {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (root) => JSON.stringify(root.toJSON?.() ?? null) ?? '';
  const btnWith = (root, label) => root.root.findAll((n2) => n2.type === 'button', { deep: true }).find((n2) => (n2.children ?? []).some((c) => String(c) === label));
  // 桩剪贴板：记录写入内容；clipFail 模拟浏览器拒绝授权
  let clipText = null; let clipFail = false;
  const origNav = sandbox.navigator;
  sandbox.navigator = { ...origNav, clipboard: { write: async () => {}, writeText: async (t) => { if (clipFail) throw new Error('denied'); clipText = t; } } };
  let r9;
  await act(async () => { r9 = create(React.createElement(EB, null, React.createElement(App))); await wait(60); });
  const tab9 = r9.root.findAll((n2) => n2.type === 'button', { deep: true }).find((n2) => (n2.children ?? []).some((c) => String(c).includes('设置')));
  await act(async () => { tab9.props.onClick(); await wait(40); });
  const copyBtn = () => btnWith(r9, '复制');
  // 设置页挂载即自动加载日志（50-settings.js: useEffect → loadLogs），不存在「进了设置页却未加载」
  // 的稳定态——首版断言测的是不会出现的状态。真实存在的禁用态是「加载结果为空」。
  logsOverride = []; // 模拟该通道无日志（见上方 routes 桩的 logsOverride 钩子）
  const refreshBtn0 = btnWith(r9, '刷新');
  await act(async () => { refreshBtn0.props.onClick(); await wait(40); });
  const emptyShown = textOf(r9).includes('暂无数据');
  const step1 = emptyShown && !!copyBtn() && copyBtn().props.disabled === true;
  logsOverride = null; // 恢复：后续场景用正常日志数据
  console.log('[日志复制 ①空日志]', step1 ? '✓ 通道无日志时「复制」禁用' : `✗ 空日志应禁用（已显示空态=${emptyShown}，disabled=${copyBtn()?.props?.disabled}）`);

  const refreshBtn = btnWith(r9, '刷新');
  await act(async () => { refreshBtn.props.onClick(); await wait(40); });
  const loaded = textOf(r9).includes('LOG-LINE-ALPHA');
  const step2 = loaded && !!copyBtn() && copyBtn().props.disabled === false;
  console.log('[日志复制 ②加载后]', step2 ? '✓ 加载后「复制」可点' : `✗ 加载后应可点（日志已显示=${loaded}，按钮=${!!copyBtn()}）`);

  clipText = null;
  await act(async () => { copyBtn().props.onClick(); await wait(40); });
  const lines = clipText ? clipText.split('\n') : [];
  const step3 = lines.length === 3 && /^# weread-dsh v[\d.]+ · 日志通道: op · 2 行 · 复制于 \d{4}-\d{2}-\d{2}T/.test(lines[0])
    && lines[1].includes('LOG-LINE-ALPHA') && lines[2].includes('LOG-LINE-BETA');
  console.log('[日志复制 ③内容]', step3 ? '✓ 复制内容 = 头行（版本/通道/行数/时间）+ 所见 2 行日志' : `✗ 内容不符：${JSON.stringify(clipText)}`);
  const toastOk = textOf(r9).includes('已复制 2 行日志');
  console.log('[日志复制 ③提示]', toastOk ? '✓ 成功 toast「已复制 2 行日志」' : '✗ 未见成功提示');

  clipFail = true;
  await act(async () => { copyBtn().props.onClick(); await wait(40); });
  const toastFail = textOf(r9).includes('复制失败');
  console.log('[日志复制 ④失败态]', toastFail ? '✓ 剪贴板不可用时提示「复制失败」' : '✗ 未见失败提示');
  sandbox.navigator = origNav;
  await act(async () => { r9.unmount(); await wait(20); });
  if (!(step1 && step2 && step3 && toastOk && toastFail)) { console.error('✗ 日志复制存在失败项'); process.exitCode = 1; }
} catch (e) { console.error('[日志复制检查崩溃]', e.stack.split('\n').slice(0, 8).join('\n')); process.exitCode = 1; }

// ---------- v1.9.19：设置页官方 Skill 一键升级（真实 React 挂载） ----------
// 验证：① 有新版本时显示一行人话 + 按钮，不再显示原始 JSON；② 点击 → 发升级请求 → 成功提示 + 版本标签更新 +
// 提示消失；③ 失败时显示带原因的红色提示。服务端状态用 stateOverride 模拟（点击后客户端会 refreshState）。
try {
  const W_ = sandbox.window.__W;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (root) => JSON.stringify(root.toJSON?.() ?? null) ?? '';
  const btnWith = (root, label) => root.root.findAll((n2) => n2.type === 'button', { deep: true }).find((n2) => (n2.children ?? []).some((c) => String(c) === label));
  const NOTICE = { latest_version: '1.0.6', current_version: '1.0.5', message: '微信读书 Skill 有新版本。本次请求已正常处理。', upgrade_url: 'https://cdn.weread.qq.com/skills/weread-skills.zip' };
  const GW_BEFORE = { enabled: true, keyTail: 'Ab12', skillVersion: '1.0.5', bundledSkillVersion: '1.0.5', skillVersionOverridden: false, upgrade: { info: NOTICE, at: 1 } };
  const GW_AFTER = { enabled: true, keyTail: 'Ab12', skillVersion: '1.0.6', bundledSkillVersion: '1.0.5', skillVersionOverridden: true, upgrade: null };
  const posts = []; const origHook = fetchHook;
  fetchHook = async (url) => { if (String(url).includes('/gateway/skill-upgrade')) { posts.push(String(url)); return null; } return null; }; // 只记录，仍走正常桩

  stateOverride = { ...STATE, gateway: GW_BEFORE };
  let r10;
  await act(async () => { r10 = create(React.createElement(EB, null, React.createElement(App))); await wait(60); });
  const tab10 = r10.root.findAll((n2) => n2.type === 'button', { deep: true }).find((n2) => (n2.children ?? []).some((c) => String(c).includes('设置')));
  await act(async () => { tab10.props.onClick(); await wait(40); });
  let txt = textOf(r10);
  const s1a = txt.includes(W_.t.skillUpgradeAvailable('1.0.5', '1.0.6'));
  const s1b = !txt.includes('latest_version') && !txt.includes('upgrade_url') && !txt.includes('版本提示：{'); // 旧版原始 JSON 提示的文案前缀
  const s1c = txt.includes('skill v1.0.5') && !!btnWith(r10, W_.t.skillUpgradeBtn);
  console.log('[Skill 升级 ①提示]', s1a ? '✓ 显示「官方 Skill 有新版本 v1.0.6（当前 v1.0.5）」+ 升级按钮' : '✗ 未显示人话提示');
  console.log('[Skill 升级 ①无JSON]', s1b ? '✓ 不再显示原始 JSON（latest_version/upgrade_url）' : '✗ 仍在显示原始 JSON');

  stateOverride = { ...STATE, gateway: GW_AFTER }; // 模拟服务端：升级已生效
  await act(async () => { btnWith(r10, W_.t.skillUpgradeBtn).props.onClick(); await wait(80); });
  txt = textOf(r10);
  const s2 = posts.length === 1 && txt.includes(W_.t.skillUpgraded('1.0.6'));
  const s3 = txt.includes('skill v1.0.6') && txt.includes(W_.t.skillUpgradedNote('1.0.6', '1.0.5')) && !btnWith(r10, W_.t.skillUpgradeBtn) && !txt.includes(W_.t.skillUpgradeAvailable('1.0.5', '1.0.6'));
  console.log('[Skill 升级 ②点击]', s1c && s2 ? '✓ 点击发出 1 次升级请求 → 显示「官方 Skill 已升级到 v1.0.6」' : `✗ 请求 ${posts.length} 次，提示未出现`);
  console.log('[Skill 升级 ③之后]', s3 ? '✓ 版本标签变 v1.0.6、注明由插件内升级、升级提示与按钮消失' : '✗ 升级后的界面状态不对');
  // v1.9.21：说明文案要自解释——「内置 vX」会被读成没升级成功。三份语言表都钉住（简体那份同时管逻辑）。
  const noteZh = W_.t.skillUpgradedNote('1.0.7', '1.0.6');
  const noteEn = W_.T_EN.skillUpgradedNote('1.0.7', '1.0.6');
  const noteTw = W_.T_ZH_TW.skillUpgradedNote('1.0.7', '1.0.6');
  const s3b = /当前生效 v1\.0\.7/.test(noteZh) && noteZh.includes('默认值是 v1.0.6') && !noteZh.includes('内置 v')
    && noteEn.includes('v1.0.7 in effect') && noteEn.includes('bundled default is v1.0.6')
    && noteTw.includes('目前生效 v1.0.7') && noteTw.includes('預設值是 v1.0.6');
  console.log('[Skill 升级 ③b说明文案]', s3b ? '✓ 「当前生效 vX；安装包自带的默认值是 vY」三语自解释，不再出现「内置 vX」' : '✗ 说明文案不正确');
  await act(async () => { r10.unmount(); await wait(20); });

  // 失败态：服务端 502（已回滚）→ 红色提示带原因，提示与按钮仍在
  fetchHook = async (url) => (String(url).includes('/gateway/skill-upgrade')
    ? { ok: false, status: 502, json: async () => ({ ok: false, error: '切换到 v1.0.6 后官方通道验证失败，已回退到 v1.0.5：网关拒绝' }) }
    : null);
  stateOverride = { ...STATE, gateway: GW_BEFORE };
  let r11;
  await act(async () => { r11 = create(React.createElement(EB, null, React.createElement(App))); await wait(60); });
  const tab11 = r11.root.findAll((n2) => n2.type === 'button', { deep: true }).find((n2) => (n2.children ?? []).some((c) => String(c).includes('设置')));
  await act(async () => { tab11.props.onClick(); await wait(40); });
  await act(async () => { btnWith(r11, W_.t.skillUpgradeBtn).props.onClick(); await wait(60); });
  txt = textOf(r11);
  const s4 = txt.includes('✗ ' + W_.t.skillUpgradeFailed('切换到 v1.0.6 后官方通道验证失败，已回退到 v1.0.5：网关拒绝')) && txt.includes('skill v1.0.5') && !!btnWith(r11, W_.t.skillUpgradeBtn);
  console.log('[Skill 升级 ④失败态]', s4 ? '✓ 失败 → 红色提示带原因；版本未变、可重试' : '✗ 失败提示不正确');
  await act(async () => { r11.unmount(); await wait(20); });

  // v1.9.20 宿主未重载：界面热更新了、宿主进程还是旧版（没有升级路由）→ 404「no route」。
  // 对用户说人话「重启 DSH」，不把路由路径甩出来（真机截图：✗ Skill 升级失败：no route: POST /weread/api/gateway/skill-upgrade）。
  fetchHook = async (url) => (String(url).includes('/gateway/skill-upgrade')
    ? { ok: false, status: 404, json: async () => ({ error: 'no route: POST /weread/api/gateway/skill-upgrade' }) }
    : null);
  stateOverride = { ...STATE, gateway: GW_BEFORE };
  let r12;
  await act(async () => { r12 = create(React.createElement(EB, null, React.createElement(App))); await wait(60); });
  const tab12 = r12.root.findAll((n2) => n2.type === 'button', { deep: true }).find((n2) => (n2.children ?? []).some((c) => String(c).includes('设置')));
  await act(async () => { tab12.props.onClick(); await wait(40); });
  await act(async () => { btnWith(r12, W_.t.skillUpgradeBtn).props.onClick(); await wait(60); });
  txt = textOf(r12);
  const s5 = txt.includes('✗ ' + W_.t.skillUpgradeStaleHost) && !txt.includes('no route') && !!btnWith(r12, W_.t.skillUpgradeBtn);
  console.log('[Skill 升级 ⑤宿主未重载]', s5 ? '✓ 404 no route → 提示「重启 DeepSeek Harness 后再试」，不显示路由路径' : '✗ 宿主未重载的提示不正确');
  await act(async () => { r12.unmount(); await wait(20); });
  fetchHook = origHook;

  // v1.9.20 对账提示按方向说话：本地多于服务端（真机：25 本全是重复副本）不再说「可能漏采」；
  // 本地少于服务端才说漏采。settings 面板的 state 来自 App，故两个场景各挂载一次。
  const recRow = (title, local, expected) => ({ title, local, expected, diff: expected - local });
  const mountSettingsWith = async (reconcile) => {
    stateOverride = { ...STATE, syncState: { ...STATE.syncState, reconcile } };
    let root;
    await act(async () => { root = create(React.createElement(EB, null, React.createElement(App))); await wait(60); });
    const tab = root.root.findAll((n2) => n2.type === 'button', { deep: true }).find((n2) => (n2.children ?? []).some((c) => String(c).includes('设置')));
    await act(async () => { tab.props.onClick(); await wait(40); });
    const out = textOf(root);
    await act(async () => { root.unmount(); await wait(20); });
    return out;
  };
  const recMore = { checkedAt: Date.now(), checkedBooks: 26, mismatchedCount: 25, mismatched: [recRow('甲', 24, 11), recRow('乙', 14, 7)], localHigherCount: 25, localLowerCount: 0 };
  const recLess = { checkedAt: Date.now(), checkedBooks: 3, mismatchedCount: 1, mismatched: [recRow('丙', 1, 3)], localHigherCount: 0, localLowerCount: 1 };
  const recMixed = { checkedAt: Date.now(), checkedBooks: 3, mismatchedCount: 2, mismatched: [recRow('甲', 2, 1), recRow('丙', 1, 3)], localHigherCount: 1, localLowerCount: 1 };
  // 明细按差值截断到 50 条、样本全是本地偏多，但全量里还有 5 本漏采——方向必须按全量数说
  const recTruncated = { checkedAt: Date.now(), checkedBooks: 70, mismatchedCount: 65, mismatched: Array.from({ length: 50 }, (_, i) => recRow(`偏多${i}`, 11, 1)), localHigherCount: 60, localLowerCount: 5 };
  const moreTxt = await mountSettingsWith(recMore);
  const lessTxt = await mountSettingsWith(recLess);
  const mixedTxt = await mountSettingsWith(recMixed);
  const truncTxt = await mountSettingsWith(recTruncated);
  const s6a = moreTxt.includes('25/26 本计数不一致（本地多于服务端：') && !moreTxt.includes('可能漏采');
  const s6b = lessTxt.includes('1/3 本计数不一致（可能漏采，点击详情排查）') && !lessTxt.includes('本地偏多') && !lessTxt.includes('本地多于服务端');
  const s6c = mixedTxt.includes('2/3 本计数不一致（1 本可能漏采、1 本本地偏多，点击详情排查）');
  const s6e = truncTxt.includes('65/70 本计数不一致（5 本可能漏采、60 本本地偏多，点击详情排查）') && !truncTxt.includes('本地多于服务端：');
  // 旧宿主（没有全量方向计数）：按明细样本判断；明细也没有 → 原文案
  const recMoreOld = { ...recMore, localHigherCount: undefined, localLowerCount: undefined };
  const s6f = W_.t.gatewayReconcileBad(26, 25, recMoreOld).includes('本地多于服务端') && W_.t.gatewayReconcileBad(26, 25, { checkedBooks: 26, mismatchedCount: 25 }) === '25/26 本计数不一致（可能漏采，点击详情排查）';
  // 另两份语言表：方向判断是同一份逻辑（简体测逻辑），这里钉住英 / 繁的句子确实接上了
  const enHigher = W_.T_EN.gatewayReconcileBad(26, 25, recMore);
  const enMixed = W_.T_EN.gatewayReconcileBad(70, 65, recTruncated);
  const enLower = W_.T_EN.gatewayReconcileBad(3, 1, recLess);
  const twHigher = W_.T_ZH_TW.gatewayReconcileBad(26, 25, recMore);
  const twLower = W_.T_ZH_TW.gatewayReconcileBad(3, 1, recLess);
  const s6g = enHigher.includes('local higher than server') && !enHigher.includes('possible missing notes')
    && enMixed.includes('possible missing notes in 5, local higher in 60')
    && enLower.includes('possible missing notes') && !enLower.includes('local higher')
    && twHigher.includes('本地多於服務端') && !twHigher.includes('可能漏採')
    && twLower.includes('可能漏採') && !twLower.includes('本地多於服務端');
  console.log('[对账提示 ①本地偏多]', s6a ? '✓ 25 本全是「本地 > 服务端」→ 不再提示「可能漏采」' : '✗ 仍提示漏采');
  console.log('[对账提示 ②少于/混合/旧宿主]', s6b && s6c && s6f ? '✓ 少于 → 漏采；混合 → 两类各说；旧宿主无计数 → 按明细 / 原文案' : `✗ 少于 ${s6b} 混合 ${s6c} 旧宿主 ${s6f}`);
  console.log('[对账提示 ③截断/多语言]', s6e && s6g ? '✓ 明细截断到 50 条后仍按全量数报「5 本漏采、60 本偏多」；英 / 繁句子接线正确' : `✗ 截断 ${s6e} 多语言 ${s6g}`);
  stateOverride = null; fetchHook = origHook;
  if (!(s1a && s1b && s1c && s2 && s3 && s3b && s4 && s5 && s6a && s6b && s6c && s6e && s6f && s6g)) { console.error('✗ Skill 升级 / 对账提示存在失败项'); process.exitCode = 1; }
} catch (e) { stateOverride = null; fetchHook = null; console.error('[Skill 升级检查崩溃]', e.stack.split('\n').slice(0, 8).join('\n')); process.exitCode = 1; }

console.log('DONE');
