// test/store.test.js —— createStore 状态与凭据文件存储（临时目录）
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

let dir;
let store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-store-'));
  store = createStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cookies', () => {
  test('保存/读取/清除（带账号作用域）', () => {
    store.setActiveAccountId('acc1');
    assert.equal(store.getCookies(), undefined);
    store.saveCookies('acc1', 'wr_vid=1; wr_skey=abc');
    assert.equal(store.getCookies('acc1'), 'wr_vid=1; wr_skey=abc');
    // 省略 accountId 时解析到活跃账号
    assert.equal(store.getCookies(), 'wr_vid=1; wr_skey=abc');
    store.clearCookies('acc1');
    assert.equal(store.getCookies('acc1'), undefined);
  });

  test('空串保存等于删除', () => {
    store.saveCookies('acc1', 'c1');
    store.saveCookies('acc1', '  ');
    assert.equal(store.getCookies('acc1'), undefined);
  });

  test('secrets.json 权限为 600', () => {
    store.saveCookies('acc1', 'x');
    const mode = fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

describe('账号表 meta', () => {
  test('addAccount 归一化 + 去重合并', () => {
    store.addAccount({ accountId: 'a1', displayName: '张三' });
    store.addAccount({ accountId: 'a1', displayName: '李四' });
    const accounts = store.listAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].displayName, '李四');
    assert.equal(accounts[0].accountId, 'a1');
  });

  test('无效 accountId 被拒绝', () => {
    assert.equal(store.addAccount({ accountId: '  ' }), undefined);
    assert.deepEqual(store.listAccounts(), []);
  });

  test('setActiveAccountId / removeAccount 联动', () => {
    store.addAccount({ accountId: 'a1' });
    store.addAccount({ accountId: 'a2' });
    store.setActiveAccountId('a1');
    assert.equal(store.getActiveAccountId(), 'a1');
    store.removeAccount('a1');
    assert.equal(store.getActiveAccountId(), undefined);
    assert.equal(store.listAccounts().length, 1);
  });

  test('setActiveAccountId 空值抛错', () => {
    assert.throws(() => store.setActiveAccountId(''), /accountId 不能为空/);
  });

  test('userInfo 读写清', () => {
    store.saveUserInfo({ userId: 'u1', name: 'n' });
    assert.deepEqual(store.getUserInfo(), { userId: 'u1', name: 'n' });
    store.clearUserInfo();
    assert.equal(store.getUserInfo(), undefined);
  });
});

describe('scoped KV state', () => {
  test('不同账号状态隔离', () => {
    store.setState('a1', 'k', { v: 1 });
    store.setState('a2', 'k', { v: 2 });
    assert.deepEqual(store.getState('a1', 'k'), { v: 1 });
    assert.deepEqual(store.getState('a2', 'k'), { v: 2 });
    assert.equal(store.getState('a1', 'missing', 'fb'), 'fb');
  });

  test('undefined 值删除 key', () => {
    store.setState('a1', 'k', 1);
    store.setState('a1', 'k', undefined);
    assert.equal(store.getState('a1', 'k'), undefined);
  });

  test('写盘文件按账号命名且持久（新实例可读）', () => {
    store.setState('a1', 'k', 'v');
    const store2 = createStore(dir);
    assert.equal(store2.getState('a1', 'k'), 'v');
  });
});

describe('apiKey / simpleBrowserAuth / clearAll', () => {
  test('apiKey 保存读取清除', () => {
    assert.equal(store.getApiKey('a1'), undefined);
    store.saveApiKey('a1', 'wrk-xyz');
    assert.equal(store.getApiKey('a1'), 'wrk-xyz');
    store.clearApiKey('a1');
    assert.equal(store.getApiKey('a1'), undefined);
  });

  test('simpleBrowserAuth 归一化（无 cookies 拒写）', () => {
    store.saveSimpleBrowserAuth('a1', { cookies: 'ck', token: 'tk' });
    const saved = store.getSimpleBrowserAuth('a1');
    assert.equal(saved.cookies, 'ck');
    assert.equal(saved.token, 'tk');
    assert.ok(saved.savedAt > 0);
    store.saveSimpleBrowserAuth('a1', { token: 'no-cookies' });
    // 无 cookies 的载荷不覆盖
    assert.equal(store.getSimpleBrowserAuth('a1').cookies, 'ck');
  });

  test('lastCookieLoginFields', () => {
    store.saveLastCookieLoginFields({ wrVid: 'v', wrSkey: 's' });
    assert.deepEqual(store.getLastCookieLoginFields(), { wrVid: 'v', wrSkey: 's' });
    // 不完整字段不写入（旧记录保留）
    store.saveLastCookieLoginFields({ wrVid: 'only-vid' });
    assert.deepEqual(store.getLastCookieLoginFields(), { wrVid: 'v', wrSkey: 's' });
  });

  test('clearAll 清状态、凭据并移除账号', () => {
    store.addAccount({ accountId: 'a1' });
    store.setActiveAccountId('a1');
    store.saveCookies('a1', 'ck');
    store.saveApiKey('a1', 'wrk-x');
    store.setState('a1', 'k', 'v');
    store.clearAll('a1');
    assert.equal(store.getCookies('a1'), undefined);
    assert.equal(store.getApiKey('a1'), undefined);
    assert.equal(store.getState('a1', 'k'), undefined);
    assert.deepEqual(store.listAccounts(), []);
  });
});

describe('aux 通道', () => {
  test('readAux/writeAux 独立小文件', () => {
    store.writeAux('roaming.meta.json', { a: 1 });
    assert.deepEqual(store.readAux('roaming.meta.json', {}), { a: 1 });
    assert.deepEqual(store.readAux('not-exist.json', 'fb'), 'fb');
  });
});

// v1.9.17 会话快照：阅读窗口「最近一次见到的有效会话」，供窗口不在场时恢复登录态
describe('sessionSnapshot（v1.9.17）', () => {
  test('读写往返：按账号隔离，带 savedAt', () => {
    store.addAccount({ accountId: 'snap-a' });
    store.addAccount({ accountId: 'snap-b' });
    store.saveSessionSnapshot('snap-a', { wrVid: 'VA', wrSkey: 'SA' });
    const a = store.getSessionSnapshot('snap-a');
    assert.equal(a.wrVid, 'VA'); assert.equal(a.wrSkey, 'SA');
    assert.ok(a.savedAt > 0);
    assert.equal(store.getSessionSnapshot('snap-b'), undefined, '按账号隔离：另一账号读不到');
  });

  test('空壳/残缺快照：不写入（旧快照保留）、不读出', () => {
    store.saveSessionSnapshot('snap-c', { wrVid: 'VC', wrSkey: 'SC' });
    store.saveSessionSnapshot('snap-c', { wrVid: '', wrSkey: '' });     // 空壳
    store.saveSessionSnapshot('snap-c', { wrVid: 'VC-only' });          // 缺 skey
    store.saveSessionSnapshot('snap-c', undefined);
    assert.equal(store.getSessionSnapshot('snap-c').wrSkey, 'SC', '空壳/残缺不覆盖已有快照');
  });

  test('随会话凭据一起清除（登出/删号链路）——登出后不得残留', () => {
    store.addAccount({ accountId: 'snap-d' });
    store.saveSessionSnapshot('snap-d', { wrVid: 'VD', wrSkey: 'SD' });
    store.saveSimpleBrowserAuth('snap-d', { cookies: 'wr_vid=VD; wr_skey=SD', token: 'SD' });
    store.clearCookies('snap-d'); // 登出/删号/移除账号链路（auth.logout / logoutAccount / removeAccount）
    assert.equal(store.getSessionSnapshot('snap-d'), undefined, '登出清 cookies 时快照同清');
  });

  test('凭据判死后的降级**不清**快照——那正是快照要用的时刻（首版设计缺陷的回归线）', () => {
    // auth.clearCredentialsForActiveAccount 在凭据失效时调用 clearSimpleBrowserAuth（有意不清 cookies）。
    // 首版把快照清理挂在 clearSimpleBrowserAuth 上 → 凭据一失效快照即被清 → 功能不可能工作。
    store.addAccount({ accountId: 'snap-f' });
    store.saveSessionSnapshot('snap-f', { wrVid: 'VF', wrSkey: 'SF' });
    store.saveSimpleBrowserAuth('snap-f', { cookies: 'wr_vid=VF; wr_skey=SF', token: 'SF' });
    store.clearUserInfo?.();
    store.clearSimpleBrowserAuth('snap-f'); // 凭据降级路径
    assert.ok(store.getSessionSnapshot('snap-f'), '凭据降级后快照必须仍在（否则失效时无从恢复）');
    assert.equal(store.getSessionSnapshot('snap-f').wrSkey, 'SF');
  });

  test('快照存进 secrets.json 且文件权限 0600（含 skey，保护不得弱于现有凭据）', () => {
    store.addAccount({ accountId: 'snap-e' });
    store.saveSessionSnapshot('snap-e', { wrVid: 'VE', wrSkey: 'SE-SECRET' });
    const dir = fs.readdirSync(os.tmpdir()).map((d) => path.join(os.tmpdir(), d)).find((d) => {
      try { return fs.existsSync(path.join(d, 'secrets.json')) && fs.readFileSync(path.join(d, 'secrets.json'), 'utf8').includes('SE-SECRET'); } catch { return false; }
    });
    assert.ok(dir, '快照落盘在 secrets.json（而非另起文件）');
    const mode = fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777;
    if (process.platform !== 'win32') assert.equal(mode, 0o600, `secrets.json 权限应为 0600，实际 ${mode.toString(8)}`);
    // 不得出现独立的快照文件（那会以默认权限落盘）
    const stray = fs.readdirSync(dir).filter((f) => /snapshot|session/i.test(f) && !/^index\./.test(f));
    assert.deepEqual(stray, [], `不应有独立快照文件：${stray.join(',')}`);
  });
});
