// Achievements as data: the interpreter, the validator for definitions that come from JSON, and the runner's fifteen.
import { describe, expect, it } from 'vitest';
import { assertAchievementDefs, holds, isCond, newlyUnlocked, type AchievementContext, type AchievementDef, type Cond } from './achievements.ts';
import { RUNNER_ACHIEVEMENTS } from './runner-v1.ts';

interface CtxOverrides {
  run?: Partial<AchievementContext['run']>;
  totals?: AchievementContext['totals'];
  variants?: AchievementContext['variants'];
  streak?: number;
  friend?: AchievementContext['friend'];
}

const ctx = (over: CtxOverrides = {}): AchievementContext => ({
  run: { score: 1000, seconds: 60, complete: false, difficulty: 'medium', stats: {}, ...over.run },
  totals: over.totals ?? {},
  variants: over.variants ?? [],
  streak: over.streak ?? 0,
  friend: over.friend ?? null,
});

describe('conditions', () => {
  it('compares run stats, and score and seconds are always there', () => {
    expect(holds({ run: 'score', gte: 1000 }, ctx())).toBe(true);
    expect(holds({ run: 'score', gte: 1001 }, ctx())).toBe(false);
    expect(holds({ run: 'seconds', lte: 60 }, ctx())).toBe(true);
    expect(holds({ run: 'cleared', gte: 5 }, ctx({ run: { stats: { cleared: 5 } } }))).toBe(true);
    expect(holds({ run: 'hits', eq: 0 }, ctx({ run: { stats: { hits: 0 } } }))).toBe(true);
    expect(holds({ run: 'hits', eq: 0 }, ctx({ run: { stats: { hits: 1 } } }))).toBe(false);
  });

  it('a stat the game did not report never satisfies a condition, not even "no hits"', () => {
    expect(holds({ run: 'hits', eq: 0 }, ctx())).toBe(false);
    expect(holds({ run: 'hits', lte: 99 }, ctx())).toBe(false);
    expect(holds({ run: 'coins', gte: 0 }, ctx())).toBe(false);
  });

  it('ignores stats that are not finite numbers', () => {
    const bad = ctx({ run: { stats: { cleared: Number.NaN, hits: Number.POSITIVE_INFINITY } } });
    expect(holds({ run: 'cleared', gte: 0 }, bad)).toBe(false);
    expect(holds({ run: 'hits', gte: 0 }, bad)).toBe(false);
  });

  it('all and any combine', () => {
    const c: Cond = { all: [{ complete: true }, { any: [{ run: 'score', gte: 5000 }, { difficulty: ['hard'] }] }] };
    expect(holds(c, ctx({ run: { complete: true, difficulty: 'hard' } }))).toBe(true);
    expect(holds(c, ctx({ run: { complete: true, score: 6000 } }))).toBe(true);
    expect(holds(c, ctx({ run: { complete: true } }))).toBe(false);
    expect(holds(c, ctx({ run: { complete: false, difficulty: 'hard' } }))).toBe(false);
  });

  it('totals, variants, streak and the friend rival', () => {
    expect(holds({ total: 'runs', gte: 10 }, ctx({ totals: { runs: 10 } }))).toBe(true);
    expect(holds({ total: 'runs', gte: 10 }, ctx({ totals: { runs: 9 } }))).toBe(false);
    expect(holds({ total: 'kcal', gte: 1 }, ctx())).toBe(false);
    expect(holds({ variants: { gte: 2 } }, ctx({ variants: ['a', 'b'] }))).toBe(true);
    expect(holds({ variants: { includes: ['a', 'c'] } }, ctx({ variants: ['a', 'b'] }))).toBe(false);
    expect(holds({ variants: { includes: ['a', 'b'], gte: 3 } }, ctx({ variants: ['a', 'b'] }))).toBe(false);
    expect(holds({ streak: { gte: 3 } }, ctx({ streak: 3 }))).toBe(true);
    expect(holds({ beatFriend: true }, ctx({ friend: { score: 999 } }))).toBe(true);
    expect(holds({ beatFriend: true }, ctx({ friend: { score: 1000 } }))).toBe(false);
    expect(holds({ beatFriend: true }, ctx())).toBe(false);
  });

  it('an unknown condition holds for nothing', () => {
    expect(holds({ whatever: 1 } as unknown as Cond, ctx())).toBe(false);
  });
});

describe('definitions that come from JSON', () => {
  const good = { id: 'first-run', name: 'First steps', desc: 'Finish your first run', when: { total: 'runs', gte: 1 } };

  it('accepts the runner list', () => {
    expect(() => assertAchievementDefs(RUNNER_ACHIEVEMENTS)).not.toThrow();
    expect(RUNNER_ACHIEVEMENTS).toHaveLength(15);
    expect(new Set(RUNNER_ACHIEVEMENTS.map((a) => a.id)).size).toBe(15);
  });

  it('accepts localized texts', () => {
    expect(() => assertAchievementDefs([{ ...good, name: { en: 'First steps', tr: 'İlk adımlar' } }])).not.toThrow();
  });

  const bad: [string, unknown][] = [
    ['not a list', { id: 'x' }],
    ['a null entry', [null]],
    ['an upper-case id', [{ ...good, id: 'First' }]],
    ['an id with a space', [{ ...good, id: 'first run' }]],
    ['a duplicate id', [good, good]],
    ['no name', [{ ...good, name: undefined }]],
    ['an empty name', [{ ...good, name: '' }]],
    ['a very long description', [{ ...good, desc: 'x'.repeat(201) }]],
    ['a missing condition', [{ ...good, when: undefined }]],
    ['an empty condition', [{ ...good, when: {} }]],
    ['two operators in one condition', [{ ...good, when: { complete: true, beatFriend: true } }]],
    ['a run condition with no comparison', [{ ...good, when: { run: 'score' } }]],
    ['a run comparison that is not a number', [{ ...good, when: { run: 'score', gte: '5' } }]],
    ['an empty all list', [{ ...good, when: { all: [] } }]],
    ['complete false', [{ ...good, when: { complete: false } }]],
    ['total without a threshold', [{ ...good, when: { total: 'runs' } }]],
    ['variants with nothing in it', [{ ...good, when: { variants: {} } }]],
    ['variants with a stray field', [{ ...good, when: { variants: { gte: 2, other: 1 } } }]],
    ['a deep chain of all', [{ ...good, when: Array.from({ length: 12 }).reduce<Cond>((acc) => ({ all: [acc] }), { complete: true }) }]],
  ];
  for (const [label, raw] of bad) {
    it(`rejects ${label}`, () => {
      expect(() => assertAchievementDefs(raw), label).toThrow(TypeError);
    });
  }

  it('isCond is false for arrays, strings and null', () => {
    for (const x of [[], 'x', null, 5, undefined]) expect(isCond(x)).toBe(false);
  });
});

describe('newly unlocked', () => {
  const defs: AchievementDef[] = [
    { id: 'a', name: 'A', desc: 'a', when: { run: 'score', gte: 1 } },
    { id: 'b', name: 'B', desc: 'b', when: { run: 'score', gte: 2 } },
    { id: 'c', name: 'C', desc: 'c', when: { run: 'score', gte: 1_000_000 } },
  ];

  it('returns the ones that hold, in list order, and never repeats an unlocked one', () => {
    expect(newlyUnlocked(defs, ctx(), new Set()).map((d) => d.id)).toEqual(['a', 'b']);
    expect(newlyUnlocked(defs, ctx(), new Set(['a'])).map((d) => d.id)).toEqual(['b']);
    expect(newlyUnlocked(defs, ctx(), new Set(['a', 'b']))).toEqual([]);
  });
});
