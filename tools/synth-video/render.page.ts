// The renderer page of the synthetic-person videos (driven by render.ts). One or two rigged people (Kenney's CC0
// characters), posed frame by frame by the rig solver (rig.ts), lit and filmed by a virtual camera. For every frame the page
//   - renders the picture, makes a JPEG of it (the camera's picture), decodes it again and runs the real pose model on it,
//     the way the game's pose service sees a camera frame, and keeps the landmarks as a trace frame,
//   - projects the true 3D joints into the picture, for the quality report and the labels.
// It runs in headless Chromium with a software GL renderer. Nothing here is shipped.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MainBackend } from '../../packages/core/pose/service.ts';
import { POSE_MODEL, WASM_BASE } from '../../packages/core/pose/assets.ts';
import { serializeTrace } from '../../packages/core/pose/trace.ts';
import type { Landmark, Trace, TraceFile, TraceFrame, TraceMeta } from '../../packages/core/types/index.ts';
import { Humanoid, KENNEY_MAP, type JointName, type PoseSpec } from './rig.ts';

export interface PersonDef {
  /** Skin (texture file under tools/synth-video/assets). */
  skin: string;
  /** Body height in metres. */
  height: number;
  /** Where the person stands: sideways (+ = toward the image right) and toward the camera, metres. */
  x?: number;
  z?: number;
  /** Turn about the vertical axis, degrees. */
  yaw?: number;
}

export interface SceneDef {
  width: number;
  height: number;
  fovY: number;
  /** Camera height and distance (metres) and the height it looks at; pitch follows from them. */
  camHeight: number;
  camDist: number;
  lookAtY: number;
  /** Colours of the room (0xrrggbb). */
  wall: number;
  floor: number;
  background: number;
  /** Light: strength of the sky light and of the sun, sun colour and position. */
  hemi: number;
  sun: number;
  sunColor: number;
  sunPos: [number, number, number];
  people: PersonDef[];
}

/** The joints whose 3D truth and picture position are reported (names of rig.ts). */
const REPORT: JointName[] = ['hips', 'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR', 'upLegL', 'upLegR', 'lowLegL', 'lowLegR', 'footL', 'footR', 'toesL', 'toesR',
  'toesEndL', 'toesEndR', 'indexL', 'indexR', 'thumbL', 'thumbR', 'headEnd', 'head', 'neck', 'noseTip'];

export interface TruthJoint { /** picture position, 0..1 from the top left */ x: number; y: number; /** world position, metres */ wx: number; wy: number; wz: number }
export type TruthPerson = Partial<Record<JointName, TruthJoint>>;

export interface FrameResult {
  jpeg: string;
  truth: TruthPerson[];
  /** Landmarks of every person the model found, in its own order (empty: nobody found). */
  found: Landmark[][];
  inferenceMs: number;
}

const canvas = document.getElementById('gl') as HTMLCanvasElement;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let people: { human: Humanoid; def: PersonDef }[] = [];
let backend: MainBackend | null = null;
let frames: TraceFrame[] = [];
let def: SceneDef;
let ts = 1000;

const fbx = new FBXLoader();
const textures = new Map<string, THREE.Texture>();
let modelCache: THREE.Group | null = null;

async function loadSkin(url: string): Promise<THREE.Texture> {
  const have = textures.get(url);
  if (have) return have;
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  textures.set(url, tex);
  return tex;
}

async function init(d: SceneDef, o: { detect: boolean }): Promise<{ people: { T: number; W: number; A: number; U: number; restHipY: number; restHipX: number }[]; camera: { x: number; y: number; z: number; fovY: number; aspect: number } }> {
  def = d;
  canvas.width = d.width;
  canvas.height = d.height;
  renderer?.dispose();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(d.width, d.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(d.background);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: d.floor, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), new THREE.MeshStandardMaterial({ color: d.wall, roughness: 1 }));
  wall.position.set(0, 5, -3.6); wall.receiveShadow = true; scene.add(wall);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x887766, d.hemi));
  const sun = new THREE.DirectionalLight(d.sunColor, d.sun);
  sun.position.set(...d.sunPos); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 14 });
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(d.fovY, d.width / d.height, 0.1, 60);
  camera.position.set(0, d.camHeight, d.camDist);
  camera.lookAt(0, d.lookAtY, 0);
  camera.updateMatrixWorld(true);

  if (!modelCache) modelCache = await fbx.loadAsync('/tools/synth-video/assets/kenney-protagonists/Model/characterMedium.fbx');
  people = [];
  const dims: { T: number; W: number; A: number; U: number; restHipY: number; restHipX: number }[] = [];
  for (const p of d.people) {
    const root = cloneSkinned(modelCache) as THREE.Group;
    const tex = await loadSkin(`/tools/synth-video/assets/kenney-protagonists/Skins/${p.skin}`);
    root.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) { m.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }); m.castShadow = true; m.frustumCulled = false; }
    });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const human = new Humanoid(root, KENNEY_MAP, { height: p.height, heightUnits: box.max.y - box.min.y });
    scene.add(human.holder);
    human.pose({});
    const hip = (human.restPos('upLegL').y + human.restPos('upLegR').y) / 2;
    dims.push({ T: human.T, W: human.W, A: human.A, U: human.U, restHipY: hip, restHipX: (human.restPos('upLegL').x + human.restPos('upLegR').x) / 2 });
    people.push({ human, def: p });
  }
  frames = [];
  ts = 1000;
  if (o.detect) {
    backend?.dispose();
    backend = new MainBackend();
    await backend.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, prefer: 'CPU', numPoses: d.people.length > 1 ? 2 : 1 });
    await backend.warmUp();
  }
  return { people: dims, camera: { x: 0, y: d.camHeight, z: d.camDist, fovY: d.fovY, aspect: d.width / d.height } };
}

const v3 = new THREE.Vector3();
const currentYaw = new WeakMap<Humanoid, number>();

function toTruth(h: Humanoid, joints: ReturnType<Humanoid['pose']>): TruthPerson {
  void h;
  const out: TruthPerson = {};
  const put = (name: JointName, p: THREE.Vector3): void => {
    // Joints come back as world positions (the rig places the person itself, see frame()).
    const w = p;
    v3.copy(w).project(camera);
    out[name] = { x: (v3.x + 1) / 2, y: (1 - v3.y) / 2, wx: w.x, wy: w.y, wz: w.z };
  };
  for (const name of REPORT) {
    const p = (joints as Partial<Record<JointName, THREE.Vector3>>)[name];
    if (p) put(name, p);
  }
  // The nose: in front of the head joint, a little below the crown (the head bone sits at the neck, headEnd at the crown).
  const head = joints.head, end = joints.headEnd;
  if (head && end) {
    const up = end.clone().sub(head);
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ((currentYaw.get(h) ?? 0) * Math.PI) / 180);
    put('noseTip', head.clone().add(up.clone().multiplyScalar(0.55)).add(fwd.normalize().multiplyScalar(up.length() * 0.28)));
  }
  return out;
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = (): void => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = (): void => fail(new Error('could not read the picture'));
    r.readAsDataURL(b);
  });
}

async function frame(specs: PoseSpec[], o: { quality: number; detect: boolean; tMs: number }): Promise<FrameResult> {
  if (!renderer) throw new Error('call init first');
  const truth: TruthPerson[] = [];
  people.forEach((p, i) => {
    // Where the person stands: the spec's own x and z (in T) plus the place of this person in the scene (metres).
    const sp = specs[i] ?? {};
    const T = p.human.T;
    const yaw = (sp.yaw ?? 0) + (p.def.yaw ?? 0);
    currentYaw.set(p.human, yaw);
    const joints = p.human.pose({ ...sp, x: (sp.x ?? 0) + (p.def.x ?? 0) / T, z: (sp.z ?? 0) + (p.def.z ?? 0) / T, yaw });
    truth.push(toTruth(p.human, joints));
  });
  renderer.render(scene, camera);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('no picture'))), 'image/jpeg', o.quality));
  let found: Landmark[][] = [];
  let inferenceMs = 0;
  if (o.detect && backend) {
    const bmp = await createImageBitmap(blob);
    const r = await backend.detect(bmp as unknown as HTMLVideoElement, (ts += Math.max(1, Math.round(1000 / 30))));
    bmp.close();
    found = r.poses;
    inferenceMs = r.inferenceMs;
    const f: TraceFrame = { t: Math.round(o.tMs * 10) / 10, lm: found[0] ?? null, inferenceMs: Math.round(inferenceMs * 100) / 100 };
    if (people.length > 1) f.people = found;
    frames.push(f);
  }
  return { jpeg: await blobToBase64(blob), truth, found, inferenceMs };
}

function finish(meta: TraceMeta, fps: number, decimals = 3): TraceFile {
  const trace: Trace = { fps, aspect: def.width / def.height, meta, labels: [], frames };
  return serializeTrace(trace, { decimals });
}

function done(): void { backend?.dispose(); backend = null; renderer?.dispose(); renderer = null; }

(window as unknown as { synth: unknown }).synth = { init, frame, finish, done };
(window as unknown as { synthReady: boolean }).synthReady = true;
