// The audio clock and the latency calibration (for rhythm games and anything that must line up with sound).
//
// Two clocks exist in a browser: the audio hardware clock (AudioContext.currentTime, steady, what the player hears) and
// the page's own timers (jittery, tens of milliseconds). A rhythm game must judge a tap against the audio clock, and
// must know how late the sound reaches the ear. So:
// - now() is the audio clock, and schedule(t, cb) calls back once the audio clock reaches t (good to a frame, not to a
//   sample; for sample-accurate sound use AudioKit.playAt);
// - fromPerformance(ms) turns an input event's timeStamp (performance.now milliseconds) into audio-clock seconds, using
//   the context's own pairing of the two clocks (render time, the same base as now() and schedule());
// - latencyMs is how late a played sound is HEARD plus how late a tap is SEEN, as far as it is known: a tap-along
//   calibration (LatencyCalibrator) measures the whole offset the player feels; before that, the output latency the
//   browser reports (baseLatency + outputLatency; Safari reports neither, so 0 until calibrated).
import type { AudioClock } from '../types/index.ts';

export interface ClockSource {
  readonly currentTime: number;
  readonly state: string;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

export interface AudioClockKit extends AudioClock {
  /** The context is running, so now() advances. */
  readonly running: boolean;
  /** Audio-clock seconds for a performance.now() time in milliseconds (an input event's timeStamp). */
  fromPerformance(ms: number): number;
  /** Like schedule, but returns a function that cancels the callback. */
  scheduleCancelable(t: number, cb: () => void): () => void;
  /** The offset the player feels, in ms, from calibration (null: not calibrated, the browser's own figure is used). */
  setCalibratedMs(ms: number | null): void;
  readonly calibratedMs: number | null;
  /** What the browser says the output takes, ms (0 where it says nothing). */
  readonly reportedMs: number;
  /** Callbacks still waiting. */
  readonly pending: number;
  dispose(): void;
}

export interface ClockOptions {
  /** The audio context, or a function that gives it once it exists (null before). */
  source: ClockSource | (() => ClockSource | null);
  /** performance.now, injectable. */
  perfNow?: () => number;
  /** How often the queue is looked at, ms. Default 12 (a callback is at most this late on a busy page). */
  tickMs?: number;
  /** A callback is run up to this many seconds early so that it is not late. Default 0.004. */
  earlySec?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  onError?: (e: unknown) => void;
}

interface Item { t: number; cb: () => void; seq: number }

export function createAudioClock(o: ClockOptions): AudioClockKit {
  const get = (): ClockSource | null => (typeof o.source === 'function' ? o.source() : o.source);
  const perfNow = o.perfNow ?? ((): number => performance.now());
  const tickMs = o.tickMs ?? 12;
  const early = o.earlySec ?? 0.004;
  const setI = o.setInterval ?? ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
  const clearI = o.clearInterval ?? ((h: unknown): void => clearInterval(h as ReturnType<typeof setInterval>));
  const queue: Item[] = [];
  let seq = 0;
  let handle: unknown = null;
  let calibrated: number | null = null;
  let disposed = false;

  const nowSec = (): number => get()?.currentTime ?? 0;

  function tick(): void {
    const src = get();
    if (!src || src.state !== 'running') return;
    const now = src.currentTime + early;
    while (queue.length && queue[0]!.t <= now) {
      const it = queue.shift()!;
      try { it.cb(); } catch (e) { o.onError?.(e); }
    }
    if (!queue.length) stopTicker();
  }
  function startTicker(): void { if (handle === null && !disposed) handle = setI(tick, tickMs); }
  function stopTicker(): void { if (handle !== null) { clearI(handle); handle = null; } }

  function add(t: number, cb: () => void): Item {
    const it: Item = { t, cb, seq: seq++ };
    // sorted insert, stable for equal times
    let i = queue.length;
    while (i > 0 && queue[i - 1]!.t > t) i--;
    queue.splice(i, 0, it);
    startTicker();
    return it;
  }

  const reportedMs = (): number => {
    const s = get();
    if (!s) return 0;
    return Math.max(0, ((s.baseLatency ?? 0) + (s.outputLatency ?? 0)) * 1000);
  };

  return {
    now: nowSec,
    schedule(t, cb) { if (!disposed) add(t, cb); },
    scheduleCancelable(t, cb) {
      const it = disposed ? null : add(t, cb);
      return () => { if (!it) return; const i = queue.indexOf(it); if (i >= 0) queue.splice(i, 1); if (!queue.length) stopTicker(); };
    },
    get latencyMs() { return calibrated ?? reportedMs(); },
    get running() { return get()?.state === 'running'; },
    get calibratedMs() { return calibrated; },
    get reportedMs() { return reportedMs(); },
    get pending() { return queue.length; },
    setCalibratedMs(ms) { calibrated = ms === null || !Number.isFinite(ms) ? null : Math.max(-500, Math.min(1000, ms)); },
    fromPerformance(ms) {
      const s = get();
      if (!s) return 0;
      const ts = s.getOutputTimestamp?.();
      // The context's own pairing says which sample the speakers play at a page time. Scheduled sounds are timed in
      // render time (currentTime), which runs the browser's reported latency ahead of what is heard, so add it back:
      // a tap exactly in time with a note then differs from the note's time by exactly latencyMs.
      if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) return ts.contextTime + (ms - ts.performanceTime) / 1000 + reportedMs() / 1000;
      return s.currentTime + (ms - perfNow()) / 1000;
    },
    dispose() { disposed = true; queue.length = 0; stopTicker(); },
  };
}

// ───────────────────────── latency calibration ─────────────────────────

export interface CalibrationResult {
  /** Median of (tap time - click time), ms. Positive: the player taps after the click. */
  offsetMs: number;
  /** Spread of the offsets (median absolute deviation scaled to a standard deviation), ms. */
  spreadMs: number;
  /** Taps that counted. */
  taps: number;
  /** Enough taps, steady enough, to trust the offset. */
  ok: boolean;
  offsets: number[];
}

export interface CalibratorOptions {
  clock: Pick<AudioClockKit, 'now' | 'fromPerformance'>;
  /** Schedules one click at an audio-clock time (AudioKit.playAt('metronome', t)). */
  click(at: number): void;
  beats?: number;
  /** Seconds between clicks. Default 0.8: far enough apart that a Bluetooth speaker's 250 ms is not mistaken for the next beat. */
  interval?: number;
  /** Seconds before the first click. Default 1. */
  lead?: number;
  /** Taps needed. Default 5. */
  minTaps?: number;
  /** The offsets must be this steady (spread, ms) to be trusted. Default 45. */
  maxSpreadMs?: number;
}

export interface LatencyCalibrator {
  /** Schedules all the clicks. Returns the audio times of the clicks. */
  start(): number[];
  /** A tap, with the event's timeStamp (performance.now ms). Returns its offset from the nearest click in ms, or null if it was not near one. */
  tap(perfMs: number): number | null;
  result(): CalibrationResult;
  /** True once the last click is more than one interval in the past. */
  done(): boolean;
}

const median = (a: readonly number[]): number => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };

export function createLatencyCalibrator(o: CalibratorOptions): LatencyCalibrator {
  const beats = o.beats ?? 8, interval = o.interval ?? 0.8, lead = o.lead ?? 1;
  const minTaps = o.minTaps ?? 5, maxSpread = o.maxSpreadMs ?? 45;
  let times: number[] = [];
  const seen = new Set<number>();
  const offsets: number[] = [];

  return {
    start() {
      const t0 = o.clock.now() + lead;
      times = Array.from({ length: beats }, (_, i) => t0 + i * interval);
      seen.clear();
      offsets.length = 0;
      for (const t of times) o.click(t);
      return [...times];
    },
    tap(perfMs) {
      if (!times.length) return null;
      const t = o.clock.fromPerformance(perfMs);
      let best = -1, bestD = Infinity;
      for (let i = 0; i < times.length; i++) { const d = Math.abs(t - times[i]!); if (d < bestD) { bestD = d; best = i; } }
      // a tap counts if it is within 45 % of an interval of a click, and each click counts once (the first tap wins)
      if (best < 0 || bestD > interval * 0.45 || seen.has(best)) return null;
      seen.add(best);
      const off = (t - times[best]!) * 1000;
      offsets.push(off);
      return off;
    },
    result() {
      const off = [...offsets];
      if (!off.length) return { offsetMs: 0, spreadMs: 0, taps: 0, ok: false, offsets: off };
      // one round of outlier removal: a tap that is far from the median is a slip, not latency
      const m0 = median(off);
      const mad0 = median(off.map((x) => Math.abs(x - m0)));
      const kept = off.filter((x) => Math.abs(x - m0) <= Math.max(60, 3 * 1.4826 * mad0));
      const m = median(kept);
      const spread = 1.4826 * median(kept.map((x) => Math.abs(x - m)));
      return { offsetMs: m, spreadMs: spread, taps: kept.length, ok: kept.length >= minTaps && spread <= maxSpread, offsets: kept };
    },
    done() {
      const last = times[times.length - 1];
      return last !== undefined && o.clock.now() > last + interval;
    },
  };
}

/**
 * How far a tap was from a note, in ms, corrected for the latency: negative is early, positive late. The tap is an input
 * event time (performance.now ms), the note an audio-clock time in seconds.
 */
export function judgeTapMs(clock: Pick<AudioClockKit, 'fromPerformance' | 'latencyMs'>, tapPerfMs: number, noteAudioSec: number): number {
  return (clock.fromPerformance(tapPerfMs) - noteAudioSec) * 1000 - clock.latencyMs;
}
