// The daily challenge: the same free game for everybody on the same date, steady while the catalogue grows, and a record
// of the days that were done that two devices can merge.
import { describe, expect, it } from 'vitest';
import {
  CHALLENGE, createChallengeBook, dailyChallengeFor, emptyChallengeDoc, hash32, meetsChallenge, mergeChallengeDocs, readChallengeDoc,
  type ChallengeBook, type ChallengeGame,
} from './daily-challenge.ts';
import { addDays, type Day } from './date.ts';
import { EMPTY_DAYS, daysOf, withDay } from './dayset.ts';
import { createStore, memoryStorage } from './store.ts';

// The free games of the first release, as their manifests have them.
const FREE = ['firework-jacks', 'knee-sprint', 'pose-wall', 'road-run', 'squat-flap', 'star-catch', 'summit-climb', 'twist-turbine'];
const PRO = ['limbo-bend', 'pad-work', 'reaction-tag'];
const games = (free: readonly string[] = FREE, pro: readonly string[] = PRO): ChallengeGame[] => [...free.map((id) => ({ id, free: true })), ...pro.map((id) => ({ id, free: false }))];
const days = (n: number, from: Day = '2026-10-24'): Day[] => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('which game it is', () => {
  it('is the same for the same date, whoever asks and in whatever order the games come', () => {
    const a = dailyChallengeFor('2026-10-24', games());
    const b = dailyChallengeFor('2026-10-24', [...games()].reverse());
    expect(a).toEqual(b);
    expect(a).toMatchObject({ day: '2026-10-24', difficulty: 'normal', minSeconds: 60 });
    expect(FREE).toContain(a?.game);
  });

  it('is never a Pro game, so no day is locked for anybody, and ignores games that appear twice', () => {
    for (const d of days(400)) expect(FREE).toContain(dailyChallengeFor(d, games())?.game);
    expect(dailyChallengeFor('2026-10-24', [...games(), ...games()])).toEqual(dailyChallengeFor('2026-10-24', games()));
  });

  it('is nothing when there is no free game, and always that game when there is one', () => {
    expect(dailyChallengeFor('2026-10-24', [])).toBeNull();
    expect(dailyChallengeFor('2026-10-24', games([], PRO))).toBeNull();
    for (const d of days(20)) expect(dailyChallengeFor(d, games(['road-run'], PRO))?.game).toBe('road-run');
  });

  it('never has the same game two days in a row, for any number of free games from two up', () => {
    const names = Array.from({ length: 14 }, (_, i) => `game-${String.fromCharCode(97 + i)}`);
    for (let n = 2; n <= 14; n++) {
      const pool = names.slice(0, n).map((id) => ({ id, free: true }));
      let prev = '';
      for (const d of days(1500)) {
        const g = dailyChallengeFor(d, pool)?.game as string;
        expect(g, `${n} games, ${d}`).not.toBe(prev);
        prev = g;
      }
    }
  });

  it('gives each of the free games about its share of the days', () => {
    const count = new Map<string, number>();
    for (const d of days(1000)) { const g = dailyChallengeFor(d, games())?.game as string; count.set(g, (count.get(g) ?? 0) + 1); }
    expect([...count.keys()].sort()).toEqual([...FREE].sort());
    for (const [g, n] of count) expect(n, g).toBeGreaterThan(75);      // a fair share is 125
    for (const [g, n] of count) expect(n, g).toBeLessThan(175);
  });

  it('is steady when a game is added: it takes its own days and moves few of the others', () => {
    const before = games();
    const after = games([...FREE, 'new-game']);
    let moved = 0;
    let toNew = 0;
    for (const d of days(1000)) {
      const a = dailyChallengeFor(d, before)?.game;
      const b = dailyChallengeFor(d, after)?.game;
      if (a !== b) moved++;
      if (b === 'new-game') toNew++;
    }
    expect(toNew).toBeGreaterThan(60);                                 // it does get its share
    expect(moved).toBeLessThan(200);                                   // and most days keep the game they had (a list position would move almost all)
  });

  it('does not change with a Pro game added or taken away', () => {
    for (const d of days(100)) expect(dailyChallengeFor(d, games(FREE, PRO))).toEqual(dailyChallengeFor(d, games(FREE, [])));
  });

  it('changes with the date, over a year end and a leap day too', () => {
    const seen = new Set(['2026-12-31', '2027-01-01', '2028-02-28', '2028-02-29', '2028-03-01'].map((d) => dailyChallengeFor(d, games())?.game));
    expect(seen.size).toBeGreaterThan(1);
    expect(dailyChallengeFor('2028-02-29', games())?.day).toBe('2028-02-29');
  });

  it('hashes the same on every machine (a pinned value, so a change of the function is noticed)', () => {
    expect(hash32('')).toBe(2872998923);
    expect(hash32('a')).toBe(444641715);
    expect(hash32('squat-flap')).toBe(1475557140);
    expect(hash32('20261024|summit-climb')).toBe(4138163963);
    expect(dailyChallengeFor('2026-10-24', games())?.game).toBe('summit-climb');
    expect(dailyChallengeFor('2026-10-25', games())?.game).toBe('road-run');
  });
});

describe('what counts', () => {
  const c = dailyChallengeFor('2026-10-24', games()) as NonNullable<ReturnType<typeof dailyChallengeFor>>;

  it('is a round of the game of the day that lasted a minute, on any difficulty', () => {
    expect(meetsChallenge(c, { game: c.game, seconds: 60 })).toBe(true);
    expect(meetsChallenge(c, { game: c.game, seconds: 59.9 })).toBe(false);
    expect(meetsChallenge(c, { game: 'pad-work', seconds: 300 })).toBe(false);
    expect(CHALLENGE.minSeconds).toBe(60);
  });

  it('is not fooled by a number that is not one', () => {
    for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, '90' as unknown as number, null as unknown as number]) {
      expect(meetsChallenge(c, { game: c.game, seconds }), String(seconds)).toBe(false);
    }
  });
});

describe('the record of the days', () => {
  function rig(start: Day = '2026-10-24', list: () => readonly ChallengeGame[] = () => games()) {
    const clock = { t: Date.parse(`${start}T12:00:00Z`) };
    const store = createStore({ storage: memoryStorage(), now: () => clock.t, timeZone: 'UTC' });
    const book = createChallengeBook(store, { games: list });
    return { book, store, at: (d: Day) => { clock.t = Date.parse(`${d}T12:00:00Z`); } };
  }
  const todaysGame = (b: ChallengeBook): string => b.today().challenge?.game as string;

  it('starts with a challenge that is not done', () => {
    const { book } = rig();
    expect(book.today()).toMatchObject({ challenge: { day: '2026-10-24', difficulty: 'normal' }, done: false, bonus: false, doneThisWeek: 0 });
  });

  it('is done by one round of the game of the day, once, and says so on that round only', () => {
    const { book } = rig();
    const g = todaysGame(book);
    expect(book.record({ game: g, seconds: 30 })).toMatchObject({ counted: false, done: false, justDone: false });
    expect(book.record({ game: g, seconds: 61 })).toMatchObject({ counted: true, done: true, justDone: true, bonus: false });
    expect(book.record({ game: g, seconds: 200 })).toMatchObject({ counted: true, done: true, justDone: false });
    expect(book.today()).toMatchObject({ done: true, bonus: false, doneThisWeek: 1 });
  });

  it('is not done by another game, however long it was played', () => {
    const { book } = rig();
    const other = FREE.find((x) => x !== todaysGame(book)) as string;
    expect(book.record({ game: other, seconds: 600, newBest: true })).toMatchObject({ counted: false, done: false, bonus: false });
    expect(book.today()).toMatchObject({ done: false, bonus: false });
  });

  it('gives the bonus for beating your own best in that game, also on a later round of the day', () => {
    const { book } = rig();
    const g = todaysGame(book);
    expect(book.record({ game: g, seconds: 90, newBest: false })).toMatchObject({ justDone: true, bonus: false, justBonus: false });
    expect(book.record({ game: g, seconds: 90, newBest: true })).toMatchObject({ justDone: false, bonus: true, justBonus: true });
    expect(book.record({ game: g, seconds: 90, newBest: true })).toMatchObject({ bonus: true, justBonus: false });
  });

  it('gives no bonus for a best in a round that was too short', () => {
    const { book } = rig();
    expect(book.record({ game: todaysGame(book), seconds: 20, newBest: true })).toMatchObject({ counted: false, bonus: false });
  });

  it('counts the days of the last week, and starts a new day with a new challenge', () => {
    const { book, at } = rig();
    for (const d of days(3)) { at(d); book.record({ game: todaysGame(book), seconds: 100 }); }
    expect(book.today().doneThisWeek).toBe(3);
    at('2026-10-27');
    expect(book.today()).toMatchObject({ done: false, doneThisWeek: 3 });
    at('2026-10-31');
    expect(book.today().doneThisWeek).toBe(2);                       // the last seven days are the 25th to the 31st
    at('2026-11-02');
    expect(book.today().doneThisWeek).toBe(0);                       // the three days are more than a week back
  });

  it('lists the last days, newest first', () => {
    const { book, at } = rig();
    book.record({ game: todaysGame(book), seconds: 100, newBest: true });
    at('2026-10-25');
    const list = book.recent(3);
    expect(list.map((x) => x.day)).toEqual(['2026-10-25', '2026-10-24', '2026-10-23']);
    expect(list.map((x) => [x.done, x.bonus])).toEqual([[false, false], [true, true], [false, false]]);
    expect(list.every((x) => FREE.includes(x.game as string))).toBe(true);
    expect(book.recent(0)).toEqual([]);
    expect(book.recent(Number.NaN)).toEqual([]);
    expect(book.recent(1000)).toHaveLength(60);
  });

  it('copes with a catalogue that has no free game, or that fails to answer', () => {
    const none = rig('2026-10-24', () => games([], PRO));
    expect(none.book.today()).toMatchObject({ challenge: null, done: false });
    expect(none.book.record({ game: 'road-run', seconds: 100 })).toMatchObject({ challenge: null, counted: false, done: false });
    const broken = rig('2026-10-24', () => { throw new Error('not loaded yet'); });
    expect(broken.book.today().challenge).toBeNull();
    expect(() => broken.book.record({ game: 'x', seconds: 100 })).not.toThrow();
  });

  it('never throws for a round that is not one', () => {
    const { book } = rig();
    for (const bad of [null, undefined, 5, 'x', {}] as unknown as { game: string; seconds: number }[]) expect(() => book.record(bad)).not.toThrow();
    expect(book.today().done).toBe(false);
  });
});

describe('two devices', () => {
  const a = (d: Day) => withDay(EMPTY_DAYS, d);

  it('merge into the union of their days, in any order, and the second merge changes nothing', () => {
    const x = { ...emptyChallengeDoc(), d: a('2026-10-22'), b: a('2026-10-22') };
    const y = { ...emptyChallengeDoc(), d: withDay(a('2026-10-23'), '2026-10-24'), b: EMPTY_DAYS };
    expect(mergeChallengeDocs(x, y)).toEqual(mergeChallengeDocs(y, x));
    expect(daysOf(mergeChallengeDocs(x, y).d)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
    expect(mergeChallengeDocs(mergeChallengeDocs(x, y), y)).toEqual(mergeChallengeDocs(x, y));
  });

  it('a phone and a laptop end with the same record', () => {
    const mk = () => {
      const clock = { t: Date.parse('2026-10-24T12:00:00Z') };
      const store = createStore({ storage: memoryStorage(), now: () => clock.t, timeZone: 'UTC' });
      return { book: createChallengeBook(store, { games: () => games() }), at: (d: Day) => { clock.t = Date.parse(`${d}T12:00:00Z`); } };
    };
    const phone = mk();
    const laptop = mk();
    phone.at('2026-10-23'); laptop.at('2026-10-23');
    phone.book.record({ game: phone.book.today().challenge?.game as string, seconds: 100, newBest: true });
    phone.at('2026-10-24'); laptop.at('2026-10-24');
    laptop.book.record({ game: laptop.book.today().challenge?.game as string, seconds: 100 });
    expect(phone.book.merge(laptop.book.doc())).toBe(true);
    expect(laptop.book.merge(phone.book.doc())).toBe(true);
    expect(phone.book.merge(laptop.book.doc())).toBe(false);
    expect(phone.book.doc()).toEqual(laptop.book.doc());
    expect(phone.book.today()).toMatchObject({ done: true, doneThisWeek: 2 });
    expect(laptop.book.recent(2).map((x) => [x.done, x.bonus])).toEqual([[true, false], [true, true]]);
  });

  it('take no day from the future, and read nothing that is not a document', () => {
    const clock = { t: Date.parse('2026-10-24T12:00:00Z') };
    const book = createChallengeBook(createStore({ storage: memoryStorage(), now: () => clock.t, timeZone: 'UTC' }), { games: () => games() });
    book.merge({ v: 1, d: { '2026-10': 1 << 29, '2031-01': 1 }, b: {} });                   // the 30th, and 2031
    expect(daysOf(book.doc().d)).toEqual([]);
    for (const raw of [null, undefined, 3, 'x', [], { v: 2, d: {}, b: {} }, { v: 1, d: 'x' }]) expect(() => book.merge(raw)).not.toThrow();
    expect(readChallengeDoc({ v: 1 })).toEqual({ v: 1, d: {}, b: {} });
    expect(readChallengeDoc({ v: 9 })).toBeNull();
  });
});
