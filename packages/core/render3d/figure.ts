// The modelled runner: one skinned, vertex-coloured figure with a run and a jump (assets/runner.glb, built by
// tools/models/runner-from-fbx.ts + build-runner.mjs from Quaternius' "Animated Human", CC0; credits in assets/CREDITS.md).
//
// - Like the modelled scenery, the file and its loader are fetched only when a tier draws models (T1, T2), once per page.
//   At T0, or until the file is in, a game keeps its built-in figure.
// - The pose follows the simulation, never a clock: the run cycle's place comes from the distance run, the jump's from
//   the jump's progress, and the crouch bends the hips, the knees and the back on top of the run.
// - Each figure owns a copy of the geometry (its colours are the game's), its material and its skeleton; dispose() frees them.
import * as THREE from 'three';
import figureUrl from './assets/runner.glb?url';

export interface FigureAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  clone(o: THREE.Object3D): THREE.Object3D;
}

let pending: Promise<FigureAsset> | null = null;
let ready: FigureAsset | null = null;

/** The figure when it has been loaded on this page, else null (and nothing is started). */
export function loadedFigure(): FigureAsset | null { return ready; }

/** Loads the figure once per page. A failed load (offline, blocked) can be tried again later. */
export function loadFigure(url: string = figureUrl): Promise<FigureAsset> {
  if (ready) return Promise.resolve(ready);
  pending ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }, { clone }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      import('three/examples/jsm/utils/SkeletonUtils.js'),
    ]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    ready = { scene: gltf.scene, clips: gltf.animations, clone };
    return ready;
  })();
  pending.catch(() => { pending = null; });
  return pending;
}

/** The figure's colours: the shirt, the trousers, the skin, the hair and the shoes. */
export interface FigureColors { shirt: string; trousers: string; skin: string; hair: string; shoes: string }

/** Where the figure is in its movement (all from the simulation). */
export interface FigurePose {
  /** Run cycle, in strides (any real number; one stride is one full cycle of both legs). */
  stride: number;
  /** In the air: the jump's progress 0..1; on the ground: null. */
  air: number | null;
  /** 0 standing .. 1 deep crouch. */
  crouch: number;
}

export interface Figure {
  /** Faces -z (away from a camera behind it), feet on y = 0, about 1.8 m tall. */
  readonly root: THREE.Group;
  pose(p: FigurePose): void;
  /** 0..1: the red glow of a hit. */
  setHit(k: number): void;
  dispose(): void;
}

/** The palette of the source model (its texture bands, sRGB): skin, dark (brows, eyes), hair, shirt, trousers. */
const SOURCE = ['#ffd19f', '#292929', '#7c5823', '#73a7c4', '#1560bd'] as const;
type Role = 'skin' | 'dark' | 'hair' | 'shirt' | 'trousers' | 'shoes';
const ROLES: readonly Role[] = ['skin', 'dark', 'hair', 'shirt', 'trousers'];

const FEET = /Foot|Toe/;

/** A copy of the figure's geometry coloured for a figure: each corner takes the colour of its part (shoes by the foot bones). */
function recolour(src: THREE.BufferGeometry, bones: readonly THREE.Bone[], c: FigureColors): THREE.BufferGeometry {
  const g = src.clone();
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const idx = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const wgt = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  const src3 = SOURCE.map((h) => new THREE.Color(h));
  const dark = new THREE.Color(c.hair).multiplyScalar(0.35);
  const to: Record<Role, THREE.Color> = { skin: new THREE.Color(c.skin), dark, hair: new THREE.Color(c.hair), shirt: new THREE.Color(c.shirt), trousers: new THREE.Color(c.trousers), shoes: new THREE.Color(c.shoes) };
  const out = new Float32Array(col.count * 3);
  const cc = new THREE.Color();
  for (let i = 0; i < col.count; i++) {
    cc.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    let best = 0, bd = Infinity;
    for (let k = 0; k < src3.length; k++) {
      const s = src3[k]!;
      const d = (s.r - cc.r) ** 2 + (s.g - cc.g) ** 2 + (s.b - cc.b) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    let role = ROLES[best]!;
    if (role === 'skin' && idx && wgt) {
      // Bare feet get shoes: the corners that the foot and toe bones carry most.
      let top = 0, topW = -1;
      for (let j = 0; j < 4; j++) { const w = wgt.getComponent(i, j); if (w > topW) { topW = w; top = idx.getComponent(i, j); } }
      if (FEET.test(bones[top]?.name ?? '')) role = 'shoes';
    }
    const t = to[role];
    out[i * 3] = t.r; out[i * 3 + 1] = t.g; out[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

const X = new THREE.Vector3(1, 0, 0);
const q = new THREE.Quaternion();
/** Bends a bone about its own x axis (hips and knees of this rig: + bends the knee, - lifts the thigh, + bows the back). */
const bend = (b: THREE.Object3D | undefined, a: number): void => { if (b) b.quaternion.multiply(q.setFromAxisAngle(X, a)); };

/** The jump clip's moments that the game's jump (take-off to landing) runs through. */
const JUMP_FROM = 0.28, JUMP_TO = 0.8;

export function createFigure(asset: FigureAsset, colours: FigureColors, track: <T>(r: T) => T): Figure {
  const root = new THREE.Group();
  root.name = 'figure';
  const body = asset.clone(asset.scene);
  body.rotation.y = Math.PI;   // the model faces +z; the runner runs toward -z
  root.add(body);
  let mesh: THREE.SkinnedMesh | null = null;
  body.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  const skinned = mesh as THREE.SkinnedMesh | null;
  const material = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, flatShading: true }));
  if (skinned) {
    skinned.geometry = track(recolour(skinned.geometry, skinned.skeleton.bones, colours));
    skinned.material = material;
    skinned.castShadow = true;
    skinned.receiveShadow = false;
    skinned.frustumCulled = false;   // the bind pose's bounds are not the running pose's
    track(skinned.skeleton);
  }
  const bone = (n: string): THREE.Object3D | undefined => body.getObjectByName(n) ?? undefined;
  const B = {
    spine: bone('Spine'), spine1: bone('Spine1'), neck: bone('Neck'),
    upL: bone('LeftUpLeg'), upR: bone('RightUpLeg'), lowL: bone('LeftLeg'), lowR: bone('RightLeg'), footL: bone('LeftFoot'), footR: bone('RightFoot'),
    armL: bone('LeftArm'), armR: bone('RightArm'),
  };
  // The bent bones' rest, put back before each pose (a bone that no clip moves would otherwise keep bending).
  const rest = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const b of Object.values(B)) if (b) rest.set(b, b.quaternion.clone());
  const mixer = new THREE.AnimationMixer(body);
  const clip = (n: string): THREE.AnimationClip | undefined => asset.clips.find((c) => c.name === n);
  const runClip = clip('run'), jumpClip = clip('jump');
  const run = runClip ? mixer.clipAction(runClip) : null;
  const jump = jumpClip ? mixer.clipAction(jumpClip) : null;
  for (const a of [run, jump]) if (a) { a.play(); a.enabled = true; a.setEffectiveWeight(0); }
  let disposed = false;

  return {
    root,
    pose(p: FigurePose): void {
      if (disposed) return;
      for (const [b, r] of rest) b.quaternion.copy(r);
      const inAir = p.air !== null;
      if (run && runClip) { run.setEffectiveWeight(inAir ? 0 : 1); run.time = (((p.stride % 1) + 1) % 1) * runClip.duration; }
      if (jump && jumpClip) { jump.setEffectiveWeight(inAir ? 1 : 0); jump.time = (JUMP_FROM + (JUMP_TO - JUMP_FROM) * Math.min(1, Math.max(0, p.air ?? 0))) * jumpClip.duration; }
      mixer.update(0);
      // The crouch, on top of the run: thighs up, knees bent twice as far (the shins lean back as much as the thighs
      // lean forward, so the feet stay under the hips), the back bowed, the head lifted to look ahead.
      const c = Math.min(1, Math.max(0, p.crouch));
      const a = 1.05 * c;
      if (c > 0.001) {
        bend(B.upL, -a); bend(B.upR, -a);
        bend(B.lowL, 2 * a); bend(B.lowR, 2 * a);
        bend(B.footL, -a * 0.6); bend(B.footR, -a * 0.6);
        bend(B.spine, 0.32 * c); bend(B.spine1, 0.22 * c); bend(B.neck, -0.4 * c);
      }
      // Legs about 0.9 m: the hips drop by (1 - cos a) of their length.
      body.position.y = -0.9 * (1 - Math.cos(a));
    },
    setHit(k: number): void {
      material.emissive.setRGB(k * 0.9, k * 0.1, k * 0.05);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(body);
      root.remove(body);
    },
  };
}
