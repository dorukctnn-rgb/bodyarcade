// Ground, road and (for water worlds) the causeway the road runs on (split from site/game/engine.js:449-471).
//
// The ground is one 600 m plane with soft colour patches in its vertices and a noise texture on top; the road is a
// 320 m plane whose texture scrolls; a water world lowers and polishes the ground and puts a stone base under the
// road. The textures are made from the theme and a seeded stream, so the same world has the same road grain.
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';
import type { ResourceTracker } from './dispose.ts';
import { makeTexture, noisePixels, roadPixels } from './textures.ts';
import type { Theme } from './theme.ts';

export const GROUND_SIZE = 600;
export const ROAD_LENGTH = 320;
export const ROAD_CENTER_Z = -140;
/** The road texture repeats this many times along the road. */
export const ROAD_REPEATS = 12;
/** Metres of ground per repeat of the noise texture, and the noise texture's repeat count over the plane. */
export const GROUND_TILE_M = GROUND_SIZE / 60;
export const BASE_COLOR = '#7b746a';

/** Soft patches of the two ground colours (the old engine's sine pattern); a water world uses the middle. Writes `out`. */
export function groundColors(positions: ArrayLike<number>, count: number, ground: string, groundNoise: string, water: boolean, out: Float32Array): Float32Array {
  const ga = new THREE.Color(ground), gb = new THREE.Color(groundNoise);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!, y = positions[i * 3 + 1]!;
    const nz = 0.5 + 0.5 * Math.sin(x * 0.07 + Math.sin(y * 0.05) * 2) * Math.cos(y * 0.06 + Math.sin(x * 0.04) * 2);
    const t = water ? 0.5 : nz;
    out[i * 3] = ga.r + (gb.r - ga.r) * t;
    out[i * 3 + 1] = ga.g + (gb.g - ga.g) * t;
    out[i * 3 + 2] = ga.b + (gb.b - ga.b) * t;
  }
  return out;
}

const wrap01 = (v: number): number => v - Math.floor(v);

export interface GroundKit {
  readonly group: THREE.Group;
  readonly ground: THREE.Mesh;
  readonly road: THREE.Mesh;
  /** Stone base under the road of a water world, else null. */
  readonly base: THREE.Mesh | null;
  readonly roadTexture: THREE.DataTexture;
  readonly groundTexture: THREE.DataTexture;
  /** Scrolls both textures by the distance the world moved this frame (metres). Offsets are kept in [0, 1). */
  scroll(moveZ: number): void;
  reset(): void;
}

export function buildGround(theme: Theme, tracker: ResourceTracker, roadRng: Rng, noiseRng: Rng, maxAnisotropy: number): GroundKit {
  const group = new THREE.Group();
  group.name = 'ground';

  const groundTexture = tracker.track(makeTexture(noisePixels('#ffffff', '#d8d8d8', noiseRng), { repeat: [60, 60] }));
  const groundGeo = tracker.track(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 48, 48));
  const pos = groundGeo.attributes['position'] as THREE.BufferAttribute;
  groundGeo.setAttribute('color', new THREE.BufferAttribute(groundColors(pos.array, pos.count, theme.ground, theme.groundNoise, theme.water, new Float32Array(pos.count * 3)), 3));
  const ground = new THREE.Mesh(groundGeo, tracker.track(new THREE.MeshStandardMaterial({
    vertexColors: true, map: groundTexture, roughness: theme.water ? 0.25 : 1, metalness: theme.water ? 0.15 : 0,
  })));
  ground.name = 'ground-plane';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = theme.water ? -0.6 : -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  const roadTexture = tracker.track(makeTexture(roadPixels(theme.road, roadRng), { repeat: [1, ROAD_REPEATS], anisotropy: Math.max(1, Math.min(8, maxAnisotropy)) }));
  const road = new THREE.Mesh(
    tracker.track(new THREE.PlaneGeometry(theme.road.width, ROAD_LENGTH)),
    tracker.track(new THREE.MeshStandardMaterial({ map: roadTexture, roughness: theme.road.wet ? 0.3 : 0.95, metalness: theme.road.wet ? 0.25 : 0 })),
  );
  road.name = 'road';
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, ROAD_CENTER_Z);
  road.receiveShadow = true;
  group.add(road);

  let base: THREE.Mesh | null = null;
  if (theme.water) {
    base = new THREE.Mesh(
      tracker.track(new THREE.BoxGeometry(theme.road.width + 1.2, 0.7, ROAD_LENGTH)),
      tracker.track(new THREE.MeshStandardMaterial({ color: BASE_COLOR, roughness: 0.9 })),
    );
    base.name = 'causeway';
    base.position.set(0, -0.36, ROAD_CENTER_Z);
    group.add(base);
  }

  return {
    group, ground, road, base, roadTexture, groundTexture,
    scroll(moveZ) {
      roadTexture.offset.y = wrap01(roadTexture.offset.y - moveZ / (ROAD_LENGTH / ROAD_REPEATS));
      groundTexture.offset.y = wrap01(groundTexture.offset.y - moveZ / GROUND_TILE_M);
    },
    reset() { roadTexture.offset.y = 0; groundTexture.offset.y = 0; },
  };
}
