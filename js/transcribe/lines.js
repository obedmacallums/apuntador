// Turning Whisper's output for one piece of audio into prompter lines. Pure functions: the worker
// uses them, and the tests check them without running a model. s and e are the piece's start and
// end in the whole audio, in seconds; Whisper's times are relative to the piece.

// Word timestamps come one word at a time; group them into lines. A line ends after a long pause,
// at the end of a sentence, at a comma once it is long, or at 20 words. w holds each word's start
// time, so the highlight can follow the voice instead of estimating it.
export function linesFromWords(chunks, s, e) {
  const lines = [];
  let cur = null, lead = '';
  const close = () => { if (cur) lines.push(cur); cur = null; };
  for (const c of chunks) {
    let text = (c.text || '').trim();
    if (!text) continue;
    if (/^[¿¡(«"“]+$/.test(text)) { lead += text; continue; }            // opening marks go with the next word
    if (/^[.,;:!?…)»"”]+$/.test(text) && cur) { cur.words[cur.words.length - 1] += text; }
    else {
      const ts = c.timestamp || [];
      const a = s + (ts[0] != null ? ts[0] : 0), b = Math.min(e, s + (ts[1] != null ? ts[1] : ts[0] != null ? ts[0] : 0));
      if (cur && a - cur.end > 0.8) close();
      if (!cur) cur = { start: a, end: a, words: [], w: [] };
      cur.words.push(lead + text); lead = '';
      cur.w.push(Math.round(a * 100) / 100);
      cur.end = Math.max(cur.end, b);
    }
    const last = cur.words[cur.words.length - 1], n = cur.words.length;
    if (/[.!?…]["”»)]?$/.test(last) || (n >= 10 && /[,;:]$/.test(last)) || n >= 20) close();
  }
  close();
  return lines.map(l => ({ start: l.start, end: Math.max(l.end, l.start + 0.3), text: l.words.join(' '), w: l.w }));
}

// Segment timestamps (word timestamps off): one line per segment Whisper returns.
export function linesFromSegments(chunks, s, e) {
  return chunks.map(c => {
    const a = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
    const b = c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : e - s;
    return { start: s + a, end: Math.min(e, s + Math.max(b, a + 0.3)), text: (c.text || '').trim() };
  }).filter(c => c.text);
}
