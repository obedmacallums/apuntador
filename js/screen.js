// What the screen says about the current state: the notice under the header, and the empty screen
// (no lines to show: choose something, or pick one of this audio's saved texts).
import { state } from './state.js';
import { $, el, nbtn } from './ui.js';
import { fmt } from './format.js';
import { loadedKey, seek, setAudio } from './player.js';
import { pairAudio } from './session.js';
import { Store } from './library/texts.js';
import { storedAudio } from './library/audios.js';
import { textLabel } from './library/data.js';
import { textButton } from './library/panel.js';
import { TX } from './transcribe/run.js';

export function updateNotice() {
  const box = $('notice'), txt = $('noticeText'), acts = $('noticeActs');
  if (TX.running) return;   // the transcription's progress has the notice
  txt.textContent = ''; acts.textContent = '';
  const strong = s => el('strong', '', s);
  const m = state.currentMeta;
  if (!state.currentId) {
    // An audio on its own needs no notice: the empty screen lists its texts or offers to make one.
    if (state.mode === 'demo' && !state.userSrt && state.cues.length) {
      txt.append(strong('Este texto es solo un ejemplo.'), ' Para ver el de tu audio necesitas su archivo .srt: elige el audio y el SRT arriba, o arrástralos a la ventana.');
      box.hidden = false;
    } else box.hidden = true;
    return;
  }
  const bits = [];
  if (state.resumeFrom) bits.push(`seguimos en ${fmt(state.resumeFrom)}, donde lo dejaste`);
  if (state.mode !== 'audio') bits.push(m.audioName ? `elige su audio (${m.audioName}) para escucharlo` : 'elige su audio para escucharlo');
  if (!bits.length) { box.hidden = true; return; }
  txt.append(strong(m.name), ': ' + bits.map((b, i) => i ? b[0].toUpperCase() + b.slice(1) : b).join('. ') + '.');
  if (state.mode !== 'audio') {
    acts.append(nbtn('Elegir audio', () => $('inAudio').click(), true));
    if (state.spareAudio) {
      const f = state.spareAudio;
      acts.append(nbtn(`Usar ${f.name}`, () => { setAudio(f, true); pairAudio(f); }));
    }
  }
  if (state.resumeFrom) acts.append(nbtn('Empezar desde el principio', () => { state.resumeFrom = 0; seek(0); updateNotice(); }));
  box.hidden = false;
}

export function updateEmpty() {
  const show = !state.cues.length && !TX.live;
  $('empty').hidden = !show;
  const box = $('emptyList');
  box.textContent = '';
  if (!show) return;
  const audioOn = state.mode === 'audio';
  // An audio on its own: the texts already saved for it, to pick one, plus ways to make another.
  const mine = audioOn && !TX.running ? Store.textsFor(loadedKey()) : [];
  box.hidden = !mine.length;
  $('emptyLib').hidden = !Store.texts.length || mine.length > 0;
  $('emptyTx').hidden = !audioOn || TX.running;
  $('emptyTx').textContent = mine.length ? 'Transcribir con otro modelo' : 'Transcribir con Whisper';
  $('emptyTx').classList.toggle('primary', !mine.length);
  if (TX.running) {
    $('emptyTitle').textContent = 'Preparando la transcripción…';
    $('emptyText').textContent = 'El texto irá apareciendo aquí a medida que Whisper lo transcriba. Puedes reproducir el audio mientras tanto.';
  } else if (mine.length) {
    $('emptyTitle').textContent = mine.length === 1 ? 'Este audio ya tiene un texto' : `Este audio tiene ${mine.length} textos`;
    $('emptyText').textContent = 'Elige cuál leer, o crea otro: transcríbelo con otro modelo o elige su archivo .srt.';
    mine.forEach(m => box.append(textButton(m, textLabel(m), 'choice')));
  } else if (audioOn) {
    $('emptyTitle').textContent = 'Falta el texto de este audio';
    $('emptyText').textContent = (storedAudio.has(loadedKey()) ? 'El audio ya está en tu biblioteca. ' : '')
      + 'Transcríbelo aquí mismo con Whisper o elige su archivo .srt: el texto quedará guardado junto al audio.';
  } else {
    $('emptyTitle').textContent = 'Elige qué leer';
    $('emptyText').textContent = 'Elige un audio y su archivo .srt, arrástralos a la ventana o abre algo de tu biblioteca.';
  }
}
