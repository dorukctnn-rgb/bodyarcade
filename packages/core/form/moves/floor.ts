// Floor moves (Faz 4): the bridge family, push-up variants, planks and core. SPEC.md 5.3 rows 19-24, 5.4 rows 28-36, 5.5 rows 37-52.
//
// What is measured and from where: everything is a sagittal measurement from the side (elbow, hip and knee angles, the body line
// from shoulder to hip to ankle, a wrist's rise), the way the push-up and the glute bridge of Faz 1 are. Lying on the floor the
// near shoulder, hip, knee and ankle are the points that are seen; the far limbs often are not, so counts use the near side or
// whichever side is seen. Count-only (S) and time-only (T) moves have no live form rule by design (SPEC 5, tests enforce it).
// Not measured: the lower back (no points on the spine), the head and neck, elbows flaring (a front-view thing), contact with a
// chair or the floor, how hard a hold is.
import { angleAt, bendFromFloor, fromHorizontal, fromVertical } from '../geometry.ts';
import type { BodyCtx, MoveDef } from '../types.ts';
import { forearm, thigh, upperArm } from '../segments.ts';
import { all, at, liveRule, other, pair, repRule, topRule } from './kit.ts';
import { bodyBend, clampP, elbowAngle, facing, wristRiser } from './arms.ts';
import { gluteBridge, hipBend } from './gluteBridge.ts';
import { hipAngle, kneeAngle, thighLevelProgress } from './legs.ts';
import { bodyLine, inPlank, makePushUp } from './pushUp.ts';

type B = Omit<BodyCtx, 'p' | 'phase'>;
const SIDE = ['side', 'diag'] as const;
const FLOOR: MoveDef['parts'] = ['head', 'shoulders', 'hips', 'knees', 'feet'];
const ARMS_FLOOR: MoveDef['parts'] = ['head', 'shoulders', 'elbows', 'hands', 'hips', 'knees', 'feet'];
const noRep = { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 500 } as const;

/** The body lies along the picture: the near shoulder to the near hip within `maxTilt` degrees of level. */
function torsoLevel(b: B, maxTilt: number, count = true): boolean {
  const sh = at(b, b.near, 'shoulder', count), hip = at(b, b.near, 'hip', count);
  return !!sh && !!hip && fromHorizontal(sh, hip) < maxTilt;
}

// ---- bridges ----

/** Single-leg bridge: the bridge's lift with one leg held up. Count only (a tilting pelvis is a rotation: not measured). */
export const singleLegBridge: MoveDef = { ...gluteBridge, id: 'singleLegBridge', label: 'S', rules: [] };

/**
 * Hip thrust, shoulders on a sofa or chair, from the side: the same hip bend as the bridge (shoulder-hip-knee), 125 degrees at the
 * bottom to 165 at the top. The torso must be nearer level than upright (standing straight reads as a finished thrust otherwise).
 * Rules as the bridge: hips all the way up, not over-arched, knees about 90 degrees at the top.
 */
export const hipThrust: MoveDef = {
  ...gluteBridge,
  id: 'hipThrust',
  equipment: ['chair'],
  lying: false,
  views: SIDE,
  parts: ['shoulders', 'hips', 'knees', 'feet'],
  progress(b) {
    if (!torsoLevel(b, 60)) return null;
    const h = hipBend(b, true);
    return h === null ? null : clampP((h - 125) / 40, 1.6);
  },
};

/**
 * Superman, lying face down, from the side: the chest and the legs come off the floor, so the hip sinks below the line from the
 * shoulder to the ankle (176 -> 162 degrees). Count only: the lift is a few centimetres.
 */
export const superman: MoveDef = {
  id: 'superman', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 700 },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), hip = at(b, b.near, 'hip', true), an = at(b, b.near, 'ankle', true);
    if (!sh || !hip || !an || fromHorizontal(sh, an) >= 30) return null;
    return clampP((176 - bendFromFloor(sh, hip, an)) / 14);
  },
  rules: [], returnCue: 'move.reset',
};

/** One arm and the opposite leg reaching out, from the side. Progress is the mean of the arm's reach forward (0.3 -> 0.9 arm
 *  lengths ahead of the shoulder) and the leg's reach back (0.6 -> 0.95 leg lengths behind the hip), the best of the two sides. */
function birdReach(b: B): { arm: number; leg: number } | null {
  const f = facing(b, 'head');
  const armLen = b.len.upperArm + b.len.forearm, legLen = b.len.thigh + b.len.shin;
  if (!f || armLen <= 0 || legLen <= 0) return null;
  let arm = 0, leg = 0, seenAny = false;
  for (const s of ['L', 'R'] as const) {
    const sh = at(b, s, 'shoulder', true), wr = at(b, s, 'wrist', true), hip = at(b, s, 'hip', true), an = at(b, s, 'ankle', true);
    if (sh && wr) { arm = Math.max(arm, clampP((((wr.x - sh.x) * f) / armLen - 0.3) / 0.6, 1.3)); seenAny = true; }
    if (hip && an) { leg = Math.max(leg, clampP((((hip.x - an.x) * f) / legLen - 0.6) / 0.35, 1.3)); seenAny = true; }
  }
  return seenAny ? { arm, leg } : null;
}

/** Bird dog on hands and knees, from the side. A repetition counts when an arm or a leg reaches; it is clean only when both do. */
export const birdDog: MoveDef = {
  id: 'birdDog', label: 'F', group: 'floor', views: SIDE, lying: true, parts: ARMS_FLOOR, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 800 },
  progress(b) {
    if (!torsoLevel(b, 35)) return null;
    const r = birdReach(b);
    return r === null ? null : clampP((r.arm + r.leg) / 2, 1.3);
  },
  rules: [
    topRule('bird.top', 'bird.reach', SIDE, (b) => [thigh(b.near), forearm(b.near)], 'tip'),
    liveRule({
      id: 'bird.level', severity: 'tip', views: SIDE, minP: 0.4,
      measure: (b) => {
        const sh = at(b, b.near, 'shoulder'), hip = at(b, b.near, 'hip');
        return sh && hip ? fromHorizontal(sh, hip) : null;
      },
      bad: (v) => v > 18, clear: (v) => v < 12,
      segments: () => ['torso'], cue: 'bird.level', holdMs: 300,
    }),
  ],
  returnCue: 'bird.back',
};

/** Donkey kick on hands and knees, from the side: the near thigh from hanging down to level behind. Count only. */
export const donkeyKick: MoveDef = {
  id: 'donkeyKick', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.5, upAt: 0.25, fullAt: 1, minMs: 500 },
  progress(b) {
    if (!torsoLevel(b, 35)) return null;
    const p = thighLevelProgress(b, b.near, 0.15);
    return p;
  },
  rules: [], returnCue: 'move.reset',
};

// ---- push-ups ----

export const kneePushUp = makePushUp({ id: 'kneePushUp' });
export const inclinePushUp = makePushUp({ id: 'inclinePushUp', equipment: ['chair'], maxTilt: 55, bottom: 110 });
export const declinePushUp = makePushUp({ id: 'declinePushUp', equipment: ['chair'] });
export const widePushUp = makePushUp({ id: 'widePushUp' });
export const diamondPushUp = makePushUp({ id: 'diamondPushUp' });

/**
 * Wall push-up, from the side: standing, hands on the wall at about shoulder height, the elbow's bend 160 -> 115 degrees.
 * Counted only while the hands are out in front of the shoulders at about their height (a bicep curl is not a wall push-up).
 */
export const wallPushUp: MoveDef = {
  id: 'wallPushUp', label: 'F', group: 'floor', equipment: ['wall'], views: SIDE, parts: ['head', 'shoulders', 'elbows', 'hands', 'hips', 'feet'],
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), wr = at(b, b.near, 'wrist', true), an = at(b, b.near, 'ankle', true);
    const armLen = b.len.upperArm + b.len.forearm;
    if (!sh || !wr || !an || armLen <= 0) return null;
    if (Math.abs(wr.y - sh.y) > 0.7 * armLen || Math.abs(wr.x - sh.x) < 0.35 * armLen || fromVertical(an, sh) > 40) return null;
    const e = elbowAngle(b, b.near, true);
    return e === null ? null : clampP((160 - e) / 45);
  },
  rules: [
    topRule('wallPush.depth', 'pushUp.lower', SIDE, (b) => [upperArm(b.near), forearm(b.near)]),
    liveRule({
      id: 'wallPush.line', severity: 'tip', views: SIDE, phases: ['top', 'down', 'bottom', 'up'], minP: 0.2,
      measure(b) {
        const p = all(b, b.near, ['shoulder', 'hip', 'ankle']);
        return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
      },
      bad: (v) => v < 160, clear: (v) => v > 166,
      segments: () => ['torso'], cue: 'wall.line', holdMs: 250,
    }),
  ],
  returnCue: 'pushUp.armsStraight',
};

/** Pike push-up: hips high, head towards the floor between the hands; counted by the elbow's bend (count only). */
export const pikePushUp: MoveDef = {
  id: 'pikePushUp', label: 'S', group: 'floor', views: SIDE, lying: true, parts: ARMS_FLOOR, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), hip = at(b, b.near, 'hip', true), an = at(b, b.near, 'ankle', true);
    if (!sh || !hip || !an || b.len.torso <= 0 || hip.y > Math.min(sh.y, an.y) - 0.1 * b.len.torso) return null;
    const e = elbowAngle(b, b.near, true);
    return e === null ? null : clampP((165 - e) / 60);
  },
  rules: [], returnCue: 'pushUp.armsStraight',
};

/**
 * Triceps dip on a chair, from the side: sitting at the edge with the hands behind, the elbow's bend 165 -> 95 degrees. Counted
 * only with the hands behind the hips and below the shoulders and the torso upright (a push-up or a curl is not a dip).
 * Rules: depth, the hips staying close to the chair (their distance from the hands).
 */
export const tricepsDip: MoveDef = {
  id: 'tricepsDip', label: 'F', group: 'floor', equipment: ['chair'], views: SIDE, parts: ['head', 'shoulders', 'elbows', 'hands', 'hips', 'feet'],
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 700 },
  progress(b) {
    const f = facing(b);
    const sh = at(b, b.near, 'shoulder', true), wr = at(b, b.near, 'wrist', true), hip = at(b, b.near, 'hip', true);
    if (!f || !sh || !wr || !hip || b.len.torso <= 0) return null;
    if (fromVertical(hip, sh) > 40 || wr.y < sh.y + 0.5 * b.len.upperArm || (wr.x - hip.x) * f > 0.15 * b.len.torso) return null;
    const e = elbowAngle(b, b.near, true);
    return e === null ? null : clampP((165 - e) / 70);
  },
  rules: [
    topRule('dip.depth', 'dip.lower', SIDE, (b) => [upperArm(b.near), forearm(b.near)]),
    liveRule({
      id: 'dip.hips', severity: 'tip', views: SIDE, phases: ['top', 'down', 'bottom', 'up'],
      measure(b) {
        const hip = at(b, b.near, 'hip'), wr = at(b, b.near, 'wrist');
        return hip && wr && b.len.torso > 0 ? Math.abs(hip.x - wr.x) / b.len.torso : null;
      },
      bad: (v) => v > 0.55, clear: (v) => v < 0.4,
      segments: () => ['torso'], cue: 'dip.close', holdMs: 300,
    }),
  ],
  returnCue: 'dip.up',
};

/**
 * Plank shoulder tap, from the side: a hand lifting off the floor (the wrist's rise over its resting height, 0.45 arm lengths is
 * a full tap), either hand. The body line is watched all the time (as in the plank).
 */
export const plankShoulderTap: MoveDef = {
  id: 'plankShoulderTap', label: 'F', group: 'floor', views: SIDE, lying: true, parts: ARMS_FLOOR,
  rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 300 },
  makeProgress() {
    const rise = wristRiser(3000);
    return (b) => {
      if (!inPlank(b) || b.len.upperArm + b.len.forearm <= 0) return null;
      const l = rise(b, 'L'), r = rise(b, 'R');
      if (l === null && r === null) return null;
      return clampP((Math.max(l ?? 0, r ?? 0)) / 0.45);
    };
  },
  rules: [
    liveRule({
      id: 'tap.line', severity: 'error', views: ['side'], phases: ['top', 'down', 'bottom', 'up'],
      measure: (b) => (inPlank(b) ? bodyLine(b) : null),
      bad: (v) => v < 160 || v > 205, clear: (v) => v >= 165 && v <= 198,
      segments: (b) => ['torso', thigh(b.near)],
      cue: (v) => (v < 180 ? 'pushUp.hipsUp' : 'pushUp.hipsDown'), holdMs: 250,
    }),
  ],
  returnCue: 'tap.down',
};

// ---- planks and holds ----

const binary = (on: boolean | null): number | null => (on === null ? null : on ? 1 : 0);

/**
 * Plank positions from the side. Forearm plank: the body along the picture with the elbow bent (under 125 degrees); high plank:
 * the arm straight (150 and over). The clock runs while the position is held and no error shows. The body line is the push-up's
 * (sagging under 165, hips up over 200); the elbows (or the hands) under the shoulders is a tip that does not stop the clock.
 */
function plankMove(id: 'plank' | 'highPlank'): MoveDef {
  const forearmDown = id === 'plank';
  return {
    id, label: 'H', group: 'floor', views: SIDE, lying: true, parts: ARMS_FLOOR, rep: noRep,
    hold: { enterAt: 1, leaveAt: 0.5, outCue: 'plank.position' },
    progress(b) {
      if (!inPlank(b)) return null;
      const e = elbowAngle(b, b.near, true);
      return e === null ? null : binary(forearmDown ? e < 125 : e >= 150);
    },
    rules: [
      liveRule({
        id: 'plank.line', severity: 'error', views: ['side'],
        measure: (b) => (inPlank(b) ? bodyLine(b) : null),
        bad: (v) => v < 165 || v > 200, clear: (v) => v >= 168 && v <= 195,
        segments: (b) => ['torso', thigh(b.near)],
        cue: (v) => (v < 180 ? 'pushUp.hipsUp' : 'pushUp.hipsDown'), holdMs: 400,
      }),
      liveRule({
        id: forearmDown ? 'plank.elbows' : 'plank.hands', severity: 'tip', views: ['side'],
        measure(b) {
          const sh = at(b, b.near, 'shoulder'), pt = at(b, b.near, forearmDown ? 'elbow' : 'wrist');
          const len = forearmDown ? b.len.upperArm : b.len.upperArm + b.len.forearm;
          return sh && pt && len > 0 && inPlank(b) ? Math.abs(pt.x - sh.x) / len : null;
        },
        bad: (v) => v > (forearmDown ? 0.5 : 0.35), clear: (v) => v < (forearmDown ? 0.35 : 0.25),
        segments: (b) => [forearm(b.near)], cue: forearmDown ? 'plank.elbowsUnder' : 'pushUp.handsUnder', holdMs: 500,
      }),
    ],
    returnCue: 'plank.position',
  };
}
export const plank = plankMove('plank');
export const highPlank = plankMove('highPlank');

/**
 * Side plank: time only. The body along the picture (shoulder midpoint to ankle midpoint within 30 degrees of level), seen from
 * the front: lying on the side, the hip and the support are not told apart from other lying poses, so no form rule is offered.
 */
export const sidePlank: MoveDef = {
  id: 'sidePlank', label: 'T', group: 'floor', views: ['front', 'diag', 'side'], lying: true, parts: FLOOR, rep: noRep,
  hold: { enterAt: 1, leaveAt: 0.5, outCue: 'plank.position' },
  progress(b) {
    const sh = pair(b, 'shoulder', true), an = pair(b, 'ankle', true);
    return binary(sh && an ? fromHorizontal(sh, an) < 30 : null);
  },
  rules: [], returnCue: 'plank.position',
};

/** Hollow hold: time only. Lying on the back, hips on the floor, shoulders and feet lifted: the hip bend 125-172 degrees. */
export const hollowHold: MoveDef = {
  id: 'hollowHold', label: 'T', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: noRep,
  hold: { enterAt: 1, leaveAt: 0.5, outCue: 'hold.position' },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), an = at(b, b.near, 'ankle', true), a = bodyBend(b, b.near, true);
    return binary(sh && an && a !== null ? fromHorizontal(sh, an) < 35 && a >= 125 && a <= 172 : null);
  },
  rules: [], returnCue: 'hold.position',
};

/** Bear hold: time only. On hands and knees with the knees just off the floor: torso level, knee bent 60-120, arm vertical. */
export const bearHold: MoveDef = {
  id: 'bearHold', label: 'T', group: 'floor', views: SIDE, lying: true, parts: ARMS_FLOOR, rep: noRep,
  hold: { enterAt: 1, leaveAt: 0.5, outCue: 'hold.position' },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), wr = at(b, b.near, 'wrist', true), k = kneeAngle(b, b.near, true);
    if (!sh || !wr || k === null || !torsoLevel(b, 35)) return null;
    return binary(k >= 60 && k <= 120 && fromVertical(sh, wr) < 25);
  },
  rules: [], returnCue: 'hold.position',
};

/** Flutter kicks: time only. Lying on the back with the feet lifted (the ankle above the shoulder's height by 0.12 torso lengths). */
export const flutterKicks: MoveDef = {
  id: 'flutterKicks', label: 'T', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: noRep,
  hold: { enterAt: 1, leaveAt: 0.5, outCue: 'hold.position' },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), an = at(b, b.near, 'ankle', true);
    if (!sh || !an || b.len.torso <= 0 || !torsoLevel(b, 35)) return null;
    return binary((sh.y - an.y) / b.len.torso > 0.12);
  },
  rules: [], returnCue: 'hold.position',
};

// ---- core ----

/** Crunch, lying on the back: the shoulders' lift (the shoulder-hip line from level up to 26 degrees). Count only. */
export const crunch: MoveDef = {
  id: 'crunch', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), hip = at(b, b.near, 'hip', true);
    return sh && hip ? clampP((fromHorizontal(sh, hip) - 8) / 18) : null;
  },
  rules: [], returnCue: 'move.reset',
};

/**
 * Sit-up, lying with the knees bent, from the side: the hip bend (shoulder-hip-knee) from about 140 degrees lying to 85 sitting
 * up. Counted only with the thigh tilted off the vertical (standing and folding forward is not a sit-up). Rule: all the way up.
 */
export const sitUp: MoveDef = {
  id: 'sitUp', label: 'F', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 800 },
  progress(b) {
    const hip = at(b, b.near, 'hip', true), knee = at(b, b.near, 'knee', true);
    const a = hipAngle(b, b.near, true);
    if (!hip || !knee || a === null || fromVertical(hip, knee) < 25) return null;
    return clampP((140 - a) / 55);
  },
  rules: [topRule('situp.top', 'situp.higher', SIDE, () => ['torso'])],
  shallowCue: 'situp.higher',
  returnCue: 'situp.lower',
};

/** Bicycle crunch: count only, each knee pulled in (the hip bend of that leg from 150 to 80 degrees), alternating legs. */
export const bicycleCrunch: MoveDef = {
  id: 'bicycleCrunch', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.5, upAt: 0.25, fullAt: 1, minMs: 250 },
  sideProgress(b, s) {
    if (!torsoLevel(b, 45)) return null;
    const a = hipAngle(b, s, true);
    return a === null ? null : clampP((150 - a) / 70);
  },
  exclusive: 0.5,
  rules: [], returnCue: 'move.reset',
};

/**
 * Lying leg raise, from the side: the hip bend (shoulder-hip-ankle) from 165 to 100 degrees. Rules: legs high enough, knees
 * straight (the knee's angle 155 and over).
 */
export const legRaise: MoveDef = {
  id: 'legRaise', label: 'F', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 900 },
  progress(b) {
    if (!torsoLevel(b, 35)) return null;
    const a = bodyBend(b, b.near, true);
    return a === null ? null : clampP((165 - a) / 65);
  },
  rules: [
    topRule('legRaise.top', 'legRaise.higher', SIDE, (b) => [thigh(b.near)], 'tip'),
    liveRule({
      id: 'legRaise.knees', severity: 'tip', views: SIDE, minP: 0.3,
      measure: (b) => kneeAngle(b, b.near),
      bad: (v) => v < 150, clear: (v) => v > 158,
      segments: (b) => [b.near === 'L' ? 'shinL' : 'shinR'], cue: 'legRaise.straight', holdMs: 300,
    }),
  ],
  shallowCue: 'legRaise.higher',
  returnCue: 'legRaise.lower',
};

/** Dead bug, on the back: count only, each leg's extension (the knee from bent 100 to straight 155), alternating legs. */
export const deadBug: MoveDef = {
  id: 'deadBug', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.5, upAt: 0.25, fullAt: 1, minMs: 500 },
  sideProgress(b, s) {
    if (!torsoLevel(b, 35)) return null;
    const k = kneeAngle(b, s, true);
    return k === null ? null : clampP((k - 100) / 55);
  },
  exclusive: 0.6,
  rules: [], returnCue: 'move.reset',
};

/** A high plank seen by its upper body only (the near leg may be driven in): torso level, arm vertical under the shoulder. */
function plankUpper(b: B): boolean {
  const sh = at(b, b.near, 'shoulder', true), wr = at(b, b.near, 'wrist', true);
  return torsoLevel(b, 40) && !!sh && !!wr && fromVertical(sh, wr) < 35;
}

/** The body line of a climber: shoulder-hip-ankle with the ankle of a straight leg (the leg being driven in is not the line). */
function climberLine(b: B): number | null {
  const sh = at(b, b.near, 'shoulder'), hip = at(b, b.near, 'hip');
  if (!sh || !hip) return null;
  for (const s of [b.near, other(b.near)]) {
    const k = kneeAngle(b, s), an = at(b, s, 'ankle');
    if (k !== null && k >= 150 && an) return bendFromFloor(sh, hip, an);
  }
  return null;
}

/**
 * Mountain climber, in a high plank from the side: each knee driven in (the hip bend of that leg 170 -> 90 degrees), one machine
 * per leg like high knees. Rules: the knee all the way in (a tip: the pace is fast), hips not piked up (over 210 degrees).
 */
export const mountainClimber: MoveDef = {
  id: 'mountainClimber', label: 'F', group: 'floor', views: SIDE, lying: true, parts: ARMS_FLOOR, rep: { countAt: 0.5, upAt: 0.25, fullAt: 1, minMs: 200 },
  sideProgress(b, s) {
    if (!plankUpper(b)) return null;
    const a = hipAngle(b, s, true);
    return a === null ? null : clampP((170 - a) / 80);
  },
  exclusive: 0.5,
  rules: [
    repRule({
      id: 'climber.knee', severity: 'tip', views: SIDE, judge: (r) => r.maxP < 1,
      segments: (b) => (b.work === 'L' ? ['thighL'] : b.work === 'R' ? ['thighR'] : []), cue: 'climber.knee',
    }),
    liveRule({
      id: 'climber.hips', severity: 'tip', views: ['side'], phases: ['top', 'down', 'bottom', 'up'],
      measure: (b) => (plankUpper(b) ? climberLine(b) : null),
      bad: (v) => v > 210, clear: (v) => v < 200,
      segments: () => ['torso'], cue: 'pushUp.hipsDown', holdMs: 300,
    }),
  ],
  shallowCue: 'climber.knee',
  returnCue: 'climber.plank',
};

/**
 * Russian twist, seated, from the front: each twist narrows the shoulders in the picture (their width against the widest seen,
 * 1 to 0.7). Count only; the size of the twist is not told apart from how far the camera sees round.
 */
export const russianTwist: MoveDef = {
  id: 'russianTwist', label: 'S', group: 'floor', views: ['front', 'diag'], parts: ['head', 'shoulders', 'hands', 'hips'],
  rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 400 },
  progress(b) {
    const l = at(b, 'L', 'shoulder', true), r = at(b, 'R', 'shoulder', true);
    if (!l || !r || b.len.shoulders <= 0) return null;
    return clampP((1 - Math.hypot(l.x - r.x, l.y - r.y) / b.len.shoulders) / 0.3);
  },
  rules: [], returnCue: 'move.reset',
};

/** V-up: count only, the body folding at the hip (shoulder-hip-ankle from 170 down to 70 degrees). */
export const vUp: MoveDef = {
  id: 'vUp', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 800 },
  progress(b) {
    const a = bodyBend(b, b.near, true);
    return a === null ? null : clampP((170 - a) / 100);
  },
  rules: [], returnCue: 'move.reset',
};

/** Reverse crunch: count only, the hips' lift off the floor (their rise over the lowest in the last 4 s, 0.2 torso lengths). */
export const reverseCrunch: MoveDef = {
  id: 'reverseCrunch', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 600 },
  makeProgress() {
    const ring: { t: number; y: number }[] = [];
    return (b) => {
      const hip = at(b, b.near, 'hip', true);
      if (!hip || b.len.torso <= 0 || !torsoLevel(b, 45)) return null;
      ring.push({ t: b.t, y: hip.y });
      while (ring.length && ring[0]!.t < b.t - 4000) ring.shift();
      let floor = -Infinity;
      for (const r of ring) if (r.y > floor) floor = r.y;
      return clampP((floor - hip.y) / b.len.torso / 0.2);
    };
  },
  rules: [], returnCue: 'move.reset',
};

/** Lying toe touch: count only, the hand coming to the foot (their distance from 0.9 to 0.25 leg lengths). */
export const toeTouch: MoveDef = {
  id: 'toeTouch', label: 'S', group: 'floor', views: SIDE, lying: true, parts: FLOOR, rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 800 },
  progress(b) {
    const wr = at(b, b.near, 'wrist', true), an = at(b, b.near, 'ankle', true);
    const leg = b.len.thigh + b.len.shin;
    return wr && an && leg > 0 ? clampP((0.9 - Math.hypot(wr.x - an.x, wr.y - an.y) / leg) / 0.65) : null;
  },
  rules: [], returnCue: 'move.reset',
};
