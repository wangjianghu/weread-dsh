/**
 * 微信读书 DSH 插件 — 10-bookshelf
 * 书架 tab（未登录横幅 / 工具栏 / 分类分组列表）+ 登录弹层 W.LoginModal。
 * 复刻 analysis-02 的树交互：搜索过滤、分类折叠（collapseMode + 覆盖态）、同步进度、账号切换。
 */

W.CSS_10 = `
.wr-acctmenu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:150px;display:flex;flex-direction:column;padding:4px;background:var(--dsw-alias-bg-panel,#fff);border:1px solid var(--dsw-alias-border-l1,#e2e2e2);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12)}
.wr-acctmenu-item{display:block;width:100%;text-align:left;background:none;border:none;padding:7px 10px;font-size:12px;color:var(--dsw-alias-label-primary);border-radius:6px;cursor:pointer}
.wr-acctmenu-item:hover{background:var(--dsw-alias-bg-inset,#f5f5f5)}
.wr-acctmenu-active{font-weight:600}
.wr-acctmenu-danger{color:var(--dsw-alias-danger,#d5453f)}
@keyframes wr-pulse{from{opacity:.35}to{opacity:1}}
.wr-acctmenu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,#eaeaea)}
.wr-bookshelf-root{display:flex;flex-direction:column;min-height:100%}
.wr-banner{display:flex;align-items:center;gap:12px;padding:8px 12px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}
.wr-banner-warn{border-left:3px solid #d29922;background:rgba(210,153,34,.08)}
.wr-banner-btn{margin-left:auto;flex:none}
.wr-syncmsg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.wr-group{margin-bottom:4px}
.wr-group-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer;user-select:none;font-size:13px}
.wr-group-head:hover{background:var(--dsw-alias-bg-layer-2)}
.wr-arrow{display:inline-block;width:12px;color:var(--dsw-alias-label-secondary);font-size:11px;transition:transform .12s}
.wr-arrow-open{transform:rotate(90deg)}
.wr-group-count{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:20px;flex:none}
.wr-book-row{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 26px;border-radius:6px;cursor:pointer;font-size:12px}
.wr-book-row:hover{background:var(--dsw-alias-bg-layer-2)}
.wr-book-icon{flex:none;font-size:13px;line-height:1}
.wr-book-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-book-meta{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.wr-book-actions{display:flex;align-items:center;gap:4px;margin-left:4px;opacity:0;transition:opacity .12s;flex:none}
.wr-book-row:hover .wr-book-actions,.wr-book-actions:focus-within{opacity:1}
.wr-mini{padding:1px 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;text-decoration:none;display:inline-block}
.wr-mini:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.wr-mini-danger:hover{border-color:var(--dsw-alias-danger);color:var(--dsw-alias-danger)}
.wr-login-tabs{display:flex;gap:4px;margin-bottom:12px}
.wr-login-tab{flex:1;padding:6px 10px;text-align:center;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px}
.wr-login-tab-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}
.wr-qrwrap{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0}
.wr-qr{width:220px;height:220px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-overlay)}
.wr-form{display:flex;flex-direction:column;gap:8px}
.wr-form label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.wr-field{display:flex;flex-direction:column;gap:4px}
.wr-err{color:var(--dsw-alias-danger);font-size:12px}
.wr-ok{color:var(--dsw-alias-success);font-size:12px}
.wr-modal-title{font-size:14px;font-weight:600;margin-bottom:12px;display:flex;align-items:center}
.wr-close{margin-left:auto;background:none;border:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;padding:0 4px}
.wr-close:hover{color:var(--dsw-alias-label-primary)}

.wr-viewtoggle{display:inline-flex}
.wr-viewtoggle .wr-btn{border-radius:0}
.wr-viewtoggle .wr-btn:first-child{border-radius:6px 0 0 6px}
.wr-viewtoggle .wr-btn:last-child{border-radius:0 6px 6px 0}
.wr-viewtoggle .wr-view-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1,#fff);font-weight:600}
.wr-viewtoggle .wr-view-on:hover{color:var(--dsw-alias-bg-layer-1,#fff);opacity:.92}
.wr-viewtoggle .wr-view-on svg{color:currentColor}
.wr-cardgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:14px 12px;padding:4px 0 8px}
.wr-bookcard{display:flex;flex-direction:column;gap:4px;cursor:pointer;min-width:0}
.wr-bookcard:hover .wr-bookcard-title{color:var(--dsw-alias-brand-primary)}
.wr-bookcard-cover{position:relative;aspect-ratio:3/4;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 2px 8px rgba(0,0,0,.08)}
.wr-bookcard-cover img{width:100%;height:100%;object-fit:cover;display:block}
.wr-bookcard-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.wr-bookcard-badge{position:absolute;right:4px;bottom:4px;font-size:10px;background:var(--dsw-alias-bg-overlay);border-radius:8px;padding:1px 6px}
.wr-bookcard-title{font-size:12px;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.wr-bookcard-meta{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-bookcard-stats{display:flex;gap:8px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.wr-bookcard-stats span{display:inline-flex;align-items:center;gap:3px}
.wr-pager{display:flex;align-items:center;gap:10px;justify-content:center;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l1)}
`;

(() => {
  const h = W.h;

  // ---------- 登录弹层 ----------
  // v1.2.3：通道状态 chip——cookie 状态覆盖「扫码/粘贴 Cookie」两个 tab（同一凭据）
  // v1.2.5：状态点在名称尾部（放开头会被误读为「单选选中」）；选中态由边框/底色表达
  // v1.2.6：hover 详情改由弹层内详情行呈现（原生 title 有 ~1s 延迟且无样式，观感像「没显示」）
  function LoginChannelChip({ active, onClick, state, label, tip, onHover }) {
    const tone = state === 'ok' || state === 'bound' ? 'var(--dsw-alias-success, #3fb950)'
      : state === 'expired' ? 'var(--dsw-alias-warning, #d29922)'
        : 'var(--dsw-alias-label-secondary, #888)';
    return h('button', {
      className: 'wr-login-tab' + (active ? ' wr-login-tab-active' : ''),
      style: { display: 'inline-flex', alignItems: 'center', gap: '5px' },
      title: tip || '',
      onClick,
      onMouseEnter: () => onHover?.(tip || ''),
      onMouseLeave: () => onHover?.(''),
    }, label, h('span', {
      style: { color: tone, fontSize: '9px', lineHeight: 1, animation: state === 'verifying' ? 'wr-pulse 1s infinite alternate' : undefined },
    }, '●'));
  }

  W.LoginModal = function LoginModal({ onClose, onDone, loggedIn, gateway, channels, initialTab, accountName, multiAccount }) {
    const { useState, useEffect } = W.hooks;
    // v1.2.1：API Key（官方）左置且默认选中——官方通道是当前推荐主路径
    const [tab, setTab] = useState(initialTab === 'cookie' || initialTab === 'protocol' ? initialTab : 'apikey');

    // v1.2.5：打开弹层即自动核验各通道（服务端 verifyNow），「未复核」状态秒级消解为 有效/已过期
    const [liveChannels, setLiveChannels] = useState(channels);
    const [verifying, setVerifying] = useState(false); // effect 里置 true（rmsmoke no-op effect 下直接用传入状态）
    useEffect(() => {
      let cancelled = false;
      setVerifying(true);
      W.post('/api/login/verify', {})
        .then((r) => { if (!cancelled && r?.loginChannels) setLiveChannels(r.loginChannels); })
        .catch(() => { /* 核验失败保持传入状态 */ })
        .finally(() => { if (!cancelled) setVerifying(false); });
      return () => { cancelled = true; };
    }, []);

    const ch = liveChannels || {};
    const apiKeyState = verifying ? 'verifying'
      : ch.apiKey?.bound ? (ch.apiKey.valid ? 'ok' : 'bound') : 'absent';
    const cookieRaw = ch.cookie?.valid ? 'ok' : ch.cookie?.expired ? 'expired' : ch.cookie?.present ? 'unknown' : 'absent';
    const cookieState = verifying && ch.cookie?.present ? 'verifying' : cookieRaw;
    const apiKeyText = verifying ? W.t.channelVerifying
      : ch.apiKey?.bound
        ? (ch.apiKey.valid ? W.t.channelBoundOk(ch.apiKey.keyTail) : W.t.channelBoundStale(ch.apiKey.keyTail))
        : W.t.channelAbsent;
    const cookieText = verifying && ch.cookie?.present ? W.t.channelVerifying
      : cookieRaw === 'ok' ? W.t.channelCookieOk
        : cookieRaw === 'expired' ? W.t.channelCookieExpired
          : cookieRaw === 'unknown' ? W.t.channelCookieUnknown : W.t.channelAbsent;
    const checkedSuffix = ch.lastCheckAt ? ' · ' + W.t.channelCheckedAt(new Date(ch.lastCheckAt).toLocaleString()) : '';
    // v1.2.6：hover 详情行（固定高度防跳动；默认显示图例）
    const [hoverHint, setHoverHint] = useState('');

    return h('div', { className: 'wr-modal-mask', onClick: onClose },
      h('div', { className: 'wr-modal', onClick: (e) => e.stopPropagation() },
        // v1.8.7：多账号语义提示——让用户知道「再登录是新增账号还是替换账号」（多账号开关此前为假开关）
        h('div', { className: 'wr-muted wr-small', style: { marginBottom: 8 } },
          W.t.loginAccountHint(accountName, multiAccount !== false)),
        h('div', { className: 'wr-modal-title' }, W.t.login,
          // v1.3.1：图例移标题右侧，圆点带对应颜色渲染
          h('span', { className: 'wr-muted', style: { marginLeft: 'auto', marginRight: '10px', fontSize: '11px', fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } },
              h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--dsw-alias-success, #3fb950)', display: 'inline-block' } }),
              W.t.legendValid),
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } },
              h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--dsw-alias-warning, #d29922)', display: 'inline-block' } }),
              W.t.legendExpired),
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } },
              h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--dsw-alias-label-secondary, #888)', display: 'inline-block' } }),
              W.t.legendAbsent)),
          h('button', { className: 'wr-close', onClick: onClose }, '×')),
        // v1.2.3 状态条（兼 tab）/ v1.2.5 状态点移名称尾部 / v1.2.6 hover 详情行
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' } },
          h(LoginChannelChip, { active: tab === 'apikey', onClick: () => setTab('apikey'), state: apiKeyState === 'verifying' ? 'absent' : apiKeyState, label: W.t.loginApiKey, tip: apiKeyText + checkedSuffix, onHover: setHoverHint }),
          h(LoginChannelChip, { active: tab === 'protocol', onClick: () => setTab('protocol'), state: cookieState === 'unknown' || cookieState === 'verifying' ? 'absent' : cookieState, label: W.t.loginProtocol, tip: cookieText + ' · ' + W.t.channelCookieSharedTip, onHover: setHoverHint }),
          h(LoginChannelChip, { active: tab === 'cookie', onClick: () => setTab('cookie'), state: cookieState === 'unknown' || cookieState === 'verifying' ? 'absent' : cookieState, label: W.t.loginCookie, tip: cookieText + ' · ' + W.t.channelCookieSharedTip, onHover: setHoverHint })),
        h('div', { className: 'wr-muted wr-small', style: { minHeight: '18px', marginBottom: '10px', lineHeight: '18px' } },
          hoverHint || W.t.channelLegendHint),
        tab === 'apikey'
          ? h(ApiKeyLogin, { onDone, loggedIn, gateway })
          : tab === 'protocol'
            ? h(ProtocolLogin, { onDone })
            : h(CookieLogin, { onDone })));
  };

  // v1.1：API Key 官方通道登录（已登录=绑定当前账号；未登录=独立账号）
  // v1.2.1：已绑定时展示绑定态（尾号）并预填持久化的 Key（本机同源拉取），提交即更新
  function ApiKeyLogin({ onDone, loggedIn, gateway }) {
    const { useState, useEffect } = W.hooks;
    const bound = !!gateway?.enabled;
    const [apiKey, setApiKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [attached, setAttached] = useState(false);

    useEffect(() => {
      let cancelled = false;
      if (bound) {
        W.get('/api/gateway/key')
          .then((r) => { if (!cancelled && r?.apiKey) setApiKey(r.apiKey); })
          .catch(() => { /* 预填失败不影响手输 */ });
      }
      return () => { cancelled = true; };
    }, [bound]);

    const submit = async () => {
      if (busy) return;
      const key = apiKey.trim();
      if (!key) { setErr(W.t.apiKeyRequired); return; }
      setBusy(true); setErr(null);
      try {
        const r = await W.post('/api/login/apikey', { apiKey: key });
        if (r && r.ok === false) setErr(r.error || W.t.apiKeyLoginFailed);
        else { setAttached(!!r.attached); onDone(r.account); }
      } catch (e) { setErr(e.message || String(e)); }
      setBusy(false);
    };

    return h('div', { className: 'wr-form' },
      // v1.2.5：说明收紧为一行式小字；绑定态为高亮条
      h('div', { className: 'wr-muted wr-small', style: { lineHeight: 1.6 } }, W.t.apiKeyTip),
      bound && h('div', { className: 'wr-ok', style: { marginBottom: '8px', padding: '6px 10px', background: 'rgba(63,185,80,.08)', borderRadius: '6px' } }, '✓ ' + W.t.apiKeyBoundState(gateway.keyTail)),
      loggedIn === true && !bound && h('div', { className: 'wr-muted wr-small', style: { marginTop: '4px' } }, '📌 ' + W.t.apiKeyBoundTip),
      h('div', { className: 'wr-field' },
        h('label', null, W.t.apiKeyLabel),
        h('input', {
          className: 'wr-input', type: 'password', placeholder: W.t.apiKeyPlaceholder, value: apiKey,
          onChange: (e) => setApiKey(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') submit(); } })),
      err && h('div', { className: 'wr-err' }, err),
      attached && h('div', { className: 'wr-ok' }, '✓ ' + W.t.apiKeyAttached),
      // v1.2.5：链接与提交同行（左链接、右主按钮），不再竖排
      h('div', { className: 'wr-row', style: { justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' } },
        h('a', {
          href: 'https://weread.qq.com/r/weread-skills', target: '_blank', rel: 'noreferrer',
          className: 'wr-mini', style: { textDecoration: 'underline' },
        }, W.t.apiKeyOpenPage),
        h('button', { className: 'wr-btn wr-btn-primary', disabled: busy, onClick: submit },
          busy ? W.t.loading : (bound ? W.t.apiKeyUpdate : W.t.submit))));
  }
  W.ApiKeyLogin = ApiKeyLogin;

  function ProtocolLogin({ onDone }) {
    const { useState } = W.hooks;
    const [startKey, setStartKey] = useState(0);
    const [confirmUrl, setConfirmUrl] = useState(null);
    const [phase, setPhase] = useState('waiting'); // waiting|scanned|confirming|needOtp|success|expired|error
    const [message, setMessage] = useState('');
    const [otp, setOtp] = useState('');
    const [otpBusy, setOtpBusy] = useState(false);
    const [otpErr, setOtpErr] = useState(null);
    const doneRef = W.React.useRef(false);

    useEffect(() => {
      let cancelled = false;
      setConfirmUrl(null); setPhase('waiting'); setMessage('');
      W.post('/api/login/protocol/start')
        .then((r) => { if (!cancelled) setConfirmUrl(r.confirmUrl || null); })
        .catch((e) => { if (!cancelled) { setPhase('error'); setMessage(e.message || String(e)); } });
      return () => {
        cancelled = true;
        // B4: 面板关闭即取消 Host 侧 1.5s 外网轮询（成功后 Host 自清，此处幂等）
        W.post('/api/login/protocol/cancel').catch(() => {});
      };
    }, [startKey]);

    W.usePoll(async () => {
      const s = await W.get('/api/login/protocol/status');
      if (doneRef.current) return;
      setPhase(s.phase || 'waiting');
      if (s.message) setMessage(s.message);
      if (s.phase === 'success') {
        doneRef.current = true;
        if (s.account?.name) setMessage(s.account.name);
        onDone();
      }
    }, 1500, phase !== 'success' && phase !== 'expired' && phase !== 'error');

    const submitOtp = async () => {
      if (!otp || otpBusy) return;
      setOtpBusy(true); setOtpErr(null);
      try {
        const r = await W.post('/api/login/protocol/otp', { otp });
        if (r && r.ok === false) setOtpErr(r.error || W.t.otpFailed);
      } catch (e) { setOtpErr(e.message || String(e)); }
      setOtpBusy(false);
    };

    return h('div', null,
      confirmUrl
        ? h('div', { className: 'wr-qrwrap' },
            h('img', {
              className: 'wr-qr',
              // v1.8.8：同源本地生成（vendored qrcode）——原直连境外 api.qrserver.com，不可达时二维码破损
              src: '/weread/api/login/protocol/qrcode?data=' + encodeURIComponent(confirmUrl),
              alt: 'login qr' }),
            phase === 'waiting' && h('div', { className: 'wr-muted wr-small' }, W.t.scanTip),
            phase === 'scanned' && h('div', { className: 'wr-ok' }, W.t.scannedTip),
            phase === 'confirming' && h('div', { className: 'wr-muted wr-small' }, W.t.confirmingTip),
            phase === 'needOtp' && h('div', { className: 'wr-form' },
              h('div', { className: 'wr-field' },
                h('label', null, W.t.otpTitle),
                h('div', { className: 'wr-row' },
                  h('input', {
                    className: 'wr-input', placeholder: W.t.otpPlaceholder, value: otp,
                    onChange: (e) => setOtp(e.target.value.trim()) }),
                  h('button', { className: 'wr-btn wr-btn-primary', disabled: otpBusy, onClick: submitOtp }, W.t.submit))),
              otpErr && h('div', { className: 'wr-err' }, otpErr)),
            phase === 'success' && h('div', { className: 'wr-ok' }, W.t.syncDone),
            phase === 'expired' && h('button', {
              className: 'wr-btn', onClick: () => setStartKey((k) => k + 1) }, W.t.retry))
        : phase === 'error'
          ? h('div', { className: 'wr-err' }, message || W.t.loadFailed,
              h('div', null, h('button', {
                className: 'wr-btn', style: { marginTop: '8px' },
                onClick: () => setStartKey((k) => k + 1) }, W.t.retry)))
          : h('div', { className: 'wr-muted', style: { padding: '24px 0', textAlign: 'center' } }, W.t.loading));
  }

  function CookieLogin({ onDone }) {
    const { useState } = W.hooks;
    const [wrVid, setVid] = useState('');
    const [wrSkey, setSkey] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    const submit = async () => {
      if (busy) return;
      if (!wrVid || !wrSkey) { setErr(W.t.cookieRequired); return; }
      setBusy(true); setErr(null);
      try {
        const r = await W.post('/api/login/cookie', { wrVid: wrVid.trim(), wrSkey: wrSkey.trim() });
        if (r && r.ok === false) setErr(r.error || W.t.cookieLoginFailed);
        else onDone(r.account);
      } catch (e) { setErr(e.message || String(e)); }
      setBusy(false);
    };

    return h('div', { className: 'wr-form' },
      h('div', { className: 'wr-muted wr-small' }, W.t.cookieTip),
      h('div', { className: 'wr-field' },
        h('label', null, W.t.cookieVid),
        h('input', { className: 'wr-input', value: wrVid, onChange: (e) => setVid(e.target.value) })),
      h('div', { className: 'wr-field' },
        h('label', null, W.t.cookieSkey),
        h('input', { className: 'wr-input', type: 'password', value: wrSkey,
          onChange: (e) => setSkey(e.target.value) })),
      err && h('div', { className: 'wr-err' }, err, h('button', {
        className: 'wr-mini', style: { marginLeft: '6px' }, onClick: submit }, W.t.retry)),
      h('div', { className: 'wr-row' },
        h('button', { className: 'wr-btn wr-btn-primary', disabled: busy, onClick: submit },
          busy ? W.t.loading : W.t.submit)));
  }

  // ---------- 书架 ----------
  W.Bookshelf = function Bookshelf({ state, onNavigate, onToast }) {
    const { useState, useEffect, useMemo } = W.hooks;
    const [st, setSt] = useState(state);
    const [data, setData] = useState(null); // {groups,total,filtered}
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState('');
    const [collapseMode, setCollapseMode] = useState('default'); // all|allExpanded|default
    const [ovr, setOvr] = useState({}); // 分类名 -> bool（覆盖折叠态）
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState('');
    const [showLogin, setShowLogin] = useState(false);

    const refreshState = async () => { try { setSt(await W.get('/api/state')); } catch { /* 忽略 */ } };

    const load = async (q) => {
      setLoading(true); setError(null);
      try {
        const r = await W.get('/api/bookshelf' + (q ? `?query=${encodeURIComponent(q)}` : ''));
        setData(r);
      } catch (e) { setError(e.message || String(e)); }
      setLoading(false);
    };

    // C7：state 由 App 轮询统一提供，不再重复拉取
    // P2-31（对抗审查 v2）：防抖 effect 无 leading，首挂载也会跑 → 原版与挂载 effect 合计双请求。
    // 方案取舍：保留挂载立即加载（首屏不延迟 250ms），防抖 effect 用 first-run ref 跳过首次 → 挂载后恰好一次。
    const skipFirstQuery = W.hooks.useRef(true);
    useEffect(() => { load(''); }, []);
    useEffect(() => {
      if (skipFirstQuery.current) { skipFirstQuery.current = false; return undefined; }
      const id = setTimeout(() => load(query.trim()), 250);
      return () => clearTimeout(id);
    }, [query]);

    const defaultOpen = (cat) =>
      collapseMode === 'all' ? false : collapseMode === 'allExpanded' ? true : cat !== W.t.publicAccount;
    const isOpen = (cat) => (cat in ovr ? ovr[cat] : defaultOpen(cat));
    const toggleCat = (cat) => {
      setOvr((m) => ({ ...m, [cat]: !isOpen(cat) }));
      setCollapseMode((m) => (m === 'default' ? m : 'default'));
    };
    const setAll = (mode) => { setCollapseMode(mode); setOvr({}); };

    // P2-30（对抗审查 v2）：reload/onToggle 原为每渲染新建的内联箭头，打穿 BookCard/BookRow/CategoryGroup 的 React.memo。
    // 取舍：load 是普通函数但闭包只触达稳定 setter（陈旧引用行为等价）→ useCallback 依赖 [query] 即得稳定引用；
    // toggleCat 经 isOpen 读渲染闭包 state（ovr/collapseMode，非纯函数式更新，空依赖会冻结陈旧 ovr）→ latest-ref 持最新实现。
    const reload = W.hooks.useCallback(() => load(query.trim()), [query]);
    const toggleCatRef = W.hooks.useRef(toggleCat);
    W.hooks.useEffect(() => { toggleCatRef.current = toggleCat; }); // 每次提交后刷新到最新渲染的 toggleCat
    const handleToggleCat = W.hooks.useCallback((cat) => toggleCatRef.current && toggleCatRef.current(cat), []);

    // v1.0.8 未登录引导（v1.9.9 收窄）：仅「首用且无书」时自动弹登录（每会话一次）。
    // 登录过期不再自动弹——老用户进面板常为浏览本地数据，黄色过期提示条（带「重新登录」按钮）
    // 已足够引导；自动弹窗反而一进门就打断浏览（真机反馈 2026-11-13）。
    const guidedRef = W.hooks.useRef(false);
    W.hooks.useEffect(() => {
      if (guidedRef.current) return;
      if (st && st.loggedIn === false && !st.loginExpired && st.booksCount === 0) {
        guidedRef.current = true;
        W.__loginGuided = true;
        setShowLogin(true);
      }
    }, [st && st.loggedIn, st && st.booksCount, st && st.loginExpired]);
    // v1.1.1：跨页签登录引导。事件派发时本组件可能尚未挂载（App 只渲染当前 tab）→
    // App 层把请求暂存到 W.__pendingLogin/__pendingLoginTab，本组件挂载时消费（登录态下也弹，
    // 修复 v1.0.9 起设置页「登录/绑定」入口只跳页不弹窗的竞态）。
    const [loginTab, setLoginTab] = useState('apikey'); // v1.2.2：默认 API Key（官方）
    W.hooks.useEffect(() => {
      const open = (e) => {
        W.__pendingLogin = false; // 已直达到场，清暂存防挂载后重复弹
        refreshState(); // v1.2.3：开弹层即刷新，通道状态取最新
        W.__pendingLoginTab = null;
        setLoginTab(e?.detail?.tab || 'apikey');
        setShowLogin(true);
      };
      window.addEventListener('weread:open-login', open);
      if (W.__pendingLogin) {
        W.__pendingLogin = false;
        const pendingTab = W.__pendingLoginTab;
        W.__pendingLoginTab = null;
        setLoginTab(pendingTab || 'apikey');
        setShowLogin(true);
      }
      return () => window.removeEventListener('weread:open-login', open);
    }, []);

    // P1-3/P1-4（对抗审查 v2）：/api/sync 是异步启动（返回 {started:true}，进度走 syncState/WS）——
    // 手动同步不再按同步语义解析响应（原版 res.syncedBooks 恒 0 → 每次必弹假「无更新」），
    // syncing 状态也不再由 doSync 即时复位（原版 1 秒即熄、登录后 path 永久卡 true），统一由下方轮询监测 syncState 复位。
    const doSync = async () => {
      if (syncing) return;
      setSyncing(true); setSyncMsg(W.t.syncing);
      try {
        await W.post('/api/sync'); // 启动即返；完成 toast/复位由 usePoll 监测 syncState
        try { W.invalidateKpiPill && W.invalidateKpiPill(); } catch (e2) { /* KPI 胶囊即时刷新 */ }
      } catch (e) {
        if (e && e.status === 401) {
          onToast && onToast(e.message || W.t.loginRequired);
          setShowLogin(true); // v1.0.8：未登录/过期时直接引导登录，而非仅 toast
        } else onToast && onToast(e.message || W.t.syncFailed);
        setSyncing(false); setSyncMsg(''); // 启动失败才本地复位（后台未在跑）
      }
    };
    // v1.9.3 软取消：置标志 → 在飞书自然完成（几秒内到 cancelled 终态）。连点幂等（服务端标志 Set）。
    const [cancelling, setCancelling] = W.hooks.useState(false);
    const cancelSync = async () => {
      if (!syncing || cancelling) return;
      setCancelling(true);
      try { await W.post('/api/sync/cancel'); onToast && onToast(W.t.syncCancelling); }
      catch (e) { onToast && onToast(e.message || W.t.syncFailed); setCancelling(false); }
    };
    W.usePoll(async () => {
      const s2 = await W.get('/api/state');
      setSt(s2);
      const ss = s2.syncState;
      if (syncing && ss && ss.status && ss.status !== 'syncing') {
        // P1-3：后台同步已到终态 → 复位本地 syncing（覆盖手动 doSync 与登录后自动同步两条路径）
        setSyncing(false);
        setCancelling(false); // v1.9.3：取消请求态随终态复位
        // v1.8.8：完成 toast 带增量摘要（服务端 syncState.lastSummary；无摘要时退化为简版）
        const sm = ss.lastSummary;
        if (ss.status === 'success') {
          if (sm && (sm.syncedBooks > 0 || sm.syncedNotes > 0)) {
            onToast && onToast(`${W.t.syncDone}：${sm.syncedBooks} ${W.t.books} · ${sm.syncedNotes} ${W.t.notes}${sm.failedBooks ? ` · ${sm.failedBooks} 本失败` : ''}`);
          } else if (sm) onToast && onToast(W.t.syncNoUpdate);
          else onToast && onToast(W.t.syncDone);
        }
        else if (ss.status === 'cancelled') {
          // v1.9.3：已取消——已完成部分保留（非错误，不用红色 failed 话术）
          const part = sm && sm.syncedBooks > 0 ? `（${sm.syncedBooks} ${W.t.books} · ${sm.syncedNotes} ${W.t.notes}）` : '';
          onToast && onToast(`${W.t.syncCancelledToast}${part}`);
        }
        else if (ss.status === 'failed') onToast && onToast(W.t.syncFailed);
        try { W.invalidateKpiPill && W.invalidateKpiPill(); } catch (e) { /* 同步完成刷新 KPI */ }
      }
      // v1.8.10：真实进度取自 /api/state 的 syncProgress（onProgress 链路：当前书/总数/百分比）
      // v1.9.1：①补笔记维度「X/Y 条」（进度对象本就有 syncedNotes/totalNotes）；②弹层开着也轮询
      // （verify 核验会修正 loginState，横幅状态需随之刷新——否则 401 后 syncing=false 轮询停摆、状态冻结）
      const sp = s2.syncProgress;
      if (sp && (sp.totalBooks > 0 || sp.currentBookIndex > 0)) {
        const done = sp.currentBookIndex ?? 0;
        const total = sp.totalBooks ?? 0;
        const name = sp.currentBookName || '';
        const pct = sp.percentage != null ? `${sp.percentage}%` : (total ? `${Math.round((done / total) * 100)}%` : '');
        const noteTot = sp.totalNotes || sp.syncedNotes || 0;
        const notesPart = noteTot > 0 ? ` · ${sp.syncedNotes ?? 0}/${noteTot} ${W.t.notes}` : '';
        setSyncMsg(`${pct} ${done}/${total} ${W.t.books}${notesPart}${name ? ' · ' + String(name).slice(0, 12) : ''}`);
      } else if (ss && (ss.totalBooks || ss.total)) {
        const done = ss.syncedBooks ?? ss.currentBookIndex ?? 0;
        const total = ss.totalBooks ?? ss.total ?? 0;
        const name = ss.currentBook || ss.currentBookTitle || '';
        setSyncMsg(`${done}/${total} ${W.t.books}${name ? ' · ' + name : ''}`);
      } else {
        setSyncMsg(W.t.syncing);
      }
    }, 1000, syncing || showLogin);

    // v1.2.4：账号下拉菜单（替代裸 select）：账号切换 + 登录账号 + 退出账号
    const [acctMenuOpen, setAcctMenuOpen] = useState(false);
    useEffect(() => {
      if (!acctMenuOpen) return undefined;
      const close = () => setAcctMenuOpen(false);
      window.addEventListener('click', close);
      return () => window.removeEventListener('click', close);
    }, [acctMenuOpen]);
    const doLogout = async () => {
      setAcctMenuOpen(false);
      try {
        await W.post('/api/logout', {});
        onToast && onToast(W.t.loggedOutToast);
        await Promise.all([refreshState(), load(query.trim())]);
      } catch (e) { onToast && onToast(e.message || W.t.logoutFailed); }
    };

    const switchAccount = async (accountId) => {
      if (!accountId || accountId === st?.account?.id) return;
      try {
        await W.post('/api/accounts/switch', { accountId });
        await Promise.all([load(query.trim()), refreshState()]);
        onToast && onToast(W.t.accountSwitched);
      } catch (e) { onToast && onToast(e.message || W.t.switchFailed); }
    };

    const onLoginDone = async () => {
      setShowLogin(false);
      onToast && onToast(W.t.loginSuccessSyncing);
      await Promise.all([load(query.trim()), refreshState()]);
      try { await W.post('/api/sync'); try { W.invalidateKpiPill && W.invalidateKpiPill(); } catch (e2) { /* KPI 即时刷新 */ } setSyncing(true); } catch (e) { onToast && onToast(e.message || W.t.autoSyncFailed); }
    };

    const groups = data?.groups || [];
    const busy = loading && !data;

    // 视图切换：树状 / 卡片（记住用户选择）
    const [viewMode, setViewMode] = W.hooks.useState(() => {
      try { return window.localStorage.getItem('wr:viewMode') === 'tree' ? 'tree' : 'card'; } catch (e) { return 'card'; }
    });
    const [page, setPage] = W.hooks.useState(1);
    const switchView = (m) => {
      setViewMode(m); setPage(1);
      try { window.localStorage.setItem('wr:viewMode', m); } catch (e) { /* ignore */ }
    };
    const allBooks = W.hooks.useMemo(
      () => (data && Array.isArray(data.groups) ? data.groups.flatMap((g) => g.books || []) : []),
      [data]
    ); // C5：扁平+分页切片 memo 化（卡片视图：分组内已按 lastReadTime 排序）
    const PAGE_SIZE = 24;
    const totalPages = Math.max(1, Math.ceil(allBooks.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageBooks = allBooks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    return h('div', { className: 'wr-bookshelf-root' },
      // v1.9.1：弹层关闭即刷新书架状态（无论是否登录成功）——核验通过后 loginState 已在服务端修正，
      // 不刷新则横幅冻结在旧值（真机反馈：弹层全绿、横幅仍「登录已过期」）
      showLogin && h(W.LoginModal, { onClose: () => { setShowLogin(false); void refreshState(); }, onDone: onLoginDone, loggedIn: !!st?.loggedIn, initialTab: loginTab, gateway: st?.gateway, channels: st?.loginChannels, accountName: st?.account?.name, multiAccount: st?.config?.multiAccountEnabled }),

      st && !st.loggedIn && h('div', { className: 'wr-banner' + (st.loginExpired ? ' wr-banner-warn' : '') },
        h('span', null, st.loginExpired ? W.t.loginExpiredBanner : W.t.notLoggedIn),
        h('button', { className: 'wr-btn wr-btn-primary wr-banner-btn', onClick: () => setShowLogin(true) }, st.loginExpired ? W.t.relogin : W.t.loginHint)),

      h('div', { className: 'wr-toolbar' },
        h('span', { className: 'wr-viewtoggle' },
          h('button', { className: 'wr-btn wr-view-btn' + (viewMode === 'card' ? ' wr-view-on' : ''), title: W.t.viewCardTitle, onClick: () => switchView('card') }, W.I.grid(12), ' ', W.t.viewCard),
          h('button', { className: 'wr-btn wr-view-btn' + (viewMode === 'tree' ? ' wr-view-on' : ''), title: W.t.viewTreeTitle, onClick: () => switchView('tree') }, W.I.tree(12), ' ', W.t.viewTree)),
        viewMode === 'tree' && h('button', { className: 'wr-btn', onClick: () => setAll(collapseMode === 'all' ? 'allExpanded' : 'all') },
          collapseMode === 'all' ? W.t.expandAll : W.t.collapseAll),
        h('input', {
          className: 'wr-input', placeholder: W.t.search, value: query,
          style: { minWidth: '160px' },
          onChange: (e) => setQuery(e.target.value) }),
        query && h('button', { className: 'wr-mini', onClick: () => setQuery('') }, W.I.close(10)),
        syncing && syncMsg && h('span', { className: 'wr-syncmsg' }, syncMsg),
        h('span', { style: { flex: 1 } }),
        Array.isArray(st?.accounts) && st.accounts.length > 0 && h('span', { style: { position: 'relative' } },
          h('button', {
            className: 'wr-btn', style: { display: 'inline-flex', alignItems: 'center', gap: '4px' },
            onClick: (e) => { e.stopPropagation(); e.preventDefault(); setAcctMenuOpen((v) => !v); },
          }, st.account?.name || st.account?.id || W.t.accounts, ' ▾'),
          acctMenuOpen && h('div', {
            className: 'wr-acctmenu',
            onClick: (e) => e.stopPropagation(),
          },
            st.accounts.map((a) => h('button', {
              key: a.id, className: 'wr-acctmenu-item' + (a.id === st.account?.id ? ' wr-acctmenu-active' : ''),
              onClick: () => { setAcctMenuOpen(false); switchAccount(a.id); },
            }, a.name || a.id, a.id === st.account?.id ? ` · ${W.t.activeAccount}` : '')),
            h('div', { className: 'wr-acctmenu-sep' }),
            h('button', { className: 'wr-acctmenu-item', onClick: () => { setAcctMenuOpen(false); setShowLogin(true); } }, '👤 ', W.t.menuLogin),
            h('button', { className: 'wr-acctmenu-item wr-acctmenu-danger', onClick: doLogout }, '🚪 ', W.t.menuLogout))),
        // v1.9.3：同步中按钮变「取消」（软取消：在飞书完成后停止，已完成部分保留）；
        // 取消请求已发出（cancelling）则保持禁用防连点
        syncing
          ? h('button', { className: 'wr-btn', disabled: cancelling, onClick: cancelSync, title: W.t.syncCancelTip },
              h('span', { className: 'wr-row' }, h('span', { className: 'wr-spin' }), cancelling ? W.t.syncCancellingBtn : W.t.syncCancel))
          : h('button', { className: 'wr-btn', onClick: doSync },
              h('span', { className: 'wr-row' }, W.I.sync(12), ' ', W.t.sync))),

      error
        ? h('div', { className: 'wr-empty' },
            h('div', null, W.t.loadFailed, '：', error),
            h('button', { className: 'wr-btn', onClick: () => load(query.trim()) }, W.t.retry))
        : busy
          ? h('div', { className: 'wr-empty' }, h('span', { className: 'wr-spin' }), W.t.loading)
          : groups.length === 0
            ? h('div', { className: 'wr-empty' },
                h('div', null, query ? W.t.noMatch(query) : W.t.empty),
                h('div', { className: 'wr-small' }, query ? W.t.clearFilter : W.t.emptyDesc))
            : viewMode === 'card'
              ? h('div', null,
                  data && data.filtered != null && data.filtered !== data.total
                    ? h('div', { className: 'wr-muted wr-small', style: { marginBottom: '6px' } },
                        `${data.filtered}/${data.total} ${W.t.books}`)
                    : null,
                  h('div', { className: 'wr-cardgrid' }, pageBooks.map((b) => h(BookCard, {
                    key: b.bookId, book: b, onNavigate, onToast, reload }))),
                  totalPages > 1 && h('div', { className: 'wr-pager' },
                    h('button', { className: 'wr-btn', disabled: safePage <= 1, onClick: () => setPage(safePage - 1) }, W.I.chevL(10), ' ', W.t.prevPage),
                    h('span', { className: 'wr-muted wr-small' }, W.t.pagerInfo(safePage, totalPages, allBooks.length)),
                    h('button', { className: 'wr-btn', disabled: safePage >= totalPages, onClick: () => setPage(safePage + 1) }, W.t.nextPage, ' ›')))
              : h('div', null,
                data && data.filtered != null && data.filtered !== data.total
                  ? h('div', { className: 'wr-muted wr-small', style: { marginBottom: '6px' } },
                      `${data.filtered}/${data.total} ${W.t.books}`)
                  : null,
                groups.map((g) => h(CategoryGroup, {
                  key: g.category,
                  category: g.category,
                  books: g.books || [],
                  open: isOpen(g.category),
                  onToggle: handleToggleCat, // P2-30：稳定共享引用，组件内部以自身 category 调用
                  onNavigate, onToast,
                  reload,
                }))));
  };

  function BookCardInner({ book, onNavigate, onToast, reload }) {
    const { useState } = W.hooks;
    const [imgFail, setImgFail] = useState(false);
    const cover = book.cover && !imgFail;
    const status = book.readingStatus ?? 0;
    return h('div', {
      className: 'wr-bookcard', title: W.t.cardTooltip(book.title, book.author || '', book.progress || 0, book.highlightCount || 0),
      onClick: () => onNavigate && onNavigate('detail', { bookId: book.bookId }),
    },
      h('div', { className: 'wr-bookcard-cover' },
        cover
          ? h('img', { src: book.cover, alt: book.title, loading: 'lazy', onError: () => setImgFail(true) })
          : h('div', { className: 'wr-bookcard-fallback' }, (book.title || W.t.bookLetter).slice(0, 2)),
        h('span', { className: 'wr-bookcard-badge', style: { color: W.statusColor(status) } }, (book.progress || 0) + '%')),
      h('div', { className: 'wr-bookcard-title' }, book.title),
      h('div', { className: 'wr-bookcard-meta' }, (book.author || W.t.anonymous).slice(0, 14)),
      h('div', { className: 'wr-bookcard-stats' },
        h('span', { title: W.t.titleHighlights }, W.I.pen(10), ' ', book.highlightCount || 0),
        h('span', { title: W.t.titleNotes }, W.I.chat(10), ' ', book.noteCount || 0)));
  }

  function CategoryGroupInner({ category, books, open, onToggle, onNavigate, onToast, reload }) {
    const [limit, setLimit] = W.hooks.useState(100); // C12：大分类分段渲染
    return h('div', { className: 'wr-group' },
      h('div', { className: 'wr-group-head', onClick: () => onToggle(category) }, // P2-30：onToggle 为稳定共享引用，此处携带自身 category
        h('span', { className: 'wr-arrow' + (open ? ' wr-arrow-open' : '') }, W.I.chevR(10)),
        h('span', { className: 'wr-row' }, W.I.folder(12), ' ', category),
        h('span', { className: 'wr-group-count' }, `${books.length} ${W.t.books}`)),
      open && h('div', null,
        books.slice(0, limit).map((b) => h(BookRow, {
          key: b.bookId, book: b, onNavigate, onToast, reload })),
        books.length > limit && h('button', {
          className: 'wr-btn', style: { margin: '6px 0 6px 22px' },
          onClick: () => setLimit((n) => n + 200),
        }, W.t.showMoreRemain(books.length - limit))));
  }

  function BookRowInner({ book, onNavigate, onToast, reload }) {
    const { useState } = W.hooks;
    const [confirming, setConfirming] = useState(false);
    const status = book.readingStatus ?? book.status;
    const meta = [
      book.author,
      book.progress > 0 ? `${book.progress}%` : null,
    ].filter(Boolean).join(' · ');
    const pcUrl = book.pcUrl || null;

    const showFolder = async () => {
      try { await W.post('/api/book/folder', { bookId: book.bookId }); }
      catch (e) { onToast && onToast(e.message || W.t.openFolderFailed); }
    };
    const doDelete = async () => {
      try {
        await W.post('/api/book/delete', { bookId: book.bookId });
        onToast && onToast(W.t.deletedNoteFile(book.title));
        reload && reload();
      } catch (e) { onToast && onToast(e.message || W.t.deleteFailed); }
      setConfirming(false);
    };

    return h('div', { className: 'wr-book-row', onClick: () => onNavigate && onNavigate('detail', { bookId: book.bookId }) },
      h('span', { className: 'wr-book-icon', style: { color: W.statusColor(status) } }, W.I.book(14)),
      h('span', { className: 'wr-book-title', title: book.title }, book.title),
      h('span', { className: 'wr-book-meta' }, meta),
      (book.noteCount != null || book.highlightCount != null) && h('span', { className: 'wr-book-meta' },
        book.highlightCount != null ? `${book.highlightCount} ${W.t.highlights}` : null,
        book.highlightCount != null && book.noteCount != null ? ' · ' : null,
        book.noteCount != null ? `${book.noteCount} ${W.t.notes}` : null),
      h('span', { className: 'wr-book-actions', onClick: (e) => e.stopPropagation() },
        pcUrl && h('a', { className: 'wr-mini', href: pcUrl, target: '_blank', rel: 'noreferrer' }, W.t.openSource),
        h('button', { className: 'wr-mini', onClick: showFolder }, W.t.openFolder),
        confirming
          ? h('button', { className: 'wr-mini wr-mini-danger', onClick: doDelete }, W.t.confirmDelete)
          : h('button', { className: 'wr-mini wr-mini-danger', onClick: () => setConfirming(true) }, W.t.delete)));
  }

  // B7: 重列表 memo（IIFE 作用域；此前误插进 BookRowInner 函数体导致 BookCard is not defined）
  const CategoryGroup = W.React.memo(CategoryGroupInner);
  const BookRow = W.React.memo(BookRowInner);
  const BookCard = W.React.memo(BookCardInner);
})();
