// Duel links (sprint arm E): a private room for exactly two players that one of them opens from a game's page and sends to a friend
// as a link. Both play the same game at the same time with their own cameras; each sees the other's points and a figure made from
// the other's pose, never the other's camera picture (the room offers no video at all). A duel room closes by itself ten minutes
// after it was made, and it lets a guest in: someone who opened the link without a profile plays under a generated name.
//
// Two kinds of match share the Room's clock, pauses and result:
//   race   the games whose manifest has the 'duel' mode (core/net/schedule.ts): one course, one result per obstacle, the Room scores it.
//   score  every other game: the same seed and the same length for both; the page reports its running total and the Room keeps it
//          within what the game can give in that time (a token bucket per seat, below), so a page that lies gains nothing beyond it.
// This file is shared by the browser and the Worker: no DOM, no Workers types.
import { SCHEDULE_SPECS } from './schedule.ts';

/** Seats of a duel room. */
export const DUEL_SEATS = 2;
/** A duel room closes this long after it was made, whatever is going on in it. */
export const DUEL_LIFETIME_MS = 10 * 60_000;

/**
 * How fast a game's points may grow in a score duel: `perSec` points a second on average and a reserve of `burst` points for the
 * moments that pay out at once (a combo bonus, the end of a level). Each line is about twice the best a flawless player can make
 * by the game's own rules (worked out from its scoring constants, noted beside it), so a real player never meets the limit and a
 * page that sends a made-up total is held to it.
 */
export interface ScoreRate { perSec: number; burst: number }

export const SCORE_RATES: Readonly<Record<string, ScoreRate>> = {
  // 10 points x 2 (perfect) x 3 (streak) a jack, at most about two beats a second at the fastest tempo: about 125 a second
  'firework-jacks': { perSec: 250, burst: 400 },
  // (60 + 40) x 1.5 a gate, a gate every two seconds or more, plus 25 for the team: about 80 a second
  'limbo-bend': { perSec: 200, burst: 500 },
  // (100 + 20) x 4 a pad at the longest streak, about two pads a second, a bag 80 x 4, combos 50 a pad: about 1000 a second
  'pad-work': { perSec: 1500, burst: 2500 },
  // (60 + 60) x 1.5 a wall and 30 for a series, a wall every three seconds or more: about 70 a second
  'pose-wall': { perSec: 200, burst: 600 },
  // a metre is a point (20 metres a second at most), 100 to 200 an obstacle every 1.5 s, coins 25, 500 + 150 a heart at the end
  'road-run': { perSec: 400, burst: 1500 },
  // (10 + 5) x 5 a star at the longest streak, about three stars a second, a constellation 20 + 10 a star: about 250 a second
  'star-catch': { perSec: 450, burst: 800 },
  // 6 x 3 a metre at the longest streak (two metres a second at most), ledges 10, cruxes 25, the summit 40 + 2 a second left + 25
  'summit-climb': { perSec: 120, burst: 500 },
  // 10 x 1.5 a twist, about two a second, and 150 to 200 for a storm answered
  'twist-turbine': { perSec: 80, burst: 500 },
};

/** A game nobody listed (a practice id of the tests, a game that is not out yet) is held to this. */
export const DEFAULT_SCORE_RATE: ScoreRate = { perSec: 300, burst: 1000 };

export type DuelMode = 'race' | 'score';

/** How a duel of this game is played: a race where the game has a course for live play, else a score duel. */
export const duelModeOf = (gameId: string): DuelMode => (Object.hasOwn(SCHEDULE_SPECS, gameId) ? 'race' : 'score');

export const scoreRateOf = (gameId: string): ScoreRate => (Object.hasOwn(SCORE_RATES, gameId) ? SCORE_RATES[gameId] as ScoreRate : DEFAULT_SCORE_RATE);

/** One seat's points as the Room holds them in a score duel: what it accepted, the reserve left and the match time of the last report. */
export interface ScoreBucket { v: number; tokens: number; mt: number }

export const newBucket = (rate: ScoreRate): ScoreBucket => ({ v: 0, tokens: rate.burst, mt: 0 });

/** Largest total a page may ever report (a sanity bound, far above any game). */
export const MAX_DUEL_SCORE = 5_000_000;

/**
 * The points a seat has after it reported `claimed` at match time `mt` (the Room's own clock, never the page's). Pure: returns the
 * next bucket. The reserve fills at `perSec` and never holds more than `burst`; a rise takes from it and is cut where it runs out.
 * A total that goes down is believed (a game may take points away), and the reserve stays as it was.
 */
export function acceptScore(b: ScoreBucket, claimed: number, mt: number, rate: ScoreRate): ScoreBucket {
  const at = Math.max(b.mt, mt);
  const tokens = Math.min(rate.burst, b.tokens + (rate.perSec * (at - b.mt)) / 1000);
  const want = Math.max(0, Math.min(MAX_DUEL_SCORE, Math.floor(claimed)));
  if (want <= b.v) return { v: want, tokens, mt: at };
  const rise = Math.min(want - b.v, Math.floor(tokens));
  return { v: b.v + rise, tokens: tokens - rise, mt: at };
}

/** Whole seconds left before a duel room closes (0 once it has). */
export const secondsLeft = (closesAt: number, now: number): number => Math.max(0, Math.ceil((closesAt - now) / 1000));
