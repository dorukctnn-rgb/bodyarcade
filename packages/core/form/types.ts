// Form coach contract. The coach produces codes and numbers only (the platform writes no words for the player,
// types/no-words.test.ts); the page turns cue and guide codes into sentences in the player's language.
import type { P, Side, View } from './geometry.ts';

export type FormMoveId = 'squat' | 'pushUp' | 'gluteBridge' | 'dbShoulderPress';

/** Body line parts that a rule can colour. L and R are the player's own sides. */
export type SegmentId =
  | 'neck' | 'shoulders' | 'hips' | 'torso'
  | 'upperArmL' | 'upperArmR' | 'forearmL' | 'forearmR'
  | 'thighL' | 'thighR' | 'shinL' | 'shinR' | 'footL' | 'footR';

/**
 * none: no rule looks at this part (drawn neutral). unknown: a rule looks at it but cannot measure it now (points not seen,
 * wrong camera angle): drawn grey, never red. ok: green. tip: amber, dotted. bad: red, dashed, with a cross.
 */
export type SegState = 'none' | 'unknown' | 'ok' | 'tip' | 'bad';

export type Severity = 'error' | 'tip';

/** Where a repetition is: top = the start position (standing, arms locked, lying flat for a bridge), bottom = the target. */
export type Phase = 'top' | 'down' | 'bottom' | 'up';

/** What a move's measurements see in one frame: smoothed points, the camera angle, the near side and the body's own lengths. */
export interface BodyCtx {
  t: number;
  pts: readonly P[];
  view: View;
  /** The side facing the camera (side and diagonal views). */
  near: Side;
  /** The player's own lengths in view units, from the frames where they were seen best (running maximum with a slow decay). */
  len: { thigh: number; shin: number; upperArm: number; forearm: number; torso: number; shoulders: number };
  /** The repetition's progress this frame (0 top, 1 target) and where the repetition is. */
  p: number;
  phase: Phase;
}

export interface RepOpts {
  /** A movement whose progress never reaches this is not a repetition (fidgeting). */
  countAt: number;
  /** Back at or below this progress: the repetition is over. */
  upAt: number;
  /** The target: a repetition that ends without reaching it is counted but not clean (the move's depth rule). */
  fullAt: number;
  /** Shortest repetition, ms. */
  minMs: number;
}

export interface LiveRule {
  kind: 'live';
  id: string;
  severity: Severity;
  /** Views the rule can be measured from. In other views it is 'unknown'. */
  views: readonly View[];
  /** Checked only while the repetition's progress is at least this (e.g. the lower half of a squat). */
  minP?: number;
  /** Checked only in these phases (default: all but 'top'). */
  phases?: readonly Phase[];
  /** One measurement per side or one for the body. null: cannot be measured this frame. */
  measure(b: BodyCtx): number | null | { L: number | null; R: number | null };
  /** The measurement is bad / clearly fine again (hysteresis: `clear` is the way back). */
  bad(v: number): boolean;
  clear(v: number): boolean;
  /** The parts to colour, for one side (per-side rules) or for the body. */
  segments(b: BodyCtx, side?: Side): readonly SegmentId[];
  /** Cue code; a function picks between two cues (e.g. hips too low or too high). */
  cue: string | ((v: number) => string);
  /** Bad for at least this long before it shows (ms, default 150); clear for this long to go back (default 100). */
  holdMs?: number;
  clearMs?: number;
}

/** A rule judged once at the end of each repetition from what the repetition did (its deepest point, its timing). */
export interface RepRule {
  kind: 'rep';
  id: string;
  severity: Severity;
  views: readonly View[];
  /** Bad when this returns true for the finished repetition; null = could not be judged. */
  judge(r: RepStats, b: BodyCtx): boolean | null;
  segments(b: BodyCtx): readonly SegmentId[];
  cue: string;
}

export type FormRule = LiveRule | RepRule;

/** What a repetition did, for the rep rules and the summary. */
export interface RepStats {
  startT: number;
  bottomT: number;
  endT: number;
  maxP: number;
  /** Extremes of the move's own extra channels over the repetition (e.g. the torso angle at the bottom). */
  at: Record<string, number>;
}

export interface MoveDef {
  id: FormMoveId;
  /** Views the move is set up for, preferred first. Counting works in these; outside them the guide asks to turn. */
  views: readonly View[];
  /** Lying or plank moves: the body must lie along the picture. */
  lying?: boolean;
  /** Body parts the camera must see (for the placement guide). */
  parts: readonly ('head' | 'shoulders' | 'elbows' | 'hands' | 'hips' | 'knees' | 'feet')[];
  rep: RepOpts;
  /** The repetition's progress (0 top, 1 target) or null when it cannot be measured this frame. */
  progress(b: Omit<BodyCtx, 'p' | 'phase'>): number | null;
  /** Extra channels kept per repetition: value this frame, and whether the repetition keeps its minimum or maximum. */
  track?: readonly { id: string; agg: 'min' | 'max'; at?: 'bottom' | 'any'; value(b: BodyCtx): number | null }[];
  rules: readonly FormRule[];
  /** Cue shown when the player starts the next repetition without going back to the start position. */
  returnCue: string;
}

export interface RepSummary {
  n: number;
  startT: number;
  endT: number;
  maxP: number;
  errors: string[];
  tips: string[];
  clean: boolean;
}

export type GuideCheck =
  | { id: 'person'; ok: boolean }
  | { id: 'parts'; ok: boolean; missing: string[] }
  | { id: 'view'; ok: boolean; want: View; got: View | null }
  | { id: 'distance'; ok: boolean; hint: 'closer' | 'farther' | null }
  | { id: 'pose'; ok: boolean };

export interface GuideState { ready: boolean; checks: GuideCheck[] }

export interface CoachState {
  t: number;
  /** A person is seen this frame. */
  present: boolean;
  view: View | null;
  near: Side;
  guide: GuideState;
  phase: Phase;
  progress: number | null;
  reps: number;
  clean: number;
  segments: Record<SegmentId, SegState>;
  /** The cue to show now (a code), or null. */
  cue: string | null;
  cueSeverity: Severity | null;
  /** The repetition that just finished (set for one frame), for sounds and the rep strip. */
  repDone: RepSummary | null;
  /** The smoothed points of this frame (view space), for the body line. */
  pts: readonly P[];
}

export interface SetSummary {
  reps: number;
  clean: number;
  /** The rule that went wrong in the most repetitions, with the count; null when every repetition was clean. */
  top: { id: string; count: number } | null;
  list: RepSummary[];
  /** Rule ids the move measured in the views seen during the set, and the ones it could not. */
  measured: string[];
}
