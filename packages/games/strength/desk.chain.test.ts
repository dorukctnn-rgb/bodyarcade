// Firework Jacks asked for the full body and a camera that sees head to hips (a person at a laptop, the seated body of the rig). The session measures what it
// can, calls it a fallback ('profile' event: outcome 'fallback', seated true) and starts the game in its seated way: arm jacks. The
// movement engine was given its detectors before the calibration (after the game's init, when the full-body way was still the one asked
// for), so the session gives the engine the manifest's detectors again when the run starts (Session.beginCountdown: `feed.use(manifest.detectors)`
// after `game.start`, on v2 since b51dc79); the game's start() has rewritten its manifest by then (host.ts). Without that line the game waits for
// arm jacks from a detector that wants feet: nothing is counted (checked on 24 Oct: 0 jacks without it, 33 with it). The game's own part (its
// manifest follows the start options) is tested in fireworks-game.test.ts; this is the whole chain.
import { describe, expect, it } from 'vitest';
import type { SessionEvents } from '../../core/types/index.ts';
import { createChain } from '../kit-g1/testing/chain.ts';
import { fireworkJacksModule, manifest as fjManifest } from '../firework-jacks/index.ts';
import { jackPerson } from './testing/people.ts';

const desk = (): ReturnType<typeof fireworkJacksModule> => fireworkJacksModule(structuredClone(fjManifest), { timing: { sets: 1, workS: 28, restS: 4, finaleS: 3, countIn: 4 } });

describe('Firework Jacks at a desk, in the full-body way (the session asks the manifest for its detectors again when the run starts)', () => {
  it('falls back to arm jacks, and the arm jacks are counted', async () => {
    const chain = createChain({ module: desk(), mode: 'solo', difficulty: 'normal', seated: false, quiet: false, people: [jackPerson({ kind: 'perfect', seated: true })], seed: 3 });
    const profiles: SessionEvents['profile'][] = [];
    chain.session.on('profile', (e) => profiles.push(e));
    await chain.start();
    const finished = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', 120_000);
    expect(chain.seen.errors).toEqual([]);
    expect(finished).toBe(true);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ outcome: 'fallback', seated: true });
    expect((chain.game() as unknown as { manifest: { detectors: unknown } }).manifest.detectors).toEqual([{ id: 'jumpingJack', opts: { armsOnly: 1 } }]);
    const sum = chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(20);
    expect(sum.score).toBeGreaterThan(200);
  }, 120_000);
});
