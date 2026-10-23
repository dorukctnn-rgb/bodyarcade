// Beat judgement for the rhythm games (game-design.md cards 25 Firework Jacks, 7 Pad Work, 28 Beat Steps, 39 Arm
// Orchestra): a movement event is Perfect within 120 ms of the beat and Good within 220 ms, after taking off the
// system latency measured in the latency calibration. Pure functions of numbers; no clock, no audio.
// Timing is in ms on the same clock as the event (`MovementEvent.t`, the pose clock); the game maps its audio clock
// to it once when the beat grid is created.

export const BEAT_WINDOWS = { perfect: 120, good: 220 } as const;

export type BeatGrade = 'perfect' | 'good' | 'miss';

export interface BeatGrid {
  /** Time of beat 0, ms. */
  firstMs: number;
  periodMs: number;
}

export const gridFromBpm = (bpm: number, firstMs = 0): BeatGrid => ({ firstMs, periodMs: 60000 / Math.max(bpm, 1) });

export const bpmOf = (grid: BeatGrid): number => 60000 / grid.periodMs;

/** Grade of an offset from the beat (ms, negative = early, positive = late); the window is symmetric. */
export function gradeOffset(offsetMs: number, windows: { perfect: number; good: number } = BEAT_WINDOWS): BeatGrade {
  const d = Math.abs(offsetMs);
  return d <= windows.perfect ? 'perfect' : d <= windows.good ? 'good' : 'miss';
}

export interface BeatJudgement {
  grade: BeatGrade;
  /** Index of the nearest beat (0 is `firstMs`; can be negative before it). */
  beat: number;
  /** Event time minus latency minus the beat time, ms: negative = early. */
  offsetMs: number;
}

/**
 * Judges one event against the grid. The latency is how long after the body moved the event arrives (camera, pose
 * model, filter); it is taken off first, so a player on the beat reads about 0.
 * With `maxBeat` the nearest beat is clamped to 0..maxBeat (a short song).
 */
export function judgeOnGrid(tMs: number, grid: BeatGrid, latencyMs = 0, windows = BEAT_WINDOWS, maxBeat = Infinity): BeatJudgement {
  const moved = tMs - latencyMs;
  const beat = Math.min(Math.max(Math.round((moved - grid.firstMs) / grid.periodMs), 0), maxBeat);
  const offsetMs = moved - (grid.firstMs + beat * grid.periodMs);
  return { grade: gradeOffset(offsetMs, windows), beat, offsetMs };
}

/** Beat times in [fromMs, toMs): for the game to schedule its cues. */
export function beatTimes(grid: BeatGrid, fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  const first = Math.max(0, Math.ceil((fromMs - grid.firstMs) / grid.periodMs));
  for (let i = first; grid.firstMs + i * grid.periodMs < toMs; i++) out.push(grid.firstMs + i * grid.periodMs);
  return out;
}

/** Share of events graded Perfect or Good, 0..1 (0 for none): a quality figure for the results screen. */
export function onBeatShare(grades: readonly BeatGrade[]): number {
  return grades.length ? grades.filter((g) => g !== 'miss').length / grades.length : 0;
}
