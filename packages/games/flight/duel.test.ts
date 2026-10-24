// Squat Flap as a live race (mode 'duel', builder N): the Room fixes when each column reaches the bird, the game keeps the three
// promises of core/types DuelSetup (the column with id n arrives at schedule t, a settled column is one 'duel' event, the run ends
// with the match) and the score it adds up is the Room's own (core/net scoreOf), whatever the player chose to play alone on.
import { describe, expect, it } from 'vitest';
import type { GameEvent, InputEvent, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { makeSchedule, scoreOf, specFor, type Obstacle } from '../../core/net/schedule.ts';
import type { ObstacleResult } from '../../core/types/net.ts';
import { evt, frame, testContext } from '../kit-g1/testing/context.ts';
import { screenProblems } from '../kit-g1/testing/screens.ts';
import { testScene } from '../kit-g1/testing/scene.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { manifest } from '../squat-flap/index.ts';
import { createFlightGame, type FlightGame } from './game.ts';
import { DUEL_LEVEL, LEVELS, createFlight, makeCourse, stepFlight, type LaneIn } from './sim.ts';
import { squatBot, type BotKind } from './testing/bot.ts';

const SEED = 90210;
const DURATION = 45_000;
const course = (seed = SEED, ms = DURATION): Obstacle[] => makeSchedule(seed, ms, specFor('squat-flap'));

/** Hard on purpose: a race is flown on one level, whatever the player has chosen for the runs alone. */
const START = (o: Partial<StartOptions> = {}): StartOptions => ({
  seed: SEED, difficulty: 'hard', seated: false, mode: 'duel', profile: null, duel: { schedule: course(), durationMs: DURATION }, ...o,
});

function inputOf(k: number, b: LaneIn): { channels: Record<string, number>; events: InputEvent[] } {
  return {
    channels: { drop: b.drop, glide: b.glide ? 1 : 0, armed: b.armed ? 1 : 0 },
    events: b.flaps.map((f) => evt('squat', 'rep', k, { value: f.power, ...(f.depth !== undefined ? { q: { depth: f.depth } } : {}) })),
  };
}

interface Run { game: FlightGame; events: GameEvent[]; steps: number; phase: string; results: ObstacleResult[] }

async function newGame(o: { ctxSeed?: number; start?: StartOptions } = {}): Promise<{ game: FlightGame; hud: [string, unknown][] }> {
  const t = testContext({ seed: o.ctxSeed ?? 1 });
  const game = createFlightGame(manifest, { view: false });
  await game.init(t.ctx);
  game.start(o.start ?? START());
  return { game, hud: t.hud };
}

/** Plays the whole match with a bot through Game.step. */
function play(game: FlightGame, kind: BotKind, o: { botSeed?: number; from?: number; steps?: number } = {}): Run {
  const bot = squatBot(kind, o.botSeed ?? 1);
  const events: GameEvent[] = [];
  let k = o.from ?? 0;
  let phase = 'running';
  const max = (o.from ?? 0) + (o.steps ?? 60 * 400);
  while (phase === 'running' && k < max) {
    const b = bot.next(game.state!, 0, FIXED_DT);
    const i = inputOf(k + 1, b);
    const r = game.step(FIXED_DT, frame(++k, i.channels, i.events));
    events.push(...r.events);
    phase = r.phase;
  }
  return { game, events, steps: k, phase, results: resultsOf(events) };
}

const resultsOf = (events: readonly GameEvent[]): ObstacleResult[] =>
  events.filter((e) => e.type === 'duel').map((e) => ({ ob: e['ob'] as number, k: e['k'] as 'pass' | 'hit' }));

describe('the columns of a race', () => {
  it('column id n reaches the bird at schedule t: placed by time, whatever the tempo of the player', () => {
    const sch = course();
    const s = createFlight({ difficulty: 'normal', players: 1, seated: false, rng: rngStream(SEED, 'course'), duel: { schedule: sch, durationMs: DURATION } });
    expect(s.duel).toBe(true);
    expect(s.phase).toBe('play');
    expect(s.pipes.map((p) => p.id)).toEqual(sch.map((o) => o.id));
    for (const o of sch) {
      const p = s.pipes.find((q) => q.id === o.id)!;
      // The bird is at `scroll`; the column is over it when scroll reaches p.x, which is speed x t.
      expect(p.x).toBeCloseTo(LEVELS[DUEL_LEVEL].speed * (o.t / 1000), 10);
    }
  });

  it('everybody races on one level: the difficulty a player chose alone changes nothing', () => {
    const mk = (difficulty: string) => createFlight({ difficulty, players: 1, seated: false, rng: rngStream(SEED, 'course'), duel: { schedule: course(), durationMs: DURATION } });
    const normal = mk('normal');
    for (const d of ['easy', 'hard', 'expert', 'nonsense']) {
      const s = mk(d);
      expect(s.difficulty).toBe(DUEL_LEVEL);
      expect(s.pipes).toEqual(normal.pipes);
      expect(s.plan).toEqual(normal.plan);
    }
  });

  it('the look of a column is a function of the seed and its id: two devices fly the same course, another seed another one', () => {
    const a = createFlight({ difficulty: 'normal', players: 1, seated: false, rng: rngStream(SEED, 'course'), duel: { schedule: course(), durationMs: DURATION } });
    const b = createFlight({ difficulty: 'normal', players: 1, seated: false, rng: rngStream(SEED, 'course'), duel: { schedule: course(), durationMs: DURATION } });
    const other = createFlight({ difficulty: 'normal', players: 1, seated: false, rng: rngStream(SEED + 1, 'course'), duel: { schedule: course(SEED + 1), durationMs: DURATION } });
    expect(b.pipes).toEqual(a.pipes);
    expect(other.pipes.map((p) => p.y)).not.toEqual(a.pipes.map((p) => p.y));
    // Id n takes entry n-1 of the seed's course, however the list is cut.
    const c = makeCourse(rngStream(SEED, 'course'), LEVELS[DUEL_LEVEL]);
    a.pipes.forEach((p) => expect(p.y).toBe((c[(p.id as number) - 1] as { y: number }).y));
    // The first two are kinder, as in a run alone.
    expect((a.pipes[0] as { h: number }).h).toBeGreaterThan((a.pipes[5] as { h: number }).h);
  });

  it('there is no warm-up, no sets, no rest and no feather: one continuous run of the length of the match', () => {
    const s = createFlight({ difficulty: 'normal', players: 1, seated: false, rng: rngStream(SEED, 'course'), duel: { schedule: course(), durationMs: DURATION } });
    expect(s.plan).toEqual({ sets: 1, setSec: 45, restSec: 0 });
    let hits = 0, ended = 'running';
    for (let k = 0; k < 60 * 60 && ended === 'running'; k++) {
      const ev = stepFlight(s, FIXED_DT, [{ flaps: [], drop: 0, glide: false, armed: false }]);
      hits += ev.filter((e) => e.type === 'hit').length;
      if (s.phase !== 'play') ended = s.phase;
    }
    // Standing still hits every column (and never ends the run early, however many were hit).
    expect(hits).toBe(course().length);
    expect(s.lanes[0]!.lives).toBe(LEVELS[DUEL_LEVEL].lives);
    expect(s.lanes[0]!.out).toBe(false);
    expect(ended).toBe('complete');
    expect(s.t).toBeGreaterThan(44.9);
    expect(s.t).toBeLessThan(45.1);
  });
});

describe('the promises of a game that can be raced', () => {
  it('a perfect squatter clears every column; one duel event per column, in order, none twice; the run ends with the match', async () => {
    const { game } = await newGame();
    const r = play(game, 'perfect');
    const sch = course();
    expect(r.phase).toBe('complete');
    expect(r.results.map((e) => e.ob)).toEqual(sch.map((o) => o.id));
    expect(r.results.every((e) => e.k === 'pass')).toBe(true);
    // Ends with the match, to the step.
    expect(r.steps * FIXED_DT * 1000).toBeGreaterThanOrEqual(DURATION - 1);
    expect(r.steps * FIXED_DT * 1000).toBeLessThan(DURATION + 40);
    // What the game adds up is what the Room will say.
    const sum = game.summary();
    expect(sum.score).toBe(scoreOf(sch, r.results).score);
    expect(sum.cleared).toBe(sch.length);
    expect(sum.hits).toBe(0);
  });

  it('standing still hits every column: no pass, no early end, the score is nothing and the Room would agree', async () => {
    const { game } = await newGame();
    const r = play(game, 'idle');
    const sch = course();
    expect(r.phase).toBe('complete');
    expect(r.results.map((e) => e.ob)).toEqual(sch.map((o) => o.id));
    expect(r.results.every((e) => e.k === 'hit')).toBe(true);
    expect(game.summary().score).toBe(0);
    expect(r.events.some((e) => e.type === 'out' || e.type === 'over')).toBe(false);
  });

  it('a column settles when it is passed or hit, and a column hit is not passed as well', async () => {
    const { game } = await newGame();
    const r = play(game, 'sloppy', { botSeed: 3 });
    const sch = course();
    expect(r.phase).toBe('complete');
    // Every column exactly once.
    expect(r.results.map((e) => e.ob).sort((a, b) => a - b)).toEqual(sch.map((o) => o.id));
    const passes = r.results.filter((e) => e.k === 'pass').length;
    const hits = r.results.filter((e) => e.k === 'hit').length;
    expect(passes + hits).toBe(sch.length);
    expect(hits).toBeGreaterThan(0);
    expect(passes).toBeGreaterThan(0);
    const sum = game.summary();
    expect(sum.score).toBe(scoreOf(sch, r.results).score);
    expect(sum.cleared).toBe(passes);
    expect(sum.hits).toBe(hits);
  });

  it('the first outcome comes after the first column reaches the bird, not before', async () => {
    const { game } = await newGame();
    const r = play(game, 'perfect');
    const first = r.events.find((e) => e.type === 'duel')!;
    const t0 = course()[0]!.t;
    expect(first.t).toBeGreaterThanOrEqual(t0 - 1);
    expect(first.t).toBeLessThan(t0 + 1000);
  });

  it('the race is flown on the match seed, not on the session stream: two devices whose own streams differ fly the same course', async () => {
    const a = await newGame({ ctxSeed: 1 });
    const b = await newGame({ ctxSeed: 777 });
    const ra = play(a.game, 'good', { botSeed: 5 });
    const rb = play(b.game, 'good', { botSeed: 5 });
    expect(rb.events).toEqual(ra.events);
    expect(a.game.state!.pipes).toEqual(b.game.state!.pipes);
  });

  it('the same seed and the same play give the same events; another match seed gives another course', async () => {
    const a = await newGame();
    const b = await newGame();
    const c = await newGame({ start: START({ seed: SEED + 1, duel: { schedule: course(SEED + 1), durationMs: DURATION } }) });
    const ra = play(a.game, 'good', { botSeed: 2 });
    const rb = play(b.game, 'good', { botSeed: 2 });
    const rc = play(c.game, 'good', { botSeed: 2 });
    expect(rb.events).toEqual(ra.events);
    expect(rc.events).not.toEqual(ra.events);
  });

  it('a snapshot in the middle of the match continues identically (a reload resumes it)', async () => {
    // One bot plays once and its input is written down; the same input is then played into a game that never stops and into
    // one that was snapshotted in the middle, put through JSON and restored into a fresh game.
    const rec = await newGame();
    const bot = squatBot('good', 4);
    const inputs: ReturnType<typeof inputOf>[] = [];
    for (let k = 1; k <= 60 * 46; k++) {
      const b = bot.next(rec.game.state!, 0, FIXED_DT);
      const i = inputOf(k, b);
      inputs.push(i);
      if (rec.game.step(FIXED_DT, frame(k, i.channels, i.events)).phase !== 'running') break;
    }
    const feed = (game: FlightGame, from: number, to: number): GameEvent[] => {
      const out: GameEvent[] = [];
      for (let k = from + 1; k <= Math.min(to, inputs.length); k++) {
        const i = inputs[k - 1]!;
        out.push(...game.step(FIXED_DT, frame(k, i.channels, i.events)).events);
      }
      return out;
    };
    const straight = await newGame();
    const all = feed(straight.game, 0, inputs.length);

    const first = await newGame();
    const cut = 60 * 22;
    const head = feed(first.game, 0, cut);
    const snap = JSON.parse(JSON.stringify(first.game.snapshot())) as unknown;
    const second = await newGame({ ctxSeed: 999 });
    second.game.restore(snap);
    const tail = feed(second.game, cut, inputs.length);
    expect([...head, ...tail]).toEqual(all);
    expect(second.game.summary()).toEqual(straight.game.summary());
    expect(resultsOf(all).length).toBe(course().length);
  });

  it("mode 'duel' without the Room's course is a mistake, not a silent solo run", async () => {
    const t = testContext();
    const game = createFlightGame(manifest, { view: false });
    await game.init(t.ctx);
    const o = START();
    delete (o as { duel?: unknown }).duel;
    expect(() => game.start(o)).toThrow(/duel/);
  });

  it('the plates are the race\'s: the game writes no score, no feathers and no combo, only the clock and the reason', async () => {
    const { game, hud } = await newGame();
    play(game, 'sloppy', { botSeed: 3, steps: 60 * 25 });
    // Render writes the HUD.
    game.render(1);
    const slots = new Set(hud.map(([slot]) => slot));
    expect(slots.has('timer')).toBe(true);
    for (const forbidden of ['score', 'lives', 'combo']) expect(slots.has(forbidden), forbidden).toBe(false);
  });
});

describe('the picture of a race', () => {
  it('on every one of the ten screens nothing runs off the screen and the bird is clear of the plates; no feathers are drawn', async () => {
    for (const b of BREAKPOINTS) {
      const scene = testScene(b.w, b.h);
      const t = testContext({ scene2d: scene.kit });
      const game = createFlightGame(manifest);
      await game.init(t.ctx);
      game.start(START());
      const bot = squatBot('good', 3);
      const problems = new Set<string>();
      let frames = 0;
      for (let k = 1; k < 60 * 30 && game.state!.phase === 'play'; k++) {
        const i = inputOf(k, bot.next(game.state!, 0, FIXED_DT));
        game.step(FIXED_DT, frame(k, i.channels, i.events));
        if (k % 20 === 0) {
          scene.ctx.texts.length = 0;
          game.render(0.5);
          frames++;
          for (const p of screenProblems(scene, game.view!.birdAt(0), `${b.label} race`)) problems.add(p);
        }
      }
      expect([...problems], b.label).toEqual([]);
      expect(frames, b.label).toBeGreaterThan(30);
      // The words on the canvas are the race's: no warm-up, no rest, no set numbers.
      const said = scene.ctx.texts.map((x) => x.text).join(' | ');
      expect(said, b.label).not.toMatch(/Warm-up|Rest|Set \d/);
      game.dispose();
    }
  });
});
