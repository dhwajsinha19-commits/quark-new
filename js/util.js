// Small shared helpers.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nowMs = () => performance.now();

/** Picks from a list at random but never the same entry twice in a row, so dialogue doesn't feel stuck. */
export function deck(list) {
  let last = -1;
  return () => {
    const n = list.length;
    if (n === 1) return list[0];
    // pick among the other n-1 entries: no retry loop, so it can never spin
    const i = last < 0 ? Math.floor(Math.random() * n) : (last + 1 + Math.floor(Math.random() * (n - 1))) % n;
    last = i;
    return list[i];
  };
}

/** "Hi {name}" -> "Hi Quark". Unknown tokens are left alone. */
export function fill(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}
