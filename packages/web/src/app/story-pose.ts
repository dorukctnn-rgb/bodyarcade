// What the figure of the vertical clip does at each moment: the move of the game that was played (a squat for Squat Flap, arm jacks for
// Firework Jacks, a twist for Twist Turbine...), then a jump with both hands up when the score is shown. A pose is the direction of the
// ten limbs in degrees in the mirrored picture (the convention of the Mover and the pose library: 0 = screen right, 90 = up), how far
// each limb points toward the camera, a twist of the shoulders, and how high the figure is off the ground. The 3D figure (story-figure.ts)
// and the flat stand-in (the Mover, when the 3D figure cannot be drawn) are posed from the same numbers. Pure, so it has tests.
import { JACK_OPEN, LIMB_NAMES, mixLimbs, STAND, type LimbKey, type Limbs } from '../../../games/_shared/mover.ts';

export interface StoryPose {
  limbs: Limbs;
  /** 0 to 1 per limb: how much of it points toward the camera (a punch, a knee lifted in front). */
  fwd: Partial<Record<LimbKey, number>>;
  /** Degrees the shoulders turn about the spine (a twist); + turns the figure's right shoulder back. */
  twist: number;
  /** Metres off the ground (a jump). */
  lift: number;
}

export type StoryMove = 'squat' | 'highKnee' | 'jackOpen' | 'punch' | 'reach' | 'twist' | 'sideBend' | 'pull' | 'tPose' | 'leanLeft' | 'stand';

const MOVES: readonly StoryMove[] = ['squat', 'highKnee', 'jackOpen', 'punch', 'reach', 'twist', 'sideBend', 'pull', 'tPose', 'leanLeft', 'stand'];

/** The choreography of a game's move (the catalogue's `move`); a move without one of its own is a light bounce. */
export function storyMoveOf(move: string | undefined): StoryMove {
  return (MOVES as readonly string[]).includes(move ?? '') ? (move as StoryMove) : 'stand';
}

const L = (o: Partial<Limbs>): Limbs => ({ ...STAND, ...o });

const SQUAT_DOWN = L({ thighL: -138, thighR: -42, shinL: -98, shinR: -82, armUpperL: -125, armUpperR: -55, armLowerL: -115, armLowerR: -65 });
const ARMS_UP = L({ armUpperL: 115, armUpperR: 65, armLowerL: 105, armLowerR: 75 });
const HANDS_UP = L({ armUpperL: 100, armUpperR: 80, armLowerL: 95, armLowerR: 85 });
const GUARD = L({ armUpperL: -100, armUpperR: -80, armLowerL: 80, armLowerR: 100 });
const T_POSE = L({ armUpperL: 180, armUpperR: 0, armLowerL: 180, armLowerR: 0 });
const Y_POSE = L({ armUpperL: 120, armUpperR: 60, armLowerL: 120, armLowerR: 60 });
const STAR = L({ armUpperL: 150, armUpperR: 30, armLowerL: 150, armLowerR: 30, thighL: -115, thighR: -65, shinL: -115, shinR: -65 });
const CACTUS = L({ armUpperL: 180, armUpperR: 0, armLowerL: 90, armLowerR: 90 });
const BEND_L = L({ armUpperL: 120, armUpperR: 120, armLowerL: 120, armLowerR: 120, torso: 115, neck: 112 });
const BEND_R = L({ armUpperL: 60, armUpperR: 60, armLowerL: 60, armLowerR: 60, torso: 65, neck: 68 });
const CLIMB_L = L({ armUpperL: 100, armLowerL: 95, armUpperR: 20, armLowerR: 100, thighL: -60, shinL: -100 });
const CLIMB_R = L({ armUpperR: 80, armLowerR: 85, armUpperL: 160, armLowerL: 80, thighR: -120, shinR: -80 });
const REACH_L = L({ armUpperL: 135, armLowerL: 135, armUpperR: -70, armLowerR: -80, torso: 100, neck: 98 });
const REACH_R = L({ armUpperR: 45, armLowerR: 45, armUpperL: -110, armLowerL: -100, torso: 80, neck: 82 });
const LEAN_L = L({ torso: 105, neck: 102, armUpperL: -125, armUpperR: -70 });
const LEAN_R = L({ torso: 75, neck: 78, armUpperL: -110, armUpperR: -55 });

const NONE: StoryPose['fwd'] = {};

/** 0 to 1 and back over a period, smooth at both ends. */
const wave = (tMs: number, periodMs: number, phase = 0): number => 0.5 - 0.5 * Math.cos(((tMs / periodMs) + phase) * Math.PI * 2);
/** Which of two halves of a period this moment is in, and how far into it (0 to 1, smoothed). */
function swing(tMs: number, periodMs: number): { side: 0 | 1; u: number } {
  const x = (((tMs / periodMs) % 1) + 1) % 1;
  const side: 0 | 1 = x < 0.5 ? 0 : 1;
  const k = (x % 0.5) / 0.5;
  return { side, u: Math.sin(k * Math.PI) };
}
const mixPose = (a: Limbs, b: Limbs, u: number): Limbs => mixLimbs(a, b, Math.max(0, Math.min(1, u)));
const pose = (limbs: Limbs, o: Partial<Omit<StoryPose, 'limbs'>> = {}): StoryPose => ({ limbs, fwd: o.fwd ?? NONE, twist: o.twist ?? 0, lift: o.lift ?? 0 });

/** The move itself, at `tMs` into it. */
export function movePose(move: StoryMove, tMs: number): StoryPose {
  switch (move) {
    case 'squat': {
      // down with the arms low, up with a flap of both arms
      const u = wave(tMs, 1500);
      const arms = mixPose(STAND, ARMS_UP, 1 - u);
      const legs = mixPose(STAND, SQUAT_DOWN, u);
      return pose({ ...arms, thighL: legs.thighL, thighR: legs.thighR, shinL: legs.shinL, shinR: legs.shinR }, { fwd: { armUpperL: 0.15 * u, armUpperR: 0.15 * u } });
    }
    case 'jackOpen': {
      const u = wave(tMs, 900);
      return pose(mixPose(STAND, JACK_OPEN as Limbs, u), { lift: 0.12 * Math.sin(Math.min(1, u * 1.0) * Math.PI) });
    }
    case 'highKnee': {
      const { side, u } = swing(tMs, 700);
      const knee = side === 0 ? { thighL: mixPose(STAND, L({ thighL: -100 }), u).thighL, shinL: -95 } : { thighR: mixPose(STAND, L({ thighR: -80 }), u).thighR, shinR: -85 };
      const fwd = side === 0 ? { thighL: 0.85 * u, armUpperR: 0.5 * u } : { thighR: 0.85 * u, armUpperL: 0.5 * u };
      return pose(L({ ...knee, armLowerL: 60, armLowerR: 120, armUpperL: -100, armUpperR: -80 }), { fwd, lift: 0.04 * u });
    }
    case 'punch': {
      const { side, u } = swing(tMs, 760);
      const fwd = side === 0 ? { armUpperL: 0.95 * u, armLowerL: 0.95 * u } : { armUpperR: 0.95 * u, armLowerR: 0.95 * u };
      const limbs = side === 0 ? mixPose(GUARD, L({ ...GUARD, armUpperL: -170, armLowerL: -175 }), u) : mixPose(GUARD, L({ ...GUARD, armUpperR: -10, armLowerR: -5 }), u);
      return pose(limbs, { fwd: { armLowerL: 0.6, armLowerR: 0.6, ...fwd }, twist: (side === 0 ? -14 : 14) * u });
    }
    case 'reach': {
      const { side, u } = swing(tMs, 1300);
      return pose(mixPose(STAND, side === 0 ? REACH_L : REACH_R, u));
    }
    case 'twist': {
      const u = Math.sin((tMs / 1400) * Math.PI * 2);
      return pose(L({ armUpperL: -60, armUpperR: -120, armLowerL: 10, armLowerR: 170 }), { fwd: { armUpperL: 0.7, armUpperR: 0.7, armLowerL: 0.6, armLowerR: 0.6 }, twist: 42 * u });
    }
    case 'sideBend': {
      const { side, u } = swing(tMs, 1700);
      return pose(mixPose(HANDS_UP, side === 0 ? BEND_L : BEND_R, u));
    }
    case 'pull': {
      const { side, u } = swing(tMs, 1100);
      return pose(mixPose(side === 0 ? CLIMB_R : CLIMB_L, side === 0 ? CLIMB_L : CLIMB_R, u), { fwd: { thighL: 0.3, thighR: 0.3 }, lift: 0.03 * u });
    }
    case 'tPose': {
      // the shapes of the wall, one after another
      const shapes = [T_POSE, Y_POSE, STAR, CACTUS];
      const per = 1100;
      const i = Math.floor(tMs / per);
      const a = shapes[((i % shapes.length) + shapes.length) % shapes.length] as Limbs;
      const b = shapes[(((i + 1) % shapes.length) + shapes.length) % shapes.length] as Limbs;
      const k = (tMs % per) / per;
      return pose(mixPose(a, b, k < 0.55 ? 0 : (k - 0.55) / 0.45));
    }
    case 'leanLeft': {
      const { side, u } = swing(tMs, 1400);
      return pose(mixPose(STAND, side === 0 ? LEAN_L : LEAN_R, u));
    }
    case 'stand':
    default:
      return pose(mixPose(STAND, L({ armUpperR: 40, armLowerR: 100 }), wave(tMs, 1600)), { lift: 0.03 * wave(tMs, 800) });
  }
}

/** The jump with both hands up when the score is shown: `u` 0 to 1 over the jump. */
export function cheerPose(u: number): StoryPose {
  const k = Math.max(0, Math.min(1, u));
  return pose(mixPose(STAND, HANDS_UP, Math.min(1, k * 3)), { lift: 0.35 * Math.sin(k * Math.PI) });
}

/** Mixes two poses (the move into the cheer and back). */
export function mixPoses(a: StoryPose, b: StoryPose, u: number): StoryPose {
  const k = Math.max(0, Math.min(1, u));
  const fwd: Partial<Record<LimbKey, number>> = {};
  for (const n of LIMB_NAMES) {
    const v = (a.fwd[n] ?? 0) * (1 - k) + (b.fwd[n] ?? 0) * k;
    if (v > 0.001) fwd[n] = v;
  }
  return { limbs: mixLimbs(a.limbs, b.limbs, k), fwd, twist: a.twist * (1 - k) + b.twist * k, lift: a.lift * (1 - k) + b.lift * k };
}

export { STAND };
