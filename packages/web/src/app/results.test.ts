import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../../core/types/index.ts';
import { createI18n } from '../../../core/ui/i18n/index.ts';
import { loadCatalogue } from '../../catalogue/load.ts';
import { makeContext } from '../make-context.ts';
import { defaultSetup } from '../views/setup.ts';
import { buildRoundResult, caloriesFor, reactionExtras, reasonsFrom } from './results.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const game = games[0]!;
const setup = defaultSetup(makeContext({ lang: 'en', games, url: '/' }), game);
const i18n = createI18n('en');

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  score: 40, seconds: 90, reps: 30, hits: 28, bestStreak: 7, quality: 0.8, metSeconds: 450,
  log: [{ t: 1, kind: 'squat', ok: true }, { t: 2, kind: 'shallow', ok: false }, { t: 3, kind: 'shallow', ok: false }, { t: 4, kind: 'lean', ok: false }],
  ...over,
});

describe('calories', () => {
  it('follow MET x 3.5 x kg / 200 per minute', () => {
    // 5 MET for 10 minutes at 70 kg: 5 x 3.5 x 70 / 200 x 10 = 61.25 kcal
    expect(caloriesFor(5 * 600, 70)).toBeCloseTo(61.25, 5);
  });
  it('are not invented without a weight, or from an impossible one', () => {
    expect(caloriesFor(450, null)).toBeNull();
    expect(caloriesFor(450, 5)).toBeNull();
    expect(caloriesFor(450, 900)).toBeNull();
    expect(caloriesFor(450, Number.NaN)).toBeNull();
  });
  it('are zero for no movement', () => {
    expect(caloriesFor(0, 70)).toBe(0);
  });
});

describe('reasons', () => {
  it('count the misses, most frequent first, and ignore hits', () => {
    const i = createI18n('en');
    const r = reasonsFrom(summary().log, i);
    expect(r).toHaveLength(2);
    expect(r[0]?.count).toBe(2);
    expect(r[1]?.count).toBe(1);
  });
  it('use the string of the miss code when there is one and a plain line when not', () => {
    const i = createI18n('en');
    i.extend('miss', { en: { shallow: 'Not deep enough' } });
    const r = reasonsFrom(summary().log, i);
    expect(r[0]?.text).toBe('Not deep enough');
    expect(r[1]?.text).toBe('Missed move');
  });
  it('are empty for a clean round', () => {
    expect(reasonsFrom([{ t: 1, kind: 'squat', ok: true }], i18n)).toEqual([]);
  });
});

describe('building the result', () => {
  it('carries the numbers the round has and nothing it does not', () => {
    const r = buildRoundResult({ game, setup, summary: summary({ hits: undefined, cleared: undefined }), weightKg: 70, i18n, previousBest: 30 });
    expect(r).toMatchObject({ gameId: game.id, score: 40, seconds: 90, reps: 30, bestStreak: 7, quality: 0.8, personalBest: true });
    expect('hits' in r).toBe(false);
    expect('cleared' in r).toBe(false);
    expect(r.calories).toBeCloseTo((450 * 3.5 * 70) / 12000, 5);
    expect(r.replay).toBeNull();
    expect(buildRoundResult({ game, setup, summary: summary(), weightKg: null, i18n, previousBest: null, replay: { reason: 'Hips not low enough' } }).replay).toEqual({ reason: 'Hips not low enough' });
  });
  it('calls it a personal best only against an earlier best, and only for one player', () => {
    expect(buildRoundResult({ game, setup, summary: summary(), weightKg: null, i18n, previousBest: null }).personalBest).toBe(false);
    expect(buildRoundResult({ game, setup, summary: summary(), weightKg: null, i18n, previousBest: 40 }).personalBest).toBe(false);
    expect(buildRoundResult({ game, setup: { ...setup, players: 2 }, summary: summary(), weightKg: null, i18n, previousBest: 10 }).personalBest).toBe(false);
  });
  it('calls a round with the keyboard or by touch practice: no calories, no personal best, and the result says so', () => {
    const r = buildRoundResult({ game, setup: { ...setup, input: 'keyboard' }, summary: summary(), weightKg: 70, i18n, previousBest: 30 });
    expect(r.practice).toBe(true);
    expect(r.calories).toBeNull();
    expect(r.personalBest).toBe(false);
    expect(r.score).toBe(40);
    // with the camera nothing of the kind is said
    const camera = buildRoundResult({ game, setup: { ...setup, input: 'camera' }, summary: summary(), weightKg: 70, i18n, previousBest: 30 });
    expect('practice' in camera).toBe(false);
    expect(camera.calories).not.toBeNull();
  });
  it('splits two players', () => {
    const r = buildRoundResult({
      game, setup: { ...setup, players: 2 },
      summary: summary({ log: [], players: { 1: { score: 9, reps: 8, metSeconds: 1 }, 2: { score: 12, metSeconds: 1 } } }), weightKg: null, i18n, previousBest: null,
    });
    expect(r.players).toEqual([{ slot: 1, score: 9, reps: 8 }, { slot: 2, score: 12 }]);
  });
});

describe('reaction times', () => {
  const taps = [
    { t: 1, kind: 'tag', ok: true, v: 420 }, { t: 2, kind: 'tag', ok: true, v: 310 }, { t: 3, kind: 'tag', ok: true, v: 380 },
    { t: 4, kind: 'trap', ok: false }, { t: 5, kind: 'tag', ok: false, v: 900 },
  ];
  it('show the average and the best of the taps that were in time', () => {
    const x = reactionExtras(taps, i18n);
    expect(x).toEqual([{ label: 'Average reaction', value: '370 ms' }, { label: 'Best reaction', value: '310 ms' }]);
  });
  it('are left out of a round with no tap in time and of games that log no taps', () => {
    expect(reactionExtras([{ t: 1, kind: 'tag', ok: false, v: 900 }], i18n)).toEqual([]);
    expect(reactionExtras(summary().log, i18n)).toEqual([]);
  });
  it('are told per player in a two player round, and reach the results', () => {
    const log = [{ t: 1, kind: 'tag', ok: true, v: 300, player: 1 as const }, { t: 2, kind: 'tag', ok: true, v: 500, player: 2 as const }, { t: 3, kind: 'tag', ok: true, v: 400, player: 2 as const }];
    expect(reactionExtras(log, i18n, 1)[1]?.value).toBe('300 ms');
    expect(reactionExtras(log, i18n, 2)[0]?.value).toBe('450 ms');
    const solo = buildRoundResult({ game, setup, summary: summary({ log: taps }), weightKg: null, i18n, previousBest: null });
    expect(solo.extras?.map((e) => e.value)).toEqual(['370 ms', '310 ms']);
    const duo = buildRoundResult({ game, setup: { ...setup, players: 2 }, summary: summary({ log, players: { 1: { score: 1, metSeconds: 1 }, 2: { score: 2, metSeconds: 1 } } }), weightKg: null, i18n, previousBest: null });
    expect(duo.extras).toBeUndefined();
    expect(duo.players?.[1]?.extras?.[1]?.value).toBe('400 ms');
  });
  it('are spoken in Turkish too', () => {
    expect(reactionExtras(taps, createI18n('tr'))[0]).toEqual({ label: 'Ortalama tepki', value: '370 ms' });
  });
});
