// The clock: a real audio file, or a simulated clock for the sample text and for texts with no audio.
import { state } from './state.js';
import { S } from './settings.js';
import { $, toast } from './ui.js';
import { keyOf } from './library/data.js';
import { markDirty, renderSegs, setFollow } from './prompter.js';
import { onPlayback, schedulePersist } from './session.js';
import { updateNotice } from './screen.js';
import { updateTxBtn } from './transcribe/run.js';
import { updateChip } from './chip.js';

// The <audio> element. Only this module changes what it plays; others may read it.
// audio._file is the File playing and audio._key its library key.
export const audio = new Audio();
audio.preload = 'auto';
const demo = { t: 0, playing: false, last: 0 };
let audioUrl = null, triedDataUrl = false, wakeLock = null, pendingSeek = null;

export function now() {
  if (state.mode === 'audio') return audio.currentTime || 0;
  if (demo.playing) {
    const n = performance.now();
    demo.t += (n - demo.last) / 1000 * S.rate;
    demo.last = n;
    if (demo.t >= duration()) { demo.t = duration(); demo.playing = false; onPlayState(); }
  }
  return demo.t;
}
export function duration() {
  const cues = state.cues, last = cues.length ? cues[cues.length - 1].end : 0;
  if (state.mode === 'audio') return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : last;
  return last ? last + 1 : 0;
}
export const isPlaying = () => state.mode === 'audio' ? !audio.paused && !audio.ended : demo.playing;
export function play() {
  if (state.mode === 'audio') {
    audio.play().catch(() => toast('No se pudo reproducir este audio. Prueba con un MP3 distinto.'));
  } else {
    if (!state.cues.length) return;
    if (demo.t >= duration()) demo.t = 0;
    demo.playing = true; demo.last = performance.now(); onPlayState();
  }
}
export function pause() {
  if (state.mode === 'audio') audio.pause();
  else { now(); demo.playing = false; onPlayState(); }
}
export const toggle = () => isPlaying() ? pause() : play();
export function seek(t) {
  t = Math.max(0, Math.min(duration() || 0, t));
  if (state.mode === 'audio') { try { audio.currentTime = t; } catch (e) {} }
  else { demo.t = t; demo.last = performance.now(); }
  setFollow(true); markDirty();
  schedulePersist();
}
// Seek, and if the audio has not loaded yet, seek again once it has.
export function seekWhenReady(t) {
  if (state.mode === 'audio' && audio.readyState < 1) pendingSeek = t || null;
  seek(t);
}
// The speed changed: apply it to the audio, and restart the simulated clock's count from now.
export function syncRate() {
  audio.playbackRate = S.rate;
  if (state.mode === 'demo') { now(); demo.last = performance.now(); }
}

// The library key of the audio in the player, or null.
export const loadedKey = () => state.mode === 'audio' && audio._file ? audio._key : null;
export const loadedFile = () => state.mode === 'audio' ? audio._file : null;
export const audioDuration = () => isFinite(audio.duration) ? audio.duration : null;

// Put a file in the player. keepPos stays at the current second (giving audio to the text on screen).
export function setAudio(f, keepPos) {
  const keep = keepPos ? now() : 0;
  pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(f);
  triedDataUrl = false;
  audio._file = f; audio._key = keyOf(f);
  audio.src = audioUrl;
  audio.playbackRate = S.rate;
  audio.load();
  state.mode = 'audio';
  demo.playing = false;
  pendingSeek = keep > 0 ? keep : null;
  updateNotice(); updateTxBtn(); updateChip();
  setFollow(true); markDirty(); onPlayState();
}
// Take the audio out of the player (it belongs to another text). The text stays, on the simulated clock.
export function unloadAudio() {
  if (state.mode !== 'audio') return;
  const t = now();
  pause();
  state.spareAudio = audio._file;
  audio.removeAttribute('src'); audio.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null; audio._file = null; audio._key = null;
  state.mode = 'demo'; demo.t = t; demo.playing = false;
  updateTxBtn(); updateChip(); markDirty(); onPlayState();
}

// Play/pause button, and keeping the screen awake while playing.
export async function onPlayState() {
  const p = isPlaying();
  $('icPlay').toggleAttribute('hidden', p); $('icPause').toggleAttribute('hidden', !p);
  $('play').setAttribute('aria-label', p ? 'Pausar' : 'Reproducir');
  markDirty();
  onPlayback(p);
  try {
    if (p && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!p && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}

export function initPlayer() {
  ['play', 'pause', 'ended'].forEach(ev => audio.addEventListener(ev, onPlayState));
  ['loadedmetadata', 'durationchange', 'seeked'].forEach(ev => audio.addEventListener(ev, () => { markDirty(); renderSegs(); }));
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek == null) return;
    try { audio.currentTime = Math.min(pendingSeek, audio.duration || pendingSeek); } catch (e) {}
    pendingSeek = null;
  });
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    // Some browsers refuse blob: URLs for some formats; a data: URL usually works.
    if (audio.src.startsWith('blob:') && !triedDataUrl && audio._file) {
      triedDataUrl = true;
      const r = new FileReader();
      r.onload = () => { audio.src = r.result; audio.load(); };
      r.readAsDataURL(audio._file);
    } else {
      toast('Este navegador no puede leer ese audio. Prueba con MP3, M4A o WAV.');
    }
  });
}
