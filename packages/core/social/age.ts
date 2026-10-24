// The age gate and what each age band may do (BUILD-PLAN "Friends, lobbies, playing online together", tech.md 5,
// game-design 2.9 and 3.x). The band is self-declared once, at first social use, with a neutral question; this module is
// the single place where the consequences are written down, and the Worker, the Room and the interface all ask it.
//
//   child (under 16): NO ONLINE IDENTITY AT ALL (decided 24 Oct, first at 13 and raised to 16 the same night: GDPR art. 8 lets a
//                     country set the age of digital consent up to 16 and KVKK needs a guardian for minors; reversible after a
//                     lawyer has looked): `online` is false, so no device key is made, no profile and no friend code are
//                     registered, and there are no friends, lobbies, boards or chat. The rest of the row (names, friends,
//                     requests) is what the band would be allowed the day `online` is switched on; nothing reads it while the
//                     switch is off. Local play, family ghost races and local records work without any of it.
//   teen (16-17):     preset names, preset messages, no video, no free text; friends only by a code or a link; public lobbies and
//                     quick match, but only among teens.
//   adult (18+):      filtered free names; free text and optional two-way video, only in private rooms where every member is
//                     an adult and, for video, both friends switched it on.
//
// Nobody can look players up: the only ways to meet are a friend code, an invite link or a public lobby, so there is
// no search box and no "people you may know" list.
import type { AgeBand, LobbyGroup } from './types.ts';

/**
 * From this age a player may have an online identity (a device key, a profile and a friend code). Under it nothing is registered and
 * nothing is sent. The words of the screens and the pages, and their tests, read this number; the behaviour is `POLICY.child.online`.
 */
export const ONLINE_MIN_AGE = 16;
/** From this age a player is an adult here: a free display name, typed chat with friends and optional two-way video. */
export const ADULT_AGE = 18;

/** The band of a player of this age. The app asks for the band (three neutral choices), never for the age itself; this is where the numbers meet it. */
export const bandOfAge = (age: number): AgeBand => (age >= ADULT_AGE ? 'adult' : age >= ONLINE_MIN_AGE ? 'teen' : 'child');

export interface BandPolicy {
  /**
   * May have an online identity: a device key and a profile registered on the server, with a friend code. THE SWITCH of the
   * under-16 rule (BUILD-PLAN: "the only switch is POLICY in core/social/age.ts"): false for `child`, and then the client makes
   * no key, the Worker refuses the registration (403 child_no_online) and a profile cannot be lowered to this band.
   */
  online: boolean;
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
  child: { online: false, presetNameOnly: true, freeText: false, video: false, publicPlay: false, lobbyGroup: null, maxFriends: 25, maxIncomingRequests: 15, maxOutgoingRequests: 10, requestsPerDay: 10 },
  teen: { online: true, presetNameOnly: true, freeText: false, video: false, publicPlay: true, lobbyGroup: 'teen', maxFriends: 50, maxIncomingRequests: 25, maxOutgoingRequests: 15, requestsPerDay: 15 },
  adult: { online: true, presetNameOnly: false, freeText: true, video: true, publicPlay: true, lobbyGroup: 'adult', maxFriends: 100, maxIncomingRequests: 40, maxOutgoingRequests: 25, requestsPerDay: 25 },
};

const RANK: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };

export const isAgeBand = (x: unknown): x is AgeBand => x === 'child' || x === 'teen' || x === 'adult';
export const isMinor = (band: AgeBand): boolean => band !== 'adult';
export const policyFor = (band: AgeBand): BandPolicy => POLICY[band];
/** May a player of this band have an online identity (a device key, a profile, a friend code) at all? False under 16. */
export const canGoOnline = (band: AgeBand): boolean => POLICY[band].online;
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
 * Stepping down to a band that has no online identity (`canGoOnline`) is not a change of the profile: the profile is
 * deleted instead, and the Worker refuses the change (403 child_no_online).
 */
export const lowerBand = (current: AgeBand, requested: AgeBand): AgeBand | null => (RANK[requested] <= RANK[current] ? requested : null);
