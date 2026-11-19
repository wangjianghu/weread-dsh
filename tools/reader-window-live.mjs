#!/usr/bin/env node
/* 单例阅读窗口真机自检（v1.5）
 *
 * 背景：DSH 工具沙箱内 spawn 的有头 Chrome 会因沙箱嵌套 SIGTRAP 崩溃（实测），
 * 因此 lib/readerWindow.js 的真机行为只能在「非沙箱」环境验证：
 *   1. 用户终端直接跑本脚本（推荐）：node tools/reader-window-live.mjs
 *   2. 或 ⌘Q 完全重启 DSH 后，从微信读书面板点任意书的「阅读窗口」，
 *      再看设置页「单例阅读窗口」卡的「检测阅读窗口」。
 *
 * 本脚本用独立临时 state/profile，不碰 ~/.dsh/weread 真实状态；跑完自动关窗清理。
 * 退出码 0=全部通过；非 0=第一步失败原因。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createReaderWindow } from '../lib/readerWindow.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-live-'));
const logs = [];
const rw = createReaderWindow({
  stateDir,
  log: (level, msg) => { logs.push(`[${level}] ${msg}`); console.log(' ', level, msg); },
  getCookies: () => undefined, // 自检不注入真实凭据；登录态验证请在真实链路做
});

let failed = 0;
const ok = (cond, msg) => { console.log(cond ? '  ✓' : '  ✗', msg); if (!cond) failed++; };

console.log('1) 首次打开（应拉起专用 Chrome 窗口）…');
let r = await rw.open('https://weread.qq.com/#home');
ok(r.ok && r.mode === 'reader-window', `open #1 → ${JSON.stringify(r)}`);

console.log('2) 换目标（应在同一窗口内导航，不新开窗口）…');
r = await rw.open('https://weread.qq.com/#ranking');
ok(r.ok && r.mode === 'reader-window', `open #2 → ${JSON.stringify(r)}`);

console.log('3) 自检状态…');
const d = await rw.diagnose();
ok(d.chromeFound && d.windowAlive, `diagnose → chrome=${d.chromePath} port=${d.port} url=${d.windowUrl}`);

console.log('4) 关闭阅读窗口…');
r = await rw.closeWindow();
ok(r.ok, `close → ${JSON.stringify(r)}`);

console.log('5) 关后再开（应自动重开单例窗口）…');
r = await rw.open('https://weread.qq.com/#home');
ok(r.ok && r.mode === 'reader-window', `open #3 → ${JSON.stringify(r)}`);
await rw.closeWindow();

fs.rmSync(stateDir, { recursive: true, force: true });
console.log(failed === 0 ? '\nLIVE PASS（日志已含每步详情）' : `\nLIVE FAIL（${failed} 项未过；完整日志：\n${logs.join('\n')}）`);
process.exit(failed === 0 ? 0 : 1);
