// What the friends side of the shell needs from the rest of the platform, as small interfaces: the social client
// (builder SO: profile, friends, presence, lobbies, boards, moderation) and the live client (builder N: rooms). The views draw
// only from the shapes below, so wiring the real clients is one adapter (social/adapter.ts); the practice implementation
// (app/demo-social.ts) fills the same shapes for development, tests and screenshots.
//
// Nothing here names a server. Types that already exist in core/social and core/types/net.ts are used as they are.
import type { SyncPort } from '../../../core/store/sync-docs.ts';
import type { Unsubscribe } from '../../../core/types/index.ts';
import type { LiveClient } from '../../../core/net/client.ts';
import type { VideoStatus } from '../../../core/net/video.ts';
import type { MatchDriver, MatchOutcome, MatchProgress, PendingInvite, ProfileChange } from '../../../core/social/client.ts';
import type { ChatRejectReason, MemberInfo, PresetId, ReactionId, RoomInfo, SeatId } from '../../../core/types/net.ts';
import type {
  AgeBand, BlockEntry, BoardScope, BoardView, DataExport, FriendEntry, LevelBand, LobbyEntry, MyProfile, Region, ReportReason, RequestResult, RequestsView,
  RunTicket, ScoreResult, SocialErrorCode,
} from '../../../core/social/types.ts';

export type { MatchDriver, MatchOutcome, MatchProgress, PendingInvite, ProfileChange };

export type SocialFailure = SocialErrorCode | 'network';

/** A call that did not work, with what the answer said about it (all optional: only the answers that carry them). */
export interface Failed {
  ok: false;
  code: SocialFailure;
  /** rate_limited, too_many_attempts, closed: how long to wait, in ms. */
  retryAfterMs?: number;
  /** banned, public_suspended: epoch ms the closure ends. */
  until?: number;
  /** name_rejected: why the filter said no. */
  reason?: string;
  /** friends_full on accepting: whose list is full. */
  who?: 'me' | 'them';
  /** bad_request: which field of the request was wrong ('code', 'recovery'). */
  field?: string;
}

/** A call that can fail in ways the player should be told about. Calls never throw. */
export type Done<T = void> = { ok: true; value: T } | Failed;

/** The profile left this device: after a deletion (on another device), or when the server no longer knows the key. */
export type SignedOut = 'deleted' | 'unknown_device';

/**
 * Why there is no online profile on this device and none is offered: the player said they are under 16 (nothing is made or sent:
 * core/social/age.ts POLICY), or the profile in use is a kid profile of the Family plan (kid profiles never register online).
 */
export type NoOnline = 'young' | 'kid';

export interface SocialState {
  /** loading: the first answer has not come yet; offline: the server does not answer. */
  status: 'loading' | 'ready' | 'offline';
  /** null until the player has answered the age question: nothing is created on the server before that. */
  profile: MyProfile | null;
  friends: readonly FriendEntry[];
  requests: RequestsView;
  blocks: readonly BlockEntry[];
  /** Friends' invitations that wait for an answer (they run out two minutes after they were sent). */
  invites: readonly PendingInvite[];
  /** The presence connection: idle, connecting, online, replaced (another window took it), banned. */
  hub: 'idle' | 'connecting' | 'online' | 'replaced' | 'banned';
  /** Set when the profile went away without the player asking (deleted on another device, or the server forgot the key). */
  signedOut: SignedOut | null;
  /** Epoch ms the suspension of this profile ends (0 when it is suspended and the date is not known); null when it is not suspended. */
  bannedUntil: number | null;
  /** The recovery code of a sign-up or a renewal, until the player has seen it: shown once, held in memory only. */
  recovery: string | null;
  /** False when the profile will not survive closing the page (no IndexedDB): the sign-up says so. */
  persistent: boolean;
  noOnline: NoOnline | null;
}

export const NO_SOCIAL_STATE: SocialState = {
  status: 'loading', profile: null, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [], invites: [], hub: 'idle', signedOut: null, bannedUntil: null, recovery: null, persistent: true, noOnline: null,
};

/** Something that happened while the player looked elsewhere: a toast says it, the page already shows it. */
export type SocialNotice =
  | { kind: 'request'; name: string }
  | { kind: 'friend'; name: string }
  | { kind: 'invite'; invite: PendingInvite }
  | { kind: 'inviteDeclined'; name: string }
  | { kind: 'signedOut'; reason: SignedOut };

export interface ProfileRequest {
  band: AgeBand;
  /**
   * Adults choose a name (the server filters it). Under 18 the name is a generated one (core/social/presets.ts randomPresetName),
   * shown first and sent as it was shown; null lets the server make one.
   */
  name: string | null;
}

export interface QuickMatchRequest {
  game: string;
  /** What the search does in live play: opens a public room, takes a seat, leaves the room it opened. */
  driver: MatchDriver;
  signal: AbortSignal;
  onProgress(p: MatchProgress): void;
}

export interface SocialPort {
  state(): SocialState;
  subscribe(cb: () => void): Unsubscribe;
  /** Things that happened (a request, a new friend, an invitation, being signed out), for a toast and a sheet. */
  notices(cb: (n: SocialNotice) => void): Unsubscribe;
  /** Loads the profile, friends and requests and opens the presence connection. Safe to call again (it tries again after a failure). */
  open(): Promise<void>;
  /** Closes the presence connection (the app is closing). */
  close(): void;
  /** The page is visible (true) or hidden (false): presence beats pause while it is hidden. */
  setActive(active: boolean): void;
  /** What the player does outside a room: 'online', or 'playing' a game alone. */
  setStatus(status: 'online' | 'playing', game?: string): void;
  /** Takes the connection back after another window took it (`hub` is 'replaced'). */
  takeOver(): void;
  /** The player said they are under 16: remembered on this device, nothing else (no key, no request). */
  declareTooYoung(): void;
  /** The recovery code was shown: it is gone from memory. */
  dismissRecovery(): void;
  /** Asks again whether this device may have an online profile (the active profile of the Family plan changed). */
  recheck(): void;

  createProfile(r: ProfileRequest): Promise<Done<MyProfile>>;
  /** The profile back on this device: the friend code names it, the recovery code proves it is the player's. */
  recoverProfile(r: { code: string; recovery: string }): Promise<Done<MyProfile>>;
  updateProfile(change: ProfileChange): Promise<Done<MyProfile>>;
  renewCode(): Promise<Done<MyProfile>>;
  /** A new recovery code (the old one stops working): the value is the code, to be shown once. */
  renewRecovery(): Promise<Done<string>>;
  exportData(): Promise<Done<DataExport>>;
  deleteProfile(): Promise<Done>;

  addByCode(code: string): Promise<Done<RequestResult>>;
  answer(fid: string, accept: boolean): Promise<Done>;
  cancelRequest(fid: string): Promise<Done>;
  unfriend(fid: string): Promise<Done>;
  block(fid: string): Promise<Done>;
  unblock(fid: string): Promise<Done>;
  report(r: { fid: string; reason: ReportReason; details: string; alsoBlock: boolean }): Promise<Done>;
  invite(fid: string, room: string): Promise<Done<{ id: string; exp: number }>>;
  /** Takes an invitation (the caller then joins its room) or turns it down (the inviter is told). */
  answerInvite(invite: PendingInvite, accept: boolean): Promise<Done>;
  lobbies(q: { game: string; region: Region }): Promise<Done<LobbyEntry[]>>;
  /** Looks for a lobby at the player's level every four seconds until a seat is taken, the signal says stop, or two minutes pass. */
  quickMatch(q: QuickMatchRequest): Promise<Done<MatchOutcome>>;

  leaderboard(q: { game: string; scope: BoardScope; week: 'current' | 'previous' }): Promise<Done<BoardView>>;
  /** A solo run begins: the server notes the time and signs a ticket. */
  startRun(game: string): Promise<Done<RunTicket>>;
  /** The run ended with a score: the server checks the ticket, the time and what the game can award in it. */
  finishRun(ticket: RunTicket, score: number): Promise<Done<ScoreResult>>;

  /** What the saved documents of the arcade (streak, daily challenge, plans) sync through; null while there is no profile. */
  syncPort(): SyncPort | null;
  /** The server's clock as far as the page knows it (epoch ms): invitations run out by it. */
  serverNow(): number;
}

// ---- rooms (builder N) ----------------------------------------------------------------------------------------------

/** The same for rooms: the failures are the room's own. */
export type RoomDone<T = void> = { ok: true; value: T } | { ok: false; code: RoomProblem };

export type RoomProblem = 'full' | 'no_room' | 'removed' | 'replaced' | 'version' | 'not_allowed' | 'ticket' | 'offline';

export interface FeedItem {
  id: number;
  seat: SeatId;
  /** A preset message or a reaction; free text only when the room allows it (`RoomInfo.chat` is 'text'). */
  say?: PresetId;
  react?: ReactionId;
  text?: string;
  at: number;
}

export interface RoomState {
  phase: 'idle' | 'joining' | 'lobby' | 'playing' | 'closed';
  info: RoomInfo | null;
  members: readonly MemberInfo[];
  /** This player's seat once joined. */
  me: SeatId | null;
  feed: readonly FeedItem[];
  problem: RoomProblem | null;
  /** The player's own switch for sharing their camera with friends in this room (starts off). */
  shareVideo: boolean;
  /** The link to share: `<origin>/r/<CODE>`. */
  link: string;
  /** The connection to the Room: it comes back by itself after a drop ('reconnecting'). Missing in the practice port. */
  connection?: 'online' | 'reconnecting' | 'stopped';
  /** The last message the Room turned away (too fast, not allowed, muted), for a note under the box. */
  rejected?: { reason: ChatRejectReason; at: number };
  /**
   * The camera link to each friend who shares (core/net/video.ts): connecting, live, or failed. The match never depends on it;
   * the friend is a skeleton meanwhile. A failed link gets one line ('room.video.failed') and a retry button. Missing in the practice port.
   */
  videos?: readonly VideoStatus[];
}

/**
 * The host tried to make a room with a Pro game, or to pick one in a room, and the Worker or the Room found no Pro proof of the host that
 * checks out (app/live-room.ts). reason: none (no Pro to show), expired (the proof has to renew online), invalid (it does not check
 * out), refused (the Room said so and the page cannot tell why). Players who join a room never need Pro: the check is on the host.
 */
export interface ProNeeded {
  game: string;
  reason: 'none' | 'expired' | 'invalid' | 'refused';
  at: number;
}

export const NO_ROOM_STATE: RoomState = { phase: 'idle', info: null, members: [], me: null, feed: [], problem: null, shareVideo: false, link: '' };

export interface RoomPort {
  state(): RoomState;
  subscribe(cb: () => void): Unsubscribe;
  /** Opens a new room and joins it; the value is its code. */
  create(o: { game: string; kind: 'private' | 'public'; size: number; band: LevelBand | null; /** Match length; the Room's default when missing. */ durationMs?: number }): Promise<RoomDone<string>>;
  join(code: string): Promise<RoomDone>;
  setReady(ready: boolean): void;
  /** Host only. */
  chooseGame(game: string): void;
  /** Host only, when everybody is ready. */
  start(): void;
  leave(): void;
  say(id: PresetId): void;
  react(id: ReactionId): void;
  /** Free text; only rooms whose chat is 'text' take it (the room says no otherwise). The text has passed the local filter. */
  sendText(text: string): { ok: true } | { ok: false; reason: ChatRejectReason };
  setShareVideo(on: boolean): void;
  /** Asks the members who are not ready to get ready (a preset nudge, not free text). */
  remind(seat?: SeatId): void;
  /** "Try again" for a friend camera that did not connect (one friend, or every failed one). Missing in the practice port. */
  retryVideo?(seat?: SeatId): void;
  /** The live client of the room that is open (the stage of a race plays through it), or null. Missing in the practice port. */
  client?(): LiveClient | null;
  /** Reports the player in a seat to the Room (it files the evidence of the room: the last messages and the seats). Optional: a port may not have it. */
  reportSeat?(seat: SeatId, reason: ReportReason, alsoBlock: boolean): void;
  /** Blocks the player in a seat for this device: the Room keeps them apart from now on. Optional. */
  blockSeat?(seat: SeatId): void;
  /**
   * The last Pro refusal of a game the host asked for, or null (cleared by the next try to make or join a room, by leaving the room and by
   * dismissProNeeded; the listeners of subscribe are called when it changes). Optional: a port that has no Pro games may not have it.
   */
  proNeeded?(): ProNeeded | null;
  dismissProNeeded?(): void;
}

/** Both ports, or null while this build has no social server (the Friends tab then stays hidden). */
export interface SocialServices {
  social: SocialPort;
  rooms: RoomPort;
}
