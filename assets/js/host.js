/**
 * AttendEase — the class server lives on the lecturer's phone.
 *
 * Two native plugins back this module:
 *
 *   ClassHost   (lecturer APK) starts the HTTP server on :4173 and advertises
 *               it on the Wi-Fi, so the lecturer's own screen can talk to
 *               127.0.0.1 and students can find the phone.
 *   ClassFinder (student APK)  looks for that advertisement (NSD, then a UDP
 *               beacon) and returns the address to use.
 *
 * On the web nothing changes: the page keeps talking to whatever server the
 * user typed in. This module is the only place that decides where "the
 * server" is in the installed apps.
 */

import { isNativeApp, serverBase, setServerBase, clearServerBase, AUTO_KEY } from './data.js';

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i;
const DEFAULT_PORT = 4173;

/**
 * The Android bridge injects window.Capacitor with isNativePlatform() and a
 * Plugins map holding every plugin the app registered natively. It does NOT
 * inject registerPlugin() — that lives in @capacitor/core's JS, which this app
 * does not bundle — so asking for it disabled every native call in the apps.
 * The Plugins map is the reliable handle; registerPlugin is only a fallback.
 */
function nativePlugin(name) {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap) return null;
  const native = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  if (!native) return null;

  if (cap.Plugins && cap.Plugins[name]) return cap.Plugins[name];

  if (typeof cap.registerPlugin === 'function') {
    try {
      return cap.registerPlugin(name);
    } catch (err) {
      return null;
    }
  }
  return null;
}

/** Names of the plugins the bridge actually gave us, for error messages. */
function availablePlugins() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const plugins = cap && cap.Plugins ? Object.keys(cap.Plugins) : [];
  return `bridge plugins: ${plugins.length ? plugins.join(', ') : 'none'}`;
}

function role() {
  if (typeof document === 'undefined' || !document.body) return '';
  return document.body.dataset.app || '';
}

export function isLecturerApp() {
  return role() === 'lecturer';
}

export function isStudentApp() {
  return role() === 'student';
}

function autoFlag() {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch (err) {
    return false;
  }
}

let resolved = null;

/**
 * Make the app ready to talk to a server. Idempotent, and never called twice.
 *
 * Lecturer → start hosting, point this app at loopback.
 * Student  → keep a manually configured address, otherwise discover the phone.
 */
export async function ensureHost() {
  if (resolved) return resolved;

  if (!isNativeApp()) {
    resolved = { mode: 'web', running: false, url: serverBase() };
    return resolved;
  }

  if (isLecturerApp()) {
    const plugin = nativePlugin('ClassHost');
    if (!plugin) {
      throw new Error(`This build cannot host a class (ClassHost plugin missing). ${availablePlugins()}`);
    }

    let status = null;
    try {
      status = await plugin.status();
    } catch (err) {
      status = null;
    }
    if (!status || !status.running) {
      status = await plugin.start({ port: DEFAULT_PORT, name: 'AttendEase' });
    }
    if (!status || !status.running) {
      throw new Error('The class server did not start on this phone.');
    }

    const url = status.url || `http://127.0.0.1:${status.port || DEFAULT_PORT}`;
    setServerBase(url, true);
    resolved = {
      mode: 'host',
      running: true,
      url,
      port: status.port || DEFAULT_PORT,
      addresses: Array.isArray(status.addresses) ? status.addresses : [],
      revision: status.revision
    };
    return resolved;
  }

  if (isStudentApp()) {
    const saved = serverBase();
    const auto = autoFlag();
    // A real address the student typed is their choice; leave it alone. An
    // address we found last week must be looked up again — the lecturer's
    // phone may have a different IP today.
    if (saved && !auto && !LOOPBACK.test(saved)) {
      resolved = { mode: 'manual', running: true, url: saved };
      return resolved;
    }

    const found = await discoverHost(4500);
    if (found && found.found) {
      setServerBase(found.url, true);
      resolved = {
        mode: 'discovered',
        running: true,
        url: found.url,
        name: found.name || 'AttendEase class',
        via: found.via || 'nsd'
      };
      return resolved;
    }

    resolved = { mode: 'not-found', running: false, url: '' };
    return resolved;
  }

  resolved = { mode: 'web', running: false, url: serverBase() };
  return resolved;
}

/** Ask the Wi-Fi for a lecturer phone. Used at boot and by the Connect screen. */
export async function discoverHost(timeoutMs = 4500) {
  const plugin = nativePlugin('ClassFinder');
  if (!plugin) return { found: false, error: `ClassFinder plugin missing (${availablePlugins()})` };
  try {
    return await plugin.find({ timeoutMs });
  } catch (err) {
    return { found: false, error: err && err.message ? err.message : 'Discovery failed' };
  }
}

/** Live status for the lecturer's host card. */
export async function hostStatus() {
  const plugin = nativePlugin('ClassHost');
  if (!plugin) return { running: false };
  try {
    return await plugin.status();
  } catch (err) {
    return { running: false, error: err && err.message ? err.message : 'Status unavailable' };
  }
}

export async function stopHost() {
  const plugin = nativePlugin('ClassHost');
  if (!plugin) return { running: false };
  try {
    const result = await plugin.stop();
    resolved = null;
    if (LOOPBACK.test(serverBase())) clearServerBase();
    return result;
  } catch (err) {
    return { running: false, error: err && err.message ? err.message : 'Could not stop' };
  }
}

/** Forget the auto-detected address so the next boot searches again. */
export function forgetHost() {
  resolved = null;
  if (LOOPBACK.test(serverBase())) clearServerBase();
}
