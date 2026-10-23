// Quality tiers and the governor that moves between them (graphics-maps.md 3.3 and 3.8; audit B11 and B12).
//
// The old engine (site/game/engine.js:702-711) updated its "last change" time only when quality went UP, so a drop
// could be followed at once by a rise (8 level changes in 70 s under a 10x throttle), and it sampled 1000 fps
// while paused, so quality rose during a pause. This governor:
// - averages 90 non-paused frames (30 for the first look and for a level it has just risen to),
// - ignores paused frames completely, and the first frames after a pause or a level change (they stall),
// - stamps EVERY change, and keeps a band between the drop threshold and the rise threshold (hysteresis),
// - rises only after three clean windows, 20 s after the last change, and not within a hold time after a drop;
//   a level that failed twice after a rise is given up for the rest of the session.
import type { QualityGovernor, QualityLevel } from '../types/index.ts';

export interface QualityTier {
  level: QualityLevel;
  label: 'T0' | 'T1' | 'T2';
  /** Upper bound for devicePixelRatio. Resolution is the biggest lever (DPR 1.6 to 1.0 cuts 36 to 52 %). */
  pixelRatioCap: { mobile: number; desktop: number };
  /** off: no shadow map at all (blob shadows instead); actors: runner and obstacles; actors+trees: also nearby trees. */
  shadows: 'off' | 'actors' | 'actors+trees';
  /** 0 when there is no shadow map. 1024 is plenty for an 18 x 28 m shadow camera (1.8 to 2.7 cm per texel). */
  shadowMapSize: number;
  propMaterial: 'lambert' | 'standard';
  /** Share of the weather particles that are drawn: heavy weather (rain: more than 400 particles) and the rest. */
  weatherHeavy: number;
  weatherLight: number;
  /** Share of the grass tufts, the densest prop. */
  tuftShare: number;
  fpsCap: 30 | 60;
  blobShadows: boolean;
}

/** Index = QualityLevel. T3 (desktop dGPU, 2048 map) of graphics-maps.md is not part of the contract. */
export const QUALITY_TIERS: readonly [QualityTier, QualityTier, QualityTier] = [
  { level: 0, label: 'T0', pixelRatioCap: { mobile: 1, desktop: 1 }, shadows: 'off', shadowMapSize: 0, propMaterial: 'lambert', weatherHeavy: 0.2, weatherLight: 0.4, tuftShare: 0.5, fpsCap: 30, blobShadows: true },
  { level: 1, label: 'T1', pixelRatioCap: { mobile: 1.25, desktop: 1.25 }, shadows: 'actors', shadowMapSize: 1024, propMaterial: 'lambert', weatherHeavy: 1, weatherLight: 1, tuftShare: 0.5, fpsCap: 60, blobShadows: false },
  { level: 2, label: 'T2', pixelRatioCap: { mobile: 1.6, desktop: 2 }, shadows: 'actors+trees', shadowMapSize: 1024, propMaterial: 'standard', weatherHeavy: 1, weatherLight: 1, tuftShare: 1, fpsCap: 60, blobShadows: false },
];

export function tierFor(level: QualityLevel): QualityTier {
  const i = Math.min(2, Math.max(0, Math.round(level)));
  return QUALITY_TIERS[i as 0 | 1 | 2];
}

export interface GovernorOptions {
  /** Starting level. Default 2. */
  level?: QualityLevel;
  /** Frames averaged per decision. Default 90. */
  windowFrames?: number;
  /** Frames averaged for the first look at a session and for a level just risen to. Default 30. */
  quickFrames?: number;
  /** Mean frame time above this (about 42 fps) drops a level. Default 24 ms. */
  downMs?: number;
  /** Mean frame time below this (about 57 fps) counts as a clean window. Default 17.5 ms. */
  upMs?: number;
  /** Clean windows needed before a rise. Default 3. */
  cleanWindows?: number;
  /** Quiet time after any change before a rise. Default 20 s. */
  minRiseGapMs?: number;
  /** Quiet time after any change before a further drop (probation drops are exempt). Default 4 s. */
  minDropGapMs?: number;
  /** Hold after a drop before the next rise. Default 90 s. */
  holdAfterDropMs?: number;
  /** Hold after a rise that failed (dropped again at once). Default 120 s; the second failure gives the level up. */
  holdAfterFailedRiseMs?: number;
  /** Frames ignored after a change, a pause or the start. Default 12 (6 at the start). */
  settleFrames?: number;
  /** One frame counts for at most this much (a 2.6 s shader compile must not drop a level). Default 100 ms. */
  maxFrameMs?: number;
}

export interface GovernorStats {
  level: QualityLevel;
  /** Level changes made by the governor (set() included). */
  changes: number;
  /** Non-paused frames that entered a window. */
  frames: number;
  /** Windows decided so far. */
  windows: number;
  /** Mean frame time of the last decided window, ms. */
  meanMs: number;
  /** Time on the governor's own clock (sum of the counted frame times), ms. */
  clockMs: number;
  /** Highest level still allowed. */
  ceiling: QualityLevel;
}

export interface QualityGovernorKit extends QualityGovernor {
  /** Forces a level (Settings: Low, Medium, High). Starts a fresh window. False when the level is already set. */
  set(level: QualityLevel): boolean;
  /** Forgets everything (a new session). */
  reset(level?: QualityLevel): void;
  stats(): GovernorStats;
}

const clampLevel = (l: number): QualityLevel => Math.min(2, Math.max(0, Math.round(l))) as QualityLevel;

export function createQualityGovernor(options: GovernorOptions = {}): QualityGovernorKit {
  const o = {
    windowFrames: 90, quickFrames: 30, downMs: 24, upMs: 17.5, cleanWindows: 3,
    minRiseGapMs: 20_000, minDropGapMs: 4_000, holdAfterDropMs: 90_000, holdAfterFailedRiseMs: 120_000,
    settleFrames: 12, maxFrameMs: 100,
    ...options,
  };
  const startSettle = Math.min(6, o.settleFrames);

  let level: QualityLevel = clampLevel(options.level ?? 2);
  let clockMs = 0;
  let lastChangeMs = 0;
  let noRiseUntilMs = 0;
  let ceiling: QualityLevel = 2;
  const failedRises = [0, 0, 0];
  let window: number[] = [];
  let sum = 0;
  let settle = startSettle;
  let clean = 0;
  let quick = true;         // the first window of a session and the first after a rise are short
  let probation = false;    // we have just risen: a drop now means the rise failed
  let wasPaused = false;
  let changes = 0, frames = 0, windows = 0, lastMean = 0;

  const freshWindow = (): void => { window = []; sum = 0; };

  function change(next: QualityLevel, rising: boolean): void {
    level = next;
    changes++;
    lastChangeMs = clockMs;
    settle = o.settleFrames;
    clean = 0;
    freshWindow();
    quick = rising;       // a level just risen to is checked quickly; a level just dropped to gets a full window
    probation = rising;
  }

  function decide(mean: number): QualityLevel | null {
    windows++;
    lastMean = mean;
    const wasProbation = probation;
    probation = false;
    quick = false;
    if (mean > o.downMs) {
      clean = 0;
      if (level === 0) return null;
      if (!wasProbation && changes > 0 && clockMs - lastChangeMs < o.minDropGapMs) return null;   // too soon after the last change: look again
      const from = level;
      if (wasProbation) {
        failedRises[from] = (failedRises[from] ?? 0) + 1;
        noRiseUntilMs = clockMs + o.holdAfterFailedRiseMs;
        if ((failedRises[from] ?? 0) >= 2) ceiling = clampLevel(from - 1);
      } else {
        noRiseUntilMs = Math.max(noRiseUntilMs, clockMs + o.holdAfterDropMs);
      }
      const next = clampLevel(level - 1);
      change(next, false);
      return next;
    }
    if (mean < o.upMs) {
      if (level >= ceiling || level >= 2) { clean = 0; return null; }
      clean++;
      if (clean >= o.cleanWindows && clockMs - lastChangeMs >= o.minRiseGapMs && clockMs >= noRiseUntilMs) {
        const next = clampLevel(level + 1);
        change(next, true);
        return next;
      }
      return null;
    }
    clean = 0;   // inside the band: hold
    return null;
  }

  return {
    get level(): QualityLevel { return level; },

    sample(frameMs: number, p: { paused: boolean }): QualityLevel | null {
      if (p.paused) { wasPaused = true; return null; }
      if (!Number.isFinite(frameMs) || frameMs <= 0) return null;
      if (wasPaused) { wasPaused = false; settle = o.settleFrames; clean = 0; freshWindow(); }
      const ms = Math.min(frameMs, o.maxFrameMs);
      clockMs += ms;
      if (settle > 0) { settle--; return null; }
      frames++;
      window.push(ms);
      sum += ms;
      const need = quick ? o.quickFrames : o.windowFrames;
      if (window.length < need) return null;
      const mean = sum / window.length;
      freshWindow();
      return decide(mean);
    },

    set(l: QualityLevel): boolean {
      const next = clampLevel(l);
      if (next === level) return false;
      level = next;
      changes++;
      lastChangeMs = clockMs;
      noRiseUntilMs = 0;
      ceiling = 2;
      failedRises.fill(0);
      settle = o.settleFrames;
      clean = 0;
      quick = false;
      probation = false;
      freshWindow();
      return true;
    },

    reset(l?: QualityLevel): void {
      level = clampLevel(l ?? level);
      clockMs = 0; lastChangeMs = 0; noRiseUntilMs = 0; ceiling = 2; failedRises.fill(0);
      freshWindow(); settle = startSettle; clean = 0; quick = true; probation = false; wasPaused = false;
      changes = 0; frames = 0; windows = 0; lastMean = 0;
    },

    stats(): GovernorStats {
      return { level, changes, frames, windows, meanMs: lastMean, clockMs, ceiling };
    },
  };
}

export interface InitialLevelHints {
  /** The WebGL renderer is software (SwiftShader, llvmpipe, Basic Render Driver). */
  softwareRenderer?: boolean;
  mobile?: boolean;
  cores?: number;
  /** 0..3 from a GPU benchmark table (graphics-maps.md 3.3 names @pmndrs/detect-gpu); optional. */
  gpuTier?: number;
  /** Median pose inference time measured while calibrating. Over 25 ms means the pose model needs the whole GPU. */
  poseMedianMs?: number;
  /** The level this device settled on last time (the shell keeps it in its settings). */
  stored?: QualityLevel | null;
}

/** First guess before any frame has been timed. The governor corrects it within the first seconds. */
export function initialQualityLevel(h: InitialLevelHints): QualityLevel {
  if (h.softwareRenderer) return 0;
  if (h.poseMedianMs !== undefined && h.poseMedianMs > 25) return 0;
  if (h.stored === 0 || h.stored === 1 || h.stored === 2) return h.stored;
  if (h.gpuTier !== undefined && Number.isFinite(h.gpuTier)) return h.gpuTier <= 1 ? 0 : h.gpuTier === 2 ? 1 : 2;
  const cores = h.cores;
  if (h.mobile) return cores === undefined ? 1 : cores >= 6 ? 1 : 0;
  return cores !== undefined && cores >= 8 ? 2 : 1;
}
