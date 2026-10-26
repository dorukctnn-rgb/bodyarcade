// The daily goal as data. The runner's spec must give, for any date, exactly the goal the live site gives.
import { describe, expect, it } from 'vitest';
import { dailyGoalFor, goalText, lcg, nextStreak, type DailyGoalSpec } from './daily.ts';
import { addDays, daySeed } from './date.ts';
import { RUNNER_DAILY } from './runner-v1.ts';

describe('the draw order of v1', () => {
  // Values computed with v1's own algorithm (site/game/store.js:136-148) on the day this module was written.
  const golden: [string, { seed: number; variant: string; kind: string; stat: string; target: number }][] = [
    ['2026-10-23', { seed: 20261023, variant: 'desert', kind: 'score', stat: 'score', target: 2000 }],
    ['2026-01-01', { seed: 20260101, variant: 'alps', kind: 'coins', stat: 'coins', target: 30 }],
    ['2027-02-28', { seed: 20270228, variant: 'desert', kind: 'coins', stat: 'coins', target: 30 }],
    ['2026-12-31', { seed: 20261231, variant: 'alps', kind: 'coins', stat: 'coins', target: 25 }],
    ['2026-10-24', { seed: 20261024, variant: 'alps', kind: 'score', stat: 'score', target: 2000 }],
    ['2026-10-25', { seed: 20261025, variant: 'forest', kind: 'score', stat: 'score', target: 2000 }],
    ['2028-02-29', { seed: 20280229, variant: 'forest', kind: 'score', stat: 'score', target: 2500 }],
  ];
  for (const [day, want] of golden) {
    it(`gives the live site's goal for ${day}`, () => {
      expect(dailyGoalFor(day, RUNNER_DAILY)).toEqual({ day, ...want });
    });
  }

  it('is a pure function of the day', () => {
    expect(dailyGoalFor('2026-10-23', RUNNER_DAILY)).toEqual(dailyGoalFor('2026-10-23', RUNNER_DAILY));
  });

  it('only ever picks the spec\'s variants, kinds and target ranges, over four years', () => {
    const seen = { variants: new Set<string>(), kinds: new Set<string>() };
    for (let d = '2026-01-01', i = 0; i < 1461; i++, d = addDays(d, 1)) {
      const g = dailyGoalFor(d, RUNNER_DAILY);
      seen.variants.add(g.variant);
      seen.kinds.add(g.kind);
      expect(RUNNER_DAILY.variants).toContain(g.variant);
      const kind = RUNNER_DAILY.kinds.find((k) => k.kind === g.kind);
      expect(kind).toBeDefined();
      const steps = (g.target - (kind?.base ?? 0)) / (kind?.step ?? 1);
      expect(Number.isInteger(steps) && steps >= 0 && steps < (kind?.count ?? 0)).toBe(true);
      expect(g.seed).toBe(daySeed(d));
    }
    expect(seen.variants.size).toBe(3);
    expect(seen.kinds.size).toBe(3);
  });

  it('lcg is the generator v1 copied into sim.js and the engine', () => {
    const r = lcg(20261023);
    const first = r();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    const again = lcg(20261023);
    expect(again()).toBe(first);
    expect(lcg(1)()).not.toBe(lcg(2)());
  });
});

describe('a spec needs something to pick from', () => {
  it('throws for an empty spec', () => {
    expect(() => dailyGoalFor('2026-10-23', { variants: [], kinds: RUNNER_DAILY.kinds })).toThrow(RangeError);
    expect(() => dailyGoalFor('2026-10-23', { variants: ['a'], kinds: [] })).toThrow(RangeError);
  });

  it('throws for a day that is not a day', () => {
    expect(() => dailyGoalFor('2026-02-30', RUNNER_DAILY)).toThrow(RangeError);
  });
});

describe('goal text', () => {
  const spec: DailyGoalSpec = {
    variants: ['a'],
    kinds: [{ kind: 'score', stat: 'score', base: 12_000, step: 0, count: 1, text: { en: 'Score {target} in one run', tr: 'Tek turda {target} puan yap' } }],
  };
  const goal = dailyGoalFor('2026-10-23', spec);

  it('fills the target, formatted for the language', () => {
    expect(goalText(goal, spec, 'en')).toBe('Score 12,000 in one run');
    expect(goalText(goal, spec, 'tr')).toBe('Tek turda 12.000 puan yap');
  });

  it('falls back from a region to the language and then to English', () => {
    expect(goalText(goal, spec, 'tr-TR')).toBe('Tek turda 12.000 puan yap');
    expect(goalText(goal, spec, 'de')).toBe('Score 12.000 in one run');
  });

  it('survives a locale tag the runtime does not know', () => {
    expect(goalText(goal, spec, 'not a locale!!')).toContain('12000');
  });

  it('is empty for a goal whose kind the spec no longer has', () => {
    expect(goalText({ ...goal, kind: 'gone' }, spec, 'en')).toBe('');
  });
});

describe('streak', () => {
  it('continues only when yesterday was finished', () => {
    expect(nextStreak({ n: 4, last: '2026-10-22' }, '2026-10-23', '2026-10-22')).toBe(5);
    expect(nextStreak({ n: 4, last: '2026-10-21' }, '2026-10-23', '2026-10-22')).toBe(1);
    expect(nextStreak({ n: 0, last: null }, '2026-10-23', '2026-10-22')).toBe(1);
  });
});
