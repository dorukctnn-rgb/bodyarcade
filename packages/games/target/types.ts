// The parts the three target-hit games share: what a plan entry is, what a lane (one player's half of the game) holds,
// and the rules object each game hands to the engine. Everything that is state is plain data (numbers, strings, arrays,
// objects), so a snapshot is one JSON.stringify away; the objects with behaviour (the judge, the envelope) are rebuilt
// from that data on restore.
import type { BodyProfile, DuelSetup, GameEvent, InputFrame, PlayerSlot, Rng, RunSummary, Side } from '../../core/types/index.ts';
import type { HitJudgement, HitTarget } from '../../core/moves/handHit.ts';
import type { Miss } from '../../core/moves/kit.ts';
import type { Call } from './coach.ts';
import type { Envelope } from './envelope.ts';
import type { Timeline } from './timeline.ts';

export type Level = 'easy' | 'normal' | 'hard' | 'expert';
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard', 'expert'];

/** The shell says easy, normal, hard and expert; the runner says medium and insane. Anything unknown is normal. */
export function levelOf(d: string): Level {
  const alias: Record<string, Level> = { medium: 'normal', insane: 'expert' };
  const k = alias[d] ?? d;
  return (LEVELS as readonly string[]).includes(k) ? (k as Level) : 'normal';
}

/** What every plan entry has: its number (its place in the plan), when it appears (ms from the first step) and how long it stays (ms). */
export interface BaseSpec { id: number; at: number; life: number }

/** A target that is on the screen for one player. */
export interface Live {
  id: number;
  /** Simulation time of appearance (ms). */
  born: number;
  /** Centre and hit radius in body space (T). Pads follow the shoulders, so the game updates the centre each step. */
  x: number;
  y: number;
  r: number;
  /** What the judge is asked, keyed by `id`. */
  crit: HitTarget;
  /** Numbers the rules keep for this target (a bag's peak lean, the grade of a hit ...). */
  v: Record<string, number>;
}

/** Why the player's last attempt failed, for the strip under the picture. A code of the movement library, or one of the game's own. */
export interface Hint {
  code: string;
  side?: Side;
  /** A number the sentence may carry (a streak, a time in ms). */
  n?: number;
  /** Simulation time at which it was set, and when it stops being shown (ms). */
  at: number;
  until: number;
}

export interface LaneStats {
  score: number;
  hits: number;
  misses: number;
  streak: number;
  bestStreak: number;
  /** Constellations or combos completed. */
  cleared: number;
  /** Pad Work timing: on the beat, near it, off it. */
  perfect: number;
  good: number;
  off: number;
  /** Reaction Tag: red lights touched and red lights left alone. */
  traps: number;
  avoided: number;
  /** Reaction times of the lights tapped, ms. */
  reactN: number;
  reactSum: number;
  reactBest: number;
  /** Simulation time (ms) the lane has been playing (a rest does not count as play). */
  playMs: number;
}

export const newStats = (): LaneStats => ({
  score: 0, hits: 0, misses: 0, streak: 0, bestStreak: 0, cleared: 0, perfect: 0, good: 0, off: 0, traps: 0, avoided: 0,
  reactN: 0, reactSum: 0, reactBest: 0, playMs: 0,
});

/** Keyboard players (no camera) steer two cursors in arm lengths from the shoulder midpoint. */
export interface CursorHand { ax: number; ay: number; vx: number; vy: number; speed: number }
export interface Cursor { L: CursorHand; R: CursorHand }

export interface HandPos { x: number; y: number; speed: number; seen: boolean }

/** Everything about one player's half of the game that must survive a snapshot. */
export interface LaneState {
  slot: PlayerSlot;
  profile: BodyProfile;
  live: Live[];
  stats: LaneStats;
  hint: Hint | null;
  /** The last pose frame time seen and the simulation time of the step that saw it first. */
  poseT: number | null;
  poseSeen: number;
  cursor: Cursor | null;
  /** Counters the rules keep (the combo in progress, a constellation's catches ...). */
  x: Record<string, number>;
  /** The latest positions of the hands, body space, for the picture. */
  hands: { L: HandPos; R: HandPos };
  /** The shoulder midpoint as last seen (body space), where pads hang. */
  shoulder: { x: number; y: number };
  /** The judge's memory (Judge.dump()), only inside snapshots. */
  judge?: unknown;
}

export interface LogEntry { t: number; kind: string; ok: boolean; v?: number; player?: PlayerSlot }

export interface PlanInput {
  level: Level;
  timeline: Timeline;
  seated: boolean;
  /** Quiet mode: nothing that stamps or lands on the floor. */
  quiet: boolean;
  /** Foot targets are possible: standing, not quiet, and every player's framing shows the floor. */
  feet: boolean;
  /** Keyboard players have no body to lean or duck with. */
  keyboard: boolean;
  players: 1 | 2;
  /** Pose rate of the slowest player; a slow device gets more time. */
  hz: number;
  /** A live race: the Room's obstacles and the match length (the plan is then made by `Rules.planDuel`). */
  duel?: DuelSetup;
}

/** What the rules may do to the game while they run. All of it lands in the events, the log, the cue queue and the hint. */
export interface Out {
  event(e: Omit<GameEvent, 't'>): void;
  log(kind: string, ok: boolean, v?: number): void;
  cue(name: string): void;
  hint(code: string, o?: { side?: Side; n?: number; ms?: number }): void;
}

/** What the rules see of a lane while they work. */
export interface LaneApi {
  readonly slot: PlayerSlot;
  readonly state: LaneState;
  readonly env: Envelope;
  readonly stats: LaneStats;
  readonly x: Record<string, number>;
  readonly ch: Readonly<Record<string, number>>;
  readonly level: Level;
  readonly seated: boolean;
  readonly quiet: boolean;
  readonly keyboard: boolean;
  /** Simulation time of this step (ms), and the round or rest it is in. */
  readonly t: number;
  readonly seg: { kind: 'play' | 'rest'; round: number; start: number; end: number };
  /** System latency taken off beat offsets and reaction times (ms). */
  readonly latencyMs: number;
  /** The pose clock's best guess of "now" (ms on the pose clock), for reaction times. */
  poseNow(): number;
  /** The simulation time a pose-clock moment (a judgement's `t`) corresponds to. */
  simOf(poseT: number): number;
}

export interface Prompt {
  /** The key of the words (target.<key>) and its variables, or already-made text. */
  key: string;
  vars?: Record<string, string | number>;
  /** The command plate's pictogram. */
  icon?: 'reach' | 'punch' | 'stand' | 'squat' | 'sideBend' | 'leanLeft';
}

export interface Rules<S extends BaseSpec> {
  readonly id: string;
  /** Rounds and breather (s) when the manifest does not say otherwise. */
  readonly rounds: number;
  readonly restSec: number;
  /** Metabolic equivalent for the honest calorie estimate (the manifest's `met` wins when given). */
  readonly met: number;
  /** The game has something to clear (a constellation, a combination): its summary says how many, otherwise `cleared` stays out of it. */
  readonly clears?: boolean;
  /** Builds the whole plan once, from the course stream; ids are the indexes. Entries are in order of `at`. */
  plan(rng: Rng, p: PlanInput): S[];
  /**
   * A game that can be raced (its manifest's modes has 'duel') makes its plan from the Room's course instead: one entry for each
   * obstacle of `d.schedule`, `at` = the obstacle's time, the same for every player, whatever their body or their level (a body only
   * decides where an entry lands inside that player's own reach: `open`). Each entry carries the obstacle's id, and the rules say how
   * it ended with `out.event({ type: 'duel', ob, k })` (core/types DuelSetup). A game without it cannot be raced.
   */
  planDuel?(rng: Rng, d: DuelSetup, p: PlanInput): S[];
  /** The coach's calls, in order of time, made with the plan from the same data (coach.ts). Games without a coach leave it out. */
  calls?(plan: readonly S[], tl: Timeline): Call[];
  /** A plan entry appears for a lane: where it is and what the judge asks. null: this lane does not get it. */
  open(spec: S, lane: LaneApi, out: Out): Live | null;
  /** Called each step before judging: pads follow the shoulders, drifting stars move. */
  follow?(spec: S, live: Live, lane: LaneApi): void;
  /** The time window (ms from the first step) in which the target is judged. After `until` it has expired. */
  span(spec: S, live: Live): { from: number; until: number };
  hit(spec: S, live: Live, j: HitJudgement, lane: LaneApi, out: Out): void;
  expire(spec: S, live: Live, miss: Miss | null, lane: LaneApi, out: Out): void;
  /** Once per step and lane, before judging: beats, windows of defence moves, round summaries. */
  tick?(lane: LaneApi, plan: readonly S[], out: Out): void;
  /** The one command on the plate right now. */
  prompt(lane: LaneApi, plan: readonly S[]): Prompt | null;
}

export type Phase = 'running' | 'over' | 'complete';

export interface StepOut { events: GameEvent[]; phase: Phase }

export interface StartInput {
  rng: Rng;
  level: Level;
  seated: boolean;
  quiet: boolean;
  /** Per player; null for a keyboard round. */
  profiles: [BodyProfile | null, (BodyProfile | null)?];
  /** A live race: one player, one continuous round of the match's length, the Room's course. */
  duel?: DuelSetup;
}

/** What a view draws. Read only. */
export interface ViewTarget {
  id: number;
  x: number;
  y: number;
  r: number;
  /** 0 just appeared, 1 about to expire. */
  age: number;
  spec: BaseSpec;
  v: Readonly<Record<string, number>>;
}

export interface ViewLane {
  slot: PlayerSlot;
  env: Envelope;
  profile: BodyProfile;
  targets: ViewTarget[];
  hands: { L: HandPos; R: HandPos };
  score: number;
  streak: number;
  keyboard: boolean;
}

export interface ViewState {
  t: number;
  phase: 'play' | 'rest' | 'done';
  round: number;
  rounds: number;
  /** Simulation time left in the current round or rest (ms). */
  left: number;
  lanes: ViewLane[];
}

export type { InputFrame, RunSummary };
