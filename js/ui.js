// Small DOM helpers shared by every part of the interface: elements, icons, buttons, names, the toast.
import { splitTail } from './format.js';

export const $ = id => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Icons, drawn like the header's: 24×24, 1.8 px lines.
const PATHS = {
  note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  doc: '<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wave: '<path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  up: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
  lib: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.6 1-4 15-3.6-1z"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spin: '<path d="M12 3a9 9 0 1 0 9 9"/>'
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[name] || '';
  return s;
}

// A file name on one line, cut in the middle so its end stays in sight. The whole name shows on hover.
export function midName(name, cls) {
  const [head, tail] = splitTail(name);
  const box = el('span', 'mn' + (cls ? ' ' + cls : ''));
  box.title = name;
  if (head) box.append(el('span', 'mn-h', head));
  box.append(el('span', 'mn-t', tail));
  return box;
}

// A button for the notice bar or the empty screen.
export function nbtn(text, onClick, primary) {
  const b = el('button', 'btn' + (primary ? ' primary' : ''), text);
  b.type = 'button';
  b.onclick = onClick;
  return b;
}
// A button that carries a file name ("Usar charla.mp3"): it has a maximum width and cuts the name in the middle.
export function nameBtn(prefix, name, onClick) {
  const b = el('button', 'btn name');
  b.type = 'button'; b.title = `${prefix} ${name}`;
  b.append(el('span', '', prefix), midName(name));
  b.onclick = onClick;
  return b;
}

let toastTimer;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 4200);
}
