// test/authtoken.test.js —— v1.9.11 宿主调用方认证：timing-safe 令牌比较
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { safeTokenEqual } from '../index.js';

describe('safeTokenEqual（v1.9.11）', () => {
  test('等值令牌通过', () => {
    assert.equal(safeTokenEqual('a'.repeat(64), 'a'.repeat(64)), true);
    assert.equal(safeTokenEqual('secret-token', 'secret-token'), true);
  });
  test('不等值拒绝（同长度，防内容泄露）', () => {
    assert.equal(safeTokenEqual('a'.repeat(64), 'b'.repeat(64)), false);
  });
  test('长度不等直接拒绝（不抛异常）', () => {
    assert.equal(safeTokenEqual('short', 'a'.repeat(64)), false);
    assert.equal(safeTokenEqual('', 'a'.repeat(64)), false);
  });
  test('非字符串输入拒绝', () => {
    assert.equal(safeTokenEqual(null, 'a'.repeat(64)), false);
    assert.equal(safeTokenEqual(undefined, 'x'), false);
    assert.equal(safeTokenEqual(123, 'x'), false);
  });
  test('大小写敏感（hex token 语义）', () => {
    assert.equal(safeTokenEqual('Abc', 'abc'), false);
  });
});
