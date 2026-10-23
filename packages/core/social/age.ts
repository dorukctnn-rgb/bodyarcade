// The age gate and what each age band may do (BUILD-PLAN "Friends, lobbies, playing online together", tech.md 5,
// game-design 2.9 and 3.x). The band is self-declared once, at first social use, with a neutral question; this module is
// the single place where the consequences are written down, and the Worker, the Room and the interface all ask it.
//
//   child (under 13): preset names, preset messages, friends and private rooms only by code or link, no public
//                     lobby, no quick match, no video.
//   teen (13-17):     preset names, preset messages, no video; public lobbies and quick match, but only among teens.
//   adult (18+):      filtered free names; free text and video only in private rooms where every member is an adult.
//
// Nobody can look players up: the only ways to meet are a friend code, an invite link or a public lobby, so there is
// no search box and no "people you may know" list.
import type { AgeBand, LobbyGroup } from './types.ts';

export interface BandPolicy {
  /** The display name must come from the preset list (core/social/presets.ts). */
  presetNameOnly: boolean;
  /** May type free text, but only in a private room where every member is an adult. */
  freeText: boolean;
  /** May use live camera video, but only in a private room where every member is an adult and both opt in. */
  video: boolean;
  /** May open and join public lobbies and use quick match. */
  publicPlay: boolean;
  lobbyGroup: LobbyGroup | null;
  maxFriends: number;
  maxIncomingRequests: number;
  maxOutgoingRequests: number;
  requestsPerDay: number;
}

export const POLICY: Readonly<Record<AgeBand, BandPolicy>> = {
  child: { presetNameOnly: true, freeText: false, video: false, publicPlay: false, lobbyGroup: null, maxFriends: 25, maxIncomingRequests: 15, maxOutgoingRequests: 10, requestsPerDay: 10 },
  teen: { presetNameOnly: true, freeText: false, video: false, publicPlay: true, lobbyGroup: 'teen', maxFriends: 50, maxIncomingRequests: 25, maxOutgoingRequests: 15, requestsPerDay: 15 },
  adult: { presetNameOnly: false, freeText: true, video: true, publicPlay: true, lobbyGroup: 'adult', maxFriends: 100, maxIncomingRequests: 40, maxOutgoingRequests: 25, requestsPerDay: 25 },
};

const RANK: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };

export const isAgeBand = (x: unknown): x is AgeBand => x === 'child' || x === 'teen' || x === 'adult';
export const isMinor = (band: AgeBand): boolean => band !== 'adult';
export const policyFor = (band: AgeBand): BandPolicy => POLICY[band];
export const lobbyGroupOf = (band: AgeBand): LobbyGroup | null => POLICY[band].lobbyGroup;

/**
 * May `from` send a friend request to `to`? An adult cannot send one to an under-18 player: the young player sends it
 * (with the adult's code or link), so an adult cannot reach a minor who did not choose to be reached. The server drops
 * the forbidden request silently, so a probe learns nothing about the other player's band.
 */
export const canSendFriendRequest = (from: AgeBand, to: AgeBand): boolean => !(from === 'adult' && isMinor(to));

/** Free text and video need a private room and an all-adult room. */
function adultsOnlyPrivate(bands: readonly AgeBand[], kind: 'private' | 'public'): boolean {
  return kind === 'private' && bands.length > 0 && bands.every((b) => b === 'adult');
}

/** What the room allows right now (the Room recomputes it whenever a member comes or goes). */
export const roomChatMode = (bands: readonly AgeBand[], kind: 'private' | 'public'): 'text' | 'preset' =>
  adultsOnlyPrivate(bands, kind) ? 'text' : 'preset';

/** Video may flow only in a private room of adults (and then only between two members who both switched it on). */
export const roomVideoAllowed = (bands: readonly AgeBand[], kind: 'private' | 'public'): boolean => adultsOnlyPrivate(bands, kind);

/** Do two public-lobby players belong to the same group? Children are in none. */
export function sameLobbyGroup(a: AgeBand, b: AgeBand): boolean {
  const ga = lobbyGroupOf(a);
  return ga !== null && ga === lobbyGroupOf(b);
}

/**
 * The band a player may switch to. Only downwards: someone who declared adult and is not can step down at any time,
 * but nobody can raise their own band afterwards (a new profile starts over). Same band: allowed, nothing changes.
 */
export const lowerBand = (current: AgeBand, requested: AgeBand): AgeBand | null => (RANK[requested] <= RANK[current] ? requested : null);
