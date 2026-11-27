/**
 * 微信读书 API 层（由 weread-vscode 0.1.2 src/api/* 移植）
 * - client: HTTP 客户端（Cookie 整串 + x-vid/x-skey 双通道鉴权，iOS UA，3 次重试）
 * - shelf: 书架（主数据源 notebook，shelf/sync 兜底）+ pcUrl readerId 算法
 * - notes: 笔记 / 热门划线 / 章节 + transform
 * - user: 用户资料 / 登录态判定
 * - articles: 公众号文章
 * - auth: 扫码登录裸接口（getLoginUid / getLoginInfo / wr_skey 刷新 HEAD）
 */
import { createHash } from 'node:crypto';

export const BASE_URL = 'https://i.weread.qq.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;
const UA = 'WeRead/7.0.0 (iPhone; iOS 16.0; Scale/3.00)';

function safeDecodeCookieValue(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function extractSessionFromCookies(cookies) {
  if (!cookies) return undefined;
  const vidMatch = cookies.match(/(?:^|;\s*)wr_vid=([^;]+)/);
  const skeyMatch = cookies.match(/(?:^|;\s*)wr_skey=([^;]+)/);
  if (!vidMatch || !skeyMatch) return undefined;
  return { vid: safeDecodeCookieValue(vidMatch[1]), skey: safeDecodeCookieValue(skeyMatch[1]) };
}

export class ApiClient {
  constructor() { this.cookies = ''; }
  setCookies(cookies) { this.cookies = cookies || ''; }
  getCookies() { return this.cookies; }
  clearCookies() { this.cookies = ''; }

  buildHeaders(extraHeaders) {
    const headers = {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (this.cookies) {
      headers.Cookie = this.cookies;
      const session = extractSessionFromCookies(this.cookies);
      if (session) {
        headers['x-vid'] = session.vid;
        headers['x-skey'] = session.skey;
      }
    }
    return headers;
  }

  buildUrl(url, params) {
    const resolved = /^https?:\/\//i.test(url) ? new URL(url) : new URL(url, BASE_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) resolved.searchParams.set(key, String(value));
      }
    }
    return resolved.toString();
  }

  handleHttpError(status, data) {
    switch (status) {
      case 401: return new Error('登录已过期，请重新登录');
      case 403: return new Error('没有权限访问该资源');
      case 404: return new Error('请求的资源不存在');
      case 500: return new Error('服务器内部错误');
      default: return new Error((data && data.message) || `请求失败 (${status})`);
    }
  }

  handleError(error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') return new Error('网络请求超时，请稍后重试');
      if (error.message) return error;
    }
    return new Error('网络请求失败，请检查网络连接');
  }

  async request(method, url, config = {}) {
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    const requestUrl = this.buildUrl(url, config.params);
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(requestUrl, {
          method,
          headers: this.buildHeaders(config.headers),
          body: method === 'POST' && config.body !== undefined ? JSON.stringify(config.body) : undefined,
          signal: controller.signal,
        });
        const rawText = await response.text();
        // P2：200 但非 JSON 的回包按确定性错误处理（statusCode 400 走既有不重试路径），
        // 不再被当作网络错误重试 3 次放大弱网请求。
        let data;
        try {
          data = rawText ? JSON.parse(rawText) : undefined;
        } catch {
          const parseErr = new Error(`响应非 JSON（HTTP ${response.status}，前 80 字符：${rawText.slice(0, 80)}）`);
          parseErr.statusCode = 400;
          throw parseErr;
        }
        if (!response.ok) {
          const httpErr = this.handleHttpError(response.status, data);
          // P2-1（对抗审查 v2）：4xx 属确定性失败（401 过期/404 无数据），重试只是放大外网请求
          // （401 时每请求 3 连发 ×3 并发 ×N 书）；仅 429 按 Retry-After 退避重试
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            httpErr.statusCode = response.status;
            throw httpErr; // 直接抛给 catch——下方 statusCode 判定不再重试
          }
          if (response.status === 429) {
            const retryAfter = Number(response.headers?.get('retry-after')) || RETRY_DELAY * attempt;
            if (attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, Math.min(60_000, retryAfter * 1000)));
              continue;
            }
          }
          throw httpErr;
        }
        return data;
      } catch (error) {
        lastError = this.handleError(error);
        // P2-1：确定性 4xx（非 429）不重试；退避加 ±20% jitter 防多 worker 同步重试风暴
        if (error?.statusCode >= 400 && error?.statusCode < 500) throw lastError;
        if (attempt >= MAX_RETRIES) throw lastError;
        await new Promise((r) => setTimeout(r, RETRY_DELAY * attempt * (0.8 + 0.4 * Math.random())));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error('未知错误');
  }

  get(url, config) { return this.request('GET', url, config); }
  post(url, data, config) { return this.request('POST', url, { ...config, body: data }); }
}

export const apiClient = new ApiClient();

// ---------------------------------------------------------------------------
// 裸接口（不走重试客户端）
// ---------------------------------------------------------------------------

/** 扫码登录：获取 uid */
export async function getLoginUid() {
  // P1-3（开源前对抗审查 v3）：裸 fetch 补 5s 超时（同 getLoginInfo/fetchUserInfo 的 P2-2/P1-12 修法），
  // 弱网下不再挂满 undici 默认 ~300s 让登录路由迟迟不回。
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('获取登录 UID 超时（5s）')), 5_000);
  try {
    const response = await fetch('https://weread.qq.com/api/auth/getLoginUid', {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ac.signal,
    });
    const rawText = await response.text();
    const data = rawText ? JSON.parse(rawText) : undefined;
    const uid = data && (data.uid || data.Uid);
    if (!uid) throw new Error('未获取到登录 UID');
    return String(uid);
  } finally {
    clearTimeout(timer);
  }
}

/** 扫码登录：轮询结果（1.5s 间隔 / 5min 总超时由调用方控制） */
export async function getLoginInfo(uid, otp) {
  const url = new URL('https://weread.qq.com/api/auth/getLoginInfo');
  url.searchParams.set('uid', uid);
  if (otp) url.searchParams.set('otp', otp);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000); // P2-2：扫码轮询 1.5s 一发，单请求必须短超时（原版可挂 ~300s 堆积）
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    const rawText = await response.text();
    return rawText ? JSON.parse(rawText) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** userInfo 裸接口（x-vid/x-skey header）——P1-12 加 5s 超时（原版裸 fetch 可挂 ~300s，堵死阅读窗口 open 串行队列） */
export async function fetchUserInfo(vid, skey) {
  const url = new URL('https://weread.qq.com/api/userInfo');
  url.searchParams.set('userVid', vid);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'x-vid': vid, 'x-skey': skey, 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    const rawText = await response.text();
    return rawText ? JSON.parse(rawText) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** 官网 TTFB 探测（openOfficialSite 网络探测用） */
export async function measureWereadTtfb(timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    await fetch('https://weread.qq.com/', { method: 'HEAD', signal: controller.signal, headers: { 'User-Agent': UA } });
    return Date.now() - start;
  } finally {
    clearTimeout(timer);
  }
}

/** v1.9.19：从阅读窗口页面 URL 取书 ID——/web/reader/<id> 与 /web/mp/reader/<id>（公众号文章）。
 *  「问 DSH」的提问项实时带着页面 URL，书 ID 就在其中（零额外请求）；取不到返回空串。 */
export function extractReaderBookId(url) {
  const m = /\/web\/(?:mp\/)?reader\/([^/?#]+)/.exec(String(url || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]).trim(); } catch { return String(m[1]).trim(); }
}

/** v1.9.15：从 Cookie 串提取 wr_skey 的值；缺失返回 undefined。 */
export function cookieSkey(cookieString) {
  return /(?:^|;\s*)wr_skey=([^;]+)/.exec(String(cookieString || ''))?.[1] || undefined;
}

/** v1.9.15：HEAD 续命是否真的换新了 wr_skey。
 *  真机实测（2026-11-25）：`HEAD https://weread.qq.com/` 只下发 wr_gid（设备标识），不下发
 *  wr_skey。原实现以「整串变化」为续命判据——wr_gid 一变就记为「wr_skey 续命」，日志谎报、
 *  设置页显示从未发生的续命。wr_skey 才是登录态的载体，故以它的值是否变化为唯一判据。
 *  任一侧缺失 wr_skey 不算续命（防把「丢失」误判为「换新」）。 */
export function skeyRotated(beforeCookies, afterCookies) {
  const before = cookieSkey(beforeCookies);
  const after = cookieSkey(afterCookies);
  return !!before && !!after && before !== after;
}

/** HEAD 官网，解析 Set-Cookie 合并进当前串。
 *  v1.9.0 C1：补 5s 超时（对齐 fetchUserInfo 的 P1-12）——开书预热把本函数挂进 open-reader
 *  路由后，裸 fetch 网络挂起会拖住整条开窗链。
 *  v1.9.15 更正认知：首页 HEAD 实测只下发 wr_gid，**不轮换 wr_skey**——本函数的职能是
 *  「带回服务端下发的 Cookie（含设备标识）」，不构成 skey 续命。是否换新 skey 由调用方用
 *  skeyRotated() 判定。 */
export async function refreshCookiesFromServer(currentCookies) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('https://weread.qq.com/', {
      method: 'HEAD',
      headers: { Cookie: currentCookies, 'User-Agent': UA },
      signal: controller.signal,
    });
    let setCookies = [];
    try { setCookies = response.headers.getSetCookie?.() ?? []; } catch { /* node < 19.7 */ }
    if (!setCookies.length) {
      const raw = response.headers.get('set-cookie');
      // v1.9.15：原正则 `(?<=[^,])\s*,?\s*(?=[^;=\s]+=)` 量词全为 *（可零宽）→ 匹配空串，
      // 把 'wr_gid=G2' 逐字符切成 ['w','r','_','g','i','d=G2;']，往 Cookie 串灌入垃圾键（d/h…）。
      // 仅在 headers.getSetCookie 缺席时触发（Node < 19.7 / 非标 Headers），生产路径不受影响，
      // 但换运行时即引爆。改为：按逗号切分，但不切日期里的逗号（Expires=Wed, 21 Oct 2015 …）。
      if (raw) setCookies = raw.split(/,\s*(?=[^;,\s]+=)/).map((x) => x.trim()).filter(Boolean);
    }
    if (!setCookies.length) return currentCookies;
    const map = {};
    for (const part of String(currentCookies || '').split(';')) {
      const idx = part.indexOf('=');
      // v1.9.16：本地侧丢弃空值项——空壳（`wr_vid=; wr_skey=`）不是凭据，合并不得把它延续下去
      // （真机现场：插件凭据长期停在 wr_vid=; wr_skey=; wr_gid=xxx，正是被一次次「合并」保下来的）。
      if (idx > 0 && part.slice(idx + 1).trim() !== '') map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    for (const sc of setCookies) {
      const head = String(sc).split(';')[0];
      const idx = head.indexOf('=');
      // v1.9.16：服务端侧也防御空值——空值下发一律忽略，绝不用它覆盖本地有效凭据
      // （原逻辑对下发的同名键无条件和本地覆盖，服务端一旦下发空值即毁掉登录态）。
      if (idx > 0 && head.slice(idx + 1).trim() !== '') map[head.slice(0, idx).trim()] = head.slice(idx + 1).trim();
    }
    const merged = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
    // 全部被滤空（本地只有空壳、服务端也没给有值项）→ 返回空串，调用方 saveCookies('') 会删键，
    // 而不是把空壳继续存下去。
    return merged;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// shelf（书架）
// ---------------------------------------------------------------------------

function pickStringFrom(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
  }
  return undefined;
}

function pickNumberFrom(sources, keys, fallback) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && value !== '') {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
  }
  return fallback;
}

function collectStringValuesFrom(sources, keys) {
  const values = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null) {
        const text = String(value).trim();
        if (text) values.push(text);
      }
    }
  }
  return values;
}

function getBookCandidates(raw) {
  return [raw, raw?.book, raw?.bookInfo, raw?.bookMeta, raw?.meta, raw?.extra, raw?.book?.bookInfo].filter(Boolean);
}

function pickCanonicalReaderId(sources, sourceBookId) {
  const candidates = collectStringValuesFrom(sources, [
    'bookId', 'bookid', 'docId', 'docid', 'readerId', 'infoId', 'readerBookId', 'mpBookId',
  ]);
  const uniqueCandidates = Array.from(new Set(candidates));
  const hexCandidate = uniqueCandidates.find((item) => item !== sourceBookId && /^[0-9a-f]{20,}$/i.test(item));
  if (hexCandidate) return hexCandidate;
  if (/^\d+$/.test(sourceBookId)) {
    return uniqueCandidates.find(
      (item) => item !== sourceBookId && /^[a-z0-9]{20,}$/i.test(item) && /[a-z]/i.test(item),
    );
  }
  return undefined;
}

function pickCategory(raw) {
  const categoryCandidates = [
    raw?.category, raw?.book?.category, raw?.bookInfo?.category,
    raw?.categoryName, raw?.book?.categoryName, raw?.bookInfo?.categoryName,
    raw?.categories, raw?.book?.categories, raw?.bookInfo?.categories,
    raw?.tags, raw?.book?.tags,
  ];
  for (const candidate of categoryCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (Array.isArray(candidate)) {
      const names = candidate
        .map((item) => (typeof item === 'string' ? item : item?.name || item?.title || item?.category || item?.categoryName))
        .filter((item) => !!item)
        .map((item) => String(item).trim());
      if (names.length > 0) return names.join(' / ');
    }
  }
  return undefined;
}

function md5Hex(input) {
  return createHash('md5').update(input).digest('hex');
}

function getFa(id) {
  if (/^\d*$/.test(id)) {
    const segments = [];
    for (let cursor = 0; cursor < id.length; cursor += 9) {
      const piece = id.slice(cursor, Math.min(cursor + 9, id.length));
      segments.push(parseInt(piece, 10).toString(16));
    }
    return ['3', segments];
  }
  let hexText = '';
  for (let index = 0; index < id.length; index += 1) {
    hexText += id.charCodeAt(index).toString(16);
  }
  return ['4', [hexText]];
}

export function buildReaderIdFromBookId(bookId) {
  const md5 = md5Hex(bookId);
  const fa = getFa(bookId);
  let readerId = md5.substring(0, 3);
  readerId += fa[0];
  readerId += `2${md5.substring(md5.length - 2)}`;
  for (let index = 0; index < fa[1].length; index += 1) {
    const piece = fa[1][index];
    readerId += piece.length.toString(16).padStart(2, '0');
    readerId += piece;
    if (index < fa[1].length - 1) readerId += 'g';
  }
  if (readerId.length < 20) readerId += md5.substring(0, 20 - readerId.length);
  readerId += md5Hex(readerId).substring(0, 3);
  return readerId;
}

export function buildPcUrl(bookId) {
  const sourceBookId = bookId.startsWith('article:') ? bookId.replace('article:', '') : bookId;
  const readerId = buildReaderIdFromBookId(sourceBookId);
  if (sourceBookId.startsWith('MP_WXS_')) return `https://weread.qq.com/web/mp/reader/${readerId}`;
  if (bookId.startsWith('article:')) return `https://weread.qq.com/web/mp/reader/${readerId}`;
  return `https://weread.qq.com/web/reader/${readerId}`;
}

function isMpReaderRouteBookId(bookId) {
  const sourceBookId = bookId.startsWith('article:') ? bookId.replace('article:', '') : bookId;
  return sourceBookId.startsWith('MP_WXS_') || bookId.startsWith('article:');
}

function buildReaderUrlByBookType(bookId, readerId) {
  if (isMpReaderRouteBookId(bookId)) return `https://weread.qq.com/web/mp/reader/${readerId}`;
  return `https://weread.qq.com/web/reader/${readerId}`;
}

function pickReaderUrlFromCandidates(sources) {
  const visited = new Set();
  const stack = [...sources];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    for (const value of Object.values(current)) {
      if (typeof value === 'string') {
        const url = value.trim();
        if (/^https?:\/\/weread\.qq\.com\/web\/(mp\/reader|reader)\//i.test(url)) return url;
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return undefined;
}

function normalizePcUrl(url, bookId) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return buildPcUrl(bookId);
  if (/^https?:\/\/weread\.qq\.com\/web\/reader\/MP_WXS_/i.test(trimmed)) return buildPcUrl(bookId);
  if (/^https?:\/\/weread\.qq\.com\/web\/mp\/reader\/MP_WXS_/i.test(trimmed)) return buildPcUrl(bookId);
  const numericReaderMatch = trimmed.match(/^https?:\/\/weread\.qq\.com\/web\/reader\/(\d+)(?:$|[?#])/i);
  if (numericReaderMatch && /^\d+$/.test(bookId)) return buildPcUrl(bookId);
  return trimmed;
}

function resolvePcUrl(candidates, bookId, canonicalReaderId) {
  const directUrl = pickStringFrom(candidates, ['pcUrl', 'pcURL', 'readerUrl', 'url', 'bookUrl', 'bookURL']);
  const deepReaderUrl = pickReaderUrlFromCandidates(candidates);
  const fallbackUrl = canonicalReaderId
    ? buildReaderUrlByBookType(bookId, canonicalReaderId)
    : buildPcUrl(bookId);
  return normalizePcUrl(directUrl || deepReaderUrl || fallbackUrl, bookId);
}

export function normalizeBookItem(raw) {
  if (!raw) return undefined;
  const candidates = getBookCandidates(raw);
  const bookId = pickStringFrom(candidates, ['bookId', 'bookid', 'docId', 'docid']) || '';
  if (!bookId) return undefined;

  const progressRaw = pickNumberFrom(candidates, ['progress', 'readingProgress', 'readProgress'], 0) || 0;
  const progress = progressRaw > 1 ? Math.round(progressRaw) : Math.round(progressRaw * 100);
  const readingStatus = pickNumberFrom(candidates, ['readingStatus', 'readingStat', 'readStatus'], 0) || 0;
  const highlightCount = pickNumberFrom(candidates, ['highlightCount', 'markCount', 'underlineCount'], 0) || 0;
  const thoughtCount = pickNumberFrom(candidates, ['noteCount', 'note_count', 'thoughtCount', 'commentCount'], 0) || 0;
  const reviewCount = pickNumberFrom(candidates, ['reviewCount', 'thoughtCount', 'commentCount'], thoughtCount) || 0;
  const noteCount = pickNumberFrom(candidates, ['noteCount', 'note_count', 'bookmarkCount'], highlightCount + thoughtCount) || 0;
  const category = pickStringFrom(candidates, ['category', 'categoryName', 'bookCategory', 'cat']) || pickCategory(raw);
  const canonicalReaderId = pickCanonicalReaderId(candidates, bookId);

  return {
    bookId,
    rawBookId: pickStringFrom(candidates, ['bookid', 'bookId', 'docId', 'docid']) || bookId,
    docType: pickStringFrom(candidates, ['docType', 'doc_type', 'type']),
    title: pickStringFrom(candidates, ['title', 'bookName', 'name']) || '未命名书籍',
    author: pickStringFrom(candidates, ['author', 'authorName', 'writer']) || '',
    cover: pickStringFrom(candidates, ['cover', 'coverUrl', 'cover_url']) || '',
    isbn: pickStringFrom(candidates, ['isbn', 'isbn13', 'bookIsbn']),
    publisher: pickStringFrom(candidates, ['publisher', 'press', 'bookPublisher', 'publish']),
    publishTime: pickStringFrom(candidates, ['publishTime', 'publishDate', 'publish_date']),
    category,
    intro: pickStringFrom(candidates, ['intro', 'introduction', 'bookIntro', 'abstract', 'description']),
    reviewCount,
    progress,
    readingStatus,
    totalReadDay: pickNumberFrom(candidates, ['totalReadDay', 'readDay', 'readDays']),
    readingTime: pickNumberFrom(candidates, ['readingTime', 'readTime', 'totalReadingTime']),
    readingDate: pickStringFrom(candidates, ['readingDate', 'readDate', 'lastReadingDate']),
    lastReadTime: pickNumberFrom(candidates, ['lastReadTime', 'updateTime', 'readUpdateTime'], 0) || 0,
    highlightCount,
    noteCount,
    pcUrl: resolvePcUrl(candidates, bookId, canonicalReaderId),
  };
}

async function loadNotebookBooks() {
  try {
    const notebookResp = await apiClient.get('https://weread.qq.com/api/user/notebook');
    const rawBooks = Array.isArray(notebookResp?.books) ? notebookResp.books : [];
    return rawBooks.map((item) => normalizeBookItem(item)).filter(Boolean);
  } catch {
    const response = await apiClient.get('/shelf/sync', { params: { synckey: 0, teenmode: 0, album: 1 } });
    return (response.books || []).map((item) => normalizeBookItem(item)).filter(Boolean);
  }
}

export async function getShelfList() {
  const books = await loadNotebookBooks();
  return {
    books: books.map((book) => ({ book, lastReadTime: book.lastReadTime || 0, progress: book.progress })),
    totalCount: books.length,
    syncTime: Date.now(),
  };
}

export async function getBookInfo(bookId) {
  const response = await apiClient.get('/book/info', { params: { bookId } });
  const canonicalBookId = String(response.bookId || '').trim() || bookId;
  const canonicalReaderId = pickCanonicalReaderId([response], bookId);
  const pcUrl = resolvePcUrl(
    [response],
    bookId,
    canonicalReaderId || (canonicalBookId !== bookId ? canonicalBookId : undefined),
  );
  return {
    bookId: canonicalBookId,
    title: response.title,
    author: response.author,
    cover: response.cover,
    isbn: response.isbn,
    publisher: response.publisher,
    publishTime: response.publishTime,
    category: response.category,
    intro: response.intro,
    progress: Math.round(response.progress * 100),
    readingStatus: response.readingStatus,
    pcUrl,
  };
}

// ---------------------------------------------------------------------------
// notes（笔记）
// ---------------------------------------------------------------------------

export const NoteType = { Highlight: 1, Thought: 2, Chapter: 3, Review: 4 };

function pickString(obj, keys) {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function pickRawNotes(data) {
  const directCandidates = [data?.bookmarks, data?.updated, data?.notes, data?.items, data?.data, data?.list];
  for (const c of directCandidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  for (const value of Object.values(data || {})) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first && (first.bookmarkId || first.reviewId || first.markText || first.text || first.content)) return value;
    }
  }
  const visited = new Set();
  const stack = [data];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current) && current.length > 0) {
      const first = current[0];
      if (first && (first.bookmarkId || first.reviewId || first.markText || first.text || first.content)) return current;
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [];
}

function parseStyle(styleStr) {
  try {
    const style = JSON.parse(styleStr);
    return { color: style.color };
  } catch {
    return {};
  }
}

let noteIdFallbackSeq = 0; // P2：同批多条无 ID 笔记的 Date.now() 兜底防同秒碰撞（diff 误判）
export function transformNotes(data, bookId) {
  const source = pickRawNotes(data);
  if (!source || source.length === 0) return [];
  return source.map((item) => {
    const raw = item;
    const noteAuthor = pickString(raw, ['author', 'authorName', 'producer', 'publisherName', 'source']);
    return {
      noteId: item.bookmarkId || item.reviewId || `${bookId}-${item.chapterUid || 0}-${item.createTime || `${Date.now()}_${(noteIdFallbackSeq += 1)}`}`,
      bookId: item.bookId || bookId,
      chapterUid: item.chapterUid || 0,
      chapterTitle: item.chapterTitle,
      type: item.type || NoteType.Highlight,
      highlightText: item.markText || item.text || item.abstract,
      thoughtText: item.content,
      // v1.8.15：web 端点新管线划线（type:0）回包无 createTime——绝不落 Date.now() 兜底，
      // 否则同步时刻被永久写成「记录时间」（时间线显示同步时间的根因）。未知即 0，
      // 由 mergeWithLocalNotes 在远端后续带回真实时间时修复。
      createTime: item.createTime || item.updateTime || 0,
      modifyTime: item.modifyTime || item.updateTime,
      range: item.range,
      style: item.style ? parseStyle(item.style) : undefined,
      author: noteAuthor || undefined,
    };
  });
}



export async function getBookNotes(bookId) {
  try {
    return await apiClient.get('https://weread.qq.com/web/book/bookmarklist', { params: { bookId } });
  } catch {
    return await apiClient.get('/book/bookmarklist', { params: { bookId } });
  }
}

/** 单本书「我的想法/点评」（cookie 通道兜底；官方网关在 lib/gateway.js myReviewsAll）。
 *  web 端社区口径：/web/review/list?listType=11&synckey=…；回包 reviews[].review.*，
 *  与官方 /review/list/mine 同构（含划线想法/章节点评/整本书评）。软失败由调用方处理。 */
export async function getWebReviewListMine(bookId, synckey = 0, count = 50) {
  return apiClient.get('https://weread.qq.com/web/review/list', {
    params: { bookId, listType: 11, synckey, count, maxIdx: 0 },
  });
}



// ---------------------------------------------------------------------------
// user（用户）
// ---------------------------------------------------------------------------

export async function getUserProfile() {
  const response = await apiClient.get('/user/profile');
  return {
    userId: response.user.userId,
    name: response.user.name,
    avatar: response.user.avatar,
    isLogin: true,
  };
}

export async function checkLoginStatus() {
  try {
    const notebook = await apiClient.get('https://weread.qq.com/api/user/notebook');
    if (Array.isArray(notebook?.books)) return true;
  } catch { /* fallthrough */ }
  try {
    const cookies = apiClient.getCookies();
    const session = extractSessionFromCookies(cookies);
    if (session) {
      const userInfo = await fetchUserInfo(session.vid, session.skey);
      const user = userInfo?.user || userInfo?.data || userInfo;
      return !!(user?.userId || user?.userVid);
    }
  } catch { /* fallthrough */ }
  return false;
}


// ---------------------------------------------------------------------------
// articles（公众号）
// ---------------------------------------------------------------------------

export async function getArticleBooks() {
  const response = await apiClient.get('/article/list', { params: { synckey: 0 } });
  const items = response.articles || response.list || [];
  return items
    .filter((item) => item.articleId || item.docId)
    .map((item) => ({
      bookId: `article:${item.articleId || item.docId}`,
      rawBookId: String(item.articleId || item.docId || ''),
      docType: 'article',
      title: item.title || '未命名文章',
      author: item.author || '公众号',
      cover: item.cover || '',
      category: '公众号',
      progress: 100,
      readingStatus: 2,
      lastReadTime: item.updateTime || Math.floor(Date.now() / 1000),
      highlightCount: 0,
      noteCount: 0,
      reviewCount: 0,
      intro: '微信公众号文章（来自微信读书）',
      pcUrl: buildPcUrl(`article:${item.articleId || item.docId}`),
    }));
}

export { normalizePcUrl };
