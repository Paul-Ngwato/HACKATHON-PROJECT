/**
 * CLASSPREF3CT — demo sign in.
 *
 * Government-portal styling: green bar, boxed panel, plain grey buttons.
 * No passwords: the seeded accounts are the point of the demo.
 */

import { esc, icon, initials } from '../ui.js';

const ROLES = {
  student: { label: 'Student', icon: 'user', blurb: 'Enter the four-digit code, confirm the class, post once — locked.' },
  lecturer: { label: 'Lecturer', icon: 'book', blurb: 'Publish the register, open a window, watch names arrive.' },
  admin: { label: 'Administrator', icon: 'shield', blurb: 'University-wide trends and the advisor worklist.' }
};

const FOOTER = 'CLASSPREF3CT v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE';

function accountsFor(db, role) {
  if (role === 'student') {
    return [0, 1, 2, 4, 6, 9].map((i) => db.students[i]).filter(Boolean);
  }
  if (role === 'lecturer') return db.lecturers;
  return [db.admin];
}

function subtitleFor(account, role) {
  if (role === 'student') return `${account.regNo} · ${account.program}`;
  return `${account.title} · ${account.department}`;
}

export function view(ctx) {
  const { db } = ctx;
  const lockRole = ctx.lockRole && ROLES[ctx.lockRole] ? ctx.lockRole : null;
  const portal = lockRole ? `${ROLES[lockRole].label.toUpperCase()} PORTAL` : 'ATTENDANCE PORTAL';

  const html = `<div class="gov gov-login">
    <header class="gov-header">
      <div class="gov-header-inner">
        <div class="gov-brand">
          <span class="gov-mark">AE</span>
          <span>CLASSPREF3CT <em>${portal}</em></span>
        </div>
        <div class="gov-user">Demo sign in</div>
      </div>
    </header>
    <div class="gov-bar"></div>
    <div class="gov-login-wrap">
      <div class="gov-box gov-login-box">
        <div class="gov-box-title">${lockRole ? `${ROLES[lockRole].label} Sign In` : 'Choose Your Role'}</div>
        <div class="gov-box-body">
          <p class="gov-small gov-muted">No passwords in demo mode. Pick a seeded account, then continue.</p>

          ${
            lockRole
              ? ''
              : `<div class="role-tabs" role="tablist" aria-label="Role">
                  ${Object.entries(ROLES)
                    .map(
                      ([id, role]) =>
                        `<button class="role-tab${id === 'student' ? ' active' : ''}" data-role="${id}" role="tab" aria-selected="${id === 'student'}">${icon(role.icon, 16)}<span>${role.label}</span></button>`
                    )
                    .join('')}
                </div>`
          }

          <div class="account-list" id="account-list"></div>

          <div class="gov-actions">
            <button class="gov-btn gov-btn-green" id="signin">CONTINUE AS STUDENT</button>
          </div>

          <p class="gov-small gov-muted" style="margin-top:10px">
            Records live in the shared database on the class laptop, so a lecturer and a student on
            different phones see the same session. Start <code>npm start</code> and point both apps
            at its Wi-Fi address.
          </p>
        </div>
      </div>
      <footer class="gov-foot">
        <div>${FOOTER}</div>
      </footer>
    </div>
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
              <span class="gov-av">${esc(initials(a.name))}</span>
              <span class="meta">
                <span class="name">${esc(a.name)}</span>
                <span class="sub">${esc(subtitleFor(a, role))}</span>
              </span>
              <span class="tick">${icon('check', 16)}</span>
            </button>`
          )
          .join('');
        signInBtn.textContent = `CONTINUE AS ${ROLES[role].label.toUpperCase()}`;
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
