// Idle life: blinking, looking around, humming, yawning, playful bursts — and, if nobody touches
// Quark for a while, getting bored, then sleepy, then falling asleep.

import { CONFIG } from './config.js';
import { COLORS } from './expressions.js';
import { rand, chance, pick } from './util.js';

const HUM_FACE = { color: COLORS.mint, eye: { smile: 0.55, W: 110, H: 122 }, blush: 0.4, mouth: { A: 1, curve: 2, open: 0.35, W: 14 } };

export function createIdle(q) {
  const { face, audio, mood, subtitles } = q;
  const T = CONFIG.idle;
  let scale = 1;                       // dev: 10 = idle timers run ten times faster
  const t0 = performance.now();
  let lastTouch = t0;
  let nextBlink = t0 + 1200;
  let nextGaze = t0 + 1500;
  let nextHum = t0 + rand(20000, 34000);
  let nextYawn = 0;
  let nextSigh = 0;
  let nextPlayful = t0 + rand(40000, 70000);
  let nextPlayAct = 0;
  let playfulUntil = 0;
  let boredSpoke = false;

  function poke() {
    lastTouch = performance.now();
    boredSpoke = false;
    if (mood.is('bored', 'sleepy')) mood.set('happy');
  }

  function pickGaze() {
    if (mood.is('sleepy')) return [rand(-0.4, 0.4), rand(0.25, 0.75)];
    if (mood.is('bored')) return [pick([-1, 1]) * rand(0.45, 1), rand(-0.3, 0.5)];
    if (mood.is('smug')) return [pick([-1, 1]) * rand(0.5, 0.95), rand(-0.55, -0.1)];       // looks down its nose at things
    if (mood.is('playful')) return [rand(-1, 1), rand(-0.7, 0.7)];
    return chance(0.35) ? [0, 0] : [rand(-0.85, 0.85), rand(-0.5, 0.5)];
  }

  function hum() {
    audio.hum();
    subtitles.caption('humming', 2800);
    face.express(HUM_FACE, { ms: 2800, key: 'hum' });
    for (let i = 0; i < 4; i++) setTimeout(() => face.impulse(0, 0, 0, i % 2 ? 1.6 : -1.6), i * 360);
  }

  function yawn() {
    audio.yawn();
    subtitles.caption('yawn', 2000);
    face.express('yawn', { ms: 2000, key: 'yawn' });
  }

  function playfulAct() {
    const a = Math.floor(Math.random() * 4);
    if (a === 0) { face.express('wink', { ms: 750, key: 'act' }); audio.chirp('giggle'); face.burst('spark'); }
    else if (a === 1) { face.lookAt(-0.9, -0.2, { ms: 350 }); setTimeout(() => face.lookAt(0.9, -0.2, { ms: 350 }), 380); setTimeout(() => face.lookAt(0, 0.1, { ms: 500 }), 760); audio.chirp('huh'); }
    else if (a === 2) { face.impulse(0, -16, 0.035); audio.chirp('happy'); face.burst('spark'); face.burst('spark'); }
    else { face.express('curious', { ms: 1200, key: 'act' }); audio.chirp('ask'); face.burst('question'); }
  }

  function goBored() {
    mood.set('bored');
    nextYawn = performance.now() + rand(5000, 9000);
    nextSigh = performance.now() + rand(3000, 6000);
    if (!boredSpoke && !q.voice.speaking && !q.profile.focus) {
      boredSpoke = true;
      audio.sigh();                       // a sigh and a look, not a canned line: anything Quark says on its own should come from the brain
    }
  }

  function goSleepy() {
    mood.set('sleepy');
    nextYawn = performance.now() + 600;
  }

  function fallAsleep() {
    audio.sleepDown();
    q.voice.cancel();
    face.releaseGaze();
    face.clearOverrides();
    mood.set('asleep', { force: true });
  }

  function tick() {
    if (q.router && !q.router.active) return;       // nothing happens (and nothing speaks) while you're on Home or Settings
    const now = performance.now();
    const asleep = mood.is('asleep');

    if (!asleep) {
      if (now >= nextBlink) {
        face.blink();
        if (chance(0.18)) setTimeout(() => face.blink(), 230);
        nextBlink = now + rand(2400, 6200) * (mood.is('sleepy') ? 0.7 : 1);
      }
      if (now >= nextGaze) {
        const [x, y] = pickGaze();
        face.lookAt(x, y);
        nextGaze = now + rand(mood.is('playful') ? 500 : 1000, mood.is('bored', 'sleepy') ? 4200 : 3000);
      }
    }
    if (asleep || q.locked || mood.is('sulky', 'sad', 'angry', 'scared', 'smug')) return;

    const idleMs = (now - lastTouch) * scale;
    if (idleMs >= T.sleepMs) return fallAsleep();
    if (idleMs >= T.sleepyMs) {
      if (!mood.is('sleepy')) goSleepy();
    } else if (idleMs >= T.boredMs) {
      if (mood.is('happy', 'playful')) goBored();
    }

    const busy = q.voice.speaking;
    if (mood.is('bored', 'sleepy') && !busy) {
      if (now >= nextYawn) { yawn(); nextYawn = now + rand(12000, 22000) / scale; }
      else if (mood.is('bored') && now >= nextSigh) { audio.sigh(); subtitles.caption('sigh', 1400); nextSigh = now + rand(9000, 16000) / scale; }
    }

    if (mood.is('happy', 'playful') && !busy && idleMs > 4000) {
      if (now >= nextHum) { hum(); nextHum = now + rand(25000, 50000); }
      if (mood.is('happy') && now >= nextPlayful) {
        mood.set('playful');
        playfulUntil = now + rand(10000, 16000);
        nextPlayAct = now + 1500;
        nextPlayful = now + rand(50000, 90000);
      }
      if (mood.is('playful')) {
        if (now >= playfulUntil) mood.set('happy');
        else if (now >= nextPlayAct) { playfulAct(); nextPlayAct = now + rand(2500, 5500); }
      }
    }
  }

  setInterval(tick, 100);

  return {
    poke,
    hum, yawn, playfulAct,
    sleepNow() { fallAsleep(); },
    setScale(n) { scale = n; },
    get scale() { return scale; },
    get idleMs() { return (performance.now() - lastTouch) * scale; },
  };
}
