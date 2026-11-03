// The Voice Connection screen (Settings > Voice Connection): paste an ElevenLabs key and Voice ID, test the voice, and tune the robot
// effects. The engine is in voiceconn.js. Nothing here ever shows the saved key or Voice ID, only their last 4 characters.

import * as audio from './audio.js';
import { createSubtitles } from './subtitles.js';
import { MOODS, FX_LIMITS, DEFAULT_MODEL } from './voiceconn.js';
import { rand, sleep } from './util.js';

const SAMPLE = 'Hi! This is my new voice. Can you hear me okay?';
const LONG = 'Okay, here is a longer one. First I want to tell you that I missed you today. Then I looked around the whole room, twice, and nothing was happening at all. So I made up a little game in my head. Do you want to hear the rules?';
const SAME = 'I will say this exact line two times.';
const backIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
const eyeIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const SLIDERS = [
  ['lift', 'Pitch lift', 0.1, (v) => `+${v.toFixed(1)} st`],
  ['ring', 'Ring mod', 0.01, (v) => v.toFixed(2)],
  ['crush', 'Bitcrush', 0.01, (v) => v.toFixed(2)],
  ['bright', 'Brightness', 100, (v) => `${(v / 1000).toFixed(1)} kHz`],
  ['delay', 'Tiny echo', 0.01, (v) => v.toFixed(2)],
  ['volume', 'Volume', 0.05, (v) => v.toFixed(2)],
];
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountVoiceScreen(q, { el }) {
  const cloud = q.cloud;
  let sub = null;
  let busy = false;
  let poll = 0;
  let chirpToken = 0;
  let confirmTimer = 0;
  const $ = (s) => el.querySelector(s);

  function render() {
    const info = cloud.info();
    const fx = cloud.fx.get();
    el.innerHTML = `
      <header class="set-top">
        <button class="set-back" type="button" aria-label="Back to Settings">${backIcon}</button>
        <h1>Voice Connection</h1>
      </header>

      <section class="set-card">
        <h3>Your custom voice</h3>
        <div class="vc-status" id="vcStatus" data-state="none" role="status" aria-live="polite"><i class="vc-dot"></i><span id="vcStatusText"></span></div>

        <label class="vc-lab" for="vcKey">ElevenLabs API key</label>
        <div class="vc-field">
          <input class="vc-input" id="vcKey" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true" inputmode="text"
                 placeholder="${info.hasCreds ? `Saved, ends in ${escapeHtml(info.keyTail)}. Paste a new key to replace it` : 'Paste your key here'}">
          <button class="vc-eye" id="vcEye" type="button" aria-label="Show or hide the key" aria-pressed="false">${eyeIcon}</button>
        </div>

        <label class="vc-lab" for="vcVoice">Voice ID</label>
        <input class="vc-input" id="vcVoice" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true"
               placeholder="${info.hasCreds ? `Saved, ends in ${escapeHtml(info.voiceTail)}. Paste a new one to replace it` : 'Paste your Voice ID here'}">

        <label class="vc-lab" for="vcModel">Model</label>
        <input class="vc-input" id="vcModel" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${escapeHtml(info.model || DEFAULT_MODEL)}">
        <p class="set-note">${DEFAULT_MODEL} is ElevenLabs' fast, low-latency model (and cheapest per character). Change it only if you know you want another.</p>

        <div class="vc-actions">
          <button class="btn primary" id="vcSave" type="button">Save</button>
          <button class="btn" id="vcTest" type="button">Test voice</button>
          <button class="btn" id="vcRemove" type="button">Remove key</button>
        </div>
        <p class="set-note">Your key stays on this device. Don't share this app with the key saved.</p>
        <p class="set-note" id="vcNote"></p>
      </section>

      <section class="set-card">
        <h3>Voice test</h3>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Feeling</b><small>Changes the voice settings sent with each request.</small></span>
          <select class="sel" id="vcMood" aria-label="Feeling">${MOODS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
        </div>
        <input class="vc-input" id="vcText" type="text" value="${escapeHtml(SAMPLE)}" maxlength="300" aria-label="Text to speak" style="margin-top:8px">
        <div class="subtitles vc-subs" id="vcSubs"></div>
        <div class="vc-actions" style="margin-top:6px">
          <button class="btn primary" id="vcSpeak" type="button">Speak</button>
          <button class="btn" id="vcLong" type="button">Long reply</button>
          <button class="btn" id="vcTwice" type="button">Same line twice</button>
          <button class="btn" id="vcInterrupt" type="button">Interrupt test</button>
          <button class="btn" id="vcStop" type="button">Stop</button>
        </div>
        <p class="vc-result" id="vcResult"></p>

        <h3 style="margin-top:18px">Robot effects</h3>
        ${SLIDERS.map(([k, label, step, fmt]) => `
          <div class="vc-slider"><span>${label}</span>
            <input class="range" style="width:100%" type="range" data-fx="${k}" min="${FX_LIMITS[k][0]}" max="${FX_LIMITS[k][1]}" step="${step}" value="${fx[k]}" aria-label="${label}">
            <output data-out="${k}">${fmt(fx[k])}</output></div>`).join('')}
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Hear the raw voice</b><small>Turns the robot effects off for the next sentence, so you can compare.</small></span>
          <input class="switch" type="checkbox" id="vcRaw" ${cloud.fx.raw ? 'checked' : ''}>
        </div>
        <div class="vc-actions">
          <button class="btn" id="vcFxSave" type="button">Save as defaults</button>
          <button class="btn" id="vcFxReset" type="button">Reset effects</button>
        </div>
        <p class="vc-result" id="vcStats"></p>
      </section>
      <div class="toast" id="vcToast" hidden></div>
    `;
    sub = createSubtitles($('#vcSubs'));
    bind();
    paint();
  }

  const toast = (msg) => { const t = $('#vcToast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); };

  /** The status line, in plain words. */
  function paint() {
    const info = cloud.info();
    const s = info.status;
    let state = s.state, text;
    if (busy) { state = 'testing'; text = 'Testing the voice…'; }
    else if (s.state === 'connected') text = `Connected and working${info.session.lastFirstSoundMs ? ` · first sound in ${info.session.lastFirstSoundMs} ms` : ''}`;
    else if (s.state === 'error') text = `Problem: ${s.reason}`;
    else if (s.state === 'saved') text = 'Saved on this device. Press Test voice to check it.';
    else text = 'Not connected. Quark uses the chirp voice.';
    if (info.paused && !busy) text += ` (Paused for ${Math.ceil(info.pausedForMs / 1000)} s.)`;
    const box = $('#vcStatus'); if (!box) return;
    box.dataset.state = state;
    $('#vcStatusText').textContent = text;
    const st = $('#vcStats');
    if (st) st.textContent = `This session: ${info.session.chars} characters sent in ${info.session.requests} request${info.session.requests === 1 ? '' : 's'} (about ${info.credits} credits, an estimate), ${info.session.cacheHits} sentence${info.session.cacheHits === 1 ? '' : 's'} played from the cache.`;
    refreshDisk();
  }
  let diskTick = 0;
  async function refreshDisk() {
    if (performance.now() - diskTick < 2500) return;
    diskTick = performance.now();
    const d = await cloud.diskStats();
    const st = $('#vcStats');
    if (st && d.clips) st.textContent += ` Saved phrases on this device: ${d.clips} (${(d.bytes / 1048576).toFixed(1)} MB of 24).`;
  }

  /** The chirp voice, used for any sentence the custom voice can't do: a blip per word, the subtitles carry the words. */
  async function chirpLine(text, base) {
    const my = ++chirpToken;
    const words = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (my !== chirpToken) return;
      audio.blip(rand(640, 1500));
      sub.progress(base + i + 1);
      await sleep(95 + words[i].length * 16);
    }
  }

  /** Speak with subtitles; returns the engine's { done, stop }. */
  function speakLine(text, mood, opts = {}) {
    audio.unlock();
    q.voice.unlock?.();
    sub.begin();
    const base = [];
    const sentences = cloud.prepareSentences(text);
    const counts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
    const run = cloud.speak(sentences, {
      mood, fresh: !!opts.fresh,
      fallback: (s, m, i) => chirpLine(s, base[i] || 0),
      stopFallback: () => { chirpToken++; },
      onSentence: (i, s) => { base[i] = sub.wordCount; sub.append(s); },
      onProgress: (i, f) => sub.progress((base[i] || 0) + Math.ceil(f * counts[i])),
      onEnd: () => sub.finish(),
    });
    return run;
  }

  /** Save whatever is typed in the fields (only fields that have something in them change what is saved). */
  function saveTyped({ quiet = false } = {}) {
    const r = cloud.save({ key: $('#vcKey').value, voiceId: $('#vcVoice').value, model: $('#vcModel').value });
    if (!r.ok) { $('#vcNote').textContent = r.error; if (!quiet) toast(r.error); return false; }
    $('#vcKey').value = ''; $('#vcVoice').value = '';
    $('#vcKey').type = 'password'; $('#vcEye').setAttribute('aria-pressed', 'false');
    const info = cloud.info();
    $('#vcKey').placeholder = `Saved, ends in ${info.keyTail}. Paste a new key to replace it`;
    $('#vcVoice').placeholder = `Saved, ends in ${info.voiceTail}. Paste a new one to replace it`;
    $('#vcNote').textContent = r.error || '';
    if (!quiet) toast('Saved on this device');
    paint();
    return true;
  }

  async function testVoice() {
    if (busy) return;
    const typed = $('#vcKey').value.trim() || $('#vcVoice').value.trim();
    if (typed && !saveTyped({ quiet: true })) return;
    cloud.resetTrouble();
    busy = true; paint();
    const mood = $('#vcMood').value;
    const run = speakLine(SAMPLE, mood, { fresh: true });
    const r = await run.done;
    busy = false;
    const info = cloud.info();
    if (!info.hasCreds) cloud.setStatus('none');
    else if (r.cloud === 0 && info.status.state !== 'error') cloud.setStatus('error', 'The custom voice did not play. Using the chirp voice.');
    paint();
    $('#vcResult').textContent = r.cloud ? `Custom voice played${r.firstSoundMs != null ? `, first sound after ${r.firstSoundMs} ms` : ''}.` : (info.hasCreds ? 'The chirp voice spoke instead.' : 'No key saved, so the chirp voice spoke.');
  }

  async function sameTwice() {
    const mood = $('#vcMood').value;
    const a = await speakLine(SAME, mood).done;
    await sleep(350);
    const before = cloud.info().session.chars;
    const b = await speakLine(SAME, mood).done;
    const sent = cloud.info().session.chars - before;
    $('#vcResult').textContent = `1st time: first sound after ${a.firstSoundMs} ms${a.cached ? ' (cache)' : ''}. 2nd time: ${b.firstSoundMs} ms${b.cached ? ' (from the cache)' : ''}, ${sent} characters sent for the second.`;
    paint();
  }

  async function interrupt() {
    const mood = $('#vcMood').value;
    const run = speakLine(LONG, mood);
    await sleep(1600);
    const t0 = performance.now();
    run.stop();
    sub.hide();
    const r = await run.done;
    await sleep(900);
    const act = cloud.activity();
    $('#vcResult').textContent = `Stopped after 1.6 s: ${r.cloud} sentence${r.cloud === 1 ? '' : 's'} had played of ${r.sentences}; now ${act.playing} playing and ${act.inflight} requests in flight (the rest were cancelled).`;
    paint();
    return performance.now() - t0;
  }

  function bind() {
    $('.set-back').addEventListener('click', () => { cloud.stop(); q.router.go('settings'); });
    $('#vcEye').addEventListener('click', () => {
      const k = $('#vcKey'), show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      $('#vcEye').setAttribute('aria-pressed', String(show));
    });
    $('#vcSave').addEventListener('click', () => saveTyped());
    $('#vcTest').addEventListener('click', testVoice);
    $('#vcRemove').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (b.dataset.sure !== '1') {
        b.dataset.sure = '1'; b.textContent = 'Tap again to delete everything';
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Remove key'; }, 4000);
        return;
      }
      clearTimeout(confirmTimer);
      await cloud.remove();
      render();
      toast('Removed. Quark is using the chirp voice.');
    });
    $('#vcSpeak').addEventListener('click', () => { const t = $('#vcText').value.trim(); if (t) speakLine(t, $('#vcMood').value); else toast('Type something for Quark to say.'); });
    $('#vcText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#vcSpeak').click(); });
    $('#vcLong').addEventListener('click', () => { $('#vcText').value = LONG; speakLine(LONG, $('#vcMood').value); });
    $('#vcTwice').addEventListener('click', sameTwice);
    $('#vcInterrupt').addEventListener('click', interrupt);
    $('#vcStop').addEventListener('click', () => { cloud.stop(); sub.hide(); });
    for (const input of el.querySelectorAll('input[data-fx]')) {
      const [, , , fmt] = SLIDERS.find((s) => s[0] === input.dataset.fx);
      input.addEventListener('input', () => { cloud.fx.set({ [input.dataset.fx]: Number(input.value) }); $(`[data-out="${input.dataset.fx}"]`).textContent = fmt(Number(input.value)); });
    }
    $('#vcRaw').addEventListener('change', (e) => { cloud.fx.raw = e.target.checked; });
    $('#vcFxSave').addEventListener('click', () => toast(cloud.fx.saveDefaults() ? 'Saved as the defaults' : 'This browser would not save them'));
    $('#vcFxReset').addEventListener('click', () => { cloud.fx.reset(); render(); toast('Effects reset'); });
  }

  cloud.onStatus(() => paint());

  return {
    /** Called by the router whenever the page changes. */
    onPage(page) {
      clearInterval(poll);
      if (page === 'voice') { render(); poll = setInterval(paint, 1000); }
      else cloud.stop();
    },
  };
}
