// The movement library registry: M4..M16 plus the flap variant of M1 (game-design.md 0.5).
//
// - `LIBRARY_DETECTORS`: what this builder owns. index.ts spreads it into `DETECTORS`, so a game manifest can name any
//   of these ids in `detectors` and the MovementEngine finds the factory.
// - `ALL_DETECTORS`: the same plus the runner's jump and lean, for tests that do not go through index.ts.
//
// Every factory builds an independent detector (no module state): two local players get one instance each.
//
// 'squat' is routed here: with the option `flap: 1` it is the Squat Flap detector (glide while down, flap on the rise,
// squatFlap.ts); without it, it is the runner's plain squat (squat.ts).
import type { BodyProfile, DetectorFactory, DetectorRegistry } from '../types/index.ts';
import { createArmDirectionDetector } from './armDirection.ts';
import { createHandHitDetector } from './handHit.ts';
import { createJumpDetector } from './jump.ts';
import { createJumpingJackDetector } from './jumpingJack.ts';
import { createKneeLiftDetector } from './kneeLift.ts';
import { createLeanDetector } from './lean.ts';
import { createPoseMatchDetector } from './poseMatch.ts';
import { createPullDetector } from './pull.ts';
import { createSideBendDetector } from './sideBend.ts';
import { createSquatDetector } from './squat.ts';
import { createSquatFlapDetector } from './squatFlap.ts';
import { createSwipeDetector } from './swipe.ts';
import { createTwistDetector } from './twist.ts';

export const createSquatRouter: DetectorFactory = (p: BodyProfile, opts) => (opts && opts.flap ? createSquatFlapDetector(p, opts) : createSquatDetector(p, opts));

export const LIBRARY_DETECTORS: DetectorRegistry = {
  squat: createSquatRouter,
  armDirection: createArmDirectionDetector,
  kneeLift: createKneeLiftDetector,
  handHit: createHandHitDetector,
  jumpingJack: createJumpingJackDetector,
  twist: createTwistDetector,
  pull: createPullDetector,
  sideBend: createSideBendDetector,
  poseMatch: createPoseMatchDetector,
  swipe: createSwipeDetector,
};

export const ALL_DETECTORS: DetectorRegistry = {
  jump: createJumpDetector,
  lean: createLeanDetector,
  ...LIBRARY_DETECTORS,
};
