// The little physical gestures the AI brain can ask for alongside a reply ("gesture": "nod", "wink"...).
// Each one is a short movement of the face, a burst of particles, or a sound; none of them lasts longer than a second or two.

import { EXPR } from './expressions.js';

/** Returns playGesture(name). Does nothing while a sequence owns the screen or Quark is asleep. */
export function createGestures(q) {
  const { face, audio } = q;
  const later = (ms, fn) => setTimeout(() => { if (!q.state.asleep) fn(); }, ms);

  const GESTURE = {
    nod() { face.impulse(0, 9, 0); later(230, () => face.impulse(0, 9, 0)); },
    shake() { [0, 1, 2].forEach((i) => later(i * 170, () => face.impulse(i % 2 ? 11 : -11, 0, 0, i % 2 ? 3 : -3))); },
    tilt() { face.impulse(0, 0, 0, 6); face.lookAt(0.5, -0.3, { ms: 900 }); },
    bounce() { face.impulse(0, -16, 0.035); audio.chirp('happy'); },
    wink() { face.express('wink', { ms: 750, key: 'gesture' }); audio.chirp('giggle'); },
    spin() { face.express('insane', { ms: 800, key: 'gesture' }); face.impulse(0, -6, 0.02, 12); later(260, () => face.impulse(0, 0, 0, -16)); },
    sparkle() { for (let i = 0; i < 3; i++) later(i * 120, () => face.burst('spark')); },
    blush() { face.express({ ...EXPR.happy, blush: 1 }, { ms: 1800, key: 'gesture' }); face.burst('heart'); },
    look_away() { face.lookAt(-0.9, 0.35, { ms: 1500 }); },
    shiver() { face.setTremble(1); later(900, () => face.setTremble(0)); face.burst('sweat'); },
    jump() { face.impulse(0, -22, 0.05); audio.chirp('excited'); },
    dance() { q.vision?.danceFor?.(3200); },
    hum() { q.idle.hum(); },
  };

  // the little noises the brain can ask for (see SOUNDS in moods.js)
  const SOUND = {
    happy: () => audio.chirp('happy'), excited: () => audio.chirp('excited'), ask: () => audio.chirp('ask'), huh: () => audio.chirp('huh'),
    giggle: () => audio.chirp('giggle'), sad: () => audio.chirp('sad'), angry: () => audio.chirp('angry'),
    sigh: () => audio.sigh(), yawn: () => audio.yawn(), startled: () => audio.startle(), hum: () => q.idle.hum(),
    smug: () => audio.chirp('smug'), sulky: () => audio.chirp('sulky'),
  };

  function playGesture(name) {
    const fn = GESTURE[name];
    if (!fn || q.state.asleep) return false;
    try { fn(); } catch (e) { console.error(e); return false; }
    return true;
  }
  playGesture.sound = (name) => {
    const fn = SOUND[name];
    if (!fn || q.state.asleep || q.profile.focus) return false;
    try { fn(); } catch (e) { console.error(e); return false; }
    return true;
  };
  return playGesture;
}
