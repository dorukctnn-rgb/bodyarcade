// The clips of the synthetic-person videos: what the person does, second by second, as pose specs for the rig (rig.ts).
// A clip is a pure function of time, so the same clip always gives the same pictures. The labels of a clip are not written
// down here: they are measured on the true 3D joints of every rendered frame (labels.ts), with the definitions of the
// movement library (game-design.md 0.5), so the rig's own geometry (leg reach, arm length) decides when a rep happens.
//
// Units: lengths in torso lengths T, angles in degrees, times in seconds. The person's left is the picture's right.
import type { MovementId } from '../../packages/core/types/index.ts';
import { STAND, type ArmCmd, type PoseSpec } from './rig.ts';

export const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));

/** 0 before t0, rising to 1 over `rise` s, held for `hold` s, falling back to 0 over `fall` s; 0 after. */
export function bump(t: number, t0: number, rise: number, hold: number, fall: number): number {
  if (t <= t0) return 0;
  if (t < t0 + rise) return smooth((t - t0) / rise);
  if (t < t0 + rise + hold) return 1;
  if (t < t0 + rise + hold + fall) return 1 - smooth((t - t0 - rise - hold) / fall);
  return 0;
}

/** `bump` repeated every `period` s, `n` times from t0. */
export function repeat(t: number, t0: number, period: number, n: number, rise: number, hold: number, fall: number): number {
  const k = Math.floor((t - t0) / period);
  if (t < t0 || k >= n) return 0;
  return bump(t - k * period, t0, rise, hold, fall);
}

export const mixArm = (a: ArmCmd, b: ArmCmd, u: number): ArmCmd => ({ az: lerp(a.az, b.az, u), el: lerp(a.el, b.el, u), reach: lerp(a.reach ?? 0.97, b.reach ?? 0.97, u) });

export const HANG: ArmCmd = STAND.armL;
/** Arms straight out in front. */
export const FRONT: ArmCmd = { az: 0, el: 6, reach: 0.985 };
/** Arms straight up beside the head (hands over the head). */
export const UP: ArmCmd = { az: 12, el: 84, reach: 0.985 };
/** Arms straight out to the sides at shoulder height. */
export const SIDE: ArmCmd = { az: 90, el: 4, reach: 0.985 };

const stand = (): PoseSpec => ({ armL: HANG, armR: HANG });

export interface Clip {
  id: string;
  about: string;
  seconds: number;
  /** Which way of standing in front of the camera: head to feet, or head to hips (a desk webcam). */
  framing: 'full' | 'upper';
  /** Pose of person `i` at time t (seconds). */
  pose(t: number, i: number): PoseSpec;
  /** Number of people in the picture. */
  people: number;
  /** Movements whose events the clip's labels are about (what to score it with). */
  scored: MovementId[];
  /** Which label rule of labels.ts applies. */
  rule: 'still' | 'squat' | 'shallow' | 'jump' | 'jack' | 'march' | 'lean' | 'twist' | 'bend' | 'press' | 'pair';
}

const REP = 2.2;

export const CLIPS: Clip[] = [
  {
    id: 'idle-10s', about: 'Standing still, breathing: nothing may be detected.', seconds: 10, framing: 'full', people: 1, scored: ['squat', 'jump', 'lean', 'kneeLift', 'jumpingJack', 'twist', 'sideBend', 'overheadPress'], rule: 'still',
    pose: (t) => ({ ...stand(), rise: 0.004 * Math.sin((2 * Math.PI * t) / 3.2), headYaw: 2 * Math.sin((2 * Math.PI * t) / 5.1) }),
  },
  {
    id: 'squat-6x', about: 'Six deep squats with the arms forward, one every 2.2 s.', seconds: 15, framing: 'full', people: 1, scored: ['squat'], rule: 'squat',
    pose: (t) => {
      const u = repeat(t, 1.2, REP, 6, 0.8, 0.15, 0.8);
      const arms = mixArm(HANG, FRONT, smooth(clamp01(u * 1.6)));
      return { armL: arms, armR: arms, drop: 0.62 * u, flex: 18 * u, hipZ: -0.18 * u, footL: { pole: [0.35, 1] }, footR: { pole: [0.35, 1] } };
    },
  },
  {
    id: 'squat-shallow', about: 'Six shallow dips (a quarter squat): too small to count, nothing may be detected.', seconds: 15, framing: 'full', people: 1, scored: ['squat'], rule: 'shallow',
    pose: (t) => {
      const u = repeat(t, 1.2, REP, 6, 0.7, 0.1, 0.7);
      return { ...stand(), drop: 0.2 * u };
    },
  },
  {
    id: 'jump-5x', about: 'Five jumps with a dip before each, arms swinging, one every 2 s.', seconds: 13, framing: 'full', people: 1, scored: ['jump'], rule: 'jump',
    pose: (t) => {
      const period = 2;
      const k = Math.floor((t - 1.2) / period);
      const l = t - 1.2 - k * period;
      if (t < 1.2 || k >= 5) return stand();
      // 0.0-0.3 dip, 0.3-0.85 in the air (a parabola), then settle.
      const dip = l < 0.3 ? smooth(l / 0.3) : l < 0.4 ? 1 - smooth((l - 0.3) / 0.1) : 0;
      const air = l >= 0.3 && l < 0.85 ? 4 * ((l - 0.3) / 0.55) * (1 - (l - 0.3) / 0.55) : 0;
      const land = l >= 0.85 && l < 1.15 ? 0.14 * Math.sin(Math.PI * ((l - 0.85) / 0.3)) : 0;
      const rise = 0.55 * air;
      const swing = l < 0.3 ? 0 : l < 0.85 ? smooth((l - 0.3) / 0.25) : 1 - smooth((l - 0.85) / 0.4);
      const arms = mixArm(HANG, { az: 25, el: 50, reach: 0.985 }, swing);
      const feet = { dy: rise, pitch: air > 0 ? 25 : 0, pole: [0.2, 1] as const };
      return { armL: arms, armR: arms, rise, drop: 0.3 * dip + land, footL: feet, footR: feet };
    },
  },
  {
    id: 'jacks-8x', about: 'Eight jumping jacks, one every 1.1 s.', seconds: 12, framing: 'full', people: 1, scored: ['jumpingJack'], rule: 'jack',
    pose: (t) => {
      // 0.0-0.45 open, 0.45-0.55 held, 0.55-1.0 closed again (smooth both ways).
      const u = repeat(t, 1.2, 1.1, 8, 0.4, 0.12, 0.4);
      const arm = mixArm(HANG, { az: 55, el: 80, reach: 0.985 }, u);
      const hop = 0.05 * Math.sin(Math.PI * clamp01(u));
      return { armL: arm, armR: arm, rise: hop, footL: { dx: 0.8 * u, dy: hop * 0.9 }, footR: { dx: -0.8 * u, dy: hop * 0.9 } };
    },
  },
  {
    id: 'march-10x', about: 'Marching on the spot, knee to hip height, ten lifts, left first.', seconds: 11, framing: 'full', people: 1, scored: ['kneeLift'], rule: 'march',
    pose: (t) => {
      const up = (t0: number): number => bump(t, t0, 0.26, 0.05, 0.26);
      let l = 0;
      let r = 0;
      for (let i = 0; i < 5; i++) { l = Math.max(l, up(1.2 + i * 1.2)); r = Math.max(r, up(1.8 + i * 1.2)); }
      const swing = (u: number, side: 1 | -1): ArmCmd => ({ az: 8, el: -88 + 28 * u * side, reach: 0.985 });
      // A lift: the ankle rises and moves forward (the leg solver bends the knee). The numbers are measured in labels.ts as k.
      const foot = (u: number): PoseSpec['footL'] => ({ dy: 0.86 * u, dz: 0.52 * u, pitch: 25 * u, pole: [0.1, 1] });
      return { armL: swing(r, 1), armR: swing(l, 1), footL: foot(l), footR: foot(r) };
    },
  },
  {
    id: 'lean-lr', about: 'Leaning left and right, three times each, held for a second.', seconds: 16, framing: 'full', people: 1, scored: ['lean'], rule: 'lean',
    pose: (t) => {
      // right (the person's right) at 1.2, 5.2, 9.2 ... then left at 3.2, 7.2, 11.2: each 0.7 s in, 1.0 s held, 0.7 s out.
      let side = 0;
      for (let i = 0; i < 3; i++) { side += 24 * bump(t, 1.2 + i * 4.4, 0.7, 1.0, 0.7); side -= 24 * bump(t, 3.4 + i * 4.4, 0.7, 1.0, 0.7); }
      return { ...stand(), side, hipX: -0.02 * side / 24 };
    },
  },
  {
    id: 'twist-8x', about: 'Hands together in front, the trunk turns to the left and to the right, eight turns.', seconds: 14, framing: 'full', people: 1, scored: ['twist'], rule: 'twist',
    pose: (t) => {
      // starts at the middle, turns to the right first, 1.4 s per turn.
      const phase = t < 1.2 ? 0 : Math.sin((2 * Math.PI * (t - 1.2)) / 2.8);
      const hands: ArmCmd = { az: 0, el: 4, reach: 0.78 };
      return { armL: { ...hands, az: -14 }, armR: { ...hands, az: -14 }, twist: -48 * phase, headYaw: -20 * phase };
    },
  },
  {
    id: 'bend-hold', about: 'Side bends with the arms up: right, left, right, left, each held for 2 s.', seconds: 17, framing: 'full', people: 1, scored: ['sideBend'], rule: 'bend',
    pose: (t) => {
      let side = 0;
      for (let i = 0; i < 4; i++) side += (i % 2 === 0 ? 1 : -1) * 28 * bump(t, 1.4 + i * 3.8, 0.8, 2.0, 0.8);
      return { armL: UP, armR: UP, side };
    },
  },
  {
    id: 'press-6x', about: 'Overhead press, hands from the shoulders to above the head, six presses.', seconds: 15, framing: 'full', people: 1, scored: ['overheadPress'], rule: 'press',
    pose: (t) => {
      const u = repeat(t, 1.4, 2.0, 6, 0.55, 0.2, 0.6);
      // rack: elbows bent, hands at the shoulders (az 40, el -30 short reach); lockout: straight up.
      const rack: ArmCmd = { az: 70, el: -5, reach: 0.34 };
      const top: ArmCmd = { az: 6, el: 88, reach: 0.985 };
      const arm = mixArm(rack, top, u);
      return { armL: arm, armR: arm };
    },
  },
  {
    id: 'pair-squat', about: 'Two people side by side: the left one squats five times, the right one squats five times, half a beat later.', seconds: 14, framing: 'full', people: 2, scored: ['squat'], rule: 'pair',
    pose: (t, i) => {
      const u = repeat(t, 1.2 + (i === 1 ? 1.1 : 0), REP, 5, 0.8, 0.15, 0.8);
      const arms = mixArm(HANG, FRONT, smooth(clamp01(u * 1.6)));
      return { armL: arms, armR: arms, drop: 0.6 * u, flex: 16 * u, hipZ: -0.16 * u, footL: { pole: [0.35, 1] }, footR: { pole: [0.35, 1] } };
    },
  },
];

export const clipById = (id: string): Clip | undefined => CLIPS.find((c) => c.id === id);
