// core/loop: fixed-step clock, seeded random streams and the Session state machine.
import type { Unsubscribe } from './common.ts';
import type { RunSummary } from './game.ts';

/** The only step size Game.step ever receives (seconds). */
export const FIXED_DT = 1 / 60;

/** Seeded random stream: numbers in [0, 1). */
export type Rng = () => number;
export type RngFactory = (seed: number) => Rng;

export type PauseReason = 'user' | 'hidden' | 'person_lost' | 'camera_ended' | 'recalibrate';

export type SessionState = 'idle' | 'setup' | 'calibrating' | 'countdown' | 'running' | 'paused' | 'results' | 'error';

export interface SessionOptions {
  mode: 'solo' | 'ghost' | 'duel';
  seed?: number;
  difficulty: string;
  input: 'camera' | 'keyboard' | 'touch';
  seated: boolean;
}

export interface SessionEvents {
  state: SessionState;
  pause: PauseReason;
  frame: { fps: number };
  over: RunSummary;
  error: { code: string; message: string };
}

export interface Session {
  readonly state: SessionState;
  /** Owns the camera lease, calibration, countdown and the loop. */
  start(gameId: string, o: SessionOptions): Promise<void>;
  /** Paused frames neither render continuously nor feed the quality governor (B12). */
  pause(r: PauseReason): void;
  resume(): Promise<void>;
  /** Re-acquires a dead camera (B8). */
  recalibrate(): Promise<void>;
  /** Releases the camera lease and every game resource (B10). */
  quit(): void;
  on<K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): Unsubscribe;
}
