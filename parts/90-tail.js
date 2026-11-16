    // ---------- 90-tail：App 壳 + 槽位注册 ----------
    W.CSS_90 = `
.wr-syncstrip{display:flex;align-items:center;gap:6px;padding:4px 14px;font-size:12px;color:var(--dsw-alias-label-secondary,#888);background:var(--dsw-alias-bg-inset,#f6f6f6);border-bottom:1px solid var(--dsw-alias-border-l1,#e5e5e5)}
.wr-syncstrip-err{color:var(--dsw-alias-danger,#d5453f);background:rgba(213,69,63,.06)}

.wr-crumb{display:flex;align-items:center;gap:8px;padding:0 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:10px;flex:none}
.wr-crumb-sep{margin:0 2px;opacity:.6}
.wr-icon{display:block}
.wr-favstar{position:absolute;top:10px;right:12px;cursor:pointer;font-size:18px;color:var(--dsw-alias-label-secondary)}
.wr-apiwarn{display:flex;align-items:center;gap:6px;flex:none;padding:4px 10px;margin-bottom:8px;border:1px solid var(--dsw-alias-border-l2);border-left:3px solid #d29922;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}
`;

    // B6: tab 组件 memo（App 轮询 setState 时活动 tab 不再整树重渲染）
    W.Bookshelf = W.React.memo(W.Bookshelf);
    W.BookDetail = W.React.memo(W.BookDetail);
    W.Insights = W.React.memo(W.Insights);
    W.Discover = W.React.memo(W.Discover);
    W.Roaming = W.React.memo(W.Roaming);
    W.Settings = W.React.memo(W.Settings);

    function WeReadIcon({ size = 20 }) {
      // span 捕获宿主渲染的 DOM 节点：selectPanel 服务级切换全失败时，兜底点击该容器切换面板
      return h('span', { ref: (el) => { W.__panelIconEl = el; }, style: { display: 'inline-flex' } },
        h('svg', {
          viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true,
          style: { display: 'block' },
        },
          h('path', { d: 'M12 10c8-3 16-3 20 2 4-5 12-5 20-2v38c-8-3-16-3-20 2-4-5-12-5-20-2z', fill: 'none', stroke: 'currentColor', 'stroke-width': 4, 'stroke-linejoin': 'round' }),
          h('line', { x1: 32, y1: 12, x2: 32, y2: 50, stroke: 'currentColor', 'stroke-width': 3 })));
    }

    // v1.4.2 常驻悬浮 App 阅读入口：面板右下角、可拖拽（位置持久化 localStorage）、
    // 点击 = App 窗口打开最近阅读的书（上次 open-reader 的 URL；无则书架最新书兜底）
    W.AppReaderDock = function AppReaderDock({ onToast }) {
      const { useState, useRef, useEffect } = W.hooks;
      const DOCK_KEY = 'wr:readerDockPos';
      const LAST_KEY = 'wr:lastReaderUrl';
      const [pos, setPos] = useState(null); // {left, top}；null=默认右下
      const [dragging, setDragging] = useState(false);
      const [loading, setLoading] = useState(false); // v1.7.1 打开阅读窗口进行中（icon 翻书动画）
      const btnRef = useRef(null);
      const dragState = useRef(null); // {startX, startY, moved, offsetLeft, offsetTop}

      useEffect(() => {
        try {
          const saved = JSON.parse(window.localStorage.getItem(DOCK_KEY) || 'null');
          if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            // v1.8.11：恢复位置必须 clamp 进当前面板——拖动后面板变窄/变矮时旧坐标落在可视区外，
            // 悬浮球「消失」再也点不到（真机实况）。rAF 等 layout 后夹紧。
            const applyClamp = () => { try { setPos(clampInto(saved.left, saved.top)); } catch { setPos(saved); } };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyClamp);
            else setTimeout(applyClamp, 0);
          }
        } catch { /* ignore */ }
      }, []);

      // v1.8.12：位置持续跟随容器——v1.8.11 只在恢复时夹一次，拖动后面板再变窄/变矮
      // 悬浮球照样出界「看不到」。父容器（wr-root）尺寸一变就把当前坐标重夹进可视区。
      useEffect(() => {
        const parent = btnRef.current?.parentElement;
        if (!parent) return undefined;
        const hasRaf = typeof requestAnimationFrame === 'function';
        let timer = 0; // rAF（不可用时退化为 setTimeout）id
        const reclamp = () => setPos((p) => {
          if (!p) return p; // 未拖动过：默认右下角 right/bottom 锚定，天然跟随容器
          const c = clampInto(p.left, p.top);
          return c.left === p.left && c.top === p.top ? p : c; // 无变化不触发重渲染
        });
        const schedule = () => {
          if (timer) return;
          timer = hasRaf ? requestAnimationFrame(() => { timer = 0; reclamp(); })
            : setTimeout(() => { timer = 0; reclamp(); }, 0);
        };
        let ro = null;
        try {
          if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(schedule); ro.observe(parent); }
        } catch { /* RO 不可用，仍有 resize 兜底 */ }
        window.addEventListener('resize', schedule);
        return () => {
          if (timer) (hasRaf && typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(timer);
          if (ro) { try { ro.disconnect(); } catch { /* ignore */ } }
          window.removeEventListener('resize', schedule);
        };
      }, []);

      const clampInto = (left, top) => {
        const parent = btnRef.current?.parentElement;
        if (!parent) return { left, top };
        return {
          left: Math.max(4, Math.min(left, parent.clientWidth - 55)),
          top: Math.max(4, Math.min(top, parent.clientHeight - 55)),
        };
      };

      const onPointerDown = (e) => {
        e.preventDefault();
        try { btnRef.current?.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        const rect = btnRef.current.getBoundingClientRect();
        const parentRect = btnRef.current.parentElement.getBoundingClientRect();
        dragState.current = {
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          offsetLeft: rect.left - parentRect.left,
          offsetTop: rect.top - parentRect.top,
        };
        setDragging(true);
      };
      const onPointerMove = (e) => {
        const st = dragState.current;
        if (!st) return;
        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;
        if (Math.abs(dx) + Math.abs(dy) > 4) st.moved = true;
        if (!st.moved) return;
        setPos(clampInto(st.offsetLeft + dx, st.offsetTop + dy));
      };
      const onPointerUp = (e) => {
        const st = dragState.current;
        dragState.current = null;
        setDragging(false);
        try { btnRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        if (!st) return;
        if (st.moved) {
          try { window.localStorage.setItem(DOCK_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
          return; // 拖动结束不算点击
        }
        // 点击：App 窗口打开最近阅读（进行中 icon 走翻书动画）
        (async () => {
          setLoading(true);
          try {
          let url = null;
          try { url = window.localStorage.getItem(LAST_KEY) || null; } catch { /* ignore */ }
          if (!url || !/^https:\/\/weread\.qq\.com\//.test(url)) {
            try {
              const shelf = await W.get('/api/bookshelf');
              const b = (shelf?.groups ?? []).flatMap((g) => g.books ?? []).find((x) => x.pcUrl);
              url = b?.pcUrl || null;
            } catch { /* ignore */ }
          }
          if (!url) url = 'https://weread.qq.com/'; // v1.4.3 无可开书时进首页（站内可跳转）
          try {
            const r = await W.post('/api/open-reader', { url });
            W.readerToast(r, onToast);
            try { window.localStorage.setItem(LAST_KEY, url); } catch { /* ignore */ }
          } catch (err) { onToast && onToast(err.message || String(err)); }
          } finally { setLoading(false); }
        })();
      };

      const style = pos ? { left: pos.left, top: pos.top } : { right: 16, bottom: 16 };
      // v1.9.4：尺寸 1.5×（34→51）；v1.9.5：静态与 loading 同一本 mini 书（静态=封面+书页+书脊，
      // loading=叠加三张错相翻页 leaf）——修复静态 icon（24px svg）与 loading 书（30px）大小不一致。
      // CSS 见 00-head 的 wr-flip* 系列（参照 flip-book-loading.html）。
      const flipLeaf = (cls) => h('div', { className: `wr-flipleaf ${cls}` },
        h('div', { className: 'wr-flipface front' }),
        h('div', { className: 'wr-flipface back' }));
      return h('button', {
        ref: btnRef,
        className: 'wr-readerdock' + (dragging ? ' wr-readerdock-drag' : '') + (loading ? ' wr-readerdock-loading' : ''),
        style,
        title: W.t.dockTip,
        onPointerDown,
        onPointerMove,
        onPointerUp,
      }, h('div', { className: 'wr-flipwrap' },
          h('div', { className: 'wr-flipcover' }),
          h('div', { className: 'wr-flippage l' }),
          h('div', { className: 'wr-flippage r' }),
          loading ? h('div', { className: 'wr-flipgroup' }, flipLeaf('f1'), flipLeaf('f2'), flipLeaf('f3')) : null,
          h('div', { className: 'wr-flipspine' })));
    };

    const APP_CSS = [W.BASE_CSS, W.CSS_10, W.CSS_20, W.CSS_30, W.CSS_40, W.CSS_50, W.CSS_55, W.CSS_60, W.CSS_90].filter(Boolean).join('\n');

    function App() {
      const [tab, setTab] = W.hooks.useState('bookshelf');
      // v1.0 i18n：language 配置变化时切换 W.t 并强制重渲染（效果挂在 state 声明之后）
      const [langTick, setLangTick] = W.hooks.useState(0);
      // 标题栏避让：收起侧边栏后窗口控制条（关闭/最小化/新建会话等）横贯面板顶部，
      // 面板无标题栏槽位，检测到自身顶边进入标题栏区（top<36）时自动下移到控制条之下。
      const shellRef = W.hooks.useRef(null);
      const [topInset, setTopInset] = W.hooks.useState(0);
      W.hooks.useEffect(() => {
        const el = shellRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const check = () => {
          try {
            const r = el.getBoundingClientRect();
            setTopInset(r.top < 36 ? 46 : 0);
          } catch (e) { /* ignore */ }
        };
        check();
        const ro = new ResizeObserver(check); // 侧栏开合改变面板宽度 → 复测
        ro.observe(el);
        window.addEventListener('resize', check);
        return () => { ro.disconnect(); window.removeEventListener('resize', check); };
      }, []);
      const [detailBookId, setDetailBookId] = W.hooks.useState(null);
      const [state, setState] = W.hooks.useState(null);
      // v1.0 i18n：language 配置变化时切换 W.t 字典并触发重渲染（langTick 供 lint 感知）
      const langTickRef = W.hooks.useRef(0);
      langTickRef.current = langTick; // eslint-disable-line
      // v1.2 三语映射：'zh-TW'→zh-TW；'zh-CN'/'zh'→zh；'auto'（v1.8.7 默认）→跟随 DSH 宿主语言；其余（含 'en' 与未知值）→en
      const langCfg = state?.config?.language;
      const lang = langCfg === 'auto' || !langCfg
        ? (W.detectHostLang ? W.detectHostLang() : 'zh')
        : langCfg === 'zh-TW' ? 'zh-TW'
          : (langCfg === 'zh-CN' || langCfg === 'zh') ? 'zh' : 'en';
      W.hooks.useEffect(() => {
        if (W.setLang && W.setLang(lang)) {
          setLangTick((t) => t + 1);
          try { W.__syncLocalePanelName?.(); } catch { /* locale 同步尽力而为 */ } // v1.8.8：插件名跨树联动
        }
      }, [lang]);
      const [stateError, setStateError] = W.hooks.useState(null);
      const [toastMsg, setToastMsg] = W.toast(); // 2.6s 自动消失（B10：此前裸 setter 永不消失）
      const onToast = setToastMsg;
      // v1.9.4 全局取消：同步条右端取消按钮的请求态（发出后禁用，终态/异常复位）
      const [cancelReq, setCancelReq] = W.hooks.useState(false);
      W.hooks.useEffect(() => {
        if (state?.syncState?.status && state.syncState.status !== 'syncing') setCancelReq(false);
      }, [state?.syncState?.status]);
      const cancelSyncGlobal = async () => {
        if (cancelReq) return;
        setCancelReq(true);
        try { await W.post('/api/sync/cancel'); onToast(W.t.syncCancelling); }
        catch (e) { onToast(e.message || W.t.syncFailed); setCancelReq(false); }
      };

      const lastStateJson = W.hooks.useRef('');
      const refreshState = W.hooks.useCallback(async () => {
        try {
          const next = await W.get('/state');
          const json = JSON.stringify(next);
          if (json !== lastStateJson.current) { lastStateJson.current = json; setState(next); }
          setStateError(null);
        } catch (e) { setStateError(e.message); }
      }, []);
      W.hooks.useEffect(() => { refreshState(); const id = setInterval(refreshState, 5000); return () => clearInterval(id); }, [refreshState]);
      W.hooks.useEffect(() => {
        const open = (e) => {
          W.__pendingDetail = null;
          setDetailBookId(e.detail?.bookId ?? null);
          setTab('bookshelf'); // 详情是书架子页（带「‹ 返回书架」路径条）
        };
        window.addEventListener('weread:open-detail', open);
        // 挂载时消费面板未打开期间暂存的跳转
        if (W.__pendingDetail) {
          const bookId = W.__pendingDetail;
          W.__pendingDetail = null;
          setDetailBookId(bookId);
          setTab('bookshelf');
        }
        const openRoaming = () => { setDetailBookId(null); setTab('roaming'); };
        const openSettings = () => { setDetailBookId(null); setTab('settings'); }; // v1.4.5：needAuth 引导跳设置页
        // v1.1.1：事件到达时书架多半未挂载（App 只渲染当前 tab，其监听器收不到），
        // 暂存待开弹层 + 目标 tab，书架挂载时消费（同 __pendingDetail 模式）；
        // detail.tab 可指定直达 tab（如设置页「绑定 API Key」→ 'apikey'）
        const openLogin = (e) => {
          setDetailBookId(null);
          W.__pendingLogin = true;
          W.__pendingLoginTab = e?.detail?.tab || null;
          setTab('bookshelf');
        };
        window.addEventListener('weread:open-roaming', openRoaming);
        window.addEventListener('weread:open-login', openLogin);
        window.addEventListener('weread:open-settings', openSettings);
        return () => {
          window.removeEventListener('weread:open-detail', open);
          window.removeEventListener('weread:open-roaming', openRoaming);
          window.removeEventListener('weread:open-login', openLogin);
          window.removeEventListener('weread:open-settings', openSettings);
        };
      }, []);

      const navigate = W.hooks.useCallback((target, params) => {
        if (target === 'detail') { setDetailBookId(params?.bookId ?? null); setTab('bookshelf'); }
        else setTab(target);
      }, []);

      const tabs = W.hooks.useMemo(() => ([
        ['bookshelf', W.t.bookshelf], ['insights', W.t.insights], ['discover', W.t.discoverTab], ['roaming', W.t.roaming], ['settings', W.t.settings],
      ]), [langTick]); // v1.2：语言切换（langTick）后 tabs 标签随 W.t 重算，否则切语言后 tab 仍停留旧文案
      // v1.3.2：发现 tab 仅官方通道（API Key）在场时显示——书城搜索/推荐无 cookie 通道接口
      const gatewayOn = !!state?.gateway?.enabled;
      const visibleTabs = tabs.filter(([id]) => id !== 'discover' || gatewayOn);
      const activeTab = tab === 'discover' && !gatewayOn ? 'bookshelf' : tab;

      const css = APP_CSS;

      return h('div', {
        className: 'wr-root',
        ref: shellRef,
        style: { paddingTop: topInset ? topInset : undefined, transition: 'padding-top .15s ease' },
      },
        h('style', null, css),
        state?.apiHealth?.ok === false && h('div', {
          className: 'wr-apiwarn',
          title: state.apiHealth.reason ? W.t.apiWarnTip(new Date(state.apiHealth.checkedAt).toLocaleString('zh-CN'), state.apiHealth.reason) : '',
        }, '⚠️ ', W.t.apiDegraded),
        h('div', { className: 'wr-tabs' },
          visibleTabs.map(([id, label]) => h('button', {
            key: id, className: `wr-tab${tab === id ? ' wr-tab-active' : ''}`,
            onClick: () => { if (id === 'bookshelf') setDetailBookId(null); setTab(id); },
          }, label))),
        // v1.2 全局同步状态条：Host 同步与 tab 无关，任何页签都可见进度/失败（修「切菜单丢同步感知」）
        // v1.9.4：右端常驻取消按钮（真机反馈：书架工具栏的取消切一级菜单即不可见）——
        // 本条跨 tab 全局渲染，取消能力随之全局化；已取消终态显示 15s 灰条（非红色错误）
        state?.syncState?.status === 'syncing' && h('div', { className: 'wr-syncstrip' },
          h('span', { className: 'wr-spin' }), ' ', W.t.syncing,
          state?.syncProgress?.currentBookName ? ` · ${state.syncProgress.currentBookName}` : '',
          state?.syncProgress?.percentage ? ` ${state.syncProgress.percentage}%` : '',
          h('button', {
            className: 'wr-btn wr-mini', style: { marginLeft: 'auto', flex: 'none' },
            disabled: cancelReq, title: W.t.syncCancelTip, onClick: cancelSyncGlobal,
          }, cancelReq ? W.t.syncCancellingBtn : W.t.syncCancel)),
        state?.syncState?.status === 'cancelled' && Date.now() - (state.syncState.lastSummary?.at || 0) < 15000
          && h('div', { className: 'wr-syncstrip', style: { opacity: .8 } }, '✓ ', W.t.syncCancelledToast),
        // v1.9.8/v1.9.9：失败横幅只对「已登录且非登录类失败」展示——
        // ① 未登录/登录过期时：同步失败是可预期结果，黄色过期提示条（带「重新登录」按钮）已完整引导，
        //    红色「同步失败：登录已过期」与之重复且制造焦虑（真机反馈 2026-11-13），不展示；
        // ② 登录已恢复（loggedIn）时：登录类失败（1.9.8 起的 syncState.loginExpired 标记，或文案
        //    兜底兼容旧记录）视为陈旧，不展示；
        // ③ 其余失败（已登录时的网络/接口错）照常展示至下一轮同步。
        state?.syncState?.status === 'failed' && !!state?.syncState?.error
          && !!state?.loggedIn
          && !(state?.syncState?.loginExpired || String(state.syncState.error).includes('登录已过期'))
          && h('div', {
            className: 'wr-syncstrip wr-syncstrip-err',
            title: state.syncState.error,
          }, '⚠️ ', W.t.syncFailed, '：', String(state.syncState.error).slice(0, 80)),
        h('div', { className: 'wr-body' },
          stateError && !state
            ? h('div', { className: 'wr-empty' }, `${W.t.loadFailed}：${stateError}`, h('button', { className: 'wr-btn', onClick: refreshState }, W.t.retry))
            : !state
              ? h('div', { className: 'wr-empty' }, h('span', { className: 'wr-spin' }), W.t.loading)
              : activeTab === 'bookshelf' && detailBookId
                ? h('div', { className: 'wr-root' },
                    h('style', null, W.CSS_90),
                    h('div', { className: 'wr-crumb' },
                      h('button', { className: 'wr-btn', onClick: () => setDetailBookId(null) }, '‹ ', W.t.backBookshelf),
                      h('span', { className: 'wr-muted' }, W.t.bookshelf, h('span', { className: 'wr-crumb-sep' }, ' / '), W.t.detail)),
                    h(W.BookDetail, { bookId: detailBookId, onToast, themes: state?.config?.exportThemes }))
                : activeTab === 'bookshelf' ? h(W.Bookshelf, { state, onNavigate: navigate, onToast, refreshState }) // P1-5：跟随 activeTab（原版 tab 与 activeTab 混用，发现页未绑 Key 时全链落空渲染成设置页）
                  : activeTab === 'insights' ? h(W.Insights, { onNavigate: navigate, onToast, loggedIn: !!state?.loggedIn, gatewayEnabled: !!state?.gateway?.enabled })
                    : activeTab === 'discover' ? h(W.Discover, { state, onToast, onNavigate: navigate })
                      : activeTab === 'roaming' ? h(W.Roaming, { onNavigate: navigate, onToast, themes: state?.config?.exportThemes, loggedIn: !!state?.loggedIn })
                        : h(W.Settings, { state, onToast, refreshState })),
        // v1.4.2 常驻悬浮 App 阅读入口（面板内右下角，可拖拽）
        h(W.AppReaderDock, { onToast }),
        toastMsg && h('div', { className: 'wr-toast' }, String(toastMsg)));
    }

    return {
      inject: ['slots', 'locale', 'inputTriggers'],
      apply(ctx) {
        try {
          const theme = ctx.get?.('theme');
          const snap = theme && typeof theme.getTheme === 'function' ? theme.getTheme() : null;
          if (snap && /dark/i.test(JSON.stringify(snap))) W.preferDarkExport = true;
        } catch (e) { /* theme 不可用 */ }
        try {
          const ws = ctx.get?.('uiWorkspace');
          if (ws && typeof ws.pickDirectory === 'function') {
            W.pickDirectory = async () => { try { return await ws.pickDirectory(); } catch { return null; } };
          }
        } catch { /* uiWorkspace 不可用，设置页回退手动输入 */ }
        try {
          // v1.2.2：同时注册嵌套 {panel:{title}} 与扁平 'panel.title' 两种形状——
          // v1.2.1 实测 locale.bind 的翻译查不到纯嵌套注册（miss 时返回键名本身 → 侧栏漏出字面 panel.title）；
          // 双形状兼容嵌套解析与扁平键查找两条路径
          const panelTitles = [
            ['zh', W.T_ZH.panel], ['zh-TW', W.T_ZH_TW.panel], ['en', 'WeRead'],
          ];
          for (const [lang, title] of panelTitles) {
            ctx.locale.register?.(NS, lang, { panel: { title }, 'panel.title': title });
          }
        } catch { /* locale 不可用时忽略 */ }
        // v1.8.8：插件名跨树联动——侧栏是宿主的 React 树，插件内部语言切换不会触发它重渲染。
        // 语言变化时把「当前插件语言的面板名」重写入宿主 locale 三语槽位（幂等覆盖）：
        // locale store 更新 → 宿主 locale 消费者重渲染 → 侧栏 label（惰性读 W.t.panel）拿到新名。
        W.__syncLocalePanelName = () => {
          try {
            const name = W.t && W.t.panel;
            if (!name || typeof name !== 'string') return;
            for (const lang of ['zh', 'zh-TW', 'en']) {
              ctx.locale.register?.(NS, lang, { panel: { title: name }, 'panel.title': name });
            }
          } catch { /* locale 不可用时忽略 */ }
          try { injectSidebarPanel(); } catch { /* 重注入尽力而为（slots 注册幂等键 weread） */ } // v1.8.9：双通道之二
        };
        try { W.__syncLocalePanelName(); } catch { /* 初始对齐（auto 模式 W.t 已按宿主语言初始化） */ }
        // v1.8.7：侧栏插件名跟随「插件界面语言」即时更新（用户报：切语言插件名不动）。
        // W.t.panel 每次调用实时读当前字典；locale.bind（宿主语言翻译）降级兜底。
        let localeT;
        try { localeT = ctx.locale.bind?.(NS); } catch { localeT = undefined; }
        // 宿主语言探测：用 locale.bind 对 panel.title 的翻译反推（三语注册值可区分 zh/zh-TW/en）
        W.detectHostLang = () => {
          try {
            const v = localeT ? localeT('panel.title') : undefined;
            if (v === 'WeRead') return 'en';
            if (v === '微信讀書') return 'zh-TW';
            return 'zh';
          } catch { return 'zh'; }
        };
        const sidebarLabel = () => {
          try {
            const v = W.t && W.t.panel;
            if (v) return v;
          } catch { /* 字典未就绪 */ }
          try {
            const v = localeT ? localeT('panel.title') : undefined;
            return v && v !== 'panel.title' ? v : '微信读书';
          } catch { return '微信读书'; }
        };
        ctx.slots.inject('main', function* () {
          yield ctx.slots.register({
            name: 'main', key: 'weread', locale: NS, order: 70,
          }, App);
        });
        // v1.8.9：侧栏项注册提为可重执行——语言切换时 dispose + 重注入，slots store 更新
        // 驱动宿主侧栏重渲染取新 label（locale 重注册路线在真机上不触发重绘，此为第二条通道）。
        let disposeSidebarSlot = null;
        const injectSidebarPanel = () => {
          try { if (typeof disposeSidebarSlot === 'function') disposeSidebarSlot(); } catch { /* ignore */ }
          disposeSidebarSlot = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist', id: 'weread', order: 70, locale: NS,
            label: sidebarLabel,
          }, WeReadIcon));
        };
        injectSidebarPanel();
        // DSH 深度集成（60-interop）
        // v1.0.4 面板切换：惰性解析——apply 时 layout 服务可能未就绪（一次性绑定会永久失效，
        // 症状：dock 点卡后详情已就位但面板不切换）。每次调用实时解析多个候选服务名，
        // 全部失败则点击我们注册的侧栏图标宿主容器（等价用户手动点侧栏，最可靠的兜底）。
        W.selectPanel = (id) => {
          const target = id ?? 'weread';
          for (const key of ['layout', 'workspace', 'uiLayout', 'panels']) {
            try {
              const svc = ctx.get?.(key);
              if (svc && typeof svc.selectPanel === 'function') return svc.selectPanel(target);
            } catch { /* 尝试下一个服务名 */ }
          }
          try {
            const el = W.__panelIconEl;
            const clickable = el && (el.closest('button,[role="button"],li,a') || el.parentElement);
            if (clickable && typeof clickable.click === 'function') { clickable.click(); return true; }
          } catch { /* ignore */ }
          return false;
        };
        // C13: 暗色探测（media query 优先，theme snapshot 兜底），每次调用实时
        let themeSnapshot = null;
        try { const theme = ctx.get?.('theme'); if (theme && typeof theme.getTheme === 'function') themeSnapshot = theme.getTheme(); } catch (e) { /* ignore */ }
        W.detectDark = () => {
          try { if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true; } catch (e) { /* ignore */ }
          try {
            if (themeSnapshot) {
              const s = JSON.stringify(themeSnapshot);
              if (/"appearance"\s*:\s*"dark"/i.test(s)) return true;
            }
          } catch (e) { /* ignore */ }
          return !!W.preferDarkExport;
        };
        // 跨组件导航：dock/侧栏胶囊 → 主面板书籍详情。
        // 面板未挂载时事件会先于监听器发出，故暂存待跳转，App 挂载后消费。
        W.__pendingDetail = null;
        W.openDetail = (bookId) => {
          if (!bookId) return;
          W.__pendingDetail = bookId;
          try { W.selectPanel?.('weread'); } catch (e) { /* ignore */ }
          try { window.dispatchEvent(new CustomEvent('weread:open-detail', { detail: { bookId } })); } catch (e) { /* ignore */ }
        };
        // 跨组件入口：dock 复习角标 → 漫游 tab（面板未挂载时事件先于监听器发出，重复 dispatch 幂等）
        W.openRoaming = () => {
          try { W.selectPanel?.('weread'); } catch (e) { /* ignore */ }
          try { window.dispatchEvent(new CustomEvent('weread:open-roaming')); } catch (e) { /* ignore */ }
        };
        ctx.slots.inject('tool.call.toolview', function* () {
          yield ctx.slots.register({ name: 'tool.call.toolview', key: 'weread' }, W.WereadToolView);
        });
        ctx.slots.inject('sidebar.footer.action', function* () {
          yield ctx.slots.register({
            name: 'sidebar.footer.action', id: 'weread-kpi', order: 50, label: () => W.t.panel,
          }, W.WereadFooterPill);
        });
        ctx.slots.inject('conversation.composer.dock', function* () {
          yield ctx.slots.register({
            name: 'conversation.composer.dock', id: 'weread-roaming', order: 30, label: () => W.t.roamingTitle,
          }, W.WereadRoamingDock);
        });
        ['weread-sync', 'weread-roaming', 'weread-report'].forEach((cmdName) => {
          ctx.slots.inject('conversation.chat.commandview', function* () {
            yield ctx.slots.register({ name: 'conversation.chat.commandview', key: cmdName }, W.WereadCommandView);
          });
        });
        ctx.slots.inject('plugins.row.config', function* () {
          yield ctx.slots.register({
            name: 'plugins.row.config', key: '@local/dsh-weread#weread', label: () => W.t.rowConfig,
          }, W.WereadRowConfig);
        });
        // §11-1 对话输入框 @ 选书：注册 inputTriggers 源（防御式：服务缺失/形状不符静默跳过）
        // v1.8.2 双门禁修正：①package.json dsh.client.inject 声明 input-trigger 包（服务进 fiber）
        // ②本模块 inject 数组补 'inputTriggers' 服务名（ctx.get 门禁）——缺一 ctx.get 都拿 undefined。
        // 触发方式（用户需求）：@微信读书 / @weread 前缀才出本组（不打扰官方 @ 文件/对话候选），
        // 前缀后可跟书名关键词过滤；提及格式 @《书名》——模型凭书名调 weread 工具取笔记。
        let wrDiagAt = 0;
        const wrDiag = (msg, throttleMs = 0) => {
          if (throttleMs && Date.now() - wrDiagAt < throttleMs) return;
          wrDiagAt = Date.now();
          // P2-35：W.post 恒返 Promise，同步 try/catch 捕不到 rejection——改挂 .catch
          W.post('/api/client-diag', { msg }).catch(() => { /* ignore */ });
        };
        try {
          const triggers = ctx.get?.('inputTriggers');
          if (!triggers || typeof triggers.registerSource !== 'function') {
            wrDiag(`@选书：inputTriggers 服务不可用（${triggers ? '形状不符' : 'get 返回空，检查双 inject 门禁'}）`);
          } else {
            const bookCache = new Map(); // title → bookId（openReference 反查用）
            // P2-29：反查缓存加简单上限——超 500 整清（可重建的派生数据，宁可重查不膨胀）
            const bookCacheSet = (title, bookId) => {
              if (bookCache.size > 500) bookCache.clear();
              bookCache.set(title, bookId);
            };
            const findBookId = async (title) => {
              if (bookCache.has(title)) return bookCache.get(title);
              try {
                const s = await W.get(`/api/bookshelf?query=${encodeURIComponent(title)}`);
                const books = (s?.groups ?? []).flatMap((g) => g?.books ?? []);
                for (const b of books) if (b.title === title) { bookCacheSet(title, b.bookId); return b.bookId; }
              } catch (e) { /* ignore */ }
              return null;
            };
            // P2-29：候选查询 250ms 防抖 + 同词 in-flight 复用（原版每次键入直打 /api/bookshelf）
            let wrCandTimer = 0;
            let wrCandInflight = null;
            let wrCandLastQ = null;
            const disposeSource = triggers.registerSource({
              trigger: '@',
              name: 'weread-book',
              showGroupTitle: false,
              async candidates(_session, { query, signal }) {
                if (signal?.aborted) return [];
                const raw = String(query ?? '').trim();
                // 前缀门控：仅 @微信读书 / @weread（后跟空格或结尾）时进入本组
                const mm = /^(微信读书|weread)(\s+|$)/i.exec(raw);
                if (!mm) return [];
                const q = raw.slice(mm[0].length).trim();
                // P2-29：防抖合并连击键入；同词 in-flight 复用避免并发重复请求
                return new Promise((resolve) => {
                  if (wrCandTimer) clearTimeout(wrCandTimer);
                  wrCandTimer = setTimeout(async () => {
                    wrCandTimer = 0;
                    if (signal?.aborted) return resolve([]);
                    if (wrCandInflight && wrCandLastQ === q) return resolve(await wrCandInflight); // 同词复用 in-flight
                    wrCandLastQ = q;
                    wrCandInflight = (async () => {
                      try {
                        const s = await W.get(`/api/bookshelf?query=${encodeURIComponent(q)}`);
                        const books = (s?.groups ?? []).flatMap((g) => g?.books ?? []).slice(0, 8);
                        if (books.length) wrDiag(`@选书：命中 ${books.length} 本（query="${q}"）`, 30_000);
                        return books.map((b) => {
                          bookCacheSet(b.title, b.bookId);
                          return {
                            name: b.title, // v1.8.3 修正：菜单渲染对 item.name 无守卫解引用（缺字段即 React 崩整菜单）
                            label: b.title,
                            value: JSON.stringify({ kind: 'weread-book', bookId: b.bookId, title: b.title, mention: `@《${b.title}》` }),
                            section: W.t.panel,
                          };
                        });
                      } catch (e) { return []; }
                      finally { wrCandInflight = null; }
                    })();
                    resolve(await wrCandInflight);
                  }, 250);
                });
              },
              onPick({ candidate }) {
                let v = null; try { v = JSON.parse(candidate.value); } catch (e) { /* ignore */ }
                if (!v || v.kind !== 'weread-book') return undefined;
                return { insert: {
                  source: 'weread-book',
                  ref: v.mention,
                  label: v.title,
                  appearance: 'file',
                  clipboardText: v.mention,
                } };
              },
              async openReference(_session, { ref }) {
                const mm = /^@《(.+)》$/.exec(String(ref ?? ''));
                if (!mm) return false;
                const bookId = await findBookId(mm[1]);
                if (bookId) { W.openDetail(bookId); return true; }
                try { W.selectPanel?.('weread'); } catch (e) { /* ignore */ }
                return true;
              },
              codec: {
                clipboardText: (ref) => String(ref ?? ''),
                serialize: (ref) => Promise.resolve(String(ref ?? '')),
              },
            });
            wrDiag('@选书：inputTriggers 源已注册（@微信读书 / @weread 前缀触发）');
            if (typeof disposeSource === 'function') {
              try { ctx.effect?.(() => disposeSource); } catch (e) { /* effect 不可用则随页面生命周期 */ }
            }
          }
        } catch (e) { wrDiag(`@选书：注册异常 ${e?.message || e}`); }
      },
    };
  },
});
