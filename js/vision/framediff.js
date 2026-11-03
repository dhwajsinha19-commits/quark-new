// Cheap motion sensing on a 40x30 greyscale copy of the camera frame.
//
// It does two jobs:
//  1. It's the fallback when MediaPipe can't load: Quark can still see "something moved over there".
//  2. It watches the *edges* of the frame (the room behind you) to tell when the phone itself is being moved.
//     When the background slides as one block, the phone moved, not the person, so movement events are ignored.

const W = 40, H = 30;
const MAX_SHIFT = 6;       // cells (of 40 across): the biggest phone movement between two frames we can measure
const DIFF = 24;           // brightness change (0..255) that counts as "this cell changed"

export function createMotionSensor() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let prev = null;
  let phoneEma = 0;

  // cells that belong to the "background ring": the outer columns and the top rows
  const ring = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 5 || x >= W - 5 || y < 4) ring.push(y * W + x);

  function grey(video) {
    ctx.drawImage(video, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const g = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  }

  /** Best (dx, dy) such that cur(x, y) ≈ prev(x + dx, y + dy) over the background ring. */
  function ringShift(cur, last) {
    const sad = (dx, dy) => {
      let s = 0, n = 0;
      for (const idx of ring) {
        const x = idx % W + dx, y = ((idx / W) | 0) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        s += Math.abs(cur[idx] - last[y * W + x]);
        n++;
      }
      return n ? s / n : 1e9;
    };
    const base = sad(0, 0);
    let best = { dx: 0, dy: 0, s: base };
    for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
      for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
        if (!dx && !dy) continue;
        const s = sad(dx, dy);
        if (s < best.s) best = { dx, dy, s };
      }
    }
    // only believe a shift if it explains the change much better than "nothing moved"
    if (base < 3 || best.s > base * 0.7) return { dx: 0, dy: 0 };
    return best;
  }

  /**
   * Call once per camera frame. Returns null on the first frame, else
   * { phone, energy, cx, cy, topCx, topEnergy }: phone = the camera itself is moving;
   * energy = fraction of the picture that changed; cx/cy = where (0..1, raw camera coordinates).
   */
  function sample(video) {
    const cur = grey(video);
    const last = prev;
    prev = cur;
    if (!last) return null;

    const { dx, dy } = ringShift(cur, last);
    const shiftMag = Math.hypot(dx, dy);
    phoneEma += (shiftMag - phoneEma) * 0.5;
    const phone = phoneEma >= 1.5;

    // residual change once the global shift is taken out
    let n = 0, sx = 0, sy = 0, tn = 0, tsx = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        if (Math.abs(cur[y * W + x] - last[py * W + px]) > DIFF) {
          n++; sx += x; sy += y;
          if (y < H * 0.6) { tn++; tsx += x; }
        }
      }
    }
    return {
      phone,
      energy: n / (W * H),
      cx: n ? sx / n / W : 0.5,
      cy: n ? sy / n / H : 0.5,
      topEnergy: tn / (W * H * 0.6),
      topCx: tn ? tsx / tn / W : 0.5,
    };
  }

  return { sample, reset() { prev = null; phoneEma = 0; } };
}
