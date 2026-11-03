// A small in-memory flight recorder for the debug tools (js/debug-ui.js). Nothing here is sent anywhere or saved: it lives
// until the page is closed. The microphone listener writes events and transcripts; the brain client writes one record per
// conversation turn (what was sent, what came back, how long it took, whether any fallback fired and why).

import { settings } from './storage.js';

export const mic = { events: [], interim: '', final: '', lastResultAt: 0, finalAt: 0 };
export const turns = [];                       // newest first
const MAX_EVENTS = 80;
const MAX_TURNS = 25;
let seq = 0;

/** Debug tools are shown when Settings > Developer tools is on, or the URL has ?debug. */
export const debugOn = () => {
  try { return !!settings.get('debugTools') || (typeof location !== 'undefined' && /[?&]debug\b/.test(location.search)); } catch { return false; }
};

/** level: 'info' | 'warn' | 'error' */
export function micEvent(type, detail = '', level = 'info') {
  mic.events.push({ t: Date.now(), type, detail: String(detail).slice(0, 180), level });
  if (mic.events.length > MAX_EVENTS) mic.events.shift();
}

export function micTranscript(kind, text) {
  const now = Date.now();
  mic.lastResultAt = now;
  if (kind === 'final') { mic.final = text; mic.finalAt = now; mic.interim = ''; } else mic.interim = text;
}

/** One record per call to the brain. Fill in fields as they become known: t.http = 200 ... */
export function startTurn(info = {}) {
  const t = { id: ++seq, at: Date.now(), ...info };
  turns.unshift(t);
  if (turns.length > MAX_TURNS) turns.pop();
  return t;
}
