// The audio clock: callbacks run in order when the audio clock reaches them, never while it is stopped, the page clock
// maps onto the audio clock for tap judging, the latency comes from calibration or from the browser, and the tap-along
// calibration recovers a known offset from noisy taps and refuses to trust erratic ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../loop/rng.ts';
import { createAudioClock, createLatencyCalibrator, judgeTapMs, type AudioClockKit, type ClockSource } from './clock.ts';

class Src implements ClockSource {
  currentTime = 0;
  state = 'running';
  baseLatency: number | undefined = 0.01;
  outputLatency: number | undefined = 0.025;
  perf = 5000;      // the page clock at contextTime (below)
  ctxAtPerf = 0;
  getOutputTimestamp(): { contextTime?: number; performanceTime?: number } { return { contextTime: this.ctxAtPerf, performanceTime: this.perf }; }
  advance(sec: number): void { this.currentTime += sec; }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Moves both the audio clock and the page timers, the way real time does. */
function run(src: Src, seconds: number, step = 0.004): void {
  for (let t = 0; t < seconds - 1e-9; t += step) { src.advance(step); vi.advanceTimersByTime(step * 1000); }
}

describe('schedule', () => {
  it('runs callbacks in time order when the audio clock gets there, and not before', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src });
    const seen: string[] = [];
    clock.schedule(0.5, () => seen.push('b'));
    clock.schedule(0.2, () => seen.push('a'));
    clock.schedule(0.5, () => seen.push('c'));      // same time as b: after it
    run(src, 0.19);
    expect(seen).toEqual([]);
    run(src, 0.02);
    expect(seen).toEqual(['a']);
    run(src, 0.4);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(clock.pending).toBe(0);
  });

  it('a callback is never later than a tick and never earlier than a few ms', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src, tickMs: 12 });
    const lateness: number[] = [];
    for (let i = 1; i <= 40; i++) { const t = i * 0.0731; clock.schedule(t, () => lateness.push((src.currentTime - t) * 1000)); }
    run(src, 3.2, 0.001);
    expect(lateness.length).toBe(40);
    expect(Math.min(...lateness)).toBeGreaterThanOrEqual(-4.1);
    expect(Math.max(...lateness)).toBeLessThanOrEqual(13);
  });

  it('holds callbacks while the context is not running and releases them when it is', () => {
    const src = new Src();
    src.state = 'suspended';
    const clock = createAudioClock({ source: src });
    let n = 0;
    clock.schedule(0, () => n++);
    clock.schedule(0.1, () => n++);
    vi.advanceTimersByTime(500);
    expect(n).toBe(0);
    expect(clock.running).toBe(false);
    src.state = 'running';
    src.currentTime = 0.2;
    vi.advanceTimersByTime(30);
    expect(n).toBe(2);
  });

  it('waits for a context that does not exist yet', () => {
    let src: Src | null = null;
    const clock = createAudioClock({ source: () => src });
    let n = 0;
    clock.schedule(0.1, () => n++);
    expect(clock.now()).toBe(0);
    expect(clock.latencyMs).toBe(0);
    vi.advanceTimersByTime(100);
    expect(n).toBe(0);
    src = new Src();
    src.currentTime = 1;
    vi.advanceTimersByTime(30);
    expect(n).toBe(1);
  });

  it('cancel removes a callback, and the ticker stops when nothing is waiting (no timer left running)', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src });
    let n = 0;
    const off = clock.scheduleCancelable(1, () => n++);
    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(clock.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    run(src, 2);
    expect(n).toBe(0);
    clock.schedule(2.1, () => n++);
    run(src, 0.5);
    expect(n).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a callback that throws does not stop the others, and the error is reported', () => {
    const src = new Src();
    const errors: unknown[] = [];
    const clock = createAudioClock({ source: src, onError: (e) => errors.push(e) });
    const seen: number[] = [];
    clock.schedule(0.1, () => { throw new Error('boom'); });
    clock.schedule(0.1, () => seen.push(1));
    run(src, 0.2);
    expect(seen).toEqual([1]);
    expect(errors.length).toBe(1);
  });

  it('a callback may schedule another', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src });
    const seen: number[] = [];
    const beat = (n: number): void => { seen.push(n); if (n < 5) clock.schedule(src.currentTime + 0.1, () => beat(n + 1)); };
    clock.schedule(0.1, () => beat(1));
    run(src, 1);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('dispose drops everything and later calls do nothing', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src });
    let n = 0;
    clock.schedule(0.1, () => n++);
    clock.dispose();
    clock.schedule(0.1, () => n++);
    run(src, 1);
    expect(n).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('time and latency', () => {
  it('now() is the audio clock', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src });
    src.currentTime = 12.5;
    expect(clock.now()).toBe(12.5);
  });

  it('the page clock maps onto the audio clock through the context\'s own pairing', () => {
    const src = new Src();
    src.baseLatency = undefined; src.outputLatency = undefined;      // nothing reported: the pairing alone
    src.ctxAtPerf = 10;
    src.perf = 20_000;
    const clock = createAudioClock({ source: src });
    expect(clock.fromPerformance(20_000)).toBeCloseTo(10, 9);
    expect(clock.fromPerformance(20_250)).toBeCloseTo(10.25, 9);
    expect(clock.fromPerformance(19_900)).toBeCloseTo(9.9, 9);
  });

  it('the pairing is of what is HEARD, so the reported latency is added to get render time (the base of now and schedule)', () => {
    const src = new Src();                      // 10 ms base + 25 ms output
    src.ctxAtPerf = 10;
    src.perf = 20_000;
    const clock = createAudioClock({ source: src });
    expect(clock.fromPerformance(20_000)).toBeCloseTo(10.035, 9);
    // a player in exact time with the sound they hear: their tap is the note's time plus the latency, and judges as zero
    const note = 12;
    const heardAt = 20_000 + (note - 10) * 1000;      // page time at which the speakers play the note
    expect(judgeTapMs(clock, heardAt, note)).toBeCloseTo(0, 6);
  });

  it('without a pairing it uses "now" on both clocks', () => {
    const src = new Src();
    src.getOutputTimestamp = () => ({});
    src.currentTime = 4;
    const clock = createAudioClock({ source: src, perfNow: () => 8000 });
    expect(clock.fromPerformance(8000)).toBeCloseTo(4, 9);
    expect(clock.fromPerformance(7500)).toBeCloseTo(3.5, 9);
  });

  it('latency is what the browser reports until a calibration says otherwise; Safari reports nothing', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src });
    expect(clock.latencyMs).toBeCloseTo(35, 9);
    expect(clock.reportedMs).toBeCloseTo(35, 9);
    clock.setCalibratedMs(88);
    expect(clock.latencyMs).toBe(88);
    expect(clock.calibratedMs).toBe(88);
    clock.setCalibratedMs(null);
    expect(clock.latencyMs).toBeCloseTo(35, 9);
    src.baseLatency = undefined; src.outputLatency = undefined;
    expect(clock.latencyMs).toBe(0);
  });

  it('a calibrated figure is kept within sane limits and refuses NaN', () => {
    const clock = createAudioClock({ source: new Src() });
    clock.setCalibratedMs(99999);
    expect(clock.latencyMs).toBe(1000);
    clock.setCalibratedMs(-99999);
    expect(clock.latencyMs).toBe(-500);
    clock.setCalibratedMs(NaN);
    expect(clock.calibratedMs).toBeNull();
  });
});

describe('judging a tap', () => {
  const clock = (): { c: AudioClockKit; src: Src } => {
    const src = new Src();
    src.baseLatency = undefined; src.outputLatency = undefined;      // the browser reports nothing; the calibration says 60 ms
    src.ctxAtPerf = 3; src.perf = 3000;
    const c = createAudioClock({ source: src });
    c.setCalibratedMs(60);
    return { c, src };
  };

  it('a tap that lands exactly one latency after the note is on time', () => {
    const { c } = clock();
    expect(judgeTapMs(c, 3000 + 5 * 1000 + 60, 8)).toBeCloseTo(0, 6);
  });

  it('early is negative and late is positive', () => {
    const { c } = clock();
    expect(judgeTapMs(c, 8000 + 60 - 40, 8)).toBeCloseTo(-40, 6);
    expect(judgeTapMs(c, 8000 + 60 + 55, 8)).toBeCloseTo(55, 6);
  });
});

describe('latency calibration', () => {
  /** A player who taps `offset` ms after each click, with noise, and sometimes slips. */
  function simulate(opts: { offset: number; noise: number; seed?: number; skip?: number[]; slips?: number[]; taps?: number }): { result: ReturnType<ReturnType<typeof createLatencyCalibrator>['result']>; clicks: number[] } {
    const src = new Src();
    src.ctxAtPerf = 0; src.perf = 0;
    const clock = createAudioClock({ source: src });
    const rng = mulberry32(opts.seed ?? 1);
    const clicks: number[] = [];
    const cal = createLatencyCalibrator({ clock, click: (t) => clicks.push(t), beats: opts.taps ?? 8 });
    const times = cal.start();
    times.forEach((t, i) => {
      if (opts.skip?.includes(i)) return;
      const slip = opts.slips?.includes(i) ? 250 : 0;
      const noise = (rng() + rng() + rng() - 1.5) * 2 * opts.noise;
      cal.tap(t * 1000 + opts.offset + noise + slip);
    });
    return { result: cal.result(), clicks };
  }

  it('schedules every click at the right audio times, a lead apart and an interval from each other', () => {
    const { clicks } = simulate({ offset: 0, noise: 0 });
    expect(clicks.length).toBe(8);
    expect(clicks[0]).toBeCloseTo(1, 9);
    for (let i = 1; i < clicks.length; i++) expect(clicks[i]! - clicks[i - 1]!).toBeCloseTo(0.8, 9);
  });

  it.each([-30, 0, 45, 90, 160, 240, 300])('recovers an offset of %i ms within 15 ms from noisy taps', (offset) => {
    const { result } = simulate({ offset, noise: 15 });
    expect(result.ok).toBe(true);
    expect(Math.abs(result.offsetMs - offset)).toBeLessThan(15);
    expect(result.taps).toBeGreaterThanOrEqual(7);
  });

  it('survives missed beats and one slip, and the slip does not move the answer', () => {
    const clean = simulate({ offset: 70, noise: 12, skip: [1, 5] });
    const slipped = simulate({ offset: 70, noise: 12, skip: [1, 5], slips: [3] });
    expect(clean.result.ok).toBe(true);
    expect(slipped.result.ok).toBe(true);
    expect(Math.abs(slipped.result.offsetMs - clean.result.offsetMs)).toBeLessThan(10);
    expect(slipped.result.taps).toBeLessThanOrEqual(clean.result.taps);
  });

  it('refuses to trust too few taps', () => {
    const r = simulate({ offset: 50, noise: 10, skip: [0, 1, 2, 3, 4] }).result;
    expect(r.taps).toBe(3);
    expect(r.ok).toBe(false);
  });

  it('refuses to trust erratic taps (a spread over the limit)', () => {
    const r = simulate({ offset: 50, noise: 140, seed: 4 }).result;
    expect(r.spreadMs).toBeGreaterThan(45);
    expect(r.ok).toBe(false);
  });

  it('a tap far from any click is not counted, and each click counts once', () => {
    const src = new Src();
    src.ctxAtPerf = 0; src.perf = 0;
    const clock = createAudioClock({ source: src });
    const cal = createLatencyCalibrator({ clock, click: () => undefined });
    cal.start();                                  // clicks at 1.0, 1.8, ...
    expect(cal.tap(1400)).toBeNull();             // exactly between two clicks
    expect(cal.tap(1050)).toBeCloseTo(50, 6);
    expect(cal.tap(1070)).toBeNull();             // the same click again
    expect(cal.tap(100)).toBeNull();              // long before the first
    expect(cal.result().taps).toBe(1);
  });

  it('without a start there is nothing to tap against', () => {
    const clock = createAudioClock({ source: new Src() });
    const cal = createLatencyCalibrator({ clock, click: () => undefined });
    expect(cal.tap(1000)).toBeNull();
    expect(cal.result()).toMatchObject({ ok: false, taps: 0 });
    expect(cal.done()).toBe(false);
  });

  it('is done a beat after the last click', () => {
    const src = new Src();
    const clock = createAudioClock({ source: src });
    const cal = createLatencyCalibrator({ clock, click: () => undefined });
    cal.start();
    src.currentTime = 1 + 7 * 0.8;
    expect(cal.done()).toBe(false);
    src.currentTime = 1 + 7 * 0.8 + 0.81;
    expect(cal.done()).toBe(true);
  });
});
