// The parts of the body line and the landmarks each one is drawn between. Torso, neck, shoulders and hips use midpoints.
import { LM } from '../types/index.ts';
import type { Side } from './geometry.ts';
import type { SegState, SegmentId } from './types.ts';

/** [from, to]: a landmark index, or a pair of indices whose midpoint is used. */
export type End = number | readonly [number, number];

export const SEGMENTS: Readonly<Record<SegmentId, readonly [End, End]>> = {
  neck: [LM.nose, [LM.leftShoulder, LM.rightShoulder]],
  shoulders: [LM.leftShoulder, LM.rightShoulder],
  hips: [LM.leftHip, LM.rightHip],
  torso: [[LM.leftShoulder, LM.rightShoulder], [LM.leftHip, LM.rightHip]],
  upperArmL: [LM.leftShoulder, LM.leftElbow],
  upperArmR: [LM.rightShoulder, LM.rightElbow],
  forearmL: [LM.leftElbow, LM.leftWrist],
  forearmR: [LM.rightElbow, LM.rightWrist],
  thighL: [LM.leftHip, LM.leftKnee],
  thighR: [LM.rightHip, LM.rightKnee],
  shinL: [LM.leftKnee, LM.leftAnkle],
  shinR: [LM.rightKnee, LM.rightAnkle],
  footL: [LM.leftAnkle, LM.leftFootIndex],
  footR: [LM.rightAnkle, LM.rightFootIndex],
};

export const SEGMENT_IDS = Object.keys(SEGMENTS) as SegmentId[];

/** Per-side parts. */
export const arm = (s: Side): SegmentId[] => (s === 'L' ? ['upperArmL', 'forearmL'] : ['upperArmR', 'forearmR']);
export const forearm = (s: Side): SegmentId => (s === 'L' ? 'forearmL' : 'forearmR');
export const upperArm = (s: Side): SegmentId => (s === 'L' ? 'upperArmL' : 'upperArmR');
export const thigh = (s: Side): SegmentId => (s === 'L' ? 'thighL' : 'thighR');
export const shin = (s: Side): SegmentId => (s === 'L' ? 'shinL' : 'shinR');

/** Severity order when several rules colour one part: bad wins over tip over ok; unknown only when nothing is measured. */
const RANK: Record<SegState, number> = { none: 0, unknown: 1, ok: 2, tip: 3, bad: 4 };
export const worse = (a: SegState, b: SegState): SegState => (RANK[b] > RANK[a] ? b : a);

export function emptySegments(): Record<SegmentId, SegState> {
  const out = {} as Record<SegmentId, SegState>;
  for (const id of SEGMENT_IDS) out[id] = 'none';
  return out;
}
