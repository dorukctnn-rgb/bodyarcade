// Modelled scenery and obstacles: one glTF file (assets/scenery.glb, built by tools/models/build-kit.mjs from Polyfork's
// CC BY 4.0 models, credits in assets/CREDITS.md) with one vertex-coloured mesh per key.
//
// - The file and its loader (GLTFLoader, the meshopt decoder) are fetched the first time a tier asks for models (T1, T2),
//   never at T0 and never before a 3D game starts. One page loads them once; every round and world reuses the result.
// - The shared geometries here never reach the GPU themselves: a world makes sized, tinted copies (modelProp below), which
//   its own tracker owns and frees.
// - Flat-shaded: the file has no normals (the faces share corners, a third of the size); a copy gets one normal per face.
import * as THREE from 'three';
import kitUrl from './assets/scenery.glb?url';
import type { PropBuildKind, PropOptions } from './props.ts';

export const MODEL_KEYS = ['pine', 'snowPine', 'tree', 'treeB', 'treeC', 'jungletree', 'fern', 'bush', 'rock', 'rockB', 'cactus', 'palm', 'lamp', 'seaLamp', 'building0', 'building1', 'building2', 'log', 'driftwood', 'barrier', 'bus', 'truck'] as const;
export type ModelKey = typeof MODEL_KEYS[number];

/** Shared, CPU-side geometries in model space (metres, standing on y = 0), indexed, with position and color. */
export type ModelSet = ReadonlyMap<ModelKey, THREE.BufferGeometry>;

let pending: Promise<ModelSet> | null = null;
let ready: ModelSet | null = null;

/** The models when they have been loaded on this page, else null (and nothing is started). */
export function loadedModels(): ModelSet | null { return ready; }

/** Loads the model file once per page. A failed load (offline, blocked) can be tried again later. */
export function loadModels(url: string = kitUrl): Promise<ModelSet> {
  if (ready) return Promise.resolve(ready);
  pending ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
    ]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const out = new Map<ModelKey, THREE.BufferGeometry>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const key = (MODEL_KEYS as readonly string[]).includes(mesh.name) ? mesh.name as ModelKey : null;
      if (!key) return;
      out.set(key, plain(mesh.geometry, mesh.matrixWorld));
      mesh.geometry.dispose();
    });
    ready = out;
    return out;
  })();
  pending.catch(() => { pending = null; });
  return pending;
}

/** Float positions and colours in model space (the quantized file keeps a scale and offset in the node). */
export function plain(g: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos = g.getAttribute('position');
  const p = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(matrix); p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z; }
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const col = g.getAttribute('color');
  const c = new Float32Array(pos.count * 3).fill(1);
  if (col) for (let i = 0; i < col.count; i++) { c[i * 3] = col.getX(i); c[i * 3 + 1] = col.getY(i); c[i * 3 + 2] = col.getZ(i); }
  out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (g.index) out.setIndex(Array.from(g.index.array as ArrayLike<number>));
  return out;
}

/** How big a modelled prop is drawn (its theme scale multiplies this), and which model stands for it. */
interface Fit { key: ModelKey; height?: number; width?: number; turn?: number }

/** The model for a prop kind in a world, or null when the kind keeps its built-in shape (tufts, dunes, ice, lava...). */
export function modelFor(kind: PropBuildKind, o: PropOptions, themeId: string): Fit | null {
  switch (kind) {
    case 'pine': return o.snow ? { key: 'snowPine', height: 5.2 } : { key: 'pine', height: 6.6 };
    case 'tree': return { key: 'tree', height: 6.4 };
    case 'jungletree': return { key: 'jungletree', height: 8.4 };
    case 'bush': return { key: 'bush', height: 1.25 };
    case 'fern': return { key: 'fern', height: 1.5 };
    case 'rock': return { key: 'rockB', width: 2.1 };
    case 'cactus': return { key: 'cactus', height: 3.4 };
    case 'palm': return { key: 'palm', height: 6.2 };
    case 'lamp': return themeId === 'coast' ? { key: 'seaLamp', height: 3.6 } : { key: 'lamp', height: 5 };
    case 'building': return { key: (['building0', 'building1', 'building2'] as const)[Math.min(2, Math.max(0, o.variant))]!, width: [5.6, 5.2, 6.4][Math.min(2, Math.max(0, o.variant))]! };
    default: return null;
  }
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * A copy of a model sized for a prop: scaled to its height or width, faced the way the built-in shape faced (lamp arms
 * toward the road), tinted (a theme colour keeps the model's light and dark but takes the tint's hue), one normal per face.
 */
export function sizedModel(models: ModelSet, fit: Fit, tint: string | null, tone?: ModelTone): THREE.BufferGeometry | null {
  const base = models.get(fit.key);
  if (!base) return null;
  const g = base.index ? base.toNonIndexed() : base.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const s = fit.height ? fit.height / Math.max(1e-3, size.y) : fit.width ? fit.width / Math.max(1e-3, Math.max(size.x, size.z)) : 1;
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  g.translate(-cx, -bb.min.y, -cz);
  g.scale(s, s, s);
  if (fit.key === 'lamp') faceArmToMinusX(g);
  if (tint) tintColors(g, tint);
  if (tone) toneColors(g, tone);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The built-in lamp's arm points to -x (the road, for a lamp on the right; the left one is turned by half a turn). */
function faceArmToMinusX(g: THREE.BufferGeometry): void {
  const head = topCentre(g);
  if (head.x > 0) g.rotateY(Math.PI);
  else if (Math.abs(head.z) > Math.abs(head.x)) g.rotateY(head.z > 0 ? -Math.PI / 2 : Math.PI / 2);
}

/** Mean position of the top tenth of a geometry (a lamp's head). */
export function topCentre(g: THREE.BufferGeometry): THREE.Vector3 {
  const p = g.getAttribute('position');
  let maxY = -Infinity;
  for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
  g.computeBoundingBox();
  const h = maxY - g.boundingBox!.min.y;
  const out = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > maxY - h * 0.1) { out.x += p.getX(i); out.y += p.getY(i); out.z += p.getZ(i); n++; }
  return n ? out.multiplyScalar(1 / n) : out;
}

/** A world's grip on the models' own colours: brightness and saturation (1 = as modelled). */
export interface ModelTone { gain: number; saturation: number }

export function toneColors(g: THREE.BufferGeometry, t: ModelTone): void {
  const c = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) {
    const r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
    const l = lum(r, gg, b);
    c.setXYZ(i, (l + (r - l) * t.saturation) * t.gain, (l + (gg - l) * t.saturation) * t.gain, (l + (b - l) * t.saturation) * t.gain);
  }
}

function tintColors(g: THREE.BufferGeometry, hex: string): void {
  const t = new THREE.Color(hex);
  const tl = Math.max(1e-3, lum(t.r, t.g, t.b));
  const c = g.getAttribute('color') as THREE.BufferAttribute;
  let mean = 0;
  for (let i = 0; i < c.count; i++) mean += lum(c.getX(i), c.getY(i), c.getZ(i));
  mean = Math.max(1e-3, mean / Math.max(1, c.count));
  for (let i = 0; i < c.count; i++) {
    const k = lum(c.getX(i), c.getY(i), c.getZ(i)) / mean;
    const m = Math.min(2.2, k) * tl;
    c.setXYZ(i, t.r / tl * m, t.g / tl * m, t.b / tl * m);
  }
}

/** Is this face glass (a dark, upright, neutral or blue face: not brick, not black iron, not the warm window frames)? Colours are linear, untoned. */
export function isGlass(r: number, g: number, b: number, ny: number): boolean {
  const max = Math.max(r, g, b);
  return Math.abs(ny) < 0.3 && max < 0.26 && max > 0.025 && b >= r - 0.004;
}

const hash3 = (a: number, b: number, c: number): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

/**
 * The lit windows of a modelled building (its night glow, drawn unlit beside it like the built-in 'windows'): a copy of
 * its glass faces a hair in front of them, about half of them lit, warm or pale, brighter than 1 so the bloom finds them.
 * The two triangles of a window pane have the same bounding box (a rectangle cut along its diagonal), so the draw is
 * made from that box: a pane is lit or dark as a whole.
 */
export function litWindows(building: THREE.BufferGeometry, glow = 1.7): THREE.BufferGeometry {
  const p = building.getAttribute('position'), c = building.getAttribute('color');
  const pos: number[] = [], col: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const warm = new THREE.Color('#ffd58a'), pale = new THREE.Color('#ffecc0');
  const cm = (v: number): number => Math.round(v * 50);
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); d.fromBufferAttribute(p, i + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a));
    if (n.lengthSq() < 1e-10) continue;
    n.normalize();
    const r = (c.getX(i) + c.getX(i + 1) + c.getX(i + 2)) / 3, g = (c.getY(i) + c.getY(i + 1) + c.getY(i + 2)) / 3, bl = (c.getZ(i) + c.getZ(i + 1) + c.getZ(i + 2)) / 3;
    if (!isGlass(r, g, bl, n.y)) continue;
    const k = hash3(cm(Math.min(a.x, b.x, d.x)) * 7 + cm(Math.max(a.x, b.x, d.x)), cm(Math.min(a.y, b.y, d.y)) * 7 + cm(Math.max(a.y, b.y, d.y)), cm(Math.min(a.z, b.z, d.z)) * 7 + cm(Math.max(a.z, b.z, d.z)));
    if (k < 0.45) continue;
    const tone = k > 0.8 ? pale : warm;
    for (const v of [a, b, d]) {
      pos.push(v.x + n.x * 0.03, v.y + n.y * 0.03, v.z + n.z * 0.03);
      col.push(tone.r * glow, tone.g * glow, tone.b * glow);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

/** A lamp's glowing head for a modelled lamp: a small bright box just under the top of its arm. */
export function lampGlow(lamp: THREE.BufferGeometry, glow = 2.4): THREE.BufferGeometry {
  const head = topCentre(lamp);
  const g = new THREE.BoxGeometry(0.42, 0.1, 0.26).toNonIndexed();
  g.translate(head.x, head.y - 0.22, head.z);
  const n = g.getAttribute('position').count;
  const tone = new THREE.Color('#ffe3a3');
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = tone.r * glow; col[i * 3 + 1] = tone.g * glow; col[i * 3 + 2] = tone.b * glow; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
