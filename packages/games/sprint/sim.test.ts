// The sprint simulation with scripted bodies: a perfect runner, a good one, a sloppy one, one fault at a time, and one who
// stands still. The rules under test are the ones of game-design.md card 26.
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import {
  cadenceOf, clockOf, createSprint, DIFFICULTIES, hurdlesOf, hurdleIn, IDLE, levelOf, LEVELS, makeCourse, medalTimes, par, stepSprint, targetSpeed, WARMUP, WORLD,
  type Difficulty, type LaneIn, type SprintEvent, type SprintState,
} from './sim.ts';
import { sprintBot, type BotKind } from './testing/bot.ts';

interface Run { s: SprintState; events: SprintEvent[]; steps: number }

function play(kinds: BotKind[], difficulty: string, o: { seed?: number; maxSec?: number; seated?: boolean; quiet?: boolean; heats?: number; dist?: number; botSeed?: number; until?: (s: SprintState) => boolean } = {}): Run {
  const seed = o.seed ?? 5;
  const s = createSprint({ difficulty, players: kinds.length as 1 | 2, seated: o.seated ?? false, quiet: o.quiet ?? false, rng: rngStream(seed, 'course'), ...(o.heats ? { heats: o.heats } : {}), ...(o.dist ? { dist: o.dist } : {}) });
  const bots = kinds.map((k, i) => sprintBot(k, (o.botSeed ?? 1) + i * 17));
  const events: SprintEvent[] = [];
  let steps = 0;
  const max = Math.round((o.maxSec ?? 600) / FIXED_DT);
  while (s.phase !== 'over' && s.phase !== 'complete' && steps < max && !o.until?.(s)) {
    const ins: LaneIn[] = bots.map((b, i) => b.next(s, i, FIXED_DT));
    events.push(...stepSprint(s, FIXED_DT, ins));
    steps++;
  }
  return { s, events, steps };
}

const finishes = (r: Run): Extract<SprintEvent, { type: 'finish' }>[] => r.events.filter((e): e is Extract<SprintEvent, { type: 'finish' }> => e.type === 'finish');
const count = (r: Run, type: SprintEvent['type']): number => r.events.filter((e) => e.type === type).length;

/** A body that takes a step every `period` seconds with the given lift, for hand-made scenes. */
function marcher(period: number, k = 0.9): (t: number) => LaneIn {
  let next = -1;
  let leg = 0;
  return (t) => {
    if (next < 0) next = t + period;
    if (t + 1e-9 >= next) { next += period; leg ^= 1; return { ...IDLE, steps: [{ k, side: leg === 0 ? 'L' : 'R' }] }; }
    return IDLE;
  };
}

/** Starts a solo run, skips the warm-up and the three-two-one, and returns the state at the gun. */
function atTheGun(difficulty: string, o: { seated?: boolean; quiet?: boolean; dist?: number } = {}): SprintState {
  const s = createSprint({ difficulty, players: 1, seated: o.seated ?? false, quiet: o.quiet ?? false, rng: rngStream(5, 'course'), ...(o.dist ? { dist: o.dist } : {}) });
  s.phase = 'ready';
  s.hc = 0;
  const phase = (): string => s.phase;
  let guard = 0;
  while (phase() !== 'play' && guard++ < 600) stepSprint(s, FIXED_DT, [IDLE]);
  return s;
}

describe('the levels', () => {
  it('get harder in the order of the difficulties: a faster pace asked, a faster rival, tighter medal times', () => {
    const l = DIFFICULTIES.map((d) => LEVELS[d]);
    for (let i = 1; i < l.length; i++) {
      expect(l[i]!.cadence).toBeGreaterThan(l[i - 1]!.cadence);
      expect(l[i]!.vmax).toBeGreaterThan(l[i - 1]!.vmax);
      expect(l[i]!.rival100).toBeLessThan(l[i - 1]!.rival100);
      expect(l[i]!.gold100).toBeLessThanOrEqual(l[i - 1]!.gold100);
      expect(l[i]!.kFull).toBeGreaterThanOrEqual(l[i - 1]!.kFull);
    }
  });

  it("are the card's distances and programme: 100 m, the interval programme of 6 x 100 m with 40 s between, one 400 m", () => {
    expect(LEVELS.easy.dist).toBe(100);
    expect(LEVELS.hard).toMatchObject({ dist: 100, heats: 6, restSec: 40 });
    expect(LEVELS.expert).toMatchObject({ dist: 400, heats: 1 });
    // A 100 m heat is 15 to 25 seconds, a 400 m heat 60 to 90, for the gold and silver of each level.
    for (const d of ['easy', 'normal', 'hard'] as const) expect(par(LEVELS[d].silver100, 100)).toBeGreaterThan(15);
    expect(par(LEVELS.normal.gold100, 100)).toBeLessThan(25);
    expect(par(LEVELS.expert.silver100, 400)).toBeGreaterThan(60);
    expect(par(LEVELS.expert.gold100, 400)).toBeLessThan(90);
  });

  it('an unknown difficulty is normal', () => {
    expect(levelOf('nonsense')).toBe(LEVELS.normal);
  });
});

describe('the course', () => {
  it('is the same for the same seed and different for another, with a fixed number of draws', () => {
    const a = makeCourse(rngStream(3, 'course'));
    expect(makeCourse(rngStream(3, 'course'))).toEqual(a);
    expect(makeCourse(rngStream(4, 'course'))).not.toEqual(a);
    let draws = 0;
    makeCourse(() => { draws++; return 0.5; });
    expect(draws).toBe(6 * 9);
  });

  it('puts the hurdles in the middle of the heat, apart from each other, and none on a heat without room', () => {
    for (const d of ['normal', 'hard', 'expert'] as const) {
      for (const c of makeCourse(rngStream(9, 'course'))) {
        const h = hurdlesOf(LEVELS[d], c);
        expect(h).toHaveLength(LEVELS[d].hurdles);
        for (let i = 0; i < h.length; i++) {
          expect(h[i]!).toBeGreaterThanOrEqual(WORLD.hurdleFrom);
          expect(h[i]!).toBeLessThanOrEqual(LEVELS[d].dist - WORLD.hurdleTo);
          if (i > 0) expect(h[i]! - h[i - 1]!).toBeGreaterThan(8);
        }
      }
    }
    expect(hurdlesOf(LEVELS.normal, makeCourse(rngStream(1, 'course'))[0]!, 30)).toEqual([]);
    expect(hurdlesOf(LEVELS.easy, makeCourse(rngStream(1, 'course'))[0]!)).toEqual([]);
  });
});

describe('the speed', () => {
  it('follows the pace of the strides and the height of the knees: stepping faster or higher runs faster, stopping stops', () => {
    const speedAt = (period: number, k: number): number => {
      const s = atTheGun('easy');
      const body = marcher(period, k);
      for (let i = 0; i < 60 * 8; i++) stepSprint(s, FIXED_DT, [body(s.t)]);
      return s.lanes[0]!.v;
    };
    const slow = speedAt(0.7, 0.9), fast = speedAt(0.46, 0.9);
    expect(fast).toBeGreaterThan(slow * 1.3);
    const low = speedAt(0.46, 0.5), high = speedAt(0.46, 0.9);
    expect(high).toBeGreaterThan(low * 1.1);
    // A march at the card's lowest line still runs, at 60 to 100 percent of the full speed of the knees.
    expect(low / high).toBeGreaterThan(0.6);
    expect(low / high).toBeLessThan(1);
    const s = atTheGun('easy');
    const body = marcher(0.46);
    for (let i = 0; i < 60 * 5; i++) stepSprint(s, FIXED_DT, [body(s.t)]);
    expect(s.lanes[0]!.v).toBeGreaterThan(4);
    for (let i = 0; i < 60 * 3; i++) stepSprint(s, FIXED_DT, [IDLE]);
    expect(s.lanes[0]!.v).toBeLessThan(0.2);
  });

  it('the cadence is the steps per minute over the recent steps, and nothing after a pause', () => {
    const s = atTheGun('normal');
    const body = marcher(0.5);
    for (let i = 0; i < 60 * 3; i++) stepSprint(s, FIXED_DT, [body(s.t)]);
    expect(cadenceOf(s.lanes[0]!, s.t)).toBeGreaterThan(115);
    expect(cadenceOf(s.lanes[0]!, s.t)).toBeLessThan(125);
    expect(cadenceOf(s.lanes[0]!, s.t + 2)).toBe(0);
    expect(targetSpeed(s, { ...s.lanes[0]!, stepT: [] })).toBe(0);
  });

  it('a stumble slows to a third and then the runner is back on pace', () => {
    const s = atTheGun('normal');
    const body = marcher(0.46);
    for (let i = 0; i < 60 * 6; i++) stepSprint(s, FIXED_DT, [body(s.t)]);
    const l = s.lanes[0]!;
    l.stumble = 0;
    const before = targetSpeed(s, l);
    l.stumble = 0.9;
    expect(targetSpeed(s, l)).toBeCloseTo(before * 0.35, 5);
  });

  it('keys and taps (steps without a side or a lift) alternate the legs and run at the knees the level asks', () => {
    const s = atTheGun('normal');
    const l = s.lanes[0]!;
    stepSprint(s, FIXED_DT, [{ ...IDLE, steps: [{ k: 0.85, side: '' }] }]);
    expect(l.lastLeg).toBe(0);
    for (let i = 0; i < 20; i++) stepSprint(s, FIXED_DT, [IDLE]);
    stepSprint(s, FIXED_DT, [{ ...IDLE, steps: [{ k: 0.85, side: '' }] }]);
    expect(l.lastLeg).toBe(1);
  });
});

describe('a perfect runner', () => {
  it('normal: four heats on the gold times, beats the computer every time and clears every hurdle', () => {
    const r = play(['perfect'], 'normal');
    expect(r.s.phase).toBe('complete');
    const f = finishes(r);
    expect(f).toHaveLength(4);
    for (const x of f) { expect(x.medal).toBe('gold'); expect(x.beatRival).toBe(true); }
    const l = r.s.lanes[0]!;
    expect(l.results.reduce((n, h) => n + h.knocked, 0)).toBe(0);
    expect(l.results.reduce((n, h) => n + h.cleared, 0)).toBe(8);
    expect(l.score).toBeGreaterThan(4 * 120);
  });

  it('easy, hard and expert are all finished on a medal; the expert 400 m is one long race', () => {
    for (const d of ['easy', 'hard', 'expert'] as const) {
      const r = play(['perfect'], d, { maxSec: 900 });
      expect(r.s.phase, d).toBe('complete');
      expect(finishes(r), d).toHaveLength(LEVELS[d].heats);
      for (const x of finishes(r)) expect(['gold', 'silver'], d).toContain(x.medal);
    }
    const e = play(['perfect'], 'expert', { maxSec: 900 });
    expect(finishes(e)[0]!.time).toBeGreaterThan(60);
    expect(finishes(e)[0]!.time).toBeLessThan(90);
  });
});

describe('a good runner and a sloppy one', () => {
  it('the good one wins silver and beats the computer on normal; the sloppy one loses to it and trips on hurdles', () => {
    const good = play(['good'], 'normal');
    const sloppy = play(['sloppy'], 'normal');
    expect(good.s.phase).toBe('complete');
    const gm = finishes(good).map((x) => x.medal);
    expect(gm.filter((m) => m === 'silver' || m === 'gold').length).toBeGreaterThanOrEqual(3);
    expect(finishes(good).filter((x) => x.beatRival).length).toBeGreaterThanOrEqual(3);
    expect(finishes(sloppy).filter((x) => x.beatRival).length).toBeLessThanOrEqual(1);
    expect(sloppy.s.lanes[0]!.results.reduce((n, h) => n + h.knocked, 0)).toBeGreaterThan(0);
    const perfect = play(['perfect'], 'normal');
    expect(perfect.s.lanes[0]!.score).toBeGreaterThan(good.s.lanes[0]!.score);
    expect(good.s.lanes[0]!.score).toBeGreaterThan(sloppy.s.lanes[0]!.score);
    expect(sloppy.s.lanes[0]!.score).toBeGreaterThan(0);
  });
});

describe('the run: warm-up, the three-two-one, heats, rests', () => {
  it('goes through the phases in order and takes about the programme time', () => {
    const r = play(['perfect'], 'normal');
    const phases: string[] = [];
    const s = createSprint({ difficulty: 'normal', players: 1, seated: false, quiet: false, rng: rngStream(5, 'course') });
    const bot = sprintBot('perfect', 1);
    for (let i = 0; i < 60 * 400 && s.phase !== 'complete'; i++) { stepSprint(s, FIXED_DT, [bot.next(s, 0, FIXED_DT)]); if (phases[phases.length - 1] !== s.phase) phases.push(s.phase); }
    expect(phases).toEqual(['warmup', 'ready', 'play', 'finish', 'rest', 'ready', 'play', 'finish', 'rest', 'ready', 'play', 'finish', 'rest', 'ready', 'play', 'finish', 'complete']);
    // Three rests of 25 s, four heats of about 17 s, the finish holds and the warm-up.
    expect(r.s.t).toBeGreaterThan(3 * 25 + 4 * 14);
    expect(r.s.t).toBeLessThan(3 * 25 + 4 * 24 + 4 * 6 + 40);
  });

  it('measures the pace of the warm-up and asks the full speed at a quarter above it (inside the level)', () => {
    const s = createSprint({ difficulty: 'normal', players: 1, seated: false, quiet: false, rng: rngStream(5, 'course') });
    const body = marcher(0.6, 0.8);
    let guard = 0;
    while (s.phase === 'warmup' && guard++ < 60 * 40) stepSprint(s, FIXED_DT, [body(s.t)]);
    expect(s.phase).toBe('ready');
    // A step every 0.6 s is 100 a minute; the level's own is 125, and 100 x 1.3 = 130 is inside 0.8 to 1.15 of it.
    expect(s.cadFull).toBeGreaterThan(125);
    expect(s.cadFull).toBeLessThan(135);
    expect(s.kFull).toBeCloseTo(0.68, 2);
    expect(s.lanes[0]!.dist).toBe(0);
    expect(WARMUP.steps).toBe(8);
  });

  it('a slow warm-up never lowers the full cadence under 80 percent of the level, and a body that does not step is asked the level', () => {
    const slow = createSprint({ difficulty: 'normal', players: 1, seated: false, quiet: false, rng: rngStream(5, 'course') });
    const b = marcher(1.4, 0.6);
    for (let i = 0; i < 60 * 40 && slow.phase === 'warmup'; i++) stepSprint(slow, FIXED_DT, [b(slow.t)]);
    expect(slow.cadFull).toBeGreaterThanOrEqual(LEVELS.normal.cadence * 0.8 - 1e-9);
    const still = createSprint({ difficulty: 'normal', players: 1, seated: false, quiet: false, rng: rngStream(5, 'course') });
    for (let i = 0; i < 60 * 26 && still.phase === 'warmup'; i++) stepSprint(still, FIXED_DT, [IDLE]);
    expect(still.phase).toBe('ready');
    expect(still.cadFull).toBe(LEVELS.normal.cadence);
    expect(still.kFull).toBe(LEVELS.normal.kFull);
  });

  it('counts three, two, one and then the gun; steps before the gun carry no distance', () => {
    const s = createSprint({ difficulty: 'normal', players: 2, seated: false, quiet: false, rng: rngStream(5, 'course') });
    const out: SprintEvent[] = [];
    const eager: LaneIn = { ...IDLE, steps: [{ k: 0.9, side: 'L' }] };
    let seen = 0;
    while (s.phase === 'ready' && seen++ < 60 * 5) out.push(...stepSprint(s, FIXED_DT, [eager, eager]));
    expect(out.filter((e) => e.type === 'tick').map((e) => (e as { n: number }).n)).toEqual([3, 2, 1]);
    expect(out.filter((e) => e.type === 'go')).toHaveLength(1);
    expect(s.phase).toBe('play');
    expect(s.lanes[0]!.dist).toBe(0);
    expect(clockOf(s)).toBe(0);
  });

  it('rests the programme seconds between heats and runs the next heat from the line', () => {
    const r = play(['perfect'], 'hard', { until: (s) => s.phase === 'rest', maxSec: 200 });
    expect(r.s.phase).toBe('rest');
    expect(r.s.restLeft).toBeCloseTo(40, 1);
    expect(clockOf(r.s)).toBeCloseTo(40, 1);
    const s = r.s;
    const bot = sprintBot('perfect', 1);
    while (s.phase === 'rest') stepSprint(s, FIXED_DT, [bot.next(s, 0, FIXED_DT)]);
    expect(s.phase).toBe('ready');
    expect(s.heat).toBe(2);
    expect(s.lanes[0]!.dist).toBe(0);
  });

  it('the gold, silver and bronze times follow the level and the distance', () => {
    const s = createSprint({ difficulty: 'normal', players: 1, seated: false, quiet: false, rng: rngStream(5, 'course') });
    const [g, sv, b] = medalTimes(s);
    expect(g).toBeLessThan(sv);
    expect(sv).toBeLessThan(b);
    expect(g).toBeCloseTo(LEVELS.normal.gold100, 5);
    const long = createSprint({ difficulty: 'normal', players: 1, seated: false, quiet: false, rng: rngStream(5, 'course'), dist: 200 });
    expect(medalTimes(long)[0]).toBeGreaterThan(2 * g);
  });
});

describe('hurdles', () => {
  /** Runs at pace until the next hurdle is `secs` away, then does `act` and goes on until it has been judged. */
  function atHurdle(secs: number, act: (s: SprintState) => LaneIn, o: { quiet?: boolean; k?: number } = {}): { s: SprintState; events: SprintEvent[] } {
    const s = atTheGun('normal', { ...(o.quiet ? { quiet: true } : {}) });
    const body = marcher(0.46, o.k ?? 0.8);
    const events: SprintEvent[] = [];
    let acted = false;
    for (let i = 0; i < 60 * 40; i++) {
      const wait = hurdleIn(s, 0);
      let inp = body(s.t);
      if (!acted && wait <= secs) { acted = true; const a = act(s); inp = { ...inp, jumps: a.jumps, steps: [...inp.steps, ...a.steps] }; }
      events.push(...stepSprint(s, FIXED_DT, [inp]));
      if (events.some((e) => e.type === 'hurdle')) break;
    }
    return { s, events };
  }

  const jump = (): LaneIn => ({ ...IDLE, jumps: 1 });

  it('a jump a fraction of a second ahead clears the hurdle, scores it and runs on at full speed', () => {
    const r = atHurdle(0.3, jump);
    const h = r.events.find((e) => e.type === 'hurdle') as Extract<SprintEvent, { type: 'hurdle' }>;
    expect(h.cleared).toBe(true);
    expect(h.pts).toBe(5);
    expect(r.s.lanes[0]!.stumble).toBe(0);
    expect(r.s.lanes[0]!.score).toBe(5);
  });

  it('a jump that is too early is named: hurdle_early; no jump at all: hurdle_none; both stumble', () => {
    const early = atHurdle(0.95, jump);
    const he = early.events.find((e) => e.type === 'hurdle') as Extract<SprintEvent, { type: 'hurdle' }>;
    expect(he.cleared).toBe(false);
    expect(he.reason).toBe('hurdle_early');
    expect(early.s.lanes[0]!.stumble).toBeGreaterThan(0.5);
    const none = atHurdle(-1, () => IDLE);
    const hn = none.events.find((e) => e.type === 'hurdle') as Extract<SprintEvent, { type: 'hurdle' }>;
    expect(hn.reason).toBe('hurdle_none');
    expect(none.s.lanes[0]!.knocked).toBe(1);
  });

  it('a jump right after the knock is named late', () => {
    const r = atHurdle(-1, () => IDLE);
    const s = r.s;
    for (let i = 0; i < 12; i++) stepSprint(s, FIXED_DT, [IDLE]);
    const out = stepSprint(s, FIXED_DT, [jump()]);
    expect(out.some((e) => e.type === 'hint' && e.code === 'hurdle_late')).toBe(true);
  });

  it('three clean hurdles in a row raise the multiplier', () => {
    const r = play(['perfect'], 'hard', { heats: 1 });
    const pts = r.events.filter((e): e is Extract<SprintEvent, { type: 'hurdle' }> => e.type === 'hurdle').map((e) => e.pts);
    expect(pts).toEqual([5, 5, 10]);
    const l = r.s.lanes[0]!;
    expect(l.bestStreak).toBe(3);
    const e = play(['perfect'], 'expert');
    const ex = e.events.filter((x): x is Extract<SprintEvent, { type: 'hurdle' }> => x.type === 'hurdle').map((x) => x.pts);
    expect(ex).toEqual([5, 5, 10, 10, 10, 15, 15, 15]);
  });

  it('the quiet way: jumps do nothing, a knee lifted to the hip clears the hurdle', () => {
    const jumped = atHurdle(0.3, jump, { quiet: true });
    expect((jumped.events.find((e) => e.type === 'hurdle') as Extract<SprintEvent, { type: 'hurdle' }>).cleared).toBe(false);
    expect(jumped.events.some((e) => e.type === 'jump')).toBe(false);
    const stepped = atHurdle(0.3, () => ({ ...IDLE, steps: [{ k: 1.02, side: 'L' }] }), { quiet: true });
    expect((stepped.events.find((e) => e.type === 'hurdle') as Extract<SprintEvent, { type: 'hurdle' }>).cleared).toBe(true);
    const bot = play(['perfect'], 'normal', { quiet: true });
    expect(bot.s.lanes[0]!.results.reduce((n, h) => n + h.knocked, 0)).toBe(0);
    expect(count(bot, 'jump')).toBe(0);
  });

  it('a runner who sprints with the knees at the hip all the way clears them without a jump, in any mode', () => {
    const r = play(['perfect'], 'hard', { quiet: true, heats: 1 });
    expect(r.s.lanes[0]!.cleared).toBe(3);
  });
});

describe('standing still and one fault at a time, named in the body\'s words', () => {
  it('a runner who does not move: the heat is called off after ten seconds, two heats in a row end the run', () => {
    const r = play(['idle'], 'normal', { maxSec: 400 });
    expect(r.s.phase).toBe('over');
    expect(count(r, 'dnf')).toBe(2);
    expect(count(r, 'over')).toBe(1);
    expect(r.s.lanes[0]!.score).toBe(0);
    expect(r.s.t).toBeLessThan(25 + 2 * 14 + 2 * 3 + 25 + 10);
  });

  it('knees that never reach the line: knee_not_high; steps too far apart: move_more', () => {
    const low = play(['low'], 'normal', { until: (s) => s.phase === 'play' && s.hc > 4 });
    expect(low.events.some((e) => e.type === 'hint' && e.code === 'knee_not_high')).toBe(true);
    expect(low.s.lanes[0]!.steps).toBeLessThan(3);
    const s = atTheGun('normal');
    const out: SprintEvent[] = [];
    for (let i = 0; i < 60 * 4; i++) out.push(...stepSprint(s, FIXED_DT, [IDLE]));
    expect(out.some((e) => e.type === 'hint' && e.code === 'move_more')).toBe(true);
  });

  it('a lift that is counted but low is named too, and a torso that is leaning back', () => {
    const s = atTheGun('normal');
    const out: SprintEvent[] = [];
    const body = marcher(0.46, 0.55);
    for (let i = 0; i < 60 * 3; i++) out.push(...stepSprint(s, FIXED_DT, [body(s.t)]));
    expect(out.some((e) => e.type === 'hint' && e.code === 'knee_not_high')).toBe(true);
    const t = atTheGun('normal');
    const out2: SprintEvent[] = [];
    const b2 = marcher(0.46, 0.9);
    for (let i = 0; i < 60 * 4; i++) out2.push(...stepSprint(t, FIXED_DT, [{ ...b2(t.t), torso: 0.7 }]));
    expect(out2.some((e) => e.type === 'hint' && e.code === 'body_not_straight')).toBe(true);
  });

  it('the same knee lifted twice is named', () => {
    const s = atTheGun('normal');
    const out: SprintEvent[] = [];
    const lift = (leg: 0 | 1, k: number): LaneIn => ({ ...IDLE, knees: leg === 0 ? [k, 0] : [0, k] });
    for (const leg of [0, 0] as const) {
      for (let i = 0; i < 20; i++) out.push(...stepSprint(s, FIXED_DT, [lift(leg, 0.8)]));
      for (let i = 0; i < 20; i++) out.push(...stepSprint(s, FIXED_DT, [IDLE]));
    }
    expect(out.some((e) => e.type === 'hint' && e.code === 'same_leg_twice')).toBe(true);
  });
});

describe('the seated variant', () => {
  it('runs on the movement energy of the arms and the knees, has no hurdles, and finds its own full effort in the warm-up', () => {
    const r = play(['perfect'], 'normal', { seated: true });
    expect(r.s.phase).toBe('complete');
    expect(r.s.hurdles).toEqual([]);
    expect(count(r, 'hurdle')).toBe(0);
    const f = finishes(r);
    expect(f).toHaveLength(4);
    // Seated runs at 92 percent of the standing top speed: gold is still within reach at this level for a full effort.
    expect(f.every((x) => x.medal === 'gold' || x.medal === 'silver')).toBe(true);
    const good = play(['good'], 'normal', { seated: true });
    const sloppy = play(['sloppy'], 'normal', { seated: true });
    expect(r.s.lanes[0]!.score).toBeGreaterThan(good.s.lanes[0]!.score);
    expect(good.s.lanes[0]!.score).toBeGreaterThan(sloppy.s.lanes[0]!.score);
  });

  it('measures the effort of the warm-up (the median of the moving samples, a third above) and never under the floor', () => {
    const s = createSprint({ difficulty: 'normal', players: 1, seated: true, quiet: false, rng: rngStream(5, 'course') });
    for (let i = 0; i < 60 * 12 && s.phase === 'warmup'; i++) stepSprint(s, FIXED_DT, [{ ...IDLE, effort: 0.5 }]);
    expect(s.phase).toBe('ready');
    expect(s.effFull).toBeCloseTo(0.65, 2);
  });

  it('keys and taps still run a seated player (a step is a step)', () => {
    const s = atTheGun('easy', { seated: true });
    const body = marcher(0.5, 0.8);
    for (let i = 0; i < 60 * 6; i++) stepSprint(s, FIXED_DT, [body(s.t)]);
    expect(s.lanes[0]!.v).toBeGreaterThan(3);
  });
});

describe('determinism', () => {
  it('the same seed and the same body give the same run, byte for byte', () => {
    const a = play(['good'], 'normal', { seed: 11, botSeed: 4 });
    const b = play(['good'], 'normal', { seed: 11, botSeed: 4 });
    expect(JSON.stringify(b.s)).toBe(JSON.stringify(a.s));
    expect(b.events).toEqual(a.events);
    const c = play(['good'], 'normal', { seed: 12, botSeed: 4 });
    expect(JSON.stringify(c.s)).not.toBe(JSON.stringify(a.s));
  });

  it('a state copied through JSON in the middle of a run goes on exactly like the original', () => {
    const s = createSprint({ difficulty: 'normal', players: 1, seated: false, quiet: false, rng: rngStream(6, 'course') });
    const bot = sprintBot('sloppy', 3);
    const ins: LaneIn[] = [];
    for (let i = 0; i < 60 * 70; i++) { const x = bot.next(s, 0, FIXED_DT); ins.push(x); stepSprint(s, FIXED_DT, [x]); }
    const copy = JSON.parse(JSON.stringify(s)) as SprintState;
    const bot2 = sprintBot('sloppy', 3);
    void bot2;
    const tail: LaneIn[] = [];
    for (let i = 0; i < 60 * 30; i++) tail.push(bot.next(s, 0, FIXED_DT));
    const evA: SprintEvent[] = [], evB: SprintEvent[] = [];
    for (const x of tail) { evA.push(...stepSprint(s, FIXED_DT, [x])); }
    for (const x of tail) { evB.push(...stepSprint(copy, FIXED_DT, [x])); }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s));
    expect(evB).toEqual(evA);
  });
});

describe('two players on one course (local2)', () => {
  it('both lanes run the same hurdles with no computer; the faster one wins the heat and the bonus, the other still finishes', () => {
    const r = play(['perfect', 'good'], 'normal', { heats: 2 });
    expect(r.s.rival).toBeNull();
    expect(r.s.phase).toBe('complete');
    const f = finishes(r);
    expect(f).toHaveLength(4);
    expect(f.filter((x) => x.lane === 0).every((x) => x.rank === 1)).toBe(true);
    expect(f.filter((x) => x.lane === 1).every((x) => x.rank === 2)).toBe(true);
    expect(f.every((x) => !x.beatRival)).toBe(true);
    expect(r.s.lanes[0]!.score).toBeGreaterThan(r.s.lanes[1]!.score + 2 * 30 - 1);
  });

  it('starts at once at the three-two-one: no warm-up; one standing still does not stop the other', () => {
    const r = play(['perfect', 'idle'], 'normal', { heats: 2, maxSec: 300 });
    expect(r.s.lanes[0]!.score).toBeGreaterThan(100);
    expect(r.s.lanes[1]!.score).toBe(0);
    expect(r.s.lanes[1]!.dnf || r.s.lanes[1]!.results.every((h) => h.medal === 'dnf')).toBe(true);
    expect(r.s.lanes[0]!.results).toHaveLength(2);
  });

  it('is over when both have been called off twice', () => {
    const r = play(['idle', 'idle'], 'normal', { maxSec: 400 });
    expect(r.s.phase).toBe('over');
  });
});

describe('the clock', () => {
  it('shows the heat time, the seconds of the rest or the three-two-one, whichever is on', () => {
    const s = atTheGun('normal');
    for (let i = 0; i < 90; i++) stepSprint(s, FIXED_DT, [IDLE]);
    expect(clockOf(s)).toBeCloseTo(1.5, 1);
  });
});

void (undefined as unknown as Difficulty);
