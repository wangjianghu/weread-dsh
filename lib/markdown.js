/**
 * lib/markdown.js —— 模板渲染 + 解析（互为逆操作：写出 → 读回 得到相同笔记集）
 *
 * renderBookMarkdown(book, notes, {noteTemplate, review})  对齐 templateService.render
 * buildFileName(book, template)                            对齐 templateService.renderFileName
 * parseBookMarkdownContent(content, filePath)              对齐 localDataService.parseBookMarkdownContent
 * buildStableLocalNoteId(bookId, note)                     对齐 localDataService.buildStableLocalNoteId
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

export const NoteType = { Highlight: 1, Thought: 2, Chapter: 3, Review: 4 };
export const ReadingStatus = { NotStarted: 0, Reading: 1, Finished: 2 };

const DEFAULT_FILE_NAME_TEMPLATE = '{{title}}';

// ---------------------------------------------------------------- 模板引擎

function renderTemplateString(template, data) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    const value = getValueByPath(data, key);
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  });
}

function getValueByPath(data, key) {
  return key.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return current[part];
  }, data);
}

// ---------------------------------------------------------------- 字段格式化

function formatReadingStatus(status) {
  switch (status) {
    case 0:
      return '未开始';
    case 1:
      return '阅读中';
    case 2:
      return '已读完';
    default:
      return status === undefined || status === null ? undefined : String(status);
  }
}

function formatUnixSeconds(ms) {
  return ms ? new Date(ms * 1000).toLocaleString() : undefined;
}

/** v1.8.15：笔记「记录时间」规范格式（本地时区 YYYY-MM-DD HH:mm:ss）。
 * toLocaleString 依运行 locale 而变，Date.parse 无法保证往返（如 "30.09.2018, 19:46:33"），
 * 会导致 createTime 回读丢失；规范格式与 parseUnixSeconds 严格往返。 */
function formatNoteTime(sec) {
  if (!sec) return undefined;
  const ms = sec > 1_000_000_000_000 ? sec : sec * 1000; // 兼容误传毫秒
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------- frontmatter（17 字段）

export function buildFrontmatter(book) {
  const meta = [
    ['title', book.title],
    ['author', book.author],
    ['doc_type', book.docType],
    ['bookid', book.rawBookId || book.bookId],
    ['isbn', book.isbn],
    ['category', book.category],
    ['publisher', book.publisher],
    ['cover', book.cover],
    ['progress', `${book.progress}%`],
    ['noteCount', book.noteCount],
    ['reviewCount', book.reviewCount],
    ['readingStatus', formatReadingStatus(book.readingStatus)],
    ['totalReadDay', book.totalReadDay],
    ['readingTime', book.readingTime],
    ['readingDate', book.readingDate],
    ['lastReadTime', formatUnixSeconds(book.lastReadTime)],
    ['pcUrl', book.pcUrl],
  ];

  const lines = meta
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `${key}: ${String(value).replace(/\n/g, ' ')}`);

  return lines.length > 0 ? `---\n${lines.join('\n')}\n---` : '';
}

// ---------------------------------------------------------------- 书籍信息 / 章节

function buildBookInfoLines(book) {
  const rawLines = [
    ['**作者**', book.author],
    ['**doc_type**', book.docType],
    ['**bookid**', book.rawBookId || book.bookId],
    ['**分类**', book.category],
    ['**出版社**', book.publisher],
    ['**ISBN**', book.isbn],
    ['**出版时间**', book.publishTime],
    ['**阅读进度**', `${book.progress}%`],
    ['**noteCount**', book.noteCount],
    ['**reviewCount**', book.reviewCount],
    ['**readingStatus**', formatReadingStatus(book.readingStatus)],
    ['**totalReadDay**', book.totalReadDay],
    ['**readingTime**', book.readingTime ? `${book.readingTime} 分钟` : undefined],
    ['**readingDate**', book.readingDate],
    ['**最近阅读**', formatUnixSeconds(book.lastReadTime)],
    ['**简介**', book.intro],
    ['**PC地址**', book.pcUrl],
  ];

  return rawLines
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `- ${label}: ${value}`);
}

function buildBookInfoMarkdown(book) {
  const lines = buildBookInfoLines(book);
  return lines.length > 0 ? lines.join('\n') : '暂无可展示的书籍信息';
}

function getNoteEmoji(note) {
  return note.highlightText ? '🖍️' : '💬';
}

// P1-2（开源前对抗审查 v3）：内容行结构注入防护（写→读幂等）。
// 笔记内容（想法/书评，来源=微信读书服务端+用户手编文件）中出现与解析器结构行同形的文本
// （`### x`、`<!-- wr:nid:x -->`、`_记录时间：…`、`- 作者：…`、`💬/💭/🖍️…` 标记、列表行）
// 会被解析器当结构行消费 → noteId 劫持/章节伪造/后续笔记被吞。写盘时给同形行加零宽空格
// 前缀使其不匹配任何锚定结构正则；解析侧在并入内容前剥掉一个前导零宽空格还原。
const MD_STRUCT_ESCAPE = '\u200B';
const MD_STRUCT_LINE_RE = /^(?:#{1,6}\s|<!--\s*wr:nid:|_记录时间|_作者|[-*]\s|[\u{1F4AC}\u{1F4AD}\u{1F58D}\u{270D}\u{1F4A1}\u{1F4CC}])/u;
function escapeStructuralMdLine(line) {
  const s = String(line ?? '');
  return MD_STRUCT_LINE_RE.test(s) ? MD_STRUCT_ESCAPE + s : s;
}
function unescapeStructuralMdLine(line) {
  const s = String(line ?? '');
  return s.startsWith(MD_STRUCT_ESCAPE) ? s.slice(MD_STRUCT_ESCAPE.length) : s;
}

/** 笔记文本规范化（写盘前）：\r 清除、内部连续空行折叠（空行会终结解析续行块） */
function normalizeNoteText(text) {
  return String(text ?? '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
}

/** v1.1.3：划线逐行加 `> ` 前缀（标准 blockquote）。旧版只给首行加前缀，
 *  多行文本的续行变成裸文本——解析侧只认 `> ` 行，续行全丢（写→解析不幂等，
 *  2019 年公众号多行划线对账 0↔3 漂移的根因）。 */
function highlightQuoteLines(text) {
  const normalized = normalizeNoteText(text);
  if (!normalized) return [];
  return normalized.split('\n').map((line) => `> ${line}`);
}

function buildChaptersMarkdown(chapters) {
  if (chapters.length === 0) {
    return '暂无笔记';
  }

  const lines = [];
  for (const chapter of chapters) {
    lines.push(`### ${chapter.title}`);
    lines.push('');

    for (const note of chapter.notes) {
      // P0-1（对抗审查 v2）：远端 noteId 锚点——读回时优先还原稳定 ID，同步 diff 恢复幂等。
      // 手加/旧文件无 noteId 时不出锚点，读回走 buildStableLocalNoteId（内容哈希，同样稳定）。
      if (note.noteId && !String(note.noteId).startsWith('local_pending')) {
        lines.push(`<!-- wr:nid:${note.noteId} -->`);
      }
      const quote = highlightQuoteLines(note.highlightText);
      if (quote.length) {
        lines.push(`${note.emoji} 划线`);
        lines.push(...quote);
        lines.push('');
      }
      if (note.thoughtText) {
        const normalized = normalizeNoteText(note.thoughtText);
        if (normalized) {
          const [first, ...rest] = normalized.split('\n');
          lines.push(`💬 评论：${first}`);
          for (const line of rest) lines.push(escapeStructuralMdLine(line));
          lines.push('');
        }
      }
      if (note.createTime) {
        lines.push(`_记录时间：${note.createTime}_`);
        lines.push('');
      }
    }
  }

  return lines.join('\n').trim();
}

export function bookReviewMarkdown(review) {
  // P1-2：书评内容逐行转义，防 `### x`/`_记录时间` 等同形行被解析器当结构行消费
  return review?.content ? `## 书评\n\n${String(review.content).split('\n').map(escapeStructuralMdLine).join('\n')}` : '';
}

// ---------------------------------------------------------------- 渲染主入口

function getBuiltInTemplate() {
  return `{{frontmatter}}

# {{title}}

## 书籍信息
{{bookInfoMarkdown}}

## 读书笔记

{{chaptersMarkdown}}

{{bookReviewMarkdown}}
`;
}

export function renderBookMarkdown(book, notes, opts = {}) {
  const template =
    (typeof opts.noteTemplate === 'string' && opts.noteTemplate.trim()) || getBuiltInTemplate();
  const review = opts.review;

  // 按章节分组笔记（保留插入顺序）
  const chapterMap = new Map();
  for (const note of notes || []) {
    if (note.type === NoteType.Review) continue; // v1.7.5：整本书评只经 ## 书评 区块输出（type-4 不进章节，防双写）
    const chapterTitle = note.chapterTitle || '未分类';
    if (!chapterMap.has(chapterTitle)) {
      chapterMap.set(chapterTitle, []);
    }
    chapterMap.get(chapterTitle).push(note);
  }

  const chapters = [];
  for (const [title, chapterNotes] of chapterMap) {
    chapters.push({
      title,
      notes: chapterNotes.map((n) => ({
        noteId: n.noteId, // P0-1：携带 noteId 供 buildChaptersMarkdown 输出锚点
        emoji: getNoteEmoji(n),
        highlightText: n.highlightText,
        thoughtText: n.thoughtText,
        createTime: formatNoteTime(n.createTime),
        chapterTitle: n.chapterTitle,
      })),
    });
  }

  const data = {
    frontmatter: buildFrontmatter(book),
    bookInfoMarkdown: buildBookInfoMarkdown(book),
    title: book.title,
    author: book.author,
    cover: book.cover,
    docType: book.docType,
    bookid: book.rawBookId || book.bookId,
    isbn: book.isbn,
    publisher: book.publisher,
    publishTime: book.publishTime,
    category: book.category,
    progress: book.progress,
    noteCount: book.noteCount,
    reviewCount: book.reviewCount,
    readingStatus: formatReadingStatus(book.readingStatus),
    totalReadDay: book.totalReadDay,
    readingTime: book.readingTime,
    readingDate: book.readingDate,
    lastReadTime: formatUnixSeconds(book.lastReadTime),
    intro: book.intro,
    pcUrl: book.pcUrl,
    chapters,
    bookReview: review?.content,
    chaptersMarkdown: buildChaptersMarkdown(chapters),
    bookReviewMarkdown: bookReviewMarkdown(review),
  };

  try {
    return renderTemplateString(template, data);
  } catch (err) {
    // 渲染失败降级简单格式
    return renderSimple(book, notes || [], review);
  }
}

function renderSimple(book, notes, review) {
  const lines = [
    `# ${book.title}`,
    '',
    ...buildBookInfoLines(book),
    '',
    `**作者**: ${book.author}`,
    `**进度**: ${book.progress}%`,
    '',
    '## 笔记',
    '',
  ];

  for (const note of notes) {
    if (note.type === NoteType.Review) continue; // v1.7.5：type-4 只经 ## 书评 区块（防双写）
    if (note.highlightText) {
      lines.push(...highlightQuoteLines(note.highlightText)); // v1.1.3 逐行前缀，与主渲染器一致
      lines.push('');
    }
    if (note.thoughtText) {
      // P1-2：想法首行带 💭 前缀天然安全；续行逐行转义防结构注入
      const [firstThought, ...restThought] = normalizeNoteText(note.thoughtText).split('\n');
      lines.push(`💭 ${firstThought}`);
      for (const t of restThought) lines.push(escapeStructuralMdLine(t));
      lines.push('');
    }
  }

  if (review?.content) {
    lines.push('## 书评');
    lines.push('');
    // P1-2：书评内容逐行转义（书评区块内标题行会终结区块）
    lines.push(String(review.content).split('\n').map(escapeStructuralMdLine).join('\n'));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------- 文件名

/** 无实义标题（服务端 MP 文章常返回空串）→ 文件名回退 bookId，
 *  防止多书同名「未命名书籍」→ _N 改名乒乓 + 被重复清理误伤（v1.1.2） */
export function effectiveTitleForFile(book) {
  const title = String(book?.title ?? '').trim();
  if (title && title !== '未命名书籍' && title !== '未命名文章') return title;
  const id = String(book?.rawBookId || book?.bookId || '').trim();
  return id || title;
}

export function buildFileName(book, fileNameTemplate) {
  const template =
    (typeof fileNameTemplate === 'string' && fileNameTemplate.trim()) || DEFAULT_FILE_NAME_TEMPLATE;

  const data = {
    title: effectiveTitleForFile(book),
    author: book.author,
    isbn: book.isbn || '',
    category: book.category || '',
  };

  try {
    return sanitizeFileName(renderTemplateString(template, data));
  } catch {
    return sanitizeFileName(effectiveTitleForFile(book));
  }
}

function sanitizeFileName(fileName) {
  // 替换 Windows 和 macOS/Linux 中的非法字符
  return String(fileName || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .substring(0, 200);
}

export function sanitizePathSegment(segment) {
  return String(segment || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim().substring(0, 80) || '未分类'; // P2：截断防 ENAMETOOLONG（服务端可控的超长分类名）
}

// ---------------------------------------------------------------- 解析（与渲染互逆）

function normalizeMarkdownParsingContent(content) {
  return content.replace(/^\uFEFF/, '');
}

function isGenericMarkdownSectionTitle(title) {
  const normalized = String(title || '')
    .trim()
    .replace(/[：:]/g, '')
    .toLowerCase();
  return [
    '元数据',
    'metadata',
    '书籍信息',
    'book metadata',
    '读书笔记',
    '笔记',
    'notes',
    '书评',
    'review',
  ].includes(normalized);
}

function sanitizeFrontmatterValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

export function parseFrontmatter(content) {
  const lines = normalizeMarkdownParsingContent(content).split(/\r?\n/);
  let startIndex = 0;
  while (startIndex < lines.length && !lines[startIndex].trim()) {
    startIndex += 1;
  }
  if (lines.length - startIndex < 3 || lines[startIndex].trim() !== '---') {
    return {};
  }
  const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.trim() === '---');
  if (endIndex <= startIndex) {
    return {};
  }
  const record = {};
  for (let i = startIndex + 1; i < endIndex; i++) {
    const line = lines[i];
    const splitIndex = line.indexOf(':');
    if (splitIndex <= 0) {
      continue;
    }
    const key = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1).trim();
    if (!key) {
      continue;
    }
    record[key] = value;
  }
  return record;
}

export function buildStableLocalNoteId(bookId, note) {
  const payload = [
    String(bookId || note?.bookId || '').trim(),
    String(note?.chapterUid || 0).trim(),
    String(note?.chapterTitle || '').trim(),
    String(note?.type || '').trim(),
    String(note?.highlightText || '').trim(),
    String(note?.thoughtText || '').trim(),
    String(note?.createTime || 0).trim(),
  ].join('|');
  const digest = createHash('sha1').update(payload).digest('hex').slice(0, 12);
  return `local_${digest}`;
}

function parseProgress(raw) {
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw.replace('%', '').trim());
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, parsed));
}

function parseReadingStatus(raw) {
  if (!raw) {
    return ReadingStatus.NotStarted;
  }
  const normalized = raw.trim();
  if (normalized === '2' || normalized === '已读完') {
    return ReadingStatus.Finished;
  }
  if (normalized === '1' || normalized === '阅读中') {
    return ReadingStatus.Reading;
  }
  return ReadingStatus.NotStarted;
}

function parseNumber(raw) {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseUnixTimestamp(raw) {
  if (!raw) {
    return undefined;
  }
  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) {
    return direct > 1_000_000_000_000 ? Math.floor(direct / 1000) : Math.floor(direct);
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return undefined;
}

function normalizePcUrl(pcUrl) {
  const trimmed = String(pcUrl || '').trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^https?:\/\/weread\.qq\.com\/web\/reader\/MP_WXS_/i.test(trimmed)) {
    return trimmed.replace('/web/reader/', '/web/mp/reader/');
  }
  return trimmed;
}

function normalizeBookIdForParse(raw) {
  const normalized = String(raw || '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
  return normalized || `local_${Date.now()}`;
}

function parseMarkdownTitle(content) {
  const match = normalizeMarkdownParsingContent(content).match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim() || '';
  return isGenericMarkdownSectionTitle(title) ? '' : title;
}

function buildBaseNote(bookId, chapterTitle, type) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    noteId: `local_pending_${nowSec}`,
    bookId,
    chapterUid: 0,
    chapterTitle,
    type,
    // v1.8.15：默认 0（创建时间未知）而非解析时刻——
    // 1) 伪造会让时间线显示「解析/扫描时间」；2) buildStableLocalNoteId 内容哈希含 createTime，
    //    nowSec 导致无锚点笔记 noteId 每次解析漂移（type-4 书评注释早已点明此坑）。
    // 真实时间仅由「记录时间」行回填。
    createTime: 0,
  };
}

function parseNotes(content, bookId) {
  // v1.7.5：## 书评 区块回读为 type-4 整本书评笔记（详情页/漫游可见）
  // createTime=0 保证内容哈希 noteId 跨解析稳定；渲染器跳过 type-4 防双写
  function pushReviewNoteFromBlock(notes, bookId, reviewLines) {
    const text = reviewLines.join('\n').trim();
    if (!text) return;
    notes.push({ noteId: 'local_pending_review', bookId, chapterUid: 0, chapterTitle: '书评', type: NoteType.Review, createTime: 0, thoughtText: text });
  }

  const lines = content.split(/\r?\n/);
  const notes = [];
  let currentChapter = '未分类章节';
  let lastNote = undefined;
  // v1.1.3 续行归并：`> ` 相邻行并入同一条划线；💬 行后的裸文本行并入同一条想法；
  // 空行 / 标题 / 列表 / emoji 标记 / 时间与作者行终结当前块。旧版文件（只首行带 >）由此追溯找回丢失文本。
  let blockOpen = false;
  // P0-1（对抗审查 v2）：noteId 锚点 + 💬 并入规则。
  // 远端「划线+想法」是同一条笔记（type=1, thoughtText 附着），渲染顺序 划线→💬→时间；
  // 解析侧 💬 紧跟未被时间行/章节边界终结的划线时并入同条，否则新建独立想法。
  // 时间行/章节标题 = 笔记终结符（跨条场景的判别依据：上一条的时间行必在其 💬 之后）。
  let pendingNoteId = undefined;
  let noteClosed = false;
  // v1.7.5 书评区块采集状态：## 书评 之后到下一个标题/EOF 的全部内容为整本书评
  let inReviewBlock = false;
  let reviewLines = [];
  // P2 伴生修复（存量缺陷）：裸文本续行的归属看「最近标记」——💬 后的续行并入想法，
  // `> ` 后的续行并入划线。旧逻辑恒先查 highlightText，多行想法的续行被误并进划线文本。
  let lastMarkerWasComment = false;

  for (const line of lines) {
    if (inReviewBlock) {
      if (/^#{1,6}\s/.test(line)) {
        pushReviewNoteFromBlock(notes, bookId, reviewLines); // 区块被下一标题终结
        inReviewBlock = false;
        reviewLines = [];
        // 标题行落入下方常规处理
      } else {
        reviewLines.push(unescapeStructuralMdLine(line)); // P1-2：剥掉转义前缀还原内容
        continue;
      }
    } else if (/^##\s*书评\s*$/.test(line)) {
      inReviewBlock = true;
      reviewLines = [];
      lastNote = undefined;
      blockOpen = false;
      continue;
    }

    // P0-1：锚点行——应用到下一条新建的笔记（不改块状态：锚点位于笔记块之前）
    const anchorMatch = line.match(/^<!--\s*wr:nid:(\S+?)\s*-->$/);
    if (anchorMatch?.[1]) {
      pendingNoteId = anchorMatch[1];
      continue;
    }

    const chapterMatch = line.match(/^###\s+(.+)$/);
    if (chapterMatch?.[1]) {
      currentChapter = chapterMatch[1].trim() || '未分类章节';
      blockOpen = false;
      noteClosed = true; // 章节边界终结上一条（防跨章并入）
      continue;
    }

    // 划线：`> 内容` 与裸 `>`（旧版写出的 `> ` + 换行开头文本）都识别；相邻 `> ` 行为同一条
    const highlightMatch = line.match(/^>\s?(.*)$/);
    if (highlightMatch) {
      const content = highlightMatch[1] ?? '';
      if (blockOpen && lastNote && lastNote.type === NoteType.Highlight) {
        lastNote.highlightText =
          lastNote.highlightText === undefined ? content : `${lastNote.highlightText}\n${content}`;
      } else {
        const note = buildBaseNote(bookId, currentChapter, NoteType.Highlight);
        note.highlightText = content;
        if (pendingNoteId) { note.noteId = pendingNoteId; pendingNoteId = undefined; } // P0-1：还原远端锚点
        notes.push(note);
        lastNote = note;
        noteClosed = false;
        lastMarkerWasComment = false;
      }
      lastMarkerWasComment = false;
      blockOpen = true;
      continue;
    }

    const thoughtMatch = line.match(/^(?:[-*]\s*)?(?:💬|💭)\s*(?:评论)?[:：]?\s*(.+)$/);
    if (thoughtMatch?.[1]) {
      // P0-1：💬 紧跟未终结的划线 → 并入同条（远端「划线+想法」是同一条笔记 type=1）。
      // 仅当该划线未被时间行/章节边界终结且尚无想法时并入；否则是独立的纯想法笔记。
      if (lastNote && !noteClosed && lastNote.type === NoteType.Highlight && lastNote.thoughtText === undefined) {
        lastNote.thoughtText = thoughtMatch[1].trim();
        blockOpen = true;
        lastMarkerWasComment = true;
        continue;
      }
      const note = buildBaseNote(bookId, currentChapter, NoteType.Thought);
      note.thoughtText = thoughtMatch[1].trim();
      if (pendingNoteId) { note.noteId = pendingNoteId; pendingNoteId = undefined; } // P0-1：还原远端锚点
      notes.push(note);
      lastNote = note;
      noteClosed = false;
      lastMarkerWasComment = true;
      blockOpen = true;
      continue;
    }

    const timeMatch = line.match(/^_记录时间[:：](.+)_$/);
    if (timeMatch?.[1] && lastNote) {
      const ts = parseUnixTimestamp(timeMatch[1].trim());
      if (ts) {
        lastNote.createTime = ts;
      }
      blockOpen = false;
      noteClosed = true; // P0-1：时间行=笔记终结，其后的 💬 属下一条（跨条判别依据）
      continue;
    }

    const authorUnderscore = line.match(/^_作者[:：]\s*(.+?)_$/);
    if (authorUnderscore?.[1] && lastNote) {
      lastNote.author = authorUnderscore[1].trim();
      blockOpen = false;
      continue;
    }
    const authorDash = line.match(/^[-*]\s*作者[:：]\s*(.+)$/);
    if (authorDash?.[1] && lastNote) {
      lastNote.author = authorDash[1].trim();
      blockOpen = false;
      continue;
    }

    // 块终结符：空行 / 任意标题 / 列表行（书籍信息区）/ 划线 emoji 标记行
    if (line.trim() === '' || /^#{1,6}\s/.test(line) || /^[-*]\s/.test(line)
      || /^\s*(?:🖍️|✍️|💡|📌)\s*(?:划线|重点|高亮)?\s*$/.test(line)) {
      blockOpen = false;
      continue;
    }

    // 裸文本续行：并入当前块（想法续行；旧版文件中划线丢前缀的续行）；P1-2：剥转义前缀
    // P2 伴生：归属按最近标记（💬→想法；`> `/划线→划线）
    const contentLine = unescapeStructuralMdLine(line);
    if (blockOpen && lastNote) {
      if (lastMarkerWasComment && lastNote.thoughtText !== undefined) {
        lastNote.thoughtText = `${lastNote.thoughtText}\n${contentLine}`;
        continue;
      }
      if (lastNote.type === NoteType.Highlight && lastNote.highlightText !== undefined) {
        lastNote.highlightText = `${lastNote.highlightText}\n${contentLine}`;
        continue;
      }
      if (lastNote.thoughtText !== undefined) {
        lastNote.thoughtText = `${lastNote.thoughtText}\n${contentLine}`;
        continue;
      }
    }
  }
  if (inReviewBlock) pushReviewNoteFromBlock(notes, bookId, reviewLines); // EOF 终结书评区块
  for (const note of notes) {
    // P0-1：带远端锚点的 noteId 原样保留（幂等根基）；无锚点（旧文件/手加/书评）走内容哈希
    if (!note.noteId || String(note.noteId).startsWith('local_pending')) note.noteId = buildStableLocalNoteId(bookId, note);
  }
  return notes;
}

export function parseBookMarkdownContent(content, filePath) {
  if (!content || !content.trim()) {
    return undefined;
  }

  const frontmatter = parseFrontmatter(content);
  const fallbackTitle = parseMarkdownTitle(content) || path.basename(filePath, '.md');
  const fallbackCategory = path.basename(path.dirname(filePath));
  const bookId = normalizeBookIdForParse(frontmatter.bookid || frontmatter.bookId || `local:${filePath}`);
  const normalizedPcUrl = normalizePcUrl(frontmatter.pcUrl);
  const notes = parseNotes(content, bookId);
  const frontmatterTitle = sanitizeFrontmatterValue(frontmatter.title);
  const resolvedTitle =
    frontmatterTitle && !isGenericMarkdownSectionTitle(frontmatterTitle)
      ? frontmatterTitle
      : fallbackTitle;

  const book = {
    bookId,
    rawBookId: frontmatter.bookid || frontmatter.bookId || bookId,
    docType: frontmatter.doc_type || frontmatter.docType,
    title: resolvedTitle,
    author: sanitizeFrontmatterValue(frontmatter.author),
    cover: frontmatter.cover || '',
    isbn: frontmatter.isbn,
    publisher: frontmatter.publisher,
    publishTime: frontmatter.publishTime,
    category: frontmatter.category || fallbackCategory || '未分类',
    reviewCount: parseNumber(frontmatter.reviewCount),
    progress: parseProgress(frontmatter.progress),
    readingStatus: parseReadingStatus(frontmatter.readingStatus),
    totalReadDay: parseNumber(frontmatter.totalReadDay),
    readingTime: parseNumber(frontmatter.readingTime),
    readingDate: frontmatter.readingDate,
    lastReadTime: parseUnixTimestamp(frontmatter.lastReadTime),
    highlightCount: notes.filter((note) => note.type === NoteType.Highlight).length,
    noteCount: notes.length,
    pcUrl: normalizedPcUrl,
    localFilePath: filePath,
  };

  return { book, notes };
}
