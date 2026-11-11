// Calf, step and wall moves, the arm warm-up and the hip hinge (Faz 3). SPEC.md 5.7 rows 65-69 and 5.3 row 21.
//
// Calf raise: the shoulders' rise over standing flat, in torso lengths; the reference is the lowest the shoulders were in the
// last 4 s while both legs were straight (a squat's stand-up is a rise too, so bent legs do not count and do not move the
// reference). A heel raise lifts the body a few centimetres: full at 0.08 torso lengths (about 4 cm). Count only (the heel and
// toe points jitter too much to judge the height of the raise).
// Step-up: the hips' rise over the floor they stood on (the lowest in the last 6 s), full at 0.4 thigh lengths. Count only.
// Wall angel: both hands from about the shoulders to over the head (like the shoulder press). Count only (touching the wall
// is contact).
// Arm circles: time with both arms out to the sides at about shoulder height. Time only.
// Good morning: the hip hinge from the side, shoulder-hip-knee 172 -> 120 degrees, knees soft (HINGE), depth a tip only
// (HINGE-DEP: how far one can hinge depends on the hamstrings, not on form). A rounding back is not measured (no spine points).
import type { BodyCtx, MoveDef } from '../types.ts';
import { at, pair } from './kit.ts';
import { handHeight, hipAngle, kneeAngle, lowerHand, thighDrop } from './legs.ts';

type B = Omit<BodyCtx, 'p' | 'phase'>;

const LEGS: MoveDef['parts'] = ['head', 'shoulders', 'hips', 'knees', 'feet'];
const UPPER: MoveDef['parts'] = ['head', 'shoulders', 'elbows', 'hands'];

/** Both legs straight: from the side the near knee at 165 degrees or more, otherwise both thighs hanging nearly vertical. */
function legsStraight(b: B): boolean | null {
  if (b.view === 'side') {
    const k = kneeAngle(b, b.near, true);
    return k === null ? null : k >= 165;
  }
  const l = thighDrop(b, 'L'), r = thighDrop(b, 'R');
  return l === null || r === null ? null : l >= 0.93 && r >= 0.93;
}

function calf(full: number) {
  return (): ((b: B) => number | null) => {
    const ring: { t: number; y: number }[] = [];
    return (b) => {
      const sh = b.view === 'side' ? at(b, b.near, 'shoulder', true) : pair(b, 'shoulder', true);
      const straight = legsStraight(b);
      if (!sh || straight === null || b.len.torso <= 0) return null;
      if (!straight) return 0;
      ring.push({ t: b.t, y: sh.y });
      while (ring.length && ring[0]!.t < b.t - 4000) ring.shift();
      let flat = -Infinity;
      for (const r of ring) if (r.y > flat) flat = r.y;
      return Math.max(0, Math.min(1.5, (flat - sh.y) / b.len.torso / full));
    };
  };
}

export const calfRaise: MoveDef = {
  id: 'calfRaise', label: 'S', group: 'standing', views: ['side', 'diag', 'front'], parts: LEGS,
  rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 500 },
  makeProgress: calf(0.08),
  rules: [],
  returnCue: 'calf.lowerHeels',
};

/** One leg: the same rise, a little smaller (full at 0.07). */
export const singleCalfRaise: MoveDef = { ...calfRaise, id: 'singleCalfRaise', makeProgress: calf(0.07) };

export const stepUp: MoveDef = {
  id: 'stepUp', label: 'S', group: 'standing', equipment: ['step'], views: ['side', 'diag', 'front'], parts: LEGS,
  rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 700 },
  makeProgress() {
    const ring: { t: number; y: number }[] = [];
    return (b) => {
      const hips = b.view === 'side' ? at(b, b.near, 'hip', true) : pair(b, 'hip', true);
      if (!hips || b.len.thigh <= 0) return null;
      ring.push({ t: b.t, y: hips.y });
      while (ring.length && ring[0]!.t < b.t - 6000) ring.shift();
      let floor = -Infinity;
      for (const r of ring) if (r.y > floor) floor = r.y;
      return Math.max(0, Math.min(1.5, (floor - hips.y) / b.len.thigh / 0.4));
    };
  },
  rules: [],
  returnCue: 'stepUp.stepDown',
};

export const wallAngel: MoveDef = {
  id: 'wallAngel', label: 'S', group: 'standing', equipment: ['wall'], views: ['front'], parts: UPPER,
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const h = lowerHand(b);
    return h === null ? null : Math.max(0, Math.min(1.5, (h - 0.2) / 0.6));
  },
  rules: [],
  returnCue: 'wallAngel.lower',
};

/** Arms out to the sides: each wrist within 0.35 arm lengths of its shoulder's height and at least 0.6 arm lengths out. */
export const armCircles: MoveDef = {
  id: 'armCircles', label: 'T', group: 'standing', views: ['front'], parts: UPPER,
  rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 500 },
  hold: { enterAt: 1, leaveAt: 0.5, outCue: 'armCircles.armsOut' },
  progress(b) {
    const arm = b.len.upperArm + b.len.forearm;
    if (arm <= 0) return null;
    let ok = 0;
    for (const s of ['L', 'R'] as const) {
      const h = handHeight(b, s), sh = at(b, s, 'shoulder', true), wr = at(b, s, 'wrist', true);
      if (h === null || !sh || !wr) return null;
      if (Math.abs(h) < 0.35 && Math.abs(wr.x - sh.x) > 0.6 * arm) ok++;
    }
    return ok === 2 ? 1 : 0;
  },
  rules: [],
  returnCue: 'armCircles.armsOut',
};

export const goodMorning: MoveDef = {
  id: 'goodMorning', label: 'F', group: 'standing', views: ['side'], parts: LEGS,
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 800 },
  progress(b) {
    const a = hipAngle(b, b.near, true);
    return a === null ? null : Math.max(0, Math.min(1.4, (172 - a) / 52));
  },
  rules: [
    {
      kind: 'rep', id: 'hinge.depth', severity: 'tip', views: ['side'],
      judge: (r) => r.maxP < 1,
      segments: () => ['torso'],
      cue: 'hinge.lower',
    },
    {
      kind: 'live', id: 'hinge.knees', severity: 'tip', views: ['side'], minP: 0.6, phases: ['bottom', 'up'],
      measure: (b) => kneeAngle(b, b.near),
      bad: (v) => v < 135, clear: (v) => v > 142,
      segments: (b) => (b.near === 'L' ? ['thighL', 'shinL'] : ['thighR', 'shinR']),
      cue: 'hinge.hipsBack',
      holdMs: 250,
    },
  ],
  returnCue: 'hinge.standTall',
};
