const fs = require('fs');
const zlib = require('zlib');

function encodeUTF8(str) {
  const buf = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) buf.push(code);
    else if (code < 0x800) { buf.push(0xC0 | (code >> 6)); buf.push(0x80 | (code & 0x3F)); }
    else { buf.push(0xE0 | (code >> 12)); buf.push(0x80 | ((code >> 6) & 0x3F)); buf.push(0x80 | (code & 0x3F)); }
  }
  return Buffer.from(buf);
}

function deflate(buf) { return zlib.deflateRawSync(buf); }
function store(buf) { return Buffer.from(buf); }

function localFileHeader(nameBuf, method, compSize, uncompSize, crc32) {
  const header = Buffer.alloc(30 + nameBuf.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(0x0014, 4);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(crc32, 14);
  header.writeUInt32LE(compSize, 18);
  header.writeUInt32LE(uncompSize, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuf.copy(header, 30);
  return header;
}

function centralDirEntry(nameBuf, compSize, uncompSize, crc32, method, offset) {
  const buf = Buffer.alloc(46 + nameBuf.length);
  buf.writeUInt32LE(0x02014b50, 0);
  buf.writeUInt16LE(0x0014, 4);   // version made by
  buf.writeUInt16LE(0x0014, 6);   // version needed
  buf.writeUInt16LE(0, 8);        // flags
  buf.writeUInt16LE(method, 10);  // method
  buf.writeUInt16LE(0, 12);       // mod time
  buf.writeUInt16LE(0, 14);       // mod date
  buf.writeUInt32LE(crc32, 16);
  buf.writeUInt32LE(compSize, 20);
  buf.writeUInt32LE(uncompSize, 24);
  buf.writeUInt16LE(nameBuf.length, 28);
  buf.writeUInt16LE(0, 30);       // extra len
  buf.writeUInt16LE(0, 32);       // comment len
  buf.writeUInt16LE(0, 34);       // disk number
  buf.writeUInt16LE(0, 36);       // internal attrs
  buf.writeUInt32LE(0, 38);       // external attrs
  buf.writeUInt32LE(offset, 42);
  nameBuf.copy(buf, 46);
  return buf;
}

function endOfCentralDirectory(numEntries, size, offset) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(numEntries, 8);
  buf.writeUInt16LE(numEntries, 10);
  buf.writeUInt32LE(size, 12);
  buf.writeUInt32LE(offset, 16);
  return buf;
}

class ZipWriter {
  constructor() { this.files = []; }
  add(name, data, compression) {
    const comp = compression === 'store' ? store(data) : deflate(data);
    const crc = crc32(data);
    const nameBuf = encodeUTF8(String(name));
    this.files.push({ nameBuf, comp, uncomp: data.length, crc, method: compression === 'store' ? 0 : 8 });
  }
  pack() {
    // Local file headers + data
    const locals = [];
    let offset = 0;
    this.files.forEach((f) => {
      const header = localFileHeader(f.nameBuf, f.method, f.comp.length, f.uncomp, f.crc);
      locals.push(header);
      locals.push(f.comp);
      f.offset = offset;
      offset += header.length + f.comp.length;
    });
    const localBuf = Buffer.concat(locals);

    // Central directory
    const cdParts = this.files.map((f) => centralDirEntry(f.nameBuf, f.comp.length, f.uncomp, f.crc, f.method, f.offset));
    const cdBuf = Buffer.concat(cdParts);

    // EOCD: count, cd size, cd offset
    const eocd = endOfCentralDirectory(this.files.length, cdBuf.length, localBuf.length);
    return Buffer.concat([localBuf, cdBuf, eocd]);
  }
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

module.exports = { ZipWriter, crc32, encodeUTF8 };
