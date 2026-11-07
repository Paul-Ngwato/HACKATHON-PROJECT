/**
 * AttendSmart AI — administrator console.
 * University-wide attendance, the advisor risk worklist and course performance.
 */

import { resetDB } from '../data.js';
import { riskRows, universityAnalytics, round1, pctOf } from '../analytics.js';
import {
  icon,
  esc,
  ring,
  progress,
  attendancePill,
  fmtDate,
  fmtDateShort,
  fmtTime,
  toast,
  modal,
  downloadCSV,
  avatar,
  pctText,
  areaChart,
  barChart
} from '../ui.js';

export function overview(ctx) {
  const ua = universityAnalytics(ctx.db);

  const courseRows = ua.courses
    .map(
      (row) => `<tr>
        <td>
          <div class="strong">${esc(row.course.code)}</div>
          <div class="tiny muted">${esc(row.course.name)}</div>
        </td>
        <td class="muted">${esc(row.lecturer ? row.lecturer.name : '—')}</td>
        <td class="num">${row.enrolled}</td>
        <td class="num">${row.sessions}</td>
        <td style="min-width:150px">
          <div class="row">${progress(row.avgPct)}<span class="tiny strong">${Math.round(row.avgPct)}%</span></div>
        </td>
        <td class="num">${row.atRisk ? `<span class="pill pill-red">${row.atRisk}</span>` : '<span class="pill pill-green">0</span>'}</td>
        <td>${row.live ? '<span class="pill pill-live"><span class="dot"></span>Live</span>' : '<span class="pill">Idle</span>'}</td>
      </tr>`
    )
    .join('');

  const recentRows = ua.recentSessions
    .map(
      (r) => `<tr>
        <td class="nowrap">${fmtDate(r.session.startedAt)}</td>
        <td><span class="pill">${esc(r.course ? r.course.code : '—')}</span></td>
        <td class="nowrap">${fmtTime(r.session.startedAt)}</td>
        <td class="num">${r.attended}/${r.enrolled}</td>
        <td><span class="pill ${r.rate >= 80 ? 'pill-green' : r.rate >= 70 ? 'pill-amber' : 'pill-red'}">${Math.round(r.rate)}%</span></td>
        <td>${r.session.status === 'active' ? '<span class="pill pill-live"><span class="dot"></span>Open</span>' : '<span class="pill">Closed</span>'}</td>
      </tr>`
    )
    .join('');

  const html = `<div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('users', 14)} Students</div><div class="kpi-value">${ua.totals.students}</div><div class="kpi-foot">${ua.totals.lecturers} lecturers · ${ua.totals.courses} courses</div></div>
      <div class="kpi"><div class="kpi-label">${icon('chart', 14)} Average attendance</div><div class="kpi-value">${pctText(ua.avgPct)}</div><div class="kpi-foot">Across every course</div></div>
      <div class="kpi"><div class="kpi-label">${icon('alert', 14)} Flagged students</div><div class="kpi-value">${ua.flaggedCount}</div><div class="kpi-foot">Any course below 70%</div></div>
      <div class="kpi"><div class="kpi-label">${icon('calendar', 14)} Sessions recorded</div><div class="kpi-value">${ua.totals.sessions}</div><div class="kpi-foot">${ua.totals.records.toLocaleString('en-GB')} check-ins</div></div>
    </div>

    <div class="split-even mb-16">
      <div class="card">
        <div class="card-head"><div class="card-title">${icon('trending', 16)} University attendance trend</div><span class="card-hint">Monthly average</span></div>
        <div class="card-body">${areaChart(ua.trend, { label: 'University attendance trend', height: 230 })}</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">${icon('calendar', 16)} Attendance by weekday</div></div>
        <div class="card-body">${barChart(ua.weekday, { label: 'Attendance by weekday', height: 230 })}</div>
      </div>
    </div>

    <div class="grid grid-3 mb-16">
      <div class="card card-pad">
        <div class="kpi-label">${icon('star', 14)} Best attended slot</div>
        <div class="kpi-value">${ua.bestSlot ? Math.round(ua.bestSlot.value) + '%' : '—'}</div>
        <div class="kpi-foot">${ua.bestSlot ? esc(ua.bestSlot.label) + ' · ' + ua.bestSlot.sessions + ' sessions' : 'No data'}</div>
      </div>
      <div class="card card-pad">
        <div class="kpi-label">${icon('clock', 14)} Weakest slot</div>
        <div class="kpi-value">${ua.worstSlot ? Math.round(ua.worstSlot.value) + '%' : '—'}</div>
        <div class="kpi-foot">${ua.worstSlot ? esc(ua.worstSlot.label) + ' · ' + ua.worstSlot.sessions + ' sessions' : 'No data'}</div>
      </div>
      <div class="card card-pad">
        <div class="kpi-label">${icon('shield', 14)} Eligibility exposure</div>
        <div class="kpi-value">${pctText(pctOf(ua.flaggedCount, ua.totals.students))}</div>
        <div class="kpi-foot">${ua.flaggedCount} of ${ua.totals.students} students flagged</div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-head">
        <div class="card-title">${icon('book', 16)} Course performance</div>
        <div class="row">
          <button class="btn btn-soft btn-sm" id="export-university">${icon('download', 15)} Export</button>
          <a class="btn btn-soft btn-sm" href="#/admin/risk">${icon('alert', 15)} Risk worklist</a>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Course</th><th>Lecturer</th><th class="num">Students</th><th class="num">Sessions</th><th>Avg attendance</th><th class="num">At risk</th><th>Status</th></tr></thead>
          <tbody>${courseRows}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">${icon('clock', 16)} Recent sessions</div><span class="card-hint">Across the university</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Course</th><th>Start</th><th class="num">Marked</th><th>Rate</th><th>Session</th></tr></thead>
          <tbody>${recentRows || '<tr><td colspan="6"><div class="empty">No sessions recorded.</div></td></tr>'}</tbody>
        </table>
      </div>
      <div class="card-foot">
        <span class="muted tiny">Demo data lives in this browser. Reset it any time.</span>
        <button class="btn btn-danger btn-sm" id="reset-demo">${icon('refresh', 14)} Reset demo data</button>
      </div>
    </div>`;

  return {
    eyebrow: 'Administrator',
    title: 'University overview',
    sub: 'Attendance health across every course, slot and cohort.',
    actions: `<a class="btn btn-soft btn-sm" href="#/admin/risk">${icon('alert', 15)} Risk students</a>`,
    html,
    mount(root, viewCtx) {
      const exportBtn = root.querySelector('#export-university');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          downloadCSV(
            'attendsmart-university-courses.csv',
            ['Course code', 'Course name', 'Department', 'Lecturer', 'Students', 'Sessions', 'Average attendance %', 'At risk'],
            ua.courses.map((r) => [
              r.course.code,
              r.course.name,
              r.course.department,
              r.lecturer ? r.lecturer.name : '',
              r.enrolled,
              r.sessions,
              round1(r.avgPct),
              r.atRisk
            ])
          );
          toast('Export ready', { message: 'Course performance CSV downloaded.', tone: 'success' });
        });
      }

      const reset = root.querySelector('#reset-demo');
      if (reset) {
        reset.addEventListener('click', () => {
          modal({
            title: 'Reset all demo data?',
            sub: 'Attendance records, live sessions and security events will be rebuilt.',
            body: '<div class="alert alert-amber"><span class="alert-icon">' + icon('alert', 16) + '</span><div><div class="alert-title">This cannot be undone</div><div class="alert-body">The seeded semester is regenerated immediately, including the DBM411 risk profiles.</div></div></div>',
            footer: '<button class="btn btn-soft" data-modal="cancel">Cancel</button><button class="btn btn-danger" data-modal="confirm">Reset data</button>',
            onMount(wrap, close) {
              wrap.querySelector('[data-modal="cancel"]').addEventListener('click', close);
              wrap.querySelector('[data-modal="confirm"]').addEventListener('click', () => {
                resetDB();
                close();
                toast('Demo data reset', { message: 'A fresh semester has been generated.', tone: 'success' });
                viewCtx.refresh();
              });
            }
          });
        });
      }
    }
  };
}

export function risk(ctx) {
  const rows = riskRows(ctx.db);
  const distinct = new Set(rows.map((r) => r.student.id)).size;
  const worstCourse = [...rows.reduce((map, r) => {
    map.set(r.course.code, (map.get(r.course.code) || 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1])[0];

  const html = `<div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('alert', 14)} Flagged enrolments</div><div class="kpi-value">${rows.length}</div><div class="kpi-foot">Course-level, below 70%</div></div>
      <div class="kpi"><div class="kpi-label">${icon('users', 14)} Distinct students</div><div class="kpi-value">${distinct}</div><div class="kpi-foot">Need advisor attention</div></div>
      <div class="kpi"><div class="kpi-label">${icon('x', 14)} Highest risk</div><div class="kpi-value">${rows.length ? pctText(rows[0].pct) : '—'}</div><div class="kpi-foot">${rows.length ? esc(rows[0].student.name) : 'No flags'}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('book', 14)} Most affected course</div><div class="kpi-value">${worstCourse ? esc(worstCourse[0]) : '—'}</div><div class="kpi-foot">${worstCourse ? worstCourse[1] + ' flagged students' : '—'}</div></div>
    </div>

    <div class="alert alert-amber mb-16">
      <span class="alert-icon">${icon('info', 16)}</span>
      <div>
        <div class="alert-title">How this list is built</div>
        <div class="alert-body">A student appears once per course when verified attendance falls below 70% of sessions held. Late arrivals count as attended; proxies blocked by the device rule never do.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">${icon('alert', 16)} Advisor worklist</div>
        <div class="row">
          <input class="input" id="risk-search" placeholder="Search student, reg no or course" style="width:250px" autocomplete="off">
          <select class="select" id="risk-filter" style="width:190px">
            <option value="all">All courses</option>
            ${[...new Set(rows.map((r) => r.course.code))].map((code) => `<option value="${esc(code)}">${esc(code)}</option>`).join('')}
          </select>
          <button class="btn btn-soft btn-sm" id="export-risk">${icon('download', 15)} Export</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Student</th><th>Course</th><th class="num">Attendance</th><th class="num">Attended</th><th class="num">Missed</th><th class="num">Late</th><th>Risk</th></tr></thead>
          <tbody id="risk-body">
            ${
              rows.length
                ? rows
                    .map(
                      (r) => `<tr data-row="${esc((r.student.name + ' ' + r.student.regNo).toLowerCase())}" data-course="${esc(r.course.code)}">
                        <td><div class="person">${avatar(r.student.name, 'red')}<div><div class="name">${esc(r.student.name)}</div><div class="sub">${esc(r.student.regNo)}</div></div></div></td>
                        <td><span class="pill">${esc(r.course.code)}</span></td>
                        <td class="num strong">${pctText(r.pct)}</td>
                        <td class="num">${r.attended}/${r.total}</td>
                        <td class="num">${r.missed}</td>
                        <td class="num">${r.late}</td>
                        <td>${attendancePill(r.pct)}</td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="7"><div class="empty">No students below 70%. 🎉</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
      <div class="card-foot">
        <span class="muted tiny" id="risk-count">${rows.length} flagged enrolments</span>
        <span class="muted tiny">Sorted by attendance, lowest first</span>
      </div>
    </div>`;

  return {
    eyebrow: 'Administrator',
    title: 'Risk students',
    sub: 'Every enrolment under the 70% exam-eligibility line, ready for advising.',
    actions: `<a class="btn btn-soft btn-sm" href="#/admin/overview">${icon('grid', 15)} Overview</a>`,
    html,
    mount(root) {
      const search = root.querySelector('#risk-search');
      const filter = root.querySelector('#risk-filter');
      const count = root.querySelector('#risk-count');

      const apply = () => {
        const q = (search.value || '').trim().toLowerCase();
        const course = filter.value;
        let visible = 0;
        root.querySelectorAll('#risk-body [data-row]').forEach((tr) => {
          const ok = (!q || tr.dataset.row.includes(q)) && (course === 'all' || tr.dataset.course === course);
          tr.style.display = ok ? '' : 'none';
          if (ok) visible++;
        });
        count.textContent = `${visible} flagged enrolment${visible === 1 ? '' : 's'} shown`;
      };

      if (search) search.addEventListener('input', apply);
      if (filter) filter.addEventListener('change', apply);

      const exportBtn = root.querySelector('#export-risk');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          downloadCSV(
            'attendsmart-risk-students.csv',
            ['Reg no', 'Student', 'Programme', 'Course', 'Attended', 'Sessions', 'Missed', 'Late', 'Attendance %'],
            rows.map((r) => [
              r.student.regNo,
              r.student.name,
              r.student.program,
              r.course.code,
              r.attended,
              r.total,
              r.missed,
              r.late,
              round1(r.pct)
            ])
          );
          toast('Worklist exported', { message: 'Risk students CSV downloaded.', tone: 'success' });
        });
      }
    }
  };
}

export function courses(ctx) {
  const ua = universityAnalytics(ctx.db);
  const rows = ua.courses
    .slice()
    .sort((a, b) => b.enrolled - a.enrolled)
    .map(
      (r) => `<tr>
        <td><div class="strong">${esc(r.course.code)}</div><div class="tiny muted">${esc(r.course.name)}</div></td>
        <td class="muted">${esc(r.lecturer ? r.lecturer.name : '—')}</td>
        <td class="muted">${esc(r.course.department)}</td>
        <td class="muted nowrap">${esc(r.course.semester || '')}</td>
        <td class="num">${r.enrolled}</td>
        <td class="num">${r.sessions}</td>
        <td style="min-width:160px"><div class="row">${progress(r.avgPct)}<span class="tiny strong">${Math.round(r.avgPct)}%</span></div></td>
        <td>${r.atRisk ? `<span class="pill pill-red">${r.atRisk} at risk</span>` : '<span class="pill pill-green">Healthy</span>'}</td>
      </tr>`
    )
    .join('');

  const html = `<div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('book', 14)} Courses</div><div class="kpi-value">${ua.totals.courses}</div><div class="kpi-foot">${new Set(ua.courses.map((r) => r.course.department)).size} departments</div></div>
      <div class="kpi"><div class="kpi-label">${icon('users', 14)} Enrolments</div><div class="kpi-value">${ua.courses.reduce((s, r) => s + r.enrolled, 0)}</div><div class="kpi-foot">Across all courses</div></div>
      <div class="kpi"><div class="kpi-label">${icon('calendar', 14)} Sessions held</div><div class="kpi-value">${ua.totals.sessions}</div><div class="kpi-foot">Seeded semester</div></div>
      <div class="kpi"><div class="kpi-label">${icon('chart', 14)} Average attendance</div><div class="kpi-value">${pctText(ua.avgPct)}</div><div class="kpi-foot">Weighted by course</div></div>
    </div>

    <div class="card mb-16">
      <div class="card-head">
        <div class="card-title">${icon('book', 16)} Course catalogue</div>
        <button class="btn btn-soft btn-sm" id="export-courses">${icon('download', 15)} Export</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Course</th><th>Lecturer</th><th>Department</th><th>Semester</th><th class="num">Students</th><th class="num">Sessions</th><th>Avg attendance</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div class="split-even">
      <div class="card">
        <div class="card-head"><div class="card-title">${icon('calendar', 16)} Weekday attendance</div></div>
        <div class="card-body">${barChart(ua.weekday, { label: 'Attendance by weekday' })}</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">${icon('clock', 16)} Slot performance</div></div>
        <div class="card-body tight">
          ${ua.slots
            .map(
              (s) => `<div class="stat-row" style="padding:10px 20px">
                <span class="k mono">${esc(s.label)}</span>
                <div class="row grow" style="justify-content:flex-end;gap:10px">
                  ${progress(s.value, s.value < 70 ? 'red' : s.value < 80 ? 'amber' : 'green')}
                  <span class="v" style="min-width:40px;text-align:right">${Math.round(s.value)}%</span>
                </div>
              </div>`
            )
            .join('') || '<div class="empty">No sessions.</div>'}
        </div>
      </div>
    </div>`;

  return {
    eyebrow: 'Administrator',
    title: 'Courses & slots',
    sub: 'Which courses are healthy, and which time slots students skip.',
    actions: `<a class="btn btn-soft btn-sm" href="#/admin/overview">${icon('grid', 15)} Overview</a>`,
    html,
    mount(root) {
      const exportBtn = root.querySelector('#export-courses');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          downloadCSV(
            'attendsmart-course-catalogue.csv',
            ['Course code', 'Course name', 'Department', 'Lecturer', 'Students', 'Sessions', 'Average attendance %', 'At risk'],
            ua.courses.map((r) => [
              r.course.code,
              r.course.name,
              r.course.department,
              r.lecturer ? r.lecturer.name : '',
              r.enrolled,
              r.sessions,
              round1(r.avgPct),
              r.atRisk
            ])
          );
          toast('Catalogue exported', { tone: 'success' });
        });
      }
    }
  };
}
