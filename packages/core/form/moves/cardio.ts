// Cardio and whole-body standing moves (Faz 3). SPEC.md 5.6 rows 53-64.
//
// Jumping jack family: progress is the smaller of two parts, the hands going up (lower hand's height over its shoulder, arm
// lengths, -1 hanging to +1 straight up) and the feet going apart (ankles' distance in shoulder widths); both must open for a
// repetition, and each part has its own end-of-repetition rule. From the front only (the spread is in the picture plane).
//
// High knees, marching, butt kicks: one repetition machine per leg (coach.ts) on that leg's thigh coming up to level, or its
// shin folding up behind with the thigh still down.
//
// Burpee, squat thrust, inchworm: the body's tilt from the vertical (near shoulder to near ankle), 0 standing and 70-90 in the
// plank; from the side or at an angle (from the front a plank runs into the depth of the picture). Count only.
//
// Jump rope (without a rope) and skater: count only; the hop is measured against the floor the player last landed on.
import type { Side } from '../geometry.ts';
import type { BodyCtx, FormMoveId, FormRule, MoveDef, MoveLabel } from '../types.ts';
import { at, nose, other, pair } from './kit.ts';
import { bodyTilt, feetWidth, lowerHand, shinDrop, thighDrop, thighLevelProgress } from './legs.ts';

type B = Omit<BodyCtx, 'p' | 'phase'>;

const FULL: MoveDef['parts'] = ['head', 'shoulders', 'elbows', 'hands', 'hips', 'knees', 'feet'];
const LEGS: MoveDef['parts'] = ['head', 'shoulders', 'hips', 'knees', 'feet'];

// ---- jumping jack family ----

/**
 * How far the lower wrist is above the nose, in arm lengths (SPEC 5.6 row 53: the hands meet over the head, the wrists above
 * the nose). Not "straight arms overhead": on real video a coach's jacks met with the elbows bent over the head (jj-jb-front,
 * 11 Nov 2026) and a straight-arm threshold called every one of them short.
 */
function wristsOverNose(b: Omit<BodyCtx, 'p' | 'phase'>): number | null {
  const n = nose(b), l = at(b, 'L', 'wrist'), r = at(b, 'R', 'wrist');
  const arm = b.len.upperArm + b.len.forearm;
  if (!n || !l || !r || arm <= 0) return null;
  return (n.y - Math.max(l.y, r.y)) / arm;
}

/** Hands: 0 at or below -0.6 arm lengths, 1 at 0.8 (wrists well over the head). */
const handsOpen = (h: number): number => Math.max(0, Math.min(1.5, (h + 0.6) / 1.4));
/** Feet: 0 at 0.9 shoulder widths, 1 at `wide`. */
const feetOpen = (w: number, wide: number): number => Math.max(0, Math.min(1.5, (w - 0.9) / (wide - 0.9)));

interface JackOpts { id: FormMoveId; label: MoveLabel; wide: number; rules: boolean }

function jack(o: JackOpts): MoveDef {
  const rules: FormRule[] = o.rules ? [
    {
      kind: 'rep', id: 'jack.arms', severity: 'error', views: ['front'],
      judge: (r) => (r.at.hands === undefined ? null : r.at.hands < 0),
      segments: () => ['upperArmL', 'upperArmR', 'forearmL', 'forearmR'],
      cue: 'jack.armsUp',
    },
    {
      kind: 'rep', id: 'jack.feet', severity: 'tip', views: ['front'],
      judge: (r) => (r.at.feet === undefined ? null : r.at.feet < o.wide),
      segments: () => ['shinL', 'shinR'],
      cue: 'jack.feetWide',
    },
  ] : [];
  return {
    id: o.id, label: o.label, group: 'cardio', views: ['front'], parts: FULL,
    rep: { countAt: 0.45, upAt: 0.15, fullAt: 1, minMs: 350 },
    progress(b) {
      const h = lowerHand(b), w = feetWidth(b);
      if (h === null || w === null) return null;
      return Math.min(handsOpen(h), feetOpen(w, o.wide));
    },
    track: [
      { id: 'hands', agg: 'max', value: (b) => wristsOverNose(b) },
      { id: 'feet', agg: 'max', value: (b) => feetWidth(b, false) },
    ],
    rules,
    shallowCue: 'jack.armsUp',
    returnCue: 'jack.close',
  };
}

export const jumpingJack = jack({ id: 'jumpingJack', label: 'F', wide: 1.5, rules: true });
/** Step jack: one foot steps out at a time (no jump), so the feet open less. */
export const stepJack = jack({ id: 'stepJack', label: 'F', wide: 1.3, rules: true });
/** Star jump: the jack's open position in the air. Count only (the jump is not measured). */
export const starJump = jack({ id: 'starJump', label: 'S', wide: 1.5, rules: false });

// ---- knees and heels ----

/** High knees: each thigh up to within 0.15 thigh lengths of the hip's height; the standing leg straight (exclusive). */
export const highKnees: MoveDef = {
  id: 'highKnees', label: 'F', group: 'cardio', views: ['front', 'diag', 'side'], parts: LEGS,
  rep: { countAt: 0.5, upAt: 0.25, fullAt: 1, minMs: 200 },
  sideProgress: (b, s) => thighLevelProgress(b, s, 0.15),
  exclusive: 0.5,
  rules: [{
    kind: 'rep', id: 'highKnees.height', severity: 'error', views: ['front', 'diag', 'side'],
    judge: (r) => r.maxP < 1,
    segments: (b) => (b.work === 'L' ? ['thighL'] : b.work === 'R' ? ['thighR'] : []),
    cue: 'highKnees.higher',
  }],
  shallowCue: 'highKnees.higher',
  returnCue: 'highKnees.footDown',
};

/** Marching in place: each thigh about half way up (0.5). Count only. */
export const marching: MoveDef = {
  id: 'marching', label: 'S', group: 'cardio', views: ['front', 'diag', 'side'], parts: LEGS,
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 300 },
  sideProgress: (b, s) => thighLevelProgress(b, s, 0.5),
  exclusive: 0.5,
  rules: [],
  returnCue: 'highKnees.footDown',
};

/** Butt kicks: the shin folds up behind (the ankle to 0.2 shin lengths under the knee) while the thigh stays down. Count only. */
export const buttKicks: MoveDef = {
  id: 'buttKicks', label: 'S', group: 'cardio', views: ['side', 'diag', 'front'], parts: LEGS,
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 200 },
  sideProgress(b, s) {
    const t = thighDrop(b, s), sd = shinDrop(b, s);
    if (t === null || sd === null) return null;
    if (t < 0.75) return 0; // the knee came up: a high knee, not a kick
    return Math.max(0, Math.min(1.5, (1 - sd) / 0.8));
  },
  exclusive: 0.6,
  rules: [],
  returnCue: 'highKnees.footDown',
};

// ---- down to the floor and back ----

/** 0 standing (tilt 20 degrees or less), 1 in the plank (65 or more). */
const tiltProgress = (b: B): number | null => {
  const t = bodyTilt(b);
  return t === null ? null : Math.max(0, Math.min(1.3, (t - 20) / 45));
};

function floorAndBack(id: FormMoveId, minMs: number): MoveDef {
  return {
    id, label: 'S', group: 'cardio', views: ['side', 'diag'], parts: FULL,
    rep: { countAt: 0.6, upAt: 0.15, fullAt: 1, minMs },
    progress: tiltProgress,
    rules: [],
    returnCue: 'burpee.standUp',
  };
}

export const burpee = floorAndBack('burpee', 900);
export const squatThrust = floorAndBack('squatThrust', 900);
export const inchworm = floorAndBack('inchworm', 2000);

// ---- hops ----

/**
 * Jump rope without a rope: small hops. The floor is the lowest the hips were in the last 1.2 s (where the player last landed);
 * a hop is the hips' rise over it in torso lengths, full at 0.06 (about 3 cm for a 50 cm torso). Count only.
 */
export const jumpRope: MoveDef = {
  id: 'jumpRope', label: 'S', group: 'cardio', views: ['front', 'diag', 'side'], parts: LEGS,
  rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 180 },
  makeProgress() {
    const ring: { t: number; y: number }[] = [];
    return (b) => {
      const hips = b.view === 'side' ? at(b, b.near, 'hip', true) : pair(b, 'hip', true);
      if (!hips || b.len.torso <= 0) return null;
      ring.push({ t: b.t, y: hips.y });
      while (ring.length && ring[0]!.t < b.t - 1200) ring.shift();
      let floor = -Infinity;
      for (const r of ring) if (r.y > floor) floor = r.y;
      return Math.max(0, Math.min(1.5, (floor - hips.y) / b.len.torso / 0.06));
    };
  },
  rules: [],
  returnCue: 'jumpRope.land',
};

/**
 * Skater: a hop to one side landing on that leg, the other leg swinging behind it. Measured from the front as the free ankle
 * crossing behind the landing ankle: standing, the other ankle sits about 0.7 shoulder widths towards the middle; crossed, it
 * is on the far side. Count only.
 */
export const skater: MoveDef = {
  id: 'skater', label: 'S', group: 'cardio', views: ['front', 'diag'], parts: LEGS,
  rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 300 },
  sideProgress(b, s: Side) {
    const me = at(b, s, 'ankle', true), them = at(b, other(s), 'ankle', true);
    const myHip = at(b, s, 'hip', true), theirHip = at(b, other(s), 'hip', true);
    if (!me || !them || !myHip || !theirHip || b.len.shoulders <= 0) return null;
    const towardsMiddle = Math.sign(theirHip.x - myHip.x) || 1;
    const medial = ((them.x - me.x) * towardsMiddle) / b.len.shoulders;
    return Math.max(0, Math.min(1.5, (0.6 - medial) / 0.8));
  },
  exclusive: 0.5,
  rules: [],
  returnCue: 'jumpRope.land',
};

