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
