// Reaction Tag as a live race (mode 'duel'): the Room fixes when each light comes on (every obstacle of its course is one light), the game
// keeps the three promises of core/types DuelSetup (the light with id n comes on at schedule t whatever the player does; a settled light
// is one 'duel' event; the run ends with the match), and the score it adds up is the Room's own (core/net scoreOf). A green light tapped
// in time passes, a green one that faded or a red one that was touched is a hit, a red one left alone is neither.
import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { profileOf, SHAPE_FULL, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';
import { makeSchedule, scoreOf, specFor, type Obstacle } from '../../core/net/schedule.ts';
import type { ObstacleResult } from '../../core/types/net.ts';
import { testContext } from '../kit-g1/testing/context.ts';
import { manifest, reactionTagModule } from '../reaction-tag/index.ts';
import { starCatchModule } from '../star-catch/index.ts';
import type { TargetEngine } from './engine.ts';
import { envelopeOf, reachRatio, spot } from './envelope.ts';
import type { TargetGame } from './game.ts';
import { DUEL_CFG, DUEL_LIFE, DUEL_SAFE_LIGHTS, planDuelLights, type LightSpec } from './reaction-tag.ts';
import { frameOf, VirtualBody } from './testing/body.ts';
import { Chaser, type BotMode } from './testing/bots.ts';
import { seenOf } from './testing/play.ts';
import type { BaseSpec } from './types.ts';

const SEED = 90210;
const DURATION = 45_000;
const course = (seed = SEED, ms = DURATION): Obstacle[] => makeSchedule(seed, ms, specFor('reaction-tag'));

const START = (body: VirtualBody | null, o: Partial<StartOptions> = {}): StartOptions => ({
  seed: SEED, difficulty: 'hard', seated: false, mode: 'duel', profile: body ? body.profile : null, duel: { schedule: course(), durationMs: DURATION }, ...o,
});

type Game = TargetGame<LightSpec & BaseSpec>;

async function newGame(o: { ctxSeed?: number; body?: VirtualBody; start?: Partial<StartOptions>; seated?: boolean; silent?: boolean } = {}): Promise<{ game: Game; body: VirtualBody; hud: [string, unknown][]; announced: string[]; sounds: string[] }> {
  const t = testContext({ seed: o.ctxSeed ?? 1, ...(o.seated ? { seated: true } : {}), ...(o.silent ? { silent: true } : {}) });
  const game = reactionTagModule().create() as unknown as Game;
  await game.init(t.ctx);
  const body = o.body ?? new VirtualBody({ clockOffset: 5000 });
  game.start(START(body, o.start));
  return { game, body, hud: t.hud, announced: t.announced, sounds: t.sounds };
}

interface Run { events: GameEvent[]; steps: number; phase: string; results: ObstacleResult[] }

const resultsOf = (events: readonly GameEvent[]): ObstacleResult[] =>
  events.filter((e) => e.type === 'duel').map((e) => ({ ob: e['ob'] as number, k: e['k'] as 'pass' | 'hit' }));

/** Plays the whole match with a chasing bot through Game.step (the real handHit detector reads the bot's body). */
function play(game: Game, body: VirtualBody, mode: BotMode, o: { botSeed?: number; from?: number; steps?: number; ok?: (k: number) => boolean; render?: number } = {}): Run {
  const chaser = new Chaser(mode, o.botSeed ?? 1);
  const events: GameEvent[] = [];
  let k = o.from ?? 0;
  let phase = 'running';
  const max = (o.from ?? 0) + (o.steps ?? 60 * 400);
  while (phase === 'running' && k < max) {
    k++;
    const lane = (game.engine as TargetEngine<LightSpec & BaseSpec>).view().lanes[0];
    if (lane) chaser.steer(body, seenOf(lane));
    const channels = body.step(k);
    // nobody in the picture: the camera gives the game no hands at all
    const seen = o.ok ? o.ok(k) : true;
    const r = game.step(FIXED_DT, frameOf(k, seen ? channels : {}, { ok: seen }));
    events.push(...r.events);
    phase = r.phase;
    if (o.render && k % o.render === 0) game.render(0.5);
  }
  return { events, steps: k, phase, results: resultsOf(events) };
}

const avoided = (events: readonly GameEvent[]): number[] => events.filter((e) => e.type === 'avoid').map((e) => e['id'] as number);

describe('the lights of a race', () => {
  const plan = (o: { seed?: number; d?: { schedule: Obstacle[]; durationMs: number } } = {}): LightSpec[] =>
    planDuelLights(rngStream(o.seed ?? SEED, 'course'), o.d ?? { schedule: course(o.seed ?? SEED), durationMs: DURATION });

  it('is one light for each obstacle of the Room\'s course, at the obstacle\'s time, in order, numbered by place', () => {
    const sch = course();
    const lights = plan();
    expect(sch.length).toBeGreaterThan(20);
    expect(lights).toHaveLength(sch.length);
    lights.forEach((l, i) => {
      expect(l.id).toBe(i);
      expect(l.ob).toBe((sch[i] as Obstacle).id);
      expect(l.at).toBe((sch[i] as Obstacle).t);
    });
  });

  it('is hand lights only, the first ones never red, and the red ones a few in the match', () => {
    const lights = plan();
    expect(lights.every((l) => l.zone === 'hand' && l.limb === 'hand')).toBe(true);
    expect(lights.slice(0, DUEL_SAFE_LIGHTS).every((l) => !l.trap)).toBe(true);
    let red = 0, all = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const l = plan({ seed });
      all += l.length;
      red += l.filter((x) => x.trap).length;
    }
    expect(red / all).toBeGreaterThan(0.06);
    expect(red / all).toBeLessThan(0.2);
  });

  it('stays on screen for 1.9 s at the start of the match down to 1.4 s at the end, and is out before the match ends', () => {
    const lights = plan();
    expect(DUEL_LIFE).toEqual(DUEL_CFG.life);
    for (const l of lights) {
      expect(l.life).toBeGreaterThanOrEqual(DUEL_LIFE[1]);
      expect(l.life).toBeLessThanOrEqual(DUEL_LIFE[0]);
      expect(l.at + l.life).toBeLessThan(DURATION);
    }
    expect((lights[0] as LightSpec).life).toBeGreaterThan((lights.at(-1) as LightSpec).life);
    // a match as short as a room allows (15 s) still has them all gone before the end
    for (const seed of [3, 4, 5]) {
      const d = { schedule: course(seed, 15_000), durationMs: 15_000 };
      expect(d.schedule.length).toBeGreaterThan(3);
      for (const l of plan({ seed, d })) expect(l.at + l.life).toBeLessThan(15_000);
    }
  });

  it('is a function of the match seed and the course alone: the same everywhere, another seed another look', () => {
    expect(plan()).toEqual(plan());
    const other = plan({ seed: SEED + 1 });
    expect(other.map((l) => [l.ax, l.ay, l.trap])).not.toEqual(plan().map((l) => [l.ax, l.ay, l.trap]));
    // the order the Room lists its obstacles in changes nothing
    const sch = course();
    expect(plan({ d: { schedule: [...sch].reverse(), durationMs: DURATION } })).toEqual(plan());
  });

  it('keeps lights that are on the screen together apart, and off the head', () => {
    for (const seed of [11, 12, 13]) {
      const lights = plan({ seed, d: { schedule: course(seed, 90_000), durationMs: 90_000 } });
      let close = 0, pairs = 0;
      for (let i = 0; i < lights.length; i++) {
        const a = lights[i] as LightSpec;
        expect(Math.abs(a.ax) < 0.22 && a.ay > 0.15 && a.ay < 0.65, `light ${i} on the head`).toBe(false);
        for (let j = i + 1; j < lights.length; j++) {
          const b = lights[j] as LightSpec;
          if (b.at >= a.at + a.life) break;
          pairs++;
          if (Math.hypot(a.ax - b.ax, a.ay - b.ay) < 0.3) close++;
        }
      }
      expect(pairs).toBeGreaterThan(10);
      expect(close / pairs).toBeLessThan(0.1);
    }
  });

  it('is the same plan for every player: a standing body, a desk, quiet mode, a keyboard and any level start the engine on the same lights', async () => {
    const engines: LightSpec[][] = [];
    const variants: Partial<StartOptions>[] = [{}, { seated: true }, { difficulty: 'easy' }, { difficulty: 'expert' }, { profile: null }];
    for (const v of variants) {
      const { game } = await newGame({ start: v, ...(v.seated ? { seated: true } : {}) });
      engines.push((game.engine as TargetEngine<LightSpec>).plan);
    }
    const quiet = await newGame({ silent: true });
    engines.push((quiet.game.engine as TargetEngine<LightSpec>).plan);
    const tall = await newGame({ body: new VirtualBody({ profile: profileOf(SHAPE_FULL, 'full'), feet: true }) });
    engines.push((tall.game.engine as TargetEngine<LightSpec>).plan);
    for (const p of engines) expect(p).toEqual(plan());
  });

  it('lands each light inside the reach of the player it is for: their arm, their picture, a desk\'s shorter reach', () => {
    const lights = plan({ seed: 6, d: { schedule: course(6, 90_000), durationMs: 90_000 } });
    for (const [label, profile, seated] of [['upper body', profileOf(SHAPE_UPPER, 'upper'), false], ['at a desk', profileOf(SHAPE_UPPER, 'upper'), true], ['full body', profileOf(SHAPE_FULL, 'full'), false]] as const) {
      const env = envelopeOf(profile, { seated });
      for (const l of lights) {
        const p = spot(env, l.ax, l.ay);
        expect(p.x, `${label} ${l.id}`).toBeGreaterThanOrEqual(env.frame.x0 - 1e-9);
        expect(p.x, `${label} ${l.id}`).toBeLessThanOrEqual(env.frame.x1 + 1e-9);
        expect(p.y, `${label} ${l.id}`).toBeLessThanOrEqual(env.frame.y1 + 1e-9);
        // a hand standing still reaches it: nearer than about one arm from one of the shoulders
        expect(Math.min(reachRatio(env, 'L', p), reachRatio(env, 'R', p)), `${label} ${l.id}`).toBeLessThan(1.06);
      }
    }
    // the same light is in a different place for two bodies (each its own arm), and nearer for a player at a desk
    const a = envelopeOf(profileOf(SHAPE_UPPER, 'upper'), { seated: false });
    const b = envelopeOf(profileOf(SHAPE_UPPER, 'upper'), { seated: true });
    const far = lights.find((l) => Math.abs(l.ax) > 0.8) as LightSpec;
    expect(Math.abs(spot(b, far.ax, far.ay).x)).toBeLessThan(Math.abs(spot(a, far.ax, far.ay).x));
  });
});

describe('the promises of a game that can be raced', () => {
  it("its manifest says so, and mode 'duel' without the Room's course is a mistake, not a silent solo run", async () => {
    expect(manifest.modes).toContain('duel');
    expect(manifest.free).toBe(false);
    const t = testContext();
    const game = reactionTagModule().create();
    await game.init(t.ctx);
    const o = START(new VirtualBody());
    delete (o as { duel?: unknown }).duel;
    expect(() => game.start(o)).toThrow(/duel/);
  });

  it('a game whose rules cannot make a race plan refuses one', async () => {
    const t = testContext();
    const game = starCatchModule().create();
    await game.init(t.ctx);
    expect(() => game.start(START(new VirtualBody()))).toThrow(/cannot be raced/);
  });

  it('a perfect player passes every green light and leaves every red one alone: one duel event per green light, in order, none twice; the run ends with the match', async () => {
    const { game, body } = await newGame();
    const r = play(game, body, 'perfect');
    const sch = course();
    const lights = (game.engine as TargetEngine<LightSpec>).plan;
    const greens = lights.filter((l) => !l.trap);
    expect(r.phase).toBe('complete');
    expect(lights.some((l) => l.trap)).toBe(true);
    // every green light, once, in the order they came on; the red ones are not there
    expect(new Set(r.results.map((e) => e.ob)).size).toBe(r.results.length);
    expect(r.results.map((e) => e.ob)).toEqual(greens.map((l) => l.ob));
    expect(r.results.every((e) => e.k === 'pass')).toBe(true);
    // the red lights were left alone: they went out untouched
    expect(avoided(r.events)).toEqual(lights.filter((l) => l.trap).map((l) => l.id));
    // the run ends with the match, to the step
    expect(r.steps * FIXED_DT * 1000).toBeGreaterThanOrEqual(DURATION - 1);
    expect(r.steps * FIXED_DT * 1000).toBeLessThan(DURATION + 40);
    // what the game adds up is what the Room will say
    const sum = game.summary();
    expect(sum.score).toBe(scoreOf(sch, r.results).score);
    expect(sum.score).toBeGreaterThan(0);
    expect(sum.seconds).toBeCloseTo(DURATION / 1000, 1);
    expect(sum.hits).toBe(greens.length);
    // the reaction of every tap is in the log for the results page
    expect(sum.log.filter((e) => e.kind === 'tag' && e.ok && (e.v ?? 0) > 0)).toHaveLength(greens.length);
  });

  it('standing still misses every green light and touches no red one: every green is a hit, the score is nothing, nothing ends the run early', async () => {
    const { game, body } = await newGame();
    const r = play(game, body, 'idle');
    const lights = (game.engine as TargetEngine<LightSpec>).plan;
    const greens = lights.filter((l) => !l.trap);
    expect(r.phase).toBe('complete');
    expect(r.results.map((e) => e.ob)).toEqual(greens.map((l) => l.ob));
    expect(r.results.every((e) => e.k === 'hit')).toBe(true);
    expect(game.summary().score).toBe(0);
    expect(scoreOf(course(), r.results)).toMatchObject({ score: 0, passes: 0, hits: greens.length });
    expect(r.events.some((e) => e.type === 'over')).toBe(false);
  });

  it('a red light that is touched is a hit and breaks the combo; one left alone is neither and the combo goes on', async () => {
    // A player who taps whatever is lit, red or not, with both hands out.
    const { game, body } = await newGame();
    const lights = (game.engine as TargetEngine<LightSpec>).plan;
    const reds = lights.filter((l) => l.trap);
    expect(reds.length).toBeGreaterThan(1);
    const eager = new Chaser('perfect', 4);
    const events: GameEvent[] = [];
    let k = 0;
    let phase = 'running';
    while (phase === 'running' && k < 60 * 100) {
      k++;
      const lane = (game.engine as TargetEngine<LightSpec>).view().lanes[0];
      if (lane) eager.steer(body, seenOf(lane).map((s) => ({ ...s, avoid: false })));
      const r = game.step(FIXED_DT, frameOf(k, body.step(k)));
      events.push(...r.events);
      phase = r.phase;
    }
    const results = resultsOf(events);
    const hitReds = reds.filter((l) => results.some((e) => e.ob === l.ob && e.k === 'hit'));
    expect(hitReds.length).toBeGreaterThan(0);
    // every red light has at most one outcome, and it is a hit
    for (const l of reds) expect(results.filter((e) => e.ob === l.ob).every((e) => e.k === 'hit')).toBe(true);
    expect(events.filter((e) => e.type === 'trap').length).toBe(hitReds.length);
    // the picture says "0" over a red light that was touched, not the "-40" of a round alone: the race's score has nothing to take away
    expect(events.filter((e) => e.type === 'trap').every((e) => e['pts'] === 0)).toBe(true);
    // the Room's sum from these results is the game's own
    expect(game.summary().score).toBe(scoreOf(course(), results).score);
    // and a red light touched costs the combo: no pass is scored for it
    const sch = course();
    for (const l of hitReds) expect(scoreOf(sch, [{ ob: l.ob as number, k: 'pass' }]).passes).toBe(1);
    expect(results.some((e) => e.ob === (hitReds[0] as LightSpec).ob && e.k === 'pass')).toBe(false);
  });

  it('a light settles when it is tapped or when it fades, and a light tapped is not missed as well: every outcome once, the Room\'s score is the game\'s', async () => {
    const { game, body } = await newGame();
    const r = play(game, body, 'sloppy', { botSeed: 3 });
    const sch = course();
    const lights = (game.engine as TargetEngine<LightSpec>).plan;
    expect(r.phase).toBe('complete');
    const ids = r.results.map((e) => e.ob);
    expect(new Set(ids).size).toBe(ids.length);
    // every light the player was asked to tap has an outcome; a red light has one only if it was touched
    for (const l of lights.filter((x) => !x.trap)) expect(ids, `green ${l.ob}`).toContain(l.ob);
    const passes = r.results.filter((e) => e.k === 'pass').length;
    const hits = r.results.filter((e) => e.k === 'hit').length;
    expect(passes).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
    expect(passes + hits).toBe(ids.length);
    expect(game.summary().score).toBe(scoreOf(sch, r.results).score);
  });

  it('the first outcome comes after the first light comes on, not before', async () => {
    const { game, body } = await newGame();
    const r = play(game, body, 'perfect');
    const first = r.events.find((e) => e.type === 'duel') as GameEvent;
    const t0 = (course()[0] as Obstacle).t;
    expect(first.t).toBeGreaterThanOrEqual(t0 - 1);
    expect(first.t).toBeLessThan(t0 + 1900);
  });

  it('a light comes on at the schedule\'s time whatever the player does: the plan is the Room\'s, step by step', async () => {
    const { game } = await newGame();
    const engine = game.engine as TargetEngine<LightSpec>;
    const sch = course();
    const seen = new Map<number, number>();
    const body = new VirtualBody();
    for (let k = 1; k <= 60 * 20; k++) {
      game.step(FIXED_DT, frameOf(k, body.step(k)));
      for (const t of engine.view().lanes[0]!.targets) if (!seen.has((t.spec as LightSpec).ob as number)) seen.set((t.spec as LightSpec).ob as number, engine.t);
    }
    expect(seen.size).toBeGreaterThan(5);
    for (const [ob, at] of seen) {
      const t = (sch.find((o) => o.id === ob) as Obstacle).t;
      expect(at).toBeGreaterThanOrEqual(t - 1);
      expect(at).toBeLessThan(t + 1000 / 60 + 1);
    }
  });

  it('the race is flown on the match seed, not on the session stream: two devices whose own streams differ light the same lights', async () => {
    const a = await newGame({ ctxSeed: 1, body: new VirtualBody({ clockOffset: 5000 }) });
    const b = await newGame({ ctxSeed: 777, body: new VirtualBody({ clockOffset: 5000 }) });
    const ra = play(a.game, a.body, 'perfect', { botSeed: 5 });
    const rb = play(b.game, b.body, 'perfect', { botSeed: 5 });
    expect(rb.events).toEqual(ra.events);
    expect((b.game.engine as TargetEngine<LightSpec>).plan).toEqual((a.game.engine as TargetEngine<LightSpec>).plan);
  });

  it('two players with different bodies race the same lights: the same obstacles settle for both, each inside their own reach', async () => {
    const tall = new VirtualBody({ profile: profileOf(SHAPE_FULL, 'full'), feet: true, clockOffset: 5000 });
    const desk = new VirtualBody({ clockOffset: 9000 });
    const a = await newGame({ body: tall });
    const b = await newGame({ body: desk, seated: true, start: { seated: true } });
    const ra = play(a.game, tall, 'perfect', { botSeed: 2 });
    const rb = play(b.game, desk, 'perfect', { botSeed: 2 });
    const planA = (a.game.engine as TargetEngine<LightSpec>).plan;
    const planB = (b.game.engine as TargetEngine<LightSpec>).plan;
    expect(planB).toEqual(planA);
    // a perfect player of either body passes every green light (a hand on its way to one may brush a red one: that is a hit, and only on a red light)
    const greens = planA.filter((l) => !l.trap).map((l) => l.ob);
    const reds = planA.filter((l) => l.trap).map((l) => l.ob);
    for (const r of [ra, rb]) {
      expect(r.results.filter((e) => e.k === 'pass').map((e) => e.ob)).toEqual(greens);
      for (const e of r.results.filter((x) => x.k === 'hit')) expect(reds).toContain(e.ob);
    }
    expect(a.game.summary().score).toBe(scoreOf(course(), ra.results).score);
    expect(b.game.summary().score).toBe(scoreOf(course(), rb.results).score);
  });

  it('the same seed and the same play give the same events; another match seed gives another course', async () => {
    const a = await newGame({ body: new VirtualBody({ clockOffset: 5000 }) });
    const b = await newGame({ body: new VirtualBody({ clockOffset: 5000 }) });
    const sch = course(SEED + 1);
    const c = await newGame({ body: new VirtualBody({ clockOffset: 5000 }), start: { seed: SEED + 1, duel: { schedule: sch, durationMs: DURATION } } });
    const ra = play(a.game, a.body, 'sloppy', { botSeed: 2 });
    const rb = play(b.game, b.body, 'sloppy', { botSeed: 2 });
    const rc = play(c.game, c.body, 'sloppy', { botSeed: 2 });
    expect(rb.events).toEqual(ra.events);
    expect(rc.events).not.toEqual(ra.events);
  });

  it('a snapshot in the middle of the match continues identically (a reload resumes it)', async () => {
    // One bot plays once and the input it gave is written down; the same input then goes into a game that never stops and into one that
    // was snapshotted in the middle, put through JSON and restored into a fresh game.
    const rec = await newGame({ body: new VirtualBody({ clockOffset: 5000 }) });
    const chaser = new Chaser('sloppy', 4);
    const inputs: InputFrame[] = [];
    for (let k = 1; k <= 60 * 46; k++) {
      const lane = (rec.game.engine as TargetEngine<LightSpec>).view().lanes[0];
      if (lane) chaser.steer(rec.body, seenOf(lane));
      const input = frameOf(k, rec.body.step(k));
      inputs.push(input);
      if (rec.game.step(FIXED_DT, input).phase !== 'running') break;
    }
    const feed = (game: Game, from: number, to: number): GameEvent[] => {
      const out: GameEvent[] = [];
      for (let k = from + 1; k <= Math.min(to, inputs.length); k++) out.push(...game.step(FIXED_DT, inputs[k - 1] as InputFrame).events);
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
    expect(resultsOf(all).length).toBeGreaterThan(10);
    expect(second.game.summary().score).toBe(scoreOf(course(), resultsOf(all)).score);
  });

  it('the plates are the race\'s: the game writes no score and no combo, only the clock, the command and the reason', async () => {
    const { game, body, hud, announced } = await newGame();
    play(game, body, 'sloppy', { botSeed: 3, steps: 60 * 25, render: 3 });
    game.render(1);
    const slots = new Set(hud.map(([slot]) => slot));
    expect(slots.has('timer')).toBe(true);
    for (const forbidden of ['score', 'combo']) expect(slots.has(forbidden), forbidden).toBe(false);
    // the clock is the match's time left
    const timers = hud.filter(([s]) => s === 'timer').map(([, v]) => v as number);
    expect(Math.max(...timers)).toBeGreaterThan(DURATION / 1000 - 3);
    expect(Math.min(...timers)).toBeLessThan(DURATION / 1000 - 20);
    // there are no rounds to announce in a race
    expect(announced.some((x) => /round|Round/.test(x))).toBe(false);
  });

  it('is one continuous round: no rest, no round change, no "Round 1 of 3"', async () => {
    const { game, body } = await newGame();
    const r = play(game, body, 'perfect');
    expect(r.events.filter((e) => e.type === 'round')).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'rest')).toBe(false);
    const engine = game.engine as TargetEngine<LightSpec>;
    expect(engine.timeline.rounds).toBe(1);
    expect(engine.timeline.totalMs).toBe(DURATION);
    expect(engine.timeline.segments).toHaveLength(1);
  });

  it('the Room\'s clock waits for nobody: a pose that is lost for a while does not hold the match back, the lights go on and are missed', async () => {
    const { game, body } = await newGame();
    const engine = game.engine as TargetEngine<LightSpec>;
    const r = play(game, body, 'perfect', { steps: 60 * 12, ok: (k) => k < 60 * 5 || k > 60 * 9 });
    expect(r.phase).toBe('running');
    expect(engine.steps).toBe(60 * 12);
    const lost = r.results.filter((e) => e.k === 'hit');
    expect(lost.length).toBeGreaterThan(0);
  });

  it('the lights of a race on a short match of fifteen seconds: all of them settle, and the run ends with the match', async () => {
    const d = { schedule: course(5, 15_000), durationMs: 15_000 };
    const { game, body } = await newGame({ start: { seed: 5, duel: d } });
    const r = play(game, body, 'perfect');
    expect(r.phase).toBe('complete');
    expect(r.steps * FIXED_DT * 1000).toBeGreaterThanOrEqual(15_000 - 1);
    expect(r.steps * FIXED_DT * 1000).toBeLessThan(15_000 + 40);
    const greens = (game.engine as TargetEngine<LightSpec>).plan.filter((l) => !l.trap);
    expect(r.results).toHaveLength(greens.length);
  });
});
