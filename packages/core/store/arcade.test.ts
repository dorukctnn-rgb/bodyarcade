// The arcade: one call when a round ends, and everything the screens need afterwards, on the real games of the first release.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_NAMESPACE, createArcade, namespaceOf, type Arcade, type ArcadeGame } from './arcade.ts';
import { addDays, type Day } from './date.ts';
import { daysOf } from './dayset.ts';
import { createStore, memoryStorage, type StorageLike } from './store.ts';
import { FakeSyncServer } from './testkit.ts';
import { FREE_PLAN_ID, planFeature } from './workout-plans.ts';

const dir = fileURLToPath(new URL('../../games/', import.meta.url));
const GAMES: ArcadeGame[] = readdirSync(dir)
  .filter((d) => existsSync(`${dir}${d}/manifest.json`))
  .map((d) => JSON.parse(readFileSync(`${dir}${d}/manifest.json`, 'utf8')) as ArcadeGame);

const freeOnly = (f: string): boolean => f === planFeature(FREE_PLAN_ID) || (f.startsWith('game:') && GAMES.find((g) => g.id === f.slice(5))?.free === true);
const everything = (): boolean => true;

function rig(o: { can?: (f: string) => boolean; paid?: boolean; storage?: StorageLike; start?: Day; server?: FakeSyncServer } = {}) {
  const clock = { t: Date.parse(`${o.start ?? '2026-10-24'}T12:00:00Z`) };
  const store = createStore({ storage: o.storage ?? memoryStorage(), now: () => clock.t, timeZone: 'UTC' });
  const paid = { on: o.paid ?? false };
  const arcade = createArcade({
    store, games: () => GAMES, can: o.can ?? freeOnly, paid: () => paid.on, now: () => clock.t,
    ...(o.server ? { syncPort: () => (o.server as FakeSyncServer).port() } : {}),
  });
  return { arcade, store, paid, at: (d: Day) => { clock.t = Date.parse(`${d}T12:00:00Z`); }, clock };
}

const roundOf = (over: Partial<{ score: number; seconds: number; complete: boolean; variant: string; difficulty: string }> = {}) => ({
  score: 800, seconds: 200, complete: true, variant: 'standard', difficulty: 'normal', ...over,
});
const gameOfTheDay = (a: Arcade): string => a.challenge.today().challenge?.game as string;

describe('a round ends', () => {
  it('is written to the game, counted for the day, and answered with what the results screen needs', () => {
    const { arcade } = rig();
    const r = arcade.recordRun('squat-flap', roundOf());
    expect(r.outcome).toMatchObject({ saved: true, firstHere: true, previousBest: 0 });
    expect(r.play).toMatchObject({ day: '2026-10-24', seconds: 200, becameActive: true });
    expect(r.habit).toMatchObject({ todayActive: true, dayStreak: 1, todaySeconds: 200, week: { days: 1, goal: 3 } });
    expect(arcade.progress('squat-flap').best('standard', 'normal')).toBe(800);
    expect(arcade.progress('squat-flap').runs()).toHaveLength(1);
  });

  it('adds up the rounds of different games into one day, and says on which round the day became active', () => {
    const { arcade } = rig();
    expect(arcade.recordRun('star-catch', roundOf({ seconds: 100 })).play).toMatchObject({ seconds: 100, becameActive: false });
    expect(arcade.recordRun('twist-turbine', roundOf({ seconds: 90 })).play).toMatchObject({ seconds: 190, becameActive: true });
    expect(arcade.recordRun('pose-wall', roundOf({ seconds: 30 })).play).toMatchObject({ seconds: 220, becameActive: false });
  });

  it('tells the daily challenge, and finishes it with the game of the day only', () => {
    const { arcade } = rig();
    const today = gameOfTheDay(arcade);
    const other = GAMES.find((g) => g.free && g.id !== today)?.id as string;
    expect(arcade.recordRun(other, roundOf()).challenge).toMatchObject({ counted: false, done: false });
    expect(arcade.recordRun(today, roundOf({ score: 500 })).challenge).toMatchObject({ counted: true, justDone: true, bonus: false });
    expect(arcade.recordRun(today, roundOf({ score: 900 })).challenge).toMatchObject({ done: true, justDone: false, bonus: true, justBonus: true });
    expect(arcade.today().challenge).toMatchObject({ done: true, bonus: true });
  });

  it('counts a round of the game of the day that was too short for nothing, but saves it', () => {
    const { arcade } = rig();
    const r = arcade.recordRun(gameOfTheDay(arcade), roundOf({ seconds: 30 }));
    expect(r.outcome.saved).toBe(true);
    expect(r.challenge).toMatchObject({ counted: false, done: false });
    expect(r.play).toMatchObject({ seconds: 30, becameActive: false });
  });

  it('does not count what is not a round: the summary that was never made, a number, an object without a score', () => {
    const { arcade, store } = rig();
    for (const bad of [null, 5, 'x', [], {}, { score: 'many' }, { score: Number.NaN }]) {
      const r = arcade.recordRun('squat-flap', bad as never);
      expect(r.outcome.saved, JSON.stringify(bad)).toBe(false);
      expect(r.play).toBeNull();
      expect(r.challenge).toBeNull();
    }
    expect(arcade.habit.view()).toMatchObject({ todaySeconds: 0, todayActive: false, dayStreak: 0 });
    expect(arcade.progress('squat-flap').runs()).toEqual([]);
    expect(arcade.progress('squat-flap').unlocked()).toEqual({});
    expect(store.problems().filter((p) => p.kind === 'rejected')).toHaveLength(7);
  });

  it('never throws for a game name that is not one', () => {
    const { arcade } = rig();
    for (const bad of ['Bad Game!', '', 'a'.repeat(80), '__proto__', 'x/y']) {
      const r = arcade.recordRun(bad, roundOf());
      expect(r.outcome.saved, bad).toBe(false);
      expect(r.play).toBeNull();
    }
    expect(() => arcade.progress('Bad Game!')).toThrow(RangeError);
  });

  it('keeps one record per game', () => {
    const { arcade } = rig();
    arcade.recordRun('squat-flap', roundOf({ score: 100 }));
    arcade.recordRun('star-catch', roundOf({ score: 700 }));
    expect(arcade.progress('squat-flap').best()).toBe(100);
    expect(arcade.progress('star-catch').best()).toBe(700);
    expect(arcade.progress('squat-flap')).toBe(arcade.progress('squat-flap'));
  });

  it('does not let one stage that fails take the others with it', () => {
    const { arcade } = rig();
    arcade.habit.addPlay = () => { throw new Error('boom'); };
    const r = arcade.recordRun('squat-flap', roundOf());
    expect(r.outcome.saved).toBe(true);
    expect(r.play).toBeNull();
    expect(r.challenge).not.toBeNull();
  });
});

describe('the runner is the live site\'s runner', () => {
  it('keeps its record where the live site\'s import puts it, and starts with the live site\'s achievements', () => {
    expect(GAME_NAMESPACE['road-run']).toBe('runner');
    expect(namespaceOf('road-run')).toBe('runner');
    expect(namespaceOf('squat-flap')).toBe('squat-flap');
    const { arcade } = rig();
    const r = arcade.recordRun('road-run', roundOf({ variant: 'alps', difficulty: 'medium', seconds: 80 }));
    expect(r.outcome.news.map((a) => a.id)).toContain('first-run');
    expect(arcade.progress('road-run').daily()).not.toBeNull();             // the runner has the live site's daily goal
    expect(arcade.progress('squat-flap').daily()).toBeNull();               // the others do not: their daily is the challenge
  });

  it('takes a returning player\'s record in once, into the same place the game reads', () => {
    const live = memoryStorage({
      ba_runs: JSON.stringify([{ ts: Date.UTC(2026, 9, 20, 10), world: 'alps', diff: 'medium', score: 2500, seconds: 80, cleared: 12, hits: 1, bestCombo: 6, coins: 10, kcal: 4, complete: true, dist: 300 }]),
      ba_best: JSON.stringify({ alps: 2500 }),
      ba_totals: JSON.stringify({ runs: 5, seconds: 400, kcal: 20, cleared: 50 }),
      ba_achievements: JSON.stringify(['first-run', 'runs-10']),
      ba_worlds: JSON.stringify(['alps', 'desert']),
    });
    const { arcade } = rig();
    expect(arcade.importLegacy(live).status).toBe('imported');
    const p = arcade.progress('road-run');
    expect(p.best('alps')).toBe(2500);
    expect(Object.keys(p.unlocked()).sort()).toEqual(['first-run', 'runs-10']);
    expect(p.totals()['runs']).toBe(5);
    expect(arcade.importLegacy(live).status).toBe('already');
    expect(live.getItem('ba_best')).not.toBeNull();                          // the live site's keys stay as they were
  });
});

describe('days and weeks', () => {
  it('count the active days of a week and the weeks in a row, from the rounds', () => {
    const { arcade, at } = rig({ start: '2026-10-12' });
    for (const d of ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-22']) { at(d); arcade.recordRun('squat-flap', roundOf()); }
    at('2026-10-22');
    expect(arcade.habit.view()).toMatchObject({ weekStreak: 2, week: { start: '2026-10-19', days: 3, met: true } });
  });

  it('use a rest day for a missed day when the player comes back, once, as the page opens', () => {
    const storage = memoryStorage();
    const first = rig({ storage, start: '2026-10-19' });
    first.arcade.recordRun('squat-flap', roundOf());
    const back = rig({ storage, start: '2026-10-21' });                      // Tuesday missed; the page opens on Wednesday
    expect(daysOf(back.arcade.habit.doc().r)).toEqual(['2026-10-20']);
    back.arcade.recordRun('squat-flap', roundOf());
    expect(back.arcade.today().habit).toMatchObject({ dayStreak: 2, rest: { allowance: 1, used: 1, available: 0 } });
  });

  it('gives a paid plan two rest days a week', () => {
    const { arcade, paid, at } = rig({ start: '2026-10-19', paid: true });
    arcade.recordRun('squat-flap', roundOf());
    at('2026-10-22');
    arcade.recordRun('squat-flap', roundOf());
    expect(paid.on).toBe(true);
    expect(arcade.habit.view()).toMatchObject({ dayStreak: 2, rest: { allowance: 2, used: 2 } });
  });
});

describe('plans through the arcade', () => {
  it('starts the free plan for a free player and nothing else, and remembers it in today()', () => {
    const { arcade } = rig();
    expect(arcade.plans.start('legs-day')).toEqual({ ok: false, code: 'locked' });
    expect(arcade.plans.start(FREE_PLAN_ID).ok).toBe(true);
    expect(arcade.today().plan).toMatchObject({ number: 1, total: 2, plan: { id: 'desk-break' } });
    arcade.plans.finishStep({ score: 100, seconds: 180 });
    expect(arcade.today().plan?.number).toBe(2);
  });

  it('starts every plan for a player who may have everything', () => {
    const { arcade } = rig({ can: everything });
    for (const c of arcade.plans.list()) expect(arcade.plans.start(c.id).ok, c.id).toBe(true);
  });
});

describe('a second device', () => {
  it('goes on where the first stopped, through the documents', async () => {
    const server = new FakeSyncServer();
    const phone = rig({ server });
    phone.arcade.recordRun('squat-flap', roundOf());
    phone.arcade.recordRun(gameOfTheDay(phone.arcade), roundOf());
    phone.arcade.plans.start(FREE_PLAN_ID); phone.arcade.plans.finishStep({ score: 1, seconds: 1 }); phone.arcade.plans.finishStep({ score: 1, seconds: 1 });
    expect(await phone.arcade.sync.sync()).toMatchObject({ ok: true, pushed: ['daily', 'habit', 'plans'] });
    const laptop = rig({ server });
    expect(await laptop.arcade.sync.sync()).toMatchObject({ ok: true, pulled: ['daily', 'habit', 'plans'], pushed: [] });
    expect(laptop.arcade.today()).toMatchObject({ challenge: { done: true }, habit: { todayActive: true, dayStreak: 1 } });
    expect(laptop.arcade.plans.card(FREE_PLAN_ID)?.doneThisWeek).toBe(1);
  });

  it('says there is no port before there is a profile, and the arcade works all the same', async () => {
    const { arcade } = rig();
    expect(await arcade.sync.sync()).toMatchObject({ ok: false, failure: 'no_port' });
    expect(arcade.recordRun('squat-flap', roundOf()).outcome.saved).toBe(true);
  });
});

describe('the rest of the store is left alone', () => {
  it('writes only into its own places, and nothing under the live site\'s ba_ keys', () => {
    const storage = memoryStorage();
    storage.setItem('ba_best', '{"alps":1}');
    const { arcade } = rig({ storage });
    arcade.recordRun('squat-flap', roundOf());
    arcade.recordRun(gameOfTheDay(arcade), roundOf());
    arcade.plans.start(FREE_PLAN_ID);
    const keys = Object.keys(storage.dump()).filter((k) => k !== 'ba_best');
    expect(keys.every((k) => k.startsWith('ba2.'))).toBe(true);
    expect(new Set(keys.map((k) => k.split('.')[1]))).toEqual(new Set(['squat-flap', gameOfTheDay(arcade), 'habit', 'daily-challenge', 'plans']));
    expect(storage.getItem('ba_best')).toBe('{"alps":1}');
  });

  it('after a week of use, holds a small record', () => {
    const { arcade, at, store } = rig();
    for (let i = 0; i < 7; i++) { at(addDays('2026-10-24', i)); arcade.recordRun('squat-flap', roundOf()); arcade.recordRun(gameOfTheDay(arcade), roundOf()); }
    expect(JSON.stringify(arcade.habit.doc()).length).toBeLessThan(200);
    expect(store.problems()).toEqual([]);
  });
});
