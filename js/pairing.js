// The rules that decide when a text and an audio go together. Pure functions, so the tests can check
// every case: a text must never end up with another recording's audio.
//
// In all of them, loaded is the key of the audio in the player (null if none) and isStored(key) says
// whether an audio's file is saved in this browser.

// A new audio file was chosen.
//   'loaded': it is already in the player, nothing changes.
//   'pair':   the open text was waiting for its audio (chosen after the SRT, or it is its own).
//   'switch': another recording: close the open text and show this audio's texts.
export function forAudio(key, { loaded, open, owns, isStored }) {
  if (loaded === key) return 'loaded';
  if (!open) return 'switch';
  if (open.audioKey === key) return 'pair';
  // A text whose own audio is playing, or saved here, does not take a different one.
  const waiting = !owns && !(open.audioKey && isStored(open.audioKey));
  return waiting ? 'pair' : 'switch';
}

// A subtitle file was chosen; meta is its library record (saved before, or new).
//   same:     its own audio is already playing.
//   stored:   its own audio is saved here: bring it back.
//   pair:     the audio in the player becomes its audio (they came together, or the player held an
//             audio with no text open, so the screen was asking for this one).
//   setAside: the audio in the player goes with the text that was open: take it out.
export function forSubs(meta, { loaded, withAudio, textOpen, isStored }) {
  const same = !!loaded && !!meta.audioKey && meta.audioKey === loaded;
  const stored = !same && !withAudio && !!meta.audioKey && isStored(meta.audioKey);
  const pair = !!loaded && !same && (withAudio || (!stored && !textOpen));
  const setAside = !!loaded && !same && !pair && !stored;
  return { same, stored, pair, setAside };
}

// A text was opened from the library.
//   same:   its audio is the one playing (keep: and you were listening, so keep your place in it).
//   stored: its audio is saved here: bring it back.
//   reuse:  it never had an audio saved, and the one in the player (with no text open) fits it.
export function forLibraryText(m, { loaded, loadedName, textOpen, isStored, position }) {
  const key = m.audioKey;
  const same = !!key && loaded === key;
  const stored = !same && !!key && isStored(key);
  const reuse = !same && !stored && !!loaded && !textOpen && (!m.audioName || m.audioName === loadedName);
  const keep = same && (textOpen || position > 1);
  return { same, stored, reuse, keep };
}
