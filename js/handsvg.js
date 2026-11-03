// Quark's digital hand: a glowing robot hand built from capsules, drawn as SVG.
// Poses: 'open' (also paper), 'fist' (rock), 'scissors', 'thumbsup', 'point'.
// It waves back at you and high-fives now; the games stage reuses it for the rock-paper-scissors reveal
// and the giant screen-smacking hand.

const NS = 'http://www.w3.org/2000/svg';

// finger columns on the palm: x centre, length when extended, width
const FINGERS = [
  { x: 66, len: 88, w: 24 },   // index
  { x: 94, len: 100, w: 24 },  // middle
  { x: 122, len: 90, w: 24 },  // ring
  { x: 148, len: 70, w: 22 },  // pinky
];
const PALM = { x: 46, y: 124, w: 108, h: 112, r: 40 };

function rect(x, y, w, h, r, rot) {
  const e = document.createElementNS(NS, 'rect');
  e.setAttribute('x', x); e.setAttribute('y', y);
  e.setAttribute('width', w); e.setAttribute('height', h);
  e.setAttribute('rx', r);
  if (rot) e.setAttribute('transform', `rotate(${rot} ${x + w / 2} ${y + h / 2})`);
  return e;
}

/** The shapes (as rects) that make up a pose. */
function shapes(pose) {
  const out = [rect(PALM.x, PALM.y, PALM.w, PALM.h, PALM.r)];
  const ext = { open: [1, 1, 1, 1], fist: [0, 0, 0, 0], scissors: [1, 1, 0, 0], thumbsup: [0, 0, 0, 0], point: [1, 0, 0, 0] }[pose] || [1, 1, 1, 1];
  FINGERS.forEach((f, i) => {
    if (ext[i]) {
      const spread = pose === 'scissors' ? (i === 0 ? -9 : 9) : 0;
      out.push(rect(f.x - f.w / 2, PALM.y + 14 - f.len, f.w, f.len + 28, f.w / 2, spread));
    } else out.push(rect(f.x - f.w / 2, PALM.y - 16, f.w, 52, f.w / 2)); // a curled finger is just a knuckle bump
  });
  if (pose === 'open') out.push(rect(14, 150, 24, 84, 12, -42));            // thumb out to the side
  else if (pose === 'thumbsup') out.push(rect(26, 54, 28, 116, 14));        // thumb straight up
  else if (pose === 'scissors' || pose === 'point') out.push(rect(56, 176, 66, 24, 12)); // thumb tucked across the palm
  else out.push(rect(52, 160, 72, 26, 13));                                 // thumb folded over the fist
  return out;
}

/** A hand sprite you can drop into any layer. Returns { el, setPose }. */
export function createHand(pose = 'open') {
  const el = document.createElement('div');
  el.className = 'hand-sprite';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 250');
  el.appendChild(svg);

  function draw(p) {
    svg.textContent = '';
    const all = shapes(p);
    const pass = (cls) => {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', cls);
      all.forEach((s) => g.appendChild(s.cloneNode()));
      svg.appendChild(g);
    };
    pass('hand-line');   // glowing outline of every part
    pass('hand-cover');  // opaque fill hides the lines where parts overlap, leaving a clean outer outline
    pass('hand-tint');   // a faint glow tint inside
  }
  draw(pose);
  return { el, setPose: draw };
}
