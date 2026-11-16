// lib/sync.js —— 同步流水线（weread-vscode syncService/diffService/pathConflictResolver/exportService 写盘链路移植）
// Node ESM，零依赖（微信读书 API 走 ./api.js）。契约见 docs/design-dsh-mapping.md §3、analysis-03 §1.1。

import fs from 'node:fs';
import path from 'node:path';
import {
  getShelfList,
  getArticleBooks,
  getBookNotes,
  getBookInfo,
  getWebReviewListMine,
  transformNotes,
  buildPcUrl,
} from './api.js';

export const SyncStatus = { Idle: 'idle', Syncing: 'syncing', Success: 'success', Failed: 'failed', Cancelled: 'cancelled' };
// v1.9.3 增量兜底：计数未变的书距上次「全量笔记拉取」超过 30 天强制重拉一轮——
// 覆盖服务端计数不变但内容变的边缘（想法编辑、历史 createTime 修复类自愈）
const NOTES_FULL_SYNC_EVERY_MS = 30 * 24 * 60 * 60 * 1000;
export const SyncStep = {
  FetchingShelf: 'fetching_shelf',
  FetchingNotes: 'fetching_notes',
  SavingData: 'saving_data',
  Completed: 'completed',
};

const MAX_CONCURRENCY = 3;
const NOTES_CACHE_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- diffService（analysis-03 §1.6） ----------
export function detectBookChanges(localBooks, remoteBooks) {
  const localMap = new Map(localBooks.map((b) => [b.bookId, b]));
  const diffs = [];
  for (const remoteBook of remoteBooks) {
    const localBook = localMap.get(remoteBook.bookId);
    if (!localBook) {
      diffs.push({
        bookId: remoteBook.bookId,
        title: remoteBook.title,
        needsSync: true,
        changes: { progressChanged: true, highlightCountChanged: true, noteCountChanged: true },
      });
    } else {
      const changes = {
        progressChanged: localBook.progress !== remoteBook.progress,
        highlightCountChanged: localBook.highlightCount !== remoteBook.highlightCount,
        noteCountChanged: localBook.noteCount !== remoteBook.noteCount,
      };
      diffs.push({
        bookId: remoteBook.bookId,
        title: remoteBook.title,
        needsSync: changes.progressChanged || changes.highlightCountChanged || changes.noteCountChanged,
        changes,
      });
    }
  }
  return diffs;
}

export function generateSyncPlan(diffs, remoteBooks) {
  const booksToSync = diffs
    .filter((d) => d.needsSync)
    .map((d) => remoteBooks.find((b) => b.bookId === d.bookId))
    .filter(Boolean);
  return { booksToSync, totalBooks: booksToSync.length };
}

function isNoteChanged(local, remote) {
  // P0-1：modifyTime 仅在双方都有值时参与比较——markdown 往返不落 modifyTime（读回 undefined），
  // 原版 undefined !== 数字恒真 → 每轮全量误报 modified。内容字段仍是主判据。
  const timeChanged = local.modifyTime !== undefined
    && remote.modifyTime !== undefined
    && local.modifyTime !== remote.modifyTime;
  // v1.8.15：远端带回真实 createTime（网关通道/服务端回填）与本地不符 → 变更，
  // 触发重写以修复历史被 Date.now() 兜底污染的「记录时间」（markdown 往返秒级无损，无误报）
  const createTimeRepaired = Number(remote.createTime) > 0
    && Number(local.createTime) !== Number(remote.createTime);
  return (
    local.highlightText !== remote.highlightText ||
    local.thoughtText !== remote.thoughtText ||
    timeChanged ||
    createTimeRepaired
  );
}

export function detectNoteChanges(localNotes, remoteNotes) {
  const localMap = new Map(localNotes.map((n) => [n.noteId, n]));
  const remoteMap = new Map(remoteNotes.map((n) => [n.noteId, n]));
  const added = [];
  const modified = [];
  const deleted = [];
  for (const remoteNote of remoteNotes) {
    const localNote = localMap.get(remoteNote.noteId);
    if (!localNote) added.push(remoteNote);
    else if (isNoteChanged(localNote, remoteNote)) modified.push(remoteNote);
  }
  for (const localNote of localNotes) {
    if (!remoteMap.has(localNote.noteId)) deleted.push(localNote);
  }
  return { added, modified, deleted };
}

// ---------- v1.1 想法/书评补采（官方口径：所有笔记内容 = 划线 + 想法/点评） ----------

function toSec(ts) {
  // v1.8.15：缺失不伪造——Date.now() 兜底会把同步时刻写成创建时间（与 transformNotes 同根因）
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 本地笔记 modifyTime/createTime 更新则保留本地（保护用户本地编辑）。
 * P0-1（对抗审查 v2）：远端集合之外的 local-only 笔记（用户手加/远端已删）保留本地，
 * 不再被 remoteNotes.map 静默丢弃——「资产自持有」语义下数据安全优先于删除跟随。
 * v1.8.15：createTime 以远端为权威——匹配到的笔记必源自服务端同步，本地编辑从不合法改动创建时间；
 * 远端带回真实时间（网关通道/服务端回填）时，即使本地版本因时间戳较新胜出，也覆写修复
 * （存量被 Date.now() 兜底污染的「记录时间」由此自愈）。 */
export function mergeWithLocalNotes(localNotes, remoteNotes) {
  if (remoteNotes.length === 0 && localNotes.length > 0) return localNotes;
  if (localNotes.length === 0) return remoteNotes;
  const localMap = new Map(localNotes.map((n) => [n.noteId, n]));
  const merged = remoteNotes.map((remote) => {
    const local = localMap.get(remote.noteId);
    if (!local) return remote;
    const localTime = local.modifyTime || local.createTime || 0;
    const remoteTime = remote.modifyTime || remote.createTime || 0;
    const winner = localTime > remoteTime ? local : remote;
    return Number(remote.createTime) > 0 && winner.createTime !== remote.createTime
      ? { ...winner, createTime: remote.createTime }
      : winner;
  });
  const remoteIds = new Set(remoteNotes.map((n) => n.noteId));
  for (const local of localNotes) {
    if (!remoteIds.has(local.noteId)) merged.push(local); // 保留 local-only
  }
  return merged;
}

/**
 * 官方 /review/list/mine（或 web 同构回包）→ 分类归一。
 * 分类规则（官方 notes.md）：
 *  - 有 range（能定位原文）→ 划线想法 attached（abstract=对应划线原文）
 *  - 无 range 有 chapterName → 章节点评 chapterComment
 *  - 无 range 无 chapterName → 整本书评 bookReview（多条取最新一条，其余并入 chapterComments 保持可见）
 * @param {Array} rawReviews reviews 数组（元素为 {review:{...}} 包装或平铺）
 * @param {string} bookId
 */
export function transformMyReviews(rawReviews, bookId) {
  const source = Array.isArray(rawReviews) ? rawReviews : [];
  const attached = [];
  const chapterComments = [];
  const bookReviews = [];
  for (const wrapper of source) {
    const r = wrapper?.review && typeof wrapper.review === 'object' ? wrapper.review : wrapper;
    if (!r || typeof r !== 'object') continue;
    const content = String(r.content ?? '').trim();
    if (!content) continue;
    const reviewId = String(r.reviewId ?? r.id ?? `${bookId}-review-${r.createTime ?? attached.length + chapterComments.length + bookReviews.length}`);
    const range = String(r.range ?? '').trim();
    const abstract = String(r.abstract ?? '').trim();
    const chapterName = String(r.chapterName ?? '').trim();
    const base = {
      reviewId,
      bookId: String(r.bookId || bookId),
      content,
      range: range || undefined,
      abstract: abstract || undefined,
      chapterUid: Number(r.chapterUid || 0) || undefined,
      chapterIdx: Number(r.chapterIdx || 0) || undefined,
      chapterName: chapterName || undefined,
      star: Number(r.star ?? -1),
      createTime: toSec(r.createTime),
      isFinish: r.isFinish === 1 || r.isFinish === true,
    };
    if (range) attached.push(base);
    else if (chapterName) chapterComments.push(base);
    else bookReviews.push(base);
  }
  bookReviews.sort((a, b) => b.createTime - a.createTime);
  return { attached, chapterComments, bookReviews };
}

/**
 * 把分类后的想法并进笔记集（远端 bookmarklist 变换结果之上）：
 *  - attached 按 range / abstract 命中既有划线 → 补 thoughtText（已有且相同则跳过；冲突取新）
 *  - 未命中的 attached → 独立想法笔记（保留 abstract 作划线原文）
 *  - chapterComments → 独立想法笔记（挂章节名）
 * @returns {{notes:Array, bookReview:object|null}}
 */
export function mergeReviewsIntoNotes(notes, transformed, { chapterTitleByUid } = {}) {
  const list = (notes || []).map((n) => ({ ...n }));
  const { attached = [], chapterComments = [], bookReviews = [] } = transformed || {};
  const titleOf = (uid) =>
    (chapterTitleByUid && uid ? chapterTitleByUid.get(Number(uid)) : undefined) || undefined;

  for (const item of attached) {
    const hit = list.find(
      (n) =>
        (item.range && n.range === item.range) ||
        (item.abstract && n.highlightText && n.highlightText.trim() === item.abstract)
    );
    if (hit) {
      const localTime = Number(hit.modifyTime || hit.createTime || 0);
      if (!hit.thoughtText || String(hit.thoughtText).trim() === '' || item.createTime > localTime) {
        if (String(hit.thoughtText ?? '').trim() !== item.content) hit.thoughtText = item.content;
      }
    } else {
      list.push({
        noteId: item.reviewId,
        bookId: item.bookId,
        chapterUid: item.chapterUid || 0,
        chapterTitle: item.chapterName || titleOf(item.chapterUid),
        type: 2,
        highlightText: item.abstract || '',
        thoughtText: item.content,
        createTime: item.createTime,
        modifyTime: item.createTime,
        range: item.range,
      });
    }
  }
  for (const item of chapterComments) {
    if (list.some((n) => n.noteId === item.reviewId)) continue;
    list.push({
      noteId: item.reviewId,
      bookId: item.bookId,
      chapterUid: item.chapterUid || 0,
      chapterTitle: item.chapterName || titleOf(item.chapterUid),
      type: 2,
      highlightText: '',
      thoughtText: item.content,
      createTime: item.createTime,
      modifyTime: item.createTime,
    });
  }
  return { notes: list, bookReview: bookReviews[0] || null };
}

/** 官方三计数对账（纯计算）：expected = noteCount(划线) + reviewCount(想法/点评)；
 *  bookmarkCount 是位置书签，官方不导出内容，不计入。 */
export function computeReconcile(gatewayNotebooks, localCounts) {
  const localMap = new Map((localCounts || []).map((x) => [String(x.bookId), Number(x.localCount) || 0]));
  const mismatched = [];
  let checked = 0;
  for (const wrapper of gatewayNotebooks || []) {
    const book = wrapper?.book && typeof wrapper.book === 'object' ? wrapper.book : wrapper;
    const bookId = String(wrapper?.bookId || book?.bookId || '').trim();
    if (!bookId) continue;
    const expected = (Number(wrapper?.noteCount) || 0) + (Number(wrapper?.reviewCount) || 0);
    if (expected <= 0) continue;
    const local = localMap.get(bookId) ?? 0;
    checked += 1;
    if (local !== expected) {
      mismatched.push({
        bookId,
        title: String(book?.title || book?.bookInfo?.title || bookId),
        expected,
        local,
        diff: expected - local,
      });
    }
  }
  mismatched.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { checked, mismatchedCount: mismatched.length, mismatched: mismatched.slice(0, 50) };
}

// ---------- 原子写（fileRepository 移植） ----------
async function atomicWrite(filePath, content) {
  const dirPath = path.dirname(filePath);
  await fs.promises.mkdir(dirPath, { recursive: true });
  const fileName = path.basename(filePath);
  const tempFile = path.join(dirPath, `.${fileName}.${Date.now()}.${process.pid}.tmp`);
  try {
    await fs.promises.writeFile(tempFile, content, 'utf-8');
    await fs.promises.rename(tempFile, filePath);
  } catch (error) {
    try {
      await fs.promises.unlink(tempFile);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function normalizeBookIdLocal(raw) {
  return String(raw || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').trim();
}

function parseFrontmatter(content) {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};
  const record = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    record[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return record;
}

async function fileExists(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function collectMarkdownFiles(rootPath) {
  return new Promise((resolve) => {
    const result = [];
    const stack = [rootPath];
    const step = () => {
      while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === '阅读洞察报告' || entry.name === '._weread_trash') continue;
            stack.push(fullPath);
            continue;
          }
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            result.push(path.resolve(fullPath));
          }
        }
      }
      resolve(result);
    };
    setImmediate(step);
  });
}

async function readFrontmatterBookId(filePath) {
  try {
    // B2: 只读文件头 8KB（frontmatter 在顶部），大文件避免全量读
    let content;
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await fh.read(buf, 0, 8192, 0);
      content = buf.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await fh.close();
    }
    if (!content.startsWith('---')) return undefined;
    const fm = parseFrontmatter(content);
    const value = fm.bookid || fm.bookId;
    if (!value) return undefined;
    return normalizeBookIdLocal(value) || value;
  } catch {
    return undefined;
  }
}

/**
 * @param {{api?:object, store:object, index:object, gateway?:object,
 *          markdown:{renderBookMarkdown:Function,buildFileName:Function,sanitizePathSegment:Function},
 *          log:Function, onProgress?:Function, cleanup?:object, configGetter?:Function}} deps
 */
export function createSyncService({ api, store, index, markdown, log, onProgress, cleanup, configGetter, gateway }) {
  const getConfig =
    typeof configGetter === 'function' ? configGetter : () => store.getConfig?.() || {};
  const apiMethods = api || {
    getShelfList,
    getArticleBooks,
    getBookNotes,
    getBookInfo,
    getWebReviewListMine,
    transformNotes,
    buildPcUrl,
  };
  const logger = typeof log === 'function' ? log : () => {};
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const syncingAccounts = new Set();
  // v1.9.3 软取消（协作式）：requestCancel 置标志 → worker 在书边界检查 → 在飞书自然完成、
  // 队列剩余书不再取。不 abort 在飞请求（风控上突掐不如自然完成温和，且每跳本有 5s 超时兜底）。
  const cancelRequestedAccounts = new Set();
  function requestCancel(accountId) {
    const id = resolveAccountId(accountId);
    if (id) cancelRequestedAccounts.add(id);
  }
  function isCancelRequested(accountId) {
    return cancelRequestedAccounts.has(resolveAccountId(accountId));
  }
  const notesCache = new Map();
  const syncedBookCount = new Map();
  const estimatedTotalNotes = new Map();
  const syncedNotesCount = new Map();
  // v1.9.10 对抗审查 v3：移除 onDidCompleteSync/fireComplete/completeCallbacks——生产零消费者
  //（完成通知实际走 wsbus 广播 sync 事件），属 v1.9.6 死代码清理漏网。

  function resolveAccountId(accountId) {
    const normalized = String(accountId || '').trim();
    if (normalized) return normalized;
    const active = store.getActiveAccountId?.();
    return String(active || '').trim() || undefined;
  }

  function updateProgress(step, currentIndex, total, bookName, accountId) {
    const targetAccountId = resolveAccountId(accountId);
    const percentage = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
    const totalNotes = Math.max(
      estimatedTotalNotes.get(targetAccountId || '') || 0,
      syncedNotesCount.get(targetAccountId || '') || 0
    );
    const p = {
      currentStep: step,
      currentBookIndex: currentIndex,
      totalBooks: total,
      syncedBooks: syncedBookCount.get(targetAccountId || '') ?? currentIndex,
      syncedNotes: syncedNotesCount.get(targetAccountId || '') || 0,
      totalNotes,
      currentBookName: bookName,
      percentage,
      accountId: targetAccountId,
    };
    progress(step, currentIndex, total, p);
  }

  function updateSyncStatus(accountId, status, error, summary, loginExpired) {
    const current = store.getState(accountId, 'syncState', {}) || {};
    store.setState(accountId, 'syncState', {
      ...current,
      lastSyncTime: status === SyncStatus.Success ? Date.now() : current.lastSyncTime,
      status,
      error: error || undefined,
      // v1.8.8：完成增量摘要（客户端完成 toast 用；任何非 Success 状态保留上次摘要供诊断）
      lastSummary: summary !== undefined ? summary : current.lastSummary,
      // v1.9.8：登录类失败标记——客户端在凭据恢复（loggedIn）后据此隐藏陈旧的「同步失败：登录已过期」横幅；
      // 非 Failed 终态一律清标（成功/取消即代表登录类故障不再成立）
      loginExpired: status === SyncStatus.Failed ? !!loginExpired : undefined,
      dataVersion: current.dataVersion || 1,
    });
  }

  function toSourceBookId(bookId) {
    return bookId.startsWith('article:') ? bookId.replace('article:', '') : bookId;
  }

  async function getBookNotesWithCache(bookId, accountId) {
    const key = `${String(accountId || 'default')}:${bookId}`;
    const cached = notesCache.get(key);
    const now = Date.now();
    if (cached && now - cached.fetchedAt >= NOTES_CACHE_TTL_MS) {
      notesCache.delete(key); // C2: 过期即淘汰，不滞留
    } else if (cached) {
      return cached.data;
    }
    const source = toSourceBookId(bookId);
    let data;
    // v1.2.1 网关优先：Key 在场直接走官方 bookmarklist（官方计数权威，免 cookie 死活嗅探）；
    // 死 cookie 下 web 端点常返回 200+残数据（不抛错），错误触发式兜底拦不住——深响 2/11 的根因
    let usedGateway = false;
    if (gatewayReady(accountId)) {
      try {
        data = await gateway.call('/book/bookmarklist', { bookId: source });
        usedGateway = true;
      } catch (gwErr) {
        logger('warn', `[Sync][account:${accountId}] 网关划线拉取失败（${gwErr?.message || gwErr}）→ cookie 兜底 ${source}`);
      }
    }
    if (!usedGateway) {
      try {
        data = await apiMethods.getBookNotes(source);
      } catch (cookieErr) {
        throw cookieErr; // 网关已试过（失败）或不在场：双通道皆败，按 cookie 错误上抛
      }
    }
    if (usedGateway && Array.isArray(data?.updated) && Array.isArray(data?.chapters)) {
      // 官方回包章节名在 chapters[]，updated[] 只有 chapterUid——回填（web 回包是内联 chapterTitle）
      const titleByUid = new Map(data.chapters.map((c) => [Number(c.chapterUid), c.title]));
      for (const item of data.updated) {
        if (!item.chapterTitle && item.chapterUid !== undefined) {
          item.chapterTitle = titleByUid.get(Number(item.chapterUid));
        }
      }
    }
    notesCache.set(key, { fetchedAt: now, data });
    return data;
  }

  /** v1.1 想法/书评拉取（软失败）：官方 Key 在场走网关 myReviewsAll；
   *  否则 cookie 在场走 web /web/review/list 兜底；两者皆无 → undefined。 */
  async function fetchRemoteReviews(bookId, accountId) {
    const source = toSourceBookId(bookId);
    const apiKey = (() => {
      try { return store.getApiKey?.(resolveAccountId(accountId)); } catch { return undefined; }
    })();
    if (gateway?.hasApiKey?.() && apiKey) {
      try {
        return await gateway.myReviewsAll(source);
      } catch (e) {
        logger('warn', `[Sync][account:${accountId}] 网关拉取想法失败 ${source}: ${e?.message || e}（跳过补采，不影响主同步）`);
        return undefined;
      }
    }
    const cookies = (() => {
      try { return store.getCookies?.(resolveAccountId(accountId)); } catch { return undefined; }
    })();
    if (!cookies || typeof apiMethods.getWebReviewListMine !== 'function') return undefined;
    try {
      const all = [];
      let synckey = 0;
      for (let page = 0; page < 100; page += 1) {
        const data = await apiMethods.getWebReviewListMine(source, synckey);
        const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
        all.push(...reviews);
        const next = Number(data?.synckey ?? synckey);
        if (Number(data?.hasMore ?? 0) !== 1 || !reviews.length || next === synckey) break;
        synckey = next;
      }
      return all;
    } catch (e) {
      logger('warn', `[Sync][account:${accountId}] web 兜底拉取想法失败 ${source}: ${e?.message || e}（跳过补采）`);
      return undefined;
    }
  }

  /** 章节映射（bookmarklist 回包 chapters[] → uid→title），供 attached/chapterComments 挂章节名 */
  function chapterTitleMapFromNotesData(notesData) {
    const chapters = notesData?.chapters;
    if (!Array.isArray(chapters)) return undefined;
    const map = new Map();
    for (const c of chapters) {
      if (c?.chapterUid !== undefined) map.set(Number(c.chapterUid), c.title || undefined);
    }
    return map.size ? map : undefined;
  }

  /** v1.1 同步后官方三计数对账：网关在场才跑（官方口径明确）；结果写 syncState.reconcile */
  async function runReconcile(accountId, gatewayNotebooksCache) {
    const targetAccountId = resolveAccountId(accountId);
    if (!gatewayReady(targetAccountId)) return undefined;
    // v1.1.2：复用本轮 loadRemoteBooks 已拉取的 notebooks（免二次翻页）；无缓存才现拉
    // P2-5（对抗审查 v2）：缓存经参数传入（runSync 每轮新建），不再用闭包级变量
    let notebooks = gatewayNotebooksCache?.notebooks;
    if (!notebooks) {
      try {
        notebooks = await gateway.notebooksAll({ pageSize: 50 });
      } catch (e) {
        logger('warn', `[Sync][account:${targetAccountId}] 对账跳过（网关 notebooks 拉取失败：${e?.message || e}）`);
        return undefined;
      }
    }
    const books = await index.queryBooks(targetAccountId);
    const localCounts = [];
    for (const book of books) {
      let count = 0;
      try {
        const notes = await index.getNotesByBookId(book.bookId, targetAccountId);
        // 官方口径对齐：划线与想法各自计 1（一条带想法的划线 = 2），章节占位不计；
        // type-4 书评由下方 ## 书评 区块补计 1（回读笔记若再计会双算）
        for (const n of notes || []) {
          if (Number(n.type) === 3 || Number(n.type) === 4) continue;
          if (String(n.highlightText ?? '').trim()) count += 1;
          if (String(n.thoughtText ?? '').trim()) count += 1;
        }
        // 整本书评在 ## 书评 区块（不在笔记数组），从文件补计 1
        const meta = await index.getBookById(book.bookId, targetAccountId).catch(() => undefined);
        if (meta?.localFilePath) {
          try {
            // P2（大库 IO）：只读尾部 8KB 探测 `## 书评`（模板中书评恒在文末；此前每本书全量读盘）
            const fh = await fs.promises.open(meta.localFilePath, 'r');
            try {
              const size = (await fh.stat()).size;
              const len = Math.min(size, 8192);
              const buf = Buffer.alloc(len);
              await fh.read(buf, 0, len, size - len);
              if (/^##\s*书评/m.test(buf.toString('utf-8'))) count += 1;
            } finally {
              await fh.close();
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      localCounts.push({ bookId: book.bookId, localCount: count });
    }
    const result = computeReconcile(notebooks.books, localCounts);
    const reconciled = { checkedAt: Date.now(), checkedBooks: result.checked, mismatchedCount: result.mismatchedCount, mismatched: result.mismatched };
    const current = store.getState(targetAccountId, 'syncState', {}) || {};
    store.setState(targetAccountId, 'syncState', { ...current, reconcile: reconciled });
    if (result.mismatchedCount > 0) {
      logger('warn', `[Sync][account:${targetAccountId}] 对账发现 ${result.mismatchedCount} 本书本地与服务端计数不一致（前 3：${result.mismatched.slice(0, 3).map((m) => `${m.title}(${m.local}/${m.expected})`).join('、')}）`);
    } else {
      logger('info', `[Sync][account:${targetAccountId}] 对账通过：${result.checked} 本书计数一致`);
    }
    return reconciled;
  }

  async function tryLoadArticleBooks() {
    try {
      return (await apiMethods.getArticleBooks()) || [];
    } catch {
      return []; // 兼容旧账号/接口不可用场景
    }
  }

  function gatewayReady(accountId) {
    if (!gateway?.hasApiKey?.()) return false;
    try { return !!store.getApiKey?.(resolveAccountId(accountId)); } catch { return false; }
  }

  /** 官方 /user/notebooks 条目 → 本地 book 形状（title 常为空串——MP 文章服务端无标题） */
  function gatewayNotebookToBook(wrapper) {
    const b = wrapper?.book && typeof wrapper.book === 'object' ? wrapper.book : {};
    const bookId = String(wrapper?.bookId || b.bookId || '').trim();
    if (!bookId) return undefined;
    const noteCount = Number(wrapper?.noteCount) || 0;
    const reviewCount = Number(wrapper?.reviewCount) || 0;
    const title = String(b.title ?? '').trim();
    let pcUrl = '';
    try { pcUrl = apiMethods.buildPcUrl(bookId); } catch { pcUrl = ''; }
    return {
      bookId,
      rawBookId: String(b.rawBookId || bookId),
      docType: b.docType,
      title: title || '未命名书籍',
      author: String(b.author ?? '').trim() || '',
      cover: b.cover || '',
      category: b.category,
      intro: b.intro,
      progress: Math.round(Number(wrapper?.readingProgress ?? b.progress ?? 0) || 0),
      readingStatus: wrapper?.markedStatus === 1 ? 2 : 1,
      lastReadTime: Number(wrapper?.sort) || 0,
      highlightCount: noteCount,
      reviewCount,
      noteCount: noteCount + reviewCount,
      pcUrl,
    };
  }

  /**
   * v1.1.2 网关 notebooks 合并（治「cookie 侧计数滞后导致的漏采」）：
   * - 官方三计数覆盖同名书的 cookie 计数（补采 gate 的权威数据源）
   * - cookie 书架缺失的书（如仅有 1 条书评、无划线的书）追加进同步清单
   */
  function mergeGatewayNotebooks(remoteBooks, notebooks, accountId) {
    if (!Array.isArray(notebooks?.books) || !notebooks.books.length) return remoteBooks;
    const byId = new Map(remoteBooks.map((b) => [String(b.bookId), b]));
    let merged = 0;
    let appended = 0;
    for (const wrapper of notebooks.books) {
      const id = String(wrapper?.bookId || wrapper?.book?.bookId || '').trim();
      if (!id) continue;
      const counts = {
        highlightCount: Number(wrapper?.noteCount) || 0,
        reviewCount: Number(wrapper?.reviewCount) || 0,
      };
      counts.noteCount = counts.highlightCount + counts.reviewCount;
      const existing = byId.get(id);
      if (existing) {
        // 官方计数权威：覆盖（title 等元数据保留 cookie 侧更全的值）
        if (existing.highlightCount !== counts.highlightCount
          || existing.noteCount !== counts.noteCount
          || (existing.reviewCount || 0) !== counts.reviewCount) {
          existing.highlightCount = counts.highlightCount;
          existing.reviewCount = counts.reviewCount;
          existing.noteCount = counts.noteCount;
          merged += 1;
        }
        continue;
      }
      const book = gatewayNotebookToBook(wrapper);
      if (book) {
        remoteBooks.push(book);
        byId.set(id, book);
        appended += 1;
      }
    }
    if (merged || appended) {
      logger('info', `[Sync][account:${accountId}] 网关 notebooks 合并：计数订正 ${merged} 本、新增 ${appended} 本（cookie 书架缺失）`);
    }
    return remoteBooks;
  }

  async function loadRemoteBooks(gatewayNotebooksCache) {
    updateProgress(SyncStep.FetchingShelf, 0, 0, '获取书架列表');
    const accountId = store?.getActiveAccountId?.() ?? undefined;
    let remoteBooks;
    try {
      const shelfData = await apiMethods.getShelfList();
      remoteBooks = shelfData.books.map((b) => b.book);
      remoteBooks.push(...(await tryLoadArticleBooks()));
    } catch (cookieErr) {
      // v1.2 网关数据通道兜底：cookie 书架拉取失败而官方 Key 在场 → notebooks 书架
      // （仅含有笔记的书；公众号文章清单不可得——本地文件不删除，cookie 恢复后自动回来）
      if (!gatewayReady(accountId)) throw cookieErr;
      logger('warn', `[Sync][account:${accountId}] cookie 书架拉取失败（${cookieErr?.message || cookieErr}）→ 官方网关 notebooks 书架兜底`);
      const notebooks = await gateway.notebooksAll({ pageSize: 50 });
      if (gatewayNotebooksCache) gatewayNotebooksCache.notebooks = notebooks;
      remoteBooks = notebooks.books
        .map((w) => gatewayNotebookToBook(w))
        .filter(Boolean);
      return remoteBooks;
    }
    // v1.1.2：网关在场时合并官方 notebooks（权威三计数 + 补齐只有想法的书）
    if (gatewayReady(accountId)) {
      try {
        const notebooks = await gateway.notebooksAll({ pageSize: 50 });
        if (gatewayNotebooksCache) gatewayNotebooksCache.notebooks = notebooks;
        mergeGatewayNotebooks(remoteBooks, notebooks, accountId);
      } catch (e) {
        if (gatewayNotebooksCache) gatewayNotebooksCache.notebooks = null;
        logger('warn', `[Sync][account:${accountId}] 网关 notebooks 合并失败（跳过，走 cookie 计数）: ${e?.message || e}`);
      }
    }
    return remoteBooks;
  }

  function shouldRefreshMetadata(book) {
    if (book.bookId.startsWith('article:')) {
      return (
        !book.pcUrl ||
        /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl) ||
        !/\/web\/mp\/reader\//i.test(book.pcUrl)
      );
    }
    return !book.pcUrl || /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl);
  }

  async function enrichBookMetadataIfNeeded(book) {
    if (book.bookId.startsWith('article:')) {
      const normalized = apiMethods.buildPcUrl(book.bookId);
      if (book.pcUrl !== normalized) {
        book.pcUrl = normalized;
        return true;
      }
      return false;
    }
    const pcUrlLooksRawId =
      !book.pcUrl || /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl);
    const needResolveCanonicalReaderUrl =
      pcUrlLooksRawId && (book.bookId.startsWith('MP_WXS_') || /^\d+$/.test(book.bookId));
    const needFetch = !book.isbn || !book.publisher || !book.category || !book.intro;
    if (!needFetch && !needResolveCanonicalReaderUrl) return false;

    const snapshotOf = (b) =>
      JSON.stringify({
        isbn: b.isbn, publisher: b.publisher, category: b.category, intro: b.intro,
        publishTime: b.publishTime, author: b.author, title: b.title, cover: b.cover, pcUrl: b.pcUrl,
      });
    const previousSnapshot = snapshotOf(book);
    try {
      const detail = await apiMethods.getBookInfo(toSourceBookId(book.bookId));
      book.isbn = detail.isbn || book.isbn;
      book.publisher = detail.publisher || book.publisher;
      book.category = detail.category || book.category;
      book.intro = detail.intro || book.intro;
      book.publishTime = detail.publishTime || book.publishTime;
      book.author = detail.author || book.author;
      book.title = detail.title || book.title;
      book.cover = detail.cover || book.cover;
      if (detail.pcUrl) {
        book.pcUrl = detail.pcUrl;
      } else if (
        needResolveCanonicalReaderUrl &&
        typeof detail.bookId === 'string' &&
        detail.bookId.trim() &&
        detail.bookId.trim() !== book.bookId
      ) {
        book.pcUrl = book.bookId.startsWith('MP_WXS_')
          ? `https://weread.qq.com/web/mp/reader/${detail.bookId.trim()}`
          : `https://weread.qq.com/web/reader/${detail.bookId.trim()}`;
      }
      return snapshotOf(book) !== previousSnapshot;
    } catch (error) {
      logger('warn', `补全元数据失败 ${book.title}: ${error?.message || error}`);
      return false;
    }
  }

  // mergeWithLocalNotes 已提升为模块级导出（P0-1：供 smoke 直测 + 保留 local-only 语义）


  function shouldUpdateBookNotes(localNotes, remoteNotes, changedNotesCount) {
    if (localNotes.length === 0) return remoteNotes.length > 0;
    if (changedNotesCount === 0) return false;
    const latest = (notes) =>
      notes.reduce((m, n) => Math.max(m, n.modifyTime || n.createTime || 0), 0);
    if (remoteNotes.length !== localNotes.length) return true;
    return latest(remoteNotes) >= latest(localNotes);
  }

  function resolveAccountOutputPath(accountId) {
    const config = getConfig() || {};
    const base = String(config.outputPath || '').trim();
    if (!base) {
      return undefined;
    }
    const normalized = String(accountId || '').trim();
    return normalized ? path.join(base, 'accounts', normalized) : base;
  }

  function resolveCategoryFolder(book) {
    const category = (book.category || '').trim() || (book.bookId.startsWith('article:') ? '公众号' : '未分类');
    const sanitized = markdown.sanitizePathSegment(category);
    return sanitized || '未分类';
  }

  function buildBookIdCandidates(book) {
    const raw = [
      book.bookId,
      book.rawBookId,
      book.bookId?.startsWith('article:') ? book.bookId.slice('article:'.length) : undefined,
      book.rawBookId?.startsWith('article:') ? book.rawBookId.slice('article:'.length) : undefined,
    ].filter((v) => !!v && !!String(v).trim());
    const normalized = raw.map((v) => normalizeBookIdLocal(v)).filter(Boolean);
    return new Set([...raw, ...normalized]);
  }

  /** 全目录按 frontmatter bookid 找已有文件（书改名也跟随旧文件） */
  // B2: 每轮同步构建一次 bookId -> filePath 映射，避免每本书重新全库扫描
  let canonicalIndex = null; // { key: Map<normalizedId, filePath> }
  async function buildCanonicalIndex(outputPath) {
    const map = new Map();
    const files = await collectMarkdownFiles(outputPath);
    for (const filePath of files) {
      if (filePath.includes(`${path.sep}._weread_trash${path.sep}`)) continue;
      const id = await readFrontmatterBookId(filePath);
      if (id && !map.has(id)) map.set(id, filePath);
    }
    return map;
  }
  async function findBookFileInOutputPathByBookId(outputPath, book) {
    const key = path.resolve(outputPath);
    if (!canonicalIndex || canonicalIndex.key !== key) {
      canonicalIndex = { key, map: await buildCanonicalIndex(key) };
    }
    for (const id of buildBookIdCandidates(book)) {
      const hit = canonicalIndex.map.get(id);
      if (hit) return hit;
    }
    return undefined;
  }
  function invalidateCanonicalIndex() { canonicalIndex = null; }

  /** 期望路径被其他书占用 → base_1.md、base_2.md…（路径冲突 resolver 语义，串行调用方互斥由进程内同步循环保证） */
  async function reserveUniquePath(desiredPath, categoryFolder, bookId) {
    const ext = path.extname(desiredPath);
    const dir = path.dirname(desiredPath);
    const baseName = path.basename(desiredPath, ext);
    let index = 0;
    for (;;) {
      const candidateName = index === 0 ? baseName : `${baseName}_${index}`;
      const candidatePath = path.join(dir, `${candidateName}${ext}`);
      if (!(await fileExists(candidatePath))) {
        if (index > 0) {
          logger(
            'info',
            `[path.conflict] category=${categoryFolder} bookId=${bookId} from=${path.resolve(desiredPath)} to=${path.resolve(candidatePath)} index=${index}`
          );
        }
        return path.resolve(candidatePath);
      }
      index += 1;
    }
  }

  /**
   * 同步链路写盘（exportService.writeBookToFile preferCanonicalForBookId=true 移植）：
   * canonical-by-bookId 全目录找文件覆盖；否则 sanitize(分类)/文件名 + _N 冲突改名；原子写。
   * v1.1：review（整本书评）传入渲染——官方口径「所有笔记内容=划线+想法」补齐。
   */
  async function exportBookForSyncWithNotes(book, notes, accountId, review) {
    const outputPath = resolveAccountOutputPath(accountId);
    if (!outputPath) {
      return { success: false, error: '未设置笔记保存路径（weread.outputPath）' };
    }
    const config = getConfig() || {};
    const fileName = markdown.buildFileName(book, config.fileNameTemplate);
    const content = markdown.renderBookMarkdown(book, notes, { noteTemplate: config.noteTemplate, review });

    const categoryFolder = resolveCategoryFolder(book);
    const targetDir = path.join(outputPath, categoryFolder);
    await fs.promises.mkdir(targetDir, { recursive: true });
    const desiredPath = path.resolve(path.join(targetDir, `${fileName}.md`));

    let filePath = desiredPath;
    const canonical = await findBookFileInOutputPathByBookId(path.resolve(outputPath), book);
    if (canonical && !canonical.includes(`${path.sep}._weread_trash${path.sep}`)) {
      filePath = path.resolve(canonical);
    } else if (await fileExists(desiredPath)) {
      const existingAtDesired = await readFrontmatterBookId(desiredPath);
      const candidateIds = buildBookIdCandidates(book);
      if (existingAtDesired && !candidateIds.has(existingAtDesired)) {
        filePath = await reserveUniquePath(desiredPath, categoryFolder, book.bookId);
      }
    }
    try {
      await atomicWrite(filePath, content);
    } catch (error) {
      return { success: false, error: error?.message || '同步写入笔记文件失败' };
    }
    return { success: true, filePath };
  }

  function normalizeTimestampMs(raw) {
    if (!raw || !Number.isFinite(raw)) return 0;
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }

  function formatDateKey(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 按笔记 modifyTime||createTime 本地日期聚合 → store 'dailyAgg' */
  async function rebuildDailyAgg(accountId) {
    const books = await index.queryBooks(accountId);
    const dailyMap = new Map();
    for (const book of books) {
      const notes = await index.getNotesByBookId(book.bookId, accountId);
      for (const note of notes) {
        const ts = normalizeTimestampMs(note.modifyTime || note.createTime || 0);
        if (!ts) continue;
        const date = formatDateKey(ts);
        const current = dailyMap.get(date);
        if (current) {
          current.notesCount += 1;
          current.booksTouched.add(note.bookId);
        } else {
          dailyMap.set(date, { notesCount: 1, booksTouched: new Set([note.bookId]) });
        }
      }
    }
    const records = Array.from(dailyMap.entries())
      .map(([date, v]) => ({
        date,
        readDaysFlag: v.notesCount > 0 ? 1 : 0,
        notesCount: v.notesCount,
        booksTouched: v.booksTouched.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    store.setState(accountId, 'dailyAgg', records);
  }

  async function syncBooksConcurrently(books, accountId, metadataOnlyIds = new Set()) {
    let finished = 0;
    const results = [];
    const failedBooks = []; // P2-6（对抗审查 v2）：书级失败明细（worker 并发下各自 push，单线程写安全）
    const queue = [...books];
    let cancelledByRequest = false;
    const fullSyncedBookIds = []; // v1.9.3：本轮真拉了笔记的书（noteSyncMarks 兜底计时用）

    const worker = async () => {
      for (;;) {
        const book = queue.shift();
        if (!book) break;
        // v1.9.3 软取消检查点（与账号切换检测同一安全位置：书边界）——
        // 在飞书由各 worker 自行完成，队列剩余书不再取。
        if (isCancelRequested(accountId)) { cancelledByRequest = true; break; }
        // P1-6（对抗审查 v2）：同步中切账号/扫码登录/阅读窗内会话采纳都会即刻换血全局凭据
        // （ApiClient/网关 Key 单例）——剩余书继续拉会把新账号数据写进旧账号目录。活跃账号已变即中止本轮。
        const activeNow = typeof store?.getActiveAccountId === 'function' ? store.getActiveAccountId() : accountId;
        if (activeNow && String(activeNow) !== String(accountId)) {
          throw new Error(`检测到账号切换（${accountId} → ${activeNow}），本轮同步已中止`);
        }
        updateProgress(SyncStep.FetchingNotes, finished, books.length, book.title, accountId);
        try {
          // v1.9.3 增量轻路径：仅元数据待刷的书（计数未变/笔记未变）不拉 bookmarklist——
          // 本地笔记即最新（新增划线必增计数），直接用本地内容重写文件刷元数据。
          const metadataOnly = metadataOnlyIds.has(book.bookId);
          let remoteNotes;
          let bookReview = null;
          let notesData;
          if (metadataOnly) {
            remoteNotes = null; // 哨兵：走本地重写
          } else {
            notesData = await getBookNotesWithCache(book.bookId, accountId);
            remoteNotes = apiMethods.transformNotes(notesData, book.bookId);
            // v1.1 想法/书评补采：官方口径书评/章节点评不在 bookmarklist；有想法计数才拉
            if (!book.bookId.startsWith('article:') && (Number(book.reviewCount) || 0) > 0) {
              const rawReviews = await fetchRemoteReviews(book.bookId, accountId);
              if (rawReviews && rawReviews.length) {
                const transformed = transformMyReviews(rawReviews, book.bookId);
                const merged = mergeReviewsIntoNotes(remoteNotes, transformed, {
                  chapterTitleByUid: chapterTitleMapFromNotesData(notesData),
                });
                remoteNotes = merged.notes;
                bookReview = merged.bookReview;
              }
            }
            fullSyncedBookIds.push(book.bookId);
          }
          // v1.7.5：文件里的 type-4 书评笔记不进变更判定/合并（书评是独立通道），仅作重写兜底
          const localNotesAll = await index.getNotesByBookId(book.bookId, accountId);
          const localNotes = localNotesAll.filter((n) => Number(n.type) !== 4);
          const localReviewNote = localNotesAll.find((n) => Number(n.type) === 4 && String(n.thoughtText || '').trim());
          let shouldUpdate;
          let changedNotesCount = 0;
          if (metadataOnly) {
            shouldUpdate = false; // 笔记内容按计数判定未变——只走元数据重写
          } else {
            const noteChanges = detectNoteChanges(localNotes, remoteNotes);
            changedNotesCount =
              noteChanges.added.length + noteChanges.modified.length + noteChanges.deleted.length;
            // v1.1.2：书评是独立于笔记数组的写盘通道——有书评即写（shouldUpdateBookNotes 看不到它）
            shouldUpdate = shouldUpdateBookNotes(localNotes, remoteNotes, changedNotesCount) || !!bookReview;
          }
          const needsMetadataRefresh = shouldRefreshMetadata(book);

          if (shouldUpdate || needsMetadataRefresh) {
            const notes = shouldUpdate ? mergeWithLocalNotes(localNotes, remoteNotes) : localNotes;
            const metadataChanged = await enrichBookMetadataIfNeeded(book);
            book.highlightCount = notes.filter((n) => n.highlightText).length;
            book.noteCount = notes.length;
            book.reviewCount = notes.filter((n) => n.type === 4 || n.thoughtText).length;

            // v1.7.5：本轮未拉到书评（软失败）→ 用文件已有 type-4 兜底，重写不丢 ## 书评 区块
            const effectiveReview = bookReview?.content
              ? bookReview
              : (localReviewNote ? { content: localReviewNote.thoughtText } : undefined);
            const exportResult = await exportBookForSyncWithNotes(book, notes, accountId, effectiveReview);
            if (!exportResult.success) {
              logger('warn', `[Sync][account:${accountId}] 写入笔记文件失败 ${book.title}: ${exportResult.error}`);
            }
            results.push({
              bookId: book.bookId,
              notesCount: shouldUpdate ? changedNotesCount || notes.length : 0,
              updated: shouldUpdate || metadataChanged,
            });
            if (shouldUpdate) {
              syncedNotesCount.set(
                accountId,
                (syncedNotesCount.get(accountId) || 0) + (changedNotesCount || notes.length)
              );
            }
          } else {
            results.push({ bookId: book.bookId, notesCount: 0, updated: false });
          }
        } catch (error) {
          logger('error', `[Sync][account:${accountId}] 同步书籍失败 ${book.title}: ${error?.message || error}`);
          failedBooks.push({ bookId: book.bookId, title: book.title, error: String(error?.message || error) });
        } finally {
          finished += 1;
          syncedBookCount.set(accountId, finished);
          updateProgress(SyncStep.FetchingNotes, finished, books.length, book.title, accountId);
        }
      }
    };

    const size = Math.min(MAX_CONCURRENCY, Math.max(1, books.length));
    // P1-1（开源前对抗审查 v3）：改 allSettled——Promise.all 下任一 worker 抛错会提前 reject，
    // runSync 的 finally 先释放账号互斥，但其余 worker 仍在消费队列写盘，与新启动的 sync 双写同书。
    const settled = await Promise.allSettled(Array.from({ length: size }, () => worker()));
    for (const s of settled) {
      if (s.status === 'rejected') {
        // worker 级异常已按书落进 failedBooks；此处兜底未归因的顶层拒绝（如账号切换检测）。
        failedBooks.push({ bookId: '*', error: String(s.reason?.message || s.reason) });
      }
    }
    return { results, failedBooks, cancelled: cancelledByRequest, fullSyncedBookIds };
  }

  async function syncChangedBooks(remoteBooks, localBooks, accountId, gatewayNotebooksCache) {
    const diffs = detectBookChanges(localBooks, remoteBooks);
    const syncPlan = generateSyncPlan(diffs, remoteBooks);
    const localBooksMap = new Map(localBooks.map((b) => [b.bookId, b]));
    // v1.9.3 增量修复：元数据判定改看 localBook 侧。原 `shouldRefreshMetadata(remoteBook)` 用
    // 远端书架数据——notebook 端点不返回 pcUrl，插件推导的 rawId 形态每轮恒命中「待刷」→
    // metadata 通道把全部书捞进队列，计数增量判定名存实亡（每轮每本书全量拉笔记，真机 2026-11-10 确认）。
    // localBook.pcUrl 是 enrich 后写盘、从 frontmatter 读回的 canonical 值 → 大多数书判 false。
    // 新书不受影响（diffs needsSync=true 本就走全拉）。另把 enrich 的元数据缺失条件
    // （isbn/publisher/category 缺）纳入，防「pcUrl 已好但元数据没补齐」的书永远不再进队列。
    const needsMetadataWork = (b) =>
      shouldRefreshMetadata(b) || !b.isbn || !b.publisher || !b.category;
    const metadataBooksToSync = remoteBooks.filter((remoteBook) => {
      const localBook = localBooksMap.get(remoteBook.bookId);
      return localBook ? needsMetadataWork(localBook) : false;
    });
    // v1.9.3 增量兜底与空书跳过：noteSyncMarks 记录每本书最近一次全量笔记拉取时间
    const syncMarks = store.getState(accountId, 'noteSyncMarks', {}) || {};
    const nowMs = Date.now();
    // P2（时钟回拨）：mark 处于未来 → 判为回拨产物，按 0 处理（否则空书跳过窗口被「未来化」拉长到 30 天）
    const markOf = (id) => { const t = Number(syncMarks[id] || 0); return t > nowMs + 60_000 ? 0 : t; };
    // v1.9.3 空书跳过：无笔记的书拉回空后不落盘（无内容可写）→ 若无条件按「新书」判定，
    // 每轮都重拉一次空 bookmarklist。已核实（marks 新鲜）且远端计数仍为 0 的空书跳过；
    // 计数一旦出现（写了第一条划线）立即恢复拉取；30 天兜底到期强制重核。
    const knownEmptyIds = new Set(syncPlan.booksToSync
      .filter((b) => !localBooksMap.has(b.bookId)
        && (Number(b.highlightCount) || 0) + (Number(b.noteCount) || 0) + (Number(b.reviewCount) || 0) === 0
        && nowMs - markOf(b.bookId) <= NOTES_FULL_SYNC_EVERY_MS)
      .map((b) => b.bookId));
    const changedIds = new Set(syncPlan.booksToSync.map((b) => b.bookId).filter((id) => !knownEmptyIds.has(id)));
    const metadataOnlyIds = new Set(metadataBooksToSync.map((b) => b.bookId).filter((id) => !changedIds.has(id)));
    // v1.9.3 增量兜底：计数未变但距上次全量笔记拉取 >30 天的书强制重拉一轮
    // （覆盖想法编辑等「计数不变内容变」的边缘 + v1.8.15 类 createTime 自愈的历史修复）。首轮 marks 空 → 全拉（等同首启全量语义）。
    const dueForFullSync = remoteBooks.filter((b) => {
      if (changedIds.has(b.bookId)) return false; // 已在队列（全拉）
      const last = markOf(b.bookId);
      return nowMs - last > NOTES_FULL_SYNC_EVERY_MS;
    });
    // 到期全拉优先于元数据轻路径（marks 不含轻路径书——它们从没拉过笔记，到期即该真正全量核一次）
    for (const b of dueForFullSync) metadataOnlyIds.delete(b.bookId);
    const booksToSync =
      localBooks.length === 0
        ? remoteBooks
        : Array.from(
            new Map(
              [...syncPlan.booksToSync, ...metadataBooksToSync, ...dueForFullSync]
                .filter((b) => !knownEmptyIds.has(b.bookId)) // v1.9.3：已核实的空书不进队列（防每轮空拉）
                .map((b) => [b.bookId, b])
            ).values()
          );
    estimatedTotalNotes.set(
      accountId,
      booksToSync.reduce((sum, b) => sum + (b.highlightCount || 0) + (b.noteCount || 0), 0)
    );

    let updatedBooks = 0;
    let updatedNotes = 0;
    let failedBooks = [];
    let cancelled = false;
    let fullSyncedBookIds = [];
    if (booksToSync.length > 0) {
      const synced = await syncBooksConcurrently(booksToSync, accountId, metadataOnlyIds);
      for (const item of synced.results) {
        if (item.updated) {
          updatedBooks += 1;
          updatedNotes += item.notesCount;
        }
      }
      failedBooks = synced.failedBooks;
      cancelled = !!synced.cancelled;
      fullSyncedBookIds = synced.fullSyncedBookIds || [];
    }
    // v1.9.3：本轮真拉过笔记的书刷新兜底计时（一轮一次批量写盘；未拉的书保留旧 mark 到期再拉）
    if (fullSyncedBookIds.length) {
      try {
        const marks = { ...(store.getState(accountId, 'noteSyncMarks', {}) || {}) };
        for (const id of fullSyncedBookIds) marks[id] = nowMs;
        store.setState(accountId, 'noteSyncMarks', marks);
      } catch { /* 兜底计时写失败不影响同步 */ }
    }

    updateProgress(SyncStep.SavingData, remoteBooks.length, remoteBooks.length, '保存数据', accountId);
    // v1.2.1 顺序：清理（会改名/迁移文件）→ 索引重建 → 聚合 → 对账。
    // 旧序在 cleanup 前建索引，对账按陈旧路径解析（文件已被改名）→ 数字错位（真机 0↔3 轮转的另一半根因）
    if (cleanup && typeof cleanup.cleanupDuplicateBookFilesForAccount === 'function') {
      try {
        const cleanupResult = await cleanup.cleanupDuplicateBookFilesForAccount(accountId);
        if (cleanupResult.movedFiles > 0) {
          logger(
            'info',
            `[Sync][account:${accountId}] duplicate book files cleaned moved=${cleanupResult.movedFiles} groups=${cleanupResult.duplicateGroups}`
          );
        }
      } catch (error) {
        logger('warn', `[Sync][account:${accountId}] duplicate file cleanup failed: ${error?.message || error}`);
      }
    }
    await index.rebuildFromConfiguredPath(accountId).catch((e) =>
      logger('warn', `索引重建失败: ${e?.message || e}`)
    );
    await rebuildDailyAgg(accountId).catch((e) =>
      logger('warn', `dailyAgg 重建失败: ${e?.message || e}`)
    );
    // v1.9.3：取消时跳过对账——半轮同步必然计数不全，对账必误报差异
    if (!cancelled) {
      await runReconcile(accountId, gatewayNotebooksCache).catch((e) =>
        logger('warn', `[Sync][account:${accountId}] 对账异常: ${e?.message || e}`)
      );
    }
    // v1.8.8：完成摘要入 syncState（客户端完成 toast 显示增量：N 本书 · M 条笔记；全 0 时客户端报「无更新」）
    // v1.9.3：取消终态——已完成的书保留（每本书完整合并后单文件原子写，无半本文件），
    // 状态与摘要带 cancelled（区别于 failed，UI 不显示红色错误）。
    updateSyncStatus(accountId, cancelled ? SyncStatus.Cancelled : SyncStatus.Success, undefined, {
      syncedBooks: updatedBooks,
      syncedNotes: updatedNotes,
      failedBooks: failedBooks.length,
      at: Date.now(),
      ...(cancelled ? { cancelled: true } : {}),
    });
    // P2-6（对抗审查 v2）：部分书失败不再静默——整轮仍标 Success（部分成功算成功），完成消息与结果对象带失败明细
    updateProgress(
      SyncStep.Completed,
      remoteBooks.length,
      remoteBooks.length,
      cancelled ? '已取消（已完成部分保留，未完成的书下次同步自动补齐）'
        : failedBooks.length
          ? `同步完成（${failedBooks.length} 本失败：${failedBooks[0].error}）`
          : '同步完成',
      accountId
    );

    return {
      success: !cancelled,
      ...(cancelled ? { cancelled: true } : {}),
      syncedBooks: updatedBooks,
      syncedNotes: updatedNotes,
      ...(failedBooks.length ? { failedBooks } : {}),
      syncTime: Date.now(),
      accountId,
    };
  }

  async function runSync(accountId) {
    const targetAccountId = resolveAccountId(accountId);
    if (!targetAccountId) {
      return {
        success: false, syncedBooks: 0, syncedNotes: 0, error: '未设置活跃账号', syncTime: Date.now(),
      };
    }
    if (syncingAccounts.has(targetAccountId)) {
      return {
        success: false, syncedBooks: 0, syncedNotes: 0, error: '同步正在进行中', syncTime: Date.now(),
      };
    }
    syncingAccounts.add(targetAccountId);
    invalidateCanonicalIndex();
    // v1.1.2：本轮同步缓存的网关 notebooks（loadRemoteBooks 拉取，runReconcile 复用免二次翻页）
    // P2-5（对抗审查 v2）：挪进 runSync 函数作用域——原闭包级变量会被并发不同账号的同步轮互相污染
    const gatewayNotebooksCache = { notebooks: null };
    syncedBookCount.set(targetAccountId, 0);
    syncedNotesCount.set(targetAccountId, 0);
    estimatedTotalNotes.set(targetAccountId, 0);
    try {
      updateSyncStatus(targetAccountId, SyncStatus.Syncing);
      const remoteBooks = await loadRemoteBooks(gatewayNotebooksCache);
      const localBooks = await index.queryBooks(targetAccountId);
      const result = await syncChangedBooks(remoteBooks, localBooks, targetAccountId, gatewayNotebooksCache);
      const withAccount = { ...result, accountId: targetAccountId };
      return withAccount;
    } catch (error) {
      const errorMessage = error?.message || '同步失败';
      // v1.9.8：401/「登录已过期」类失败打 loginExpired 标——重新登录（如阅读窗口恢复登录态）后
      // 客户端隐藏该陈旧横幅（真机反馈：「⚠️ 同步失败：登录已过期，请重新登录」在登录恢复后仍常驻，
      // 因 failed 终态原本无任何消除条件，只能等下一轮同步）
      const loginExpired = error?.statusCode === 401 || errorMessage.includes('登录已过期');
      updateSyncStatus(targetAccountId, SyncStatus.Failed, errorMessage, undefined, loginExpired);
      const result = {
        success: false, syncedBooks: 0, syncedNotes: 0, error: errorMessage,
        syncTime: Date.now(), accountId: targetAccountId,
      };
      return result;
    } finally {
      syncingAccounts.delete(targetAccountId);
      cancelRequestedAccounts.delete(targetAccountId); // v1.9.3：取消标志随轮释放——下一轮同步从干净状态开始
      invalidateCanonicalIndex();
      notesCache.clear(); // C2: 一轮同步结束统一清理，防跨轮/跨账号滞留
    }
  }

  /** 全量同步（与增量实现一致，仅语义不同） */
  async function fullSync(accountId) {
    return runSync(accountId);
  }

  /** 增量同步 */
  async function incrementalSync(accountId) {
    return runSync(accountId);
  }

  /** 单书同步（书籍详情页手动刷新）——与主管线同规则（v1.0.5 修复数据丢失）：
   *  原实现直接把远端笔记写盘；公众号书等场景远端 bookmarklist 常返回空列表，
   *  一次"刷新"即把本地笔记清空成"暂无笔记"。现对齐主管线：本地合并保护，远端为空不覆盖本地。 */
  async function syncBook(bookId, accountId) {
    const targetAccountId = resolveAccountId(accountId);
    // P1-7（对抗审查 v2）：与 fullSync 互斥（原版零互斥：详情页刷新×全量同步并发双写同书文件+双 rebuild 交错）
    if (syncingAccounts.has(targetAccountId)) {
      throw new Error('同步正在进行中，请稍后再试');
    }
    syncingAccounts.add(targetAccountId);
    try {
    const notesData = await getBookNotesWithCache(bookId, targetAccountId);
    let remoteNotes = apiMethods.transformNotes(notesData, bookId);
    let bookReview = null;
    if (!String(bookId).startsWith('article:')) {
      const rawReviews = await fetchRemoteReviews(bookId, targetAccountId);
      if (rawReviews && rawReviews.length) {
        const transformed = transformMyReviews(rawReviews, bookId);
        const merged = mergeReviewsIntoNotes(remoteNotes, transformed, {
          chapterTitleByUid: chapterTitleMapFromNotesData(notesData),
        });
        remoteNotes = merged.notes;
        bookReview = merged.bookReview;
      }
    }
    const localBook = await index.getBookById(bookId, targetAccountId);
    if (localBook) {
      // v1.7.5：同主管线——type-4 书评笔记不进变更判定/合并，仅作重写兜底
      const localNotesAll = (await index.getNotesByBookId(bookId, targetAccountId).catch(() => [])) ?? [];
      const localNotes = localNotesAll.filter((n) => Number(n.type) !== 4);
      const localReviewNote = localNotesAll.find((n) => Number(n.type) === 4 && String(n.thoughtText || '').trim());
      const noteChanges = detectNoteChanges(localNotes, remoteNotes);
      const changedNotesCount =
        noteChanges.added.length + noteChanges.modified.length + noteChanges.deleted.length;
      // v1.1.2：书评独立通道，有即写（同主管线）
      const shouldUpdate = shouldUpdateBookNotes(localNotes, remoteNotes, changedNotesCount) || !!bookReview;
      const needsMetadataRefresh = shouldRefreshMetadata(localBook);
      if (shouldUpdate || needsMetadataRefresh) {
        const notes = shouldUpdate ? mergeWithLocalNotes(localNotes, remoteNotes) : localNotes;
        await enrichBookMetadataIfNeeded(localBook).catch(() => undefined);
        localBook.highlightCount = notes.filter((n) => n.highlightText).length;
        localBook.noteCount = notes.length;
        localBook.reviewCount = notes.filter((n) => n.type === 4 || n.thoughtText).length;
        const effectiveReview = bookReview?.content
          ? bookReview
          : (localReviewNote ? { content: localReviewNote.thoughtText } : undefined);
        await exportBookForSyncWithNotes(localBook, notes, targetAccountId, effectiveReview);
        await index.rebuildFromConfiguredPath(targetAccountId).catch(() => undefined);
        await rebuildDailyAgg(targetAccountId).catch(() => undefined);
        return notes;
      }
      return localNotes;
    }
    return remoteNotes;
    } finally {
      syncingAccounts.delete(targetAccountId); // P1-7：互斥释放（成功/失败路径都走）
    }
  }

  function isSyncingInProgress(accountId) {
    const targetAccountId = resolveAccountId(accountId);
    if (targetAccountId) return syncingAccounts.has(targetAccountId);
    return syncingAccounts.size > 0;
  }

  function getSyncState(accountId) {
    return store.getState(resolveAccountId(accountId), 'syncState', {
      lastSyncTime: 0,
      status: SyncStatus.Idle,
      dataVersion: 1,
    });
  }

  return {
    fullSync,
    incrementalSync,
    syncBook,
    isSyncingInProgress,
    requestCancel, // v1.9.3：软取消（协作式，书边界检查点；在飞书自然完成）
    getSyncState,
  };
}
