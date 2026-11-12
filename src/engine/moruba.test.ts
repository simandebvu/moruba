/**
 * Independent unit tests for the Moruba rules engine. Every expected value is
 * worked out by hand from RULES.md and the indexing note in moruba.ts.
 *
 * Conventions used in the hand calculations:
 *   cols = 2 (4-pit loop): outer = 0,1; inner = 2,3 (inner runs right to left).
 *     my inner 2 faces opp inner 3 + opp outer 0;
 *     my inner 3 faces opp inner 2 + opp outer 1.
 *   cols = 3 (6-pit loop): outer 0..2, inner 3..5; facing(p) = {inner 8-p, outer p-3}.
 *   cols = 8 (classic):    outer 0..7, inner 8..15; facing(p) = {inner 23-p, outer p-8}.
 */
import { describe, expect, it } from 'vitest';
import {
  CLASSIC,
  QUICK,
  applyMove,
  bonusOptions,
  columnOf,
  facing,
  legalMoves,
  legalPits,
  makeState,
  newGame,
  outcome,
  seedsOf,
  sow,
  takeBonus,
  type Move,
  type State,
} from './moruba';

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const total = (s: State) =>
  seedsOf(s, 0) + seedsOf(s, 1) + s.captured[0] + s.captured[1];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// A cols=2 position where P0's pit 0 (2 seeds) sleeps in the empty inner pit 2,
// facing P1 inner 3 / outer 0.
const capPos = (p1: number[], init: Parameters<typeof makeState>[2] = {}) =>
  makeState([2, 0, 0, 0], p1, init);

describe('newGame', () => {
  it('classic: 16 pits per side, 2 seeds each, 64 total', () => {
    const s = newGame(CLASSIC);
    expect(s.pits[0]).toHaveLength(16);
    expect(s.pits[1]).toHaveLength(16);
    expect(s.pits[0].every((n) => n === 2)).toBe(true);
    expect(s.pits[1].every((n) => n === 2)).toBe(true);
    expect(total(s)).toBe(64);
    expect(s.toMove).toBe(0);
    expect(s.phase).toBe('sow');
    expect(s.moveCount).toBe(0);
    expect(s.captured).toEqual([0, 0]);
  });
  it('defaults to classic', () => {
    expect(newGame().pits[0]).toHaveLength(16);
  });
  it('quick: 12 pits per side, 48 total', () => {
    const s = newGame(QUICK);
    expect(s.pits[0]).toHaveLength(12);
    expect(s.pits[1]).toHaveLength(12);
    expect(total(s)).toBe(48);
  });
  it('first player option', () => {
    expect(newGame(CLASSIC, 1).toMove).toBe(1);
    expect(newGame(QUICK, 0).toMove).toBe(0);
  });
  it('every pit is legal at the start', () => {
    expect(legalPits(newGame(CLASSIC))).toEqual([...Array(16).keys()]);
    expect(legalPits(newGame(QUICK))).toEqual([...Array(12).keys()]);
  });
  it('makeState infers cols from the array length and rejects mismatches', () => {
    expect(makeState([0, 0, 0, 0], [0, 0, 0, 0]).options.cols).toBe(2);
    expect(makeState(Array(6).fill(0), Array(6).fill(0)).options.cols).toBe(3);
    expect(() => makeState([0, 0, 0, 0], [0, 0, 0, 0, 0, 0])).toThrow();
  });
});

describe('geometry', () => {
  // columnOf: outer p -> p ; inner p -> 2*cols-1-p.
  it('columnOf classic', () => {
    for (let p = 0; p < 8; p++) expect(columnOf(CLASSIC, p)).toBe(p);
    expect(columnOf(CLASSIC, 8)).toBe(7);
    expect(columnOf(CLASSIC, 11)).toBe(4); // 15 - 11
    expect(columnOf(CLASSIC, 15)).toBe(0);
  });
  it('columnOf quick', () => {
    for (let p = 0; p < 6; p++) expect(columnOf(QUICK, p)).toBe(p);
    expect(columnOf(QUICK, 6)).toBe(5);
    expect(columnOf(QUICK, 9)).toBe(2); // 11 - 9
    expect(columnOf(QUICK, 11)).toBe(0);
  });
  // My inner pit in column c faces opp column 7-c (classic). Opp inner pit of
  // column k is index 15-k.
  it('facing classic', () => {
    expect(facing(CLASSIC, 8)).toEqual({ inner: 15, outer: 0 }); // c7 -> opp c0
    expect(facing(CLASSIC, 15)).toEqual({ inner: 8, outer: 7 }); // c0 -> opp c7
    expect(facing(CLASSIC, 11)).toEqual({ inner: 12, outer: 3 }); // c4 -> opp c3
  });
  it('facing quick', () => {
    expect(facing(QUICK, 6)).toEqual({ inner: 11, outer: 0 }); // c5 -> opp c0
    expect(facing(QUICK, 11)).toEqual({ inner: 6, outer: 5 }); // c0 -> opp c5
    expect(facing(QUICK, 8)).toEqual({ inner: 9, outer: 2 }); // c3 -> opp c2
  });
  it('facing of an outer pit is null (and out of range)', () => {
    for (let p = 0; p < 8; p++) expect(facing(CLASSIC, p)).toBeNull();
    for (let p = 0; p < 6; p++) expect(facing(QUICK, p)).toBeNull();
    expect(facing(CLASSIC, 16)).toBeNull();
  });
  it('column mapping and symmetry hold for every inner pit', () => {
    for (const o of [CLASSIC, QUICK]) {
      const c = o.cols;
      for (let a = c; a < 2 * c; a++) {
        const f = facing(o, a)!;
        const col = columnOf(o, a);
        // opp column is the mirror, for both the inner and the outer pit
        expect(columnOf(o, f.inner)).toBe(c - 1 - col);
        expect(f.outer).toBe(c - 1 - col);
        // symmetric: from their seat f.inner faces my a, and the outer is my column
        const back = facing(o, f.inner)!;
        expect(back.inner).toBe(a);
        expect(back.outer).toBe(col);
      }
    }
  });
});

describe('simple sow', () => {
  // cols 3. P0 [2,0,0,0,0,0], sow 0: lift 2; drop 1 -> 1; drop 2 -> 1 (empty, outer row): sleeps.
  it('ends in an empty pit; turn passes; events in order', () => {
    const p1 = [2, 2, 2, 2, 2, 2];
    const s = makeState([2, 0, 0, 0, 0, 0], p1);
    const r = sow(s, 0);
    expect(r.state.pits[0]).toEqual([0, 1, 1, 0, 0, 0]);
    expect(r.state.pits[1]).toEqual(p1);
    expect(r.state.toMove).toBe(1);
    expect(r.state.phase).toBe('sow');
    expect(r.state.moveCount).toBe(1);
    expect(r.sown).toBe(2);
    expect(r.captured).toBe(false);
    expect(r.state.captured).toEqual([0, 0]);
    expect(r.events).toEqual([
      { type: 'lift', pit: 0, count: 2 },
      { type: 'drop', pit: 1 },
      { type: 'drop', pit: 2 },
    ]);
  });
  // cols 2. P0 [2,0,0,0] sow 0: drop 1, drop 2 (empty inner). Opp inner 3 is 0 -> no capture.
  it('ending in an empty inner pit with an empty facing inner pit does nothing', () => {
    const s = makeState([2, 0, 0, 0], [2, 2, 2, 0]);
    const r = sow(s, 0);
    expect(r.state.pits[0]).toEqual([0, 1, 1, 0]);
    expect(r.state.pits[1]).toEqual([2, 2, 2, 0]);
    expect(r.captured).toBe(false);
  });
});

describe('wrap-around', () => {
  // cols 3. P0 [0,0,0,0,0,3], sow 5: drops 0,1,2 (index 5 -> 0 wraps). Ends at 2 (outer, was empty).
  it('wraps from index 2*cols-1 to 0', () => {
    const s = makeState([0, 0, 0, 0, 0, 3], [2, 2, 2, 2, 2, 2]);
    const r = sow(s, 5);
    expect(r.state.pits[0]).toEqual([1, 1, 1, 0, 0, 0]);
    expect(r.events).toEqual([
      { type: 'lift', pit: 5, count: 3 },
      { type: 'drop', pit: 0 },
      { type: 'drop', pit: 1 },
      { type: 'drop', pit: 2 },
    ]);
  });
  // cols 2. P0 [0,0,0,3] sow 3: drops 0,1,2; ends in empty inner 2; opp inner 3 empty -> no capture.
  it('wraps on the 4-pit loop', () => {
    const r = sow(makeState([0, 0, 0, 3], [2, 2, 2, 0]), 3);
    expect(r.state.pits[0]).toEqual([1, 1, 1, 0]);
  });
});

describe('relay sowing', () => {
  // cols 2. P0 [2,0,1,0], sow 0: lift 2 -> [0,0,1,0]; drop 1 -> [0,1,1,0]; drop 2 -> [0,1,2,0]
  // last in occupied pit 2: lift 2 (incl. the one just sown) -> [0,1,0,0]; drop 3 -> 1; drop 0 -> 1.
  // pit 0 was empty -> sleeps (outer). Final [1,1,0,1]; sown 4.
  it('lifts the whole pit including the seed just sown', () => {
    const r = sow(makeState([2, 0, 1, 0], [2, 2, 2, 2]), 0);
    expect(r.state.pits[0]).toEqual([1, 1, 0, 1]);
    expect(r.sown).toBe(4);
    expect(r.events).toEqual([
      { type: 'lift', pit: 0, count: 2 },
      { type: 'drop', pit: 1 },
      { type: 'drop', pit: 2 },
      { type: 'lift', pit: 2, count: 2 },
      { type: 'drop', pit: 3 },
      { type: 'drop', pit: 0 },
    ]);
  });

  // cols 2. P0 [3,1,1,1], sow 0.
  //  lift 3 [0,1,1,1]; drops 1,2,3 -> [0,2,2,2]; last pit 3 occupied: lift 2 -> [0,2,2,0]
  //  drops 0,1 -> [1,3,2,0]; pit 1 occupied (3): lift -> [1,0,2,0]
  //  drops 2,3,0 -> [2,0,3,1]; pit 0 occupied (2): lift -> [0,0,3,1]
  //  drops 1,2 -> [0,1,4,1]; pit 2 occupied (4): lift -> [0,1,0,1]
  //  drops 3,0,1,2 -> [1,2,1,2]; pit 2 was empty -> sleeps. sown 3+2+3+2+4 = 14.
  it('multi-lap relay worked by hand', () => {
    const r = sow(makeState([3, 1, 1, 1], [2, 2, 2, 0]), 0);
    expect(r.state.pits[0]).toEqual([1, 2, 1, 2]);
    expect(r.sown).toBe(14);
    expect(r.captured).toBe(false); // opp inner 3 is empty
    expect(r.events.filter((e) => e.type === 'lift')).toEqual([
      { type: 'lift', pit: 0, count: 3 },
      { type: 'lift', pit: 3, count: 2 },
      { type: 'lift', pit: 1, count: 3 },
      { type: 'lift', pit: 0, count: 2 },
      { type: 'lift', pit: 2, count: 4 },
    ]);
    expect(r.events.filter((e) => e.type === 'drop')).toHaveLength(14);
  });

  // Classic, all 2s, sow 0. Relay chain: 0(2) -> pit 2 (3) -> pit 5 (3) -> pit 8 (3)
  //  -> pit 11 (3) -> pit 14 (3) -> drops 15, 0, 1: pit 1 holds 4 -> lift 4
  //  -> drops 2,3,4,5; pit 5 was emptied -> 1, sleeps (outer).
  //  Final: p0=1 p1=0 p2=1 p3=4 p4=4 p5=1 p6=3 p7=3 p8=0 p9=3 p10=3 p11=0 p12=3 p13=3 p14=0 p15=3
  //  (sum 32). sown = 2+3*5+4 = 21. Opponent untouched.
  it('classic opening from pit 0', () => {
    const s = newGame(CLASSIC);
    const r = sow(s, 0);
    expect(r.state.pits[0]).toEqual([1, 0, 1, 4, 4, 1, 3, 3, 0, 3, 3, 0, 3, 3, 0, 3]);
    expect(r.state.pits[1]).toEqual(s.pits[1]);
    expect(r.sown).toBe(21);
    expect(r.captured).toBe(false);
    expect(r.state.toMove).toBe(1);
    expect(r.state.moveCount).toBe(1);
  });

  // Classic, sow 15: lift 2; drops 0,1 (3 each) -> relay at 1: 2,3,4 -> relay 4: 5,6,7
  //  -> relay 7: 8,9,10 -> relay 10: 11,12,13 -> relay 13: drops 14 (3), 15 (0->1), 0 (3->4)
  //  relay 0 (4): drops 1 (0->1), 2 (0->... 2 was lifted? no). Careful: pit 2 got 3 and was
  //  not lifted (the chain lifted 1,4,7,10,13,0), so drops 1,2,3,4 -> p1=1, p2=4, p3=4, p4=1
  //  (pit 4 was lifted, empty) -> sleeps at 4 (outer).
  //  Final: p0=0 p1=1 p2=4 p3=4 p4=1 p5=3 p6=3 p7=0 p8=3 p9=3 p10=0 p11=3 p12=3 p13=0 p14=3 p15=1
  //  (sum 32). sown = 2+3*5+4 = 21.
  it('classic opening from pit 15', () => {
    const s = newGame(CLASSIC);
    const r = sow(s, 15);
    expect(r.state.pits[0]).toEqual([0, 1, 4, 4, 1, 3, 3, 0, 3, 3, 0, 3, 3, 0, 3, 1]);
    expect(r.state.pits[1]).toEqual(s.pits[1]);
    expect(r.sown).toBe(21);
    expect(r.captured).toBe(false);
  });

  // Classic, sow 8: lift 2; drops 9,10 (3 each) -> relay 10: 11,12,13 -> relay 13: 14,15,0
  //  -> relay 0: 1,2,3 -> relay 3: 4,5,6 -> relay 6: drops 7 (3), 8 (0->1), 9 (3->4)
  //  relay 9 (4): drops 10 (0->1), 11 (3->4), 12 (3->4), 13 (0->1): empty inner pit -> sleeps.
  //  Pit 13 is facing inner 23-13 = 10 and outer 13-8 = 5 (both 2): capture 4.
  //  Mover final: p0=0 p1=3 p2=3 p3=0 p4=3 p5=3 p6=0 p7=3 p8=1 p9=0 p10=1 p11=4 p12=4 p13=1 p14=3 p15=3
  //  (sum 32). Opp: all 2 except pits 5 and 10 = 0. sown = 2+3*5+4 = 21.
  it('classic opening from pit 8 ends in a capture', () => {
    const s = newGame(CLASSIC);
    const r = sow(s, 8);
    expect(r.state.pits[0]).toEqual([0, 3, 3, 0, 3, 3, 0, 3, 1, 0, 1, 4, 4, 1, 3, 3]);
    const opp = Array(16).fill(2);
    opp[5] = 0;
    opp[10] = 0;
    expect(r.state.pits[1]).toEqual(opp);
    expect(r.sown).toBe(21);
    expect(r.captured).toBe(true);
    expect(r.state.captured).toEqual([4, 0]);
    expect(r.events[r.events.length - 1]).toEqual({
      type: 'capture',
      at: 13,
      pits: [10, 5],
      seeds: 4,
    });
    expect(r.state.phase).toBe('bonus');
    expect(bonusOptions(r.state)).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15]);
    // take pit 0 (2 seeds): captured 6, turn passes
    const t = takeBonus(r.state, 0);
    expect(t.captured).toEqual([6, 0]);
    expect(t.toMove).toBe(1);
    expect(total(t)).toBe(64);
  });

  it('sowing never touches the opponent without a capture', () => {
    const s = newGame(CLASSIC);
    for (const pit of [0, 1, 3, 15]) {
      const r = sow(s, pit);
      if (!r.captured) expect(r.state.pits[1]).toEqual(s.pits[1]);
    }
    // quick start too
    const q = newGame(QUICK);
    for (let pit = 0; pit < 12; pit++) {
      const r = sow(q, pit);
      if (!r.captured) expect(r.state.pits[1]).toEqual(q.pits[1]);
    }
  });
});

describe('capture', () => {
  // cols 2. P0 [2,0,0,0] sow 0 -> [0,1,1,0], sleeping at inner 2, facing opp inner 3, outer 0.
  // P1 [3,1,2,4]: capture inner 3 (4) + outer 0 (3) = 7. P1 -> [0,1,2,0]. captured [7,0].
  it('inner + outer when both are occupied', () => {
    const r = sow(capPos([3, 1, 2, 4]), 0);
    expect(r.captured).toBe(true);
    expect(r.state.pits[0]).toEqual([0, 1, 1, 0]); // the move ends after the capture
    expect(r.state.pits[1]).toEqual([0, 1, 2, 0]);
    expect(r.state.captured).toEqual([7, 0]);
    expect(r.events).toEqual([
      { type: 'lift', pit: 0, count: 2 },
      { type: 'drop', pit: 1 },
      { type: 'drop', pit: 2 },
      { type: 'capture', at: 2, pits: [3, 0], seeds: 7 },
    ]);
    expect(r.sown).toBe(2);
    expect(total(r.state)).toBe(12);
  });

  // Outer pit 0 is empty: capture only inner 3 (4 seeds).
  it('inner only when the outer pit is empty', () => {
    const r = sow(capPos([0, 1, 2, 4]), 0);
    expect(r.state.pits[1]).toEqual([0, 1, 2, 0]);
    expect(r.state.captured).toEqual([4, 0]);
    expect(r.events[r.events.length - 1]).toEqual({
      type: 'capture',
      at: 2,
      pits: [3],
      seeds: 4,
    });
  });

  // Facing inner 3 is empty; outer 0 has 5: no capture, opp untouched.
  it('is blocked when the facing inner pit is empty, even with outer seeds', () => {
    const r = sow(capPos([5, 1, 2, 0]), 0);
    expect(r.captured).toBe(false);
    expect(r.state.pits[1]).toEqual([5, 1, 2, 0]);
    expect(r.state.phase).toBe('sow');
    expect(r.state.toMove).toBe(1);
    expect(r.state.captured).toEqual([0, 0]);
  });

  // cols 3. P0 [2,0,0,0,0,0] ends at outer pit 2: never a capture.
  it('does not capture when the move ends in the outer row', () => {
    const r = sow(makeState([2, 0, 0, 0, 0, 0], [2, 2, 2, 2, 2, 2]), 0);
    expect(r.captured).toBe(false);
    expect(r.state.pits[1]).toEqual([2, 2, 2, 2, 2, 2]);
  });

  // cols 3. P0 [0,0,2,0,0,0]: sow 2 -> drops 3,4; ends at inner 4 (empty).
  // facing(4) = inner 8-4 = 4, outer 4-3 = 1.  P1 all 1: capture 1+1 = 2.
  it('uses the right facing pits on a 6-pit loop', () => {
    const r = sow(makeState([0, 0, 2, 0, 0, 0], [1, 1, 1, 1, 1, 1]), 2);
    expect(r.state.pits[1]).toEqual([1, 0, 1, 1, 0, 1]);
    expect(r.state.captured).toEqual([2, 0]);
    expect(r.events[r.events.length - 1]).toEqual({
      type: 'capture',
      at: 4,
      pits: [4, 1],
      seeds: 2,
    });
  });

  it('captured seeds leave the board; totals are conserved', () => {
    const s = capPos([3, 1, 2, 4]);
    expect(total(s)).toBe(12);
    const r = sow(s, 0).state;
    expect(seedsOf(r, 0) + seedsOf(r, 1)).toBe(12 - 7);
    expect(total(r)).toBe(12);
    const t = takeBonus(r, 2);
    expect(total(t)).toBe(12);
    expect(seedsOf(t, 0) + seedsOf(t, 1)).toBe(12 - 9);
  });
});

describe('bonus phase', () => {
  // After capture: P1 [0,1,2,0], captured [7,0], phase bonus, P0 still to move, moveCount 0.
  const bonusState = () => sow(capPos([3, 1, 2, 4]), 0).state;

  it('enters the bonus phase with the same player and moveCount', () => {
    const s = bonusState();
    expect(s.phase).toBe('bonus');
    expect(s.toMove).toBe(0);
    expect(s.moveCount).toBe(0);
    expect(s.bonusLeft).toBe(1);
  });
  it('bonusOptions are the opponent non-empty pits', () => {
    expect(bonusOptions(bonusState())).toEqual([1, 2]);
  });
  it('bonusOptions is empty outside the bonus phase', () => {
    expect(bonusOptions(newGame())).toEqual([]);
  });
  it('legalPits is empty during the bonus phase', () => {
    expect(legalPits(bonusState())).toEqual([]);
  });
  it('outcome is not over during the bonus phase', () => {
    expect(outcome(bonusState())).toEqual({ over: false });
  });
  // Take opp pit 2 (2 seeds): P1 [0,1,0,0]; captured 7+2 = 9; turn passes; moveCount 1.
  it('takeBonus removes the pit, scores, passes the turn, increments moveCount', () => {
    const t = takeBonus(bonusState(), 2);
    expect(t.pits[1]).toEqual([0, 1, 0, 0]);
    expect(t.pits[0]).toEqual([0, 1, 1, 0]);
    expect(t.captured).toEqual([9, 0]);
    expect(t.toMove).toBe(1);
    expect(t.phase).toBe('sow');
    expect(t.moveCount).toBe(1);
    expect(t.bonusLeft).toBe(0);
  });
  it('takeBonus on an empty (or invalid) pit throws', () => {
    expect(() => takeBonus(bonusState(), 0)).toThrow(); // emptied by the capture
    expect(() => takeBonus(bonusState(), 3)).toThrow(); // captured inner
    expect(() => takeBonus(bonusState(), 9)).toThrow(); // out of range
  });
  it('takeBonus outside the bonus phase throws', () => {
    expect(() => takeBonus(newGame(), 0)).toThrow();
  });
  it('sow during the bonus phase throws', () => {
    expect(() => sow(bonusState(), 0)).toThrow();
  });
  // P1 [0,0,0,4]: capture takes inner 3 (4) only; the opponent has nothing left -> no bonus.
  // P1 to move with zero seeds has no move: P0 wins 'no-moves'.
  it('is skipped when the opponent has no seeds left', () => {
    const r = sow(capPos([0, 0, 0, 4]), 0);
    expect(r.captured).toBe(true);
    expect(r.state.phase).toBe('sow');
    expect(r.state.toMove).toBe(1);
    expect(r.state.moveCount).toBe(1);
    expect(r.state.captured).toEqual([4, 0]);
    expect(outcome(r.state)).toEqual({ over: true, winner: 0, reason: 'no-moves' });
  });
  // bonusPits 2, P1 [3,1,2,4]: capture 7 -> P1 [0,1,2,0]. Pick 1 (1 seed): P1 [0,0,2,0],
  // captured 8, still bonus with 1 left, moveCount unchanged. Pick 2 (2): P1 empty, captured 10, turn passes.
  it('bonusPits = 2 gives two picks', () => {
    const s = sow(capPos([3, 1, 2, 4], { options: { bonusPits: 2 } }), 0).state;
    expect(s.phase).toBe('bonus');
    expect(s.bonusLeft).toBe(2);
    const a = takeBonus(s, 1);
    expect(a.phase).toBe('bonus');
    expect(a.bonusLeft).toBe(1);
    expect(a.toMove).toBe(0);
    expect(a.moveCount).toBe(0);
    expect(a.pits[1]).toEqual([0, 0, 2, 0]);
    expect(a.captured).toEqual([8, 0]);
    const b = takeBonus(a, 2);
    expect(b.phase).toBe('sow');
    expect(b.toMove).toBe(1);
    expect(b.moveCount).toBe(1);
    expect(b.pits[1]).toEqual([0, 0, 0, 0]);
    expect(b.captured).toEqual([10, 0]);
  });
  // bonusPits 2, P1 [3,0,1,4]: capture 7 (pits 3, 0) leaves [0,0,1,0]. First pick takes pit 2
  // (1 seed), captured 8; the opponent is empty so the second pick is not owed: turn passes.
  it('bonusPits = 2 ends early when the opponent runs out', () => {
    const s = sow(capPos([3, 0, 1, 4], { options: { bonusPits: 2 } }), 0).state;
    expect(s.phase).toBe('bonus');
    expect(bonusOptions(s)).toEqual([2]);
    const t = takeBonus(s, 2);
    expect(t.phase).toBe('sow');
    expect(t.toMove).toBe(1);
    expect(t.moveCount).toBe(1);
    expect(t.captured).toEqual([8, 0]);
  });
});

describe('singletons', () => {
  it('a 1-seed pit is not legal while any pit has >= 2', () => {
    expect(legalPits(makeState([1, 2, 0, 0], [2, 2, 2, 2]))).toEqual([1]);
    expect(legalPits(makeState([1, 0, 2, 0], [2, 2, 2, 2]))).toEqual([2]);
  });
  it('with no pit >= 2, a singleton is legal only if the next pit is empty', () => {
    // [1,1,0,0]: pit 0 -> next is 1 (occupied) no; pit 1 -> next 2 (empty) yes.
    expect(legalPits(makeState([1, 1, 0, 0], [2, 2, 2, 2]))).toEqual([1]);
    // [1,1,1,0]: only pit 2 (next 3 empty).
    expect(legalPits(makeState([1, 1, 1, 0], [2, 2, 2, 2]))).toEqual([2]);
    // wrap: pit 3's next is pit 0.
    expect(legalPits(makeState([0, 0, 0, 1], [2, 2, 2, 2]))).toEqual([3]);
    // [1,0,0,1]: pit 0 (next 1 empty) yes; pit 3 (next is pit 0, occupied) no.
    expect(legalPits(makeState([1, 0, 0, 1], [2, 2, 2, 2]))).toEqual([0]);
  });
  // [0,1,0,0] sow 1: seed moves to pit 2 (empty inner); opp inner 3 empty -> no capture.
  it('the seed moves exactly one pit', () => {
    const r = sow(makeState([0, 1, 0, 0], [2, 2, 2, 0]), 1);
    expect(r.state.pits[0]).toEqual([0, 0, 1, 0]);
    expect(r.sown).toBe(1);
    expect(r.events).toEqual([
      { type: 'lift', pit: 1, count: 1 },
      { type: 'drop', pit: 2 },
    ]);
    expect(r.captured).toBe(false);
  });
  // [0,1,0,0] sow 1 -> inner 2 (empty), facing opp inner 3 (3) + outer 0 (2) = 5.
  // P1 [2,1,0,3] -> [0,1,0,0] left, so a bonus pick is offered (pit 1).
  it('a singleton move into an empty inner pit can capture', () => {
    const r = sow(makeState([0, 1, 0, 0], [2, 1, 0, 3]), 1);
    expect(r.captured).toBe(true);
    expect(r.state.captured).toEqual([5, 0]);
    expect(r.state.pits[1]).toEqual([0, 1, 0, 0]);
    expect(r.state.phase).toBe('bonus');
    expect(bonusOptions(r.state)).toEqual([1]);
  });
});

describe('sow() rejects illegal pits', () => {
  const s = makeState([0, 2, 1, 0], [2, 2, 2, 2]);
  it('empty pit', () => expect(() => sow(s, 0)).toThrow());
  it('out of range', () => {
    expect(() => sow(s, -1)).toThrow();
    expect(() => sow(s, 4)).toThrow();
    expect(() => sow(s, 99)).toThrow();
  });
  it('singleton when a pit has >= 2', () => expect(() => sow(s, 2)).toThrow());
  it('singleton whose next pit is occupied', () => {
    expect(() => sow(makeState([1, 1, 0, 0], [2, 2, 2, 2]), 0)).toThrow();
  });
  it('the opponent pits are not playable (pit refers to the mover)', () => {
    // P0 to move; pit 1 of P0 holds 0 so illegal, even though P1 pit 1 has seeds.
    expect(() => sow(makeState([2, 0, 0, 0], [0, 5, 0, 0]), 1)).toThrow();
  });
});

describe('end of game: no legal move', () => {
  it('a player with zero seeds loses', () => {
    expect(outcome(makeState([0, 0, 0, 0], [2, 2, 2, 2]))).toEqual({
      over: true,
      winner: 1,
      reason: 'no-moves',
    });
  });
  it('a player with only blocked singletons loses', () => {
    expect(outcome(makeState([1, 1, 1, 1], [2, 2, 2, 2]))).toEqual({
      over: true,
      winner: 1,
      reason: 'no-moves',
    });
  });
  it('works for player 1 to move', () => {
    expect(
      outcome(makeState([2, 2, 2, 2], [1, 1, 1, 1], { toMove: 1 })),
    ).toEqual({ over: true, winner: 0, reason: 'no-moves' });
    expect(
      outcome(makeState([2, 2, 2, 2], [0, 0, 0, 0], { toMove: 1 })),
    ).toEqual({ over: true, winner: 0, reason: 'no-moves' });
  });
  it('a lone singleton with an empty next pit is still a move', () => {
    expect(outcome(makeState([0, 1, 0, 0], [2, 2, 2, 2]))).toEqual({ over: false });
  });
  it('is not over in a normal position', () => {
    expect(outcome(newGame(CLASSIC))).toEqual({ over: false });
    expect(outcome(newGame(QUICK, 1))).toEqual({ over: false });
  });
});

describe('safety caps', () => {
  // [3,1,1,1] sow 0 with cap 5. Drops: 1,2,3 (sown 3), relay lift pit 3 (2): drop 0 (4), drop 1 (5) -> cap.
  // State before: [0,2,2,0] after lifting pit 3; + pit0 1, pit1 3 -> [1,3,2,0]. No hand left.
  it('maxSowPerMove stops the move after exactly that many seeds', () => {
    const s = makeState([3, 1, 1, 1], [2, 2, 2, 2], { options: { maxSowPerMove: 5 } });
    const r = sow(s, 0);
    expect(r.sown).toBe(5);
    expect(r.state.pits[0]).toEqual([1, 3, 2, 0]);
    expect(r.state.pits[1]).toEqual([2, 2, 2, 2]);
    expect(r.captured).toBe(false);
    expect(r.events[r.events.length - 1]).toEqual({ type: 'capped' });
    expect(r.events.filter((e) => e.type === 'drop')).toHaveLength(5);
    expect(total(r.state)).toBe(total(s));
    expect(r.state.toMove).toBe(1);
    expect(r.state.phase).toBe('sow');
    expect(r.state.moveCount).toBe(1);
  });
  // [2,0,0,0] cap 2 would normally sleep in empty inner pit 2 and capture 7, but the cap
  // is reached at the same drop: the rule says the capped move makes no capture.
  it('a capped move makes no capture even where it would otherwise', () => {
    const s = capPos([3, 1, 2, 4], { options: { maxSowPerMove: 2 } });
    const r = sow(s, 0);
    expect(r.captured).toBe(false);
    expect(r.state.pits[1]).toEqual([3, 1, 2, 4]);
    expect(r.state.captured).toEqual([0, 0]);
    expect(r.state.phase).toBe('sow');
    expect(r.events[r.events.length - 1]).toEqual({ type: 'capped' });
  });
  // Seeds in hand when the cap hits must not vanish: [3,0,0,0] cap 1.
  it('conserves seeds when the cap hits with seeds still in hand', () => {
    const s = makeState([3, 0, 0, 0], [2, 2, 2, 2], { options: { maxSowPerMove: 1 } });
    const r = sow(s, 0);
    expect(r.sown).toBe(1);
    expect(sum(r.state.pits[0])).toBe(3);
    expect(r.events[r.events.length - 1]).toEqual({ type: 'capped' });
  });

  // moveCount 10 with maxMoves 10: P0 has 2 seeds on board, P1 8 -> P1 wins on seeds.
  it('maxMoves: more seeds on the board wins', () => {
    const o = { maxMoves: 10 };
    expect(
      outcome(makeState([2, 0, 0, 0], [2, 2, 2, 2], { moveCount: 10, options: o })),
    ).toEqual({ over: true, winner: 1, reason: 'move-limit' });
    expect(
      outcome(makeState([2, 2, 2, 0], [2, 0, 0, 0], { moveCount: 10, options: o })),
    ).toEqual({ over: true, winner: 0, reason: 'move-limit' });
  });
  it('maxMoves: equal seeds is a draw', () => {
    expect(
      outcome(makeState([2, 2, 0, 0], [2, 2, 0, 0], { moveCount: 10, options: { maxMoves: 10 } })),
    ).toEqual({ over: true, winner: null, reason: 'move-limit' });
  });
  it('legalPits is empty once the limit is reached; not over below it', () => {
    const o = { maxMoves: 10 };
    const at = makeState([2, 2, 0, 0], [2, 2, 0, 0], { moveCount: 10, options: o });
    expect(legalPits(at)).toEqual([]);
    expect(() => sow(at, 0)).toThrow();
    const below = makeState([2, 2, 0, 0], [2, 2, 0, 0], { moveCount: 9, options: o });
    expect(outcome(below)).toEqual({ over: false });
    expect(legalPits(below)).toEqual([0, 1]);
  });
  // moveCount 9, cols 3 [2,0,0,0,0,0] vs 12 seeds: sow -> moveCount 10 = limit; P0 has 2, P1 12.
  it('reaching the limit by playing a move ends the game', () => {
    const s = makeState([2, 0, 0, 0, 0, 0], [2, 2, 2, 2, 2, 2], {
      moveCount: 9,
      options: { maxMoves: 10 },
    });
    const r = sow(s, 0).state;
    expect(r.moveCount).toBe(10);
    expect(outcome(r)).toEqual({ over: true, winner: 1, reason: 'move-limit' });
  });
  it('defaults are 1000 / 150', () => {
    expect(CLASSIC.maxSowPerMove).toBe(1000);
    expect(CLASSIC.maxMoves).toBe(150);
  });
});

describe('player 1 moves', () => {
  // Mirror of the simple sow: state.pits[1] is sown, pits[0] untouched.
  it('sows pits[1] and passes the turn to player 0', () => {
    const p0 = [2, 2, 2, 2, 2, 2];
    const r = sow(makeState(p0, [2, 0, 0, 0, 0, 0], { toMove: 1 }), 0);
    expect(r.state.pits[1]).toEqual([0, 1, 1, 0, 0, 0]);
    expect(r.state.pits[0]).toEqual(p0);
    expect(r.state.toMove).toBe(0);
    expect(r.state.moveCount).toBe(1);
  });
  // P1 [2,0,0,0] ends at inner 2; captures P0 inner 3 (4) + outer 0 (3) = 7 for player 1.
  it('captures from pits[0] and scores for player 1', () => {
    const s = makeState([3, 1, 2, 4], [2, 0, 0, 0], { toMove: 1 });
    const r = sow(s, 0);
    expect(r.state.pits[0]).toEqual([0, 1, 2, 0]);
    expect(r.state.pits[1]).toEqual([0, 1, 1, 0]);
    expect(r.state.captured).toEqual([0, 7]);
    expect(r.state.phase).toBe('bonus');
    expect(r.state.toMove).toBe(1);
    expect(bonusOptions(r.state)).toEqual([1, 2]);
    const t = takeBonus(r.state, 2);
    expect(t.captured).toEqual([0, 9]);
    expect(t.pits[0]).toEqual([0, 1, 0, 0]);
    expect(t.toMove).toBe(0);
    expect(t.moveCount).toBe(1);
  });
  it('player 1 can win by no-moves', () => {
    expect(outcome(makeState([0, 0, 0, 0], [2, 2, 2, 2], { toMove: 0 })).over).toBe(true);
    expect(
      outcome(makeState([2, 2, 2, 2], [0, 0, 0, 0], { toMove: 1 })),
    ).toEqual({ over: true, winner: 0, reason: 'no-moves' });
  });
});

describe('legalMoves / applyMove', () => {
  it('each returned move re-applies to the same state (classic start)', () => {
    const s = newGame(CLASSIC);
    const moves = legalMoves(s);
    expect(moves.length).toBeGreaterThanOrEqual(16);
    for (const m of moves) expect(applyMove(s, m.move)).toEqual(m.state);
  });
  it('each returned move re-applies to the same state (quick start, player 1)', () => {
    const s = newGame(QUICK, 1);
    for (const m of legalMoves(s)) expect(applyMove(s, m.move)).toEqual(m.state);
  });
  // cols 3. P0 [0,0,2,0,0,0], only pit 2 is legal. It sleeps at inner 4 and captures
  // opp inner 4 + outer 1 (1+1 = 2) from P1 all 1s. Opp then has pits 0,2,3,5 -> 4 bonus choices.
  const capture3 = (bonusPits: number) =>
    makeState([0, 0, 2, 0, 0, 0], [1, 1, 1, 1, 1, 1], { options: { bonusPits } });
  it('expands a capture into one entry per bonus choice', () => {
    const s = capture3(1);
    const moves = legalMoves(s);
    expect(moves.map((m) => m.move)).toEqual([
      { pit: 2, bonus: [0] },
      { pit: 2, bonus: [2] },
      { pit: 2, bonus: [3] },
      { pit: 2, bonus: [5] },
    ]);
    for (const m of moves) {
      expect(m.state.captured).toEqual([3, 0]); // 2 + the 1-seed bonus pit
      expect(m.state.toMove).toBe(1);
      expect(m.state.moveCount).toBe(1);
      expect(applyMove(s, m.move)).toEqual(m.state);
    }
  });
  it('with bonusPits = 2 lists each unordered pair once', () => {
    const s = capture3(2);
    const moves = legalMoves(s);
    expect(moves.map((m) => m.move.bonus)).toEqual([
      [0, 2],
      [0, 3],
      [0, 5],
      [2, 3],
      [2, 5],
      [3, 5],
    ]);
    for (const m of moves) {
      expect(m.state.captured).toEqual([4, 0]);
      expect(applyMove(s, m.move)).toEqual(m.state);
    }
  });
  it('a non-capture move has an empty bonus list', () => {
    const s = makeState([2, 0, 0, 0, 0, 0], [2, 2, 2, 2, 2, 2]);
    const moves = legalMoves(s);
    expect(moves).toHaveLength(1);
    expect(moves[0].move).toEqual({ pit: 0, bonus: [] });
  });
  it('legalMoves is empty when the game is over', () => {
    expect(legalMoves(makeState([0, 0, 0, 0], [2, 2, 2, 2]))).toEqual([]);
  });
  it('applyMove throws if a required bonus pick is missing', () => {
    expect(() => applyMove(capture3(1), { pit: 2, bonus: [] })).toThrow();
    expect(() => applyMove(capture3(2), { pit: 2, bonus: [0] })).toThrow();
  });
  it('applyMove throws on an illegal pit or an empty bonus pit', () => {
    expect(() => applyMove(capture3(1), { pit: 0, bonus: [] })).toThrow();
    expect(() => applyMove(capture3(1), { pit: 2, bonus: [1] })).toThrow(); // pit 1 was captured
  });
});

describe('purity', () => {
  it('sow does not mutate its input', () => {
    for (const s of [
      newGame(CLASSIC),
      capPos([3, 1, 2, 4]),
      makeState([3, 1, 1, 1], [2, 2, 2, 2], { options: { maxSowPerMove: 5 } }),
    ]) {
      const before = clone(s);
      for (const p of legalPits(s)) sow(s, p);
      expect(clone(s)).toEqual(before);
    }
  });
  it('takeBonus does not mutate its input', () => {
    const s = sow(capPos([3, 1, 2, 4], { options: { bonusPits: 2 } }), 0).state;
    const before = clone(s);
    takeBonus(s, 1);
    takeBonus(s, 2);
    expect(clone(s)).toEqual(before);
  });
  it('legalMoves / applyMove do not mutate', () => {
    const s = newGame(CLASSIC);
    const before = clone(s);
    const ms = legalMoves(s);
    applyMove(s, ms[0].move);
    expect(clone(s)).toEqual(before);
  });
});

describe('property: random games', () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('300 random games conserve seeds, stay non-negative and terminate', () => {
    for (let g = 0; g < 300; g++) {
      const rnd = mulberry32(1000 + g);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
      const opts = g % 2 === 0 ? CLASSIC : QUICK;
      let s = newGame(opts, (g % 4 < 2 ? 0 : 1) as 0 | 1);
      const start = total(s);
      const check = () => {
        expect(total(s)).toBe(start);
        for (const side of s.pits) for (const n of side) expect(n).toBeGreaterThanOrEqual(0);
      };
      let steps = 0;
      while (!outcome(s).over) {
        if (++steps > 1000) throw new Error(`game ${g} did not terminate`);
        const lp = legalPits(s);
        expect(lp.length).toBeGreaterThan(0);
        const r = sow(s, pick(lp));
        s = r.state;
        check();
        while (s.phase === 'bonus') {
          const opts2 = bonusOptions(s);
          expect(opts2.length).toBeGreaterThan(0);
          s = takeBonus(s, pick(opts2));
          check();
        }
        expect(s.phase).toBe('sow');
      }
      const o = outcome(s);
      expect(o.over).toBe(true);
      expect(s.moveCount).toBeLessThanOrEqual(opts.maxMoves);
      if (o.over && o.reason === 'no-moves') expect(legalPits(s)).toEqual([]);
      check();
    }
    // Seeded, so the result never varies; the long limit is for a busy machine.
  }, 30000);
});
