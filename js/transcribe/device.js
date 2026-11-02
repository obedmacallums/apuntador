// This device: what kind it is, what it can run, and how each model would run on it.
// The decisions (planModel, recommendModel, describeDevice) are pure: they take the device, the
// viewer's preferences and what is downloaded, so the tests can try any device.
//
// prefs: { want: 'auto' | 'gpu' | 'cpu', gpuFailed: the GPU failed before in Auto mode }
import { mb } from '../format.js';
import { MODELS } from './models.js';

export const KIND_LABEL = { phone: 'teléfono', tablet: 'tablet', desktop: 'computadora' };

// { kind: 'phone' | 'tablet' | 'desktop', mem: GB or null, gpu: { ok, f16, name } }
export async function detectDevice(nav, scr) {
  const ua = nav.userAgent, touch = nav.maxTouchPoints > 1;
  const short = Math.min(scr.width, scr.height);
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch);   // iPadOS asks for desktop sites, posing as a Mac
  const phone = !iPad && (!!(nav.userAgentData && nav.userAgentData.mobile) || /iPhone|iPod/.test(ua)
    || (/Android/.test(ua) && /Mobile/.test(ua)) || (touch && short < 500));
  const gpu = { ok: false, f16: false, name: '' };
  try {
    const a = nav.gpu && await nav.gpu.requestAdapter();
    const info = (a && a.info) || {};
    // A software ("fallback") adapter would be slower than the processor itself.
    if (a && !info.isFallbackAdapter && !a.isFallbackAdapter) {
      gpu.ok = true; gpu.f16 = a.features.has('shader-f16');
      gpu.name = [info.vendor, info.architecture].filter(Boolean).join(' ');
    }
  } catch (e) {}
  return { kind: phone ? 'phone' : iPad || /Android/.test(ua) ? 'tablet' : 'desktop', mem: nav.deviceMemory || null, gpu };
}
let devCheck = null;
export const deviceInfo = () => devCheck || (devCheck = detectDevice(navigator, screen));

export async function freeSpace() {
  try { const e = await navigator.storage.estimate(); return e.quota ? e.quota - (e.usage || 0) : null; } catch (e) { return null; }
}

// The variants whose files are all among these cached URLs.
export function variantsIn(urls) {
  const have = new Set();
  for (const m of Object.values(MODELS)) for (const v of m.variants) if (v.files.every(f => urls.has(f.url))) have.add(v);
  return have;
}
// Which variants are already in this browser, so Auto never downloads a second copy of a model.
export async function cachedVariants() {
  try { return variantsIn(new Set((await (await caches.open('transformers-cache')).keys()).map(r => r.url))); }
  catch (e) { return new Set(); }
}
export async function deleteModel(m) {
  const c = await caches.open('transformers-cache');
  await Promise.all(m.variants.flatMap(v => v.files).map(f => c.delete(f.url)));
}

// Decide how a model runs here: the variant (v), or why it can't (off); plus a warning worth showing.
export function planModel(key, dev, have, free, prefs) {
  const m = MODELS[key], want = prefs.want, lim = m.limits;
  const gpuOk = dev.gpu.ok && !(want === 'auto' && prefs.gpuFailed);
  const fits = m.variants.filter(v => v.device === 'wasm' || (gpuOk && (!v.f16 || dev.gpu.f16)));
  const forced = want === 'cpu' ? 'wasm' : want === 'gpu' && gpuOk ? 'webgpu' : null;
  const pool = forced ? fits.filter(v => v.device === forced) : fits;
  const pref = dev.kind === 'phone' ? 'wasm' : m.auto;
  // Auto: a variant already downloaded beats a new download; between equals, the preferred device wins.
  const rank = x => (have.has(x) ? 2 : 0) + (x.device === pref ? 1 : 0);
  const v = forced || !pool.length ? pool[0] : pool.reduce((a, x) => rank(x) > rank(a) ? x : a);
  const p = { key, m, v, off: '', warn: '' };
  if (lim.phone === 'off' && dev.kind === 'phone') p.off = 'Demasiado grande para un teléfono.';
  else if (lim.minMem && dev.mem && dev.mem < lim.minMem) p.off = 'Este equipo tiene poca memoria para este modelo.';
  else if (!v) {
    const gpuOnly = m.variants.every(x => x.device === 'webgpu');
    p.off = gpuOnly && want === 'cpu' ? 'Solo funciona con la tarjeta gráfica, y en Ajustes elegiste el procesador (CPU).'
      : gpuOnly && !dev.gpu.ok ? 'Necesita una tarjeta gráfica con WebGPU, y este navegador no la ofrece. Prueba con Chrome o Edge recientes.'
      : gpuOnly && prefs.gpuFailed ? 'La tarjeta gráfica falló antes en este navegador. Para volver a probarla, pulsa Auto o GPU en Ajustes.'
      : 'Tu tarjeta gráfica no admite los cálculos de 16 bits que necesita este modelo.';
  }
  if (p.off) { p.v = null; return p; }
  if (lim[dev.kind] === 'warn') p.warn = `En un${dev.kind === 'tablet' ? 'a tablet' : ' teléfono'} puede ir lento o cerrarse por falta de memoria.`;
  else if (!have.has(v) && free != null && free < v.size * 1.1) p.warn = `Puede que no quepa: a este sitio le quedan unos ${mb(Math.max(0, free))} libres.`;
  return p;
}

export function recommendModel(dev, plans) {
  const ok = k => plans[k] && plans[k].v;
  if (dev.kind === 'phone') return dev.mem && dev.mem <= 2 ? 'tiny' : 'base';
  if (dev.kind === 'desktop' && ok('turbo') && (!dev.mem || dev.mem >= 8)) return 'turbo';
  return ok('small') ? 'small' : 'base';
}

export function describeDevice(dev, prefs) {
  const want = prefs.want;
  const s = 'Este equipo: ' + KIND_LABEL[dev.kind] + (dev.gpu.ok ? ', con tarjeta gráfica compatible (WebGPU)' : ', sin WebGPU') + '. ';
  if (want === 'gpu' && !dev.gpu.ok) return s + 'Elegiste GPU en Ajustes, pero no está disponible: se usa el procesador.';
  if (want !== 'auto') return s + `Forzado a ${want.toUpperCase()} en Ajustes.`;
  return s + (prefs.gpuFailed && dev.gpu.ok ? 'La GPU falló antes, así que Auto usa el procesador.' : 'Auto elige GPU o CPU según el modelo.');
}
