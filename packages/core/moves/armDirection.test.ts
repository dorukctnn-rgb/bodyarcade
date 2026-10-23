// M16 arm direction and the arm flap, with arms drawn by the rig (testing/rig.ts, testing/motions.ts).
import { describe, expect, it } from 'vitest';
import { ARM_DIRECTION_DEFAULTS, createArmDirectionDetector, nearestDirection, ROLL_DEAD_ZONE } from './armDirection.ts';
import { canExplain } from './kit.ts';
import { chAt, chMax, chMin, drive, pick, replayMotion, times } from './testing/harness.ts';
import { handPaths, plus, pointAt, ramp } from './testing/motions.ts';
import { keyframes, still, type ArmSpec, type Motion } from './testing/rig.ts';

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('must explain');
  return d.detector.explain(ms);
};

describe('nearestDirection', () => {
  it('rounds to the nearest of eight directions and says how far off', () => {
    expect(nearestDirection(0)).toEqual({ dir: 0, off: 0 });
    expect(nearestDirection(88)).toEqual({ dir: 2, off: 2 });
    expect(nearestDirection(-90)).toEqual({ dir: 6, off: 0 });
    expect(nearestDirection(180)).toEqual({ dir: 4, off: 0 });
    expect(nearestDirection(-179)).toEqual({ dir: 4, off: 1 });
    expect(nearestDirection(-30).dir).toBe(7);          // closer to -45 than to 0
    expect(nearestDirection(22).off).toBeCloseTo(22, 6);
  });
});

describe('pointing in eight directions', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('the right arm pointing in direction %i reads that direction', (dir) => {
    const d = drive(createArmDirectionDetector, handPaths(undefined, () => pointAt(dir * 45)), { durationMs: 600 });
    expect(chAt(d, 'arm.R.dir', 500)).toBe(dir);
    expect(chAt(d, 'arm.R.straight', 500)).toBe(1);
    expect(chAt(d, 'arm.R.deg', 500)).toBeCloseTo(nearestDirection(dir * 45).dir === dir ? ((dir * 45 + 180) % 360) - 180 : 0, -1);
    expect(chAt(d, 'arm.R.reach', 500)).toBeGreaterThan(0.9);
  });

  it('the left arm is the player left: pointing out to the left is direction 4', () => {
    const d = drive(createArmDirectionDetector, handPaths(() => pointAt(180), undefined), { durationMs: 600 });
    expect(chAt(d, 'arm.L.dir', 500)).toBe(4);
    expect(chAt(d, 'arm.R.dir', 500)).toBe(6);   // the right arm hangs: direction down
  });

  it('within 20 degrees of a direction still points there; in the narrow gap between two directions it points nowhere', () => {
    const near = drive(createArmDirectionDetector, handPaths(undefined, () => pointAt(90 + 15)), { durationMs: 500 });
    expect(chAt(near, 'arm.R.dir', 400)).toBe(2);                  // 105 degrees is 15 off the 90 and 30 off the 135: up
    const up = drive(createArmDirectionDetector, handPaths(undefined, () => pointAt(90 + 19)), { durationMs: 500 });
    expect(chAt(up, 'arm.R.dir', 400)).toBe(2);
    const gap = drive(createArmDirectionDetector, handPaths(undefined, () => pointAt(90 + 22.5)), { durationMs: 500 });
    expect(chAt(gap, 'arm.R.dir', 400)).toBe(-1);                  // exactly between up and up-left: 22.5 off both
  });

  it('a bent elbow does not point, and the miss says the elbow was bent', () => {
    const d = drive(createArmDirectionDetector, handPaths(undefined, () => pointAt(0, 0.95)), { durationMs: 1500 });
    expect(chMax(d, 'arm.R.dir', 400)).toBe(-1);
    expect(chAt(d, 'arm.R.straight', 1000)).toBe(0);
    const miss = why(d)!;
    expect(miss.code).toBe('elbows_bent');
    expect(miss.side).toBe('R');
    expect(miss.got!).toBeLessThan(ARM_DIRECTION_DEFAULTS.straight);
    expect(miss.need).toBe(ARM_DIRECTION_DEFAULTS.straight);
  });

  it('a hand next to the shoulder points nowhere', () => {
    const d = drive(createArmDirectionDetector, handPaths(undefined, () => ({ x: 0.2, y: 0.1 })), { durationMs: 500 });
    expect(chAt(d, 'arm.R.dir', 400)).toBe(-1);
    expect(chAt(d, 'arm.R.reach', 400)).toBeLessThan(0.3);
  });
});

describe('holds (Semaphore)', () => {
  const motion = handPaths(undefined, (t) => (t < 1500 ? pointAt(-90) : t < 4000 ? pointAt(0) : pointAt(90)));

  it('holdStart after 600 ms of steady pointing, holdEnd when the arm moves on; nothing without holds: 1', () => {
    const d = drive(createArmDirectionDetector, motion, { durationMs: 6000, opts: { holds: 1 } });
    const starts = pick(d.events, { kind: 'holdStart' }).filter((e) => e.side === 'R');
    const ends = pick(d.events, { kind: 'holdEnd' }).filter((e) => e.side === 'R');
    expect(starts.map((e) => e.value)).toEqual([6, 0, 2]);     // down, right, up
    expect(ends.map((e) => e.value)).toEqual([6, 0]);
    expect(starts[1]!.t - 1500).toBeGreaterThanOrEqual(600);
    expect(starts[1]!.t - 1500).toBeLessThan(900);
    const quiet = drive(createArmDirectionDetector, motion, { durationMs: 6000 });
    expect(quiet.events).toEqual([]);
  });

  it('a pass through a direction shorter than the hold gives no event', () => {
    const quick = handPaths(undefined, (t) => (t > 2000 && t < 2300 ? pointAt(0) : pointAt(-90)));
    const d = drive(createArmDirectionDetector, quick, { durationMs: 4000, opts: { holds: 1 } });
    expect(pick(d.events, { kind: 'holdStart' }).filter((e) => e.value === 0)).toHaveLength(0);
  });
});

// ───────── the flap ─────────

const UP: ArmSpec = { a: 160, f: 160 };
const DOWN: ArmSpec = { a: 5, f: 5 };
/** A flap: arms up at t0, down at t0 + downMs, back up at t0 + downMs + upMs. */
const flapAt = (t0: number, downMs = 300, upMs = 400): Motion =>
  keyframes([[t0, { armL: UP, armR: UP }], [t0 + downMs, { armL: DOWN, armR: DOWN }], [t0 + downMs + upMs, { armL: UP, armR: UP }]]);

describe('arm flap', () => {
  const opts = { flap: 1 };

  it('each downstroke of both arms is one flap, with speed and power', () => {
    const m = keyframes([[0, { armL: UP, armR: UP }], [300, { armL: DOWN, armR: DOWN }], [700, { armL: UP, armR: UP }], [1000, { armL: DOWN, armR: DOWN }], [1400, { armL: UP, armR: UP }], [1700, { armL: DOWN, armR: DOWN }]]);
    const d = drive(createArmDirectionDetector, m, { durationMs: 2400, opts });
    const reps = pick(d.events, { kind: 'rep' });
    expect(reps).toHaveLength(3);
    const t = times(d.events, { kind: 'rep' });
    expect(t[0]!).toBeGreaterThan(100); expect(t[0]!).toBeLessThan(450);
    expect(t[1]!).toBeGreaterThan(800); expect(t[1]!).toBeLessThan(1150);
    expect(t[2]!).toBeGreaterThan(1500); expect(t[2]!).toBeLessThan(1850);
    for (const e of reps) {
      expect(e.id).toBe('armDirection');
      expect(e.q!.speed!).toBeGreaterThan(1);
      expect(e.q!.range!).toBeGreaterThan(1);
      expect(e.value!).toBeGreaterThanOrEqual(ARM_DIRECTION_DEFAULTS.powerMin);
      expect(e.value!).toBeLessThanOrEqual(ARM_DIRECTION_DEFAULTS.powerMax);
    }
    expect(d.samples.at(-1)!.ch.flaps).toBe(3);
  });

  it('a slower flap has less power than a fast one', () => {
    const fast = drive(createArmDirectionDetector, flapAt(500, 200), { durationMs: 1800, opts });
    const slow = drive(createArmDirectionDetector, flapAt(500, 600), { durationMs: 2200, opts });
    const pf = pick(fast.events, { kind: 'rep' })[0]!, ps = pick(slow.events, { kind: 'rep' })[0]!;
    expect(pf.q!.speed!).toBeGreaterThan(ps.q!.speed!);
    expect(pf.value!).toBeGreaterThanOrEqual(ps.value!);
  });

  it('is off by default: the same motion gives no events without flap: 1', () => {
    expect(drive(createArmDirectionDetector, flapAt(500), { durationMs: 1800 }).events).toEqual([]);
  });

  it('one arm alone is no flap, and the miss names the arm that stayed behind', () => {
    const m = keyframes([[500, { armL: UP, armR: HANG_SPEC }], [800, { armL: DOWN, armR: HANG_SPEC }], [1200, { armL: UP, armR: HANG_SPEC }]]);
    const d = drive(createArmDirectionDetector, m, { durationMs: 2000, opts });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('use_both_arms');
    expect(miss.side).toBe('R');
  });

  it('a downstroke that takes longer than 0.7 s is too slow', () => {
    // hands out to the sides sinking linearly from 0.52 A above the shoulders to 0.52 A below in two seconds
    const sink = (side: number) => (t: number) => ({ x: side * 1.0, y: 0.6 - 1.2 * Math.min(1, Math.max(0, (t - 500) / 2000)) });
    const d = drive(createArmDirectionDetector, handPaths(sink(-1), sink(1)), { durationMs: 3500, opts });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 4000)!;
    expect(miss.code).toBe('too_slow');
    expect(miss.need).toBe(ARM_DIRECTION_DEFAULTS.flapWindowMs);
    expect(miss.got!).toBeGreaterThan(700);
  });

  it('hands that stay near the body line (a clap overhead and drop) are not wings', () => {
    const m = handPaths((t) => ({ x: -0.05, y: 0.9 - 1.9 * ramp(t, 800, 1100) }), (t) => ({ x: 0.05, y: 0.9 - 1.9 * ramp(t, 800, 1100) }));
    const d = drive(createArmDirectionDetector, m, { durationMs: 2000, opts });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 4000)!;
    expect(miss.code).toBe('arms_not_out');
    expect(miss.need).toBe(ARM_DIRECTION_DEFAULTS.flapSide);
    expect(miss.got!).toBeLessThan(ARM_DIRECTION_DEFAULTS.flapSide);
  });

  it('arms that hang and lift to the sides without going above the shoulders are not flaps', () => {
    const m = keyframes([[0, { armL: { a: 0, f: 0 }, armR: { a: 0, f: 0 } }], [500, { armL: { a: 90, f: 90 }, armR: { a: 90, f: 90 } }], [1000, { armL: { a: 0, f: 0 }, armR: { a: 0, f: 0 } }]]);
    const d = drive(createArmDirectionDetector, m, { durationMs: 1500, opts });
    expect(d.events).toEqual([]);
  });

  it('standing still with arms down gives no events and nothing to explain', () => {
    const d = drive(createArmDirectionDetector, still(), { durationMs: 4000, opts });
    expect(d.events).toEqual([]);
    expect(why(d)).toBeNull();
  });

  it('wing, spread, roll and glide are published for Wingbeat', () => {
    const level: Motion = still({ armL: { a: 90, f: 90 }, armR: { a: 90, f: 90 } });
    const d = drive(createArmDirectionDetector, level, { durationMs: 600, opts });
    expect(chAt(d, 'glide', 500)).toBe(1);
    expect(Math.abs(chAt(d, 'wing', 500))).toBeLessThan(0.2);
    expect(chAt(d, 'spread', 500)).toBeGreaterThan(0.9);
    expect(Math.abs(chAt(d, 'roll', 500))).toBeLessThan(ROLL_DEAD_ZONE);
    const tilted: Motion = still({ armL: { a: 90, f: 90 }, armR: { a: 120, f: 120 } });
    const t = drive(createArmDirectionDetector, tilted, { durationMs: 600, opts });
    expect(chAt(t, 'roll', 500)).toBeGreaterThan(ROLL_DEAD_ZONE);      // right hand higher
    expect(chAt(t, 'glide', 500)).toBe(0);
    const up = drive(createArmDirectionDetector, still({ armL: UP, armR: UP }), { durationMs: 600, opts });
    expect(chAt(up, 'wing', 500)).toBeGreaterThan(0.8);
    expect(chMin(up, 'wing', 100)).toBeGreaterThan(0.8);
  });

  it('hands out of view: nothing points or flaps, and the miss says so', () => {
    const m = plus(flapAt(500), still({ hide: ['hands'] }));
    const d = drive(createArmDirectionDetector, m, { durationMs: 3000, opts });
    expect(d.events).toEqual([]);
    expect(why(d)!.code).toBe('hands_out_of_view');
  });
});

const HANG_SPEC: ArmSpec = { a: 0, f: 0 };

describe('through the real calibrator and One Euro filter', () => {
  it.each([30, 15, 10])('five flaps at %i Hz', (hz) => {
    const frames: Array<readonly [number, { armL: ArmSpec; armR: ArmSpec }]> = [];
    for (let i = 0; i < 5; i++) {
      frames.push([i * 800, { armL: UP, armR: UP }], [i * 800 + 300, { armL: DOWN, armR: DOWN }]);
    }
    frames.push([4000, { armL: UP, armR: UP }]);
    const r = replayMotion(keyframes(frames), { detectors: [{ id: 'armDirection', opts: { flap: 1 } }], durationMs: 4600, hz });
    expect(r.calibratedAt).not.toBeNull();
    expect(r.events.filter((e) => e.kind === 'rep')).toHaveLength(5);
  });

  it('arms hanging for ten seconds: no flap, and no hold event unless asked for (down is a direction too)', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'armDirection', opts: { flap: 1 } }], durationMs: 10000 });
    expect(r.events).toEqual([]);
    const h = replayMotion(still(), { detectors: [{ id: 'armDirection', opts: { holds: 1 } }], durationMs: 3000 });
    expect(h.events.map((e) => [e.kind, e.side, e.value])).toEqual([['holdStart', 'L', 6], ['holdStart', 'R', 6]]);
  });
});
