// Choosing files: an audio, a subtitle file, or both, from the pickers or dropped on the window.
// Which text goes with which audio is decided in pairing.js.
import { state } from './state.js';
import { $, toast } from './ui.js';
import { fmt, hash } from './format.js';
import { parseSubs } from './srt.js';
import { forAudio, forSubs } from './pairing.js';
import { keyOf } from './library/data.js';
import { Store } from './library/texts.js';
import { rememberAudio, storedAudio } from './library/audios.js';
import { renderLib } from './library/panel.js';
import { loadedKey, loadedFile, setAudio, unloadAudio } from './player.js';
import { openScript, closeScript, pairAudio, restoreAudio, persistPos, ownsAudio } from './session.js';
import { updateNotice } from './screen.js';
import { TX, txCancel } from './transcribe/run.js';

const isSub = f => /\.(srt|vtt)$/i.test(f.name);
const isAudio = f => (f.type || '').startsWith('audio/') || /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus|weba)$/i.test(f.name);
const isStored = key => storedAudio.has(key);

// A new audio file. It joins the open text only when that text is still waiting for its audio
// (the "choose the SRT, then its MP3" flow). Otherwise it is another recording: the text closes and
// the screen lists the texts already saved for this audio, if any.
function chooseAudio(f) {
  const key = keyOf(f);
  const choice = forAudio(key, { loaded: loadedKey(), open: state.currentMeta, owns: ownsAudio(), isStored });
  if (choice === 'loaded') { toast('Ese audio ya está cargado.'); return; }
  if (choice === 'pair') {
    const before = state.currentMeta.audioName, other = !!before && before !== f.name;
    setAudio(f, true);
    pairAudio(f, other);   // quiet when warning, so the warning stays on screen
    if (other) toast(`Lo uso con «${state.currentMeta.name}», aunque antes iba con «${before}».`);
    return;
  }
  const closed = state.currentId ? state.currentMeta.name : '';
  closeScript();
  setAudio(f, false);
  updateNotice();
  rememberAudio(f).then(ok => { if (ok && !state.currentId && loadedKey() === key) Store.setLast(key); });
  if (closed) toast(`Audio nuevo: cerré «${closed}», que sigue en tu biblioteca.`);
}

// A subtitle file. withAudio: it came together with an audio file, so they are paired no matter what.
async function chooseSubs(f, withAudio) {
  let text;
  try { text = await f.text(); } catch (e) { toast('No pude leer ' + f.name + '.'); return; }
  const c = parseSubs(text);
  if (!c.length) { toast(`No encontré subtítulos en ${f.name}. Cada línea necesita un tiempo como 00:00:01,000 --> 00:00:03,500.`); return; }
  persistPos(0);
  const id = 's' + hash(text.replace(/\r\n?/g, '\n').trim());
  let saved = null;
  try { saved = await Store.getMeta(id); } catch (e) {}
  const t = Date.now();
  const meta = saved ? { ...saved, updatedAt: t } : {
    id, name: f.name.replace(/\.(srt|vtt)$/i, ''), file: f.name, count: c.length,
    dur: c[c.length - 1].end, pos: 0, audioName: '', createdAt: t, updatedAt: t
  };
  const d = forSubs(meta, { loaded: loadedKey(), withAudio, textOpen: !!state.currentId, isStored });
  const aside = d.setAside ? loadedFile().name : '';
  if (d.setAside) unloadAudio();
  openScript(meta, c, d.pair || d.same);
  if (d.pair) pairAudio(loadedFile(), true);
  else if (d.stored && !(await restoreAudio(state.currentMeta)) && state.currentId === id && state.mode === 'audio' && !ownsAudio()) unloadAudio();
  if (!saved && Store.kind !== 'none') {
    try { await Store.save({ ...meta, audioName: state.currentMeta.audioName || '', audioKey: state.currentMeta.audioKey || '' }, c); renderLib(); }
    catch (e) {
      const full = e && (e.code === 'quota_exceeded' || e.name === 'QuotaExceededError');
      toast(full ? 'No queda espacio para guardar más textos. Borra alguno de la biblioteca.'
                 : 'El texto está abierto, pero no pude guardarlo en la biblioteca.');
      return;
    }
  } else if (saved) Store.patch(id, { updatedAt: t });
  if (state.currentId !== id) return;
  const where = saved ? 'Ya estaba en tu biblioteca.' : `Guardado en tu biblioteca: ${c.length} líneas.`;
  toast(aside ? `${where} Quité «${aside}» porque va con otro texto; si también es de este, pulsa «Usar ${aside}».`
    : `${where}` + (state.resumeFrom ? ` Seguimos en ${fmt(state.resumeFrom)}.` : state.mode === 'audio' ? ' Pulsa reproducir.' : ' Elige su audio para escucharlo.'));
}

export function handleFiles(list) {
  const files = [...list];
  const a = files.find(isAudio), s = files.find(isSub);
  if (TX.running && (a || s)) txCancel('Transcripción cancelada: cargaste otro archivo.');
  if (a && s) { closeScript(); setAudio(a, false); chooseSubs(s, true); }   // chosen together: they go together
  else if (a) chooseAudio(a);
  else if (s) chooseSubs(s);
  const other = files.filter(f => !isAudio(f) && !isSub(f));
  if (other.length) toast(`«${other[0].name}» no es un audio ni un archivo .srt.`);
}

export function initFiles() {
  $('inAudio').addEventListener('change', e => { if (e.target.files[0]) handleFiles(e.target.files); e.target.value = ''; });
  $('inSrt').addEventListener('change', e => { if (e.target.files[0]) handleFiles(e.target.files); e.target.value = ''; });
  let dragDepth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });
}
