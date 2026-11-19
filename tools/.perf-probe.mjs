// 性能对抗审查：fake 环境驱动 readerWindow 状态机（不拉真 Chrome）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReaderWindow, } from '../lib/readerWindow.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-probe-'));
const log = (lvl, msg) => console.log(`[${lvl}] ${msg}`);

let targetUrl = 'https://weread.qq.com/web/reader/abc';
let windowAlive = true; // 页面目标是否存在
let wsDelayMs = 0; // wsCall 人为延迟（模拟慢渲染/卡顿）
let inFlight = 0, maxInFlight = 0;
let evalBootstrapCount = 0, probeCount = 0, listCount = 0, versionCount = 0;
let stateReads = 0;

const CDP_PORT = 47833;
let instanceOn = false; // Chrome 实例（CDP 端口）是否在跑
const fetchJson = async (port, pathname) => {
  if (port !== CDP_PORT || !instanceOn) throw new Error('ECONNREFUSED');
  if (pathname === '/json/version') { versionCount++; return { Browser: 'Chrome/131.0.0', webSocketDebuggerUrl: 'ws://browser' }; }
  if (pathname === '/json/list') {
    listCount++;
    if (!windowAlive) return [];
    return [{ id: 't1', type: 'page', url: targetUrl, webSocketDebuggerUrl: 'ws://t1' }];
  }
  throw new Error('unexpected ' + pathname);
};
const wsCall = (wsUrl, commands) => new Promise((resolve, reject) => {
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  const isBootstrap = commands.some((c) => c.method === 'Runtime.evaluate' && String(c.params?.expression ?? '').includes('wr-readerbar'));
  if (isBootstrap) evalBootstrapCount++;
  setTimeout(() => { inFlight--; resolve(commands.map((_, i) => ({ id: i + 1, result: {} }))); }, wsDelayMs);
});
// 统计 readState 频率：通过 patch fs.readFileSync 计数 reader-window.json
const stateFile = path.join(stateDir, 'reader-window.json');
const origRead = fs.readFileSync.bind(fs);
fs.readFileSync = (p, ...a) => { if (String(p) === stateFile) stateReads++; return origRead(p, ...a); };

const rw = createReaderWindow({
  stateDir,
  log,
  getCookies: () => 'wr_vid=1; wr_skey=2',
  deps: {
    fetchJson,
    wsCall,
    chromeExecutable: () => '/fake/chrome',
    launchProcess: async () => { instanceOn = true; windowAlive = true; return { pid: 4242 }; },
    execOpen: async () => ({ ok: true }),
    listPids: async () => [],
    killPid: () => {},
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    timeouts: { ready: 50, tier1: 50, tier2: 50, boundsWatch: 100, injectWatch: 100, jamWatch: 200 },
  },
});

const snap = (tag) => console.log(`\n== ${tag} == probes(version+list)=${versionCount}+${listCount} bootstrapEval=${evalBootstrapCount} stateReads=${stateReads} maxConcurrentWs=${maxInFlight}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 首次 open（launch 路径）
let r = await rw.open('https://weread.qq.com/web/reader/abc');
console.log('open#1 ->', r.mode, 'ok=', r.ok);
await wait(450); snap('after open#1 (~450ms)');

// 2) SPA 路由变化 + 慢 evaluate（350ms）→ 观察 1.5s 轮询是否存在并发注入
const base = evalBootstrapCount;
wsDelayMs = 350;
targetUrl = 'https://weread.qq.com/web/reader/abc#chapter2';
await wait(1200);
wsDelayMs = 0;
snap(`SPA nav + slow ws (~1200ms): 新增 bootstrap 注入 ${evalBootstrapCount - base} 次`);

// 3) 用户关窗（closeWindow API）后，定时器是否仍在跑
const v0 = versionCount, l0 = listCount, s0 = stateReads, b0 = evalBootstrapCount;
windowAlive = false;
await rw.closeWindow();
console.log('\ncloseWindow done');
await wait(700);
console.log(`关窗后 700ms 内: version=${versionCount - v0} list=${listCount - l0} stateReads=${stateReads - s0} bootstrap=${evalBootstrapCount - b0} (期望全为 0 若定时器被停)`);

// 4) 重开（reopen 路径：instance alive, target 0 → spawn）——检查双定时器
windowAlive = true;
r = await rw.open('https://weread.qq.com/web/reader/xyz');
console.log('\nopen#2 ->', r.mode, 'ok=', r.ok);
const v1 = versionCount, l1 = listCount, s1 = stateReads;
await wait(600);
const rateV = (versionCount - v1) / 0.6, rateL = (listCount - l1) / 0.6, rateS = (stateReads - s1) / 0.6;
console.log(`重开后 600ms: version=${versionCount - v1} (=${rateV.toFixed0 ?? rateV.toFixed(1)}/s) list=${listCount - l1} (${rateL.toFixed(1)}/s) stateReads=${stateReads - s1} (${rateS.toFixed(1)}/s)`);
console.log(`若三个定时器都在跑且未双开: inject(10/s)+jam(5/s)+bounds(10/s) → version≈25/600ms, list 同; stateReads≈15`);
rw.dispose();
await wait(50);
console.log('\ndispose 后 50ms 内无新增探测:', versionCount, listCount, stateReads);
fs.rmSync(stateDir, { recursive: true, force: true });
