// The viewer's settings (saved in this browser) and the Ajustes panel.
import { $ } from './ui.js';
import { syncRate } from './player.js';
import { markDirty, recenter, renderSegs, resetKaraoke } from './prompter.js';
import { deviceInfo, describeDevice } from './transcribe/device.js';

export const RATES = [0.75, 1, 1.25, 1.5, 2];
const defaults = { fs: innerWidth < 620 ? 28 : 42, karaoke: true, mirror: false, rate: 1, offset: 0, txWords: true };
// Also kept here: txModel and txLang (last choices for transcribing), txDevice ('auto' | 'gpu' | 'cpu')
// and gpuFailed (the GPU failed in Auto mode, so Auto uses the CPU until the viewer picks a mode again).
export const S = { ...defaults };
try { Object.assign(S, JSON.parse(localStorage.getItem('apuntador') || '{}')); } catch (e) {}
if (!RATES.includes(S.rate)) S.rate = 1;
export function save() { try { localStorage.setItem('apuntador', JSON.stringify(S)); } catch (e) {} }

// How transcription should pick GPU or CPU.
export const txPrefs = () => ({ want: S.txDevice || 'auto', gpuFailed: !!S.gpuFailed });

export function applySettings() {
  document.documentElement.style.setProperty('--fs', S.fs + 'px');
  $('fsOut').textContent = S.fs + ' px';
  $('cues').classList.toggle('karaoke', S.karaoke);
  $('main').classList.toggle('mirror', S.mirror);
  $('swKaraoke').setAttribute('aria-checked', S.karaoke);
  $('swMirror').setAttribute('aria-checked', S.mirror);
  $('swWords').setAttribute('aria-checked', S.txWords);
  const r = S.rate.toLocaleString('es') + '×';
  $('rateLbl').textContent = r;
  $('rateBtn').setAttribute('aria-label', 'Velocidad ' + r);
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

export function togglePanel(open) {
  const p = $('panel');
  open = open ?? p.hidden;
  p.hidden = !open;
  $('setBtn').setAttribute('aria-expanded', open);
  if (open) updateDevNote();
}

export function initSettings() {
  RATES.forEach(r => {
    const b = document.createElement('button');
    b.dataset.r = r; b.textContent = r.toLocaleString('es') + '×';
    b.onclick = () => { S.rate = r; applySettings(); };
    $('rates').append(b);
  });
  $('fsDown').onclick = () => setFs(S.fs - 2);
  $('fsUp').onclick = () => setFs(S.fs + 2);
  $('offDown').onclick = () => setOffset(S.offset - 0.1);
  $('offUp').onclick = () => setOffset(S.offset + 0.1);
  $('swKaraoke').onclick = () => { S.karaoke = !S.karaoke; resetKaraoke(); applySettings(); };
  $('swMirror').onclick = toggleMirror;
  $('swWords').onclick = () => { S.txWords = !S.txWords; applySettings(); };
  $('rateBtn').onclick = () => { S.rate = RATES[(RATES.indexOf(S.rate) + 1) % RATES.length] || 1; applySettings(); };
  // Auto / GPU / CPU for transcription. Picking any mode again gives a graphics card that failed another chance.
  [...$('devSeg').children].forEach(b => b.onclick = () => { S.txDevice = b.dataset.d; S.gpuFailed = false; applySettings(); updateDevNote(); });
  $('setBtn').onclick = e => { e.stopPropagation(); togglePanel(); };
  document.addEventListener('pointerdown', e => {
    if (!$('panel').hidden && !e.target.closest('#panel,#setBtn')) togglePanel(false);
  });
}
