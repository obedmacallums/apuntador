(() => {
const $ = id => document.getElementById(id);
const RATES = [0.75, 1, 1.25, 1.5, 2];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const audio = new Audio();
audio.preload = 'auto';

/* ---------- settings ---------- */
const defaults = { fs: innerWidth < 620 ? 28 : 42, karaoke: true, mirror: false, rate: 1, offset: 0 };
let S = { ...defaults };
try { Object.assign(S, JSON.parse(localStorage.getItem('apuntador') || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem('apuntador', JSON.stringify(S)); } catch (e) {} };

/* ---------- state ---------- */
let cues = [], els = [], words = [], wcum = [];
let mode = 'demo';                      // 'demo' = simulated clock, 'audio' = real file
const demo = { t: 0, playing: false, last: 0 };
let active = -2, lit = -1, lastT = -1, dirty = true, follow = true, dragging = false;
let userSrt = false, audioUrl = null, triedDataUrl = false, wakeLock = null;
let library = [], currentId = null, currentMeta = null;   // saved scripts; the one on screen
let resumeFrom = 0, pendingSeek = null, lastSavedPos = -1, saveTimer = 0;

/* ---------- SRT / VTT parsing ---------- */
const TC = /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
const toSec = (h, m, s, ms) => (+h || 0) * 3600 + (+m) * 60 + (+s) + (+(ms + '00').slice(0, 3)) / 1000;
function parseSubs(text) {
  const out = [];
  text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach(block => {
    const lines = block.split('\n');
    const k = lines.findIndex(l => TC.test(l));
    if (k < 0) return;
    const m = lines[k].match(TC);
    const body = lines.slice(k + 1).join(' ')
      .replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();
    if (!body) return;
    const start = toSec(m[1], m[2], m[3], m[4]);
    const end = Math.max(start + 0.2, toSec(m[5], m[6], m[7], m[8]));
    out.push({ start, end, text: body });
  });
  return out.sort((a, b) => a.start - b.start);
}

/* ---------- sample content (simulated clock) ---------- */
function sampleCues() {
  const lines = [
    'Hola. Este es un ejemplo con reloj simulado, sin audio de por medio.',
    'Arriba eliges tu archivo MP3 y su archivo SRT, o los arrastras a esta ventana.',
    'La línea que suena se marca y se queda siempre a la altura de la flecha.',
    'Con el resaltado palabra a palabra, la frase se ilumina mientras avanza.',
    'Toca cualquier línea para saltar a ese momento del audio.',
    'Si te desplazas a mano, el seguimiento se pausa hasta que pulses «Volver a la línea actual».',
    'En Ajustes cambias el tamaño de la letra, la velocidad o activas el modo espejo.',
    'Si la voz y el texto no coinciden, corrige la sincronía en décimas de segundo.',
    'En el teclado, la barra espaciadora reproduce o pausa y las flechas te mueven.',
    'Cada guion se guarda en tu biblioteca y la próxima vez sigues donde lo dejaste.'
  ];
  let t = 0.6;
  return lines.map(text => {
    const d = Math.max(2.4, text.split(' ').length / 2.6);
    const c = { start: t, end: t + d, text };
    t += d + 0.35;
    return c;
  });
}

/* ---------- clock ---------- */
function now() {
  if (mode === 'audio') return audio.currentTime || 0;
  if (demo.playing) {
    const n = performance.now();
    demo.t += (n - demo.last) / 1000 * S.rate;
    demo.last = n;
    if (demo.t >= duration()) { demo.t = duration(); demo.playing = false; onPlayState(); }
  }
  return demo.t;
}
function duration() {
  const last = cues.length ? cues[cues.length - 1].end : 0;
  if (mode === 'audio') return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : last;
  return last ? last + 1 : 0;
}
const isPlaying = () => mode === 'audio' ? !audio.paused && !audio.ended : demo.playing;
function play() {
  if (mode === 'audio') {
    audio.play().catch(() => toast('No se pudo reproducir este audio. Prueba con un MP3 distinto.'));
  } else {
    if (!cues.length) return;
    if (demo.t >= duration()) demo.t = 0;
    demo.playing = true; demo.last = performance.now(); onPlayState();
  }
}
function pause() {
  if (mode === 'audio') audio.pause();
  else { now(); demo.playing = false; onPlayState(); }
}
const toggle = () => isPlaying() ? pause() : play();
function seek(t) {
  t = Math.max(0, Math.min(duration() || 0, t));
  if (mode === 'audio') { try { audio.currentTime = t; } catch (e) {} }
  else { demo.t = t; demo.last = performance.now(); }
  setFollow(true); dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistPos(1), 1500);
}
function seekCue(i) {
  if (!cues[i]) return;
  seek(cues[i].start - S.offset + 0.01);
}

/* ---------- rendering ---------- */
const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
const fmt = s => { s = Math.max(0, s || 0); const h = s / 3600 | 0, m = (s % 3600) / 60 | 0; return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60); };
const fmtTC = s => pad(s / 3600) + ':' + pad(s % 3600 / 60) + ':' + pad(s % 60) + ',' + pad(s % 1 * 1000, 3);

function render() {
  const box = $('cues');
  box.textContent = '';
  els = []; words = []; wcum = [];
  const frag = document.createDocumentFragment();
  cues.forEach((c, i) => frag.append(buildCue(c, i)));
  box.append(frag);
  renderSegs();
  active = -2; lit = -1; dirty = true;
  updateEmpty();
  $('scroller').scrollTop = 0;
}
// Add cues to the end without rebuilding the list (live transcription).
function appendCues(list) {
  const frag = document.createDocumentFragment();
  list.forEach(c => { cues.push(c); frag.append(buildCue(c, cues.length - 1)); });
  $('cues').append(frag);
  renderSegs(); updateEmpty(); dirty = true;
}
function buildCue(c, i) {
    const p = document.createElement('p');
    p.className = 'cue'; p.dataset.i = i;
    const tc = document.createElement('span');
    tc.className = 'tc'; tc.textContent = fmtTC(c.start);
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
    p.append(tc, tx);
    els.push(p); words.push(ws); wcum.push(cs);
    return p;
}
function renderSegs() {
  const d = duration(), box = $('segs');
  box.textContent = '';
  if (!d) return;
  const frag = document.createDocumentFragment();
  cues.forEach(c => {
    const s = document.createElement('div');
    s.style.left = (c.start - S.offset) / d * 100 + '%';
    s.style.width = Math.max(0.15, (c.end - c.start) / d * 100) + '%';
    frag.append(s);
  });
  box.append(frag);
}
function updateEmpty() {
  const show = !cues.length;
  $('empty').hidden = !show;
  if (show) {
    $('emptyTitle').textContent = 'Falta el texto de este audio';
    $('emptyText').textContent = 'El audio ya está listo. El texto que veías antes era solo un ejemplo. Elige el archivo .srt con la transcripción de este audio, o abre un guion de tu biblioteca.';
    $('emptyLib').hidden = !library.length;
    $('emptyTx').hidden = mode !== 'audio';
    if (mode === 'audio') $('emptyText').textContent = 'El audio ya está listo. Transcríbelo aquí mismo con Whisper, elige su archivo .srt o abre un guion de tu biblioteca.';
  }
}

function findCue(t) {
  let lo = 0, hi = cues.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function setActive(i) {
  const prev = active;
  if (prev >= 0 && words[prev]) words[prev].forEach(w => w.classList.remove('on', 'now'));
  els.forEach((el, j) => {
    el.classList.toggle('active', j === i);
    el.classList.toggle('past', j < i);
  });
  active = i; lit = -1;
  $('counter').innerHTML = cues.length ? `<span class="hide-sm">Línea </span>${Math.max(0, i) + 1} / ${cues.length}` : '—';
  if (follow) scrollToCue(Math.max(0, i), prev === -2);
}
function scrollToCue(i, instant) {
  const el = els[i], sc = $('scroller');
  if (!el) return;
  const top = el.offsetTop + el.offsetHeight / 2 - sc.clientHeight * 0.4;
  sc.scrollTo({ top, behavior: instant || reduced ? 'auto' : 'smooth' });
}
function setFollow(v) {
  follow = v;
  $('follow').hidden = v || !cues.length;
  if (v && active >= -1) scrollToCue(Math.max(0, active), false);
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

    const ct = t + S.offset;
    const i = findCue(ct);
    if (i !== active) setActive(i);
    if (i >= 0 && S.karaoke) {
      const c = cues[i], cs = wcum[i];
      const p = (ct - c.start) / (c.end - c.start);
      let n = 0;
      while (n < cs.length && cs[n] <= p) n++;
      if (n !== lit) {
        words[i].forEach((w, j) => { w.classList.toggle('on', j < n); w.classList.toggle('now', j === n); });
        lit = n;
      }
    }
  }
  requestAnimationFrame(tick);
}

/* ---------- play state, wake lock ---------- */
async function onPlayState() {
  const p = isPlaying();
  $('icPlay').toggleAttribute('hidden', p); $('icPause').toggleAttribute('hidden', !p);
  $('play').setAttribute('aria-label', p ? 'Pausar' : 'Reproducir');
  $('tally').classList.toggle('on', p);
  dirty = true;
  if (p && resumeFrom) { resumeFrom = 0; updateNotice(); }
  if (!p) persistPos(1);
  try {
    if (p && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!p && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
['play', 'pause', 'ended'].forEach(ev => audio.addEventListener(ev, onPlayState));
['loadedmetadata', 'durationchange', 'seeked'].forEach(ev => audio.addEventListener(ev, () => { dirty = true; renderSegs(); }));
audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek == null) return;
  try { audio.currentTime = Math.min(pendingSeek, audio.duration || pendingSeek); } catch (e) {}
  pendingSeek = null;
});
audio.addEventListener('error', () => {
  if (!audio.src) return;
  if (audio.src.startsWith('blob:') && !triedDataUrl && audio._file) {
    triedDataUrl = true;
    const r = new FileReader();
    r.onload = () => { audio.src = r.result; audio.load(); };
    r.readAsDataURL(audio._file);
  } else {
    toast('Este navegador no puede leer ese audio. Prueba con MP3, M4A o WAV.');
  }
});

/* ---------- loading files ---------- */
const isSub = f => /\.(srt|vtt)$/i.test(f.name);
const isAudio = f => (f.type || '').startsWith('audio/') || /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus|weba)$/i.test(f.name);

function loadAudio(f, fromStore) {
  const keep = userSrt ? now() : 0;
  pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(f);
  triedDataUrl = false;
  audio._file = f;
  audio.src = audioUrl;
  audio.playbackRate = S.rate;
  audio.load();
  mode = 'audio';
  demo.playing = false;
  pendingSeek = keep > 0 ? keep : null;
  if (!userSrt) { cues = []; render(); }
  $('audioName').textContent = f.name; $('slotAudio').classList.add('ok');
  if (currentId && currentMeta.audioName !== f.name) {
    currentMeta.audioName = f.name;
    Store.patch(currentId, { audioName: f.name });
  }
  if (currentId && !fromStore) saveAudio(currentId, f);
  updateNotice(); updateTxBtn();
  setFollow(true); dirty = true; onPlayState();
}
async function loadSubs(f) {
  let text;
  try { text = await f.text(); } catch (e) { toast('No pude leer ' + f.name + '.'); return; }
  const c = parseSubs(text);
  if (!c.length) { toast(`No encontré subtítulos en ${f.name}. Cada línea necesita un tiempo como 00:00:01,000 --> 00:00:03,500.`); return; }
  persistPos(0);
  const id = 's' + hash(text.replace(/\r\n?/g, '\n').trim());
  const t = Date.now();
  const meta = {
    id, name: f.name.replace(/\.(srt|vtt)$/i, ''), file: f.name, count: c.length,
    dur: c[c.length - 1].end, pos: 0, audioName: '', createdAt: t, updatedAt: t
  };
  // Show the text right away; the library is looked up afterwards and never blocks it.
  openScript(meta, c);
  if (mode === 'audio' && audio._file) saveAudio(id, audio._file);
  else restoreAudio(id);
  const listen = mode === 'audio' ? ' Pulsa reproducir.' : ' Elige el audio para escucharlo.';
  await withTimeout(Store.initP, 12000).catch(() => {});
  let existing = null;
  try { existing = await withTimeout(Store.getMeta(id), 6000); } catch (e) {}
  if (currentId !== id) return;
  if (existing) {
    currentMeta = { ...existing, audioName: currentMeta.audioName || existing.audioName || '' };
    const pos = existing.pos || 0, dur = existing.dur || meta.dur;
    if (pos > 3 && pos < dur - 3 && !isPlaying() && now() < 1) {
      resumeFrom = pos; lastSavedPos = pos;
      if (mode === 'audio' && audio.readyState < 1) pendingSeek = pos;
      seek(pos); clearTimeout(saveTimer);
    }
    Store.patch(id, { updatedAt: t });
    updateNotice(); renderLib();
    toast('Ya estaba en tu biblioteca.' + (resumeFrom ? ` Seguimos en ${fmt(resumeFrom)}.` : listen));
  } else if (Store.kind !== 'none') {
    try {
      await withTimeout(Store.save({ ...meta, audioName: currentMeta.audioName || '' }, c), 30000);
      toast(`Guardado en tu biblioteca: ${c.length} líneas.` + listen);
    } catch (e) {
      const full = e && (e.code === 'quota_exceeded' || e.name === 'QuotaExceededError');
      toast(full ? 'No queda espacio para guardar más guiones. Borra alguno de la biblioteca.'
                 : 'El guion está abierto, pero no pude guardarlo en la biblioteca.');
    }
  } else {
    toast(`${c.length} líneas cargadas.` + listen);
  }
}
function handleFiles(list) {
  const files = [...list];
  if (TX.running && files.some(f => isAudio(f) || isSub(f))) txCancel('Transcripción cancelada: cargaste otro archivo.');
  files.filter(isAudio).slice(0, 1).forEach(loadAudio);
  files.filter(isSub).slice(0, 1).forEach(loadSubs);
  const other = files.filter(f => !isAudio(f) && !isSub(f));
  if (other.length) toast(`«${other[0].name}» no es un audio ni un archivo .srt.`);
}
$('inAudio').addEventListener('change', e => { if (e.target.files[0]) handleFiles(e.target.files); e.target.value = ''; });
$('inSrt').addEventListener('change', e => { if (e.target.files[0]) handleFiles(e.target.files); e.target.value = ''; });

let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 4200);
}

/* ---------- controls ---------- */
$('play').onclick = toggle;
$('back').onclick = () => seek(now() - 5);
$('fwd').onclick = () => seek(now() + 5);
$('cues').addEventListener('click', e => {
  const p = e.target.closest('.cue');
  if (p) seekCue(+p.dataset.i);
});
$('follow').onclick = () => setFollow(true);
const sc = $('scroller');
['wheel', 'touchmove'].forEach(ev => sc.addEventListener(ev, () => { if (follow && cues.length) setFollow(false); }, { passive: true }));

const sk = $('seek');
sk.addEventListener('pointerdown', () => dragging = true);
addEventListener('pointerup', () => dragging = false);
sk.addEventListener('input', () => seek(+sk.value));

function applySettings() {
  document.documentElement.style.setProperty('--fs', S.fs + 'px');
  $('fsOut').textContent = S.fs + ' px';
  $('cues').classList.toggle('karaoke', S.karaoke);
  $('main').classList.toggle('mirror', S.mirror);
  $('swKaraoke').setAttribute('aria-checked', S.karaoke);
  $('swMirror').setAttribute('aria-checked', S.mirror);
  const r = S.rate.toLocaleString('es') + '×';
  $('rateLbl').textContent = r;
  $('rateBtn').setAttribute('aria-label', 'Velocidad ' + r);
  [...$('rates').children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.r === S.rate));
  $('offOut').textContent = (S.offset > 0 ? '+' : '') + S.offset.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';
  audio.playbackRate = S.rate;
  if (mode === 'demo') { now(); demo.last = performance.now(); }
  save(); dirty = true;
}
RATES.forEach(r => {
  const b = document.createElement('button');
  b.dataset.r = r; b.textContent = r.toLocaleString('es') + '×';
  b.onclick = () => { S.rate = r; applySettings(); };
  $('rates').append(b);
});
const setFs = v => { S.fs = Math.max(18, Math.min(96, v)); applySettings(); requestAnimationFrame(() => follow && scrollToCue(Math.max(0, active), true)); };
const setOffset = v => { S.offset = Math.round(Math.max(-30, Math.min(30, v)) * 10) / 10; applySettings(); renderSegs(); };
$('fsDown').onclick = () => setFs(S.fs - 2);
$('fsUp').onclick = () => setFs(S.fs + 2);
$('offDown').onclick = () => setOffset(S.offset - 0.1);
$('offUp').onclick = () => setOffset(S.offset + 0.1);
$('swKaraoke').onclick = () => { S.karaoke = !S.karaoke; if (active >= 0) words[active].forEach(w => w.classList.remove('on', 'now')); lit = -1; applySettings(); };
$('swMirror').onclick = () => { S.mirror = !S.mirror; applySettings(); };
$('rateBtn').onclick = () => { S.rate = RATES[(RATES.indexOf(S.rate) + 1) % RATES.length] || 1; applySettings(); };

function togglePanel(open) {
  const p = $('panel');
  open = open ?? p.hidden;
  p.hidden = !open;
  $('setBtn').setAttribute('aria-expanded', open);
}
$('setBtn').onclick = e => { e.stopPropagation(); togglePanel(); };
document.addEventListener('pointerdown', e => {
  if (!$('panel').hidden && !e.target.closest('#panel,#setBtn')) togglePanel(false);
});

const fsBtn = $('fsBtn');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
function toggleFs() {
  if (!document.fullscreenEnabled) return;
  (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
    .catch(() => toast('Pantalla completa no disponible aquí.'));
}
fsBtn.onclick = toggleFs;
document.addEventListener('fullscreenchange', () => requestAnimationFrame(() => follow && scrollToCue(Math.max(0, active), true)));
addEventListener('resize', () => { if (follow) scrollToCue(Math.max(0, active), true); });

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tgt = e.target;
  const onControl = tgt.closest && tgt.closest('button, input, label');
  if (e.key === 'Escape') { togglePanel(false); closeLib(); closeTx(); return; }
  if (!$('lib').hidden || !$('tx').hidden) return;
  if (tgt.type === 'range') return;
  switch (e.key) {
    case ' ':
      if (onControl) return;
      e.preventDefault(); toggle(); break;
    case 'ArrowLeft': e.preventDefault(); seek(now() - 5); break;
    case 'ArrowRight': e.preventDefault(); seek(now() + 5); break;
    case 'ArrowUp': e.preventDefault(); seekCue(Math.max(0, active - 1)); break;
    case 'ArrowDown': e.preventDefault(); seekCue(Math.min(cues.length - 1, active + 1)); break;
    case '+': case '=': setFs(S.fs + 2); break;
    case '-': case '_': setFs(S.fs - 2); break;
    case 'm': case 'M': S.mirror = !S.mirror; applySettings(); break;
    case 'f': case 'F': toggleFs(); break;
    case 'b': case 'B': openLib(); break;
  }
});

/* ---------- library: saved scripts and where you left off ----------
   Everything stays in this browser: the list and each script's lines in localStorage. */
const hash = s => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + s.length.toString(36);
};
const pack = list => list.map(c => [Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000, c.text]);
const unpack = rows => rows.map(([start, end, text]) => ({ start, end, text }));
const LS_LIB = 'apuntador.lib', LS_SCRIPT = 'apuntador.s.';
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);

const Store = {
  kind: 'none', ready: false, local: null,   // kind: 'local' when localStorage works, 'none' otherwise
  async init() {
    this.useLocal();
  },
  useLocal() {
    this.kind = 'none';
    try {
      localStorage.setItem('apuntador.t', '1'); localStorage.removeItem('apuntador.t');
      this.kind = 'local';
      const v = JSON.parse(localStorage.getItem(LS_LIB) || 'null');
      this.local = v && v.scripts ? v : { last: null, scripts: {} };
    } catch (e) { this.local = { last: null, scripts: {} }; }
    this.syncLocal(false);
  },
  syncLocal(write = true) {
    if (write) localStorage.setItem(LS_LIB, JSON.stringify(this.local));
    library = Object.values(this.local.scripts).sort((a, b) => b.updatedAt - a.updatedAt);
    renderLib();
  },
  async getMeta(id) {
    const m = this.local && this.local.scripts[id];
    return m ? { ...m } : null;
  },
  async load(meta) {
    return unpack(JSON.parse(localStorage.getItem(LS_SCRIPT + meta.id) || '[]'));
  },
  async save(meta, list) {
    if (this.kind !== 'local') throw { code: 'unavailable' };
    localStorage.setItem(LS_SCRIPT + meta.id, JSON.stringify(pack(list)));
    this.local.scripts[meta.id] = { ...meta };
    this.syncLocal();
  },
  patch(id, fields) {
    if (this.kind === 'local' && this.local.scripts[id]) {
      Object.assign(this.local.scripts[id], fields);
      try { this.syncLocal(); } catch (e) {}
    }
    return Promise.resolve();
  },
  async remove(meta) {
    localStorage.removeItem(LS_SCRIPT + meta.id);
    delete this.local.scripts[meta.id];
    if (this.local.last === meta.id) this.local.last = null;
    this.syncLocal();
  },
  setLast(id) {
    if (this.kind === 'local') { this.local.last = id; try { this.syncLocal(); } catch (e) {} }
    return Promise.resolve();
  },
  async getLast() {
    return this.local ? this.local.last : null;
  }
};

/* Audio files live in this browser too (IndexedDB), keyed by script id: localStorage is far too small for them. */
const AudioStore = {
  open() {
    if (!this.p) this.p = new Promise((res, rej) => {
      const r = indexedDB.open('apuntador', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('audio');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.p;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('audio', mode), req = fn(t.objectStore('audio'));
      t.oncomplete = () => res(req.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  put(id, f) { return this.run('readwrite', s => s.put({ blob: f, name: f.name, type: f.type, savedAt: Date.now() }, id)); },
  get(id) { return this.run('readonly', s => s.get(id)); },
  del(id) { return this.run('readwrite', s => s.delete(id)); },
  keys() { return this.run('readonly', s => s.getAllKeys()); }
};
const audioIds = new Set();
async function saveAudio(id, f, quiet) {
  if (audio._savedFor === id && audio._file === f && audioIds.has(id)) return;
  try {
    await AudioStore.put(id, f);
    audioIds.add(id); audio._savedFor = id; renderLib();
    if (!quiet) toast('Audio guardado en este navegador. La próxima vez se abrirá solo con su guion.');
  } catch (e) {
    toast(e && e.name === 'QuotaExceededError'
      ? 'Este navegador no tiene espacio para guardar el audio. Borra guiones que ya no uses.'
      : 'El audio suena, pero este navegador no permitió guardarlo.');
  }
}
async function restoreAudio(id) {
  let rec = null;
  try { rec = await AudioStore.get(id); } catch (e) { return; }
  if (!rec || !rec.blob || currentId !== id) return;
  if (mode === 'audio' && audio._file && audio._savedFor === id) return;
  const f = new File([rec.blob], rec.name || 'audio', { type: rec.type || rec.blob.type });
  audio._savedFor = id;
  loadAudio(f, true);
}
AudioStore.keys().then(ks => { ks.forEach(k => audioIds.add(k)); renderLib(); }).catch(() => {});

function openScript(meta, list) {
  pause();
  cues = list; userSrt = true;
  currentId = meta.id; currentMeta = { ...meta };
  if (mode === 'demo') demo.t = 0;
  render();
  $('srtName').textContent = meta.file || meta.name; $('slotSrt').classList.add('ok');
  const pos = meta.pos || 0, dur = meta.dur || duration();
  resumeFrom = pos > 3 && pos < dur - 3 ? pos : 0;
  lastSavedPos = pos;
  if (mode === 'audio' && audio.readyState < 1) pendingSeek = resumeFrom || null;
  seek(resumeFrom);
  clearTimeout(saveTimer);
  setFollow(true);
  Store.setLast(meta.id);
  updateNotice(); renderLib();
}

// Save the playback second for the open script, only when it moved by at least minDelta.
function persistPos(minDelta) {
  if (!currentId || Store.kind === 'none') return;
  const t = Math.round(now() * 10) / 10;
  if (Math.abs(t - lastSavedPos) < Math.max(minDelta, 0.05)) return;
  lastSavedPos = t; currentMeta.pos = t;
  Store.patch(currentId, { pos: t, updatedAt: Date.now() });
}
setInterval(() => { if (isPlaying()) persistPos(2); }, 10000);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistPos(0); });
addEventListener('pagehide', () => persistPos(0));

function nbtn(text, onClick, primary) {
  const b = document.createElement('button');
  b.className = 'nbtn' + (primary ? ' primary' : ''); b.textContent = text; b.onclick = onClick;
  return b;
}
function updateNotice() {
  const box = $('notice'), txt = $('noticeText'), acts = $('noticeActs');
  if (TX.running) return;
  if (!currentId) {
    box.hidden = !(mode === 'demo' && !userSrt);
    return;
  }
  txt.textContent = ''; acts.textContent = '';
  const name = document.createElement('strong');
  name.textContent = currentMeta.name;
  const bits = [];
  if (resumeFrom) bits.push(`seguimos en ${fmt(resumeFrom)}, donde lo dejaste`);
  if (mode !== 'audio') bits.push(currentMeta.audioName ? `elige su audio (${currentMeta.audioName}) para escucharlo` : 'elige su audio para escucharlo');
  if (!bits.length) { box.hidden = true; return; }
  txt.append(name, ': ' + bits.map((b, i) => i ? b[0].toUpperCase() + b.slice(1) : b).join('. ') + '.');
  if (mode !== 'audio') acts.append(nbtn('Elegir audio', () => $('inAudio').click(), true));
  if (resumeFrom) acts.append(nbtn('Empezar desde el principio', () => { resumeFrom = 0; seek(0); updateNotice(); }));
  box.hidden = false;
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function ago(ts) {
  const s = (ts - Date.now()) / 1000;
  const steps = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [Infinity, 'month', 2629800]];
  for (const [lim, unit, div] of steps) if (Math.abs(s) < lim) return unit === 'second' ? 'hace un momento' : rtf.format(Math.round(s / div), unit);
  return '';
}
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
function renderLib() {
  const n = library.length;
  $('libCount').textContent = n; $('libCount').hidden = !n;
  $('libSub').textContent = !Store.ready ? 'Cargando tu biblioteca…'
    : Store.kind === 'local' ? 'Guiones y audio guardados en este navegador: no salen de tu equipo y solo tú los ves.'
    : 'Este navegador no permite guardar guiones.';
  $('libEmpty').hidden = !!n || !Store.ready;
  const ul = $('libList');
  ul.textContent = '';
  library.forEach(m => {
    const li = document.createElement('li');
    li.className = 'item' + (m.id === currentId ? ' on' : '');
    const open = document.createElement('button');
    open.className = 'open';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m.name;
    const mt = document.createElement('span'); mt.className = 'mt';
    const dur = m.dur || 0, pos = m.pos || 0;
    const state = document.createElement('em');
    state.textContent = m.id === currentId ? 'Abierto' : pos >= dur - 3 && pos > 0 ? 'Terminado' : pos > 3 ? `Ibas en ${fmt(pos)}` : 'Sin empezar';
    mt.append(state, ` · ${m.count} líneas · ${fmt(dur)} · ${audioIds.has(m.id) ? 'con audio' : 'sin audio'} · ${ago(m.updatedAt || Date.now())}`);
    const bar = document.createElement('span'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = (dur ? Math.min(100, pos / dur * 100) : 0) + '%';
    bar.append(fill);
    open.append(nm, mt, bar);
    open.onclick = () => openFromLib(m);
    const del = document.createElement('button');
    del.className = 'del'; del.innerHTML = TRASH; del.setAttribute('aria-label', `Borrar ${m.name}`); del.title = 'Borrar';
    del.onclick = async () => {
      if (!del.classList.contains('armed')) {
        del.classList.add('armed'); del.textContent = 'Borrar';
        del.setAttribute('aria-label', `Confirmar: borrar ${m.name}`);
        setTimeout(() => { if (del.isConnected) { del.classList.remove('armed'); del.innerHTML = TRASH; del.setAttribute('aria-label', `Borrar ${m.name}`); } }, 3500);
        return;
      }
      try {
        await Store.remove(m);
        AudioStore.del(m.id).catch(() => {}); audioIds.delete(m.id);
        if (m.id === currentId) { currentId = null; currentMeta = null; resumeFrom = 0; updateNotice(); }
        toast(`«${m.name}» se borró de tu biblioteca.`);
      } catch (e) { toast('No pude borrarlo. Prueba de nuevo en unos segundos.'); }
    };
    li.append(open, del);
    ul.append(li);
  });
}
async function openFromLib(m) {
  if (m.id === currentId) { closeLib(); return; }
  persistPos(0);
  try {
    const list = await withTimeout(Store.load(m), 15000);
    if (!list.length) throw 0;
    openScript(m, list);
    restoreAudio(m.id);
    closeLib();
  } catch (e) { toast('No pude abrir este guion. Prueba de nuevo en unos segundos.'); }
}
function openLib() {
  togglePanel(false);
  $('lib').hidden = false; $('scrim').hidden = false;
  $('libBtn').setAttribute('aria-expanded', 'true');
  $('libClose').focus();
}
function closeLib() {
  if ($('lib').hidden) return;
  $('lib').hidden = true; $('scrim').hidden = true;
  $('libBtn').setAttribute('aria-expanded', 'false');
  $('libBtn').focus();
}
$('libBtn').onclick = openLib;
$('emptyLib').onclick = openLib;
$('libClose').onclick = closeLib;
$('scrim').onclick = () => { closeLib(); closeTx(); };
$('lib').addEventListener('click', e => { if (e.target.closest('label[for="inSrt"]')) closeLib(); });

/* ---------- layout: measure header, notice and transport so the prompter fills the rest ---------- */
function measureChrome() {
  const h = ['header', '#notice', 'footer'].reduce((a, sel) => a + (document.querySelector(sel)?.offsetHeight || 0), 0);
  document.documentElement.style.setProperty('--chrome', h + 'px');
}
if (window.ResizeObserver) {
  const ro = new ResizeObserver(measureChrome);
  ['header', '#notice', 'footer'].forEach(sel => ro.observe(document.querySelector(sel)));
}
measureChrome();
new (window.ResizeObserver || function () { this.observe = () => {}; })(() => {
  document.documentElement.style.setProperty('--sh', $('scroller').clientHeight + 'px');
}).observe($('scroller'));

/* ---------- transcription with Whisper, in this browser ---------- */
var TX = { running: false, worker: null, reject: null };

// transformers.js and its ONNX Runtime WASM come from jsDelivr (pinned version); the models from
// Hugging Face. Sizes are in bytes and only drive the progress bar and the "Descarga N MB" labels.
const TJS_VERSION = '3.8.1';
const TJS_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TJS_VERSION}/dist/`;
const RUNTIME = { lib: TJS_CDN + 'transformers.min.js', wasm: TJS_CDN + 'ort-wasm-simd-threaded.jsep.wasm', wasmSize: 21596019 };
const hfModel = (id, sizes) => {
  const files = Object.entries(sizes).map(([name, size]) => ({ name, size, url: `https://huggingface.co/${id}/resolve/main/${name}` }));
  return { id, files, size: files.reduce((a, f) => a + f.size, 0) };
};
const MODELS = {
  tiny: hfModel('Xenova/whisper-tiny', {
    'config.json': 2248, 'generation_config.json': 3716, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282683,
    'onnx/encoder_model_quantized.onnx': 10124910, 'onnx/decoder_model_merged_quantized.onnx': 30727765
  }),
  base: hfModel('Xenova/whisper-base', {
    'config.json': 2248, 'generation_config.json': 3776, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282683,
    'onnx/encoder_model_quantized.onnx': 23200850, 'onnx/decoder_model_merged_quantized.onnx': 53707539
  })
};
const MODEL_INFO = {
  tiny: { label: 'Tiny', note: 'El más rápido. Bien con voz clara; comete más errores.' },
  base: { label: 'Base', note: 'Más preciso. Tarda más o menos el doble que Tiny.' }
};
const mb = n => Math.round(n / 1e6) + ' MB';

async function modelCached(m) {
  try {
    const c = await caches.open('transformers-cache');
    for (const f of m.files) if (!(await c.match(f.url))) return false;
    return true;
  } catch (e) { return false; }
}
async function deleteModel(m) {
  const c = await caches.open('transformers-cache');
  await Promise.all(m.files.map(f => c.delete(f.url)));
}
function updateTxBtn() {
  $('txBtn').hidden = mode !== 'audio' || TX.running;
  if (!$('empty').hidden) $('emptyTx').hidden = mode !== 'audio';
}

async function openTx() {
  if (mode !== 'audio' || !audio._file) { toast('Primero elige el audio que quieres transcribir.'); return; }
  if (TX.running) return;
  if (!window.caches || !window.Worker) { toast('Este navegador no permite transcribir aquí. Abre la página por https o desde localhost.'); return; }
  togglePanel(false); closeLib();
  $('txAudio').textContent = '';
  const nm = document.createElement('strong'); nm.textContent = audio._file.name;
  $('txAudio').append('Audio: ', nm, isFinite(audio.duration) ? ` (${fmt(audio.duration)})` : '');
  const box = $('txModels');
  box.querySelectorAll('.model').forEach(n => n.remove());
  const pick = MODELS[S.txModel] ? S.txModel : 'tiny';
  for (const [key, m] of Object.entries(MODELS)) {
    const info = MODEL_INFO[key] || { label: key, note: '' };
    const lab = document.createElement('label'); lab.className = 'model';
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'txModel'; r.value = key; r.checked = key === pick;
    const b = document.createElement('b'); b.textContent = info.label;
    const mt = document.createElement('span'); mt.className = 'mt'; mt.textContent = info.note;
    const st = document.createElement('span'); st.className = 'st'; st.textContent = '…';
    lab.append(r, b, st, mt);
    box.append(lab);
    modelCached(m).then(ok => {
      st.textContent = '';
      st.classList.toggle('ok', ok);
      const line = document.createElement('span');
      line.textContent = (ok ? 'Descargado · ' : 'Descarga ') + mb(m.size);
      st.append(line);
      if (ok) {
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'link'; del.textContent = 'Borrar';
        del.setAttribute('aria-label', 'Borrar el modelo ' + info.label + ' de este navegador');
        del.onclick = async ev => {
          ev.preventDefault(); ev.stopPropagation();
          try { await deleteModel(m); st.classList.remove('ok'); st.textContent = 'Descarga ' + mb(m.size); toast('Modelo ' + info.label + ' borrado de este navegador.'); }
          catch (e2) { toast('No pude borrar el modelo.'); }
        };
        st.append(del);
      }
    });
  }
  $('txLang').value = S.txLang != null ? S.txLang : 'spanish';
  $('tx').hidden = false; $('scrim').hidden = false;
  $('txGo').focus();
}
function closeTx() {
  if ($('tx').hidden) return;
  $('tx').hidden = true;
  if ($('lib').hidden) $('scrim').hidden = true;
}

function txNotice(text, frac) {
  const box = $('notice'), txt = $('noticeText'), acts = $('noticeActs');
  txt.textContent = ''; acts.textContent = '';
  const s = document.createElement('span'); s.className = 'tx-msg'; s.textContent = text;
  txt.append(s);
  if (frac != null) {
    const bar = document.createElement('span'); bar.className = 'prog';
    const i = document.createElement('i'); i.style.width = Math.round(Math.min(1, frac) * 100) + '%';
    bar.append(i); acts.append(bar);
  }
  acts.append(nbtn('Cancelar', () => txCancel('Transcripción cancelada.')));
  box.hidden = false;
}
function txCall(msg, transfer, onEvent) {
  return new Promise((res, rej) => {
    TX.reject = rej;
    TX.worker.onmessage = ({ data }) => {
      if (data.type === 'error') rej(new Error(data.message));
      else if (data.type === 'ready' || data.type === 'done') res(data);
      else onEvent(data);
    };
    TX.worker.onerror = e => { e.preventDefault(); rej(new Error(e.message || 'worker')); };
    TX.worker.postMessage(msg, transfer || []);
  });
}
function txCancel(message) {
  if (!TX.running) return;
  TX.running = false;
  if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
  if (TX.reject) TX.reject({ cancelled: true });
  updateTxBtn(); updateNotice();
  toast(message);
}

async function decodeAudio(file) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ab = await new Ctx(1, 1, 16000).decodeAudioData(await file.arrayBuffer());
  if (ab.numberOfChannels === 1) return new Float32Array(ab.getChannelData(0));
  const out = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels;
  }
  return out;
}
// Whisper reads at most 30 s at a time: cut at the quietest moment between 20 s and 29 s so words stay whole.
function splitWindows(pcm) {
  const SR = 16000, F = 0.1, dur = pcm.length / SR, hop = SR * F;
  const rms = new Float32Array(Math.ceil(pcm.length / hop));
  for (let k = 0; k < rms.length; k++) {
    let sum = 0;
    const end = Math.min(pcm.length, (k + 1) * hop);
    for (let i = k * hop; i < end; i++) sum += pcm[i] * pcm[i];
    rms[k] = Math.sqrt(sum / Math.max(1, end - k * hop));
  }
  const level = (a, b) => { let m = 0; for (let k = Math.floor(a / F); k < Math.min(rms.length, b / F); k++) m = Math.max(m, rms[k]); return m; };
  const wins = [];
  let s = 0;
  while (dur - s > 30) {
    let best = s + 29, bv = Infinity;
    for (let t = s + 20; t <= s + 29; t += F) { const v = rms[Math.floor(t / F)]; if (v < bv) { bv = v; best = t; } }
    wins.push([s, best]); s = best;
  }
  wins.push([s, dur]);
  return wins.filter(([a, b]) => b - a > 0.5 && level(a, b) > 0.01);
}

async function startTx() {
  const key = ($('txModels').querySelector('input:checked') || {}).value || 'tiny';
  const m = MODELS[key], label = (MODEL_INFO[key] || {}).label || key;
  const language = $('txLang').value;
  S.txModel = key; S.txLang = language; save();
  closeTx();
  const file = audio._file;
  persistPos(0);
  TX.running = true; updateTxBtn();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  txNotice('Preparando Whisper ' + label + '…', 0);
  try {
    const decoding = decodeAudio(file);
    TX.worker = new Worker('js/worker.js');
    await txCall({ type: 'prepare', runtime: RUNTIME, model: m }, [], d => {
      if (d.type === 'download' && d.done < d.total) txNotice(`Descargando el modelo ${label}: ${mb(d.done)} de ${mb(d.total)}. Solo la primera vez.`, d.done / d.total);
      if (d.type === 'stage') txNotice(`Cargando el modelo ${label}…`, null);
    });
    if (!TX.running) return;
    txNotice('Preparando el audio…', null);
    const pcm = await decoding;
    if (!TX.running) return;
    const windows = splitWindows(pcm), total = pcm.length / 16000;
    // Show the lines as they come; the audio can keep playing meanwhile.
    cues = []; userSrt = true; currentId = null; currentMeta = null; resumeFrom = 0;
    render(); setFollow(true);
    $('srtName').textContent = 'Transcribiendo…'; $('slotSrt').classList.remove('ok');
    const t0 = Date.now();
    txNotice(`Transcribiendo con Whisper ${label}: 0:00 de ${fmt(total)}`, 0);
    await txCall({ type: 'run', audio: pcm, windows, language }, [pcm.buffer], d => {
      if (d.type !== 'segment' || !TX.running) return;
      if (d.segs.length) appendCues(d.segs);
      const left = (Date.now() - t0) / d.upto * (total - d.upto) / 1000;
      const eta = left > 90 ? `quedan unos ${Math.round(left / 60)} min` : left > 5 ? 'queda menos de 2 min' : 'casi listo';
      txNotice(`Transcribiendo con Whisper ${label}: ${fmt(d.upto)} de ${fmt(total)} · ${eta}`, d.upto / total);
    });
    if (!TX.running) return;
    TX.running = false;
    if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
    await finishTx(file, label);
  } catch (e) {
    if (e && e.cancelled) return;
    TX.running = false;
    if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
    updateTxBtn(); updateNotice(); updateEmpty();
    const msg = String((e && e.message) || e);
    toast(/decode|Unable to decode|EncodingError/i.test(msg)
      ? 'Este navegador no pudo leer el audio para transcribirlo. Prueba con un MP3.'
      : /QuotaExceeded|quota/i.test(msg) ? 'No hay espacio en el navegador para guardar el modelo. Borra otro modelo o libera espacio.'
      : 'La transcripción falló: ' + msg.slice(0, 160));
  }
}
async function finishTx(file, label) {
  updateTxBtn();
  if (!cues.length) {
    updateNotice(); updateEmpty();
    $('srtName').textContent = 'Elegir SRT';
    toast('Whisper no encontró voz en este audio.');
    return;
  }
  const list = cues.slice();
  const name = file.name.replace(/\.[^.]+$/, '');
  const srt = list.map((c, i) => `${i + 1}\n${fmtTC(c.start)} --> ${fmtTC(c.end)}\n${c.text}\n`).join('\n');
  const t = Date.now();
  const meta = {
    id: 's' + hash(srt), name, file: `${name}.srt (Whisper ${label})`, count: list.length,
    dur: list[list.length - 1].end, pos: 0, audioName: file.name, createdAt: t, updatedAt: t
  };
  openScript(meta, list);
  saveAudio(meta.id, file, true);
  if (Store.kind !== 'none') {
    try { await withTimeout(Store.save(meta, list), 30000); toast(`Transcripción lista: ${list.length} líneas, guardada en tu biblioteca.`); }
    catch (e) { toast(`Transcripción lista: ${list.length} líneas. No pude guardarla en la biblioteca.`); }
  } else toast(`Transcripción lista: ${list.length} líneas.`);
}
$('txBtn').onclick = openTx;
$('emptyTx').onclick = openTx;
$('txClose').onclick = closeTx;
$('txBack').onclick = closeTx;
$('txGo').onclick = () => startTx().catch(() => toast('No se pudo iniciar la transcripción.'));

/* ---------- boot ---------- */
if (!RATES.includes(S.rate)) S.rate = 1;
cues = sampleCues();
applySettings();
render();
onPlayState();
requestAnimationFrame(tick);
renderLib();
// Reopen the last script, unless the viewer already loaded something meanwhile.
Store.initP = withTimeout(Store.init(), 12000).catch(() => { if (Store.kind === 'none') Store.useLocal(); });
Store.initP.then(async () => {
  Store.ready = true; renderLib();
  try {
    const last = await withTimeout(Store.getLast(), 6000);
    if (!last || userSrt) return;
    const meta = await withTimeout(Store.getMeta(last), 6000);
    if (!meta || userSrt) return;
    const list = await withTimeout(Store.load(meta), 15000);
    if (list.length && !userSrt) { openScript(meta, list); restoreAudio(meta.id); }
  } catch (e) {}
});
})();
