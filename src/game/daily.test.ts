import { describe, expect, it } from 'vitest';
import { legalMoves, legalPits } from '../engine/moruba.js';
import { bestPerPit, dailyPuzzle, dateKey, dayBefore } from './daily.js';

describe('move of the day', () => {
  it('is the same position for the same date', () => {
    expect(dailyPuzzle('2026-11-12')).toEqual(dailyPuzzle('2026-11-12'));
  });

  it('differs between dates', () => {
    const a = dailyPuzzle('2026-11-12').state.pits;
    const b = dailyPuzzle('2026-11-13').state.pits;
    expect(a).not.toEqual(b);
  });

  it('has one clearly best capturing move on each of 60 days', () => {
    for (let day = 1; day <= 60; day++) {
      const puzzle = dailyPuzzle(`day-${day}`);
      const { state, best, bestPit } = puzzle;
      expect(state.toMove).toBe(0);
      expect(state.phase).toBe('sow');
      expect(state.captured).toEqual([0, 0]);
      expect(legalPits(state)).toContain(bestPit);
      // Brute force: nothing takes more than `best`, and `bestPit` takes it.
      const gains = legalMoves(state).map((m) => ({
        pit: m.move.pit,
        gain: m.state.captured[0],
      }));
      expect(Math.max(...gains.map((g) => g.gain))).toBe(best);
      expect(gains.some((g) => g.pit === bestPit && g.gain === best)).toBe(true);
      expect(best).toBeGreaterThanOrEqual(5);
      expect(state.pits[0].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(14);
      expect(state.pits[1].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(14);
      const others = bestPerPit(state).filter((_, pit) => pit !== bestPit);
      expect(Math.max(...others)).toBeLessThanOrEqual(best - 2);
    }
  });

  it('formats and steps dates', () => {
    expect(dateKey(new Date(2026, 10, 12))).toBe('2026-11-12');
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
});
