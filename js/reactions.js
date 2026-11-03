// Touch reactions and the choreography behind them: waking up, petting, booping, and the
// punch -> crack -> reform -> forgive sequence (which escalates to dramatic sulking).
//
// Tone rule for every line in here: Quark is a warm, loyal pet. Teasing is affectionate and
// aimed at what just happened, and it always lands on something kind.

import * as haptics from './haptics.js';
import { memory } from './memory.js';
import { deck, sleep, rand, chance } from './util.js';

const LINES = {
  startleWake: deck([
    "Wha—! I'm up! I'm up!",
    "Huh?! I wasn't sleeping. I was... recharging. Hi!",
    'Gah! Oh. It is you. Good. Hi.',
  ]),
  gentleWake: deck([
    'Mmh... hi. That feels nice.',
    'Mm. Okay. I am awake. Keep doing that.',
  ]),

  punch1: deck([
    'Ow! Rude. ...okay, I forgive you.',
    'Ow! I felt that in my pixels. ...Forgiven.',
    'Ouch! What was that for? ...never mind. I still like you.',
  ]),
  punch2Now: deck([
    "Hey! That's twice!",
    'Again?! My screen is not a drum!',
  ]),
  punch2After: deck([
    "...I'm watching you. Gently. Affectionately. But watching.",
    "Okay now you're just testing me. Pet me and we're even.",
  ]),
  sulkEnter: deck([
    "That's it. I'm not talking to you.",
    'I am going to sulk now. Professionally.',
    "I'm moving in with your other phone. ...kidding. I have nowhere else to go. But I'm SULKING.",
  ]),
  sulkPunch: deck([
    'Ow. Still sulking.',
    'Unbelievable.',
    'I am filing a complaint with the Department of Pets.',
    '*sniff*',
  ]),
  melt: deck([
    "Okay... okay. You're forgiven. You're lucky you're my favorite.",
    "Mmm. Fine. I can't stay mad when you pet me like that. Rude.",
  ]),
  sulkTimeout: deck([
    "...Fine. I'm over it. But you owe me a pet.",
    "I've decided to forgive you. Because I'm the bigger robot.",
  ]),

  boop: deck(['Boop!', 'Hehe. Boop.', 'Beep boop to you too.']),
  petLine: deck([
    "Mmm. Don't stop.",
    "I'm not purring. That's my cooling fan. ...It's purring.",
    'You have good hands. Weird thing to say. I stand by it.',
    "Okay that's actually really nice.",
  ]),
  rough: deck([
    'Whoa, easy! I am delicate.',
    "Gentler, champ! I'm a pet, not a bongo drum.",
  ]),
};

export function createReactions(q) {
  const { face, audio, fx, mood, idle, subtitles } = q;
  const st = q.state;

  let holding = false;      // finger is currently down in a pet-length hold
  let petting = false;
  let heartTimer = 0;
  let lastPetLine = 0;
  let sulkTimer = 0;
  let heat = 0;             // how recently/often Quark has been punched
  let heatAt = performance.now();

  let sceneId = 0;
  const newScene = () => {
    const id = ++sceneId;
    return { get live() { return id === sceneId; }, wait: async (ms) => { await sleep(ms); return id === sceneId; } };
  };

  function addHeat() {
    const now = performance.now();
    heat *= Math.pow(0.5, (now - heatAt) / 20000); // half-life 20 s
    heatAt = now;
    heat += 1;
    return heat < 1.5 ? 1 : heat < 2 ? 2 : 3;
  }

  // ------------------------------------------------------------ waking up

  async function wake(kind) {
    q.locked = true;
    const s = newScene();
    try {
      st.firstBoot = false;
      mood.set('happy', { force: true });
      q.hint(null);
      idle.poke();
      haptics.pulse('wake');
      if (kind === 'first') {
        face.express('wow', { ms: 900, key: 'wake' });
        audio.chirp('ask');
        face.burst('spark');
        if (!(await s.wait(550))) return;
        face.blink();
        if (!(await s.wait(450))) return;
        face.express('happy', { ms: 3600, key: 'wake' });
        audio.chirp('happy');
        q.afterWake?.();
        // the brain writes the hello: an introduction the first time ever, a natural welcome back after that
        const g = await q.chat.greet({ onFirstSpeech: () => { q.locked = false; } });   // poking is allowed once it starts talking
        if (g.ok) memory.markSeen(); else memory.touch();
        if (!s.live) return;
        q.hint('tap the mic to talk · hold to pet', 6000);
      } else if (kind === 'quiet') {
        // woken by a voice/typed message: no speech, the reply is about to start
        face.express('sleepy', { ms: 700, key: 'wake' });
        q.afterWake?.();
        if (!(await s.wait(650))) return;
        face.blink();
      } else if (kind === 'startle') {
        audio.startle();
        face.express('startled', { ms: 700, key: 'wake' });
        face.burst('exclaim');
        face.impulse(0, -9, 0.05);
        q.say(LINES.startleWake(), { tone: 'excited' });
        await s.wait(800);
        face.blink();
        face.express('happy', { ms: 1600, key: 'wake' });
      } else {
        face.express('sleepy', { ms: 1100, key: 'wake' });
        audio.yawn();
        subtitles.caption('yawn', 1600);
        if (!(await s.wait(1100))) return;
        face.blink();
        q.say(LINES.gentleWake(), { tone: 'sleepy' });
      }
    } finally {
      q.locked = false;
    }
  }

  // ------------------------------------------------------------ petting

  function waitForUnlock() {
    const t = setInterval(() => {
      if (!holding) clearInterval(t);
      else if (!q.locked) { clearInterval(t); beginPet(); }
    }, 120);
  }

  async function melt() {
    q.locked = true;
    try {
      clearTimeout(sulkTimer);
      heat = 0;
      face.releaseGaze(2);
      face.lean(0, 0);
      face.express('melt', { key: 'pet' });
      audio.sad();
      await sleep(750);
      mood.set('happy', { force: true });
      face.express('joy', { key: 'pet' });
      audio.chirp('excited');
      for (let i = 0; i < 4; i++) setTimeout(() => face.burst('heart'), i * 120);
      face.impulse(0, -10, 0.04);
      q.say(LINES.melt(), { tone: 'happy' });
    } finally {
      q.locked = false;
    }
  }

  async function beginPet() {
    idle.poke();
    if (st.asleep) { await wake('gentle'); if (!holding) return; }
    if (mood.is('sulky')) { await melt(); if (!holding) return; }
    petting = true;
    mood.set('happy');
    face.express('purr', { key: 'pet' });
    audio.purrStart();
    haptics.startPurr();
    subtitles.caption('purring', 2400);
    face.burst('heart');
    clearInterval(heartTimer);
    heartTimer = setInterval(() => { face.burst('heart'); idle.poke(); }, 650);
  }

  function onPetStart() {
    holding = true;
    if (q.locked) waitForUnlock();
    else beginPet();
  }

  function onPetMove(pt) {
    if (!petting) return;
    face.lean(pt.nx, pt.ny);
    face.lookAt(pt.nx, pt.ny, { prio: 3 });
  }

  function onPetEnd(info) {
    holding = false;
    if (!petting) return;
    petting = false;
    audio.purrStop();
    haptics.stopPurr();
    clearInterval(heartTimer);
    face.release('pet');
    face.lean(0, 0);
    idle.poke();
    const now = performance.now();
    if (info.reason === 'rough') {
      audio.startle();
      face.express('startled', { ms: 600, key: 'pet' });
      q.say(LINES.rough(), { tone: 'excited' });
      return;
    }
    face.express('happy', { ms: 1600, key: 'pet' });
    face.burst('spark');
    if (info.ms > 1500 && now - lastPetLine > 9000 && chance(0.6)) {
      lastPetLine = now;
      q.say(LINES.petLine(), { tone: 'happy' });
    }
  }

  // ------------------------------------------------------------ boop (a tap that's too slow to be a punch)

  function onBoop(pt) {
    if (st.asleep) return wake(st.firstBoot ? 'first' : 'startle');
    if (q.locked) return;
    idle.poke();
    q.temper?.poke();                           // five quick taps in a row make Quark angry
    face.express('boop', { ms: 280, key: 'boop' });
    audio.boop();
    haptics.pulse('boop');
    face.impulse(-pt.nx * 3, -pt.ny * 3, 0.02);
    if (chance(0.3) && !q.voice.speaking) q.say(LINES.boop(), { tone: 'happy' });
  }

  // ------------------------------------------------------------ punch

  function impact(pt, severity, shake) {
    q.voice.cancel();
    haptics.pulse('punch');
    audio.crack(severity >= 3 ? 1.2 : 1);
    fx.shake(shake);
    face.impulse(-pt.nx * 10, -pt.ny * 10, -0.05, rand(-3, 3));
    fx.crack({ x: pt.x, y: pt.y, severity });
    audio.glitch(500);
  }

  function armSulkTimer() {
    clearTimeout(sulkTimer);
    sulkTimer = setTimeout(async () => {
      if (!mood.is('sulky') || petting) return;
      face.releaseGaze(2);
      mood.set('happy', { force: true });
      heat = 0;
      audio.chirp('ask');
      face.express('happy', { ms: 1800, key: 'hit' });
      q.say(LINES.sulkTimeout(), { tone: 'sulky' });
    }, 38000);
  }

  function enterSulk() {
    mood.set('sulky', { force: true });
    face.lookAt(-0.95, 0.6, { prio: 2 });
    armSulkTimer();
  }

  // Each sequence returns an "aftermath" function that runs once input is unlocked again.

  async function punchOne(pt) {
    impact(pt, 1, 'med');
    fx.glitch(1500);
    face.express('insane', { key: 'hit' });
    audio.charge(1.3);
    q.say('Ka-ma-ha-ma-ha!', { spoken: 'Kah mah hah mah hah!', chunk: false, tone: 'shout' });
    await sleep(1500);
    face.express('startled', { ms: 500, key: 'hit' });
    await fx.reform(1000);                  // 1.5 s + 1.0 s: the screen is whole again ~2.5 s after the hit
    return async () => {
      const line = q.say(LINES.punch1(), { tone: 'sulky' });
      face.express('startled', { ms: 500, key: 'hit' });
      await sleep(500);
      face.express('sulky', { ms: 1000, key: 'hit' });
      await sleep(1000);
      face.express('happy', { ms: 2200, key: 'hit' });
      face.burst('heart');
      await line;
    };
  }

  async function punchTwo(pt) {
    q.temper?.go('angry', 72, { source: 'punch', holdMs: 22000, flourish: false });    // really angry (it used to be only a flash of the face)
    impact(pt, 2, 'med');
    fx.glitch(1000);
    face.express('angry', { key: 'hit' });
    audio.chirp('angry');
    q.say(LINES.punch2Now(), { tone: 'angry' });
    await sleep(1200);
    await fx.reform(1000);
    return async () => {
      face.express('angry', { ms: 1200, key: 'hit' });
      await q.say(LINES.punch2After(), { tone: 'sulky' });
    };
  }

  async function punchThree(pt) {
    impact(pt, 3, 'hard');
    fx.glitch(1200);
    face.express('insane', { ms: 700, key: 'hit' });
    audio.charge(0.7);
    await sleep(1000);
    face.express('sad', { key: 'hit' });
    await fx.reform(1000);
    return async () => {
      enterSulk();
      face.release('hit');
      audio.sad();
      await q.say(LINES.sulkEnter(), { tone: 'sulky' });
    };
  }

  async function punchWhileSulking(pt) {
    impact(pt, 2, 'med');
    fx.glitch(700);
    face.express('startled', { ms: 500, key: 'hit' });
    q.say(LINES.sulkPunch(), { tone: 'sulky' });
    await sleep(1000);
    await fx.reform(800);
    armSulkTimer();
    return async () => { face.release('hit'); face.lookAt(-0.95, 0.6, { prio: 2 }); };
  }

  async function onPunch(pt) {
    if (st.asleep) return wake(st.firstBoot ? 'first' : 'startle');
    idle.poke();
    const level = addHeat();
    if (q.locked) { // already mid-sequence: just flinch
      haptics.pulse('thud');
      audio.crack(0.4);
      fx.shake('soft');
      face.impulse(-pt.nx * 6, -pt.ny * 6, 0.03);
      return;
    }
    q.locked = true;
    let after = null;
    try {
      after = await (mood.is('sulky') ? punchWhileSulking(pt) : level === 1 ? punchOne(pt) : level === 2 ? punchTwo(pt) : punchThree(pt));
    } finally {
      q.locked = false;
      fx.clearCrack();
      fx.stopGlitch();
    }
    if (after) after();
  }

  // ------------------------------------------------------------ plain touch tracking

  const sulkGaze = () => { if (mood.is('sulky')) face.lookAt(-0.95, 0.6, { prio: 2 }); };

  const touchHandlers = {
    onDown(pt) {
      audio.unlock();
      q.voice.unlock();
      if (!st.asleep && !mood.is('sulky')) face.lookAt(pt.nx, pt.ny, { prio: 3 });
    },
    onMove(pt) {
      if (!st.asleep && !mood.is('sulky')) face.lookAt(pt.nx, pt.ny, { prio: 3 });
    },
    onUp() {
      face.releaseGaze(3);
      sulkGaze();
    },
    onPetStart, onPetMove, onPetEnd, onBoop, onPunch,
  };

  return { touchHandlers, wake, onPunch, onBoop, melt, enterSulk, newScene, get heat() { return heat; } };
}
