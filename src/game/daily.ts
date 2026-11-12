/**
 * Move of the day: one prepared position on the quick board, the same for
 * everyone on a given date. The player gets one move (plus the bonus pick if
 * they capture) and tries to take as many seeds as possible.
 *
 * Positions come from a real game: random legal moves are played from the
 * start, seeded by the date, until the player to move has one clearly best
 * capturing move.
 */

import {
  QUICK,
  legalMoves,
  makeState,
  newGame,
  outcome,
  type State,
} from '../engine/moruba.js';

export interface DailyPuzzle {
  state: State;
  /** Most seeds one move can take, bonus pick included. */
  best: number;
  /** The pit that takes them. */
  bestPit: number;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The most each pit can take from `state` (index = pit; -1 = not playable). */
export function bestPerPit(state: State): number[] {
  const gains = new Array<number>(state.pits[0].length).fill(-1);
  const before = state.captured[state.toMove];
  for (const { move, state: after } of legalMoves(state)) {
    const gain = after.captured[state.toMove] - before;
    if (gain > gains[move.pit]) gains[move.pit] = gain;
  }
  return gains;
}

/** `dateKey` is any string that changes once a day, e.g. "2026-11-12". */
export function dailyPuzzle(dateKey: string): DailyPuzzle {
  const next = random(hash(dateKey));
  let fallback: DailyPuzzle | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    let state = newGame(QUICK, 0);
    const plies = 4 + 2 * Math.floor(next() * 4); // even: player 0 is to move again
    let alive = true;
    for (let i = 0; i < plies; i++) {
      const moves = legalMoves(state);
      if (moves.length === 0) {
        alive = false;
        break;
      }
      state = moves[Math.floor(next() * moves.length)].state;
      if (outcome(state).over) {
        alive = false;
        break;
      }
    }
    if (!alive || state.toMove !== 0 || state.phase !== 'sow') continue;
    const gains = bestPerPit(state);
    const playable = gains.filter((g) => g >= 0).length;
    let best = -1;
    let bestPit = -1;
    let second = -1;
    gains.forEach((gain, pit) => {
      if (gain > best) {
        second = best;
        best = gain;
        bestPit = pit;
      } else if (gain > second) {
        second = gain;
      }
    });
    if (best <= 0) continue;
    // Start the count afresh: the position is what matters, not its history.
    const puzzle: DailyPuzzle = {
      state: makeState(state.pits[0], state.pits[1], { options: QUICK, toMove: 0 }),
      best,
      bestPit,
    };
    // A full enough board that the move has to be read, not stumbled on.
    const mine = state.pits[0].reduce((sum, seeds) => sum + seeds, 0);
    const theirs = state.pits[1].reduce((sum, seeds) => sum + seeds, 0);
    if (mine >= 14 && theirs >= 14 && playable >= 4 && best >= 5 && second <= best - 2) {
      return puzzle;
    }
    if (!fallback || best > fallback.best) fallback = puzzle;
  }
  if (fallback) return fallback;
  throw new Error('no daily puzzle found');
}

/** Local calendar date as "YYYY-MM-DD". */
export function dateKey(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The day before `key`, in the same format. */
export function dayBefore(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}
