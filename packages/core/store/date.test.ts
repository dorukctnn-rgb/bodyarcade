// B13: one local-date rule. The tests pin time zones so they pass on any machine.
import { describe, expect, it } from 'vitest';
import { addDays, dayFromSeed, dayOf, daySeed, daysBetween, isDay, monthOf, parseDay, prevDay, weekStart, weekdayIndex } from './date.ts';

describe('dayOf', () => {
  // 2026-10-23 22:30 UTC
  const t = Date.UTC(2026, 9, 23, 22, 30);

  it('gives each time zone its own calendar day', () => {
    expect(dayOf(t, 'UTC')).toBe('2026-10-23');
    expect(dayOf(t, 'Pacific/Auckland')).toBe('2026-10-24');   // UTC+13 in October: already tomorrow
    expect(dayOf(t, 'America/New_York')).toBe('2026-10-23');
    expect(dayOf(t, 'Pacific/Honolulu')).toBe('2026-10-23');   // UTC-10: 12:30 the same day
  });

  it('changes the day at local midnight, not at UTC midnight (the v1 free-run bug)', () => {
    // Istanbul is UTC+3, so local midnight is 21:00 UTC
    const justBefore = Date.UTC(2026, 9, 23, 20, 59, 59);
    const justAfter = Date.UTC(2026, 9, 23, 21, 0, 0);
    expect(dayOf(justBefore, 'Europe/Istanbul')).toBe('2026-10-23');
    expect(dayOf(justAfter, 'Europe/Istanbul')).toBe('2026-10-24');
    // v1 counted free runs by the UTC date, so its counter rolled over at 03:00 local time, not at midnight
    expect(dayOf(justAfter, 'UTC')).toBe('2026-10-23');
  });

  it('follows daylight saving without skipping or repeating a day', () => {
    // US clocks go back on 2026-11-01 at 02:00 local
    const days = new Set<string>();
    for (let h = 0; h < 96; h++) days.add(dayOf(Date.UTC(2026, 9, 31, 4) + h * 3_600_000, 'America/New_York'));
    expect([...days].sort()).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('uses the device zone when none is given and rejects non-finite input', () => {
    expect(dayOf(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(() => dayOf(Number.NaN)).toThrow(RangeError);
  });
});

describe('day arithmetic', () => {
  it('validates real calendar dates', () => {
    expect(isDay('2026-10-23')).toBe(true);
    expect(isDay('2026-02-29')).toBe(false);      // not a leap year
    expect(isDay('2028-02-29')).toBe(true);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-1-1')).toBe(false);
    expect(isDay('26-10-23')).toBe(false);
    expect(isDay(20261023)).toBe(false);
    expect(parseDay('1969-12-31')).toBeNull();
  });

  it('adds and subtracts days across month, year and leap boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(prevDay('2026-01-01')).toBe('2025-12-31');
    expect(prevDay('2028-03-01')).toBe('2028-02-29');
    expect(addDays('2026-10-23', 0)).toBe('2026-10-23');
    expect(addDays('2026-10-23', -23)).toBe('2026-09-30');
    expect(() => addDays('nope', 1)).toThrow(RangeError);
  });

  it('counts the days between two days', () => {
    expect(daysBetween('2026-10-23', '2026-10-24')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-23')).toBe(-1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('keeps the v1 daily-goal seed and converts it back', () => {
    expect(daySeed('2026-10-23')).toBe(20261023);
    expect(dayFromSeed(20261023)).toBe('2026-10-23');
    expect(dayFromSeed(20261323)).toBeNull();
    expect(dayFromSeed(0)).toBeNull();
    expect(dayFromSeed('20261023')).toBeNull();
    expect(dayFromSeed(2026.5)).toBeNull();
  });
});

describe('weeks and months of the calendar', () => {
  it('counts Monday as the first day of the week', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0);      // a Monday
    expect(weekdayIndex('2026-10-24')).toBe(5);      // the Saturday of the plan
    expect(weekdayIndex('2026-10-25')).toBe(6);
    expect(weekdayIndex('2026-10-26')).toBe(0);
    expect(() => weekdayIndex('nope')).toThrow(RangeError);
  });

  it('finds the Monday of a week, also across a month, a year and a leap day', () => {
    expect(weekStart('2026-10-24')).toBe('2026-10-19');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(weekStart('2028-03-01')).toBe('2028-02-28');
  });

  it('names the month of a day', () => {
    expect(monthOf('2026-10-24')).toBe('2026-10');
    expect(monthOf('2027-01-01')).toBe('2027-01');
    expect(() => monthOf('2026-02-30')).toThrow(RangeError);
  });
});
