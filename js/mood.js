// Mood = which resting face Quark wears. Moods drift and react, but always find their way back to friendly.
//   happy   - the default; warm little smile            curious / excited / startled / scared / sad / angry
//   playful - squinty grin, darting eyes, winks         - set by the AI brain's emotion (see emotion.js)
//   bored   - half-lidded, sighing
//   sleepy  - drooping, yawning
//   sulky   - sad slant, turned away; only ends via a pet, a kind word or a timeout (see reactions.js)
//   smug    - half-lidded, one eye higher, glancing aside: pleased with itself (set by temper.js and the brain)
//   angry   - red, slanted, trembling (temper.js, punches, the brain)
//   asleep  - eyes closed, zzz

const FACE = {
  happy: 'content',
  playful: 'playful',
  bored: 'bored',
  sleepy: 'sleepy',
  sulky: 'sulky',
  asleep: 'sleeping',
  curious: 'curious',
  excited: 'joy',
  startled: 'startled',
  scared: 'scared',
  sad: 'sad',
  angry: 'angry',
  smug: 'smug',
};

// the mood that stands for each emotion, and back again for moods set by touch and idle life
export const MOOD_OF = { happy: 'happy', excited: 'excited', curious: 'curious', content: 'happy', bored: 'bored', sleepy: 'sleepy', startled: 'startled', scared: 'scared', sulky: 'sulky', sad: 'sad', angry: 'angry', smug: 'smug' };
export const EMOTION_OF = { happy: ['content', 35], playful: ['excited', 50], bored: ['bored', 50], sleepy: ['sleepy', 55], sulky: ['sulky', 65], asleep: ['sleepy', 85], curious: ['curious', 50], excited: ['excited', 60], startled: ['startled', 60], scared: ['scared', 60], sad: ['sad', 60], angry: ['angry', 60], smug: ['smug', 60] };

// moods that only a pet, a kind word, the brain or a timeout can end (a plain "be happy again" call is ignored)
const HELD = new Set(['sulky', 'sad', 'angry', 'scared']);

export function createMood(q) {
  let name = 'asleep';
  let face = FACE.asleep;
  let since = performance.now();
  const listeners = [];
  q.state.asleep = true;

  /**
   * Change mood. A sulk (or sadness, anger, fear) can only be left with {force:true} (pets, kind words and timeouts do that).
   * `expression` overrides the resting face (the emotion model picks a stronger or softer face by intensity).
   */
  function set(next, { force = false, expression = '' } = {}) {
    if (!FACE[next]) return false;
    const nextFace = expression || FACE[next];
    if (next === name) {
      if (expression && expression !== face) { face = expression; q.face.setBase(face); }   // same mood, different intensity
      return false;
    }
    if (HELD.has(name) && !force) return false;
    name = next;
    face = nextFace;
    since = performance.now();
    q.state.asleep = next === 'asleep';
    q.face.setBase(face);
    for (const fn of listeners) { try { fn(next); } catch (e) { console.error(e); } }
    return true;
  }

  return {
    set,
    is: (...names) => names.includes(name),
    get name() { return name; },
    get since() { return since; },
    onChange(fn) { listeners.push(fn); },
  };
}
