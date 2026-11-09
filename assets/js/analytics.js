/**
 * AttendSmart AI — analytics engine.
 *
 * Pure functions over the local dataset: percentages, risk banding, monthly
 * trend, weekday/slot performance, absentee ranking and flags. The dashboards
 * only render what comes out of here, so every number on screen is traceable
 * to attendance records.
 */

import { DAY_SHORT } from './data.js';

export function round1(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}

export function pctOf(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** 70% is the exam-eligibility threshold in the brief. */
export function riskFor(value) {
  if (value < 70) return { level: 'high', label: 'At risk', tone: 'red', pill: 'pill-red' };
  if (value < 80) return { level: 'medium', label: 'Watchlist', tone: 'amber', pill: 'pill-amber' };
  return { level: 'low', label: 'On track', tone: 'green', pill: 'pill-green' };
}

function byStartAsc(a, b) {
  return new Date(a.startedAt) - new Date(b.startedAt);
}

function byStartDesc(a, b) {
  return new Date(b.startedAt) - new Date(a.startedAt);
}

function indexBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function summarise(course, total, recs) {
  const late = recs.filter((r) => r.status === 'late').length;
  const value = pctOf(recs.length, total);
  const last = recs.slice().sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt))[0] || null;
  return {
    course,
    total,
    attended: recs.length,
    late,
    onTime: recs.length - late,
    missed: Math.max(0, total - recs.length),
    pct: value,
    risk: riskFor(value),
    last
  };
}

export function studentCourseStats(db, studentId, courseId) {
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return null;
  // A session that is still running must not count as a missed class.
  const total = db.sessions.filter((s) => s.courseId === courseId && s.status !== 'active').length;
  const recs = db.attendance.filter((a) => a.studentId === studentId && a.courseId === courseId);
  return summarise(course, total, recs);
}

export function studentOverview(db, studentId) {
  const courses = db.courses.filter((c) => c.studentIds.includes(studentId));
  const rows = courses.map((c) => studentCourseStats(db, studentId, c.id)).filter(Boolean);
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const attended = rows.reduce((sum, r) => sum + r.attended, 0);
  const late = rows.reduce((sum, r) => sum + r.late, 0);
  const pct = pctOf(attended, total);

  const recent = db.attendance
    .filter((a) => a.studentId === studentId)
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt))
    .slice(0, 8)
    .map((a) => ({
      ...a,
      course: db.courses.find((c) => c.id === a.courseId),
      session: db.sessions.find((s) => s.id === a.sessionId)
    }));

  const active = db.sessions
    .filter((s) => s.status === 'active' && courses.some((c) => c.id === s.courseId))
    .map((s) => ({ session: s, course: db.courses.find((c) => c.id === s.courseId) }));

  return {
    courses: rows,
    total,
    attended,
    late,
    missed: Math.max(0, total - attended),
    pct,
    risk: riskFor(pct),
    recent,
    active,
    atRisk: rows.filter((r) => r.pct < 70).sort((a, b) => a.pct - b.pct),
    weakest: rows.slice().sort((a, b) => a.pct - b.pct)[0] || null
  };
}

function monthSeries(sessions, bySession, enrolled) {
  const groups = new Map();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) {
      groups.set(key, { label: d.toLocaleDateString('en-GB', { month: 'short' }), total: 0, count: 0 });
    }
    const g = groups.get(key);
    g.total += pctOf((bySession.get(s.id) || []).length, enrolled);
    g.count += 1;
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, g]) => ({ label: g.label, value: round1(g.total / (g.count || 1)) }));
}

export function courseAnalytics(db, courseId) {
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return null;

  const enrolled = course.studentIds.length;
  const sessions = db.sessions.filter((s) => s.courseId === courseId && s.status !== 'active').sort(byStartAsc);
  const records = db.attendance.filter((a) => a.courseId === courseId);
  const bySession = indexBy(records, (r) => r.sessionId);
  const byStudent = indexBy(records, (r) => r.studentId);

  const perStudent = course.studentIds.map((id) => {
    const student = db.students.find((s) => s.id === id);
    const recs = byStudent.get(id) || [];
    const late = recs.filter((r) => r.status === 'late').length;
    const value = pctOf(recs.length, sessions.length);
    return {
      student,
      attended: recs.length,
      late,
      total: sessions.length,
      missed: Math.max(0, sessions.length - recs.length),
      pct: value,
      risk: riskFor(value)
    };
  });

  const bucketOf = (p) => (p < 50 ? '0–49' : p < 70 ? '50–69' : p < 80 ? '70–79' : p < 90 ? '80–89' : '90–100');
  const order = ['0–49', '50–69', '70–79', '80–89', '90–100'];
  const distribution = order.map((label) => ({
    label,
    count: perStudent.filter((s) => bucketOf(s.pct) === label).length
  }));

  const recentSessions = sessions
    .slice(-6)
    .reverse()
    .map((s) => {
      const recs = bySession.get(s.id) || [];
      return {
        session: s,
        present: recs.filter((r) => r.status === 'present').length,
        late: recs.filter((r) => r.status === 'late').length,
        absent: Math.max(0, enrolled - recs.length),
        rate: pctOf(recs.length, enrolled)
      };
    });

  const avgPct = perStudent.length ? perStudent.reduce((sum, s) => sum + s.pct, 0) / perStudent.length : 0;

  return {
    course,
    lecturer: db.lecturers.find((l) => l.id === course.lecturerId) || null,
    enrolled,
    sessionCount: sessions.length,
    avgPct,
    perStudent,
    distribution,
    trend: monthSeries(sessions, bySession, enrolled),
    recentSessions,
    atRisk: perStudent.filter((s) => s.pct < 70).sort((a, b) => a.pct - b.pct),
    topAbsent: perStudent.slice().sort((a, b) => b.missed - a.missed || a.pct - b.pct).slice(0, 10),
    live: db.sessions.find((s) => s.courseId === courseId && s.status === 'active') || null,
    lastSession: sessions[sessions.length - 1] || null
  };
}

export function universityAnalytics(db) {
  const analyses = db.courses.map((c) => courseAnalytics(db, c.id)).filter(Boolean);
  const avgPct = analyses.length ? analyses.reduce((sum, a) => sum + a.avgPct, 0) / analyses.length : 0;

  const flagged = new Set();
  for (const a of analyses) for (const row of a.atRisk) flagged.add(row.student.id);

  const courses = analyses.map((a) => ({
    course: a.course,
    lecturer: a.lecturer,
    enrolled: a.enrolled,
    avgPct: a.avgPct,
    atRisk: a.atRisk.length,
    sessions: a.sessionCount,
    live: a.live
  }));

  const bySession = indexBy(db.attendance, (r) => r.sessionId);
  const coursesById = new Map(db.courses.map((c) => [c.id, c]));

  const monthGroups = new Map();
  const dayGroups = new Map();
  const slotGroups = new Map();

  const completedSessions = db.sessions.filter((s) => s.status !== 'active');
  for (const s of completedSessions) {
    const course = coursesById.get(s.courseId);
    if (!course) continue;
    const rate = pctOf((bySession.get(s.id) || []).length, course.studentIds.length);
    const d = new Date(s.startedAt);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    if (!monthGroups.has(monthKey)) {
      monthGroups.set(monthKey, { label: d.toLocaleDateString('en-GB', { month: 'short' }), total: 0, count: 0 });
    }
    const mg = monthGroups.get(monthKey);
    mg.total += rate;
    mg.count += 1;

    const weekday = d.getDay();
    if (!dayGroups.has(weekday)) dayGroups.set(weekday, { label: DAY_SHORT[weekday], total: 0, count: 0 });
    const dg = dayGroups.get(weekday);
    dg.total += rate;
    dg.count += 1;

    const slotLabel = `${DAY_SHORT[course.day]} ${course.start}`;
    if (!slotGroups.has(slotLabel)) slotGroups.set(slotLabel, { label: slotLabel, total: 0, count: 0 });
    const sg = slotGroups.get(slotLabel);
    sg.total += rate;
    sg.count += 1;
  }

  const trend = [...monthGroups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, g]) => ({ label: g.label, value: round1(g.total / (g.count || 1)) }));

  const weekday = [1, 2, 3, 4, 5].map((d) => {
    const g = dayGroups.get(d);
    return { label: DAY_SHORT[d], value: g ? round1(g.total / g.count) : 0 };
  });

  const slots = [...slotGroups.values()]
    .map((g) => ({ label: g.label, value: round1(g.total / g.count), sessions: g.count }))
    .sort((a, b) => b.value - a.value);

  const recentSessions = db.sessions
    .slice()
    .sort(byStartDesc)
    .slice(0, 8)
    .map((s) => {
      const course = coursesById.get(s.courseId);
      const recs = (bySession.get(s.id) || []).length;
      return {
        session: s,
        course,
        lecturer: db.lecturers.find((l) => l.id === s.lecturerId) || null,
        attended: recs,
        enrolled: course ? course.studentIds.length : 0,
        rate: course ? pctOf(recs, course.studentIds.length) : 0
      };
    });

  return {
    totals: {
      students: db.students.length,
      lecturers: db.lecturers.length,
      courses: db.courses.length,
      sessions: db.sessions.length,
      records: db.attendance.length
    },
    avgPct,
    flaggedCount: flagged.size,
    courses,
    trend,
    weekday,
    slots,
    bestSlot: slots[0] || null,
    worstSlot: slots[slots.length - 1] || null,
    recentSessions
  };
}

/** Every (student, course) pair under 70% — the advisor worklist. */
export function riskRows(db) {
  const rows = [];
  for (const course of db.courses) {
    const sessions = db.sessions.filter((s) => s.courseId === course.id && s.status !== 'active');
    const records = db.attendance.filter((a) => a.courseId === course.id);
    const byStudent = indexBy(records, (r) => r.studentId);

    for (const studentId of course.studentIds) {
      const recs = byStudent.get(studentId) || [];
      const value = pctOf(recs.length, sessions.length);
      if (value >= 70) continue;
      const student = db.students.find((s) => s.id === studentId);
      if (!student) continue;
      rows.push({
        student,
        course,
        pct: value,
        attended: recs.length,
        total: sessions.length,
        missed: Math.max(0, sessions.length - recs.length),
        late: recs.filter((r) => r.status === 'late').length,
        risk: riskFor(value)
      });
    }
  }
  return rows.sort((a, b) => a.pct - b.pct);
}

export function courseSlot(course) {
  return `${DAY_SHORT[course.day]} ${course.start}–${course.end}`;
}

export function nextClassOccurrence(course, from = new Date()) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    if (d.getDay() !== course.day) continue;
    const [h, m] = course.start.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > from.getTime()) return d;
  }
  return null;
}

export function upcomingClasses(db, studentId, limit = 3) {
  return db.courses
    .filter((c) => c.studentIds.includes(studentId))
    .map((c) => ({ course: c, at: nextClassOccurrence(c) }))
    .filter((x) => x.at)
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
}

export function studentNotifications(db, studentId) {
  const overview = studentOverview(db, studentId);
  const notes = [];

  for (const row of overview.atRisk) {
    notes.push({
      tone: 'red',
      title: `${row.course.code} below the 70% threshold`,
      body: `You are at ${round1(row.pct)}% in ${row.course.name}. ${row.missed} missed session${row.missed === 1 ? '' : 's'} — you risk losing exam eligibility.`
    });
  }

  for (const row of overview.courses.filter((r) => r.pct >= 70 && r.pct < 80)) {
    notes.push({
      tone: 'amber',
      title: `${row.course.code} is slipping`,
      body: `${round1(row.pct)}% attendance. Two or three more sessions keeps you clear of the 70% line.`
    });
  }

  for (const a of overview.active) {
    notes.push({
      tone: 'green',
      title: `Attendance is open: ${a.course.code}`,
      body: `A session is live now in ${a.course.name}. Open Check in, enter the code and verify your GPS.`
    });
  }

  const upcoming = upcomingClasses(db, studentId, 1)[0];
  if (upcoming) {
    notes.push({
      tone: 'brand',
      title: `Next class: ${upcoming.course.code}`,
      body: `${upcoming.course.name} · ${upcoming.at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} at ${upcoming.course.start}.`
    });
  }

  if (!notes.length) {
    notes.push({
      tone: 'green',
      title: 'Attendance looks healthy',
      body: 'You are above 80% in every registered course. Keep it up.'
    });
  }

  return notes.slice(0, 5);
}
