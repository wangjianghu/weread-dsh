// lib/indexsvc.js —— 文件真源索引（weread-vscode indexService/indexDedup 移植）
// Node ESM，零依赖。契约见 docs/design-dsh-mapping.md §3。

import fs from 'node:fs';
import path from 'node:path';

export const CURRENT_INDEX_SCHEMA_VERSION = 1;

const SKIP_DIRS = new Set(['阅读洞察报告', '._weread_trash', 'accounts']);

/** 与原版 utils/bookId.normalizeBookId 一致 */
export function normalizeBookId(raw) {
  const s = String(raw || '');
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').trim() || `local_${Date.now()}`;
}

/**
 * 索引去重：key = bookId || rawBookId || filePath；
 * 冲突保留 lastReadTime 大者（newer_last_read），相等保留 fileMtimeMs 大者
 * （newer_file_mtime），否则保留已有（kept_existing）。
 */
export function dedupeIndexBooks(entries, onConflict) {
  const merged = new Map();
  for (const entry of entries) {
    const key = entry.bookId || entry.rawBookId || entry.filePath;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, entry);
      continue;
    }
    const prevLastRead = prev.lastReadTime || 0;
    const nextLastRead = entry.lastReadTime || 0;
    if (nextLastRead > prevLastRead) {
      merged.set(key, entry);
      onConflict?.({ key, kept: entry, dropped: prev, reason: 'newer_last_read' });
      continue;
    }
    if (nextLastRead === prevLastRead && entry.fileMtimeMs > prev.fileMtimeMs) {
      merged.set(key, entry);
      onConflict?.({ key, kept: entry, dropped: prev, reason: 'newer_file_mtime' });
      continue;
    }
    onConflict?.({ key, kept: prev, dropped: entry, reason: 'kept_existing' });
  }
  return Array.from(merged.values());
}

/** 增量重解析判定：无 prev 或 mtime/size 变化 */
export function shouldReparseFile(previous, next) {
  if (!previous) return true;
  return previous.fileMtimeMs !== next.fileMtimeMs || previous.fileSize !== next.fileSize;
}

function toIndexEntry(book, stat, filePath) {
  return {
    bookId: book.bookId,
    rawBookId: book.rawBookId,
    title: book.title,
    author: book.author,
    category: book.category,
    noteCount: book.noteCount || 0,
    highlightCount: book.highlightCount || 0,
    lastReadTime: book.lastReadTime,
    cover: book.cover || '',
    progress: book.progress || 0,
    readingStatus: book.readingStatus || 0,
    filePath,
    fileMtimeMs: Number(stat.mtimeMs || 0),
    fileSize: Number(stat.size || 0),
  };
}

function toBook(entry) {
  return {
    bookId: entry.bookId,
    rawBookId: entry.rawBookId,
    title: entry.title,
    author: entry.author || '',
    category: entry.category || '未分类',
    noteCount: entry.noteCount || 0,
    highlightCount: entry.highlightCount || 0,
    lastReadTime: entry.lastReadTime,
    localFilePath: entry.filePath,
    cover: entry.cover || '',
    reviewCount: 0,
    progress: entry.progress || 0,
    readingStatus: entry.readingStatus || 0,
    totalReadDay: 0,
    readingTime: 0,
  };
}

/**
 * @param {{store:{getState:Function,setState:Function,getActiveAccountId:Function},
 *          markdown:{parseBookMarkdownContent:Function},
 *          configGetter:()=>{outputPath:string}, log:Function}} deps
 */
export function createIndexService({ store, markdown, configGetter, log, onRebuilt }) {
  const logger = typeof log === 'function' ? log : () => {};
  const deps = { onRebuilt }; // v1.4.6：索引内容变化重建后的通知（漫游池缓存失效等）

  function resolveAccountId(accountId) {
    const normalized = String(accountId || '').trim();
    if (normalized) return normalized;
    const active = store.getActiveAccountId?.();
    return String(active || '').trim() || undefined;
  }

  /** 账号目录存在 → 双根 [accounts/<id>, outputPath]（根跳过 accounts 子树）；否则 [outputPath] */
  function resolveScanRoots(accountId) {
    const config = configGetter() || {};
    const basePath = String(config.outputPath || '').trim();
    if (!basePath) return [];
    const base = path.resolve(basePath);
    const normalized = String(accountId || '').trim().replace(/[^\w.-]/g, '_'); // P0-2：入路径前清洗，防路径穿越
    const roots = [];
    if (normalized) {
      const accountPath = path.join(base, 'accounts', normalized);
      if (fs.existsSync(accountPath)) {
        roots.push({ root: path.resolve(accountPath), isAccountRoot: true });
      }
    }
    roots.push({ root: base, isAccountRoot: false });
    return roots;
  }

  async function collectMarkdownFiles(rootPath, isAccountRoot) {
    const result = [];
    const stack = [{ current: rootPath, skipAccounts: isAccountRoot }];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame?.current) continue;
      let entries;
      try {
        entries = await fs.promises.readdir(frame.current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(frame.current, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue; // 阅读洞察报告/._weread_trash/accounts
          stack.push({ current: fullPath, skipAccounts: frame.skipAccounts });
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          result.push(path.resolve(fullPath));
        }
      }
    }
    return result;
  }

  async function buildFromRoots(roots, options = {}) {
    const previousSnapshot = options.previousSnapshot
      ?? getSnapshot(resolveAccountId(options.accountId));
    const scanStart = Date.now();
    const seen = new Set();
    const files = [];
    for (const { root, isAccountRoot } of roots) {
      for (const filePath of await collectMarkdownFiles(root, isAccountRoot)) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        files.push(filePath);
      }
    }
    const books = [];
    const errors = [];
    const prevEntries = new Map((previousSnapshot?.books || []).map((e) => [e.filePath, e]));
    for (const filePath of files) {
      try {
        const stat = await fs.promises.stat(filePath);
        const prev = prevEntries.get(filePath);
        if (prev && !shouldReparseFile(prev, { fileMtimeMs: Number(stat.mtimeMs || 0), fileSize: Number(stat.size || 0) })) {
          books.push(prev); // mtime/size 未变：复用旧 entry，跳过读盘解析
          continue;
        }
        const parsed = await parseFileCached(filePath);
        if (!parsed) continue;
        books.push(toIndexEntry(parsed.book, stat, filePath));
      } catch (error) {
        errors.push({
          filePath,
          code: 'file_parse_failed',
          message: error instanceof Error ? error.message : '解析失败',
        });
      }
    }
    const conflicts = [];
    const deduped = dedupeIndexBooks(books, (c) => conflicts.push(c));
    if (conflicts.length > 0) {
      const lines = [`[index.dedupe] source=indexService.buildFromRoots collapsed=${conflicts.length}`];
      for (const c of conflicts) {
        lines.push(
          `[index.dedupe.item] key=${c.key} dropped=${c.dropped.filePath} kept=${c.kept.filePath} reason=${c.reason}`
        );
      }
      logger('info', lines.join('\n'));
    }
    deduped.sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0));
    const firstRoot = roots.length > 0 ? roots[0].root : '';
    const snapshot = {
      schemaVersion: CURRENT_INDEX_SCHEMA_VERSION,
      outputPath: firstRoot,
      builtAt: Date.now(),
      books: deduped,
      errors,
    };
    const scanState = {
      lastScanAt: Date.now(),
      durationMs: Date.now() - scanStart,
      outputPath: firstRoot,
      scannedFiles: files.length,
      changedFiles: files.length,
      errorCount: errors.length,
    };
    return { snapshot, scanState };
  }

  // v1.7.5：代际计数——快照每次落盘（= 读方可见内容的原子交换点）自增。
  // 漫游池构建前后对账：代际变了说明池是在重建中途读的（混合新旧快照=部分数据），需重试。
  const indexGeneration = new Map();
  // v1.7.5：快照拆独立 aux 文件（C3 模式）。原 setState 连带 state.<account>.json 其他键全量重写
  // （2000 书 ≈ MB 级 pretty JSON），一轮同步 ≥5 次写 = 50-100ms 分散阻塞事件循环。
  const snapshotAuxName = (accountId) => `index.${String(accountId || 'default').replace(/[^\w.-]+/g, '_')}.snapshot.json`;
  function readSnapshotAux(accountId) {
    if (!store.readAux) return undefined;
    const raw = store.readAux(snapshotAuxName(accountId), undefined);
    const snap = raw?.snapshot;
    return snap && Array.isArray(snap.books) ? snap : undefined;
  }
  async function persistBuildResult(accountId, built) {
    const resolved = resolveAccountId(accountId);
    if (store.writeAux) {
      store.writeAux(snapshotAuxName(resolved), { version: 1, savedAt: Date.now(), snapshot: built.snapshot, scanState: built.scanState });
    } else { // 无 aux 通道的环境（测试桩）退回 scoped KV
      store.setState(accountId, 'index.snapshot', built.snapshot);
      store.setState(accountId, 'index.scanState', built.scanState);
    }
    indexGeneration.set(resolved, (indexGeneration.get(resolved) || 0) + 1);
  }
  function getIndexGeneration(accountId) {
    return indexGeneration.get(resolveAccountId(accountId)) || 0;
  }

  async function rebuildFromConfiguredPath(accountId, options = {}) {
    const resolved = resolveAccountId(accountId);
    const roots = resolveScanRoots(resolved);
    if (roots.length === 0) {
      return { booksCount: 0, notesCount: 0 };
    }
    const prev = getSnapshot(resolved);
    const built = await buildFromRoots(roots, { previousSnapshot: prev, accountId: resolved });
    // B3：内容指纹未变时跳过落盘（watch 自触发的冗余 rebuild）
    if (options.skipIfUnchanged && prev && entriesSignature(prev.books) === entriesSignature(built.snapshot.books)) {
      return { booksCount: prev.books.length, notesCount: prev.books.reduce((sum, b) => sum + (b.noteCount || 0), 0), unchanged: true };
    }
    await persistBuildResult(resolved, built);
    // v1.4.6：内容确实变化的重建 → 通知依赖方（漫游池缓存失效），防止部分重建瞬间的池被 TTL 缓存钉死
    try { deps.onRebuilt?.(resolved, built.snapshot); } catch { /* 回调异常不影响索引 */ }
    return {
      booksCount: built.snapshot.books.length,
      notesCount: built.snapshot.books.reduce((sum, b) => sum + (b.noteCount || 0), 0),
    };
  }

  /** 不落盘预览 */
  async function previewFromOutputPath(outputPath, accountId) {
    const resolvedRoots = String(outputPath || '').trim()
      ? [{ root: path.resolve(outputPath), isAccountRoot: false }]
      : resolveScanRoots(resolveAccountId(accountId));
    if (resolvedRoots.length === 0) {
      return { snapshot: undefined, scanState: undefined };
    }
    return buildFromRoots(resolvedRoots);
  }

  function getSnapshot(accountId) {
    const resolved = resolveAccountId(accountId);
    let snapshot = readSnapshotAux(resolved);
    if (!snapshot) {
      // v1.7.5 迁移：旧版快照存在 state.<account>.json → 搬到独立小文件并从大文件移除
      const legacy = store.getState(resolved, 'index.snapshot', undefined);
      if (legacy && Array.isArray(legacy.books)) {
        if (store.writeAux) store.writeAux(snapshotAuxName(resolved), { version: 1, savedAt: Date.now(), snapshot: legacy });
        try {
          store.setState(resolved, 'index.snapshot', undefined); // store 契约：undefined = 删键
          store.setState(resolved, 'index.scanState', undefined);
        } catch { /* 删键失败不影响读 */ }
        snapshot = legacy;
      }
    }
    if (!snapshot) return undefined;
    // 账号快照为空 → 回退默认（无 accountId）作用域
    if (resolved && (!snapshot.books || snapshot.books.length === 0)) {
      const fallback = readSnapshotAux(undefined)
        ?? store.getState(undefined, 'index.snapshot', undefined);
      if (fallback && fallback.books && fallback.books.length > 0) {
        snapshot = fallback;
      }
    }
    return snapshot;
  }

  let queryMemo = { snapshotRef: null, books: null };
  async function queryBooks(accountId) {
    const resolved = resolveAccountId(accountId);
    let snapshot = getSnapshot(resolved);
    if (!snapshot) {
      await rebuildFromConfiguredPath(resolved);
      snapshot = getSnapshot(resolved);
    }
    if (!snapshot) return [];
    if (queryMemo.snapshotRef === snapshot && queryMemo.books) return queryMemo.books;
    const books = dedupeIndexBooks(snapshot.books)
      .sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0))
      .map((entry) => toBook(entry));
    queryMemo = { snapshotRef: snapshot, books };
    return books;
  }

  // 文件解析缓存：filePath -> {sig, book, notes}；mtime/size 未变直接复用（热路径去双读双解析）
  const parseCache = new Map();
  async function parseFileCached(filePath) {
    let sig;
    try {
      const st = await fs.promises.stat(filePath);
      sig = `${st.mtimeMs}:${st.size}`;
    } catch {
      return undefined;
    }
    const hit = parseCache.get(filePath);
    if (hit && hit.sig === sig) return hit;
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = markdown.parseBookMarkdownContent(content, filePath);
      if (!parsed) return undefined;
      const entry = { sig, book: parsed.book, notes: parsed.notes || [] };
      parseCache.set(filePath, entry);
      if (parseCache.size > 600) parseCache.delete(parseCache.keys().next().value);
      return entry;
    } catch {
      return undefined;
    }
  }
  function entriesSignature(books) {
    let n = 0;
    for (const b of books) n = (n * 31 + (b.filePath.length + b.fileMtimeMs + b.fileSize)) | 0;
    return `${books.length}:${n}`;
  }

  async function getBookById(bookId, accountId) {
    const resolved = resolveAccountId(accountId);
    const normalizedId = normalizeBookId(bookId);
    let snapshot = getSnapshot(resolved);
    if (!snapshot) {
      await rebuildFromConfiguredPath(resolved);
      snapshot = getSnapshot(resolved);
    }
    const hit = snapshot?.books.find(
      (item) => item.bookId === normalizedId || item.rawBookId === bookId
    );
    if (!hit) return undefined;
    const cached = await parseFileCached(hit.filePath);
    if (cached?.book) return cached.book;
    return toBook(hit);
  }

  async function getNotesByBookId(bookId, accountId) {
    const book = await getBookById(bookId, resolveAccountId(accountId));
    if (!book?.localFilePath) return (await parseFileCached(book?.localFilePath))?.notes || [];
    const cached = await parseFileCached(book.localFilePath);
    return cached?.notes || [];
  }

  function getIndexSnapshot(accountId) {
    return getSnapshot(resolveAccountId(accountId));
  }

  /** 廉价数据指纹：供 analytics 预检缓存（builtAt + 条目签名） */
  function getSnapshotSignature(accountId) {
    const snap = getSnapshot(resolveAccountId(accountId));
    if (!snap) return null;
    return `${snap.builtAt}|${entriesSignature(snap.books)}`;
  }

  function getLatestIndexErrors(accountId) {
    return getIndexSnapshot(accountId)?.errors || [];
  }

  return {
    rebuildFromConfiguredPath,
    getIndexGeneration,
    previewFromOutputPath,
    queryBooks,
    getBookById,
    getNotesByBookId,
    getSnapshotSignature,
    getIndexSnapshot,
    getLatestIndexErrors,
  };
}
