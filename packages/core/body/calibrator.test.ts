// Calibrator v2: time-based and rate-aware (B7, rule 4 of code-audit 11.4), framing codes, and real traces.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CalibrationStatus, Landmark, PoseFrame, Trace } from '../types/index.ts';
import { LM } from '../types/index.ts';
import { combine, squatAt, synthTrace } from '../pose/synth.ts';
import { parseTrace, traceFrames } from '../pose/trace.ts';
import { createCalibrator } from './calibrator.ts';

const still = (seconds: number, extra: Parameters<typeof synthTrace>[0] extends infer O ? Partial<O> : never = {}): Trace =>
  synthTrace({ id: 'still', durationMs: seconds * 1000, fps: 30, seed: 11, jitterMs: 3, ...extra });

const realTrace = (name: string): Trace => parseTrace(JSON.parse(readFileSync(new URL(`../../../tests/traces/video/${name}.trace.json`, import.meta.url), 'utf8')));

/** Feeds frames until ready; returns the time it took and every status seen. */
function run(frames: PoseFrame[], framing: 'full' | 'upper' | 'side' = 'full', opts = {}) {
  const c = createCalibrator({ now: () => 1_700_000_000_000 });
  c.begin(framing, opts);
  const seen: CalibrationStatus[] = [];
  for (const f of frames) {
    const s = c.push(f);
    seen.push(s);
    if (s.ready) return { c, seen, readyAt: f.t - (frames[0]?.t ?? 0) };
  }
  return { c, seen, readyAt: null as number | null };
}

const edit = (frames: PoseFrame[], fn: (lm: Landmark[]) => void): PoseFrame[] =>
  frames.map((f) => { if (f.landmarks) fn(f.landmarks); return f; });

describe('B7: calibration finishes on time at any pose rate', () => {
  it.each([30, 10, 4])('a still person at %i Hz is calibrated in about the hold time', (hz) => {
    const { c, readyAt, seen } = run(traceFrames(still(5), { hz }));
    expect(readyAt).not.toBeNull();
    expect(readyAt!).toBeGreaterThanOrEqual(1000);
    expect(readyAt!).toBeLessThanOrEqual(1000 + 1000 / hz + 1);
    const p = c.profile()!;
    expect(p.T).toBeCloseTo(0.2, 2);
    expect(p.W).toBeCloseTo(0.16, 2);
    expect(p.U).toBeCloseTo(0.9 * 0.2, 2);
    expect(p.A).toBeGreaterThan(0.2);
    expect(p.hz).toBeCloseTo(hz, 0);
    expect(p).toMatchObject({ v: 2, framing: 'full', capturedAt: 1_700_000_000_000 });
    expect(p.aspect).toBeCloseTo(4 / 3);
    // progress never goes back while holding still, and the last status says ok
    const prog = seen.map((s) => s.progress);
    for (let i = 1; i < prog.length; i++) expect(prog[i]!).toBeGreaterThanOrEqual(prog[i - 1]!);
    expect(seen.at(-1)).toMatchObject({ ready: true, code: 'ok', progress: 1 });
  });

  it('at 2 Hz it waits for the minimum of 5 samples instead of the hold time alone', () => {
    const { readyAt } = run(traceFrames(still(6), { hz: 2 }));
    expect(readyAt).toBe(2000);
  });

  it('a device that delivers a frame every 10 s reports too_slow after 20 s instead of waiting for ever', () => {
    const { seen, readyAt } = run(traceFrames(still(31), { hz: 0.1 }));
    expect(readyAt).toBeNull();
    expect(seen.at(-1)?.code).toBe('too_slow');
    expect(seen.at(-1)?.hz).toBeLessThan(1);
  });

  it('a fast device with a person who never stands still keeps asking to hold still (no too_slow)', () => {
    const moving = synthTrace({ id: 'moving', durationMs: 25000, fps: 30, seed: 2, motion: (t) => ({ drop: 0.3 + 0.3 * Math.sin(t / 150) }) });
    const { seen, readyAt } = run(traceFrames(moving));
    expect(readyAt).toBeNull();
    expect(seen.some((s) => s.code === 'too_slow')).toBe(false);
    expect(seen.at(-1)?.code).toMatch(/move_still|hold/);
  });
});

describe('framing', () => {
  it('nobody in view: no_person', () => {
    const frames = traceFrames(synthTrace({ id: 'empty', durationMs: 2000, motion: () => ({ absent: true }) }));
    expect(run(frames).seen.at(-1)?.code).toBe('no_person');
  });

  it('hips out of view: hips_out; head cut off: head_out', () => {
    const hips = edit(traceFrames(still(2)), (lm) => { lm[LM.leftHip]!.visibility = 0.1; lm[LM.rightHip]!.visibility = 0.1; });
    expect(run(hips).seen.at(-1)?.code).toBe('hips_out');
    const head = edit(traceFrames(still(2)), (lm) => { lm[LM.nose]!.visibility = 0.1; });
    expect(run(head).seen.at(-1)?.code).toBe('head_out');
  });

  it('full framing needs knees and feet; upper framing does not', () => {
    const noFeet = edit(traceFrames(still(3)), (lm) => { lm[LM.leftAnkle]!.visibility = 0.1; lm[LM.rightAnkle]!.visibility = 0.1; });
    expect(run(noFeet, 'full').seen.at(-1)?.code).toBe('feet_out');
    const noKnees = edit(traceFrames(still(3)), (lm) => { lm[LM.leftKnee]!.visibility = 0.1; });
    expect(run(noKnees, 'full').seen.at(-1)?.code).toBe('knees_out');
    const upper = run(edit(traceFrames(still(3)), (lm) => { for (const i of [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle]) lm[i]!.visibility = 0.1; }), 'upper');
    expect(upper.readyAt).not.toBeNull();
    expect(upper.c.profile()?.U).toBeUndefined();
  });

  it('too close: shoulders wider than 45% of the image, or the body taller than the frame', () => {
    const wide = traceFrames(still(2, { shape: { W: 0.66, T: 0.2 } }));
    expect(run(wide).seen.at(-1)?.code).toBe('too_close');
    const tall = traceFrames(still(2, { shape: { T: 0.29, hipY: 0.46 } }));   // nose 0.04 to ankles 0.98: 94% of the height
    expect(run(tall).seen.at(-1)?.code).toBe('too_close');
  });

  it('too far: a tiny figure', () => {
    const tiny = traceFrames(still(2, { shape: { T: 0.05, W: 0.04, hipY: 0.5 } }));
    expect(run(tiny, 'full').seen.at(-1)?.code).toBe('too_far');
    expect(run(tiny, 'upper').seen.at(-1)?.code).toBe('too_far');
  });

  it('moving during the hold restarts it: move_still, then calibrated once still', () => {
    const t = synthTrace({ id: 'squat-then-still', durationMs: 5000, fps: 30, seed: 4, motion: combine(squatAt(300, 0.6, 500, 200, 500)) });
    const { seen, readyAt } = run(traceFrames(t));
    expect(seen.some((s) => s.code === 'move_still')).toBe(true);
    expect(readyAt!).toBeGreaterThan(1500 + 1000 - 150);   // the hold counts from when the body is still again
  });

  it('reset() and begin() start again', () => {
    const frames = traceFrames(still(3));
    const { c } = run(frames);
    expect(c.profile()).not.toBeNull();
    c.reset();
    expect(c.profile()).toBeNull();
    c.begin('upper');
    let ready = false;
    for (const f of traceFrames(still(3), { t0: 10_000 })) if (c.push(f).ready) { ready = true; break; }
    expect(ready).toBe(true);
    expect(c.profile()?.framing).toBe('upper');
  });
});

describe('real recordings', () => {
  it.each([30, 10, 4])('a real person standing (U.S. Army clip) calibrates at %i Hz', (hz) => {
    const t = realTrace('army-standing-12s');
    const { c, readyAt } = run(traceFrames(t, { hz }));
    expect(readyAt).not.toBeNull();
    expect(readyAt!).toBeLessThan(1000 + 2000 / hz + 300);
    const p = c.profile()!;
    expect(p.T).toBeGreaterThan(0.08);
    expect(p.W / p.T).toBeGreaterThan(0.4);
    expect(p.W / p.T).toBeLessThan(1.2);
    expect(p.aspect).toBeCloseTo(16 / 9, 2);
  });

  it('jumping jacks never pass for a still stance', () => {
    const t = realTrace('jacks-burpees-21s');
    const first3s = traceFrames(t).filter((f) => f.t < 3000);
    expect(run(first3s).readyAt).toBeNull();
  });
});
