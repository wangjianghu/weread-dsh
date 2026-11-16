// lib/analytics.js —— 阅读洞察（weread-vscode analyticsService 移植，公式照搬 analysis-03 §4）
// 数据源 index.queryBooks + index.getNotesByBookId，纯函数计算 + 结果缓存。

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function toPercent(value) {
  return round2(value * 100);
}

function clampRate(progress) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(timestamp) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(timestamp) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.getTime();
}

function getIsoWeek(date) {
  const working = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = working.getUTCDay() || 7;
  working.setUTCDate(working.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(working.getUTCFullYear(), 0, 1));
  return Math.ceil(((working.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

function formatWeekLabel(weekStartTs) {
  const d = new Date(weekStartTs);
  return `${d.getFullYear()}-W${String(getIsoWeek(d)).padStart(2, '0')}`;
}

function noteTimestampMs(note) {
  const raw = note.modifyTime || note.createTime || 0;
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
}

function normalizeBookTimestamp(raw) {
  if (!raw || !Number.isFinite(raw)) return 0;
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
}

function isDeepNote(note) {
  const thoughtLength = (note.thoughtText || '').trim().length;
  const highlightLength = (note.highlightText || '').trim().length;
  return thoughtLength >= 50 || highlightLength >= 100;
}

function extractTotalPages(book) {
  const raw = book.totalPages ?? book.total_pages ?? book.pageCount ?? 0;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Number(raw));
}

function normalizeScore(notesCount, deepNoteRatio, completionRate) {
  const notesScore = Math.min(100, notesCount * 5);
  return notesScore * 0.5 + deepNoteRatio * 0.3 + completionRate * 0.2;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function trimText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function resolveBookCategory(book) {
  return (book.category || '').trim() || '未分类';
}

function resolveNoteTypeLabel(note) {
  if (note.thoughtText && note.highlightText) return '划线+想法';
  if (note.thoughtText) return '想法';
  if (note.highlightText) return '划线';
  return '笔记';
}

function matchesNoteType(note, noteType) {
  if (noteType === 'all') return true;
  if (noteType === 'highlight') return note.type === 1;
  if (noteType === 'thought') return note.type === 2;
  if (noteType === 'chapter') return note.type === 3;
  return note.type === 4;
}

function normalizeDays(days) {
  if (!Number.isFinite(days) || days === 0) return 0;
  return Math.max(1, Math.floor(days));
}

function normalizeNoteType(noteType) {
  if (noteType === 'highlight' || noteType === 'thought' || noteType === 'chapter' || noteType === 'review') {
    return noteType;
  }
  return 'all';
}

function normalizeFilter(filter) {
  const f = filter || {};
  return {
    days: normalizeDays(f.days),
    category: (f.category || '').trim(),
    finishedOnly: !!f.finishedOnly,
    noteType: normalizeNoteType(f.noteType),
    trendGranularity: f.trendGranularity === 'week' ? 'week' : 'day',
  };
}

function serializeFilter(filter) {
  return `${filter.days}|${filter.category}|${filter.finishedOnly ? 1 : 0}|${filter.noteType}|${filter.trendGranularity}`;
}

function resolveStartAt(books, noteMap, now, days) {
  if (days > 0) return startOfDay(now - (days - 1) * DAY_MS);
  const noteTimestamps = Object.values(noteMap)
    .flat()
    .map((note) => noteTimestampMs(note))
    .filter((ts) => ts > 0);
  const bookTimestamps = books
    .map((book) => normalizeBookTimestamp(book.lastReadTime))
    .filter((ts) => ts > 0);
  const all = [...noteTimestamps, ...bookTimestamps];
  if (all.length === 0) return startOfDay(now);
  const earliest = Math.min(...all, now);
  return startOfDay(earliest);
}

function calculateLongestStreak(dayKeys) {
  if (dayKeys.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < dayKeys.length; i++) {
    const prev = new Date(`${dayKeys[i - 1]}T00:00:00`);
    const curr = new Date(`${dayKeys[i]}T00:00:00`);
    if (Number.isNaN(prev.getTime()) || Number.isNaN(curr.getTime())) continue;
    const diff = Math.round((curr.getTime() - prev.getTime()) / DAY_MS);
    if (diff === 1) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

function groupByBook(notes) {
  const map = new Map();
  for (const note of notes) {
    const list = map.get(note.bookId);
    if (list) list.push(note);
    else map.set(note.bookId, [note]);
  }
  return map;
}

function collectCategories(books) {
  return Array.from(new Set(books.map(resolveBookCategory).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN')
  );
}

function buildKpis(books, scopedNotes, notesByBook) {
  // v1.8.15：活跃日/连续天数只统计有时间戳的笔记（ts<=0 不产生 1970-01-01 假日）
  const dayKeys = Array.from(
    new Set(
      scopedNotes
        .filter((n) => noteTimestampMs(n) > 0)
        .map((n) => formatDate(noteTimestampMs(n)))
        .filter(Boolean)
    )
  ).sort();
  const activeDays = dayKeys.length;
  const longestStreakDays = calculateLongestStreak(dayKeys);
  const totalNotes = scopedNotes.length;
  const estimatedReadPages = books.reduce((sum, book) => {
    const totalPages = extractTotalPages(book);
    if (totalPages <= 0) return sum;
    return sum + totalPages * (clampRate(book.progress) / 100);
  }, 0);
  const noteDensityPer100Pages =
    estimatedReadPages <= 0 ? 0 : round2((totalNotes / Math.max(1, estimatedReadPages)) * 100);
  const deepNotes = scopedNotes.filter(isDeepNote).length;
  const deepNoteRatio = toPercent(totalNotes === 0 ? 0 : deepNotes / totalNotes);
  const completionRates = books.map((b) => clampRate(b.progress)).filter((rate) => rate > 0);
  const averageCompletionRate =
    completionRates.length === 0
      ? 0
      : round2(completionRates.reduce((s, r) => s + r, 0) / completionRates.length);
  const touchedBooks = notesByBook.size;
  const averageNotesPerBook = touchedBooks === 0 ? 0 : round2(totalNotes / touchedBooks);
  return {
    activeDays,
    longestStreakDays,
    totalNotes,
    noteDensityPer100Pages,
    deepNoteRatio,
    averageCompletionRate,
    averageNotesPerBook,
  };
}

function buildDailyTrend(notes, startAt, days) {
  const bucket = new Map();
  for (let i = 0; i < days; i++) {
    bucket.set(formatDate(startAt + i * DAY_MS), { notesCount: 0, books: new Set() });
  }
  for (const note of notes) {
    const item = bucket.get(formatDate(noteTimestampMs(note)));
    if (!item) continue;
    item.notesCount += 1;
    item.books.add(note.bookId);
  }
  return Array.from(bucket.entries()).map(([date, v]) => ({
    date, notesCount: v.notesCount, touchedBooks: v.books.size,
  }));
}

function buildWeeklyTrend(notes, startAt, days) {
  const startWeek = startOfWeek(startAt);
  const endWeek = startOfWeek(startAt + (days - 1) * DAY_MS);
  const bucket = new Map();
  for (let cursor = startWeek; cursor <= endWeek; cursor += 7 * DAY_MS) {
    bucket.set(formatWeekLabel(cursor), { notesCount: 0, books: new Set() });
  }
  for (const note of notes) {
    const item = bucket.get(formatWeekLabel(startOfWeek(noteTimestampMs(note))));
    if (!item) continue;
    item.notesCount += 1;
    item.books.add(note.bookId);
  }
  return Array.from(bucket.entries()).map(([date, v]) => ({
    date, notesCount: v.notesCount, touchedBooks: v.books.size,
  }));
}

function buildHeatmap(notes) {
  const counter = new Map();
  for (let weekDay = 0; weekDay < 7; weekDay++) {
    for (let hour = 0; hour < 24; hour++) counter.set(`${weekDay}-${hour}`, 0);
  }
  for (const note of notes) {
    const ts = noteTimestampMs(note);
    if (ts <= 0) continue; // v1.8.15：未知时间不落格（否则 epoch 0 → 周四 08:00 假热区）
    const d = new Date(ts);
    const key = `${d.getDay()}-${d.getHours()}`;
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  const cells = [];
  for (let weekDay = 0; weekDay < 7; weekDay++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ weekDay, hour, value: counter.get(`${weekDay}-${hour}`) || 0 });
    }
  }
  return cells;
}

function buildCategoryShare(books, notesByBook) {
  const buckets = new Map();
  for (const book of books) {
    const category = (book.category || '未分类').trim() || '未分类';
    const current = buckets.get(category) || { readBooks: 0, notesCount: 0 };
    current.readBooks += 1;
    current.notesCount += notesByBook.get(book.bookId)?.length || 0;
    buckets.set(category, current);
  }
  const allItems = Array.from(buckets.entries())
    .map(([category, v]) => ({ category, readBooks: v.readBooks, notesCount: v.notesCount }))
    .sort((a, b) => b.notesCount - a.notesCount);
  if (allItems.length <= 12) return allItems;
  const top11 = allItems.slice(0, 11);
  const others = allItems.slice(11);
  const othersNotesCount = others.reduce((s, i) => s + i.notesCount, 0);
  const othersReadBooks = others.reduce((s, i) => s + i.readBooks, 0);
  if (othersNotesCount > 0 || othersReadBooks > 0) {
    top11.push({ category: '其他', readBooks: othersReadBooks, notesCount: othersNotesCount });
  }
  return top11;
}

function resolveQuadrant(readingTime, noteDensity, readingMedian, densityMedian) {
  const highTime = readingTime >= readingMedian;
  const highDensity = noteDensity >= densityMedian;
  if (highTime && highDensity) return 'high_value';
  if (!highTime && highDensity) return 'high_density';
  if (highTime && !highDensity) return 'high_time';
  return 'low_value';
}

function buildScatter(books, notesByBook) {
  const raw = books
    .map((book) => {
      const notesCount = notesByBook.get(book.bookId)?.length || 0;
      if (notesCount <= 0) return undefined;
      const readingTime = Math.max(0, Number(book.readingTime || 0));
      const totalPages = extractTotalPages(book);
      const readPages = totalPages * (clampRate(book.progress) / 100);
      const noteDensity = readPages > 0 ? round2((notesCount / readPages) * 100) : 0;
      const pseudoX = readingTime > 0 ? readingTime : Math.max(0.1, round2(notesCount * 0.1));
      return { bookId: book.bookId, title: book.title, readingTime: pseudoX, noteDensity };
    })
    .filter(Boolean);
  if (raw.length === 0) return [];
  const readingMedian = percentile(raw.map((i) => i.readingTime), 0.5);
  const densityMedian = percentile(raw.map((i) => i.noteDensity), 0.5);
  return raw
    .sort((a, b) => (b.noteDensity !== a.noteDensity ? b.noteDensity - a.noteDensity : b.readingTime - a.readingTime))
    .map((item) => ({
      ...item,
      quadrant: resolveQuadrant(item.readingTime, item.noteDensity, readingMedian, densityMedian),
    }))
    .slice(0, 60);
}

function buildTopBooks(books, notesByBook) {
  const bookMap = new Map(books.map((b) => [b.bookId, b]));
  const items = [];
  for (const [bookId, notes] of notesByBook.entries()) {
    const book = bookMap.get(bookId);
    if (!book) continue;
    const notesCount = notes.length;
    const completionRate = clampRate(book.progress);
    const deepCount = notes.filter(isDeepNote).length;
    const deepNoteRatio = toPercent(notesCount === 0 ? 0 : deepCount / notesCount);
    items.push({
      bookId,
      title: book.title,
      author: book.author,
      completionRate,
      notesCount,
      deepNoteRatio,
      valueScore: round2(normalizeScore(notesCount, deepNoteRatio, completionRate)),
    });
  }
  return items.sort((a, b) => b.valueScore - a.valueScore).slice(0, 10);
}

function buildTimeline(notes, books) {
  const bookMap = new Map(books.map((b) => [b.bookId, b]));
  // v1.8.15：创建时间未知（0）的笔记置于最前——它们只产生于「上次同步后新建、真实时间尚未到达」
  // 的场景（web 通道新管线划线），按最近笔记时间线语义属于最新批次；若垫底会被 top-50 截断隐藏。
  // 已知时间照旧降序。客户端对 createdAt=0 渲染为空时间。
  const unknown = notes.filter((note) => noteTimestampMs(note) <= 0);
  const timed = notes
    .filter((note) => noteTimestampMs(note) > 0)
    .sort((a, b) => noteTimestampMs(b) - noteTimestampMs(a))
    .slice(0, Math.max(0, 50 - unknown.length));
  return [...unknown, ...timed].slice(0, 50).map((note) => ({
    noteId: note.noteId,
    bookId: note.bookId,
    bookTitle: bookMap.get(note.bookId)?.title || '未知书籍',
    chapterTitle: note.chapterTitle || '未分类章节',
    noteType: resolveNoteTypeLabel(note),
    highlightText: trimText(note.highlightText || '', 120),
    thoughtText: trimText(note.thoughtText || '', 120),
    createdAt: noteTimestampMs(note),
  }));
}

function buildAuthorCloud(books) {
  const authorMap = new Map();
  for (const book of books) {
    if (!book.author) continue;
    for (const author of book.author.split(/[,\s]+/).map((a) => a.trim()).filter(Boolean)) {
      if (!author || author === '无') continue;
      authorMap.set(author, (authorMap.get(author) || 0) + 1);
    }
  }
  return Array.from(authorMap.entries())
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
}

function buildCategoryRadar(books) {
  const firstLevelMap = new Map();
  const secondLevelMap = new Map();
  for (const book of books) {
    const rawCat = (book.category || '未分类').trim() || '未分类';
    const parts = rawCat.split(/[-_/\\]+/);
    const firstLevel = parts[0] || '未分类';
    const secondLevel = parts.length > 1 ? parts[1] : firstLevel;
    firstLevelMap.set(firstLevel, (firstLevelMap.get(firstLevel) || 0) + 1);
    secondLevelMap.set(secondLevel, (secondLevelMap.get(secondLevel) || 0) + 1);
  }
  const items = [];
  for (const [category, count] of firstLevelMap.entries()) items.push({ category, count, level: 1 });
  for (const [category, count] of secondLevelMap.entries()) items.push({ category, count, level: 2 });
  return items.sort((a, b) => b.count - a.count);
}

/** @param {{index:{queryBooks:Function,getNotesByBookId:Function}}} deps */
export function createAnalyticsService({ index }) {
  const cache = new Map(); // LRU：容量 12（原版仅存 1 条，筛选来回切换互相驱逐）
  const CHEAP_SIG = new Map(); // accountId -> 廉价数据版本（snapshot.builtAt|书数），命中跳过全库 IO

  function buildIndexDataVersion(books, noteMap, accountId) {
    const noteBookCount = Object.keys(noteMap).length;
    const noteCount = Object.values(noteMap).reduce((s, notes) => s + notes.length, 0);
    const latestBookTs = books.reduce((m, b) => Math.max(m, normalizeBookTimestamp(b.lastReadTime)), 0);
    return `${String(accountId || 'default')}|${latestBookTs}|${books.length}|${noteBookCount}|${noteCount}`;
  }

  function computeDashboardData(filter, allBooks, noteMap, dataKey, accountId, expectedQuickKey) {
    const normalizedFilter = normalizeFilter(filter);
    const cacheKey = `${String(accountId || 'default')}::${dataKey}::${serializeFilter(normalizedFilter)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const now = Date.now();
    const days = normalizedFilter.days;
    const startAt = resolveStartAt(allBooks, noteMap, now, days);
    const scopedDays = Math.max(1, Math.floor((startOfDay(now) - startAt) / DAY_MS) + 1);
    const availableCategories = collectCategories(allBooks);

    const scopedBooks = allBooks.filter((book) => {
      if (normalizedFilter.category && normalizedFilter.category !== 'all' && resolveBookCategory(book) !== normalizedFilter.category) {
        return false;
      }
      if (!normalizedFilter.finishedOnly) return true;
      return book.readingStatus === 2 || clampRate(book.progress) >= 100;
    });
    const scopedBookIds = new Set(scopedBooks.map((b) => b.bookId));

    const scopedNotes = Object.values(noteMap)
      .flat()
      .filter((note) => {
        const ts = noteTimestampMs(note);
        // v1.8.15：创建时间未知（ts<=0，web 通道新管线划线无 createTime）不参与时间窗判定——
        // 不知何时创建即不断言进出窗（刚同步的新划线不能从时间线消失）；
        // 时间聚合（趋势/热力/活跃日）在各 builder 内跳过 ts<=0，不产生 1970 桶。
        if (ts > 0 && (ts < startAt || ts > now)) return false;
        if (!scopedBookIds.has(note.bookId)) return false;
        return matchesNoteType(note, normalizedFilter.noteType);
      });

    const notesByBook = groupByBook(scopedNotes);
    const result = {
      filter: normalizedFilter,
      availableCategories,
      kpis: buildKpis(scopedBooks, scopedNotes, notesByBook),
      trend:
        normalizedFilter.trendGranularity === 'week'
          ? buildWeeklyTrend(scopedNotes, startAt, scopedDays)
          : buildDailyTrend(scopedNotes, startAt, scopedDays),
      heatmap: buildHeatmap(scopedNotes),
      categoryShare: buildCategoryShare(scopedBooks, notesByBook),
      scatter: buildScatter(scopedBooks, notesByBook),
      topBooks: buildTopBooks(scopedBooks, notesByBook),
      timeline: buildTimeline(scopedNotes, scopedBooks),
      authorCloud: buildAuthorCloud(scopedBooks),
      categoryRadar: buildCategoryRadar(scopedBooks),
    };
    // LRU 12 条：淘汰最旧，保留多筛选来回切换的命中
    cache.set(cacheKey, result);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    // 同步写入廉价预检键（同一份结果两个键都能命中）
    // P2-11（对抗审查 v2）：CHEAP_SIG 是单槽——并发不同 filter 请求交错时槽内 key 可能已被后者覆盖；
    // 仅当槽内 key 仍是本次请求预检写入的那个才落 quickKey，否则跳过（结果照常返回，不污染缓存）
    try {
      const acc = String(accountId || 'default');
      const quickKey = CHEAP_SIG.get(acc);
      if (quickKey && quickKey === expectedQuickKey && !cache.has(quickKey)) {
        cache.set(quickKey, result);
        if (cache.size > 12) cache.delete(cache.keys().next().value);
      }
    } catch { /* ignore */ }
    return result;
  }

  /**
   * 索引路径取数（原 getDashboardDataFromIndex）：账号结果为空时回退默认作用域。
   * @param {{days?:number,category?:string,finishedOnly?:boolean,noteType?:string,trendGranularity?:'day'|'week'}} filter
   */
  async function getDashboardData(filter, accountId) {
    const targetAccountId = String(accountId || '').trim() || undefined;
    // B5: 廉价预检——数据版本（snapshot 指纹）未变且已有该 (版本,filter) 缓存 → 直接返回，跳过全库 IO
    let cheapSig = null;
    let myQuickKey = null; // P2-11：本次请求预检写入的 quickKey，完成时校验槽内 key 未被并发请求换掉
    try { cheapSig = index.getSnapshotSignature?.(targetAccountId) ?? null; } catch { cheapSig = null; }
    if (cheapSig) {
      const normalized = normalizeFilter(filter);
      const quickKey = `${String(targetAccountId || 'default')}::sig:${cheapSig}::${serializeFilter(normalized)}`;
      const hit = cache.get(quickKey);
      if (hit) { cache.delete(quickKey); cache.set(quickKey, hit); return hit; }
      CHEAP_SIG.set(String(targetAccountId || 'default'), quickKey);
      myQuickKey = quickKey;
    }
    const allBooks = await index.queryBooks(targetAccountId);
    if (targetAccountId && allBooks.length === 0) {
      const fallbackBooks = await index.queryBooks(undefined);
      if (fallbackBooks.length > 0) {
        const fallbackNoteMap = {};
        for (const book of fallbackBooks) {
          fallbackNoteMap[book.bookId] = await index.getNotesByBookId(book.bookId, undefined);
        }
        return computeDashboardData(filter, fallbackBooks, fallbackNoteMap, buildIndexDataVersion(fallbackBooks, fallbackNoteMap, undefined), undefined);
      }
    }
    const noteMap = {};
    for (const book of allBooks) {
      noteMap[book.bookId] = await index.getNotesByBookId(book.bookId, targetAccountId);
    }
    return computeDashboardData(filter, allBooks, noteMap, buildIndexDataVersion(allBooks, noteMap, targetAccountId), targetAccountId, myQuickKey);
  }

  function clearCache() {
    cache.clear();
  }

  return { getDashboardData, clearCache };
}
