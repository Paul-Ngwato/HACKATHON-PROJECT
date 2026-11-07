#!/usr/bin/env node
/**
 * AttendSmart AI — NMEA simulator.
 *
 * Emits GGA + RMC sentences once a second on stdout, so the BT-821C bridge can
 * be exercised (and demoed) without the physical receiver:
 *
 *   node tools/nmea-simulator.js | node tools/bt821c-bridge.js --stdin
 *
 * Options:
 *   --lat -0.157      latitude, decimal degrees
 *   --lng 35.269      longitude, decimal degrees
 *   --sats 9          satellites used
 *   --hdop 0.9        HDOP used to derive accuracy
 *   --interval 1000   milliseconds between fixes
 *   --jitter 0        metres of random walk, useful to see the app update
 */

'use strict';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
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
const LAT = Number(args.lat ?? -0.157);
const LNG = Number(args.lng ?? 35.269);
const SATS = Number(args.sats ?? 9);
const HDOP = Number(args.hdop ?? 0.9);
const INTERVAL = Number(args.interval ?? 1000);
const JITTER = Number(args.jitter ?? 0);

function checksum(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
  return `*${sum.toString(16).toUpperCase().padStart(2, '0')}`;
}

function latField(value) {
  const hemisphere = value < 0 ? 'S' : 'N';
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return { field: `${String(degrees).padStart(2, '0')}${minutes.toFixed(4).padStart(7, '0')}`, hemisphere };
}

function lngField(value) {
  const hemisphere = value < 0 ? 'W' : 'E';
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return { field: `${String(degrees).padStart(3, '0')}${minutes.toFixed(4).padStart(7, '0')}`, hemisphere };
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    time: `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`,
    date: `${p(date.getUTCDate())}${p(date.getUTCMonth() + 1)}${String(date.getUTCFullYear()).slice(2)}`
  };
}

let lat = LAT;
let lng = LNG;

function fix() {
  if (JITTER > 0) {
    lat += ((Math.random() - 0.5) * JITTER) / 111320;
    lng += ((Math.random() - 0.5) * JITTER) / (111320 * Math.cos((lat * Math.PI) / 180));
  }
  const now = new Date();
  const t = stamp(now);
  const la = latField(lat);
  const lo = lngField(lng);

  const ggaBody = `GPGGA,${t.time},${la.field},${la.hemisphere},${lo.field},${lo.hemisphere},1,${String(
    SATS
  ).padStart(2, '0')},${HDOP.toFixed(1)},1820.0,M,0.0,M,,`;
  const rmcBody = `GPRMC,${t.time},A,${la.field},${la.hemisphere},${lo.field},${lo.hemisphere},0.4,84.4,${t.date},0.0,E,A`;

  process.stdout.write(`$${ggaBody}${checksum(ggaBody)}\r\n`);
  process.stdout.write(`$${rmcBody}${checksum(rmcBody)}\r\n`);
}

console.log = () => {}; // keep stdout clean for the pipe
process.stderr.write(
  `[simulator] ${LAT}, ${LNG} · ${SATS} sats · HDOP ${HDOP} · ${INTERVAL} ms · jitter ${JITTER} m\n`
);

fix();
setInterval(fix, INTERVAL);
