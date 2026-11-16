/**
 * §11-6 面板实时化：/weread/ws WebSocket 广播总线（roadmap §11-6）。
 * DSH 宿主 webServer.registerUpgrade 给的是裸 TCP socket——这里零依赖自实现
 * 101 握手（sha1(key+GUID)）+ 服务端文本帧编码 + 客户端掩码帧解析（ping→pong）。
 * 单向广播：宿主事件 → {"type":"...","payload":...}；客户端帧仅作活性证明。
 */
import { createHash } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// P0-1（开源前对抗审查 v3）：与 index.js 同款 loopback Host 白名单（允许带端口；IPv6 方括号/展开式都认）。
const isLoopbackHostHeader = (h) => {
  if (!h) return false;
  let s = String(h).trim().toLowerCase();
  if (s.startsWith('[')) { const end = s.indexOf(']'); if (end < 0) return false; s = s.slice(1, end); }
  else { const parts = s.split(':'); if (parts.length > 2) return false; s = parts[0]; }
  return s === 'localhost' || s === '127.0.0.1' || s === '::1' || s === '0:0:0:0:0:0:0:1';
};

const encodeFrame = (text) => {
  const payload = Buffer.from(String(text), 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x81; // FIN + text opcode
  return Buffer.concat([head, payload]);
};

export function createWsBus({ log = () => {} } = {}) {
  const clients = new Set();
  const buffers = new Map();
  const lastSeen = new Map(); // socket → 最近收到任意入帧时间（含 pong）——P2-12 半开检测依据
  const IDLE_DROP_MS = 90_000; // 无入帧 90s（含 3 轮 ping 未回）判死连接

  const send = (socket, text) => { try { socket.write(encodeFrame(text)); } catch { /* ignore */ } };
  const drop = (socket) => { clients.delete(socket); buffers.delete(socket); lastSeen.delete(socket); try { socket.destroy(); } catch { /* ignore */ } };

  const feed = (socket, chunk) => {
    lastSeen.set(socket, Date.now()); // 任意入帧（含浏览器自动回的 pong）即视为活连接
    let buf = Buffer.concat([buffers.get(socket) ?? Buffer.alloc(0), chunk]);
    for (;;) {
      if (buf.length < 2) break;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < off + 2) break; len = buf.readUInt16BE(off); off += 2; }
      else if (len === 127) { if (buf.length < off + 8) break; len = Number(buf.readBigUInt64BE(off)); off += 8; }
      if (len > (1 << 20)) { drop(socket); return; } // 异常大帧：拆线防滥用
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) break;
      let payload = buf.subarray(off, off + len);
      if (mask) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4]; payload = out; }
      buf = buf.subarray(off + len);
      if (!fin) continue;
      if (opcode === 0x8) { drop(socket); return; } // close
      if (opcode === 0x9) { try { socket.write(Buffer.from([0x8a, 0])); } catch { /* ignore */ } continue; } // ping → pong
      // text（0x1）：单向总线，内容忽略
    }
    buffers.set(socket, buf);
  };

  const handler = (req, socket, head) => {
    try {
      const key = req.headers?.['sec-websocket-key'];
      if (!key) { socket.destroy(); return; }
      // P2-13（对抗审查 v2）：与 HTTP 路由同源检查对齐——浏览器跨源 WS 不受 CORS 限制，
      // 任意本地网页可连 /weread/ws 收广播。带 Origin 时校验 host 一致，非浏览器（无 Origin）放行。
      // P0-1（开源前对抗审查 v3）：Host 须为 loopback（防 DNS rebinding：Origin=Host=evil.com 恒过旧校验）。
      if (!isLoopbackHostHeader(req.headers?.host)) { socket.destroy(); return; }
      const origin = req.headers?.origin;
      if (origin) {
        try {
          const oh = new URL(origin).host;
          if (oh !== String(req.headers.host) || !isLoopbackHostHeader(oh)) { socket.destroy(); return; }
        } catch { socket.destroy(); return; }
      }
      const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.setNoDelay(true);
      clients.add(socket);
      lastSeen.set(socket, Date.now()); // 握手即视为活连接（首帧 ping 前不被误判半开）
      socket.on('data', (c) => feed(socket, c));
      socket.on('error', () => drop(socket));
      socket.on('close', () => drop(socket));
      if (head?.length) feed(socket, head);
      send(socket, JSON.stringify({ type: 'hello', at: Date.now() }));
    } catch (e) { log('WARN', `ws-bus 握手失败：${e.message}`); drop(socket); }
  };

  // P2-12（对抗审查 v2）：30s 主动 ping（浏览器自动回 pong 刷新 lastSeen）——
  // 合盖/断网后半开连接（无 FIN/RST）最多存活 90s 即被剔除，广播不再向死连接堆积内核写缓冲。
  const pingTimer = setInterval(() => {
    if (!clients.size) return;
    for (const s of [...clients]) {
      if (Date.now() - (lastSeen.get(s) ?? 0) > IDLE_DROP_MS) { drop(s); continue; }
      try { s.write(Buffer.from([0x89, 0])); } catch { /* error 事件会 drop */ }
    }
  }, 30_000);
  pingTimer.unref?.();

  const broadcast = (type, payload = {}) => {
    if (!clients.size) return 0;
    const msg = JSON.stringify({ type, payload, at: Date.now() });
    let n = 0;
    for (const s of [...clients]) {
      // P2-12：写背压——慢客户端积压 >1MB 直接断（send 无 drain 判定时内存缓涨的兜底）
      if (s.writableLength > (1 << 20)) { drop(s); continue; }
      send(s, msg); n += 1;
    }
    return n;
  };
  const dispose = () => { clearInterval(pingTimer); for (const s of [...clients]) drop(s); };
  return { handler, broadcast, dispose, clientCount: () => clients.size };
}
