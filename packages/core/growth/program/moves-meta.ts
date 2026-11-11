// What the program engine knows about each form coach move (SPEC 3.2), kept apart from the form coach's own files (which
// it only reads). Joint load is a planning aid for the "avoid" list, not a medical statement: 0 none, 1 some, 2 marked.
import type { FormMoveId } from '../../form/types.ts';

export type Pattern = 'squat' | 'hinge' | 'lunge' | 'pushH' | 'pushV' | 'pull' | 'coreAE' | 'coreFlex' | 'calf' | 'cardio' | 'mobility';
export type Muscle = 'quads' | 'glutes' | 'hamstrings' | 'calves' | 'chest' | 'shoulders' | 'triceps' | 'back' | 'core';
export type Area = 'knee' | 'back' | 'shoulder' | 'wrist' | 'neck';
export const AREAS: readonly Area[] = ['knee', 'back', 'shoulder', 'wrist', 'neck'];

export interface MoveMeta {
  pattern: Pattern;
  muscles: readonly Muscle[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  load: Partial<Record<Area, 0 | 1 | 2>>;
  impact: boolean;
  /** goes down to the floor */
  floor: boolean;
  /** one-leg balance */
  balance: boolean;
  unit: 'reps' | 'seconds';
  /** counted per side (time doubles) */
  perSide: boolean;
  /** seconds per repetition */
  tempoS: number;
  /** harder neighbour in its chain (easier is the reverse) */
  harder?: FormMoveId;
}

export const MOVE_META: Readonly<Record<FormMoveId, MoveMeta>> = {
  chairSquat: { pattern: 'squat', muscles: ['quads', 'glutes'], difficulty: 1, load: { knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'squat' },
  squat: { pattern: 'squat', muscles: ['quads', 'glutes'], difficulty: 2, load: { knee: 1, back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'prisonerSquat' },
  prisonerSquat: { pattern: 'squat', muscles: ['quads', 'glutes', 'back'], difficulty: 2, load: { knee: 1, back: 1, shoulder: 1, neck: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'sumoSquat' },
  sumoSquat: { pattern: 'squat', muscles: ['quads', 'glutes'], difficulty: 2, load: { knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'bulgarianSplitSquat' },
  jumpSquat: { pattern: 'cardio', muscles: ['quads', 'glutes', 'calves'], difficulty: 4, load: { knee: 2, back: 1 }, impact: true, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 2 },
  squatHold: { pattern: 'squat', muscles: ['quads', 'glutes'], difficulty: 2, load: { knee: 1 }, impact: false, floor: false, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  wallSit: { pattern: 'squat', muscles: ['quads'], difficulty: 2, load: { knee: 2 }, impact: false, floor: false, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  pistolSquat: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 5, load: { knee: 2 }, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 4 },
  cossackSquat: { pattern: 'lunge', muscles: ['quads', 'glutes', 'hamstrings'], difficulty: 4, load: { knee: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 4 },
  splitSquat: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 2, load: { knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 3, harder: 'reverseLunge' },
  reverseLunge: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 2, load: { knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 3, harder: 'forwardLunge' },
  forwardLunge: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 3, load: { knee: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 3, harder: 'bulgarianSplitSquat' },
  bulgarianSplitSquat: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 4, load: { knee: 2 }, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 4, harder: 'pistolSquat' },
  lateralLunge: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 3, load: { knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 3 },
  curtsyLunge: { pattern: 'lunge', muscles: ['glutes', 'quads'], difficulty: 3, load: { knee: 1 }, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 3 },
  jumpingLunge: { pattern: 'cardio', muscles: ['quads', 'glutes'], difficulty: 5, load: { knee: 2 }, impact: true, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 2 },
  jumpingJack: { pattern: 'cardio', muscles: ['calves', 'shoulders'], difficulty: 2, load: { knee: 1 }, impact: true, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 1 },
  stepJack: { pattern: 'cardio', muscles: ['calves', 'shoulders'], difficulty: 1, load: {}, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 1.5 },
  starJump: { pattern: 'cardio', muscles: ['quads', 'calves'], difficulty: 4, load: { knee: 2 }, impact: true, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 2 },
  highKnees: { pattern: 'cardio', muscles: ['quads', 'core'], difficulty: 3, load: { knee: 1 }, impact: true, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 0.6 },
  marching: { pattern: 'cardio', muscles: ['quads'], difficulty: 1, load: {}, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 1 },
  buttKicks: { pattern: 'cardio', muscles: ['hamstrings'], difficulty: 2, load: { knee: 1 }, impact: true, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 0.6 },
  burpee: { pattern: 'cardio', muscles: ['quads', 'chest', 'core'], difficulty: 5, load: { knee: 1, back: 1, wrist: 2, shoulder: 1 }, impact: true, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 4 },
  squatThrust: { pattern: 'cardio', muscles: ['quads', 'core'], difficulty: 4, load: { knee: 1, wrist: 2, back: 1 }, impact: true, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  inchworm: { pattern: 'mobility', muscles: ['hamstrings', 'core', 'shoulders'], difficulty: 3, load: { wrist: 2, back: 1, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 6 },
  skater: { pattern: 'cardio', muscles: ['glutes', 'quads'], difficulty: 3, load: { knee: 2 }, impact: true, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 1.5 },
  jumpRope: { pattern: 'cardio', muscles: ['calves'], difficulty: 3, load: { knee: 1 }, impact: true, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 0.5 },
  calfRaise: { pattern: 'calf', muscles: ['calves'], difficulty: 1, load: {}, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 2, harder: 'singleCalfRaise' },
  singleCalfRaise: { pattern: 'calf', muscles: ['calves'], difficulty: 3, load: {}, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 2 },
  stepUp: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 2, load: { knee: 1 }, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 3 },
  wallAngel: { pattern: 'mobility', muscles: ['shoulders', 'back'], difficulty: 1, load: { shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 4 },
  armCircles: { pattern: 'mobility', muscles: ['shoulders'], difficulty: 1, load: { shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  goodMorning: { pattern: 'hinge', muscles: ['hamstrings', 'glutes', 'back'], difficulty: 2, load: { back: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  pushUp: { pattern: 'pushH', muscles: ['chest', 'triceps', 'shoulders', 'core'], difficulty: 3, load: { wrist: 2, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  gluteBridge: { pattern: 'hinge', muscles: ['glutes', 'hamstrings'], difficulty: 1, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  dbShoulderPress: { pattern: 'pushV', muscles: ['shoulders', 'triceps'], difficulty: 2, load: { shoulder: 2, back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
};

/** The easier neighbour of a move in its chain (the reverse of `harder`). */
export function easierOf(id: FormMoveId): FormMoveId | null {
  for (const [k, m] of Object.entries(MOVE_META) as [FormMoveId, MoveMeta][]) if (m.harder === id) return k;
  return null;
}
