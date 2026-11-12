/**
 * CLASSPREF3CT — shared backend + static server.
 *
 * One process owns the SQLite database that both Android apps talk to:
 *
 *   lecturer phone ─┐
 *                   ├── Wi-Fi ──▶ http://<laptop>:4173 ──▶ data/attendsmart.db
 *   student phone  ─┘
 *
 * The server is authoritative: it creates sessions, allocates the 4-digit
 * code, validates check-ins and pushes a change event to every connected
 * client so the lecturer's live roster updates without polling.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const { connect, loadState, revisionOf } = require('./server/db.cjs');
const domain = require('./server/domain.cjs');

const ROOT = __dirname;
const DB_FILE = process.env.CLASSPREF3CT_DB || process.env.CLASSPREF3CT_DB || process.env.ATTENDEASE_DB || process.env.ATTENDSMART_DB || path.join(ROOT, 'data', 'attendsmart.db');
const envPort = Number(process.env.PORT);
const PORT = Number.isFinite(envPort) && envPort > 0 ? envPort : 4173;
const HOST = process.env.HOST || '0.0.0.0';

const db = connect(DB_FILE);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const BLOCKED = new Set(['data', 'server', 'node_modules', '.git', '.dev', '.toolchain']);

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function sendJson(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff'
  };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const zipped = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = zipped.length;
    res.writeHead(status, headers);
    res.end(zipped);
    return;
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new domain.ApiError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new domain.ApiError(400, 'Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Live updates (Server-Sent Events)                                   */
/* ------------------------------------------------------------------ */

const clients = new Set();

/** Push one frame to every open page. */
function broadcastNow() {
  const revision = revisionOf(db);
  const frame = `event: state\ndata: ${JSON.stringify({ revision })}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch (err) {
      clients.delete(res);
    }
  }
}

let broadcastTimer = null;

/**
 * A whole class posts inside a few seconds. Writing a frame per post would
 * mean one SSE frame per student, and one full-state pull per frame on every
 * phone — the burst itself would be the delay. Bursts collapse into a single
 * frame instead, still well under the time a lecturer can notice.
 */
function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastNow();
  }, 150);
  if (broadcastTimer.unref) broadcastTimer.unref();
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });
  res.write(`retry: 2000\n\n`);
  res.write(`event: state\ndata: ${JSON.stringify({ revision: revisionOf(db) })}\n\n`);
  clients.add(res);

  const ping = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (err) {
      clearInterval(ping);
      clients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

// Expired windows close even when nobody is making requests, so the lecturer's
// countdown and roster agree with the server without a refresh.
setInterval(() => {
  try {
    if (domain.sweepExpired(db)) broadcast();
  } catch (err) {
    console.error('[CLASSPREF3CT] sweep failed', err);
  }
}, 15000).unref();

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  if (route === 'GET /api/health') {
    sendJson(req, res, 200, {
      ok: true,
      revision: revisionOf(db),
      time: new Date().toISOString(),
      database: path.basename(DB_FILE)
    });
    return;
  }

  if (route === 'GET /api/state') {
    sendJson(req, res, 200, { ok: true, state: loadState(db) });
    return;
  }

  if (route === 'GET /api/events') {
    handleEvents(req, res);
    return;
  }

  if (route === 'GET /api/sessions/lookup') {
    const result = domain.lookupSession(db, {
      code: url.searchParams.get('code'),
      studentId: url.searchParams.get('studentId')
    });
    sendJson(req, res, 200, { ok: true, result, state: loadState(db) });
    return;
  }

  if (req.method === 'POST') {
    const body = await readBody(req);

    switch (url.pathname) {
      case '/api/sessions/start': {
        const session = domain.startSession(db, {
          courseId: body.courseId,
          lecturerId: body.actorId,
          durationMin: body.durationMin,
          lat: body.lat,
          lng: body.lng,
          accuracy: body.accuracy,
          radius: body.radius
        });
        broadcast();
        sendJson(req, res, 200, { ok: true, result: session, state: loadState(db) });
        return;
      }
      case '/api/sessions/end': {
        const session = domain.endSession(db, body.sessionId, body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: session, state: loadState(db) });
        return;
      }
      case '/api/sessions/rotate': {
        const session = domain.rotateCode(db, body.sessionId, body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: session, state: loadState(db) });
        return;
      }
      case '/api/checkin': {
        const result = domain.checkIn(db, {
          code: body.code,
          studentId: body.studentId,
          deviceId: body.deviceId,
          lat: body.lat,
          lng: body.lng,
          accuracy: body.accuracy,
          method: body.method || 'code'
        });
        // Deliberately no full snapshot in this reply: eighty-five students
        // posting at once would serialise the whole database once per student.
        // The client refreshes from the coalesced live event instead.
        broadcast();
        sendJson(req, res, 200, { ok: true, result, revision: revisionOf(db) });
        return;
      }
      case '/api/courses/create': {
        const course = domain.createCourse(db, body, body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: course, state: loadState(db) });
        return;
      }
      case '/api/courses/setup': {
        const course = domain.updateCourseSetup(db, body.courseId, body.patch || {}, body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: course, state: loadState(db) });
        return;
      }
      case '/api/courses/roster': {
        const course = domain.setCourseRoster(db, body.courseId, body.studentIds || [], body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: course, state: loadState(db) });
        return;
      }
      case '/api/courses/finalize': {
        const course = domain.finalizeCourseRoster(db, body.courseId, body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: course, state: loadState(db) });
        return;
      }
      case '/api/courses/import': {
        const result = domain.importRoster(db, body.courseId, body.entries || [], body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result, state: loadState(db) });
        return;
      }
      case '/api/courses/venue': {
        const hall = domain.setCourseVenue(db, body.courseId, {
          lat: body.lat,
          lng: body.lng,
          accuracy: body.accuracy,
          radius: body.radius
        }, body.actorId);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: hall, state: loadState(db) });
        return;
      }
      case '/api/admin/reset': {
        if (body.actorId !== 'a1') throw new domain.ApiError(403, 'Only the administrator can reset demo data.');
        const state = domain.reset(db);
        broadcast();
        sendJson(req, res, 200, { ok: true, result: { reset: true }, state });
        return;
      }
      default:
        sendJson(req, res, 404, { ok: false, error: `Unknown endpoint: ${url.pathname}` });
        return;
    }
  }

  sendJson(req, res, 404, { ok: false, error: `Unknown endpoint: ${route}` });
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  let filePath = path.join(ROOT, path.normalize(pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const relative = path.relative(ROOT, filePath);
  const first = relative.split(path.sep)[0];
  if (BLOCKED.has(first) || relative.split(path.sep).some((part) => part.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        if (pathname !== '/index.html') {
          // Single-page shells: unknown paths fall back to index.html.
          const fallback = path.join(ROOT, 'index.html');
          fs.readFile(fallback, (fbErr, fb) => {
            if (fbErr) {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Not found: ' + pathname);
              return;
            }
            writeAsset(req, res, '/index.html', fb);
          });
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found: ' + pathname);
        return;
      }
      writeAsset(req, res, pathname, data);
    });
  });
}

function writeAsset(req, res, pathname, data) {
  const ext = path.extname(pathname).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  };

  if (data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '') &&
      /^(text\/|application\/(json|manifest\+json)|image\/svg)/.test(headers['Content-Type'])) {
    const zipped = zlib.gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = zipped.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : zipped);
    return;
  }

  headers['Content-Length'] = data.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : data);
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname || '/');
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      const status = err instanceof domain.ApiError ? err.status : 500;
      if (status === 500) console.error('[CLASSPREF3CT] API error', err);
      sendJson(req, res, status, { ok: false, error: err.message || 'Server error', ...(err.extra || {}) });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

// Many phones at once: keep sockets reusable and raise the listener backlog so
// a class all posting together is not throttled by connection churn.
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.maxConnections = 512;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  CLASSPREF3CT — shared backend running');
  console.log(`  Database : ${DB_FILE}`);
  console.log(`  Local    : http://localhost:${PORT}`);
  for (const address of lanAddresses()) {
    console.log(`  Network  : http://${address}:${PORT}   ← use this on the phones`);
    console.log(`  BT bridge: http://${address}:4190/fix   ← start tools/bt821c-bridge.js --host 0.0.0.0`);
  }
  console.log('');
});

function shutdown() {
  try { db.close(); } catch (err) { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
