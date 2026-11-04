import { describe, expect, it } from 'vitest';
import { beatCrossed, pickWidth, sceneOf, shrinkOf, stageStep } from './home-motion.ts';

describe('home motion', () => {
  it('fetches the smallest loop that covers the box at the screen density, at most 2', () => {
    expect(pickWidth([944, 1418], 900, 1)).toBe(944);
    expect(pickWidth([944, 1418], 900, 2)).toBe(1418);
    expect(pickWidth([944, 1418], 358, 3)).toBe(944);
    expect(pickWidth([944, 1418], 2000, 1)).toBe(1418);
  });

  it('the camera stage moves through its three steps and shrinks the picture in the middle one', () => {
    expect([0, 0.29, 0.3, 0.67, 0.68, 1].map(stageStep)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(shrinkOf(0)).toBe(0);
    expect(shrinkOf(1)).toBe(1);
  });

  it('gives each scene of the pinned stage an equal stretch and holds the first before and the last after', () => {
    expect(sceneOf(-0.3, 10)).toBe(0);
    expect(sceneOf(0, 10)).toBe(0);
    expect(sceneOf(0.099, 10)).toBe(0);
    expect(sceneOf(0.1, 10)).toBe(1);
    expect(sceneOf(0.95, 10)).toBe(9);
    expect(sceneOf(1, 10)).toBe(9);
    expect(sceneOf(1.4, 10)).toBe(9);
    expect(sceneOf(0.5, 0)).toBe(-1);
  });

  it('notices a beat passed between two looks, also across the start of the loop', () => {
    const beats = [0.13, 1.1, 3.33, 7.1];
    expect(beatCrossed(beats, 1, 1.2)).toBe(true);
    expect(beatCrossed(beats, 1.2, 3)).toBe(false);
    expect(beatCrossed(beats, 3.33, 3.4)).toBe(false);
    expect(beatCrossed(beats, 7.3, 0.05)).toBe(false);
    expect(beatCrossed(beats, 7.3, 0.2)).toBe(true);
    expect(beatCrossed(beats, 7, 0.05)).toBe(true);
    expect(beatCrossed([], 0, 5)).toBe(false);
  });
});
