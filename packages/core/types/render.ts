// Rendering and audio kits (owned by the render builder): the parts other modules depend on.
import type { Vec2 } from './common.ts';

export type QualityLevel = 0 | 1 | 2;

export interface QualityGovernor {
  // Averages over 90 non-paused frames, updates its timestamp on EVERY change, uses a hysteresis band (B11, B12).
  /** Returns the new level when it changes, else null. Paused frames are ignored. */
  sample(frameMs: number, o: { paused: boolean }): QualityLevel | null;
  readonly level: QualityLevel;
}

/**
 * A world theme (sky, palette, scenery, weather). Placeholder: the render builder owns the real schema
 * (games/runner/content/worlds.json is validated against it).
 */
export interface ThemeData {
  id: string;
  [key: string]: unknown;
}

export interface Scene3D {
  /** Disposes the previous theme's geometry, materials and textures. */
  setTheme(t: ThemeData): void;
  resize(): void;
  applyLevel(l: QualityLevel): void;
  dispose(): void;
  /** The e2e leak test reads this (B5): after 5 sessions within 10% of session 1 (rule 2). */
  stats(): { geometries: number; textures: number; drawCalls: number };
}

export interface Scene2D {
  mirror: {
    show(o: { silhouette: boolean; skeleton: boolean }): void;
    /** Body space (see types/body.ts) to canvas pixels, with the current profile and camera framing. */
    project(v: Vec2): Vec2;
  };
  ctx: CanvasRenderingContext2D;
  resize(): void;
  dispose(): void;
}

export interface AudioClock {
  /** Seconds on the AudioContext clock. */
  now(): number;
  schedule(t: number, cb: () => void): void;
  /** Measured output latency, for rhythm judging. */
  latencyMs: number;
}

export interface AudioApi {
  /** Creates the AudioContext lazily on the first user gesture. */
  unlock(): void;
  play(name: string): void;
  clock(): AudioClock;
}
