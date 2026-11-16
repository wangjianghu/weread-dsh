    // ---------- 40-roaming：笔记漫游 ----------
    W.CSS_40 = `
.wr-rm-root{display:flex;flex-direction:column;height:100%;min-height:0}
.wr-rm-top{flex:none;display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wr-rm-title{font-size:15px;font-weight:700;background:linear-gradient(90deg,#4f8cff,#3fb950);-webkit-background-clip:text;background-clip:text;color:transparent}
.wr-ring{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.wr-rm-actions{margin-left:auto;display:flex;gap:6px;position:relative}
.wr-rm-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:60;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.25);width:280px}
.wr-rm-pop::before{content:'';position:absolute;top:-5px;right:24px;width:8px;height:8px;background:inherit;border-left:1px solid var(--dsw-alias-border-l2);border-top:1px solid var(--dsw-alias-border-l2);transform:rotate(45deg)}
.wr-rm-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.wr-rm-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px}
.wr-rm-stat-v{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary)}
.wr-rm-stat-l{font-size:10px;color:var(--dsw-alias-label-secondary)}
.wr-rm-filters{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wr-rm-pill{padding:2px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px}
.wr-rm-pill:hover{color:var(--dsw-alias-label-primary)}
.wr-rm-pill-on{border-color:#3fb950;background:rgba(63,185,80,.12);color:#3fb950;font-weight:600}
.wr-rm-sep{width:1px;height:18px;background:var(--dsw-alias-border-l2)}
.wr-rm-cardzone{flex:1;min-height:0;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:22px 16px}
.wr-note-card{position:relative;width:100%;max-width:560px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:18px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:22px 26px 14px;animation:wr-card-in .45s cubic-bezier(0.22,1,0.36,1) both}
@keyframes wr-card-in{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
.wr-card-grad{position:absolute;top:0;left:0;right:0;height:3px;border-radius:18px 18px 0 0;background:linear-gradient(90deg,#4f8cff,#3fb950,#d29922)}
.wr-quote-line{position:absolute;left:10px;top:44px;bottom:44px;width:3px;border-radius:2px;background:#4f8cff;opacity:.55;display:none}
.wr-quote-line-on{display:block}
.wr-corner-fav{position:absolute;top:12px;right:14px;font-size:20px;cursor:pointer;color:var(--dsw-alias-label-secondary);line-height:1;user-select:none}
.wr-corner-fav-on{color:#e5c07b;text-shadow:0 0 8px rgba(229,192,123,.6)}
.wr-fav-pulse{animation:wr-fav-pulse .6s ease both}
@keyframes wr-fav-pulse{40%{transform:scale(1.35) rotate(18deg)}100%{transform:none}}
.wr-rm-header{display:flex;align-items:baseline;gap:8px;padding-right:30px}
.wr-rm-book{font-weight:700;font-size:14px;color:var(--dsw-alias-label-primary)}
.wr-rm-author{font-size:12px;color:var(--dsw-alias-label-secondary)}
.wr-rm-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 0;margin-top:6px}
.wr-rm-body{font-size:14px;line-height:1.7;color:var(--dsw-alias-label-primary);white-space:pre-wrap;max-height:300px;overflow:auto;padding:12px 4px 12px 0}
.wr-rm-body::-webkit-scrollbar{width:6px}
.wr-rm-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:3px}
.wr-rm-foot{display:flex;gap:8px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}
.wr-rm-tag{font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.wr-rm-tag-ok{color:#3fb950;border-color:rgba(63,185,80,.5)}
.wr-rm-tag-fav{color:#e5c07b;border-color:rgba(229,192,123,.5)}
.wr-rm-burst{position:absolute;top:12px;right:14px;width:20px;height:20px;pointer-events:none}
.wr-rm-burst i{position:absolute;left:8px;top:8px;color:#e5c07b;font-style:normal;font-size:13px;animation:wr-burst .8s ease-out both}
@keyframes wr-burst{from{opacity:1;transform:translate(0,0) scale(.6)}to{opacity:0;transform:translate(var(--dx),var(--dy)) scale(1.3)}}
.wr-rm-bottom{flex:none;border-top:1px solid var(--dsw-alias-border-l1);padding:8px 16px}
.wr-rm-keys{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.wr-rm-keys b{color:var(--dsw-alias-label-primary);font-weight:600}
.wr-rm-keys .sec{opacity:.75}
.wr-rm-actbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wr-rm-idx{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:64px;text-align:center}
.wr-rm-favbtn-on{border-color:#e5c07b;color:#e5c07b}
.wr-rm-revbtn-on{border-color:#3fb950;color:#3fb950}
.wr-rm-duebtn{border-color:#3fb950;color:#3fb950}
.wr-rm-duebtn:hover{background:rgba(63,185,80,.12)}
.wr-rm-reviewtag{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#3fb950;border:1px solid rgba(63,185,80,.45);border-radius:6px;padding:2px 8px}
.wr-rm-reviewtag b{font-size:13px}
.wr-rm-goodbtn{border-color:#3fb950;color:#3fb950}
.wr-rm-goodbtn:hover{background:rgba(63,185,80,.12)}
.wr-rm-forgotbtn{border-color:#d29922;color:#d29922}
.wr-rm-forgotbtn:hover{background:rgba(210,153,34,.12)}
.wr-rm-export{display:flex;gap:16px;max-width:680px}
.wr-rm-preview{flex:none;width:400px;max-width:55%}
.wr-rm-preview img{width:100%;height:auto;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 16px rgba(0,0,0,.18)}
.wr-rm-setting{display:flex;flex-direction:column;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:180px}
.wr-rm-themes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.wr-rm-swatch{width:100%;aspect-ratio:1;border-radius:6px;border:2px solid transparent;cursor:pointer}
.wr-rm-swatch-on{border-color:var(--dsw-alias-brand-primary)}
`;

    // ---- Canvas 导出（移植 noteRoamingView generateExportDataUrl） ----
    W.RM_THEMES_DEFAULT = [
      { id: 'white', name: '纯白', bg: '#FFFFFF', primary: '#312927', weekday: '#5A514D', divider: '#D5CEC4', watermark: '#757575' },
      { id: 'gray', name: '浅灰', bg: '#F5F5F5', primary: '#312927', weekday: '#5A514D', divider: '#D5CEC4', watermark: '#757575' },
      { id: 'yellow', name: '暖黄', bg: '#FDF6E3', primary: '#382C24', weekday: '#5C4A3D', divider: '#E6D3B8', watermark: '#8C7765' },
      { id: 'green', name: '浅绿', bg: '#EAF4EC', primary: '#1E3624', weekday: '#3D5C45', divider: '#C2DBC7', watermark: '#6F8C76' },
      { id: 'dark', name: '暗夜黑', bg: '#1E1E1E', primary: '#E0E0E0', weekday: '#B0B0B0', divider: '#404040', watermark: '#808080' },
      { id: 'blue', name: '深蓝', bg: '#1A2332', primary: '#DDE2ED', weekday: '#A9B4C7', divider: '#34415B', watermark: '#7887A1' },
      { id: 'pink', name: '莫兰迪粉', bg: '#F6EBEA', primary: '#4A3130', weekday: '#6B4A49', divider: '#E0CACA', watermark: '#9C7A79' },
      { id: 'kraft', name: '牛皮纸', bg: '#E8DCC8', primary: '#3B2F23', weekday: '#594A3A', divider: '#C9B8A1', watermark: '#8A7B68' },
    ];
    const RM_CR = String.fromCharCode(13);
    const RM_LF = String.fromCharCode(10);
    const RM_LEAD_PUNCT = /^[\s'".,;!?…、，。；！？“”‘’]/;
    const RM_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const RM_WEEKS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

    function rmFmtExportDateParts(secOrMs) {
      const value = Number(secOrMs || 0);
      const ms = value > 1000000000000 ? value : value * 1000;
      const date = ms > 0 ? new Date(ms) : new Date();
      return {
        day: String(date.getDate()).padStart(2, '0'),
        monthYear: (RM_MONTHS[date.getMonth()] || 'JAN') + ' ' + date.getFullYear(),
        week: (W.t.weekdaysLong || RM_WEEKS)[date.getDay()] || '',
        isoDate: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'),
      };
    }
    function rmNormalizeText(raw) {
      return String(raw || '').split(RM_CR + RM_LF).join(RM_LF).split(RM_CR).join(RM_LF).trim();
    }
    function rmWrapNoteLines(text, charsPerLine) {
      const normalized = rmNormalizeText(text);
      if (!normalized) return [];
      const paras = normalized.split(RM_LF).filter((p) => p.length > 0);
      const lines = [];
      const max = Math.max(1, Number(charsPerLine) || 18);
      for (let pi = 0; pi < paras.length; pi++) {
        const chars = Array.from(paras[pi]);
        let lineStart = 0;
        while (lineStart < chars.length) {
          let lineEnd = Math.min(lineStart + max, chars.length);
          if (lineEnd < chars.length) {
            const nextChar = chars[lineEnd];
            if (RM_LEAD_PUNCT.test(nextChar)) {
              lineEnd = Math.max(lineStart + 1, lineEnd - 1);
            }
          }
          const line = chars.slice(lineStart, lineEnd).join('');
          if (line) lines.push(line);
          if (lineEnd >= chars.length) break;
          lineStart = lineEnd;
        }
      }
      return lines;
    }
    function rmWrapTitleLines(title, maxChars, maxLines) {
      const t = String(title || '').trim();
      if (!t) return [];
      const chars = Array.from(t);
      const limit = Math.max(1, Number(maxChars) || 22);
      const out = [];
      let i = 0;
      while (i < chars.length && out.length < maxLines) {
        out.push(chars.slice(i, i + limit).join(''));
        i += limit;
      }
      if (i < chars.length && out.length > 0) {
        const last = out[out.length - 1];
        const lastChars = Array.from(last);
        out[out.length - 1] = lastChars.length > 1 ? lastChars.slice(0, lastChars.length - 1).join('') + '…' : '…';
      }
      return out;
    }
    function rmDisplayAuthor(value) {
      const text = String(value || '').trim();
      if (!text || text === '未分类' || text === '未分类章节') return '';
      return text;
    }
    function rmGenerateExportDataUrl(card, theme, timeType) {
      if (!card) return '';
      try {
        const targetTime = timeType === 'share' ? Date.now() : card.createTime;
        const dateParts = rmFmtExportDateParts(targetTime);
        const COLORS = theme || W.RM_THEMES_DEFAULT[0];
        const CARD_W = 400;
        const SCALE = 3;
        const PAD_TOP = 50;
        const PAD_BOTTOM = 50;
        const CHARS_PER_LINE = 18;
        const FONT_STACK = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        const DAY_FONT = '800 110px ' + FONT_STACK;
        const MONTH_FONT = '700 22px ' + FONT_STACK;
        const WEEK_FONT = '400 13px ' + FONT_STACK;
        const BODY_FONT = '400 17px ' + FONT_STACK;
        const BODY_LINE_HEIGHT = 34;
        const TITLE_FONT = '400 15px ' + FONT_STACK + ', serif';
        const TITLE_LINE_STEP = 24;
        const AUTHOR_FONT = '400 13px ' + FONT_STACK;
        const AUTHOR_LINE_STEP = 20;
        const FOOTER_FONT = '400 12px ' + FONT_STACK;
        const GAP_DAY_MONTH_BASELINE = 30;
        const GAP_MONTH_WEEK = 12;
        const MONTH_LINE_HEIGHT = 28;
        const GAP_WEEK_DIVIDER = 20;
        const GAP_DIVIDER_BODY = 40;
        const GAP_BODY_TITLE = 35;
        const GAP_TITLE_AUTHOR = 18;
        const GAP_AUTHOR_FOOTER = 40;
        const DIVIDER_HALF_W = 24;

        const contentText = String(card.rawText || card.text || card.content || '').trim();
        const bodyLines = rmWrapNoteLines(contentText, CHARS_PER_LINE);
        const bookTitleRaw = String(card.bookTitle || W.t.unnamedBook).trim();
        const bookTitleDisplay = bookTitleRaw.indexOf('《') === 0 ? bookTitleRaw : ('《' + bookTitleRaw + '》');
        const titleLines = rmWrapTitleLines(bookTitleDisplay, CHARS_PER_LINE, 3);
        const noteAuthor = rmDisplayAuthor(card.author || card.bookAuthor);
        const authorLines = rmWrapTitleLines(noteAuthor, CHARS_PER_LINE, 3);

        const dayBaseline = PAD_TOP + 100;
        const monthBaseline = dayBaseline + GAP_DAY_MONTH_BASELINE;
        const weekBaseline = monthBaseline + MONTH_LINE_HEIGHT + GAP_MONTH_WEEK;
        const dividerY = weekBaseline + 5 + GAP_WEEK_DIVIDER;
        const bodyFirstBaseline = dividerY + GAP_DIVIDER_BODY;
        let titleFirstBaseline = bodyFirstBaseline;
        if (bodyLines.length > 0) {
          titleFirstBaseline = bodyFirstBaseline + (bodyLines.length - 1) * BODY_LINE_HEIGHT + GAP_BODY_TITLE;
        } else {
          titleFirstBaseline = bodyFirstBaseline + 22;
        }
        let lastTitleBaseline = titleFirstBaseline;
        if (titleLines.length > 0) {
          lastTitleBaseline = titleFirstBaseline + (titleLines.length - 1) * TITLE_LINE_STEP;
        }
        let firstAuthorBaseline = lastTitleBaseline + (titleLines.length > 0 ? GAP_TITLE_AUTHOR : 8);
        if (!titleLines.length && authorLines.length > 0) firstAuthorBaseline = titleFirstBaseline;
        let lastAuthorBaseline = firstAuthorBaseline;
        if (authorLines.length > 0) {
          lastAuthorBaseline = firstAuthorBaseline + (authorLines.length - 1) * AUTHOR_LINE_STEP;
        } else if (titleLines.length > 0) {
          lastAuthorBaseline = lastTitleBaseline;
        } else {
          lastAuthorBaseline = bodyLines.length > 0 ? bodyFirstBaseline + (bodyLines.length - 1) * BODY_LINE_HEIGHT : bodyFirstBaseline;
        }
        const footerBaseline = lastAuthorBaseline + GAP_AUTHOR_FOOTER;
        const totalH = Math.ceil(footerBaseline + PAD_BOTTOM + 10);

        const canvas = document.createElement('canvas');
        canvas.width = CARD_W * SCALE;
        canvas.height = totalH * SCALE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        ctx.scale(SCALE, SCALE);

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, CARD_W, totalH);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = COLORS.primary;
        ctx.font = DAY_FONT;
        ctx.fillText(dateParts.day, CARD_W / 2, dayBaseline);

        ctx.font = MONTH_FONT;
        ctx.fillText(dateParts.monthYear, CARD_W / 2, monthBaseline);

        ctx.font = WEEK_FONT;
        ctx.fillStyle = COLORS.weekday;
        ctx.fillText(dateParts.week, CARD_W / 2, weekBaseline);

        ctx.strokeStyle = COLORS.divider;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(CARD_W / 2 - DIVIDER_HALF_W, dividerY);
        ctx.lineTo(CARD_W / 2 + DIVIDER_HALF_W, dividerY);
        ctx.stroke();

        ctx.fillStyle = COLORS.primary;
        ctx.font = BODY_FONT;
        ctx.textAlign = 'left';
        const textMarginLeft = 40;
        const targetTextWidth = CARD_W - textMarginLeft * 2;
        let drawY = bodyFirstBaseline;
        for (let i = 0; i < bodyLines.length; i++) {
          if (i > 0) drawY += BODY_LINE_HEIGHT;
          const line = bodyLines[i];
          const isLastInParagraph = i === bodyLines.length - 1 || bodyLines[i + 1].length < CHARS_PER_LINE;
          if (!isLastInParagraph && line.length > 1) {
            const words = Array.from(line);
            const totalWidth = ctx.measureText(line).width;
            const extraSpace = targetTextWidth - totalWidth;
            const spacePerWord = extraSpace / (words.length - 1);
            let currentX = textMarginLeft;
            for (let j = 0; j < words.length; j++) {
              ctx.fillText(words[j], currentX, drawY);
              currentX += ctx.measureText(words[j]).width + spacePerWord;
            }
          } else {
            ctx.fillText(line, textMarginLeft, drawY);
          }
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.weekday;
        ctx.font = TITLE_FONT;
        drawY = titleFirstBaseline;
        for (let ti = 0; ti < titleLines.length; ti++) {
          if (ti > 0) drawY += TITLE_LINE_STEP;
          ctx.fillText(titleLines[ti], CARD_W / 2, drawY);
        }

        ctx.font = AUTHOR_FONT;
        if (authorLines.length > 0) {
          drawY = firstAuthorBaseline;
          for (let ai = 0; ai < authorLines.length; ai++) {
            if (ai > 0) drawY += AUTHOR_LINE_STEP;
            ctx.fillText(authorLines[ai], CARD_W / 2, drawY);
          }
        }

        ctx.fillStyle = COLORS.watermark;
        ctx.font = FOOTER_FONT;
        ctx.fillText(W.t.panel, CARD_W / 2, footerBaseline);
        return canvas.toDataURL('image/png');
      } catch (err) {
        return '';
      }
    }
    W.rmGenerateExportDataUrl = rmGenerateExportDataUrl;
    W.rmFmtExportDateParts = rmFmtExportDateParts; // v1.4：详情页导图复用（文件名日期）

    W.Roaming = function Roaming({ onNavigate, onToast, themes: themesProp, __session, loggedIn = true }) {
      const { useState, useEffect, useRef, useCallback, useMemo } = W.React;
      const h = W.h;
      // __session 仅供组件冒烟测试注入初始会话；正常路径恒为 undefined
      const [session, setSession] = useState(() => (__session && typeof __session === 'object' ? __session : null));
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [showPop, setShowPop] = useState(false);
      const [popBar, setPopBar] = useState(-1);
      const [burst, setBurst] = useState(0);      // 收藏粒子代次
      const [favPulse, setFavPulse] = useState(0); // 收藏脉冲动画
      const [favBusy, setFavBusy] = useState(false);
      const [exportOpen, setExportOpen] = useState(false);
      const [exportTimeType, setExportTimeType] = useState('create');
      const [exportThemeId, setExportThemeId] = useState(() => (W.detectDark?.() ? 'dark' : 'white'));
      const themeTouched = W.hooks.useRef(false);
      const [themes, setThemes] = useState(() => (Array.isArray(themesProp) && themesProp.length ? themesProp : W.RM_THEMES_DEFAULT));
      const favTimer = useRef(null);
      const rootRef = useRef(null);
      const popRef = useRef(null);      // 数据浮层本体
      const popBtnRef = useRef(null);   // 「数据 (D)」切换按钮

      // 筛选本地态（与后端 filter 对齐）
      const [typeSel, setTypeSel] = useState('all'); // all|highlight|thought|chapter|review
      const [favOnly, setFavOnly] = useState(false);
      const [minDays, setMinDays] = useState(7);

      const applySession = useCallback((res) => {
        setSession(res);
        const f = res.filter || {};
        if (f.noteTypes && f.noteTypes.length === 1) setTypeSel(f.noteTypes[0]);
        else if (!f.noteTypes || !f.noteTypes.length) setTypeSel('all');
        if (typeof f.favoriteOnly === 'boolean') setFavOnly(!!f.favoriteOnly);
        if (f.minDaysUnreviewed != null) setMinDays(f.minDaysUnreviewed);
        if (res.tip && onToast) onToast(res.tip);
      }, [onToast]);

      const load = useCallback(async () => {
        setLoading(true); setError('');
        try { applySession(await W.get('/api/roaming/session')); }
        catch (err) { setError(err.message || String(err)); }
        finally { setLoading(false); }
      }, [applySession]);
      useEffect(() => { load(); }, [load]);

      const act = useCallback(async (action, body) => {
        try {
          const res = await W.post('/api/roaming/action', { action, ...(body || {}) });
          applySession(res);
          return res;
        } catch (err) {
          onToast && onToast(W.t.actionFailed(err.message || err));
          return null;
        }
      }, [applySession, onToast]);

      // v0.3 今日复习：开始/结束/分级（复习模式下评分后自动下一张）
      const startReview = useCallback(() => { act('reviewStart'); }, [act]);
      const endReview = useCallback(() => { act('reviewEnd'); }, [act]);
      const gradeCard = useCallback((grade) => {
        act('review', { grade }).then((res) => {
          if (res && res.reviewMode) act('next');
        });
      }, [act]);
      const reviewMode = !!(session && session.reviewMode);
      const dueCount = (session && session.dueCount) || 0;
      const dueRemaining = (session && session.dueRemaining) || 0;

      const applyFilter = useCallback(async (patch) => {
        try { applySession(await W.post('/api/roaming/filter', patch)); }
        catch (err) { onToast && onToast(W.t.filterFailedToast(err.message || err)); }
      }, [applySession, onToast]);

      const setType = (t) => { setTypeSel(t); applyFilter({ noteTypes: t === 'all' ? null : [t], favoriteOnly: favOnly, minDaysUnreviewed: minDays }); };
      const toggleFavOnly = () => { const v = !favOnly; setFavOnly(v); applyFilter({ noteTypes: typeSel === 'all' ? null : [typeSel], favoriteOnly: v, minDaysUnreviewed: minDays }); };
      const changeDays = (v) => { const n = Math.max(0, Math.floor(Number(v) || 0)); setMinDays(n); };
      const commitDays = () => applyFilter({ noteTypes: typeSel === 'all' ? null : [typeSel], favoriteOnly: favOnly, minDaysUnreviewed: minDays });
      const clearFilter = () => { setTypeSel('all'); setFavOnly(false); setMinDays(7); applyFilter({ noteTypes: null, favoriteOnly: false, minDaysUnreviewed: 7 }); };
      const filterDirty = typeSel !== 'all' || favOnly || minDays !== 7;

      const card = session && session.card;
      const fav = !!(card && card.meta && card.meta.favorite);
      const reviewCount = (card && card.meta && card.meta.reviewCount) || 0;
      const todayReviewed = !!(card && card.meta && card.meta.lastReviewedAt && new Date(card.meta.lastReviewedAt < 1e12 ? card.meta.lastReviewedAt * 1000 : card.meta.lastReviewedAt).toDateString() === new Date().toDateString());
      const idx = (session && session.index) || 0;
      const poolTotal = (session && (session.statsPoolSize || session.poolSize || session.total)) || 0;

      const doFavorite = useCallback(() => {
        if (favBusy || !card) return;
        setFavBusy(true);
        setFavPulse((n) => n + 1);
        if (fav) setBurst((n) => n + 1); // 取消收藏也放射一次反馈
        favTimer.current = setTimeout(async () => {
          await act(fav ? 'unfavorite' : 'favorite');
          if (!fav) setBurst((n) => n + 1);
          setFavBusy(false);
        }, 800);
      }, [act, card, fav, favBusy]);

      const doReview = useCallback(() => {
        if (!card) return;
        if (reviewMode) { gradeCard('good'); return; }
        // 普通模式也可直接分级（v1.0.1：SM-2 评分不依赖复习模式，冷启动即可建立曲线；当日已复过则服务端幂等提示）
        act('review', { grade: 'good' }).then((res) => { if (res) onToast && onToast(res.tip || W.t.reviewMarked); });
      }, [act, card, onToast, reviewMode, gradeCard]);

      const doForgot = useCallback(() => {
        if (!card) return;
        if (reviewMode) { gradeCard('forgot'); return; }
        act('review', { grade: 'forgot' }).then((res) => { if (res) onToast && onToast(res.tip || W.t.reviewRescheduled); });
      }, [act, card, reviewMode, gradeCard]);

      const doOpenSource = useCallback(() => {
        if (!card) return;
        act('openSource');
        onNavigate && onNavigate('detail', { bookId: card.bookId });
      }, [act, card, onNavigate]);

      const next = useCallback(() => { act('next'); }, [act]);
      const prev = useCallback(() => { act('prev'); }, [act]);
      const refresh = useCallback(() => { load(); }, [load]);
      const togglePop = useCallback(() => setShowPop((v) => !v), []);

      // 数据浮层关闭策略（v1.0.4）：点击/聚焦「浮层与数据按钮之外」的任何区域均自动隐藏。
      // v1.0.2/3 的教训：判定基准若是整个漫游面板，点面板内空白/卡片不会关；若只靠 bubble 监听，
      // 宿主 UI 的 stopPropagation 会吞掉事件。故：基准=浮层+切换按钮；事件=捕获阶段（先于目标处理器）。
      useEffect(() => {
        if (!showPop) return undefined;
        const insideAnchor = (target) =>
          (popRef.current && popRef.current.contains(target)) ||
          (popBtnRef.current && popBtnRef.current.contains(target));
        const close = (e) => { if (e.target && !insideAnchor(e.target)) setShowPop(false); };
        const closeAll = () => setShowPop(false);
        document.addEventListener('mousedown', close, true);    // 捕获：任何区域点击（含漫游面板内与宿主 UI）
        document.addEventListener('pointerdown', close, true);  // 捕获兜底
        document.addEventListener('focusin', close);             // 焦点移出浮层（Tab/聚焦输入框）
        window.addEventListener('blur', closeAll);               // 整窗失焦
        return () => {
          document.removeEventListener('mousedown', close, true);
          document.removeEventListener('pointerdown', close, true);
          document.removeEventListener('focusin', close);
          window.removeEventListener('blur', closeAll);
        };
      }, [showPop]);

      // 全局快捷键（弹窗打开时屏蔽；输入框聚焦时忽略）
      useEffect(() => {
        const onKey = (e) => {
          if (exportOpen) {
            if (e.key === 'Escape') { e.preventDefault(); setExportOpen(false); }
            return;
          }
          const t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          const key = e.key.toLowerCase();
          if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
          else if (key === ' ') { e.preventDefault(); doReview(); }
          else if (key === 'x') { e.preventDefault(); doForgot(); }
          else if (key === 'f') { e.preventDefault(); doFavorite(); }
          else if (key === 'o') { e.preventDefault(); doOpenSource(); }
          else if (key === 'e') { e.preventDefault(); doOpenSource(); }
          else if (key === 'i') { e.preventDefault(); setExportOpen(true); }
          else if (key === 'j') { e.preventDefault(); next(); }
          else if (key === 'r') { e.preventDefault(); refresh(); }
          else if (key === 'd') { e.preventDefault(); togglePop(); }
          else if (key === 'escape') { setShowPop(false); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [exportOpen, prev, next, doReview, doForgot, doFavorite, doOpenSource, refresh, togglePop]);

      useEffect(() => () => { if (favTimer.current) clearTimeout(favTimer.current); }, []);

      // 导出预览（实时 Canvas）
      const theme = useMemo(() => themes.find((t) => t.id === exportThemeId) || themes[0] || W.RM_THEMES_DEFAULT[0], [themes, exportThemeId]);
      // C13: 每次打开导图弹窗实时跟随宿主明暗（用户手动选过则尊重选择）
      useEffect(() => {
        if (!exportOpen || themeTouched.current) return;
        setExportThemeId(W.detectDark?.() ? 'dark' : 'white');
      }, [exportOpen]);
      const copyImage = async () => {
        if (!previewUrl) return false;
        try {
          const blob = await (await fetch(previewUrl)).blob();
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          return true;
        } catch (e) { return false; }
      };
      const previewUrl = useMemo(() => (exportOpen && card) ? rmGenerateExportDataUrl(card, theme, exportTimeType) : '', [exportOpen, card, theme, exportTimeType]);
      const doExport = () => {
        if (!card || !previewUrl) { onToast && onToast(W.t.noCardToExport); return; }
        const dateParts = rmFmtExportDateParts(exportTimeType === 'share' ? Date.now() : card.createTime);
        const safeTitle = String(card.bookTitle || W.t.typeNote).trim().replace(/\\/, '_').replace(/[/:*?"<>|]/g, '_').slice(0, 40) || W.t.typeNote;
        const a = document.createElement('a');
        a.href = previewUrl;
        a.download = W.t.exportFileName(safeTitle, dateParts.isoDate);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        onToast && onToast(W.t.exportingImage);
        setExportOpen(false);
      };

      // 进度环
      const ringPct = poolTotal > 0 ? Math.min(1, Math.max(0, idx / poolTotal)) : 0;
      // v1.4.2 进度环缩小（36→22）与顶栏行高协调
      const RING_R = 8;
      const ringArc = ringPct * 2 * Math.PI * RING_R;

      // 数据浮层统计
      const stats = (session && session.stats) || {};
      const favRate = poolTotal > 0 ? Math.round(((stats.favorites || 0) / poolTotal) * 100) : 0;
      const daily = (stats.recentDailyReviews || []).slice(0, 7);
      const dailyMax = Math.max(...daily.map((d) => d.count || 0), 1);

      const typeMeta = {
        thought: { label: W.t.typeThought, icon: (sz) => W.I.chat(sz) },
        highlight: { label: W.t.typeHighlight, icon: (sz) => W.I.pen(sz) },
        chapter: { label: W.t.typeChapter, icon: (sz) => W.I.bookmark(sz) },
        review: { label: W.t.typeReview, icon: (sz) => W.I.doc(sz) },
      };
      const tm = (card && typeMeta[card.noteType]) || { label: W.t.typeNote, icon: (sz) => W.I.book(sz) };
      const authorText = rmDisplayAuthor(card && (card.author || card.bookAuthor));

      const pills = [
        { id: 'all', label: W.t.pillAll }, { id: 'highlight', label: W.t.pillHighlight }, { id: 'thought', label: W.t.typeThought },
        { id: 'chapter', label: W.t.pillChapter }, { id: 'review', label: W.t.typeReview },
      ];

      return h('div', { className: 'wr-rm-root', ref: rootRef },
        // 顶栏
        h('div', { className: 'wr-rm-top' },
          h('span', { className: 'wr-rm-title' }, W.t.roamingTitle),
          h('span', { className: 'wr-ring', title: W.t.ringTip },
            h('svg', { width: 20, height: 20, viewBox: '0 0 20 20' },
              h('circle', { cx: 10, cy: 10, r: RING_R, fill: 'none', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 2.5 }),
              ringArc > 0 && h('circle', { cx: 10, cy: 10, r: RING_R, fill: 'none', stroke: '#3fb950', strokeWidth: 2.5, strokeLinecap: 'round', strokeDasharray: ringArc + ' ' + (2 * Math.PI * RING_R), transform: 'rotate(-90 10 10)' })),
            h('span', null, (session && session.index || 0) + ' / ' + poolTotal)),
          h('div', { className: 'wr-rm-actions' },
            h('button', { className: 'wr-btn', title: W.t.refreshBtn, onClick: refresh }, W.I.refresh(12), ' ', W.t.refreshBtn),
            h('button', { className: 'wr-btn', title: W.t.dataBtnTip, onClick: togglePop, ref: popBtnRef }, W.t.dataBtn),
            showPop && h('div', { className: 'wr-rm-pop', ref: popRef },
              h('div', { className: 'wr-rm-stats' },
                h('div', { className: 'wr-rm-stat' }, h('div', { className: 'wr-rm-stat-v' }, stats.sessionViewed || (session && session.total) || 0), h('div', { className: 'wr-rm-stat-l' }, W.t.statSessionViewed)),
                h('div', { className: 'wr-rm-stat' }, h('div', { className: 'wr-rm-stat-v' }, stats.todayReviewed || 0), h('div', { className: 'wr-rm-stat-l' }, W.t.statTodayReviewed)),
                h('div', { className: 'wr-rm-stat' }, h('div', { className: 'wr-rm-stat-v' }, favRate + '%'), h('div', { className: 'wr-rm-stat-l' }, W.t.statFavRate)),
                h('div', { className: 'wr-rm-stat' }, h('div', { className: 'wr-rm-stat-v' }, poolTotal), h('div', { className: 'wr-rm-stat-l' }, W.t.statPoolSize))),
              h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 } }, W.t.recent7Reviews,
                h('span', { style: { float: 'right' } }, daily.reduce((s, d) => s + (d.count || 0), 0) + W.t.timesUnit)),
              h('svg', { width: '100%', height: 60, viewBox: '0 0 252 60' },
                daily.map((d, i) => {
                  const v = d.count || 0;
                  const bh = v > 0 ? Math.max(4, (v / dailyMax) * 44) : 2;
                  const op = 0.35 + 0.55 * (dailyMax > 0 ? v / dailyMax : 0);
                  return h('g', { key: i, onMouseEnter: () => setPopBar(i), onMouseLeave: () => setPopBar(-1) },
                    h('rect', { x: 6 + i * 36, y: 50 - bh, width: 12, height: bh, rx: 2, fill: '#3fb950', fillOpacity: op }),
                    h('text', { x: 12 + i * 36, y: 59, textAnchor: 'middle', fontSize: 8, fill: 'var(--dsw-alias-label-secondary)' }, d.label || ''),
                    h('title', null, W.t.dailyTip(d.date || '', v)));
                })),
              popBar >= 0 && daily[popBar] && h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } }, W.t.dailyTip(daily[popBar].date || '', daily[popBar].count || 0))))),
        // 筛选栏
        h('div', { className: 'wr-rm-filters' },
          pills.map((p) => h('button', {
            key: p.id, className: 'wr-rm-pill' + (typeSel === p.id ? ' wr-rm-pill-on' : ''), onClick: () => setType(p.id),
          }, p.label)),
          h('button', { className: 'wr-rm-pill' + (favOnly ? ' wr-rm-pill-on' : ''), onClick: toggleFavOnly }, W.t.favorite),
          h('span', { className: 'wr-rm-sep' }),
          h('label', { className: 'wr-small', style: { color: 'var(--dsw-alias-label-secondary)' } }, W.t.unreviewedLabel,
            h('input', { className: 'wr-input', type: 'number', min: 0, style: { minWidth: 56, width: 56 }, value: minDays, onChange: (e) => changeDays(e.target.value), onBlur: commitDays, onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } }), ' ', W.t.days),
          h('span', { style: { flex: 1 } }),
          reviewMode
            ? h('span', { className: 'wr-rm-reviewtag', title: W.t.reviewModeTip }, W.t.reviewModePre, h('b', null, dueRemaining), W.t.reviewModePost)
            : (dueCount > 0 && h('button', { className: 'wr-btn wr-rm-duebtn', onClick: startReview, title: W.t.dueBtnTip }, W.t.dueBtn(dueCount))),
          reviewMode && h('button', { className: 'wr-btn', onClick: endReview }, W.t.endReview),
          filterDirty && h('button', { className: 'wr-btn', onClick: clearFilter }, W.t.clearAll)),
        // 卡片区
        h('div', { className: 'wr-rm-cardzone' },
          loading ? h('div', { className: 'wr-empty' }, h('span', { className: 'wr-spin' }), h('div', null, W.t.roamingLoading))
            : error ? h('div', { className: 'wr-empty' }, W.t.loadFailed + '：' + error, h('button', { className: 'wr-btn', onClick: refresh }, W.t.retry))
              : !card ? h('div', { className: 'wr-empty' }, W.I.inbox(28), h('div', null, !loggedIn ? W.t.roamingLoginHint : (({
                empty_pool: W.t.emptyPool,
                cooldown_filtered: W.t.cooldownFiltered,
                no_due_cards: W.t.noDueCards,
                review_done: W.t.reviewDone,
              })[session && session.reason] || (session && session.reason) || W.t.noCardAvailable)),
                !loggedIn && h('button', {
                  className: 'wr-btn wr-btn-primary', style: { marginTop: 10 },
                  onClick: () => { try { window.dispatchEvent(new CustomEvent('weread:open-login')); } catch { /* ignore */ } },
                }, W.t.goLogin))
                : h('div', { className: 'wr-note-card', key: card.noteKey || idx },
                  h('div', { className: 'wr-card-grad' }),
                  h('div', { className: 'wr-quote-line' + (card.noteType === 'highlight' ? ' wr-quote-line-on' : '') }),
                  h('div', {
                    className: 'wr-corner-fav' + (fav ? ' wr-corner-fav-on' : '') + (favPulse && favBusy ? ' wr-fav-pulse' : ''),
                    key: 'fav' + favPulse, title: fav ? W.t.favAlready : W.t.favorite, onClick: doFavorite,
                  }, W.I.star(16, !!fav)),
                  burst > 0 && h('div', { className: 'wr-rm-burst', key: 'burst' + burst },
                    Array.from({ length: 8 }, (_, i) => {
                      const ang = (i * Math.PI * 2) / 8;
                      return h('i', { key: i, style: { '--dx': (Math.cos(ang) * 30).toFixed(0) + 'px', '--dy': (Math.sin(ang) * 30).toFixed(0) + 'px' } }, '\u2605');
                    })),
                  h('div', { className: 'wr-rm-header' },
                    h('span', { className: 'wr-rm-book' }, card.bookTitle || W.t.unnamedBook),
                    authorText && h('span', { className: 'wr-rm-author' }, '· ' + authorText)),
                  h('div', { className: 'wr-rm-meta' },
                    h('span', { className: 'wr-badge' }, tm.icon(10), ' ', tm.label),
                    h('span', { className: 'wr-row' }, W.I.cal(10), ' ', W.fmtDate(card.createTime)),
                    h('span', null, W.t.reviewCountLabel(reviewCount))),
                  h('div', { className: 'wr-rm-body' }, '"' + (card.text || card.content || '')),
                  h('div', { className: 'wr-rm-foot' },
                    reviewCount > 0 && h('span', { className: 'wr-rm-tag wr-rm-tag-ok' }, '✓ ' + W.t.reviewed),
                    fav && h('span', { className: 'wr-rm-tag wr-rm-tag-fav' }, W.I.star(10, true), ' ', W.t.favorite),
                    h('span', { className: 'wr-rm-tag', style: { marginLeft: 'auto' } }, '# ' + (card.bookId || ''))))),
        // 底部面板
        h('div', { className: 'wr-rm-bottom' },
          h('div', { className: 'wr-rm-keys' },
            h('span', null, h('b', null, 'Space'), ' ', W.t.remember),
            h('span', null, h('b', null, 'X'), ' ', W.t.forgot),
            h('span', null, h('b', null, '←'), ' ', W.t.prevCard), h('span', null, h('b', null, '→'), ' ', W.t.nextCard),
            h('span', null, h('b', null, 'F'), ' ', W.t.favorite),
            h('span', { className: 'sec' }, h('b', null, 'O'), ' ', W.t.typeNote), h('span', { className: 'sec' }, h('b', null, 'E'), ' ', W.t.detailWord),
            h('span', { className: 'sec' }, h('b', null, 'I'), ' ', W.t.exportWord), h('span', { className: 'sec' }, h('b', null, 'J'), ' ', W.t.skip),
            h('span', { className: 'sec' }, h('b', null, 'R'), ' ', W.t.refreshWord), h('span', { className: 'sec' }, h('b', null, 'D'), ' ', W.t.dataWord)),
          h('div', { className: 'wr-rm-actbar' },
            h('button', { className: 'wr-btn', title: W.t.prevCard + ' (←)', onClick: prev }, W.I.chevL(12)),
            h('span', { className: 'wr-rm-idx' }, W.t.cardIndex((session && session.index) || 0)),
            h('button', { className: 'wr-btn', title: W.t.nextCard + ' (→)', onClick: next }, W.I.chevR(12)),
            h('span', { className: 'wr-rm-sep' }),
            h('button', { className: 'wr-btn wr-rm-favbtn' + (fav ? ' wr-rm-favbtn-on' : ''), onClick: doFavorite, disabled: favBusy }, W.I.star(12, !!fav), ' ', fav ? W.t.favAlready : W.t.favorite),
            h('span', { style: { display: 'inline-flex', gap: 6 } },
                h('button', {
                  className: 'wr-btn wr-rm-forgotbtn',
                  title: reviewMode ? W.t.forgotTipReview : W.t.forgotTipNormal,
                  onClick: doForgot,
                }, W.t.forgotBtn),
                h('button', {
                  className: 'wr-btn wr-rm-goodbtn',
                  title: reviewMode ? W.t.rememberTipReview : W.t.rememberTipNormal,
                  onClick: doReview,
                }, !reviewMode && todayReviewed ? W.t.goodBtnDone : W.t.goodBtn)),
            h('span', { className: 'wr-rm-sep' }),
            h('button', { className: 'wr-btn', title: W.t.noteBtnTip, onClick: doOpenSource }, W.t.typeNote, ' O'),
            h('button', { className: 'wr-btn', title: W.t.exportBtnTip, onClick: () => setExportOpen(true) }, W.t.exportWord, ' I'),
            h('button', { className: 'wr-btn', title: W.t.skipBtnTip, onClick: next }, W.t.skip, ' J'))),
        // 导出弹窗
        exportOpen && h('div', { className: 'wr-modal-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) setExportOpen(false); } },
          h('div', { className: 'wr-modal', style: { maxWidth: 700 } },
            h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 12 } }, W.t.exportModalTitle),
            h('div', { className: 'wr-rm-export' },
              h('div', { className: 'wr-rm-preview' }, previewUrl ? h('img', { src: previewUrl, alt: W.t.previewWord }) : h('div', { className: 'wr-muted' }, W.t.previewFailed)),
              h('div', { className: 'wr-rm-setting' },
                h('div', null, W.t.timeCreate, ' / ', W.t.timeShare),
                h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
                  h('input', { type: 'radio', name: 'wrExportTime', checked: exportTimeType === 'create', onChange: () => setExportTimeType('create') }), W.t.timeCreate),
                h('label', { style: { display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
                  h('input', { type: 'radio', name: 'wrExportTime', checked: exportTimeType === 'share', onChange: () => setExportTimeType('share') }), W.t.timeShare),
                h('div', { style: { marginTop: 4 } }, W.t.exportThemes),
                h('div', { className: 'wr-rm-themes' }, themes.map((t) => h('div', {
                  key: t.id, className: 'wr-rm-swatch' + (t.id === theme.id ? ' wr-rm-swatch-on' : ''),
                  style: { background: t.bg, boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)' },
                  title: W.T_ZH['theme_' + t.id] || t.name, onClick: () => { themeTouched.current = true; setExportThemeId(t.id); },
                }))),
                h('div', { style: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10 } },
                  h('button', { className: 'wr-btn wr-btn-primary', onClick: doExport, disabled: !previewUrl }, W.t.confirm),
                  h('button', {
                    className: 'wr-btn', disabled: !previewUrl || !navigator.clipboard || typeof ClipboardItem === 'undefined',
                    title: W.t.copyImageTip,
                    onClick: async () => { onToast && onToast((await copyImage()) ? W.t.imageCopied : W.t.imageCopyFailed); },
                  }, W.t.copyImageBtn),
                  h('button', { className: 'wr-btn', onClick: () => setExportOpen(false) }, W.t.cancel)))))));
    };
