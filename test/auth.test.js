// test/auth.test.js —— 登录态分类、Key 营救、Cookie 登录（真实 store + mock api/gateway）
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';
import { createAuthManager } from '../lib/auth.js';
import { GatewayError } from '../lib/gateway.js';

let dir;
let store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-auth-'));
  store = createStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeApi({ checkLoginStatus = async () => true, refresh, profile } = {}) {
  return {
    apiClient: {
      _cookies: '',
      setCookies(c) { this._cookies = c; },
      clearCookies() { this._cookies = ''; },
      getCookies() { return this._cookies; },
    },
    checkLoginStatus: (...a) => checkLoginStatus(...a),
    refreshCookiesFromServer: refresh || (async (c) => c),
    fetchUserInfo: async () => ({ user: { userId: 'u1', name: 'TokenUser' } }),
    getUserProfile: profile || (async () => ({ user: { userId: 'u1', name: 'N', avatar: 'a' } })),
  };
}

function makeGateway({ ping = async () => true, call = async () => ({}) } = {}) {
  return {
    _key: '',
    setApiKey(k) { this._key = k; },
    clearApiKey() { this._key = ''; },
    getApiKey() { return this._key; },
    ping: (...a) => ping(...a),
    call: (...a) => call(...a),
  };
}

function login(store, api, extra = {}) {
  // 准备一个已登录账号 u1（cookie 通道）
  store.setActiveAccountId('u1');
  store.saveCookies('u1', 'wr_vid=1; wr_skey=k');
  store.addAccount({ accountId: 'u1', displayName: 'N' });
  store.saveUserInfo({ userId: 'u1', name: 'N' });
  return createAuthManager(store, api, undefined, extra.gateway);
}

describe('isLoggedIn 登录态分类', () => {
  test('无凭据 / 仅 cookie / 仅 apiKey', () => {
    const api = makeApi();
    const auth = createAuthManager(store, api);
    assert.equal(auth.isLoggedIn(), false);
    store.saveCookies('u1', 'ck'); store.setActiveAccountId('u1');
    assert.equal(auth.isLoggedIn(), true);
    store.clearCookies('u1');
    assert.equal(auth.isLoggedIn(), false);
    store.saveApiKey('u1', 'wrk-x');
    assert.equal(auth.isLoggedIn(), true, 'apiKey-only 也算登录');
  });
});

describe('checkLoginStatus', () => {
  test('无任何凭据 → false 且清 userInfo', async () => {
    const auth = login(store, makeApi());
    store.clearCookies('u1');
    store.saveUserInfo({ userId: 'u1' });
    // 无 cookie 无 key
    const auth2 = createAuthManager(store, makeApi());
    store.clearApiKey('u1');
    const r = await auth2.checkLoginStatus();
    assert.equal(r, false);
    assert.equal(store.getUserInfo(), undefined);
    void auth;
  });

  test('cookie 有效 → true 并刷新 lastVerifiedAt', async () => {
    const auth = login(store, makeApi({ checkLoginStatus: async () => true }));
    const r = await auth.checkLoginStatus();
    assert.equal(r, true);
    assert.ok(store.getState('u1', 'authMeta', {}).lastVerifiedAt > 0);
    assert.deepEqual(auth.getLastRawCheck().ok, true);
  });

  test('cookie 无效且无 Key 且无宽限 → checkLoginStatus false 并清 userInfo', async () => {
    const auth = login(store, makeApi({ checkLoginStatus: async () => false }));
    const r = await auth.checkLoginStatus();
    assert.equal(r, false);
    // clearCredentialsForActiveAccount 清 userInfo/simpleBrowserAuth（cookie 本体保留供重试登录）
    assert.equal(store.getUserInfo(), undefined);
    assert.equal(store.getSimpleBrowserAuth('u1'), undefined);
  });

  test('cookie 无效但 Key 有效 → Key 营救保持登录', async () => {
    const gw = makeGateway();
    const auth = login(store, makeApi({ checkLoginStatus: async () => false }), { gateway: gw });
    store.saveApiKey('u1', 'wrk-x');
    const r = await auth.checkLoginStatus();
    assert.equal(r, true);
    assert.equal(store.getCookies('u1'), 'wr_vid=1; wr_skey=k', '凭据不清理');
    assert.deepEqual(auth.getLastRawCheck().ok, true);
  });

  test('apiKey-only：网关 ping 成功 → true', async () => {
    const gw = makeGateway();
    const api = makeApi();
    store.setActiveAccountId('u2');
    store.saveApiKey('u2', 'wrk-y');
    const auth = createAuthManager(store, api, undefined, gw);
    assert.equal(await auth.checkLoginStatus(), true);
    assert.equal(gw.getApiKey(), 'wrk-y', 'Key 已注入网关');
  });

  test('apiKey-only：Key 无效（401）→ 严格模式 false', async () => {
    const gw = makeGateway({ ping: async () => { throw new GatewayError('API Key 无效或已过期', { status: 401 }); } });
    store.setActiveAccountId('u2');
    store.saveApiKey('u2', 'wrk-bad');
    const auth = createAuthManager(store, makeApi(), undefined, gw);
    const r = await auth.checkLoginStatus({ strict: true });
    assert.equal(r, false);
  });

  test('网络异常（status 0）+ 宽限期内 → 保数据返回 true', async () => {
    const gw = makeGateway({ ping: async () => { throw new GatewayError('官方网关请求超时', { status: 0 }); } });
    store.setActiveAccountId('u2');
    store.saveApiKey('u2', 'wrk-y');
    store.setState('u2', 'authMeta', { lastVerifiedAt: Date.now() - 60_000 });
    const auth = createAuthManager(store, makeApi(), undefined, gw);
    assert.equal(await auth.checkLoginStatus(), true);
  });
});

describe('verifyApiKey / verifyNow', () => {
  test('verifyApiKey：网络异常返回 null', async () => {
    const gw = makeGateway({ ping: async () => { throw new GatewayError('官方网关网络异常：ECONNREFUSED', { status: 0 }); } });
    const auth = login(store, makeApi(), { gateway: gw });
    store.saveApiKey('u1', 'wrk-z');
    assert.equal(await auth.verifyApiKey('u1'), null);
  });

  test('verifyNow：cookie 通道有效 → true', async () => {
    const auth = login(store, makeApi({ checkLoginStatus: async () => true }));
    assert.equal(await auth.verifyNow(), true);
  });

  test('verifyNow：无凭据 → false', async () => {
    const auth = createAuthManager(store, makeApi());
    assert.equal(await auth.verifyNow(), false);
    assert.deepEqual(auth.getLastRawCheck(), { ok: false, at: auth.getLastRawCheck().at });
  });

  test('verifyNow：cookie 失效 + Key 营救 → true', async () => {
    const gw = makeGateway();
    const auth = login(store, makeApi({ checkLoginStatus: async () => false }), { gateway: gw });
    store.saveApiKey('u1', 'wrk-r');
    assert.equal(await auth.verifyNow(), true);
  });
});

describe('loginByCookie', () => {
  test('规范化粘贴值并完成登录序列', async () => {
    const api = makeApi();
    const auth = createAuthManager(store, api);
    const r = await auth.loginByCookie({ wrVid: ' wr_vid = "12345" ; ', wrSkey: "'sk'" });
    // vid+skey 齐备 → 走 getUserProfileByToken（fetchUserInfo 通道）
    assert.equal(r.accountId, 'u1');
    assert.equal(r.name, 'TokenUser');
    assert.equal(api.apiClient.getCookies(), 'wr_vid=12345; wr_skey=sk');
    assert.equal(store.getActiveAccountId(), 'u1');
    assert.ok(store.getCookies('u1').includes('wr_vid=12345'));
    assert.deepEqual(store.getLastCookieLoginFields(), { wrVid: '12345', wrSkey: 'sk' });
    assert.equal(store.getUserInfo().name, 'TokenUser');
  });

  test('缺字段抛错', async () => {
    const auth = createAuthManager(store, makeApi());
    await assert.rejects(() => auth.loginByCookie({ wrVid: '1' }), /wr_vid 与 wr_skey/);
  });
});

describe('登出与事件', () => {
  test('logoutAccount 清凭据并广播 false', async () => {
    const gw = makeGateway();
    const auth = login(store, makeApi(), { gateway: gw });
    store.saveApiKey('u1', 'wrk-x');
    gw.setApiKey('wrk-x');
    const events = [];
    auth.onDidChangeLoginState((s) => events.push(s));
    await auth.logoutAccount('u1');
    assert.equal(store.getCookies('u1'), undefined);
    assert.equal(store.getApiKey('u1'), undefined);
    assert.deepEqual(events, [false]);
    assert.equal(gw.getApiKey(), '', '网关 Key 同步清空');
    assert.equal(auth.getCookieOrigin('u1'), null, 'cookieOrigin 不残留');
  });

  test('logout（活跃账号）等价登出', async () => {
    const auth = login(store, makeApi());
    await auth.logout();
    assert.equal(auth.isLoggedIn(), false);
    assert.equal(store.getUserInfo(), undefined);
  });
});
