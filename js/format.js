// Formatting and small pure helpers. No DOM here: the tests load this file in Node.

export const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

// 75.4 → "1:15"; 3725 → "1:02:05".
export function fmt(s) {
  s = Math.max(0, s || 0);
  const h = s / 3600 | 0, m = (s % 3600) / 60 | 0;
  return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
}

// SRT timecode: 75.4 → "00:01:15,400". Rounded to the millisecond first: 3661.1 % 1 is 0.0999…, which
// would otherwise come out as ",099".
export function fmtTC(s) {
  const t = Math.round(Math.max(0, s) * 1000);
  return pad(t / 3600000) + ':' + pad(t % 3600000 / 60000) + ':' + pad(t % 60000 / 1000) + ',' + pad(t % 1000, 3);
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const mb = n => n >= 1e9 ? (n / 1e9).toLocaleString('es', { maximumFractionDigits: 1 }) + ' GB' : Math.round(n / 1e6) + ' MB';

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
// "hace 5 minutos", "ayer"…
export function ago(ts, nowMs = Date.now()) {
  const s = (ts - nowMs) / 1000;
  const steps = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [Infinity, 'month', 2629800]];
  for (const [lim, unit, div] of steps) if (Math.abs(s) < lim) return unit === 'second' ? 'hace un momento' : rtf.format(Math.round(s / div), unit);
  return '';
}

// Short stable id for a string (FNV-1a plus the length). Text and audio ids are built from it, so it must never change.
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);

// A long file name on one line is cut in the middle, so its end stays in sight:
// "How_God_Inspires_Imperfect_Human_Writers.m4a" → ["How_God_Inspires_Imperfect_Human_", "Writers.m4a"].
// The tail (never cut) is the last word after _ - or a space, with the extension; a very short last word
// ("v2", "12") brings the one before it; a word too long for that gives the last 8 characters instead.
export function splitTail(name) {
  name = String(name ?? '');
  const ext = (name.match(/\.[a-z0-9]{1,5}$/i) || [''])[0];
  const base = name.slice(0, name.length - ext.length);
  const parts = base.match(/[^_\-\s]+[_\-\s]*|[_\-\s]+/g) || [];
  let tail = parts.pop() || '';
  if (tail.length < 4 && parts.length) tail = parts.pop() + tail;
  if (tail.length > 16) tail = base.slice(-8);
  return [base.slice(0, base.length - tail.length), tail + ext];
}
