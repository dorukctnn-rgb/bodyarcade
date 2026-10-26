// Knee Sprint as a live race (mode 'duel', builder N): the Room fixes when each hurdle reaches the runner, the track moves at one
// pace for everybody, and a hurdle is cleared by a runner who is in the air AND keeping the pace. The game keeps the three
// promises of core/types DuelSetup (the hurdle with id n arrives at schedule t, a settled hurdle is one 'duel' event, the run ends
// with the match) and the score it adds up is the Room's own (core/net scoreOf), whatever the player chose to play alone on.
import { describe, expect, it } from 'vitest';
import type { GameEvent, InputEvent, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { makeSchedule, scoreOf, specFor, type Obstacle } from '../../core/net/schedule.ts';
import type { ObstacleResult } from '../../core/types/net.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { evt, frame, testContext, type PlayerFrame } from '../kit-g1/testing/context.ts';
import { testScene } from '../kit-g1/testing/scene.ts';
import { screenProblems } from '../kit-g1/testing/screens.ts';
import { manifest } from '../knee-sprint/index.ts';
import { createSprintGame, type SprintGame } from './game.ts';
import { DUEL_KEEP, DUEL_LEVEL, DUEL_PACE, LEVELS, createSprint, hurdleIn, stepSprint, type LaneIn } from './sim.ts';
import { sprintBot, type BotKind } from './testing/bot.ts';

const SEED = 31337;
const DURATION = 45_000;
const course = (seed = SEED, ms = DURATION): Obstacle[] => makeSchedule(seed, ms, specFor('knee-sprint'));

/** Hard on purpose: a race is run on one level, whatever the player has chosen for the runs alone. */
const START = (o: Partial<StartOptions> = {}): StartOptions => ({
  seed: SEED, difficulty: 'hard', seated: false, mode: 'duel', profile: null, duel: { schedule: course(), durationMs: DURATION }, ...o,
});

function playerOf(k: number, b: LaneIn): PlayerFrame {
  const events: InputEvent[] = b.steps.map((s) => evt('kneeLift', 'rep', k, { side: s.side || 'L', q: { range: s.k }, value: 110 }));
  for (let i = 0; i < b.jumps; i++) events.push(evt('jump', 'rep', k));
  return { channels: { 'knee.L': b.knees[0], 'knee.R': b.knees[1], 'energy.avg': b.effort, torso: b.torso }, events };
}
const inputOf = (k: number, b: LaneIn): { channels: Record<string, number>; events: InputEvent[] } => ({ channels: playerOf(k, b).channels!, events: playerOf(k, b).events! });

async function newGame(o: { ctxSeed?: number; start?: StartOptions; seated?: boolean; silent?: boolean } = {}): Promise<{ game: SprintGame; hud: [string, unknown][] }> {
  const t = testContext({ seed: o.ctxSeed ?? 1, ...(o.seated ? { seated: true } : {}), ...(o.silent ? { silent: true } : {}) });
  const game = createSprintGame(manifest, { view: false });
  await game.init(t.ctx);
  game.start(o.start ?? START());
  return { game, hud: t.hud };
}

interface Run { events: GameEvent[]; steps: number; phase: string; results: ObstacleResult[] }

const resultsOf = (events: readonly GameEvent[]): ObstacleResult[] =>
  events.filter((e) => e.type === 'duel').map((e) => ({ ob: e['ob'] as number, k: e['k'] as 'pass' | 'hit' }));

/** Plays the whole match with a bot through Game.step. */
function play(game: SprintGame, kind: BotKind, o: { botSeed?: number; steps?: number } = {}): Run {
  const bot = sprintBot(kind, o.botSeed ?? 1);
  const events: GameEvent[] = [];
  let k = 0;
  let phase = 'running';
  while (phase === 'running' && k < (o.steps ?? 60 * 400)) {
    const b = bot.next(game.state!, 0, FIXED_DT);
    const i = inputOf(k + 1, b);
    const r = game.step(FIXED_DT, frame(++k, i.channels, i.events));
    events.push(...r.events);
    phase = r.phase;
  }
  return { events, steps: k, phase, results: resultsOf(events) };
}

/** A body of one's own making: steps at `spm` steps a minute with a high knee, and jumps when `jump(hurdleInSeconds)` says so. */
function body(spm: number, jump: (arrive: number, sinceJump: number) => boolean) {
  let u = 0, leg = 0, lastJump = 99;
  return (game: SprintGame, k: number): { channels: Record<string, number>; events: InputEvent[] } => {
    const s = game.state!;
    u += FIXED_DT;
    lastJump += FIXED_DT;
    const events: InputEvent[] = [];
    if (spm > 0 && u >= 60 / spm) { u = 0; leg ^= 1; events.push(evt('kneeLift', 'rep', k, { side: leg ? 'L' : 'R', q: { range: 0.8 }, value: 110 })); }
    if (jump(hurdleIn(s, 0), lastJump)) { lastJump = 0; events.push(evt('jump', 'rep', k)); }
    return { channels: { 'knee.L': 0, 'knee.R': 0, 'energy.avg': 0, torso: 1 }, events };
  };
}

function playBody(game: SprintGame, make: ReturnType<typeof body>): Run {
  const events: GameEvent[] = [];
  let phase = 'running';
  let k = 0;
  while (phase === 'running' && k < 60 * 400) {
    const i = make(game, k + 1);
    const r = game.step(FIXED_DT, frame(++k, i.channels, i.events));
    events.push(...r.events);
    phase = r.phase;
  }
  return { events, steps: k, phase, results: resultsOf(events) };
}

describe('the hurdles of a race', () => {
  const mk = (difficulty = 'normal', schedule = course(), o: { seated?: boolean } = {}) =>
    createSprint({ difficulty, players: 1, seated: o.seated ?? false, quiet: false, rng: rngStream(SEED, 'course'), duel: { schedule, durationMs: DURATION } });

  it('hurdle id n reaches the runner at schedule t: placed by time on a track that moves at one pace, whatever the runner does', () => {
    const sch = course();
    const s = mk();
    expect(s.duel).toEqual({ ids: sch.map((o) => o.id), ms: DURATION });
    expect(s.phase).toBe('play');
    expect(s.heats).toBe(1);
    expect(s.dist).toBeCloseTo(DUEL_PACE * 45, 6);
    s.hurdles.forEach((h, i) => expect(h).toBeCloseTo(DUEL_PACE * ((sch[i] as Obstacle).t / 1000), 10));
    // And a runner who stands still is carried to each one at that time anyway.
    const idle: LaneIn = { steps: [], jumps: 0, effort: 0, knees: [0, 0], torso: 1 };
    let at = -1;
    for (let k = 1; k <= 60 * 5 && at < 0; k++) {
      stepSprint(s, FIXED_DT, [idle]);
      if (s.lanes[0]!.dist >= (s.hurdles[0] as number)) at = s.hc;
    }
    expect(at).toBeGreaterThanOrEqual((sch[0] as Obstacle).t / 1000 - 0.02);
    expect(at).toBeLessThan((sch[0] as Obstacle).t / 1000 + 0.05);
  });

  it('the time to the next hurdle is the track\'s: it does not depend on the runner\'s speed (the bots time their jumps by it)', () => {
    const s = mk();
    const t0 = (course()[0] as Obstacle).t / 1000;
    expect(hurdleIn(s, 0)).toBeCloseTo(t0, 6);
    stepSprint(s, 1, [{ steps: [], jumps: 0, effort: 0, knees: [0, 0], torso: 1 }]);
    expect(hurdleIn(s, 0)).toBeCloseTo(t0 - 1, 6);
  });

  it('everybody races on one level: the difficulty a player chose alone changes nothing', () => {
    const normal = mk('normal');
    for (const d of ['easy', 'hard', 'expert', 'nonsense']) {
      const s = mk(d);
      expect(s.difficulty).toBe(DUEL_LEVEL);
      expect(s.hurdles).toEqual(normal.hurdles);
      expect(s.dist).toBe(normal.dist);
      expect(s.cadFull).toBe(LEVELS[DUEL_LEVEL].cadence);
    }
  });

  it('there is no warm-up, no rest and no heat: one continuous run of the length of the match, with a finish line at its end', () => {
    const s = mk();
    expect(s.phase).toBe('play');
    expect(s.restSec).toBe(0);
    expect(s.rival).toBeNull();
    expect(s.warm.stepT).toEqual([]);
  });
});

describe('the promises of a game that can be raced', () => {
  it('a runner who keeps the pace and jumps clears every hurdle: one duel event per hurdle, in order, none twice; the run ends with the match', async () => {
    const { game } = await newGame();
    const r = play(game, 'perfect');
    const sch = course();
    expect(r.phase).toBe('complete');
    expect(r.results.map((e) => e.ob)).toEqual(sch.map((o) => o.id));
    expect(r.results.every((e) => e.k === 'pass')).toBe(true);
    expect(r.steps * FIXED_DT * 1000).toBeGreaterThanOrEqual(DURATION - 1);
    expect(r.steps * FIXED_DT * 1000).toBeLessThan(DURATION + 40);
    const sum = game.summary();
    expect(sum.score).toBe(scoreOf(sch, r.results).score);
    expect(sum.cleared).toBe(sch.length);
    expect(sum.hits).toBe(0);
    // No heat, no medal, no finish: a race is not a sprint over a distance.
    expect(r.events.some((e) => e.type === 'finish' || e.type === 'dnf' || e.type === 'rest' || e.type === 'ready' || e.type === 'over')).toBe(false);
  });

  it('standing still hits every hurdle: no early end (no called-off heat), the score is nothing and the Room would agree', async () => {
    const { game } = await newGame();
    const r = play(game, 'idle');
    const sch = course();
    expect(r.phase).toBe('complete');
    expect(r.results.map((e) => e.ob)).toEqual(sch.map((o) => o.id));
    expect(r.results.every((e) => e.k === 'hit')).toBe(true);
    expect(game.summary().score).toBe(0);
    expect(r.events.some((e) => e.type === 'dnf' || e.type === 'over' || e.type === 'out')).toBe(false);
  });

  it('a sloppy runner clears some and knocks some; every hurdle is settled exactly once and the sum is the Room\'s', async () => {
    const { game } = await newGame();
    const r = play(game, 'sloppy', { botSeed: 3 });
    const sch = course();
    expect(r.phase).toBe('complete');
    expect(r.results.map((e) => e.ob).sort((a, b) => a - b)).toEqual(sch.map((o) => o.id));
    const passes = r.results.filter((e) => e.k === 'pass').length;
    const hits = r.results.length - passes;
    expect(passes + hits).toBe(sch.length);
    const sum = game.summary();
    expect(sum.score).toBe(scoreOf(sch, r.results).score);
    expect(sum.cleared).toBe(passes);
    expect(sum.hits).toBe(hits);
  });

  it('a jump without running is a hit named "move more"; running without a jump is a hit named for the missing jump', async () => {
    const jumpOnly = await newGame();
    const a = playBody(jumpOnly.game, body(0, (arrive, since) => arrive <= 0.25 && since > 0.7));
    expect(a.results.length).toBe(course().length);
    expect(a.results.every((e) => e.k === 'hit')).toBe(true);
    expect(a.events.filter((e) => e.type === 'hurdle').every((e) => e['reason'] === 'move_more')).toBe(true);

    const runOnly = await newGame();
    const b = playBody(runOnly.game, body(130, () => false));
    expect(b.results.every((e) => e.k === 'hit')).toBe(true);
    expect(b.events.filter((e) => e.type === 'hurdle').every((e) => e['reason'] === 'hurdle_none')).toBe(true);

    // Both together clear them: a plain march at 110 steps a minute and a jump as the hurdle arrives.
    const both = await newGame();
    const c = playBody(both.game, body(110, (arrive, since) => arrive <= 0.25 && since > 0.7));
    expect(c.results.every((e) => e.k === 'pass')).toBe(true);
  });

  it('keeping the pace means half of the full pace and no less: a march just over the line clears, just under does not', async () => {
    const full = LEVELS[DUEL_LEVEL].cadence;
    for (const [spm, clears] of [[full * DUEL_KEEP * 1.25, true], [full * DUEL_KEEP * 0.7, false]] as const) {
      const { game } = await newGame();
      const r = playBody(game, body(spm, (arrive, since) => arrive <= 0.25 && since > 0.7));
      // The first hurdle comes after three seconds, when the march has been going long enough to be measured.
      expect(r.results.every((e) => e.k === (clears ? 'pass' : 'hit')), `${spm} steps a minute`).toBe(true);
    }
  });

  it('seated: there is no jump, and keeping the effort up is the whole of the hurdle', async () => {
    const run = async (effort: number): Promise<Run> => {
      const { game } = await newGame({ start: START({ seated: true }), seated: true });
      const events: GameEvent[] = [];
      let phase = 'running', k = 0;
      while (phase === 'running' && k < 60 * 400) {
        const r = game.step(FIXED_DT, frame(++k, { 'knee.L': 0, 'knee.R': 0, 'energy.avg': effort, torso: 1 }));
        events.push(...r.events);
        phase = r.phase;
      }
      return { events, steps: k, phase, results: resultsOf(events) };
    };
    const good = await run(0.9);
    const none = await run(0.1);
    expect(good.results.length).toBe(course().length);
    expect(good.results.every((e) => e.k === 'pass')).toBe(true);
    expect(none.results.every((e) => e.k === 'hit')).toBe(true);
  });

  it('the quiet way: a knee lifted to the hip clears a hurdle, a jump does not count', async () => {
    const { game } = await newGame({ silent: true });
    const events: GameEvent[] = [];
    let phase = 'running', k = 0, u = 0, leg = 0, high = 0;
    while (phase === 'running' && k < 60 * 400) {
      k++;
      u += FIXED_DT;
      const ev: InputEvent[] = [];
      const arrive = hurdleIn(game.state!, 0);
      if (u >= 60 / 115) {
        u = 0; leg ^= 1;
        // The stride that is counted inside the hurdle's window lifts to the hip.
        const q = arrive <= 0.45 && arrive >= 0.05 ? 1.1 : 0.8;
        if (q > 1) high++;
        ev.push(evt('kneeLift', 'rep', k, { side: leg ? 'L' : 'R', q: { range: q }, value: 110 }));
      }
      if (arrive <= 0.25) ev.push(evt('jump', 'rep', k));
      const r = game.step(FIXED_DT, frame(k, { 'knee.L': 0, 'knee.R': 0, 'energy.avg': 0, torso: 1 }, ev));
      events.push(...r.events);
      phase = r.phase;
    }
    const res = resultsOf(events);
    expect(res.length).toBe(course().length);
    // Some hurdles were met by a high knee: those cleared, the rest were not (a jump alone is nothing in the quiet way).
    expect(high).toBeGreaterThan(5);
    const cleared = res.filter((e) => e.k === 'pass').length;
    expect(cleared).toBeGreaterThan(0);
    expect(cleared).toBeLessThanOrEqual(high);
  });

  it('the race is run on the match seed, not on the session stream: two devices whose own streams differ run the same track', async () => {
    const a = await newGame({ ctxSeed: 1 });
    const b = await newGame({ ctxSeed: 777 });
    const ra = play(a.game, 'good', { botSeed: 5 });
    const rb = play(b.game, 'good', { botSeed: 5 });
    expect(rb.events).toEqual(ra.events);
    expect(a.game.state!.hurdles).toEqual(b.game.state!.hurdles);
  });

  it('the same seed and the same play give the same events; another match gives another schedule', async () => {
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
    const rec = await newGame();
    const bot = sprintBot('good', 4);
    const inputs: ReturnType<typeof inputOf>[] = [];
    for (let k = 1; k <= 60 * 46; k++) {
      const b = bot.next(rec.game.state!, 0, FIXED_DT);
      const i = inputOf(k, b);
      inputs.push(i);
      if (rec.game.step(FIXED_DT, frame(k, i.channels, i.events)).phase !== 'running') break;
    }
    const feed = (game: SprintGame, from: number, to: number): GameEvent[] => {
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
    const game = createSprintGame(manifest, { view: false });
    await game.init(t.ctx);
    const o = START();
    delete (o as { duel?: unknown }).duel;
    expect(() => game.start(o)).toThrow(/duel/);
  });

  it("the plates are the race's: the game writes no score and no combo; the clock counts the match down", async () => {
    const { game, hud } = await newGame();
    play(game, 'good', { botSeed: 3, steps: 60 * 20 });
    game.render(1);
    const slots = new Set(hud.map(([slot]) => slot));
    expect(slots.has('timer')).toBe(true);
    for (const forbidden of ['score', 'combo']) expect(slots.has(forbidden), forbidden).toBe(false);
    const timers = hud.filter(([slot]) => slot === 'timer').map(([, v]) => v as number);
    expect(timers[0]).toBe(45);
    expect(timers.at(-1)!).toBeLessThan(30);
  });
});

describe('the picture of a race', () => {
  it('on every one of the ten screens nothing runs off the screen and the runner is clear of the plates; no heats, no medal times', async () => {
    for (const b of BREAKPOINTS) {
      const scene = testScene(b.w, b.h);
      const t = testContext({ scene2d: scene.kit });
      const game = createSprintGame(manifest);
      await game.init(t.ctx);
      game.start(START());
      const bot = sprintBot('good', 3);
      const problems = new Set<string>();
      let frames = 0;
      for (let k = 1; k < 60 * 30 && game.state!.phase === 'play'; k++) {
        const i = inputOf(k, bot.next(game.state!, 0, FIXED_DT));
        game.step(FIXED_DT, frame(k, i.channels, i.events));
        if (k % 20 === 0) {
          scene.ctx.texts.length = 0;
          game.render(0.5);
          frames++;
          for (const p of screenProblems(scene, game.view!.runnerAt(0), `${b.label} race`)) problems.add(p);
        }
      }
      expect([...problems], b.label).toEqual([]);
      expect(frames, b.label).toBeGreaterThan(30);
      const said = scene.ctx.texts.map((x) => x.text).join(' | ');
      expect(said, b.label).not.toMatch(/Heat|Warm-up|Rest/);
      game.dispose();
    }
  });
});
