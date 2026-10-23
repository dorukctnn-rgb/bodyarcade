// core/net: the live-play protocol (tech.md 2.4), owned by the live-play builder (N).
// JSON over one WebSocket per player to the Room Durable Object, the single authority for members, the clock, the
// seed, pauses and the result. The fast 15 Hz state goes peer to peer (WebRTC data channel) or through the Room.
// Players never see each other's device id: inside a room everyone is a seat id, stable for that room only.
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
export type ResultReason = 'complete' | 'forfeit' | 'abandoned' | 'no_contest';
/** Why a player holds the match paused. offline and left are set by the Room, the rest by the client. */
export type NetPauseReason = 'hidden' | 'camera' | 'calibrating' | 'framing' | 'user' | 'offline' | 'left';
export const CLIENT_PAUSE_REASONS: readonly NetPauseReason[] = ['hidden', 'camera', 'calibrating', 'framing', 'user'];
/** text: free text (private room, every member adult). preset: preset messages and reactions only. */
export type ChatMode = 'text' | 'preset';

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

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
  /** What the room allows right now; it follows the members (one teen makes the whole room preset-only). */
  chat: ChatMode;
}

export interface MemberInfo {
  seat: SeatId;
  name: string;
  host: boolean;
  online: boolean;
  ready: boolean;
  /** Peer-connection epoch; a new value means this member rebuilt its connection (tech.md 2.5 rule 3). */
  sess: string;
  /** Opted in to video and allowed to (adult, private room). Video flows only between two members who both have it. */
  video: boolean;
}

export interface SeatScore { score: number; hits: number; passes: number; bestCombo: number }

export interface MatchResult {
  mid: string;
  reason: ResultReason;
  /** The single best seat, or null for a draw, an abandoned match or no contest. */
  winner: SeatId | null;
  /** Place per seat (1 = first; equal results share a place). Forfeited seats have no place. */
  places: Record<SeatId, number>;
  scores: Record<SeatId, SeatScore>;
  forfeited: SeatId[];
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
  /** Join or resume. `token` (from the first welcome) proves the seat; `reasons` are this client's pause reasons now. */
  | { t: 'hello'; v: number; pid: string; token: string | null; sess: string; video: boolean; reasons: NetPauseReason[]; blocks: string[] }
  | { t: 'sync'; c: number }
  | { t: 'signal'; to: SeatId; d: SignalData }
  | { t: 'sess'; sess: string }
  | { t: 'video'; on: boolean }
  | { t: 'ready'; ready: boolean }
  /** Host only, between matches. */
  | { t: 'config'; gameId?: string; durationMs?: number }
  | { t: 'ev'; mid: string; seq: number; ob: number; k: Outcome }
  /** End of match: the full outcome list fills anything lost on the way. */
  | { t: 'final'; mid: string; evs: ObstacleResult[] }
  | { t: 'relay'; d: unknown }
  | { t: 'pause'; reason: NetPauseReason }
  | { t: 'unpause' }
  | { t: 'chat'; text: string }
  | { t: 'preset'; id: PresetId }
  | { t: 'react'; id: ReactionId }
  | { t: 'block'; seat: SeatId }
  | { t: 'report'; seat: SeatId; reason: ReportReason; block: boolean }
  | { t: 'bye' };

export type AckRejection = 'bad' | 'early' | 'over' | 'no_match' | 'not_player';

export type RoomErrorCode =
  | 'version' | 'no_hello' | 'bad_pid' | 'bad_token' | 'full' | 'removed' | 'no_room' | 'not_host' | 'bad_config' | 'busy' | 'rate';

export type RoomMessage =
  | { t: 'welcome'; v: number; you: SeatId; token: string; now: number; room: RoomInfo; members: MemberInfo[]; match: MatchInfo | null; mine: ObstacleResult[] }
  | { t: 'sync'; c: number; s: number }
  | { t: 'presence'; members: MemberInfo[] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'signal'; from: SeatId; d: SignalData }
  | { t: 'start'; match: MatchInfo }
  | { t: 'paused'; by: SeatId | null; match: MatchInfo }
  | { t: 'resumed'; match: MatchInfo }
  | { t: 'settling'; mid: string }
  | { t: 'ack'; seq: number; rejected?: AckRejection }
  | { t: 'relay'; from: SeatId; d: unknown }
  | { t: 'result'; result: MatchResult }
  | { t: 'chat'; from: SeatId; text: string; at: number }
  | { t: 'preset'; from: SeatId; id: PresetId; at: number }
  | { t: 'react'; from: SeatId; id: ReactionId; at: number }
  | { t: 'chat_rejected'; reason: ChatRejectReason; retryAt?: number }
  | { t: 'reported'; seat: SeatId }
  /** Sent to the one who is being removed, just before the socket closes with 4003. */
  | { t: 'removed'; reason: 'blocked' | 'banned' }
  | { t: 'error'; code: RoomErrorCode };

/** WebSocket close codes the Room uses; the client stops for good on all of them except TICKET and RATE. */
export const CLOSE = {
  /** Another tab or device of the same player took the seat. */
  REPLACED: 4000,
  FULL: 4001,
  /** Ticket missing, invalid or expired: fetch a new one and reconnect. */
  TICKET: 4002,
  REMOVED: 4003,
  NO_ROOM: 4004,
  VERSION: 4005,
  /** Too many messages: the socket is dropped and the client reconnects after its backoff. */
  RATE: 4008,
} as const;

/** What the lobby directory (builder SO) sees of a room. Names only, never device ids. */
export interface RoomSummary {
  code: RoomCode;
  kind: RoomKind;
  gameId: string;
  band: string | null;
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
  /** Device player id (secret to the device and the server). */
  p: string;
  /** Display name, already filtered. */
  n: string;
  a: AgeBand;
  /** Expiry, epoch seconds. */
  e: number;
  /** Free text is muted until this epoch ms (three reports from different players, tech.md 5). */
  m?: number;
}

/** Answer of POST /api/rooms and POST /api/rooms/:code/join. */
export interface JoinGrant {
  code: RoomCode;
  link: string;
  ticket: string;
  /** Epoch seconds. */
  exp: number;
}

/** Answer of POST /api/ice. TURN credentials are minted by the Worker; the key never reaches the browser. */
export interface IceGrant {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  /** False when only STUN is offered (no TURN key, or the daily free allowance guard is reached). */
  turn: boolean;
}
