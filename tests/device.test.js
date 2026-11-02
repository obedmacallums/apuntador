// How each model would run on different devices: phone, tablet or computer; with or without WebGPU;
// with GPU or CPU forced in Ajustes; with models already downloaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice, variantsIn, planModel, recommendModel, describeDevice } from '../js/transcribe/device.js';
import { MODELS } from '../js/transcribe/models.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  androidTab: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'
};
// gpu: 'none' (no WebGPU), 'f16' (with 16-bit shaders), 'nof16', 'fallback' (software adapter)
const gpuOf = g => g === 'none' ? undefined : {
  requestAdapter: async () => ({ info: { vendor: 'test', architecture: 'gpu', isFallbackAdapter: g === 'fallback' },
    features: new Set(g === 'f16' ? ['shader-f16'] : []) })
};
const files = (repo, names) => ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', ...names]
  .map(n => `https://huggingface.co/onnx-community/${repo}/resolve/main/${n}`);
const smallCpu = files('whisper-small_timestamped', ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']);
const tinyCpu = files('whisper-tiny_timestamped', ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']);
const tinyGpu = files('whisper-tiny_timestamped', ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx']);

// The plan for every model, shown as 'CPU', 'GPU32', 'GPU16', with '!' for a warning, or 'off'.
async function plan(d, prefs = {}, cached = []) {
  const nav = { userAgent: UA[d.ua], maxTouchPoints: d.touch || 0, deviceMemory: d.mem, gpu: gpuOf(d.gpu),
    userAgentData: d.uad === undefined ? undefined : { mobile: d.uad } };
  const dev = await detectDevice(nav, { width: d.w, height: d.h });
  const p = { want: 'auto', gpuFailed: false, ...prefs }, have = variantsIn(new Set(cached));
  const plans = {};
  for (const k of Object.keys(MODELS)) plans[k] = planModel(k, dev, have, d.free ?? null, p);
  const show = k => { const x = plans[k]; return x.v ? (x.v.device === 'webgpu' ? 'GPU' : 'CPU') + (x.v.f16 ? '16' : x.v.device === 'webgpu' ? '32' : '') + (x.warn ? '!' : '') : 'off'; };
  return { got: { kind: dev.kind, rec: recommendModel(dev, plans), tiny: show('tiny'), base: show('base'), small: show('small'), turbo: show('turbo') }, dev, prefs: p, plans };
}
const pick = (got, want) => Object.fromEntries(Object.keys(want).map(k => [k, got[k]]));
const scenario = (name, d, want, prefs, cached) => test(name, async () => {
  const { got } = await plan(d, prefs, cached);
  assert.deepEqual(pick(got, want), want);
});

const mac = { ua: 'mac', w: 1512, h: 982, mem: 8, gpu: 'f16' };
scenario('iPhone, Safari 26 con WebGPU', { ua: 'iphone', touch: 5, w: 390, h: 844, gpu: 'f16' },
  { kind: 'phone', rec: 'base', tiny: 'CPU', base: 'CPU', small: 'CPU!', turbo: 'off' });
scenario('Android, 4 GB, WebGPU', { ua: 'android', uad: true, touch: 5, w: 412, h: 915, mem: 4, gpu: 'f16' },
  { kind: 'phone', rec: 'base', small: 'CPU!', turbo: 'off' });
scenario('Android, 2 GB, sin GPU', { ua: 'android', uad: true, touch: 5, w: 360, h: 760, mem: 2, gpu: 'none' },
  { kind: 'phone', rec: 'tiny', small: 'CPU!', turbo: 'off' });
scenario('Android, 1 GB', { ua: 'android', uad: true, touch: 5, w: 360, h: 640, mem: 1, gpu: 'none' },
  { kind: 'phone', rec: 'tiny', small: 'off', turbo: 'off' });
scenario('iPad (se presenta como Mac), WebGPU', { ua: 'ipad', touch: 5, w: 820, h: 1180, gpu: 'f16' },
  { kind: 'tablet', rec: 'small', tiny: 'CPU', base: 'GPU32', small: 'GPU16', turbo: 'GPU16!' });
scenario('Tablet Android sin WebGPU', { ua: 'androidTab', uad: false, touch: 10, w: 800, h: 1280, mem: 8, gpu: 'none' },
  { kind: 'tablet', rec: 'small', small: 'CPU', turbo: 'off' });
scenario('Mac, 8 GB, GPU fp16', mac,
  { kind: 'desktop', rec: 'turbo', tiny: 'CPU', base: 'GPU32', small: 'GPU16', turbo: 'GPU16' });
scenario('PC, 4 GB, GPU sin fp16', { ua: 'win', w: 1920, h: 1080, mem: 4, gpu: 'nof16' },
  { kind: 'desktop', rec: 'small', base: 'GPU32', small: 'GPU32', turbo: 'off' });
scenario('PC con pantalla táctil', { ua: 'win', touch: 10, w: 1920, h: 1080, mem: 8, gpu: 'f16' },
  { kind: 'desktop', rec: 'turbo' });
scenario('PC, 2 GB', { ua: 'win', w: 1366, h: 768, mem: 2, gpu: 'f16' },
  { kind: 'desktop', rec: 'small', small: 'GPU16', turbo: 'off' });
scenario('Firefox sin WebGPU', { ua: 'firefox', w: 1512, h: 982, gpu: 'none' },
  { kind: 'desktop', rec: 'small', small: 'CPU', turbo: 'off' });
scenario('Adaptador WebGPU por software', { ua: 'win', w: 1920, h: 1080, mem: 8, gpu: 'fallback' },
  { small: 'CPU', turbo: 'off' });
scenario('Mac con CPU forzada', mac, { rec: 'small', tiny: 'CPU', base: 'CPU', small: 'CPU', turbo: 'off' }, { want: 'cpu' });
scenario('Mac con GPU forzada', mac, { tiny: 'GPU32', base: 'GPU32', small: 'GPU16', turbo: 'GPU16' }, { want: 'gpu' });
scenario('Firefox con GPU forzada (no hay GPU)', { ua: 'firefox', w: 1512, h: 982, gpu: 'none' },
  { tiny: 'CPU', small: 'CPU', turbo: 'off' }, { want: 'gpu' });
scenario('Mac en Auto después de que la GPU falló', mac, { rec: 'small', base: 'CPU', small: 'CPU', turbo: 'off' }, { gpuFailed: true });
scenario('Auto prefiere Small ya bajado en CPU', mac, { small: 'CPU' }, {}, smallCpu);
scenario('GPU forzada ignora Small bajado en CPU', mac, { small: 'GPU16' }, { want: 'gpu' }, smallCpu);
scenario('Poco espacio libre', { ...mac, free: 3e8 }, { small: 'GPU16!', turbo: 'GPU16!' });
scenario('Tiny bajado en GPU y CPU: Auto usa CPU', mac, { tiny: 'CPU' }, {}, [...tinyCpu, ...tinyGpu]);
scenario('Tiny bajado solo en GPU: no lo baja otra vez', mac, { tiny: 'GPU32' }, {}, tinyGpu);
scenario('iPhone con Tiny bajado solo en GPU', { ua: 'iphone', touch: 5, w: 390, h: 844, gpu: 'f16' }, { tiny: 'GPU32' }, {}, tinyGpu);

test('los modelos apagados explican por qué', async () => {
  const { plans } = await plan({ ua: 'android', uad: true, touch: 5, w: 360, h: 640, mem: 1, gpu: 'none' });
  assert.equal(plans.turbo.off, 'Demasiado grande para un teléfono.');
  assert.equal(plans.small.off, 'Este equipo tiene poca memoria para este modelo.');
  const cpu = await plan(mac, { want: 'cpu' });
  assert.match(cpu.plans.turbo.off, /elegiste el procesador/);
});

test('la nota de Ajustes describe el equipo y el modo', async () => {
  const { dev } = await plan(mac);
  assert.equal(describeDevice(dev, { want: 'auto', gpuFailed: false }), 'Este equipo: computadora, con tarjeta gráfica compatible (WebGPU). Auto elige GPU o CPU según el modelo.');
  assert.match(describeDevice(dev, { want: 'cpu', gpuFailed: false }), /Forzado a CPU en Ajustes\.$/);
  assert.match(describeDevice(dev, { want: 'auto', gpuFailed: true }), /La GPU falló antes/);
});

test('los tamaños de descarga suman sus archivos', () => {
  for (const m of Object.values(MODELS)) for (const v of m.variants) {
    assert.equal(v.size, v.files.reduce((a, f) => a + f.size, 0));
    assert.ok(v.files.every(f => f.url.startsWith(`https://huggingface.co/${m.id}/resolve/main/`)));
  }
});
