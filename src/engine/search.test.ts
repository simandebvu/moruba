import { describe, expect, it } from 'vitest';
import {
  applyMove,
  CLASSIC,
  legalMoves,
  makeState,
  newGame,
  outcome,
  QUICK,
  type State,
} from './moruba.js';
import { evaluate, search, searchLevel } from './search.js';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('evaluate', () => {
  it('is zero at the start and antisymmetric', () => {
    expect(evaluate(newGame())).toBe(0);
    const s = makeState([3, 0, 2, 1], [1, 1, 0, 4]);
    expect(evaluate(s)).toBe(-evaluate({ ...s, toMove: 1 }));
  });
});

describe('search', () => {
  it('returns a legal move from the opening at every level', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const s = newGame(QUICK);
      const r = searchLevel(s, level, { random: rng(1), timeMs: 400 });
      expect(r.move).not.toBeNull();
      const legal = legalMoves(s).map((m) => JSON.stringify(m.move));
      expect(legal).toContain(JSON.stringify(r.move));
    }
  });

  it('takes a capture that wins on the spot', () => {
    // cols 2. Me: outer [2,0], inner idx2 (col 1) empty, idx3 empty.
    // Sow pit 0: seeds to 1 and 2; pit 2 was empty -> inner, col 1.
    // It faces their inner pit 3*2-1-2 = 3 (3 seeds) and outer pit 0 (0).
    // Bonus must take their only other pit (1), leaving them nothing.
    const s = makeState([2, 0, 0, 0], [0, 4, 0, 3]);
    const r = search(s, { depth: 2, quiescence: 0, random: rng(2) });
    expect(r.move).toEqual({ pit: 0, bonus: [1] });
    const after = applyMove(s, r.move!);
    expect(outcome(after)).toEqual({
      over: true,
      winner: 0,
      reason: 'no-moves',
    });
    expect(r.score).toBeGreaterThan(900_000);
  });

  it('reports no move when the player cannot move', () => {
    const s = makeState([0, 0, 0, 0], [2, 2, 2, 2]);
    expect(search(s, { depth: 2, quiescence: 0 }).move).toBeNull();
  });

  it('respects the time limit', () => {
    let t = 0;
    const r = search(newGame(CLASSIC), {
      depth: 20,
      quiescence: 2,
      timeMs: 50,
      now: () => (t += 1), // every clock read costs 1 ms
      random: rng(3),
    });
    expect(r.move).not.toBeNull();
    expect(r.depth).toBeLessThan(20);
  });

  it('medium beats random play nearly always', () => {
    const random = rng(42);
    let wins = 0;
    const games = 12;
    for (let g = 0; g < games; g++) {
      const ai = (g % 2) as 0 | 1;
      let s: State = newGame(QUICK);
      for (;;) {
        const o = outcome(s);
        if (o.over) {
          if (o.winner === ai) wins += 1;
          break;
        }
        if (s.toMove === ai) {
          s = applyMove(
            s,
            search(s, { depth: 3, quiescence: 2, random }).move!,
          );
        } else {
          const moves = legalMoves(s);
          s = moves[Math.floor(random() * moves.length)].state;
        }
      }
    }
    expect(wins).toBeGreaterThanOrEqual(10);
  }, 60_000);
});
