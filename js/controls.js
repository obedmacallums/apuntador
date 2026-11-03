// Transport buttons, keyboard shortcuts and full screen.
import { $, toast } from './ui.js';
import { now, seek, toggle } from './player.js';
import { stepLine } from './prompter.js';
import { S, setFs, toggleMirror, togglePanel } from './settings.js';
import { openLib, closeLib } from './library/panel.js';
import { closeTx } from './transcribe/dialog.js';
import { closeMenu } from './chip.js';

function toggleFs() {
  if (!document.fullscreenEnabled) return;
  (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
    .catch(() => toast('Pantalla completa no disponible aquí.'));
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tgt = e.target;
  const onControl = tgt.closest && tgt.closest('button, input, label');
  if (e.key === 'Escape') { togglePanel(false); closeMenu(); closeLib(); closeTx(); return; }
  if (!$('lib').hidden || !$('tx').hidden || !$('menu').hidden) return;
  if (tgt.type === 'range') return;
  switch (e.key) {
    case ' ':
      if (onControl) return;
      e.preventDefault(); toggle(); break;
    case 'ArrowLeft': e.preventDefault(); seek(now() - 5); break;
    case 'ArrowRight': e.preventDefault(); seek(now() + 5); break;
    case 'ArrowUp': e.preventDefault(); stepLine(-1); break;
    case 'ArrowDown': e.preventDefault(); stepLine(1); break;
    case '+': case '=': setFs(S.fs + 2); break;
    case '-': case '_': setFs(S.fs - 2); break;
    case 'm': case 'M': toggleMirror(); break;
    case 'f': case 'F': toggleFs(); break;
    case 'b': case 'B': openLib(); break;
  }
}

export function initControls() {
  $('play').onclick = toggle;
  $('back').onclick = () => seek(now() - 5);
  $('fwd').onclick = () => seek(now() + 5);
  if (!document.fullscreenEnabled) $('fsBtn').hidden = true;
  $('fsBtn').onclick = toggleFs;
  $('scrim').onclick = () => { closeLib(); closeTx(); togglePanel(false); closeMenu(); };
  document.addEventListener('keydown', onKey);
}
