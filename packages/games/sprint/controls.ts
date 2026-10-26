// Keys and taps of Knee Sprint, for a player without a camera (and as the accessibility route, tech.md 4.5): the left and
// right arrows (or A and D) are the steps, in turn; Space, the up arrow or W jumps a hurdle. A tap is a step, a swipe up
// a jump. The session binds them only while counting down and playing.
import type { KeyMap, TouchMap } from '../../core/types/index.ts';

export const SPRINT_KEYS: KeyMap = {
  ArrowLeft: { event: 'kneeLift' }, ArrowRight: { event: 'kneeLift' }, a: { event: 'kneeLift' }, d: { event: 'kneeLift' },
  ' ': { event: 'jump' }, ArrowUp: { event: 'jump' }, w: { event: 'jump' },
};

export const SPRINT_TOUCH: TouchMap = {
  tap: { event: 'kneeLift' },
  up: { event: 'jump' },
};
