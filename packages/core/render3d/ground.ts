// Ground, road and (for water worlds) the causeway the road runs on (split from site/game/engine.js:449-471).
//
// The ground is one 600 m plane with soft colour patches in its vertices and a noise texture on top; the road is a
// 320 m plane whose texture scrolls; a water world lowers and polishes the ground and puts a stone base under the
// road. The textures are made from the theme and a seeded stream, so the same world has the same road grain.
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';
import type { ResourceTracker } from './dispose.ts';
import { foamPixels, makeTexture, noisePixels, roadPixels, waterNormalPixels } from './textures.ts';
import type { Theme } from './theme.ts';

export const GROUND_SIZE = 600;
export const ROAD_LENGTH = 320;
export const ROAD_CENTER_Z = -140;
/** The road texture repeats this many times along the road. */
export const ROAD_REPEATS = 12;
/** Metres of ground per repeat of the noise texture, and the noise texture's repeat count over the plane. */
export const GROUND_TILE_M = GROUND_SIZE / 60;
export const BASE_COLOR = '#7b746a';
/** Metres of sea per repeat of the ripple normal map. */
export const WATER_TILE_M = 11;
/** Width of the surf strip on each side of a causeway. */
export const FOAM_WIDTH = 2.2;

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
  /** Water worlds: the ripples drift and the surf moves with time (seconds). Nothing for dry worlds. */
  tick(dt: number): void;
  reset(): void;
}

export function buildGround(theme: Theme, tracker: ResourceTracker, roadRng: Rng, noiseRng: Rng, maxAnisotropy: number): GroundKit {
  const group = new THREE.Group();
  group.name = 'ground';

  const groundTexture = tracker.track(makeTexture(noisePixels('#ffffff', '#d8d8d8', noiseRng), { repeat: [60, 60] }));
  const groundGeo = tracker.track(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 48, 48));
  const pos = groundGeo.attributes['position'] as THREE.BufferAttribute;
  groundGeo.setAttribute('color', new THREE.BufferAttribute(groundColors(pos.array, pos.count, theme.ground, theme.groundNoise, theme.water, new Float32Array(pos.count * 3)), 3));
  // A water world's sea: glossy, with a tileable ripple normal map that drifts, so the sky and the sun glint on it.
  const ripples = theme.water ? tracker.track(makeTexture(waterNormalPixels(noiseRng), { srgb: false, repeat: [GROUND_SIZE / WATER_TILE_M, GROUND_SIZE / WATER_TILE_M] })) : null;
  const ground = new THREE.Mesh(groundGeo, tracker.track(new THREE.MeshStandardMaterial({
    vertexColors: true, map: groundTexture, roughness: theme.water ? 0.16 : 1, metalness: theme.water ? 0.05 : 0,
    ...(ripples ? { normalMap: ripples, normalScale: new THREE.Vector2(0.42, 0.42) } : {}),
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

  // Surf along both sides of the causeway: a strip of foam, densest at the stone and gone two metres out.
  let foamTex: THREE.DataTexture | null = null;
  if (theme.water) {
    foamTex = tracker.track(makeTexture(foamPixels(noiseRng), { srgb: false, repeat: [1, ROAD_LENGTH / 5] }));
    // Added light, not blended paint: grey foam blobs times a fade across the strip; black adds nothing.
    const foamMat = tracker.track(new THREE.MeshBasicMaterial({ map: foamTex, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    const g = tracker.track(new THREE.PlaneGeometry(FOAM_WIDTH, ROAD_LENGTH, 4, 1));
    const pa = g.attributes['position'] as THREE.BufferAttribute;
    const col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const u = Math.min(1, Math.max(0, pa.getX(i) / FOAM_WIDTH + 0.5));   // 0: the causeway side (clamped: 1 - u must not go below 0 in pow)
      const k = Math.pow(1 - u, 1.5) * 0.85;
      col.set([k * 0.92, k * 0.97, k], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const side of [-1, 1]) {
      const foam = new THREE.Mesh(g, foamMat);
      foam.name = 'surf';
      foam.rotation.x = -Math.PI / 2;
      // The texture's left edge is the dense side: the right strip as it is, the left one mirrored.
      foam.scale.x = side;
      foam.position.set(side * (theme.road.width / 2 + 0.6 + FOAM_WIDTH / 2), -0.56, ROAD_CENTER_Z);
      foam.renderOrder = 1;
      group.add(foam);
    }
  }
  let time = 0;

  return {
    group, ground, road, base, roadTexture, groundTexture,
    scroll(moveZ) {
      roadTexture.offset.y = wrap01(roadTexture.offset.y - moveZ / (ROAD_LENGTH / ROAD_REPEATS));
      groundTexture.offset.y = wrap01(groundTexture.offset.y - moveZ / GROUND_TILE_M);
      if (ripples) ripples.offset.y = wrap01(ripples.offset.y - moveZ / WATER_TILE_M);
      if (foamTex) foamTex.offset.y = wrap01(foamTex.offset.y - moveZ / 5);
    },
    tick(dt) {
      if (!ripples) return;
      time += dt;
      ripples.offset.x = wrap01(time * 0.011);
      if (foamTex) foamTex.offset.x = Math.sin(time * 0.9) * 0.04;
    },
    reset() { roadTexture.offset.y = 0; groundTexture.offset.y = 0; time = 0; if (ripples) ripples.offset.set(0, 0); if (foamTex) foamTex.offset.set(0, 0); },
  };
}
