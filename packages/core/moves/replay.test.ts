// Replay tests for the runner's three movements (code-audit 11.8 task 7) with today's thresholds:
// jump 0.20 T, crouch full at 0.55 T, lean 0.30 / 0.16 W.
// Synthetic traces carry exact labels; the real ones check calibration and false alarms. Synthetic results show
// the code does what the thresholds say, not that the thresholds suit real bodies (that needs labelled recordings).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MovementEvent, Trace, TraceLabel } from '../types/index.ts';
import { combine, jumpAt, leanAt, squatAt, synthTrace } from '../pose/synth.ts';
import { parseTrace, traceFrames } from '../pose/trace.ts';
import { replay, scoreEvents } from './replay.ts';

const JUMPS = [3000, 4500, 6000];
const SQUAT = 8000;           // 0.6 T deep: a squat obstacle (crouch 0.7 and more)
const LEAN_R = 11000;
const LEAN_L = 13500;
const DUCK = 16000;           // 0.3 T: a duck obstacle (crouch 0.4 to 0.7), not a squat rep

function session(seed: number): Trace {
  const labels: TraceLabel[] = [
    ...JUMPS.map((t): TraceLabel => ({ t, id: 'jump', kind: 'rep' })),
    { t: SQUAT + 600 + 300 + 600, id: 'squat', kind: 'rep' },
    { t: LEAN_R, id: 'lean', kind: 'holdStart', side: 'R' },
    { t: LEAN_L, id: 'lean', kind: 'holdStart', side: 'L' },
  ];
  return synthTrace({
    id: 'runner-moves', durationMs: 18500, fps: 30, seed, noise: 0.002, jitterMs: 4, labels,
    motion: combine(
      ...JUMPS.map((t) => jumpAt(t, 0.45, 450)),
      squatAt(SQUAT, 0.6, 600, 300, 600),
      leanAt(LEAN_R, 0.5, 300, 900, 300),
      leanAt(LEAN_L, -0.5, 300, 900, 300),
      squatAt(DUCK, 0.3, 400, 400, 400),
    ),
  });
}

const of = (events: MovementEvent[], id: string, kind?: string): MovementEvent[] => events.filter((e) => e.id === id && (!kind || e.kind === kind));

describe.each([
  [30, 150],
  [15, 200],
  [10, 250],
])('synthetic session at %i Hz', (hz, maxDelay) => {
  const trace = session(hz);
  const r = replay(traceFrames(trace, { hz }));
  const between = (t0: number, t1: number, ch: string): number[] => r.samples.filter((s) => s.t >= t0 && s.t <= t1).map((s) => s.channels[ch] ?? 0);

  it('calibrates in the first seconds', () => {
    expect(r.calibratedAt).not.toBeNull();
    expect(r.calibratedAt!).toBeLessThan(2000);
  });

  it(`every jump is found once, within ${maxDelay} ms, and nothing else counts as a jump`, () => {
    const s = scoreEvents(r.events, trace.labels, { id: 'jump', kind: 'rep', maxDelayMs: maxDelay });
    expect(s.misses).toEqual([]);
    expect(s.extra).toEqual([]);
    expect(Math.max(...s.delays)).toBeLessThanOrEqual(maxDelay);
  });

  it('the deep squat is one rep and drives crouch to 1; the duck reaches duck level only', () => {
    const reps = of(r.events, 'squat', 'rep');
    expect(reps).toHaveLength(1);
    expect(reps[0]!.q!.depth!).toBeGreaterThan(0.5);
    expect(Math.max(...between(SQUAT + 500, SQUAT + 1000, 'crouch'))).toBe(1);
    const duck = Math.max(...between(DUCK, DUCK + 1200, 'crouch'));
    expect(duck).toBeGreaterThanOrEqual(0.4);
    expect(duck).toBeLessThan(0.7);
  });

  it('leans move one lane each way and come back; no lane change elsewhere', () => {
    const starts = of(r.events, 'lean', 'holdStart');
    expect(starts.map((e) => e.side)).toEqual(['R', 'L']);
    expect(scoreEvents(r.events, trace.labels, { id: 'lean', kind: 'holdStart', maxDelayMs: 400 }).recall).toBe(1);
    expect(of(r.events, 'lean', 'holdEnd').map((e) => e.side)).toEqual(['R', 'L']);
    expect(Math.max(...between(LEAN_R + 400, LEAN_R + 1100, 'lane'))).toBe(1);
    expect(Math.min(...between(LEAN_L + 400, LEAN_L + 1100, 'lane'))).toBe(-1);
    expect(between(2000, LEAN_R, 'lane').every((l) => l === 0)).toBe(true);
    expect(between(LEAN_L + 2500, 18500, 'lane').every((l) => l === 0)).toBe(true);
  });
});

describe('tracking lost', () => {
  it('after 0.6 s without a person, lane and crouch return to neutral and the jump re-arms', () => {
    const t = synthTrace({
      id: 'lost', durationMs: 9000, fps: 30, seed: 3, noise: 0.002,
      motion: combine(leanAt(3000, 0.5, 200, 3000, 200), squatAt(3000, 0.6, 300, 2000, 300), (tm) => (tm > 3800 && tm < 5000 ? { absent: true } : {})),
    });
    const r = replay(traceFrames(t));
    const at = (t0: number) => r.samples.find((s) => s.t >= t0)!;
    expect(at(3700).channels.lane).toBe(1);
    expect(at(3700).channels.crouch).toBe(1);
    expect(at(4600).ok).toBe(false);
    expect(at(4600).channels.lane).toBe(0);
    expect(at(4600).channels.crouch).toBe(0);
    expect(of(r.events, 'lean', 'holdEnd')).toHaveLength(2);   // one for the lost tracking, one after the lean ends
  });
});

describe('real recordings', () => {
  const real = (name: string): Trace => parseTrace(JSON.parse(readFileSync(new URL(`../../../tests/traces/video/${name}.trace.json`, import.meta.url), 'utf8')));

  it.each([30, 10, 4])('a person standing still (U.S. Army clip) at %i Hz: calibrated, then no movement events at all', (hz) => {
    const r = replay(traceFrames(real('army-standing-12s'), { hz }));
    expect(r.calibratedAt).not.toBeNull();
    expect(r.samples.length).toBeGreaterThan(hz * 8);
    expect(r.events).toEqual([]);
    expect(r.samples.every((s) => s.channels.lane === 0 && (s.channels.crouch ?? 0) < 0.2)).toBe(true);
    expect(Math.max(...r.samples.map((s) => Math.abs(s.f.rise)))).toBeLessThan(0.1);
  });

  it('jumping jacks and burpees: the pipeline runs end to end (unlabelled, counts are reported)', () => {
    // No still stance of 1.2 s in this clip; a 0.5 s hold finds the stand between burpees.
    const r = replay(traceFrames(real('jacks-burpees-21s')), { calibration: { holdSeconds: 0.5 } });
    expect(r.calibratedAt).not.toBeNull();
    const finite = r.samples.every((s) => Object.values(s.channels).every(Number.isFinite));
    expect(finite).toBe(true);
    const count = (id: string, kind: string) => of(r.events, id, kind).length;
    const summary = { calibratedAt: r.calibratedAt, jumps: count('jump', 'rep'), squats: count('squat', 'rep'), leanR: of(r.events, 'lean', 'holdStart').filter((e) => e.side === 'R').length, leanL: of(r.events, 'lean', 'holdStart').filter((e) => e.side === 'L').length };
    console.log('jacks-burpees-21s with today\'s thresholds:', JSON.stringify(summary));
    expect(summary.squats).toBeGreaterThan(0);                 // every burpee goes down to the floor
    expect(Math.max(...r.samples.map((s) => s.channels.crouch ?? 0))).toBe(1);
  });
});
