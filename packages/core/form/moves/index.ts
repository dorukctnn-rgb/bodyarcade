// The form coach's moves (Faz 1: four of the catalogue in SPEC.md section 5).
import type { FormMoveId, MoveDef } from '../types.ts';
import { dbShoulderPress } from './dbShoulderPress.ts';
import { gluteBridge } from './gluteBridge.ts';
import { pushUp } from './pushUp.ts';
import { squat } from './squat.ts';

export const FORM_MOVES: Readonly<Record<FormMoveId, MoveDef>> = { squat, pushUp, gluteBridge, dbShoulderPress };
export const FORM_MOVE_IDS = Object.keys(FORM_MOVES) as FormMoveId[];
export const isFormMove = (v: unknown): v is FormMoveId => typeof v === 'string' && (FORM_MOVE_IDS as string[]).includes(v);

/**
 * Whether a move has been measured on real people (SPEC.md section 12). A move without real-video evidence is not offered as
 * "form + count" outside the developer page.
 */
export const REAL_VIDEO_CHECKED: Readonly<Record<FormMoveId, boolean>> = { squat: true, pushUp: true, gluteBridge: false, dbShoulderPress: true };
