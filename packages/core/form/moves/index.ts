// The form coach's moves (SPEC.md section 5): Faz 1's four and Faz 3's standing bodyweight moves.
import type { FormMoveId, MoveDef } from '../types.ts';
import { burpee, buttKicks, highKnees, inchworm, jumpRope, jumpingJack, marching, skater, squatThrust, starJump, stepJack } from './cardio.ts';
import { dbShoulderPress } from './dbShoulderPress.ts';
import { gluteBridge } from './gluteBridge.ts';
import { bulgarianSplitSquat, cossackSquat, curtsyLunge, forwardLunge, jumpingLunge, lateralLunge, pistolSquat, reverseLunge, splitSquat } from './lunges.ts';
import { pushUp } from './pushUp.ts';
import { chairSquat, jumpSquat, prisonerSquat, squat, squatHold, sumoSquat, wallSit } from './squat.ts';
import { armCircles, calfRaise, goodMorning, singleCalfRaise, stepUp, wallAngel } from './standing.ts';

export const FORM_MOVES: Readonly<Record<FormMoveId, MoveDef>> = {
  squat, sumoSquat, prisonerSquat, chairSquat, jumpSquat, squatHold, wallSit, pistolSquat, cossackSquat,
  reverseLunge, forwardLunge, splitSquat, bulgarianSplitSquat, lateralLunge, curtsyLunge, jumpingLunge,
  jumpingJack, stepJack, starJump, highKnees, marching, buttKicks, burpee, squatThrust, inchworm, skater, jumpRope,
  calfRaise, singleCalfRaise, stepUp, wallAngel, armCircles, goodMorning,
  pushUp, gluteBridge, dbShoulderPress,
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
  jumpingJack: true, stepJack: false, starJump: false, highKnees: false, marching: false, buttKicks: false, burpee: false, squatThrust: false,
  inchworm: false, skater: false, jumpRope: false, calfRaise: false, singleCalfRaise: false, stepUp: false, wallAngel: false, armCircles: false, goodMorning: false,
};
