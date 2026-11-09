/**
 * AttendEase — domain rules.
 *
 * The same gates the prototype used to run in the browser are enforced here,
 * once, for every phone:
 *   session live → enrolled student → GPS fence → no duplicate → device lock.
 *
 * The lecturer's captured position becomes the official class location for
 * that session. Students must be inside the 30 m fence even when they know the
 * four-digit code, which is what stops attendance being posted from a hostel.
 */
'use strict';

const crypto = require('crypto');
const { resetState, bumpRevision } = require('./db.cjs');

const LATE_GRACE_MIN = 5;

class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function rand4(db) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = String(crypto.randomInt(1000, 10000));
    const clash = db.prepare("SELECT 1 FROM sessions WHERE code = ? AND status = 'active' LIMIT 1").get(code);
    if (!clash) return code;
  }
  throw new ApiError(503, 'Could not allocate an attendance code. Try again.');
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function courseRow(db, courseId) {
  return db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) || null;
}

function studentRow(db, studentId) {
  return db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) || null;
}

function hallRow(db, hallId) {
  return db.prepare('SELECT * FROM halls WHERE id = ?').get(hallId) || null;
}

function courseJson(db, row, studentIds) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    lecturerId: row.lecturer_id,
    day: row.day,
    start: row.start,
    end: row.end,
    hallId: row.hall_id,
    credits: row.credits,
    semester: row.semester,
    windowMinutes: row.window_minutes,
    room: row.room || '',
    rosterFinalizedAt: row.roster_finalized_at,
    venueCapturedAt: row.venue_captured_at,
    venueAccuracy: row.venue_accuracy,
    studentIds: studentIds || enrolledIds(db, row.id)
  };
}

function sessionJson(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    lecturerId: row.lecturer_id,
    hallId: row.hall_id,
    code: row.code,
    token: row.token,
    bleName: row.ble_name,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    durationMin: row.duration_min,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    radius: row.radius ?? null,
    accuracy: row.accuracy ?? null,
    status: row.status,
    endedAt: row.ended_at,
    seeded: !!row.seeded
  };
}

function hallJson(row) {
  return { id: row.id, name: row.name, building: row.building, lat: row.lat, lng: row.lng, radius: row.radius };
}

function validCoords(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  // A 0,0 fix means the device had no satellite lock; venue rows also start at 0,0.
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

/**
 * The fence that applies to a session. New sessions store the lecturer's own
 * fix; older/seeded sessions fall back to the hall they were tied to.
 */
function venueFor(db, session) {
  const hall = session ? hallRow(db, session.hall_id) : null;
  const sessionFix = session ? validCoords(session.lat, session.lng) : null;
  const lat = sessionFix ? sessionFix.lat : hall ? hall.lat : null;
  const lng = sessionFix ? sessionFix.lng : hall ? hall.lng : null;
  const radius = Number.isFinite(session && session.radius)
    ? Number(session.radius)
    : hall && Number.isFinite(hall.radius)
      ? Number(hall.radius)
      : 30;
  return {
    id: hall ? hall.id : null,
    name: hall ? hall.name : 'Classroom',
    building: hall ? hall.building : '',
    lat,
    lng,
    radius,
    captured: !!sessionFix
  };
}

function enrolledIds(db, courseId) {
  return db.prepare('SELECT student_id FROM enrollments WHERE course_id = ? ORDER BY student_id').all(courseId).map((r) => r.student_id);
}

function enrolled(db, courseId, studentId) {
  return !!db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(courseId, studentId);
}

/** Close windows whose end time has passed. Returns true when anything changed. */
function sweepExpired(db) {
  const now = nowIso();
  const ended = db
    .prepare("SELECT id, ends_at FROM sessions WHERE status = 'active' AND ends_at <= ?")
    .all(now);
  for (const s of ended) {
    db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(s.ends_at, s.id);
  }
  return ended.length > 0;
}

function activeSessionForCourse(db, courseId) {
  const row = db.prepare("SELECT * FROM sessions WHERE course_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1").get(courseId);
  return row || null;
}

function assertCourseOwner(db, course, actorId) {
  if (!actorId) throw new ApiError(401, 'Sign in again — your session was not sent with the request.');
  if (course.lecturer_id !== actorId) throw new ApiError(403, 'This course belongs to another lecturer.');
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function startSession(db, { courseId, lecturerId, durationMin, lat, lng, accuracy, radius }) {
  const swept = sweepExpired(db);
  const course = courseRow(db, courseId);
  if (!course) throw new ApiError(404, 'Course not found.');
  assertCourseOwner(db, course, lecturerId);

  const fix = validCoords(lat, lng);
  const fence = Math.min(200, Math.max(10, Number(radius) || 30));
  const acc = Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy)) : null;

  const existing = activeSessionForCourse(db, courseId);
  if (existing) {
    // Re-starting an open window refreshes its official location when the
    // lecturer supplies a fresh fix.
    if (fix) {
      db.prepare('UPDATE sessions SET lat = ?, lng = ?, radius = ?, accuracy = ? WHERE id = ?').run(
        fix.lat, fix.lng, fence, acc, existing.id
      );
      bumpRevision(db);
      return sessionJson(db.prepare('SELECT * FROM sessions WHERE id = ?').get(existing.id));
    }
    if (swept) bumpRevision(db);
    return sessionJson(existing);
  }

  let official = fix;
  if (!official) {
    const hall = hallRow(db, course.hall_id);
    const hallFix = hall ? validCoords(hall.lat, hall.lng) : null;
    if (!hallFix) {
      throw new ApiError(400, 'Capture the class location before starting attendance. Enable precise location on this phone, or scan the BT-821C.');
    }
    official = hallFix;
  }

  // The spec's window is 10 minutes; allow 5–60 for demos.
  const minutes = Math.min(60, Math.max(5, Number(durationMin) || course.window_minutes || 10));
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + minutes * 60000);
  const sessionId = id('sess');
  const code = rand4(db);
  const dayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][course.day];

  db.prepare(`
    INSERT INTO sessions (id, course_id, lecturer_id, hall_id, code, token, ble_name, started_at, ends_at, duration_min, lat, lng, radius, accuracy, status, ended_at, seeded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, 0)
  `).run(
    sessionId,
    course.id,
    course.lecturer_id,
    course.hall_id,
    code,
    `ATTENDEASE|${sessionId}|${code}|${crypto.randomBytes(4).toString('hex')}`,
    `${course.code.toUpperCase()}_${dayName}_CLASS`,
    startedAt.toISOString(),
    endsAt.toISOString(),
    minutes,
    official.lat,
    official.lng,
    fence,
    acc
  );

  bumpRevision(db);
  return sessionJson(db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId));
}

function endSession(db, sessionId, actorId) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) throw new ApiError(404, 'Session not found.');
  if (actorId && actorId !== row.lecturer_id && actorId !== 'a1') {
    throw new ApiError(403, 'Only the lecturer who opened this window can close it.');
  }
  if (row.status !== 'ended') {
    db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(nowIso(), sessionId);
    bumpRevision(db);
  }
  return sessionJson(db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId));
}

function rotateCode(db, sessionId, actorId) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) throw new ApiError(404, 'Session not found.');
  if (row.status !== 'active') throw new ApiError(409, 'This attendance window has already closed.');
  if (actorId && actorId !== row.lecturer_id && actorId !== 'a1') {
    throw new ApiError(403, 'Only the lecturer who opened this window can change the code.');
  }
  const code = rand4(db);
  db.prepare('UPDATE sessions SET code = ?, token = ? WHERE id = ?').run(
    code,
    `ATTENDEASE|${sessionId}|${code}|${crypto.randomBytes(4).toString('hex')}`,
    sessionId
  );
  bumpRevision(db);
  return sessionJson(db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId));
}

function lookupSession(db, { code, studentId }) {
  if (sweepExpired(db)) bumpRevision(db);
  const clean = String(code || '').replace(/\D/g, '').slice(0, 4);
  if (clean.length !== 4) throw new ApiError(400, 'Enter the four-digit code shown by your lecturer.');

  const row = db
    .prepare("SELECT * FROM sessions WHERE code = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1")
    .get(clean);
  if (!row) {
    return { ok: false, step: 'code', message: 'No open attendance session matches that code. Check the four digits and try again.' };
  }

  const course = courseRow(db, row.course_id);
  const venue = venueFor(db, row);
  const lecturer = db.prepare('SELECT id, name, department, title FROM lecturers WHERE id = ?').get(row.lecturer_id);

  return {
    ok: true,
    session: sessionJson(row),
    course: courseJson(db, course),
    hall: venue,
    lecturer: lecturer || null,
    enrolled: studentId ? enrolled(db, row.course_id, studentId) : false,
    minutesLeft: Math.max(0, Math.round((new Date(row.ends_at).getTime() - Date.now()) / 60000))
  };
}

/* ------------------------------------------------------------------ */
/* Check-in                                                            */
/* ------------------------------------------------------------------ */

function securityEvent(db, { sessionId, courseId, studentId, type, detail }) {
  db.prepare('INSERT INTO security_events (id, at, session_id, course_id, student_id, type, detail) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id('sec'),
    nowIso(),
    sessionId || null,
    courseId || null,
    studentId || null,
    type,
    detail
  );
}

function checkIn(db, { code, studentId, deviceId, lat, lng, accuracy, method = 'code' }) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const swept = sweepExpired(db);
    const clean = String(code || '').replace(/\D/g, '').slice(0, 4);
    if (clean.length !== 4) {
      db.exec('ROLLBACK;');
      return { ok: false, step: 'code', message: 'Enter the four-digit code shown by your lecturer.' };
    }

    const row = db
      .prepare("SELECT * FROM sessions WHERE code = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1")
      .get(clean);
    if (!row) {
      if (swept) bumpRevision(db);
      db.exec('COMMIT;');
      return { ok: false, step: 'code', message: 'That code is not open right now. Ask your lecturer for the current four digits.' };
    }

    const course = courseRow(db, row.course_id);
    const student = studentRow(db, studentId);
    const venue = venueFor(db, row);
    if (!course || !student || !validCoords(venue.lat, venue.lng)) {
      db.exec('ROLLBACK;');
      return { ok: false, step: 'session', message: 'Invalid course, student or class location.' };
    }

    if (!enrolled(db, course.id, studentId)) {
      securityEvent(db, {
        sessionId: row.id,
        courseId: course.id,
        studentId,
        type: 'unregistered_attempt',
        detail: `${student.name} (${student.reg_no}) tried to post attendance for ${course.code} but is not on the final register.`
      });
      bumpRevision(db);
      db.exec('COMMIT;');
      return {
        ok: false,
        step: 'enrolled',
        message: `You are not on the final register for ${course.code}. This attempt was recorded and will be shown to the lecturer.`
      };
    }

    const duplicate = db.prepare('SELECT * FROM attendance WHERE session_id = ? AND student_id = ?').get(row.id, studentId);
    if (duplicate) {
      db.exec('ROLLBACK;');
      return {
        ok: false,
        step: 'duplicate',
        message: `Attendance was already posted for you at ${new Date(duplicate.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. A posted record cannot be changed.`,
        record: {
          id: duplicate.id,
          sessionId: duplicate.session_id,
          courseId: duplicate.course_id,
          studentId: duplicate.student_id,
          checkedInAt: duplicate.checked_in_at,
          method: duplicate.method,
          distanceM: duplicate.distance_m,
          status: duplicate.status,
          deviceId: duplicate.device_id
        }
      };
    }

    // One post per class per day. A lecturer can end a window and open another
    // for the same unit, and that must not become a second chance to post
    // attendance for the same class.
    const sameDay = db
      .prepare(
        "SELECT * FROM attendance WHERE student_id = ? AND course_id = ? AND substr(checked_in_at, 1, 10) = ? ORDER BY checked_in_at ASC LIMIT 1"
      )
      .get(studentId, course.id, nowIso().slice(0, 10));
    if (sameDay && sameDay.session_id !== row.id) {
      db.exec('ROLLBACK;');
      return {
        ok: false,
        step: 'duplicate',
        message: `You already posted attendance for ${course.code} today at ${new Date(
          sameDay.checked_in_at
        ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. A class is recorded once, so this cannot be repeated.`,
        record: {
          id: sameDay.id,
          sessionId: sameDay.session_id,
          courseId: sameDay.course_id,
          studentId: sameDay.student_id,
          checkedInAt: sameDay.checked_in_at,
          method: sameDay.method,
          distanceM: sameDay.distance_m,
          status: sameDay.status,
          deviceId: sameDay.device_id
        }
      };
    }

    const boundDevice = String(deviceId || '').trim();
    const lock = boundDevice ? db.prepare('SELECT * FROM identity_locks WHERE device_id = ?').get(boundDevice) : null;
    if (lock && lock.student_id !== studentId) {
      const owner = studentRow(db, lock.student_id);
      securityEvent(db, {
        sessionId: row.id,
        courseId: course.id,
        studentId,
        type: 'identity_locked',
        detail: `${student.name} tried to post from a device permanently bound to ${owner ? owner.name : 'another student'}. Identity cannot be reassigned.`
      });
      bumpRevision(db);
      db.exec('COMMIT;');
      return {
        ok: false,
        step: 'identity',
        message: 'This device is permanently bound to another student. Attendance cannot be reassigned.'
      };
    }

    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      db.exec('ROLLBACK;');
      return { ok: false, step: 'gps', message: 'GPS location was not captured. Enable location and try again.' };
    }

    const distanceM = haversineMeters({ lat: la, lng: ln }, { lat: venue.lat, lng: venue.lng });
    if (distanceM > venue.radius) {
      db.exec('ROLLBACK;');
      return {
        ok: false,
        step: 'gps',
        message: `You are ${Math.round(distanceM)} m from the class location. Attendance requires you within ${venue.radius} m, even with the correct code.`,
        distanceM: Math.round(distanceM)
      };
    }

    const elapsedMin = (Date.now() - new Date(row.started_at).getTime()) / 60000;
    const record = {
      id: id('att'),
      sessionId: row.id,
      courseId: course.id,
      studentId,
      checkedInAt: nowIso(),
      method,
      distanceM: Math.round(distanceM),
      status: elapsedMin > LATE_GRACE_MIN ? 'late' : 'present',
      deviceId: boundDevice || 'unknown-device'
    };

    db.prepare(`
      INSERT INTO attendance (id, session_id, course_id, student_id, checked_in_at, method, distance_m, status, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.sessionId, record.courseId, record.studentId,
      record.checkedInAt, record.method, record.distanceM, record.status, record.deviceId
    );

    if (boundDevice && !lock) {
      db.prepare('INSERT INTO identity_locks (device_id, student_id, at) VALUES (?, ?, ?)').run(boundDevice, studentId, nowIso());
    }

    bumpRevision(db);
    db.exec('COMMIT;');

    return {
      ok: true,
      step: 'done',
      record,
      session: sessionJson(row),
      course: courseJson(db, course),
      hall: venue,
      accuracy: Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy)) : null
    };
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) { /* already rolled back */ }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Semester setup                                                      */
/* ------------------------------------------------------------------ */

function createCourse(db, payload = {}, actorId) {
  const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
  const code = String(payload.code || '').trim().toUpperCase().replace(/\s+/g, '');
  const room = String(payload.room || '').trim().slice(0, 80);
  const lecturerId = String(payload.lecturerId || actorId || '').trim();

  if (!name) throw new ApiError(400, 'Enter the unit name, for example Database Systems.');
  if (!code) throw new ApiError(400, 'Enter the course code, for example BBIT421.');

  const lecturer = db.prepare('SELECT * FROM lecturers WHERE id = ?').get(lecturerId);
  if (!lecturer) throw new ApiError(404, 'Lecturer account not found.');
  if (actorId && actorId !== lecturerId && actorId !== 'a1') {
    throw new ApiError(403, 'You can only create units for your own account.');
  }

  const today = new Date().getDay();
  const day = payload.day == null ? today : Number(payload.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new ApiError(400, 'Pick a valid weekday.');

  const start = /^\d{2}:\d{2}$/.test(String(payload.start || '')) ? String(payload.start) : '08:00';
  const end = /^\d{2}:\d{2}$/.test(String(payload.end || '')) ? String(payload.end) : '10:00';
  if (end <= start) throw new ApiError(400, 'The unit must end after it starts.');

  const minutes = Math.min(60, Math.max(5, Number(payload.windowMinutes) || 10));
  const semester = String(payload.semester || '').trim().slice(0, 40);
  const department = String(payload.department || lecturer.department || '').trim().slice(0, 80);
  const courseId = id('course');
  const hallId = `room-${courseId}`;
  const roomName = room || `${code} classroom`;

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('INSERT INTO halls (id, name, building, lat, lng, radius) VALUES (?, ?, ?, 0, 0, 30)').run(
      hallId, roomName, 'Created unit'
    );
    db.prepare(`
      INSERT INTO courses (id, code, name, department, lecturer_id, day, start, "end", hall_id, credits, semester, window_minutes, room)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3, ?, ?, ?)
    `).run(courseId, code, name, department, lecturer.id, day, start, end, hallId, semester, minutes, roomName);
    bumpRevision(db);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return courseJson(db, courseRow(db, courseId));
}

function updateCourseSetup(db, courseId, patch, actorId) {
  const course = courseRow(db, courseId);
  if (!course) throw new ApiError(404, 'Course not found.');
  assertCourseOwner(db, course, actorId);
  if (course.roster_finalized_at) throw new ApiError(409, 'This class is already final for the semester.');

  const next = {
    hallId: course.hall_id,
    day: course.day,
    start: course.start,
    end: course.end,
    windowMinutes: course.window_minutes,
    semester: course.semester,
    room: course.room || ''
  };

  if ('hallId' in patch) {
    if (!hallRow(db, patch.hallId)) throw new ApiError(400, 'Unknown lecture hall.');
    next.hallId = patch.hallId;
  }
  if ('day' in patch) {
    const day = Number(patch.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new ApiError(400, 'Pick a valid weekday.');
    next.day = day;
  }
  for (const key of ['start', 'end']) {
    if (!(key in patch)) continue;
    if (!/^\d{2}:\d{2}$/.test(String(patch[key]))) throw new ApiError(400, 'Time must look like 08:00.');
    next[key] = String(patch[key]);
  }
  if (next.end <= next.start) throw new ApiError(400, 'The class must end after it starts.');
  if ('windowMinutes' in patch) {
    const minutes = Number(patch.windowMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 60) throw new ApiError(400, 'Attendance window must be 5–60 minutes.');
    next.windowMinutes = minutes;
  }
  if ('semester' in patch) {
    const value = String(patch.semester || '').trim();
    if (value) next.semester = value.slice(0, 40);
  }
  if ('room' in patch) {
    const value = String(patch.room || '').trim().slice(0, 80);
    if (value) next.room = value;
  }

  db.prepare('UPDATE courses SET hall_id = ?, day = ?, start = ?, "end" = ?, window_minutes = ?, semester = ?, room = ? WHERE id = ?').run(
    next.hallId, next.day, next.start, next.end, next.windowMinutes, next.semester, next.room, courseId
  );
  bumpRevision(db);
  return courseJson(db, courseRow(db, courseId));
}

function setCourseRoster(db, courseId, studentIds, actorId) {
  const course = courseRow(db, courseId);
  if (!course) throw new ApiError(404, 'Course not found.');
  assertCourseOwner(db, course, actorId);
  if (course.roster_finalized_at) throw new ApiError(409, 'The register is final and cannot be changed.');

  const unique = [...new Set((studentIds || []).map(String))].filter((sid) => studentRow(db, sid));
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare('DELETE FROM enrollments WHERE course_id = ?').run(courseId);
    const insert = db.prepare('INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)');
    for (const sid of unique) insert.run(courseId, sid);
    bumpRevision(db);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return courseJson(db, courseRow(db, courseId), unique);
}

function finalizeCourseRoster(db, courseId, actorId) {
  const course = courseRow(db, courseId);
  if (!course) throw new ApiError(404, 'Course not found.');
  assertCourseOwner(db, course, actorId);
  if (course.roster_finalized_at) return courseJson(db, course);
  if (!enrolledIds(db, courseId).length) throw new ApiError(400, 'Add at least one student before posting the register.');
  db.prepare('UPDATE courses SET roster_finalized_at = ? WHERE id = ?').run(nowIso(), courseId);
  bumpRevision(db);
  return courseJson(db, courseRow(db, courseId));
}

function nextStudentId(db) {
  let max = 0;
  for (const row of db.prepare('SELECT id FROM students').all()) {
    const m = /^s(\d+)$/.exec(row.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (db.prepare('SELECT 1 FROM students WHERE id = ?').get(`s${n}`)) n++;
  return `s${n}`;
}

function importRoster(db, courseId, entries, actorId) {
  const course = courseRow(db, courseId);
  if (!course) throw new ApiError(404, 'Course not found.');
  assertCourseOwner(db, course, actorId);
  if (course.roster_finalized_at) throw new ApiError(409, 'The register is final and cannot be changed.');

  const added = [];
  const already = [];
  const invalid = [];
  const seen = new Set();

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const entry of entries || []) {
      const regNo = String(entry.regNo || '').trim();
      const name = String(entry.name || '').trim().replace(/\s+/g, ' ');
      if (!regNo || !name) {
        invalid.push(entry);
        continue;
      }
      const key = regNo.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);

      let student = db.prepare('SELECT * FROM students WHERE UPPER(reg_no) = ?').get(key);
      if (student) {
        db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name, student.id);
        student = db.prepare('SELECT * FROM students WHERE id = ?').get(student.id);
      } else {
        const sid = nextStudentId(db);
        db.prepare('INSERT INTO students (id, reg_no, name, email, program, year, phone) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          sid, regNo, name, '', course.department || 'Imported', 1, ''
        );
        student = db.prepare('SELECT * FROM students WHERE id = ?').get(sid);
      }

      const present = db.prepare('SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?').get(courseId, student.id);
      if (present) already.push(studentJson(student));
      else {
        db.prepare('INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)').run(courseId, student.id);
        added.push(studentJson(student));
      }
    }
    bumpRevision(db);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return { added, already, invalid };
}

function setCourseVenue(db, courseId, { lat, lng, accuracy, radius }, actorId) {
  const course = courseRow(db, courseId);
  if (!course) throw new ApiError(404, 'Course not found.');
  assertCourseOwner(db, course, actorId);
  if (course.roster_finalized_at) throw new ApiError(409, 'This class is final for the semester.');

  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
    throw new ApiError(400, 'The GPS fix did not contain valid coordinates.');
  }

  const fence = Math.min(200, Math.max(20, Number(radius) || 50));
  const hallId = `venue-${course.id}`;
  const existing = hallRow(db, hallId);
  if (existing) {
    db.prepare('UPDATE halls SET lat = ?, lng = ?, radius = ? WHERE id = ?').run(la, ln, fence, hallId);
  } else {
    db.prepare('INSERT INTO halls (id, name, building, lat, lng, radius) VALUES (?, ?, ?, ?, ?, ?)').run(
      hallId, `${course.code} classroom`, 'Captured venue', la, ln, fence
    );
  }

  db.prepare('UPDATE courses SET hall_id = ?, venue_captured_at = ?, venue_accuracy = ? WHERE id = ?').run(
    hallId,
    nowIso(),
    Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy)) : null,
    courseId
  );
  bumpRevision(db);
  return hallJson(hallRow(db, hallId));
}

function studentJson(row) {
  return { id: row.id, regNo: row.reg_no, name: row.name, email: row.email, program: row.program, year: row.year, phone: row.phone };
}

function reset(db) {
  return resetState(db);
}

module.exports = {
  ApiError,
  startSession,
  endSession,
  rotateCode,
  lookupSession,
  checkIn,
  createCourse,
  updateCourseSetup,
  setCourseRoster,
  finalizeCourseRoster,
  importRoster,
  setCourseVenue,
  reset,
  sweepExpired,
  haversineMeters
};
