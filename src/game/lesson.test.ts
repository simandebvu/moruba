import { describe, expect, it } from 'vitest';
import { bonusOptions, legalPits, sow } from '../engine/moruba.js';
import { LESSON, lessonState } from './lesson.js';

function play(index: number) {
  const stage = LESSON[index];
  const state = lessonState(stage);
  expect(legalPits(state)).toContain(stage.pit);
  return sow(state, stage.pit);
}

describe('how-to-play lesson positions', () => {
  it('never needs more seeds than the quick board holds', () => {
    for (const stage of LESSON) {
      const total = [...stage.mine, ...stage.theirs].reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(48);
    }
  });

  it('stage 1 is a plain sow that ends in an empty pit', () => {
    const result = play(0);
    expect(result.events.filter((e) => e.type === 'lift')).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'drop')).toHaveLength(3);
    expect(result.captured).toBe(false);
  });

  it('stage 2 relays once and does not capture', () => {
    const result = play(1);
    expect(result.events.filter((e) => e.type === 'lift')).toHaveLength(2);
    expect(result.captured).toBe(false);
  });

  it('stage 3 captures both facing pits and offers a bonus pick', () => {
    const result = play(2);
    expect(result.events.filter((e) => e.type === 'lift')).toHaveLength(1);
    expect(result.captured).toBe(true);
    const capture = result.events.find((e) => e.type === 'capture');
    expect(capture && capture.type === 'capture' && [...capture.pits].sort((a, b) => a - b)).toEqual([0, 11]);
    expect(result.state.phase).toBe('bonus');
    expect(bonusOptions(result.state)).toContain(8);
  });
});
