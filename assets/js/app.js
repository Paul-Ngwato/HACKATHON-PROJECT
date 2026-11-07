/**
 * AttendSmart AI — app shell, role routing and cross-tab sync.
 *
 * The signed-in user lives in sessionStorage so two tabs can run different
 * roles (lecturer + student) while the attendance database in localStorage is
 * shared. Writing a check-in fires a storage event in the other tab, which
 * re-renders that tab and makes the live roster update.
 */

import {
  STORAGE_KEY,
  getDB,
  reloadDB,
  findUser,
  storedUserId,
  storeUser,
  clearUser,
  getDeviceId,
  rememberStudent,
  rememberedStudent,
  forgetStudent
} from './data.js';
import { icon, avatar, esc, toast } from './ui.js';
import * as Login from './views/login.js';
import * as Student from './views/student.js';
import * as Lecturer from './views/lecturer.js';
import * as Admin from './views/admin.js';

// student.html / lecturer.html set data-app on <body>. The root index.html keeps
// the full demo with a role picker.
const APP_ROLE = document.body.dataset.app || 'all';

const ROUTES = {
  'student/overview': Student.overview,
  'student/checkin': Student.checkin,
  'student/history': Student.history,
  'lecturer/classes': Lecturer.overview,
  'lecturer/setup': Lecturer.setup,
  'lecturer/session': Lecturer.session,
  'lecturer/analytics': Lecturer.analytics,
  'admin/overview': Admin.overview,
  'admin/risk': Admin.risk,
  'admin/courses': Admin.courses
};

const NAV = {
  student: [
    { key: 'student/overview', label: 'Overview', icon: 'grid' },
    { key: 'student/checkin', label: 'Check in', icon: 'bluetooth' },
    { key: 'student/history', label: 'History', icon: 'clock' }
  ],
  lecturer: [
    { key: 'lecturer/classes', label: 'Attendance', icon: 'play' },
    { key: 'lecturer/setup', label: 'Register course', icon: 'users' }
  ],
  admin: [
    { key: 'admin/overview', label: 'University', icon: 'grid' },
    { key: 'admin/risk', label: 'Risk students', icon: 'alert' },
    { key: 'admin/courses', label: 'Courses', icon: 'book' }
  ]
};

const ROLE_LABEL = { student: 'Student', lecturer: 'Lecturer', admin: 'Administrator' };
const HOME = { student: 'overview', lecturer: 'classes', admin: 'overview' };

const app = document.getElementById('app');
let activeView = null;

// Inside the Android wrapper every asset ships in the APK, and an installed PWA
// runs standalone — both cases hide the Install button.
const NATIVE_APP = !!(
  window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === 'function' &&
  window.Capacitor.isNativePlatform()
);
const INSTALLED =
  NATIVE_APP ||
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;
let installPrompt = null;

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [role = '', page = ''] = (path || '').split('/');
  return { role, page, params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function cleanup() {
  if (activeView && typeof activeView.destroy === 'function') {
    try {
      activeView.destroy();
    } catch (err) {
      console.warn('[AttendSmart] view cleanup failed', err);
    }
  }
  activeView = null;
}

function shell(auth, navKey, view) {
  const user = auth.user;
  const sub = auth.role === 'student' ? user.regNo : auth.role === 'lecturer' ? user.department : user.title;
  const avatarTone = auth.role === 'student' ? 'violet' : auth.role === 'lecturer' ? 'green' : '';

  return `<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/${auth.role}/${HOME[auth.role]}" style="text-decoration:none">
        <span class="brand-mark">${icon('shield', 20)}</span>
        <span>
          <span class="brand-name">AttendSmart <span>AI</span></span><br>
          <span class="brand-sub">Baraton University</span>
        </span>
      </a>
      <span class="role-chip"><span class="dot"></span>${ROLE_LABEL[auth.role]}</span>
      <nav class="nav" aria-label="Main navigation">
        <div class="nav-label">Menu</div>
        ${NAV[auth.role]
          .map(
            (item) =>
              `<a class="nav-item${item.key === navKey ? ' active' : ''}" href="#/${item.key}">${icon(item.icon)}<span>${item.label}</span></a>`
          )
          .join('')}
      </nav>
      <div class="sidebar-foot">
        <div class="row" style="gap:6px;margin-bottom:10px">
          <span class="pill" id="net-state" title="Attendance runs on Bluetooth + this device's database.">
            <span class="dot"></span><span id="net-label">Online</span>
          </span>
        </div>
        <button class="ghost-btn" data-action="install" style="display:none" title="Add AttendSmart to this device's home screen">${icon('download', 15)} Install app</button>
        <div class="sidebar-user">
          ${avatar(user.name, avatarTone)}
          <span class="meta">
            <span class="name">${esc(user.name)}</span>
            <span class="sub">${esc(sub || '')}</span>
          </span>
        </div>
        <button class="ghost-btn" data-action="signout">${icon('logout', 15)} Sign out</button>
      </div>
    </aside>
    <div class="main">
      <main class="page">
        <div class="page-head">
          <div>
            ${view.eyebrow ? `<div class="page-eyebrow">${esc(view.eyebrow)}</div>` : ''}
            <h1 class="page-title">${esc(view.title || '')}</h1>
            ${view.sub ? `<p class="page-sub">${esc(view.sub)}</p>` : ''}
          </div>
          <div class="page-actions">${view.actions || ''}</div>
        </div>
        <div class="page-content">${view.html || ''}</div>
      </main>
    </div>
  </div>`;
}

function errorScreen(err) {
  return {
    eyebrow: 'Error',
    title: 'Something went wrong',
    sub: 'The page could not be rendered.',
    html: `<div class="card card-pad">
      <div class="alert alert-red">
        <span class="alert-icon">${icon('alert', 16)}</span>
        <div>
          <div class="alert-title">Unexpected error</div>
          <div class="alert-body">${esc(err && err.message ? err.message : String(err))}</div>
        </div>
      </div>
      <button class="btn btn-soft mt-16" onclick="location.reload()">${icon('refresh', 15)} Reload</button>
    </div>`
  };
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function renderAuth(db) {
  cleanup();
  const login = Login.view({
    db,
    lockRole: APP_ROLE === 'all' ? null : APP_ROLE,
    signIn(id) {
      const auth = findUser(db, id);
      if (!auth) return;
      storeUser(id);
      if (auth.role === 'student') rememberStudent(id);
      const target = `#/${auth.role}/${HOME[auth.role]}`;
      if (location.hash === target) render();
      else location.hash = target;
    }
  });
  app.innerHTML = login.html;
  if (login.mount) login.mount(app);
}

function render() {
  let db;
  let auth;
  try {
    db = getDB();
    let id = storedUserId();

    // Student app: the one-time sign-in is remembered on this device.
    if (APP_ROLE === 'student') {
      const remembered = rememberedStudent();
      const rememberedAuth = remembered ? findUser(db, remembered) : null;
      if (rememberedAuth && rememberedAuth.role === 'student') {
        storeUser(remembered);
        id = remembered;
      }
    }

    auth = id ? findUser(db, id) : null;
  } catch (err) {
    console.error('[AttendSmart] could not load state', err);
    app.innerHTML = shell(
      { role: 'admin', user: findUser(getDB(), 'a1') ? getDB().admin : { name: 'Demo' } },
      'admin/overview',
      errorScreen(err)
    );
    return;
  }

  if (!auth) {
    renderAuth(db);
    return;
  }

  // A standalone app only ever renders its own role.
  if (APP_ROLE !== 'all' && auth.role !== APP_ROLE) {
    clearUser();
    renderAuth(db);
    return;
  }

  const route = parseHash();
  const home = HOME[auth.role];
  if (route.role !== auth.role) {
    const target = `#/${auth.role}/${home}`;
    if (location.hash !== target) {
      location.hash = target;
      return;
    }
  }

  const pageKey = `${auth.role}/${route.page || home}`;
  const viewFn = ROUTES[pageKey] || ROUTES[`${auth.role}/${home}`];
  const navKey = pageKey === 'lecturer/session' || pageKey === 'lecturer/analytics' ? 'lecturer/classes' : pageKey;

  const ctx = {
    db,
    user: auth.user,
    role: auth.role,
    params: route.params,
    deviceId: getDeviceId(),
    refresh: render,
    toast
  };

  cleanup();
  let view;
  try {
    view = viewFn(ctx) || {};
  } catch (err) {
    console.error('[AttendSmart] view failed', err);
    view = errorScreen(err);
  }

  activeView = view;
  app.innerHTML = shell(auth, navKey, view);
  paintNetwork();
  paintInstall();

  if (typeof view.mount === 'function') {
    const page = app.querySelector('.page') || app;
    try {
      const teardown = view.mount(page, ctx);
      if (typeof teardown === 'function') {
        const previousDestroy = view.destroy;
        view.destroy = () => {
          if (previousDestroy) previousDestroy();
          teardown();
        };
      }
    } catch (err) {
      console.error('[AttendSmart] mount failed', err);
      toast('Interface error', { message: err.message, tone: 'error' });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

function paintNetwork() {
  const state = document.getElementById('net-state');
  const label = document.getElementById('net-label');
  if (!state || !label) return;
  const online = navigator.onLine;
  label.textContent = online ? 'Online' : 'Offline · local DB';
  state.className = online ? 'pill' : 'pill pill-amber';
  state.title = online
    ? "Attendance runs on Bluetooth + this device's database."
    : 'No connection. Attendance still works; register sync waits for Wi-Fi.';
}

/* ------------------------------------------------------------------ */
/* Events + boot                                                       */
/* ------------------------------------------------------------------ */

app.addEventListener('click', (e) => {
  const install = e.target.closest('[data-action="install"]');
  if (install) {
    promptInstall();
    return;
  }

  const btn = e.target.closest('[data-action="signout"]');
  if (!btn) return;
  cleanup();
  clearUser();
  forgetStudent();
  if (location.hash === '#/' || location.hash === '') render();
  else location.hash = '#/';
});

window.addEventListener('hashchange', render);
window.addEventListener('online', paintNetwork);
window.addEventListener('offline', paintNetwork);

// Attendance written in another tab (student check-in, lecturer end session)
// arrives here and re-renders the current view.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  reloadDB();
  render();
});

window.addEventListener('error', (e) => {
  console.error('[AttendSmart] uncaught', e.error || e.message);
});

// Offline shell: after the first visit both apps open with no connection. The
// Android build already bundles every asset, so it skips the worker entirely.
if ('serviceWorker' in navigator && !NATIVE_APP) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch((err) => {
      console.warn('[AttendSmart] offline cache unavailable', err);
    });
  });
}

render();

/* ------------------------------------------------------------------ */
/* Installable app                                                     */
/* ------------------------------------------------------------------ */

function paintInstall() {
  const btn = document.querySelector('[data-action="install"]');
  if (!btn) return;
  btn.style.display = !INSTALLED && installPrompt ? '' : 'none';
}

async function promptInstall() {
  if (!installPrompt) return;
  const deferred = installPrompt;
  installPrompt = null;
  deferred.prompt();
  let accepted = false;
  try {
    const choice = await deferred.userChoice;
    accepted = !!choice && choice.outcome === 'accepted';
  } catch (err) {
    console.warn('[AttendSmart] install prompt failed', err);
  }
  paintInstall();
  if (accepted) {
    toast('Installing AttendSmart', { message: 'Opens full screen and works offline.' });
  }
}

// Chrome/Android fire this once the app meets the install criteria: manifest,
// icons, a service worker and a secure context.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  paintInstall();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  paintInstall();
  toast('App installed', { message: 'AttendSmart is on your home screen.' });
});
