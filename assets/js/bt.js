/**
 * CLASSPREF3CT — the Bluetooth lane to the lecturer's phone.
 *
 * Wi-Fi is the class network and it is sometimes hostile: the campus AP gives
 * every phone its own island, so discovery finds the lecturer's address and
 * the socket to it still never opens. Bluetooth has no middlebox to configure,
 * and the lecturer's phone is the only other device in the room that answers.
 *
 * This module is the student side of that lane. It speaks the same routes as
 * the Wi-Fi transport, so nothing above it knows which one carried a request.
 */

const PLUGIN = 'ClassFinder';

function plugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap) return null;
  const native = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  if (!native) return null;
  return (cap.Plugins && cap.Plugins[PLUGIN]) || null;
}

/** True when this build can carry requests over Bluetooth. */
export function btAvailable() {
  const found = plugin();
  return !!(found && typeof found.call === 'function');
}

/** Search for the lecturer over Bluetooth. Never throws for "nobody there". */
export async function btFind(timeoutMs = 8000) {
  const found = plugin();
  if (!found || typeof found.find !== 'function') {
    return { found: false, error: 'This build cannot use Bluetooth.' };
  }
  try {
    return await found.find({ timeoutMs });
  } catch (err) {
    return { found: false, error: err && err.message ? err.message : 'Bluetooth search failed.' };
  }
}

/**
 * One request over the Bluetooth link, returning the same JSON the Wi-Fi
 * socket would have returned. Throws the register's own message on refusal.
 */
export async function btCall(method, path, body) {
  const found = plugin();
  if (!found) throw new Error('This build cannot use Bluetooth.');

  let answer;
  try {
    answer = await found.call({
      method,
      path,
      body: body ? JSON.stringify(body) : null
    });
  } catch (err) {
    throw new Error(err && err.message ? err.message : 'The lecturer phone did not answer over Bluetooth.');
  }

  let data;
  try {
    data = JSON.parse(answer.body);
  } catch (err) {
    throw new Error('The lecturer phone answered with something that is not a register.');
  }
  if (!data || data.ok === false) {
    const refused = new Error((data && data.error) || 'The class register refused that request.');
    // The register answered, so another transport would only repeat it.
    refused.register = true;
    throw refused;
  }
  return data;
}
