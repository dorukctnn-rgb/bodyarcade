// The habit: three minutes make an active day, three active days make a week, and a missed day is covered by a rest day
// instead of breaking everything. The streaks are worked out from facts, so two devices agree when they swap them.
import { describe, expect, it } from 'vitest';
import { addDays, type Day } from './date.ts';
import { EMPTY_DAYS, daysOf, withDay } from './dayset.ts';
import { HABIT, createHabit, describeHabit, emptyHabitDoc, mergeHabitDocs, readHabitDoc, settlement, type Habit } from './habit.ts';
import { createStore, memoryStorage, type BodyArcadeStore } from './store.ts';

const noon = (day: Day): number => Date.parse(`${day}T12:00:00Z`);

// Monday 19 October 2026 starts the week the tests live in (the 24th is the Saturday of the plan).
const MON = '2026-10-19';
const day = (n: number): Day => addDays(MON, n);

interface Rig { store: BodyArcadeStore; habit: Habit; at(d: Day): void; storage: ReturnType<typeof memoryStorage>; paid: { on: boolean } }

function rig(start: Day = MON, shared?: { storage: ReturnType<typeof memoryStorage> }): Rig {
  const clock = { t: noon(start) };
  const storage = shared?.storage ?? memoryStorage();
  const store = createStore({ storage, now: () => clock.t, timeZone: 'UTC' });
  const paid = { on: false };
  return { store, habit: createHabit(store, { paid: () => paid.on }), at: (d) => { clock.t = noon(d); }, storage, paid };
}

/** One round of `seconds` on day `d`. */
const play = (r: Rig, d: Day, seconds = 200): ReturnType<Habit['addPlay']> => { r.at(d); return r.habit.addPlay(seconds); };

describe('an active day', () => {
  it('needs three minutes of play in all games together, and says so on the call that gets there', () => {
    const r = rig();
    expect(HABIT.activeDaySeconds).toBe(180);
    expect(play(r, MON, 100)).toMatchObject({ day: MON, seconds: 100, becameActive: false });
    expect(r.habit.view()).toMatchObject({ todaySeconds: 100, todayActive: false });
    expect(play(r, MON, 90)).toMatchObject({ seconds: 190, becameActive: true });
    expect(play(r, MON, 60)).toMatchObject({ seconds: 250, becameActive: false });
    expect(r.habit.view()).toMatchObject({ todaySeconds: 250, todayActive: true });
  });

  it('is one round of an ordinary game: the games last 155 to 420 seconds', () => {
    const r = rig();
    expect(play(r, MON, 196).becameActive).toBe(true);
  });

  it('adds nothing for what is not a number of seconds, and never throws', () => {
    const r = rig();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, '12' as unknown as number, null as unknown as number, undefined as unknown as number]) {
      expect(() => r.habit.addPlay(bad)).not.toThrow();
    }
    expect(r.habit.view().todaySeconds).toBe(0);
    expect(r.habit.addPlay(1e12).seconds).toBe(HABIT.maxSeconds);
  });

  it('is counted for the day of the clock, which changes at the player\'s own midnight', () => {
    const clock = { t: Date.UTC(2026, 9, 23, 22, 30) };
    const store = createStore({ storage: memoryStorage(), now: () => clock.t, timeZone: 'Pacific/Auckland' });
    const habit = createHabit(store);
    expect(habit.addPlay(200).day).toBe('2026-10-24');       // 22:30 UTC is 11:30 the next morning in Auckland
    expect(habit.view().today).toBe('2026-10-24');
  });

  it('keeps the seconds of the last days only', () => {
    const r = rig();
    play(r, MON, 100);
    r.at(addDays(MON, 40));
    r.habit.addPlay(10);
    const stored = JSON.parse(r.storage.getItem('ba2.habit.seconds') as string) as { d: Record<string, number> };
    expect(Object.keys(stored.d)).toEqual([addDays(MON, 40)]);
  });
});

describe('the week streak', () => {
  it('counts the weeks that had three active days, and the week that is running as soon as it has them', () => {
    const r = rig();
    play(r, day(0)); play(r, day(2));
    expect(r.habit.view()).toMatchObject({ weekStreak: 0, week: { days: 2, met: false } });
    play(r, day(4));
    expect(r.habit.view()).toMatchObject({ weekStreak: 1, week: { days: 3, met: true } });
    play(r, day(7)); play(r, day(9));
    expect(r.habit.view()).toMatchObject({ weekStreak: 1, week: { days: 2, met: false, start: day(7) } });      // week one still counts, week two is not over
    play(r, day(11));
    expect(r.habit.view()).toMatchObject({ weekStreak: 2 });
  });

  it('is not broken by a week that has not ended yet, and is broken by one that ended short', () => {
    const r = rig();
    for (const n of [0, 1, 2, 7, 8, 9]) play(r, day(n));                  // two full weeks
    r.at(day(14));                                                         // Monday of week three: nothing yet
    expect(r.habit.view()).toMatchObject({ weekStreak: 2, week: { days: 0 } });
    r.at(day(20));                                                         // Sunday of week three, still nothing
    expect(r.habit.view().weekStreak).toBe(2);
    play(r, day(21));                                                      // Monday of week four: week three ended with no days
    r.at(day(21));
    expect(r.habit.view()).toMatchObject({ weekStreak: 0, week: { days: 1 } });
  });

  it('does not count a first, partial week against anybody', () => {
    const r = rig();
    play(r, day(5)); play(r, day(6));                                      // started on a Saturday: two days that week
    for (const n of [7, 9, 11]) play(r, day(n));
    expect(r.habit.view().weekStreak).toBe(1);
  });

  it('says whether the goal can still be reached, without ever warning about a loss', () => {
    const r = rig();
    r.at(day(5));                                                          // Saturday, nothing yet
    expect(r.habit.view().week).toMatchObject({ days: 0, daysLeft: 2, canStillMeet: false });
    play(r, day(5));
    expect(r.habit.view().week).toMatchObject({ days: 1, daysLeft: 2, canStillMeet: false });      // today counted, one day left
    const s = rig();
    play(s, day(0));
    s.at(day(4));                                                          // Friday with one day: Fri, Sat, Sun left
    expect(s.habit.view().week).toMatchObject({ days: 1, daysLeft: 3, canStillMeet: true });
    expect(Object.keys(s.habit.view())).not.toContain('atRisk');
  });

  it('carries over a year end', () => {
    const r = rig('2026-12-28');                                           // a Monday
    play(r, '2026-12-28'); play(r, '2026-12-30'); play(r, '2027-01-01');
    expect(r.habit.view()).toMatchObject({ weekStreak: 1, week: { start: '2026-12-28', end: '2027-01-03', days: 3 } });
  });
});

describe('the day streak and the rest days', () => {
  it('goes on over one missed day, which is covered by the week\'s rest day', () => {
    const r = rig();
    play(r, day(0));
    play(r, day(2));
    expect(r.habit.view()).toMatchObject({ dayStreak: 2, rest: { allowance: 1, used: 1, available: 0 } });
    expect(daysOf(r.habit.doc().r)).toEqual([day(1)]);
  });

  it('is broken by a second missed day in the same week, for a free player', () => {
    const r = rig();
    play(r, day(0));
    play(r, day(3));                                                       // Tuesday and Wednesday missed
    expect(r.habit.view().dayStreak).toBe(1);
    expect(daysOf(r.habit.doc().r)).toEqual([day(1)]);                     // one rest day was used, then the streak was over
  });

  it('is kept over two missed days by a paid plan', () => {
    const r = rig();
    r.paid.on = true;
    play(r, day(0));
    play(r, day(3));
    expect(r.habit.view()).toMatchObject({ dayStreak: 2, rest: { allowance: 2, used: 2, available: 0 } });
  });

  it('does not count a rest day as a day played', () => {
    const r = rig();
    for (const n of [0, 2, 4]) play(r, day(n));                            // Monday, Wednesday, Friday: Tuesday rested, Thursday not
    expect(r.habit.view().dayStreak).toBe(1);
    const q = rig();
    q.paid.on = true;
    for (const n of [0, 2, 4]) play(q, day(n));
    expect(q.habit.view()).toMatchObject({ dayStreak: 3, week: { days: 3, met: true } });
  });

  it('gives each week its own rest day', () => {
    const r = rig();
    play(r, day(5));                                                       // Saturday
    play(r, day(7 + 1));                                                   // Tuesday of the next week: Sunday and Monday missed
    expect(r.habit.view().dayStreak).toBe(2);                              // Saturday and Tuesday were played, the two days between were rested
    expect(daysOf(r.habit.doc().r)).toEqual([day(6), day(7)]);             // Sunday with the rest day of week one, Monday with that of week two
  });

  it('is alive through today and through yesterday, and over when neither was played or rested', () => {
    const r = rig();
    play(r, day(0)); play(r, day(1));
    r.at(day(2));                                                          // today not played yet
    expect(r.habit.view().dayStreak).toBe(2);
    r.at(day(3));                                                          // yesterday missed: the rest day covers it
    expect(r.habit.view().dayStreak).toBe(2);
    r.at(day(4));                                                          // two days missed: over
    expect(r.habit.view().dayStreak).toBe(0);
  });

  it('judges a gap once: a plan bought afterwards does not bring an old streak back', () => {
    const r = rig();
    play(r, day(0));
    r.at(day(5));
    expect(r.habit.settle()).toEqual([day(1)]);                            // Tuesday rested, Wednesday not: the streak ended there
    r.paid.on = true;
    expect(r.habit.settle()).toEqual([]);
    play(r, day(5));
    expect(r.habit.view().dayStreak).toBe(1);
  });

  it('shows the same before and after the rest days were written', () => {
    const r = rig();
    play(r, day(0));
    r.at(day(2));
    const before = r.habit.view();
    expect(r.habit.settle()).toEqual([day(1)]);
    expect(r.habit.view()).toEqual(before);
    expect(r.habit.settle()).toEqual([]);
  });

  it('uses nothing before the first day ever played, and nothing for a player who was never here', () => {
    const r = rig();
    r.at(day(30));
    expect(r.habit.settle()).toEqual([]);
    expect(r.habit.view()).toMatchObject({ dayStreak: 0, weekStreak: 0, rest: { used: 0, available: 1 } });
  });

  it('hands out the days a week by the week of the missed day, not by the day of the return', () => {
    const r = rig();
    play(r, day(6));                                                       // Sunday
    play(r, day(9));                                                       // Wednesday: Monday and Tuesday missed, both in the next week
    expect(r.habit.view().dayStreak).toBe(1);                              // one rest day for that week: Monday rested, Tuesday not
    expect(daysOf(r.habit.doc().r)).toEqual([day(7)]);
  });
});

describe('the pure functions', () => {
  const a = (...ds: Day[]) => ds.reduce((s, d) => withDay(s, d), EMPTY_DAYS);

  it('settlement stops at the first missed day that no rest day covers', () => {
    expect(settlement(a(day(0)), EMPTY_DAYS, day(4), { allowance: 2, settledThrough: null })).toEqual([day(1), day(2)]);
    expect(settlement(a(day(0)), EMPTY_DAYS, day(4), { allowance: 1, settledThrough: null })).toEqual([day(1)]);
    expect(settlement(a(day(0)), EMPTY_DAYS, day(4), { allowance: 0, settledThrough: null })).toEqual([]);
    expect(settlement(a(day(0), day(1)), EMPTY_DAYS, day(2), { allowance: 1, settledThrough: null })).toEqual([]);
  });

  it('settlement does not look at a gap again once it was judged, and not at the days after today', () => {
    expect(settlement(a(day(0)), EMPTY_DAYS, day(4), { allowance: 2, settledThrough: day(3) })).toEqual([]);
    expect(settlement(a(day(0), day(9)), EMPTY_DAYS, day(4), { allowance: 2, settledThrough: null })).toEqual([day(1), day(2)]);
  });

  it('describeHabit ignores days that have not come yet (a wrong clock somewhere)', () => {
    const v = describeHabit(a(day(0), day(1), day(2), day(40)), EMPTY_DAYS, day(2), { todaySeconds: 0, allowance: 1 });
    expect(v.week.days).toBe(3);
    expect(describeHabit(a(day(0), day(1), day(2)), EMPTY_DAYS, day(0), { todaySeconds: 0, allowance: 1 }).week.days).toBe(1);
  });
});

describe('two devices', () => {
  it('agree once they have swapped what they know, in any order and any number of times', () => {
    const phone = rig();
    const laptop = rig();
    play(phone, day(0)); play(phone, day(2));
    play(laptop, day(1)); play(laptop, day(3)); play(laptop, day(4));
    phone.at(day(4)); laptop.at(day(4));
    const fromPhone = phone.habit.doc();
    const fromLaptop = laptop.habit.doc();
    expect(phone.habit.merge(fromLaptop)).toBe(true);
    expect(laptop.habit.merge(fromPhone)).toBe(true);
    expect(phone.habit.merge(laptop.habit.doc())).toBe(false);             // nothing new the second time
    const shown = (h: Habit) => ({ ...h.view(), todaySeconds: 0 });        // the seconds of today are each device's own
    expect(shown(laptop.habit)).toEqual(shown(phone.habit));
    expect(phone.habit.view()).toMatchObject({ dayStreak: 5, weekStreak: 1, week: { days: 5 } });
    expect(phone.habit.doc()).toEqual(laptop.habit.doc());
  });

  it('merges documents as a union that does not depend on the order', () => {
    const x = { ...emptyHabitDoc(), a: [0, 2, 9].reduce((s, n) => withDay(s, day(n)), EMPTY_DAYS), r: withDay(EMPTY_DAYS, day(1)) };
    const y = { ...emptyHabitDoc(), a: [1, 3].reduce((s, n) => withDay(s, day(n)), EMPTY_DAYS), r: withDay(EMPTY_DAYS, day(8)) };
    expect(mergeHabitDocs(x, y)).toEqual(mergeHabitDocs(y, x));
    expect(mergeHabitDocs(mergeHabitDocs(x, y), y)).toEqual(mergeHabitDocs(x, y));
    expect(mergeHabitDocs(x, emptyHabitDoc())).toEqual(x);
  });

  it('take no day from the future, however the other clock was set', () => {
    const r = rig();
    play(r, day(0));
    r.habit.merge({ v: 1, a: { '2030-01': 0b111, '2026-10': 1 << 20 }, r: { '2031-05': 1 } });   // the 21st of this month and days in 2030, 2031
    expect(daysOf(r.habit.doc().a)).toEqual([day(0)]);
    expect(daysOf(r.habit.doc().r)).toEqual([]);
    r.habit.merge({ v: 1, a: { '2026-10': 1 << 19 }, r: {} });                                 // the 20th: tomorrow may be today on a clock a zone ahead
    expect(daysOf(r.habit.doc().a)).toEqual([day(0), day(1)]);
  });

  it.each([null, undefined, 5, 'x', [], {}, { v: 2, a: {}, r: {} }, { v: 1, a: 'x', r: 5 }])('does not trip over a document that is not one: %j', (raw) => {
    const r = rig();
    play(r, day(0));
    expect(() => r.habit.merge(raw)).not.toThrow();
    expect(daysOf(r.habit.doc().a)).toEqual([day(0)]);
  });

  it('reads a document with a field missing as an empty set, and a newer version not at all', () => {
    expect(readHabitDoc({ v: 1 })).toEqual({ v: 1, a: {}, r: {} });
    expect(readHabitDoc({ v: 2, a: {}, r: {} })).toBeNull();
  });
});

describe('what is kept', () => {
  it('a document of a year of every day, rested and played, is far below the 3,000 characters a synced document may have', () => {
    const r = rig();
    for (let n = 0; n < 400; n++) play(r, addDays(MON, n));
    const text = JSON.stringify(r.habit.doc());
    expect(text.length).toBeLessThan(900);
    expect(Object.keys(r.habit.doc().a).length).toBeLessThanOrEqual(HABIT.keepMonths);
  });

  it('forgets nothing when the page is closed and opened again', () => {
    const r = rig();
    play(r, day(0)); play(r, day(2));
    const again = rig(day(2), { storage: r.storage });
    again.at(day(2));
    expect(again.habit.view()).toEqual(r.habit.view());
  });

  it('starts empty from damaged storage without throwing, and touches no other key', () => {
    const r = rig();
    r.storage.setItem('ba2.habit.active', '{"v":1,"d":"garbage"}');
    r.storage.setItem('ba2.habit.rest', 'not json');
    r.storage.setItem('ba2.runner.runs', 'untouched');
    expect(r.habit.view()).toMatchObject({ dayStreak: 0, weekStreak: 0 });
    expect(() => r.habit.addPlay(300)).not.toThrow();
    expect(r.storage.getItem('ba2.runner.runs')).toBe('untouched');
  });
});
