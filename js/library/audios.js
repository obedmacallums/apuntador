// Audio files, kept in this browser (IndexedDB) by audio key: localStorage is far too small for them.
// Each audio is stored once, however many texts it has.
import { toast } from '../ui.js';
import { keyOf } from './data.js';
import { Store } from './texts.js';
import { audio, audioDuration, loadedKey } from '../player.js';

export const AudioStore = {
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
  put(key, f) { return this.run('readwrite', s => s.put({ blob: f, name: f.name, type: f.type, savedAt: Date.now() }, key)); },
  get(key) { return this.run('readonly', s => s.get(key)); },
  del(key) { return this.run('readwrite', s => s.delete(key)); },
  keys() { return this.run('readonly', s => s.getAllKeys()); }
};

export const storedAudio = new Set();   // audio keys whose file is saved in this browser
const saving = new Map();                // audio key → the write in progress, so the same file is not written twice
export const fileOf = rec => new File([rec.blob], rec.name || 'audio', { type: rec.type || rec.blob.type });

// Keep an audio in the library. Resolves to whether its file is saved in this browser. msg: what to
// say once it is saved (nothing if empty).
export function rememberAudio(f, msg) {
  const key = keyOf(f), t = Date.now();
  const dur = loadedKey() === key ? audioDuration() : null;
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

// Before audios had a library of their own, each text kept its own copy, keyed by the text's id.
// Move those to one copy per audio and point the texts to it. Safe to run again if interrupted.
export async function migrateAudio() {
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
}

export function initAudios() {
  // The library shows each audio's length: note it once the player knows it.
  audio.addEventListener('loadedmetadata', () => {
    const key = loadedKey(), a = key && Store.audio(key), dur = audioDuration();
    if (a && dur && !a.dur) Store.putAudio({ key, dur });
  });
}
