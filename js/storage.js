// localStorage, but it can never throw. Private windows, blocked storage and full quotas all
// quietly fall back to in-memory values.

import { CONFIG } from './config.js';

const NS = 'quark:';
const mem = new Map();

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* fall through to memory */ }
  return mem.has(key) ? mem.get(key) : fallback;
}

export function save(key, value) {
  mem.set(key, value);
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  mem.delete(key);
  try { localStorage.removeItem(NS + key); } catch { /* ignore */ }
}

const DEFAULTS = {
  name: CONFIG.defaultName,
  sound: true,
  voice: 'beeps',      // 'speech' = real voice + chirps, 'beeps' = chirps only (beeps for now, at the user's request)
  faceStyle: 'calm',   // 'calm' (small flat eyes, no mouth) or 'classic' (the original big glowing eyes)
  speechLang: '',      // the accent the microphone listens for ('' = the browser's own English), e.g. 'en-IN'
  naturalVoice: false, // speak with Gemini text-to-speech through the backend when it is available (off for now)
  voiceName: 'Leda',   // which Gemini voice (see VOICES in backend/server.py)
  voiceRate: 1.06,     // a touch faster and higher sounds smaller and cuter
  voiceRobot: 0.2,     // 0..1 how much of a speaker-and-wobble robot treatment
  camera: false,       // stage 3
};

let cache = null;

export const settings = {
  all() {
    if (!cache) {
      cache = { ...DEFAULTS, ...load('settings', {}) };
      // "just make the voice beeps for now": switch every browser to chirps once. Settings > Sound & voice > How it talks can change it back.
      if (!cache.beepsPass) { cache.voice = 'beeps'; cache.naturalVoice = false; cache.beepsPass = true; save('settings', cache); }
    }
    return cache;
  },
  get(key) {
    return this.all()[key];
  },
  set(key, value) {
    const s = this.all();
    s[key] = value;
    save('settings', s);
    return value;
  },
};
