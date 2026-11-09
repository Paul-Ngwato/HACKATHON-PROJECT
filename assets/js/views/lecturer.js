/**
 * AttendEase — lecturer console.
 *
 * Units → upload the class list → START (captures the official class location)
 * → live four-digit code + roster → ANALYSIS with a downloadable report.
 */

import {
  activeSessionForCourse,
  activeSessions,
  courseById,
  coursesForLecturer,
  createCourse,
  DAY_NAMES,
  DAY_SHORT,
  endSession,
  importRoster,
  rotateSessionCode,
  roomFor,
  sessionReport,
  sessionVenue,
  setCourseRoster,
  startSession,
  updateCourseSetup
} from '../data.js';
import { getBridgeBase, getPreferredSource, scanForReceiver, setBridgeBase, setPreferredSource } from '../gps.js';
import { courseAnalytics, pctOf, round1 } from '../analytics.js';
import {
  icon,
  esc,
  ring,
  progress,
  attendancePill,
  statusPill,
  fmtDate,
  fmtTime,
  toast,
  modal,
  downloadCSV,
  countdownText,
  avatar,
  pctText,
  copyText
} from '../ui.js';
import { parseRosterText, readRosterFile } from '../roster.js';

const FENCE_METRES = 30;

const ATTEMPT_LABELS = {
  unregistered_attempt: 'Not registered',
  identity_locked: 'Identity locked',
  device_reuse: 'Device reuse'
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function clockLabel(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return value || '—';
  let hour = Number(match[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${match[2]} ${suffix}`;
}

function unitTime(course) {
  return `${DAY_SHORT[course.day]} · ${clockLabel(course.start)}`;
}

function studentList(db, course) {
  return (course.studentIds || [])
    .map((id) => db.students.find((s) => s.id === id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Ask the phone — or the laptop's BT-821C bridge — for one precise fix. */
async function captureFix(source) {
  if (source === 'external') {
    const scan = await scanForReceiver();
    if (!scan.ok) throw new Error(scan.error);
    if (!scan.fix) {
      throw new Error(`The receiver${scan.port ? ` on ${scan.port}` : ''} is connected but has no satellite fix yet. Move it near a window.`);
    }
    return { ...scan.fix, source: 'external' };
  }

  if (!navigator.geolocation) {
    throw new Error('This device has no Geolocation API. Switch the source to BT-821C.');
  }
  if (!window.isSecureContext) {
    throw new Error('This browser blocks GPS on plain http://. Use the installed AttendEase app, or switch the source to BT-821C.');
  }

  return await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        source: 'device'
      }),
      (err) => reject(new Error(
        err.code === 1
          ? 'Location permission was denied. Allow precise location, or switch the source to BT-821C.'
          : 'No GPS fix yet. Step near a window or outdoors, or switch the source to BT-821C.'
      )),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

/* ------------------------------------------------------------------ */
/* Units (main lecturer dashboard)                                     */
/* ------------------------------------------------------------------ */

export function overview(ctx) {
  const { db, user } = ctx;
  const courses = coursesForLecturer(db, user.id);
  const active = activeSessions(db).filter((s) => courses.some((c) => c.id === s.courseId));

  const cards = courses
    .map((course) => {
      const analytics = courseAnalytics(db, course.id);
      const live = activeSessionForCourse(db, course.id);
      const room = roomFor(db, course);
      return `<div class="card card-pad">
        <div class="spread" style="align-items:flex-start">
          <div>
            <div class="row" style="gap:6px">
              <span class="pill pill-brand">${esc(course.code)}</span>
              ${live ? `<span class="pill pill-live"><span class="dot"></span>Live</span>` : ''}
            </div>
            <h3 style="font-size:16px;margin-top:9px">${esc(course.name)}</h3>
            <div class="muted small mt-8">${icon('pin', 13)} ${esc(room)}</div>
            <div class="muted small mt-4">${icon('clock', 13)} ${esc(unitTime(course))}</div>
            <div class="muted tiny mt-4">${course.studentIds.length} student${course.studentIds.length === 1 ? '' : 's'} uploaded</div>
          </div>
          ${ring(analytics ? analytics.avgPct : 0, { size: 58, stroke: 5 })}
        </div>
        <div class="mt-16">${progress(analytics ? analytics.avgPct : 0)}</div>
        <div class="spread mt-8">
          <span class="tiny muted">${analytics ? analytics.sessionCount : 0} sessions held</span>
          <span class="tiny muted">${analytics ? pctText(analytics.avgPct) : '0%'} average</span>
        </div>
        <div class="row mt-16">
          <a class="btn ${live ? 'btn-green' : 'btn-primary'} btn-sm grow" href="#/lecturer/session?course=${course.id}">
            ${icon('play', 14)} START
          </a>
          <a class="btn btn-soft btn-sm grow" href="#/lecturer/analytics?course=${course.id}">
            ${icon('chart', 14)} ANALYSIS
          </a>
        </div>
        <div class="spread mt-12">
          <a class="tiny" href="#/lecturer/setup?course=${course.id}">${icon('upload', 13)} Upload students</a>
          <span class="tiny muted">${FENCE_METRES} m GPS fence</span>
        </div>
      </div>`;
    })
    .join('');

  const liveBanner = active
    .map((session) => {
      const course = courseById(db, session.courseId);
      const posted = db.attendance.filter((a) => a.sessionId === session.id).length;
      return `<div class="alert alert-green mb-16">
        <span class="alert-icon">${icon('key', 16)}</span>
        <div class="grow">
          <div class="alert-title">${esc(course.code)} attendance is open · code <span class="mono">${esc(session.code)}</span></div>
          <div class="alert-body">${posted} of ${course.studentIds.length} students posted · closes ${fmtTime(session.endsAt)}</div>
        </div>
        <a class="btn btn-green btn-sm" href="#/lecturer/session?course=${course.id}">Manage</a>
      </div>`;
    })
    .join('');

  const totalStudents = new Set(courses.flatMap((c) => c.studentIds)).size;
  const avg = courses.length
    ? courses.reduce((sum, c) => sum + (courseAnalytics(db, c.id)?.avgPct || 0), 0) / courses.length
    : 0;

  const html = `${liveBanner}
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('book', 14)} Units</div><div class="kpi-value">${courses.length}</div><div class="kpi-foot">${esc(user.department || '')}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('users', 14)} Students</div><div class="kpi-value">${totalStudents}</div><div class="kpi-foot">Across all units</div></div>
      <div class="kpi"><div class="kpi-label">${icon('chart', 14)} Average attendance</div><div class="kpi-value">${pctText(avg)}</div><div class="kpi-foot">All units</div></div>
      <div class="kpi"><div class="kpi-label">${icon('key', 14)} Live sessions</div><div class="kpi-value">${active.length}</div><div class="kpi-foot">Accepting posts now</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">${icon('book', 16)} My units</div>
        <span class="card-hint">Create a unit, upload students, then start attendance</span>
      </div>
      <div class="card-body">
        <div class="grid grid-2">
          ${cards || `<div class="empty"><div class="ic">${icon('book', 20)}</div>No units yet. Create your first unit to get started.<div class="mt-16"><a class="btn btn-primary btn-sm" href="#/lecturer/create">+ CREATE UNIT</a></div></div>`}
        </div>
      </div>
    </div>`;

  return {
    eyebrow: 'AttendEase · Lecturer',
    title: 'My units',
    sub: 'START attendance in class, then open ANALYSIS for the student report.',
    actions: `<a class="btn btn-primary btn-sm" href="#/lecturer/create">+ CREATE UNIT</a>`,
    html
  };
}

/* ------------------------------------------------------------------ */
/* Create unit                                                         */
/* ------------------------------------------------------------------ */

export function create(ctx) {
  const { db, user } = ctx;
  const dayOptions = DAY_NAMES.map(
    (name, index) => `<option value="${index}"${index === new Date().getDay() ? ' selected' : ''}>${esc(name)}</option>`
  ).join('');

  const html = `<div class="card">
    <div class="card-head">
      <div class="card-title">${icon('book', 16)} Create unit</div>
      <span class="pill pill-brand">${esc(user.name)}</span>
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div class="field">
          <label for="unit-name">Unit name</label>
          <input class="input" id="unit-name" placeholder="Database Systems" autocomplete="off">
        </div>
        <div class="field">
          <label for="unit-code">Course code</label>
          <input class="input" id="unit-code" placeholder="BBIT421" autocomplete="off">
        </div>
        <div class="field">
          <label for="unit-room">Room</label>
          <input class="input" id="unit-room" placeholder="Room B12" autocomplete="off">
        </div>
        <div class="field">
          <label for="unit-lecturer">Lecturer</label>
          <input class="input" id="unit-lecturer" value="${esc(user.name)}" readonly>
        </div>
        <div class="field">
          <label for="unit-day">Class day</label>
          <select class="select" id="unit-day">${dayOptions}</select>
        </div>
        <div class="field">
          <label for="unit-window">Attendance window</label>
          <select class="select" id="unit-window">
            ${[5, 10, 15, 20, 30].map((m) => `<option value="${m}"${m === 10 ? ' selected' : ''}>${m} minutes</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="unit-start">Starts</label>
          <input class="input" type="time" id="unit-start" value="10:00">
        </div>
        <div class="field">
          <label for="unit-end">Ends</label>
          <input class="input" type="time" id="unit-end" value="12:00">
        </div>
      </div>

      <div class="alert alert-brand mt-16">
        <span class="alert-icon">${icon('info', 16)}</span>
        <div>
          <div class="alert-title">The code and GPS fence come later</div>
          <div class="alert-body">When you press START in class, AttendEase captures that phone's precise location and issues a fresh four-digit code. Students must be within ${FENCE_METRES} m.</div>
        </div>
      </div>

      <div class="row mt-16">
        <a class="btn btn-soft" href="#/lecturer/classes">Cancel</a>
        <button class="btn btn-primary grow" id="create-unit">${icon('check', 16)} Create unit</button>
      </div>
    </div>
  </div>`;

  return {
    eyebrow: 'AttendEase · Lecturer',
    title: 'Create unit',
    sub: 'Enter the details once. You can upload the student list next.',
    html,
    mount(root, viewCtx) {
      const button = root.querySelector('#create-unit');
      button.addEventListener('click', async () => {
        const value = (id) => (root.querySelector(`#${id}`) || {}).value || '';
        button.disabled = true;
        button.textContent = 'Creating…';
        try {
          const course = await createCourse(viewCtx.db, {
            name: value('unit-name'),
            code: value('unit-code'),
            room: value('unit-room'),
            lecturerId: user.id,
            department: user.department,
            day: Number(value('unit-day')),
            start: value('unit-start'),
            end: value('unit-end'),
            windowMinutes: Number(value('unit-window'))
          });
          toast('Unit created', { message: `${course.code} · ${course.name}`, tone: 'success' });
          window.location.hash = `#/lecturer/setup?course=${course.id}`;
        } catch (err) {
          button.disabled = false;
          button.innerHTML = `${icon('check', 16)} Create unit`;
          toast('Could not create unit', { message: err.message, tone: 'error' });
        }
      });
    }
  };
}

/* ------------------------------------------------------------------ */
/* Unit setup / upload students                                        */
/* ------------------------------------------------------------------ */

export function setup(ctx) {
  const { db, user } = ctx;
  const courses = coursesForLecturer(db, user.id);
  const selectedId = ctx.params.course || (courses[0] && courses[0].id);
  const course = selectedId ? courseById(db, selectedId) : null;

  if (!course) {
    return {
      eyebrow: 'AttendEase · Lecturer',
      title: 'Upload students',
      sub: 'Create a unit first.',
      html: `<div class="empty"><div class="ic">${icon('book', 20)}</div>No unit selected.<div class="mt-16"><a class="btn btn-primary btn-sm" href="#/lecturer/create">+ CREATE UNIT</a></div></div>`
    };
  }

  const students = studentList(db, course);
  const active = activeSessionForCourse(db, course.id);
  const dayOptions = DAY_NAMES.map(
    (name, index) => `<option value="${index}"${index === course.day ? ' selected' : ''}>${esc(name)}</option>`
  ).join('');
  const courseOptions = courses
    .map((c) => `<option value="${c.id}"${c.id === course.id ? ' selected' : ''}>${esc(c.code)} · ${esc(c.name)}</option>`)
    .join('');

  const rows = students
    .map(
      (student) => `<tr data-row="${esc((student.name + ' ' + student.regNo).toLowerCase())}">
        <td><div class="person">${avatar(student.name)}<div><div class="name">${esc(student.name)}</div><div class="sub">${esc(student.regNo)}</div></div></div></td>
        <td class="muted small">${esc(student.program || '')}</td>
      </tr>`
    )
    .join('');

  const html = `<div class="card card-pad mb-16">
      <div class="spread">
        <div>
          <div class="row" style="gap:6px">
            <span class="pill pill-brand">${esc(course.code)}</span>
            ${active ? `<span class="pill pill-live"><span class="dot"></span>Live</span>` : ''}
          </div>
          <h2 style="font-size:19px;margin-top:8px">${esc(course.name)}</h2>
          <div class="muted small mt-4">${esc(roomFor(db, course))} · ${esc(unitTime(course))} · ${students.length} students</div>
        </div>
        <div class="row">
          <select class="select" id="course-select" style="width:250px">${courseOptions}</select>
          <a class="btn btn-primary btn-sm" href="#/lecturer/session?course=${course.id}">${icon('play', 14)} START</a>
          <a class="btn btn-soft btn-sm" href="#/lecturer/analytics?course=${course.id}">${icon('chart', 14)} ANALYSIS</a>
        </div>
      </div>
    </div>

    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div class="card-title">${icon('upload', 16)} Upload students</div>
            <span class="card-hint">Excel or CSV</span>
          </div>
          <div class="card-body">
            <div class="muted small">Upload the sheet your class already uses: <strong>Student ID</strong> in column A and <strong>Name</strong> in column B. A header row is optional.</div>
            <div class="field mt-12">
              <label for="roster-file">Excel workbook (.xlsx) or CSV</label>
              <input class="input" type="file" id="roster-file" accept=".xlsx,.csv,.tsv,.txt">
            </div>
            <div class="muted tiny" id="upload-status">No file selected yet.</div>

            <div class="field mt-16">
              <label for="roster-paste">Or paste rows</label>
              <textarea class="input" id="roster-paste" rows="4" spellcheck="false" placeholder="S001&#9;Paul Oduor&#10;S002&#9;Brian Langat"></textarea>
            </div>

            <button class="btn btn-primary btn-block mt-12" id="import-roster" disabled>${icon('upload', 15)} Add to unit</button>
            <div class="muted tiny mt-8" style="text-align:center">Repeats are ignored, so uploading the same sheet twice is safe.</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">${icon('users', 16)} Student list</div>
            <div class="row">
              <input class="input" id="roster-search" placeholder="Search name or ID" style="width:200px" autocomplete="off">
              <span class="pill pill-brand">${students.length}</span>
            </div>
          </div>
          <div class="table-wrap" style="max-height:440px;overflow-y:auto">
            <table class="data-table">
              <thead><tr><th>Student</th><th>Programme</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="2"><div class="empty">No students yet. Upload the Excel sheet above.</div></td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">${icon('sliders', 16)} Unit details</div><span class="pill" id="save-state">Saved</span></div>
        <div class="card-body">
          <div class="field">
            <label for="edit-name">Unit name</label>
            <input class="input" id="edit-name" value="${esc(course.name)}" readonly>
          </div>
          <div class="field mt-12">
            <label for="edit-room">Room</label>
            <input class="input" id="edit-room" value="${esc(course.room || roomFor(db, course))}">
          </div>
          <div class="field mt-12">
            <label for="edit-day">Class day</label>
            <select class="select" id="edit-day">${dayOptions}</select>
          </div>
          <div class="grid grid-2 mt-12">
            <div class="field">
              <label for="edit-start">Starts</label>
              <input class="input" type="time" id="edit-start" value="${esc(course.start)}">
            </div>
            <div class="field">
              <label for="edit-end">Ends</label>
              <input class="input" type="time" id="edit-end" value="${esc(course.end)}">
            </div>
          </div>
          <div class="field mt-12">
            <label for="edit-window">Attendance window</label>
            <select class="select" id="edit-window">
              ${[5, 10, 15, 20, 30].map((m) => `<option value="${m}"${m === (course.windowMinutes || 10) ? ' selected' : ''}>${m} minutes</option>`).join('')}
            </select>
          </div>
          <div class="stat-row mt-16"><span class="k">Check-in method</span><span class="v">Code + GPS</span></div>
          <div class="stat-row"><span class="k">Allowed radius</span><span class="v">${FENCE_METRES} metres</span></div>
          <div class="stat-row"><span class="k">Students</span><span class="v">${students.length}</span></div>
        </div>
      </div>
    </div>`;

  return {
    eyebrow: 'AttendEase · Lecturer',
    title: 'Upload students',
    sub: 'The class list decides who can post attendance.',
    actions: `<a class="btn btn-soft btn-sm" href="#/lecturer/classes">${icon('arrow', 15)} My units</a>`,
    html,
    mount(root, viewCtx) {
      const select = root.querySelector('#course-select');
      if (select) {
        select.addEventListener('change', () => {
          window.location.hash = `#/lecturer/setup?course=${select.value}`;
        });
      }

      let pending = [];

      const fileInput = root.querySelector('#roster-file');
      const paste = root.querySelector('#roster-paste');
      const uploadStatus = root.querySelector('#upload-status');
      const importButton = root.querySelector('#import-roster');

      const setPending = (result, label) => {
        pending = result.entries || [];
        if (uploadStatus) {
          uploadStatus.textContent = pending.length
            ? `${pending.length} student${pending.length === 1 ? '' : 's'} ready from ${label}${result.invalid.length ? ` · ${result.invalid.length} row(s) skipped` : ''}`
            : `No usable rows found in ${label}.`;
          uploadStatus.className = pending.length ? 'muted tiny' : 'muted tiny';
        }
        if (importButton) importButton.disabled = !pending.length;
      };

      if (fileInput) {
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (uploadStatus) uploadStatus.textContent = `Reading ${file.name}…`;
          try {
            const result = await readRosterFile(file);
            setPending(result, file.name);
          } catch (err) {
            pending = [];
            if (importButton) importButton.disabled = true;
            if (uploadStatus) uploadStatus.textContent = err.message;
          }
        });
      }

      if (paste) {
        paste.addEventListener('input', () => {
          if (!paste.value.trim()) {
            pending = [];
            if (importButton) importButton.disabled = true;
            if (uploadStatus) uploadStatus.textContent = 'No file selected yet.';
            return;
          }
          setPending(parseRosterText(paste.value), 'the pasted rows');
        });
      }

      if (importButton) {
        importButton.addEventListener('click', async () => {
          if (!pending.length) return;
          importButton.disabled = true;
          importButton.textContent = 'Adding…';
          try {
            const result = await importRoster(viewCtx.db, course.id, pending);
            const bits = [`${result.added.length} added`];
            if (result.already.length) bits.push(`${result.already.length} already on the unit`);
            if (result.invalid.length) bits.push(`${result.invalid.length} skipped`);
            toast('Student list updated', { message: bits.join(' · '), tone: 'success' });
            viewCtx.refresh();
          } catch (err) {
            importButton.disabled = false;
            importButton.innerHTML = `${icon('upload', 15)} Add to unit`;
            toast('Could not import students', { message: err.message, tone: 'error' });
          }
        });
      }

      const stateEl = root.querySelector('#save-state');
      const save = async (patch) => {
        try {
          await updateCourseSetup(viewCtx.db, course.id, patch);
          if (stateEl) {
            stateEl.textContent = 'Saved';
            stateEl.className = 'pill pill-green';
          }
        } catch (err) {
          if (stateEl) {
            stateEl.textContent = 'Save failed';
            stateEl.className = 'pill pill-red';
          }
          toast('Could not save unit details', { message: err.message, tone: 'error' });
          viewCtx.refresh();
        }
      };

      const room = root.querySelector('#edit-room');
      const day = root.querySelector('#edit-day');
      const start = root.querySelector('#edit-start');
      const end = root.querySelector('#edit-end');
      const windowSelect = root.querySelector('#edit-window');
      if (room) room.addEventListener('change', () => save({ room: room.value }));
      if (day) day.addEventListener('change', () => save({ day: Number(day.value) }));
      if (start) start.addEventListener('change', () => save({ start: start.value }));
      if (end) end.addEventListener('change', () => save({ end: end.value }));
      if (windowSelect) windowSelect.addEventListener('change', () => save({ windowMinutes: Number(windowSelect.value) }));

      const search = root.querySelector('#roster-search');
      if (search) {
        search.addEventListener('input', () => {
          const q = search.value.trim().toLowerCase();
          root.querySelectorAll('[data-row]').forEach((row) => {
            row.style.display = !q || row.dataset.row.includes(q) ? '' : 'none';
          });
        });
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Start attendance / live session                                     */
/* ------------------------------------------------------------------ */

function reportHTML(report) {
  const attemptRows = report.attempts
    .map(
      (attempt) => `<tr>
        <td class="nowrap">${fmtTime(attempt.at)}</td>
        <td><span class="pill pill-amber">${esc(ATTEMPT_LABELS[attempt.type] || attempt.type)}</span></td>
        <td class="muted small">${esc(attempt.detail)}</td>
      </tr>`
    )
    .join('');

  const registerRows = report.rows
    .map(
      (row) => `<tr>
        <td><div class="person">${avatar(row.student.name, row.status === 'absent' ? 'red' : row.status === 'late' ? 'amber' : 'green')}<div><div class="name">${esc(row.student.name)}</div><div class="sub">${esc(row.student.regNo)}</div></div></div></td>
        <td>${statusPill(row.status)}</td>
        <td class="muted">${row.record ? fmtTime(row.record.checkedInAt) : '—'}</td>
        <td class="num">${row.record && row.record.distanceM != null ? row.record.distanceM + ' m' : '—'}</td>
      </tr>`
    )
    .join('');

  return `<div class="card mt-16">
    <div class="card-head">
      <div class="card-title">${icon('check', 16)} Last session · ${fmtDate(report.session.startedAt)}</div>
      <span class="pill">${report.recorded} of ${report.enrolled.length} posted</span>
    </div>
    <div class="card-body">
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi"><div class="kpi-label">${icon('check', 14)} Present</div><div class="kpi-value">${report.present}</div><div class="kpi-foot">On time</div></div>
        <div class="kpi"><div class="kpi-label">${icon('clock', 14)} Late</div><div class="kpi-value">${report.late}</div><div class="kpi-foot">After 5 minutes</div></div>
        <div class="kpi"><div class="kpi-label">${icon('x', 14)} Absent</div><div class="kpi-value">${report.absent}</div><div class="kpi-foot">Did not post</div></div>
        <div class="kpi"><div class="kpi-label">${icon('shield', 14)} Blocked attempts</div><div class="kpi-value">${report.attempts.length}</div><div class="kpi-foot">Wrong register or device</div></div>
      </div>
      <div class="table-wrap" style="max-height:340px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>Student</th><th>Status</th><th>Posted</th><th class="num">Distance</th></tr></thead>
          <tbody>${registerRows}</tbody>
        </table>
      </div>
      ${report.attempts.length ? `<div class="muted tiny mt-8">${report.attempts.length} attempt${report.attempts.length === 1 ? '' : 's'} were blocked: ${attemptRows ? '' : ''}see the audit log on the server.</div>` : ''}
    </div>
  </div>`;
}

export function session(ctx) {
  const { db, user } = ctx;
  const courses = coursesForLecturer(db, user.id);
  const courseId = ctx.params.course || (courses[0] && courses[0].id);
  const course = courseId ? courseById(db, courseId) : null;

  if (!course) {
    return {
      eyebrow: 'AttendEase · Lecturer',
      title: 'Start attendance',
      sub: 'No unit selected.',
      html: `<div class="empty"><div class="ic">${icon('book', 20)}</div>Create a unit first.<div class="mt-16"><a class="btn btn-primary btn-sm" href="#/lecturer/create">+ CREATE UNIT</a></div></div>`
    };
  }

  const active = activeSessionForCourse(db, course.id);
  const students = studentList(db, course);

  if (!active) {
    const lastReal = db.sessions
      .filter((s) => s.courseId === course.id && s.status === 'ended' && !s.seeded)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
    const report = lastReal ? sessionReport(db, lastReal.id) : null;
    const preferred = getPreferredSource() === 'external' ? 'external' : 'device';
    const bridge = getBridgeBase();

    const html = `<div class="split-even">
      <div class="card">
        <div class="card-head">
          <div class="card-title">${icon('play', 16)} Start attendance</div>
          <span class="pill pill-brand">${esc(course.code)}</span>
        </div>
        <div class="card-body">
          <div class="stat-row"><span class="k">Unit</span><span class="v">${esc(course.name)}</span></div>
          <div class="stat-row"><span class="k">Room</span><span class="v">${esc(roomFor(db, course))}</span></div>
          <div class="stat-row"><span class="k">Time</span><span class="v">${esc(unitTime(course))}</span></div>
          <div class="stat-row"><span class="k">Students</span><span class="v">${students.length} uploaded</span></div>
          <div class="stat-row"><span class="k">Allowed radius</span><span class="v">${FENCE_METRES} m</span></div>

          <div class="field mt-16">
            <label>Location source</label>
            <div class="row">
              <button class="btn btn-sm ${preferred === 'device' ? 'btn-primary' : 'btn-soft'} grow" data-source="device">${icon('pin', 14)} Phone GPS</button>
              <button class="btn btn-sm ${preferred === 'external' ? 'btn-primary' : 'btn-soft'} grow" data-source="external">${icon('bluetooth', 14)} BT-821C</button>
            </div>
            <div class="muted tiny mt-8" id="source-note">${preferred === 'external' ? 'Reading the Bluetooth receiver through the laptop bridge.' : 'Uses this phone’s precise GNSS fix.'}</div>
          </div>

          <div class="field mt-12" id="bridge-field" style="${preferred === 'external' ? '' : 'display:none'}">
            <label for="bridge-url">Bluetooth bridge address</label>
            <input class="input" id="bridge-url" value="${esc(bridge)}" placeholder="http://192.168.1.20:4190" autocomplete="off" spellcheck="false">
          </div>

          <div class="field mt-12">
            <label for="window">How long can students post?</label>
            <select class="select" id="window">
              ${[5, 10, 15, 20, 30].map((m) => `<option value="${m}"${m === (course.windowMinutes || 10) ? ' selected' : ''}>${m} minutes</option>`).join('')}
            </select>
          </div>

          <button class="btn btn-primary btn-block mt-16" id="start">${icon('pin', 16)} START & CAPTURE LOCATION</button>
          <div class="muted tiny mt-8" id="start-status" style="text-align:center;min-height:16px"></div>
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-title mb-8">${icon('shield', 16)} What START does</div>
        <div class="check-list">
          <div class="check-item ok"><span class="check-mark">${icon('pin', 12)}</span><div><div class="t">Captures the official class location</div><div class="d">That fix replaces the room pin for this session</div></div></div>
          <div class="check-item ok"><span class="check-mark">${icon('key', 12)}</span><div><div class="t">Issues a four-digit code</div><div class="d">Unique to this window, expires when the timer ends</div></div></div>
          <div class="check-item ok"><span class="check-mark">${icon('shield', 12)}</span><div><div class="t">Arms the ${FENCE_METRES} m fence</div><div class="d">A correct code from outside the fence is rejected</div></div></div>
          <div class="check-item ok"><span class="check-mark">${icon('users', 12)}</span><div><div class="t">Names arrive live</div><div class="d">Only students on the uploaded list can post</div></div></div>
        </div>
        <div class="muted tiny mt-16">No signal? Switch the source to BT-821C. The laptop bridge forwards the Bluetooth GPS fix to both phones over Wi-Fi.</div>
      </div>
    </div>
    ${report ? reportHTML(report) : ''}`;

    return {
      eyebrow: 'AttendEase · Lecturer',
      title: `${course.code} · ${course.name}`,
      sub: 'Press START in class. The phone location becomes the official class location.',
      actions: `<a class="btn btn-soft btn-sm" href="#/lecturer/classes">${icon('arrow', 15)} My units</a>`,
      html,
      mount(root, viewCtx) {
        let source = preferred;
        const note = root.querySelector('#source-note');
        const bridgeField = root.querySelector('#bridge-field');
        const bridgeInput = root.querySelector('#bridge-url');

        root.querySelectorAll('[data-source]').forEach((button) => {
          button.addEventListener('click', () => {
            source = button.dataset.source;
            setPreferredSource(source);
            root.querySelectorAll('[data-source]').forEach((other) => {
              const on = other.dataset.source === source;
              other.className = `btn btn-sm ${on ? 'btn-primary' : 'btn-soft'} grow`;
            });
            if (bridgeField) bridgeField.style.display = source === 'external' ? '' : 'none';
            if (note) {
              note.textContent = source === 'external'
                ? 'Reading the Bluetooth receiver through the laptop bridge.'
                : 'Uses this phone’s precise GNSS fix.';
            }
          });
        });

        if (bridgeInput) {
          bridgeInput.addEventListener('change', () => {
            try {
              const clean = setBridgeBase(bridgeInput.value);
              bridgeInput.value = clean;
              toast('Bridge address saved', { message: clean, tone: 'success' });
            } catch (err) {
              toast('Invalid bridge address', { message: err.message, tone: 'error' });
            }
          });
        }

        const button = root.querySelector('#start');
        const status = root.querySelector('#start-status');
        button.addEventListener('click', async () => {
          const minutes = Number((root.querySelector('#window') || {}).value) || course.windowMinutes || 10;
          button.disabled = true;
          button.innerHTML = `${icon('refresh', 16)} Capturing precise location…`;
          if (status) status.textContent = source === 'external' ? 'Reading the BT-821C bridge…' : 'Allow precise location when the phone asks…';
          try {
            const fix = await captureFix(source);
            if (status) {
              status.textContent = `Fix ${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}${fix.accuracy ? ` · ±${Math.round(fix.accuracy)} m` : ''}. Starting…`;
            }
            const opened = await startSession(viewCtx.db, {
              courseId: course.id,
              lecturerId: user.id,
              durationMin: minutes,
              location: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, radius: FENCE_METRES }
            });
            toast('Attendance open', {
              message: `${course.code} · code ${opened.code} · ${minutes} minutes · ${FENCE_METRES} m fence`,
              tone: 'success',
              duration: 6000
            });
            viewCtx.refresh();
          } catch (err) {
            button.disabled = false;
            button.innerHTML = `${icon('pin', 16)} START & CAPTURE LOCATION`;
            if (status) status.textContent = err.message;
            toast('Could not start attendance', { message: err.message, tone: 'error', duration: 6500 });
          }
        });
      }
    };
  }

  /* Live session */
  const venue = sessionVenue(db, active);
  const records = db.attendance.filter((a) => a.sessionId === active.id);
  const recordByStudent = new Map(records.map((record) => [record.studentId, record]));
  const present = records.filter((record) => record.status === 'present').length;
  const late = records.filter((record) => record.status === 'late').length;
  const absent = Math.max(0, students.length - records.length);
  const rate = pctOf(records.length, students.length);

  const roster = students
    .map((student) => {
      const record = recordByStudent.get(student.id) || null;
      return { student, record, status: record ? record.status : 'absent' };
    })
    .sort((a, b) => {
      const order = { present: 0, late: 1, absent: 2 };
      return order[a.status] - order[b.status] || a.student.name.localeCompare(b.student.name);
    });

  const rosterRows = roster
    .map(
      (row) => `<tr data-row="${esc((row.student.name + ' ' + row.student.regNo).toLowerCase())}">
        <td><div class="person">${avatar(row.student.name, row.status === 'absent' ? 'red' : row.status === 'late' ? 'amber' : 'green')}<div><div class="name">${esc(row.student.name)}</div><div class="sub">${esc(row.student.regNo)}</div></div></div></td>
        <td>${statusPill(row.status)}</td>
        <td class="nowrap">${row.record ? fmtTime(row.record.checkedInAt) : '—'}</td>
        <td class="num">${row.record && row.record.distanceM != null ? row.record.distanceM + ' m' : '—'}</td>
      </tr>`
    )
    .join('');

  const latest = records
    .slice()
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt))
    .slice(0, 8)
    .map((record) => {
      const student = db.students.find((s) => s.id === record.studentId);
      return `<div class="rank-item">
        ${avatar(student ? student.name : '?', record.status === 'late' ? 'amber' : 'green')}
        <div class="m">
          <div class="t">${esc(student ? student.name : 'Student')}</div>
          <div class="s">${fmtTime(record.checkedInAt)} · ${record.distanceM} m from class</div>
        </div>
        ${statusPill(record.status)}
      </div>`;
    })
    .join('');

  const html = `<div class="session-hero mb-16">
      <div class="spread">
        <div>
          <div class="label">Attendance open</div>
          <div class="value" style="font-size:19px;margin-top:2px">${esc(course.code)} · ${esc(course.name)}</div>
          <div class="tiny mt-8" style="color:#8b9ab2">${esc(roomFor(db, course))} · ${fmtTime(active.startedAt)} – ${fmtTime(active.endsAt)} · ${venue.radius} m fence</div>
        </div>
        <span class="pill pill-live"><span class="dot"></span>Live</span>
      </div>

      <div class="code-hero mt-16">
        <div>
          <div class="label">Read this code out to the class</div>
          <div class="code-display" style="justify-content:flex-start;margin-top:8px">
            ${String(active.code).split('').map((digit) => `<span>${esc(digit)}</span>`).join('')}
          </div>
        </div>
        <div class="row">
          <button class="btn btn-soft btn-sm" data-action="copy-code">${icon('copy', 13)} Copy</button>
          <button class="btn btn-soft btn-sm" data-action="rotate-code">${icon('refresh', 13)} New code</button>
        </div>
      </div>

      <div class="spread mt-16">
        <div>
          <div class="label">Code expires in</div>
          <div class="countdown" data-countdown>--:--</div>
        </div>
        <button class="btn btn-soft btn-sm" data-action="refresh">${icon('refresh', 13)} Refresh</button>
      </div>
      <div class="progress green mt-12" style="background:rgba(255,255,255,.12)"><i data-countdown-bar style="width:100%"></i></div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('check', 14)} Present</div><div class="kpi-value">${present}</div><div class="kpi-foot">On time</div></div>
      <div class="kpi"><div class="kpi-label">${icon('clock', 14)} Late</div><div class="kpi-value">${late}</div><div class="kpi-foot">After 5 minutes</div></div>
      <div class="kpi"><div class="kpi-label">${icon('x', 14)} Not posted</div><div class="kpi-value">${absent}</div><div class="kpi-foot">On the list, still waiting</div></div>
      <div class="kpi"><div class="kpi-label">${icon('trending', 14)} Attendance rate</div><div class="kpi-value">${Math.round(rate)}<small>%</small></div><div class="kpi-foot">${records.length} of ${students.length} students</div></div>
    </div>

    <div class="split">
      <div class="card">
        <div class="card-head">
          <div class="card-title">${icon('users', 16)} Live feed</div>
          <span class="pill pill-live"><span class="dot"></span>${records.length} posted</span>
        </div>
        <div class="card-body">
          ${latest || `<div class="empty"><div class="ic">${icon('key', 20)}</div>Waiting for the first student to enter ${esc(active.code)}.</div>`}
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-title mb-8">${icon('shield', 16)} This session</div>
        <div class="stat-row"><span class="k">Code</span><span class="v mono">${esc(active.code)}</span></div>
        <div class="stat-row"><span class="k">Opened</span><span class="v">${fmtTime(active.startedAt)}</span></div>
        <div class="stat-row"><span class="k">Expires</span><span class="v">${fmtTime(active.endsAt)}</span></div>
        <div class="stat-row"><span class="k">Class location</span><span class="v">${venue.lat != null ? `${Number(venue.lat).toFixed(5)}, ${Number(venue.lng).toFixed(5)}` : '—'}</span></div>
        <div class="stat-row"><span class="k">Fence</span><span class="v">${venue.radius} m</span></div>
        <div class="stat-row"><span class="k">Student list</span><span class="v">${students.length} uploaded</span></div>
        <div class="muted tiny mt-12">A student with the right code but outside ${venue.radius} m is rejected by the server.</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div class="card-title">${icon('users', 16)} Student list</div>
        <div class="row">
          <input class="input" id="roster-search" placeholder="Search name or ID" style="width:200px" autocomplete="off">
          <span class="pill pill-brand">${records.length}/${students.length}</span>
        </div>
      </div>
      <div class="table-wrap" style="max-height:460px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>Student</th><th>Status</th><th>Posted</th><th class="num">Distance</th></tr></thead>
          <tbody>${rosterRows || `<tr><td colspan="4"><div class="empty">No students uploaded yet. <a href="#/lecturer/setup?course=${course.id}">Upload the list</a>.</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  return {
    eyebrow: 'AttendEase · Live',
    title: `${course.code} · ${course.name}`,
    sub: `${roomFor(db, course)} · ${active.durationMin} minute window · ${venue.radius} m fence`,
    actions: `<button class="btn btn-danger btn-sm" data-action="end">${icon('stop', 14)} END ATTENDANCE</button>`,
    html,
    mount(root, viewCtx) {
      let timer = null;
      const durationMs = Math.max(1, active.durationMin) * 60000;

      const tick = () => {
        const remaining = new Date(active.endsAt).getTime() - Date.now();
        const el = root.querySelector('[data-countdown]');
        if (el) {
          el.textContent = countdownText(remaining);
          el.classList.toggle('urgent', remaining < 60000);
        }
        const bar = root.querySelector('[data-countdown-bar]');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, (remaining / durationMs) * 100))}%`;
        if (remaining <= 0) {
          clearInterval(timer);
          endSession(viewCtx.db, active.id)
            .then(() => {
              toast('Session ended', { message: `${course.code} stopped accepting posts.`, tone: 'warn' });
              viewCtx.refresh();
            })
            .catch(() => viewCtx.refresh());
        }
      };
      tick();
      timer = setInterval(tick, 1000);

      const refresh = root.querySelector('[data-action="refresh"]');
      if (refresh) refresh.addEventListener('click', () => viewCtx.refresh());

      const copy = root.querySelector('[data-action="copy-code"]');
      if (copy) {
        copy.addEventListener('click', async () => {
          const ok = await copyText(active.code);
          toast(ok ? 'Code copied' : 'Copy not available', {
            message: ok ? 'Paste it into the class group chat if students cannot hear you.' : 'Read the four digits out instead.',
            tone: ok ? 'success' : 'warn'
          });
        });
      }

      const rotate = root.querySelector('[data-action="rotate-code"]');
      if (rotate) {
        rotate.addEventListener('click', async () => {
          rotate.disabled = true;
          try {
            const next = await rotateSessionCode(viewCtx.db, active.id);
            toast('New code issued', {
              message: `The old code stopped working. New code: ${next.code}`,
              tone: 'success',
              duration: 6000
            });
            viewCtx.refresh();
          } catch (err) {
            rotate.disabled = false;
            toast('Could not change the code', { message: err.message, tone: 'error' });
          }
        });
      }

      const end = root.querySelector('[data-action="end"]');
      if (end) {
        end.addEventListener('click', () => {
          modal({
            title: 'End attendance?',
            sub: `${course.code} stops accepting posts.`,
            body: `<div class="muted small">${records.length} of ${students.length} students have posted. The code stops working immediately.</div>`,
            footer: `<button class="btn btn-soft" data-modal="cancel">Keep open</button><button class="btn btn-danger" data-modal="confirm">END ATTENDANCE</button>`,
            onMount(wrap, close) {
              wrap.querySelector('[data-modal="cancel"]').addEventListener('click', close);
              wrap.querySelector('[data-modal="confirm"]').addEventListener('click', async () => {
                close();
                try {
                  await endSession(viewCtx.db, active.id);
                  toast('Attendance ended', { message: 'Session saved to the report.', tone: 'success' });
                  viewCtx.refresh();
                } catch (err) {
                  toast('Could not end attendance', { message: err.message, tone: 'error' });
                }
              });
            }
          });
        });
      }

      const search = root.querySelector('#roster-search');
      if (search) {
        search.addEventListener('input', () => {
          const q = search.value.trim().toLowerCase();
          root.querySelectorAll('[data-row]').forEach((row) => {
            row.style.display = !q || row.dataset.row.includes(q) ? '' : 'none';
          });
        });
      }

      return () => {
        if (timer) clearInterval(timer);
      };
    }
  };
}

/* ------------------------------------------------------------------ */
/* Analysis + downloadable report                                      */
/* ------------------------------------------------------------------ */

export function analytics(ctx) {
  const { db, user } = ctx;
  const courses = coursesForLecturer(db, user.id);
  const selectedId = ctx.params.course || (courses[0] && courses[0].id);
  const analysis = selectedId ? courseAnalytics(db, selectedId) : null;

  if (!analysis) {
    return {
      eyebrow: 'AttendEase · Lecturer',
      title: 'Analysis',
      sub: 'No unit selected.',
      html: `<div class="empty"><div class="ic">${icon('chart', 20)}</div>No analysis available.<div class="mt-16"><a class="btn btn-primary btn-sm" href="#/lecturer/classes">My units</a></div></div>`
    };
  }

  const options = courses
    .map((course) => `<option value="${course.id}"${course.id === selectedId ? ' selected' : ''}>${esc(course.code)} · ${esc(course.name)}</option>`)
    .join('');

  const perStudent = analysis.perStudent.slice().sort((a, b) => b.pct - a.pct || a.student.name.localeCompare(b.student.name));
  const highest = perStudent.reduce((best, row) => (!best || row.attended > best.attended ? row : best), null);
  const below = perStudent.filter((row) => row.pct < 70).length;

  const rows = perStudent
    .map(
      (row) => `<tr>
        <td><div class="person">${avatar(row.student.name, row.pct < 70 ? 'red' : row.pct < 80 ? 'amber' : 'green')}<div><div class="name">${esc(row.student.name)}</div><div class="sub">${esc(row.student.regNo)}</div></div></div></td>
        <td class="num nowrap"><span class="strong">${row.attended}</span><span class="muted"> / ${row.total}</span></td>
        <td class="num strong">${pctText(row.pct)}</td>
        <td>
          ${attendancePill(row.pct)}
        </td>
      </tr>`
    )
    .join('');

  const html = `<div class="card card-pad mb-16">
      <div class="spread">
        <div class="row">
          ${ring(analysis.avgPct, { size: 66, stroke: 6 })}
          <div>
            <div class="pill pill-brand">${esc(analysis.course.code)}</div>
            <h2 style="font-size:18px;margin-top:6px">${esc(analysis.course.name)}</h2>
            <div class="muted small">${analysis.enrolled} students · ${analysis.sessionCount} sessions · ${esc(roomFor(db, analysis.course))}</div>
          </div>
        </div>
        <select class="select" id="course-select" style="width:260px">${options}</select>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('chart', 14)} Class attendance rate</div><div class="kpi-value">${pctText(analysis.avgPct)}</div><div class="kpi-foot">Average across the unit</div></div>
      <div class="kpi"><div class="kpi-label">${icon('star', 14)} Highest attendee</div><div class="kpi-value">${highest ? `${highest.attended}/${highest.total}` : '—'}</div><div class="kpi-foot">${highest ? esc(highest.student.name) : 'No sessions yet'}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('alert', 14)} Students below 70%</div><div class="kpi-value">${below}</div><div class="kpi-foot">Exam eligibility risk</div></div>
      <div class="kpi"><div class="kpi-label">${icon('calendar', 14)} Sessions held</div><div class="kpi-value">${analysis.sessionCount}</div><div class="kpi-foot">${analysis.lastSession ? fmtDate(analysis.lastSession.startedAt) : 'No sessions yet'}</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">${icon('users', 16)} Student attendance</div>
        <div class="row">
          <button class="btn btn-soft btn-sm" id="print-report">${icon('download', 15)} Print / PDF</button>
          <button class="btn btn-primary btn-sm" id="download-report">${icon('download', 15)} DOWNLOAD REPORT</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Student</th><th class="num">Attendance</th><th class="num">Percentage</th><th>Status</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4"><div class="empty">Upload the student list to see the analysis.</div></td></tr>`}</tbody>
        </table>
      </div>
      <div class="card-foot">
        <span class="muted tiny">Report columns: Student Name, Student ID, Classes Attended, Total Classes, Percentage.</span>
        <span class="muted tiny">${analysis.sessionCount} completed session${analysis.sessionCount === 1 ? '' : 's'}</span>
      </div>
    </div>`;

  return {
    eyebrow: 'AttendEase · Lecturer',
    title: 'Analysis',
    sub: 'Class attendance rate, the highest attendee and the students below 70%.',
    actions: `<a class="btn btn-soft btn-sm" href="#/lecturer/classes">${icon('arrow', 15)} My units</a>`,
    html,
    mount(root) {
      const select = root.querySelector('#course-select');
      if (select) {
        select.addEventListener('change', () => {
          window.location.hash = `#/lecturer/analytics?course=${select.value}`;
        });
      }

      const download = root.querySelector('#download-report');
      if (download) {
        download.addEventListener('click', () => {
          downloadCSV(
            `attendease-${analysis.course.code}-report.csv`,
            ['Student Name', 'Student ID', 'Classes Attended', 'Total Classes', 'Percentage'],
            perStudent.map((row) => [
              row.student.name,
              row.student.regNo,
              row.attended,
              row.total,
              round1(row.pct)
            ])
          );
          toast('Report downloaded', {
            message: `${analysis.course.code} · opens in Excel.`,
            tone: 'success'
          });
        });
      }

      const print = root.querySelector('#print-report');
      if (print) {
        print.addEventListener('click', () => window.print());
      }
    }
  };
}
