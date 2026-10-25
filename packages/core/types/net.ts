// core/net: the live-play protocol (tech.md 2.4), owned by the live-play builder (N).
// JSON over one WebSocket per player to the Room Durable Object, the single authority for members, the clock, the
// seed, pauses and the result. The fast 15 Hz state goes peer to peer (WebRTC data channel) or through the Room.
// Players never see each other's device id: inside a room everyone is a seat id, stable for that room only.
// Who a player is (device id, name, age band) comes from the signed join ticket, never from a message.
// This file is shared by the browser client and the Worker, so it must not use DOM or Workers types.

/** Bumped on any breaking change; the Room closes other versions with code 4005 (the page must reload). */
export const NET_PROTOCOL = 1;

export type SeatId = string;
/** Six characters from the alphabet without 0/O/1/I (tech.md 2.10). */
export type RoomCode = string;
/** private: invite link, code or QR (friends). public: lobby or quick match (strangers: ghosts and presets only). */
export type RoomKind = 'private' | 'public';
/** Self-declared at first social use: child under 13, teen 13-17, adult 18+ (BUILD-PLAN, tech.md 5). */
export type AgeBand = 'child' | 'teen' | 'adult';
export type Outcome = 'pass' | 'hit';
export type MatchPhase = 'running' | 'paused' | 'settling' | 'over';
/** complete: played to the end. forfeit: players left or stayed away the whole grace, one or more finished.
 *  no_contest: it ended that way before 30% of the match was played. abandoned: nobody was left. */
export type ResultReason = 'complete' | 'forfeit' | 'abandoned' | 'no_contest';
/** Why a player holds the match paused. offline is set by the Room, the rest by the client. */
export type NetPauseReason = 'hidden' | 'camera' | 'calibrating' | 'framing' | 'user' | 'offline';
export const CLIENT_PAUSE_REASONS: readonly NetPauseReason[] = ['hidden', 'camera', 'calibrating', 'framing', 'user'];
/** text: free text (private room, every member adult). preset: preset messages and reactions only. */
export type ChatMode = 'text' | 'preset';

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;
/** Match length bounds (ms). */
export const MIN_DURATION_MS = 15_000;
export const MAX_DURATION_MS = 180_000;
export const DEFAULT_DURATION_MS = 90_000;

export interface RoomConfig {
  gameId: string;
  /** Match length in ms (15 s to 3 min). */
  durationMs: number;
  /** Level band for public lobbies and quick match ('easy', 'medium', 'hard' or a skill bucket); null in private rooms. */
  band: string | null;
}

export interface RoomInfo {
  code: RoomCode;
  kind: RoomKind;
  /** Seats in this room, 2 to 4. */
  size: number;
  host: SeatId | null;
  config: RoomConfig;
  /** What the room allows right now; it follows the members (one under-18 member makes the room preset-only). */
  chat: ChatMode;
  /** Whether video can be switched on in this room at all (private rooms only; per member it also needs 18+). */
  video: boolean;
  phase: 'lobby' | 'playing';
  /**
   * Present only while the chosen game is a Pro game (core/net/live-games.ts). `ok`: the Room holds a Pro entitlement that the Worker
   * verified from its signed token (the host's, when the game was picked), so the match may start. False: it ran out, and the
   * match waits until the host picks a free game or shows a fresh token (the host's page renews its ticket for that).
   * Everyone in the room plays a Pro game the host picked, Pro or not; the check is on the host, never on the players.
   */
  pro?: { ok: boolean };
}

export interface MemberInfo {
  seat: SeatId;
  name: string;
  host: boolean;
  online: boolean;
  ready: boolean;
  /** Peer-connection epoch; a new value means this member rebuilt its connection (tech.md 2.5 rule 3). */
  sess: string;
  /**
   * Video between this member and the one reading the message: true only when this member switched video on and
   * is allowed to (adult, private room) and neither of the two blocked the other. Video flows between two members
   * only when each sees the other with video true.
   */
  video: boolean;
}

export interface SeatScore { score: number; hits: number; passes: number; bestCombo: number }

export interface MatchResult {
  mid: string;
  reason: ResultReason;
  /** The single best seat, or null for a draw, an abandoned match or no contest. */
  winner: SeatId | null;
  /** Place per seat that finished (1 = first; equal results share a place). Forfeited seats have no place. */
  places: Record<SeatId, number>;
  /** Scores of every seat that started, forfeited ones included. */
  scores: Record<SeatId, SeatScore>;
  forfeited: SeatId[];
  /**
   * What each seat did at each obstacle of the course, one character each in the course's order (p passed, h hit, . not played),
   * so a player can keep a friend's run as a recording (core/net/ghost.ts). Private rooms only: a public room sends none, so
   * nothing of a stranger is ever kept. Older Rooms send none either.
   */
  runs?: Record<SeatId, string>;
}

export interface MatchInfo {
  id: string;
  seed: number;
  gameId: string;
  /** Server epoch ms of match time zero; match time = server now - startAt - pauseTotal (tech.md 2.6). */
  startAt: number;
  /** ms */
  duration: number;
  phase: MatchPhase;
  pausedAt: number | null;
  /** End of the 3-2-1 after a pause (server epoch ms). */
  resumeAt: number | null;
  pauseTotal: number;
  /** Who holds the match paused, and why. */
  reasons: Record<SeatId, NetPauseReason>;
  /** The players of this match (members who join later wait for the next one). */
  seats: SeatId[];
  /** Seats out of this match (left, removed, or away for the whole grace). */
  forfeited: SeatId[];
  result: MatchResult | null;
}

/** One result per obstacle per player; the first one is final (tech.md 2.7). */
export interface ObstacleResult { ob: number; k: Outcome }

/** Preset messages: the only text strangers and under-18 players can send. The UI translates the ids. */
export const PRESETS = ['hi', 'gg', 'nice', 'again', 'ready', 'wait', 'wow', 'thanks', 'bye'] as const;
export type PresetId = typeof PRESETS[number];
/** Reactions (drawn as icons by the UI, never as raw emoji characters in interface text). */
export const REACTIONS = ['clap', 'fire', 'wave', 'laugh', 'wow', 'strong'] as const;
export type ReactionId = typeof REACTIONS[number];

export const REPORT_REASONS = ['abuse', 'sexual', 'cheating', 'spam', 'underage', 'other'] as const;
export type ReportReason = typeof REPORT_REASONS[number];

export type ChatRejectReason = 'empty' | 'too_long' | 'link' | 'email' | 'phone' | 'handle' | 'profanity' | 'rate' | 'not_allowed' | 'muted';

/** SDP or ICE candidate for one rival, tagged with the sender's and the receiver's epochs (tech.md 2.5 rule 3). */
export interface SignalData {
  sess: string;
  rsess: string;
  description?: { type: string; sdp?: string };
  candidate?: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null;
}

export type ClientMessage =
  /**
   * First message on every socket (join or resume). `tab` is a random id per page load: a newer tab of the same
   * player takes the seat over, and a tab that was replaced can never take it back. `reasons` are this client's
   * pause reasons now; `blocks` the block keys this device holds (see RoomMessage 'blocked').
   */
  | { t: 'hello'; v: number; tab: string; sess: string; video: boolean; reasons: NetPauseReason[]; blocks: string[] }
  | { t: 'sync'; c: number }
  | { t: 'signal'; to: SeatId; d: SignalData }
  | { t: 'sess'; sess: string }
  | { t: 'video'; on: boolean }
  | { t: 'ready'; ready: boolean }
  /** Host only, between matches. */
  | { t: 'config'; gameId?: string; durationMs?: number }
  /** Host only, private rooms: remove a member for the rest of this room's life. */
  | { t: 'kick'; seat: SeatId }
  | { t: 'ev'; mid: string; seq: number; ob: number; k: Outcome }
  /** End of match: the full outcome list fills anything lost on the way. */
  | { t: 'final'; mid: string; evs: ObstacleResult[] }
  /** Game state while the peer path is down (at most 20 per second, 2 KB each). */
  | { t: 'relay'; d: unknown }
  | { t: 'pause'; reason: NetPauseReason }
  | { t: 'unpause' }
  | { t: 'chat'; text: string }
  | { t: 'preset'; id: PresetId }
  | { t: 'react'; id: ReactionId }
  | { t: 'block'; seat: SeatId }
  | { t: 'report'; seat: SeatId; reason: ReportReason; block: boolean }
  /** Leaving on purpose: during a match the seat forfeits at once. Never sent on page unload (a reload is not a leave). */
  | { t: 'bye' };

export type AckRejection = 'bad' | 'early' | 'over' | 'no_match' | 'not_player';

/** Non-fatal errors; the socket stays open. */
/** `pro_required`: the host picked a Pro game and the Room holds no verified Pro entitlement of that host (the game stays as it was). */
export type RoomErrorCode = 'no_hello' | 'bad' | 'not_host' | 'bad_config' | 'busy' | 'not_allowed' | 'rate' | 'no_seat' | 'pro_required';

export type RoomMessage =
  | { t: 'welcome'; v: number; you: SeatId; now: number; room: RoomInfo; members: MemberInfo[]; match: MatchInfo | null; mine: ObstacleResult[]; blocked: SeatId[] }
  | { t: 'sync'; c: number; s: number }
  | { t: 'presence'; members: MemberInfo[] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'signal'; from: SeatId; d: SignalData }
  | { t: 'start'; match: MatchInfo }
  | { t: 'paused'; by: SeatId | null; match: MatchInfo }
  | { t: 'resumed'; match: MatchInfo }
  /** A seat left the running match (forfeit) and the others play on; `match` has it in `forfeited`. */
  | { t: 'forfeit'; seat: SeatId; match: MatchInfo }
  | { t: 'settling'; mid: string }
  | { t: 'ack'; seq: number; rejected?: AckRejection }
  | { t: 'relay'; from: SeatId; d: unknown }
  | { t: 'result'; result: MatchResult }
  | { t: 'chat'; from: SeatId; text: string; at: number }
  | { t: 'preset'; from: SeatId; id: PresetId; at: number }
  | { t: 'react'; from: SeatId; id: ReactionId; at: number }
  | { t: 'chat_rejected'; reason: ChatRejectReason; retryAt?: number }
  /** This device blocked `seat`; `key` is the opaque block key to keep and send in every hello. */
  | { t: 'blocked'; seat: SeatId; key: string }
  | { t: 'reported'; seat: SeatId }
  /** Sent to the one who is being removed, just before the socket closes with 4003. */
  | { t: 'removed'; reason: 'kicked' | 'banned' | 'dropped' }
  | { t: 'error'; code: RoomErrorCode };

/** WebSocket close codes the Room uses. The client stops for good on all of them except TICKET, RATE and SILENT. */
export const CLOSE = {
  /** Another tab or device of the same player took the seat, or this tab was replaced earlier. */
  REPLACED: 4000,
  FULL: 4001,
  /** Ticket missing, invalid or expired: fetch a new one and reconnect. */
  TICKET: 4002,
  /** Kicked by the host, banned, or dropped after being away from the lobby too long. */
  REMOVED: 4003,
  NO_ROOM: 4004,
  VERSION: 4005,
  /** Not allowed in this room (age band, a block with someone in a public room). */
  NOT_ALLOWED: 4006,
  /** Too many messages: the socket is dropped and the client reconnects after its backoff. */
  RATE: 4008,
  /** Nothing was heard from the socket (not even a keep-alive ping) for too long: the Room dropped it, the client reconnects. */
  SILENT: 4010,
} as const;

/** What the lobby directory (builder SO) sees of a room. Names only, never device ids. */
export interface RoomSummary {
  code: RoomCode;
  kind: RoomKind;
  gameId: string;
  band: string | null;
  /** Public rooms: who may join ('teen' or 'adult'; strangers of different bands never meet). Null in private rooms. */
  audience: AgeBand | null;
  size: number;
  players: number;
  open: number;
  names: string[];
  phase: 'lobby' | 'playing';
  updatedAt: number;
}

/** Signed join ticket claims (packages/server/src/live/tickets.ts). */
export interface TicketClaims {
  v: 1;
  /** Room code. */
  c: RoomCode;
  /** Device player id (never shown to other players). */
  p: string;
  /** Display name, already filtered. */
  n: string;
  a: AgeBand;
  /** Opaque block key of this player (derived from the device id with the server secret; safe to show other devices). */
  k: string;
  /** Expiry, epoch seconds. */
  e: number;
  /** Free text is muted until this epoch ms (three reports from different players, tech.md 5). */
  m?: number;
  /**
   * Pro: epoch seconds until which the Worker verified this player's signed entitlement token (the token's own `exp`) when it signed
   * this ticket. Absent for a player with no valid Pro token. Never taken from a client message: only the Worker writes it,
   * after checking the signature with the entitlement public key.
   */
  x?: number;
}

/** Answer of POST /api/rooms and POST /api/rooms/:code/join. */
export interface JoinGrant {
  code: RoomCode;
  link: string;
  ticket: string;
  /** Epoch seconds. */
  exp: number;
  room: RoomPreview;
}

/** Answer of GET /api/rooms/:code (the invite page): enough to show what you are joining, no names. */
export interface RoomPreview {
  code: RoomCode;
  kind: RoomKind;
  gameId: string;
  size: number;
  players: number;
  phase: 'lobby' | 'playing';
}

/** Answer of POST /api/ice. TURN credentials are minted by the Worker; the key never reaches the browser. */
export interface IceGrant {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  /** False when only STUN is offered (no TURN key, or the daily free allowance guard is reached). */
  turn: boolean;
  /** Epoch seconds after which the credentials stop working; ask again before. */
  exp: number;
}
