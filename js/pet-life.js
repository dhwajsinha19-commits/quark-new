// A pet does things on its own. While nobody is talking to Quark it looks around, tilts its head at nothing, does a double-take,
// stretches, shakes itself off, startles at a sound only it heard, nods off when it is sleepy, and now and then asks for
// attention. Every behaviour is a few seconds of face movement and a small noise; none of it uses words (anything Quark says
// comes from the brain). It never runs while Quark is talking, being touched, upset or asleep, or on any page but the Quark page.

import { rand, chance, sleep } from './util.js';

export function createPetLife(q) {
  const { face, audio } = q;
  let nextAt = performance.now() + rand(5000, 9000);
  const recent = [];               // the last two behaviours, so it does not repeat itself
  let running = false;

  const quiet = () => q.profile.focus;                       // a focus buddy keeps still and silent
  const peep = (kind) => { if (!quiet()) audio.chirp(kind); };
  const stillFree = () => !q.voice.speaking && !q.locked && !q.state.asleep && q.chat.phase === 'idle';

  const BEHAVIOURS = {
    lookAround: { w: 3, run: async () => {
      for (const [x, y] of [[-0.9, -0.15], [0.9, -0.1], [0.1, -0.75]]) { face.lookAt(x, y, { ms: 800 }); await sleep(720); if (!stillFree()) return; }
      if (chance(0.5)) peep('huh');
    } },
    curiousTilt: { w: 2.2, run: async () => {
      face.express('curious', { ms: 1700, key: 'pet' });
      face.impulse(0, 0, 0, 6);
      face.burst('question');
      peep('ask');
      await sleep(1700);
    } },
    doubleTake: { w: 1.6, run: async () => {
      face.lookAt(-0.95, 0.1, { ms: 600 });
      await sleep(650);
      face.lookAt(0.2, 0, { ms: 500 });
      face.express('startled', { ms: 420, key: 'pet' });
      face.impulse(0, -7, 0.03);
      peep('huh');
      await sleep(600);
    } },
    sniff: { w: 1.5, run: async () => {
      face.lookAt(0.2, 0.8, { ms: 1400 });
      for (let i = 0; i < 3; i++) { face.impulse(0, 5, 0.01); await sleep(240); if (!stillFree()) return; }
      face.blink();
    } },
    stretch: { w: 1.4, run: async () => {
      face.impulse(0, -7, 0.05);
      face.express('yawn', { ms: 1700, key: 'pet' });
      if (!quiet()) audio.yawn();
      await sleep(1700);
    } },
    shakeOff: { w: 1.4, run: async () => {
      for (let i = 0; i < 5; i++) { face.impulse(i % 2 ? 6 : -6, 0, 0, i % 2 ? 7 : -7); await sleep(95); }
      peep('giggle');
    } },
    wiggle: { w: 1.3, run: async () => {
      face.express('happy', { ms: 1500, key: 'pet' });
      for (let i = 0; i < 4; i++) { face.impulse(i % 2 ? 8 : -8, 0, 0, i % 2 ? 4 : -4); await sleep(170); }
      peep('happy');
    } },
    peek: { w: 1.4, run: async () => {
      const side = chance(0.5) ? -1 : 1;
      face.lookAt(side * 0.97, 0.45, { ms: 1200 });
      face.impulse(side * 5, 0, 0, side * 3);
      await sleep(1100);
      face.lookAt(0, 0, { ms: 300 });
    } },
    startleAtNothing: { w: 0.9, run: async () => {
      face.express('startled', { ms: 650, key: 'pet' });
      face.burst('exclaim');
      face.impulse(0, -12, 0.045);
      if (!quiet()) audio.startle();
      await sleep(800);
      face.lookAt(0.8, 0.2, { ms: 900 });
      face.express('curious', { ms: 1100, key: 'pet' });
      await sleep(1100);
    } },
    nodOff: { w: 0, run: async () => {                                // only when sleepy or bored
      face.express('sleepy', { ms: 2600, key: 'pet' });
      for (let i = 0; i < 2; i++) { face.impulse(0, 9, 0); await sleep(700); }
      face.impulse(0, -12, 0.04);
      face.express('startled', { ms: 380, key: 'pet' });
      await sleep(500);
    } },
    askAttention: { w: 0, run: async () => {                          // only after a long quiet
      face.lookAt(0, 0, { ms: 1500 });
      face.express('curious', { ms: 1500, key: 'pet' });
      face.impulse(0, -10, 0.04);
      peep('ask');
      await sleep(600);
      face.impulse(0, -8, 0.03);
      if (chance(0.5)) peep('huh');
      await sleep(900);
    } },
  };

  function pick() {
    const sleepy = q.emotion.name === 'sleepy' || q.emotion.name === 'bored';
    const longQuiet = q.idle.idleMs > 50000;
    const weights = Object.entries(BEHAVIOURS).map(([name, b]) => {
      let w = b.w;
      if (name === 'nodOff') w = sleepy ? 3 : 0;
      if (name === 'askAttention') w = longQuiet ? 3 : 0;
      if (sleepy && (name === 'wiggle' || name === 'startleAtNothing')) w *= 0.2;
      if (q.emotion.name === 'excited' || q.emotion.name === 'curious') w *= name === 'wiggle' || name === 'curiousTilt' || name === 'lookAround' ? 1.6 : 1;
      if (recent.includes(name)) w *= 0.12;
      return [name, w];
    });
    const total = weights.reduce((n, [, w]) => n + w, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const [name, w] of weights) { r -= w; if (r <= 0) return name; }
    return weights[0][0];
  }

  async function tick() {
    if (running || document.hidden || q.page !== 'quark') return;
    const now = performance.now();
    if (now < nextAt) return;
    // a smug Quark does its own thing (temper.js), not random startles
    if (!stillFree() || q.idle.idleMs < 3500 || q.emotion.negative || q.emotion.name === 'smug') { nextAt = now + 1500; return; }   // not now: check again soon
    const name = pick();
    if (!name) return;
    running = true;
    recent.unshift(name);
    recent.length = Math.min(recent.length, 2);
    try { await BEHAVIOURS[name].run(); } catch (e) { console.error(e); }
    face.release('pet');
    running = false;
    const calm = q.emotion.name === 'sleepy' || q.emotion.name === 'content' ? 1.4 : q.emotion.name === 'excited' || q.emotion.name === 'curious' ? 0.65 : 1;
    nextAt = performance.now() + rand(6500, 15000) * calm * (quiet() ? 3 : 1);
  }

  setInterval(tick, 1000);
  return { names: Object.keys(BEHAVIOURS), run: async (name) => { if (BEHAVIOURS[name]) { running = true; try { await BEHAVIOURS[name].run(); } finally { face.release('pet'); running = false; } } } };
}
