// Chess against Quark.
//
//   rules + move checking : chess.js          Quark's moves : Stockfish at a casual level (chess-engine.js)
//   your moves            : tap the board, say them, or type them ("e4", "knight to f3", "e2 to e4")
//   banter                : Gemini (or local lines) writes the chatter, never the moves
//
// Quark answers each move out loud and on the board, teases mistakes (gently), and finishes with a warm "good game":
// a win dance if it wins, the giant-hand tantrum if you beat it.

import { Chess } from '../../vendor/chess/chess.js';
import { createEngine } from './chess-engine.js';
import { parseUserMove, speakMove, PIECE_NAME } from './chess-parse.js';
import { pieceSvg } from './pieces.js';
import { load, save } from '../storage.js';
import { deck, pick, chance } from '../util.js';
import { gameShell, el, wait } from './shell.js';

const FILES = 'abcdefgh';

const LINES = {
  blunder: deck([
    'Ooh. Did you mean to leave that there? ...I am not complaining.',
    'Interesting choice. Very brave. Very free-piece-for-me.',
    'Oops! Was that a gift? Thank you! ...You will get me next time, I believe in you.',
  ]),
  mistake: deck(['Hmm, I think I like that move. For me.', 'Ooh, a little wobbly. Careful now, champ.', 'That felt like a sneaky mistake. I noticed. I am noticing a lot.']),
  great: deck(['Ooh, nice move! I did not see that coming. ...Okay I did, but I am impressed.', 'Wow. Sneaky! Good move, human.', 'Hey! That was good. Stop being good. ...Do not stop.']),
  checkOnUser: deck(['Check! Careful, your king looks nervous.', 'Check! Your king is sweating. Mine is relaxed.']),
  checkByUser: deck(['Hey! You checked me! Rude. ...And impressive.', 'Check?! Okay okay, I see you.']),
  lostQueen: deck(['My queen! Noooo! ...Okay fine, that was a good capture.', 'Not the queen! She was my favorite piece. ...Hmm. I will recover.']),
  tookQueen: deck(['I took your queen! Sorry, not sorry. Hehe.', 'Queen captured! I will give her back. ...No I will not.']),
  slow: (s, piece) => `You took ${s} seconds to move a ${piece}. Did you fall asleep? ...Just kidding, take all the time you need.`,
  illegal: deck(["Hmm, that move is not legal. Try another one!", 'My rulebook says no. Try a different move!']),
  wait: deck(["Hold on, it's my turn! I am thinking really hard.", 'Patience! The robot is cooking.']),
};

export function mount(q, layer, ctx) {
  const shell = gameShell(layer, { title: 'Chess', onBack: ctx.exit });
  const appEl = document.getElementById('app');
  appEl.style.setProperty('--face-h', 'clamp(92px, 15dvh, 128px)');   // the board needs the room
  q.face.express('content', { key: 'game' });

  const engine = createEngine();
  engine.warm();                 // start Stockfish while the player picks a side

  let chess = new Chess();
  let userColor = 'w';
  let flip = false;
  let phase = 'setup';           // setup | play | over
  let busy = false;              // Quark is thinking / animating
  let dead = false;
  let selected = null;
  let targets = new Map();
  let lastMove = null;
  let turnStart = 0;
  let lastQScore = null;         // Quark's own evaluation after its previous move (its point of view)
  let lastBanterPly = -10;
  let ui = null;
  const pieceEls = new Map();    // square -> element

  const say = (t, o) => (dead ? Promise.resolve(false) : q.say(t, o));
  const myTurn = () => phase === 'play' && !busy && chess.turn() === userColor;

  // ------------------------------------------------------------------ setup
  function showSetup() {
    phase = 'setup';
    shell.setScore('');
    shell.body.innerHTML = '';
    const rec = load('chessStats', null);
    const card = el('div', 'g-card', `
      <h3>Chess</h3>
      <p>Play ${q.name()}. Tap pieces, or say or type your moves like “e4” or “knight to f3”. ${q.name()} plays casually, so it is beatable.</p>
      <div class="g-row">
        <button class="g-btn primary" type="button" data-c="w">Play White</button>
        <button class="g-btn primary" type="button" data-c="b">Play Black</button>
      </div>
      <div class="g-row" style="margin-top:10px"><button class="g-btn" type="button" data-c="r">Let ${q.name()} choose</button></div>
      ${rec ? `<p class="g-note" style="margin:12px 0 0">Your record: ${rec.w} wins · ${rec.l} losses · ${rec.d} draws</p>` : ''}`);
    shell.body.appendChild(card);
    card.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { q.audio.unlock(); q.voice.unlock(); startGame(b.dataset.c); }));
    q.idle.poke();
    say(`Chess! Do you want white, black, or should I choose?`, { tone: 'happy' });
  }

  function startGame(choice) {
    userColor = choice === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : choice;
    if (choice === 'r') q.say(userColor === 'w' ? 'I chose... you are white! You go first.' : 'I chose... you are black! I will go first.', { tone: 'excited' });
    flip = userColor === 'b';
    chess = new Chess();
    lastMove = null;
    selected = null;
    lastQScore = null;
    lastBanterPly = -10;
    phase = 'play';
    buildBoard();
    paint();
    shell.setScore(`You: ${userColor === 'w' ? 'White' : 'Black'}`);
    q.face.express('content', { key: 'game' });
    if (chess.turn() !== userColor) quarkMove();
    else beginUserTurn();
  }

  // ------------------------------------------------------------------ the board
  function buildBoard() {
    shell.body.innerHTML = '';
    const wrap = el('div', 'chess-wrap', `
      <div class="chess-bar"><div class="chess-status" aria-live="polite"></div><div class="chess-actions"><button class="chip-btn" type="button" data-resign>Resign</button></div></div>
      <div class="chess-board"><div class="chess-grid"></div><div class="chess-pieces"></div><div class="chess-promo" hidden></div></div>
      <div class="g-note chess-help">Tap a piece, or say or type a move</div>`);
    shell.body.appendChild(wrap);
    const grid = wrap.querySelector('.chess-grid');
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const f = flip ? 7 - col : col;
        const r = flip ? row : 7 - row;
        const sq = FILES[f] + (r + 1);
        const d = el('div', `sq ${(f + r) % 2 ? 'l' : 'd'}`);
        d.dataset.sq = sq;
        if (col === 0) d.appendChild(el('i', 'rk', String(r + 1)));
        if (row === 7) d.appendChild(el('i', 'fl', FILES[f]));
        d.addEventListener('click', () => onSquare(sq));
        grid.appendChild(d);
      }
    }
    ui = {
      wrap, grid,
      pieces: wrap.querySelector('.chess-pieces'),
      status: wrap.querySelector('.chess-status'),
      promo: wrap.querySelector('.chess-promo'),
    };
    wrap.querySelector('[data-resign]').addEventListener('click', () => { if (phase === 'play') resign(); });
    pieceEls.clear();
    syncPieces(false);
  }

  const posOf = (sq) => {
    const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    return { x: flip ? 7 - f : f, y: flip ? r : 7 - r };
  };
  const place = (node, sq) => { const p = posOf(sq); node.style.transform = `translate(${p.x * 100}%, ${p.y * 100}%)`; node.dataset.sq = sq; };

  /** Make the DOM pieces match the position. Existing pieces on the right squares are kept (so moves can animate). */
  function syncPieces() {
    const want = new Map();
    for (const row of chess.board()) for (const p of row) if (p) want.set(p.square, p);
    for (const [sq, node] of [...pieceEls]) {
      const p = want.get(sq);
      if (!p || node.dataset.kind !== p.color + p.type) { node.remove(); pieceEls.delete(sq); }
    }
    for (const [sq, p] of want) {
      if (pieceEls.has(sq)) continue;
      const node = el('div', 'chess-piece', pieceSvg(p.type, p.color));
      node.dataset.kind = p.color + p.type;
      place(node, sq);
      ui.pieces.appendChild(node);
      pieceEls.set(sq, node);
    }
  }

  /** Apply a chess.js move result to the DOM with a slide animation. */
  function animateMove(m) {
    const mover = pieceEls.get(m.from);
    if (m.captured && !m.flags.includes('e')) { const dead = pieceEls.get(m.to); if (dead) { dead.remove(); pieceEls.delete(m.to); } }
    if (mover) {
      pieceEls.delete(m.from);
      pieceEls.set(m.to, mover);
      place(mover, m.to);
    }
    // castling rook, en passant victim and promotions are fixed up by the diff
    setTimeout(() => { if (!dead) syncPieces(); }, 260);
  }

  function paint() {
    const kingSq = chess.inCheck() ? chess.board().flat().find((p) => p && p.type === 'k' && p.color === chess.turn())?.square : null;
    ui.grid.querySelectorAll('.sq').forEach((d) => {
      const sq = d.dataset.sq;
      d.classList.toggle('sel', sq === selected);
      d.classList.toggle('last', !!lastMove && (sq === lastMove.from || sq === lastMove.to));
      d.classList.toggle('check', sq === kingSq);
      const t = targets.get(sq);
      d.classList.toggle('dot', !!t && !t.captured);
      d.classList.toggle('cap', !!t && !!t.captured);
    });
    if (phase === 'play') {
      ui.status.textContent = chess.inCheck() ? (chess.turn() === userColor ? 'Check! Your move' : `Check on ${q.name()}`) : busy ? `${q.name()} is thinking…` : chess.turn() === userColor ? 'Your move' : `${q.name()}'s move`;
      ui.status.classList.toggle('warn', chess.inCheck());
    }
  }

  // ------------------------------------------------------------------ playing
  function beginUserTurn() { turnStart = performance.now(); paint(); }

  function onSquare(sq) {
    if (!myTurn()) return;
    const hit = targets.get(sq);
    if (selected && hit) {
      const moves = chess.moves({ square: selected, verbose: true }).filter((m) => m.to === sq);
      if (moves.length > 1 || (moves[0] && moves[0].promotion)) return askPromotion(moves);
      return playUser(moves[0]);
    }
    const piece = chess.get(sq);
    if (piece && piece.color === userColor) {
      selected = sq;
      targets = new Map(chess.moves({ square: sq, verbose: true }).map((m) => [m.to, m]));
      q.audio.blip(820);
    } else { selected = null; targets = new Map(); }
    paint();
  }

  function askPromotion(moves) {
    const box = ui.promo;
    box.hidden = false;
    box.innerHTML = '<div class="promo-title">Promote to</div><div class="promo-row"></div>';
    const row = box.querySelector('.promo-row');
    for (const t of ['q', 'r', 'b', 'n']) {
      const b = el('button', 'promo-btn', pieceSvg(t, userColor));
      b.type = 'button';
      b.setAttribute('aria-label', PIECE_NAME[t]);
      b.addEventListener('click', () => { box.hidden = true; playUser(moves.find((m) => m.promotion === t)); });
      row.appendChild(b);
    }
  }

  async function playUser(m) {
    if (!m || !myTurn()) return;
    const secs = Math.round((performance.now() - turnStart) / 1000);
    const move = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    selected = null;
    targets = new Map();
    lastMove = move;
    animateMove(move);
    sounds(move);
    q.idle.poke();
    paint();
    q.chat.addHint(`chess: the user played ${move.san}`);
    if (await finishIfOver('user', move)) return;
    // the spec's favorite tease: a very slow pawn move
    if (secs > 40) {
      const piece = PIECE_NAME[move.piece];
      q.say(LINES.slow(secs, piece), { tone: 'happy' });
    }
    if (move.captured === 'q' && chance(0.9)) q.say(LINES.tookQueen(), { tone: 'sad' });
    quarkMove(move);
  }

  function sounds(m) {
    q.audio.blip(m.captured ? 300 : 760);
    if (m.captured) q.audio.thump(0.8);
    q.haptics.pulse('tap');
  }

  async function quarkMove(userMove) {
    if (dead || phase !== 'play') return;
    busy = true;
    paint();
    q.face.express('curious', { key: 'game' });
    q.face.lookAt(0, 0.5, { prio: 1, ms: 0 });
    const t0 = performance.now();
    const mv = await engine.think(chess.fen(), { plyCount: chess.history().length });
    // a little pause so Quark seems to be thinking, not reflexing
    const left = 950 - (performance.now() - t0);
    if (left > 0) await wait(left);
    if (dead || phase !== 'play') return;

    // how good was the user's move? (Quark's best line now vs what it expected after its own last move)
    let loss = null;
    if (mv && typeof mv.bestScore === 'number' && lastQScore != null && mv.source === 'stockfish') loss = mv.bestScore - lastQScore;

    let m = mv ? chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' }) : null;
    if (!m) { const any = chess.moves({ verbose: true }); if (any.length) m = chess.move(any[Math.floor(Math.random() * any.length)]); }
    if (!m) { busy = false; return finishIfOver('quark', null); }
    lastQScore = mv && typeof mv.score === 'number' ? mv.score : null;
    lastMove = m;
    busy = false;
    animateMove(m);
    sounds(m);
    paint();
    q.face.releaseGaze(1);
    q.face.express(m.captured ? 'joy' : 'content', { ms: 1400, key: 'game' });
    q.chat.addHint(`chess: ${q.name()} played ${m.san}`);

    const over = await finishIfOver('quark', m);
    if (over) return;
    beginUserTurn();

    // say the move, then maybe a line of banter
    let line = speakMove(m);
    await say(line, { tone: 'happy' });
    if (dead || phase !== 'play') return;
    maybeBanter(m, loss, userMove);
  }

  /** One short reaction per few moves, never spammy. Uses the AI brain if there is one. */
  async function maybeBanter(m, loss, userMove) {
    const ply = chess.history().length;
    let kind = null, event = '';
    if (chess.inCheck()) { kind = 'checkOnUser'; event = `Chess: you just put the user's king in check with ${m.san}. Say "check" playfully.`; }
    else if (userMove && userMove.san.includes('+')) { kind = 'checkByUser'; event = `Chess: the user just checked your king with ${userMove.san}. React with mock outrage and a little respect.`; }
    else if (userMove && userMove.captured === 'q') { kind = 'lostQueen'; event = 'Chess: the user just captured your queen. Throw a short funny gasp, then take it well.'; }
    else if (loss != null && loss > 320 && ply - lastBanterPly > 2) { kind = 'blunder'; event = 'Chess: the user just made a big blunder and gave you material. Tease them lightly about it, then be warm and encouraging.'; }
    else if (loss != null && loss > 160 && ply - lastBanterPly > 4 && chance(0.55)) { kind = 'mistake'; event = 'Chess: the user made a small mistake. Give a short playful tease, then be encouraging.'; }
    else if (loss != null && loss < -170 && ply - lastBanterPly > 4 && chance(0.6)) { kind = 'great'; event = 'Chess: the user just played a strong move that surprised you. Compliment it genuinely, in a playful way.'; }
    if (!kind) return;
    lastBanterPly = ply;
    const fb = LINES[kind];
    const r = await Promise.race([q.chat.banter(event, fb, 'playful'), wait(2600).then(() => null)]);
    if (dead || phase !== 'play' || !r) { if (!dead && phase === 'play') say(fb(), { tone: 'happy' }); return; }
    say(r.reply, { tone: 'happy' });
  }

  async function finishIfOver(side, m) {
    if (!chess.isGameOver()) return false;
    phase = 'over';
    busy = false;
    paint();
    if (chess.isCheckmate()) await endGame(side === 'user' ? 'user' : 'quark', 'checkmate');
    else await endGame('draw', chess.isStalemate() ? 'stalemate' : chess.isThreefoldRepetition() ? 'repetition' : chess.isInsufficientMaterial() ? 'material' : 'draw');
    return true;
  }

  function resign() {
    if (phase !== 'play') return;
    phase = 'over';
    endGame('quark', 'resign');
  }

  async function endGame(result, why) {
    const rec = load('chessStats', { w: 0, l: 0, d: 0 });
    if (result === 'user') rec.w++; else if (result === 'quark') rec.l++; else rec.d++;
    save('chessStats', rec);
    ui.status.textContent = result === 'draw' ? `Draw (${why})` : result === 'user' ? 'Checkmate! You win' : why === 'resign' ? 'You resigned' : `Checkmate! ${q.name()} wins`;
    ui.status.classList.add('warn');
    selected = null; targets = new Map(); paint();

    if (result === 'user') {
      await say('Checkmate! ...You got me.', { tone: 'sad' });
      if (dead) return;
      await q.endings.loseTantrum({ praise: false });
      if (dead) return;
      await say('Good game. Really. That was a great game, you are good at this.', { tone: 'happy' });
    } else if (result === 'quark') {
      if (why === 'resign') await say('Good game! Thanks for playing. Rematch whenever you want.', { tone: 'happy' });
      else await q.endings.winDance();
      if (dead) return;
      if (why !== 'resign') await say('Good game, though! You made me think. A little.', { tone: 'happy' });
    } else {
      q.face.express('joy', { ms: 2500, key: 'game' });
      for (let i = 0; i < 3; i++) setTimeout(() => q.face.burst('heart'), i * 130);
      await say(why === 'stalemate' ? 'Stalemate! Nobody wins, nobody loses. Let us call it friendship.' : 'A draw! We are evenly matched. I demand a rematch. Good game!', { tone: 'happy' });
    }
    if (dead) return;
    const card = el('div', 'g-card chess-end', `
      <h3>${result === 'user' ? 'You won!' : result === 'quark' ? `${q.name()} won` : 'Draw'}</h3>
      <div class="g-row"><button class="g-btn primary" type="button" data-again>Rematch</button><button class="g-btn" type="button" data-home>Home</button></div>`);
    shell.body.appendChild(card);
    card.querySelector('[data-again]').addEventListener('click', () => showSetup());
    card.querySelector('[data-home]').addEventListener('click', ctx.exit);
  }

  // ------------------------------------------------------------------ voice / typed input
  const LOOKS_LIKE_MOVE = /^(?:[a-h][1-8]|[nbrqk]?[a-h]?x?[a-h][1-8](?:=?[qrbn])?|o-?o(?:-?o)?)[+#]?$/i;

  function handleText(text) {
    const low = text.toLowerCase().trim();
    if (phase === 'setup') {
      if (/\b(white)\b/.test(low)) { startGame('w'); return true; }
      if (/\b(black)\b/.test(low)) { startGame('b'); return true; }
      if (/\b(choose|random|surprise|you pick|either|whatever|you decide)\b/.test(low)) { startGame('r'); return true; }
      return false;
    }
    if (phase !== 'play') return false;
    const r = parseUserMove(text, chess);
    if (r && r.type === 'resign') { resign(); return true; }
    if (!r) {
      if (LOOKS_LIKE_MOVE.test(low.replace(/\s+/g, ''))) { say(LINES.illegal(), { tone: 'happy' }); return true; }
      return false;                                              // not a move: let normal chat answer
    }
    if (busy || chess.turn() !== userColor) { say(LINES.wait(), { tone: 'happy' }); return true; }
    if (r.type === 'ambiguous') { say(`Which one? Say where it starts, like ${PIECE_NAME[r.options[0].piece]} ${r.options[0].from} to ${r.options[0].to}.`, { tone: 'happy' }); return true; }
    playUser(r.move);
    return true;
  }

  showSetup();
  return {
    id: 'chess',
    title: 'chess',
    handleText,
    /** Tests only: set up a position. */
    _debugLoad(fen, color = 'w') {
      chess = new Chess(fen);
      userColor = color; flip = color === 'b';
      phase = 'play'; busy = false; selected = null; targets = new Map(); lastMove = null; lastQScore = null;
      buildBoard(); paint(); beginUserTurn();
      if (chess.turn() !== userColor) quarkMove();
    },
    get _chess() { return chess; },
    destroy() {
      dead = true;
      engine.destroy();
      appEl.style.removeProperty('--face-h');
      q.face.releaseGaze(1);
    },
  };
}
