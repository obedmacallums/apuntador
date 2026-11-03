// What the screen says about the current state: the notice under the header, and the empty screen
// (nothing to read: open something, transcribe this audio, or pick one of its saved texts).
import { state } from './state.js';
import { $, el, icon, midName, nameBtn, nbtn } from './ui.js';
import { fmt, plural } from './format.js';
import { loadedKey, seek, setAudio } from './player.js';
import { pairAudio } from './session.js';
import { Store } from './library/texts.js';
import { storedAudio } from './library/audios.js';
import { groupLibrary, textLabel } from './library/data.js';
import { openAudio, openFromLib, openLib, progressBar, textMeta } from './library/panel.js';
import { TX } from './transcribe/run.js';
import { openTx } from './transcribe/dialog.js';

// Clear the notice card and give it an icon. tx: it shows transcription progress (with its bar).
export function noticeFrame(ic, tx) {
  $('notice').firstElementChild.classList.toggle('tx', !!tx);
  const box = $('noticeIc');
  box.className = 'n-ic' + (tx ? ' accent' : '') + (ic === 'spin' ? ' spin' : '');
  if (box.dataset.ic !== ic) { box.dataset.ic = ic; box.replaceChildren(icon(ic)); }   // progress updates keep the spinner turning
  $('noticeText').textContent = ''; $('noticeActs').textContent = '';
  $('noticeBar').hidden = true;
}

export function updateNotice() {
  if (TX.running) return;   // the transcription's progress has the notice
  const box = $('notice'), txt = $('noticeText'), acts = $('noticeActs');
  noticeFrame('info');
  const m = state.currentMeta;
  if (!state.currentId) {
    // An audio on its own needs no notice: the empty screen lists its texts or offers to make one.
    if (state.mode === 'demo' && !state.userSrt && state.cues.length) {
      txt.append(el('strong', '', 'Este texto es solo un ejemplo.'), ' Para ver el de tu audio, elige el audio y su SRT, o arrástralos a la ventana.');
      box.hidden = false;
    } else box.hidden = true;
    return;
  }
  const bits = [];
  if (state.resumeFrom) bits.push(`seguimos en ${fmt(state.resumeFrom)}, donde lo dejaste`);
  if (state.mode !== 'audio') bits.push(m.audioName ? `elige su audio (${m.audioName}) para escucharlo` : 'elige su audio para escucharlo');
  if (!bits.length) { box.hidden = true; return; }
  txt.append(el('strong', '', m.name + ':'), ' ' + bits.map((b, i) => i ? b[0].toUpperCase() + b.slice(1) : b).join('. ') + '.');
  if (state.mode !== 'audio') {
    acts.append(nbtn('Elegir audio', () => $('inAudio').click(), true));
    if (state.spareAudio) {
      const f = state.spareAudio;
      acts.append(nameBtn('Usar', f.name, () => { setAudio(f, true); pairAudio(f); }));
    }
  }
  if (state.resumeFrom) acts.append(nbtn('Empezar desde el principio', () => { state.resumeFrom = 0; seek(0); updateNotice(); }));
  box.hidden = false;
}

// A button that picks a file: a label for one of the hidden file inputs.
function fileBtn(text, input, primary) {
  const l = el('label', 'btn' + (primary ? ' primary' : ''), text);
  l.htmlFor = input;
  return l;
}
function textBtn(text, onClick) {
  const b = el('button', 'txtbtn', text);
  b.type = 'button'; b.onclick = onClick;
  return b;
}
// A row in a list: an icon, a name cut in the middle, a details line, and an arrow.
function row(ic, mute, name, meta, onClick, extra) {
  const b = el('button', 'rowbtn');
  b.type = 'button';
  const tile = el('span', 'tile' + (mute ? ' mute' : '')); tile.append(icon(ic));
  const tx = el('span', 'r-tx');
  tx.append(midName(name, 'r-nm'), el('span', 'r-mt', meta));
  if (extra) tx.append(extra);
  b.append(tile, tx, icon('chevR'));
  b.onclick = onClick;
  return b;
}

export function updateEmpty() {
  const show = !state.cues.length && !TX.live;
  const box = $('empty');
  box.hidden = !show;
  box.textContent = '';
  if (!show) return;
  const inner = el('div', 'empty-in');
  box.append(inner);
  const head = (ic, title, text) => {
    const h = el('div', 'e-head'), i = el('span', 'e-ic');
    i.append(icon(ic));
    h.append(i, el('h1', '', title), el('p', '', text));
    inner.append(h);
  };
  const audioOn = state.mode === 'audio';
  // An audio on its own: the texts already saved for it, to pick one, plus ways to make another.
  const mine = audioOn && !TX.running ? Store.textsFor(loadedKey()) : [];

  if (TX.running) {
    head('wave', 'Preparando la transcripción…', 'El texto irá apareciendo aquí a medida que Whisper lo transcriba. Puedes reproducir el audio mientras tanto.');
  } else if (mine.length) {
    head('doc', mine.length === 1 ? 'Este audio ya tiene un texto' : `Este audio tiene ${mine.length} textos`,
      'Elige cuál leer, o crea otro: transcríbelo con otro modelo o elige su archivo .srt.');
    const list = el('div', 'e-list'), rows = el('div', 'rows');
    mine.forEach(m => rows.append(row('doc', false, textLabel(m), textMeta(m), () => openFromLib(m), (m.pos || 0) > 3 ? progressBar(m) : null)));
    list.append(rows);
    const acts = el('div', 'e-acts');
    acts.append(nbtn('Transcribir con otro modelo', openTx), fileBtn('Elegir SRT', 'inSrt'));
    inner.append(list, acts);
  } else if (audioOn) {
    head('note', 'Este audio aún no tiene texto', (storedAudio.has(loadedKey()) ? 'Ya está guardado en tu biblioteca. ' : '')
      + 'Transcríbelo con Whisper en tu dispositivo, o elige el archivo .srt que lo acompaña.');
    const st = el('div', 'e-stack');
    st.append(nbtn('Transcribir con Whisper', openTx, true), fileBtn('Elegir SRT', 'inSrt'));
    if (Store.texts.length || Store.audios.length > 1) st.append(textBtn('Abrir la biblioteca', openLib));
    inner.append(st);
  } else {
    head('note', 'Abre un audio para empezar', 'Elige el audio y su SRT, o arrástralos aquí. Si aún no tienes el texto, Whisper lo escribe en tu dispositivo.');
    const drop = el('div', 'e-drop'), words = el('span'), acts = el('div', 'e-acts');
    words.append(el('strong', '', 'Suelta aquí tu audio y tu SRT'), el('small', '', 'Puedes soltar los dos a la vez'));
    acts.append(fileBtn('Elegir audio', 'inAudio', true), fileBtn('Elegir SRT', 'inSrt'));
    drop.append(icon('up'), words, acts);
    inner.append(drop);
    // The most recent audios, to pick up where you left off.
    const { list } = groupLibrary(Store.audios, Store.texts);
    if (list.length) {
      const rec = el('div', 'e-list'), hd = el('div', 'e-list-hd'), rows = el('div', 'rows');
      hd.append(el('h2', '', 'Recientes'), textBtn('Ver la biblioteca', openLib));
      list.slice(0, 3).forEach(({ a, texts }) => rows.append(row('note', true, a.name,
        (a.dur ? fmt(a.dur) + ' · ' : '') + (texts.length ? plural(texts.length, 'texto', 'textos') : 'sin texto'), () => openAudio(a.key))));
      rec.append(hd, rows);
      inner.append(rec);
    }
  }
}
