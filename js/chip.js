// The chip in the header: the audio and text on screen. It opens a menu with the audio's other texts and
// ways to change them: under the chip on wide screens, as a sheet from the bottom on phones.
import { state } from './state.js';
import { $, el, icon, midName } from './ui.js';
import { fmt, plural } from './format.js';
import { audioDuration, loadedFile, loadedKey } from './player.js';
import { progress, textLabel } from './library/data.js';
import { Store } from './library/texts.js';
import { openFromLib, openLib } from './library/panel.js';
import { togglePanel } from './settings.js';
import { TX } from './transcribe/run.js';
import { openTx } from './transcribe/dialog.js';

// What the chip says: the audio (and which of its texts is open), a text with no audio, or what to choose.
function describe() {
  const f = loadedFile(), m = state.currentMeta;
  if (f) {
    const n = Store.textsFor(loadedKey()).length;
    const line = TX.live ? 'Transcribiendo… el texto aparece a medida que avanza'
      : m ? `Texto: ${textLabel(m)}` + (n > 1 ? ` · ${n} textos` : '')
      : n ? `${plural(n, 'texto', 'textos')} · elige cuál leer` : 'Sin texto todavía';
    return { ic: 'note', name: f.name, line };
  }
  // A text with no audio: a transcription is known by its audio's name and model, an SRT by its file.
  if (m) {
    const label = textLabel(m), whisper = label.startsWith('Whisper');
    return { ic: 'doc', name: whisper ? m.name : m.file || m.name, line: whisper ? `${label} · sin audio` : 'Sin audio' };
  }
  return { ic: 'plus', name: state.cues.length ? 'Texto de ejemplo' : 'Elegir audio y texto', line: 'Elige un audio y su SRT, o arrástralos aquí' };
}

export function updateChip() {
  const d = describe(), chip = $('chip');
  $('chipIc').replaceChildren(icon(d.ic));
  $('chipName').replaceChildren(midName(d.name));
  $('chipSub').textContent = d.line;
  chip.title = d.name;
  chip.setAttribute('aria-label', `${d.name}. ${d.line}. Cambiar`);
  // With nothing on screen the empty screen has its own buttons.
  chip.hidden = !loadedFile() && !state.currentMeta && !state.cues.length;
  if (chip.hidden) closeMenu();
  else if (!$('menu').hidden) renderMenu();
}

function item(cls, onClick) {
  const b = el('button', 'mi' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.onclick = () => { closeMenu(); onClick(); };
  return b;
}

function renderMenu() {
  const box = $('menu'), f = loadedFile(), m = state.currentMeta;
  const texts = f ? Store.textsFor(loadedKey()) : [];
  box.textContent = '';
  box.append(el('span', 'grab'));
  // The sheet's title on phones: the whole name, in up to two lines.
  const d = describe(), hd = el('div', 'menu-hd'), dur = f && audioDuration();
  const sub = f ? [dur ? fmt(dur) : '', texts.length ? plural(texts.length, 'texto', 'textos') : 'sin texto todavía'].filter(Boolean).join(' · ') : d.line;
  hd.append(el('strong', 'clamp2', d.name), el('span', '', sub));
  box.append(hd);

  if (texts.length) {
    box.append(el('div', 'menu-lbl', 'Textos de este audio'));
    const list = el('div', 'menu-list');
    for (const t of texts) {
      const cur = t.id === state.currentId;
      const b = item(cur ? '' : 'pad', () => openFromLib(t));
      if (cur) { b.setAttribute('aria-current', 'true'); const c = icon('check'); c.classList.add('mi-check'); b.append(c); }
      b.append(midName(textLabel(t), 'mi-nm'), el('span', 'mi-mt', progress(t, null)));
      list.append(b);
    }
    box.append(list, el('div', 'menu-sep'));
  }
  const add = (list, ic, label, fn) => { const b = item('act', fn); b.append(icon(ic), el('span', 'mi-nm', label)); list.append(b); };
  const one = el('div', 'menu-list');
  if (f && !TX.running) add(one, 'wave', texts.length ? 'Transcribir con otro modelo' : 'Transcribir con Whisper', openTx);
  add(one, 'doc', m || texts.length ? 'Elegir otro SRT…' : 'Elegir SRT…', () => $('inSrt').click());
  add(one, 'swap', f ? 'Cambiar de audio…' : 'Elegir audio…', () => $('inAudio').click());
  const two = el('div', 'menu-list hide-sm');
  add(two, 'lib', 'Abrir la biblioteca', openLib);
  box.append(one, el('div', 'menu-sep'), two);
}

// Under the chip, centered on it and kept inside the window. On phones CSS makes it a sheet.
function place() {
  const box = $('menu');
  if (innerWidth < 620) { box.style.left = box.style.top = ''; return; }
  const r = $('chip').getBoundingClientRect(), w = box.offsetWidth;
  box.style.top = Math.round(r.bottom + 8) + 'px';
  box.style.left = Math.round(Math.max(16, Math.min(innerWidth - w - 16, r.left + r.width / 2 - w / 2))) + 'px';
}

export function openMenu(fromKeyboard) {
  togglePanel(false);
  renderMenu();
  $('menu').hidden = false;
  $('chip').setAttribute('aria-expanded', 'true');
  place();
  // Opened from the keyboard: move into the menu.
  const first = $('menu').querySelector('.mi');
  if (first && fromKeyboard) first.focus({ preventScroll: true });
}
export function closeMenu() {
  if ($('menu').hidden) return;
  $('menu').hidden = true;
  $('chip').setAttribute('aria-expanded', 'false');
}

export function initChip() {
  $('chip').onclick = e => { e.stopPropagation(); $('menu').hidden ? openMenu(e.detail === 0) : closeMenu(); };
  document.addEventListener('pointerdown', e => {
    if (!$('menu').hidden && !e.target.closest('#menu,#chip,#scrim')) closeMenu();
  });
  addEventListener('resize', () => { if (!$('menu').hidden) place(); });
}
