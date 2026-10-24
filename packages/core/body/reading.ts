// Reading: one pose frame in, what the camera can measure of the player out. It answers three questions the calibrator
// needs on every frame:
//   1. Which profile does this frame measure? 'full' (head to feet), 'seated' (head to hips), 'upper' (head and
//      shoulders; a desk), or nothing (types/body.ts FramingProfile). The best one that fits is `best`.
//   2. What stops the profile the game wants? `problem`, a code, with a measured `hint` (how many steps, which way).
//   3. Which parts are in view? `seen`, for the checklist of the screen.
// Only codes and numbers come out; the screen turns them into words.
import {
  LM, type CalibrationCode, type CalibrationHint, type CalibrationSeen, type Framing, type Landmark, type PoseFrame,
} from '../types/index.ts';
import { GOAL_WV, distanceM, lateralHint, moveHint } from './guidance.ts';
import { isVisible } from './geometry.ts';
import { PROFILE_OF, RANK_OF, type Rank } from './profile.ts';

/** Starting values for the framing, tuned on the real recordings (tests/traces/video). Raw image units unless noted. */
export const FIT = {
  /** A landmark nearer to a side of the picture than this share of the width is cut by it. */
  edge: 0.03,
  /** The hips and below count for the sides of the body from this visibility; a shoulder counts wherever it is placed. */
  extentVisibility: 0.25,
  /** Hips lower than this share of the height are about to leave the picture. */
  maxHipY: 0.97,
  maxLegY: 0.985,
  /** Shoulders wider than this share of the width: too close for head to hips or more (today's rule). */
  maxShoulderFrac: 0.45,
  /** Head and shoulders only (a desk): the shoulders may fill more of the picture. */
  maxShoulderFracUpper: 0.72,
  /** Shoulders narrower than this many image heights: too far for steady landmarks. */
  minShoulderV: 0.065,
  /** Full body: nose to ankle as a share of the picture height. */
  minSpan: 0.32,
  maxSpan: 0.92,
  /** Head to hips: the torso is shorter than this many image heights: too far. */
  minTorso: 0.05,
} as const;

export type Want = 'full' | 'upper' | 'side';

export interface Reading {
  /** The best profile this frame measures: 'full', 'seated', 'upper', for a side request 'side', or null. */
  best: 'full' | 'seated' | 'upper' | 'side' | null;
  /** The rank of `best` (side counts as 2: shoulders and hips are measured); 0 when nothing. */
  rank: 0 | Rank;
  /** What stops the wanted profile; null when the frame measures it. */
  problem: CalibrationCode | null;
  hint?: CalibrationHint;
  seen: CalibrationSeen;
  /** Shoulder width in image heights (0 when the shoulders are not both found). */
  shoulderV: number;
}

export const NOBODY: Reading = { best: null, rank: 0, problem: 'no_person', hint: { action: 'step_in' }, seen: { head: false, shoulders: false, hips: false, knees: false, feet: false }, shoulderV: 0 };

interface Look {
  lm: Landmark[];
  aspect: number;
  head: boolean; shoulders: boolean; hips: boolean; knees: boolean; feet: boolean;
  /** Shoulder width as a share of the picture width, and in image heights. */
  shoulderFrac: number;
  shoulderV: number;
  noseY: number;
  hipY: number;
  shoulderY: number;
  ankleY: number;
  /**
   * How far the parts a rank needs reach past the sides of the RAW picture (share of the width; 0 when inside). The raw
   * left is the right of the mirror the player sees, so a cut on the raw left means "move to your left", and the reverse.
   */
  cutRawLeft: (rank: Rank) => number;
  cutRawRight: (rank: Rank) => number;
}

const inside = (p: Landmark | undefined, maxY = 1): boolean => !!p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= maxY;
const vis = (lm: readonly Landmark[], i: number, maxY = 1): boolean => isVisible(lm, i) && inside(lm[i], maxY);
const both = (lm: readonly Landmark[], a: number, b: number, maxY = 1): boolean => vis(lm, a, maxY) && vis(lm, b, maxY);

/** The landmarks a rank needs in view, for the sides check. */
const NEEDED: Record<Rank, readonly number[]> = {
  1: [LM.leftShoulder, LM.rightShoulder],
  2: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
  3: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
};

function look(lm: Landmark[], aspect: number): Look {
  const ls = lm[LM.leftShoulder] as Landmark, rs = lm[LM.rightShoulder] as Landmark;
  const shoulders = both(lm, LM.leftShoulder, LM.rightShoulder);
  const shoulderFrac = Math.abs(ls.x - rs.x);
  const hipY = ((lm[LM.leftHip] as Landmark).y + (lm[LM.rightHip] as Landmark).y) / 2;
  const sides = (rank: Rank): { left: number; right: number } => {
    // The shoulders count wherever the model puts them (a shoulder past the side of the picture is placed, not seen);
    // the hips and below only when the model is at least a little sure of them.
    if (Math.max(ls.visibility, rs.visibility) < FIT.extentVisibility) return { left: 0, right: 0 };
    let minX = Infinity, maxX = -Infinity;
    for (const i of NEEDED[rank]) {
      const p = lm[i];
      if (!p || (i !== LM.leftShoulder && i !== LM.rightShoulder && p.visibility < FIT.extentVisibility)) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    }
    return { left: Number.isFinite(minX) ? Math.max(0, FIT.edge - minX) : 0, right: Number.isFinite(maxX) ? Math.max(0, maxX - (1 - FIT.edge)) : 0 };
  };
  return {
    lm, aspect,
    head: vis(lm, LM.nose),
    shoulders,
    hips: both(lm, LM.leftHip, LM.rightHip, FIT.maxHipY),
    knees: both(lm, LM.leftKnee, LM.rightKnee, FIT.maxLegY),
    feet: both(lm, LM.leftAnkle, LM.rightAnkle, FIT.maxLegY),
    shoulderFrac,
    shoulderV: shoulderFrac * aspect,
    noseY: (lm[LM.nose] as Landmark).y,
    hipY,
    shoulderY: (ls.y + rs.y) / 2,
    ankleY: Math.max((lm[LM.leftAnkle] as Landmark).y, (lm[LM.rightAnkle] as Landmark).y),
    cutRawLeft: (rank) => sides(rank).left,
    cutRawRight: (rank) => sides(rank).right,
  };
}

/** The goal shoulder width for stepping back, per wanted rank, in image heights. */
function backGoal(rank: Rank, aspect: number): number {
  return rank === 3 ? GOAL_WV.fullBack : rank === 2 ? GOAL_WV.seatedBack : 0.5 * aspect;
}
function closerGoal(rank: Rank): number {
  return rank === 3 ? GOAL_WV.fullCloser : rank === 2 ? GOAL_WV.seatedCloser : GOAL_WV.upperCloser;
}

interface Problem { code: CalibrationCode; hint: CalibrationHint }

/** Moving back helps only when the player is nearer than the goal distance by at least a quarter of a step. */
const MIN_BACK_M = 0.16;

/**
 * Advice for a part that is out of the picture at the top (head) or the bottom (hips, knees, feet): step back when the
 * player is nearer than the goal distance, otherwise the camera points the wrong way and tilting it is the fix.
 */
function backHint(l: Look, rank: Rank, vertical: 'head' | 'low'): CalibrationHint {
  const wv = l.shoulderV;
  if (wv < 0.02) return { action: 'step_back', steps: { min: 1, max: 2 } };
  const goal = backGoal(rank, l.aspect);
  if (distanceM(goal) - distanceM(wv) > MIN_BACK_M) return moveHint('step_back', wv, goal);
  return { action: vertical === 'head' ? 'tilt_camera_up' : 'tilt_camera_down' };
}

/** What stops `rank` on this look, or null. Order: the sides, the shoulders and head, the distance, then the parts below. */
function problemFor(l: Look, rank: Rank): Problem | null {
  const left = l.cutRawLeft(rank), right = l.cutRawRight(rank);
  const wv = l.shoulderV;
  if (left > 0 && right > 0) return { code: 'too_close', hint: backHint(l, rank, 'low') };
  if (left > 0) return { code: 'move_left', hint: lateralHint('move_left', (left + 0.02) * l.aspect, wv) };
  if (right > 0) return { code: 'move_right', hint: lateralHint('move_right', (right + 0.02) * l.aspect, wv) };
  if (!l.shoulders) {
    if (l.head) return { code: 'too_close', hint: { action: 'step_back', steps: { min: 1, max: 2 } } };
    return { code: l.hips ? 'head_out' : 'no_person', hint: l.hips ? { action: 'step_back', steps: { min: 1, max: 2 } } : { action: 'step_in' } };
  }
  if (!l.head) return { code: 'head_out', hint: backHint(l, rank, 'head') };
  const maxFrac = rank === 1 ? FIT.maxShoulderFracUpper : FIT.maxShoulderFrac;
  if (l.shoulderFrac > maxFrac) return { code: 'too_close', hint: moveHint('step_back', wv, backGoal(rank, l.aspect)) };
  if (wv < FIT.minShoulderV) return { code: 'too_far', hint: moveHint('step_closer', wv, closerGoal(rank)) };
  if (rank >= 2) {
    if (!l.hips) return { code: 'hips_out', hint: backHint(l, rank, 'low') };
    if (l.hipY - l.shoulderY < FIT.minTorso) return { code: 'too_far', hint: moveHint('step_closer', wv, closerGoal(rank)) };
  }
  if (rank === 3) {
    if (!l.knees) return { code: 'knees_out', hint: backHint(l, rank, 'low') };
    if (!l.feet) return { code: 'feet_out', hint: backHint(l, rank, 'low') };
    const span = l.ankleY - l.noseY;
    if (span > FIT.maxSpan) return { code: 'too_close', hint: moveHint('step_back', wv, backGoal(rank, l.aspect)) };
    if (span < FIT.minSpan) return { code: 'too_far', hint: moveHint('step_closer', wv, closerGoal(rank)) };
  }
  return null;
}

/** Side framing (push-ups, planks): the shoulder and hip of one side in view, and a foot. The far side may be hidden. */
function sideProblem(l: Look): Problem | null {
  const lm = l.lm;
  const side = (s: 'left' | 'right'): boolean => isVisible(lm, s === 'left' ? LM.leftShoulder : LM.rightShoulder) && isVisible(lm, s === 'left' ? LM.leftHip : LM.rightHip);
  const anyShoulder = isVisible(lm, LM.leftShoulder) || isVisible(lm, LM.rightShoulder);
  if (!side('left') && !side('right')) return { code: anyShoulder ? 'hips_out' : 'no_person', hint: anyShoulder ? { action: 'step_back', steps: { min: 1, max: 2 } } : { action: 'step_in' } };
  if (!isVisible(lm, LM.leftAnkle) && !isVisible(lm, LM.rightAnkle)) return { code: 'feet_out', hint: { action: 'step_back', steps: { min: 1, max: 2 } } };
  return null;
}

function seenOf(l: Look): CalibrationSeen {
  return { head: l.head, shoulders: l.shoulders, hips: l.hips, knees: l.knees, feet: l.feet };
}

/** Reads one frame's landmarks against what the game wants. */
export function read(lm: Landmark[] | null, aspect: number, want: Want): Reading {
  if (!lm) return NOBODY;
  const l = look(lm, aspect);
  if (want === 'side') {
    const p = sideProblem(l);
    return { best: p ? null : 'side', rank: p ? 0 : 2, problem: p ? p.code : null, ...(p ? { hint: p.hint } : {}), seen: seenOf(l), shoulderV: l.shoulderV };
  }
  const probs = { 3: problemFor(l, 3), 2: problemFor(l, 2), 1: problemFor(l, 1) } as const;
  const rank: 0 | Rank = probs[3] === null ? 3 : probs[2] === null ? 2 : probs[1] === null ? 1 : 0;
  const wantRank = RANK_OF[want];
  const problem = rank >= wantRank ? null : probs[wantRank];
  return {
    best: rank === 0 ? null : PROFILE_OF[rank],
    rank,
    problem: problem ? problem.code : null,
    ...(problem ? { hint: problem.hint } : {}),
    seen: seenOf(l),
    shoulderV: l.shoulderV,
  };
}

/** Frames of a pose service that carry more than one person (solo calibration runs the model for two to notice a crowd). */
export function othersInView(f: PoseFrame, minShare = 0.6): number {
  const poses = f.poses;
  if (!poses || poses.length < 2) return 0;
  const width = (p: Landmark[]): number => (isVisible(p, LM.leftShoulder, 0.4) && isVisible(p, LM.rightShoulder, 0.4) ? Math.abs((p[LM.leftShoulder] as Landmark).x - (p[LM.rightShoulder] as Landmark).x) : 0);
  const widths = poses.map(width).sort((a, b) => b - a);
  const main = widths[0] ?? 0;
  if (main <= 0) return 0;
  return widths.slice(1).filter((w) => w >= main * minShare).length;
}
