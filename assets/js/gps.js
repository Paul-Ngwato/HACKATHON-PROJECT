/**
 * AttendSmart AI — GPS source layer.
 *
 * Three sources feed the same fix shape, so verification never cares where the
 * coordinates came from:
 *
 *   device   – the phone/laptop's own GNSS via the Geolocation API
 *   external – the GlobalSat BT-821C, read over Bluetooth SPP by
 *              tools/bt821c-bridge.js and exposed as JSON on loopback
 *   sim      – deterministic demo positions inside / outside the hall radius
 *
 * Browsers cannot open a Bluetooth Classic SPP stream (Web Bluetooth is BLE
 * only), which is exactly why the receiver goes through the bridge.
 */

export const BRIDGE_BASE = 'http://127.0.0.1:4190';
const SOURCE_KEY = 'attendsmart.gps.source.v1';

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
  },
  {
    id: 'sim',
    label: 'Simulate',
    short: 'Sim',
    note: 'Place yourself inside or outside the hall to demo the radius rule.'
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

/** Build the demo fix `meters` away from a hall, on a random bearing. */
export function offsetFromHall(hall, meters, bearing) {
  const angle = typeof bearing === 'number' ? bearing : Math.random() * Math.PI * 2;
  const dLat = (meters * Math.cos(angle)) / 111320;
  const dLng = (meters * Math.sin(angle)) / (111320 * Math.cos((hall.lat * Math.PI) / 180));
  return { lat: hall.lat + dLat, lng: hall.lng + dLng };
}

/**
 * Creates a feed. `onChange(state)` fires on every update.
 * The consumer owns the lifecycle: call start() on mount, stop() on teardown.
 */
export function createGpsFeed(onChange, options = {}) {
  const bridgeUrl = (options.bridgeUrl || BRIDGE_BASE).replace(/\/$/, '');
  let timer = null;
  let watchId = null;
  let stopped = true;
  let pollInFlight = false;

  let state = {
    source: null,
    status: 'idle', // idle | locating | ok | simulated | error
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
      emit({ status: 'error', error: 'Location needs a secure context. Open the app on http://localhost.' });
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
        error: `GPS bridge not reachable at ${bridgeUrl}. Start tools/bt821c-bridge.js.`
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

    /** Simulated position for the demo: inside, edge (just out) or far. */
    simulate(kind, hall) {
      clearTimers();
      stopped = false;
      if (!hall) {
        emit({ status: 'error', error: 'No lecture hall selected.' });
        return;
      }
      const meters = kind === 'inside' ? 6 + Math.random() * 18 : kind === 'edge' ? hall.radius * 1.8 : 420;
      const { lat, lng } = offsetFromHall(hall, meters);
      state = {
        ...state,
        source: 'sim',
        status: 'simulated',
        lat,
        lng,
        accuracy: 5,
        sats: 9,
        hdop: 0.8,
        port: 'simulated',
        bridge: false,
        error: null,
        at: new Date().toISOString()
      };
      onChange({ ...state });
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
  const base = (options.bridgeUrl || BRIDGE_BASE).replace(/\/$/, '');
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
      error: `No BT-821C bridge at ${base}. Pair the receiver, start tools/bt821c-bridge.js, then scan again.`
    };
  } finally {
    clearTimeout(timer);
  }
}
