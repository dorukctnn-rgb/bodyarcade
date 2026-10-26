// core/moves: the movement library from game-design.md 0.5 (M1..M16) and the engine that runs it.
import type { BodyProfile, Features } from './body.ts';
import type { Ms, Side, Unsubscribe } from './common.ts';
import type { PoseFrame } from './pose.ts';

export type MovementId =
  | 'squat'          // M1
  | 'jump'           // M2
  | 'lean'           // M3
  | 'kneeLift'       // M4
  | 'jumpingJack'    // M5
  | 'handHit'        // M6
  | 'swipe'          // M7
  | 'twist'          // M8
  | 'sideBend'       // M9
  | 'pull'           // M10
  | 'overheadPress'  // M11
  | 'poseMatch'      // M12
  | 'energy'         // M13
  | 'steadiness'     // M14
  | 'sideLine'       // M15
  | 'armDirection';  // M16

export type MovementWarning = 'knees_in' | 'chest_down' | 'shrug' | 'hip_sag' | 'too_fast';

export interface MovementEvent {
  id: MovementId;
  kind: 'rep' | 'hit' | 'holdStart' | 'holdEnd' | 'value';
  t: Ms;
  side?: Side;
  /** Quality, never a penalty by itself. */
  q?: { depth?: number; speed?: number; range?: number };
  /** Form hints are spoken or shown, never punished (game-design.md 0.5). */
  warn?: MovementWarning[];
  /** For kind 'value'. */
  value?: number;
}

export interface Detector {
  readonly id: MovementId;
  /** Called once per pose frame, in time order. Returns the events this frame produced (often none). */
  push(f: Features): MovementEvent[];
  /** The detector's main continuous value (squat depth, lean, ...), or undefined when it has none or no data. */
  value(): number | undefined;
  /** Named continuous channels this detector publishes ('crouch', 'lean', 'lane', 'hand.L.x' ...). */
  channels?(): Readonly<Record<string, number>>;
  reset(): void;
}

/** Thresholds come from the profile (T, W, A) and per-game options, never from fixed pixel values. */
export type DetectorFactory = (p: BodyProfile, opts?: Record<string, number>) => Detector;

export interface DetectorSpec { id: MovementId; opts?: Record<string, number> }

export type DetectorRegistry = Partial<Record<MovementId, DetectorFactory>>;

export interface MovementEngine {
  /** Replaces the active detectors (one per spec); built once a profile is set. Throws on an unregistered id. */
  use(specs: DetectorSpec[]): void;
  /** A new calibration rebuilds every active detector with the new profile. */
  setProfile(p: BodyProfile): void;
  /** Runs the feature extractor and every detector on one frame. */
  push(f: PoseFrame): Features;
  onEvent(cb: (e: MovementEvent) => void): Unsubscribe;
  /** Continuous values: 'lean', 'crouch', 'lane', 'hand.L.x' ... 0 when no detector publishes the name. */
  channel(name: string): number;
  /** Every channel at once, for InputHub. */
  channels(): Readonly<Record<string, number>>;
  /** Features of the last frame, or null before the first. */
  last(): Features | null;
  reset(): void;
}
