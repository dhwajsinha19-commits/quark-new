// Hand shapes and the wave detector, with made-up landmarks and made-up wrist tracks. Run: node tests/gestures.mjs
import { readFileSync } from 'node:fs';
import { classifyHand, WaveDetector } from '../js/vision/gestures.js';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };

// ---- a hand drawn from numbers: (x, y) in palm lengths from the wrist, y up. 21 MediaPipe landmarks.
const SPREAD = { thumb: [[-0.25, 0.2], [-0.45, 0.5], [-0.65, 0.75], [-0.8, 1.0]],
  index: [[-0.3, 1.0], [-0.3, 1.45], [-0.3, 1.75], [-0.3, 1.95]], middle: [[-0.05, 1.0], [-0.05, 1.5], [-0.05, 1.82], [-0.05, 2.05]],
  ring: [[0.2, 1.0], [0.2, 1.42], [0.2, 1.7], [0.2, 1.9]], pinky: [[0.45, 0.95], [0.45, 1.3], [0.45, 1.52], [0.45, 1.7]] };
function hand({ cx = 0.5, cy = 0.7, palmY = 0.16, curl = [0, 0, 0, 0], edgeOn = false, aspect = 4 / 3 } = {}) {
  const names = ['index', 'middle', 'ring', 'pinky'];
  const pts = [[0, 0], ...SPREAD.thumb];
  names.forEach((nm, i) => {
    const f = SPREAD[nm].map(([x, y]) => [x, y]);
    if (curl[i]) { f[1] = [f[0][0], 1.0 - 0.1]; f[2] = [f[0][0], 0.75]; f[3] = [f[0][0], 0.55]; }     // finger folded back over the palm
    pts.push(...f);
  });
  return pts.map(([x, y]) => ({ x: cx + (edgeOn ? x * 0.15 : x) * palmY / aspect, y: cy - y * palmY }));
}
const open = classifyHand(hand());
ok(open.shape === 'paper' && open.n === 4, 'an open hand is paper with four fingers', JSON.stringify([open.shape, open.n]));
ok(open.upright && open.flat, 'an open hand held up is flat and upright', `flat=${open.flat} reach=${open.reach.toFixed(2)} facing=${open.facing.toFixed(2)}`);
const fist = classifyHand(hand({ curl: [1, 1, 1, 1] }));
ok(!fist.flat, 'a fist is not flat', JSON.stringify([fist.n, fist.reach.toFixed(2)]));
const three = classifyHand(hand({ curl: [0, 0, 0, 1] }));
ok(!three.flat, 'three fingers are not a flat hand', JSON.stringify([three.n]));
const side = classifyHand(hand({ edgeOn: true }));
ok(!side.flat, 'a hand seen edge-on is not flat', `facing=${side.facing.toFixed(2)}`);
const small = classifyHand(hand({ palmY: 0.07, cy: 0.5 }));
ok(small.flat, 'a far-away open hand is still flat (it is all ratios)', `reach=${small.reach.toFixed(2)} facing=${small.facing.toFixed(2)}`);

// ---- wave tracks: the hand's x over time, 25 frames a second
const FPS = 25;
function run(fn, seconds, { swing = 0.06, y = () => 0.5, det = new WaveDetector() } = {}) {
  for (let i = 0; i < seconds * FPS; i++) {
    const t = 1000 + i * (1000 / FPS);
    if (det.push(t, fn(t - 1000), y(t - 1000), swing)) return { fired: true, at: t - 1000 };
  }
  return { fired: false };
}
const sine = (hz, amp) => (ms) => 0.5 + amp * Math.sin(2 * Math.PI * hz * ms / 1000);

ok(run(sine(3, 0.1), 3).fired, 'a real wave (3 strokes a second, a hand wide) is recognised');
const w = run(sine(3, 0.1), 3);
ok(w.fired && w.at < 1800, 'and quickly, within about a second and a half', `${w.at} ms`);
ok(run(sine(2, 0.09), 3).fired, 'a slower, lazy wave still counts');
ok(!run(sine(3, 0.015), 3).fired, 'a tiny tremble is not a wave');
ok(!run(sine(0.4, 0.1), 5).fired, 'a slow sway (under one stroke a second) is not a wave');
ok(!run(sine(9, 0.1), 3).fired, 'a buzzing blur is not a wave');
ok(!run((ms) => 0.3 + 0.0001 * ms, 4).fired, 'a hand drifting across the frame is not a wave');
ok(!run((ms) => (ms < 500 ? 0.3 : 0.6), 3).fired, 'one swipe is not a wave');
ok(!run((ms) => (ms < 400 ? 0.3 : ms < 800 ? 0.6 : 0.3), 3).fired, 'a swipe there and back is not a wave');
ok(!run(sine(3, 0.1), 3, { y: (ms) => 0.5 + 0.4 * Math.sin(2 * Math.PI * 3 * ms / 1000 + 1.2) }).fired, 'a hand bobbing up and down more than across is not a wave');
ok(run(sine(3, 0.1), 3, { y: (ms) => 0.5 + 0.03 * Math.sin(2 * Math.PI * 3 * ms / 1000) }).fired, 'a wave with a little natural arc still counts');
ok(!run(sine(3, 0.1), 0.35).fired, 'a quarter of a second is not enough to call it a wave');

// ---- one wave is one event
{
  const det = new WaveDetector(); let fired = 0;
  for (let i = 0; i < 6 * FPS; i++) { const t = 1000 + i * 40; if (det.push(t, sine(3, 0.1)(t - 1000), 0.5, 0.06)) fired++; }
  ok(fired >= 1 && fired <= 2, 'six seconds of nonstop waving gives one or two events, not a stream', String(fired));
}
// reset forgets what was seen (the tracker does this when the hand stops being flat)
{
  const det = new WaveDetector();
  for (let i = 0; i < 20; i++) det.push(1000 + i * 40, sine(3, 0.1)(i * 40), 0.5, 0.06);
  det.reset();
  const r = det.push(1000 + 20 * 40, 0.5, 0.5, 0.06);
  ok(!r, 'after reset a half-finished wave does not carry over');
}
// the old code let any motion at the top of a camera-only frame count as a wave
const tracker = readFileSync(new URL('../js/vision/tracker.js', import.meta.url), 'utf8');
ok(!/waveFallback/.test(tracker) && !/topCx/.test(tracker), 'the camera-motion fallback no longer produces waves');
ok(/best\.flat/.test(tracker), 'the tracker only waves for a flat hand');

console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
