    // ---------- 60-interop：DSH 深度集成 ----------
    // A1 weread 工具卡（tool.call.toolview，防御式取值）
    // D1 侧栏脚注阅读 KPI ｜ D2 composer.dock 漫游小卡 ｜ D3 插件行内配置页
    // 注意：这些组件渲染在主面板之外（消息区/侧栏/插件页），主面板 <style> 不生效，
    // 因此每个组件自带 <style>，CSS_60 必须自包含（含 .wr-btn）。
    W.CSS_60 = `
.wr-btn{padding:1px 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;line-height:1.3;flex:none}
.wr-btn:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.wr-ix-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 6px;border-radius:8px}
.wr-ix-pill:hover{color:var(--dsw-alias-brand-primary)}
.wr-ix-dockwrap{flex:0 1 520px;min-width:0;max-width:520px;width:100%}
.wr-ix-dock{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);padding:0;min-width:0;width:100%}
.wr-ix-mq{flex:1;min-width:0;max-width:100%;overflow:hidden;white-space:nowrap;display:block;cursor:pointer}
.wr-ix-mq-inner{display:inline-block;white-space:nowrap;max-width:none;will-change:transform}
.wr-ix-mq-run{animation-name:wr-mq-once-a;animation-timing-function:linear;animation-fill-mode:forwards}
.wr-ix-mq-run.alt{animation-name:wr-mq-once-b}
.wr-ix-mq:hover .wr-ix-mq-run{animation-play-state:paused}
@keyframes wr-mq-once-a{from{transform:translateX(0)}to{transform:translateX(var(--wr-shift,-100px))}}
@keyframes wr-mq-once-b{from{transform:translateX(0)}to{transform:translateX(var(--wr-shift,-100px))}}
.wr-ix-page{display:block;overflow:hidden;white-space:nowrap;animation:wr-fade .3s ease}
@keyframes wr-fade{from{opacity:.2}to{opacity:1}}
.wr-ix-tool{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;font-size:12px;max-width:420px}
.wr-ix-due{border-color:#3fb950;color:#3fb950;flex:none}
.wr-ix-tool pre{margin:4px 0 0;white-space:pre-wrap;max-height:180px;overflow:auto;color:var(--dsw-alias-label-secondary);font-size:11px}
.wr-card{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.wr-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;max-width:100%;font-family:inherit}
.wr-chip:hover{border-color:var(--dsh-alias-brand-primary,var(--dsw-alias-brand-primary));color:var(--dsh-alias-brand-primary,var(--dsw-alias-brand-primary))}
.wr-chip img{width:18px;height:24px;object-fit:cover;border-radius:2px;flex:none}
.wr-chip small{color:var(--dsw-alias-label-secondary);font-size:11px}
.wr-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
`;

    // UI 开关缓存（/api/state config，60s）
    W.__uiFlagsCache = { at: 0, flags: { kpi: true, dock: true, scrollMode: 'marquee', fontSize: 12, scrollSpeed: 48, rotateEnabled: true, rotateSec: 30 } };
    W.getUiFlags = async function getUiFlags() {
      if (Date.now() - W.__uiFlagsCache.at < 60_000) return W.__uiFlagsCache.flags;
      try {
        const s = await W.get('/state');
        const flags = {
          kpi: s?.config?.uiSidebarKpi !== false,
          dock: s?.config?.uiComposerRoaming !== false,
          scrollMode: s?.config?.uiRoamingScrollMode || 'marquee',
          fontSize: Math.min(16, Math.max(10, Number(s?.config?.uiRoamingFontSize) || 12)),
          scrollSpeed: Math.min(100, Math.max(20, Number(s?.config?.uiRoamingScrollSpeed) || 48)),
          rotateEnabled: s?.config?.uiRoamingRotateEnabled !== false,
          rotateSec: Math.min(1800, Math.max(30, Number(s?.config?.uiRoamingRotateSec) || 30)),
        };
        W.__uiFlagsCache = { at: Date.now(), flags };
        return flags;
      } catch { return W.__uiFlagsCache.flags; }
    };
    W.invalidateUiFlags = () => { W.__uiFlagsCache.at = 0; };

    // 滚动文本：mode=marquee 匀速单程循环（滚完从头再来，hover 暂停）；
    // mode=paged 逐行轮播（按容器宽度切行，每行静止显示 holdMs 后切下一行，循环）。
    W.ScrollText = function ScrollText({ text, mode = 'marquee', speed = 24, holdMs = 10_000, onClick } = {}) {
      const { useRef, useState, useEffect } = W.React;
      const hoverRef = useRef(false); // C8: paged 模式悬停也暂停（与 marquee 一致）
      const boxRef = useRef(null);
      const innerRef = useRef(null);
      const [shift, setShift] = useState(0);
      const [boxW, setBoxW] = useState(null);   // paged：锁定显示宽度，不随行内容变化
      const [lines, setLines] = useState(null); // paged 模式：切好的行
      const [lineIndex, setLineIndex] = useState(0);
      const [tick, setTick] = useState(0); // 跑马灯单程结束后重启代次（交替 animation-name 触发重放）
      const holdTimerRef = useRef(0); // P2-34：marquee 末尾停顿 timer 句柄（卸载/重挂时清理，防 setState-after-unmount）

      useEffect(() => {
        const measure = () => {
          const box = boxRef.current; const inner = innerRef.current;
          if (!box || !inner) return;
          const overflow = Math.max(0, inner.scrollWidth - box.clientWidth + 8);
          setShift(overflow);
          if (box.clientWidth > 0) setBoxW(box.clientWidth);
          if (mode === 'paged' && overflow > 0) {
            // 以实际渲染的平均字宽切行（中文等宽场景精确）
            const avg = inner.scrollWidth / Math.max(1, text.length);
            const per = Math.max(6, Math.floor(box.clientWidth / Math.max(1, avg)) - 1);
            const chunks = [];
            for (let i = 0; i < text.length; i += per) chunks.push(text.slice(i, i + per));
            setLines(chunks);
            setLineIndex(0);
          } else if (mode === 'paged') {
            setLines(null);
          }
        };
        measure();
        const t1 = setTimeout(measure, 400);
        const t2 = setTimeout(measure, 1200);
        let raf = 0;
        const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); }; // rAF 节流
        window.addEventListener('resize', onResize);
        return () => {
          clearTimeout(t1); clearTimeout(t2); cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
          if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = 0; } // P2-34：清掉在途停顿 timer
        };
      }, [text, mode]);

      useEffect(() => {
        if (mode !== 'paged' || !lines || lines.length <= 1) return undefined;
        const id = setInterval(() => {
          if (hoverRef.current) return; // 悬停阅读中不切行
          setLineIndex((i) => (i + 1) % lines.length);
        }, Math.max(1000, holdMs));
        return () => clearInterval(id);
      }, [mode, lines && lines.length, lines && lines[0], holdMs]); // C8: 内容未变不重启节奏

      const vSpeed = Math.min(100, Math.max(8, Number(speed) || 48)); // px/s
      const duration = shift > 0 ? Math.max(3, shift / vSpeed) : 0;

      // paged 且确实超宽：逐行轮播
      if (mode === 'paged' && lines && lines.length > 1) {
        return h('div', {
          className: 'wr-ix-mq', ref: boxRef, onClick,
          onMouseEnter: () => { hoverRef.current = true; },
          onMouseLeave: () => { hoverRef.current = false; },
          style: boxW ? { width: `${boxW}px` } : undefined, // 固定显示宽度
        },
          h('span', { className: 'wr-ix-page', key: lineIndex, ref: innerRef }, lines[lineIndex] || ''));
      }
      // marquee：超宽匀速单程 → 停 1.5s → 从头重放；不超宽静止
      return h('div', {
        className: 'wr-ix-mq', ref: boxRef, onClick,
        onMouseEnter: () => { hoverRef.current = true; },
        onMouseLeave: () => { hoverRef.current = false; },
      },
        h('span', {
          className: 'wr-ix-mq-inner' + (shift > 0 ? ' wr-ix-mq-run' + (tick % 2 ? ' alt' : '') : ''),
          style: shift > 0 ? { animationDuration: `${duration}s`, '--wr-shift': `-${shift}px` } : undefined,
          ref: innerRef,
          onAnimationEnd: (e) => {
            if (mode !== 'marquee' || shift <= 0) return;
            if (e && e.target !== e.currentTarget) return;
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current); // P2-34：防重复触发叠加 timer
            holdTimerRef.current = setTimeout(() => { holdTimerRef.current = 0; setTick((t) => t + 1); }, 2500); // 末尾停 2.5 秒再从头
          },
        }, text));
    };

    // A1: weread 工具调用卡片（props 形状防御式探测，取不到时返回 null 不渲染）
    // §11-2 富渲染：host 在文本首行附 <!--wr-card:JSON--> 结构化标记——这里解析成可点卡片
    // （书 chip 点击进面板详情；封面小图；KPI 行），标记后的原文仍以折叠 pre 保留。
    W.WereadToolView = function WereadToolView(props) {
      try {
        const p = props ?? {};
        const call = p.call ?? p.toolCall ?? p.entry?.call ?? p.node?.call ?? p;
        const name = call?.name ?? p.name ?? '';
        if (name && name !== 'weread') return null;
        const args = call?.arguments ?? call?.args ?? call?.input ?? p.args ?? {};
        const result = call?.result ?? p.result ?? p.output ?? null;
        let text = typeof result === 'string' ? result
          : result?.text ?? result?.content ?? result?.value ?? (result ? JSON.stringify(result) : '');
        const action = String(args.action ?? '');
        let card = null;
        const mm = /^<!--wr-card:(.*?)-->/.exec(String(text));
        if (mm) {
          try { card = JSON.parse(mm[1].replace(/- -/g, '--')); } catch (e) { card = null; }
          text = String(text).slice(mm[0].length).trim();
        }
        if (!action && !text) return null;
        const chip = (b, extra) => h('button', {
          key: (b.id || '') + (b.t || ''), className: 'wr-chip', title: `打开《${b.t}》笔记详情`,
          onClick: () => { try { W.openDetail ? W.openDetail(b.id) : W.selectPanel?.('weread'); } catch (e) { /* ignore */ } },
        },
          b.c ? h('img', { src: b.c, alt: '', onError: (e) => { try { e.target.style.display = 'none'; } catch (er) { /* ignore */ } } }) : null,
          h('span', null, b.t || ''),
          extra || h('small', null, [b.p != null ? ` ${b.p}%` : '', b.h != null ? ` · 划线${b.h}` : '', b.n != null ? ` · ${b.n}条` : ''].filter(Boolean).join('') || ''));
        let cards = null;
        if (card && card.kind === 'books' && card.books?.length) cards = card.books.map((b) => chip(b));
        else if (card && card.kind === 'search' && card.hits?.length) cards = card.hits.map((b) => chip({ t: b.t, id: b.id }, b.ch ? h('small', null, `${b.ch} · ${(b.x || '').slice(0, 24)}…`) : null));
        else if (card && card.kind === 'notes' && card.book) cards = [chip(card.book)];
        else if (card && card.kind === 'roaming' && card.card) cards = [chip({ t: card.card.t, id: card.card.id }, h('small', null, `漫游 ${card.card.i}/${card.card.n} · ${(card.card.x || '').slice(0, 20)}…`))];
        else if (card && card.kind === 'insights' && card.k) cards = [h('span', { className: 'wr-chip', style: { cursor: 'default' } }, `📈 活跃 ${card.k.a} 天 · 连续 ${card.k.s} 天 · 笔记 ${card.k.t} 条`)];
        return h('div', null,
          h('style', null, W.CSS_60),
          h('div', { className: 'wr-ix-tool' },
            h('div', { style: { fontWeight: 600 } }, W.I.book(12), ' 微信读书 · ', action || '结果'),
            cards && cards.length ? h('div', { className: 'wr-card' }, cards) : null,
            text && h('pre', null, String(text).slice(0, 1200))));
      } catch { return null; }
    };
    // P2-32（对抗审查 v2）：槽位组件包 memo（与 10-bookshelf 的 React.memo 用法一致），
    // 消息流重渲时非 weread 的 toolview/commandview 不再全量重跑探测逻辑
    W.WereadToolView = W.React.memo(W.WereadToolView);

    // D1: 侧栏脚注 KPI（近 30 天：活跃天数/笔记条数）。30 分钟兜底缓存；
    // v1.7.19 同步完成后立即失效重取（原版挂载后 30 分钟内不刷新，用户刚同步完看到的还是旧数）
    let wrIxKpiCache = { at: 0, text: '' };
    const wrIxKpiRefreshers = new Set();
    W.invalidateKpiPill = () => {
      wrIxKpiCache = { at: 0, text: wrIxKpiCache.text }; // 旧值先留着展示，取到新值再替换（不闪空）
      for (const fn of [...wrIxKpiRefreshers]) { try { fn(); } catch (e) { /* ignore */ } }
    };
    W.WereadFooterPill = function WereadFooterPill() {
      const [text, setText] = W.hooks.useState(wrIxKpiCache.text);
      const [enabled, setEnabled] = W.hooks.useState(true);
      W.hooks.useEffect(() => {
        let alive = true;
        const refresh = () => {
          if (!alive || Date.now() - wrIxKpiCache.at < 3000) return; // 失效风暴去抖
          (async () => {
            try {
              const d = await W.get('/insights?days=30');
              if (!alive) return;
              const k = d.kpis ?? {};
              const t = `${k.activeDays ?? 0}天/${k.totalNotes ?? 0}条`;
              wrIxKpiCache = { at: Date.now(), text: t };
              setText(t);
            } catch { /* 无数据静默 */ }
          })();
        };
        (async () => {
          const flags = await W.getUiFlags();
          if (!alive) return;
          setEnabled(flags.kpi);
          if (!flags.kpi) return;
          if (Date.now() - wrIxKpiCache.at >= 30 * 60_000) refresh();
        })();
        wrIxKpiRefreshers.add(refresh); // v1.7.19：同步完成后被 W.invalidateKpiPill() 唤醒
        const offBus = W.onBus ? W.onBus((m) => { // §11-6：调度自动同步经 WS 广播也即时刷新
          if (m?.type === 'sync' && (m.payload?.phase === 'done' || m.payload?.phase === 'started')) refresh();
        }) : null;
        return () => { alive = false; wrIxKpiRefreshers.delete(refresh); if (offBus) offBus(); };
      }, []);
      if (!enabled || !text) return null;
      return h('span', null,
        h('style', null, W.CSS_60),
        h('span', {
          className: 'wr-ix-pill', title: '近 30 天阅读 KPI：活跃 X 天 / 笔记 N 条（同步后即时更新，点击打开微信读书）',
          onClick: () => { try { W.selectPanel?.('weread'); } catch { /* ignore */ } },
        }, W.I.book(11), ' ', text));
    };

    // D2: composer.dock 漫游小卡（10px；单行；跑马灯/逐行轮播可配；自带样式；高度压缩不挤宿主状态区）
    W.WereadRoamingDock = function WereadRoamingDock() {
      const [card, setCard] = W.hooks.useState(null);
      const [dueCount, setDueCount] = W.hooks.useState(0);
      const [enabled, setEnabled] = W.hooks.useState(true);
      const [scrollMode, setScrollMode] = W.hooks.useState('marquee');
      const [fontSize, setFontSize] = W.hooks.useState(12);
      const [scrollSpeed, setScrollSpeed] = W.hooks.useState(48);
      const [rotate, setRotate] = W.hooks.useState({ enabled: true, sec: 30 });
      const hoverRef = W.hooks.useRef(false);
      // B9: dock 用独立随机卡端点，不推进漫游面板的服务端会话（避免 ←/→ 回放错乱）
      const load = W.hooks.useCallback(async () => {
        try {
          const s = await W.get('/api/roaming/card');
          setCard(s?.card ?? null);
          setDueCount(Number(s?.dueCount) || 0);
        } catch { /* 静默保留旧卡 */ }
      }, []);
      W.hooks.useEffect(() => {
        let alive = true;
        (async () => {
          const flags = await W.getUiFlags();
          if (!alive) return;
          setEnabled(flags.dock);
          setScrollMode(flags.scrollMode || 'marquee');
          setFontSize(flags.fontSize || 12);
          setScrollSpeed(flags.scrollSpeed || 48);
          setRotate({ enabled: flags.rotateEnabled !== false, sec: flags.rotateSec || 30 });
          if (flags.dock) load();
        })();
        return () => { alive = false; };
      }, [load]);
      // 随机轮播：每条显示 rotate.sec 秒后换下一条（悬停时跳过本次，手动换卡重置计时）
      // 注意：必须位于早退 return 之前，保证 Hook 顺序稳定
      W.hooks.useEffect(() => {
        if (!rotate.enabled || !card) return undefined;
        const id = setInterval(() => {
          if (hoverRef.current) return; // 悬停阅读中不切换
          load();
        }, Math.max(30, rotate.sec) * 1000);
        return () => clearInterval(id);
      }, [rotate.enabled, rotate.sec, card && card.noteKey, load]);
      // §11-6：面板/命令/MCP 触发的漫游动作经 WS 广播 → dock 即时换卡（悬停阅读中不打扰）
      W.hooks.useEffect(() => {
        const off = W.onBus ? W.onBus((m) => { if (m?.type === 'roaming' && !hoverRef.current) load(); }) : null;
        return () => { if (off) off(); };
      }, [load]);

      if (!enabled || !card) return null;
      const quote = `《${card.bookTitle || '微信读书'}》 ${(card.text || '').replace(/\s+/g, ' ').trim()}`;
      return h('div', {
        className: 'wr-ix-dockwrap',
        onMouseEnter: () => { hoverRef.current = true; },
        onMouseLeave: () => { hoverRef.current = false; },
      },
        h('style', null, W.CSS_60),
        h('div', { className: 'wr-ix-dock', style: { fontSize: `${fontSize}px` }, title: '笔记漫游 · 点击文字打开面板，悬停暂停滚动' },
          h(W.ScrollText, {
            text: quote, mode: scrollMode, speed: scrollSpeed,
            onClick: () => { if (W.openDetail) W.openDetail(card.bookId); else { try { W.selectPanel?.('weread'); } catch (e) { /* ignore */ } } },
          }),
          dueCount > 0 && h('button', {
            className: 'wr-btn wr-ix-due', title: `今日有 ${dueCount} 张到期复习卡，点击开始今日复习`,
            onClick: (e) => {
              e.stopPropagation();
              try { W.openRoaming?.(); } catch { try { W.selectPanel?.('weread'); } catch { /* ignore */ } }
            },
          }, '🎯 复习 ' + dueCount),
          h('button', {
            className: 'wr-btn', title: '换一张',
            onClick: (e) => { e.stopPropagation(); load(); },
          }, W.I.refresh(11))));
    };

    // 斜杠命令富卡片（conversation.chat.commandview，防御式：形状不符返回 null）
    // v1.7.7：槽位实参是 { node: 命令对象 }（kind:'command'，结果在 outcome.text）。
    // 旧版取 p.node.command 永远取不到 → 富卡片从不渲染，退化为不显眼的通用细行。
    W.WereadCommandView = function WereadCommandView(props) {
      try {
        const p = props ?? {};
        let cmd = p.command ?? p.entry?.command;
        if (!cmd && p.node && typeof p.node === 'object') cmd = p.node.command ?? (p.node.kind === 'command' ? p.node : undefined);
        if (!cmd) cmd = p;
        const name = String(cmd?.name ?? p.name ?? '');
        if (!/^weread-(sync|roaming|report)$/.test(name)) return null;
        const args = String(cmd?.args ?? cmd?.rawInput ?? p.args ?? '').trim();
        const outcome = cmd?.outcome ?? null;
        const text = String(outcome?.text ?? cmd?.text ?? cmd?.result ?? p.text ?? '');
        const failed = outcome?.kind === 'error';
        const label = { 'weread-sync': '同步笔记', 'weread-roaming': '笔记漫游', 'weread-report': '洞察月报' }[name];
        // 显式内联样式兜底：不依赖 CSS_60 也能在会话流里醒目可见
        const cardStyle = {
          margin: '6px 0', padding: '10px 12px', borderRadius: 10,
          border: `1px solid ${failed ? 'rgba(220,60,60,.45)' : 'rgba(120,150,235,.35)'}`,
          borderLeft: `3px solid ${failed ? 'rgba(220,60,60,.8)' : 'rgba(90,130,230,.85)'}`,
          background: failed ? 'rgba(220,60,60,.06)' : 'rgba(120,150,235,.07)',
        };
        const preStyle = {
          margin: '6px 0 0', padding: 0, fontFamily: 'inherit', fontSize: '12.5px', lineHeight: 1.65,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'inherit',
        };
        // v1.7.8：路径可点击——先让 doc-reader 面板接管（preventDefault 即接管），
        // 无接管则回退网关 open-file（系统默认应用打开，宿主限输出目录内）。
        const pathLinkStyle = {
          color: 'var(--dsw-alias-accent, #4c7cf5)', textDecoration: 'underline',
          textDecorationStyle: 'dotted', cursor: 'pointer', wordBreak: 'break-all',
        };
        const PATH_RE = /(\/(?:Users|private|tmp|var|opt|home)\/[^\s，。;；)）」』"'`《》]+)/g;
        const openFilePath = (file) => {
          let handled = false;
          try {
            handled = window.dispatchEvent(new CustomEvent('dsh:open-in-reader', { detail: { path: file }, cancelable: true })) === false;
          } catch { handled = false; }
          if (!handled) void W.post('/api/open-file', { path: file }).catch(() => {});
        };
        const renderTextWithPaths = (txt) => {
          const parts = String(txt).split(PATH_RE);
          return parts.map((seg, i) => (i % 2 === 1
            ? h('span', { key: i, style: pathLinkStyle, title: `打开 ${seg}`, onClick: () => openFilePath(seg) }, seg)
            : seg));
        };
        return h('div', null,
          h('style', null, W.CSS_60),
          h('div', { style: cardStyle },
            h('div', { style: { fontWeight: 600, fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 6 } },
              W.I.book(12), ` 微信读书 · ${label}`,
              args ? h('span', { className: 'wr-muted' }, ` ${args}`) : null,
              failed ? h('span', { style: { color: 'rgba(220,60,60,.9)', fontWeight: 600 } }, ' · 失败') : null),
            text && h('pre', { style: preStyle }, renderTextWithPaths(text.slice(0, 1200)))));
      } catch { return null; }
    };
    W.WereadCommandView = W.React.memo(W.WereadCommandView); // P2-32：同 WereadToolView

    // D3: 插件管理页行内配置（自取 state，复用 W.Settings；保存后刷新 UI 开关缓存）
    W.WereadRowConfig = function WereadRowConfig() {
      const { useState, useEffect } = W.React;
      const [state, setState] = useState(null);
      const [err, setErr] = useState('');
      useEffect(() => {
        let alive = true;
        W.get('/api/state').then((s) => { if (alive) setState(s); }).catch((e) => { if (alive) setErr(e.message || String(e)); });
        return () => { alive = false; };
      }, []);
      if (err) return h('div', null, h('style', null, W.CSS_60), h('div', { className: 'wr-muted' }, '配置加载失败：', err));
      if (!state) return h('div', null, h('style', null, W.CSS_60), h('div', { className: 'wr-muted' }, '加载中…'));
      return h(W.Settings, {
        state,
        onToast: () => { W.invalidateUiFlags(); },
        refreshState: async () => { W.invalidateUiFlags(); },
      });
    };
