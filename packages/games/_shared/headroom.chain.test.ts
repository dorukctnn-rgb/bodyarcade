// The hands-up check of the calibration (manifest `headroom: 'arms-up'`) for the games of this folder, through the real Session and
// calibrator with a synthetic body: Firework Jacks, Limbo Bend and Pose Wall ask for it (the hands go over the head), Twist Turbine does
// not. A player who raises both hands passes it; one who does not is not held (the check ends after its wait and the game starts with
// the check unmade). Synthetic bodies show that the parts fit together; the thresholds are the platform's.
import { describe, expect, it } from 'vitest';
import { SHAPE_FULL, type FigureSpec } from '../../core/moves/testing/rig.ts';
import type { GameModule, SessionEvents } from '../../core/types/index.ts';
import { createChain, type ChainPerson } from '../kit-g1/testing/chain.ts';
import { fireworkJacksModule, manifest as fjManifest } from '../firework-jacks/index.ts';
import { limboBendModule, manifest as lbManifest } from '../limbo-bend/index.ts';
import { poseWallModule, manifest as pwManifest } from '../pose-wall/index.ts';
import { twistTurbineModule, manifest as ttManifest } from '../twist-turbine/index.ts';
import { bendPerson, posePerson } from '../gatepose/testing/people.ts';
import { jackPerson, twistPerson } from '../strength/testing/people.ts';

const WIDE = { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 };

/** A player who stands there and never raises a hand. */
const stiff = (): ChainPerson => ({ shape: WIDE, body: (): FigureSpec => ({}) });

const ASKING: [string, () => GameModule, () => ChainPerson][] = [
  ['Firework Jacks', () => fireworkJacksModule(structuredClone(fjManifest), { timing: { sets: 1, workS: 10, finaleS: 2 } }), () => jackPerson({ kind: 'perfect', shape: WIDE })],
  ['Limbo Bend', () => limboBendModule(structuredClone(lbManifest), { timing: { sets: 1, workS: 10, finaleS: 2 } }), () => bendPerson({ kind: 'perfect', shape: WIDE })],
  ['Pose Wall', () => poseWallModule(structuredClone(pwManifest), { timing: { sets: 1, workS: 10, finaleS: 2 } }), () => posePerson({ kind: 'perfect', shape: WIDE })],
];

async function toTheCountdown(module: GameModule, person: ChainPerson, maxMs = 20_000): Promise<{ profiles: SessionEvents['profile'][]; calibrationMs: number; state: string }> {
  const chain = createChain({ module, mode: 'solo', difficulty: 'easy', seated: false, people: [person], seed: 3 });
  const profiles: SessionEvents['profile'][] = [];
  chain.session.on('profile', (e) => profiles.push(e));
  await chain.start();
  const t0 = chain.now();
  chain.until(() => chain.session.state === 'countdown' || chain.session.state === 'running' || chain.session.state === 'error', maxMs);
  return { profiles, calibrationMs: chain.now() - t0, state: chain.session.state };
}

describe.each(ASKING)('%s asks for the hands-up check', (_name, module, person) => {
  it('says so in its manifest', () => {
    expect(module().manifest.headroom).toBe('arms-up');
  });

  it('a player who raises both hands passes it, and the countdown comes soon after', async () => {
    const r = await toTheCountdown(module(), person());
    expect(r.state).not.toBe('error');
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]).toMatchObject({ outcome: 'measured', seated: false, headroom: 'ok' });
    expect(r.calibrationMs).toBeLessThan(6000);
  });

  it('a player who never raises them is not held: the game starts after the wait, with the check unmade', async () => {
    const r = await toTheCountdown(module(), stiff());
    expect(r.state).not.toBe('error');
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]).toMatchObject({ outcome: 'measured', headroom: 'unchecked' });
    expect(r.calibrationMs).toBeGreaterThan(5000);
    expect(r.calibrationMs).toBeLessThan(12_000);
  });
});

describe('Twist Turbine does not ask for it (the hands stay in front of the chest)', () => {
  it('the profile event has no headroom, and the countdown comes without a wait', async () => {
    const r = await toTheCountdown(twistTurbineModule(structuredClone(ttManifest), { timing: { sets: 1, workS: 10, finaleS: 2 } }), twistPerson({ kind: 'perfect', shape: WIDE }));
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]!.headroom).toBeUndefined();
    expect(r.calibrationMs).toBeLessThan(5000);
  });
});
