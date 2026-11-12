/**
 * CLASSPREF3CT — Bluetooth Low Energy.
 *
 * Two paths, one result shape:
 *
 *   native → @capacitor-community/bluetooth-le inside the APK. It scans from
 *            the WebView with no picker, which is what the installed app needs.
 *   web    → Web Bluetooth in Chrome, which shows the browser device picker.
 *
 * Bluetooth is proof, never a gate: every call resolves with a readable
 * reason when the radio is off, the permission is denied, or no beacon is
 * nearby, so posting can always fall back to the server scan.
 */

function nativeClient() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  return (cap.Plugins && cap.Plugins.BleClient) || null;
}

/** 'native' | 'web' | 'none' */
export function bleSupport() {
  if (nativeClient()) return 'native';
  if (typeof navigator !== 'undefined' && navigator.bluetooth && navigator.bluetooth.requestDevice) {
    return 'web';
  }
  return 'none';
}

function upper(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function explain(err) {
  const raw = String((err && (err.message || err.errorMessage)) || err || '');
  if (/denied|permission|not authorized/i.test(raw)) {
    return {
      reason: 'denied',
      message: 'Bluetooth permission is off for CLASSPREF3CT. Allow “Nearby devices” in Android settings, then scan again.'
    };
  }
  if (/off|disabled|not enabled|turned off/i.test(raw)) {
    return { reason: 'off', message: 'Bluetooth is off on this phone. Turn it on, then scan again.' };
  }
  return { reason: 'error', message: `Bluetooth scan failed${raw ? ` (${raw.slice(0, 90)})` : ''}.` };
}

/**
 * Look for one of `names` (the session beacon names the server publishes,
 * e.g. DBM411_MONDAY_CLASS). Resolves — never rejects — after at most
 * `timeout` ms.
 */
export async function bleFindBeacon(names, { timeout = 6000 } = {}) {
  const wanted = (names || []).map(upper).filter(Boolean);
  const kind = bleSupport();

  if (kind === 'none') {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'Bluetooth scanning is not available here. The automatic scan still finds your lecture.'
    };
  }

  if (kind === 'web') {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return {
        ok: false,
        reason: 'insecure',
        message: 'Bluetooth is blocked on this http:// address. Open the installed CLASSPREF3CT app instead.'
      };
    }
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      const name = device.name || 'Bluetooth device';
      const hit = wanted.find((want) => upper(name) === want || upper(name).includes(want)) || null;
      return { ok: true, source: 'web', name, matched: hit, rssi: null };
    } catch (err) {
      return {
        ok: false,
        reason: 'cancelled',
        message:
          err && err.name === 'NotFoundError'
            ? `No beacon named ${wanted.slice(0, 2).join(' / ') || 'for this class'} was picked. Try again and choose the lecturer’s beacon.`
            : 'Bluetooth scan cancelled or blocked. The automatic scan above still works.'
      };
    }
  }

  const client = nativeClient();
  let found = null;

  try {
    await withTimeout(client.initialize({ androidNeverForLocation: false }), timeout, 'Bluetooth took too long to start.');

    await withTimeout(
      client.requestLEScan({ allowDuplicates: false }, (result) => {
        if (found || !result) return;
        const localName = result.localName || (result.device && result.device.name) || '';
        const name = upper(localName);
        if (!name) return;
        const exact = wanted.find((want) => name === want);
        const loose = wanted.find((want) => name.includes(want));
        if (exact || loose) {
          found = {
            name: localName,
            matched: exact || loose,
            rssi: typeof result.rssi === 'number' ? result.rssi : null,
            deviceId: result.device && result.device.deviceId
          };
        }
      }),
      timeout,
      'Bluetooth scan did not start.'
    );

    const startedAt = Date.now();
    while (!found && Date.now() - startedAt < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    try {
      await client.stopLEScan();
    } catch (err) {
      /* scan already stopped */
    }

    if (found) return { ok: true, source: 'native', ...found };

    return {
      ok: false,
      reason: 'not-found',
      message: wanted.length
        ? `No class beacon seen in ${Math.round(timeout / 1000)} s (looking for ${wanted.slice(0, 2).join(' / ')}).`
        : 'No Bluetooth devices were seen nearby.'
    };
  } catch (err) {
    try {
      await client.stopLEScan();
    } catch (stopErr) {
      /* ignore */
    }
    return { ok: false, ...explain(err) };
  }
}
