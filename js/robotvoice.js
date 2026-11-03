// robotvoice.js — Quark's voice: a tiny synthesizer. No speech engine and no audio files; every sound is built here.
//
// TWO VOICES (config.style)
//   'voice' (default)  The light pet voice. One continuous, soft, slightly breathy voiced sound whose pitch glides along an
//                      intonation contour, run through three vowel filters that move from sound to sound, with quiet puffs of air
//                      for p/t/k, hushes for s/sh, hums for m/n. The text becomes babble that follows the real letters, a question
//                      rises, a sentence settles down, and a light robot touch (pitches snapped to semitones, a little ring
//                      modulation and bit-crush, a small echo) sits on top. Planning lives in voiceplan.js.
//   'chirp'            The first design: one short beep per letter (below). Kept so the two can be compared.
//
// How a sentence becomes sound in the 'chirp' style
//   * Every letter is one short chirp. The letters a..z climb a pentatonic scale, so each word has a little melody.
//   * Vowels (a e i o u) are longer, use a triangle wave and glide UP. Consonants are shorter, use a square wave and glide DOWN.
//   * Vowels also go through a "formant layer": a sawtooth through three band-pass filters tuned to that vowel's resonances,
//     so "a e i o u" sound different from each other while the voice stays clearly synthetic.
//   * Spaces, commas and full stops are pauses of different lengths. "?" ends in a rising glide, "!" in a louder, higher chirp.
//   * The whole signal goes through a bit-crusher, a light ring modulator, a 3.2 kHz low-pass and a short delay, so it sounds like
//     a small speaker inside a little body. Every chirp's pitch is nudged by a few percent so nothing repeats exactly.
//   * A mood (neutral, happy, excited, sad, sulky, angry, sleepy, scared, shy, smug, curious) changes pitch, speed, wobble, glide,
//     filter and wave shape. `intensity` (0..100) says how much of the mood to apply.
//
// Everything tweakable lives in VOICE_CONFIG (defaults) and MOOD_TABLE (what each mood does).
// Create the context inside a user tap (iOS Safari requires it): `voice.unlock()`.

import { planVoice, scoreFromNotes } from './voiceplan.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const semi = (n) => Math.pow(2, n / 12);

export const VOICE_CONFIG = {
  style: 'voice',             // 'voice' = the light pet voice; 'chirp' = one beep per letter
  pitch: 520,                 // Hz of the reference note
  speed: 1,
  volume: 0.18,
  lowSemis: -7,               // where the letter "a" sits, in semitones from `pitch`
  letterSpread: 0.4,          // how fast the letters climb the scale (bigger = wider melodies)
  vowel: { wave: 'triangle', dur: 0.13, glide: 0.2, attack: 0.006, decay: 0.07, gain: 1 },
  consonant: { wave: 'square', dur: 0.052, glide: -0.16, attack: 0.003, decay: 0.035, gain: 0.4 },
  gap: 0.014,                 // seconds between letters
  pauseSpace: 0.065,
  pauseComma: 0.2,
  pausePeriod: 0.34,
  jitter: 0.04,               // each chirp's pitch is nudged up or down by 3..5% (this value +/- jitterSpread)
  jitterSpread: 0.01,
  formant: { amount: 0.6, Q: 4, makeup: 8, maxSource: 0, gains: [1, 0.75, 0.4], refPower: 0.263 },   // refPower: the level every vowel is equalised to   // maxSource > 0 feeds the filters an octave lower above that pitch (measured: worse, so off)
  loudness: 1.15,              // fixed gain on the whole voice, so volume 0.18 is comfortable on a phone speaker
  ringMod: { amount: 0.25, freq: 90 },
  bitcrush: { amount: 0.3, bitsMax: 12, bitsMin: 4 },
  lowpass: 3200,
  space: { time: 0.05, feedback: 0.3, mix: 0.2 },
  blip: { gap: 0.1, freqs: [1250, 1750], dur: 0.045 },   // the two little beeps between sentences (chirp style)
  // the pet voice
  voice: {
    offsetSemis: 2,           // the speaking pitch sits this far above `pitch` (a small, bright creature)
    size: 1.28,               // vowel resonances are scaled up, like a small creature
    softness: 2.0,            // how fast the voice's harmonics fade out: bigger = softer, rounder and more flute-like
    Q: 5, gains: [1, 0.7, 0.4],
    voiceLevel: 0.5,
    intonation: 1.7,          // how much the melody of a sentence rises and falls (1 = plain, 2 = very singsong)
    glide: 2.2,               // each vowel slides up this many semitones: the cute singsong lilt (mood scales it)
    bounce: 1.2,              // every other syllable sits this much higher: bouncy
    snap: false,              // true = pitches sit on exact semitones (a more machine-like, autotuned sound)
    vibrato: 14, vibratoHz: 6,    // a little coo in the voice (cents, Hz)
    bodyHz: 2400,             // the plain part of the voice is softened above this
    formMakeup: 3, aspMakeup: 1.2, fricMakeup: 1,
  },
};
// what the shared effects (ring modulator, crusher, loudness) default to for each style
const STYLE_DEFAULTS = {
  voice: { ring: 0, ringHz: 70, crush: 0, loudness: 2.85, echo: 0.05 },        // cute, not sci-fi: no metallic ring, no crunch, hardly any echo
  chirp: { ring: 0.25, ringHz: 90, crush: 0.3, loudness: 1.15, echo: 0.2 },
};

// formants (Hz) of the five vowels, roughly: first, second, third resonance
const FORMANTS = { a: [800, 1200, 2800], e: [450, 1900, 2700], i: [300, 2300, 3000], o: [500, 900, 2700], u: [320, 850, 2200] };
const SCALE = [0, 2, 4, 7, 9];                       // major pentatonic: any two letters sound friendly together

/**
 * How much energy a sawtooth at f0 sends through the three vowel filters (sum of harmonic power, harmonic k has amplitude 1/k).
 * Narrow filters only pass a note if a harmonic lands inside them, so without this some vowel and pitch pairs are 10 dB louder
 * than others. tone() divides by the square root so all vowels come out about equally loud.
 */
export function formantPower(f0, vowel, shift, Q, gains) {
  const F = FORMANTS[vowel];
  let p = 0;
  for (let k = 1; k * f0 < 6000; k++) {
    for (let j = 0; j < 3; j++) {
      const x = (k * f0) / (F[j] * shift);
      const h = (x / Q) / Math.sqrt((1 - x * x) * (1 - x * x) + (x / Q) * (x / Q));      // band-pass magnitude (peak gain 1)
      p += (gains[j] * h / k) * (gains[j] * h / k);
    }
  }
  return p;
}

const NEUTRAL = {
  semis: 0, speed: 1, vowelDur: 1, consDur: 1, gap: 1, glideV: 1, glideC: 1, wobble: 0, wobbleHz: 5, jitter: 1, bounce: 0,
  lowpass: 1, ring: 1, crush: 0, vowelWave: null, consWave: null, fade: 1, endLift: 0, volume: 1, pause: 1, hesitate: 0,
  sparkle: 0, formantShift: 1, formantMul: 1, tremolo: 0, flat: 0, rise: 0, drive: 0, level: 1,
  breath: 0.22, buzz: 0, growl: 0, tremHz: 11,                // pet voice only: airiness, a harsher source, a growl, and how fast the tremble is
};

/** What each mood does, as changes from NEUTRAL. Numbers blend with the neutral value by `intensity`. */
export const MOOD_TABLE = {
  neutral: {},
  happy:   { semis: 4, speed: 1.2, glideV: 1.6, bounce: 3, gap: 0.8, lowpass: 1.15, wobble: 14, wobbleHz: 7, sparkle: 0.12 , breath: 0.18},
  excited: { semis: 9, speed: 1.6, glideV: 1.8, bounce: 3, gap: 0.5, sparkle: 0.35, jitter: 1.4, lowpass: 1.3, vowelDur: 0.8 , breath: 0.14},
  sad:     { semis: -4, speed: 0.7, glideV: -1.2, glideC: 1.2, vowelDur: 1.5, wobble: 25, wobbleHz: 4.5, lowpass: 0.65, fade: 0.7, pause: 1.4, jitter: 0.6 , breath: 0.34},
  sulky:   { semis: -5.5, speed: 1, vowelDur: 0.5, consDur: 0.6, gap: 2.2, glideV: 0.1, glideC: 0.2, flat: 0.85, lowpass: 0.55, jitter: 0.3, volume: 0.9, pause: 1.2 , breath: 0.1},
  angry:   { semis: -1, speed: 1.4, vowelWave: 'square', consWave: 'square', glideV: 0.4, glideC: 1.4, crush: 0.6, ring: 3.4, lowpass: 1.5, jitter: 0.8, vowelDur: 0.75, gap: 0.6, volume: 1.1, formantMul: 0.3, drive: 1, level: 1.65, breath: 0.07, buzz: 1, growl: 0.55, tremHz: 70},
  sleepy:  { semis: -5, speed: 0.55, vowelDur: 1.6, consDur: 1.3, glideV: -0.6, wobble: 18, wobbleHz: 2.8, fade: 0.12, lowpass: 0.55, pause: 1.6, gap: 1.5, volume: 0.85 , breath: 0.55},
  scared:  { semis: 6, speed: 1.4, wobble: 60, wobbleHz: 12, tremolo: 0.6, jitter: 3, glideV: 1.2, lowpass: 1.1, formantShift: 1.12, bounce: 1, volume: 0.85 , breath: 0.38, tremHz: 12},
  shy:     { semis: 5.5, speed: 0.85, vowelDur: 0.8, consDur: 0.8, glideV: 1.8, hesitate: 0.4, volume: 0.55, lowpass: 1.2, endLift: 3, wobble: 14, wobbleHz: 8, formantShift: 1.18 , breath: 0.5},
  smug:    { semis: -2.5, speed: 0.82, vowelDur: 1.25, glideV: 0.5, glideC: 0.5, wobble: 10, wobbleHz: 3.2, gap: 0.8, lowpass: 0.8, endLift: -3, flat: 0.35, jitter: 0.5, pause: 1.2 , breath: 0.14},
  curious: { semis: 2.5, speed: 1.1, vowelDur: 1.15, glideV: 2.2, rise: 1, endLift: 4, bounce: 1, lowpass: 1.1 , breath: 0.2},
};
export const MOOD_NAMES = Object.keys(MOOD_TABLE);

/** The mood's settings blended with neutral by intensity (0..100). */
export function moodParams(mood, intensity = 70) {
  const m = MOOD_TABLE[mood] || {};
  const k = clamp(intensity, 0, 100) / 100;
  const out = { ...NEUTRAL };
  for (const key of Object.keys(NEUTRAL)) {
    if (m[key] === undefined) continue;
    if (typeof NEUTRAL[key] === 'number') out[key] = lerp(NEUTRAL[key], m[key], k);
    else out[key] = k >= 0.4 ? m[key] : NEUTRAL[key];
  }
  return out;
}

/** Split text into sentences at . ! ? (no regex lookbehind: iPhones before iOS 16.4 can't parse it). */
export function splitSentences(text) {
  return (String(text).match(/[^.!?]+(?:[.!?]+|$)\s*/g) || []).map((s) => s.trim()).filter(Boolean);
}

/** Semitones above the reference for a letter a..z: a gentle pentatonic climb. */
export function letterSemis(ch, cfg = VOICE_CONFIG) {
  const idx = ch.charCodeAt(0) - 97;
  const d = Math.floor(idx * cfg.letterSpread);
  return SCALE[d % 5] + 12 * Math.floor(d / 5) + cfg.lowSemis;
}

/**
 * Make a voice. `ctx` may be a live AudioContext (default; created by unlock()) or an OfflineAudioContext (tests).
 * Returns { unlock, robotSpeak, speakQueue, stop, backchannel, effects, config, ... }.
 */
export function createRobotVoice({ ctx: given = null, offline = false } = {}) {
  const config = JSON.parse(JSON.stringify(VOICE_CONFIG));
  let ctx = given;
  let chain = null;                   // the shared effects chain: { bus, master, ... }
  const active = new Set();           // every oscillator currently scheduled, so stop() can silence them
  let timers = [];
  let speaking = null;                // { id, onEnd }
  let group = null;                   // { gain, nodes }: everything the current speech created
  let queueCancel = null;             // cancels a running speakQueue
  let nextId = 0;

  // ---------------------------------------------------------------- audio graph
  function crushCurve(bits) {
    const n = 2048, levels = Math.pow(2, bits) / 2, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * levels) / levels; }
    return c;
  }

  /** Hard saturation for the "drive" stage (angry): tanh squeezes the waves toward squares and adds high harmonics. */
  function driveCurve() {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 5);
    return c;
  }
  /** Transparent up to 0.6, then rounds off toward 1.0: catches rare loud peaks without pumping like a compressor. */
  function softClipCurve() {
    const n = 2049, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
      c[i] = a < 0.6 ? x : Math.sign(x) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
    }
    return c;
  }

  function build() {
    if (chain) return chain;
    const bus = ctx.createGain();                         // every chirp lands here (peaks stay inside -1..1 so the shapers see them whole)
    const crushIn = ctx.createGain(); crushIn.gain.value = 1;
    const crush = ctx.createWaveShaper();                 // bit-crusher: quantises the amplitude
    const crushDry = ctx.createGain();
    const crushWet = ctx.createGain();
    const crushSum = ctx.createGain();
    bus.connect(crushIn);
    crushIn.connect(crushDry); crushIn.connect(crush); crush.connect(crushWet);
    crushDry.connect(crushSum); crushWet.connect(crushSum);

    const drive = ctx.createWaveShaper(); drive.curve = driveCurve();     // drive: blended in by moods like angry
    const driveDry = ctx.createGain();
    const driveWet = ctx.createGain();
    const driveSum = ctx.createGain();
    crushSum.connect(driveDry); crushSum.connect(drive); drive.connect(driveWet);
    driveDry.connect(driveSum); driveWet.connect(driveSum);

    const ringDry = ctx.createGain();                     // ring modulator, blended with the dry signal ("light")
    const ringWet = ctx.createGain();
    const ringMul = ctx.createGain(); ringMul.gain.value = 0;
    const carrier = ctx.createOscillator(); carrier.type = 'sine';
    carrier.connect(ringMul.gain);
    driveSum.connect(ringDry); driveSum.connect(ringMul); ringMul.connect(ringWet);
    const ringSum = ctx.createGain();
    ringDry.connect(ringSum); ringWet.connect(ringSum);

    const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.Q.value = 0.6;
    const lowpass2 = ctx.createBiquadFilter(); lowpass2.type = 'lowpass'; lowpass2.Q.value = 0.6;     // two stages: a steeper roll-off, so hushes (s, sh) stay soft
    ringSum.connect(lowpass); lowpass.connect(lowpass2);

    const delay = ctx.createDelay(0.5);                   // a small box around the speaker
    const fb = ctx.createGain();
    const wetTone = ctx.createBiquadFilter(); wetTone.type = 'lowpass'; wetTone.frequency.value = 2600;
    const delayWet = ctx.createGain();
    const dry = ctx.createGain();
    lowpass2.connect(dry);
    lowpass2.connect(delay); delay.connect(wetTone); wetTone.connect(fb); fb.connect(delay); wetTone.connect(delayWet);

    const master = ctx.createGain();                      // volume x loudness
    const limiter = ctx.createWaveShaper(); limiter.curve = softClipCurve();
    dry.connect(master); delayWet.connect(master); master.connect(limiter); limiter.connect(ctx.destination);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 1024; limiter.connect(analyser);     // only for the level meter
    carrier.start();
    chain = { bus, crush, crushDry, crushWet, crushIn, driveDry, driveWet, ringDry, ringWet, carrier, lowpass, lowpass2, analyser, delay, fb, delayWet, dry, master };
    return chain;
  }

  /** Push the config + mood settings into the shared chain. */
  function applyChain(mp, volume) {
    const c = build();
    const now = ctx.currentTime;
    const crush = clamp(config.bitcrush.amount + mp.crush, 0, 1);
    const bits = lerp(config.bitcrush.bitsMax, config.bitcrush.bitsMin, crush);
    c.crush.curve = crushCurve(bits);
    c.crushDry.gain.setValueAtTime(1 - crush * 0.85, now);
    c.crushWet.gain.setValueAtTime(crush * 0.85, now);
    c.driveWet.gain.setValueAtTime(mp.drive * 0.8, now);
    c.driveDry.gain.setValueAtTime(1 - mp.drive * 0.8, now);
    const ring = clamp(config.ringMod.amount * mp.ring, 0, 1);
    c.carrier.frequency.setValueAtTime(config.ringMod.freq, now);
    c.ringDry.gain.setValueAtTime(1 - ring * 0.6, now);
    c.ringWet.gain.setValueAtTime(ring * 0.8, now);
    const lp = clamp(config.lowpass * mp.lowpass, 600, 9000);
    c.lowpass.frequency.setValueAtTime(lp, now); c.lowpass2.frequency.setValueAtTime(lp, now);
    c.delay.delayTime.setValueAtTime(config.space.time, now);
    c.fb.gain.setValueAtTime(config.space.feedback, now);
    c.delayWet.gain.setValueAtTime(config.space.mix, now);
    c.dry.gain.setValueAtTime(1, now);
    c.master.gain.cancelScheduledValues(now);
    c.master.gain.setValueAtTime(volume * config.loudness * mp.level, now);
  }

  // ---------------------------------------------------------------- one sound
  let noiseBuf = null;
  const noise = () => {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = new Float32Array(ctx.sampleRate);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (noiseBuf.copyToChannel) noiseBuf.copyToChannel(d, 0);              // not getChannelData: Brave hands out copies of that, so the noise would stay silent
    else noiseBuf.getChannelData(0).set(d);
    return noiseBuf;
  };

  /** Remember a running oscillator, optionally as part of one speech's group so stop() can silence just that speech. */
  function track(node, group) {
    active.add(node);
    if (group) group.nodes.add(node);
    node.onended = () => { active.delete(node); if (group) group.nodes.delete(node); };
  }

  /**
   * One enveloped tone on the bus. opts: freq, freq2 (glide target), dur, wave, gain, attack, decay, vowel (adds the formant layer),
   * formantShift, lfo { node } (shared wobble), bp [freq, q] (a band-pass), delayStart.
   */
  function tone(t, o) {
    const dur = Math.max(0.02, o.dur);
    const attack = o.attack ?? 0.006, decay = o.decay ?? 0.06;
    const f0 = Math.max(30, o.freq), f1 = Math.max(30, o.freq2 ?? o.freq);
    const env = ctx.createGain();
    const peak = o.gain ?? 0.8;                           // fast attack, a short body that droops a little, then a quick release
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.exponentialRampToValueAtTime(peak * (o.sustain ?? 0.4), t + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + decay);
    let out = env;
    if (o.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.bp[0]; f.Q.value = o.bp[1]; env.connect(f); out = f; }
    out.connect(o.group ? o.group.gain : chain.bus);

    const osc = ctx.createOscillator();
    osc.type = o.wave || 'triangle';
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const main = ctx.createGain();
    const formantAmount = o.vowel ? clamp(config.formant.amount * (o.formantMul ?? 1), 0, 1) : 0;
    main.gain.value = 1 - 0.7 * formantAmount;           // the more formant, the less of the plain tone
    osc.connect(main); main.connect(env);
    if (o.lfo) o.lfo.connect(osc.detune);
    osc.start(t); osc.stop(t + dur + decay + 0.03); track(osc, o.group);

    if (formantAmount > 0.01 && FORMANTS[o.vowel]) {
      const div = config.formant.maxSource > 0 ? Math.pow(2, Math.max(0, Math.ceil(Math.log2(Math.max(f0, f1) / config.formant.maxSource)))) : 1;
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(f0 / div, t);
      if (f1 !== f0) saw.frequency.exponentialRampToValueAtTime(f1 / div, t + dur);
      const sum = ctx.createGain();
      const norm = clamp(Math.sqrt(config.formant.refPower / formantPower(Math.sqrt(f0 * f1), o.vowel, o.formantShift || 1, config.formant.Q, config.formant.gains)), 0.35, 3);
      sum.gain.value = formantAmount * config.formant.makeup * norm;
      FORMANTS[o.vowel].forEach((hz, k) => {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = hz * (o.formantShift || 1); bp.Q.value = config.formant.Q;
        const g = ctx.createGain(); g.gain.value = config.formant.gains[k];
        saw.connect(bp); bp.connect(g); g.connect(sum);
      });
      sum.connect(env);
      if (o.lfo) o.lfo.connect(saw.detune);
      saw.start(t); saw.stop(t + dur + decay + 0.03); track(saw, o.group);
    }
    return t + dur + decay;
  }

  /** A burst of filtered noise (breath, gasp, sigh...). */
  function breath(t, { dur, from = 3000, to = 800, q = 0.9, gain = 0.5, attack = 0.04 }) {
    const src = ctx.createBufferSource(); src.buffer = noise(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(gain, t + attack); env.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(env); env.connect(chain.bus);
    src.start(t); src.stop(t + dur + 0.03); track(src);
    return t + dur;
  }

  /** Switch between the pet voice and the chirps; also sets the shared effects to that style's defaults. */
  function setStyle(name) {
    config.style = name === 'chirp' ? 'chirp' : 'voice';
    const d = STYLE_DEFAULTS[config.style];
    config.ringMod.amount = d.ring; config.ringMod.freq = d.ringHz; config.bitcrush.amount = d.crush; config.loudness = d.loudness; config.space.mix = d.echo;
  }
  setStyle(config.style);

  // ---------------------------------------------------------------- the pet voice: a continuous voice through moving vowel filters
  let waves = null, wavesKey = '';
  function getWaves() {
    const key = String(config.voice.softness);
    if (waves && wavesKey === key) return waves;
    const mk = (p) => { const n = 48, re = new Float32Array(n + 1), im = new Float32Array(n + 1); for (let k = 1; k <= n; k++) im[k] = (k % 2 ? 1 : 0.6) / Math.pow(k, p); return ctx.createPeriodicWave(re, im); };
    waves = { soft: mk(config.voice.softness), buzz: mk(0.85) }; wavesKey = key;
    return waves;
  }
  const mapPts = (pts, fn) => pts.map(([t, v]) => [t, fn(v)]);
  /** Play a control curve on an AudioParam: [time, value] points joined by straight or exponential ramps. */
  function schedule(param, pts, t0, exp = false) {
    const f = (v) => (exp ? Math.max(1e-3, v) : v);
    param.setValueAtTime(f(pts[0][1]), t0 + pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      if (exp) param.exponentialRampToValueAtTime(f(pts[i][1]), t0 + pts[i][0]); else param.linearRampToValueAtTime(pts[i][1], t0 + pts[i][0]);
    }
  }

  /**
   * Build the voice for one score (from planVoice or scoreFromNotes) and schedule all of it.
   *   source ---> three vowel filters (formants, moving) ---> mix        the "mouth"
   *   source ---> softened plain copy ---------------------> mix        warmth, and the whole voice when "formant" is 0
   *   noise  ---> vowel filters (breath) / its own hush filter -> mix   air, puffs and hushes
   * mix passes through an optional tremble / growl, then into the shared effects chain.
   */
  function renderVoice(score, t0, { group: g = null, mp }) {
    const V = config.voice;
    const colour = clamp(config.formant.amount / 0.7, 0, 1);           // how much of the voice goes through the vowel filters
    const W = getWaves();
    const end = t0 + score.end + 0.15;
    const out = ctx.createGain(); out.connect(g ? g.gain : chain.bus);
    const mix = ctx.createGain(); mix.connect(out);
    const depth = clamp(Math.max(mp.growl || 0, (mp.tremolo || 0) * 0.5), 0, 0.8);
    mix.gain.value = 1 - depth / 2;
    const run = (node) => { node.start(t0); node.stop(end); track(node, g); return node; };
    if (depth > 0.02) { const am = ctx.createOscillator(); am.frequency.value = mp.tremHz || 11; const ag = ctx.createGain(); ag.gain.value = depth / 2; am.connect(ag); ag.connect(mix.gain); run(am); }

    const osc = ctx.createOscillator(); osc.setPeriodicWave(mp.buzz > 0.5 ? W.buzz : W.soft);
    const merge = ctx.createGain(); osc.connect(merge);
    let osc2 = null;
    if (mp.sparkle > 0.01) { osc2 = ctx.createOscillator(); const sg = ctx.createGain(); sg.gain.value = mp.sparkle * 0.4; osc2.connect(sg); sg.connect(merge); }
    const vib = ctx.createOscillator(); vib.frequency.value = mp.wobble > 0.5 ? mp.wobbleHz : V.vibratoHz;
    const vg = ctx.createGain(); vg.gain.value = V.vibrato + mp.wobble;
    vib.connect(vg); vg.connect(osc.detune); if (osc2) vg.connect(osc2.detune);
    const voiceG = ctx.createGain(); voiceG.gain.value = 0; merge.connect(voiceG);

    const nz = ctx.createBufferSource(); nz.buffer = noise(); nz.loop = true;
    const aspG = ctx.createGain(); aspG.gain.value = 0; nz.connect(aspG);
    const fricBP = ctx.createBiquadFilter(); fricBP.type = 'bandpass'; fricBP.Q.value = 1.1;
    const fricG = ctx.createGain(); fricG.gain.value = 0; nz.connect(fricBP); fricBP.connect(fricG);

    const bankIn = ctx.createGain(); voiceG.connect(bankIn); aspG.connect(bankIn);
    const formG = ctx.createGain(); formG.gain.value = 0;
    const bps = [0, 1, 2].map((j) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = V.Q;
      const gj = ctx.createGain(); gj.gain.value = V.gains[j];
      bankIn.connect(bp); bp.connect(gj); gj.connect(formG);
      return bp;
    });
    const bodyLP = ctx.createBiquadFilter(); bodyLP.type = 'lowpass'; bodyLP.frequency.value = V.bodyHz; voiceG.connect(bodyLP);
    const bodyG = ctx.createGain(); bodyG.gain.value = 1; bodyLP.connect(bodyG);
    formG.connect(mix); bodyG.connect(mix); fricG.connect(mix);

    schedule(osc.frequency, score.f0.p, t0, true);
    if (osc2) schedule(osc2.frequency, mapPts(score.f0.p, (v) => v * 2), t0, true);
    for (let j = 0; j < 3; j++) schedule(bps[j].frequency, score['F' + (j + 1)].p, t0, true);
    schedule(voiceG.gain, score.voice.p, t0);
    schedule(aspG.gain, mapPts(score.asp.p, (v) => v * V.aspMakeup), t0);
    schedule(fricG.gain, mapPts(score.fric.p, (v) => v * V.fricMakeup), t0);
    schedule(fricBP.frequency, score.fricHz.p, t0, true);
    schedule(formG.gain, mapPts(score.nasal.p, (n) => colour * V.formMakeup * (1 - 0.65 * n)), t0);     // a hum is mostly the plain, soft voice
    schedule(bodyG.gain, mapPts(score.nasal.p, (n) => (1 - 0.7 * colour) + 0.9 * n), t0);
    run(osc); if (osc2) run(osc2); run(vib); run(nz);
  }

  // ---------------------------------------------------------------- planning a sentence
  /** Turn text into timed chirps. Pure: it only reads config and returns a list, so it can be inspected and tested. */
  function plan(text, mp, speedMul) {
    const events = [];
    const words = [];
    const speed = Math.max(0.2, config.speed * mp.speed * speedMul);
    const tokens = String(text).match(/\S+/g) || [];
    const total = tokens.join('').replace(/[^a-z]/gi, '').length || 1;
    let t = 0.03, li = 0;
    let last = config.pitch;
    tokens.forEach((tok, wi) => {
      words.push({ word: tok, t });
      const core = tok.toLowerCase().replace(/[^a-z]/g, '');
      const tail = (tok.match(/[.,;:!?…]+$/) || [''])[0];
      if (wi > 0 && Math.random() < mp.hesitate) {                     // shy / scared: a little stumble before some words
        t += 0.13 / speed;
        events.push({ kind: 'tone', t, freq: config.pitch * semi(mp.semis + 9), dur: 0.05 / speed, wave: 'triangle', gain: 0.35 });
        t += 0.06 / speed;
      }
      for (const ch of core) {
        const vowel = 'aeiou'.includes(ch);
        const base = vowel ? config.vowel : config.consonant;
        let s = letterSemis(ch, config);
        s = lerp(s, config.lowSemis + 8, mp.flat) + mp.semis + mp.bounce * (li % 2 ? 1 : -1);
        const nudge = (config.jitter + rand(-config.jitterSpread, config.jitterSpread)) * mp.jitter * (Math.random() < 0.5 ? -1 : 1);
        const freq = config.pitch * semi(s) * (1 + nudge);
        const dur = (base.dur * (vowel ? mp.vowelDur : mp.consDur)) / speed;
        const glide = base.glide * (vowel ? mp.glideV : mp.glideC);
        const fade = lerp(1, mp.fade, Math.pow(li / total, 1.1));
        const shake = mp.tremolo ? 1 - Math.random() * mp.tremolo : 1;
        events.push({
          kind: 'tone', t, freq, freq2: freq * (1 + glide), dur, attack: base.attack, decay: base.decay,
          wave: (vowel ? mp.vowelWave : mp.consWave) || base.wave, gain: base.gain * fade * shake * mp.volume,
          vowel: vowel ? ch : null, formantShift: mp.formantShift, formantMul: mp.formantMul,
        });
        if (mp.sparkle && li % 3 === 0) events.push({ kind: 'tone', t: t + 0.01, freq: freq * 2, dur: dur * 0.8, wave: 'sine', gain: mp.sparkle * 0.5, attack: 0.003, decay: 0.05 });
        last = freq;
        t += dur * 0.92 + (config.gap * mp.gap) / speed;
        li++;
      }
      // punctuation
      const isLast = wi === tokens.length - 1;
      const q = tail.includes('?'), ex = tail.includes('!'), stop = /[.…]/.test(tail), comma = /[,;:]/.test(tail);
      const rising = q || (mp.rise > 0.5 && (isLast || comma));        // a curious voice lifts at the end of every phrase, not only at "?"
      if (rising) {                                                      // a rising "hm?" lift
        events.push({ kind: 'tone', t, freq: last, freq2: last * (1.7 + mp.endLift * 0.05), dur: 0.2 / speed, wave: 'triangle', gain: 0.8 * mp.volume * mp.fade, vowel: 'e', formantShift: mp.formantShift, formantMul: mp.formantMul, decay: 0.08 });
        t += 0.24 / speed;
      } else if (ex) {                                                   // a louder, higher chirp
        events.push({ kind: 'tone', t, freq: last * semi(4), freq2: last * semi(7), dur: 0.12 / speed, wave: 'triangle', gain: 1.15 * mp.volume * mp.fade, vowel: 'i', formantShift: mp.formantShift, formantMul: mp.formantMul });
        t += 0.17 / speed;
      } else if ((stop || isLast) && mp.endLift) {                       // sad / smug sentences droop at the end, shy ones squeak up
        events.push({ kind: 'tone', t, freq: last, freq2: last * semi(mp.endLift * 1.5), dur: 0.16 / speed, wave: 'triangle', gain: 0.6 * mp.volume * mp.fade });
        t += 0.2 / speed;
      } else if (!isLast && mp.rise > 0.5 && Math.random() < 0.25 * mp.rise) {   // and sometimes a little mid-sentence "hm?"
        events.push({ kind: 'tone', t, freq: last, freq2: last * 1.35, dur: 0.1 / speed, wave: 'triangle', gain: 0.5 * mp.volume * mp.fade });
        t += 0.14 / speed;
      }
      t += (comma ? config.pauseComma : stop ? config.pausePeriod : q || ex ? config.pauseComma : config.pauseSpace) * mp.pause / speed;
    });
    return { events, words, duration: t + 0.12 };
  }

  // ---------------------------------------------------------------- speaking
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /**
   * Stop the current speech right now, with a short fade so it doesn't click. Only that speech's own sounds are faded and
   * stopped, so a new sentence started in the same breath is untouched. (keepQueue is for speakQueue's own hand-over.)
   */
  function stop(keepQueue = false) {
    clearTimers();
    if (!keepQueue && queueCancel) { const c = queueCancel; queueCancel = null; c(); }
    const was = speaking;
    speaking = null;
    const g = group;
    group = null;
    if (g && ctx) {
      const now = ctx.currentTime;
      g.gain.gain.cancelScheduledValues(now);
      g.gain.gain.setTargetAtTime(0, now, 0.012);
      const kill = () => { for (const n of g.nodes) { try { n.stop(); } catch { /* already stopped */ } } g.nodes.clear(); };
      if (offline) kill(); else setTimeout(kill, 90);
    }
    if (was && was.onEnd) was.onEnd(true);
  }

  /**
   * Say `text`. Returns the duration in milliseconds. opts: mood, intensity, pitch, speed, volume, onWord(word, index), onStart(), onEnd().
   * Calling it again stops the previous speech first.
   */
  function robotSpeak(text, opts = {}) {
    if (!ctx) return 0;
    stop(!!opts._queued);
    const mood = opts.mood || 'neutral';
    const intensity = opts.intensity ?? 70;
    const mp = moodParams(mood, intensity);
    const saved = { pitch: config.pitch, speed: config.speed };
    if (opts.pitch) config.pitch = opts.pitch;
    if (opts.speed) config.speed = opts.speed;
    applyChain(mp, opts.volume ?? config.volume);
    const pet = config.style !== 'chirp';
    const p = pet ? planVoice(text, mp, config) : plan(text, mp, 1);
    config.pitch = saved.pitch; config.speed = saved.speed;

    const sb = ctx.createGain();                                          // this speech's own volume knob, so stop() can fade just it
    sb.connect(chain.bus);
    const g = group = { gain: sb, nodes: new Set() };
    const t0 = ctx.currentTime + 0.06;
    if (pet) renderVoice(p.score, t0, { group: g, mp });
    else {
      let lfo = null;
      if (mp.wobble > 0.5) {                                              // one shared wobble for every chirp in the sentence
        const osc = ctx.createOscillator(); osc.frequency.value = mp.wobbleHz;
        const depth = ctx.createGain(); depth.gain.value = mp.wobble;   // cents
        osc.connect(depth); lfo = depth;
        osc.start(t0); osc.stop(t0 + p.duration + 0.3); track(osc, g);
      }
      for (const e of p.events) tone(t0 + e.t, { ...e, lfo, group: g });
    }
    const ms = Math.round(p.duration * 1000);
    const id = ++nextId;
    speaking = { id, onEnd: opts.onEnd };
    if (!offline) {
      timers.push(setTimeout(() => opts.onStart && opts.onStart(), 60));
      p.words.forEach((w, i) => timers.push(setTimeout(() => opts.onWord && opts.onWord(w.word, i), 60 + w.t * 1000)));
      timers.push(setTimeout(() => { if (speaking && speaking.id === id) { speaking = null; opts.onEnd && opts.onEnd(false); } }, 60 + ms));
    }
    return ms;
  }

  /** A tiny pip between sentences: two soft little "ee" notes in the pet voice, or two beeps in the chirp style. Returns seconds used. */
  function blip(t, volumeMul = 1) {
    if (config.style !== 'chirp') {
      const L = config.voice.voiceLevel * 0.55 * volumeMul, P0 = config.pitch;
      renderVoice(scoreFromNotes([
        { t: 0, dur: 0.055, hz: [P0 * 1.9, P0 * 2.05], v: 'i', level: L, asp: 0.1 },
        { t: 0.085, dur: 0.07, hz: [P0 * 2.3, P0 * 2.7], v: 'i', level: L, asp: 0.1 },
      ], config, config.voice.size), t, { mp: moodParams('neutral') });
      return 0.2;
    }
    let at = t;
    for (const f of config.blip.freqs) { tone(at, { freq: f * rand(0.97, 1.03), dur: config.blip.dur, wave: 'square', gain: 0.28 * volumeMul, attack: 0.003, decay: 0.03 }); at += config.blip.gap * 0.5; }
    return at - t + 0.05;
  }

  /**
   * Play sentences one after another with two little beeps between them. `sentences` is an array or one string (split at . ! ?).
   * Returns { ms (an estimate of the total), done (a promise that resolves when it ends or is stopped), cancel() }.
   */
  function speakQueue(sentences, opts = {}) {
    stop();
    const list = (Array.isArray(sentences) ? sentences : splitSentences(sentences)).filter(Boolean);
    const mp = moodParams(opts.mood || 'neutral', opts.intensity ?? 70);
    const pet = config.style !== 'chirp';
    const blipMs = pet ? 240 : (config.blip.freqs.length * config.blip.gap * 0.5 + 0.05) * 1000 + 40;
    const ms = list.reduce((sum, s) => sum + (pet ? planVoice(s, mp, config) : plan(s, mp, 1)).duration * 1000, 0) + Math.max(0, list.length - 1) * blipMs;
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let cancelled = false;
    const cancel = () => { if (cancelled) return; cancelled = true; if (queueCancel === cancel) queueCancel = null; resolveDone(); };
    const runOne = (i) => {
      if (cancelled || i >= list.length) { cancel(); return; }
      robotSpeak(list[i], {
        ...opts,
        _queued: true,
        onStart: i === 0 ? opts.onStart : undefined,
        onWord: (w, k) => opts.onWord && opts.onWord(w, k, i),
        onEnd: (interrupted) => {
          if (interrupted) { cancel(); return; }
          if (i === list.length - 1) { opts.onEnd && opts.onEnd(false); cancel(); return; }
          const gap = blip(ctx.currentTime + 0.02) * 1000;
          timers.push(setTimeout(() => runOne(i + 1), gap + 40));
        },
      });
    };
    queueCancel = cancel;
    runOne(0);
    return { ms: Math.round(ms), done, cancel: () => { stop(); } };
  }

  // ---------------------------------------------------------------- sound effects (each returns its length in ms)
  const fx = (fn) => (...args) => {
    if (!ctx) return 0;
    applyChain(moodParams('neutral'), config.volume);
    const t = ctx.currentTime + 0.04;
    const end = fn(t, ...args);
    return Math.round((end - t) * 1000);
  };
  const P = () => config.pitch;

  const chirpFx = {
    happyChirp: fx((t) => { let e = t; [0, 4, 7, 12].forEach((s, i) => { e = tone(t + i * 0.085, { freq: P() * semi(s + 3), freq2: P() * semi(s + 6), dur: 0.08, gain: 0.9 }); }); return e; }),
    sadWhimper: fx((t) => { tone(t, { freq: P() * semi(2), freq2: P() * semi(-5), dur: 0.5, gain: 0.8, decay: 0.2 }); return tone(t + 0.55, { freq: P() * semi(0), freq2: P() * semi(-8), dur: 0.55, gain: 0.7, decay: 0.3 }); }),
    surprised: fx((t) => { tone(t, { freq: P() * 0.8, freq2: P() * 3.2, dur: 0.14, gain: 1, wave: 'triangle' }); return tone(t + 0.16, { freq: P() * 2.6, dur: 0.12, wave: 'square', gain: 0.4 }); }),
    giggle: fx((t) => { let e = t; for (let i = 0; i < 7; i++) e = tone(t + i * 0.065, { freq: P() * semi(i % 2 ? 9 : 5) * rand(0.97, 1.04), dur: 0.045, gain: 0.7, attack: 0.004, decay: 0.03 }); return e; }),
    gasp: fx((t) => breath(t, { dur: 0.3, from: 1200, to: 3800, gain: 1.4, attack: 0.1 })),
    sigh: fx((t) => { breath(t, { dur: 0.9, from: 2600, to: 500, gain: 0.9, attack: 0.18 }); return tone(t + 0.1, { freq: P() * semi(-2), freq2: P() * semi(-9), dur: 0.8, gain: 0.35, decay: 0.2 }); }),
    yawn: fx((t) => { tone(t, { freq: P() * semi(-6), freq2: P() * semi(2), dur: 0.7, gain: 0.55, decay: 0.05 }); tone(t + 0.7, { freq: P() * semi(2), freq2: P() * semi(-10), dur: 0.9, gain: 0.55, decay: 0.2 }); return breath(t + 0.1, { dur: 1.5, from: 2200, to: 700, gain: 0.6, attack: 0.4 }); }),
    growlBuzz: fx((t) => { let e = t; for (let i = 0; i < 6; i++) e = tone(t + i * 0.07, { freq: 78 + rand(-6, 6), freq2: 70, dur: 0.075, wave: 'sawtooth', gain: 1, attack: 0.004, decay: 0.01 }); breath(t, { dur: e - t, from: 600, to: 400, gain: 0.25, q: 2 }); return e; }),
    squeak: fx((t) => tone(t, { freq: P() * semi(14), freq2: P() * semi(24), dur: 0.16, wave: 'square', gain: 0.8, decay: 0.05 })),
    glitchBuzz: fx((t) => { let e = t; for (let i = 0; i < 9; i++) { e = tone(t + i * 0.05 + rand(0, 0.02), { freq: rand(120, 2600), freq2: rand(120, 2600), dur: rand(0.02, 0.05), wave: i % 2 ? 'square' : 'sawtooth', gain: 0.8, attack: 0.002, decay: 0.01 }); } breath(t, { dur: 0.5, from: 5000, to: 1500, gain: 0.4, q: 0.4 }); return e + 0.1; }),
    powerUp: fx((t) => { let e = t; for (let i = 0; i < 7; i++) e = tone(t + i * (0.09 - i * 0.006), { freq: P() * semi(i * 2 - 7), freq2: P() * semi(i * 2 - 4), dur: 0.08, gain: 0.8 }); return tone(e - 0.02, { freq: P() * 2, freq2: P() * 4.2, dur: 0.22, wave: 'square', gain: 0.4, decay: 0.1 }); }),
    whistle: fx((t) => { tone(t, { freq: 1500, freq2: 2300, dur: 0.22, wave: 'sine', gain: 0.55, decay: 0.05 }); return tone(t + 0.26, { freq: 2300, freq2: 1300, dur: 0.3, wave: 'sine', gain: 0.55, decay: 0.1 }); }),
    hum: fx((t) => { const lfo = (() => { const o = ctx.createOscillator(); o.frequency.value = 5.5; const d = ctx.createGain(); d.gain.value = 18; o.connect(d); o.start(t); o.stop(t + 2); track(o); return d; })(); let e = t; [0, 3, 2, 5, 3].forEach((s, i) => { e = tone(t + i * 0.3, { freq: P() * 0.5 * semi(s), dur: 0.28, wave: 'triangle', gain: 0.5, attack: 0.04, decay: 0.08, lfo }); }); return e; }),
    hmm: fx((t) => { tone(t, { freq: P() * 0.55, freq2: P() * 0.7, dur: 0.18, wave: 'sawtooth', gain: 2, bp: [600, 3], attack: 0.03 }); return tone(t + 0.2, { freq: P() * 0.7, freq2: P() * 1.15, dur: 0.22, wave: 'sawtooth', gain: 2, bp: [700, 3], attack: 0.03, decay: 0.1 }); }),
    // one vowel held at a steady pitch, so you hear only the formant colour (used by the vowel test)
    vowel: fx((t, v = 'a', hz = 330) => tone(t, { freq: hz, dur: 0.5, wave: 'triangle', gain: 0.9, vowel: v, attack: 0.02, decay: 0.08 })),
    ooh: fx((t) => { tone(t, { freq: P() * 0.9, freq2: P() * 1.8, dur: 0.22, vowel: 'o', gain: 0.45, decay: 0.1 }); return tone(t + 0.22, { freq: P() * 1.8, freq2: P() * 1.5, dur: 0.22, vowel: 'o', gain: 0.4, decay: 0.15 }); }),
  };

  // purr: a soft rumble that lasts as long as you are petting. purrStart() returns a handle; purr(ms) is the fixed-length version.
  let purrHandle = null;
  function purrStart() {
    if (!ctx || purrHandle) return purrHandle;
    applyChain(moodParams('neutral'), config.volume * 0.8);
    const t = ctx.currentTime + 0.02;
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 58;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 170; bp.Q.value = 1.2;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 23; const lfoG = ctx.createGain(); lfoG.gain.value = 0.45;
    lfo.connect(lfoG); lfoG.connect(am.gain);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.9, t + 0.25);
    saw.connect(bp); bp.connect(am); am.connect(env); env.connect(chain.bus);
    saw.start(t); lfo.start(t);
    purrHandle = {
      stop() {
        const now = ctx.currentTime;
        env.gain.cancelScheduledValues(now); env.gain.setTargetAtTime(0, now, 0.08);
        setTimeout(() => { try { saw.stop(); lfo.stop(); } catch { /* done */ } }, 400);
        purrHandle = null;
      },
    };
    return purrHandle;
  }
  chirpFx.purr = (ms = 1800) => { const h = purrStart(); if (h) setTimeout(() => h.stop(), ms); return ms; };

  // the same effects in the pet voice: made of vowels, breath and hums, so a giggle is "hi-hi-hi" and a whimper a falling "oo"
  const vfx = (build, mpo = null) => fx((t, ...args) => {
    const V = config.voice, mp = { ...moodParams('neutral'), ...(mpo || {}) };
    const sc = scoreFromNotes(build(config.pitch, V.voiceLevel, ...args), config, V.size);
    renderVoice(sc, t, { mp });
    return t + sc.end;
  });
  const voiceFx = {
    happyChirp: vfx((P0, L) => [0, 4, 7, 12].map((s, i) => ({ t: i * 0.1, dur: 0.1, hz: [P0 * semi(s + 2), P0 * semi(s + 5)], v: ['i', 'a'], level: L, asp: 0.12 }))),
    sadWhimper: vfx((P0, L) => [{ t: 0, dur: 0.55, hz: [P0 * semi(3), P0 * semi(-4)], v: ['o', 'u'], level: L, asp: 0.3 }, { t: 0.6, dur: 0.65, hz: [P0, P0 * semi(-9)], v: 'u', level: L * 0.8, asp: 0.35 }], { wobble: 30, wobbleHz: 5.5 }),
    surprised: vfx((P0, L) => [{ t: 0, dur: 0.17, hz: [P0 * 0.8, P0 * 2.3], v: ['o', 'a'], level: L, asp: 0.1 }, { t: 0.18, dur: 0.16, hz: [P0 * 2.2, P0 * 2], v: 'a', level: L * 0.9, asp: 0.1 }]),
    giggle: vfx((P0, L) => Array.from({ length: 6 }, (_, i) => ({ t: i * 0.075, dur: 0.06, hz: [P0 * semi(i % 2 ? 9 : 5), P0 * semi(i % 2 ? 10 : 6)], v: 'i', level: L * 0.8, asp: 0.7 }))),
    gasp: vfx((P0, L) => [{ t: 0, dur: 0.28, hz: [P0, P0], v: ['a', 'o'], voiceless: true, asp: 1.6 }]),
    sigh: vfx((P0, L) => [{ t: 0, dur: 0.95, hz: [P0 * semi(-1), P0 * semi(-9)], v: ['a', 'o'], level: L * 0.5, asp: 0.9 }]),
    yawn: vfx((P0, L) => [{ t: 0, dur: 0.7, hz: [P0 * semi(-6), P0 * semi(2)], v: ['u', 'a'], level: L * 0.6, asp: 0.6 }, { t: 0.72, dur: 0.9, hz: [P0 * semi(2), P0 * semi(-10)], v: ['a', 'o'], level: L * 0.6, asp: 0.7 }]),
    growlBuzz: vfx((P0, L) => [{ t: 0, dur: 0.5, hz: [96, 78], v: ['a', 'o'], level: L, asp: 0.1 }], { buzz: 1, growl: 0.6, tremHz: 45, wobble: 0 }),
    squeak: vfx((P0, L) => [{ t: 0, dur: 0.16, hz: [P0 * semi(14), P0 * semi(24)], v: 'i', level: L * 0.8, asp: 0.05 }]),
    glitchBuzz: (...a) => chirpFx.glitchBuzz(...a),
    powerUp: vfx((P0, L) => [...Array.from({ length: 6 }, (_, i) => ({ t: i * 0.085, dur: 0.09, hz: [P0 * semi(i * 2 - 7), P0 * semi(i * 2 - 4)], v: i % 2 ? 'a' : 'u', level: L, asp: 0.15 })), { t: 0.52, dur: 0.24, hz: [P0 * 1.6, P0 * 2.6], v: ['u', 'i'], level: L, asp: 0.15 }]),
    whistle: (...a) => chirpFx.whistle(...a),
    hum: vfx((P0, L) => [0, 3, 2, 5, 3].map((s, i) => ({ t: i * 0.3, dur: 0.28, hz: [P0 * 0.5 * semi(s), P0 * 0.5 * semi(s)], v: 'u', nasal: 1, level: L * 0.9, asp: 0.1 })), { wobble: 18, wobbleHz: 5.5 }),
    hmm: vfx((P0, L) => [{ t: 0, dur: 0.18, hz: [P0 * 0.55, P0 * 0.62], v: 'u', nasal: 1, level: L * 0.9, asp: 0.1 }, { t: 0.2, dur: 0.24, hz: [P0 * 0.65, P0 * 1.0], v: 'u', nasal: 1, level: L * 0.9, asp: 0.1 }]),
    // one vowel held at a steady pitch, so you hear only the vowel colour (used by the vowel test)
    vowel: vfx((P0, L, v = 'a', hz = 330) => [{ t: 0, dur: 0.5, hz: [hz, hz], v, level: L, asp: 0.15 }]),
    ooh: vfx((P0, L) => [{ t: 0, dur: 0.24, hz: [P0 * 0.9, P0 * 1.8], v: ['u', 'o'], level: L, asp: 0.2 }, { t: 0.25, dur: 0.26, hz: [P0 * 1.8, P0 * 1.5], v: 'o', level: L * 0.9, asp: 0.2 }]),
  };
  voiceFx.purr = (...a) => chirpFx.purr(...a);
  const effects = {};
  for (const name of Object.keys(chirpFx)) effects[name] = (...a) => ((config.style === 'chirp' || !voiceFx[name]) ? chirpFx : voiceFx)[name](...a);

  /** A tiny, quiet reaction that can happen while the user is still talking. type: 'mm' | 'ooh' | 'huh'. */
  function backchannel(type = 'mm') {
    if (!ctx) return 0;
    applyChain(moodParams('neutral'), config.volume * 0.4);
    const t = ctx.currentTime + 0.02;
    if (config.style !== 'chirp') {
      const V = config.voice, P0 = config.pitch, L = V.voiceLevel * 0.7;
      const notes = type === 'ooh' ? [{ t: 0, dur: 0.22, hz: [P0 * 0.85, P0 * 1.2], v: ['u', 'o'], level: L, asp: 0.15 }]
        : type === 'huh' ? [{ t: 0, dur: 0.06, hz: [P0, P0], v: 'a', voiceless: true, asp: 0.8 }, { t: 0.06, dur: 0.14, hz: [P0 * 0.9, P0 * 1.4], v: 'a', level: L, asp: 0.15 }]
        : [{ t: 0, dur: 0.2, hz: [P0 * 0.7, P0 * 0.75], v: 'u', nasal: 1, level: L, asp: 0.05 }];
      const sc = scoreFromNotes(notes, config, V.size);
      renderVoice(sc, t, { mp: moodParams('neutral') });
      return Math.round(sc.end * 1000);
    }
    if (type === 'ooh') return Math.round((tone(t, { freq: P() * 0.85, freq2: P() * 1.3, dur: 0.2, vowel: 'o', gain: 0.45, decay: 0.1 }) - t) * 1000);
    if (type === 'huh') { tone(t, { freq: P() * 0.9, dur: 0.05, gain: 0.7 }); return Math.round((tone(t + 0.07, { freq: P() * 0.9, freq2: P() * 1.5, dur: 0.12, gain: 0.7, decay: 0.08 }) - t) * 1000); }
    return Math.round((tone(t, { freq: P() * 0.38, freq2: P() * 0.46, dur: 0.17, wave: 'triangle', gain: 0.8, attack: 0.03, decay: 0.08 }) - t) * 1000);
  }

  /** Create or resume the audio context. Call it from a tap or click (iOS Safari only allows sound after a user gesture). */
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    build();
    try {                                                                 // a silent blip wakes iOS up
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch { /* fine */ }
    return true;
  }

  /** How loud the voice is right now at the output (before the speakers): { rms, peak } between 0 and 1. For a level meter and for checking that sound is really coming out. */
  let levelBuf = null;
  function level() {
    if (!chain) return { rms: 0, peak: 0 };
    const n = chain.analyser.fftSize;
    if (!levelBuf) levelBuf = new Float32Array(n);
    chain.analyser.getFloatTimeDomainData(levelBuf);
    let sum = 0, peak = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(levelBuf[i]); sum += a * a; if (a > peak) peak = a; }
    return { rms: Math.sqrt(sum / n), peak };
  }

  if (ctx) build();
  return {
    unlock, robotSpeak, speakQueue, stop, backchannel, effects, purrStart, setStyle, level,
    plan: (text, mood = 'neutral', intensity = 70) => (config.style === 'chirp' ? plan(text, moodParams(mood, intensity), 1) : { events: [], ...planVoice(text, moodParams(mood, intensity), config) }),
    config, get context() { return ctx; }, get speaking() { return !!speaking; },
  };
}
