/* 极简 ZIP 生成器（store 不压缩 + UTF-8 文件名 EFS 标志）
 * 为什么不用 /usr/bin/zip：系统 zip 对中文文件名不设 UTF-8 标志（EFS bit），
 * 解压/列表会乱码——对中文笔记目录不可接受。
 * 仅做打包（markdown/JSON 本就小），不支持压缩与目录条目（用文件路径前缀表达层级）。
 */
import fs from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/** 递归收集目录下全部文件为 zip 条目（entryName 为相对路径，'/' 分隔） */
export function collectDirEntries(dir, prefix = '', filter) {
  const entries = [];
  const walk = (cur, rel) => {
    for (const item of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, item.name);
      const name = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) walk(abs, name);
      else if (item.isFile()) {
        if (filter && !filter(abs, name)) continue;
        entries.push({ name: prefix ? `${prefix}/${name}` : name, path: abs });
      }
    }
  };
  walk(dir, '');
  return entries;
}

/** 写 zip（store）：entries = [{name, path}] 或 [{name, data: Buffer|string}] */
export function writeZipFile(entries, zipPath) {
  // P2：ZIP16 格式中央目录计数是 UInt16——超 65535 条目会写错乱目录；超限直接拒绝。
  if (entries.length > 65535) {
    throw new Error(`备份条目过多（${entries.length} > 65535，ZIP16 上限）`);
  }
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : e.data != null ? Buffer.from(String(e.data), 'utf8') : fs.readFileSync(e.path);
    const nameBuf = Buffer.from(e.name, 'utf8');
    const { time, date } = dosDateTime();
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 (EFS)
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // flags: UTF-8
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
  return zipPath;
}
