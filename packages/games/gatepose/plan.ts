// What the gate and pose games (template F) share: the timeline of sets, rests and the outro, and how an obstacle comes
// toward the player. Pure: whole numbers of steps, no clock.
import { stepsOf } from '../_shared/util.ts';

export interface GpTiming { sets: number; workS: number; restS: number; finaleS: number }

export type SegmentKind = 'work' | 'rest' | 'finale';
export interface GpSegment { kind: SegmentKind; startK: number; endK: number; set: number }

/** Sets of work with a rest between them, then the outro. Step k belongs to the segment with startK < k <= endK. */
export function makeSegments(t: GpTiming): { segments: GpSegment[]; endK: number } {
  const segments: GpSegment[] = [];
  let k = 0;
  for (let i = 0; i < t.sets; i++) {
    const work = stepsOf(t.workS);
    segments.push({ kind: 'work', startK: k, endK: k + work, set: i });
    k += work;
    if (i < t.sets - 1) {
      const rest = stepsOf(t.restS);
      segments.push({ kind: 'rest', startK: k, endK: k + rest, set: i });
      k += rest;
    }
  }
  const fin = stepsOf(t.finaleS);
  segments.push({ kind: 'finale', startK: k, endK: k + fin, set: t.sets - 1 });
  return { segments, endK: k + fin };
}

/**
 * How far an obstacle has come: 0 when it is first seen, 1 when it reaches the player, above 1 while it goes by (the view
 * ends it at PASS_END).
 */
export function approachU(k: number, arriveK: number, approachK: number): number {
  return (k - (arriveK - approachK)) / approachK;
}

/** The obstacle is gone from the screen at this progress. */
export const PASS_END = 1.28;

/** Perspective: size on the screen as a share of the size at arrival (1), from `u`. Small far away, large as it goes by. */
export function depthScale(u: number): number {
  const Z = 6;
  if (u <= 1) return 1 / (1 + Z * (1 - Math.max(0, u)));
  return 1 / Math.max(0.12, 1 - 3.4 * (u - 1));
}
