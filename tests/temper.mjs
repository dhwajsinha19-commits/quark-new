// Unit tests for js/temper.js: Quark's four main feelings (happy, sulky, smug, angry). Run: node tests/temper.mjs
// A fake clock and fake timers stand in for time, so "24 seconds later" takes no time at all.

import { createTemper, classify } from '../js/temper.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); } };

function world() {
  let t = 1000, timers = [], seq = 0;
  const moodFns = [];
  let emo = { name: 'happy', intensity: 45, at: t };
  let moodName = 'happy';
  const chirps = [], hints = [];
  const q = {
    emotion: {
      set(name, intensity, source) { emo = { name, intensity, at: t, source }; if (moodName !== name) { moodName = name; moodFns.forEach((f) => f(name)); } },
      get name() { return emo.name; }, get intensity() { return emo.intensity; }, get since() { return emo.at; },
    },
    mood: { onChange(f) { moodFns.push(f); }, get name() { return moodName; }, setExternally(n) { moodName = n; moodFns.forEach((f) => f(n)); } },
    idle: { poke() {} }, face: { impulse() {}, lookAt() {}, setTremble() {}, burst() {} }, audio: { chirp(k) { chirps.push(k); } },
    voice: { speaking: false }, router: { active: true }, state: { asleep: false }, locked: false, profile: { kid: false },
    chat: { addHint(h) { hints.push(h); } }, subtitles: { caption() {} }, name: () => 'Quark',
  };
  const schedule = (fn, ms) => { const id = ++seq; timers.push({ id, at: t + ms, fn }); return id; };
  const cancel = (id) => { timers = timers.filter((x) => x.id !== id); };
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due); t = due.at; due.fn();
    }
    t = end;
  };
  const temper = createTemper(q, { schedule, cancel, now: () => t });
  return { q, temper, advance, chirps, hints, setSpeaking: (v) => { q.voice.speaking = v; }, get emotion() { return q.emotion; } };
}

// ---- 1. what counts as an insult, an apology, praise, kindness
const C = (s) => classify(s, 'Quark');
check('"you are stupid" is an insult', C('you are stupid') === 'insult');
check('"shut up" is an insult', C('shut up') === 'insult');
check('"stupid robot" is an insult', C('stupid robot') === 'insult');
check('"i am not stupid" is not an insult', C('i am not stupid') !== 'insult');
check('"my stupid brother broke my phone yesterday" is not aimed at Quark', C('my stupid brother broke my phone yesterday') !== 'insult');
check('"you are boring" is an insult', C("you're boring") === 'insult');
check('"i am sorry" is an apology', C('i am so sorry') === 'sorry');
check('"sorry lol" is a light, insincere apology', C('sorry lol') === 'sorry_light');
check('"you win" is a brag opening', C('ok you win') === 'brag');
check('"good job" is a brag opening', C('good job quark') === 'brag');
check('"i lost" is a brag opening', C('i lost again') === 'brag');
check('"i love you" is kindness', C('i love you quark') === 'kind');
check('"how was your day" is nothing special', C('how was your day') === '');
check('empty text is nothing special', C('') === '');

// ---- 2. an insult makes Quark angry, and the anger is held, then cools one step at a time
{
  const w = world();
  w.temper.onUserText('you are stupid');
  check('insult -> angry', w.emotion.name === 'angry', w.emotion.name);
  check('insult intensity is about 68', w.emotion.intensity === 68, String(w.emotion.intensity));
  check('angry has a growl for a beep', w.chirps.includes('angry'));
  check('the brain is told why', w.hints.some((h) => /insulted/.test(h)));
  w.advance(23000);
  check('still angry after 23 s (held, not snapped back)', w.emotion.name === 'angry');
  w.advance(2000);
  check('after 24 s it cools to sulky', w.emotion.name === 'sulky', w.emotion.name);
  check('cooling makes the sulky beep', w.chirps.includes('sulky'));
  w.advance(40000);                               // 41 s after the sulk began (it began at 24 s)
  check('still sulky 41 s into the sulk', w.emotion.name === 'sulky', w.emotion.name);
  w.advance(2000);
  check('then happy again after 42 s', w.emotion.name === 'happy', w.emotion.name);
}
{
  const w = world();
  w.temper.onUserText('you are stupid');
  w.advance(5000);
  w.temper.onUserText('you are dumb');
  check('a second insult while angry is stronger', w.emotion.intensity === 84, String(w.emotion.intensity));
  w.advance(23000);
  check('and restarts the clock (still angry 28 s after the first)', w.emotion.name === 'angry');
}
{
  const w = world(); w.q.profile.kid = true;
  w.temper.onUserText('you are stupid');
  check('in Kid mode anger is mild (45)', w.emotion.name === 'angry' && w.emotion.intensity === 45, String(w.emotion.intensity));
}

// ---- 3. apologies and kindness cool it down in steps
{
  const w = world();
  w.temper.onUserText('you are stupid');
  w.temper.onUserText('sorry lol');
  check('"sorry lol" does not cool Quark down', w.emotion.name === 'angry');
  w.temper.onUserText('i am really sorry');
  check('a real apology: angry -> sulky', w.emotion.name === 'sulky', w.emotion.name);
  w.temper.onUserText('i am really sorry');
  check('a second one: sulky -> happy', w.emotion.name === 'happy', w.emotion.name);
  check('happy again gives a happy beep', w.chirps.includes('happy'));
}
{
  const w = world();
  w.temper.onUserText('you are stupid');
  w.temper.onUserText('i love you quark');
  check('kindness while angry only gets to sulky', w.emotion.name === 'sulky');
}

// ---- 4. smug
{
  const w = world();
  w.temper.onUserText('ok you win');
  check('"you win" -> smug', w.emotion.name === 'smug' && w.emotion.intensity === 72, w.emotion.name + ' ' + w.emotion.intensity);
  check('smug has its own beep', w.chirps.includes('smug'));
  check('the brain is told to be smug', w.hints.some((h) => /smug/.test(h)));
  w.advance(54000);
  check('smug lasts almost a minute', w.emotion.name === 'smug');
  w.advance(2000);
  check('then fades to happy', w.emotion.name === 'happy', w.emotion.name);
}
{
  const w = world();
  w.temper.onUserText('you are stupid');
  w.temper.onUserText('good job quark');
  check('praise does not make an angry Quark smug', w.emotion.name === 'angry', w.emotion.name);
}

// ---- 5. poking
{
  const w = world();
  for (let i = 0; i < 4; i++) { w.temper.poke(); w.advance(300); }
  check('four taps are just taps', w.emotion.name === 'happy');
  w.temper.poke();
  check('the fifth quick tap makes Quark angry', w.emotion.name === 'angry', w.emotion.name);
  w.advance(20500);
  check('poke anger ends after 20 s into sulky', w.emotion.name === 'sulky', w.emotion.name);
}
{
  const w = world();
  for (let i = 0; i < 8; i++) { w.temper.poke(); w.advance(1500); }
  check('slow taps never count as poking', w.emotion.name === 'happy');
}

// ---- 6. games
{
  const w = world();
  w.temper.event('quark_won');
  check('Quark wins a game -> smug for a minute', w.emotion.name === 'smug' && w.emotion.intensity === 74);
  w.advance(59000); check('...still smug at 59 s', w.emotion.name === 'smug');
  w.advance(2000); check('...happy after', w.emotion.name === 'happy');
}
{
  const w = world();
  w.temper.event('round_lost');
  check('losing one round -> sulky', w.emotion.name === 'sulky');
  w.temper.event('round_lost');
  check('losing a second round in a row -> angry', w.emotion.name === 'angry', w.emotion.name);
  w.temper.event('round_won');
  check('winning a round -> smug', w.emotion.name === 'smug');
}
{
  const w = world();
  w.temper.event('quark_lost');
  check('losing a whole game -> angry (the tantrum)', w.emotion.name === 'angry');
}

// ---- 7. no whiplash from the brain
{
  const w = world();
  w.temper.onUserText('you are stupid');
  const a = w.temper.filterBrain({ emotion: 'happy', intensity: 80 });
  check('a calm answer cannot undo a fresh anger: it stays angry at the same strength', a.emotion === 'angry' && a.intensity === 68, JSON.stringify(a));
  const a2 = w.temper.filterBrain({ emotion: 'sulky', intensity: 50 });
  check('but the brain may cool anger one step to sulky', a2.emotion === 'sulky', JSON.stringify(a2));
  const b = w.temper.filterBrain({ emotion: 'angry', intensity: 70 });
  check('but it can stay angry', b.emotion === 'angry');
  w.advance(21000);   // 21 s after the insult: still angry, but the 20 s guard is over
  const c = w.temper.filterBrain({ emotion: 'happy', intensity: 70 });
  check('after 20 s the brain may move on to happy', w.emotion.name === 'angry' && c.emotion === 'happy', w.emotion.name + ' -> ' + c.emotion);
}
{
  const w = world();
  const x = w.temper.filterBrain({ emotion: 'smug', intensity: 60 });
  check('the brain can set smug itself', x.emotion === 'smug');
  w.temper.onUserText('you were right about that');
  const y = w.temper.filterBrain({ emotion: 'curious', intensity: 50 });
  check('a calm answer cannot erase a fresh smugness either', y.emotion === 'smug', JSON.stringify(y));
  const z = w.temper.filterBrain({ emotion: 'sad', intensity: 50 });
  check('but a real change of feeling (sad) goes through', z.emotion === 'sad');
  w.advance(21000);
  const v = w.temper.filterBrain({ emotion: 'happy', intensity: 50 });
  check('and after 20 s the brain may move on', v.emotion === 'happy');
}

// ---- 8. timers behave
{
  const w = world();
  w.temper.onUserText('you are stupid');
  w.setSpeaking(true);
  w.advance(30000);
  check('it never changes mood while Quark is mid-sentence', w.emotion.name === 'angry');
  w.setSpeaking(false);
  w.advance(3100);
  check('it cools as soon as the sentence is over', w.emotion.name === 'sulky', w.emotion.name);
}
{
  const w = world();
  w.temper.onUserText('you are stupid');
  w.q.mood.setExternally('happy');                // a pet or a kind word moved the mood on its own
  w.advance(60000);
  check('a feeling ended from outside cancels its timer (no stray cooling)', w.emotion.name === 'angry' && w.q.mood.name === 'happy');
}
{
  const w = world();
  w.q.emotion.set('smug', 60, 'chat');            // the brain (not temper) put Quark in a feeling
  w.advance(54000);
  check('a feeling the brain sets also gets a hold time (smug still there at 54 s)', w.emotion.name === 'smug');
  w.advance(2000);
  check('...and fades to happy afterwards', w.emotion.name === 'happy', w.emotion.name);
}
{
  const w = world();
  w.q.emotion.set('sulky', 60, 'reaction');       // a punch started a sulk
  w.advance(41000); check('a sulk started elsewhere lasts 42 s', w.emotion.name === 'sulky');
  w.advance(2000); check('...then it ends', w.emotion.name === 'happy', w.emotion.name);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
