// What the friends side of the shell needs from the rest of the platform, as small interfaces: the social client
// (builder SO: profile, friends, presence, lobbies, moderation) and the live client (builder N: rooms). The views draw
// only from the shapes below, so wiring the real clients is one adapter in boot.ts; the practice implementation
// (app/demo-social.ts) fills the same shapes for development, tests and screenshots.
//
// Nothing here names a server. Types that already exist in core/social and core/types/net.ts are used as they are.
import type { Unsubscribe } from '../../../core/types/index.ts';
import type { ChatRejectReason, MemberInfo, PresetId, ReactionId, RoomInfo, SeatId } from '../../../core/types/net.ts';
import type {
  AgeBand, BlockEntry, FriendEntry, LevelBand, LobbyEntry, MyProfile, QuickAction, Region, ReportReason, RequestResult, RequestsView, SocialErrorCode,
} from '../../../core/social/types.ts';

export type SocialFailure = SocialErrorCode | 'network';

/** A call that can fail in ways the player should be told about. Calls never throw. */
export type Done<T = void> = { ok: true; value: T } | { ok: false; code: SocialFailure };

export interface SocialState {
  /** loading: the first answer has not come yet; offline: the server does not answer. */
  status: 'loading' | 'ready' | 'offline';
  /** null until the player has answered the age question: nothing is created on the server before that. */
  profile: MyProfile | null;
  friends: readonly FriendEntry[];
  requests: RequestsView;
  blocks: readonly BlockEntry[];
}

/** The same for rooms: the failures are the room's own. */
export type RoomDone<T = void> = { ok: true; value: T } | { ok: false; code: RoomProblem };

export const NO_SOCIAL_STATE: SocialState = { status: 'loading', profile: null, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [] };

export interface ProfileRequest {
  band: AgeBand;
  /** Adults choose a name (filtered by the server); under 18 get a preset name and send null. */
  name: string | null;
}

export interface SocialPort {
  state(): SocialState;
  subscribe(cb: () => void): Unsubscribe;
  /** Loads the profile, friends and requests and opens the presence connection. Safe to call again. */
  open(): Promise<void>;
  /** Closes the presence connection (the player left the friends screens). */
  close(): void;
  /** The age question and the name: creates the profile. */
  createProfile(r: ProfileRequest): Promise<Done<MyProfile>>;
  addByCode(code: string): Promise<Done<RequestResult>>;
  answer(fid: string, accept: boolean): Promise<Done>;
  cancelRequest(fid: string): Promise<Done>;
  unfriend(fid: string): Promise<Done>;
  block(fid: string): Promise<Done>;
  unblock(fid: string): Promise<Done>;
  report(r: { fid: string; reason: ReportReason; details: string; alsoBlock: boolean }): Promise<Done>;
  invite(fid: string, room: string): Promise<Done>;
  lobbies(q: { game: string; region: Region }): Promise<Done<LobbyEntry[]>>;
  quickMatch(q: { game: string; band: LevelBand }): Promise<Done<QuickAction>>;
}

// ---- rooms (builder N) ----------------------------------------------------------------------------------------------

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
}

/** Both ports, or null while this build has no social server (the Friends tab then stays hidden). */
export interface SocialServices {
  social: SocialPort;
  rooms: RoomPort;
}
