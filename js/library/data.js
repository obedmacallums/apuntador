// Library records and how they are shown. Pure functions: no storage, no DOM.
//
// A text: { id, name, file, via, count, dur, pos, audioName, audioKey, createdAt, updatedAt }
//   via is the Whisper model that wrote it ("Whisper Small, GPU"), empty for a chosen SRT.
// An audio: { key, name, size, type, dur, addedAt, usedAt }. Each audio can have several texts.
import { fmt, hash } from '../format.js';

// An audio is known by its name and byte size: the same recording picked again gets the same key
// (dates change when files are copied around).
export const keyOf = f => 'a' + hash(f.name + '\n' + f.size);

// What a text is called next to its audio: the Whisper model that wrote it, or its file name.
// Texts saved before "via" existed keep the model in the file name: "x.srt (Whisper Small, CPU)".
export const textLabel = m => m.via || ((m.file || '').match(/\((Whisper [^)]+)\)$/) || [])[1] || m.file || m.name;

// File name for downloading a text as .srt.
export function srtName(m) {
  const l = textLabel(m);
  return (l.startsWith('Whisper') ? `${m.name} (${l})` : m.name).replace(/[\\/:*?"<>|]+/g, '-') + '.srt';
}

// How far you got in a text.
export function progress(m, openId) {
  const dur = m.dur || 0, pos = m.pos || 0;
  return m.id === openId ? 'Abierto' : pos >= dur - 3 && pos > 0 ? 'Terminado' : pos > 3 ? `Ibas en ${fmt(pos)}` : 'Sin empezar';
}

// Audios, most recently used first, each with its texts; then the texts whose audio is not saved here.
export function groupLibrary(audios, texts) {
  const groups = new Map(audios.map(a => [a.key, { a, texts: [], t: a.usedAt || a.addedAt || 0 }]));
  const loose = [];
  for (const m of texts) {
    const g = m.audioKey && groups.get(m.audioKey);
    if (g) { g.texts.push(m); g.t = Math.max(g.t, m.updatedAt || 0); } else loose.push(m);
  }
  return { list: [...groups.values()].sort((x, y) => y.t - x.t), loose };
}

// Lines are stored as [start, end, text] plus, when Whisper gave word times, [start of each word].
export const pack = list => list.map(c => {
  const row = [Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000, c.text];
  if (c.w) row.push(c.w);
  return row;
});
export const unpack = rows => rows.map(([start, end, text, w]) => w ? { start, end, text, w } : { start, end, text });
