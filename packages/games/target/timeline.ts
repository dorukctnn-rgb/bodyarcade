// The shape of a run in time: rounds of play with a short breather between them (game-design.md 0.1 item 4: arms held
// up for a long time wear a player out, so rounds are short and there is a real rest). Everything is in simulation
// milliseconds counted from the first step, and the number of rounds comes from the manifest's duration, so one number
// (`durationSec`) decides the whole run: duration = rounds x round + (rounds - 1) x rest.
import { stepTime } from '../../core/loop/clock.ts';

export interface Segment {
  kind: 'play' | 'rest';
  /** 0-based round: the round being played, or the one that has just ended during a rest. */
  round: number;
  start: number;
  end: number;
}

export interface Timeline {
  rounds: number;
  roundMs: number;
  restMs: number;
  totalMs: number;
  segments: Segment[];
}

/**
 * `durationSec` is the whole run. With `rounds` rounds and `restSec` between them each round lasts
 * (duration - (rounds - 1) x rest) / rounds. A run too short for the rests gets a single round without any.
 */
export function buildTimeline(durationSec: number, rounds: number, restSec: number): Timeline {
  const total = Math.max(1, durationSec) * 1000;
  let n = Math.max(1, Math.floor(rounds));
  let rest = Math.max(0, restSec) * 1000;
  if (n === 1 || total < n * 4000 + (n - 1) * rest) { n = 1; rest = 0; }
  const roundMs = (total - (n - 1) * rest) / n;
  const segments: Segment[] = [];
  let t = 0;
  for (let r = 0; r < n; r++) {
    segments.push({ kind: 'play', round: r, start: t, end: t + roundMs });
    t += roundMs;
    if (r < n - 1) {
      segments.push({ kind: 'rest', round: r, start: t, end: t + rest });
      t += rest;
    }
  }
  return { rounds: n, roundMs, restMs: rest, totalMs: total, segments };
}

/** The segment that contains time `t` (the last one for any time at or after the end). */
export function segmentAt(tl: Timeline, t: number): Segment {
  for (const s of tl.segments) if (t < s.end) return s;
  return tl.segments[tl.segments.length - 1] as Segment;
}

/** Share of the whole play time that has passed at `t`, 0 to 1 (rests do not count): how far the difficulty ramp has got. */
export function intensityAt(tl: Timeline, t: number): number {
  const played = tl.rounds * tl.roundMs;
  if (played <= 0) return 0;
  let done = 0;
  for (const s of tl.segments) {
    if (s.kind !== 'play') continue;
    if (t >= s.end) done += s.end - s.start;
    else if (t > s.start) done += t - s.start;
  }
  return Math.min(1, Math.max(0, done / played));
}

/** Simulation time of step `k` in milliseconds (k = 0 is the start). */
export const timeOfStep = (k: number): number => (k <= 0 ? 0 : stepTime(k));

/** The number of whole steps needed to reach `ms` (a run of 60 s is 3600 steps, however the floats fall). */
export const stepsFor = (ms: number): number => Math.ceil(ms * 60 / 1000 - 1e-9);
