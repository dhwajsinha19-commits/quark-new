// face.js — Quark's face: an SVG rig driven by damped springs.
//
// An expression is only a set of target numbers (expressions.js). Every frame the rig eases the
// current numbers toward the targets, layers procedural motion on top (blink, gaze, breathing,
// talking, tremble, glitch), and rewrites only the SVG attributes that actually changed.
// Eyes, mouth, blush and spiral are separate elements, so each can be driven independently.

import { EYE_KEYS, EYE_DEFAULT, GLOBAL_KEYS, GLOBAL_DEFAULT, EXPR, COLORS } from './expressions.js';
import { clamp, lerp, rand, chance, TAU } from './util.js';
import { settings } from './storage.js';

const NS = 'http://www.w3.org/2000/svg';
const VW = 400, VH = 420;      // face coordinate box
const CX = 200, RIG_CY = 215;  // horizontal centre, and the point the whole face scales/rotates about
const GAZE_X = 26, GAZE_Y = 14;
const SIDES = ['L', 'R'];

// ---------------------------------------------------------------- spring tables

const KEYS = [];
for (const s of SIDES) for (const k of EYE_KEYS) KEYS.push(`${s}_${k}`);
KEYS.push(...GLOBAL_KEYS, 'gx', 'gy', 'jx', 'jy', 'jrot', 'js'); // gaze + jolt overlays
const N = KEYS.length;
const IDX = {};
KEYS.forEach((k, i) => { IDX[k] = i; });

// [omega (stiffness), zeta (damping; <1 overshoots a little, which is what makes it feel alive)]
const SPRING = {
  W: [22, 0.55], H: [22, 0.55], Rt: [20, 0.8], Rb: [20, 0.8],
  lid: [20, 0.75], tilt: [20, 0.7], smile: [18, 0.7], squint: [20, 0.75], bow: [20, 0.8],
  rot: [18, 0.6], sx: [26, 0.65], sy: [26, 0.65], oy: [24, 0.7], spiral: [12, 1],
  gap: [16, 0.7], eyeY: [18, 0.7],
  mouthW: [20, 0.7], mouthCurve: [20, 0.7], mouthOpen: [32, 0.8], mouthA: [10, 1], mouthY: [16, 0.7],
  blush: [8, 1], dim: [8, 1], tremble: [10, 1], scale: [20, 0.5],
  gx: [34, 0.85], gy: [34, 0.85],
  jx: [22, 0.32], jy: [22, 0.32], jrot: [20, 0.4], js: [24, 0.4],
};
const OMEGA = new Float64Array(N);
const ZETA = new Float64Array(N);
KEYS.forEach((k, i) => {
  const [w, z] = SPRING[k.replace(/^[LR]_/, '')] || [18, 0.7];
  OMEGA[i] = w;
  ZETA[i] = z;
});

// ---------------------------------------------------------------- static SVG

const SPIRAL_D = (() => {
  let d = '';
  for (let a = 0; a <= TAU * 2.7; a += 0.2) {
    const r = 3 + a * 3;
    d += `${d ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  }
  return d;
})();

const TEMPLATE = `
<defs>
  <linearGradient id="qEyeGrad" gradientUnits="userSpaceOnUse" x1="0" y1="-84" x2="0" y2="84">
    <stop id="qGradTop" offset="0" stop-color="#d6fbff"/>
    <stop id="qGradBot" offset="1" stop-color="#52e8ff"/>
  </linearGradient>
  <radialGradient id="qBlushGrad">
    <stop offset="0" stop-color="#ff7fae" stop-opacity=".9"/>
    <stop offset=".55" stop-color="#ff7fae" stop-opacity=".38"/>
    <stop offset="1" stop-color="#ff7fae" stop-opacity="0"/>
  </radialGradient>
  <filter id="qGlowEye" filterUnits="userSpaceOnUse" x="-135" y="-145" width="270" height="290" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="15" result="far"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="near"/>
    <feMerge><feMergeNode in="far"/><feMergeNode in="far"/><feMergeNode in="near"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="qGlowEyeCalm" filterUnits="userSpaceOnUse" x="-90" y="-90" width="180" height="180" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="far"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="near"/>
    <feMerge><feMergeNode in="far"/><feMergeNode in="near"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="qGlowMouth" filterUnits="userSpaceOnUse" x="-90" y="-60" width="180" height="120" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="far"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="near"/>
    <feMerge><feMergeNode in="far"/><feMergeNode in="near"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="qRgb" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb"/>
    <feOffset id="qRgbR" in="r" dx="0" dy="0" result="r2"/>
    <feOffset id="qRgbB" in="gb" dx="0" dy="0" result="gb2"/>
    <feBlend in="r2" in2="gb2" mode="screen"/>
  </filter>
</defs>
<g id="qRig">
  <ellipse id="qBlushL" rx="36" ry="21" fill="url(#qBlushGrad)" opacity="0"/>
  <ellipse id="qBlushR" rx="36" ry="21" fill="url(#qBlushGrad)" opacity="0"/>
  <g id="qEyeL">
    <path id="qShapeL" fill="url(#qEyeGrad)" filter="url(#qGlowEye)"/>
    <g id="qSpiralL" opacity="0" display="none"><g id="qSpinL"><path d="${SPIRAL_D}" fill="none" stroke="url(#qEyeGrad)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#qGlowEye)"/></g></g>
  </g>
  <g id="qEyeR">
    <path id="qShapeR" fill="url(#qEyeGrad)" filter="url(#qGlowEye)"/>
    <g id="qSpiralR" opacity="0" display="none"><g id="qSpinR"><path d="${SPIRAL_D}" fill="none" stroke="url(#qEyeGrad)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#qGlowEye)"/></g></g>
  </g>
  <path id="qMouth" filter="url(#qGlowMouth)" opacity="0"/>
  <g id="qFx"></g>
</g>`;

// ---------------------------------------------------------------- shape maths

const KAPPA = 0.5523; // cubic approximation of a circular fillet

const quadAt = (p0, c, p1, t) => {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
};

/** The piece of a quadratic bezier between parameters t0 and t1, as another quadratic. */
function subQuad(p0, c, p1, t0, t1) {
  const a = [lerp(p0[0], c[0], t1), lerp(p0[1], c[1], t1)];
  const b = quadAt(p0, c, p1, t1);
  const u = t1 > 0 ? t0 / t1 : 0;
  return {
    s: quadAt(p0, a, b, u),
    c: [lerp(a[0], b[0], u), lerp(a[1], b[1], u)],
    e: b,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * A four-cornered shape with an individual radius on each corner and an optional bow on the top and
 * bottom edges (bow > 0 bulges up, < 0 bulges down). Corners go TL, TR, BR, BL (clockwise).
 * This one routine produces every eye and the mouth.
 */
function buildShape(pts, rad, topBow, botBow) {
  const edges = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const bow = i === 0 ? topBow : i === 2 ? botBow : 0;
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    edges.push({
      p0: a, p1: b, c: [mx, my - 2 * bow],
      len: chord + (chord > 1e-3 ? (2.667 * bow * bow) / chord : 0), // arc length of a shallow parabola
    });
  }
  // how far along each edge the corner fillets start and stop
  const trims = edges.map((e, i) => {
    let ts = e.len > 1e-3 ? rad[i] / e.len : 0;
    let te = e.len > 1e-3 ? rad[(i + 1) % 4] / e.len : 0;
    const sum = ts + te;
    if (sum > 0.96) { ts *= 0.96 / sum; te *= 0.96 / sum; }
    return [ts, te];
  });
  const segs = edges.map((e, i) => subQuad(e.p0, e.c, e.p1, trims[i][0], 1 - trims[i][1]));
  let d = `M${r1(segs[0].s[0])} ${r1(segs[0].s[1])}`;
  for (let i = 0; i < 4; i++) {
    const sg = segs[i], nx = segs[(i + 1) % 4], P = pts[(i + 1) % 4];
    d += `Q${r1(sg.c[0])} ${r1(sg.c[1])} ${r1(sg.e[0])} ${r1(sg.e[1])}`;
    const c1 = [sg.e[0] + (P[0] - sg.e[0]) * KAPPA, sg.e[1] + (P[1] - sg.e[1]) * KAPPA];
    const c2 = [nx.s[0] + (P[0] - nx.s[0]) * KAPPA, nx.s[1] + (P[1] - nx.s[1]) * KAPPA];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(nx.s[0])} ${r1(nx.s[1])}`;
  }
  return d + 'Z';
}

const mix2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

function eyePath(p) {
  const W = Math.max(p.W, 6), H = Math.max(p.H, 6);
  const hw = W / 2, hh = H / 2;
  const lid = clamp(p.lid, 0, 0.92), sq = clamp(p.squint, 0, 0.92);

  let topY = -hh + lid * H;
  let botY = hh - sq * H;
  botY = Math.max(botY, topY + 6);
  const tiltAmt = 0.42 * H;
  const tIn = Math.min(topY + Math.max(p.tilt, 0) * tiltAmt, botY - 4);   // angry: inner corner drops
  const tOut = Math.min(topY + Math.max(-p.tilt, 0) * tiltAmt, botY - 4); // sad: outer corner drops

  let TL = [-hw, tOut], TR = [hw, tIn], BR = [hw, botY], BL = [-hw, botY];
  let rad = [p.Rt, p.Rt, p.Rb, p.Rb];
  let topBow = p.bow, botBow = p.bow;

  const s = clamp(p.smile, 0, 1.15);
  if (s > 0.002) {
    // happy "^": both corner pairs collapse onto a low point, and both edges bulge upward as an arc
    const yE = 0.2 * H, cap = 13, A = 0.4 * H, T = 0.1 * H, aw = hw * 0.98;
    TL = mix2(TL, [-aw, yE - cap], s);
    TR = mix2(TR, [aw, yE - cap], s);
    BR = mix2(BR, [aw, yE + cap], s);
    BL = mix2(BL, [-aw, yE + cap], s);
    rad = rad.map((r) => lerp(r, cap, Math.min(s, 1)));
    topBow = lerp(topBow, A, s);
    botBow = lerp(botBow, A - T, s);
  }
  return buildShape([TL, TR, BR, BL], rad, topBow, botBow);
}

function mouthPath(w, curve, open) {
  const th = 6;
  const o = clamp(open, 0, 2);
  const hw = Math.max(w, 3);
  const r = Math.min(th / 2 + o * hw * 0.32, hw, 14);
  return buildShape(
    [[-hw, -th / 2], [hw, -th / 2], [hw, th / 2], [-hw, th / 2]],
    [r, r, r, r],
    -curve,             // top edge: curve > 0 smiles (centre sags below the ends)
    -curve - o * 11     // bottom edge sags further as the mouth opens
  );
}

const HEART = 'M0 7C-15 -4 -11 -15 0 -7C11 -15 15 -4 0 7Z';
const SPARK = 'M0 -10L2.4 -2.4L10 0L2.4 2.4L0 10L-2.4 2.4L-10 0L-2.4 -2.4Z';
const EXCL = 'M-4.5 -26Q0 -30 4.5 -26L2.6 6L-2.6 6ZM0 13a4.6 4.6 0 1 1-.01 0Z';
const DROP = 'M0 -11C7 -2 8 4 0 8C-8 4 -7 -2 0 -11Z';

// ---------------------------------------------------------------- the rig

export function createFace(mount) {
  mount.textContent = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  svg.setAttribute('class', 'q-face');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = TEMPLATE;
  mount.appendChild(svg);

  const $ = (id) => svg.querySelector('#' + id);
  const el = {
    rig: $('qRig'), mouth: $('qMouth'), fx: $('qFx'),
    gradTop: $('qGradTop'), gradBot: $('qGradBot'), rgbR: $('qRgbR'), rgbB: $('qRgbB'),
    blush: { L: $('qBlushL'), R: $('qBlushR') },
    eye: { L: $('qEyeL'), R: $('qEyeR') },
    shape: { L: $('qShapeL'), R: $('qShapeR') },
    spiral: { L: $('qSpiralL'), R: $('qSpiralR') },
    spin: { L: $('qSpinL'), R: $('qSpinR') },
  };

  const cur = new Float64Array(N);
  const vel = new Float64Array(N);
  const tgt = new Float64Array(N);
  const col = [...COLORS.cyan];
  let colT = COLORS.cyan;
  let colKey = '';

  // ---- expression stack: a base expression (the mood) plus temporary overrides on top
  let base = 'sleeping';
  let overrides = [];
  let glitchy = false;
  let glitchExt = false;
  let calm = settings.get('faceStyle') !== 'classic';

  function flatten(def) {
    const out = {};
    const all = def.eye || {};
    for (const s of SIDES) {
      const o = { ...EYE_DEFAULT, ...all, ...(def[s] || {}) };
      for (const k of EYE_KEYS) out[`${s}_${k}`] = o[k];
    }
    const g = { ...GLOBAL_DEFAULT };
    for (const k of GLOBAL_KEYS) if (def[k] !== undefined) g[k] = def[k];
    const m = def.mouth || {};
    if (m.W !== undefined) g.mouthW = m.W;
    if (m.curve !== undefined) g.mouthCurve = m.curve;
    if (m.open !== undefined) g.mouthOpen = m.open;
    if (m.A !== undefined) g.mouthA = m.A;
    if (m.Y !== undefined) g.mouthY = m.Y;
    Object.assign(out, g);
    if (calm) restrain(out);
    return out;
  }

  /**
   * The calm face (the default; the old one is "classic"): small, flat, squarish eyes with room around them, no mouth,
   * barely any blush, like a desk robot's screen rather than a cartoon. Only these numbers change; every expression is still
   * the same set of parameters, so everything blends exactly as before.
   */
  function restrain(o) {
    for (const s of SIDES) {
      o[`${s}_W`] *= 0.62;
      o[`${s}_H`] *= 0.5;
      o[`${s}_Rt`] *= 0.42;                      // squarer corners than the classic pills
      o[`${s}_Rb`] *= 0.42;
      o[`${s}_oy`] *= 0.6;
    }
    o.gap *= 0.9;
    o.mouthA = 0;
    o.blush *= 0.15;
  }

  function apply(def) {
    const f = flatten(def);
    for (const k in f) tgt[IDX[k]] = f[k];
    colT = def.color || COLORS.cyan;
    glitchy = !!def.glitchy;
  }

  function refresh() {
    const top = overrides[overrides.length - 1];
    apply(top ? top.def : EXPR[base] || EXPR.neutral);
  }

  function currentName() {
    const top = overrides[overrides.length - 1];
    return top ? top.name : base;
  }

  /** 'calm' (small flat eyes, no mouth) or 'classic' (the big glowing pills with a mouth and blush). */
  function setStyle(name) {
    calm = name !== 'classic';
    for (const s of SIDES) {
      el.shape[s].setAttribute('filter', calm ? 'url(#qGlowEyeCalm)' : 'url(#qGlowEye)');
      el.spiral[s].firstChild && el.spiral[s].firstChild.firstChild && el.spiral[s].firstChild.firstChild.setAttribute('filter', calm ? 'url(#qGlowEyeCalm)' : 'url(#qGlowEye)');
    }
    refresh();
  }

  /** The resting expression — the mood's face. */
  function setBase(name) {
    if (!EXPR[name]) return;
    base = name;
    refresh();
  }

  /**
   * Put a temporary expression on top. ms = how long it lasts (0 = until released).
   * key lets you replace or release it later. name may be a preset name or an inline definition.
   */
  function express(nameOrDef, { ms = 0, key = null } = {}) {
    const def = typeof nameOrDef === 'string' ? EXPR[nameOrDef] : nameOrDef;
    if (!def) return { release() {} };
    if (key) overrides = overrides.filter((o) => o.key !== key);
    const o = { def, name: typeof nameOrDef === 'string' ? nameOrDef : '(custom)', key, until: ms ? performance.now() + ms : Infinity };
    overrides.push(o);
    refresh();
    return {
      release() {
        const n = overrides.length;
        overrides = overrides.filter((x) => x !== o);
        if (overrides.length !== n) refresh();
      },
    };
  }

  function release(key) {
    const n = overrides.length;
    overrides = overrides.filter((o) => o.key !== key);
    if (overrides.length !== n) refresh();
  }

  function clearOverrides() {
    overrides = [];
    refresh();
  }

  // ---- procedural layers
  let blinkAt = -1e9;
  const BLINK_MS = 170;
  function blink() { blinkAt = performance.now(); }
  function blinkOpen(ts) {
    const p = (ts - blinkAt) / BLINK_MS;
    if (p < 0 || p >= 1) return 1;
    const v = p < 0.38 ? p / 0.38 : 1 - (p - 0.38) / 0.62;
    return 1 - 0.94 * (v * v * (3 - 2 * v));
  }

  let gazePrio = 0;
  let gazeUntil = 0;
  /** Look toward (x, y) in -1..1. Higher prio wins; ms = how long to hold (0 = until replaced). */
  function lookAt(x, y, { prio = 0, ms = 0 } = {}) {
    const t = performance.now();
    if (gazeUntil && t > gazeUntil) { gazePrio = 0; gazeUntil = 0; }
    if (prio < gazePrio) return false;
    gazePrio = prio;
    gazeUntil = ms ? t + ms : 0;
    tgt[IDX.gx] = clamp(x, -1, 1);
    tgt[IDX.gy] = clamp(y, -1, 1);
    return true;
  }
  function releaseGaze(prio) {
    if (prio !== undefined && gazePrio > prio) return;
    gazePrio = 0;
    gazeUntil = 0;
    tgt[IDX.gx] = 0;
    tgt[IDX.gy] = 0;
  }

  let talkT = 0, talk = 0, pulseUntil = 0;
  const setTalking = (on) => { talkT = on ? 1 : 0; };
  const pulseMouth = () => { pulseUntil = performance.now() + 130; };

  /** Physical jolt: nudge the whole face (units ≈ face-space pixels; ds ≈ fractional scale; rot in degrees). */
  function impulse(dx = 0, dy = 0, ds = 0, rot = 0) {
    vel[IDX.jx] += dx * OMEGA[IDX.jx] * 1.3;
    vel[IDX.jy] += dy * OMEGA[IDX.jy] * 1.3;
    vel[IDX.js] += ds * OMEGA[IDX.js] * 1.3;
    vel[IDX.jrot] += rot * OMEGA[IDX.jrot] * 1.3;
  }
  /** Lean toward a point while being petted (nx, ny in -1..1). */
  function lean(nx = 0, ny = 0) {
    tgt[IDX.jx] = nx * 8;
    tgt[IDX.jy] = ny * 6;
  }

  function setGlitch(on) { glitchExt = !!on; }
  function setTremble(v) { tremExtra = v; }
  let tremExtra = 0;

  // ---- particles (hearts, zzz, sparkles, !, sweat)
  const parts = [];
  function burst(type, o = {}) {
    const text = type === 'zzz' || type === 'question';
    const node = document.createElementNS(NS, text ? 'text' : 'path');
    const eyeY = cur[IDX.eyeY];
    const p = { el: node, age: 0, life: 1.6, x: CX, y: eyeY, vx: 0, vy: 0, ay: 0, s0: 1, s1: 1, rot: 0, vr: 0, alpha: 1, pop: false };
    switch (type) {
      case 'heart':
        node.setAttribute('d', HEART); node.setAttribute('fill', '#ff7fae');
        Object.assign(p, { x: CX + rand(-100, 100), y: eyeY + rand(-70, -30), vx: rand(-10, 10), vy: -rand(26, 46), life: rand(1.7, 2.4), s0: 0.5, s1: rand(1, 1.5), vr: rand(-18, 18), alpha: 0.9 });
        break;
      case 'spark':
        node.setAttribute('d', SPARK); node.setAttribute('fill', '#fff');
        Object.assign(p, { x: CX + rand(-125, 125), y: eyeY + rand(-80, 40), vy: -rand(2, 10), life: rand(0.7, 1.1), s0: 0.2, s1: rand(0.8, 1.3), vr: rand(-60, 60), alpha: 0.95, pop: true });
        break;
      case 'exclaim':
        node.setAttribute('d', EXCL); node.setAttribute('fill', '#fff');
        Object.assign(p, { x: CX + 118, y: eyeY - 84, life: 1.0, s0: 0.2, s1: 1, rot: 12, alpha: 1, pop: true });
        break;
      case 'sweat':
        node.setAttribute('d', DROP); node.setAttribute('fill', '#bfe9ff');
        Object.assign(p, { x: CX + 116, y: eyeY - 62, vy: 10, ay: 70, life: 1.1, s0: 0.3, s1: 1.1, alpha: 0.9, pop: true });
        break;
      case 'zzz':
        node.textContent = 'Z';
        node.setAttribute('font-family', 'ui-rounded, system-ui, sans-serif');
        node.setAttribute('font-weight', '800');
        node.setAttribute('font-size', '24');
        node.setAttribute('text-anchor', 'middle');
        node.setAttribute('fill', `rgb(${col.map(Math.round).join(',')})`);
        Object.assign(p, { x: CX + 92, y: eyeY - 30, vx: 13, vy: -20, life: 3.2, s0: 0.5, s1: 1.3, rot: -8, vr: 6, alpha: 0.8 });
        break;
      case 'question':
        node.textContent = '?';
        node.setAttribute('font-family', 'ui-rounded, system-ui, sans-serif');
        node.setAttribute('font-weight', '800');
        node.setAttribute('font-size', '40');
        node.setAttribute('text-anchor', 'middle');
        node.setAttribute('fill', '#fff');
        Object.assign(p, { x: CX + 112, y: eyeY - 80, life: 1.3, s0: 0.2, s1: 1, rot: 10, pop: true });
        break;
      default: return;
    }
    Object.assign(p, o);
    node.setAttribute('opacity', '0');
    el.fx.appendChild(node);
    parts.push(p);
  }

  function stepParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.el.remove(); parts.splice(i, 1); continue; }
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const e = 1 - (1 - t) * (1 - t);
      let s = lerp(p.s0, p.s1, e);
      if (p.pop) s *= 1 + 0.35 * Math.sin(Math.min(t * 3, 1) * Math.PI) ;
      const op = (t < 0.12 ? t / 0.12 : t > 0.65 ? (1 - t) / 0.35 : 1) * p.alpha;
      p.el.setAttribute('transform', `translate(${r1(p.x)} ${r1(p.y)}) rotate(${r1(p.rot)}) scale(${s.toFixed(2)})`);
      p.el.setAttribute('opacity', op.toFixed(2));
    }
  }

  // ---- rendering
  const put = (node, attr, val) => {
    const c = node.__c || (node.__c = {});
    if (c[attr] === val) return;
    c[attr] = val;
    node.setAttribute(attr, val);
  };

  const P = { L: {}, R: {} };
  let time = 0;
  let spinAngle = 0;
  let glitchWas = false;
  const gl = { x: 0, y: 0, rot: 0, rgb: 0, flip: false, until: 0 };
  let zzzNext = 0;

  /**
   * Advance the springs by `dt` seconds in small fixed steps. If frames arrive late (a throttled
   * background tab, a hidden pane) the sim catches up in real time instead of crawling in slow motion.
   */
  function stepSprings(dt) {
    let rem = Math.min(dt, 1.2);
    while (rem > 1e-6) {
      const h = Math.min(rem, 1 / 60);
      rem -= h;
      for (let i = 0; i < N; i++) {
        const w = OMEGA[i];
        const x = cur[i] - tgt[i];
        vel[i] += (-w * w * x - 2 * ZETA[i] * w * vel[i]) * h;
        cur[i] += vel[i] * h;
      }
    }
    for (let i = 0; i < N; i++) {
      if (Math.abs(cur[i] - tgt[i]) < 1e-3 && Math.abs(vel[i]) < 1e-3) { cur[i] = tgt[i]; vel[i] = 0; }
    }
  }

  function render(ts, dt) {
    const c = cur;
    const on = glitchy || glitchExt;
    if (on !== glitchWas) {
      glitchWas = on;
      if (on) el.rig.setAttribute('filter', 'url(#qRgb)');
      else { el.rig.removeAttribute('filter'); gl.x = gl.y = gl.rot = 0; el.rgbR.setAttribute('dx', 0); el.rgbB.setAttribute('dx', 0); }
    }
    if (on) {
      if (ts > gl.until) {
        gl.until = ts + rand(40, 120);
        gl.x = chance(0.5) ? rand(-11, 11) : 0;
        gl.y = chance(0.3) ? rand(-4, 4) : 0;
        gl.rot = chance(0.2) ? rand(-2, 2) : 0;
        gl.rgb = rand(2, 11);
        gl.flip = chance(0.3);
        el.rgbR.setAttribute('dx', gl.rgb.toFixed(1));
        el.rgbB.setAttribute('dx', (-gl.rgb).toFixed(1));
      }
    }

    // colour glide (+ glitch colour flicker)
    const target = on && gl.flip ? COLORS.cyan : colT;
    const cf = 1 - Math.exp(-dt * 10);
    for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * cf;
    const ck = `${Math.round(col[0])} ${Math.round(col[1])} ${Math.round(col[2])}`;
    if (ck !== colKey) {
      colKey = ck;
      const [r, g, b] = col;
      el.gradBot.setAttribute('stop-color', `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
      el.gradTop.setAttribute('stop-color', `rgb(${Math.round(lerp(r, 255, 0.3))},${Math.round(lerp(g, 255, 0.3))},${Math.round(lerp(b, 255, 0.3))})`);
      el.mouth.setAttribute('fill', `rgb(${Math.round(lerp(r, 255, 0.2))},${Math.round(lerp(g, 255, 0.2))},${Math.round(lerp(b, 255, 0.2))})`);
      document.documentElement.style.setProperty('--eye', ck);
    }

    // whole-rig transform: breathing bob, jolt, tremble, glitch
    const trem = c[IDX.tremble] + tremExtra;
    const tx = trem ? (Math.sin(ts * 0.083) * 1.4 + (Math.random() - 0.5) * 1.6) * trem * 1.6 : 0;
    const ty = trem ? (Math.cos(ts * 0.071) * 0.9 + (Math.random() - 0.5) * 1.2) * trem * 1.6 : 0;
    const bob = Math.sin(time * 1.7) * 2.2;
    const sc = c[IDX.scale] * (1 + c[IDX.js]);
    put(el.rig, 'transform',
      `translate(${r1(c[IDX.jx] + tx + gl.x)} ${r1(c[IDX.jy] + ty + bob + gl.y)}) translate(${CX} ${RIG_CY}) rotate(${r1(c[IDX.jrot] + gl.rot)}) scale(${sc.toFixed(3)}) translate(${-CX} ${-RIG_CY})`);
    put(el.rig, 'opacity', (0.45 + 0.55 * clamp(c[IDX.dim], 0, 1)).toFixed(2));

    // talking: the mouth flaps; in the calm style (no mouth) the eyes pulse a little instead
    const flap = talk * (0.2 + 0.8 * Math.abs(Math.sin(time * 16 + Math.sin(time * 5) * 2.4))) + (ts < pulseUntil ? 0.28 * talk : 0);

    // eyes
    const gx = c[IDX.gx], gy = c[IDX.gy];
    const gap = c[IDX.gap], eyeY = c[IDX.eyeY];
    const open = blinkOpen(ts);
    const breathe = 1 + 0.012 * Math.sin(time * 1.9) + (calm ? 0.07 * flap : 0);
    let spiralShown = 0;
    for (const s of SIDES) {
      const p = P[s];
      for (const k of EYE_KEYS) p[k] = c[IDX[`${s}_${k}`]];
      put(el.shape[s], 'd', eyePath(p));
      const mirror = s === 'L' ? 1 : -1;
      const ex = CX + mirror * -gap / 2 + gx * GAZE_X;
      const ey = eyeY + p.oy + gy * GAZE_Y;
      const happy = clamp(p.smile, 0, 1);
      const blinkF = 1 - (1 - open) * (1 - happy * 0.9);       // a "^" eye doesn't blink shut
      const sx = p.sx * (1 - 0.05 * Math.abs(gx));
      put(el.eye[s], 'transform', `translate(${r1(ex)} ${r1(ey)}) scale(${(mirror * sx).toFixed(3)} ${(p.sy * blinkF * breathe).toFixed(3)}) rotate(${r1(p.rot)})`);

      const sp = clamp(p.spiral, 0, 1);
      spiralShown = Math.max(spiralShown, sp);
      put(el.shape[s], 'opacity', (1 - sp).toFixed(2));
      put(el.shape[s], 'display', sp > 0.985 ? 'none' : 'inline');
      put(el.spiral[s], 'display', sp < 0.01 ? 'none' : 'inline');
      put(el.spiral[s], 'opacity', sp.toFixed(2));
    }
    if (spiralShown > 0.01) {
      spinAngle += dt * 520;
      put(el.spin.L, 'transform', `rotate(${r1(spinAngle % 360)})`);
      put(el.spin.R, 'transform', `rotate(${r1(-spinAngle % 360)})`);
    }

    // blush
    const blush = clamp(c[IDX.blush], 0, 1.2) * (0.88 + 0.12 * Math.sin(time * 2.2));
    for (const s of SIDES) {
      const m = s === 'L' ? -1 : 1;
      put(el.blush[s], 'cx', r1(CX + m * (gap / 2 + 20) + gx * GAZE_X * 0.6));
      put(el.blush[s], 'cy', r1(eyeY + (calm ? 52 : 76) + gy * GAZE_Y * 0.5));
      put(el.blush[s], 'opacity', blush.toFixed(2));
    }

    // mouth (talking opens it and, if the expression hides it, reveals it; the calm style has none)
    const mA = calm ? 0 : Math.max(clamp(c[IDX.mouthA], 0, 1), talk);
    const mOpen = c[IDX.mouthOpen] + flap * 0.95;
    const mCurve = c[IDX.mouthCurve] + talk * (c[IDX.mouthA] < 0.5 ? 4 : 0);
    put(el.mouth, 'opacity', mA.toFixed(2));
    if (mA > 0.01) {
      put(el.mouth, 'd', mouthPath(c[IDX.mouthW] + talk * 3, mCurve, mOpen));
      put(el.mouth, 'transform', `translate(${r1(CX + gx * GAZE_X * 0.45)} ${r1(c[IDX.mouthY] + gy * GAZE_Y * 0.4)})`);
    }
  }

  // ---- main loop
  let last = performance.now();
  let raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((ts - last) / 1000, 1.2);
    last = ts;
    if (dt <= 0) return;
    time += dt;

    if (overrides.length) {
      const n = overrides.length;
      const nowT = performance.now();
      overrides = overrides.filter((o) => o.until > nowT);
      if (overrides.length !== n) refresh();
    }
    if (gazeUntil && performance.now() > gazeUntil) { gazePrio = 0; gazeUntil = 0; tgt[IDX.gx] = 0; tgt[IDX.gy] = 0; }

    talk += (talkT - talk) * (1 - Math.exp(-dt * 16));
    if (talk < 0.004) talk = 0;

    if (ts > zzzNext && currentName() === 'sleeping') { burst('zzz'); zzzNext = ts + 2600; }

    stepSprings(dt);
    stepParticles(dt);
    render(ts, dt);
  }

  // start with the springs already sitting on the starting face (no boot-up morph)
  refresh();
  for (let i = 0; i < N; i++) cur[i] = tgt[i];
  col[0] = colT[0]; col[1] = colT[1]; col[2] = colT[2];
  raf = requestAnimationFrame(frame);
  setStyle(calm ? 'calm' : 'classic');

  return {
    svg,
    setBase, express, release, clearOverrides,
    blink, lookAt, releaseGaze,
    setTalking, pulseMouth, setStyle,
    get style() { return calm ? 'calm' : 'classic'; },
    impulse, lean, burst, setGlitch, setTremble,
    get expression() { return currentName(); },
    get base() { return base; },
    get glitching() { return glitchy || glitchExt; },
    get color() { return col.map(Math.round); },
    stop() { cancelAnimationFrame(raf); },
  };
}
