// Quark's natural voice: asks the backend (which holds the key) to speak a line with Gemini text-to-speech, and hands back a
// decoded clip. Lines are fetched as soon as the brain writes them, so the next sentence is usually ready before the
// last one ends. Clips are cached; if the backend can't speak (no key, busy, slow) it reports "not ready" for a while and
// the caller falls back to the browser's own voice.

import { getBackendUrl } from './brain.js';
import { settings } from './storage.js';
import * as audio from './audio.js';

const TIMEOUT_MS = 12000;
const CACHE_MAX = 80;

export function createTTS() {
  const cache = new Map();          // key -> Promise<AudioBuffer|null>
  let downUntil = 0;                // after a failure, don't wait on the network again for a bit
  const status = { engine: '-', ms: 0, error: '' };

  const keyOf = (text, emotion, voice) => `${voice}|${emotion}|${text}`;

  async function fetchClip(text, emotion, voice, intensity) {
    const url = getBackendUrl();
    if (!url) throw new Error('no backend');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const t0 = performance.now();
    try {
      const res = await fetch(`${url}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, emotion, voice, intensity }), signal: ctl.signal });
      if (!res.ok) throw new Error(`speech ${res.status}`);
      const buf = await audio.decodeClip(await res.arrayBuffer());
      if (!buf) throw new Error('could not decode');
      status.engine = 'natural';
      status.ms = Math.round(performance.now() - t0);
      status.error = '';
      return buf;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    status,
    /** Has the natural voice been chosen and is there a backend that can speak? (If so, the browser's own voice is never used.) */
    get chosen() { return !!settings.get('naturalVoice') && !!getBackendUrl(); },
    /** Is the natural voice worth trying right now? */
    get ready() {
      return !!settings.get('naturalVoice') && !!getBackendUrl() && audio.isReady() && performance.now() > downUntil;
    },
    /** Start fetching a line (or return the one already being fetched). Resolves an AudioBuffer, or null if it can't be had. */
    get(text, { emotion = 'content', intensity = 50 } = {}) {
      const voice = settings.get('voiceName') || 'Leda';
      const strong = intensity >= 65 ? 'strong' : 'mild';          // only a strong feeling asks for the slower, style-aware voice
      const k = keyOf(text, emotion + strong, voice);
      if (cache.has(k)) return cache.get(k);
      const p = fetchClip(text, emotion, voice, intensity).catch((e) => {
        status.engine = 'fallback';
        status.error = String(e && e.message ? e.message : e);
        downUntil = performance.now() + 30000;      // busy or down: use the browser voice for the next half minute
        cache.delete(k);
        return null;
      });
      cache.set(k, p);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return p;
    },
    forgetFailure() { downUntil = 0; },
  };
}
