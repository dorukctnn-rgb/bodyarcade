// Keys and swipes of the runner (today's site/game/input.js): arrows or W A S D, Space to jump; swipe left and right
// to change lanes, up to jump, down to duck for 0.9 s. The session binds them only while counting down and playing.
import type { KeyMap, TouchMap } from '../../core/types/index.ts';

export const RUNNER_KEYS: KeyMap = {
  ArrowUp: { event: 'jump' }, ' ': { event: 'jump' }, w: { event: 'jump' },
  ArrowDown: { channel: 'crouch', value: 1 }, s: { channel: 'crouch', value: 1 },
  ArrowLeft: { channel: 'lane', value: -1 }, a: { channel: 'lane', value: -1 },
  ArrowRight: { channel: 'lane', value: 1 }, d: { channel: 'lane', value: 1 },
};

export const RUNNER_TOUCH: TouchMap = {
  up: { event: 'jump' },
  down: { channel: 'crouch', value: 1, holdMs: 900 },
  left: { channel: 'lane', step: -1, min: -1, max: 1 },
  right: { channel: 'lane', step: 1, min: -1, max: 1 },
};
