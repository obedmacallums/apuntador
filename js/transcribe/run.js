// Running a transcription: the worker, the lines appearing as they come, and saving the result as a
// new text of the audio, next to any texts it already had.
import { state } from '../state.js';
import { $, nbtn, toast } from '../ui.js';
import { fmt, hash, mb } from '../format.js';
import { toSrt } from '../srt.js';
import { S, save, txPrefs, updateDevNote } from '../settings.js';
import { keyOf } from '../library/data.js';
import { Store } from '../library/texts.js';
import { rememberAudio } from '../library/audios.js';
import { now, loadedFile } from '../player.js';
import { appendCues, markDirty, render, renderSegs, setFollow, setPending } from '../prompter.js';
import { adoptText, openScript, persistPos, showTextName } from '../session.js';
import { updateEmpty, updateNotice } from '../screen.js';
import { MODEL_INFO, RUNTIME } from './models.js';
import { cachedVariants, deviceInfo, planModel } from './device.js';
import { decodeAudio, splitWindows } from './audio.js';
import { closeTx } from './dialog.js';

// running: a transcription is under way. live: its lines are on screen. upto: seconds of audio
// transcribed so far. prev: the text that was on screen before, brought back if it is cancelled or fails.
export const TX = { running: false, worker: null, reject: null, live: false, upto: 0, prev: null };

// The "Transcribir" button shows when there is an audio and nothing is being transcribed.
export function updateTxBtn() {
  $('txBtn').hidden = state.mode !== 'audio' || TX.running;
  updateEmpty();
}

// Progress in the notice bar, with a Cancel button. frac: 0–1, or null for no bar.
function txNotice(text, frac) {
  const box = $('notice'), txt = $('noticeText'), acts = $('noticeActs');
  txt.textContent = ''; acts.textContent = '';
  const s = document.createElement('span'); s.className = 'tx-msg'; s.textContent = text;
  txt.append(s);
  if (frac != null) {
    const bar = document.createElement('span'); bar.className = 'prog';
    const i = document.createElement('i'); i.style.width = Math.round(Math.min(1, frac) * 100) + '%';
    bar.append(i); acts.append(bar);
  }
  acts.append(nbtn('Cancelar', () => txCancel('Transcripción cancelada.')));
  box.hidden = false;
}
// Send the worker a message; resolves on 'ready' or 'done', passes every other message to onEvent.
function txCall(msg, transfer, onEvent) {
  return new Promise((res, rej) => {
    TX.reject = rej;
    TX.worker.onmessage = ({ data }) => {
      if (data.type === 'error') rej(new Error(data.message));
      else if (data.type === 'ready' || data.type === 'done') res(data);
      else onEvent(data);
    };
    TX.worker.onerror = e => { e.preventDefault(); rej(new Error(e.message || 'worker')); };
    TX.worker.postMessage(msg, transfer || []);
  });
}
export function txCancel(message) {
  if (!TX.running) return;
  TX.running = false;
  if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
  if (TX.reject) TX.reject({ cancelled: true });
  leaveLive();
  updateTxBtn(); updateNotice();
  toast(message);
}
// Stop showing a transcription in progress: bring back the text that was on screen before it,
// or the empty "choose a text" screen. The audio keeps playing where it was.
function leaveLive() {
  if (!TX.live) return;
  TX.live = false; setPending(null);
  const prev = TX.prev; TX.prev = null;
  if (prev) openScript(prev.meta, prev.cues, true);
  else { state.cues = []; state.userSrt = false; render(); showTextName(null); }
}

export async function startTx() {
  const key = ($('txModels').querySelector('input:checked') || {}).value || 'tiny';
  const [dev, have] = await Promise.all([deviceInfo(), cachedVariants()]);
  const plan = planModel(key, dev, have, null, txPrefs()), v = plan.v;
  if (!v) { toast(plan.off || 'Este modelo no está disponible aquí.'); return; }
  const where = v.device === 'webgpu' ? 'GPU' : 'CPU';
  const name = (MODEL_INFO[key] || {}).label || key, label = `${name} (${where})`;
  const language = $('txLang').value;
  S.txModel = key; S.txLang = language; save();
  closeTx();
  const file = loadedFile();
  persistPos(0);
  TX.running = true; updateTxBtn();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  txNotice('Preparando Whisper ' + label + '…', 0);
  let stage = 'prepare';
  try {
    const decoding = decodeAudio(file);
    TX.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const model = { id: plan.m.id, device: v.device, dtype: v.dtype, files: v.files, size: v.size };
    await txCall({ type: 'prepare', runtime: RUNTIME, model }, [], d => {
      if (d.type === 'download' && d.done < d.total) txNotice(`Descargando el modelo ${label}: ${mb(d.done)} de ${mb(d.total)}. Solo la primera vez.`, d.done / d.total);
      if (d.type === 'stage') txNotice(`Cargando el modelo ${label}…` + (v.size > 5e8 ? ' Con los modelos grandes puede tardar un minuto.' : ''), null);
    });
    if (!TX.running) return;
    stage = 'decode';
    txNotice('Preparando el audio…', null);
    const pcm = await decoding;
    if (!TX.running) return;
    const windows = splitWindows(pcm), total = pcm.length / 16000;
    // Show the lines as they come; the audio can keep playing meanwhile. Whatever was on screen is
    // kept aside and comes back if this is cancelled or fails.
    TX.prev = state.currentId ? { meta: { ...state.currentMeta }, cues: state.cues } : null;
    persistPos(0);
    state.cues = []; state.userSrt = true; state.currentId = null; state.currentMeta = null; state.resumeFrom = 0;
    TX.live = true; TX.upto = 0;
    setPending('Transcribiendo… el texto aparecerá aquí en unos segundos.');
    render(); setFollow(true);
    $('srtName').textContent = 'Transcribiendo…'; $('slotSrt').classList.remove('ok');
    const t0 = Date.now();
    stage = 'run';
    txNotice(`Transcribiendo con Whisper ${label}: 0:00 de ${fmt(total)}`, 0);
    await txCall({ type: 'run', audio: pcm, windows, language, words: S.txWords }, [pcm.buffer], d => {
      if (d.type !== 'segment' || !TX.running) return;
      TX.upto = d.upto;
      if (d.segs.length) appendCues(d.segs);
      markDirty();
      setPending(`Transcribiendo… lo que sigue a ${fmt(d.upto)} aparecerá aquí.`);
      const left = (Date.now() - t0) / d.upto * (total - d.upto) / 1000;
      const eta = left > 90 ? `quedan unos ${Math.round(left / 60)} min` : left > 5 ? 'queda menos de 2 min' : 'casi listo';
      txNotice(`Transcribiendo con Whisper ${label}: ${fmt(d.upto)} de ${fmt(total)} · ${eta}`, d.upto / total);
    });
    if (!TX.running) return;
    TX.running = false;
    if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
    await finishTx(file, `${name}, ${where}`);
  } catch (e) {
    if (e && e.cancelled) return;
    TX.running = false;
    if (TX.worker) { TX.worker.terminate(); TX.worker = null; }
    leaveLive();
    updateTxBtn(); updateNotice(); updateEmpty();
    const msg = String((e && e.message) || e);
    const quota = /QuotaExceeded|quota/i.test(msg);
    // In Auto mode a graphics card that fails is not tried again: remember it and use the processor.
    if (v.device === 'webgpu' && stage !== 'decode' && !quota && txPrefs().want === 'auto' && plan.m.variants.some(x => x.device === 'wasm')) {
      S.gpuFailed = true; save(); updateDevNote();
      if (stage === 'prepare') { toast('La tarjeta gráfica no pudo cargar el modelo. Sigo con el procesador.'); return startTx(); }
      toast('La tarjeta gráfica falló a mitad de la transcripción. Pulsa Transcribir otra vez: ahora usaré el procesador.');
      return;
    }
    toast(stage === 'decode' || /decode|Unable to decode|EncodingError/i.test(msg)
      ? 'Este navegador no pudo leer el audio para transcribirlo. Prueba con un MP3.'
      : quota ? 'No hay espacio en el navegador para guardar el modelo. Borra otro modelo o libera espacio.'
      : 'La transcripción falló' + (v.device === 'webgpu' ? ' en la tarjeta gráfica (prueba con CPU en Ajustes)' : '') + ': ' + msg.slice(0, 160));
  }
}

// The lines are already on screen and the audio may be playing: keep both exactly as they are and just
// turn the transcript into a saved text of this audio, next to any other texts it already had.
async function finishTx(file, label) {
  if (!state.cues.length) {
    leaveLive();
    updateTxBtn(); updateNotice();
    toast('Whisper no encontró voz en este audio.');
    return;
  }
  TX.live = false; TX.prev = null; setPending(null);
  const list = state.cues.slice();
  const name = file.name.replace(/\.[^.]+$/, '');
  const t = Date.now(), pos = Math.round(now() * 10) / 10;
  const meta = {
    id: 's' + hash(toSrt(list)), name, file: `${name}.srt (Whisper ${label})`, via: `Whisper ${label}`, count: list.length,
    dur: list[list.length - 1].end, pos, audioName: file.name, audioKey: keyOf(file), createdAt: t, updatedAt: t
  };
  adoptText(meta);
  updateTxBtn(); updateNotice(); updateEmpty(); renderSegs(); markDirty();
  rememberAudio(file);
  if (Store.kind !== 'none') {
    try {
      await Store.save(meta, list);
      Store.setLast(meta.id);
      const others = Store.textsFor(meta.audioKey).length - 1;
      toast(`Transcripción lista: ${list.length} líneas, guardada en tu biblioteca` + (others > 0 ? ` junto a ${others === 1 ? 'otro texto' : `otros ${others} textos`} de este audio.` : '.'));
    } catch (e) { toast(`Transcripción lista: ${list.length} líneas. No pude guardarla en la biblioteca.`); }
  } else toast(`Transcripción lista: ${list.length} líneas.`);
}
