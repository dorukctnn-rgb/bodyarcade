// Wind-blown grass beside the road (T1 and T2, grassy worlds): ONE draw call for the whole field.
//
// Thousands of small clumps of blades are scattered once, denser near the road, in a band from just behind the camera to
// about 80 m ahead (beyond that the fog has them). The field never moves on the CPU: the vertex shader moves each clump
// toward the camera by the distance run and wraps it back to the far end when it passes the camera, so the scrolling
// costs one uniform a frame. The same shader bends the blades with two layers of wind (a slow sway and travelling
// gusts that also lighten the tips), more at the tip than at the root.
// Positions are final in the shader (no instance matrix), so fog and the shadows of trees fall on the grass correctly.
// The grass casts no shadow. Everything is owned by the tracker that is passed in.
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';
import type { ResourceTracker } from './dispose.ts';
import { NO_AO_LAYER } from './post.ts';

export const GRASS_NEAR = 8.5;   // metres in front of the origin where a clump leaves (the camera sits at z = 5.4)
export const GRASS_LEN = 88;     // length of the band; clumps wrap from z = NEAR to NEAR - LEN
export const ROAD_CLEAR = 3.05;  // no blade nearer the road's centre line than this
export const FIELD_HALF = 17;    // outer edge of the band
export const BLADES_PER_CLUMP = 9;

export interface GrassLook { root: string; tip: string; height: number }

export interface GrassKit {
  readonly mesh: THREE.Mesh;
  readonly clumps: number;
  /** Course distance (metres) and world time (seconds). */
  update(distance: number, time: number): void;
  setWind(strength: number): void;
}

/** One clump: blades of two segments each (3 triangles), leaning out a little, colour from root to tip. */
export function clumpGeometry(look: GrassLook, rng: Rng): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], hgt: number[] = [], nor: number[] = [], idx: number[] = [];
  const root = new THREE.Color(look.root), tip = new THREE.Color(look.tip), c = new THREE.Color();
  for (let b = 0; b < BLADES_PER_CLUMP; b++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.22;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = look.height * (0.6 + rng() * 0.6);
    const w = 0.02 + rng() * 0.018;
    const face = rng() * Math.PI;
    const fx = Math.cos(face) * w, fz = Math.sin(face) * w;
    const lean = 0.08 + rng() * 0.12;
    const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const shade = 0.82 + rng() * 0.3;
    const base = pos.length / 3;
    const ring = (t: number, width: number): void => {
      const y = h * t, ox = bx + lx * t * t, oz = bz + lz * t * t;
      for (const s of [-1, 1]) {
        pos.push(ox + fx * s * width, y, oz + fz * s * width);
        c.copy(root).lerp(tip, Math.pow(t, 0.8)).multiplyScalar(shade);
        col.push(c.r, c.g, c.b);
        hgt.push(t);
        nor.push(0, 1, 0);
      }
    };
    ring(0, 1); ring(0.55, 0.7);
    pos.push(bx + lx, h, bz + lz);
    c.copy(tip).multiplyScalar(shade * 1.05);
    col.push(c.r, c.g, c.b); hgt.push(1); nor.push(0, 1, 0);
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1));
  g.setIndex(idx);
  return g;
}

/** Where clump i stands: x beside the road (denser near it), z in the band, a turn and a size. Pure. */
export function clumpPlacement(rng: Rng): [number, number, number, number] {
  const side = rng() < 0.5 ? -1 : 1;
  const off = Math.pow(rng(), 1.7) * (FIELD_HALF - ROAD_CLEAR);
  const x = side * (ROAD_CLEAR + off);
  const z = GRASS_NEAR - rng() * GRASS_LEN;
  // The verge beside the road is mown short; the grass grows to full height a couple of metres out.
  const verge = 0.45 + 0.55 * Math.min(1, Math.max(0, (off - 0.4) / 2.4));
  return [x, z, rng() * Math.PI * 2, (0.75 + rng() * 0.6) * verge];
}

const VERT_PARS = /* glsl */ `
attribute vec4 aClump;
attribute float aH;
uniform float uScroll, uTime, uWind;
`;

// Replaces three's begin_vertex: the clump is turned, scaled, bent by the wind and moved to its wrapped place.
const VERT_BEGIN = /* glsl */ `
float cs = cos(aClump.z), sn = sin(aClump.z);
vec3 transformed = vec3(cs * position.x - sn * position.z, position.y, sn * position.x + cs * position.z) * aClump.w;
float z0 = aClump.y + uScroll;
float zw = ${GRASS_NEAR.toFixed(2)} - mod(${GRASS_NEAR.toFixed(2)} - z0, ${GRASS_LEN.toFixed(2)});
vec2 at = vec2(aClump.x, zw);
float sway = sin(uTime * 1.6 + at.x * 0.31 + at.y * 0.23) * 0.5 + sin(uTime * 2.7 + at.x * 0.9) * 0.18;
float gust = smoothstep(0.55, 1.0, sin(uTime * 1.1 - at.y * 0.09 + at.x * 0.04) * 0.5 + 0.5);
float bend = (sway * 0.11 + gust * 0.2) * uWind * aH * aH;
transformed.x += bend * 0.8 + at.x;
transformed.z += bend * 0.55 + at.y;
transformed.y -= abs(bend) * 0.25 * aH;
vGust = gust * aH;
`;

export function createGrass(look: GrassLook, clumps: number, rng: Rng, tracker: ResourceTracker): GrassKit {
  const base = clumpGeometry(look, rng);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  for (const name of ['position', 'normal', 'color', 'aH']) geo.setAttribute(name, base.getAttribute(name));
  const data = new Float32Array(clumps * 4);
  for (let i = 0; i < clumps; i++) data.set(clumpPlacement(rng), i * 4);
  geo.setAttribute('aClump', new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = clumps;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, GRASS_NEAR - GRASS_LEN / 2), GRASS_LEN);
  tracker.track(geo);
  base.dispose();

  const uniforms = { uScroll: { value: 0 }, uTime: { value: 0 }, uWind: { value: 1 } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}\nvarying float vGust;`)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGust;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + vGust * 0.22;');
  };
  mat.customProgramCacheKey = () => 'ba-grass-1';
  tracker.track(mat);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'grass';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.layers.set(NO_AO_LAYER);

  return {
    mesh, clumps,
    update(distance, time) { uniforms.uScroll.value = distance % GRASS_LEN; uniforms.uTime.value = time; },
    setWind(s) { uniforms.uWind.value = s; },
  };
}
