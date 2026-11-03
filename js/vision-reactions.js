// What Quark does with what it sees. Movement and gestures only: Quark never describes or comments on how
// anyone looks. Every reaction has a cooldown so it never becomes a nag, and Quark stays quiet while it is
// busy (asleep, mid-crack, sulking) or already talking.

import { createHand } from './handsvg.js';
import { chance, rand, deck } from './util.js';

const L = {
  wave: deck(['Hi! I see you waving!', 'Hello! Waving back as hard as I can!', 'Hey you! Hi hi hi!']),
  highfive: deck(['High five!', 'Up top!', 'Yes! High five, champ!']),
  thumbs: deck(["Aww, thanks! I'm blushing.", 'Thumbs up received. My heart just did a beep.', 'You too! Seriously.']),
  closer: deck(['Ooh! Hello up close!', 'Whoa, hi! I can see all my own reflection in your eyes. ...Kidding. Hi.']),
  jump: deck(['Whoa, nice jump!', 'Boing! Do it again!', 'Look at you go!']),
  danceStart: deck(['Ooh, a dance party! I am in!', "You're dancing! I'm dancing too!"]),
  danceEnd: deck(["Great moves! I'd give you a ten. Out of ten.", 'That was fun! You have rhythm. I have a fan.']),
  sudden: deck(['Whoa! You startled me. ...Hehe. Okay, I am fine.', 'Gah! Okay. Okay. I am fine. Do not do that again. ...Do it again.']),
  back: deck(["You're back! I missed you!", 'There you are! I was getting worried.']),
  found: deck(['Oh! There you are.', 'Hello! I can see you now.']),
  poke: deck(['Hellooo? Are you still there?', 'Tap tap. Anyone home?']),
  seen: deck(["I can see you! Don't worry, it all stays on your phone.", 'Eyes open! I can see you. It all stays right here on your phone.']),
  noCam: deck(["I can't see you, but I can still feel you.", "No eyes today. But I can still feel you. That's close enough."]),
};

export function createVisionReactions(q) {
  const { face, audio, fx, subtitles, idle, mood } = q;
  const last = {};
  let danceTimer = 0;
  let stillCount = 0;
  let wasAway = false;

  const ready = (name, ms) => {
    const t = performance.now();
    if (t - (last[name] || -1e9) < ms) return false;
    last[name] = t;
    return true;
  };
  /** Free to react? Not asleep, not mid-sequence, not sulking. */
  const free = () => !q.state.asleep && !q.locked && !mood.is('sulky');
  const quietly = () => q.voice.speaking;

  // ---- a hand that comes in from the side
  function playHand(kind) {
    const hand = createHand('open');
    const el = hand.el;
    el.classList.add(kind === 'highfive' ? 'hi5' : 'wave');
    fx.layer.appendChild(el);
    const wait = (a) => new Promise((r) => { a.onfinish = r; a.oncancel = r; });
    (async () => {
      if (!el.animate) { setTimeout(() => el.remove(), 1500); return; }
      if (kind === 'highfive') {
        await wait(el.animate([{ transform: 'translate(120%, 30%) rotate(18deg)', opacity: 0 }, { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' }));
        const r = el.getBoundingClientRect();
        fx.flash(r.left + r.width / 2, r.top + 20, 380);
        audio.boop();
        setTimeout(() => audio.blip(1500), 60);
        q.haptics.pulse('boop');
        face.impulse(0, -7, 0.04);
        for (let i = 0; i < 4; i++) setTimeout(() => face.burst('spark'), i * 60);
        await wait(el.animate([{ transform: 'translate(0, 0) scale(1)' }, { transform: 'translate(-6px, 0) scale(1.08)' }, { transform: 'translate(0, 0) scale(1)' }], { duration: 220 }));
        await new Promise((r2) => setTimeout(r2, 380));
        await wait(el.animate([{ transform: 'translate(0, 0)', opacity: 1 }, { transform: 'translate(120%, 30%) rotate(18deg)', opacity: 0 }], { duration: 300, easing: 'ease-in', fill: 'forwards' }));
      } else {
        await wait(el.animate([{ transform: 'translate(120%, 40%) rotate(10deg)', opacity: 0 }, { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' }));
        await wait(el.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-18deg)' }, { transform: 'rotate(16deg)' }, { transform: 'rotate(-16deg)' }, { transform: 'rotate(14deg)' }, { transform: 'rotate(-10deg)' }, { transform: 'rotate(0deg)' }],
          { duration: 1100, easing: 'ease-in-out' }));
        await wait(el.animate([{ transform: 'translate(0, 0)', opacity: 1 }, { transform: 'translate(120%, 40%) rotate(10deg)', opacity: 0 }], { duration: 300, easing: 'ease-in', fill: 'forwards' }));
      }
      el.remove();
    })();
  }

  function say(text, opts) {
    if (quietly()) { subtitles.caption(text, 2400); return; }
    q.say(text, opts);
  }

  // ---- where Quark looks
  function gaze(x, y) {
    if (x == null) return;
    if (q.state.asleep || mood.is('sulky') || q.locked) return;
    face.lookAt(x, y, { prio: 1, ms: 380 });
  }

  // ---- the events
  const handlers = {
    found() {
      if (!free() || !ready('found', 30000)) return;
      face.express('wow', { ms: 700, key: 'vis' });
      audio.chirp('ask');
      say(L.found(), { tone: 'happy' });
    },

    wave() {
      if (!free() || !ready('wave', 8000)) return;
      q.chat.addHint('user waved', 'camera');
      idle.poke();
      face.express('happy', { ms: 2200, key: 'vis' });
      audio.chirp('happy');
      playHand('wave');
      say(L.wave(), { tone: 'happy' });
    },

    highfive() {
      if (!free() || !ready('highfive', 5000)) return;
      q.chat.addHint('user held up a palm for a high five', 'camera');
      idle.poke();
      face.express('joy', { ms: 2000, key: 'vis' });
      playHand('highfive');
      setTimeout(() => say(L.highfive(), { tone: 'excited' }), 380);
    },

    thumbsup() {
      if (!free() || !ready('thumbs', 6000)) return;
      q.chat.addHint('user gave a thumbs up', 'camera');
      idle.poke();
      face.express('happy', { ms: 2000, key: 'vis' });
      audio.chirp('happy');
      for (let i = 0; i < 3; i++) setTimeout(() => face.burst('heart'), i * 140);
      if (chance(0.7)) say(L.thumbs(), { tone: 'happy' });
    },

    approach() {
      if (!free() || !ready('approach', 8000)) return;
      q.chat.addHint('user moved closer', 'camera');
      idle.poke();
      face.express('wow', { ms: 1500, key: 'vis' });
      audio.chirp('ask');
      if (chance(0.4)) say(L.closer(), { tone: 'happy' });
    },

    retreat() {
      if (!free() || !ready('retreat', 8000)) return;
      q.chat.addHint('user stepped back', 'camera');
      face.express('sad', { ms: 1400, key: 'vis' });
      audio.sad();
    },

    away() {
      if (!free()) return;
      wasAway = true;
      q.chat.addHint('user went out of view', 'camera');
      face.express('sad', { key: 'away' });          // held until they come back
      face.lookAt(0.7, 0.2, { prio: 1, ms: 2500 });
      audio.sad();
    },

    back() {
      face.release('away');
      if (!wasAway) return;
      wasAway = false;
      if (!free()) return;
      q.chat.addHint('user came back into view', 'camera');
      idle.poke();
      face.express('joy', { ms: 2000, key: 'vis' });
      audio.chirp('excited');
      face.impulse(0, -9, 0.04);
      for (let i = 0; i < 3; i++) setTimeout(() => face.burst('heart'), i * 120);
      say(L.back(), { tone: 'excited' });
    },

    jump() {
      if (!free() || !ready('jump', 5000)) return;
      q.chat.addHint('user jumped', 'camera');
      idle.poke();
      face.express('joy', { ms: 1800, key: 'vis' });
      face.impulse(0, -16, 0.05);
      setTimeout(() => face.impulse(0, -10, 0.03), 260);
      audio.chirp('excited');
      for (let i = 0; i < 4; i++) setTimeout(() => face.burst('spark'), i * 80);
      if (chance(0.7)) say(L.jump(), { tone: 'excited' });
    },

    'dance-start'() {
      if (!free() || !ready('dance', 20000)) return;
      q.chat.addHint('user is dancing', 'camera');
      idle.poke();
      face.express('playful', { key: 'dance' });
      audio.chirp('excited');
      say(L.danceStart(), { tone: 'excited' });
      startDance();
    },

    'dance-end'() {
      stopDance();
      if (!free()) return;
      q.chat.addHint('user stopped dancing', 'camera');
      face.express('happy', { ms: 1800, key: 'vis' });
      audio.chirp('happy');
      if (ready('danceEnd', 15000)) say(L.danceEnd(), { tone: 'happy' });
    },

    sudden() {
      if (!free() || !ready('sudden', 9000)) return;
      q.chat.addHint('user made a sudden move', 'camera');
      face.express('startled', { ms: 650, key: 'vis' });
      face.burst('sweat');
      face.burst('exclaim');
      audio.startle();
      face.impulse(0, -9, 0.06);
      setTimeout(() => {
        if (!free()) return;
        face.express('happy', { ms: 1500, key: 'vis' });
        audio.chirp('giggle');
        subtitles.caption('giggle', 1400);
        say(L.sudden(), { tone: 'excited' });
      }, 800);
    },

    still() {
      if (!free()) return;
      stillCount++;
      if (stillCount % 2 === 1) {
        // first nudge: poke the screen for attention
        pokeScreen();
        say(L.poke(), { tone: 'bored' });
      } else {
        // second time round: give up and get sleepy
        mood.set('sleepy');
        audio.sigh();
      }
    },
  };

  /** Quark's little dance: bounces, sways and sparkles. Runs until stopDance(). */
  function startDance() {
    let beat = 0;
    clearInterval(danceTimer);
    danceTimer = setInterval(() => {
      if (q.state.asleep || q.locked) { stopDance(); return; }
      const side = beat++ % 2 ? 1 : -1;
      face.impulse(side * 4, beat % 4 < 2 ? -9 : 0, 0.02, side * 5);
      face.lookAt(side * 0.5, -0.1, { prio: 1, ms: 300 });
      if (beat % 2 === 0) audio.blip(rand(260, 380));
      if (beat % 4 === 0) face.burst('spark');
    }, 380);
  }

  /** Dance for a few seconds (used when you ask Quark to dance, and for victory dances). */
  function danceFor(ms = 4000) {
    face.express('playful', { ms: ms + 400, key: 'dance' });
    audio.chirp('excited');
    startDance();
    setTimeout(stopDance, ms);
  }

  function stopDance() {
    clearInterval(danceTimer);
    danceTimer = 0;
    face.release('dance');
  }

  /** Quark taps the glass from the inside to get attention. */
  function pokeScreen() {
    face.lookAt(0, 0, { prio: 1, ms: 1500 });
    const x = innerWidth / 2 + rand(-60, 60), y = innerHeight * 0.42;
    for (let i = 0; i < 2; i++) {
      setTimeout(() => {
        audio.boop();
        fx.flash(x, y, 260);
        face.impulse(0, 3, 0);
      }, i * 320);
    }
    subtitles.caption('tap tap', 1400);
  }

  return {
    onEvent(e) {
      try { handlers[e.type]?.(e); } catch (err) { console.error('vision reaction failed', e.type, err); }
    },
    onGaze: gaze,
    seen() { return L.seen(); },
    noCam() { return L.noCam(); },
    stopDance,
    danceFor,
    playHand,
    pokeScreen,
    resetStill() { stillCount = 0; },
  };
}
