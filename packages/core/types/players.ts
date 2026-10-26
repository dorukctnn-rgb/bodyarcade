// Two players, one camera (mode 'local2', BUILD-PLAN "Two players, one camera"): web on big screens only.
// The pose service runs with numPoses 2; PlayerAssignment turns its unordered detections into two stable players;
// each player then has their own Calibrator, FeatureExtractor and MovementEngine, exactly like one player.
import type { BodyProfile, CalibrationCode, CalibrationHint, CalibrationStatus, CalibratorOptions, Framing, FramingProfile, HeadroomCode, ProfileSupport } from './body.ts';
import type { Ms } from './common.ts';
import type { PoseFrame } from './pose.ts';

/** Player 1 starts on the left of the mirror view (what the players see), Player 2 on the right. */
export type PlayerSlot = 1 | 2;

/** One player's view of a frame: `landmarks` is this player's, or null while they are not found. */
export interface PlayerFrame extends PoseFrame { player: PlayerSlot }

export interface PlayerPresence {
  present: boolean;
  /** Time of the last change of `present`. */
  since: Ms;
  /** Body anchor (hip midpoint, view space) of the last sighting, for "step back in on the left" hints. */
  lastX?: number;
}

export interface PlayerAssignmentOptions {
  /** A player missing for longer than this is reported absent (the session pauses with "Player 2, step back in"). */
  lostMs?: number;
  /** Keep the current assignment unless swapping is better by this many torso lengths (hysteresis). */
  swapMarginT?: number;
}

export interface PlayerAssignment {
  /**
   * Splits one frame into the two players. Identity follows each body from frame to frame (nearest position, with
   * hysteresis), so players keep their slot when they cross; left and right only decide the first assignment and a
   * return after both were gone.
   */
  push(f: PoseFrame): [PlayerFrame, PlayerFrame];
  readonly presence: Readonly<Record<PlayerSlot, PlayerPresence>>;
  reset(): void;
}

/** Two-person framing problems on top of each player's own CalibrationCode. */
export type TwoPlayerCode = CalibrationCode | 'one_person' | 'too_close_together' | 'player_out';

/** What the screen asks of whom. */
export interface TwoPlayerGuidance {
  player?: PlayerSlot;
  action: 'step_in' | 'step_back' | 'step_closer' | 'move_apart' | 'move_left' | 'move_right' | 'hold_still' | 'more_light' | 'light_in_front' | 'none';
}

export interface TwoPlayerCalibrationStatus {
  ready: boolean;
  /** The lower of the two players' progress. */
  progress: number;
  /** A game with headroom adds the two codes of the hands-up step (the guidance is then `none` with the player named: the code and the hint say it). */
  code: TwoPlayerCode | HeadroomCode;
  guidance: TwoPlayerGuidance;
  players: Record<PlayerSlot, CalibrationStatus>;
  hz: number;
  /** The lower of the two players' profiles (null when one is not measured), the game kinds it runs, and how it ended (see CalibrationStatus). */
  profile?: FramingProfile | null;
  supports?: ProfileSupport;
  outcome?: 'measured' | 'fallback';
  /** The player the code is about, with the measured advice for them. */
  hint?: CalibrationHint;
  /** Either player has waited long: offer another way to play. */
  escape?: boolean;
  /** Until the desk profile is taken for the pair on its own (the later of the two). */
  fallbackInMs?: number;
}

export interface TwoPlayerCalibrator {
  begin(f: Framing, o?: CalibratorOptions): void;
  /** "Play at the desk": both players' calibrations end with what is measured (see Calibrator.accept). True when both ended at once. */
  accept(): boolean;
  /** Takes the assigned frames of one camera frame. */
  push(frames: readonly [PlayerFrame, PlayerFrame]): TwoPlayerCalibrationStatus;
  profiles(): Record<PlayerSlot, BodyProfile> | null;
  reset(): void;
}
