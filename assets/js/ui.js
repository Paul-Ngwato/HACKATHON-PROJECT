/**
 * AttendEase — UI toolkit: icons, formatters, charts, toasts, modals, CSV.
 * No dependencies; every chart is inline SVG so it renders instantly offline.
 */

import { riskFor, round1 } from './analytics.js';

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const ICONS = {
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><path d="M14 14h3v3h-3zM21 14v3M17.5 20.5H21M14 20.5h1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 1.9"/>',
  chart: '<path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.6 20a6.4 6.4 0 0 1 12.8 0"/><path d="M16.5 4.6a3.4 3.4 0 0 1 0 6.8"/><path d="M18.4 14.9c1.9.7 3 2.3 3 5.1"/>',
  alert: '<path d="M10.3 3.9 2.5 18a1.6 1.6 0 0 0 1.4 2.4h16.2a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/><path d="M12 9v4.2M12 17h.01"/>',
  play: '<path d="M8 4.8v14.4a.8.8 0 0 0 1.2.7l11-7.2a.8.8 0 0 0 0-1.4l-11-7.2A.8.8 0 0 0 8 4.8Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.4" fill="currentColor" stroke="none"/>',
  bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  pin: '<path d="M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5Z"/><circle cx="12" cy="10" r="2.6"/>',
  logout: '<path d="M15 17l5-5-5-5M20 12H9M12 3H5v18h7"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.4-5.9"/><path d="M20.5 4.5V10h-5.5"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.4-4.4"/>',
  download: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16"/>',
  shield: '<path d="M12 3.2 20 6v6c0 4.9-3.4 7.9-8 8.8-4.6-.9-8-3.9-8-8.8V6Z"/><path d="m8.7 11.9 2.3 2.3 4.3-4.3"/>',
  scan: '<path d="M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M20 8.5V5.5A1.5 1.5 0 0 0 18.5 4h-3M4 15.5v3A1.5 1.5 0 0 0 5.5 20h3M20 15.5v3A1.5 1.5 0 0 1 18.5 20h-3M7.5 12h9"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  key: '<circle cx="8" cy="15" r="4.2"/><path d="m11 12 9-9M17 5.5 19.5 8M14.5 8 17 10.5"/>',
  trending: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4 3.3-6.2 7.5-6.2s7.5 2.2 7.5 6.2"/>',
  map: '<path d="M9 4 3 6.2v13.6L9 17.6l6 2.2 6-2.2V4l-6 2.2Z"/><path d="M9 4v13.6M15 6.2v13.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  satellite: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a6 6 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1.1"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 20h16"/>'
};

export function icon(name, size = 18) {
  const body = ICONS[name] || ICONS.info;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function clamp(v, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(v) ? v : 0));
}

export function pctText(value) {
  return `${round1(value)}%`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

export function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return fmtDate(iso);
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function avatar(name, tone = '', extra = '') {
  return `<div class="avatar ${tone} ${extra}">${esc(initials(name))}</div>`;
}

export function toneForPct(value) {
  return value < 70 ? 'red' : value < 80 ? 'amber' : 'green';
}

export function attendancePill(value) {
  const risk = riskFor(value);
  return `<span class="pill ${risk.pill}"><span class="dot"></span>${risk.label}</span>`;
}

export function statusPill(status) {
  if (status === 'present') return '<span class="pill pill-green">Present</span>';
  if (status === 'late') return '<span class="pill pill-amber">Late</span>';
  if (status === 'absent') return '<span class="pill pill-red">Absent</span>';
  return `<span class="pill">${esc(status)}</span>`;
}

export function methodLabel(method) {
  if (method === 'ble') return 'Session code';
  if (method === 'qr') return 'QR scan';
  if (method === 'code') return 'Session code + GPS';
  return esc(method || '—');
}

/* ------------------------------------------------------------------ */
/* Progress + charts                                                   */
/* ------------------------------------------------------------------ */

export function progress(value, tone) {
  const t = tone || toneForPct(value);
  return `<div class="progress ${t}"><i style="width:${clamp(value)}%"></i></div>`;
}

export function ring(value, opts = {}) {
  const size = opts.size || 56;
  const stroke = opts.stroke || 5;
  const tone = opts.tone || toneForPct(value);
  const colors = { green: '#0ea978', amber: '#d97706', red: '#e0322f', brand: '#5b5ef0' };
  const color = colors[tone] || colors.brand;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamp(value) / 100);
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef1f8" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
    </svg>
    <div class="ring-label"><div class="ring-value">${Math.round(value)}<small>%</small></div></div>
  </div>`;
}

let chartUid = 0;

export function areaChart(points, opts = {}) {
  const data = (points || []).filter((p) => p && Number.isFinite(p.value));
  if (data.length < 2) {
    return '<div class="empty">Not enough sessions to plot a trend yet.</div>';
  }
  const W = 640;
  const H = opts.height || 220;
  const pad = { t: 16, r: 16, b: 28, l: 36 };
  const tone = opts.tone || 'brand';
  const colors = { brand: '#5b5ef0', green: '#0ea978', amber: '#d97706', red: '#e0322f' };
  const color = colors[tone] || colors.brand;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (i / (data.length - 1)) * iw;
  const y = (v) => pad.t + ih - (clamp(v) / 100) * ih;
  const pts = data.map((d, i) => ({ ...d, x: x(i), y: y(d.value) }));

  let line = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const mid = (prev.x + cur.x) / 2;
    line += ` C ${mid.toFixed(1)} ${prev.y.toFixed(1)}, ${mid.toFixed(1)} ${cur.y.toFixed(1)}, ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
  }
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${(pad.t + ih).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(pad.t + ih).toFixed(1)} Z`;

  const gid = `area-${++chartUid}`;
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line x1="${pad.l}" y1="${y(v)}" x2="${W - pad.r}" y2="${y(v)}" stroke="#eef2f8" stroke-width="1"/>` +
        `<text x="${pad.l - 8}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="#94a3b8">${v}</text>`
    )
    .join('');

  const dots = pts
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4" fill="#fff" stroke="${color}" stroke-width="2"><title>${esc(p.label)}: ${round1(p.value)}%</title></circle>`
    )
    .join('');

  const step = Math.ceil(data.length / 6);
  const labels = pts
    .map((p, i) =>
      i % step === 0 || i === pts.length - 1
        ? `<text x="${p.x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#64748b">${esc(p.label)}</text>`
        : ''
    )
    .join('');

  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Attendance trend')}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
    ${dots}${labels}
  </svg></div>`;
}

export function barChart(items, opts = {}) {
  const data = (items || []).filter(Boolean);
  if (!data.length) return '<div class="empty">No data yet.</div>';
  const W = 640;
  const H = opts.height || 190;
  const pad = { t: 22, r: 14, b: 26, l: 14 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = opts.max || Math.max(100, ...data.map((d) => d.value)) || 100;
  const slot = iw / data.length;
  const bw = Math.min(54, slot * 0.56);
  const color = opts.colorFor || ((d) => (d.tone === 'red' ? '#e0322f' : d.tone === 'amber' ? '#d97706' : '#5b5ef0'));

  const bars = data
    .map((d, i) => {
      const h = (clamp(d.value, 0, max) / max) * ih;
      const bx = pad.l + slot * i + (slot - bw) / 2;
      const by = pad.t + ih - h;
      return `<g><rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="5" fill="${color(d)}"><title>${esc(d.label)}: ${round1(d.value)}${opts.unit || '%'}</title></rect>
      <text x="${(bx + bw / 2).toFixed(1)}" y="${(by - 6).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">${Math.round(d.value)}${opts.unit || ''}</text>
      <text x="${(bx + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#64748b">${esc(d.label)}</text></g>`;
    })
    .join('');

  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Attendance by category')}" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}" stroke="#e7ecf5" stroke-width="1"/>${bars}
  </svg></div>`;
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function toast(title, opts = {}) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast${opts.tone ? ' toast-' + opts.tone : ''}`;
  const ic = opts.tone === 'error' || opts.tone === 'warn' ? 'alert' : 'check';
  el.innerHTML = `<span class="ic">${icon(ic, 16)}</span><div><strong>${esc(title)}</strong>${
    opts.message ? `<div class="msg">${esc(opts.message)}</div>` : ''
  }</div>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, opts.duration || 4400);
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function modal({ title, sub = '', body = '', footer = '', onMount, onClose, width }) {
  const root = document.getElementById('modal-root');
  if (!root) return { close() {} };
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"${width ? ` style="max-width:${width}px"` : ''}>
    <div class="modal-head">
      <div class="modal-title">${esc(title)}</div>
      ${sub ? `<div class="modal-sub">${esc(sub)}</div>` : ''}
      <button class="modal-x" type="button" aria-label="Close">×</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  root.appendChild(wrap);

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  function close() {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) {
      try {
        onClose();
      } catch (err) {
        console.warn('[AttendSmart] modal cleanup failed', err);
      }
    }
  }
  document.addEventListener('keydown', onKey);
  const closeButton = wrap.querySelector('.modal-x');
  if (closeButton) closeButton.addEventListener('click', close);
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) close();
  });
  if (onMount) onMount(wrap, close);
  return { root: wrap, close };
}

/* ------------------------------------------------------------------ */
/* Clipboard + CSV                                                     */
/* ------------------------------------------------------------------ */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function downloadCSV(filename, headers, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function countdownText(ms) {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export { riskFor };
