// Every face Quark can make, written as spring targets.
//
// Eye parameters (all in face-space units; the face is drawn in a 400x420 box):
//   W, H        outer size of the eye           Rt, Rb   corner radius at the top / bottom
//   lid         0..1 flat eyelid coming down    tilt     +angry (inner corner drops) / -sad (outer corner drops)
//   smile       0..1 morphs the eye into a happy "^" arc
//   squint      0..1 cheeks pushing the bottom up        bow  curves the eye (negative = "u", closed & content)
//   rot         degrees                         sx, sy   scale        oy  vertical offset
//   spiral      0..1 swaps the eye for a spinning spiral
//
// "inner" is the side nearest the nose; the right eye is mirrored so both eyes share one set of numbers.

export const EYE_KEYS = ['W', 'H', 'Rt', 'Rb', 'lid', 'tilt', 'smile', 'squint', 'bow', 'rot', 'sx', 'sy', 'oy', 'spiral'];
export const EYE_DEFAULT = { W: 104, H: 134, Rt: 46, Rb: 46, lid: 0, tilt: 0, smile: 0, squint: 0, bow: 0, rot: 0, sx: 1, sy: 1, oy: 0, spiral: 0 };

export const GLOBAL_KEYS = ['gap', 'eyeY', 'mouthW', 'mouthCurve', 'mouthOpen', 'mouthA', 'mouthY', 'blush', 'dim', 'tremble', 'scale'];
export const GLOBAL_DEFAULT = { gap: 156, eyeY: 170, mouthW: 26, mouthCurve: 0, mouthOpen: 0, mouthA: 0, mouthY: 278, blush: 0, dim: 1, tremble: 0, scale: 1 };

export const COLORS = {
  cyan: [82, 232, 255],
  mint: [96, 244, 230],
  aqua: [108, 255, 214],
  lime: [150, 255, 176],
  dusk: [96, 172, 224],
  deep: [78, 136, 196],
  slate: [132, 178, 206],
  sky: [120, 198, 255],
  violet: [164, 138, 255],
  blue: [98, 148, 255],
  red: [255, 108, 76],
  gold: [255, 204, 92],
  white: [226, 250, 255],
  magenta: [255, 88, 232],
};

// mouth: { W: half-width, curve: + smile / - frown, open: 0..2, A: opacity }
export const EXPR = {
  neutral: { color: COLORS.cyan },

  // the resting "I'm a happy little robot" face
  content: { color: COLORS.mint, eye: { smile: 0.1, squint: 0.06, W: 106, H: 132, Rt: 52, Rb: 50 }, blush: 0.3, mouth: { A: 0.85, curve: 5, W: 22 } },

  happy: { color: COLORS.aqua, eye: { smile: 0.85, W: 112, H: 120 }, eyeY: 176, blush: 0.8, mouth: { A: 1, curve: 10, open: 0.2, W: 28 } },
  joy: { color: COLORS.lime, eye: { smile: 1, W: 116, H: 120 }, eyeY: 176, blush: 1, mouth: { A: 1, curve: 12, open: 0.8, W: 34 }, scale: 1.02 },
  purr: { color: COLORS.aqua, eye: { smile: 0.95, W: 112, H: 120 }, eyeY: 178, blush: 1, mouth: { A: 1, curve: 9, open: 0, W: 24 }, tremble: 0.5 },
  boop: { color: COLORS.aqua, eye: { smile: 0.55, W: 106, H: 96, squint: 0.1 }, eyeY: 176, blush: 0.5, mouth: { A: 1, curve: 8, W: 18 } },

  sleepy: { color: COLORS.dusk, eye: { lid: 0.5, Rt: 16, Rb: 42, H: 124, W: 110 }, eyeY: 176, dim: 0.78, mouth: { A: 0 } },
  sleeping: { color: COLORS.deep, eye: { W: 92, H: 9, Rt: 4.5, Rb: 4.5, bow: -9 }, eyeY: 188, dim: 0.55, mouth: { A: 0 } },
  yawn: { color: COLORS.dusk, eye: { lid: 0.58, squint: 0.16, Rt: 18, Rb: 30, H: 120, W: 102 }, eyeY: 176, dim: 0.85, mouth: { A: 1, curve: -1, open: 1.7, W: 22, }, },
  bored: { color: COLORS.slate, eye: { lid: 0.36, Rt: 18, Rb: 44, H: 124, W: 108 }, eyeY: 174, dim: 0.88, mouth: { A: 0.7, curve: -1.5, W: 18 } },

  playful: { color: COLORS.sky, eye: { smile: 0.38, tilt: -0.12, rot: -5, W: 110, H: 126 }, blush: 0.5, mouth: { A: 1, curve: 12, open: 0.35, W: 36 } },
  wink: { color: COLORS.aqua, L: { smile: 0.95, W: 112, H: 120 }, R: { smile: 0.15 }, blush: 0.6, mouth: { A: 1, curve: 12, W: 28 } },
  curious: { color: COLORS.cyan, L: { H: 150, W: 108 }, R: { lid: 0.2, H: 124, tilt: 0.1 }, mouth: { A: 0.8, curve: 2, open: 0.3, W: 14 } },

  // attentive: wider eyes and a cocked head while Quark is listening to you
  listen: { color: COLORS.cyan, eye: { W: 108, H: 148, Rt: 50, Rb: 50 }, L: { rot: -4 }, R: { rot: 4 }, eyeY: 168, mouth: { A: 0 } },

  sulky: { color: COLORS.violet, eye: { lid: 0.26, tilt: -0.7, Rt: 18, Rb: 44, H: 116, W: 106 }, eyeY: 180, dim: 0.78, mouth: { A: 1, curve: -9, W: 22 } },
  sad: { color: COLORS.blue, eye: { lid: 0.14, tilt: -0.9, Rt: 18, Rb: 44, H: 126 }, eyeY: 176, dim: 0.85, mouth: { A: 1, curve: -8, W: 20 } },
  angry: { color: COLORS.red, eye: { lid: 0.1, tilt: 0.78, Rt: 12, Rb: 38, H: 112, W: 112 }, mouth: { A: 1, curve: -5, W: 30 }, tremble: 0.25 },

  // smug: heavy half-closed lids, one side lifted higher than the other, a sly little curve, a warm gold glow
  smug: { color: COLORS.gold, eye: { lid: 0.46, tilt: 0.1, squint: 0.2, Rt: 20, Rb: 46, H: 118, W: 112 }, L: { lid: 0.52 }, R: { lid: 0.34, tilt: 0.28 }, eyeY: 178, blush: 0.1, mouth: { A: 1, curve: 7, W: 24 } },

  startled: { color: COLORS.white, eye: { W: 82, H: 170, Rt: 40, Rb: 40 }, eyeY: 164, mouth: { A: 1, curve: 0, open: 1, W: 11 }, scale: 1.05 },
  // scared: wide, narrow eyes with a worried slant, a small wobbling mouth, and a constant tremble
  scared: { color: COLORS.sky, eye: { W: 90, H: 158, Rt: 44, Rb: 44, tilt: -0.55 }, eyeY: 166, dim: 0.92, mouth: { A: 1, curve: -3, open: 0.5, W: 15 }, tremble: 0.9, scale: 0.98 },
  wow: { color: COLORS.white, eye: { W: 122, H: 152, Rt: 54, Rb: 54 }, eyeY: 166, mouth: { A: 1, open: 0.6, W: 12 } },

  // "super insane": spinning spiral eyes, screaming grin
  insane: { color: COLORS.magenta, eye: { W: 116, H: 116, Rt: 58, Rb: 58, spiral: 1 }, mouth: { A: 1, curve: 14, open: 1.1, W: 50 }, tremble: 1, scale: 1.04 },
  glitch: { color: COLORS.magenta, glitchy: true, tremble: 0.4 },

  // sagging puddle eyes, used when a sulk melts away
  melt: { color: COLORS.sky, eye: { W: 138, H: 58, Rt: 26, Rb: 29 }, eyeY: 198, dim: 0.7, mouth: { A: 0 } },
};
