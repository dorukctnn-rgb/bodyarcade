// Family mode: the sets against the real games, the way of playing a device offers, the board after each round (together: two scores
// a round; in turns: Player 1, then Player 2 on the same game), the winner, and the evening kept across a reload for the day only.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '../../../core/store/store.ts';
import { FAMILY_ROUND_SEC, FAMILY_SETS, afterRound, createFamilyBook, defaultMode, familySetById, modeFor, totalsOf, viewOf, type FamilyRun } from './family.ts';
import { shortSeconds } from './short-round.ts';

const gamesDir = fileURLToPath(new URL('../../../games/', import.meta.url));
const REAL = readdirSync(gamesDir)
  .filter((d) => existsSync(`${gamesDir}${d}/manifest.json`))
  .map((d) => JSON.parse(readFileSync(`${gamesDir}${d}/manifest.json`, 'utf8')) as { id: string; free: boolean; modes: string[]; lowImpact: boolean });
const real = (id: string) => REAL.find((g) => g.id === id);

describe('the family sets', () => {
  it('are games that two can play on one camera, the classic one free and low impact, the party one with Pro games', () => {
    for (const set of FAMILY_SETS) {
      expect(set.games.length, set.id).toBe(3);
      for (const id of set.games) expect(real(id)?.modes, `${set.id}: ${id} is not a two-player game`).toContain('local2');
      expect(Object.keys(set.title).sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
    }
    const classic = familySetById('classic');
    for (const id of classic?.games ?? []) { expect(real(id)?.free, id).toBe(true); expect(real(id)?.lowImpact, id).toBe(true); }
    expect(familySetById('party')?.games.some((id) => real(id)?.free === false)).toBe(true);
    expect(familySetById('made-up')).toBeNull();
  });

  it('play rounds of a minute, a length a short round may have', () => {
    expect(shortSeconds(FAMILY_ROUND_SEC)).toBe(FAMILY_ROUND_SEC);
  });
});

describe('the way of playing', () => {
  it('is together where two people fit in the picture, else turns, and together is never forced on a small screen', () => {
    expect(defaultMode(true)).toBe('together');
    expect(defaultMode(false)).toBe('turns');
    expect(modeFor('together', true)).toBe('together');
    expect(modeFor('together', false)).toBe('turns');
    expect(modeFor('turns', true)).toBe('turns');
    expect(modeFor(null, true)).toBe('together');
    expect(modeFor('nonsense', false)).toBe('turns');
  });
});

const run = (mode: FamilyRun['mode']): FamilyRun => ({ set: 'classic', mode, day: '2026-11-11', games: ['star-catch', 'pose-wall', 'squat-flap'], index: 0, turn: 1, scores: [] });

describe('the board', () => {
  it('together: each round gives both scores and goes on to the next game', () => {
    let r = run('together');
    r = afterRound(r, { p1: 120, p2: 90 });
    expect(r.index).toBe(1);
    expect(r.scores[0]).toEqual({ game: 'star-catch', p1: 120, p2: 90 });
    r = afterRound(r, { p1: 50, p2: 100 });
    r = afterRound(r, { p1: 10, p2: 30 });
    const v = viewOf(r);
    expect(v.over).toBe(true);
    expect(v.current).toBeNull();
    expect(v.totals).toEqual({ p1: 180, p2: 220 });
    expect(v.winner).toBe(2);
    // a round after the end changes nothing
    expect(afterRound(r, { p1: 1000, p2: 0 })).toBe(r);
  });

  it('in turns: Player 1 plays, then Player 2 plays the same game, then the next game begins with Player 1', () => {
    let r = run('turns');
    expect(viewOf(r).current).toEqual({ game: 'star-catch', number: 1, total: 3, turn: 1 });
    r = afterRound(r, { p1: 70 });
    expect(viewOf(r).current).toEqual({ game: 'star-catch', number: 1, total: 3, turn: 2 });
    expect(r.scores[0]).toEqual({ game: 'star-catch', p1: 70, p2: null });
    r = afterRound(r, { p1: 80 });   // the score of the round is the player's whose turn it was
    expect(r.scores[0]).toEqual({ game: 'star-catch', p1: 70, p2: 80 });
    expect(viewOf(r).current).toEqual({ game: 'pose-wall', number: 2, total: 3, turn: 1 });
    for (const x of [40, 40, 5, 5]) r = afterRound(r, { p1: x });
    const v = viewOf(r);
    expect(v.over).toBe(true);
    expect(v.totals).toEqual({ p1: 115, p2: 125 });
    expect(v.winner).toBe(2);
  });

  it('a draw has no winner, and a score that makes no sense counts as nothing', () => {
    let r = run('together');
    r = afterRound(r, { p1: Number.NaN, p2: -5 });
    expect(r.scores[0]).toEqual({ game: 'star-catch', p1: 0, p2: 0 });
    r = afterRound(r, { p1: 10, p2: 10 });
    r = afterRound(r, { p1: 1e15, p2: 1e15 });
    expect(viewOf(r).winner).toBeNull();
    expect(totalsOf(r).p1).toBe(totalsOf(r).p2);
  });
});

describe('an evening kept on the device', () => {
  const games = () => REAL.map((g) => ({ id: g.id, local2: g.modes.includes('local2') }));
  const isFree = (id: string): boolean => real(id)?.free === true;
  function rig(o: { can?: (f: string) => boolean; day?: () => number } = {}) {
    let t = Date.UTC(2026, 10, 11, 18);
    const store = createStore({ storage: memoryStorage(), now: () => o.day?.() ?? t, timeZone: 'UTC' });
    const book = () => createFamilyBook(store, { games, can: o.can ?? (() => false), isFree });
    return { store, book, at: (ms: number) => { t = ms; } };
  }

  it('starts the free set for a free player, and sends the party set to Pro', () => {
    const x = rig();
    expect(x.book().locked('classic')).toBe(false);
    expect(x.book().locked('party')).toBe(true);
    expect(x.book().start('party', 'together')).toEqual({ ok: false, code: 'locked' });
    const r = x.book().start('classic', 'turns');
    expect(r.ok).toBe(true);
    const pro = rig({ can: () => true });
    expect(pro.book().locked('party')).toBe(false);
    expect(pro.book().start('party', 'together').ok).toBe(true);
  });

  it('goes on after a reload, round by round, and closes when it is left', () => {
    const x = rig();
    x.book().start('classic', 'turns');
    expect(x.book().finishRound({ p1: 33 })?.current).toMatchObject({ game: 'star-catch', turn: 2 });
    const again = x.book().active();
    expect(again?.run.scores[0]).toEqual({ game: 'star-catch', p1: 33, p2: null });
    x.book().abandon();
    expect(x.book().active()).toBeNull();
    expect(x.book().finishRound({ p1: 1 })).toBeNull();
  });

  it('does not outlive its day', () => {
    const x = rig();
    x.book().start('classic', 'together');
    x.at(Date.UTC(2026, 10, 12, 9));
    expect(x.book().active()).toBeNull();
  });

  it('copes with a catalogue that fails to answer and with a stored evening that does not add up', () => {
    const store = createStore({ storage: memoryStorage(), now: () => Date.UTC(2026, 10, 11, 18), timeZone: 'UTC' });
    const broken = createFamilyBook(store, { games: () => { throw new Error('not loaded'); }, can: () => true, isFree: () => true });
    expect(broken.start('classic', 'together')).toEqual({ ok: false, code: 'empty' });
    store.ns('family').set('run', { set: 'classic', mode: 'turns', day: '2026-11-11', games: ['star-catch'], index: 5, turn: 1, scores: [] });
    expect(createFamilyBook(store, { games, can: () => true, isFree }).active()).toBeNull();
  });
});
