#!/usr/bin/env node
/**
 * Rename the product from its original working names to CLASSPREF3CT.
 *
 * What this changes: every user-visible string — app labels, page titles, the
 * in-app header and footer, the advertised Wi-Fi/Bluetooth label, the export
 * folder, exported CSV filenames, the service-worker cache name, docs.
 *
 * What this deliberately leaves alone, because renaming them would break
 * something that is already deployed or already on a student's phone:
 *
 *   _attendease._tcp.        the NSD service type on the wire
 *   attendease               the UDP beacon's service tag
 *   ueab-attendease-2026     the class-key salt (changing it re-keys every
 *                            published roster and orphans the cloud shelf)
 *   attendsmart.* / attendease.cloud.*   localStorage keys (renaming them
 *                            would wipe a lecturer's saved semester)
 *   com.baraton.attendsmart.*            Android package ids (a new id is a
 *                            different app: pupils would have to uninstall)
 *   data/attendsmart.db      the laptop server's existing database file
 *
 * The script is idempotent: running it twice changes nothing the second time.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRAND = 'CLASSPREF3CT';

// Split so this file does not match its own search patterns.
const OLD_EASE = 'Attend' + 'Ease';
const OLD_SMART = 'Attend' + 'Smart';

const TEXT_EXT = new Set(['.md', '.html', '.js', '.cjs', '.json', '.java', '.xml', '.gradle', '.css', '.txt', '.yml', '.yaml', '.webmanifest']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', '.gradle', '.toolchain', 'www', '.idea', 'data', '.freebuff']);

const changed = [];

/** Rules that turn one old string into the new one, per file. */
function rewrite(text, rel) {
  let out = text.split(OLD_EASE).join(BRAND);
  out = out.split(OLD_SMART).join(BRAND);

  // Exported files carry the brand in their name in Downloads/.
  out = out.replace(/(['"`])attendsmart-/g, '$1classpref3ct-');
  out = out.replace(/(['"`])attendease-\$\{/g, '$1classpref3ct-${');

  // Force installed PWAs to drop the old shell on next load.
  out = out.replace(/attendease-shell-v3/g, 'classpref3ct-shell-v4');

  // Keep the old env var working for anyone who already exported it.
  out = out.replace(
    'process.env.ATTENDEASE_DB || process.env.ATTENDSMART_DB',
    'process.env.CLASSPREF3CT_DB || process.env.ATTENDEASE_DB || process.env.ATTENDSMART_DB'
  );

  // The cloud's health string is cosmetic; the tables and the salt are not.
  out = out.replace(/'attendease-cloud'/g, "'classpref3ct-cloud'");

  // The source snapshot in dist/ would be stale the moment it is renamed, so
  // the pack points at the repository instead of shipping an old copy.
  out = out.replace(
    ', and `' + OLD_SMART + '-source.zip`, a snapshot of the source these were built from.',
    '. The source is this repository — branch `hackathon/pitch-pack`.'
  );

  return out;
}

function visit(file) {
  const rel = path.relative(ROOT, file);
  if (!TEXT_EXT.has(path.extname(file).toLowerCase())) return;
  if (file.endsWith('tools' + path.sep + 'rebrand.js')) return;

  const before = fs.readFileSync(file, 'utf8');
  const after = rewrite(before, rel);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed.push(rel);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
    } else {
      visit(full);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 1. Source tree                                                      */
/* ------------------------------------------------------------------ */

walk(ROOT);

/* ------------------------------------------------------------------ */
/* 2. dist/ documents and artefacts                                   */
/* ------------------------------------------------------------------ */

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    const full = path.join(dist, entry.name);
    if (entry.isDirectory()) continue;

    // Rewrite markdown in place.
    if (/\.md$/i.test(entry.name)) visit(full);

    // Rename files whose own name carries the old brand.
    if (entry.name.includes(OLD_EASE) || entry.name.includes(OLD_SMART)) {
      const next = entry.name.split(OLD_EASE).join(BRAND).split(OLD_SMART).join(BRAND);
      const target = path.join(dist, next);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      fs.renameSync(full, target);
      changed.push('dist/' + entry.name + ' -> ' + next);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. Report                                                          */
/* ------------------------------------------------------------------ */

console.log('rebrand: ' + changed.length + ' file(s) touched as ' + BRAND);
for (const file of changed) console.log('  ' + file);

// Anything still carrying the old CamelCase brand is a miss worth seeing.
const leftovers = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      scan(full);
    } else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) {
      if (full.endsWith('tools' + path.sep + 'rebrand.js')) continue;
      const body = fs.readFileSync(full, 'utf8');
      if (body.includes(OLD_EASE) || body.includes(OLD_SMART)) leftovers.push(path.relative(ROOT, full));
    }
  }
}
scan(ROOT);
console.log(leftovers.length ? 'LEFT: ' + leftovers.join(', ') : 'left: none (brand fully renamed)');

// Prove the identifiers that must survive are still present.
const guarded = [
  ['_attendease._tcp.', path.join(ROOT, 'native/lecturer/android/app/src/main/java/com/baraton/attendsmart/lecturer/host/Discovery.java')],
  ['ueab-attendease-2026', path.join(ROOT, 'assets/js/cloud.js')],
  ['attendsmart.state.v1', path.join(ROOT, 'assets/js/data.js')],
  ["com.baraton.attendsmart.lecturer", path.join(ROOT, 'native/lecturer/capacitor.config.json')]
];
for (const [needle, file] of guarded) {
  const ok = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(needle);
  console.log((ok ? 'kept: ' : 'LOST: ') + needle);
}
