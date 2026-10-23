// Sets and real rests (game-design.md 0.1 item 4: short rounds, genuine rest). A round is `sets` periods of play of
// `setSec` seconds with `restSec` seconds of rest between them. Plain data, so a snapshot is a copy.
export interface RoundPlan { sets: number; setSec: number; restSec: number }

export type RoundPhase = 'play' | 'rest' | 'done';

export interface RoundState {
  phase: RoundPhase;
  /** 1-based number of the set being played or just played. */
  set: number;
  /** Seconds into the current phase. */
  t: number;
  /** Seconds of play and of rest so far (calories count only the first). */
  played: number;
  rested: number;
}

/** What a step changed: a rest began, a set began, or the round is over. */
export type RoundChange = 'rest' | 'set' | 'done' | null;

export const newRound = (): RoundState => ({ phase: 'play', set: 1, t: 0, played: 0, rested: 0 });

const EPS = 1e-9;

export function stepRound(plan: RoundPlan, s: RoundState, dt: number): RoundChange {
  if (s.phase === 'done') return null;
  s.t += dt;
  if (s.phase === 'play') {
    s.played += dt;
    if (s.t >= plan.setSec - EPS) {
      s.t = 0;
      if (s.set >= plan.sets) { s.phase = 'done'; return 'done'; }
      s.phase = plan.restSec > 0 ? 'rest' : 'play';
      if (s.phase === 'play') { s.set++; return 'set'; }
      return 'rest';
    }
    return null;
  }
  s.rested += dt;
  if (s.t >= plan.restSec - EPS) {
    s.phase = 'play';
    s.set++;
    s.t = 0;
    return 'set';
  }
  return null;
}

/** Seconds left in the current phase. */
export function phaseLeft(plan: RoundPlan, s: RoundState): number {
  if (s.phase === 'play') return Math.max(0, plan.setSec - s.t);
  if (s.phase === 'rest') return Math.max(0, plan.restSec - s.t);
  return 0;
}

/** Whole round length in seconds (play and rest), for the manifest and the tests. */
export const roundSeconds = (p: RoundPlan): number => p.sets * p.setSec + Math.max(0, p.sets - 1) * p.restSec;
