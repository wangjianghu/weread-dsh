// lib/cleanup.js —— 重复笔记文件清理（weread-vscode bookFileCleanupService 移植）
// ._weread_trash/<ts>/ + cleanup-manifest / restore-plan JSON。契约见 analysis-03 §1.8。

import fs from 'node:fs';
import path from 'node:path';

function normalizeBookIdLocal(raw) {
  return String(raw || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').trim();
}

/** @param {{store:object, markdown:{sanitizePathSegment?:Function}, configGetter:()=>{outputPath:string}, log:Function}} deps */
export function createCleanupService({ store, markdown, configGetter, log }) {
  const logger = typeof log === 'function' ? log : () => {};
  const sanitizeSegment =
    typeof markdown?.sanitizePathSegment === 'function'
      ? markdown.sanitizePathSegment
      : (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '未分类';

  function resolveAccountId(accountId) {
    const normalized = String(accountId || '').trim();
    if (normalized) return normalized;
    const active = store?.getActiveAccountId?.();
    return String(active || '').trim() || undefined;
  }

  /** 根集合：[accounts/<id>(若存在), outputPath]，根扫描跳过 阅读洞察报告/._weread_trash/accounts 子树 */
  function resolveOutputRootsForAccount(accountId) {
    const config = configGetter() || {};
    const baseOutputPath = String(config.outputPath || '').trim();
    if (!baseOutputPath) return [];
    const base = path.resolve(baseOutputPath);
    const roots = [];
    const normalized = String(accountId || '').trim();
    if (normalized) {
      const accountDir = path.join(base, 'accounts', normalized);
      if (fs.existsSync(accountDir)) roots.push(path.resolve(accountDir));
    }
    roots.push(base);
    return Array.from(new Set(roots));
  }

  async function collectMarkdownFiles(roots) {
    const seen = new Set();
    const result = [];
    const stack = roots.map((rootPath) => ({
      current: rootPath,
      sourceRoot: rootPath,
      skipAccountsDir: path.basename(rootPath) !== 'accounts',
    }));
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
          if (entry.name === '阅读洞察报告' || entry.name === '._weread_trash') continue;
          if (frame.skipAccountsDir && entry.name === 'accounts') continue;
          stack.push({ current: fullPath, sourceRoot: frame.sourceRoot, skipAccountsDir: frame.skipAccountsDir });
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const resolved = path.resolve(fullPath);
          if (seen.has(resolved)) continue;
          seen.add(resolved);
          result.push({ filePath: resolved, sourceRoot: frame.sourceRoot });
        }
      }
    }
    return result;
  }

  function parseFrontmatter(content) {
    const normalized = content.replace(/^\uFEFF/, '');
    if (!normalized.startsWith('---')) return {};
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

  function extractLooseField(content, key) {
    const pattern = new RegExp(`^\\s*["']?${key}["']?\\s*:\\s*["']?([^"\\r\\n]+)["']?\\s*$`, 'im');
    const matched = content.replace(/^\uFEFF/, '').match(pattern);
    return matched?.[1]?.trim();
  }

  async function readCandidate(filePath, sourceRoot) {
    let fileMtimeMs = 0;
    try {
      const stat = await fs.promises.stat(filePath);
      fileMtimeMs = Number(stat.mtimeMs || 0);
    } catch {
      return undefined;
    }
    let content = '';
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return undefined;
    }
    const frontmatter = parseFrontmatter(content);
    const rawBookId = String(
      frontmatter.bookid ||
        frontmatter.bookId ||
        extractLooseField(content, 'bookid') ||
        extractLooseField(content, 'bookId') ||
        ''
    ).trim();
    const bookId = normalizeBookIdLocal(rawBookId);
    if (!bookId) return undefined;
    const lastReadRaw = Number(frontmatter.lastReadTime || extractLooseField(content, 'lastReadTime') || 0);
    const title = String(frontmatter.title || extractLooseField(content, 'title') || '').trim();
    return {
      bookId,
      filePath,
      sourceRoot,
      title,
      lastReadTime: Number.isFinite(lastReadRaw) ? lastReadRaw : 0,
      fileMtimeMs,
    };
  }

  function compareCandidate(a, b) {
    const aLastRead = Number(a.lastReadTime || 0);
    const bLastRead = Number(b.lastReadTime || 0);
    if (aLastRead !== bLastRead) return bLastRead - aLastRead;
    const aMtime = Number(a.fileMtimeMs || 0);
    const bMtime = Number(b.fileMtimeMs || 0);
    if (aMtime !== bMtime) return bMtime - aMtime;
    return a.filePath.localeCompare(b.filePath);
  }

  function resolveCleanupReason(kept, dropped) {
    if (Number(kept.lastReadTime || 0) > Number(dropped.lastReadTime || 0)) return 'newer_last_read';
    if (
      Number(kept.lastReadTime || 0) === Number(dropped.lastReadTime || 0) &&
      Number(kept.fileMtimeMs || 0) > Number(dropped.fileMtimeMs || 0)
    ) {
      return 'newer_file_mtime';
    }
    return 'kept_existing';
  }

  async function reserveUniquePath(preferredPath) {
    const ext = path.extname(preferredPath);
    const dir = path.dirname(preferredPath);
    const baseName = path.basename(preferredPath, ext);
    let index = 0;
    for (;;) {
      const candidate =
        index === 0 ? path.join(dir, `${baseName}${ext}`) : path.join(dir, `${baseName}_${index}${ext}`);
      try {
        await fs.promises.access(candidate);
        index += 1;
      } catch {
        return candidate;
      }
    }
  }

  /** 移入 trash 保持相对目录结构（越界只用文件名），目标占用 _N 后缀 */
  async function moveToTrash(sourceRoot, sourcePath, trashDir) {
    const relativePath = path.relative(sourceRoot, sourcePath);
    const safeRelativePath = relativePath.startsWith('..') ? path.basename(sourcePath) : relativePath;
    const targetPath = await reserveUniquePath(path.join(trashDir, safeRelativePath));
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.rename(sourcePath, targetPath);
    return targetPath;
  }

  function canonicalBaseName(title) {
    return sanitizeSegment(title).replace(/\.md$/i, '');
  }

  function needsCanonicalRename(kept) {
    const title = kept.title.trim();
    if (!title) return false;
    const canonical = canonicalBaseName(title);
    if (!canonical) return false;
    return path.basename(kept.filePath, path.extname(kept.filePath)) !== canonical;
  }

  async function renameKeptToCanonicalTitle(kept) {
    const title = kept.title.trim();
    if (!title) return false;
    const canonical = canonicalBaseName(title);
    if (!canonical) return false;
    const targetPath = path.join(path.dirname(kept.filePath), `${canonical}.md`);
    if (path.resolve(targetPath) === path.resolve(kept.filePath)) return false;
    const reserved = await reserveUniquePath(targetPath);
    await fs.promises.rename(kept.filePath, reserved);
    kept.filePath = reserved;
    return true;
  }

  async function cleanupDuplicateBookFilesForAccount(accountId, options = {}) {
    const dryRun = !!options.dryRun;
    const resolvedAccountId = resolveAccountId(accountId);
    const outputRoots = resolveOutputRootsForAccount(resolvedAccountId);
    const outputPath = outputRoots[0];
    const timestampMs = Number(options.timestampMs || Date.now());
    const result = {
      accountId: resolvedAccountId,
      outputPath,
      scannedRoots: outputRoots,
      scannedFiles: 0,
      duplicateGroups: 0,
      movedFiles: 0,
      normalizedRenames: 0,
      actions: [],
      skips: [],
      dryRun,
    };
    if (!outputPath) return result;

    const markdownFiles = await collectMarkdownFiles(outputRoots);
    result.scannedFiles = markdownFiles.length;
    const grouped = new Map();
    for (const item of markdownFiles) {
      const candidate = await readCandidate(item.filePath, item.sourceRoot);
      if (!candidate) {
        result.skips.push({ filePath: item.filePath, reason: 'missing_or_invalid_bookId' });
        continue;
      }
      const list = grouped.get(candidate.bookId) || [];
      list.push(candidate);
      grouped.set(candidate.bookId, list);
    }

    const trashDir = path.join(outputPath, '._weread_trash', `${timestampMs}`);
    const restorePlan = [];
    for (const [bookId, entries] of grouped.entries()) {
      const sorted = entries.sort(compareCandidate);
      const kept = sorted[0];
      if (entries.length <= 1) {
        if (dryRun) {
          if (needsCanonicalRename(kept)) result.normalizedRenames += 1;
        } else if (await renameKeptToCanonicalTitle(kept)) {
          result.normalizedRenames += 1;
        }
        continue;
      }
      result.duplicateGroups += 1;
      const actionStartIndex = result.actions.length;
      for (const dropped of sorted.slice(1)) {
        const action = {
          bookId,
          keptPath: kept.filePath,
          droppedPath: dropped.filePath,
          reason: resolveCleanupReason(kept, dropped),
        };
        if (!dryRun) {
          const trashPath = await moveToTrash(dropped.sourceRoot, dropped.filePath, trashDir);
          action.trashPath = trashPath;
          result.movedFiles += 1;
          restorePlan.push({ from: trashPath, to: dropped.filePath, bookId });
        }
        result.actions.push(action);
      }
      if (dryRun) {
        if (needsCanonicalRename(kept)) result.normalizedRenames += 1;
      } else {
        if (await renameKeptToCanonicalTitle(kept)) result.normalizedRenames += 1;
        for (let idx = actionStartIndex; idx < result.actions.length; idx += 1) {
          result.actions[idx].keptPath = kept.filePath;
        }
      }
    }

    if (!dryRun && result.actions.length > 0) {
      await fs.promises.mkdir(trashDir, { recursive: true });
      result.trashDir = trashDir;
      const manifestPath = path.join(trashDir, `cleanup-manifest-${timestampMs}.json`);
      const restorePlanPath = path.join(trashDir, `restore-plan-${timestampMs}.json`);
      const manifest = {
        accountId: resolvedAccountId,
        outputPath,
        executedAt: timestampMs,
        scannedFiles: result.scannedFiles,
        duplicateGroups: result.duplicateGroups,
        movedFiles: result.movedFiles,
        normalizedRenames: result.normalizedRenames,
        actions: result.actions,
        skips: result.skips,
      };
      await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
      await fs.promises.writeFile(restorePlanPath, `${JSON.stringify(restorePlan, null, 2)}\n`, 'utf-8');
      result.manifestPath = manifestPath;
      result.restorePlanPath = restorePlanPath;
    }

    logger(
      'info',
      `[cleanup] account=${resolvedAccountId || 'default'} scanned=${result.scannedFiles} groups=${result.duplicateGroups} moved=${result.movedFiles} renamed=${result.normalizedRenames} dryRun=${dryRun ? 1 : 0}`
    );
    return result;
  }

  async function restoreFilesFromPlan(restorePlanPath) {
    const raw = await fs.promises.readFile(restorePlanPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed) ? parsed : [];
    const result = {
      restorePlanPath,
      restoredFiles: 0,
      skippedFiles: 0,
      skipped: [],
    };
    for (const item of tasks) {
      const from = String(item.from || '').trim();
      const to = String(item.to || '').trim();
      if (!from || !to) {
        result.skippedFiles += 1;
        result.skipped.push({ from, to, reason: 'invalid_restore_item' });
        continue;
      }
      try {
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        await fs.promises.rename(from, to);
        result.restoredFiles += 1;
      } catch (error) {
        result.skippedFiles += 1;
        result.skipped.push({ from, to, reason: error?.message || 'restore_failed' });
      }
    }
    logger(
      'info',
      `[cleanup] restore plan=${restorePlanPath} restored=${result.restoredFiles} skipped=${result.skippedFiles}`
    );
    return result;
  }

  async function findLatestRestorePlanPath(accountId) {
    const roots = resolveOutputRootsForAccount(resolveAccountId(accountId));
    const restorePlans = [];
    for (const rootPath of roots) {
      const trashRoot = path.join(rootPath, '._weread_trash');
      let entries;
      try {
        entries = await fs.promises.readdir(trashRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirEntry of entries) {
        if (!dirEntry.isDirectory()) continue;
        const dirPath = path.join(trashRoot, dirEntry.name);
        let files;
        try {
          files = await fs.promises.readdir(dirPath);
        } catch {
          continue;
        }
        for (const fileName of files) {
          if (!/^restore-plan-\d+\.json$/i.test(fileName)) continue;
          const filePath = path.join(dirPath, fileName);
          try {
            const stat = await fs.promises.stat(filePath);
            restorePlans.push({ filePath, mtimeMs: Number(stat.mtimeMs || 0) });
          } catch {
            continue;
          }
        }
      }
    }
    if (restorePlans.length === 0) return undefined;
    restorePlans.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return restorePlans[0].filePath;
  }

  async function restoreLatest(accountId) {
    const planPath = await findLatestRestorePlanPath(accountId);
    if (!planPath) {
      return { restorePlanPath: undefined, restoredFiles: 0, skippedFiles: 0, skipped: [] };
    }
    return restoreFilesFromPlan(planPath);
  }

  return {
    cleanupDuplicateBookFilesForAccount,
    restoreFilesFromPlan,
    restoreLatest,
    findLatestRestorePlanPath,
  };
}
