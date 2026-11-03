// The prompter: the lines on screen, the current line at the reading arrow, the word-by-word
// highlight, and the time display with its seek bar.
import { state } from './state.js';
import { S } from './settings.js';
import { $ } from './ui.js';
import { fmt } from './format.js';
import { now, duration, seek } from './player.js';
import { updateEmpty } from './screen.js';
import { TX } from './transcribe/run.js';

let els = [], words = [], wcum = [];   // per line: its element, its word elements, where each word ends (0–1)
let active = -2, lit = -1, lastT = -1, dirty = true, follow = true, dragging = false;
let pendingEl = null;                  // "still transcribing" line after the last transcribed one
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// AHEAD means "past the last transcribed line": the pending line is the current one. It is not
// cues.length, which turns into a real line as soon as new lines arrive.
const AHEAD = 1e9;

// Something changed: redraw on the next frame even if the clock did not move.
export function markDirty() { dirty = true; }

export function render() {
  const box = $('cues');
  box.textContent = '';
  els = []; words = []; wcum = [];
  const frag = document.createDocumentFragment();
  state.cues.forEach((c, i) => frag.append(buildCue(c, i)));
  if (pendingEl) frag.append(pendingEl);
  box.append(frag);
  renderSegs();
  active = -2; lit = -1; dirty = true;
  updateEmpty();
  $('scroller').scrollTop = 0;
}
// Add lines to the end without rebuilding the list (live transcription), before the "still transcribing" line.
export function appendCues(list) {
  const frag = document.createDocumentFragment();
  list.forEach(c => { state.cues.push(c); frag.append(buildCue(c, state.cues.length - 1)); });
  if (pendingEl && pendingEl.parentNode) $('cues').insertBefore(frag, pendingEl); else $('cues').append(frag);
  renderSegs(); updateEmpty(); dirty = true;
}
// While Whisper works, the last line says how far it got. When playback gets there it becomes the
// current line, so the screen never shows old text over audio that has no text yet. null removes it.
export function setPending(text) {
  if (text == null) { if (pendingEl) pendingEl.remove(); pendingEl = null; dirty = true; return; }
  if (!pendingEl) { pendingEl = document.createElement('p'); pendingEl.className = 'cue pending'; }
  pendingEl.textContent = text;
  if (!pendingEl.parentNode) $('cues').append(pendingEl);
}
function buildCue(c, i) {
  const p = document.createElement('p');
  p.className = 'cue'; p.dataset.i = i;
  const tx = document.createElement('span');
  const parts = c.text.split(' ');
  const total = parts.reduce((a, w) => a + w.length + 1, 0);
  let acc = 0; const ws = [], cs = [];
  parts.forEach(w => {
    const s = document.createElement('span');
    s.className = 'w'; s.textContent = w;
    tx.append(s, ' ');
    acc += w.length + 1; ws.push(s); cs.push(acc / total);
  });
  p.append(tx);
  els.push(p); words.push(ws); wcum.push(cs);
  return p;
}
// Marks on the seek bar where each line is.
export function renderSegs() {
  const d = duration(), box = $('segs');
  box.textContent = '';
  if (!d) return;
  const frag = document.createDocumentFragment();
  state.cues.forEach(c => {
    const s = document.createElement('div');
    s.style.left = (c.start - S.offset) / d * 100 + '%';
    s.style.width = Math.max(0.15, (c.end - c.start) / d * 100) + '%';
    frag.append(s);
  });
  box.append(frag);
}

function findCue(t) {
  const cues = state.cues;
  let lo = 0, hi = cues.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function setActive(i) {
  const prev = active, n = state.cues.length;
  if (prev >= 0 && words[prev]) words[prev].forEach(w => w.classList.remove('on', 'now'));
  els.forEach((el, j) => {
    el.classList.toggle('active', j === i);
    el.classList.toggle('past', j < i);
  });
  if (pendingEl) pendingEl.classList.toggle('active', i === AHEAD);
  active = i; lit = -1;
  const line = n ? `Línea ${Math.min(n, Math.max(0, i) + 1)} de ${n}` : '—';
  $('counter').textContent = line; $('counterSm').textContent = line;
  if (follow) scrollToCue(Math.max(0, i), prev === -2);
}
function scrollToCue(i, instant) {
  const el = i >= state.cues.length && pendingEl ? pendingEl : els[i], sc = $('scroller');
  if (!el) return;
  const top = el.offsetTop + el.offsetHeight / 2 - sc.clientHeight * 0.4;
  sc.scrollTo({ top, behavior: instant || reduced ? 'auto' : 'smooth' });
}
// Follow: keep the current line at the reading arrow. Scrolling by hand turns it off until the
// viewer taps "Volver a la línea actual".
export function setFollow(v) {
  follow = v;
  $('follow').hidden = v || !state.cues.length;
  if (v && active >= -1) scrollToCue(Math.max(0, active), false);
}
// Put the current line back at the arrow (after the text size or the window changed).
export function recenter(instant) { if (follow) scrollToCue(Math.max(0, active), instant); }

export function seekCue(i) {
  if (!state.cues[i]) return;
  seek(state.cues[i].start - S.offset + 0.01);
}
// Previous (-1) or next (+1) line.
export function stepLine(dir) {
  const n = state.cues.length;
  if (dir < 0) seekCue(Math.max(0, Math.min(active, n) - 1));
  else seekCue(Math.min(n - 1, active + 1));
}
// Word-by-word highlight switched off: clear it from the current line.
export function resetKaraoke() {
  if (active >= 0 && words[active]) words[active].forEach(w => w.classList.remove('on', 'now'));
  lit = -1;
}

function tick() {
  const t = now();
  if (t !== lastT || dirty) {
    lastT = t; dirty = false;
    const d = duration();
    $('tCur').textContent = fmt(t);
    $('tDur').textContent = fmt(d);
    const sk = $('seek');
    if (+sk.max !== d) sk.max = d || 1;
    if (!dragging) sk.value = t;
    $('seekWrap').style.setProperty('--p', d ? Math.min(1, t / d) : 0);

    const ct = t + S.offset, cues = state.cues;
    // Playback went past what Whisper has transcribed so far: point at the pending line, not at old text.
    const i = TX.live && ct >= TX.upto ? AHEAD : findCue(ct);
    if (i !== active) setActive(i);
    if (i >= 0 && i < cues.length && S.karaoke) {
      const c = cues[i], cs = wcum[i];
      let n = 0;
      if (c.w && c.w.length === cs.length) {
        // Real word times from Whisper: the word being said is the last one that has started.
        while (n < c.w.length && c.w[n] <= ct) n++;
        n = Math.max(0, n - 1);
      } else {
        // Estimated: spread the line's duration over its words by length.
        const p = (ct - c.start) / (c.end - c.start);
        while (n < cs.length && cs[n] <= p) n++;
      }
      if (n !== lit) {
        words[i].forEach((w, j) => { w.classList.toggle('on', j < n); w.classList.toggle('now', j === n); });
        lit = n;
      }
    }
  }
  requestAnimationFrame(tick);
}

// The prompter fills what the header, notice and transport leave (--chrome); the current line sits
// at 40% of the scroller's height (--sh). Ajustes and the audio menu open under the header (--hd).
function measureChrome() {
  const h = ['header', '#notice', 'footer'].reduce((a, sel) => a + (document.querySelector(sel)?.offsetHeight || 0), 0);
  const root = document.documentElement.style;
  root.setProperty('--chrome', h + 'px');
  root.setProperty('--hd', (document.querySelector('header')?.offsetHeight || 72) + 'px');
}

export function initPrompter() {
  $('cues').addEventListener('click', e => {
    const p = e.target.closest('.cue:not(.pending)');
    if (p) seekCue(+p.dataset.i);
  });
  $('follow').onclick = () => setFollow(true);
  const sc = $('scroller');
  ['wheel', 'touchmove'].forEach(ev => sc.addEventListener(ev, () => { if (follow && state.cues.length) setFollow(false); }, { passive: true }));
  const sk = $('seek');
  sk.addEventListener('pointerdown', () => dragging = true);
  addEventListener('pointerup', () => dragging = false);
  sk.addEventListener('input', () => seek(+sk.value));
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(measureChrome);
    ['header', '#notice', 'footer'].forEach(sel => ro.observe(document.querySelector(sel)));
    new ResizeObserver(() => document.documentElement.style.setProperty('--sh', sc.clientHeight + 'px')).observe(sc);
  }
  measureChrome();
  addEventListener('resize', () => recenter(true));
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(() => recenter(true)));
  requestAnimationFrame(tick);
}
