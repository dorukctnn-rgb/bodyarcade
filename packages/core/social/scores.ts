// Weekly boards: which week a score belongs to, which games have a board, and how fast a score can honestly grow.
//
// What the server checks (and what it cannot): a score comes from a signed profile, from a run the server saw start (a
// ticket it signed) and finish, and it may not exceed what the game could award in the time the run took. That stops a score
// typed into the address bar and a run finished in two seconds; it does not stop a player who waits out the time and
// reports the ceiling, because the server does not replay the game. So the boards carry no prizes, any player can be
// reported (moderators hide a profile from the country boards), and a board only ever lists real profiles: nobody is added to
// make a board look busy.
import { DAY, MINUTE } from './rules.ts';

export const WEEK_MS = 7 * DAY;
/** Weeks are counted from Monday 5 January 1970 (UTC): a new week starts at 00:00 UTC on Monday. */
const FIRST_MONDAY = Date.UTC(1970, 0, 5);

export interface Week { id: number; start: number; end: number }

export const weekOf = (ms: number): number => Math.floor((ms - FIRST_MONDAY) / WEEK_MS);
export function weekRange(id: number): Week {
  return { id, start: FIRST_MONDAY + id * WEEK_MS, end: FIRST_MONDAY + (id + 1) * WEEK_MS };
}
/** The current week and the one before it are kept; older rows are swept. */
export const KEEP_WEEKS = 2;

/**
 * The games with a board: the length of a run (the manifest's durationSec, kept equal by a test) and the most points a
 * second the game can award at its best (a ceiling with a wide margin, not a typical score).
 */
export const BOARD_GAMES = {
  'squat-flap': { seconds: 270, ratePerSecond: 300 },
  'knee-sprint': { seconds: 180, ratePerSecond: 300 },
  'firework-jacks': { seconds: 240, ratePerSecond: 300 },
  'twist-turbine': { seconds: 180, ratePerSecond: 300 },
  'star-catch': { seconds: 196, ratePerSecond: 300 },
  'pad-work': { seconds: 420, ratePerSecond: 800 },
  'reaction-tag': { seconds: 155, ratePerSecond: 600 },
  'limbo-bend': { seconds: 180, ratePerSecond: 300 },
  'pose-wall': { seconds: 210, ratePerSecond: 300 },
  'road-run': { seconds: 90, ratePerSecond: 300 },
} as const satisfies Record<string, { seconds: number; ratePerSecond: number }>;

export type BoardGame = keyof typeof BOARD_GAMES;
export const isBoardGame = (x: unknown): x is BoardGame => typeof x === 'string' && Object.hasOwn(BOARD_GAMES, x);

export const SCORES = {
  /** Beyond any game: a number that cannot be a score. */
  maxScore: 5_000_000,
  /** A run the server saw last shorter than this counts for nothing. */
  minRunMs: 3_000,
  /** Points that may be on the board at the very start (the first beat can already score). */
  slack: 300,
  /** A ticket is good for three times the game's length, at least this long (a call, a pause, a restart). */
  minWindowMs: 15 * MINUTE,
  /** A best may be beaten this many times per game and week (each time writes two rows); the count lives in the row itself. */
  improvementsPerWeek: 30,
  /** Runs a player may start a minute (answered from memory, nothing is written). */
  startsPerMinute: 20,
  /** Rows a board shows, and how far a player's own rank is counted before it says "at least". */
  boardSize: 50,
  rankCap: 100,
  /** Rows read to fill a country board after the blocked and the suspended are left out. */
  boardFetch: 80,
  /** A friends board reads every friend (at most 100) and the player. */
  friendsFetch: 101,
} as const;

export const runWindowMs = (game: BoardGame): number => Math.max(SCORES.minWindowMs, 3 * BOARD_GAMES[game].seconds * 1000);

/** The most a run that took `elapsedMs` can honestly score: the time counts up to the length of the game (and a little more). */
export function ceilingFor(game: BoardGame, elapsedMs: number): number {
  const playedMs = Math.min(Math.max(0, elapsedMs), (BOARD_GAMES[game].seconds + 30) * 1000);
  return Math.min(SCORES.maxScore, Math.floor((BOARD_GAMES[game].ratePerSecond * playedMs) / 1000) + SCORES.slack);
}

export type RunVerdict = 'ok' | 'too_short' | 'expired' | 'implausible' | 'bad_score';

/** Whether a finished run may be written, from what the server itself measured. */
export function judgeRun(game: BoardGame, elapsedMs: number, score: unknown): RunVerdict {
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > SCORES.maxScore) return 'bad_score';
  if (elapsedMs < 0 || elapsedMs > runWindowMs(game)) return 'expired';
  if (elapsedMs < SCORES.minRunMs) return 'too_short';
  if (score > ceilingFor(game, elapsedMs)) return 'implausible';
  return 'ok';
}

/** Country codes: two capital letters, and not the codes Cloudflare uses for "unknown" (XX) or Tor (T1). */
export function cleanCountry(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const c = x.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'ZZ' ? c : null;
}

/** Orders two entries of a board: the higher score first, and the one that got there first when they are equal. */
export const beats = (a: { score: number; at: number }, b: { score: number; at: number }): boolean => a.score > b.score || (a.score === b.score && a.at < b.at);
