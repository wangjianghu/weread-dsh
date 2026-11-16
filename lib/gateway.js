/**
 * lib/gateway.js —— 微信读书官方 Agent 网关客户端（v1.1，analysis-04 / roadmap §8A）
 *
 * 官方协议（github.com/Tencent/WeChatReading skills/SKILL.md v1.0.5）：
 *   POST https://i.weread.qq.com/api/agent/gateway
 *   Authorization: Bearer $WEREAD_API_KEY   （wrk-xxx，官网 weread.qq.com/r/weread-skills 登录后获取）
 *   Body: {"api_name": "/xxx", ...业务参数平铺, "skill_version": "1.0.5"}
 *
 * 关键约束（官方 few-shot 反复强调的高频错误，全部固化在此）：
 *   1. 业务参数必须平铺在 body 顶层，禁止包 params 嵌套；
 *   2. 每次请求必须带 skill_version；回包 upgrade_info 出现即提示升级（不静默）；
 *   3. /user/notebooks 分页 = count + lastSort 游标（禁止 offset/limit）；
 *   4. /review/list/mine 分页 = synckey 游标。
 *
 * fetch 可注入（smoke 假 fetch 不触网）。零依赖。
 */

import { createHash } from 'node:crypto';

export const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
export const SKILL_VERSION = '1.0.5';
const DEFAULT_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;
const MAX_PAGES = 100; // 翻页保险丝：5000+ 条按 50/页也够；防接口异常死循环

export class GatewayError extends Error {
  /**
   * @param {string} message 中文错误信息
   * @param {{errcode?:number, status?:number, upgradeInfo?:object}} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = 'GatewayError';
    this.errcode = meta.errcode;
    this.status = meta.status;
    this.upgradeInfo = meta.upgradeInfo;
  }
}

/** 规范化用户粘贴的 API Key（容忍引号/空白/大小写前缀） */
export function normalizeApiKey(input) {
  let value = String(input ?? '').trim();
  value = value.replace(/^WEREAD_API_KEY\s*=\s*/i, '');
  value = value.replace(/^[\"']|[\"']$/g, '');
  return value.trim();
}

export function apiKeyTail(key) {
  const value = String(key ?? '');
  return value ? value.slice(-4) : '';
}

/**
 * @param {{fetchImpl?:Function, timeoutMs?:number, log?:Function,
 *          onUpgradeInfo?:Function, getState?:Function, setState?:Function}} [options]
 *   onUpgradeInfo —— 官方 upgrade_info 出现时回调（UI/日志提示升级，不静默）
 */
export function createGatewayClient(options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : undefined);
  const log = typeof options.log === 'function' ? options.log : () => {};
  const onUpgradeInfo = typeof options.onUpgradeInfo === 'function' ? options.onUpgradeInfo : null;
  const getState = typeof options.getState === 'function' ? options.getState : null;
  const setState = typeof options.setState === 'function' ? options.setState : null;

  let currentKey = '';

  function setApiKey(key) {
    currentKey = normalizeApiKey(key);
  }
  function getApiKey() { return currentKey; }
  function clearApiKey() { currentKey = ''; }
  function hasApiKey() { return !!currentKey; }

  function recordUpgradeInfo(info) {
    try {
      setState?.('gatewayUpgrade', { info, at: Date.now() });
    } catch { /* ignore */ }
    try { onUpgradeInfo?.(info); } catch { /* ignore */ }
    log('WARN', `gateway: 官方 Skill 有版本更新提示（skill_version=${SKILL_VERSION}）：${JSON.stringify(info).slice(0, 200)}`);
  }

  /**
   * 底层调用。返回回包 JSON（errcode===0 或无 errcode）。
   * @param {string} apiName 形如 "/user/notebooks"
   * @param {object} params 业务参数（平铺）
   * @param {{timeoutMs?:number}} [callOpts]
   */
  async function call(apiName, params = {}, callOpts = {}) {
    if (!fetchImpl) throw new GatewayError('网关客户端不可用（无 fetch 实现）');
    if (!hasApiKey()) throw new GatewayError('未配置微信读书 API Key');
    const timeout = callOpts.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const body = { api_name: apiName, ...params, skill_version: SKILL_VERSION };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetchImpl(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw new GatewayError('官方网关请求超时', { status: 0 });
      throw new GatewayError(`官方网关网络异常：${err?.message || err}`, { status: 0 });
    }
    // P2-7（对抗审查 v2）：body 读取纳入同一超时保护——原版 headers 到达即 clearTimeout，
    // 之后 body 挂起可占住同步互斥 ~300s（undici 默认 bodyTimeout）。
    // timer 保留到 body 读完再清；body 读取失败（含 abort）按空文本走既有非 JSON/超时路径。
    const rawText = await response.text().catch((err) => {
      clearTimeout(timer);
      if (err?.name === 'AbortError') throw new GatewayError('官方网关回包超时', { status: response.status ?? 0 });
      return '';
    });
    clearTimeout(timer);
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new GatewayError(`官方网关回包非 JSON（HTTP ${response.status}）`, { status: response.status });
    }
    if (data && typeof data === 'object' && data.upgrade_info) {
      recordUpgradeInfo(data.upgrade_info);
    }
    const errcode = Number(data?.errcode ?? 0);
    if (!response.ok || errcode !== 0) {
      const message = data?.errMsg || data?.errmsg || data?.message
        || (response.status === 401 ? 'API Key 无效或已过期' : `官方网关请求失败（HTTP ${response.status}）`);
      throw new GatewayError(message, { errcode: errcode || response.status, status: response.status });
    }
    return data;
  }

  /** Key 有效性探测：/user/notebooks 最小请求。有效返回 true，无效/网络异常抛 GatewayError */
  async function ping() {
    await call('/user/notebooks', { count: 1 }, { timeoutMs: PING_TIMEOUT_MS });
    return true;
  }

  /** /_list 自发现：列出网关全部可用接口（真机验证闸门用） */
  async function listApis() {
    const data = await call('/_list', {});
    return data?.data ?? data?.apis ?? data ?? undefined;
  }

  /**
   * /user/notebooks 全量翻页（官方口径：count+lastSort 游标）。
   * @returns {{books:Array, totalBookCount:number, totalNoteCount:number}}
   */
  async function notebooksAll({ pageSize = 50 } = {}) {
    const books = [];
    let lastSort;
    let totalBookCount = 0;
    let totalNoteCount = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = { count: pageSize };
      if (lastSort !== undefined) params.lastSort = lastSort;
      const data = await call('/user/notebooks', params);
      const pageBooks = Array.isArray(data?.books) ? data.books : [];
      // 游标停检先于追加（单测审查发现）：停滞时本页是上一页的重复，不能push进结果
      const last = pageBooks[pageBooks.length - 1];
      const nextSort = Number(last?.sort);
      const stalled = lastSort !== undefined && Number.isFinite(nextSort) && nextSort === lastSort;
      if (!stalled) books.push(...pageBooks);
      totalBookCount = Number(data?.totalBookCount ?? totalBookCount);
      totalNoteCount = Number(data?.totalNoteCount ?? totalNoteCount);
      if (Number(data?.hasMore ?? 0) !== 1 || !pageBooks.length) break;
      if (!Number.isFinite(nextSort) || stalled) break; // 游标不动即停
      lastSort = nextSort;
    }
    return { books, totalBookCount, totalNoteCount };
  }

  /**
   * /review/list/mine 全量翻页（synckey 游标）：当前用户在某书上的全部个人内容
   * （划线想法 + 章节点评 + 整本书评）。回包结构 reviews[].review.*（官方 notes.md）。
   * @returns {Array} reviews 原始数组
   */
  async function myReviewsAll(bookId, { pageSize = 50 } = {}) {
    const all = [];
    let synckey = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await call('/review/list/mine', { bookid: String(bookId), synckey, count: pageSize });
      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      all.push(...reviews);
      const next = Number(data?.synckey ?? synckey);
      if (Number(data?.hasMore ?? 0) !== 1 || !reviews.length || next === synckey) break;
      synckey = next;
    }
    return all;
  }

  // ------------------------------------------------------------ v1.3 发现 / v1.2 统计

  /** /readdata/detail 官方阅读统计。mode=weekly|monthly|annually|overall；时长字段单位秒 */
  async function readdata(mode = 'monthly', baseTime) {
    const params = { mode };
    if (baseTime) params.baseTime = Number(baseTime) || 0;
    return call('/readdata/detail', params);
  }

  /** /book/getprogress 精确阅读进度（拍平 book.*：progress 0-100 整数、recordReadingTime 秒） */
  async function bookProgress(bookId) {
    const data = await call('/book/getprogress', { bookId: String(bookId) });
    const b = data?.book ?? {};
    return {
      chapterUid: b.chapterUid,
      chapterOffset: b.chapterOffset,
      progress: Number(b.progress ?? 0),
      updateTime: b.updateTime,
      recordReadingTime: Number(b.recordReadingTime ?? 0),
      finishTime: b.finishTime,
      isStartReading: b.isStartReading,
    };
  }

  /** /store/search 书城搜索。scope 见官方 search.md（0 全部/10 电子书/14 听书/6 作者/12 全文/2 公众号） */
  async function storeSearch({ keyword, scope = 10, maxIdx, count } = {}) {
    const params = { keyword: String(keyword ?? ''), scope: Number(scope) || 0 };
    if (maxIdx !== undefined) params.maxIdx = Number(maxIdx);
    if (count !== undefined) params.count = Number(count);
    return call('/store/search', params);
  }

  /** /book/recommend 个性化推荐（App「为你推荐」） */
  async function recommend({ count = 12, maxIdx } = {}) {
    const params = { count: Number(count) || 12 };
    if (maxIdx !== undefined) params.maxIdx = Number(maxIdx);
    return call('/book/recommend', params);
  }

  /** /book/similar 相似书推荐——官方要求 count/maxIdx 必须显式传（底层 listTypes 对齐校验） */
  async function similarBooks(bookId, { count = 12, maxIdx = 0 } = {}) {
    const data = await call('/book/similar', { bookId: String(bookId), count: Number(count), maxIdx: Number(maxIdx) });
    const inner = data?.booksimilar ?? data;
    return { sessionId: inner?.sessionId, books: Array.isArray(inner?.books) ? inner.books : [] };
  }

  /** /review/list 公开书评（reviewListType 0 全部/1 推荐/2 不行/3 最新/4 一般；双层 review 拍平） */
  async function publicReviews(bookId, { reviewListType = 0, count = 20, maxIdx, synckey } = {}) {
    const params = { bookId: String(bookId), reviewListType: Number(reviewListType) || 0, count: Number(count) || 20 };
    if (maxIdx !== undefined) params.maxIdx = Number(maxIdx);
    if (synckey !== undefined) params.synckey = Number(synckey);
    const data = await call('/review/list', params);
    return {
      reviewsCnt: data?.reviewsCnt,
      friendCommentCount: data?.friendCommentCount,
      deepVRecommendInfo: data?.deepVRecommendInfo,
      reviews: (Array.isArray(data?.reviews) ? data.reviews : []).map((w) => {
        const r = w?.review?.review ?? w?.review ?? w;
        return { idx: w?.idx, reviewId: r?.reviewId, content: r?.content, star: r?.star, isFinish: r?.isFinish, createTime: r?.createTime, author: r?.author };
      }),
    };
  }

  /** /book/bestbookmarks 全书热门划线 Top20（含原文与划线人数） */
  async function bestBookmarks(bookId) {
    return call('/book/bestbookmarks', { bookId: String(bookId) });
  }

  /** 上次 upgrade_info 记录（供 UI 展示） */
  function lastUpgradeInfo() {
    try { return getState?.('gatewayUpgrade') ?? null; } catch { return null; }
  }

  return {
    setApiKey,
    getApiKey,
    clearApiKey,
    hasApiKey,
    call,
    ping,
    listApis,
    notebooksAll,
    myReviewsAll,
    readdata,
    bookProgress,
    storeSearch,
    recommend,
    similarBooks,
    publicReviews,
    bestBookmarks,
    lastUpgradeInfo,
  };
}

/** API-Key-only 账号的确定性身份签名：notebooks 稳定特征 → 8 位哈希（官方网关无身份回显接口） */
export function gatewayAccountSignature({ totalBookCount = 0, totalNoteCount = 0, bookIds = [] } = {}) {
  const material = `${Number(totalBookCount) || 0}|${Number(totalNoteCount) || 0}|${bookIds.slice(0, 8).join(',')}`;
  return `wrk-${createHash('sha256').update(material).digest('hex').slice(0, 8)}`;
}
