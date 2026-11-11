// What the program engine knows about each form coach move (SPEC 3.2), kept apart from the form coach's own files (which
// it only reads). Joint load is a planning aid for the "avoid" list, not a medical statement: 0 none, 1 some, 2 marked.
import { FORM_MOVES, FORM_MOVE_IDS } from '../../form/moves/index.ts';
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

/** Written by hand for every move of the catalogue at the time of writing; a move the form coach adds later gets a cautious
 *  guess from its own definition (derive) until it is written here. */
const EXPLICIT: Readonly<Partial<Record<FormMoveId, MoveMeta>>> = {
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
  gluteBridge: { pattern: 'hinge', muscles: ['glutes', 'hamstrings'], difficulty: 1, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'singleLegBridge' },
  dbShoulderPress: { pattern: 'pushV', muscles: ['shoulders', 'triceps'], difficulty: 2, load: { shoulder: 2, back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  singleLegBridge: { pattern: 'hinge', muscles: ['glutes', 'hamstrings'], difficulty: 2, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: true, tempoS: 3, harder: 'hipThrust' },
  hipThrust: { pattern: 'hinge', muscles: ['glutes', 'hamstrings'], difficulty: 3, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  superman: { pattern: 'coreAE', muscles: ['back', 'glutes'], difficulty: 1, load: { back: 1, neck: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  birdDog: { pattern: 'coreAE', muscles: ['back', 'core', 'glutes'], difficulty: 1, load: { wrist: 1, knee: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  donkeyKick: { pattern: 'hinge', muscles: ['glutes'], difficulty: 1, load: { wrist: 1, knee: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: true, tempoS: 3 },
  wallPushUp: { pattern: 'pushH', muscles: ['chest', 'triceps', 'shoulders'], difficulty: 1, load: { wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'inclinePushUp' },
  inclinePushUp: { pattern: 'pushH', muscles: ['chest', 'triceps', 'shoulders'], difficulty: 2, load: { wrist: 2, shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'kneePushUp' },
  kneePushUp: { pattern: 'pushH', muscles: ['chest', 'triceps', 'shoulders'], difficulty: 2, load: { wrist: 2, shoulder: 1, knee: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'pushUp' },
  declinePushUp: { pattern: 'pushH', muscles: ['chest', 'shoulders', 'triceps'], difficulty: 4, load: { wrist: 2, shoulder: 2 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'diamondPushUp' },
  widePushUp: { pattern: 'pushH', muscles: ['chest', 'shoulders'], difficulty: 3, load: { wrist: 2, shoulder: 2 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  diamondPushUp: { pattern: 'pushH', muscles: ['triceps', 'chest'], difficulty: 4, load: { wrist: 2, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  pikePushUp: { pattern: 'pushV', muscles: ['shoulders', 'triceps'], difficulty: 4, load: { wrist: 2, shoulder: 2, neck: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  tricepsDip: { pattern: 'pushV', muscles: ['triceps', 'shoulders'], difficulty: 3, load: { shoulder: 2, wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  plankShoulderTap: { pattern: 'coreAE', muscles: ['core', 'shoulders'], difficulty: 3, load: { wrist: 2, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  plank: { pattern: 'coreAE', muscles: ['core'], difficulty: 2, load: { shoulder: 1, back: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1, harder: 'highPlank' },
  highPlank: { pattern: 'coreAE', muscles: ['core', 'shoulders'], difficulty: 2, load: { wrist: 2, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1, harder: 'plankShoulderTap' },
  sidePlank: { pattern: 'coreAE', muscles: ['core'], difficulty: 3, load: { shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: true, tempoS: 1 },
  crunch: { pattern: 'coreFlex', muscles: ['core'], difficulty: 1, load: { neck: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  sitUp: { pattern: 'coreFlex', muscles: ['core'], difficulty: 2, load: { neck: 1, back: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  bicycleCrunch: { pattern: 'coreFlex', muscles: ['core'], difficulty: 2, load: { neck: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: true, tempoS: 1.5 },
  legRaise: { pattern: 'coreFlex', muscles: ['core'], difficulty: 3, load: { back: 2 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  flutterKicks: { pattern: 'coreFlex', muscles: ['core'], difficulty: 2, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  deadBug: { pattern: 'coreAE', muscles: ['core'], difficulty: 1, load: {  }, impact: false, floor: true, balance: false, unit: 'reps', perSide: true, tempoS: 3 },
  hollowHold: { pattern: 'coreAE', muscles: ['core'], difficulty: 3, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  mountainClimber: { pattern: 'cardio', muscles: ['core', 'shoulders', 'quads'], difficulty: 3, load: { wrist: 2, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: true, tempoS: 0.7 },
  russianTwist: { pattern: 'coreFlex', muscles: ['core'], difficulty: 2, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 1.5 },
  vUp: { pattern: 'coreFlex', muscles: ['core'], difficulty: 4, load: { back: 1, neck: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  reverseCrunch: { pattern: 'coreFlex', muscles: ['core'], difficulty: 2, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  toeTouch: { pattern: 'coreFlex', muscles: ['core'], difficulty: 2, load: { neck: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  bearHold: { pattern: 'coreAE', muscles: ['core', 'shoulders', 'quads'], difficulty: 2, load: { wrist: 2, knee: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  gobletSquat: { pattern: 'squat', muscles: ['quads', 'glutes'], difficulty: 3, load: { knee: 1, back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'dbFrontSquat' },
  dbFrontSquat: { pattern: 'squat', muscles: ['quads', 'glutes'], difficulty: 3, load: { knee: 1, back: 1, wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  dbSumoSquat: { pattern: 'squat', muscles: ['quads', 'glutes'], difficulty: 2, load: { knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  romanianDeadlift: { pattern: 'hinge', muscles: ['hamstrings', 'glutes', 'back'], difficulty: 3, load: { back: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3, harder: 'singleLegRdl' },
  singleLegRdl: { pattern: 'hinge', muscles: ['hamstrings', 'glutes'], difficulty: 4, load: { back: 1 }, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 4 },
  dbDeadlift: { pattern: 'hinge', muscles: ['hamstrings', 'glutes', 'back', 'quads'], difficulty: 3, load: { back: 2, knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  dbLunge: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 3, load: { knee: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 3, harder: 'dbBulgarian' },
  dbBulgarian: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 4, load: { knee: 2 }, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 4 },
  dbStepUp: { pattern: 'lunge', muscles: ['quads', 'glutes'], difficulty: 3, load: { knee: 1 }, impact: false, floor: false, balance: true, unit: 'reps', perSide: true, tempoS: 3 },
  dbHipThrust: { pattern: 'hinge', muscles: ['glutes', 'hamstrings'], difficulty: 3, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  dbCalfRaise: { pattern: 'calf', muscles: ['calves'], difficulty: 2, load: {  }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 2 },
  dbSwing: { pattern: 'hinge', muscles: ['glutes', 'hamstrings', 'back'], difficulty: 3, load: { back: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 1.5 },
  thruster: { pattern: 'squat', muscles: ['quads', 'glutes', 'shoulders'], difficulty: 4, load: { knee: 1, back: 1, shoulder: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  arnoldPress: { pattern: 'pushV', muscles: ['shoulders', 'triceps'], difficulty: 3, load: { shoulder: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  pushPress: { pattern: 'pushV', muscles: ['shoulders', 'triceps', 'quads'], difficulty: 3, load: { shoulder: 2, back: 1, knee: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  lateralRaise: { pattern: 'pushV', muscles: ['shoulders'], difficulty: 1, load: { shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  frontRaise: { pattern: 'pushV', muscles: ['shoulders'], difficulty: 1, load: { shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  rearDeltFly: { pattern: 'pull', muscles: ['shoulders', 'back'], difficulty: 1, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  uprightRow: { pattern: 'pull', muscles: ['shoulders', 'back'], difficulty: 2, load: { shoulder: 2 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  shrug: { pattern: 'pull', muscles: ['back'], difficulty: 1, load: { neck: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 2 },
  bicepsCurl: { pattern: 'pull', muscles: ['back'], difficulty: 1, load: { wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 2.5 },
  hammerCurl: { pattern: 'pull', muscles: ['back'], difficulty: 1, load: { wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 2.5 },
  concentrationCurl: { pattern: 'pull', muscles: ['back'], difficulty: 1, load: { wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 2.5 },
  zottmanCurl: { pattern: 'pull', muscles: ['back'], difficulty: 2, load: { wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  overheadTricepsExt: { pattern: 'pushV', muscles: ['triceps'], difficulty: 2, load: { shoulder: 1, wrist: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  tricepsKickback: { pattern: 'pushH', muscles: ['triceps'], difficulty: 1, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  skullCrusher: { pattern: 'pushH', muscles: ['triceps'], difficulty: 2, load: { wrist: 1, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  closeGripFloorPress: { pattern: 'pushH', muscles: ['triceps', 'chest'], difficulty: 2, load: { wrist: 1, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  floorPress: { pattern: 'pushH', muscles: ['chest', 'triceps'], difficulty: 2, load: { wrist: 1, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  pullover: { pattern: 'pull', muscles: ['back', 'chest'], difficulty: 2, load: { shoulder: 2 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  bentOverRow: { pattern: 'pull', muscles: ['back', 'shoulders'], difficulty: 3, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  oneArmRow: { pattern: 'pull', muscles: ['back', 'shoulders'], difficulty: 2, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 3 },
  renegadeRow: { pattern: 'pull', muscles: ['back', 'core', 'shoulders'], difficulty: 4, load: { wrist: 2, back: 1, shoulder: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 3 },
  hamstringStretch: { pattern: 'mobility', muscles: ['hamstrings'], difficulty: 1, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  hipFlexorStretch: { pattern: 'mobility', muscles: ['quads', 'glutes'], difficulty: 1, load: { knee: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: true, tempoS: 1 },
  catCow: { pattern: 'mobility', muscles: ['back', 'core'], difficulty: 1, load: { wrist: 1, knee: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  childsPose: { pattern: 'mobility', muscles: ['back'], difficulty: 1, load: { knee: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  chestStretch: { pattern: 'mobility', muscles: ['chest', 'shoulders'], difficulty: 1, load: { shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  quadStretch: { pattern: 'mobility', muscles: ['quads'], difficulty: 1, load: { knee: 1 }, impact: false, floor: false, balance: true, unit: 'seconds', perSide: true, tempoS: 1 },
  shoulderStretch: { pattern: 'mobility', muscles: ['shoulders'], difficulty: 1, load: { shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'seconds', perSide: true, tempoS: 1 },
  neckStretch: { pattern: 'mobility', muscles: ['back'], difficulty: 1, load: { neck: 1 }, impact: false, floor: false, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  butterflyStretch: { pattern: 'mobility', muscles: ['glutes'], difficulty: 1, load: { knee: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: false, tempoS: 1 },
  figureFour: { pattern: 'mobility', muscles: ['glutes'], difficulty: 1, load: { knee: 1 }, impact: false, floor: true, balance: false, unit: 'seconds', perSide: true, tempoS: 1 },
  dbRussianTwist: { pattern: 'coreFlex', muscles: ['core'], difficulty: 3, load: { back: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 1.5 },
  dbSideBend: { pattern: 'coreFlex', muscles: ['core'], difficulty: 2, load: { back: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 2 },
  manMaker: { pattern: 'cardio', muscles: ['chest', 'shoulders', 'quads', 'core'], difficulty: 5, load: { wrist: 2, back: 1, shoulder: 1, knee: 1 }, impact: false, floor: true, balance: false, unit: 'reps', perSide: false, tempoS: 6 },
  dbSnatch: { pattern: 'hinge', muscles: ['glutes', 'shoulders', 'back'], difficulty: 4, load: { back: 1, shoulder: 1 }, impact: false, floor: false, balance: false, unit: 'reps', perSide: true, tempoS: 2 },
};

const PATTERN_OF_GROUP: Record<string, Pattern> = { squat: 'squat', lunge: 'lunge', cardio: 'cardio', standing: 'mobility', floor: 'coreAE', dumbbell: 'pushV', stretch: 'mobility' };

/** A cautious guess from the form coach's own definition for a move not written above yet (no load known: never avoided). */
function derive(id: FormMoveId): MoveMeta {
  const d = FORM_MOVES[id];
  return { pattern: PATTERN_OF_GROUP[d.group] ?? 'mobility', muscles: [], difficulty: 2, load: {}, impact: false, floor: !!d.lying, balance: false, unit: d.hold ? 'seconds' : 'reps', perSide: !!d.sideProgress, tempoS: d.hold ? 1 : 3 };
}

export const MOVE_META: Readonly<Record<FormMoveId, MoveMeta>> = Object.fromEntries(FORM_MOVE_IDS.map((id) => [id, EXPLICIT[id] ?? derive(id)])) as Record<FormMoveId, MoveMeta>;
/** Moves whose program data is only guessed (to be written by hand): the test names them. */
export const DERIVED_META: readonly FormMoveId[] = FORM_MOVE_IDS.filter((id) => !EXPLICIT[id]);

/** The easier neighbour of a move in its chain (the reverse of `harder`). */
export function easierOf(id: FormMoveId): FormMoveId | null {
  for (const [k, m] of Object.entries(MOVE_META) as [FormMoveId, MoveMeta][]) if (m.harder === id) return k;
  return null;
}
