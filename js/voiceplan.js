// voiceplan.js — turns text into a "score" for Quark's pet voice: curves for pitch, vowel shape and loudness over time.
//
// The pet voice is ONE continuous voiced sound, like a very small talking toy:
//   * a soft, slightly buzzy source whose pitch glides along an intonation contour (not one beep per letter),
//   * three vowel filters (formants) that move from sound to sound, so "hello" goes h-e-l-o with a mouth that opens and closes,
//   * puffs of air for p/t/k, hushes for s/sh/f, hums for m/n, all quiet and soft.
// Words come out as babble that follows the real letters, with a question rising and a sentence falling.
//
// This file is pure (no audio): it returns a score the synth in robotvoice.js plays, and it can be tested anywhere.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const semi = (n) => Math.pow(2, n / 12);

/** Vowel resonances in Hz (first, second, third formant). These are scaled up a little (`size`) for a small creature. */
export const VOWEL_F = { a: [780, 1250, 2800], e: [540, 1850, 2600], i: [300, 2300, 3000], o: [500, 900, 2700], u: [330, 850, 2200], '@': [500, 1400, 2500] };

// where the mouth is while a consonant is being made (formants glide to these, then on to the next vowel)
const LOCUS = {
  b: [250, 900, 2200], d: [300, 1700, 2600], g: [300, 1900, 2300], m: [250, 1000, 2100], n: [260, 1600, 2500], ng: [260, 1800, 2300],
  l: [380, 1250, 2800], r: [420, 1300, 1700], w: [300, 750, 2200], y: [280, 2200, 3000],
};
// hushes: noise around a centre frequency. dur in seconds, gain relative to a vowel.
const FRIC = {
  s: { hz: 2900, q: 1.4, gain: 0.55, dur: 0.085, voiced: 0 }, z: { hz: 2800, q: 1.4, gain: 0.4, dur: 0.07, voiced: 1 },
  sh: { hz: 2300, q: 1.0, gain: 0.6, dur: 0.09, voiced: 0 }, f: { hz: 2100, q: 0.6, gain: 0.35, dur: 0.065, voiced: 0 },
  v: { hz: 2000, q: 0.6, gain: 0.3, dur: 0.055, voiced: 1 }, th: { hz: 2600, q: 0.6, gain: 0.3, dur: 0.06, voiced: 0 },
};
const BURST_HZ = { b: 900, d: 3000, g: 1900 };

/** Letters of one word -> a list of sounds. Not real English phonetics: just enough that words sound different from each other. */
export function toPhonemes(word) {
  let s = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (/[^aeiouy]e$/.test(s) && /[aeiouy]/.test(s.slice(0, -1))) s = s.slice(0, -1);                      // "make": the final e is silent
  else if (/[^aeiouydt]ed$/.test(s) && /[aeiouy]/.test(s.slice(0, -2))) s = s.slice(0, -2) + 'd';         // "missed" -> "missd"
  const out = [];
  const vow = (c) => 'aeiou'.includes(c);
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1] || '', prev = s[i - 1] || '';
    if (c === prev && !vow(c)) continue;                                                                     // "ss", "ll": one sound
    if (c === 't' && n === 'h') { out.push({ k: 'F', f: 'th' }); i++; continue; }
    if (c === 's' && n === 'h') { out.push({ k: 'F', f: 'sh' }); i++; continue; }
    if (c === 'c' && n === 'h') { out.push({ k: 'P', place: 'd', voiced: 0 }, { k: 'F', f: 'sh' }); i++; continue; }
    if (c === 'p' && n === 'h') { out.push({ k: 'F', f: 'f' }); i++; continue; }
    if (c === 'n' && n === 'g') { out.push({ k: 'N', place: 'ng' }); i++; continue; }
    if (c === 'c' && n === 'k') { out.push({ k: 'P', place: 'g', voiced: 0 }); i++; continue; }
    if (c === 'q' && n === 'u') { out.push({ k: 'P', place: 'g', voiced: 0 }, { k: 'G', place: 'w' }); i++; continue; }
    if (c === 'w' && n === 'h') { out.push({ k: 'G', place: 'w' }); i++; continue; }
    if (vow(c)) { out.push({ k: 'V', v: c }); continue; }
    if (c === 'y') { out.push(i === 0 && vow(n) ? { k: 'G', place: 'y' } : { k: 'V', v: 'i' }); continue; }
    if ('ptkcq'.includes(c)) { out.push({ k: 'P', place: { p: 'b', t: 'd', k: 'g', c: 'g', q: 'g' }[c], voiced: 0 }); continue; }
    if ('bdg'.includes(c)) { out.push({ k: 'P', place: c, voiced: 1 }); continue; }
    if (c === 'j') { out.push({ k: 'P', place: 'd', voiced: 1 }, { k: 'F', f: 'sh' }); continue; }
    if (c === 'x') { out.push({ k: 'P', place: 'g', voiced: 0 }, { k: 'F', f: 's' }); continue; }
    if ('szfv'.includes(c)) { out.push({ k: 'F', f: c }); continue; }
    if (c === 'h') { out.push({ k: 'H' }); continue; }
    if (c === 'm' || c === 'n') { out.push({ k: 'N', place: c }); continue; }
    if (c === 'l' || c === 'r') { out.push({ k: 'L', place: c }); continue; }
    if (c === 'w') { out.push({ k: 'G', place: 'w' }); continue; }
  }
  return out;
}

/** A control curve: points [time, value]; the synth ramps between them. */
export class Track {
  constructor(v0) { this.p = [[0, v0]]; }
  get last() { return this.p[this.p.length - 1]; }
  hold(t) { const [lt, lv] = this.last; if (t > lt + 1e-4) this.p.push([t, lv]); return this; }
  to(t, v) { const [lt] = this.last; this.p.push([Math.max(t, lt + 1e-3), v]); return this; }
}

/**
 * Energy a source with harmonics of amplitude 1/k^p at f0 sends through three band-pass filters at formants F.
 * Used to even out loudness: a vowel whose resonance falls between harmonics would otherwise be much quieter.
 */
export function sourcePower(f0, F, Q, gains, p) {
  let pw = 0;
  for (let k = 1; k * f0 < 6000 && k <= 40; k++) {
    for (let j = 0; j < 3; j++) {
      const x = (k * f0) / F[j];
      const h = (x / Q) / Math.sqrt((1 - x * x) * (1 - x * x) + (x / Q) * (x / Q));
      pw += (gains[j] * h / Math.pow(k, p)) ** 2;
    }
  }
  return pw;
}
function refPower(cfg, shift) {
  const V = cfg.voice;
  let lg = 0, n = 0;
  for (const v of 'aeiou') for (const f of [260, 330, 400, 520, 650]) { lg += Math.log(sourcePower(f, VOWEL_F[v].map((x) => x * shift), V.Q, V.gains, V.softness)); n++; }
  return Math.exp(lg / n);
}

/** How much to scale a vowel note so it is as loud as the others (see sourcePower). */
export function vowelNorm(cfg, shift, hz, v) {
  const V = cfg.voice;
  return clamp(Math.sqrt(refPower(cfg, shift) / sourcePower(hz, VOWEL_F[v].map((x) => x * shift), V.Q, V.gains, V.softness)), 0.45, 2.2);
}

/** Make a score from hand-written notes (used by the sound effects). note: { t, dur, hz:[from,to], v:'a' | ['u','o'], level, asp, nasal } */
export function scoreFromNotes(notes, cfg, shift = 1) {
  const tr = newTracks(cfg.pitch);
  let end = 0;
  for (const n of notes) {
    const hz0 = n.hz[0], hz1 = n.hz[1] ?? n.hz[0];
    const vs = Array.isArray(n.v) ? n.v : [n.v || 'a'];
    tr.f0.hold(n.t - 0.025).to(n.t + 0.012, hz0).to(n.t + n.dur, hz1);
    vs.forEach((v, i) => {
      const t0 = n.t + (n.dur * i) / vs.length, ramp = Math.min(0.06, n.dur / vs.length * 0.6);
      const F = VOWEL_F[v];
      for (let j = 0; j < 3; j++) tr['F' + (j + 1)].hold(t0).to(t0 + ramp, F[j] * shift);
    });
    const L = (n.level ?? 1) * (n.nasal || n.voiceless ? 1 : vowelNorm(cfg, shift, Math.sqrt(hz0 * hz1), vs[0]));
    tr.voice.hold(n.t).to(n.t + 0.018, L * (n.voiceless ? 0 : 1)).hold(n.t + n.dur - 0.01).to(n.t + n.dur + (n.release ?? 0.03), 0);
    tr.asp.hold(n.t).to(n.t + 0.02, n.asp ?? 0.2).hold(n.t + n.dur - 0.01).to(n.t + n.dur + 0.03, 0);
    tr.nasal.hold(n.t).to(n.t + 0.02, n.nasal ?? 0).hold(n.t + n.dur - 0.01).to(n.t + n.dur + 0.03, 0);
    end = Math.max(end, n.t + n.dur + 0.06);
  }
  return closeTracks(tr, end);
}

function newTracks(pitch) {
  return { f0: new Track(pitch), F1: new Track(500), F2: new Track(1400), F3: new Track(2500), voice: new Track(0), asp: new Track(0), fric: new Track(0), fricHz: new Track(2500), nasal: new Track(0) };
}
function closeTracks(tr, end) {
  for (const k of ['voice', 'asp', 'fric', 'nasal']) tr[k].hold(end - 0.04).to(end, 0);
  for (const k of Object.keys(tr)) tr[k].hold(end);
  return { ...tr, end };
}

/**
 * Plan a sentence. cfg is the voice config (pitch, speed, voice{...}); mp the mood parameters (see robotvoice.js).
 * Returns { score, words:[{word, t}], duration (s), nuclei:[...] }.
 */
export function planVoice(text, mp, cfg, speedMul = 1) {
  const V = cfg.voice;
  const speed = Math.max(0.25, cfg.speed * mp.speed * speedMul);
  const base = cfg.pitch * semi(V.offsetSemis);
  const shift = mp.formantShift * V.size;
  const ref = refPower(cfg, shift);
  const tokens = String(text).match(/\S+/g) || [];
  const words = [];
  const segs = [];
  const D = (x) => x / speed;
  let t = 0.03, phrase = 0;
  const micro = 0.012 * mp.gap;

  tokens.forEach((tok, wi) => {
    const tail = (tok.match(/[.,;:!?…]+$/) || [''])[0];
    const ph = toPhonemes(tok);
    words.push({ word: tok, t });
    if (wi > 0 && ph.length && Math.random() < mp.hesitate) {                      // shy / unsure: an "uh" before some words
      segs.push({ k: 'V', v: '@', t0: t, t1: t + D(0.07), quiet: 0.4, word: wi, phrase });
      t += D(0.07);
      segs.push({ k: 'S', t0: t, t1: t + D(0.08) }); t += D(0.08);
    }
    let nucInWord = 0;
    for (let i = 0; i < ph.length; i++) {
      const p = ph[i], nxt = ph[i + 1];
      let d;
      if (p.k === 'V') {
        const diph = (nxt && nxt.k === 'V') || (ph[i - 1] && ph[i - 1].k === 'V');
        d = D((diph ? 0.078 : 0.118) * mp.vowelDur);
        const first = !(ph[i - 1] && ph[i - 1].k === 'V');
        if (first) nucInWord++;
        segs.push({ k: 'V', v: p.v, t0: t, t1: t + d, word: wi, phrase, first, nucInWord });
        t += d;
        if (!(nxt && nxt.k === 'V') && micro > 0.002) { segs.push({ k: 'S', t0: t, t1: t + D(micro) }); t += D(micro); }
      } else if (p.k === 'P') {
        const closure = D(0.034 * mp.consDur), asp = p.voiced ? 0 : D(0.022);
        segs.push({ k: 'P', place: p.place, voiced: p.voiced, t0: t, t1: t + closure + asp, closure, asp, word: wi, phrase });
        t += closure + asp;
      } else if (p.k === 'F') {
        d = D(FRIC[p.f].dur * mp.consDur);
        segs.push({ k: 'F', f: p.f, t0: t, t1: t + d, word: wi, phrase }); t += d;
      } else if (p.k === 'N') {
        d = D(0.07 * mp.consDur);
        segs.push({ k: 'N', place: p.place, t0: t, t1: t + d, word: wi, phrase }); t += d;
      } else if (p.k === 'L' || p.k === 'G') {
        d = D((p.k === 'L' ? 0.062 : 0.05) * mp.consDur);
        segs.push({ k: 'L', place: p.place, t0: t, t1: t + d, word: wi, phrase }); t += d;
      } else if (p.k === 'H') {
        d = D(0.06 * mp.consDur);
        segs.push({ k: 'H', t0: t, t1: t + d, word: wi, phrase }); t += d;
      }
    }
    const comma = /[,;:]/.test(tail), stop = /[.…]/.test(tail), q = tail.includes('?'), ex = tail.includes('!');
    const pause = (comma ? 0.15 : stop ? 0.27 : q || ex ? 0.2 : 0.045) * mp.pause;
    if (tail) { segs.push({ k: 'END', t0: t, t1: t, kind: q ? '?' : ex ? '!' : stop ? '.' : ',', word: wi, phrase }); phrase++; }
    segs.push({ k: 'S', t0: t, t1: t + D(pause) });
    t += D(pause);
  });

  // ---- nuclei: runs of vowel segments, one per syllable-ish
  const nuclei = [];
  for (const s of segs) {
    if (s.k !== 'V') continue;
    const prev = nuclei[nuclei.length - 1];
    if (prev && prev.segs[prev.segs.length - 1].t1 >= s.t0 - 1e-6 && !s.first && prev.word === s.word) { prev.segs.push(s); prev.t1 = s.t1; }
    else nuclei.push({ segs: [s], t0: s.t0, t1: s.t1, word: s.word, phrase: s.phrase, stressed: false, v: s.v, quiet: s.quiet });
  }
  const phraseEnd = {};
  for (const s of segs) if (s.k === 'END') phraseEnd[s.phrase] = s.kind;
  const byPhrase = {};
  nuclei.forEach((n) => { (byPhrase[n.phrase] = byPhrase[n.phrase] || []).push(n); });
  const perWord = {};
  nuclei.forEach((n) => { perWord[n.word] = (perWord[n.word] || 0) + 1; });
  const seenInWord = {};

  // ---- pitch for every nucleus, in semitones above the base
  const INTRINSIC = { a: -0.6, e: 0, i: 0.8, o: -0.3, u: 0.4, '@': -0.5 };
  nuclei.forEach((n, idx) => {
    const group = byPhrase[n.phrase];
    const j = group.indexOf(n), m = group.length, prog = m > 1 ? j / (m - 1) : 1;
    const kind = phraseEnd[n.phrase] || '.';
    const lastInPhrase = j === m - 1;
    let s;
    if (kind === '?') s = -0.5 + 0.8 * Math.sin(Math.PI * Math.min(1, prog)) - 0.6 * prog;
    else if (kind === '!') s = 1.2 + 1.2 * Math.sin(Math.PI * Math.min(1, prog * 0.9)) - 1.4 * prog;
    else if (kind === ',') s = 0.6 + 0.8 * Math.sin(Math.PI * Math.min(1, prog * 0.9)) + 0.8 * prog;
    else s = 1.4 * Math.sin(Math.PI * Math.min(1, prog * 0.9)) - 2.6 * prog;
    seenInWord[n.word] = (seenInWord[n.word] || 0) + 1;
    n.stressed = perWord[n.word] > 1 && seenInWord[n.word] === 1;
    if (n.stressed) s += 1.4;
    s *= V.intonation ?? 1;                                                              // how much the sentence melody rises and falls (cute = singsong)
    s = lerp(s, 0, clamp(mp.flat, 0, 1));
    s += INTRINSIC[n.v] || 0;
    s += ((V.bounce ?? 0) + mp.bounce) * 0.5 * (idx % 2 ? 1 : -1);
    s += rand(0.5, 0.85) * mp.jitter * (Math.random() < 0.5 ? -1 : 1);            // the 3-5% random wobble in pitch, per syllable
    s += mp.semis;
    if (V.snap) s = Math.round(s);                                                  // robot touch: pitches sit on exact semitones
    const g = V.glide * mp.glideV;                                                  // each vowel glides a little (up for friendly, down for sad)
    let a = s - g / 2, b = s + g / 2;
    if (lastInPhrase) {
      const rising = kind === '?' || mp.rise > 0.5;
      if (rising) { a = s - 1; b = s + 5 + 3 * mp.rise + mp.endLift * 0.5; }
      else if (kind === '!') { a = s + 1.5; b = s + 4.5; n.accent = 1.4; }
      else if (mp.endLift) { a = s; b = s + mp.endLift * 1.2; }
      else { a = s + 0.4; b = s - 2.4; }                                            // a statement settles downward
    } else if (mp.rise > 0.5 && Math.random() < 0.25 * mp.rise) {
      b = s + 3;                                                                    // curious: a little "hm?" lift in the middle
    }
    n.st = [a, b];
    n.hz = [base * semi(a), base * semi(b)];
  });

  // ---- tracks
  const tr = newTracks(nuclei.length ? nuclei[0].hz[0] : base);                  // start on the first syllable's pitch
  const sh = (F) => F.map((x) => x * shift);
  const setF = (t0, F, ramp) => { F = sh(F); for (let j = 0; j < 3; j++) tr['F' + (j + 1)].hold(t0).to(t0 + ramp, F[j]); };
  const nucOf = new Map();
  nuclei.forEach((n) => n.segs.forEach((s) => nucOf.set(s, n)));
  const total = Math.max(1, nuclei.length);
  const L0 = V.voiceLevel * mp.volume;
  const asp0 = mp.breath;
  const nextV = (i) => { for (let k = i + 1; k < segs.length; k++) { if (segs[k].k === 'V') return segs[k].v; if (segs[k].k === 'S' || segs[k].k === 'END') return null; } return null; };

  // pitch: hold the previous pitch, then glide into each nucleus shortly before it starts
  nuclei.forEach((n) => {
    tr.f0.hold(n.t0 - 0.03).to(n.t0 + 0.012, n.hz[0]).to(n.t1, n.hz[1]);
  });
  let nIndex = -1;
  segs.forEach((s, i) => {
    const ramp = Math.min(0.03, (s.t1 - s.t0) * 0.5 + 0.004);
    if (s.k === 'V') {
      const n = nucOf.get(s);
      if (s === n.segs[0]) nIndex++;
      const fade = lerp(1, mp.fade, Math.pow(Math.max(0, nIndex) / total, 1.1));
      const F = sh(VOWEL_F[s.v]);
      const mid = Math.sqrt(n.hz[0] * n.hz[1]);
      const norm = clamp(Math.sqrt(ref / sourcePower(mid, F, V.Q, V.gains, V.softness)), 0.45, 2.2);
      const L = L0 * norm * fade * (n.stressed ? 1.19 : 1) * (n.accent || 1) * (s.quiet || 1);
      setF(s.t0, VOWEL_F[s.v], ramp);
      tr.voice.hold(s.t0).to(s.t0 + 0.018, L).hold(s.t1 - 0.012).to(s.t1, L * 0.88);
      tr.asp.hold(s.t0).to(s.t0 + 0.02, asp0 * (s.quiet ? 1.6 : 1)).hold(s.t1 - 0.01).to(s.t1, asp0);
      tr.nasal.hold(s.t0).to(s.t0 + 0.015, 0);
      tr.fric.hold(s.t0).to(s.t0 + 0.01, 0);
    } else if (s.k === 'P') {
      const nv = nextV(i);
      tr.voice.hold(s.t0).to(s.t0 + 0.008, s.voiced ? L0 * 0.28 : 0);
      tr.asp.hold(s.t0).to(s.t0 + 0.008, 0);
      tr.nasal.hold(s.t0).to(s.t0 + 0.01, 0);
      setF(s.t0, LOCUS[s.place], 0.012);
      const tb = s.t0 + s.closure;
      tr.fricHz.hold(tb - 0.002).to(tb, BURST_HZ[s.place]);
      tr.fric.hold(tb - 0.002).to(tb + 0.003, s.voiced ? 0.28 : 0.5).to(tb + 0.017, 0);
      if (!s.voiced) tr.asp.hold(tb).to(tb + 0.004, 0.5).to(s.t1, 0);
      setF(tb, nv ? VOWEL_F[nv] : VOWEL_F['@'], Math.max(0.012, s.t1 - tb + 0.012));
    } else if (s.k === 'F') {
      const f = FRIC[s.f], nv = nextV(i);
      tr.voice.hold(s.t0).to(s.t0 + 0.012, f.voiced ? L0 * 0.35 : 0);
      tr.asp.hold(s.t0).to(s.t0 + 0.01, 0);
      tr.nasal.hold(s.t0).to(s.t0 + 0.01, 0);
      tr.fricHz.hold(s.t0).to(s.t0 + 0.004, f.hz);
      tr.fric.hold(s.t0).to(s.t0 + 0.018, f.gain).hold(s.t1 - 0.018).to(s.t1, 0);
      setF(s.t0, nv ? VOWEL_F[nv] : VOWEL_F['@'], 0.03);
    } else if (s.k === 'N') {
      tr.voice.hold(s.t0).to(s.t0 + 0.014, L0 * 0.7);
      tr.asp.hold(s.t0).to(s.t0 + 0.01, 0);
      tr.nasal.hold(s.t0).to(s.t0 + 0.014, 1).hold(s.t1 - 0.016).to(s.t1, 0.6);
      tr.fric.hold(s.t0).to(s.t0 + 0.01, 0);
      setF(s.t0, LOCUS[s.place], 0.02);
    } else if (s.k === 'L') {
      tr.voice.hold(s.t0).to(s.t0 + 0.014, L0 * 0.8);
      tr.asp.hold(s.t0).to(s.t0 + 0.01, asp0);
      tr.nasal.hold(s.t0).to(s.t0 + 0.01, 0);
      tr.fric.hold(s.t0).to(s.t0 + 0.01, 0);
      setF(s.t0, LOCUS[s.place], 0.02);
    } else if (s.k === 'H') {
      const nv = nextV(i);
      tr.voice.hold(s.t0).to(s.t0 + 0.01, 0);
      tr.asp.hold(s.t0).to(s.t0 + 0.012, 1.6).hold(s.t1 - 0.01).to(s.t1, 0.9);
      tr.nasal.hold(s.t0).to(s.t0 + 0.01, 0);
      tr.fric.hold(s.t0).to(s.t0 + 0.01, 0);
      setF(s.t0, nv ? VOWEL_F[nv] : VOWEL_F['@'], 0.01);
    } else if (s.k === 'S') {
      tr.voice.hold(s.t0).to(s.t0 + 0.014, 0);
      tr.asp.hold(s.t0).to(s.t0 + 0.014, 0);
      tr.fric.hold(s.t0).to(s.t0 + 0.01, 0);
      tr.nasal.hold(s.t0).to(s.t0 + 0.01, 0);
    }
  });
  const end = (segs.length ? segs[segs.length - 1].t1 : 0.1) + 0.1;
  return { score: closeTracks(tr, end), words, duration: end, nuclei };
}
