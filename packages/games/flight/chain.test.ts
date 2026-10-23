// Squat Flap with nothing between the body and the game except the camera and the pose model: a synthetic body goes through
// the real calibration, the feature extractor, the movement detectors and the input hub (kit-g1/testing/chain.ts).
import { describe, expect, it } from 'vitest';
import { SHAPE_FULL, SHAPE_UPPER, type RigShape } from '../../core/moves/testing/rig.ts';
import { createChain, type ChainPerson } from '../kit-g1/testing/chain.ts';
import squatFlap from '../squat-flap/index.ts';
import type { FlightGame } from './game.ts';
import { squatPerson } from './testing/body.ts';

const WIDE: RigShape = { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 };

async function run(o: { people: ChainPerson[]; mode?: 'solo' | 'local2'; difficulty?: string; seated?: boolean; maxSec?: number }) {
  const chain = createChain({ module: squatFlap, mode: o.mode ?? 'solo', difficulty: o.difficulty ?? 'easy', ...(o.seated !== undefined ? { seated: o.seated } : {}), people: o.people, seed: 3 });
  await chain.start();
  const finished = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', (o.maxSec ?? 330) * 1000);
  return { chain, finished, game: chain.game() as FlightGame };
}

describe('Squat Flap, body to game', () => {
  it('a perfect squatter in front of the camera: calibrates, counts down, flies three sets and gets to the results', async () => {
    const r = await run({ people: [squatPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(['setup', 'calibrating', 'countdown', 'running', 'results']);
    const sum = r.chain.seen.over[0]!;
    expect(sum.cleared).toBeGreaterThan(40);
    expect(sum.score).toBeGreaterThan(120);
    expect(sum.reps).toBeGreaterThan(60);
    expect(sum.hits).toBeLessThanOrEqual(2);
    expect(sum.seconds).toBeGreaterThan(232);
    // The detector's flaps are what the game counted: the same number of reps as flap events the game saw.
    expect(r.game.state!.lanes[0]!.flaps).toBe(sum.reps);
  }, 120_000);

  it('a squatter who does not move: the feathers go and the round is over long before the three sets', async () => {
    const r = await run({ people: [squatPerson({ kind: 'idle', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.score).toBe(0);
    expect(sum.hits).toBe(3);
    expect(sum.seconds).toBeLessThan(80);
    expect(sum.log.every((e) => e.ok || e.kind === 'move_more')).toBe(true);
  }, 60_000);

  it('the seated variant: arms up and down flap the bird through the arm detector', async () => {
    const r = await run({ people: [squatPerson({ kind: 'perfect', arms: true, shape: { ...SHAPE_UPPER, aspect: 16 / 9, T: 0.24 } })], seated: true, maxSec: 330 });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(30);
    expect(sum.cleared).toBeGreaterThan(15);
  }, 120_000);

  it('two players on one camera: the one who plays scores, the one who stands still does not', async () => {
    const left: RigShape = { ...WIDE, cx: 0.68, T: 0.17 };
    const right: RigShape = { ...WIDE, cx: 0.32, T: 0.17 };
    const r = await run({ mode: 'local2', people: [squatPerson({ kind: 'perfect', lane: 0, shape: left }), squatPerson({ kind: 'idle', lane: 1, shape: right })], maxSec: 330 });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(80);
    expect(sum.players?.[2]?.score).toBe(0);
  }, 120_000);
});
