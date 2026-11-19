// 微基准：roaming 池构建 / meta 全量 normalize+写盘 的单次成本（量级验证用）
import { createRoamingService } from '../lib/roaming.js';

const BOOKS = 2000, NOTES_PER_BOOK = 3, META_RECORDS = 3000;
const notesByBook = new Map();
const books = [];
for (let b = 0; b < BOOKS; b++) {
  const bookId = `book${b}`;
  books.push({ bookId, title: `书${b}`, author: `作者${b % 50}`, category: `分类${b % 20}`, lastReadTime: b });
  notesByBook.set(bookId, Array.from({ length: NOTES_PER_BOOK }, (_, n) => ({
    noteId: `n${b}_${n}`, bookId, chapterUid: n, chapterTitle: `第${n}章`,
    type: 1, highlightText: `划线内容示例文本 ${b}-${n} 一些更长的内容来模拟真实笔记长度。`.repeat(2),
    thoughtText: n % 3 === 0 ? `想法 ${b}-${n}` : '', createTime: b * 100 + n,
  })));
}
const fakeIndex = {
  queryBooks: async () => books,
  getNotesByBookId: async (bookId) => notesByBook.get(bookId) || [],
  getIndexGeneration: () => 1,
};
let lastWritten = null; let writeCount = 0, readCount = 0;
const fakeStore = {
  getActiveAccountId: () => 'acc1',
  readAux: (f) => { readCount++; return lastWritten ?? buildRawMeta(); },
  writeAux: (f, data) => { writeCount++; lastWritten = data; },
  getState: () => undefined, setState: () => {},
};
function buildRawMeta() {
  const records = {};
  for (let i = 0; i < META_RECORDS; i++) {
    records[`book${i % BOOKS}:0:abc${i}`] = {
      noteKey: `book${i % BOOKS}:0:abc${i}`, noteId: `n${i % BOOKS}_0`,
      favorite: i % 7 === 0, reviewCount: i % 4, skipCount: i % 3, seenCount: i % 10,
      lastSeenAt: 1700000000000 + i, sm2EF: 2.5, sm2Interval: i % 6, sm2Reps: i % 5, sm2Lapses: i % 2,
      sm2Due: 1700000000000 + i * 86400000, updatedAt: 1700000000000 + i,
    };
  }
  return { version: 1, records, updatedAt: 1 };
}
const svc = createRoamingService({ index: fakeIndex, store: fakeStore, log: () => {} });
const t = async (label, fn) => { const s = performance.now(); const r = await fn(); console.log(`${label}: ${(performance.now() - s).toFixed(1)}ms`, r ?? ''); };

// 1) 池构建（全部 miss 场景）
let pool;
await t(`池构建 ${BOOKS}书×${NOTES_PER_BOOK}笔记 + ${META_RECORDS} meta 记录`, async () => {
  pool = await svc.getCandidatePool({}, 'acc1');
  return `pool=${pool.length}`;
});
// 2) 池缓存命中
await t('池缓存命中(TTL 内)', async () => { const p = await svc.getCandidatePool({}, 'acc1'); return `pool=${p.length}`; });
// 3) recordAction（一次 next 的 view 记录）→ 双 getRoamingMetaStore + 全量写
const key0 = pool[0].noteKey;
await t('recordAction×1（skip+view 的一半）', async () => { await svc.recordAction(key0, 'view', 'acc1'); return `readAux=${readCount} writeAux=${writeCount}`; });
// 4) sessionNext 全链路（真实点击 next）
await t('sessionNext 全链路', async () => { const r = await svc.sessionNext('acc1'); return `writes=${writeCount}`; });
// 5) 30s TTL 过期后的池重建（recordAction 清了缓存）
await t('缓存失效后池重建', async () => { const p = await svc.getCandidatePool({}, 'acc1'); return `pool=${p.length}`; });
// 6) meta 文件序列化尺寸
const size = JSON.stringify(lastWritten ?? buildRawMeta(), null, 2).length;
console.log(`meta 文件落盘尺寸(5000 上限时相似比例): ${(size / 1024).toFixed(0)} KB (当前 ${Object.keys((lastWritten ?? buildRawMeta()).records).length} 条)`);
