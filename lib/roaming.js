// lib/roaming.js —— 笔记漫游（weread-vscode noteRoamingService 移植 + Host 侧 SessionState）
// 契约见 docs/design-dsh-mapping.md §3、analysis-03 §5.3.1/§5.3.6。

import { createHash } from 'node:crypto';

const POOL_CACHE_TTL_MS = 30_000;
const POOL_CACHE_MAX = 20;
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RECENT_LIMIT = 20;

const FILTER_NOTE_TYPES = ['highlight', 'thought', 'chapter', 'review'];

function normalizeSecToMs(value) {
  if (!value || !Number.isFinite(value)) return undefined;
  return value > 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

function truncateText(text, maxLen = 200) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function normalizeRawText(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/** NoteType 1/2/3/4 → highlight/thought/chapter/review */
function toFilterType(noteType) {
  if (noteType === 2) return 'thought';
  if (noteType === 3) return 'chapter';
  if (noteType === 4) return 'review';
  return 'highlight';
}

function isVolatileLocalNoteId(noteId) {
  return /^local_[a-z0-9]+_\d{9,}$/i.test(noteId);
}

function buildFallbackNoteKey(note) {
  const chapterPart = String(note.chapterUid || 0);
  const textPart = `${note.highlightText || ''}|${note.thoughtText || ''}|${note.chapterTitle || ''}`.trim();
  const hash = createHash('sha1').update(textPart).digest('hex').slice(0, 12);
  return `${note.bookId}:${chapterPart}:${hash}`;
}

/** 稳定 noteId 直接用；易变本地 ID（local_xxx_数字）回退内容哈希键 */
export function resolveRoamingNoteKey(note) {
  const noteId = String(note.noteId || '').trim();
  if (noteId && !isVolatileLocalNoteId(noteId)) return noteId;
  return buildFallbackNoteKey(note);
}

export function resolveRoamingChapterKey(candidate) {
  return `${candidate.bookId}:${candidate.chapterUid || 0}`;
}

function normalizeRoamingMetaRecord(noteKey, raw) {
  const src = raw || {};
  const nonNegativeInt = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const positiveInt = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);
  // SM-2 间隔重复（v0.3）：ef 默认 2.5（下限 1.3）；interval 天数；reps 连续记得次数；lapses 忘记次数；due 到期时间戳
  const ef = Number(src.sm2EF);
  return {
    noteKey,
    noteId: src.noteId ? String(src.noteId) : undefined,
    favorite: !!src.favorite,
    favoriteAt: positiveInt(src.favoriteAt),
    lastReviewedAt: positiveInt(src.lastReviewedAt),
    reviewCount: nonNegativeInt(src.reviewCount),
    skipCount: nonNegativeInt(src.skipCount),
    openSourceCount: nonNegativeInt(src.openSourceCount),
    seenCount: nonNegativeInt(src.seenCount),
    lastSeenAt: positiveInt(src.lastSeenAt),
    sm2EF: Number.isFinite(ef) && ef >= 1.3 ? ef : 2.5,
    sm2Interval: nonNegativeInt(src.sm2Interval),
    sm2Reps: nonNegativeInt(src.sm2Reps),
    sm2Lapses: nonNegativeInt(src.sm2Lapses),
    sm2Due: positiveInt(src.sm2Due),
    updatedAt: nonNegativeInt(src.updatedAt),
  };
}

/** SM-2 调度（简化两档：记得 grade=4 / 忘记 grade=2）。返回需合并进 meta 的字段。 */
function sm2Schedule(meta, grade) {
  let ef = Number(meta?.sm2EF) || 2.5;
  let reps = Number(meta?.sm2Reps) || 0;
  let interval = Number(meta?.sm2Interval) || 0;
  let lapses = Number(meta?.sm2Lapses) || 0;
  if (grade >= 3) {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ef);
    ef = Math.max(1.3, ef - 0.8 + 0.28 * grade - 0.02 * grade * grade);
  } else {
    lapses += 1;
    reps = 0;
    interval = 1;
    ef = Math.max(1.3, ef - 0.2);
  }
  const due = Date.now() + interval * 86_400_000;
  return { sm2EF: Math.round(ef * 100) / 100, sm2Reps: reps, sm2Interval: interval, sm2Lapses: lapses, sm2Due: due };
}

/** 到期判定：复习过的卡（sm2Due>0）且已到期 */
function isDueMeta(meta, nowMs = Date.now()) {
  const due = Number(meta?.sm2Due) || 0;
  return due > 0 && due <= nowMs;
}

/** @param {{index:{queryBooks:Function,getNotesByBookId:Function}, store:object, log:Function}} deps */
export function createRoamingService({ index, store, log }) {
  const logger = typeof log === 'function' ? log : () => {};
  const poolCache = new Map(); // key → {expiresAt, data}
  const sessions = new Map(); // accountId → SessionState

  function resolveAccountId(accountId) {
    const normalized = String(accountId || '').trim();
    if (normalized) return normalized;
    const active = store.getActiveAccountId?.();
    return String(active || '').trim() || undefined;
  }

  // ---------- 漫游元数据（store 'roaming.meta'） ----------
  // C3: roaming.meta 存独立小文件，读写不再连带 snapshot 大 JSON
  // P0-2（开源前对抗审查 v3）：accountId 参与落盘文件名——清洗非 [\w.-] 字符，杜绝路径穿越。
  const safeAccountId = (accountId) => String(accountId || 'default').replace(/[^\w.-]/g, '_');
  const metaFileName = (accountId) => `roaming.${safeAccountId(accountId)}.meta.json`;
  function getRoamingMetaStore(accountId) {
    const raw = (store.readAux ? store.readAux(metaFileName(accountId), undefined) : undefined)
      || store.getState(accountId, 'roaming.meta', undefined) || {};
    const records = {};
    for (const [key, value] of Object.entries(raw.records || {})) {
      records[key] = normalizeRoamingMetaRecord(key, value);
    }
    // v1.7.4 性能：noteId→record 索引。原 resolveMetaRecord 未命中时线性扫全部 records
    // （每次比较 String+trim），池构建 O(笔记×记录)：2000 书/6000 笔记/3000 meta 实测 1.2s/次。
    const byNoteId = new Map();
    for (const rec of Object.values(records)) {
      const nid = String(rec.noteId || '').trim();
      if (nid) byNoteId.set(nid, rec);
    }
    return { version: 1, records, byNoteId, updatedAt: raw.updatedAt || 0 };
  }

  function upsertRoamingNoteMeta(accountId, noteKey, patch, preloadedStore) {
    // v1.7.4 性能：recordAction 已读过 metaStore 时直接复用（此前每动作 2 次全量读+normalize）
    const metaStore = preloadedStore || getRoamingMetaStore(accountId);
    const seed = {
      noteKey,
      noteId: patch.noteId,
      favorite: false,
      reviewCount: 0,
      skipCount: 0,
      openSourceCount: 0,
      seenCount: 0,
    };
    const current = metaStore.records[noteKey] || seed;
    const merged = normalizeRoamingMetaRecord(noteKey, {
      ...current,
      ...patch,
      noteId: patch.noteId ?? current.noteId,
      updatedAt: Date.now(),
    });
    metaStore.records[noteKey] = merged;
    const mergedNoteId = String(merged.noteId || '').trim();
    if (mergedNoteId && metaStore.byNoteId) metaStore.byNoteId.set(mergedNoteId, merged);
    metaStore.updatedAt = Date.now();
    // C3: 容量上限 + 独立小文件落盘
    // P2-10（对抗审查 v2）：favorite 淘汰保护——先淘汰非 favorite 中最旧的，favorite 跳过；
    // 全为 favorite 且仍超限才按 updatedAt 兜底淘汰（总量 5000 硬约束不变）
    const entries = Object.values(metaStore.records);
    if (entries.length > 5000) {
      entries.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
      const excess = entries.length - 5000;
      const evicted = [];
      for (const e of entries) {
        if (evicted.length >= excess) break;
        if (!e.favorite) evicted.push(e);
      }
      for (const e of entries) {
        if (evicted.length >= excess) break;
        if (e.favorite) evicted.push(e); // 非 favorite 已全部淘汰仍超限 → 兜底按 updatedAt 淘汰 favorite
      }
      for (const e of evicted) {
        delete metaStore.records[e.noteKey];
        const enid = String(e.noteId || '').trim();
        if (enid && metaStore.byNoteId?.get(enid) === e) metaStore.byNoteId.delete(enid); // 新记录同 noteId 时不误删
      }
    }
    // P2-9（对抗审查 v2）：byNoteId 是内存索引（Map），落盘剥离防写放大（读侧只认 raw.records）
    const { byNoteId: _drop, ...persistable } = metaStore;
    if (store.writeAux) store.writeAux(metaFileName(accountId), persistable);
    else store.setState(accountId, 'roaming.meta', persistable);
    return merged;
  }

  function resolveMetaRecord(metaStore, noteKey, noteId) {
    const current = metaStore.records[noteKey];
    if (current) return current;
    const normalizedNoteId = String(noteId || '').trim();
    // v1.7.4：O(1) 索引查表（语义与原线性扫一致：noteId 命中即返回该记录）
    if (normalizedNoteId && metaStore.byNoteId) {
      const hit = metaStore.byNoteId.get(normalizedNoteId);
      if (hit) return hit;
    }
    return {
      noteKey,
      noteId: normalizedNoteId || undefined,
      favorite: false,
      reviewCount: 0,
      skipCount: 0,
      openSourceCount: 0,
      seenCount: 0,
      updatedAt: 0,
    };
  }

  // ---------- 候选池（30s TTL 缓存，>20 条淘汰最旧） ----------
  function buildFilterKey(filter) {
    const noteTypes = (filter.noteTypes || []).slice().sort().join(',');
    const favoriteOnly = filter.favoriteOnly ? '1' : '0';
    const days = Number(filter.minDaysUnreviewed || 0);
    const query = String(filter.query || '').trim().toLowerCase();
    return `${noteTypes}|${favoriteOnly}|${days}|${query}`;
  }

  function matchesFilter(note, metaRecord, filter) {
    if (filter.noteTypes && filter.noteTypes.length > 0) {
      if (!filter.noteTypes.includes(toFilterType(note.type))) return false;
    }
    if (filter.favoriteOnly && !metaRecord.favorite) return false;
    if ((filter.minDaysUnreviewed || 0) > 0) {
      const thresholdMs = filter.minDaysUnreviewed * 24 * 60 * 60 * 1000;
      const lastReviewedAtMs = normalizeSecToMs(metaRecord.lastReviewedAt);
      if (lastReviewedAtMs && Date.now() - lastReviewedAtMs < thresholdMs) return false;
    }
    return true;
  }

  async function getCandidatePool(filter = {}, accountId) {
    const resolvedAccountId = resolveAccountId(accountId);
    const cacheKey = `${resolvedAccountId || 'default'}::${buildFilterKey(filter)}`;
    const cached = poolCache.get(cacheKey);
    if (cached && cached.expiresAt <= Date.now()) { poolCache.delete(cacheKey); } // C1: 过期即淘汰
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    // v1.7.3 代际守卫：池在索引重建中途构建会混合新旧快照（部分数据，表现为 1/1 而非 1/58）。
    // 构建前后对账代际，变了就重试（重建罕见，通常 0-1 次重试即可读到稳定快照）。
    let sorted;
    for (let attempt = 0; ; attempt++) {
      const genBefore = index.getIndexGeneration?.(resolvedAccountId) ?? 0;
      sorted = await buildPoolFromIndex(filter, resolvedAccountId);
      const genAfter = index.getIndexGeneration?.(resolvedAccountId) ?? 0;
      if (genBefore === genAfter || attempt >= 2) break;
    }

    poolCache.set(cacheKey, { data: sorted, expiresAt: Date.now() + POOL_CACHE_TTL_MS });
    if (poolCache.size > POOL_CACHE_MAX) {
      const oldestKey = poolCache.keys().next().value;
      if (oldestKey) poolCache.delete(oldestKey);
    }
    return sorted;
  }

  /** 关键词匹配：书名/作者/分类大小写不敏感包含（v1.7.7：/weread-roaming 关键词接通） */
  function bookMatchesQuery(book, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const title = String(book?.title ?? '').toLowerCase();
    const author = String(book?.author ?? '').toLowerCase();
    const category = String(book?.category ?? '').toLowerCase();
    return title.includes(q) || author.includes(q) || category.includes(q);
  }

  async function buildPoolFromIndex(filter, resolvedAccountId) {
    const books = await index.queryBooks(resolvedAccountId);
    const metaStore = getRoamingMetaStore(resolvedAccountId);
    const candidates = [];
    const seenKeys = new Set();
    for (const book of books) {
      if (filter.query && !bookMatchesQuery(book, filter.query)) continue;
      const notes = await index.getNotesByBookId(book.bookId, resolvedAccountId);
      for (const note of notes) {
        const bookId = String(note.bookId || book.bookId || '').trim();
        if (!bookId) continue;
        const noteKey = resolveRoamingNoteKey(note);
        if (seenKeys.has(noteKey)) continue;
        const metaRecord = resolveMetaRecord(metaStore, noteKey, note.noteId);
        if (!matchesFilter(note, metaRecord, filter)) continue;
        const rawText = normalizeRawText(note.thoughtText || note.highlightText || note.chapterTitle || '');
        if (!rawText) continue;
        seenKeys.add(noteKey);
        candidates.push({
          noteKey,
          noteId: note.noteId,
          bookId,
          bookTitle: book.title,
          bookAuthor: book.author,
          author: book.author ? String(book.author).trim() : undefined,
          category: book.category,
          chapterUid: Number(note.chapterUid || 0),
          chapterTitle: note.chapterTitle,
          noteType: note.type,
          rawText: truncateText(rawText), // C1: 只存截断文本（原文需要时按文件现读）
          text: truncateText(rawText),
          createTime: Number(note.createTime || 0),
          meta: metaRecord,
        });
      }
    }
    return candidates.sort((a, b) => b.createTime - a.createTime);
  }

  function clearPoolCache(accountId) {
    const target = resolveAccountId(accountId);
    if (!target) {
      poolCache.clear();
      return;
    }
    for (const key of Array.from(poolCache.keys())) {
      if (key.startsWith(`${target}::`)) poolCache.delete(key);
    }
  }

  // ---------- 加权轮盘抽样 ----------
  function weightedPick(items, rng) {
    const random = typeof rng === 'function' ? rng : Math.random;
    const weighted = items.map((item) => {
      const favoriteBonus = item.meta.favorite ? 1.5 : 0;
      const reviewPenalty = Math.min(item.meta.reviewCount * 0.2, 1.2);
      const skipPenalty = Math.min(item.meta.skipCount * 0.12, 1.2);
      const sourceBonus = Math.min(item.meta.openSourceCount * 0.08, 0.8);
      const score = Math.max(0.1, 1 + favoriteBonus + sourceBonus - reviewPenalty - skipPenalty);
      return { item, score };
    });
    const total = weighted.reduce((sum, cur) => sum + cur.score, 0);
    let cursor = random() * total;
    for (const entry of weighted) {
      cursor -= entry.score;
      if (cursor <= 0) return entry.item;
    }
    return weighted[weighted.length - 1].item;
  }

  /** 过滤近 20 条同笔记/同书/同章节 + lastSeenAt 冷却；全被过滤则回退全池加权抽。
   *  v0.3：到期卡（SM-2 due≤now）优先——过滤后有到期卡时取最早到期的一张，否则加权随机。 */
  function pickNext(candidates, options = {}) {
    if (!candidates || candidates.length === 0) {
      return { candidate: undefined, totalCandidates: 0, eligibleCandidates: 0, reason: 'empty_pool' };
    }
    const nowMs = options.nowMs || Date.now();
    const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const recentNotes = new Set((options.recentNoteKeys || []).filter(Boolean));
    const recentChapters = new Set((options.recentChapterKeys || []).filter(Boolean));
    const recentBooks = new Set((options.recentBookIds || []).filter(Boolean));
    const seenNotes = new Set((options.alreadySeenNoteKeys || []).filter(Boolean));
    // 复习模式：只排除本轮已出过的卡（到期卡不适用"最近看过冷却"，否则刚复习过的到期卡永远进不了队列）
    const filtered = options.reviewMode
      ? candidates.filter((item) => !seenNotes.has(item.noteKey))
      : candidates.filter((item) => {
        if (recentNotes.has(item.noteKey)) return false;
        if (recentBooks.has(item.bookId)) return false;
        if (recentChapters.has(resolveRoamingChapterKey(item))) return false;
        const lastSeenAt = item.meta.lastSeenAt || 0;
        if (lastSeenAt > 0 && nowMs - lastSeenAt < cooldownMs) return false;
        return true;
      });
    if (filtered.length === 0) {
      if (options.reviewMode) {
        return { candidate: undefined, totalCandidates: candidates.length, eligibleCandidates: 0, reason: 'review_done' };
      }
      return {
        candidate: weightedPick(candidates, options.rng),
        totalCandidates: candidates.length,
        eligibleCandidates: 0,
        reason: 'cooldown_filtered',
      };
    }
    if (options.reviewMode) {
      // 复习模式：按到期先后顺序出卡（最早到期优先）
      const sorted = [...filtered].sort((a, b) => (a.meta?.sm2Due || 0) - (b.meta?.sm2Due || 0));
      return { candidate: sorted[0], totalCandidates: candidates.length, eligibleCandidates: filtered.length };
    }
    const due = filtered.filter((item) => isDueMeta(item.meta, nowMs));
    if (due.length > 0) {
      const sorted = [...due].sort((a, b) => (a.meta?.sm2Due || 0) - (b.meta?.sm2Due || 0));
      return { candidate: sorted[0], totalCandidates: candidates.length, eligibleCandidates: filtered.length, reason: 'due_first' };
    }
    return {
      candidate: weightedPick(filtered, options.rng),
      totalCandidates: candidates.length,
      eligibleCandidates: filtered.length,
    };
  }

  async function recordAction(noteKey, action, accountId, extraPatch) {
    const resolvedAccountId = resolveAccountId(accountId);
    const now = Date.now();
    const metaStore = getRoamingMetaStore(resolvedAccountId);
    const current = metaStore.records[noteKey];
    const patch = {
      noteId: current?.noteId || noteKey,
      lastSeenAt: now,
      seenCount: (current?.seenCount || 0) + 1,
      reviewCount: (current?.reviewCount || 0) + (action === 'review' ? 1 : 0),
      skipCount: (current?.skipCount || 0) + (action === 'skip' ? 1 : 0),
      openSourceCount: (current?.openSourceCount || 0) + (action === 'openSource' ? 1 : 0),
    };
    if (action === 'review') patch.lastReviewedAt = now;
    if (action === 'favorite') {
      patch.favorite = true;
      patch.favoriteAt = now;
    }
    if (action === 'unfavorite') {
      patch.favorite = false;
      patch.favoriteAt = undefined;
    }
    if (extraPatch) Object.assign(patch, extraPatch);
    upsertRoamingNoteMeta(resolvedAccountId, noteKey, patch, metaStore);
    clearPoolCache(resolvedAccountId);
    logger('info', `[roaming] action=${action} noteKey=${noteKey} account=${resolvedAccountId || 'default'}`);
  }

  // ---------- Host 侧 SessionState（analysis-03 §5.3.1 状态机） ----------
  function emptySession(accountId) {
    return {
      accountId,
      accountName: undefined,
      pool: [],
      currentIndex: -1,
      history: [],
      filter: { noteTypes: undefined, favoriteOnly: false, minDaysUnreviewed: 7 },
      metrics: { reviewed: 0, openedSource: 0, skipped: 0 },
      statsPool: [],
      reviewMode: false, // v0.3：今日复习模式（只出到期卡，按到期顺序）
    };
  }

  // ---------- 会话持久化（roaming.<account>.session.json，重启续读） ----------
  // 只持久化 history(≤200)/currentIndex/metrics/filter；pool/statsPool 可由索引重建，不落盘。
  const sessionFileName = (accountId) => `roaming.${safeAccountId(accountId)}.session.json`;

  function persistSession(session) {
    try {
      if (store.writeAux) {
        store.writeAux(sessionFileName(session.accountId), {
          version: 1,
          savedAt: Date.now(),
          currentIndex: session.currentIndex,
          metrics: { ...session.metrics },
          filter: session.filter,
          reviewMode: !!session.reviewMode,
          history: session.history.slice(-200).map((c) => ({ ...c, meta: c.meta ? { ...c.meta } : undefined })),
        });
      }
    } catch (e) { logger('warn', `[roaming] session persist 失败：${e?.message || e}`); }
  }

  function loadPersistedSession(key) {
    try {
      if (!store.readAux) return null;
      const raw = store.readAux(sessionFileName(key), null);
      if (!raw || !Array.isArray(raw.history) || !raw.history.length) return null;
      const history = raw.history.filter((c) => c && typeof c === 'object' && c.noteKey).slice(-200);
      if (!history.length) return null;
      const session = emptySession(key);
      session.history = history;
      const idx = Number(raw.currentIndex);
      session.currentIndex = Number.isInteger(idx) ? Math.min(Math.max(idx, 0), history.length - 1) : history.length - 1;
      const m = raw.metrics || {};
      session.metrics = {
        reviewed: Math.max(0, Math.floor(Number(m.reviewed) || 0)),
        openedSource: Math.max(0, Math.floor(Number(m.openedSource) || 0)),
        skipped: Math.max(0, Math.floor(Number(m.skipped) || 0)),
      };
      if (raw.filter) session.filter = normalizeFilter(raw.filter);
      session.reviewMode = !!raw.reviewMode;
      return session;
    } catch { return null; }
  }

  /** 重启续读后池为空：按当前 filter 重建 pool/statsPool（复习模式重建为到期队列） */
  // v1.7.3：池失效时间戳——invalidatePools（索引重建）后，已建好池的活跃会话需自愈刷新，
  // 否则用户停留在漫游页时看到的还是部分池（1/1），直到手动切标签。
  let poolsInvalidatedAt = 0;
  // v1.7.5：单调时间戳——Date.now() 同毫秒内「建池↔失效」无法定序，< 判定会随机翻转
  // （直跑/CI 各一套结果；生产上同毫秒竞态会漏报过期会话）。发号严格递增，先发者必小。
  let lastStamp = 0;
  const nextStamp = () => { lastStamp = Math.max(Date.now(), lastStamp + 1); return lastStamp; };
  const markPoolsBuilt = (session) => { session.poolBuiltAt = nextStamp(); };

  async function ensurePools(session) {
    const statsPool = await getCandidatePool({}, session.accountId);
    if (!session.statsPool.length) session.statsPool = statsPool;
    if (!session.pool.length) {
      if (session.reviewMode) {
        const nowMs = Date.now();
        session.pool = statsPool
          .filter((c) => isDueMeta(c.meta, nowMs))
          .sort((a, b) => (a.meta?.sm2Due || 0) - (b.meta?.sm2Due || 0));
      } else {
        session.pool = await getCandidatePool(session.filter, session.accountId);
      }
    }
    markPoolsBuilt(session);
    return session;
  }

  /** 会话的池是否建在最近一次索引重建之前（过期 → 下次视图应自动重载） */
  function isSessionStale(session) {
    return !!session && poolsInvalidatedAt > 0 && (session.poolBuiltAt || 0) < poolsInvalidatedAt;
  }

  /** 视图取会话前调用：池为空（重启续读后台重建中）则等待建好，避免闪现 0/0 */
  async function ensurePoolsReady(key) {
    const session = getSession(key);
    if (!session.pool.length && !session.statsPool.length) await ensurePools(session).catch(() => {});
    return getSession(key);
  }

  /** 统一取会话：Map 未命中 → 尝试盘上补水（后台重建池）→ 兜底空会话 */
  function ensureLiveSession(key) {
    let session = sessions.get(key);
    if (session) return session;
    session = loadPersistedSession(key);
    if (session) {
      sessions.set(key, session);
      void ensurePools(session).catch(() => {});
    } else {
      session = emptySession(key);
    }
    return session;
  }

  function getSession(accountId) {
    const key = resolveAccountId(accountId) || 'default';
    const live = sessions.get(key);
    if (live) return live;
    const restored = loadPersistedSession(key);
    if (restored) {
      sessions.set(key, restored);
      void ensurePools(restored).catch(() => {});
      return restored;
    }
    return emptySession(key);
  }

  function setSession(accountId, session) {
    const key = resolveAccountId(accountId) || 'default';
    const next = { ...emptySession(key), ...session, accountId: key };
    sessions.set(key, next);
    return next;
  }

  function normalizeFilter(rawFilter) {
    const src = rawFilter || {};
    const noteTypes = Array.isArray(src.noteTypes)
      ? src.noteTypes.filter((t) => FILTER_NOTE_TYPES.includes(t))
      : undefined;
    const minDays = Number(src.minDaysUnreviewed);
    const query = typeof src.query === 'string' ? src.query.trim() : '';
    return {
      query: query || undefined,
      noteTypes: noteTypes && noteTypes.length > 0 ? noteTypes : undefined,
      favoriteOnly: !!src.favoriteOnly,
      minDaysUnreviewed:
        Number.isFinite(minDays) && minDays > 0 ? Math.floor(minDays) : undefined,
    };
  }

  function currentCard(session) {
    if (session.currentIndex < 0 || session.currentIndex >= session.history.length) return undefined;
    return session.history[session.currentIndex];
  }

  function recentContext(session) {
    const tail = session.history.slice(-RECENT_LIMIT);
    return {
      recentNoteKeys: tail.map((c) => c.noteKey),
      recentChapterKeys: tail.map((c) => resolveRoamingChapterKey(c)),
      recentBookIds: tail.map((c) => c.bookId),
    };
  }

  function viewSnapshot(session) {
    const nowMs = Date.now();
    const dueCount = session.statsPool.filter((c) => isDueMeta(c.meta, nowMs)).length;
    const snap = {
      card: currentCard(session),
      index: session.currentIndex + 1,
      total: session.history.length,
      poolSize: session.pool.length,
      statsPoolSize: session.statsPool.length,
      metrics: { ...session.metrics },
      filter: session.filter,
      reviewMode: !!session.reviewMode,
      dueCount,
    };
    if (session.reviewMode) {
      const seen = new Set(session.history.map((c) => c.noteKey));
      snap.dueRemaining = session.pool.filter((c) => !seen.has(c.noteKey)).length;
    }
    return snap;
  }

  /** 重载池（filter 变更/刷新）：重置 history/metrics 后立即 next */
  async function reloadSession(accountId, rawFilter) {
    const key = resolveAccountId(accountId) || 'default';
    poolCache.clear(); // v1.4.6：重载会话强制新鲜——索引部分重建瞬间构建的池不得钉死同 filter 视图
    const filter = rawFilter ? normalizeFilter(rawFilter) : undefined;
    const session = emptySession(key);
    if (filter) session.filter = filter;
    session.pool = await getCandidatePool(session.filter, key);
    session.statsPool = await getCandidatePool({}, key); // 无筛选全量池，供统计
    markPoolsBuilt(session);
    sessions.set(key, session);
    return sessionNext(key);
  }

  /** 把卡片最新 meta 同步回 session.pool/statsPool 中同 noteKey 的对象（保持统计新鲜） */
  function syncMetaToPools(session, card) {
    if (!card?.noteKey || !card.meta) return;
    for (const pool of [session.pool, session.statsPool]) {
      for (const item of pool) {
        if (item.noteKey === card.noteKey) item.meta = card.meta;
      }
    }
  }

  /** next：历史未到尾 → 回放；否则当前卡记 skip，pickNext 抽新卡（view 计数） */
  async function sessionNext(accountId) {
    const key = resolveAccountId(accountId) || 'default';
    const session = ensureLiveSession(key);
    if (!sessions.has(key)) sessions.set(key, session);
    if (session.currentIndex >= 0 && session.currentIndex < session.history.length - 1) {
      session.currentIndex += 1; // 回放历史
      persistSession(session);
      return { ...viewSnapshot(session), tip: undefined };
    }
    const current = currentCard(session);
    if (current) {
      await recordAction(current.noteKey, 'skip', key);
      if (current.meta) current.meta.skipCount = (current.meta.skipCount || 0) + 1;
      session.metrics.skipped += 1;
    }
    // 重启续读后池可能尚未重建完成：到尾部且池为空时同步等待一次
    if (!session.pool.length) {
      try { await ensurePools(session); } catch { /* 池重建失败按空池处理 */ }
    }
    const picked = pickNext(session.pool, {
      ...recentContext(session),
      cooldownMs: DEFAULT_COOLDOWN_MS,
      reviewMode: !!session.reviewMode,
      alreadySeenNoteKeys: session.reviewMode ? session.history.map((c) => c.noteKey) : undefined,
    });
    if (!picked.candidate) {
      persistSession(session);
      return { ...viewSnapshot(session), empty: true, reason: picked.reason };
    }
    session.history.push(picked.candidate);
    if (session.history.length > 200) { // C1: 历史上限，超出丢最旧
      const drop = session.history.length - 200;
      session.history.splice(0, drop);
      session.currentIndex -= drop;
    }
    session.currentIndex = session.history.length - 1;
    await recordAction(picked.candidate.noteKey, 'view', key);
    if (picked.candidate.meta) picked.candidate.meta.seenCount = (picked.candidate.meta.seenCount || 0) + 1;
    persistSession(session);
    return viewSnapshot(session);
  }

  /** prev：到头回第一条信号 */
  function sessionPrev(accountId) {
    const key = resolveAccountId(accountId) || 'default';
    const session = ensureLiveSession(key);
    if (!sessions.has(key)) sessions.set(key, session);
    if (session.currentIndex <= 0) {
      return { ...viewSnapshot(session), tip: '已经是第一条历史卡片' };
    }
    session.currentIndex -= 1;
    persistSession(session);
    return viewSnapshot(session);
  }

  function isSameNaturalDay(tsA, tsB) {
    if (!tsA || !tsB) return false;
    const a = normalizeSecToMs(tsA);
    const b = normalizeSecToMs(tsB);
    if (!a || !b) return false;
    const da = new Date(a);
    const db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  }

  /** review：同自然日幂等；v0.3 接 SM-2——grade: 'good'(默认, q=4) / 'forgot'(q=2) */
  async function sessionReview(accountId, grade) {
    const key = resolveAccountId(accountId) || 'default';
    const session = ensureLiveSession(key);
    const card = currentCard(session);
    if (!card) return { error: '当前无卡片' };
    if (isSameNaturalDay(card.meta?.lastReviewedAt, Date.now()) && !session.reviewMode) {
      return { ...viewSnapshot(session), tip: '今日已复习' };
    }
    const q = grade === 'forgot' ? 2 : 4;
    const sm2 = sm2Schedule(card.meta, q);
    await recordAction(card.noteKey, 'review', key, sm2);
    if (card.meta) {
      card.meta.lastReviewedAt = Date.now();
      card.meta.reviewCount = (card.meta.reviewCount || 0) + 1;
      Object.assign(card.meta, sm2);
    }
    syncMetaToPools(session, card);
    session.metrics.reviewed += 1;
    persistSession(session);
    const tip = q >= 3
      ? `已标记为已复习（${sm2.sm2Interval} 天后再见）`
      : '已标记为忘记（明天再来一次）';
    return { ...viewSnapshot(session), tip };
  }

  /** v0.3 今日复习：只出到期卡，按到期先后顺序 */
  async function startReviewSession(accountId) {
    const key = resolveAccountId(accountId) || 'default';
    const statsPool = await getCandidatePool({}, key);
    const nowMs = Date.now();
    const duePool = statsPool
      .filter((c) => isDueMeta(c.meta, nowMs))
      .sort((a, b) => (a.meta?.sm2Due || 0) - (b.meta?.sm2Due || 0));
    const session = emptySession(key);
    session.reviewMode = true;
    session.pool = duePool;
    session.statsPool = statsPool;
    sessions.set(key, session);
    persistSession(session);
    if (!duePool.length) return { ...viewSnapshot(session), empty: true, reason: 'no_due_cards' };
    return sessionNext(key);
  }

  /** favorite/unfavorite；favoriteOnly 下取消收藏 → 从 history 摘除当前 */
  async function sessionToggleFavorite(accountId) {
    const key = resolveAccountId(accountId) || 'default';
    const session = ensureLiveSession(key);
    const card = currentCard(session);
    if (!card) return { error: '当前无卡片' };
    const wasFavorite = !!card.meta?.favorite;
    await recordAction(card.noteKey, wasFavorite ? 'unfavorite' : 'favorite', key);
    if (card.meta) {
      card.meta.favorite = !wasFavorite;
      card.meta.favoriteAt = wasFavorite ? undefined : Date.now();
    }
    syncMetaToPools(session, card);
    if (wasFavorite && session.filter.favoriteOnly) {
      session.history.splice(session.currentIndex, 1);
      session.currentIndex = Math.min(session.currentIndex, session.history.length - 1);
      persistSession(session);
      return { ...viewSnapshot(session), tip: '已取消收藏，已移出收藏列表' };
    }
    persistSession(session);
    return { ...viewSnapshot(session), tip: wasFavorite ? '已取消收藏' : '已加入收藏' };
  }

  async function sessionOpenSource(accountId) {
    const key = resolveAccountId(accountId) || 'default';
    const session = ensureLiveSession(key);
    const card = currentCard(session);
    if (!card) return { error: '当前无卡片' };
    await recordAction(card.noteKey, 'openSource', key);
    if (card.meta) card.meta.openSourceCount = (card.meta.openSourceCount || 0) + 1;
    syncMetaToPools(session, card);
    session.metrics.openedSource += 1;
    persistSession(session);
    return { ...viewSnapshot(session), tip: '已切换到本书笔记' };
  }

  /** 统计浮层：todayReviewed/sessionViewed/favorites/openedSource/skipped/近 7 天复习 */
  function buildStats(accountId) {
    const key = resolveAccountId(accountId) || 'default';
    const session = getSession(key); // 重启续读：未命中时补水并后台重建池
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayReviewed = session.history.filter((c) => {
      const ts = normalizeSecToMs(c.meta?.lastReviewedAt);
      return ts && ts >= todayStart.getTime();
    }).length;
    const favorites = session.statsPool.filter((c) => c.meta?.favorite).length;
    const recentDailyReviews = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - i);
      const dayEnd = day.getTime() + 24 * 60 * 60 * 1000;
      const count = session.statsPool.filter((c) => {
        const ts = normalizeSecToMs(c.meta?.lastReviewedAt);
        return ts && ts >= day.getTime() && ts < dayEnd;
      }).length;
      recentDailyReviews.push({
        date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
        label: `${day.getMonth() + 1}/${day.getDate()}`,
        count,
      });
    }
    return {
      todayReviewed,
      sessionViewed: session.history.length,
      favorites,
      openedSource: session.metrics.openedSource,
      skipped: session.metrics.skipped,
      recentDailyReviews,
    };
  }

  // P1-8（对抗审查 v2）：会话写操作按账号串行化。面板/MCP/dock 多端点并发时，
  // sessionNext 中间的 await 交错点不再产生双推进；reloadSession 整体替换会话对象后，
  // 滞留旧动作的 persistSession 也不再把旧 filter/history 写回（筛选静默回退根因）。
  // 注：review 的「同日幂等豁免复习模式」保持原样——复习队列靠 seen 过滤防重复出卡，
  // 同卡当日已在普通模式复习过仍须放行评分翻页，否则复习流卡死；并发防护由本队列承担。
  const sessionQueues = new Map();
  function serializeSessionOp(accountId, fn) {
    const key = resolveAccountId(accountId) || 'default';
    const prev = sessionQueues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    sessionQueues.set(key, next.catch(() => {}));
    return next;
  }

  return {
    // 数据层（noteRoamingService 移植）
    resolveRoamingNoteKey,
    resolveRoamingChapterKey,
    getCandidatePool,
    pickNext,
    recordAction,
    clearPoolCache,
    // Host 侧 SessionState
    getSession,
    setSession,
    isSessionStale,
    ensurePoolsReady,
    invalidatePools: () => { poolCache.clear(); poolsInvalidatedAt = nextStamp(); }, // v1.4.6+1.7.3+1.7.5：清缓存 + 标记活跃会话过期（视图层自愈；单调发号防同毫秒竞态）
    // 写操作统一走串行队列（P1-8）；内部互调（reloadSession→sessionNext 等）用原函数避免死锁
    reloadSession: (accountId, rawFilter) => serializeSessionOp(accountId, () => reloadSession(accountId, rawFilter)),
    sessionNext: (accountId) => serializeSessionOp(accountId, () => sessionNext(accountId)),
    sessionPrev: (accountId) => serializeSessionOp(accountId, () => sessionPrev(accountId)),
    sessionReview: (accountId, grade) => serializeSessionOp(accountId, () => sessionReview(accountId, grade)),
    sessionToggleFavorite: (accountId) => serializeSessionOp(accountId, () => sessionToggleFavorite(accountId)),
    sessionOpenSource: (accountId) => serializeSessionOp(accountId, () => sessionOpenSource(accountId)),
    startReviewSession: (accountId) => serializeSessionOp(accountId, () => startReviewSession(accountId)),
    buildStats,
    normalizeFilter,
  };
}
