// The pose library for M12 (game-design.md card 34 Pose Wall, card 33 Rock Paper Pose, card 36 Tree Garden): each pose is
// the direction of up to ten limbs, in degrees in the mirrored picture the player sees: 0 = screen right, 90 = up,
// 180 = screen left, -90 = down. The player's right arm points to 0 when it stretches out to the side.
//
// Only poses that can be read from the front are here (no limb pointing at the camera; card 34). Angles are authored from
// the geometry of the body, not measured on people: tune with the recording day. A pose without leg limbs is an upper
// body pose and works seated; `minDrop` asks for a squat on top (hip drop in T).
import type { LimbName } from './poseMatch.ts';

export interface PoseTarget {
  name: string;
  limbs: Partial<Record<LimbName, number>>;
  /** Hip drop D (T) the pose also needs, for the squat variants; the limb angles alone cannot see depth from the front. */
  minDrop?: number;
}

const BOTH_LEGS_DOWN = { thighL: -90, thighR: -90, shinL: -90, shinR: -90 } as const;
const UPRIGHT = { torso: 90, neck: 90 } as const;

export const POSES: readonly PoseTarget[] = [
  { name: 'tPose', limbs: { armUpperR: 0, armLowerR: 0, armUpperL: 180, armLowerL: 180, ...BOTH_LEGS_DOWN, ...UPRIGHT } },
  { name: 'star', limbs: { armUpperR: 30, armLowerR: 30, armUpperL: 150, armLowerL: 150, thighR: -65, shinR: -65, thighL: -115, shinL: -115, ...UPRIGHT } },
  { name: 'yPose', limbs: { armUpperR: 60, armLowerR: 60, armUpperL: 120, armLowerL: 120, ...BOTH_LEGS_DOWN, ...UPRIGHT } },
  { name: 'handsUp', limbs: { armUpperR: 90, armLowerR: 90, armUpperL: 90, armLowerL: 90, ...BOTH_LEGS_DOWN, ...UPRIGHT } },
  { name: 'bendRight', limbs: { armUpperR: 60, armLowerR: 60, armUpperL: 60, armLowerL: 60, torso: 60, neck: 60, ...BOTH_LEGS_DOWN } },
  { name: 'bendLeft', limbs: { armUpperR: 120, armLowerR: 120, armUpperL: 120, armLowerL: 120, torso: 120, neck: 120, ...BOTH_LEGS_DOWN } },
  { name: 'sideLungeRight', limbs: { armUpperR: 0, armLowerR: 0, armUpperL: 180, armLowerL: 180, thighR: -25, shinR: -90, thighL: -125, shinL: -125, ...UPRIGHT } },
  { name: 'sideLungeLeft', limbs: { armUpperR: 0, armLowerR: 0, armUpperL: 180, armLowerL: 180, thighL: -155, shinL: -90, thighR: -55, shinR: -55, ...UPRIGHT } },
  { name: 'treeRight', limbs: { armUpperR: 75, armLowerR: 100, armUpperL: 105, armLowerL: 80, thighR: -25, shinR: -135, thighL: -90, shinL: -90, ...UPRIGHT } },
  { name: 'treeLeft', limbs: { armUpperR: 75, armLowerR: 100, armUpperL: 105, armLowerL: 80, thighL: -155, shinL: -45, thighR: -90, shinR: -90, ...UPRIGHT } },
  { name: 'squatT', limbs: { armUpperR: 0, armLowerR: 0, armUpperL: 180, armLowerL: 180, ...UPRIGHT }, minDrop: 0.35 },
  // upper body only: they work seated (Pose Wall: "yalnız üst gövde duvarları")
  { name: 'cactus', limbs: { armUpperR: 0, armLowerR: 90, armUpperL: 180, armLowerL: 90, ...UPRIGHT } },
];

export const POSE_NAMES: readonly string[] = POSES.map((p) => p.name);

export function poseByName(name: string): PoseTarget | undefined {
  return POSES.find((p) => p.name === name);
}

/** Does the pose need the legs in view (any thigh or shin limb)? A pose without them is an upper body pose. */
export const needsLegs = (p: PoseTarget): boolean => Object.keys(p.limbs).some((k) => k.startsWith('thigh') || k.startsWith('shin'));

/** Does the pose read the arms? */
export const needsArms = (p: PoseTarget): boolean => Object.keys(p.limbs).some((k) => k.startsWith('arm'));
