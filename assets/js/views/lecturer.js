/**
 * AttendSmart AI — lecturer console.
 *
 * Class setup  → publish the final register, venue, schedule and window length.
 * Attendance   → open a window, watch names arrive live, close it.
 * Report       → compiled register plus the attempts that were filtered out.
 * Analytics    → trend, risk and absentee lists.
 */

import {
  activeSessionForCourse,
  activeSessions,
  bleNameFor,
  courseById,
  coursesForLecturer,
  endSession,
  finalizeCourseRoster,
  hallById,
  importRoster,
  sessionReport,
  setCourseRoster,
  setCourseVenue,
  startSession,
  updateCourseSetup,
  DAY_NAMES
} from '../data.js';
import { scanForReceiver } from '../gps.js';
import { courseAnalytics, courseSlot, pctOf, round1 } from '../analytics.js';
import {
  icon,
  esc,
  ring,
  progress,
  attendancePill,
  statusPill,
  fmtDate,
  fmtTime,
  fmtDateTime,
  toast,
  modal,
  downloadCSV,
  countdownText,
  avatar,
  pctText,
  areaChart
} from '../ui.js';

const ATTEMPT_LABELS = {
  unregistered_attempt: 'Not registered',
  identity_locked: 'Identity locked',
  device_reuse: 'Device reuse'
};

/** Parse a two-column paste (student ID, name) from Excel. */
function parseRoster(text) {
  const entries = [];
  const invalid = [];
  const seen = new Set();

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let regNo = '';
    let name = '';
    if (line.includes('\t')) {
      const parts = line.split('\t').map((p) => p.trim());
      regNo = parts[0];
      name = parts[1] || '';
    } else if (line.includes(',')) {
      const parts = line.split(',').map((p) => p.trim());
      regNo = parts[0];
      name = parts[1] || '';
    } else {
      const match = line.match(/^(\S+)\s+(.+)$/);
      if (match) {
        regNo = match[1];
        name = match[2];
      }
    }

    if (/^(id|reg(no)?|registration|student\s*id)$/i.test(regNo) && /^(name|student\s*name)$/i.test(name)) continue;
    if (!regNo || !name || !/\d/.test(regNo)) {
      invalid.push(line);
      continue;
    }

    const key = regNo.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ regNo, name });
  }

  return { entries, invalid };
}

/* ------------------------------------------------------------------ */
/* My classes                                                          */
/* ------------------------------------------------------------------ */

export function overview(ctx) {
  const { db, user } = ctx;
  const courses = coursesForLecturer(db, user.id);
  const rows = courses.map((c) => ({ analytics: courseAnalytics(db, c.id), course: c })).filter((r) => r.analytics);
  const liveSessions = activeSessions(db).filter((s) => courses.some((c) => c.id === s.courseId));

  const studentsTaught = new Set();
  for (const c of courses) for (const id of c.studentIds) studentsTaught.add(id);

  const avg = rows.length ? rows.reduce((sum, r) => sum + r.analytics.avgPct, 0) / rows.length : 0;
  const atRisk = rows.reduce((sum, r) => sum + r.analytics.atRisk.length, 0);

  const courseCards = rows
    .map(({ analytics, course }) => {
      const active = activeSessionForCourse(db, course.id);
      const hall = hallById(db, course.hallId);
      const isFinal = !!course.rosterFinalizedAt;
      return `<div class="card card-pad">
        <div class="spread" style="align-items:flex-start">
          <div>
            <span class="pill pill-brand">${esc(course.code)}</span>
            <h3 style="font-size:15px;margin-top:8px">${esc(course.name)}</h3>
            <div class="muted small mt-8">${esc(courseSlot(course))} · ${esc(hall ? hall.name : 'TBA')}</div>
          </div>
          ${ring(analytics.avgPct, { size: 58, stroke: 5 })}
        </div>
        <div class="mt-16">${progress(analytics.avgPct)}</div>
        <div class="spread mt-8">
          <span class="tiny muted">${analytics.enrolled} students · ${analytics.sessionCount} sessions · ${analytics.atRisk.length} at risk</span>
          <span class="pill ${isFinal ? 'pill-green' : 'pill-amber'}">${isFinal ? 'Register final' : 'Register needed'}</span>
        </div>
        <div class="row mt-16">
          ${
            active
              ? `<a class="btn btn-green btn-sm grow" href="#/lecturer/session?course=${course.id}">${icon('play', 14)} Open live attendance</a>`
              : `<a class="btn btn-primary btn-sm grow" href="#/lecturer/session?course=${course.id}">${icon('play', 14)} Take attendance</a>`
          }
          <a class="btn btn-soft btn-sm" href="#/lecturer/analytics?course=${course.id}">${icon('chart', 14)} Students</a>
        </div>
      </div>`;
    })
    .join('');

  const recent = db.sessions
    .filter((s) => courses.some((c) => c.id === s.courseId))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 6)
    .map((s) => {
      const course = courseById(db, s.courseId);
      const enrolled = course ? course.studentIds.length : 0;
      const count = db.attendance.filter((a) => a.sessionId === s.id).length;
      return { session: s, course, enrolled, count, rate: pctOf(count, enrolled) };
    });

  const html = `${liveSessions
    .map((s) => {
      const c = courseById(db, s.courseId);
      const count = db.attendance.filter((a) => a.sessionId === s.id).length;
      return `<div class="alert alert-green mb-16">
        <span class="alert-icon">${icon('bluetooth', 16)}</span>
        <div class="grow">
          <div class="alert-title">${esc(c.code)} attendance window is open</div>
          <div class="alert-body">${count} of ${c.studentIds.length} students have posted · closes ${fmtTime(s.endsAt)}</div>
        </div>
        <a class="btn btn-green btn-sm" href="#/lecturer/session?course=${c.id}">Manage</a>
      </div>`;
    })
    .join('')}
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('book', 14)} My courses</div><div class="kpi-value">${courses.length}</div><div class="kpi-foot">${esc(user.department)}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('users', 14)} Students taught</div><div class="kpi-value">${studentsTaught.size}</div><div class="kpi-foot">On final registers</div></div>
      <div class="kpi"><div class="kpi-label">${icon('chart', 14)} Average attendance</div><div class="kpi-value">${pctText(avg)}</div><div class="kpi-foot">${rows.length} course${rows.length === 1 ? '' : 's'}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('alert', 14)} Students at risk</div><div class="kpi-value">${atRisk}</div><div class="kpi-foot">Below the 70% threshold</div></div>
    </div>

    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('book', 16)} My classes</div><span class="card-hint">Take attendance or open student analytics</span></div>
          <div class="card-body"><div class="grid grid-2">${courseCards || '<div class="empty">No courses assigned yet.</div>'}</div></div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('clock', 16)} Recent sessions</div></div>
          <div class="card-body tight">
            ${
              recent.length
                ? recent
                    .map(
                      (r) => `<div class="stat-row" style="padding:11px 20px">
                        <div>
                          <div class="strong">${esc(r.course.code)} <span class="muted tiny">· ${fmtDate(r.session.startedAt)}</span></div>
                          <div class="tiny muted">${r.count}/${r.enrolled} posted</div>
                        </div>
                        <span class="pill ${r.rate >= 80 ? 'pill-green' : r.rate >= 70 ? 'pill-amber' : 'pill-red'}">${Math.round(r.rate)}%</span>
                      </div>`
                    )
                    .join('')
                : '<div class="empty">No sessions yet.</div>'
            }
          </div>
        </div>
        <div class="card card-pad">
          <div class="card-title mb-8">${icon('users', 16)} Course registration</div>
          <div class="muted small">Post the class details, student names and IDs once. After the register is final, just take attendance when class starts.</div>
          <div class="row mt-12">
            <a class="btn btn-soft btn-sm" href="#/lecturer/setup">${icon('users', 14)} Register a course</a>
          </div>
        </div>
      </div>
    </div>`;

  return {
    eyebrow: 'Lecturer console',
    title: 'Attendance',
    sub: 'Your classes, live windows and student analytics.',
    actions: `<a class="btn btn-soft btn-sm" href="#/lecturer/analytics">${icon('chart', 15)} Student analytics</a>`,
    html
  };
}

/* ------------------------------------------------------------------ */
/* Class setup                                                         */
/* ------------------------------------------------------------------ */

export function setup(ctx) {
  const { db, user } = ctx;
  const courses = coursesForLecturer(db, user.id);
  const selectedId = ctx.params.course || (courses[0] && courses[0].id);
  const course = selectedId ? courseById(db, selectedId) : null;

  if (!course) {
    return {
      eyebrow: 'Lecturer console',
      title: 'Register course',
      sub: 'No course assigned.',
      html: '<div class="empty">Ask the administrator to assign you a course.</div>'
    };
  }

  const final = !!course.rosterFinalizedAt;
  const hall = hallById(db, course.hallId);
  const captured = !!(hall && hall.id.startsWith('venue-'));
  const roster = db.students.map((s) => ({ student: s, on: course.studentIds.includes(s.id) }));

  const hallOptions = db.halls
    .map((h) => `<option value="${h.id}"${h.id === course.hallId ? ' selected' : ''}>${esc(h.name)} · ${esc(h.building)} · ${h.radius} m</option>`)
    .join('');
  const dayOptions = DAY_NAMES.map(
    (name, i) => `<option value="${i}"${i === course.day ? ' selected' : ''}>${esc(name)}</option>`
  ).join('');

  const rosterRows = roster
    .map(
      ({ student, on }) => `<label class="switch-row" data-student-row="${esc((student.name + ' ' + student.regNo).toLowerCase())}" style="${on ? '' : 'opacity:.62'}">
        <span class="person">${avatar(student.name, on ? 'green' : '')}<span><span class="name">${esc(student.name)}</span><span class="sub">${esc(student.regNo)} · ${esc(student.program)}</span></span></span>
        <input type="checkbox" data-student="${student.id}" ${on ? 'checked' : ''} ${final ? 'disabled' : ''}>
      </label>`
    )
    .join('');

  const html = `<div class="card card-pad mb-16">
      <div class="spread">
        <div>
          <div class="eyebrow small muted">Class</div>
          <h2 style="font-size:19px;margin-top:4px">${esc(course.code)} · ${esc(course.name)}</h2>
          <div class="muted small mt-4">${esc(course.department)} · ${esc(course.semester)}</div>
        </div>
        <div class="row">
          <select class="select" id="course-select" style="width:260px">
            ${courses.map((c) => `<option value="${c.id}"${c.id === course.id ? ' selected' : ''}>${esc(c.code)} · ${esc(c.name)}</option>`).join('')}
          </select>
          <span class="pill ${final ? 'pill-green' : 'pill-amber'}" id="final-pill">${final ? 'Final for semester' : 'Draft setup'}</span>
        </div>
      </div>
    </div>

    ${final
      ? `<div class="alert alert-green mb-16">
          <span class="alert-icon">${icon('shield', 16)}</span>
          <div>
            <div class="alert-title">Final register posted ${fmtDate(course.rosterFinalizedAt)}</div>
            <div class="alert-body">The register, venue and schedule are locked for the semester. Students not on it will be filtered out of every attendance window.</div>
          </div>
        </div>`
      : `<div class="alert alert-brand mb-16">
          <span class="alert-icon">${icon('info', 16)}</span>
          <div>
            <div class="alert-title">Set this up once, at the start of semester</div>
            <div class="alert-body">Changes save automatically. When the register is final, post it — after that, names and venue cannot be changed. Register updates are the only step meant to sync over a connection; attendance itself runs on Bluetooth and this device's database.</div>
          </div>
        </div>`}

    <div class="split">
      <div class="card">
        <div class="card-head">
          <div class="card-title">${icon('map', 16)} Class details</div>
          <span class="pill" id="save-state">All changes saved</span>
        </div>
        <div class="card-body">
          <div class="grid grid-2">
            <div class="field">
              <label for="hall">Lecture hall / location</label>
              <select class="select" id="hall" ${final ? 'disabled' : ''}>${hallOptions}</select>
            </div>
            <div class="field">
              <label for="day">Class day</label>
              <select class="select" id="day" ${final ? 'disabled' : ''}>${dayOptions}</select>
            </div>
            <div class="field">
              <label for="start">Starts</label>
              <input class="input" type="time" id="start" value="${esc(course.start)}" ${final ? 'disabled' : ''}>
            </div>
            <div class="field">
              <label for="end">Ends</label>
              <input class="input" type="time" id="end" value="${esc(course.end)}" ${final ? 'disabled' : ''}>
            </div>
            <div class="field">
              <label for="window">Attendance window (minutes)</label>
              <input class="input" type="number" id="window" min="5" max="60" value="${course.windowMinutes || 15}" ${final ? 'disabled' : ''}>
            </div>
            <div class="field">
              <label for="semester">Semester label</label>
              <input class="input" id="semester" value="${esc(course.semester || '')}" ${final ? 'disabled' : ''}>
            </div>
          </div>
          <div class="card-pad mt-16" style="padding:14px;border:1px solid var(--line-soft);border-radius:12px">
            <div class="spread">
              <div>
                <div class="small strong">${icon('pin', 15)} Classroom GPS</div>
                <div class="muted tiny mt-4">${captured
                  ? `${hall.lat.toFixed(6)}, ${hall.lng.toFixed(6)}${course.venueAccuracy ? ` · ±${course.venueAccuracy} m` : ''}`
                  : 'Pick a saved hall above, or capture this room now.'}</div>
              </div>
              <div class="row">
                <button class="btn btn-soft btn-sm" data-capture="phone" ${final ? 'disabled' : ''}>Use this phone</button>
                <button class="btn btn-soft btn-sm" data-capture="external" ${final ? 'disabled' : ''}>Scan BT-821C</button>
              </div>
            </div>
            <div class="muted tiny mt-8" id="capture-status"></div>
          </div>

          <div class="stat-row mt-16"><span class="k">BLE broadcast</span><span class="v mono tiny">${esc(bleNameFor(course, course.day))}</span></div>
          <div class="stat-row"><span class="k">Location fence</span><span class="v">${esc(hall ? hall.name : '—')} · ${hall ? hall.radius : '—'} m</span></div>
          <div class="stat-row"><span class="k">Attendance window</span><span class="v">${course.windowMinutes || 15} minutes per session</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">${icon('users', 16)} Final register</div>
          <span class="pill pill-brand" id="roster-count">${course.studentIds.length} / ${db.students.length}</span>
        </div>
        <div class="card-body">
          <div class="muted small">Only students on this list can post attendance. Everyone else who tries is recorded as a filtered attempt for your session report.</div>
          <div class="card-pad" style="padding:14px 0 0">
            <div class="stat-row"><span class="k">Registered</span><span class="v">${course.studentIds.length} students</span></div>
            <div class="stat-row"><span class="k">Register status</span><span class="v">${final ? 'Posted · locked' : 'Draft · editable'}</span></div>
            <div class="stat-row"><span class="k">Sessions held</span><span class="v">${db.sessions.filter((s) => s.courseId === course.id).length}</span></div>
          </div>
          ${
            final
              ? `<button class="btn btn-soft btn-block mt-16" disabled>${icon('lock', 15)} Register locked</button>`
              : `<button class="btn btn-primary btn-block mt-16" id="finalize">${icon('shield', 15)} Post final register</button>
                 <div class="muted tiny mt-8" style="text-align:center">Names, venue and schedule lock once posted.</div>`
          }
          <div class="row mt-12">
            <a class="btn btn-soft btn-sm grow" href="#/lecturer/session?course=${course.id}">${icon('play', 14)} Attendance window</a>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div class="card-title">${icon('upload', 16)} Paste from Excel</div>
        <span class="card-hint">Student ID + name · one per row</span>
      </div>
      <div class="card-body">
        <div class="muted small">Copy two columns from the spreadsheet — ID first, then name. Tabs, commas or spaces separate them; the ID is the primary key, so a repeat never duplicates a student.</div>
        <textarea class="input mt-12" id="roster-paste" rows="5" spellcheck="false" placeholder="BAR/2023/101&#9;John Kimutai&#10;BAR/2023/102&#9;Mary Barasa" ${final ? 'disabled' : ''}></textarea>
        <div class="spread mt-8">
          <span class="muted tiny" id="paste-status">Paste rows to preview.</span>
          <button class="btn btn-primary btn-sm" id="import-roster" disabled>${icon('users', 14)} Add to register</button>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div class="card-title">${icon('user', 16)} Registered students</div>
        <div class="row">
          <input class="input" id="roster-search" placeholder="Search name or reg no" style="width:240px" autocomplete="off">
          <span class="pill ${final ? 'pill-green' : ''}">${final ? 'Locked' : 'Editable'}</span>
        </div>
      </div>
      <div class="card-body" style="max-height:520px;overflow-y:auto;padding-top:4px" id="roster-list">
        ${rosterRows}
      </div>
      <div class="card-foot">
        <span class="muted tiny">${course.studentIds.length} of ${db.students.length} students on the register</span>
        <span class="muted tiny">${final ? 'Posted ' + fmtDate(course.rosterFinalizedAt) : 'Toggles save automatically'}</span>
      </div>
    </div>`;

  return {
    eyebrow: 'Lecturer console',
    title: 'Register course',
    sub: 'Post the class details, student names and IDs once — it is final for the semester.',
    actions: `<a class="btn btn-soft btn-sm" href="#/lecturer/classes">${icon('arrow', 15)} Attendance</a>`,
    html,
    mount(root, viewCtx) {
      const select = root.querySelector('#course-select');
      if (select) {
        select.addEventListener('change', () => {
          window.location.hash = `#/lecturer/setup?course=${select.value}`;
        });
      }

      const saved = (patch, revertOnError) => {
        const stateEl = root.querySelector('#save-state');
        try {
          updateCourseSetup(viewCtx.db, course.id, patch);
          if (stateEl) {
            stateEl.textContent = 'Saved just now';
            stateEl.className = 'pill pill-green';
          }
        } catch (err) {
          toast('Could not save', { message: err.message, tone: 'error' });
          if (stateEl) {
            stateEl.textContent = 'Save failed';
            stateEl.className = 'pill pill-red';
          }
          if (revertOnError) viewCtx.refresh();
        }
      };

      if (!final) {
        const hall = root.querySelector('#hall');
        const day = root.querySelector('#day');
        const start = root.querySelector('#start');
        const end = root.querySelector('#end');
        const windowInput = root.querySelector('#window');
        const semester = root.querySelector('#semester');

        if (hall) hall.addEventListener('change', () => saved({ hallId: hall.value }));
        if (day) day.addEventListener('change', () => saved({ day: Number(day.value) }));
        if (start) start.addEventListener('change', () => saved({ start: start.value }, true));
        if (end) end.addEventListener('change', () => saved({ end: end.value }, true));
        if (windowInput) windowInput.addEventListener('change', () => saved({ windowMinutes: Number(windowInput.value) }, true));
        if (semester) semester.addEventListener('change', () => saved({ semester: semester.value }));

        const rosterInputs = [...root.querySelectorAll('[data-student]')];
        rosterInputs.forEach((box) => {
          box.addEventListener('change', () => {
            const ids = rosterInputs.filter((b) => b.checked).map((b) => b.dataset.student);
            try {
              setCourseRoster(viewCtx.db, course.id, ids);
              const count = root.querySelector('#roster-count');
              if (count) count.textContent = `${ids.length} / ${viewCtx.db.students.length}`;
              if (stateEl()) {
                stateEl().textContent = 'Saved just now';
                stateEl().className = 'pill pill-green';
              }
              const row = box.closest('[data-student-row]');
              if (row) row.style.opacity = box.checked ? '1' : '.62';
            } catch (err) {
              box.checked = !box.checked;
              toast('Could not save register', { message: err.message, tone: 'error' });
            }
          });
        });

        const captureStatus = root.querySelector('#capture-status');
        root.querySelectorAll('[data-capture]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const source = btn.dataset.capture;
            const original = btn.innerHTML;
            btn.disabled = true;
            if (captureStatus) {
              captureStatus.textContent = source === 'phone' ? 'Reading this device’s GPS…' : 'Scanning for the BT-821C…';
            }
            try {
              let coords;
              if (source === 'phone') {
                coords = await new Promise((resolve, reject) => {
                  if (!navigator.geolocation) return reject(new Error('This browser has no Geolocation API.'));
                  navigator.geolocation.getCurrentPosition(
                    (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
                    (err) => reject(new Error(err.code === 1 ? 'Location permission was denied. Allow it, or scan the BT-821C.' : 'No GPS fix here. Try again outdoors or with the BT-821C.')),
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                  );
                });
              } else {
                const scan = await scanForReceiver();
                if (!scan.ok) throw new Error(scan.error);
                if (!scan.fix) {
                  throw new Error(`Receiver found${scan.port ? ' on ' + scan.port : ''} but it has no satellite fix yet.`);
                }
                coords = scan.fix;
              }
              const savedHall = setCourseVenue(viewCtx.db, course.id, {
                ...coords,
                radius: hall ? hall.radius : 50
              });
              toast('Classroom location saved', {
                message: `${savedHall.lat.toFixed(6)}, ${savedHall.lng.toFixed(6)} · fence ${savedHall.radius} m`,
                tone: 'success'
              });
              viewCtx.refresh();
            } catch (err) {
              if (captureStatus) captureStatus.textContent = err.message;
              btn.disabled = false;
              btn.innerHTML = original;
            }
          });
        });

        const paste = root.querySelector('#roster-paste');
        const importBtn = root.querySelector('#import-roster');
        const pasteStatus = root.querySelector('#paste-status');
        if (paste) {
          paste.addEventListener('input', () => {
            const { entries, invalid } = parseRoster(paste.value);
            if (pasteStatus) {
              pasteStatus.textContent = entries.length
                ? `${entries.length} student${entries.length === 1 ? '' : 's'} ready${invalid.length ? ` · ${invalid.length} line(s) skipped` : ''}`
                : 'Paste rows to preview.';
            }
            if (importBtn) importBtn.disabled = !entries.length;
          });
        }
        if (importBtn) {
          importBtn.addEventListener('click', () => {
            const { entries } = parseRoster(paste.value);
            if (!entries.length) return;
            try {
              const result = importRoster(viewCtx.db, course.id, entries);
              const bits = [`${result.added.length} added`];
              if (result.already.length) bits.push(`${result.already.length} already on it`);
              if (result.invalid.length) bits.push(`${result.invalid.length} skipped`);
              if (result.added.length === 0 && result.already.length) bits[0] = 'Students already on the register';
              toast('Register updated', { message: bits.join(' · '), tone: 'success' });
              viewCtx.refresh();
            } catch (err) {
              toast('Could not import', { message: err.message, tone: 'error' });
            }
          });
        }

        const finalize = root.querySelector('#finalize');
        if (finalize) {
          finalize.addEventListener('click', () => {
            modal({
              title: 'Post the final register?',
              sub: `${course.code} · ${course.studentIds.length} students`,
              body: `<div class="alert alert-amber"><span class="alert-icon">${icon('alert', 16)}</span><div><div class="alert-title">This locks the class</div><div class="alert-body">After posting, the register, venue, schedule and attendance window cannot be changed for the semester. Unregistered students will be filtered out of every session.</div></div></div>`,
              footer: `<button class="btn btn-soft" data-modal="cancel">Not yet</button><button class="btn btn-primary" data-modal="confirm">Post register</button>`,
              onMount(wrap, close) {
                wrap.querySelector('[data-modal="cancel"]').addEventListener('click', close);
                wrap.querySelector('[data-modal="confirm"]').addEventListener('click', () => {
                  try {
                    finalizeCourseRoster(viewCtx.db, course.id);
                    close();
                    toast('Register posted', { message: `${course.code} is now final for the semester.`, tone: 'success' });
                    viewCtx.refresh();
                  } catch (err) {
                    toast('Could not post register', { message: err.message, tone: 'error' });
                  }
                });
              }
            });
          });
        }
      }

      const search = root.querySelector('#roster-search');
      if (search) {
        search.addEventListener('input', () => {
          const q = search.value.trim().toLowerCase();
          root.querySelectorAll('[data-student-row]').forEach((row) => {
            row.style.display = !q || row.dataset.studentRow.includes(q) ? '' : 'none';
          });
        });
      }

      // helper used above; declared after use is fine inside the closure
      function stateEl() {
        return root.querySelector('#save-state');
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Attendance window                                                   */
/* ------------------------------------------------------------------ */

function reportHTML(report) {
  const attemptRows = report.attempts.length
    ? report.attempts
        .map(
          (a) => `<tr>
            <td class="nowrap">${fmtTime(a.at)}</td>
            <td><span class="pill ${a.type === 'unregistered_attempt' ? 'pill-amber' : 'pill-red'}">${esc(ATTEMPT_LABELS[a.type] || a.type)}</span></td>
            <td class="muted small">${esc(a.detail)}</td>
          </tr>`
        )
        .join('')
    : '';

  const registerRows = report.rows
    .map(
      (r) => `<tr>
        <td><div class="person">${avatar(r.student.name, r.status === 'absent' ? 'red' : r.status === 'late' ? 'amber' : 'green')}<div><div class="name">${esc(r.student.name)}</div><div class="sub">${esc(r.student.regNo)}</div></div></div></td>
        <td>${statusPill(r.status)}</td>
        <td class="muted">${r.record ? fmtTime(r.record.checkedInAt) : '—'}</td>
        <td class="num">${r.record && r.record.distanceM != null ? r.record.distanceM + ' m' : '—'}</td>
      </tr>`
    )
    .join('');

  return `<div class="card mt-16">
    <div class="card-head">
      <div class="card-title">${icon('check', 16)} Session report · ${fmtDate(report.session.startedAt)}</div>
      <div class="row">
        <span class="pill">${fmtTime(report.session.startedAt)} – ${fmtTime(report.session.endedAt || report.session.endsAt)}</span>
        <span class="pill pill-dark">Closed</span>
      </div>
    </div>
    <div class="card-body">
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi"><div class="kpi-label">${icon('check', 14)} Present</div><div class="kpi-value">${report.present}</div><div class="kpi-foot">Registered students</div></div>
        <div class="kpi"><div class="kpi-label">${icon('clock', 14)} Late</div><div class="kpi-value">${report.late}</div><div class="kpi-foot">Posted after 5 minutes</div></div>
        <div class="kpi"><div class="kpi-label">${icon('x', 14)} Absent</div><div class="kpi-value">${report.absent}</div><div class="kpi-foot">On register, did not post</div></div>
        <div class="kpi"><div class="kpi-label">${icon('shield', 14)} Filtered attempts</div><div class="kpi-value">${report.attempts.length}</div><div class="kpi-foot">Blocked from this session</div></div>
      </div>

      <div class="split">
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('users', 16)} Compiled register</div><span class="card-hint">${report.recorded} of ${report.enrolled.length} posted</span></div>
          <div class="table-wrap" style="max-height:420px;overflow-y:auto">
            <table class="data-table">
              <thead><tr><th>Student</th><th>Status</th><th>Posted</th><th class="num">Distance</th></tr></thead>
              <tbody>${registerRows}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('shield', 16)} Filtered out</div><span class="card-hint">Attempts blocked</span></div>
          <div class="card-body tight">
            ${report.attempts.length
              ? `<div class="table-wrap"><table class="data-table">
                  <thead><tr><th>Time</th><th>Reason</th><th>Detail</th></tr></thead>
                  <tbody>${attemptRows}</tbody>
                </table></div>`
              : `<div class="alert alert-green"><span class="alert-icon">${icon('check', 16)}</span><div><div class="alert-title">No outside attempts</div><div class="alert-body">Only students on the final register posted in this session.</div></div></div>`}
          </div>
          <div class="card-foot">
            <span class="muted tiny">Compiled from the final register. Unregistered identities never enter the attendance table.</span>
          </div>
        </div>
      </div>
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
      eyebrow: 'Attendance',
      title: 'Attendance window',
      sub: 'No course assigned.',
      html: '<div class="empty">Ask the administrator to assign you a course.</div>'
    };
  }

  const active = activeSessionForCourse(db, course.id);
  const final = !!course.rosterFinalizedAt;
  const hall = hallById(db, active ? active.hallId : course.hallId);

  const lastReal = db.sessions
    .filter((s) => s.courseId === course.id && s.status === 'ended' && !s.seeded)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
  const report = !active && lastReal ? sessionReport(db, lastReal.id) : null;

  if (!active) {
    const startCard = !final
      ? `<div class="card">
          <div class="card-head"><div class="card-title">${icon('lock', 16)} Register not posted</div><span class="pill pill-amber">Setup needed</span></div>
          <div class="card-body">
            <div class="alert alert-amber mb-16">
              <span class="alert-icon">${icon('alert', 16)}</span>
              <div>
                <div class="alert-title">Post the final register first</div>
                <div class="alert-body">Attendance can only open after the semester register, venue and window are final.</div>
              </div>
            </div>
            <a class="btn btn-primary btn-block" href="#/lecturer/setup?course=${course.id}">${icon('sliders', 15)} Open class setup</a>
          </div>
        </div>`
      : `<div class="split-even">
          <div class="card">
            <div class="card-head"><div class="card-title">${icon('play', 16)} Start an attendance window</div><span class="pill pill-green">Register final</span></div>
            <div class="card-body">
              <div class="stat-row"><span class="k">Class</span><span class="v">${esc(course.code)} · ${esc(course.name)}</span></div>
              <div class="stat-row"><span class="k">Venue</span><span class="v">${esc(hall ? hall.name : '—')} · ${hall ? hall.radius : 50} m fence</span></div>
              <div class="stat-row"><span class="k">Register</span><span class="v">${course.studentIds.length} students</span></div>
              <div class="stat-row"><span class="k">Broadcast</span><span class="v mono tiny">${esc(bleNameFor(course, course.day))}</span></div>

              <div class="field mt-16">
                <label for="window">How long can students post?</label>
                <select class="select" id="window">
                  ${[5, 10, 15, 20, 30]
                    .map((m) => `<option value="${m}"${m === (course.windowMinutes || 15) ? ' selected' : ''}>${m} minutes</option>`)
                    .join('')}
                </select>
              </div>

              <button class="btn btn-primary btn-block mt-16" id="start">${icon('bluetooth', 16)} Start attendance window</button>
              <div class="muted tiny mt-8" style="text-align:center">Students nearby see it instantly and can post until it closes.</div>
            </div>
          </div>
          <div class="card card-pad">
            <div class="card-title mb-8">${icon('info', 16)} What happens when you start</div>
            <div class="check-list">
              <div class="check-item ok"><span class="check-mark">${icon('bluetooth', 12)}</span><div><div class="t">Bluetooth broadcast goes live</div><div class="d">${esc(bleNameFor(course, course.day))}</div></div></div>
              <div class="check-item ok"><span class="check-mark">${icon('pin', 12)}</span><div><div class="t">Location fence armed</div><div class="d">${esc(hall ? hall.name : 'Lecture hall')} · ${hall ? hall.radius : 50} m</div></div></div>
              <div class="check-item ok"><span class="check-mark">${icon('clock', 12)}</span><div><div class="t">Countdown starts</div><div class="d">You can close it early at any time</div></div></div>
              <div class="check-item ok"><span class="check-mark">${icon('users', 12)}</span><div><div class="t">Names arrive live</div><div class="d">Only the final register can post</div></div></div>
            </div>
          </div>
        </div>`;

    return {
      eyebrow: 'Lecturer console',
      title: `${course.code} · ${course.name}`,
      sub: 'Open a short window for students in the room to post attendance.',
      actions: `<a class="btn btn-soft btn-sm" href="#/lecturer/classes">${icon('arrow', 15)} Back to attendance</a>`,
      html: `${startCard}${report ? reportHTML(report) : ''}`,
      mount(root, viewCtx) {
        const start = root.querySelector('#start');
        if (!start) return;
        start.addEventListener('click', () => {
          const minutes = Number((root.querySelector('#window') || {}).value) || course.windowMinutes || 15;
          startSession(viewCtx.db, {
            courseId: course.id,
            lecturerId: user.id,
            hallId: course.hallId,
            durationMin: minutes
          });
          toast('Attendance window open', { message: `${course.code} · students can post for ${minutes} minutes.`, tone: 'success' });
          viewCtx.refresh();
        });
      }
    };
  }

  const records = db.attendance.filter((a) => a.sessionId === active.id);
  const recordByStudent = new Map(records.map((r) => [r.studentId, r]));
  const students = course.studentIds.map((id) => db.students.find((s) => s.id === id)).filter(Boolean);
  const present = records.filter((r) => r.status === 'present').length;
  const late = records.filter((r) => r.status === 'late').length;
  const absent = Math.max(0, students.length - records.length);
  const rate = pctOf(records.length, students.length);

  const roster = students
    .map((student) => {
      const rec = recordByStudent.get(student.id);
      return { student, rec, status: rec ? rec.status : 'absent' };
    })
    .sort((a, b) => {
      const order = { present: 0, late: 1, absent: 2 };
      return order[a.status] - order[b.status] || a.student.name.localeCompare(b.student.name);
    });

  const rosterRows = roster
    .map(
      (r) => `<tr data-row="${esc((r.student.name + ' ' + r.student.regNo).toLowerCase())}">
        <td><div class="person">${avatar(r.student.name, r.status === 'absent' ? 'red' : r.status === 'late' ? 'amber' : 'green')}<div><div class="name">${esc(r.student.name)}</div><div class="sub">${esc(r.student.regNo)}</div></div></div></td>
        <td>${statusPill(r.status)}</td>
        <td class="nowrap">${r.rec ? fmtTime(r.rec.checkedInAt) : '—'}</td>
        <td class="num">${r.rec && r.rec.distanceM != null ? r.rec.distanceM + ' m' : '—'}</td>
      </tr>`
    )
    .join('');

  const latest = records
    .slice()
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt))
    .slice(0, 8)
    .map((rec) => {
      const student = db.students.find((s) => s.id === rec.studentId);
      return `<div class="rank-item">
        ${avatar(student ? student.name : '?', rec.status === 'late' ? 'amber' : 'green')}
        <div class="m">
          <div class="t">${esc(student ? student.name : 'Student')}</div>
          <div class="s">${fmtTime(rec.checkedInAt)} · ${rec.distanceM} m from hall</div>
        </div>
        ${statusPill(rec.status)}
      </div>`;
    })
    .join('');

  const html = `<div class="session-hero mb-16">
      <div class="spread">
        <div>
          <div class="label">Attendance window open</div>
          <div class="value" style="font-size:19px;margin-top:2px">${esc(course.code)} · ${esc(course.name)}</div>
          <div class="tiny mt-8" style="color:#8b9ab2">${esc(hall ? hall.name : '')} · ${hangTime(active.startedAt)} – ${fmtTime(active.endsAt)}</div>
        </div>
        <span class="pill pill-live"><span class="dot"></span>Live</span>
      </div>

      <div class="spread mt-16">
        <div>
          <div class="label">Closes in</div>
          <div class="countdown" data-countdown>--:--</div>
        </div>
        <div class="row">
          <span class="pill pill-dark mono">${esc(bleNameFor(course, course.day))}</span>
          <button class="btn btn-soft btn-sm" data-action="refresh">${icon('refresh', 13)} Refresh</button>
        </div>
      </div>
      <div class="progress green mt-12" style="background:rgba(255,255,255,.12)"><i data-countdown-bar style="width:100%"></i></div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('check', 14)} Present</div><div class="kpi-value">${present}</div><div class="kpi-foot">On time</div></div>
      <div class="kpi"><div class="kpi-label">${icon('clock', 14)} Late</div><div class="kpi-value">${late}</div><div class="kpi-foot">After 5 minutes</div></div>
      <div class="kpi"><div class="kpi-label">${icon('x', 14)} Not posted</div><div class="kpi-value">${absent}</div><div class="kpi-foot">On register, still waiting</div></div>
      <div class="kpi"><div class="kpi-label">${icon('trending', 14)} Attendance rate</div><div class="kpi-value">${Math.round(rate)}<small>%</small></div><div class="kpi-foot">${records.length} of ${students.length} students</div></div>
    </div>

    <div class="split">
      <div class="card">
        <div class="card-head">
          <div class="card-title">${icon('users', 16)} Live feed</div>
          <span class="pill pill-live"><span class="dot"></span>${records.length} posted</span>
        </div>
        <div class="card-body">
          ${latest || '<div class="empty"><div class="ic">' + icon('bluetooth', 20) + '</div>Waiting for the first student to post.</div>'}
        </div>
        <div class="card-foot">
          <span class="muted tiny">Names appear the moment a student confirms.</span>
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-title mb-8">${icon('shield', 16)} This window</div>
        <div class="stat-row"><span class="k">Opened</span><span class="v">${fmtTime(active.startedAt)}</span></div>
        <div class="stat-row"><span class="k">Closes</span><span class="v">${fmtTime(active.endsAt)}</span></div>
        <div class="stat-row"><span class="k">Window</span><span class="v">${active.durationMin} minutes</span></div>
        <div class="stat-row"><span class="k">Fence</span><span class="v">${hall ? hall.radius : 50} m · ${esc(hall ? hall.name : '')}</span></div>
        <div class="stat-row"><span class="k">Register</span><span class="v">${course.studentIds.length} final</span></div>
        <div class="muted tiny mt-12">Closed sessions compile automatically: registered students are kept, outside attempts are filtered into the report.</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div class="card-title">${icon('users', 16)} Final register roster</div>
        <div class="row">
          <input class="input" id="roster-search" placeholder="Search name or reg no" style="width:220px" autocomplete="off">
          <span class="pill pill-brand">${records.length}/${students.length}</span>
        </div>
      </div>
      <div class="table-wrap" style="max-height:480px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>Student</th><th>Status</th><th>Posted</th><th class="num">Distance</th></tr></thead>
          <tbody>${rosterRows}</tbody>
        </table>
      </div>
    </div>`;

  return {
    eyebrow: 'Live attendance',
    title: `${course.code} · ${course.name}`,
    sub: `${hall ? hall.name : 'Lecture hall'} · ${active.durationMin} minute window`,
    actions: `<button class="btn btn-danger btn-sm" data-action="end">${icon('stop', 14)} Close window</button>`,
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
          endSession(viewCtx.db, active.id);
          toast('Window closed', { message: `${course.code} session compiled into the register.`, tone: 'warn' });
          viewCtx.refresh();
        }
      };
      tick();
      timer = setInterval(tick, 1000);

      const refresh = root.querySelector('[data-action="refresh"]');
      if (refresh) refresh.addEventListener('click', () => viewCtx.refresh());

      const end = root.querySelector('[data-action="end"]');
      if (end) {
        end.addEventListener('click', () => {
          modal({
            title: 'Close this attendance window?',
            sub: `${course.code} stops accepting posts.`,
            body: `<div class="muted small">${records.length} of ${students.length} students have posted. Closing compiles the session report: the final register is kept and any outside attempts are filtered out.</div>`,
            footer: `<button class="btn btn-soft" data-modal="cancel">Keep open</button><button class="btn btn-danger" data-modal="confirm">Close window</button>`,
            onMount(wrap, close) {
              wrap.querySelector('[data-modal="cancel"]').addEventListener('click', close);
              wrap.querySelector('[data-modal="confirm"]').addEventListener('click', () => {
                endSession(viewCtx.db, active.id);
                close();
                toast('Window closed', { message: 'Session report compiled.', tone: 'success' });
                viewCtx.refresh();
              });
            }
          });
        });
      }

      const search = root.querySelector('#roster-search');
      if (search) {
        search.addEventListener('input', () => {
          const q = search.value.trim().toLowerCase();
          root.querySelectorAll('[data-row]').forEach((tr) => {
            tr.style.display = !q || tr.dataset.row.includes(q) ? '' : 'none';
          });
        });
      }

      return () => {
        if (timer) clearInterval(timer);
      };
    }
  };
}

function hangTime(iso) {
  return fmtTime(iso).replace(/\s?(am|pm)/i, '');
}

/* ------------------------------------------------------------------ */
/* Course analytics                                                    */
/* ------------------------------------------------------------------ */

export function analytics(ctx) {
  const { db, user } = ctx;
  const courses = coursesForLecturer(db, user.id);
  const selectedId = ctx.params.course || (courses[0] && courses[0].id);
  const a = selectedId ? courseAnalytics(db, selectedId) : null;

  if (!a) {
    return {
      eyebrow: 'Analytics',
      title: 'Course analytics',
      sub: 'No course selected.',
      html: '<div class="empty">No analytics available.</div>'
    };
  }

  const options = courses
    .map((c) => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${esc(c.code)} · ${esc(c.name)}</option>`)
    .join('');

  const distRows = a.distribution
    .map(
      (band) => `<div class="stat-row">
        <span class="k" style="min-width:66px">${esc(band.label)}%</span>
        ${progress(a.enrolled ? (band.count / a.enrolled) * 100 : 0, band.label === '0–49' || band.label === '50–69' ? 'red' : band.label === '70–79' ? 'amber' : 'green')}
        <span class="v" style="min-width:38px;text-align:right">${band.count}</span>
      </div>`
    )
    .join('');

  const riskRows = a.atRisk.length
    ? a.atRisk
        .slice(0, 10)
        .map(
          (r) => `<tr>
            <td><div class="person">${avatar(r.student.name, 'red')}<div><div class="name">${esc(r.student.name)}</div><div class="sub">${esc(r.student.regNo)}</div></div></div></td>
            <td class="num strong">${pctText(r.pct)}</td>
            <td class="num">${r.attended}/${r.total}</td>
            <td class="num">${r.missed}</td>
            <td>${attendancePill(r.pct)}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="5"><div class="empty">No students below 70%. 🎉</div></td></tr>`;

  const absentRows = a.topAbsent
    .map(
      (r, i) => `<div class="rank-item">
        <span class="rank-no">${String(i + 1).padStart(2, '0')}</span>
        ${avatar(r.student.name, r.pct < 70 ? 'red' : 'amber')}
        <div class="m"><div class="t">${esc(r.student.name)}</div><div class="s">${esc(r.student.regNo)} · ${r.missed} missed</div></div>
        <span class="pill ${r.pct < 70 ? 'pill-red' : 'pill-amber'}">${pctText(r.pct)}</span>
      </div>`
    )
    .join('');

  const sessionRows = a.recentSessions
    .map(
      (r) => `<tr>
        <td class="nowrap">${fmtDate(r.session.startedAt)}</td>
        <td class="nowrap">${fmtTime(r.session.startedAt)}</td>
        <td class="num">${r.present}</td>
        <td class="num">${r.late}</td>
        <td class="num">${r.absent}</td>
        <td><span class="pill ${r.rate >= 80 ? 'pill-green' : r.rate >= 70 ? 'pill-amber' : 'pill-red'}">${Math.round(r.rate)}%</span></td>
      </tr>`
    )
    .join('');

  const html = `<div class="card card-pad mb-16">
      <div class="spread">
        <div class="row">
          ${ring(a.avgPct, { size: 66, stroke: 6 })}
          <div>
            <div class="pill pill-brand">${esc(a.course.code)}</div>
            <h2 style="font-size:18px;margin-top:6px">${esc(a.course.name)}</h2>
            <div class="muted small">${a.enrolled} students · ${a.sessionCount} sessions · ${esc(courseSlot(a.course))}</div>
          </div>
        </div>
        <select class="select" id="course-select" style="width:280px">${options}</select>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('chart', 14)} Average attendance</div><div class="kpi-value">${pctText(a.avgPct)}</div><div class="kpi-foot">Across ${a.enrolled} students</div></div>
      <div class="kpi"><div class="kpi-label">${icon('alert', 14)} Below 70%</div><div class="kpi-value">${a.atRisk.length}</div><div class="kpi-foot">${pctText(pctOf(a.atRisk.length, a.enrolled))} of the class</div></div>
      <div class="kpi"><div class="kpi-label">${icon('check', 14)} Above 90%</div><div class="kpi-value">${a.perStudent.filter((s) => s.pct >= 90).length}</div><div class="kpi-foot">Strong attendance</div></div>
      <div class="kpi"><div class="kpi-label">${icon('calendar', 14)} Sessions held</div><div class="kpi-value">${a.sessionCount}</div><div class="kpi-foot">Last ${a.lastSession ? fmtDate(a.lastSession.startedAt) : '—'}</div></div>
    </div>

    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('trending', 16)} Attendance trend</div><span class="card-hint">Average per month</span></div>
          <div class="card-body">${areaChart(a.trend, { label: `${a.course.code} attendance trend` })}</div>
        </div>
        <div class="card">
          <div class="card-head">
            <div class="card-title">${icon('alert', 16)} Students below 70%</div>
            <button class="btn btn-soft btn-sm" id="export-course">${icon('download', 15)} Export</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Student</th><th class="num">Attendance</th><th class="num">Attended</th><th class="num">Missed</th><th>Risk</th></tr></thead>
              <tbody>${riskRows}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('clock', 16)} Recent sessions</div></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Start</th><th class="num">Present</th><th class="num">Late</th><th class="num">Absent</th><th>Rate</th></tr></thead>
              <tbody>${sessionRows || '<tr><td colspan="6"><div class="empty">No sessions yet.</div></td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('users', 16)} Distribution</div></div>
          <div class="card-body">${distRows}</div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('alert', 16)} Top absentees</div><span class="card-hint">Most missed</span></div>
          <div class="card-body">${absentRows || '<div class="empty">No data.</div>'}</div>
        </div>
      </div>
    </div>`;

  return {
    eyebrow: 'Analytics',
    title: 'Student analytics',
    sub: 'All students in the course: totals, eligibility risk, distribution and absentees.',
    actions: `<a class="btn btn-soft btn-sm" href="#/lecturer/classes">${icon('arrow', 15)} Attendance</a>`,
    html,
    mount(root, viewCtx) {
      const select = root.querySelector('#course-select');
      if (select) {
        select.addEventListener('change', () => {
          window.location.hash = `#/lecturer/analytics?course=${select.value}`;
        });
      }
      const exportBtn = root.querySelector('#export-course');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          downloadCSV(
            `attendsmart-${a.course.code}-analytics.csv`,
            ['Reg no', 'Student', 'Attended', 'Total sessions', 'Missed', 'Late', 'Attendance %', 'Risk'],
            a.perStudent.map((s) => [
              s.student.regNo,
              s.student.name,
              s.attended,
              s.total,
              s.missed,
              s.late,
              round1(s.pct),
              s.risk.label
            ])
          );
          toast('Analytics exported', { message: `${a.course.code} student report saved.`, tone: 'success' });
        });
      }
    }
  };
}
