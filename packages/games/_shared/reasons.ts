// The sentence for a miss ("Bend further"). Every movement detector names its misses with a code (MissCode in
// core/moves/kit.ts); the shell has one sentence per code under `miss.<code>`. These are the English lines of the codes
// these games can give, as the fallback when the shell cannot be asked; the game tests keep them equal to the shell's. What the
// strip of the HUD says during play is the short cue of the same code (cues.ts); the full sentence is the shell's, for the
// results and for a code that has no cue yet.
import { cueText } from './cues.ts';
import type { Say } from './text.ts';

export const MISS_EN: Readonly<Record<string, string>> = {
  'miss.person_out': 'You were out of view',
  'miss.hands_out_of_view': 'Your hands were out of view',
  'miss.elbows_out_of_view': 'Your elbows were out of view',
  'miss.hips_out_of_view': 'Your hips were out of view',
  'miss.knees_out_of_view': 'Your knees were out of view',
  'miss.feet_out_of_view': 'Your feet were out of view',
  'miss.hips_not_low': 'Hips not low enough',
  'miss.feet_not_wide': 'Feet not wide enough',
  'miss.feet_not_together': 'Feet did not come together',
  'miss.arms_not_up': 'Arms not high enough',
  'miss.arms_not_down': 'Arms did not come down',
  'miss.use_both_arms': 'Use both arms',
  'miss.hands_apart': 'Hands too far apart',
  'miss.too_slow': 'Too slow',
  'miss.too_fast': 'Too fast',
  'miss.turn_more': 'Turn further',
  'miss.turn_shoulders': 'Turn from the shoulders',
  'miss.bend_more': 'Bend further',
  'miss.bend_less': 'Bend less',
  'miss.wrong_side': 'Wrong side',
  'miss.hips_shifted': 'Hips moved sideways',
  'miss.bending_forward': 'Leaning forward',
  'miss.limb_off': 'An arm or leg was off the shape',
  'miss.move_more': 'Move more',
  'miss.hold_still': 'Hold still',
  'miss.held_too_short': 'Hold it longer',
};

/** A miss as a game stores it: the code of the detector's explanation and what was reached against what was needed. */
export interface MissNote {
  code: string;
  got?: number;
  need?: number;
  side?: 'L' | 'R';
  limb?: string;
}

/** What the strip says for a miss code in the player's language: the game's cue, else the shell's sentence (the game's `say` must know MISS_EN and the cues as its fallback). */
export const reasonText = (say: Say, code: string): string => cueText(say, code);
