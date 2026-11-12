/**
 * CLASSPREF3CT cloud client.
 *
 * The phone that ran a class stays authoritative; this module is only the
 * shelf it syncs to. Two rules make that safe on a campus network:
 *
 *   1. Every call is optional. If the network is down, the class runs exactly
 *      as before and the work is remembered for the next attempt.
 *   2. Pushes are idempotent. Sessions and records carry their own ids, so a
 *      retry after a dropped connection cannot duplicate a check-in.
 *
 * Nothing here blocks a screen: callers fire it and forget it.
 */

import { getDB } from './data.js';

/** Deployed attendeease cloud (Workers + D1). */
export const CLOUD_BASE = 'https://site-0e3e6d5545fc40a7ae3aadc8cf8cb062.freebuff.page';

const BASE_KEY = 'attendease.cloud.base.v1';
const CODE_PREFIX = 'attendease.cloud.code.';
const PUSHED_KEY = 'attendease.cloud.pushed.v1';
const STATUS_KEY = 'attendease.cloud.status.v1';
const CLASSES_KEY = 'attendease.cloud.classes.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    /* storage full or blocked: the in-memory value still works this session */
  }
}

export function cloudBase() {
  try {
    const override = localStorage.getItem(BASE_KEY);
    return (override || CLOUD_BASE).replace(/\/+$/, '');
  } catch (err) {
    return CLOUD_BASE;
  }
}

export function setCloudBase(value) {
  try {
    if (!value) localStorage.removeItem(BASE_KEY);
    else localStorage.setItem(BASE_KEY, String(value).trim().replace(/\/+$/, ''));
  } catch (err) {
    /* ignore */
  }
}

/**
 * One unit has one cloud record, whichever phone published it. The key is
 * derived from the unit id rather than generated per install: a unit taught by
 * two lecturers, or the same lecturer reinstalling, must land on the same row
 * instead of forking the register into two classes.
 *
 * It is a write credential for a shelf, not a user secret; the phone that ran
 * the class remains the authority over what is written.
 */
export function classKeyFor(courseId) {
  const source = `ueab-attendease-2026|${courseId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let tail = 0x9e3779b9;
  for (let i = source.length - 1; i >= 0; i -= 1) {
    tail = Math.imul(tail ^ source.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `ueab-${hash.toString(36)}${tail.toString(36)}`;
}

/**
 * The code this phone publishes a unit under. It starts as the unit code, and
 * if that code is already owned by a different phone (a different class key)
 * the phone keeps a suffixed one rather than failing to sync forever.
 */
function codeFor(courseId, fallback) {
  try {
    const saved = localStorage.getItem(CODE_PREFIX + courseId);
    if (saved) return saved;
  } catch (err) {
    /* fall through */
  }
  return fallback;
}

function rememberCode(courseId, code) {
  try {
    localStorage.setItem(CODE_PREFIX + courseId, code);
  } catch (err) {
    /* ignore */
  }
}

async function call(method, path, body, timeoutMs = 8000) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${cloudBase()}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = data && data.error ? data.error : `cloud returned ${res.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unitOf(db, course) {
  const lecturer = (db.lecturers || []).find((l) => l.id === course.lecturerId) || {};
  const hall = (db.halls || []).find((h) => h.id === course.hallId) || {};
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    lecturerId: course.lecturerId,
    lecturerName: lecturer.name || '',
    hallId: course.hallId,
    hallName: hall.name || '',
    room: course.room || '',
    schedule: `${course.day || ''} ${course.start || ''}-${course.end || ''}`.trim()
  };
}

/** Publish (or refresh) one unit and the students enrolled in it. */
export async function publishCourse(db, course) {
  const students = (course.studentIds || [])
    .map((id) => (db.students || []).find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => ({
      id: s.id,
      regNo: s.regNo,
      name: s.name,
      courseIds: (db.courses || []).filter((c) => (c.studentIds || []).includes(s.id)).map((c) => c.id)
    }));

  const key = classKeyFor(course.id);
  const body = (code) => ({ code, key, unit: unitOf(db, course), students });

  try {
    const result = await call('POST', '/api/v1/classes', body(codeFor(course.id, course.code)));
    rememberCode(course.id, result.code);
    return result;
  } catch (err) {
    const message = err && err.message ? err.message : '';
    // That code belongs to another phone's key: keep ours under its own code.
    if (!/key/i.test(message)) throw err;
    const fallback = `${course.code}-${key.slice(-4).toUpperCase()}`;
    const result = await call('POST', '/api/v1/classes', body(fallback));
    rememberCode(course.id, result.code);
    return result;
  }
}

function pushedIds() {
  return new Set(read(PUSHED_KEY, []));
}

function rememberPushed(ids) {
  const all = read(PUSHED_KEY, []);
  const merged = new Set(all.concat(ids));
  write(PUSHED_KEY, Array.from(merged).slice(-4000));
}

/**
 * Push every finished session of this unit that the cloud has not accepted yet.
 * Only ended sessions travel: a live window is still the phone's business.
 */
export async function pushCourseReports(db, course) {
  const already = pushedIds();
  const sessions = (db.sessions || [])
    .filter((s) => s.courseId === course.id && s.status === 'ended' && !already.has(s.id))
    .slice(0, 40);

  if (!sessions.length) return { ok: true, sessions: 0, records: 0, skipped: true };

  const payload = sessions.map((session) => ({
    id: session.id,
    courseId: session.courseId,
    day: (session.startedAt || '').slice(0, 10),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    records: (db.attendance || [])
      .filter((r) => r.sessionId === session.id)
      .map((r) => ({
        id: r.id,
        studentId: r.studentId,
        status: r.status,
        at: Date.parse(r.checkedInAt) || Date.now(),
        distanceM: Math.round(Number(r.distanceM) || 0)
      }))
  }));

  const result = await call(
    'POST',
    `/api/v1/classes/${encodeURIComponent(codeFor(course.id, course.code))}/reports`,
    { key: classKeyFor(course.id), sessions: payload }
  );

  rememberPushed(sessions.map((s) => s.id));
  return { ok: true, sessions: sessions.length, records: payload.reduce((n, s) => n + s.records.length, 0), result };
}

let running = null;
let lastRun = 0;

/** Sync every unit this lecturer owns. Safe to call on a timer. */
export async function syncLecturer(lecturerId, { force = false } = {}) {
  if (!lecturerId) return { ok: false, error: 'no lecturer' };
  if (running) return running;
  const now = Date.now();
  if (!force && now - lastRun < 20000) return { ok: true, throttled: true };
  lastRun = now;

  running = (async () => {
    const db = getDB();
    if (!db || !db.courses) return { ok: false, error: 'no state loaded' };

    const mine = db.courses.filter((c) => c.lecturerId === lecturerId);
    let published = 0;
    let pushed = 0;
    let failed = null;

    for (const course of mine) {
      try {
        await publishCourse(db, course);
        published += 1;
      } catch (err) {
        failed = err && err.message ? err.message : 'publish failed';
        break;
      }
      try {
        const result = await pushCourseReports(db, course);
        if (!result.skipped) pushed += result.sessions;
      } catch (err) {
        failed = err && err.message ? err.message : 'report push failed';
        break;
      }
    }

    const status = {
      at: Date.now(),
      ok: !failed,
      units: mine.length,
      published,
      sessionsPushed: pushed,
      error: failed
    };
    write(STATUS_KEY, status);
    return status;
  })();

  try {
    return await running;
  } finally {
    running = null;
  }
}

export function cloudStatus() {
  return read(STATUS_KEY, null);
}

/**
 * The classes this student is enrolled in, with the roster of each, as the
 * cloud knows them. Offline it answers with the last copy this phone saw.
 */
export async function pullStudentClasses(studentId) {
  if (!studentId) return null;
  try {
    const mine = await call('GET', `/api/v1/classes?student=${encodeURIComponent(studentId)}`, null, 6000);
    const codes = ((mine && mine.classes) || []).map((entry) => entry.code);

    const classes = [];
    for (const code of codes.slice(0, 12)) {
      try {
        const full = await call('GET', `/api/v1/classes?code=${encodeURIComponent(code)}`, null, 6000);
        const doc = (full && full.class) || null;
        if (doc) {
          classes.push({
            code,
            unit: doc.unit || null,
            roster: (doc.students || []).map((s) => ({ id: s.id, regNo: s.regNo, name: s.name })),
            me: (doc.students || []).find((s) => s.id === studentId) || null
          });
        }
      } catch (err) {
        // One unit failing must not lose the others.
      }
    }

    const payload = { at: Date.now(), classes };
    write(CLASSES_KEY, payload);
    return payload;
  } catch (err) {
    // Offline is the normal case in a lecture hall: use what we saw last time.
    const cached = read(CLASSES_KEY, null);
    return cached ? { ...cached, stale: true, error: err && err.message } : null;
  }
}

export function cachedStudentClasses() {
  return read(CLASSES_KEY, null);
}

/**
 * Fold what the cloud knows back into the cached register: a student who was
 * added to a unit after this phone last saw the register still gets in, and a
 * unit renamed by the lecturer shows the new name.
 */
export function mergeCloudClasses(db, classes) {
  if (!db || !Array.isArray(classes) || !classes.length) return 0;
  let changed = 0;

  for (const entry of classes) {
    const roster = Array.isArray(entry.roster) ? entry.roster : [];
    if (!roster.length) continue;

    for (const person of roster) {
      if (!person.id) continue;
      if (!(db.students || []).some((s) => s.id === person.id)) {
        db.students.push({ id: person.id, regNo: person.regNo || '', name: person.name || 'Student' });
        changed += 1;
      }
    }

    const course = (db.courses || []).find((c) => c.code === entry.code);
    if (!course) continue;

    const ids = roster.map((s) => s.id).filter(Boolean);
    const missing = ids.filter((id) => !(course.studentIds || []).includes(id));
    if (missing.length) {
      course.studentIds = (course.studentIds || []).concat(missing);
      changed += missing.length;
    }
    if (entry.unit && entry.unit.name && course.name !== entry.unit.name) {
      course.name = entry.unit.name;
      changed += 1;
    }
  }

  return changed;
}
