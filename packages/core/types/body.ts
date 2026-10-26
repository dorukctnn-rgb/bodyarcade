// core/body: calibration, the body profile and per-frame features.
//
// Coordinate spaces (game-design.md 0.2):
// - VIEW space: the mirrored camera image as the player sees it. x grows to the right of the screen, y grows
//   downwards, and BOTH axes are measured in image heights (x_view = (1 - x_raw) * aspect, y_view = y_raw), so
//   distances that mix x and y are correct. BodyProfile is stored in view space.
// - BODY space: origin at the calibrated rest hip midpoint, unit = the player's torso length T on both axes,
//   +x = the player's right as seen in the mirror (screen right), +y = UP. Features positions use body space, so
//   tall and short players, near or far from the camera, follow the same rules.
import type { BodyPart, JointName, Ms, Side, Vec2 } from './common.ts';
import type { PoseFrame } from './pose.ts';

/** What a game needs to see of the player (its manifest) and what a profile was measured with. */
export type Framing = 'full' | 'upper' | 'side';

/**
 * What the camera managed to measure of the player; the Calibrator picks the best one it can instead of failing.
 * - 'full'   head to feet: shoulders, hips, knees and ankles in view and the body fits the picture.
 * - 'seated' head to hips in view (a person sitting back from the camera, or a standing one framed to the waist):
 *            the torso is measured, the legs are not needed.
 * - 'upper'  head and shoulders in view, the hips may be missing (a desk): the torso length is estimated from the
 *            shoulder width and the hips are held at their rest point (BodyProfile.hipsEstimated).
 * - 'side'   one side of the body seen from the side (push-ups, planks).
 */
export type FramingProfile = 'full' | 'upper' | 'seated' | 'side';

/**
 * The kind of a game as a profile sees it: its manifest framing ('full', 'upper', 'side'), or 'seated' when it is
 * played seated (every game has a seated variant that uses the arms and the trunk only).
 */
export type GameKind = FramingProfile;

/** Which game kinds a profile can run: 'full' runs all but side games; 'upper' and 'seated' run upper-body and seated games. */
export type ProfileSupport = Record<GameKind, boolean>;

/**
 * What a game needs above the player's head (its manifest `headroom`): 'arms-up' = the hands go overhead (Summit Climb),
 * so the picture must hold them there. The calibration then asks the player to raise both hands once and checks it.
 */
export type HeadroomNeed = 'arms-up';

/**
 * How the hands-up check ended. 'ok': both hands were raised and the picture held them. 'short': they were raised and the
 * top of the picture cut them (or the model lost them): the game plays with the top of the reach cut. 'unchecked': the
 * player did not raise them in time, or chose to play on.
 */
export type HeadroomState = 'ok' | 'short' | 'unchecked';

export interface BodyProfile {
  v: 2;
  framing: Framing;
  /** Epoch ms (Date.now()); only for display and for "re-check after a while". */
  capturedAt: number;
  /** Width / height of the image at capture; a different aspect means the profile must be checked again. */
  aspect: number;
  /** Torso (shoulder midpoint to hip midpoint, vertical), shoulder width, arm, thigh; view units (image heights). */
  T: number;
  W: number;
  A?: number;
  U?: number;
  /** Rest positions, view space. */
  rest: Record<'hipX' | 'hipY' | 'shoulderX' | 'shoulderY' | 'noseY', number>;
  /**
   * Hands-up height in view space (smaller is higher), for target games: the highest hand centre of the raised hands, set
   * by the hands-up check (headroom 'ok'); absent otherwise, and the detectors then estimate it from the arm.
   */
  reachY?: number;
  /** The hands-up check, for a game with manifest.headroom: how it ended (see HeadroomState). Absent for other games. */
  headroom?: HeadroomState;
  /** Pose frames per second measured while calibrating (device check: fast full-body games need 15 Hz or more). */
  hz: number;
  /** The profile this is (see FramingProfile); a profile without it is read from `framing`. */
  kind?: FramingProfile;
  /**
   * The hips were not in view (a desk): T is estimated from W (T = 1.45 W, measured on real recordings) and the rest
   * hip point sits one T below the shoulders. The feature extractor then holds the hips at that point, and the
   * presence gate asks for the shoulders only.
   */
  hipsEstimated?: boolean;
}

/**
 * What the screen says about the framing. Only codes: the UI turns each into a sentence in the player's language, with
 * the numbers of CalibrationHint where there are some. The platform never produces words.
 */
export type CalibrationCode =
  | 'no_person'
  | 'too_close'
  | 'too_far'
  | 'head_out'
  | 'hips_out'
  | 'knees_out'
  | 'feet_out'
  /** The body is cut by the side of the picture; the player moves toward the side the code names (as seen in the mirror). */
  | 'move_left'
  | 'move_right'
  /** The picture is too dark for the pose model / the light is behind the player (a window). */
  | 'too_dark'
  | 'backlit'
  /** One player calibrates but more than one person is in view (mode 'local2' has its own codes). */
  | 'many_people'
  | 'move_still'
  | 'hold'
  | 'ok'
  | 'too_slow';

/**
 * The two codes of the hands-up step, which only a game with manifest.headroom ever sees (CalibratorOptions.headroom), after
 * the body fits. Kept apart from CalibrationCode so a screen that lists the codes of every game is not asked for words for
 * them until it shows such a game.
 * - 'raise_hands': the player raises both hands, once (hint: action 'raise_hands').
 * - 'headroom': the raised hands are cut by the top of the picture, or the model lost them: step back or tilt the camera
 *   up (hint: action 'step_back' with steps, or 'tilt_camera_up').
 */
export type HeadroomCode = 'raise_hands' | 'headroom';

/** What the player should do about a code. */
export type HintAction =
  | 'step_in' | 'step_back' | 'step_closer' | 'move_left' | 'move_right'
  /** The player is far enough but a part is cut at the top or the bottom: the camera points the wrong way. */
  | 'tilt_camera_up' | 'tilt_camera_down'
  | 'more_light' | 'light_in_front' | 'one_person' | 'hold_still' | 'raise_hands';

/**
 * The measured part of a hint. Distances are estimates from the shoulder width (an average adult, a typical webcam
 * field of view), so they come as a range of steps: "1-2 steps back".
 */
export interface CalibrationHint {
  action: HintAction;
  /** Whole steps of about 0.65 m, from..to (at least 1); absent when the action is not about distance. */
  steps?: { min: number; max: number };
  /** The same distance in metres. */
  meters?: number;
}

/** Which parts of the body are in view and inside the picture right now (the checklist of the calibration screen). */
export interface CalibrationSeen { head: boolean; shoulders: boolean; hips: boolean; knees: boolean; feet: boolean }

export interface CalibrationStatus {
  /** 0..1 of the way: the hold time, and for a game with headroom the hands-up check as the last 40%. */
  progress: number;
  ready: boolean;
  /** Steady samples collected in the current hold. */
  samples: number;
  code: CalibrationCode | HeadroomCode;
  /** Measured pose rate so far. */
  hz: number;
  /** The best profile the camera measures right now (smoothed over half a second); null when not even head and shoulders. */
  profile?: FramingProfile | null;
  /** Which game kinds `profile` can run now: seated and upper-body games start at once, full-body games when it is 'full'. */
  supports?: ProfileSupport;
  /** What to do about `code`, with the distance or direction measured. */
  hint?: CalibrationHint;
  /** The parts of the body in view, for the checklist (the code alone names only the first one that is missing). */
  seen?: CalibrationSeen;
  /** The player stands still below the wanted profile: milliseconds until the desk profile is taken on its own. */
  fallbackInMs?: number;
  /** When ready: 'measured' (the wanted profile held) or 'fallback' (the best that could be measured: a clear state for the screen). */
  outcome?: 'measured' | 'fallback';
  /** The wait is long: offer another way to play (keyboard or touch) instead of waiting on. */
  escape?: boolean;
  /** When ready, for a game with manifest.headroom: how the hands-up check ended (also in BodyProfile.headroom). */
  headroom?: HeadroomState;
}

export interface CalibratorOptions {
  /** Default 1 s once the body fits. */
  holdSeconds?: number;
  /** Default 5: completes at slow rates too (B7). */
  minSamples?: number;
  /** Default 20 s; then, below 10 Hz, the status is 'too_slow' so the UI can offer keyboard or touch. */
  maxSeconds?: number;
  /**
   * Take the best profile that can be measured when the wanted one is not reached (default true): a full-body request
   * at a desk ends with the 'upper' profile and outcome 'fallback' instead of waiting for ever. Off for a game that
   * has no seated variant.
   */
  fallback?: boolean;
  /** The player stands still this long below the wanted profile: fall back (default 3.5 s). Movement restarts the count. */
  idleFallbackSeconds?: number;
  /** The longest wait for the wanted profile before falling back, moving or not (default 9 s). */
  maxWaitSeconds?: number;
  /** Status.escape is set after this long without a result (default 12 s). */
  escapeSeconds?: number;
  /**
   * The game raises the hands overhead (manifest.headroom): once the body fits, the player raises both hands (code
   * 'raise_hands') and the picture must hold them; if it cuts them the code is 'headroom' with a measured hint. Never
   * blocks: after headroomWaitSeconds the calibration ends anyway with BodyProfile.headroom 'short' or 'unchecked'.
   */
  headroom?: HeadroomNeed;
  /** The longest the hands-up check waits, counted from the first time the body fits (default 6 s). */
  headroomWaitSeconds?: number;
}

export interface Calibrator {
  // Time-based and rate-aware: it completes after the hold time with at least minSamples samples, and reports
  // 'too_slow' after maxSeconds so the UI can offer keyboard or touch (B7). It never waits for ever: below the wanted
  // profile it falls back to the best one it can measure (see FramingProfile), and Status.escape asks the screen to
  // offer another way to play. With CalibratorOptions.headroom the end of the calibration waits for the hands-up check
  // (never longer than headroomWaitSeconds).
  begin(f: Framing, o?: CalibratorOptions): void;
  push(f: PoseFrame): CalibrationStatus;
  /**
   * "Play at the desk": ends the calibration with the best profile that is measured (after a short steady spell if the
   * player has not been steady yet; ready arrives on a later push). True when it ended at once.
   */
  accept(): boolean;
  profile(): BodyProfile | null;
  reset(): void;
}

export interface Features {
  t: Ms;
  seq: number;
  /** Shoulders and hips are visible: the minimum for any game. Side framing: the shoulder and hip of one side. */
  ok: boolean;
  /** Which landmark groups are visible (visibility >= 0.5) in this frame; side framing: a pair counts when either side is. */
  seen: Record<BodyPart, boolean>;
  // Positions in body space (see the top of this file), One Euro filtered. Pairs are [L, R] (the player's own sides).
  head: Vec2;
  shoulder: Vec2;
  hip: Vec2;
  shoulders: [Vec2, Vec2];
  hips: [Vec2, Vec2];
  elbow: [Vec2, Vec2];
  /** Hand centre: mean of wrist, index and pinky (game-design.md 0.2). */
  hand: [Vec2, Vec2];
  knee: [Vec2, Vec2];
  ankle: [Vec2, Vec2];
  /** Foot: mean of ankle and foot tip. */
  foot: [Vec2, Vec2];
  /** Hip rise above rest, in T (positive = up). */
  rise: number;
  /** Hip drop below rest, in T (positive = down); always -rise. */
  drop: number;
  /** Nose drop below rest, in T (positive = down). */
  headDrop: number;
  /** Shoulder-over-hip tilt plus 0.7 x hip shift, relative to rest, in W; positive = toward the player's right. 0 in side framing. */
  lean: number;
  /** Current shoulder width / W (drops when the player turns; M8 twist). 1 in side framing. */
  shoulderSpan: number;
  /** Side framing only: the side of the body that faces the camera (the far side may be hidden). */
  near?: Side;
  /** Velocities in T per second, body space, [L, R] for paired joints (both entries equal for midline joints). */
  vel: Partial<Record<JointName, [Vec2, Vec2]>>;
}

export interface OneEuroOptions { minCutoff: number; beta: number; dCutoff: number }

export interface FeatureExtractorOptions {
  /** Per-coordinate filter; tech.md 4.1 starts at minCutoff 1.0-1.5 Hz and beta 0.5-1.0. */
  filter?: Partial<OneEuroOptions>;
  /** Slow re-centring of the rest pose while standing still (today's 8 s drift); 0 turns it off. */
  driftSeconds?: number;
}

export interface FeatureExtractor {
  push(f: PoseFrame, p: BodyProfile): Features;
  reset(): void;
}
