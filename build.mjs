/* 构建脚本：parts/*.js → client.js
 * 用法：
 *   node build.mjs          重建 client.js（写盘前先 node --check 校验拼接产物）
 *   node build.mjs --check  只校验：产物与现有 client.js 逐字节比对，不一致即失败（防手工 cat 回潮）
 * 顺序即文件名前缀序（00-head → 90-tail）；parts 之间不允许出现未登记的新前缀。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const partsDir = path.join(dir, 'parts');
const outFile = path.join(dir, 'client.js');

const EXPECTED = ['00-head.js', '10-bookshelf.js', '20-detail.js', '30-insights.js', '40-roaming.js', '50-settings.js', '55-discover.js', '60-interop.js', '90-tail.js'];
const actual = fs.readdirSync(partsDir).filter((f) => f.endsWith('.js')).sort();
const unknown = actual.filter((f) => !EXPECTED.includes(f));
if (unknown.length) {
  console.error(`✗ parts/ 出现未登记文件（请先在 build.mjs EXPECTED 登记）：${unknown.join(', ')}`);
  process.exit(1);
}
const missing = EXPECTED.filter((f) => !actual.includes(f));
if (missing.length) {
  console.error(`✗ parts/ 缺少文件：${missing.join(', ')}`);
  process.exit(1);
}

const partCodes = EXPECTED.map((f) => {
  const code = fs.readFileSync(path.join(partsDir, f), 'utf8');
  if (!/\n$/.test(code)) {
    console.error(`✗ ${f} 末尾缺少换行符（拼接边界会粘连下一 part 的注释/代码）`);
    process.exit(1);
  }
  return code;
});

// v1.8.13 版本注入：紧随 00-head（W 命名空间已就位），取 package.json 的 version。
// 升版本只改 package.json 即可；--check 逐字节比对会强制 client.js 重建，永不漂移。
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
partCodes[0] += `\n/* 由 build.mjs 注入（源：package.json version）——勿手改此行 */\nW.VERSION = ${JSON.stringify(String(pkg.version))};\n`;

const bundled = partCodes.join('');

const writeTmp = path.join(dir, '.client.bundle.tmp.js');
fs.writeFileSync(writeTmp, bundled);

// 语法校验：拼接产物必须能过 node 语法检查（client.js 实际运行在浏览器 ModuleLoader，
// node --check 只验语法不执行，作为最低门槛）
try {
  execFileSync(process.execPath, ['--check', writeTmp], { stdio: 'pipe' });
} catch (e) {
  fs.unlinkSync(writeTmp);
  console.error(`✗ 拼接产物语法校验失败：\n${e.stderr}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  fs.unlinkSync(writeTmp);
  const current = fs.readFileSync(outFile, 'utf8');
  if (current === bundled) {
    console.log(`✓ client.js 与 parts 一致（${bundled.length} 字节，${EXPECTED.length} 个 part）`);
  } else {
    console.error(`✗ client.js 与 parts 拼接结果不一致（现 ${current.length} 字节 vs 拼 ${bundled.length} 字节）。请运行 npm run build 重建。`);
    process.exit(1);
  }
} else {
  fs.renameSync(writeTmp, outFile);
  console.log(`✓ client.js 已重建（${bundled.length} 字节，${EXPECTED.length} 个 part，语法校验通过）`);
}
