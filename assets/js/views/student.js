/**
 * AttendEase — student experience.
 *
 * Enter the four-digit code the lecturer's server issued, confirm the class,
 * post once. The record is written to the shared database, so the lecturer's
 * live roster updates on a different phone.
 */

import {
  activeSessionForStudent,
  checkIn,
  courseById,
  haversineMeters,
  lecturerById,
  lookupSession,
  sessionVenue,
  roomFor,
  LATE_GRACE_MIN
} from '../data.js';
import { studentOverview, round1, pctOf } from '../analytics.js';
import {
  icon,
  esc,
  ring,
  progress,
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
import { createGpsFeed, getBridgeBase, getPreferredSource, setBridgeBase, setPreferredSource } from '../gps.js';

/* ------------------------------------------------------------------ */
/* Transient check-in state                                            */
/* ------------------------------------------------------------------ */

const state = {
  userId: null,
  code: '',
  lookup: null,
  receipt: null,
  gps: null,
  error: '',
  finding: false,
  posting: false,
  historyCourse: 'all'
};

let feed = null;

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
        <span class="alert-icon">${icon('key', 16)}</span>
        <div class="grow">
          <div class="alert-title">${esc(current.course.code)} attendance is open</div>
          <div class="alert-body">Ask your lecturer for the four-digit code. The window closes at ${fmtTime(current.session.endsAt)}.</div>
        </div>
        <a class="btn btn-green btn-sm" href="#/student/checkin">Enter code ${icon('arrow', 14)}</a>
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
        <span class="muted tiny">Updates automatically when the lecturer closes a window</span>
      </div>
    </div>`;

  return {
    eyebrow: 'AttendEase · Student',
    title: `Hi, ${user.name.split(' ')[0]}`,
    sub: `${user.regNo} · ${user.program}`,
    actions: `<a class="btn btn-soft btn-sm" href="#/student/history">${icon('clock', 15)} My attendance</a>`,
    html
  };
}

/* ------------------------------------------------------------------ */
/* Check-in helpers                                                    */
/* ------------------------------------------------------------------ */

function distanceTo(hall) {
  const gps = state.gps;
  if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) return null;
  return haversineMeters({ lat: gps.lat, lng: gps.lng }, hall);
}

function gpsReady() {
  return !!(state.gps && state.gps.status === 'ok');
}

function locationStatus(hall) {
  const gps = state.gps;
  const dist = distanceTo(hall);
  const inside = dist !== null && dist <= hall.radius;

  let tone = '';
  let label = 'Waiting for location';
  let detail = 'Allow location access on this phone, or switch to the BT-821C.';

  if (gps) {
    if (gps.status === 'locating') {
      tone = 'pill-amber';
      label = gps.source === 'external' ? 'Reading BT-821C' : 'Getting location';
      detail = gps.error || 'Listening for a GPS fix…';
    } else if (gps.status === 'error') {
      tone = 'pill-red';
      label = 'No usable location';
      detail = gps.error || 'Location unavailable.';
    } else if (gps.status === 'ok') {
      tone = 'pill-green';
      label = gps.source === 'external' ? 'BT-821C location' : 'Phone location';
      detail = `${gps.bridge ? 'Bluetooth bridge' : 'This device'} · ±${Math.round(gps.accuracy || 0)} m`;
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
  const preferred = getPreferredSource() === 'external' ? 'external' : 'device';
  return `<div id="gps-live">${locationStatus(hall)}</div>
    <div class="row mt-12">
      <button class="btn btn-sm ${preferred === 'device' ? 'btn-primary' : 'btn-soft'} grow" data-source="device">${icon('pin', 14)} Phone GPS</button>
      <button class="btn btn-sm ${preferred === 'external' ? 'btn-primary' : 'btn-soft'} grow" data-source="external">${icon('bluetooth', 14)} BT-821C</button>
    </div>
    <div class="field mt-8" id="bridge-field" style="${preferred === 'external' ? '' : 'display:none'}">
      <label for="bridge-url">Bluetooth bridge address</label>
      <input class="input" id="bridge-url" value="${esc(getBridgeBase())}" placeholder="http://192.168.1.20:4190" autocomplete="off" spellcheck="false">
    </div>
    <div class="row mt-12">
      <button class="btn btn-soft btn-sm" data-action="retry-gps">${icon('refresh', 14)} Refresh location</button>
      <span class="muted tiny">Checked against the class location · ${hall.radius} m fence.</span>
    </div>`;
}

function receiptHTML(ctx, receipt) {
  const { db } = ctx;
  const session = receipt.session || (receipt.sessionId ? db.sessions.find((s) => s.id === receipt.sessionId) : null);
  const course = receipt.course || (session ? courseById(db, session.courseId) : null);

  if (!receipt.ok) {
    const titles = {
      enrolled: 'Not on the class list',
      identity: 'Identity already bound',
      duplicate: 'Already posted',
      code: 'Code not recognised',
      gps: 'Location check failed'
    };
    return `<div class="card">
      <div class="card-head">
        <div class="card-title">${icon('alert', 16)} Attendance not posted</div>
        <span class="pill pill-red">Rejected</span>
      </div>
      <div class="card-body">
        <div class="alert alert-red mb-16">
          <span class="alert-icon">${icon('lock', 15)}</span>
          <div>
            <div class="alert-title">${titles[receipt.step] || 'Could not verify attendance'}</div>
            <div class="alert-body">${esc(receipt.message)}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-block" data-action="retry">Try again</button>
        <button class="btn btn-soft btn-block mt-8" data-action="change">Enter another code</button>
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
          <div class="alert-title">Saved to the shared register</div>
          <div class="alert-body">Your lecturer's roster has already updated. This record is final and cannot be reassigned.</div>
        </div>
      </div>
      <div class="stat-row"><span class="k">Class</span><span class="v">${esc(course ? `${course.code} · ${course.name}` : 'Attendance')}</span></div>
      <div class="stat-row"><span class="k">Posted</span><span class="v">${fmtDateTime(record.checkedInAt)}</span></div>
      <div class="stat-row"><span class="k">Method</span><span class="v">Session code + GPS</span></div>
      <div class="stat-row"><span class="k">Distance from class</span><span class="v">${record.distanceM} m</span></div>
      <div class="row mt-16">
        <a class="btn btn-soft grow" href="#/student/history">My attendance</a>
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
  // previous student's code, GPS fix or posted receipt.
  if (state.userId !== user.id) {
    Object.assign(state, {
      userId: user.id,
      code: '',
      lookup: null,
      receipt: null,
      gps: null,
      error: '',
      finding: false,
      posting: false
    });
  }

  const open = activeSessionForStudent(db, user.id);
  const lookup = state.lookup;
  const hall = lookup && lookup.hall ? lookup.hall : null;
  const course = lookup && lookup.course ? lookup.course : null;

  const openList = open
    .map((session) => {
      const c = courseById(db, session.courseId);
      const venue = sessionVenue(db, session);
      return `<div class="session-option" style="cursor:default">
        <span class="ic">${icon('key', 18)}</span>
        <span class="m">
          <span class="t">${esc(c ? `${c.code} · ${c.name}` : 'Class')}</span>
          <span class="s">${esc(c ? roomFor(db, c) : venue.name)} · ${venue.radius} m fence · closes in ${Math.max(0, Math.round((new Date(session.endsAt) - Date.now()) / 60000))} min</span>
        </span>
        <span class="pill pill-live"><span class="dot"></span>Open</span>
      </div>`;
    })
    .join('');

  const codeCard = `<div class="card mb-16">
    <div class="card-head">
      <div class="card-title">${icon('key', 16)} Enter attendance code</div>
      <span class="pill ${open.length ? 'pill-green' : ''}">${open.length ? `${open.length} lecture${open.length === 1 ? '' : 's'} open` : 'Waiting for lecturer'}</span>
    </div>
    <div class="card-body">
      <div class="muted small">The lecturer's screen shows a four-digit code for this class. You must also be inside the ${open[0] ? sessionVenue(db, open[0]).radius : 30} m class fence.</div>
      <div class="code-entry mt-12">
        <input class="code-input" id="code-input" value="${esc(state.code)}" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="0000" autocomplete="one-time-code" spellcheck="false" aria-label="Four-digit attendance code">
        <button class="btn btn-primary" id="find-session" ${state.finding ? 'disabled' : ''}>${state.finding ? 'Checking…' : 'Find lecture'}</button>
      </div>
      ${state.error ? `<div class="alert alert-red mt-12"><span class="alert-icon">${icon('alert', 15)}</span><div><div class="alert-title">Code not accepted</div><div class="alert-body">${esc(state.error)}</div></div></div>` : ''}
      ${openList ? `<div class="mt-16"><div class="muted tiny mb-8">Active lectures nearby</div>${openList}</div>` : ''}
    </div>
  </div>`;

  let detail = '';
  if (state.receipt) {
    detail = receiptHTML(ctx, state.receipt);
  } else if (lookup && course && hall) {
    const lecturer = lookup.lecturer || lecturerById(db, course.lecturerId);
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
            <div class="muted small mt-4">${esc(lecturer ? lecturer.name : 'Lecturer')}</div>
          </div>
          <span class="pill ${lookup.enrolled ? 'pill-green' : 'pill-red'}">${lookup.enrolled ? 'On class list' : 'Not on class list'}</span>
        </div>

        <div class="grid grid-3 mt-16">
          <div class="stat-row" style="border:none;display:block">
            <div class="k">Room</div>
            <div class="v">${esc(roomFor(db, course))}</div>
            <div class="muted tiny">${hall.radius} m GPS fence</div>
          </div>
          <div class="stat-row" style="border:none;display:block">
            <div class="k">Window</div>
            <div class="v">${fmtTime(lookup.session.startedAt)} – ${fmtTime(lookup.session.endsAt)}</div>
            <div class="muted tiny">${lookup.minutesLeft} min left</div>
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
            <span class="muted tiny">Code already matched</span>
          </div>
          <div class="mt-8">${locationBlock(hall)}</div>
        </div>

        <div class="row mt-16">
          <button class="btn btn-soft" data-action="change">Change code</button>
          <button class="btn btn-primary grow" id="post-attendance" ${state.posting ? 'disabled' : ''}>${state.posting ? 'Posting…' : `${icon('check', 16)} POST ATTENDANCE`}</button>
        </div>
      </div>
    </div>`;
  } else {
    detail = `<div class="card card-pad" style="text-align:center;padding:30px">
      <div class="muted small">${open.length ? 'Enter the four-digit code to see your class.' : 'No attendance window is open for your classes yet. Ask your lecturer to start one.'}</div>
    </div>`;
  }

  return {
    eyebrow: 'AttendEase · Student',
    title: 'Scan attendance',
    sub: open.length ? 'Active lectures nearby. Enter the code and post once.' : 'Enter the code your lecturer is showing.',
    actions: `<a class="btn btn-soft btn-sm" href="#/student/history">${icon('clock', 15)} My attendance</a>`,
    html: `${codeCard}${detail}`,
    mount(root) {
      const input = root.querySelector('#code-input');
      const findBtn = root.querySelector('#find-session');

      if (input) {
        input.addEventListener('input', () => {
          const clean = input.value.replace(/\D/g, '').slice(0, 4);
          input.value = clean;
          state.code = clean;
          state.error = '';
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            find(ctx);
          }
        });
        if (!state.lookup && !state.receipt) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
      if (findBtn) findBtn.addEventListener('click', () => find(ctx));

      if (lookup && hall) {
        let source = getPreferredSource() === 'external' ? 'external' : 'device';
        const startFeed = () => {
          if (feed) feed.stop();
          state.gps = null;
          feed = createGpsFeed((gps) => {
            state.gps = gps;
            const holder = root.querySelector('#gps-live');
            if (holder) holder.innerHTML = locationStatus(hall);
          });
          feed.start(source);
        };
        startFeed();

        root.querySelectorAll('[data-source]').forEach((button) => {
          button.addEventListener('click', () => {
            source = button.dataset.source === 'external' ? 'external' : 'device';
            setPreferredSource(source);
            root.querySelectorAll('[data-source]').forEach((other) => {
              const on = other.dataset.source === source;
              other.className = `btn btn-sm ${on ? 'btn-primary' : 'btn-soft'} grow`;
            });
            const bridgeField = root.querySelector('#bridge-field');
            if (bridgeField) bridgeField.style.display = source === 'external' ? '' : 'none';
            startFeed();
          });
        });

        const bridgeInput = root.querySelector('#bridge-url');
        if (bridgeInput) {
          bridgeInput.addEventListener('change', () => {
            try {
              const clean = setBridgeBase(bridgeInput.value);
              bridgeInput.value = clean;
              toast('Bridge address saved', { message: clean, tone: 'success' });
              if (source === 'external') startFeed();
            } catch (err) {
              toast('Invalid bridge address', { message: err.message, tone: 'error' });
            }
          });
        }

        const retryGps = root.querySelector('[data-action="retry-gps"]');
        if (retryGps) retryGps.addEventListener('click', () => startFeed());

        const postBtn = root.querySelector('#post-attendance');
        if (postBtn) postBtn.addEventListener('click', () => post(ctx));
      }

      root.querySelectorAll('[data-action="change"]').forEach((b) =>
        b.addEventListener('click', () => {
          state.lookup = null;
          state.receipt = null;
          state.code = '';
          state.error = '';
          state.gps = null;
          ctx.refresh();
        })
      );

      root.querySelectorAll('[data-action="retry"]').forEach((b) =>
        b.addEventListener('click', () => {
          state.receipt = null;
          state.error = '';
          ctx.refresh();
        })
      );

      root.querySelectorAll('[data-action="done"]').forEach((b) =>
        b.addEventListener('click', () => {
          state.receipt = null;
          state.lookup = null;
          state.code = '';
          state.error = '';
          state.gps = null;
          ctx.refresh();
        })
      );
    },
    destroy() {
      if (feed) {
        feed.stop();
        feed = null;
      }
    }
  };
}

async function find(ctx) {
  if (state.finding) return;
  const clean = state.code.replace(/\D/g, '').slice(0, 4);
  state.code = clean;
  state.error = '';

  if (clean.length !== 4) {
    state.error = 'Enter all four digits shown on the lecturer’s screen.';
    ctx.refresh();
    return;
  }

  state.finding = true;
  ctx.refresh();
  try {
    const result = await lookupSession(clean, ctx.user.id);
    if (!result.ok) {
      state.lookup = null;
      state.error = result.message;
    } else {
      state.lookup = result;
      state.error = '';
    }
  } catch (err) {
    state.lookup = null;
    state.error = err.message;
  } finally {
    state.finding = false;
    ctx.refresh();
  }
}

async function post(ctx) {
  if (state.posting) return;
  if (!state.lookup) return;

  if (!gpsReady()) {
    toast('Waiting for location', { message: 'Allow location access and wait for a GPS fix, then post again.', tone: 'warn' });
    return;
  }

  state.posting = true;
  ctx.refresh();
  try {
    const result = await checkIn(null, {
      code: state.code,
      studentId: ctx.user.id,
      deviceId: ctx.deviceId,
      lat: state.gps.lat,
      lng: state.gps.lng,
      accuracy: state.gps.accuracy
    });
    state.receipt = result;
    if (result.ok) {
      state.lookup = null;
      state.code = '';
    }
    toast(result.ok ? 'Attendance posted' : 'Attendance not posted', {
      message: result.ok ? 'Saved to the shared register — your lecturer can see it now.' : result.message,
      tone: result.ok ? 'success' : 'error',
      duration: result.ok ? 4200 : 6500
    });
  } catch (err) {
    state.receipt = { ok: false, step: 'server', message: err.message };
    toast('Could not reach the server', { message: err.message, tone: 'error', duration: 6500 });
  } finally {
    state.posting = false;
    ctx.refresh();
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function history(ctx) {
  const { db, user } = ctx;
  const ov = studentOverview(db, user.id);
  const courses = db.courses.filter((c) => c.studentIds.includes(user.id));

  const courseCards = ov.courses
    .map(({ course, attended, total, pct }) => `<div class="card card-pad">
      <div class="spread" style="align-items:flex-start">
        <div>
          <span class="pill pill-brand">${esc(course.code)}</span>
          <h3 style="font-size:16px;margin-top:9px">${esc(course.name)}</h3>
          <div class="muted small mt-4">${esc(roomFor(db, course))}</div>
        </div>
        ${ring(pct, { size: 58, stroke: 5 })}
      </div>
      <div class="mt-16">${progress(pct)}</div>
      <div class="spread mt-8">
        <span class="tiny muted">${attended} of ${total} sessions attended</span>
        <span class="pill ${pct < 70 ? 'pill-red' : pct < 80 ? 'pill-amber' : 'pill-green'}">${pctText(pct)}</span>
      </div>
    </div>`)
    .join('');

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

  const html = `<div class="card mb-16">
      <div class="card-head">
        <div class="card-title">${icon('book', 16)} My units</div>
        <span class="card-hint">${ov.courses.length} unit${ov.courses.length === 1 ? '' : 's'} · ${pctText(ov.pct)} overall</span>
      </div>
      <div class="card-body">
        <div class="grid grid-2">
          ${courseCards || `<div class="empty"><div class="ic">${icon('book', 20)}</div>You are not on a class list yet. Ask your lecturer to upload it.</div>`}
        </div>
      </div>
    </div>

    <div class="kpi-grid">
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
    eyebrow: 'AttendEase · Student',
    title: 'My attendance',
    sub: `${user.regNo} · ${pctText(ov.pct)} overall across ${ov.courses.length} unit${ov.courses.length === 1 ? '' : 's'}.`,
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
            `attendease-${user.regNo.replace(/[^\w]+/g, '-')}-attendance.csv`,
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
