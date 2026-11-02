// Small DOM helpers shared by every part of the interface.

export const $ = id => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A button for the notice bar or the empty screen.
export function nbtn(text, onClick, primary) {
  const b = el('button', 'nbtn' + (primary ? ' primary' : ''), text);
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
