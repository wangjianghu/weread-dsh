/**
 * lib/store.js —— 状态与凭据文件存储（~/.dsh/weread/）
 *
 * 文件布局：
 *   secrets.json            敏感凭据（写后 chmod 600；保留 weread.vscode.* key 约定便于迁移）
 *   meta.json               账号表 / 活跃账号 / userInfo
 *   state.<accountId>.json  每账号 scoped KV（syncState / dailyAgg / roaming.meta / index.snapshot / index.scanState / authMeta）
 *
 * 零依赖，同步读写 + 简单写锁串行化（tmp + rename 原子替换）。
 */

import fs from 'node:fs';
import path from 'node:path';

const APP_PREFIX = 'weread.vscode';
const SECRETS_FILE = 'secrets.json';
const META_FILE = 'meta.json';
const DEFAULT_SCOPE = 'default';

function normalizeAccountId(accountId) {
  return String(accountId ?? '').trim();
}

function normalizeAccountProfile(profile) {
  const raw = profile && typeof profile === 'object' ? profile : {};
  const accountId = normalizeAccountId(raw.accountId);
  if (!accountId) return undefined;
  return {
    accountId,
    userId: raw.userId ? String(raw.userId) : undefined,
    wrVid: raw.wrVid ? String(raw.wrVid) : undefined,
    displayName: String(raw.displayName || '').trim() || '微信读书用户',
    avatar: raw.avatar ? String(raw.avatar) : undefined,
    createdAt: Number(raw.createdAt || Date.now()),
    lastUsedAt: Number(raw.lastUsedAt || Date.now()),
  };
}

export function createStore(stateDir) {
  const dir = path.resolve(String(stateDir || ''));

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 解析缓存：按 {mtimeMs,size} 签名命中，避免 5s 轮询等热路径反复全量读+parse 大 JSON
  const parseCache = new Map(); // absPath -> {sig, value}
  function statSig(absPath) {
    try { const st = fs.statSync(absPath); return `${st.mtimeMs}:${st.size}`; } catch { return null; }
  }
  function readJsonFile(fileName, fallback) {
    try {
      const absPath = path.join(dir, fileName);
      const sig = statSig(absPath);
      if (sig) {
        const hit = parseCache.get(absPath);
        if (hit && hit.sig === sig) return hit.value;
      }
      const raw = fs.readFileSync(absPath, 'utf-8');
      if (!raw.trim()) return fallback;
      const parsed = JSON.parse(raw);
      const value = parsed && typeof parsed === 'object' ? parsed : fallback;
      if (sig && value === parsed) parseCache.set(absPath, { sig, value });
      if (parseCache.size > 32) parseCache.delete(parseCache.keys().next().value);
      return value;
    } catch {
      return fallback;
    }
  }

  // 简单写锁：同步写入（writeFileSync）在单线程事件循环中天然串行，
  // 且每次写入走 tmp + rename 原子替换，读方不会见到半截文件。
  function writeJsonFile(fileName, data) {
    ensureDir();
    const target = path.join(dir, fileName);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // P2（主线程阻塞）：大对象（snapshot MB 级 pretty JSON 单次 ~50-100ms）放弃 pretty，
    // 仍保证合法 JSON；小文件保留 pretty 便于用户直接查看状态文件。
    const compact = JSON.stringify(data);
    const text = `${compact.length < 100_000 ? JSON.stringify(data, null, 2) : compact}\n`;
    fs.writeFileSync(tmp, text, 'utf-8');
    if (fileName === SECRETS_FILE) {
      try {
        fs.chmodSync(tmp, 0o600);
      } catch {
        /* chmod 失败不阻断（非 POSIX 环境） */
      }
    }
    fs.renameSync(tmp, target);
    parseCache.delete(target); // 写后失效，下次读以新签名重建缓存
  }

  function deleteFile(fileName) {
    try {
      parseCache.delete(path.join(dir, fileName));
      fs.unlinkSync(path.join(dir, fileName));
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ secrets

  function readSecrets() {
    return readJsonFile(SECRETS_FILE, {});
  }

  function secretsKey(name, accountId) {
    const normalized = normalizeAccountId(accountId);
    return normalized ? `${APP_PREFIX}.${normalized}.${name}` : `${APP_PREFIX}.${name}`;
  }

  // 省略 accountId 时：有活跃账号 → 按账号 key；无 → legacy key（对齐原 cookieManager 语义）
  function resolveScope(accountId) {
    return normalizeAccountId(accountId) || readMeta().activeAccountId || '';
  }

  function getCookies(accountId) {
    const secrets = readSecrets();
    const value = secrets[secretsKey('cookies', resolveScope(accountId))];
    const cookies = String(value ?? '').trim();
    return cookies || undefined;
  }

  function saveCookies(accountId, cookies) {
    const value = String(cookies ?? '');
    const secrets = readSecrets();
    const key = secretsKey('cookies', resolveScope(accountId));
    if (value.trim()) {
      secrets[key] = value;
    } else {
      delete secrets[key];
    }
    writeJsonFile(SECRETS_FILE, secrets);
  }

  function clearCookies(accountId) {
    const secrets = readSecrets();
    delete secrets[secretsKey('cookies', resolveScope(accountId))];
    // v1.9.17：会话快照在此同清。clearCookies 只在**真正登出/删号/移除账号**时调用（auth 的
    // logout / logoutAccount / removeAccount / 单账号模式清其他账号）；「凭据判死后的降级」有意
    // 不清 cookies（见 auth.clearCredentialsForActiveAccount 的注释），因而也不会清快照——
    // 那正是快照唯一要用的时刻。语义对齐：登出不干净 = 失效恢复会把已登出账号的旧会话救回来。
    delete secrets[secretsKey('sessionSnapshot', resolveScope(accountId))];
    writeJsonFile(SECRETS_FILE, secrets);
  }

  function parseSimpleBrowserAuthPayload(raw) {
    const source = typeof raw === 'string' ? safeJsonParse(raw) : raw;
    if (!source || typeof source !== 'object') return undefined;
    const cookies = String(source.cookies ?? '').trim();
    if (!cookies) return undefined;
    return {
      cookies,
      session: source.session ? String(source.session).trim() : undefined,
      token: source.token ? String(source.token).trim() : undefined,
      refreshToken: source.refreshToken ? String(source.refreshToken).trim() : undefined,
      expiresAt: Number(source.expiresAt || 0) || undefined,
      savedAt: Number(source.savedAt || Date.now()),
    };
  }

  function safeJsonParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function getSimpleBrowserAuth(accountId) {
    const secrets = readSecrets();
    const raw = secrets[secretsKey('simpleBrowserAuth', resolveScope(accountId))];
    return raw === undefined ? undefined : parseSimpleBrowserAuthPayload(raw);
  }

  function saveSimpleBrowserAuth(accountId, payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const normalized = parseSimpleBrowserAuthPayload({
      cookies: source.cookies,
      session: source.session,
      token: source.token,
      refreshToken: source.refreshToken,
      expiresAt: source.expiresAt,
      savedAt: source.savedAt || Date.now(),
    });
    if (!normalized) return;
    const secrets = readSecrets();
    secrets[secretsKey('simpleBrowserAuth', resolveScope(accountId))] = normalized;
    writeJsonFile(SECRETS_FILE, secrets);
  }

  function clearSimpleBrowserAuth(accountId) {
    const secrets = readSecrets();
    delete secrets[secretsKey('simpleBrowserAuth', resolveScope(accountId))];
    writeJsonFile(SECRETS_FILE, secrets);
    // 注意：**不要**在这里清会话快照。本函数在「凭据判死后的降级」路径也会被调用
    // （auth.clearCredentialsForActiveAccount），而那恰是快照唯一要用的时刻——首版挂在这里，
    // 导致凭据一失效快照即被清，功能从设计上不可能工作。快照的清理挂在 clearCookies 上。
  }

  // ---------- v1.9.17 会话快照：阅读窗口「最近一次见到的有效会话」 ----------
  // 用途：插件凭据失效而阅读窗口没开时，用快照恢复登录态（免重扫码）。快照随窗口在场时的
  // 会话回流滚动更新，不依赖关窗时机（崩溃/强退也不丢）。
  // 存放：secrets.json（唯一做 0600 的文件，且被 Keychain 镜像覆盖）——快照含 skey，
  // 另起文件会以默认权限落盘，保护弱于现有凭据。按账号隔离，键名规则与 cookies 一致。
  function getSessionSnapshot(accountId) {
    const raw = readSecrets()[secretsKey('sessionSnapshot', resolveScope(accountId))];
    if (!raw || typeof raw !== 'object') return undefined;
    const wrVid = String(raw.wrVid ?? '').trim();
    const wrSkey = String(raw.wrSkey ?? '').trim();
    if (!wrVid || !wrSkey) return undefined; // 残缺快照不是会话（与「空壳不是凭据」同一原则）
    return { wrVid, wrSkey, savedAt: Number(raw.savedAt || 0) };
  }

  function saveSessionSnapshot(accountId, snapshot) {
    const wrVid = String(snapshot?.wrVid ?? '').trim();
    const wrSkey = String(snapshot?.wrSkey ?? '').trim();
    if (!wrVid || !wrSkey) return; // 不存空壳
    const secrets = readSecrets();
    secrets[secretsKey('sessionSnapshot', resolveScope(accountId))] = { wrVid, wrSkey, savedAt: Date.now() };
    writeJsonFile(SECRETS_FILE, secrets);
  }

  function getLastCookieLoginFields() {
    const secrets = readSecrets();
    const raw = secrets[`${APP_PREFIX}.lastCookieLoginFields`];
    const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
    const wrVid = String(parsed?.wrVid ?? '').trim();
    const wrSkey = String(parsed?.wrSkey ?? '').trim();
    if (!wrVid || !wrSkey) return undefined;
    return { wrVid, wrSkey };
  }

  function saveLastCookieLoginFields(fields) {
    const wrVid = String(fields?.wrVid ?? '').trim();
    const wrSkey = String(fields?.wrSkey ?? '').trim();
    if (!wrVid || !wrSkey) return;
    const secrets = readSecrets();
    secrets[`${APP_PREFIX}.lastCookieLoginFields`] = { wrVid, wrSkey };
    writeJsonFile(SECRETS_FILE, secrets);
  }

  // ------------------------------------------------------------------ API Key（v1.1 官方通道）

  function getApiKey(accountId) {
    const secrets = readSecrets();
    const value = String(secrets[secretsKey('apiKey', resolveScope(accountId))] ?? '').trim();
    return value || undefined;
  }

  function saveApiKey(accountId, apiKey) {
    const value = String(apiKey ?? '').trim();
    const secrets = readSecrets();
    const key = secretsKey('apiKey', resolveScope(accountId));
    if (value) secrets[key] = value;
    else delete secrets[key];
    writeJsonFile(SECRETS_FILE, secrets);
  }

  function clearApiKey(accountId) {
    const secrets = readSecrets();
    delete secrets[secretsKey('apiKey', resolveScope(accountId))];
    writeJsonFile(SECRETS_FILE, secrets);
  }

  // -------------------------------------------------------------------- meta

  function readMeta() {
    const raw = readJsonFile(META_FILE, {});
    const meta = raw && typeof raw === 'object' ? raw : {};
    const accounts = Array.isArray(meta.accounts) ? meta.accounts : [];
    const normalizedAccounts = accounts
      .map((item) => normalizeAccountProfile(item))
      .filter(Boolean)
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
    return {
      version: 1,
      accounts: normalizedAccounts,
      activeAccountId: normalizeAccountId(meta.activeAccountId) || undefined,
      userInfo: meta.userInfo && typeof meta.userInfo === 'object' ? meta.userInfo : undefined,
    };
  }

  function writeMeta(meta) {
    return writeJsonFile(META_FILE, meta);
  }

  function listAccounts() {
    return readMeta().accounts;
  }

  function addAccount(profile) {
    const normalized = normalizeAccountProfile(profile);
    if (!normalized) return undefined;
    const meta = readMeta();
    const existing = meta.accounts.find((item) => item.accountId === normalized.accountId);
    let saved;
    if (existing) {
      saved = {
        ...existing,
        userId: normalized.userId ?? existing.userId,
        wrVid: normalized.wrVid ?? existing.wrVid,
        displayName: normalized.displayName || existing.displayName,
        avatar: normalized.avatar ?? existing.avatar,
        createdAt: existing.createdAt || normalized.createdAt,
        lastUsedAt: Date.now(),
      };
      meta.accounts = meta.accounts.map((item) => (item.accountId === saved.accountId ? saved : item));
    } else {
      saved = normalized;
      meta.accounts.push(saved);
    }
    writeMeta(meta);
    return saved;
  }

  function updateAccount(accountId, patch) {
    const id = normalizeAccountId(accountId);
    if (!id) return undefined;
    const meta = readMeta();
    const existing = meta.accounts.find((item) => item.accountId === id);
    if (!existing) return undefined;
    const merged = normalizeAccountProfile({
      ...existing,
      ...(patch && typeof patch === 'object' ? patch : {}),
      accountId: id,
      createdAt: existing.createdAt,
    });
    meta.accounts = meta.accounts.map((item) => (item.accountId === id ? merged : item));
    writeMeta(meta);
    return merged;
  }

  function removeAccount(accountId) {
    const id = normalizeAccountId(accountId);
    if (!id) return;
    const meta = readMeta();
    meta.accounts = meta.accounts.filter((item) => item.accountId !== id);
    if (meta.activeAccountId === id) meta.activeAccountId = undefined;
    writeMeta(meta);
  }

  function getActiveAccountId() {
    return readMeta().activeAccountId;
  }

  function setActiveAccountId(accountId) {
    const id = normalizeAccountId(accountId);
    if (!id) throw new Error('无效账号：accountId 不能为空');
    const meta = readMeta();
    meta.activeAccountId = id;
    meta.accounts = meta.accounts.map((item) =>
      item.accountId === id ? { ...item, lastUsedAt: Date.now() } : item
    );
    writeMeta(meta);
  }

  function clearActiveAccountId() {
    const meta = readMeta();
    meta.activeAccountId = undefined;
    writeMeta(meta);
  }

  function getUserInfo() {
    return readMeta().userInfo;
  }

  function saveUserInfo(userInfo) {
    const meta = readMeta();
    meta.userInfo = userInfo && typeof userInfo === 'object' ? userInfo : undefined;
    writeMeta(meta);
  }

  function clearUserInfo() {
    const meta = readMeta();
    meta.userInfo = undefined;
    writeMeta(meta);
  }

  // -------------------------------------------------------- 每账号 scoped KV

  function stateFileName(accountId) {
    const scope = normalizeAccountId(accountId) || DEFAULT_SCOPE;
    const safeScope = scope.replace(/[^\w.-]+/g, '_');
    return `state.${safeScope}.json`;
  }

  function getState(accountId, key, fallback) {
    const data = readJsonFile(stateFileName(accountId), {});
    const value = data && typeof data === 'object' ? data[key] : undefined;
    return value === undefined ? fallback : value;
  }

  function setState(accountId, key, value) {
    const fileName = stateFileName(accountId);
    const data = readJsonFile(fileName, {});
    if (value === undefined) delete data[key];
    else data[key] = value;
    writeJsonFile(fileName, data);
  }

  function clearAll(accountId) {
    const id = normalizeAccountId(accountId);
    if (!id) return;
    deleteFile(stateFileName(id));
    const secrets = readSecrets();
    delete secrets[`${APP_PREFIX}.${id}.cookies`];
    delete secrets[`${APP_PREFIX}.${id}.simpleBrowserAuth`];
    delete secrets[`${APP_PREFIX}.${id}.apiKey`];
    writeJsonFile(SECRETS_FILE, secrets);
    removeAccount(id);
  }

  // C3: 独立小文件通道（roaming.meta 等高频小状态，避免随 state 大 JSON 全量重写）
  function readAux(fileName, fallback) { return readJsonFile(fileName, fallback); }
  function writeAux(fileName, data) { writeJsonFile(fileName, data); }

  return {
    readAux,
    writeAux,
    // secrets
    getCookies,
    saveCookies,
    clearCookies,
    getSimpleBrowserAuth,
    saveSimpleBrowserAuth,
    clearSimpleBrowserAuth,
    getSessionSnapshot,
    saveSessionSnapshot,
    getLastCookieLoginFields,
    saveLastCookieLoginFields,
    getApiKey,
    saveApiKey,
    clearApiKey,
    // meta
    listAccounts,
    addAccount,
    updateAccount,
    removeAccount,
    getActiveAccountId,
    setActiveAccountId,
    clearActiveAccountId,
    getUserInfo,
    saveUserInfo,
    clearUserInfo,
    // scoped KV
    getState,
    setState,
    clearAll,
  };
}
