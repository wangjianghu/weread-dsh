// test/wsbus.test.js —— WS 广播总线：握手、Origin 校验、帧编解码、广播与生命周期
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWsBus } from '../lib/wsbus.mjs';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class FakeSocket {
  constructor() {
    this.writes = [];
    this.destroyed = false;
    this.handlers = new Map();
    this.writableLength = 0;
  }
  write(buf) { this.writes.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)); return true; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('close'); }
  on(event, cb) { (this.handlers.get(event) || this.handlers.set(event, []).get(event)).push(cb); }
  emit(event, arg) { for (const cb of this.handlers.get(event) || []) cb(arg); }
  setNoDelay() {}
}

function handshakeHeaders(extra = {}) {
  return {
    host: '127.0.0.1:65414',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    ...extra,
  };
}

/** 解析服务端文本帧序列 → 字符串数组 */
function decodeServerTextFrames(buf) {
  const out = [];
  let off = 0;
  while (off < buf.length) {
    const opcode = buf[off] & 0x0f;
    const len = buf[off + 1] & 0x7f;
    let headerLen = 2;
    let payloadLen = len;
    if (len === 126) { payloadLen = buf.readUInt16BE(off + 2); headerLen = 4; }
    else if (len === 127) { payloadLen = Number(buf.readBigUInt64BE(off + 2)); headerLen = 10; }
    const payload = buf.subarray(off + headerLen, off + headerLen + payloadLen);
    out.push({ opcode, text: payload.toString('utf8') });
    off += headerLen + payloadLen;
  }
  return out;
}

/** 构造客户端掩码帧 */
function maskedFrame(opcode, payload = '', fin = true) {
  const data = Buffer.from(payload, 'utf8');
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const first = (fin ? 0x80 : 0) | opcode;
  let head;
  if (data.length < 126) { head = Buffer.alloc(2); head[1] = 0x80 | data.length; }
  else { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
  head[0] = first;
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}

function connect(bus, headers = handshakeHeaders(), head) {
  const socket = new FakeSocket();
  bus.handler({ headers }, socket, head);
  return socket;
}

describe('握手', () => {
  test('合法握手：101 + 正确 Sec-WebSocket-Accept + hello 帧', () => {
    const bus = createWsBus();
    const socket = connect(bus);
    assert.equal(socket.destroyed, false);
    const handshake = socket.writes[0].toString('utf8');
    assert.match(handshake, /^HTTP\/1\.1 101 Switching Protocols/);
    const expected = createHash('sha1').update('dGhlIHNhbXBsZSBub25jZQ==' + WS_GUID).digest('base64');
    const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // base64 含正则元字符
    assert.match(handshake, new RegExp(`Sec-WebSocket-Accept: ${escaped}`));
    const frames = decodeServerTextFrames(Buffer.concat(socket.writes.slice(1)));
    assert.equal(frames.length, 1);
    const hello = JSON.parse(frames[0].text);
    assert.equal(hello.type, 'hello');
    assert.ok(hello.at > 0);
    assert.equal(bus.clientCount(), 1);
    bus.dispose();
  });

  test('缺失 sec-websocket-key → 拒绝', () => {
    const bus = createWsBus();
    const headers = handshakeHeaders();
    delete headers['sec-websocket-key'];
    const socket = connect(bus, headers);
    assert.equal(socket.destroyed, true);
    assert.equal(bus.clientCount(), 0);
  });

  test('Origin 校验：host 不一致 → 拒绝（浏览器跨源 WS 无 CORS）', () => {
    const bus = createWsBus();
    const bad = connect(bus, handshakeHeaders({ origin: 'https://evil.example' }));
    assert.equal(bad.destroyed, true);
    assert.equal(bus.clientCount(), 0);
  });

  test('Origin 与 host 一致 → 放行；无 Origin（非浏览器）→ 放行', () => {
    const bus = createWsBus();
    connect(bus, handshakeHeaders({ origin: 'http://127.0.0.1:65414' }));
    connect(bus, handshakeHeaders({ origin: undefined }));
    assert.equal(bus.clientCount(), 2);
    bus.dispose();
  });

  test('非法 Origin URL → 拒绝', () => {
    const bus = createWsBus();
    const socket = connect(bus, handshakeHeaders({ origin: '::not-a-url::' }));
    assert.equal(socket.destroyed, true);
  });
});

describe('客户端帧处理', () => {
  test('ping → 自动回 pong', () => {
    const bus = createWsBus();
    const socket = connect(bus, handshakeHeaders(), maskedFrame(0x9));
    const pong = socket.writes.find((w) => w.length === 2 && w[0] === 0x8a && w[1] === 0);
    assert.ok(pong, '收到 0x8a 0x00 pong');
    bus.dispose();
  });

  test('close 帧 → 连接剔除并销毁', () => {
    const bus = createWsBus();
    const socket = connect(bus, handshakeHeaders(), maskedFrame(0x8));
    assert.equal(socket.destroyed, true);
    assert.equal(bus.clientCount(), 0);
  });

  test('超长帧（>1MB）→ 拆线', () => {
    const bus = createWsBus();
    // 伪造声明 2MB 载荷的帧头（无需真实载荷）
    const head = Buffer.alloc(14);
    head[0] = 0x81;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(2 * 1024 * 1024), 2);
    const socket = connect(bus, handshakeHeaders(), head);
    assert.equal(socket.destroyed, true);
  });

  test('分片到达：半帧缓存后补齐才处理', () => {
    const bus = createWsBus();
    const ping = maskedFrame(0x9);
    const socket = connect(bus, handshakeHeaders(), ping.subarray(0, 4)); // 半帧
    assert.equal(socket.writes.filter((w) => w.length === 2 && w[0] === 0x8a).length, 0);
    socket.emit('data', ping.subarray(4)); // 补齐
    assert.equal(socket.writes.filter((w) => w.length === 2 && w[0] === 0x8a).length, 1);
    bus.dispose();
  });
});

describe('broadcast', () => {
  test('向全部客户端广播 JSON 消息（含 at），返回触达数', () => {
    const bus = createWsBus();
    const s1 = connect(bus);
    const s2 = connect(bus);
    const n = bus.broadcast('sync:done', { books: 3 });
    assert.equal(n, 2);
    for (const s of [s1, s2]) {
      const frames = decodeServerTextFrames(Buffer.concat(s.writes.slice(1)));
      const msg = JSON.parse(frames.at(-1).text);
      assert.equal(msg.type, 'sync:done');
      assert.deepEqual(msg.payload, { books: 3 });
      assert.ok(msg.at > 0);
    }
    bus.dispose();
  });

  test('无客户端返回 0；大帧长度用 16 位扩展头', () => {
    const bus = createWsBus();
    assert.equal(bus.broadcast('x'), 0);
    const s = connect(bus);
    bus.broadcast('big', { data: 'y'.repeat(300) });
    const frames = decodeServerTextFrames(Buffer.concat(s.writes.slice(1)));
    assert.equal(frames.at(-1).text.length > 126, true);
    bus.dispose();
  });

  test('写背压 >1MB 的慢客户端被剔除', () => {
    const bus = createWsBus();
    const slow = connect(bus);
    slow.writableLength = 2 * 1024 * 1024;
    const normal = connect(bus);
    const n = bus.broadcast('t');
    assert.equal(n, 1);
    assert.equal(slow.destroyed, true);
    assert.equal(normal.destroyed, false);
    bus.dispose();
  });
});

describe('生命周期', () => {
  test('socket close/error 事件 → 剔除；dispose 清空全部', () => {
    const bus = createWsBus();
    const s1 = connect(bus);
    const s2 = connect(bus);
    s1.emit('close');
    assert.equal(bus.clientCount(), 1);
    s2.emit('error', new Error('x'));
    assert.equal(bus.clientCount(), 0);
    const s3 = connect(bus);
    bus.dispose();
    assert.equal(s3.destroyed, true);
    assert.equal(bus.clientCount(), 0);
  });
});
