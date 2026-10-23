// Level bands for public lobbies and quick match. The player level is claimed by the client (the server cannot see
// the game), so it only decides who is paired with whom, never anything a cheater could gain by lying: a player who
// claims a higher level meets stronger opponents.
import { LEVEL_BANDS, type LevelBand } from './types.ts';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 99;

/** Levels 1-9 easy, 10-24 medium, 25 and up hard. */
export const BAND_STARTS: Record<LevelBand, number> = { easy: 1, medium: 10, hard: 25 };

export const clampLevel = (level: unknown): number => {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.trunc(level) : MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n));
};

export function levelBand(level: unknown): LevelBand {
  const n = clampLevel(level);
  if (n >= BAND_STARTS.hard) return 'hard';
  if (n >= BAND_STARTS.medium) return 'medium';
  return 'easy';
}

export const isLevelBand = (x: unknown): x is LevelBand => typeof x === 'string' && (LEVEL_BANDS as readonly string[]).includes(x);

/** 0 for the same band, 1 for neighbours, 2 for easy against hard. */
export const bandDistance = (a: LevelBand, b: LevelBand): number => Math.abs(LEVEL_BANDS.indexOf(a) - LEVEL_BANDS.indexOf(b));

// The search widens while a player waits (tech.md 2.10: "widening the skill window over time").
export const WIDEN_ONE_AFTER_MS = 8_000;
export const WIDEN_ALL_AFTER_MS = 16_000;
/** After this long without an opponent the client offers a ghost race (tech.md 2.10, game-design 3.2). */
export const GHOST_OFFER_AFTER_MS = 20_000;

/** How many bands away an opponent may be after waiting `waitedMs`: 0, then 1, then 2 (anyone). */
export function searchWindow(waitedMs: number): 0 | 1 | 2 {
  if (!Number.isFinite(waitedMs) || waitedMs < WIDEN_ONE_AFTER_MS) return 0;
  return waitedMs < WIDEN_ALL_AFTER_MS ? 1 : 2;
}

/** May a player in `mine` be matched with a lobby of band `theirs` after waiting that long? A lobby without a band takes anyone. */
export function bandsFit(mine: LevelBand, theirs: LevelBand | null, waitedMs: number): boolean {
  return theirs === null || bandDistance(mine, theirs) <= searchWindow(waitedMs);
}
