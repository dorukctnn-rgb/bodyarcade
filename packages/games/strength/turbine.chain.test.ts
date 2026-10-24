// Twist Turbine through the real chain: a synthetic figure of the movement library's test rig twisting from side to side with its
// hands together, the real twist detector, and the simulation reading the detector's events and channels at 60 steps a second.
// The scripted bot of turbine.test.ts says what the events and channels look like; this says that the detector really gives them,
// that left and right are the player's, that an overload is held on the channel `side`, and that the reasons come from `tau`,
// `span` and `gap`. Synthetic figures prove the code does what the thresholds say, not that the thresholds fit real bodies.
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import { createTwistDetector } from '../../core/moves/twist.ts';
import { drive, pick } from '../../core/moves/testing/harness.ts';
import { curve } from '../../core/moves/testing/motions.ts';
import { armTo, SHAPE_UPPER, type Motion } from '../../core/moves/testing/rig.ts';
import type { SimEvent } from '../_shared/host.ts';
import { chainInput, chainPlayer } from '../_shared/testing/chain.ts';
import { msOf } from '../_shared/util.ts';
import { ttDetectors } from './turbine-game.ts';
import { TurbineSim, type TtTiming } from './turbine.ts';
import { run } from './testing/run.ts';

const W = 0.8;
const TIMING: Partial<TtTiming> = { sets: 1, workS: 44, restS: 5, finaleS: 3 };

function make(o: { seed?: number; difficulty?: string; seated?: boolean } = {}): TurbineSim {
  const seed = o.seed ?? 3;
  return new TurbineSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: 'solo' },
      flags: { reducedMotion: false, silent: false, seated: o.seated ?? false },
      players: 1, audioLatencyMs: 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 3,
    timing: TIMING,
  });
}

interface Turn { turn?: number; tau?: number; handsGap?: number; y?: number }

/** The body turned by v in -1..1: shoulders `turn` degrees (default 40), the joined hands at tau W (default 0.8). */
const turning = (v: (t: number) => number, o: Turn = {}): Motion => (t) => {
  const s = v(t);
  const phi = (o.turn ?? 40) * s;
  const xh = (o.tau ?? 0.8) * W * s;
  const half = (W / 2) * Math.cos((phi * Math.PI) / 180);
  const g = (o.handsGap ?? 0.04) / 2;
  const y = (o.y ?? 0.4) - 1;
  return { twist: phi, armL: armTo('L', { x: xh - g + half, y }), armR: armTo('R', { x: xh + g - half, y }) };
};

/**
 * A swing: stands, goes to the first side, then crosses to the other every `periodMs`, `count` times from `t0`. A crossing takes `crossMs`
 * (the detector wants 0.4 s at least between the last frame on one side and the first on the other, and calls a quicker one a jerk).
 */
function swing(t0: number, count: number, periodMs: number, first: -1 | 1 = -1, crossMs = 900): ((t: number) => number) {
  const keys: [number, number][] = [[0, 0], [t0 - 500, 0], [t0, first]];
  let side: number = first;
  for (let i = 0; i < count; i++) {
    const at = t0 + (i + 1) * periodMs;
    keys.push([at - crossMs / 2, side], [at + crossMs / 2, -side]);
    side = -side;
  }
  return curve(keys);
}

const types = (events: readonly SimEvent[], type: string): SimEvent[] => events.filter((e) => e.type === type);

function play(sim: TurbineSim, m: Motion, o: { shape?: typeof SHAPE_UPPER } = {}): { events: SimEvent[]; d: ReturnType<typeof drive> } {
  const d = drive(createTwistDetector, m, { durationMs: msOf(sim.plan.endK) + 200, ...(o.shape ? { shape: o.shape } : {}) });
  const r = run(sim, chainInput(chainPlayer(d, { latencyK: 4 })));
  return { events: r.events, d };
}

describe('twisting with the real detector', () => {
  it('every crossing is a repetition on the side reached, the turbine turns and the city lights, all four ways of playing ask for the same detector', () => {
    for (const v of [{ seated: false, silent: false }, { seated: true, silent: false }, { seated: false, silent: true }]) expect(ttDetectors(v)).toEqual([{ id: 'twist' }]);
    const sim = make();
    const crossings = 20;
    const { events, d } = play(sim, turning(swing(2000, crossings, 1700)));
    const reps = types(events, 'rep');
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(crossings);
    expect(reps).toHaveLength(crossings);
    // the first crossing reaches the right, then the left, and so on: the sides are the player's
    expect(reps.slice(0, 4).map((e) => e['side'])).toEqual([1, -1, 1, -1]);
    const p = sim.playerState;
    expect(p.reps).toBe(crossings);
    expect(p.score).toBeGreaterThan(crossings * 5);
    expect(p.omega).toBeGreaterThan(0);
    expect(p.lit).toBeGreaterThan(0.1);
    expect(p.inBand).toBeGreaterThan(p.banded / 2);
  });

  it('seated, with the legs out of the picture, is the same game', () => {
    const sim = make({ seated: true });
    const { events } = play(sim, turning(swing(2000, 14, 1700)), { shape: SHAPE_UPPER });
    expect(types(events, 'rep')).toHaveLength(14);
    expect(sim.playerState.reps).toBe(14);
  });

  it('too slow a pace is graded as such: a crossing every 3 s is below the band of the level', () => {
    const slow = make();
    const { events } = play(slow, turning(swing(2000, 12, 3000)));
    const reps = types(events, 'rep');
    expect(reps.length).toBeGreaterThanOrEqual(11);
    expect(reps.filter((e) => e['inBand'] === true).length).toBeLessThan(reps.length / 2);
    const good = make();
    const g = play(good, turning(swing(2000, 24, 1700)));
    expect(types(g.events, 'rep').filter((e) => e['inBand'] === true).length).toBeGreaterThan(types(g.events, 'rep').length / 2);
    expect(good.playerState.score).toBeGreaterThan(slow.playerState.score);
  });
});

describe('the storms', () => {
  /** A run on which the first storm is of this kind (the seed is searched for). */
  function withStorm(kind: 'overload' | 'blackout'): TurbineSim {
    for (let seed = 1; seed < 80; seed++) {
      const sim = make({ seed });
      if (sim.plan.storms[0]?.kind === kind) return sim;
    }
    throw new Error(`No seed gives a ${kind} first.`);
  }

  it('an overload is answered by holding the twist to the side asked: the channel `side` of the detector is the held side', () => {
    const sim = withStorm('overload');
    const st = sim.plan.storms[0]!;
    const startMs = msOf(st.startK);
    const holdMs = (st.holdSteps / 60) * 1000;
    // swinging until the storm, then the side that was asked, held a second longer than needed, then swinging again
    const swinging = swing(2000, 24, 1700);
    const m = turning((t) => (t < startMs - 100 ? swinging(t) : t < startMs + holdMs + 1400 ? st.side : swinging(t)));
    const { events } = play(sim, m);
    const end = types(events, 'stormEnd').find((e) => e['kind'] === 'overload');
    expect(end?.['ok']).toBe(true);
    expect(end?.['bonus']).toBe(200);
  });

  it('holding the wrong side does not answer it', () => {
    const sim = withStorm('overload');
    const st = sim.plan.storms[0]!;
    const startMs = msOf(st.startK);
    const holdMs = (st.holdSteps / 60) * 1000;
    const swinging = swing(2000, 24, 1700);
    const m = turning((t) => (t < startMs - 100 ? swinging(t) : t < startMs + holdMs + 2400 ? -st.side : swinging(t)));
    const { events } = play(sim, m);
    expect(types(events, 'stormEnd').find((e) => e['kind'] === 'overload')?.['ok']).toBe(false);
  });

  it('a blackout is answered by twisting fast: the repetitions of the detector count', () => {
    const sim = withStorm('blackout');
    const st = sim.plan.storms[0]!;
    const startMs = msOf(st.startK);
    // a crossing every 1.0 s from the start of the storm: more than the storm asks for in eight seconds
    const fast = swing(startMs - 1500, 12, 1000, -1, 700);
    const { events } = play(sim, turning(fast));
    const end = types(events, 'stormEnd').find((e) => e['kind'] === 'blackout');
    expect(end?.['ok']).toBe(true);
    expect(end?.['bonus']).toBe(150);
  });
});

describe('why a twist did not count, from the channels', () => {
  const said = (events: readonly SimEvent[]): string[] => types(events, 'miss').map((e) => String(e['code']));

  it('hands too far apart: "Hands too far apart"', () => {
    const { events } = play(make(), turning(swing(2000, 24, 1700), { handsGap: 0.9 }));
    expect(said(events)).toContain('hands_apart');
  });

  it('the arms swung and the shoulders did not turn: "Turn from the shoulders"', () => {
    const { events } = play(make(), turning(swing(2000, 24, 1700), { turn: 0 }));
    expect(said(events)).toContain('turn_shoulders');
  });

  it('a turn that does not go far enough: "Turn further"', () => {
    const { events } = play(make(), turning(swing(2000, 24, 1700), { turn: 18, tau: 0.4 }));
    expect(said(events)).toContain('turn_more');
  });

  it('a good twister is told nothing', () => {
    const { events } = play(make(), turning(swing(2000, 24, 1700)));
    expect(said(events)).toEqual([]);
  });
});
