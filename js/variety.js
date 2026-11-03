// Keeps Quark from sounding like a broken record.
//
//   * Pet names: each nickname (and "favorite human") may be used once per session at most; repeats are removed.
//   * Repeated lines: tracks the last 20 replies so their openings and phrasing can be shown to the brain
//     ("do not reuse these"), and drops a short catchphrase that has already been said.
//
// The brain is asked not to repeat itself; this is the safety net that enforces it on the way out.

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

// Nicknames for the user. Only unambiguous ones: words like "boss" or "mate" are too often ordinary words.
const PET = [
  { key: 'favorite human', re: /\b(?:you'?re|you are)\s+my\s+favou?rite\s+human\b/i, swap: (m) => m.replace(/my\s+favou?rite\s+human/i, 'the best') },
  { key: 'favorite human', re: /,?\s*\bmy\s+favou?rite\s+human\b[,!.?]*/i, swap: () => '' },
  { key: 'favorite human', re: /,?\s*\bfavou?rite\s+human\b[,!.?]*/i, swap: () => '' },
  { key: 'champ', re: /,?\s*\bchamp\b/i, swap: () => '' },
  { key: 'buddy', re: /,?\s*\bbuddy\b/i, swap: () => '' },
  { key: 'pal', re: /,?\s*\bpal\b/i, swap: () => '' },
  { key: 'bestie', re: /,?\s*\bbestie\b/i, swap: () => '' },
  { key: 'my human', re: /,?\s*\bmy human\b/i, swap: () => '' },
  { key: 'little human', re: /,?\s*\blittle human\b/i, swap: () => '' },
  { key: 'human friend', re: /,?\s*\bhuman friend\b/i, swap: () => '' },
  { key: 'sunshine', re: /,?\s*\bsunshine\b(?=\s*[,.!?]|$)/i, swap: () => '' },
  { key: 'superstar', re: /,?\s*\bsuperstar\b/i, swap: () => '' },
];

const tidy = (s) => s.replace(/\s+([,.!?])/g, '$1').replace(/([,.!?])\1+/g, '$1').replace(/^\s*[,;]\s*/, '').replace(/\s{2,}/g, ' ').replace(/,\s*([.!?])/g, '$1').trim();

const words = (s) => new Set(norm(s).split(' ').filter(Boolean));
function jaccard(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

export function createVariety() {
  const used = new Set();       // pet names already used this session
  const replies = [];           // the last 20 whole replies
  const sentences = [];         // the last 60 sentences

  /**
   * Called on each sentence just before it is spoken. Returns the sentence to speak (pet names already used are
   * removed) or '' to skip a short catchphrase that has been said before. dedupe:false only handles pet names
   * (used for scripted lines such as reactions, where a repeated "Boop!" is fine).
   */
  function filterSentence(text, { dedupe = true } = {}) {
    let s = String(text);
    const before = new Set(used);       // what was used in earlier sentences
    const here = new Set();             // names already handled in this sentence (several patterns share one name)
    for (const p of PET) {
      if (here.has(p.key) || !p.re.test(s)) continue;
      here.add(p.key);
      if (before.has(p.key)) s = s.replace(p.re, p.swap);
      else used.add(p.key);
    }
    s = tidy(s);
    if (!s) return '';
    const n = norm(s).split(' ').length;
    if (dedupe && n <= 7 && sentences.some((x) => jaccard(x, s) >= 0.85)) return '';       // "Beep boop!" twice is one too many
    return s;
  }

  /** Remember a finished reply. */
  function record(reply) {
    const r = String(reply).trim();
    if (!r) return;
    replies.push(r);
    if (replies.length > 20) replies.shift();
    for (const s of r.split(/(?<=[.!?…])\s+/)) if (s.trim()) sentences.push(s.trim());
    while (sentences.length > 60) sentences.shift();
  }

  return {
    filterSentence,
    record,
    /** The last k replies, trimmed, for the brain to avoid repeating. */
    recentLines(k = 8) { return replies.slice(-k).map((r) => r.slice(0, 140)); },
    /** The first few words of each of the last 20 replies. */
    openings(n = 20) { return replies.slice(-n).map((r) => r.split(/\s+/).slice(0, 4).join(' ')); },
    get petNamesUsed() { return [...used]; },
    /** Has this opening been used recently? */
    repeatsOpening(text) {
      const o = norm(text).split(' ').slice(0, 3).join(' ');
      return !!o && replies.some((r) => norm(r).split(' ').slice(0, 3).join(' ') === o);
    },
    reset() { used.clear(); replies.length = 0; sentences.length = 0; },
  };
}
