// Every reason code the movement library can give has a sentence in English and Turkish. The record below must list
// exactly the codes of MissCode: when the library adds a code, this file stops compiling until the strings exist.
import { describe, expect, it } from 'vitest';
import type { MissCode } from '../../moves/kit.ts';
import { copyProblems } from '../../../web/catalogue/copy.ts';
import { stringTables } from './index.ts';

const CODES = {
  person_out: true, head_out_of_view: true, hands_out_of_view: true, elbows_out_of_view: true, hips_out_of_view: true, knees_out_of_view: true, feet_out_of_view: true,
  hips_not_low: true, hips_not_up: true, knee_not_high: true, same_leg_twice: true, feet_not_wide: true, feet_not_together: true, foot_not_down: true,
  arms_not_up: true, arms_not_down: true, arms_not_out: true, use_both_arms: true, wrong_hand: true, hands_apart: true, elbows_bent: true,
  not_reached: true, too_slow: true, too_brief: true, grab_higher: true, pull_more: true, pull_faster: true,
  turn_more: true, turn_shoulders: true, bend_more: true, wrong_side: true, hips_shifted: true, bending_forward: true, body_not_straight: true,
  limb_off: true, move_more: true, hold_still: true, held_too_short: true,
} satisfies Record<MissCode, true>;

describe('reason sentences', () => {
  for (const lang of ['en', 'tr'] as const) {
    it(`${lang}: every code has a short sentence that follows the copy rules`, () => {
      const t = stringTables[lang];
      for (const code of Object.keys(CODES)) {
        const s = t[`miss.${code}`];
        expect(s, `${lang} miss.${code}`).toBeTruthy();
        // The strip during play holds at most 40 characters in English and 48 in translations (design/LAYOUT.md section 8).
        expect((s as string).length, `${lang} miss.${code}`).toBeLessThanOrEqual(lang === 'en' ? 40 : 48);
        expect(copyProblems(s as string), `${lang} miss.${code}`).toEqual([]);
      }
    });
  }
});
