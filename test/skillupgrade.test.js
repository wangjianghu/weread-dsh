// test/skillupgrade.test.js —— v1.9.19 官方 Skill 一键升级：纯函数（地址白名单 / 版本解析比较 / 只读 zip 取版本号）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  DEFAULT_SKILL_ZIP_URL, SKILL_ZIP_MAX_BYTES,
  isAllowedSkillUpgradeUrl, parseSemver, compareSemver, parseSkillVersionFromMarkdown,
  listZipEntries, readZipEntry, extractSkillVersionFromZip,
} from '../lib/skillUpgrade.js';

// ---- 测试夹具：手工拼 zip（local header + central directory + EOCD），支持 STORE 与 DEFLATE ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const x of buf) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u16 = (v) => [v & 255, (v >>> 8) & 255];
const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
/** @param entries [{name, content:string|Buffer, deflate?:boolean, encrypt?:boolean, method?:number}] */
function buildZip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.content ?? '');
    const method = e.method ?? (e.deflate ? 8 : 0);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const flags = e.encrypt ? 0x0001 : 0;
    const crc = method === 8 || method === 0 ? crc32(raw) : 0;
    const lh = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, ...u16(flags), ...u16(method), 0, 0, 0, 0, ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0)]);
    local.push(lh, name, data);
    const ch = Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, ...u16(flags), ...u16(method), 0, 0, 0, 0, ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central); const ld = Buffer.concat(local);
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, ...u16(entries.length), ...u16(entries.length), ...u32(cd.length), ...u32(ld.length), ...u16(0)]);
  return Buffer.concat([ld, cd, eocd]);
}
const SKILL = (v) => `---\nname: weread-skills\ndescription: 微信读书助手 — 搜索书籍、管理书架\nversion: ${v}\n---\n\n# WeRead — 微信读书助手\n\n通过 Agent API Gateway 调用微信读书接口。\n`;
const OFFICIAL_LIKE = (v) => buildZip([
  { name: 'weread-skills/book.md', content: '# book', deflate: true },
  { name: 'weread-skills/notes.md', content: '# notes\n'.repeat(50), deflate: true },
  { name: 'weread-skills/SKILL.md', content: SKILL(v), deflate: true },
  { name: 'weread-skills/search.md', content: '# search', deflate: true },
]);

describe('isAllowedSkillUpgradeUrl（地址白名单——URL 来自服务端回包）', () => {
  test('官方 CDN：允许', () => {
    assert.equal(isAllowedSkillUpgradeUrl(DEFAULT_SKILL_ZIP_URL), true);
    assert.equal(isAllowedSkillUpgradeUrl('https://cdn.weread.qq.com/skills/weread-skills.zip?v=2'), true);
    assert.equal(isAllowedSkillUpgradeUrl('https://cdn.weread.qq.com:443/skills/x.zip'), true);
  });
  test('非 https / 非官方主机 / 子域 / 内嵌凭据 / 非常规端口：一律拒绝', () => {
    for (const bad of [
      'http://cdn.weread.qq.com/skills/weread-skills.zip',
      'https://cdn.weread.qq.com.evil.example/skills/weread-skills.zip',
      'https://evil.cdn.weread.qq.com/skills/weread-skills.zip',
      'https://cdn.weread.qq.com@evil.example/skills/weread-skills.zip',
      'https://user:pw@cdn.weread.qq.com/skills/weread-skills.zip',
      'https://cdn.weread.qq.com:8443/skills/weread-skills.zip',
      'https://127.0.0.1/skills/weread-skills.zip', 'https://cdn.weread.qq.com./skills/x.zip',
      'file:///etc/passwd', 'ftp://cdn.weread.qq.com/x', 'cdn.weread.qq.com/skills/x.zip', '', null, undefined, 42,
    ]) assert.equal(isAllowedSkillUpgradeUrl(bad), false, `应拒绝：${bad}`);
  });
});

describe('parseSemver / compareSemver', () => {
  test('只认严格三段式', () => {
    assert.deepEqual(parseSemver('1.0.6'), [1, 0, 6]);
    assert.deepEqual(parseSemver(' v1.10.0 '), [1, 10, 0]);
    for (const bad of ['1.0', '1', '1.0.6-beta', 'latest', '', null, undefined, '1.0.6.1']) assert.equal(parseSemver(bad), null, `应判非法：${bad}`);
  });
  test('比较：逐段数值比较；非法输入返回 null', () => {
    assert.ok(compareSemver('1.0.6', '1.0.5') > 0);
    assert.ok(compareSemver('1.0.5', '1.0.6') < 0);
    assert.equal(compareSemver('1.0.6', 'v1.0.6'), 0);
    assert.ok(compareSemver('1.10.0', '1.9.9') > 0, '按数值而非字符串比较');
    assert.equal(compareSemver('1.0.6', 'x'), null);
  });
});

describe('parseSkillVersionFromMarkdown', () => {
  test('官方 frontmatter 形态', () => assert.equal(parseSkillVersionFromMarkdown(SKILL('1.0.6')), '1.0.6'));
  test('带引号 / 带 v 前缀 / 行尾注释 / CRLF', () => {
    assert.equal(parseSkillVersionFromMarkdown('---\nversion: "1.0.6"\n---\n'), '1.0.6');
    assert.equal(parseSkillVersionFromMarkdown("---\nversion: 'v1.0.6'\n---\n"), '1.0.6');
    assert.equal(parseSkillVersionFromMarkdown('---\nversion: 1.0.6 # 当前\n---\n'), '1.0.6');
    assert.equal(parseSkillVersionFromMarkdown('---\r\nversion: 1.0.6\r\n---\r\n'), '1.0.6');
  });
  test('无 frontmatter / 无 version / 非法版本 / version 只出现在正文：均为 null', () => {
    assert.equal(parseSkillVersionFromMarkdown('# WeRead\nversion: 1.0.6\n'), null, '正文里的 version 不算');
    assert.equal(parseSkillVersionFromMarkdown('---\nname: x\n---\n'), null);
    assert.equal(parseSkillVersionFromMarkdown('---\nversion: latest\n---\n'), null);
    assert.equal(parseSkillVersionFromMarkdown('---\nversion: 1.0\n---\n'), null);
    assert.equal(parseSkillVersionFromMarkdown(''), null);
    assert.equal(parseSkillVersionFromMarkdown(undefined), null);
  });
});

describe('zip 读取（只读 SKILL.md 条目）', () => {
  test('官方包形态（多文件、DEFLATE）→ 读出版本号', () => {
    assert.equal(extractSkillVersionFromZip(OFFICIAL_LIKE('1.0.6')), '1.0.6');
  });
  test('不压缩（STORE）与根目录下的 SKILL.md 也能读', () => {
    assert.equal(extractSkillVersionFromZip(buildZip([{ name: 'SKILL.md', content: SKILL('2.3.4') }])), '2.3.4');
    assert.equal(extractSkillVersionFromZip(buildZip([{ name: 'a/b/SKILL.md', content: SKILL('1.2.3') }])), '1.2.3');
  });
  test('没有 SKILL.md → null；__MACOSX 垃圾条目与隐藏文件被忽略', () => {
    assert.equal(extractSkillVersionFromZip(buildZip([{ name: 'readme.txt', content: 'x' }])), null);
    assert.equal(extractSkillVersionFromZip(buildZip([{ name: '__MACOSX/weread-skills/SKILL.md', content: SKILL('9.9.9') }, { name: 'weread-skills/.SKILL.md', content: SKILL('8.8.8') }])), null);
  });
  test('优先 weread-skills/SKILL.md（而不是路径更浅的其它同名文件）', () => {
    const z = buildZip([{ name: 'other/SKILL.md', content: SKILL('0.0.1') }, { name: 'deep/weread-skills/SKILL.md', content: SKILL('1.0.6') }]);
    assert.equal(extractSkillVersionFromZip(z), '1.0.6');
  });
  test('加密条目 / 不支持的压缩方式 / 截断 / 非 zip：抛错，不返回版本号', () => {
    assert.throws(() => extractSkillVersionFromZip(buildZip([{ name: 'weread-skills/SKILL.md', content: SKILL('1.0.6'), encrypt: true }])), /加密/);
    assert.throws(() => extractSkillVersionFromZip(buildZip([{ name: 'weread-skills/SKILL.md', content: SKILL('1.0.6'), method: 12 }])), /不支持/);
    const z = OFFICIAL_LIKE('1.0.6');
    assert.throws(() => extractSkillVersionFromZip(z.subarray(0, z.length - 30)), /不是有效/);
    assert.throws(() => extractSkillVersionFromZip(Buffer.from('PK\x03\x04garbage')), /不是有效/);
    assert.throws(() => extractSkillVersionFromZip(Buffer.alloc(3)), /过短/);
  });
  test('体积护栏：条目声明大小超限 → 拒绝；解压后超限（zip 炸弹）→ 拒绝', () => {
    const big = buildZip([{ name: 'weread-skills/SKILL.md', content: SKILL('1.0.6') + 'x'.repeat(5000) }]);
    const e = listZipEntries(big)[0];
    assert.throws(() => readZipEntry(big, e, 1024), /超出大小上限/);
    const bomb = buildZip([{ name: 'weread-skills/SKILL.md', content: SKILL('1.0.6') + 'A'.repeat(3_000_000), deflate: true }]);
    assert.throws(() => extractSkillVersionFromZip(bomb) ?? null, /超出大小上限|buffer/);
    assert.ok(SKILL_ZIP_MAX_BYTES > OFFICIAL_LIKE('1.0.6').length, '官方包体积在上限之内');
  });
  test('listZipEntries / readZipEntry：条目元数据与内容正确', () => {
    const z = buildZip([{ name: 'a.txt', content: 'hello' }, { name: 'd.txt', content: 'world'.repeat(20), deflate: true }]);
    const es = listZipEntries(z);
    assert.deepEqual(es.map((x) => [x.name, x.method]), [['a.txt', 0], ['d.txt', 8]]);
    assert.equal(readZipEntry(z, es[0]).toString(), 'hello');
    assert.equal(readZipEntry(z, es[1]).toString(), 'world'.repeat(20));
  });
});
