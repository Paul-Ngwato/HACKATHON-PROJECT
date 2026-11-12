#!/usr/bin/env node
/**
 * CLASSPREF3CT AI — stage the web shells for the Android builds.
 *
 * Capacitor needs a single `webDir` per app project, holding an `index.html`.
 * This script assembles that folder for both apps from the same source, so the
 * PWA shells and the APK bundles can never drift apart:
 *
 *   native/student/www/   index.html = student.html  + shared assets
 *   native/lecturer/www/  index.html = lecturer.html + shared assets
 *
 * Run it with `npm run mobile:stage`, or through `npm run mobile:student` /
 * `npm run mobile:lecturer`, which also sync the assets into the Android project.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = ['assets', 'sw.js', 'student.webmanifest', 'lecturer.webmanifest'];
const APPS = [
  { id: 'student', shell: 'student.html', label: 'Student' },
  { id: 'lecturer', shell: 'lecturer.html', label: 'Lecturer' }
];

function copyEntry(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyEntry(path.join(from, name), path.join(to, name));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

for (const app of APPS) {
  const out = path.join(ROOT, 'native', app.id, 'www');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const entry of SHARED) copyEntry(path.join(ROOT, entry), path.join(out, entry));
  fs.copyFileSync(path.join(ROOT, app.shell), path.join(out, 'index.html'));

  const count = (function walk(dir) {
    let n = 0;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      n += fs.statSync(full).isDirectory() ? walk(full) : 1;
    }
    return n;
  })(out);

  console.log(`${app.label}: native/${app.id}/www  (index.html + ${count - 1} shared files)`);
}
