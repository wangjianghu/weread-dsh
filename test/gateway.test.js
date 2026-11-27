// test/gateway.test.js —— 官方网关客户端（mock fetchImpl，不触网）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY_URL,
  SKILL_VERSION,
  GatewayError,
  normalizeApiKey,
  apiKeyTail,
  createGatewayClient,
  gatewayAccountSignature,
} from '../lib/gateway.js';

function jsonResponse(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(obj) };
}

function makeClient(handler, options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(calls.length, calls[calls.length - 1]);
  };
  const client = createGatewayClient({ fetchImpl, ...options });
  client.setApiKey('wrk-test');
  return { client, calls };
}

describe('纯函数', () => {
  test('normalizeApiKey 容忍引号/前缀/空白', () => {
    assert.equal(normalizeApiKey(' wrk-abc '), 'wrk-abc');
    assert.equal(normalizeApiKey('"wrk-abc"'), 'wrk-abc');
    assert.equal(normalizeApiKey('WEREAD_API_KEY=wrk-abc'), 'wrk-abc');
    assert.equal(normalizeApiKey(undefined), '');
  });

  test('apiKeyTail', () => {
    assert.equal(apiKeyTail('wrk-abcd'), 'abcd');
    assert.equal(apiKeyTail(''), '');
  });

  test('gatewayAccountSignature 确定性且受 bookIds 影响', () => {
    const a = gatewayAccountSignature({ totalBookCount: 3, totalNoteCount: 10, bookIds: ['1', '2'] });
    assert.equal(a, gatewayAccountSignature({ totalBookCount: 3, totalNoteCount: 10, bookIds: ['1', '2'] }));
    assert.notEqual(a, gatewayAccountSignature({ totalBookCount: 3, totalNoteCount: 10, bookIds: ['1', '3'] }));
    assert.match(a, /^wrk-[0-9a-f]{8}$/);
  });
});

describe('call 协议', () => {
  test('body 平铺业务参数 + skill_version + Bearer 头', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ errcode: 0, data: 1 }));
    const r = await client.call('/user/notebooks', { count: 5 });
    assert.equal(r.errcode, 0);
    assert.equal(calls.length, 1);
    const { url, init, body } = calls[0];
    assert.equal(url, GATEWAY_URL);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer wrk-test');
    assert.equal(body.api_name, '/user/notebooks');
    assert.equal(body.count, 5);
    assert.equal(body.skill_version, SKILL_VERSION);
    assert.equal(body.params, undefined, '禁止 params 嵌套');
  });

  test('未配置 Key 抛错', async () => {
    const client = createGatewayClient({ fetchImpl: async () => jsonResponse({}) });
    await assert.rejects(() => client.call('/x', {}), /未配置/);
  });

  test('HTTP 401 → GatewayError（中文提示 + errcode）', async () => {
    const { client } = makeClient(() => jsonResponse({ errcode: -2012, errMsg: '鉴权失败' }, 401));
    await assert.rejects(
      () => client.call('/x', {}),
      (e) => e instanceof GatewayError && e.name === 'GatewayError' && e.status === 401 && e.errcode === -2012
    );
  });

  test('业务 errcode 非 0 → GatewayError', async () => {
    const { client } = makeClient(() => jsonResponse({ errcode: 5, errmsg: '参数错' }));
    await assert.rejects(() => client.call('/x', {}), (e) => e.message === '参数错' && e.errcode === 5);
  });

  test('回包非 JSON → GatewayError', async () => {
    const { client } = makeClient(() => ({ ok: true, status: 200, text: async () => '<html>' }));
    await assert.rejects(() => client.call('/x', {}), /非 JSON/);
  });

  test('upgrade_info 出现触发回调并写状态', async () => {
    const seen = [];
    const states = new Map();
    const { client } = makeClient(() => jsonResponse({ upgrade_info: { latest: '1.1.0' } }), {
      onUpgradeInfo: (info) => seen.push(info),
      getState: (k) => states.get(k),
      setState: (k, v) => states.set(k, v),
    });
    await client.call('/x', {});
    assert.equal(seen.length, 1);
    assert.equal(seen[0].latest, '1.1.0');
    assert.equal(states.get('gatewayUpgrade').info.latest, '1.1.0');
    assert.deepEqual(client.lastUpgradeInfo().info, { latest: '1.1.0' });
  });
});

describe('Key 管理', () => {
  test('set/get/clear/has', () => {
    const client = createGatewayClient({ fetchImpl: async () => jsonResponse({}) });
    assert.equal(client.hasApiKey(), false);
    client.setApiKey(' "wrk-abc" ');
    assert.equal(client.getApiKey(), 'wrk-abc');
    assert.equal(client.hasApiKey(), true);
    client.clearApiKey();
    assert.equal(client.hasApiKey(), false);
  });
});

describe('翻页', () => {
  test('notebooksAll：count+lastSort 游标翻页并聚合', async () => {
    const pages = [
      { books: [{ bookId: '1', sort: 10 }, { bookId: '2', sort: 20 }], hasMore: 1, totalBookCount: 3, totalNoteCount: 7 },
      { books: [{ bookId: '3', sort: 30 }], hasMore: 0, totalBookCount: 3, totalNoteCount: 7 },
    ];
    const { client, calls } = makeClient(() => jsonResponse(pages[calls.length - 1]));
    const r = await client.notebooksAll({ pageSize: 2 });
    assert.deepEqual(r.books.map((b) => b.bookId), ['1', '2', '3']);
    assert.equal(r.totalBookCount, 3);
    assert.equal(r.totalNoteCount, 7);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.lastSort, 20, '游标用上一页末条 sort');
    assert.equal(calls[0].body.count, 2);
    assert.equal(calls[0].body.lastSort, undefined);
  });

  test('notebooksAll：游标不动即停（防死循环）', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ books: [{ bookId: 'x', sort: 5 }], hasMore: 1 }));
    const r = await client.notebooksAll({ pageSize: 50 });
    // 第 2 页发现游标未前进即停——不会无限翻下去；停滞页是重复数据，不追加（修复后语义）
    assert.equal(r.books.length, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(r.books.map((b) => b.bookId), ['x']);
  });

  test('myReviewsAll：synckey 游标翻页', async () => {
    const pages = [
      { reviews: [{ reviewId: 'a' }], hasMore: 1, synckey: 100 },
      { reviews: [{ reviewId: 'b' }], hasMore: 0, synckey: 200 },
    ];
    const { client, calls } = makeClient(() => jsonResponse(pages[calls.length - 1]));
    const r = await client.myReviewsAll('book1');
    assert.deepEqual(r.map((x) => x.reviewId), ['a', 'b']);
    assert.equal(calls[1].body.synckey, 100);
    assert.equal(calls[1].body.bookid, 'book1');
  });
});

describe('业务方法', () => {
  test('ping 最小请求成功', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ errcode: 0 }));
    assert.equal(await client.ping(), true);
    assert.equal(calls[0].body.api_name, '/user/notebooks');
    assert.equal(calls[0].body.count, 1);
  });

  test('readdata 透传 mode/baseTime', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ errcode: 0, data: {} }));
    await client.readdata('weekly', 123);
    assert.equal(calls[0].body.mode, 'weekly');
    assert.equal(calls[0].body.baseTime, 123);
  });

  test('bookProgress 拍平 book 字段与数值默认', async () => {
    const { client } = makeClient(() => jsonResponse({ errcode: 0, book: { chapterUid: 2, progress: '66', recordReadingTime: '120' } }));
    const p = await client.bookProgress('b1');
    assert.equal(p.chapterUid, 2);
    assert.equal(p.progress, 66);
    assert.equal(p.recordReadingTime, 120);
    assert.equal(p.updateTime, undefined);
  });

  test('storeSearch / similarBooks / publicReviews 形状', async () => {
    const { client: c1, calls: s1 } = makeClient(() => jsonResponse({ errcode: 0, books: [1] }));
    await c1.storeSearch({ keyword: 'SQL', scope: 12 });
    assert.equal(s1[0].body.keyword, 'SQL');
    assert.equal(s1[0].body.scope, 12);

    const { client: c2 } = makeClient(() => jsonResponse({ errcode: 0, booksimilar: { sessionId: 's', books: [{ bookId: 1 }] } }));
    const sim = await c2.similarBooks('b', { count: 3 });
    assert.equal(sim.sessionId, 's');
    assert.equal(sim.books.length, 1);

    const { client: c3 } = makeClient(() => jsonResponse({
      errcode: 0,
      reviewsCnt: 5,
      reviews: [{ idx: 0, review: { review: { reviewId: 'r1', content: '好', star: 5 } } }],
    }));
    const pr = await c3.publicReviews('b', { reviewListType: 3 });
    assert.equal(pr.reviewsCnt, 5);
    assert.equal(pr.reviews[0].reviewId, 'r1');
    assert.equal(pr.reviews[0].star, 5);
  });
});

// v1.9.19：skill_version 可由宿主注入（设置页一键升级后即用新值，无需重启）
describe('skillVersion（v1.9.19）', () => {
  test('缺省：每个请求都带内置常量', () => {
    const { client, calls } = makeClient(() => jsonResponse({}));
    client.setApiKey('wrk-test');
    assert.equal(client.skillVersion(), SKILL_VERSION);
    return client.ping().then(() => assert.equal(calls[0].body.skill_version, SKILL_VERSION));
  });
  test('内置默认值固化为 1.0.6（v1.9.21：真机逐接口验证过的官方版本）', () => {
    assert.equal(SKILL_VERSION, '1.0.6');
  });
  test('注入合法版本：请求体即用新值（无需重建客户端）', async () => {
    let v = '1.0.6';
    const { client, calls } = makeClient(() => jsonResponse({}), { getSkillVersion: () => v });
    client.setApiKey('wrk-test');
    assert.equal(client.skillVersion(), '1.0.6');
    await client.ping();
    v = 'v1.1.0'; // 升级后再请求 → 立即生效
    await client.ping();
    assert.deepEqual(calls.map((c) => c.body.skill_version), ['1.0.6', '1.1.0']);
  });
  test('注入非法值 / 抛异常：回落到内置常量（不带脏值出门）', async () => {
    for (const bad of ['', '  ', '1.0', 'latest', '1.0.6-beta', null, undefined, 7, '1.0.6; drop']) {
      const { client, calls } = makeClient(() => jsonResponse({}), { getSkillVersion: () => bad });
      client.setApiKey('wrk-test');
      await client.ping();
      assert.equal(calls[0].body.skill_version, SKILL_VERSION, `非法值 ${JSON.stringify(bad)} 应回落`);
    }
    const { client, calls } = makeClient(() => jsonResponse({}), { getSkillVersion: () => { throw new Error('boom'); } });
    client.setApiKey('wrk-test');
    await client.ping();
    assert.equal(calls[0].body.skill_version, SKILL_VERSION);
  });
});
