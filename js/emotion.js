// Quark's emotion: one of twelve feelings (the four main ones are happy, sulky, smug and angry), each with an intensity from 0 to 100. The brain reads the current emotion
// with every message and reports the one it feels afterwards; the face, voice and glow follow it.
//
// (This is the state holder and its mapping to the face and voice. Persistence, triggers such as punches or yelling,
// and the slow recovery rules are layered on top of it in the next upgrade.)

import { EMOTIONS } from './moods.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// the face preset that shows an emotion at a given intensity
const FACE = {
  happy: (i) => (i > 72 ? 'joy' : i > 35 ? 'happy' : 'content'),
  excited: (i) => (i > 55 ? 'joy' : 'playful'),
  curious: () => 'curious',
  content: () => 'content',
  bored: () => 'bored',
  sleepy: () => 'sleepy',
  startled: () => 'startled',
  scared: () => 'scared',
  sulky: () => 'sulky',
  sad: () => 'sad',
  angry: () => 'angry',
  smug: () => 'smug',
};

// the voice tone (see voice.js) that goes with an emotion
const TONE = { happy: 'happy', excited: 'excited', curious: 'normal', content: 'normal', bored: 'bored', sleepy: 'sleepy', startled: 'excited', scared: 'excited', sulky: 'sulky', sad: 'sad', angry: 'angry', smug: 'smug' };

const NEGATIVE = new Set(['sulky', 'sad', 'angry', 'scared']);

export function createEmotion() {
  let st = { name: 'content', intensity: 35, at: Date.now(), source: 'init' };
  const listeners = [];

  /** silent: update the state without telling listeners (used when the face already changed by itself). */
  function set(name, intensity = 50, source = 'chat', { silent = false } = {}) {
    if (!EMOTIONS.includes(name)) return false;
    st = { name, intensity: clamp(Math.round(Number(intensity) || 0), 0, 100), at: Date.now(), source };
    if (!silent) for (const fn of listeners) { try { fn(st); } catch (e) { console.error(e); } }
    return true;
  }

  return {
    set,
    get name() { return st.name; },
    get intensity() { return st.intensity; },
    get since() { return st.at; },
    get snapshot() { return { name: st.name, intensity: st.intensity }; },
    get negative() { return NEGATIVE.has(st.name); },
    /** The face preset for the current emotion (or a given one). */
    expression(name = st.name, intensity = st.intensity) { return (FACE[name] || FACE.content)(intensity); },
    tone(name = st.name) { return TONE[name] || 'normal'; },
    onChange(fn) { listeners.push(fn); },
  };
}
