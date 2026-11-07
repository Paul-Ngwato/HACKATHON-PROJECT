/**
 * AttendSmart AI — offline shell.
 *
 * Attendance is a local-first flow: Bluetooth proximity plus the browser's
 * database. This worker caches the two app shells and every asset they import,
 * so both apps (and the full demo) open with no network at all after the first
 * visit. Network-first keeps development fresh; the cache answers when offline.
 *
 * The BT-821C bridge on 127.0.0.1:4190 is a different origin and is left alone.
 */

const CACHE = 'attendsmart-shell-v2';

const SHELL = [
  './',
  './index.html',
  './student.html',
  './lecturer.html',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/data.js',
  './assets/js/analytics.js',
  './assets/js/gps.js',
  './assets/js/ui.js',
  './assets/js/views/login.js',
  './assets/js/views/student.js',
  './assets/js/views/lecturer.js',
  './assets/js/views/admin.js',
  './student.webmanifest',
  './lecturer.webmanifest',
  './assets/icons/student-192.png',
  './assets/icons/student-512.png',
  './assets/icons/student-maskable-512.png',
  './assets/icons/student-apple-180.png',
  './assets/icons/lecturer-192.png',
  './assets/icons/lecturer-512.png',
  './assets/icons/lecturer-maskable-512.png',
  './assets/icons/lecturer-apple-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./student.html'))
      )
  );
});
