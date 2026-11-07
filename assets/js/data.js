/**
 * AttendSmart AI — data layer.
 *
 * Everything lives in localStorage so the system can be demoed with no backend:
 * users, courses, lecture halls, attendance sessions and attendance records.
 * The verification rules in `checkIn()` mirror what a server would enforce.
 */

export const STORAGE_KEY = 'attendsmart.state.v1';
export const USER_KEY = 'attendsmart.user.v1';
export const DEVICE_KEY = 'attendsmart.device.v1';
export const VERSION = 3;

export const LATE_GRACE_MIN = 5;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

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
  { id: 'c6', code: 'BIT405', name: 'Cybersecurity Fundamentals', department: 'Computing & IT', lecturerId: 'l3', day: 1, start: '16:00', end: '18:00', hallId: 'hall-b', credits: 3, semester: 'Semester 2' }
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

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

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

function rand4() {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 1e9);
  return String(1000 + (buf[0] % 9000));
}

function randToken() {
  const buf = new Uint32Array(2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else { buf[0] = Math.random() * 1e9; buf[1] = Math.random() * 1e9; }
  return buf[0].toString(36) + buf[1].toString(36);
}

export function makeToken(sessionId, code) {
  return `ASMART|${sessionId}|${code}|${randToken()}`;
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
  // Deliberately uneven so risk alerts and absentee reports have real signal.
  const lowPerformers = { s1: 0.52, s2: 0.42, s3: 0.58, s5: 0.61, s8: 0.47, s11: 0.64, s14: 0.55, s19: 0.67, s23: 0.49, s31: 0.62 };
  if (courseId === 'c1' && lowPerformers[studentId]) return lowPerformers[studentId];
  const base = 0.78 + (hash32(studentId + courseId) % 210) / 1000; // 0.78 – 0.99
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
    // DBM411 holds the full cohort (85 students) exactly as in the design doc.
    let enrolled;
    if (c.id === 'c1') enrolled = students.slice(0, 85).map((s) => s.id);
    else {
      enrolled = students.filter((s, i) => (i + c.code.charCodeAt(3)) % 3 !== 0).map((s) => s.id);
      enrolled = enrolled.slice(0, 40 + (c.code.charCodeAt(3) % 20));
    }
    return { ...c, studentIds: enrolled, windowMinutes: 15, rosterFinalizedAt: null };
  });

  // ---- historical sessions: the last 4 calendar months, on each course weekday
  const sessions = [];
  const attendance = [];
  const startCursor = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const course of courses) {
    let day = new Date(startCursor);
    let idx = 0;
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
            const p = propensity(studentId, course.id);
            const roll = rnd();
            if (roll > p) continue; // absent

            const late = rnd() < 0.09;
            const offsetMin = late ? 6 + Math.floor(rnd() * 12) : Math.floor(rnd() * 5);
            const checkedInAt = new Date(startsAt.getTime() + offsetMin * 60000);
            attendance.push({
              id: `att-${sessionId}-${studentId}`,
              sessionId,
              courseId: course.id,
              studentId,
              checkedInAt: checkedInAt.toISOString(),
              method: 'ble',
              distanceM: Math.round(4 + rnd() * 41),
              status: offsetMin > LATE_GRACE_MIN ? 'late' : 'present',
              deviceId: `seed-device-${studentId}`
            });
            idx++;
          }
        }
      }
      day.setDate(day.getDate() + 1);
    }
  }

  // Guarantee the flagship risk profile: John Kimutai sits near 52% in DBM411.
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
        method: 'ble',
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

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

let cache = null;

function persist(db) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.warn('[AttendSmart] Could not persist state', err);
  }
}

function sweepExpired(db) {
  const now = Date.now();
  let changed = false;
  for (const s of db.sessions) {
    if (s.status === 'active' && new Date(s.endsAt).getTime() <= now) {
      s.status = 'ended';
      s.endedAt = s.endsAt;
      changed = true;
    }
  }
  if (changed) persist(db);
  return db;
}

export function getDB() {
  if (cache) return sweepExpired(cache);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === VERSION) {
        cache = parsed;
        return sweepExpired(cache);
      }
    }
  } catch (err) {
    console.warn('[AttendSmart] Corrupt state, reseeding', err);
  }
  cache = buildSeed();
  persist(cache);
  return cache;
}

export function saveDB(db) {
  cache = db || cache;
  if (cache) persist(cache);
  return cache;
}

export function resetDB() {
  cache = buildSeed();
  persist(cache);
  return cache;
}

/**
 * Drop the in-memory cache and re-read localStorage.
 * Another tab writing a check-in fires a storage event here; without this the
 * cache would keep serving the pre-check-in snapshot.
 */
export function reloadDB() {
  cache = null;
  return getDB();
}

/* ------------------------------------------------------------------ */
/* Session / identity helpers                                          */
/* ------------------------------------------------------------------ */

export function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch (e) { /* ignore */ }
  if (!id) {
    id = 'dev-' + randToken();
    try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* ignore */ }
  }
  return id;
}

export function findUser(db, userId) {
  if (!userId) return null;
  const student = db.students.find((s) => s.id === userId);
  if (student) return { role: 'student', user: student };
  const lecturer = db.lecturers.find((l) => l.id === userId);
  if (lecturer) return { role: 'lecturer', user: lecturer };
  if (db.admin && db.admin.id === userId) return { role: 'admin', user: db.admin };
  return null;
}

// Session-scoped so a lecturer tab and a student tab can run side by side while
// still sharing the attendance database (which lives in localStorage).
export function storeUser(userId) {
  try {
    sessionStorage.setItem(USER_KEY, userId);
    localStorage.setItem(USER_KEY, userId);
  } catch (e) { /* ignore */ }
}

export function storedUserId() {
  try {
    return sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
  } catch (e) {
    return null;
  }
}

export function clearUser() {
  try {
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) { /* ignore */ }
}

// The student signs in once. This survives tabs and restarts on the device,
// independent of the shared session key the lecturer/admin tabs use.
export const STUDENT_KEY = 'attendsmart.student.v1';

export function rememberStudent(userId) {
  try {
    localStorage.setItem(STUDENT_KEY, userId);
  } catch (e) { /* ignore */ }
}

export function rememberedStudent() {
  try {
    return localStorage.getItem(STUDENT_KEY);
  } catch (e) {
    return null;
  }
}

export function forgetStudent() {
  try {
    localStorage.removeItem(STUDENT_KEY);
  } catch (e) { /* ignore */ }
}

export function courseById(db, id) {
  return db.courses.find((c) => c.id === id) || null;
}

export function hallById(db, id) {
  return db.halls.find((h) => h.id === id) || null;
}

export function lecturerById(db, id) {
  return db.lecturers.find((l) => l.id === id) || null;
}

export function studentById(db, id) {
  return db.students.find((s) => s.id === id) || null;
}

export function coursesForStudent(db, studentId) {
  return db.courses.filter((c) => c.studentIds.includes(studentId));
}

export function coursesForLecturer(db, lecturerId) {
  return db.courses.filter((c) => c.lecturerId === lecturerId);
}

export function sessionsForCourse(db, courseId) {
  return db.sessions.filter((s) => s.courseId === courseId);
}

export function activeSessions(db) {
  return db.sessions.filter((s) => s.status === 'active');
}

export function activeSessionForCourse(db, courseId) {
  return db.sessions.find((s) => s.courseId === courseId && s.status === 'active') || null;
}

export function bleNameFor(course, dayIndex) {
  return `${course.code.toUpperCase()}_${DAY_NAMES[dayIndex].toUpperCase()}_CLASS`;
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export function startSession(db, { courseId, lecturerId, hallId, durationMin }) {
  const course = courseById(db, courseId);
  if (!course) throw new Error('Course not found');
  const existing = activeSessionForCourse(db, courseId);
  if (existing) return existing;

  const now = new Date();
  const minutes = Number(durationMin) || course.windowMinutes || 15;
  const code = rand4();
  const session = {
    id: `sess-${now.getTime().toString(36)}-${randToken().slice(0, 4)}`,
    courseId,
    lecturerId,
    hallId: hallId || course.hallId,
    code,
    token: '',
    bleName: bleNameFor(course, course.day),
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + minutes * 60000).toISOString(),
    durationMin: minutes,
    status: 'active',
    endedAt: null,
    seeded: false
  };
  session.token = makeToken(session.id, code);
  db.sessions.push(session);
  saveDB(db);
  return session;
}

export function endSession(db, sessionId) {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  session.status = 'ended';
  session.endedAt = new Date().toISOString();
  saveDB(db);
  return session;
}

export function rotateSessionCode(db, sessionId) {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  session.code = rand4();
  session.token = makeToken(session.id, session.code);
  saveDB(db);
  return session;
}

/**
 * Attendance verification — the heart of the system.
 *
 * Gates, in order: the window is live, the device heard the class broadcast,
 * the student is on the posted final register, GPS is inside the hall, nothing
 * has been posted yet, and the device is not already bound to another identity.
 *
 * Posting is irreversible: records are never updated or reassigned, and the
 * first successful post permanently binds the device to that student.
 */
export function checkIn(db, { sessionId, studentId, method = 'ble', distanceM, deviceId, bleVerified }) {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, step: 'session', message: 'That session no longer exists.' };
  if (session.status !== 'active') {
    return { ok: false, step: 'session', message: 'This attendance session has already closed.' };
  }
  if (Date.now() > new Date(session.endsAt).getTime()) {
    session.status = 'ended';
    session.endedAt = session.endsAt;
    saveDB(db);
    return { ok: false, step: 'session', message: 'This session has expired. Ask your lecturer for a new one.' };
  }

  const course = courseById(db, session.courseId);
  const student = studentById(db, studentId);
  if (!course || !student) return { ok: false, step: 'session', message: 'Invalid course or student.' };

  if (!course.studentIds.includes(studentId)) {
    logSecurityEvent(db, {
      session,
      course,
      student,
      type: 'unregistered_attempt',
      detail: `${student.name} (${student.regNo}) tried to post attendance for ${course.code} but is not on the final register.`
    });
    return {
      ok: false,
      step: 'enrolled',
      message: `You are not on the final register for ${course.code}. This attempt was recorded and will be shown to the lecturer.`
    };
  }

  if (!bleVerified) {
    return { ok: false, step: 'ble', message: 'Bluetooth proximity was not verified. Discover the lecturer’s session first.' };
  }

  const hall = hallById(db, session.hallId);
  if (!hall) return { ok: false, step: 'gps', message: 'Lecture hall location is not configured.' };
  if (typeof distanceM !== 'number' || Number.isNaN(distanceM)) {
    return { ok: false, step: 'gps', message: 'GPS location was not captured. Enable location and try again.' };
  }
  if (distanceM > hall.radius) {
    return {
      ok: false,
      step: 'gps',
      message: `You are ${Math.round(distanceM)} m from ${hall.name}. Attendance requires you within ${hall.radius} m.`
    };
  }

  const duplicate = db.attendance.find((a) => a.sessionId === sessionId && a.studentId === studentId);
  if (duplicate) {
    return {
      ok: false,
      step: 'duplicate',
      message: `Attendance was already posted for you at ${new Date(duplicate.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. A posted record cannot be changed.`,
      record: duplicate
    };
  }

  const locks = db.identityLocks || (db.identityLocks = []);
  const boundDevice = deviceId || getDeviceId();
  const identity = locks.find((l) => l.deviceId === boundDevice);
  if (identity && identity.studentId !== studentId) {
    const owner = studentById(db, identity.studentId);
    logSecurityEvent(db, {
      session,
      course,
      student,
      type: 'identity_locked',
      detail: `${student.name} tried to post from a device permanently bound to ${owner ? owner.name : 'another student'}. Identity cannot be reassigned.`
    });
    return {
      ok: false,
      step: 'identity',
      message: 'This device is permanently bound to another student. Attendance cannot be reassigned.'
    };
  }

  const startedAt = new Date(session.startedAt).getTime();
  const elapsedMin = (Date.now() - startedAt) / 60000;
  const record = {
    id: `att-${Date.now().toString(36)}-${randToken().slice(0, 5)}`,
    sessionId,
    courseId: session.courseId,
    studentId,
    checkedInAt: new Date().toISOString(),
    method: method || 'ble',
    distanceM: Math.round(distanceM),
    status: elapsedMin > LATE_GRACE_MIN ? 'late' : 'present',
    deviceId: deviceId || getDeviceId()
  };
  db.attendance.push(record);
  if (!identity) {
    locks.push({ deviceId: boundDevice, studentId, at: new Date().toISOString() });
  }
  saveDB(db);
  return { ok: true, step: 'done', record, session, course, hall };
}

/** Append an audit event so filtered attempts survive to the session report. */
function logSecurityEvent(db, { session, course, student, type, detail }) {
  db.securityEvents.push({
    id: `sec-${Date.now().toString(36)}-${randToken().slice(0, 4)}`,
    at: new Date().toISOString(),
    sessionId: session ? session.id : null,
    courseId: course ? course.id : session ? session.courseId : null,
    studentId: student ? student.id : null,
    type,
    detail
  });
  saveDB(db);
}

/* ------------------------------------------------------------------ */
/* Semester setup                                                      */
/* ------------------------------------------------------------------ */

export function updateCourseSetup(db, courseId, patch) {
  const course = courseById(db, courseId);
  if (!course) throw new Error('Course not found.');
  if (course.rosterFinalizedAt) throw new Error('This class is already final for the semester.');

  if ('hallId' in patch) {
    if (!hallById(db, patch.hallId)) throw new Error('Unknown lecture hall.');
    course.hallId = patch.hallId;
  }
  if ('day' in patch) {
    const day = Number(patch.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Pick a valid weekday.');
    course.day = day;
    course.bleName = bleNameFor(course, day);
  }
  for (const key of ['start', 'end']) {
    if (!(key in patch)) continue;
    if (!/^\d{2}:\d{2}$/.test(String(patch[key]))) throw new Error('Time must look like 08:00.');
    course[key] = patch[key];
  }
  if (course.end <= course.start) throw new Error('The class must end after it starts.');

  if ('windowMinutes' in patch) {
    const minutes = Number(patch.windowMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 60) throw new Error('Attendance window must be 5–60 minutes.');
    course.windowMinutes = minutes;
  }
  if ('semester' in patch) {
    const value = String(patch.semester || '').trim();
    if (value) course.semester = value.slice(0, 40);
  }

  saveDB(db);
  return course;
}

export function setCourseRoster(db, courseId, studentIds) {
  const course = courseById(db, courseId);
  if (!course) throw new Error('Course not found.');
  if (course.rosterFinalizedAt) throw new Error('The register is final and cannot be changed.');
  course.studentIds = [...new Set(studentIds)].filter((id) => !!studentById(db, id));
  saveDB(db);
  return course;
}

export function finalizeCourseRoster(db, courseId) {
  const course = courseById(db, courseId);
  if (!course) throw new Error('Course not found.');
  if (course.rosterFinalizedAt) return course;
  if (!course.studentIds.length) throw new Error('Add at least one student before posting the register.');
  course.rosterFinalizedAt = new Date().toISOString();
  saveDB(db);
  return course;
}

/** Everything the lecturer needs once a session closes. */
export function sessionReport(db, sessionId) {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const course = courseById(db, session.courseId);
  if (!course) return null;
  const hall = hallById(db, session.hallId);

  const enrolled = course.studentIds.map((id) => studentById(db, id)).filter(Boolean);
  const records = db.attendance.filter((a) => a.sessionId === sessionId);
  const byStudent = new Map(records.map((r) => [r.studentId, r]));

  const rows = enrolled.map((student) => {
    const record = byStudent.get(student.id) || null;
    return { student, record, status: record ? record.status : 'absent' };
  });

  const present = records.filter((r) => r.status === 'present').length;
  const late = records.filter((r) => r.status === 'late').length;
  const absent = Math.max(0, enrolled.length - records.length);
  const attempts = db.securityEvents.filter((e) => e.sessionId === sessionId);

  return {
    session,
    course,
    hall,
    enrolled,
    rows,
    present,
    late,
    absent,
    recorded: records.length,
    rate: enrolled.length ? (records.length / enrolled.length) * 100 : 0,
    attempts
  };
}

/* ------------------------------------------------------------------ */
/* Roster import (paste from Excel)                                    */
/* ------------------------------------------------------------------ */

function nextStudentId(db) {
  let max = 0;
  for (const s of db.students) {
    const m = /^s(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let id = `s${max + 1}`;
  while (db.students.some((s) => s.id === id)) id = `s${++max + 1}`;
  return id;
}

/**
 * Add students from a pasted ID + name list. The student ID (regNo) is the
 * primary key: an existing student with the same ID is reused and never
 * duplicated, and a new ID creates a student record on the spot.
 */
export function importRoster(db, courseId, entries) {
  const course = courseById(db, courseId);
  if (!course) throw new Error('Course not found.');
  if (course.rosterFinalizedAt) throw new Error('The register is final and cannot be changed.');

  const added = [];
  const already = [];
  const invalid = [];
  const seen = new Set();

  for (const entry of entries) {
    const regNo = String(entry.regNo || '').trim();
    const name = String(entry.name || '').trim().replace(/\s+/g, ' ');
    if (!regNo || !name) {
      invalid.push(entry);
      continue;
    }

    const key = regNo.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let student = db.students.find((s) => String(s.regNo).toUpperCase() === key);
    if (student) {
      student.name = name;
    } else {
      student = {
        id: nextStudentId(db),
        name,
        regNo,
        program: course.department || 'Imported',
        year: 1,
        email: ''
      };
      db.students.push(student);
    }

    if (course.studentIds.includes(student.id)) already.push(student);
    else {
      course.studentIds.push(student.id);
      added.push(student);
    }
  }

  saveDB(db);
  return { added, already, invalid };
}

/** Capture the classroom position with the phone or the BT-821C. */
export function setCourseVenue(db, courseId, { lat, lng, accuracy, radius }) {
  const course = courseById(db, courseId);
  if (!course) throw new Error('Course not found.');
  if (course.rosterFinalizedAt) throw new Error('This class is final for the semester.');

  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
    throw new Error('The GPS fix did not contain valid coordinates.');
  }

  const fence = Math.min(200, Math.max(20, Number(radius) || 50));
  const id = `venue-${course.id}`;
  let hall = db.halls.find((h) => h.id === id);
  if (!hall) {
    hall = { id, name: `${course.code} classroom`, building: 'Captured venue', lat: la, lng: ln, radius: fence };
    db.halls.push(hall);
  } else {
    hall.lat = la;
    hall.lng = ln;
    hall.radius = fence;
  }

  course.hallId = id;
  course.venueCapturedAt = new Date().toISOString();
  course.venueAccuracy = Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy)) : null;
  saveDB(db);
  return hall;
}

