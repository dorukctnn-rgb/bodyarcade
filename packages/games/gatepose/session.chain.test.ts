// Limbo Bend and Pose Wall with nothing between the body and the game except the camera and the pose model: a synthetic body goes
// through the real Session: calibration, the pose feed, feature extraction, the movement detectors, the input hub, the game
// (kit-g1/testing/chain.ts, the fake clock). The runs are the real thing, shortened to one or two sets (the game's own `timing`
// option). The bodies look at the game to see the next gate or wall, the way a person looks at the screen.
import { describe, expect, it } from 'vitest';
import { SHAPE_FULL, type RigShape } from '../../core/moves/testing/rig.ts';
import type { GameModule } from '../../core/types/index.ts';
import { createChain, type ChainPerson } from '../kit-g1/testing/chain.ts';
import { limboBendModule, manifest as lbManifest } from '../limbo-bend/index.ts';
import { poseWallModule, manifest as pwManifest } from '../pose-wall/index.ts';
import type { LimboSim } from './limbo.ts';
import type { PoseWallSim } from './posewall.ts';
import { bendPerson, posePerson } from './testing/people.ts';

const WIDE: RigShape = { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 };
const LEFT: RigShape = { ...WIDE, cx: 0.68, T: 0.17 };
const RIGHT: RigShape = { ...WIDE, cx: 0.32, T: 0.17 };

const lb = (): GameModule => limboBendModule(structuredClone(lbManifest), { timing: { sets: 1, workS: 36, finaleS: 2 } });
const pw = (): GameModule => poseWallModule(structuredClone(pwManifest), { timing: { sets: 1, workS: 40, finaleS: 2 } });

async function play(o: { module: GameModule; people: ChainPerson[]; mode?: 'solo' | 'local2'; difficulty?: string; seated?: boolean; quiet?: boolean; maxSec?: number }) {
  const chain = createChain({
    module: o.module, mode: o.mode ?? 'solo', difficulty: o.difficulty ?? 'easy', seated: o.seated ?? false, quiet: o.quiet ?? false, people: o.people, seed: 3,
  });
  await chain.start();
  const finished = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', (o.maxSec ?? 120) * 1000);
  return { chain, finished, sim: <S>(): S => (chain.game() as unknown as { sim: S }).sim };
}

const STATES = ['setup', 'calibrating', 'countdown', 'running', 'results'];

describe('Limbo Bend, body to game', () => {
  it('a body that leans to each gate: calibrates, counts down, plays the set, and passes every gate it leaned to', async () => {
    const r = await play({ module: lb(), difficulty: 'normal', people: [bendPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(STATES);
    const sum = r.chain.seen.over[0]!;
    const gates = r.sim<LimboSim>().plan.gates.length;
    expect(gates).toBeGreaterThan(8);
    expect(sum.reps).toBeGreaterThanOrEqual(gates - 1);
    expect(sum.score).toBeGreaterThan(gates * 60);
    expect(sum.quality).toBeGreaterThan(0.4);
    expect(r.chain.sounds).toContain('perfect');
  }, 120_000);

  it('a body that leans to the wrong side: the gates are missed and the reason is "wrong side"', async () => {
    const r = await play({ module: lb(), difficulty: 'normal', people: [bendPerson({ kind: 'sloppy', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps ?? 0).toBeLessThan(3);
    expect(sum.log.filter((e) => e.kind === 'wrong_side').length).toBeGreaterThan(4);
  }, 120_000);

  it('standing straight: nothing scored, every gate says to bend further', async () => {
    const r = await play({ module: lb(), people: [bendPerson({ kind: 'idle', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.score).toBe(0);
    expect(sum.log.filter((e) => e.kind === 'bend_more').length).toBeGreaterThan(5);
  }, 120_000);

  it('seated, with the legs out of the picture: the same game', async () => {
    const r = await play({ module: lb(), difficulty: 'normal', seated: true, people: [bendPerson({ kind: 'perfect', seated: true })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(8);
  }, 120_000);

  it('two players on one camera: both lean to their own gates, team passes, a score each', async () => {
    const r = await play({ module: lb(), mode: 'local2', difficulty: 'normal', people: [bendPerson({ kind: 'perfect', lane: 0, shape: LEFT }), bendPerson({ kind: 'perfect', lane: 1, shape: RIGHT })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(300);
    expect(sum.players?.[2]?.score).toBeGreaterThan(300);
    expect(sum.log.filter((e) => e.kind === 'team').length).toBeGreaterThan(4);
  }, 120_000);

  it('two players: the one who leans scores, the one who stands does not', async () => {
    const r = await play({ module: lb(), mode: 'local2', people: [bendPerson({ kind: 'perfect', lane: 0, shape: LEFT }), bendPerson({ kind: 'idle', lane: 1, shape: RIGHT })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(200);
    expect(sum.players?.[2]?.score).toBe(0);
  }, 120_000);
});

describe('Pose Wall, body to game', () => {
  it('a body that makes the shape of each wall: calibrates, counts down, plays the set, and passes every wall', async () => {
    const r = await play({ module: pw(), people: [posePerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(STATES);
    const sum = r.chain.seen.over[0]!;
    const walls = r.sim<PoseWallSim>().plan.walls.length;
    expect(walls).toBeGreaterThan(5);
    expect(sum.reps).toBe(walls);
    expect(sum.score).toBeGreaterThan(walls * 80);
    expect(sum.quality).toBeGreaterThan(0.6);
    expect(sum.bestStreak).toBe(walls);
    expect(r.chain.sounds.some((n) => n === 'pass' || n === 'perfect')).toBe(true);
  }, 120_000);

  it('the left arm low in every shape: the walls are missed and the reason is a named arm (limb off)', async () => {
    const r = await play({ module: pw(), people: [posePerson({ kind: 'sloppy', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.log.filter((e) => e.kind === 'limb_off').length).toBeGreaterThan(2);
    expect(sum.reps ?? 0).toBeLessThan(r.sim<PoseWallSim>().plan.walls.length);
  }, 120_000);

  it('standing with the arms down: nothing scored', async () => {
    const r = await play({ module: pw(), people: [posePerson({ kind: 'idle', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.score).toBe(0);
    expect(sum.log.filter((e) => e.kind === 'limb_off').length).toBeGreaterThan(4);
  }, 120_000);

  it('seated, with the legs out of the picture: the walls ask for the upper body only, and a seated body passes them all', async () => {
    const r = await play({ module: pw(), seated: true, people: [posePerson({ kind: 'perfect', seated: true })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBe(r.sim<PoseWallSim>().plan.walls.length);
    expect(r.sim<PoseWallSim>().variant).toBe('seated');
  }, 120_000);

  it('the normal level: the shapes the figure can make are passed, the ones that ask for the legs (it has no way to make them) are not, and each miss says so', async () => {
    const r = await play({ module: pw(), difficulty: 'normal', people: [posePerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sim = r.sim<PoseWallSim>();
    const stars = sim.plan.walls.filter((w) => w.pose === 'star').length;
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThanOrEqual(sim.plan.walls.length - stars - 1);
    expect(sum.reps).toBeGreaterThan(sim.plan.walls.length / 2);
  }, 120_000);

  it('two players on one camera: both make the shape of the same wall, team passes, a score each', async () => {
    const r = await play({ module: pw(), mode: 'local2', people: [posePerson({ kind: 'perfect', lane: 0, shape: LEFT }), posePerson({ kind: 'perfect', lane: 1, shape: RIGHT })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(300);
    expect(sum.players?.[2]?.score).toBeGreaterThan(300);
    expect(sum.log.filter((e) => e.kind === 'team').length).toBeGreaterThan(3);
  }, 120_000);

  it('two players: the one who makes the shapes scores, the one who stands does not, and there is no team pass', async () => {
    const r = await play({ module: pw(), mode: 'local2', people: [posePerson({ kind: 'perfect', lane: 0, shape: LEFT }), posePerson({ kind: 'idle', lane: 1, shape: RIGHT })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(300);
    expect(sum.players?.[2]?.score).toBe(0);
    expect(sum.log.filter((e) => e.kind === 'team')).toHaveLength(0);
  }, 120_000);
});
