// Excel import — zero dependencies (uses Node zlib).
// Reads .xlsx: LDJS tracker sheets -> students+marks, or simple pupil lists -> students.
const zlib = require('zlib');
function colIdx(col) { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function splitRef(ref) { const m = ref.match(/^([A-Z]+)(\d+)$/); return { col: colIdx(m[1]), row: parseInt(m[2], 10) }; }
function readZip(buf) {
  const files = {};
  // find End Of Central Directory (scan last 66k)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return files;
  const entries = [];
  if (eocd >= 0) {
    const count = buf.readUInt16LE(eocd + 10);
    let co = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(co) !== 0x02014b50) break;
      const method = buf.readUInt16LE(co + 10);
      const compSize = buf.readUInt32LE(co + 24);
      const nameLen = buf.readUInt16LE(co + 28);
      const extraLen = buf.readUInt16LE(co + 30);
      const comLen = buf.readUInt16LE(co + 32);
      const lho = buf.readUInt32LE(co + 42);
      const name = buf.slice(co + 46, co + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
      entries.push({ name, method, compSize, lho });
      co += 46 + nameLen + extraLen + comLen;
    }
  }
  entries.forEach((e) => {
    const lh = e.lho;
    if (buf.readUInt32LE(lh) !== 0x04034b50) return;
    const nameLen = buf.readUInt16LE(lh + 26);
    const extraLen = buf.readUInt16LE(lh + 28);
    const ds = lh + 30 + nameLen + extraLen;
    const comp = buf.slice(ds, ds + e.compSize);
    let raw = null;
    try { raw = e.method === 0 ? comp : (e.method === 8 ? zlib.inflateRawSync(comp) : null); } catch { raw = null; }
    if (raw !== null && !e.name.endsWith('/')) files[e.name] = raw;
  });
  return files;
}
function sharedStrings(files) {
  const out = [];
  const k = Object.keys(files).find((n) => n.endsWith('sharedStrings.xml'));
  if (!k) return out;
  const x = files[k].toString('utf8');
  const re = /<si>([\s\S]*?)<\/si>/g; let m;
  while ((m = re.exec(x))) {
    const t = [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((z) => z[1]).join('');
    out.push(t.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  return out;
}
function sheetOrder(files) {
  const wb = Object.keys(files).find((n) => n.endsWith('workbook.xml'));
  if (!wb) return [];
  const x = files[wb].toString('utf8');
  const sheets = []; const re = /<sheet[^>]*>/g; let m;
  while ((m = re.exec(x))) {
    const nm = (m[0].match(/name="([^"]+)"/) || [])[1];
    const id = (m[0].match(/r:id="([^"]+)"/) || [])[1];
    if (nm && id) sheets.push({ name: nm, id });
  }
  const rels = Object.keys(files).find((n) => n.endsWith('workbook.xml.rels'));
  let relMap = {};
  if (rels) { const rx = files[rels].toString('utf8'); const rr = /Id="([^"]+)"[^>]*Target="([^"]+)"/g; let z; while ((z = rr.exec(rx))) relMap[z[1]] = z[2]; }
  return sheets.map((s) => ({ name: s.name, file: String(relMap[s.id] || '').split('/').pop() }));
}
function sheetGrid(files, sheetFile, S) {
  const key = Object.keys(files).find((n) => n.endsWith('/' + sheetFile));
  if (!key) return [];
  const x = files[key].toString('utf8');
  const grid = {}; let maxR = 0, maxC = 0;
  const re = /<c r="([A-Z]+[0-9]+)"[^>]*>([\s\S]*?)<\/c>/g; let m;
  while ((m = re.exec(x))) {
    const sp = splitRef(m[1]); const inner = m[2];
    const tm = m[0].match(/t="(\w+)"/); const t = tm && tm[1];
    let v = null;
    if (t === 's') { const vm = inner.match(/<v>([^<]*)<\/v>/); v = vm ? S[parseInt(vm[1], 10)] : null; }
    else { const vm = inner.match(/<v>([^<]*)<\/v>/); if (vm) v = vm[1]; else { const im = inner.match(/<t>([^<]*)<\/t>/); if (im) v = im[1]; } }
    if (v === null || v === undefined || v === '') continue;
    grid[sp.row + ':' + sp.col] = String(v).trim();
    if (sp.row > maxR) maxR = sp.row; if (sp.col > maxC) maxC = sp.col;
  }
  const rows = [];
  for (let r = 1; r <= maxR; r++) { const row = []; for (let c = 0; c <= maxC; c++) row.push(grid[r + ':' + c] || ''); rows.push(row); }
  return rows;
}
module.exports = { readZip, sharedStrings, sheetOrder, sheetGrid };
