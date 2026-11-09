#!/usr/bin/env node
/**
 * AttendEase — GlobalSat BT-821C bridge.
 *
 * The BT-821C speaks Bluetooth Classic SPP and streams NMEA 0183 sentences.
 * Browsers can't open SPP sockets (Web Bluetooth is BLE only), so this small
 * service does it and publishes the latest fix as JSON. It listens on the LAN
 * by default so phones can use the receiver when their own GPS is unavailable:
 *
 *   http://<laptop>:4190/fix      current fix (used by both apps)
 *   http://<laptop>:4190/health   receiver + parser status
 *   http://<laptop>:4190/nmea     last raw sentences (debugging)
 *
 * Pair the receiver with the computer first (Windows: Settings → Bluetooth &
 * devices → Add device → "BT-821C"), then find the outgoing COM port:
 *
 *   node tools/bt821c-bridge.js --list
 *   node tools/bt821c-bridge.js --port COM7
 *
 * The COM port needs the optional `serialport` dependency:
 *   npm install serialport
 *
 * Hardware-free check:
 *   node tools/bt821c-bridge.js --stdin
 *   (paste NMEA sentences; the parser prints and serves them)
 */

'use strict';

const http = require('http');
const os = require('os');
const readline = require('readline');

// 0.0.0.0 lets the phones on the same Wi-Fi reach the receiver. Pass
// `--host 127.0.0.1` to keep it laptop-only.
const DEFAULTS = { baud: 38400, http: 4190, host: '0.0.0.0' };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const HTTP_PORT = Number(args.http || DEFAULTS.http);
const BAUD = Number(args.baud || DEFAULTS.baud);
const COM_PORT = typeof args.port === 'string' ? args.port : null;

const state = {
  connected: false,
  port: COM_PORT,
  baud: BAUD,
  sentences: 0,
  rejected: 0,
  lastSentenceAt: null,
  lastSentence: null,
  satsInView: null,
  fix: null,
  error: null,
  startedAt: new Date().toISOString()
};

const recentLines = [];

/* ------------------------------------------------------------------ */
/* NMEA parsing                                                        */
/* ------------------------------------------------------------------ */

function checksumOk(sentence) {
  const star = sentence.indexOf('*');
  if (star === -1) return true; // some receivers omit it; accept
  const body = sentence.slice(1, star);
  const given = sentence.slice(star + 1).trim().slice(0, 2).toUpperCase();
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
  const computed = sum.toString(16).toUpperCase().padStart(2, '0');
  return given === computed;
}

function ddmToDecimal(value, hemisphere) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const degrees = Math.floor(n / 100);
  const minutes = n - degrees * 100;
  const decimal = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') return -decimal;
  return decimal;
}

function hdopToAccuracy(hdop) {
  if (!Number.isFinite(hdop) || hdop <= 0) return null;
  // ~5 m UERE per HDOP unit is the usual rule of thumb; clamp for sanity.
  return Math.min(50, Math.max(3, Math.round(hdop * 5)));
}

function applyFix(payload) {
  const now = new Date();
  const previous = state.fix;
  state.fix = {
    lat: payload.lat,
    lng: payload.lng,
    quality: payload.quality ?? previous?.quality ?? null,
    sats: payload.sats ?? previous?.sats ?? null,
    hdop: payload.hdop ?? previous?.hdop ?? null,
    altitudeM: payload.altitudeM ?? previous?.altitudeM ?? null,
    speedKph: payload.speedKph ?? previous?.speedKph ?? null,
    course: payload.course ?? previous?.course ?? null,
    accuracy: hdopToAccuracy(payload.hdop ?? previous?.hdop),
    at: now.toISOString()
  };
}

function handleSentence(rawLine) {
  const line = String(rawLine).trim();
  if (!line.startsWith('$')) return;

  recentLines.unshift(line);
  if (recentLines.length > 6) recentLines.pop();
  state.lastSentence = line;
  state.lastSentenceAt = new Date().toISOString();

  if (!checksumOk(line)) {
    state.rejected++;
    return;
  }

  state.sentences++;
  const fields = line.split('*')[0].split(',');
  const type = fields[0].slice(3);

  if (type === 'GGA') {
    const quality = Number(fields[6]);
    const sats = Number(fields[7]);
    const hdop = Number(fields[8]);
    if (Number.isFinite(sats)) state.satsInView = sats;
    if (quality > 0) {
      const lat = ddmToDecimal(fields[2], fields[3]);
      const lng = ddmToDecimal(fields[4], fields[5]);
      if (lat !== null && lng !== null) {
        applyFix({ lat, lng, quality, sats, hdop, altitudeM: Number(fields[9]) || null });
      }
    }
  } else if (type === 'RMC') {
    const active = fields[2] === 'A';
    if (active) {
      const lat = ddmToDecimal(fields[3], fields[4]);
      const lng = ddmToDecimal(fields[5], fields[6]);
      if (lat !== null && lng !== null) {
        const knots = Number(fields[7]);
        applyFix({
          lat,
          lng,
          quality: 1,
          speedKph: Number.isFinite(knots) ? Math.round(knots * 1.852 * 10) / 10 : null,
          course: Number(fields[8]) || null
        });
      }
    }
  } else if (type === 'GSV') {
    const inView = Number(fields[3]);
    if (Number.isFinite(inView) && inView > 0) state.satsInView = inView;
  } else if (type === 'GSA') {
    const fixType = Number(fields[2]);
    if (fixType === 1) {
      // 1 = no fix; drop the stale position so the app cannot mark attendance on it.
      state.fix = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* HTTP API                                                            */
/* ------------------------------------------------------------------ */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function fixPayload() {
  const ageMs = state.fix ? Date.now() - new Date(state.fix.at).getTime() : null;
  const fresh = ageMs !== null && ageMs < 10000;
  let status = 'ok';
  if (!state.fix) status = state.connected ? 'waiting-fix' : 'disconnected';
  else if (!fresh) status = 'stale';

  return {
    ok: !!state.fix && fresh,
    source: 'bt-821c',
    status,
    lat: state.fix ? state.fix.lat : null,
    lng: state.fix ? state.fix.lng : null,
    accuracy: state.fix ? state.fix.accuracy : null,
    sats: state.satsInView ?? (state.fix ? state.fix.sats : null),
    hdop: state.fix ? state.fix.hdop : null,
    altitudeM: state.fix ? state.fix.altitudeM : null,
    fixQuality: state.fix ? state.fix.quality : null,
    speedKph: state.fix ? state.fix.speedKph : null,
    ageMs,
    at: state.fix ? state.fix.at : null,
    connected: state.connected,
    port: state.port,
    error: state.error
  };
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url || '/').split('?')[0];

  if (path === '/fix') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(fixPayload()));
    return;
  }

  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        connected: state.connected,
        port: state.port,
        baud: state.baud,
        mode: MODE,
        sentences: state.sentences,
        rejected: state.rejected,
        satsInView: state.satsInView,
        lastSentenceAt: state.lastSentenceAt,
        startedAt: state.startedAt,
        error: state.error
      })
    );
    return;
  }

  if (path === '/nmea') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ lines: recentLines }));
    return;
  }

  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('AttendEase BT-821C bridge. GET /fix, /health, /nmea\n');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

let MODE = 'none';

/* ------------------------------------------------------------------ */
/* Input modes                                                         */
/* ------------------------------------------------------------------ */

function startStdin() {
  MODE = 'stdin';
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', handleSentence);
  rl.on('close', () => {
    state.connected = false;
    console.log('[bridge] stdin closed — server still serving the last fix');
  });
  console.log('[bridge] reading NMEA from stdin');
}

function startSerial() {
  if (!COM_PORT) {
    console.error('[bridge] No port given. Run: node tools/bt821c-bridge.js --list');
    process.exit(1);
  }

  let SerialPort;
  try {
    SerialPort = require('serialport').SerialPort;
  } catch (err) {
    console.error('[bridge] The optional serialport package is missing.');
    console.error('         npm install serialport');
    console.error('         Then re-run: node tools/bt821c-bridge.js --port ' + COM_PORT);
    process.exit(1);
  }

  MODE = 'serial';
  const port = new SerialPort({ path: COM_PORT, baudRate: BAUD, autoOpen: false });

  port.open((err) => {
    if (err) {
      state.error = err.message;
      console.error(`[bridge] Could not open ${COM_PORT}: ${err.message}`);
      console.error('[bridge] Check the port with --list and make sure it is the outgoing link.');
      process.exit(1);
    }
    state.connected = true;
    state.error = null;
    console.log(`[bridge] ${COM_PORT} open at ${BAUD} baud — waiting for NMEA sentences`);
  });

  let buffer = '';
  port.on('data', (chunk) => {
    buffer += chunk.toString('latin1');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      handleSentence(line);
    }
    if (buffer.length > 4096) buffer = '';
  });

  port.on('error', (err) => {
    state.error = err.message;
    console.error('[bridge] Serial error:', err.message);
  });

  port.on('close', () => {
    state.connected = false;
    console.log('[bridge] Serial port closed');
  });
}

async function listPorts() {
  let SerialPort;
  try {
    SerialPort = require('serialport').SerialPort;
  } catch (err) {
    console.error('The optional serialport package is required to list ports.');
    console.error('npm install serialport');
    process.exit(1);
  }
  const ports = await SerialPort.list();
  if (!ports.length) console.log('No serial ports found. Pair the BT-821C first.');
  for (const p of ports) {
    console.log(`${p.path}\t${p.manufacturer || ''}\t${p.friendlyName || ''}`);
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

if (args.help) {
  console.log(`AttendEase BT-821C bridge

  node tools/bt821c-bridge.js --port COM7 [--baud 38400] [--http 4190] [--host 0.0.0.0]
  node tools/bt821c-bridge.js --stdin
  node tools/bt821c-bridge.js --list`);
  process.exit(0);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

if (args.list) {
  listPorts();
} else {
  const HOST = typeof args.host === 'string' ? args.host : DEFAULTS.host;
  server.listen(HTTP_PORT, HOST, () => {
    console.log(`[bridge] serving fixes at http://127.0.0.1:${HTTP_PORT}/fix`);
    if (HOST === '0.0.0.0') {
      for (const address of lanAddresses()) {
        console.log(`[bridge] phones use http://${address}:${HTTP_PORT}/fix`);
      }
    }
  });
  if (args.stdin) startStdin();
  else startSerial();

  // Log the first usable fix once, so the demo operator knows the receiver is hot.
  let announced = false;
  setInterval(() => {
    if (!announced && state.fix && fixPayload().ok) {
      announced = true;
      console.log(`[bridge] fix acquired: ${state.fix.lat.toFixed(6)}, ${state.fix.lng.toFixed(6)} (±${state.fix.accuracy} m, ${state.satsInView || '?'} sats)`);
    }
  }, 1000).unref?.();
}
