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
 * does not build until it has words here, and a key that is not in the English table does not build either. The
 * states of the newer, profile-based calibration (cut at the side, dark room, light behind, a crowd) have their words
 * in advance: the second half of the type lets them stand in the table before the platform's list names them.
 */
export const CALIB_MESSAGE: Readonly<Record<TwoPlayerCode, StringKey>> & Readonly<Record<string, StringKey>> = {
  no_person: 'calib.msg.no_person',
  too_close: 'calib.msg.too_close',
  too_far: 'calib.msg.too_far',
  head_out: 'calib.msg.head_out',
  hips_out: 'calib.msg.hips_out',
  knees_out: 'calib.msg.knees_out',
  feet_out: 'calib.msg.feet_out',
  move_left: 'calib.msg.move_left',
  move_right: 'calib.msg.move_right',
  too_dark: 'calib.msg.too_dark',
  backlit: 'calib.msg.backlit',
  many_people: 'calib.msg.many_people',
  move_still: 'calib.msg.move_still',
  hold: 'calib.msg.hold',
  ok: 'calib.msg.ok',
  too_slow: 'calib.msg.too_slow',
  one_person: 'calib.msg.one_person',
  too_close_together: 'calib.msg.too_close_together',
  player_out: 'calib.msg.player_out',
};

/** What each way of guiding two players says; 'none' says nothing of its own. */
export const GUIDE_MESSAGE: Readonly<Record<TwoPlayerGuidance['action'], StringKey | null>> & Readonly<Record<string, StringKey | null>> = {
  step_in: 'calib.guide.step_in',
  step_back: 'calib.guide.step_back',
  step_closer: 'calib.guide.step_closer',
  move_apart: 'calib.guide.move_apart',
  move_left: 'calib.guide.move_left',
  move_right: 'calib.guide.move_right',
  hold_still: 'calib.guide.hold_still',
  more_light: 'calib.guide.more_light',
  light_in_front: 'calib.guide.light_in_front',
  none: null,
};

/** Stands in for a name while a sentence is tried: a sentence that holds it names somebody. */
const NAME_MARK = '\u{E000}';

/**
 * The words for what the guidance of two players asks. A sentence that names who it is for ("Player 2, step back.") has a twin
 * for the moment the platform names nobody ("Step back."), so a sentence never starts with a comma or a hole.
 */
export function guideMessage(i18n: Pick<I18n, 't' | 'tx' | 'has'>, g: TwoPlayerGuidance): string {
  const key = GUIDE_MESSAGE[g.action];
  if (!key) return '';
  const named = i18n.tx(key, { player: NAME_MARK });
  if (!named.includes(NAME_MARK)) return named;
  if (g.player) return named.replace(NAME_MARK, i18n.t(g.player === 1 ? 'hud.player1' : 'hud.player2'));
  const any = `${key}.any`;
  return i18n.has(any) ? i18n.tx(any) : i18n.t('calib.msg.generic');
}

/**
 * What a newer platform adds to the calibration status. Every field is optional and this shell works from the code alone
 * without them; with them the screen is exact about what is in view, says when a round plays at the desk by itself, and
 * puts the way around the camera forward when the platform asks.
 */
export interface CalibExtras {
  /** The parts of the body that are in view and inside the picture, as the platform measured them. */
  seen?: Partial<Record<CalibPart, boolean>>;
  /** What a finished calibration ended with: 'fallback' is the best that could be measured (the desk), not what the game wanted. */
  outcome?: 'measured' | 'fallback';
  /** The wait is long: another way to play is offered. */
  escape?: boolean;
}

export const extrasOf = (status: object): CalibExtras => status as CalibExtras;

/** The parts of two players' views that both of them show. */
export function bothSeen(a: Partial<Record<CalibPart, boolean>> | undefined, b: Partial<Record<CalibPart, boolean>> | undefined): Partial<Record<CalibPart, boolean>> | undefined {
  if (!a || !b) return undefined;
  const out: Partial<Record<CalibPart, boolean>> = {};
  for (const part of ['head', 'shoulders', 'hips', 'knees', 'feet'] as const) out[part] = a[part] === true && b[part] === true;
  return out;
}

/**
 * Games whose moves lift the hands above the head, so the camera needs room above the head as well as the body. The
 * manifest may say so itself (`headroom`); until every manifest does, the games known to need it are listed here.
 */
const HEADROOM_GAMES: ReadonlySet<string> = new Set(['summit-climb']);

export function needsHeadroom(game: Pick<ShellGame, 'id'>): boolean {
  const flag = (game as { headroom?: unknown }).headroom;
  return (flag !== undefined && flag !== false && flag !== null) || HEADROOM_GAMES.has(game.id);
}

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
const NOBODY: ReadonlySet<string> = new Set(['no_person', 'one_person', 'too_close', 'too_far', 'too_close_together', 'player_out', 'too_dark', 'backlit']);
const LOWER: ReadonlySet<string> = new Set(['hips_out', 'knees_out', 'feet_out']);
/** Codes about the device, the room or the crowd rather than about which parts of the body are in view: the ticks stay as they were. */
const KEEP: ReadonlySet<string> = new Set(['too_slow', 'move_left', 'move_right', 'many_people']);

export const keepsChecks = (code: string): boolean => KEEP.has(code);

/**
 * Which of those parts are in view, from the code. The platform looks from the head down and reports the first part that
 * is missing, so that part and every one after it are not checked off yet. When the platform says which parts it sees
 * (`seen`) that is what is shown.
 */
export function checksFor(framing: ScreenFraming, code: string, seen?: Partial<Record<CalibPart, boolean>>): CalibCheck[] {
  const parts = partsFor(framing);
  if (seen) return parts.map((part) => ({ part, ok: seen[part] === true }));
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
export function bandsFor(framing: ScreenFraming, code: string, seen?: Partial<Record<CalibPart, boolean>>): CalibPart[] {
  if (seen) {
    const parts = partsFor(framing);
    const some = parts.some((p) => seen[p] === true);
    const missing = parts.filter((p) => seen[p] !== true);
    // Part of the body is in view and part is not: each missing part is named where it sits. Nobody in view is handled below.
    if (some && missing.length > 0) return missing;
  }
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
