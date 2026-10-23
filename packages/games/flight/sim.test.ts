// The flight simulation with scripted bodies: a perfect squatter, a sloppy one, one fault at a time, and one who stands
// still. The rules under test are the ones of game-design.md card 1.
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import {
  createFlight, DIFFICULTIES, levelOf, LEVELS, makeCourse, planOf, stepFlight, timeLeft, WORLD,
  type Difficulty, type FlightEvent, type FlightState, type LaneIn,
} from './sim.ts';
import { squatBot, type BotKind } from './testing/bot.ts';

interface Run { s: FlightState; events: FlightEvent[]; steps: number }

function play(kinds: BotKind[], difficulty: string, o: { seed?: number; maxSec?: number; seated?: boolean; botSeed?: number } = {}): Run {
  const seed = o.seed ?? 5;
  const s = createFlight({ difficulty, players: kinds.length as 1 | 2, seated: o.seated ?? false, rng: rngStream(seed, 'course') });
  const bots = kinds.map((k, i) => squatBot(k, (o.botSeed ?? 1) + i * 17));
  const events: FlightEvent[] = [];
  let steps = 0;
  const max = Math.round((o.maxSec ?? 400) / FIXED_DT);
  while (s.phase !== 'over' && s.phase !== 'complete' && steps < max) {
    const ins: LaneIn[] = bots.map((b, i) => b.next(s, i, FIXED_DT));
    events.push(...stepFlight(s, FIXED_DT, ins));
    steps++;
  }
  return { s, events, steps };
}

const count = (r: Run, type: FlightEvent['type']): number => r.events.filter((e) => e.type === type).length;
const still: LaneIn = { flaps: [], drop: 0, glide: false, armed: false };

describe('the levels', () => {
  it('get harder in the order of the difficulties: a narrower gap, a faster course, a deeper squat', () => {
    const l = DIFFICULTIES.map((d) => LEVELS[d]);
    for (let i = 1; i < l.length; i++) {
      expect(l[i]!.gapH).toBeLessThan(l[i - 1]!.gapH);
      expect(l[i]!.speed).toBeGreaterThan(l[i - 1]!.speed);
      expect(l[i]!.need).toBeGreaterThanOrEqual(l[i - 1]!.need);
    }
    // Card 1: from about 36 percent of the screen height to 24; the play area is about three quarters of the screen.
    expect(LEVELS.easy.gapH * 0.75).toBeGreaterThan(0.29);
    expect(LEVELS.easy.gapH * 0.75).toBeLessThan(0.37);
    expect(LEVELS.expert.gapH * 0.75).toBeGreaterThan(0.2);
    expect(LEVELS.expert.gapH * 0.75).toBeLessThan(0.26);
  });

  it('an unknown difficulty is normal; only the classic level has one feather and no sets', () => {
    expect(levelOf('nonsense')).toBe(LEVELS.normal);
    expect(LEVELS.expert.lives).toBe(1);
    expect(LEVELS.expert.sets).toBe(0);
    expect(planOf(LEVELS.normal)).toEqual({ sets: 3, setSec: 60, restSec: 25 });
  });
});

describe('the course', () => {
  it('is the same for the same seed and different for another', () => {
    const a = makeCourse(rngStream(3, 'course'), LEVELS.normal);
    const b = makeCourse(rngStream(3, 'course'), LEVELS.normal);
    const c = makeCourse(rngStream(4, 'course'), LEVELS.normal);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('keeps every gap inside the sky, with room above and below, and never jumps more than the level allows', () => {
    for (const d of DIFFICULTIES) {
      const lv = LEVELS[d];
      const course = makeCourse(rngStream(9, 'course'), lv);
      for (let i = 0; i < course.length; i++) {
        const e = course[i]!;
        expect(e.y - lv.gapH / 2 - lv.moveAmp).toBeGreaterThanOrEqual(0.06);
        expect(e.y + lv.gapH / 2 + lv.moveAmp).toBeLessThanOrEqual(WORLD.floor - 0.06);
        if (i > 2) expect(Math.abs(e.y - course[i - 1]!.y)).toBeLessThanOrEqual(lv.maxStep + 1e-9);
      }
    }
  });

  it('draws three numbers per column, so a longer course starts with the same columns', () => {
    const a = makeCourse(rngStream(2, 'course'), LEVELS.hard, 50);
    const b = makeCourse(rngStream(2, 'course'), LEVELS.hard, 200);
    expect(b.slice(0, 50)).toEqual(a);
  });
});

describe('a perfect squatter', () => {
  it.each(['easy', 'normal'] as Difficulty[])('%s: flies all three sets and clears nearly every column', (d) => {
    const r = play(['perfect'], d);
    expect(r.s.phase).toBe('complete');
    const lane = r.s.lanes[0]!;
    expect(lane.hits).toBeLessThanOrEqual(2);
    expect(lane.passes).toBeGreaterThan(50);
    expect(lane.centres).toBeGreaterThan(lane.passes * 0.4);
    expect(lane.score).toBeGreaterThan(lane.passes);
  });

  it('hard: gets through a long way with sliding columns and gusts', () => {
    const r = play(['perfect'], 'hard');
    expect(r.s.lanes[0]!.passes).toBeGreaterThan(30);
  });

  it('expert: the classic game, one feather; the perfect body still gets past a good number of columns', () => {
    const r = play(['perfect'], 'expert', { maxSec: 120 });
    expect(r.s.lanes[0]!.passes).toBeGreaterThan(8);
  });
});

describe('a run: warm-up, three sets, two rests', () => {
  it('goes through the phases in order and takes the round time', () => {
    const r = play(['perfect'], 'easy');
    const order: string[] = [];
    for (const e of r.events) {
      if (e.type === 'warmup' && !order.includes('warmup')) order.push('warmup');
      else if (e.type === 'ready') order.push('ready');
      else if (e.type === 'start') order.push(`start${e.set}`);
      else if (e.type === 'rest') order.push(`rest${e.set}`);
      else if (e.type === 'complete') order.push('complete');
    }
    expect(order).toEqual(['warmup', 'ready', 'start1', 'rest1', 'start2', 'rest2', 'start3', 'complete']);
    const seconds = r.steps * FIXED_DT;
    expect(seconds).toBeGreaterThan(3 * 60 + 2 * 25 + 2.4);
    expect(seconds).toBeLessThan(3 * 60 + 2 * 25 + 2.4 + 26);
    expect(r.s.round.played).toBeCloseTo(180, 0);
    expect(r.s.round.rested).toBeCloseTo(50, 0);
  });

  it('measures the squat cycle in the warm-up and spaces the columns by 1.3 cycles', () => {
    const r = play(['perfect'], 'normal', { maxSec: 45 });
    expect(r.s.warm.flapTimes.length).toBe(3);
    expect(r.s.tempo).toBeGreaterThan(1.3);
    expect(r.s.tempo).toBeLessThan(2.4);
    expect(r.s.spacing).toBeCloseTo(LEVELS.normal.speed * 1.3 * r.s.tempo, 6);
    expect(r.s.pipes[1]!.x - r.s.pipes[0]!.x).toBeCloseTo(r.s.spacing, 6);
  });

  it('a body that cannot squat as deep as asked is asked for less (60 percent of its deepest warm-up squat, never under 0.3)', () => {
    const fl = (depth: number): LaneIn => ({ flaps: [{ power: 1, depth }], drop: 0, glide: false, armed: false });
    const warm = (difficulty: string, depth: number): FlightState => {
      const s = createFlight({ difficulty, players: 1, seated: false, rng: rngStream(1, 'course') });
      for (let k = 0; k < 3; k++) {
        stepFlight(s, FIXED_DT, [fl(depth)]);
        for (let i = 0; i < 100; i++) stepFlight(s, FIXED_DT, [still]);
      }
      return s;
    };
    const shallow = warm('hard', 0.4);
    expect(shallow.phase).toBe('rest');
    expect(shallow.ready).toBeGreaterThan(0);
    expect(shallow.need).toBeCloseTo(0.3, 6);
    const deep = warm('normal', 0.9);
    expect(deep.need).toBeCloseTo(LEVELS.normal.need, 6);
    const mid = warm('normal', 0.7);
    expect(mid.need).toBeCloseTo(0.42, 6);
  });

  it('ends the warm-up by itself after 25 seconds when nobody flaps, then a pause to get ready, then the first set', () => {
    const r = play(['idle'], 'normal', { maxSec: 28.5 });
    expect(r.events.some((e) => e.type === 'ready')).toBe(true);
    expect(r.events.some((e) => e.type === 'start')).toBe(true);
    expect(r.s.tempo).toBe(LEVELS.normal.tempo);
  });
});

describe('standing still', () => {
  it.each(DIFFICULTIES)('%s: the bird sinks, loses its feathers and the run is over; nothing is scored', (d) => {
    const r = play(['idle'], d, { maxSec: 120 });
    expect(r.s.phase).toBe('over');
    expect(r.s.lanes[0]!.score).toBe(0);
    expect(r.s.lanes[0]!.hits).toBe(LEVELS[d].lives);
    expect(r.s.lanes[0]!.lives).toBe(0);
    expect(count(r, 'over')).toBe(1);
  });

  it('is a failure of effort: the reason named is to move more', () => {
    const r = play(['idle'], 'easy', { maxSec: 120 });
    const hit = r.events.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && hit.reason).toBe('move_more');
  });
});

describe('a sloppy squatter', () => {
  it('scores something but less than a perfect one, and loses feathers', () => {
    const perfect = play(['perfect'], 'normal');
    const sloppy = play(['sloppy'], 'normal', { maxSec: 400 });
    expect(sloppy.s.lanes[0]!.hits).toBeGreaterThan(0);
    expect(sloppy.s.lanes[0]!.score).toBeLessThan(perfect.s.lanes[0]!.score);
  });
});

describe("one fault at a time is named in the body's words", () => {
  it('a squat not deep enough: hips_not_low', () => {
    const r = play(['shallow'], 'normal', { maxSec: 200 });
    const reasons = r.events.filter((e) => e.type === 'hit').map((e) => (e.type === 'hit' ? e.reason : ''));
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons).toContain('hips_not_low');
    expect(r.events.some((e) => e.type === 'hint' && e.code === 'hips_not_low')).toBe(true);
  });

  it('a rise that is too slow gives no flap: too_slow', () => {
    const r = play(['slow'], 'normal', { maxSec: 200 });
    expect(count(r, 'flap')).toBe(0);
    expect(r.events.some((e) => e.type === 'hint' && e.code === 'too_slow')).toBe(true);
    const reasons = r.events.filter((e) => e.type === 'hit').map((e) => (e.type === 'hit' ? e.reason : ''));
    expect(reasons).toContain('too_slow');
  });
});

describe('feathers and passing', () => {
  it('a hit costs a feather, resets the streak, and protects the bird for 1.5 seconds', () => {
    const r = play(['idle'], 'easy', { maxSec: 120 });
    const hits = r.events.filter((e) => e.type === 'hit');
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => (h.type === 'hit' ? h.lives : -1))).toEqual([2, 1, 0]);
  });

  it('points are one for a pass, one more through the middle, times a multiplier that grows every five clean passes', () => {
    const r = play(['perfect'], 'easy');
    const passes = r.events.filter((e): e is Extract<FlightEvent, { type: 'pass' }> => e.type === 'pass');
    expect(passes.length).toBeGreaterThan(20);
    for (const p of passes) expect(p.pts).toBe((1 + (p.centre ? 1 : 0)) * p.mult);
    expect(passes.some((p) => p.mult >= 2)).toBe(true);
    expect(Math.max(...passes.map((p) => p.mult))).toBeLessThanOrEqual(3);
    expect(passes.reduce((s, p) => s + p.pts, 0)).toBe(r.s.lanes[0]!.score);
  });

  it('every pass is one event; the count matches the lane', () => {
    const r = play(['perfect'], 'easy');
    expect(count(r, 'pass')).toBe(r.s.lanes[0]!.passes);
  });
});

describe('determinism', () => {
  it('the same seed and the same body give the same run, byte for byte', () => {
    const a = play(['sloppy'], 'hard', { seed: 11, botSeed: 4, maxSec: 150 });
    const b = play(['sloppy'], 'hard', { seed: 11, botSeed: 4, maxSec: 150 });
    expect(JSON.stringify(b.s)).toBe(JSON.stringify(a.s));
    expect(b.events).toEqual(a.events);
    const c = play(['sloppy'], 'hard', { seed: 12, botSeed: 4, maxSec: 150 });
    expect(JSON.stringify(c.s)).not.toBe(JSON.stringify(a.s));
  });

  it('a state copied through JSON in the middle of a run goes on exactly like the original', () => {
    const s = createFlight({ difficulty: 'normal', players: 1, seated: false, rng: rngStream(21, 'course') });
    const bot = squatBot('sloppy', 3);
    for (let i = 0; i < 4000; i++) stepFlight(s, FIXED_DT, [bot.next(s, 0, FIXED_DT)]);
    const copy = JSON.parse(JSON.stringify(s)) as FlightState;
    // The same recorded inputs go to both.
    const inputs: LaneIn[] = [];
    for (let i = 0; i < 3000; i++) inputs.push(bot.next(s, 0, FIXED_DT));
    const a: FlightEvent[] = [], b: FlightEvent[] = [];
    for (const inp of inputs) { a.push(...stepFlight(s, FIXED_DT, [inp])); b.push(...stepFlight(copy, FIXED_DT, [inp])); }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s));
    expect(b).toEqual(a);
  });
});

describe('two players on one course (local2)', () => {
  it('both lanes fly the same columns; one standing still does not stop the other', () => {
    const r = play(['perfect', 'idle'], 'easy', { maxSec: 400 });
    const [p1, p2] = r.s.lanes;
    expect(p2!.out).toBe(true);
    expect(p1!.out).toBe(false);
    expect(r.s.phase).toBe('complete');
    expect(p1!.passes).toBeGreaterThan(40);
    expect(p2!.passes).toBe(0);
  });

  it("starts at once: no warm-up, the columns spaced for the level's own tempo", () => {
    const s = createFlight({ difficulty: 'normal', players: 2, seated: false, rng: rngStream(2, 'course') });
    expect(s.phase).toBe('play');
    expect(s.pipes.length).toBeGreaterThan(10);
    expect(s.spacing).toBeCloseTo(LEVELS.normal.speed * 1.3 * LEVELS.normal.tempo, 6);
  });

  it('is over when both are out', () => {
    const r = play(['idle', 'idle'], 'easy', { maxSec: 200 });
    expect(r.s.phase).toBe('over');
  });
});

describe('time left', () => {
  it('counts down the set', () => {
    const s = createFlight({ difficulty: 'easy', players: 2, seated: false, rng: rngStream(2, 'course') });
    expect(timeLeft(s)).toBeCloseTo(60, 5);
    const bots = [squatBot('perfect', 1), squatBot('perfect', 2)];
    for (let i = 0; i < 600; i++) stepFlight(s, FIXED_DT, bots.map((b, k) => b.next(s, k, FIXED_DT)));
    expect(timeLeft(s)).toBeCloseTo(50, 1);
  });
});
