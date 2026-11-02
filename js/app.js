(() => {
const $ = id => document.getElementById(id);
const RATES = [0.75, 1, 1.25, 1.5, 2];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const audio = new Audio();
audio.preload = 'auto';

/* ---------- settings ---------- */
const defaults = { fs: innerWidth < 620 ? 28 : 42, karaoke: true, mirror: false, rate: 1, offset: 0, txWords: true };
let S = { ...defaults };
try { Object.assign(S, JSON.parse(localStorage.getItem('apuntador') || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem('apuntador', JSON.stringify(S)); } catch (e) {} };

/* ---------- state ---------- */
let cues = [], els = [], words = [], wcum = [];
let mode = 'demo';                      // 'demo' = simulated clock, 'audio' = real file
const demo = { t: 0, playing: false, last: 0 };
let active = -2, lit = -1, lastT = -1, dirty = true, follow = true, dragging = false;
let userSrt = false, audioUrl = null, triedDataUrl = false, wakeLock = null;
let library = [], audios = [], currentId = null, currentMeta = null;   // saved texts and audios; the text on screen
let resumeFrom = 0, pendingSeek = null, lastSavedPos = -1, saveTimer = 0;
// Each audio can have several texts (its own SRT, one per Whisper model…): a text names its audio by
// audioKey. Audio and text only get paired when that is unambiguous, so one never ends up with the
// other's file. With an audio loaded and no text open, the screen lists that audio's texts.
let spareAudio = null;     // the last audio set aside, so "Usar «…»" can bring it back in one tap
let pendingEl = null;      // "still transcribing" line after the last transcribed one

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
    'Cada audio se guarda en tu biblioteca con sus textos, y la próxima vez sigues donde lo dejaste.'
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
  if (pendingEl) frag.append(pendingEl);
  box.append(frag);
  renderSegs();
  active = -2; lit = -1; dirty = true;
  updateEmpty();
  $('scroller').scrollTop = 0;
}
// Add cues to the end without rebuilding the list (live transcription), before the "still transcribing" line.
function appendCues(list) {
  const frag = document.createDocumentFragment();
  list.forEach(c => { cues.push(c); frag.append(buildCue(c, cues.length - 1)); });
  if (pendingEl && pendingEl.parentNode) $('cues').insertBefore(frag, pendingEl); else $('cues').append(frag);
  renderSegs(); updateEmpty(); dirty = true;
}
// While Whisper works, the last line says how far it got. When playback gets there it becomes the
// current line, so the screen never shows old text over audio that has no text yet.
function setPending(text) {
  if (text == null) { if (pendingEl) pendingEl.remove(); pendingEl = null; dirty = true; return; }
  if (!pendingEl) { pendingEl = document.createElement('p'); pendingEl.className = 'cue pending'; }
  pendingEl.textContent = text;
  if (!pendingEl.parentNode) $('cues').append(pendingEl);
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
  const show = !cues.length && !TX.live;
  $('empty').hidden = !show;
  const box = $('emptyList');
  box.textContent = '';
  if (!show) return;
  // An audio on its own: the texts already saved for it, to pick one, plus ways to make another.
  const mine = mode === 'audio' && !TX.running ? textsFor(loadedKey()) : [];
  box.hidden = !mine.length;
  $('emptyLib').hidden = !library.length || mine.length > 0;
  $('emptyTx').hidden = mode !== 'audio' || TX.running;
  $('emptyTx').textContent = mine.length ? 'Transcribir con otro modelo' : 'Transcribir con Whisper';
  $('emptyTx').classList.toggle('primary', !mine.length);
  if (TX.running) {
    $('emptyTitle').textContent = 'Preparando la transcripción…';
    $('emptyText').textContent = 'El texto irá apareciendo aquí a medida que Whisper lo transcriba. Puedes reproducir el audio mientras tanto.';
  } else if (mine.length) {
    $('emptyTitle').textContent = mine.length === 1 ? 'Este audio ya tiene un texto' : `Este audio tiene ${mine.length} textos`;
    $('emptyText').textContent = 'Elige cuál leer, o crea otro: transcríbelo con otro modelo o elige su archivo .srt.';
    mine.forEach(m => box.append(textButton(m, textLabel(m), 'choice')));
  } else if (mode === 'audio') {
    $('emptyTitle').textContent = 'Falta el texto de este audio';
    $('emptyText').textContent = (storedAudio.has(loadedKey()) ? 'El audio ya está en tu biblioteca. ' : '')
      + 'Transcríbelo aquí mismo con Whisper o elige su archivo .srt: el texto quedará guardado junto al audio.';
  } else {
    $('emptyTitle').textContent = 'Elige qué leer';
    $('emptyText').textContent = 'Elige un audio y su archivo .srt, arrástralos a la ventana o abre algo de tu biblioteca.';
  }
}

function findCue(t) {
  let lo = 0, hi = cues.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
// AHEAD means "past the last transcribed line": the pending line is the current one. It is not
// cues.length, which turns into a real line as soon as new lines arrive.
const AHEAD = 1e9;
function setActive(i) {
  const prev = active;
  if (prev >= 0 && words[prev]) words[prev].forEach(w => w.classList.remove('on', 'now'));
  els.forEach((el, j) => {
    el.classList.toggle('active', j === i);
    el.classList.toggle('past', j < i);
  });
  if (pendingEl) pendingEl.classList.toggle('active', i === AHEAD);
  active = i; lit = -1;
  $('counter').innerHTML = cues.length ? `<span class="hide-sm">Línea </span>${Math.min(cues.length, Math.max(0, i) + 1)} / ${cues.length}` : '—';
  if (follow) scrollToCue(Math.max(0, i), prev === -2);
}
function scrollToCue(i, instant) {
  const el = i >= cues.length && pendingEl ? pendingEl : els[i], sc = $('scroller');
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

// An audio is known by its name and byte size: the same recording picked again gets the same key
// (dates change when files are copied around).
const keyOf = f => 'a' + hash(f.name + '\n' + f.size);
const resetSrtSlot = () => { $('srtName').textContent = 'Elegir SRT'; $('slotSrt').classList.remove('ok'); };
const loadedKey = () => mode === 'audio' && audio._file ? audio._key : null;
// The audio playing is the open text's own.
const ownsAudio = () => !!currentId && !!currentMeta.audioKey && currentMeta.audioKey === loadedKey();
// The texts saved for an audio, most recently used first.
const textsFor = key => key ? library.filter(m => m.audioKey === key) : [];
// What a text is called next to its audio: the Whisper model that wrote it, or its file name.
const textLabel = m => m.via || ((m.file || '').match(/\((Whisper [^)]+)\)$/) || [])[1] || m.file || m.name;

// Put a file in the player. keepPos stays at the current second (giving audio to the text on screen).
function setAudio(f, keepPos) {
  const keep = keepPos ? now() : 0;
  pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(f);
  triedDataUrl = false;
  audio._file = f; audio._key = keyOf(f);
  audio.src = audioUrl;
  audio.playbackRate = S.rate;
  audio.load();
  mode = 'audio';
  demo.playing = false;
  pendingSeek = keep > 0 ? keep : null;
  $('audioName').textContent = f.name; $('slotAudio').classList.add('ok');
  updateNotice(); updateTxBtn();
  setFollow(true); dirty = true; onPlayState();
}
// Take the audio out of the player (it belongs to another text). The text stays, on the simulated clock.
function unloadAudio() {
  if (mode !== 'audio') return;
  const t = now();
  pause();
  spareAudio = audio._file;
  audio.removeAttribute('src'); audio.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null; audio._file = null; audio._key = null;
  mode = 'demo'; demo.t = t; demo.playing = false;
  $('audioName').textContent = 'Elegir MP3'; $('slotAudio').classList.remove('ok');
  updateTxBtn(); dirty = true; onPlayState();
}
// The loaded audio now belongs to the open text: it joins that audio's texts in the library.
function pairAudio(f, quiet) {
  if (!currentId) return;
  const key = keyOf(f);
  if (spareAudio === f) spareAudio = null;
  if (currentMeta.audioKey !== key || currentMeta.audioName !== f.name) {
    currentMeta.audioKey = key; currentMeta.audioName = f.name;
    Store.patch(currentId, { audioKey: key, audioName: f.name });
  }
  rememberAudio(f, quiet ? '' : 'Audio guardado en tu biblioteca: la próxima vez se abrirá con su texto.');
  updateNotice(); renderLib();
}
// Close the text on screen. It stays in the library. An audio left in the player is what the next
// visit reopens, with the list of its texts.
function closeScript() {
  persistPos(0);
  cues = []; userSrt = false; currentId = null; currentMeta = null; resumeFrom = 0;
  render(); resetSrtSlot();
  const key = loadedKey();
  Store.setLast(key && storedAudio.has(key) ? key : null);
  updateNotice(); renderLib();
}

// A new audio file. It joins the open text only when that text is still waiting for its audio
// (the "choose the SRT, then its MP3" flow). Otherwise it is another recording: the text closes and
// the screen lists the texts already saved for this audio, if any.
function chooseAudio(f) {
  const key = keyOf(f);
  if (loadedKey() === key) { toast('Ese audio ya está cargado.'); return; }
  const waiting = currentId && !ownsAudio() && currentMeta.audioKey !== key
    && !(currentMeta.audioKey && storedAudio.has(currentMeta.audioKey));   // its own audio is saved: this one is another
  if (currentId && (waiting || currentMeta.audioKey === key)) {
    const before = currentMeta.audioName, other = !!before && before !== f.name;
    setAudio(f, true);
    pairAudio(f, other);   // quiet when warning, so the warning stays on screen
    if (other) toast(`Lo uso con «${currentMeta.name}», aunque antes iba con «${before}».`);
    return;
  }
  const closed = currentId ? currentMeta.name : '';
  closeScript();
  setAudio(f, false);
  updateNotice();
  rememberAudio(f).then(ok => { if (ok && !currentId && loadedKey() === key) Store.setLast(key); });
  if (closed) toast(`Audio nuevo: cerré «${closed}», que sigue en tu biblioteca.`);
}

// A subtitle file. withAudio: it came together with an audio file, so they are paired no matter what.
async function chooseSubs(f, withAudio) {
  let text;
  try { text = await f.text(); } catch (e) { toast('No pude leer ' + f.name + '.'); return; }
  const c = parseSubs(text);
  if (!c.length) { toast(`No encontré subtítulos en ${f.name}. Cada línea necesita un tiempo como 00:00:01,000 --> 00:00:03,500.`); return; }
  persistPos(0);
  const id = 's' + hash(text.replace(/\r\n?/g, '\n').trim());
  let saved = null;
  try { saved = await Store.getMeta(id); } catch (e) {}
  const t = Date.now();
  const meta = saved ? { ...saved, updatedAt: t } : {
    id, name: f.name.replace(/\.(srt|vtt)$/i, ''), file: f.name, count: c.length,
    dur: c[c.length - 1].end, pos: 0, audioName: '', createdAt: t, updatedAt: t
  };
  const loaded = mode === 'audio';
  const same = loaded && !!meta.audioKey && meta.audioKey === loadedKey();          // its own audio is already playing
  const stored = !same && !withAudio && !!meta.audioKey && storedAudio.has(meta.audioKey); // its own audio is saved
  // The loaded audio is free (no text open, so the screen was asking for its text): this SRT is one of its texts.
  const pair = loaded && !same && (withAudio || (!stored && !currentId));
  const setAside = loaded && !same && !pair && !stored;   // the loaded audio goes with the text that was open
  const aside = setAside ? audio._file.name : '';
  if (setAside) unloadAudio();
  openScript(meta, c, pair || same);
  if (pair) pairAudio(audio._file, true);
  else if (stored && !(await restoreAudio(currentMeta)) && currentId === id && mode === 'audio' && !ownsAudio()) unloadAudio();
  if (!saved && Store.kind !== 'none') {
    try { await Store.save({ ...meta, audioName: currentMeta.audioName || '', audioKey: currentMeta.audioKey || '' }, c); renderLib(); }
    catch (e) {
      const full = e && (e.code === 'quota_exceeded' || e.name === 'QuotaExceededError');
      toast(full ? 'No queda espacio para guardar más textos. Borra alguno de la biblioteca.'
                 : 'El texto está abierto, pero no pude guardarlo en la biblioteca.');
      return;
    }
  } else if (saved) Store.patch(id, { updatedAt: t });
  if (currentId !== id) return;
  const where = saved ? 'Ya estaba en tu biblioteca.' : `Guardado en tu biblioteca: ${c.length} líneas.`;
  toast(aside ? `${where} Quité «${aside}» porque va con otro texto; si también es de este, pulsa «Usar ${aside}».`
    : `${where}` + (resumeFrom ? ` Seguimos en ${fmt(resumeFrom)}.` : mode === 'audio' ? ' Pulsa reproducir.' : ' Elige su audio para escucharlo.'));
}

function handleFiles(list) {
  const files = [...list];
  const a = files.find(isAudio), s = files.find(isSub);
  if (TX.running && (a || s)) txCancel('Transcripción cancelada: cargaste otro archivo.');
  if (a && s) { closeScript(); setAudio(a, false); chooseSubs(s, true); }   // chosen together: they go together
  else if (a) chooseAudio(a);
  else if (s) chooseSubs(s);
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
  const p = e.target.closest('.cue:not(.pending)');
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
  $('swWords').setAttribute('aria-checked', S.txWords);
  const r = S.rate.toLocaleString('es') + '×';
  $('rateLbl').textContent = r;
  $('rateBtn').setAttribute('aria-label', 'Velocidad ' + r);
  [...$('rates').children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.r === S.rate));
  [...$('devSeg').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.d === (S.txDevice || 'auto')));
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
$('swWords').onclick = () => { S.txWords = !S.txWords; applySettings(); };
$('rateBtn').onclick = () => { S.rate = RATES[(RATES.indexOf(S.rate) + 1) % RATES.length] || 1; applySettings(); };
// Auto / GPU / CPU for transcription. Picking any mode again gives a graphics card that failed another chance.
[...$('devSeg').children].forEach(b => b.onclick = () => { S.txDevice = b.dataset.d; S.gpuFailed = false; applySettings(); updateDevNote(); });
async function updateDevNote() {
  const dev = await deviceInfo(), gpuBtn = $('devSeg').querySelector('[data-d="gpu"]');
  gpuBtn.disabled = !dev.gpu.ok && txMode() !== 'gpu';
  gpuBtn.title = dev.gpu.ok ? 'Tarjeta gráfica (WebGPU)' + (dev.gpu.name ? ': ' + dev.gpu.name : '') : 'Este navegador no tiene WebGPU';
  $('devNote').textContent = describeDevice(dev);
}

function togglePanel(open) {
  const p = $('panel');
  open = open ?? p.hidden;
  p.hidden = !open;
  $('setBtn').setAttribute('aria-expanded', open);
  if (open) updateDevNote();
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
    case 'ArrowUp': e.preventDefault(); seekCue(Math.max(0, Math.min(active, cues.length) - 1)); break;
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
// Each line is stored as [start, end, text] plus, when Whisper gave word times, [start of each word].
const pack = list => list.map(c => {
  const row = [Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000, c.text];
  if (c.w) row.push(c.w);
  return row;
});
const unpack = rows => rows.map(([start, end, text, w]) => w ? { start, end, text, w } : { start, end, text });
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
    if (!this.local.audios) this.local.audios = {};
    this.syncLocal(false);
  },
  syncLocal(write = true) {
    if (write) localStorage.setItem(LS_LIB, JSON.stringify(this.local));
    library = Object.values(this.local.scripts).sort((a, b) => b.updatedAt - a.updatedAt);
    audios = Object.values(this.local.audios);
    renderLib();
  },
  // Audios: { key, name, size, type, dur, addedAt, usedAt }. The file itself is in AudioStore.
  audio(key) { return this.local && this.local.audios[key] || null; },
  putAudio(a) {
    if (this.kind !== 'local') return;
    this.local.audios[a.key] = { ...(this.local.audios[a.key] || {}), ...a };
    try { this.syncLocal(); } catch (e) {}
  },
  removeAudio(key) {
    if (this.kind !== 'local') return;
    for (const m of Object.values(this.local.scripts)) if (m.audioKey === key) {
      localStorage.removeItem(LS_SCRIPT + m.id); delete this.local.scripts[m.id];
      if (this.local.last === m.id) this.local.last = null;
    }
    delete this.local.audios[key];
    if (this.local.last === key) this.local.last = null;
    this.syncLocal();
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

/* Audio files live in this browser too (IndexedDB), keyed by audio key: localStorage is far too small
   for them. Each audio is stored once, however many texts it has. */
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
const storedAudio = new Set();   // audio keys whose file is saved in this browser
const saving = new Map();         // audio key → the write in progress, so the same file is not written twice
const fileOf = rec => new File([rec.blob], rec.name || 'audio', { type: rec.type || rec.blob.type });
// Keep an audio in the library. Resolves to whether its file is saved in this browser.
function rememberAudio(f, msg) {
  const key = keyOf(f), t = Date.now();
  const dur = audio._key === key && isFinite(audio.duration) ? audio.duration : undefined;
  const entry = { key, name: f.name, size: f.size, type: f.type, usedAt: t, ...(dur ? { dur } : {}) };
  if (storedAudio.has(key)) { Store.putAudio(entry); return Promise.resolve(true); }
  if (!saving.has(key)) saving.set(key, (async () => {
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
    try {
      await AudioStore.put(key, f);
      storedAudio.add(key);
      Store.putAudio({ addedAt: (Store.audio(key) || {}).addedAt || t, ...entry });
      if (msg) toast(msg);
      return true;
    } catch (e) {
      toast(e && e.name === 'QuotaExceededError'
        ? 'Este navegador no tiene espacio para guardar el audio. Borra audios que ya no uses de tu biblioteca.'
        : 'El audio suena, pero este navegador no permitió guardarlo.');
      return false;
    } finally { saving.delete(key); }
  })());
  return saving.get(key);
}
audio.addEventListener('loadedmetadata', () => {
  const key = loadedKey(), a = key && Store.audio(key);
  if (a && isFinite(audio.duration) && !a.dur) Store.putAudio({ key, dur: audio.duration });
});
// Bring back the audio saved for a text. Returns whether that text now has its own audio playing.
async function restoreAudio(meta) {
  const key = meta.audioKey;
  if (!key) return false;
  if (loadedKey() === key) return currentId === meta.id;
  let rec = null;
  try { rec = await AudioStore.get(key); } catch (e) {}
  if (currentId !== meta.id) return false;
  if (loadedKey() === key) return true;
  if (!rec || !rec.blob) { storedAudio.delete(key); renderLib(); return false; }
  setAudio(fileOf(rec), true);
  updateNotice(); renderLib();
  return true;
}
// Load a saved audio on its own: the screen lists its texts, or offers to make one.
async function openAudio(key) {
  if (loadedKey() === key) {
    if (!TX.live && currentId) closeScript();
    closeLib(); return;
  }
  let rec = null;
  try { rec = await AudioStore.get(key); } catch (e) {}
  if (!rec || !rec.blob) { storedAudio.delete(key); renderLib(); toast('Este audio ya no está guardado en el navegador. Elígelo de nuevo.'); return; }
  if (TX.running) txCancel('Transcripción cancelada: abriste otro audio.');
  closeScript();
  setAudio(fileOf(rec), false);
  Store.putAudio({ key, name: rec.name || 'audio', size: rec.blob.size, type: rec.type || rec.blob.type, usedAt: Date.now() });
  Store.setLast(key);
  updateNotice(); closeLib();
}
// Before audios had a library of their own, each text kept its own copy, keyed by the text's id.
// Move those to one copy per audio and point the texts to it. Safe to run again if interrupted.
async function migrateAudio() {
  for (const k of await AudioStore.keys()) {
    if (typeof k === 'string' && k[0] === 'a') { storedAudio.add(k); continue; }
    const rec = await AudioStore.get(k);
    if (rec && rec.blob) {
      const f = fileOf(rec), key = keyOf(f);
      if (!storedAudio.has(key)) { await AudioStore.put(key, f); storedAudio.add(key); }
      const t = rec.savedAt || Date.now();
      Store.putAudio({ key, name: f.name, size: f.size, type: f.type, addedAt: (Store.audio(key) || {}).addedAt || t, usedAt: t });
      Store.patch(k, { audioKey: key, audioName: f.name });
    }
    await AudioStore.del(k);
  }
  renderLib();
}

// Show a script. keepPlayback: do not pause or jump (the audio playing already goes with this text).
function openScript(meta, list, keepPlayback) {
  if (!keepPlayback) pause();
  cues = list; userSrt = true;
  currentId = meta.id; currentMeta = { ...meta };
  if (mode === 'demo' && !keepPlayback) demo.t = 0;
  render();
  $('srtName').textContent = meta.file || meta.name; $('slotSrt').classList.add('ok');
  if (keepPlayback) { resumeFrom = 0; lastSavedPos = -1; }
  else {
    const pos = meta.pos || 0, dur = meta.dur || duration();
    resumeFrom = pos > 3 && pos < dur - 3 ? pos : 0;
    lastSavedPos = pos;
    if (mode === 'audio' && audio.readyState < 1) pendingSeek = resumeFrom || null;
    seek(resumeFrom);
    clearTimeout(saveTimer);
  }
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
  txt.textContent = ''; acts.textContent = '';
  const strong = s => { const b = document.createElement('strong'); b.textContent = s; return b; };
  if (!currentId) {
    // An audio on its own needs no notice: the screen itself lists its texts or offers to make one.
    if (mode === 'demo' && !userSrt && cues.length) {
      txt.append(strong('Este texto es solo un ejemplo.'), ' Para ver el de tu audio necesitas su archivo .srt: elige el audio y el SRT arriba, o arrástralos a la ventana.');
      box.hidden = false;
    } else box.hidden = true;
    return;
  }
  const bits = [];
  if (resumeFrom) bits.push(`seguimos en ${fmt(resumeFrom)}, donde lo dejaste`);
  if (mode !== 'audio') bits.push(currentMeta.audioName ? `elige su audio (${currentMeta.audioName}) para escucharlo` : 'elige su audio para escucharlo');
  if (!bits.length) { box.hidden = true; return; }
  txt.append(strong(currentMeta.name), ': ' + bits.map((b, i) => i ? b[0].toUpperCase() + b.slice(1) : b).join('. ') + '.');
  if (mode !== 'audio') {
    acts.append(nbtn('Elegir audio', () => $('inAudio').click(), true));
    if (spareAudio) {
      const f = spareAudio;
      acts.append(nbtn(`Usar ${f.name}`, () => { setAudio(f, true); pairAudio(f); }));
    }
  }
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
const DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const toSrt = list => list.map((c, i) => `${i + 1}\n${fmtTC(c.start)} --> ${fmtTC(c.end)}\n${c.text}\n`).join('\n');

// A delete button that asks for a second tap before doing anything.
function delBtn(label, armedText, onConfirm) {
  const del = el('button', 'del');
  const reset = () => { del.classList.remove('armed'); del.innerHTML = TRASH; del.setAttribute('aria-label', label); del.title = 'Borrar'; };
  reset();
  del.onclick = async () => {
    if (!del.classList.contains('armed')) {
      del.classList.add('armed'); del.textContent = armedText;
      del.setAttribute('aria-label', 'Confirmar: ' + label[0].toLowerCase() + label.slice(1));
      setTimeout(() => { if (del.isConnected) reset(); }, 3500);
      return;
    }
    try { await onConfirm(); } catch (e) { toast('No pude borrarlo. Prueba de nuevo en unos segundos.'); }
  };
  return del;
}
const progress = m => {
  const dur = m.dur || 0, pos = m.pos || 0;
  return m.id === currentId ? 'Abierto' : pos >= dur - 3 && pos > 0 ? 'Terminado' : pos > 3 ? `Ibas en ${fmt(pos)}` : 'Sin empezar';
};
// One text as a button: what it is, how far you got, how long. In the library and on an audio's screen.
function textButton(m, title, cls) {
  const b = el('button', cls);
  const mt = el('span', 'mt');
  mt.append(el('em', '', progress(m)), ` · ${plural(m.count, 'línea', 'líneas')} · ${ago(m.updatedAt || Date.now())}`);
  const bar = el('span', 'bar'), fill = el('i');
  fill.style.width = (m.dur ? Math.min(100, (m.pos || 0) / m.dur * 100) : 0) + '%';
  bar.append(fill);
  b.append(el('span', 'nm', title), mt, bar);
  b.onclick = () => openFromLib(m);
  return b;
}
function textItem(m, title) {
  const li = el('li', 'item' + (m.id === currentId ? ' on' : ''));
  const dl = el('button', 'del');
  dl.innerHTML = DOWN; dl.title = 'Descargar .srt'; dl.setAttribute('aria-label', `Descargar ${title} como .srt`);
  dl.onclick = () => downloadSrt(m);
  li.append(textButton(m, title, 'open'), dl, delBtn(`Borrar ${title}`, 'Borrar', async () => {
    await Store.remove(m);
    if (m.id === currentId) closeScript();   // its audio stays loaded: the screen lists its other texts
    if (TX.prev && TX.prev.meta.id === m.id) TX.prev = null;   // nothing to bring back after a cancel
    toast(`«${title}» se borró de tu biblioteca.`);
  }));
  return li;
}
function renderLib() {
  // Audios, most recently used first, each with its texts; then the texts whose audio is not saved here.
  const groups = new Map(audios.map(a => [a.key, { a, texts: [], t: a.usedAt || a.addedAt || 0 }]));
  const loose = [];
  for (const m of library) {
    const g = m.audioKey && groups.get(m.audioKey);
    if (g) { g.texts.push(m); g.t = Math.max(g.t, m.updatedAt || 0); } else loose.push(m);
  }
  const list = [...groups.values()].sort((x, y) => y.t - x.t);
  const n = list.length + loose.length;
  $('libCount').textContent = n; $('libCount').hidden = !n;
  $('libSub').textContent = !Store.ready ? 'Cargando tu biblioteca…'
    : Store.kind === 'local' ? 'Tus audios y sus textos, guardados en este navegador: no salen de tu equipo y solo tú los ves.'
    : 'Este navegador no permite guardar nada.';
  $('libEmpty').hidden = !!n || !Store.ready;
  const ul = $('libList');
  ul.textContent = '';
  for (const { a, texts } of list) {
    const li = el('li', 'grp' + (a.key === loadedKey() ? ' on' : ''));
    const hd = el('div', 'ghd');
    const open = el('button', 'gopen');
    open.title = 'Cargar este audio y ver sus textos';
    const ic = el('span', 'gic'); ic.innerHTML = NOTE;
    const info = el('span', 'ginfo');
    const what = texts.length ? plural(texts.length, 'texto', 'textos') : 'sin texto todavía';
    info.append(el('span', 'nm', a.name), el('span', 'mt', (a.dur ? fmt(a.dur) + ' · ' : '') + what));
    open.append(ic, info);
    open.onclick = () => openAudio(a.key);
    const all = texts.length ? ` y ${texts.length === 1 ? 'su texto' : `sus ${texts.length} textos`}` : '';
    hd.append(open, delBtn(`Borrar ${a.name}${all}`, texts.length ? 'Borrar todo' : 'Borrar', () => removeAudio(a, all)));
    li.append(hd);
    if (texts.length) {
      const sub = el('ul', 'gl');
      texts.forEach(m => sub.append(textItem(m, textLabel(m))));
      li.append(sub);
    }
    ul.append(li);
  }
  if (loose.length) {
    const li = el('li', 'grp');
    li.append(el('div', 'gtitle', list.length ? 'Textos sin audio guardado' : 'Textos'));
    const sub = el('ul', 'gl loose');
    loose.forEach(m => { const l = textLabel(m); sub.append(textItem(m, l.startsWith('Whisper') ? `${m.name} · ${l}` : m.name)); });
    li.append(sub); ul.append(li);
  }
  updateEmpty();
}
// Delete an audio and every text made for it.
async function removeAudio(a, all) {
  const key = a.key;
  if (TX.running && loadedKey() === key) txCancel('Transcripción cancelada: borraste su audio.');
  if (currentId && currentMeta.audioKey === key) closeScript();
  if (TX.prev && TX.prev.meta.audioKey === key) TX.prev = null;
  Store.removeAudio(key);
  storedAudio.delete(key);
  await AudioStore.del(key).catch(() => {});
  if (loadedKey() === key) { unloadAudio(); spareAudio = null; cues = []; render(); updateNotice(); Store.setLast(null); }
  renderLib();
  toast(`«${a.name}»${all} ${all ? 'se borraron' : 'se borró'} de tu biblioteca.`);
}
async function downloadSrt(m) {
  let list = null;
  try { list = m.id === currentId && !TX.live ? cues : await Store.load(m); } catch (e) {}
  if (!list || !list.length) { toast('No pude leer este texto.'); return; }
  const l = textLabel(m);
  const name = (l.startsWith('Whisper') ? `${m.name} (${l})` : m.name).replace(/[\\/:*?"<>|]+/g, '-') + '.srt';
  const url = URL.createObjectURL(new Blob([toSrt(list)], { type: 'application/x-subrip' }));
  const a = el('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// Open a saved text with its own audio. Another text of the audio playing keeps it playing; an audio
// loaded on its own is reused when the text never had one saved (and the names match); an audio that
// goes with something else is set aside, never mixed in.
async function openFromLib(m) {
  if (m.id === currentId) { closeLib(); return; }
  let list;
  try { list = await Store.load(m); if (!list.length) throw 0; }
  catch (e) { toast('No pude abrir este texto. Prueba de nuevo en unos segundos.'); return; }
  if (TX.running) txCancel('Transcripción cancelada: abriste otro texto.');
  persistPos(0);
  const key = m.audioKey, same = !!key && loadedKey() === key;
  const stored = !same && !!key && storedAudio.has(key);
  const reuse = !same && !stored && mode === 'audio' && !currentId && (!m.audioName || m.audioName === audio._file.name);
  // Switching between texts of the audio you are listening to keeps your place in it.
  const keep = same && (!!currentId || now() > 1);
  if (!same && !stored && !reuse) unloadAudio();
  openScript(m, list, keep);
  if (reuse) pairAudio(audio._file, true);
  else if (stored && !(await restoreAudio(currentMeta)) && currentId === m.id && mode === 'audio' && !ownsAudio()) unloadAudio();
  if (key && Store.audio(key)) Store.putAudio({ key, usedAt: Date.now() });
  closeLib();
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
$('lib').addEventListener('click', e => { if (e.target.closest('label[for="inSrt"], label[for="inAudio"]')) closeLib(); });

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
// live: lines are arriving on screen; upto: seconds of audio transcribed so far;
// prev: the script that was on screen before, brought back if the transcription is cancelled or fails.
var TX = { running: false, worker: null, reject: null, live: false, upto: 0, prev: null };

// transformers.js and its ONNX Runtime WASM come from jsDelivr (pinned version); the models from
// Hugging Face. Sizes are in bytes and only drive the progress bar and the "Descarga N MB" labels.
const TJS_VERSION = '3.8.1';
const TJS_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TJS_VERSION}/dist/`;
const RUNTIME = { lib: TJS_CDN + 'transformers.min.js', wasm: TJS_CDN + 'ort-wasm-simd-threaded.jsep.wasm', wasmSize: 21596019 };
// Each model lists its variants in order of preference. device 'wasm' runs on the processor (CPU) and works
// everywhere; 'webgpu' runs on the graphics card (GPU). dtype picks the .onnx files transformers.js loads
// (q8 → *_quantized, fp32 → no suffix, fp16 → *_fp16, q4 → *_q4), so it must match the names listed.
// The 8-bit files run poorly on the GPU, hence fp32/fp16 encoders with a 4-bit decoder there; f16 marks
// variants that need 16-bit float shaders. 'auto' is what Auto mode prefers on tablets and computers
// (phones always prefer the CPU): the GPU where it is clearly faster (Base 2.2×, Small several times).
// Tiny gains only 1.2–1.6× on the GPU for almost three times the download, so it stays on the CPU.
// 'limits' keeps big models off devices that would run out of memory.
//
// All models are the onnx-community "_timestamped" exports: their decoder also returns cross-attentions,
// which word timestamps need. With word timestamps off they match the older Xenova exports in accuracy
// and run as fast on the CPU, and much faster on the GPU (Small: 9–15 s against 60–122 s for 56 s of speech).
const hfModel = (id, common, variants, extra) => {
  const files = sizes => Object.entries(sizes).map(([name, size]) => ({ name, size, url: `https://huggingface.co/${id}/resolve/main/${name}` }));
  const shared = files(common);
  return { id, limits: {}, ...extra, variants: variants.map(v => {
    const all = shared.concat(files(v.onnx));
    return { ...v, files: all, size: all.reduce((a, f) => a + f.size, 0) };
  }) };
};
const CPU_Q8 = { device: 'wasm', dtype: 'q8' };
const GPU_FP32 = { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } };
const GPU_FP16 = { device: 'webgpu', f16: true, dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' } };
const MODELS = {
  tiny: hfModel('onnx-community/whisper-tiny_timestamped', {
    'config.json': 2243, 'generation_config.json': 3772, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282683
  }, [
    { ...GPU_FP32, onnx: { 'onnx/encoder_model.onnx': 32894434, 'onnx/decoder_model_merged_q4.onnx': 86804581 } },
    { ...CPU_Q8, onnx: { 'onnx/encoder_model_quantized.onnx': 10097109, 'onnx/decoder_model_merged_quantized.onnx': 30730264 } }
  ], { auto: 'wasm' }),
  base: hfModel('onnx-community/whisper-base_timestamped', {
    'config.json': 2243, 'generation_config.json': 3832, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282682
  }, [
    { ...GPU_FP32, onnx: { 'onnx/encoder_model.onnx': 82451730, 'onnx/decoder_model_merged_q4.onnx': 123738327 } },
    { ...CPU_Q8, onnx: { 'onnx/encoder_model_quantized.onnx': 23159167, 'onnx/decoder_model_merged_quantized.onnx': 53712708 } }
  ], { auto: 'webgpu' }),
  small: hfModel('onnx-community/whisper-small_timestamped', {
    'config.json': 2227, 'generation_config.json': 3893, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282683
  }, [
    { ...GPU_FP16, onnx: { 'onnx/encoder_model_fp16.onnx': 176483570, 'onnx/decoder_model_merged_q4.onnx': 233421212 } },
    { ...GPU_FP32, onnx: { 'onnx/encoder_model.onnx': 352791798, 'onnx/decoder_model_merged_q4.onnx': 233421212 } },
    { ...CPU_Q8, onnx: { 'onnx/encoder_model_quantized.onnx': 92240498, 'onnx/decoder_model_merged_quantized.onnx': 156795750 } }
  ], { auto: 'webgpu', limits: { phone: 'warn', minMem: 2 } }),
  // Whisper Medium is left out on purpose, after testing both ways. On the CPU (32-bit WASM, 4 GB at
  // most) it runs out of memory mid-transcription. On the GPU (fp16 encoder + 4-bit decoder, 1.09 GB)
  // it took 436 s for 56 s of speech and returned 29 of 145 words, cut mid-word; Large v3 Turbo took
  // 24 s with almost no errors.
  turbo: hfModel('onnx-community/whisper-large-v3-turbo_timestamped', {
    'config.json': 1330, 'generation_config.json': 3797, 'preprocessor_config.json': 340,
    'tokenizer.json': 2480645, 'tokenizer_config.json': 282843
  }, [
    { ...GPU_FP16, onnx: { 'onnx/encoder_model_fp16.onnx': 1274403767, 'onnx/decoder_model_merged_q4.onnx': 334207912 } }
  ], { auto: 'webgpu', limits: { phone: 'off', tablet: 'warn', minMem: 4 } })
};
const MODEL_INFO = {
  tiny: { label: 'Tiny', note: 'El más rápido. Bien con voz clara; comete más errores.' },
  base: { label: 'Base', note: 'Más preciso. Tarda más o menos el doble que Tiny.' },
  small: { label: 'Small', note: 'Bastante más preciso que Base, pero más lento.' },
  turbo: { label: 'Large v3 Turbo', note: 'El más preciso. Solo funciona con la tarjeta gráfica (WebGPU).' }
};
const mb = n => n >= 1e9 ? (n / 1e9).toLocaleString('es', { maximumFractionDigits: 1 }) + ' GB' : Math.round(n / 1e6) + ' MB';

/* ---------- this device: what kind it is and what it can run ---------- */
const KIND_LABEL = { phone: 'teléfono', tablet: 'tablet', desktop: 'computadora' };
let devCheck = null;
function deviceInfo() {
  return devCheck || (devCheck = (async () => {
    const ua = navigator.userAgent, touch = navigator.maxTouchPoints > 1;
    const short = Math.min(screen.width, screen.height);
    const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch);   // iPadOS asks for desktop sites, posing as a Mac
    const phone = !iPad && (!!(navigator.userAgentData && navigator.userAgentData.mobile) || /iPhone|iPod/.test(ua)
      || (/Android/.test(ua) && /Mobile/.test(ua)) || (touch && short < 500));
    const gpu = { ok: false, f16: false, name: '' };
    try {
      const a = navigator.gpu && await navigator.gpu.requestAdapter();
      const info = (a && a.info) || {};
      // A software ("fallback") adapter would be slower than the processor itself.
      if (a && !info.isFallbackAdapter && !a.isFallbackAdapter) {
        gpu.ok = true; gpu.f16 = a.features.has('shader-f16');
        gpu.name = [info.vendor, info.architecture].filter(Boolean).join(' ');
      }
    } catch (e) {}
    return { kind: phone ? 'phone' : iPad || /Android/.test(ua) ? 'tablet' : 'desktop', mem: navigator.deviceMemory || null, gpu };
  })());
}
async function freeSpace() {
  try { const e = await navigator.storage.estimate(); return e.quota ? e.quota - (e.usage || 0) : null; } catch (e) { return null; }
}
// Which variants are already in this browser, so Auto never downloads a second copy of a model.
async function cachedVariants() {
  const have = new Set();
  try {
    const keys = new Set((await (await caches.open('transformers-cache')).keys()).map(r => r.url));
    for (const m of Object.values(MODELS)) for (const v of m.variants) if (v.files.every(f => keys.has(f.url))) have.add(v);
  } catch (e) {}
  return have;
}
const txMode = () => S.txDevice || 'auto';

// Decide how a model runs here: the variant (v), or why it can't (off); plus a warning worth showing.
function planModel(key, dev, have, free) {
  const m = MODELS[key], want = txMode(), lim = m.limits;
  const gpuOk = dev.gpu.ok && !(want === 'auto' && S.gpuFailed);
  const fits = m.variants.filter(v => v.device === 'wasm' || (gpuOk && (!v.f16 || dev.gpu.f16)));
  const forced = want === 'cpu' ? 'wasm' : want === 'gpu' && gpuOk ? 'webgpu' : null;
  const pool = forced ? fits.filter(v => v.device === forced) : fits;
  const pref = dev.kind === 'phone' ? 'wasm' : m.auto;
  // Auto: a variant already downloaded beats a new download; between equals, the preferred device wins.
  const rank = x => (have.has(x) ? 2 : 0) + (x.device === pref ? 1 : 0);
  const v = forced || !pool.length ? pool[0] : pool.reduce((a, x) => rank(x) > rank(a) ? x : a);
  const p = { key, m, v, off: '', warn: '' };
  if (lim.phone === 'off' && dev.kind === 'phone') p.off = 'Demasiado grande para un teléfono.';
  else if (lim.minMem && dev.mem && dev.mem < lim.minMem) p.off = 'Este equipo tiene poca memoria para este modelo.';
  else if (!v) {
    const gpuOnly = m.variants.every(x => x.device === 'webgpu');
    p.off = gpuOnly && want === 'cpu' ? 'Solo funciona con la tarjeta gráfica, y en Ajustes elegiste el procesador (CPU).'
      : gpuOnly && !dev.gpu.ok ? 'Necesita una tarjeta gráfica con WebGPU, y este navegador no la ofrece. Prueba con Chrome o Edge recientes.'
      : gpuOnly && S.gpuFailed ? 'La tarjeta gráfica falló antes en este navegador. Para volver a probarla, pulsa Auto o GPU en Ajustes.'
      : 'Tu tarjeta gráfica no admite los cálculos de 16 bits que necesita este modelo.';
  }
  if (p.off) { p.v = null; return p; }
  if (lim[dev.kind] === 'warn') p.warn = `En un${dev.kind === 'tablet' ? 'a tablet' : ' teléfono'} puede ir lento o cerrarse por falta de memoria.`;
  else if (!have.has(v) && free != null && free < v.size * 1.1) p.warn = `Puede que no quepa: a este sitio le quedan unos ${mb(Math.max(0, free))} libres.`;
  return p;
}
function recommendModel(dev, plans) {
  const ok = k => plans[k] && plans[k].v;
  if (dev.kind === 'phone') return dev.mem && dev.mem <= 2 ? 'tiny' : 'base';
  if (dev.kind === 'desktop' && ok('turbo') && (!dev.mem || dev.mem >= 8)) return 'turbo';
  return ok('small') ? 'small' : 'base';
}
function describeDevice(dev) {
  const want = txMode();
  let s = 'Este equipo: ' + KIND_LABEL[dev.kind] + (dev.gpu.ok ? ', con tarjeta gráfica compatible (WebGPU)' : ', sin WebGPU') + '. ';
  if (want === 'gpu' && !dev.gpu.ok) return s + 'Elegiste GPU en Ajustes, pero no está disponible: se usa el procesador.';
  if (want !== 'auto') return s + `Forzado a ${want.toUpperCase()} en Ajustes.`;
  return s + (S.gpuFailed && dev.gpu.ok ? 'La GPU falló antes, así que Auto usa el procesador.' : 'Auto elige GPU o CPU según el modelo.');
}

async function deleteModel(m) {
  const c = await caches.open('transformers-cache');
  await Promise.all(m.variants.flatMap(v => v.files).map(f => c.delete(f.url)));
}
function updateTxBtn() {
  $('txBtn').hidden = mode !== 'audio' || TX.running;
  updateEmpty();
}

async function openTx() {
  if (mode !== 'audio' || !audio._file) { toast('Primero elige el audio que quieres transcribir.'); return; }
  if (TX.running) return;
  if (!window.caches || !window.Worker) { toast('Este navegador no permite transcribir aquí. Abre la página por https o desde localhost.'); return; }
  togglePanel(false); closeLib();
  $('txAudio').textContent = '';
  const nm = document.createElement('strong'); nm.textContent = audio._file.name;
  $('txAudio').append('Audio: ', nm, isFinite(audio.duration) ? ` (${fmt(audio.duration)})` : '');
  const done = [...new Set(textsFor(loadedKey()).map(textLabel).filter(l => l.startsWith('Whisper ')).map(l => l.slice(8)))];
  if (done.length) $('txAudio').append(`. Ya lo transcribiste con ${done.join('; ')}: el nuevo texto quedará junto a ${done.length === 1 ? 'ese' : 'esos'}.`);
  await renderModels(S.txModel);
  $('txLang').value = S.txLang != null ? S.txLang : 'spanish';
  $('tx').hidden = false; $('scrim').hidden = false;
  $('txGo').focus();
}
async function renderModels(want) {
  const [dev, have, free] = await Promise.all([deviceInfo(), cachedVariants(), freeSpace()]);
  const plans = {};
  for (const key of Object.keys(MODELS)) plans[key] = planModel(key, dev, have, free);
  const rec = recommendModel(dev, plans);
  const pick = plans[want] && plans[want].v ? want : plans[rec] && plans[rec].v ? rec : 'tiny';
  $('txDev').textContent = describeDevice(dev);
  const box = $('txModels');
  box.querySelectorAll('.model').forEach(n => n.remove());
  for (const [key, p] of Object.entries(plans)) {
    const info = MODEL_INFO[key] || { label: key, note: '' }, v = p.v;
    const lab = document.createElement('label'); lab.className = 'model';
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'txModel'; r.value = key; r.checked = key === pick; r.disabled = !v;
    const b = document.createElement('b'); b.textContent = info.label;
    const tag = (text, cls) => { const t = document.createElement('span'); t.className = 'tag' + (cls ? ' ' + cls : ''); t.textContent = text; b.append(' ', t); };
    if (v) tag(v.device === 'webgpu' ? 'GPU' : 'CPU');
    if (key === rec && v) tag('Recomendado', 'rec');
    const mt = document.createElement('span'); mt.className = 'mt'; mt.textContent = p.off || info.note;
    if (p.warn) { const w = document.createElement('em'); w.className = 'warn'; w.textContent = ' ' + p.warn; mt.append(w); }
    const st = document.createElement('span'); st.className = 'st';
    const cached = v && have.has(v), any = p.m.variants.some(x => have.has(x));
    st.classList.toggle('ok', !!cached);
    if (v) { const line = document.createElement('span'); line.textContent = (cached ? 'Descargado · ' : 'Descarga ') + mb(v.size); st.append(line); }
    if (any) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'link'; del.textContent = 'Borrar';
      del.setAttribute('aria-label', 'Borrar el modelo ' + info.label + ' de este navegador');
      del.onclick = async ev => {
        ev.preventDefault(); ev.stopPropagation();
        const keep = ($('txModels').querySelector('input:checked') || {}).value;
        try { await deleteModel(p.m); toast('Modelo ' + info.label + ' borrado de este navegador.'); }
        catch (e2) { toast('No pude borrar el modelo.'); }
        renderModels(keep);
      };
      st.append(del);
    }
    lab.append(r, b, st, mt);
    box.append(lab);
  }
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
  leaveLive();
  updateTxBtn(); updateNotice();
  toast(message);
}
// Stop showing a transcription in progress: bring back the script that was on screen before it,
// or the empty "choose a text" state. The audio keeps playing where it was.
function leaveLive() {
  if (!TX.live) return;
  TX.live = false; setPending(null);
  const prev = TX.prev; TX.prev = null;
  if (prev) openScript(prev.meta, prev.cues, true);
  else { cues = []; userSrt = false; render(); resetSrtSlot(); }
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
  const [dev, have] = await Promise.all([deviceInfo(), cachedVariants()]);
  const plan = planModel(key, dev, have, null), v = plan.v;
  if (!v) { toast(plan.off || 'Este modelo no está disponible aquí.'); return; }
  const where = v.device === 'webgpu' ? 'GPU' : 'CPU';
  const name = (MODEL_INFO[key] || {}).label || key, label = `${name} (${where})`;
  const language = $('txLang').value;
  S.txModel = key; S.txLang = language; save();
  closeTx();
  const file = audio._file;
  persistPos(0);
  TX.running = true; updateTxBtn();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  txNotice('Preparando Whisper ' + label + '…', 0);
  let stage = 'prepare';
  try {
    const decoding = decodeAudio(file);
    TX.worker = new Worker('js/worker.js');
    const model = { id: plan.m.id, device: v.device, dtype: v.dtype, files: v.files, size: v.size };
    await txCall({ type: 'prepare', runtime: RUNTIME, model }, [], d => {
      if (d.type === 'download' && d.done < d.total) txNotice(`Descargando el modelo ${label}: ${mb(d.done)} de ${mb(d.total)}. Solo la primera vez.`, d.done / d.total);
      if (d.type === 'stage') txNotice(`Cargando el modelo ${label}…` + (v.size > 5e8 ? ' Con los modelos grandes puede tardar un minuto.' : ''), null);
    });
    if (!TX.running) return;
    stage = 'decode';
    txNotice('Preparando el audio…', null);
    const pcm = await decoding;
    if (!TX.running) return;
    const windows = splitWindows(pcm), total = pcm.length / 16000;
    // Show the lines as they come; the audio can keep playing meanwhile. Whatever was on screen is
    // kept aside and comes back if this is cancelled or fails.
    TX.prev = currentId ? { meta: { ...currentMeta }, cues } : null;
    persistPos(0);
    cues = []; userSrt = true; currentId = null; currentMeta = null; resumeFrom = 0;
    TX.live = true; TX.upto = 0;
    setPending('Transcribiendo… el texto aparecerá aquí en unos segundos.');
    render(); setFollow(true);
    $('srtName').textContent = 'Transcribiendo…'; $('slotSrt').classList.remove('ok');
    const t0 = Date.now();
    stage = 'run';
    txNotice(`Transcribiendo con Whisper ${label}: 0:00 de ${fmt(total)}`, 0);
    await txCall({ type: 'run', audio: pcm, windows, language, words: S.txWords }, [pcm.buffer], d => {
      if (d.type !== 'segment' || !TX.running) return;
      TX.upto = d.upto;
      if (d.segs.length) appendCues(d.segs);
      dirty = true;
      setPending(`Transcribiendo… lo que sigue a ${fmt(d.upto)} aparecerá aquí.`);
      const left = (Date.now() - t0) / d.upto * (total - d.upto) / 1000;
      const eta = left > 90 ? `quedan unos ${Math.round(left / 60)} min` : left > 5 ? 'queda menos de 2 min' : 'casi listo';
      txNotice(`Transcribiendo con Whisper ${label}: ${fmt(d.upto)} de ${fmt(total)} · ${eta}`, d.upto / total);
    });
    if (!TX.running) return;
    TX.running = false;
    if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
    await finishTx(file, `${name}, ${where}`);
  } catch (e) {
    if (e && e.cancelled) return;
    TX.running = false;
    if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
    leaveLive();
    updateTxBtn(); updateNotice(); updateEmpty();
    const msg = String((e && e.message) || e);
    const quota = /QuotaExceeded|quota/i.test(msg);
    // In Auto mode a graphics card that fails is not tried again: remember it and use the processor.
    if (v.device === 'webgpu' && stage !== 'decode' && !quota && txMode() === 'auto' && plan.m.variants.some(x => x.device === 'wasm')) {
      S.gpuFailed = true; save(); updateDevNote();
      if (stage === 'prepare') { toast('La tarjeta gráfica no pudo cargar el modelo. Sigo con el procesador.'); return startTx(); }
      toast('La tarjeta gráfica falló a mitad de la transcripción. Pulsa Transcribir otra vez: ahora usaré el procesador.');
      return;
    }
    toast(stage === 'decode' || /decode|Unable to decode|EncodingError/i.test(msg)
      ? 'Este navegador no pudo leer el audio para transcribirlo. Prueba con un MP3.'
      : quota ? 'No hay espacio en el navegador para guardar el modelo. Borra otro modelo o libera espacio.'
      : 'La transcripción falló' + (v.device === 'webgpu' ? ' en la tarjeta gráfica (prueba con CPU en Ajustes)' : '') + ': ' + msg.slice(0, 160));
  }
}
// The lines are already on screen and the audio may be playing: keep both exactly as they are and just
// turn the transcript into a saved text of this audio, next to any other texts it already had.
async function finishTx(file, label) {
  if (!cues.length) {
    leaveLive();
    updateTxBtn(); updateNotice();
    toast('Whisper no encontró voz en este audio.');
    return;
  }
  TX.live = false; TX.prev = null; setPending(null);
  const list = cues.slice();
  const name = file.name.replace(/\.[^.]+$/, '');
  const t = Date.now(), pos = Math.round(now() * 10) / 10;
  const meta = {
    id: 's' + hash(toSrt(list)), name, file: `${name}.srt (Whisper ${label})`, via: `Whisper ${label}`, count: list.length,
    dur: list[list.length - 1].end, pos, audioName: file.name, audioKey: keyOf(file), createdAt: t, updatedAt: t
  };
  currentId = meta.id; currentMeta = { ...meta }; userSrt = true; resumeFrom = 0; lastSavedPos = pos;
  $('srtName').textContent = meta.file; $('slotSrt').classList.add('ok');
  updateTxBtn(); updateNotice(); updateEmpty(); renderSegs(); dirty = true;
  rememberAudio(file);
  if (Store.kind !== 'none') {
    try {
      await Store.save(meta, list);
      Store.setLast(meta.id);
      const others = textsFor(meta.audioKey).length - 1;
      toast(`Transcripción lista: ${list.length} líneas, guardada en tu biblioteca` + (others > 0 ? ` junto a ${others === 1 ? 'otro texto' : `otros ${others} textos`} de este audio.` : '.'));
    } catch (e) { toast(`Transcripción lista: ${list.length} líneas. No pude guardarla en la biblioteca.`); }
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
updateDevNote();
// Reopen the last script, unless the viewer already loaded an audio or a text meanwhile.
const untouched = () => !userSrt && mode !== 'audio';
Store.initP = withTimeout(Store.init(), 12000).catch(() => { if (Store.kind === 'none') Store.useLocal(); });
Store.initP.then(async () => {
  Store.ready = true; renderLib();
  try { await withTimeout(migrateAudio(), 20000); } catch (e) {}
  try {
    // The last thing on screen: a text (with its audio) or an audio on its own (with its list of texts).
    const last = await withTimeout(Store.getLast(), 6000);
    if (!last || !untouched()) return;
    if (last[0] === 'a') { if (storedAudio.has(last)) openAudio(last); return; }
    const meta = await withTimeout(Store.getMeta(last), 6000);
    if (!meta || !untouched()) return;
    const list = await withTimeout(Store.load(meta), 15000);
    if (list.length && untouched()) { openScript(meta, list); restoreAudio(meta); }
  } catch (e) {}
});
})();
