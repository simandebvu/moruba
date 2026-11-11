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
  /** Random source for `blunder` and for breaking ties; defaults to Math.random. */
  random?: () => number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export const LEVELS: Record<Level, SearchOptions> = {
  easy: { depth: 2, quiescence: 0, blunder: 0.25, timeMs: 500 },
  medium: { depth: 4, quiescence: 2, timeMs: 1200 },
  hard: { depth: 6, quiescence: 4, timeMs: 2500 },
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

interface Ctx {
  nodes: number;
  deadline: number;
  now: () => number;
  quiescence: number;
}

function ordered(state: State): { move: Move; state: State; gain: number }[] {
  const me = state.toMove;
  const before = state.captured[me];
  const list = legalMoves(state).map((m) => ({
    move: m.move,
    state: m.state,
    gain: m.state.captured[me] - before,
  }));
  list.sort((a, b) => b.gain - a.gain);
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
  }
  for (const child of ordered(state)) {
    if (quiet && child.gain === 0) break; // sorted: no captures left
    const score = -negamax(child.state, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
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
  if (options.blunder && random() < options.blunder) {
    const pick = root[Math.floor(random() * root.length)];
    return { move: pick.move, score: 0, depth: 0, nodes: 0 };
  }

  const ctx: Ctx = {
    nodes: 0,
    deadline: now() + (options.timeMs ?? Infinity),
    now,
    quiescence: options.quiescence,
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
        if (score > bestScore) {
          bestScore = score;
          bestMoves = [child.move];
          alpha = score;
        } else if (score === bestScore) {
          bestMoves.push(child.move);
        }
      }
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
