// The library panel: each audio with its texts, and what you can do with them (open, download, delete).
import { state } from '../state.js';
import { $, el, icon, midName, toast } from '../ui.js';
import { ago, fmt, plural } from '../format.js';
import { toSrt } from '../srt.js';
import { forLibraryText } from '../pairing.js';
import { groupLibrary, progress, srtName, textLabel } from './data.js';
import { Store } from './texts.js';
import { AudioStore, fileOf, storedAudio } from './audios.js';
import { loadedKey, loadedFile, now, setAudio, unloadAudio } from '../player.js';
import { render } from '../prompter.js';
import { openScript, closeScript, pairAudio, restoreAudio, persistPos, ownsAudio } from '../session.js';
import { updateEmpty, updateNotice } from '../screen.js';
import { togglePanel } from '../settings.js';
import { closeMenu, updateChip } from '../chip.js';
import { TX, txCancel } from '../transcribe/run.js';
import { openTx } from '../transcribe/dialog.js';

// A delete button that asks for a second tap before doing anything: a trash icon, or a text link.
function delBtn(label, armedText, onConfirm, text) {
  const del = el('button', text ? 'link' : 'del');
  del.type = 'button';
  const reset = () => {
    del.classList.remove('armed');
    if (text) del.textContent = text; else del.replaceChildren(icon('trash'));
    del.setAttribute('aria-label', label); del.title = label;
  };
  reset();
  del.onclick = async () => {
    if (!del.classList.contains('armed')) {
      del.classList.add('armed'); del.textContent = armedText;
      del.setAttribute('aria-label', 'Confirmar: ' + label[0].toLowerCase() + label.slice(1));
      setTimeout(() => { if (del.isConnected) reset(); }, 3500);
      return;
    }
    try { await onConfirm(); } catch (e) { toast('No pude borrarlo. Prueba de nuevo en unos segundos.'); }
  };
  return del;
}

// How far you got in a text, and how long it is: "Ibas en 1:42 · 48 líneas · ayer".
export const textMeta = m => `${progress(m, null)} · ${plural(m.count, 'línea', 'líneas')} · ${ago(m.updatedAt || Date.now())}`;
export function progressBar(m) {
  const bar = el('span', 'bar'), fill = el('i');
  fill.style.width = (m.dur ? Math.min(100, (m.pos || 0) / m.dur * 100) : 0) + '%';
  bar.append(fill);
  return bar;
}

// One text in the library: its name (with "Abierto" when it is on screen), how far you got, and its
// buttons to download it as .srt or delete it.
function textItem(m, title) {
  const open = m.id === state.currentId;
  const row = el('div', 'item');
  const b = el('button', 'open');
  b.type = 'button';
  const top = el('span', 'i-top');
  top.append(midName(title, 'i-nm'));
  if (open) top.append(el('span', 'i-tag', 'Abierto'));
  const mt = el('span', 'i-mt');
  mt.append(el('span', '', textMeta(m)));
  if ((m.pos || 0) > 3 && progress(m, null) !== 'Terminado') mt.append(progressBar(m));
  b.append(top, mt);
  b.onclick = () => openFromLib(m);
  const dl = el('button', 'del');
  dl.type = 'button'; dl.append(icon('down'));
  dl.title = 'Descargar .srt'; dl.setAttribute('aria-label', `Descargar ${title} como .srt`);
  dl.onclick = () => downloadSrt(m);
  row.append(b, dl, delBtn(`Borrar ${title}`, 'Borrar', async () => {
    await Store.remove(m);
    if (m.id === state.currentId) closeScript();   // its audio stays loaded: the screen lists its other texts
    if (TX.prev && TX.prev.meta.id === m.id) TX.prev = null;   // nothing to bring back after a cancel
    toast(`«${title}» se borró de tu biblioteca.`);
  }));
  return row;
}

// Load an audio (if it is not already) and open the transcription window for it.
async function transcribeAudio(key) {
  if (loadedKey() !== key) await openAudio(key);
  if (loadedKey() === key) openTx();
}

// An audio: open it on its own (the screen lists its texts), its texts, and what else to do with it.
function audioGroup(a, texts) {
  const on = a.key === loadedKey();
  const sec = el('section', 'grp' + (on ? ' on' : ''));
  const hd = el('div', 'ghd');
  const open = el('button', 'gopen');
  open.type = 'button'; open.title = 'Cargar este audio y ver sus textos';
  const tile = el('span', 'tile' + (on ? '' : ' mute')); tile.append(icon('note'));
  const info = el('span', 'ginfo');
  const what = texts.length ? plural(texts.length, 'texto', 'textos') : 'sin texto todavía';
  info.append(midName(a.name, 'g-nm'), el('span', 'g-mt', (a.dur ? fmt(a.dur) + ' · ' : '') + what + (on ? ' · abierto' : '')));
  open.append(tile, info, icon('chevR'));
  open.onclick = () => openAudio(a.key);
  hd.append(open);
  if (!texts.length && !TX.running) {
    const tx = el('button', 'btn soft', 'Transcribir');
    tx.type = 'button'; tx.onclick = () => transcribeAudio(a.key);
    hd.append(tx);
  }
  sec.append(hd);
  if (texts.length) {
    const sub = el('div', 'gl');
    texts.forEach(m => sub.append(textItem(m, textLabel(m))));
    sec.append(sub);
  }
  const ft = el('div', 'gft');
  if (on && texts.length && !TX.running) {
    const more = el('button', 'link accent', 'Transcribir con otro modelo');
    more.type = 'button'; more.onclick = () => transcribeAudio(a.key);
    ft.append(more);
  } else ft.append(el('span'));
  const all = texts.length ? ` y ${texts.length === 1 ? 'su texto' : `sus ${texts.length} textos`}` : '';
  ft.append(delBtn(`Borrar ${a.name}${all}`, texts.length ? 'Sí, borrar con sus textos' : 'Sí, borrar', () => removeAudio(a, all), 'Borrar audio'));
  sec.append(ft);
  return sec;
}

export function renderLib() {
  const { list, loose } = groupLibrary(Store.audios, Store.texts);
  const n = list.length + loose.length;
  $('libCount').textContent = n; $('libCount').hidden = !n;
  $('libSub').textContent = !Store.ready ? 'Cargando tu biblioteca…'
    : Store.kind !== 'local' ? 'Este navegador no permite guardar nada.'
    : n ? `${plural(Store.audios.length, 'audio', 'audios')} y ${plural(Store.texts.length, 'texto', 'textos')}, guardados en este navegador: no salen de tu equipo.`
    : 'Tus audios y sus textos, guardados en este navegador: no salen de tu equipo y solo tú los ves.';
  $('libEmpty').hidden = !!n || !Store.ready;
  const box = $('libList');
  box.textContent = '';
  for (const { a, texts } of list) box.append(audioGroup(a, texts));
  if (loose.length) {
    if (list.length) box.append(el('h3', 'lib-h3', 'Textos sin su audio'));
    const sec = el('section', 'grp'), sub = el('div', 'gl');
    loose.forEach(m => { const l = textLabel(m); sub.append(textItem(m, l.startsWith('Whisper') ? `${m.name} · ${l}` : m.file || m.name)); });
    sec.append(sub); box.append(sec);
  }
  updateEmpty(); updateChip();
}

// Delete an audio and every text made for it.
async function removeAudio(a, all) {
  const key = a.key;
  if (TX.running && loadedKey() === key) txCancel('Transcripción cancelada: borraste su audio.');
  if (state.currentId && state.currentMeta.audioKey === key) closeScript();
  if (TX.prev && TX.prev.meta.audioKey === key) TX.prev = null;
  Store.removeAudio(key);
  storedAudio.delete(key);
  await AudioStore.del(key).catch(() => {});
  if (loadedKey() === key) { unloadAudio(); state.spareAudio = null; state.cues = []; render(); updateNotice(); Store.setLast(null); }
  renderLib();
  toast(`«${a.name}»${all} ${all ? 'se borraron' : 'se borró'} de tu biblioteca.`);
}

async function downloadSrt(m) {
  let list = null;
  try { list = m.id === state.currentId && !TX.live ? state.cues : await Store.load(m); } catch (e) {}
  if (!list || !list.length) { toast('No pude leer este texto.'); return; }
  const url = URL.createObjectURL(new Blob([toSrt(list)], { type: 'application/x-subrip' }));
  const a = el('a'); a.href = url; a.download = srtName(m);
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Open a saved text with its own audio. Another text of the audio playing keeps it playing; an audio
// loaded on its own is reused when the text never had one saved (and the names match); an audio that
// goes with something else is set aside, never mixed in.
export async function openFromLib(m) {
  if (m.id === state.currentId) { closeLib(); return; }
  let list;
  try { list = await Store.load(m); if (!list.length) throw 0; }
  catch (e) { toast('No pude abrir este texto. Prueba de nuevo en unos segundos.'); return; }
  if (TX.running) txCancel('Transcripción cancelada: abriste otro texto.');
  persistPos(0);
  const f = loadedFile();
  const d = forLibraryText(m, { loaded: loadedKey(), loadedName: f && f.name, textOpen: !!state.currentId, isStored: k => storedAudio.has(k), position: now() });
  if (!d.same && !d.stored && !d.reuse) unloadAudio();
  openScript(m, list, d.keep);
  if (d.reuse) pairAudio(loadedFile(), true);
  else if (d.stored && !(await restoreAudio(state.currentMeta)) && state.currentId === m.id && state.mode === 'audio' && !ownsAudio()) unloadAudio();
  if (m.audioKey && Store.audio(m.audioKey)) Store.putAudio({ key: m.audioKey, usedAt: Date.now() });
  closeLib();
}

// Load a saved audio on its own: the screen lists its texts, or offers to make one.
export async function openAudio(key) {
  if (loadedKey() === key) {
    if (!TX.live && state.currentId) closeScript();
    closeLib(); return;
  }
  let rec = null;
  try { rec = await AudioStore.get(key); } catch (e) {}
  if (!rec || !rec.blob) { storedAudio.delete(key); renderLib(); toast('Este audio ya no está guardado en el navegador. Elígelo de nuevo.'); return; }
  if (TX.running) txCancel('Transcripción cancelada: abriste otro audio.');
  closeScript();
  setAudio(fileOf(rec), false);
  Store.putAudio({ key, name: rec.name || 'audio', size: rec.blob.size, type: rec.type || rec.blob.type, usedAt: Date.now() });
  Store.setLast(key);
  updateNotice(); closeLib();
}

export function openLib() {
  togglePanel(false); closeMenu();
  $('lib').hidden = false;
  $('libBtn').setAttribute('aria-expanded', 'true');
  $('libClose').focus();
}
export function closeLib() {
  if ($('lib').hidden) return;
  $('lib').hidden = true;
  $('libBtn').setAttribute('aria-expanded', 'false');
  $('libBtn').focus();
}

export function initLibrary() {
  Store.onChange(renderLib);
  $('libBtn').onclick = openLib;
  $('libClose').onclick = closeLib;
  // Choosing a file from inside the panel closes it, so the result is visible.
  $('lib').addEventListener('click', e => { if (e.target.closest('label[for="inSrt"], label[for="inAudio"]')) closeLib(); });
}
