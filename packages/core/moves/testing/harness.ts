// Test helpers for the movement library: drive one detector with a rig motion and look at what it said. Test support
// only; nothing in production imports it.
//
// Two ways to run a motion
// - `drive`: the rig's exact body-space features (no filter, no calibration) straight into a detector. Fast and
//   precise: the numbers in a test are the numbers the rig draws.
// - `replayMotion`: the same motion as landmarks through the real Calibrator, the One Euro FeatureExtractor and a
//   resampled pose rate (30, 15, 10 Hz), as the product does it. Slower, and the way to catch filter lag.
import type { BodyProfile, Detector, DetectorFactory, DetectorSpec, Features, Framing, MovementEvent, MovementId, Side } from '../../types/index.ts';
import { traceFrames } from '../../pose/trace.ts';
import { replay, type ReplayResult } from '../replay.ts';
import { ALL_DETECTORS } from '../library.ts';
import { delayed, rigTrace, simulate, SHAPE_FULL, type Motion, type RigShape, type Sim, type SimOptions } from './rig.ts';

export interface DriveOptions extends SimOptions {
  /** Options handed to the detector factory. */
  opts?: Record<string, number>;
  /** Use this profile instead of the rig's own. */
  profile?: BodyProfile;
}

export interface Sample { t: number; ch: Record<string, number>; value: number | undefined; f: Features }

export interface Drive {
  sim: Sim;
  detector: Detector;
  events: MovementEvent[];
  samples: Sample[];
}

/** Runs `motion` through the rig and feeds every frame's features to a fresh detector. */
export function drive(make: DetectorFactory, motion: Motion, o: DriveOptions): Drive {
  const sim = simulate(motion, o);
  const detector = make(o.profile ?? sim.profile, o.opts);
  return { sim, detector, ...feed(detector, sim.features) };
}

/** Feeds features to an existing detector (two detectors can share one motion, or take turns). */
export function feed(detector: Detector, features: readonly Features[]): { events: MovementEvent[]; samples: Sample[] } {
  const events: MovementEvent[] = [];
  const samples: Sample[] = [];
  for (const f of features) {
    for (const e of detector.push(f)) events.push(e);
    samples.push({ t: f.t, ch: { ...(detector.channels?.() ?? {}) }, value: detector.value(), f });
  }
  return { events, samples };
}

export type EventFilter = { id?: MovementId; kind?: MovementEvent['kind']; side?: Side };

export function pick(events: readonly MovementEvent[], f: EventFilter = {}): MovementEvent[] {
  return events.filter((e) => (f.id === undefined || e.id === f.id) && (f.kind === undefined || e.kind === f.kind) && (f.side === undefined || e.side === f.side));
}

const between = (d: { samples: readonly Sample[] }, t0: number, t1: number): Sample[] => d.samples.filter((s) => s.t >= t0 && s.t <= t1);

/** Largest value of a channel in [t0, t1] (0 when the channel is never published there). */
export const chMax = (d: { samples: readonly Sample[] }, name: string, t0 = 0, t1 = Infinity): number => Math.max(...between(d, t0, t1).map((s) => s.ch[name] ?? 0));
export const chMin = (d: { samples: readonly Sample[] }, name: string, t0 = 0, t1 = Infinity): number => Math.min(...between(d, t0, t1).map((s) => s.ch[name] ?? 0));
/** The channel at the first sample at or after `t`. */
export const chAt = (d: { samples: readonly Sample[] }, name: string, t: number): number => (d.samples.find((s) => s.t >= t)?.ch[name] ?? 0);
/** Times of the events that match the filter, rounded to whole ms. */
export const times = (events: readonly MovementEvent[], f: EventFilter = {}): number[] => pick(events, f).map((e) => Math.round(e.t));

// ───────── through the real calibration and extractor ─────────

export interface ReplayMotionOptions {
  detectors: DetectorSpec[];
  /** Length of the motion after the still stance, ms. */
  durationMs: number;
  /** Pose rate the device delivers (default 30). */
  hz?: number;
  /** Still stance before the motion, for the calibrator (default 2200 ms). */
  leadMs?: number;
  noise?: number;
  jitterMs?: number;
  seed?: number;
  shape?: RigShape;
  framing?: Framing;
  /** Calibration hold, seconds (default 1.2). */
  holdSeconds?: number;
}

/** The motion starts `leadMs` after the first frame; every event time and label in the test is in trace time. */
export function replayMotion(motion: Motion, o: ReplayMotionOptions): ReplayResult & { leadMs: number } {
  const lead = o.leadMs ?? 2200;
  const shape = o.shape ?? SHAPE_FULL;
  const trace = rigTrace(delayed(motion, lead), {
    id: 'moves-test', durationMs: lead + o.durationMs, fps: 30, shape, noise: o.noise ?? 0.0015, seed: o.seed ?? 7,
    ...(o.jitterMs !== undefined ? { jitterMs: o.jitterMs } : {}), ...(o.framing !== undefined ? { framing: o.framing } : {}),
  });
  const r = replay(traceFrames(trace, { hz: o.hz ?? 30 }), {
    detectors: o.detectors, registry: ALL_DETECTORS,
    framing: o.framing ?? (shape === SHAPE_FULL ? 'full' : 'upper'),
    ...(o.holdSeconds !== undefined ? { calibration: { holdSeconds: o.holdSeconds } } : {}),
  });
  return { ...r, leadMs: lead };
}
