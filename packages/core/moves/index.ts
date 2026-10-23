// The movement library registry (game-design.md 0.5). The platform builder seeded the runner's three signals
// (M1 squat depth, M2 jump, M3 lean) with today's thresholds; the movement-library builder adds M4..M16.
import type { DetectorRegistry } from '../types/index.ts';
import { createJumpDetector } from './jump.ts';
import { createLeanDetector } from './lean.ts';
import { createSquatDetector } from './squat.ts';

export const DETECTORS: DetectorRegistry = {
  squat: createSquatDetector,
  jump: createJumpDetector,
  lean: createLeanDetector,
};

export { createJumpDetector, createLeanDetector, createSquatDetector };
