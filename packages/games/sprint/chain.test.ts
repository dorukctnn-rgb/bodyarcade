// Knee Sprint with nothing between the body and the game except the camera and the pose model: a synthetic body goes through
// the real calibration, the feature extractor, the movement detectors and the input hub (kit-g1/testing/chain.ts).
// The runner bots look at the game to decide when to lift and when to jump, so a late detection shows up as a knocked hurdle.
import { describe, expect, it } from 'vitest';
import { SHAPE_FULL, SHAPE_UPPER, type RigShape } from '../../core/moves/testing/rig.ts';
import { createChain, type ChainPerson } from '../kit-g1/testing/chain.ts';
import kneeSprint from '../knee-sprint/index.ts';
import type { SprintGame } from './game.ts';
import { runnerPerson } from './testing/body.ts';

const WIDE: RigShape = { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 };

async function run(o: { people: ChainPerson[]; mode?: 'solo' | 'local2'; difficulty?: string; seated?: boolean; quiet?: boolean; maxSec?: number }) {
  const chain = createChain({
    module: kneeSprint, mode: o.mode ?? 'solo', difficulty: o.difficulty ?? 'easy', ...(o.seated !== undefined ? { seated: o.seated } : {}),
    ...(o.quiet !== undefined ? { quiet: o.quiet } : {}), people: o.people, seed: 3,
  });
  await chain.start();
  const finished = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', (o.maxSec ?? 330) * 1000);
  return { chain, finished, game: chain.game() as SprintGame };
}

const medals = (g: SprintGame, lane = 0): string[] => g.state!.lanes[lane]!.results.map((r) => r.medal);

describe('Knee Sprint, body to game', () => {
  it('a perfect runner in front of the camera: calibrates, counts down, runs three heats and gets to the results', async () => {
    const r = await run({ people: [runnerPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(['setup', 'calibrating', 'countdown', 'running', 'results']);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(100);
    expect(sum.score).toBeGreaterThan(200);
    expect(medals(r.game)).toHaveLength(3);
    expect(medals(r.game).every((m) => m === 'gold' || m === 'silver')).toBe(true);
  }, 120_000);

  it('on normal the hurdles are jumped: the jump detector sees the body leave the ground in time and every hurdle is cleared', async () => {
    const r = await run({ difficulty: 'normal', people: [runnerPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.cleared).toBe(8);
    expect(sum.hits).toBe(0);
    expect(sum.log.filter((e) => !e.ok)).toEqual([]);
    expect(medals(r.game).every((m) => m === 'gold' || m === 'silver')).toBe(true);
  }, 120_000);

  it('a good runner who jumps a little later still clears them and is a little slower', async () => {
    const perfect = await run({ difficulty: 'normal', people: [runnerPerson({ kind: 'perfect', shape: WIDE })] });
    const good = await run({ difficulty: 'normal', people: [runnerPerson({ kind: 'good', shape: WIDE })] });
    expect(good.chain.seen.errors).toEqual([]);
    expect(good.chain.seen.over[0]!.cleared).toBeGreaterThanOrEqual(6);
    expect(good.chain.seen.over[0]!.score).toBeLessThan(perfect.chain.seen.over[0]!.score);
  }, 120_000);

  it('the quiet variant steps over the hurdles with a knee at the hip: no jump is ever seen', async () => {
    const r = await run({ difficulty: 'normal', quiet: true, people: [runnerPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.game.state!.quiet).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.cleared).toBe(8);
    expect(sum.hits).toBe(0);
  }, 120_000);

  it('seated, with the arms swinging: the energy of the body is the race; no steps are counted', async () => {
    const shape: RigShape = { ...SHAPE_UPPER, aspect: 16 / 9, T: 0.24 };
    const r = await run({ seated: true, people: [runnerPerson({ kind: 'perfect', arms: true, shape })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.game.state!.seated).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBe(0);
    expect(sum.score).toBeGreaterThan(100);
    expect(medals(r.game)).toHaveLength(3);
    expect(medals(r.game).every((m) => m !== 'dnf')).toBe(true);
  }, 120_000);

  it('a runner who stands still is called off twice and the run ends with nothing', async () => {
    const r = await run({ people: [runnerPerson({ kind: 'idle', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.score).toBe(0);
    expect(sum.reps).toBe(0);
    expect(sum.log.filter((e) => e.kind === 'dnf').length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('two people side by side: each runs in their own lane, the one who stands still is called off', async () => {
    const left: RigShape = { ...WIDE, cx: 0.68, T: 0.17 };
    const right: RigShape = { ...WIDE, cx: 0.32, T: 0.17 };
    const r = await run({ mode: 'local2', difficulty: 'easy', people: [runnerPerson({ kind: 'perfect', lane: 0, shape: left }), runnerPerson({ kind: 'idle', lane: 1, shape: right })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(100);
    expect(sum.players?.[2]?.score).toBe(0);
    expect(sum.players?.[1]?.reps).toBeGreaterThan(50);
    expect(medals(r.game, 0).every((m) => m === 'gold' || m === 'silver')).toBe(true);
    expect(medals(r.game, 1).every((m) => m === 'dnf')).toBe(true);
  }, 120_000);

  it('two people who both run: both get steps, scores and medals of their own', async () => {
    const left: RigShape = { ...WIDE, cx: 0.68, T: 0.17 };
    const right: RigShape = { ...WIDE, cx: 0.32, T: 0.17 };
    const r = await run({ mode: 'local2', difficulty: 'easy', people: [runnerPerson({ kind: 'perfect', lane: 0, shape: left }), runnerPerson({ kind: 'good', lane: 1, shape: right, seed: 2 })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.reps).toBeGreaterThan(50);
    expect(sum.players?.[2]?.reps).toBeGreaterThan(50);
    expect(sum.players?.[1]?.score).toBeGreaterThan(sum.players?.[2]?.score ?? 0);
  }, 120_000);
});
