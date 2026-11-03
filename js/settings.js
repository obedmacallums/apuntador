// The viewer's settings (saved in this browser), the appearance (themes and accent), and the Ajustes panel.
import { $, el } from './ui.js';
import { syncRate } from './player.js';
import { markDirty, recenter, renderSegs, resetKaraoke } from './prompter.js';
import { deviceInfo, describeDevice } from './transcribe/device.js';
import { closeMenu } from './chip.js';

export const RATES = [0.75, 1, 1.25, 1.5, 2];
// Appearance: mode 'auto' follows the device's light or dark mode; 'claro' and 'oscuro' fix it.
// light is the day theme and dark the night one; accent colors the current line, buttons and switches.
const LIGHTS = { claro: 'Claro', papel: 'Papel' };
const DARKS = { oscuro: 'Oscuro', medianoche: 'Medianoche' };
const ACCENTS = { azul: 'Azul', indigo: 'Índigo', turquesa: 'Turquesa', naranja: 'Naranja', rosa: 'Rosa', mono: 'Mono' };
const MODE_NOTES = {
  auto: 'Cambia solo con el modo claro u oscuro de tu dispositivo.',
  claro: 'Siempre el tema de día, aunque el dispositivo esté en modo oscuro.',
  oscuro: 'Siempre el tema de noche, aunque el dispositivo esté en modo claro.'
};
const defaults = { fs: innerWidth < 620 ? 30 : 44, karaoke: true, mirror: false, rate: 1, offset: 0, txWords: true,
  mode: 'auto', light: 'papel', dark: 'oscuro', accent: 'azul', word: 'suave' };
// Also kept here: txModel and txLang (last choices for transcribing), txDevice ('auto' | 'gpu' | 'cpu')
// and gpuFailed (the GPU failed in Auto mode, so Auto uses the CPU until the viewer picks a mode again).
export const S = { ...defaults };
try { Object.assign(S, JSON.parse(localStorage.getItem('apuntador') || '{}')); } catch (e) {}
if (!RATES.includes(S.rate)) S.rate = 1;
if (!MODE_NOTES[S.mode]) S.mode = 'auto';
if (!LIGHTS[S.light]) S.light = 'papel';
if (!DARKS[S.dark]) S.dark = 'oscuro';
if (!ACCENTS[S.accent]) S.accent = 'azul';
if (!['suave', 'sub', 'fondo'].includes(S.word)) S.word = 'suave';   // how the word being said is marked
export function save() { try { localStorage.setItem('apuntador', JSON.stringify(S)); } catch (e) {} }

// How transcription should pick GPU or CPU.
export const txPrefs = () => ({ want: S.txDevice || 'auto', gpuFailed: !!S.gpuFailed });

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => S.mode === 'oscuro' || (S.mode === 'auto' && darkQuery.matches);

// Put the chosen theme on <html> (index.html did the same before the first paint), and tell the
// browser its color for the bars around the page.
function applyTheme() {
  const dark = isDark(), root = document.documentElement;
  const theme = 'th-' + (dark ? S.dark : S.light);
  [...root.classList].forEach(c => { if (/^(th|ac)-/.test(c)) root.classList.remove(c); });
  root.classList.add(theme, 'ac-' + S.accent);
  root.classList.toggle('dark', dark);
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) $('themeColor').setAttribute('content', bg);
}

// The theme previews and accent dots in Ajustes.
function themeCard(kind, key, label, dark) {
  const b = el('button', 'card');
  b.type = 'button'; b.dataset.k = key;
  b.onclick = () => { S[kind] = key; applySettings(); };
  const pv = el('span', 'pv');
  pv.dataset.t = key; pv.dataset.dark = dark ? '1' : '';
  pv.append(el('i'), el('i'), el('i'));
  b.append(pv, el('span', '', label));
  return b;
}
function renderAppearance() {
  const pressed = (box, key) => [...box.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.k === key));
  [...$('modeSeg').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.m === S.mode));
  for (const [box, key] of [[$('lightCards'), S.light], [$('darkCards'), S.dark]]) {
    pressed(box, key);
    box.querySelectorAll('.pv').forEach(pv => { pv.className = 'pv th-' + pv.dataset.t + ' ac-' + S.accent + (pv.dataset.dark ? ' dark' : ''); });
  }
  pressed($('accDots'), S.accent);
  pressed($('wordCards'), S.word);
  [...$('wordCards').children].forEach(b => b.disabled = !S.karaoke);
  $('modeNote').textContent = MODE_NOTES[S.mode];
}

export function applySettings() {
  applyTheme();
  renderAppearance();
  document.documentElement.style.setProperty('--fs', S.fs + 'px');
  $('fsOut').textContent = S.fs + ' px';
  $('cues').classList.toggle('karaoke', S.karaoke);
  document.documentElement.classList.toggle('w-sub', S.word === 'sub');
  document.documentElement.classList.toggle('w-fondo', S.word === 'fondo');
  $('main').classList.toggle('mirror', S.mirror);
  $('swKaraoke').setAttribute('aria-checked', S.karaoke);
  $('swMirror').setAttribute('aria-checked', S.mirror);
  $('mirBtn').setAttribute('aria-pressed', S.mirror);
  $('swWords').setAttribute('aria-checked', S.txWords);
  const r = S.rate.toLocaleString('es') + '×';
  $('rateLbl').textContent = r;
  $('rateBtn').setAttribute('aria-label', 'Velocidad: ' + r);
  [...$('rates').children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.r === S.rate));
  [...$('devSeg').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.d === (S.txDevice || 'auto')));
  $('offOut').textContent = (S.offset > 0 ? '+' : '') + S.offset.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';
  syncRate();
  save(); markDirty();
}

export function setFs(v) {
  S.fs = Math.max(18, Math.min(96, v));
  applySettings();
  requestAnimationFrame(() => recenter(true));
}
export function toggleMirror() { S.mirror = !S.mirror; applySettings(); }
function setOffset(v) { S.offset = Math.round(Math.max(-30, Math.min(30, v)) * 10) / 10; applySettings(); renderSegs(); }

export async function updateDevNote() {
  const dev = await deviceInfo(), prefs = txPrefs(), gpuBtn = $('devSeg').querySelector('[data-d="gpu"]');
  gpuBtn.disabled = !dev.gpu.ok && prefs.want !== 'gpu';
  gpuBtn.title = dev.gpu.ok ? 'Tarjeta gráfica (WebGPU)' + (dev.gpu.name ? ': ' + dev.gpu.name : '') : 'Este navegador no tiene WebGPU';
  $('devNote').textContent = describeDevice(dev, prefs);
}

// Ajustes opens under its header button on wide screens, or from the transport bar as a sheet on phones.
export function togglePanel(open) {
  const p = $('panel');
  open = open ?? p.hidden;
  if (open === !p.hidden) return;
  if (open) closeMenu();
  p.hidden = !open;
  $('setBtn').setAttribute('aria-expanded', open);
  $('setBtnSm').setAttribute('aria-expanded', open);
  if (open) { updateDevNote(); $('panel').querySelector('.panel-body').scrollTop = 0; }
}

export function initSettings() {
  RATES.forEach(r => {
    const b = el('button', '', r.toLocaleString('es') + '×');
    b.type = 'button'; b.dataset.r = r;
    b.onclick = () => { S.rate = r; applySettings(); };
    $('rates').append(b);
  });
  for (const [k, l] of Object.entries(LIGHTS)) $('lightCards').append(themeCard('light', k, l, false));
  for (const [k, l] of Object.entries(DARKS)) $('darkCards').append(themeCard('dark', k, l, true));
  for (const [k, l] of Object.entries(ACCENTS)) {
    const b = el('button', 'dot');
    b.type = 'button'; b.dataset.k = k; b.dataset.a = k; b.setAttribute('aria-label', l); b.title = l;
    b.append(el('span'));
    b.onclick = () => { S.accent = k; applySettings(); };
    $('accDots').append(b);
  }
  [...$('modeSeg').children].forEach(b => b.onclick = () => { S.mode = b.dataset.m; applySettings(); });
  darkQuery.addEventListener('change', () => { if (S.mode === 'auto') applySettings(); });

  $('fsDown').onclick = () => setFs(S.fs - 2);
  $('fsUp').onclick = () => setFs(S.fs + 2);
  $('offDown').onclick = () => setOffset(S.offset - 0.1);
  $('offUp').onclick = () => setOffset(S.offset + 0.1);
  $('swKaraoke').onclick = () => { S.karaoke = !S.karaoke; resetKaraoke(); applySettings(); };
  [...$('wordCards').children].forEach(b => b.onclick = () => { S.word = b.dataset.k; applySettings(); });
  $('swMirror').onclick = toggleMirror;
  $('mirBtn').onclick = toggleMirror;
  $('swWords').onclick = () => { S.txWords = !S.txWords; applySettings(); };
  $('rateBtn').onclick = () => { S.rate = RATES[(RATES.indexOf(S.rate) + 1) % RATES.length] || 1; applySettings(); };
  // Auto / GPU / CPU for transcription. Picking any mode again gives a graphics card that failed another chance.
  [...$('devSeg').children].forEach(b => b.onclick = () => { S.txDevice = b.dataset.d; S.gpuFailed = false; applySettings(); updateDevNote(); });
  $('setBtn').onclick = e => { e.stopPropagation(); togglePanel(); };
  $('setBtnSm').onclick = e => { e.stopPropagation(); togglePanel(); };
  $('setClose').onclick = () => togglePanel(false);
  $('setDone').onclick = () => togglePanel(false);
  // On wide screens Ajustes closes when you tap anywhere else; on phones the scrim does that.
  document.addEventListener('pointerdown', e => {
    if (!$('panel').hidden && !e.target.closest('#panel,#setBtn,#setBtnSm,#scrim')) togglePanel(false);
  });
}
