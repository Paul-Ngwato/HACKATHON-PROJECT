/**
 * AttendEase — whole-class load test.
 *
 * Opens one real session and posts every enrolled student at the same moment,
 * the way a lecture hall does when the code appears on the projector. Reports
 * wall time and per-request latency, and verifies every record landed.
 *
 *   node tools/loadtest.cjs                      # against http://localhost:4199
 *   BASE=http://localhost:4173 node tools/loadtest.cjs
 *   COURSE=c1 N=85 node tools/loadtest.cjs
 */

'use strict';

const BASE = (process.env.BASE || 'http://localhost:4199').replace(/\/+$/, '');
const COURSE_ID = process.env.COURSE || 'c1';
const LAT = Number(process.env.LAT || -0.157);
const LNG = Number(process.env.LNG || 35.269);

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const initial = await api('/api/state');
  const course = initial.state.courses.find((c) => c.id === COURSE_ID);
  if (!course) throw new Error(`No course ${COURSE_ID} in ${BASE}`);

  for (const session of initial.state.sessions.filter((s) => s.courseId === course.id && s.status === 'active')) {
    await api('/api/sessions/end', { sessionId: session.id, actorId: course.lecturerId });
  }

  const started = await api('/api/sessions/start', {
    courseId: course.id,
    actorId: course.lecturerId,
    durationMin: 30,
    lat: LAT,
    lng: LNG,
    radius: 100,
    accuracy: 8
  });
  const session = started.result;
  const roster = course.studentIds.slice(0, Number(process.env.N || course.studentIds.length));

  console.log(`Course ${course.code} (${roster.length} students) · session ${session.id} · code ${session.code}`);

  const wallStart = Date.now();
  const results = await Promise.all(
    roster.map(async (studentId, index) => {
      const at = Date.now();
      try {
        const data = await api('/api/checkin', {
          code: session.code,
          studentId,
          deviceId: `load-${index}`,
          lat: LAT,
          lng: LNG,
          accuracy: 8
        });
        return { ok: data.result.ok, ms: Date.now() - at, message: data.result.message || '' };
      } catch (err) {
        return { ok: false, ms: Date.now() - at, message: err.message };
      }
    })
  );
  const wallMs = Date.now() - wallStart;

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const times = results.map((r) => r.ms);

  const after = await api('/api/state');
  const recorded = after.state.attendance.filter((a) => a.sessionId === session.id).length;

  console.log(
    JSON.stringify(
      {
        students: roster.length,
        posted: ok.length,
        failed: failed.length,
        recordedInDb: recorded,
        wallMs,
        perRequestMs: { p50: percentile(times, 50), p95: percentile(times, 95), max: Math.max(...times) },
        throughputPerSec: Number(((roster.length / wallMs) * 1000).toFixed(1)),
        failures: failed.slice(0, 5)
      },
      null,
      2
    )
  );

  if (failed.length || recorded !== ok.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
