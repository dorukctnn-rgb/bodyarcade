// Keys and taps of Summit Climb, for a player without a camera (and as the accessibility route, tech.md 4.5): Space, the up
// arrow or W pull a hand (the hands take turns by themselves); the left and right arrows (or A and D) lean out of a rock's way
// for as long as they are held; the down arrow or S steps up a ledge. A tap is a pull, a swipe left or right leans for a moment (long
// enough for a rock), a swipe down is a step. The session binds them only while counting down and playing.
import type { KeyMap, TouchMap } from '../../core/types/index.ts';

export const CLIMB_KEYS: KeyMap = {
  ' ': { event: 'pull' }, ArrowUp: { event: 'pull' }, w: { event: 'pull' },
  ArrowDown: { event: 'kneeLift' }, s: { event: 'kneeLift' },
  ArrowLeft: { channel: 'lane', value: -1 }, a: { channel: 'lane', value: -1 },
  ArrowRight: { channel: 'lane', value: 1 }, d: { channel: 'lane', value: 1 },
};

export const CLIMB_TOUCH: TouchMap = {
  tap: { event: 'pull' },
  up: { event: 'pull' },
  down: { event: 'kneeLift' },
  // A swipe leans for long enough to cover a rock's warning and its landing, then the climber hangs in the middle again.
  left: { channel: 'lane', value: -1, holdMs: 1800 },
  right: { channel: 'lane', value: 1, holdMs: 1800 },
};
