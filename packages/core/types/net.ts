// core/net: room protocol message types. PLACEHOLDER from tech.md 2.4 (proof of concept in poc/mp-poc);
// the live-play builder owns this file and will refine it. JSON over one WebSocket per player.
import type { Ms } from './common.ts';
import type { GameMode } from './game.ts';

export type PlayerId = string;
export type RoomCode = string;   // six characters, alphabet without 0/O/1/I (tech.md 2.10)

export interface MatchInfo {
  mid: string;
  seed: number;
  gameId: string;
  mode: GameMode;
  /** Server time (ms) when the match starts; match time = server now - startAt - pauseTotal (tech.md 2.6). */
  startAt: Ms;
  durationSec: number;
  pausedAt?: Ms;
  resumeAt?: Ms;
  pauseTotal: Ms;
}

export interface MemberInfo {
  pid: PlayerId;
  name: string;
  online: boolean;
  ready: boolean;
  sess: number;
  video: boolean;
}

export type NetPauseReason = 'hidden' | 'camera' | 'calibrating' | 'peer_down';

/** One result per obstacle per player, acknowledged by the room (tech.md 2.7). */
export interface ObstacleResult { mid: string; seq: number; ob: number; k: 'pass' | 'hit' }

export type ClientMessage =
  | { type: 'hello'; pid: PlayerId; name: string; token?: string; sess: number; video: boolean }
  | { type: 'sync'; c: number }
  | { type: 'signal'; to: PlayerId; d: unknown; fromSess: number; toSess: number }
  | { type: 'sess'; sess: number }
  | { type: 'ready'; ready: boolean }
  | ({ type: 'ev' } & ObstacleResult)
  | { type: 'relay'; d: unknown }
  | { type: 'pause'; reason: NetPauseReason }
  | { type: 'unpause' }
  | { type: 'chat'; text: string }
  | { type: 'bye' };

export type RoomMessage =
  | { type: 'welcome'; you: PlayerId; token: string; now: Ms; members: MemberInfo[]; match: MatchInfo | null; mine: ObstacleResult[] }
  | { type: 'sync'; c: number; s: Ms }
  | { type: 'signal'; from: PlayerId; d: unknown; fromSess: number; toSess: number }
  | { type: 'presence'; members: MemberInfo[] }
  | { type: 'start'; match: MatchInfo }
  | { type: 'paused'; match: MatchInfo }
  | { type: 'resumed'; match: MatchInfo }
  | { type: 'ack'; seq: number; rejected?: string }
  | { type: 'relay'; from: PlayerId; d: unknown }
  | { type: 'chat'; from: PlayerId; text: string }
  | { type: 'result'; winner: PlayerId | null; scores: Record<PlayerId, number>; reason: 'complete' | 'forfeit' | 'abandoned' };
