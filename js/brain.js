// Where Quark's words come from. There is no canned conversation: every message goes to a real AI brain.
//
//   1. a backend (your own URL, or the dev server's /brain once it has a key) -> Gemini, streamed
//   2. the user's own Gemini key, pasted in Settings: this browser calls Gemini directly (how a shared copy on a static host chats)
//   3. Chrome's on-device model, if the user turned it on in Settings (nothing leaves the device)
//   4. none of those -> the caller is told "offline" and shows an honest notice instead of pretending to chat
//
// The front end only ever sends: the user's message (or an event), a short chat history, a rolling memory summary,
// Quark's current emotion, short text hints and the model name from config.js. No API key, no video, no landmarks.
//
// A reply streams in as it is written: first { emotion, intensity, gesture } (so the face can react), then the reply
// text in pieces (so speech can start on the first sentence), then the final, validated object with memory_update.

import { CONFIG } from './config.js';
import { settings } from './storage.js';
import * as onDevice from './ondevice.js';
import { ownKey, converse as viaOwnKey } from './geminikey.js';
import { MOODS, EMOTIONS, GESTURES, cleanReply } from './moods.js';
import { validateReply } from './streamjson.js';
import { startTurn, debugOn } from './debuglog.js';

export { MOODS, EMOTIONS, GESTURES, cleanReply };

let discovered = '';   // '/brain' when the dev server that served this page has a key (or mock replies)
let mockBrain = false;

/** A URL the user configured: the Settings value wins over config.js. */
export const getConfiguredUrl = () => String(settings.get('backendUrl') || CONFIG.backendUrl || '').trim().replace(/\/+$/, '');
export const getBackendUrl = () => getConfiguredUrl() || discovered;
/** 'backend' | 'dev server' | 'own key' | 'on-device' | 'none' */
export const brainKind = () => (getConfiguredUrl() ? 'backend' : discovered ? 'dev server' : ownKey.has() ? 'own key' : settings.get('onDevice') ? 'on-device' : 'none');
export const isMock = () => mockBrain && !getConfiguredUrl();

/** Look for a brain next door: the dev server exposes /brain/health. Safe to call any time. */
export async function discoverBrain() {
  discovered = '';
  mockBrain = false;
  if (getConfiguredUrl()) return getConfiguredUrl();
  try {
    const r = await fetch('/brain/health', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && j.ok && (j.hasKey || j.mock)) { discovered = '/brain'; mockBrain = !!j.mock && !j.hasKey; }
      return discovered ? { url: discovered, mock: mockBrain } : '';
    }
  } catch { /* a static host with no /brain: fine */ }
  return '';
}

/** Read a server-sent-events body, calling onEvent(obj) for each `data:` line. */
async function readSSE(res, onEvent, touch) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    touch();
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore a malformed event */ }
      }
    }
  }
}

/**
 * Ask the backend. Resolves { ok:true, final } or { ok:false, error: 'offline'|'rate'|'blocked'|'empty'|'upstream' }.
 * `stall` is called whenever data arrives, so the caller's timeout is "nothing for N seconds", not "N seconds in total".
 */
async function viaBackend(body, { onMeta, onDelta, signal }, turn = {}) {
  const url = getBackendUrl();
  const t0 = performance.now();
  turn.url = `${url}/chat`;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  let timer = 0;
  let timedOut = false;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, CONFIG.chat.timeoutMs); };
  touch();
  try {
    const res = await fetch(`${url}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.geminiModel, stream: true, ...body }),
      signal: ctl.signal,
    });
    turn.http = res.status;
    turn.ttfbMs = Math.round(performance.now() - t0);
    if (res.status === 429) return { ok: false, error: 'rate' };
    if (!res.ok) return { ok: false, error: res.status === 400 ? 'empty' : 'upstream' };
    touch();
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/event-stream')) {
      // an older server that answers with plain JSON: no streaming, but the same contract
      const data = await res.json();
      const final = validateReply(data);
      if (!final.reply && final.sound === 'none' && final.gesture === 'none') return { ok: false, error: 'empty' };
      onMeta?.({ emotion: final.emotion, intensity: final.intensity, gesture: final.gesture, sound: final.sound });
      onDelta?.(final.reply);
      return { ok: true, final };
    }
    let final = null;
    let error = '';
    await readSSE(res, (ev) => {
      if (ev.type === 'meta') { turn.metaMs ??= Math.round(performance.now() - t0); onMeta?.({ emotion: ev.emotion, intensity: ev.intensity, gesture: ev.gesture, sound: ev.sound }); }
      else if (ev.type === 'delta') { turn.firstWordMs ??= Math.round(performance.now() - t0); onDelta?.(ev.text); }
      else if (ev.type === 'final') { final = validateReply(ev); turn.model = ev.model || ''; turn.raw = ev.raw; turn.trace = ev.trace; turn.serverMs = ev.ms; }
      else if (ev.type === 'error') { error = String(ev.error || 'upstream'); turn.raw = ev.raw; turn.trace = ev.trace; }
    }, touch);
    if (final && (final.reply || final.sound !== 'none' || final.gesture !== 'none')) return { ok: true, final };       // a wordless reaction is an answer too
    return { ok: false, error: error === 'blocked' ? 'blocked' : error === 'empty reply' ? 'empty' : 'upstream' };
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: 'aborted' };
    return { ok: false, error: timedOut ? 'upstream' : 'offline' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

let lastDiscover = 0;
/** The page may have loaded before the server had a key (or while it was restarting): look again, at most every 15 s. */
async function ensureBackend() {
  if (getBackendUrl()) return true;
  if (Date.now() - lastDiscover > 15000) { lastDiscover = Date.now(); await discoverBrain(); }
  return !!getBackendUrl();
}

/**
 * One conversational turn.
 *   req: { message?, event?, heard?: { confidence, alternatives }, history: [{role,text}], hints: string[], context: {...} }
 *   handlers: { onMeta({emotion,intensity,gesture}), onDelta(text), signal }
 * Resolves { ok:true, final, source, ms } or { ok:false, error, source, ms }. Never rejects.
 */
export async function converse(req, handlers = {}) {
  const t0 = performance.now();
  const body = {
    message: req.message || '',
    event: req.event || '',
    history: req.history || [],
    hints: req.hints || [],
    heard: req.heard || undefined,
    context: req.context || {},
  };
  if (debugOn()) body.debug = true;                                   // the server then also reports the raw model text and what it tried
  const ctx = body.context;
  const turn = startTurn({
    kind: req.message ? 'user message' : 'event',
    user: req.message || '', event: req.event || '', heard: req.heard || null,
    requestedModel: CONFIG.geminiModel,
    payload: body,
    payloadBytes: JSON.stringify(body).length,
    parts: { history: body.history.length, hints: body.hints.length, summaryChars: (ctx.summary || '').length, facts: (ctx.facts || []).length, recentLines: (ctx.recentLines || []).length, emotion: ctx.emotion, mode: ctx.mode, focus: !!ctx.focus },
  });
  const done = (r, source) => {
    turn.source = source;
    turn.totalMs = Math.round(performance.now() - t0);
    turn.ok = !!r.ok;
    turn.error = r.ok ? '' : r.error;
    if (r.fellBack) turn.fallback = 'the backend failed, so the small on-device AI answered';
    else if (!r.ok && r.error === 'offline') turn.fallback = 'no brain reachable: no reply was made up';
    else if (!r.ok) turn.fallback = `the call failed (${r.error}): no reply was made up`;
    if (r.ok && r.final) turn.reply = r.final;
    return { ...r, source, ms: turn.totalMs, turn };
  };
  if (await ensureBackend()) {
    const r = await viaBackend(body, handlers, turn);
    if (r.ok || r.error === 'aborted' || r.error === 'rate' || r.error === 'blocked') return done(r, brainKind());
    // the backend is unreachable or broke: try the user's own key, then the on-device model if they turned it on (it is much smaller)
    if (ownKey.has()) { const o = await viaOwnKey(body, handlers); if (o.ok) turn.model = o.model; return done({ ...o, fellBack: false }, 'own key'); }
    if (await onDevice.ready()) return done({ ...(await onDevice.converse(body, handlers)), fellBack: true }, 'on-device');
    return done(r, brainKind());
  }
  if (ownKey.has()) {
    const r = await viaOwnKey(body, handlers);
    if (r.ok) turn.model = r.model;
    if (r.ok || ['aborted', 'rate', 'blocked', 'badkey', 'quota'].includes(r.error)) return done(r, 'own key');
    if (await onDevice.ready()) return done({ ...(await onDevice.converse(body, handlers)), fellBack: true }, 'on-device');   // Google was unreachable: the small local one can still chat
    return done(r, 'own key');
  }
  if (await onDevice.ready()) return done(await onDevice.converse(body, handlers), 'on-device');
  return done({ ok: false, error: 'offline' }, 'none');
}

/** Is there any brain to talk to right now? (Used to decide between talking and showing the offline notice.) */
export async function hasBrain() {
  return !!getBackendUrl() || ownKey.has() || (await onDevice.ready());
}

/** A one-off request to the backend (roast writing, judging). Resolves the JSON, or null if there is no brain or it failed. */
async function postMode(body) {
  if (!(await ensureBackend())) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CONFIG.chat.timeoutMs);
  const payload = JSON.stringify({ model: CONFIG.geminiModel, ...body });
  const t0 = performance.now();
  const turn = startTurn({ kind: body.mode, user: body.userRoast || (body.roasts ? `A: ${body.roasts.a}  |  B: ${body.roasts.b}` : ''), requestedModel: CONFIG.geminiModel, payload: JSON.parse(payload), payloadBytes: payload.length });
  try {
    const res = await fetch(`${getBackendUrl()}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: ctl.signal });
    turn.http = res.status;
    turn.totalMs = Math.round(performance.now() - t0);
    const data = res.ok ? await res.json() : null;
    turn.raw = data ? JSON.stringify(data) : '';
    turn.ok = !!data;
    if (!data) turn.fallback = `the call failed (HTTP ${res.status}): the game uses its own stock line or a local judge`;
    return data;
  } catch (e) {
    turn.totalMs = Math.round(performance.now() - t0);
    turn.ok = false;
    turn.error = e && e.name === 'AbortError' ? 'timeout' : 'network';
    turn.fallback = `the call failed (${turn.error}): the game uses its own stock line or a local judge`;
    return null;
  } finally { clearTimeout(timer); }
}

/** Quark writes a roast. body: { level, kid, round, rounds, role: 'open'|'reply', userRoast, userName, facts, battle }. -> { roast, emotion, intensity } or null */
export async function roastRequest(body) {
  const d = await postMode({ mode: 'roast', ...body });
  return d && typeof d.roast === 'string' ? d : null;
}

/** Blind judging of one round. body: { round, roasts: { a, b } } (the caller shuffles who is A). -> { a, b, quip } or null */
export async function judgeBlind(body) {
  const d = await postMode({ mode: 'judge', ...body });
  return d && d.a && d.b && typeof d.a.wit === 'number' ? d : null;
}
