// Formatting helpers: times and long file names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtTC, splitTail } from '../js/format.js';

test('tiempos', () => {
  assert.equal(fmt(75.4), '1:15');
  assert.equal(fmt(3725), '1:02:05');
  assert.equal(fmtTC(3661.1), '01:01:01,100');
});

test('un nombre largo deja a la vista su última palabra y la extensión', () => {
  assert.deepEqual(splitTail('How_God_Inspires_Imperfect_Human_Writers.m4a'), ['How_God_Inspires_Imperfect_Human_', 'Writers.m4a']);
  assert.deepEqual(splitTail('guion-charla-final.srt'), ['guion-charla-', 'final.srt']);
});

test('una última palabra muy corta trae la anterior', () => {
  assert.deepEqual(splitTail('How_God_Inspires_Imperfect_Human_Writers_v2.m4a'), ['How_God_Inspires_Imperfect_Human_', 'Writers_v2.m4a']);
  assert.deepEqual(splitTail('Episodio 12.mp3'), ['', 'Episodio 12.mp3']);
});

test('sin separadores, o con una palabra larguísima: los últimos 8 caracteres', () => {
  assert.deepEqual(splitTail('Grabacion20251102.m4a'), ['Grabacion', '20251102.m4a']);
  const [head, tail] = splitTail('notas_Supercalifragilisticoespialidoso.mp3');
  assert.equal(tail, 'ialidoso.mp3');
  assert.equal(head + tail, 'notas_Supercalifragilisticoespialidoso.mp3');
});

test('nombres cortos o raros quedan enteros', () => {
  assert.deepEqual(splitTail('corto.mp3'), ['', 'corto.mp3']);
  assert.deepEqual(splitTail('Whisper Small, GPU'), ['Whisper ', 'Small, GPU']);
  assert.deepEqual(splitTail(''), ['', '']);
  assert.deepEqual(splitTail(null), ['', '']);
});
