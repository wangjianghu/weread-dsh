/**
 * lib/auth.js —— authManager 移植（风控三件套）
 *
 * 1. 校验缓存 10min（VERIFY_CACHE_MS），失败宽限 7 天（VERIFY_GRACE_MS）
 * 2. 主动刷新：每账号 8~16h 随机间隔
 *    ⚠ v1.9.15 更正：首页 HEAD 实测只下发 wr_gid，不轮换 wr_skey——「主动刷新」带回的是
 *      设备标识等 Cookie，**不是 skey 续命**。插件 skey 的真正换血源只有两个：重新登录、
 *      阅读窗口会话回流（adoptWindowSession）。
 * 3. 刷新失败指数退避：30min 起步 ×2^(n-1)，上限 24h，另加 0~10min jitter
 *
 * v1.1：登录三通道（扫码 / Cookie / API Key 官方网关）。
 *   - isLoggedIn = cookie ∨ apiKey（活跃账号）
 *   - apiKey-only 账号校验走 gateway.ping()；cookie 失效但 Key 有效时不误登出（Key 营救）
 *
 * createAuthManager(store, api, log, gateway)
 *   store    —— lib/store.js 的 createStore 实例
 *   api      —— lib/api.js 命名导出集合（import * as api）
 *   log      —— {info,warn,error}（可选）
 *   gateway  —— lib/gateway.js 的 createGatewayClient 实例（可选；无则 API Key 通道禁用）
 */

const VERIFY_CACHE_MS = 10 * 60 * 1000;
const VERIFY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;
const MAX_REFRESH_INTERVAL_MS = 16 * 60 * 60 * 1000;
const BASE_BACKOFF_MS = 30 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
// v1.9.0 C1：开书预热刷新的最小间隔——比主动刷新（8~16h）激进，但同值 30min 内不重复 HEAD
const OPEN_WARMUP_MIN_GAP_MS = 30 * 60 * 1000;

function normalizeAccountId(accountId) {
  return String(accountId ?? '').trim();
}

// v1.9.15：skey 续命判据（与 lib/api.js 的 cookieSkey / skeyRotated 同实现，test/refresh.test.js
// 有交叉一致性断言防漂移）。auth 零 import，故在此内聚一份，不依赖注入的 api 是否带这两个函数。
/** Cookie 串里 wr_skey 的值；缺失返回 undefined。 */
function cookieSkeyLocal(cookieString) {
  return /(?:^|;\s*)wr_skey=([^;]+)/.exec(String(cookieString || ''))?.[1] || undefined;
}
/** HEAD 续命是否真的换新了 wr_skey（任一侧缺失不算——防把「丢失」误判为「换新」）。 */
function skeyRotatedLocal(beforeCookies, afterCookies) {
  const before = cookieSkeyLocal(beforeCookies);
  const after = cookieSkeyLocal(afterCookies);
  return !!before && !!after && before !== after;
}

export function createAuthManager(store, api, log, gateway) {
  const info = (msg) => { try { log?.info?.(msg); } catch { /* noop */ } };
  const warn = (msg) => { try { log?.warn?.(msg); } catch { /* noop */ } };
  const error = (msg) => { try { log?.error?.(msg); } catch { /* noop */ } };

  const listeners = new Set();
  let loginStateRetryTimer = undefined;
  const refreshSchedulerTimers = new Map(); // AccountId -> Timeout
  // v1.8.7：多账号策略（宿主注入，读运行时配置；默认允许多账号）
  let multiAccountPolicy = () => true;
  function setMultiAccountPolicy(fn) { if (typeof fn === 'function') multiAccountPolicy = fn; }
  const refreshInFlights = new Map(); // AccountId -> Promise<void>

  // ------------------------------------------------------------ API Key（官方通道）

  function getApiKeyOf(accountId) {
    try { return store.getApiKey?.(accountId); } catch { return undefined; }
  }

  function hasApiKey(accountId) {
    return !!getApiKeyOf(normalizeAccountId(accountId) || store.getActiveAccountId());
  }

  /** 把活跃账号（或指定账号）的 Key 注入网关客户端；无 Key 则清空 */
  function injectApiKeyIntoGateway(accountId) {
    if (!gateway?.setApiKey) return undefined;
    const key = getApiKeyOf(normalizeAccountId(accountId) || store.getActiveAccountId());
    if (key) gateway.setApiKey(key);
    else gateway.clearApiKey();
    return key;
  }

  /** 网关 Key 校验（真实探活）。true/false；网络异常 null */
  async function verifyApiKey(accountId) {
    const key = injectApiKeyIntoGateway(accountId);
    if (!key) return false;
    try {
      await gateway.ping();
      return true;
    } catch (err) {
      if (err?.name === 'GatewayError' && (err.status === 0 || /网络|超时/i.test(err.message))) return null;
      return false;
    }
  }

  // ---------------------------------------------------------------- 事件

  function onDidChangeLoginState(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }

  function fireLoginState(state) {
    for (const cb of listeners) {
      try {
        cb(state);
      } catch (err) {
        warn(`onDidChangeLoginState 回调异常: ${err?.message || err}`);
      }
    }
  }

  // ------------------------------------------------------------ authMeta（scoped KV）

  function authMetaScope(accountId) {
    return normalizeAccountId(accountId) || normalizeAccountId(store.getActiveAccountId()) || 'default';
  }

  // v1.0.6 真实校验结果追踪：宽限期会让 checkLoginStatus 返回 true（保数据可用），
  // 但 UI/同步入口需要知道底层 API 已判无效 → getLastRawCheck() 暴露 { ok, at }（ok=null 表示尚未实测）
  let lastRawCheck = { ok: null, at: 0 };
  function getLastRawCheck() { return { ...lastRawCheck }; }

  /** v1.0.9 实时裸校验：绕过 10min 缓存与 7 天宽限，直接问服务端；只更新真实验效，不动凭据。
   *  v1.1：cookie 优先；无 cookie 有 API Key 走网关 ping。
   *  返回 true/false；网络异常返回 null（调用方保持现状）。 */
  async function verifyNow() {
    const accountId = store.getActiveAccountId();
    const cookies = injectCookiesIntoApi(accountId);
    if (!cookies) {
      if (hasApiKey(accountId)) {
        const viaKey = await verifyApiKey(accountId);
        lastRawCheck = { ok: viaKey === true, at: Date.now() };
        if (viaKey === true) updateAuthMeta({ lastVerifiedAt: Date.now() }, accountId);
        return viaKey;
      }
      lastRawCheck = { ok: false, at: Date.now() };
      return false;
    }
    try {
      const v = await api.checkLoginStatus();
      // v1.2 Key 营救：cookie 判无效但官方 Key 有效 → 视为登录（同步走网关数据通道兜底）
      if (!v && hasApiKey(accountId)) {
        const viaKey = await verifyApiKey(accountId);
        if (viaKey === true) {
          lastRawCheck = { ok: true, at: Date.now(), via: 'gateway' };
          updateAuthMeta({ lastVerifiedAt: Date.now() }, accountId);
          info('Cookie 已失效但官方 API Key 有效——保持登录，同步走网关数据通道');
          return true;
        }
      }
      lastRawCheck = { ok: !!v, at: Date.now() };
      if (v) updateAuthMeta({ lastVerifiedAt: Date.now() }, accountId);
      return !!v;
    } catch {
      return null;
    }
  }

  function getAuthMeta(accountId) {
    const raw = store.getState(authMetaScope(accountId), 'authMeta', {}) || {};
    return {
      lastVerifiedAt: Number(raw.lastVerifiedAt || 0),
      lastRefreshAt: Number(raw.lastRefreshAt || 0),
      refreshFailureCount: Number(raw.refreshFailureCount || 0),
      refreshBackoffUntil: Number(raw.refreshBackoffUntil || 0),
      // v1.9.0 B2：Cookie 来源指纹——{ at, source: login|head-refresh|window, skeyTail }
      cookieOrigin: (raw.cookieOrigin && typeof raw.cookieOrigin === 'object') ? raw.cookieOrigin : null,
    };
  }

  function updateAuthMeta(patch, accountId) {
    const scope = authMetaScope(accountId);
    store.setState(scope, 'authMeta', { ...getAuthMeta(scope), ...patch });
  }

  // ------------------------------------------------------------ cookie 注入

  function injectCookiesIntoApi(accountId) {
    const cookies = store.getCookies(accountId);
    if (cookies) {
      api.apiClient.setCookies(cookies);
    } else {
      api.apiClient.clearCookies();
    }
    return cookies;
  }

  // ------------------------------------------------------------ 风控刷新

  async function refreshCookiesWithRiskControl(accountId, force) {
    const targetAccountId = normalizeAccountId(accountId || store.getActiveAccountId());
    if (!targetAccountId) {
      return;
    }
    const now = Date.now();
    const inFlight = refreshInFlights.get(targetAccountId);
    if (inFlight) {
      await inFlight;
      return;
    }
    const meta = getAuthMeta(targetAccountId);
    // P2（时钟回拨）：回拨后 refreshBackoffUntil/lastRefreshAt 落在「未来」——超出合法退避上限
    // （指数退避封顶远小于 1 天）的差距判为回拨产物，忽略门控防续命/刷新永久停摆。
    const ROLLBACK_GUARD_MS = 24 * 3600_000;
    if (now < meta.refreshBackoffUntil && meta.refreshBackoffUntil - now <= ROLLBACK_GUARD_MS) {
      return;
    }
    if (!force && now - meta.lastRefreshAt < MIN_REFRESH_INTERVAL_MS && meta.lastRefreshAt <= now + ROLLBACK_GUARD_MS) {
      return;
    }

    const task = (async () => {
      try {
        const current = store.getCookies(targetAccountId);
        if (!current) {
          return;
        }
        const merged = await api.refreshCookiesFromServer(current);
        if (merged && merged !== current) {
          store.saveCookies(targetAccountId, merged);
          if (normalizeAccountId(store.getActiveAccountId()) === targetAccountId) {
            api.apiClient.setCookies(merged);
          }
          const prevAuth = store.getSimpleBrowserAuth?.(targetAccountId);
          try {
            store.saveSimpleBrowserAuth(targetAccountId, { ...(prevAuth || {}), cookies: merged, savedAt: Date.now() });
          } catch { /* 快照失败不影响续命 */ }
        }
        // v1.9.15（更正 v1.9.0 B2 的误报）：原以「整串变化」判定续命——首页 HEAD 只下发 wr_gid
        // （真机实测 2026-11-25），整串必变，于是每次都记 cookieOrigin='head-refresh' 并打
        // 「wr_skey 续命」日志，而 skey 一次都没换过。设置页因此长期显示一个从未发生的续命，
        // 掩盖了「插件 skey 自登录起就在倒计时」。现以 skey 值是否变化为准。
        // 判据内聚在 auth（本模块零 import、api 为注入依赖）：不调用 api.skeyRotated?.()——
        // 可选调用在缺该函数的注入实现下会静默退化为「永不续命」，是另一种静默失效。
        if (skeyRotatedLocal(current, merged)) {
          const renewedSkey = cookieSkeyLocal(merged);
          updateAuthMeta(
            { cookieOrigin: { at: Date.now(), source: 'head-refresh', skeyTail: String(renewedSkey).slice(-6) } },
            targetAccountId
          );
          info(`已刷新账号 ${targetAccountId} 的 Cookie（wr_skey 续命）`);
        } else {
          info(`账号 ${targetAccountId}：HEAD 已带回服务端 Cookie，但 wr_skey 未轮换（不构成续命）`);
        }
        updateAuthMeta(
          { lastRefreshAt: Date.now(), refreshFailureCount: 0, refreshBackoffUntil: 0 },
          targetAccountId
        );
      } catch (err) {
        const latest = getAuthMeta(targetAccountId);
        const nextFailure = latest.refreshFailureCount + 1;
        const backoff = Math.min(
          MAX_BACKOFF_MS,
          BASE_BACKOFF_MS * Math.pow(2, Math.max(0, nextFailure - 1))
        );
        const jitter = Math.floor(Math.random() * (10 * 60 * 1000));
        updateAuthMeta(
          { refreshFailureCount: nextFailure, refreshBackoffUntil: Date.now() + backoff + jitter },
          targetAccountId
        );
        warn(`账号 ${targetAccountId} 刷新 Cookie 失败（第 ${nextFailure} 次）: ${err?.message || err}`);
      }
    })();
    refreshInFlights.set(targetAccountId, task);

    try {
      await task;
    } finally {
      refreshInFlights.delete(targetAccountId);
    }
  }

  function scheduleProactiveRefresh(accountId, delayMs) {
    const targetAccountId = normalizeAccountId(accountId || store.getActiveAccountId());
    if (!targetAccountId) {
      return;
    }
    const current = refreshSchedulerTimers.get(targetAccountId);
    if (current) {
      clearTimeout(current);
      refreshSchedulerTimers.delete(targetAccountId);
    }
    const min = MIN_REFRESH_INTERVAL_MS;
    const max = MAX_REFRESH_INTERVAL_MS;
    const nextDelay =
      delayMs ?? Math.floor(Math.random() * (max - min + 1) + min);

    const timer = setTimeout(() => {
      void runProactiveRefreshTick(targetAccountId);
    }, nextDelay);
    if (typeof timer.unref === 'function') timer.unref();
    refreshSchedulerTimers.set(targetAccountId, timer);
  }

  function stopProactiveRefresh(accountId) {
    if (accountId) {
      const timer = refreshSchedulerTimers.get(accountId);
      if (timer) {
        clearTimeout(timer);
        refreshSchedulerTimers.delete(accountId);
      }
      return;
    }
    for (const timer of refreshSchedulerTimers.values()) {
      clearTimeout(timer);
    }
    refreshSchedulerTimers.clear();
  }

  async function runProactiveRefreshTick(accountId) {
    const hasCookies = !!store.getCookies(accountId);
    if (!hasCookies) {
      stopProactiveRefresh(accountId);
      return;
    }
    await refreshCookiesWithRiskControl(accountId, false);
    scheduleProactiveRefresh(accountId);
  }

  // ------------------------------------------------------------ v1.9.0 C1：开书预热刷新

  /** 开书（open-reader）前调用：距上次续命 >30min 才强制刷新（退避保护仍生效），
   *  保证注入阅读窗口的是最新血；失败静默（开窗不因预热失败而阻断）。 */
  async function warmupRefreshForOpen(accountId) {
    const targetAccountId = normalizeAccountId(accountId || store.getActiveAccountId());
    if (!targetAccountId) return;
    const meta = getAuthMeta(targetAccountId);
    if (Date.now() - meta.lastRefreshAt < OPEN_WARMUP_MIN_GAP_MS) return; // 刚续过：不重复 HEAD
    try {
      await refreshCookiesWithRiskControl(targetAccountId, true);
    } catch { /* 预热失败不阻断开窗 */ }
  }

  // ------------------------------------------------------------ v1.9.0 B2：Cookie 来源可见性

  /** 当前（或指定）账号的 Cookie 来源指纹——loginChannelsView → 设置页「上次续命」展示用。 */
  function getCookieOrigin(accountId) {
    const origin = getAuthMeta(accountId).cookieOrigin;
    return origin ? { ...origin } : null;
  }

  // ------------------------------------------------------------ 登录态校验

  function isWithinGracePeriod(now) {
    const meta = getAuthMeta();
    return now - meta.lastVerifiedAt <= VERIFY_GRACE_MS;
  }

  async function clearCredentialsForActiveAccount() {
    // 有意不清 cookies（单测审查确认）：宽限过期只降级登录态判定，保留 cookie 供静默重登/续期，
    // 完全退出走 logout/logoutAccount。isLoggedIn 由 userInfo/simpleBrowserAuth 驱动，不受影响。
    store.clearUserInfo();
    store.clearSimpleBrowserAuth();
  }

  async function checkLoginStatus(options) {
    const strict = options?.strict === true;
    const accountId = store.getActiveAccountId();
    const cookies = injectCookiesIntoApi(accountId);
    const apiKey = hasApiKey(accountId);
    if (!cookies && !apiKey) {
      store.clearUserInfo();
      store.clearSimpleBrowserAuth();
      stopProactiveRefresh(accountId);
      return false;
    }

    // v1.1：API-Key-only 账号——校验走网关（同享 10min 缓存 / 7 天宽限语义）
    if (!cookies && apiKey) {
      const now = Date.now();
      const meta = getAuthMeta(accountId);
      if (!strict && now - meta.lastVerifiedAt < VERIFY_CACHE_MS) return true;
      const viaKey = await verifyApiKey(accountId);
      lastRawCheck = { ok: viaKey === true, at: now };
      if (viaKey === true) {
        updateAuthMeta({ lastVerifiedAt: now }, accountId);
        return true;
      }
      if (viaKey === null) {
        return isWithinGracePeriod(now); // 网络异常：宽限保数据
      }
      if (strict) {
        await clearCredentialsForActiveAccount();
        return false;
      }
      const withinGrace = isWithinGracePeriod(now);
      if (!withinGrace) await clearCredentialsForActiveAccount();
      return withinGrace;
    }

    const now = Date.now();
    const meta = getAuthMeta(accountId);
    if (!strict && now - meta.lastVerifiedAt < VERIFY_CACHE_MS) {
      scheduleProactiveRefresh(accountId);
      return true;
    }

    try {
      if (!strict) {
        await refreshCookiesWithRiskControl(accountId, false);
        injectCookiesIntoApi(accountId);
      }
      const rawCheck = async () => {
        const v = await api.checkLoginStatus();
        lastRawCheck = { ok: !!v, at: Date.now() };
        return !!v;
      };
      let isValid = await rawCheck();
      if (!isValid && strict) {
        await refreshCookiesWithRiskControl(accountId, true);
        injectCookiesIntoApi(accountId);
        isValid = await rawCheck();
      }
      if (isValid) {
        updateAuthMeta({ lastVerifiedAt: now }, accountId);
        scheduleProactiveRefresh(accountId);
        return true;
      }
      // v1.1 Key 营救：cookie 判无效但官方 Key 仍有效 → 不登出（同步可走网关通道）
      if (apiKey) {
        const viaKey = await verifyApiKey(accountId);
        if (viaKey === true) {
          lastRawCheck = { ok: true, at: Date.now() };
          updateAuthMeta({ lastVerifiedAt: Date.now() }, accountId);
          warn(`账号 ${accountId} 的 Cookie 已失效，但官方 API Key 仍有效——保持登录（网关通道）`);
          return true;
        }
      }
      if (strict) {
        // 严格模式用于同步入口，必须实时校验，不依赖宽限
        await clearCredentialsForActiveAccount();
        return false;
      }
      const withinGrace = isWithinGracePeriod(now);
      if (!withinGrace) {
        await clearCredentialsForActiveAccount();
      }
      return withinGrace;
    } catch (err) {
      error(`checkLoginStatus 异常: ${err?.message || err}`);
      if (strict) {
        return false;
      }
      const withinGrace = isWithinGracePeriod(now);
      if (!withinGrace) {
        await clearCredentialsForActiveAccount();
      }
      return withinGrace;
    }
  }

  function isLoggedIn() {
    return !!(store.getCookies() || getApiKeyOf(store.getActiveAccountId()));
  }

  // ------------------------------------------------------------ 登录后广播

  // v1.1 修复（smoke 发现）：登录成功广播后账号被登出 / 校验持续异常时，
  // 旧逻辑以 2.5s 无限重试（每次还写 state 文件），进程永不退出、CPU 空转。
  // 对策：①凭据已清空 → 不可能登录成功，直接广播 false 停止；②重试上限 5 次。
  const LOGIN_STATE_MAX_RETRIES = 5;
  let loginStateRetryCount = 0;

  function clearLoginStateRetry() {
    if (loginStateRetryTimer) {
      clearTimeout(loginStateRetryTimer);
      loginStateRetryTimer = undefined;
    }
  }

  function scheduleLoginStateRetry(expectedState) {
    if (loginStateRetryCount >= LOGIN_STATE_MAX_RETRIES) {
      warn(`登录态复核连续 ${LOGIN_STATE_MAX_RETRIES} 次未确认，停止重试（下次登录/切号时重置）`);
      return;
    }
    loginStateRetryCount += 1;
    loginStateRetryTimer = setTimeout(() => {
      void revalidateAndBroadcastLoginState(expectedState);
    }, 2500);
  }

  function emitLoginStateWithRetry(expectedState) {
    clearLoginStateRetry();
    loginStateRetryCount = 0;
    fireLoginState(expectedState);
    if (!expectedState) {
      return;
    }
    loginStateRetryTimer = setTimeout(() => {
      void revalidateAndBroadcastLoginState(expectedState);
    }, 1200);
  }

  async function revalidateAndBroadcastLoginState(expectedState) {
    loginStateRetryTimer = undefined;
    // 凭据已全部清空：不可能登录成功，立即纠偏为 false 并停止复核
    if (!store.getCookies() && !getApiKeyOf(store.getActiveAccountId())) {
      fireLoginState(false);
      return;
    }
    try {
      const currentState = await checkLoginStatus();
      fireLoginState(currentState);
      if (expectedState && !currentState) {
        scheduleLoginStateRetry(expectedState);
      }
    } catch {
      fireLoginState(expectedState);
      scheduleLoginStateRetry(expectedState);
    }
  }

  // ------------------------------------------------------------ 用户资料

  async function getUserProfileByToken(vid, skey) {
    const data = (await api.fetchUserInfo(vid, skey)) || {};
    const user = data.user || data.data || data;
    return {
      userId: String(user.userId || user.userVid || vid),
      name: String(user.name || user.nick || user.nickname || '微信读书用户'),
      avatar: String(user.avatar || user.avatarUrl || ''),
    };
  }

  async function getUserProfileByCookies(cookies) {
    api.apiClient.setCookies(cookies);
    const data = (await api.getUserProfile()) || {};
    const user = data.user || data.data || data;
    return {
      userId: String(user.userId || user.userVid || ''),
      name: String(user.name || user.nick || user.nickname || '微信读书用户'),
      avatar: String(user.avatar || user.avatarUrl || ''),
    };
  }

  // ------------------------------------------------------------ 登录成功序列

  async function handleLoginSuccess(payload) {
    const cookies = String(payload?.cookies ?? '').trim();
    if (!cookies) {
      throw new Error('handleLoginSuccess 缺少 cookies');
    }
    const vid = String(payload?.vid ?? '').trim() || undefined;
    const skey = String(payload?.skey ?? '').trim() || undefined;

    let userProfile;
    if (vid && skey) {
      try {
        userProfile = await getUserProfileByToken(vid, skey);
      } catch {
        // 降级到旧接口，兼容部分网络环境
        userProfile = await getUserProfileByCookies(cookies);
      }
    } else {
      userProfile = await getUserProfileByCookies(cookies);
    }

    const accountId = String(userProfile.userId || vid || '').trim();
    if (!accountId) {
      throw new Error('登录成功但未识别账号 ID');
    }

    // v1.8.7：multiAccountEnabled 真行为（原为假开关——配置存了但零消费）。
    // 单账号模式下登录新账号：移除其余账号及其凭据（含 Cookie 续命定时器），保持单账号语义。
    if (multiAccountPolicy() === false) {
      for (const a of store.listAccounts()) {
        if (a.accountId !== accountId) {
          try {
            store.clearCookies(a.accountId);
            store.clearSimpleBrowserAuth(a.accountId);
            store.clearApiKey(a.accountId);
            stopProactiveRefresh(a.accountId);
            store.removeAccount(a.accountId);
          } catch { /* 尽力清理 */ }
        }
      }
    }

    // 写入全序列（对齐原 handleLoginSuccess）
    store.setActiveAccountId(accountId);
    store.saveCookies(accountId, cookies);
    api.apiClient.setCookies(cookies);
    store.saveSimpleBrowserAuth(accountId, {
      cookies,
      token: payload?.token || skey,
      refreshToken: payload?.refreshToken,
      session: payload?.session || vid,
      expiresAt: payload?.expiresAt,
      savedAt: Date.now(),
    });
    store.addAccount({
      accountId,
      userId: userProfile.userId || accountId,
      wrVid: vid,
      displayName: userProfile.name || '微信读书用户',
      avatar: userProfile.avatar,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    store.setActiveAccountId(accountId);
    store.saveUserInfo({
      userId: userProfile.userId,
      name: userProfile.name,
      avatar: userProfile.avatar,
    });
    if (vid && skey) {
      store.saveLastCookieLoginFields({ wrVid: vid, wrSkey: skey });
    }

    // 重置风控状态 + 排主动刷新 + 复核广播
    lastRawCheck = { ok: true, at: Date.now() };
    updateAuthMeta({
      lastVerifiedAt: Date.now(), refreshFailureCount: 0, refreshBackoffUntil: 0,
      // v1.9.0 B2：登录/窗内采纳均记录来源（payload.source 由调用方标注：login|window）
      cookieOrigin: { at: Date.now(), source: payload?.source === 'window' ? 'window' : 'login', skeyTail: String(skey || '').slice(-6) },
    }, accountId);
    scheduleProactiveRefresh(accountId);
    emitLoginStateWithRetry(true);

    info(`登录成功：${userProfile.name}（账号 ${accountId}）`);
    return { accountId, name: userProfile.name };
  }

  function normalizeCookieValue(input, key) {
    let value = String(input ?? '').trim();
    value = value.replace(new RegExp(`^${key}\\s*=\\s*`, 'i'), '');
    value = value.replace(/[;,\s]+$/, '');
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }

  async function loginByCookie({ wrVid, wrSkey }) {
    const vid = normalizeCookieValue(wrVid, 'wr_vid');
    const skey = normalizeCookieValue(wrSkey, 'wr_skey');
    if (!vid || !skey) {
      throw new Error('请填写 wr_vid 与 wr_skey');
    }
    // P2（cookie 头注入）：vid/skey 白名单 [\w-]——`;`/CR/LF 可拆出伪 cookie 键或污染头
    if (!/^[\w-]{1,256}$/.test(vid) || !/^[\w-]{1,256}$/.test(skey)) {
      throw new Error('wr_vid / wr_skey 含非法字符（只允许字母、数字、下划线、连字符）');
    }
    // 不做 encodeURIComponent，避免已编码值被二次编码导致服务端判定无效
    const cookies = `wr_vid=${vid}; wr_skey=${skey}`;
    return handleLoginSuccess({
      cookies,
      vid,
      skey,
      token: skey,
      session: vid,
    });
  }

  // ------------------------------------------------------------ API Key 登录（v1.1 官方通道）

  /** 官方网关解析账号身份：/user/profile 属 undocumented（profile.md 仅组合文档）——
   *  可用则取 userVid/name（resolved=true）；不可用回退 notebooks 签名哈希（确定性伪 ID，resolved=false）。 */
  async function resolveGatewayIdentity() {
    try {
      const data = await gateway.call('/user/profile', {});
      const user = data?.user || data?.data || data;
      const vid = String(user?.userVid || user?.vid || user?.userId || '').trim();
      if (vid) {
        return {
          accountId: vid,
          name: String(user?.name || user?.nick || user?.nickname || '').trim() || undefined,
          resolved: true,
        };
      }
    } catch { /* 未开放则走签名兜底 */ }
    const notebooks = await gateway.notebooksAll({ pageSize: 50 });
    const bookIds = notebooks.books.map((b) => String(b?.bookId || b?.book?.bookId || '')).filter(Boolean);
    const { gatewayAccountSignature } = await import('./gateway.js');
    return {
      accountId: gatewayAccountSignature({
        totalBookCount: notebooks.totalBookCount || bookIds.length,
        totalNoteCount: notebooks.totalNoteCount,
        bookIds,
      }),
      name: undefined,
      resolved: false,
    };
  }

  /**
   * API Key 登录（v1.1）：
   * - 已有活跃账号（cookie 登录态）→ 绑定到当前账号（推荐路径，笔记目录/多账号模型不变）；
   *   若官方身份已解析（vid）且指向其他账号，则归位到该账号（防不同人数据串号）
   * - 未登录 → 独立账号（vid 可用取 vid，否则签名哈希伪 ID）
   */
  async function loginByApiKey({ apiKey }) {
    if (!gateway?.setApiKey) {
      throw new Error('官方网关客户端不可用');
    }
    const { normalizeApiKey } = await import('./gateway.js');
    const key = normalizeApiKey(apiKey);
    if (!key) throw new Error('请填写 API Key（官网 weread.qq.com/r/weread-skills 登录后复制）');
    if (!/^wrk-/i.test(key)) {
      warn('API Key 不以 wrk- 开头，仍尝试校验（官方格式可能已变化）');
    }
    gateway.setApiKey(key);
    let identity;
    try {
      await gateway.ping();
      identity = await resolveGatewayIdentity();
    } catch (err) {
      gateway.clearApiKey();
      throw new Error(`API Key 校验失败：${err?.message || err}`);
    }

    const activeId = normalizeAccountId(store.getActiveAccountId());
    const activeCookies = activeId ? store.getCookies(activeId) : undefined;
    let accountId;
    let displayName = identity.name;
    if (identity.resolved) {
      accountId = identity.accountId; // 官方身份明确：归位（已知账号挂 Key / 未知视为新账号）
    } else if (activeId && activeCookies) {
      accountId = activeId; // 身份不可解析：绑定当前账号（推荐路径，UI 已注明语义）
      info(`官方 API Key 已绑定到当前账号 ${activeId}`);
    } else {
      accountId = identity.accountId; // 签名伪 ID 独立账号
      displayName = displayName || 'API Key 账号';
    }
    if (!accountId) throw new Error('未能从官方网关解析账号身份');

    store.saveApiKey(accountId, key);
    const existing = store.listAccounts().find((a) => a.accountId === accountId);
    store.addAccount({
      accountId,
      userId: existing?.userId ?? undefined,
      displayName: displayName || existing?.displayName || '微信读书用户',
      avatar: existing?.avatar ?? undefined,
      createdAt: existing?.createdAt ?? Date.now(),
      lastUsedAt: Date.now(),
    });
    store.setActiveAccountId(accountId);
    gateway.setApiKey(key);
    if (!store.getUserInfo()) {
      store.saveUserInfo({ userId: accountId, name: displayName || '微信读书用户', avatar: existing?.avatar || '' });
    }

    lastRawCheck = { ok: true, at: Date.now() };
    updateAuthMeta({ lastVerifiedAt: Date.now(), refreshFailureCount: 0, refreshBackoffUntil: 0 }, accountId);
    emitLoginStateWithRetry(true);
    info(`API Key 登录成功：账号 ${accountId}`);
    return {
      accountId,
      name: displayName || existing?.displayName || '微信读书用户',
      attached: !identity.resolved && accountId === activeId && !!activeCookies,
    };
  }

  // ------------------------------------------------------------ 多账号操作

  async function switchAccount(accountId) {
    const id = normalizeAccountId(accountId);
    if (!id) {
      throw new Error('无效账号：accountId 不能为空');
    }
    // P0-2（开源前对抗审查 v3）：只允许切到已登记账号——HTTP 路由的 body.accountId 原样
    // 透传会经 setActiveAccountId / 各处文件名拼接造成路径穿越写盘。
    const known = (store.listAccounts() || []).some((a) => a && a.accountId === id);
    if (!known) throw new Error('无效账号：未登记的 accountId');
    store.setActiveAccountId(id);
    injectCookiesIntoApi(id);
    injectApiKeyIntoGateway(id); // v1.1：切号同步切换网关 Key
    fireLoginState(await checkLoginStatus());
  }

  async function logoutAccount(accountId) {
    const id = normalizeAccountId(accountId);
    if (!id) {
      return;
    }
    store.clearCookies(id);
    store.clearSimpleBrowserAuth(id);
    store.clearApiKey(id); // v1.1：登出即解绑官方 Key
    updateAuthMeta(
      // v1.9.2 F1：cookieOrigin 一并清——登出后凭据已无，「上次续命」指纹不应残留（设置页误显示旧状态）
      { lastVerifiedAt: 0, lastRefreshAt: 0, refreshFailureCount: 0, refreshBackoffUntil: 0, cookieOrigin: null },
      id
    );
    stopProactiveRefresh(id);
    if (normalizeAccountId(store.getActiveAccountId()) === id) {
      store.clearUserInfo();
      api.apiClient.clearCookies();
      gateway?.clearApiKey?.();
      fireLoginState(false);
    }
  }

  async function logout() {
    clearLoginStateRetry();
    const activeAccountId = store.getActiveAccountId();
    if (activeAccountId) {
      await logoutAccount(activeAccountId);
    } else {
      store.clearCookies();
      store.clearSimpleBrowserAuth();
      store.clearApiKey();
      store.clearUserInfo();
      api.apiClient.clearCookies();
      gateway?.clearApiKey?.();
    }
    fireLoginState(false);
    info('已退出登录');
  }

  async function removeAccount(accountId) {
    const id = normalizeAccountId(accountId);
    if (!id) {
      return;
    }
    const wasActive = normalizeAccountId(store.getActiveAccountId()) === id;
    store.clearCookies(id);
    store.clearSimpleBrowserAuth(id);
    store.clearApiKey(id);
    updateAuthMeta(
      { lastVerifiedAt: 0, lastRefreshAt: 0, refreshFailureCount: 0, refreshBackoffUntil: 0, cookieOrigin: null }, // v1.9.2 F1：同登出，指纹不残留
      id
    );
    store.removeAccount(id);
    stopProactiveRefresh(id);
    if (wasActive) {
      const next = store.listAccounts()[0]?.accountId;
      if (next) {
        await switchAccount(next);
      } else {
        store.clearActiveAccountId();
        store.clearUserInfo();
        api.apiClient.clearCookies();
        gateway?.clearApiKey?.();
        fireLoginState(false);
      }
    }
  }

  function getCurrentUser() {
    return store.getUserInfo();
  }

  function dispose() {
    clearLoginStateRetry();
    stopProactiveRefresh();
    listeners.clear();
  }

  return {
    isLoggedIn,
    setMultiAccountPolicy, // v1.8.7：宿主注入多账号策略（false=登录新账号即替换旧账号）
    checkLoginStatus,
    getLastRawCheck,
    verifyNow,
    handleLoginSuccess,
    loginByCookie,
    loginByApiKey,
    hasApiKey,
    injectApiKeyIntoGateway,
    verifyApiKey,
    logout,
    logoutAccount,
    switchAccount,
    removeAccount,
    refreshCookiesWithRiskControl,
    warmupRefreshForOpen, // v1.9.0 C1：开书预热（最新血注入窗口）
    getCookieOrigin, // v1.9.0 B2：Cookie 来源指纹（设置页展示）
    onDidChangeLoginState,
    getCurrentUser,
    dispose,
  };
}
