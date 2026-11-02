// The library's records, in localStorage: every text (with its lines) and every audio's details.
// The audio files themselves are in IndexedDB (audios.js). Records are described in data.js.
import { pack, unpack } from './data.js';

const LS_LIB = 'apuntador.lib', LS_SCRIPT = 'apuntador.s.';
const listeners = [];

export const Store = {
  kind: 'none',     // 'local' when localStorage works, 'none' otherwise
  ready: false,
  local: null,      // { last, scripts: { id: text }, audios: { key: audio } }; last is a text id or an audio key
  texts: [],        // every text, most recently used first
  audios: [],

  // fn runs after every change.
  onChange(fn) { listeners.push(fn); },
  init() {
    this.kind = 'none';
    try {
      localStorage.setItem('apuntador.t', '1'); localStorage.removeItem('apuntador.t');
      this.kind = 'local';
      const v = JSON.parse(localStorage.getItem(LS_LIB) || 'null');
      this.local = v && v.scripts ? v : { last: null, scripts: {} };
    } catch (e) { this.local = { last: null, scripts: {} }; }
    if (!this.local.audios) this.local.audios = {};
    this.ready = true;
    this.sync(false);
  },
  sync(write = true) {
    if (write) localStorage.setItem(LS_LIB, JSON.stringify(this.local));
    this.texts = Object.values(this.local.scripts).sort((a, b) => b.updatedAt - a.updatedAt);
    this.audios = Object.values(this.local.audios);
    listeners.forEach(fn => fn());
  },
  textsFor(key) { return key ? this.texts.filter(m => m.audioKey === key) : []; },

  // Texts
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
    this.sync();
  },
  patch(id, fields) {
    if (this.kind === 'local' && this.local.scripts[id]) {
      Object.assign(this.local.scripts[id], fields);
      try { this.sync(); } catch (e) {}
    }
  },
  async remove(meta) {
    localStorage.removeItem(LS_SCRIPT + meta.id);
    delete this.local.scripts[meta.id];
    if (this.local.last === meta.id) this.local.last = null;
    this.sync();
  },

  // Audios
  audio(key) { return this.local && this.local.audios[key] || null; },
  putAudio(a) {
    if (this.kind !== 'local') return;
    this.local.audios[a.key] = { ...(this.local.audios[a.key] || {}), ...a };
    try { this.sync(); } catch (e) {}
  },
  // An audio goes with all its texts.
  removeAudio(key) {
    if (this.kind !== 'local') return;
    for (const m of Object.values(this.local.scripts)) if (m.audioKey === key) {
      localStorage.removeItem(LS_SCRIPT + m.id); delete this.local.scripts[m.id];
      if (this.local.last === m.id) this.local.last = null;
    }
    delete this.local.audios[key];
    if (this.local.last === key) this.local.last = null;
    this.sync();
  },

  // What was on screen last: a text id ('s…'), an audio key ('a…') or null.
  setLast(id) {
    if (this.kind === 'local') { this.local.last = id; try { this.sync(); } catch (e) {} }
  },
  getLast() { return this.local ? this.local.last : null; }
};
