// test/sync.test.js —— 增量 diff/合并纯函数 + 同步流水线（mock 依赖 + 临时目录）
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SyncStatus,
  detectBookChanges,
  generateSyncPlan,
  detectNoteChanges,
  mergeWithLocalNotes,
  isLegacyCopyOf,
  isAbsorbedReviewCopy,
  transformMyReviews,
  mergeReviewsIntoNotes,
  computeReconcile,
  createSyncService,
} from '../lib/sync.js';
import * as markdown from '../lib/markdown.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-sync-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('detectBookChanges / generateSyncPlan', () => {
  test('新书全量需同步，计数变化按字段', () => {
    const diffs = detectBookChanges([], [{ bookId: 'b1', title: 'T', progress: 10, highlightCount: 1, noteCount: 2 }]);
    assert.equal(diffs[0].needsSync, true);
    assert.deepEqual(diffs[0].changes, { progressChanged: true, highlightCountChanged: true, noteCountChanged: true });

    const d2 = detectBookChanges(
      [{ bookId: 'b1', progress: 10, highlightCount: 1, noteCount: 2 }],
      [{ bookId: 'b1', title: 'T', progress: 20, highlightCount: 1, noteCount: 2 }]
    );
    assert.equal(d2[0].needsSync, true);
    assert.deepEqual(d2[0].changes, { progressChanged: true, highlightCountChanged: false, noteCountChanged: false });

    const d3 = detectBookChanges(
      [{ bookId: 'b1', progress: 10, highlightCount: 1, noteCount: 2 }],
      [{ bookId: 'b1', title: 'T', progress: 10, highlightCount: 1, noteCount: 2 }]
    );
    assert.equal(d3[0].needsSync, false);
  });

  test('本地独有书不产生 diff（远端已删不跟随）', () => {
    const diffs = detectBookChanges([{ bookId: 'local-only' }], []);
    assert.deepEqual(diffs, []);
  });

  test('generateSyncPlan 只保留需同步书', () => {
    const remote = [{ bookId: 'a' }, { bookId: 'b' }];
    const diffs = [
      { bookId: 'a', needsSync: true },
      { bookId: 'b', needsSync: false },
    ];
    const plan = generateSyncPlan(diffs, remote);
    assert.deepEqual(plan.booksToSync.map((b) => b.bookId), ['a']);
    assert.equal(plan.totalBooks, 1);
  });
});

describe('detectNoteChanges', () => {
  test('新增/修改/删除三分类', () => {
    const local = [{ noteId: '1', highlightText: 'a' }, { noteId: '2', highlightText: 'b' }];
    const remote = [{ noteId: '1', highlightText: 'a' }, { noteId: '2', highlightText: 'b!' }, { noteId: '3' }];
    const r = detectNoteChanges(local, remote);
    assert.deepEqual(r.added.map((n) => n.noteId), ['3']);
    assert.deepEqual(r.modified.map((n) => n.noteId), ['2']);
    assert.deepEqual(r.deleted.map((n) => n.noteId), []);
  });

  test('markdown 往返（modifyTime 单侧 undefined）不误报 modified', () => {
    const local = [{ noteId: '1', highlightText: 'a', createTime: 100 }]; // 读回无 modifyTime
    const remote = [{ noteId: '1', highlightText: 'a', createTime: 100, modifyTime: 999 }];
    const r = detectNoteChanges(local, remote);
    assert.deepEqual(r.modified, []);
  });

  test('远端带回真实 createTime 且与本地不符 → modified（时间修复）', () => {
    const local = [{ noteId: '1', highlightText: 'a', createTime: 0 }];
    const remote = [{ noteId: '1', highlightText: 'a', createTime: 1700000000 }];
    const r = detectNoteChanges(local, remote);
    assert.deepEqual(r.modified.map((n) => n.noteId), ['1']);
  });
});

describe('mergeWithLocalNotes', () => {
  test('远端为空保留全部本地（资产自持有）', () => {
    const local = [{ noteId: 'l1' }];
    assert.deepEqual(mergeWithLocalNotes(local, []), local);
  });

  test('本地为空直接用远端', () => {
    const remote = [{ noteId: 'r1' }];
    assert.deepEqual(mergeWithLocalNotes([], remote), remote);
  });

  test('本地较新胜出，但 createTime 以远端为权威修复', () => {
    const local = { noteId: '1', highlightText: '本地编辑', modifyTime: 2000, createTime: 999 };
    const remote = { noteId: '1', highlightText: '旧', modifyTime: 1000, createTime: 1700000000 };
    const merged = mergeWithLocalNotes([local], [remote]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].highlightText, '本地编辑');
    assert.equal(merged[0].createTime, 1700000000);
  });

  test('远端较新胜出；local-only 笔记保留', () => {
    const local = [
      { noteId: '1', highlightText: '旧', modifyTime: 100 },
      { noteId: 'hand', highlightText: '手加', modifyTime: 50 },
    ];
    const remote = [{ noteId: '1', highlightText: '新', modifyTime: 200 }];
    const merged = mergeWithLocalNotes(local, remote);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].highlightText, '新');
    assert.equal(merged[1].noteId, 'hand');
  });
});

describe('transformMyReviews', () => {
  test('range/chapterName 分类归一', () => {
    const r = transformMyReviews([
      { review: { reviewId: 'a', content: '划线想法', range: '1-2', abstract: '原文', createTime: 100 } },
      { reviewId: 'b', content: '章节点评', chapterName: '第一章', createTime: 200 },
      { reviewId: 'c', content: '整本书评一', createTime: 100 },
      { reviewId: 'd', content: '整本书评二', createTime: 300 },
      { review: { reviewId: 'e', content: '' } }, // 空内容丢弃
      'garbage', // 非对象丢弃
    ], 'book1');
    assert.equal(r.attached.length, 1);
    assert.equal(r.attached[0].reviewId, 'a');
    assert.equal(r.chapterComments.length, 1);
    assert.equal(r.bookReviews.length, 2);
    assert.equal(r.bookReviews[0].reviewId, 'd', '书评按时间降序（最新在前）');
    assert.equal(r.attached[0].bookId, 'book1');
    assert.equal(r.attached[0].isFinish, false);
  });

  test('空/非数组输入', () => {
    const r = transformMyReviews(undefined, 'b');
    assert.deepEqual(r, { attached: [], chapterComments: [], bookReviews: [] });
  });
});

describe('mergeReviewsIntoNotes', () => {
  test('attached 按 range/abstract 命中既有划线补 thoughtText', () => {
    const notes = [{ noteId: 'n1', range: '1-2', highlightText: '原文', type: 1, createTime: 100 }];
    const transformed = { attached: [{ reviewId: 'r1', bookId: 'b', content: '想法', range: '1-2', abstract: '原文', createTime: 500 }], chapterComments: [], bookReviews: [] };
    const { notes: merged, bookReview } = mergeReviewsIntoNotes(notes, transformed);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].thoughtText, '想法');
    assert.equal(bookReview, null);
  });

  test('未命中 attached 与 chapterComments 各成独立想法笔记', () => {
    const transformed = {
      attached: [{ reviewId: 'r1', bookId: 'b', content: '独想', abstract: '孤儿划线原文', createTime: 1 }],
      chapterComments: [{ reviewId: 'r2', bookId: 'b', content: '章节想法', chapterName: '第二章', createTime: 2 }],
      bookReviews: [{ reviewId: 'r3', bookId: 'b', content: '书评', createTime: 3 }],
    };
    const { notes, bookReview } = mergeReviewsIntoNotes([], transformed, { chapterTitleByUid: new Map([[9, '映射章']]) });
    assert.equal(notes.length, 2);
    assert.equal(notes[0].noteId, 'r1');
    assert.equal(notes[0].type, 2);
    assert.equal(notes[0].highlightText, '孤儿划线原文');
    assert.equal(notes[1].chapterTitle, '第二章');
    assert.equal(bookReview.reviewId, 'r3');
  });

  test('不修改入参数组（拷贝语义）', () => {
    const notes = [{ noteId: 'n1', range: '1', type: 1, createTime: 1 }];
    mergeReviewsIntoNotes(notes, { attached: [{ reviewId: 'r', content: 'c', range: '1', createTime: 9 }], chapterComments: [], bookReviews: [] });
    assert.equal(notes[0].thoughtText, undefined);
  });
});

describe('computeReconcile', () => {
  test('对账差异与排序', () => {
    const notebooks = [
      { bookId: 'b1', book: { title: '书1' }, noteCount: 5, reviewCount: 0 }, // expected 5 vs local 3 → diff 2
      { bookId: 'b2', book: { title: '书2' }, noteCount: 2, reviewCount: 3 }, // expected 5 vs local 5 → 一致
      { bookId: 'b3', book: { title: '书3' }, noteCount: 0, reviewCount: 0 }, // expected 0 跳过
    ];
    const localCounts = [{ bookId: 'b1', localCount: 3 }, { bookId: 'b2', localCount: 5 }];
    const r = computeReconcile(notebooks, localCounts);
    assert.equal(r.checked, 2);
    assert.equal(r.mismatchedCount, 1);
    assert.equal(r.mismatched[0].diff, 2);
    assert.deepEqual([r.localHigherCount, r.localLowerCount], [0, 1], '方向：本地少于服务端（可能漏采）');
  });

  test('空输入', () => {
    assert.deepEqual(computeReconcile([], []), { checked: 0, mismatchedCount: 0, mismatched: [], localHigherCount: 0, localLowerCount: 0 });
  });

  test('方向计数在截断之前数完：明细只留差值最大的 50 条，样本是有偏的', () => {
    const notebooks = [
      ...Array.from({ length: 60 }, (_, i) => ({ bookId: `h${i}`, book: { title: `偏多${i}` }, noteCount: 1, reviewCount: 0 })), // 本地 11 → 偏多，差值 10
      ...Array.from({ length: 5 }, (_, i) => ({ bookId: `l${i}`, book: { title: `漏采${i}` }, noteCount: 3, reviewCount: 0 })), // 本地 2 → 漏采，差值 1
    ];
    const localCounts = [
      ...Array.from({ length: 60 }, (_, i) => ({ bookId: `h${i}`, localCount: 11 })),
      ...Array.from({ length: 5 }, (_, i) => ({ bookId: `l${i}`, localCount: 2 })),
    ];
    const r = computeReconcile(notebooks, localCounts);
    assert.equal(r.mismatchedCount, 65);
    assert.equal(r.mismatched.length, 50, '明细截断到 50 条');
    assert.ok(r.mismatched.every((m) => m.local > m.expected), '前置：截断后的样本全是本地偏多（差值大的排前面）');
    assert.deepEqual([r.localHigherCount, r.localLowerCount], [60, 5], '方向按全量数：60 本偏多、5 本漏采——不能让样本把漏采说没');
  });
});

// ---------------- 同步流水线（mock + 临时目录） ----------------

function makeStore() {
  const state = new Map();
  const meta = { accounts: [], activeAccountId: 'acc1', userInfo: undefined };
  return {
    getActiveAccountId: () => meta.activeAccountId,
    getState: (acc, key, fb) => (state.has(`${acc}|${key}`) ? state.get(`${acc}|${key}`) : fb),
    setState: (acc, key, value) => state.set(`${acc}|${key}`, value),
    getApiKey: () => undefined,
    getCookies: () => 'wr_vid=1; wr_skey=x',
  };
}

function fullBook(bookId, extra = {}) {
  return {
    bookId,
    title: `书${bookId}`,
    author: '作者',
    progress: 50,
    readingStatus: 1,
    highlightCount: 1,
    noteCount: 1,
    reviewCount: 0,
    category: '科技',
    isbn: '978-1',
    publisher: '社',
    intro: '简介',
    pcUrl: 'https://weread.qq.com/web/reader/ce32f7f05xx', // 非 rawId 形态 → 不触发元数据刷新
    ...extra,
  };
}

function notesDataFor(items) {
  return { updated: items, chapters: [{ chapterUid: 1, title: '第一章' }] };
}

function makeService({ books, notesData, shelfError }) {
  const store = makeStore();
  const notesByBook = new Map();
  const api = {
    getShelfList: async () => {
      if (shelfError) throw shelfError; // v1.9.8：注入书架拉取失败（401 登录过期 / 网络错）
      return { books: books.map((b) => ({ book: b })) };
    },
    getArticleBooks: async () => [],
    getBookNotes: async (bookId) => {
      const items = notesData.get(bookId) || [];
      return notesDataFor(items);
    },
    getBookInfo: async (bookId) => { throw new Error('不应触网: getBookInfo ' + bookId); },
    getWebReviewListMine: async () => ({ reviews: [] }),
    transformNotes: (data, bookId) => data.updated.map((it) => ({
      noteId: it.bookmarkId, bookId, chapterUid: 1, chapterTitle: '第一章', type: 1,
      highlightText: it.markText, createTime: it.createTime, modifyTime: it.modifyTime,
    })),
    buildPcUrl: () => 'https://weread.qq.com/web/reader/x',
  };
  const index = {
    queryBooks: async () => {
      const out = [];
      for (const [file, bookId] of exported) {
        const parsed = markdown.parseBookMarkdownContent(fs.readFileSync(file, 'utf8'), file);
        out.push({ ...parsed.book, bookId, ...parsed.book });
      }
      return out;
    },
    getNotesByBookId: async (bookId) => notesByBook.get(bookId) || [],
    getBookById: async () => undefined,
    rebuildFromConfiguredPath: async () => {},
  };
  const exported = []; // [{file, bookId}] 模拟索引读回
  const svc = createSyncService({
    api,
    store,
    index,
    markdown,
    log: () => {},
    configGetter: () => ({ outputPath: dir }),
  });
  return { svc, store, exported, books };
}

describe('runSync 失败 loginExpired 打标（v1.9.8）', () => {
  test('401/登录过期失败 → syncState.loginExpired=true', async () => {
    const e = new Error('登录已过期，请重新登录');
    e.statusCode = 401;
    const { svc, store } = makeService({ books: [], notesData: new Map(), shelfError: e });
    const r = await svc.incrementalSync('acc1');
    assert.equal(r.success, false);
    assert.equal(r.error, '登录已过期，请重新登录');
    const st = store.getState('acc1', 'syncState', {});
    assert.equal(st.status, SyncStatus.Failed);
    assert.equal(st.loginExpired, true, '登录类失败须打标（客户端凭此在重登后隐藏陈旧横幅）');
  });

  test('消息含「登录已过期」但无 statusCode → 同样打标（包装重抛兜底）', async () => {
    const { svc, store } = makeService({ books: [], notesData: new Map(), shelfError: new Error('登录已过期，请重新登录') });
    await svc.incrementalSync('acc1');
    assert.equal(store.getState('acc1', 'syncState', {}).loginExpired, true);
  });

  test('非登录失败（网络错）→ 不打标', async () => {
    const { svc, store } = makeService({ books: [], notesData: new Map(), shelfError: new Error('网络请求失败，请检查网络连接') });
    await svc.incrementalSync('acc1');
    const st = store.getState('acc1', 'syncState', {});
    assert.equal(st.status, SyncStatus.Failed);
    assert.notEqual(st.loginExpired, true);
  });

  test('成功轮次清掉历史 loginExpired 标记', async () => {
    const { svc, store } = makeService({ books: [], notesData: new Map() });
    // 预置一轮登录失败的残留状态，随后同步成功 → 非 Failed 终态应清标
    store.setState('acc1', 'syncState', { status: SyncStatus.Failed, error: '登录已过期，请重新登录', loginExpired: true, lastSyncTime: 0, dataVersion: 1 });
    const r = await svc.incrementalSync('acc1');
    assert.equal(r.success, true);
    const st = store.getState('acc1', 'syncState', {});
    assert.equal(st.status, SyncStatus.Success);
    assert.equal(st.loginExpired, undefined, '非 Failed 终态清除标记');
  });

  test('取消终态也清掉 loginExpired 标记（灰条不携带过期语义）', async () => {
    const books = [fullBook('b1')];
    const notesData = new Map(books.map((b) => [b.bookId, [{ bookmarkId: `${b.bookId}-n1`, markText: 'x', createTime: 1700000000, modifyTime: 1700000000 }]]));
    const { svc, store } = makeService({ books, notesData });
    store.setState('acc1', 'syncState', { status: SyncStatus.Failed, error: '登录已过期，请重新登录', loginExpired: true, lastSyncTime: 0, dataVersion: 1 });
    svc.requestCancel('acc1'); // 预置取消：首个书边界即转 cancelled 终态
    const r = await svc.incrementalSync('acc1');
    assert.equal(r.cancelled, true);
    const st = store.getState('acc1', 'syncState', {});
    assert.equal(st.status, SyncStatus.Cancelled);
    assert.equal(st.loginExpired, undefined, '取消终态同样清标');
  });
});

describe('runSync 增量合并与取消', () => {
  test('首轮全量写盘，二轮同数据零更新（增量幂等）', async () => {
    const b1 = fullBook('b1');
    const notesData = new Map([['b1', [{ bookmarkId: 'n1', markText: '划线一', createTime: 1700000000, modifyTime: 1700000000 }]]]);
    const { svc, exported } = makeService({ books: [b1], notesData });

    const r1 = await svc.incrementalSync('acc1');
    assert.equal(r1.success, true);
    assert.equal(r1.syncedBooks, 1);

    const mdFile = path.join(dir, 'accounts', 'acc1', '科技', '书b1.md');
    assert.ok(fs.existsSync(mdFile), '写出 markdown');
    const parsed = markdown.parseBookMarkdownContent(fs.readFileSync(mdFile, 'utf8'), mdFile);
    assert.equal(parsed.notes.length, 1);
    assert.equal(parsed.notes[0].highlightText, '划线一');
    exported.push([mdFile, 'b1']); // 索引可见

    const r2 = await svc.incrementalSync('acc1');
    assert.equal(r2.success, true);
    assert.equal(r2.syncedBooks, 0, '数据未变 → 无更新');
    // 文件内容不变（时间戳字段幂等）
    assert.equal(fs.readFileSync(mdFile, 'utf8').includes('划线一'), true);
  });

  test('远端新增划线 → 增量合并写盘', async () => {
    const b1 = fullBook('b1', { highlightCount: 1, noteCount: 1 });
    const notesData = new Map([['b1', [{ bookmarkId: 'n1', markText: '第一条', createTime: 1700000000, modifyTime: 1700000000 }]]]);
    const { svc, exported } = makeService({ books: [b1], notesData });
    await svc.incrementalSync('acc1');
    const mdFile = path.join(dir, 'accounts', 'acc1', '科技', '书b1.md');
    exported.push([mdFile, 'b1']);

    // 远端多了一条划线，计数 +1
    notesData.set('b1', [
      { bookmarkId: 'n1', markText: '第一条', createTime: 1700000000, modifyTime: 1700000000 },
      { bookmarkId: 'n2', markText: '第二条', createTime: 1700003600, modifyTime: 1700003600 },
    ]);
    b1.highlightCount = 2; b1.noteCount = 2;
    const r3 = await svc.incrementalSync('acc1');
    assert.equal(r3.syncedBooks, 1);
    const parsed = markdown.parseBookMarkdownContent(fs.readFileSync(mdFile, 'utf8'), mdFile);
    assert.equal(parsed.notes.length, 2);
  });

  test('软取消：requestCancel 后本轮 cancelled 终态', async () => {
    const books = [fullBook('b1'), fullBook('b2'), fullBook('b3')];
    const notesData = new Map(books.map((b) => [b.bookId, [{ bookmarkId: `${b.bookId}-n1`, markText: 'x', createTime: 1700000000, modifyTime: 1700000000 }]]));
    const { svc, store } = makeService({ books, notesData });
    svc.requestCancel('acc1'); // 预置取消：worker 在首个书边界即发现
    const r = await svc.incrementalSync('acc1');
    assert.equal(r.success, false);
    assert.equal(r.cancelled, true);
    assert.equal(store.getState('acc1', 'syncState', {}).status, SyncStatus.Cancelled);
  });

  test('无活跃账号直接失败', async () => {
    const { svc } = makeService({ books: [], notesData: new Map() });
    // makeStore 固定 acc1，这里换一个空 store 场景：直接调 fullSync 空账号由 resolveAccountId 兜底
    const r = await svc.fullSync('acc1');
    assert.equal(typeof r.success, 'boolean');
  });

  test('并发互斥：同步中再入返回错误', async () => {
    const b1 = fullBook('b1');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const notesData = new Map();
    const store = makeStore();
    const api = {
      getShelfList: async () => { await gate; return { books: [{ book: b1 }] }; },
      getArticleBooks: async () => [],
      getBookNotes: async () => ({ updated: [], chapters: [] }),
      transformNotes: () => [],
      buildPcUrl: () => 'https://weread.qq.com/web/reader/x',
    };
    const svc = createSyncService({
      api, store, index: { queryBooks: async () => [], getNotesByBookId: async () => [], rebuildFromConfiguredPath: async () => {} },
      markdown, log: () => {}, configGetter: () => ({ outputPath: dir }),
    });
    const first = svc.fullSync('acc1');
    assert.equal(svc.isSyncingInProgress('acc1'), true);
    const second = await svc.fullSync('acc1');
    assert.equal(second.success, false);
    assert.match(second.error, /同步正在进行中/);
    release();
    const r = await first;
    assert.equal(r.success, true);
  });
});

// v1.9.19：把不在本地库的书即时导入（「问 DSH」默认带上当前在读这本书的笔记——用户确认的方案 A）
describe('importBook', () => {
  const INFO = { bookId: 'nb1', title: '新书', author: '甲', cover: 'c', category: '文学', intro: '简介', progress: 20, readingStatus: 1, pcUrl: 'https://weread.qq.com/web/reader/nb1' };
  const mkNotes = (n) => Array.from({ length: n }, (_, i) => ({ bookmarkId: `bm${i + 1}`, markText: `划线${i + 1}`, createTime: i + 1 }));
  // 输出目录按账号/分类分层（accounts/<账号>/<分类>/…），须递归找
  const listMd = (d) => { const walk = (x) => { let o = []; try { for (const f of fs.readdirSync(x)) { const p = path.join(x, f); if (fs.statSync(p).isDirectory()) o.push(...walk(p)); else if (f.endsWith('.md') && !f.startsWith('._')) o.push(p); } } catch { /* 目录不存在 */ } return o; }; return walk(d); };
  function makeWorld({ localBooks = [], notesByBook = new Map(), reviews = [], bookInfo, bookInfoError = null, outputPath, notesGate = null } = {}) {
    const store = makeStore();
    const calls = { notes: [], info: 0 };
    const api = {
      getShelfList: async () => ({ books: [] }),
      getArticleBooks: async () => [],
      getBookNotes: async (bookId) => { calls.notes.push(bookId); if (notesGate) await notesGate; return notesDataFor(notesByBook.get(bookId) || []); },
      getBookInfo: async () => { calls.info += 1; if (bookInfoError) throw bookInfoError; return bookInfo; },
      getWebReviewListMine: async () => ({ reviews }),
      transformNotes: (data, bookId) => data.updated.map((it) => ({ noteId: it.bookmarkId, bookId, chapterUid: 1, chapterTitle: '第一章', type: 1, highlightText: it.markText, createTime: it.createTime })),
      buildPcUrl: () => 'https://weread.qq.com/web/reader/x',
    };
    const index = {
      queryBooks: async () => localBooks,
      getNotesByBookId: async (bookId) => localBooks.find((b) => b.bookId === bookId)?.notes || [],
      getBookById: async (bookId) => localBooks.find((b) => b.bookId === bookId),
      rebuildFromConfiguredPath: async () => {},
    };
    const svc = createSyncService({ api, store, index, markdown, log: () => {}, configGetter: () => (outputPath ? { outputPath } : {}) });
    return { svc, store, calls, out: outputPath };
  }

  test('本地没有 + 远端有划线 → 导出进库（真实 Markdown，可解析回书 ID/书名）', async () => {
    const out = path.join(dir, 'notes');
    const w = makeWorld({ notesByBook: new Map([['nb1', mkNotes(2)]]), bookInfo: INFO, outputPath: out });
    const r = await w.svc.importBook('nb1', 'acc1');
    assert.deepEqual([r.imported, r.notesCount, r.reason], [true, 2, undefined]);
    assert.ok(r.filePath && r.filePath.endsWith('.md'));
    const files = listMd(out);
    assert.equal(files.length, 1, '恰好生成一个笔记文件');
    const content = fs.readFileSync(files[0], 'utf8');
    assert.match(content, /nb1/, '文件里带书 ID（索引据此可按 ID 命中）');
    assert.match(content, /新书/); assert.match(content, /甲/); assert.match(content, /划线1/); assert.match(content, /划线2/);
    assert.deepEqual(w.calls.notes, ['nb1'], '只拉了这一本书的笔记');
    assert.equal(w.calls.info, 1, '书详情取一次');
    assert.equal(w.svc.isSyncingInProgress('acc1'), false, '导入后释放互斥');
    const parsed = markdown.parseBookMarkdownContent(content, files[0]);
    const age = Math.abs(Date.now() / 1000 - Number(parsed.book.lastReadTime));
    assert.ok(Number.isFinite(Number(parsed.book.lastReadTime)) && age < 3600, `最近阅读时间应是「刚才」（秒级时间戳；首版误用毫秒渲染出 58871 年）：${parsed.book.lastReadTime}`);
    assert.doesNotMatch(content, /undefined/, 'frontmatter 不得出现 undefined（如 progress: undefined%）');
  });

  test('远端没有任何划线/想法 → 不导出（本地库只收有笔记的书，不制造空文件）', async () => {
    const out = path.join(dir, 'notes');
    const w = makeWorld({ notesByBook: new Map([['nb1', []]]), bookInfo: INFO, outputPath: out });
    const r = await w.svc.importBook('nb1', 'acc1');
    assert.deepEqual([r.imported, r.reason], [false, 'no-notes']);
    assert.deepEqual(listMd(out), [], '没有生成文件');
    assert.equal(w.calls.info, 0, '没笔记就不必再取书详情');
  });

  test('只有整本书评、没有划线 → 仍导入（书评是独立通道）', async () => {
    const out = path.join(dir, 'notes');
    const w = makeWorld({ reviews: [{ reviewId: 'c', content: '整本书评一', createTime: 100 }], bookInfo: INFO, outputPath: out });
    const r = await w.svc.importBook('nb1', 'acc1');
    assert.equal(r.imported, true);
    const files = listMd(out);
    assert.equal(files.length, 1);
    assert.match(fs.readFileSync(files[0], 'utf8'), /整本书评一/, '书评写进了文件');
  });

  test('已在本地库 → 交给 syncBook 更新，不重复导入、不取书详情', async () => {
    const out = path.join(dir, 'notes');
    const w = makeWorld({ localBooks: [{ bookId: 'nb1', title: '旧书', notes: [] }], notesByBook: new Map([['nb1', mkNotes(1)]]), bookInfo: INFO, outputPath: out });
    const r = await w.svc.importBook('nb1', 'acc1');
    assert.equal(r.imported, false); assert.equal(r.alreadyLocal, true); assert.equal(r.notesCount, 1);
    assert.equal(w.calls.notes.length, 1, '走 syncBook 更新（取一次笔记），不另起一套拉取');
    assert.equal(listMd(out).length, 1, '是「更新既有书」而非重复导入出第二份文件');
  });

  test('未配置输出目录 → 不导入，且不发任何网络请求', async () => {
    const w = makeWorld({ notesByBook: new Map([['nb1', mkNotes(1)]]), bookInfo: INFO, outputPath: undefined });
    const r = await w.svc.importBook('nb1', 'acc1');
    assert.deepEqual([r.imported, r.reason], [false, 'no-output-path']);
    assert.deepEqual(w.calls.notes, [], '导出必然失败，不该白费请求');
  });

  test('书详情接口失败 → 退化用页面书名，导入不因元数据缺失而失败', async () => {
    const out = path.join(dir, 'notes');
    const w = makeWorld({ notesByBook: new Map([['nb1', mkNotes(1)]]), bookInfoError: new Error('boom'), outputPath: out });
    const r = await w.svc.importBook('nb1', 'acc1', { fallbackTitle: '页面上的书名' });
    assert.equal(r.imported, true);
    assert.match(fs.readFileSync(listMd(out)[0], 'utf8'), /页面上的书名/);
  });

  test('与在飞的导入互斥：第二本返回 busy，不并发', async () => {
    let release; const gate = new Promise((res) => { release = res; });
    const out = path.join(dir, 'notes');
    const w = makeWorld({ notesByBook: new Map([['nb1', mkNotes(1)], ['nb2', mkNotes(1)]]), bookInfo: INFO, outputPath: out, notesGate: gate });
    const first = w.svc.importBook('nb1', 'acc1');
    await new Promise((r) => setTimeout(r, 20)); // 让第一本走到取笔记处挂起
    assert.equal(w.svc.isSyncingInProgress('acc1'), true, '导入期间视同同步中');
    const second = await w.svc.importBook('nb2', 'acc1');
    assert.deepEqual([second.imported, second.reason], [false, 'busy']);
    release();
    const r1 = await first;
    assert.equal(r1.imported, true, '第一本正常完成');
    assert.equal(w.svc.isSyncingInProgress('acc1'), false);
  });

  test('导出失败 → 抛错且释放互斥（不把账号卡在「同步中」）', async () => {
    const notADir = path.join(dir, 'file.txt'); fs.writeFileSync(notADir, 'x'); // 输出路径是个文件 → mkdir 失败
    const w = makeWorld({ notesByBook: new Map([['nb1', mkNotes(1)]]), bookInfo: INFO, outputPath: notADir });
    await assert.rejects(() => w.svc.importBook('nb1', 'acc1'));
    assert.equal(w.svc.isSyncingInProgress('acc1'), false, '失败路径也释放互斥');
  });

  test('空书 ID → no-book-id，不触网', async () => {
    const w = makeWorld({ notesByBook: new Map([['', mkNotes(1)]]), bookInfo: INFO, outputPath: path.join(dir, 'n') });
    const r = await w.svc.importBook('', 'acc1');
    assert.deepEqual([r.imported, r.reason], [false, 'no-book-id']);
    assert.deepEqual(w.calls.notes, []);
  });
});

// v1.9.20：同一条笔记的「旧形态副本」不再按 local-only 保留
// 真机现象：25 本书 59 条重复副本，同步对账 25/25 本「本地 = 2×服务端」，界面却提示「可能漏采」。
describe('v1.9.20 重复笔记识别', () => {
  const BOOK = {
    bookId: 'B1', rawBookId: 'B1', title: '去重书', author: '甲', category: '科技', progress: 18,
    isbn: '978-0-00-000000-0', publisher: '社', intro: '简介', // 元数据齐全 → 不触发元数据刷新
    pcUrl: 'https://weread.qq.com/web/reader/ce32f7f05xx', // 非 rawId 形态 → 同上
  };
  const REMOTE = [
    { noteId: 'B1_3_637-648', bookId: 'B1', chapterUid: 3, chapterTitle: '一', type: 1, highlightText: '划线甲', createTime: 1794206332, modifyTime: 1794206332 },
    { noteId: 'B1_3_1360-1384', bookId: 'B1', chapterUid: 3, chapterTitle: '一', type: 1, highlightText: '划线乙\n第二行', createTime: 1794205716, modifyTime: 1794205716 },
  ];
  const HASH_ID = /^local_[0-9a-f]{12}$/;
  const ids = (notes) => notes.map((n) => n.noteId);
  /** v1.8.5-batch2 之前的文件长什么样：渲染器不给 local_pending ID 出锚点 → 读回全是内容哈希 ID */
  const legacyFile = (notes) => markdown.renderBookMarkdown({ ...BOOK, noteCount: notes.length }, notes.map((n, i) => ({ ...n, noteId: `local_pending_${i}` })), {});
  const legacyNotes = (notes) => markdown.parseBookMarkdownContent(legacyFile(notes), path.join(dir, 'legacy.md')).notes;
  const remoteItems = REMOTE.map((n) => ({ bookmarkId: n.noteId, markText: n.highlightText, createTime: n.createTime, modifyTime: n.modifyTime }));

  /** 真实文件 + 索引直接从磁盘解析的流水线世界 */
  function makeWorld({ items, reviews = [], counts = {}, gateway, apiKey }) {
    const mdFile = path.join(dir, 'accounts', 'acc1', '科技', '去重书.md');
    const read = () => markdown.parseBookMarkdownContent(fs.readFileSync(mdFile, 'utf8'), mdFile);
    const api = {
      getShelfList: async () => ({ books: [{ book: { ...BOOK, highlightCount: 2, noteCount: 2, reviewCount: 0, ...counts } }] }),
      getArticleBooks: async () => [],
      getBookNotes: async () => notesDataFor(items),
      getBookInfo: async (bookId) => { throw new Error('不应触网: getBookInfo ' + bookId); },
      getWebReviewListMine: async () => ({ reviews }),
      transformNotes: (data, bookId) => data.updated.map((it) => ({
        noteId: it.bookmarkId, bookId, chapterUid: 1, chapterTitle: '一', type: 1,
        highlightText: it.markText, createTime: it.createTime, modifyTime: it.modifyTime,
      })),
      buildPcUrl: () => 'https://weread.qq.com/web/reader/x',
    };
    const store = makeStore();
    if (apiKey) store.getApiKey = () => apiKey; // 官方通道已绑定 → 网关在场
    const index = {
      queryBooks: async () => [{ ...read().book }],
      getNotesByBookId: async () => read().notes,
      getBookById: async () => ({ ...read().book }),
      rebuildFromConfiguredPath: async () => {},
    };
    const svc = createSyncService({ api, store, index, markdown, log: () => {}, configGetter: () => ({ outputPath: dir }), ...(gateway ? { gateway } : {}) });
    return {
      svc, store, mdFile, read,
      write: (content) => { fs.mkdirSync(path.dirname(mdFile), { recursive: true }); fs.writeFileSync(mdFile, content); },
    };
  }

  test('前置：旧格式文件没有锚点，读回是内容哈希 ID（永远对不上远端的 bookmarkId）', () => {
    const legacy = legacyNotes(REMOTE);
    assert.doesNotMatch(legacyFile(REMOTE), /wr:nid:/);
    assert.equal(legacy.length, 2);
    assert.ok(legacy.every((n) => HASH_ID.test(n.noteId)), `实际：${ids(legacy).join(', ')}`);
    assert.equal(isLegacyCopyOf(legacy[0], REMOTE), true);
    assert.equal(isLegacyCopyOf(REMOTE[0], REMOTE), false, '带锚点的笔记不参与副本判定');
    assert.equal(isLegacyCopyOf(null, REMOTE), false);
    assert.equal(isAbsorbedReviewCopy({ noteId: 'rv1', thoughtText: 'x' }, null), false, '本轮没拉想法 → 不动本地笔记');
  });

  test('旧文件对上远端：不再两套都写盘（原版哈希 ID 对不上 bookmarkId，笔记整套翻倍）', () => {
    assert.deepEqual(ids(mergeWithLocalNotes(legacyNotes(REMOTE), REMOTE)), ids(REMOTE));
  });

  test('存量翻倍的文件（带锚点一套 + 哈希一套）一轮合并自愈，只剩带锚点的一套', () => {
    const legacy = legacyNotes(REMOTE);
    const merged = mergeWithLocalNotes([...legacy, ...REMOTE], REMOTE);
    assert.deepEqual(ids(merged), ids(REMOTE));
    assert.ok(merged.every((n) => REMOTE.includes(n)), '保留的是远端对象（内容以远端为准）');
  });

  test('手加笔记保留（哈希 ID，但内容不在远端）', () => {
    const manual = { noteId: markdown.buildStableLocalNoteId('B1', { chapterTitle: '一', type: 1, highlightText: '我手加的', createTime: 1 }), type: 1, chapterTitle: '一', highlightText: '我手加的', createTime: 1 };
    assert.ok(HASH_ID.test(manual.noteId), '前置：手加笔记读回同样是哈希 ID');
    const merged = mergeWithLocalNotes([...legacyNotes(REMOTE), manual], REMOTE);
    assert.equal(merged.length, 3);
    assert.ok(merged.includes(manual));
  });

  test('本地改过的旧副本保留（内容已不同 = 用户资产，不是副本）', () => {
    const edited = { ...legacyNotes(REMOTE)[0], highlightText: '划线甲（我改过）' };
    const merged = mergeWithLocalNotes([...legacyNotes(REMOTE).slice(1), edited], REMOTE);
    assert.equal(merged.length, 3);
    assert.ok(merged.includes(edited));
  });

  test('文本相同但双方记录时间不同 → 是两条笔记，不判副本', () => {
    const sameTextOtherTime = { ...legacyNotes(REMOTE)[0], createTime: REMOTE[0].createTime + 60 };
    assert.equal(mergeWithLocalNotes([sameTextOtherTime], REMOTE).length, 3);
  });

  test('任一侧没有记录时间 → 不判副本（哈希 ID 分不出旧文件副本和手加/远端已删的笔记，宁保留）', () => {
    const legacy = legacyNotes(REMOTE);
    const remoteNoTime = REMOTE.map((n) => ({ ...n, createTime: 0 })); // web 新管线划线缺 createTime
    const keptBoth = mergeWithLocalNotes([legacy[0]], remoteNoTime);
    assert.equal(keptBoth.length, 3, '副本有时间、保留笔记没有 → 远端 2 条 + 这条副本都留着');
    assert.equal(keptBoth[0].createTime, 0, '不把副本的时间安到保留笔记上（旧文件里的时间多半是早期版本的同步时刻；v1.8.15 起不伪造创建时间）');
    assert.equal(remoteNoTime[0].createTime, 0, '不改入参对象');
    assert.equal(mergeWithLocalNotes([{ ...legacy[0], createTime: 0 }], REMOTE).length, 3, '副本没有时间、保留笔记有 → 保留');
    assert.equal(mergeWithLocalNotes([{ ...legacy[0], createTime: 0 }], remoteNoTime).length, 3, '两侧都没有记录时间（web 新管线划线的旧文件翻倍）→ 同样不判副本，等远端带回真实时间再清');
  });

  test('同一句话划了两次、远端没有记录时间、其中一条远端已删 → 两条都保留', () => {
    const [twin] = legacyNotes(REMOTE);
    const stillRemote = { ...twin, createTime: 1700000001 };
    const deletedRemote = { ...twin, createTime: 1700000999 };
    assert.equal(mergeWithLocalNotes([stillRemote, deletedRemote], [{ ...REMOTE[0], createTime: 0 }]).length, 3);
  });

  test('手加笔记与远端划线同文、没写记录时间 → 保留', () => {
    const manual = { noteId: markdown.buildStableLocalNoteId('B1', { chapterTitle: '一', type: 1, highlightText: '划线甲' }), type: 1, chapterTitle: '一', highlightText: '划线甲', createTime: 0 };
    const merged = mergeWithLocalNotes([manual], REMOTE);
    assert.equal(merged.length, 3);
    assert.ok(merged.includes(manual));
  });

  test('空白归一：副本与保留笔记只差空白/换行 → 仍是副本（写盘→读回的格式差异不算内容不同）', () => {
    const variant = { ...legacyNotes(REMOTE)[1], highlightText: `  ${REMOTE[1].highlightText.replace('\n', '   ')}  ` };
    assert.deepEqual(ids(mergeWithLocalNotes([variant], REMOTE)), ids(REMOTE));
  });

  test('内容键含想法：划线相同但想法不同的旧副本不是副本（两边各留各的）', () => {
    const copyWithThought = { ...legacyNotes(REMOTE)[0], thoughtText: '旧文件里这条还带着想法' };
    const merged = mergeWithLocalNotes([copyWithThought], REMOTE);
    assert.equal(merged.length, 3);
    assert.ok(merged.includes(copyWithThought));
    // 反向：保留笔记有想法、旧副本没有
    const remoteWithThought = REMOTE.map((n, i) => (i === 0 ? { ...n, thoughtText: '后来写的想法' } : n));
    assert.equal(mergeWithLocalNotes(legacyNotes(REMOTE), remoteWithThought).length, 3, '旧副本（无想法）不是「带想法的那条」的副本');
  });

  test('只有哈希 ID 参与副本判定：带锚点但远端已删的笔记照旧保留', () => {
    const gone = { noteId: 'B1_3_1-2', type: 1, highlightText: '划线甲', createTime: REMOTE[0].createTime }; // 与远端同文同时间
    const merged = mergeWithLocalNotes([gone], REMOTE);
    assert.equal(merged.length, 3);
    assert.ok(merged.includes(gone));
  });

  test('正本也可以是「先保留下来的仅本地笔记」：远端已删的带锚点笔记排在它的旧副本前面 → 只留带锚点的那条', () => {
    const gone = { noteId: 'B1_9_1-9', type: 1, highlightText: '远端已删的划线', createTime: 1794000000 };
    const twin = { ...gone, chapterUid: 0, noteId: markdown.buildStableLocalNoteId('B1', gone) }; // 旧文件读回的副本
    const merged = mergeWithLocalNotes([...REMOTE, gone, twin], REMOTE);
    assert.equal(merged.length, 3, '远端 2 条 + 这条仅本地的正本；副本不另算');
    assert.ok(merged.includes(gone), '远端已删的正本保留');
    assert.ok(!merged.includes(twin), '它的旧副本不重复保留');
  });

  test('空笔记不判副本（宁保留）——即使记录时间相同', () => {
    const empty = { noteId: 'local_000000000000', type: 2, thoughtText: '', createTime: 5 };
    assert.equal(mergeWithLocalNotes([empty], [{ noteId: 'x', type: 2, thoughtText: '', createTime: 5 }]).length, 2);
  });

  test('想法挂回划线后：旧的「独立想法」副本（ID = 想法 ID）不再保留', () => {
    const bookmarks = [{ noteId: 'B1_1_5-9', type: 1, highlightText: '划线丙', createTime: 1700000000 }];
    const { notes, bookReview, absorbedReviews } = mergeReviewsIntoNotes(bookmarks, {
      attached: [{ reviewId: 'rv1', bookId: 'B1', content: '想法丁', abstract: '划线丙', range: '5-9', createTime: 1700000005 }],
      chapterComments: [], bookReviews: [],
    });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].thoughtText, '想法丁');
    assert.equal(bookReview, null);
    assert.deepEqual([...absorbedReviews], [['rv1', 'B1_1_5-9']], '回报：想法 rv1 已挂在划线 B1_1_5-9 上');
    // 早期落盘的旧形态：那一轮划线只返回了残缺数据，想法没找到划线 → 独立想法笔记
    const stale = { noteId: 'rv1', bookId: 'B1', type: 2, highlightText: '划线丙', thoughtText: '想法丁', createTime: 1700000005 };
    assert.deepEqual(ids(mergeWithLocalNotes([stale], notes, { absorbedReviews })), ['B1_1_5-9'], '原版：划线上挂一份 + 独立一份');
    assert.equal(isAbsorbedReviewCopy(stale, absorbedReviews, notes), true);
  });

  test('旧的独立想法：本地改过 / 本轮没拉想法 → 保留；章节点评走 ID 匹配不受影响', () => {
    const notes = [{ noteId: 'B1_1_5-9', type: 1, highlightText: '划线丙', thoughtText: '想法丁', createTime: 1700000000 }];
    const absorbedReviews = new Map([['rv1', 'B1_1_5-9']]);
    const stale = { noteId: 'rv1', type: 2, highlightText: '划线丙', thoughtText: '想法丁', createTime: 1700000005 };
    assert.equal(mergeWithLocalNotes([{ ...stale, thoughtText: '想法丁（我改过）' }], notes, { absorbedReviews }).length, 2, '本地改过 → 保留');
    assert.equal(mergeWithLocalNotes([stale], notes).length, 2, '本轮没拉想法 → 保留');
    assert.equal(mergeWithLocalNotes([stale], notes, { absorbedReviews: new Map([['rv9', 'B1_1_5-9']]) }).length, 2, '想法 ID 对不上 → 保留');
    const comment = { noteId: 'rv2', type: 2, thoughtText: '章节点评', createTime: 1700000006 }; // 远端自己就是这条（ID 相同）
    assert.deepEqual(ids(mergeWithLocalNotes([comment], [comment], { absorbedReviews })), ['rv2']);
  });

  test('本地划线在 ID 合并中胜出且没有这条想法 → 旧独立想法是想法唯一的出处，必须保留', () => {
    const bookmarks = [{ noteId: 'B1_1_5-9', type: 1, highlightText: '划线丙', createTime: 0 }]; // web 新管线划线缺 createTime
    const { notes: remote, absorbedReviews } = mergeReviewsIntoNotes(bookmarks, {
      attached: [{ reviewId: 'rv1', bookId: 'B1', content: '想法丁', abstract: '划线丙', range: '5-9', createTime: 1700000005 }],
      chapterComments: [], bookReviews: [],
    });
    assert.equal(remote[0].thoughtText, '想法丁', '前置：远端这条划线带着想法');
    const localWins = { noteId: 'B1_1_5-9', type: 1, highlightText: '划线丙', createTime: 1700000000 }; // 本地时间更新 → ID 合并中胜出
    const stale = { noteId: 'rv1', type: 2, highlightText: '划线丙', thoughtText: '想法丁', createTime: 1700000005 };
    const merged = mergeWithLocalNotes([localWins, stale], remote, { absorbedReviews });
    assert.equal(merged.length, 2, '旧独立想法保留');
    assert.equal(merged[0].thoughtText, undefined, '前置：胜出的本地划线确实没有想法');
    assert.ok(merged.some((n) => n.thoughtText === '想法丁'), '想法仍在文件里');
  });

  test('同一划线两条想法：后一条覆盖前一条 → 前一条的旧独立副本保留，后一条的清掉', () => {
    const bookmarks = [{ noteId: 'B1_1_5-9', type: 1, highlightText: '划线丙', createTime: 1700000000 }];
    const { notes: remote, absorbedReviews } = mergeReviewsIntoNotes(bookmarks, {
      attached: [
        { reviewId: 'rv1', bookId: 'B1', content: '想法一', abstract: '划线丙', range: '5-9', createTime: 1700000005 },
        { reviewId: 'rv2', bookId: 'B1', content: '想法二', abstract: '划线丙', range: '5-9', createTime: 1700000006 },
      ],
      chapterComments: [], bookReviews: [],
    });
    assert.equal(remote[0].thoughtText, '想法二', '前置：笔记上留的是后一条想法');
    const stale1 = { noteId: 'rv1', type: 2, highlightText: '划线丙', thoughtText: '想法一', createTime: 1700000005 };
    const stale2 = { noteId: 'rv2', type: 2, highlightText: '划线丙', thoughtText: '想法二', createTime: 1700000006 };
    const merged = mergeWithLocalNotes([stale1, stale2], remote, { absorbedReviews });
    assert.deepEqual(ids(merged), ['B1_1_5-9', 'rv1'], '想法一只剩旧副本这一处出处；想法二已挂在划线上');
  });

  test('mergeReviewsIntoNotes：章节点评、整本书评不算「已吸收」', () => {
    const { absorbedReviews } = mergeReviewsIntoNotes([], {
      attached: [],
      chapterComments: [{ reviewId: 'rv2', bookId: 'B1', content: '章节点评', chapterName: '二', createTime: 6 }],
      bookReviews: [{ reviewId: 'rv3', bookId: 'B1', content: '书评', createTime: 7 }],
    });
    assert.equal(absorbedReviews.size, 0);
  });

  test('存量翻倍文件：一轮同步自愈（真实文件落盘），二轮零更新', async () => {
    const w = makeWorld({ items: remoteItems });
    w.write(markdown.renderBookMarkdown({ ...BOOK, highlightCount: 4, noteCount: 4 }, [...REMOTE, ...legacyNotes(REMOTE)], {}));
    assert.equal(w.read().notes.length, 4, '前置：翻倍状态');

    const r1 = await w.svc.incrementalSync('acc1');
    assert.equal(r1.success, true);
    assert.equal(r1.syncedBooks, 1);
    const after = w.read();
    assert.deepEqual(ids(after.notes), ids(REMOTE), '只剩带锚点的一套');
    assert.doesNotMatch(fs.readFileSync(w.mdFile, 'utf8'), /wr:nid:local_/);
    assert.equal(after.book.noteCount, 2, '文件头计数随之订正（对账读的就是它）');

    const r2 = await w.svc.incrementalSync('acc1');
    assert.equal(r2.syncedBooks, 0, '二轮零更新');
    assert.deepEqual(ids(w.read().notes), ids(REMOTE));
  });

  test('旧格式文件（无锚点）对上远端：落盘只有一套，并补上锚点', async () => {
    const w = makeWorld({ items: remoteItems });
    w.write(legacyFile(REMOTE));
    assert.equal(w.read().notes.length, 2);
    // 本地与远端计数相同（2/2）→ 不在增量队列；走详情页手动刷新（syncBook）这条线
    const notes = await w.svc.syncBook('B1', 'acc1');
    assert.deepEqual(ids(notes), ids(REMOTE));
    assert.deepEqual(ids(w.read().notes), ids(REMOTE), '不再翻倍成 4 条');
  });

  test('旧的独立想法：同步后清掉副本、想法仍在划线上；本地改过的保留', async () => {
    const items = [{ bookmarkId: 'B1_1_1-2', markText: '划线丙', createTime: 1700000000, modifyTime: 1700000000 }];
    const reviews = [{ reviewId: 'rv1', content: '想法丁', abstract: '划线丙', range: '1-2', createTime: 1700000005 }];
    const counts = { highlightCount: 1, noteCount: 1, reviewCount: 1 };
    const anchored = { noteId: 'B1_1_1-2', bookId: 'B1', chapterUid: 1, chapterTitle: '一', type: 1, highlightText: '划线丙', createTime: 1700000000 };
    const stale = { noteId: 'rv1', bookId: 'B1', chapterUid: 1, chapterTitle: '一', type: 2, highlightText: '划线丙', thoughtText: '想法丁', createTime: 1700000005 };
    const front = { ...BOOK, highlightCount: 2, noteCount: 2, reviewCount: 1 };

    const w = makeWorld({ items, reviews, counts });
    w.write(markdown.renderBookMarkdown(front, [anchored, stale], {}));
    assert.deepEqual(ids(w.read().notes), ['B1_1_1-2', 'rv1'], '前置：划线 + 旧的独立想法各一条');
    assert.equal((await w.svc.incrementalSync('acc1')).success, true);
    const after = w.read();
    assert.deepEqual(ids(after.notes), ['B1_1_1-2'], '旧的独立想法副本被清理');
    assert.equal(after.notes[0].thoughtText, '想法丁', '想法仍在——挂在划线上');
    assert.equal(after.book.reviewCount, 1);

    const edited = { ...stale, thoughtText: '想法丁（我改过）' };
    const w2 = makeWorld({ items, reviews, counts });
    w2.write(markdown.renderBookMarkdown(front, [anchored, edited], {}));
    assert.equal((await w2.svc.incrementalSync('acc1')).success, true);
    assert.deepEqual(ids(w2.read().notes), ['B1_1_1-2', 'rv1'], '本地改过的旧独立想法是用户资产：保留');
  });

  test('详情页手动刷新（syncBook）同样清理旧的独立想法：这条路径经 fetchRemoteBookNotes 回传对应关系', async () => {
    const items = [{ bookmarkId: 'B1_1_1-2', markText: '划线丙', createTime: 1700000000, modifyTime: 1700000000 }];
    const reviews = [{ reviewId: 'rv1', content: '想法丁', abstract: '划线丙', range: '1-2', createTime: 1700000005 }];
    const anchored = { noteId: 'B1_1_1-2', bookId: 'B1', chapterUid: 1, chapterTitle: '一', type: 1, highlightText: '划线丙', createTime: 1700000000 };
    const stale = { noteId: 'rv1', bookId: 'B1', chapterUid: 1, chapterTitle: '一', type: 2, highlightText: '划线丙', thoughtText: '想法丁', createTime: 1700000005 };
    const w = makeWorld({ items, reviews, counts: { highlightCount: 1, noteCount: 2, reviewCount: 1 } });
    w.write(markdown.renderBookMarkdown({ ...BOOK, highlightCount: 2, noteCount: 2, reviewCount: 1 }, [anchored, stale], {}));
    assert.deepEqual(ids(w.read().notes), ['B1_1_1-2', 'rv1'], '前置：划线 + 旧的独立想法');
    const notes = await w.svc.syncBook('B1', 'acc1');
    assert.deepEqual(ids(notes), ['B1_1_1-2']);
    assert.deepEqual(ids(w.read().notes), ['B1_1_1-2']);
    assert.equal(w.read().notes[0].thoughtText, '想法丁');
  });

  test('已知局限：没有划线原文的旧独立想法副本，计数恰好与远端相等 → 增量同步不进队列，手动刷新时才清理', async () => {
    const items = [{ bookmarkId: 'B1_1_1-2', markText: '划线丙', createTime: 1700000000, modifyTime: 1700000000 }];
    const reviews = [{ reviewId: 'rv1', content: '想法丁', abstract: '划线丙', range: '1-2', createTime: 1700000005 }];
    const anchored = { noteId: 'B1_1_1-2', bookId: 'B1', chapterUid: 1, chapterTitle: '一', type: 1, highlightText: '划线丙', createTime: 1700000000 };
    const staleNoText = { noteId: 'rv1', bookId: 'B1', chapterUid: 1, chapterTitle: '一', type: 2, thoughtText: '想法丁', createTime: 1700000005 };
    // 网关合并后的远端计数：1 条划线 + 1 条想法；本地读回：1 条带 `>` 的笔记 + 1 条独立想法 = 同为 1/2
    const w = makeWorld({ items, reviews, counts: { highlightCount: 1, noteCount: 2, reviewCount: 1 } });
    w.write(markdown.renderBookMarkdown({ ...BOOK, highlightCount: 1, noteCount: 2, reviewCount: 1 }, [anchored, staleNoText], {}));
    assert.deepEqual(ids(w.read().notes), ['B1_1_1-2', 'rv1'], '前置');
    // 这本书近期全量拉过（30 天兜底未到期）——存量库里绝大多数书都是这个状态；否则兜底全拉会掩盖要验证的计数闸门
    w.store.setState('acc1', 'noteSyncMarks', { B1: Date.now() });
    const r = await w.svc.incrementalSync('acc1');
    assert.equal(r.success, true);
    assert.deepEqual(ids(w.read().notes), ['B1_1_1-2', 'rv1'], '增量同步没把它排进队列（安全方向：宁保留）');
    await w.svc.syncBook('B1', 'acc1');
    assert.deepEqual(ids(w.read().notes), ['B1_1_1-2'], '手动刷新（或 30 天兜底全量）时清理');
  });

  test('网关在场：旧格式文件同步后只有一套；对账结果落 state 时带全量方向计数（界面据此说话）', async () => {
    const gateway = {
      hasApiKey: () => true,
      call: async () => ({ updated: remoteItems, chapters: [] }), // /book/bookmarklist
      notebooksAll: async () => ({ books: [{ bookId: 'B1', book: { title: '去重书' }, noteCount: 5, reviewCount: 0 }], totalBookCount: 1, totalNoteCount: 5 }),
      myReviewsAll: async () => [],
    };
    const w = makeWorld({ items: remoteItems, gateway, apiKey: 'wrk-test' });
    w.write(legacyFile(REMOTE));
    const r = await w.svc.incrementalSync('acc1');
    assert.equal(r.success, true);
    assert.deepEqual(ids(w.read().notes), ids(REMOTE), '经网关通道同步后只剩一套，并带上了锚点');
    const reconcile = w.store.getState('acc1', 'syncState', {}).reconcile;
    assert.equal(reconcile?.mismatchedCount, 1);
    assert.deepEqual([reconcile?.localHigherCount, reconcile?.localLowerCount], [0, 1], '本地 2 条 < 官方计数 5 → 本地偏少（可能漏采）');
  });
});
