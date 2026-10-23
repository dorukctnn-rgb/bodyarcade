// Weather particles: dust, leaves, rain, snow, embers (split from site/game/engine.js:582-593 and 646-655).
//
// One Points draw call. The particles fall (or rise, for embers), sway and drift toward the camera with the world.
// What changed from the old engine:
// - the respawn position comes from a seeded stream, not Math.random (a live room sees the same weather);
// - the tier decides how many are drawn through the geometry draw range (rain at the lowest tier: 20 %), and the
//   particles beyond the range are not even moved;
// - the step is a pure function over a Float32Array, so it can be tested without a GPU.
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';
import type { ResourceTracker } from './dispose.ts';
import type { QualityTier } from './quality.ts';
import { makeTexture, spritePixels } from './textures.ts';
import type { WeatherDef } from './theme.ts';

/** The box the particles live in: x in +-X, y from 0 to TOP, z from FAR to NEAR (the camera is at z = 5.4). */
export const WEATHER_BOX = { x: 22, top: 16, far: -70, near: 8 } as const;
/** More than this many particles counts as heavy weather (rain), which the lowest tier thins hardest. */
export const HEAVY_COUNT = 400;

/** Scatter of the first positions. Pure: the same stream gives the same sky. */
export function seedParticles(p: Float32Array, n: number, rng: Rng): void {
  for (let i = 0; i < n; i++) {
    p[i * 3] = (rng() * 2 - 1) * WEATHER_BOX.x;
    p[i * 3 + 1] = rng() * WEATHER_BOX.top;
    p[i * 3 + 2] = WEATHER_BOX.far + rng() * (WEATHER_BOX.near - WEATHER_BOX.far);
  }
}

/**
 * Moves the first `n` particles by one frame. `moveZ` is how far the world scrolled toward the camera this frame
 * (metres): rain follows it at 35 %, everything else at 80 % (as the old engine did). `time` is seconds, for the sway.
 */
export function stepWeather(p: Float32Array, n: number, def: WeatherDef, dt: number, moveZ: number, time: number, rng: Rng): void {
  const fall = def.fall * dt;
  const drift = Math.sin(time * 0.7) * def.drift * dt;
  const dz = moveZ * (def.kind === 'rain' ? 0.35 : 0.8);
  const { x: bx, top, far, near } = WEATHER_BOX;
  const span = near - far;
  for (let i = 0, e = n * 3; i < e; i += 3) {
    let y = p[i + 1]! - fall;
    let z = p[i + 2]! + dz;
    p[i] = p[i]! + drift;
    if (y < 0) { y = top; p[i] = (rng() * 2 - 1) * bx; }
    else if (y > top) y = 0;
    if (z > near) z -= span;
    p[i + 1] = y;
    p[i + 2] = z;
  }
}

/** How many of a theme's particles a tier draws. */
export function drawnParticles(def: WeatherDef, tier: QualityTier): number {
  const share = def.count > HEAVY_COUNT ? tier.weatherHeavy : tier.weatherLight;
  return Math.max(1, Math.ceil(def.count * share));
}

export interface WeatherKit {
  readonly points: THREE.Points;
  /** Particles drawn at the moment (the tier's share). */
  readonly drawn: number;
  update(dt: number, moveZ: number): void;
  applyTier(tier: QualityTier): void;
}

export function createWeather(def: WeatherDef, tracker: ResourceTracker, rng: Rng, tier: QualityTier): WeatherKit {
  const n = def.count;
  const pos = new Float32Array(n * 3);
  seedParticles(pos, n, rng);
  const geo = tracker.track(new THREE.BufferGeometry());
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const rain = def.kind === 'rain';
  const mat = tracker.track(new THREE.PointsMaterial({
    color: def.color, size: def.size * (rain ? 6 : 1),
    map: tracker.track(makeTexture(spritePixels(rain ? 'streak' : 'dot'), { wrap: 'clamp' })),
    transparent: true, opacity: def.opacity, depthWrite: false, sizeAttenuation: true,
    blending: def.kind === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  const points = new THREE.Points(geo, mat);
  points.name = `weather-${def.kind}`;
  points.frustumCulled = false;

  let drawn = drawnParticles(def, tier);
  geo.setDrawRange(0, drawn);
  let time = 0;

  return {
    points,
    get drawn() { return drawn; },
    update(dt, moveZ) {
      time += dt;
      stepWeather(pos, drawn, def, dt, moveZ, time, rng);
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, drawn * 3);
      attr.needsUpdate = true;
    },
    applyTier(t) {
      drawn = drawnParticles(def, t);
      geo.setDrawRange(0, drawn);
    },
  };
}
