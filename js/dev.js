// Stage-1 lab: buttons for forcing expressions, moods and reactions, plus a "say this" box,
// so every part of the face and voice can be tried without waiting for it to happen on its own.
// Hidden in the final polish stage (CONFIG.showLab = false).

import { CONFIG } from './config.js';
import { EXPR } from './expressions.js';
import { settings } from './storage.js';
import { memory } from './memory.js';
import { brainKind, getBackendUrl } from './brain.js';

export function mountLab(q, { panel, button }) {
  button.hidden = false;
  panel.innerHTML = `
    <div class="top"><b>Stage 1 lab</b><button class="chip" data-act="close" type="button">close</button></div>

    <h4>Expressions (hold)</h4>
    <div class="row" data-group="expr"></div>

    <h4>Moods</h4>
    <div class="row" data-group="mood"></div>

    <h4>Reactions</h4>
    <div class="row" data-group="act"></div>

    <h4>Seen (simulate what the camera would report)</h4>
    <div class="row" data-group="cam"></div>

    <h4>Say something</h4>
    <div class="row"><input type="text" data-say placeholder="Type a line for {name} to say…" value="Hi! I am {name}. Beep boop, I am a very good pet."><button class="chip" data-act="say" type="button">say</button></div>
    <label><span>pitch</span><input type="range" data-pitch min="0.5" max="1.4" step="0.05" value="1"><em data-pitch-v>1.0×</em></label>
    <label><span>rate</span><input type="range" data-rate min="0.6" max="1.5" step="0.05" value="1"><em data-rate-v>1.0×</em></label>
    <div class="row" data-group="voice"></div>

    <h4>Brain</h4>
    <div class="row"><input type="text" data-backend placeholder="backend URL, e.g. http://localhost:8787"><button class="chip" data-act="backend" type="button">save</button></div>
    <div class="row" data-group="brain" style="margin-top:6px"></div>
    <div class="info" data-brain-info></div>

    <h4>Settings</h4>
    <div class="row"><input type="text" data-name placeholder="robot name"><button class="chip" data-act="rename" type="button">rename</button></div>
    <div class="row" data-group="idle" style="margin-top:6px"></div>

    <div class="info" data-info></div>`;

  const $ = (s) => panel.querySelector(s);
  const chip = (parent, label, onClick, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip ${cls}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    $(`[data-group="${parent}"]`).appendChild(b);
    return b;
  };

  // expressions
  const exprBtns = {};
  for (const name of Object.keys(EXPR)) {
    exprBtns[name] = chip('expr', name, () => {
      if (q.face.expression === name && q.face.base !== name) { q.face.release('lab'); exprBtns[name].classList.remove('on'); return; }
      q.face.express(name, { key: 'lab' });
      Object.values(exprBtns).forEach((b) => b.classList.remove('on'));
      exprBtns[name].classList.add('on');
    });
  }
  chip('expr', 'auto', () => { q.face.release('lab'); Object.values(exprBtns).forEach((b) => b.classList.remove('on')); });

  // moods
  for (const m of ['happy', 'playful', 'bored', 'sleepy', 'sulky', 'asleep']) {
    chip('mood', m, () => {
      q.face.clearOverrides();
      q.mood.set(m, { force: true });
      q.idle.poke();
      if (m === 'sulky') q.reactions.enterSulk();
      if (m === 'asleep') q.idle.sleepNow();
    });
  }

  // reactions
  const fakePt = () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.42, nx: 0, ny: -0.1, w: innerWidth, h: innerHeight });
  chip('act', 'punch', () => q.reactions.onPunch(fakePt()));
  chip('act', 'boop', () => q.reactions.onBoop(fakePt()));
  chip('act', 'pet 4s', () => {
    const h = q.reactions.touchHandlers;
    h.onPetStart();
    setTimeout(() => h.onPetEnd({ reason: 'release', ms: 4000 }), 4000);
  });
  chip('act', 'wake', () => q.reactions.wake(q.state.firstBoot ? 'first' : 'startle'));
  chip('act', 'sleep now', () => q.idle.sleepNow());
  chip('act', 'hum', () => q.idle.hum());
  chip('act', 'yawn', () => q.idle.yawn());
  chip('act', 'play', () => q.idle.playfulAct());
  chip('act', 'blink', () => q.face.blink());
  chip('act', 'glitch 1s', () => q.fx.glitch(1000));
  chip('act', 'hearts', () => { for (let i = 0; i < 5; i++) setTimeout(() => q.face.burst('heart'), i * 100); });
  chip('act', 'shut up', () => q.voice.cancel());

  // simulated vision events (the real ones come from js/vision/tracker.js)
  for (const ev of ['found', 'wave', 'highfive', 'thumbsup', 'approach', 'retreat', 'away', 'back', 'jump', 'dance-start', 'dance-end', 'sudden', 'still']) {
    chip('cam', ev, () => q.vision.onEvent({ type: ev }));
  }
  chip('cam', 'look left', () => q.vision.onGaze(0.9, 0));
  chip('cam', 'look right', () => q.vision.onGaze(-0.9, 0));
  chip('cam', 'poke', () => q.vision.pokeScreen());

  // voice
  const say = () => {
    q.audio.unlock();
    q.voice.unlock();
    q.say($('[data-say]').value || 'Beep.', { tone: 'happy' });
  };
  panel.querySelector('[data-act="say"]').addEventListener('click', say);
  $('[data-say]').addEventListener('keydown', (e) => { if (e.key === 'Enter') say(); });
  $('[data-pitch]').addEventListener('input', (e) => { q.voice.mul.pitch = +e.target.value; $('[data-pitch-v]').textContent = `${(+e.target.value).toFixed(2)}×`; });
  $('[data-rate]').addEventListener('input', (e) => { q.voice.mul.rate = +e.target.value; $('[data-rate-v]').textContent = `${(+e.target.value).toFixed(2)}×`; });
  const vBtns = {
    speech: chip('voice', 'voice + chirps', () => setVoice('speech')),
    beeps: chip('voice', 'beeps only', () => setVoice('beeps')),
  };
  function setVoice(v) {
    settings.set('voice', v);
    Object.entries(vBtns).forEach(([k, b]) => b.classList.toggle('on', k === v));
  }
  setVoice(settings.get('voice'));

  // brain
  $('[data-backend]').value = getBackendUrl();
  panel.querySelector('[data-act="backend"]').addEventListener('click', async () => {
    const v = $('[data-backend]').value.trim().replace(/\/+$/, '');
    settings.set('backendUrl', v);
    const info = $('[data-brain-info]');
    if (!v) { info.textContent = 'No backend set.'; return; }
    info.textContent = 'Checking…';
    try {
      const r = await fetch(`${v}/health`);
      const j = await r.json();
      info.textContent = `Backend OK${j.mock ? ' (mock replies)' : j.hasKey ? ' (Gemini key present)' : ' (no Gemini key set!)'} · models: ${(j.models || []).join(', ')}`;
    } catch (e) { info.textContent = `Can't reach ${v}: ${e.message}. Quark will use on-device AI if you turned it on, otherwise it can't chat.`; }
  });
  chip('brain', 'forget me', () => { memory.forget(); $('[data-brain-info]').textContent = 'Memory cleared: name, topics and chat history.'; });
  chip('brain', 'ask: tell me a joke', () => q.chat.send('tell me a joke', { source: 'text' }));
  chip('brain', 'ask: remind me', () => q.chat.send('remind me to drink water', { source: 'text' }));
  chip('brain', 'listen once', () => q.listen.listenOnce());

  // settings
  $('[data-name]').value = q.name();
  panel.querySelector('[data-act="rename"]').addEventListener('click', () => {
    const v = $('[data-name]').value.trim().slice(0, 16);
    if (v) { settings.set('name', v); q.ui?.refreshLabels?.(); q.cam?.refreshLabels?.(); q.say('From now on I am {name}. I like it.', { tone: 'happy' }); }
  });
  const idleBtns = {};
  for (const n of [1, 5, 20]) idleBtns[n] = chip('idle', `idle ×${n}`, () => { q.idle.setScale(n); Object.entries(idleBtns).forEach(([k, b]) => b.classList.toggle('on', +k === n)); }, n === 1 ? 'on' : '');

  // chrome
  const show = (on) => { panel.hidden = !on; document.getElementById('app').classList.toggle('lab-open', on); };
  const toggle = () => show(panel.hidden);
  button.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  panel.querySelector('[data-act="close"]').addEventListener('click', () => show(false));
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());

  // live info line
  let frames = 0, fps = 0, t0 = performance.now();
  const tickFps = () => {
    frames++;
    const t = performance.now();
    if (t - t0 >= 1000) { fps = Math.round((frames * 1000) / (t - t0)); frames = 0; t0 = t; }
    requestAnimationFrame(tickFps);
  };
  requestAnimationFrame(tickFps);
  setInterval(() => {
    if (panel.hidden) return;
    $('[data-info]').textContent =
      `${CONFIG.build} · ${fps} fps · face: ${q.face.expression} · mood: ${q.mood.name} · idle ${(q.idle.idleMs / 1000).toFixed(0)}s (×${q.idle.scale}) · ` +
      `voice out: ${q.voice.mode}${q.voice.ttsOK ? '' : ' (speech unavailable here → beeps)'} · ${q.voice.voiceName} · voice in: ${q.listen.supported ? q.listen.state : 'not supported here'} · ` +
      `brain: ${brainKind()} (last: ${q.chat.status.source}${q.chat.status.ms ? ` ${q.chat.status.ms}ms` : ''}${q.chat.status.error ? ` — ${q.chat.status.error}` : ''}) · ` +
      `you: ${memory.userName || '(name unknown)'}${memory.topics.length ? ` · topics: ${memory.topics.slice(0, 3).map((t) => t.t).join(', ')}` : ''} · ` +
      `camera: ${q.tracker.state}${q.tracker.state === 'on' ? ` · ${q.tracker.engine}${q.tracker.stats.delegate !== '-' ? '/' + q.tracker.stats.delegate : ''} · ${q.tracker.stats.fps}fps · ${q.tracker.stats.ms.toFixed(0)}ms/frame · face ${q.tracker.stats.face ? 'yes' : 'no'} · hand ${q.tracker.stats.hand}${q.tracker.stats.phone ? ' · phone moving' : ''}` : ''}${q.tracker.loadError ? ` (vision fallback: ${q.tracker.loadError.slice(0, 80)})` : ''} · ` +
      `haptics: ${typeof navigator.vibrate === 'function' ? 'vibrate' : 'visual shake'}`;
  }, 500);

  return { toggle };
}
