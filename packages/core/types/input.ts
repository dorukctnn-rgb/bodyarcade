// core/input: one input bus for every source (replaces site/game/input.js).
import type { Ms, Unsubscribe } from './common.ts';
import type { MovementEngine, MovementEvent, MovementId } from './moves.ts';
import type { PlayerSlot } from './players.ts';

export type InputSourceId = 'pose' | 'keyboard' | 'touch' | 'trace' | 'test';

export type TrackingCode = 'no_person' | 'camera_ended' | 'stalled' | 'player_missing';

export interface Tracking { ok: boolean; code?: TrackingCode }

/** Every event carries its source (tech.md 4.5), and in two-player mode its player. */
export type InputEvent = MovementEvent & { source: InputSourceId; player?: PlayerSlot };

/** One player's share of an input frame in mode 'local2'. */
export interface PlayerInput {
  tracking: Tracking;
  channels: Readonly<Record<string, number>>;
  events: readonly InputEvent[];
}

export interface InputFrame {
  t: Ms;
  /** The allowed source that changed something most recently. */
  source: InputSourceId;
  tracking: Tracking;
  channels: Readonly<Record<string, number>>;
  /** Drained once per fixed step: each event appears in exactly one frame. */
  events: readonly InputEvent[];
  /**
   * Mode 'local2' only: each player's own stream. The top-level tracking, channels and events then mirror Player 1,
   * so a game that reads only them still works for one person, but local2 games must read `players`.
   */
  players?: Readonly<Record<PlayerSlot, PlayerInput>>;
}

/**
 * Keyboard map, keyed by KeyboardEvent.key. A channel binding holds `value` while the key is down and returns to 0
 * when it is released; an event binding fires once per press (auto-repeat ignored). Keys typed into form fields
 * are ignored. Single letters match in either case. `player` (mode 'local2', default 1) picks the player's stream.
 */
export type KeyMap = Record<string, { channel?: string; value?: number; event?: MovementId; player?: PlayerSlot }>;

export type SwipeName = 'up' | 'down' | 'left' | 'right' | 'tap';

/**
 * Touch map. `value` + `holdMs`: set the channel for a while (today's swipe-down crouch, 900 ms).
 * `step`: add to the channel and keep it, clamped to min..max (today's lane swipes).
 */
export type TouchMap = Partial<Record<SwipeName, {
  channel?: string;
  value?: number;
  holdMs?: number;
  step?: number;
  min?: number;
  max?: number;
  event?: MovementId;
}>>;

export interface InputHub {
  /** Ranked or live: ['pose'] only; anything else is dropped, so keyboard jumps no longer leak into camera runs. */
  allow(ids: InputSourceId[]): void;
  allowed(id: InputSourceId): boolean;
  bindKeyboard(map: KeyMap, target?: EventTarget): Unsubscribe;
  bindTouch(el: HTMLElement, map: TouchMap): Unsubscribe;
  /**
   * Feeds the engine's events and channels as source 'pose' (or 'trace' for trace playback). Mode 'local2': one engine
   * per player, each connected with its `player`.
   */
  connectPose(m: MovementEngine, source?: 'pose' | 'trace', player?: PlayerSlot): Unsubscribe;
  /** Programmatic input (tests, tools). Returns false and changes nothing when the source is not allowed. */
  inject(source: InputSourceId, p: { channels?: Record<string, number>; events?: MovementEvent[] }, player?: PlayerSlot): boolean;
  /** Mode 'local2': `player` sets that player's tracking (default 1). */
  setTracking(t: Tracking, player?: PlayerSlot): void;
  /** Called once per fixed step; drains the queued events. */
  sample(t: Ms): InputFrame;
  /** Clears channels, queued events and held keys (new run, pause). */
  reset(): void;
  dispose(): void;
}
