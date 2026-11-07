/**
 * AttendSmart AI — student experience.
 *
 * Deliberately minimal: scan, pick the class, confirm, post. There is no code
 * to type and nothing to edit afterwards — the posted record is final.
 *
 * Overview and history stay available, but the check-in screen is a three-tap
 * flow so a student can do it while walking into the room.
 */

import {
  activeSessions,
  checkIn,
  courseById,
  hallById,
  haversineMeters,
  lecturerById,
  LATE_GRACE_MIN
} from '../data.js';
import { studentOverview, round1, pctOf } from '../analytics.js';
import {
  icon,
  esc,
  attendancePill,
  statusPill,
  fmtDate,
  fmtDateShort,
  fmtTime,
  fmtDateTime,
  toast,
  downloadCSV,
  methodLabel,
  pctText
} from '../ui.js';
import { createGpsFeed } from '../gps.js';

/* ------------------------------------------------------------------ */
/* Transient check-in state                                            */
/* ------------------------------------------------------------------ */

const state = {
  userId: null,
  scanning: false,
  scanned: false,
  discovered: [],
  sessionId: null,
  receipt: null,
  gps: null,
  historyCourse: 'all'
};

let feed = null;
let scanTimer = null;

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export function overview(ctx) {
  const { db, user } = ctx;
  const ov = studentOverview(db, user.id);
  const current = ov.active[0] || null;
  const atRisk = ov.courses.filter((c) => c.pct < 70).length;

  const banner = current
    ? `<div class="alert alert-green mb-16">
        <span class="alert-icon">${icon('bluetooth', 16)}</span>
        <div class="grow">
          <div class="alert-title">${esc(current.course.code)} attendance is open</div>
          <div class="alert-body">Post before ${fmtTime(current.session.endsAt)}. Scan, confirm, done.</div>
        </div>
        <a class="btn btn-green btn-sm" href="#/student/checkin">Post attendance ${icon('arrow', 14)}</a>
      </div>`
    : '';

  const rows = ov.courses.length
    ? ov.courses
        .map(({ course, attended, total, pct }) => {
          const lecturer = lecturerById(db, course.lecturerId);
          return `<tr>
            <td><div class="strong">${esc(course.code)}</div><div class="muted tiny">${esc(course.name)}</div></td>
            <td>${esc(lecturer ? lecturer.name : '—')}</td>
            <td class="num nowrap"><span class="strong">${attended}</span><span class="muted"> / ${total}</span></td>
            <td class="num strong">${pctText(pct)}</td>
            <td>${attendancePill(pct)}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5"><div class="empty">No classes registered yet.</div></td></tr>`;

  const html = `${banner}
    <div class="card">
      <div class="card-head">
        <div class="card-title">${icon('book', 16)} My classes</div>
        <span class="card-hint">${ov.courses.length} classes · ${atRisk ? `${atRisk} at risk` : 'all on track'}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Class</th><th>Lecturer</th><th class="num">Sessions</th><th class="num">Attendance</th><th>Status</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card-foot">
        <span class="muted tiny">${ov.attended} of ${ov.total} sessions attended overall · ${pctText(ov.pct)}</span>
        <span class="muted tiny">Updates automatically as each session is held</span>
      </div>
    </div>`;

  return {
    eyebrow: 'Student dashboard',
    title: `Hi, ${user.name.split(' ')[0]}`,
    sub: `${user.regNo} · ${user.program}`,
    actions: `<a class="btn btn-soft btn-sm" href="#/student/history">${icon('clock', 15)} History</a>`,
    html
  };
}

/* Check-in helpers                                                    */
/* ------------------------------------------------------------------ */

function distanceTo(hall) {
  const gps = state.gps;
  if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) return null;
  return haversineMeters({ lat: gps.lat, lng: gps.lng }, hall);
}

function locationStatus(hall) {
  const gps = state.gps;
  const dist = distanceTo(hall);
  const inside = dist !== null && dist <= hall.radius;

  let tone = '';
  let label = 'Waiting for location';
  let detail = 'Pick a location source below.';

  if (gps) {
    if (gps.status === 'locating') {
      tone = 'pill-amber';
      label = 'Getting location';
      detail = gps.error || 'Listening for a fix…';
    } else if (gps.status === 'error') {
      tone = 'pill-red';
      label = 'No usable location';
      detail = gps.error || 'Location unavailable.';
    } else if (gps.status === 'ok') {
      tone = 'pill-green';
      label = 'Phone location';
      detail = `±${Math.round(gps.accuracy || 0)} m`;
    }
  }

  return `<div class="spread" style="align-items:flex-start">
      <div>
        <span class="pill ${tone}"><span class="dot"></span>${esc(label)}</span>
        <div class="muted tiny mt-8">${esc(detail)}</div>
      </div>
      ${dist !== null ? `<span class="pill ${inside ? 'pill-green' : 'pill-red'}">${Math.round(dist)} m / ${hall.radius} m</span>` : ''}
    </div>`;
}

function locationBlock(hall) {
  return `<div id="gps-live">${locationStatus(hall)}</div>
    <div class="row mt-12">
      <button class="btn btn-soft btn-sm" data-action="retry-gps">${icon('refresh', 14)} Refresh location</button>
      <span class="muted tiny">Uses this phone's GPS only.</span>
    </div>`;
}

function receiptHTML(ctx, receipt) {
  const { db } = ctx;
  const session = receipt.session || db.sessions.find((s) => s.id === receipt.sessionId);
  const course = receipt.course || (session ? courseById(db, session.courseId) : null);

  if (!receipt.ok) {
    return `<div class="card">
      <div class="card-head">
        <div class="card-title">${icon('alert', 16)} Attendance not posted</div>
        <span class="pill pill-red">Rejected</span>
      </div>
      <div class="card-body">
        <div class="alert alert-red mb-16">
          <span class="alert-icon">${icon('lock', 15)}</span>
          <div>
            <div class="alert-title">${receipt.step === 'enrolled' ? 'Not on the final register' : receipt.step === 'identity' ? 'Identity already bound' : 'Could not verify attendance'}</div>
            <div class="alert-body">${esc(receipt.message)}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-block" data-action="retry">Try again</button>
        <button class="btn btn-soft btn-block mt-8" data-action="change">Choose another class</button>
      </div>
    </div>`;
  }

  const record = receipt.record;
  return `<div class="card">
    <div class="card-head">
      <div class="card-title">${icon('check', 16)} Attendance posted</div>
      <span class="pill ${record.status === 'late' ? 'pill-amber' : 'pill-green'}">${record.status === 'late' ? 'Late' : 'Present'}</span>
    </div>
    <div class="card-body">
      <div class="alert alert-green mb-16">
        <span class="alert-icon">${icon('shield', 15)}</span>
        <div>
          <div class="alert-title">Locked to your identity</div>
          <div class="alert-body">This record is final. It cannot be edited, moved or reassigned to anyone else.</div>
        </div>
      </div>
      <div class="stat-row"><span class="k">Class</span><span class="v">${esc(course.code)} · ${esc(course.name)}</span></div>
      <div class="stat-row"><span class="k">Posted</span><span class="v">${fmtDateTime(record.checkedInAt)}</span></div>
      <div class="stat-row"><span class="k">Method</span><span class="v">Bluetooth proximity + GPS</span></div>
      <div class="stat-row"><span class="k">Distance from hall</span><span class="v">${record.distanceM} m</span></div>
      <div class="row mt-16">
        <a class="btn btn-soft grow" href="#/student/overview">Back to dashboard</a>
        <button class="btn btn-primary grow" data-action="done">Done</button>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Check in                                                            */
/* ------------------------------------------------------------------ */

export function checkin(ctx) {
  const { db, user } = ctx;

  // A different student signing in on the same tab must never inherit the
  // previous student's selection, GPS fix or posted receipt.
  if (state.userId !== user.id) {
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    Object.assign(state, {
      userId: user.id,
      scanning: false,
      scanned: false,
      discovered: [],
      sessionId: null,
      receipt: null,
      gps: null
    });
  }

  const open = activeSessions(db);
  // Only classes this device has actually heard may be selected or posted.
  const heard = open.filter((s) => state.discovered.includes(s.id));
  const selected = state.sessionId ? heard.find((s) => s.id === state.sessionId) || null : null;
  if (state.sessionId && !selected) state.sessionId = null;

  const course = selected ? courseById(db, selected.courseId) : null;
  const hall = selected ? hallById(db, selected.hallId) : null;
  const enrolled = course ? course.studentIds.includes(user.id) : false;
  const minutesLeft = selected ? Math.max(0, Math.round((new Date(selected.endsAt) - Date.now()) / 60000)) : 0;

  const scanPanel = state.scanning
    ? `<div class="row" style="gap:16px;padding:8px 0">
        <div class="radar" style="width:92px;max-width:92px">
          <span class="ring-line"></span><span class="ring-line"></span><span class="ring-line"></span>
          <span class="sweep"></span>
          <span class="core" style="width:40px;height:40px">${icon('bluetooth', 18)}</span>
        </div>
        <div>
          <div class="strong">Listening for class broadcasts…</div>
          <div class="muted small mt-4">Keep the app open — this takes a moment.</div>
        </div>
      </div>`
    : `<div class="row" style="justify-content:space-between;gap:14px">
        <div>
          <div class="strong">${open.length ? `${open.length} class${open.length === 1 ? '' : 'es'} taking attendance now` : 'No attendance open nearby'}</div>
          <div class="muted small mt-4">${open.length ? 'Pick your class, check the details, then post.' : 'Ask your lecturer to start the attendance window.'}</div>
        </div>
        <button class="btn ${state.scanned ? 'btn-soft' : 'btn-dark'}" id="scan-ble">${icon('scan', 15)} ${state.scanned ? 'Scan again' : 'Scan for classes'}</button>
      </div>`;

  const classOptions = heard.length
    ? `<div class="mt-16">
        ${heard
          .map((s) => {
            const c = courseById(db, s.courseId);
            const h = hallById(db, s.hallId);
            const isEnrolled = c.studentIds.includes(user.id);
            const isSelected = s.id === state.sessionId;
            return `<button class="session-option mt-8${isSelected ? ' selected' : ''}" data-session="${s.id}">
              <span class="ic">${icon('bluetooth', 18)}</span>
              <span class="m">
                <span class="t">${esc(c.code)} · ${esc(c.name)}</span>
                <span class="s">${esc(h ? h.name : 'Classroom')} · closes in ${Math.max(0, Math.round((new Date(s.endsAt) - Date.now()) / 60000))} min</span>
              </span>
              ${isEnrolled ? '<span class="pill pill-green">On register</span>' : '<span class="pill pill-amber">Not on register</span>'}
              ${isSelected ? `<span class="tick" style="color:var(--brand)">${icon('check', 17)}</span>` : ''}
            </button>`;
          })
          .join('')}
      </div>`
    : '';

  const scanCard = `<div class="card mb-16">
    <div class="card-head">
      <div class="card-title">${icon('bluetooth', 16)} Nearby classes</div>
      <span class="pill ${state.scanning ? 'pill-amber' : heard.length ? 'pill-green' : ''}">${
        state.scanning ? 'Scanning' : heard.length ? `${heard.length} open` : state.scanned ? 'None found' : 'Not scanned'
      }</span>
    </div>
    <div class="card-body">${scanPanel}${classOptions}</div>
  </div>`;

  let detail = '';
  if (state.receipt) {
    detail = receiptHTML(ctx, state.receipt);
  } else if (selected && course && hall) {
    detail = `<div class="card">
      <div class="card-head">
        <div class="card-title">${icon('check', 16)} Confirm attendance</div>
        <span class="pill pill-live"><span class="dot"></span>Window open</span>
      </div>
      <div class="card-body">
        <div class="spread" style="align-items:flex-start">
          <div>
            <span class="pill pill-brand">${esc(course.code)}</span>
            <h2 style="font-size:18px;margin-top:8px">${esc(course.name)}</h2>
            <div class="muted small mt-4">${esc((lecturerById(db, selected.lecturerId) || {}).name || 'Lecturer')}</div>
          </div>
          <span class="pill ${enrolled ? 'pill-green' : 'pill-red'}">${enrolled ? 'On final register' : 'Not on final register'}</span>
        </div>

        <div class="grid grid-3 mt-16">
          <div class="stat-row" style="border:none;display:block">
            <div class="k">Venue</div>
            <div class="v">${esc(hall.name)}</div>
            <div class="muted tiny">${hall.radius} m radius</div>
          </div>
          <div class="stat-row" style="border:none;display:block">
            <div class="k">Window</div>
            <div class="v">${fmtTime(selected.startedAt)} – ${fmtTime(selected.endsAt)}</div>
            <div class="muted tiny">${minutesLeft} min left</div>
          </div>
          <div class="stat-row" style="border:none;display:block">
            <div class="k">Posted as</div>
            <div class="v">${esc(user.name)}</div>
            <div class="muted tiny">${esc(user.regNo)}</div>
          </div>
        </div>

        <div class="alert alert-amber mt-16">
          <span class="alert-icon">${icon('lock', 15)}</span>
          <div>
            <div class="alert-title">This cannot be changed after posting</div>
            <div class="alert-body">Your name is locked to this record and this device. One post per class, no edits, no reassignment.</div>
          </div>
        </div>

        <div class="mt-16">
          <div class="row" style="justify-content:space-between">
            <span class="small strong">Location check</span>
            <span class="muted tiny">Bluetooth already verified</span>
          </div>
          <div class="mt-8">${locationBlock(hall)}</div>
        </div>

        <div class="row mt-16">
          <button class="btn btn-soft" data-action="change">Change class</button>
          <button class="btn btn-primary grow" id="post-attendance">${icon('check', 16)} Confirm & post attendance</button>
        </div>
      </div>
    </div>`;
  } else {
    detail = `<div class="card card-pad" style="text-align:center;padding:30px">
      <div class="muted small">${state.scanned ? 'Choose a class above to continue.' : 'Scan first, then pick your class.'}</div>
    </div>`;
  }

  return {
    eyebrow: 'Attendance',
    title: 'Post attendance',
    sub: 'Scan, confirm, done. Nothing to type.',
    actions: `<a class="btn btn-soft btn-sm" href="#/student/overview">${icon('grid', 15)} Dashboard</a>`,
    html: `${scanCard}${detail}`,
    mount(root) {
      const scanBtn = root.querySelector('#scan-ble');
      if (scanBtn) scanBtn.addEventListener('click', () => startScan(ctx));

      root.querySelectorAll('[data-session]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.sessionId = btn.dataset.session;
          state.receipt = null;
          state.gps = null;
          ctx.refresh();
        });
      });

      if (selected && hall) {
        const startFeed = () => {
          if (feed) feed.stop();
          state.gps = null;
          feed = createGpsFeed((gps) => {
            state.gps = gps;
            const holder = root.querySelector('#gps-live');
            if (holder) holder.innerHTML = locationStatus(hall);
          });
          feed.start('device');
        };
        startFeed();

        const retryGps = root.querySelector('[data-action="retry-gps"]');
        if (retryGps) retryGps.addEventListener('click', () => startFeed());

        const postBtn = root.querySelector('#post-attendance');
        if (postBtn) {
          postBtn.addEventListener('click', () => {
            const fresh = ctx.db.sessions.find((s) => s.id === state.sessionId && s.status === 'active');
            if (!fresh) {
              toast('Attendance closed', { message: 'The window closed before you posted.', tone: 'error' });
              state.sessionId = null;
              ctx.refresh();
              return;
            }
            const freshHall = hallById(ctx.db, fresh.hallId);
            const result = checkIn(ctx.db, {
              sessionId: fresh.id,
              studentId: ctx.user.id,
              distanceM: distanceTo(freshHall),
              deviceId: ctx.deviceId,
              bleVerified: state.discovered.includes(fresh.id),
              method: 'ble'
            });
            state.receipt = result;
            toast(result.ok ? 'Attendance posted' : 'Attendance not posted', {
              message: result.ok ? 'Locked to your identity — nothing to edit.' : result.message,
              tone: result.ok ? 'success' : 'error',
              duration: result.ok ? 4200 : 6500
            });
            ctx.refresh();
          });
        }
      }

      root.querySelectorAll('[data-action="change"]').forEach((b) =>
        b.addEventListener('click', () => {
          state.sessionId = null;
          state.receipt = null;
          state.gps = null;
          ctx.refresh();
        })
      );

      root.querySelectorAll('[data-action="retry"]').forEach((b) =>
        b.addEventListener('click', () => {
          state.receipt = null;
          ctx.refresh();
        })
      );

      root.querySelectorAll('[data-action="done"]').forEach((b) =>
        b.addEventListener('click', () => {
          state.receipt = null;
          state.sessionId = null;
          state.gps = null;
          state.scanned = false;
          state.discovered = [];
          ctx.refresh();
        })
      );

      // One automatic scan on arrival keeps the flow to three taps, and a new
      // window appearing later triggers a fresh scan so it can be heard.
      if (!state.scanning && !selected && (!state.scanned || open.some((s) => !state.discovered.includes(s.id)))) {
        scanTimer = setTimeout(() => startScan(ctx), 420);
      }
    },
    destroy() {
      if (feed) {
        feed.stop();
        feed = null;
      }
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
    }
  };
}

function startScan(ctx) {
  if (state.scanning) return;
  state.scanning = true;
  ctx.refresh();
  scanTimer = setTimeout(() => {
    const open = activeSessions(ctx.db);
    state.scanning = false;
    state.scanned = true;
    state.discovered = open.map((s) => s.id);
    ctx.refresh();
    if (!open.length) {
      toast('No classes broadcasting', { message: 'Ask your lecturer to start the attendance window.', tone: 'warn' });
    }
  }, 950);
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function history(ctx) {
  const { db, user } = ctx;
  const courses = db.courses.filter((c) => c.studentIds.includes(user.id));

  let records = db.attendance
    .filter((a) => a.studentId === user.id)
    .map((a) => ({ ...a, course: courseById(db, a.courseId) }))
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt));

  if (state.historyCourse !== 'all') {
    records = records.filter((a) => a.courseId === state.historyCourse);
  }

  const attended = records.length;
  const late = records.filter((r) => r.status === 'late').length;
  const totalSessions = courses.reduce(
    (sum, c) => sum + db.sessions.filter((s) => s.courseId === c.id && s.status !== 'active').length,
    0
  );
  const overall = pctOf(attended, totalSessions);
  const missed = Math.max(0, totalSessions - attended);

  const options = [`<option value="all"${state.historyCourse === 'all' ? ' selected' : ''}>All courses</option>`]
    .concat(
      courses.map(
        (c) => `<option value="${c.id}"${state.historyCourse === c.id ? ' selected' : ''}>${esc(c.code)} · ${esc(c.name)}</option>`
      )
    )
    .join('');

  const rows = records.length
    ? records
        .map(
          (r) => `<tr>
            <td class="nowrap">${fmtDate(r.checkedInAt)}</td>
            <td><span class="pill">${esc(r.course ? r.course.code : '—')}</span></td>
            <td class="nowrap">${fmtTime(r.checkedInAt)}</td>
            <td class="muted">${methodLabel(r.method)}</td>
            <td class="num">${r.distanceM != null ? r.distanceM + ' m' : '—'}</td>
            <td>${statusPill(r.status)}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="6"><div class="empty">No records for this filter.</div></td></tr>`;

  const html = `<div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('check', 14)} Sessions attended</div><div class="kpi-value">${attended}</div><div class="kpi-foot">of ${totalSessions} held</div></div>
      <div class="kpi"><div class="kpi-label">${icon('x', 14)} Sessions missed</div><div class="kpi-value">${missed}</div><div class="kpi-foot">${round1(overall)}% attendance${state.historyCourse !== 'all' ? ' (this course)' : ''}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('clock', 14)} Late arrivals</div><div class="kpi-value">${late}</div><div class="kpi-foot">After ${LATE_GRACE_MIN} minutes</div></div>
      <div class="kpi"><div class="kpi-label">${icon('shield', 14)} Eligibility</div><div class="kpi-value">${overall >= 70 ? 'Safe' : 'At risk'}</div><div class="kpi-foot">Threshold 70%</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">${icon('clock', 16)} Attendance history</div>
        <div class="row">
          <select class="select" id="history-filter" style="width:230px">${options}</select>
          <button class="btn btn-soft btn-sm" id="export-history">${icon('download', 15)} Export CSV</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Course</th><th>Time</th><th>Method</th><th class="num">Distance</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card-foot">
        <span class="muted tiny">${records.length} record${records.length === 1 ? '' : 's'} shown · posted records are immutable</span>
        <span class="muted tiny">Generated ${fmtDateShort(new Date().toISOString())}</span>
      </div>
    </div>`;

  return {
    eyebrow: 'Records',
    title: 'Attendance history',
    sub: 'Every posted session, with the method and distance the system verified.',
    html,
    mount(root) {
      const filter = root.querySelector('#history-filter');
      if (filter) {
        filter.addEventListener('change', () => {
          state.historyCourse = filter.value;
          ctx.refresh();
        });
      }
      const exportBtn = root.querySelector('#export-history');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          downloadCSV(
            `attendsmart-${user.regNo.replace(/[^\w]+/g, '-')}-attendance.csv`,
            ['Date', 'Time', 'Course', 'Course name', 'Method', 'Distance (m)', 'Status', 'Session'],
            records.map((r) => [
              fmtDateShort(r.checkedInAt),
              fmtTime(r.checkedInAt),
              r.course ? r.course.code : '',
              r.course ? r.course.name : '',
              methodLabel(r.method),
              r.distanceM,
              r.status,
              r.sessionId
            ])
          );
          toast('Report exported', { message: 'CSV saved to your downloads.', tone: 'success' });
        });
      }
    }
  };
}
