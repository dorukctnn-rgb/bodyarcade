// Seams between live play (this module) and the social module (builder SO). SO registers its implementations once, at
// import time, with `setLiveHooks({...})`; with nothing registered live play works on its own (anonymous device ids,
// no lobby directory). Every hook is optional, may be async, and must never throw into the Room: the Room catches,
// logs and carries on, because a social outage must not break a running match.
import type { AgeBand, ReportReason, RoomCode, RoomSummary, SeatId } from '../../../core/types/net.ts';
import type { LiveEnv } from './env.ts';
import type { ProVerdict } from './pro.ts';

/** A verified player: who is asking to create or join a room. `pid` is the device id and is never shown to others. */
export interface LivePlayer {
  pid: string;
  /** Display name, already filtered (1-20 characters). */
  name: string;
  age: AgeBand;
  /** Free text is muted until this epoch ms (reports against the player, kept by SO across rooms). */
  mutedUntil?: number;
  /**
   * What the Worker made of the signed Pro token the request carried (pro.ts). Set by the live routes after `verifyPlayer`, never by a
   * hook: whatever a hook puts here is replaced. A caller that builds a LivePlayer itself (a matchmaker) sets it with `verifyProProof`;
   * without it the player is free, which only matters for a Pro game.
   */
  pro?: ProVerdict;
}

/** One report as the Room hands it over (the evidence is only what the Room saw: the last chat lines of this room). */
export interface RoomReport {
  code: RoomCode;
  matchId: string | null;
  reporterPid: string;
  targetPid: string;
  reporterSeat: SeatId;
  targetSeat: SeatId;
  reason: ReportReason;
  at: number;
  chat: { seat: SeatId; name: string; text: string; at: number }[];
}

export interface LiveHooks {
  /**
   * HTTP create or join: who is calling. `body` is the parsed JSON body (already size-checked). Return null to answer
   * 401. Without this hook live play trusts `pid`, `name` and `age` from the body (validated and filtered), which is
   * enough for anonymous play; SO replaces it with signed requests and stored profiles.
   */
  verifyPlayer?(req: Request, env: LiveEnv, body: Record<string, unknown>): Promise<LivePlayer | null>;
  /**
   * HTTP join of a room, before a ticket is signed: false answers 403 `not_allowed`. SO checks blocks and the age
   * bands that may meet in public rooms. `summary` is what the lobby directory would show.
   */
  gateJoin?(env: LiveEnv, summary: RoomSummary, player: LivePlayer): Promise<boolean>;
  /** A room was created or changed (members, phase, game). `pids` are the device ids of its members. */
  publishRoom?(env: LiveEnv, summary: RoomSummary, pids: string[]): void | Promise<void>;
  /** The room is gone (empty for too long, expired, or destroyed). */
  removeRoom?(env: LiveEnv, code: RoomCode): void | Promise<void>;
  /** Presence: a player entered or left a room, or started or finished a match (`playing`). */
  setPlaying?(env: LiveEnv, ev: { code: RoomCode; pid: string; inRoom: boolean; playing: boolean; gameId: string }): void | Promise<void>;
  /** A player reported another. SO stores it (moderation queue) and may mute across rooms. */
  submitReport?(env: LiveEnv, report: RoomReport): void | Promise<void>;
  /** A player blocked another inside a room (SO adds it to the matchmaking block list). */
  blockByPid?(env: LiveEnv, pid: string, targetPid: string): void | Promise<void>;
}

let current: LiveHooks = {};

/** Registers (merges) hook implementations. Later calls override earlier ones per hook. */
export function setLiveHooks(h: LiveHooks): void {
  current = { ...current, ...h };
}

export function liveHooks(): Readonly<LiveHooks> {
  return current;
}

/** Tests only: forget every registered hook. */
export function clearLiveHooks(): void {
  current = {};
}
