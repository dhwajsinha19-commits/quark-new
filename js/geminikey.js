// geminikey.js — "Your own Gemini key": each person pastes their own free Gemini key in Settings and this browser talks to Gemini
// directly. That is how a copy of Quark on a static host (GitHub Pages) chats without a server of its own, and why sharing the link
// never spends the owner's key.
//
//   * The key is kept ONLY in this browser's localStorage, under one key of its own (never in the general settings blob, never in a
//     URL, never in a log or an error message). Only its last 4 characters are ever shown.
//   * It travels only as the `x-goog-api-key` request header, to generativelanguage.googleapis.com, and nowhere else.
//   * The personality, reply format and kid-safety rules are the server's own text (js/persona.js is generated from
//     backend/server.py), and the reply streams exactly as it does from the backend, so the face reacts first and speech starts
//     on the first sentence.
//   * Like the server it races models (the newest Flash, then a faster Flash-Lite after 2.5 s or on a failure) so one slow or
//     overloaded model never leaves Quark waiting. Every model has its OWN free allowance, so when one says it is out the next is
//     tried, and a model that said so is skipped until its allowance is back (a minute for a per-minute limit, Google's midnight
//     Pacific for a daily one).
//
// Nothing here ever calls console.*.

import { RESPONSE_SCHEMA, KID_SAFETY, buildSystem } from './persona.js';
import { contextBlock } from './ondevice.js';
import { ReplyStream, parseFinal, validateReply } from './streamjson.js';
import { cleanReply } from './moods.js';

const KEY_STORE = 'quark:geminikey';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const ALIASES = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const HEDGE_MS = 2500;                // a second model starts if the first has not begun answering by now
const FIRST_BYTE_MS = 12000;          // give up on one model after this
const STALL_MS = 25000;               // and on a stream that goes quiet for this long
const MAX_TOKENS = 420;

/** Plain-language reasons (fixed text: nothing from a request or response is ever put in one). */
export const REASON = {
  badkey: 'Google did not accept that key. Check it and paste it again.',
  quota: 'This key has used up its free messages for now. Try again later, or use a different key.',
  rate: 'Too many messages at once. Give it a moment.',
  offline: 'No internet, or Google cannot be reached.',
  upstream: 'Google is busy right now. Try again in a moment.',
  blocked: 'Google blocked that one.',
  empty: 'The reply came back blank.',
};

// ---------------------------------------------------------------- the saved key
let memKey = '';                                   // used only if this browser will not store it
const readKey = () => { try { return localStorage.getItem(KEY_STORE) || memKey; } catch { return memKey; } };
let status = { state: readKey() ? 'saved' : 'none', reason: '' };
const listeners = new Set();
const setStatus = (state, reason = '') => { status = { state, reason }; listeners.forEach((fn) => { try { fn(status); } catch { /* a listener broke */ } }); };

export const ownKey = {
  has: () => !!readKey(),
  /** Only the last 4 characters, for the screen. */
  tail: () => readKey().slice(-4),
  get status() { return status; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Validate the shape and save it. Returns { ok, error }. */
  save(raw) {
    const k = String(raw || '').replace(/[\s"'`]/g, '');
    if (!k) return { ok: false, error: 'Paste your Gemini key first.' };
    // Only refuse what could never work (too short, too long, or characters a request header cannot carry). Google's key formats
    // change (newer ones start "AQ." and contain dots), so whether it is a real key is for Google to say, not for us.
    if (k.length < 20 || k.length > 300 || !/^[\x21-\x7e]+$/.test(k)) return { ok: false, error: 'That does not look like a key. Copy the whole key from aistudio.google.com/apikey and paste it again.' };
    if (readKey() && readKey() !== k) forgetUsage();         // a different key has its own allowance
    memKey = k;
    forgetBenched();
    let stored = true;
    try { localStorage.setItem(KEY_STORE, k); } catch { stored = false; }
    ranked = null;
    setStatus('saved');
    return { ok: true, stored, error: stored ? '' : 'Saved for this visit only: this browser would not store it.' };
  },
  remove() {
    memKey = ''; ranked = null; noThink.clear(); forgetBenched(); forgetUsage();
    try { localStorage.removeItem(KEY_STORE); } catch { /* nothing stored */ }
    setStatus('none');
  },
};

// ---------------------------------------------------------------- errors
class GeminiError extends Error {
  constructor(code, retryable = false, extra = {}) { super(REASON[code] || code); this.code = code; this.retryable = retryable; Object.assign(this, extra); }
}

async function readError(res) {
  try {
    const j = await res.json();
    const e = (j && j.error) || {};
    return `${e.status || ''} ${e.message || ''} ${JSON.stringify(e.details || [])}`.toLowerCase();      // read only here, never shown or logged
  } catch { return ''; }
}

/** Map an HTTP failure to our small set of reasons. Retryable = another model might still answer. */
function classify(http, text) {
  if (http === 401 || http === 403 || /api[_ ]key[_ ]invalid|api key not valid|api key expired|permission_denied|key.*(invalid|expired)/.test(text)) return new GeminiError('badkey', false);
  if (http === 429) {
    const wait = /retrydelay"\s*:\s*"(\d+(?:\.\d+)?)s|retry in (\d+(?:\.\d+)?)s/.exec(text);       // Google says how long to wait ("41s")
    const retryMs = wait ? Math.round(parseFloat(wait[1] || wait[2]) * 1000) : 0;
    return new GeminiError(/perday|per day|daily/.test(text) ? 'quota' : 'rate', true, { http, retryMs });       // a per-minute limit is only 'rate'
  }
  if (http === 404) return new GeminiError('upstream', true, { http });
  if (http >= 500) return new GeminiError('upstream', true, { http });
  return new GeminiError('upstream', false, { http });
}

// ---------------------------------------------------------------- models that said "not now"
// Each model has its own free allowance. When one is out, skip it instead of asking it again on every message. Only model names and
// times are kept (never the key); a new or removed key forgets all of it.
const BENCH_STORE = 'quark:geminibench';
const BENCH_PROBE_MS = 120000;                     // if every model is benched, still ask once in a while in case Google's answer was wrong
let bench = null;                                  // model -> [until (ms), 'quota' | 'rate' | 'missing']
let lastProbe = 0;

function benchMap() {
  if (bench) return bench;
  bench = new Map();
  try {
    const o = JSON.parse(localStorage.getItem(BENCH_STORE) || '{}');
    const now = Date.now();
    for (const [m, v] of Object.entries(o)) if (Array.isArray(v) && typeof v[0] === 'number' && v[0] > now && /^[a-z0-9.-]+$/.test(m)) bench.set(m, [v[0], String(v[1])]);
  } catch { /* nothing saved */ }
  return bench;
}
function saveBench() { try { localStorage.setItem(BENCH_STORE, JSON.stringify(Object.fromEntries(benchMap()))); } catch { /* this browser will not store it */ } }
export function forgetBenched() { benchMap().clear(); lastProbe = 0; try { localStorage.removeItem(BENCH_STORE); } catch { /* nothing stored */ } }

/** When Google's free daily allowance comes back: midnight in Pacific time. */
export function nextDailyReset(now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(now);
    const g = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
    return now + (86400 - (g('hour') * 3600 + g('minute') * 60 + g('second'))) * 1000 + 60000;
  } catch { return now + 6 * 3600 * 1000; }
}

/** "around 1:30 PM", or "tomorrow around 8:00 AM" when that is not today. Local time. */
export function whenText(ms) {
  const d = new Date(ms), n = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === n.toDateString() ? `around ${t}` : `tomorrow around ${t}`;
}

function benchModel(model, err) {
  const now = Date.now();
  let until, kind;
  if (err.code === 'quota' || err.code === 'rate') noteLimited();
  if (err.code === 'quota') { until = nextDailyReset(now); kind = 'quota'; }
  else if (err.code === 'rate') { until = now + Math.min(Math.max(err.retryMs || 60000, 10000), 120000); kind = 'rate'; }
  else if (err.http === 404) { until = now + 6 * 3600 * 1000; kind = 'missing'; }
  else return;
  benchMap().set(model, [until, kind]);
  saveBench();
}

// ---------------------------------------------------------------- how much has been used
// Google never tells an app how much of the free allowance is left, so Quark counts what it sent itself: messages answered, requests
// Google accepted (per model), requests Google turned away, and tokens. Counted per Google day (it resets at midnight Pacific) and
// kept for a week. Only numbers and model names are stored: no messages, no key.
const USAGE_STORE = 'quark:geminiusage';
const USAGE_DAYS = 7;
let usage = null;                                  // { days: { 'YYYY-MM-DD': { messages, requests, limited, tokens, models: { name: requests } } } }
const usageListeners = new Set();

function pacificDay(now = Date.now()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return new Date(now).toISOString().slice(0, 10); }
}
const count = (v) => (Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1e9) : 0);
const emptyDay = () => ({ messages: 0, requests: 0, limited: 0, tokens: 0, models: {} });

function usageMap() {
  if (usage) return usage;
  usage = { days: {} };
  try {
    const o = JSON.parse(localStorage.getItem(USAGE_STORE) || '{}');
    for (const [d, v] of Object.entries((o && o.days) || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !v || typeof v !== 'object') continue;
      const rec = { messages: count(v.messages), requests: count(v.requests), limited: count(v.limited), tokens: count(v.tokens), models: {} };
      for (const [m, n] of Object.entries(v.models || {})) if (/^[a-z0-9.-]+$/.test(m)) rec.models[m] = count(n);
      usage.days[d] = rec;
    }
  } catch { /* nothing saved, or unreadable: start from zero */ }
  return usage;
}
function usageToday() {
  const u = usageMap(), d = pacificDay();
  if (!u.days[d]) {
    u.days[d] = emptyDay();
    for (const old of Object.keys(u.days).sort().slice(0, -USAGE_DAYS)) delete u.days[old];
  }
  return u.days[d];
}
function usageChanged() {
  try { localStorage.setItem(USAGE_STORE, JSON.stringify(usageMap())); } catch { /* this browser will not store it: the counts last until the page closes */ }
  usageListeners.forEach((fn) => { try { fn(); } catch { /* a listener broke */ } });
}
const noteRequest = (model) => { const t = usageToday(); t.requests++; t.models[model] = (t.models[model] || 0) + 1; usageChanged(); };
const noteLimited = () => { usageToday().limited++; usageChanged(); };
function noteReply(tokens) { const t = usageToday(); t.messages++; t.tokens += count(tokens); usageChanged(); }

export function forgetUsage() { usage = { days: {} }; try { localStorage.removeItem(USAGE_STORE); } catch { /* nothing stored */ } usageListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }
export function onUsageChange(fn) { usageListeners.add(fn); return () => usageListeners.delete(fn); }

/** What the Settings screen shows: today's counts, the week, which models are out and when the allowance is back. */
export function usageReport() {
  const t = usageToday(), u = usageMap();
  const week = Object.values(u.days).reduce((a, d) => ({ messages: a.messages + d.messages, requests: a.requests + d.requests }), { messages: 0, requests: 0 });
  const now = Date.now();
  const out = [...benchMap()].filter(([, v]) => v[0] > now && (v[1] === 'quota' || v[1] === 'rate')).map(([model, v]) => ({ model, kind: v[1], until: v[0] }));
  return {
    today: { messages: t.messages, requests: t.requests, limited: t.limited, tokens: t.tokens, models: Object.entries(t.models).map(([model, requests]) => ({ model, requests })).sort((a, b) => b.requests - a.requests) },
    week, out, resetAt: nextDailyReset(now),
  };
}

/** The models that are not benched right now. */
function usableModels(list) {
  const now = Date.now(), b = benchMap();
  for (const [m, v] of b) if (v[0] <= now) b.delete(m);
  return list.filter((m) => !b.has(m));
}

// ---------------------------------------------------------------- models
let ranked = null;                                 // [best, faster], found once per session
const noThink = new Set();                         // models that reject "thinking budget 0" (the Lite ones do)
const verRe = (suffix) => new RegExp(`^gemini-(\\d+(?:\\.\\d+)*)-${suffix}$`);

/** Ask Google which models this key can use (this is also the cheapest way to check that the key works). */
export async function listModels(signal) {
  let res;
  try { res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': readKey() }, signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch { throw new GeminiError(signal && signal.aborted ? 'aborted' : 'offline', true); }
  if (!res.ok) throw classify(res.status, await readError(res));
  const j = await res.json();
  return (Array.isArray(j.models) ? j.models : [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''));
}

/**
 * The models to try, best first: the always-valid "latest" alias, the newest Flash-Lite (the quick backup), then the other stable
 * Flash and Flash-Lite versions this key can use, newest first. Each has its own free allowance, so a long chain means Quark keeps
 * answering after one model has run out. At most 5 (a failure is fast, but each one still costs a round trip).
 */
function rank(names) {
  const newest = (suffix) => names.filter((n) => verRe(suffix).test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const flash = newest('flash'), lite = newest('flash-lite');
  const chain = [ALIASES[0], lite[0] || ALIASES[1], flash[0], lite[1], flash[1], lite[2], flash[2]].filter(Boolean);
  return [...new Set(chain)].slice(0, 5);
}

async function models(signal) {
  if (ranked) return ranked;
  try { ranked = rank(await listModels(signal)); } catch (e) { if (e.code === 'badkey') throw e; ranked = ALIASES.slice(); }
  return ranked;
}

// ---------------------------------------------------------------- one request
function requestBody(body, thinking) {
  const ctx = body.context || {};
  const kid = ctx.mode === 'kid';
  const message = String(body.message || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 500);
  const contents = [];
  for (const t of (body.history || []).slice(-15)) {
    const text = String((t && t.text) || '').trim().slice(0, 320);
    if (text) contents.push({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text }] });
  }
  if (message && contents.length && contents[contents.length - 1].role === 'user' && contents[contents.length - 1].parts[0].text === message) contents.pop();
  contents.push({ role: 'user', parts: [{ text: contextBlock(body) }] });
  const gen = { temperature: 1.0, topP: 0.95, maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA };
  if (thinking) gen.thinkingConfig = { thinkingBudget: 0 };          // fast replies: this is conversation, not reasoning
  const out = { systemInstruction: { parts: [{ text: buildSystem(kid ? 'kid' : 'adult', !kid && !!ctx.focus) }] }, contents, generationConfig: gen };
  if (kid) out.safetySettings = KID_SAFETY;
  return out;
}

/** Open the streaming request on one model. Resolves the open response; rejects with a GeminiError. */
async function openOn(model, body, signal) {
  for (const thinking of noThink.has(model) ? [false] : [true, false]) {
    let res;
    try {
      res = await fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': readKey() },
        body: JSON.stringify(requestBody(body, thinking)),
        signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors',
      });
    } catch { throw new GeminiError(signal.aborted ? 'aborted' : 'offline', true); }
    if (res.ok) { if (!thinking) noThink.add(model); noteRequest(model); return res; }
    const text = await readError(res);
    const err = classify(res.status, text);
    if (res.status === 400 && thinking && err.code !== 'badkey') continue;     // this model rejects the thinking setting: ask again without it
    throw err;
  }
  throw new GeminiError('upstream', true);
}

/** Race the two models: the best starts now, the quick one after HEDGE_MS or as soon as the first fails. First to answer wins. */
function openRace(list, body, outer) {
  return new Promise((resolve, reject) => {
    const ctls = list.map(() => new AbortController());
    const errors = [];
    let live = 0, started = 0, finished = false, hedge = 0;
    const onOuter = () => done(reject, new GeminiError('aborted'));
    const cleanup = () => { clearTimeout(hedge); outer && outer.removeEventListener('abort', onOuter); };
    const done = (fn, v) => { if (finished) return; finished = true; cleanup(); ctls.forEach((c) => c.abort()); fn(v); };
    outer && outer.addEventListener('abort', onOuter);
    const start = () => {
      if (finished || started >= list.length) return;
      const i = started++;
      live++;
      const timer = setTimeout(() => ctls[i].abort(), FIRST_BYTE_MS);
      openOn(list[i], body, ctls[i].signal).then((res) => {
        clearTimeout(timer);
        if (finished) return;
        finished = true; cleanup();
        ctls.forEach((c, k) => { if (k !== i) c.abort(); });             // the loser stops
        resolve({ res, model: list[i], ctl: ctls[i] });
      }, (e) => {
        clearTimeout(timer);
        live--;
        const err = e instanceof GeminiError ? e : new GeminiError('upstream', true);
        benchModel(list[i], err);
        errors.push(err.code === 'aborted' && !(outer && outer.aborted) ? new GeminiError('upstream', true) : err);
        if (finished) return;
        if (!err.retryable && err.code !== 'aborted') return done(reject, err);            // a bad key will not get better on another model
        if (started < list.length) start();
        else if (live === 0) {
          // the most useful thing to tell the person: a bad key, no internet, "wait a minute" (temporary) before "out for today"
          const rank2 = ['badkey', 'offline', 'rate', 'quota', 'upstream'];
          errors.sort((a, b) => rank2.indexOf(a.code) - rank2.indexOf(b.code));
          const first = errors[0];
          if (first.code === 'quota') first.resetAt = Math.min(...[...benchMap().values()].filter((v) => v[1] === 'quota').map((v) => v[0]), nextDailyReset());
          done(reject, first);
        }
      });
    };
    start();
    hedge = setTimeout(start, HEDGE_MS);
  });
}

// ---------------------------------------------------------------- one conversational turn
/**
 * The same contract as the backend and the on-device model: resolves { ok:true, final, model } or
 * { ok:false, error } where error is 'badkey' | 'quota' | 'rate' | 'offline' | 'upstream' | 'blocked' | 'empty' | 'aborted'. Never rejects.
 * body: the request brain.js builds. handlers: { onMeta, onDelta, signal }.
 */
export async function converse(body, { onMeta, onDelta, signal } = {}) {
  if (!readKey()) return { ok: false, error: 'badkey' };
  let opened, asked = false;
  try {
    const all = await models(signal);
    let list = usableModels(all);
    if (!list.length) {
      // every model is out right now. Say so without asking, except once in a while (Google's answer may have changed)
      const quotaUntil = [...benchMap().values()].filter((v) => v[1] === 'quota').map((v) => v[0]);
      const soonest = Math.min(...[...benchMap().values()].map((v) => v[0]));
      if (Date.now() - lastProbe < BENCH_PROBE_MS) throw quotaUntil.length === benchMap().size ? new GeminiError('quota', false, { resetAt: Math.min(...quotaUntil) }) : new GeminiError('rate', false, { retryMs: Math.max(1000, soonest - Date.now()) });
      lastProbe = Date.now();
      list = all;
    }
    asked = true;
    opened = await openRace(list, body, signal);
  } catch (e) {
    const code = e instanceof GeminiError ? e.code : 'upstream';
    if (asked && (code === 'quota' || code === 'rate')) lastProbe = Date.now();       // Google was just asked and said no: don't ask again straight away
    const detail = e instanceof GeminiError ? { resetAt: e.resetAt, retrySec: e.retryMs ? Math.ceil(e.retryMs / 1000) : undefined } : {};
    if (code !== 'aborted') setStatus('error', code === 'quota' && detail.resetAt ? `${REASON.quota} It should be back ${whenText(detail.resetAt)}.` : REASON[code] || REASON.upstream);
    return { ok: false, error: code, ...detail };
  }
  const { res, model, ctl } = opened;
  const onAbort = () => ctl.abort();
  signal && signal.addEventListener('abort', onAbort);
  let stall = 0;
  const touch = () => { clearTimeout(stall); stall = setTimeout(() => ctl.abort(), STALL_MS); };
  touch();
  const rs = new ReplyStream();
  let full = '', blocked = false, tokens = 0;
  try {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      touch();
      buf += dec.decode(value, { stream: true });
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        for (const line of block.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.usageMetadata) tokens = count(ev.usageMetadata.totalTokenCount) || count(ev.usageMetadata.promptTokenCount) + count(ev.usageMetadata.candidatesTokenCount);
          if (ev.promptFeedback && ev.promptFeedback.blockReason) blocked = true;
          const cand = ev.candidates && ev.candidates[0];
          if (!cand) continue;
          if (cand.finishReason && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(cand.finishReason) && !full) blocked = true;
          for (const p of (cand.content && cand.content.parts) || []) if (typeof p.text === 'string') full += p.text;
          const meta = rs.meta(full);
          if (meta && onMeta) onMeta(meta);
          const delta = rs.feed(full);
          if (delta && onDelta) onDelta(delta);
        }
      }
    }
  } catch {
    if (signal && signal.aborted) return { ok: false, error: 'aborted' };
    if (!full) { setStatus('error', REASON.upstream); return { ok: false, error: 'upstream' }; }      // a stream that broke after it had started: use what arrived
  } finally {
    clearTimeout(stall);
    signal && signal.removeEventListener('abort', onAbort);
  }
  if (!full) return { ok: false, error: blocked ? 'blocked' : 'empty' };
  const final = validateReply(parseFinal(full));
  final.reply = cleanReply(final.reply);
  if (!final.reply && final.sound === 'none' && final.gesture === 'none') return { ok: false, error: blocked ? 'blocked' : 'empty' };
  if (status.state !== 'ok') setStatus('ok');
  noteReply(tokens);
  return { ok: true, final, model };
}

/** The "Save & test" check: asks Google for the model list with the saved key. Resolves { ok, error }. */
export async function testKey() {
  if (!readKey()) return { ok: false, error: 'Paste your Gemini key first.' };
  ranked = null;
  try {
    ranked = rank(await listModels());
    setStatus('ok');
    return { ok: true };
  } catch (e) {
    const code = e instanceof GeminiError ? e.code : 'upstream';
    setStatus('error', REASON[code] || REASON.upstream);
    return { ok: false, error: REASON[code] || REASON.upstream, code };
  }
}
