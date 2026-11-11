// The form coach's moves (SPEC.md section 5): Faz 1's four and Faz 3's standing bodyweight moves.
import type { FormMoveId, MoveDef } from '../types.ts';
import { burpee, buttKicks, highKnees, inchworm, jumpRope, jumpingJack, marching, skater, squatThrust, starJump, stepJack } from './cardio.ts';
import { dbShoulderPress } from './dbShoulderPress.ts';
import {
  arnoldPress, bentOverRow, bicepsCurl, closeGripFloorPress, concentrationCurl, dbBulgarian, dbCalfRaise, dbDeadlift, dbHipThrust, dbLunge, dbSideBend, dbSnatch,
  dbStepUp, dbSumoSquat, dbSwing, dbFrontSquat, floorPress, frontRaise, gobletSquat, hammerCurl, lateralRaise, manMaker, oneArmRow, overheadTricepsExt, pullover,
  pushPress, rearDeltFly, renegadeRow, romanianDeadlift, shrug, singleLegRdl, skullCrusher, thruster, tricepsKickback, uprightRow, zottmanCurl,
} from './dumbbell.ts';
import {
  bearHold, bicycleCrunch, birdDog, crunch, deadBug, declinePushUp, diamondPushUp, donkeyKick, flutterKicks, highPlank, hipThrust, hollowHold, inclinePushUp,
  kneePushUp, legRaise, mountainClimber, pikePushUp, plank, plankShoulderTap, reverseCrunch, russianTwist, sidePlank, singleLegBridge, sitUp, superman,
  toeTouch, tricepsDip, vUp, wallPushUp, widePushUp,
} from './floor.ts';
import { gluteBridge } from './gluteBridge.ts';
import { bulgarianSplitSquat, cossackSquat, curtsyLunge, forwardLunge, jumpingLunge, lateralLunge, pistolSquat, reverseLunge, splitSquat } from './lunges.ts';
import { pushUp } from './pushUp.ts';
import { butterflyStretch, catCow, chestStretch, childsPose, figureFour, hamstringStretch, hipFlexorStretch, neckStretch, quadStretch, shoulderStretch } from './stretch.ts';
import { chairSquat, jumpSquat, prisonerSquat, squat, squatHold, sumoSquat, wallSit } from './squat.ts';
import { armCircles, calfRaise, goodMorning, singleCalfRaise, stepUp, wallAngel } from './standing.ts';

export const FORM_MOVES: Readonly<Record<FormMoveId, MoveDef>> = {
  squat, sumoSquat, prisonerSquat, chairSquat, jumpSquat, squatHold, wallSit, pistolSquat, cossackSquat,
  reverseLunge, forwardLunge, splitSquat, bulgarianSplitSquat, lateralLunge, curtsyLunge, jumpingLunge,
  jumpingJack, stepJack, starJump, highKnees, marching, buttKicks, burpee, squatThrust, inchworm, skater, jumpRope,
  calfRaise, singleCalfRaise, stepUp, wallAngel, armCircles, goodMorning,
  pushUp, gluteBridge, dbShoulderPress,
  // Faz 4: floor moves
  singleLegBridge, hipThrust, superman, birdDog, donkeyKick,
  kneePushUp, inclinePushUp, declinePushUp, wallPushUp, widePushUp, diamondPushUp, pikePushUp, tricepsDip, plankShoulderTap,
  plank, highPlank, sidePlank, crunch, sitUp, bicycleCrunch, legRaise, flutterKicks, deadBug, hollowHold,
  mountainClimber, russianTwist, vUp, reverseCrunch, toeTouch, bearHold,
  // Faz 5: dumbbell moves
  gobletSquat, dbFrontSquat, dbSumoSquat, romanianDeadlift, singleLegRdl, dbDeadlift, dbLunge, dbBulgarian, dbStepUp,
  dbHipThrust, dbCalfRaise, dbSwing, thruster,
  arnoldPress, pushPress, lateralRaise, frontRaise, rearDeltFly, uprightRow, shrug,
  bicepsCurl, hammerCurl, concentrationCurl, zottmanCurl, overheadTricepsExt, tricepsKickback, skullCrusher, closeGripFloorPress,
  floorPress, pullover, bentOverRow, oneArmRow, renegadeRow,
  // stretching: time only
  hamstringStretch, hipFlexorStretch, catCow, childsPose, chestStretch, quadStretch, shoulderStretch, neckStretch, butterflyStretch, figureFour,
  dbRussianTwist: { ...russianTwist, id: 'dbRussianTwist', group: 'dumbbell', equipment: ['dumbbell'] },
  dbSideBend, manMaker, dbSnatch,
};
export const FORM_MOVE_IDS = Object.keys(FORM_MOVES) as FormMoveId[];
export const isFormMove = (v: unknown): v is FormMoveId => typeof v === 'string' && (FORM_MOVE_IDS as string[]).includes(v);

/**
 * Whether a move has been measured on real people (SPEC.md section 12): its counting and every rule it offers ran on hand-
 * labelled clips of real people with no false alarm on good repetitions. A move without that evidence says so on its card
 * ("not measured on real video yet") and cannot ship as it is (SPEC 13: no partial launch). Updated by the measurements.
 */
export const REAL_VIDEO_CHECKED: Readonly<Record<FormMoveId, boolean>> = {
  squat: true, pushUp: true, gluteBridge: false, dbShoulderPress: true,
  sumoSquat: false, prisonerSquat: false, chairSquat: false, jumpSquat: false, squatHold: false, wallSit: false, pistolSquat: true, cossackSquat: true,
  reverseLunge: true, forwardLunge: true, splitSquat: false, bulgarianSplitSquat: false, lateralLunge: false, curtsyLunge: false, jumpingLunge: true,
  jumpingJack: true, stepJack: false, starJump: false, highKnees: false, marching: false, buttKicks: false, burpee: true, squatThrust: false,
  inchworm: false, skater: false, jumpRope: false, calfRaise: true, singleCalfRaise: false, stepUp: false, wallAngel: false, armCircles: false, goodMorning: false,
  // Faz 4 and 5: set to true only where a clip of a real person ran through the coach (tools/form-fixtures, SPEC 12)
  singleLegBridge: false, hipThrust: false, superman: false, birdDog: false, donkeyKick: false,
  kneePushUp: true, inclinePushUp: false, declinePushUp: false, wallPushUp: false, widePushUp: false, diamondPushUp: false, pikePushUp: false, tricepsDip: false, plankShoulderTap: false,
  plank: false, highPlank: false, sidePlank: false, crunch: false, sitUp: false, bicycleCrunch: false, legRaise: false, flutterKicks: false, deadBug: false, hollowHold: false,
  mountainClimber: false, russianTwist: false, vUp: false, reverseCrunch: false, toeTouch: false, bearHold: false,
  gobletSquat: true, dbFrontSquat: false, dbSumoSquat: false, romanianDeadlift: false, singleLegRdl: false, dbDeadlift: false, dbLunge: true, dbBulgarian: false, dbStepUp: false,
  dbHipThrust: false, dbCalfRaise: false, dbSwing: false, thruster: false,
  arnoldPress: false, pushPress: true, lateralRaise: false, frontRaise: false, rearDeltFly: false, uprightRow: false, shrug: false,
  bicepsCurl: false, hammerCurl: false, concentrationCurl: false, zottmanCurl: false, overheadTricepsExt: false, tricepsKickback: false, skullCrusher: false, closeGripFloorPress: false,
  floorPress: false, pullover: false, bentOverRow: false, oneArmRow: false, renegadeRow: false,
  dbRussianTwist: false, dbSideBend: false, manMaker: false, dbSnatch: false,
  hamstringStretch: false, hipFlexorStretch: false, catCow: false, childsPose: false, chestStretch: false, quadStretch: false, shoulderStretch: false, neckStretch: false, butterflyStretch: false, figureFour: false,
};
