// test/refresh.test.js —— v1.9.15：HEAD 续命的「skey 是否真的换新」判定
// 背景（2026-11-25 真机实测）：`HEAD https://weread.qq.com/` 只下发 wr_gid（设备标识），
// 不下发 wr_skey。原实现以「整串变化」判定续命成功——wr_gid 一变就记为「wr_skey 续命」，
// 日志谎报、设置页显示从未发生的续命，掩盖了「插件 skey 从登录起就在倒计时」这一事实。
// 现以「wr_skey 值是否变化」为唯一判据；并补 wr_skey 轮换时的合并语义。
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshCookiesFromServer, cookieSkey, skeyRotated } from '../lib/api.js';

const SKEY_A = 'AAAA1111';
const SKEY_B = 'BBBB2222';
const CK = `wr_vid=12345678; wr_skey=${SKEY_A}`;

let origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

// 桩：按给定 Set-Cookie 名值响应 HEAD（模拟 Node 的 headers.getSetCookie）
const stubHead = (setCookies) => {
  globalThis.fetch = async () => ({
    headers: { getSetCookie: () => setCookies, get: () => null },
  });
};

describe('skeyRotated（v1.9.15 判据）', () => {
  test('只有 wr_gid 变化 → 不算续命（真机实测的 HEAD 行为）', () => {
    assert.equal(skeyRotated(CK, `wr_gid=abc; wr_vid=12345678; wr_skey=${SKEY_A}`), false);
  });

  test('wr_skey 换新值 → 算续命', () => {
    assert.equal(skeyRotated(CK, `wr_vid=12345678; wr_skey=${SKEY_B}`), true);
  });

  test('整串原样返回（无 Set-Cookie）→ 不算续命', () => {
    assert.equal(skeyRotated(CK, CK), false);
  });

  test('任一侧缺 wr_skey → 不算续命（防把「丢失」误判为「换新」）', () => {
    assert.equal(skeyRotated(CK, 'wr_vid=12345678'), false);
    assert.equal(skeyRotated('wr_vid=12345678', `wr_skey=${SKEY_B}`), false);
    assert.equal(skeyRotated('', ''), false);
  });
});

describe('cookieSkey', () => {
  test('提取 wr_skey 值（首位/中间/末位）', () => {
    assert.equal(cookieSkey(`wr_skey=${SKEY_A}`), SKEY_A);
    assert.equal(cookieSkey(`wr_vid=1; wr_skey=${SKEY_A}; wr_gid=x`), SKEY_A);
    assert.equal(cookieSkey(`wr_gid=x; wr_skey=${SKEY_A}`), SKEY_A);
  });
  test('缺失/空输入 → undefined', () => {
    assert.equal(cookieSkey('wr_vid=1'), undefined);
    assert.equal(cookieSkey(''), undefined);
    assert.equal(cookieSkey(undefined), undefined);
  });
});

describe('refreshCookiesFromServer 合并语义', () => {
  test('只下发 wr_gid → 合并进串（保留该行为：gid 仍需带回），但 skey 未换', async () => {
    stubHead(['wr_gid=G1; Path=/; Max-Age=31536000']);
    const merged = await refreshCookiesFromServer(CK);
    assert.match(merged, /wr_gid=G1/);
    assert.equal(cookieSkey(merged), SKEY_A, 'skey 原值保留');
    assert.equal(skeyRotated(CK, merged), false);
  });

  test('真轮换 wr_skey → 新值合并进串且判定为续命', async () => {
    stubHead([`wr_skey=${SKEY_B}; Path=/; HttpOnly`]);
    const merged = await refreshCookiesFromServer(CK);
    assert.equal(cookieSkey(merged), SKEY_B);
    assert.equal(skeyRotated(CK, merged), true);
  });

  test('无 Set-Cookie → 原串原样返回', async () => {
    stubHead([]);
    assert.equal(await refreshCookiesFromServer(CK), CK);
  });

  test('旧 headers.get 回退路径仍可解析', async () => {
    globalThis.fetch = async () => ({ headers: { getSetCookie: undefined, get: () => `wr_gid=G2; Path=/` } });
    const merged = await refreshCookiesFromServer(CK);
    assert.match(merged, /wr_gid=G2/);
  });

  // v1.9.16：合并对「空值」的防御（排查 2026-11-25 真机空壳凭据时坐实的脆弱点）
  describe('v1.9.16 空值防御', () => {
    test('服务端下发空值 wr_skey → 不覆盖本地有效值', async () => {
      stubHead([`wr_skey=; Path=/; HttpOnly`]);
      const merged = await refreshCookiesFromServer(CK);
      assert.equal(cookieSkey(merged), SKEY_A, '本地有效 skey 不得被空值覆盖');
    });
    test('服务端下发空值 wr_vid → 不覆盖本地有效值', async () => {
      stubHead([`wr_vid=; Path=/`]);
      const merged = await refreshCookiesFromServer(`wr_vid=12345678; wr_skey=${SKEY_A}`);
      assert.match(merged, /wr_vid=12345678/);
      assert.doesNotMatch(merged, /wr_vid=;/, '无空值 wr_vid');
    });
    test('本地当前串已是空壳（wr_vid=; wr_skey=）→ 结果里不再有空值项', async () => {
      // 真机现场形态：插件凭据 wr_vid=; wr_skey=; wr_gid=xxx。空壳不是凭据，合并不得把它延续下去。
      stubHead(['wr_gid=238966572; Path=/']);
      const merged = await refreshCookiesFromServer('wr_vid=; wr_skey=; wr_gid=OLDGID');
      assert.equal(merged, 'wr_gid=238966572', `空值项被丢弃，仅保留有值的 wr_gid（实际：${merged}）`);
    });
    test('本地为 undefined/空串且服务端只给 wr_gid → 只得 wr_gid（不凭空造出空壳）', async () => {
      stubHead(['wr_gid=G9; Path=/']);
      assert.equal(await refreshCookiesFromServer(undefined), 'wr_gid=G9');
      assert.equal(await refreshCookiesFromServer(''), 'wr_gid=G9');
    });
    test('有值的会话 Cookie 照常合并（防御不误伤正常轮换）', async () => {
      stubHead([`wr_skey=${SKEY_B}; Path=/; HttpOnly`, 'wr_vid=87654321; Path=/']);
      const merged = await refreshCookiesFromServer(CK);
      assert.equal(cookieSkey(merged), SKEY_B);
      assert.match(merged, /wr_vid=87654321/);
    });
  });

  test('v1.9.15 修复既有 Bug：回退路径不再把 name=value 逐字符切碎', async () => {
    // 原正则量词全为 *（可零宽）→ 匹配空串：'wr_gid=G2' 被切成 ['w','r','_','g','i','d=G2;']，
    // 往 Cookie 串灌入垃圾键 d/h。带 Expires 日期（内含逗号）时也不得切坏。
    globalThis.fetch = async () => ({
      headers: { getSetCookie: undefined, get: () => 'wr_gid=G2; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, wr_rt=R9; HttpOnly' },
    });
    const merged = await refreshCookiesFromServer(CK);
    assert.match(merged, /(?:^|;\s*)wr_gid=G2/, 'wr_gid 键名完整');
    assert.match(merged, /(?:^|;\s*)wr_rt=R9/, '第二条 Set-Cookie 也被正确识别');
    assert.doesNotMatch(merged, /;\s*[a-z]=/, '无单字母垃圾键');
    assert.equal(cookieSkey(merged), SKEY_A, 'skey 不被回退路径破坏');
  });
});

// v1.9.15 交叉一致性：auth 内聚了一份同实现的判据（auth 零 import、api 为注入依赖，不能依赖
// 注入对象带这些函数）。auth 的判据未导出，经其可观察行为（cookieOrigin 指纹）与 api 导出对拍，
// 防两份实现漂移。注入的 api 桩**故意不带** skeyRotated——守住「可选调用静默退化」这条回归。
describe('auth 判据 ↔ api 判据 一致性（经可观察行为）', () => {
  const mkAuth = async (headResult) => {
    const { createAuthManager } = await import('../lib/auth.js');
    const { createStore } = await import('../lib/store.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-refresh-x-'));
    const store = createStore(dir);
    store.addAccount({ accountId: 'X1', displayName: 'x', wrVid: 'V1', createdAt: 1, lastUsedAt: 1 });
    store.setActiveAccountId('X1');
    const logs = [];
    const api = {
      checkLoginStatus: async () => true,
      apiClient: { setCookies() {}, clearCookies() {} },
      refreshCookiesFromServer: async () => headResult, // 桩：不带 skeyRotated / cookieSkey
      fetchUserInfo: async () => ({ user: { userId: 'X1', userVid: 'V1', name: 'x' } }),
      getUserProfileByToken: async () => ({ userId: 'X1', name: 'x' }),
      getUserProfile: async () => { throw new Error('x'); },
    };
    const auth = createAuthManager(store, api, { info: (m) => logs.push(m), warn() {}, error() {} });
    await auth.handleLoginSuccess({ cookies: `wr_vid=V1; wr_skey=${SKEY_A}`, vid: 'V1', skey: SKEY_A, token: SKEY_A, session: 'V1' });
    return { auth, logs, dir };
  };

  test('HEAD 只换 wr_gid（真机行为）→ auth 不记续命指纹、不打续命日志', async () => {
    const before = `wr_vid=V1; wr_skey=${SKEY_A}`;
    const after = `wr_vid=V1; wr_skey=${SKEY_A}; wr_gid=G1`;
    assert.equal(skeyRotated(before, after), false, '（前置）api 判据判未换新');
    const { auth, logs, dir } = await mkAuth(after);
    try {
      await auth.warmupRefreshForOpen();
      assert.equal(auth.getCookieOrigin()?.source, 'login', 'cookieOrigin 仍为 login（未被谎报为 head-refresh）');
      assert.ok(!logs.some((m) => m.includes('wr_skey 续命')), '无「wr_skey 续命」日志');
      assert.ok(logs.some((m) => m.includes('未轮换')), '有一条说明性的「未轮换」日志');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('HEAD 真换新 wr_skey → auth 记续命指纹 + 打续命日志（既有语义保持）', async () => {
    const before = `wr_vid=V1; wr_skey=${SKEY_A}`;
    const after = `wr_vid=V1; wr_skey=${SKEY_B}`;
    assert.equal(skeyRotated(before, after), true, '（前置）api 判据判换新');
    const { auth, logs, dir } = await mkAuth(after);
    try {
      await auth.warmupRefreshForOpen();
      assert.equal(auth.getCookieOrigin()?.source, 'head-refresh');
      assert.equal(auth.getCookieOrigin()?.skeyTail, SKEY_B.slice(-6));
      assert.ok(logs.some((m) => m.includes('wr_skey 续命')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
