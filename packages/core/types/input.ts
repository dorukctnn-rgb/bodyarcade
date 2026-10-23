// core/input: one input bus for every source (replaces site/game/input.js).
import type { Ms, Unsubscribe } from './common.ts';
import type { MovementEngine, MovementEvent, MovementId } from './moves.ts';

export type InputSourceId = 'pose' | 'keyboard' | 'touch' | 'trace' | 'test';

export type TrackingCode = 'no_person' | 'camera_ended' | 'stalled';

export interface Tracking { ok: boolean; code?: TrackingCode }

/** Every event carries its source (tech.md 4.5). */
export type InputEvent = MovementEvent & { source: InputSourceId };

export interface InputFrame {
  t: Ms;
  /** The allowed source that changed something most recently. */
  source: InputSourceId;
  tracking: Tracking;
  channels: Readonly<Record<string, number>>;
  /** Drained once per fixed step: each event appears in exactly one frame. */
  events: readonly InputEvent[];
}

/**
 * Keyboard map, keyed by KeyboardEvent.key. A channel binding holds `value` while the key is down and returns to 0
 * when it is released; an event binding fires once per press (auto-repeat ignored). Keys typed into form fields
 * are ignored.
 */
export type KeyMap = Record<string, { channel?: string; value?: number; event?: MovementId }>;

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
  /** Feeds the engine's events and channels as source 'pose' (or 'trace' for trace playback). */
  connectPose(m: MovementEngine, source?: 'pose' | 'trace'): Unsubscribe;
  /** Programmatic input (tests, tools). Returns false and changes nothing when the source is not allowed. */
  inject(source: InputSourceId, p: { channels?: Record<string, number>; events?: MovementEvent[] }): boolean;
  setTracking(t: Tracking): void;
  /** Called once per fixed step; drains the queued events. */
  sample(t: Ms): InputFrame;
  /** Clears channels, queued events and held keys (new run, pause). */
  reset(): void;
  dispose(): void;
}
