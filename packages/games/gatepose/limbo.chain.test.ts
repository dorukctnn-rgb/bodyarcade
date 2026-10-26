// Limbo Bend through the real chain: a synthetic figure of the movement library's test rig leaning from the hips (and lifting its hands,
// and sliding its hips, and folding forward), the real sideBend detector, and the simulation reading the detector's channels at 60
// steps a second. The scripted bot of limbo.test.ts says what the channels look like; this says that the detector really gives them,
// that plus is the player's right, and that each way of getting a gate wrong is named by the detector's own words. Synthetic figures
// prove the code does what the thresholds say, not that the thresholds fit real bodies.
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import { createSideBendDetector } from '../../core/moves/sideBend.ts';
import { drive } from '../../core/moves/testing/harness.ts';
import { keyframes, SHAPE_UPPER, type ArmSpec, type FigureSpec } from '../../core/moves/testing/rig.ts';
import type { SimEvent } from '../_shared/host.ts';
import { chainInput, chainPlayer } from '../_shared/testing/chain.ts';
import { msOf } from '../_shared/util.ts';
import { lbDetectors } from './limbo-game.ts';
import { LimboSim, type LbGate } from './limbo.ts';
import type { GpTiming } from './plan.ts';
import { run } from '../strength/testing/run.ts';

const TIMING: Partial<GpTiming> = { sets: 1, workS: 36, finaleS: 2 };
const UP: ArmSpec = { a: 180, f: 180 };
const DOWN: ArmSpec = { a: 0, f: 0 };

function make(o: { seed?: number; difficulty?: string; seated?: boolean; players?: 1 | 2 } = {}): LimboSim {
  const seed = o.seed ?? 3, players = o.players ?? 1;
  return new LimboSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: players === 2 ? 'local2' : 'solo' },
      flags: { reducedMotion: false, silent: false, seated: o.seated ?? false }, players, audioLatencyMs: 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 2.3,
    timing: TIMING,
  });
}

/** How a figure gets a gate wrong (or right): the lean it makes, its hands, its hips, its trunk. */
interface Way { bend?: (g: LbGate) => number; arms?: (g: LbGate) => boolean; dx?: number; fore?: number }

/**
 * The figure goes to each gate's tilt 0.7 s before the gate arrives and keeps it until the gate has gone by; between gates far apart
 * it stands up straight again. `way` spoils chosen gates (all of them, or those the predicate picks).
 */
function figure(sim: LimboSim, lane: 0 | 1, way: Way = {}, only: (g: LbGate) => boolean = () => true): ReturnType<typeof keyframes> {
  const gates = sim.gatesOf(lane);
  const keys: [number, FigureSpec][] = [[0, {}]];
  let lastEnd = 0;
  for (const g of gates) {
    const spoil = only(g);
    const arrive = msOf(g.arriveK);
    const bend = spoil && way.bend ? way.bend(g) : g.target;
    const arms = spoil && way.arms ? way.arms(g) : g.tall;
    const spec: FigureSpec = {
      bend, armL: arms ? UP : DOWN, armR: arms ? UP : DOWN,
      ...(spoil && way.dx ? { dx: way.dx } : {}), ...(spoil && way.fore ? { fore: way.fore } : {}),
    };
    const reach = arrive - 700;
    if (reach - lastEnd > 2500) keys.push([lastEnd + 400, {}], [reach - 900, {}]);
    keys.push([reach, spec], [arrive + 150, spec]);
    lastEnd = arrive + 150;
  }
  keys.push([lastEnd + 500, {}]);
  return keyframes(keys);
}

function play(sim: LimboSim, motions: ReturnType<typeof keyframes>[], o: { shape?: typeof SHAPE_UPPER } = {}): { events: SimEvent[]; gates: SimEvent[] } {
  const ds = motions.map((m) => drive(createSideBendDetector, m, { durationMs: msOf(sim.plan.endK) + 200, ...(o.shape ? { shape: o.shape } : {}) }));
  const r = run(sim, chainInput(...ds.map((d) => chainPlayer(d, { latencyK: 4 }))));
  return { events: r.events, gates: r.events.filter((e) => e.type === 'gate') };
}

describe('leaning with the real detector', () => {
  it.each(['easy', 'normal', 'hard', 'expert'])('a figure that leans to each gate passes them all on %s, hands up for the tall ones', (level) => {
    const sim = make({ difficulty: level });
    const { gates } = play(sim, [figure(sim, 0)]);
    expect(gates.length).toBe(sim.plan.gates.length);
    expect(gates.filter((e) => e['ok'] !== true).map((e) => String(e['code']))).toEqual([]);
    expect(sim.playerStates[0]?.passed).toBe(sim.plan.gates.length);
    expect(sim.plan.gates.some((g) => g.tall) || level === 'easy').toBe(true);
  });

  it('plus is the player\'s right: a lean to the right passes a gate that asks for the right, and misses one that asks for the left with "wrong side"', () => {
    const sim = make({ difficulty: 'normal' });
    const right = sim.plan.gates.find((g) => g.target > 0 && !g.tall) as LbGate;
    const left = sim.plan.gates.find((g) => g.target < 0 && !g.tall) as LbGate;
    // everybody leans to the right at every gate: the gates for the right pass, the gates for the left are on the wrong side
    const { gates } = play(sim, [figure(sim, 0, { bend: (g) => Math.abs(g.target) })]);
    expect(gates.find((e) => e['id'] === right.id)?.['ok']).toBe(true);
    const missed = gates.find((e) => e['id'] === left.id) as SimEvent;
    expect(missed['ok']).toBe(false);
    expect(missed['code']).toBe('wrong_side');
  });

  it('a lean that is not far enough is "bend further", one that goes too far is "bend less"', () => {
    const short = make();
    const a = play(short, [figure(short, 0, { bend: (g) => g.target * 0.45 }, (g) => !g.tall)]);
    expect(a.gates.filter((e) => e['ok'] === false).length).toBeGreaterThan(3);
    expect(a.gates.filter((e) => e['ok'] === false).every((e) => e['code'] === 'bend_more')).toBe(true);
    const far = make();
    const b = play(far, [figure(far, 0, { bend: (g) => g.target * 1.8 }, (g) => !g.tall)]);
    expect(b.gates.filter((e) => e['ok'] === false).length).toBeGreaterThan(3);
    // the figure passes through the tolerance on its way to the far lean: at the arrival it is too far, and that is what is said
    expect(b.gates.filter((e) => e['ok'] === false).every((e) => e['code'] === 'bend_less')).toBe(true);
  });

  it('a lean that comes from sliding the hips sideways says "Hips moved sideways"', () => {
    const sim = make();
    const { gates } = play(sim, [figure(sim, 0, { dx: 0.6 }, (g) => !g.tall)]);
    const bad = gates.filter((e) => e['ok'] === false);
    expect(bad.length).toBeGreaterThan(3);
    expect(bad.every((e) => e['code'] === 'hips_shifted')).toBe(true);
  });

  it('folding forward instead of leaning sideways says "Leaning forward"; folding forward on top of the right lean is not stopped, the angle is what counts', () => {
    const sim = make();
    const { gates } = play(sim, [figure(sim, 0, { bend: () => 0, fore: 0.35 }, (g) => !g.tall)]);
    const bad = gates.filter((e) => e['ok'] === false);
    expect(bad.length).toBeGreaterThan(3);
    expect(bad.every((e) => e['code'] === 'bending_forward')).toBe(true);
    const both = make();
    const r = play(both, [figure(both, 0, { fore: 0.2 }, (g) => !g.tall)]);
    expect(r.gates.filter((e) => e['ok'] === true).length).toBeGreaterThan(r.gates.length / 2);
  });

  it('a tall gate with the hands down says "Arms not high enough"', () => {
    const sim = make({ difficulty: 'expert' });
    const tall = sim.plan.gates.filter((g) => g.tall);
    expect(tall.length).toBeGreaterThan(3);
    const { gates } = play(sim, [figure(sim, 0, { arms: () => false })]);
    const bad = gates.filter((e) => e['ok'] === false);
    expect(bad.map((e) => e['id'])).toEqual(tall.map((g) => g.id));
    expect(bad.every((e) => e['code'] === 'arms_not_up')).toBe(true);
  });

  it('standing straight misses every gate, and a figure nobody sees is not blamed for any', () => {
    const sim = make();
    const { gates } = play(sim, [keyframes([[0, {}], [60000, {}]])]);
    expect(gates.every((e) => e['ok'] === false && e['code'] === 'bend_more')).toBe(true);
    const gone = make();
    const d = drive(createSideBendDetector, keyframes([[0, { absent: true }], [60000, { absent: true }]]), { durationMs: msOf(gone.plan.endK) + 200 });
    const r = run(gone, chainInput(chainPlayer(d, { latencyK: 4, ok: () => false })));
    expect(r.events.filter((e) => e.type === 'gate').every((e) => e['skipped'] === true)).toBe(true);
    expect(gone.playerStates[0]?.missed).toBe(0);
  });

  it('seated, with the legs out of the picture, is the same game, and every way of playing asks for the same detector', () => {
    for (const v of [{ seated: false, silent: false }, { seated: true, silent: false }, { seated: false, silent: true }]) expect(lbDetectors(v)).toEqual([{ id: 'sideBend' }]);
    const sim = make({ seated: true });
    const { gates } = play(sim, [figure(sim, 0)], { shape: SHAPE_UPPER });
    expect(gates.filter((e) => e['ok'] !== true).map((e) => String(e['code']))).toEqual([]);
    expect(gates.length).toBeGreaterThan(8);
  });
});

describe('two players on one camera', () => {
  it('two figures leaning to their own gates pass them together: team passes', () => {
    const sim = make({ players: 2 });
    const { events, gates } = play(sim, [figure(sim, 0), figure(sim, 1)]);
    expect(gates.every((e) => e['ok'] === true)).toBe(true);
    expect(events.filter((e) => e.type === 'team')).toHaveLength(sim.plan.gates.length / 2);
    expect(sim.summary().players?.[1]?.score).toBeGreaterThan(300);
    expect(sim.summary().players?.[2]?.score).toBeGreaterThan(300);
  });

  it('one figure standing still costs its own gates only', () => {
    const sim = make({ players: 2 });
    const { events } = play(sim, [figure(sim, 0), keyframes([[0, {}], [60000, {}]])]);
    expect(events.filter((e) => e.type === 'team')).toHaveLength(0);
    expect(sim.playerStates[0]?.missed).toBe(0);
    expect(sim.playerStates[1]?.passed).toBe(0);
  });
});
