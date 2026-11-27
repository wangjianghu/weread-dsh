// test/api.test.js —— 纯函数：URL 构建、归一化、笔记变换
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL,
  extractSessionFromCookies,
  buildReaderIdFromBookId,
  buildPcUrl,
  normalizeBookItem,
  transformNotes,
  normalizePcUrl,
  extractReaderBookId,
} from '../lib/api.js';

describe('extractSessionFromCookies', () => {
  test('提取 wr_vid / wr_skey（含 URL 编码解码）', () => {
    assert.deepEqual(extractSessionFromCookies('wr_vid=123; wr_skey=abc%2Fdef'), { vid: '123', skey: 'abc/def' });
    assert.deepEqual(extractSessionFromCookies('other=1; wr_vid=9; foo=2; wr_skey=s'), { vid: '9', skey: 's' });
  });
  test('缺失任一字段返回 undefined', () => {
    assert.equal(extractSessionFromCookies('wr_vid=1'), undefined);
    assert.equal(extractSessionFromCookies(''), undefined);
    assert.equal(extractSessionFromCookies(undefined), undefined);
  });
});

describe('buildReaderIdFromBookId / buildPcUrl', () => {
  test('同 bookId 确定性，不同 bookId 不同', () => {
    assert.equal(buildReaderIdFromBookId('123456'), buildReaderIdFromBookId('123456'));
    assert.notEqual(buildReaderIdFromBookId('123456'), buildReaderIdFromBookId('123457'));
  });

  test('普通书 → /web/reader/；MP 文章 → /web/mp/reader/', () => {
    assert.match(buildPcUrl('123456'), /^https:\/\/weread\.qq\.com\/web\/reader\//);
    assert.match(buildPcUrl('MP_WXS_abc'), /^https:\/\/weread\.qq\.com\/web\/mp\/reader\//);
    assert.match(buildPcUrl('article:MP_WXS_abc'), /^https:\/\/weread\.qq\.com\/web\/mp\/reader\//);
  });
});

describe('normalizePcUrl', () => {
  test('MP_WXS_ 挂在 /web/reader/ 下规范化为 mp 路径', () => {
    assert.match(
      normalizePcUrl('https://weread.qq.com/web/reader/MP_WXS_abc', 'MP_WXS_abc'),
      /^https:\/\/weread\.qq\.com\/web\/mp\/reader\//
    );
  });
  test('正常 URL 原样保留；空值走构建', () => {
    assert.equal(normalizePcUrl('https://weread.qq.com/web/reader/good1', '123'), 'https://weread.qq.com/web/reader/good1');
    assert.match(normalizePcUrl('', '123'), /^https:\/\/weread\.qq\.com\/web\/reader\//);
  });
});

describe('normalizeBookItem', () => {
  test('字段映射与默认值', () => {
    const b = normalizeBookItem({ bookId: '1', title: 'T', author: 'A', progress: 0.42 });
    assert.equal(b.bookId, '1');
    assert.equal(b.progress, 42); // <1 视为比例 ×100
    assert.equal(b.title, 'T');
    assert.equal(b.docType, undefined);
    assert.equal(b.author, 'A');
    assert.match(b.pcUrl, /^https:\/\/weread\.qq\.com\/web\/reader\//);
  });

  test('整数进度不二次放大', () => {
    assert.equal(normalizeBookItem({ bookId: '1', progress: 80 }).progress, 80);
  });

  test('无 bookId 返回 undefined；无标题回退「未命名书籍」', () => {
    assert.equal(normalizeBookItem({ title: 'x' }), undefined);
    assert.equal(normalizeBookItem({ bookId: '1' }).title, '未命名书籍');
  });

  test('嵌套 book 包装也能取字段', () => {
    const b = normalizeBookItem({ book: { bookId: '2', title: 'Inner', progress: 10, isbn: 'i' } });
    assert.ok(b);
    assert.equal(b.title, 'Inner');
    assert.equal(b.isbn, 'i');
  });
});

describe('transformNotes', () => {
  test('bookmarklist 形状映射 + createTime 缺失不伪造', () => {
    const notes = transformNotes(
      { updated: [{ bookmarkId: 'bm1', chapterUid: 3, chapterTitle: 'C', markText: '划线', createTime: 100, modifyTime: 200 }] },
      'book9'
    );
    assert.equal(notes.length, 1);
    assert.equal(notes[0].noteId, 'bm1');
    assert.equal(notes[0].bookId, 'book9');
    assert.equal(notes[0].highlightText, '划线');
    assert.equal(notes[0].createTime, 100);
    assert.equal(notes[0].modifyTime, 200);

    const noTime = transformNotes({ updated: [{ bookmarkId: 'bm2', markText: 'x' }] }, 'b');
    assert.equal(noTime[0].createTime, 0, '缺失即 0，不落 Date.now()');
    assert.equal(noTime[0].modifyTime, undefined);
  });

  test('无回包结构识别（bookmarks/notes/深层嵌套）', () => {
    assert.equal(transformNotes({ bookmarks: [{ bookmarkId: 'a', markText: 'x' }] }, 'b').length, 1);
    assert.equal(transformNotes({ data: { list: [{ reviewId: 'r', content: '想法' }] } }, 'b').length, 1);
    assert.deepEqual(transformNotes({}, 'b'), []);
    assert.deepEqual(transformNotes({ updated: [] }, 'b'), []);
  });

  test('style JSON 解析为 {color}', () => {
    const [n] = transformNotes({ updated: [{ bookmarkId: 's', markText: 'x', style: '{"color":3}' }] }, 'b');
    assert.deepEqual(n.style, { color: 3 });
    const [bad] = transformNotes({ updated: [{ bookmarkId: 's', markText: 'x', style: 'not-json' }] }, 'b');
    assert.deepEqual(bad.style, {});
  });
});

test('BASE_URL 常量', () => {
  assert.equal(BASE_URL, 'https://i.weread.qq.com');
});

// v1.9.19：「问 DSH」按页面 URL 里的 bookId 精确找书
describe('extractReaderBookId', () => {
  test('普通书页 / 公众号文章页', () => {
    assert.equal(extractReaderBookId('https://weread.qq.com/web/reader/a57325c05c8ed3a57224187'), 'a57325c05c8ed3a57224187');
    assert.equal(extractReaderBookId('https://weread.qq.com/web/reader/12345'), '12345');
    assert.equal(extractReaderBookId('https://weread.qq.com/web/mp/reader/MP_WXS_abc'), 'MP_WXS_abc');
  });
  test('去掉查询串与 hash；URL 编码的 ID 解码', () => {
    assert.equal(extractReaderBookId('https://weread.qq.com/web/reader/b1?k=1'), 'b1');
    assert.equal(extractReaderBookId('https://weread.qq.com/web/reader/b1#chapter2'), 'b1');
    assert.equal(extractReaderBookId('https://weread.qq.com/web/reader/%E4%B9%A6'), '书');
  });
  test('非阅读页（首页/书架）与非法输入 → 空串', () => {
    assert.equal(extractReaderBookId('https://weread.qq.com/'), '');
    assert.equal(extractReaderBookId('https://weread.qq.com/web/shelf'), '');
    assert.equal(extractReaderBookId('https://weread.qq.com/web/book/info/x'), '');
    assert.equal(extractReaderBookId(''), '');
    assert.equal(extractReaderBookId(undefined), '');
    assert.equal(extractReaderBookId(null), '');
    assert.equal(extractReaderBookId(123), '');
  });
});
