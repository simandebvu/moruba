/**
 * "How to play": a short hands-on lesson on the quick (4×6) board. Each stage
 * is a prepared position with one pit to play, chosen so the move shows one
 * rule: plain sowing, relay sowing, then a capture with its bonus pick.
 * `lesson.test.ts` checks every stage against the rules engine.
 */

import { makeState, QUICK, type State } from '../engine/moruba.js';

export interface LessonStage {
  /** A few words: what to do. "Pinch" becomes "Click" for the mouse. */
  ask: string;
  /** One short line under it. */
  askNote: string;
  /** Shown for a moment after the move has played out. */
  after: string;
  afterNote: string;
  /** The human's pit to play. */
  pit: number;
  /** Seeds per pit, in engine order: the human's side, then the opponent's. */
  mine: number[];
  theirs: number[];
}

/**
 * The lesson is learned by doing: each step is a few words, and the board
 * shows the rest (a glowing pit, gold rings to follow, the capture itself).
 */
export const LESSON: LessonStage[] = [
  {
    ask: 'Pinch the glowing pit',
    askNote: 'The two rows nearest you are yours.',
    after: 'That is a move',
    afterNote: 'One seed per pit, round your two rows.',
    pit: 1,
    mine: [2, 3, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2],
    theirs: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  {
    ask: 'Now this one',
    askNote: 'Watch where the last seed lands.',
    after: 'It kept going!',
    afterNote: 'Land on seeds and you scoop them up and carry on.',
    pit: 0,
    mine: [2, 0, 2, 0, 0, 0, 2, 2, 2, 2, 2, 2],
    theirs: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  {
    ask: 'Now take their seeds',
    askNote: 'End in your empty inner pit, facing theirs.',
    after: 'You captured!',
    afterNote: 'Leave them with no move and you win. Ready?',
    pit: 4,
    mine: [2, 2, 2, 2, 2, 0, 0, 2, 2, 2, 2, 2],
    theirs: [3, 2, 2, 0, 2, 2, 2, 2, 5, 2, 2, 4],
  },
];

/** While carrying seeds by hand. */
export const LESSON_SWEEP = {
  ask: 'Sweep over the gold rings',
  note: 'A seed drops in each one.',
};

/** After a capture: the extra pit. */
export const LESSON_BONUS = {
  ask: 'Take one more pit',
  note: 'A capture wins you any pit of theirs.',
};

export function lessonState(stage: LessonStage): State {
  return makeState(stage.mine, stage.theirs, { options: QUICK, toMove: 0 });
}
