// core/social: shared types for the passwordless profile, friends, presence, lobbies and moderation
// (BUILD-PLAN "Friends, lobbies, playing online together"). The browser client (core/social/client.ts) and the Worker
// (packages/server/src/social) both import this file, so it uses no DOM and no Workers types.
//
// Three different ids exist on purpose:
//   pid   secret device-profile id. Only the server knows it; it goes into room tickets and D1 keys, never to a client.
//   fid   friend-visible id: random, stable, shown to friends and used in friend calls. Never the pid.
//   code  the shareable friend code (BA-7K2Q4X). Renewable; anyone holding it can send a request.
import type { AgeBand, ReportReason } from '../types/net.ts';

export type { AgeBand, ReportReason };
export { REPORT_REASONS } from '../types/net.ts';

/** Self-declared at first social use: child under 13, teen 13-17, adult 18+ (tech.md 5, game-design 2.9). */
export const AGE_BANDS: readonly AgeBand[] = ['child', 'teen', 'adult'];

/** Public lobbies and quick match never mix teens with adults, and children have none. */
export type LobbyGroup = 'teen' | 'adult';

export const REGIONS = ['eu', 'na', 'sa', 'as', 'af', 'oc'] as const;
export type Region = typeof REGIONS[number];

/** offline: not connected (or appearing offline). in_room: in a lobby or room. playing: a match is running. */
export type PresenceStatus = 'offline' | 'online' | 'in_room' | 'playing';
export const PRESENCE_STATUSES: readonly PresenceStatus[] = ['offline', 'online', 'in_room', 'playing'];

/** Level bands of public lobbies and quick match; the same words as RoomConfig.band in core/types/net.ts. */
export type LevelBand = 'easy' | 'medium' | 'hard';
export const LEVEL_BANDS: readonly LevelBand[] = ['easy', 'medium', 'hard'];

/** What a friend sees of another friend. The room code appears only while the room is joinable by friends. */
export interface FriendPresence {
  status: PresenceStatus;
  game?: string;
  room?: string;
}

export interface MyProfile {
  fid: string;
  name: string;
  /** The friend code in its written form, for example BA-7K2Q4X. */
  code: string;
  /** The link to share: https://bodyarcade.com/f/BA-7K2Q4X (the origin the server was configured with). */
  link: string;
  band: AgeBand;
  level: number;
  region: Region;
  lang: string;
  /** Appear offline to friends. */
  dnd: boolean;
  createdAt: number;
  /** Free text is muted until this epoch ms (0 = not muted). Set after repeated reports. */
  mutedUntil: number;
  /** Public lobbies and quick match are closed until this epoch ms (0 = open). Set after serious reports. */
  publicBlockedUntil: number;
  counts: { friends: number; incoming: number; outgoing: number; blocks: number };
  /** What the band allows, so the interface can hide what the player may not use. */
  can: { freeName: boolean; freeText: boolean; video: boolean; publicPlay: boolean; maxFriends: number };
}

export interface FriendEntry {
  fid: string;
  name: string;
  band: AgeBand;
  since: number;
  presence: FriendPresence;
}

export type RequestVia = 'code' | 'link';

export interface IncomingRequest { fid: string; name: string; at: number; via: RequestVia }
export interface OutgoingRequest { fid: string; name: string; at: number }
export interface RequestsView { incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }

export interface BlockEntry { fid: string; name: string; at: number }

/**
 * Answer of a friend request. `sent` also comes back when the request was dropped silently (the other player blocked
 * you, is an under-18 player and you are an adult, declined you recently, or has no room left): the interface says
 * "Request sent" and never tells why nothing came back, so nobody can probe another player.
 */
export type RequestResult = { status: 'sent' } | { status: 'friends'; friend: { fid: string; name: string; band: AgeBand } };

export interface LobbyEntry {
  code: string;
  game: string;
  region: Region;
  band: LevelBand | null;
  size: number;
  players: number;
  open: number;
  hostName: string;
  names: string[];
  phase: 'lobby' | 'playing';
  createdAt: number;
  updatedAt: number;
}

/** What strangers get in a public lobby: ghosts and preset messages only (never video, never free text). */
export interface LobbyRules { video: false; chat: 'preset'; ghostsOnly: true }

export type QuickAction =
  /** An open lobby fits: join it with the room API. */
  | { action: 'join'; code: string; searchId: string }
  /** Nothing fits yet: open a public room, wait in it and ask again. */
  | { action: 'create'; band: LevelBand; searchId: string }
  /** Hosting already; keep waiting (the answer repeats until somebody joins or a better lobby appears). */
  | { action: 'wait'; searchId: string; waitedMs: number; offerGhost: boolean }
  /** An older fitting lobby exists and the caller's own room is still empty: leave it and join this one. */
  | { action: 'merge'; code: string; searchId: string };

// ───────── weekly boards ─────────

export type BoardScope = 'friends' | 'country';

/** The server's ticket for one run: signed, bound to the player and the game, and timed by the server's own clock. */
export interface RunTicket { run: string; game: string; /** Server time the run was started. */ at: number }

export interface ScoreResult {
  /** True when this score is the player's best of the week for the game (and so it is on the boards). */
  improved: boolean;
  best: number;
  week: number;
}

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  /** This is the player themselves. */
  you: boolean;
  /** Friends boards only: the friend id, to open the friend. Country boards never carry one. */
  fid?: string;
}

export interface BoardView {
  game: string;
  scope: BoardScope;
  week: { id: number; start: number; end: number; current: boolean };
  /** Country boards: the two-letter country of the board (where the player is connecting from); null when it is not known. */
  country: string | null;
  entries: BoardEntry[];
  /** The player's own line: always present when they have a score this week, also when they are not among the entries. */
  you: { score: number; rank: number; /** The rank is a lower bound: more than this many players are ahead. */ atLeast: boolean } | null;
}

/** Everything the server holds about a player, for the "download my data" button. */
export interface DataExport {
  exportedAt: number;
  profile: Omit<MyProfile, 'counts' | 'can'>;
  friends: { fid: string; name: string; since: number }[];
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
  blocks: BlockEntry[];
  /** The player's best score of each game this week and last week (the boards keep nothing older). */
  scores: { week: number; game: string; score: number }[];
  reportsFiled: number;
  reportsAgainstYou: number;
}

export type SocialErrorCode =
  | 'bad_request'
  | 'payload_too_large'
  | 'unauthorized'
  | 'clock_skew'
  | 'replayed'
  | 'unknown_device'
  | 'forbidden'
  | 'banned'
  | 'not_found'
  | 'rate_limited'
  | 'too_many_attempts'
  | 'name_rejected'
  | 'band_locked'
  | 'already_friends'
  | 'self'
  | 'friends_full'
  | 'requests_full'
  | 'blocks_full'
  | 'you_blocked'
  | 'not_friends'
  | 'child_no_public'
  | 'public_suspended'
  | 'not_joinable'
  | 'not_in_room'
  | 'offline'
  | 'conflict'
  | 'closed'
  | 'recovery_failed'
  | 'unknown_game'
  | 'bad_run'
  | 'bad_score'
  | 'run_expired'
  | 'run_too_short'
  | 'score_implausible'
  | 'unavailable';

/** Error answers are `{ error: code, serverTime, retryAfterMs? }` with the status of the failure (router.ts fail()). */
export interface SocialErrorBody {
  error: SocialErrorCode | string;
  serverTime?: number;
  retryAfterMs?: number;
  [extra: string]: unknown;
}

/** What a hibernating PlayerHub pushes to the player's open socket. */
export type HubEvent =
  | { t: 'hello'; now: number }
  | { t: 'presence'; fid: string; name: string; presence: FriendPresence }
  | { t: 'friend_request'; from: { fid: string; name: string }; at: number; via: RequestVia }
  | { t: 'friend_added'; friend: { fid: string; name: string; band: AgeBand } }
  | { t: 'friend_removed'; fid: string }
  | { t: 'request_cancelled'; fid: string }
  | { t: 'invite'; id: string; from: { fid: string; name: string }; room: string; game: string; exp: number }
  | { t: 'invite_declined'; id: string; fid: string }
  /** The socket is about to close: another device took it (replaced), the profile was deleted or the player was banned. */
  | { t: 'closing'; reason: 'replaced' | 'deleted' | 'banned' };

/** What the client sends over its hub socket. The text 'ping' is answered with 'pong' by the platform, for free. */
export type HubCommand =
  | { t: 'beat' }
  /** Solo or idle status; the room status comes from the Room itself, never from the client. */
  | { t: 'status'; status: 'online' | 'playing'; game?: string };

/** Close codes of the hub socket (same numbering style as the Room in core/types/net.ts). */
export const HUB_CLOSE = {
  /** Another tab or device of the same player took the connection. */
  REPLACED: 4000,
  /** Signature missing, wrong or expired: sign again and reconnect. */
  AUTH: 4002,
  DELETED: 4010,
  BANNED: 4011,
  /** Too many messages: dropped; the client reconnects after its backoff. */
  RATE: 4008,
} as const;
