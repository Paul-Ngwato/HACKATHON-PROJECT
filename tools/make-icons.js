#!/usr/bin/env node
/**
 * AttendSmart AI — home-screen icons.
 *
 * Zero dependencies: draws every icon from signed-distance shapes, rasterises it
 * with 4x4 supersampling and writes a real PNG using Node's own zlib. Run
 * `node tools/make-icons.js` after changing the accent colours or the glyphs.
 *
 * Student  -> green check.   Lecturer -> blue presentation board.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets', 'icons');
const BG = [0x0b, 0x12, 0x20];
const ACCENT = {
  student: [0x14, 0xb8, 0x8a],
  lecturer: [0x4f, 0x8c, 0xff]
};

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ */
/* Shapes in unit space (0..1)                                         */
/* ------------------------------------------------------------------ */

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function pointInTriangle(px, py, a, b, c) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function glyphInk(px, py, glyph, scale) {
  const gx = (px - 0.5) / scale + 0.5;
  const gy = (py - 0.5) / scale + 0.5;

  if (glyph === 'check') {
    const stroke = 0.055;
    const d = Math.min(
      segDist(gx, gy, 0.255, 0.525, 0.442, 0.708),
      segDist(gx, gy, 0.442, 0.708, 0.768, 0.322)
    );
    return d <= stroke ? 1 : 0;
  }

  if (glyph === 'board') {
    const outline = Math.abs(sdRoundRect(gx, gy, 0.5, 0.47, 0.305, 0.23, 0.075)) - 0.027;
    if (outline <= 0) return 1;
    return pointInTriangle(gx, gy, [0.432, 0.372], [0.432, 0.568], [0.612, 0.47]) ? 1 : 0;
  }

  return 0;
}

/* ------------------------------------------------------------------ */
/* Raster                                                              */
/* ------------------------------------------------------------------ */

function render(size, accent, glyph, options) {
  const opts = options || {};
  const fullBleed = !!opts.fullBleed;
  const transparent = !!opts.transparent;
  const glyphScale = opts.glyphScale || 1;
  const radius = 0.235;
  const SS = 4;
  const samples = SS * SS;
  const buf = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plate = 0;
      let ink = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          const inside = transparent || fullBleed || sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, radius) <= 0;
          if (!inside) continue;
          plate += 1;
          ink += glyphInk(px, py, glyph, glyphScale);
        }
      }
      plate /= samples;
      ink /= samples;

      // Adaptive-icon foregrounds are a transparent glyph on the launcher's own
      // colour layer, so the plate is dropped and the glyph supplies the alpha.
      if (transparent) {
        const i0 = (y * size + x) * 4;
        buf[i0] = accent[0];
        buf[i0 + 1] = accent[1];
        buf[i0 + 2] = accent[2];
        buf[i0 + 3] = Math.round(ink * 255);
        continue;
      }

      const alpha = Math.round(plate * 255);
      const mix = plate > 0 ? Math.min(1, ink / plate) : 0;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(BG[0] + (accent[0] - BG[0]) * mix);
      buf[i + 1] = Math.round(BG[1] + (accent[1] - BG[1]) * mix);
      buf[i + 2] = Math.round(BG[2] + (accent[2] - BG[2]) * mix);
      buf[i + 3] = alpha;
    }
  }

  return encodePng(size, size, buf);
}

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

fs.mkdirSync(OUT, { recursive: true });

const JOBS = [
  ['student', 'check', 'student-192.png', 192, {}],
  ['student', 'check', 'student-512.png', 512, {}],
  ['student', 'check', 'student-maskable-512.png', 512, { fullBleed: true, glyphScale: 0.72 }],
  ['student', 'check', 'student-apple-180.png', 180, { fullBleed: true, glyphScale: 0.82 }],
  ['lecturer', 'board', 'lecturer-192.png', 192, {}],
  ['lecturer', 'board', 'lecturer-512.png', 512, {}],
  ['lecturer', 'board', 'lecturer-maskable-512.png', 512, { fullBleed: true, glyphScale: 0.72 }],
  ['lecturer', 'board', 'lecturer-apple-180.png', 180, { fullBleed: true, glyphScale: 0.82 }]
];

/* ------------------------------------------------------------------ */
/* Android launcher icons                                              */
/* ------------------------------------------------------------------ */

const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4]
];

function emitAndroid(appKey, glyph) {
  const res = path.join(__dirname, '..', 'native', appKey, 'android', 'app', 'src', 'main', 'res');
  if (!fs.existsSync(res)) {
    console.log('skip native launcher icons for ' + appKey + ' (no android project)');
    return;
  }

  for (const [density, scale] of DENSITIES) {
    const dir = path.join(res, 'mipmap-' + density);
    fs.mkdirSync(dir, { recursive: true });
    // Legacy launcher icon (pre-Android 8) and its round variant.
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), render(Math.round(48 * scale), ACCENT[appKey], glyph, { glyphScale: 0.88 }));
    fs.writeFileSync(
      path.join(dir, 'ic_launcher_round.png'),
      render(Math.round(48 * scale), ACCENT[appKey], glyph, { fullBleed: true, glyphScale: 0.7 })
    );
    // Adaptive foreground: transparent, sitting inside the 66% safe zone.
    fs.writeFileSync(
      path.join(dir, 'ic_launcher_foreground.png'),
      render(Math.round(108 * scale), ACCENT[appKey], glyph, { transparent: true, glyphScale: 0.62 })
    );
  }

  console.log('native launcher icons: native/' + appKey + '/android/app/src/main/res');
}

for (const job of JOBS) {
  const app = job[0];
  const glyph = job[1];
  const file = job[2];
  const size = job[3];
  const opts = job[4];
  const png = render(size, ACCENT[app], glyph, opts);
  fs.writeFileSync(path.join(OUT, file), png);
  console.log(file + '  ' + size + 'x' + size + '  ' + png.length + ' bytes');
}

emitAndroid('student', 'check');
emitAndroid('lecturer', 'board');
