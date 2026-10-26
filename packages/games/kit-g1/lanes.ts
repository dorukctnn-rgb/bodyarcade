// One player's share of an input frame. Solo reads the top level of the frame; mode 'local2' reads `players[1]` and
// `players[2]` (the top level then mirrors Player 1, so a game that reads only it still works for one person).
import type { InputEvent, InputFrame, PlayerInput, Tracking } from '../../core/types/index.ts';

export interface LaneInput {
  tracking: Tracking;
  channels: Readonly<Record<string, number>>;
  events: readonly InputEvent[];
  /** Tracking says this player is in view. */
  present: boolean;
}

const NONE: Readonly<Record<string, number>> = Object.freeze({});

function from(p: PlayerInput | undefined): LaneInput {
  if (!p) return { tracking: { ok: false, code: 'player_missing' }, channels: NONE, events: [], present: false };
  return { tracking: p.tracking, channels: p.channels, events: p.events, present: p.tracking.ok };
}

/** The lanes of a frame: one for a solo run, two for 'local2'. */
export function lanesOf(input: InputFrame, players: 1 | 2): LaneInput[] {
  if (players === 2) {
    if (input.players) return [from(input.players[1]), from(input.players[2])];
    return [{ tracking: input.tracking, channels: input.channels, events: input.events, present: input.tracking.ok }, from(undefined)];
  }
  return [{ tracking: input.tracking, channels: input.channels, events: input.events, present: input.tracking.ok }];
}

/** A channel's value, 0 when the frame does not have it. */
export const ch = (l: LaneInput, name: string): number => l.channels[name] ?? 0;
