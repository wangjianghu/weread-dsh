#!/usr/bin/env node
/* 恢复被旧版 syncBook 清空的笔记（v1.0.5 前的数据丢失事故善后）
 *
 * 背景：旧版详情页「刷新」把远端笔记直接覆盖写盘；公众号书远端常返回空 → 本地被清空。
 * 用法：先在 DSH 微信读书面板重新扫码登录，然后运行：
 *   node tools/restore-wiped.mjs          # 扫描并恢复全部"0 笔记"文件
 *   node tools/restore-wiped.mjs --list   # 只列出候选，不写盘
 * 原理：对每本候选书调用修复后的 syncBook（本地合并保护）——云端有则写回，云端无则保持现状。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../lib/api.js';
import { createStore } from '../lib/store.js';
import { createIndexService } from '../lib/indexsvc.js';
import { createSyncService } from '../lib/sync.js';
import * as markdown from '../lib/markdown.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = path.join(os.homedir(), '.dsh/weread');
const store = createStore(stateDir);

const prefs = JSON.parse(fs.readFileSync(path.join(stateDir, 'prefs.json'), 'utf8'));
const outputPath = prefs.outputPath;
if (!outputPath) { console.error('未配置输出目录'); process.exit(1); }
const accountId = store.getActiveAccountId();
console.log(`输出目录: ${outputPath}（账号 ${accountId}）`);

// 登录态检查（不打印任何凭据）
const cookies = store.getCookies(accountId);
api.apiClient.setCookies(cookies);
if (!(await api.checkLoginStatus())) {
  console.error('登录已失效：请先在 DSH 微信读书面板重新扫码登录，再运行本脚本。');
  process.exit(1);
}
console.log('登录态: 有效');

const configGetter = () => ({ outputPath });
const index = createIndexService({ store, markdown, configGetter, log: () => {} });
const sync = createSyncService({ api, store, index, markdown, cleanup: { cleanupDuplicateBookFilesForAccount: async () => ({}) }, configGetter, log: () => {}, onProgress: () => {} });
await index.rebuildFromConfiguredPath(accountId);

const books = await index.queryBooks(accountId);
const wiped = [];
for (const b of books) {
  const notes = (await index.getNotesByBookId(b.bookId, accountId).catch(() => [])) ?? [];
  if (notes.length === 0) wiped.push(b);
}
console.log(`\n候选（本地 0 笔记）：${wiped.length} 本`);
if (!wiped.length) { console.log('没有需要恢复的书。'); process.exit(0); }
wiped.forEach((b) => console.log(`  - ${b.title} (${b.bookId})`));

if (process.argv.includes('--list')) { console.log('\n(--list 只列出，未写盘)'); process.exit(0); }

console.log('\n开始逐本恢复…');
let recovered = 0; let stillEmpty = 0;
for (const b of wiped) {
  try {
    const notes = await sync.syncBook(b.bookId, accountId);
    if (notes.length > 0) { recovered += 1; console.log(`  ✓ 《${b.title}》恢复 ${notes.length} 条`); }
    else { stillEmpty += 1; console.log(`  ✗ 《${b.title}》云端也无笔记（无法恢复）`); }
  } catch (e) {
    stillEmpty += 1;
    console.log(`  ✗ 《${b.title}》失败: ${String(e.message).slice(0, 60)}`);
  }
}
console.log(`\n完成：恢复 ${recovered} 本，云端也无数据 ${stillEmpty} 本。`);
console.log('说明：云端也无数据的书，请到微信读书 App 确认划线是否还在；若 App 里已无，则该笔记已不可恢复。');
process.exit(0);
