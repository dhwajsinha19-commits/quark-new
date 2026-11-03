// Chess piece artwork: simple original silhouettes in a 45x45 box, styled by CSS
// (.pc-w = Quark-cyan glowing pieces, .pc-b = deep violet pieces with a bright rim).

const BASE = '<path class="pc-base" d="M12.5 39h20v-3.4h-20z"/>';

const SHAPES = {
  p: `
    <circle cx="22.5" cy="12.8" r="5.4"/>
    <rect x="18" y="19.2" width="9" height="3" rx="1.5"/>
    <path d="M17 35.6c.5-6 3-9 4-12.6h3c1 3.6 3.5 6.6 4 12.6z"/>
    ${BASE}`,

  r: `
    <path d="M14 17.5V9h3.7v2.8h3V9h3.6v2.8h3V9H31v8.5z"/>
    <path d="M16.2 17.5h12.6l1 4.5H15.2z"/>
    <path d="M16.6 22h11.8l.8 11.5H15.8z"/>
    <path d="M13.8 33.5h17.4v2.1H13.8z"/>
    ${BASE}`,

  b: `
    <circle cx="22.5" cy="6.8" r="2.4"/>
    <path d="M22.5 8.6c4.6 3.6 6.6 8.6 4 13 1.7 1.8 2.5 4.8 1.2 8.4l2.4 5.6H14.9l2.4-5.6c-1.3-3.6-.5-6.6 1.2-8.4-2.6-4.4-.6-9.4 4-13z"/>
    <path class="pc-cut" d="M19.6 15.4l5.8 5.8"/>
    ${BASE}`,

  n: `
    <path d="M13.5 35.6c.6-3 1.6-6.4 3.2-9.2-2.6.8-5.4-.8-5.7-3.8-.4-4.3 2.5-8.5 6-11.2l-.4-4.6 3.8 2.6c6.6-1 11.8 3.6 12.3 12 .3 5.2-.2 9.6-.9 14.2z"/>
    <circle class="pc-eye" cx="18.4" cy="14.2" r="1.25"/>
    <path class="pc-cut" d="M12.4 22.4l2.6-.5"/>
    ${BASE}`,

  q: `
    <circle cx="11.4" cy="12.6" r="2.1"/><circle cx="17" cy="8.8" r="2.1"/><circle cx="22.5" cy="7.6" r="2.1"/>
    <circle cx="28" cy="8.8" r="2.1"/><circle cx="33.6" cy="12.6" r="2.1"/>
    <path d="M13.6 35.8 11.6 15l6 10 .5-14.2 4.4 13 4.4-13 .5 14.2 6-10-2 20.8z"/>
    <path d="M14.4 33.6h16.2v2.4H14.4z"/>
    ${BASE}`,

  k: `
    <path d="M20.8 3.6h3.4v3.2h3.2v3.4h-3.2v3.2h-3.4v-3.2h-3.2V6.8h3.2z"/>
    <path d="M22.5 13.4c8 3.4 10 11 8.4 22.2H14.1c-1.6-11.2.4-18.8 8.4-22.2z"/>
    <path class="pc-cut" d="M16.6 22.4q5.9-3.6 11.8 0"/>
    ${BASE}`,
};

/** An <svg> string for a piece. type: p n b r q k; color: 'w' | 'b'. */
export function pieceSvg(type, color) {
  return `<svg class="pc pc-${color}" viewBox="5.5 2.2 34 37.6" aria-hidden="true">${SHAPES[type] || ''}</svg>`;
}

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
