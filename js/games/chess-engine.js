// Quark's chess brain: Stockfish (WASM, in a web worker) asked for its best few moves, then a casual-strength
// policy picks one, so Quark plays sensibly but makes human-sized mistakes and is beatable (roughly club
// level, around 1200). Gemini never picks moves; it only writes banter.
//
// If the worker can't start (blocked, old browser), a small built-in minimax keeps the game playable.

import { Chess } from '../../vendor/chess/chess.js';

const SF_URL = new URL('../../vendor/stockfish/stockfish.js', import.meta.url).href;
const WASM_URL = new URL('../../vendor/stockfish/stockfish.wasm', import.meta.url).href;

const MATE = 10000;

/** Strength knobs. Raise `blunder` for a sloppier Quark, lower `window` for a stricter one. */
export const CASUAL = {
  depth: 5,        // how hard Stockfish looks (higher = stronger)
  multiPV: 6,      // how many candidate moves it reports
  window: 120,     // centipawns: moves this close to the best are "equally fine"
  blunder: 0.22,   // chance per move of playing a clearly weaker (but not hopeless) candidate
  maxDrop: 520,    // never choose a candidate worse than this vs the best (no hanging the queen for free)
};

export function createEngine() {
  let worker = null;
  let state = 'idle';       // idle | loading | ready | failed
  let readyPromise = null;
  let job = null;           // the search in progress

  function onLine(line) {
    if (state === 'loading' && line.startsWith('uciok')) {
      send('setoption name Skill Level value 20');
      send(`setoption name MultiPV value ${CASUAL.multiPV}`);
      send('isready');
    } else if (state === 'loading' && line.startsWith('readyok')) {
      state = 'ready';
      readyPromise?.resolve();
    } else if (job && line.startsWith('info') && / pv /.test(line) && / multipv /.test(line)) {
      const depth = +(/ depth (\d+)/.exec(line) || [])[1] || 0;
      const mpv = +(/ multipv (\d+)/.exec(line) || [])[1] || 1;
      const cp = /score cp (-?\d+)/.exec(line);
      const mate = /score mate (-?\d+)/.exec(line);
      const pv = (/ pv (.+)$/.exec(line) || [])[1] || '';
      const move = pv.split(' ')[0];
      if (!move) return;
      const score = mate ? Math.sign(+mate[1]) * (MATE - Math.abs(+mate[1]) * 10) : +(cp ? cp[1] : 0);
      const cur = job.lines[mpv];
      if (!cur || depth >= cur.depth) job.lines[mpv] = { depth, move, score };
    } else if (job && line.startsWith('bestmove')) {
      const j = job;
      job = null;
      const lines = Object.keys(j.lines).sort((a, b) => a - b).map((k) => j.lines[k]);
      j.resolve({ lines, best: line.split(' ')[1] });
    }
  }

  function send(cmd) { try { worker.postMessage(cmd); } catch { /* worker gone */ } }

  /** Start the worker (safe to call more than once). Resolves true when Stockfish is ready, false if it can't run. */
  function warm() {
    if (state === 'ready') return Promise.resolve(true);
    if (state === 'failed') return Promise.resolve(false);
    if (readyPromise) return readyPromise.promise;
    let resolveFn;
    const promise = new Promise((r) => { resolveFn = r; });
    readyPromise = { promise, resolve: () => resolveFn(true) };
    state = 'loading';
    try {
      worker = new Worker(`${SF_URL}#${WASM_URL}`);
      worker.onmessage = (e) => onLine(String(e.data));
      worker.onerror = () => fail();
      send('uci');
      setTimeout(() => { if (state === 'loading') fail(); }, 9000);   // never wait forever for an engine
    } catch { fail(); }
    function fail() {
      if (state === 'failed') return;
      state = 'failed';
      try { worker && worker.terminate(); } catch { /* ignore */ }
      worker = null;
      job?.resolve(null);
      job = null;
      resolveFn(false);
    }
    return promise;
  }

  /** Ask Stockfish for its top lines in a position. Resolves { lines:[{move,score,depth}] } or null. */
  async function search(fen, depth = CASUAL.depth) {
    if (!(await warm())) return null;
    return new Promise((resolve) => {
      job = { lines: {}, resolve };
      send('ucinewgame');
      send(`position fen ${fen}`);
      send(`go depth ${depth}`);
      setTimeout(() => { if (job && job.resolve === resolve) { send('stop'); } }, 7000);
    });
  }

  /** Casual policy: usually a top move, sometimes a human-sized slip. */
  function choose(lines, plyCount, rng = Math.random) {
    if (!lines.length) return null;
    const best = lines[0].score;
    const closeEnough = lines.filter((l) => best - l.score <= CASUAL.window);
    let pool = closeEnough;
    let slipped = false;
    if (plyCount > 8 && rng() < CASUAL.blunder) {
      const weaker = lines.filter((l) => best - l.score <= CASUAL.maxDrop && l.score < best - CASUAL.window);
      if (weaker.length) { pool = weaker; slipped = true; }
    }
    if (plyCount <= 6) pool = lines.filter((l) => best - l.score <= 60);     // varied but sensible openings
    const pickLine = pool[Math.floor(rng() * pool.length)] || lines[0];
    return { ...pickLine, slipped, bestScore: best };
  }

  /**
   * Quark's move for a position. Resolves { from, to, promotion, score, slipped, source } where score is
   * from Quark's point of view in centipawns.
   */
  async function think(fen, { plyCount = 0, rng = Math.random } = {}) {
    const res = await search(fen);
    if (res && res.lines.length) {
      const c = choose(res.lines, plyCount, rng);
      const m = c.move;
      return { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m[4] : undefined, score: c.score, bestScore: c.bestScore, slipped: c.slipped, source: 'stockfish' };
    }
    return fallbackMove(fen, rng);
  }

  return { warm, think, get state() { return state; }, destroy() { try { worker && worker.terminate(); } catch { /* ignore */ } worker = null; state = 'idle'; readyPromise = null; } };
}

// ---------------------------------------------------------------- built-in fallback

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function material(chess) {
  let s = 0;
  for (const row of chess.board()) for (const p of row) if (p) s += (p.color === 'w' ? 1 : -1) * VAL[p.type];
  return s;
}

function negamax(chess, depth, alpha, beta) {
  if (depth === 0 || chess.isGameOver()) {
    if (chess.isCheckmate()) return -MATE;
    if (chess.isGameOver()) return 0;
    return (chess.turn() === 'w' ? 1 : -1) * material(chess);
  }
  let best = -Infinity;
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    const v = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** A tiny 2-ply material engine with a little randomness: not strong, but it plays legal, sane chess. */
export function fallbackMove(fen, rng = Math.random) {
  const chess = new Chess(fen);
  const scored = chess.moves({ verbose: true }).map((m) => {
    chess.move(m);
    const v = -negamax(chess, 1, -Infinity, Infinity) + rng() * 40;
    chess.undo();
    return { m, v };
  }).sort((a, b) => b.v - a.v);
  if (!scored.length) return null;
  const pickIdx = rng() < 0.2 ? Math.min(scored.length - 1, 1 + Math.floor(rng() * 3)) : 0;   // sometimes second-best
  const m = scored[pickIdx].m;
  return { from: m.from, to: m.to, promotion: m.promotion, score: scored[pickIdx].v, slipped: pickIdx > 0, source: 'fallback' };
}
