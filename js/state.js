// What is on screen, shared by the modules that show it and change it. Everything else a module
// needs to remember stays inside that module.
export const state = {
  cues: [],           // the lines on screen: prompter.js draws them; session.js and transcription replace them
  mode: 'demo',       // 'demo' = simulated clock (sample text, or a text with no audio); 'audio' = a real file. player.js
  userSrt: false,     // the lines are the viewer's own, not the sample text
  currentId: null,    // the open text's id, and its library record (session.js)
  currentMeta: null,
  resumeFrom: 0,      // where the open text was left, offered on the notice until playback starts
  spareAudio: null    // the last audio set aside, so "Usar «…»" can bring it back in one tap
};
