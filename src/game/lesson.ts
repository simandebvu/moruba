/**
 * "How to play": a short hands-on lesson on the quick (4×6) board. Each stage
 * is a prepared position with one pit to play, chosen so the move shows one
 * rule: plain sowing, relay sowing, then a capture with its bonus pick.
 * `lesson.test.ts` checks every stage against the rules engine.
 */

import { makeState, QUICK, type State } from '../engine/moruba.js';

export interface LessonStage {
  title: string;
  /** Shown while the player is asked to play `pit`. */
  ask: string;
  /** Shown after the move has played out. */
  after: string;
  /** The human's pit to play. */
  pit: number;
  /** Seeds per pit, in engine order: the human's side, then the opponent's. */
  mine: number[];
  theirs: number[];
}

export const LESSON: LessonStage[] = [
  {
    title: 'Sowing',
    ask: 'The two rows nearest you are yours. Pinch the glowing pit to pick up its seeds, carry them over the next pits, then let go.',
    after:
      'Seeds drop one per pit, anticlockwise round your two rows. The last one fell in an empty pit, so the move ended.',
    pit: 1,
    mine: [2, 3, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2],
    theirs: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  {
    title: 'Keep going',
    ask: 'Now this pit. Watch where the last seed lands.',
    after:
      'The last seed landed on other seeds, so you scooped them all up and carried on. A move only ends in an empty pit.',
    pit: 0,
    mine: [2, 0, 2, 0, 0, 0, 2, 2, 2, 2, 2, 2],
    theirs: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  },
  {
    title: 'Capturing',
    ask: 'This move ends in an empty pit of your inner row, right opposite their seeds. Play it.',
    after:
      'You took the two pits facing yours, plus one of your choice. Captured seeds leave the game.',
    pit: 4,
    mine: [2, 2, 2, 2, 2, 0, 0, 2, 2, 2, 2, 2],
    theirs: [3, 2, 2, 0, 2, 2, 2, 2, 5, 2, 2, 4],
  },
];

export const LESSON_BONUS =
  'A capture also wins you any one other pit of theirs. Pinch the one you want; the glowing one is the fullest.';

export const LESSON_END = {
  title: 'How to win',
  body: 'Play needs a pit with 2 or more seeds. Whoever runs out of moves loses, so capture their seeds and guard your inner row.',
};

export function lessonState(stage: LessonStage): State {
  return makeState(stage.mine, stage.theirs, { options: QUICK, toMove: 0 });
}
