    // ---------- 30-insights：阅读洞察 ----------
    W.CSS_30 = `
.wr-ins-banner{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin-bottom:12px;color:var(--dsw-alias-label-secondary);font-size:12px}
.wr-ins-banner-warn{border-color:var(--dsw-alias-warning,#d29922);color:var(--dsw-alias-warning,#d29922)}
.wr-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:12px}
.wr-kpi{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.wr-kpi-v{font-size:18px;font-weight:700;color:var(--dsw-alias-label-primary)}
.wr-kpi-l{font-size:11px;color:var(--dsw-alias-label-secondary)}
.wr-grid2{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;margin-bottom:12px}
.wr-grid2w{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
@media(max-width:900px){.wr-grid2,.wr-grid2w{grid-template-columns:1fr}}
.wr-sec{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 16px;margin-bottom:0}
.wr-sec-t{font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wr-legend{display:flex;gap:6px;margin-left:auto}
.wr-legend-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;font-size:11px;color:var(--dsw-alias-label-primary);background:none}
.wr-legend-pill::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--dot)}
.wr-legend-off{opacity:.4}
.wr-tip{position:fixed;z-index:120;pointer-events:none;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 10px;font-size:11px;color:var(--dsw-alias-label-primary);box-shadow:0 4px 12px rgba(0,0,0,.25);max-width:min(420px,calc(100vw - 16px));line-height:1.5}
.wr-info{display:inline-block;width:14px;height:14px;line-height:13px;text-align:center;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:10px;cursor:help;font-style:normal}
.wr-tbl{width:100%;border-collapse:collapse;font-size:12px}
.wr-tbl th{color:var(--dsw-alias-label-secondary);font-weight:500;text-align:left;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.wr-tbl td{padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.wr-tbl-book{color:var(--dsw-alias-brand-primary);cursor:pointer;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-tbl-book:hover{text-decoration:underline}
.wr-tl{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.wr-tl-item{padding:6px 10px 6px 14px;border-left:3px solid var(--dsw-alias-success,#3fb950);margin:2px 0;background:none}
.wr-tl-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:2px;display:flex;align-items:center;flex-wrap:wrap;gap:4px}
.wr-tl-body{font-size:12px;color:var(--dsw-alias-label-primary);line-height:1.5}
/* v1.8.15：时间线笔记类型徽标（原正文纯文本前缀改为 meta 行内徽标） */
.wr-tl-type{display:inline-flex;align-items:center;padding:0 7px;border-radius:8px;font-size:10px;line-height:16px;font-weight:500;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.wr-tl-type-hl{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.wr-tl-type-th{color:var(--dsw-alias-warning,#d29922);border-color:var(--dsw-alias-warning,#d29922)}
.wr-tl-type-both{color:var(--dsw-alias-success,#3fb950);border-color:var(--dsw-alias-success,#3fb950)}
.wr-hm{display:grid;grid-template-columns:34px repeat(24,1fr);gap:2px;font-size:10px}
.wr-hm-cell{height:10px;border-radius:2px;background:rgba(79,140,255,.08)}
.wr-hm-lab{color:var(--dsw-alias-label-secondary);line-height:10px}
.wr-hm-axis{grid-column:2/26;display:flex;justify-content:space-between;color:var(--dsw-alias-label-secondary);font-size:10px;margin-top:2px}
.wr-bar-row{display:grid;grid-template-columns:110px 1fr 90px;align-items:center;gap:8px;margin:5px 0;font-size:12px}
.wr-bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.wr-bar-track{height:10px;border-radius:5px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.12));overflow:hidden}
.wr-bar-fill{height:100%;border-radius:5px;background:#4f8cff}
.wr-bar-val{color:var(--dsw-alias-label-secondary);font-size:11px;text-align:right;white-space:nowrap}
.wr-cloud{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;justify-content:center;padding:8px 0}
.wr-cloud span{color:#4f8cff;cursor:default;line-height:1.2}
.wr-lvl-btn{padding:1px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;margin-left:4px}
.wr-lvl-btn-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
.wr-chart-wrap{position:relative;width:100%}
.wr-chart-wrap svg{display:block;width:100%;height:auto}
.wr-sc-pt{cursor:pointer}
`;

    // ---------- 30b：官方阅读统计（v1.3，网关 /api/gateway/stats；未绑 Key 降级为引导行） ----------
    // __stats 仅供 rmsmoke 冒烟注入预载数据（跳过 fetch），运行时由 App 传 gatewayEnabled
    W.OfficialStats = function OfficialStats({ gatewayEnabled, __stats }) {
      const { useState, useEffect, useCallback, useRef } = W.React;
      const h = W.h;
      const [mode, setMode] = useState('weekly');
      const [data, setData] = useState(() => (__stats ? __stats : null));
      const [loading, setLoading] = useState(() => !__stats);
      const [error, setError] = useState('');

      const reqRef = useRef(0); // P2-36：请求代次——weekly/monthly 快速切换时丢弃晚到的旧响应/旧报错
      const load = useCallback(async (m) => {
        const myReq = ++reqRef.current;
        setLoading(true); setError('');
        try {
          const r = await W.get('/api/gateway/stats?mode=' + m);
          if (reqRef.current !== myReq) return; // 已被更新代次取代，本响应作废
          if (!r || !r.data) throw new Error(String(r && r.error || 'no data'));
          setData(r.data);
        } catch (e) {
          if (reqRef.current !== myReq) return; // 旧代次的报错不覆盖新请求
          setError(e.message || String(e));
        }
        finally { if (reqRef.current === myReq) setLoading(false); } // 旧代次不得提前熄灭新请求的 loading
      }, []);
      useEffect(() => { if (!__stats) load(mode); }, [mode, load]); // eslint-disable-line react-hooks/exhaustive-deps

      const hm = (sec) => {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        const hh = Math.floor(s / 3600);
        const mm = Math.round((s % 3600) / 60);
        return W.t.statsHoursFn(hh, mm);
      };
      const bindKey = () => { try { window.dispatchEvent(new CustomEvent('weread:open-login')); } catch { /* ignore */ } };

      // 环比：compare 小数（正=增长）→ 百分比带 ↑/↓ 色；无数据显示 —
      const cmpNode = (() => {
        const v = data && data.compare;
        if (v == null || !Number.isFinite(Number(v))) return h('span', null, '—');
        const pct = (Number(v) * 100).toFixed(1) + '%';
        const up = Number(v) > 0, down = Number(v) < 0;
        return h('span', { style: { color: up ? 'var(--dsw-alias-success, #3fb950)' : down ? 'var(--dsw-alias-danger, #d5453f)' : 'inherit' } },
          up ? '↑ ' : down ? '↓ ' : '', pct);
      })();

      const kpis = data ? [
        { l: W.t.statsTotalTime, v: hm(data.totalReadTime) },
        { l: W.t.statsReadDays, v: `${data.readDays ?? 0}${W.t.unitDays}` },
        { l: W.t.statsDailyAvg, v: hm(data.dayAverageReadTime) },
        { l: W.t.statsCompare, v: cmpNode },
      ] : [];

      return h('div', { className: 'wr-sec', style: { marginBottom: 12 } },
        h('div', { className: 'wr-sec-t' }, W.t.officialStats,
          gatewayEnabled && h('span', { className: 'wr-legend' },
            h('button', { className: 'wr-lvl-btn' + (mode === 'weekly' ? ' wr-lvl-btn-on' : ''), onClick: () => setMode('weekly') }, W.t.statsWeekly),
            h('button', { className: 'wr-lvl-btn' + (mode === 'monthly' ? ' wr-lvl-btn-on' : ''), onClick: () => setMode('monthly') }, W.t.statsMonthly))),
        !gatewayEnabled
          ? h('div', { className: 'wr-row', style: { flexWrap: 'wrap' } },
              h('span', { className: 'wr-muted wr-small' }, W.t.statsBindHint),
              h('button', { className: 'wr-btn wr-btn-primary', onClick: bindKey }, W.t.bindApiKey))
          : loading ? h('div', { className: 'wr-row wr-muted', style: { padding: '4px 0' } }, h('span', { className: 'wr-spin' }), ' ', W.t.loading)
            : error ? h('div', { className: 'wr-muted', style: { color: 'var(--dsw-alias-warning, #d29922)' } }, W.t.loadFailed, '：', error)
              : !data ? h('div', { className: 'wr-muted', style: { padding: '4px 0' } }, W.t.noData)
                : h('div', null,
                    h('div', { className: 'wr-kpis' }, kpis.map((kpi, i) => h('div', { className: 'wr-kpi', key: i },
                      h('div', { className: 'wr-kpi-v' }, kpi.v), h('div', { className: 'wr-kpi-l' }, kpi.l)))),
                    h('div', { className: 'wr-grid2w' },
                      h('div', null,
                        h('div', { className: 'wr-small wr-muted', style: { margin: '10px 0 4px' } }, W.t.statsTopBooks),
                        (data.readLongest || []).slice(0, 3).map((it, i) => h('div', { className: 'wr-bar-row', key: i, style: { gridTemplateColumns: '1fr auto' } },
                          h('span', { className: 'wr-bar-name', title: (it.book && it.book.title) || '' }, (it.book && it.book.title) || ''),
                          h('span', { className: 'wr-bar-val' }, hm(it.readTime)))),
                        !(data.readLongest || []).length && h('div', { className: 'wr-muted wr-small' }, W.t.noData)),
                      h('div', null,
                        h('div', { className: 'wr-small wr-muted', style: { margin: '10px 0 4px' } }, W.t.statsPreferCats),
                        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                          (data.preferCategory || []).map((c, i) => h('span', { className: 'wr-badge', key: i, title: c.categoryTitle || '' },
                            (c.categoryTitle || ''), ' · ', W.t.countBooks(c.readingCount ?? 0)))),
                        !(data.preferCategory || []).length && h('div', { className: 'wr-muted wr-small' }, W.t.noData)))));
    };

    W.Insights = function Insights({ onNavigate, onToast, loggedIn = true, gatewayEnabled = false, __stats }) {
      const { useState, useEffect, useMemo, useRef, useCallback } = W.React;
      const h = W.h;
      const [filters, setFilters] = useState({ days: 0, category: '', noteType: 'all', finishedOnly: false, granularity: 'day' });
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [showNotes, setShowNotes] = useState(true);
      const [showActive, setShowActive] = useState(true);
      const [radarLevel, setRadarLevel] = useState(1);
      const [exporting, setExporting] = useState(false);
      const [reportPath, setReportPath] = useState('');
      // C9: tooltip 不再走 React state——点级 handler 直接写容器 DOM，悬停零重渲染
      const tipHostRef = useRef(null);
      // v1.8.16：先隐形渲染量实际宽高再定位——右侧放不下翻到光标左侧、底部放不下翻到光标上方，
      // 仍放不下（超宽）贴边由 CSS max-width 换行兜底。原版 220px 硬编码钳制对长文案
      // （价值分公式「笔记产出分50% + 深度占比30% + 完成率20%」）失效，窄窗口右缘截断。
      const showTip = (e, html) => {
        const host = tipHostRef.current;
        if (!host) return;
        host.innerHTML = `<div class="wr-tip" style="left:-9999px;top:0">${html}</div>`;
        const el = host.firstElementChild;
        if (!el) return;
        const PAD = 8, GAP = 12;
        const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
        const w = el.offsetWidth, h = el.offsetHeight;
        let left = e.clientX + GAP;
        if (left + w > vw - PAD) left = Math.max(PAD, e.clientX - w - GAP); // 右侧放不下 → 翻到光标左侧
        if (left + w > vw - PAD) left = Math.max(PAD, vw - PAD - w); // 超视口宽 → 贴右缘（max-width 换行）
        let top = e.clientY + 14;
        if (top + h > vh - PAD) top = Math.max(PAD, e.clientY - h - GAP); // 下方放不下 → 翻到光标上方
        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
      };
      const hideTip = () => { const host = tipHostRef.current; if (host) host.innerHTML = ''; };
      const fmt = (v, suffix = '') => (v === undefined || v === null || Number.isNaN(Number(v)) ? '-' : `${Math.round(Number(v) * 10) / 10}${suffix}`);

      const query = useMemo(() => {
        const q = new URLSearchParams();
        q.set('days', String(filters.days));
        if (filters.category) q.set('category', filters.category);
        if (filters.noteType && filters.noteType !== 'all') q.set('noteType', filters.noteType);
        if (filters.finishedOnly) q.set('finishedOnly', '1');
        q.set('granularity', filters.granularity);
        return q.toString();
      }, [filters]);

      const load = useCallback(async () => {
        setLoading(true); setError('');
        try { setData(await W.get('/api/insights?' + query)); }
        catch (err) { setError(err.message || String(err)); }
        finally { setLoading(false); }
      }, [query]);
      useEffect(() => { load(); }, [load]);

      const exportReport = async () => {
        setExporting(true);
        try {
          const res = await W.post('/api/insights/report', { days: filters.days, category: filters.category, noteType: filters.noteType, finishedOnly: filters.finishedOnly, granularity: filters.granularity });
          setReportPath(res.path || res.file || '');
          onToast && onToast(W.t.reportExported(res.path || res.file || ''));
        } catch (err) { onToast && onToast(W.t.exportFailed(err.message || err)); }
        finally { setExporting(false); }
      };

      // v0.3 AI 解读闭环：导出后一键复制解读提示词，粘贴到输入框即可让 AI 结合文件分析
      const copyAiPrompt = async () => {
        const prompt = W.t.aiPrompt(reportPath);
        try {
          await navigator.clipboard.writeText(prompt);
          onToast && onToast(W.t.promptCopied);
        } catch { onToast && onToast(W.t.promptCopyFailed(reportPath)); }
      };

      const sel = (patch) => setFilters((f) => ({ ...f, ...patch }));
      const cats = (data && data.availableCategories) || [];
      const k = (data && data.kpis) || {};
      const daysLabel = filters.days === 0 ? W.t.allData : W.t.rangeLastDays(filters.days);
      const trend = (data && data.trend) || [];
      const totalNotes = data && data.totalNotes != null ? data.totalNotes : (k.totalNotes != null ? k.totalNotes : 0);
      const coveredBooks = data && data.coveredBooks != null ? data.coveredBooks : ((data && data.topBooks && data.topBooks.length) || 0);

      // ---- 趋势折线 ----
      const TW = 680, TH = 190, TP = { l: 36, r: 12, t: 10, b: 22 };
      const trendMax = Math.max(1, ...trend.map((p) => Math.max(p.notesCount || 0, p.touchedBooks || 0)));
      const tx = (i) => TP.l + (trend.length <= 1 ? (TW - TP.l - TP.r) / 2 : (i * (TW - TP.l - TP.r)) / (trend.length - 1));
      const ty = (v) => TH - TP.b - ((v / (Math.ceil(trendMax / 4) * 4)) * (TH - TP.t - TP.b));
      const gridMax = Math.ceil(trendMax / 4) * 4;
      const lineOf = (key) => trend.map((p, i) => (i === 0 ? 'M' : 'L') + tx(i).toFixed(1) + ' ' + ty(p[key] || 0).toFixed(1)).join(' ');
      const mmdd = (s) => { const m = /[0-9]{4}-([0-9]{2})-([0-9]{2})/.exec(String(s || '')); return m ? m[1] + '-' + m[2] : String(s || ''); };
      const xLabels = trend.length ? [0, Math.floor((trend.length - 1) / 4), Math.floor((trend.length - 1) / 2), Math.floor(((trend.length - 1) * 3) / 4), trend.length - 1]
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((i) => ({ i, t: mmdd(trend[i].date) })) : [];

      // ---- 热力图 ----
      const hm = useMemo(() => {
        const cells = (data && data.heatmap) || [];
        const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
        let max = 0;
        cells.forEach((c) => {
          const v = c.value || 0; const wd = c.weekDay != null ? c.weekDay : c.weekday;
          if (wd >= 0 && wd < 7 && c.hour >= 0 && c.hour < 24) { grid[wd][c.hour] = v; if (v > max) max = v; }
        });
        return { grid, max };
      }, [data]);
      const wdNames = W.t.weekdaysShort;
      const hmAlpha = (v) => (v > 0 ? Math.max(0.14, hm.max > 0 ? v / hm.max : 0) : 0.08);

      // ---- 分类条形（最大余数法） ----
      const catShare = useMemo(() => {
        const list = ((data && data.categoryShare) || []).slice();
        const total = list.reduce((s, c) => s + (c.notesCount || 0), 0);
        if (!total) return [];
        const floors = list.map((c) => Math.floor(((c.notesCount || 0) / total) * 100));
        let rest = 100 - floors.reduce((s, v) => s + v, 0);
        const order = list.map((c, i) => ({ i, r: ((c.notesCount || 0) / total) * 100 - floors[i] })).sort((a, b) => b.r - a.r);
        const pcts = floors.slice();
        for (let j = 0; rest > 0 && j < order.length; j = (j + 1) % order.length) { pcts[order[j].i] += 1; rest -= 1; }
        const maxN = Math.max(...list.map((c) => c.notesCount || 0), 1);
        return list.map((c, i) => ({ ...c, pct: pcts[i], w: (c.notesCount || 0) / maxN }));
      }, [data]);

      // ---- 作者云 ----
      const authors = (data && data.authorCloud) || [];
      const aMax = Math.max(...authors.map((a) => a.count || 0), 1);
      const aMin = Math.min(...authors.map((a) => a.count || 0), 0);
      const aMap = (v, lo, hi) => (aMax === aMin ? hi : lo + ((v - aMin) / (aMax - aMin)) * (hi - lo));

      // ---- 雷达 ----
      const radarData = useMemo(() => {
        const all = ((data && data.categoryRadar) || []).filter((c) => (c.level || 1) === radarLevel);
        return all.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 8);
      }, [data, radarLevel]);
      const RW = 300, RH = 240, RCX = RW / 2, RCY = RH / 2 + 6, RR = 88;
      const radarMax = Math.max(...radarData.map((c) => c.count || 0), 1);
      const rAng = (i, n) => (n <= 0 ? 0 : -Math.PI / 2 + (i * 2 * Math.PI) / n);
      const rPt = (i, n, r) => ({ x: RCX + Math.cos(rAng(i, n)) * r, y: RCY + Math.sin(rAng(i, n)) * r });
      const rPoly = (n, r) => Array.from({ length: n }, (_, i) => rPt(i, n, r)).map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');

      // ---- 散点 ----
      const SW = 760, SH = 250, SP = { l: 46, r: 16, t: 14, b: 30 };
      const scatter = (data && data.scatter) || [];
      const sMaxX = Math.max(...scatter.map((p) => p.readingTime || 0), 10);
      const sMaxY = Math.max(...scatter.map((p) => p.noteDensity || 0), 1);
      const sMedX = useMemo(() => { const a = scatter.map((p) => p.readingTime || 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; }, [data]);
      const sMedY = useMemo(() => { const a = scatter.map((p) => p.noteDensity || 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; }, [data]);
      const sx = (v) => SP.l + ((v / (Math.ceil(sMaxX / 5) * 5)) * (SW - SP.l - SP.r));
      const sy = (v) => SH - SP.b - ((v / (Math.ceil(sMaxY / 5) * 5)) * (SH - SP.t - SP.b));
      const sMaxX5 = Math.ceil(sMaxX / 5) * 5, sMaxY5 = Math.ceil(sMaxY / 5) * 5;
      const quadOf = (p) => {
        if (p.quadrant) return p.quadrant;
        const hiT = (p.readingTime || 0) >= sMedX, hiD = (p.noteDensity || 0) >= sMedY;
        return hiT && hiD ? 'high_value' : hiD ? 'high_density' : hiT ? 'high_time' : 'low_value';
      };
      const quadFill = { high_value: '#3fb950', high_density: '#d29922', high_time: '#4f8cff', low_value: 'var(--dsw-alias-label-secondary)' };

      const timeline = (data && data.timeline) || [];
      const topBooks = (data && data.topBooks) || [];
      const typeBadge = { '划线+想法': W.t.typeBoth, 想法: W.t.typeThought, 划线: W.t.typeHighlight, 笔记: W.t.typeNote };

      const kpis = [
        { l: W.t.kpiActiveDays, v: fmt(k.activeDays, W.t.unitDays) },
        { l: W.t.kpiStreak, v: fmt(k.longestStreakDays, W.t.unitDays) },
        { l: W.t.kpiTotalNotes, v: fmt(totalNotes !== 0 ? totalNotes : k.totalNotes) },
        { l: W.t.kpiDensity, v: fmt(k.noteDensityPer100Pages, W.t.unitPer100Pages) },
        { l: W.t.kpiDeepRatio, v: fmt(k.deepNoteRatio, '%') },
        { l: W.t.kpiAvgCompletion, v: fmt(k.averageCompletionRate, '%') },
        { l: W.t.kpiAvgNotes, v: fmt(k.averageNotesPerBook) },
      ];

      const info = (text) => h('i', { className: 'wr-info', onMouseEnter: (e) => showTip(e, text), onMouseLeave: hideTip }, 'i');

      return h('div', null,
        h('div', { ref: tipHostRef }),
        // v1.3 官方阅读统计区（置顶；未绑 Key 显示引导行）
        h(W.OfficialStats, { gatewayEnabled, __stats }),
        // 筛选区
        h('div', { className: 'wr-toolbar' },
          h('select', { className: 'wr-select', value: filters.days, onChange: (e) => sel({ days: Number(e.target.value) }) },
            h('option', { value: 0 }, W.t.allData), h('option', { value: 7 }, W.t.optLastDays(7)), h('option', { value: 30 }, W.t.optLastDays(30)), h('option', { value: 90 }, W.t.optLastDays(90))),
          h('select', { className: 'wr-select', value: filters.category, onChange: (e) => sel({ category: e.target.value }) },
            h('option', { value: '' }, W.t.allCategories),
            cats.map((c) => h('option', { key: c, value: c }, c === '未分类' ? W.t.uncategorized : c))),
          h('select', { className: 'wr-select', value: filters.noteType, onChange: (e) => sel({ noteType: e.target.value }) },
            h('option', { value: 'all' }, W.t.allNoteTypes), h('option', { value: 'highlight' }, W.t.onlyHighlights), h('option', { value: 'thought' }, W.t.onlyThoughts), h('option', { value: 'chapter' }, W.t.onlyChapterNotes), h('option', { value: 'review' }, W.t.onlyReviews)),
          h('select', { className: 'wr-select', value: filters.granularity, onChange: (e) => sel({ granularity: e.target.value }) },
            h('option', { value: 'day' }, W.t.trendByDay), h('option', { value: 'week' }, W.t.trendByWeek)),
          h('label', { className: 'wr-badge', style: { cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h('input', { type: 'checkbox', checked: !!filters.finishedOnly, onChange: (e) => sel({ finishedOnly: e.target.checked }) }), W.t.finishedOnlyLabel),
          h('button', { className: 'wr-btn wr-btn-primary', disabled: exporting || loading, onClick: exportReport }, exporting ? W.t.exporting : W.t.exportReport),
          reportPath && h('button', { className: 'wr-btn', onClick: copyAiPrompt, title: W.t.aiReadTip(reportPath) }, W.t.aiRead),
          data?.goal && h('span', {
            className: 'wr-badge' + (data.goal.achieved ? ' wr-rm-reviewtag' : ''),
            style: data.goal.achieved ? {} : { opacity: 0.9 },
            title: W.t.goalTip(data.goal.weeklyGoalNotes),
          }, W.t.goalThisWeek(data.goal.thisWeekNotes, data.goal.weeklyGoalNotes) + (data.goal.streakWeeks > 0 ? W.t.goalStreakWeeks(data.goal.streakWeeks) : '')),
        ),
        // 状态横幅
        loading ? h('div', { className: 'wr-ins-banner' }, h('span', { className: 'wr-spin' }), W.t.insightsLoading)
          : error ? h('div', { className: 'wr-ins-banner wr-ins-banner-warn' }, W.t.loadFailed + '：' + error)
            : !data || (!totalNotes && !k.totalNotes && !trend.length) ? h('div', { className: 'wr-ins-banner' }, !loggedIn
              ? h('span', null, W.t.notLoggedInPrefix, h('button', {
                  className: 'wr-btn wr-btn-primary', style: { marginLeft: 8 },
                  onClick: () => { try { window.dispatchEvent(new CustomEvent('weread:open-login')); } catch { /* ignore */ } },
                }, W.t.goLogin), W.t.loginSyncHint)
              : h('span', null, W.t.noInsightData, filters.days !== 0 && h('span', null, W.t.noInsightDataHint)))
              : h('div', { className: 'wr-ins-banner' + (data.degraded ? ' wr-ins-banner-warn' : '') },
                W.t.insightsLoaded(daysLabel, fmt(totalNotes || k.totalNotes), fmt(coveredBooks))),
        // KPI
        h('div', { className: 'wr-kpis' }, kpis.map((kpi, i) => h('div', { className: 'wr-kpi', key: i }, h('div', { className: 'wr-kpi-v' }, kpi.v), h('div', { className: 'wr-kpi-l' }, kpi.l)))),
        // 趋势 + Top10
        h('div', { className: 'wr-grid2' },
          h('div', { className: 'wr-sec' },
            h('div', { className: 'wr-sec-t' }, W.t.trendTitle,
              h('span', { className: 'wr-legend' },
                h('button', { className: 'wr-legend-pill' + (showNotes ? '' : ' wr-legend-off'), style: { '--dot': '#4f8cff' }, onClick: () => setShowNotes((v) => !v) }, W.t.legendNotes),
                h('button', { className: 'wr-legend-pill' + (showActive ? '' : ' wr-legend-off'), style: { '--dot': '#3fb950' }, onClick: () => setShowActive((v) => !v) }, W.t.legendActive))),
            !showNotes && !showActive ? h('div', { className: 'wr-empty', style: { padding: '24px 0' } }, W.t.legendAllOff) :
              h('div', { className: 'wr-chart-wrap' },
                h('svg', { viewBox: '0 0 ' + TW + ' ' + TH },
                  [0, 1, 2, 3, 4].map((i) => {
                    const v = (gridMax / 4) * i;
                    return h('g', { key: 'g' + i },
                      h('line', { x1: TP.l, x2: TW - TP.r, y1: ty(v), y2: ty(v), stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 1 }),
                      h('text', { x: TP.l - 6, y: ty(v) + 3, textAnchor: 'end', fontSize: 9, fill: 'var(--dsw-alias-label-secondary)' }, Math.round(v)));
                  }),
                  xLabels.map((l) => h('text', { key: 'x' + l.i, x: tx(l.i), y: TH - 6, textAnchor: 'middle', fontSize: 9, fill: 'var(--dsw-alias-label-secondary)' }, l.t)),
                  showActive && h('path', { d: lineOf('touchedBooks'), fill: 'none', stroke: '#3fb950', strokeWidth: 1.6 }),
                  showNotes && h('path', { d: lineOf('notesCount'), fill: 'none', stroke: '#4f8cff', strokeWidth: 1.8 }),
                  showActive && trend.map((p, i) => h('circle', { key: 'a' + i, cx: tx(i), cy: ty(p.touchedBooks || 0), r: 2.5, fill: '#3fb950' },
                    h('title', null, mmdd(p.date) + W.t.tipTouched(p.touchedBooks || 0)))),
                  showNotes && trend.map((p, i) => h('circle', {
                    key: 'n' + i, cx: tx(i), cy: ty(p.notesCount || 0), r: 2.5, fill: '#4f8cff',
                    onMouseEnter: (e) => showTip(e, W.esc(mmdd(p.date) + W.t.tipNotesFull(p.notesCount || 0, p.touchedBooks || 0))),
                    onMouseLeave: hideTip,
                  }, h('title', null, mmdd(p.date) + W.t.tipNotesOnly(p.notesCount || 0)))),
                ))),
          h('div', { className: 'wr-sec' },
            h('div', { className: 'wr-sec-t' }, W.t.topBooksTitle),
            h('table', { className: 'wr-tbl' },
              h('thead', null, h('tr', null, h('th', null, W.t.thBook), h('th', null, W.t.thNotes), h('th', null, W.t.thCompletion), h('th', null, h('span', null, W.t.thDeepRatio), info(W.t.tipDeepRatio)), h('th', null, h('span', null, W.t.thValue), info(W.t.tipValueScore)))),
              h('tbody', null, topBooks.map((b, i) => h('tr', { key: b.bookId || i },
                h('td', { className: 'wr-tbl-book', title: b.title, onClick: () => onNavigate && onNavigate('detail', { bookId: b.bookId }) }, b.title || b.bookId),
                h('td', null, fmt(b.notesCount)),
                h('td', null, fmt(b.completionRate, '%')),
                h('td', null, fmt(b.deepNoteRatio, '%')),
                h('td', null, fmt(b.valueScore))))),
              !topBooks.length && h('tbody', null, h('tr', null, h('td', { colSpan: 5, className: 'wr-muted' }, W.t.noData)))))),
        // 时间线
        h('div', { className: 'wr-sec', style: { marginBottom: 12 } },
          h('div', { className: 'wr-sec-t' }, W.t.timelineTitle),
          timeline.length ? h('div', { className: 'wr-tl' }, timeline.map((n, i) => {
            const body = [n.highlightText, n.thoughtText].filter(Boolean).join('\n') || W.t.noTextContent;
            // v1.8.15：笔记类型由正文纯文本前缀改为 meta 行内徽标（时间 · 书名 · [类型徽标] · 章节）；
            // 创建时间未知（createdAt=0，web 通道新管线划线）不显示时间，不再以同步时间冒充
            const typeLabel = typeBadge[n.noteType] || n.noteType || '';
            const typeCls = { '划线': ' wr-tl-type-hl', '想法': ' wr-tl-type-th', '划线+想法': ' wr-tl-type-both' }[n.noteType] || '';
            const metaParts = [
              n.createdAt > 0 ? W.fmtDateTime(n.createdAt) : '',
              n.bookTitle || '',
              typeLabel ? h('span', { className: 'wr-tl-type' + typeCls }, typeLabel) : '',
              n.chapterTitle || '',
            ];
            const metaChildren = [];
            for (const p of metaParts) { if (!p) continue; if (metaChildren.length) metaChildren.push(' · '); metaChildren.push(p); }
            return h('div', { className: 'wr-tl-item', key: n.noteId || i },
              h('div', { className: 'wr-tl-meta' }, ...metaChildren),
              h('div', { className: 'wr-tl-body', style: { whiteSpace: 'pre-wrap' } }, body));
          })) : h('div', { className: 'wr-muted', style: { padding: '12px 0' } }, W.t.noData)),
        // 热力图 + 分类
        h('div', { className: 'wr-grid2w' },
          h('div', { className: 'wr-sec' },
            h('div', { className: 'wr-sec-t' }, W.t.heatmapTitle),
            h('div', { className: 'wr-hm' },
              wdNames.map((w, d) => h(W.React.Fragment, { key: d },
                h('span', { className: 'wr-hm-lab' }, w),
                ...Array.from({ length: 24 }, (_, hr) => {
                  const v = hm.grid[d][hr];
                  return h('div', {
                    key: hr, className: 'wr-hm-cell',
                    style: { background: 'rgba(79,140,255,' + hmAlpha(v).toFixed(2) + ')' },
                    title: w + ' ' + String(hr).padStart(2, '0') + ':00 · ' + v,
                  });
                }))),
              h('div', { className: 'wr-hm-axis' }, ['0:00', '6:00', '12:00', '18:00', '24:00'].map((t) => h('span', { key: t }, t))))),
          h('div', { className: 'wr-sec' },
            h('div', { className: 'wr-sec-t' }, W.t.categoryShareTitle),
            catShare.length ? catShare.map((c, i) => h('div', { className: 'wr-bar-row', key: i },
              h('span', { className: 'wr-bar-name', title: c.category }, c.category || W.t.uncategorized),
              h('div', { className: 'wr-bar-track' }, h('div', { className: 'wr-bar-fill', style: { width: (c.w * 100).toFixed(1) + '%' } })),
              h('span', { className: 'wr-bar-val' }, c.pct + '% (' + (c.notesCount || 0) + ')'))) : h('div', { className: 'wr-muted' }, W.t.noData))),
        // 作者云 + 雷达
        h('div', { className: 'wr-grid2w' },
          h('div', { className: 'wr-sec' },
            h('div', { className: 'wr-sec-t' }, W.t.authorCloudTitle),
            authors.length ? h('div', { className: 'wr-cloud' }, authors.map((a, i) => h('span', {
              key: i, title: W.t.authorReadCount(a.count || 0),
              style: { fontSize: aMap(a.count || 0, 12, 32).toFixed(0) + 'px', opacity: aMap(a.count || 0, 0.4, 1).toFixed(2) },
            }, a.author || a.name))) : h('div', { className: 'wr-muted' }, W.t.noData)),
          h('div', { className: 'wr-sec' },
            h('div', { className: 'wr-sec-t' }, W.t.radarTitle,
              h('button', { className: 'wr-lvl-btn' + (radarLevel === 1 ? ' wr-lvl-btn-on' : ''), onClick: () => setRadarLevel(1) }, W.t.level1),
              h('button', { className: 'wr-lvl-btn' + (radarLevel === 2 ? ' wr-lvl-btn-on' : ''), onClick: () => setRadarLevel(2) }, W.t.subLevel)),
            radarData.length < 3 ? h('div', { className: 'wr-muted', style: { padding: '24px 0', textAlign: 'center' } }, W.t.radarTooFew)
              : h('div', { className: 'wr-chart-wrap' },
                h('svg', { viewBox: '0 0 ' + RW + ' ' + RH },
                  [1, 2, 3, 4, 5].map((r) => h('polygon', { key: r, points: rPoly(radarData.length, (RR * r) / 5), fill: 'none', stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 1 })),
                  radarData.map((_, i) => { const p = rPt(i, radarData.length, RR); return h('line', { key: 'ax' + i, x1: RCX, y1: RCY, x2: p.x, y2: p.y, stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 1 }); }),
                  h('polygon', {
                    points: radarData.map((c, i) => { const p = rPt(i, radarData.length, RR * ((c.count || 0) / radarMax)); return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' '),
                    fill: 'rgba(79,140,255,.25)', stroke: '#4f8cff', strokeWidth: 1.6,
                  }),
                  radarData.map((c, i) => { const p = rPt(i, radarData.length, RR * ((c.count || 0) / radarMax)); return h('circle', { key: 'pt' + i, cx: p.x, cy: p.y, r: 2.5, fill: '#4f8cff' }, h('title', null, W.t.radarCount(c.category || '', c.count || 0))); }),
                  radarData.map((c, i) => {
                    const p = rPt(i, radarData.length, RR + 16);
                    const anchor = Math.abs(p.x - RCX) < 12 ? 'middle' : p.x > RCX ? 'start' : 'end';
                    return h('text', { key: 'lb' + i, x: p.x, y: p.y + 3, textAnchor: anchor, fontSize: 10, fill: 'var(--dsw-alias-label-secondary)' }, c.category || '');
                  }))))),
        // 散点
        h('div', { className: 'wr-sec' },
          h('div', { className: 'wr-sec-t' }, W.t.scatterTitle),
          scatter.length ? h('div', { className: 'wr-chart-wrap' },
            h('svg', { viewBox: '0 0 ' + SW + ' ' + SH },
              [0, 1, 2, 3, 4, 5].map((i) => h('g', { key: 'gx' + i },
                h('line', { x1: sx((sMaxX5 / 5) * i), x2: sx((sMaxX5 / 5) * i), y1: SP.t, y2: SH - SP.b, stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 1 }),
                h('text', { x: sx((sMaxX5 / 5) * i), y: SH - 10, textAnchor: 'middle', fontSize: 9, fill: 'var(--dsw-alias-label-secondary)' }, Math.round((sMaxX5 / 5) * i)))),
              [0, 1, 2, 3, 4, 5].map((i) => h('g', { key: 'gy' + i },
                h('line', { x1: SP.l, x2: SW - SP.r, y1: sy((sMaxY5 / 5) * i), y2: sy((sMaxY5 / 5) * i), stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 1 }),
                h('text', { x: SP.l - 6, y: sy((sMaxY5 / 5) * i) + 3, textAnchor: 'end', fontSize: 9, fill: 'var(--dsw-alias-label-secondary)' }, Math.round((sMaxY5 / 5) * i)))),
              sMedX > 0 && h('line', { x1: sx(sMedX), x2: sx(sMedX), y1: SP.t, y2: SH - SP.b, stroke: 'var(--dsw-alias-label-secondary)', strokeDasharray: '4 4', strokeWidth: 1 }),
              sMedY > 0 && h('line', { x1: SP.l, x2: SW - SP.r, y1: sy(sMedY), y2: sy(sMedY), stroke: 'var(--dsw-alias-label-secondary)', strokeDasharray: '4 4', strokeWidth: 1 }),
              h('text', { x: SP.l + 46, y: SH - 34, fontSize: 10, fill: 'var(--dsw-alias-label-secondary)' }, W.t.axisMinutes),
              h('text', { x: 14, y: SP.t + 20, fontSize: 10, fill: 'var(--dsw-alias-label-secondary)' }, W.t.axisDensity),
              h('rect', { x: sx(sMedX), y: SP.t, width: Math.max(0, SW - SP.r - sx(sMedX)), height: Math.max(0, sMedY > 0 ? sy(sMedY) - SP.t : 0), fill: 'rgba(63,185,80,.08)' }),
              h('text', { x: SW - SP.r - 8, y: sMedY > 0 ? sy(sMedY) + 16 : SP.t + 16, textAnchor: 'end', fontSize: 10, fill: '#3fb950' }, W.t.highValueZone),
              scatter.map((p, i) => h('circle', {
                key: i, className: 'wr-sc-pt', cx: sx(p.readingTime || 0), cy: sy(p.noteDensity || 0), r: 4,
                fill: quadFill[quadOf(p)] || 'var(--dsw-alias-label-secondary)', fillOpacity: 0.8,
                onMouseEnter: (e) => showTip(e, W.esc(W.t.scatterTip(p.title || '', Math.round(p.readingTime || 0), p.noteDensity || 0))),
                onMouseLeave: hideTip,
                onClick: () => onNavigate && onNavigate('detail', { bookId: p.bookId }),
              }, h('title', null, (p.title || '') + ' · ' + Math.round(p.readingTime || 0) + 'min · ' + (p.noteDensity || 0))))),
          ) : h('div', { className: 'wr-muted', style: { padding: '12px 0' } }, W.t.noData)),
      );
    };
