// Preparing an audio file for Whisper: 16 kHz mono samples, cut into pieces of at most 30 s.

export async function decodeAudio(file) {
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

// Whisper reads at most 30 s at a time: cut at the quietest moment between 20 s and 29 s so words
// stay whole. Returns [start, end] pairs in seconds, without the silent ones.
export function splitWindows(pcm) {
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
