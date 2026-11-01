// Runs Whisper (transformers.js + ONNX Runtime) off the main thread.
// The library and its WASM come from jsDelivr, the models from Hugging Face. Each file is
// downloaded once and kept in the browser's Cache Storage, so later runs work offline.
let T = null, asr = null, asrId = '';
const post = (type, data) => postMessage(Object.assign({ type }, data || {}));

async function readAll(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('No se pudo descargar ' + url.split('/').pop() + ' (' + r.status + ')');
  const reader = r.body.getReader(), chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); onBytes(value.length);
  }
  return new Blob(chunks);
}
// Download each missing file with progress and store it under its own URL: transformers.js
// looks models up in 'transformers-cache' by that same URL, so it never downloads them again.
async function ensureFiles(cache, entries, onBytes) {
  for (const e of entries) {
    if (await cache.match(e.url)) { onBytes(e.size); continue; }
    const blob = await readAll(e.url, onBytes);
    await cache.put(e.url, new Response(blob, { headers: { 'content-length': String(blob.size) } }));
  }
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
        asr = await T.pipeline('automatic-speech-recognition', model.id, { dtype: 'q8', device: 'wasm' });
        asrId = model.id;
      }
      post('ready');
    } else if (data.type === 'run') {
      const { audio, windows, language } = data;
      for (let i = 0; i < windows.length; i++) {
        const [s, e] = windows[i];
        const opts = { task: 'transcribe', return_timestamps: true };
        if (language) opts.language = language;
        const out = await asr(audio.subarray(Math.round(s * 16000), Math.round(e * 16000)), opts);
        const segs = (out.chunks || []).map(c => {
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
