// What a game's simulation reads each step: the InputFrame of the session, reduced to one entry per player.
// One player reads the top level of the frame; mode 'local2' reads `players` (the top level then mirrors Player 1).
import type { InputEvent, InputFrame, InputSourceId, PlayerInput } from '../../core/types/index.ts';

/** One player's input for one step. */
export interface PlayerIn {
  /** The player is seen. A player who is not seen neither scores nor loses anything. */
  ok: boolean;
  /** The continuous values of the movement detectors (or of the keyboard) at this step. */
  ch: Readonly<Record<string, number>>;
  /** Events drained for this step; each appears in exactly one step. */
  events: readonly InputEvent[];
}

export interface FrameIn {
  /** Which allowed source changed something most recently. */
  source: InputSourceId;
  /** One entry for one player, two in mode 'local2' (index 0 is Player 1). */
  players: readonly PlayerIn[];
}

const NO_CHANNELS: Readonly<Record<string, number>> = Object.freeze({});
const NOBODY: PlayerIn = Object.freeze({ ok: false, ch: NO_CHANNELS, events: [] });

const fromPlayer = (p: PlayerInput): PlayerIn => ({ ok: p.tracking.ok, ch: p.channels, events: p.events });

export function frameOf(input: InputFrame, players: 1 | 2): FrameIn {
  const first: PlayerIn = { ok: input.tracking.ok, ch: input.channels, events: input.events };
  if (players === 1) return { source: input.source, players: [first] };
  const p1 = input.players?.[1];
  const p2 = input.players?.[2];
  return { source: input.source, players: [p1 ? fromPlayer(p1) : first, p2 ? fromPlayer(p2) : NOBODY] };
}

/** A frame for tests and bots: everything the sim reads, nothing it does not. */
export function frameFrom(players: readonly Partial<PlayerIn>[], source: InputSourceId = 'test'): FrameIn {
  return {
    source,
    players: players.map((p) => ({ ok: p.ok ?? true, ch: p.ch ?? NO_CHANNELS, events: p.events ?? [] })),
  };
}

/** Does this source drive the game with a camera (so the pose latency applies)? */
export const isCamera = (e: Pick<InputEvent, 'source'>): boolean => e.source === 'pose' || e.source === 'trace';
