// The weekly boards' rules that need no server: the week, the games, the ceiling and the verdict on a finished run.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY } from './rules.ts';
import {
  BOARD_GAMES, SCORES, beats, ceilingFor, cleanCountry, isBoardGame, judgeRun, runWindowMs, weekOf, weekRange, WEEK_MS,
} from './scores.ts';

describe('weeks', () => {
  it('a week starts on Monday 00:00 UTC and lasts seven days', () => {
    const wednesday = Date.UTC(2026, 9, 21, 12);
    const w = weekRange(weekOf(wednesday));
    expect(new Date(w.start).getUTCDay()).toBe(1);
    expect(new Date(w.start).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(w.end - w.start).toBe(WEEK_MS);
    expect(w.start <= wednesday && wednesday < w.end).toBe(true);
  });

  it('the id changes at the stroke of Monday and at no other time', () => {
    const monday = Date.UTC(2026, 9, 26);
    expect(weekOf(monday - 1)).toBe(weekOf(monday) - 1);
    expect(weekOf(monday)).toBe(weekOf(monday + DAY * 6 + 23 * 3_600_000 + 59 * 60_000));
    expect(weekOf(monday + WEEK_MS)).toBe(weekOf(monday) + 1);
    for (let d = 0; d < 7; d++) expect(weekOf(Date.UTC(2026, 9, 19 + d, 13))).toBe(weekOf(Date.UTC(2026, 9, 19)));
  });

  it('weeks before 1970-01-05 count down from zero without breaking', () => {
    expect(weekOf(Date.UTC(1970, 0, 4))).toBe(-1);
    expect(weekRange(-1).end).toBe(Date.UTC(1970, 0, 5));
  });
});

describe('the games with a board', () => {
  const dir = new URL('../../games/', import.meta.url);
  const manifests = readdirSync(dir)
    .filter((d) => { try { readFileSync(new URL(`${d}/manifest.json`, dir)); return true; } catch { return false; } })
    .map((d) => JSON.parse(readFileSync(new URL(`${d}/manifest.json`, dir), 'utf8')) as { id: string; durationSec: number; modes: string[] });

  it('every game that can be played alone has a board, with the length of its run', () => {
    const solo = manifests.filter((m) => m.modes.includes('solo'));
    expect(solo.length).toBeGreaterThanOrEqual(10);
    for (const m of solo) {
      expect(isBoardGame(m.id), `${m.id} has no entry in BOARD_GAMES (core/social/scores.ts)`).toBe(true);
      expect(BOARD_GAMES[m.id as keyof typeof BOARD_GAMES].seconds, `${m.id}: seconds differ from the manifest's durationSec`).toBe(m.durationSec);
    }
  });

  it('a board exists only for a game that exists', () => {
    const ids = new Set(manifests.map((m) => m.id));
    for (const id of Object.keys(BOARD_GAMES)) expect(ids.has(id), `${id} is not a game in packages/games`).toBe(true);
  });

  it('an id that is not a game, or not even a string, has no board', () => {
    for (const bad of ['', 'xyz', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 12, null, undefined, {}]) expect(isBoardGame(bad)).toBe(false);
  });
});

describe('what a run may score', () => {
  const game = 'squat-flap';
  const seconds = BOARD_GAMES[game].seconds;

  it('the ceiling grows with the time the run took and stops growing at the length of the game', () => {
    expect(ceilingFor(game, 0)).toBe(SCORES.slack);
    expect(ceilingFor(game, 10_000)).toBe(SCORES.slack + 10 * BOARD_GAMES[game].ratePerSecond);
    const atEnd = ceilingFor(game, (seconds + 30) * 1000);
    expect(ceilingFor(game, (seconds + 30) * 1000 + 600_000)).toBe(atEnd);
    expect(ceilingFor(game, -5)).toBe(SCORES.slack);
  });

  it('no game can ever show more than the hard maximum', () => {
    for (const g of Object.keys(BOARD_GAMES) as (keyof typeof BOARD_GAMES)[]) expect(ceilingFor(g, 1e12)).toBeLessThanOrEqual(SCORES.maxScore);
  });

  it('the verdict: bad numbers, a run that is too short, one that took too long, one that scored too much, and a good one', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, SCORES.maxScore + 1, '100', null, undefined, {}]) expect(judgeRun(game, 60_000, bad)).toBe('bad_score');
    expect(judgeRun(game, 1_000, 10)).toBe('too_short');
    expect(judgeRun(game, SCORES.minRunMs - 1, 0)).toBe('too_short');
    expect(judgeRun(game, SCORES.minRunMs, 0)).toBe('ok');
    expect(judgeRun(game, runWindowMs(game) + 1, 10)).toBe('expired');
    expect(judgeRun(game, -10, 10)).toBe('expired');
    expect(judgeRun(game, 20_000, ceilingFor(game, 20_000))).toBe('ok');
    expect(judgeRun(game, 20_000, ceilingFor(game, 20_000) + 1)).toBe('implausible');
    expect(judgeRun(game, 60_000, 0)).toBe('ok');
  });

  it('a ticket lives three times as long as the game and never less than a quarter of an hour', () => {
    expect(runWindowMs('road-run')).toBe(15 * 60_000);
    expect(runWindowMs('pad-work')).toBe(3 * 420 * 1000);
  });

  it('a score written the same minute as another is ordered by who got there first', () => {
    expect(beats({ score: 10, at: 5 }, { score: 9, at: 1 })).toBe(true);
    expect(beats({ score: 10, at: 5 }, { score: 10, at: 6 })).toBe(true);
    expect(beats({ score: 10, at: 6 }, { score: 10, at: 5 })).toBe(false);
    expect(beats({ score: 10, at: 5 }, { score: 10, at: 5 })).toBe(false);
  });
});

describe('country codes', () => {
  it('two letters, any case, and not the "unknown" codes', () => {
    expect(cleanCountry('TR')).toBe('TR');
    expect(cleanCountry(' tr ')).toBe('TR');
    for (const bad of ['', 'XX', 'xx', 'T1', 'ZZ', 'TUR', 'T', '1A', null, undefined, 5, {}]) expect(cleanCountry(bad)).toBeNull();
  });
});
