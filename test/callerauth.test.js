// test/callerauth.test.js —— v1.9.12 回归：宿主调用方认证（admit 动态注入修复）
// 背景：v1.9.11 在路由里直接读 ctx.connection?.admit，触发 Cordis 代理守卫
// `cannot get property "connection" without inject`（?. 无法绕过 get 拦截），
// 导致 /weread/api/* 全量 500、面板「加载失败」。v1.9.12 改为 ctx.inject 捕获 admitFn。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCallerAuthenticated } from '../index.js';

const TOKEN = 'a'.repeat(64);
const bearerOk = (t) => t === TOKEN;
const req = (headers = {}) => ({ headers });

describe('createCallerAuthenticated（v1.9.12）', () => {
  test('Bearer 正确 → 通过（MCP/本地工具通道）', async () => {
    const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => null });
    assert.equal(await auth(req({ authorization: `Bearer ${TOKEN}` })), true);
  });

  test('Bearer 错误且无 admit（headless 组合）→ false（fail-closed）', async () => {
    const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => null });
    assert.equal(await auth(req({ authorization: 'Bearer ' + 'b'.repeat(64) })), false);
    assert.equal(await auth(req({})), false);
  });

  test('Bearer 缺失 + admit 明确准入（宿主浏览器 cookie 通道）→ true', async () => {
    let seen = null;
    const admit = async (r) => { seen = r; return { peer: { id: 'browser' } }; };
    const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => admit });
    assert.equal(await auth(req({ host: '127.0.0.1:1' })), true);
    assert.equal(seen?.headers?.host, '127.0.0.1:1', 'admit 收到原请求');
  });

  test('admit 抛错（cookie 无效/过期）→ false，不冒泡', async () => {
    const admit = async () => { throw new Error('unauthenticated'); };
    const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => admit });
    assert.equal(await auth(req({})), false);
  });

  test('admit 在请求中途被撤除（服务掉线）→ 按不可用处理', async () => {
    let admit = async () => {};
    const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => admit });
    admit = null;
    assert.equal(await auth(req({})), false);
  });

  test('getAdmit 每次请求重新求值（注入/卸载即时生效）', async () => {
    const admits = [null, async () => ({ peer: {} }), null];
    let i = 0;
    const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => admits[Math.min(i++, admits.length - 1)] });
    assert.equal(await auth(req({})), false);
    assert.equal(await auth(req({})), true);
    assert.equal(await auth(req({})), false);
  });

  // v1.9.13：dshopen #522 复审——DSH connection.admit 的真实语义是
  // 拒绝返回 { rejection: 401|403 }（不抛异常）、准入返回 { peer }。
  describe('admit 真实返回值语义（v1.9.13）', () => {
    test('admit 返回 {rejection:401} → 拒绝（核心回归：不得当成功放行）', async () => {
      const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => async () => ({ rejection: 401 }) });
      assert.equal(await auth(req({})), false);
    });

    test('admit 返回 {rejection:403} → 拒绝', async () => {
      const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => async () => ({ rejection: 403 }) });
      assert.equal(await auth(req({})), false);
    });

    test('admit 返回 {peer}（明确准入）→ 通过', async () => {
      const peer = { id: 'p1' };
      const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => async () => ({ peer }) });
      assert.equal(await auth(req({})), true);
    });

    test('admit 返回无 peer 的空对象/undefined/假值 → 拒绝（fail-closed）', async () => {
      for (const ret of [{}, undefined, null, 'ok', 0]) {
        const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => async () => ret });
        assert.equal(await auth(req({})), false, `admit 返回 ${JSON.stringify(ret)} 应拒绝`);
      }
    });

    test('admit 仍以异常表达失败 → 拒绝（兜底保留）', async () => {
      const auth = createCallerAuthenticated({ bearerOk, getAdmit: () => async () => { throw new Error('x'); } });
      assert.equal(await auth(req({})), false);
    });
  });
});

describe('Cordis 代理守卫语义（回归锚点）', () => {
  // 复刻 cordis ReflectService.handler.get 的守卫行为：未注入属性访问即抛错
  function makeGuardedCtx(own = {}) {
    return new Proxy(own, {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      },
    });
  }

  test('直接 ctx.connection（v1.9.11 写法）确实抛错——?. 不救', () => {
    const ctx = makeGuardedCtx({ webServer: {} });
    assert.throws(() => ctx.connection, /cannot get property "connection" without inject/);
    assert.throws(() => ctx.connection?.admit, /cannot get property "connection" without inject/);
  });

  test('ctx.inject 回调内的 ctx2.connection 可正常访问（v1.9.12 写法）', () => {
    const ctx = makeGuardedCtx({
      inject(deps, cb) {
        const ctx2 = makeGuardedCtx({ connection: { admit: async () => {} } });
        return cb(ctx2);
      },
    });
    let admitFn = null;
    ctx.inject(['connection'], (ctx2) => {
      admitFn = typeof ctx2.connection?.admit === 'function' ? ctx2.connection.admit.bind(ctx2.connection) : null;
      return () => { admitFn = null; };
    });
    assert.equal(typeof admitFn, 'function');
  });
});

describe('源码防回归扫描（v1.9.12）', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const lines = fs.readFileSync(path.join(root, 'index.js'), 'utf8').split('\n');

  test('路由代码不得直接访问 ctx.connection（仅允许 inject 回调内与注释）', () => {
    const offenders = [];
    lines.forEach((l, i) => {
      if (!/ctx2?\.connection/.test(l)) return;
      const trimmed = l.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return; // 注释
      if (/ctx2\.connection/.test(l)) return; // 动态注入回调内的合法访问
      offenders.push(`${i + 1}: ${trimmed}`);
    });
    assert.deepEqual(offenders, [], `发现绕过动态注入的 ctx.connection 直访：\n${offenders.join('\n')}`);
  });
});
