// Rock-Paper-Scissors, best of 3 or 5.
//
// Quark summons a glowing digital hand, shakes it three beats, then reveals its throw. You throw by tapping a
// button, saying it, or (if you've let Quark see you) showing your hand to the camera. Friendly banter every round;
// a win dance if Quark wins, the giant-hand tantrum if it loses.

import { load, save } from '../storage.js';
import { createHand } from '../handsvg.js';
import { deck, chance } from '../util.js';
import { gameShell, el, wait } from './shell.js';

const MOVES = ['rock', 'paper', 'scissors'];
const POSE = { rock: 'fist', paper: 'open', scissors: 'scissors' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const VERB = { rock: 'Rock crushes scissors', paper: 'Paper covers rock', scissors: 'Scissors cut paper' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const L = {
  quarkWins: deck([
    (m) => `${VERB[m]}. Sorry, not sorry!`,
    (m) => `${VERB[m]}! Point for me.`,
    (m) => `${VERB[m]}. Beep boop, I'm unstoppable. Today.`,
  ]),
  youWin: deck([
    (m) => `${VERB[m]}. Nice one! You got me.`,
    (m) => `${VERB[m]}. Okay okay, that was good.`,
    (m) => `Ooh! ${VERB[m]}. Point to you, champ.`,
  ]),
  tie: deck(['Same throw! We think alike. Spooky.', 'A tie! Great minds beep alike.', 'Draw! Again, again!']),
  noThrow: deck(["Hey! You didn't throw anything! Again!", 'Too slow, slowpoke! ...I mean, take your time. Again!']),
  pattern: deck(['Rock again? I see a pattern, rocky.', 'You love that one, huh? I am starting to notice.']),
  start: deck(['Rock paper scissors! Best of three or best of five?', "Rock paper scissors! Pick: best of three, or five if you're brave."]),
};

export function mount(q, layer, ctx) {
  const shell = gameShell(layer, { title: 'Rock Paper Scissors', onBack: ctx.exit });
  q.face.express('playful', { key: 'game' });
  let dead = false;
  let target = 2;               // wins needed
  let you = 0, quark = 0, round = 0;
  let choice = null;            // what the user has picked this round
  let phase = 'menu';           // menu | shake | between | over
  let lastUser = [];
  let redo = 0;

  const say = (t, o) => (dead ? Promise.resolve(false) : q.say(t, o));

  // ------------------------------------------------------------------ menu
  function showMenu() {
    phase = 'menu';
    you = quark = round = 0;
    lastUser = [];
    shell.setScore('');
    shell.body.innerHTML = '';
    const camOn = q.tracker && (q.tracker.state === 'on' || q.tracker.state === 'loading');
    const card = el('div', 'g-card', `
      <h3>Rock Paper Scissors</h3>
      <p>Quark throws a hand. You throw yours: tap, say it, or show your hand to the camera.</p>
      <div class="g-row"><button class="g-btn primary" type="button" data-n="2">Best of 3</button><button class="g-btn primary" type="button" data-n="3">Best of 5</button></div>
      <div class="g-row" style="margin-top:12px"><button class="g-btn" type="button" data-cam>${camOn ? 'Camera is on' : 'Use my camera'}</button></div>
      <p class="g-note" style="margin:10px 0 0">The camera is optional. Video stays on your device.</p>`);
    shell.body.appendChild(card);
    card.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => { q.audio.unlock(); start(+b.dataset.n); }));
    card.querySelector('[data-cam]').addEventListener('click', async (e) => {
      if (q.tracker.state === 'on') { e.target.textContent = 'Camera is on'; return; }
      e.target.textContent = 'Starting…';
      if (q.settings.get('cameraConsent')) await q.cam.turnOn(); else q.cam.showConsent(true);
      e.target.textContent = q.tracker.state === 'on' || q.tracker.state === 'loading' ? 'Camera is on' : 'Use my camera';
    });
    q.idle.poke();
    say(L.start(), { tone: 'happy' });
  }

  // ------------------------------------------------------------------ the match
  function buildArena() {
    shell.body.innerHTML = '';
    const arena = el('div', 'rps-arena', `
      <div class="rps-beat" aria-live="polite">&nbsp;</div>
      <div class="rps-stage">
        <div class="rps-side you"><div class="rps-hand"></div><div class="rps-label">You</div></div>
        <div class="rps-side quark"><div class="rps-hand"></div><div class="rps-label">${q.name()}</div></div>
      </div>
      <div class="rps-result">&nbsp;</div>
      <div class="rps-picks">
        ${MOVES.map((m) => `<button class="rps-pick" type="button" data-m="${m}"><span class="rps-ico"></span>${cap(m)}</button>`).join('')}
      </div>`);
    shell.body.appendChild(arena);
    const hands = {
      you: createHand('fist'),
      quark: createHand('fist'),
    };
    arena.querySelector('.rps-side.you .rps-hand').appendChild(hands.you.el);
    arena.querySelector('.rps-side.quark .rps-hand').appendChild(hands.quark.el);
    arena.querySelectorAll('.rps-pick').forEach((b) => {
      const h = createHand(POSE[b.dataset.m]);
      b.querySelector('.rps-ico').appendChild(h.el);
      b.addEventListener('click', () => setChoice(b.dataset.m));
    });
    return {
      arena, hands,
      beat: arena.querySelector('.rps-beat'),
      result: arena.querySelector('.rps-result'),
      picks: [...arena.querySelectorAll('.rps-pick')],
    };
  }

  let ui = null;

  function setChoice(m) {
    if (phase !== 'shake' || !MOVES.includes(m)) return false;
    choice = m;
    ui.picks.forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    q.audio.blip(900);
    q.haptics.pulse('tap');
    return true;
  }

  function start(n) {
    target = n;
    ui = buildArena();
    nextRound();
  }

  async function nextRound() {
    if (dead) return;
    round++;
    shell.setScore(`You ${you} · ${quark} ${q.name()}`);
    ui.result.innerHTML = '&nbsp;';
    ui.hands.you.setPose('fist');
    ui.hands.quark.setPose('fist');
    ui.picks.forEach((b) => b.classList.remove('on'));
    choice = null;
    phase = 'shake';
    q.voice.cancel();
    q.face.express('playful', { key: 'game' });
    q.face.lookAt(0, 0.45, { prio: 1, ms: 0 });

    // three beats and a shoot
    const words = ['Rock…', 'Paper…', 'Scissors…', 'SHOOT!'];
    say('Rock, paper, scissors, shoot!', { tone: 'excited', chunk: false, rate: 1.05 });
    for (let i = 0; i < 4; i++) {
      if (dead) return;
      ui.beat.textContent = words[i];
      ui.beat.classList.remove('pop'); void ui.beat.offsetWidth; ui.beat.classList.add('pop');
      if (i < 3) {
        q.audio.thump(1 + i * 0.12);
        for (const side of ['you', 'quark']) ui.arena.querySelector(`.rps-side.${side} .hand-sprite`).animate?.([{ transform: `${side === 'you' ? 'scaleX(-1) ' : ''}translateY(0)` }, { transform: `${side === 'you' ? 'scaleX(-1) ' : ''}translateY(-46px) rotate(${side === 'you' ? 8 : -8}deg)` }, { transform: `${side === 'you' ? 'scaleX(-1) ' : ''}translateY(0)` }], { duration: 520, easing: 'ease-in-out' });
        await wait(640);
      }
    }
    // the reveal: a short beat for late throws and the camera
    await wait(380);
    if (dead) return;
    let mine = choice;
    let viaCamera = false;
    if (!mine && q.tracker && q.tracker.state === 'on' && q.tracker.hand && performance.now() - q.tracker.hand.t < 900 && MOVES.includes(q.tracker.hand.shape)) {
      mine = q.tracker.hand.shape;
      viaCamera = true;
    }
    if (!mine) return noThrow();
    reveal(mine, viaCamera);
  }

  async function noThrow() {
    phase = 'between';
    round--;
    redo++;
    ui.beat.textContent = 'Nothing?';
    q.audio.chirp('huh');
    q.face.express('curious', { ms: 1500, key: 'game' });
    if (redo >= 3) {
      redo = 0;
      await say("You keep forgetting to throw! I'm giving the point to me. Hehe.", { tone: 'happy' });
      quark++;
      round++;
      return afterRound(null, null, 'forfeit');
    }
    await say(L.noThrow(), { tone: 'happy' });
    nextRound();
  }

  async function reveal(mine, viaCamera) {
    redo = 0;
    phase = 'between';
    const theirs = MOVES[Math.floor((q.rng ? q.rng() : Math.random()) * MOVES.length)];   // q.rng lets tests force a throw
    ui.hands.you.setPose(POSE[mine]);
    ui.hands.quark.setPose(POSE[theirs]);
    ui.picks.forEach((b) => b.classList.toggle('on', b.dataset.m === mine));
    q.audio.reveal();
    ui.beat.textContent = `${cap(mine)}  vs  ${cap(theirs)}`;
    lastUser.push(mine);
    const outcome = mine === theirs ? 'tie' : BEATS[mine] === theirs ? 'you' : 'quark';
    if (outcome === 'you') you++;
    if (outcome === 'quark') quark++;
    await afterRound(mine, theirs, outcome, viaCamera);
  }

  async function afterRound(mine, theirs, outcome, viaCamera) {
    shell.setScore(`You ${you} · ${quark} ${q.name()}`);
    const winner = outcome === 'you' ? mine : outcome === 'quark' ? theirs : null;
    ui.result.className = `rps-result ${outcome}`;
    ui.result.textContent = outcome === 'tie' ? 'Draw!' : outcome === 'you' ? 'You win the round!' : outcome === 'quark' ? `${q.name()} wins the round!` : `${q.name()} takes it`;
    let line;
    if (outcome === 'quark') q.temper?.event('round_won'); else if (outcome === 'you') q.temper?.event('round_lost');
    if (outcome === 'tie') { line = L.tie(); q.face.express('wow', { ms: 1400, key: 'game' }); q.audio.chirp('huh'); }
    else if (outcome === 'you') { line = L.youWin()(winner); q.face.express('sad', { ms: 1200, key: 'game' }); q.audio.chirp('sad'); q.fx.confetti(10); }
    else if (outcome === 'quark') { line = L.quarkWins()(winner); q.face.express('joy', { ms: 1500, key: 'game' }); q.audio.chirp('happy'); for (let i = 0; i < 3; i++) setTimeout(() => q.face.burst('spark'), i * 100); }
    else line = '';
    if (viaCamera) line = `I saw your hand! ${line}`;
    if (mine && lastUser.length >= 3 && lastUser.slice(-3).every((m) => m === mine) && chance(0.7)) line += ' ' + L.pattern();
    if (line) await say(line, { tone: outcome === 'you' ? 'sad' : 'happy' });
    if (dead) return;

    if (you >= target || quark >= target) return endMatch();
    await wait(500);
    q.chat.addHint(`rock paper scissors: score is you ${you}, quark ${quark}`);
    nextRound();
  }

  async function endMatch() {
    phase = 'over';
    const userWon = you > quark;
    const rec = load('rpsStats', { w: 0, l: 0 });
    if (userWon) rec.w++; else rec.l++;
    save('rpsStats', rec);
    ui.beat.innerHTML = '&nbsp;';
    ui.picks.forEach((b) => { b.disabled = true; });
    if (userWon) {
      ui.result.className = 'rps-result you';
      ui.result.textContent = `You win ${you}–${quark}!`;
      await q.endings.loseTantrum();
    } else {
      ui.result.className = 'rps-result quark';
      ui.result.textContent = `${q.name()} wins ${quark}–${you}!`;
      await q.endings.winDance();
    }
    if (dead) return;
    const card = el('div', 'g-card', `
      <h3>${userWon ? 'You won!' : `${q.name()} won!`}</h3>
      <p>Final score: you ${you}, ${q.name()} ${quark}. Want a rematch?</p>
      <div class="g-row"><button class="g-btn primary" type="button" data-again>Play again</button><button class="g-btn" type="button" data-home>Home</button></div>`);
    shell.body.appendChild(card);
    card.querySelector('[data-again]').addEventListener('click', () => showMenu());
    card.querySelector('[data-home]').addEventListener('click', ctx.exit);
    ui.arena.querySelector('.rps-picks').style.display = 'none';
  }

  // ------------------------------------------------------------------ voice / typed input
  function handleText(text) {
    const low = text.toLowerCase();
    if (phase === 'menu') {
      if (/\b(five|5)\b/.test(low)) { start(3); return true; }
      if (/\b(three|3)\b/.test(low) || /\b(start|play|ready|yes|yeah|let'?s go)\b/.test(low)) { start(2); return true; }
      return false;
    }
    const m = /\b(rock|stone)\b/.test(low) ? 'rock' : /\b(paper)\b/.test(low) ? 'paper' : /\b(scissors?|scissor|sheers|shears)\b/.test(low) ? 'scissors' : null;
    if (m && phase === 'shake') { setChoice(m); return true; }
    return false;
  }

  showMenu();
  return {
    id: 'rps',
    title: 'rock paper scissors',
    handleText,
    destroy() { dead = true; q.face.releaseGaze(1); },
  };
}
