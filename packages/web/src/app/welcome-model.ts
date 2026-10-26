// The welcome tour as plain data and rules: which step comes next, what each choice does to the others, what is kept in the
// settings when the tour moves on, who is taken to the tour on their first visit, and when the 3D stage gives way to a
// pre-rendered picture. Steps 1 to 5 are pages of the tour; the sixth (the calibration) and the seventh (the first game) are the
// real play page of Squat Flap, so what the player is shown there is the real thing, not a drawing of it.
import type { BodyRegion } from '../../../core/types/index.ts';
import type { Level, Settings, SetupDevice } from '../../../core/ui/settings.ts';
import { REGION_IDS } from '../../../core/ui/settings.ts';

/** Steps shown as "Step n of 7": five pages, then the calibration and the first game on the play page. */
export const TOUR_STEPS = 7;
export const TOUR_PAGES = 5;
export type TourStep = 1 | 2 | 3 | 4 | 5;
/** The camera's place: a phone upright or sideways, a laptop, or (two players only) the top of a TV. */
export type TourDevice = SetupDevice | 'tv';

export interface TourState {
  step: TourStep;
  regions: readonly BodyRegion[];
  level: Level;
  seated: boolean;
  quiet: boolean;
  device: TourDevice;
  players: 1 | 2;
}

/** The regions the tour offers: the seated one is a mode of its own (the switch), not a goal. */
export const TOUR_REGIONS: readonly BodyRegion[] = REGION_IDS.filter((r) => r !== 'seated');
export const LEVELS: readonly Level[] = ['gentle', 'steady', 'strong'];

/** What a first visit starts with when nothing was chosen yet: legs (the first game works them) and cardio. */
export const DEFAULT_REGIONS: readonly BodyRegion[] = ['legs', 'cardio'];

/** The step an address asks for; anything else is the first step. */
export function stepFrom(raw: string | null | undefined): TourStep {
  const n = Number.parseInt(raw ?? '', 10);
  return n >= 1 && n <= TOUR_PAGES ? (n as TourStep) : 1;
}

/** The camera places on offer: two players share one camera at a laptop or a TV, one player can use any. */
export function deviceChoices(players: 1 | 2): readonly TourDevice[] {
  return players === 2 ? ['laptop', 'tv'] : ['phone', 'phoneLand', 'laptop'];
}

const sanitizeDevice = (device: TourDevice, players: 1 | 2): TourDevice => (deviceChoices(players).includes(device) ? device : 'laptop');

/** The tour starts from what the settings hold (a player who comes back to change them sees them). Two players only on a big screen. */
export function initialTour(s: Pick<Settings, 'regions' | 'level' | 'seated' | 'quiet' | 'device'>, o: { step?: TourStep; bigScreen: boolean }): TourState {
  const regions = s.regions.filter((r) => TOUR_REGIONS.includes(r));
  return {
    step: o.step ?? 1,
    regions: regions.length > 0 ? regions : DEFAULT_REGIONS,
    level: s.level,
    seated: s.seated,
    quiet: s.quiet,
    device: s.device,
    players: 1,
  };
}

/** One or two players. Two share a laptop or a TV; a small screen never offers it. */
export function withPlayers(s: TourState, players: 1 | 2, bigScreen: boolean): TourState {
  const n = players === 2 && bigScreen ? 2 : 1;
  return { ...s, players: n, device: sanitizeDevice(s.device, n) };
}

export function withDevice(s: TourState, device: TourDevice): TourState {
  return deviceChoices(s.players).includes(device) ? { ...s, device } : s;
}

export function withLevel(s: TourState, level: string): TourState {
  return (LEVELS as readonly string[]).includes(level) ? { ...s, level: level as Level } : s;
}

/** A region on or off. The tour keeps the order of the regions as the app lists them. */
export function toggleRegion(s: TourState, region: string): TourState {
  if (!(TOUR_REGIONS as readonly string[]).includes(region)) return s;
  const on = s.regions.includes(region as BodyRegion);
  const next = TOUR_REGIONS.filter((r) => (r === region ? !on : s.regions.includes(r)));
  return { ...s, regions: next };
}

export const nextStep = (step: TourStep): TourStep | 'play' => (step >= TOUR_PAGES ? 'play' : ((step + 1) as TourStep));
export const backStep = (step: TourStep): TourStep => (step <= 1 ? 1 : ((step - 1) as TourStep));

// ---- the first game ----------------------------------------------------------------------------------------------------------

/** The game of the tour: free, with a seated way to play, and short enough to be a first win. */
export const FIRST_GAME_ID = 'squat-flap';
/** The round of the first game, in seconds: one set, no rest, nothing to beat yet. */
export const FIRST_SECONDS = 30;

/** The difficulty of the first game for a level: the free ones only (the hard ones are part of Pro). */
export const firstDifficulty = (level: Level): 'easy' | 'normal' => (level === 'gentle' ? 'easy' : 'normal');

/** What the tour keeps in the settings. The TV is a laptop to the rest of the app (a place to stand back from, not a setting). */
export function settingsPatch(s: TourState): Pick<Settings, 'regions' | 'level' | 'seated' | 'quiet' | 'device'> {
  return { regions: [...s.regions], level: s.level, seated: s.seated, quiet: s.quiet, device: s.device === 'tv' ? 'laptop' : s.device };
}

// ---- who is taken to the tour ----------------------------------------------------------------------------------------------

export interface FirstVisit {
  /** The settings say the tour was seen or skipped. */
  onboardingDone: boolean;
  /** Rounds played on this device (a player who comes back with a record needs no tour). */
  rounds: number;
  /** The visitor is a script or a crawler (a robot never gets a page that is not the one a search engine lists). */
  automated: boolean;
  /** Only the home page takes a first visitor to the tour; a game page opened from a search goes where it was asked to. */
  atHome: boolean;
  /** A page that is part of the tour or of a round is never replaced. */
  initial: boolean;
}

export function takeToTour(v: FirstVisit): boolean {
  return v.initial && v.atHome && !v.onboardingDone && v.rounds === 0 && !v.automated;
}

/** The user agent of a search engine, a preview fetcher or a speed test: none of them is taken to the tour. */
export const ROBOT_AGENT = /bot|crawl|spider|slurp|lighthouse|headless|prerender|facebookexternalhit|embedly|preview/i;

export function isAutomated(nav: { userAgent?: string; webdriver?: boolean }): boolean {
  return nav.webdriver === true || ROBOT_AGENT.test(nav.userAgent ?? '');
}

// ---- the 3D stage and the weak phone ---------------------------------------------------------------------------------------

/** A tier of the stage: 0 is the lightest. A device that says it is weak starts at 0, any other at 1. */
export type StageTier = 0 | 1 | 2;

export function startTier(d: { cores?: number; memoryGb?: number }): StageTier {
  const weak = (d.cores ?? 8) <= 4 || (d.memoryGb ?? 8) <= 3;
  return weak ? 0 : 1;
}

export interface FrameStats { frames: number; p95: number; tier: number }

/**
 * After 90 frames the stage looks at its own frame cost: a tier above the lightest is lowered when the slowest frames take over
 * 20 ms, and when the lightest tier is still over 33 ms the stage gives way to the pre-rendered picture (the same scene, drawn
 * ahead of time). 'wait' until there are enough frames to judge.
 */
export function judgeStage(s: FrameStats): 'wait' | 'keep' | 'lower' | 'fallback' {
  if (s.frames < 90) return 'wait';
  if (s.tier > 0 && s.p95 > 20) return 'lower';
  if (s.tier === 0 && s.p95 > 33) return 'fallback';
  return 'keep';
}
