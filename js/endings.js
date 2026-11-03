// How a game ends, from Quark's side.
//
//   Quark wins : happy dance, victory face, a gentle "better luck next time, champ".
//   Quark loses: a comedic tantrum, then a giant digital hand slams the screen into a crack, the screen takes
//                5 to 10 seconds to reform, and then Quark laughs it off and congratulates you.
//
// Quark is a good sport: it cheers your wins for real, and a tantrum always ends in a laugh and a compliment.

import * as haptics from './haptics.js';
import { createHand } from './handsvg.js';
import { deck, pick, rand, sleep } from './util.js';

const L = {
  win: deck(['Yes yes yes! I win!', 'Ha! Victory is mine!', 'Beep boop, champion robot over here!']),
  winKind: deck(["Better luck next time, champ.", "Better luck next time, champ. You played great, though.", "Better luck next time, champ. I believe in you."]),
  tantrum: deck(['No... no no no... NO!', 'That is not fair! That is NOT fair!', 'Noooo! I was SO close!']),
  laugh: deck([
    'Hahaha! Okay okay. Good game. You earned that.',
    "Okay, okay, I'm over it. Good game! You earned that.",
    "Hehe. Wow. Okay. Good game. You're really good. Don't tell my screen I said that.",
  ]),
  praise: deck(['You are also a menace, and I mean that warmly.', 'Seriously though, well played. Rematch?', 'You win this one. I demand a rematch. Please.']),
};

export function createEndings(q) {
  const { face, audio, fx } = q;

  /** Quark won. Resolves when the celebration is over. */
  async function winDance({ line } = {}) {
    q.locked = true;
    try {
      face.express('joy', { key: 'end' });
      audio.fanfare();
      for (let i = 0; i < 4; i++) setTimeout(() => face.burst('spark'), i * 110);
      q.say(L.win(), { tone: 'excited' });
      q.vision?.danceFor?.(3400);
      await sleep(2600);
      await q.say(line || L.winKind(), { tone: 'happy' });
      await sleep(400);
    } finally {
      face.release('end');
      q.locked = false;
      q.temper?.event('quark_won');                    // and now Quark is rather pleased with itself
    }
  }

  /** The user won. Quark cheers (used when a game ends well for the user but without a tantrum, e.g. mid-match). */
  function cheerUser(text = 'Nice one!') {
    face.express('happy', { ms: 1600, key: 'end' });
    audio.chirp('excited');
    for (let i = 0; i < 3; i++) setTimeout(() => face.burst('heart'), i * 130);
    return q.say(text, { tone: 'excited' });
  }

  /** Quark lost: tantrum, giant hand, crack, long reform, laugh. `short` trims the reform for quick games. */
  async function loseTantrum({ short = false, praise = true } = {}) {
    q.locked = true;
    const w = innerWidth, h = innerHeight;
    try {
      // 1. the tantrum
      q.temper?.event('quark_lost');
      face.express('angry', { key: 'end' });
      audio.chirp('angry');
      q.say(L.tantrum(), { tone: 'angry' });
      for (let i = 0; i < 4; i++) setTimeout(() => { face.impulse(i % 2 ? 7 : -7, 0, 0, i % 2 ? 4 : -4); audio.thump(0.8); }, 250 + i * 260);
      face.setTremble(0.8);
      await sleep(1500);
      face.setTremble(0);

      // 2. summon the giant hand
      audio.whoosh();
      q.voice.cancel();
      const hand = createHand('fist');
      hand.el.classList.add('giant');
      fx.layer.appendChild(hand.el);
      const slam = hand.el.animate?.([
        { transform: 'translateY(-125%) rotate(-10deg) scale(1.05)', opacity: 0.2 },
        { transform: 'translateY(-60%) rotate(-6deg) scale(1.1)', opacity: 1, offset: 0.45 },
        { transform: 'translateY(2%) rotate(0deg) scale(1.28)', opacity: 1 },
      ], { duration: 520, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' });
      if (slam) await new Promise((r) => { slam.onfinish = r; slam.oncancel = r; }); else await sleep(520);

      // 3. SMACK
      haptics.pulse('punch');
      audio.crack(1.5);
      audio.glitch(700);
      fx.shake('hard');
      fx.crack({ x: w / 2, y: h * 0.5, severity: 3 });
      fx.glitch(1400);
      face.express('insane', { key: 'end' });
      face.impulse(0, 14, -0.08, 5);
      await sleep(900);
      hand.el.animate?.([{ transform: 'translateY(2%) rotate(0deg) scale(1.28)', opacity: 1 }, { transform: 'translateY(-130%) rotate(-8deg) scale(1.1)', opacity: 0 }], { duration: 700, easing: 'ease-in', fill: 'forwards' });
      setTimeout(() => hand.el.remove(), 800);

      // 4. the screen reforms (5 to 10 seconds)
      face.express('melt', { key: 'end' });
      audio.wah();
      await fx.reform(short ? rand(3200, 4500) : rand(5200, 9500));

      // 5. laughs it off
      face.express('joy', { key: 'end' });
      audio.chirp('giggle');
      for (let i = 0; i < 3; i++) setTimeout(() => face.burst('heart'), i * 130);
      await q.say(L.laugh(), { tone: 'happy' });
      q.temper?.go('happy', 60, { flourish: false });                 // laughed it off
      if (praise) { face.express('happy', { key: 'end' }); await q.say(L.praise(), { tone: 'happy' }); }
    } finally {
      face.setTremble(0);
      face.release('end');
      fx.clearCrack();
      fx.stopGlitch();
      q.locked = false;
    }
  }

  return { winDance, loseTantrum, cheerUser };
}
