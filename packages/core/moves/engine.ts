// MovementEngine: one player's pipeline from pose frames to movement events and continuous channels
// (code-audit 11.4). Pose frame -> FeatureExtractor (body space, One Euro) -> every active detector, in spec order.
// In mode 'local2' each player has their own engine, fed with that player's frames from PlayerAssignment.
//
// Rules
// - use() may come before the profile; the detectors are built once a profile is set, and rebuilt on every new
//   profile (a recalibration starts every detector afresh).
// - Channels: each detector's channels(); a detector without channels() publishes value() under its own id.
//   When two detectors publish the same name, the later spec wins.
// - Events go to the listeners synchronously, in spec order, during push(). A listener that throws does not stop the
//   others; the first error is thrown again after all of them ran.
import type {
  BodyProfile, Detector, DetectorFactory, DetectorRegistry, DetectorSpec, FeatureExtractorOptions, Features, MovementEngine,
  MovementEvent, PoseFrame, Unsubscribe,
} from '../types/index.ts';
import { createFeatureExtractor, emptyFeatures } from '../body/features.ts';
import { DETECTORS } from './index.ts';

export interface MovementEngineOptions {
  /** Detector factories by id (default: the movement library). */
  registry?: DetectorRegistry;
  /** Feature extractor options (filter, drift). */
  features?: FeatureExtractorOptions;
}

const EMPTY: Readonly<Record<string, number>> = Object.freeze({});

export function createMovementEngine(o: MovementEngineOptions = {}): MovementEngine {
  const registry = o.registry ?? DETECTORS;
  const extractor = createFeatureExtractor(o.features);
  const listeners = new Set<(e: MovementEvent) => void>();
  let specs: DetectorSpec[] = [];
  let profile: BodyProfile | null = null;
  let detectors: Detector[] = [];
  let channels: Readonly<Record<string, number>> = EMPTY;
  let last: Features | null = null;

  const factory = (s: DetectorSpec): DetectorFactory => {
    const make = registry[s.id];
    if (typeof make !== 'function') throw new Error(`No detector registered for '${s.id}'.`);
    return make;
  };

  const build = (): void => {
    const p = profile;
    detectors = p ? specs.map((s) => factory(s)(p, s.opts ? { ...s.opts } : undefined)) : [];
    channels = EMPTY;
  };

  const emit = (events: readonly MovementEvent[]): void => {
    if (!events.length || !listeners.size) return;
    let error: unknown = null;
    let failed = false;
    for (const e of events) {
      for (const cb of [...listeners]) {
        try { cb(e); } catch (err) { if (!failed) { failed = true; error = err; } }
      }
    }
    if (failed) throw error;
  };

  return {
    use(next: DetectorSpec[]): void {
      // Check every id before changing anything: a manifest that names a missing detector fails loudly and early.
      const unknown = next.filter((s) => typeof registry[s.id] !== 'function').map((s) => `'${s.id}'`);
      if (unknown.length) throw new Error(`No detector registered for ${unknown.join(', ')}.`);
      specs = next.map((s) => (s.opts ? { id: s.id, opts: { ...s.opts } } : { id: s.id }));
      build();
    },

    setProfile(p: BodyProfile): void {
      profile = p;
      extractor.reset();
      last = null;
      build();
    },

    push(f: PoseFrame): Features {
      if (!profile) {
        last = emptyFeatures(f);
        return last;
      }
      const features = extractor.push(f, profile);
      const events: MovementEvent[] = [];
      const ch: Record<string, number> = {};
      for (const d of detectors) {
        for (const e of d.push(features)) events.push(e);
        if (d.channels) Object.assign(ch, d.channels());
        else {
          const v = d.value();
          if (v !== undefined) ch[d.id] = v;
        }
      }
      channels = Object.freeze(ch);
      last = features;
      emit(events);
      return features;
    },

    onEvent(cb: (e: MovementEvent) => void): Unsubscribe {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    channel(name: string): number {
      return channels[name] ?? 0;
    },

    channels(): Readonly<Record<string, number>> {
      return channels;
    },

    last(): Features | null {
      return last;
    },

    reset(): void {
      for (const d of detectors) d.reset();
      extractor.reset();
      channels = EMPTY;
      last = null;
    },
  };
}
