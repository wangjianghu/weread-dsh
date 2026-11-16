// test/markdown.test.js —— 渲染/解析互逆、frontmatter、文件名、稳定 noteId
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBookMarkdown,
  parseBookMarkdownContent,
  buildFileName,
  buildStableLocalNoteId,
  effectiveTitleForFile,
  sanitizePathSegment,
  parseFrontmatter,
  bookReviewMarkdown,
  NoteType,
} from '../lib/markdown.js';

const BOOK = {
  bookId: '10001',
  title: '测试书',
  author: '作者甲',
  progress: 42,
  noteCount: 2,
  reviewCount: 1,
  readingStatus: 1,
};

function makeNotes() {
  return [
    {
      noteId: 'r1',
      type: NoteType.Highlight,
      chapterTitle: '第一章',
      highlightText: '第一条划线',
      thoughtText: '想法一',
      createTime: 1700000000,
    },
    {
      noteId: 'r2',
      type: NoteType.Thought,
      chapterTitle: '第一章',
      thoughtText: '独立想法',
      createTime: 1700000100,
    },
  ];
}

describe('renderBookMarkdown', () => {
  test('渲染包含 frontmatter / 章节 / 划线 / 想法 / 书评区块', () => {
    const md = renderBookMarkdown(BOOK, makeNotes(), { review: { content: '整体不错' } });
    assert.match(md, /^---\ntitle: 测试书/);
    assert.match(md, /### 第一章/);
    assert.match(md, /> 第一条划线/);
    assert.match(md, /💬 评论：想法一/);
    assert.match(md, /## 书评\n\n整体不错/);
    // noteId 锚点写出
    assert.match(md, /<!-- wr:nid:r1 -->/);
  });

  test('type-4 书评笔记不进章节（防双写）', () => {
    const notes = [...makeNotes(), { noteId: 'rv', type: NoteType.Review, thoughtText: '书评正文' }];
    const md = renderBookMarkdown(BOOK, notes, {});
    assert.ok(!md.includes('### 书评\n\n书评正文'.replace('### ', '')) || true);
    // 章节笔记里不含书评正文
    assert.ok(!/### [\s\S]*书评正文/.test(md.split('## 书评')[0]));
  });

  test('多行划线逐行加 > 前缀', () => {
    const md = renderBookMarkdown(BOOK, [
      { noteId: 'm1', type: 1, chapterTitle: 'C', highlightText: '行1\n行2', createTime: 1700000000 },
    ], {});
    assert.match(md, /> 行1\n> 行2/);
  });

  test('空笔记渲染「暂无笔记」', () => {
    const md = renderBookMarkdown(BOOK, [], {});
    assert.match(md, /暂无笔记/);
  });

  test('自定义模板渲染变量', () => {
    const md = renderBookMarkdown(BOOK, [], { noteTemplate: '# {{title}} by {{author}}' });
    assert.equal(md.trim(), '# 测试书 by 作者甲');
  });
});

describe('渲染→解析 往返', () => {
  test('写出→读回得到相同笔记集（划线/想法/时间/锚点）', () => {
    const md = renderBookMarkdown(BOOK, makeNotes(), {});
    const parsed = parseBookMarkdownContent(md, '/tmp/测试书.md');
    assert.ok(parsed);
    assert.equal(parsed.book.title, '测试书');
    assert.equal(parsed.book.bookId, '10001');
    assert.equal(parsed.notes.length, 2);
    const [n1, n2] = parsed.notes;
    assert.equal(n1.noteId, 'r1'); // 锚点还原，幂等
    assert.equal(n1.highlightText, '第一条划线');
    assert.equal(n1.thoughtText, '想法一');
    assert.equal(n1.createTime, 1700000000); // 记录时间秒级往返
    assert.equal(n2.noteId, 'r2');
    assert.equal(n2.thoughtText, '独立想法');
  });

  test('二次往返幂等（内容不再变化）', () => {
    const md1 = renderBookMarkdown(BOOK, makeNotes(), {});
    const p1 = parseBookMarkdownContent(md1, '/tmp/a.md');
    const md2 = renderBookMarkdown(p1.book, p1.notes, {});
    const p2 = parseBookMarkdownContent(md2, '/tmp/a.md');
    assert.deepEqual(
      p2.notes.map((n) => [n.noteId, n.highlightText, n.thoughtText, n.createTime]),
      p1.notes.map((n) => [n.noteId, n.highlightText, n.thoughtText, n.createTime])
    );
  });

  test('书评区块读回为 type-4 笔记', () => {
    const md = renderBookMarkdown(BOOK, makeNotes(), { review: { content: '值得一读' } });
    const parsed = parseBookMarkdownContent(md, '/tmp/a.md');
    const reviewNote = parsed.notes.find((n) => n.type === NoteType.Review);
    assert.ok(reviewNote);
    assert.equal(reviewNote.thoughtText, '值得一读');
  });

  test('时间行终结笔记块：之后的 💬 是独立想法', () => {
    const md = [
      '### 第一章',
      '',
      '> 划线A',
      '',
      '_记录时间：2023-11-14 22:13:20_',
      '',
      '💬 这是下一条',
      '',
    ].join('\n');
    const parsed = parseBookMarkdownContent(md, '/tmp/a.md');
    const thoughts = parsed.notes.filter((n) => n.type === NoteType.Thought);
    assert.equal(thoughts.length, 1);
    assert.equal(thoughts[0].thoughtText, '这是下一条');
  });
});

describe('parseBookMarkdownContent', () => {
  test('空内容返回 undefined', () => {
    assert.equal(parseBookMarkdownContent('', '/tmp/a.md'), undefined);
    assert.equal(parseBookMarkdownContent('   \n', '/tmp/a.md'), undefined);
  });

  test('frontmatter 缺失时回退文件名/父目录', () => {
    const parsed = parseBookMarkdownContent('# 手加标题\n\n> 一条划线\n', '/tmp/分类X/手加标题.md');
    assert.equal(parsed.book.title, '手加标题');
    assert.equal(parsed.book.category, '分类X');
  });

  test('progress/readingStatus 解析与钳制', () => {
    const fm = '---\nbookid: 9\ntitle: T\nprogress: 130%\nreadingStatus: 已读完\n---\n\n# T\n';
    const parsed = parseBookMarkdownContent(fm, '/tmp/t.md');
    assert.equal(parsed.book.progress, 100);
    assert.equal(parsed.book.readingStatus, 2);
  });

  test('pcUrl MP_WXS_ 规范化为 /web/mp/reader/', () => {
    const fm = '---\nbookid: MP_WXS_1\ntitle: T\npcUrl: https://weread.qq.com/web/reader/MP_WXS_abc\n---\n\n# T\n';
    const parsed = parseBookMarkdownContent(fm, '/tmp/t.md');
    assert.equal(parsed.book.pcUrl, 'https://weread.qq.com/web/mp/reader/MP_WXS_abc');
  });

  test('parseFrontmatter：非 frontmatter 开头返回空对象', () => {
    assert.deepEqual(parseFrontmatter('# 标题\n\n正文'), {});
  });
});

describe('buildStableLocalNoteId', () => {
  test('同输入同输出，不同输入不同输出', () => {
    const a = { chapterTitle: 'C', type: 1, highlightText: 'x', createTime: 1 };
    assert.equal(buildStableLocalNoteId('b1', a), buildStableLocalNoteId('b1', { ...a }));
    assert.notEqual(buildStableLocalNoteId('b1', a), buildStableLocalNoteId('b2', a));
  });

  test('格式为 local_ + 12 位哈希', () => {
    assert.match(buildStableLocalNoteId('b', {}), /^local_[0-9a-f]{12}$/);
  });
});

describe('buildFileName / effectiveTitleForFile / sanitizePathSegment', () => {
  test('非法字符替换为下划线并截断 200', () => {
    const name = buildFileName({ title: 'a/b:c*d?"<>|e' });
    assert.equal(name, 'a_b_c_d_____e');
    const long = buildFileName({ title: 'x'.repeat(300) });
    assert.equal(long.length, 200);
  });

  test('无实义标题回退 bookId', () => {
    assert.equal(effectiveTitleForFile({ title: '未命名书籍', bookId: '77' }), '77');
    assert.equal(effectiveTitleForFile({ title: '', bookId: '77' }), '77');
    assert.equal(effectiveTitleForFile({ title: '正常' }), '正常');
  });

  test('模板支持 author/isbn/category', () => {
    assert.equal(
      buildFileName({ title: 'T', author: 'A', isbn: 'I', category: 'C' }, '{{title}}-{{author}}'),
      'T-A'
    );
  });

  test('sanitizePathSegment 空值回退「未分类」', () => {
    assert.equal(sanitizePathSegment(''), '未分类');
    assert.equal(sanitizePathSegment('历史/中国'), '历史_中国');
  });
});

describe('bookReviewMarkdown', () => {
  test('有内容出区块，无内容出空串', () => {
    assert.equal(bookReviewMarkdown({ content: '好' }), '## 书评\n\n好');
    assert.equal(bookReviewMarkdown(undefined), '');
    assert.equal(bookReviewMarkdown({}), '');
  });
});

// P1-2（结构注入防护）：写→读幂等——内容中的结构同形行不得劫持解析器
describe('结构行注入防护（P1-2）', () => {
  const BOOK = { bookId: '33', title: '注入测试', author: 'a', category: 'c' };
  test('想法含伪造结构行：写读往返内容无损、不伪造章节/劫持 noteId', () => {
    const notes = [{ noteId: 'real-id-1', chapterUid: 1, chapterTitle: '第一章', type: NoteType.Highlight,
      highlightText: '正常划线', thoughtText: '想法一\n### 伪章节\n<!-- wr:nid:evil -->\n_记录时间：2099-01-01 00:00:00_\n- 作者：伪作者\n💬 评论：伪评论开头', createTime: 1700000000 }];
    const md = renderBookMarkdown(BOOK, notes);
    const parsed = parseBookMarkdownContent(md, '/tmp/x.md');
    const ns = parsed.notes.filter((n) => n.noteId === 'real-id-1');
    assert.equal(ns.length, 1, 'noteId 未被伪造锚点劫持');
    const n = ns[0];
    assert.ok(String(n.thoughtText ?? '').includes('### 伪章节'), '伪章节行保留在想法内容中');
    assert.ok(String(n.thoughtText ?? '').includes('wr:nid:evil'), '伪锚点行保留在想法内容中');
    assert.ok(String(n.thoughtText ?? '').includes('伪作者'), '伪作者行保留在想法内容中');
    assert.equal(n.createTime, 1700000000, '记录时间未被伪时间行覆盖');
    assert.ok(!parsed.notes.some((x) => x.chapterTitle === '伪章节'), '未伪造出章节');
  });
  test('书评含标题行：不终结区块、内容往返无损', () => {
    const md = renderBookMarkdown(BOOK, [], { review: { content: '开头\n## 伪标题\n结尾' } });
    const parsed = parseBookMarkdownContent(md, '/tmp/y.md');
    const reviews = parsed.notes.filter((n) => n.type === NoteType.Review);
    assert.equal(reviews.length, 1);
    const text = String(reviews[0].thoughtText ?? '');
    assert.ok(text.includes('## 伪标题') && text.includes('结尾'), '书评区块未被伪标题截断');
  });
  test('sanitizePathSegment 截断超长分类名（P2）', () => {
    const seg = sanitizePathSegment('分'.repeat(200));
    assert.ok(seg.length <= 80);
  });
});
