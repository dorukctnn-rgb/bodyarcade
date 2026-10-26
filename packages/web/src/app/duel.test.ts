import { describe, expect, it } from 'vitest';
import type { Game, GameContext, GameEvent, GameManifest, InputFrame, StartOptions, StepResult } from '../../../core/types/index.ts';
import { makeSchedule, scoreOf, specFor } from '../../../core/net/schedule.ts';
import type { ObstacleResult, Outcome } from '../../../core/types/net.ts';
import { canRace, duelGame, duelModule, raceScore, STEP_MS, type DuelFeed } from './duel.ts';

const MANIFEST = { id: 'squat-flap', modes: ['solo', 'duel'] } as unknown as GameManifest;
const INPUT = {} as InputFrame;
const DT = 1 / 60;

/** A game that keeps the three promises of a raceable game: obstacles at the schedule's times, results as events, completion at the duration. */
function fakeGame(): Game & { started: StartOptions[]; steps: number; hudScore: number } {
  let o: StartOptions | null = null;
  let ms = 0;
  const done = new Set<number>();
  const g = {
    manifest: MANIFEST,
    started: [] as StartOptions[],
    steps: 0,
    hudScore: 0,
    async init(): Promise<void> {},
    start(x: StartOptions): void { o = x; g.started.push(x); ms = 0; g.steps = 0; done.clear(); },
    step(): StepResult {
      if (!o?.duel) throw new Error('started without a duel');
      ms += STEP_MS;
      g.steps++;
      const events: GameEvent[] = [];
      for (const ob of o.duel.schedule) {
        if (ob.t <= ms && !done.has(ob.id)) { done.add(ob.id); events.push({ type: 'duel', t: ms, ob: ob.id, k: ob.id % 3 === 0 ? 'hit' : 'pass' }); }
      }
      return { events, phase: ms >= o.duel.durationMs ? 'complete' : 'running' };
    },
    render(): void {},
    snapshot: () => ({ ms }),
    restore(): void {},
    summary: () => ({ score: 12345, seconds: ms / 1000, metSeconds: 0, log: [] }),
    dispose(): void {},
  };
  return g as Game & { started: StartOptions[]; steps: number; hudScore: number };
}

type Phase = ReturnType<DuelFeed['phase']>;

function fakeFeed(): DuelFeed & { t: number; ph: Phase; match_: ReturnType<DuelFeed['match']>; reports: [number, Outcome][]; finished: ObstacleResult[][]; sent: { mt: number; sc: number }[] } {
  const f = {
    t: -3500,
    ph: 'wait' as Phase,
    match_: null as ReturnType<DuelFeed['match']>,
    reports: [] as [number, Outcome][],
    finished: [] as ObstacleResult[][],
    sent: [] as { mt: number; sc: number }[],
    match: () => f.match_,
    time: () => f.t,
    phase: () => f.ph,
    report: (ob: number, k: Outcome) => { f.reports.push([ob, k]); },
    finish: (r: readonly ObstacleResult[]) => { f.finished.push(r.map((e) => ({ ...e }))); },
    state: (d: { mt: number; sc: number }) => { f.sent.push(d); },
  };
  return f;
}

function context(): { ctx: GameContext; sets: [string, unknown][] } {
  const sets: [string, unknown][] = [];
  const ctx = { hud: { set: (slot: string, v: unknown) => { sets.push([slot, v]); }, announce() {}, toast() {} } } as unknown as GameContext;
  return { ctx, sets };
}

const MATCH = { id: 'm1', seed: 4242, durationMs: 30_000, gameId: 'squat-flap', results: [] as ObstacleResult[] };
const START: StartOptions = { seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null };

async function ready(over: Partial<typeof MATCH> = {}): Promise<{ game: Game & { started: StartOptions[]; steps: number }; feed: ReturnType<typeof fakeFeed>; race: Game; sets: [string, unknown][] }> {
  const game = fakeGame();
  const feed = fakeFeed();
  const race = duelGame(game, feed);
  const { ctx, sets } = context();
  await race.init(ctx);
  race.start(START);
  feed.match_ = { ...MATCH, ...over };
  return { game, feed, race, sets };
}

/** Runs the race one step at a time while the Room's time moves with it. */
function play(race: Game, feed: ReturnType<typeof fakeFeed>, ms: number, phase: Phase = 'run'): StepResult {
  let last: StepResult = { events: [], phase: 'running' };
  for (let t = 0; t < ms; t += STEP_MS) {
    feed.ph = phase;
    feed.t += STEP_MS;
    last = race.step(DT, INPUT);
    if (last.phase !== 'running') break;
  }
  return last;
}

describe('a game that races', () => {
  it('is told by its manifest', () => {
    expect(canRace(MANIFEST)).toBe(true);
    expect(canRace({ modes: ['solo', 'local2'] })).toBe(false);
  });
});

describe('the race around a game', () => {
  it('plays nothing until the Room has started a match', async () => {
    const { game, feed, race } = await ready();
    feed.match_ = null;
    for (let i = 0; i < 120; i++) expect(race.step(DT, INPUT)).toEqual({ events: [], phase: 'running' });
    expect(game.started).toHaveLength(0);
    expect(game.steps).toBe(0);
  });

  it('starts the game with the match: the seed, the duel mode and the schedule the Room uses', async () => {
    const { game, feed, race } = await ready();
    feed.ph = 'count';
    race.step(DT, INPUT);
    expect(game.started).toHaveLength(1);
    const s = game.started[0] as StartOptions;
    expect(s.seed).toBe(MATCH.seed);
    expect(s.mode).toBe('duel');
    expect(s.duel?.durationMs).toBe(30_000);
    expect(s.duel?.schedule).toEqual(makeSchedule(MATCH.seed, 30_000, specFor('squat-flap')));
    // what the player chose is kept
    expect(s.difficulty).toBe('normal');
  });

  it('holds the game until match time zero, during the countdown after a pause and while the match is paused', async () => {
    const { game, feed, race } = await ready();
    feed.ph = 'count'; feed.t = -2000;
    for (let i = 0; i < 30; i++) race.step(DT, INPUT);
    expect(game.steps).toBe(0);
    feed.ph = 'run'; feed.t = 0;
    race.step(DT, INPUT);
    expect(game.steps).toBe(1);
    play(race, feed, 1000);
    const at = game.steps;
    feed.ph = 'hold';
    for (let i = 0; i < 100; i++) race.step(DT, INPUT);
    expect(game.steps).toBe(at);
    // the 3-2-1 after the pause: the Room's time runs back and forward again; the game waits until it is where it was
    feed.ph = 'count'; feed.t -= 3000;
    for (let i = 0; i < 100; i++) race.step(DT, INPUT);
    expect(game.steps).toBe(at);
    feed.ph = 'run';
    play(race, feed, 3000);
    expect(game.steps).toBeGreaterThan(at);
  });

  it('keeps the game in step with the Room: it does not run ahead, and it makes up what it is behind', async () => {
    const { game, feed, race } = await ready();
    feed.ph = 'run'; feed.t = 0;
    race.step(DT, INPUT);
    // the Room is 200 ms ahead (a slow frame): the game takes several steps in one frame
    feed.t += 200;
    const before = game.steps;
    race.step(DT, INPUT);
    expect(game.steps - before).toBeGreaterThanOrEqual(10);
    // the Room is behind: the game waits
    feed.t -= 400;
    const at = game.steps;
    race.step(DT, INPUT);
    expect(game.steps).toBe(at);
  });

  it('sends one result per obstacle as it is settled, then the whole list when the game completes', async () => {
    const { feed, race } = await ready();
    feed.t = -1;
    const last = play(race, feed, 31_000);
    expect(last.phase).toBe('complete');
    const schedule = makeSchedule(MATCH.seed, 30_000, specFor('squat-flap'));
    expect(feed.reports.map((r) => r[0])).toEqual(schedule.map((o) => o.id));
    expect(new Set(feed.reports.map((r) => r[0])).size).toBe(feed.reports.length);
    expect(feed.finished).toHaveLength(1);
    expect(feed.finished[0]).toEqual(feed.reports.map(([ob, k]) => ({ ob, k })));
    // and it does not send it twice
    race.step(DT, INPUT);
    expect(feed.finished).toHaveLength(1);
  });

  it('shows the Room\'s score on the HUD, whatever the game computes for itself', async () => {
    const { feed, race, sets } = await ready();
    feed.t = -1;
    play(race, feed, 31_000);
    const schedule = makeSchedule(MATCH.seed, 30_000, specFor('squat-flap'));
    const results = feed.finished[0] as ObstacleResult[];
    const scores = sets.filter(([slot]) => slot === 'score').map(([, v]) => v);
    expect(scores.at(-1)).toBe(scoreOf(schedule, results).score);
    expect(scores).not.toContain(12345);
    // the other slots belong to the game
    const { ctx, sets: other } = context();
    const g2 = duelGame(fakeGame(), fakeFeed());
    await g2.init(ctx);
    (ctx.hud as { set(s: string, v: unknown): void }).set('prompt', 'x');
    expect(other.map(([s]) => s)).toEqual(['prompt']);
  });

  it('joins a match that is already running: the steps are made, nothing is sent for what passed, the rest is', async () => {
    const { game, feed, race } = await ready({ results: [{ ob: 1, k: 'pass' }] });
    feed.t = 10_000;
    const schedule = makeSchedule(MATCH.seed, 30_000, specFor('squat-flap'));
    feed.ph = 'run';
    race.step(DT, INPUT);                                           // catches up in one go
    expect(game.steps).toBeGreaterThan(500);
    expect(feed.reports).toEqual([]);
    play(race, feed, 21_000);
    const after = schedule.filter((o) => o.t > 10_050).map((o) => o.id);
    expect(feed.reports.map((r) => r[0])).toEqual(after);
    // the one the Room already held is not sent again, and the final list holds all
    expect(feed.finished[0]?.some((e) => e.ob === 1)).toBe(true);
    expect(feed.reports.some((r) => r[0] === 1)).toBe(false);
  });

  it('tells the others the match time and the score about fifteen times a second', async () => {
    const { feed, race } = await ready();
    feed.t = -1;
    play(race, feed, 5000);
    expect(feed.sent.length).toBeGreaterThan(50);
    expect(feed.sent.length).toBeLessThan(90);
    expect(feed.sent.at(-1)?.sc).toBeGreaterThan(0);
  });

  it('finishes when the Room ends the match for it, with what it has', async () => {
    const { feed, race } = await ready();
    feed.t = -1;
    play(race, feed, 3000);
    feed.ph = 'over';
    const r = race.step(DT, INPUT);
    expect(r.phase).toBe('complete');
    expect(feed.finished).toHaveLength(1);
  });

  it('gives the summary of the game once it has played, and an empty one before', async () => {
    const { feed, race } = await ready();
    expect(race.summary().score).toBe(0);
    feed.t = -1;
    play(race, feed, 500);
    expect(race.summary().score).toBe(12345);
  });

  it('is a module of the same game with no keys or swipes', () => {
    const m = duelModule({ manifest: MANIFEST, create: fakeGame, controls: { keys: { ArrowUp: { event: 'jump' } } } }, fakeFeed());
    expect(m.manifest).toBe(MANIFEST);
    expect(m.controls).toBeUndefined();
    expect(typeof m.create().step).toBe('function');
  });
});

describe('the race score', () => {
  it('is the Room\'s formula with the running combo', () => {
    const schedule = makeSchedule(7, 30_000, specFor('squat-flap'));
    const first = schedule.slice(0, 4).map((o, i): ObstacleResult => ({ ob: o.id, k: i === 2 ? 'hit' : 'pass' }));
    const s = raceScore(schedule, first);
    expect(s.score).toBe(scoreOf(schedule, first).score);
    expect(s.combo).toBe(1);
    expect(raceScore(schedule, []).combo).toBe(0);
  });
});
