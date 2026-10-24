// Calibration on real recordings of a person, through the real pose model (tests/traces/video, SOURCES.txt):
//   - army-standing-12s and army-full-near-6s: the whole body, about 3.5 m and 2.5 m from the camera;
//   - army-seated-6s: head to hips (sitting back from the camera), the knees under the picture;
//   - army-desk-near-6s: head and shoulders like a laptop camera at a desk, the hips under the picture (Doruk, 24 Oct:
//     "kamera hips'i algılamadı"): the real model gives the hips a visibility of 0.02 there;
//   - army-stepback-12s: the same person from the desk framing to the whole body over six seconds, as if they walked back.
// The desk, seated and step-back clips are the public-domain drill filmed by the U.S. Army, cropped and zoomed with ffmpeg and
// then run through the model frame by frame (the model sees real pixels of a real person at that framing). No synthetic body here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CalibrationStatus, Framing, PoseFrame, Trace } from '../types/index.ts';
import { LM } from '../types/index.ts';
import { parseTrace, traceFrames } from '../pose/trace.ts';
import { createCalibrator } from './calibrator.ts';
import { distanceM } from './guidance.ts';

const realTrace = (name: string): Trace => parseTrace(JSON.parse(readFileSync(new URL(`../../../tests/traces/video/${name}.trace.json`, import.meta.url), 'utf8')));

function run(frames: PoseFrame[], want: Framing, opts: Parameters<ReturnType<typeof createCalibrator>['begin']>[1] = {}) {
  const c = createCalibrator({ now: () => 1_700_000_000_000 });
  c.begin(want, opts);
  const seen: { s: CalibrationStatus; t: number }[] = [];
  const t0 = frames[0]?.t ?? 0;
  for (const f of frames) {
    const s = c.push(f);
    seen.push({ s, t: f.t - t0 });
    if (s.ready) return { c, seen, readyAt: f.t - t0, last: s };
  }
  return { c, seen, readyAt: null as number | null, last: (seen.at(-1) as { s: CalibrationStatus }).s };
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] as number; };
const visibilityOf = (t: Trace, i: number): number => median(traceFrames(t).filter((f) => f.landmarks).map((f) => (f.landmarks as { visibility: number }[])[i]!.visibility));

describe('a person at a desk (head and shoulders, hips under the picture)', () => {
  const desk = realTrace('army-desk-near-6s');

  it('the real model reports the hips of this picture as not visible, and below the picture: why the old calibration never finished', () => {
    expect(visibilityOf(desk, LM.leftHip)).toBeLessThan(0.1);
    expect(visibilityOf(desk, LM.rightHip)).toBeLessThan(0.1);
    expect(visibilityOf(desk, LM.leftShoulder)).toBeGreaterThan(0.9);
    expect(visibilityOf(desk, LM.nose)).toBeGreaterThan(0.9);
    const f = traceFrames(desk).find((x) => x.landmarks)!;
    expect(f.landmarks![LM.leftHip]!.y).toBeGreaterThan(1);
  });

  it('a game that needs the upper body starts after the one second hold with the desk profile (torso from the shoulders)', () => {
    const r = run(traceFrames(desk), 'upper');
    expect(r.readyAt).not.toBeNull();
    expect(r.readyAt!).toBeGreaterThanOrEqual(1000);
    expect(r.readyAt!).toBeLessThan(1100);
    expect(r.c.profile()).toMatchObject({ kind: 'upper', framing: 'upper', hipsEstimated: true });
    expect(r.last).toMatchObject({ ready: true, outcome: 'measured', profile: 'upper', supports: { full: false, upper: true, seated: true, side: false } });
    // the torso length estimated from the shoulder width, as the profile says
    const p = r.c.profile()!;
    expect(p.T / p.W).toBeCloseTo(1.45, 2);
  });

  it.each([15, 10, 4])('the same at %i Hz (a phone is slower than a laptop)', (hz) => {
    const r = run(traceFrames(desk, { hz }), 'upper');
    expect(r.readyAt).not.toBeNull();
    expect(r.readyAt!).toBeLessThan(1000 + 2000 / hz + 200);
  });

  it('a game that wants the whole body: says how many steps back while it waits, and takes the desk profile on its own after 3.5 s', () => {
    const r = run(traceFrames(desk), 'full');
    expect(r.readyAt!).toBeGreaterThanOrEqual(3500);
    expect(r.readyAt!).toBeLessThan(3700);
    expect(r.last).toMatchObject({ ready: true, outcome: 'fallback', profile: 'upper' });
    expect(r.c.profile()).toMatchObject({ kind: 'upper', hipsEstimated: true });
    const waiting = r.seen.filter((x) => !x.s.ready && x.t > 500);
    expect(waiting.length).toBeGreaterThan(80);
    for (const { s } of waiting) {
      expect(['too_close', 'hips_out']).toContain(s.code);
      expect(s.hint).toMatchObject({ action: 'step_back' });
      expect(s.hint!.steps!.min).toBeGreaterThanOrEqual(2);       // a desk is about half a metre from the camera, the body wants about 2.5 m
      expect(s.supports).toEqual({ full: false, upper: true, seated: true, side: false });
      expect(s.seen).toMatchObject({ head: true, shoulders: true, hips: false });
    }
    // the screen can count it down
    const left = waiting.map((x) => x.s.fallbackInMs).filter((v): v is number => v !== undefined);
    expect(left.length).toBeGreaterThan(50);
    expect(left.at(-1)!).toBeLessThan(150);
  });

  it('"play at the desk" a moment in: it ends with the same profile at once', () => {
    const frames = traceFrames(desk);
    const c = createCalibrator();
    c.begin('full');
    for (const f of frames.filter((x) => x.t <= 1500)) c.push(f);
    expect(c.accept()).toBe(true);
    expect(c.profile()).toMatchObject({ kind: 'upper', hipsEstimated: true });
  });

  it('a game without a seated variant is never taken at the desk; it keeps asking', () => {
    const r = run(traceFrames(desk), 'full', { fallback: false });
    expect(r.readyAt).toBeNull();
    expect(r.last.code).toMatch(/^(too_close|hips_out)$/);
  });

  it('the hands-up check at a desk: a person who does not raise them is not held for ever (headroom unchecked after 6 s)', () => {
    // the clip is 6 s, so run it twice over for the wait to pass (the same still person)
    const frames = traceFrames(desk);
    const looped: PoseFrame[] = [...frames, ...frames.map((f) => ({ ...f, t: f.t + 6034, seq: f.seq + frames.length }))];
    const r = run(looped, 'upper', { headroom: 'arms-up' });
    expect(r.readyAt).not.toBeNull();
    expect(r.c.profile()).toMatchObject({ kind: 'upper', headroom: 'unchecked' });
    expect(r.readyAt!).toBeGreaterThanOrEqual(7000);
    expect(r.readyAt!).toBeLessThan(7100);
  });
});

describe('a person sitting back from the camera (head to hips)', () => {
  const seated = realTrace('army-seated-6s');

  it('the seated profile is measured, the torso is real (not estimated), upper-body games start after the hold', () => {
    const r = run(traceFrames(seated), 'upper');
    expect(r.readyAt!).toBeGreaterThanOrEqual(1000);
    expect(r.readyAt!).toBeLessThan(1100);
    expect(r.c.profile()).toMatchObject({ kind: 'seated', framing: 'upper' });
    expect(r.c.profile()!.hipsEstimated).toBeUndefined();
    expect(r.last).toMatchObject({ outcome: 'measured', supports: { full: false, upper: true, seated: true } });
  });

  it('a whole-body game: the knees are the missing part, one or two steps back, and the seated profile is taken after 3.5 s', () => {
    const r = run(traceFrames(seated), 'full');
    const first = r.seen.find((x) => x.s.code !== 'no_person')!.s;
    expect(first).toMatchObject({ code: 'knees_out', hint: { action: 'step_back' } });
    expect(first.hint!.steps!.max).toBeLessThanOrEqual(2);
    expect(r.readyAt!).toBeGreaterThanOrEqual(3500);
    expect(r.readyAt!).toBeLessThan(3700);
    expect(r.last).toMatchObject({ outcome: 'fallback', profile: 'seated' });
  });
});

describe('a person at 2.5 m and at 3.5 m (the whole body)', () => {
  it.each(['army-full-near-6s', 'army-standing-12s'])('%s: the full profile after one second for a whole-body game and for an upper-body one, no hint needed', (name) => {
    const t = realTrace(name);
    for (const want of ['full', 'upper'] as const) {
      const r = run(traceFrames(t), want);
      expect(r.readyAt!).toBeGreaterThanOrEqual(1000);
      expect(r.readyAt!).toBeLessThan(1100);
      expect(r.c.profile()).toMatchObject({ kind: 'full', framing: want });
      expect(r.last).toMatchObject({ outcome: 'measured', supports: { full: true, upper: true, seated: true, side: false } });
      expect(r.seen.every((x) => x.s.code === 'hold' || x.s.code === 'ok')).toBe(true);
    }
  });

  it('the distance estimate from the shoulders is in the right region: about 2.5 m and 3.5 m', () => {
    const near = run(traceFrames(realTrace('army-full-near-6s')), 'full').c.profile()!;
    const far = run(traceFrames(realTrace('army-standing-12s')), 'full').c.profile()!;
    expect(distanceM(near.W)).toBeGreaterThan(2.2);
    expect(distanceM(near.W)).toBeLessThan(3.2);
    expect(distanceM(far.W)).toBeGreaterThan(3.0);
    expect(distanceM(far.W)).toBeLessThan(4.2);
  });
});

describe('a person who walks back from the desk to the whole body (zoom out over six seconds)', () => {
  const walk = realTrace('army-stepback-12s');

  it('a whole-body game: the profile goes from head and shoulders through head to hips to the whole body, full games unlock when it is there, and the fallback never cuts the walk short', () => {
    const r = run(traceFrames(walk), 'full');
    expect(r.readyAt).not.toBeNull();
    expect(r.last).toMatchObject({ outcome: 'measured', profile: 'full', supports: { full: true } });
    expect(r.c.profile()).toMatchObject({ kind: 'full', framing: 'full' });
    // the profile on the screen only gets better as the person walks back
    const order = ['upper', 'seated', 'full'];
    const profiles = r.seen.map((x) => x.s.profile).filter((p): p is NonNullable<typeof p> => !!p);
    const ranks = profiles.map((p) => order.indexOf(p));
    expect(new Set(profiles)).toEqual(new Set(order));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]! - 0);   // never goes back down once it was up
    // whole-body games are locked until the whole body is in view
    const unlocked = r.seen.findIndex((x) => x.s.supports?.full);
    expect(unlocked).toBeGreaterThan(0);
    for (const x of r.seen.slice(0, unlocked)) expect(x.s.supports?.full).toBeFalsy();
    expect(r.seen[unlocked]!.t).toBeGreaterThan(5000);                  // the whole body is only in view late in the walk
    // the advice shrinks as the person gets closer to the right distance
    const steps = r.seen.filter((x) => x.s.hint?.action === 'step_back' && x.s.hint.steps).map((x) => x.s.hint!.steps!.max);
    expect(steps[0]!).toBeGreaterThanOrEqual(2);
    expect(steps.at(-1)!).toBeLessThanOrEqual(steps[0]!);
    // done within a second or two of stopping (the zoom ends at 8 s), with the profile measured at the new distance
    expect(r.readyAt!).toBeGreaterThan(7000);
    expect(r.readyAt!).toBeLessThan(10_000);
    expect(r.c.profile()!.T).toBeLessThan(0.3);                         // far, not the desk's torso of 0.87
  });

  it('an upper-body game does not wait for the walk: the desk profile after one second', () => {
    const r = run(traceFrames(walk), 'upper');
    expect(r.readyAt!).toBeGreaterThanOrEqual(1000);
    expect(r.readyAt!).toBeLessThan(1100);
    expect(r.c.profile()).toMatchObject({ kind: 'upper', hipsEstimated: true });
  });
});
