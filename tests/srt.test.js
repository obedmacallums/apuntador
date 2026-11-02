// Reading and writing SRT/VTT, and the formatting helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubs, toSrt } from '../js/srt.js';
import { fmt, fmtTC, hash, plural } from '../js/format.js';

test('lee un SRT', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\nHola\nmundo\n\n2\n00:00:04,000 --> 00:00:05,000\nAdiós\n';
  assert.deepEqual(parseSubs(srt), [{ start: 1, end: 3.5, text: 'Hola mundo' }, { start: 4, end: 5, text: 'Adiós' }]);
});

test('lee un VTT con BOM, saltos de Windows, etiquetas y entidades', () => {
  const vtt = '﻿WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\n<i>Hola</i> &amp; {\\an8}adiós\r\n';
  assert.deepEqual(parseSubs(vtt), [{ start: 1, end: 2, text: 'Hola & adiós' }]);
});

test('ordena por tiempo, salta bloques vacíos y da a cada línea al menos 0,2 s', () => {
  const srt = '2\n00:00:05,000 --> 00:00:05,000\nB\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n\n3\n00:00:07,000 --> 00:00:08,000\n\n';
  assert.deepEqual(parseSubs(srt), [{ start: 1, end: 2, text: 'A' }, { start: 5, end: 5.2, text: 'B' }]);
});

test('un archivo sin tiempos no tiene líneas', () => {
  assert.deepEqual(parseSubs('esto no es un srt'), []);
});

test('escribe SRT y lo vuelve a leer igual', () => {
  const lines = [{ start: 0.5, end: 2.25, text: 'Uno' }, { start: 3661.1, end: 3662, text: 'Dos' }];
  const srt = toSrt(lines);
  assert.equal(srt.split('\n').slice(0, 3).join('|'), '1|00:00:00,500 --> 00:00:02,250|Uno');
  assert.deepEqual(parseSubs(srt), lines);
});

test('formatos de tiempo', () => {
  assert.equal(fmt(75.4), '1:15');
  assert.equal(fmt(3725), '1:02:05');
  assert.equal(fmt(-3), '0:00');
  assert.equal(fmtTC(75.4), '00:01:15,400');
});

test('hash estable (los ids guardados dependen de él)', () => {
  assert.equal(hash(''), 'ztntfp0');
  assert.equal(hash('hola'), '1dlqaon4');
  assert.notEqual(hash('hola'), hash('hola '));
  assert.equal(plural(1, 'texto', 'textos'), '1 texto');
  assert.equal(plural(2, 'texto', 'textos'), '2 textos');
});
