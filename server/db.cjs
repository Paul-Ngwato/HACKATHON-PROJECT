/**
 * AttendEase — SQLite store.
 *
 * One shared database for every phone: reference data (students, courses,
 * halls), attendance sessions, posted records, device locks and audit events.
 * The server is the only writer, so check-in rules are enforced once.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { buildSeed, VERSION } = require('./seed.cjs');

function connect(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  // WAL + NORMAL: a full class posting together does not fsync per record.
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  if (!metaGet(db, 'created_at')) resetState(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS halls (
      id       TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      building TEXT,
      lat      REAL NOT NULL,
      lng      REAL NOT NULL,
      radius   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lecturers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT,
      department TEXT,
      title      TEXT
    );

    CREATE TABLE IF NOT EXISTS students (
      id      TEXT PRIMARY KEY,
      reg_no  TEXT NOT NULL UNIQUE,
      name    TEXT NOT NULL,
      email   TEXT,
      program TEXT,
      year    INTEGER,
      phone   TEXT
    );

    CREATE TABLE IF NOT EXISTS courses (
      id                  TEXT PRIMARY KEY,
      code                TEXT NOT NULL,
      name                TEXT NOT NULL,
      department          TEXT,
      lecturer_id         TEXT NOT NULL,
      day                 INTEGER NOT NULL,
      start               TEXT NOT NULL,
      "end"               TEXT NOT NULL,
      hall_id             TEXT NOT NULL,
      credits             INTEGER,
      semester            TEXT,
      window_minutes      INTEGER NOT NULL DEFAULT 15,
      room                TEXT,
      roster_finalized_at TEXT,
      venue_captured_at   TEXT,
      venue_accuracy      INTEGER
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      course_id  TEXT NOT NULL,
      student_id TEXT NOT NULL,
      PRIMARY KEY (course_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      course_id   TEXT NOT NULL,
      lecturer_id TEXT NOT NULL,
      hall_id     TEXT NOT NULL,
      code        TEXT NOT NULL,
      token       TEXT,
      ble_name    TEXT,
      started_at  TEXT NOT NULL,
      ends_at     TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      lat         REAL,
      lng         REAL,
      radius      INTEGER,
      accuracy    INTEGER,
      status      TEXT NOT NULL,
      ended_at    TEXT,
      seeded      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      course_id     TEXT NOT NULL,
      student_id    TEXT NOT NULL,
      checked_in_at TEXT NOT NULL,
      method        TEXT,
      distance_m    INTEGER,
      status        TEXT NOT NULL,
      device_id     TEXT,
      UNIQUE (session_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS identity_locks (
      device_id  TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id         TEXT PRIMARY KEY,
      at         TEXT NOT NULL,
      session_id TEXT,
      course_id  TEXT,
      student_id TEXT,
      type       TEXT NOT NULL,
      detail     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance (session_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance (student_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_course    ON sessions (course_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_code      ON sessions (code, status);
    CREATE INDEX IF NOT EXISTS idx_events_session     ON security_events (session_id);
  `);

  // Migrate databases created by earlier AttendSmart builds. Every statement
  // is additive, so existing attendance history is preserved.
  ensureColumns(db, 'courses', [
    ['room', 'TEXT']
  ]);
  ensureColumns(db, 'sessions', [
    ['lat', 'REAL'],
    ['lng', 'REAL'],
    ['radius', 'INTEGER'],
    ['accuracy', 'INTEGER']
  ]);
}

function ensureColumns(db, table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const [name, type] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`);
  }
}

/* ------------------------------------------------------------------ */
/* Meta + revisions                                                    */
/* ------------------------------------------------------------------ */

function metaGet(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function metaSet(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

function revisionOf(db) {
  return Number(metaGet(db, 'revision') || 0);
}

function bumpRevision(db) {
  const next = revisionOf(db) + 1;
  metaSet(db, 'revision', next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Seed / reset                                                        */
/* ------------------------------------------------------------------ */

function resetState(db) {
  const seed = buildSeed();

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const table of ['security_events', 'identity_locks', 'attendance', 'sessions', 'enrollments', 'courses', 'students', 'lecturers', 'halls', 'meta']) {
      db.exec(`DELETE FROM ${table};`);
    }

    metaSet(db, 'version', VERSION);
    metaSet(db, 'created_at', seed.createdAt);
    metaSet(db, 'university', JSON.stringify(seed.university));
    metaSet(db, 'admin', JSON.stringify(seed.admin));
    metaSet(db, 'revision', 1);

    const insertHall = db.prepare('INSERT INTO halls (id, name, building, lat, lng, radius) VALUES (?, ?, ?, ?, ?, ?)');
    for (const h of seed.halls) insertHall.run(h.id, h.name, h.building || '', h.lat, h.lng, h.radius);

    const insertLecturer = db.prepare('INSERT INTO lecturers (id, name, email, department, title) VALUES (?, ?, ?, ?, ?)');
    for (const l of seed.lecturers) insertLecturer.run(l.id, l.name, l.email || '', l.department || '', l.title || '');

    const insertStudent = db.prepare('INSERT INTO students (id, reg_no, name, email, program, year, phone) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const s of seed.students) insertStudent.run(s.id, s.regNo, s.name, s.email || '', s.program || '', s.year || 1, s.phone || '');

    const insertCourse = db.prepare(`
      INSERT INTO courses (id, code, name, department, lecturer_id, day, start, "end", hall_id, credits, semester, window_minutes, room, roster_finalized_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEnrollment = db.prepare('INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)');
    for (const c of seed.courses) {
      insertCourse.run(
        c.id, c.code, c.name, c.department || '', c.lecturerId, c.day, c.start, c.end,
        c.hallId, c.credits || 3, c.semester || '', c.windowMinutes || 15, c.room || '', c.rosterFinalizedAt || null
      );
      for (const studentId of c.studentIds) insertEnrollment.run(c.id, studentId);
    }

    const insertSession = db.prepare(`
      INSERT INTO sessions (id, course_id, lecturer_id, hall_id, code, token, ble_name, started_at, ends_at, duration_min, status, ended_at, seeded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of seed.sessions) {
      insertSession.run(
        s.id, s.courseId, s.lecturerId, s.hallId, s.code, s.token || '', s.bleName || '',
        s.startedAt, s.endsAt, s.durationMin, s.status, s.endedAt || null, s.seeded ? 1 : 0
      );
    }

    const insertAttendance = db.prepare(`
      INSERT OR IGNORE INTO attendance (id, session_id, course_id, student_id, checked_in_at, method, distance_m, status, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of seed.attendance) {
      insertAttendance.run(a.id, a.sessionId, a.courseId, a.studentId, a.checkedInAt, a.method || 'code', a.distanceM, a.status, a.deviceId || '');
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return loadState(db);
}

/* ------------------------------------------------------------------ */
/* Read the whole state in the shape the frontend expects              */
/* ------------------------------------------------------------------ */

function loadState(db) {
  const halls = db.prepare('SELECT * FROM halls ORDER BY id').all().map((h) => ({
    id: h.id, name: h.name, building: h.building, lat: h.lat, lng: h.lng, radius: h.radius
  }));

  const lecturers = db.prepare('SELECT * FROM lecturers ORDER BY id').all().map((l) => ({
    id: l.id, name: l.name, email: l.email, department: l.department, title: l.title
  }));

  const students = db.prepare('SELECT * FROM students ORDER BY id').all().map((s) => ({
    id: s.id, regNo: s.reg_no, name: s.name, email: s.email, program: s.program, year: s.year, phone: s.phone
  }));

  const enrolled = new Map();
  for (const row of db.prepare('SELECT course_id, student_id FROM enrollments').all()) {
    if (!enrolled.has(row.course_id)) enrolled.set(row.course_id, []);
    enrolled.get(row.course_id).push(row.student_id);
  }

  const courses = db.prepare('SELECT * FROM courses ORDER BY id').all().map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    department: c.department,
    lecturerId: c.lecturer_id,
    day: c.day,
    start: c.start,
    end: c.end,
    hallId: c.hall_id,
    credits: c.credits,
    semester: c.semester,
    windowMinutes: c.window_minutes,
    room: c.room || '',
    rosterFinalizedAt: c.roster_finalized_at,
    venueCapturedAt: c.venue_captured_at,
    venueAccuracy: c.venue_accuracy,
    studentIds: enrolled.get(c.id) || []
  }));

  const sessions = db.prepare('SELECT * FROM sessions ORDER BY started_at, id').all().map((s) => ({
    id: s.id,
    courseId: s.course_id,
    lecturerId: s.lecturer_id,
    hallId: s.hall_id,
    code: s.code,
    token: s.token,
    bleName: s.ble_name,
    startedAt: s.started_at,
    endsAt: s.ends_at,
    durationMin: s.duration_min,
    lat: s.lat,
    lng: s.lng,
    radius: s.radius,
    accuracy: s.accuracy,
    status: s.status,
    endedAt: s.ended_at,
    seeded: !!s.seeded
  }));

  const attendance = db.prepare('SELECT * FROM attendance ORDER BY checked_in_at, id').all().map((a) => ({
    id: a.id,
    sessionId: a.session_id,
    courseId: a.course_id,
    studentId: a.student_id,
    checkedInAt: a.checked_in_at,
    method: a.method,
    distanceM: a.distance_m,
    status: a.status,
    deviceId: a.device_id
  }));

  const identityLocks = db.prepare('SELECT * FROM identity_locks ORDER BY at').all().map((l) => ({
    deviceId: l.device_id, studentId: l.student_id, at: l.at
  }));

  const securityEvents = db.prepare('SELECT * FROM security_events ORDER BY at, id').all().map((e) => ({
    id: e.id,
    at: e.at,
    sessionId: e.session_id,
    courseId: e.course_id,
    studentId: e.student_id,
    type: e.type,
    detail: e.detail
  }));

  const universityRaw = metaGet(db, 'university');
  const adminRaw = metaGet(db, 'admin');

  return {
    version: Number(metaGet(db, 'version') || VERSION),
    revision: revisionOf(db),
    createdAt: metaGet(db, 'created_at'),
    university: universityRaw ? JSON.parse(universityRaw) : { name: 'Baraton University' },
    admin: adminRaw ? JSON.parse(adminRaw) : null,
    halls,
    lecturers,
    students,
    courses,
    sessions,
    attendance,
    identityLocks,
    securityEvents
  };
}

module.exports = {
  connect,
  loadState,
  resetState,
  revisionOf,
  bumpRevision
};
