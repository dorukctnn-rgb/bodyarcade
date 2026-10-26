// Scenery along the road, in 40 m slices (split from site/game/engine.js:538-593; graphics-maps.md 3.7 and fix 5).
//
// The old engine built two 160 m chunks with one InstancedMesh per prop kind each, drew both whole, and used
// Math.random in the geometry. Here:
// - the world is a ring of 40 m slices that scroll toward the camera and are recycled behind it; every prop kind has
//   one InstancedMesh per slice and all slices share one geometry per kind (a world uploads each shape once);
// - a slice whose near edge is further than the fog hides it: fog 1 - exp(-(density * d)^2) passes 98.5 % at
//   2.05 / density metres, and the measured picture difference from hiding the far part was 0.00-0.14 / 255 on
//   all ten worlds, for 10-28 % fewer triangles; slices also give three.js real frustum culling;
// - positions are a pure function of (seed, prop, side, lattice index): the same course distance shows the same
//   trees in every browser and for both players of a live room, and nothing needs to be stored or generated ahead;
// - a recycled slice only rewrites its instance matrices (no new geometry, no new texture, nothing to dispose).
import * as THREE from 'three';
import { streamSeed, rngStream } from '../loop/rng.ts';
import type { ResourceTracker } from './dispose.ts';
import type { QualityTier } from './quality.ts';
import { buildProp, extraKind, propStyle, variantsOf, type PropBuildKind } from './props.ts';
import { triangleCount } from './geometry.ts';
import type { PropDef, Theme } from './theme.ts';


export const SLICE_LEN = 40;
/** Fog opacity at the cut distance is 1 - exp(-FOG_CUT^2) = 98.5 %. */
export const FOG_CUT = 2.05;
/** Slices stay until they are wholly behind the camera by this much (the camera sits at z = 5.4). */
export const CAMERA_Z = 5.4;

/** Distance (metres) beyond which FogExp2 with this density hides at least 98.5 % of a surface. */
export function fogCutDistance(density: number): number { return FOG_CUT / density; }

/** FogExp2 opacity at distance d. */
export function fogAt(density: number, d: number): number { const x = density * d; return 1 - Math.exp(-x * x); }

/** How many slices the ring needs for a theme: enough that its far end is beyond the fog cut. */
export function ringSize(theme: Theme): number { return Math.ceil(fogCutDistance(theme.fog.density) / SLICE_LEN) + 1; }

/** A stateless random number in [0, 1) from five integers (murmur-style mixing). Same inputs, same number, anywhere. */
export function hash01(seed: number, a: number, b: number, c: number, k: number): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ Math.imul(c + 13, 0xc2b2ae35) ^ Math.imul(k + 31, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface Placement {
  /** Metres along the course from its start (always positive; the world is built toward negative z). */
  dist: number;
  x: number;
  scale: number;
  /** Turn about the vertical axis, radians. */
  ry: number;
  /** Which of the kind's variants (buildings have three). */
  variant: number;
}

/** Instances this prop definition can put into one slice, at most (the capacity of its InstancedMesh). */
export function sliceCapacity(def: PropDef): number { return 2 * (Math.ceil(SLICE_LEN / def.every) + 1); }

/**
 * The prop at lattice index j on one side (side -1 left, +1 right), or null when `fixed` rules say nothing stands there.
 * Random props sit anywhere in the first 60 % of their interval (as the old code did); fixed rows sit in the middle.
 */
export function placement(def: PropDef, defIndex: number, seed: number, side: -1 | 1, j: number, out: Placement): Placement {
  const sd = side < 0 ? 0 : 1;
  const h = (k: number): number => hash01(seed, defIndex, sd, j, k);
  const variants = variantsOf(def.kind);
  out.variant = variants > 1 ? Math.min(variants - 1, Math.floor(h(5) * variants)) : 0;
  if (def.fixed) {
    out.dist = (j + 0.5) * def.every;
    out.x = side * def.side[0];
    out.scale = def.scale[0];
    out.ry = def.kind === 'lamp' ? (side < 0 ? Math.PI : 0) : 0;
    return out;
  }
  out.dist = j * def.every + h(1) * def.every * 0.6;
  out.x = side * (def.side[0] + h(2) * (def.side[1] - def.side[0]));
  out.scale = def.scale[0] + h(3) * (def.scale[1] - def.scale[0]);
  out.ry = def.kind === 'lamp' ? (side < 0 ? Math.PI : 0) : def.kind === 'building' ? Math.floor(h(4) * 4) * Math.PI / 2 : h(4) * Math.PI * 2;
  return out;
}

/** Lattice indices that can land inside the course range [start, start + len) for a definition. */
export function latticeRange(def: PropDef, start: number, len: number): [number, number] {
  const lo = Math.max(0, Math.floor((start - 0.6 * def.every) / def.every));
  const hi = Math.floor((start + len) / def.every);
  return [lo, hi];
}

export type MaterialFamily = 'lit' | 'ice' | 'unlit';

/** The three materials a world's props are drawn with. Lit props change with the quality tier (Lambert or Standard). */
export function makePropMaterials(kind: QualityTier['propMaterial']): Record<MaterialFamily, THREE.Material> {
  const lit = kind === 'lambert'
    ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const ice = kind === 'lambert'
    ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1 });
  const unlit = new THREE.MeshBasicMaterial({ vertexColors: true });
  return { lit, ice, unlit };
}

interface SliceMesh {
  main: THREE.InstancedMesh;
  extra: THREE.InstancedMesh | null;
  def: PropDef;
  defIndex: number;
  variant: number;
  family: MaterialFamily;
  extraFamily: MaterialFamily | null;
  castsShadow: boolean;
  trisPerInstance: number;
}

interface Slice {
  group: THREE.Group;
  serial: number;
  meshes: SliceMesh[];
}

export interface SceneryStats {
  slices: number;
  visibleSlices: number;
  /** Instances in the visible slices. */
  instances: number;
  /** Triangles those instances draw (one colour pass; shadow passes draw more). */
  triangles: number;
  /** Draw calls the scenery costs this frame (visible slices x non-empty meshes), before shadows. */
  drawCalls: number;
}

export interface SceneryKit {
  readonly root: THREE.Group;
  /** Metres of course covered so far. */
  readonly distance: number;
  /** Fog cut distance of this theme, metres. */
  readonly cut: number;
  /** Moves the world to a course distance (metres) and recycles, fills and hides slices. Call every frame. */
  update(distance: number, cameraZ?: number): void;
  /** Back to the start of the course (a new run in the same world): refills the first slices. */
  reset(): void;
  /** A quality tier: material family, shadow casting and tuft thinning. Cheap; refills only if the thinning changed. */
  applyTier(tier: QualityTier): void;
  stats(): SceneryStats;
}

export interface SceneryOptions {
  /** Seed of the course scenery (a live room shares it). */
  seed?: number;
  tier: QualityTier;
}

/** Builds the slice ring of a theme. Geometry, materials and instance buffers go to `tracker`. */
export function createScenery(theme: Theme, tracker: ResourceTracker, options: SceneryOptions): SceneryKit {
  const root = new THREE.Group();
  root.name = 'scenery';
  const seed = streamSeed(options.seed ?? 0, `scenery:${theme.id}`);
  const cut = fogCutDistance(theme.fog.density);
  const ring = ringSize(theme);
  let tier = options.tier;
  let materials = makePropMaterials(tier.propMaterial);
  for (const m of Object.values(materials)) tracker.track(m);
  let tuftShare = tier.tuftShare;

  // One geometry per (kind, variant) and per extra, shared by every slice.
  const geoOf = new Map<string, THREE.BufferGeometry>();
  const geometry = (kind: PropBuildKind, variant: number, tint: string | null, snow: boolean, defIndex: number): THREE.BufferGeometry => {
    const key = `${defIndex}:${kind}:${variant}`;
    let g = geoOf.get(key);
    if (!g) {
      g = tracker.track(buildProp(kind, { tint, snow, variant }, rngStream(seed, `geo:${key}`)));
      geoOf.set(key, g);
    }
    return g;
  };

  const family = (k: PropBuildKind): MaterialFamily => propStyle(k).material;
  const slices: Slice[] = [];
  const shadowFor = (k: PropBuildKind): boolean => propStyle(k).shadow === 'tree' && tier.shadows === 'actors+trees';

  for (let i = 0; i < ring; i++) {
    const group = new THREE.Group();
    group.name = `slice-${i}`;
    const meshes: SliceMesh[] = [];
    theme.props.forEach((def, defIndex) => {
      const cap = sliceCapacity(def);
      const ex = extraKind(def.kind);
      for (let v = 0; v < variantsOf(def.kind); v++) {
        const geo = geometry(def.kind, v, def.tint, def.snow, defIndex);
        const fam = family(def.kind);
        const main = new THREE.InstancedMesh(geo, materials[fam], cap);
        main.count = 0;
        main.castShadow = shadowFor(def.kind);
        main.receiveShadow = false;
        main.matrixAutoUpdate = false;
        main.name = `${def.kind}${v ? `-${v}` : ''}`;
        group.add(main);
        let extra: THREE.InstancedMesh | null = null;
        let extraFam: MaterialFamily | null = null;
        if (ex) {
          extraFam = family(ex);
          extra = new THREE.InstancedMesh(geometry(ex, v, null, false, defIndex), materials[extraFam], cap);
          extra.count = 0;
          extra.castShadow = false;
          extra.matrixAutoUpdate = false;
          extra.name = `${ex}${v ? `-${v}` : ''}`;
          group.add(extra);
        }
        meshes.push({ main, extra, def, defIndex, variant: v, family: fam, extraFamily: extraFam, castsShadow: shadowFor(def.kind), trisPerInstance: triangleCount(geo) + (extra ? triangleCount(extra.geometry) : 0) });
      }
    });
    tracker.trackObject(group);
    root.add(group);
    slices.push({ group, serial: i, meshes });
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const place: Placement = { dist: 0, x: 0, scale: 1, ry: 0, variant: 0 };

  function fill(slice: Slice, serial: number): void {
    slice.serial = serial;
    const start = serial * SLICE_LEN;
    for (const sm of slice.meshes) {
      const { def, defIndex } = sm;
      const variants = variantsOf(def.kind);
      const [lo, hi] = latticeRange(def, start, SLICE_LEN);
      const thin = def.kind === 'tuft' && tuftShare < 1;
      let count = 0;
      const cap = sm.main.instanceMatrix.count;
      for (const side of [-1, 1] as const) {
        for (let j = lo; j <= hi && count < cap; j++) {
          placement(def, defIndex, seed, side, j, place);
          if (place.dist < start || place.dist >= start + SLICE_LEN) continue;
          if (variants > 1 && place.variant !== sm.variant) continue;
          if (thin && hash01(seed, defIndex, side < 0 ? 0 : 1, j, 99) >= tuftShare) continue;
          const y = theme.water && def.kind === 'buoy' ? -0.5 : 0;
          pos.set(place.x, y, -(place.dist - start));
          q.setFromAxisAngle(yAxis, place.ry);
          sc.setScalar(place.scale);
          m4.compose(pos, q, sc);
          sm.main.setMatrixAt(count, m4);
          if (sm.extra) sm.extra.setMatrixAt(count, m4);
          count++;
        }
      }
      sm.main.count = count;
      sm.main.instanceMatrix.needsUpdate = true;
      sm.main.boundingSphere = null; sm.main.boundingBox = null;
      if (sm.extra) {
        sm.extra.count = count;
        sm.extra.instanceMatrix.needsUpdate = true;
        sm.extra.boundingSphere = null; sm.extra.boundingBox = null;
      }
    }
  }

  let distance = 0;
  let camZ = CAMERA_Z;
  let lastStats: SceneryStats = { slices: ring, visibleSlices: 0, instances: 0, triangles: 0, drawCalls: 0 };

  function reset(): void {
    distance = 0;
    slices.forEach((s, i) => fill(s, i));
    update(0, camZ);
  }

  function update(d: number, cameraZ = CAMERA_Z): void {
    distance = d;
    camZ = cameraZ;
    let visible = 0, instances = 0, triangles = 0, calls = 0;
    for (const s of slices) {
      // A slice whose whole length is behind the camera goes to the far end of the ring, re-seeded by its new serial.
      let guard = 0;
      while (distance - s.serial * SLICE_LEN - SLICE_LEN > camZ && guard++ < 64) fill(s, s.serial + ring);
      const zMax = distance - s.serial * SLICE_LEN;
      const zMin = zMax - SLICE_LEN;
      s.group.position.z = zMax;
      const nearest = zMax <= camZ ? camZ - zMax : 0;
      const show = zMin <= camZ && nearest < cut;
      s.group.visible = show;
      if (!show) continue;
      visible++;
      for (const sm of s.meshes) {
        if (sm.main.count === 0) continue;
        instances += sm.main.count;
        triangles += sm.main.count * sm.trisPerInstance;
        calls += sm.extra ? 2 : 1;
      }
    }
    lastStats = { slices: ring, visibleSlices: visible, instances, triangles, drawCalls: calls };
  }

  reset();

  return {
    root,
    get distance() { return distance; },
    cut,
    update,
    reset,
    stats: () => lastStats,
    applyTier(next) {
      const share = next.tuftShare;
      const matChanged = next.propMaterial !== tier.propMaterial;
      const shadowChanged = next.shadows !== tier.shadows;
      tier = next;
      if (matChanged) {
        const old = materials;
        materials = makePropMaterials(next.propMaterial);
        for (const m of Object.values(materials)) tracker.track(m);
        for (const s of slices) for (const sm of s.meshes) {
          sm.main.material = materials[sm.family];
          if (sm.extra && sm.extraFamily) sm.extra.material = materials[sm.extraFamily];
        }
        for (const m of Object.values(old)) tracker.free(m);
      }
      if (shadowChanged) {
        for (const s of slices) for (const sm of s.meshes) {
          sm.castsShadow = propStyle(sm.def.kind).shadow === 'tree' && next.shadows === 'actors+trees';
          sm.main.castShadow = sm.castsShadow;
        }
      }
      if (share !== tuftShare) {
        tuftShare = share;
        for (const s of slices) fill(s, s.serial);
      }
    },
  };
}
