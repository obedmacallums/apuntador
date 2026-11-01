// Runs Whisper (transformers.js + ONNX Runtime) off the main thread.
// The library and its WASM come from jsDelivr, the models from Hugging Face. Each file is
// downloaded once and kept in the browser's Cache Storage, so later runs work offline.
let T = null, asr = null, asrId = '';
const post = (type, data) => postMessage(Object.assign({ type }, data || {}));

// Download each missing file with progress and store it under its own URL: transformers.js
// looks models up in 'transformers-cache' by that same URL, so it never downloads them again.
// The body streams straight into the cache, so a 1 GB model never sits whole in memory here.
async function ensureFiles(cache, entries, onBytes) {
  for (const e of entries) {
    if (await cache.match(e.url)) { onBytes(e.size); continue; }
    const r = await fetch(e.url);
    if (!r.ok) throw new Error('No se pudo descargar ' + e.url.split('/').pop() + ' (' + r.status + ')');
    const body = r.body.pipeThrough(new TransformStream({ transform(chunk, ctl) { onBytes(chunk.length); ctl.enqueue(chunk); } }));
    await cache.put(e.url, new Response(body, { headers: { 'content-length': r.headers.get('content-length') || String(e.size) } }));
  }
}

// Word timestamps come one word at a time; group them into prompter lines. A line ends after a long
// pause, at the end of a sentence, at a comma once it is long, or at 20 words. w holds each word's
// start time, so the highlight can follow the voice instead of estimating it.
function linesFromWords(chunks, s, e) {
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

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'prepare') {
      const { runtime, model } = data;
      const total = runtime.wasmSize + model.size;
      let done = 0, last = 0;
      const tick = n => {
        done += n;
        const t = Date.now();
        if (t - last > 150 || done >= total) { last = t; post('download', { done, total }); }
      };
      const rt = await caches.open('apuntador-runtime');
      await ensureFiles(rt, [{ url: runtime.wasm, size: runtime.wasmSize }], tick);
      // Drop runtimes left by an older version of the app.
      for (const req of await rt.keys()) if (req.url !== runtime.wasm) await rt.delete(req);
      const tc = await caches.open('transformers-cache');
      await ensureFiles(tc, model.files, tick);
      post('stage', { stage: 'loading' });
      if (!T) {
        T = await import(runtime.lib);
        // Only errors in the console: ONNX Runtime otherwise warns on every GPU session that it keeps
        // shape ops on the CPU, which is expected and harmless.
        T.env.backends.onnx.logLevel = 'error';
        T.env.allowLocalModels = false;
        T.env.allowRemoteModels = true;
        T.env.useBrowserCache = true;
        const bin = await (await rt.match(runtime.wasm)).arrayBuffer();
        T.env.backends.onnx.wasm.wasmBinary = bin;
        T.env.backends.onnx.wasm.wasmPaths = { wasm: URL.createObjectURL(new Blob([bin], { type: 'application/wasm' })) };
        // GitHub Pages sends no COOP/COEP headers, so there is no SharedArrayBuffer: one thread.
        T.env.backends.onnx.wasm.numThreads = 1;
      }
      if (asrId !== model.id) {
        // logSeverityLevel 3 = errors only; each session sets its own level, so env.logLevel alone is not enough.
        asr = await T.pipeline('automatic-speech-recognition', model.id,
          { dtype: model.dtype, device: model.device, session_options: { logSeverityLevel: 3 } });
        asrId = model.id;
      }
      post('ready');
    } else if (data.type === 'run') {
      const { audio, windows, language, words } = data;
      for (let i = 0; i < windows.length; i++) {
        const [s, e] = windows[i];
        const opts = { task: 'transcribe', return_timestamps: words ? 'word' : true };
        if (language) opts.language = language;
        const out = await asr(audio.subarray(Math.round(s * 16000), Math.round(e * 16000)), opts);
        const segs = words ? linesFromWords(out.chunks || [], s, e) : (out.chunks || []).map(c => {
          const a = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
          const b = c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : e - s;
          return { start: s + a, end: Math.min(e, s + Math.max(b, a + 0.3)), text: (c.text || '').trim() };
        }).filter(c => c.text);
        post('segment', { upto: e, segs });
      }
      post('done');
    }
  } catch (err) {
    post('error', { message: String((err && err.message) || err) });
  }
};
