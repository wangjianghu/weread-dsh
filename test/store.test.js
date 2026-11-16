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
