    /**
     * 微信读书 DSH 插件 — 55-discover
     * 发现页：官方网关全文搜索（scope 快捷筛选 + 分页）+ 为你推荐。
     * 数据全部来自 /api/gateway/*（API Key 在场时可用；未绑定时优雅降级为引导卡片）。
     * __search / __recommend props 仅供 rmsmoke 冒烟注入（同 40-roaming 的 __session 模式）。
     */

    W.CSS_55 = `
.wr-dsc-searchbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.wr-dsc-input{flex:1;min-width:200px;padding:5px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}
.wr-dsc-input:focus{border-color:var(--dsw-alias-brand-primary)}
.wr-dsc-scopes{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.wr-dsc-scope{padding:2px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px}
.wr-dsc-scope:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.wr-dsc-scope-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
.wr-dsc-group-t{font-size:12px;color:var(--dsw-alias-label-secondary);margin:10px 0 6px;display:flex;align-items:center;gap:6px}
.wr-dsc-card{display:flex;gap:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.wr-dsc-num{flex:none;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.wr-dsc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.wr-dsc-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.wr-dsc-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.wr-dsc-intro{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wr-dsc-links{display:flex;gap:12px;font-size:12px;margin-top:2px}
.wr-dsc-link{color:var(--dsw-alias-brand-primary);text-decoration:none}
.wr-dsc-link:hover{text-decoration:underline}
.wr-dsc-more{margin:6px 0 16px}
.wr-dsc-item{display:flex;gap:10px;align-items:baseline;padding:7px 2px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.wr-dsc-item-t{font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;flex:none}
.wr-dsc-item-m{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none}
.wr-dsc-reason{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-dsc-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:48px 0;color:var(--dsw-alias-label-secondary);text-align:center}
`;

    (() => {
      const h = W.h;

      // scope 快捷项：值契约见 /api/gateway/search（0 全部/10 电子书/14 听书/6 作者/12 全文/2 公众号）
      const scopeChips = () => [
        [10, W.t.scopeBook], [0, W.t.scopeAll], [14, W.t.scopeAudio],
        [6, W.t.scopeAuthor], [12, W.t.scopeFulltext], [2, W.t.scopeMp],
      ];

      // 评分：newRating 为百分制，展示成 10 分制一位小数；无评分返回 null
      const ratingOf = (b) => {
        const v = Number(b && b.newRating);
        return Number.isFinite(v) && v > 0 ? (v / 10).toFixed(1) : null;
      };

      W.Discover = function Discover({ state, onToast, onNavigate, __search, __recommend }) {
        const { useState, useEffect, useCallback } = W.hooks;
        const gw = !!(state && state.gateway && state.gateway.enabled);

        // ---- 搜索态 ----
        const [kw, setKw] = useState('');
        const [scope, setScope] = useState(10);
        const [searching, setSearching] = useState(false);
        const [searchError, setSearchError] = useState('');
        const [groups, setGroups] = useState(() => (__search && Array.isArray(__search.results) ? __search.results.slice() : []));
        const [hasMore, setHasMore] = useState(() => !!(__search && __search.hasMore));
        // v1.5 统一单例阅读窗口打开助手（toast 由 Host 结果统一决定）
        const openInAppWindow = (url) => {
          W.post('/api/open-reader', { url })
            .then((r) => W.readerToast(r, onToast))
            .catch((e) => onToast && onToast(e.message || String(e)));
        };
        const [searched, setSearched] = useState(() => !!__search);

        // ---- 推荐态 ----
        const [recLoading, setRecLoading] = useState(() => !__recommend);
        const [recError, setRecError] = useState('');
        const [recBooks, setRecBooks] = useState(() => (__recommend && Array.isArray(__recommend.books) ? __recommend.books.slice() : []));

        const runSearch = useCallback(async (keyword, sc, maxIdx, append) => {
          if (!keyword) return;
          setSearching(true); setSearchError('');
          try {
            const q = new URLSearchParams({ keyword, scope: String(sc) });
            if (maxIdx) q.set('maxIdx', String(maxIdx));
            const r = await W.get('/api/gateway/search?' + q.toString());
            const d = (r && r.data) || {};
            const rs = Array.isArray(d.results) ? d.results : [];
            setSearched(true);
            if (append) setGroups((g) => g.concat(rs));
            else setGroups(rs);
            setHasMore(!!d.hasMore);
          } catch (e) {
            setSearchError(e.message || String(e));
            if (!append) { setGroups([]); setHasMore(false); }
          } finally { setSearching(false); }
        }, []);

        const loadRecommend = useCallback(async () => {
          setRecLoading(true); setRecError('');
          try {
            const r = await W.get('/api/gateway/recommend?count=12');
            const d = (r && r.data) || {};
            setRecBooks(Array.isArray(d.books) ? d.books : []);
          } catch (e) { setRecError(e.message || String(e)); }
          finally { setRecLoading(false); }
        }, []);

        useEffect(() => { if (gw && !__recommend) loadRecommend(); }, [loadRecommend]); // eslint-disable-line react-hooks/exhaustive-deps

        const bindKey = () => { try { window.dispatchEvent(new CustomEvent('weread:open-login')); } catch { /* ignore */ } };
        const onSearch = () => runSearch(kw.trim(), scope, 0, false);
        // 翻页：maxIdx = 已加载最后一条的 searchIdx（跨组累计）
        const flatBooks = groups.reduce((acc, g) => acc.concat(Array.isArray(g && g.books) ? g.books : []), []);
        const lastIdx = flatBooks.length ? Number(flatBooks[flatBooks.length - 1].searchIdx) || 0 : 0;
        const onNext = () => runSearch(kw.trim(), scope, lastIdx, true);

        // 未绑 Key：居中引导卡片（说明 + 绑定按钮），不发起任何请求
        if (!gw) {
          return h('div', { className: 'wr-dsc-center' },
            h('style', null, W.CSS_55),
            W.I.search(28),
            h('div', { style: { maxWidth: 420, lineHeight: 1.6 } }, W.t.discoverBindHint),
            h('button', { className: 'wr-btn wr-btn-primary', onClick: bindKey }, W.t.bindApiKey));
        }

        // 结果卡片（跨组连续编号）
        let no = 0;
        const resultNodes = [];
        groups.forEach((g, gi) => {
          resultNodes.push(h('div', { key: 'g' + gi, className: 'wr-dsc-group-t' },
            g && g.title ? String(g.title) : '',
            g && g.scopeCount != null ? h('span', { className: 'wr-badge' }, String(g.scopeCount)) : null));
          ((g && g.books) || []).forEach((b, bi) => {
            no += 1;
            const info = (b && b.bookInfo) || {};
            const rating = ratingOf(b);
            resultNodes.push(h('div', { className: 'wr-dsc-card', key: gi + ':' + bi },
              h('span', { className: 'wr-dsc-num' }, String(no)),
              h('div', { className: 'wr-dsc-main' },
                h('div', { className: 'wr-dsc-title', title: info.title || '' }, info.title || info.bookId || ''),
                h('div', { className: 'wr-dsc-meta' },
                  info.author ? h('span', null, info.author) : null,
                  rating ? h('span', null, '⭐ ', rating) : null,
                  b && b.readingCount != null && Number(b.readingCount) > 0 ? h('span', null, W.t.readingPeople(b.readingCount)) : null,
                  info.category ? h('span', null, info.category) : null),
                info.intro ? h('div', { className: 'wr-dsc-intro', title: info.intro }, info.intro) : null,
                (info.readerLink || info.bookId) && h('div', { className: 'wr-dsc-links' },
                  // v1.4.3：移除与「打开阅读」重复的 App 窗口入口；详情改站内路由（可继续跳转，非孤立 H5）
                  info.readerLink && h('button', {
                    className: 'wr-dsc-link', style: { cursor: 'pointer', border: 'none', background: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' },
                    title: W.t.openReaderAppTip,
                    onClick: () => openInAppWindow(info.readerLink),
                  }, W.t.openReader),
                  // v1.4.4：详情链接由 Host 统一计算（hash→bookDetail 实测 200；数字型该路由 404 → 阅读页）
                  (info.detailUrl || info.readerLink) && h('button', {
                    className: 'wr-dsc-link', style: { cursor: 'pointer', border: 'none', background: 'none' },
                    title: W.t.viewDetailAppTip,
                    onClick: () => openInAppWindow(info.detailUrl || info.readerLink),
                  }, W.t.viewDetail)))));
          });
        });

        return h('div', null,
          h('style', null, W.CSS_55),
          // 搜索行：输入框（回车触发）+ 搜索按钮
          h('div', { className: 'wr-dsc-searchbar' },
            h('input', {
              className: 'wr-dsc-input', value: kw, placeholder: W.t.searchPlaceholder,
              onChange: (e) => setKw(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') onSearch(); },
            }),
            h('button', { className: 'wr-btn wr-btn-primary', disabled: searching || !kw.trim(), onClick: onSearch },
              searching ? W.t.loading : W.t.searchBtn)),
          // scope 快捷 chips
          h('div', { className: 'wr-dsc-scopes' },
            scopeChips().map(([v, label]) => h('button', {
              key: v, className: 'wr-dsc-scope' + (scope === v ? ' wr-dsc-scope-on' : ''),
              onClick: () => setScope(v),
            }, label))),
          // 搜索失败：错误行不崩组件（保留已有结果）
          searchError && h('div', { className: 'wr-ins-banner wr-ins-banner-warn' }, '⚠️ ', W.t.searchFailed, '：', searchError),
          // 结果列表 / 空态
          !searched && !searchError ? h('div', { className: 'wr-empty' }, W.I.search(22), W.t.searchPlaceholder)
            : searched && !groups.length && !searching && !searchError ? h('div', { className: 'wr-empty' }, W.I.search(22), W.t.searchEmpty)
              : h('div', null, resultNodes),
          // 下一页（maxIdx=最后一条 searchIdx）
          hasMore && h('div', { className: 'wr-dsc-more' },
            h('button', { className: 'wr-btn', disabled: searching, onClick: onNext }, searching ? W.t.loading : W.t.nextPage)),
          // 为你推荐
          h('div', { className: 'wr-sec', style: { marginTop: 16 } },
            h('div', { className: 'wr-sec-t' }, W.t.forYou,
              h('button', { className: 'wr-btn', style: { marginLeft: 'auto' }, disabled: recLoading, onClick: loadRecommend }, W.t.refreshBatch)),
            recLoading ? h('div', { className: 'wr-row wr-muted', style: { padding: '8px 0' } }, h('span', { className: 'wr-spin' }), ' ', W.t.loading)
              : recError ? h('div', { className: 'wr-muted', style: { padding: '8px 0' } }, W.t.loadFailed, '：', recError)
                : !recBooks.length ? h('div', { className: 'wr-muted', style: { padding: '8px 0' } }, W.t.noData)
                  : recBooks.map((rb, i) => h('div', { className: 'wr-dsc-item', key: rb.bookId || i },
                      h('span', { className: 'wr-dsc-num', style: { alignSelf: 'center' } }, String(i + 1)),
                      h('span', { className: 'wr-dsc-item-t', title: rb.title || '' }, rb.title || ''),
                      h('span', { className: 'wr-dsc-item-m' }, [rb.author, ratingOf(rb)].filter(Boolean).join(' · ')),
                      rb.reason ? h('span', { className: 'wr-dsc-reason', title: rb.reason }, W.t.reason, '：', rb.reason) : null,
                      // v1.4.2 推荐条目右侧 App 阅读入口
                      (rb.detailUrl || rb.readerLink) && h('button', {
                        className: 'wr-mini',
                        style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '3px', flex: 'none' },
                        title: W.t.appWindowTip,
                        onClick: () => openInAppWindow(rb.readerLink || rb.detailUrl),
                      }, W.I.window(12), ' ', W.t.appWindowRead)))));
      };
    })();
