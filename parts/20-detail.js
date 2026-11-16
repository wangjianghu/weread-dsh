/**
 * 微信读书 DSH 插件 — 20-detail
 * 书籍详情：左侧章节导航（去重+计数徽章+滚动联动高亮）、右侧头部卡+按章节分组笔记卡。
 * 复刻 analysis-02 §3.7 / analysis-03 §5.2。
 */

W.CSS_20 = `
.wr-arrow{display:inline-block;width:12px;color:var(--dsw-alias-label-secondary);font-size:11px;transition:transform .12s}
.wr-arrow-open{transform:rotate(90deg)}
.wr-detailwrap{flex:1;min-height:0;height:auto}
.wr-detail{display:flex;flex:1;min-height:0}
.wr-chapnav{width:220px;flex:none;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1);padding:12px 8px}
.wr-chapnav-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 8px 8px;display:flex;align-items:center}
.wr-chap-item{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.wr-chap-item:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wr-chap-active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600}
.wr-chap-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-chap-badge{flex:none}
.wr-detailmain{flex:1;min-width:0;overflow:auto;padding:16px 20px}
.wr-bookhead{display:flex;gap:16px;margin-bottom:16px}
.wr-cover{width:96px;height:128px;object-fit:cover;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);flex:none}
.wr-bookinfo{display:flex;flex-direction:column;gap:4px;min-width:0}
.wr-booktitle{font-size:18px;font-weight:600}
.wr-bookmeta{color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;gap:12px;flex-wrap:wrap}
.wr-sec-head{display:flex;align-items:center;gap:6px;padding:8px 4px;cursor:pointer;user-select:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.wr-sec-head:hover{color:var(--dsw-alias-brand-primary)}
.wr-sec-count{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400}
.wr-note{position:relative;border-left:3px solid var(--dsw-alias-border-l2);border-radius:0 8px 8px 0;background:var(--dsw-alias-bg-layer-2);padding:10px 12px;margin:0 0 8px 8px}
.wr-note-active{border-left-color:var(--dsw-alias-brand-primary)}
.wr-quote{margin:0;padding:0 0 0 8px;border-left:2px solid var(--dsw-alias-brand-primary);font-style:italic;font-size:13px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
.wr-thought{font-size:12px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;margin-top:6px}
.wr-notetime{text-align:right;color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:6px}
.wr-note-sel{cursor:pointer;border-left-color:var(--dsw-alias-brand-primary)}
.wr-note-sel-on{outline:1.5px solid var(--dsw-alias-brand-primary)}
/* v1.3.3 多选标记：竖线左侧 10px 间距的圆形勾选框（14px）——选中=品牌色底+白✓，未选=灰描边空心；
   不进文档流（零位移）、不遮正文。空间：卡片 margin-left 8px + 容器 padding 20px = 28px 足够容纳 */
.wr-selmark{display:none;position:absolute;left:-24px;top:50%;transform:translateY(-50%);width:14px;height:14px;border-radius:50%;border:1.5px solid var(--dsw-alias-label-secondary,#aaa);background:transparent;transition:transform .1s}
.wr-selmark:hover{transform:translateY(-50%) scale(1.15)}
.wr-note-sel .wr-selmark{display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;color:transparent}
.wr-note-sel-on .wr-selmark{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.wr-selfbar{position:sticky;bottom:8px;margin-top:12px;display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:12px}
`;

(() => {
  const h = W.h;

  // v1.4 可复用导图弹窗：与漫游导出弹窗同构同款（布局/交互/文案键全部复用），供详情页逐条笔记导出
  W.NoteExportModal = function NoteExportModal({ card, themes, onClose, onToast }) {
    const { useState, useMemo } = W.hooks;
    const list = (Array.isArray(themes) && themes.length ? themes : W.RM_THEMES_DEFAULT);
    const [themeId, setThemeId] = useState(() => (W.detectDark?.() ? 'dark' : 'white'));
    const [timeType, setTimeType] = useState('create');
    const theme = useMemo(() => list.find((t) => t.id === themeId) || list[0], [list, themeId]);
    const previewUrl = useMemo(() => (card ? W.rmGenerateExportDataUrl(card, theme, timeType) : ''), [card, theme, timeType]);
    const doExport = () => {
      if (!previewUrl) { onToast && onToast(W.t.previewFailedToast); return; }
      const dp = W.rmFmtExportDateParts(timeType === 'share' ? Date.now() : card.createTime);
      const safeTitle = String(card.bookTitle || W.t.typeNote).trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || W.t.typeNote;
      const a = document.createElement('a');
      a.href = previewUrl;
      a.download = W.t.exportFileName(safeTitle, dp.isoDate);
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      onToast && onToast(W.t.exportingImage);
      onClose?.();
    };
    const copyImage = async () => {
      if (!previewUrl) return false;
      try {
        const blob = await (await fetch(previewUrl)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      } catch { return false; }
    };
    return h('div', { className: 'wr-modal-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
      h('div', { className: 'wr-modal', style: { maxWidth: 700 } },
        h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 12 } }, W.t.exportModalTitle),
        h('div', { className: 'wr-rm-export' },
          h('div', { className: 'wr-rm-preview' }, previewUrl ? h('img', { src: previewUrl, alt: W.t.previewWord }) : h('div', { className: 'wr-muted' }, W.t.previewFailed)),
          h('div', { className: 'wr-rm-setting' },
            h('div', null, W.t.timeCreate, ' / ', W.t.timeShare),
            h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
              h('input', { type: 'radio', name: 'wrDetailExportTime', checked: timeType === 'create', onChange: () => setTimeType('create') }), W.t.timeCreate),
            h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
              h('input', { type: 'radio', name: 'wrDetailExportTime', checked: timeType === 'share', onChange: () => setTimeType('share') }), W.t.timeShare),
            h('div', { style: { marginTop: 4 } }, W.t.exportThemes),
            h('div', { className: 'wr-rm-themes' }, list.map((t) => h('div', {
              key: t.id, className: 'wr-rm-swatch' + (t.id === theme.id ? ' wr-rm-swatch-on' : ''),
              style: { background: t.bg, boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)' },
              title: W.T_ZH['theme_' + t.id] || t.name, onClick: () => setThemeId(t.id),
            }))),
            h('div', { style: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10 } },
              h('button', { className: 'wr-btn wr-btn-primary', onClick: doExport, disabled: !previewUrl }, W.t.confirm),
              h('button', {
                className: 'wr-btn', disabled: !previewUrl || !navigator.clipboard || typeof ClipboardItem === 'undefined',
                title: W.t.copyImageTip,
                onClick: async () => { onToast && onToast((await copyImage()) ? W.t.imageCopied : W.t.imageCopyFailed); },
              }, W.t.copyImageBtn),
              h('button', { className: 'wr-btn', onClick: () => onClose?.() }, W.t.cancel))))));
  };

  W.BookDetail = function BookDetail({ bookId, onToast, themes }) {
    const { useState, useEffect, useMemo, useRef, useCallback } = W.hooks;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [active, setActive] = useState(null); // 章节索引
    const [collapsed, setCollapsed] = useState({});
    const [refreshing, setRefreshing] = useState(false);
    // v1.0 摘录多选：selMode 开启后点笔记卡切换选中，底部浮条复制带出处的引用块
    const [selMode, setSelMode] = useState(false);
    const [sel, setSel] = useState(() => new Set());
    const scrollRef = useRef(null);
    const secRefs = useRef({});

    const load = useCallback(async () => {
      setLoading(true); setError(null);
      try {
        const r = await W.get('/api/book/' + encodeURIComponent(bookId));
        setData(r);
        setActive(null);
        setCollapsed({});
      } catch (e) { setError(e.message || String(e)); }
      setLoading(false);
    }, [bookId]);

    useEffect(() => { load(); }, [load]);

    // v1.3 官方数据（Key 在场）：精确进度卡 + 全书热门划线（软失败）
    const [gwState, setGwState] = useState({ progress: null, best: null });
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const s = await W.get('/api/state');
          if (!s?.gateway?.enabled || cancelled) return;
          const [p, b] = await Promise.all([
            W.get('/api/gateway/progress?bookId=' + encodeURIComponent(bookId)).catch(() => null),
            W.get('/api/gateway/bestbookmarks?bookId=' + encodeURIComponent(bookId)).catch(() => null),
          ]);
          if (!cancelled) setGwState({ progress: p?.ok ? p.data : null, best: b?.ok ? b.data : null });
        } catch { /* ignore */ }
      })();
      return () => { cancelled = true; };
    }, [bookId]);
    const [bestOpen, setBestOpen] = useState(false);
    // v1.4 逐条导图：导出中的笔记（card 形状对齐漫游导出器）
    const [exportCard, setExportCard] = useState(null);
    const openNoteExport = (n) => setExportCard({
      text: n.highlightText || n.thoughtText || '',
      rawText: n.highlightText || n.thoughtText || '',
      bookTitle: (data?.book?.title) || '',
      bookAuthor: (data?.book?.author) || '',
      author: n.author,
      createTime: n.createTime,
      noteType: n.highlightText ? 'highlight' : 'thought',
    });
    // v1.5 单例阅读窗口打开（WebBar 模型：一个专用 Chrome 窗口复用导航，不开多窗/不落默认浏览器）
    const openAppWindow = async (url) => {
      try {
        const r = await W.post('/api/open-reader', { url });
        W.readerToast(r, onToast);
      } catch (e) { onToast && onToast(e.message || String(e)); }
    };

    // 章节去重 + 计数（优先用后端 chapters，缺省从 notes 派生）
    const chapters = useMemo(() => {
      const notes = data?.notes || [];
      if (Array.isArray(data?.chapters) && data.chapters.length) {
        const cnt = {};
        for (const n of notes) {
          const t = n.chapterTitle || data.chapters[0]?.title || W.t.uncategorized;
          cnt[t] = (cnt[t] || 0) + 1;
        }
        return data.chapters.map((c) => ({
          title: c.title || c.chapterTitle || W.t.uncategorized,
          count: cnt[c.title || c.chapterTitle] || 0,
        }));
      }
      const map = new Map();
      for (const n of notes) {
        const t = n.chapterTitle || W.t.uncategorized;
        if (!map.has(t)) map.set(t, { title: t, count: 0 });
        map.get(t).count += 1;
      }
      return [...map.values()];
    }, [data]);

    const notes = data?.notes || [];
    // v1.7.4 性能：按章节一次分组。此前渲染体内 chapters.map × notes.filter = O(章×笔记)，
    // 大书（300 章×3000 笔记）每次渲染 90 万次字符串比较，滚动联动每跨一章整树重渲染一遍。
    const notesByChapter = useMemo(() => {
      const map = new Map();
      for (const n of notes) {
        const t = n.chapterTitle || W.t.uncategorized;
        if (!map.has(t)) map.set(t, []);
        map.get(t).push(n);
      }
      return map;
    }, [data]);
    const highlights = notes.filter((n) => n.highlightText).length;
    const thoughts = notes.filter((n) => n.thoughtText).length;

    // 滚动联动高亮（IntersectionObserver 简化版）
    useEffect(() => {
      const root = scrollRef.current;
      if (!root || chapters.length === 0) return undefined;
      const els = Object.values(secRefs.current).filter(Boolean);
      if (!els.length || typeof IntersectionObserver === 'undefined') return undefined;
      const io = new IntersectionObserver((entries) => {
        const hit = entries.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit && hit.target.dataset?.idx != null) setActive(Number(hit.target.dataset.idx));
      }, { root, rootMargin: '-8px 0px -60% 0px', threshold: 0 });
      els.forEach((el) => io.observe(el));
      return () => io.disconnect();
    }, [data, chapters.length]);

    const scrollToChapter = (idx) => {
      setActive(idx);
      const el = secRefs.current[idx];
      if (el && scrollRef.current) {
        scrollRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
      }
    };

    const doRefresh = async () => {
      if (refreshing) return;
      setRefreshing(true);
      try {
        await W.post('/api/book/sync', { bookId });
        await load();
        onToast && onToast(W.t.syncDone);
      } catch (e) { onToast && onToast(e.message || W.t.refreshFailed); }
      setRefreshing(false);
    };

    // 摘录多选：与渲染一致的稳定 key
    const noteKeyOf = (n, i, j) => n.localNoteId || n.noteId || `${i}:${j}`;
    const secNotesOf = (c) => notesByChapter.get(c.title) || []; // v1.7.4：O(1) 查表（语义与原 filter 一致）
    const toggleSel = (key) => setSel((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    const exitSelMode = () => { setSelMode(false); setSel(new Set()); };
    const copySelection = async () => {
      const picked = [];
      chapters.forEach((c, i) => {
        secNotesOf(c).forEach((n, j) => {
          if (sel.has(noteKeyOf(n, i, j))) picked.push({ n, chapter: c.title });
        });
      });
      if (!picked.length) { onToast && onToast(W.t.selEmpty); return; }
      const md = picked.map(({ n, chapter }) => {
        const src = `——《${book.title || ''}》${chapter ? ` · ${chapter}` : ''}`;
        const lines = [];
        if (n.highlightText) lines.push(`> ${String(n.highlightText).replace(/\n/g, '\n> ')}`);
        if (n.thoughtText) lines.push(`> 💭 ${String(n.thoughtText).replace(/\n/g, '\n> ')}`);
        lines.push(`> ${src}`);
        return lines.join('\n');
      }).join('\n\n');
      try {
        await navigator.clipboard.writeText(md);
        onToast && onToast(W.t.copiedExcerpts(picked.length));
      } catch { onToast && onToast(W.t.copyFailedManual); }
    };

    const book = data?.book || {};
    const pub = book.publisher;

    return h('div', { className: 'wr-root wr-detailwrap' },
      error
        ? h('div', { className: 'wr-empty' },
            h('div', null, W.t.loadFailed, '：', error),
            h('button', { className: 'wr-btn', onClick: load }, W.t.retry))
        : loading
          ? h('div', { className: 'wr-empty' }, h('span', { className: 'wr-spin' }), W.t.loading)
          : h('div', { className: 'wr-detail' },
              // 左：章节导航
              h('div', { className: 'wr-chapnav' },
                h('div', { className: 'wr-chapnav-title' }, W.I.bookmark(12), ` ${W.t.chapterNav} | ${chapters.length} ${W.t.chapters}`),
                chapters.map((c, i) => h('div', {
                  key: c.title + i,
                  className: 'wr-chap-item' + (active === i ? ' wr-chap-active' : ''),
                  title: c.title,
                  onClick: () => scrollToChapter(i),
                },
                  h('span', { className: 'wr-chap-name' }, c.title),
                  h('span', { className: 'wr-badge wr-chap-badge' }, c.count)))),
              // 右：内容
              h('div', { className: 'wr-detailmain', ref: scrollRef },
                h('div', { className: 'wr-bookhead' },
                  book.cover ? h('img', {
                    className: 'wr-cover', src: book.cover, alt: '',
                    onError: (e) => { e.target.style.display = 'none'; },
                  }) : null,
                  h('div', { className: 'wr-bookinfo' },
                    h('div', { className: 'wr-booktitle' }, book.title || ''),
                    h('div', { className: 'wr-muted wr-small' },
                      [book.author, pub].filter(Boolean).join(' · ')),
                    h('div', { className: 'wr-bookmeta' },
                      h('span', null, W.t.statProgress(book.progress || 0)),
                      h('span', null, W.t.statNotes(notes.length)),
                      gwState.progress && h('span', {
                        title: (gwState.progress.updateTime ? `最近阅读：${W.fmtDateTime(gwState.progress.updateTime)}` : '')
                          + (gwState.progress.finishTime ? `\n读完于：${W.fmtDate(gwState.progress.finishTime)}` : ''),
                      }, `🕐 ${gwState.progress.progress}% · ${Math.max(0, Math.round((gwState.progress.recordReadingTime || 0) / 60))} ${W.t.minutesShort}`),
                      h('span', null, W.t.statHighlightsInfo(highlights))),
                    h('div', { className: 'wr-row' },
                      h('button', { className: 'wr-btn', disabled: refreshing, onClick: doRefresh },
                        refreshing ? W.t.loading : W.t.refresh),
                      book.pcUrl && h('button', {
                        className: 'wr-btn',
                        title: W.t.appWindowTip,
                        onClick: () => openAppWindow(book.pcUrl),
                      }, '🪟 ', W.t.appWindowRead),
                      notes.length > 0 && h('button', {
                        className: 'wr-btn' + (selMode ? ' wr-rm-duebtn' : ''),
                        onClick: () => (selMode ? exitSelMode() : setSelMode(true)),
                        title: W.t.selModeTip,
                      }, selMode ? W.t.exitSelMode : W.t.enterSelMode)))),
                notes.length === 0
                  ? h('div', { className: 'wr-empty' }, h('div', null, W.t.noNotes))
                  : h('div', { style: { minHeight: '100%' } }, chapters.map((c, i) => {                      const secNotes = secNotesOf(c);
                      const open = !collapsed[i];
                      return h('section', {
                        key: c.title + i,
                        ref: (el) => { secRefs.current[i] = el; },
                        'data-idx': i,
                      },
                        h('div', { className: 'wr-sec-head', onClick: () => setCollapsed((m) => ({ ...m, [i]: !m[i] })) },
                          h('span', { className: 'wr-arrow' + (open ? ' wr-arrow-open' : '') }, '▸'),
                          h('span', null, '# ', c.title),
                          h('span', { className: 'wr-sec-count' }, `${secNotes.length} ${W.t.notes}`)),
                        open && secNotes.map((n, j) => h('div', {
                          key: noteKeyOf(n, i, j),
                          className: 'wr-note' + (active === i ? ' wr-note-active' : '')
                            + (selMode ? ' wr-note-sel' : '') + (sel.has(noteKeyOf(n, i, j)) ? ' wr-note-sel-on' : ''),
                          onClick: selMode ? () => toggleSel(noteKeyOf(n, i, j)) : undefined,
                        },
                          selMode && h('span', {
                            className: 'wr-selmark',
                            title: sel.has(noteKeyOf(n, i, j)) ? W.t.selectedWord : W.t.unselectedWord,
                          }, '✓'),
                          n.highlightText && h('blockquote', { className: 'wr-quote' }, n.highlightText),
                          n.thoughtText && h('div', { className: 'wr-thought' }, '💭 ', n.thoughtText),
                          n.createTime != null && h('div', { className: 'wr-notetime' },
                            W.fmtDateTime(n.createTime),
                            h('button', {
                              className: 'wr-mini',
                              style: { marginLeft: '8px', padding: '0 4px', display: 'inline-flex', alignItems: 'center' },
                              title: W.t.exportCardTip,
                              onClick: (e) => { e.stopPropagation(); openNoteExport(n); },
                            }, W.I.camera(11), ' ', W.t.exportWord)))));
                    }),
                    // v1.3 热门划线（官方 bestbookmarks，Key 在场；可折叠）
                    gwState.best && Array.isArray(gwState.best.items) && gwState.best.items.length > 0 && h('section', { style: { marginTop: '16px' } },
                      h('div', {
                        className: 'wr-sec-head',
                        onClick: () => setBestOpen((v) => !v),
                        title: W.t.bestHighlightsTip,
                      },
                        h('span', { className: 'wr-arrow' + (bestOpen ? ' wr-arrow-open' : '') }, '▸'),
                        h('span', null, '🔥 ', W.t.bestHighlights),
                        h('span', { className: 'wr-sec-count' }, `${gwState.best.items.length} ${W.t.bestHighlightsUnit}`)),
                      bestOpen && h('div', null, gwState.best.items.map((it, idx) => {
                        const chap = (gwState.best.chapters ?? []).find((c) => Number(c.chapterUid) === Number(it.chapterUid));
                        return h('div', { key: it.bookmarkId || idx, className: 'wr-note' },
                          h('blockquote', { className: 'wr-quote' }, it.markText || ''),
                          h('div', { className: 'wr-notetime' },
                            `${chap?.title ? chap.title + ' · ' : ''}${W.t.bestHighlightPeople(it.totalCount)}`));
                      }))),
                    // 摘录浮条（与章节列表同层，sticky 置底）
                    selMode && h('div', { className: 'wr-selfbar' },
                      W.t.selCount(sel.size),
                      h('span', { style: { flex: 1 } }),
                      h('button', { className: 'wr-btn wr-btn-primary', onClick: copySelection }, W.t.copyQuotes),
                      h('button', { className: 'wr-btn', onClick: exitSelMode }, W.t.cancel)))),
              // v1.4 逐条导图弹窗（漫游同款）
              exportCard && h(W.NoteExportModal, {
                card: exportCard,
                themes,
                onClose: () => setExportCard(null),
                onToast,
              })));
  };
})();
