/**
 * AttendEase — location helper.
 *
 * "No GPS fix yet" used to cover three very different failures. They are
 * separated here, because each one needs a different action from the student:
 *
 *   insecure origin   → browsers block GPS on plain http:// LAN addresses
 *   permission denied → Android/Chrome was told no, or the APK lacks the perms
 *   no satellites     → retried once with network location, which usually works
 *                       inside a building, then reported honestly
 */

const MESSAGES = {
  insecure:
    'Location is blocked on this http:// address. Open the installed AttendEase app (or an https address) and post again.',
  unsupported: 'This device has no location service. Turn location on and try again.',
  denied:
    'Location permission is off for AttendEase. Allow it in Settings → Apps → AttendEase → Permissions → Location, then post again.',
  unavailable:
    'No GPS fix yet. Indoors this can happen — step near a window or door and press POST ATTENDANCE again.',
  timeout:
    'The location request timed out. Move near a window or door, then press POST ATTENDANCE again.'
};

function attempt(options, watchdogMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const watchdog = setTimeout(() => finish(reject, { code: 3 }), watchdogMs);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn(value);
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        finish(resolve, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: options.enableHighAccuracy ? 'gps' : 'network'
        }),
      (err) => finish(reject, { code: err && err.code ? err.code : 2, message: err && err.message }),
      options
    );
  });
}

/** One fix, with an indoor fallback. Throws an Error whose message is human. */
export async function getFix({ timeout = 12000 } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error(MESSAGES.unsupported);
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error(MESSAGES.insecure);
  }

  const first = Math.min(timeout, 9000);

  try {
    return await attempt({ enableHighAccuracy: true, timeout: first, maximumAge: 0 }, first + 1500);
  } catch (err) {
    if (err && err.code === 1) throw new Error(MESSAGES.denied);

    // Second pass: network location is coarser but works indoors, which is
    // exactly where a lecture is being held.
    try {
      return await attempt(
        { enableHighAccuracy: false, timeout: first, maximumAge: 60000 },
        first + 1500
      );
    } catch (second) {
      if (second && second.code === 1) throw new Error(MESSAGES.denied);
      throw new Error(MESSAGES[second && second.code === 3 ? 'timeout' : 'unavailable']);
    }
  }
}
