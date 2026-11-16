// test/zip.test.js —— 极简 ZIP 生成器（store + UTF-8 EFS）
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeZipFile, collectDirEntries } from '../lib/zip.mjs';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-zip-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 从 zip 二进制解析条目（与实现互逆的独立校验器） */
function parseZip(buf) {
  assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304', '本地头签名');
  const entries = [];
  let off = 0;
  while (buf.subarray(off, off + 4).toString('hex') === '504b0304') {
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const crc = buf.readUInt32LE(off + 14);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.push({ name, flags, method, crc, size: compSize, data });
    off = dataStart + compSize;
  }
  // 中央目录 + EOCD
  assert.equal(buf.subarray(off, off + 4).toString('hex'), '504b0102', '中央目录签名');
  const eocdPos = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocdPos > off, '存在 EOCD');
  const entryCount = buf.readUInt16LE(eocdPos + 10);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  return { entries, entryCount, cdSize, cdOffset: off };
}

test('CRC32 已知向量（"123456789" → 0xCBF43926）', async () => {
  const { writeZipFile: wz } = await import('../lib/zip.mjs');
  const zipPath = wz([{ name: '123456789.txt', data: '123456789' }], path.join(dir, 'a.zip'));
  const parsed = parseZip(fs.readFileSync(zipPath));
  assert.equal(parsed.entries[0].crc, 0xcbf43926);
});

describe('writeZipFile', () => {
  test('写 data 条目：store 不压缩、UTF-8 EFS 标志、数据原样', () => {
    const content = '中文内容 hello';
    const zipPath = writeZipFile([{ name: '笔记/书.md', data: content }], path.join(dir, 'a.zip'));
    const parsed = parseZip(fs.readFileSync(zipPath));
    assert.equal(parsed.entries.length, 1);
    const e = parsed.entries[0];
    assert.equal(e.name, '笔记/书.md');
    assert.equal(e.method, 0, 'store');
    assert.notEqual(e.flags & 0x0800, 0, 'EFS 位');
    assert.equal(e.data.toString('utf8'), content);
    assert.equal(e.size, Buffer.byteLength(content, 'utf8'));
    assert.equal(parsed.entryCount, 1);
  });

  test('多条目：顺序、计数与偏移一致', () => {
    const zipPath = writeZipFile([
      { name: 'a.md', data: 'AAA' },
      { name: 'b/c.md', data: Buffer.from('BBB') },
    ], path.join(dir, 'b.zip'));
    const parsed = parseZip(fs.readFileSync(zipPath));
    assert.deepEqual(parsed.entries.map((e) => e.name), ['a.md', 'b/c.md']);
    assert.equal(parsed.entryCount, 2);
    assert.equal(parsed.cdSize > 0, true);
  });

  test('path 条目：从磁盘读文件打包', () => {
    const src = path.join(dir, 'src.md');
    fs.writeFileSync(src, 'from disk');
    const zipPath = writeZipFile([{ name: 'src.md', path: src }], path.join(dir, 'c.zip'));
    const parsed = parseZip(fs.readFileSync(zipPath));
    assert.equal(parsed.entries[0].data.toString('utf8'), 'from disk');
  });

  test('返回 zip 路径', () => {
    const p = writeZipFile([{ name: 'x', data: '1' }], path.join(dir, 'd.zip'));
    assert.equal(p, path.join(dir, 'd.zip'));
  });
});

describe('collectDirEntries', () => {
  test('递归收集 + 前缀 + filter', () => {
    fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), 'a');
    fs.writeFileSync(path.join(dir, 'sub', 'b.md'), 'b');
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'c.txt'), 'c');
    const entries = collectDirEntries(dir, 'prefix');
    assert.deepEqual(entries.map((e) => e.name).sort(), ['prefix/a.md', 'prefix/sub/b.md', 'prefix/sub/deep/c.txt']);
    const onlyMd = collectDirEntries(dir, '', (_abs, name) => name.endsWith('.md'));
    assert.deepEqual(onlyMd.map((e) => e.name).sort(), ['a.md', 'sub/b.md']);
  });
});
