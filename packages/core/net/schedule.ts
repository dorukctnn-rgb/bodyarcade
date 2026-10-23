// The live course: a pure function of (seed, duration, spec), shared by the Room (authority) and every client.
// It fixes only WHEN obstacles happen and their ids; each game derives what an obstacle looks like from
// (seed, obstacle id) with its own stream, so the Room never needs game code to validate or score a match.
// Player performance never feeds back into it, so two devices cannot drift apart (tech.md 2.6).
import { rngStream } from '../loop/rng.ts';
import type { ObstacleResult, SeatId, SeatScore } from '../types/net.ts';

export interface ScheduleSpec {
  /** Run-in before the first obstacle (ms of match time). */
  firstMs: number;
  minGapMs: number;
  maxGapMs: number;
  /** No obstacle in the last endPadMs of the match. */
  endPadMs: number;
}

export interface Obstacle {
  id: number;
  /** Match time in integer ms. */
  t: number;
}

/** Spacing used by the proof of concept (obstacles every 1.6-2.6 s after a 3 s run-in). */
export const DEFAULT_SPEC: ScheduleSpec = { firstMs: 3000, minGapMs: 1600, maxGapMs: 2600, endPadMs: 1500 };

/**
 * Per-game spacing. A game that races live adds one line here (the Room reads the same table).
 * Unknown ids use DEFAULT_SPEC, so a new game works before it has its own line.
 */
export const SCHEDULE_SPECS: Readonly<Record<string, ScheduleSpec>> = {
  'squat-flap': { firstMs: 3000, minGapMs: 1800, maxGapMs: 2800, endPadMs: 1500 },
  'knee-sprint': { firstMs: 3000, minGapMs: 1500, maxGapMs: 2400, endPadMs: 1500 },
};

export function specFor(gameId: string): ScheduleSpec {
  return SCHEDULE_SPECS[gameId] ?? DEFAULT_SPEC;
}

export function makeSchedule(seed: number, durationMs: number, spec: ScheduleSpec = DEFAULT_SPEC): Obstacle[] {
  const r = rngStream(seed, 'live-schedule');
  const out: Obstacle[] = [];
  const span = Math.max(0, spec.maxGapMs - spec.minGapMs);
  let t = spec.firstMs, id = 1;
  while (t < durationMs - spec.endPadMs) {
    out.push({ id: id++, t: Math.round(t) });
    t += spec.minGapMs + Math.floor(r() * (span + 1));
  }
  return out;
}

/**
 * Race scoring from per-obstacle outcomes, the same function on the Room and the clients.
 * A pass is worth 100, plus 10% per combo step up to +100%; a hit breaks the combo. A missing outcome (the player
 * was away before the pause kicked in) counts as neither (tech.md 2.7).
 */
export function scoreOf(schedule: readonly Obstacle[], events: readonly ObstacleResult[]): SeatScore {
  const byOb = new Map<number, ObstacleResult['k']>();
  for (const e of events) if (!byOb.has(e.ob)) byOb.set(e.ob, e.k);
  let score = 0, combo = 0, bestCombo = 0, hits = 0, passes = 0;
  for (const o of schedule) {
    const k = byOb.get(o.id);
    if (k === 'pass') {
      combo++; passes++;
      bestCombo = Math.max(bestCombo, combo);
      score += Math.round(100 * (1 + Math.min(10, combo - 1) * 0.1));
    } else if (k === 'hit') {
      combo = 0; hits++;
    }
  }
  return { score, hits, passes, bestCombo };
}

/** Tie-break: higher score, then fewer hits, then longer best combo, else a draw (tech.md 2.7). >0: a is better. */
export function decide(a: SeatScore, b: SeatScore): number {
  if (a.score !== b.score) return a.score > b.score ? 1 : -1;
  if (a.hits !== b.hits) return a.hits < b.hits ? 1 : -1;
  if (a.bestCombo !== b.bestCombo) return a.bestCombo > b.bestCombo ? 1 : -1;
  return 0;
}

/** Places (1 = first) for the given seats; equal results share a place, the next place skips (1, 1, 3). */
export function places(scores: Readonly<Record<SeatId, SeatScore>>, seats: readonly SeatId[]): Record<SeatId, number> {
  const out: Record<SeatId, number> = {};
  for (const s of seats) {
    const mine = scores[s];
    if (!mine) continue;
    let better = 0;
    for (const o of seats) { const theirs = scores[o]; if (o !== s && theirs && decide(theirs, mine) > 0) better++; }
    out[s] = better + 1;
  }
  return out;
}

/** The single best seat, or null when first place is shared or nobody has a place. */
export function winnerOf(pl: Readonly<Record<SeatId, number>>): SeatId | null {
  const firsts = Object.keys(pl).filter((s) => pl[s] === 1);
  return firsts.length === 1 ? firsts[0] ?? null : null;
}
