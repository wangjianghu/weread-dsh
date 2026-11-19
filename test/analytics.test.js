// test/analytics.test.js —— createAnalyticsService（mock index，纯计算）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsService } from '../lib/analytics.js';

const DAY = 24 * 60 * 60 * 1000;

function tsDaysAgo(days, hour) {
  // v1.9.11 修复：原 hour=10 固定对齐导致「上午 10 点前跑测试」时 tsDaysAgo(0) 落在未来，
  // 被分析窗口当异常数据过滤（2026-11-18 09:36 实测 5 用例假挂）。改为保留当前时分秒的
  // 相对偏移：days 间隔 ≥1 保证日历天聚合稳定，且任何时刻跑都不产生未来时间戳。
  const d = new Date();
  d.setDate(d.getDate() - days);
  if (hour !== undefined) d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function makeIndex(books, noteMap, signature) {
  return {
    async queryBooks() { return books; },
    async getNotesByBookId(bookId) { return noteMap[bookId] || []; },
    getSnapshotSignature: signature ? () => signature : undefined,
  };
}

function book(bookId, extra = {}) {
  return { bookId, title: `书${bookId}`, category: '科技', progress: 50, readingStatus: 1, author: '作者', ...extra };
}

describe('KPI', () => {
  test('活跃日/总数/深读比/连续天数', async () => {
    const books = [book('b1'), book('b2')];
    const noteMap = {
      b1: [
        { noteId: 'n1', bookId: 'b1', type: 1, highlightText: 'x'.repeat(120), createTime: tsDaysAgo(2) }, // 深读（≥100）
        { noteId: 'n2', bookId: 'b1', type: 1, highlightText: '短', createTime: tsDaysAgo(1) },
      ],
      b2: [{ noteId: 'n3', bookId: 'b2', type: 2, thoughtText: 't'.repeat(60), createTime: tsDaysAgo(1) }], // 深读（≥50）
    };
    const svc = createAnalyticsService({ index: makeIndex(books, noteMap) });
    const d = await svc.getDashboardData({ days: 30 });
    assert.equal(d.kpis.totalNotes, 3);
    assert.equal(d.kpis.activeDays, 2); // 两天前 + 昨天
    assert.equal(d.kpis.longestStreakDays, 2); // 连续两天
    assert.equal(d.kpis.deepNoteRatio, 66.67); // 2/3
    assert.equal(d.kpis.averageNotesPerBook, 1.5);
  });

  test('ts<=0 的笔记不产生活跃日', async () => {
    const noteMap = { b1: [{ noteId: 'n0', bookId: 'b1', type: 1, createTime: 0 }] };
    const svc = createAnalyticsService({ index: makeIndex([book('b1')], noteMap) });
    const d = await svc.getDashboardData({ days: 7 });
    assert.equal(d.kpis.activeDays, 0);
    assert.equal(d.kpis.totalNotes, 1); // 但仍在总数里
  });
});

describe('时间线', () => {
  test('未知时间（0）笔记置于最前，已知时间降序', async () => {
    const noteMap = {
      b1: [
        { noteId: 'old', bookId: 'b1', createTime: tsDaysAgo(5) },
        { noteId: 'new', bookId: 'b1', createTime: tsDaysAgo(0) },
        { noteId: 'unknown', bookId: 'b1', createTime: 0 },
        { noteId: 'mid', bookId: 'b1', createTime: tsDaysAgo(2) },
      ],
    };
    const svc = createAnalyticsService({ index: makeIndex([book('b1')], noteMap) });
    const d = await svc.getDashboardData({ days: 30 });
    assert.deepEqual(d.timeline.map((t) => t.noteId), ['unknown', 'new', 'mid', 'old']);
    assert.equal(d.timeline[1].bookTitle, '书b1');
  });

  test('长文本截断 120 + ...', async () => {
    const noteMap = { b1: [{ noteId: 'n', bookId: 'b1', createTime: tsDaysAgo(0), highlightText: 'a'.repeat(200) }] };
    const svc = createAnalyticsService({ index: makeIndex([book('b1')], noteMap) });
    const d = await svc.getDashboardData({ days: 7 });
    assert.equal(d.timeline[0].highlightText.length, 123);
    assert.ok(d.timeline[0].highlightText.endsWith('...'));
  });
});

describe('筛选', () => {
  test('noteType=thought 只留想法笔记', async () => {
    const noteMap = {
      b1: [
        { noteId: 'h', bookId: 'b1', type: 1, createTime: tsDaysAgo(0) },
        { noteId: 't', bookId: 'b1', type: 2, createTime: tsDaysAgo(0) },
      ],
    };
    const svc = createAnalyticsService({ index: makeIndex([book('b1')], noteMap) });
    const d = await svc.getDashboardData({ days: 7, noteType: 'thought' });
    assert.equal(d.kpis.totalNotes, 1);
    assert.equal(d.filter.noteType, 'thought');
  });

  test('finishedOnly 只留已读完', async () => {
    const books = [book('b1', { readingStatus: 2 }), book('b2', { readingStatus: 1 })];
    const noteMap = { b1: [{ noteId: 'n1', bookId: 'b1', createTime: tsDaysAgo(0) }], b2: [] };
    const svc = createAnalyticsService({ index: makeIndex(books, noteMap) });
    const d = await svc.getDashboardData({ days: 7, finishedOnly: true });
    assert.equal(d.categoryShare.length, 1);
  });

  test('category 筛选', async () => {
    const books = [book('b1', { category: '科技' }), book('b2', { category: '历史' })];
    const svc = createAnalyticsService({ index: makeIndex(books, {}) });
    const d = await svc.getDashboardData({ days: 7, category: '历史' });
    assert.ok(d.categoryShare.every((c) => c.category === '历史'));
  });

  test('非法 noteType 归一化为 all；周粒度开关', async () => {
    const svc = createAnalyticsService({ index: makeIndex([book('b1')], {}) });
    const d = await svc.getDashboardData({ days: 7, noteType: 'bogus', trendGranularity: 'week' });
    assert.equal(d.filter.noteType, 'all');
    assert.equal(d.filter.trendGranularity, 'week');
    assert.ok(Array.isArray(d.trend) && d.trend.length >= 1);
  });

  test('days>0 时窗口外笔记不计入趋势', async () => {
    const noteMap = {
      b1: [
        { noteId: 'in', bookId: 'b1', createTime: tsDaysAgo(1) },
        { noteId: 'out', bookId: 'b1', createTime: tsDaysAgo(10) },
      ],
    };
    const svc = createAnalyticsService({ index: makeIndex([book('b1')], noteMap) });
    const d = await svc.getDashboardData({ days: 3 });
    assert.equal(d.kpis.activeDays, 1);
  });
});

describe('分类与作者', () => {
  test('分类雷达拆两级', async () => {
    const books = [book('b1', { category: '科技-计算机' }), book('b2', { category: '科技-互联网' }), book('b3', { category: '' })];
    const svc = createAnalyticsService({ index: makeIndex(books, {}) });
    const d = await svc.getDashboardData({ days: 7 });
    const l1 = d.categoryRadar.filter((c) => c.level === 1);
    const l2 = d.categoryRadar.filter((c) => c.level === 2);
    assert.ok(l1.find((c) => c.category === '科技' && c.count === 2));
    assert.ok(l1.find((c) => c.category === '未分类' && c.count === 1));
    assert.ok(l2.find((c) => c.category === '计算机'));
  });

  test('作者云按分隔符拆分并按次数排序', async () => {
    const books = [
      book('b1', { author: '张三' }),
      book('b2', { author: '张三, 李四' }),
      book('b3', { author: '李四' }),
    ];
    const svc = createAnalyticsService({ index: makeIndex(books, {}) });
    const d = await svc.getDashboardData({ days: 7 });
    assert.deepEqual(d.authorCloud.map((a) => [a.author, a.count]), [['张三', 2], ['李四', 2]]);
  });

  test('分类份额 >12 组折叠为「其他」', async () => {
    const books = Array.from({ length: 15 }, (_, i) => book(`b${i}`, { category: `分类${i}` }));
    const svc = createAnalyticsService({ index: makeIndex(books, {}) });
    const d = await svc.getDashboardData({ days: 7 });
    assert.ok(d.categoryShare.length <= 12);
    assert.ok(d.categoryShare.some((c) => c.category === '其他'));
  });
});

describe('散点与榜单', () => {
  test('scatter 按象限分类且 topBooks 按价值分排序', async () => {
    const books = [
      book('b1', { readingTime: 100, totalPages: 100, progress: 100 }),
      book('b2', { readingTime: 10, totalPages: 100, progress: 50 }),
    ];
    const noteMap = {
      b1: [{ noteId: 'n1', bookId: 'b1', createTime: tsDaysAgo(0) }, { noteId: 'n2', bookId: 'b1', createTime: tsDaysAgo(0) }],
      b2: [{ noteId: 'n3', bookId: 'b2', createTime: tsDaysAgo(0) }],
    };
    const svc = createAnalyticsService({ index: makeIndex(books, noteMap) });
    const d = await svc.getDashboardData({ days: 7 });
    assert.equal(d.scatter.length, 2);
    for (const item of d.scatter) {
      assert.ok(['high_value', 'high_density', 'high_time', 'low_value'].includes(item.quadrant));
    }
    assert.equal(d.topBooks.length, 2);
    assert.ok(d.topBooks[0].valueScore >= d.topBooks[1].valueScore);
    assert.equal(d.topBooks[0].bookId, 'b1'); // 笔记多 + 完成度高 → 榜首
  });
});

describe('缓存与回退', () => {
  test('同 filter 命中缓存（返回同一对象）', async () => {
    const books = [book('b1')];
    const noteMap = { b1: [{ noteId: 'n1', bookId: 'b1', createTime: tsDaysAgo(0) }] };
    const svc = createAnalyticsService({ index: makeIndex(books, noteMap) });
    const a = await svc.getDashboardData({ days: 7 });
    const b = await svc.getDashboardData({ days: 7 });
    assert.equal(a, b);
    svc.clearCache();
    const c = await svc.getDashboardData({ days: 7 });
    assert.notEqual(a, c);
  });

  test('账号结果为空回退默认作用域', async () => {
    const books = [book('b1')];
    const noteMap = { b1: [{ noteId: 'n1', bookId: 'b1', createTime: tsDaysAgo(0) }] };
    const index = {
      async queryBooks(accountId) { return accountId === 'accX' ? [] : books; },
      async getNotesByBookId() { return noteMap.b1; },
    };
    const svc = createAnalyticsService({ index });
    const d = await svc.getDashboardData({ days: 7 }, 'accX');
    assert.equal(d.kpis.totalNotes, 1);
  });

  test('空库零值不崩溃', async () => {
    const svc = createAnalyticsService({ index: makeIndex([], {}) });
    const d = await svc.getDashboardData({});
    assert.equal(d.kpis.totalNotes, 0);
    assert.equal(d.kpis.activeDays, 0);
    assert.deepEqual(d.scatter, []);
    assert.deepEqual(d.topBooks, []);
  });
});
