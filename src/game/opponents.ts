/**
 * The three people you play against, in order. Each is one AI strength with a
 * name and a few things to say, so a game is against someone.
 */

import type { Level } from '../engine/search.js';

export interface Opponent {
  name: string;
  level: Level;
  /** Said when a game against them starts. */
  intro: string;
  /** Said after they capture. */
  gloat: readonly string[];
  /** Said after you capture. */
  rue: readonly string[];
  /** Said when they win / when you win. */
  won: string;
  lost: string;
}

export const OPPONENTS: readonly Opponent[] = [
  {
    name: 'Thabo',
    level: 'easy',
    intro: 'I only learned last week. Go easy on me!',
    gloat: ['Ha! Did you see that?', 'I got some!', 'That worked?'],
    rue: ['Hey, those were mine!', 'I did not see that coming.', 'Ouch.'],
    won: 'I won! Wait until I tell my sister.',
    lost: 'Good game. Lerato will not be so easy.',
  },
  {
    name: 'Lerato',
    level: 'medium',
    intro: 'Thabo says you are good. Let us see.',
    gloat: ['Watch your inner row.', 'You left that open.', 'Thank you for those.'],
    rue: ['Nicely done.', 'I should have guarded that.', 'Fair. My turn.'],
    won: 'Close, but not today. Again?',
    lost: 'Well played. Now go and try Koko Mokgadi.',
  },
  {
    name: 'Koko Mokgadi',
    level: 'hard',
    intro: 'Sit, my child. I have played this for sixty years.',
    gloat: ['Patience wins seeds.', 'You hurried, my child.', 'An old trick.'],
    rue: ['Hm. You have been taught well.', 'That one I felt.', 'Good. Again.'],
    won: 'Come back tomorrow. You are learning.',
    lost: 'Hau! Nobody has beaten me in years. Well done.',
  },
];
