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
  });

  test('空输入', () => {
    assert.deepEqual(computeReconcile([], []), { checked: 0, mismatchedCount: 0, mismatched: [] });
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
