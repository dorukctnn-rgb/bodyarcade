// MovementEngine: registry, profile handling, channels, events and listener safety.
import { describe, expect, it } from 'vitest';
import type { BodyProfile, Detector, DetectorRegistry, Features, MovementEvent, MovementId, PoseFrame } from '../types/index.ts';
import { createCalibrator } from '../body/calibrator.ts';
import { combine, jumpAt, leanAt, squatAt, synthTrace } from '../pose/synth.ts';
import { traceFrames } from '../pose/trace.ts';
import { createMovementEngine } from './engine.ts';
import { replay } from './replay.ts';

const RUNNER = [{ id: 'jump' as const }, { id: 'squat' as const }, { id: 'lean' as const }];

/** A synthetic session: 2 s still (calibration), then jumps, a deep squat and a lean to the right. */
function frames(seed = 1): PoseFrame[] {
  const t = synthTrace({
    id: 'engine', durationMs: 9000, fps: 30, seed,
    motion: combine(jumpAt(2500), jumpAt(3500), squatAt(4500, 0.6), leanAt(7000, 0.5, 300, 900, 300)),
  });
  return traceFrames(t);
}

function calibrate(fs: readonly PoseFrame[]): { profile: BodyProfile; from: number } {
  const c = createCalibrator({ now: () => 0 });
  c.begin('full');
  for (let i = 0; i < fs.length; i++) {
    if (c.push(fs[i] as PoseFrame).ready) return { profile: c.profile() as BodyProfile, from: i + 1 };
  }
  throw new Error('did not calibrate');
}

describe('MovementEngine', () => {
  it('before a profile: features say not ok, no events, every channel is 0', () => {
    const e = createMovementEngine();
    e.use(RUNNER);
    const got: MovementEvent[] = [];
    e.onEvent((ev) => got.push(ev));
    const fs = frames();
    for (const f of fs.slice(0, 40)) {
      const feat = e.push(f);
      expect(feat.ok).toBe(false);
      expect(feat.seen.shoulders).toBe(true);   // framing hints still work before calibration
    }
    expect(got).toEqual([]);
    expect(e.channel('crouch')).toBe(0);
    expect(e.channels()).toEqual({});
    expect(e.last()?.t).toBe(fs[39]?.t);
  });

  it('runs the runner moves: two jumps, one squat rep, a lean to the right, with continuous channels', () => {
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine();
    e.use(RUNNER);
    e.setProfile(profile);
    const got: MovementEvent[] = [];
    e.onEvent((ev) => got.push(ev));
    let maxCrouch = 0, maxLane = 0;
    for (const f of fs.slice(from)) {
      e.push(f);
      maxCrouch = Math.max(maxCrouch, e.channel('crouch'));
      maxLane = Math.max(maxLane, e.channel('lane'));
    }
    expect(got.filter((x) => x.id === 'jump').map((x) => x.kind)).toEqual(['rep', 'rep']);
    expect(got.filter((x) => x.id === 'squat' && x.kind === 'rep')).toHaveLength(1);
    expect(got.filter((x) => x.id === 'lean').map((x) => `${x.kind}:${x.side}`)).toEqual(['holdStart:R', 'holdEnd:R']);
    expect(maxCrouch).toBeGreaterThan(0.9);
    expect(maxLane).toBe(1);
    expect(Object.keys(e.channels()).sort()).toEqual(['crouch', 'lane', 'lean', 'rise']);
    expect(e.channel('nothing')).toBe(0);
  });

  it('gives the same events as the replay helper on the same frames (one pipeline)', () => {
    const fs = frames(7);
    const r = replay(fs);
    const e = createMovementEngine();
    e.use(RUNNER);
    e.setProfile(r.profile as BodyProfile);
    const got: MovementEvent[] = [];
    e.onEvent((ev) => got.push(ev));
    const start = fs.findIndex((f) => f.t === r.calibratedAt) + 1;
    for (const f of fs.slice(start)) e.push(f);
    expect(got).toEqual(r.events);
  });

  it('is deterministic: the same frames twice give identical events and channels', () => {
    const fs = frames(3);
    const { profile, from } = calibrate(fs);
    const run = () => {
      const e = createMovementEngine();
      e.use(RUNNER);
      e.setProfile(profile);
      const out: unknown[] = [];
      e.onEvent((ev) => out.push(ev));
      for (const f of fs.slice(from)) { e.push(f); out.push(e.channels()); }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('use() before setProfile() builds the detectors when the profile arrives; use() replaces them', () => {
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine();
    e.use([{ id: 'lean' }]);
    e.setProfile(profile);
    for (const f of fs.slice(from, from + 10)) e.push(f);
    expect(Object.keys(e.channels()).sort()).toEqual(['lane', 'lean']);
    e.use([{ id: 'squat' }]);
    expect(e.channels()).toEqual({});
    e.push(fs[from + 10] as PoseFrame);
    expect(Object.keys(e.channels())).toEqual(['crouch']);
  });

  it('an unknown detector id throws and leaves the active detectors as they were', () => {
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine();
    e.use([{ id: 'lean' }]);
    e.setProfile(profile);
    // ids that no library will ever register (the movement library fills in M4..M16 over time)
    expect(() => e.use([{ id: 'squat' }, { id: 'neverRegisteredA' as MovementId }, { id: 'neverRegisteredB' as MovementId }])).toThrow(/'neverRegisteredA', 'neverRegisteredB'/);
    e.push(fs[from] as PoseFrame);
    expect(Object.keys(e.channels()).sort()).toEqual(['lane', 'lean']);
  });

  it('passes per-game options to the factory (a higher jump threshold ignores small hops)', () => {
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine();
    e.use([{ id: 'jump', opts: { rise: 0.6 } }]);
    e.setProfile(profile);
    const got: MovementEvent[] = [];
    e.onEvent((ev) => got.push(ev));
    for (const f of fs.slice(from)) e.push(f);
    expect(got).toEqual([]);   // the synthetic jumps peak at 0.45 T
  });

  it('a new profile rebuilds every detector (state starts afresh)', () => {
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine();
    e.use(RUNNER);
    e.setProfile(profile);
    const leanFrame = fs.findIndex((f) => f.t >= 7700);
    for (const f of fs.slice(from, leanFrame)) e.push(f);
    expect(e.channel('lane')).toBe(1);
    e.setProfile({ ...profile });
    expect(e.channel('lane')).toBe(0);
    expect(e.last()).toBeNull();
  });

  it('publishes value() under the detector id when the detector has no channels()', () => {
    let v = 0;
    const steady: Detector = { id: 'steadiness', push: (f: Features) => { v = f.ok ? 0.5 : 0; return []; }, value: () => v, reset: () => { v = 0; } };
    const registry: DetectorRegistry = { steadiness: () => steady };
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine({ registry });
    e.use([{ id: 'steadiness' }]);
    e.setProfile(profile);
    e.push(fs[from] as PoseFrame);
    expect(e.channels()).toEqual({ steadiness: 0.5 });
  });

  it('a listener that throws does not stop the others; the error comes back after all ran; unsubscribe works', () => {
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine();
    e.use([{ id: 'jump' }]);
    e.setProfile(profile);
    const seen: string[] = [];
    e.onEvent(() => { seen.push('a'); throw new Error('boom'); });
    const off = e.onEvent(() => seen.push('b'));
    let thrown = 0;
    for (const f of fs.slice(from)) {
      try { e.push(f); } catch (err) { thrown++; expect((err as Error).message).toBe('boom'); }
      if (seen.length === 2) off();
    }
    expect(seen).toEqual(['a', 'b', 'a']);   // second jump: 'b' had unsubscribed
    expect(thrown).toBe(2);
  });

  it('reset() clears channels and detector state but keeps the profile and detectors', () => {
    const fs = frames();
    const { profile, from } = calibrate(fs);
    const e = createMovementEngine();
    e.use(RUNNER);
    e.setProfile(profile);
    const deep = fs.findIndex((f) => f.t >= 5200);
    for (const f of fs.slice(from, deep)) e.push(f);
    expect(e.channel('crouch')).toBeGreaterThan(0.5);
    e.reset();
    expect(e.channels()).toEqual({});
    expect(e.last()).toBeNull();
    const feat = e.push(fs[from] as PoseFrame);
    expect(feat.ok).toBe(true);
    expect(e.channel('crouch')).toBeLessThan(0.2);
  });
});
