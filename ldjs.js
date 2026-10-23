// LDJS Academic Performance Tracker logic (from the Excel tracker):
// Learner: Underperforming = avg < passMark. Watch = avg >= passMark but 2+ subjects < passMark. Else On track.
// Band: Excellent/Good/Satisfactory/Weak/Very weak from Settings thresholds.
// Class: Underperforming = class avg < passMark OR share below pass >= trigger. Below target = avg in [passMark, classTarget). Else On track.
function learnerAnalysis(scores, s) {
  const vals = scores.filter((x) => x != null && !isNaN(x));
  if (!vals.length) return { average: null, belowCount: 0, band: '-', flag: 'No scores', check: 'No scores' };
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10;
  const below = vals.filter((v) => v < s.passMark).length;
  let band = 'Very weak';
  if (avg >= s.bandExcellent) band = 'Excellent';
  else if (avg >= s.bandGood) band = 'Good';
  else if (avg >= s.passMark) band = 'Satisfactory';
  else if (avg >= s.bandWeak) band = 'Weak';
  let flag = 'On track';
  if (avg < s.passMark) flag = 'Underperforming';
  else if (below >= 2) flag = 'Watch';
  return { average: avg, belowCount: below, band, flag, check: 'OK' };
}

function classSummary(students, marks, term, assessment, cls, s) {
  const inClass = students.filter((x) => x.class === cls);
  const rows = inClass.map((st) => {
    const sc = marks.filter((m) => m.studentId === st.id && m.term === term && (!assessment || !m.assessment || m.assessment === assessment)).map((m) => m.score);
    return { student: st, ...learnerAnalysis(sc, s) };
  }).filter((r) => r.average != null);
  if (!rows.length) return { class: cls, count: inClass.length, withScores: 0, average: null, shareBelow: null, flag: 'No data', weakestSubject: '-' };
  const avg = Math.round(rows.reduce((a, r) => a + r.average, 0) / rows.length * 10) / 10;
  const belowLearners = rows.filter((r) => r.average < s.passMark).length;
  const share = Math.round(belowLearners / rows.length * 1000) / 10;
  let flag = 'On track';
  if (avg < s.passMark || (share / 100) >= s.flagTrigger) flag = 'Underperforming';
  else if (avg < s.classTarget) flag = 'Below target';
  // weakest subject
  const bySub = {};
  marks.filter((m) => m.term === term && (!assessment || !m.assessment || m.assessment === assessment)).forEach((m) => {
    const st = students.find((x) => x.id === m.studentId);
    if (!st || st.class !== cls) return;
    bySub[m.subject] = bySub[m.subject] || { t: 0, n: 0 };
    bySub[m.subject].t += m.score; bySub[m.subject].n++;
  });
  let weakest = '-';
  let min = Infinity;
  Object.entries(bySub).forEach(([sub, v]) => {
    const a = v.t / v.n;
    if (a < min) { min = a; weakest = sub + ' (' + Math.round(a) + '%)'; }
  });
  return { class: cls, count: inClass.length, withScores: rows.length, average: avg, shareBelow: share, belowLearners, flag, weakestSubject: weakest, learners: rows };
}

function trend(students, marks, cls, assessment, s) {
  const terms = ['Term 1', 'Term 2', 'Term 3'];
  const avgs = terms.map((t) => classSummary(students, marks, t, assessment, cls, s).average);
  let direction = '-';
  const a = avgs.filter((x) => x != null);
  if (a.length >= 2) direction = a[a.length - 1] > a[0] ? 'Improved' : (a[a.length - 1] < a[0] ? 'Declined' : 'Stable');
  return { class: cls, avgs, direction };
}

module.exports = { learnerAnalysis, classSummary, trend };
