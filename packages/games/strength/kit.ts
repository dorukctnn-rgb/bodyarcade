// Template E "strength" (game-design.md 0.6 E): repetitions become energy, and energy becomes something you can see.
// What the games of this template share: difficulty names, the energy meter that a rep fills and time empties, the
// "active seconds" count behind honest calories, a point log that a room can recompute a score from, and the seeded
// positions of things in a sky or a city (a function of the seed and an index, so a replay and a duel see the same one).
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import type { RunSummary } from '../../core/types/index.ts';
import { clamp, msOf, round } from '../_shared/util.ts';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

/** The shell's levels are easy, normal, hard and expert; the runner and some tests say 'medium' for normal. */
export function difficultyOf(name: string): Difficulty {
  if (name === 'medium') return 'normal';
  return (DIFFICULTIES as readonly string[]).includes(name) ? (name as Difficulty) : 'normal';
}

/** The honest part of calories: MET is for the whole body at work, so only seconds of real movement count. */
export const ACTIVE_WINDOW_S = 2.5;

export interface MeterOptions {
  /** Energy lost per second. */
  decay: number;
}

/** A meter from 0 to 1 that reps fill and time empties. Plain data: the owner keeps `value`, this is the arithmetic. */
export const meter = {
  gain(value: number, amount: number): number { return clamp(value + amount, 0, 1); },
  decayed(value: number, seconds: number, o: MeterOptions): number { return clamp(value - o.decay * seconds, 0, 1); },
};

/** A number in [0, 1) that depends only on the seed and an index: where the nth firework goes, which window lights next. */
export function unit(seed: number, name: string, index: number): number {
  return mulberry32(streamSeed((seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0, name))();
}

export type LogEntry = RunSummary['log'][number];

export function logOf(k: number, kind: string, ok: boolean, o: { v?: number; player?: 1 | 2 } = {}): LogEntry {
  return { t: round(msOf(k), 1), kind, ok, ...(o.v !== undefined ? { v: o.v } : {}), ...(o.player ? { player: o.player } : {}) };
}

/**
 * The tempo of a run of reps in per minute, from the steps of the last few of them (0 for fewer than two).
 * Used for the band a twist or a jack should stay in.
 */
export function cadence(repSteps: readonly number[], nowStep: number, o: { windowS: number }): number {
  const from = nowStep - o.windowS * 60;
  let n = 0;
  for (const s of repSteps) if (s > from) n++;
  return (n * 60) / o.windowS;
}
