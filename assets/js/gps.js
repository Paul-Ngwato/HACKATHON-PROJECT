/**
 * AttendEase — GPS source layer.
 *
 * Two real sources feed the same fix shape, so verification never cares where
 * the coordinates came from:
 *
 *   device   – the phone/laptop's own GNSS via the Geolocation API
 *   external – the GlobalSat BT-821C, read over Bluetooth SPP by
 *              tools/bt821c-bridge.js and exposed as JSON on the laptop
 *
 * Browsers cannot open a Bluetooth Classic SPP stream (Web Bluetooth is BLE
 * only), which is exactly why the receiver goes through the bridge. The bridge
 * runs next to the attendance server, so its address is derived from the
 * server address the phone already uses (same IP, port 4190 by default).
 */

import { serverBase } from './data.js';

export const BRIDGE_PORT = 4190;
const BRIDGE_KEY = 'attendsmart.gps.bridge.v1';
const SOURCE_KEY = 'attendsmart.gps.source.v1';

/** Best guess for the laptop bridge: same host as the attendance server. */
export function deriveBridgeBase() {
  const base = serverBase();
  const origin = base || (typeof location !== 'undefined' ? location.origin : '');
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      return `http://${host}:${BRIDGE_PORT}`;
    }
  } catch (err) {
    /* file:// or a bare host — fall through to loopback */
  }
  return `http://127.0.0.1:${BRIDGE_PORT}`;
}

/** Configured bridge URL, or the address derived from the server. */
export function getBridgeBase() {
  try {
    const saved = localStorage.getItem(BRIDGE_KEY);
    if (saved) return saved.replace(/\/+$/, '');
  } catch (err) {
    /* ignore */
  }
  return deriveBridgeBase();
}

export function setBridgeBase(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    try {
      localStorage.removeItem(BRIDGE_KEY);
    } catch (err) {
      /* ignore */
    }
    return deriveBridgeBase();
  }
  let clean = raw;
  if (!/^https?:\/\//i.test(clean)) clean = `http://${clean}`;
  clean = clean.replace(/\/+$/, '');
  try {
    const parsed = new URL(clean);
    if (!parsed.port) parsed.port = String(BRIDGE_PORT);
    clean = `${parsed.protocol}//${parsed.host}`;
    localStorage.setItem(BRIDGE_KEY, clean);
  } catch (err) {
    throw new Error('That does not look like a valid bridge address.');
  }
  return clean;
}

/** Kept for older call sites; always resolves at import time. */
export const BRIDGE_BASE = deriveBridgeBase();

export const GPS_SOURCES = [
  {
    id: 'device',
    label: 'Phone GPS',
    short: 'Phone',
    note: 'Built-in GNSS through the browser. Accuracy varies indoors.'
  },
  {
    id: 'external',
    label: 'BT-821C',
    short: 'BT-821C',
    note: 'External Bluetooth GPS over NMEA. Best accuracy on the demo table.'
  }
];

export function getPreferredSource() {
  try {
    const v = localStorage.getItem(SOURCE_KEY);
    if (GPS_SOURCES.some((s) => s.id === v)) return v;
  } catch (e) {
    /* ignore */
  }
  return 'device';
}

export function setPreferredSource(id) {
  try {
    localStorage.setItem(SOURCE_KEY, id);
  } catch (e) {
    /* ignore */
  }
}

/**
 * Creates a feed. `onChange(state)` fires on every update.
 * The consumer owns the lifecycle: call start() on mount, stop() on teardown.
 */
export function createGpsFeed(onChange, options = {}) {
  const bridgeUrl = (options.bridgeUrl || getBridgeBase()).replace(/\/$/, '');
  let timer = null;
  let watchId = null;
  let stopped = true;
  let pollInFlight = false;

  let state = {
    source: null,
    status: 'idle', // idle | locating | ok | error
    lat: null,
    lng: null,
    accuracy: null,
    sats: null,
    hdop: null,
    port: null,
    bridge: false,
    error: null,
    at: null
  };

  function emit(patch) {
    if (stopped) return;
    state = { ...state, ...patch };
    onChange({ ...state });
  }

  function clearTimers() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function startDevice() {
    if (!navigator.geolocation) {
      emit({ status: 'error', error: 'This browser does not expose the Geolocation API.' });
      return;
    }
    if (!window.isSecureContext) {
      emit({
        status: 'error',
        error: 'This browser blocks GPS on a plain http:// address. Use the installed AttendEase app, or switch to the BT-821C receiver below.'
      });
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        emit({
          source: 'device',
          status: 'ok',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          sats: null,
          hdop: null,
          port: null,
          bridge: false,
          error: null,
          at: new Date().toISOString()
        });
      },
      (err) => {
        const message =
          err.code === 1
            ? 'Location permission was denied. Allow it in the browser, or use the BT-821C.'
            : err.code === 2
              ? 'No position available. Step outside or connect the BT-821C.'
              : 'Timed out waiting for a GPS fix.';
        emit({ source: 'device', status: 'error', error: message, lat: null, lng: null });
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
    );
  }

  async function pollBridge() {
    if (stopped || pollInFlight) return;
    pollInFlight = true;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(`${bridgeUrl}/fix`, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
        emit({
          source: 'external',
          status: 'ok',
          lat: data.lat,
          lng: data.lng,
          accuracy: typeof data.accuracy === 'number' ? data.accuracy : null,
          sats: data.sats ?? null,
          hdop: data.hdop ?? null,
          port: data.port || null,
          bridge: true,
          error: null,
          at: data.at || new Date().toISOString()
        });
      } else if (data.status === 'waiting-fix') {
        emit({
          source: 'external',
          status: 'locating',
          bridge: true,
          port: data.port || null,
          sats: data.sats ?? null,
          lat: null,
          lng: null,
          error: 'Receiver connected — waiting for a satellite fix. Move it near a window or outdoors.'
        });
      } else {
        emit({
          source: 'external',
          status: 'error',
          bridge: !!data.connected,
          port: data.port || null,
          sats: data.sats ?? null,
          lat: null,
          lng: null,
          error: data.error || 'Receiver connected but no valid NMEA fix yet.'
        });
      }
    } catch (err) {
      emit({
        source: 'external',
        status: 'error',
        bridge: false,
        lat: null,
        lng: null,
        error: `BT-821C bridge not reachable at ${bridgeUrl}. On the laptop run: node tools/bt821c-bridge.js --host 0.0.0.0`
      });
    } finally {
      clearTimeout(abortTimer);
      pollInFlight = false;
    }
  }

  function startExternal() {
    emit({ status: 'locating', bridge: false, error: null, lat: null, lng: null });
    pollBridge();
    timer = setInterval(pollBridge, 1200);
  }

  return {
    start(sourceId) {
      clearTimers();
      stopped = false;
      state = {
        source: sourceId,
        status: 'locating',
        lat: null,
        lng: null,
        accuracy: null,
        sats: null,
        hdop: null,
        port: null,
        bridge: false,
        error: null,
        at: null
      };
      onChange({ ...state });
      if (sourceId === 'external') startExternal();
      else if (sourceId === 'device') startDevice();
      else emit({ status: 'idle' });
    },

    snapshot() {
      return { ...state };
    },

    stop() {
      stopped = true;
      clearTimers();
    }
  };
}

export function sourceLabel(id) {
  return (GPS_SOURCES.find((s) => s.id === id) || {}).short || 'GPS';
}

/**
 * One-shot discovery of the local BT-821C bridge. Returns the port/baud from
 * /health plus the current fix (when the receiver already has satellites), so
 * both registration and check-in can offer "scan for it" instead of guessing.
 */
export async function scanForReceiver(options = {}) {
  const base = (options.bridgeUrl || getBridgeBase()).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);

  try {
    const healthRes = await fetch(`${base}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
    const health = await healthRes.json();

    let fix = null;
    try {
      const fixRes = await fetch(`${base}/fix`, { signal: controller.signal, cache: 'no-store' });
      if (fixRes.ok) {
        const data = await fixRes.json();
        if (data.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
          fix = {
            lat: data.lat,
            lng: data.lng,
            accuracy: typeof data.accuracy === 'number' ? data.accuracy : null,
            sats: data.sats ?? null,
            hdop: data.hdop ?? null,
            at: data.at || new Date().toISOString()
          };
        }
      }
    } catch (e) {
      /* health answered; a missing fix simply means "waiting for satellites" */
    }

    return {
      ok: true,
      connected: !!health.connected,
      port: health.port || null,
      baud: health.baud || null,
      mode: health.mode || null,
      fix,
      error: health.error || null
    };
  } catch (err) {
    return {
      ok: false,
      connected: false,
      fix: null,
      error: `No BT-821C bridge at ${base}. Pair the receiver, run node tools/bt821c-bridge.js --host 0.0.0.0 on the laptop, then scan again.`
    };
  } finally {
    clearTimeout(timer);
  }
}
