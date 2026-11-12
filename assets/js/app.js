/**
 * CLASSPREF3CT — app shell, role routing and live sync.
 *
 * The signed-in user still lives in sessionStorage so a lecturer tab and a
 * student tab can run side by side, but the attendance database is shared:
 * every change arrives from the server as a revision event and the current
 * view re-renders against the fresh snapshot.
 */

import {
  getDB,
  initDB,
  refreshDB,
  subscribeToState,
  isNativeApp,
  needsServerSetup,
  serverBase,
  serverLabel,
  setServerBase,
  clearServerBase,
  setActor,
  findUser,
  storedUserId,
  storeUser,
  clearUser,
  getDeviceId,
  rememberStudent,
  rememberedStudent,
  rememberedState,
  setDB,
  forgetStudent
} from './data.js';
import { ensureHost, forgetHost, isLecturerApp, isStudentApp } from './host.js';
import { syncLecturer, pullStudentClasses, mergeCloudClasses } from './cloud.js';
import { icon, avatar, esc, toast } from './ui.js';
import * as Login from './views/login.js';
import * as Admin from './views/admin.js';
import * as PortalStudent from './views/portal-student.js';
import * as PortalLecturer from './views/portal-lecturer.js';

// student.html / lecturer.html set data-app on <body>. The root index.html keeps
// the full demo with a role picker.
const APP_ROLE = document.body.dataset.app || 'all';

// Student and lecturer screens are the old government-portal layout. Admin keeps
// the internal console.
const ROUTES = {
  'student/checkin': PortalStudent.checkin,
  'student/history': PortalStudent.history,
  'student/reports': PortalStudent.reports,
  'lecturer/classes': PortalLecturer.overview,
  'lecturer/create': PortalLecturer.overview,
  'lecturer/setup': PortalLecturer.overview,
  'lecturer/session': PortalLecturer.overview,
  'lecturer/analytics': PortalLecturer.overview,
  'admin/overview': Admin.overview,
  'admin/risk': Admin.risk,
  'admin/courses': Admin.courses
};

const PORTAL_TABS = {
  student: [
    { key: 'student/checkin', label: 'Take Attendance' },
    { key: 'student/history', label: 'My Attendance' },
    { key: 'student/reports', label: 'Reports' }
  ]
};

const PORTAL_NAME = { student: 'STUDENT PORTAL', lecturer: 'LECTURER PORTAL' };
const PORTAL_TRAIL = { student: 'Home » Student Portal', lecturer: 'Home » Lecturer Dashboard' };
const PORTAL_PAGE = {
  'student/checkin': 'Take Attendance',
  'student/history': 'My Attendance',
  'student/reports': 'Reports',
  'lecturer/classes': 'Manage Units'
};

const NAV = {
  student: [
    { key: 'student/checkin', label: 'Scan attendance', icon: 'key' },
    { key: 'student/history', label: 'My attendance', icon: 'clock' }
  ],
  lecturer: [
    { key: 'lecturer/classes', label: 'My units', icon: 'book' },
    { key: 'lecturer/create', label: 'Create unit', icon: 'plus' }
  ],
  admin: [
    { key: 'admin/overview', label: 'University', icon: 'grid' },
    { key: 'admin/risk', label: 'Risk students', icon: 'alert' },
    { key: 'admin/courses', label: 'Courses', icon: 'book' }
  ]
};

const ROLE_LABEL = { student: 'Student', lecturer: 'Lecturer', admin: 'Administrator' };
const HOME = { student: 'checkin', lecturer: 'classes', admin: 'overview' };

const app = document.getElementById('app');
let activeView = null;
let serverOnline = false;
let unsubscribe = null;
let pollTimer = null;
let refreshing = false;

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
      console.warn('[CLASSPREF3CT] view cleanup failed', err);
    }
  }
  activeView = null;
}

function portalShell(auth, navKey, view) {
  const role = auth.role;
  const tabs = PORTAL_TABS[role] || [];
  const page = PORTAL_PAGE[navKey] || 'Dashboard';

  return `<div class="gov">
    <header class="gov-header">
      <div class="gov-header-inner">
        <div class="gov-brand">
          <span class="gov-mark">AE</span>
          <span>CLASSPREF3CT <em>${PORTAL_NAME[role]}</em></span>
        </div>
        <div class="gov-user">Logged in: ${role.toUpperCase()} — ${esc(auth.user.name)}</div>
      </div>
    </header>
    <div class="gov-bar"></div>
    <div class="gov-wrap">
      <div class="gov-crumb">${PORTAL_TRAIL[role]} » ${page}</div>
      ${
        tabs.length > 1
          ? `<nav class="gov-tabs">${tabs
              .map((tab) => `<a class="${tab.key === navKey ? 'active' : ''}" href="#/${tab.key}">${tab.label}</a>`)
              .join('')}</nav>`
          : ''
      }
      <main class="gov-content page">${view.html || ''}</main>
      <footer class="gov-foot">
        <div>CLASSPREF3CT v1.2 | HACKATHON PROJECT | © 2026 | Support: UEAB@attendance.AC.KE</div>
        <div class="gov-foot-tools">
          <button class="gov-link" data-action="server">Server: ${esc(serverLabel())}</button>
          <button class="gov-link" data-action="signout">Switch user</button>
        </div>
      </footer>
    </div>
  </div>`;
}

function shell(auth, navKey, view) {
  if (auth.role === 'student' || auth.role === 'lecturer') {
    return portalShell(auth, navKey, view);
  }

  const user = auth.user;
  const sub = auth.role === 'student' ? user.regNo : auth.role === 'lecturer' ? user.department : user.title;
  const avatarTone = auth.role === 'student' ? 'violet' : auth.role === 'lecturer' ? 'green' : '';

  return `<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/${auth.role}/${HOME[auth.role]}" style="text-decoration:none">
        <span class="brand-mark">${icon('shield', 20)}</span>
        <span>
          <span class="brand-name">CLASSPREF3CT</span><br>
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
          <span class="pill" id="net-state" title="Shared attendance server">
            <span class="dot"></span><span id="net-label">Connecting…</span>
          </span>
        </div>
        <button class="ghost-btn" data-action="install" style="display:none" title="Add CLASSPREF3CT to this device's home screen">${icon('download', 15)} Install app</button>
        <button class="ghost-btn" data-action="server" title="Change the shared server address">${icon('plug', 15)} Server · ${esc(serverLabel())}</button>
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
/* Connect to the shared backend                                       */
/* ------------------------------------------------------------------ */

/**
 * Installed apps have nothing to type: the lecturer's phone runs the register
 * and students find it on the same Wi-Fi. The typed-address screen stays for
 * the browser demo, where a person really does start the server.
 */
function renderConnect(detail) {
  if (isNativeApp()) {
    renderNativeConnect(detail);
    return;
  }
  renderWebConnect(detail);
}

function renderNativeConnect(detail) {
  cleanup();
  const student = isStudentApp();
  const host = isLecturerApp();

  app.innerHTML = `<div class="auth">
    <section class="auth-hero">
      <div class="hero-eyebrow"><span class="dot"></span>Baraton University · Smart attendance</div>
      <div>
        <h1>One register. <em>${host ? 'This phone holds it.' : 'Found on your Wi-Fi.'}</em></h1>
        <p class="lede">${student
          ? 'Nothing to type. This app finds the class on the Wi-Fi, or over Bluetooth when the network stops phones from reaching each other.'
          : 'Attendance runs from this phone. Students find it on the Wi-Fi, or over Bluetooth when the network will not carry them.'}</p>
      </div>
      <div class="verify-chain">
        <div class="vc-item">
          <span class="ic">${icon(host ? 'play' : 'users', 17)}</span>
          <div><div class="t">${host ? 'Lecturer opens a window' : 'Find the class'}</div><div class="d">${host ? 'The register is on this phone' : 'Automatic on the class Wi-Fi'}</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
        <div class="vc-item">
          <span class="ic">${icon('key', 17)}</span>
          <div><div class="t">Four-digit code</div><div class="d">Issued for this window only</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
        <div class="vc-item">
          <span class="ic">${icon('users', 17)}</span>
          <div><div class="t">Every post is checked</div><div class="d">Enrolled, inside the hall, once</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <div class="eyebrow">${student ? 'Class Wi-Fi' : 'Class host'}</div>
        <h2>${student
          ? (detail ? 'Class not found yet' : 'Searching for the class…')
          : 'The server did not start'}</h2>
        <p class="sub">${student
          ? 'The lecturer phone must have the app open. The search tries the Wi-Fi first, then Bluetooth.'
          : 'This phone could not open the register port. Free up the port and try again.'}</p>

        ${detail ? `<div class="alert alert-red mb-16"><span class="alert-icon">${icon('alert', 16)}</span><div><div class="alert-title">Not connected</div><div class="alert-body">${esc(detail)}</div></div></div>` : ''}

        <button class="btn btn-primary btn-block" id="retry">${icon('refresh', 16)} ${student ? 'Search again' : 'Try again'}</button>

        ${student
          ? `<details class="mt-16"><summary class="sub">Enter the address manually</summary>
              <div class="field mt-12">
                <label for="server-url">Server address</label>
                <input class="input" id="server-url" value="${esc(serverBase() || '')}" placeholder="http://192.168.1.20:4173" inputmode="url" autocomplete="off" spellcheck="false">
              </div>
              <button class="btn btn-soft btn-block" id="connect-manual">${icon('plug', 16)} Connect</button>
            </details>`
          : ''}

        <div class="auth-note">${student
          ? 'If the search keeps failing, turn Bluetooth on and ask the lecturer to tap "Make this phone findable". A phone that is not paired yet asks you to pair once. Both apps on one handset work too: the student app finds the register on the same phone.'
          : 'Keep this app open during the class. Keep Bluetooth on so students whose Wi-Fi cannot reach this phone can pair instead.'}</div>
      </div>
    </section>
  </div>`;

  const retry = document.getElementById('retry');
  if (retry) {
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      retry.innerHTML = student ? 'Searching…' : 'Starting…';
      if (host) {
        location.reload();
        return;
      }
      forgetHost();
      await boot();
    });
  }

  const manual = document.getElementById('connect-manual');
  if (manual) {
    manual.addEventListener('click', async () => {
      const input = document.getElementById('server-url');
      try {
        setServerBase(input.value);
      } catch (err) {
        toast('Invalid address', { message: err.message, tone: 'error' });
        return;
      }
      manual.disabled = true;
      manual.innerHTML = 'Connecting…';
      await boot();
    });
  }
}

function renderWebConnect(detail) {
  cleanup();
  const value = serverBase() || '';
  const showReset = !needsServerSetup();

  app.innerHTML = `<div class="auth">
    <section class="auth-hero">
      <div class="hero-eyebrow"><span class="dot"></span>Baraton University · Smart attendance</div>
      <div>
        <h1>One register. <em>Every phone.</em></h1>
        <p class="lede">The lecturer's window and the student's check-in now live in one shared database on the class Wi-Fi. Start the server on the laptop, then point both apps at it.</p>
      </div>
      <div class="verify-chain">
        <div class="vc-item">
          <span class="ic">${icon('play', 17)}</span>
          <div><div class="t">Lecturer opens a window</div><div class="d">A four-digit code is issued by the server</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
        <div class="vc-item">
          <span class="ic">${icon('key', 17)}</span>
          <div><div class="t">Student enters the code</div><div class="d">Plus GPS inside the hall fence</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
        <div class="vc-item">
          <span class="ic">${icon('users', 17)}</span>
          <div><div class="t">Roster updates live</div><div class="d">No refresh, no second database</div></div>
          <span class="check">${icon('check', 16)}</span>
        </div>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <div class="eyebrow">Shared backend</div>
        <h2>Connect to the server</h2>
        <p class="sub">Type the Network address printed by <code>npm start</code> on the laptop.</p>

        ${detail ? `<div class="alert alert-red mb-16"><span class="alert-icon">${icon('alert', 16)}</span><div><div class="alert-title">Not connected</div><div class="alert-body">${esc(detail)}</div></div></div>` : ''}

        <div class="field">
          <label for="server-url">Server address</label>
          <input class="input" id="server-url" value="${esc(value)}" placeholder="http://192.168.1.20:4173" inputmode="url" autocomplete="off" spellcheck="false">
        </div>

        <button class="btn btn-primary btn-block" id="connect">${icon('plug', 16)} Connect</button>
        ${showReset ? `<button class="btn btn-soft btn-block mt-8" id="use-here">${icon('refresh', 15)} Use this server</button>` : ''}

        <div class="auth-note">
          The laptop must be on the same Wi-Fi as the phones. Start it with <code>npm start</code>; keep the window open during the demo.
        </div>
      </div>
    </section>
  </div>`;

  const input = document.getElementById('server-url');
  const connect = document.getElementById('connect');
  const go = async () => {
    try {
      setServerBase(input.value);
    } catch (err) {
      toast('Invalid address', { message: err.message, tone: 'error' });
      return;
    }
    connect.disabled = true;
    connect.innerHTML = 'Connecting…';
    await boot();
  };
  connect.addEventListener('click', go);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    setTimeout(() => input.focus(), 60);
  }

  const useHere = document.getElementById('use-here');
  if (useHere) {
    useHere.addEventListener('click', async () => {
      clearServerBase();
      await boot();
    });
  }
}

/* ------------------------------------------------------------------ */
/* Live updates                                                        */
/* ------------------------------------------------------------------ */

async function pull() {
  if (refreshing) return false;
  refreshing = true;
  try {
    const changed = await refreshDB();
    serverOnline = true;
    if (changed) {
      render();
      // A class just moved: push the finished reports while the phone is warm.
      if (APP_ROLE === 'lecturer') syncLecturerCloud();
    } else {
      paintNetwork();
    }
    return changed;
  } catch (err) {
    serverOnline = false;
    paintNetwork();
    return false;
  } finally {
    refreshing = false;
  }
}

function connectLive() {
  if (unsubscribe) unsubscribe();
  let pullTimer = null;
  unsubscribe = subscribeToState(() => {
    // One pull per burst: a class posting together must not make every phone
    // fetch the snapshot dozens of times.
    if (pullTimer) return;
    pullTimer = setTimeout(() => {
      pullTimer = null;
      pull();
    }, 250);
  });

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!serverOnline || document.visibilityState === 'visible') pull();
  }, 10000);
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
      setActor(id);
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
  const db = getDB();
  if (!db || !db.revision) {
    renderConnect('The server did not return a database snapshot.');
    return;
  }

  let auth;
  try {
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
    setActor(auth ? auth.user.id : null);
  } catch (err) {
    console.error('[CLASSPREF3CT] could not load state', err);
    app.innerHTML = shell(
      { role: 'admin', user: (db && db.admin) || { name: 'Demo' } },
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
  const navKey = ['lecturer/session', 'lecturer/analytics', 'lecturer/setup'].includes(pageKey)
    ? 'lecturer/classes'
    : pageKey;

  const ctx = {
    db,
    user: auth.user,
    role: auth.role,
    params: route.params,
    deviceId: getDeviceId(),
    refresh: render,
    sync: async () => {
      try {
        await refreshDB();
        serverOnline = true;
      } catch (err) {
        serverOnline = false;
        toast('Server unreachable', { message: err.message, tone: 'error' });
      }
      render();
    },
    toast
  };

  cleanup();
  let view;
  try {
    view = viewFn(ctx) || {};
  } catch (err) {
    console.error('[CLASSPREF3CT] view failed', err);
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
      console.error('[CLASSPREF3CT] mount failed', err);
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
  label.textContent = serverOnline ? 'Server connected' : 'Server unreachable';
  state.className = serverOnline ? 'pill pill-green' : 'pill pill-red';
  state.title = serverOnline
    ? `Shared attendance database at ${serverLabel()}.`
    : `Cannot reach ${serverLabel()}. Writes are disabled until the server returns.`;
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

  const server = e.target.closest('[data-action="server"]');
  if (server) {
    renderConnect('Change the address and reconnect. The demo database stays on the laptop.');
    return;
  }

  const btn = e.target.closest('[data-action="signout"]');
  if (!btn) return;
  cleanup();
  clearUser();
  forgetStudent();
  setActor(null);
  if (location.hash === '#/' || location.hash === '') render();
  else location.hash = '#/';
});

window.addEventListener('hashchange', render);
window.addEventListener('online', () => {
  serverOnline = navigator.onLine;
  paintNetwork();
  pull();
});
window.addEventListener('offline', () => {
  serverOnline = false;
  paintNetwork();
});

window.addEventListener('error', (e) => {
  console.error('[CLASSPREF3CT] uncaught', e.error || e.message);
});

// Offline shell: the Android build already bundles every asset, so it skips
// the worker entirely. The API itself is never cached.
if ('serviceWorker' in navigator && !NATIVE_APP) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch((err) => {
      console.warn('[CLASSPREF3CT] offline cache unavailable', err);
    });
  });
}

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
    console.warn('[CLASSPREF3CT] install prompt failed', err);
  }
  paintInstall();
  if (accepted) {
    toast('Installing CLASSPREF3CT', { message: 'Opens full screen and stays in sync with the class server.' });
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  paintInstall();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  paintInstall();
  toast('App installed', { message: 'CLASSPREF3CT is on your home screen.' });
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/**
 * Something on screen before the first await.
 *
 * Starting the host is quick, but finding another phone is a search: Wi-Fi
 * discovery runs to its timeout and Bluetooth comes after it. With nothing
 * painted until that settled, the app looked frozen on a blank screen.
 */
function paintBooting() {
  if (!app || app.dataset.painted === 'booting') return;
  app.dataset.painted = 'booting';
  app.innerHTML = `<div class="auth">
    <section class="auth-panel">
      <div class="auth-card">
        <div class="eyebrow">CLASSPREF3CT</div>
        <h2>Starting…</h2>
        <p class="sub">${APP_ROLE === 'lecturer'
          ? 'Opening the class register on this phone.'
          : 'Looking for the lecturer phone — first on the Wi-Fi, then over Bluetooth.'}</p>
      </div>
    </section>
  </div>`;
}

async function boot() {
  paintBooting();

  let host = null;
  let settled = false;
  // A search still running after three seconds gets said out loud, instead of
  // leaving a "Starting…" card up for the whole discovery.
  const slow = APP_ROLE === 'student'
    ? setTimeout(() => {
        if (settled) return;
        renderConnect('Still searching for the lecturer phone over Wi-Fi and Bluetooth. Ask the lecturer to open CLASSPREF3CT and search again — or enter the address by hand.');
      }, 3000)
    : null;

  try {
    // In the APKs the server is the lecturer's own phone (host) or a phone found
    // on the class Wi-Fi (student). This must settle before the first fetch.
    host = await ensureHost();
  } catch (err) {
    settled = true;
    if (slow) clearTimeout(slow);
    renderConnect(err && err.message ? err.message : 'The class host could not start on this phone.');
    return;
  }
  settled = true;
  if (slow) clearTimeout(slow);

  if (needsServerSetup()) {
    if (isNativeApp()) {
      // The lecturer's phone is out of reach. A student who has opened this
      // register before keeps working from the last snapshot instead of being
      // stopped by a network they cannot control.
      if (APP_ROLE === 'student') {
        const cached = rememberedState();
        if (cached) {
          setDB(cached.state);
          serverOnline = false;
          render();
          refreshStudentCloud();
          return;
        }
      }
      renderConnect(
        host && host.error
          ? host.error
          : host && host.mode === 'not-found'
            ? 'No lecturer phone answered over Wi-Fi or Bluetooth. Ask the lecturer to open CLASSPREF3CT, then search again.'
            : null
      );
      return;
    }
    renderConnect('This app is bundled without a server address. Enter the laptop address to continue.');
    return;
  }

  try {
    await initDB();
    serverOnline = true;
  } catch (err) {
    serverOnline = false;
    if (err.message === 'server-not-configured') {
      renderConnect('');
    } else {
      renderConnect(err.message);
    }
    return;
  }

  connectLive();
  render();

  if (APP_ROLE === 'lecturer') syncLecturerCloud();
  if (APP_ROLE === 'student') refreshStudentCloud();
}

/** The cloud is a shelf, not a dependency: failures change nothing on screen. */
function syncLecturerCloud() {
  const id = storedUserId();
  if (!id) return;
  syncLecturer(id).catch(() => {});
}

function refreshStudentCloud() {
  const id = rememberedStudent() || storedUserId();
  if (!id) return;
  pullStudentClasses(id)
    .then((payload) => {
      if (!payload || !Array.isArray(payload.classes) || !payload.classes.length) return;
      const db = getDB();
      if (!db) return;
      if (mergeCloudClasses(db, payload.classes)) {
        setDB(db);
        render();
      }
    })
    .catch(() => {});
}

boot();
