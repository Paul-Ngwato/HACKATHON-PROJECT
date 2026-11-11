/**
 * AttendEase — student portal.
 *
 * Old government-portal layout: dark green header (drawn by the shell), beige
 * page, two boxed steps and a plain grey POST ATTENDANCE button.
 *
 * The scan is a real request to the shared server: it reloads the snapshot and
 * looks for an open window on one of the student's units. A code alone is not
 * enough to post — the server also checks the class fence.
 */

import {
  activeSessionForStudent,
  checkIn,
  courseById,
  coursesForStudent,
  lecturerById,
  lookupSession,
  refreshDB,
  roomFor
} from '../data.js';
import { downloadCSV, esc, fmtDateShort, fmtTime, icon } from '../ui.js';
import { round1 } from '../analytics.js';
import { getFix } from '../location.js';
import { bleFindBeacon, bleSupport } from '../ble.js';

const state = {
  userId: null,
  phase: 'idle', // idle | scanning | done
  code: '',
  receipt: null,
  postedFor: null,
  error: '',
  posting: false
};

function ensureUser(userId) {
  if (state.userId === userId) return;
  Object.assign(state, {
    userId,
    phase: 'idle',
    code: '',
    receipt: null,
    postedFor: null,
    error: '',
    posting: false
  });
}

function time12(hhmm) {
  const parts = String(hhmm || '').split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h)) return String(hhmm || '');
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${suffix}`;
}

function currentFix(timeout = 12000) {
  return getFix({ timeout });
}

function openLecture(db, userId) {
  const list = activeSessionForStudent(db, userId);
  return list.length ? list[0] : null;
}

function unitStats(db, studentId) {
  return coursesForStudent(db, studentId).map((course) => {
    const sessions = db.sessions.filter((s) => s.courseId === course.id);
    const records = db.attendance.filter((a) => a.courseId === course.id && a.studentId === studentId);
    const bySession = new Map(records.map((r) => [r.sessionId, r]));
    const lecturer = lecturerById(db, course.lecturerId);
    const lastSession = sessions
      .slice()
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    const lastRecord =
      (lastSession && bySession.get(lastSession.id)) ||
      records.slice().sort((a, b) => String(b.checkedInAt).localeCompare(String(a.checkedInAt)))[0] ||
      null;
    const held = sessions.length;
    const attended = records.length;
    return {
      course,
      lecturer,
      held,
      attended,
      pct: held ? (attended / held) * 100 : 0,
      lastDate: lastRecord ? lastRecord.checkedInAt : lastSession ? lastSession.startedAt : null,
      lastStatus: lastRecord ? (lastRecord.status === 'late' ? 'Late' : 'Present') : held ? 'Absent' : '—'
    };
  });
}

function pctCell(value) {
  return `<td class="gov-bar-cell"><b>${round1(value)}%</b><div class="gov-minibar"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div></td>`;
}

/* ------------------------------------------------------------------ */
/* Take Attendance                                                     */
/* ------------------------------------------------------------------ */

function scanningBox() {
  return `<div class="gov-box">
    <div class="gov-box-title">Step 1 - Scan for the Class</div>
    <div class="gov-box-body">
      <p class="gov-center gov-muted">Scanning for nearby lectures... Please wait.</p>
      <div class="gov-radar">${icon('bluetooth', 30)}</div>
      <div class="gov-center gov-status" id="scan-status">Scanning...</div>
      <div class="gov-progress"><i id="scan-bar" style="width:6%"></i></div>
      <div class="gov-center gov-small gov-muted" id="scan-pct">6%</div>
      <div class="gov-actions" style="justify-content: center; margin-top: 10px">
        <button class="gov-btn" id="scan-wifi">SCAN WI-FI</button>
        <button class="gov-btn" id="scan-bt">SCAN BLUETOOTH</button>
      </div>
      <p class="gov-center gov-small gov-muted" id="scan-note">
        Pick the lane to the lecturer's register. Wi-Fi is faster and carries the
        whole class at once; Bluetooth works when the campus network isolates
        phones from each other.
      </p>
      ${
        bleSupport() !== 'none'
          ? `<div class="gov-center" style="margin-top:10px">
               <button class="gov-btn" id="ble-scan">CHECK CLASS BEACON</button>
             </div>
             <p class="gov-center gov-small gov-muted" id="ble-note">${
               bleSupport() === 'native'
                 ? 'Beacon scanning is ready on this phone.'
                 : 'Beacon scanning will ask which device to use.'
             }</p>`
          : `<p class="gov-center gov-small gov-muted" id="ble-note">Beacon scanning is not available in this browser.</p>`
      }
    </div>
  </div>`;
}

/** The record this student already has for this unit today, if any. */
function postedToday(ctx, session) {
  const record = ctx.db.attendance.find(
    (a) =>
      a.courseId === session.courseId &&
      a.studentId === ctx.user.id &&
      String(a.checkedInAt).slice(0, 10) === new Date().toISOString().slice(0, 10)
  );
  return record || null;
}

function foundBox(ctx, session) {
  const course = courseById(ctx.db, session.courseId);
  const lecturer = course ? lecturerById(ctx.db, course.lecturerId) : null;
  const room = course ? roomFor(ctx.db, course) : 'Room TBA';
  const done = !!(state.receipt && state.receipt.ok);
  // The receipt carries the unit the server actually recorded, which is right
  // even when the scanned lecture and the entered code are different classes.
  const posted = done ? state.receipt.course || course : null;
  const already = done ? null : postedToday(ctx, session);

  if (done) {
    const receipt = state.receipt;
    return `<div class="gov-box">
      <div class="gov-box-title">Step 2 - Lecture Found</div>
      <div class="gov-box-body">
        <p class="gov-lead">${esc(posted ? posted.name : 'Lecture')} — ${esc(posted ? posted.code : '')}</p>
        <div class="gov-ok">
          Attendance posted successfully for ${esc(posted ? posted.name : 'this lecture')} - ${esc(
            posted ? posted.code : ''
          )}
          ${receipt.record && receipt.record.distanceM != null ? ` · ${receipt.record.distanceM} m from the class` : ''}
          ${receipt.record ? ` · ${esc(receipt.record.status === 'late' ? 'marked late' : 'marked present')}` : ''}
        </div>
        <p class="gov-small gov-muted">Posted at ${fmtTime(receipt.record ? receipt.record.checkedInAt : new Date().toISOString())}. This record is final — it cannot be moved to another student.</p>
        <div class="gov-actions"><button class="gov-btn" data-action="rescan">SCAN AGAIN</button></div>
      </div>
    </div>`;
  }

  if (already) {
    return `<div class="gov-box">
      <div class="gov-box-title">Step 2 - Lecture Found</div>
      <div class="gov-box-body">
        <p class="gov-lead">${esc(course ? course.name : 'Lecture')} — ${esc(course ? course.code : '')}</p>
        <div class="gov-ok">Attendance for this class was already posted today at ${fmtTime(
          already.checkedInAt
        )}. It cannot be posted twice.</div>
        <p class="gov-small gov-muted">A class is recorded once per student, so there is nothing left to do here.</p>
        <div class="gov-actions"><button class="gov-btn" data-action="rescan">SCAN AGAIN</button></div>
      </div>
    </div>`;
  }

  return `<div class="gov-box">
    <div class="gov-box-title">Step 2 - Lecture Found</div>
    <div class="gov-box-body">
      <p class="gov-lead">${esc(course ? course.name : 'Lecture')} — ${esc(course ? course.code : '')}</p>
      <p class="gov-meta-line">Room: ${esc(room)} | Time: ${esc(
        course ? time12(course.start) : fmtTime(session.startedAt)
      )} | Lecturer: ${
        esc(lecturer ? lecturer.name : 'Lecturer')
      }</p>
      ${
        state.ble && state.ble.ok
          ? `<p class="gov-small" style="color: var(--gov-green); font-weight: 700; margin: 6px 0">Bluetooth: confirmed ${esc(
              state.ble.name
            )}</p>`
          : ''
      }
      ${state.error ? `<div class="gov-error">${esc(state.error)}</div>` : ''}
      <div class="gov-inline">
        <label for="code-input">Enter Code:</label>
        <input class="gov-input gov-code" id="code-input" inputmode="numeric" maxlength="4" autocomplete="off"
          value="${esc(state.code)}" aria-label="Four digit attendance code">
        <button class="gov-btn" id="post-attendance" ${state.posting ? 'disabled' : ''}>${
          state.posting ? 'POSTING...' : 'POST ATTENDANCE'
        }</button>
      </div>
      <div class="gov-actions">
        <button class="gov-btn" data-action="rescan">SCAN AGAIN</button>
      </div>
      <p class="gov-small gov-muted" style="margin-top:10px">Status: Connected · window closes ${fmtTime(
        session.endsAt
      )} · you must be inside the ${session.radius || 30} m class fence.</p>
    </div>
  </div>`;
}

function nothingBox() {
  return `<div class="gov-box">
    <div class="gov-box-title">Step 2 - No Lecture Found</div>
    <div class="gov-box-body">
      <p class="gov-muted">No attendance window is open for your units right now. Ask your lecturer to press START, then scan again.</p>
      <div class="gov-actions"><button class="gov-btn" data-action="rescan">SCAN AGAIN</button></div>
    </div>
  </div>`;
}

export function checkin(ctx) {
  ensureUser(ctx.user.id);
  const session = openLecture(ctx.db, ctx.user.id);
  const scanned = state.phase === 'done';

  const html = `${scanned ? '' : scanningBox()}
    ${scanned ? (session ? foundBox(ctx, session) : nothingBox()) : ''}
    ${
      scanned
        ? ''
        : '<p class="gov-small gov-muted gov-center">Finding your open lecture on the class server…</p>'
    }`;

  return {
    html,
    mount(root) {
      if (state.phase !== 'done') {
        startScan(ctx, root);
        const bleButton = root.querySelector('#ble-scan');
        if (bleButton) bleButton.addEventListener('click', () => bleScan(root, ctx));
        const wifiButton = root.querySelector('#scan-wifi');
        if (wifiButton) wifiButton.addEventListener('click', () => laneScan(root, ctx, 'wifi'));
        const btButton = root.querySelector('#scan-bt');
        if (btButton) btButton.addEventListener('click', () => laneScan(root, ctx, 'bluetooth'));
        return;
      }
      wire(root, ctx, session);
    }
  };
}

let scanTimer = null;
let scanDeadline = 0;

function startScan(ctx, root) {
  if (state.phase === 'idle') {
    state.phase = 'scanning';
    scanDeadline = Date.now() + 1300;

    const bar = root.querySelector('#scan-bar');
    const pct = root.querySelector('#scan-pct');
    let value = 6;
    const ticker = setInterval(() => {
      value = Math.min(96, value + 8);
      if (!bar || !bar.isConnected) {
        clearInterval(ticker);
        return;
      }
      bar.style.width = `${value}%`;
      if (pct) pct.textContent = `${value}%`;
    }, 110);
  }

  if (state.phase !== 'scanning') return;

  // A live update can re-render the page in the middle of a scan, which used to
  // strand the view on Step 1 forever. Keep exactly one completion timer.
  if (scanTimer) clearTimeout(scanTimer);
  const remaining = Math.max(0, scanDeadline - Date.now());
  scanTimer = setTimeout(() => finishScan(ctx, root), remaining);
}

async function finishScan(ctx, root) {
  scanTimer = null;
  const status = root.querySelector('#scan-status');
  if (status) status.textContent = 'Connected';
  try {
    await refreshDB();
  } catch (err) {
    /* keep the last snapshot; posting will report the real error */
  }
  state.phase = 'done';
  ctx.refresh();
}

/* A real BLE scan: the native plugin inside the APK, Web Bluetooth in Chrome.
   Matching the session's beacon name (DBM411_MONDAY_CLASS) confirms the phone
   is next to the class, and the post is recorded with method "ble". */
function expectedBeacons(ctx) {
  const mine = new Set(coursesForStudent(ctx.db, ctx.user.id).map((c) => c.id));
  return ctx.db.sessions
    .filter((s) => s.status === 'active' && mine.has(s.courseId))
    .map((s) => s.bleName)
    .filter(Boolean);
}

async function bleScan(root, ctx) {
  const note = root.querySelector('#ble-note');
  const say = (text) => {
    if (note && note.isConnected) note.textContent = text;
  };

  say('Scanning for the class beacon…');
  const result = await bleFindBeacon(expectedBeacons(ctx), { timeout: 7000 });
  state.ble = result;

  if (result.ok) {
    say(
      `Bluetooth confirmed: ${result.name}${
        result.rssi != null ? ` (${result.rssi} dBm)` : ''
      }. Enter the four-digit code to post.`
    );
  } else {
    say(result.message);
  }
}

/**
 * Search one transport because the student asked for it. The boot scan tries
 * Wi-Fi and only then Bluetooth, so on a network that isolates clients the
 * student waited out both before being told anything.
 */
async function laneScan(root, ctx, lane) {
  const note = root.querySelector('#scan-note');
  const say = (text) => {
    if (note && note.isConnected) note.textContent = text;
  };

  say(lane === 'wifi'
    ? 'Searching the class Wi-Fi…'
    : 'Searching Bluetooth… this can take a few seconds while the phones pair.');

  const { scanLane } = await import('../host.js');
  const result = await scanLane(lane);

  if (result && result.found) {
    say(`Found ${result.name || 'the class register'} over ${
      result.via === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi'
    }. Loading your lecture…`);
    state.phase = 'idle';
    scanDeadline = Date.now();
    await finishScan(ctx, root);
    return;
  }

  say(
    result && result.error
      ? result.error
      : lane === 'bluetooth'
        ? 'No lecturer phone answered over Bluetooth. Ask the lecturer to open AttendEase and tap "Make this phone findable", then search again.'
        : 'No lecturer phone answered on the Wi-Fi. If this network isolates phones, use SCAN BLUETOOTH.'
  );
}

function wire(root, ctx, session) {
  const rescan = root.querySelector('[data-action="rescan"]');
  if (rescan) {
    rescan.addEventListener('click', () => {
      state.phase = 'idle';
      state.error = '';
      state.receipt = null;
      state.postedFor = null;
      state.code = '';
      ctx.refresh();
    });
  }

  const input = root.querySelector('#code-input');
  if (input) {
    input.addEventListener('input', () => {
      const clean = input.value.replace(/\D/g, '').slice(0, 4);
      input.value = clean;
      state.code = clean;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') post(ctx, session);
    });
  }

  const button = root.querySelector('#post-attendance');
  if (button) button.addEventListener('click', () => post(ctx, session));
}

async function post(ctx, session) {
  if (state.posting) return;
  const code = String(state.code || '').replace(/\D/g, '').slice(0, 4);
  if (code.length !== 4) {
    state.error = 'Enter all four digits shown on the lecturer’s screen.';
    ctx.refresh();
    return;
  }

  const button = document.querySelector('#post-attendance');
  state.posting = true;
  state.error = '';
  if (button) {
    button.disabled = true;
    button.textContent = 'POSTING...';
  }

  try {
    const lookup = await lookupSession(code, ctx.user.id);
    if (!lookup || !lookup.ok) {
      throw new Error((lookup && lookup.message) || 'That code is not open right now.');
    }
    if (!lookup.enrolled) {
      throw new Error(`You are not on the class list for ${lookup.course ? lookup.course.code : 'this unit'}.`);
    }
    const fix = await currentFix();
    const result = await checkIn(ctx.db, {
      code,
      studentId: ctx.user.id,
      deviceId: ctx.deviceId,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      method: state.ble && state.ble.ok ? 'ble' : 'code'
    });
    if (!result.ok) throw new Error(result.message || 'Attendance was not posted.');
    state.receipt = result;
    state.postedFor = session ? session.id : null;
    // The server no longer returns the whole snapshot with a check-in (a
    // class posting together would serialise it once per student), so pull
    // the fresh register in the background for My Attendance.
    refreshDB().catch(() => {});
  } catch (err) {
    state.error = err.message || 'Attendance was not posted.';
  }

  state.posting = false;
  ctx.refresh();
}

/* ------------------------------------------------------------------ */
/* My Attendance                                                       */
/* ------------------------------------------------------------------ */

export function history(ctx) {
  const rows = unitStats(ctx.db, ctx.user.id);
  const totalAttended = rows.reduce((sum, r) => sum + r.attended, 0);
  const totalHeld = rows.reduce((sum, r) => sum + r.held, 0);
  const overall = totalHeld ? (totalAttended / totalHeld) * 100 : 0;

  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <td><b>${esc(r.course.name)}</b><div class="gov-small gov-muted">${esc(r.course.code)}</div></td>
            <td>${r.lastDate ? fmtDateShort(r.lastDate) : '—'}</td>
            <td>${esc(r.lastStatus)}</td>
            ${pctCell(r.pct)}
          </tr>`
        )
        .join('')
    : `<tr><td colspan="4">You are not enrolled on any unit yet.</td></tr>`;

  return {
    html: `<div class="gov-box">
      <div class="gov-box-title">My Attendance</div>
      <div class="gov-box-body">
        <table class="gov-table">
          <thead><tr><th>Unit</th><th>Date</th><th>Status</th><th>Percentage</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
        <div class="gov-summary">Total Present: ${totalAttended} / ${totalHeld} | Overall: ${round1(overall)}%</div>
      </div>
    </div>`
  };
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export function reports(ctx) {
  const rows = unitStats(ctx.db, ctx.user.id);
  const totalAttended = rows.reduce((sum, r) => sum + r.attended, 0);
  const totalHeld = rows.reduce((sum, r) => sum + r.held, 0);
  const overall = totalHeld ? (totalAttended / totalHeld) * 100 : 0;

  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <td>${esc(r.course.code)}</td>
            <td>${esc(r.course.name)}</td>
            <td>${r.held}</td>
            <td>${r.attended}</td>
            <td>${Math.max(0, r.held - r.attended)}</td>
            ${pctCell(r.pct)}
          </tr>`
        )
        .join('')
    : `<tr><td colspan="6">Nothing to report yet.</td></tr>`;

  return {
    html: `<div class="gov-box">
      <div class="gov-box-title">Reports</div>
      <div class="gov-box-body">
        <table class="gov-table">
          <thead><tr><th>Code</th><th>Unit</th><th>Lectures</th><th>Present</th><th>Absent</th><th>Percentage</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
        <div class="gov-summary">Total Present: ${totalAttended} / ${totalHeld} | Overall: ${round1(overall)}%</div>
        <div class="gov-actions"><button class="gov-btn" data-action="download">DOWNLOAD REPORT</button></div>
      </div>
    </div>`,
    mount(root) {
      const button = root.querySelector('[data-action="download"]');
      if (!button) return;
      button.addEventListener('click', () => {
        downloadCSV(
          'AttendEase-my-attendance.csv',
          ['Course code', 'Unit', 'Lectures held', 'Present', 'Absent', 'Percentage'],
          rows.map((r) => [r.course.code, r.course.name, r.held, r.attended, Math.max(0, r.held - r.attended), round1(r.pct)])
        );
      });
    }
  };
}
