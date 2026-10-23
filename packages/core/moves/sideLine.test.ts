// M15 side view line (Push Gate, Plank Pilot). The rig draws a standing figure seen from the front, so the side view is
// built here directly as body space Features: a body lying along x, facing right, the ankle at (-2.2, 0), the shoulder at
// (0, 0.35), the hip on the line between them unless `sag` moves it down (negative: up), and an arm of 0.6 + 0.55 T whose
// elbow angle is the number under test. Synthetic numbers show that the code does what the thresholds say; there is no
// recording of a person on the floor behind them (card 23's test gate).
import { describe, expect, it } from 'vitest';
import type { Features } from '../types/index.ts';
import { canExplain } from './kit.ts';
import { bodyLine, createSideLineDetector, SIDE_LINE_DEFAULTS } from './sideLine.ts';
import { feed, pick } from './testing/harness.ts';
import { profileOf, simulate, still } from './testing/rig.ts';

const BASE = simulate(still(), { durationMs: 10 }).features[0] as Features;
const PROFILE = profileOf();

interface Pose { elbow: number; sag?: number; beta?: number; hide?: boolean }

/** One side view frame: elbow = the elbow angle in degrees, sag = how far the hip sits under the line (T), beta = the upper arm tilt from the vertical (degrees: the elbow away from under the shoulder). */
function frame(t: number, p: Pose): Features {
  const A = { x: -2.2, y: 0 }, S = { x: 0, y: 0.35 };
  const H = { x: -1.1, y: 0.175 - (p.sag ?? 0) };
  const beta = ((p.beta ?? 0) * Math.PI) / 180;
  const gamma = beta + ((180 - p.elbow) * Math.PI) / 180;
  const E = { x: S.x + 0.6 * Math.sin(beta), y: S.y - 0.6 * Math.cos(beta) };
  const D = { x: E.x + 0.55 * Math.sin(gamma), y: E.y - 0.55 * Math.cos(gamma) };
  const seen = p.hide ? { ...BASE.seen, hands: false, elbows: false } : BASE.seen;
  return {
    ...BASE, t, seq: Math.round(t / 33), ok: true, seen, shoulder: S, hip: H, shoulders: [S, S], hips: [H, H], ankle: [A, A], elbow: [E, E], hand: [D, D],
  };
}

/** Frames at 30 fps over [0, durationMs) from a time function. */
const frames = (durationMs: number, pose: (t: number) => Pose): Features[] => {
  const out: Features[] = [];
  for (let t = 0; t < durationMs; t += 1000 / 30) out.push(frame(t, pose(t)));
  return out;
};

/** The elbow angle of the push-up over time: down to `low` and back, `count` times from t0, each rep lasting `period` ms. */
const pushups = (t0: number, count: number, period: number, low: number, top = 175) => (t: number): number => {
  const d = t - t0;
  if (d < 0 || d >= count * period) return top;
  const phase = (d % period) / period;
  return top - ((top - low) / 2) * (1 - Math.cos(2 * Math.PI * phase));
};

const make = (opts?: Record<string, number>) => createSideLineDetector(PROFILE, opts);
const why = (d: ReturnType<typeof make>, ms?: number) => {
  if (!canExplain(d)) throw new Error('side line must explain');
  return d.explain(ms);
};
const at = (r: ReturnType<typeof feed>, t: number, name: string): number => r.samples.find((s) => s.t >= t)?.ch[name] ?? Number.NaN;

describe('the body line', () => {
  const A = { x: -2.2, y: 0 }, S = { x: 0, y: 0.35 };
  const hipAt = (sag: number) => ({ x: -1.1, y: 0.175 - sag });

  it('straight is 180, a sagging hip is over 180 and a piked one under it', () => {
    const straight = bodyLine(S, hipAt(0), A);
    expect(straight.interior).toBeCloseTo(180, 3);
    expect(straight.dev).toBeCloseTo(0, 3);
    expect(straight.line).toBeCloseTo(180, 3);
    const sag = bodyLine(S, hipAt(0.2), A);
    expect(sag.dev).toBeGreaterThan(19.5);                                  // about 2 atan(0.2 / 1.1) = 20.6, less because the body slopes
    expect(sag.dev).toBeLessThan(21);
    expect(sag.line).toBeGreaterThan(195);
    const pike = bodyLine(S, hipAt(-0.2), A);
    expect(pike.dev).toBeCloseTo(-sag.dev, 3);
    expect(pike.line).toBeLessThan(165);
  });

  it('facing the other way (a mirrored body) gives the same signs', () => {
    const mirror = (p: { x: number; y: number }) => ({ x: -p.x, y: p.y });
    expect(bodyLine(mirror(S), mirror(hipAt(0.2)), mirror(A)).dev).toBeCloseTo(bodyLine(S, hipAt(0.2), A).dev, 3);
    expect(bodyLine(mirror(S), mirror(hipAt(-0.2)), mirror(A)).dev).toBeLessThan(0);
  });

  it('a near vertical body (the wall level) takes its sign from which way the player faces', () => {
    // standing, leaning to the right: ankle below and behind the shoulder; the hip pushed toward the wall (right) is a sag when facing right
    const ankle = { x: -0.6, y: -2.0 }, shoulder = { x: 0, y: 0.3 }, hipOnLine = { x: -0.3, y: -0.85 };
    const forward = { x: hipOnLine.x + 0.25, y: hipOnLine.y };
    expect(bodyLine(shoulder, forward, ankle, 1).dev).toBeGreaterThan(0);
    expect(bodyLine(shoulder, forward, ankle, -1).dev).toBeLessThan(0);
    expect(bodyLine(shoulder, hipOnLine, ankle, 1).dev).toBeCloseTo(0, 3);
  });
});

describe('push-ups', () => {
  it('three clean push-ups are three reps, counted on the way back up, with the depth and a good form', () => {
    const d = make();
    const r = feed(d, frames(8000, (t) => ({ elbow: pushups(1000, 3, 1800, 85)(t) })));
    const reps = pick(r.events, { kind: 'rep' });
    expect(reps).toHaveLength(3);
    expect(reps[0]!.id).toBe('sideLine');
    expect(reps[0]!.q!.depth!).toBeCloseTo(85, 0);
    expect(reps[0]!.q!.range!).toBeCloseTo(95, 0);
    expect(reps.map((e) => e.value)).toEqual([1, 1, 1]);
    expect(reps[0]!.warn).toBeUndefined();
    expect(reps[0]!.t).toBeGreaterThan(2400);                         // up again after the first 1.8 s cycle (from 1000)
    expect(reps[0]!.t).toBeLessThan(2900);
    expect(at(r, 1900, 'elbow')).toBeLessThan(100);
    expect(at(r, 500, 'elbow')).toBeCloseTo(175, 0);
    expect(at(r, 500, 'line')).toBeCloseTo(180, 1);
    expect(at(r, 500, 'form')).toBe(1);
    expect(r.samples.at(-1)!.ch.reps).toBe(3);
    expect(d.value()).toBeCloseTo(180, 1);
    expect(why(d)).toBeNull();
  });

  it('a push-up that does not get down to 100 degrees is no rep: "move more", with the angle it reached', () => {
    const d = make();
    const r = feed(d, frames(5000, (t) => ({ elbow: pushups(1000, 2, 1800, 125)(t) })));
    expect(pick(r.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('move_more');
    expect(miss.got!).toBeCloseTo(125, 0);
    expect(miss.need).toBe(SIDE_LINE_DEFAULTS.downDeg);
  });

  it('the wall and the incline need only 110: the same depth counts with downDeg 110', () => {
    const m = (t: number) => ({ elbow: pushups(1000, 2, 1800, 106)(t) });
    expect(pick(feed(make(), frames(5500, m)).events, { kind: 'rep' })).toHaveLength(0);
    expect(pick(feed(make({ downDeg: 110 }), frames(5500, m)).events, { kind: 'rep' })).toHaveLength(2);
  });

  it('a sagging hip makes a rep that does not pass its form: value 0, the hip sag warning, and the miss says hips up', () => {
    const d = make();
    const r = feed(d, frames(5000, (t) => ({ elbow: pushups(1000, 2, 1800, 85)(t), sag: 0.25 })));
    const reps = pick(r.events, { kind: 'rep' });
    expect(reps).toHaveLength(2);
    expect(reps.map((e) => e.value)).toEqual([0, 0]);
    expect(reps[0]!.warn).toEqual(['hip_sag']);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('hips_not_up');
    expect(miss.got!).toBeGreaterThan(195);
    expect(at(r, 1900, 'dev')).toBeGreaterThan(20);
    expect(at(r, 1900, 'form')).toBe(0);
  });

  it('a piked hip is a rep without form, and the miss says hips down', () => {
    const d = make();
    const r = feed(d, frames(5000, (t) => ({ elbow: pushups(1000, 2, 1800, 85)(t), sag: -0.25 })));
    const reps = pick(r.events, { kind: 'rep' });
    expect(reps.map((e) => e.value)).toEqual([0, 0]);
    expect(reps[0]!.warn).toBeUndefined();
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('hips_not_low');
    expect(miss.got!).toBeLessThan(165);
  });

  it('only the first rep sags: values 0 then 1 (the form is judged per rep)', () => {
    const r = feed(make(), frames(5500, (t) => ({ elbow: pushups(1000, 2, 1800, 85)(t), sag: t < 2800 ? 0.25 : 0 })));
    expect(pick(r.events, { kind: 'rep' }).map((e) => e.value)).toEqual([0, 1]);
  });

  it('two top positions without going down are no rep, and the first frames of a session start nothing', () => {
    const r = feed(make(), frames(4000, () => ({ elbow: 172 })));
    expect(pick(r.events, { kind: 'rep' })).toHaveLength(0);
  });

  it('holding the bottom (the giant pushes back) is a hold with the time, when bottomHoldMs is set', () => {
    const bottomHeld = (t: number): number => (t < 1000 ? 175 : t < 1600 ? 175 - ((t - 1000) / 600) * 90 : t < 3600 ? 85 : t < 4200 ? 85 + ((t - 3600) / 600) * 90 : 175);
    const r = feed(make({ bottomHoldMs: 1000 }), frames(6000, (t) => ({ elbow: bottomHeld(t) })));
    const [start] = pick(r.events, { kind: 'holdStart' }), [end] = pick(r.events, { kind: 'holdEnd' });
    expect(start).toBeDefined();
    expect(start!.t).toBeGreaterThan(2400);
    expect(start!.t).toBeLessThan(2800);
    expect(end!.value!).toBeGreaterThan(1800);
    expect(pick(r.events, { kind: 'rep' })).toHaveLength(1);
    const off = feed(make(), frames(6000, (t) => ({ elbow: bottomHeld(t) })));
    expect(pick(off.events, { kind: 'holdStart' })).toHaveLength(0);
  });

  it('elbows and hands out of view: no rep, and the miss says so', () => {
    const d = make();
    const r = feed(d, frames(5000, (t) => ({ elbow: pushups(1000, 2, 1800, 85)(t), hide: true })));
    expect(pick(r.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)!.code).toBe('hands_out_of_view');
  });
});

describe('the plank', () => {
  const opts = { plank: 1 };

  it('a straight body with the elbows under the shoulders for a second is a hold; losing the form ends it, with the time in form', () => {
    const d = make(opts);
    const r = feed(d, frames(7000, (t) => ({ elbow: 90, sag: t < 4000 ? 0 : 0.35 })));
    const [start] = pick(r.events, { kind: 'holdStart' }), [end] = pick(r.events, { kind: 'holdEnd' });
    expect(start!.t).toBeGreaterThanOrEqual(1000);
    expect(start!.t).toBeLessThan(1200);
    expect(start!.value!).toBeCloseTo(180, 0);
    expect(end!.t).toBeGreaterThan(4300);
    expect(end!.t).toBeLessThan(4700);
    expect(end!.value!).toBeGreaterThan(3700);                      // the whole time in form, from the first frame
    expect(end!.value!).toBeLessThan(4200);
    expect(at(r, 2000, 'held')).toBeGreaterThan(900);
    expect(at(r, 2000, 'form')).toBe(1);
    expect(at(r, 6000, 'form')).toBe(0);
    expect(at(r, 6000, 'held')).toBe(0);
  });

  it('165 to 195 is straight: a hip 8 degrees off is in form, one 30 degrees off is not, and the miss says which way', () => {
    const inForm = feed(make(opts), frames(3000, () => ({ elbow: 90, sag: 0.07 })));      // about 7 degrees
    expect(pick(inForm.events, { kind: 'holdStart' })).toHaveLength(1);
    const sag = make(opts);
    const s = feed(sag, frames(3000, () => ({ elbow: 90, sag: 0.3 })));
    expect(pick(s.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(why(sag)!.code).toBe('hips_not_up');
    const pike = make(opts);
    const p = feed(pike, frames(3000, () => ({ elbow: 90, sag: -0.3 })));
    expect(pick(p.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(why(pike)!.code).toBe('hips_not_low');
  });

  it('elbows more than 0.25 T away from under the shoulders are not in form, and the miss names the elbow', () => {
    const d = make(opts);
    const r = feed(d, frames(3000, () => ({ elbow: 90, beta: 30 })));                         // 0.6 sin 30 = 0.3 T away
    expect(pick(r.events, { kind: 'holdStart' })).toHaveLength(0);
    const miss = why(d)!;
    expect(miss.code).toBe('limb_off');
    expect(miss.limb).toBe('elbow');
    expect(miss.got!).toBeCloseTo(0.3, 1);
    expect(miss.need).toBe(SIDE_LINE_DEFAULTS.elbowUnder);
    expect(at(r, 2000, 'elbowShift')).toBeCloseTo(0.3, 1);
  });

  it('a wobble of the form shorter than the grace time keeps the hold', () => {
    const r = feed(make(opts), frames(5000, (t) => ({ elbow: 90, sag: t > 3000 && t < 3250 ? 0.35 : 0 })));
    expect(pick(r.events, { kind: 'holdStart' })).toHaveLength(1);
    expect(pick(r.events, { kind: 'holdEnd' })).toHaveLength(0);
  });

  it('push-ups are not counted in plank mode, and reset forgets everything', () => {
    const d = make(opts);
    const r = feed(d, frames(5000, (t) => ({ elbow: pushups(1000, 2, 1800, 85)(t) })));
    expect(pick(r.events, { kind: 'rep' })).toHaveLength(0);
    d.reset();
    expect(d.channels!()).toEqual({});
    expect(d.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});
