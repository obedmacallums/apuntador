// The "Transcribir con Whisper" window: which models this device can run, which are downloaded,
// and the language.
import { $, el, icon, toast } from '../ui.js';
import { fmt, mb } from '../format.js';
import { S, txPrefs, togglePanel } from '../settings.js';
import { textLabel } from '../library/data.js';
import { Store } from '../library/texts.js';
import { closeLib } from '../library/panel.js';
import { closeMenu } from '../chip.js';
import { audioDuration, loadedFile, loadedKey } from '../player.js';
import { MODELS, MODEL_INFO } from './models.js';
import { cachedVariants, deleteModel, describeDevice, deviceInfo, freeSpace, planModel, recommendModel } from './device.js';
import { TX, startTx } from './run.js';

export async function openTx() {
  const f = loadedFile();
  if (!f) { toast('Primero elige el audio que quieres transcribir.'); return; }
  if (TX.running) return;
  if (!window.caches || !window.Worker) { toast('Este navegador no permite transcribir aquí. Abre la página por https o desde localhost.'); return; }
  togglePanel(false); closeLib(); closeMenu();
  $('txName').textContent = f.name;
  $('txName').className = 'tx-nm clamp2';
  const dur = audioDuration();
  const done = [...new Set(Store.textsFor(loadedKey()).map(textLabel).filter(l => l.startsWith('Whisper ')).map(l => l.slice(8)))];
  $('txAudio').textContent = [dur != null ? fmt(dur) : '',
    done.length ? `Ya lo transcribiste con ${done.join('; ')}; el texto nuevo quedará junto a ${done.length === 1 ? 'ese' : 'esos'}.` : ''].filter(Boolean).join(' · ');
  await renderModels(S.txModel);
  $('txLang').value = S.txLang != null ? S.txLang : 'spanish';
  $('tx').hidden = false;
  $('tx').querySelector('.sheet-body').scrollTop = 0;
  $('txGo').focus({ preventScroll: true });
}

// The footer says what pressing Transcribir will do: which model, and whether it downloads first.
function updateGo() {
  const r = $('txList').querySelector('input:checked');
  const lab = r && r.closest('.model');
  $('txGoModel').textContent = lab ? ' con ' + lab.dataset.label : '';
  $('txHint').textContent = !lab ? '' : lab.dataset.cached ? 'Ya está descargado' : `Descarga ${lab.dataset.size}, solo la primera vez`;
  $('txGo').disabled = !r;
}

// One row per model: how it would run here (GPU/CPU), whether it is downloaded, and why not if it can't.
async function renderModels(want) {
  const [dev, have, free] = await Promise.all([deviceInfo(), cachedVariants(), freeSpace()]);
  const prefs = txPrefs(), plans = {};
  for (const key of Object.keys(MODELS)) plans[key] = planModel(key, dev, have, free, prefs);
  const rec = recommendModel(dev, plans);
  const pick = plans[want] && plans[want].v ? want : plans[rec] && plans[rec].v ? rec : 'tiny';
  $('txDev').textContent = describeDevice(dev, prefs);
  const box = $('txList');
  box.textContent = '';
  for (const [key, p] of Object.entries(plans)) {
    const info = MODEL_INFO[key] || { label: key, note: '' }, v = p.v;
    const cached = v && have.has(v), any = p.m.variants.some(x => have.has(x));
    const lab = el('label', 'model');
    lab.dataset.label = info.label;
    if (v) lab.dataset.size = mb(v.size);
    if (cached) lab.dataset.cached = '1';
    const r = el('input');
    r.type = 'radio'; r.name = 'txModel'; r.value = key; r.checked = key === pick; r.disabled = !v;
    r.onchange = updateGo;
    const radio = el('span', 'radio'); radio.setAttribute('aria-hidden', 'true'); radio.append(icon('check'));
    const tx = el('span', 'm-tx'), nm = el('span', 'm-nm', info.label);
    if (v) nm.append(el('span', 'tag', v.device === 'webgpu' ? 'GPU' : 'CPU'));
    if (key === rec && v) nm.append(el('span', 'tag rec', 'Recomendado'));
    const mt = el('span', 'm-mt', p.off || info.note);
    if (p.warn) mt.append(' ', el('em', 'warn', p.warn));
    tx.append(nm, mt);
    const st = el('span', 'st');
    if (cached) st.append(el('span', 'ok', 'Descargado'));
    if (v) st.append(el('span', '', mb(v.size)));
    if (any) {
      const del = el('button', 'link', 'Borrar');
      del.type = 'button';
      del.setAttribute('aria-label', 'Borrar el modelo ' + info.label + ' de este navegador');
      del.onclick = async ev => {
        ev.preventDefault(); ev.stopPropagation();
        const keep = ($('txList').querySelector('input:checked') || {}).value;
        try { await deleteModel(p.m); toast('Modelo ' + info.label + ' borrado de este navegador.'); }
        catch (e2) { toast('No pude borrar el modelo.'); }
        renderModels(keep);
      };
      st.append(del);
    }
    lab.append(r, radio, tx, st);
    box.append(lab);
  }
  updateGo();
}

export function closeTx() {
  if ($('tx').hidden) return;
  $('tx').hidden = true;
}

export function initTranscribe() {
  $('txBtn').onclick = openTx;
  $('txClose').onclick = closeTx;
  $('txBack').onclick = closeTx;
  $('txBackSm').onclick = closeTx;
  $('txGo').onclick = () => startTx().catch(() => toast('No se pudo iniciar la transcripción.'));
}
