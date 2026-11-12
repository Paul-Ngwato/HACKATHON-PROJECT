/**
 * CLASSPREF3CT AI — semester seed.
 *
 * Pure data generation, shared by the first server boot and the admin reset.
 * No browser APIs: this runs inside the Node/SQLite backend only.
 */
'use strict';

const VERSION = 3;
const LATE_GRACE_MIN = 5;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const HALLS = [
  { id: 'hall-a', name: 'Lecture Hall A', building: 'Main Campus', lat: -0.157, lng: 35.269, radius: 50 },
  { id: 'hall-b', name: 'Lecture Hall B', building: 'Main Campus', lat: -0.1562, lng: 35.2694, radius: 50 },
  { id: 'lab-3', name: 'Computer Lab 3', building: 'ICT Block', lat: -0.1578, lng: 35.2684, radius: 40 },
  { id: 'aud', name: 'University Auditorium', building: 'Main Campus', lat: -0.1565, lng: 35.2702, radius: 75 }
];

const LECTURERS = [
  { id: 'l1', name: 'Dr. Peter Mwangi', email: 'p.mwangi@baraton.ac.ke', department: 'Computing & IT', title: 'Senior Lecturer' },
  { id: 'l2', name: 'Dr. Grace Chebet', email: 'g.chebet@baraton.ac.ke', department: 'Computing & IT', title: 'Lecturer' },
  { id: 'l3', name: 'Mr. Samuel Kiptoo', email: 's.kiptoo@baraton.ac.ke', department: 'Computing & IT', title: 'Lecturer' },
  { id: 'l4', name: 'Dr. Alice Wanjiru', email: 'a.wanjiru@baraton.ac.ke', department: 'Business & Economics', title: 'Senior Lecturer' }
];

const COURSES = [
  { id: 'c1', code: 'DBM411', name: 'Database Systems', department: 'Computing & IT', lecturerId: 'l1', day: 1, start: '08:00', end: '10:00', hallId: 'hall-a', credits: 3, semester: 'Semester 2' },
  { id: 'c2', code: 'DBM412', name: 'Data Mining & Analytics', department: 'Computing & IT', lecturerId: 'l2', day: 3, start: '10:00', end: '12:00', hallId: 'hall-b', credits: 3, semester: 'Semester 2' },
  { id: 'c3', code: 'BIT403', name: 'Computer Networks', department: 'Computing & IT', lecturerId: 'l3', day: 2, start: '14:00', end: '16:00', hallId: 'lab-3', credits: 4, semester: 'Semester 2' },
  { id: 'c4', code: 'SCS401', name: 'Software Engineering', department: 'Computing & IT', lecturerId: 'l4', day: 4, start: '09:00', end: '11:00', hallId: 'hall-a', credits: 3, semester: 'Semester 2' },
  { id: 'c5', code: 'DBM415', name: 'Business Intelligence', department: 'Business & Economics', lecturerId: 'l2', day: 5, start: '11:00', end: '13:00', hallId: 'aud', credits: 3, semester: 'Semester 2' },
  { id: 'c6', code: 'BIT405', name: 'Cybersecurity Fundamentals', department: 'Computing & IT', lecturerId: 'l3', day: 1, start: '16:00', end: '18:00', hallId: 'hall-b', credits: 3, semester: 'Semester 2' },
  { id: 'c7', code: 'BBIT500', name: 'Web Development', department: 'Computing & IT', lecturerId: 'l1', day: 2, start: '09:00', end: '11:00', hallId: 'lab-3', credits: 3, semester: 'Semester 2', room: 'C3' },
  { id: 'c8', code: 'BBIT312', name: 'Computer Networking', department: 'Computing & IT', lecturerId: 'l1', day: 4, start: '14:00', end: '16:00', hallId: 'hall-b', credits: 3, semester: 'Semester 2', room: 'B2' }
];

const FIRST_NAMES = [
  'John', 'Mary', 'Brian', 'Faith', 'Kevin', 'Mercy', 'Dennis', 'Cynthia', 'Victor', 'Joyce',
  'Collins', 'Naomi', 'Elijah', 'Esther', 'George', 'Linet', 'Samuel', 'Purity', 'Anthony', 'Grace',
  'Ibrahim', 'Winnie', 'Moses', 'Ruth', 'Duncan', 'Maureen', 'Peter', 'Alice', 'Felix', 'Sharon',
  'Joseph', 'Beatrice', 'Kelvin', 'Diana', 'Emmanuel', 'Caroline', 'Stephen', 'Irene', 'Titus', 'Lydia'
];

const LAST_NAMES = [
  'Kimutai', 'Wanjiku', 'Otieno', 'Chebet', 'Mbugua', 'Atieno', 'Kiptoo', 'Nyambura', 'Mwangi', 'Achieng',
  'Rotich', 'Cheruiyot', 'Omondi', 'Kiplagat', 'Njuguna', 'Wekesa', 'Mutua', 'Kerubo', 'Barasa', 'Chelimo',
  'Sang', 'Njoroge', 'Odhiambo', 'Kirui', 'Maina', 'Wambui', 'Onyango', 'Kipchumba', 'Moraa', 'Gitau',
  'Owuor', 'Jepkemboi'
];

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function atTime(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function propensity(studentId, courseId) {
  const lowPerformers = { s1: 0.52, s2: 0.42, s3: 0.58, s5: 0.61, s8: 0.47, s11: 0.64, s14: 0.55, s19: 0.67, s23: 0.49, s31: 0.62 };
  if (courseId === 'c1' && lowPerformers[studentId]) return lowPerformers[studentId];
  const base = 0.78 + (hash32(studentId + courseId) % 210) / 1000;
  return Math.min(base, 0.99);
}

function buildStudents() {
  const students = [];
  for (let i = 0; i < 96; i++) {
    const first = i === 0 ? 'John' : FIRST_NAMES[i % FIRST_NAMES.length];
    const last = i === 0 ? 'Kimutai' : LAST_NAMES[(i * 13 + 5) % LAST_NAMES.length];
    const name = `${first} ${last}`;
    const no = String(101 + i);
    students.push({
      id: `s${i + 1}`,
      regNo: `BAR/2023/${no}`,
      name,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@student.baraton.ac.ke`,
      program: i % 7 === 0 ? 'BSc. Information Technology' : 'BBIT',
      year: i < 56 ? 2 : 3,
      phone: `+2547${String(10000000 + i * 137).slice(0, 8)}`
    });
  }
  return students;
}

function buildSeed(now = new Date()) {
  const halls = HALLS.map((h) => ({ ...h }));
  const lecturers = LECTURERS.map((l) => ({ ...l }));
  const students = buildStudents();

  const courses = COURSES.map((c) => {
    let enrolled;
    if (c.id === 'c1') enrolled = students.slice(0, 85).map((s) => s.id);
    else {
      enrolled = students.filter((s, i) => (i + c.code.charCodeAt(3)) % 3 !== 0).map((s) => s.id);
      enrolled = enrolled.slice(0, 40 + (c.code.charCodeAt(3) % 20));
    }
    return { ...c, studentIds: enrolled, windowMinutes: 15, rosterFinalizedAt: null, room: c.room || '' };
  });

  const sessions = [];
  const attendance = [];
  const startCursor = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const course of courses) {
    const day = new Date(startCursor);
    while (day <= today) {
      if (day.getDay() === course.day) {
        const startsAt = atTime(day, course.start);
        const endsAt = atTime(day, course.end);
        if (endsAt <= now) {
          const code = String(1000 + (hash32(course.id + dateKey(day)) % 9000));
          const sessionId = `seed-${course.id}-${dateKey(day)}`;
          sessions.push({
            id: sessionId,
            courseId: course.id,
            lecturerId: course.lecturerId,
            hallId: course.hallId,
            code,
            token: `ASMART|${sessionId}|${code}|seed`,
            bleName: `${course.code.toUpperCase()}_${DAY_NAMES[course.day].toUpperCase()}_CLASS`,
            startedAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMin: Math.round((endsAt - startsAt) / 60000),
            status: 'ended',
            endedAt: endsAt.toISOString(),
            seeded: true
          });

          for (const studentId of course.studentIds) {
            const rnd = mulberry32(hash32(studentId + sessionId));
            if (rnd() > propensity(studentId, course.id)) continue;

            const late = rnd() < 0.09;
            const offsetMin = late ? 6 + Math.floor(rnd() * 12) : Math.floor(rnd() * 5);
            const checkedInAt = new Date(startsAt.getTime() + offsetMin * 60000);
            attendance.push({
              id: `att-${sessionId}-${studentId}`,
              sessionId,
              courseId: course.id,
              studentId,
              checkedInAt: checkedInAt.toISOString(),
              method: 'code',
              distanceM: Math.round(4 + rnd() * 41),
              status: offsetMin > LATE_GRACE_MIN ? 'late' : 'present',
              deviceId: `seed-device-${studentId}`
            });
          }
        }
      }
      day.setDate(day.getDate() + 1);
    }
  }

  // Flagship risk profile: John Kimutai sits near 52% in DBM411.
  const dbmSessions = sessions.filter((s) => s.courseId === 'c1');
  const johnRecords = attendance.filter((a) => a.studentId === 's1' && a.courseId === 'c1');
  const target = Math.round(dbmSessions.length * 0.52);
  if (johnRecords.length > target) {
    const drop = new Set(johnRecords.slice(target).map((r) => r.id));
    for (let i = attendance.length - 1; i >= 0; i--) {
      if (drop.has(attendance[i].id)) attendance.splice(i, 1);
    }
  } else if (johnRecords.length < target) {
    const missing = dbmSessions.filter((s) => !johnRecords.some((r) => r.sessionId === s.id));
    for (let i = 0; i < target - johnRecords.length && i < missing.length; i++) {
      const s = missing[i];
      const startedAt = new Date(s.startedAt);
      attendance.push({
        id: `att-${s.id}-s1-fill`,
        sessionId: s.id,
        courseId: 'c1',
        studentId: 's1',
        checkedInAt: new Date(startedAt.getTime() + 2 * 60000).toISOString(),
        method: 'code',
        distanceM: 12,
        status: 'present',
        deviceId: 'seed-device-s1'
      });
    }
  }

  return {
    version: VERSION,
    createdAt: new Date().toISOString(),
    university: { name: 'Baraton University', short: 'Baraton', semester: 'Semester 2, 2025/2026' },
    halls,
    lecturers,
    admin: { id: 'a1', name: 'Dr. Ruth Kosgei', email: 'registrar@baraton.ac.ke', title: 'University Registrar', department: 'Academic Affairs' },
    students,
    courses,
    sessions,
    attendance,
    identityLocks: [],
    securityEvents: []
  };
}

module.exports = { buildSeed, VERSION, LATE_GRACE_MIN, DAY_NAMES };
