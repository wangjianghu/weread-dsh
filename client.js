/**
 * 微信读书 DSH 插件（Client 半）— 00-head
 * 由 parts/*.js 顺序拼接为 client.js；本文件定义共享命名空间 W。
 * 所有样式走 --dsw-alias-* 主题令牌；无 iframe、无外部 CDN。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-weread',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    const API = '/weread/api';
    const NS = 'weread';

    const W = {}; // 共享命名空间：各 part 向 W 挂载组件与工具

    // ---------- API ----------
    W.api = async function api(path, options) {
      // 兼容调用方传入以 /api 开头的完整契约路径，避免出现 /weread/api/api/...
      if (typeof path === 'string' && path.startsWith('/api/')) path = path.slice(4);
      const resp = await fetch(API + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      });
      if (!resp.ok) {
        let message = `${resp.status}`;
        try { message = (await resp.json()).error ?? message; } catch { /* 非 JSON */ }
        const err = new Error(message);
        err.status = resp.status;
        throw err;
      }
      return resp.json();
    };
    W.get = (p) => W.api(p);
    W.post = (p, body) => W.api(p, { method: 'POST', body: body ?? {} });

    // ---------- §11-6 实时总线：/weread/ws（断连自动退避重连；消费方各自保留轮询兜底） ----------
    W.bus = { online: false, subs: new Set() };
    W.onBus = (fn) => { W.bus.subs.add(fn); return () => { W.bus.subs.delete(fn); }; };
    (function connectBus(attempt) {
      try {
        const proto = location.origin.startsWith('https') ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/weread/ws`);
        let opened = false;
        let retried = false; // P0-2：onerror+onclose 双触发只计一次（原版重连链 2^n 扇出，实测 18s 155 万链）
        ws.onopen = () => { opened = true; W.bus.online = true; attempt = 0; };
        ws.onmessage = (ev) => {
          let m = null; try { m = JSON.parse(ev.data); } catch (e) { return; }
          for (const fn of [...W.bus.subs]) { try { fn(m); } catch (e) { /* 单个消费方异常不拖垮 others */ } }
        };
        const down = () => {
          if (retried) return; retried = true;
          if (opened) W.bus.online = false;
          const raw = 2500 * Math.pow(1.7, attempt);
          const d = Number.isFinite(raw) ? Math.min(30000, raw) : 5000; // attempt 溢出 NaN 兜底
          setTimeout(() => connectBus(attempt + 1), d * (0.8 + 0.4 * Math.random())); // ±20% jitter 防多页签同步风暴
        };
        ws.onclose = down; ws.onerror = down;
      } catch (e) { setTimeout(() => connectBus(attempt + 1), 5000); }
    })(0);

    // v1.5 单例阅读窗口打开结果 → toast（Host 统一决策：reader-window=单例窗口复用/新开；chrome-tab=拉起失败兜底；其余报错）
    // v1.7.18：loginExpired=窗口开了但微信读书 Cookie 服务端已死（书页会「加载失败」）——归因引导重扫，不当「窗口坏了」报障
    W.readerToast = (r, onToast) => {
      if (!onToast) return;
      if (r?.mode === 'reader-window') onToast(r?.loginExpired ? W.t.loginExpiredToast : W.t.openedAppWindow);
      else if (r?.mode === 'chrome-tab') onToast(W.t.openedTabMode);
      else onToast(r?.error || W.t.openReaderFail);
    };

    // ---------- 文案（zh） ----------
    W.t = {
      panel: '微信读书',
      bookshelf: '书架', insights: '洞察', roaming: '漫游', settings: '设置',
      detail: '笔记详情',
      login: '登录微信读书', loginProtocol: '扫码登录', loginCookie: '粘贴 Cookie 登录',
      logout: '登出', sync: '同步笔记', syncing: '同步中…', syncDone: '同步完成', syncFailed: '同步失败',
      search: '搜索书架', searchNotes: '搜索笔记', clearFilter: '清除筛选',
      collapseAll: '全部折叠', expandAll: '全部展开',
      notLoggedIn: '未登录，同步不可用，可浏览本地数据', loginHint: '点击登录微信读书',
      loginExpiredBanner: '登录已过期——本地数据可浏览，同步需重新登录', relogin: '重新登录',
      apiDegraded: '微信读书接口不可达，正在展示本地数据（登录与同步暂不可用）',
      empty: '书架为空', emptyDesc: '登录并同步后，笔记会保存在配置的目录中',
      books: '本书', notes: '条笔记', highlights: '条划线',
      uncategorized: '未分类', publicAccount: '公众号',
      refresh: '刷新', chapters: '章', chapterNav: '章节导航', noNotes: '暂无笔记',
      exportImage: '导出图片', exportReport: '导出月报', confirm: '确认导出', cancel: '取消',
      favorite: '收藏', reviewed: '已复习', todayReviewed: '今日已复习',
      prevCard: '上一条', nextCard: '下一条', skip: '跳过', openSource: '原文',
      outputPath: '笔记存储路径', pickFolder: '选择文件夹', manualInput: '手动输入路径',
      save: '保存并应用', autoSync: '自动同步', syncInterval: '同步间隔',
      categoryMode: '分类层级', level1: '一级分类', level2: '完整分类',
      fileNameTemplate: '文件名模板', noteTemplate: '笔记模板',
      accounts: '账号管理', switchAccount: '切换账号', removeAccount: '删除账号', addAccount: '新增账号',
      activeAccount: '当前活跃', retry: '重试', copy: '复制', copied: '已复制',
      loading: '加载中…', loadFailed: '加载失败', noData: '暂无数据',
      viewCard: '卡片', viewTree: '树状', showMore: '显示更多', backBookshelf: '返回书架',
      noteConfig: '笔记配置', uiIntegration: '界面集成',
      otpTitle: '输入验证码', otpPlaceholder: '6 位验证码', submit: '提交',
      scanTip: '请使用微信扫描二维码，并在手机确认登录',
      cookieVid: 'wr_vid', cookieSkey: 'wr_skey', cookieTip: '在浏览器登录 weread.qq.com 后，F12 → Application → Cookies 复制以下字段',
      loginApiKey: 'API Key（官方）',
      apiKeyLabel: 'API Key（wrk- 开头）',
      apiKeyPlaceholder: 'wrk-…',
      apiKeyTip: '官方通道：打开 weread.qq.com/r/weread-skills 登录后复制 API Key 粘贴到此。已登录时将绑定到当前账号（推荐）；未登录时作为独立账号。仅本人可见、存于本机 Keychain。',
      apiKeyBoundTip: '已登录状态：此 Key 将绑定到当前账号，用于想法/书评补采与同步对账。',
      apiKeyOpenPage: '打开官网获取 Key',
      apiKeyAttached: '已绑定到当前账号',
      apiKeyUpdate: '更新 Key',
      apiKeyBoundState: (t) => `官方通道已绑定（尾号 ${t}），提交新 Key 将覆盖`,
      channelBoundOk: (t) => `已绑定 ····${t}（有效）`,
      channelBoundStale: (t) => `已绑定 ····${t}（待复核）`,
      channelAbsent: '未配置',
      channelCookieOk: 'Cookie 有效',
      channelCookieExpired: 'Cookie 已过期',
      channelCookieUnknown: '已配置（自动核验未完成）',
      channelVerifying: '校验中…',
      channelLegendHint: '悬停查看各通道状态',
      legendValid: '有效', legendExpired: '已过期', legendAbsent: '未配置',
      unselectedWord: '未选中',
      appWindowRead: '阅读窗口',
      openReaderAppTip: '在单例阅读窗口中打开（始终复用同一个窗口）',
      dockTip: '阅读窗口打开最近的书（拖拽移动位置；无书记录时打开微信读书首页）',
      viewDetailAppTip: '在阅读窗口打开书籍详情页（站内可继续跳转）',
      appWindowCardTitle: '单例阅读窗口',
      openedTabMode: '阅读窗口拉起失败，已在 Chrome 窗口新页签打开（兜底）',
      appWindowModeReady: '单例阅读窗口已启用',
      appWindowModeDesc: '打开书籍始终复用同一个专用 Chrome 窗口：换书时原窗口内直接导航，不开新窗口、不累积页签、也不用默认浏览器。窗口登录态独立保存：失效时会自动补入插件账号的最新 Cookie，或扫码一次即可。',
      readerQuitToggle: '关窗即退出 Chrome 实例',
      readerQuitHint: '开：关窗后程序坞不留图标，下次打开全新拉起（约 1-2 秒）；关：实例常驻、重开秒回，但程序坞图标滞留。',
      appWindowTip: '在专用 Chrome 窗口打开（顶层上下文，无第三方嵌入，不触发风控）',
      openedAppWindow: '已在阅读窗口打开',
      openReaderFail: '打开阅读窗口失败',
      loginExpiredToast: '窗口已打开，但微信读书登录已过期（书页会显示「加载失败」）：请到 设置→登录 重新扫码。笔记同步不受影响',
      readerWindowCheck: '检测阅读窗口',
      readerWindowChecking: '检测中…',
      readerWindowClose: '关闭阅读窗口',
      readerWindowCloseDone: '阅读窗口已关闭',
      readerWindowStatus: (s) => {
        if (!s) return '';
        if (!s.chromeFound) return '未找到 Google Chrome（阅读窗口依赖 Chrome）';
        if (s.windowAlive) return `窗口运行中 · ${s.windowUrl || s.lastUrl || ''}`.slice(0, 90);
        if (s.cdpAlive) return '实例在但窗口已关（下次打开会自动重开）';
        return s.lastUrl ? '窗口未在运行（下次打开会自动拉起）' : '尚未使用过';
      },
      exportCardTip: '生成分享卡片图',
      copyImageFailed: '复制图片失败',
      exportTip: '卡片图与漫游导出同款：主题八选一、时间可选笔记时间或当前时间',
      minutesShort: '分钟',
      bestHighlights: '热门划线',
      bestHighlightsUnit: '条',
      bestHighlightsTip: '全书划线人数最多的段落（官方数据）',
      bestHighlightPeople: (n) => `${n} 人划线`,
      channelCheckedAt: (t) => `最近校验：${t}`,
      channelCookieSharedTip: '扫码与粘贴 Cookie 是同一份凭据（wr_vid/wr_skey），状态共用',
      menuLogin: '登录账号',
      menuLogout: '退出账号',
      loggedOutToast: '已退出登录',
      logoutFailed: '退出失败',
      gatewayChannel: '官方通道（API Key）',
      gatewayUnbind: '解绑',
      gatewayTest: '连通性测试',
      gatewayTesting: '测试中…',
      gatewayOk: '官方网关连通',
      gatewayReconcile: '同步对账',
      gatewayReconcileOk: (n) => `${n} 本书与服务端计数一致`,
      gatewayReconcileBad: (n, m) => `${m}/${n} 本计数不一致（可能漏采，点击详情排查）`,
      delete: '删除', confirmDeleteBook: '确认删除该书的本地笔记文件？',
      openFolder: '在文件夹中显示', days: '天',
      exportThemes: '背景主题', timeCreate: '笔记创建时间', timeShare: '当前分享时间',
      // ---- v1.2 全量深层文案（原各组件硬编码中文字面量，含插值函数） ----
      // 登录/同步/书架（10-bookshelf）
      apiKeyRequired: '请填写 API Key', apiKeyLoginFailed: '登录失败，请检查 API Key 是否有效',
      otpFailed: '验证失败', scannedTip: '已扫码，请在手机确认…', confirmingTip: '正在确认登录…',
      cookieRequired: '请填写 wr_vid 与 wr_skey', cookieLoginFailed: '登录失败，请检查 Cookie 是否有效',
      syncNoUpdate: '无更新', loginRequired: '请先登录', syncFailed: '同步失败',
      // v1.9.3 软取消（协作式：在飞书完成后停止，已完成部分保留，下次同步自动补齐）
      syncCancel: '取消', syncCancellingBtn: '取消中…',
      syncCancelling: '正在取消——在飞的书完成后即停（已完成部分保留）',
      syncCancelledToast: '同步已取消，已完成部分保留（下次同步自动补齐）',
      syncCancelTip: '停止本轮同步：正在处理的书完成后即停，已完成的保留；未完成的书下次同步自动补齐',
      accountSwitched: '已切换账号', switchFailed: '切换失败',
      loginSuccessSyncing: '登录成功，正在同步…', autoSyncFailed: '自动同步启动失败',
      viewCardTitle: '卡片视图（封面+分页）', viewTreeTitle: '树状视图',
      noMatch: (q) => `未找到匹配「${q}」的书籍`,
      prevPage: '上一页', nextPage: '下一页',
      pagerInfo: (p, t, n) => `${p} / ${t} 页 · 共 ${n} 本`,
      cardTooltip: (title, author, progress, highlights) => `${title}\n${author}\n进度 ${progress}% · 划线 ${highlights}`,
      bookLetter: '书', anonymous: '佚名', titleHighlights: '划线', titleNotes: '笔记',
      showMoreRemain: (n) => `显示更多（剩余 ${n} 本）`,
      openFolderFailed: '打开文件夹失败', deletedNoteFile: (t) => `已删除笔记文件：${t}`,
      deleteFailed: '删除失败', confirmDelete: '确认删除？',
      // 笔记详情（20-detail）
      refreshFailed: '刷新失败', selEmpty: '先点选要摘录的笔记',
      copiedExcerpts: (n) => `已复制 ${n} 条摘录（含出处），可直接粘贴到写作中`,
      copyFailedManual: '复制失败，请手动选择文本',
      statProgress: (v) => `进度 ${v}%`, statNotes: (n) => `笔记 ${n} 条笔记`, statHighlightsInfo: (n) => `划线 ${n} 条划线`,
      selModeTip: '多选笔记，复制为带出处的引用块（写作取材）',
      exitSelMode: '退出多选', enterSelMode: '摘录多选', selectedWord: '已选',
      selCount: (n) => `已选 ${n} 条笔记`, copyQuotes: '复制引用块（含出处）',
      // 阅读洞察（30-insights）
      reportExported: (p) => `月报已导出：${p || '完成'}`,
      exportFailed: (m) => `导出失败：${m}`,
      aiPrompt: (p) => `请解读我的微信读书阅读报告 ${p}：总结阅读习惯与亮点，指出不足，给出 3 条可执行的改进建议。`,
      promptCopied: '已复制解读提示，粘贴到输入框发送即可',
      promptCopyFailed: (p) => `复制失败，请手动引用：${p}`,
      allData: '全部数据', rangeLastDays: (n) => `最近 ${n} 天`, optLastDays: (n) => `最近${n}天`,
      weekdaysShort: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      weekdaysLong: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
      typeBoth: '划线+想法', typeThought: '想法', typeHighlight: '划线', typeNote: '笔记',
      typeChapter: '章节笔记', typeReview: '书评',
      kpiActiveDays: '活跃天数', kpiStreak: '最长连续', kpiTotalNotes: '笔记总数',
      kpiDensity: '笔记密度', kpiDeepRatio: '深度笔记占比', kpiAvgCompletion: '平均完成率', kpiAvgNotes: '平均每本笔记数',
      unitDays: ' 天', unitPer100Pages: ' /100页',
      allCategories: '全部分类', allNoteTypes: '全部笔记类型',
      onlyHighlights: '仅划线', onlyThoughts: '仅想法', onlyChapterNotes: '仅章节笔记', onlyReviews: '仅书评',
      trendByDay: '按天趋势', trendByWeek: '按周趋势', finishedOnlyLabel: '仅完读',
      exporting: '导出中…',
      aiRead: '🤖 AI 解读', aiReadTip: (p) => `${p}（复制提示词后粘贴到输入框）`,
      goalTip: (n) => `每周目标 ${n} 条；本周进行中不计入连续`,
      goalThisWeek: (a, b) => `🎯 本周 ${a}/${b}`, goalStreakWeeks: (n) => ` · 连续 ${n} 周`,
      insightsLoading: '正在加载阅读洞察数据…',
      notLoggedInPrefix: '尚未登录——', goLogin: '去登录', loginSyncHint: ' 登录并同步后这里会出现阅读数据。',
      noInsightData: '暂无阅读数据，请先同步书架或检查本地笔记目录。',
      noInsightDataHint: ' 可切换到"全部数据"查看历史记录。',
      insightsLoaded: (range, notes, books) => `已加载 ${range} 的阅读数据，共 ${notes} 条笔记，覆盖 ${books} 本重点书籍。`,
      trendTitle: '阅读趋势（阅读活跃 / 笔记产出）', legendNotes: '笔记产出', legendActive: '阅读活跃',
      legendAllOff: '请至少开启一个图例系列',
      tipTouched: (v) => ` · 阅读活跃: ${v}`, tipNotesFull: (v, w) => ` · 笔记产出: ${v}<br>阅读活跃: ${w}`, tipNotesOnly: (v) => ` · 笔记产出: ${v}`,
      topBooksTitle: '高价值书籍 Top10',
      thBook: '书籍', thNotes: '笔记', thCompletion: '完成率', thDeepRatio: '深度占比 ', thValue: '价值分 ',
      tipDeepRatio: '深度笔记数/总笔记数（深度定义：想法≥50字 或 划线≥100字）',
      tipValueScore: '笔记产出分50% + 深度占比30% + 完成率20%（单本 20 条笔记即满产出分）',
      timelineTitle: '最近笔记时间线', noTextContent: '（无文本内容）',
      heatmapTitle: '活跃时段热力图（7x24）', categoryShareTitle: '分类主题占比（按笔记量）',
      authorCloudTitle: '偏好作者云图', authorReadCount: (n) => `阅读 ${n} 本`,
      radarTitle: '阅读偏好雷达图', subLevel: '二级分类', radarTooFew: '分类数量不足',
      radarCount: (c, n) => `${c}: ${n}本`,
      scatterTitle: '书籍散点分析（阅读时长 vs 笔记密度）',
      axisMinutes: '时长(min)', axisDensity: '密度', highValueZone: '高价值区',
      scatterTip: (t, m, d) => `${t} · 时长 ${m}min · 密度 ${d}`,
      // 笔记漫游（40-roaming）
      unnamedBook: '未命名书籍',
      actionFailed: (m) => `操作失败：${m}`, filterFailedToast: (m) => `筛选失败：${m}`,
      reviewMarked: '已标记为已复习', reviewRescheduled: '已重新安排（明天再来一次）',
      noCardToExport: '暂无可导出的卡片',
      exportFileName: (t, d) => `笔记卡片_${t}_${d}.png`, exportingImage: '正在导出图片…',
      pillAll: '全部', pillHighlight: '高亮', pillChapter: '章节',
      roamingTitle: '笔记漫游', ringTip: '已浏览 / 总池',
      refreshBtn: '刷新 (R)', dataBtn: '数据 (D)', dataBtnTip: '数据统计 (D)',
      statSessionViewed: '会话浏览(次)', statTodayReviewed: '今日复习(次)', statFavRate: '收藏率', statPoolSize: '漫游池(条)',
      recent7Reviews: '近7天复习', timesUnit: '次',
      dailyTip: (d, v) => `${d}：复习 ${v} 次`,
      unreviewedLabel: '未复习 > ',
      reviewModeTip: 'SM-2 间隔重复：只出到期卡，按到期先后排序',
      reviewModePre: '🎯 复习模式 · 剩 ', reviewModePost: ' 张',
      dueBtn: (n) => `🎯 今日复习（${n} 张）`, dueBtnTip: '只出到期卡，按 SM-2 记忆曲线安排',
      endReview: '结束复习', clearAll: '清空',
      roamingLoading: '正在加载漫游卡片…',
      roamingLoginHint: '尚未登录——登录并同步后，这里会出现你的笔记。',
      emptyPool: '当前筛选条件下没有可用笔记（可清除筛选或先同步）',
      cooldownFiltered: '卡片都在冷却中，稍后再来看看',
      noDueCards: '今日没有到期的复习卡（明天再来，或先随便漫游）',
      reviewDone: '今日复习完成 🎉 明天见', noCardAvailable: '当前暂无可用卡片',
      favAlready: '已收藏', reviewCountLabel: (n) => `🔄 复习 ${n} 次`,
      remember: '记得', forgot: '忘记', detailWord: '详情', exportWord: '导图',
      refreshWord: '刷新', dataWord: '数据',
      cardIndex: (n) => `第 ${n} 条`,
      forgotTipReview: '忘记 (X)：间隔重置，明天再来', forgotTipNormal: '忘记 (X)：标记没记住，明天优先再见',
      forgotBtn: '😵 忘记 X',
      rememberTipReview: '记得 (Space)：按记忆曲线拉长间隔', rememberTipNormal: '记得 (Space)：按记忆曲线安排下次复习',
      goodBtnDone: '✓ 今日已复习 · 记得 Space', goodBtn: '🙂 记得 Space',
      noteBtnTip: '查看笔记 (O)', exportBtnTip: '导图 (I)', skipBtnTip: '跳过 (J)',
      exportModalTitle: '导出笔记卡片图片', previewWord: '预览', previewFailed: '预览生成失败',
      theme_white: '纯白', theme_gray: '浅灰', theme_yellow: '暖黄', theme_green: '浅绿',
      theme_dark: '暗夜黑', theme_blue: '深蓝', theme_pink: '莫兰迪粉', theme_kraft: '牛皮纸',
      copyImageTip: '复制后粘贴到输入框，即可作为图片发送给 AI',
      imageCopied: '已复制图片，粘贴到输入框即可发送', imageCopyFailed: '复制失败，请改用确认导出',
      copyImageBtn: '复制图片（粘贴进对话）',
      // 设置（50-settings）
      dirPickerTitle: '选择笔记存储位置', parentDir: '上一级', noSubfolders: '（此处没有子文件夹）',
      newFolderPrompt: '新建文件夹名：', newFolderBtn: '新建文件夹', chooseThisDir: '选择此目录',
      backupDone: (p) => `备份已生成：${p}`, backupDefaultDir: '下载目录', backupFailed: (m) => `备份失败：${m}`,
      uninstallCleanupDone: (k, f) => `清理完成：Keychain ${k} 项、状态文件 ${f} 个；笔记目录未动。请到插件管理页禁用/移除本插件。`,
      cleanupFailedToast: (m) => `清理失败：${m}`,
      settingsSaved: '设置已保存', saveFailed: '保存失败',
      pathEmpty: '路径不能为空', validateFailedWord: '校验失败', pathValidated: '路径校验通过',
      accountRemoved: '已删除账号', previewFailedToast: '预览失败',
      cleanupFinished: '清理完成', cleanupDoneLine: (p) => `清理完成${p ? `，清单：${p}` : ''}`, cleanupRunFailed: '清理失败',
      restoreDoneLine: (s) => (s ? `回滚完成：${s}` : '回滚完成'), restoreFailed: '回滚失败',
      logsLoadFailed: '读取日志失败', logsCleared: '日志已清空', clearFailed: '清空失败',
      pickDirTip: '打开目录选择窗口', chooseStorage: '选择存储位置…', validateApply: '校验并应用',
      valStatus: (ok) => `状态：${ok ? '通过' : '失败'}`, valReason: (r) => `原因：${r}`, summaryLabel: (s) => `summary：${s}`,
      hoursOpt: (n) => `${n} 小时`,
      multiAccount: '多账号模式', weeklyGoal: '周目标(条笔记)', weeklyGoalHint: '0=关闭；达标进度显示在洞察页',
      uiLanguage: '界面语言',
      langAuto: '跟随 DSH 界面语言',
      loginAccountHint: (name, multi) => name
        ? (multi ? `当前：${name} · 新登录将新增另一个账号（多账号已开）` : `当前：${name} · 新登录将替换此账号（多账号已关）`)
        : '尚未登录任何账号，登录即创建第一个账号',
      langZhCN: '简体中文', langZhTW: '繁體中文', langEn: 'English',
      sidebarKpi: '侧栏阅读 KPI 胶囊', composerRoaming: '输入框下方漫游小卡',
      scrollModeLabel: '小卡滚动方式', scrollMarquee: '跑马灯（匀速循环）', scrollPaged: '逐行轮播（每行 10 秒）',
      rotateToggle: '小卡笔记随机轮播', rotateSecLabel: '轮播间隔(秒)',
      fontSizeLabel: '小卡字号(px)', marqueeSpeedLabel: '跑马灯速度(px/s)',
      aiIntegration: 'AI 集成', aiIntegrationDesc: '对话上下文注入（systemPrompt）',
      ctxInject: '注入「用户近期阅读」上下文（新会话生效）', ctxBookCountLabel: '注入书数(本)',
      ctxHighlightsLabel: '附带最新划线原文', ctxHighlightCountLabel: '划线条数',
      ctxExcludeLabel: '排除书名', ctxExcludeHint: '（含关键词即排除，逗号分隔）', ctxExcludePh: '例：小说A, 漫画B',
      loginEntryTip: '打开登录弹层（扫码 / 粘贴 Cookie / API Key）', loginRelogin: '登录 / 重新登录',
      // v1.9.0 B2：Cookie 来源指纹（at=毫秒时间戳，source=login|head-refresh|window）
      cookieOriginLabel: (at, source) => {
        const src = { login: '扫码/Cookie 登录', 'head-refresh': '自动续命', window: '阅读窗口回流' }[source] || source || '—';
        const mins = Math.max(0, Math.floor((Date.now() - at) / 60000));
        const rel = mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : mins < 1440 ? `${Math.floor(mins / 60)} 小时前` : `${Math.floor(mins / 1440)} 天前`;
        return `当前账号 Cookie 上次续命：${rel} · 来源：${src}`;
      },
      gatewayBound: (t, v) => `已绑定 ····${t} · skill v${v}`,
      bindApiKeyTip: '打开登录弹层（直达 API Key tab）', bindApiKey: '绑定 API Key',
      unboundOk: '已解绑 API Key（登录态不变）', unbindFailed: '解绑失败',
      gatewayTestOk: (ms, n) => `${W.t.gatewayOk}（${ms}ms${n ? `，可用接口 ${n} 个` : ''}）`,
      failedWord: '失败', skillVersionTip: (s) => `官方 Skill 版本提示：${s}`,
      reconcileRow: (t, l, e) => `《${t}》 本地 ${l} / 服务端 ${e}`, reconcileMore: (n) => `\n… 共 ${n} 本`,
      dupCleanup: '重复文件清理', previewCleanupBtn: '预览清理结果', runConfirm: '确认执行', restoreCleanupBtn: '回滚上次清理',
      cleanupSummaryLine: (s, c, d, r) => `扫描 ${s} 个文件，冲突 ${c} 组，将迁移 ${d} 个重复文件，重命名 ${r} 个`,
      logsTitle: '日志', dataUninstall: '数据与卸载',
      backupPacking: '打包中…', backupBtn: '📦 打包全量备份（zip → 下载目录）',
      backupHint: '笔记目录 + 状态文件（不含凭据）',
      uninstallDesc1: '卸载清理将删除：钥匙串凭据镜像、',
      uninstallDesc2: ' 全部状态文件（含漫游进度与复习数据）。不会删除你的笔记目录与备份 zip。清理后请在插件管理页禁用或移除本插件。',
      confirmCleanup: '确认执行清理（不可恢复）', uninstallCleanBtn: '🧹 卸载前清理本机数据',
      // ---- v1.3 发现页 + 官方阅读统计（55-discover / 30-insights；官方网关数据） ----
      discoverTab: '发现',
      officialStats: '官方阅读统计',
      statsWeekly: '本周', statsMonthly: '本月',
      statsTotalTime: '总时长', statsReadDays: '有效天数', statsDailyAvg: '日均', statsCompare: '环比',
      statsHoursFn: (hh, mm) => (hh > 0 ? `${hh}小时${mm}分` : `${mm}分`),
      statsTopBooks: '读得最多', statsPreferCats: '偏好分类',
      countBooks: (n) => `${n} 本`,
      readingPeople: (n) => `${n} 人在读`,
      statsBindHint: '绑定 API Key 后可在此查看官方阅读统计（时长 / 有效天数 / 偏好分类）',
      discoverBindHint: '绑定 API Key 后可搜全书城书刊、听书与公众号，并获得个性化推荐；绑定不影响现有登录，随时可解绑',
      searchPlaceholder: '搜书名/作者/关键词…', searchBtn: '搜索',
      scopeBook: '找书', scopeAll: '全部', scopeAudio: '听书', scopeAuthor: '作者', scopeFulltext: '全文', scopeMp: '公众号',
      searchEmpty: '没有找到相关结果', searchFailed: '搜索失败',
      openReader: '打开阅读', viewDetail: '详情',
      forYou: '为你推荐', refreshBatch: '换一批', reason: '推荐理由',
      // App 壳（90-tail）
      apiWarnTip: (t, r) => `最近检测：${t} · ${r}`, rowConfig: '微信读书配置',
    };

    // ---------- i18n（v1.2：zh / zh-TW / en 三语全量字典；zh-TW 缺键回退 zh，再无则键名） ----------
    W.T_ZH = { ...W.t };
    W.T_EN = {
      panel: 'WeRead', bookshelf: 'Books', insights: 'Insights', roaming: 'Roam', settings: 'Settings',
      detail: 'Note Detail',
      login: 'Log in to WeRead', loginProtocol: 'Scan QR', loginCookie: 'Paste Cookie',
      logout: 'Log out', sync: 'Sync notes', syncing: 'Syncing…', syncDone: 'Sync done', syncFailed: 'Sync failed',
      search: 'Search shelf', searchNotes: 'Search notes', clearFilter: 'Clear filter',
      collapseAll: 'Collapse all', expandAll: 'Expand all',
      notLoggedIn: 'Not logged in — sync unavailable, local data readable', loginHint: 'Click to log in',
      loginExpiredBanner: 'Login expired — local data readable, re-login to sync', relogin: 'Re-login',
      apiDegraded: 'WeRead API unreachable — showing local data (login & sync paused)',
      empty: 'Shelf is empty', emptyDesc: 'Log in and sync; notes will be saved to the configured folder',
      books: 'books', notes: 'notes', highlights: 'highlights',
      uncategorized: 'Uncategorized', publicAccount: 'Articles',
      refresh: 'Refresh', chapters: 'chapters', chapterNav: 'Chapters', noNotes: 'No notes yet',
      exportImage: 'Export image', exportReport: 'Export report', confirm: 'Confirm', cancel: 'Cancel',
      favorite: 'Favorite', reviewed: 'Reviewed', todayReviewed: 'Reviewed today',
      prevCard: 'Prev', nextCard: 'Next', skip: 'Skip', openSource: 'Source',
      outputPath: 'Notes folder', pickFolder: 'Choose folder', manualInput: 'Type path',
      save: 'Save & apply', autoSync: 'Auto sync', syncInterval: 'Interval',
      categoryMode: 'Category level', level1: 'Top-level', level2: 'Full',
      fileNameTemplate: 'Filename template', noteTemplate: 'Note template',
      accounts: 'Accounts', switchAccount: 'Switch', removeAccount: 'Remove', addAccount: 'Add',
      activeAccount: 'active', retry: 'Retry', copy: 'Copy', copied: 'Copied',
      loading: 'Loading…', loadFailed: 'Load failed', noData: 'No data',
      viewCard: 'Cards', viewTree: 'Tree', showMore: 'Show more', backBookshelf: 'Back to shelf',
      noteConfig: 'Notes', uiIntegration: 'UI integration',
      otpTitle: 'Enter code', otpPlaceholder: '6-digit code', submit: 'Submit',
      scanTip: 'Scan with WeChat and confirm on your phone',
      cookieVid: 'wr_vid', cookieSkey: 'wr_skey', cookieTip: 'After logging in at weread.qq.com, copy these fields from F12 → Application → Cookies',
      loginApiKey: 'API Key (official)',
      apiKeyLabel: 'API Key (starts with wrk-)',
      apiKeyPlaceholder: 'wrk-…',
      apiKeyTip: 'Official channel: log in at weread.qq.com/r/weread-skills and paste the API Key here. Binds to the current account when logged in; otherwise logs in as a standalone account. Stored only in your local Keychain.',
      apiKeyBoundTip: 'Logged in: this key binds to the current account for thought/review sync and reconciliation.',
      apiKeyOpenPage: 'Open official page',
      apiKeyAttached: 'Bound to current account',
      apiKeyUpdate: 'Update key',
      apiKeyBoundState: (t) => `Official channel bound (····${t}); submitting a new key replaces it`,
      channelBoundOk: (t) => `Bound ····${t} (valid)`,
      channelBoundStale: (t) => `Bound ····${t} (unverified)`,
      channelAbsent: 'Not set up',
      channelCookieOk: 'Cookie valid',
      channelCookieExpired: 'Cookie expired',
      channelCookieUnknown: 'Present (auto-check incomplete)',
      channelVerifying: 'Checking…',
      channelLegendHint: 'Hover a channel for its status',
      legendValid: 'valid', legendExpired: 'expired', legendAbsent: 'not set up',
      unselectedWord: 'Not selected',
      appWindowRead: 'Reader window',
      openReaderAppTip: 'Open in the singleton reader window (always the same window)',
      dockTip: 'Open your latest book in the reader window (drag to move; opens the WeRead home page when no book yet)',
      viewDetailAppTip: 'Open the book detail page in the reader window (full site navigation)',
      appWindowCardTitle: 'Singleton reader window',
      openedTabMode: 'Reader window failed to launch — opened in a Chrome tab instead (fallback)',
      appWindowModeReady: 'Singleton reader window enabled',
      appWindowModeDesc: 'Books always open in one dedicated Chrome window: switching books navigates in place — no new windows, no accumulating tabs, never the default browser. The window keeps its own login: when it expires, the plugin automatically tops it up with its latest stored cookies, or scan the QR code once.',
      readerQuitToggle: 'Quit Chrome when window closes',
      readerQuitHint: 'On: no lingering Dock icon, next open relaunches in ~1-2s; Off: instance stays for instant reopen, but the Dock icon lingers.',
      appWindowTip: 'Open in a dedicated Chrome window (top-level context, no embed, no risk warning)',
      openedAppWindow: 'Opened in the reader window',
      openReaderFail: 'Failed to open the reader window',
      loginExpiredToast: 'Window opened, but WeRead login expired (pages show "Load failed"): re-scan the QR code in Settings → Login. Note sync is unaffected',
      readerWindowCheck: 'Check reader window',
      readerWindowChecking: 'Checking…',
      readerWindowClose: 'Close reader window',
      readerWindowCloseDone: 'Reader window closed',
      readerWindowStatus: (s) => {
        if (!s) return '';
        if (!s.chromeFound) return 'Google Chrome not found (the reader window requires Chrome)';
        if (s.windowAlive) return `Running · ${s.windowUrl || s.lastUrl || ''}`.slice(0, 90);
        if (s.cdpAlive) return 'Instance alive but window closed (reopens on next open)';
        return s.lastUrl ? 'Not running (will launch on next open)' : 'Not used yet';
      },
      exportCardTip: 'Generate share card image',
      exportWord: 'Card',
      copyImageFailed: 'Failed to copy image',
      exportTip: 'Same card as roaming export: 8 themes, note time or current time',
      minutesShort: 'min',
      bestHighlights: 'Popular highlights',
      bestHighlightsUnit: 'items',
      bestHighlightsTip: 'Most-highlighted passages of this book (official data)',
      bestHighlightPeople: (n) => `${n} people highlighted`,
      channelCheckedAt: (t) => `Last checked: ${t}`,
      channelCookieSharedTip: 'Scan QR and paste Cookie share the same credentials (wr_vid/wr_skey)',
      menuLogin: 'Log in',
      menuLogout: 'Log out',
      loggedOutToast: 'Logged out',
      logoutFailed: 'Log out failed',
      gatewayChannel: 'Official channel (API Key)',
      gatewayUnbind: 'Unbind',
      gatewayTest: 'Connectivity test',
      gatewayTesting: 'Testing…',
      gatewayOk: 'Official gateway reachable',
      gatewayReconcile: 'Sync reconciliation',
      gatewayReconcileOk: (n) => `${n} books match server counts`,
      gatewayReconcileBad: (n, m) => `${m}/${n} books mismatched (possible missing notes)`,
      delete: 'Delete', confirmDeleteBook: 'Delete this book’s local note file?',
      openFolder: 'Reveal in folder', days: 'days',
      exportThemes: 'Theme', timeCreate: 'Note time', timeShare: 'Share time',
      // ---- v1.2 全量深层文案（en） ----
      apiKeyRequired: 'Please enter the API Key', apiKeyLoginFailed: 'Login failed — check that the API Key is valid',
      otpFailed: 'Verification failed', scannedTip: 'Scanned — confirm on your phone…', confirmingTip: 'Confirming login…',
      cookieRequired: 'Please fill in wr_vid and wr_skey', cookieLoginFailed: 'Login failed — check that the Cookie is valid',
      syncNoUpdate: 'No updates', loginRequired: 'Please log in first', syncFailed: 'Sync failed',
      // v1.9.3 soft cancel (cooperative: stops after in-flight books; finished work kept, rest resumes next sync)
      syncCancel: 'Cancel', syncCancellingBtn: 'Cancelling…',
      syncCancelling: 'Cancelling — stops once in-flight books finish (finished work kept)',
      syncCancelledToast: 'Sync cancelled — finished work kept (rest resumes next sync)',
      syncCancelTip: 'Stop this sync round: it stops once the books being processed finish; finished work is kept, the rest resume next sync',
      accountSwitched: 'Account switched', switchFailed: 'Switch failed',
      loginSuccessSyncing: 'Logged in — syncing…', autoSyncFailed: 'Failed to start auto sync',
      viewCardTitle: 'Card view (covers + paging)', viewTreeTitle: 'Tree view',
      noMatch: (q) => `No books matching “${q}”`,
      prevPage: 'Prev page', nextPage: 'Next page',
      pagerInfo: (p, t, n) => `${p} / ${t} pages · ${n} books`,
      cardTooltip: (title, author, progress, highlights) => `${title}\n${author}\nProgress ${progress}% · Highlights ${highlights}`,
      bookLetter: 'Book', anonymous: 'Unknown', titleHighlights: 'Highlights', titleNotes: 'Notes',
      showMoreRemain: (n) => `Show more (${n} left)`,
      openFolderFailed: 'Failed to open folder', deletedNoteFile: (t) => `Deleted note file: ${t}`,
      deleteFailed: 'Delete failed', confirmDelete: 'Delete?',
      refreshFailed: 'Refresh failed', selEmpty: 'Select notes to excerpt first',
      copiedExcerpts: (n) => `Copied ${n} excerpts (with sources) — paste into your writing`,
      copyFailedManual: 'Copy failed — select the text manually',
      statProgress: (v) => `Progress ${v}%`, statNotes: (n) => `Notes ${n}`, statHighlightsInfo: (n) => `Highlights ${n}`,
      selModeTip: 'Select multiple notes and copy them as quoted blocks with sources (for writing)',
      exitSelMode: 'Exit multi-select', enterSelMode: 'Excerpt multi-select', selectedWord: 'Selected',
      selCount: (n) => `${n} notes selected`, copyQuotes: 'Copy quotes (with sources)',
      reportExported: (p) => `Report exported: ${p || 'done'}`,
      exportFailed: (m) => `Export failed: ${m}`,
      aiPrompt: (p) => `Please interpret my WeRead reading report ${p}: summarize reading habits and highlights, point out weaknesses, and give 3 actionable suggestions.`,
      promptCopied: 'Prompt copied — paste it into the composer and send',
      promptCopyFailed: (p) => `Copy failed — reference manually: ${p}`,
      allData: 'All data', rangeLastDays: (n) => `last ${n} days`, optLastDays: (n) => `Last ${n} days`,
      weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      typeBoth: 'Highlight+thought', typeThought: 'Thought', typeHighlight: 'Highlight', typeNote: 'Note',
      typeChapter: 'Chapter note', typeReview: 'Review',
      kpiActiveDays: 'Active days', kpiStreak: 'Longest streak', kpiTotalNotes: 'Total notes',
      kpiDensity: 'Note density', kpiDeepRatio: 'Deep-note ratio', kpiAvgCompletion: 'Avg. completion', kpiAvgNotes: 'Avg. notes/book',
      unitDays: ' days', unitPer100Pages: ' /100 pages',
      allCategories: 'All categories', allNoteTypes: 'All note types',
      onlyHighlights: 'Highlights only', onlyThoughts: 'Thoughts only', onlyChapterNotes: 'Chapter notes only', onlyReviews: 'Reviews only',
      trendByDay: 'Daily trend', trendByWeek: 'Weekly trend', finishedOnlyLabel: 'Finished only',
      exporting: 'Exporting…',
      aiRead: '🤖 AI reading', aiReadTip: (p) => `${p} (copy the prompt, then paste into the composer)`,
      goalTip: (n) => `Weekly goal ${n} notes; the current week is not counted in the streak`,
      goalThisWeek: (a, b) => `🎯 This week ${a}/${b}`, goalStreakWeeks: (n) => ` · ${n}-week streak`,
      insightsLoading: 'Loading reading insights…',
      notLoggedInPrefix: 'Not logged in yet — ', goLogin: 'Log in', loginSyncHint: ' log in and sync to see your reading data here.',
      noInsightData: 'No reading data yet — sync your shelf or check the notes folder.',
      noInsightDataHint: ' Switch to "All data" to view history.',
      insightsLoaded: (range, notes, books) => `Loaded ${range} of reading data — ${notes} notes across ${books} focus books.`,
      trendTitle: 'Reading trend (activity / notes)', legendNotes: 'Notes', legendActive: 'Activity',
      legendAllOff: 'Enable at least one series',
      tipTouched: (v) => ` · activity: ${v}`, tipNotesFull: (v, w) => ` · notes: ${v}<br>activity: ${w}`, tipNotesOnly: (v) => ` · notes: ${v}`,
      topBooksTitle: 'Top 10 high-value books',
      thBook: 'Book', thNotes: 'Notes', thCompletion: 'Completion', thDeepRatio: 'Deep ratio ', thValue: 'Value ',
      tipDeepRatio: 'Deep notes / total notes (deep = thought ≥50 chars or highlight ≥100 chars)',
      tipValueScore: 'Notes 50% + deep ratio 30% + completion 20% (20 notes maxes the output score)',
      timelineTitle: 'Recent notes timeline', noTextContent: '(no text)',
      heatmapTitle: 'Activity heatmap (7x24)', categoryShareTitle: 'Category share (by notes)',
      authorCloudTitle: 'Favorite authors', authorReadCount: (n) => `${n} books read`,
      radarTitle: 'Reading preference radar', subLevel: 'Sub-level', radarTooFew: 'Not enough categories',
      radarCount: (c, n) => `${c}: ${n}`,
      scatterTitle: 'Book scatter (reading time vs note density)',
      axisMinutes: 'time (min)', axisDensity: 'density', highValueZone: 'High value',
      scatterTip: (t, m, d) => `${t} · ${m} min · density ${d}`,
      unnamedBook: 'Untitled book',
      actionFailed: (m) => `Action failed: ${m}`, filterFailedToast: (m) => `Filter failed: ${m}`,
      reviewMarked: 'Marked as reviewed', reviewRescheduled: 'Rescheduled (try again tomorrow)',
      noCardToExport: 'No card to export',
      exportFileName: (t, d) => `note-card_${t}_${d}.png`, exportingImage: 'Exporting image…',
      pillAll: 'All', pillHighlight: 'Highlights', pillChapter: 'Chapters',
      roamingTitle: 'Note Roaming', ringTip: 'Viewed / pool',
      refreshBtn: 'Refresh (R)', dataBtn: 'Stats (D)', dataBtnTip: 'Stats (D)',
      statSessionViewed: 'Session views', statTodayReviewed: 'Reviewed today', statFavRate: 'Favorite rate', statPoolSize: 'Roaming pool',
      recent7Reviews: 'Last 7 days', timesUnit: ' times',
      dailyTip: (d, v) => `${d}: ${v} reviews`,
      unreviewedLabel: 'Unreviewed > ',
      reviewModeTip: 'SM-2 spaced repetition: due cards only, ordered by due date',
      reviewModePre: '🎯 Review mode · ', reviewModePost: ' cards left',
      dueBtn: (n) => `🎯 Review today (${n} cards)`, dueBtnTip: 'Due cards only, scheduled by the SM-2 memory curve',
      endReview: 'End review', clearAll: 'Clear',
      roamingLoading: 'Loading roaming cards…',
      roamingLoginHint: 'Not logged in yet — log in and sync to see your notes here.',
      emptyPool: 'No notes match the current filters (clear them or sync first)',
      cooldownFiltered: 'Cards are cooling down — come back later',
      noDueCards: 'No cards due today (come back tomorrow, or just roam)',
      reviewDone: 'Review done today 🎉 see you tomorrow', noCardAvailable: 'No cards available right now',
      favAlready: 'Favorited', reviewCountLabel: (n) => `🔄 reviewed ${n}x`,
      remember: 'Remember', forgot: 'Forgot', detailWord: 'Detail', exportWord: 'Image',
      refreshWord: 'Refresh', dataWord: 'Stats',
      cardIndex: (n) => `Card ${n}`,
      forgotTipReview: 'Forgot (X): interval reset, try again tomorrow', forgotTipNormal: 'Forgot (X): marked as forgotten, prioritized tomorrow',
      forgotBtn: '😵 Forgot X',
      rememberTipReview: 'Remember (Space): lengthen the interval per the memory curve', rememberTipNormal: 'Remember (Space): schedule the next review per the memory curve',
      goodBtnDone: '✓ Reviewed today · Remember Space', goodBtn: '🙂 Remember Space',
      noteBtnTip: 'View note (O)', exportBtnTip: 'Export image (I)', skipBtnTip: 'Skip (J)',
      exportModalTitle: 'Export note card image', previewWord: 'Preview', previewFailed: 'Preview failed',
      theme_white: 'White', theme_gray: 'Gray', theme_yellow: 'Warm yellow', theme_green: 'Green',
      theme_dark: 'Dark', theme_blue: 'Deep blue', theme_pink: 'Morandi pink', theme_kraft: 'Kraft',
      copyImageTip: 'Copy, then paste into the composer to send it as an image to the AI',
      imageCopied: 'Image copied — paste into the composer to send', imageCopyFailed: 'Copy failed — use Confirm export instead',
      copyImageBtn: 'Copy image (paste into chat)',
      dirPickerTitle: 'Choose notes folder', parentDir: 'Up', noSubfolders: '(no subfolders here)',
      newFolderPrompt: 'New folder name:', newFolderBtn: 'New folder', chooseThisDir: 'Choose this folder',
      backupDone: (p) => `Backup created: ${p}`, backupDefaultDir: 'Downloads folder', backupFailed: (m) => `Backup failed: ${m}`,
      uninstallCleanupDone: (k, f) => `Cleanup done: ${k} Keychain items, ${f} state files; notes folder untouched. Disable/remove this plugin in the plugin manager.`,
      cleanupFailedToast: (m) => `Cleanup failed: ${m}`,
      settingsSaved: 'Settings saved', saveFailed: 'Save failed',
      pathEmpty: 'Path cannot be empty', validateFailedWord: 'Validation failed', pathValidated: 'Path validated',
      accountRemoved: 'Account removed', previewFailedToast: 'Preview failed',
      cleanupFinished: 'Cleanup done', cleanupDoneLine: (p) => `Cleanup done${p ? `, manifest: ${p}` : ''}`, cleanupRunFailed: 'Cleanup failed',
      restoreDoneLine: (s) => (s ? `Rolled back: ${s}` : 'Rolled back'), restoreFailed: 'Rollback failed',
      logsLoadFailed: 'Failed to read logs', logsCleared: 'Logs cleared', clearFailed: 'Clear failed',
      pickDirTip: 'Open the folder picker', chooseStorage: 'Choose folder…', validateApply: 'Validate & apply',
      valStatus: (ok) => `Status: ${ok ? 'passed' : 'failed'}`, valReason: (r) => `Reason: ${r}`, summaryLabel: (s) => `summary: ${s}`,
      hoursOpt: (n) => `${n} hours`,
      multiAccount: 'Multi-account mode', weeklyGoal: 'Weekly goal (notes)', weeklyGoalHint: '0 = off; progress shows on Insights',
      uiLanguage: 'UI language',
      langAuto: 'Follow DSH language',
      loginAccountHint: (name, multi) => name
        ? (multi ? `Current: ${name} · a new login adds another account (multi-account on)` : `Current: ${name} · a new login replaces this account (multi-account off)`)
        : 'No account yet — first login creates one',
      langZhCN: '简体中文', langZhTW: '繁體中文', langEn: 'English',
      sidebarKpi: 'Sidebar reading KPI pill', composerRoaming: 'Roaming mini-card under the composer',
      scrollModeLabel: 'Mini-card scroll mode', scrollMarquee: 'Marquee (constant loop)', scrollPaged: 'Paged lines (10s each)',
      rotateToggle: 'Rotate mini-card notes randomly', rotateSecLabel: 'Rotation interval (s)',
      fontSizeLabel: 'Mini-card font size (px)', marqueeSpeedLabel: 'Marquee speed (px/s)',
      aiIntegration: 'AI integration', aiIntegrationDesc: 'Chat context injection (systemPrompt)',
      ctxInject: 'Inject "recent reading" context (new sessions)', ctxBookCountLabel: 'Books to inject',
      ctxHighlightsLabel: 'Include latest highlights', ctxHighlightCountLabel: 'Highlight count',
      ctxExcludeLabel: 'Exclude titles', ctxExcludeHint: '(comma-separated keywords)', ctxExcludePh: 'e.g. NovelA, ComicB',
      loginEntryTip: 'Open the login modal (QR / Cookie / API Key)', loginRelogin: 'Log in / re-login',
      // v1.9.0 B2: cookie origin fingerprint (at=ms epoch, source=login|head-refresh|window)
      cookieOriginLabel: (at, source) => {
        const src = { login: 'QR / cookie login', 'head-refresh': 'auto renewal', window: 'reading window' }[source] || source || '—';
        const mins = Math.max(0, Math.floor((Date.now() - at) / 60000));
        const rel = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} h ago` : `${Math.floor(mins / 1440)} d ago`;
        return `Active account cookie last renewed: ${rel} · via ${src}`;
      },
      gatewayBound: (t, v) => `Bound ····${t} · skill v${v}`,
      bindApiKeyTip: 'Open the login modal (API Key tab)', bindApiKey: 'Bind API Key',
      unboundOk: 'API Key unbound (login state unchanged)', unbindFailed: 'Unbind failed',
      gatewayTestOk: (ms, n) => `${W.t.gatewayOk} (${ms}ms${n ? `, ${n} APIs available` : ''})`,
      failedWord: 'Failed', skillVersionTip: (s) => `Official skill version notice: ${s}`,
      reconcileRow: (t, l, e) => `“${t}” local ${l} / server ${e}`, reconcileMore: (n) => `\n… ${n} total`,
      dupCleanup: 'Duplicate file cleanup', previewCleanupBtn: 'Preview cleanup', runConfirm: 'Confirm run', restoreCleanupBtn: 'Rollback last cleanup',
      cleanupSummaryLine: (s, c, d, r) => `Scanned ${s} files, ${c} conflict groups, ${d} duplicates to move, ${r} renamed`,
      logsTitle: 'Logs', dataUninstall: 'Data & uninstall',
      backupPacking: 'Packing…', backupBtn: '📦 Full backup (zip → Downloads)',
      backupHint: 'Notes folder + state files (no credentials)',
      uninstallDesc1: 'Uninstall cleanup removes: Keychain credential mirrors, ',
      uninstallDesc2: ' all state files under it (roaming progress and review data included). Your notes folder and backup zips are never deleted. Afterwards disable or remove this plugin in the plugin manager.',
      confirmCleanup: 'Run cleanup (irreversible)', uninstallCleanBtn: '🧹 Pre-uninstall local cleanup',
      // ---- v1.3 发现页 + 官方阅读统计（en） ----
      discoverTab: 'Discover',
      officialStats: 'Official reading stats',
      statsWeekly: 'This week', statsMonthly: 'This month',
      statsTotalTime: 'Total time', statsReadDays: 'Active days', statsDailyAvg: 'Daily avg', statsCompare: 'vs last',
      statsHoursFn: (hh, mm) => (hh > 0 ? `${hh}h ${mm}m` : `${mm}m`),
      statsTopBooks: 'Most read', statsPreferCats: 'Top categories',
      countBooks: (n) => (n === 1 ? '1 book' : `${n} books`),
      readingPeople: (n) => `${n} reading`,
      statsBindHint: 'Bind an API Key to see official reading stats here (time, active days, top categories)',
      discoverBindHint: 'Bind an API Key to search the whole store (books, audio, articles) and get personalized picks; binding never affects your current login',
      searchPlaceholder: 'Search title / author / keyword…', searchBtn: 'Search',
      scopeBook: 'Books', scopeAll: 'All', scopeAudio: 'Audio', scopeAuthor: 'Authors', scopeFulltext: 'Full text', scopeMp: 'Articles',
      searchEmpty: 'No results found', searchFailed: 'Search failed',
      openReader: 'Open reader', viewDetail: 'Details',
      forYou: 'For you', refreshBatch: 'Shuffle', reason: 'Why recommended',
      apiWarnTip: (t, r) => `Last check: ${t} · ${r}`, rowConfig: 'WeRead settings',
    };
    // 繁體中文（台灣慣用詞：設定/筆記/書架/漫遊/帳號/登入/掃碼/貼上/刪除/備份/下載；技術名詞保留原文）
    W.T_ZH_TW = {
      panel: '微信讀書',
      bookshelf: '書架', insights: '洞察', roaming: '漫遊', settings: '設定',
      detail: '筆記詳情',
      login: '登入微信讀書', loginProtocol: '掃碼登入', loginCookie: '貼上 Cookie 登入',
      logout: '登出', sync: '同步筆記', syncing: '同步中…', syncDone: '同步完成', syncFailed: '同步失敗',
      search: '搜尋書架', searchNotes: '搜尋筆記', clearFilter: '清除篩選',
      collapseAll: '全部摺疊', expandAll: '全部展開',
      notLoggedIn: '未登入，同步不可用，可瀏覽本地資料', loginHint: '點擊登入微信讀書',
      loginExpiredBanner: '登入已過期——本地資料可瀏覽，同步需重新登入', relogin: '重新登入',
      apiDegraded: '微信讀書介面不可達，正在顯示本地資料（登入與同步暫不可用）',
      empty: '書架為空', emptyDesc: '登入並同步後，筆記會儲存在設定的目錄中',
      books: '本書', notes: '條筆記', highlights: '條劃線',
      uncategorized: '未分類', publicAccount: '公眾號',
      refresh: '重新整理', chapters: '章', chapterNav: '章節導覽', noNotes: '暫無筆記',
      exportImage: '匯出圖片', exportReport: '匯出月報', confirm: '確認匯出', cancel: '取消',
      favorite: '收藏', reviewed: '已複習', todayReviewed: '今日已複習',
      prevCard: '上一條', nextCard: '下一條', skip: '跳過', openSource: '原文',
      outputPath: '筆記儲存路徑', pickFolder: '選擇資料夾', manualInput: '手動輸入路徑',
      save: '儲存並套用', autoSync: '自動同步', syncInterval: '同步間隔',
      categoryMode: '分類層級', level1: '一級分類', level2: '完整分類',
      fileNameTemplate: '檔名範本', noteTemplate: '筆記範本',
      accounts: '帳號管理', switchAccount: '切換帳號', removeAccount: '刪除帳號', addAccount: '新增帳號',
      activeAccount: '目前活躍', retry: '重試', copy: '複製', copied: '已複製',
      loading: '載入中…', loadFailed: '載入失敗', noData: '暫無資料',
      viewCard: '卡片', viewTree: '樹狀', showMore: '顯示更多', backBookshelf: '返回書架',
      noteConfig: '筆記設定', uiIntegration: '介面整合',
      otpTitle: '輸入驗證碼', otpPlaceholder: '6 位驗證碼', submit: '提交',
      scanTip: '請使用微信掃描 QR Code，並在手機確認登入',
      cookieVid: 'wr_vid', cookieSkey: 'wr_skey', cookieTip: '在瀏覽器登入 weread.qq.com 後，F12 → Application → Cookies 複製以下欄位',
      loginApiKey: 'API Key（官方）',
      apiKeyLabel: 'API Key（wrk- 開頭）',
      apiKeyPlaceholder: 'wrk-…',
      apiKeyTip: '官方通道：開啟 weread.qq.com/r/weread-skills 登入後複製 API Key 貼上到此。已登入時將綁定到目前帳號（推薦）；未登入時作為獨立帳號。僅本人可見、存於本機鑰匙圈。',
      apiKeyBoundTip: '已登入狀態：此 Key 將綁定到目前帳號，用於想法/書評補採與同步對帳。',
      apiKeyOpenPage: '開啟官網取得 Key',
      apiKeyAttached: '已綁定到目前帳號',
      apiKeyUpdate: '更新 Key',
      apiKeyBoundState: (t) => `官方通道已綁定（尾號 ${t}），提交新 Key 將覆蓋`,
      channelBoundOk: (t) => `已綁定 ····${t}（有效）`,
      channelBoundStale: (t) => `已綁定 ····${t}（待覆核）`,
      channelAbsent: '未設定',
      channelCookieOk: 'Cookie 有效',
      channelCookieExpired: 'Cookie 已過期',
      channelCookieUnknown: '已設定（自動核驗未完成）',
      channelVerifying: '校驗中…',
      channelLegendHint: '懸停查看各通道狀態',
      legendValid: '有效', legendExpired: '已過期', legendAbsent: '未設定',
      unselectedWord: '未選中',
      appWindowRead: '閱讀視窗',
      openReaderAppTip: '在單例閱讀視窗中開啟（始終複用同一個視窗）',
      dockTip: '閱讀視窗開啟最近的書（拖曳移動位置；無書紀錄時開啟微信讀書首頁）',
      viewDetailAppTip: '在閱讀視窗開啟書籍詳情頁（站內可繼續跳轉）',
      appWindowCardTitle: '單例閱讀視窗',
      openedTabMode: '閱讀視窗拉起失敗，已在 Chrome 視窗新分頁開啟（兜底）',
      appWindowModeReady: '單例閱讀視窗已啟用',
      appWindowModeDesc: '開啟書籍始終複用同一個專用 Chrome 視窗：換書時原視窗內直接導航，不開新視窗、不累積分頁、也不用預設瀏覽器。視窗登入態獨立保存：失效時會自動補入插件帳號的最新 Cookie，或掃碼一次即可。',
      readerQuitToggle: '關窗即退出 Chrome 實例',
      readerQuitHint: '開：關窗後程序塢不留圖示，下次開啟全新拉起（約 1-2 秒）；關：實例常駐、重開秒回，但程序塢圖示滯留。',
      appWindowTip: '在專用 Chrome 視窗開啟（頂層上下文，無第三方嵌入，不觸發風控）',
      openedAppWindow: '已在閱讀視窗開啟',
      openReaderFail: '開啟閱讀視窗失敗',
      loginExpiredToast: '視窗已開啟，但微信讀書登入已過期（書頁會顯示「載入失敗」）：請到 設定→登入 重新掃碼。筆記同步不受影響',
      readerWindowCheck: '偵測閱讀視窗',
      readerWindowChecking: '偵測中…',
      readerWindowClose: '關閉閱讀視窗',
      readerWindowCloseDone: '閱讀視窗已關閉',
      readerWindowStatus: (s) => {
        if (!s) return '';
        if (!s.chromeFound) return '未找到 Google Chrome（閱讀視窗依賴 Chrome）';
        if (s.windowAlive) return `視窗運行中 · ${s.windowUrl || s.lastUrl || ''}`.slice(0, 90);
        if (s.cdpAlive) return '實例在但視窗已關（下次開啟會自動重開）';
        return s.lastUrl ? '視窗未在運行（下次開啟會自動拉起）' : '尚未使用過';
      },
      exportCardTip: '產生分享卡片圖',
      copyImageFailed: '複製圖片失敗',
      exportTip: '卡片圖與漫遊匯出同款：主題八選一、時間可選筆記時間或當前時間',
      minutesShort: '分鐘',
      bestHighlights: '熱門劃線',
      bestHighlightsUnit: '條',
      bestHighlightsTip: '全書劃線人數最多的段落（官方資料）',
      bestHighlightPeople: (n) => `${n} 人劃線`,
      channelCheckedAt: (t) => `最近校驗：${t}`,
      channelCookieSharedTip: '掃碼與貼上 Cookie 是同一份憑證（wr_vid/wr_skey），狀態共用',
      menuLogin: '登入帳號',
      menuLogout: '登出帳號',
      loggedOutToast: '已登出',
      logoutFailed: '登出失敗',
      gatewayChannel: '官方通道（API Key）',
      gatewayUnbind: '解綁',
      gatewayTest: '連線測試',
      gatewayTesting: '測試中…',
      gatewayOk: '官方閘道連通',
      gatewayReconcile: '同步對帳',
      gatewayReconcileOk: (n) => `${n} 本書與服務端計數一致`,
      gatewayReconcileBad: (n, m) => `${m}/${n} 本計數不一致（可能漏採，點擊詳情排查）`,
      delete: '刪除', confirmDeleteBook: '確認刪除該書的本地筆記檔案？',
      openFolder: '在資料夾中顯示', days: '天',
      exportThemes: '背景主題', timeCreate: '筆記建立時間', timeShare: '目前分享時間',
      // ---- v1.2 全量深層文案（zh-TW） ----
      apiKeyRequired: '請填寫 API Key', apiKeyLoginFailed: '登入失敗，請檢查 API Key 是否有效',
      otpFailed: '驗證失敗', scannedTip: '已掃碼，請在手機確認…', confirmingTip: '正在確認登入…',
      cookieRequired: '請填寫 wr_vid 與 wr_skey', cookieLoginFailed: '登入失敗，請檢查 Cookie 是否有效',
      syncNoUpdate: '無更新', loginRequired: '請先登入', syncFailed: '同步失敗',
      // v1.9.3 軟取消（協作式：在飛書完成後停止，已完成部分保留，下次同步自動補齊）
      syncCancel: '取消', syncCancellingBtn: '取消中…',
      syncCancelling: '正在取消——在飛的書完成後即停（已完成部分保留）',
      syncCancelledToast: '同步已取消，已完成部分保留（下次同步自動補齊）',
      syncCancelTip: '停止本輪同步：正在處理的書完成後即停，已完成的保留；未完成的書下次同步自動補齊',
      accountSwitched: '已切換帳號', switchFailed: '切換失敗',
      loginSuccessSyncing: '登入成功，正在同步…', autoSyncFailed: '自動同步啟動失敗',
      viewCardTitle: '卡片檢視（封面+分頁）', viewTreeTitle: '樹狀檢視',
      noMatch: (q) => `未找到符合「${q}」的書籍`,
      prevPage: '上一頁', nextPage: '下一頁',
      pagerInfo: (p, t, n) => `${p} / ${t} 頁 · 共 ${n} 本`,
      cardTooltip: (title, author, progress, highlights) => `${title}\n${author}\n進度 ${progress}% · 劃線 ${highlights}`,
      bookLetter: '書', anonymous: '佚名', titleHighlights: '劃線', titleNotes: '筆記',
      showMoreRemain: (n) => `顯示更多（剩餘 ${n} 本）`,
      openFolderFailed: '開啟資料夾失敗', deletedNoteFile: (t) => `已刪除筆記檔案：${t}`,
      deleteFailed: '刪除失敗', confirmDelete: '確認刪除？',
      refreshFailed: '重新整理失敗', selEmpty: '先點選要摘錄的筆記',
      copiedExcerpts: (n) => `已複製 ${n} 條摘錄（含出處），可直接貼上到寫作中`,
      copyFailedManual: '複製失敗，請手動選擇文字',
      statProgress: (v) => `進度 ${v}%`, statNotes: (n) => `筆記 ${n} 條筆記`, statHighlightsInfo: (n) => `劃線 ${n} 條劃線`,
      selModeTip: '多選筆記，複製為帶出處的引用區塊（寫作取材）',
      exitSelMode: '退出多選', enterSelMode: '摘錄多選', selectedWord: '已選',
      selCount: (n) => `已選 ${n} 條筆記`, copyQuotes: '複製引用區塊（含出處）',
      reportExported: (p) => `月報已匯出：${p || '完成'}`,
      exportFailed: (m) => `匯出失敗：${m}`,
      aiPrompt: (p) => `請解讀我的微信讀書閱讀報告 ${p}：總結閱讀習慣與亮點，指出不足，給出 3 條可執行的改進建議。`,
      promptCopied: '已複製解讀提示，貼上到輸入框傳送即可',
      promptCopyFailed: (p) => `複製失敗，請手動引用：${p}`,
      allData: '全部資料', rangeLastDays: (n) => `最近 ${n} 天`, optLastDays: (n) => `最近${n}天`,
      weekdaysShort: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
      weekdaysLong: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
      typeBoth: '劃線+想法', typeThought: '想法', typeHighlight: '劃線', typeNote: '筆記',
      typeChapter: '章節筆記', typeReview: '書評',
      kpiActiveDays: '活躍天數', kpiStreak: '最長連續', kpiTotalNotes: '筆記總數',
      kpiDensity: '筆記密度', kpiDeepRatio: '深度筆記佔比', kpiAvgCompletion: '平均完成率', kpiAvgNotes: '平均每本筆記數',
      unitDays: ' 天', unitPer100Pages: ' /100頁',
      allCategories: '全部分類', allNoteTypes: '全部筆記類型',
      onlyHighlights: '僅劃線', onlyThoughts: '僅想法', onlyChapterNotes: '僅章節筆記', onlyReviews: '僅書評',
      trendByDay: '按天趨勢', trendByWeek: '按週趨勢', finishedOnlyLabel: '僅完讀',
      exporting: '匯出中…',
      aiRead: '🤖 AI 解讀', aiReadTip: (p) => `${p}（複製提示詞後貼上到輸入框）`,
      goalTip: (n) => `每週目標 ${n} 條；本週進行中不計入連續`,
      goalThisWeek: (a, b) => `🎯 本週 ${a}/${b}`, goalStreakWeeks: (n) => ` · 連續 ${n} 週`,
      insightsLoading: '正在載入閱讀洞察資料…',
      notLoggedInPrefix: '尚未登入——', goLogin: '去登入', loginSyncHint: ' 登入並同步後這裡會出現閱讀資料。',
      noInsightData: '暫無閱讀資料，請先同步書架或檢查本地筆記目錄。',
      noInsightDataHint: ' 可切換到「全部資料」查看歷史記錄。',
      insightsLoaded: (range, notes, books) => `已載入 ${range} 的閱讀資料，共 ${notes} 條筆記，覆蓋 ${books} 本重點書籍。`,
      trendTitle: '閱讀趨勢（閱讀活躍 / 筆記產出）', legendNotes: '筆記產出', legendActive: '閱讀活躍',
      legendAllOff: '請至少開啟一個圖例系列',
      tipTouched: (v) => ` · 閱讀活躍: ${v}`, tipNotesFull: (v, w) => ` · 筆記產出: ${v}<br>閱讀活躍: ${w}`, tipNotesOnly: (v) => ` · 筆記產出: ${v}`,
      topBooksTitle: '高價值書籍 Top10',
      thBook: '書籍', thNotes: '筆記', thCompletion: '完成率', thDeepRatio: '深度佔比 ', thValue: '價值分 ',
      tipDeepRatio: '深度筆記數/總筆記數（深度定義：想法≥50字 或 劃線≥100字）',
      tipValueScore: '筆記產出分50% + 深度佔比30% + 完成率20%（單本 20 條筆記即滿產出分）',
      timelineTitle: '最近筆記時間線', noTextContent: '（無文字內容）',
      heatmapTitle: '活躍時段熱力圖（7x24）', categoryShareTitle: '分類主題佔比（按筆記量）',
      authorCloudTitle: '偏好作者雲圖', authorReadCount: (n) => `閱讀 ${n} 本`,
      radarTitle: '閱讀偏好雷達圖', subLevel: '二級分類', radarTooFew: '分類數量不足',
      radarCount: (c, n) => `${c}: ${n}本`,
      scatterTitle: '書籍散點分析（閱讀時長 vs 筆記密度）',
      axisMinutes: '時長(min)', axisDensity: '密度', highValueZone: '高價值區',
      scatterTip: (t, m, d) => `${t} · 時長 ${m}min · 密度 ${d}`,
      unnamedBook: '未命名書籍',
      actionFailed: (m) => `操作失敗：${m}`, filterFailedToast: (m) => `篩選失敗：${m}`,
      reviewMarked: '已標記為已複習', reviewRescheduled: '已重新安排（明天再來一次）',
      noCardToExport: '暫無可匯出的卡片',
      exportFileName: (t, d) => `筆記卡片_${t}_${d}.png`, exportingImage: '正在匯出圖片…',
      pillAll: '全部', pillHighlight: '高亮', pillChapter: '章節',
      roamingTitle: '筆記漫遊', ringTip: '已瀏覽 / 總池',
      refreshBtn: '重新整理 (R)', dataBtn: '數據 (D)', dataBtnTip: '數據統計 (D)',
      statSessionViewed: '工作階段瀏覽(次)', statTodayReviewed: '今日複習(次)', statFavRate: '收藏率', statPoolSize: '漫遊池(條)',
      recent7Reviews: '近7天複習', timesUnit: '次',
      dailyTip: (d, v) => `${d}：複習 ${v} 次`,
      unreviewedLabel: '未複習 > ',
      reviewModeTip: 'SM-2 間隔重複：只出到期卡，按到期先後排序',
      reviewModePre: '🎯 複習模式 · 剩 ', reviewModePost: ' 張',
      dueBtn: (n) => `🎯 今日複習（${n} 張）`, dueBtnTip: '只出到期卡，按 SM-2 記憶曲線安排',
      endReview: '結束複習', clearAll: '清空',
      roamingLoading: '正在載入漫遊卡片…',
      roamingLoginHint: '尚未登入——登入並同步後，這裡會出現你的筆記。',
      emptyPool: '目前篩選條件下沒有可用筆記（可清除篩選或先同步）',
      cooldownFiltered: '卡片都在冷卻中，稍後再來看看',
      noDueCards: '今日沒有到期的複習卡（明天再來，或先隨便漫遊）',
      reviewDone: '今日複習完成 🎉 明天見', noCardAvailable: '目前暫無可用卡片',
      favAlready: '已收藏', reviewCountLabel: (n) => `🔄 複習 ${n} 次`,
      remember: '記得', forgot: '忘記', detailWord: '詳情', exportWord: '導圖',
      refreshWord: '重新整理', dataWord: '數據',
      cardIndex: (n) => `第 ${n} 條`,
      forgotTipReview: '忘記 (X)：間隔重置，明天再來', forgotTipNormal: '忘記 (X)：標記沒記住，明天優先再見',
      forgotBtn: '😵 忘記 X',
      rememberTipReview: '記得 (Space)：按記憶曲線拉長間隔', rememberTipNormal: '記得 (Space)：按記憶曲線安排下次複習',
      goodBtnDone: '✓ 今日已複習 · 記得 Space', goodBtn: '🙂 記得 Space',
      noteBtnTip: '查看筆記 (O)', exportBtnTip: '導圖 (I)', skipBtnTip: '跳過 (J)',
      exportModalTitle: '匯出筆記卡片圖片', previewWord: '預覽', previewFailed: '預覽產生失敗',
      theme_white: '純白', theme_gray: '淺灰', theme_yellow: '暖黃', theme_green: '淺綠',
      theme_dark: '暗夜黑', theme_blue: '深藍', theme_pink: '莫蘭迪粉', theme_kraft: '牛皮紙',
      copyImageTip: '複製後貼上到輸入框，即可作為圖片傳送給 AI',
      imageCopied: '已複製圖片，貼上到輸入框即可傳送', imageCopyFailed: '複製失敗，請改用確認匯出',
      copyImageBtn: '複製圖片（貼上到對話）',
      dirPickerTitle: '選擇筆記儲存位置', parentDir: '上一層', noSubfolders: '（此處沒有子資料夾）',
      newFolderPrompt: '新資料夾名稱：', newFolderBtn: '新資料夾', chooseThisDir: '選擇此目錄',
      backupDone: (p) => `備份已產生：${p}`, backupDefaultDir: '下載目錄', backupFailed: (m) => `備份失敗：${m}`,
      uninstallCleanupDone: (k, f) => `清理完成：Keychain ${k} 項、狀態檔案 ${f} 個；筆記目錄未動。請到外掛管理頁停用/移除本外掛。`,
      cleanupFailedToast: (m) => `清理失敗：${m}`,
      settingsSaved: '設定已儲存', saveFailed: '儲存失敗',
      pathEmpty: '路徑不能為空', validateFailedWord: '校驗失敗', pathValidated: '路徑校驗通過',
      accountRemoved: '已刪除帳號', previewFailedToast: '預覽失敗',
      cleanupFinished: '清理完成', cleanupDoneLine: (p) => `清理完成${p ? `，清單：${p}` : ''}`, cleanupRunFailed: '清理失敗',
      restoreDoneLine: (s) => (s ? `還原完成：${s}` : '還原完成'), restoreFailed: '還原失敗',
      logsLoadFailed: '讀取日誌失敗', logsCleared: '日誌已清空', clearFailed: '清空失敗',
      pickDirTip: '開啟目錄選擇視窗', chooseStorage: '選擇儲存位置…', validateApply: '校驗並套用',
      valStatus: (ok) => `狀態：${ok ? '通過' : '失敗'}`, valReason: (r) => `原因：${r}`, summaryLabel: (s) => `summary：${s}`,
      hoursOpt: (n) => `${n} 小時`,
      multiAccount: '多帳號模式', weeklyGoal: '週目標(條筆記)', weeklyGoalHint: '0=關閉；達標進度顯示在洞察頁',
      uiLanguage: '介面語言',
      langAuto: '跟隨 DSH 介面語言',
      loginAccountHint: (name, multi) => name
        ? (multi ? `目前：${name} · 新登入將新增另一個帳號（多帳號已開）` : `目前：${name} · 新登入將替換此帳號（多帳號已關）`)
        : '尚未登入任何帳號，登入即建立第一個帳號',
      langZhCN: '简体中文', langZhTW: '繁體中文', langEn: 'English',
      sidebarKpi: '側欄閱讀 KPI 膠囊', composerRoaming: '輸入框下方漫遊小卡',
      scrollModeLabel: '小卡捲動方式', scrollMarquee: '跑馬燈（勻速循環）', scrollPaged: '逐行輪播（每行 10 秒）',
      rotateToggle: '小卡筆記隨機輪播', rotateSecLabel: '輪播間隔(秒)',
      fontSizeLabel: '小卡字號(px)', marqueeSpeedLabel: '跑馬燈速度(px/s)',
      aiIntegration: 'AI 整合', aiIntegrationDesc: '對話上下文注入（systemPrompt）',
      ctxInject: '注入「使用者近期閱讀」上下文（新會話生效）', ctxBookCountLabel: '注入書數(本)',
      ctxHighlightsLabel: '附帶最新劃線原文', ctxHighlightCountLabel: '劃線條數',
      ctxExcludeLabel: '排除書名', ctxExcludeHint: '（含關鍵字即排除，逗號分隔）', ctxExcludePh: '例：小說A, 漫畫B',
      loginEntryTip: '開啟登入彈層（掃碼 / 貼上 Cookie / API Key）', loginRelogin: '登入 / 重新登入',
      // v1.9.0 B2：Cookie 來源指紋（at=毫秒時間戳，source=login|head-refresh|window）
      cookieOriginLabel: (at, source) => {
        const src = { login: '掃碼/Cookie 登入', 'head-refresh': '自動續命', window: '閱讀視窗回流' }[source] || source || '—';
        const mins = Math.max(0, Math.floor((Date.now() - at) / 60000));
        const rel = mins < 1 ? '剛剛' : mins < 60 ? `${mins} 分鐘前` : mins < 1440 ? `${Math.floor(mins / 60)} 小時前` : `${Math.floor(mins / 1440)} 天前`;
        return `目前帳號 Cookie 上次續命：${rel} · 來源：${src}`;
      },
      gatewayBound: (t, v) => `已綁定 ····${t} · skill v${v}`,
      bindApiKeyTip: '開啟登入彈層（直達 API Key tab）', bindApiKey: '綁定 API Key',
      unboundOk: '已解綁 API Key（登入狀態不變）', unbindFailed: '解綁失敗',
      gatewayTestOk: (ms, n) => `${W.t.gatewayOk}（${ms}ms${n ? `，可用介面 ${n} 個` : ''}）`,
      failedWord: '失敗', skillVersionTip: (s) => `官方 Skill 版本提示：${s}`,
      reconcileRow: (t, l, e) => `《${t}》 本地 ${l} / 服務端 ${e}`, reconcileMore: (n) => `\n… 共 ${n} 本`,
      dupCleanup: '重複檔案清理', previewCleanupBtn: '預覽清理結果', runConfirm: '確認執行', restoreCleanupBtn: '還原上次清理',
      cleanupSummaryLine: (s, c, d, r) => `掃描 ${s} 個檔案，衝突 ${c} 組，將遷移 ${d} 個重複檔案，重新命名 ${r} 個`,
      logsTitle: '日誌', dataUninstall: '資料與解除安裝',
      backupPacking: '打包中…', backupBtn: '📦 打包全量備份（zip → 下載目錄）',
      backupHint: '筆記目錄 + 狀態檔案（不含憑證）',
      uninstallDesc1: '解除安裝清理將刪除：鑰匙圈憑證鏡像、',
      uninstallDesc2: ' 全部狀態檔案（含漫遊進度與複習資料）。不會刪除你的筆記目錄與備份 zip。清理後請在外掛管理頁停用或移除本外掛。',
      confirmCleanup: '確認執行清理（不可復原）', uninstallCleanBtn: '🧹 解除安裝前清理本機資料',
      // ---- v1.3 发现页 + 官方阅读统计（zh-TW；台湾用语：搜尋/發現/聽書/公眾號/下一頁/換一批/為你推薦） ----
      discoverTab: '發現',
      officialStats: '官方閱讀統計',
      statsWeekly: '本週', statsMonthly: '本月',
      statsTotalTime: '總時長', statsReadDays: '有效天數', statsDailyAvg: '日均', statsCompare: '環比',
      statsHoursFn: (hh, mm) => (hh > 0 ? `${hh}小時${mm}分` : `${mm}分`),
      statsTopBooks: '讀得最多', statsPreferCats: '偏好分類',
      countBooks: (n) => `${n} 本`,
      readingPeople: (n) => `${n} 人在讀`,
      statsBindHint: '綁定 API Key 後可在此查看官方閱讀統計（時長 / 有效天數 / 偏好分類）',
      discoverBindHint: '綁定 API Key 後可搜尋全書城書刊、聽書與公眾號，並獲得個人化推薦；綁定不影響現有登入，隨時可解綁',
      searchPlaceholder: '搜尋書名/作者/關鍵詞…', searchBtn: '搜尋',
      scopeBook: '找書', scopeAll: '全部', scopeAudio: '聽書', scopeAuthor: '作者', scopeFulltext: '全文', scopeMp: '公眾號',
      searchEmpty: '沒有找到相關結果', searchFailed: '搜尋失敗',
      openReader: '開啟閱讀', viewDetail: '詳情',
      forYou: '為你推薦', refreshBatch: '換一批', reason: '推薦理由',
      apiWarnTip: (t, r) => `最近檢測：${t} · ${r}`, rowConfig: '微信讀書設定',
    };
    W.lang = 'zh';
    // 缺键兜底：读取字典中不存在的键返回键名（回退链最后一环），已有键不受影响
    W.t = new Proxy(W.t, { get: (o, k) => (typeof k === 'string' && !(k in o) ? k : o[k]) });
    W.setLang = (l) => {
      const next = l === 'en' ? 'en' : l === 'zh-TW' ? 'zh-TW' : 'zh';
      if (W.lang === next) return false;
      W.lang = next;
      // 回退链：zh-TW 缺键 → 回 zh（简体，先铺简中底再用繁中覆盖）；en/zh 全量覆盖
      if (next === 'zh-TW') Object.assign(W.t, W.T_ZH, W.T_ZH_TW);
      else Object.assign(W.t, next === 'en' ? W.T_EN : W.T_ZH);
      return true;
    };

    // ---------- 工具 ----------
    W.h = h; W.React = React;
    W.hooks = { useState, useEffect, useRef, useCallback, useMemo };
    W.fmtDate = (ts) => {
      if (!ts) return '';
      const d = new Date(ts < 1e12 ? ts * 1000 : ts);
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    };
    W.fmtDateTime = (ts) => {
      if (!ts) return '';
      const d = new Date(ts < 1e12 ? ts * 1000 : ts);
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    W.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // 阅读状态色（对应原版 charts.yellow / charts.green）
    W.statusColor = (s) => (s === 1 ? 'var(--dsw-alias-warning, #d29922)' : s === 2 ? 'var(--dsw-alias-success, #3fb950)' : 'var(--dsw-alias-label-secondary)');
    // 简单轮询 hook：fn 返回 Promise，intervalMs 轮询，active 为 false 时停
    W.usePoll = function usePoll(fn, intervalMs, active) {
      const { useEffect } = React;
      useEffect(() => {
        if (!active) return undefined;
        let stop = false;
        let busy = false; // in-flight 防重入：上一轮未返回则跳过本轮
        const tick = async () => {
          if (stop || busy) return;
          busy = true;
          try { await fn(); } catch { /* 忽略 */ }
          busy = false;
        };
        tick();
        const id = setInterval(tick, intervalMs);
        return () => { stop = true; clearInterval(id); };
      }, [intervalMs, !!active]);
    };
    W.toast = function useToastState() {
      const { useState, useEffect } = React;
      const [msg, setMsg] = useState(null);
      useEffect(() => { if (msg) { const id = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(id); } return undefined; }, [msg]);
      return [msg, setMsg];
    };

    // ---------- SVG 图标集（替换全部 emoji；stroke currentColor 随文字变色） ----------
    W.I = (() => {
      const svg = (size, vb, ...kids) => h('svg', {
        viewBox: vb, width: size, height: size, 'aria-hidden': true,
        style: { display: 'inline-block', verticalAlign: '-0.15em', flex: 'none' },
      }, ...kids);
      const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
      const F = { fill: 'currentColor', stroke: 'none' };
      const line = (x1, y1, x2, y2, k) => h('line', { key: k, x1, y1, x2, y2, ...P });
      const path = (d, k, fill) => h('path', { key: k, d, ...(fill ? F : P) });
      const circ = (cx, cy, r, k) => h('circle', { key: k, cx, cy, r, ...P });
      const rect = (x, y, w, hh, rx, k) => h('rect', { key: k, x, y, width: w, height: hh, rx, ...P });
      return {
        tree: (sz = 12) => svg(sz, '0 0 24 24', path('M12 3 7 10h3l-4 6h5v3h2v-3h5l-4-6h3z', 't', true)),
        grid: (sz = 12) => svg(sz, '0 0 24 24', rect(4, 4, 7, 7, 1.5, 'a'), rect(13, 4, 7, 7, 1.5, 'b'), rect(4, 13, 7, 7, 1.5, 'c'), rect(13, 13, 7, 7, 1.5, 'd')),
        folder: (sz = 12) => svg(sz, '0 0 24 24', path('M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'f')),
        book: (sz = 12) => svg(sz, '0 0 24 24', path('M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z', 'b1'), path('M19 20H7a2 2 0 0 0-2 2', 'b2'), line(9, 6, 15, 6, 'b3')),
        sync: (sz = 12) => svg(sz, '0 0 24 24', path('M20 12a8 8 0 1 1-2.34-5.66', 's1'), path('M20 4v5h-5', 's2')),
        refresh: (sz = 12) => svg(sz, '0 0 24 24', path('M20 12a8 8 0 1 1-2.34-5.66', 's1'), path('M20 4v5h-5', 's2')),
        search: (sz = 12) => svg(sz, '0 0 24 24', circ(10.5, 10.5, 6.5, 'c1'), line(15.5, 15.5, 20, 20, 'c2')),
        chevL: (sz = 12) => svg(sz, '0 0 24 24', path('M14 6l-6 6 6 6', 'l')),
        chevR: (sz = 12) => svg(sz, '0 0 24 24', path('M10 6l6 6-6 6', 'r')),
        chevD: (sz = 12) => svg(sz, '0 0 24 24', path('M6 10l6 6 6-6', 'd')),
        star: (sz = 12, filled) => svg(sz, '0 0 24 24', path('M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z', 's', !!filled)),
        pen: (sz = 12) => svg(sz, '0 0 24 24', path('M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16z', 'p1'), line(13, 6, 17, 10, 'p2')),
        camera: (sz = 12) => svg(sz, '0 0 24 24', path('M4 8h3l2-2h6l2 2h3v11H4z', 'cam1'), circ(12, 13, 3.2, 'cam2')),
        window: (sz = 12) => svg(sz, '0 0 24 24', rect(3.5, 4.5, 17, 13, 1.5, 'w1'), line(3.5, 9, 20.5, 9, 'w2')),
        weread: (sz = 12) => svg(sz, '0 0 24 24', path('M4 5.5C4 4.67 4.67 4 5.5 4H11V19H5.5C4.67 19 4 19.67 4 20.5V5.5ZM20 5.5C20 4.67 19.33 4 18.5 4H13V19H18.5C19.33 19 20 19.67 20 20.5V5.5ZM11 19H13V20.5H11V19Z', 'wr', true)),
        chat: (sz = 12) => svg(sz, '0 0 24 24', path('M4 5h16v11H9l-5 4z', 'c')),
        bookmark: (sz = 12) => svg(sz, '0 0 24 24', path('M7 3h10v18l-5-4-5 4z', 'b')),
        doc: (sz = 12) => svg(sz, '0 0 24 24', path('M6 3h9l4 4v14H6z', 'd1'), line(9, 12, 15, 12, 'd2'), line(9, 16, 13, 16, 'd3')),
        chart: (sz = 12) => svg(sz, '0 0 24 24', line(4, 20, 20, 20, 'a'), rect(6, 11, 3, 6, 0.5, 'b'), rect(11, 7, 3, 10, 0.5, 'c'), rect(16, 13, 3, 4, 0.5, 'd')),
        shuffle: (sz = 12) => svg(sz, '0 0 24 24', path('M3 7h4l10 10h4', 'a'), path('M3 17h4l3-3', 'b'), path('M14 7h7', 'c'), path('M18 4l3 3-3 3', 'd'), path('M18 14l3 3-3 3', 'e')),
        inbox: (sz = 28) => svg(sz, '0 0 24 24', path('M4 13h4l2 3h4l2-3h4', 'a'), path('M4 13l2-8h12l2 8v6H4z', 'b')),
        user: (sz = 12) => svg(sz, '0 0 24 24', circ(12, 8, 4, 'a'), path('M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6', 'b')),
        cal: (sz = 12) => svg(sz, '0 0 24 24', rect(4, 5, 16, 16, 2, 'a'), line(4, 10, 20, 10, 'b'), line(9, 3, 9, 6, 'c'), line(15, 3, 15, 6, 'd')),
        close: (sz = 12) => svg(sz, '0 0 24 24', line(6, 6, 18, 18, 'a'), line(18, 6, 6, 18, 'b')),
        eye: (sz = 12) => svg(sz, '0 0 24 24', path('M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z', 'a'), circ(12, 12, 3, 'b')),
        key: (sz = 12) => svg(sz, '0 0 24 24', circ(8, 15, 4, 'a'), line(10.8, 12.2, 20, 3, 'b'), line(16.5, 6.5, 19.5, 9.5, 'c'), line(14, 9, 16.5, 11.5, 'd')),
        terminal: (sz = 12) => svg(sz, '0 0 24 24', rect(3, 4.5, 18, 15, 1.5, 'a'), line(6.5, 9.5, 9.5, 12.5, 'b'), line(9.5, 9.5, 6.5, 12.5, 'c'), line(12, 13.5, 16, 13.5, 'd')),
        spark: (sz = 12) => svg(sz, '0 0 24 24', path('M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z', 'a')),
      };
    })();

    // ---------- 基础 CSS（组件内 <style>，前缀 wr-） ----------
    W.BASE_CSS = `
.wr-root{display:flex;flex-direction:column;height:100%;min-height:0;max-width:100%;overflow:hidden;position:relative;color:var(--dsw-alias-label-primary);font-size:13px}
.wr-readerdock{position:absolute;z-index:60;width:51px;height:51px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:0 4px 12px rgba(0,0,0,.18);user-select:none;touch-action:none;color:rgb(52,167,255);perspective:100px}
/* v1.9.4 翻书 loading（参照 flip-book-loading.html）：打开阅读窗口进行中，icon 换 mini 翻书动效——
   三张 leaf 负延迟错相、rotateY 翻页 + 首尾淡入淡出（消除回跳），配色沿用按钮主题蓝 */
.wr-flipwrap{position:relative;width:30px;height:20px;transform-style:preserve-3d}
.wr-flipcover{position:absolute;left:0;top:0;width:30px;height:20px;border-radius:3px;background:linear-gradient(180deg,#279aee,#177fcd);box-shadow:0 2px 5px rgba(24,126,203,.35)}
.wr-flipspine{position:absolute;left:13px;top:0;width:4px;height:20px;border-radius:50%;background:linear-gradient(90deg,rgba(10,101,183,.24),rgba(255,255,255,.58) 52%,rgba(15,116,202,.20));z-index:3}
.wr-flippage{position:absolute;top:1px;width:14px;height:18px;overflow:hidden;border:1px solid rgba(255,255,255,.25)}
.wr-flippage.l{left:1px;border-radius:2px 1px 1px 2px;background:linear-gradient(90deg,#35a3f8,#278fdf)}
.wr-flippage.r{left:15px;border-radius:1px 2px 2px 1px;background:linear-gradient(90deg,#278fdf,#36a4f8)}
.wr-flipleaf{position:absolute;left:15px;top:1px;width:14px;height:18px;opacity:0;transform-origin:left center;transform-style:preserve-3d;will-change:transform,opacity;animation:wrLeafTurn 2.4s cubic-bezier(.42,0,.20,1) infinite,wrLeafFade 2.4s linear infinite}
.wr-flipleaf.f2{animation-delay:-.8s}
.wr-flipleaf.f3{animation-delay:-1.6s}
.wr-flipface{position:absolute;inset:0;overflow:hidden;border:1px solid rgba(255,255,255,.28);backface-visibility:hidden;-webkit-backface-visibility:hidden}
.wr-flipface.front{border-radius:1px 2px 2px 1px;background:linear-gradient(105deg,#2189dc,#36a4f8 28%,#78c6ff 74%,#b5e2ff)}
.wr-flipface.back{border-radius:2px 1px 1px 2px;background:linear-gradient(255deg,#2189dc,#36a4f8 28%,#78c6ff 74%,#b5e2ff);transform:rotateY(180deg)}
@keyframes wrLeafTurn{from{transform:rotateY(0)}to{transform:rotateY(-180deg)}}
@keyframes wrLeafFade{0%{opacity:0}5%,91%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion: reduce){.wr-flipleaf{animation:none}.wr-flipleaf.f1{opacity:1;transform:rotateY(-28deg)}}
.wr-readerdock:active{cursor:grabbing}
.wr-readerdock-drag{opacity:.85;box-shadow:0 8px 20px rgba(0,0,0,.25)}
/* 一级 tabs 响应式：优先换行，极限窄时横向滚动，绝不溢出遮挡宿主元素 */
.wr-tabs{display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);padding:0 8px;flex:none;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.wr-tab{padding:8px 12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);background:none;border-top:none;border-left:none;border-right:none;font-size:13px;white-space:nowrap;flex:none}
.wr-tab:hover{color:var(--dsw-alias-label-primary)}
.wr-tab-active{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.wr-body{flex:1;min-height:0;overflow:auto;padding:12px 16px}
.wr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.wr-btn{padding:4px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsh-alias-bg-layer-2, var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px}
.wr-btn:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.wr-btn:disabled{opacity:.5;cursor:not-allowed}
.wr-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.wr-btn-primary:hover{opacity:.9;color:#fff}
.wr-input{padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;min-width:120px}
.wr-input:focus{border-color:var(--dsw-alias-brand-primary)}
.wr-select{padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px}
.wr-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.wr-muted{color:var(--dsw-alias-label-secondary)}
.wr-small{font-size:11px}
.wr-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:48px 0;color:var(--dsw-alias-label-secondary)}
.wr-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 16px;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,.2)}
.wr-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:90}
.wr-modal{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:20px;max-width:520px;width:92%;max-height:86vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.3)}
.wr-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 16px}
.wr-row{display:flex;align-items:center;gap:8px}
.wr-spin{display:inline-block;width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:wr-rot 0.8s linear infinite}
@keyframes wr-rot{to{transform:rotate(360deg)}}
`;

/* 由 build.mjs 注入（源：package.json version）——勿手改此行 */
W.VERSION = "1.9.11";
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
            st?.gateway?.upgrade?.info && h('div', { className: 'wr-summary', style: { color: 'var(--dsw-alias-warning, #d29922)' } },
              W.t.skillVersionTip(JSON.stringify(st.gateway.upgrade.info).slice(0, 160))),
            st?.syncState?.reconcile && h('div', { className: 'wr-set-row', style: { marginTop: 4 } },
              // 标签默认固定 110px，长内容会溢出与右侧状态文字叠印——本行放开宽度并整段不折行，行内放不下则整段换行
              h('span', { className: 'wr-set-label', style: { width: 'auto', flex: '0 1 auto', whiteSpace: 'nowrap' } }, W.t.gatewayReconcile,
                h('span', { className: 'wr-muted wr-small', style: { whiteSpace: 'nowrap' } }, `（${W.fmtDateTime(st.syncState.reconcile.checkedAt)}）`)),
              h('span', {
                className: 'wr-small',
                style: { color: st.syncState.reconcile.mismatchedCount > 0 ? 'var(--dsw-alias-warning, #d29922)' : 'var(--dsw-alias-success, #3fb950)' },
              }, st.syncState.reconcile.mismatchedCount > 0
                ? W.t.gatewayReconcileBad(st.syncState.reconcile.checkedBooks, st.syncState.reconcile.mismatchedCount)
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
