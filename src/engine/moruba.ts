/**
 * Moruba rules engine. Pure TypeScript: no DOM, no 3D, no randomness.
 * The ruleset is RULES.md. Every function is pure (states are never mutated).
 *
 * Pit indexing (per player, from that player's own seat):
 *   0 .. cols-1        outer row (nearest the player), left to right
 *   cols .. 2*cols-1   inner row (next to the opponent), right to left
 * Sowing goes index +1 (mod 2*cols), which is counter-clockwise seen from above.
 * Both players use the same scheme from their own seat (the board is
 * symmetric under a half turn).
 */

export type Player = 0 | 1;

export interface Options {
  /** Pits per row: 8 (classic) or 6 (quick). */
  cols: number;
  /** Seeds per pit at the start. */
  seedsPerPit: number;
  /** Extra opponent pits taken after a capture (1; competition option 2). */
  bonusPits: number;
  /** A single move stops (without capturing) once it has sown this many seeds. */
  maxSowPerMove: number;
  /** After this many moves in total the game is decided on seeds. */
  maxMoves: number;
}

export const CLASSIC: Options = {
  cols: 8,
  seedsPerPit: 2,
  bonusPits: 1,
  maxSowPerMove: 1000,
  maxMoves: 150,
};

export const QUICK: Options = { ...CLASSIC, cols: 6 };

export interface State {
  readonly options: Options;
  /** pits[player][index], see the indexing note above. */
  readonly pits: readonly [readonly number[], readonly number[]];
  /** Whose turn it is. During the bonus phase: the player who is choosing. */
  readonly toMove: Player;
  /** 'sow': toMove picks a pit to sow. 'bonus': toMove picks an opponent pit to take. */
  readonly phase: 'sow' | 'bonus';
  /** Bonus picks still owed in the bonus phase (0 otherwise). */
  readonly bonusLeft: number;
  /** Completed moves (a capture's bonus picks belong to the same move). */
  readonly moveCount: number;
  /** Seeds each player has captured (removed from the board). */
  readonly captured: readonly [number, number];
}

/** What happened during a sow, in order; drives the animation. */
export type SowEvent =
  /** All `count` seeds are lifted from the mover's pit `pit`. */
  | { type: 'lift'; pit: number; count: number }
  /** One seed is dropped into the mover's pit `pit`. */
  | { type: 'drop'; pit: number }
  /**
   * The mover's last seed fell in the empty inner pit `at`; the opponent's
   * pits `pits` (opponent indexing: [inner] or [inner, outer]) are emptied.
   */
  | { type: 'capture'; at: number; pits: number[]; seeds: number }
  /** The per-move sowing cap was reached; the move stopped here. */
  | { type: 'capped' };

export interface SowResult {
  state: State;
  events: SowEvent[];
  /** Seeds sown during the move. */
  sown: number;
  /** True if the move made a capture. */
  captured: boolean;
}

export type Outcome =
  | { over: false }
  | {
      over: true;
      /** null = draw. */
      winner: Player | null;
      reason: 'no-moves' | 'move-limit';
    };

/** A whole turn for search: the pit sown plus any bonus pits taken. */
export interface Move {
  pit: number;
  bonus: number[];
}

export function other(p: Player): Player {
  return p === 0 ? 1 : 0;
}

export function loopSize(options: Options): number {
  return options.cols * 2;
}

export function isInner(options: Options, pit: number): boolean {
  return pit >= options.cols;
}

/** Column of a pit, counted from its owner's left (0 .. cols-1). */
export function columnOf(options: Options, pit: number): number {
  return pit < options.cols ? pit : 2 * options.cols - 1 - pit;
}

/**
 * For one of my inner pits: the opponent's facing inner pit and the outer pit
 * behind it, in the opponent's indexing. Null for an outer pit.
 */
export function facing(
  options: Options,
  pit: number,
): { inner: number; outer: number } | null {
  const c = options.cols;
  if (pit < c || pit >= 2 * c) return null;
  return { inner: 3 * c - 1 - pit, outer: pit - c };
}

export function newGame(
  options: Options = CLASSIC,
  firstPlayer: Player = 0,
): State {
  const row = (): number[] =>
    new Array<number>(loopSize(options)).fill(options.seedsPerPit);
  return {
    options,
    pits: [row(), row()],
    toMove: firstPlayer,
    phase: 'sow',
    bonusLeft: 0,
    moveCount: 0,
    captured: [0, 0],
  };
}

/** Build a state from explicit pit counts (tests, puzzles, the tutorial). */
export function makeState(
  pits0: readonly number[],
  pits1: readonly number[],
  init: Partial<Omit<State, 'pits' | 'options'>> & {
    options?: Partial<Options>;
  } = {},
): State {
  const options: Options = {
    ...CLASSIC,
    cols: pits0.length / 2,
    ...init.options,
  };
  if (
    !Number.isInteger(options.cols) ||
    pits0.length !== loopSize(options) ||
    pits1.length !== loopSize(options)
  ) {
    throw new Error('makeState: each side needs 2 * cols pits');
  }
  return {
    options,
    pits: [[...pits0], [...pits1]],
    toMove: init.toMove ?? 0,
    phase: init.phase ?? 'sow',
    bonusLeft: init.bonusLeft ?? 0,
    moveCount: init.moveCount ?? 0,
    captured: init.captured ?? [0, 0],
  };
}

export function seedsOf(state: State, player: Player): number {
  let n = 0;
  for (const s of state.pits[player]) n += s;
  return n;
}

function legalPitsFor(pits: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pits.length; i++) if (pits[i] >= 2) out.push(i);
  if (out.length > 0) return out;
  // Singletons: only when no pit holds two or more, and only into an empty pit.
  for (let i = 0; i < pits.length; i++) {
    if (pits[i] === 1 && pits[(i + 1) % pits.length] === 0) out.push(i);
  }
  return out;
}

function limitReached(state: State): boolean {
  return state.phase === 'sow' && state.moveCount >= state.options.maxMoves;
}

/** Pits the player to move may sow from. Empty in the bonus phase or when the game is over. */
export function legalPits(state: State): number[] {
  if (state.phase !== 'sow' || limitReached(state)) return [];
  return legalPitsFor(state.pits[state.toMove]);
}

/** Opponent pits (opponent indexing) the chooser may take in the bonus phase. */
export function bonusOptions(state: State): number[] {
  if (state.phase !== 'bonus') return [];
  const opp = state.pits[other(state.toMove)];
  const out: number[] = [];
  for (let i = 0; i < opp.length; i++) if (opp[i] > 0) out.push(i);
  return out;
}

export function outcome(state: State): Outcome {
  if (state.phase !== 'sow') return { over: false };
  if (legalPitsFor(state.pits[state.toMove]).length === 0) {
    return { over: true, winner: other(state.toMove), reason: 'no-moves' };
  }
  if (limitReached(state)) {
    const a = seedsOf(state, 0);
    const b = seedsOf(state, 1);
    return {
      over: true,
      winner: a === b ? null : a > b ? 0 : 1,
      reason: 'move-limit',
    };
  }
  return { over: false };
}

function endTurn(
  state: State,
  pits: [number[], number[]],
  captured: [number, number],
): State {
  return {
    options: state.options,
    pits,
    toMove: other(state.toMove),
    phase: 'sow',
    bonusLeft: 0,
    moveCount: state.moveCount + 1,
    captured,
  };
}

/** Sow from `pit`. Throws if the pit is not legal. */
export function sow(state: State, pit: number): SowResult {
  if (!legalPits(state).includes(pit)) {
    throw new Error(`sow: pit ${pit} is not a legal move`);
  }
  const { options } = state;
  const me = state.toMove;
  const opp = other(me);
  const n = loopSize(options);
  const mine = [...state.pits[me]];
  const theirs = [...state.pits[opp]];
  const captured: [number, number] = [state.captured[0], state.captured[1]];
  const events: SowEvent[] = [];
  const pack = (): [number[], number[]] =>
    me === 0 ? [mine, theirs] : [theirs, mine];

  let sown = 0;
  let pos = pit;
  let hand = mine[pos];
  mine[pos] = 0;
  events.push({ type: 'lift', pit: pos, count: hand });

  for (;;) {
    pos = (pos + 1) % n;
    mine[pos] += 1;
    hand -= 1;
    sown += 1;
    events.push({ type: 'drop', pit: pos });
    if (sown >= options.maxSowPerMove) {
      // Safety cap: the move ends where it is, any seeds in hand go down here.
      mine[pos] += hand;
      events.push({ type: 'capped' });
      return {
        state: endTurn(state, pack(), captured),
        events,
        sown,
        captured: false,
      };
    }
    if (hand > 0) continue;
    if (mine[pos] === 1) break; // fell in an empty pit: the move sleeps
    hand = mine[pos]; // relay: lift the lot, including the seed just sown
    mine[pos] = 0;
    events.push({ type: 'lift', pit: pos, count: hand });
  }

  const f = facing(options, pos);
  if (f === null || theirs[f.inner] === 0) {
    return {
      state: endTurn(state, pack(), captured),
      events,
      sown,
      captured: false,
    };
  }

  const taken = theirs[f.outer] > 0 ? [f.inner, f.outer] : [f.inner];
  let seeds = 0;
  for (const t of taken) {
    seeds += theirs[t];
    theirs[t] = 0;
  }
  captured[me] += seeds;
  events.push({ type: 'capture', at: pos, pits: taken, seeds });

  const bonusAvailable = theirs.some((s) => s > 0);
  if (options.bonusPits <= 0 || !bonusAvailable) {
    return {
      state: endTurn(state, pack(), captured),
      events,
      sown,
      captured: true,
    };
  }
  return {
    state: {
      options,
      pits: pack(),
      toMove: me,
      phase: 'bonus',
      bonusLeft: options.bonusPits,
      moveCount: state.moveCount,
      captured,
    },
    events,
    sown,
    captured: true,
  };
}

/** Take the opponent pit `oppPit` (opponent indexing) as a capture bonus. */
export function takeBonus(state: State, oppPit: number): State {
  if (state.phase !== 'bonus') throw new Error('takeBonus: not in bonus phase');
  const me = state.toMove;
  const opp = other(me);
  const theirs = [...state.pits[opp]];
  const seeds = theirs[oppPit];
  if (!(seeds > 0)) throw new Error(`takeBonus: pit ${oppPit} is empty`);
  theirs[oppPit] = 0;
  const captured: [number, number] = [state.captured[0], state.captured[1]];
  captured[me] += seeds;
  const mine = [...state.pits[me]];
  const pits: [number[], number[]] = me === 0 ? [mine, theirs] : [theirs, mine];
  const left = state.bonusLeft - 1;
  if (left > 0 && theirs.some((s) => s > 0)) {
    return { ...state, pits, captured, bonusLeft: left };
  }
  return endTurn(state, pits, captured);
}

/** Apply a whole turn (sow plus bonus picks). Throws if the bonus list does not fit. */
export function applyMove(state: State, move: Move): State {
  let s = sow(state, move.pit).state;
  for (const b of move.bonus) s = takeBonus(s, b);
  if (s.phase === 'bonus') throw new Error('applyMove: bonus pick missing');
  return s;
}

/** Every whole turn available to the player to move, with the resulting state. */
export function legalMoves(state: State): { move: Move; state: State }[] {
  const out: { move: Move; state: State }[] = [];
  const expand = (s: State, pit: number, bonus: number[], from: number) => {
    if (s.phase !== 'bonus') {
      out.push({ move: { pit, bonus }, state: s });
      return;
    }
    // Bonus picks are unordered: only take pits in increasing index order.
    for (const b of bonusOptions(s)) {
      if (b < from) continue;
      expand(takeBonus(s, b), pit, [...bonus, b], b + 1);
    }
  };
  for (const pit of legalPits(state)) expand(sow(state, pit).state, pit, [], 0);
  return out;
}
