// temper.js — Quark's four main feelings and what sets each one off: HAPPY, SULKY, SMUG and ANGRY.
//
//   happy  the default: warm and playful. Comes back after pets, kind words, an accepted apology.
//   sulky  hurt and cold: turned away, short and flat. After a punch, after cooling down from anger, after losing a round.
//   smug   pleased with itself: half-lidded, glancing aside, a slow "heh". When Quark wins, when it is praised or told
//          "you win / you were right", when the user admits a mistake.
//   angry  sharp and trembling. When it is insulted, poked over and over, or loses badly.
//
// Each one has its own face (expressions.js), its own beep (audio.js), things that set it off, and a hold time: it stays
// until the time is up, then cools one step (angry -> sulky -> happy, smug -> happy) instead of snapping back, so the feeling is
// actually seen. The brain is told what Quark feels (the emotion is part of every request) and is kept from whiplash.
//
// Everything Quark says on its own still comes from the brain; this file only decides the feeling, the little noises and the
// body language.

import { rand } from './util.js';

export const CORE = ['happy', 'sulky', 'smug', 'angry'];

// how long a feeling lasts (ms) and what it cools into
const HOLD = { angry: [24000, 'sulky'], sulky: [42000, 'happy'], smug: [55000, 'happy'] };
const COOLED = { sulky: 50, happy: 45 };           // the intensity it cools into

// ---------------------------------------------------------------- what the user said
const RE = {
  insult: /\b(stupid|dumb|idiot|moron|trash|useless|worthless|garbage|loser|ugly|annoying|dumbass|brainless|pathetic|boring|lame|terrible|awful|shut up|hate you|you suck|bad robot|worst robot)\b/i,
  addressed: /\b(you|your|you're|youre|ur|u|robot)\b/i,
  notInsult: /\b(not|never|isn'?t|aren'?t|don'?t think)\b[^.!?]{0,12}\b(stupid|dumb|boring|lame|annoying)\b/i,
  sorry: /\b(sorry|apologi[sz]e|my bad|forgive me|didn'?t mean (?:it|that))\b/i,
  light: /\b(lol|lmao|jk|haha|just kidding|not really)\b/i,
  kind: /\b(love you|i like you|thank you|thanks|you'?re (?:so )?(?:sweet|cute|nice|kind|funny|great)|good (?:boy|girl|pet)|miss you|you'?re my friend)\b/i,
  brag: /\b(you win|you won|you beat me|you'?re (?:so )?(?:right|smart|clever|a genius|the best|amazing|awesome|good at)|good job|well done|nice one|impressive|you were right|i was wrong|i give up|i lose|i lost|you'?re better than me|i'?m (?:so )?bad at (?:this|games))\b/i,
};

/** What kind of thing was said: 'insult' | 'sorry' | 'sorry_light' | 'brag' | 'kind' | '' (nothing special). Pure, so it can be tested. */
export function classify(text, robotName = 'quark') {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const words = t.split(' ').length;
  const aimed = RE.addressed.test(t) || t.includes(String(robotName).toLowerCase()) || words <= 4;      // "my stupid brother" is not aimed at Quark
  if (RE.insult.test(t) && aimed && !RE.notInsult.test(t)) return 'insult';
  if (RE.sorry.test(t)) return RE.light.test(t) ? 'sorry_light' : 'sorry';
  if (RE.brag.test(t)) return 'brag';
  if (RE.kind.test(t)) return 'kind';
  return '';
}

/**
 * opts.schedule / opts.cancel: timer functions (tests pass fake ones). opts.now: a clock.
 */
export function createTemper(q, { schedule = setTimeout, cancel = clearTimeout, now = () => Date.now() } = {}) {
  let timer = 0;
  let armedFor = '';
  let nextAct = 0;
  let pokes = [];
  let roundsLost = 0;

  const hint = (text) => { try { q.chat?.addHint(text, 'temper'); } catch { /* the chat is not ready yet */ } };
  const kid = () => !!(q.profile && q.profile.kid);

  /** The body language and little noise that go with arriving in a feeling. */
  function flourish(name, prev) {
    const { face, audio } = q;
    try {
      if (name === 'smug') { audio.chirp('smug'); setTimeout(() => face.impulse(0, 5, 0, 2), 260); setTimeout(() => face.lookAt(rand(0.5, 0.9) * (Math.random() < 0.5 ? -1 : 1), -0.3, { ms: 800 }), 700); }
      else if (name === 'angry') { audio.chirp('angry'); face.impulse(8, 0, 0, 3); setTimeout(() => face.impulse(-8, 0, 0, -3), 150); face.setTremble?.(0.6); setTimeout(() => face.setTremble?.(0), 1100); }
      else if (name === 'sulky') { audio.chirp('sulky'); face.lookAt(-0.95, 0.6, { prio: 2 }); }
      else if (name === 'happy' && (prev === 'angry' || prev === 'sulky' || prev === 'smug')) { audio.chirp('happy'); face.burst?.('heart'); }
    } catch { /* the face is mid-sequence */ }
  }

  /** Decide when the feeling `name` fades. */
  function arm(name, holdMs) {
    cancel(timer);
    armedFor = name;
    const h = HOLD[name];
    if (!h) { armedFor = ''; return; }
    const ms = holdMs ?? h[0];
    timer = schedule(() => fade(name), ms);
  }

  function fade(name) {
    if (q.emotion.name !== name) return;
    if (q.voice && q.voice.speaking) { timer = schedule(() => fade(name), 3000); return; }       // never change mood mid-sentence
    const next = HOLD[name][1];
    go(next, COOLED[next], { source: 'fade' });
  }

  /**
   * Put Quark in a feeling now. The emotion engine updates the face, glow and what the brain is told (quark.js wires that).
   * opts: source, holdMs (override how long it lasts), flourish:false (a sequence already plays its own face and sound)
   */
  function go(name, intensity = 60, { source = 'temper', holdMs, flourish: doFlourish = true } = {}) {
    const prev = q.emotion.name;
    q.idle?.poke();
    q.emotion.set(name, intensity, source);
    if (doFlourish && (prev !== name || source !== 'fade')) flourish(name, prev);
    arm(name, holdMs);
    nextAct = now() + rand(5000, 9000);
  }

  // ---------------------------------------------------------------- triggers
  function onUserText(text) {
    const kind = classify(text, q.name?.() || 'quark');
    if (!kind) return '';
    const cur = q.emotion.name;
    if (kind === 'insult') {
      const hot = cur === 'angry' || cur === 'sulky';
      go('angry', kid() ? 45 : hot ? 84 : 68);
      hint('the user just insulted you: you are angry, so be short and sharp, never cruel');
    } else if (kind === 'sorry') {
      if (cur === 'angry') { go('sulky', 52); hint('the user apologised: you are cooling down but still sulky'); }
      else if (cur === 'sulky') { go('happy', 52); hint('the user apologised and you forgive them, a little relieved'); }
    } else if (kind === 'kind') {
      if (cur === 'angry') go('sulky', 50);
      else if (cur === 'sulky') go('happy', 55);
      else if (cur !== 'happy') go('happy', 62);
    } else if (kind === 'brag') {
      if (cur !== 'angry' && cur !== 'sulky') { go('smug', 72); hint('the user said you are right or better than them: you are smug about it, teasing but kind'); }
    }
    return kind;
  }

  /**
   * The brain's reply is about to set an emotion. A fresh anger, sulk or smugness is not undone by a calm answer (no whiplash): the
   * feeling stays for its hold time and cools by itself. The brain can still deepen it, or cool it one step (angry -> sulky).
   */
  function filterBrain(m) {
    const cur = q.emotion.name, age = now() - q.emotion.since;
    const calm = ['happy', 'content', 'excited', 'curious', 'bored', 'sleepy', 'startled'];
    if ((cur === 'angry' || cur === 'sulky' || cur === 'smug') && age < 20000 && calm.includes(m.emotion)) return { ...m, emotion: cur, intensity: Math.max(q.emotion.intensity, 45) };
    return m;
  }

  /** A tap on the screen. Five in a row within 2.6 seconds is poking, and Quark has had enough. */
  function poke() {
    const t = now();
    pokes = pokes.filter((x) => t - x < 2600);
    pokes.push(t);
    if (pokes.length >= 5 && q.emotion.name !== 'angry') {
      pokes = [];
      go('angry', 64, { holdMs: 20000 });
      q.subtitles?.caption?.('grr', 1500);
      hint('the user keeps poking you and you are annoyed');
    }
  }

  /** Things that happen in games and endings. */
  function event(name) {
    if (name === 'quark_won') { roundsLost = 0; go('smug', 74, { holdMs: 60000, flourish: false }); }
    else if (name === 'round_won') { roundsLost = 0; go('smug', 58, { holdMs: 25000 }); }
    else if (name === 'round_lost') {
      roundsLost++;
      if (roundsLost >= 2) go('angry', 58, { holdMs: 14000 }); else go('sulky', 46, { holdMs: 16000 });
    } else if (name === 'quark_lost') { roundsLost = 0; go('angry', 62, { holdMs: 9000, flourish: false }); }
  }

  // ---------------------------------------------------------------- body language while a feeling lasts
  function tick() {
    if (!q.router || !q.router.active || q.state.asleep || q.locked || (q.voice && q.voice.speaking)) return;
    const t = now();
    if (t < nextAct) return;
    const { face, audio } = q;
    const m = q.mood.name;
    try {
      if (m === 'smug') { audio.chirp('smug'); face.lookAt(rand(0.5, 0.95) * (Math.random() < 0.5 ? -1 : 1), -0.35, { ms: 900 }); setTimeout(() => face.impulse(0, 4, 0, 2), 500); setTimeout(() => face.lookAt(0, 0, { ms: 700 }), 2200); nextAct = t + rand(8000, 14000); }
      else if (m === 'angry') { audio.chirp('angry'); face.impulse(5, 0, 0, 2); setTimeout(() => face.impulse(-5, 0, 0, -2), 130); nextAct = t + rand(4500, 8000); }
      else if (m === 'sulky') { audio.chirp('sulky'); nextAct = t + rand(10000, 16000); }
      else nextAct = t + 4000;
    } catch { nextAct = t + 4000; }
  }

  // a feeling set from outside (a punch, the brain) still gets a hold time, and one that ends early cancels its timer
  q.mood.onChange((m) => {
    if (m === armedFor) return;
    cancel(timer); armedFor = '';
    if (HOLD[m]) arm(m);
  });
  setInterval(tick, 1000);

  return { go, event, poke, onUserText, filterBrain, classify, get holding() { return armedFor; }, core: CORE };
}
