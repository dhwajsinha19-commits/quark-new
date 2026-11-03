// Screen-level effects: shake, glitch bars, the SVG crack overlay, and the "screen reforms" sequence.
// (Stage 4 reuses crack() + reform() for the giant-hand smack.)

import { rand, sleep, TAU } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function ns(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

const f1 = (n) => Math.round(n * 10) / 10;

export function createFx({ world, layer, face, audio }) {
  // --- glitch bars: a few horizontal slabs that flicker around while "glitching"
  const bars = document.createElement('div');
  bars.className = 'glitch-bars';
  for (let i = 0; i < 7; i++) bars.appendChild(document.createElement('i'));
  const flashEl = document.createElement('div');
  flashEl.className = 'flash';
  const sweepEl = document.createElement('div');
  sweepEl.className = 'sweep';
  layer.append(bars, flashEl, sweepEl);

  const bootEl = document.createElement('div');
  bootEl.className = 'boot';
  bootEl.hidden = true;
  bootEl.innerHTML = '<div class="boot-title">rebooting screen…</div><div class="boot-bar"><i></i></div><div class="boot-pct">0%</div>';
  layer.appendChild(bootEl);

  let crackEl = null;
  let glitchTimer = 0;
  let glitchEnd = 0;

  function shake(level = 'med') {
    if (reduceMotion() || !world.animate) return;
    const amp = { soft: 3, med: 9, hard: 16 }[level] ?? 9;
    const frames = [];
    for (let i = 0; i < 11; i++) {
      const k = 1 - i / 11;
      frames.push({ transform: `translate(${rand(-amp, amp) * k}px, ${rand(-amp, amp) * k}px) rotate(${(rand(-0.6, 0.6) * k * amp) / 9}deg)` });
    }
    frames.push({ transform: 'none' });
    world.animate(frames, { duration: 140 + amp * 22, easing: 'linear' });
  }

  function flash(x, y, ms = 320) {
    flashEl.style.left = `${x}px`;
    flashEl.style.top = `${y}px`;
    flashEl.animate([{ opacity: 0.95, transform: 'scale(.15)' }, { opacity: 0, transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
  }

  // --- glitch: colour bars + RGB-split face for a while
  function glitch(ms = 1000) {
    glitchEnd = Math.max(glitchEnd, performance.now() + ms);
    face.setGlitch(true);
    bars.classList.add('on');
    if (glitchTimer) return;
    const tick = () => {
      if (performance.now() >= glitchEnd) {
        clearInterval(glitchTimer);
        glitchTimer = 0;
        bars.classList.remove('on');
        face.setGlitch(false);
        return;
      }
      for (const b of bars.children) {
        const show = Math.random() < 0.55;
        b.style.display = show ? 'block' : 'none';
        if (!show) continue;
        b.style.top = `${rand(0, 96)}%`;
        b.style.height = `${rand(0.3, 3.2)}%`;
        b.style.transform = `translateX(${rand(-9, 9)}%)`;
        const c = Math.random();
        b.style.background = c < 0.4 ? 'rgba(255,40,210,.16)' : c < 0.8 ? 'rgba(40,255,240,.14)' : 'rgba(255,255,255,.1)';
      }
    };
    tick();
    glitchTimer = setInterval(tick, 70);
  }

  function stopGlitch() {
    glitchEnd = 0;
    clearInterval(glitchTimer);
    glitchTimer = 0;
    bars.classList.remove('on');
    face.setGlitch(false);
  }

  // --- the crack
  function buildCrack(w, h, x, y, severity) {
    const rayCount = Math.round(7 + severity * 2.5 + rand(-1, 1));
    const maxR = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
    const base = rand(0, TAU);
    const rays = [];
    for (let i = 0; i < rayCount; i++) {
      let a = base + (i * TAU) / rayCount + rand(-0.2, 0.2);
      const reach = maxR * rand(0.38, 1.0) * (0.72 + 0.14 * severity);
      const pts = [[x, y]];
      let r = 0;
      while (r < reach) {
        r += rand(14, 44) * (1 + r / maxR);
        a += rand(-0.17, 0.17);
        pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
      }
      rays.push({ a, pts });
    }

    const rayD = [], branchD = [], ringD = [];
    const poly = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`).join('');

    for (const ray of rays) {
      rayD.push(poly(ray.pts));
      ray.pts.forEach((p, i) => {
        if (i === 0 || i === ray.pts.length - 1 || Math.random() > 0.3) return;
        const side = Math.random() < 0.5 ? -1 : 1;
        let a = ray.a + side * rand(0.4, 0.95);
        const bp = [p];
        let cx = p[0], cy = p[1];
        for (let s = 0, n = 2 + Math.floor(Math.random() * 2); s < n; s++) {
          const len = rand(18, 46);
          a += rand(-0.2, 0.2);
          cx += Math.cos(a) * len;
          cy += Math.sin(a) * len;
          bp.push([cx, cy]);
        }
        branchD.push(poly(bp));
      });
    }

    // spider-web rings joining neighbouring rays, plus broken-glass shards between them
    const levels = [0.14, 0.3, 0.5].map((k) => k * maxR * (0.75 + 0.15 * severity));
    const at = (ray, dist) => {
      let prev = ray.pts[0];
      for (const p of ray.pts) {
        const dp = Math.hypot(p[0] - x, p[1] - y);
        if (dp >= dist) {
          const dpPrev = Math.hypot(prev[0] - x, prev[1] - y);
          const t = (dist - dpPrev) / Math.max(dp - dpPrev, 1e-3);
          return [prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t];
        }
        prev = p;
      }
      return null;
    };
    const shards = [];
    levels.forEach((lv, li) => {
      for (let i = 0; i < rays.length; i++) {
        const A = at(rays[i], lv), B = at(rays[(i + 1) % rays.length], lv);
        if (!A || !B) continue;
        const mid = [(A[0] + B[0]) / 2 + rand(-9, 9), (A[1] + B[1]) / 2 + rand(-9, 9)];
        ringD.push(poly([A, mid, B]));
        const prevLv = li === 0 ? 0 : levels[li - 1];
        const A0 = li === 0 ? [x, y] : at(rays[i], prevLv);
        const B0 = li === 0 ? [x, y] : at(rays[(i + 1) % rays.length], prevLv);
        if (A0 && B0 && Math.random() < 0.7) shards.push([A0, A, mid, B, B0]);
      }
    });
    return { rayD, branchD, ringD, shards };
  }

  function crack({ x, y, severity = 1 }) {
    clearCrack();
    const w = layer.clientWidth || innerWidth, h = layer.clientHeight || innerHeight;
    const { rayD, branchD, ringD, shards } = buildCrack(w, h, x, y, severity);
    const svg = ns('svg', { class: 'crack', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' });

    const shardG = ns('g');
    for (const s of shards) {
      const p = ns('polygon', { class: 'shard', points: s.map((q) => `${f1(q[0])},${f1(q[1])}`).join(' ') });
      if (Math.random() < 0.55) p.style.transform = `translate(${f1(rand(-3, 3))}px, ${f1(rand(-3, 3))}px) rotate(${f1(rand(-1.2, 1.2))}deg)`;
      p.style.transformOrigin = `${f1(x)}px ${f1(y)}px`;
      shardG.appendChild(p);
    }
    svg.appendChild(shardG);

    // each kind of line is a group of paths with pathLength=1, so one inherited stroke-dashoffset animates them all
    const groups = {};
    const layers = [
      { stroke: 'rgba(0,0,0,.7)', width: 5.5, dx: 0 },
      { stroke: 'rgba(0,255,240,.6)', width: 1.5, dx: -1.8 },
      { stroke: 'rgba(255,40,210,.55)', width: 1.5, dx: 1.8 },
      { stroke: 'rgba(255,255,255,.95)', width: 1.2, dx: 0 },
    ];
    for (const [kind, list] of [['rings', ringD], ['branches', branchD], ['rays', rayD]]) {
      const g = ns('g', { class: 'lines' });
      for (const L of layers) {
        const sub = ns('g', { stroke: L.stroke, 'stroke-width': L.width, transform: `translate(${L.dx} 0)` });
        for (const d of list) sub.appendChild(ns('path', { d, pathLength: 1 }));
        g.appendChild(sub);
      }
      svg.appendChild(g);
      groups[kind] = g;
    }
    layer.appendChild(svg);
    crackEl = { svg, groups };

    // lines race outward from the impact
    groups.rays.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 170, fill: 'forwards', easing: 'cubic-bezier(.1,.8,.3,1)' });
    groups.branches.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 200, delay: 60, fill: 'forwards', easing: 'ease-out' });
    groups.rings.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 220, delay: 110, fill: 'forwards', easing: 'ease-out' });
    flash(x, y);
    return crackEl;
  }

  function clearCrack() {
    if (crackEl) { crackEl.svg.remove(); crackEl = null; }
  }

  /** The screen heals: shards snap back, cracks retract toward the impact, a reboot scanline sweeps down. */
  async function reform(ms = 1000) {
    const c = crackEl;
    if (!c) return;
    glitch(Math.min(ms * 0.4, 500));
    c.svg.classList.add('healing');
    const dur = ms * 0.65;
    const out = (kind, delay) => c.groups[kind].animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], { duration: dur * 0.6, delay, fill: 'forwards', easing: 'ease-in' });
    out('rings', ms * 0.1);
    out('branches', ms * 0.2);
    out('rays', ms * 0.3);
    sweepEl.animate(
      [
        { transform: 'translateY(-110%)', opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { transform: 'translateY(560%)', opacity: 1 },
      ],
      { duration: ms * 0.8, delay: ms * 0.15, easing: 'ease-in-out' }
    );
    audio?.reform(Math.min(ms / 1000, 1.4));
    // a long repair gets a little "rebooting" progress readout so the wait feels like part of the joke
    if (ms >= 2500) {
      bootEl.hidden = false;
      const bar = bootEl.querySelector('i'), pct = bootEl.querySelector('.boot-pct');
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / ms);
        const shown = Math.floor(100 * (p < 0.5 ? p * 0.8 : 0.4 + (p - 0.5) * 1.2));
        bar.style.width = `${Math.min(100, shown)}%`;
        pct.textContent = `${Math.min(100, shown)}%`;
        if (p < 1 && !bootEl.hidden) requestAnimationFrame(step);
      };
      step();
    }
    await sleep(ms);
    bootEl.hidden = true;
    if (crackEl === c) clearCrack();
    stopGlitch();
  }

  /** A burst of falling confetti for a win. */
  function confetti(n = 46, colors = ['#5ee8ff', '#ff7fae', '#ffd45e', '#8affc2', '#b99bff']) {
    if (!layer.animate || reduceMotion()) return;
    const w = layer.clientWidth || innerWidth, h = layer.clientHeight || innerHeight;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      el.className = 'confetti';
      el.style.background = colors[i % colors.length];
      el.style.left = `${rand(0, w)}px`;
      el.style.top = '-14px';
      el.style.width = `${rand(6, 11)}px`;
      el.style.height = `${rand(8, 15)}px`;
      layer.appendChild(el);
      const dx = rand(-90, 90), dur = rand(1500, 2900);
      el.animate([
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${h * rand(0.55, 0.9)}px) rotate(${rand(300, 900)}deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${dx * 1.1}px, ${h}px) rotate(1000deg)`, opacity: 0 },
      ], { duration: dur, delay: rand(0, 500), easing: 'cubic-bezier(.3,.6,.5,1)', fill: 'forwards' }).onfinish = () => el.remove();
    }
  }

  return { confetti, layer, shake, flash, glitch, stopGlitch, crack, clearCrack, reform, get cracked() { return !!crackEl; } };
}
