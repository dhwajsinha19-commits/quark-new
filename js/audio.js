// Quark's non-speech sounds, all synthesised with Web Audio oscillators (no audio files).
// The AudioContext can only start after a user gesture, so call unlock() from a pointer event.

import { rand, pick } from './util.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;
let purr = null;

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.9 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 5;
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = makeNoise();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {}); // 'suspended', or iOS's 'interrupted'
    return true;
  } catch {
    return false;
  }
}

export const isReady = () => !!ctx && ctx.state === 'running';

/** The shared AudioContext and the master output node (null until unlock() has run). The custom voice (voiceconn.js) plays through these. */
export const getContext = () => ctx;
export const getOutput = () => master;

export function setEnabled(on) {
  enabled = !!on;
  if (master) master.gain.setTargetAtTime(enabled ? 0.9 : 0, ctx.currentTime, 0.02);
  if (!enabled) purrStop(true);
}

const live = () => ctx && enabled && ctx.state !== 'closed';

function makeNoise() {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---------- building blocks ----------

/** One enveloped oscillator note. Times are seconds from now. */
function tone({ type = 'sine', f0, f1 = f0, t = 0, dur = 0.1, vol = 0.12, attack = 0.006, cutoff = 0, vib = 0, vibHz = 6 }) {
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let tail = o;
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f);
    tail = f;
  }
  tail.connect(g);
  g.connect(master);
  if (vib) {
    const l = ctx.createOscillator();
    const lg = ctx.createGain();
    l.frequency.value = vibHz;
    lg.gain.value = vib;
    l.connect(lg);
    lg.connect(o.frequency);
    l.start(t0);
    l.stop(t0 + dur + 0.05);
  }
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** A burst of filtered noise. */
function noise({ t = 0, dur = 0.2, vol = 0.2, type = 'bandpass', f = 2000, f1 = f, q = 1, attack = 0.003 }) {
  const t0 = ctx.currentTime + t;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (f1 !== f) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(flt);
  flt.connect(g);
  g.connect(master);
  s.start(t0, Math.random() * 0.5);
  s.stop(t0 + dur + 0.05);
}

// pentatonic ratios keep every random chirp pleasant
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4];

// ---------- the vocabulary ----------

/** The tiny blip between spoken words. */
export function blip(base = rand(720, 1500)) {
  if (!live()) return;
  tone({ type: pick(['triangle', 'sine', 'square']), f0: base, f1: base * rand(0.78, 1.6), dur: rand(0.05, 0.09), vol: 0.07, cutoff: 3400 });
}

/** Short emotive phrases. */
export function chirp(kind = 'happy') {
  if (!live()) return;
  const root = rand(640, 900);
  const run = (steps, o = {}) => steps.forEach((d, i) =>
    tone({ type: 'triangle', f0: root * PENTA[d] * (o.mul ?? 1), dur: o.dur ?? 0.075, t: i * (o.gap ?? o.dur ?? 0.075), vol: o.vol ?? 0.11, cutoff: 3600 }));
  switch (kind) {
    case 'happy': run([0, 2, 4]); break;
    case 'excited': run([0, 2, 3, 5, 3, 5], { dur: 0.06, vol: 0.1 }); break;
    case 'sad': run([4, 2, 0], { dur: 0.15, vol: 0.09, mul: 0.7 }); break;
    case 'ask': tone({ type: 'triangle', f0: root, f1: root * 1.75, dur: 0.24, vol: 0.1, cutoff: 3600, vib: 20 }); break;
    case 'huh': run([2, 0, 3], { dur: 0.09 }); break;
    case 'angry': tone({ type: 'sawtooth', f0: 150, f1: 95, dur: 0.32, vol: 0.09, cutoff: 700, vib: 14, vibHz: 18 }); break;
    // smug: slow, smooth and a little too pleased, two falling notes ("heh... hm")
    case 'smug':
      tone({ type: 'triangle', f0: root * 1.1, f1: root * 0.92, dur: 0.17, vol: 0.085, cutoff: 3000, vib: 10, vibHz: 6 });
      tone({ type: 'triangle', f0: root * 1.28, f1: root * 0.7, dur: 0.34, t: 0.22, vol: 0.08, cutoff: 2600, vib: 14, vibHz: 5 });
      break;
    // sulky: a low flat "hmph", turned away
    case 'sulky': tone({ type: 'sine', f0: 250, f1: 168, dur: 0.34, vol: 0.09, cutoff: 900, vib: 5, vibHz: 7 }); break;
    case 'giggle': for (let i = 0; i < 6; i++) tone({ type: 'triangle', f0: root * (i % 2 ? 1.5 : 1.25) * (1 + i * 0.03), dur: 0.05, t: i * 0.06, vol: 0.09, cutoff: 3600 }); break;
    default: blip();
  }
}

export function startle() {
  if (!live()) return;
  tone({ type: 'square', f0: 900, f1: 1900, dur: 0.07, vol: 0.09, cutoff: 4200 });
  tone({ type: 'square', f0: 1400, f1: 2300, dur: 0.09, t: 0.08, vol: 0.08, cutoff: 4200 });
}

export function boop() {
  if (!live()) return;
  tone({ type: 'sine', f0: 480, f1: 900, dur: 0.09, vol: 0.14 });
}

export function sad() {
  if (!live()) return;
  tone({ type: 'sine', f0: 700, f1: 380, dur: 0.55, vol: 0.1, vib: 12, vibHz: 7 });
}

/** Contented descending "bloop" as Quark drops off to sleep. */
export function sleepDown() {
  if (!live()) return;
  tone({ type: 'sine', f0: 520, f1: 190, dur: 0.9, vol: 0.09, vib: 8, vibHz: 4 });
}

export function yawn() {
  if (!live()) return;
  tone({ type: 'sine', f0: 560, f1: 250, dur: 1.3, vol: 0.1, vib: 14, vibHz: 5, attack: 0.2 });
  noise({ dur: 1.2, vol: 0.035, type: 'bandpass', f: 900, f1: 400, q: 0.7, attack: 0.25 });
}

export function sigh() {
  if (!live()) return;
  noise({ dur: 0.8, vol: 0.06, type: 'bandpass', f: 900, f1: 380, q: 0.6, attack: 0.18 });
}

/** A little hummed phrase. */
export function hum() {
  if (!live()) return;
  const root = pick([330, 349, 392]);
  const phrase = pick([[0, 2, 4, 2], [0, 4, 2, 0], [2, 3, 4, 5], [4, 2, 3, 0]]);
  phrase.forEach((d, i) => tone({ type: 'triangle', f0: root * PENTA[d], f1: root * PENTA[d] * 1.01, dur: 0.34, t: i * 0.36, vol: 0.055, cutoff: 1300, vib: 5, vibHz: 5.5, attack: 0.05 }));
}

/** Rising whine under the Ka-ma-ha-ma-ha shout. */
export function charge(sec = 1.4) {
  if (!live()) return;
  tone({ type: 'sawtooth', f0: 110, f1: 760, dur: sec, vol: 0.07, cutoff: 1800, vib: 40, vibHz: 14, attack: 0.15 });
}

/** Cartoon screen impact: thud + glass + zap. */
export function crack(power = 1) {
  if (!live()) return;
  tone({ type: 'sine', f0: 150, f1: 42, dur: 0.28, vol: 0.38 * power });
  noise({ dur: 0.28, vol: 0.32 * power, type: 'highpass', f: 1400, q: 0.5, attack: 0.002 });
  for (let i = 0; i < 6; i++) noise({ t: 0.04 + i * rand(0.03, 0.07), dur: 0.05, vol: 0.12, type: 'bandpass', f: rand(2800, 7000), q: 5 });
  tone({ type: 'square', f0: 90, f1: 1400, dur: 0.12, vol: 0.07, cutoff: 3000 });
}

/** Random digital stutter. */
export function glitch(ms = 600) {
  if (!live()) return;
  const n = Math.max(3, Math.round(ms / 55));
  for (let i = 0; i < n; i++) {
    const t = (i * ms) / n / 1000 + rand(0, 0.02);
    if (Math.random() < 0.7) tone({ type: pick(['square', 'sawtooth']), f0: rand(180, 3200), dur: rand(0.015, 0.045), t, vol: 0.05, cutoff: 5000 });
    else noise({ t, dur: 0.03, vol: 0.08, type: 'bandpass', f: rand(1000, 6000), q: 3 });
  }
}

/** Screen reboot: sweep + sparkly arpeggio. */
export function reform(sec = 1) {
  if (!live()) return;
  tone({ type: 'sine', f0: 180, f1: 1700, dur: sec * 0.8, vol: 0.09, vib: 20, vibHz: 12, attack: 0.1 });
  [880, 1109, 1319, 1760].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.09, t: sec * 0.8 + i * 0.07, vol: 0.09, cutoff: 4000 }));
}

// ---------- purr ----------

export function purrStart() {
  if (!live() || purr) return;
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(0.5, t0 + 0.35);
  out.connect(master);

  // a buzzy low saw, chopped ~25x a second like a cat's purr
  const car = ctx.createOscillator();
  car.type = 'sawtooth';
  car.frequency.value = 78;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const chop = ctx.createGain();
  chop.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 24;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.5;
  lfo.connect(lfoDepth);
  lfoDepth.connect(chop.gain);
  car.connect(lp);
  lp.connect(chop);
  chop.connect(out);

  // a slow wobble so it never sounds mechanical
  const wob = ctx.createOscillator();
  wob.frequency.value = 0.6;
  const wobDepth = ctx.createGain();
  wobDepth.gain.value = 4;
  wob.connect(wobDepth);
  wobDepth.connect(car.frequency);

  [car, lfo, wob].forEach((o) => o.start(t0));
  purr = { out, nodes: [car, lfo, wob] };
}

export function purrStop(immediate = false) {
  if (!purr) return;
  const p = purr;
  purr = null;
  const t = ctx.currentTime;
  p.out.gain.cancelScheduledValues(t);
  p.out.gain.setValueAtTime(Math.max(p.out.gain.value, 0.0001), t);
  p.out.gain.exponentialRampToValueAtTime(0.0001, t + (immediate ? 0.03 : 0.45));
  p.nodes.forEach((o) => o.stop(t + (immediate ? 0.06 : 0.5)));
}

// ---------- game sounds ----------

/** Soft drum hit; used for the three-beat shake in rock-paper-scissors. */
export function thump(pitch = 1) {
  if (!live()) return;
  tone({ type: 'sine', f0: 190 * pitch, f1: 60 * pitch, dur: 0.16, vol: 0.34 });
  noise({ dur: 0.05, vol: 0.06, type: 'lowpass', f: 700, q: 0.5 });
}

/** A rising blip per tap; `n` climbs through a pentatonic scale so fast tapping sounds like a run. */
export function tick(n = 0) {
  if (!live()) return;
  const f = 520 * PENTA[n % PENTA.length] * (Math.floor(n / PENTA.length) % 2 ? 2 : 1);
  tone({ type: 'triangle', f0: f, f1: f * 1.04, dur: 0.05, vol: 0.09, cutoff: 3800 });
}

export function whoosh() {
  if (!live()) return;
  noise({ dur: 0.35, vol: 0.2, type: 'bandpass', f: 400, f1: 2600, q: 1.2, attack: 0.12 });
}

export function reveal() {
  if (!live()) return;
  tone({ type: 'square', f0: 660, f1: 990, dur: 0.1, vol: 0.07, cutoff: 3200 });
  tone({ type: 'triangle', f0: 990, dur: 0.14, t: 0.1, vol: 0.09, cutoff: 3600 });
}

export function fanfare() {
  if (!live()) return;
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: i === 6 ? 0.5 : 0.13, t: i * 0.12, vol: 0.12, cutoff: 4200 }));
}

/** Sad trombone. */
export function wah() {
  if (!live()) return;
  [[392, 0.28], [370, 0.28], [349, 0.28], [330, 0.7]].forEach(([f, d], i) => tone({ type: 'sawtooth', f0: f, f1: f * (i === 3 ? 0.88 : 1), dur: d, t: [0, 0.3, 0.6, 0.9][i], vol: 0.08, cutoff: 900, vib: i === 3 ? 14 : 0, vibHz: 6 }));
}

export function drumroll(sec = 1) {
  if (!live()) return;
  for (let i = 0; i < sec * 22; i++) noise({ t: i * 0.045, dur: 0.04, vol: 0.05 + (i / (sec * 22)) * 0.07, type: 'bandpass', f: 220, q: 1 });
}

// ---------- spoken clips (the natural voice) ----------

/** Decode a WAV clip into an AudioBuffer. Resolves null if sound isn't unlocked yet or the clip can't be decoded. */
export function decodeClip(arrayBuffer) {
  if (!ctx) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const p = ctx.decodeAudioData(arrayBuffer.slice(0), (b) => resolve(b), () => resolve(null));   // callback form works on older Safari
      if (p && p.then) p.then(resolve, () => resolve(null));
    } catch { resolve(null); }
  });
}

/**
 * Play a decoded clip through the "tiny robot pet" chain: a touch of speed (cuter), a high-pass and a presence boost so it
 * sounds like a little speaker, and a faint amplitude wobble ("robot" 0..1, default subtle) so it is a robot but never hard to understand.
 * Returns { duration, done: Promise<boolean>, stop(), level() } (level is the current loudness 0..1, for the mouth).
 */
export function playClip(buf, { rate = 1, robot = 0.2, volume = 1 } = {}) {
  if (!ctx || !buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 160;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2800;
  presence.Q.value = 0.8;
  presence.gain.value = 2.5 + robot * 4;
  const am = ctx.createGain();
  const depth = Math.min(0.5, Math.max(0, robot * 0.45));
  am.gain.value = 1 - depth / 2;
  let osc = null;
  if (depth > 0.01) {
    osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 64;
    const d = ctx.createGain();
    d.gain.value = depth / 2;
    osc.connect(d);
    d.connect(am.gain);
    osc.start();
  }
  const out = ctx.createGain();
  out.gain.value = volume;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const samples = new Uint8Array(analyser.fftSize);
  src.connect(hp);
  hp.connect(presence);
  presence.connect(am);
  am.connect(out);
  out.connect(analyser);
  analyser.connect(master);
  let finish;
  const done = new Promise((r) => { finish = r; });
  let ended = false;
  const end = (ok) => {
    if (ended) return;
    ended = true;
    try { osc && osc.stop(); } catch { /* already stopped */ }
    try { src.disconnect(); out.disconnect(); analyser.disconnect(); } catch { /* ignore */ }
    finish(ok);
  };
  src.onended = () => end(true);
  src.start();
  return {
    duration: buf.duration / rate,
    done,
    stop() { try { src.stop(); } catch { /* not started */ } end(false); },
    level() {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
      return Math.sqrt(sum / samples.length);
    },
  };
}
