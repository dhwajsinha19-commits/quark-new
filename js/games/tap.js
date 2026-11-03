// Tap Challenge: 10 seconds, tap as fast as you can, live counter, saved high score.
// Quark cheers you on and, if the score is low, teases lightly (then hypes you right back up).

import { load, save } from '../storage.js';
import { deck, pick, chance } from '../util.js';
import { gameShell, el, wait } from './shell.js';

const SECONDS = 10;

const LINES = {
  low: deck([
    "That's... a gentle tap. Did your finger fall asleep? Kidding! Warm up and go again, you've got more in you.",
    'Whoa, slow and steady! I felt every single tap. Nice and polite. Try going wild next time!',
  ]),
  ok: deck(['Not bad! Your thumb has potential. Want to beat it?', 'Solid! I could hear those taps tingling. Go again?']),
  great: deck(["Now we're talking! Your thumb is on fire!", 'Wow, that was fast! My screen is a little warm now.']),
  wow: deck(['WOW! Are you a robot? Because I am, and I am impressed!', 'Legendary tapping! I am putting this on my fridge. I do not have a fridge.']),
  best: deck(['A new high score! That is a record! Confetti time!', 'New personal best! I knew you could do it!']),
};

export function mount(q, layer, ctx) {
  const shell = gameShell(layer, { title: 'Tap Challenge', onBack: ctx.exit });
  q.face.express('playful', { key: 'game' });
  let phase = 'ready';           // ready | countdown | go | done
  let taps = 0;
  let timer = 0;
  let endAt = 0;
  let dead = false;
  const best = () => load('tapBest', 0);

  function showReady() {
    phase = 'ready';
    taps = 0;
    shell.setScore(best() ? `Best ${best()}` : '');
    shell.body.innerHTML = '';
    const card = el('div', 'g-card', `
      <h3>Tap Challenge</h3>
      <p>Tap the big button as many times as you can in ${SECONDS} seconds. Use as many fingers as you like.</p>
      <div class="g-row"><button class="g-btn primary" type="button" data-go>Start</button></div>
      ${best() ? `<p class="g-note" style="margin-top:12px">Your best: ${best()} taps</p>` : ''}`);
    shell.body.appendChild(card);
    card.querySelector('[data-go]').addEventListener('click', () => { q.audio.unlock(); startCountdown(); });
    q.idle.poke();
    if (!ready1) { ready1 = true; q.say("Tap challenge! Ten seconds. Tap as fast as you can. Ready when you are!", { tone: 'happy' }); }
  }
  let ready1 = false;

  function buildPlayField() {
    shell.body.innerHTML = '';
    const wrap = el('div', 'tap-wrap', `
      <div class="tap-count" aria-live="off">0</div>
      <div class="tap-time">${SECONDS.toFixed(1)}</div>
      <button class="tap-btn" type="button" aria-label="Tap">
        <svg class="tap-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><circle class="tap-prog" cx="50" cy="50" r="46"/></svg>
        <span>TAP</span>
      </button>
      <div class="tap-cps"></div>`);
    shell.body.appendChild(wrap);
    return {
      count: wrap.querySelector('.tap-count'),
      time: wrap.querySelector('.tap-time'),
      btn: wrap.querySelector('.tap-btn'),
      prog: wrap.querySelector('.tap-prog'),
      cps: wrap.querySelector('.tap-cps'),
    };
  }

  async function startCountdown() {
    if (dead) return;
    phase = 'countdown';
    const f = buildPlayField();
    f.btn.classList.add('waiting');
    f.btn.querySelector('span').textContent = '';
    q.face.lookAt(0, 0.55, { prio: 1, ms: 0 });
    for (const n of ['3', '2', '1']) {
      if (dead) return;
      f.count.textContent = n;
      f.count.classList.remove('pop'); void f.count.offsetWidth; f.count.classList.add('pop');
      q.audio.thump(1.1);
      await wait(720);
    }
    if (dead) return;
    f.btn.classList.remove('waiting');
    f.btn.querySelector('span').textContent = 'TAP';
    f.count.textContent = '0';
    q.audio.chirp('excited');
    q.face.express('joy', { key: 'game' });
    q.voice.cancel();
    play(f);
  }

  function play(f) {
    phase = 'go';
    taps = 0;
    const t0 = performance.now();
    endAt = t0 + SECONDS * 1000;
    const circ = 2 * Math.PI * 46;
    f.prog.style.strokeDasharray = `${circ}`;
    let halfway = false;

    const hit = (e) => {
      if (phase !== 'go') return;
      if (e && e.preventDefault) e.preventDefault();
      taps++;
      f.count.textContent = taps;
      f.btn.classList.remove('hit'); void f.btn.offsetWidth; f.btn.classList.add('hit');
      q.audio.tick(taps);
      q.haptics.pulse('tap');
      q.face.impulse(0, -2.5, 0.004);
      if (taps % 20 === 0) q.face.burst('spark');
      q.idle.poke();
    };
    f.btn.addEventListener('pointerdown', hit);
    const key = (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) hit(); } };
    addEventListener('keydown', key);
    cleanup.push(() => removeEventListener('keydown', key));

    const tick = () => {
      if (dead) return;
      const left = Math.max(0, endAt - performance.now());
      f.time.textContent = (left / 1000).toFixed(1);
      f.prog.style.strokeDashoffset = `${circ * (1 - left / (SECONDS * 1000))}`;
      const elapsed = (performance.now() - t0) / 1000;
      f.cps.textContent = elapsed > 1 ? `${(taps / elapsed).toFixed(1)} taps/sec` : '';
      shell.setScore(`${taps}`);
      if (!halfway && left < (SECONDS * 1000) / 2) { halfway = true; q.audio.chirp('happy'); q.subtitles.caption('Halfway there!', 1200); }
      if (left <= 0) { finish(f); return; }
      timer = requestAnimationFrame(tick);
    };
    timer = requestAnimationFrame(tick);
  }

  async function finish(f) {
    phase = 'done';
    cancelAnimationFrame(timer);
    f.btn.disabled = true;
    f.btn.closest('.tap-wrap').classList.add('done');   // collapse the play field so the result card has room
    q.audio.chirp('happy');
    q.haptics.pulse('thud');
    const score = taps;
    const prev = best();
    const isBest = score > prev;
    if (isBest) save('tapBest', score);
    q.face.releaseGaze(1);
    shell.setScore(`${score}`);

    const tier = score < 25 ? 'low' : score < 45 ? 'ok' : score < 65 ? 'great' : 'wow';
    const card = el('div', 'g-card', `
      <h3>${score} taps</h3>
      <p>${(score / SECONDS).toFixed(1)} taps per second${isBest ? (prev ? ` · new best! (was ${prev})` : ' · first score saved!') : ` · your best is ${best()}`}</p>
      <div class="g-row"><button class="g-btn primary" type="button" data-again>Play again</button><button class="g-btn" type="button" data-home>Home</button></div>`);
    shell.body.appendChild(card);
    card.querySelector('[data-again]').addEventListener('click', () => startCountdown());
    card.querySelector('[data-home]').addEventListener('click', ctx.exit);

    if (isBest && prev > 0) {
      q.face.express('joy', { ms: 3500, key: 'game' });
      q.fx.confetti(60);
      q.audio.fanfare();
      for (let i = 0; i < 4; i++) setTimeout(() => q.face.burst('heart'), i * 120);
      q.say(LINES.best(), { tone: 'excited' });
    } else {
      q.face.express(tier === 'low' ? 'playful' : 'joy', { ms: 3000, key: 'game' });
      if (tier === 'wow') q.fx.confetti(30);
      if (tier !== 'low') for (let i = 0; i < 3; i++) setTimeout(() => q.face.burst('spark'), i * 120);
      const r = await q.chat.banter(`tap challenge: the user tapped ${score} times in ${SECONDS} seconds (their best is ${Math.max(score, prev)}). ${tier === 'low' ? 'That is a low score: tease them lightly, then hype them up.' : 'Cheer for them.'}`, () => LINES[tier](), tier === 'low' ? 'playful' : 'excited');
      if (!dead) q.say(r.reply, { tone: tier === 'low' ? 'happy' : 'excited' });
    }
  }

  const cleanup = [];
  showReady();

  return {
    id: 'tap',
    title: 'Tap Challenge',
    handleText() { return false; },
    destroy() {
      dead = true;
      cancelAnimationFrame(timer);
      cleanup.forEach((fn) => fn());
      q.face.releaseGaze(1);
    },
  };
}
