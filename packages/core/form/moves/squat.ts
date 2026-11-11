// Squat (bodyweight or goblet) and its standing family (Faz 3): sumo, prisoner, jump, chair squat, squat hold and wall sit.
// SPEC.md 5.1 rows 1-6 and 11, rules DEP-F / DEP-S, KNEE-IN, SHIFT, TORSO, TEMPO.
//
// Progress: from the front or at an angle, how far the hips came down towards the knees: h = (knee y - hip y) / thigh length,
// which is 1 standing and 0 with the thighs level, whatever way the player faces (the vertical drop does not depend on the
// camera's direction; the thigh length is the running maximum of the standing thigh). Target (progress 1): h = 0.20 from the
// front (thighs within about 12 degrees of level; the camera cannot see the last bit of depth reliably), so p = (1 - h) / 0.80.
// From the side the near knee's angle is exact: p = (170 - knee) / 70, target 100 degrees.
//
// Not measured (SPEC 5.1): heels lifting (the heel and toe points jitter more than a heel lifts), a rounding back (no points
// on the spine); from the front the forward lean (a side-view thing), from the side the knees caving in (a front-view thing);
// sitting on the chair and the back touching the wall (contact is not visible).
import { fromVertical, type Side, type View } from '../geometry.ts';
import type { BodyCtx, FormMoveId, FormRule, MoveDef, MoveLabel } from '../types.ts';
import { shin, thigh } from '../segments.ts';
import { all, at, pair } from './kit.ts';
import { kneeAngle as legKnee, torsoLean } from './legs.ts';

const FRONT_TARGET_H = 0.2;

export function frontProgress(b: Pick<BodyCtx, 'pts' | 'near' | 'view' | 'len'>, target = FRONT_TARGET_H): number | null {
  if (b.len.thigh <= 0) return null;
  let sum = 0, n = 0;
  for (const s of ['L', 'R'] as const) {
    const hip = at(b, s, 'hip', true), knee = at(b, s, 'knee', true);
    if (!hip || !knee) continue;
    sum += (knee.y - hip.y) / b.len.thigh; n++;
  }
  if (n === 0) return null;
  const h = sum / n;
  return Math.max(0, Math.min(1.4, (1 - h) / (1 - target)));
}

const kneeAngle = (b: Pick<BodyCtx, 'pts' | 'near' | 'view'>, s: Side, count = false): number | null => legKnee(b, s, count);

/** How far the knee of side s sits inside the hip-ankle line, in leg lengths (positive = towards the body's middle). */
export function kneeInside(b: Pick<BodyCtx, 'pts' | 'near' | 'view'>, s: Side): number | null {
  const p = all(b, s, ['hip', 'knee', 'ankle']);
  const hips = pair(b, 'hip');
  if (!p || !hips) return null;
  const [hip, knee, ankle] = p as [typeof p[0], typeof p[0], typeof p[0]];
  const leg = Math.hypot(ankle.x - hip.x, ankle.y - hip.y);
  if (leg <= 0 || Math.abs(ankle.y - hip.y) < 1e-6) return null;
  const u = (knee.y - hip.y) / (ankle.y - hip.y);
  const lineX = hip.x + u * (ankle.x - hip.x);
  const toMiddle = Math.sign(hips.x - lineX) || 1;
  return ((knee.x - lineX) * toMiddle) / leg;
}

// ---- rules shared by the family ----

export const depthRule = (id: string, views: readonly View[]): FormRule => ({
  kind: 'rep', id, severity: 'error', views,
  judge: (r) => r.maxP < 1,
  segments: (b) => (b.view === 'side' ? [thigh(b.near)] : ['thighL', 'thighR']),
  cue: 'squat.deeper',
});

export const kneesInRule: FormRule = {
  kind: 'live', id: 'squat.kneesIn', severity: 'error', views: ['front'], minP: 0.35,
  measure: (b) => ({ L: kneeInside(b, 'L'), R: kneeInside(b, 'R') }),
  bad: (v) => v > 0.07, clear: (v) => v < 0.04,
  segments: (_b, side) => (side ? [shin(side)] : ['shinL', 'shinR']),
  cue: 'squat.kneesOut',
};

export const shiftRule: FormRule = {
  kind: 'live', id: 'squat.shift', severity: 'tip', views: ['front'], minP: 0.5,
  measure(b) {
    const hips = pair(b, 'hip'), ankles = pair(b, 'ankle');
    if (!hips || !ankles || b.len.shoulders <= 0) return null;
    return Math.abs(hips.x - ankles.x) / b.len.shoulders;
  },
  bad: (v) => v > 0.25, clear: (v) => v < 0.15,
  segments: () => ['hips'],
  cue: 'squat.even',
  holdMs: 300,
};

/** Torso lean minus shin lean at the bottom, from the side (TORSO): leaning forward more than the shins do. */
export const chestRule = (phases: readonly ('top' | 'down' | 'bottom' | 'up')[] = ['bottom', 'up'], bad = 30, clear = 22): FormRule => ({
  kind: 'live', id: 'squat.chest', severity: 'tip', views: ['side'], minP: 0.6, phases,
  measure(b) {
    const p = all(b, b.near, ['shoulder', 'hip', 'knee', 'ankle']);
    if (!p) return null;
    return fromVertical(p[1]!, p[0]!) - fromVertical(p[3]!, p[2]!);
  },
  bad: (v) => v > bad, clear: (v) => v < clear,
  segments: () => ['torso'],
  cue: 'squat.chestUp',
});

export const tempoRule: FormRule = {
  kind: 'rep', id: 'squat.tempo', severity: 'tip', views: ['front', 'diag', 'side'],
  judge: (r) => r.bottomT - r.startT < 400,
  segments: () => [],
  cue: 'tempo.slower',
};

const SQUAT_PARTS: MoveDef['parts'] = ['head', 'shoulders', 'hips', 'knees', 'feet'];

export const squat: MoveDef = {
  id: 'squat',
  label: 'F',
  group: 'squat',
  views: ['front', 'diag', 'side'],
  parts: SQUAT_PARTS,
  // countAt 0.55: a quarter squat is not counted (the coach says to go deeper); on real video a kettlebell swing's forward
  // bend reached 0.53 and would have counted at 0.45 (sq-tf-frontraise-side)
  rep: { countAt: 0.55, upAt: 0.2, fullAt: 1, minMs: 500 },
  progress(b) {
    if (b.view === 'side') {
      const k = kneeAngle(b, b.near, true);
      if (k === null) return null;
      // bending over to pick a weight up is a hinge, not a squat: from the side, a torso more than 60 degrees forward is not
      // measured (a kettlebell pick-up counted as a half squat, sq-tf-racked-side, 11 Nov 2026)
      const lean = torsoLean(b);
      if (lean !== null && lean > 60) return null;
      return Math.max(0, Math.min(1.4, (170 - k) / 70));
    }
    return frontProgress(b);
  },
  rules: [depthRule('squat.depth', ['front', 'diag', 'side']), kneesInRule, shiftRule, chestRule(), tempoRule],
  returnCue: 'squat.standTall',
};

/** The same squat under another name (prisoner squat: hands behind the head; no rule looks at the arms). */
const renamed = (id: FormMoveId, label: MoveLabel): MoveDef => ({ ...squat, id, label });

export const prisonerSquat: MoveDef = renamed('prisonerSquat', 'F');

/**
 * Sumo squat: wide stance, toes out, from the front. Target h = 0.30 (SPEC 5.1 row 2: with the feet wide the thighs look
 * shorter in the picture). Knees caving in keeps the squat's threshold (0.07 leg lengths): SPEC proposed 0.05 for the sumo
 * stance, but nothing was measured at 0.05, so the more sensitive number is not used.
 */
export const sumoSquat: MoveDef = {
  id: 'sumoSquat',
  label: 'F',
  group: 'squat',
  views: ['front', 'diag'],
  parts: SQUAT_PARTS,
  rep: { countAt: 0.55, upAt: 0.2, fullAt: 1, minMs: 500 },
  progress: (b) => frontProgress(b, 0.3),
  rules: [depthRule('squat.depth', ['front', 'diag']), kneesInRule, shiftRule, tempoRule],
  returnCue: 'squat.standTall',
};

/** Jump squat: the squat's depth (h = 0.35: a shallower dip before the jump) and the knees on the way down. The jump itself
 *  and a soft landing are not measured. */
export const jumpSquat: MoveDef = {
  id: 'jumpSquat',
  label: 'F',
  group: 'squat',
  views: ['front', 'diag'],
  parts: SQUAT_PARTS,
  rep: { countAt: 0.55, upAt: 0.2, fullAt: 1, minMs: 400 },
  progress: (b) => frontProgress(b, 0.35),
  rules: [depthRule('squat.depth', ['front', 'diag']), kneesInRule],
  returnCue: 'squat.standTall',
};

/**
 * Chair (box) squat, from the side: sit back to the chair and stand up. Counted by the knee's angle (160 -> 110 degrees);
 * the chair sets the depth, so there is no depth rule (sitting on it is contact, which the camera cannot see).
 */
export const chairSquat: MoveDef = {
  id: 'chairSquat',
  label: 'F',
  group: 'squat',
  equipment: ['chair'],
  views: ['side', 'diag'],
  parts: SQUAT_PARTS,
  rep: { countAt: 0.55, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const k = kneeAngle(b, b.near, true);
    return k === null ? null : Math.max(0, Math.min(1.4, (170 - k) / 60));
  },
  rules: [chestRule(), tempoRule],
  returnCue: 'squat.standTall',
};

/** Squat hold: the clock runs while the squat stays at depth (a counted squat's target) and no error shows. */
export const squatHold: MoveDef = {
  ...squat,
  id: 'squatHold',
  label: 'H',
  hold: { enterAt: 0.95, leaveAt: 0.8, outCue: 'squat.deeper' },
  rules: [depthRule('squat.depth', ['front', 'diag', 'side']), kneesInRule, chestRule(['bottom'])],
};

/**
 * Wall sit, from the side: knees about 90 degrees (80-105), the back upright against the wall (torso within 15 degrees of the
 * vertical). Progress p = (170 - knee) / 75: in the position from p 0.87 (knee 105), out of it under p 0.8 (knee 110). The back
 * touching the wall is contact and is not seen; an upright torso is what the camera can check.
 */
export const wallSit: MoveDef = {
  id: 'wallSit',
  label: 'H',
  group: 'squat',
  equipment: ['wall'],
  views: ['side'],
  parts: SQUAT_PARTS,
  rep: { countAt: 0.55, upAt: 0.2, fullAt: 1, minMs: 500 },
  hold: { enterAt: 0.87, leaveAt: 0.8, outCue: 'wallSit.lower' },
  progress(b) {
    const k = kneeAngle(b, b.near, true);
    return k === null ? null : Math.max(0, Math.min(1.5, (170 - k) / 75));
  },
  rules: [
    // not judged (a hold has no repetitions): marks the thigh as the part the position is about, green while it is held
    { kind: 'rep', id: 'wallSit.depth', severity: 'error', views: ['side'], judge: () => null, segments: (b) => [thigh(b.near)], cue: 'wallSit.lower' },
    {
      kind: 'live', id: 'wallSit.back', severity: 'error', views: ['side'],
      measure: (b) => torsoLean(b),
      bad: (v) => v > 15, clear: (v) => v < 10,
      segments: () => ['torso'],
      cue: 'wallSit.backToWall',
      holdMs: 400,
    },
    {
      kind: 'live', id: 'wallSit.tooDeep', severity: 'tip', views: ['side'],
      measure: (b) => kneeAngle(b, b.near),
      bad: (v) => v < 78, clear: (v) => v > 84,
      segments: (b) => [thigh(b.near), shin(b.near)],
      cue: 'wallSit.higher',
      holdMs: 400,
    },
  ],
  returnCue: 'squat.standTall',
};
