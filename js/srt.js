// Reading and writing subtitle files. A line ("cue") is { start, end, text } in seconds, plus w
// (the start time of each word) when Whisper wrote it with word timestamps.
import { fmtTC } from './format.js';

const TC = /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
const toSec = (h, m, s, ms) => (+h || 0) * 3600 + (+m) * 60 + (+s) + (+(ms + '00').slice(0, 3)) / 1000;

// SRT or WebVTT text → lines sorted by start. Formatting tags and empty blocks are dropped.
export function parseSubs(text) {
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

// Lines → SRT text.
export const toSrt = list => list.map((c, i) => `${i + 1}\n${fmtTC(c.start)} --> ${fmtTC(c.end)}\n${c.text}\n`).join('\n');
