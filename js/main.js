// Apuntador de Audio: a teleprompter that follows an audio line by line with its SRT, and can write
// that SRT itself with Whisper, in the browser. This file starts the app; each part lives in its module:
//
//   state.js        what is on screen, shared by the modules below
//   player.js       the clock: audio file or simulated
//   prompter.js     the lines, the reading arrow, the word-by-word highlight, the seek bar
//   screen.js       the notice and the empty screen
//   session.js      the open text: open, close, its audio, where you left it
//   files.js        choosing files; pairing.js decides which text goes with which audio
//   settings.js     settings and the Ajustes panel
//   controls.js     transport buttons, keyboard, full screen
//   library/        saved texts (texts.js) and audios (audios.js), and the panel (panel.js)
//   transcribe/     Whisper: models, device detection, the dialog, the run, and the worker
import { state } from './state.js';
import { withTimeout } from './format.js';
import { applySettings, initSettings, updateDevNote } from './settings.js';
import { initPlayer, onPlayState } from './player.js';
import { initPrompter, render } from './prompter.js';
import { initSession, openScript, restoreAudio, untouched } from './session.js';
import { initFiles } from './files.js';
import { initControls } from './controls.js';
import { Store } from './library/texts.js';
import { initAudios, migrateAudio, storedAudio } from './library/audios.js';
import { initLibrary, openAudio, renderLib } from './library/panel.js';
import { initTranscribe } from './transcribe/dialog.js';

// The sample text shown until you choose something, on a simulated clock.
function sampleCues() {
  const lines = [
    'Hola. Este es un ejemplo con reloj simulado, sin audio de por medio.',
    'Arriba eliges tu archivo MP3 y su archivo SRT, o los arrastras a esta ventana.',
    'La línea que suena se marca y se queda siempre a la altura de la flecha.',
    'Con el resaltado palabra a palabra, la frase se ilumina mientras avanza.',
    'Toca cualquier línea para saltar a ese momento del audio.',
    'Si te desplazas a mano, el seguimiento se pausa hasta que pulses «Volver a la línea actual».',
    'En Ajustes cambias el tamaño de la letra, la velocidad o activas el modo espejo.',
    'Si la voz y el texto no coinciden, corrige la sincronía en décimas de segundo.',
    'En el teclado, la barra espaciadora reproduce o pausa y las flechas te mueven.',
    'Cada audio se guarda en tu biblioteca con sus textos, y la próxima vez sigues donde lo dejaste.'
  ];
  let t = 0.6;
  return lines.map(text => {
    const d = Math.max(2.4, text.split(' ').length / 2.6);
    const c = { start: t, end: t + d, text };
    t += d + 0.35;
    return c;
  });
}

// Reopen the last thing on screen: a text (with its audio) or an audio on its own (with its texts),
// unless the viewer already chose something meanwhile.
async function reopenLast() {
  const last = Store.getLast();
  if (!last || !untouched()) return;
  if (last[0] === 'a') { if (storedAudio.has(last)) openAudio(last); return; }
  const meta = await Store.getMeta(last);
  if (!meta || !untouched()) return;
  const list = await withTimeout(Store.load(meta), 15000);
  if (list.length && untouched()) { openScript(meta, list); restoreAudio(meta); }
}

initPlayer();
initPrompter();
initSettings();
initControls();
initFiles();
initSession();
initLibrary();
initAudios();
initTranscribe();

state.cues = sampleCues();
applySettings();
render();
onPlayState();
renderLib();
updateDevNote();
Store.init();
(async () => {
  try { await withTimeout(migrateAudio(), 20000); } catch (e) {}
  renderLib();
  try { await reopenLast(); } catch (e) {}
})();
