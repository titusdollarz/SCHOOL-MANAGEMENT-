// Maps xlsx grids -> students + marks (LDJS tracker + simple pupil lists).
const { readZip, sharedStrings, sheetOrder, sheetGrid } = require('./xlsx');
function norm(s) { return String(s || '').trim(); }
function num(s) { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n; }
function normPhone(p) {
  if (!p) return '';
  let s = String(p).replace(/[\s\-()]/g, '');
  if (/^0\d{9}$/.test(s)) s = '+256' + s.slice(1);
  else if (/^256\d{9}$/.test(s)) s = '+' + s;
  else if (/^\d{9}$/.test(s)) s = '+256' + s;
  return s;
}
function normClass(c) {
  c = norm(c);
  const m = c.match(/^[Pp]([1-7])$/); if (m) return 'Primary ' + m[1];
  if (/^baby$/i.test(c)) return 'Baby';
  if (/^middle$/i.test(c)) return 'Middle';
  if (/^top$/i.test(c)) return 'Top';
  return c;
}
function findHeader(rows, needles) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const j = rows[i].join(' | ').toLowerCase();
    if (needles.every((n) => j.includes(n))) return i;
  }
  return -1;
}
function parseXlsx(buf) {
  const files = readZip(buf);
  const S = sharedStrings(files);
  let order = sheetOrder(files);
  if (!order.length) order = Object.keys(files).filter((n) => n.includes('worksheets/sheet')).map((n) => ({ name: n, file: n.split('/').pop() }));
  const students = new Map(); const marks = []; const notes = [];
  const ensure = (name, cls, extra) => {
    const key = (name + '|' + cls).toLowerCase();
    if (!students.has(key)) students.set(key, { name, class: cls, gender: '', parent: '', parentPhone: '', feesBilled: 0 });
    if (extra) Object.assign(students.get(key), Object.fromEntries(Object.entries(extra).filter((e) => e[1] !== '' && e[1] !== 0)));
    return students.get(key);
  };
  order.forEach((sh) => {
    const rows = sheetGrid(files, sh.file, S);
    if (!rows.length) return;
    const hi = findHeader(rows, ['learner name', 'class', 'term']);
    if (hi < 0) return;
    const H = rows[hi].map((h) => h.toLowerCase());
    const ci = (n) => H.findIndex((h) => h.includes(n));
    const iName = ci('learner name'), iClass = H.findIndex((h) => h === 'class');
    const iTerm = ci('term'); const iAss = ci('assessment');
    if (iName < 0 || iClass < 0) return;
    const iAvg = H.findIndex((h) => h.includes('average'));
    const end = iAvg > 0 ? iAvg : H.length;
    const subs = [];
    for (let c = Math.max(iAss, iTerm, iClass) + 1; c < end; c++) {
      const h = rows[hi][c]; if (!h) continue;
      const hl = h.toLowerCase();
      if (['record id', 'average', 'below', 'band', 'flag', 'data check', 'notes'].some((k) => hl.includes(k))) continue;
      subs.push({ idx: c, subject: norm(h) });
    }
    if (!subs.length) return;
    let n = 0;
    for (let r = hi + 1; r < rows.length; r++) {
      const nm = norm(rows[r][iName]); if (!nm) continue;
      const cls = normClass(rows[r][iClass] || ''); if (!cls) continue;
      const term = norm(rows[r][iTerm]) || 'Term 1';
      const ass = iAss >= 0 ? (norm(rows[r][iAss]) || 'End of Term') : 'End of Term';
      ensure(nm, cls);
      subs.forEach((s2) => {
        const v = num(rows[r][s2.idx]);
        if (v === null || v < 0 || v > 100) return;
        marks.push({ key: (nm + '|' + cls).toLowerCase(), name: nm, class: cls, subject: s2.subject, term, assessment: ass, score: v });
        n++;
      });
    }
    if (n) notes.push(sh.name + ': ' + n + ' scores');
  });
  order.forEach((sh) => {
    const rows = sheetGrid(files, sh.file, S);
    if (!rows.length) return;
    const hi = findHeader(rows, ['name', 'class']);
    if (hi < 0) return;
    const H = rows[hi].map((h) => h.toLowerCase());
    if (!H.some((h) => h.includes('parent') || h.includes('phone') || h.includes('fee') || h.includes('gender'))) return;
    const pick = (...ns) => H.findIndex((h) => ns.some((n) => h.includes(n)));
    const iName = pick('learner', 'pupil', 'student', 'name');
    const iClass = H.findIndex((h) => h === 'class');
    const iPar = pick('parent', 'guardian'), iPhone = pick('phone', 'contact', 'tel');
    const iFee = pick('fee', 'billed', 'balance', 'amount'), iGen = pick('gender', 'sex');
    let added = 0;
    for (let r = hi + 1; r < rows.length; r++) {
      const nm = norm(rows[r][iName]); if (!nm) continue;
      const cls = normClass(rows[r][iClass] || ''); if (!cls) continue;
      ensure(nm, cls, { parent: norm(rows[r][iPar] || ''), parentPhone: normPhone(rows[r][iPhone] || ''), feesBilled: num(rows[r][iFee]) || 0, gender: norm(rows[r][iGen] || '').slice(0, 1).toUpperCase() });
      added++;
    }
    if (added) notes.push(sh.name + ': ' + added + ' pupils');
  });
  return { students: [...students.values()], marks, notes };
}

// Pupil-list CSV (the template from /api/import-template):
//   Name,Class,Parent,Phone,Fees,Gender
// Quoted fields with commas/quotes supported. Header row required.
function parsePupilCsv(text) {
  const rows = [];
  let cur = [''];
  let inQ = false;
  const t = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') {
        if (t[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else inQ = false;
      } else cur[cur.length - 1] += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') cur.push('');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      rows.push(cur); cur = [''];
    } else cur[cur.length - 1] += ch;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  const clean = rows.map((r) => r.map((c) => String(c).trim())).filter((r) => r.some((c) => c !== ''));
  if (!clean.length) return { students: [], marks: [], notes: [] };
  const head = clean[0].map((h) => h.toLowerCase());
  const hasName = head.some((h) => h.includes('name') || h.includes('pupil') || h.includes('learner') || h.includes('student'));
  const hasClass = head.some((h) => h === 'class' || h.includes('class'));
  if (!hasName || !hasClass) return { students: [], marks: [], notes: [] };
  const pick = (...ns) => head.findIndex((h) => ns.some((n) => h.includes(n)));
  const iName = pick('learner', 'pupil', 'student', 'name');
  const iClass = head.findIndex((h) => h === 'class');
  const iPar = pick('parent', 'guardian'), iPhone = pick('phone', 'contact', 'tel');
  const iFee = pick('fee', 'billed', 'balance', 'amount'), iGen = pick('gender', 'sex');
  const students = new Map(); const notes = [];
  const ensure = (name, cls, extra) => {
    const key = (name + '|' + cls).toLowerCase();
    if (!students.has(key)) students.set(key, { name, class: cls, gender: '', parent: '', parentPhone: '', feesBilled: 0 });
    if (extra) Object.assign(students.get(key), Object.fromEntries(Object.entries(extra).filter((e) => e[1] !== '' && e[1] !== 0)));
    return students.get(key);
  };
  let added = 0;
  for (let r = 1; r < clean.length; r++) {
    const nm = norm(clean[r][iName]); if (!nm) continue;
    const cls = normClass(clean[r][iClass] || ''); if (!cls) continue;
    ensure(nm, cls, { parent: norm(clean[r][iPar] || ''), parentPhone: normPhone(clean[r][iPhone] || ''), feesBilled: num(clean[r][iFee]) || 0, gender: norm(clean[r][iGen] || '').slice(0, 1).toUpperCase() });
    added++;
  }
  if (added) notes.push('CSV: ' + added + ' pupils');
  return { students: [...students.values()], marks: [], notes };
}
module.exports = { parseXlsx, parsePupilCsv, normPhone, normClass };
