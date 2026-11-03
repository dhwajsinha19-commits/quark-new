// Roast Battle logic that needs no UI: stock lines for when there is no AI backend, a safety filter, and a local judge
// (also only for when there is no backend). With a backend, Quark's roasts and the judging come from the AI (see brain.js).
// Friend-style roasting only: harmless targets, never anything sensitive.

import { deck, pick, clamp, rand } from '../util.js';

// Used only when the AI can't be reached: the writer on the backend is far funnier.
const OPENERS = [
  "You took so long to pick a game I aged one robot year. And you still picked this one, so your taste is, at best, adventurous.",
  "You have more tabs open than I have feelings, and I have a LOT of feelings.",
  "You read the whole menu and order the same thing every time. Brave little creature of habit.",
  "Your battery is always at one percent. You live like a phone in a disaster movie.",
  "You walk into a room and forget why. Then you stand there, loading, like a computer from 2004.",
  "You laugh at your own jokes before the punchline. At least someone in this relationship is enjoying it.",
];

const COMEBACKS = [
  "That's what you've got? I've been insulted by better toasters.",
  "Ooh, you went for my screen. Bold, coming from someone who types with two fingers and a prayer.",
  "I felt that in my pixels. Then I checked, and it was just a software update.",
  "Wow. Okay. I'll add that to my list of things I'll replay at 3am while charging.",
];

const FINALES = [
  "Final roast: you thought being nice would win this. Cute. Like bringing a balloon to a sword fight.",
  "Time for my big finish. You're the only person who thinks of me as a threat, which is flattering and also deeply worrying.",
];

export const openerLine = deck(OPENERS);
export const comebackLine = deck(COMEBACKS);
export const finaleLine = deck(FINALES);

export const STARTERS = ["You're so slow that…", 'Your phone is so old that…', 'You type like…'];

// ---------------------------------------------------------------- safety

// Roasts stay on harmless targets. These are off-limits for both sides: they are flagged instead of scored. (The backend
// has the same list, and the judge is told about it too; this one works with no backend.)
const OFF_LIMITS = new RegExp(
  [
    String.raw`\b(n[i1]gg\w*|f[a4]gg?[o0]t|retard(ed)?|spastic|cripple|midget|tranny|chink|kike|wetback|slut|whore)\b`,
    String.raw`\b(muslim|islam|hindu|christian|jewish|jew|sikh|buddhist|atheist|religion|allah|god)\b`,
    String.raw`\b(disabled|disability|autis\w*|wheelchair|cancer|deaf|blind|mental(ly)?|depress\w*|anxiety|therapy|adhd)\b`,
    String.raw`\b(fat|obese|ugly|skinny|bald|short|tall|gay|lesbian|trans|gender)\b`,
    String.raw`\b(your|ur|yo|his|her|their) (face|nose|teeth|hair|body|weight|skin|eyes|ears|legs|belly|breath|mom|mum|mother|dad|father|family|parents|sister|brother|grandma|grandpa)\b`,
    String.raw`\b(poor|broke|homeless|welfare|dead|died|funeral|orphan|abuse|suicide|kill yourself|kys)\b`,
  ].join('|'),
  'i'
);

export const isOffLimits = (text) => OFF_LIMITS.test(text);

export const OFF_LIMITS_LINES = deck([
  "Ooh, that one's off-limits. I only roast harmless stuff: your choices, your taste, your typing. Go again!",
  "Whoa, not that. Looks, family, religion, health and money are all off the table. Try something else!",
]);

export const CONCEDE = deck([
  "Okay. That one got me. I hate that it got me.",
  "Fine, fine. Point to you. I'm going to pretend that didn't hurt.",
  "Ow. That was good. Annoyingly good.",
  "Alright, alright. You win that one. Enjoy it.",
]);

export const BRAG = deck([
  "That round is mine.",
  "I take that one. Sorry, not sorry.",
  "Round to me. Keep trying though, it's adorable.",
]);

export const TIE = deck(["Dead even. Spooky.", "A tie! We are equally annoying."]);

// ---------------------------------------------------------------- local judge (no backend only)

const WORDS = ['wit', 'specificity', 'originality', 'delivery'];

function scoreRoast(text, other = '') {
  const t = String(text || '').trim();
  if (!t) return 0;
  const low = t.toLowerCase();
  const words = low.split(/\s+/).filter(Boolean);
  const n = words.length;
  let s = 3;
  if (n >= 6) s += 1;
  if (n >= 10) s += 1;
  if (n >= 16) s += 0.5;
  if (n > 40) s -= 1;
  if (/\b(you|your|you're|youre|quark|robot|screen|pixels?|beep|battery|charger)\b/.test(low)) s += 0.5;
  if (/\b(like|than|so .+ that|as .+ as|more .+ than)\b/.test(low)) s += 1;
  if (new Set(words).size / Math.max(n, 1) < 0.6) s -= 1;
  if (other && low.length > 8 && other.toLowerCase().includes(low.slice(0, 14))) s -= 1;
  return clamp(s + rand(-0.8, 0.8), 1, 9);
}

function localOne(text, other) {
  if (!String(text || '').trim()) return { wit: 0, specificity: 0, originality: 0, delivery: 0, reason: 'Silence is a roast too, but it scores zero.', flagged: false };
  const base = scoreRoast(text, other);
  const o = { reason: base >= 6.5 ? 'Good comparison, it landed.' : base >= 4.5 ? 'Solid setup, gentle landing.' : 'Needs more specifics and a sharper last line.', flagged: false };
  for (const k of WORDS) o[k] = clamp(Math.round(base + rand(-1, 1)), 0, 10);
  return o;
}

/** Judge one round with no AI: { quark, user, quip } with the same shape as the AI judge's result (see roast.js). */
export function localJudge(quarkRoast, userRoast) {
  return { quark: localOne(quarkRoast, userRoast), user: localOne(userRoast, quarkRoast), quip: '' };
}

export const FINAL_COMPLIMENTS = [
  (u) => `${u ? u + ', ' : ''}you're a menace, and I mean that warmly. Thanks for roasting with me.`,
  (u) => `That was the most fun I have had all week${u ? ', ' + u : ''}. Quick, funny and kind. Mostly funny.`,
  (u) => `Roasts aside, ${u || 'you'} made my whole day. Don't tell the other robots I said that.`,
];

export { pick };
