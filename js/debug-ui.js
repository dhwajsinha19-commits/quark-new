// Debug tools: one bottom sheet with three tabs.
//
//   Mic           permission, what the recogniser is doing right now, the last 10 events and errors, the live transcript,
//                 and an optional loudness meter (it opens its own microphone stream, only while you ask it to)
//   Conversation  one card per call to the brain: what was sent, what came back, how long it took, the raw AI reply, and
//                 whether any fallback fired and why
//   Emotion Lab   one button per emotion the engine knows, an intensity slider and a blend control
//
// Open it from Settings > Developer tools, or turn on "Show the debug button" there (or add ?debug to the URL) and a small
// button appears on the Quark and game pages. Nothing is sent anywhere or saved: the records live until the page closes.

import { mic, turns, micEvent, debugOn } from './debuglog.js';
import { EMOTIONS } from './moods.js';
import { EXPR, EYE_DEFAULT, COLORS } from './expressions.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };
const ms = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

// ------------------------------------------------------------------ blending two faces
const lerp = (a, b, t) => a + (b - a) * t;
/** A complete definition with every parameter filled in, so any two can be mixed. */
function full(def) {
  const eye = { ...EYE_DEFAULT, ...(def.eye || {}) };
  return {
    color: def.color || COLORS.cyan,
    eye,
    L: { ...eye, ...(def.L || {}) },
    R: { ...eye, ...(def.R || {}) },
    blush: def.blush ?? 0, dim: def.dim ?? 1, tremble: def.tremble ?? 0, scale: def.scale ?? 1, eyeY: def.eyeY ?? 170,
    mouth: { A: 0, curve: 0, open: 0, W: 26, ...(def.mouth || {}) },
  };
}
function mix(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  if (Array.isArray(a)) return a.map((x, i) => mix(x, b[i], t));
  if (a && typeof a === 'object') { const o = {}; for (const k of Object.keys(a)) o[k] = mix(a[k], b[k], t); return o; }
  return t < 0.5 ? a : b;
}
export const blendFaces = (nameA, nameB, t) => mix(full(EXPR[nameA] || EXPR.neutral), full(EXPR[nameB] || EXPR.neutral), t);

const SAMPLE = {
  happy: 'Hey, you! I am so glad you are here.', excited: 'Oh wow, that is amazing! Tell me everything!', curious: 'Hmm, wait. How does that even work?',
  content: 'Everything is nice and quiet right now.', bored: 'Nothing is happening. Nothing at all. Fascinating.', sleepy: 'I think I will rest my eyes for a little while.',
  startled: 'Whoa! Where did you come from?', scared: 'Did you hear that? I think something moved.', sulky: 'No. I am not talking to you right now.',
  sad: 'I just feel a little down today, that is all.', angry: 'That is the third time. Seriously. Stop it.',
};

export function mountDebug(q) {
  const root = document.createElement('div');
  root.className = 'dbg';
  root.hidden = true;
  root.innerHTML = `
    <div class="dbg-head">
      <div class="dbg-tabs" role="tablist">
        <button type="button" role="tab" data-tab="mic">Mic</button>
        <button type="button" role="tab" data-tab="turns">Conversation</button>
        <button type="button" role="tab" data-tab="lab">Emotion Lab</button>
      </div>
      <button type="button" class="dbg-x" aria-label="Close debug tools">×</button>
    </div>
    <div class="dbg-body"></div>`;
  document.body.appendChild(root);
  const body = root.querySelector('.dbg-body');

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'dbg-chip';
  chip.textContent = 'debug';
  chip.hidden = true;
  chip.setAttribute('aria-label', 'Open debug tools');
  document.body.appendChild(chip);

  let tab = 'mic';
  let timer = 0;
  let lastHtml = '';
  const expanded = new Set();          // conversation cards that are open
  let payloadOpen = new Set();
  let perm = 'unknown';
  let meter = null;                    // { stream, ctx, analyser, raf, level }
  const lab = { name: 'happy', intensity: 60, second: 'sad', mix: 0, preset: '' };

  // ---- permission (Chrome can tell us; Safari can't)
  try {
    navigator.permissions?.query({ name: 'microphone' }).then((p) => {
      perm = p.state;
      p.onchange = () => { perm = p.state; micEvent('permission', p.state, p.state === 'denied' ? 'error' : 'info'); };
    }).catch(() => { perm = 'unknown'; });
  } catch { /* unsupported */ }

  // ------------------------------------------------------------------ Mic tab
  function micHtml() {
    const d = q.listen ? q.listen.debug() : { recState: 'unsupported' };
    let state = d.recState;
    if (q.chat.phase === 'thinking' && (state === 'idle' || state === 'listening' || state === 'hearing')) state = 'processing';
    const SRkind = window.SpeechRecognition ? 'standard' : window.webkitSpeechRecognition ? 'webkit prefix' : 'none';
    const cam = q.tracker && q.tracker.state !== 'off' ? `on (${q.tracker.state})` : 'off';
    const events = mic.events.slice(-10).reverse();
    return `
      <div class="dbg-grid">
        <div><b>Permission</b><span class="pill ${perm === 'granted' ? 'ok' : perm === 'denied' ? 'bad' : 'warn'}">${esc(perm)}</span></div>
        <div><b>Recogniser</b><span class="pill st-${esc(state)}">${esc(state)}</span></div>
        <div><b>Mode</b><span>${d.handsFree ? `wake word "${esc(q.name())}"` : 'tap to talk'}${d.kind ? ` · running: ${esc(d.kind)}` : ''}</span></div>
        <div><b>Errors in a row</b><span>${d.errorStreak ?? 0}${d.startTries ? ` · refused starts: ${d.startTries}` : ''}</span></div>
        <div><b>Brain</b><span>${esc(q.chat.phase)}${q.chat.conversing ? ' · in a conversation' : ''}</span></div>
        <div><b>Quark voice</b><span>${q.voice.speaking ? 'speaking (mic paused)' : 'quiet'}</span></div>
        <div><b>Speech API</b><span>${esc(SRkind)}${d.lang ? ` · ${esc(d.lang)}` : ''}</span></div>
        <div><b>Secure page</b><span>${window.isSecureContext ? 'yes' : 'no (mic needs https or localhost)'}</span></div>
        <div><b>Camera</b><span>${esc(cam)}</span></div>
        <div><b>Tab</b><span>${document.hidden ? 'hidden' : 'visible'} · ${navigator.onLine ? 'online' : 'OFFLINE'}</span></div>
      </div>
      <div class="dbg-row"><button type="button" class="dbg-btn" data-act="listen">Listen once</button>
        <button type="button" class="dbg-btn" data-act="handsfree">${d.handsFree ? 'Hands-free off' : 'Hands-free on'}</button></div>
      <div class="dbg-h">Transcript</div>
      <div class="dbg-tr"><span class="lbl">hearing</span> <i>${esc(mic.interim) || '…'}</i></div>
      <div class="dbg-tr"><span class="lbl">final</span> ${mic.final ? `“${esc(mic.final)}” <small>${clock(mic.finalAt)}</small>` : '…'}</div>
      <div class="dbg-h">Loudness</div>
      <div class="dbg-meter"><i id="dbgLevel"></i></div>
      <div class="dbg-row"><span id="dbgDb">${meter ? 'measuring…' : 'off'}</span>
        <button type="button" class="dbg-btn" data-act="meter">${meter ? 'Stop measuring' : 'Measure the microphone'}</button></div>
      <p class="dbg-note">The meter opens its own microphone stream for a moment, only while you ask it to. Some browsers pause voice recognition while it runs.</p>
      <div class="dbg-h">Last ${events.length} events <button type="button" class="dbg-btn sm" data-act="copy-mic">Copy</button> <button type="button" class="dbg-btn sm" data-act="clear-mic">Clear</button></div>
      <div class="dbg-log">${events.length ? events.map((e) => `<div class="ev ${e.level}"><time>${clock(e.t)}</time><b>${esc(e.type)}</b><span>${esc(e.detail)}</span></div>`).join('') : '<div class="ev"><span>No events yet. Open the Quark page and talk.</span></div>'}</div>`;
  }

  async function toggleMeter() {
    if (meter) { stopMeter(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const m = { stream, ctx, analyser, raf: 0 };
      const track = stream.getAudioTracks()[0];
      track.addEventListener('ended', () => { micEvent('meter stream ended', 'another app or tab took the microphone', 'error'); stopMeter(); });
      track.addEventListener('mute', () => micEvent('meter stream muted', 'the system muted the microphone', 'warn'));
      track.addEventListener('unmute', () => micEvent('meter stream unmuted', 'microphone is live again'));
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;
        const el = document.getElementById('dbgLevel');
        const t = document.getElementById('dbgDb');
        if (el) el.style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100))}%`;
        if (t) t.textContent = `${db > -99 ? db.toFixed(0) : '−∞'} dB${db < -55 ? ' (silent)' : ''}`;
        m.raf = requestAnimationFrame(tick);
      };
      meter = m;
      micEvent('meter on', 'own microphone stream opened');
      tick();
    } catch (e) {
      micEvent('meter failed', `${e.name || 'error'}: ${e.message || ''}`.trim(), 'error');
      meter = null;
    }
    render(true);
  }
  function stopMeter() {
    if (!meter) return;
    cancelAnimationFrame(meter.raf);
    meter.stream.getTracks().forEach((t) => t.stop());
    try { meter.ctx.close(); } catch { /* ignore */ }
    meter = null;
    micEvent('meter off', 'stream released');
    render(true);
  }

  // ------------------------------------------------------------------ Conversation tab
  function turnHtml(t) {
    const open = expanded.has(t.id);
    const head = `<div class="turn-h" data-turn="${t.id}">
        <time>${clock(t.at)}</time><span class="kind">${esc(t.kind)}</span>
        <span class="u">${esc((t.user || t.event || '').slice(0, 70)) || '<i>(no text)</i>'}</span>
        <span class="r">${t.ok === undefined ? '…' : t.ok ? ms(t.totalMs) : '<b class="x">failed</b>'}</span>
        ${t.http ? `<span class="http ${t.http === 200 ? 'ok' : 'bad'}">${t.http}</span>` : ''}
        ${t.fallback ? '<span class="fb">fallback</span>' : ''}
      </div>`;
    if (!open) return `<div class="turn">${head}</div>`;
    const p = t.parts || {};
    const rep = t.reply;
    const trace = (t.trace || []).map((x) => `<tr><td>${esc(x.model)}</td><td>${x.thinking ? 'thinking off' : 'plain'}</td><td class="${x.outcome === 'ok' ? 'ok' : 'bad'}">${esc(x.outcome)}</td><td>${ms(x.ms)}</td></tr>`).join('');
    return `<div class="turn open">${head}
      <dl class="dl">
        <dt>Raw user text</dt><dd>${t.user ? `“${esc(t.user)}”` : t.event ? `(event) ${esc(t.event)}` : '–'}</dd>
        ${t.heard ? `<dt>Heard</dt><dd>confidence ${t.heard.confidence != null ? Math.round(t.heard.confidence * 100) + '%' : 'unknown'}${t.heard.alternatives && t.heard.alternatives.length ? ` · alternatives: ${t.heard.alternatives.map((a) => `“${esc(a)}”`).join(', ')}` : ''}</dd>` : ''}
        <dt>Payload</dt><dd>${kb(t.payloadBytes || 0)} · history ${p.history ?? '–'} turns · summary ${p.summaryChars ?? '–'} chars · facts ${p.facts ?? '–'} · recent lines ${p.recentLines ?? '–'} · hints ${p.hints ?? '–'} · mode ${esc(p.mode)}${p.focus ? ' (focus)' : ''} · emotion sent ${p.emotion ? `${esc(p.emotion.name)} ${p.emotion.intensity}` : '–'}</dd>
        <dt>Model</dt><dd>requested “${esc(t.requestedModel)}” → answered by <b>${esc(t.model || (t.source === 'on-device' ? 'on-device AI' : '–'))}</b> (${esc(t.source || '–')})</dd>
        <dt>Timing</dt><dd>headers ${ms(t.ttfbMs)} · emotion ${ms(t.metaMs)} · first word ${ms(t.firstWordMs)} · total ${ms(t.totalMs)}${t.serverMs != null ? ` · server ${ms(t.serverMs)}` : ''}</dd>
        <dt>HTTP status</dt><dd>${t.http ?? '–'}${t.error ? ` · error: ${esc(t.error)}` : ''}</dd>
        ${trace ? `<dt>Models tried</dt><dd><table class="tr">${trace}</table></dd>` : ''}
        <dt>Raw AI reply</dt><dd>${t.raw ? `<pre>${esc(t.raw)}</pre>` : '<i>not captured (it is only requested while the debug tools are on)</i>'}</dd>
        ${rep ? `<dt>Parsed</dt><dd>emotion <b>${esc(rep.emotion)}</b> ${rep.intensity} · gesture ${esc(rep.gesture)} · memory: ${esc((rep.memory_update && rep.memory_update.summary) ? 'summary updated' : 'unchanged')}${rep.memory_update && rep.memory_update.name ? ` · name “${esc(rep.memory_update.name)}”` : ''}<br>“${esc(rep.reply)}”</dd>` : ''}
        ${t.spoken !== undefined ? `<dt>Spoken</dt><dd>${esc(t.spoken) || '–'}${t.variety ? ` · variety filter: ${t.variety.dropped} dropped, ${t.variety.rewritten} rewritten` : ''}</dd>` : ''}
        <dt>Fallback fired?</dt><dd>${t.fallback ? `<b class="x">yes:</b> ${esc(t.fallback)}` : 'no'}</dd>
        ${t.notice ? `<dt>Notice shown</dt><dd>${esc(t.notice)}</dd>` : ''}
      </dl>
      <div class="dbg-row"><button type="button" class="dbg-btn sm" data-copy-turn="${t.id}">Copy turn JSON</button>
        <button type="button" class="dbg-btn sm" data-payload="${t.id}">${payloadOpen.has(t.id) ? 'Hide' : 'Show'} request payload</button></div>
      ${payloadOpen.has(t.id) ? `<pre class="payload">${esc(JSON.stringify(t.payload, null, 1))}</pre>` : ''}
    </div>`;
  }
  const turnsHtml = () => `
    <p class="dbg-note">${turns.length ? `Last ${turns.length} calls to the brain, newest first. Tap one to open it.` : 'No calls yet. Say or type something to Quark on the Quark page.'}</p>
    ${turns.map(turnHtml).join('')}
    ${turns.length ? '<div class="dbg-row"><button type="button" class="dbg-btn sm" data-act="clear-turns">Clear</button></div>' : ''}`;

  // ------------------------------------------------------------------ Emotion Lab tab
  function applyLab() {
    const { name, intensity, second, mix: m } = lab;
    q.idle.poke();                                                   // otherwise the idle timer (30 s) flips Quark to "bored" at once
    q.face.release('lab');
    q.emotion.set(name, intensity, 'lab');                          // engine -> mood -> resting face (the real path)
    if (m > 0 && second) {
      const a = q.emotion.expression(name, intensity);
      const b = q.emotion.expression(second, intensity);
      q.face.express(blendFaces(a, b, m / 100), { key: 'lab' });
    }
  }
  const labHtml = () => `
    <p class="dbg-note">The engine knows ${EMOTIONS.length} emotions. Tap one to put Quark in it (the same path the AI and touch use), then move the sliders.</p>
    <div class="lab-grid">${EMOTIONS.map((e) => `<button type="button" class="chip-btn ${lab.name === e && !lab.preset ? 'on' : ''}" data-emo="${e}">${e}</button>`).join('')}</div>
    <label class="lab-row">Intensity <input type="range" min="0" max="100" value="${lab.intensity}" data-lab="intensity"><output>${lab.intensity}</output></label>
    <label class="lab-row">Blend with
      <select class="sel" data-lab="second">${EMOTIONS.map((e) => `<option value="${e}" ${lab.second === e ? 'selected' : ''}>${e}</option>`).join('')}</select>
    </label>
    <label class="lab-row">Mix <input type="range" min="0" max="100" value="${lab.mix}" data-lab="mix"><output>${lab.mix}%</output></label>
    <div class="dbg-row"><button type="button" class="dbg-btn" data-act="say">Say a line like this</button>
      <button type="button" class="dbg-btn" data-act="lab-reset">Reset</button></div>
    <div class="dbg-grid">
      <div><b>Engine</b><span>${esc(q.emotion.name)} ${q.emotion.intensity}</span></div>
      <div><b>Resting face</b><span>${esc(q.face.base)}</span></div>
      <div><b>Showing</b><span>${esc(q.face.expression)}</span></div>
      <div><b>Voice tone</b><span>${esc(q.emotion.tone())}</span></div>
    </div>
    <div class="dbg-h">Every face the art has (${Object.keys(EXPR).length})</div>
    <div class="lab-grid">${Object.keys(EXPR).map((k) => `<button type="button" class="chip-btn ${lab.preset === k ? 'on' : ''}" data-preset="${k}">${k}</button>`).join('')}</div>`;

  // ------------------------------------------------------------------ rendering
  function render(force = false) {
    if (root.hidden) return;
    const html = tab === 'mic' ? micHtml() : tab === 'turns' ? turnsHtml() : labHtml();
    root.querySelectorAll('.dbg-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (!force && html === lastHtml) return;
    const keep = body.scrollTop;
    // don't rebuild the lab while a slider is being dragged
    if (tab === 'lab' && root.contains(document.activeElement) && document.activeElement.type === 'range' && !force) return;
    lastHtml = html;
    body.innerHTML = html;
    body.scrollTop = keep;
  }

  function open(which) {
    if (which) tab = which;
    root.hidden = false;
    document.getElementById('app').classList.add('dbg-open');       // lifts the face above the sheet (see style.css)
    lastHtml = '';
    render(true);
    clearInterval(timer);
    timer = setInterval(render, 350);
  }
  function close() {
    root.hidden = true;
    document.getElementById('app').classList.remove('dbg-open');
    clearInterval(timer);
    stopMeter();
  }

  root.querySelector('.dbg-x').addEventListener('click', close);
  root.querySelector('.dbg-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { tab = b.dataset.tab; lastHtml = ''; render(true); } });
  chip.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  root.addEventListener('pointerdown', (e) => e.stopPropagation());     // never pass touches through to the robot

  body.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-turn],[data-act],[data-emo],[data-preset],[data-copy-turn],[data-payload]');
    if (!t) return;
    if (t.dataset.turn) { const id = +t.dataset.turn; expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(true); return; }
    if (t.dataset.payload) { const id = +t.dataset.payload; payloadOpen.has(id) ? payloadOpen.delete(id) : payloadOpen.add(id); render(true); return; }
    if (t.dataset.copyTurn) { const x = turns.find((y) => y.id === +t.dataset.copyTurn); copy(JSON.stringify(x, null, 2)); return; }
    if (t.dataset.emo) { lab.name = t.dataset.emo; lab.preset = ''; applyLab(); render(true); return; }
    if (t.dataset.preset) { lab.preset = t.dataset.preset; q.face.release('lab'); q.face.express(lab.preset, { key: 'lab' }); render(true); return; }
    switch (t.dataset.act) {
      case 'meter': toggleMeter(); break;
      case 'listen': q.audio.unlock(); q.voice.unlock(); q.listen.listenOnce(); break;
      case 'handsfree': q.audio.unlock(); q.listen.setHandsFree(!q.listen.handsFree); break;
      case 'copy-mic': copy(mic.events.map((x) => `${clock(x.t)} ${x.level} ${x.type} ${x.detail}`).join('\n')); break;
      case 'clear-mic': mic.events.length = 0; render(true); break;
      case 'clear-turns': turns.length = 0; render(true); break;
      case 'say': q.audio.unlock(); q.voice.unlock(); q.voice.say(SAMPLE[lab.name] || 'Hello there.', { emotion: lab.name, natural: true }); break;
      case 'lab-reset': q.face.release('lab'); lab.mix = 0; lab.preset = ''; q.emotion.set('content', 35, 'lab'); render(true); break;
      default: break;
    }
  });
  body.addEventListener('input', (e) => {
    const k = e.target.dataset.lab;
    if (!k) return;
    lab[k] = k === 'second' ? e.target.value : +e.target.value;
    const out = e.target.parentElement.querySelector('output');
    if (out) out.textContent = k === 'mix' ? `${lab.mix}%` : String(lab.intensity);
    if (!lab.preset) applyLab();
  });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); micEvent('copied', `${text.length} characters`); }
    catch { micEvent('copy failed', 'clipboard not available', 'warn'); }
  }

  // ---- the little button on the Quark and game pages
  const app = document.getElementById('app');
  const syncChip = () => { chip.hidden = !(debugOn() && (app.dataset.page === 'quark' || app.dataset.page === 'game')); };
  new MutationObserver(syncChip).observe(app, { attributes: true, attributeFilter: ['data-page'] });
  syncChip();
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMeter(); });

  return { open, close, syncChip, get isOpen() { return !root.hidden; } };
}

