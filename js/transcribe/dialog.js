// The "Transcribir con Whisper" window: which models this device can run, which are downloaded,
// and the language.
import { $, toast } from '../ui.js';
import { fmt, mb } from '../format.js';
import { S, txPrefs, togglePanel } from '../settings.js';
import { textLabel } from '../library/data.js';
import { Store } from '../library/texts.js';
import { closeLib } from '../library/panel.js';
import { audioDuration, loadedFile, loadedKey } from '../player.js';
import { MODELS, MODEL_INFO } from './models.js';
import { cachedVariants, deleteModel, describeDevice, deviceInfo, freeSpace, planModel, recommendModel } from './device.js';
import { TX, startTx } from './run.js';

async function openTx() {
  const f = loadedFile();
  if (!f) { toast('Primero elige el audio que quieres transcribir.'); return; }
  if (TX.running) return;
  if (!window.caches || !window.Worker) { toast('Este navegador no permite transcribir aquí. Abre la página por https o desde localhost.'); return; }
  togglePanel(false); closeLib();
  $('txAudio').textContent = '';
  const nm = document.createElement('strong'); nm.textContent = f.name;
  const dur = audioDuration();
  $('txAudio').append('Audio: ', nm, dur != null ? ` (${fmt(dur)})` : '');
  const done = [...new Set(Store.textsFor(loadedKey()).map(textLabel).filter(l => l.startsWith('Whisper ')).map(l => l.slice(8)))];
  if (done.length) $('txAudio').append(`. Ya lo transcribiste con ${done.join('; ')}: el nuevo texto quedará junto a ${done.length === 1 ? 'ese' : 'esos'}.`);
  await renderModels(S.txModel);
  $('txLang').value = S.txLang != null ? S.txLang : 'spanish';
  $('tx').hidden = false; $('scrim').hidden = false;
  $('txGo').focus();
}

// One row per model: how it would run here (GPU/CPU), whether it is downloaded, and why not if it can't.
async function renderModels(want) {
  const [dev, have, free] = await Promise.all([deviceInfo(), cachedVariants(), freeSpace()]);
  const prefs = txPrefs(), plans = {};
  for (const key of Object.keys(MODELS)) plans[key] = planModel(key, dev, have, free, prefs);
  const rec = recommendModel(dev, plans);
  const pick = plans[want] && plans[want].v ? want : plans[rec] && plans[rec].v ? rec : 'tiny';
  $('txDev').textContent = describeDevice(dev, prefs);
  const box = $('txModels');
  box.querySelectorAll('.model').forEach(n => n.remove());
  for (const [key, p] of Object.entries(plans)) {
    const info = MODEL_INFO[key] || { label: key, note: '' }, v = p.v;
    const lab = document.createElement('label'); lab.className = 'model';
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'txModel'; r.value = key; r.checked = key === pick; r.disabled = !v;
    const b = document.createElement('b'); b.textContent = info.label;
    const tag = (text, cls) => { const t = document.createElement('span'); t.className = 'tag' + (cls ? ' ' + cls : ''); t.textContent = text; b.append(' ', t); };
    if (v) tag(v.device === 'webgpu' ? 'GPU' : 'CPU');
    if (key === rec && v) tag('Recomendado', 'rec');
    const mt = document.createElement('span'); mt.className = 'mt'; mt.textContent = p.off || info.note;
    if (p.warn) { const w = document.createElement('em'); w.className = 'warn'; w.textContent = ' ' + p.warn; mt.append(w); }
    const st = document.createElement('span'); st.className = 'st';
    const cached = v && have.has(v), any = p.m.variants.some(x => have.has(x));
    st.classList.toggle('ok', !!cached);
    if (v) { const line = document.createElement('span'); line.textContent = (cached ? 'Descargado · ' : 'Descarga ') + mb(v.size); st.append(line); }
    if (any) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'link'; del.textContent = 'Borrar';
      del.setAttribute('aria-label', 'Borrar el modelo ' + info.label + ' de este navegador');
      del.onclick = async ev => {
        ev.preventDefault(); ev.stopPropagation();
        const keep = ($('txModels').querySelector('input:checked') || {}).value;
        try { await deleteModel(p.m); toast('Modelo ' + info.label + ' borrado de este navegador.'); }
        catch (e2) { toast('No pude borrar el modelo.'); }
        renderModels(keep);
      };
      st.append(del);
    }
    lab.append(r, b, st, mt);
    box.append(lab);
  }
}

export function closeTx() {
  if ($('tx').hidden) return;
  $('tx').hidden = true;
  if ($('lib').hidden) $('scrim').hidden = true;
}

export function initTranscribe() {
  $('txBtn').onclick = openTx;
  $('emptyTx').onclick = openTx;
  $('txClose').onclick = closeTx;
  $('txBack').onclick = closeTx;
  $('txGo').onclick = () => startTx().catch(() => toast('No se pudo iniciar la transcripción.'));
}
