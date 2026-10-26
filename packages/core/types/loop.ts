// core/loop: fixed-step clock, seeded random streams and the Session state machine.
import type { CalibrationStatus, FramingProfile, HeadroomState, ProfileSupport } from './body.ts';
import type { Unsubscribe } from './common.ts';
import type { RunSummary } from './game.ts';
import type { PlayerSlot, TwoPlayerCalibrationStatus } from './players.ts';

/** The only step size Game.step ever receives (seconds). */
export const FIXED_DT = 1 / 60;

/** Seeded random stream: numbers in [0, 1). */
export type Rng = () => number;
export type RngFactory = (seed: number) => Rng;

/** 'player_lost': mode 'local2', one of the two players left the frame ("Player 2, step back in"). */
export type PauseReason = 'user' | 'hidden' | 'person_lost' | 'player_lost' | 'camera_ended' | 'recalibrate';

export type SessionState = 'idle' | 'setup' | 'calibrating' | 'countdown' | 'running' | 'paused' | 'results' | 'error';

export interface SessionOptions {
  /** 'local2': two players side by side in front of one camera (only when Capabilities.local2 is true). */
  mode: 'solo' | 'ghost' | 'duel' | 'local2';
  seed?: number;
  difficulty: string;
  input: 'camera' | 'keyboard' | 'touch';
  seated: boolean;
  /** The world (theme id) the player chose, passed on to Game.start. */
  world?: string;
}

/**
 * How the calibration ended, once, right before the countdown. `profile` is what the camera measured (in mode 'local2' the
 * lower of the two players'), `supports` the game kinds it runs. `outcome` 'fallback': the game wanted more than was
 * measured (the full body at a desk), and `seated` says the run now plays the game's seated variant, so the screen
 * can say so ("Masa modu").
 */
export interface ProfileEvent {
  profile: FramingProfile;
  outcome: 'measured' | 'fallback';
  seated: boolean;
  supports: ProfileSupport;
  /** A game with manifest.headroom: how the hands-up check ended ('short' if either player's was; absent for other games). */
  headroom?: HeadroomState;
}

export interface SessionEvents {
  state: SessionState;
  pause: PauseReason;
  frame: { fps: number };
  over: RunSummary;
  /**
   * `code` is a SessionErrorCode or a camera code ('denied', 'not_found', 'in_use' ...): the screen translates it.
   * `message` is empty unless the shell's own factory threw text in the player's language (a scene that cannot be
   * drawn); the platform puts no words in it. `detail` is the developer's English for logs and tests, never for a player.
   */
  error: { code: string; message: string; detail?: string };
  /** How the calibration ended (profile, fallback, seated). */
  profile: ProfileEvent;
  /** Mode 'local2': a player left or came back. */
  player: { player: PlayerSlot; present: boolean };
  /** Every pose frame while calibrating, for the setup screen (two-player status in mode 'local2'). */
  calibration: CalibrationStatus | TwoPlayerCalibrationStatus;
  /** Whole seconds left: 3, 2, 1, then 0 when play starts (or continues after a pause). */
  countdown: { remaining: number };
  /**
   * The camera picture for the self view: the playing video element once the camera runs, null when it is released
   * (results, quit, a dead camera). Show it mirrored; never record or send it.
   */
  video: { el: HTMLVideoElement | null };
}

export interface Session {
  readonly state: SessionState;
  /** Why the session is paused; null in every other state. */
  readonly pauseReason: PauseReason | null;
  /** Owns the camera lease, calibration, countdown and the loop. */
  start(gameId: string, o: SessionOptions): Promise<void>;
  /** Paused frames neither render continuously nor feed the quality governor (B12). */
  pause(r: PauseReason): void;
  resume(): Promise<void>;
  /** Re-acquires a dead camera (B8). */
  recalibrate(): Promise<void>;
  /**
   * "Play at the desk" / "play on" while calibrating: ends the calibration with what the camera measures now (head and
   * shoulders is enough, and a full-body game then plays its seated variant) and skips the hands-up check of a game with
   * headroom. Does nothing when there is no steady spell to take yet, or when the game cannot run on what is measured (a
   * game without a seated variant). Optional on the interface so wrappers written before it existed still type-check;
   * the session itself always has it.
   */
  playAtDesk?(): void;
  /** Releases the camera lease and every game resource (B10). */
  quit(): void;
  on<K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): Unsubscribe;
}
