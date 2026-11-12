// The 360 mode step by step (coordinator, 11 Nov): no photo while the person turns, a photo after one still second in the
// direction asked for, then a preview that waits for "retake" or "continue". Synthetic bodies (synth-turn.ts); the real
// clips are in angle.real.test.ts.
import { describe, expect, it } from 'vitest';
import { angleDiff, type Bucket } from './angle.ts';
import { Capture, driftOf, STEP_RULES } from './capture.ts';
import { stepTurnFrames, turnFrames } from './synth-turn.ts';
import type { Landmark } from '../../types/index.ts';

const aspect = 16 / 9;

/** Plays frames into a 360 capture like the page: each photo that waits is answered at once ("continue"), or retaken once. */
function play(frames: readonly { t: number; deg: number; lm: Landmark[] }[], o: { retakeFirst?: boolean } = {}) {
  const cap = new Capture('full');
  const taken: { bucket: Bucket; t: number; deg: number }[] = [];
  const cues = new Set<string | null>();
  let retook = false, maxHold = 0;
  for (const f of frames) {
    const s = cap.push({ t: f.t, lm: f.lm, aspect, sharp: 1 });
    cues.add(s.cue);
    maxHold = Math.max(maxHold, s.step?.hold ?? 0);
    if (s.justPending !== null) {
      expect(s.step?.pending).toBe(s.justPending);
      expect(s.cue).toBe('check');
      if (o.retakeFirst && !retook) { retook = true; cap.retake(); continue; }
      taken.push({ bucket: s.justPending, t: f.t, deg: f.deg });
      cap.accept();
    }
  }
  return { cap, taken, cues, maxHold };
}

describe('360 step by step', () => {
  it('stopping at each direction takes the eight photos, each within 15 degrees of its direction, in turn order', () => {
    const { frames } = stepTurnFrames({ stopS: 2, degPerS: 45, seed: 31 });
    const { cap, taken, cues } = play(frames);
    expect(cap.isDone()).toBe(true);
    expect(taken.map((x) => x.bucket)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    for (const x of taken) expect(angleDiff(x.deg, x.bucket), `${x.bucket}`).toBeLessThanOrEqual(15);
    expect(cues.has('hold')).toBe(true);
    expect(cues.has('turn-to')).toBe(true);
  });

  it('turning the other way first: front left is asked for next, then left side, and so on', () => {
    const { frames } = stepTurnFrames({ stopS: 2, degPerS: 45, seed: 32, dir: -1 });
    const { cap, taken } = play(frames);
    expect(cap.isDone()).toBe(true);
    expect(taken.map((x) => x.bucket)).toEqual([0, 315, 270, 225, 180, 135, 90, 45]);
    for (const x of taken) expect(angleDiff(x.deg, x.bucket)).toBeLessThanOrEqual(15);
  });

  it('every photo is taken at a stop (the last steps into a front or back may count toward the hold), within 10 degrees', () => {
    const { frames, stops } = stepTurnFrames({ stopS: 2.2, degPerS: 40, seed: 33 });
    const { taken } = play(frames);
    expect(taken.length).toBe(8);
    for (const x of taken) {
      const stop = stops.find((s) => x.t >= s.from - 300 && x.t <= s.to);
      expect(stop, `${x.bucket} at ${x.t}`).toBeDefined();
      expect(stop!.deg).toBe(x.bucket);
      expect(angleDiff(x.deg, x.bucket)).toBeLessThanOrEqual(10);
      expect(x.t - stop!.from).toBeGreaterThanOrEqual(STEP_RULES.holdMs - 400);
    }
  });

  it('a continuous turn, slow or quick, takes no diagonal photo', () => {
    for (const degPerS of [10, 15, 24, 40]) {
      const { taken } = play(turnFrames({ seconds: 380 / degPerS, degPerS, seed: 34, stillS: 0.1 }));
      expect(taken.filter((x) => x.bucket % 90 !== 0), `${degPerS} deg/s`).toEqual([]);
      for (const x of taken) expect(angleDiff(x.deg, x.bucket), `${degPerS} deg/s ${x.bucket}`).toBeLessThanOrEqual(15);
    }
  });

  it('a stop that is too short (under a second) takes nothing; the hold bar shows how far it got', () => {
    const { frames } = stepTurnFrames({ stopS: 0.6, firstStopS: 0.6, degPerS: 45, seed: 35 });
    const { taken, maxHold } = play(frames);
    expect(taken).toEqual([]);
    expect(maxHold).toBeGreaterThan(0);
    expect(maxHold).toBeLessThan(1);
  });

  it('retake drops the photo and asks for the same direction; it is taken again while the person holds still', () => {
    const { frames } = stepTurnFrames({ stopS: 2, firstStopS: 4, degPerS: 45, seed: 36 });
    const { cap, taken } = play(frames, { retakeFirst: true });
    expect(taken[0]?.bucket).toBe(0);
    expect(cap.isDone()).toBe(true);
  });

  it('while a photo waits, nothing else is taken and the cue is "check"', () => {
    const cap = new Capture('full');
    const { frames } = stepTurnFrames({ stopS: 2, degPerS: 45, seed: 37 });
    let waited = 0;
    for (const f of frames) {
      const s = cap.push({ t: f.t, lm: f.lm, aspect, sharp: 1 });
      if (cap.pending) { waited++; expect(s.cue).toBe('check'); expect(s.filled).toEqual([]); }
    }
    expect(waited).toBeGreaterThan(30);
    expect(cap.result).toEqual([]);
  });

  it('take it anyway waits on the preview for the direction asked for', () => {
    const cap = new Capture('full');
    for (const f of turnFrames({ seconds: 0.5, degPerS: 0, seed: 38 })) cap.push({ t: f.t, lm: f.lm, aspect, sharp: 1 });
    expect(cap.force()).toBe(0);
    expect(cap.pending?.forced).toBe(true);
    expect(cap.result).toEqual([]);
    expect(cap.accept()).toBe(0);
    expect(cap.result.map((s) => s.bucket)).toEqual([0]);
    expect(cap.push({ t: 600, lm: turnFrames({ seconds: 0, degPerS: 0, seed: 39 })[0]!.lm, aspect }).step?.targets).toEqual([45, 315]);
  });

  it('the review retake of one direction asks for it again; continue goes back to done', () => {
    const { frames } = stepTurnFrames({ stopS: 2, degPerS: 45, seed: 40 });
    const { cap } = play(frames);
    cap.clear(135);
    expect(cap.isDone()).toBe(false);
    expect(cap.push({ t: 1e6, lm: frames[0]!.lm, aspect }).step?.targets).toEqual([135]);
    // the person turns from the front to the back right again (the turn order brings the tracker there)
    const again = stepTurnFrames({ stopS: 2, firstStopS: 0.5, degPerS: 45, seed: 41 });
    const until = again.stops.find((x) => x.deg === 135)!.to;
    for (const f of again.frames.filter((x) => x.t <= until)) {
      const s = cap.push({ t: 2e6 + f.t, lm: f.lm, aspect, sharp: 1 });
      if (s.justPending !== null) cap.accept();
    }
    expect(cap.isDone()).toBe(true);
  });

  it('the quick mode is unchanged: no step state, it fills on a continuous turn', () => {
    const cap = new Capture('quick');
    let s = null as ReturnType<Capture['push']> | null;
    for (const f of turnFrames({ seconds: 20, degPerS: 18, seed: 9 })) s = cap.push({ t: f.t, lm: f.lm, aspect, sharp: 1 });
    expect(s?.step).toBeNull();
    expect(cap.isDone()).toBe(true);
  });

  it('drift: a slow drift shows, a frame-to-frame jitter does not', () => {
    expect(driftOf([0.5, 0.52, 0.48, 0.51, 0.49, 0.5, 0.52, 0.48])).toBeLessThan(0.02);
    expect(driftOf(Array.from({ length: 30 }, (_, i) => 0.6 - i * 0.005))).toBeGreaterThan(0.1);
    expect(driftOf([1, 2])).toBe(0);
  });
});
