// Small geometry helpers for procedural props (split from site/game/engine.js:17-45). Everything that was random in
// the old file takes a seeded stream now, so a world looks the same every time and in every browser; two players
// racing in the same room see the same trees (graphics-maps.md fix 7).
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';

const scratchM = new THREE.Matrix4();
const scratchV = new THREE.Vector3();
const scratchS = new THREE.Vector3();
const scratchQ = new THREE.Quaternion();
const scratchE = new THREE.Euler();
const scratchC = new THREE.Color();

/** Random number between a and b from a seeded stream. */
export const between = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);

/**
 * Gives every vertex a colour (linear working space, as three.js reads vertex colours) with a little brightness
 * jitter per triangle corner. Returns a non-indexed geometry (indexed ones are converted).
 */
export function colorize(geo: THREE.BufferGeometry, color: string, jitter: number, rng: Rng): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const n = g.attributes['position']!.count;
  const c = new Float32Array(n * 3);
  scratchC.set(color);
  const { r, g: gg, b } = scratchC;
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (rng() - 0.5) * jitter : 1;
    c[i * 3] = r * j; c[i * 3 + 1] = gg * j; c[i * 3 + 2] = b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Moves, turns (Euler XYZ, radians) and scales a geometry in place. */
export function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1): THREE.BufferGeometry {
  scratchV.set(x, y, z);
  scratchS.set(s, s, s);
  scratchQ.setFromEuler(scratchE.set(rx, ry, rz));
  geo.applyMatrix4(scratchM.compose(scratchV, scratchQ, scratchS));
  return geo;
}

/** Joins non-indexed geometries that carry position, normal and color into one (one draw call per prop). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const p of parts) total += p.attributes['position']!.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), clr = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes['position']!.array as Float32Array, o * 3);
    nor.set(p.attributes['normal']!.array as Float32Array, o * 3);
    clr.set(p.attributes['color']!.array as Float32Array, o * 3);
    o += p.attributes['position']!.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(clr, 3));
  return g;
}

export type PropMaterialKind = 'lambert' | 'standard';

/** The material for vertex-coloured props. Lambert (T0, T1) costs less per pixel; the look of flat low-poly props barely changes. */
export function vertexColorMaterial(kind: PropMaterialKind, extra: { roughness?: number; metalness?: number } = {}): THREE.Material {
  if (kind === 'lambert') return new THREE.MeshLambertMaterial({ vertexColors: true });
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: extra.roughness ?? 0.85, metalness: extra.metalness ?? 0 });
}

/** Triangles in a geometry (indexed or not). */
export function triangleCount(geo: THREE.BufferGeometry): number {
  const index = geo.index;
  return (index ? index.count : (geo.attributes['position']?.count ?? 0)) / 3;
}
