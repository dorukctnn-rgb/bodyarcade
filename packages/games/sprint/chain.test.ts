// Knee Sprint with nothing between the body and the game except the camera and the pose model: a synthetic body goes through
// the real calibration, the feature extractor, the movement detectors and the input hub (kit-g1/testing/chain.ts).
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

describe('Knee Sprint, body to game', () => {
  it('a perfect runner in front of the camera: calibrates, counts down, runs three heats and gets to the results', async () => {
    const r = await run({ people: [runnerPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(['setup', 'calibrating', 'countdown', 'running', 'results']);
    const sum = r.chain.seen.over[0]!;
    console.log('EASY perfect', JSON.stringify({ ...sum, log: sum.log.length }), r.game.state!.lanes[0]!.results.map((x) => `${x.medal}:${x.time.toFixed(1)}`));
    expect(sum.reps).toBeGreaterThan(100);
    expect(sum.score).toBeGreaterThan(200);
  }, 120_000);
});
