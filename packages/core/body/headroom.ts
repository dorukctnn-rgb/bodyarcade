// Headroom: does the picture hold the player's hands when they go overhead? A game that raises the hands (manifest
// `headroom: 'arms-up'`, Summit Climb) needs the wrists, index fingers and pinkies inside the picture at the top of the
// reach. The calibration asks the player to raise both hands once and reads that pose here: the highest hand landmark
// against the top edge, and where straight arms would reach. Only codes and numbers come out; the screen finds the words.
import { LM, type CalibrationHint, type Landmark } from '../types/index.ts';
import { MIN_BACK_M, distanceM, moveHint } from './guidance.ts';

/**
 * Starting values. Measured on the real jumping-jacks recording (tests/traces/video): with the arms overhead the hand
 * centre reaches 0.7 torso lengths above the shoulder line and the highest fingertip 0.9 (the person's arms are in a V);
 * the nose is 0.4 above it. A straight arm is longer: shoulder to wrist about 0.55 m against a torso of about 0.5 m.
 */
export const HEADROOM = {
  /** Where the wrists of straight arms end, in torso lengths above the shoulder line: the reach the game may ask for. */
  reachT: 1.1,
  /** An arm counts as raised when its wrist is this many T above the shoulder line, or its elbow this many. */
  wristRaisedT: 0.45,
  elbowRaisedT: 0.25,
  /** The highest of wrist, index and pinky must stay this far below the top edge of the picture (image heights). */
  margin: 0.015,
  /** Straight arms may end this far past the top edge before the picture counts as too short (fingertips are not needed). */
  tolerance: 0.03,
  /** A wrist the model is less sure of than this is lost. */
  lostVisibility: 0.35,
  /** An elbow is believed from this visibility. */
  elbowVisibility: 0.3,
  /** A player already this far from the camera (metres) is not asked to step back further: the camera points too low. */
  farM: 3.6,
  /** Both hands up and held in view this long (ms): the check passes. */
  holdMs: 400,
  /** The longest the check waits (s), counted from the first time the body fits; then the calibration ends anyway. */
  waitSeconds: 6,
} as const;

export type HandsState = 'down' | 'ok' | 'cut';

export interface HandsReading {
  /**
   * 'down': the arms are not both up. 'ok': both up, and the picture holds the hands (and the straight-arm reach).
   * 'cut': both up, and the top of the picture cuts them, or the model lost a wrist, or straight arms would not fit.
   */
  state: HandsState;
  /** The highest of wrist, index and pinky of both hands, image heights from the top (below 0: past the top edge). */
  top: number;
  /** The higher hand's centre (mean of wrist, index and pinky), image heights from the top. */
  centreY: number;
  /** For 'cut': step back by so many steps, or tilt the camera up. */
  hint?: CalibrationHint;
}

const SIDES = [
  { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, index: LM.leftIndex, pinky: LM.leftPinky },
  { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, index: LM.rightIndex, pinky: LM.rightPinky },
] as const;

/**
 * Reads one frame of the hands-up check. `T` and `W` are the player's torso length and shoulder width from the profile
 * (image heights); the shoulder line is read from this frame, so a player who lifts their shoulders is not misread.
 */
export function readHands(lm: readonly Landmark[], T: number, W: number): HandsReading {
  const shY = ((lm[LM.leftShoulder] as Landmark).y + (lm[LM.rightShoulder] as Landmark).y) / 2;
  const t = Math.max(T, 0.02);
  let top = Infinity, centreY = Infinity, lost = false, raised = true;
  for (const s of SIDES) {
    const wrist = lm[s.wrist] as Landmark, elbow = lm[s.elbow] as Landmark, index = lm[s.index] as Landmark, pinky = lm[s.pinky] as Landmark;
    const wristUp = (shY - wrist.y) / t >= HEADROOM.wristRaisedT;
    const elbowUp = elbow.visibility >= HEADROOM.elbowVisibility && (shY - elbow.y) / t >= HEADROOM.elbowRaisedT;
    if (!wristUp && !elbowUp) raised = false;
    if (wrist.visibility < HEADROOM.lostVisibility) lost = true;
    top = Math.min(top, wrist.y, index.y, pinky.y);
    centreY = Math.min(centreY, (wrist.y + index.y + pinky.y) / 3);
  }
  if (!raised) return { state: 'down', top, centreY };

  const needTop = shY - HEADROOM.reachT * t;          // where the wrists of straight arms would be
  const cut = top < HEADROOM.margin || lost || needTop < -HEADROOM.tolerance;
  if (!cut) return { state: 'ok', top, centreY };

  // How much more room is wanted: scale the picture about its centre until the higher of the two (the hands now, the
  // straight arms) sits at the margin. A camera aimed too low or high makes this a rough range, hence whole steps.
  const est = Math.min(top, needTop);
  const wv = Math.max(W, 0.02);
  let hint: CalibrationHint;
  if (est < HEADROOM.margin) {
    const goal = wv * ((0.5 - HEADROOM.margin) / (0.5 - est));
    const farEnough = distanceM(wv) >= HEADROOM.farM || distanceM(goal) - distanceM(wv) <= MIN_BACK_M;
    hint = farEnough ? { action: 'tilt_camera_up' } : moveHint('step_back', wv, goal);
  } else {
    hint = { action: 'step_back', steps: { min: 1, max: 2 } };   // the wrist was lost although it is inside: more room helps
  }
  return { state: 'cut', top, centreY, hint };
}
