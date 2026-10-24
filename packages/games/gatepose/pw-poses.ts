// The shapes of Pose Wall: the pose library of core/moves (poses.ts) plus a few upper body shapes of this game, grouped by the
// level that first asks for them, and the seated way of asking: the same shape with the legs left out (a seated player's thighs
// are not under the hips, so only the arms, the trunk and the neck are judged).
//
// Only shapes that can be read from the front are here (no limb points at the camera), no deep backward bend, and the balance
// shapes (one foot up) only on the hardest level with a note to stand beside something to hold. The angles are authored from
// the geometry of the body, not measured on people: the recording day tunes them.
import { POSES, needsLegs, type PoseTarget } from '../../core/moves/poses.ts';
import type { Difficulty } from '../strength/kit.ts';

const UP = { torso: 90, neck: 90 } as const;

/** Upper body shapes of this game. Angles in degrees in the mirrored picture: 0 = screen right, 90 = up, -90 = down. */
const EXTRA: readonly PoseTarget[] = [
  { name: 'raiseRight', limbs: { armUpperR: 90, armLowerR: 90, armUpperL: -90, armLowerL: -90, ...UP } },
  { name: 'raiseLeft', limbs: { armUpperL: 90, armLowerL: 90, armUpperR: -90, armLowerR: -90, ...UP } },
  { name: 'diagonalRight', limbs: { armUpperR: 45, armLowerR: 45, armUpperL: -135, armLowerL: -135, ...UP } },
  { name: 'diagonalLeft', limbs: { armUpperL: 135, armLowerL: 135, armUpperR: -45, armLowerR: -45, ...UP } },
];

export const PW_LIBRARY: readonly PoseTarget[] = [...POSES, ...EXTRA];

const byName = new Map(PW_LIBRARY.map((p) => [p.name, p] as const));

/** The shapes each level adds to the ones before it (standing). */
const TIERS: readonly (readonly string[])[] = [
  ['tPose', 'handsUp', 'yPose', 'cactus'],
  ['star', 'bendRight', 'bendLeft', 'raiseRight', 'raiseLeft'],
  ['diagonalRight', 'diagonalLeft', 'sideLungeRight', 'sideLungeLeft'],
  ['treeRight', 'treeLeft', 'squatT'],
];
const TIER_OF: Readonly<Record<Difficulty, number>> = { easy: 0, normal: 1, hard: 2, expert: 3 };

/** The names a level draws from. Seated play keeps the shapes that do not need the legs. */
export function poolFor(level: Difficulty, seated: boolean): string[] {
  const names = TIERS.slice(0, TIER_OF[level] + 1).flat();
  if (!seated) return names;
  return names.filter((n) => {
    const p = byName.get(n) as PoseTarget;
    return p.minDrop === undefined && !/lunge|tree/i.test(n);
  });
}

/** The shape with this name; seated: without its leg limbs. */
export function shapeOf(name: string, seated: boolean): PoseTarget {
  const p = byName.get(name);
  if (!p) throw new Error(`No shape called ${name}.`);
  if (!seated || !needsLegs(p)) return p;
  const limbs = Object.fromEntries(Object.entries(p.limbs).filter(([k]) => !k.startsWith('thigh') && !k.startsWith('shin')));
  return { name: p.name, limbs };
}

/** Does the shape put a foot off the floor (stand beside something to hold)? */
export const needsSupport = (name: string): boolean => /^tree/i.test(name);
