// Keyboard players (a round without a camera) steer two cursors that stand in for the hands: the arrow keys move the
// right hand (screen right, sky blue), W A S D the left hand (gold). The cursors produce the same channels the
// movement library's handHit detector would (hand.L.x ...), so the games have one way to read a hand and a keyboard
// round plays the same game, with the same judging, as a camera round.
//
// A cursor position is given in arm lengths from the shoulder midpoint, like the plans. The speed is constant while a key
// is held (1.9 A per second, above the 1.5 A per second a punch needs): a pad is hit by moving through it.
import type { KeyMap } from '../../core/types/index.ts';
import { SEATED_SCALE, type Envelope } from './envelope.ts';
import type { Cursor } from './types.ts';

export const CURSOR_SPEED = 1.9;

export const CURSOR_KEYS: KeyMap = {
  ArrowLeft: { channel: 'cursor.R.x', value: -1 }, ArrowRight: { channel: 'cursor.R.x', value: 1 },
  ArrowUp: { channel: 'cursor.R.y', value: 1 }, ArrowDown: { channel: 'cursor.R.y', value: -1 },
  a: { channel: 'cursor.L.x', value: -1 }, d: { channel: 'cursor.L.x', value: 1 },
  w: { channel: 'cursor.L.y', value: 1 }, s: { channel: 'cursor.L.y', value: -1 },
};

export function newCursor(): Cursor {
  return {
    L: { ax: -0.5, ay: -0.85, vx: 0, vy: 0, speed: 0 },
    R: { ax: 0.5, ay: -0.85, vx: 0, vy: 0, speed: 0 },
  };
}

const dir = (v: number | undefined): number => (v === undefined || !Number.isFinite(v) ? 0 : Math.max(-1, Math.min(1, v)));

/** Moves both cursors by one step of `dtSec` seconds, keeping them inside the picture and under the overhead limit. */
export function stepCursor(c: Cursor, env: Envelope, ch: Readonly<Record<string, number>>, dtSec: number): void {
  const k = (env.seated ? SEATED_SCALE : 1) * env.arm;
  const xLo = env.frame.x0 / k, xHi = env.frame.x1 / k;
  const yLo = (env.frame.y0 - env.shoulderY) / k, yHi = (Math.min(env.frame.y1, env.top) - env.shoulderY) / k;
  for (const h of ['L', 'R'] as const) {
    const p = c[h];
    const dx = dir(ch[`cursor.${h}.x`]), dy = dir(ch[`cursor.${h}.y`]);
    const len = Math.hypot(dx, dy);
    const ox = p.ax, oy = p.ay;
    if (len > 1e-9) {
      const step = (CURSOR_SPEED * dtSec) / len;
      p.ax = Math.max(Math.min(xLo, xHi), Math.min(Math.max(xLo, xHi), p.ax + dx * step));
      p.ay = Math.max(Math.min(yLo, yHi), Math.min(Math.max(yLo, yHi), p.ay + dy * step));
    }
    p.vx = dtSec > 0 ? (p.ax - ox) / dtSec : 0;
    p.vy = dtSec > 0 ? (p.ay - oy) / dtSec : 0;
    p.speed = Math.hypot(p.vx, p.vy);
  }
}

/** The channels of a camera round's handHit detector, made from the cursors. `t` is the simulation time in ms. */
export function cursorChannels(c: Cursor, env: Envelope, t: number): Record<string, number> {
  const k = (env.seated ? SEATED_SCALE : 1) * env.arm;
  const out: Record<string, number> = {
    'hit.t': t, drop: 0, lean: 0,
    'body.sx': 0, 'body.sy': env.shoulderY, 'body.a': env.arm, 'body.w': env.halfW * 2,
  };
  for (const h of ['L', 'R'] as const) {
    const p = c[h];
    out[`hand.${h}.x`] = p.ax * k;
    out[`hand.${h}.y`] = env.shoulderY + p.ay * k;
    out[`hand.${h}.vx`] = p.vx;
    out[`hand.${h}.vy`] = p.vy;
    out[`hand.${h}.speed`] = p.speed;
    out[`hand.${h}.rx`] = p.ax * (env.seated ? SEATED_SCALE : 1);
    out[`hand.${h}.ry`] = p.ay * (env.seated ? SEATED_SCALE : 1);
    out[`hand.${h}.seen`] = 1;
  }
  return out;
}
