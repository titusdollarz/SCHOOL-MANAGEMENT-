const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json'); // legacy single-school file (kept for old utilities)
const SYSTEM_FILE = path.join(DATA_DIR, 'system.json');
const SCHOOLS_DIR = path.join(DATA_DIR, 'schools');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCHOOLS_DIR)) fs.mkdirSync(SCHOOLS_DIR, { recursive: true });

// Monday of the week containing date d (YYYY-MM-DD)
function weekStart(d) {
  const x = new Date(d + 'T00:00:00');
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return x.toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const x = new Date(ymd + 'T00:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}

const seed = () => {
  const thisMon = weekStart(new Date().toISOString().slice(0, 10));
  const nextMon = addDays(thisMon, 7);
  const nextNextMon = addDays(thisMon, 14);
  return {
  users: [
    { id: 'u-admin', name: 'School Admin', email: 'admin@school.com', password: 'admin123', role: 'admin', phone: '+256700000001' },
    { id: 'u-ht', name: 'Mrs. Nakato (Head Teacher)', email: 'ht@school.com', password: 'head123', role: 'headteacher', phone: '+256700000010' },
    { id: 'u-teach1', name: 'Ms. Amina', email: 'teacher@school.com', password: 'teach123', role: 'teacher', phone: '+256700000002', subjects: ['Mathematics', 'English'], classes: ['Primary 5', 'Primary 6'] },
    { id: 'u-teach2', name: 'Mr. Ssemakula', email: 'teacher2@school.com', password: 'teach123', role: 'teacher', phone: '+256700000011', subjects: ['Integrated Science', 'Mathematics'], classes: ['Primary 4', 'Primary 2'] },
    { id: 'u-bursar', name: 'Mr. Okello', email: 'bursar@school.com', password: 'bursar123', role: 'bursar', phone: '+256700000003' },
    { id: 'u-parent1', name: 'Mrs. Njeri (Parent)', email: 'parent@school.com', password: 'parent123', role: 'parent', phone: '+256700000004', childrenIds: ['s-001', 's-002'] }
  ],
  students: [
    { id: 's-001', name: 'Brian Mwangi', class: 'Primary 5', gender: 'M', parent: 'Mrs. Njeri', parentPhone: '+256700000004', feesBilled: 450000, dob: '2014-03-02' },
    { id: 's-002', name: 'Faith Achieng', class: 'Primary 5', gender: 'F', parent: 'Mrs. Njeri', parentPhone: '+256700000004', feesBilled: 450000, dob: '2014-07-11' },
    { id: 's-003', name: 'John Kato', class: 'Primary 6', gender: 'M', parent: 'Mr. Ssemakula', parentPhone: '+256700000005', feesBilled: 480000, dob: '2013-01-20' },
    { id: 's-004', name: 'Sarah Nabirye', class: 'Primary 6', gender: 'F', parent: 'Ms. Namono', parentPhone: '+256700000006', feesBilled: 480000, dob: '2013-05-30' },
    { id: 's-005', name: 'Aisha N.', class: 'Primary 4', gender: 'F', parent: 'Mr. Musa', parentPhone: '+256700000007', feesBilled: 450000, dob: '2015-02-10' },
    { id: 's-006', name: 'Peter L.', class: 'Primary 2', gender: 'M', parent: 'Ms. Rose', parentPhone: '+256700000008', feesBilled: 400000, dob: '2017-06-01' },
    { id: 's-007', name: 'Grace K.', class: 'Top', gender: 'F', parent: 'Mrs. Atim', parentPhone: '+256700000009', feesBilled: 350000, dob: '2019-09-09' }
  ],
  staff: [
    { id: 'u-teach1', name: 'Ms. Amina', role: 'Teacher', phone: '+256700000002' },
    { id: 'u-teach2', name: 'Mr. Ssemakula', role: 'Teacher', phone: '+256700000011' },
    { id: 'u-bursar', name: 'Mr. Okello', role: 'Bursar', phone: '+256700000003' }
  ],
  marks: [
    { studentId: 's-001', subject: 'Mathematics', term: 'Term 1', assessment: 'End of Term', score: 82 },
    { studentId: 's-001', subject: 'English', term: 'Term 1', assessment: 'End of Term', score: 76 },
    { studentId: 's-001', subject: 'Integrated Science', term: 'Term 1', assessment: 'End of Term', score: 69 },
    { studentId: 's-001', subject: 'Social Studies', term: 'Term 1', assessment: 'End of Term', score: 71 },
    { studentId: 's-001', subject: 'Religious Education', term: 'Term 1', assessment: 'End of Term', score: 80 },
    { studentId: 's-002', subject: 'Mathematics', term: 'Term 1', assessment: 'End of Term', score: 91 },
    { studentId: 's-002', subject: 'English', term: 'Term 1', assessment: 'End of Term', score: 88 },
    { studentId: 's-003', subject: 'Mathematics', term: 'Term 1', assessment: 'End of Term', score: 48 },
    { studentId: 's-003', subject: 'English', term: 'Term 1', assessment: 'End of Term', score: 44 },
    { studentId: 's-004', subject: 'Mathematics', term: 'Term 1', assessment: 'End of Term', score: 74 },
    { studentId: 's-005', subject: 'English', term: 'Term 1', assessment: 'End of Term', score: 72 },
    { studentId: 's-005', subject: 'Mathematics', term: 'Term 1', assessment: 'End of Term', score: 48 },
    { studentId: 's-005', subject: 'Integrated Science', term: 'Term 1', assessment: 'End of Term', score: 55 },
    { studentId: 's-005', subject: 'Social Studies', term: 'Term 1', assessment: 'End of Term', score: 61 },
    { studentId: 's-005', subject: 'Religious Education', term: 'Term 1', assessment: 'End of Term', score: 70 },
    { studentId: 's-006', subject: 'Mathematics', term: 'Term 1', assessment: 'End of Term', score: 66 },
    { studentId: 's-006', subject: 'English', term: 'Term 1', assessment: 'End of Term', score: 58 },
    { studentId: 's-007', subject: 'Numeracy', term: 'Term 1', assessment: 'End of Term', score: 84 },
    { studentId: 's-007', subject: 'Reading', term: 'Term 1', assessment: 'End of Term', score: 79 }
  ],
  fees: [
    { id: 'f-1', studentId: 's-001', amount: 200000, date: '2026-01-15', method: 'Mobile Money', receivedBy: 'Mr. Okello' },
    { id: 'f-2', studentId: 's-002', amount: 450000, date: '2026-01-20', method: 'Bank', receivedBy: 'Mr. Okello' }
  ],
  attendance: [
    { date: '2026-10-14', type: 'student', personId: 's-001', status: 'present' },
    { date: '2026-10-14', type: 'student', personId: 's-002', status: 'present' },
    { date: '2026-10-14', type: 'staff', personId: 'u-teach1', status: 'present' }
  ],
  timetable: [
    { class: 'P5', day: 'Monday', period: '08:00-09:00', subject: 'Mathematics', teacher: 'Ms. Amina' },
    { class: 'P5', day: 'Monday', period: '09:00-10:00', subject: 'English', teacher: 'Ms. Amina' },
    { class: 'P6', day: 'Monday', period: '08:00-09:00', subject: 'Mathematics', teacher: 'Ms. Amina' }
  ],
  // Teachers on duty rotate weekly (weeks start Monday)
  dutyRoster: [
    { weekStart: thisMon, teacherIds: ['u-teach1'] },
    { weekStart: nextMon, teacherIds: ['u-teach2'] },
    { weekStart: nextNextMon, teacherIds: ['u-teach1', 'u-teach2'] }
  ],
  // Exam papers awaiting head-teacher review
  papers: [
    { id: 'p-1', teacherId: 'u-teach1', teacherName: 'Ms. Amina', title: 'P5 Mathematics End of Term', class: 'Primary 5', subject: 'Mathematics', term: 'Term 1', text: '1. Simplify: 3a + 2a - a.\n2. Find x: 2x + 4 = 12.\n3. Word problem about pens in boxes.', fileId: null, fileName: '', status: 'pending', feedback: '', at: new Date().toISOString() },
    { id: 'p-2', teacherId: 'u-teach2', teacherName: 'Mr. Ssemakula', title: 'P4 Science Mid-Term', class: 'Primary 4', subject: 'Integrated Science', term: 'Term 1', text: '1. Name three parts of a plant.\n2. Why do plants need water?', fileId: null, fileName: '', status: 'approved', feedback: 'Good coverage, proceed.', at: new Date().toISOString() }
  ],
  // Classwork / homework uploaded for learners + parents
  work: [
    { id: 'w-1', teacherId: 'u-teach1', teacherName: 'Ms. Amina', class: 'Primary 5', subject: 'Mathematics', title: 'Holiday Maths Package', body: 'Do exercises 1-10 on page 34 of the Maths book. Show all working.', dueDate: '', fileId: null, fileName: '', at: new Date().toISOString() }
  ],
  // Concept videos recorded/uploaded by teachers for home learning
  videos: [],
  smsLog: [],
  smsConfig: { provider: 'mock', atUsername: 'sandbox', atApiKey: '', atSender: '', twSid: '', twToken: '', twFrom: '', gatewayUrl: '', gatewayKey: '' },
  settings: {
    passMark: 50, classTarget: 60, flagTrigger: 0.3,
    bandExcellent: 80, bandGood: 65, bandWeak: 35,
    terms: ['Term 1', 'Term 2', 'Term 3'],
    assessments: ['Beginning of Term', 'Mid-Term', 'End of Term'],
    sections: {
      upper: { classes: ['Primary 4', 'Primary 5', 'Primary 6', 'Primary 7'], subjects: ['English', 'Mathematics', 'Integrated Science', 'Social Studies', 'Religious Education'] },
      lower: { classes: ['Primary 1', 'Primary 2', 'Primary 3'], subjects: ['Mathematics', 'English', 'Literacy B', 'Literacy A', 'Reading', 'CRE'] },
      nursery: { classes: ['Baby', 'Middle', 'Top'], subjects: ['Numeracy', 'Reading', 'English', 'Health Habits', 'Social Development'] }
    }
  },
  supportPlans: []
  };
};

// Fill fields added in later versions onto older db.json files (no wipe)
function migrate(db) {
  const ensure = (k, v) => { if (db[k] === undefined) db[k] = v; };
  ensure('dutyRoster', []);
  ensure('papers', []);
  ensure('work', []);
  ensure('videos', []);
  db.users.forEach((u) => { if (u.role === 'teacher' && u.classes === undefined) u.classes = []; });
  return db;
}

function load() {
  if (!fs.existsSync(DB_FILE)) {
    const d = seed();
    fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
    return d;
  }
  try {
    return migrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {
    const d = seed();
    fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
    return d;
  }
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---- Multi-tenant: platform registry + per-school databases ----
const SUPER_SEED = { id: 'root', name: 'Platform Admin', email: 'system@school.com', password: 'system123', role: 'superadmin' };

// Fresh (empty) database for a newly created school, seeded with the head-teacher account + default settings
function newSchoolDb(headUser) {
  const base = seed();
  return {
    users: [headUser],
    students: [], staff: [], marks: [], fees: [], attendance: [], timetable: [],
    dutyRoster: [], papers: [], work: [], videos: [], smsLog: [],
    smsConfig: base.smsConfig, settings: base.settings, supportPlans: []
  };
}

function loadSystem() {
  if (!fs.existsSync(SYSTEM_FILE)) {
    const sys = { superAdmin: SUPER_SEED, schools: [] };
    // Migrate a legacy single-school db.json into the first school so nothing is lost
    if (fs.existsSync(DB_FILE)) {
      try {
        const legacy = migrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
        const sch = { id: 'sch-001', name: 'Little Dreamers Junior School', email: 'admin@school.com', password: 'admin123', phone: '+256700000000', address: '', status: 'active', createdAt: new Date().toISOString() };
        sys.schools.push(sch);
        saveSchool(sch.id, legacy);
        fs.renameSync(DB_FILE, DB_FILE + '.migrated');
      } catch {}
    }
    fs.writeFileSync(SYSTEM_FILE, JSON.stringify(sys, null, 2));
    return sys;
  }
  try { return JSON.parse(fs.readFileSync(SYSTEM_FILE, 'utf8')); }
  catch { const s = { superAdmin: SUPER_SEED, schools: [] }; fs.writeFileSync(SYSTEM_FILE, JSON.stringify(s, null, 2)); return s; }
}
function saveSystem(sys) { fs.writeFileSync(SYSTEM_FILE, JSON.stringify(sys, null, 2)); }

function schoolFile(id) { return path.join(SCHOOLS_DIR, id + '.json'); }
function loadSchool(id) {
  const f = schoolFile(id);
  if (!fs.existsSync(f)) return migrate(seed());
  try { return migrate(JSON.parse(fs.readFileSync(f, 'utf8'))); }
  catch { return migrate(seed()); }
}
function saveSchool(id, db) { fs.writeFileSync(schoolFile(id), JSON.stringify(db, null, 2)); }
function deleteSchoolData(id) { const f = schoolFile(id); if (fs.existsSync(f)) fs.unlinkSync(f); }

// Find a user by email+password across all active schools (used at login)
function findUserEverywhere(email, password) {
  const sys = loadSystem();
  for (const sch of sys.schools) {
    if (sch.status !== 'active') continue;
    const db = loadSchool(sch.id);
    const u = db.users.find((x) => x.email === email && x.password === password);
    if (u) return { user: u, school: sch };
  }
  return null;
}

module.exports = { load, save, loadSystem, saveSystem, loadSchool, saveSchool, schoolFile, deleteSchoolData, newSchoolDb, findUserEverywhere, DB_FILE, SYSTEM_FILE, SCHOOLS_DIR, DATA_DIR, UPLOADS_DIR, weekStart };
