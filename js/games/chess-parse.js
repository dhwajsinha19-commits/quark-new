// Turns what a person says or types ("e4", "knight to f3", "e2 to e4", "castle kingside", "pawn takes d5") into a
// legal move. Speech recognisers mangle chess ("e for", "night f three"), so this is forgiving.
// Pure functions over a chess.js position; no DOM.

const NUM = { one: '1', won: '1', two: '2', too: '2', to2: '2', three: '3', tree: '3', four: '4', for: '4', fore: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8' };
const FILE_WORD = { alpha: 'a', bee: 'b', be: 'b', see: 'c', sea: 'c', dee: 'd', eff: 'f', gee: 'g', age: 'h', aitch: 'h' };
const PIECE_WORD = { king: 'k', queen: 'q', rook: 'r', castle: 'r', bishop: 'b', knight: 'n', night: 'n', horse: 'n', pawn: 'p' };
const PIECE_NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

const norm = (s) => s.toLowerCase().replace(/[+#x=:\-]/g, '').replace(/\s+/g, '');

/**
 * @returns {{type:'move', move:object, promotionAsked:boolean}
 *         | {type:'ambiguous', options:object[]}
 *         | {type:'resign'} | null}
 */
export function parseUserMove(raw, chess) {
  let t = String(raw || '').toLowerCase().replace(/[.,!?;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^(i )?(resign|give up|i give up|quit)\b|\bi resign\b/.test(t)) return { type: 'resign' };

  const legal = chess.moves({ verbose: true });

  // castling
  if (/\b(castle|castles|castling)\b|^o-?o\b|^0-?0\b/.test(t) && !/\bcastle (to|on)\b/.test(t)) {
    const queenside = /queen|long|o-?o-?o|0-0-0/.test(t);
    const m = legal.find((x) => x.flags.includes(queenside ? 'q' : 'k'));
    if (m) return { type: 'move', move: m, promotionAsked: false };
    return null;                                                   // that castle isn't legal right now: never guess another move
  }

  // spoken numbers and letter names -> digits and files; then glue "e 4" into "e4"
  t = t.split(' ').map((w) => FILE_WORD[w] || NUM[w] || w).join(' ');
  t = t.replace(/\b([a-h])\s*([1-8])\b/g, '$1$2');
  t = t.replace(/\b(?:move|play|go|i play|i'll play|let's play|lets play|my move is|pawn to|please|quark)\b/g, ' ').replace(/\s+/g, ' ').trim();

  // 1) it already looks like standard notation: "nf3", "exd5", "o-o", "e8=q"
  const key = norm(t);
  const bySan = legal.filter((m) => norm(m.san) === key);
  if (bySan.length === 1) return { type: 'move', move: bySan[0], promotionAsked: false };

  // 2) coordinates and an optional piece word. A piece word before the last square names the mover ("knight f3");
  //    one after it is a promotion choice ("a8 queen", "promote to bishop").
  const coords = t.match(/[a-h][1-8]/g) || [];
  const lastAt = coords.length ? t.lastIndexOf(coords[coords.length - 1]) : -1;
  const firstPiece = (str) => {
    let best = null, at = Infinity;
    for (const w of Object.keys(PIECE_WORD)) {
      const m = new RegExp(`\\b${w}s?\\b`).exec(str);
      if (m && m.index < at) { best = PIECE_WORD[w]; at = m.index; }
    }
    return best;
  };
  const wantPiece = coords.length ? firstPiece(t.slice(0, lastAt)) : firstPiece(t);
  const after = firstPiece(coords.length ? t.slice(lastAt + 2) : '');
  const promoLetter = after && after !== 'k' && after !== 'p' ? after : null;

  const finish = (m) => {
    if (!m) return null;
    if (m.promotion) {
      const asked = !!promoLetter;
      const chosen = promoLetter ? legal.find((x) => x.from === m.from && x.to === m.to && x.promotion === promoLetter) : legal.find((x) => x.from === m.from && x.to === m.to && x.promotion === 'q');
      return { type: 'move', move: chosen || m, promotionAsked: asked };
    }
    return { type: 'move', move: m, promotionAsked: false };
  };

  if (coords.length >= 2) {
    const [from, to] = [coords[0], coords[1]];
    const m = legal.find((x) => x.from === from && x.to === to);
    if (m) return finish(m);
  }
  if (coords.length >= 1) {
    const to = coords[coords.length - 1];
    let cands = legal.filter((x) => x.to === to && (wantPiece ? x.piece === wantPiece : x.piece === 'p'));
    if (!cands.length && !wantPiece) cands = legal.filter((x) => x.to === to);           // "e4" said for a piece move
    if (!cands.length && wantPiece && wantPiece !== 'p') cands = legal.filter((x) => x.to === to && x.piece === 'p' && x.promotion === wantPiece);  // "a8 queen" said before the square
    if (cands.length === 1) return finish(cands[0]);
    if (cands.length > 1) {
      // several promotion choices of the same move are one move; otherwise it's genuinely ambiguous
      const uniq = new Map(cands.map((c) => [`${c.from}${c.to}`, c]));
      if (uniq.size === 1) return finish(cands[0]);
      return { type: 'ambiguous', options: [...uniq.values()] };
    }
  }
  return null;
}

/** "Knight takes e5, check!" */
export function speakMove(m) {
  if (m.flags.includes('k')) return 'Castles kingside' + suffix(m);
  if (m.flags.includes('q')) return 'Castles queenside' + suffix(m);
  const who = PIECE_NAME[m.piece];
  const cap = m.captured ? ' takes' : ' to';
  const promo = m.promotion ? `, promotes to ${PIECE_NAME[m.promotion]}` : '';
  const name = who.charAt(0).toUpperCase() + who.slice(1);
  return `${name}${cap} ${m.to}${promo}${suffix(m)}`;
}
const suffix = (m) => (m.san.includes('#') ? ', checkmate!' : m.san.includes('+') ? ', check!' : '');

export { PIECE_NAME };
