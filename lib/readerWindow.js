/**
 * 单例阅读窗口（v1.5.0，参考 WebBar 的单窗口容器模型）
 *
 * WebBar 的核心机制：唯一的 NSPanel 在 App 内创建一次，之后所有「打开」都复用同一实例
 * （show() = setFrame + orderFront + makeKeyAndOrderFront），内容在窗口内导航切换，
 * 永不新建第二个窗口。本模块把同一模型迁移到插件侧：
 *
 * - 窗口体 = Chrome app-mode 窗口（顶层浏览上下文，v1.4.0 实测不触发微信读书风控），
 *   绑定专用 --user-data-dir（登录态/窗口位置持久，等价 WebBar 的持久 WKWebsiteDataStore）。
 * - 单例保证 = CDP（--remote-debugging-port，仅 127.0.0.1）。窗口已存在 → Page.navigate
 *   原窗口导航 + bringToFront 置前（等价 WebBar 的复用同一 panel）；窗口不在 → 才拉起一次。
 *   每次打开后强制收敛到 ≤1 个页面目标（多出的窗口直接关掉）。
 * - 绝不开第二个窗口、绝不落默认浏览器（用户规则）；Chrome 完全不可用时报错引导，
 *   唯一兜底是 Chrome 同窗口页签（v1.4.9 机制，仅在拉起彻底失败时）。
 * - 登录态：首次拉起后若 profile 内无 weread Cookie，则把插件已存账号 Cookie
 *   （wr_vid/wr_skey）经 CDP 注入；已有（如窗口内扫码过）则不动，避免旧 Cookie 覆盖新会话。
 * - 反关闭护甲 + 迷你工具条（v1.6.0）：引导脚本置空 window.close（app 窗口无浏览历史，
 *   页面脚本可 window.close() 把窗口关掉，微信读书反 SSB 行为），并注入 WebBar 式
 *   迷你顶栏（后退/前进/刷新/回首页，可拖拽、位置记忆、自愈）——动作全在页面内完成，零 CDP 往返。
 *
 * 依赖注入（deps）：fetchJson/wsCall/launchProcess/execOpen/listPids/killPid/sleep/syncKill/checkSession
 * 均可替换，smoke 用假实现驱动全部分支，不拉真 Chrome。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, execFileSync } from 'node:child_process';

// v1.8.18 端口空间：候选端口按账号哈希落进互不相交倾向的 8 连号区（base + slot*8）。
// 真机事故复盘：两账号实例曾同分到 47833——Chrome 绑不上 IPv4 时退绑 [::1]，两实例分占
// 双栈同号端口；probe 只探 127.0.0.1，谁看谁都像「端口空置/别人的窗口」，复用/重开/僵尸
// 清理互相劫持，最终 tier1/2 全部落败 → 兜底 `open -a Chrome` = 浏览器页签。
// 分区 + 双栈探测后：同号共享在构造上不可能，跨账号导航在构造上被拒绝（端口不在本区）。
const PORT_RANGE = { base: 47833, slots: 60, per: 8 };
const portRangeFor = (acc) => {
  let h = 2166136261;
  for (const ch of String(acc ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return PORT_RANGE.base + ((h >>> 0) % PORT_RANGE.slots) * PORT_RANGE.per;
};
const CDP_TIMEOUT_MS = 1500;
const CHROME_HINT = /Chrome|Chromium|Edg\//;

// v1.7.18 退出兜底（进程级）：DSH 退出是「最多 5s 宽限 → process.exit() 强退」（dsh profile-boot
// 的 PROCESS_SHUTDOWN_TIMEOUT_MS）。dispose 的 Browser.close/listPids 全是异步往返，慢机器上
// 被强退打断 → Chrome 成孤儿窗口，下次启动 DSH 受牵连。'exit' 在 process.exit() 前同步触发，
// 这里用纯 syscall（ps 身份核验 + 进程组 SIGTERM，零 await）带走窗口。整个进程只注册一次监听，
// 每个实例把自己的 killOwnedSync 挂进 liveKills；dispose 已同步杀过的即时摘除（防插件重载泄漏）。
const liveKills = new Set();
const exitKillAll = () => { for (const kill of [...liveKills]) { try { kill('process exit'); } catch { /* ignore */ } } };
let exitKillRegistered = false;

// 窗口引导脚本（每个新文档前执行；prepareSession 还会 Runtime.evaluate 立即补跑一次）：
// 1) 置空 window.close——app 窗口无浏览历史，页面脚本可 window.close() 把窗口关掉（微信读书反 SSB），先堵住；
//    P2-28：裸替换后 window.close.toString() 不再返回 native code，会被 nativeness 检测识别——补 toString 伪装；
// 2) 注入 WebBar 式迷你顶栏：后退/前进/刷新/回微信读书首页，可拖拽、位置记忆、3s 自愈。
// v1.7.0 注入脚本：护甲（页面主世界置空 window.close）+ WebBar 式迷你工具条（后退/前进/刷新/回首页，
// 可拖拽、位置记忆、3s 自愈）。经 Runtime.evaluate 按需注入：宿主侧 /json/list 轮询发现 URL 变化才
// 短连注入一次（新文档），之后由页面内自愈维持——全程无持久 CDP 会话、零域启用（附着检视会拖慢重页面）。
const BOOTSTRAP_SCRIPT = `try { var wrClose = function () {}; wrClose.toString = function () { return 'function close() { [native code] }'; }; window.close = wrClose; } catch (e) {}
(function inject() {
  try {
    if (!/(^|\\.)weread\\.qq\\.com$/.test(location.hostname)) return;
    if (document.getElementById('wr-readerbar')) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { inject(); } catch (e) {}
      }, { once: true });
      return;
    }
    var HOME = 'https://weread.qq.com/#home';
    var POS_KEY = 'wr-readerbar-pos';
    var bar = document.createElement('div');
    bar.id = 'wr-readerbar';
    bar.style.cssText = 'position:fixed;z-index:2147483647;display:flex;gap:2px;padding:2px 4px 3px 6px;'
      // 不用 backdrop-filter：常驻毛玻璃对持续重绘的阅读页是稳定的 GPU 开销（v1.6.3 去掉）
      + 'background:rgba(40,40,44,.92);'
      + 'border-radius:0 0 10px 10px;box-shadow:0 1px 4px rgba(0,0,0,.2);user-select:none;-webkit-user-select:none;';
    var SVG = function (d) { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
    var ICONS = {
      back: SVG('<path d="M15 18l-6-6 6-6"/>'),
      fwd: SVG('<path d="M9 18l6-6-6-6"/>'),
      reload: SVG('<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>'),
      home: SVG('<path d="M3 10.5L12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/>'),
    };
    function mk(icon, title, fn) {
      var b = document.createElement('button');
      b.innerHTML = icon; b.title = title; b.setAttribute('aria-label', title);
      b.style.cssText = 'width:26px;height:26px;display:flex;align-items:center;justify-content:center;'
        + 'border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;opacity:.88;padding:0;';
      b.onmouseenter = function () { b.style.background = 'rgba(255,255,255,.18)'; b.style.opacity = '1'; };
      b.onmouseleave = function () { b.style.background = 'transparent'; b.style.opacity = '.88'; };
      b.onclick = function (ev) { ev.stopPropagation(); try { fn(); } catch (e) {} };
      return b;
    }
    // v1.8.4 导航四键：即时反馈 + 连点去抖 + 死历史兜底。app 窗口直开书页时 history 栈是空的，
    // 裸 history.back()/forward() 是无操作（表现为「无反应」）；刷新/回书架在 canvas 书上是整页
    // 重载（秒级无反馈，连点还把导航叠起来越点越卡——表现为「延迟严重」）。
    var wrNavAt = {}; // P2-25：按动作分槽（back/fwd/reload/home 各自计时）——原共享单计时会跨键误吞（如点后退 900ms 内点刷新被静默吞）
    var wrHint = function (txt) {
      try {
        var t = document.getElementById('wr-nav-hint');
        if (!t) {
          t = document.createElement('div'); t.id = 'wr-nav-hint';
          t.style.cssText = 'position:fixed;top:38px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(40,40,44,.92);color:#fff;padding:6px 12px;border-radius:8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.25)';
          (document.documentElement || document.body).appendChild(t);
        }
        t.textContent = txt;
        setTimeout(function () { var el = document.getElementById('wr-nav-hint'); if (el && el.textContent === txt) el.remove(); }, 2200);
      } catch (e) {}
    };
    var wrNavGuard = function (k) {
      var n = Date.now();
      if (n - (wrNavAt[k] || 0) < 900) { wrHint('稍候…'); return false; } // 连点去抖（分槽；被吞时轻提示，避免「无反应」观感）
      wrNavAt[k] = n;
      return true;
    };
    bar.appendChild(mk(ICONS.back, '后退', function () {
      if (!wrNavGuard('back')) return;
      var before = location.href;
      try { history.back(); } catch (e) {}
      setTimeout(function () {
        if (location.href === before) { wrHint('已是最早一页 → 前往书架'); location.href = 'https://weread.qq.com/web/shelf'; }
      }, 450);
    }));
    bar.appendChild(mk(ICONS.fwd, '前进', function () {
      if (!wrNavGuard('fwd')) return;
      var before = location.href;
      try { history.forward(); } catch (e) {}
      setTimeout(function () { if (location.href === before) wrHint('已是最新一页'); }, 450);
    }));
    bar.appendChild(mk(ICONS.reload, '刷新', function () { if (!wrNavGuard('reload')) return; wrHint('刷新中…'); try { location.reload(); } catch (e) {} }));
    bar.appendChild(mk(ICONS.home, '回书架', function () {
      if (!wrNavGuard('home')) return;
      if (location.pathname === '/web/shelf') { wrHint('已在书架'); return; }
      wrHint('前往书架…');
      location.href = 'https://weread.qq.com/web/shelf';
    }));
    // ---- v1.7.7 问 DSH（选中即问）：划选后点此按钮直达 DSH 会话；无选中文本则弹输入框 ----
    try {
      if (!window.__wrAskDSH) window.__wrAskDSH = [];
      window.__wrAskFeedback = function (results) {
        try {
          var t = document.getElementById('wr-ask-toast');
          for (var i = 0; i < (results || []).length; i++) {
            var r = results[i];
            if (!t) {
              t = document.createElement('div'); t.id = 'wr-ask-toast';
              t.style.cssText = 'position:fixed;top:40px;right:12px;z-index:2147483647;background:rgba(40,40,44,.95);color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;max-width:280px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
              (document.documentElement || document.body).appendChild(t);
            }
            t.textContent = r.ok ? ('✓ ' + (r.msg || '已送达 DSH，回答见 DSH 对话窗口')) : ('✗ ' + (r.msg || '发送失败'));
            t.style.background = r.ok ? 'rgba(46,140,70,.95)' : 'rgba(180,60,60,.95)';
          }
          setTimeout(function () { var el = document.getElementById('wr-ask-toast'); if (el) el.remove(); }, 4200);
        } catch (e) {}
      };
      var wrEnqueueAsk = function (q, sel) {
        var book = (document.title || '').split(' - 微信读书')[0].trim();
        var chEl = document.querySelector('.readerTopBar_title_chapter');
        window.__wrAskDSH.push({
          seq: Date.now(), at: Date.now(),
          q: String(q || '').slice(0, 500), sel: String(sel || '').slice(0, 2000),
          book: book.slice(0, 120), chapter: (chEl ? String(chEl.textContent || '') : '').trim().slice(0, 80),
          url: location.href,
        });
        window.__wrAskFeedback([{ ok: true, msg: 'pending' }]);
        var t = document.getElementById('wr-ask-toast'); if (t) t.textContent = '⏳ 已递交 DSH…';
        setTimeout(function () {
          var el = document.getElementById('wr-ask-toast');
          if (el && el.textContent.indexOf('⏳') === 0) { el.textContent = '✗ 30 秒未收到回执（DSH 未运行？）'; el.style.background = 'rgba(180,60,60,.95)'; }
        }, 30000);
      };
      // v1.7.12 选区快照：微信读书划线（马克笔等）会消费掉 DOM 选区——划选瞬间抓快照留存 120s，
      // 之后点「问 DSH」仍能自动带走选中文本（无需手动复制粘贴）
      if (!window.__wrSelSnap) {
        window.__wrSelSnap = { text: '', at: 0 };
        document.addEventListener('selectionchange', function () {
          try {
            var s = String(window.getSelection ? window.getSelection() : '');
            if (s.trim().length >= 4) { window.__wrSelSnap.text = s.slice(0, 2000); window.__wrSelSnap.at = Date.now(); wrSnapArrived && wrSnapArrived(); }
          } catch (e) {}
        }, true);
      }
      // v1.7.14 剪贴板钩：canvas 书选区不进 DOM（user-select:none），但微信读书「复制」的实现
      // （反混淆实测）经 copy 事件的 e.clipboardData.setData(format, text)——挂钩 DataTransfer.setData，
      // 用户点其弹条「复制」的瞬间即截获选中文本（其临时元素的 selectNodeContents 也会顺带喂饱上面的选区快照）
      if (!window.__wrClipHooked) {
        window.__wrClipHooked = true;
        window.__wrClipSnap = { text: '', at: 0 };
        try {
          const origSetData = DataTransfer.prototype.setData;
          DataTransfer.prototype.setData = function (type, value) {
            try {
              if ((type === 'text/plain' || type === 'text' || type === '') && String(value || '').trim().length >= 2) {
                window.__wrClipSnap.text = String(value).slice(0, 2000);
                window.__wrClipSnap.at = Date.now();
                wrSnapArrived(); // v1.7.15：就绪状态下截获即自动发送
              }
            } catch (e) {}
            return origSetData.call(this, type, value);
          };
        } catch (e) {}
      }
      // v1.7.16 capture-copy 监听：官方「复制」真实路径（真机验证）不走 DataTransfer.prototype.setData
      // （事件 clipboardData 另有来源）——改在 document 捕获阶段监听 copy 事件：
      // ① 每事件包裹实例级 clipboardData.setData；② 复制瞬间官方临时元素的选区文本就在
      // window.getSelection() 里（其实现是 selectNodeContents(tempEl)+execCommand），直接读取。双保险。
      if (!window.__wrCopyCapHooked) {
        window.__wrCopyCapHooked = true;
        var wrCapSnapshot = function (text) {
          try {
            if (text && String(text).trim().length >= 2) {
              window.__wrClipSnap.text = String(text).slice(0, 2000);
              window.__wrClipSnap.at = Date.now();
              wrSnapArrived && wrSnapArrived();
            }
          } catch (e) {}
        };
        document.addEventListener('copy', function (ev) {
          try {
            var cd = ev.clipboardData;
            if (cd && cd.setData) {
              var orig = cd.setData.bind(cd);
              cd.setData = function (t, v) { wrCapSnapshot(v); return orig(t, v); };
            }
            var s = String(window.getSelection ? window.getSelection() : '');
            if (s.trim().length >= 2) wrCapSnapshot(s); // 官方临时元素选区（复制瞬间在场）
          } catch (e) {}
        }, true);
      }
      // v1.7.17 划线接口自捕获：官方划线（马克笔/波浪线/直线/想法）会把选中文本（abstract/markText）
      // 发进自家 API 请求体（bundle 反混淆实测）——挂 fetch/XHR 截获之。点马克笔 = 天然文本出口，
      // 无需复制。排除埋点（river/report/midas）与 base64 形态载荷。
      if (!window.__wrApiHooked) {
        window.__wrApiHooked = true;
        window.__wrApiSnap = { text: '', at: 0 };
        var wrApiConsider = function (url, bodyText) {
          try {
            if (!bodyText || typeof bodyText !== 'string') return;
            var u = String(url || '');
            if (!/weread\.qq\.com/.test(u)) return;
            if (/river|report|midas|logging/.test(u)) return;
            var data;
            try { data = JSON.parse(bodyText); } catch (e) { return; }
            if (!data || typeof data !== 'object') return;
            var best = '';
            var pick = function (v) {
              if (typeof v !== 'string' || v.length < 4 || v.length > 2000) return;
              if (v.length > 40 && /^[A-Za-z0-9+/=\s]+$/.test(v)) return;
              if (!/[\u4e00-\u9fffA-Za-z]/.test(v)) return;
              if (v.length > best.length) best = v;
            };
            pick(data.abstract); pick(data.markText); pick(data.content); pick(data.text);
            if (best) {
              window.__wrApiSnap.text = best;
              window.__wrApiSnap.at = Date.now();
              wrSnapArrived && wrSnapArrived();
            }
          } catch (e) {}
        };
        if (window.fetch) {
          var origFetch = window.fetch.bind(window);
          window.fetch = function (input, init) {
            try {
              var u = typeof input === 'string' ? input : (input && input.url) || '';
              if (init && typeof init.body === 'string' && (!init.method || String(init.method).toUpperCase() !== 'GET')) wrApiConsider(u, init.body);
            } catch (e) {}
            return origFetch(input, init);
          };
        }
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u) { try { this.__wrUrl = u; } catch (e) {} return origOpen.apply(this, arguments); };
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
          try { if (typeof body === 'string') wrApiConsider(String(this.__wrUrl || ''), body); } catch (e) {}
          return origSend.apply(this, arguments);
        };
      }
      // v1.7.15 就绪-自动发（时序反转）：官方「复制」会收起弹条，弹条里的问 DSH 随之消失——
      // 先点「问 DSH」进入 60s 就绪态，再点「复制」（弹条收掉无妨），截获即自动发送；就绪期内再点=手动输入
      var wrArmed = 0;
      var wrTrySend = function () {
        var sel = '';
        try { sel = String(window.getSelection ? window.getSelection() : ''); } catch (e) {}
        if (sel.trim().length < 4 && window.__wrSelSnap && Date.now() - window.__wrSelSnap.at < 120000) sel = window.__wrSelSnap.text;
        if (sel.trim().length < 4 && window.__wrClipSnap && Date.now() - window.__wrClipSnap.at < 120000) sel = window.__wrClipSnap.text;
        // v1.7.17：划线接口自捕获（点马克笔即截获，无需复制）
        if (sel.trim().length < 4 && window.__wrApiSnap && Date.now() - window.__wrApiSnap.at < 120000) sel = window.__wrApiSnap.text;
        if (sel.trim().length > 3) { wrEnqueueAsk('', sel); return true; }
        return false;
      };
      var wrSnapArrived = function () {
        if (wrArmed && Date.now() - wrArmed < 60000) { wrArmed = 0; wrAskBoxHide(); wrTrySend(); }
      };
      // v1.7.19 输入框收纳三保险：90 秒无输入自动收起 / 点框外即收起 / Esc 收起。
      // 原版只有「就绪期内再点按钮」能收起——60s 一过就永远关不掉，白框常驻遮挡阅读内容。
      var wrAskBoxTimer = 0;
      var wrAskBoxHide = function () {
        var b = document.getElementById('wr-ask-input');
        if (b) b.style.display = 'none';
        if (wrAskBoxTimer) { clearTimeout(wrAskBoxTimer); wrAskBoxTimer = 0; }
      };
      var wrAskBoxTouch = function () {
        if (wrAskBoxTimer) clearTimeout(wrAskBoxTimer);
        wrAskBoxTimer = setTimeout(wrAskBoxHide, 90000);
      };
      var wrAskTrigger = function () {
        if (wrTrySend()) return;
        var box = document.getElementById('wr-ask-input');
        if (box && box.style.display !== 'none') { box.style.display = 'none'; if (wrAskBoxTimer) { clearTimeout(wrAskBoxTimer); wrAskBoxTimer = 0; } return; } // 输入框开着：再点=收起（不论就绪是否过期）
        if (Date.now() - wrArmed < 60000) { // 已就绪：再点 = 手动输入
          if (box) {
            box.style.display = 'flex';
            wrAskBoxTouch();
            try { box.querySelector('input').focus(); } catch (e) {}
          }
          return;
        }
        wrArmed = Date.now();
        window.__wrAskFeedback([{ ok: true, msg: 'armed' }]);
        var t = document.getElementById('wr-ask-toast');
        if (t) { t.textContent = '⏳ 就绪：现在划线（马克笔）或点「复制」，截到选区即自动发送（60 秒内有效；再点此处改为手动输入）'; t.style.background = 'rgba(40,40,44,.95)'; }
      };
      if (!window.__wrAskBoxGuards) { // 3s 自愈会重跑 inject()：文档级监听每文档只挂一次
        window.__wrAskBoxGuards = 1;
        document.addEventListener('click', function (e) {
          var b = document.getElementById('wr-ask-input');
          if (!b || b.style.display === 'none') return;
          for (var n = e.target; n; n = n.parentNode) {
            if (n === b) return; // 点在框内：不收
            if (n.id === 'wr-readerbar' || (n.classList && n.classList.contains('wr-ask-item'))) return; // 点「问 DSH」按钮：交给开合切换逻辑
          }
          wrAskBoxHide();
        }, true);
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape') return;
          var b = document.getElementById('wr-ask-input');
          if (b && b.style.display !== 'none') wrAskBoxHide();
        }, true);
      }
      // v1.7.20 工具条「✦ 问 DSH」专职开合输入框：点开（聚焦）/再点收起/失焦自动收起。
      // 就绪-自动发等其余功能从工具条移除（用户需求）；划选弹条入口保留完整取词流。
      var wrToolbarAsk = function () {
        var box = document.getElementById('wr-ask-input');
        if (!box) return;
        if (box.style.display === 'none') {
          box.style.display = 'flex';
          wrAskBoxTouch();
          try { box.querySelector('input').focus(); } catch (e) {}
        } else { wrAskBoxHide(); }
      };
      // v1.7.12 输入框预渲染：点击只做显示切换（原点击时建 DOM，赶上页面渲染高亮会明显卡顿）
      var askBox = document.getElementById('wr-ask-input');
      if (!askBox) {
        askBox = document.createElement('div'); askBox.id = 'wr-ask-input';
        askBox.style.cssText = 'position:fixed;top:36px;right:12px;z-index:2147483647;background:#fff;border-radius:10px;padding:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);display:none;gap:6px;';
        var ip = document.createElement('input');
        ip.placeholder = '输入问题，回车或点发送…';
        ip.style.cssText = 'width:230px;border:1px solid #ddd;border-radius:6px;padding:6px 8px;font-size:13px;outline:none;color:#222;';
        var bn = document.createElement('button'); bn.textContent = '发送';
        bn.style.cssText = 'border:0;background:rgb(52,167,255);color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:13px;';
        var askSend = function () { var v = ip.value.trim(); if (!v) return; askBox.style.display = 'none'; if (wrAskBoxTimer) { clearTimeout(wrAskBoxTimer); wrAskBoxTimer = 0; } wrEnqueueAsk(v, ''); };
        bn.onclick = function (e) { e.stopPropagation(); askSend(); };
        ip.addEventListener('keydown', function (e) { wrAskBoxTouch(); if (e.key === 'Enter') askSend(); if (e.key === 'Escape') { askBox.style.display = 'none'; } e.stopPropagation(); });
        ip.addEventListener('input', function () { wrAskBoxTouch(); });
         ip.addEventListener('blur', function () { // v1.7.20 失焦自动收起（150ms 宽限：点「发送」的 mousedown 先触发 blur，不能吃掉其 click）
           setTimeout(function () {
             var b = document.getElementById('wr-ask-input');
             if (!b || b.style.display === 'none') return;
             for (var n2 = document.activeElement; n2; n2 = n2.parentNode) if (n2 === b) return; // 焦点仍在框内（发送按钮上）
             wrAskBoxHide();
           }, 150);
         });
        askBox.appendChild(ip); askBox.appendChild(bn);
        (document.documentElement || document.body).appendChild(askBox);
      }
      // v1.7.13 划选弹条注入：微信读书的选区弹条出现时，克隆其「AI问书」按钮注入一枚「问 DSH」
      // （真实点击曾被其弹条遮挡截走；注入其内则天然可达，且与官方入口并排可直接对比）
      window.__wrAskTrigger = wrAskTrigger;
      // v1.7.20 弹条「问 DSH」：点击即取选区（修「未自动带走选中文本」）。
      // canvas 书选区不在 DOM、弹条出现前又没有任何动作快照——但真实点击给了文档瞬时激活
      // （user activation 是文档级），借道同弹条官方「复制」按钮触发其复制流：execCommand 在
      // 激活窗口内放行，copy 事件被我们的钩同步截获 → wrTrySend 自动发送 + 送达 toast。
      var wrPopupAsk = function () {
        if (wrTrySend()) return; // 已有快照（划线/复制过）或 DOM 选区可用：直接发
        var cont = document.querySelector('.reader_toolbar_itemContainer');
        var items = cont ? cont.querySelectorAll('.toolbarItem') : [];
        var copied = false;
        for (var i = 0; i < items.length; i++) {
          var tx = null;
          try { tx = items[i].querySelector('.toolbarItem_text'); } catch (e) {}
          if (tx && String(tx.textContent || '').indexOf('复制') >= 0) {
            try { items[i].click(); copied = true; } catch (e) {}
            break;
          }
        }
        if (!copied) { wrAskTrigger(); return; } // 无「复制」可借：回落就绪态
        var n = 3; // 90ms×4 次：其复制流可能异步
        var attempt = function () {
          setTimeout(function () {
            if (wrTrySend()) return; // 借道成功：copy 钩已截获 → 自动发送（含 ⏳/送达 toast）
            if (n-- > 0) { attempt(); return; }
            wrAskTrigger(); // ~360ms 仍未截到：回落就绪态
          }, 90);
        };
        attempt();
      };
      window.__wrPopupAsk = wrPopupAsk;
      var wrPopupInject = function () {
        try {
          var cont = document.querySelector('.reader_toolbar_itemContainer');
          if (!cont || !(cont.offsetWidth || cont.offsetHeight)) return;
          if (cont.querySelector('.wr-ask-item')) return;
          var ref = cont.querySelector('.toolbarItem.query') || cont.querySelector('.toolbarItem');
          if (!ref) return;
          var it = ref.cloneNode(true); // 克隆不带原监听（cloneNode 语义），无误触发风险
          it.classList.add('wr-ask-item');
          var tx = it.querySelector('.toolbarItem_text'); if (tx) tx.textContent = '问 DSH';
          try { it.style.color = 'rgb(52,167,255)'; } catch (e) {}
          it.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); wrPopupAsk(); });
          cont.appendChild(it);
        } catch (e) {}
      };
      window.__wrPopupInject = wrPopupInject;
      wrPopupInject();
      var askBtn = mk(SVG('<path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>'), '问 DSH：输入问题', wrToolbarAsk);
      askBtn.style.color = 'rgb(52,167,255)';
      bar.appendChild(askBtn);
    } catch (e) {}
    (document.documentElement || document.body).appendChild(bar);
    // v1.8.4 失联自愈：MutationObserver 盯 documentElement 直系子节点——微信读书重渲染把工具栏
    // 摘掉的瞬间立即补回（原 3s 轮询最坏留 3 秒「看得见点不动」死窗）。只观察直系 childList，
    // 页面内部 churn（body 子树）不触发，开销为零负担。
    try {
      if (!window.__wrBarObserver) {
        window.__wrBarObserver = new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var removed = muts[i].removedNodes;
            for (var j = 0; j < removed.length; j++) {
              if (removed[j] && removed[j].id === 'wr-readerbar') {
                setTimeout(function () { try { if (!document.getElementById('wr-readerbar')) inject(); } catch (e) {} }, 150);
                return;
              }
            }
          }
        });
        window.__wrBarObserver.observe(document.documentElement, { childList: true });
      }
    } catch (e) {}
    // 位置：默认贴顶右上角（紧贴标题栏正下方，形如标题栏延伸）；有记忆则还原；可拖拽任意放置
    try {
      var pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        bar.style.left = Math.max(0, Math.min(pos.left, innerWidth - 40)) + 'px';
        bar.style.top = Math.max(0, Math.min(pos.top, innerHeight - 20)) + 'px';
      } else { bar.style.top = '0px'; bar.style.right = '0px'; }
    } catch (e) { bar.style.top = '0px'; bar.style.right = '0px'; }
    var dragging = false, dx = 0, dy = 0;
    bar.addEventListener('pointerdown', function (ev) {
      if (ev.target.tagName === 'BUTTON') return;
      dragging = true; bar.setPointerCapture(ev.pointerId);
      var r = bar.getBoundingClientRect(); dx = ev.clientX - r.left; dy = ev.clientY - r.top;
      bar.style.right = 'auto';
    });
    bar.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      bar.style.left = Math.max(0, Math.min(ev.clientX - dx, innerWidth - 40)) + 'px';
      bar.style.top = Math.max(0, Math.min(ev.clientY - dy, innerHeight - 20)) + 'px';
    });
    bar.addEventListener('pointerup', function () {
      if (!dragging) return; dragging = false;
      try {
        var r = bar.getBoundingClientRect();
        localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
      } catch (e) {}
    });
    // 自愈：SPA 重渲染若把工具条移出 DOM，周期性补回（函数幂等，按 id 去重；定时器只注册一次）
    // v1.7.13：同一周期顺带补注划选弹条里的「问 DSH」（弹条随选区创建/销毁，每轮检查幂等注入）
    if (!window.__wrBarTimer) {
      window.__wrBarTimer = setInterval(function () {
        try { inject(); } catch (e) {}
        try { window.__wrPopupInject && window.__wrPopupInject(); } catch (e) {}
      }, 3000);
    }
  } catch (e) {}
})();
// 注：命名函数表达式的名字不在外层作用域，追加 inject() 必抛 ReferenceError——此处保持空`;

export function createReaderWindow({
  stateDir,
  log = () => {},
  getAccountId,
  getCookies = () => undefined,
  deps = {},
}) {
  // v1.8.10 多账号隔离：profile/state 按活跃账号分目录（reader-profile-<acc> / reader-window.<acc>.json）。
  // 每账号独立登录态与窗口单例、bounds 各自记忆；切账号后 open() 自动落新账号 scope。
  // 无账号场景（未登录）沿用旧路径，存量状态无缝兼容。
  const PROFILE_BASE = path.join(stateDir, 'reader-profile');
  let profileDir = PROFILE_BASE;
  let stateFile = path.join(stateDir, 'reader-window.json');
  let scopeRange = portRangeFor(''); // v1.8.18：当前账号端口区（refreshAccountScope 刷新）
  const refreshAccountScope = () => {
    const getter = typeof deps.getAccountId === 'function' ? deps.getAccountId : getAccountId;
    const acc = typeof getter === 'function' ? String(getter() || '').replace(/[^\w.-]/g, '') : '';
    profileDir = acc ? `${PROFILE_BASE}-${acc}` : PROFILE_BASE;
    stateFile = path.join(stateDir, acc ? `reader-window.${acc}.json` : 'reader-window.json');
    scopeRange = portRangeFor(acc);
  };
  // v1.8.18 端口归属核验：具名账号只认本区 8 个端口（跨区=别人的窗口/遗留状态，绝不复用
  // 与操作）；无账号（''）沿用整个端口空间（存量单账号用户旧状态无缝兼容）。
  const portInScope = (p) => Number.isInteger(p) && p >= PORT_RANGE.base && p < PORT_RANGE.base + PORT_RANGE.slots * PORT_RANGE.per
    && (scopeRange === portRangeFor('') ? true : (p >= scopeRange && p < scopeRange + PORT_RANGE.per));

  const fetchJson = deps.fetchJson ?? (async (port, pathname, host = '127.0.0.1') => {
    // host 传 '[::1]'（IPv6 字面量）时 URL 合法；v1.8.18 双栈探测用
    const r = await fetch(`http://${host}:${port}${pathname}`, { signal: AbortSignal.timeout(CDP_TIMEOUT_MS) });
    return r.json();
  });
  const wsCall = deps.wsCall ?? ((wsUrl, commands) => new Promise((resolve, reject) => {
    // Node ≥22 全局 WebSocket；每轮命令新建短连接，使用频率低（每次打开书一轮），无需长连
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { reject(e); return; }
    const results = [];
    // P2-27：超时句柄留存，done/fail 时清理且只清一次（幂等）——原句柄不存不清，命令完成后
    // 残留 timer 仍会在 5s 到点时空放一次 fail（日志噪音 + 定时器泄漏）。
    let timeoutTimer = null;
    let timeoutCleared = false;
    const done = (fn) => {
      if (!timeoutCleared) { timeoutCleared = true; clearTimeout(timeoutTimer); }
      try { ws.close(); } catch { /* ignore */ } fn();
    };
    const fail = (e) => done(() => reject(e));
    ws.addEventListener('error', () => fail(new Error('CDP WebSocket 连接失败')));
    ws.addEventListener('close', () => { if (results.length < commands.length) fail(new Error('CDP WebSocket 提前断开')); });
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== undefined) results.push(msg);
      if (results.length === commands.length) done(() => resolve(results));
    });
    ws.addEventListener('open', () => {
      commands.forEach((c, i) => ws.send(JSON.stringify({ id: i + 1, method: c.method, params: c.params ?? {} })));
    });
    timeoutTimer = setTimeout(() => { if (results.length < commands.length) fail(new Error('CDP 命令超时')); }, 5000);
    timeoutTimer.unref?.();
  }));
  const launchProcess = deps.launchProcess ?? ((bin, args) => new Promise((resolve) => {
    // 直接 spawn（不经 LaunchServices）：参数必然完整传入，且不经过 `open` 的 --args 丢弃问题
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    child.unref();
    resolve({ pid: child.pid });
  }));
  const execOpen = deps.execOpen ?? ((args) => new Promise((resolve) => {
    execFile('open', args, { timeout: 8000 }, (err) => resolve({ ok: !err, error: err?.message }));
  }));
  const listPids = deps.listPids ?? (() => new Promise((resolve) => {
    execFile('pgrep', ['-f', profileDir], (err, stdout) => resolve(err ? [] : String(stdout).split('\n').filter(Boolean).map(Number)));
  }));
  const killPid = deps.killPid ?? ((pid) => { try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ } });
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // 超时可通过 deps.timeouts 缩短（smoke 用假时钟快速穿过失败分支）
  const T = { ready: 9000, tier1: 6000, tier2: 8000, boundsWatch: 5000, injectWatch: 1500, jamWatch: 20000, harvestWatch: 600_000, ...(deps.timeouts ?? {}) };
  // v1.7.4：dispose 后拒绝一切「复活」动作——watchdog 自愈走到一半（closeTarget→sleep→重开）时
  // 宿主退出，清掉定时器拦不住已在飞的回调：ensureWindow 仍会重拉 Chrome，窗口在 DSH 退出后复活。
  let disposed = false;

  // ---------- 基础探测 ----------
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
  const writeState = (patch) => {
    const next = { ...readState(), ...patch, updatedAt: Date.now() };
    try { fs.writeFileSync(stateFile, JSON.stringify(next, null, 2)); } catch { /* ignore */ }
    return next;
  };

  // ---------- v1.7.18 退出兜底：宿主强退也带走阅读窗口 ----------
  const ownedPids = new Set(); // 本宿主生命周期内 tier1 spawn 的浏览器主进程（detached spawn → 即进程组长；v1.8.10 多账号多实例并记）
  const syncKill = deps.syncKill ?? ((pid) => {
    // 身份核验（防 pid 复用误杀无辜进程）：exit 钩子只剩同步手段，ps 命令行含本 profile 基前缀才杀
    // （基前缀覆盖全部账号 profile——多账号并存时 exit 兜底带走所有实例）
    try {
      const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { timeout: 1500 }).toString();
      if (!cmd.includes(PROFILE_BASE)) return false;
    } catch { return false; }
    try { process.kill(-pid, 'SIGTERM'); return true; } // 杀组长=带全组（渲染/GPU 子进程一并退出）
    catch { try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; } }
  });
  const killOwnedSync = (reason) => {
    // 候选=内存 ownedPids + 所有账号 state 落盘 pid（每账号独立 state 文件）；每个都过身份核验
    const pids = new Set([...ownedPids].filter((p) => p && p > 0));
    try {
      for (const f of fs.readdirSync(stateDir)) {
        if (!/^reader-window(\..+)?\.json$/.test(f)) continue;
        try {
          const pid = Number(JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8')).pid);
          if (pid > 0) pids.add(pid);
        } catch { /* 单文件失败忽略 */ }
      }
    } catch { /* 目录不可读 */ }
    let hit = 0;
    for (const pid of pids) if (syncKill(pid)) hit += 1;
    if (hit) log('INFO', `reader-window 退出兜底：SIGTERM 进程组 pid=${[...pids].join(',')}（${reason}，命中 ${hit}/${pids.size}）`);
    return hit > 0;
  };
  const noteOwnedPid = (sp) => {
    if (sp?.pid) { ownedPids.add(sp.pid); writeState({ pid: sp.pid }); }
  };
  liveKills.add(killOwnedSync);
  if (!exitKillRegistered) { exitKillRegistered = true; process.on('exit', exitKillAll); }

  /** @returns {{ok:boolean, port?:number, browser?:string, targets?:Array}} CDP 是否活着（区分：进程活着但窗口已关 → targets 空）
   * v1.8.18 双栈探测：Chrome 在 IPv4 被占时会退绑 [::1]（真机实况）——只探 127.0.0.1 会把
   * 「v6 上的自己」误判成端口空置。任一栈应答即视为端口活着；非 Chrome 应答（foreign）立即返回。 */
  const probe = async (port) => {
    for (const host of ['127.0.0.1', '[::1]']) {
      try {
        const ver = await fetchJson(port, '/json/version', host);
        if (!ver || !CHROME_HINT.test(String(ver.Browser ?? ''))) return { ok: false, port, foreign: !!ver };
        const list = await fetchJson(port, '/json/list', host).catch(() => []);
        // 过滤内部目标（omnibox-popup 等）：type 也是 page，但不是阅读窗口内容。
        // P2-26：补排 about:blank / devtools:// / edge:// 前缀（原只排 chrome://，Chromium 系内部页
        // 与空白页会被计入 targets，误判「窗口在」）——语义与 closeExtraTargets 的「真实窗口」判定对齐。
        const targets = (Array.isArray(list) ? list : []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl
          && !['chrome://', 'about:blank', 'devtools://', 'edge://'].some((pre) => String(t.url).startsWith(pre)));
        return { ok: true, port, browser: ver.Browser, targets, wsUrl: ver.webSocketDebuggerUrl };
      } catch { /* 该栈无应答，试下一栈 */ }
    }
    return { ok: false, port };
  };

  // P2-22（对抗审查 v2 第三批）：三路轮询（bounds/inject/jam，同属本实例）共享的 probe 结果缓存。
  // 成功 TTL 700ms / 失败 TTL 300ms——失败短 TTL 防止窗口刚拉起时 1.5s 的 inject 轮询拿到 5s 前
  // bounds 轮询的陈旧失败；命中即复用不打 HTTP。故意放实例作用域而非模块级：模块级单槽会被并存实例
  // （热重载窗口期）互相覆盖，inject 守护看到的 targets 在两实例间来回翻转 → 同一文档被重复注入。
  let lastProbe = { at: 0, p: null };
  // P2-22：三路轮询共用的 probe 入口——命中缓存直接复用，过期才真打一次 HTTP。
  // 端口优先沿用缓存结果自己的 port（结果与端口同源），否则读 state。
  const sharedProbe = async () => {
    if (Date.now() - lastProbe.at < (lastProbe.p?.ok ? 700 : 300)) return lastProbe.p;
    lastProbe = { at: Date.now(), p: await probe(lastProbe.p?.port ?? readState().port) };
    return lastProbe.p;
  };

  const pickPort = async () => {
    // v1.8.18：usable 双栈空置判定——v4 或 v6 任一栈有应答（Chrome 或陌生服务）都算占用。
    const usable = async (p) => {
      const r = await probe(p);
      return !r.ok && !r.foreign;
    };
    // 先扫本账号端口区（8 连号）；满员才退避全区（罕见：哈希撞区的两账号 + 区内全占）
    for (let i = 0; i < PORT_RANGE.per; i++) {
      const p = scopeRange + i;
      if (await usable(p)) return p;
    }
    for (let s = 0; s < PORT_RANGE.slots; s++) {
      for (let i = 0; i < PORT_RANGE.per; i++) {
        const p = PORT_RANGE.base + s * PORT_RANGE.per + i;
        if (await usable(p)) return p;
      }
    }
    return null;
  };

  const chromeExecutable = () => {
    // 惰性解析：deps 注入优先（smoke/测试），默认按平台常见路径探测（返回路径字符串或 null）
    if (deps.chromeExecutable) return deps.chromeExecutable();
    const home = os.homedir();
    const candidates = process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
      : process.platform === 'win32'
        ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
    }
    return null;
  };

  const buildArgs = (url, port, { firstLaunch = true } = {}) => [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    // v1.7.3 防冻结三件套：页面被遮挡/后台 5 分钟会被 Chrome 冻结（JS 全停，点击无反应，
    // 实测 DevTools evaluate 超时）——阅读窗口必须常驻活跃，禁用一切后台节流/冻结。
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--no-first-run', '--no-default-browser-check',
    // --window-size 只作首次默认值；有记忆 bounds 后不再传（否则每次覆盖掉还原的位置大小）
    ...(firstLaunch ? ['--window-size=1240,900'] : []),
  ];

  // ---------- 窗口位置大小记忆（v1.5.3）：捕获 → 存 state → 下次全新拉起时还原 ----------
  const captureWindowBounds = async (wsUrl, targetId) => {
    if (!wsUrl || !targetId) return;
    try {
      const res = await wsCall(wsUrl, [{ method: 'Browser.getWindowForTarget', params: { targetId } }]);
      const b = res[0]?.result;
      if (b?.windowId && b?.bounds && b.bounds.width > 0) {
        writeState({
          bounds: {
            left: b.bounds.left, top: b.bounds.top, width: b.bounds.width, height: b.bounds.height,
            windowState: b.bounds.windowState ?? 'normal',
          },
        });
        log('INFO', `reader-window bounds captured: ${JSON.stringify(b.bounds)}`);
      }
    } catch (e) { log('WARN', `reader-window bounds capture 失败：${e.message}`); }
  };

  const restoreWindowBounds = async (wsUrl, targetId) => {
    const saved = readState().bounds;
    if (!saved || !wsUrl || !targetId) return;
    try {
      const res = await wsCall(wsUrl, [{ method: 'Browser.getWindowForTarget', params: { targetId } }]);
      const windowId = res[0]?.result?.windowId;
      if (!windowId) return;
      const state = saved.windowState === 'maximized' || saved.windowState === 'fullscreen' ? saved.windowState : 'normal';
      const want = state === 'normal'
        ? { windowState: 'normal', left: saved.left, top: saved.top, width: saved.width, height: saved.height }
        : { windowState: state };
      await wsCall(wsUrl, [{ method: 'Browser.setWindowBounds', params: { windowId, bounds: want } }]);
      log('INFO', `reader-window bounds restored: ${JSON.stringify(want)}`);
    } catch (e) { log('WARN', `reader-window bounds restore 失败：${e.message}`); }
  };

  /** 等待 CDP 就绪且出现页面目标（拉起/转发新窗口均适用；spawn 的进程退出但 CDP 活着也算成功） */
  const waitReady = async (port, timeoutMs = 9000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const p = await probe(port);
      if (p.ok && p.targets.length) return p;
      await sleep(300);
    }
    return null;
  };

  const parseCookieHeader = (raw) => String(raw ?? '')
    .split(';').map((s) => s.trim()).filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return i > 0 ? { name: pair.slice(0, i), value: pair.slice(i + 1) } : null;
    })
    .filter((c) => c && /^(wr_|rq|qq_)/.test(c.name));

  /**
   * 会话整理：Cookie 注入（仅 profile 无有效 weread Cookie 时）+ 收敛到单窗口。
   * 全部 best-effort，失败只记日志不阻断打开。
   * v1.7.6 会话互通：原判定只看 Cookie 日期——服务端已死的 skey（日期未到）永不换血，
   * 表现为「悬浮 icon 开的窗口看着已登录（旧页面未重导航），发现列表/详情开书即露馅过期」。
   * 现三态裁决 + 反向同步：
   * 1) 窗内 skey 缺失/日期过期 → 注入插件凭据（原行为）；
   * 2) 窗内 skey 与插件 skey 值不同 → deps.checkSession 服务端裁决窗内会话：死 → 注入插件凭据；
   *    活（如窗内扫码的新会话）→ 不动，并经 deps.onWindowSession 上报宿主（宿主可采纳救活 Cookie 通道）；
   * 3) 值相同 → v1.9.0 B1 同源也裁决（带缓存）：死 → loginExpired 提前归因（书页会「加载失败」，
   *    别让用户误判窗口坏了）；活/网络异常 → 视为同源会话，跳过。
   * @returns {{injected:boolean}} injected=真注入过（调用方对同 URL 页面应强制重载，撕掉过期假象）
   */
  // v1.9.0 B1：服务端裁决缓存（10min，实例级）——三处裁决共用；连续开书/推窗不重复打服务端。
  // 只缓存确定性结论（true/false）；网络异常（undefined）不缓存（下次照问，保持保守）。
  // v1.9.2 F2：上限 64 条 FIFO 淘汰——skey 换血频率天级、增长慢，但实例常驻（quitOnClose=off）时
  // 理论无界；64 条 × 极小对象，超限删最旧（Map 保插入序，缓存语义本就 10min 过期，无损）。
  const VERDICT_CACHE_MS = 10 * 60 * 1000;
  const VERDICT_CACHE_MAX = 64;
  const verdictCache = new Map(); // `${vid}|${skey}` -> { ok: boolean, at: number }
  const adjudicate = async (vid, skey) => {
    if (typeof deps.checkSession !== 'function') return undefined;
    const key = `${vid ?? ''}|${skey ?? ''}`;
    const hit = verdictCache.get(key);
    if (hit && Date.now() - hit.at < VERDICT_CACHE_MS) return hit.ok;
    const v = await deps.checkSession({ wrVid: vid, wrSkey: skey }).catch(() => undefined);
    if (v === true || v === false) {
      if (verdictCache.size >= VERDICT_CACHE_MAX) verdictCache.delete(verdictCache.keys().next().value);
      verdictCache.set(key, { ok: v, at: Date.now() });
    }
    return v;
  };

  const prepareSession = async (target, reason) => {
    const call = async (method, params) => {
      const rs = await wsCall(target.webSocketDebuggerUrl, [{ method, params }]);
      const r = rs[0];
      if (r?.error) throw new Error(r.error.message);
      return r.result ?? {};
    };
    let existing = [];
    try { existing = (await call('Network.getCookies', { urls: ['https://weread.qq.com/'] })).cookies ?? []; }
    catch (e) { log('WARN', `reader-window getCookies(${reason}) 失败：${e.message}`); return { injected: false }; }
    const nowSec = Date.now() / 1000;
    const winSkey = existing.find((c) => c.name === 'wr_skey');
    const winVid = existing.find((c) => c.name === 'wr_vid')?.value;
    const mine = parseCookieHeader(getCookies());
    const mineSkey = mine.find((c) => c.name === 'wr_skey')?.value;
    const dateAlive = !!winSkey
      && (typeof winSkey.expires !== 'number' || winSkey.expires <= 0 || winSkey.expires > nowSec + 60);
    let inject = false;
    let loginExpired = false;
    if (!dateAlive) {
      // v1.7.18：注入前先服务端裁决自家凭据。死 Cookie 注进去页面仍是未登录——实测表现为
      // 书页一律「加载失败，请点击重试」（页内 /web/book/info → errCode -2012「登录超时」），
      // 把「窗口坏了」和「该重新扫码」混在一起没法排查。判死则跳过注入并上报 loginExpired。
      const mineVid = mine.find((c) => c.name === 'wr_vid')?.value;
      if (mineSkey) {
        const mineOk = await adjudicate(mineVid, mineSkey);
        if (mineOk === false) {
          loginExpired = true;
          log('WARN', 'reader-window 插件 Cookie 已在服务端过期：跳过注入（书页会显示「加载失败」）——设置页重新扫码即可恢复；API Key 同步通道不受影响');
        }
      }
      if (!loginExpired) inject = mine.length > 0; // 缺失/日期过期：补入插件凭据（v1.5.2 原行为）
    } else if (mineSkey && mineSkey !== winSkey.value) {
      // 值不同：窗内可能是扫码新会话（不得覆盖）也可能是服务端已死的旧会话（应覆盖）→ 服务端裁决
      const verdict = await adjudicate(winVid, winSkey.value);
      if (verdict === false) inject = true;
    } else if (mineSkey && mineSkey === winSkey.value) {
      // v1.9.0 B1：同源会话也裁决（带缓存）——服务端已死的同值 skey 原来直接跳过，
      // 用户开书撞「加载失败」才发现；现在提前归因 loginExpired，与 v1.7.18 同一引导话术。
      const mineVid = mine.find((c) => c.name === 'wr_vid')?.value || winVid;
      const verdict = await adjudicate(mineVid, mineSkey);
      if (verdict === false) {
        loginExpired = true;
        log('WARN', 'reader-window 插件与窗口同源 Cookie 已在服务端过期（书页会显示「加载失败」）——设置页重新扫码即可恢复；API Key 同步通道不受影响');
      }
    }
    if (inject && mine.length) {
      try {
        for (const c of mine) await call('Network.setCookie', { name: c.name, value: c.value, url: 'https://weread.qq.com/' });
        log('INFO', `reader-window cookies injected (${existing.length && dateAlive ? '窗内会话服务端已死，换血' : 'skey 失效，重注入'}): ${mine.map((c) => c.name).join(',')}`);
        return { injected: true };
      } catch (e) { log('WARN', `reader-window cookie 注入失败：${e.message}`); return { injected: false }; }
    }
    // 反向同步：窗内日期内会话与插件凭据不同（含插件无凭据）→ 上报宿主裁决采纳（宿主负责校验与账号匹配）
    if (dateAlive && winSkey?.value && mineSkey !== winSkey.value && typeof deps.onWindowSession === 'function' && winVid) {
      try { deps.onWindowSession({ wrVid: winVid, wrSkey: winSkey.value }); } catch { /* 上报失败不影响打开 */ }
    }
    log('INFO', `reader-window 窗口会话保持（wr_skey ${dateAlive ? '在期' : (loginExpired ? '已过期待重扫' : '缺失且无凭据可注')}，共 ${existing.length} 条 Cookie），跳过注入`);
    return { injected: false, ...(loginExpired ? { loginExpired: true } : {}) };
  };

  const closeTarget = deps.closeTarget ?? (async (port, targetId) => {
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`, { method: 'PUT', signal: AbortSignal.timeout(CDP_TIMEOUT_MS) }).catch(() => {});
  });

  /** 收敛到单窗口：多出的页面目标（= 多余窗口）直接关闭，保住 weread 那个 */
  const closeExtraTargets = async (port, targets) => {
    if (!targets || targets.length <= 1) return;
    const real = targets.filter((t) => !String(t.url).startsWith('chrome://'));
    if (real.length <= 1 && targets.length <= 1) return;
    const keep = real.find((t) => /weread\.qq\.com/.test(t.url)) ?? real[0];
    for (const t of targets) {
      if (t === keep) continue;
      await closeTarget(port, t.id);
      log('INFO', 'reader-window 多余窗口已收敛关闭');
    }
  };

  /** 在既有窗口内导航 + 置前（WebBar 的「复用同一 panel」等价物）+ 顺手记忆窗口位置大小 */
  const navigateExisting = async (port, target, url) => {
    const prep = await prepareSession(target, 'navigate');
    const needsNav = target.url.split('#')[0] !== url.split('#')[0]; // 同 URL 只置前不重载（保滚动位置）
    if (needsNav) {
      const rs = await wsCall(target.webSocketDebuggerUrl, [{ method: 'Page.navigate', params: { url } }])
        .catch((e) => [{ error: { message: e.message } }]);
      if (rs[0]?.error) log('WARN', `reader-window navigate 返回错误：${rs[0].error.message}`);
    } else if (prep.injected) {
      // v1.7.6：会话刚换血而 URL 未变（如悬浮 icon 回到上次页面）→ 强制重载撕掉过期假象，
      // 否则用户看到的是旧会话生前渲染的页面，误以为「已登录」。
      await wsCall(target.webSocketDebuggerUrl, [{ method: 'Page.reload' }]).catch(() => {});
      log('INFO', 'reader-window 同 URL 会话换血 → 重载页面');
    }
    await wsCall(target.webSocketDebuggerUrl, [{ method: 'Page.bringToFront' }]).catch(() => {});
    await sleep(400);
    const after = await probe(port);
    if (after.ok && after.targets.length > 1) await closeExtraTargets(port, after.targets);
    if (after.ok && after.targets.length) await captureWindowBounds(after.wsUrl, after.targets[0].id);
    if (after.ok && after.targets.length) await injectNow(after.targets[0]); // 导航后新文档立即注入
    startInjectWatch();
    startHarvestWatch(); // v1.9.0 A2：窗口在场即周期回流窗内会话
    startRendererWatchdog();
    return { mode: 'reader-window', ...(prep.loginExpired ? { loginExpired: true } : {}) };
  };

  // ---------- bounds 守护（v1.5.4）：窗口活着时每 5s 跟踪位置大小，变化才写盘 ----------
  // 背景：只在 open/close 时捕获会漏掉「阅读期间调整 + 红钮关窗」的主路径（1.5.3 实测缺陷）。
  let boundsTimer = null;
  let lastBoundsJson = '';
  // ---------- 守护生命周期（v1.7.4 性能审查） ----------
  // 此前三定时器从首次开窗一直跑到 DSH 退出：用户关窗后仍每 1.5/5/20s 空转探测死端口
  // （≈158k HTTP/天 + 79k 次同步读盘/天）。现在连续 5 轮不见窗口即自动停摆，open() 照常重启；
  // watchdog 自愈恢复期间窗口缺席是预期（恢复链可能超过 20s 周期），不计缺席、不叠新轮。
  let absentTicks = 0;
  let inRecovery = false;
  let quitting = false; // v1.8.19：关窗退出流程在飞（防多循环重复触发）
  const stopWatches = () => {
    if (boundsTimer) { clearInterval(boundsTimer); boundsTimer = null; }
    if (injectTimer) { clearInterval(injectTimer); injectTimer = null; }
    if (jamTimer) { clearInterval(jamTimer); jamTimer = null; }
    if (harvestTimer) { clearInterval(harvestTimer); harvestTimer = null; } // v1.9.0 A2：会话回流守护同停
  };
  const noteWindowAbsent = () => {
    if (inRecovery) return;
    absentTicks += 1;
    if (absentTicks < 5) return;
    stopWatches();
    // v1.8.20 设置项：关窗即退出（默认开）。关掉 = 实例常驻（重开秒回，程序坞图标滞留）。
    let wantQuit = true;
    try { wantQuit = typeof deps.quitOnClose === 'function' ? deps.quitOnClose() !== false : true; } catch { wantQuit = true; }
    if (!wantQuit) {
      log('INFO', 'reader-window 窗口已关，守护停摆（设置：实例常驻待 reopen；下次 open 自动重启守护）');
      return;
    }
    // v1.8.19 关窗即退实例：独立 profile 的 Chrome 实例在 macOS 常驻程序坞——用户关窗后图标
    // 滞留（真机反馈）。Browser.close 优雅退出，SIGTERM 进程组兜底；port 从 state 摘除。
    // 两条护栏：①退出前复核 targets 仍空（缺席计数误报/用户极速重开则放弃）；②只在 state 端口
    // 未被新 open() 改写时才清 port（防把新窗口的端口抹掉）。
    if (quitting) return;
    quitting = true;
    void (async () => {
      try {
        const quitPort = readState().port;
        if (!quitPort) return;
        const p = await probe(quitPort);
        if (!p.ok) { // 实例已自行退出（崩溃/被系统回收）
          writeState({ port: undefined });
          log('INFO', 'reader-window 窗口已关且实例已退（程序坞图标随窗消失）');
          return;
        }
        if (p.targets?.length) { // 窗口又回来了（缺席误报/极速重开）——放弃退出，恢复守护
          log('INFO', 'reader-window 窗口在场，取消退出（缺席计数误报）');
          return;
        }
        try { await wsCall(p.wsUrl, [{ method: 'Browser.close' }]); } catch { /* ignore */ }
        await sleep(600);
        const still = await probe(quitPort);
        if (still.ok) {
          const pids = await listPids();
          pids.forEach(killPid);
          log('WARN', `reader-window Browser.close 未竟，SIGTERM 兜底 pid=${pids.join(',') || '(无匹配进程)'}`);
          await sleep(400);
        }
        if (readState().port === quitPort) writeState({ port: undefined });
        log('INFO', 'reader-window 窗口已关 → 实例退出（程序坞图标随窗消失；下次 open 重新拉起）');
      } catch { /* 退出清理失败静默（进程已死是常态路径） */ } finally { quitting = false; }
    })();
  };
  const noteWindowPresent = () => { absentTicks = 0; };
  let boundsBusy = false;
  const startBoundsWatch = () => {
    if (boundsTimer) return;
    absentTicks = 0; // v1.8.19：守护重启（上次因关窗退出而停摆）——缺席计数重新起算，防首 tick 误触发退出
    boundsTimer = setInterval(() => {
      if (boundsBusy) return; // 防重入：上一轮 CDP 慢时不叠新轮
      boundsBusy = true;
      void (async () => {
        try {
          const st = readState();
          if (!st.port) return;
          const p = await sharedProbe(); // P2-22：三路轮询共享 probe 缓存
          if (!p.ok || !p.targets?.length) { noteWindowAbsent(); return; } // 窗口不在：保留最后的记忆即可
          noteWindowPresent();
          const res = await wsCall(p.wsUrl, [{ method: 'Browser.getWindowForTarget', params: { targetId: p.targets[0].id } }]);
          const b = res[0]?.result;
          if (!b?.windowId || !b?.bounds || !(b.bounds.width > 0)) return;
          const compact = {
            left: b.bounds.left, top: b.bounds.top, width: b.bounds.width, height: b.bounds.height,
            windowState: b.bounds.windowState ?? 'normal',
          };
          const j = JSON.stringify(compact);
          if (j === lastBoundsJson) return;
          lastBoundsJson = j;
          writeState({ bounds: compact });
        } catch { /* CDP 不可达即静默（窗口/实例已关） */ } finally { boundsBusy = false; }
      })();
    }, T.boundsWatch);
    boundsTimer.unref?.();
  };
  // ---------- 注入守护（v1.7.0）：/json/list 纯 HTTP 轮询发现新文档 → 短连注入一次 ----------
  // 常态零 WS、零域启用（附着检视会拖慢重页面——1.6.x 点击延迟的根因）；页面内 3s 自愈维持工具条。
  let injectTimer = null;
  let lastInjectKey = '';
  let injectBusy = false;
  const injectNow = async (target) => {
    try {
      await wsCall(target.webSocketDebuggerUrl, [{ method: 'Runtime.evaluate', params: { expression: BOOTSTRAP_SCRIPT } }]);
      lastInjectKey = target.id + '|' + target.url;
      return true;
    } catch (e) { log('WARN', `reader-window inject 失败：${e.message}`); return false; }
  };
  // v1.7.7 选中即问：排空页面「问 DSH」队列（工具条按钮写入 window.__wrAskDSH）。
  // 复用注入守护轮询：每轮一次轻量 evaluate（无域启用、短连即断），宿主经 deps.onReaderAsk
  // 推送会话后，回执再 evaluate 回写页面 toast——全程零跨域请求、零新监听端口。
  const ASK_DRAIN_EXPR = "((window.__wrAskDSH&&window.__wrAskDSH.length)?(function(){var q=window.__wrAskDSH.splice(0,10);return JSON.stringify(q);})():null)";
  const drainAskQueue = async (target) => {
    if (typeof deps.onReaderAsk !== 'function') return;
    const rs = await wsCall(target.webSocketDebuggerUrl, [{ method: 'Runtime.evaluate', params: { expression: ASK_DRAIN_EXPR, returnByValue: true } }]);
    // 真实 CDP 返回两层：{result:{result:{value}}}（RemoteObject）；部分注入实现可能扁平化——两者都接。
    // v1.7.10 真机事故：只读一层 result.value → 恒 undefined → 队列被 splice 掉却静默丢弃。
    const v = rs?.[0]?.result?.result?.value ?? rs?.[0]?.result?.value;
    if (!v) return;
    let items;
    try { items = JSON.parse(v); } catch { return; }
    const results = [];
    for (const it of (Array.isArray(items) ? items : [])) {
      try { results.push({ seq: it.seq, ...(await Promise.resolve(deps.onReaderAsk(it))) }); }
      catch (e) { results.push({ seq: it.seq, ok: false, msg: e?.message || String(e) }); }
    }
    if (results.length) {
      await wsCall(target.webSocketDebuggerUrl, [{ method: 'Runtime.evaluate', params: { expression: `window.__wrAskFeedback && window.__wrAskFeedback(${JSON.stringify(results)})` } }]).catch(() => {});
    }
  };
  const startInjectWatch = () => {
    if (injectTimer) return;
    injectTimer = setInterval(() => {
      if (injectBusy) return; // 防重入：页面卡顿时 evaluate 5s 超时 > 1.5s 周期，原会叠 3-4 个并发 WS
      injectBusy = true;
      void (async () => {
        try {
          const st = readState();
          if (!st.port) return;
          const p = await sharedProbe(); // P2-22：三路轮询共享 probe 缓存
          if (!p.ok || !p.targets?.length) { noteWindowAbsent(); return; }
          noteWindowPresent();
          const t = p.targets[0];
          await drainAskQueue(t); // 先排空问 DSH 队列（不依赖文档变化）
          if (t.id + '|' + t.url === lastInjectKey) return;
          await injectNow(t);
          log('INFO', `reader-window toolbar injected (doc changed): ${t.url.slice(0, 60)}`);
        } catch { /* 窗口不在即静默 */ } finally { injectBusy = false; }
      })();
    }, T.injectWatch);
    injectTimer.unref?.();
  };

  // ---------- 会话回流守护（v1.9.0 A2）：窗口在场时周期对比窗内 skey 与插件凭据 ----------
  // 窗内浏览是滚动续命源（Chrome 收 Set-Cookie 自动换新 skey），但原设计只在开书/导航事件点
  // 反向同步——用户页内连读数日不触发开书时，插件凭据逐渐落后甚至过期。守护周期读窗内
  // Cookie，与插件不同源即上报宿主采纳（adoptWindowSession 自带服务端裁决与账号保护）。
  // 原则：**回流随时（只读+上报，不动页面）；换血（注入+重载）只在导航事件**——不打扰阅读。
  let harvestTimer = null;
  let harvestBusy = false;
  const harvestNow = async () => {
    try {
      refreshAccountScope(); // 定时器跨越账号切换：按当前活跃账号的窗口 state 走
      const st = readState();
      if (!st.port || !portInScope(st.port)) return { ok: false };
      const p = await probe(st.port);
      if (!p.ok || !p.targets?.length) { noteWindowAbsent(); return { ok: false }; }
      noteWindowPresent();
      const t = p.targets[0];
      const rs = await wsCall(t.webSocketDebuggerUrl, [{ method: 'Network.getCookies', params: { urls: ['https://weread.qq.com/'] } }]);
      const cookies = rs?.[0]?.result?.cookies ?? [];
      const winSkey = cookies.find((c) => c.name === 'wr_skey');
      const winVid = cookies.find((c) => c.name === 'wr_vid')?.value;
      if (!winSkey?.value || !winVid) return { ok: false };
      const nowSec = Date.now() / 1000;
      const dateAlive = typeof winSkey.expires !== 'number' || winSkey.expires <= 0 || winSkey.expires > nowSec + 60;
      if (!dateAlive) return { ok: false }; // 日期已死：留给下次开窗注入换血，不回流死值
      const mineSkey = parseCookieHeader(getCookies()).find((c) => c.name === 'wr_skey')?.value;
      if (mineSkey === winSkey.value) return { ok: false }; // 同源：无事可做
      if (typeof deps.onWindowSession !== 'function') return { ok: false };
      try { deps.onWindowSession({ wrVid: winVid, wrSkey: winSkey.value }); } catch { /* ignore */ }
      log('INFO', 'reader-window 会话回流：窗内 skey 与插件不同源 → 上报宿主裁决（不动页面）');
      return { ok: true };
    } catch { return { ok: false }; /* best effort */ }
  };
  const startHarvestWatch = () => {
    if (harvestTimer) return;
    harvestTimer = setInterval(() => {
      if (harvestBusy) return; // 防重入
      harvestBusy = true;
      void harvestNow().finally(() => { harvestBusy = false; });
    }, T.harvestWatch);
    harvestTimer.unref?.();
  };

  // ---------- 渲染进程 watchdog（v1.7.3）：主线程卡死检测 + 自愈 ----------
  // 实测：微信读书页偶发渲染主线程假死（DevTools 页面级命令全部超时），窗口点击全无反应。
  // 守护每 20s 发一次极轻探针（evaluate 1），连续 2 次超时 → 判定卡死 → 关掉该页并由既有实例重开（≤40s 自愈）。
  let jamTimer = null;
  let jamStrikes = 0;
  let jamBusy = false;
  const startRendererWatchdog = () => {
    if (jamTimer) return;
    jamTimer = setInterval(() => {
      if (disposed) return; // dispose 后不再开新检测轮
      if (jamBusy || inRecovery) return; // 防重入 + 自愈进行中不叠加（恢复链含 tier 重试可超 20s 周期）
      jamBusy = true;
      void (async () => {
        try {
          const st = readState();
          if (!st.port) return;
          const p = await sharedProbe(); // P2-22：三路轮询共享 probe 缓存
          if (!p.ok || !p.targets?.length) { jamStrikes = 0; noteWindowAbsent(); return; } // 窗口不在：不是卡死
          noteWindowPresent();
          const t = p.targets[0];
          try {
            await wsCall(t.webSocketDebuggerUrl, [{ method: 'Runtime.evaluate', params: { expression: '1' } }]);
            jamStrikes = 0;
            return;
          } catch { /* 探针失败：计一击 */ }
          jamStrikes += 1;
          if (jamStrikes < 2) return;
          jamStrikes = 0;
          inRecovery = true;
          log('WARN', `reader-window 渲染主线程无响应 ×2 → 自愈重开（${t.url.slice(0, 60)}）`);
          try {
            await closeTarget(st.port, t.id);
            await sleep(1500);
            if (disposed || !jamTimer) return; // 竞态：等待期宿主退出/用户关窗（守护已停）→ 不复活窗口
            const url = st.lastUrl || 'https://weread.qq.com/';
            const chromeBin = chromeExecutable();
            if (chromeBin) {
              const r = await ensureWindow(url, chromeBin).catch(() => null);
              if (r?.ready) {
                await prepareSession(r.ready.targets[0], 'jam-recovery');
                await injectNow(r.ready.targets[0]);
                await captureWindowBounds(r.ready.wsUrl, r.ready.targets[0].id);
                writeState({ port: r.port, lastUrl: url });
                startInjectWatch();
                startBoundsWatch(); // v1.7.4：恢复也重启 bounds 守护（窗口缺席期守护可能已停摆）
                startHarvestWatch(); // v1.9.0 A2：自愈重开也重启会话回流守护
                log('INFO', `reader-window 自愈完成（重开 ${url.slice(0, 60)}）`);
              }
            }
          } finally {
            inRecovery = false;
            noteWindowPresent(); // 恢复结束重置缺席计数（成败交由后续轮判定）
          }
        } catch { /* best effort */ } finally { jamBusy = false; }
      })();
    }, T.jamWatch);
    jamTimer.unref?.();
  };

  // v1.7.0：DSH 退出/插件停用时关闭阅读窗口（用户需求「退出 DSH 时阅读窗口未关闭」）。
  // 尽力而为：Browser.close → 兜底 SIGTERM 残留进程；失败不阻塞卸载。
  const dispose = () => {
    disposed = true; // 先拒绝复活动作（在飞的 watchdog 自愈不得重拉窗口）
    stopWatches();
    killOwnedSync('dispose'); // v1.7.18：同步先杀进程组——宿主 5s 强退不等异步 CDP 往返（bounds 由守护 ≤5s 前已记）
    liveKills.delete(killOwnedSync); // 已同步收尾；'exit' 兜底留给没走到 dispose 的退出路径
    void (async () => {
      try {
        const st = readState();
        if (!st.port) return;
        const p = await probe(st.port);
        if (p.ok && p.targets?.length) await captureWindowBounds(p.wsUrl, p.targets[0].id); // 最后记一次位置
        if (p.ok && p.wsUrl) {
          await wsCall(p.wsUrl, [{ method: 'Browser.close' }]).catch(() => {});
          await sleep(600);
        }
        if ((await probe(st.port)).ok) {
          for (const pid of await listPids()) killPid(pid);
        }
        log('INFO', 'reader-window disposed with host (window closed)');
      } catch { /* best effort */ }
    })();
  };

  // ---------- 对外：open / diagnose / close ----------
  let queue = Promise.resolve();
  const serialize = (fn) => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; };

  /**
   * 拉起窗口。两条路：
   * - reopen：CDP 实例活着但窗口已关（用户关了窗、实例未退）→ 同 profile 再 spawn 一次，
   *   Chrome 单实例机制会把 app 窗口开回既有实例（端口不变）；
   * - fresh：无实例 → 选端口、清残留进程、spawn（tier 1）→ open -na（tier 2，部分 macOS 会丢参数仅作补充）。
   * 返回 {ready, port, tier} 或 {fail}。
   */
  const ensureWindow = async (url, chromeBin) => {
    if (disposed) return { fail: 'disposed' }; // P1-11：dispose 后不再拉起（原版 in-flight open 会在插件停用后把 Chrome 拉回成孤儿窗口）
    const st = readState();
    const firstLaunch = !st.bounds; // 无记忆 bounds 时才给 --window-size 默认尺寸（否则会覆盖还原的位置大小）
    // v1.8.18：只对本区端口做同端口复活；越界端口（别人的窗口/遗留共享状态）绝不接管
    if (st.port && portInScope(st.port)) {
      const p = await probe(st.port);
      if (p.ok) {
        if (p.targets.length) return { ready: p, port: st.port, tier: 0 }; // 竞态：窗口已回来（如连续两次 open）
        // reopen 转发进程是瞬时的（Chrome 单实例把窗口开回既有实例后即退出），不记 pid——
        // 实例本体 pid 在 state 里（前宿主 tier1 落盘），exit 兜底会带身份核验地用它
        await launchProcess(chromeBin, buildArgs(url, st.port, { firstLaunch }));
        const ready = await waitReady(st.port, T.ready);
        if (ready) return { ready, port: st.port, tier: 1, reopened: true };
      }
    }
    const port = await pickPort();
    if (!port) return { fail: 'no-port' };
    const stale = await listPids();
    if (stale.length) { // 端口探不到但进程还在（僵尸实例）：清掉再拉，保证拿到可控端口
      // P2-24 保守版误杀防护 + v1.8.18 收紧：sleep(400) 后对 state 端口二次探测，**有活窗口
      // （ok 且有 targets）才免死**。原判定只看 CDP 应答——真机事故形态「实例活着但窗口已关
      // （空 targets）」的垂死实例被误 spared，单例锁卡死后续 spawn，链式落败到浏览器页签。
      let stillDead = true;
      if (st.port && portInScope(st.port)) {
        await sleep(400);
        const rp = await probe(st.port);
        stillDead = !(rp.ok && rp.targets?.length);
      }
      if (stillDead) {
        log('INFO', `reader-window 清理残留实例 pid=${stale.join(',')}`);
        stale.forEach(killPid);
        await sleep(1200);
      } else {
        log('INFO', 'reader-window 残留进程二次探测可达（CDP 瞬时无响应），跳过清理避免误杀活窗口');
      }
    }
    // tier 1：直接 spawn（参数完整、可探测；在插件宿主（非沙箱）进程下运行）
    const sp = await launchProcess(chromeBin, buildArgs(url, port, { firstLaunch }));
    noteOwnedPid(sp); // v1.7.18：记浏览器主进程 pid（exit 兜底用；新建实例它就是组长）
    let ready = await waitReady(port, T.tier1);
    if (ready) return { ready, port, tier: 1 };
    if (disposed) return { fail: 'disposed' }; // P1-11：tier1 等待最长 6s，期间宿主可能已退出——不再 tier2 复活
    // tier 2：LaunchServices 拉起（`open -n --args` 在 macOS 26 实测会丢参数，仅作补充）
    const openArgs = buildArgs(url, port, { firstLaunch }).filter((x) => !x.startsWith('--app='));
    await execOpen(['-na', 'Google Chrome', '--args', `--app=${url}`, ...openArgs]);
    ready = await waitReady(port, T.tier2);
    if (ready) return { ready, port, tier: 2 };
    return { fail: 'launch' };
  };

  const open = (url) => serialize(async () => {
    if (disposed) return { ok: false, mode: 'disposed', error: '插件已停用，阅读窗口不再打开' }; // P1-11：dispose 后拒绝复活动作
    refreshAccountScope(); // v1.8.10：按当前活跃账号选 profile/state（多账号登录态隔离）
    const chromeBin = chromeExecutable();
    if (!chromeBin) {
      return { ok: false, mode: 'no-chrome', error: '未找到 Google Chrome：单例阅读窗口依赖 Chrome（安装后重试；本插件不会改用默认浏览器打开书籍）' };
    }
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* ignore */ }
    const st = readState();
    if (st.port && !portInScope(st.port)) {
      // v1.8.18 越界自愈：state 记的端口不在本账号区（真机事故：两账号共享 47833 互写对方
      // 窗口状态）——废弃该端口，绝不导航别人的窗口；僵尸清理由下方 fresh 路径接管。
      log('WARN', `reader-window state 端口 ${st.port} 不在本账号区(${scopeRange}..${scopeRange + PORT_RANGE.per - 1})，废弃重建`);
      writeState({ port: undefined });
    } else if (st.port) {
      const p = await probe(st.port);
      if (p.ok && p.targets.length) {
        // WebBar 的「复用同一 panel」：原窗口内导航 + 置前，不开新窗口
        const r = await navigateExisting(st.port, p.targets[0], url);
        writeState({ port: st.port, lastUrl: url });
        startBoundsWatch();
        log('INFO', `reader-window reuse+navigate ${url.slice(0, 60)}`);
        return { ok: true, ...r };
      }
    }
    const r = await ensureWindow(url, chromeBin);
    if (r.ready) {
      let { targets, wsUrl } = r.ready;
      await restoreWindowBounds(wsUrl, targets[0].id); // 先还原记忆的位置大小
      const prep = await prepareSession(targets[0], 'launch');
      if (prep.injected) {
        // v1.7.6：Cookie 是页面开载后才注入的——旧会话已死的窗口首屏会渲染成「登录已过期」，
        // 必须重载一次让页面用新会话引导；重载后目标可能更换，重探测再注入工具条。
        await wsCall(targets[0].webSocketDebuggerUrl, [{ method: 'Page.reload' }]).catch(() => {});
        await sleep(400);
        const p2 = await probe(r.port);
        if (p2.ok && p2.targets?.length) { targets = p2.targets; wsUrl = p2.wsUrl; }
        log('INFO', 'reader-window 首启换血会话 → 重载页面');
      }
      await injectNow(targets[0]); // 首屏工具条（后续文档由注入守护接管）
      await wsCall(targets[0].webSocketDebuggerUrl, [{ method: 'Page.bringToFront' }]).catch(() => {});
      await closeExtraTargets(r.port, targets);
      await captureWindowBounds(wsUrl, targets[0].id); // 再捕获（还原失败时也能记下默认值）
      writeState({ port: r.port, lastUrl: url, launchedAt: r.reopened ? undefined : Date.now() });
      startBoundsWatch(); // 阅读期间的调整由守护持续记忆
      startInjectWatch(); // 新文档（导航/SPA 路由）自动补注入
      startHarvestWatch(); // v1.9.0 A2：会话回流守护（窗→插件，不动页面）
      startRendererWatchdog(); // 渲染主线程卡死检测 + 自愈
      log('INFO', `reader-window ${r.reopened ? 'reopened' : 'launched'} (tier ${r.tier}) port=${r.port} ${url.slice(0, 60)}`);
      return { ok: true, mode: 'reader-window', ...(prep.loginExpired ? { loginExpired: true } : {}) };
    }
    // 唯一兜底：Chrome 同窗口页签（v1.4.9 机制）——绝不用默认浏览器
    const fb = await execOpen(['-a', 'Google Chrome', url]);
    log('WARN', `reader-window 拉起失败(${r.fail})，回落 Chrome 页签：${fb.ok ? 'ok' : fb.error}`);
    if (!fb.ok) return { ok: false, mode: 'no-chrome', error: `打开失败：${fb.error ?? 'Chrome 拉起失败'}` };
    return { ok: true, mode: 'chrome-tab', fallback: true };
  });

  const diagnose = () => serialize(async () => {
    refreshAccountScope(); // v1.8.10：诊断也按当前账号 scope（多账号各窗独立诊断）
    const chromeBin = chromeExecutable();
    const st = readState();
    const p = st.port && portInScope(st.port) ? await probe(st.port) : { ok: false };
    return {
      chromeFound: !!chromeBin,
      chromePath: chromeBin,
      port: st.port ?? null,
      portInScope: st.port ? portInScope(st.port) : null, // v1.8.18：false=state 端口不在本账号区（下次 open 会废弃重建）
      cdpAlive: !!p.ok,
      windowAlive: !!(p.ok && p.targets?.length),
      windowUrl: p.targets?.[0]?.url ?? null,
      lastUrl: st.lastUrl ?? null,
      lastLaunchedAt: st.launchedAt ?? null,
      bounds: st.bounds ?? null,
      profileDir,
    };
  });

  const closeWindow = () => serialize(async () => {
    refreshAccountScope(); // v1.8.10：关的是当前账号的窗口
    stopWatches(); // v1.7.4：用户主动关窗即停守护（不再空转探测死端口）；下次 open 自动重启
    const st = readState();
    if (!st.port || !portInScope(st.port)) return { ok: false, error: '阅读窗口未在运行' }; // v1.8.18：越界端口不是本账号窗口，绝不远程关闭
    const p = await probe(st.port);
    if (p.ok && p.targets?.length) await captureWindowBounds(p.wsUrl, p.targets[0].id); // 关窗前先记忆位置大小
    if (p.ok && p.wsUrl) {
      try { await wsCall(p.wsUrl, [{ method: 'Browser.close' }]); } catch (e) { log('WARN', `reader-window Browser.close 失败：${e.message}`); }
      await sleep(600);
    }
    const still = await probe(st.port);
    if (still.ok) {
      const pids = await listPids();
      pids.forEach(killPid);
      await sleep(800);
    }
    log('INFO', 'reader-window closed by user');
    return { ok: true };
  });

  /** v1.8.10：导出窗内当前 weread 会话（vid/skey）——登录弹层核验失败时尝试采纳（跨端状态共享）。 */
  const exportWindowSession = () => serialize(async () => {
    try {
      refreshAccountScope();
      const st = readState();
      if (!st.port || !portInScope(st.port)) return null; // v1.8.18：只导出本账号窗口的会话
      const p = await probe(st.port);
      if (!p.ok || !p.targets?.length) return null;
      const rs = await wsCall(p.targets[0].webSocketDebuggerUrl, [{ method: 'Network.getCookies', params: { urls: ['https://weread.qq.com/'] } }]);
      const cookies = rs?.[0]?.result?.cookies ?? [];
      const vid = cookies.find((c) => c.name === 'wr_vid')?.value;
      const skey = cookies.find((c) => c.name === 'wr_skey')?.value;
      return vid && skey ? { wrVid: String(vid), wrSkey: String(skey) } : null;
    } catch { return null; }
  });

  /** v1.9.0 A1：登录成功推窗——宿主登录态点亮时调用。打开中的窗口若还挂着死会话，
   *  立即走既有三态裁决换血 + 重载（复用 prepareSession），不再等用户下次开书才复活。
   *  窗口不在场/同源健康时是廉价 no-op（一次本地探测 + 缓存裁决）。 */
  const pushSession = () => serialize(async () => {
    try {
      refreshAccountScope();
      const st = readState();
      if (!st.port || !portInScope(st.port)) return { ok: false, reason: 'no-window' };
      const p = await probe(st.port);
      if (!p.ok || !p.targets?.length) return { ok: false, reason: 'no-window' };
      const t = p.targets[0];
      const prep = await prepareSession(t, 'login-push');
      if (prep.injected) {
        await wsCall(t.webSocketDebuggerUrl, [{ method: 'Page.reload' }]).catch(() => {});
        await sleep(400);
        const after = await probe(st.port);
        if (after.ok && after.targets?.length) await injectNow(after.targets[0]); // 重载后新文档立即补工具条
        log('INFO', 'reader-window 登录成功推窗：死会话换血 + 重载（免等下次开书）');
      }
      // v1.9.2 #5（对抗审查）：不再返回 loginExpired——调用方（onDidChangeLoginState）丢弃返回值，
      // 且刚登录的凭据必活，该字段实为死代码；防未来误用直接删除。
      return { ok: true, injected: !!prep.injected };
    } catch (e) {
      log('WARN', `reader-window pushSession 失败：${e?.message || e}`);
      return { ok: false, reason: 'error' };
    }
  });

  return { open, diagnose, closeWindow, dispose, exportWindowSession, pushSession, _internal: { probe, pickPort, parseCookieHeader, buildArgs, chromeExecutable, BOOTSTRAP_SCRIPT, killOwnedSync, ownedPids: () => [...ownedPids], exitKillAll, liveKillCount: () => liveKills.size, refreshAccountScope, currentScope: () => ({ profileDir, stateFile }), portRangeFor, portInScope: (p) => { refreshAccountScope(); return portInScope(p); }, scopeRange: () => { refreshAccountScope(); return scopeRange; }, harvestNow, adjudicate, verdictCacheSize: () => verdictCache.size } };
}
