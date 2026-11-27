/**
 * lib/skillUpgrade.js —— v1.9.19 官方 Skill 一键升级的纯函数（无 I/O、无状态，全部可单测）。
 *
 * 「Skill」是什么：微信读书官方发布的一套接口说明文档（9 个 Markdown，约 28KB 的 zip），面向 AI 助手。
 * 插件**不运行**它，只用到一个版本号——每次网关请求 body 里的 `skill_version`。
 * 所以「升级 Skill」对插件而言 = 换掉这个版本号。服务端在回包里给 `upgrade_info.upgrade_url`。
 *
 * 安全边界（全部有测试）：
 *   · 只允许从官方 CDN（https://cdn.weread.qq.com）下载——URL 来自服务端回包，必须做白名单；
 *   · 只读 zip 里的 SKILL.md 条目（不解压到磁盘、不执行、不写任何文件）；
 *   · 下载体积、单条目解压体积、条目数都有上限；加密条目、ZIP64、非 STORE/DEFLATE 一律拒绝。
 */

import { inflateRawSync } from 'node:zlib';

export const SKILL_UPGRADE_HOST = 'cdn.weread.qq.com';
export const DEFAULT_SKILL_ZIP_URL = `https://${SKILL_UPGRADE_HOST}/skills/weread-skills.zip`;
/** 升级包体积上限（官方包约 28KB；留足余量，防异常大包占内存） */
export const SKILL_ZIP_MAX_BYTES = 2 * 1024 * 1024;
/** 单个条目解压后的上限（SKILL.md 约 7KB）——防 zip 炸弹 */
const ZIP_ENTRY_MAX_BYTES = 1024 * 1024;
/** 中央目录条目数上限 */
const ZIP_ENTRIES_MAX = 512;

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) | (b[o + 3] << 24)) >>> 0;

/** 升级地址白名单：必须 https、主机名精确等于官方 CDN、无内嵌凭据、端口为空或 443。 */
export function isAllowedSkillUpgradeUrl(url) {
  try {
    const u = new URL(String(url ?? ''));
    return u.protocol === 'https:'
      && u.hostname === SKILL_UPGRADE_HOST
      && !u.username && !u.password
      && (u.port === '' || u.port === '443');
  } catch {
    return false;
  }
}

/** 严格的三段式语义化版本：'1.0.6' / 'v1.0.6' → [1, 0, 6]；其余返回 null（不接受 '1.0'、'1.0.6-beta'）。 */
export function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a>b 返回正数、a<b 返回负数、相等 0；任一不是合法版本返回 null。 */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/** 从 SKILL.md 正文里读 YAML frontmatter 的 `version:`（官方包：`name`/`description`/`version` 三项）。 */
export function parseSkillVersionFromMarkdown(text) {
  const head = String(text ?? '').slice(0, 4096);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
  if (!fm) return null;
  const m = /^version:[ \t]*["']?([^"'\s#]+)["']?[ \t]*(?:#.*)?$/m.exec(fm[1]);
  if (!m) return null;
  const v = m[1].replace(/^v/, '');
  return parseSemver(v) ? v : null;
}

/** 列出 zip 的中央目录条目。损坏/不支持（ZIP64、加密）抛 Error。 */
export function listZipEntries(buf) {
  const b = buf instanceof Uint8Array ? buf : Buffer.from(buf);
  if (b.length < 22) throw new Error('不是有效的升级包（过短）');
  const min = Math.max(0, b.length - 22 - 65535);
  let eocd = -1;
  for (let i = b.length - 22; i >= min; i -= 1) {
    if (u32(b, i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的升级包（找不到 zip 目录）');
  const total = u16(b, eocd + 10);
  if (total === 0xffff) throw new Error('不支持 ZIP64 升级包');
  if (total > ZIP_ENTRIES_MAX) throw new Error('升级包条目数超出上限');
  let off = u32(b, eocd + 16);
  const entries = [];
  for (let n = 0; n < total; n += 1) {
    if (off + 46 > b.length || u32(b, off) !== SIG_CEN) throw new Error('升级包目录损坏');
    const flags = u16(b, off + 8);
    const method = u16(b, off + 10);
    const compressedSize = u32(b, off + 20);
    const size = u32(b, off + 24);
    const nameLen = u16(b, off + 28);
    const extraLen = u16(b, off + 30);
    const commentLen = u16(b, off + 32);
    const localOffset = u32(b, off + 42);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error('不支持 ZIP64 升级包');
    if (off + 46 + nameLen > b.length) throw new Error('升级包目录损坏');
    const name = Buffer.from(b.subarray(off + 46, off + 46 + nameLen)).toString('utf8');
    entries.push({ name, flags, method, compressedSize, size, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 读取一个条目的内容（STORE / DEFLATE），返回 Buffer。 */
export function readZipEntry(buf, entry, maxBytes = ZIP_ENTRY_MAX_BYTES) {
  const b = buf instanceof Uint8Array ? buf : Buffer.from(buf);
  const off = entry.localOffset;
  if (off + 30 > b.length || u32(b, off) !== SIG_LOC) throw new Error('升级包文件头损坏');
  const nameLen = u16(b, off + 26);
  const extraLen = u16(b, off + 28);
  const start = off + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > b.length) throw new Error('升级包条目数据越界');
  if (entry.flags & 0x1) throw new Error('不支持加密的升级包条目');
  if (entry.size > maxBytes) throw new Error('升级包条目超出大小上限');
  const data = b.subarray(start, end);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes });
  throw new Error(`不支持的升级包压缩方式：${entry.method}`);
}

/**
 * 从升级包里读出 Skill 版本号；读不到返回 null。
 * 只读 SKILL.md（优先路径以 `weread-skills/SKILL.md` 结尾的官方条目，否则取路径最浅的），不解压其它条目、不写磁盘。
 */
export function extractSkillVersionFromZip(buf) {
  const cands = listZipEntries(buf).filter((e) => {
    if (!/(^|\/)SKILL\.md$/i.test(e.name)) return false;
    const parts = e.name.split('/');
    return !parts.includes('__MACOSX') && !parts.some((p) => p.startsWith('.'));
  });
  if (!cands.length) return null;
  // 官方条目 = 路径以 weread-skills/SKILL.md 结尾（压缩包外面多套一层目录也认得）；其余按路径由浅到深。
  // 包里另有同名文件时，保证读的是「最像官方包」的那一个，而不是碰巧排在最前面的。
  const rankOf = (e) => /(^|\/)weread-skills\/SKILL\.md$/i.test(e.name) ? 0 : 1;
  cands.sort((a, b) => rankOf(a) - rankOf(b) || a.name.split('/').length - b.name.split('/').length);
  for (const e of cands) {
    const v = parseSkillVersionFromMarkdown(readZipEntry(buf, e).toString('utf8'));
    if (v) return v;
  }
  return null;
}
