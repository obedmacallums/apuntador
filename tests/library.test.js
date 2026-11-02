// Library records: audio keys, names, progress, grouping by audio, and how lines are stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, textLabel, srtName, progress, groupLibrary, pack, unpack } from '../js/library/data.js';

test('un audio se reconoce por nombre y tamaño', () => {
  assert.equal(keyOf({ name: 'a.mp3', size: 100 }), keyOf({ name: 'a.mp3', size: 100 }));
  assert.notEqual(keyOf({ name: 'a.mp3', size: 100 }), keyOf({ name: 'a.mp3', size: 101 }));
  assert.notEqual(keyOf({ name: 'a.mp3', size: 100 }), keyOf({ name: 'b.mp3', size: 100 }));
  assert.match(keyOf({ name: 'a.mp3', size: 100 }), /^a/);
});

test('nombre de un texto: el modelo que lo escribió, o su archivo', () => {
  assert.equal(textLabel({ via: 'Whisper Small, GPU', file: 'x.srt (Whisper Small, GPU)', name: 'x' }), 'Whisper Small, GPU');
  assert.equal(textLabel({ file: 'x.srt (Whisper Tiny, CPU)', name: 'x' }), 'Whisper Tiny, CPU');   // saved before "via"
  assert.equal(textLabel({ file: 'guion.srt', name: 'guion' }), 'guion.srt');
});

test('nombre al descargar', () => {
  assert.equal(srtName({ via: 'Whisper Small, GPU', name: 'charla' }), 'charla (Whisper Small, GPU).srt');
  assert.equal(srtName({ file: 'guion.vtt', name: 'guion' }), 'guion.srt');
  assert.equal(srtName({ file: 'a.srt', name: 'a/b:c' }), 'a-b-c.srt');
});

test('progreso', () => {
  assert.equal(progress({ id: 's1', dur: 60, pos: 0 }, null), 'Sin empezar');
  assert.equal(progress({ id: 's1', dur: 60, pos: 30 }, null), 'Ibas en 0:30');
  assert.equal(progress({ id: 's1', dur: 60, pos: 58 }, null), 'Terminado');
  assert.equal(progress({ id: 's1', dur: 60, pos: 30 }, 's1'), 'Abierto');
});

test('biblioteca agrupada por audio, lo más reciente primero', () => {
  const audios = [{ key: 'a1', usedAt: 100 }, { key: 'a2', usedAt: 200 }, { key: 'a3', usedAt: 50 }];
  const texts = [
    { id: 's1', audioKey: 'a1', updatedAt: 300 },
    { id: 's2', audioKey: 'a2', updatedAt: 150 },
    { id: 's3', audioKey: 'a1', updatedAt: 120 },
    { id: 's4', audioKey: 'gone', updatedAt: 999 },
    { id: 's5', updatedAt: 10 }
  ];
  const { list, loose } = groupLibrary(audios, texts);
  assert.deepEqual(list.map(g => [g.a.key, g.texts.map(m => m.id)]), [['a1', ['s1', 's3']], ['a2', ['s2']], ['a3', []]]);
  assert.deepEqual(loose.map(m => m.id), ['s4', 's5']);
});

test('las líneas se guardan y vuelven igual, con sus tiempos por palabra', () => {
  const lines = [{ start: 0.5, end: 2.25, text: 'Hola', w: [0.5] }, { start: 2.3333333, end: 4, text: 'mundo' }];
  assert.deepEqual(pack(lines), [[0.5, 2.25, 'Hola', [0.5]], [2.333, 4, 'mundo']]);
  assert.deepEqual(unpack(pack(lines)), [{ start: 0.5, end: 2.25, text: 'Hola', w: [0.5] }, { start: 2.333, end: 4, text: 'mundo' }]);
});
