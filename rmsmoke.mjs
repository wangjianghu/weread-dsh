/* 漫游组件渲染冒烟：迷你 hooks + createElement，直接执行各组件渲染路径捕获崩溃。 */
import fs from 'node:fs';
import vm from 'node:vm';

let code = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');
code = code.replace('return {\n      inject:', 'window.__W = W; return {\n      inject:');

let hookStates = [];
let hookIdx = 0;
const resetHooks = () => { hookStates = []; hookIdx = 0; };
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(9) });
const React = {
  createElement,
  useState: (init) => { const i = hookIdx++; const s = hookStates[i] ?? { v: typeof init === 'function' ? init() : init }; hookStates[i] = s; return [s.v, (nv) => { s.v = typeof nv === 'function' ? nv(s.v) : nv; }]; },
  useEffect: () => { },
  useRef: (init) => { const i = hookIdx++; if (!hookStates[i]) hookStates[i] = { current: init }; return hookStates[i]; },
  useCallback: (fn) => fn, memo: (C) => C,
  useMemo: (fn) => { const i = hookIdx++; if (!('m' in (hookStates[i] ?? {}))) hookStates[i] = { m: fn() }; return hookStates[i].m; },
};

let W = null;
const sandbox = {
  window: {},
  document: {
    createElement: () => ({ click() { }, set href(v) { }, set download(v) { } }),
    addEventListener() { }, removeEventListener() { }, body: { appendChild() { }, removeChild() { } },
  },
  fetch: async () => { throw new Error('no fetch in smoke'); },
  URLSearchParams, URL,
  setInterval: () => 0, clearInterval: () => { }, setTimeout: () => 0, clearTimeout: () => { },
  console,
};
sandbox.window.__ModuleLoader__ = { load(mod) { const moduleRequire = (name) => (name === 'react' ? React : (() => { throw new Error('unexpected require ' + name); })); const factory = mod.factory; const returns = factory(moduleRequire); sandbox.__returns = returns; W = sandbox.__W; } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
W = sandbox.window.__W;
if (!W) throw new Error('W 未定义（作用域访问失败）');

const render = (label, comp, props) => {
  resetHooks();
  try { const out = comp(props); if (!out || typeof out !== 'object') { console.error(`  ✗ ${label} 返回非对象: ${typeof out} ${String(out)}`); process.exitCode = 1; return; } let n = 0; const walk = (node) => { if (!node || typeof node !== 'object') return; n++; for (const c of node.children ?? []) walk(c); }; walk(out); console.log(`  ✓ ${label} 渲染成功（${n} 节点）`); }
  catch (e) { console.error(`  ✗ ${label} 崩溃：${e.stack?.split('\n').slice(0, 4).join('\n')}`); process.exitCode = 1; }
};

// 带文案断言的渲染：mustInclude 中的每个子串必须出现在渲染树文本（children 字符串 + title 提示）中
const renderWithText = (label, comp, props, mustInclude) => {
  resetHooks();
  try {
    const out = comp(props);
    if (!out || typeof out !== 'object') { console.error(`  ✗ ${label} 返回非对象`); process.exitCode = 1; return; }
    let n = 0; const texts = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      n++;
      if (typeof node.props?.title === 'string') texts.push(node.props.title);
      if (typeof node.props?.label === 'string') texts.push(node.props.label); // v1.2.3：状态 chip 经 props.label 传文案
      if (typeof node.props?.tip === 'string') texts.push(node.props.tip); // v1.2.4：状态说明经 props.tip（组件未执行时收集）
      for (const c of node.children ?? []) {
        if (typeof c === 'string') texts.push(c);
        else if (c && typeof c === 'object') walk(c);
      }
    };
    walk(out);
    const all = texts.join(' ');
    const missing = (mustInclude || []).filter((s) => !all.includes(s));
    if (missing.length) { console.error(`  ✗ ${label} 缺少文案：${missing.join('、')}`); process.exitCode = 1; }
    else console.log(`  ✓ ${label} 渲染成功（${n} 节点，文案齐全）`);
  } catch (e) { console.error(`  ✗ ${label} 崩溃：${e.message}`); process.exitCode = 1; }
};

// 空会话
render('Roaming 空会话', W.Roaming, { onNavigate: () => { }, onToast: () => { } });
// 有卡片的会话（模拟后端响应结构）
const session = {
  card: { noteKey: 'k1', bookId: 'b1', bookTitle: '测试书', author: '作者', noteType: 'highlight', text: '一段正文', createTime: 1730000000, meta: { favorite: true, reviewCount: 2 } },
  index: 1, total: 3, poolSize: 10, statsPoolSize: 20,
  metrics: { reviewed: 1, openedSource: 0, skipped: 0 },
  filter: { noteTypes: null, favoriteOnly: false, minDaysUnreviewed: 7 },
  stats: { todayReviewed: 1, sessionViewed: 3, favorites: 2, openedSource: 0, skipped: 1, recentDailyReviews: [{ date: '2026-11-05', label: '11/5', count: 2 }] },
};
const RoamingWith = W.Roaming;
render('Roaming 有卡片', RoamingWith, { onNavigate: () => { }, onToast: () => { }, __session: session });
// v1.0.1：普通漫游也常驻 记得/忘记（SM-2 评分不依赖复习模式）
renderWithText('Roaming 普通模式（记得/忘记常驻）', W.Roaming, { onNavigate: () => { }, onToast: () => { }, __session: { ...session } }, ['记得', '忘记', 'Space']);
renderWithText('Roaming 有到期卡（入口按钮）', W.Roaming, { onNavigate: () => { }, onToast: () => { }, __session: { ...session, dueCount: 3 } }, ['今日复习', '3 张']);
renderWithText('Roaming 复习模式（忘记/记得）', W.Roaming, { onNavigate: () => { }, onToast: () => { }, __session: { ...session, reviewMode: true, dueRemaining: 2 } }, ['复习模式', '忘记', '记得', '结束复习']);
// v1.0.1：设置页语言/周目标行存在（曾因 GUI 旧 bundle 被误报缺失，补断言防回归）
renderWithText('Settings（语言/周目标/AI 集成）', W.Settings, {
  state: { config: { language: 'zh-CN', weeklyGoalNotes: 0 }, accounts: [], validation: {} },
  onToast: () => {}, refreshState: async () => {},
}, ['界面语言', 'English', '周目标', 'AI 集成', '登录 / 重新登录']);
// v1.1：设置页官方通道区（绑定态 + 对账行）与登录弹层三 tab
renderWithText('Settings（官方通道绑定态+对账）', W.Settings, {
  state: {
    config: { language: 'zh-CN' }, accounts: [], validation: {},
    gateway: { enabled: true, keyTail: 'abcd', skillVersion: '1.0.5', upgrade: null },
    syncState: { reconcile: { checkedAt: Date.now(), checkedBooks: 12, mismatchedCount: 1, mismatched: [{ title: '差异书', expected: 5, local: 3 }] } },
  },
  onToast: () => {}, refreshState: async () => {},
}, ['官方通道（API Key）', 'abcd', '连通性测试', '同步对账', '本计数不一致']);
renderWithText('Settings（官方通道未绑定引导）', W.Settings, {
  state: { config: {}, accounts: [], validation: {}, gateway: { enabled: false } },
  onToast: () => {}, refreshState: async () => {},
}, ['官方通道（API Key）', '绑定 API Key']);
// v1.9.0 B2：账号卡「Cookie 上次续命」行（时间 + 来源，登录健康度可见）
renderWithText('Settings（Cookie 上次续命·窗口回流）', W.Settings, {
  state: {
    config: { language: 'zh-CN' }, accounts: [], validation: {},
    loginChannels: { cookie: { present: true, valid: true, expired: false, origin: { at: Date.now() - 3 * 3600_000, source: 'window', skeyTail: 'AbC123' } } },
  },
  onToast: () => {}, refreshState: async () => {},
}, ['当前账号 Cookie 上次续命：3 小时前', '阅读窗口回流']);
renderWithText('Settings（Cookie 上次续命·自动续命）', W.Settings, {
  state: {
    config: { language: 'zh-CN' }, accounts: [], validation: {},
    loginChannels: { cookie: { present: true, valid: true, expired: false, origin: { at: Date.now() - 5 * 60_000, source: 'head-refresh', skeyTail: 'XyZ987' } } },
  },
  onToast: () => {}, refreshState: async () => {},
}, ['当前账号 Cookie 上次续命：5 分钟前', '自动续命']);
renderWithText('LoginModal（三通道 tab）', W.LoginModal, { onClose: () => {}, onDone: () => {}, loggedIn: true },
  ['扫码登录', '粘贴 Cookie 登录', 'API Key（官方）']);
// v1.2.3：通道状态条——v1.2.4 起 label 只留「圆点+名称」，状态说明进 hover(title)
renderWithText('LoginModal（通道状态：Key 有效 + Cookie 过期）', W.LoginModal, {
  onClose: () => {}, onDone: () => {}, loggedIn: true, initialTab: 'apikey',
  gateway: { enabled: true, keyTail: 'PgAA', skillVersion: '1.0.5' },
  channels: {
    cookie: { present: true, valid: false, expired: true },
    apiKey: { bound: true, keyTail: 'PgAA', valid: true },
    lastCheckAt: Date.now(),
  },
}, ['API Key（官方）', '扫码登录', '粘贴 Cookie 登录', '已绑定 ····PgAA（有效）', 'Cookie 已过期']);
renderWithText('LoginModal（通道状态：全部未配置）', W.LoginModal, {
  onClose: () => {}, onDone: () => {}, loggedIn: false, initialTab: 'apikey',
  channels: { cookie: { present: false, valid: false, expired: false }, apiKey: { bound: false, keyTail: '', valid: false }, lastCheckAt: 0 },
}, ['未配置']);
renderWithText('ApiKeyLogin（绑定提示+入口）', W.ApiKeyLogin, { onDone: () => {}, loggedIn: true },
  ['此 Key 将绑定到当前账号', '打开官网获取 Key', '提交']);
renderWithText('ApiKeyLogin（未登录独立账号）', W.ApiKeyLogin, { onDone: () => {}, loggedIn: false },
  ['官方通道', '提交']);
// 其余组件也顺带冒烟
render('Bookshelf', W.Bookshelf, { state: { loggedIn: false, account: { id: null }, accounts: [], config: {}, syncState: null, validation: {}, booksCount: 0 }, onNavigate: () => { }, onToast: () => { } });
// v1.2.4：账号下拉菜单（登录账号 / 退出账号入口；初始收起——用 acctMenuOpen 模拟挂载后菜单不存在）
renderWithText('Bookshelf（账号下拉：入口按钮）', W.Bookshelf, { state: { loggedIn: true, account: { id: '1', name: '测试' }, accounts: [{ id: '1', name: '测试', active: true }], config: {}, syncState: null, validation: {}, booksCount: 1 }, onNavigate: () => { }, onToast: () => { } }, ['测试', '▾']);
renderWithText('Bookshelf 登录已过期横幅', W.Bookshelf, { state: { loggedIn: false, loginExpired: true, account: { id: '1', name: '测试' }, accounts: [{ id: '1', name: '测试', active: true }], config: {}, syncState: null, validation: {}, booksCount: 1 }, onNavigate: () => { }, onToast: () => { } }, ['登录已过期', '重新登录']);
render('Settings(卡片设置)', W.Settings, { state: { config: { uiRoamingScrollMode: 'paged', uiRoamingFontSize: 12, uiRoamingScrollSpeed: 48 }, accounts: [], validation: {} }, onToast: () => {}, refreshState: async () => {} });
render('BookDetail', W.BookDetail, { bookId: 'x', onToast: () => { } });
render('Insights', W.Insights, { onNavigate: () => { }, onToast: () => { } });
render('Settings', W.Settings, { state: { config: {}, accounts: [], validation: {} }, onToast: () => { }, refreshState: async () => { } });
// ---- v1.3 发现页（Discover）+ 官方阅读统计区（OfficialStats，挂于 Insights 顶部） ----
// rmsmoke 的 walker 不执行嵌套函数组件，故官方统计区直接渲染组件本体；
// 「Insights 顶部挂载」用结构断言（树中出现 type === W.OfficialStats 的元素）。
renderWithText('Discover 搜索态（结果+翻页+推荐注入）', W.Discover, {
  state: { gateway: { enabled: true }, config: {}, accounts: [], validation: {} }, onToast: () => {}, onNavigate: () => {},
  __search: {
    hasMore: true,
    results: [{ title: '电子书', scopeCount: 2, books: [
      { searchIdx: 1, bookInfo: { bookId: 'b1', title: '搜索测试书', author: '作者甲', intro: '一段简介文字', category: '科技', readerLink: 'https://weread.qq.com/web/reader/b1', deepLink: 'weread://book/b1' }, newRating: 87, newRatingCount: 1200, readingCount: 345 },
      { searchIdx: 2, bookInfo: { bookId: 'b2', title: '听书测试', author: '作者乙' }, newRating: 0, readingCount: 12 },
    ] }],
  },
  __recommend: { books: [{ bookId: 'r1', title: '推荐书', author: '推荐作者', reason: '基于你的阅读偏好', newRating: 90 }] },
}, ['搜索测试书', '作者甲', '8.7', '345 人在读', '科技', '一段简介文字', '打开阅读', '详情', '下一页', '找书', '听书', '为你推荐', '换一批', '推荐书', '推荐理由']);
renderWithText('Discover 未绑定引导', W.Discover, {
  state: { gateway: { enabled: false }, config: {}, accounts: [], validation: {} }, onToast: () => {},
}, ['绑定 API Key', '个性化推荐']);
renderWithText('Discover 绑定空态（未搜索 + 推荐空）', W.Discover, {
  state: { gateway: { enabled: true }, config: {}, accounts: [], validation: {} }, onToast: () => {}, __recommend: { books: [] },
}, ['搜书名/作者/关键词', '搜索', '暂无数据']);
renderWithText('Insights 官方统计区（绑定态渲染）', W.OfficialStats, {
  gatewayEnabled: true,
  __stats: {
    mode: 'weekly', totalReadTime: 3720, readDays: 4, dayAverageReadTime: 930, compare: 0.152,
    readLongest: [{ book: { bookId: 'lb1', title: '读得最多的书' }, readTime: 1800 }],
    preferCategory: [{ categoryTitle: '计算机', readingTime: 2000, readingCount: 6 }],
  },
}, ['官方阅读统计', '本周', '本月', '总时长', '1小时2分', '有效天数', '4 天', '环比', '15.2%', '读得最多', '读得最多的书', '30分', '偏好分类', '计算机', '6 本']);
renderWithText('Insights 官方统计区（未绑定引导）', W.OfficialStats, { gatewayEnabled: false },
  ['官方阅读统计', '绑定 API Key', '在此查看官方阅读统计']);
try {
  resetHooks();
  const insTree = W.Insights({ onNavigate: () => {}, onToast: () => {}, gatewayEnabled: true, __stats: { totalReadTime: 60, readDays: 1, dayAverageReadTime: 60, compare: 0, readLongest: [], preferCategory: [] } });
  let mounted = false;
  const walkType = (node) => { if (!node || typeof node !== 'object') return; if (node.type === W.OfficialStats) mounted = true; for (const c of node.children ?? []) if (c && typeof c === 'object') walkType(c); };
  walkType(insTree);
  if (!mounted) throw new Error('Insights 渲染树中未挂载 OfficialStats');
  console.log('  ✓ Insights 顶部挂载官方统计区（结构断言）');
} catch (e) { console.error('  ✗ Insights 官方统计区挂载：', e.message); process.exitCode = 1; }
try { const v = W.WereadToolView({ call: { name: 'weread', arguments: { action: 'status' }, result: '登录态：未登录' } }); if (!v || typeof v !== 'object') { console.error('  ✗ ToolView 返回非对象'); process.exitCode = 1; } else console.log('  ✓ ToolView 组件渲染'); } catch (e) { console.error('  ✗ ToolView 崩溃', e.message); process.exitCode = 1; }
(globalThis).__noop=0;
try { const v = W.WereadToolView({ call: { name: 'weread', arguments: { action: 'status' }, result: '登录态：未登录' } }); console.log('  ✓ ToolView 有卡片渲染'); } catch (e) { console.error('  ✗ ToolView 崩溃', e.message); process.exitCode = 1; }
for (const mode of ['marquee', 'paged']) {
  try { W.ScrollText({ text: '《测试书》 长文本滚动测试'.repeat(20), mode }); console.log(`  ✓ ScrollText(${mode}) 渲染`); } catch (e) { console.error(`  ✗ ScrollText(${mode}) 崩溃`, e.message); process.exitCode = 1; }
}
// v1.2 i18n：三语字典键齐全（T_EN/T_ZH_TW 与 T_ZH 键一致）+ 三语切换往返 + 回退链
try {
  const zhKeys = Object.keys(W.T_ZH);
  if (zhKeys.length < 300) throw new Error('T_ZH 键数异常偏少：' + zhKeys.length);
  for (const [name, dict] of [['T_EN', W.T_EN], ['T_ZH_TW', W.T_ZH_TW]]) {
    const missing = zhKeys.filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !(k in W.T_ZH));
    if (missing.length || extra.length) throw new Error(`${name} 键不齐：缺 ${missing.join(',') || '无'}；多 ${extra.join(',') || '无'}`);
  }
  if (W.setLang('en') !== true) throw new Error('setLang(en) 未报告变更');
  if (W.t.bookshelf !== 'Books' || W.t.settings !== 'Settings' || W.t.apiDegraded !== 'WeRead API unreachable — showing local data (login & sync paused)') throw new Error('en 字典未生效：' + W.t.bookshelf);
  if (W.setLang('zh-TW') !== true) throw new Error('setLang(zh-TW) 未报告变更');
  if (W.t.settings !== '設定' || W.t.bookshelf !== '書架' || W.t.sync !== '同步筆記' || W.t.langZhTW !== '繁體中文') throw new Error('zh-TW 字典未生效：' + W.t.settings);
  if (W.setLang('zh') !== true || W.t.bookshelf !== '书架' || W.t.settings !== '设置') throw new Error('zh 恢复失败');
  if (W.setLang('zh') !== false) throw new Error('重复切换应返回 false');
  if (W.lang !== 'zh') throw new Error('W.lang 未记录当前语言');
  // 回退链：zh-TW 缺键 → 回 zh（简体）；两边皆无 → 键名
  const savedTw = W.T_ZH_TW.weeklyGoal; delete W.T_ZH_TW.weeklyGoal;
  W.setLang('en'); W.setLang('zh-TW');
  if (W.t.weeklyGoal !== W.T_ZH.weeklyGoal) throw new Error('zh-TW 缺键未回退 zh：' + W.t.weeklyGoal);
  W.T_ZH_TW.weeklyGoal = savedTw;
  if (W.t.__no_such_key__ !== '__no_such_key__') throw new Error('缺键未回退键名');
  W.setLang('zh');
  console.log('  ✓ i18n 三语切换往返 + 字典键齐全 + 回退链');
} catch (e) { console.error('  ✗ i18n', e.message); process.exitCode = 1; }
// v1.2 深层文案抽查：此前硬编码的洞察/漫游/设置深层文案在 en / zh-TW 下已翻译
try {
  W.setLang('en');
  renderWithText('Insights(en 深层文案)', W.Insights, { onNavigate: () => {}, onToast: () => {} }, ['Loading reading insights']);
  renderWithText('Roaming(en 深层文案)', W.Roaming, { onNavigate: () => {}, onToast: () => {} }, ['Loading roaming cards']);
  renderWithText('Settings(en 深层文案)', W.Settings, { state: { config: { language: 'en' }, accounts: [], validation: {} }, onToast: () => {}, refreshState: async () => {} }, ['Duplicate file cleanup', 'Data & uninstall']);
  W.setLang('zh-TW');
  renderWithText('Insights(zh-TW 深层文案)', W.Insights, { onNavigate: () => {}, onToast: () => {} }, ['正在載入閱讀洞察資料']);
  renderWithText('Roaming(zh-TW 深层文案)', W.Roaming, { onNavigate: () => {}, onToast: () => {} }, ['正在載入漫遊卡片']);
  renderWithText('Settings(zh-TW 深层文案)', W.Settings, { state: { config: { language: 'zh-TW' }, accounts: [], validation: {} }, onToast: () => {}, refreshState: async () => {} }, ['重複檔案清理', '資料與解除安裝']);
  W.setLang('zh');
  console.log('  ✓ 深层文案 en/zh-TW 抽查（洞察/漫游/设置各一）');
} catch (e) { console.error('  ✗ 深层文案抽查', e.message); process.exitCode = 1; }

// v1.8.6 设置页布局结构守卫：容器自适应双栏表单/粘性保存条/分组小标题/开关两端对齐行（防结构回归）
try {
  resetHooks();
  const outS = W.Settings({ state: { config: {}, accounts: [], validation: {} }, onToast: () => {}, refreshState: async () => {} });
  const clsSet = new Set();
  const walkCls = (n) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.props?.className === 'string') n.props.className.split(/\s+/).forEach((c) => clsSet.add(c));
    for (const c of n.children ?? []) walkCls(c);
  };
  walkCls(outS);
  for (const c of ['wr-set-card--form', 'wr-set-form-cols', 'wr-save-bar', 'wr-set-subtitle', 'wr-set-row--toggle']) {
    if (!clsSet.has(c)) { console.error(`  ✗ 设置页结构缺类 ${c}`); process.exitCode = 1; }
    else console.log(`  ✓ 设置页结构类 ${c} 在场`);
  }
  // v1.8.12 模块 title 独占一行守卫：所有 wr-set-title 只允许「图标 + 空白 + 标题文字」三子，
  // 动作按钮/状态徽标一律不得混入标题行（账号管理/官方通道等已移到下方独立行）
  let titleRows = 0;
  const walkTitle = (n) => {
    if (!n || typeof n !== 'object') return;
    const cn = typeof n.props?.className === 'string' ? n.props.className.split(/\s+/) : [];
    if (cn.includes('wr-set-title')) {
      titleRows += 1;
      const kids = (n.children ?? []).filter((k) => k !== null && k !== false && k !== undefined);
      const ok = kids.length === 3 && typeof kids[0] === 'object' && kids[0]?.type === 'svg'
        && kids.slice(1).every((k) => typeof k === 'string');
      if (!ok) { console.error(`  ✗ 设置页标题行混入非标题内容（children=${JSON.stringify(kids.map((k) => (typeof k === 'object' ? `<${k.type}>` : k)))}）`); process.exitCode = 1; }
    }
    for (const c of n.children ?? []) walkTitle(c);
  };
  walkTitle(outS);
  if (titleRows < 7) { console.error(`  ✗ 设置页标题行数异常：${titleRows}（预期 ≥7 张卡片）`); process.exitCode = 1; }
  else console.log(`  ✓ 设置页 ${titleRows} 个模块 title 全部独占一行`);
  // v1.8.14 嵌套守卫：日志卡收尾曾多一个右括号，把数据与卸载卡+脚注挤出 grid 变全宽出血
  // （真机截图裁切 1068px 宽实况）。grid 必须含全部 7 卡+版本脚注，wr-body 只含 grid。
  const findByCls = (n, cls) => {
    if (!n || typeof n !== 'object') return [];
    let hits = [];
    if (typeof n.props?.className === 'string' && n.props.className.split(/\s+/).includes(cls)) hits.push(n);
    for (const c of n.children ?? []) hits = hits.concat(findByCls(c, cls));
    return hits;
  };
  const grids = findByCls(outS, 'wr-set-grid');
  const bodies = findByCls(outS, 'wr-body');
  const gKids = grids[0]?.children?.filter((k) => k && typeof k === 'object').length ?? -1;
  const bKids = bodies[0]?.children?.filter((k) => k && typeof k === 'object').length ?? -1;
  if (gKids !== 8 || bKids !== 1) {
    console.error(`  ✗ 设置页嵌套破坏：grid 子元素=${gKids}（期望 8）body 子元素=${bKids}（期望 1）——卡片被挤出网格会全宽出血`);
    process.exitCode = 1;
  } else console.log('  ✓ 设置页嵌套完整（grid 8 子 / body 1 子，无卡片出血）');
} catch (e) { console.error('  ✗ 设置页结构守卫崩溃', e.message); process.exitCode = 1; }

// v1.9.4 静态守卫：悬浮 icon 1.5×/翻书 loading 结构 + 全局同步条取消按钮接线
try {
  const dockSrc = String(W.AppReaderDock);
  const clientSrc = code; // vm 执行的同一份 client 源
  const checks = [
    // v1.9.5：静态与 loading 同一本 mini 书（不再用 svg icon）——同大要求
    [dockSrc.includes('wr-flipwrap') && dockSrc.includes("flipLeaf('f3')") && dockSrc.includes('loading ?') && !dockSrc.includes('W.I.weread(24)'), '悬浮入口静态/加载同一本 mini 书（同大；loading 叠加翻页 leaf）'],
    [/parent\.clientWidth - 55/.test(dockSrc), '悬浮球 clamp 边距随 51px 尺寸适配'],
    [clientSrc.includes('/api/sync/cancel') && clientSrc.includes('syncCancelTip'), '全局同步条右端取消按钮（跨一级菜单）'],
    [clientSrc.includes("status === 'cancelled'") && clientSrc.includes('wr-syncstrip'), '已取消终态 15s 灰条（非红色错误）'],
    // v1.9.9：失败横幅仅限「已登录且非登录类失败」；过期不自动弹登录窗（仅首用无书引导）
    [clientSrc.includes('!!state?.loggedIn') && clientSrc.includes('state?.syncState?.loginExpired') && clientSrc.includes("String(state.syncState.error).includes('登录已过期')"), '失败横幅仅限已登录且非登录类失败（未登录/过期走黄色提示条）'],
    [clientSrc.includes('!st.loginExpired && st.booksCount === 0'), '登录过期不再自动弹登录窗（仅首用无书保留引导）'],
  ];  for (const [cond, msg] of checks) {
    if (cond) console.log(`  ✓ ${msg}`);
    else { console.error(`  ✗ 缺失：${msg}`); process.exitCode = 1; }
  }
} catch (e) { console.error('  ✗ v1.9.4 静态守卫崩溃', e.message); process.exitCode = 1; }
console.log('done');
