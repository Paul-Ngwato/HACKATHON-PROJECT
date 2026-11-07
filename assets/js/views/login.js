/**
 * AttendSmart AI — demo sign in.
 * No passwords: the seeded accounts are the point of the demo.
 */

import { icon, esc, avatar } from '../ui.js';

const ROLES = {
  student: { label: 'Student', icon: 'user', blurb: 'Scan nearby, confirm the class, post once — locked.' },
  lecturer: { label: 'Lecturer', icon: 'book', blurb: 'Publish the register, open a window, watch names arrive.' },
  admin: { label: 'Administrator', icon: 'shield', blurb: 'University-wide trends and the advisor worklist.' }
};

function accountsFor(db, role) {
  if (role === 'student') {
    const picks = [0, 1, 2, 4, 6, 9].map((i) => db.students[i]).filter(Boolean);
    return picks;
  }
  if (role === 'lecturer') return db.lecturers;
  return [db.admin];
}

function subtitleFor(account, role) {
  if (role === 'student') return `${account.regNo} · ${account.program}`;
  if (role === 'lecturer') return `${account.title} · ${account.department}`;
  return `${account.title} · ${account.department}`;
}

function toneFor(role) {
  return role === 'student' ? 'violet' : role === 'lecturer' ? 'green' : '';
}

export function view(ctx) {
  const { db } = ctx;
  const lockRole = ctx.lockRole && ROLES[ctx.lockRole] ? ctx.lockRole : null;

  const html = `<div class="auth">
    <section class="auth-hero">
      <div class="hero-eyebrow"><span class="dot"></span>Baraton University · Smart attendance</div>
      <div>
        <h1>Attendance you can <em>prove</em>.</h1>
        <p class="lede">Bluetooth proximity, a tight GPS fence and the final class register — three taps to post, a record nobody can edit, and analytics that flag at-risk students long before exams do.</p>
      </div>
      <div class="verify-chain">
        <div class="vc-item">
          <span class="ic">${icon('bluetooth', 17)}</span>
          <div><div class="t">Bluetooth session broadcast</div><div class="d">DBM411_MONDAY_CLASS · heard in the room</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
        <div class="vc-item">
          <span class="ic">${icon('shield', 17)}</span>
          <div><div class="t">Final register only</div><div class="d">Posted once at semester start · no late additions</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
        <div class="vc-item">
          <span class="ic">${icon('pin', 17)}</span>
          <div><div class="t">GPS inside the hall radius</div><div class="d">Phone GNSS or the GlobalSat BT-821C receiver</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
        <div class="vc-item">
          <span class="ic">${icon('chart', 17)}</span>
          <div><div class="t">Compiled when the window closes</div><div class="d">Registered names kept · outside attempts filtered out</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><div class="v">${db.courses.length}</div><div class="l">Live courses</div></div>
        <div class="hero-stat"><div class="v">${db.students.length}</div><div class="l">Enrolled students</div></div>
        <div class="hero-stat"><div class="v">70%</div><div class="l">Exam eligibility line</div></div>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <div class="eyebrow">Demo sign in</div>
        <h2>${lockRole ? `${ROLES[lockRole].label} sign in` : 'Choose your role'}</h2>
        <p class="sub">${lockRole ? ROLES[lockRole].blurb : 'Seeded with a full semester of attendance history.'}</p>

        ${lockRole
          ? ''
          : `<div class="role-tabs" role="tablist" aria-label="Role">
              ${Object.entries(ROLES)
                .map(
                  ([id, role]) => `<button class="role-tab${id === 'student' ? ' active' : ''}" data-role="${id}" role="tab" aria-selected="${id === 'student'}">
                    ${icon(role.icon, 18)}<span>${role.label}</span>
                  </button>`
                )
                .join('')}
            </div>`}

        <div class="field">
          <label>Demo account</label>
          <div class="account-list" id="account-list"></div>
        </div>

        <button class="btn btn-primary btn-block" id="signin" style="margin-top:14px">
          Continue as student ${icon('arrow', 16)}
        </button>

        <div class="auth-note">
          Demo mode has no passwords. Everything is stored in this browser, so it works offline.
          Open a second tab to run a lecturer and a student side by side — attendance updates cross tabs live.
        </div>
      </div>
    </section>
  </div>`;

  return {
    html,
    mount(root) {
      let role = lockRole || 'student';
      let selectedId = accountsFor(db, role)[0].id;

      const list = root.querySelector('#account-list');
      const signInBtn = root.querySelector('#signin');
      const tabs = [...root.querySelectorAll('.role-tab')];

      function paintAccounts() {
        const accounts = accountsFor(db, role);
        if (!accounts.some((a) => a.id === selectedId)) selectedId = accounts[0].id;
        list.innerHTML = accounts
          .map(
            (a) => `<button class="account-item${a.id === selectedId ? ' selected' : ''}" data-id="${a.id}">
              ${avatar(a.name, toneFor(role))}
              <span class="meta">
                <span class="name">${esc(a.name)}</span>
                <span class="sub">${esc(subtitleFor(a, role))}</span>
              </span>
              <span class="tick">${icon('check', 18)}</span>
            </button>`
          )
          .join('');
        signInBtn.innerHTML = `Continue as ${ROLES[role].label.toLowerCase()} ${icon('arrow', 16)}`;
      }

      function paintTabs() {
        tabs.forEach((t) => {
          const on = t.dataset.role === role;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', String(on));
        });
      }

      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          role = tab.dataset.role;
          selectedId = accountsFor(db, role)[0].id;
          paintTabs();
          paintAccounts();
        });
      });

      list.addEventListener('click', (e) => {
        const item = e.target.closest('.account-item');
        if (!item) return;
        selectedId = item.dataset.id;
        paintAccounts();
      });

      signInBtn.addEventListener('click', () => {
        if (!selectedId) return;
        ctx.signIn(selectedId);
      });

      paintAccounts();
    }
  };
}
