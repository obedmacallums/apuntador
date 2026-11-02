// The open text: opening and closing it, giving it its audio, and remembering where you left it.
import { state } from './state.js';
import { $ } from './ui.js';
import { keyOf } from './library/data.js';
import { Store } from './library/texts.js';
import { rememberAudio, storedAudio, AudioStore, fileOf } from './library/audios.js';
import { renderLib } from './library/panel.js';
import { now, duration, pause, seekWhenReady, loadedKey, setAudio, isPlaying } from './player.js';
import { render, setFollow } from './prompter.js';
import { updateNotice } from './screen.js';

let lastSavedPos = -1, saveTimer = 0;

// The audio playing is the open text's own.
export const ownsAudio = () => !!state.currentId && !!state.currentMeta.audioKey && state.currentMeta.audioKey === loadedKey();

// The "Texto" slot in the header: the open text's file name, or the prompt to choose one.
export function showTextName(name) {
  $('srtName').textContent = name || 'Elegir SRT';
  $('slotSrt').classList.toggle('ok', !!name);
}

// Show a text. keepPlayback: do not pause or jump (the audio playing already goes with this text).
export function openScript(meta, list, keepPlayback) {
  if (!keepPlayback) pause();
  state.cues = list; state.userSrt = true;
  state.currentId = meta.id; state.currentMeta = { ...meta };
  render();
  showTextName(meta.file || meta.name);
  if (keepPlayback) { state.resumeFrom = 0; lastSavedPos = -1; }
  else {
    const pos = meta.pos || 0, dur = meta.dur || duration();
    state.resumeFrom = pos > 3 && pos < dur - 3 ? pos : 0;
    lastSavedPos = pos;
    seekWhenReady(state.resumeFrom);
    clearTimeout(saveTimer);
  }
  setFollow(true);
  Store.setLast(meta.id);
  updateNotice(); renderLib();
}

// A transcription that just finished becomes the open text, without touching the lines or the audio.
export function adoptText(meta) {
  state.currentId = meta.id; state.currentMeta = { ...meta };
  state.userSrt = true; state.resumeFrom = 0; lastSavedPos = meta.pos;
  showTextName(meta.file);
}

// Close the text on screen. It stays in the library. An audio left in the player is what the next
// visit reopens, with the list of its texts.
export function closeScript() {
  persistPos(0);
  state.cues = []; state.userSrt = false; state.currentId = null; state.currentMeta = null; state.resumeFrom = 0;
  render(); showTextName(null);
  const key = loadedKey();
  Store.setLast(key && storedAudio.has(key) ? key : null);
  updateNotice(); renderLib();
}

// The loaded audio now belongs to the open text: it joins that audio's texts in the library.
export function pairAudio(f, quiet) {
  if (!state.currentId) return;
  const key = keyOf(f), m = state.currentMeta;
  if (state.spareAudio === f) state.spareAudio = null;
  if (m.audioKey !== key || m.audioName !== f.name) {
    m.audioKey = key; m.audioName = f.name;
    Store.patch(state.currentId, { audioKey: key, audioName: f.name });
  }
  rememberAudio(f, quiet ? '' : 'Audio guardado en tu biblioteca: la próxima vez se abrirá con su texto.');
  updateNotice(); renderLib();
}

// Bring back the audio saved for a text. Returns whether that text now has its own audio playing.
export async function restoreAudio(meta) {
  const key = meta.audioKey;
  if (!key) return false;
  if (loadedKey() === key) return state.currentId === meta.id;
  let rec = null;
  try { rec = await AudioStore.get(key); } catch (e) {}
  if (state.currentId !== meta.id) return false;
  if (loadedKey() === key) return true;
  if (!rec || !rec.blob) { storedAudio.delete(key); renderLib(); return false; }
  setAudio(fileOf(rec), true);
  updateNotice(); renderLib();
  return true;
}

// Save the playback second for the open text, only when it moved by at least minDelta.
export function persistPos(minDelta) {
  if (!state.currentId || Store.kind === 'none') return;
  const t = Math.round(now() * 10) / 10;
  if (Math.abs(t - lastSavedPos) < Math.max(minDelta, 0.05)) return;
  lastSavedPos = t; state.currentMeta.pos = t;
  Store.patch(state.currentId, { pos: t, updatedAt: Date.now() });
}
// After a seek, save the new position once the viewer stops moving around.
export function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistPos(1), 1500);
}
// Playback started or stopped.
export function onPlayback(playing) {
  if (playing && state.resumeFrom) { state.resumeFrom = 0; updateNotice(); }
  if (!playing) persistPos(1);
}

// Nothing chosen yet in this visit (only the sample text on screen).
export const untouched = () => !state.userSrt && state.mode !== 'audio';

export function initSession() {
  setInterval(() => { if (isPlaying()) persistPos(2); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistPos(0); });
  addEventListener('pagehide', () => persistPos(0));
}
