// games: the one contract every template implements (runner, flight, target, rhythm, strength, gate, balance, duel).
import type { BodyProfile, Framing, HeadroomNeed } from './body.ts';
import type { LocalizedString, Ms } from './common.ts';
import type { InputFrame, InputHub, KeyMap, TouchMap } from './input.ts';
import type { Rng } from './loop.ts';
import type { DetectorSpec } from './moves.ts';
import type { PoseService } from './pose.ts';
import type { AudioApi, Scene2D, Scene3D } from './render.ts';
import type { Namespace } from './store.ts';
import type { PlayerSlot } from './players.ts';

export type TemplateId = 'runner' | 'flight' | 'target' | 'rhythm' | 'strength' | 'gate' | 'balance' | 'duel';

export type BodyRegion = 'legs' | 'arms' | 'chest-back' | 'core' | 'cardio' | 'mobility' | 'seated';

/** 'local2': two players, one camera, one screen (web on big screens). A game lists it only if it supports it. */
export type GameMode = 'solo' | 'ghost' | 'duel' | 'local2';

/** One manifest.json per game feeds the menu, the paywall, the SEO page, the sitemap and the store text. */
export interface GameManifest {
  id: string;
  template: TemplateId;
  version: number;
  title: LocalizedString;
  regions: BodyRegion[];
  framing: Framing;
  /**
   * What the game needs above the player's head. 'arms-up': the hands go overhead (Summit Climb), so the calibration asks
   * the player to raise both hands once and checks the picture holds them (BodyProfile.headroom says how it went).
   * Absent: no check.
   */
  headroom?: HeadroomNeed;
  seated: boolean;
  lowImpact: boolean;
  /** Playable in quiet mode (no jumping or stamping; game-design.md 0.1 item 6). */
  silentSafe: boolean;
  durationSec: number;
  /** MET table entry for honest calories (B22). */
  met: number;
  detectors: DetectorSpec[];
  free: boolean;
  /** A page generated from the manifest may only mention these modes (rule 8). */
  modes: GameMode[];
  /** Minimum pose rate for a fair game (fast full-body games: 15). */
  minPoseHz?: number;
  seo: { slug: string; keywords: string[] };
}

/**
 * A live race (mode 'duel'): the Room fixes WHEN the obstacles of the match arrive (the same list for every player, a pure
 * function of the match's seed and length: makeSchedule in core/net), the game fixes what each one looks like from its
 * own seed and the obstacle's id. A game that can be raced (its manifest's `modes` has 'duel') keeps three promises:
 *   1. the obstacle with id n arrives `schedule[..].t` ms into the play, whatever the player does;
 *   2. when an obstacle is settled it puts { type: 'duel', ob, k: 'pass' | 'hit' } among the events of that step;
 *   3. it completes `durationMs` of play after the start.
 * The shell holds the game back until the Room's match time zero and keeps its play time in step with the Room's.
 */
export interface DuelSetup {
  schedule: readonly { id: number; t: number }[];
  durationMs: number;
}

export interface StartOptions {
  seed: number;
  difficulty: string;
  seated: boolean;
  mode: GameMode;
  profile: BodyProfile | null;
  /** Mode 'local2': each player's calibration (profile is then Player 1's). */
  profiles?: Partial<Record<PlayerSlot, BodyProfile>>;
  /** The world (theme id) the player chose, for games with worlds; a game picks one itself when it is missing. */
  world?: string;
  /** Mode 'duel' only: the obstacles of the match and its length. */
  duel?: DuelSetup;
}

export type GameEvent = { type: string; t: Ms; [k: string]: unknown };

export interface StepResult { events: GameEvent[]; phase: 'running' | 'over' | 'complete' }

export interface RunSummary {
  score: number;
  seconds: number;
  reps?: number;
  cleared?: number;
  hits?: number;
  bestStreak?: number;
  quality?: number;
  /** MET x seconds; calories are derived from it and the player's weight, never invented. */
  metSeconds: number;
  /** Lets a room recompute the score (tech.md 2.7). `t` is simulation time in ms. */
  log: { t: Ms; kind: string; ok: boolean; v?: number; player?: PlayerSlot }[];
  /** Mode 'local2': each player's result (co-op games may give both the same score). */
  players?: Partial<Record<PlayerSlot, { score: number; reps?: number; hits?: number; cleared?: number; metSeconds: number }>>;
}

export interface Hud {
  set(slot: HudSlot, v: string | number | { icon: string; text: string; progress?: number }): void;
  /** One polite live region (B17); per-obstacle prompts stay silent. */
  announce(text: string, o?: { assertive?: boolean }): void;
  toast(text: string): void;
}

export type HudSlot = 'score' | 'timer' | 'lives' | 'combo' | 'prompt' | 'hint';

export interface GameContext {
  pose: PoseService;
  input: InputHub;
  hud: Hud;
  audio: AudioApi;
  store: Namespace;
  scene2d?: Scene2D;
  scene3d?: Scene3D;
  /** Separate streams: cosmetics never shift the course. */
  rng(stream: 'course' | 'fx'): Rng;
  flags: { reducedMotion: boolean; silent: boolean; seated: boolean };
  t(key: string, vars?: Record<string, string | number>): string;
}

export interface Game {
  readonly manifest: GameManifest;
  init(ctx: GameContext): Promise<void>;
  start(o: StartOptions): void;
  // PURE: no DOM, no Date.now(), no Math.random(); randomness only from ctx.rng('course') and ctx.rng('fx').
  // dt is always FIXED_DT, so the same seed and the same input log give the same result on any machine.
  step(dt: number, input: InputFrame): StepResult;
  /** Interpolated draw; never mutates simulation state. alpha is 0..1 between the last two steps. */
  render(alpha: number): void;
  /** Pause, ghost, rematch, netcode. restore(snapshot()) must give an identical continuation. */
  snapshot(): unknown;
  restore(s: unknown): void;
  summary(): RunSummary;
  /** Releases every GPU and DOM object created in init and start (B5). */
  dispose(): void;
}

/** What a game folder exports, so the catalogue can list games without creating them. */
export interface GameModule {
  manifest: GameManifest;
  create(): Game;
  /**
   * Keys and swipes for keyboard and touch play. The session binds them to the page (keys) and the play area
   * (touch) for the length of a run; games never add their own key or pointer listeners.
   */
  controls?: { keys?: KeyMap; touch?: TouchMap };
}
