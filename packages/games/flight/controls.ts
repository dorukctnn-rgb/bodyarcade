// Keys and swipes of Squat Flap, for a player without a camera (and as the accessibility route, tech.md 4.5): Space,
// the up arrow or W flaps; the down arrow or S held is the glide; a tap or a swipe up flaps, a swipe down glides for
// 0.9 seconds. The session binds them only while counting down and playing.
import type { KeyMap, TouchMap } from '../../core/types/index.ts';

export const FLIGHT_KEYS: KeyMap = {
  ' ': { event: 'squat' }, ArrowUp: { event: 'squat' }, w: { event: 'squat' },
  ArrowDown: { channel: 'glide', value: 1 }, s: { channel: 'glide', value: 1 },
};

export const FLIGHT_TOUCH: TouchMap = {
  tap: { event: 'squat' },
  up: { event: 'squat' },
  down: { channel: 'glide', value: 1, holdMs: 900 },
};
