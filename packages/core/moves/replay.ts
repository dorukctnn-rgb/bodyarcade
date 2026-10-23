// Trace replay for detector tests (tech.md 4.4): calibrate on the first still stance, then run the feature
// extractor and the detectors on every later frame, and score the events against hand labels.
// Pure and synchronous, so a whole recording runs in Node in milliseconds.
import type {
  BodyProfile, CalibratorOptions, DetectorRegistry, DetectorSpec, Features, Framing, MovementEvent, MovementId, PoseFrame, TraceLabel,
} from '../types/index.ts';
import { createCalibrator } from '../body/calibrator.ts';
import { createFeatureExtractor } from '../body/features.ts';
import { DETECTORS } from './index.ts';

export interface ReplayOptions {
  framing?: Framing;
  calibration?: CalibratorOptions;
  detectors?: DetectorSpec[];
  registry?: DetectorRegistry;
  /** Skip calibration and use this profile from the first frame. */
  profile?: BodyProfile;
}

export interface ReplaySample { t: number; ok: boolean; channels: Record<string, number>; f: Features }

export interface ReplayResult {
  profile: BodyProfile | null;
  /** Time of the frame that completed calibration, or null if it never did. */
  calibratedAt: number | null;
  events: MovementEvent[];
  samples: ReplaySample[];
}

export function replay(frames: readonly PoseFrame[], o: ReplayOptions = {}): ReplayResult {
  const registry = o.registry ?? DETECTORS;
  const specs = o.detectors ?? [{ id: 'jump' }, { id: 'squat' }, { id: 'lean' }];
  let profile: BodyProfile | null = o.profile ?? null;
  let calibratedAt: number | null = o.profile ? (frames[0]?.t ?? 0) : null;
  const calibrator = createCalibrator({ now: () => 0 });
  calibrator.begin(o.framing ?? 'full', o.calibration);
  const extractor = createFeatureExtractor();
  let detectors = profile ? build(profile) : [];
  const events: MovementEvent[] = [];
  const samples: ReplaySample[] = [];

  function build(p: BodyProfile) {
    return specs.map((s) => {
      const make = registry[s.id];
      if (!make) throw new Error(`No detector registered for '${s.id}'.`);
      return make(p, s.opts);
    });
  }

  for (const frame of frames) {
    if (!profile) {
      if (calibrator.push(frame).ready) {
        profile = calibrator.profile();
        calibratedAt = frame.t;
        if (profile) detectors = build(profile);
      }
      continue;
    }
    const f = extractor.push(frame, profile);
    const channels: Record<string, number> = {};
    for (const d of detectors) {
      for (const e of d.push(f)) events.push(e);
      Object.assign(channels, d.channels?.() ?? {});
    }
    samples.push({ t: frame.t, ok: f.ok, channels, f });
  }
  return { profile, calibratedAt, events, samples };
}

export interface EventScore {
  /** Labels matched by an event within the window. */
  hits: number;
  misses: TraceLabel[];
  /** Events that matched no label. */
  extra: MovementEvent[];
  /** Event time minus label time, for each hit (ms). */
  delays: number[];
  recall: number;
  precision: number;
}

/**
 * Matches events of one movement against labels: an event counts for the first unmatched label at or before it,
 * no more than `maxDelayMs` earlier (and `earlyMs` later, for labels placed at the peak rather than the start).
 */
export function scoreEvents(events: readonly MovementEvent[], labels: readonly TraceLabel[], o: { id: MovementId; kind?: MovementEvent['kind']; side?: 'L' | 'R'; maxDelayMs: number; earlyMs?: number }): EventScore {
  const want = (x: { id: string; kind: string; side?: string | undefined }): boolean =>
    x.id === o.id && (o.kind === undefined || x.kind === o.kind) && (o.side === undefined || x.side === o.side);
  const ls = labels.filter(want).slice().sort((a, b) => a.t - b.t);
  const es = events.filter(want).slice().sort((a, b) => a.t - b.t);
  const used = new Set<number>();
  const delays: number[] = [];
  const extra: MovementEvent[] = [];
  for (const e of es) {
    const i = ls.findIndex((l, k) => !used.has(k) && e.t - l.t <= o.maxDelayMs && l.t - e.t <= (o.earlyMs ?? 0));
    if (i < 0) { extra.push(e); continue; }
    used.add(i);
    delays.push(e.t - (ls[i] as TraceLabel).t);
  }
  const misses = ls.filter((_, k) => !used.has(k));
  return {
    hits: used.size, misses, extra, delays,
    recall: ls.length ? used.size / ls.length : 1,
    precision: es.length ? used.size / es.length : 1,
  };
}
