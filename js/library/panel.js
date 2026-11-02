// The library panel: each audio with its texts, and what you can do with them (open, download, delete).
import { state } from '../state.js';
import { $, el, toast } from '../ui.js';
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
import { TX, txCancel } from '../transcribe/run.js';

const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';

// A delete button that asks for a second tap before doing anything.
function delBtn(label, armedText, onConfirm) {
  const del = el('button', 'del');
  const reset = () => { del.classList.remove('armed'); del.innerHTML = TRASH; del.setAttribute('aria-label', label); del.title = 'Borrar'; };
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

// One text as a button: what it is, how far you got, how long. In the library and on an audio's screen.
export function textButton(m, title, cls) {
  const b = el('button', cls);
  const mt = el('span', 'mt');
  mt.append(el('em', '', progress(m, state.currentId)), ` · ${plural(m.count, 'línea', 'líneas')} · ${ago(m.updatedAt || Date.now())}`);
  const bar = el('span', 'bar'), fill = el('i');
  fill.style.width = (m.dur ? Math.min(100, (m.pos || 0) / m.dur * 100) : 0) + '%';
  bar.append(fill);
  b.append(el('span', 'nm', title), mt, bar);
  b.onclick = () => openFromLib(m);
  return b;
}
function textItem(m, title) {
  const li = el('li', 'item' + (m.id === state.currentId ? ' on' : ''));
  const dl = el('button', 'del');
  dl.innerHTML = DOWN; dl.title = 'Descargar .srt'; dl.setAttribute('aria-label', `Descargar ${title} como .srt`);
  dl.onclick = () => downloadSrt(m);
  li.append(textButton(m, title, 'open'), dl, delBtn(`Borrar ${title}`, 'Borrar', async () => {
    await Store.remove(m);
    if (m.id === state.currentId) closeScript();   // its audio stays loaded: the screen lists its other texts
    if (TX.prev && TX.prev.meta.id === m.id) TX.prev = null;   // nothing to bring back after a cancel
    toast(`«${title}» se borró de tu biblioteca.`);
  }));
  return li;
}
function audioGroup(a, texts) {
  const li = el('li', 'grp' + (a.key === loadedKey() ? ' on' : ''));
  const hd = el('div', 'ghd');
  const open = el('button', 'gopen');
  open.title = 'Cargar este audio y ver sus textos';
  const ic = el('span', 'gic'); ic.innerHTML = NOTE;
  const info = el('span', 'ginfo');
  const what = texts.length ? plural(texts.length, 'texto', 'textos') : 'sin texto todavía';
  info.append(el('span', 'nm', a.name), el('span', 'mt', (a.dur ? fmt(a.dur) + ' · ' : '') + what));
  open.append(ic, info);
  open.onclick = () => openAudio(a.key);
  const all = texts.length ? ` y ${texts.length === 1 ? 'su texto' : `sus ${texts.length} textos`}` : '';
  hd.append(open, delBtn(`Borrar ${a.name}${all}`, texts.length ? 'Borrar todo' : 'Borrar', () => removeAudio(a, all)));
  li.append(hd);
  if (texts.length) {
    const sub = el('ul', 'gl');
    texts.forEach(m => sub.append(textItem(m, textLabel(m))));
    li.append(sub);
  }
  return li;
}

export function renderLib() {
  const { list, loose } = groupLibrary(Store.audios, Store.texts);
  const n = list.length + loose.length;
  $('libCount').textContent = n; $('libCount').hidden = !n;
  $('libSub').textContent = !Store.ready ? 'Cargando tu biblioteca…'
    : Store.kind === 'local' ? 'Tus audios y sus textos, guardados en este navegador: no salen de tu equipo y solo tú los ves.'
    : 'Este navegador no permite guardar nada.';
  $('libEmpty').hidden = !!n || !Store.ready;
  const ul = $('libList');
  ul.textContent = '';
  for (const { a, texts } of list) ul.append(audioGroup(a, texts));
  if (loose.length) {
    const li = el('li', 'grp');
    li.append(el('div', 'gtitle', list.length ? 'Textos sin audio guardado' : 'Textos'));
    const sub = el('ul', 'gl loose');
    loose.forEach(m => { const l = textLabel(m); sub.append(textItem(m, l.startsWith('Whisper') ? `${m.name} · ${l}` : m.name)); });
    li.append(sub); ul.append(li);
  }
  updateEmpty();
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
  togglePanel(false);
  $('lib').hidden = false; $('scrim').hidden = false;
  $('libBtn').setAttribute('aria-expanded', 'true');
  $('libClose').focus();
}
export function closeLib() {
  if ($('lib').hidden) return;
  $('lib').hidden = true; $('scrim').hidden = true;
  $('libBtn').setAttribute('aria-expanded', 'false');
  $('libBtn').focus();
}

export function initLibrary() {
  Store.onChange(renderLib);
  $('libBtn').onclick = openLib;
  $('emptyLib').onclick = openLib;
  $('libClose').onclick = closeLib;
  // Choosing a file from inside the panel closes it, so the result is visible.
  $('lib').addEventListener('click', e => { if (e.target.closest('label[for="inSrt"], label[for="inAudio"]')) closeLib(); });
}
