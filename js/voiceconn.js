// voiceconn.js — Voice Connection: Quark speaks with the user's own ElevenLabs voice, straight from this browser.
//
// What lives here
//   * the saved credentials (API key, Voice ID, model), kept ONLY in this browser's localStorage under one key of their own,
//     never in the code, a URL, a log, an error message or the general settings blob. Only the last 4 characters are ever shown.
//   * the ElevenLabs text-to-speech client: one streaming request per sentence, 24 kHz PCM played chunk by chunk as it arrives,
//     the next sentence fetched while the current one plays, mood -> voice settings, an 8 second give-up, plain-language errors.
//   * the robot effects chain the audio runs through (small pitch lift, light ring modulator, light bit-crusher, filter shaping,
//     a tiny delay), with sliders and a "save as defaults".
//   * a cache for repeated (text, mood) pairs: in memory, and in IndexedDB (hashed names, size-capped) for short common phrases.
//   * the "Quark never goes silent" rules: any failure falls back to the chirp voice for that sentence; three failures in a row
//     pause the cloud voice for a minute.
//
// The ElevenLabs API only ever sees the key as the `xi-api-key` request header. Nothing here logs anything.
//
// Wiring this into voice.js (the app's speak function) comes after the screen and Test voice are approved.

import * as audio from './audio.js';
import { sleep } from './util.js';

export const DEFAULT_MODEL = 'eleven_flash_v2_5';       // ElevenLabs' low-latency model (about 100 ms), also the cheapest per character
const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';
const CRED_KEY = 'quark:voiceconn';
const FX_KEY = 'quark:voicefx';
const DB_NAME = 'quark-voice';
const PCM_RATE = 24000;                                 // pcm_24000: 16-bit mono, available on every plan
const FIRST_AUDIO_MS = 8000;                            // no sound after this long = too slow, use the chirps
const HARD_CAP_MS = 30000;
const REQ_CHARS_MAX = 300;                              // one request never carries more than this
const MERGE_UNDER = 24;                                 // sentences shorter than this are joined to a neighbour (fewer requests)
const FAILS_BEFORE_PAUSE = 3;
const PAUSE_MS = 60000;
const MEM_CACHE_MAX = 40;
const DISK_CAP_BYTES = 24 * 1024 * 1024;
const PREBUFFER_S = 0.2;                                // audio collected before playback starts, so it doesn't stutter

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- moods
/** Quark's emotions (js/moods.js) and what each does to the voice settings sent with every request. */
export const MOODS = ['content', 'happy', 'excited', 'curious', 'bored', 'sleepy', 'startled', 'scared', 'sulky', 'sad', 'angry'];
const MOOD_VOICE = {
  content:  { stability: 0.50, style: 0.00, speed: 1.00 },
  happy:    { stability: 0.38, style: 0.35, speed: 1.06 },
  excited:  { stability: 0.28, style: 0.60, speed: 1.14 },
  curious:  { stability: 0.42, style: 0.25, speed: 1.02 },
  bored:    { stability: 0.70, style: 0.05, speed: 0.92 },
  sleepy:   { stability: 0.78, style: 0.00, speed: 0.84 },
  startled: { stability: 0.25, style: 0.50, speed: 1.12 },
  scared:   { stability: 0.30, style: 0.40, speed: 1.10 },
  sulky:    { stability: 0.68, style: 0.20, speed: 0.92 },
  sad:      { stability: 0.62, style: 0.30, speed: 0.88 },
  angry:    { stability: 0.30, style: 0.55, speed: 1.08 },
};
/** Local effect tweaks added on top of the sliders for each mood. */
const MOOD_FX = {
  happy: { lift: 0.5 }, excited: { lift: 1, bright: 600 }, curious: { lift: 0.3 }, bored: { bright: -500 }, sleepy: { lift: -1, bright: -1200 },
  startled: { lift: 1.5, delay: 0.04 }, scared: { lift: 1.5, delay: 0.05, ring: 0.03 }, sulky: { lift: -0.5, bright: -600 },
  sad: { lift: -0.8, bright: -800 }, angry: { lift: -0.3, ring: 0.08, crush: 0.08 },
};
const moodKey = (m) => { const k = String(m || '').toLowerCase(); return MOOD_VOICE[k] ? k : (k === 'shout' ? 'excited' : 'content'); };

// ---------------------------------------------------------------- effects
export const FX_DEFAULTS = { lift: 1.5, ring: 0.10, crush: 0.08, bright: 6000, delay: 0.06, volume: 1 };
export const FX_LIMITS = { lift: [0, 4], ring: [0, 0.4], crush: [0, 0.4], bright: [2500, 9000], delay: [0, 0.3], volume: [0.2, 1.5] };
const clampFx = (fx) => { const o = {}; for (const k of Object.keys(FX_DEFAULTS)) o[k] = clamp(Number.isFinite(+fx[k]) ? +fx[k] : FX_DEFAULTS[k], FX_LIMITS[k][0], FX_LIMITS[k][1]); return o; };

// ---------------------------------------------------------------- plain-language problems
const REASON = {
  no_key: 'Not connected: no key saved yet.',
  invalid_key: 'ElevenLabs did not accept that API key. Check it and paste it again.',
  no_credits: 'Your ElevenLabs account has no credits left.',
  offline: 'No internet, or ElevenLabs cannot be reached.',
  slow: 'ElevenLabs took too long to answer.',
  voice_not_found: 'That Voice ID was not found on this account.',
  bad_voice_id: 'That Voice ID does not look right.',
  bad_model: 'ElevenLabs did not accept that model name.',
  rate_limited: 'ElevenLabs says there are too many requests right now. Try again in a moment.',
  forbidden: 'ElevenLabs refused the request. Your plan may not allow this voice or the API.',
  server: 'ElevenLabs is having trouble right now.',
  other: 'ElevenLabs could not make that sound.',
};
class VoiceError extends Error {
  constructor(code) { super(REASON[code] || REASON.other); this.code = code; }     // fixed text only: never anything from the request
}

function classify(http, detail) {
  const text = `${detail.code || ''} ${detail.status || ''} ${detail.message || ''}`.toLowerCase();
  if (http === 401) return /quota|credit/.test(text) ? 'no_credits' : 'invalid_key';
  if (http === 402) return 'no_credits';
  if (http === 403) return /quota|credit/.test(text) ? 'no_credits' : 'forbidden';
  if (http === 404) return /model/.test(text) ? 'bad_model' : 'voice_not_found';
  if (http === 429) return /quota|credit/.test(text) ? 'no_credits' : 'rate_limited';
  if (http === 400 || http === 422) {
    if (/output_format|format/.test(text)) return 'bad_format';
    if (/voice/.test(text)) return 'bad_voice_id';
    if (/model/.test(text)) return 'bad_model';
    return 'other';
  }
  return http >= 500 ? 'server' : 'other';
}
async function readDetail(res) {
  try {
    const body = await res.json();
    const d = body && body.detail;
    if (typeof d === 'string') return { message: d };
    if (Array.isArray(d)) return { message: String((d[0] && d[0].msg) || '') };
    return d && typeof d === 'object' ? d : {};
  } catch { return {}; }
}

// ---------------------------------------------------------------- text -> sentences
const hasWords = (s) => /[\p{L}\p{N}]/u.test(s);

/** Split a reply into sentences to speak: very short ones are merged with a neighbour, long ones are cut, nothing empty is ever returned. */
export function prepareSentences(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = (clean.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) || [clean]).map((s) => s.trim()).filter(Boolean);
  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.length < MERGE_UNDER) merged[merged.length - 1] = `${last} ${p}`;
    else merged.push(p);
  }
  if (merged.length > 1 && merged[merged.length - 1].length < MERGE_UNDER) { const tail = merged.pop(); merged[merged.length - 1] += ` ${tail}`; }
  const out = [];
  for (const m of merged) {
    let s = m;
    while (s.length > REQ_CHARS_MAX) {
      let cut = s.lastIndexOf(', ', REQ_CHARS_MAX);
      if (cut < 80) cut = s.lastIndexOf(' ', REQ_CHARS_MAX);
      if (cut < 40) cut = REQ_CHARS_MAX;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out.filter(hasWords);
}

// ---------------------------------------------------------------- hashing and the disk cache
async function hashKey(s) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
      let h = '';
      for (let i = 0; i < 20; i++) h += d[i].toString(16).padStart(2, '0');
      return h;
    }
  } catch { /* fall through */ }
  let a = 0x811c9dc5, b = 0x01000193;                                   // FNV-1a twice, for pages that are not a secure context
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; b = Math.imul(b ^ s.charCodeAt(i), 2246822519) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

let dbp = null;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('clips', { keyPath: 'k' }); db.createObjectStore('meta', { keyPath: 'k' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
const asPromise = (req) => new Promise((resolve) => { req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); });

async function diskGet(k) {
  try {
    const db = await openDb(); if (!db) return null;
    const rec = await asPromise(db.transaction('clips').objectStore('clips').get(k));
    if (!rec || !rec.pcm) return null;
    const i16 = new Int16Array(rec.pcm), f = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
    return { pcm: f, rate: rec.rate || PCM_RATE };
  } catch { return null; }
}
async function diskPut(k, pcm, rate) {
  try {
    const db = await openDb(); if (!db) return;
    const i16 = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
    const t = db.transaction(['clips', 'meta'], 'readwrite');
    t.objectStore('clips').put({ k, pcm: i16.buffer, rate });
    t.objectStore('meta').put({ k, at: Date.now(), bytes: i16.byteLength });
    await new Promise((r) => { t.oncomplete = r; t.onerror = r; t.onabort = r; });
    await diskPrune(db);
  } catch { /* the cache is a bonus */ }
}
async function diskPrune(db) {
  const metas = (await asPromise(db.transaction('meta').objectStore('meta').getAll())) || [];
  let total = metas.reduce((n, m) => n + m.bytes, 0);
  if (total <= DISK_CAP_BYTES) return;
  metas.sort((a, b) => a.at - b.at);
  const t = db.transaction(['clips', 'meta'], 'readwrite');
  for (const m of metas) {
    if (total <= DISK_CAP_BYTES * 0.8) break;
    t.objectStore('clips').delete(m.k); t.objectStore('meta').delete(m.k); total -= m.bytes;
  }
  await new Promise((r) => { t.oncomplete = r; t.onerror = r; t.onabort = r; });
}
async function diskStats() {
  try {
    const db = await openDb(); if (!db) return { clips: 0, bytes: 0 };
    const metas = (await asPromise(db.transaction('meta').objectStore('meta').getAll())) || [];
    return { clips: metas.length, bytes: metas.reduce((n, m) => n + m.bytes, 0) };
  } catch { return { clips: 0, bytes: 0 }; }
}
async function diskClear() {
  try {
    const db = await openDb();
    if (db) db.close();
    dbp = null;
    if (typeof indexedDB !== 'undefined') await new Promise((r) => { const q = indexedDB.deleteDatabase(DB_NAME); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  } catch { /* nothing to clear */ }
}

// ---------------------------------------------------------------- the robot chain
function buildChain(ctx, dest, fx, raw) {
  const nodes = [];
  const mk = (n) => { nodes.push(n); return n; };
  const gain = (v) => { const g = mk(ctx.createGain()); g.gain.value = v; return g; };
  const filter = (type, f, q = 0.7, g = 0) => { const b = mk(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };
  const input = gain(1), out = gain(fx.volume);
  const analyser = mk(ctx.createAnalyser()); analyser.fftSize = 256;
  const samples = new Uint8Array(analyser.fftSize);
  const rate = raw ? 1 : Math.pow(2, fx.lift / 12);                              // the pitch lift: played a little faster (the request asks for a slower voice to compensate)
  let carrier = null;
  if (raw) input.connect(out);
  else {
    const hp = filter('highpass', 170), presence = filter('peaking', 2600, 0.9, 2.5), lp = filter('lowpass', fx.bright);
    input.connect(hp); hp.connect(presence); presence.connect(lp);
    let tail = lp;
    if (fx.ring > 0.004) {                                                       // light ring modulator: the voice times a low hum, blended in
      carrier = mk(ctx.createOscillator()); carrier.type = 'sine'; carrier.frequency.value = 72;
      const mul = gain(0), dry = gain(1 - fx.ring), wet = gain(fx.ring * 1.5), sum = gain(1);
      carrier.connect(mul.gain); tail.connect(dry); tail.connect(mul); mul.connect(wet); dry.connect(sum); wet.connect(sum);
      carrier.start(); tail = sum;
    }
    if (fx.crush > 0.004) {                                                      // light bit-crusher: a quantising curve, blended in
      const bits = 12 - fx.crush * 14, levels = Math.pow(2, bits - 1), curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.round(x * levels) / levels; }
      const sh = mk(ctx.createWaveShaper()); sh.curve = curve;
      const w = Math.min(0.85, fx.crush * 2.2), dry = gain(1 - w), wet = gain(w), sum = gain(1);
      tail.connect(dry); tail.connect(sh); sh.connect(wet); dry.connect(sum); wet.connect(sum); tail = sum;
    }
    if (fx.delay > 0.004) {                                                      // a tiny delay: a small speaker in a small body
      const d = mk(ctx.createDelay(0.1)); d.delayTime.value = 0.034;
      const fb = gain(0.25), wet = gain(fx.delay), sum = gain(1);
      tail.connect(sum); tail.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(sum); tail = sum;
    }
    tail.connect(out);
  }
  out.connect(analyser); analyser.connect(dest);
  return {
    input, out, rate,
    level() { analyser.getByteTimeDomainData(samples); let s = 0; for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; s += v * v; } return Math.sqrt(s / samples.length); },
    close() { try { carrier && carrier.stop(); } catch { /* stopped */ } for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } },
  };
}

// ---------------------------------------------------------------- one sentence being fetched
function newTake(text, mood) {
  const t = {
    text, mood, chunks: [], samples: 0, rate: PCM_RATE, done: false, error: null, cancelled: false, fromCache: false, ctl: null, key: '', waiters: [],
    change() { return new Promise((r) => t.waiters.push(r)); },
    fire() { const w = t.waiters; t.waiters = []; w.forEach((r) => r()); },
    push(f32) { if (f32.length) { t.chunks.push(f32); t.samples += f32.length; t.fire(); } },
    finish(err) { t.done = true; if (err) t.error = err; t.fire(); },
    cancel() { t.cancelled = true; try { t.ctl && t.ctl.abort(); } catch { /* done */ } t.finish(); },
    pcm() { const o = new Float32Array(t.samples); let p = 0; for (const c of t.chunks) { o.set(c, p); p += c.length; } return o; },
  };
  return t;
}
const int16ToFloat = (u8) => { const i = new Int16Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.length)), f = new Float32Array(i.length); for (let k = 0; k < i.length; k++) f[k] = i[k] / 32768; return f; };

// ---------------------------------------------------------------- the engine
/**
 * opts.timeoutMs overrides the 8 second give-up (used by tests). Returns the engine used by the Voice Connection screen and,
 * once approved, by the app's speak function.
 */
export function createCloudVoice({ timeoutMs = FIRST_AUDIO_MS } = {}) {
  let creds = loadCreds();                                   // { key, voiceId, model } or null. Never copied anywhere else.
  let fxBase = loadFx();
  let raw = false;
  let status = { state: creds ? 'saved' : 'none', reason: '' };
  const statusFns = new Set();
  let failures = 0, pausedUntil = 0, useMp3 = false, runId = 0;
  const session = { chars: 0, requests: 0, cacheHits: 0, lastFirstSoundMs: null };
  const mem = new Map();                                     // hash -> { pcm, rate, hits }
  const inflight = new Set();
  const handles = new Set();
  let stopFallback = null;

  // ---- credentials (the only place the key and Voice ID are stored)
  function loadCreds() {
    try {
      const o = JSON.parse(localStorage.getItem(CRED_KEY) || 'null');
      if (o && typeof o.k === 'string' && o.k && typeof o.v === 'string' && o.v) return { key: o.k, voiceId: o.v, model: o.m || DEFAULT_MODEL };
    } catch { /* no storage or nothing saved */ }
    return null;
  }
  function loadFx() {
    try { return clampFx({ ...FX_DEFAULTS, ...(JSON.parse(localStorage.getItem(FX_KEY) || 'null') || {}) }); } catch { return { ...FX_DEFAULTS }; }
  }
  const tail4 = (s) => (s ? s.slice(-4) : '');

  function setStatus(state, reason = '') {
    status = { state, reason };
    statusFns.forEach((fn) => { try { fn(status); } catch { /* a listener broke */ } });
  }
  const cloudAllowed = () => !!creds && Date.now() >= pausedUntil;
  function noteSuccess() { failures = 0; pausedUntil = 0; if (status.state !== 'connected') setStatus('connected'); }
  function noteFailure(code) {
    failures++;
    let reason = (REASON[code] || REASON.other);
    if (failures >= FAILS_BEFORE_PAUSE) { pausedUntil = Date.now() + PAUSE_MS; failures = 0; reason += ' Pausing the custom voice for a minute; chirps meanwhile.'; }
    else reason += ' Using the chirp voice for now.';
    setStatus('error', reason);
  }

  /** Validate and save. The key and Voice ID are trimmed of spaces and quotes. Returns { ok, error }. */
  function save({ key, voiceId, model } = {}) {
    const clean = (s) => String(s || '').replace(/[\s"'`]/g, '');
    const k = clean(key) || (creds ? creds.key : ''), v = clean(voiceId) || (creds ? creds.voiceId : '');
    const m = String(model || '').replace(/[^\w.\-]/g, '').slice(0, 60) || DEFAULT_MODEL;
    if (!k) return { ok: false, error: 'Paste your ElevenLabs API key first.' };
    if (k.length < 16) return { ok: false, error: 'That key looks too short. Paste the whole key.' };
    if (!v) return { ok: false, error: 'Paste your Voice ID too.' };
    if (!/^[A-Za-z0-9]{10,40}$/.test(v)) return { ok: false, error: 'That Voice ID does not look right. It is letters and numbers only.' };
    creds = { key: k, voiceId: v, model: m };
    failures = 0; pausedUntil = 0; useMp3 = false;
    mem.clear();
    let stored = true;
    try { localStorage.setItem(CRED_KEY, JSON.stringify({ k, v, m })); } catch { stored = false; }
    setStatus('saved');
    return { ok: true, stored, error: stored ? '' : 'Saved for this visit only: this browser would not store it.' };
  }

  /** Delete everything saved: credentials, effect defaults, cached audio, counters. */
  async function remove() {
    stopAll();
    creds = null; fxBase = { ...FX_DEFAULTS }; failures = 0; pausedUntil = 0; useMp3 = false;
    mem.clear();
    session.chars = 0; session.requests = 0; session.cacheHits = 0; session.lastFirstSoundMs = null;
    try { localStorage.removeItem(CRED_KEY); localStorage.removeItem(FX_KEY); } catch { /* nothing stored */ }
    await diskClear();
    setStatus('none');
  }

  // ---- effects
  const fx = {
    get: () => ({ ...fxBase }),
    set(patch) { fxBase = clampFx({ ...fxBase, ...patch }); },
    saveDefaults() { try { localStorage.setItem(FX_KEY, JSON.stringify(fxBase)); return true; } catch { return false; } },
    reset() { fxBase = { ...FX_DEFAULTS }; try { localStorage.removeItem(FX_KEY); } catch { /* ignore */ } },
    get raw() { return raw; },
    set raw(v) { raw = !!v; },
  };
  function effectiveFx(mood) {
    const add = MOOD_FX[mood] || {};
    const o = { ...fxBase };
    for (const k of Object.keys(add)) o[k] += add[k];
    return clampFx(o);
  }
  /** The voice settings sent with a request. The speed is lowered to make up for the pitch lift (which plays the clip faster). */
  function voiceSettings(mood) {
    const m = MOOD_VOICE[mood], lift = raw ? 0 : effectiveFx(mood).lift;
    return { stability: m.stability, similarity_boost: 0.75, style: m.style, use_speaker_boost: false, speed: clamp(round2(m.speed / Math.pow(2, lift / 12)), 0.7, 1.2) };
  }

  // ---- fetching one sentence
  async function post(text, vs, format, signal) {
    try {
      return await fetch(`${ENDPOINT}/${encodeURIComponent(creds.voiceId)}/stream?output_format=${format}`, {
        method: 'POST',
        headers: { 'xi-api-key': creds.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: creds.model, voice_settings: vs }),
        signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors',
      });
    } catch { throw new VoiceError(signal.aborted ? 'aborted' : 'offline'); }
  }

  async function requestInto(take, vs) {
    const ctl = take.ctl;
    let timedOut = false;
    const firstTimer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    const hardTimer = setTimeout(() => { timedOut = true; ctl.abort(); }, HARD_CAP_MS);
    try {
      let res = await post(take.text, vs, useMp3 ? 'mp3_44100_128' : 'pcm_24000', ctl.signal);
      if (!res.ok) {
        let code = classify(res.status, await readDetail(res));
        if (code === 'bad_format' && !useMp3) { useMp3 = true; res = await post(take.text, vs, 'mp3_44100_128', ctl.signal); if (!res.ok) code = classify(res.status, await readDetail(res)); else code = ''; }
        if (code) throw new VoiceError(code === 'bad_format' ? 'other' : code);
      }
      const type = res.headers.get('content-type') || '';
      if (useMp3 || /mpeg|mp3/i.test(type)) {
        const buf = await audio.decodeClip(await res.arrayBuffer());
        if (!buf) throw new VoiceError('other');
        clearTimeout(firstTimer);
        take.rate = buf.sampleRate;
        take.push(Float32Array.from(buf.getChannelData(0)));
      } else if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        let left = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          clearTimeout(firstTimer);
          let bytes = value;
          if (left) { const m = new Uint8Array(left.length + bytes.length); m.set(left); m.set(bytes, left.length); bytes = m; left = null; }
          const even = bytes.length & ~1;
          if (even < bytes.length) left = bytes.slice(even);
          if (even) take.push(int16ToFloat(bytes.subarray(0, even)));
        }
      } else {
        clearTimeout(firstTimer);
        const bytes = new Uint8Array(await res.arrayBuffer());
        take.push(int16ToFloat(bytes.subarray(0, bytes.length & ~1)));
      }
      if (!take.samples) throw new VoiceError('other');
    } catch (e) {
      if (e instanceof VoiceError && e.code !== 'aborted') throw e;
      if (timedOut) throw new VoiceError('slow');
      if (take.cancelled || (e instanceof VoiceError && e.code === 'aborted')) throw new VoiceError('aborted');
      throw new VoiceError('other');
    } finally {
      clearTimeout(firstTimer); clearTimeout(hardTimer);
    }
  }

  /** Start fetching a sentence now (memory cache, then disk cache, then ElevenLabs). Playback can start as soon as the first audio lands. */
  function startTake(text, mood, fresh = false) {
    const take = newTake(text, mood);
    take.ctl = new AbortController();
    inflight.add(take);
    const t0 = performance.now();
    (async () => {
      try {
        const vs = voiceSettings(mood);
        const c = creds;
        take.key = await hashKey(`${c.voiceId}|${c.model}|${vs.stability}|${vs.style}|${vs.speed}|${text}`);
        let hit = fresh ? null : mem.get(take.key);                           // `fresh` (the Test voice button) always asks ElevenLabs
        if (!hit && !fresh) hit = await diskGet(take.key);
        if (take.cancelled) return;
        if (hit) {
          hit.hits = (hit.hits || 0) + 1;
          mem.set(take.key, hit);
          take.rate = hit.rate; take.fromCache = true; session.cacheHits++;
          take.push(hit.pcm); take.finish();
          return;
        }
        session.chars += text.length; session.requests++;
        await requestInto(take, vs);
        if (take.cancelled) return;
        noteSuccess();
        take.latency = Math.round(performance.now() - t0);
        const pcm = take.pcm();
        mem.set(take.key, { pcm, rate: take.rate, hits: 1 });
        if (mem.size > MEM_CACHE_MAX) mem.delete(mem.keys().next().value);
        if (text.length <= 90) diskPut(take.key, pcm, take.rate);               // short, common lines are kept for next time
        take.finish();
      } catch (e) {
        const code = e && e.code ? e.code : 'other';
        if (code !== 'aborted' && !take.cancelled) noteFailure(code);
        take.finish(new VoiceError(code === 'aborted' ? 'other' : code));
      } finally {
        inflight.delete(take);
      }
    })();
    return take;
  }

  // ---- playing one sentence through the robot chain
  function playTake(take, { mood, onStart, onProgress, lead = 0.04 }) {
    const ctx = audio.getContext(), dest = audio.getOutput();
    if (!ctx || !dest || ctx.state === 'closed') return null;
    const chain = buildChain(ctx, dest, effectiveFx(mood), raw);
    const sources = new Set();
    let stopped = false, finished = false, nextT = 0, t0 = 0, timer = 0, resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const handle = { done, duration: 0, level: () => chain.level(), stop: (fade = true) => stop(fade) };
    const killSources = () => { for (const s of sources) { try { s.stop(); } catch { /* not started */ } } sources.clear(); };
    function finish(ok, reason) {
      if (finished) return;
      finished = true; clearInterval(timer);
      handles.delete(handle);
      setTimeout(() => chain.close(), 450);                                     // let the echo ring out
      resolveDone({ ok, reason: reason || '', ms: Math.round(handle.duration * 1000) });
    }
    function stop(fade) {
      if (finished || stopped) return;
      stopped = true; take.fire();
      if (fade) {
        const now = ctx.currentTime;
        chain.out.gain.cancelScheduledValues(now); chain.out.gain.setTargetAtTime(0, now, 0.03);   // a quick fade, no click
        setTimeout(() => { killSources(); finish(false, 'stopped'); }, 130);
      } else { killSources(); finish(false, 'stopped'); }
    }
    function schedule(chunk) {
      const buf = ctx.createBuffer(1, chunk.length, take.rate);
      if (buf.copyToChannel) buf.copyToChannel(chunk, 0); else buf.getChannelData(0).set(chunk);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.playbackRate.value = chain.rate; src.connect(chain.input);
      if (nextT < ctx.currentTime + 0.01) nextT = ctx.currentTime + 0.01;        // the network was slower than the audio: carry on straight away
      src.start(nextT); nextT += buf.duration / chain.rate;
      sources.add(src); src.onended = () => sources.delete(src);
    }
    handles.add(handle);
    (async () => {
      while (!stopped && !take.done && take.samples / take.rate < PREBUFFER_S) await take.change();
      if (stopped) return;
      if (!take.samples) { finish(false, take.error ? take.error.code : 'other'); return; }
      t0 = nextT = ctx.currentTime + lead;
      handle.startedAt = performance.now() + 40;
      onStart && onStart({ fromCache: take.fromCache });
      if (onProgress) {
        timer = setInterval(() => {
          const el = Math.max(0, ctx.currentTime - t0);
          const total = take.done ? Math.max(0.05, nextT - t0) : Math.max(el + 0.4, take.text.length * 0.065);
          onProgress(Math.min(1, el / total));
        }, 70);
      }
      let idx = 0;
      for (;;) {
        while (idx < take.chunks.length && !stopped) schedule(take.chunks[idx++]);
        if (stopped) return;
        if (take.done && idx >= take.chunks.length) break;
        await take.change();
      }
      handle.duration = nextT - t0;
      while (!stopped && ctx.currentTime < nextT - 0.005) await sleep(Math.max(10, Math.min(60, (nextT - ctx.currentTime) * 1000)));
      if (!stopped) { onProgress && onProgress(1); finish(true); }
    })();
    return handle;
  }

  function stopAll() {
    runId++;
    for (const t of [...inflight]) t.cancel();
    for (const h of [...handles]) h.stop(true);
    if (stopFallback) { try { stopFallback(); } catch { /* ignore */ } }
  }

  /**
   * Say text sentence by sentence. The next sentence is fetched while the current one plays. A newer speak() or stop() ends this one.
   * opts: mood, fallback(sentence, mood, index) -> Promise (the chirp voice, used for any sentence the cloud can't do), stopFallback(),
   *       onStart(), onSentence(index, text), onSentenceStart(index, info), onProgress(index, 0..1), onEnd(result)
   * Returns { done: Promise<result>, stop() }.
   */
  function speak(input, opts = {}) {
    stopAll();
    const my = ++runId;
    const mood = moodKey(opts.mood);
    const sentences = Array.isArray(input) ? input.map((s) => String(s || '').trim()).filter(hasWords) : prepareSentences(input);
    const result = { ok: true, sentences: sentences.length, cloud: 0, fallback: 0, cached: 0, reasons: [], firstSoundMs: null, ms: 0 };
    stopFallback = opts.stopFallback || null;
    const t0 = performance.now();
    const takes = [];
    const want = (i) => { if (i < sentences.length && !takes[i] && cloudAllowed()) takes[i] = startTake(sentences[i], mood, !!opts.fresh); };
    const done = (async () => {
      opts.onStart && opts.onStart();
      for (let i = 0; i < sentences.length && my === runId; i++) {
        opts.onSentence && opts.onSentence(i, sentences[i]);
        want(i); want(i + 1);
        let played = false;
        if (takes[i]) {
          const h = playTake(takes[i], {
            mood,
            lead: i === 0 ? 0.04 : 0.008,                                   // back-to-back sentences start almost at once
            onStart: (info) => {
              if (result.firstSoundMs === null) { result.firstSoundMs = Math.round(performance.now() - t0); session.lastFirstSoundMs = result.firstSoundMs; }
              if (info.fromCache) result.cached++;
              opts.onSentenceStart && opts.onSentenceStart(i, info);
            },
            onProgress: (f) => opts.onProgress && opts.onProgress(i, f),
          });
          if (h) {
            const r = await h.done;
            if (r.ok) { played = true; result.cloud++; result.ms += r.ms; }
            else if (r.reason && r.reason !== 'stopped') result.reasons.push(r.reason);
          }
        }
        if (my !== runId) break;
        if (!played && opts.fallback) {
          result.fallback++;
          await opts.fallback(sentences[i], mood, i);
        }
      }
      result.ok = my === runId;
      if (my === runId) opts.onEnd && opts.onEnd(result);
      return result;
    })();
    return { done, stop: () => { if (my === runId) stopAll(); } };
  }

  return {
    speak, stop: stopAll, save, remove, fx, prepareSentences,
    /** What the screen may show: never the key or the Voice ID, only their last 4 characters. */
    info() {
      return {
        hasCreds: !!creds, keyTail: tail4(creds && creds.key), voiceTail: tail4(creds && creds.voiceId), model: creds ? creds.model : DEFAULT_MODEL,
        status, paused: Date.now() < pausedUntil, pausedForMs: Math.max(0, pausedUntil - Date.now()), session: { ...session },
        credits: Math.round(session.chars * (/flash|turbo/i.test(creds ? creds.model : DEFAULT_MODEL) ? 0.5 : 1)),
        cloudAllowed: cloudAllowed(),
      };
    },
    diskStats,
    /** How much is going on right now (for tests): requests in flight and sentences playing. */
    activity() { return { inflight: inflight.size, playing: handles.size }; },
    /** The deliberate "Test voice" button: forgets earlier trouble so a fixed key is tried again at once. */
    resetTrouble() { failures = 0; pausedUntil = 0; },
    setStatus,
    onStatus(fn) { statusFns.add(fn); return () => statusFns.delete(fn); },
    get cloudAllowed() { return cloudAllowed(); },
    get moods() { return MOODS; },
    voiceSettings,
    // for the wiring step: fetch and play one sentence directly
    startTake, playTake,
  };
}
