// When a text and an audio go together. Each case is one of the flows that once mixed them up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forAudio, forSubs, forLibraryText } from '../js/pairing.js';

const stored = (...keys) => k => keys.includes(k);
const none = () => false;

test('audio: el mismo que ya suena no cambia nada', () => {
  assert.equal(forAudio('a1', { loaded: 'a1', open: null, owns: false, isStored: none }), 'loaded');
});
test('audio: sin texto abierto, es un audio nuevo', () => {
  assert.equal(forAudio('a2', { loaded: 'a1', open: null, owns: false, isStored: none }), 'switch');
});
test('audio: el texto abierto lo esperaba (SRT primero, luego su audio)', () => {
  assert.equal(forAudio('a2', { loaded: null, open: { audioKey: '' }, owns: false, isStored: none }), 'pair');
});
test('audio: es el propio audio del texto abierto', () => {
  assert.equal(forAudio('a2', { loaded: null, open: { audioKey: 'a2' }, owns: false, isStored: stored('a2') }), 'pair');
});
test('audio: otro audio con un texto que suena con el suyo cierra el texto', () => {
  assert.equal(forAudio('a2', { loaded: 'a1', open: { audioKey: 'a1' }, owns: true, isStored: stored('a1') }), 'switch');
});
test('audio: otro audio con un texto cuyo audio está guardado cierra el texto', () => {
  assert.equal(forAudio('a2', { loaded: null, open: { audioKey: 'a1' }, owns: false, isStored: stored('a1') }), 'switch');
});
test('audio: un texto cuyo audio no se pudo guardar acepta el nuevo', () => {
  assert.equal(forAudio('a2', { loaded: null, open: { audioKey: 'a1' }, owns: false, isStored: none }), 'pair');
});

const ctx = (o = {}) => ({ loaded: null, withAudio: false, textOpen: false, isStored: none, ...o });
test('SRT: con un audio solo en pantalla, pasa a ser un texto de ese audio', () => {
  assert.deepEqual(forSubs({ audioKey: '' }, ctx({ loaded: 'a1' })), { same: false, stored: false, pair: true, setAside: false });
});
test('SRT: mientras está abierto un texto de otro audio, ese audio se aparta', () => {
  assert.deepEqual(forSubs({ audioKey: '' }, ctx({ loaded: 'a1', textOpen: true })), { same: false, stored: false, pair: false, setAside: true });
});
test('SRT: si su audio está guardado, vuelve su audio aunque suene otro', () => {
  assert.deepEqual(forSubs({ audioKey: 'a2' }, ctx({ loaded: 'a1', textOpen: true, isStored: stored('a2') })), { same: false, stored: true, pair: false, setAside: false });
});
test('SRT: si su audio ya suena, sigue igual', () => {
  assert.deepEqual(forSubs({ audioKey: 'a1' }, ctx({ loaded: 'a1', textOpen: true })), { same: true, stored: false, pair: false, setAside: false });
});
test('SRT: elegido junto con un audio, van juntos siempre', () => {
  assert.deepEqual(forSubs({ audioKey: 'a2' }, ctx({ loaded: 'a1', withAudio: true, isStored: stored('a2') })), { same: false, stored: false, pair: true, setAside: false });
});
test('SRT: sin audio en el reproductor, se abre solo', () => {
  assert.deepEqual(forSubs({ audioKey: '' }, ctx()), { same: false, stored: false, pair: false, setAside: false });
});

const lib = (o = {}) => ({ loaded: null, loadedName: null, textOpen: false, isStored: none, position: 0, ...o });
test('biblioteca: otro texto del audio que suena sigue donde iba', () => {
  assert.deepEqual(forLibraryText({ audioKey: 'a1' }, lib({ loaded: 'a1', textOpen: true, position: 12 })), { same: true, stored: false, reuse: false, keep: true });
});
test('biblioteca: desde la lista del audio, sin haberlo escuchado, va a donde lo dejaste', () => {
  assert.deepEqual(forLibraryText({ audioKey: 'a1' }, lib({ loaded: 'a1', position: 0 })), { same: true, stored: false, reuse: false, keep: false });
});
test('biblioteca: un texto con su audio guardado lo trae', () => {
  assert.deepEqual(forLibraryText({ audioKey: 'a2' }, lib({ loaded: 'a1', textOpen: true, isStored: stored('a2') })), { same: false, stored: true, reuse: false, keep: false });
});
test('biblioteca: un texto sin audio guardado usa el audio suelto del mismo nombre', () => {
  assert.deepEqual(forLibraryText({ audioName: 'x.mp3' }, lib({ loaded: 'a1', loadedName: 'x.mp3' })).reuse, true);
  assert.deepEqual(forLibraryText({ audioName: 'y.mp3' }, lib({ loaded: 'a1', loadedName: 'x.mp3' })).reuse, false);
});
test('biblioteca: nunca usa el audio de otro texto abierto', () => {
  assert.equal(forLibraryText({ audioName: '' }, lib({ loaded: 'a1', loadedName: 'x.mp3', textOpen: true })).reuse, false);
});
