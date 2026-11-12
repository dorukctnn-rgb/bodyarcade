// The lunge family and the one-legged squats (Faz 3). SPEC.md 5.1 rows 7-10, 5.2 rows 12-17; rules KNEE-90 (front thigh to
// level), TORSO-UP, TEMPO, plus the lateral lunge's straight leg.
//
// Counting: one repetition machine per leg (coach.ts), on that leg's own thigh-level progress (legs.ts thighLevelProgress):
// the front leg of a lunge comes up to level while the back thigh stays near vertical. Both thighs coming up together is a
// squat, not a lunge (`exclusive`). From the side or at an angle only: from the front the two legs lie one behind the other
// and the model mixes them up (a deep front-view lunge read like a quarter lunge on both legs, ln-mixkit-42900-front,
// 11 Nov 2026). The torso rule needs the true angle and is side-only.
//
// Not measured: the front knee caving in from the side (a front-view thing), the back knee touching the floor (contact), the
// hips turning (rotation), balance.
import { type Side, type View } from '../geometry.ts';
import type { FormMoveId, FormRule, MoveDef, MoveLabel, RepOpts, SegmentId } from '../types.ts';
import { shin, thigh } from '../segments.ts';
import { at, other } from './kit.ts';
import { kneeAngle, thighLevelProgress, torsoLean } from './legs.ts';

const LEG_PARTS: MoveDef['parts'] = ['head', 'shoulders', 'hips', 'knees', 'feet'];
const ALL_VIEWS: readonly View[] = ['side', 'diag'];

const leg = (s: Side | null): SegmentId[] => (s ? [thigh(s), shin(s)] : ['thighL', 'thighR']);

const depth = (views: readonly View[]): FormRule => ({
  kind: 'rep', id: 'lunge.depth', severity: 'error', views,
  judge: (r) => r.maxP < 1,
  segments: (b) => leg(b.work),
  cue: 'lunge.lower',
});

/** TORSO-UP: from the side, the torso within `max` degrees of the vertical at the bottom. */
const upright = (max: number): FormRule => ({
  kind: 'live', id: 'lunge.upright', severity: 'tip', views: ['side'], minP: 0.6, phases: ['bottom', 'up'],
  measure: (b) => torsoLean(b),
  bad: (v) => v > max, clear: (v) => v < max - 7,
  segments: () => ['torso'],
  cue: 'lunge.chestUp',
  holdMs: 250,
});

const tempo: FormRule = {
  kind: 'rep', id: 'lunge.tempo', severity: 'tip', views: ALL_VIEWS,
  judge: (r) => r.bottomT - r.startT < 400,
  segments: () => [],
  cue: 'tempo.slower',
};

/**
 * A lunge's progress for leg s: its thigh coming up to level, scaled by how bent the OTHER knee is (full from 130 degrees, none
 * at 165). In a lunge the back knee bends; a knee driven up while standing on a straight leg (a knee drive, a high knee) brings
 * a thigh to level too and must not count (mk-52316: jumping lunges with a knee drive between them, 11 Nov 2026).
 */
export function lungeProgress(b: Parameters<typeof thighLevelProgress>[0], s: Side, target: number): number | null {
  const p = thighLevelProgress(b, s, target);
  if (p === null) return null;
  const k = kneeAngle(b, other(s), true);
  return k === null ? p : p * Math.max(0, Math.min(1, (165 - k) / 35));
}

interface LegMove {
  id: FormMoveId;
  label: MoveLabel;
  group?: MoveDef['group'];
  views?: readonly View[];
  /** The working thigh's drop below the hip, in thigh lengths, that counts as deep enough (0 = level). */
  target: number;
  exclusive: number;
  rep?: Partial<RepOpts>;
  rules: readonly FormRule[];
  equipment?: MoveDef['equipment'];
  returnCue?: string;
}

function legMove(o: LegMove): MoveDef {
  return {
    id: o.id, label: o.label, group: o.group ?? 'lunge', views: o.views ?? ALL_VIEWS, parts: LEG_PARTS,
    ...(o.equipment ? { equipment: o.equipment } : {}),
    // upAt 0.3: standing between lunges reads a thigh drop of about 0.85, not 1 (the running thigh length takes the longest
    // projection seen, usually at the bottom), i.e. a progress of 0.2 (ln-mixkit-42898-45, 11 Nov 2026)
    rep: { countAt: 0.5, upAt: 0.3, fullAt: 1, minMs: 500, ...o.rep },
    sideProgress: (b, s) => lungeProgress(b, s, o.target),
    exclusive: o.exclusive,
    rules: o.rules,
    shallowCue: 'lunge.lower',
    returnCue: o.returnCue ?? 'lunge.standTall',
  };
}

/**
 * Reverse and forward lunge: the front thigh to within 0.32 thigh lengths of level (about a 110-degree front knee with the shin
 * upright). 0.25 (105 degrees, SPEC) called a deep, good lunge shallow on real video: the two legs read up to 0.25 apart on
 * lunges that look the same, by perspective (ln-mixkit-52110-side, 11 Nov 2026; tuned on that clip).
 */
export const reverseLunge = legMove({ id: 'reverseLunge', label: 'F', target: 0.32, exclusive: 0.6, rules: [depth(ALL_VIEWS), upright(25), tempo] });
export const forwardLunge = legMove({ id: 'forwardLunge', label: 'F', target: 0.32, exclusive: 0.6, rules: [depth(ALL_VIEWS), upright(25), tempo] });

/** Split squat: a lunge without the step; the top of each repetition keeps the split stance. */
export const splitSquat = legMove({ id: 'splitSquat', label: 'F', target: 0.32, exclusive: 0.6, rules: [depth(ALL_VIEWS), upright(25), tempo], returnCue: 'lunge.riseFully' });

/** Bulgarian split squat: the back foot on a chair; the back thigh leans back more, and a little forward lean is normal (35). */
export const bulgarianSplitSquat = legMove({
  id: 'bulgarianSplitSquat', label: 'F', target: 0.32, exclusive: 0.75, rep: { upAt: 0.25 }, equipment: ['chair'],
  rules: [depth(ALL_VIEWS), upright(35), tempo], returnCue: 'lunge.riseFully',
});

/** Jumping lunge: counted per landing; fast, so no form rule is offered (count only). */
export const jumpingLunge = legMove({ id: 'jumpingLunge', label: 'S', target: 0.3, exclusive: 0.6, rep: { minMs: 300 }, rules: [] });

/**
 * The side-to-side family (lateral lunge, Cossack squat), from the front: the bent knee's angle, which lies in the picture plane
 * when the leg steps out sideways. Not the thigh's drop: in the wide stance both thighs lean out even with straight legs, and
 * between two Cossack squats the player stays half-bent (thighs read 0.62-0.8 there, cs-tf-cossack-front, 11 Nov 2026).
 */
const sideKnee = (target: number) => (b: Parameters<typeof thighLevelProgress>[0], s: Side): number | null => {
  const k = kneeAngle(b, s, true);
  return k === null ? null : Math.max(0, Math.min(1.5, (170 - k) / (170 - target)));
};

/** Lateral lunge: the bent knee to 110 degrees, the other leg straight (knee 150 degrees or more). */
export const lateralLunge: MoveDef = {
  ...legMove({ id: 'lateralLunge', label: 'F', views: ['front', 'diag'], target: 0, exclusive: 0.6, rules: [] }),
  sideProgress: sideKnee(110),
  rules: [
    depth(['front', 'diag']),
    {
      kind: 'live', id: 'lunge.straightLeg', severity: 'tip', views: ['front'], minP: 0.7, phases: ['bottom'],
      measure: (b) => (b.work ? kneeAngle(b, other(b.work)) : null),
      bad: (v) => v < 150, clear: (v) => v > 158,
      segments: (b) => (b.work ? leg(other(b.work)) : []),
      cue: 'lunge.otherLegStraight',
      holdMs: 250,
    },
    tempo,
  ],
};

/** Cossack squat: a deep lateral lunge, the bent knee to 95 degrees. Count only. */
export const cossackSquat: MoveDef = {
  ...legMove({ id: 'cossackSquat', label: 'S', group: 'squat', views: ['front', 'diag'], target: 0, exclusive: 0.6, rep: { countAt: 0.55 }, rules: [] }),
  sideProgress: sideKnee(95),
};

/** Curtsy lunge, from the front: the back leg crosses behind; counted on the front leg. Count only (the hips turn). */
export const curtsyLunge = legMove({ id: 'curtsyLunge', label: 'S', views: ['diag', 'front'], target: 0.3, exclusive: 0.6, rules: [] });

/**
 * Pistol (single-leg) squat, assisted or to a chair, from the side: the working leg is the one whose ankle stays on the floor
 * while the other foot is clearly off it (0.25 shin lengths higher); its knee's angle counts, 160 -> 100 degrees (the knee's
 * true angle from the side; the thigh's drop read only half way on a real single-leg squat that leans forward, ps-single-leg-
 * side, 11 Nov 2026). With both feet down nothing counts (a two-legged squat is not a pistol). Count only: balance and the
 * knee's tracking are not measured.
 */
export const pistolSquat: MoveDef = {
  id: 'pistolSquat', label: 'S', group: 'squat', views: ['side', 'diag'], parts: LEG_PARTS,
  rep: { countAt: 0.55, upAt: 0.3, fullAt: 1, minMs: 600 },
  sideProgress(b, s) {
    const me = at(b, s, 'ankle', true), them = at(b, other(s), 'ankle', true);
    if (!me || !them || b.len.shin <= 0) return null;
    const k = kneeAngle(b, s, true);
    if (k === null) return null;
    // the other foot not clearly off the floor: standing on both feet is the start position; bent on both is not this leg's
    // repetition (a squat), and near the bottom the free foot can dip close to the floor, so that reads as unknown
    if (them.y > me.y - 0.25 * b.len.shin) return k > 150 ? 0 : null;
    return Math.max(0, Math.min(1.5, (160 - k) / 60));
  },
  rules: [],
  shallowCue: 'lunge.lower',
  returnCue: 'squat.standTall',
};
