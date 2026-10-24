// Firework Jacks and Twist Turbine with nothing between the body and the game except the camera and the pose model: a synthetic body
// goes through the real Session: calibration, the pose feed, feature extraction, the movement detectors with the options each way of
// playing asks for, the input hub, the game (kit-g1/testing/chain.ts, the fake clock). The runs are the real thing, shortened to one
// set (the game's own `timing` option).
import { describe, expect, it } from 'vitest';
import { SHAPE_FULL, type RigShape } from '../../core/moves/testing/rig.ts';
import type { GameModule } from '../../core/types/index.ts';
import { createChain, type ChainPerson } from '../kit-g1/testing/chain.ts';
import { fireworkJacksModule, manifest as fjManifest } from '../firework-jacks/index.ts';
import { twistTurbineModule, manifest as ttManifest } from '../twist-turbine/index.ts';
import { jackPerson, twistPerson } from './testing/people.ts';

const WIDE: RigShape = { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 };
const LEFT: RigShape = { ...WIDE, cx: 0.68, T: 0.17 };
const RIGHT: RigShape = { ...WIDE, cx: 0.32, T: 0.17 };

const fj = (): GameModule => fireworkJacksModule(structuredClone(fjManifest), { timing: { sets: 1, workS: 28, restS: 4, finaleS: 3, countIn: 4 } });
const tt = (): GameModule => twistTurbineModule(structuredClone(ttManifest), { timing: { sets: 1, workS: 44, restS: 4, finaleS: 3 } });

async function play(o: { module: GameModule; people: ChainPerson[]; mode?: 'solo' | 'local2'; difficulty?: string; seated?: boolean; quiet?: boolean; maxSec?: number }) {
  const chain = createChain({
    module: o.module, mode: o.mode ?? 'solo', difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, quiet: o.quiet ?? false, people: o.people, seed: 3,
  });
  await chain.start();
  const finished = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', (o.maxSec ?? 120) * 1000);
  return { chain, finished };
}

const STATES = ['setup', 'calibrating', 'countdown', 'running', 'results'];

describe('Firework Jacks, body to game', () => {
  it('a jacker on the beat: calibrates, counts down, plays the set, and the fireworks are graded on the beat', async () => {
    const r = await play({ module: fj(), people: [jackPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(STATES);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(24);
    expect(sum.score).toBeGreaterThan(300);
    expect(sum.hits).toBeGreaterThan(sum.reps! / 2);
    expect(sum.quality).toBeGreaterThan(0.6);
    expect(sum.seconds).toBeGreaterThan(30);
    expect(r.chain.sounds).toContain('perfect');
  }, 120_000);

  it('a jacker half a beat late is never on the beat: fireworks, but small ones, and no streak', async () => {
    const r = await play({ module: fj(), people: [jackPerson({ kind: 'late', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(20);
    expect(sum.hits).toBeLessThanOrEqual(2);
    expect(sum.bestStreak ?? 0).toBeLessThan(3);
    expect(sum.score).toBeLessThan(500);
  }, 120_000);

  it('standing still: nothing is counted and nothing is scored', async () => {
    const r = await play({ module: fj(), people: [jackPerson({ kind: 'idle', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps ?? 0).toBe(0);
    expect(sum.score).toBe(0);
    expect(sum.log.some((e) => e.kind === 'move_more')).toBe(true);
  }, 120_000);

  it('seated: arm jacks with the legs out of the picture reach the arm detector (the game wrote armsOnly into its manifest)', async () => {
    const r = await play({ module: fj(), people: [jackPerson({ kind: 'perfect', seated: true })], seated: true });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(24);
    expect(sum.hits).toBeGreaterThan(sum.reps! / 2);
    expect((r.chain.game() as unknown as { manifest: { detectors: unknown } }).manifest.detectors).toEqual([{ id: 'jumpingJack', opts: { armsOnly: 1 } }]);
  }, 120_000);

  it('quiet: step jacks (one foot out, no hop) reach the step detector', async () => {
    const r = await play({ module: fj(), people: [jackPerson({ kind: 'perfect', quiet: true, shape: WIDE })], quiet: true });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(24);
    expect(sum.hits).toBeGreaterThan(sum.reps! / 2);
    expect((r.chain.game() as unknown as { manifest: { detectors: unknown } }).manifest.detectors).toEqual([{ id: 'jumpingJack', opts: { step: 1 } }]);
  }, 120_000);

  it('two players on one camera: both jack on the beat, the sky shows double fireworks, each has a score', async () => {
    const r = await play({ module: fj(), mode: 'local2', people: [jackPerson({ kind: 'perfect', lane: 0, shape: LEFT }), jackPerson({ kind: 'perfect', lane: 1, shape: RIGHT })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(150);
    expect(sum.players?.[2]?.score).toBeGreaterThan(150);
    expect(sum.log.filter((e) => e.player === 1).length).toBeGreaterThan(10);
    expect(sum.log.filter((e) => e.player === 2).length).toBeGreaterThan(10);
  }, 120_000);

  it('two players: the one who plays scores, the one who stands still does not', async () => {
    const r = await play({ module: fj(), mode: 'local2', people: [jackPerson({ kind: 'perfect', lane: 0, shape: LEFT }), jackPerson({ kind: 'idle', lane: 1, shape: RIGHT })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.players?.[1]?.score).toBeGreaterThan(150);
    expect(sum.players?.[2]?.score).toBe(0);
  }, 120_000);
});

describe('Twist Turbine, body to game', () => {
  it('a twister at the pace of the band: calibrates, counts down, plays the set, answers the storms, and the city is lit', async () => {
    const r = await play({ module: tt(), people: [twistPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(STATES);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(15);
    expect(sum.score).toBeGreaterThan(300);
    expect(sum.quality).toBeGreaterThan(0.5);
    expect(sum.log.filter((e) => e.kind === 'overload' || e.kind === 'blackout').length).toBeGreaterThanOrEqual(1);
    expect(sum.log.some((e) => e.kind === 'too_slow' || e.kind === 'held_too_short')).toBe(false);
  }, 120_000);

  it('hands far apart: the twists are told so ("Hands too far apart")', async () => {
    const r = await play({ module: tt(), people: [twistPerson({ kind: 'sloppy', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.log.some((e) => e.kind === 'hands_apart')).toBe(true);
  }, 120_000);

  it('standing still: no twist is counted, nothing is scored', async () => {
    const r = await play({ module: tt(), people: [twistPerson({ kind: 'idle', shape: WIDE })] });
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps ?? 0).toBe(0);
    expect(sum.score).toBe(0);
  }, 120_000);

  it('seated: the same game with the legs out of the picture', async () => {
    const r = await play({ module: tt(), people: [twistPerson({ kind: 'perfect', seated: true })], seated: true });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(15);
    expect(sum.score).toBeGreaterThan(300);
  }, 120_000);
});
