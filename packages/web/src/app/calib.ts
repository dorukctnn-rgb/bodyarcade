// What the calibration screen says and offers, from the codes the platform reports. Pure functions and one small class,
// so every state can be checked without a browser. The words come from the string tables: this file only chooses keys.
import type { CalibrationCode, TwoPlayerCode, TwoPlayerGuidance } from '../../../core/types/index.ts';
import type { I18n, StringKey } from '../../../core/ui/i18n/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { CalibCheck, CalibPart, DeskCard, GaugePos, ScreenFraming } from '../views/play.ts';

/**
 * How the screen frames the player: the game's own framing, or the desk when the round is a seated one (head, shoulders
 * and arms are enough there; the legs are under the table).
 */
export function screenFraming(game: Pick<ShellGame, 'framing'>, seated: boolean): ScreenFraming {
  return seated ? 'desk' : game.framing;
}

/**
 * One plain sentence for every state the platform reports. A Record over the platform's own lists: a code added there
 * does not build until it has words here, and a key that is not in the English table does not build either.
 */
export const CALIB_MESSAGE: Readonly<Record<TwoPlayerCode, StringKey>> = {
  no_person: 'calib.msg.no_person',
  too_close: 'calib.msg.too_close',
  too_far: 'calib.msg.too_far',
  head_out: 'calib.msg.head_out',
  hips_out: 'calib.msg.hips_out',
  knees_out: 'calib.msg.knees_out',
  feet_out: 'calib.msg.feet_out',
  move_still: 'calib.msg.move_still',
  hold: 'calib.msg.hold',
  ok: 'calib.msg.ok',
  too_slow: 'calib.msg.too_slow',
  one_person: 'calib.msg.one_person',
  too_close_together: 'calib.msg.too_close_together',
  player_out: 'calib.msg.player_out',
};

/** What each way of guiding two players says; 'none' says nothing of its own. */
export const GUIDE_MESSAGE: Readonly<Record<TwoPlayerGuidance['action'], StringKey | null>> = {
  step_in: 'calib.guide.step_in',
  step_back: 'calib.guide.step_back',
  step_closer: 'calib.guide.step_closer',
  move_apart: 'calib.guide.move_apart',
  move_left: 'calib.guide.move_left',
  move_right: 'calib.guide.move_right',
  hold_still: 'calib.guide.hold_still',
  none: null,
};

/** At a desk "too close", "hips out" and the rest all mean the same thing to the person: sit back a little. */
const DESK_SIT_BACK: ReadonlySet<string> = new Set(['too_close', 'hips_out', 'knees_out', 'feet_out']);

/**
 * The sentence for a code. A code this build does not know (a newer platform than this shell) still gets a plain
 * instruction, never the code itself and never a blank.
 */
export function calibMessage(i18n: Pick<I18n, 'tx'>, code: string, framing: ScreenFraming): string {
  if (framing === 'desk' && DESK_SIT_BACK.has(code)) return i18n.tx('calib.msg.desk_back');
  const key = (CALIB_MESSAGE as Readonly<Record<string, StringKey | undefined>>)[code];
  return i18n.tx(key ?? 'calib.msg.generic');
}

/** The body parts a framing needs, in the order the screen lists them. */
export function partsFor(framing: ScreenFraming): CalibPart[] {
  switch (framing) {
    case 'full': return ['head', 'hips', 'knees', 'feet'];
    case 'upper': return ['head', 'hips'];
    case 'desk': return ['head', 'shoulders'];
    default: return ['head', 'hips', 'feet'];
  }
}

const MISSING: Readonly<Record<string, CalibPart | undefined>> = { head_out: 'head', hips_out: 'hips', knees_out: 'knees', feet_out: 'feet' };
const NOBODY: ReadonlySet<string> = new Set(['no_person', 'one_person', 'too_close', 'too_far', 'too_close_together', 'player_out']);
const LOWER: ReadonlySet<string> = new Set(['hips_out', 'knees_out', 'feet_out']);

/**
 * Which of those parts are in view, from the code. The platform looks from the head down and reports the first part that
 * is missing, so that part and every one after it are not checked off yet.
 */
export function checksFor(framing: ScreenFraming, code: string): CalibCheck[] {
  const parts = partsFor(framing);
  const nobody = NOBODY.has(code);
  // In the desk view the lower body is not asked for, so the codes about it say nothing about the parts that are.
  const missing = framing === 'desk' && LOWER.has(code) ? undefined : MISSING[code];
  const cut = missing === undefined ? parts.length : parts.indexOf(missing);
  return parts.map((part, i) => ({ part, ok: !nobody && (cut < 0 ? true : i < cut) }));
}

/**
 * The bands laid over the picture: the part that is out of view, named where it sits on the body. While nobody is in view
 * a standing game shows where the feet go, the one thing people forget.
 */
export function bandsFor(framing: ScreenFraming, code: string): CalibPart[] {
  const part = MISSING[code];
  if (part !== undefined && !(framing === 'desk' && LOWER.has(code))) return partsFor(framing).includes(part) ? [part] : [];
  if ((code === 'no_person' || code === 'too_close' || code === 'too_far') && (framing === 'full' || framing === 'side')) return ['feet'];
  return [];
}

/** Where the player stands against the camera, from the code: too close, in the good range, too far, or not known. */
export function gaugeFor(code: string): GaugePos {
  switch (code) {
    case 'too_close': case 'head_out': case 'hips_out': case 'knees_out': case 'feet_out': case 'too_close_together': return 'close';
    case 'too_far': return 'far';
    case 'hold': case 'ok': case 'move_still': return 'good';
    default: return 'none';
  }
}

/** How long a code has to last before the desk card shows (ms): hips alone out of view is what a desk looks like. */
export const DESK_DELAY: Readonly<Record<string, number>> = { hips_out: 700, knees_out: 2500, feet_out: 2500 };

/** How long the codes of a person in frame have to be gone before the card leaves. */
export const DESK_HOLD_MS = 600;

/** After this long without getting anywhere the way around the camera is put in front of the player (ms). */
export const STUCK_MS = 12_000;

/**
 * Decides when to offer the desk. Called with every calibration code and the time of it: the offer comes once the head and
 * shoulders have been in view without the lower body for a moment (a person walking into frame passes through the same
 * codes in a blink and must not see a card flash up), and goes when the person is clearly doing something else.
 */
export class DeskOffer {
  private since: number | null = null;
  private away: number | null = null;
  private on = false;

  push(code: string, now: number): boolean {
    const delay = DESK_DELAY[code];
    if (delay !== undefined) {
      this.away = null;
      this.since ??= now;
      if (now - this.since >= delay) this.on = true;
    } else {
      this.since = null;
      if (this.on) {
        this.away ??= now;
        if (now - this.away >= DESK_HOLD_MS) { this.on = false; this.away = null; }
      }
    }
    return this.on;
  }

  get offered(): boolean { return this.on; }

  reset(): void { this.since = null; this.away = null; this.on = false; }
}

export function deskCard(offered: boolean, game: Pick<ShellGame, 'seated'>, seated: boolean): DeskCard {
  if (!offered || seated) return 'none';
  return game.seated ? 'offer' : 'standing-only';
}
