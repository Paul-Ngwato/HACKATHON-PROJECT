/**
 * AttendEase cloud — roster and report sync.
 *
 * The phone that ran a class owns that class's records. This Worker is a
 * durable shelf for two things and nothing more:
 *
 *   rosters   the unit + enrolled students a lecturer published
 *   reports   the sessions and check-ins that phone finished
 *
 * Everything is keyed by a class code the lecturer chooses (DBM412), and
 * writes need the class key that phone generated. Reads of one class are
 * public by code, because a join code is not a secret and the payload holds
 * no credentials.
 *
 * Sync is idempotent: sessions and records are inserted with their own ids, so
 * a phone that retries after a dropped connection cannot create duplicates.
 */

const JSON_TYPE = 'application/json; charset=utf-8';

let schemaPromise = null;

function schema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS classes (
        code TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        code TEXT NOT NULL,
        id TEXT NOT NULL,
        course_id TEXT NOT NULL,
        day TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (code, id)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS records (
        code TEXT NOT NULL,
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        day TEXT NOT NULL,
        status TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (code, id)
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS records_by_code ON records (code, student_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS sessions_by_code ON sessions (code, day)`)
    ]).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store' }
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function text(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeCode(value) {
  return text(value, 24).toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/** Trim whatever a phone sends down to the fields this shelf stores. */
function cleanClass(body) {
  const unit = body.unit && typeof body.unit === 'object' ? body.unit : {};
  const students = Array.isArray(body.students) ? body.students : [];
  return {
    code: normalizeCode(body.code),
    unit: {
      id: text(unit.id, 40),
      code: text(unit.code, 16),
      name: text(unit.name, 120),
      lecturerId: text(unit.lecturerId, 40),
      lecturerName: text(unit.lecturerName, 80),
      hallId: text(unit.hallId, 40),
      hallName: text(unit.hallName, 80),
      room: text(unit.room, 80),
      schedule: text(unit.schedule, 80)
    },
    students: students
      .filter((s) => s && typeof s === 'object')
      .slice(0, 600)
      .map((s) => ({
        id: text(s.id, 40),
        regNo: text(s.regNo, 40),
        name: text(s.name, 80),
        courseIds: Array.isArray(s.courseIds) ? s.courseIds.slice(0, 40).map((c) => text(c, 40)) : []
      }))
      .filter((s) => s.id)
  };
}

function cleanSessions(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).map((session) => {
    const records = Array.isArray(session.records) ? session.records : [];
    return {
      id: text(session.id, 60),
      courseId: text(session.courseId, 40),
      day: text(session.day, 10),
      startedAt: text(session.startedAt, 40),
      endedAt: text(session.endedAt, 40),
      records: records.slice(0, 600).map((record) => ({
        id: text(record.id, 80),
        studentId: text(record.studentId, 40),
        status: text(record.status, 20) || 'present',
        at: Number(record.at) || Date.now(),
        distanceM: Number(record.distanceM) || 0
      })).filter((record) => record.id && record.studentId)
    };
  }).filter((session) => session.id && session.day);
}

/** Writes need the key the publishing phone made. */
async function authorizeClass(env, code, key) {
  const row = await env.DB.prepare('SELECT key_hash FROM classes WHERE code = ?').bind(code).first();
  if (!row) return { ok: true, existing: false };
  if (!key) return { ok: false, status: 401, error: 'class key required' };
  const hash = await sha256(key);
  if (hash !== row.key_hash) return { ok: false, status: 403, error: 'class key does not match' };
  return { ok: true, existing: true };
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch (err) {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400'
        }
      });
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'attendease-cloud', time: Date.now() });
    }

    try {
      await schema(env);
    } catch (err) {
      return fail(`storage unavailable: ${err && err.message ? err.message : 'unknown'}`, 503);
    }

    // --- lecturer publishes a unit + roster -------------------------------
    if (url.pathname === '/api/v1/classes' && request.method === 'POST') {
      const body = await readJson(request);
      if (!body) return fail('expected a JSON body');
      const doc = cleanClass(body);
      if (!doc.code || doc.code.length < 3) return fail('a class code of at least 3 characters is required');
      const key = text(body.key, 120);
      if (!key || key.length < 6) return fail('a class key of at least 6 characters is required');

      const allowed = await authorizeClass(env, doc.code, key);
      if (!allowed.ok) return fail(allowed.error, allowed.status);

      const now = Date.now();
      const hash = allowed.existing ? null : await sha256(key);
      if (allowed.existing) {
        await env.DB.prepare('UPDATE classes SET payload = ?, revision = revision + 1, updated_at = ? WHERE code = ?')
          .bind(JSON.stringify(doc), now, doc.code).run();
      } else {
        await env.DB.prepare('INSERT INTO classes (code, key_hash, payload, revision, updated_at) VALUES (?, ?, ?, 1, ?)')
          .bind(doc.code, hash, JSON.stringify(doc), now).run();
      }
      const row = await env.DB.prepare('SELECT revision FROM classes WHERE code = ?').bind(doc.code).first();
      return json({ ok: true, code: doc.code, students: doc.students.length, revision: row ? row.revision : 1 });
    }

    // --- read a class (roster) by code ------------------------------------
    if (url.pathname === '/api/v1/classes' && request.method === 'GET') {
      const code = normalizeCode(url.searchParams.get('code') || '');
      const student = text(url.searchParams.get('student') || '', 40);
      if (!code && !student) return fail('pass code= or student=');

      if (student) {
        const rows = await env.DB.prepare(
          "SELECT code, payload, revision, updated_at FROM classes WHERE payload LIKE ? ORDER BY updated_at DESC LIMIT 30"
        ).bind(`%"${student}"%`).all();
        const classes = (rows.results || [])
          .map((row) => {
            try {
              const doc = JSON.parse(row.payload);
              const enrolled = (doc.students || []).find((s) => s.id === student);
              if (!enrolled) return null;
              return {
                code: row.code,
                unit: doc.unit,
                me: enrolled,
                classmates: (doc.students || []).length,
                revision: row.revision,
                updatedAt: row.updated_at
              };
            } catch (err) {
              return null;
            }
          })
          .filter(Boolean);
        return json({ ok: true, classes });
      }

      const row = await env.DB.prepare('SELECT payload, revision, updated_at FROM classes WHERE code = ?').bind(code).first();
      if (!row) return fail('no class published under that code', 404);
      return json({ ok: true, class: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at });
    }

    const classRoute = url.pathname.match(/^\/api\/v1\/classes\/([A-Za-z0-9-]{3,24})\/reports$/);
    if (classRoute) {
      const code = normalizeCode(classRoute[1]);

      // --- lecturer pushes finished sessions ------------------------------
      if (request.method === 'POST') {
        const body = await readJson(request);
        if (!body) return fail('expected a JSON body');
        const allowed = await authorizeClass(env, code, text(body.key, 120));
        if (!allowed.ok) return fail(allowed.error, allowed.status);

        const sessions = cleanSessions(body.sessions);
        const now = Date.now();
        let insertedSessions = 0;
        let insertedRecords = 0;

        for (const session of sessions) {
          const payload = JSON.stringify({ ...session, records: undefined, count: session.records.length });
          const result = await env.DB.prepare(
            'INSERT OR IGNORE INTO sessions (code, id, course_id, day, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(code, session.id, session.courseId, session.day, payload, now).run();
          if (result.meta && result.meta.changes) insertedSessions += 1;

          const statements = session.records.map((record) => env.DB.prepare(
            'INSERT OR IGNORE INTO records (code, id, session_id, student_id, day, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(code, record.id, session.id, record.studentId, session.day, record.status, record.at));
          if (statements.length) {
            const bulk = await env.DB.batch(statements);
            insertedRecords += bulk.reduce((sum, r) => sum + ((r.meta && r.meta.changes) || 0), 0);
          }
        }

        return json({ ok: true, code, sessions: sessions.length, insertedSessions, insertedRecords });
      }

      // --- lecturer reads the merged report -------------------------------
      if (request.method === 'GET') {
        const key = text(url.searchParams.get('key') || '', 120);
        const allowed = await authorizeClass(env, code, key);
        if (!allowed.ok) return fail(allowed.error, allowed.status);

        const totals = await env.DB.prepare(
          "SELECT student_id, COUNT(*) AS present FROM records WHERE code = ? AND status IN ('present','late') GROUP BY student_id"
        ).bind(code).all();
        const sessions = await env.DB.prepare(
          'SELECT day, course_id, COUNT(*) AS sessions FROM sessions WHERE code = ? GROUP BY day, course_id ORDER BY day'
        ).bind(code).all();

        return json({
          ok: true,
          code,
          students: (totals.results || []).map((r) => ({ studentId: r.student_id, present: r.present })),
          days: sessions.results || []
        });
      }
    }

    return fail('not found', 404);
  }
};
