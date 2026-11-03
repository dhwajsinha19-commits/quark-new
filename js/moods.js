// Shared by the AI brains and the emotion engine: the emotions and gestures Quark can report, and a cleaner that
// makes a reply safe to speak aloud.

// Quark's four main feelings are happy, sulky, smug and angry (see temper.js); the rest are quieter shades the brain can also use.
export const EMOTIONS = ['happy', 'excited', 'curious', 'content', 'bored', 'sleepy', 'startled', 'scared', 'sulky', 'sad', 'angry', 'smug'];
export const GESTURES = ['none', 'nod', 'shake', 'tilt', 'bounce', 'wink', 'spin', 'sparkle', 'blush', 'look_away', 'shiver', 'jump', 'dance', 'hum'];

/** Little noises Quark can make with or without words (see quark-gestures.js). */
export const SOUNDS = ['none', 'happy', 'excited', 'ask', 'huh', 'giggle', 'sad', 'angry', 'sigh', 'yawn', 'startled', 'hum', 'smug', 'sulky'];

/** Older callers (game banter) still say "mood"; it is the same list. */
export const MOODS = EMOTIONS;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/** Make a reply safe to speak aloud: no markdown, emoji, asterisks or stage directions. */
export function cleanReply(s) {
  let t = String(s || '')
    .replace(EMOJI, '')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\([^)]{0,40}\)/g, '')   // stage directions like (giggles)
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 520) {
    const cut = t.slice(0, 520);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '...';
  }
  return t;
}
