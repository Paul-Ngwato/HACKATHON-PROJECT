/**
 * AttendSmart AI - zero-dependency static file server.
 *
 * Browsers only expose the Geolocation API on a secure context. `http://localhost`
 * counts as secure, so serving over loopback keeps live GPS working during a demo.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
// Some runners export PORT=0 to mean "pick any free port". This demo needs a
// predictable URL for the preview and for the BT-821C bridge docs, so ignore
// non-positive values and stay on 4173 unless a real port is requested.
const envPort = Number(process.env.PORT);
const PORT = Number.isFinite(envPort) && envPort > 0 ? envPort : 4173;
const HOST = process.env.HOST && process.env.HOST !== '0.0.0.0' ? process.env.HOST : '127.0.0.1';

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

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, path.normalize(pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`AttendSmart AI running at http://localhost:${PORT}`);
});
