const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load, save, loadSystem, saveSystem, loadSchool, saveSchool, schoolFile, deleteSchoolData, newSchoolDb, findUserEverywhere, UPLOADS_DIR, weekStart } = require('./db');
const { sendSMS, smsConfig } = require('./sms');
const { learnerAnalysis, classSummary, trend } = require('./ldjs');
const { parseXlsx, parsePupilCsv, normPhone } = require('./import');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const sessions = new Map(); // token -> user
const importCache = new Map(); // importToken -> {students, marks}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webm': 'video/webm', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.pdf': 'application/pdf', '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain' };
const TEACHER = (me, db) => db.users.find((u) => u.id === me.id) || {};
const IS_ADMINISH = (me) => me.role === 'admin' || me.role === 'headteacher';
const IS_SUPER = (me) => me.role === 'superadmin';

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function parseBody(req, limitMB) {
  return new Promise((resolve) => {
    let b = '';
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const lim = (limitMB || 12) * 1024 * 1024;
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      b += c;
      if (b.length > lim) { tooBig = true; finish({ __tooLarge: true }); try { req.destroy(); } catch {} }
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!b) return finish({});
      try { finish(JSON.parse(b)); } catch { finish({ raw: b }); }
    });
    // 'close' can fire instead of 'end' if the client aborts mid-upload â€”
    // resolve with what we have instead of hanging the request forever.
    req.on('close', () => {
      if (tooBig) return;
      if (!b) return finish({});
      try { finish(JSON.parse(b)); } catch { finish({ raw: b }); }
    });
    req.on('error', () => finish({}));
  });
}
function userFromReq(req, url) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (t && sessions.get(t)) return sessions.get(t);
  // allow ?token= for direct downloads (template) from phone browsers
  try {
    const q = (url && url.searchParams.get('token')) || '';
    if (q && sessions.get(q)) return sessions.get(q);
  } catch {}
  return t ? sessions.get(t) || null : null;
}
function grade(s) {
  if (s >= 80) return 'D1'; if (s >= 70) return 'D2';
  if (s >= 60) return 'C3'; if (s >= 50) return 'C4';
  if (s >= 40) return 'P5'; if (s >= 35) return 'P6';
  if (s >= 28) return 'P7'; return 'F9';
}
async function api(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/login' && method === 'POST') {
    const { email, password } = await parseBody(req);
    const sys = loadSystem();
    if (sys.superAdmin && sys.superAdmin.email === email && sys.superAdmin.password === password) {
      const token = crypto.randomBytes(24).toString('hex');
      const u = { id: sys.superAdmin.id, name: sys.superAdmin.name, email: sys.superAdmin.email, role: 'superadmin' };
      sessions.set(token, u);
      return sendJSON(res, 200, { token, user: u });
    }
    const found = findUserEverywhere(email, password);
    if (!found) return sendJSON(res, 401, { error: 'Invalid email or password' });
    const token = crypto.randomBytes(24).toString('hex');
    const u = { id: found.user.id, name: found.user.name, email: found.user.email, role: found.user.role, classes: found.user.classes || [], subjects: found.user.subjects || [], childrenIds: found.user.childrenIds || [], schoolId: found.school.id, schoolName: found.school.name };
    sessions.set(token, u);
    return sendJSON(res, 200, { token, user: u });
  }

  // Public: a school signs up with its email â†’ provisions a school + head-teacher account
  if (p === '/api/register-school' && method === 'POST') {
    const { schoolName, email, password, phone, address, headName, headPassword } = await parseBody(req);
    if (!schoolName || !email || !password || !headName || !headPassword) return sendJSON(res, 400, { error: 'School name, email, password, head teacher name and password are all required' });
    const sys = loadSystem();
    if (sys.schools.find((s) => s.email === email)) return sendJSON(res, 400, { error: 'A school with that email already exists' });
    const id = 'sch-' + crypto.randomBytes(4).toString('hex');
    const sch = { id, name: schoolName, email, password, phone: phone || '', address: address || '', status: 'active', createdAt: new Date().toISOString() };
    sys.schools.push(sch);
    saveSystem(sys);
    const head = { id: 'u-ht', name: headName, email, password: headPassword, role: 'headteacher', phone: phone || '' };
    saveSchool(id, newSchoolDb(head));
    return sendJSON(res, 200, { ok: true, school: { id, name: schoolName, email }, headEmail: email });
  }

  const me = userFromReq(req, url);
  if (!me) { return sendJSON(res, 401, { error: 'Please log in' }); }

  // Superadmin manages school accounts only (no access to school-internal data routes)
  if (IS_SUPER(me)) return superAdminApi(req, res, url, p, method);

  const db = loadSchool(me.schoolId);
  // Bigger bodies allowed for uploads: videos 250MB, papers/work 25MB, else 12MB
  const bodyLimit = p === '/api/videos' ? 250 : (p === '/api/papers' || p === '/api/work') ? 25 : 12;
  const body = (method === 'POST' || method === 'PUT') ? await parseBody(req, bodyLimit) : {};
  if (body && body.__tooLarge) return sendJSON(res, 413, { error: 'Upload too large (max ~' + bodyLimit + 'MB). Split the file and try again.' });

  if (p === '/api/dashboard' && method === 'GET') {
    const totalStudents = db.students.length;
    const feesBilled = db.students.reduce((a, s) => a + (s.feesBilled || 0), 0);
    const feesPaid = db.fees.reduce((a, f) => a + f.amount, 0);
    const avg = db.marks.length ? (db.marks.reduce((a, m) => a + m.score, 0) / db.marks.length) : 0;
    const today = new Date().toISOString().slice(0, 10);
    const attToday = db.attendance.filter((a) => a.date === today);
    const byClass = {};
    db.marks.forEach((m) => {
      const st = db.students.find((s) => s.id === m.studentId);
      if (!st) return;
      byClass[st.class] = byClass[st.class] || { total: 0, n: 0 };
      byClass[st.class].total += m.score; byClass[st.class].n++;
    });
    const classAvgs = Object.entries(byClass).map(([c, v]) => ({ class: c, avg: Math.round(v.total / v.n) }));
    const byStudent = {};
    db.marks.forEach((m) => {
      byStudent[m.studentId] = byStudent[m.studentId] || { total: 0, n: 0 };
      byStudent[m.studentId].total += m.score; byStudent[m.studentId].n++;
    });
    const top = Object.entries(byStudent)
      .map(([id, v]) => ({ ...(db.students.find((s) => s.id === id) || { id }), avg: Math.round(v.total / v.n) }))
      .sort((a, b) => b.avg - a.avg).slice(0, 5);
    return sendJSON(res, 200, { totalStudents, feesBilled, feesPaid, feesBalance: feesBilled - feesPaid, overallAvg: Math.round(avg), presentToday: attToday.filter((a) => a.status === 'present').length, classAvgs, top });
  }

  if (p === '/api/students' && method === 'GET') {
    let list = db.students;
    if (me.role === 'teacher') {
      const mine = new Set(TEACHER(me, db).classes || []);
      list = list.filter((s) => mine.has(s.class));
    } else if (me.role === 'parent') {
      const parent = db.users.find((u) => u.id === me.id);
      list = list.filter((s) => (parent.childrenIds || []).includes(s.id));
    } else if (me.role !== 'admin' && me.role !== 'headteacher' && me.role !== 'bursar') {
      return sendJSON(res, 403, { error: 'Not allowed' });
    }
    // Optional search: /api/students?q=name, class or phone fragment
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    if (q) list = list.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.class || '').toLowerCase().includes(q) || (s.parentPhone || '').includes(q));
    const enriched = list.map((s) => {
      const paid = db.fees.filter((f) => f.studentId === s.id).reduce((a, f) => a + f.amount, 0);
      const sc = db.marks.filter((m) => m.studentId === s.id).map((m) => m.score);
      const average = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length * 10) / 10 : null;
      return { ...s, paid, balance: (s.feesBilled || 0) - paid, average };
    });
    return sendJSON(res, 200, enriched);
  }
  if (p === '/api/students' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    if (!body.name || !body.class) return sendJSON(res, 400, { error: 'Learner name and class are required' });
    const s = { id: 's-' + Date.now(), name: body.name, class: body.class, gender: (body.gender || '').slice(0, 1).toUpperCase(), parent: body.parent || '', parentPhone: normPhone(body.parentPhone || ''), feesBilled: Number(body.feesBilled) || 0, dob: body.dob || '' };
    db.students.push(s);
    if (body.parentUserId) {
      const pu = db.users.find((u) => u.id === body.parentUserId && u.role === 'parent');
      if (pu) { pu.childrenIds = pu.childrenIds || []; pu.childrenIds.push(s.id); }
    }
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, s);
  }

  //__MORE_API__

  // ---- Account management: admin creates ALL roles; head teacher manages staff+parents ----
  if (p === '/api/users' && method === 'GET') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    return sendJSON(res, 200, { users: db.users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone || '', subjects: u.subjects || [], classes: u.classes || [], childrenIds: u.childrenIds || [] })) });
  }
  if (p === '/api/users' && method === 'POST') {
    const role = String(body.role || '').toLowerCase();
    const allowed = me.role === 'admin'
      ? ['admin', 'headteacher', 'teacher', 'bursar', 'parent']
      : me.role === 'headteacher' ? ['teacher', 'bursar', 'parent'] : [];
    if (!allowed.includes(role)) return sendJSON(res, 403, { error: 'You cannot create ' + (role || 'accounts') + ' accounts' });
    if (!body.name || !body.email || !body.password) return sendJSON(res, 400, { error: 'Name, email and password are required' });
    if (db.users.some((u) => u.email === body.email)) return sendJSON(res, 400, { error: 'That email is already registered' });
    const u = { id: 'u-' + crypto.randomBytes(4).toString('hex'), name: body.name, email: body.email, password: body.password, role, phone: body.phone || '' };
    if (role === 'teacher') {
      u.subjects = Array.isArray(body.subjects) ? body.subjects : String(body.subjects || '').split(',').map((s) => s.trim()).filter(Boolean);
      u.classes = Array.isArray(body.classes) ? body.classes : String(body.classes || '').split(',').map((s) => s.trim()).filter(Boolean);
      db.staff.push({ id: u.id, name: u.name, role: 'Teacher', phone: u.phone });
    }
    if (role === 'parent') u.childrenIds = Array.isArray(body.childrenIds) ? body.childrenIds : [];
    db.users.push(u);
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  }
  if (p.startsWith('/api/users/') && method === 'DELETE') {
    if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const id = p.split('/')[3];
    if (id === me.id) return sendJSON(res, 400, { error: 'You cannot delete your own account' });
    db.users = db.users.filter((u) => u.id !== id);
    db.staff = db.staff.filter((s) => s.id !== id);
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true });
  }

  if (p === '/api/marks' && method === 'GET') {
    const term = url.searchParams.get('term') || 'Term 1';
    let marks = db.marks.filter((m) => m.term === term);
    if (me.role === 'parent') {
      const parent = db.users.find((u) => u.id === me.id);
      marks = marks.filter((m) => (parent.childrenIds || []).includes(m.studentId));
    } else if (me.role === 'teacher') {
      const mine = new Set(TEACHER(me, db).classes || []);
      marks = marks.filter((m) => { const st = db.students.find((s) => s.id === m.studentId); return st && mine.has(st.class); });
    }
    return sendJSON(res, 200, marks);
  }
  if (p === '/api/marks' && method === 'POST') {
    if (!['admin', 'headteacher', 'teacher'].includes(me.role)) return sendJSON(res, 403, { error: 'Teachers only' });
    const { studentId, subject, term, assessment, score } = body;
    // Teachers may only record marks for learners in their own classes
    if (me.role === 'teacher') {
      const st = db.students.find((s) => s.id === studentId);
      const mine = new Set(TEACHER(me, db).classes || []);
      if (!st || !mine.has(st.class)) return sendJSON(res, 403, { error: 'You can only add marks for learners in your classes' });
    }
    const ex = db.marks.find((m) => m.studentId === studentId && m.subject === subject && m.term === term && (m.assessment || '') === (assessment || ''));
    if (ex) ex.score = Number(score);
    else db.marks.push({ studentId, subject, term, assessment: assessment || 'End of Term', score: Number(score) });
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/report' && method === 'GET') {
    const studentId = url.searchParams.get('studentId');
    const term = url.searchParams.get('term') || 'Term 1';
    const st = db.students.find((s) => s.id === studentId);
    if (!st) return sendJSON(res, 404, { error: 'Student not found' });
    // Teachers: own classes only. Parents: own children only.
    if (me.role === 'teacher' && !(TEACHER(me, db).classes || []).includes(st.class)) return sendJSON(res, 403, { error: 'Not your class' });
    if (me.role === 'parent' && !(TEACHER(me, db).childrenIds || []).includes(st.id)) return sendJSON(res, 403, { error: 'Not your child' });
    const marks = db.marks.filter((m) => m.studentId === studentId && m.term === term).map((m) => ({ ...m, grade: grade(m.score) }));
    const avg = marks.length ? Math.round(marks.reduce((a, m) => a + m.score, 0) / marks.length) : 0;
    return sendJSON(res, 200, { student: st, term, marks, average: avg, overallGrade: marks.length ? grade(avg) : '-' });
  }
  if (p === '/api/fees' && method === 'GET') return sendJSON(res, 200, db.fees);
  if (p === '/api/fees' && method === 'POST') {
    if (!['admin', 'bursar'].includes(me.role)) return sendJSON(res, 403, { error: 'Bursar only' });
    const f = { id: 'f-' + Date.now(), date: new Date().toISOString().slice(0, 10), receivedBy: me.name, ...body, amount: Number(body.amount) };
    db.fees.push(f); saveSchool(me.schoolId, db);
    return sendJSON(res, 200, f);
  }
  //__MORE_API2__
  if (p === '/api/attendance' && method === 'GET') {
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    return sendJSON(res, 200, db.attendance.filter((a) => a.date === date));
  }
  if (p === '/api/attendance' && method === 'POST') {
    if (!['admin', 'teacher'].includes(me.role)) return sendJSON(res, 403, { error: 'Not allowed' });
    const { date, type, records } = body;
    db.attendance = db.attendance.filter((a) => !(a.date === date && a.type === type));
    (records || []).forEach((r) => db.attendance.push({ date, type, personId: r.personId, status: r.status }));
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/timetable' && method === 'GET') return sendJSON(res, 200, db.timetable);
  if (p === '/api/timetable' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    db.timetable.push(body); saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/sms' && method === 'GET') return sendJSON(res, 200, db.smsLog);
  if (p === '/api/sms' && method === 'POST') {
    if (!['admin', 'teacher', 'bursar'].includes(me.role)) return sendJSON(res, 403, { error: 'Not allowed' });
    const { to, message, group } = body;
    let recipients = [to].filter(Boolean);
    if (group === 'all-parents') recipients = [...new Set(db.students.map((s) => s.parentPhone).filter(Boolean))];
    if (group === 'all-teachers') recipients = db.users.filter((u) => u.role === 'teacher').map((u) => u.phone).filter(Boolean);
    const sent = [];
    for (const r of recipients) sent.push(await sendSMS(r, message, me.name));
    return sendJSON(res, 200, { ok: true, sent });
  }
  if (p === '/api/settings' && method === 'GET') return sendJSON(res, 200, db.settings || {});
  if (p === '/api/settings' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    db.settings = { ...(db.settings || {}), ...body };
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, db.settings);
  }
  if (p === '/api/ldjs' && method === 'GET') {
    const term = url.searchParams.get('term') || 'Term 1';
    const assessment = url.searchParams.get('assessment') || '';
    const s = db.settings || { passMark: 50, classTarget: 60, flagTrigger: 0.3, bandExcellent: 80, bandGood: 65, bandWeak: 35 };
    const allClasses = [...new Set(db.students.map((x) => x.class))];
    // Teachers only get analysis for the classes they teach
    const classes0 = me.role === 'teacher' ? allClasses.filter((c) => (TEACHER(me, db).classes || []).includes(c)) : allClasses;
    const classes = classes0.map((c) => classSummary(db.students, db.marks, term, assessment, c, s));
    const flaggedClasses = classes.filter((c) => c.flag === 'Underperforming');
    const flaggedLearners = [];
    classes.forEach((c) => (c.learners || []).forEach((l) => {
      if (l.flag !== 'On track') flaggedLearners.push({ name: l.student.name, class: c.class, average: l.average, band: l.band, flag: l.flag });
    }));
    const trends = classes0.map((c) => trend(db.students, db.marks, c, assessment, s));
    return sendJSON(res, 200, { term, assessment, settings: s, classes, flaggedClasses, flaggedLearners, trends });
  }
  if (p === '/api/support' && method === 'GET') return sendJSON(res, 200, db.supportPlans || []);
  if (p === '/api/support' && method === 'POST') {
    if (!['admin', 'teacher'].includes(me.role)) return sendJSON(res, 403, { error: 'Not allowed' });
    const plan = { id: 'sp-' + Date.now(), status: 'Open', ...body };
    db.supportPlans = db.supportPlans || [];
    db.supportPlans.push(plan); saveSchool(me.schoolId, db);
    return sendJSON(res, 200, plan);
  }
  // ---- Excel import: preview then confirm (admin only) ----
  // Preview returns counts + first 20 rows; full data cached server-side by token for confirm.
  if (p === '/api/import-preview' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    try {
      const buf = Buffer.from(body.fileBase64 || '', 'base64');
      if (!buf.length || buf.slice(0, 2).toString() !== 'PK') return sendJSON(res, 400, { error: 'Not an .xlsx file. Please upload the .xlsx (not .csv/.pdf).' });
      const r = parseXlsx(buf);
      const tk = crypto.randomBytes(12).toString('hex');
      importCache.set(tk, { students: r.students, marks: r.marks, at: Date.now() });
      if (importCache.size > 20) importCache.delete([...importCache.keys()][0]);
      return sendJSON(res, 200, { ok: true, importToken: tk, students: r.students.slice(0, 20), marks: r.marks.slice(0, 20), totalStudents: r.students.length, totalMarks: r.marks.length, notes: r.notes });
    } catch (e) { return sendJSON(res, 400, { error: 'Could not read Excel: ' + e.message }); }
  }
  if (p === '/api/import-confirm' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    const cached = body.importToken ? importCache.get(body.importToken) : null;
    // If server restarted the token cache is gone â€” fall back to body payload, else fail loudly.
    const list = (cached && cached.students) || body.students || [];
    const mk = (cached && cached.marks) || body.marks || [];
    if (!list.length && body.importToken && !cached) return sendJSON(res, 400, { error: 'Import expired (server restarted). Please Preview again, then Confirm.' });
    let addedS = 0, addedM = 0;
    list.forEach((s) => {
      const ex = db.students.find((x) => x.name.toLowerCase() === String(s.name).toLowerCase() && x.class === s.class);
      if (!ex) { db.students.push({ id: 's-' + Date.now() + '-' + Math.floor(Math.random() * 99999), name: s.name, class: s.class, gender: s.gender || '', parent: s.parent || '', parentPhone: normPhone(s.parentPhone || ''), feesBilled: Number(s.feesBilled) || 0 }); addedS++; }
      else { ex.parent = s.parent || ex.parent; ex.parentPhone = normPhone(s.parentPhone || ex.parentPhone); if (s.feesBilled) ex.feesBilled = Number(s.feesBilled); }
    });
    mk.forEach((m) => {
      const st = db.students.find((x) => x.name.toLowerCase() === String(m.name).toLowerCase() && x.class === m.class);
      if (!st) return;
      const ex = db.marks.find((x) => x.studentId === st.id && x.subject === m.subject && x.term === m.term && (x.assessment || '') === (m.assessment || ''));
      if (ex) ex.score = Number(m.score);
      else db.marks.push({ studentId: st.id, subject: m.subject, term: m.term, assessment: m.assessment || 'End of Term', score: Number(m.score) });
      addedM++;
    });
    saveSchool(me.schoolId, db);

    if (body.importToken) importCache.delete(body.importToken);
    return sendJSON(res, 200, { ok: true, addedStudents: addedS, addedMarks: addedM, totalStudents: db.students.length });

  }
  // ---- Excel import: single POST upload endpoint (admin only) ----
  // Accepts the file from doPreview (base64 JSON or raw multipart), caches it server-side
  // by token, and returns the token + counts for the preview UI.
  if (p === '/api/import-upload' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    try {
      // Accept either { fileBase64: ... } from doPreview, or a raw JSON upload
      // NOTE: the request body was already parsed at the top of api()
      // (const body = ... await parseBody(req)). Do NOT parse it again
      // here; the stream events are already consumed and a second parse
      // would hang the request.
      let src = { students: [], marks: [], notes: [] };
      if (body.fileBase64) {
        const isCsv = typeof body.fileName === 'string' && body.fileName.toLowerCase().endsWith('.csv');
        src = isCsv
          ? parsePupilCsv(Buffer.from(body.fileBase64, 'base64').toString('utf8'))
          : parseXlsx(Buffer.from(body.fileBase64 || '', 'base64'));
      } else if (body.raw && typeof body.raw === 'string') {
        // Plain-text body: accept pupil CSV directly (the app's own template
        // is CSV: Name,Class,Parent,Phone,Fees,Gender) as well as JSON.
        src = parsePupilCsv(body.raw);
        try {
          const parsed = JSON.parse(body.raw);
          if (parsed.fileBase64) src = parseXlsx(Buffer.from(parsed.fileBase64, 'base64'));
        } catch {}
      }
      if (!src || !src.students || !src.marks) {
        return sendJSON(res, 400, { error: 'Could not read pupils/marks from the uploaded file. Use the pupil template (CSV) or an LDJS tracker .xlsx.' });
      }
      const tk = crypto.randomBytes(12).toString('hex');
      importCache.set(tk, { students: src.students, marks: src.marks, at: Date.now() });
      if (importCache.size > 20) importCache.delete([...importCache.keys()][0]);
      return sendJSON(res, 200, { ok: true, importToken: tk, students: src.students.slice(0, 20), marks: src.marks.slice(0, 20), totalStudents: src.students.length, totalMarks: src.marks.length, notes: src.notes });
    } catch (e) {
      return sendJSON(res, 400, { error: 'Could not read Excel: ' + e.message });
    }
  }


  // ---- SMS provider settings + test (admin only) ----
  // ---- SMS provider settings + test (admin only) ----
  if (p === '/api/sms-config' && method === 'GET') {
    if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const c = smsConfig(); c.atApiKey = c.atApiKey ? '***set***' : ''; c.twToken = c.twToken ? '***set***' : ''; c.gatewayKey = c.gatewayKey ? '***set***' : '';
    return sendJSON(res, 200, c);
  }
  if (p === '/api/sms-config' && method === 'POST') {
    if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    db.smsConfig = { ...(db.smsConfig || {}) };
    ['provider', 'atUsername', 'atSender', 'twSid', 'twFrom', 'gatewayUrl'].forEach((k) => { if (body[k] !== undefined) db.smsConfig[k] = body[k]; });
    if (body.atApiKey && body.atApiKey !== '***set***') db.smsConfig.atApiKey = body.atApiKey;
    if (body.twToken && body.twToken !== '***set***') db.smsConfig.twToken = body.twToken;
    if (body.gatewayKey && body.gatewayKey !== '***set***') db.smsConfig.gatewayKey = body.gatewayKey;
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/import-template' && method === 'GET') {
    // Minimal pupil-list template (CSV opens in Excel on phone or computer).
    const csv = 'Name,Class,Parent,Phone,Fees,Gender\nAisha Namono,Primary 4,Mr. Musa,0700123456,450000,F\nBrian Mwangi,Primary 5,Mrs. Njeri,0700123457,450000,M\n';
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=\"pupil-import-template.csv\"' });
    return res.end(csv);
  }
  if (p === '/api/sms-test' && method === 'POST') {
    if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const entry = await sendSMS(body.to, body.message || 'Test from Little Dreamers Junior School system ', me.name);
    return sendJSON(res, 200, { ok: entry.status.startsWith('sent'), entry });
  }
  // ---- Teachers on duty: rotates weekly (weeks start Monday) ----
  if (p === '/api/duty' && method === 'GET') {
    const ws = weekStart(new Date().toISOString().slice(0, 10));
    const nameOf = (id) => (db.users.find((u) => u.id === id) || {}).name || id;
    const now = (db.dutyRoster || []).find((r) => r.weekStart === ws);
    return sendJSON(res, 200, {
      weekStart: ws,
      onDuty: now ? now.teacherIds.map(nameOf) : [],
      roster: (db.dutyRoster || []).slice().sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)).map((r) => ({ weekStart: r.weekStart, teachers: r.teacherIds.map(nameOf) })),
      teachers: db.users.filter((u) => u.role === 'teacher').map((u) => ({ id: u.id, name: u.name }))
    });
  }
  if (p === '/api/duty' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    const ws = weekStart(body.weekStart || new Date().toISOString().slice(0, 10));
    const ids = Array.isArray(body.teacherIds) ? body.teacherIds : [];
    db.dutyRoster = db.dutyRoster || [];
    const i = db.dutyRoster.findIndex((r) => r.weekStart === ws);
    if (i >= 0) db.dutyRoster[i].teacherIds = ids; else db.dutyRoster.push({ weekStart: ws, teacherIds: ids });
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true });
  }

  // ---- Exam papers: teachers submit for head-teacher review ----
  if (p === '/api/papers' && method === 'GET') {
    const papers = (db.papers || []).slice().reverse();
    if (me.role === 'teacher') return sendJSON(res, 200, { papers: papers.filter((x) => x.teacherId === me.id) });
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Not allowed' });
    return sendJSON(res, 200, { papers });
  }
  if (p === '/api/papers' && method === 'POST') {
    if (me.role !== 'teacher' && !IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Teachers only' });
    if (!body.title) return sendJSON(res, 400, { error: 'Paper title required' });
    let fileId = null, fileName = '';
    if (body.fileBase64) {
      fileName = String(body.fileName || 'paper.bin').replace(/[^\w.\- ]/g, '_');
      fileId = 'f-' + crypto.randomBytes(6).toString('hex') + path.extname(fileName).slice(0, 8);
      fs.writeFileSync(path.join(UPLOADS_DIR, fileId), Buffer.from(body.fileBase64, 'base64'));
    }
    const paper = { id: 'p-' + crypto.randomBytes(4).toString('hex'), teacherId: me.id, teacherName: me.name, title: body.title, class: body.class || '', subject: body.subject || '', term: body.term || '', text: body.text || '', fileId, fileName, status: 'pending', feedback: '', at: new Date().toISOString() };
    db.papers = db.papers || [];
    db.papers.push(paper);
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true, paper });
  }
  if (p === '/api/papers/review' && method === 'POST') {
    if (!IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Admin or Head Teacher only' });
    const paper = (db.papers || []).find((x) => x.id === body.id);
    if (!paper) return sendJSON(res, 404, { error: 'Paper not found' });
    paper.status = body.status === 'approved' ? 'approved' : 'changes';
    paper.feedback = body.feedback || '';
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true, paper });
  }

  // ---- Classwork/homework: teachers upload; parents see their children's classes ----
  const kidsClasses = (uid) => {
    const u = db.users.find((x) => x.id === uid) || {};
    return new Set(db.students.filter((s) => (u.childrenIds || []).includes(s.id)).map((s) => s.class));
  };
  if (p === '/api/work' && method === 'GET') {
    const all = (db.work || []).slice().reverse();
    let list = all;
    if (me.role === 'teacher') {
      const mine = new Set(TEACHER(me, db).classes || []);
      list = all.filter((w) => mine.has(w.class));
    } else if (me.role === 'parent') {
      const kc = kidsClasses(me.id);
      list = all.filter((w) => kc.has(w.class));
    }
    return sendJSON(res, 200, { work: list });
  }
  if (p === '/api/work' && method === 'POST') {
    if (me.role !== 'teacher' && !IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Teachers only' });
    if (!body.title || !body.class) return sendJSON(res, 400, { error: 'Title and class are required' });
    let fileId = null, fileName = '';
    if (body.fileBase64) {
      fileName = String(body.fileName || 'work.bin').replace(/[^\w.\- ]/g, '_');
      fileId = 'f-' + crypto.randomBytes(6).toString('hex') + path.extname(fileName).slice(0, 8);
      fs.writeFileSync(path.join(UPLOADS_DIR, fileId), Buffer.from(body.fileBase64, 'base64'));
    }
    const w = { id: 'w-' + crypto.randomBytes(4).toString('hex'), teacherId: me.id, teacherName: me.name, class: body.class, subject: body.subject || '', title: body.title, body: body.body || '', dueDate: body.dueDate || '', fileId, fileName, at: new Date().toISOString() };
    db.work = db.work || [];
    db.work.push(w);
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true, work: w });
  }

  // ---- Concept videos: teachers record/upload; parents stream their classes ----
  if (p === '/api/videos' && method === 'GET') {
    const all = (db.videos || []).slice().reverse();
    let list = all;
    if (me.role === 'teacher') {
      const mine = new Set(TEACHER(me, db).classes || []);
      list = all.filter((v) => mine.has(v.class));
    } else if (me.role === 'parent') {
      const kc = kidsClasses(me.id);
      list = all.filter((v) => kc.has(v.class));
    }
    // Build ?token= links so <video src> can authenticate (no headers on media requests)
    let tk = url.searchParams.get('token') || '';
    if (!tk) { for (const [t, u] of sessions) { if (u && u.id === me.id && u.schoolId === me.schoolId) { tk = t; break; } } }
    return sendJSON(res, 200, { videos: list.map((v) => ({ ...v, url: '/api/files/' + v.fileId + '?token=' + tk })) });
  }
  if (p === '/api/videos' && method === 'POST') {
    if (me.role !== 'teacher' && !IS_ADMINISH(me)) return sendJSON(res, 403, { error: 'Teachers only' });
    if (!body.videoBase64) return sendJSON(res, 400, { error: 'No video received' });
    if (!body.title || !body.class) return sendJSON(res, 400, { error: 'Title and class are required' });
    const orig = String(body.fileName || 'lesson.webm');
    const ext = (path.extname(orig) || '.webm').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const fileId = 'v-' + crypto.randomBytes(6).toString('hex') + (['.webm', '.mp4'].includes(ext) ? ext : '.webm');
    fs.writeFileSync(path.join(UPLOADS_DIR, fileId), Buffer.from(body.videoBase64, 'base64'));
    const v = { id: 'v-' + crypto.randomBytes(4).toString('hex'), teacherId: me.id, teacherName: me.name, class: body.class, subject: body.subject || '', title: body.title, description: body.description || '', fileId, at: new Date().toISOString() };
    db.videos = db.videos || [];
    db.videos.push(v);
    saveSchool(me.schoolId, db);
    return sendJSON(res, 200, { ok: true, video: v });
  }

  // ---- Uploaded files (papers, work attachments, videos) ----
  if (p.startsWith('/api/files/') && method === 'GET') {
    const id = path.basename(p.split('/')[3] || '');
    const fp = path.join(UPLOADS_DIR, id);
    if (!id || !fs.existsSync(fp)) return sendJSON(res, 404, { error: 'File not found' });
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': fs.statSync(fp).size });
    return fs.createReadStream(fp).pipe(res);
  }

  return sendJSON(res, 404, { error: 'Not found' });
}

// ---- Superadmin: full control over school accounts (platform level) ----
async function superAdminApi(req, res, url, p, method) {
  const sys = loadSystem();

  if (p === '/api/users' && method === 'GET') {
    const sys = loadSystem();
    const allUsers = [];
    for (const sch of sys.schools) {
      if (sch.status !== 'active') continue;
      const db = loadSchool(sch.id);
      for (const u of db.users) {
        allUsers.push({ ...u, school: { id: sch.id, name: sch.name, email: sch.email } });
      }
    }
    return sendJSON(res, 200, { users: allUsers });
  }
if (p === '/api/schools' && method === 'GET') {
        const list = sys.schools.map((s) => {
      let students = 0, users = 0;
      try { const db = loadSchool(s.id); students = db.students.length; users = db.users.length; } catch {}
      return { ...s, password: undefined, students, users };
    });
    return sendJSON(res, 200, { schools: list, superAdmin: { email: sys.superAdmin.email, name: sys.superAdmin.name } });
  }
  if (p === '/api/schools' && method === 'POST') {
    const body = await parseBody(req);
    const { schoolName, email, password, phone, address, headName, headPassword } = body;
    if (!schoolName || !email || !password || !headName || !headPassword) return sendJSON(res, 400, { error: 'School name, email, password, head teacher name and password are all required' });
    if (sys.schools.find((s) => s.email === email)) return sendJSON(res, 400, { error: 'A school with that email already exists' });
    const id = 'sch-' + crypto.randomBytes(4).toString('hex');
    const sch = { id, name: schoolName, email, password, phone: phone || '', address: address || '', status: 'active', createdAt: new Date().toISOString() };
    sys.schools.push(sch);
    saveSystem(sys);
    const head = { id: 'u-ht', name: headName, email, password: headPassword, role: 'headteacher', phone: phone || '' };
    saveSchool(id, newSchoolDb(head));
    return sendJSON(res, 200, { ok: true, school: { ...sch, password: undefined } });
  }
  if (p.startsWith('/api/schools/') && method === 'PUT') {
    const id = p.split('/')[3];
    const sch = sys.schools.find((s) => s.id === id);
    if (!sch) return sendJSON(res, 404, { error: 'School not found' });
    const body = await parseBody(req);
    if (body.name) sch.name = body.name;
    if (body.phone !== undefined) sch.phone = body.phone;
    if (body.address !== undefined) sch.address = body.address;
    if (body.status && ['active', 'suspended'].includes(body.status)) sch.status = body.status;
    if (body.password) sch.password = body.password;
    if (body.resetHeadPassword) {
      const db = loadSchool(id);
      const ht = db.users.find((u) => u.role === 'headteacher');
      if (ht) { ht.password = body.resetHeadPassword; saveSchool(id, db); }
    }
    saveSystem(sys);
    return sendJSON(res, 200, { ok: true, school: { ...sch, password: undefined } });
  }
  if (p.startsWith('/api/schools/') && method === 'DELETE') {
    const id = p.split('/')[3];
    const idx = sys.schools.findIndex((s) => s.id === id);
    if (idx < 0) return sendJSON(res, 404, { error: 'School not found' });
    sys.schools.splice(idx, 1);
    saveSystem(sys);
    deleteSchoolData(id);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/users' && method === 'POST') {
    const body = await parseBody(req);
    const role = String(body.role || '').toLowerCase();
    const allowed = ['admin', 'headteacher', 'teacher', 'bursar', 'parent'];
    if (!allowed.includes(role)) return sendJSON(res, 403, { error: 'Invalid role' });
    if (!body.name || !body.email || !body.schoolId) return sendJSON(res, 400, { error: 'School ID, name and email are required' });
    const sch = sys.schools.find((x) => x.id === body.schoolId);
    if (!sch) return sendJSON(res, 404, { error: 'School not found' });
    const sdb = loadSchool(sch.id);
    if (sdb.users.some((u) => u.email === body.email)) return sendJSON(res, 400, { error: 'That email is already registered' });
    // Generate unique username + password automatically
    const base = body.username || 'user' + (sdb.users.length + 1);
    const username = base.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    let uname = username;
    let n = 2;
    while (sdb.users.some((u) => u.username === uname)) { uname = username + n++; }
    const pw = crypto.randomBytes(4).toString('hex');
    const u = { id: 'u-' + crypto.randomBytes(4).toString('hex'), name: body.name, email: body.email, username: uname, password: pw, role, phone: body.phone || '', schoolId: body.schoolId };
    sdb.users.push(u);
    saveSchool(sch.id, sdb);
    return sendJSON(res, 200, { ok: true, user: { id: u.id, name: u.name, email: u.email, username: u.username, role: u.role, password: u.password, phone: u.phone || '' } });
  }
  return sendJSON(res, 404, { error: 'Not found' });
}

function serveStatic(req, res) {
  let fp = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1));
  if (!fp.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res).catch((e) => sendJSON(res, 500, { error: e.message }));
  return serveStatic(req, res);
}).listen(PORT, () => console.log('School system live at http://localhost:' + PORT));
