// The day set: small, and a merge that two devices can run in any order and any number of times.
import { describe, expect, it } from 'vitest';
import { addDays, type Day } from './date.ts';
import { lcg } from './daily.ts';
import { EMPTY_DAYS, countDays, daySetParser, daysOf, dropAfter, hasDay, lastDay, mergeDays, pruneDays, sameDays, withDay, type DaySet } from './dayset.ts';
import { BAD } from './schema.ts';

const build = (days: readonly Day[]): DaySet => days.reduce<DaySet>((s, d) => withDay(s, d), EMPTY_DAYS);

/** A set of random days in the year after a start day, from a seed (nothing here is random between runs). */
function randomSet(seed: number, n: number): DaySet {
  const r = lcg(seed);
  let s: DaySet = EMPTY_DAYS;
  for (let i = 0; i < n; i++) s = withDay(s, addDays('2026-01-01', Math.floor(r() * 400)));
  return s;
}

describe('adding and finding days', () => {
  it('holds a day exactly when it was added', () => {
    const s = build(['2026-10-24', '2026-10-31', '2026-11-01']);
    expect(hasDay(s, '2026-10-24')).toBe(true);
    expect(hasDay(s, '2026-10-25')).toBe(false);
    expect(hasDay(s, '2026-09-24')).toBe(false);
    expect(daysOf(s)).toEqual(['2026-10-24', '2026-10-31', '2026-11-01']);
  });

  it('handles the 31st (bit 30) without a negative number, and the 29th of February', () => {
    const s = build(['2026-10-31', '2026-01-31', '2028-02-29', '2026-12-31']);
    for (const bits of Object.values(s)) expect(bits).toBeGreaterThan(0);
    expect(daysOf(s)).toEqual(['2026-01-31', '2026-10-31', '2026-12-31', '2028-02-29']);
    expect(hasDay(s, '2026-10-31')).toBe(true);
    expect(hasDay(s, '2026-10-30')).toBe(false);
    const full = build(Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
    expect(full['2026-10']).toBe(0x7fffffff);
    expect(daysOf(full)).toHaveLength(31);
  });

  it('gives back the same object for a day it holds, and ignores what is not a day', () => {
    const s = build(['2026-10-24']);
    expect(withDay(s, '2026-10-24')).toBe(s);
    expect(withDay(s, 'nope')).toBe(s);
    expect(withDay(s, '2026-02-30')).toBe(s);
    expect(hasDay(s, 'nope')).toBe(false);
  });

  it('never changes the set it was given', () => {
    const s = build(['2026-10-24']);
    const frozen = JSON.stringify(s);
    withDay(s, '2026-10-25');
    mergeDays(s, build(['2026-10-26']));
    pruneDays(s, 0);
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe('counting and the latest day', () => {
  const s = build(['2026-10-19', '2026-10-21', '2026-10-24', '2026-10-26']);

  it('counts the days between two days, both included, also across a month end', () => {
    expect(countDays(s, '2026-10-19', '2026-10-25')).toBe(3);
    expect(countDays(s, '2026-10-24', '2026-10-24')).toBe(1);
    expect(countDays(s, '2026-10-25', '2026-10-25')).toBe(0);
    expect(countDays(build(['2026-10-31', '2026-11-01']), '2026-10-30', '2026-11-02')).toBe(2);
  });

  it('counts nothing for a backwards or broken range', () => {
    expect(countDays(s, '2026-10-25', '2026-10-19')).toBe(0);
    expect(countDays(s, 'nope', '2026-10-25')).toBe(0);
  });

  it('knows the latest day', () => {
    expect(lastDay(s)).toBe('2026-10-26');
    expect(lastDay(EMPTY_DAYS)).toBeNull();
    expect(lastDay({ '2026-10': 0, '2026-09': 1 })).toBe('2026-09-01');
  });
});

describe('the merge is a union that any order and any repetition agree on', () => {
  it('is commutative, associative and idempotent, on sets of hundreds of days', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const a = randomSet(seed, 120);
      const b = randomSet(seed + 100, 90);
      const c = randomSet(seed + 200, 60);
      expect(mergeDays(a, b)).toEqual(mergeDays(b, a));
      expect(mergeDays(mergeDays(a, b), c)).toEqual(mergeDays(a, mergeDays(b, c)));
      expect(mergeDays(a, a)).toEqual(a);
      expect(mergeDays(mergeDays(a, b), b)).toEqual(mergeDays(a, b));
    }
  });

  it('loses no day that either side wrote and invents none', () => {
    const a = randomSet(7, 80);
    const b = randomSet(8, 80);
    const both = new Set([...daysOf(a), ...daysOf(b)]);
    expect(new Set(daysOf(mergeDays(a, b)))).toEqual(both);
  });

  it('two devices that wrote different days on the same day end with both of them', () => {
    const phone = build(['2026-10-24']);
    const laptop = build(['2026-10-24', '2026-10-25']);
    expect(daysOf(mergeDays(phone, laptop))).toEqual(['2026-10-24', '2026-10-25']);
  });

  it('is equal when the days are equal, whatever order they were added in', () => {
    const days: Day[] = ['2026-10-05', '2026-10-30', '2026-09-01', '2027-01-02'];
    expect(sameDays(build(days), build([...days].reverse()))).toBe(true);
    expect(sameDays(build(days), build(days.slice(1)))).toBe(false);
    expect(sameDays({ '2026-10': 0 }, EMPTY_DAYS)).toBe(true);
  });
});

describe('staying small', () => {
  it('keeps the newest months that hold a day, and doing it twice changes nothing more', () => {
    const s = build(['2025-01-10', '2025-06-10', '2026-03-10', '2026-10-10']);
    const kept = pruneDays(s, 2);
    expect(daysOf(kept)).toEqual(['2026-03-10', '2026-10-10']);
    expect(pruneDays(kept, 2)).toBe(kept);
    expect(pruneDays(s, 99)).toBe(s);
    expect(daysOf(pruneDays(s, 0))).toEqual([]);
  });

  it('a year of every single day is a dozen short numbers', () => {
    let s: DaySet = EMPTY_DAYS;
    for (let i = 0; i < 365; i++) s = withDay(s, addDays('2026-01-01', i));
    expect(Object.keys(s)).toHaveLength(12);
    expect(JSON.stringify(s).length).toBeLessThan(260);
  });

  it('the merge of two pruned sets pruned again is what pruning the union gives for the newest months', () => {
    const a = randomSet(3, 150);
    const b = randomSet(4, 150);
    expect(pruneDays(mergeDays(pruneDays(a, 6), pruneDays(b, 6)), 6)).toEqual(pruneDays(mergeDays(a, b), 6));
  });
});

describe('reading a set back from storage or from another device', () => {
  const parse = daySetParser(12);

  it('takes a set as it was written', () => {
    const s = build(['2026-10-24', '2026-10-31']);
    expect(parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('is not fooled by what is not a set', () => {
    for (const raw of [null, undefined, 5, 'x', [], [1, 2], true]) expect(parse(raw)).toBe(BAD);
  });

  it('drops months that are not months and bitmaps that are not bitmaps, keeping the good ones', () => {
    const out = parse({ '2026-10': 5, '2026-13': 5, '26-10': 5, '2026-11': -1, '2026-12': 1.5, '2027-01': 'x', '2027-02': 2 ** 31, '2027-03': null, '2027-04': 3 });
    expect(out).toEqual({ '2026-10': 5, '2027-04': 3 });
  });

  it('clears the bits that lie beyond the end of a month and drops a month left empty', () => {
    expect(parse({ '2026-02': 0x7fffffff, '2028-02': 0x7fffffff, '2026-04': 1 << 30, '2026-11': 1 << 30 })).toEqual({ '2026-02': (1 << 28) - 1, '2028-02': (1 << 29) - 1 });
  });

  it('cannot carry __proto__ or any other key in, and caps the number of months', () => {
    const hostile = JSON.parse('{"__proto__": 5, "constructor": 5, "2026-10": 1}') as unknown;
    expect(parse(hostile)).toEqual({ '2026-10': 1 });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 1]));
    const out = parse(many) as DaySet;
    expect(Object.keys(out)).toHaveLength(12);
    expect(Object.keys(out).sort()[0]).toBe('2025-05');
  });
});

describe('days that have not come yet', () => {
  const s = build(['2026-10-23', '2026-10-24', '2026-10-25', '2026-11-03', '2027-01-01']);

  it('are dropped, and the day itself stays', () => {
    expect(daysOf(dropAfter(s, '2026-10-24'))).toEqual(['2026-10-23', '2026-10-24']);
    expect(daysOf(dropAfter(s, '2026-10-31'))).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
    expect(daysOf(dropAfter(s, '2027-01-01'))).toEqual(daysOf(s));
  });

  it('give back the same object when nothing is later', () => {
    expect(dropAfter(s, '2030-01-01')).toBe(s);
    expect(dropAfter(s, 'nope')).toBe(s);
  });

  it('can cut at the 31st and at an empty month', () => {
    const t = build(['2026-10-30', '2026-10-31', '2026-12-05']);
    expect(daysOf(dropAfter(t, '2026-10-31'))).toEqual(['2026-10-30', '2026-10-31']);
    expect(daysOf(dropAfter(t, '2026-11-15'))).toEqual(['2026-10-30', '2026-10-31']);
    expect(daysOf(dropAfter(t, '2026-10-30'))).toEqual(['2026-10-30']);
  });
});
