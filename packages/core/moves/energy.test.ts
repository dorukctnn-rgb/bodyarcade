// M13 movement energy and the freeze round (Freeze Dance), with a dancing figure drawn by the rig (testing/rig.ts): arms
// swing and the body sways sideways. Synthetic numbers show that the code does what the thresholds say; e0 and e1 are not
// measured on people yet.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { createEnergyDetector, ENERGY_DEFAULTS, FreezeRound } from './energy.ts';
import { chAt, chMax, chMin, drive, pick, replayMotion } from './testing/harness.ts';
import { SHAPE_UPPER, still, type FigureSpec, type Motion } from './testing/rig.ts';

/** Still until `from`, dancing between `from` and `to` (arms swing by armDeg, the body sways by sway T, hz times a second), still again. */
function dances(from: number, to: number, o: { hz?: number; sway?: number; armDeg?: number } = {}): Motion {
  const hz = o.hz ?? 1.5, sway = o.sway ?? 0.15, armDeg = o.armDeg ?? 40;
  return (t) => {
    if (t < from || t > to) return {};
    const s = Math.sin((2 * Math.PI * hz * (t - from)) / 1000);
    const spec: FigureSpec = { dx: sway * s, armL: { a: 70 + armDeg * s, f: 70 + armDeg * s }, armR: { a: 70 - armDeg * s, f: 70 - armDeg * s } };
    return spec;
  };
}

const why = (d: ReturnType<typeof drive>) => {
  if (!canExplain(d.detector)) throw new Error('energy must explain');
  return d.detector.explain();
};

describe('standing still', () => {
  const d = drive(createEnergyDetector, still(), { durationMs: 3000 });

  it('is no energy at all and, after half a second, a freeze', () => {
    expect(chMax(d, 'energy')).toBe(0);
    const starts = pick(d.events, { kind: 'holdStart' });
    expect(starts).toHaveLength(1);
    expect(starts[0]!.t).toBeGreaterThanOrEqual(ENERGY_DEFAULTS.freezeMs);
    expect(starts[0]!.t).toBeLessThan(ENERGY_DEFAULTS.freezeMs + 100);
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(0);
    expect(chAt(d, 'still', 2000)).toBe(1);
    expect(chAt(d, 'still', 100)).toBe(0);
    expect(chAt(d, 'dance', 2000)).toBe(0);
    expect(chAt(d, 'dancing', 2000)).toBe(0);
    expect(chAt(d, 'joints', 2000)).toBe(13);
    expect(d.detector.value()).toBe(0);
    expect(why(d)).toBeNull();
  });
});

describe('dancing', () => {
  const d = drive(createEnergyDetector, dances(0, 6000), { durationMs: 6000 });

  it('reads well over the freeze threshold, and the smoothed energy reads as dancing', () => {
    expect(chMax(d, 'energy', 1000)).toBeGreaterThan(1);
    expect(chMin(d, 'energy', 1000)).toBeGreaterThan(ENERGY_DEFAULTS.e0 * 0.5);     // it dips at every turn of the sway, but not to a freeze
    expect(chAt(d, 'energy.avg', 4000)).toBeGreaterThan(ENERGY_DEFAULTS.e1);
    expect(chAt(d, 'dancing', 4000)).toBe(1);
    expect(chAt(d, 'dance', 4000)).toBe(1);
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(chMax(d, 'still', 600)).toBe(0);
  });

  it('dancing stays on through the dips of each stroke', () => {
    const flicker = d.samples.filter((s) => s.t > 2500).filter((s) => s.ch.dancing === 0);
    expect(flicker).toHaveLength(0);
  });

  it('the upper body and the lower body are told apart: an arm swing alone is all upper', () => {
    const arms = drive(createEnergyDetector, dances(0, 6000, { sway: 0 }), { durationMs: 5000 });
    expect(chAt(arms, 'energy.upper', 3000)).toBeGreaterThan(0.2);
    expect(chMax(arms, 'energy.lower', 500)).toBeLessThan(0.01);
    expect(chMax(arms, 'energy', 500)).toBeLessThan(chMax(arms, 'energy.upper', 500));
  });

  it('a seated player (legs out of the picture) is judged by the joints that show', () => {
    const seated = drive(createEnergyDetector, dances(0, 6000), { durationMs: 4000, shape: SHAPE_UPPER });
    expect(chAt(seated, 'joints', 3000)).toBe(9);                   // nose, shoulders, elbows, hands and hips
    expect(chMax(seated, 'energy.upper', 2500, 3500)).toBeGreaterThan(0.5);
    expect(chAt(seated, 'dancing', 3500)).toBe(1);
  });

  it('joints that are out of view are left out, not counted as standing still', () => {
    const m: Motion = (t) => ({ ...dances(0, 6000)(t), hide: ['hands'] as const });
    const hidden = drive(createEnergyDetector, m, { durationMs: 4000 });
    expect(chAt(hidden, 'joints', 3000)).toBe(11);
  });
});

describe('from dancing to a freeze and back', () => {
  const d = drive(createEnergyDetector, dances(500, 3000), { durationMs: 7000 });

  it('the energy falls under e0 within the window, the freeze starts half a second later and ends when the dance restarts', () => {
    const m = drive(createEnergyDetector, (t) => ({ ...dances(500, 3000)(t), ...dances(5000, 7000)(t) }), { durationMs: 8000 });
    const starts = pick(m.events, { kind: 'holdStart' }), ends = pick(m.events, { kind: 'holdEnd' });
    expect(starts.length).toBeGreaterThanOrEqual(2);                 // the freeze after the first dance, and the one after the second
    expect(starts[0]!.t).toBeGreaterThan(3500);
    expect(starts[0]!.t).toBeLessThan(4300);
    expect(ends[0]!.t).toBeGreaterThanOrEqual(5000);
    expect(ends[0]!.t).toBeLessThan(5500);
    expect(ends[0]!.value!).toBeGreaterThan(1000);
    expect(chAt(d, 'energy', 3600)).toBeLessThan(ENERGY_DEFAULTS.e0);
  });
});

describe('a freeze round (the music stops)', () => {
  /** Dance until `freezeAt`, then stand still; feed the round every sample. */
  function round(freezeAt: number, o: { stopAt?: number; endAt?: number; again?: number; channel?: 'energy' | 'energy.upper' } = {}) {
    const motion: Motion = o.again ? (t) => ({ ...dances(0, freezeAt)(t), ...dances(o.again as number, 9000)(t) }) : dances(0, freezeAt);
    const d = drive(createEnergyDetector, motion, { durationMs: 8000 });
    const r = new FreezeRound({ stopAt: o.stopAt ?? 3000, endAt: o.endAt ?? 6000, ...(o.channel ? { channel: o.channel } : {}) });
    for (const s of d.samples) r.update(s.ch);
    return r;
  }

  it('freezing within half a second of the music stopping, and staying frozen, wins the round', () => {
    const r = round(3000);
    const res = r.result();
    expect(res.frozen).toBe(true);
    expect(res.freezeMs!).toBeGreaterThan(100);
    expect(res.freezeMs!).toBeLessThanOrEqual(500);
    expect(res.caughtAt).toBeNull();
    expect(res.passed).toBe(true);
    expect(r.explain()).toBeNull();
  });

  it('freezing a second late loses it, and the miss says how still the player got', () => {
    const r = round(4100);
    const res = r.result();
    expect(res.frozen).toBe(false);
    expect(res.passed).toBe(false);
    expect(res.lowest).toBeGreaterThan(ENERGY_DEFAULTS.e0);
    const miss = r.explain()!;
    expect(miss.code).toBe('hold_still');
    expect(miss.need).toBe(ENERGY_DEFAULTS.e0);
    expect(miss.got!).toBeGreaterThan(ENERGY_DEFAULTS.e0);
  });

  it('moving again before the music restarts catches the player, with the time and how much they moved', () => {
    const r = round(3000, { again: 5000 });
    const res = r.result();
    expect(res.frozen).toBe(true);
    expect(res.caughtAt).not.toBeNull();
    expect(res.caughtAt!).toBeGreaterThanOrEqual(5000);
    expect(res.caughtAt!).toBeLessThan(5400);
    expect(res.passed).toBe(false);
    const miss = r.explain()!;
    expect(miss.code).toBe('hold_still');
    expect(miss.got!).toBeGreaterThan(ENERGY_DEFAULTS.e0 * ENERGY_DEFAULTS.hyst);
  });

  it('moving again after the round has ended does not matter', () => {
    const r = round(3000, { again: 6500 });
    expect(r.result().passed).toBe(true);
  });

  it('without an end time only the first half second is judged', () => {
    const d = drive(createEnergyDetector, (t) => ({ ...dances(0, 3000)(t), ...dances(4000, 9000)(t) }), { durationMs: 8000 });
    const r = new FreezeRound({ stopAt: 3000 });
    for (const s of d.samples) r.update(s.ch);
    expect(r.result().passed).toBe(true);
  });

  it('the seated dance reads the upper body energy', () => {
    const r = round(3000, { channel: 'energy.upper' });
    expect(r.result().passed).toBe(true);
  });

  it('a round that saw no frame has nothing to explain; reset and repeated frames change nothing', () => {
    const empty = new FreezeRound({ stopAt: 3000 });
    expect(empty.result().passed).toBe(false);
    expect(empty.explain()).toBeNull();
    const d = drive(createEnergyDetector, dances(0, 3000), { durationMs: 5000 });
    const r = new FreezeRound({ stopAt: 3000, endAt: 5000 });
    for (const s of d.samples) for (let k = 0; k < 3; k++) r.update(s.ch);
    expect(r.result().passed).toBe(true);
    r.reset();
    expect(r.result().passed).toBe(false);
    r.update({});
    expect(r.explain()).toBeNull();
  });
});

describe('reset', () => {
  it('forgets the energy, the freeze and the smoothing', () => {
    const d = drive(createEnergyDetector, dances(0, 4000), { durationMs: 3000 });
    d.detector.reset();
    expect(d.detector.channels!()).toEqual({});
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15, 10])('standing still reads far under e0, and is a freeze, at %i Hz', (hz) => {
    const r = replayMotion(still(), { detectors: [{ id: 'energy' }], durationMs: 6000, hz });
    expect(r.calibratedAt).not.toBeNull();
    const after = r.samples.filter((s) => s.t > r.calibratedAt! + 800);
    expect(Math.max(...after.map((s) => s.channels.energy ?? 0))).toBeLessThan(ENERGY_DEFAULTS.e0 / 4);
    expect(r.events.filter((e) => e.kind === 'holdStart')).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'holdEnd')).toHaveLength(0);
  });

  it.each([30, 15, 10])('a dance reads as dancing at %i Hz, then a freeze, then dancing again', (hz) => {
    const m: Motion = (t) => ({ ...dances(0, 3000)(t), ...dances(6000, 9000)(t) });
    const r = replayMotion(m, { detectors: [{ id: 'energy' }], durationMs: 9500, hz });
    const at = (t: number, name: string): number => r.samples.find((s) => s.t >= t + r.calibratedAt! * 0 + 2200)?.channels[name] ?? -1;
    expect(at(2500, 'dancing')).toBe(1);
    expect(at(5000, 'still')).toBe(1);
    expect(at(8500, 'dancing')).toBe(1);
    expect(r.events.filter((e) => e.kind === 'holdStart').length).toBeGreaterThanOrEqual(1);
  });
});
