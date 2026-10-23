// Quick match: pairing by level through the public lobby directory (tech.md 2.10, game-design 3.2). Pure functions: the
// server loads the candidate lobbies (same age group, same game, not blocked, open seat) and asks what to do.
//
// Rules:
//   - A lobby fits when it is waiting for players (phase 'lobby'), has a free seat and its level band is within the
//     search window: the window starts at the same band and widens with the waiting time (levels.ts searchWindow).
//   - The player's own region counts first; other regions are considered only after REGION_WIDEN_AFTER_MS.
//   - Among fitting lobbies: same region, then nearest band, then the fuller one (it starts sooner), then the older one.
//   - Not hosting: join the best lobby, or create one (public, band of the player) and wait.
//   - Hosting an empty lobby: when an OLDER fitting lobby exists, leave and join it ("merge"). Two players who open a
//     lobby at the same moment each see the other's; the older (then the smaller code) keeps waiting and the other one
//     merges, so they always end up together.
import { GHOST_OFFER_AFTER_MS, bandDistance, bandsFit } from './levels.ts';
import type { LevelBand, Region } from './types.ts';

export const REGION_WIDEN_AFTER_MS = 12_000;
/** The client asks again this often while it waits. */
export const POLL_EVERY_MS = 4_000;
/** A search longer than this is treated as new (a stale id is not an excuse to match anybody with anybody). */
export const MAX_SEARCH_MS = 120_000;

export interface LobbyCandidate {
  code: string;
  game: string;
  region: Region;
  band: LevelBand | null;
  open: number;
  players: number;
  phase: 'lobby' | 'playing';
  createdAt: number;
}

export interface Seeker {
  game: string;
  band: LevelBand;
  region: Region;
  /** The public lobby the seeker opened and sits in, if any. */
  hosting: { code: string; players: number; createdAt: number } | null;
}

export type QuickDecision =
  | { action: 'join'; code: string }
  | { action: 'merge'; code: string }
  | { action: 'create'; band: LevelBand }
  | { action: 'wait'; offerGhost: boolean };

export function lobbyFits(c: LobbyCandidate, me: Seeker, waitedMs: number): boolean {
  if (c.phase !== 'lobby' || c.open < 1 || c.game !== me.game) return false;
  if (me.hosting && c.code === me.hosting.code) return false;
  if (!bandsFit(me.band, c.band, waitedMs)) return false;
  return c.region === me.region || waitedMs >= REGION_WIDEN_AFTER_MS;
}

/** Fitting lobbies, best first. */
export function rankLobbies(cands: readonly LobbyCandidate[], me: Seeker, waitedMs: number): LobbyCandidate[] {
  return cands
    .filter((c) => lobbyFits(c, me, waitedMs))
    .sort((a, b) =>
      Number(b.region === me.region) - Number(a.region === me.region)
      || bandDistance(me.band, a.band ?? me.band) - bandDistance(me.band, b.band ?? me.band)
      || b.players - a.players
      || a.createdAt - b.createdAt
      || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** Is lobby `a` older than lobby `b`? Ties go to the smaller code, so exactly one of two lobbies is older. */
export const isOlder = (a: { createdAt: number; code: string }, b: { createdAt: number; code: string }): boolean =>
  a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.code < b.code);

export function decideQuick(cands: readonly LobbyCandidate[], me: Seeker, waitedMs: number): QuickDecision {
  const ranked = rankLobbies(cands, me, waitedMs);
  const offerGhost = waitedMs >= GHOST_OFFER_AFTER_MS;
  if (!me.hosting) {
    const best = ranked[0];
    return best ? { action: 'join', code: best.code } : { action: 'create', band: me.band };
  }
  if (me.hosting.players <= 1) {
    const older = ranked.find((c) => isOlder(c, { createdAt: me.hosting?.createdAt ?? 0, code: me.hosting?.code ?? '' }));
    if (older) return { action: 'merge', code: older.code };
  }
  return { action: 'wait', offerGhost };
}

// ───────── search ids ─────────
// "s1.<start ms in base36>.<random>": the server stamps the start of a search so the window widens by its own clock. A
// client that forges an older start only meets stronger or farther players sooner, which hurts nobody else.

export function newSearchId(now: number, rand: string): string {
  return `s1.${Math.floor(now).toString(36)}.${rand.slice(0, 12)}`;
}

/** Start of the search in epoch ms, or null for an id that is not ours. */
export function searchStart(id: unknown): number | null {
  if (typeof id !== 'string' || id.length > 40) return null;
  const m = /^s1\.([0-9a-z]{6,10})\.([A-Za-z0-9_-]{4,12})$/.exec(id);
  if (!m) return null;
  const n = parseInt(m[1] ?? '', 36);
  return Number.isFinite(n) ? n : null;
}

/** How long the search has run, clamped to [0, MAX_SEARCH_MS]; a missing or foreign id starts a new search. */
export function waited(id: unknown, now: number): number {
  const s = searchStart(id);
  if (s === null) return 0;
  return Math.min(MAX_SEARCH_MS, Math.max(0, now - s));
}
