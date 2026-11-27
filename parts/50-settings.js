/**
 * 微信读书 DSH 插件 — 50-settings
 * 设置 tab：配置表单（outputPath 校验、autoSync/syncInterval/categoryMode/模板/多账号）、
 * 账号管理、重复文件清理（dryRun→执行→回滚）、日志查看/清空。
 */

W.CSS_50 = `
.wr-err{color:var(--dsw-alias-danger);font-size:12px}
.wr-ok{color:var(--dsw-alias-success);font-size:12px}
.wr-mini{padding:1px 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px}
.wr-mini:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.wr-mini-danger:hover{border-color:var(--dsw-alias-danger);color:var(--dsw-alias-danger)}
/* ---- 单列全宽卡片：v1.8.6 曾试双列并排——DSH 宿主提供祖先容器时生效，半宽卡片与相邻
   卡片内容在视觉上「共享一行」，真机截图三连反馈「模块 title 不是独立一行」实为并排所致；
   笔记配置（唯一全宽卡）一直被用户认定为范本。v1.8.14 全面回归单列（容器查询仍保留
   给表单内部双栏与极窄标签上置——两者都以 grid 为容器查后代，合法生效） ---- */
.wr-set-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;max-width:860px;container-type:inline-size}
/* v1.8.17 布局自卫：真机面板中卡片内子块被横向排布（宿主环境无法本地复刻，机制未定位）。
   以下规则在正常文档流中全部无感（等价于默认值），但若外部样式把卡片变成
   flex-row/inline-flow/grid 任何一种横向上下文，直接子块都会被强制回到「整行独占」：
   - flex 上下文：flex-basis:100% → 每块占满一行自动换行
   - grid 上下文：grid-column:1/-1 → 每块横跨所有列
   - 任意上下文：max-width:100% + width:auto → 不会溢出卡片 */
.wr-card{display:block!important}
.wr-set-card>*{flex-basis:100%!important;grid-column:1/-1!important;max-width:100%!important;width:auto!important;box-sizing:border-box}
/* v1.9.22：保存条靠负外边距铺到卡片两边缘（下方 .wr-save-bar 的左右 margin -16px）——豁免上面的 max-width 卡宽。
   否则负外边距只在左侧生效：底条右缩 16px，按钮又因底条内边距再缩 16px，比右侧开关共左缩 32px
   （真机截图 + tools/layout-repro.mjs --assert 复现：按钮右缘 877 / 开关右缘 909）。
   flex 上下文（上面防的宿主横向排版）里基准同步放宽同样的 32px，底条仍恰好占满一行。 */
.wr-set-card>.wr-save-bar{max-width:none!important;flex-basis:calc(100% + 32px)!important}
@container (min-width: 700px){
  .wr-set-form-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px}
}
@container (max-width: 430px){
  /* 极窄面板：标签上置（label 独占一行，控件占满）——替代原 110px 固定左列的挤压换行 */
  .wr-set-label{width:100%;flex:none;margin-bottom:2px}
  .wr-set-row{row-gap:4px}
  .wr-set-field{min-width:0}
}
.wr-set-card{padding:12px 16px}
/* 卡片标题：图标 + 标题独占一行 + 明确分隔（v1.8.13：1px l1 分隔太弱，标题与首行内容
   视觉粘连像「同一行」——真机截图实况。2px l2 + 加大间距，标题行一眼独立） */
.wr-set-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:14px;padding-bottom:9px;border-bottom:2px solid var(--dsw-alias-border-l2)}
.wr-set-title>svg{color:var(--dsw-alias-brand-primary);flex:none}
/* 卡内分组小标题：弱于卡片标题（色条前缀 + 次级色） */
.wr-set-subtitle{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:14px 0 8px}
.wr-set-subtitle:first-child{margin-top:0}
.wr-set-subtitle::before{content:'';width:3px;height:11px;border-radius:2px;background:var(--dsw-alias-brand-primary);opacity:.6;flex:none}
.wr-set-subtitle .wr-muted{font-weight:400}
.wr-dirlist{max-height:280px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:4px}
.wr-diritem{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px}
.wr-diritem:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.wr-set-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.wr-set-label{width:110px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}
.wr-set-field{flex:1;min-width:180px}
/* 开关行：两端对齐（标签弹性占位，开关贴右）——替代原「标签110px+开关紧跟其后再无右对齐」 */
.wr-set-row--toggle{justify-content:space-between}
.wr-set-row--toggle .wr-set-label{width:auto;flex:1;min-width:0;margin-bottom:0}
.wr-num{max-width:96px;flex:none;min-width:0}
.wr-switch{position:relative;display:inline-block;width:34px;height:18px;flex:none;cursor:pointer;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0}
.wr-switch-knob{position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .12s}
.wr-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.wr-switch[aria-checked="true"] .wr-switch-knob{left:17px;background:var(--dsw-alias-bg-overlay)}
.wr-validation{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.wr-account-row{display:flex;align-items:center;gap:8px;padding:8px 6px;border-radius:6px;font-size:12px;border-bottom:1px dashed var(--dsw-alias-border-l1);flex-wrap:wrap}
.wr-account-row:last-child{border-bottom:none}
.wr-account-avatar{width:24px;height:24px;border-radius:50%;flex:none;object-fit:cover}
.wr-account-avatar-ph{display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-overlay)}
.wr-account-name{flex:1;min-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-account-ops{display:flex;gap:6px;flex:none;margin-left:auto}
.wr-active-tag{color:var(--dsw-alias-brand-primary);font-size:11px;flex:none}
.wr-logbox{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;max-height:220px;overflow:auto;font-size:11px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary)}
.wr-danger-zone{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
/* 结果/提示块：左侧强调条，与表单行区分 */
.wr-summary{font-size:12px;margin-top:8px;color:var(--dsw-alias-label-primary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:8px;white-space:pre-wrap;word-break:break-word}
/* 保存条：粘性吸底——长表单不必滚到最底才能保存 */
.wr-save-bar{position:sticky;bottom:-13px;margin:10px -16px -12px;padding:10px 16px;display:flex;justify-content:flex-end;align-items:center;gap:8px;border-top:1px solid var(--dsw-alias-border-l1);border-radius:0 0 10px 10px;background:var(--dsw-alias-bg-layer-2)}
/* 键盘可达性：统一 focus 环 */
.wr-btn:focus-visible,.wr-input:focus-visible,.wr-select:focus-visible,.wr-switch:focus-visible,.wr-mini:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.wr-btn-danger{border-color:var(--dsw-alias-danger);color:var(--dsw-alias-danger)}
.wr-btn-danger:hover{border-color:var(--dsw-alias-danger);color:var(--dsw-alias-danger);opacity:.85}
`;

(() => {
  const h = W.h;

  function Toggle({ checked, onChange, label }) {
    return h('div', { className: 'wr-set-row wr-set-row--toggle' },
      h('span', { className: 'wr-set-label' }, label),
      h('button', {
        className: 'wr-switch', role: 'switch', 'aria-checked': checked ? 'true' : 'false',
        onClick: () => onChange(!checked),
      }, h('span', { className: 'wr-switch-knob' })));
  }

  // 目录选择弹窗：优先 W.pickDirectory（原生 remote picker），否则走 /api/fs/list 浏览器
  W.DirPickerModal = function DirPickerModal({ onPick, onClose }) {
    const { useState, useEffect } = W.hooks;
    const [dir, setDir] = useState(null); // {path,parent,dirs}
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const load = async (p) => {
      setErr(''); setBusy(true);
      try { setDir(await W.get('/api/fs/list' + (p ? `?path=${encodeURIComponent(p)}` : ''))); }
      catch (e) { setErr(e.message || String(e)); }
      setBusy(false);
    };
    useEffect(() => { load(); }, []);
    if (!dir && !err) return h('div', { className: 'wr-modal-mask' }, h('div', { className: 'wr-modal' }, h('span', { className: 'wr-spin' })));
    return h('div', { className: 'wr-modal-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
      h('div', { className: 'wr-modal', style: { maxWidth: 'min(560px, 92vw)' } },
        h('style', null, W.CSS_50 || ''),
        h('div', { style: { fontWeight: 600, marginBottom: 8 } }, W.t.dirPickerTitle),
        h('div', { className: 'wr-row', style: { marginBottom: 8, gap: 6 } },
          h('button', { className: 'wr-btn', disabled: busy || !dir?.parent, onClick: () => dir?.parent && load(dir.parent) }, W.I.chevL(11), ' ', W.t.parentDir),
          h('span', { className: 'wr-muted wr-small', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, dir?.path || '')),
        err && h('div', { className: 'wr-err' }, err, h('button', { className: 'wr-btn', onClick: () => load() }, W.t.retry)),
        h('div', { className: 'wr-dirlist' },
          busy && h('div', { className: 'wr-empty' }, h('span', { className: 'wr-spin' })),
          !busy && (dir?.dirs?.length
            ? dir.dirs.map((name) => h('div', {
              key: name, className: 'wr-diritem', onClick: () => load(dir.path + '/' + name),
            }, W.I.folder(12), ' ', name))
            : h('div', { className: 'wr-muted', style: { padding: '12px 0' } }, W.t.noSubfolders))),
        h('div', { className: 'wr-row', style: { marginTop: 12, gap: 8 } },
          h('button', {
            className: 'wr-btn', onClick: async () => {
              const name = window.prompt(W.t.newFolderPrompt);
              if (!name) return;
              try {
                const r = await W.post('/api/fs/mkdir', { parent: dir.path, name });
                onPick(r.path);
              } catch (e) { setErr(e.message || String(e)); }
            },
          }, W.t.newFolderBtn),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'wr-btn', onClick: onClose }, W.t.cancel),
          h('button', { className: 'wr-btn wr-btn-primary', disabled: !dir?.path, onClick: () => dir?.path && onPick(dir.path) }, W.t.chooseThisDir))));
  };

  W.Settings = function Settings({ state, onToast }) {
    const { useState, useEffect, useCallback } = W.hooks;
    const cfg0 = state?.config || {};
    const [st, setSt] = useState(state);
    const [form, setForm] = useState({
      outputPath: cfg0.outputPath || '',
      autoSync: cfg0.autoSync !== false,
      syncInterval: cfg0.syncInterval || '24h',
      categoryMode: cfg0.categoryMode || 'level1',
      fileNameTemplate: cfg0.fileNameTemplate || '',
      noteTemplate: cfg0.noteTemplate || '',
      multiAccountEnabled: cfg0.multiAccountEnabled !== false,
      uiSidebarKpi: cfg0.uiSidebarKpi !== false,
      uiComposerRoaming: cfg0.uiComposerRoaming !== false,
      uiRoamingScrollMode: cfg0.uiRoamingScrollMode || 'marquee',
      uiRoamingFontSize: cfg0.uiRoamingFontSize || 12,
      uiRoamingScrollSpeed: cfg0.uiRoamingScrollSpeed || 48,
      uiRoamingRotateEnabled: cfg0.uiRoamingRotateEnabled !== false,
      uiRoamingRotateSec: cfg0.uiRoamingRotateSec || 30,
      // v0.5 AI 集成（A2 上下文注入可配置化）
      ctxInjectEnabled: cfg0.ctxInjectEnabled !== false,
      ctxBookCount: cfg0.ctxBookCount || 5,
      ctxIncludeHighlights: cfg0.ctxIncludeHighlights !== false,
      ctxHighlightCount: cfg0.ctxHighlightCount || 3,
      ctxExcludeTitles: cfg0.ctxExcludeTitles || '',
      // v1.0 阅读目标与语言
      weeklyGoalNotes: cfg0.weeklyGoalNotes || 0,
      language: cfg0.language || 'auto',
      // v1.8.20：关窗即退出阅读窗口实例（默认开）
      readerWindowQuitOnClose: cfg0.readerWindowQuitOnClose !== false,
    });
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [lastValidation, setLastValidation] = useState(state?.validation || null);
    const [validateErr, setValidateErr] = useState(null);

    // 账号区
    const [acctConfirm, setAcctConfirm] = useState(null); // 待确认删除的 accountId
    // 清理区
    const [cleanupState, setCleanupState] = useState('idle'); // idle|preview|running|done
    const [cleanupSummary, setCleanupSummary] = useState(null);
    const [cleanupResult, setCleanupResult] = useState(null);
    const [cleanupBusy, setCleanupBusy] = useState(false);
    // 日志区
    const [logChannel, setLogChannel] = useState('op');
    const [logLines, setLogLines] = useState(null);
    const [logBusy, setLogBusy] = useState(false);
    // v1.1 官方通道（API Key）
    const [gwTest, setGwTest] = useState(null);
    // v1.9.19 官方 Skill 一键升级：进行中 / 结果提示
    const [skillBusy, setSkillBusy] = useState(false);
    const [skillMsg, setSkillMsg] = useState(null);
    const [gwBusy, setGwBusy] = useState(false);
    // v1.5 单例阅读窗口（自检/关闭）
    const [rwDiag, setRwDiag] = useState(null);
    const [rwBusy, setRwBusy] = useState(false);
    const rwCheck = async () => {
      setRwBusy(true);
      try { setRwDiag(await W.get('/api/open-reader/diagnose')); } catch (e) { onToast && onToast(e.message || String(e)); }
      setRwBusy(false);
    };
    const rwClose = async () => {
      setRwBusy(true);
      try {
        const r = await W.post('/api/open-reader/close');
        if (r?.ok) { onToast && onToast(W.t.readerWindowCloseDone); setRwDiag(await W.get('/api/open-reader/diagnose').catch(() => null)); }
        else onToast && onToast(r?.error || W.t.openReaderFail);
      } catch (e) { onToast && onToast(e.message || String(e)); }
      setRwBusy(false);
    };
    // v1.0 数据与卸载
    const [backupBusy, setBackupBusy] = useState(false);
    const [uninstallConfirm, setUninstallConfirm] = useState(false);
    const doBackup = async () => {
      if (backupBusy) return;
      setBackupBusy(true);
      try {
        const r = await W.post('/api/backup', {});
        onToast && onToast(W.t.backupDone(r.path || W.t.backupDefaultDir));
      } catch (e) { onToast && onToast(W.t.backupFailed(e.message || e.error || e)); }
      setBackupBusy(false);
    };
    const doUninstallCleanup = async () => {
      try {
        const r = await W.post('/api/uninstall/cleanup', { confirm: true });
        onToast && onToast(W.t.uninstallCleanupDone(r.keychain?.length ?? 0, r.files?.length ?? 0));
        await refreshState();
      } catch (e) { onToast && onToast(W.t.cleanupFailedToast(e.message || e.error || e)); }
      setUninstallConfirm(false);
    };

    const refreshState = useCallback(async () => {
      try {
        const s = await W.get('/api/state');
        setSt(s);
        setLastValidation(s.validation || null);
      } catch { /* 忽略 */ }
    }, []);
    // v1.9.19：一键升级官方 Skill。宿主负责下载/读版本/切换/验证/回滚；这里只发请求并呈现结果。
    // 成功后刷新 state——版本标签与升级提示都随 state 更新（提示在「最新版 ≤ 当前」时由宿主判定为无）。
    const doSkillUpgrade = async () => {
      if (skillBusy) return;
      setSkillBusy(true); setSkillMsg(null);
      try {
        const r = await W.post('/api/gateway/skill-upgrade', {});
        const text = r.changed ? W.t.skillUpgraded(r.to) : W.t.skillAlreadyLatest(r.version);
        setSkillMsg({ ok: true, text });
        if (r.changed) onToast && onToast(text);
        setGwTest(null); // 版本变了，旧的连通性测试结果不再对应
        await refreshState();
      } catch (e) {
        // v1.9.20：界面（client）会热更新，宿主进程不会——宿主还是旧版时没有升级路由，回 404「no route」。
        // 这种情况直说「重启 DSH」，不把路由路径甩给用户。
        const staleHost = e.status === 404 || /^no route:/.test(String(e?.message ?? ''));
        setSkillMsg({ ok: false, text: staleHost ? W.t.skillUpgradeStaleHost : W.t.skillUpgradeFailed(e.message || String(e)) });
      }
      setSkillBusy(false);
    };

    // C7：state 由 App 轮询/传入，挂载不再重复拉取；保存后经 refreshState prop 刷新

    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

    const saveConfig = async () => {
      if (saving) return;
      setSaving(true);
      try {
        const r = await W.post('/api/config', {
          outputPath: form.outputPath.trim() || undefined,
          autoSync: form.autoSync,
          syncInterval: form.syncInterval,
          categoryMode: form.categoryMode,
          fileNameTemplate: form.fileNameTemplate || undefined,
          noteTemplate: form.noteTemplate || undefined,
          multiAccountEnabled: form.multiAccountEnabled,
          uiSidebarKpi: form.uiSidebarKpi,
          uiComposerRoaming: form.uiComposerRoaming,
          uiRoamingScrollMode: form.uiRoamingScrollMode,
          uiRoamingFontSize: form.uiRoamingFontSize,
          uiRoamingScrollSpeed: form.uiRoamingScrollSpeed,
          uiRoamingRotateEnabled: form.uiRoamingRotateEnabled,
          uiRoamingRotateSec: form.uiRoamingRotateSec,
          ctxInjectEnabled: form.ctxInjectEnabled,
          ctxBookCount: form.ctxBookCount,
          ctxIncludeHighlights: form.ctxIncludeHighlights,
          ctxHighlightCount: form.ctxHighlightCount,
          ctxExcludeTitles: form.ctxExcludeTitles || undefined,
          weeklyGoalNotes: form.weeklyGoalNotes,
          language: form.language,
          readerWindowQuitOnClose: form.readerWindowQuitOnClose,
        });
        if (r.validation) setLastValidation(r.validation);
        onToast && onToast(W.t.settingsSaved);
        await refreshState();
        if (W.invalidateUiFlags) W.invalidateUiFlags();
      } catch (e) { onToast && onToast(e.message || W.t.saveFailed); }
      setSaving(false);
    };

    const [dirPickerOpen, setDirPickerOpen] = useState(false);

    const validatePath = async (pathArg) => {
      if (validating) return;
      const p = String(pathArg != null ? pathArg : form.outputPath).trim();
      if (!p) { setValidateErr(W.t.pathEmpty); return; }
      setValidateErr(null); setValidating(true);
      try {
        const r = await W.post('/api/output-path/validate', { path: p });
        if (r.ok === false) {
          setValidateErr(r.reason || r.error || W.t.validateFailedWord);
          setLastValidation(r.validation || { status: 'failed', failReason: r.reason || r.error || '', summary: 'failed' });
        } else {
          setLastValidation(r.validation || { status: 'passed', failReason: '', summary: 'passed' });
          onToast && onToast(W.t.pathValidated);
        }
      } catch (e) {
        setValidateErr(e.message || String(e));
        setLastValidation({ status: 'failed', failReason: e.message || '', summary: 'failed' });
      }
      setValidating(false);
    };

    // 账号操作
    const switchAccount = async (accountId) => {
      try {
        await W.post('/api/accounts/switch', { accountId });
        onToast && onToast(W.t.accountSwitched);
        await refreshState();
      } catch (e) { onToast && onToast(e.message || W.t.switchFailed); }
    };
    const removeAccount = async (accountId) => {
      try {
        await W.post('/api/accounts/remove', { accountId });
        onToast && onToast(W.t.accountRemoved);
        await refreshState();
      } catch (e) { onToast && onToast(e.message || W.t.deleteFailed); }
      setAcctConfirm(null);
    };

    // 清理
    const previewCleanup = async () => {
      setCleanupBusy(true);
      try {
        const r = await W.post('/api/cleanup/duplicates', { dryRun: true });
        setCleanupSummary(r);
        setCleanupState('preview');
      } catch (e) { onToast && onToast(e.message || W.t.previewFailedToast); }
      setCleanupBusy(false);
    };
    const runCleanup = async () => {
      setCleanupBusy(true);
      try {
        const r = await W.post('/api/cleanup/duplicates', { dryRun: false });
        setCleanupResult(r);
        setCleanupState('done');
        onToast && onToast(W.t.cleanupFinished);
        await refreshState();
      } catch (e) { onToast && onToast(e.message || W.t.cleanupRunFailed); }
      setCleanupBusy(false);
    };
    const restoreCleanup = async () => {
      setCleanupBusy(true);
      try {
        const r = await W.post('/api/cleanup/restore');
        onToast && onToast(W.t.restoreDoneLine(r && r.summary ? r.summary : ''));
        setCleanupState('idle'); setCleanupResult(null); setCleanupSummary(null);
        await refreshState();
      } catch (e) { onToast && onToast(e.message || W.t.restoreFailed); }
      setCleanupBusy(false);
    };

    // 日志
    const loadLogs = useCallback(async (ch) => {
      setLogBusy(true);
      try { setLogLines((await W.get('/api/logs?channel=' + encodeURIComponent(ch))).lines || []); }
      catch (e) { setLogLines([]); onToast && onToast(e.message || W.t.logsLoadFailed); }
      setLogBusy(false);
    }, []);
    useEffect(() => { loadLogs(logChannel); }, [logChannel, loadLogs]);

    // v1.8.17 布局探针：宿主面板环境无法本地复刻（四轮截图 vs 本地复现不一致），
    // 挂载后实测「标题行 vs 首个内容行」几何 + 计算样式回报到 op 日志（每页面加载一次）。
    useEffect(() => {
      if (W.__layoutProbed) return undefined;
      W.__layoutProbed = true;
      const timer = setTimeout(() => {
        try {
          const grid = document.querySelector('.wr-set-grid');
          const title = grid && grid.querySelector('.wr-set-title');
          const sib = title && title.nextElementSibling;
          if (!grid || !title || !sib) return;
          const a = title.getBoundingClientRect();
          const b = sib.getBoundingClientRect();
          const sameLine = Math.abs(a.top - b.top) < 8;
          const disp = (el) => getComputedStyle(el).display;
          W.post('/api/client-diag', {
            msg: `layout-probe v${W.VERSION || '?'} sameLine=${sameLine}`
              + ` title[x=${Math.round(a.x)},y=${Math.round(a.y)},w=${Math.round(a.width)}]`
              + ` sib[x=${Math.round(b.x)},y=${Math.round(b.y)},w=${Math.round(b.width)}]`
              + ` card=${disp(title.parentElement)} grid=${disp(grid)} title=${disp(title)}`,
          }).catch(() => { /* 离线/沙箱忽略 */ });
        } catch { /* 环境querySelector等缺失时忽略 */ }
      }, 600);
      return () => clearTimeout(timer);
    }, []);
    const clearLogs = async () => {
      try {
        await W.post('/api/logs/clear', { channel: logChannel });
        setLogLines([]);
        onToast && onToast(W.t.logsCleared);
      } catch (e) { onToast && onToast(e.message || W.t.clearFailed); }
    };
    // v1.9.17：一键复制当前通道**已加载**的日志（排障时贴给 AI/issue 用）。
    // 复制的是界面上已显示的内容（logLines），不另发请求——所见即所得；未加载/为空时按钮禁用。
    // 首行带通道名与插件版本，便于他人在上下文里定位（日志行本身含 ISO 时间戳）。
    const logsCopyable = Array.isArray(logLines) && logLines.length > 0;
    const copyLogs = async () => {
      if (!logsCopyable) return;
      const head = `# weread-dsh v${W.VERSION || '?'} · 日志通道: ${logChannel} · ${logLines.length} 行 · 复制于 ${new Date().toISOString()}`;
      const text = [head, ...logLines].join('\n');
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(text);
        onToast && onToast(W.t.logsCopied(logLines.length));
      } catch (e) { onToast && onToast(W.t.logsCopyFailed); }
    };

    const accounts = st?.accounts || [];
    const activeId = st?.account?.id;
    const val = lastValidation;

    return h('div', { className: 'wr-root' },
      h('style', null, W.BASE_CSS + W.CSS_50),
      h('div', { className: 'wr-body' },
        h('div', { className: 'wr-set-grid' },

          // ---- 配置表单（宽面板：卡片全宽 + 内部双栏；窄面板：自动单列）----
          h('div', { className: 'wr-card wr-set-card wr-set-card--form' },
            h('div', { className: 'wr-set-title' }, W.I.folder(13), ' ', W.t.noteConfig),
            h('div', { className: 'wr-set-form-cols' },
              h('div', { key: 'col-sync' },
                h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.outputPath),
                  h('button', { className: 'wr-btn wr-btn-primary', disabled: validating, onClick: async () => {
                    if (W.pickDirectory) {
                      const dir = await W.pickDirectory();
                      if (dir) { set('outputPath')(dir); await validatePath(dir); }
                    } else {
                      setDirPickerOpen(true);
                    }
                  }, title: W.t.pickDirTip },
                    W.I.folder(12), ' ', W.t.chooseStorage),
                  dirPickerOpen && h(W.DirPickerModal, {
                    onClose: () => setDirPickerOpen(false),
                    onPick: async (p) => { setDirPickerOpen(false); set('outputPath')(p); await validatePath(p); },
                  }),
                  h('input', {
                    className: 'wr-input wr-set-field', placeholder: '/Users/you/Documents/WeRead',
                    value: form.outputPath, onChange: (e) => set('outputPath')(e.target.value) }),
                  h('button', { className: 'wr-btn', disabled: validating, onClick: () => validatePath() },
                    validating ? W.t.loading : W.t.validateApply)),
                validateErr && h('div', { className: 'wr-err wr-set-row' }, validateErr),
                val && h('div', { className: 'wr-validation' },
                  h('span', { className: val.status === 'passed' ? 'wr-ok' : 'wr-err' },
                    W.t.valStatus(val.status === 'passed')),
                  val.failReason && h('span', null, W.t.valReason(val.failReason)),
                  h('span', null, W.t.summaryLabel(val.summary || ''))),
                Toggle({ checked: form.autoSync, onChange: set('autoSync'), label: W.t.autoSync }),
                h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.syncInterval),
                  h('select', {
                    className: 'wr-select', value: form.syncInterval,
                    onChange: (e) => set('syncInterval')(e.target.value) },
                    ['12h', '24h', '72h'].map((v) => h('option', { key: v, value: v },
                      { 12: W.t.hoursOpt(12), 24: W.t.hoursOpt(24), 72: W.t.hoursOpt(72) }[v.replace('h', '')] || v)))),
                h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.categoryMode),
                  h('select', {
                    className: 'wr-select', value: form.categoryMode,
                    onChange: (e) => set('categoryMode')(e.target.value) },
                    h('option', { value: 'level1' }, W.t.level1),
                    h('option', { value: 'level2' }, W.t.level2))),
                h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.fileNameTemplate),
                  h('input', {
                    className: 'wr-input wr-set-field', value: form.fileNameTemplate,
                    placeholder: '{{title}}-{{author}}',
                    onChange: (e) => set('fileNameTemplate')(e.target.value) })),
                h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.noteTemplate),
                  h('input', {
                    className: 'wr-input wr-set-field', value: form.noteTemplate,
                    placeholder: '{{note}}',
                    onChange: (e) => set('noteTemplate')(e.target.value) })),
                Toggle({ checked: form.multiAccountEnabled, onChange: set('multiAccountEnabled'), label: W.t.multiAccount }),
                h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.weeklyGoal),
                  h('input', {
                    className: 'wr-input wr-num', type: 'number', min: 0, max: 10000, step: 5,
                    value: form.weeklyGoalNotes,
                    onChange: (e) => set('weeklyGoalNotes')(Math.max(0, Math.floor(Number(e.target.value)) || 0)) }),
                  h('span', { className: 'wr-muted wr-small' }, W.t.weeklyGoalHint)),
                h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.uiLanguage),
                  h('select', {
                    className: 'wr-select', value: form.language,
                    onChange: (e) => set('language')(e.target.value) },
                    h('option', { key: 'auto', value: 'auto' }, W.t.langAuto), // v1.8.7：默认跟随 DSH 宿主语言
                h('option', { key: 'zh-CN', value: 'zh-CN' }, W.t.langZhCN),
                    h('option', { key: 'zh-TW', value: 'zh-TW' }, W.t.langZhTW),
                    h('option', { key: 'en', value: 'en' }, W.t.langEn)))),
              h('div', { key: 'col-ui' },
                h('div', { className: 'wr-set-subtitle' }, W.t.uiIntegration),
                Toggle({ checked: form.uiSidebarKpi, onChange: set('uiSidebarKpi'), label: W.t.sidebarKpi }),
                Toggle({ checked: form.uiComposerRoaming, onChange: set('uiComposerRoaming'), label: W.t.composerRoaming }),
                // v1.7.19：小卡关闭时收起其专属设置（滚动方式/轮播/字号/速度只作用于小卡，关了就没意义）
                form.uiComposerRoaming && h('div', { key: 'wr-rm-sub' },
                  h('div', { className: 'wr-set-row' },
                    h('span', { className: 'wr-set-label' }, W.t.scrollModeLabel),
                    h('select', {
                      className: 'wr-select', value: form.uiRoamingScrollMode,
                      onChange: (e) => set('uiRoamingScrollMode')(e.target.value) },
                      h('option', { key: 'marquee', value: 'marquee' }, W.t.scrollMarquee),
                      h('option', { key: 'paged', value: 'paged' }, W.t.scrollPaged))),
                  Toggle({ checked: form.uiRoamingRotateEnabled, onChange: set('uiRoamingRotateEnabled'), label: W.t.rotateToggle }),
                  form.uiRoamingRotateEnabled && h('div', { className: 'wr-set-row' },
                    h('span', { className: 'wr-set-label' }, W.t.rotateSecLabel),
                    h('input', {
                      className: 'wr-input wr-num', type: 'number', min: 30, max: 1800, step: 10,
                      value: form.uiRoamingRotateSec,
                      onChange: (e) => set('uiRoamingRotateSec')(Math.min(1800, Math.max(30, Number(e.target.value) || 30))) })),
                  h('div', { className: 'wr-set-row' },
                    h('span', { className: 'wr-set-label' }, W.t.fontSizeLabel),
                    h('input', {
                      className: 'wr-input wr-num', type: 'number', min: 10, max: 16, step: 1,
                      value: form.uiRoamingFontSize,
                      onChange: (e) => set('uiRoamingFontSize')(Math.min(16, Math.max(10, Number(e.target.value) || 12))) })),
                  form.uiRoamingScrollMode !== 'paged' && h('div', { className: 'wr-set-row' },
                    h('span', { className: 'wr-set-label' }, W.t.marqueeSpeedLabel),
                    h('input', {
                      className: 'wr-input wr-num', type: 'number', min: 20, max: 100, step: 2,
                      value: form.uiRoamingScrollSpeed,
                      onChange: (e) => set('uiRoamingScrollSpeed')(Math.min(100, Math.max(20, Number(e.target.value) || 48))) }))),
                h('div', { className: 'wr-set-subtitle' }, W.t.aiIntegration,
                  h('span', { className: 'wr-muted wr-small' }, W.t.aiIntegrationDesc)),
                Toggle({ checked: form.ctxInjectEnabled, onChange: set('ctxInjectEnabled'), label: W.t.ctxInject }),
                form.ctxInjectEnabled && h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.ctxBookCountLabel),
                  h('input', {
                    className: 'wr-input wr-num', type: 'number', min: 1, max: 10, step: 1,
                    value: form.ctxBookCount,
                    onChange: (e) => set('ctxBookCount')(Math.min(10, Math.max(1, Math.floor(Number(e.target.value)) || 5))) })),
                form.ctxInjectEnabled && Toggle({ checked: form.ctxIncludeHighlights, onChange: set('ctxIncludeHighlights'), label: W.t.ctxHighlightsLabel }),
                form.ctxInjectEnabled && form.ctxIncludeHighlights && h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.ctxHighlightCountLabel),
                  h('input', {
                    className: 'wr-input wr-num', type: 'number', min: 1, max: 10, step: 1,
                    value: form.ctxHighlightCount,
                    onChange: (e) => set('ctxHighlightCount')(Math.min(10, Math.max(1, Math.floor(Number(e.target.value)) || 3))) })),
                form.ctxInjectEnabled && h('div', { className: 'wr-set-row' },
                  h('span', { className: 'wr-set-label' }, W.t.ctxExcludeLabel,
                    h('span', { className: 'wr-muted wr-small' }, W.t.ctxExcludeHint)),
                  h('input', {
                    className: 'wr-input wr-set-field', value: form.ctxExcludeTitles,
                    placeholder: W.t.ctxExcludePh,
                    onChange: (e) => set('ctxExcludeTitles')(e.target.value) })))),
            // 粘性保存条：长表单滚动中常驻可见
            h('div', { className: 'wr-save-bar' },
              h('button', { className: 'wr-btn wr-btn-primary', disabled: saving, onClick: saveConfig },
                saving ? W.t.loading : W.t.save))),

          // ---- 账号管理 ----
          h('div', { className: 'wr-card wr-set-card' },
            h('div', { className: 'wr-set-title' }, W.I.user(13), ' ', W.t.accounts),
            // v1.8.12：title 独占一行——卡级动作（重新登录）移到标题下方独立行右对齐，对齐笔记配置模块
            h('div', { className: 'wr-set-row', style: { justifyContent: 'flex-end', marginBottom: 6 } },
              h('button', {
                className: 'wr-mini',
                title: W.t.loginEntryTip,
                onClick: () => { try { window.dispatchEvent(new CustomEvent('weread:open-login')); } catch { /* ignore */ } },
              }, W.t.loginRelogin)),
            // v1.9.0 B2：Cookie 上次续命（时间+来源）——登录健康度首次对用户可见
            // v1.9.2 #9：标明「当前账号」——本卡列出全部账号，指纹却是活跃账号的，防多账号误读
            st?.loginChannels?.cookie?.origin?.at > 0 && h('div', {
              className: 'wr-muted wr-small', style: { marginTop: -6, marginBottom: 8 },
              title: `${W.t.activeAccount} · skey 尾号 ····${String(st.loginChannels.cookie.origin.skeyTail || '')}`,
            }, W.t.cookieOriginLabel(st.loginChannels.cookie.origin.at, st.loginChannels.cookie.origin.source)),
            accounts.length === 0
              ? h('div', { className: 'wr-muted wr-small' }, W.t.noData)
              : accounts.map((a) => h('div', { key: a.id, className: 'wr-account-row' },
                  // v1.8.10：每账号独立一行——头像 + 名称/活跃标签 + 右侧操作按钮组（窄面板按钮组整组换行）
                  a.avatar
                    ? h('img', { className: 'wr-account-avatar', src: a.avatar, alt: '', onError: (e) => { try { e.target.style.display = 'none'; } catch { /* ignore */ } } })
                    : h('span', { className: 'wr-account-avatar wr-account-avatar-ph' }, W.I.user(11)),
                  h('span', { className: 'wr-account-name' }, a.name || a.id,
                    a.id === activeId && h('span', { className: 'wr-active-tag' }, ` · ${W.t.activeAccount}`)),
                  h('span', { className: 'wr-account-ops' },
                    a.id !== activeId && h('button', {
                      className: 'wr-mini', onClick: () => switchAccount(a.id) }, W.t.switchAccount),
                    acctConfirm === a.id
                      ? h('button', { className: 'wr-mini wr-mini-danger', onClick: () => removeAccount(a.id) }, W.t.confirmDelete)
                      : h('button', {
                          className: 'wr-mini wr-mini-danger', onClick: () => setAcctConfirm(a.id) }, W.t.removeAccount))))),

          // ---- 官方通道（v1.1 API Key） ----
          h('div', { className: 'wr-card wr-set-card' },
            h('div', { className: 'wr-set-title' }, W.I.key(13), ' ', W.t.gatewayChannel),
            // v1.8.12：title 独占一行——绑定按钮移到标题下方独立行右对齐（仅未绑定时显示）
            !st?.gateway?.enabled && h('div', { className: 'wr-set-row', style: { justifyContent: 'flex-end', marginBottom: 6 } },
              h('button', {
                className: 'wr-mini',
                title: W.t.bindApiKeyTip,
                onClick: () => { try { window.dispatchEvent(new CustomEvent('weread:open-login', { detail: { tab: 'apikey' } })); } catch { /* ignore */ } },
              }, W.t.bindApiKey)),
            st?.gateway?.enabled && h('div', { className: 'wr-validation', style: { marginTop: -2, marginBottom: 8 } },
              h('span', { className: 'wr-ok' }, W.t.gatewayBound(st.gateway.keyTail, st.gateway.skillVersion))),
            st?.gateway?.enabled
              ? h('div', { className: 'wr-set-row' },
                  h('button', {
                    className: 'wr-btn', disabled: gwBusy,
                    onClick: async () => {
                      setGwBusy(true); setGwTest(null);
                      try { setGwTest(await W.post('/api/gateway/test', {})); } catch (e) { setGwTest({ ok: false, error: e.message || String(e) }); }
                      setGwBusy(false);
                    },
                  }, gwBusy ? W.t.gatewayTesting : W.t.gatewayTest),
                  h('button', {
                    className: 'wr-mini wr-mini-danger', disabled: gwBusy,
                    onClick: async () => {
                      try { await W.post('/api/gateway/unbind', {}); onToast && onToast(W.t.unboundOk); setGwTest(null); await refreshState(); }
                      catch (e) { onToast && onToast(e.message || W.t.unbindFailed); }
                    },
                  }, W.t.gatewayUnbind))
              : h('div', { className: 'wr-muted wr-small' }, W.t.apiKeyTip),
            gwTest && h('div', { className: 'wr-summary' },
              gwTest.ok
                ? W.t.gatewayTestOk(gwTest.latencyMs ?? '?', gwTest.apiCount || 0)
                : `✗ ${gwTest.error || W.t.failedWord}`),
            // v1.9.19：把原来的「原始 JSON 提示」换成一行人话 + 升级按钮（宿主只在「最新版 > 当前」时才给 upgrade）
            st?.gateway?.upgrade?.info && h('div', { className: 'wr-summary', style: { color: 'var(--dsw-alias-warning, #d29922)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
              h('span', null, W.t.skillUpgradeAvailable(st.gateway.skillVersion, String(st.gateway.upgrade.info.latest_version || '').replace(/^v/, '') || '?')),
              h('button', { className: 'wr-btn', disabled: skillBusy, title: W.t.skillUpgradeTip, onClick: doSkillUpgrade },
                skillBusy ? W.t.skillUpgrading : W.t.skillUpgradeBtn)),
            skillMsg && h('div', { className: 'wr-summary', style: { color: skillMsg.ok ? 'var(--dsw-alias-success, #3fb950)' : 'var(--dsw-alias-danger, #e5484d)' } },
              (skillMsg.ok ? '✓ ' : '✗ ') + skillMsg.text),
            st?.gateway?.skillVersionOverridden && h('div', { className: 'wr-muted wr-small' },
              W.t.skillUpgradedNote(st.gateway.skillVersion, st.gateway.bundledSkillVersion)),
            st?.syncState?.reconcile && h('div', { className: 'wr-set-row', style: { marginTop: 4 } },
              // 标签默认固定 110px，长内容会溢出与右侧状态文字叠印——本行放开宽度并整段不折行，行内放不下则整段换行
              h('span', { className: 'wr-set-label', style: { width: 'auto', flex: '0 1 auto', whiteSpace: 'nowrap' } }, W.t.gatewayReconcile,
                h('span', { className: 'wr-muted wr-small', style: { whiteSpace: 'nowrap' } }, `（${W.fmtDateTime(st.syncState.reconcile.checkedAt)}）`)),
              h('span', {
                className: 'wr-small',
                style: { color: st.syncState.reconcile.mismatchedCount > 0 ? 'var(--dsw-alias-warning, #d29922)' : 'var(--dsw-alias-success, #3fb950)' },
              }, st.syncState.reconcile.mismatchedCount > 0
                // v1.9.20：把整份对账结果交给文案——按「本地多于 / 少于服务端」说不同的话（全是重复时不该再提「漏采」）
                ? W.t.gatewayReconcileBad(st.syncState.reconcile.checkedBooks, st.syncState.reconcile.mismatchedCount, st.syncState.reconcile)
                : W.t.gatewayReconcileOk(st.syncState.reconcile.checkedBooks))),
            st?.syncState?.reconcile?.mismatchedCount > 0 && h('div', { className: 'wr-summary' },
              st.syncState.reconcile.mismatched.slice(0, 5).map((m) => W.t.reconcileRow(m.title, m.local, m.expected)).join('\n'),
              st.syncState.reconcile.mismatched.length > 5 ? W.t.reconcileMore(st.syncState.reconcile.mismatchedCount) : '')),

          h('div', { className: 'wr-card wr-set-card' },
            h('div', { className: 'wr-set-title' }, W.I.doc(13), ' ', W.t.dupCleanup),
            h('div', { className: 'wr-danger-zone' },
              h('button', { className: 'wr-btn', disabled: cleanupBusy, onClick: previewCleanup },
                cleanupBusy ? W.t.loading : W.t.previewCleanupBtn),
              cleanupState === 'preview' && h('button', {
                className: 'wr-btn wr-btn-primary', disabled: cleanupBusy, onClick: runCleanup }, W.t.runConfirm),
              cleanupState === 'done' && h('button', {
                className: 'wr-btn', disabled: cleanupBusy, onClick: restoreCleanup }, W.t.restoreCleanupBtn)),
            cleanupSummary && h('div', { className: 'wr-summary' }, typeof cleanupSummary === 'string'
              ? cleanupSummary
              : W.t.cleanupSummaryLine(
                  cleanupSummary.scanned ?? cleanupSummary.total ?? 0,
                  cleanupSummary.conflicts ?? cleanupSummary.conflictGroups ?? 0,
                  cleanupSummary.duplicates ?? cleanupSummary.moved ?? 0,
                  cleanupSummary.renamed ?? cleanupSummary.normalized ?? 0,
                )),
            cleanupResult && h('div', { className: 'wr-summary' }, typeof cleanupResult === 'string'
              ? cleanupResult
              : W.t.cleanupDoneLine(cleanupResult.manifestPath || ''))),

          // ---- 单例阅读窗口（v1.5：WebBar 单窗口容器模型，CDP 复用导航） ----
          h('div', { className: 'wr-card wr-set-card' },
            h('div', { className: 'wr-set-title' }, W.I.window(13), ' ', W.t.appWindowCardTitle),
            // v1.8.12：title 独占一行——就绪状态移到标题下方独立行
            h('div', { className: 'wr-small', style: { fontWeight: 400, color: 'var(--dsw-alias-success, #3fb950)', marginBottom: 6 } },
              '✓ ' + W.t.appWindowModeReady),
            h('div', { className: 'wr-muted wr-small', style: { lineHeight: 1.7 } }, W.t.appWindowModeDesc),
            // v1.8.20：关窗即退出（默认开）——程序坞不留图标 vs 重开秒回 的取舍开关
            Toggle({ checked: form.readerWindowQuitOnClose, onChange: set('readerWindowQuitOnClose'), label: W.t.readerQuitToggle }),
            h('div', { className: 'wr-muted wr-small', style: { lineHeight: 1.6, marginBottom: 6 } }, W.t.readerQuitHint),
            h('div', { className: 'wr-set-row' },
              h('button', { className: 'wr-btn', disabled: rwBusy, onClick: rwCheck },
                rwBusy && rwDiag === null ? W.t.readerWindowChecking : W.t.readerWindowCheck),
              h('button', { className: 'wr-btn', disabled: rwBusy, onClick: rwClose }, W.t.readerWindowClose)),
            rwDiag && h('div', { className: 'wr-muted wr-small', style: { lineHeight: 1.7 } },
              '· ', W.t.readerWindowStatus(rwDiag))),

          // ---- 日志 ----
          h('div', { className: 'wr-card wr-set-card' },
            h('div', { className: 'wr-set-title' }, W.I.terminal(13), ' ', W.t.logsTitle),
            h('div', { className: 'wr-set-row' },
              h('select', {
                className: 'wr-select', value: logChannel,
                onChange: (e) => setLogChannel(e.target.value) },
                ['op', 'roaming', 'dedupe', 'cleanup'].map((c) => h('option', { key: c, value: c }, c))),
              h('button', { className: 'wr-btn', disabled: logBusy, onClick: () => loadLogs(logChannel) }, W.t.refresh),
              // v1.9.17：复制已加载的日志（图标按钮；未加载/为空时禁用）
              h('button', {
                className: 'wr-btn', disabled: !logsCopyable, onClick: copyLogs,
                title: logsCopyable ? W.t.logsCopyTip : W.t.noData, 'aria-label': W.t.logsCopyTip,
                style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
                W.I.copy(12), W.t.copy),
              h('button', { className: 'wr-btn', onClick: clearLogs }, W.t.clearAll)),
            h('div', { className: 'wr-logbox' },
              logLines == null ? W.t.loading
                : logLines.length === 0 ? W.t.noData
                  : logLines.join('\n'))),
          // ---- 数据与卸载（v1.0） ----
          h('div', { className: 'wr-card wr-set-card' },
            h('div', { className: 'wr-set-title' }, W.I.inbox(13), ' ', W.t.dataUninstall),
            h('div', { className: 'wr-set-row' },
              h('button', { className: 'wr-btn', disabled: backupBusy, onClick: doBackup },
                backupBusy ? W.t.backupPacking : W.t.backupBtn),
              h('span', { className: 'wr-muted wr-small' }, W.t.backupHint)),
            h('div', { className: 'wr-muted wr-small', style: { marginBottom: 8 } },
              W.t.uninstallDesc1, h('code', null, '~/.dsh/weread/'), W.t.uninstallDesc2),
            h('div', { className: 'wr-set-row' },
              uninstallConfirm
                ? h('button', { className: 'wr-btn wr-btn-danger', onClick: doUninstallCleanup }, W.t.confirmCleanup)
                : h('button', { className: 'wr-btn', onClick: () => setUninstallConfirm(true) }, W.t.uninstallCleanBtn),
              uninstallConfirm && h('button', { className: 'wr-btn', onClick: () => setUninstallConfirm(false) }, W.t.cancel))),
          // v1.8.13：版本脚注——设置页一眼确认当前加载的构建（重启后核对是否已换新）
          h('div', { className: 'wr-muted wr-small', style: { gridColumn: '1 / -1', textAlign: 'center', padding: '2px 0 6px' } },
            `weread-dsh v${W.VERSION || '?'}`))));
  };
})();
