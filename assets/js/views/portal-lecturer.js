/**
 * AttendEase — lecturer dashboard.
 *
 * One page: a "+ Create New Unit" button, then a boxed card per unit with the
 * live code, the class list and START / STOP / DOWNLOAD EXCEL. Creating a unit
 * opens a centred popup on a dimmed page, exactly like the paper spec.
 */

import {
  activeSessionForCourse,
  coursesForLecturer,
  createCourse,
  endSession,
  importRoster,
  lecturerById,
  roomFor,
  startSession
} from '../data.js';
import { downloadCSV, esc, fmtTime, modal, toast } from '../ui.js';
import { round1 } from '../analytics.js';
import { scanForReceiver } from '../gps.js';
import { getFix } from '../location.js';
import { bleFindBeacon } from '../ble.js';

function time12(hhmm) {
  const parts = String(hhmm || '').split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h)) return String(hhmm || '');
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${suffix}`;
}

function currentFix(timeout = 9000) {
  // START still works without a fix: the server falls back to the saved class
  // venue, so a denied permission must never block opening a window.
  return getFix({ timeout }).catch((err) => {
    throw err;
  });
}

/* Bluetooth state is measured, not claimed: the BT-821C feeds the laptop
   bridge, so the dashboard probes it once and labels the card honestly. */
let receiver = { checked: false, connected: false, port: null };

// Result of the phone's own BLE scan for the live class beacon.
let beacon = { checked: false, ok: false, name: null };

function bluetoothLabel(active) {
  if (!active) return 'OFF';
  if (receiver.connected) return `ON — BT-821C${receiver.port ? ` (${receiver.port})` : ''}`;
  if (beacon.checked) return beacon.ok ? `ON — beacon ${beacon.name}` : 'ON — beacon not seen';
  return receiver.checked ? 'ON — phone GPS' : 'ON';
}

function parseTime(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/\./g, '');
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/.exec(value);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (match[3] === 'PM' && hours < 12) hours += 12;
  if (match[3] === 'AM' && hours === 12) hours = 0;
  if (!Number.isFinite(hours) || hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function endOfLesson(start) {
  const [h, m] = start.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + 120);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function parseRoster(text) {
  const entries = [];
  const invalid = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[,;\t]\s*/);
    const name = (parts[0] || '').trim();
    const regNo = (parts[1] || '').trim();
    if (!name || !regNo) {
      invalid.push(line);
      continue;
    }
    entries.push({ name, regNo });
  }
  return { entries, invalid };
}

/* ------------------------------------------------------------------ */
/* Unit cards                                                          */
/* ------------------------------------------------------------------ */

function unitCard(ctx, course) {
  const db = ctx.db;
  const active = activeSessionForCourse(db, course.id);
  const sessions = db.sessions.filter((s) => s.courseId === course.id);
  const roster = course.studentIds.map((sid) => db.students.find((s) => s.id === sid)).filter(Boolean);
  const counted = new Map();
  for (const record of db.attendance) {
    if (record.courseId !== course.id) continue;
    counted.set(record.studentId, (counted.get(record.studentId) || 0) + 1);
  }

  // Who posted for this very session, newest first. `fresh` marks a post from
  // the last two minutes so the lecturer can see the class arriving live.
  const posts = active
    ? db.attendance
        .filter((a) => a.sessionId === active.id)
        .sort((a, b) => String(b.checkedInAt).localeCompare(String(a.checkedInAt)))
        .map((a) => {
          const student = db.students.find((s) => s.id === a.studentId);
          return {
            id: a.studentId,
            name: student ? student.name : 'Student',
            regNo: student ? student.regNo : '',
            at: a.checkedInAt,
            status: a.status,
            fresh: Date.now() - new Date(a.checkedInAt).getTime() < 120000
          };
        })
    : [];
  const fresh = new Set(posts.filter((p) => p.fresh).map((p) => p.id));

  const todayKey = new Date().toISOString().slice(0, 10);
  const todaySession =
    sessions
      .filter((s) => String(s.startedAt).slice(0, 10) === todayKey)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null;
  const shown = active || todaySession;
  const presentToday = shown ? db.attendance.filter((a) => a.sessionId === shown.id).length : 0;
  const lecturer = lecturerById(db, course.lecturerId);

  const rows = roster.length
    ? roster
        .map((student) => {
          const attended = counted.get(student.id) || 0;
          const pct = sessions.length ? (attended / sessions.length) * 100 : 0;
          return `<tr class="${fresh.has(student.id) ? 'is-new' : ''}">
            <td>${esc(student.name)}<div class="gov-small gov-muted">${esc(student.regNo || '')}</div></td>
            <td>${attended} / ${sessions.length}</td>
            <td class="gov-bar-cell"><b>${round1(pct)}%</b><div class="gov-minibar"><i style="width:${Math.max(
            0,
            Math.min(100, pct)
          )}%"></i></div></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="3">No students on this unit yet. Create the unit again with a pasted class list.</td></tr>';

  return `<section class="gov-box">
    <div class="gov-box-title">${esc(course.name)} — ${esc(course.code)}</div>
    <div class="gov-box-body">
      <div class="gov-meta">
        <span>Room: ${esc(course.room || roomFor(db, course))}</span>
        <span>Time: ${esc(time12(course.start))} – ${esc(time12(course.end))}</span>
        <span class="gov-meta-code ${active ? 'is-live' : ''}">Code: ${
          active ? `<b>${esc(active.code)}</b> LIVE` : '---- NOT STARTED'
        }</span>
        <span data-ble="${active ? '1' : ''}">Bluetooth: ${bluetoothLabel(active)}</span>
        <span>Students: ${roster.length}</span>
        <span>Present Today: ${presentToday}</span>
      </div>
      ${
        active
          ? `<div class="gov-posted">
        <div class="gov-posted-head">Posted this session <span>${posts.length} of ${roster.length}</span></div>
        ${
          posts.length
            ? `<ul class="gov-posted-list">${posts
                .slice(0, 6)
                .map(
                  (post) => `<li class="${post.fresh ? 'is-new' : ''}">
                    <span class="nm">${esc(post.name)}</span>
                    <span class="rg">${esc(post.regNo)}</span>
                    <span class="tm">${fmtTime(post.at)}${post.fresh ? ' · <b>NEW</b>' : ''}</span>
                  </li>`
                )
                .join('')}</ul>${
                posts.length > 6
                  ? `<p class="gov-small gov-muted" style="margin:6px 10px 8px">+ ${posts.length - 6} posted earlier</p>`
                  : ''
              }`
            : '<p class="gov-small gov-muted" style="margin:0;padding:8px 10px">Nobody has posted yet. Names appear the moment a student posts.</p>'
        }
      </div>`
          : ''
      }
      <div class="gov-scroll">
        <table class="gov-table">
          <thead><tr><th>Student</th><th>Attendance</th><th>Percentage</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="gov-actions">
        <button class="gov-btn" data-action="start" data-course="${course.id}" ${active ? 'disabled' : ''}>START</button>
        <button class="gov-btn" data-action="stop" data-session="${active ? active.id : ''}" ${
    active ? '' : 'disabled'
  }>STOP</button>
        <button class="gov-btn" data-action="excel" data-course="${course.id}">DOWNLOAD EXCEL</button>
      </div>
      ${
        active
          ? `<p class="gov-small gov-muted" style="margin-top:8px">Window open until ${fmtTime(
              active.endsAt
            )} · ${esc(active.bleName || course.code)} · fence ${active.radius || 30} m${
              lecturer ? ` · ${esc(lecturer.name)}` : ''
            }</p>`
          : ''
      }
    </div>
  </section>`;
}

export function overview(ctx) {
  const courses = coursesForLecturer(ctx.db, ctx.user.id);
  const cards = courses.map((course) => unitCard(ctx, course)).join('');

  return {
    html: `<div class="gov-toolbar">
        <button class="gov-btn gov-btn-green" data-action="new-unit">+ Create New Unit</button>
        <span class="gov-small gov-muted">${courses.length} unit${courses.length === 1 ? '' : 's'} on your timetable</span>
      </div>
      ${
        cards ||
        `<div class="gov-box"><div class="gov-box-title">My Units</div><div class="gov-box-body">
          <p class="gov-muted">No units yet. Press <b>Create New Unit</b>, paste the class list and save.</p>
        </div></div>`
      }`,
    mount(root) {
      if (!receiver.checked) {
        scanForReceiver().then((result) => {
          receiver = {
            checked: true,
            connected: !!(result && result.connected),
            port: (result && result.port) || null
          };
          root.querySelectorAll('[data-ble]').forEach((node) => {
            node.textContent = `Bluetooth: ${bluetoothLabel(node.dataset.ble === '1')}`;
          });
        });
      }

      // The phone's own BLE scan: confirms the class beacon is actually on air
      // instead of merely assuming it, and names it on the card.
      if (!beacon.checked) {
        const names = ctx.db.sessions
          .filter((s) => s.status === 'active' && s.bleName)
          .map((s) => s.bleName);
        bleFindBeacon(names, { timeout: 6000 }).then((result) => {
          beacon = { checked: true, ok: !!result.ok, name: result.ok ? result.name : null };
          document.querySelectorAll('[data-ble]').forEach((node) => {
            node.textContent = `Bluetooth: ${bluetoothLabel(node.dataset.ble === '1')}`;
          });
        });
      }
      root.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'new-unit') openCreateUnit(ctx);
        else if (action === 'start') startUnit(ctx, target.dataset.course, target);
        else if (action === 'stop') stopUnit(ctx, target.dataset.session, target);
        else if (action === 'excel') exportUnit(ctx, target.dataset.course);
      });
    }
  };
}

async function startUnit(ctx, courseId, button) {
  if (!courseId || button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'STARTING...';

  let fix = null;
  try {
    fix = await currentFix();
  } catch (err) {
    fix = null;
  }

  try {
    await startSession(ctx.db, {
      courseId,
      lecturerId: ctx.user.id,
      durationMin: 15,
      location: fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, radius: 50 } : undefined
    });
    toast('Attendance started', { message: 'The four-digit code is live on the unit card.' });
    await ctx.sync();
  } catch (err) {
    toast('Could not start attendance', { message: err.message, tone: 'error' });
    button.disabled = false;
    button.textContent = label;
  }
}

async function stopUnit(ctx, sessionId, button) {
  if (!sessionId) return;
  button.disabled = true;
  try {
    await endSession(ctx.db, sessionId);
    toast('Attendance stopped', { message: 'The window is closed and the register is final.' });
    await ctx.sync();
  } catch (err) {
    toast('Could not stop attendance', { message: err.message, tone: 'error' });
    button.disabled = false;
  }
}

function exportUnit(ctx, courseId) {
  const course = ctx.db.courses.find((c) => c.id === courseId);
  if (!course) return;
  const sessions = ctx.db.sessions.filter((s) => s.courseId === course.id);
  const roster = course.studentIds.map((sid) => ctx.db.students.find((s) => s.id === sid)).filter(Boolean);
  const rows = roster.map((student) => {
    const attended = ctx.db.attendance.filter((a) => a.courseId === course.id && a.studentId === student.id).length;
    const pct = sessions.length ? (attended / sessions.length) * 100 : 0;
    return [student.regNo, student.name, attended, sessions.length, Math.max(0, sessions.length - attended), round1(pct)];
  });
  downloadCSV(
    `${course.code}-attendance.csv`,
    ['Reg No', 'Student', 'Present', 'Lectures held', 'Absent', 'Percentage'],
    rows
  );
}

/* ------------------------------------------------------------------ */
/* Create New Unit popup                                               */
/* ------------------------------------------------------------------ */

function openCreateUnit(ctx) {
  modal({
    title: 'Create New Unit',
    width: 640,
    body: `<div class="gov-form">
      <label class="gov-field"><span>Unit Name:</span>
        <input class="gov-input" id="f-name" placeholder="e.g. Web Development" autocomplete="off"></label>
      <label class="gov-field"><span>Course Code:</span>
        <input class="gov-input" id="f-code" placeholder="e.g. BBIT500" autocomplete="off"></label>
      <label class="gov-field"><span>Room:</span>
        <input class="gov-input" id="f-room" placeholder="e.g. C3" autocomplete="off"></label>
      <label class="gov-field"><span>Time:</span>
        <input class="gov-input" id="f-time" placeholder="e.g. 09:00 AM" autocomplete="off"></label>
      <label class="gov-field"><span>Paste Students:</span>
        <textarea class="gov-input gov-textarea" id="f-students" placeholder="Paul Oduor, S23/001&#10;Jane Doe, S23/002&#10;Mary Njeri, S23/003"></textarea></label>
      <p class="gov-small gov-muted">One student per line as <b>Name, Reg No</b>.</p>
      <div class="gov-error" id="f-error" hidden></div>
      <div class="gov-actions">
        <button class="gov-btn gov-btn-green" id="f-save">SAVE UNIT</button>
        <button class="gov-btn" id="f-cancel">CANCEL</button>
      </div>
    </div>`,
    onMount(wrap, close) {
      const save = wrap.querySelector('#f-save');
      const errorBox = wrap.querySelector('#f-error');

      const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
      };

      wrap.querySelector('#f-cancel').addEventListener('click', close);

      save.addEventListener('click', async () => {
        const name = wrap.querySelector('#f-name').value.trim();
        const code = wrap.querySelector('#f-code').value.trim();
        const room = wrap.querySelector('#f-room').value.trim();
        const start = parseTime(wrap.querySelector('#f-time').value);
        const { entries, invalid } = parseRoster(wrap.querySelector('#f-students').value);

        errorBox.hidden = true;
        if (!name) return showError('Enter the unit name, for example Database Systems.');
        if (!code) return showError('Enter the course code, for example BBIT421.');
        if (!start) return showError('Enter the time like 09:00 AM.');

        const end = endOfLesson(start);
        if (end <= start) return showError('That time is too late in the day. Pick an earlier lesson.');

        save.disabled = true;
        save.textContent = 'SAVING...';
        try {
          const course = await createCourse(ctx.db, {
            name,
            code,
            room,
            start,
            end,
            day: new Date().getDay(),
            lecturerId: ctx.user.id,
            windowMinutes: 15
          });
          if (entries.length) await importRoster(ctx.db, course.id, entries);
          close();
          toast('Unit created', {
            message: `${entries.length} student${entries.length === 1 ? '' : 's'} added${
              invalid.length ? `, ${invalid.length} line(s) skipped (need "Name, Reg No")` : ''
            }.`
          });
          await ctx.sync();
        } catch (err) {
          save.disabled = false;
          save.textContent = 'SAVE UNIT';
          showError(err.message || 'Could not save the unit.');
        }
      });
    }
  });
}
