// Dumbbell moves (Faz 5). SPEC.md 5.8 rows 70-82, 5.9 rows 84-90, 5.10 rows 91-98, 5.11 rows 99-104, 5.12 rows 105-109.
//
// The dumbbell itself is never seen (SPEC 3: the weight is not recognised), so a dumbbell move is its bodyweight twin's measurement
// with the dumbbell's own rules added: the squat and lunge families reuse their definitions, the presses reuse the shoulder press,
// curls and extensions are measured by the near elbow's angle from the side, raises by how far the arm is lifted from hanging
// (the angle at the shoulder between hip and wrist), rows and hinges from the side.
//
// Not measured (SPEC 3): the weight, the wrist's turn (hammer, supinated, Zottman), a rounding back (no points on the spine),
// the shoulder blades, shrugging (it moves a few centimetres: only counted), contact with a bench or the knee.
import { angleAt, type Side } from '../geometry.ts';
import type { BodyCtx, FormRule, LiveRule, MoveDef } from '../types.ts';
import { arm, forearm, upperArm } from '../segments.ts';
import { all, at, liveRule, nose, pair, repRule, topRule } from './kit.ts';
import { armRaise, clampP, elbowAngle, upperArmLean } from './arms.ts';
import { burpee, floorAndBack } from './cardio.ts';
import { dbShoulderPress, handHeights } from './dbShoulderPress.ts';
import { hipThrust } from './floor.ts';
import { inPlank } from './pushUp.ts';
import { handHeight, hipAngle, kneeAngle, lowerHand, torsoLean } from './legs.ts';
import { bulgarianSplitSquat, reverseLunge } from './lunges.ts';
import { chestRule, depthRule, frontProgress, kneesInRule, shiftRule, squat, sumoSquat, tempoRule } from './squat.ts';
import { calfRaise, goodMorning, stepUp } from './standing.ts';

type B = Omit<BodyCtx, 'p' | 'phase'>;
const SIDE = ['side', 'diag'] as const;
const FRONT = ['front', 'diag'] as const;
const ARM_PARTS: MoveDef['parts'] = ['head', 'shoulders', 'elbows', 'hands', 'hips'];
const FULL_PARTS: MoveDef['parts'] = ['head', 'shoulders', 'elbows', 'hands', 'hips', 'knees', 'feet'];
const BOTH_ARMS = (): readonly ('upperArmL' | 'upperArmR' | 'forearmL' | 'forearmR')[] => ['upperArmL', 'upperArmR', 'forearmL', 'forearmR'];

/** A move that is another move's measurement with a dumbbell in the hands. */
const withDumbbells = (m: MoveDef, id: MoveDef['id'], extra: readonly ('chair' | 'wall' | 'step' | 'dumbbell')[] = []): MoveDef => ({
  ...m, id, group: 'dumbbell', equipment: [...extra, 'dumbbell'],
});

// ---- lower body ----

/** Goblet squat: the squat's rules, the torso allowed a little less lean (25 degrees: the weight in front keeps it upright). */
export const gobletSquat: MoveDef = {
  ...withDumbbells(squat, 'gobletSquat'),
  rules: [depthRule('squat.depth', ['front', 'diag', 'side']), kneesInRule, shiftRule, chestRule(['bottom', 'up'], 25, 18), tempoRule],
};

/** Dumbbell front squat (weights at the shoulders), from the side or at an angle: depth, torso, tempo. */
export const dbFrontSquat: MoveDef = {
  ...withDumbbells(squat, 'dbFrontSquat'),
  views: SIDE,
  rules: [depthRule('squat.depth', SIDE), chestRule(['bottom', 'up'], 25, 18), tempoRule],
};

export const dbSumoSquat: MoveDef = withDumbbells(sumoSquat, 'dbSumoSquat');

/** BAR-PATH: how far the wrist is from the leg's line (the shin below the knee, the thigh above it), in thigh lengths. */
const barPath = (id: string): LiveRule => liveRule({
  id, severity: 'tip', views: ['side'], phases: ['top', 'down', 'bottom', 'up'], minP: 0.3,
  measure(b) {
    const p = all(b, b.near, ['hip', 'knee', 'ankle']);
    const wr = at(b, b.near, 'wrist');
    if (!p || !wr || b.len.thigh <= 0) return null;
    const [hip, knee, ankle] = p as [NonNullable<typeof wr>, NonNullable<typeof wr>, NonNullable<typeof wr>];
    const [a, c] = wr.y >= knee.y ? [knee, ankle] : [hip, knee];
    const dy = c.y - a.y;
    if (Math.abs(dy) < 1e-3) return null;
    return Math.abs(wr.x - (a.x + ((wr.y - a.y) / dy) * (c.x - a.x))) / b.len.thigh;
  },
  bad: (v) => v > 0.4, clear: (v) => v < 0.28,
  segments: (b) => [forearm(b.near)], cue: 'rdl.bar', holdMs: 300,
});

/**
 * Romanian deadlift, from the side: the hip hinge, shoulder-hip-knee 172 -> 115 degrees. Counted only with the knees not bent into a
 * squat (115 degrees and over). Rules: knees soft only (a tip), how far the hinge goes (a tip: it depends on the hamstrings),
 * dumbbells close to the legs. A rounding back is not measured.
 */
export const romanianDeadlift: MoveDef = {
  ...withDumbbells(goodMorning, 'romanianDeadlift'),
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 900 },
  progress(b) {
    const a = hipAngle(b, b.near, true), k = kneeAngle(b, b.near, true);
    if (a === null || (k !== null && k < 115)) return null;
    return clampP((172 - a) / 57, 1.4);
  },
  rules: [...goodMorning.rules, barPath('rdl.bar')],
};

export const singleLegRdl: MoveDef = { ...romanianDeadlift, id: 'singleLegRdl', label: 'S', rules: [] };

/** Deadlift from the floor, from the side: the hip bend 172 -> 92 degrees. Rule: the dumbbells close to the legs. */
export const dbDeadlift: MoveDef = {
  ...withDumbbells(goodMorning, 'dbDeadlift'),
  rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 900 },
  progress(b) {
    const a = hipAngle(b, b.near, true);
    return a === null ? null : clampP((172 - a) / 80, 1.4);
  },
  rules: [barPath('deadlift.bar')],
};

export const dbLunge: MoveDef = withDumbbells(reverseLunge, 'dbLunge');
export const dbBulgarian: MoveDef = withDumbbells(bulgarianSplitSquat, 'dbBulgarian', ['chair']);
export const dbStepUp: MoveDef = withDumbbells(stepUp, 'dbStepUp', ['step']);
export const dbHipThrust: MoveDef = withDumbbells(hipThrust, 'dbHipThrust', ['chair']);
export const dbCalfRaise: MoveDef = withDumbbells(calfRaise, 'dbCalfRaise');

/** Swing with both hands: count only, each hinge and stand-up (the hip bend 172 -> 122 degrees). The speed blurs the arms. */
export const dbSwing: MoveDef = {
  id: 'dbSwing', label: 'S', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, parts: FULL_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 500 },
  progress(b) {
    const a = hipAngle(b, b.near, true);
    return a === null ? null : clampP((172 - a) / 50);
  },
  rules: [], returnCue: 'move.reset',
};

/** Hands of the lower arm over the shoulder, for the thruster's press half. */
const pressP = (b: B): number | null => {
  const h = handHeights(b);
  return h.L === null || h.R === null ? null : clampP((Math.min(h.L, h.R) - 0.1) / 0.7);
};
const pressRule = (id: string): FormRule | undefined => dbShoulderPress.rules.find((r) => r.id === id);

/**
 * Thruster, from the front: a squat and a press in one flow. The progress is the larger of the squat's depth (hips towards the
 * knees, h = 0.2) and the press (the lower hand's height over its shoulder). Both are tracked through the repetition: clean needs
 * the depth and the arms up. Paused between the squat and the press, the press counts as a repetition of its own.
 */
export const thruster: MoveDef = {
  id: 'thruster', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: FRONT, parts: FULL_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 900 },
  progress(b) {
    const d = frontProgress(b);
    return d === null ? null : Math.max(d, pressP(b) ?? 0);
  },
  track: [
    { id: 'depth', agg: 'max', value: (b) => frontProgress(b) },
    { id: 'arms', agg: 'max', value: (b) => pressP(b) },
  ],
  rules: [
    repRule({ id: 'thruster.depth', severity: 'error', views: FRONT, judge: (r) => (r.at.depth === undefined ? null : r.at.depth < 1), segments: () => ['thighL', 'thighR'], cue: 'squat.deeper' }),
    repRule({ id: 'thruster.top', severity: 'error', views: FRONT, judge: (r) => (r.at.arms === undefined ? null : r.at.arms < 1), segments: () => ['forearmL', 'forearmR'], cue: 'press.higher' }),
    kneesInRule,
    pressRule('press.together')!,
  ],
  shallowCue: 'squat.deeper',
  returnCue: 'press.lowerToShoulders',
};

// ---- shoulders ----

/** Arnold press: the shoulder press's measurement (the palm turn is not seen); the elbows-under-wrists rule is left out, the start
 *  position has the elbows in front. */
export const arnoldPress: MoveDef = {
  ...dbShoulderPress, id: 'arnoldPress',
  rules: dbShoulderPress.rules.filter((r) => r.id !== 'press.stack'),
};

/** Push press: the shoulder press with a dip of the knees (the dip is not measured). */
export const pushPress: MoveDef = { ...dbShoulderPress, id: 'pushPress' };

/** The lower of both arms' lift from hanging, from the front (lateral raise). */
const lowerRaise = (b: B, count = true): number | null => {
  const l = armRaise(b, 'L', count), r = armRaise(b, 'R', count);
  return l === null || r === null ? null : Math.min(l, r);
};

/**
 * Lateral raise, from the front, both arms: the arm's lift from hanging 25 -> 80 degrees (shoulder height). Rules: up to shoulder
 * height (tip), not above it (tip), both arms together (tip), no leaning to a side.
 */
export const lateralRaise: MoveDef = {
  id: 'lateralRaise', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: FRONT, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const a = lowerRaise(b);
    return a === null ? null : clampP((a - 25) / 55);
  },
  track: [{ id: 'high', agg: 'max', value: (b) => lowerRaise(b) }],
  rules: [
    topRule('lateral.top', 'raise.higher', FRONT, BOTH_ARMS, 'tip'),
    repRule({ id: 'lateral.high', severity: 'tip', views: FRONT, judge: (r) => (r.at.high === undefined ? null : r.at.high > 118), segments: BOTH_ARMS, cue: 'raise.tooHigh' }),
    liveRule({
      id: 'lateral.together', severity: 'tip', views: ['front'], minP: 0.3,
      measure(b) {
        const l = armRaise(b, 'L'), r = armRaise(b, 'R');
        return l === null || r === null ? null : Math.abs(l - r);
      },
      bad: (v) => v > 30, clear: (v) => v < 18,
      segments: (b) => {
        const l = armRaise(b, 'L'), r = armRaise(b, 'R');
        return l === null || r === null ? ['upperArmL', 'upperArmR'] : l < r ? ['upperArmL', 'forearmL'] : ['upperArmR', 'forearmR'];
      },
      cue: 'raise.together', holdMs: 250,
    }),
    pressRule('press.upright')!,
  ],
  shallowCue: 'raise.higher',
  returnCue: 'raise.lower',
};

/** Front raise, from the side: the near arm's lift from hanging 25 -> 90 degrees. Rules: up to shoulder height, not above it, torso still. */
export const frontRaise: MoveDef = {
  id: 'frontRaise', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const a = armRaise(b, b.near, true);
    return a === null ? null : clampP((a - 25) / 65);
  },
  track: [{ id: 'high', agg: 'max', value: (b) => armRaise(b, b.near) }],
  rules: [
    topRule('front.top', 'raise.higher', SIDE, (b) => arm(b.near), 'tip'),
    repRule({ id: 'front.high', severity: 'tip', views: SIDE, judge: (r) => (r.at.high === undefined ? null : r.at.high > 115), segments: (b) => arm(b.near), cue: 'raise.tooHigh' }),
    liveRule({
      id: 'front.swing', severity: 'tip', views: ['side'], minP: 0.2,
      measure: (b) => torsoLean(b),
      bad: (v) => v > 15, clear: (v) => v < 10,
      segments: () => ['torso'], cue: 'swing.still', holdMs: 300,
    }),
  ],
  shallowCue: 'raise.higher',
  returnCue: 'raise.lower',
};

/** Bent-over rear delt fly, from the side: count only, the wrist rising from hanging below the shoulder to shoulder height. */
export const rearDeltFly: MoveDef = {
  id: 'rearDeltFly', label: 'S', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const lean = torsoLean(b), sh = at(b, b.near, 'shoulder', true), wr = at(b, b.near, 'wrist', true);
    const armLen = b.len.upperArm + b.len.forearm;
    if (lean === null || lean < 35 || !sh || !wr || armLen <= 0) return null;
    return clampP((0.9 - (wr.y - sh.y) / armLen) / 0.6);
  },
  rules: [], returnCue: 'raise.lower',
};

/**
 * Upright row, from the front: the lower hand from hanging (-1 arm lengths under the shoulder) to chest height (-0.3). Rules: up to
 * the chest (tip), the elbows not above the shoulders (tip), both arms together.
 */
export const uprightRow: MoveDef = {
  id: 'uprightRow', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: FRONT, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 700 },
  progress(b) {
    const h = lowerHand(b);
    return h === null ? null : clampP((h + 0.9) / 0.6);
  },
  track: [{
    id: 'elbow', agg: 'max',
    value(b) {
      const armLen = b.len.upperArm + b.len.forearm;
      let best: number | null = null;
      for (const s of ['L', 'R'] as const) {
        const sh = at(b, s, 'shoulder'), el = at(b, s, 'elbow');
        if (!sh || !el || armLen <= 0) return null;
        const v = (sh.y - el.y) / armLen;
        best = best === null ? v : Math.max(best, v);
      }
      return best;
    },
  }],
  rules: [
    topRule('uprow.top', 'uprow.higher', FRONT, BOTH_ARMS, 'tip'),
    repRule({ id: 'uprow.elbows', severity: 'tip', views: FRONT, judge: (r) => (r.at.elbow === undefined ? null : r.at.elbow > 0.2), segments: () => ['upperArmL', 'upperArmR'], cue: 'uprow.elbows' }),
    pressRule('press.together')!,
  ],
  shallowCue: 'uprow.higher',
  returnCue: 'uprow.lower',
};

/** Shrug, from the front: count only. The shoulders' rise towards the ears, 0.06 torso lengths against the widest gap in the last 4 s. */
export const shrug: MoveDef = {
  id: 'shrug', label: 'S', group: 'dumbbell', equipment: ['dumbbell'], views: FRONT, parts: ARM_PARTS, rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 400 },
  makeProgress() {
    const ring: { t: number; g: number }[] = [];
    return (b) => {
      const n = nose(b, true), sh = pair(b, 'shoulder', true);
      if (!n || !sh || b.len.torso <= 0) return null;
      // the gap in picture units (a shrug lengthens the shoulder-to-hip distance too, so a gap in torso lengths would drift)
      const gap = sh.y - n.y;
      ring.push({ t: b.t, g: gap });
      while (ring.length && ring[0]!.t < b.t - 4000) ring.shift();
      let ref = -Infinity;
      for (const r of ring) if (r.g > ref) ref = r.g;
      return clampP((ref - gap) / (0.06 * b.len.torso));
    };
  },
  rules: [], returnCue: 'move.reset',
};

// ---- arms ----

interface CurlOpts { id: MoveDef['id']; label?: 'F' | 'S'; elbowRule?: boolean; swingRule?: boolean }

/**
 * Curls, from the side: the near elbow's angle from extended (150 degrees) to curled (80), the near arm only (the far arm hides
 * behind the body). Rules: all the way up, the elbow at the side (the upper arm within 35 degrees of the vertical), the torso still.
 * The turn of the wrist (hammer, Zottman) is not seen, so the curl variants share one measurement.
 */
function curl(o: CurlOpts): MoveDef {
  const rules: FormRule[] = o.label === 'S' ? [] : [
    topRule('curl.top', 'curl.higher', SIDE, (b) => arm(b.near)),
    ...(o.elbowRule === false ? [] : [liveRule({
      id: 'curl.elbow', severity: 'tip', views: SIDE, minP: 0.2,
      measure: (b) => upperArmLean(b, b.near),
      bad: (v) => v > 35, clear: (v) => v < 25,
      segments: (b) => [upperArm(b.near)], cue: 'curl.elbowStill', holdMs: 300,
    })]),
    ...(o.swingRule === false ? [] : [liveRule({
      id: 'curl.swing', severity: 'tip', views: ['side'], minP: 0.2,
      measure: (b) => torsoLean(b),
      bad: (v) => v > 15, clear: (v) => v < 10,
      segments: () => ['torso'], cue: 'swing.still', holdMs: 300,
    })]),
  ];
  return {
    id: o.id, label: o.label ?? 'F', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, parts: ARM_PARTS,
    rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
    progress(b) {
      const e = elbowAngle(b, b.near, true);
      return e === null ? null : clampP((150 - e) / 70);
    },
    rules,
    shallowCue: 'curl.higher',
    returnCue: 'curl.lower',
  };
}

export const bicepsCurl = curl({ id: 'bicepsCurl' });
export const hammerCurl = curl({ id: 'hammerCurl' });
export const concentrationCurl = curl({ id: 'concentrationCurl', elbowRule: false, swingRule: false });
export const zottmanCurl = curl({ id: 'zottmanCurl', label: 'S' });

/**
 * Overhead triceps extension, from the side: the near elbow overhead, bending 160 -> 80 degrees behind the head. Counted only with
 * the elbow at about shoulder height or above. Rules: lower far enough, the elbow pointing up (upper arm within 35 degrees of the vertical).
 */
export const overheadTricepsExt: MoveDef = {
  id: 'overheadTricepsExt', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 700 },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), el = at(b, b.near, 'elbow', true), e = elbowAngle(b, b.near, true);
    if (!sh || !el || e === null || el.y > sh.y + 0.3 * b.len.upperArm) return null;
    return clampP((160 - e) / 80);
  },
  rules: [
    topRule('ext.depth', 'ext.lower', SIDE, (b) => arm(b.near)),
    liveRule({
      id: 'ext.elbow', severity: 'tip', views: SIDE, minP: 0.2,
      measure: (b) => upperArmLean(b, b.near),
      bad: (v) => v > 35, clear: (v) => v < 25,
      segments: (b) => [upperArm(b.near)], cue: 'ext.elbowUp', holdMs: 300,
    }),
  ],
  shallowCue: 'ext.lower',
  returnCue: 'ext.straighten',
};

/**
 * Triceps kickback, bent over, from the side: the near elbow from bent 90 degrees to straight 160. Counted only with the torso leaning
 * 30 degrees or more. Rules: straighten fully, the upper arm held along the back (the angle at the shoulder between hip and elbow
 * under 45 degrees).
 */
export const tricepsKickback: MoveDef = {
  id: 'tricepsKickback', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 600 },
  progress(b) {
    const lean = torsoLean(b), e = elbowAngle(b, b.near, true);
    return lean === null || lean < 30 || e === null ? null : clampP((e - 95) / 65);
  },
  rules: [
    topRule('kickback.top', 'kickback.straighten', SIDE, (b) => arm(b.near)),
    liveRule({
      id: 'kickback.elbow', severity: 'tip', views: SIDE, minP: 0.2,
      measure(b) {
        const p = all(b, b.near, ['hip', 'shoulder', 'elbow']);
        return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
      },
      bad: (v) => v > 45, clear: (v) => v < 35,
      segments: (b) => [upperArm(b.near)], cue: 'kickback.elbowUp', holdMs: 300,
    }),
  ],
  returnCue: 'kickback.bend',
};

/** Lying on the back, the arm pressing up: count only, the near elbow from straight (165 degrees) down to `bottom`. */
function lyingElbow(id: MoveDef['id'], bottom: number): MoveDef {
  return {
    id, label: 'S', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, lying: true, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 700 },
    progress(b) {
      const sh = at(b, b.near, 'shoulder', true), hip = at(b, b.near, 'hip', true), e = elbowAngle(b, b.near, true);
      if (!sh || !hip || e === null || Math.abs(sh.y - hip.y) > 0.5 * Math.abs(sh.x - hip.x)) return null;
      return clampP((165 - e) / (165 - bottom));
    },
    rules: [], returnCue: 'move.reset',
  };
}
export const floorPress = lyingElbow('floorPress', 95);
export const closeGripFloorPress = lyingElbow('closeGripFloorPress', 95);
export const skullCrusher = lyingElbow('skullCrusher', 80);

/** Pullover, lying on the back: count only, the arm from over the chest (about 95 degrees at the shoulder) to overhead (155). */
export const pullover: MoveDef = {
  id: 'pullover', label: 'S', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, lying: true, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 900 },
  progress(b) {
    const sh = at(b, b.near, 'shoulder', true), hip = at(b, b.near, 'hip', true), a = armRaise(b, b.near, true);
    if (!sh || !hip || a === null || Math.abs(sh.y - hip.y) > 0.5 * Math.abs(sh.x - hip.x)) return null;
    return clampP((a - 95) / 60);
  },
  rules: [], returnCue: 'move.reset',
};

// ---- back ----

/**
 * Bent-over row, from the side: the near elbow from straight 160 to bent 95 degrees, the torso leaning 25 degrees or more.
 * Rules: pull high enough (tip), the torso still (its lean may not change more than 15 degrees in a repetition: a tip).
 */
export const bentOverRow: MoveDef = {
  id: 'bentOverRow', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, parts: ARM_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 700 },
  progress(b) {
    const lean = torsoLean(b), e = elbowAngle(b, b.near, true);
    return lean === null || lean < 25 || e === null ? null : clampP((160 - e) / 65);
  },
  track: [
    { id: 'leanMax', agg: 'max', value: (b) => torsoLean(b) },
    { id: 'leanMin', agg: 'min', value: (b) => torsoLean(b) },
  ],
  rules: [
    topRule('row.top', 'row.higher', SIDE, (b) => arm(b.near), 'tip'),
    repRule({
      id: 'row.sway', severity: 'tip', views: SIDE,
      judge: (r) => (r.at.leanMax === undefined || r.at.leanMin === undefined ? null : r.at.leanMax - r.at.leanMin > 15),
      segments: () => ['torso'], cue: 'row.still',
    }),
  ],
  shallowCue: 'row.higher',
  returnCue: 'row.lower',
};

/** One-arm row with the free hand on a chair: the bent-over row's measurement and rules (the torso lean is larger). */
export const oneArmRow: MoveDef = { ...bentOverRow, id: 'oneArmRow', equipment: ['dumbbell', 'chair'] };

/** Renegade row in a plank, from the side: count only, the near elbow's bend (160 -> 95 degrees) while the body stays along the picture. */
export const renegadeRow: MoveDef = {
  id: 'renegadeRow', label: 'S', group: 'dumbbell', equipment: ['dumbbell'], views: SIDE, lying: true, parts: FULL_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 800 },
  progress(b) {
    if (!inPlank(b)) return null;
    const e = elbowAngle(b, b.near, true);
    return e === null ? null : clampP((160 - e) / 65);
  },
  rules: [], returnCue: 'move.reset',
};

// ---- core and whole body ----

/**
 * Side bend, from the front: the torso's lean from the vertical (shoulder midpoint against hip midpoint), 5 -> 20 degrees, each
 * side counted by its own machine. Rules: far enough (tip), the hips not shifting (tip). Leaning forward is not seen from the front.
 */
export const dbSideBend: MoveDef = {
  id: 'dbSideBend', label: 'F', group: 'dumbbell', equipment: ['dumbbell'], views: FRONT, parts: FULL_PARTS, rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 700 },
  sideProgress(b, s: Side) {
    const sh = pair(b, 'shoulder', true), hip = pair(b, 'hip', true);
    if (!sh || !hip || hip.y <= sh.y) return null;
    const dx = (hip.x - sh.x) * (s === 'L' ? 1 : -1);
    return clampP(((Math.atan2(dx, hip.y - sh.y) * 180) / Math.PI - 5) / 15);
  },
  rules: [
    repRule({ id: 'sideBend.top', severity: 'tip', views: FRONT, judge: (r) => r.maxP < 1, segments: () => ['torso'], cue: 'sideBend.further' }),
    { ...(shiftRule as LiveRule), id: 'sideBend.hips', minP: 0.3 },
  ],
  shallowCue: 'sideBend.further',
  returnCue: 'sideBend.upright',
};

/** Man maker: count only, down to the plank and back up (the body's tilt from the vertical). */
export const manMaker: MoveDef = { ...floorAndBack('manMaker', 1500), equipment: ['dumbbell'], group: 'dumbbell', parts: burpee.parts };

/** Snatch: count only, one or both hands overhead (the higher hand's height over its shoulder, 0.2 -> 0.9 arm lengths). */
export const dbSnatch: MoveDef = {
  id: 'dbSnatch', label: 'S', group: 'dumbbell', equipment: ['dumbbell'], views: FRONT, parts: FULL_PARTS, rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 500 },
  progress(b) {
    const l = handHeight(b, 'L'), r = handHeight(b, 'R');
    if (l === null && r === null) return null;
    return clampP((Math.max(l ?? -1, r ?? -1) - 0.2) / 0.7);
  },
  rules: [], returnCue: 'move.reset',
};
