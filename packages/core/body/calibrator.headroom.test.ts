// A game that raises the hands overhead (manifest headroom 'arms-up', Summit Climb): after the body fits and has been held,
// the player raises both hands once and the picture must hold them. It never blocks: a wait limit, "play on", and a
// player who steps back to make room is measured again. Synthetic figures (core/pose/synth.ts).
import { describe, expect, it } from 'vitest';
import { LM, type BodyProfile, type CalibrationStatus, type Framing, type Landmark, type PoseFrame } from '../types/index.ts';
import { DESK_SHAPE, FULL_SHAPE, armsUpAt, synthFrames, type BodyShape, type Motion } from '../pose/synth.ts';
import { createCalibrator } from './calibrator.ts';
import { HEADROOM } from './headroom.ts';

type Cal = ReturnType<typeof createCalibrator>;
interface Run { c: Cal; seen: CalibrationStatus[]; times: number[]; readyAt: number | null; last: CalibrationStatus; profile: BodyProfile | null }

function run(frames: PoseFrame[], want: Framing, opts: Parameters<Cal['begin']>[1] = {}): Run {
  const c = createCalibrator({ now: () => 1_700_000_000_000 });
  c.begin(want, { headroom: 'arms-up', ...opts });
  const seen: CalibrationStatus[] = [], times: number[] = [];
  const t0 = frames[0]?.t ?? 0;
  for (const f of frames) {
    const s = c.push(f);
    seen.push(s); times.push(f.t - t0);
    if (s.ready) return { c, seen, times, readyAt: f.t - t0, last: s, profile: c.profile() };
  }
  return { c, seen, times, readyAt: null, last: seen[seen.length - 1] as CalibrationStatus, profile: c.profile() };
}

/** Closer to the camera, the hands go out of the picture. Shoulders at y 0.22, torso 0.3. */
const TIGHT: BodyShape = { cx: 0.5, hipY: 0.52, T: 0.3, W: 0.24, aspect: 4 / 3 };

const still = (shape: BodyShape, seconds: number, motion?: Motion, extra: Partial<Parameters<typeof synthFrames>[0]> = {}): PoseFrame[] =>
  synthFrames({ durationMs: seconds * 1000, shapeAt: () => shape, seed: 5, ...(motion ? { motion } : {}), ...extra });

const codes = (r: Run): string[] => [...new Set(r.seen.map((s) => s.code))];

describe('room above: the hands go up and the picture holds them', () => {
  it('hold of one second, then "raise your hands", then about 0.4 s of hands up: ready, headroom ok, the reach height recorded', () => {
    const r = run(still(FULL_SHAPE, 6, armsUpAt(1300, 400, 4000, 400)), 'full');
    expect(r.readyAt).not.toBeNull();
    expect(r.readyAt!).toBeGreaterThan(1300 + 150);
    expect(r.readyAt!).toBeLessThan(2500);
    expect(r.profile).toMatchObject({ framing: 'full', kind: 'full', headroom: 'ok' });
    expect(r.profile!.reachY).toBeGreaterThan(0.02);
    expect(r.profile!.reachY).toBeLessThan(r.profile!.rest.shoulderY - 0.6 * r.profile!.T);
    expect(r.last).toMatchObject({ ready: true, code: 'ok', progress: 1, outcome: 'measured', headroom: 'ok', profile: 'full' });
    expect(codes(r)).toEqual(expect.arrayContaining(['hold', 'raise_hands', 'ok']));
    expect(codes(r)).not.toContain('headroom');
  });

  it('the hold fills the first 60% of the progress, the hands the rest, and it never goes back', () => {
    const r = run(still(FULL_SHAPE, 6, armsUpAt(2000, 400, 4000, 400)), 'full');
    const hold = r.seen.filter((s) => s.code === 'hold' || s.code === 'move_still');
    expect(Math.max(...hold.map((s) => s.progress))).toBeLessThanOrEqual(0.6 + 1e-9);
    const hands = r.seen.filter((s) => s.code === 'raise_hands');
    expect(hands.length).toBeGreaterThan(10);
    expect(hands[0]!.hint).toEqual({ action: 'raise_hands' });
    for (const s of hands) expect(s.progress).toBeGreaterThanOrEqual(0.6 - 1e-9);
    const p = r.seen.map((s) => s.progress);
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThanOrEqual(p[i - 1]! - 1e-9);
  });

  it('a game without the flag is untouched: ready after the hold, nothing about hands', () => {
    const c = createCalibrator();
    c.begin('full');
    let s: CalibrationStatus | null = null;
    for (const f of still(FULL_SHAPE, 3)) { s = c.push(f); if (s.ready) break; }
    expect(s).toMatchObject({ ready: true, code: 'ok' });
    expect(s!.headroom).toBeUndefined();
    expect(c.profile()!.headroom).toBeUndefined();
  });

  it('side framing never asks for the hands', () => {
    const c = createCalibrator();
    c.begin('side', { headroom: 'arms-up' });
    const seen = new Set<string>();
    for (const f of still(FULL_SHAPE, 3)) seen.add(c.push(f).code);
    expect(seen.has('raise_hands')).toBe(false);
  });
});

describe('never blocks', () => {
  it('a player who never raises the hands: the wait ends the calibration with headroom unchecked', () => {
    const r = run(still(FULL_SHAPE, 12), 'full');
    expect(r.readyAt!).toBeGreaterThanOrEqual(1000 + HEADROOM.waitSeconds * 1000);
    expect(r.readyAt!).toBeLessThan(1000 + HEADROOM.waitSeconds * 1000 + 100);
    expect(r.profile).toMatchObject({ kind: 'full', headroom: 'unchecked' });
    expect(r.profile!.reachY).toBeUndefined();
    expect(r.last).toMatchObject({ ready: true, outcome: 'measured', headroom: 'unchecked' });
    const waiting = r.seen.filter((s) => !s.ready && s.code === 'raise_hands');
    expect(waiting.length).toBeGreaterThan(100);
    expect(codes(r)).not.toContain('headroom');
  });

  it('the wait can be set: 2 s', () => {
    const r = run(still(FULL_SHAPE, 8), 'full', { headroomWaitSeconds: 2 });
    expect(r.readyAt!).toBeGreaterThanOrEqual(3000);
    expect(r.readyAt!).toBeLessThan(3100);
  });

  it('"play on" during the hands step ends it at once with what is measured', () => {
    const frames = still(FULL_SHAPE, 8);
    const c = createCalibrator();
    c.begin('full', { headroom: 'arms-up' });
    for (const f of frames.filter((x) => x.t <= 1500)) c.push(f);
    expect(c.profile()).toBeNull();
    expect(c.accept()).toBe(true);
    expect(c.profile()).toMatchObject({ kind: 'full', headroom: 'unchecked' });
    expect(c.push(frames.find((x) => x.t > 1600) as PoseFrame)).toMatchObject({ ready: true, code: 'ok', headroom: 'unchecked' });
  });

  it('"play on" before the hold is over takes the first steady spell and skips the hands step', () => {
    const frames = still(FULL_SHAPE, 8);
    const c = createCalibrator();
    c.begin('full', { headroom: 'arms-up' });
    for (const f of frames.filter((x) => x.t <= 150)) c.push(f);
    expect(c.accept()).toBe(false);                               // not a steady spell yet
    let readyAt: number | null = null;
    for (const f of frames.filter((x) => x.t > 150)) if (c.push(f).ready) { readyAt = f.t; break; }
    expect(readyAt!).toBeLessThan(700);
    expect(c.profile()).toMatchObject({ headroom: 'unchecked' });
  });
});

describe('no room: the picture cuts the hands', () => {
  // The body fits in the picture for the seated profile (the feet are below it); the hands go out at the top.
  it('the code says so with a measured hint, and the wait ends with headroom short (the game plays on)', () => {
    const r = run(still(TIGHT, 12, armsUpAt(1500, 400, 9000, 400)), 'upper');
    expect(codes(r)).toEqual(expect.arrayContaining(['hold', 'raise_hands', 'headroom']));
    const cut = r.seen.filter((s) => s.code === 'headroom');
    expect(cut.length).toBeGreaterThan(50);
    for (const s of cut.slice(10)) {
      expect(s.hint).toMatchObject({ action: 'step_back' });
      expect(s.hint!.steps!.min).toBeGreaterThanOrEqual(1);
      expect(s.hint!.steps!.max).toBeLessThanOrEqual(2);
      expect(s.progress).toBeLessThan(0.7);
    }
    expect(r.readyAt!).toBeGreaterThanOrEqual(1000 + HEADROOM.waitSeconds * 1000);
    expect(r.profile).toMatchObject({ headroom: 'short' });
    expect(r.profile!.reachY).toBeUndefined();
    expect(r.last).toMatchObject({ ready: true, outcome: 'measured', headroom: 'short' });
  });

  it('the measured hint stays one steady range while the estimate wobbles around a whole number of steps', () => {
    const r = run(still(TIGHT, 8, armsUpAt(1500, 400, 9000, 400), { noise: 0.004 }), 'upper', { headroomWaitSeconds: 5 });
    const ranges = new Set(r.seen.filter((s) => s.code === 'headroom').map((s) => `${s.hint!.steps!.min}-${s.hint!.steps!.max}`));
    expect(ranges.size).toBe(1);
  });

  it('a lost wrist inside the picture is a cut too (the model does not find the hand)', () => {
    const frames = still(FULL_SHAPE, 9, armsUpAt(1500, 400, 9000, 400)).map((f) => {
      if (f.t < 1700 || !f.landmarks) return f;
      const lm: Landmark[] = f.landmarks.map((p, i) => (i === LM.rightWrist ? { ...p, visibility: 0.1 } : p));
      return { ...f, landmarks: lm };
    });
    const r = run(frames, 'full');
    expect(codes(r)).toContain('headroom');
    expect(r.profile).toMatchObject({ headroom: 'short' });
  });

  it('a desk (head and shoulders): the hands go far out of the picture, more steps back are asked', () => {
    const r = run(still(DESK_SHAPE, 12, armsUpAt(1500, 400, 9000, 400)), 'upper');
    const cut = r.seen.filter((s) => s.code === 'headroom');
    expect(cut.length).toBeGreaterThan(30);
    expect(cut.at(-1)!.hint).toMatchObject({ action: 'step_back' });
    expect(cut.at(-1)!.hint!.steps!.max).toBeGreaterThanOrEqual(2);
    expect(r.profile).toMatchObject({ kind: 'upper', hipsEstimated: true, headroom: 'short' });
  });

  it('a player who steps back as told is measured again and passes: the profile is the new distance', () => {
    // 0-3 s close (hands cut); from 3 s the same person is further back (the shoulders 33% narrower), hands still up
    const frames = synthFrames({ durationMs: 9000, shapeAt: (t) => (t < 3000 ? TIGHT : FULL_SHAPE), motion: armsUpAt(1500, 400, 9000, 400), seed: 6 });
    const r = run(frames, 'upper');
    const at = (code: string): number => r.times[r.seen.findIndex((s) => s.code === code)] as number;
    expect(at('headroom')).toBeLessThan(3000);
    const restartIdx = r.seen.findIndex((s, i) => r.times[i]! >= 3000 && (s.code === 'hold' || s.code === 'move_still'));
    expect(restartIdx).toBeGreaterThan(-1);
    expect(r.seen[restartIdx]!.progress).toBeLessThan(0.3);        // the hold starts from the beginning
    expect(r.readyAt!).toBeGreaterThan(3000 + 900);
    expect(r.readyAt!).toBeLessThan(HEADROOM.waitSeconds * 1000 + 1000);
    expect(r.profile).toMatchObject({ headroom: 'ok' });
    expect(r.profile!.T).toBeCloseTo(FULL_SHAPE.T, 1);
    expect(r.profile!.W).toBeCloseTo(FULL_SHAPE.W, 1);
  });

  it('the wait is counted from the first time the body fit, not from each new hold: stepping about does not extend it', () => {
    const frames = synthFrames({ durationMs: 12_000, shapeAt: (t) => (Math.floor(t / 2500) % 2 === 0 ? TIGHT : { ...TIGHT, T: 0.26, W: 0.208, hipY: 0.5 }), motion: armsUpAt(1500, 400, 12_000, 400), seed: 7 });
    const r = run(frames, 'upper');
    expect(r.readyAt).not.toBeNull();
    expect(r.readyAt!).toBeLessThanOrEqual(1000 + HEADROOM.waitSeconds * 1000 + 100);
  });
});

describe('full-body games at a desk, with the hands-up check', () => {
  it('the desk profile is taken after 3.5 s, then the hands step runs its wait: the whole thing is over within 10 s', () => {
    const r = run(still(DESK_SHAPE, 14), 'full');
    expect(r.readyAt!).toBeGreaterThanOrEqual(3500 + HEADROOM.waitSeconds * 1000);
    expect(r.readyAt!).toBeLessThan(3600 + HEADROOM.waitSeconds * 1000);
    expect(r.profile).toMatchObject({ kind: 'upper', hipsEstimated: true, headroom: 'unchecked' });
    expect(r.last.outcome).toBe('fallback');
  });

  it('"play at the desk" on the hands step skips the rest of the wait', () => {
    const frames = still(DESK_SHAPE, 10);
    const c = createCalibrator();
    c.begin('full', { headroom: 'arms-up' });
    for (const f of frames.filter((x) => x.t <= 4200)) c.push(f);
    expect(c.accept()).toBe(true);
    expect(c.profile()).toMatchObject({ kind: 'upper', headroom: 'unchecked' });
  });
});
