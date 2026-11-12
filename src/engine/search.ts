/**
 * Moruba AI: iterative-deepening alpha-beta (negamax) over whole turns, with a
 * capture-only quiescence search. Pure TypeScript; runs in a Web Worker
 * (ai.worker.ts) so the headset never drops a frame while it thinks.
 */

import {
  legalMoves,
  other,
  outcome,
  type Move,
  type Player,
  type State,
} from './moruba.js';

export type Level = 'easy' | 'medium' | 'hard';

export interface SearchOptions {
  /** Full-width search depth in turns. */
  depth: number;
  /** Extra capture-only turns searched below the horizon. */
  quiescence: number;
  /** Stop deepening after this many milliseconds (the best finished depth is used). */
  timeMs?: number;
  /** Chance (0..1) of playing a random legal move instead; needs `random`. */
  blunder?: number;
  /**
   * How much the blunder chance follows the score: it rises by this much when
   * the mover leads by a full starting side of seeds and falls by as much when
   * behind (kept within 0..0.9). Keeps games close; 0 or absent = steady play.
   */
  mercy?: number;
  /** Random source for `blunder` and for breaking ties; defaults to Math.random. */
  random?: () => number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/**
 * Tuned by simulation (12 Nov) so that a newcomer who simply takes what the
 * "+n" badges offer beats easy about 6 games in 10 and medium about 3 in 10,
 * and a player who also looks one reply ahead beats medium about 3 in 4 and
 * hard about 1 in 10. `mercy` keeps the lead changing hands.
 */
export const LEVELS: Record<Level, SearchOptions> = {
  easy: { depth: 1, quiescence: 0, blunder: 0.5, mercy: 0.6, timeMs: 300 },
  medium: { depth: 2, quiescence: 0, blunder: 0.4, mercy: 0.6, timeMs: 500 },
  hard: { depth: 3, quiescence: 1, blunder: 0.12, mercy: 0.4, timeMs: 1200 },
};

export interface SearchResult {
  /** Null only when the player to move has no legal move. */
  move: Move | null;
  /** Score for the player to move (positive = good), in evaluation units. */
  score: number;
  /** Deepest fully searched depth. */
  depth: number;
  nodes: number;
}

const WIN = 1_000_000;
const W_SEEDS = 10;
const W_MOBILITY = 2;
const W_EXPOSURE = 1;

function sideScore(state: State, p: Player): number {
  const pits = state.pits[p];
  const theirs = state.pits[other(p)];
  const cols = state.options.cols;
  let seeds = 0;
  let mobility = 0;
  let exposure = 0;
  for (let i = 0; i < pits.length; i++) {
    seeds += pits[i];
    if (pits[i] >= 2) mobility += 1;
  }
  // Exposure: seeds standing in a column the opponent could capture, i.e. my
  // inner pit is occupied; counted in full only if they still have seeds to
  // land there with.
  if (theirs.some((s) => s > 0)) {
    for (let i = cols; i < 2 * cols; i++) {
      if (pits[i] > 0) exposure += pits[i] + pits[2 * cols - 1 - i];
    }
  }
  return seeds * W_SEEDS + mobility * W_MOBILITY - exposure * W_EXPOSURE;
}

/** Static evaluation for the player to move. */
export function evaluate(state: State): number {
  const me = state.toMove;
  return sideScore(state, me) - sideScore(state, other(me));
}

function terminalScore(state: State, ply: number): number | null {
  const o = outcome(state);
  if (!o.over) return null;
  if (o.winner === null) return 0;
  // Prefer quicker wins and slower losses.
  return o.winner === state.toMove ? WIN - ply : -WIN + ply;
}

class Timeout extends Error {}

/** Transposition-table entry: what a previous visit to this position found. */
interface Entry {
  depth: number;
  score: number;
  /** 0 = exact, 1 = at least `score` (cut-off), 2 = at most `score`. */
  bound: 0 | 1 | 2;
  /** Code of the best move found (see moveCode), tried first next time. */
  best: number;
}

interface Ctx {
  nodes: number;
  deadline: number;
  now: () => number;
  quiescence: number;
  table: Map<string, Entry>;
}

const TABLE_LIMIT = 300_000;

function keyOf(state: State): string {
  const [a, b] = state.pits;
  let key = state.toMove === 0 ? 'a' : 'b';
  for (let i = 0; i < a.length; i++) key += String.fromCharCode(48 + a[i]);
  for (let i = 0; i < b.length; i++) key += String.fromCharCode(48 + b[i]);
  // Close to the move limit the same position is worth something different.
  const left = state.options.maxMoves - state.moveCount;
  if (left < 24) key += `|${left}`;
  return key;
}

function moveCode(move: Move): number {
  return move.pit * 64 + (move.bonus.length > 0 ? move.bonus[0] + 1 : 0);
}

interface Child {
  move: Move;
  state: State;
  gain: number;
}

/** Legal turns, biggest captures first; `first` (a move code) goes to the front. */
function ordered(state: State, first = -1): Child[] {
  const me = state.toMove;
  const before = state.captured[me];
  const list: Child[] = legalMoves(state).map((m) => ({
    move: m.move,
    state: m.state,
    gain: m.state.captured[me] - before,
  }));
  list.sort((a, b) => b.gain - a.gain);
  if (first >= 0) {
    const i = list.findIndex((c) => moveCode(c.move) === first);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

function negamax(
  state: State,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: Ctx,
): number {
  ctx.nodes += 1;
  if ((ctx.nodes & 1023) === 0 && ctx.now() > ctx.deadline) throw new Timeout();
  const t = terminalScore(state, ply);
  if (t !== null) return t;

  const quiet = depth <= 0;
  let best = -Infinity;
  if (quiet) {
    // Stand pat, then look only at captures.
    best = evaluate(state);
    if (depth <= -ctx.quiescence || best >= beta) return best;
    if (best > alpha) alpha = best;
    for (const child of ordered(state)) {
      if (child.gain === 0) break; // sorted: no captures left
      const score = -negamax(child.state, depth - 1, -beta, -alpha, ply + 1, ctx);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Full-width node: reuse what an earlier visit to this position found.
  const key = keyOf(state);
  const entry = ctx.table.get(key);
  if (entry && entry.depth >= depth) {
    if (entry.bound === 0) return entry.score;
    if (entry.bound === 1 && entry.score >= beta) return entry.score;
    if (entry.bound === 2 && entry.score <= alpha) return entry.score;
  }
  const alpha0 = alpha;
  let bestCode = -1;
  for (const child of ordered(state, entry ? entry.best : -1)) {
    const score = -negamax(child.state, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (score > best) {
      best = score;
      bestCode = moveCode(child.move);
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  // Win/loss scores depend on how deep they were found, so are not reusable.
  if (Math.abs(best) < WIN - 1000) {
    if (ctx.table.size >= TABLE_LIMIT) ctx.table.clear();
    ctx.table.set(key, {
      depth,
      score: best,
      bound: best <= alpha0 ? 2 : best >= beta ? 1 : 0,
      best: bestCode,
    });
  }
  return best;
}

/** Choose a move for the player to move. `state` must be in the sow phase. */
export function search(state: State, options: SearchOptions): SearchResult {
  if (state.phase !== 'sow') throw new Error('search: state is mid-capture');
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => Date.now());
  const root = ordered(state);
  if (root.length === 0 || outcome(state).over) {
    return { move: null, score: -WIN, depth: 0, nodes: 0 };
  }
  let slip = options.blunder ?? 0;
  if (options.mercy) {
    const me = state.toMove;
    let mine = 0;
    let theirs = 0;
    for (const n of state.pits[me]) mine += n;
    for (const n of state.pits[other(me)]) theirs += n;
    const side = state.options.cols * 2 * state.options.seedsPerPit;
    slip = Math.min(0.9, Math.max(0, slip + (options.mercy * (mine - theirs)) / side));
  }
  if (slip > 0 && random() < slip) {
    const pick = root[Math.floor(random() * root.length)];
    return { move: pick.move, score: 0, depth: 0, nodes: 0 };
  }

  const ctx: Ctx = {
    nodes: 0,
    deadline: now() + (options.timeMs ?? Infinity),
    now,
    quiescence: options.quiescence,
    table: new Map(),
  };
  // Depth 0 fallback: best immediate gain.
  let result: SearchResult = {
    move: root[0].move,
    score: 0,
    depth: 0,
    nodes: 0,
  };
  for (let depth = 1; depth <= options.depth; depth++) {
    try {
      let alpha = -Infinity;
      let bestScore = -Infinity;
      let bestMoves: Move[] = [];
      const scores = new Map<Child, number>();
      for (const child of root) {
        // Full window on ties so equal moves are found and can be varied.
        const score = -negamax(
          child.state,
          depth - 1,
          -Infinity,
          -alpha + 1,
          1,
          ctx,
        );
        scores.set(child, score);
        if (score > bestScore) {
          bestScore = score;
          bestMoves = [child.move];
          alpha = score;
        } else if (score === bestScore) {
          bestMoves.push(child.move);
        }
      }
      // Best first next time round: the deeper search then cuts off sooner.
      // (Scores below the best are upper bounds, which is all ordering needs.)
      root.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
      result = {
        move: bestMoves[Math.floor(random() * bestMoves.length)],
        score: bestScore,
        depth,
        nodes: ctx.nodes,
      };
      if (Math.abs(bestScore) > WIN - 1000) break; // forced result found
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  result.nodes = ctx.nodes;
  return result;
}

export function searchLevel(
  state: State,
  level: Level,
  overrides: Partial<SearchOptions> = {},
): SearchResult {
  return search(state, { ...LEVELS[level], ...overrides });
}
