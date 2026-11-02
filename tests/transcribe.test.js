// Preparing audio for Whisper and turning its output into lines, without running a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWindows } from '../js/transcribe/audio.js';
import { linesFromWords, linesFromSegments } from '../js/transcribe/lines.js';

// Voice everywhere except silent gaps (in seconds) — 16 kHz samples.
function pcm(seconds, silences = []) {
  const a = new Float32Array(seconds * 16000);
  for (let i = 0; i < a.length; i++) {
    const t = i / 16000;
    a[i] = silences.some(([s, e]) => t >= s && t < e) ? 0 : 0.3 * Math.sin(i / 7);
  }
  return a;
}

test('un audio corto es un solo tramo', () => {
  assert.deepEqual(splitWindows(pcm(10)), [[0, 10]]);
});

test('cortes de 30 s como máximo, en el silencio entre 20 y 29 s', () => {
  const w = splitWindows(pcm(70, [[24, 24.5], [50, 50.6]]));
  assert.equal(w.length, 3);
  assert.ok(w[0][1] >= 24 && w[0][1] < 24.5, `primer corte en ${w[0][1]}`);
  assert.ok(w[1][1] >= 50 && w[1][1] < 50.6, `segundo corte en ${w[1][1]}`);
  for (const [a, b] of w) assert.ok(b - a <= 30.0001);
  assert.equal(w[2][1], 70);
});

test('los tramos en silencio se descartan', () => {
  assert.deepEqual(splitWindows(new Float32Array(16000 * 10)), []);
});

const word = (text, a, b) => ({ text, timestamp: [a, b] });

test('palabras → líneas, cortando al final de cada frase', () => {
  const lines = linesFromWords([word(' Hola', 0, 0.4), word(' a', 0.5, 0.6), word(' todos.', 0.6, 1), word(' Adiós', 1.2, 1.6), word('.', 1.6, 1.6)], 10, 40);
  assert.deepEqual(lines.map(l => l.text), ['Hola a todos.', 'Adiós.']);
  assert.deepEqual(lines[0].w, [10, 10.5, 10.6]);
  assert.equal(lines[0].start, 10);
  assert.equal(lines[1].end, 11.6);
});

test('una pausa larga corta la línea, y los signos de apertura van con la palabra siguiente', () => {
  const lines = linesFromWords([word('uno', 0, 0.3), word('dos', 2, 2.3), word('¿', 2.4, 2.4), word('tres', 2.4, 2.8), word('?', 2.8, 2.8)], 0, 30);
  assert.deepEqual(lines.map(l => l.text), ['uno', 'dos ¿tres?']);
});

test('una línea no pasa de 20 palabras', () => {
  const many = Array.from({ length: 25 }, (_, i) => word('p' + i, i * 0.3, i * 0.3 + 0.2));
  assert.deepEqual(linesFromWords(many, 0, 30).map(l => l.text.split(' ').length), [20, 5]);
});

test('segmentos → líneas, sin las vacías y dentro del tramo', () => {
  const lines = linesFromSegments([{ text: ' Hola ', timestamp: [0, 2] }, { text: ' ', timestamp: [2, 3] }, { text: 'fin', timestamp: [28, null] }], 30, 59);
  assert.deepEqual(lines, [{ start: 30, end: 32, text: 'Hola' }, { start: 58, end: 59, text: 'fin' }]);
});
