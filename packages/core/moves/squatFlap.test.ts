// Squat Flap detector (M1, flap variant). Motions are drawn by the articulated rig (testing/rig.ts); synthetic numbers
// show that the code does what the thresholds say, not that the thresholds suit real bodies.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { createSquatFlapDetector, flapDepthFor, SQUAT_FLAP_DEFAULTS } from './squatFlap.ts';
import { chMax, drive, pick, replayMotion, times } from './testing/harness.ts';
import { keyframes, plus, still, absentBetween, type Motion } from './testing/rig.ts';

/** One squat-and-rise starting at t0: down over downMs, held holdMs, back up over upMs. */
const cycle = (t0: number, depth = 0.6, downMs = 500, holdMs = 300, upMs = 400): Motion =>
  keyframes([[t0, {}], [t0 + downMs, { drop: depth }], [t0 + downMs + holdMs, { drop: depth }], [t0 + downMs + holdMs + upMs, {}]]);

const why = (d: ReturnType<typeof drive>, windowMs?: number) => {
  if (!canExplain(d.detector)) throw new Error('squat flap must explain');
  return d.detector.explain(windowMs);
};

describe('one flap', () => {
  const d = drive(createSquatFlapDetector, cycle(1000), { durationMs: 3000 });
  const reps = pick(d.events, { kind: 'rep' });

  it('glides while down and flaps once on the rise', () => {
    expect(reps).toHaveLength(1);
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(1);
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(1);
    // the glide starts on the way down, the flap on the way up (rise from 0.6 to under 0.25 takes about 250 ms)
    const [t0] = times(d.events, { kind: 'holdStart' });
    const [tr] = times(d.events, { kind: 'rep' });
    expect(t0!).toBeGreaterThan(1000);
    expect(t0!).toBeLessThan(1500);
    expect(tr!).toBeGreaterThan(1800);
    expect(tr!).toBeLessThan(2300);
  });

  it('reports depth, rising speed and a power between 0.6 and 1.2', () => {
    const e = reps[0]!;
    expect(e.id).toBe('squat');
    expect(e.q!.depth!).toBeCloseTo(0.6, 1);
    expect(e.q!.speed!).toBeGreaterThanOrEqual(SQUAT_FLAP_DEFAULTS.minUp);
    expect(e.value!).toBeGreaterThanOrEqual(0.6);
    expect(e.value!).toBeLessThanOrEqual(1.2);
  });

  it('publishes the channels a flight game reads', () => {
    expect(chMax(d, 'glide', 1500, 1800)).toBe(1);
    expect(chMax(d, 'glide', 2600)).toBe(0);
    expect(chMax(d, 'stand', 0, 900)).toBe(1);
    expect(chMax(d, 'stand', 1500, 1800)).toBe(0);
    expect(chMax(d, 'drop')).toBeCloseTo(0.6, 1);
    expect(d.samples.at(-1)!.ch.flaps).toBe(1);
    expect(d.detector.value()).toBeCloseTo(0, 1);
  });
});

describe('several flaps', () => {
  it('every squat and rise is exactly one flap, in order', () => {
    const m = plus(cycle(1000), cycle(3000, 0.7), cycle(5000, 0.55));
    const d = drive(createSquatFlapDetector, m, { durationMs: 7500 });
    const t = times(d.events, { kind: 'rep' });
    expect(t).toHaveLength(3);
    expect(t[1]! - t[0]!).toBeGreaterThan(1500);
    const depths = pick(d.events, { kind: 'rep' }).map((e) => e.q!.depth as number);
    expect(depths[0]!).toBeCloseTo(0.6, 1);
    expect(depths[1]!).toBeCloseTo(0.7, 1);
    expect(depths[2]!).toBeCloseTo(0.55, 1);
  });

  it('a bounce at the bottom (two rises from one squat) is one flap', () => {
    const m = keyframes([[1000, {}], [1500, { drop: 0.6 }], [1700, { drop: 0.45 }], [1900, { drop: 0.6 }], [2400, {}]]);
    const d = drive(createSquatFlapDetector, m, { durationMs: 3500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(1);
  });
});

describe('what does not count, and why', () => {
  it('a rise that is too slow is no flap and is explained as too slow', () => {
    const m = keyframes([[1000, {}], [1500, { drop: 0.6 }], [1800, { drop: 0.6 }], [4300, {}]]);   // 2.5 s to stand: 0.24 T per s
    const d = drive(createSquatFlapDetector, m, { durationMs: 4600 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(1);
    const miss = why(d, 5000)!;
    expect(miss.code).toBe('too_slow');
    expect(miss.got!).toBeLessThan(SQUAT_FLAP_DEFAULTS.minUp);
    expect(miss.need).toBe(SQUAT_FLAP_DEFAULTS.minUp);
  });

  it('a squat that stays above the glide line gives nothing and says the hips were not low enough', () => {
    const d = drive(createSquatFlapDetector, cycle(1000, 0.3), { durationMs: 3000 });
    expect(d.events).toEqual([]);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('hips_not_low');
    expect(miss.got!).toBeCloseTo(0.3, 1);
    expect(miss.need).toBe(SQUAT_FLAP_DEFAULTS.down);
  });

  it('bending forward without lowering the hips is not a squat', () => {
    const m = keyframes([[1000, {}], [1500, { fore: 0.7 }], [2300, { fore: 0.7 }], [2800, {}]]);
    const d = drive(createSquatFlapDetector, m, { durationMs: 3500 });
    expect(d.events).toEqual([]);
    expect(why(d, 3000)!.code).toBe('bending_forward');
  });

  it('standing still says nothing', () => {
    const d = drive(createSquatFlapDetector, still(), { durationMs: 4000 });
    expect(d.events).toEqual([]);
    expect(why(d)).toBeNull();
  });

  it('a person who leaves mid-glide ends the glide once (after 600 ms), and the return while still down is no flap', () => {
    const m = plus(still({ drop: 0.6 }), absentBetween(1500, 3000));
    const d = drive(createSquatFlapDetector, m, { durationMs: 4500 });
    const [end] = times(d.events, { kind: 'holdEnd' });
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(1);
    expect(end!).toBeGreaterThanOrEqual(2100);
    expect(end!).toBeLessThan(2300);
    // back and still down: a new glide starts, but nothing was risen, so no flap
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(2);
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
  });
});

describe('levels, low impact and the chair', () => {
  it('low impact: a smaller glide depth flaps on a half squat', () => {
    const half = cycle(1000, 0.3);
    expect(drive(createSquatFlapDetector, half, { durationMs: 3000 }).events).toEqual([]);
    const easy = drive(createSquatFlapDetector, half, { durationMs: 3000, opts: { down: 0.25 } });
    expect(pick(easy.events, { kind: 'rep' })).toHaveLength(1);
  });

  it('sitting down on a chair is the glide and standing up is the flap, with no special case', () => {
    const m = keyframes([[1000, {}], [1700, { drop: 0.9 }], [3200, { drop: 0.9 }], [3700, {}]]);
    const d = drive(createSquatFlapDetector, m, { durationMs: 5000 });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(1);
    const [rep] = pick(d.events, { kind: 'rep' });
    expect(rep!.t).toBeGreaterThan(3200);
    expect(rep!.q!.depth!).toBeCloseTo(0.9, 1);
    // the glide lasts as long as the sitting: bird sinks slowly while the player is down
    expect(chMax(d, 'glide', 1800, 3100)).toBe(1);
  });

  it('flapDepthFor: the level, never more than 60 percent of the deepest warm-up squat', () => {
    expect(flapDepthFor('easy')).toBe(0.35);
    expect(flapDepthFor('normal')).toBe(0.5);
    expect(flapDepthFor('deep')).toBe(0.7);
    expect(flapDepthFor('deep', 0.5)).toBeCloseTo(0.3, 6);
    expect(flapDepthFor('easy', 0.9)).toBe(0.35);
  });
});

describe('form notes are said, never punished', () => {
  it('knees closer together than the feet add knees_in to the flap, which still counts', () => {
    const narrow = (spec: object): Motion => plus(cycle(1000), still({ legL: { out: 0.35 }, legR: { out: 0.35 }, ...spec }));
    const d = drive(createSquatFlapDetector, narrow({}), { durationMs: 3000 });
    const [rep] = pick(d.events, { kind: 'rep' });
    expect(rep).toBeDefined();
    expect(rep!.warn).toContain('knees_in');
    const ok = drive(createSquatFlapDetector, cycle(1000), { durationMs: 3000 });
    expect(pick(ok.events, { kind: 'rep' })[0]!.warn).toBeUndefined();
  });
});

describe('through the real calibrator and One Euro filter, at three pose rates', () => {
  it.each([30, 15, 10])('three flaps at %i Hz give three flaps', (hz) => {
    const m = plus(cycle(500), cycle(2800), cycle(5100));
    const r = replayMotion(m, { detectors: [{ id: 'squat', opts: { flap: 1 } }], durationMs: 7000, hz });
    expect(r.calibratedAt).not.toBeNull();
    const reps = r.events.filter((e) => e.kind === 'rep');
    expect(reps).toHaveLength(3);
    expect(r.events.filter((e) => e.kind === 'holdStart')).toHaveLength(3);
  });

  it('a person standing still gives no events', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'squat', opts: { flap: 1 } }], durationMs: 6000 });
    expect(r.events).toEqual([]);
  });

  it('without flap: 1 the registry still gives the runner its plain squat', () => {
    const r = replayMotion(cycle(500, 0.6, 500, 300, 500), { detectors: [{ id: 'squat' }], durationMs: 3000 });
    expect(r.events.filter((e) => e.kind === 'rep')).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'holdStart')).toHaveLength(0);
  });
});
