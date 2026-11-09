/**
 * AttendEase — data layer (shared backend client).
 *
 * The database lives on the server now, so two independently installed apps
 * see the same sessions and records. This module keeps a synchronous snapshot
 * in memory for the views (they render from `getDB()`), and every mutation is
 * a request that returns a fresh snapshot plus a live `revision` event.
 *
 * Offline rule: reads can be stale, writes never pretend to succeed. If the
 * server cannot be reached the mutation throws and the UI shows the error.
 */

export const STORAGE_KEY = 'attendsmart.state.v1';
export const USER_KEY = 'attendsmart.user.v1';
export const DEVICE_KEY = 'attendsmart.device.v1';
export const SERVER_KEY = 'attendsmart.server.v1';
export const VERSION = 3;

export const LATE_GRACE_MIN = 5;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EMPTY = {
  version: VERSION,
  revision: 0,
  createdAt: null,
  university: { name: 'Baraton University', short: 'Baraton', semester: '' },
  admin: null,
  halls: [],
  lecturers: [],
  students: [],
  courses: [],
  sessions: [],
  attendance: [],
  identityLocks: [],
  securityEvents: []
};

let cache = null;
let actorId = null;

/* ------------------------------------------------------------------ */
/* Server connection                                                   */
/* ------------------------------------------------------------------ */

export function isNativeApp() {
  return !!(
    typeof window !== 'undefined' &&
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform()
  );
}

function storedServer() {
  try {
    return localStorage.getItem(SERVER_KEY) || '';
  } catch (err) {
    return '';
  }
}

/** Base URL for API calls: same origin on the web, configured host in the APK. */
export function serverBase() {
  const saved = storedServer();
  if (saved) return saved.replace(/\/+$/, '');
  return '';
}

export function serverLabel() {
  const base = serverBase();
  if (base) return base.replace(/^https?:\/\//, '');
  return typeof location !== 'undefined' ? location.host : 'not configured';
}

/** True when the bundled APK has not been pointed at a laptop yet. */
export function needsServerSetup() {
  if (storedServer()) return false;
  return isNativeApp() || (typeof location !== 'undefined' && location.protocol === 'file:');
}

export function setServerBase(value) {
  let raw = String(value || '').trim();
  if (!raw) throw new Error('Enter the server address shown on the laptop.');
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    throw new Error('That does not look like a valid address.');
  }
  if (!parsed.port) parsed.port = parsed.protocol === 'https:' ? '443' : '4173';
  const clean = `${parsed.protocol}//${parsed.host}`;
  try {
    localStorage.setItem(SERVER_KEY, clean);
  } catch (err) {
    /* ignore */
  }
  return clean;
}

export function clearServerBase() {
  try {
    localStorage.removeItem(SERVER_KEY);
  } catch (err) {
    /* ignore */
  }
}

async function request(method, pathname, body) {
  const base = serverBase();
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
  } catch (err) {
    throw new Error(`Cannot reach the AttendEase server at ${base || location.origin}. Check the Wi-Fi and the server address.`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`The server answered with ${res.status}, not JSON.`);
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Server error ${res.status}`);
  }
  if (data.state) cache = data.state;
  return data;
}

/* ------------------------------------------------------------------ */
/* Snapshot lifecycle                                                  */
/* ------------------------------------------------------------------ */

export function getDB() {
  return cache || EMPTY;
}

export function setDB(state) {
  cache = state || null;
}

export function setActor(userId) {
  actorId = userId || null;
}

export async function initDB() {
  if (needsServerSetup()) throw new Error('server-not-configured');
  const data = await request('GET', '/api/state');
  cache = data.state;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    /* ignore */
  }
  return cache;
}

/** Re-read the snapshot. Returns true when the server's revision moved. */
export async function refreshDB() {
  const previous = cache ? cache.revision : -1;
  const data = await request('GET', '/api/state');
  cache = data.state;
  return cache.revision !== previous;
}

export const reloadDB = refreshDB;

/**
 * Listen for server changes. EventSource reconnects by itself; the returned
 * unsubscribe closes it on sign-out.
 */
export function subscribeToState(onChange) {
  if (typeof EventSource !== 'function' || needsServerSetup()) return () => {};
  const source = new EventSource(`${serverBase()}/api/events`);

  source.addEventListener('state', (event) => {
    let revision = cache ? cache.revision : -1;
    try {
      revision = Number(JSON.parse(event.data).revision);
    } catch (err) {
      /* malformed frame — let the next one trigger a refresh */
    }
    if (revision !== (cache ? cache.revision : -1)) onChange(revision);
  });

  return () => source.close();
}

/* ------------------------------------------------------------------ */
/* Session / identity helpers                                          */
/* ------------------------------------------------------------------ */

export function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(DEVICE_KEY);
  } catch (err) {
    /* ignore */
  }
  if (!id) {
    const random =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    id = 'dev-' + random;
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch (err) {
      /* ignore */
    }
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

export function storeUser(userId) {
  try {
    sessionStorage.setItem(USER_KEY, userId);
    localStorage.setItem(USER_KEY, userId);
  } catch (err) {
    /* ignore */
  }
}

export function storedUserId() {
  try {
    return sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
  } catch (err) {
    return null;
  }
}

export function clearUser() {
  try {
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (err) {
    /* ignore */
  }
}

export const STUDENT_KEY = 'attendsmart.student.v1';

export function rememberStudent(userId) {
  try {
    localStorage.setItem(STUDENT_KEY, userId);
  } catch (err) {
    /* ignore */
  }
}

export function rememberedStudent() {
  try {
    return localStorage.getItem(STUDENT_KEY);
  } catch (err) {
    return null;
  }
}

export function forgetStudent() {
  try {
    localStorage.removeItem(STUDENT_KEY);
  } catch (err) {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Selectors (unchanged)                                               */
/* ------------------------------------------------------------------ */

export function courseById(db, id) {
  return db.courses.find((c) => c.id === id) || null;
}

export function hallById(db, id) {
  return db.halls.find((h) => h.id === id) || null;
}

/**
 * The location fence that applies to a session. The lecturer's captured fix
 * wins; seeded sessions fall back to the hall they were scheduled in.
 */
export function sessionVenue(db, session) {
  const hall = session ? hallById(db, session.hallId) : null;
  const sessionFix =
    session && Number.isFinite(session.lat) && Number.isFinite(session.lng) &&
    !(session.lat === 0 && session.lng === 0);
  const lat = sessionFix ? session.lat : hall ? hall.lat : null;
  const lng = sessionFix ? session.lng : hall ? hall.lng : null;
  const radius = session && Number.isFinite(session.radius)
    ? session.radius
    : hall && Number.isFinite(hall.radius)
      ? hall.radius
      : 30;
  return {
    id: hall ? hall.id : null,
    name: hall ? hall.name : 'Classroom',
    building: hall ? hall.building : '',
    lat: sessionFix ? session.lat : lat,
    lng: sessionFix ? session.lng : lng,
    radius,
    captured: sessionFix
  };
}

/** Human room label for a unit card (spec: Room B12). */
export function roomFor(db, course) {
  if (!course) return 'Room TBA';
  if (course.room) return course.room;
  const hall = hallById(db, course.hallId);
  return hall ? hall.name : 'Room TBA';
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

export function activeSessionForStudent(db, studentId) {
  const enrolled = new Set(coursesForStudent(db, studentId).map((c) => c.id));
  return activeSessions(db).filter((s) => enrolled.has(s.courseId));
}

export function bleNameFor(course, dayIndex) {
  return `${course.code.toUpperCase()}_${DAY_NAMES[dayIndex].toUpperCase()}_CLASS`;
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function makeToken(sessionId, code) {
  return `ASMART|${sessionId}|${code}|${Math.random().toString(36).slice(2)}`;
}

/* ------------------------------------------------------------------ */
/* Mutations — server authoritative                                     */
/* ------------------------------------------------------------------ */

export async function startSession(_db, { courseId, lecturerId, durationMin, location }) {
  const fix = location || {};
  const data = await request('POST', '/api/sessions/start', {
    actorId: lecturerId || actorId,
    courseId,
    durationMin,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    radius: fix.radius
  });
  return data.result;
}

export async function createCourse(_db, payload) {
  const data = await request('POST', '/api/courses/create', {
    ...payload,
    actorId
  });
  return data.result;
}

export async function endSession(_db, sessionId) {
  const data = await request('POST', '/api/sessions/end', { actorId, sessionId });
  return data.result;
}

export async function rotateSessionCode(_db, sessionId) {
  const data = await request('POST', '/api/sessions/rotate', { actorId, sessionId });
  return data.result;
}

export async function lookupSession(code, studentId) {
  const query = new URLSearchParams({ code: String(code || ''), studentId: studentId || '' });
  const data = await request('GET', `/api/sessions/lookup?${query.toString()}`);
  return data.result;
}

export async function checkIn(_db, { code, studentId, deviceId, lat, lng, accuracy, method }) {
  const data = await request('POST', '/api/checkin', {
    code,
    studentId,
    deviceId,
    lat,
    lng,
    accuracy,
    method: method || 'code'
  });
  return data.result;
}

export async function updateCourseSetup(_db, courseId, patch) {
  const data = await request('POST', '/api/courses/setup', { actorId, courseId, patch });
  return data.result;
}

export async function setCourseRoster(_db, courseId, studentIds) {
  const data = await request('POST', '/api/courses/roster', { actorId, courseId, studentIds });
  return data.result;
}

export async function finalizeCourseRoster(_db, courseId) {
  const data = await request('POST', '/api/courses/finalize', { actorId, courseId });
  return data.result;
}

export async function importRoster(_db, courseId, entries) {
  const data = await request('POST', '/api/courses/import', { actorId, courseId, entries });
  return data.result;
}

export async function setCourseVenue(_db, courseId, coords) {
  const data = await request('POST', '/api/courses/venue', { actorId, courseId, ...coords });
  return data.result;
}

export async function resetDB() {
  const data = await request('POST', '/api/admin/reset', { actorId });
  return data.state;
}

/* ------------------------------------------------------------------ */
/* Compiled report (pure)                                              */
/* ------------------------------------------------------------------ */

export function sessionReport(db, sessionId) {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const course = courseById(db, session.courseId);
  if (!course) return null;
  const hall = sessionVenue(db, session);

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
