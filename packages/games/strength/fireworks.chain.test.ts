// Firework Jacks through the real chain: a synthetic figure of the movement library's test rig doing jumping jacks, the real
// jumpingJack detector with the options the game asks for in each way of playing (fjDetectors), and the simulation reading the
// detector's events and channels at 60 steps a second. The scripted bots of fireworks.test.ts say what the events look like; this
// says that the detector really gives them, that the options the game names reach it, and that a jack on the beat is graded on the
// beat. Synthetic figures prove the code does what the thresholds say, not that the thresholds fit real bodies.
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import { createJumpingJackDetector } from '../../core/moves/jumpingJack.ts';
import { drive, pick } from '../../core/moves/testing/harness.ts';
import { keyframes, plus, SHAPE_UPPER, type ArmSpec, type FigureSpec, type Motion } from '../../core/moves/testing/rig.ts';
import type { SimEvent } from '../_shared/host.ts';
import { chainInput, chainPlayer } from '../_shared/testing/chain.ts';
import { msOf } from '../_shared/util.ts';
import { fjDetectors } from './fireworks-game.ts';
import { FireworkSim, type FjTiming } from './fireworks.ts';
import { run } from './testing/run.ts';

const TIMING: Partial<FjTiming> = { sets: 1, workS: 24, restS: 5, finaleS: 3, countIn: 4 };

function make(o: { seed?: number; difficulty?: string; seated?: boolean; silent?: boolean; players?: 1 | 2 } = {}): FireworkSim {
  const seed = o.seed ?? 3, players = o.players ?? 1;
  return new FireworkSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: players === 2 ? 'local2' : 'solo' },
      flags: { reducedMotion: false, silent: o.silent ?? false, seated: o.seated ?? false },
      players, audioLatencyMs: 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 8,
    timing: TIMING,
  });
}

const UP: ArmSpec = { a: 165, f: 165 };
const OPEN: FigureSpec = { armL: UP, armR: UP, legL: { out: 0.45 }, legR: { out: 0.45 } };
const STEP: FigureSpec = { armL: UP, armR: UP, legL: { out: 0.31 }, legR: { out: 0.31 } };
const ARMS: FigureSpec = { armL: UP, armR: UP };

/** One jack from t0: open over 160 ms, held 60 ms, closed again over 160 ms (fast enough for 96 a minute). */
const jack = (t0: number, open: FigureSpec): Motion => keyframes([[t0, {}], [t0 + 160, open], [t0 + 220, open], [t0 + 380, {}]]);

/** How long after the start of a jack the detector counts it (the instant the body is open). */
function repLag(open: FigureSpec, opts: Record<string, number>, hide: readonly ('ankles' | 'feet' | 'knees')[] = []): number {
  const m: Motion = (t) => ({ ...jack(1000, open)(t), ...(hide.length ? { hide } : {}) });
  const d = drive(createJumpingJackDetector, m, { durationMs: 2000, opts, ...(hide.length ? { shape: SHAPE_UPPER } : {}) });
  const reps = pick(d.events, { kind: 'rep' });
  expect(reps).toHaveLength(1);
  return (reps[0] as { t: number }).t - 1000;
}

interface Played { sim: FireworkSim; events: SimEvent[]; reps: number }

/** The figure jacks on every beat of the first set from beat `from` (+ `shift` ms), through the real detector, into the simulation. */
function playJacks(sim: FireworkSim, open: FigureSpec, o: { opts?: Record<string, number>; shift?: number; from?: number; hide?: readonly ('ankles' | 'feet' | 'knees')[]; lane?: number } = {}): Played & { d: ReturnType<typeof drive> } {
  const opts = o.opts ?? {};
  const hide = o.hide ?? [];
  const seg = sim.plan.segments[0] as { startK: number; endK: number; bpm: number };
  const period = 60000 / seg.bpm;
  const first = msOf(seg.startK);
  const lag = repLag(open, opts, hide);
  const starts: number[] = [];
  for (let n = o.from ?? 1; first + n * period < msOf(seg.endK) - 700; n++) starts.push(first + n * period - lag + (o.shift ?? 0));
  const base = plus(...starts.map((t0) => jack(t0, open)));
  const m: Motion = (t) => ({ ...base(t), ...(hide.length ? { hide } : {}) });
  const d = drive(createJumpingJackDetector, m, { durationMs: msOf(sim.plan.endK) + 200, opts, ...(hide.length ? { shape: SHAPE_UPPER } : {}) });
  const r = run(sim, chainInput(chainPlayer(d)));
  return { sim, events: r.events, reps: pick(d.events, { kind: 'rep' }).length, d };
}

const jacksOf = (events: readonly SimEvent[], player = 1): SimEvent[] => events.filter((e) => e.type === 'jack' && e['player'] === player);

describe('standing: the real jumping jack detector on the beat', () => {
  it('jacks on every beat are counted by the detector and graded on the beat by the game (perfect or good)', () => {
    const sim = make();
    const { events, reps } = playJacks(sim, OPEN);
    const p = sim.playerStates[0]!;
    expect(reps).toBeGreaterThan(20);
    expect(p.jacks).toBe(reps);
    const graded = jacksOf(events).filter((e) => e['grade'] === 'perfect' || e['grade'] === 'good' || e['grade'] === 'off');
    expect(graded.length).toBeGreaterThanOrEqual(reps - 4);
    expect(p.off).toBeLessThanOrEqual(1);
    expect(p.perfect + p.good).toBeGreaterThanOrEqual(p.judged - 1);
    expect(p.perfect).toBeGreaterThan(p.judged / 2);
    expect(p.score).toBeGreaterThan(200);
    expect(p.bestStreak).toBeGreaterThan(10);
  });

  it('the first beats are the count-in: jacks there are warm-up fireworks that score nothing', () => {
    const sim = make();
    const { events } = playJacks(sim, OPEN, { from: 0 });
    const warm = jacksOf(events).filter((e) => e['grade'] === 'warmup');
    expect(warm.length).toBeGreaterThanOrEqual(3);
    expect(warm.every((e) => e['pts'] === 0)).toBe(true);
  });

  it('jacks half a beat off the beat are not on the beat: they are "off", the streak never grows', () => {
    const sim = make();
    const seg = sim.plan.segments[0] as { bpm: number };
    const { events } = playJacks(sim, OPEN, { shift: 30000 / seg.bpm });
    const p = sim.playerStates[0]!;
    expect(jacksOf(events).filter((e) => e['grade'] === 'off').length).toBeGreaterThan(8);
    expect(p.off).toBeGreaterThan((p.judged * 2) / 3);
    expect(p.bestStreak).toBeLessThan(3);
  });

  it('the avatar\'s openness follows the body: the channel `open` is 0 standing and 1 open', () => {
    const sim = make();
    const { d } = playJacks(sim, OPEN);
    const opens = d.samples.map((s) => s.ch['open'] ?? 0);
    expect(Math.min(...opens)).toBe(0);
    expect(Math.max(...opens)).toBe(1);
  });
});

describe('the variants ask the detector for what they need', () => {
  it('seated: arm jacks with the legs out of the picture are counted with armsOnly, and the standing detector counts none of them', () => {
    const spec = fjDetectors({ seated: true, silent: false })[0] as { id: string; opts?: Record<string, number> };
    expect(spec.opts).toEqual({ armsOnly: 1 });
    const sim = make({ seated: true });
    const { events, reps } = playJacks(sim, ARMS, { opts: spec.opts ?? {}, hide: ['ankles', 'feet', 'knees'] });
    expect(sim.variant).toBe('arms');
    expect(reps).toBeGreaterThan(20);
    expect(sim.playerStates[0]?.perfect).toBeGreaterThan(10);
    expect(jacksOf(events).length).toBeGreaterThan(20);
    const plain = drive(createJumpingJackDetector, (t) => ({ ...jack(1000, ARMS)(t), hide: ['ankles', 'feet', 'knees'] as const }), { durationMs: 2000, shape: SHAPE_UPPER });
    expect(pick(plain.events, { kind: 'rep' })).toHaveLength(0);
  });

  it('quiet: step jacks (one foot out to the side, no hop) are counted with the step option, and the plain detector counts none of them', () => {
    const spec = fjDetectors({ seated: false, silent: true })[0] as { id: string; opts?: Record<string, number> };
    expect(spec.opts).toEqual({ step: 1 });
    const sim = make({ silent: true });
    const { reps } = playJacks(sim, STEP, { opts: spec.opts ?? {} });
    expect(sim.variant).toBe('step');
    expect(reps).toBeGreaterThan(20);
    expect(sim.playerStates[0]?.perfect).toBeGreaterThan(10);
    const plain = drive(createJumpingJackDetector, jack(1000, STEP), { durationMs: 2000 });
    expect(pick(plain.events, { kind: 'rep' })).toHaveLength(0);
  });

  it('standing asks for no options at all', () => {
    expect(fjDetectors({ seated: false, silent: false })).toEqual([{ id: 'jumpingJack' }]);
  });
});

describe('two players on one camera: the co-op sky', () => {
  it('two figures jacking on the same beats make double fireworks, and each has their own score', () => {
    const sim = make({ players: 2 });
    const seg = sim.plan.segments[0] as { startK: number; endK: number; bpm: number };
    const period = 60000 / seg.bpm;
    const lag = repLag(OPEN, {});
    const starts: number[] = [];
    for (let n = 1; msOf(seg.startK) + n * period < msOf(seg.endK) - 700; n++) starts.push(msOf(seg.startK) + n * period - lag);
    const m = plus(...starts.map((t0) => jack(t0, OPEN)));
    const one = drive(createJumpingJackDetector, m, { durationMs: msOf(sim.plan.endK) + 200 });
    const two = drive(createJumpingJackDetector, plus(...starts.map((t0) => jack(t0 + 20, OPEN))), { durationMs: msOf(sim.plan.endK) + 200 });
    const r = run(sim, chainInput(chainPlayer(one), chainPlayer(two)));
    expect(sim.doubles).toBeGreaterThan(10);
    expect(jacksOf(r.events, 1).length).toBeGreaterThan(20);
    expect(jacksOf(r.events, 2).length).toBeGreaterThan(20);
    const s = sim.summary();
    expect(s.players?.[1]?.score).toBeGreaterThan(200);
    expect(s.players?.[2]?.score).toBeGreaterThan(200);
  });
});
