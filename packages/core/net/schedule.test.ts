import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC, decide, makeSchedule, places, scoreOf, specFor, winnerOf } from './schedule.ts';
import type { ObstacleResult } from '../types/net.ts';

describe('makeSchedule', () => {
  it('is a pure function of seed, duration and spec', () => {
    expect(makeSchedule(42, 90_000)).toEqual(makeSchedule(42, 90_000));
    expect(makeSchedule(42, 90_000)).not.toEqual(makeSchedule(43, 90_000));
    expect(makeSchedule(42, 90_000, specFor('squat-flap'))).not.toEqual(makeSchedule(42, 90_000));
  });

  it('respects the run-in, the gaps and the end pad, with ids 1..n in time order', () => {
    for (const seed of [1, 7, 123456789, 0xffffffff]) {
      const s = makeSchedule(seed, 60_000);
      expect(s[0]?.t).toBe(DEFAULT_SPEC.firstMs);
      s.forEach((o, i) => {
        expect(o.id).toBe(i + 1);
        expect(Number.isInteger(o.t)).toBe(true);
        expect(o.t).toBeLessThan(60_000 - DEFAULT_SPEC.endPadMs);
        const prev = s[i - 1];
        if (prev) {
          expect(o.t - prev.t).toBeGreaterThanOrEqual(DEFAULT_SPEC.minGapMs);
          expect(o.t - prev.t).toBeLessThanOrEqual(DEFAULT_SPEC.maxGapMs);
        }
      });
    }
  });

  it('gives a sensible number of obstacles for a 90 s match', () => {
    const n = makeSchedule(5, 90_000).length;
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThan(45);
  });

  it('is empty when the match is shorter than the run-in', () => {
    expect(makeSchedule(1, 3000)).toEqual([]);
  });
});

describe('scoreOf', () => {
  const course = makeSchedule(9, 30_000);
  const ev = (pairs: [number, 'pass' | 'hit'][]): ObstacleResult[] => pairs.map(([ob, k]) => ({ ob, k }));

  it('scores passes with a combo bonus capped at +100%', () => {
    const all = course.map((o) => ({ ob: o.id, k: 'pass' as const }));
    const s = scoreOf(course, all);
    let expected = 0;
    for (let c = 1; c <= course.length; c++) expected += Math.round(100 * (1 + Math.min(10, c - 1) * 0.1));
    expect(s).toEqual({ score: expected, hits: 0, passes: course.length, bestCombo: course.length });
  });

  it('breaks the combo on a hit and counts missing outcomes as neither', () => {
    const s = scoreOf(course, ev([[1, 'pass'], [2, 'pass'], [3, 'hit'], [5, 'pass']]));
    expect(s).toEqual({ score: 100 + 110 + 100, hits: 1, passes: 3, bestCombo: 2 });
  });

  it('keeps the first outcome per obstacle and ignores unknown obstacles', () => {
    const s = scoreOf(course, ev([[1, 'hit'], [1, 'pass'], [999, 'pass']]));
    expect(s).toEqual({ score: 0, hits: 1, passes: 0, bestCombo: 0 });
  });
});

describe('decide, places, winnerOf', () => {
  const S = (score: number, hits: number, bestCombo: number) => ({ score, hits, passes: 0, bestCombo });

  it('breaks ties on score, then fewer hits, then longer combo', () => {
    expect(decide(S(500, 3, 2), S(400, 0, 9))).toBe(1);
    expect(decide(S(500, 3, 2), S(500, 2, 1))).toBe(-1);
    expect(decide(S(500, 2, 4), S(500, 2, 3))).toBe(1);
    expect(decide(S(500, 2, 4), S(500, 2, 4))).toBe(0);
  });

  it('gives shared places to equal results and skips the next place', () => {
    const scores = { a: S(300, 1, 3), b: S(300, 1, 3), c: S(200, 0, 2), d: S(500, 0, 5) };
    const p = places(scores, ['a', 'b', 'c', 'd']);
    expect(p).toEqual({ d: 1, a: 2, b: 2, c: 4 });
    expect(winnerOf(p)).toBe('d');
    expect(winnerOf(places({ a: S(1, 0, 1), b: S(1, 0, 1) }, ['a', 'b']))).toBeNull();
  });

  it('ranks only the listed seats', () => {
    const p = places({ a: S(1, 0, 1), b: S(9, 0, 1), c: S(5, 0, 1) }, ['a', 'c']);
    expect(p).toEqual({ c: 1, a: 2 });
  });
});
