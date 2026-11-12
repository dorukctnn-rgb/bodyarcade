// The 3D figure of the vertical clip: BodyArcade's runner (core/render3d/figure.ts, Quaternius' CC0 "Animated Human") facing the camera
// on a transparent canvas, lit like a stage, posed at every frame from a StoryPose (story-pose.ts). One figure for one player, two side
// by side for two (in the colours of the two-player HUD). Nothing here sees the camera: the poses are the game's move, made up.
//
// A limb is posed by aiming its bone: the bone turns (in the picture's own space: x to the screen's right, y up, z toward the camera)
// until the line from it to the next bone points where the pose says. That holds whatever the rig's own axes are. The poses are in the
// mirrored picture (the player's right on the screen's right), and the figure faces the camera, so the player's right is the rig's left.
// The feet are put back on the ground after every pose (a squat drops the hips), and a jump lifts the whole figure.
import * as THREE from 'three';
import { createFigure, loadFigure, type FigureColors } from '../../../core/render3d/figure.ts';
import type { LimbKey } from '../../../games/_shared/mover.ts';
import type { StoryPose } from './story-pose.ts';

/** The runner's own colours (Road Run's first skin) for one player; the colours of the two-player HUD for two. */
export const STORY_COLOURS: Readonly<Record<'solo' | 'p1' | 'p2', FigureColors>> = {
  solo: { shirt: '#ff4f24', trousers: '#15130f', skin: '#e8b68a', hair: '#3a2617', shoes: '#ffc93c' },
  p1: { shirt: '#ffc53a', trousers: '#1c1433', skin: '#e8b68a', hair: '#3a2617', shoes: '#ff4f6e' },
  p2: { shirt: '#46b4ff', trousers: '#1c1433', skin: '#c99a72', hair: '#1f160f', shoes: '#ff4f6e' },
};

/** Which bone a limb of the pose turns, and the bone its line runs to (mirrored: the player's left is the rig's right). */
const LIMB_BONES: Readonly<Record<LimbKey, readonly [string, string]>> = {
  armUpperL: ['RightArm', 'RightForeArm'], armLowerL: ['RightForeArm', 'RightHand'],
  armUpperR: ['LeftArm', 'LeftForeArm'], armLowerR: ['LeftForeArm', 'LeftHand'],
  thighL: ['RightUpLeg', 'RightLeg'], shinL: ['RightLeg', 'RightFoot'],
  thighR: ['LeftUpLeg', 'LeftLeg'], shinR: ['LeftLeg', 'LeftFoot'],
  torso: ['Spine', 'Neck'], neck: ['Neck', 'Head'],
};
/** The order the limbs are aimed in: a parent before its child, so a child starts from where its parent put it. */
const ORDER: readonly LimbKey[] = ['torso', 'neck', 'armUpperL', 'armLowerL', 'armUpperR', 'armLowerR', 'thighL', 'shinL', 'thighR', 'shinR'];
const POSED = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg', 'LeftFoot', 'RightFoot'];
/** How high the ankle is above the sole, in metres (the model's own, standing). */
const ANKLE = 0.075;

/** The direction of a limb in the picture: `deg` in the screen's plane, `fwd` of it toward the camera. */
export function limbDirection(deg: number, fwd = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const f = Math.max(0, Math.min(1, fwd));
  const r = (deg * Math.PI) / 180;
  return out.set(Math.cos(r) * (1 - f), Math.sin(r) * (1 - f), f).normalize();
}

interface Posable {
  root: THREE.Group;
  bones: Map<string, THREE.Object3D>;
  rest: Map<THREE.Object3D, THREE.Quaternion>;
  x: number;
  dispose(): void;
}

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vT = new THREE.Vector3();
const qP = new THREE.Quaternion();
const qD = new THREE.Quaternion();
const qW = new THREE.Quaternion();

/** Turns `bone` so the line from it to `child` points along `dir` (world space). */
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3): void {
  bone.getWorldPosition(vA);
  child.getWorldPosition(vB);
  const cur = vB.sub(vA);
  if (cur.lengthSq() < 1e-8) return;
  cur.normalize();
  qD.setFromUnitVectors(cur, dir);
  bone.getWorldQuaternion(qW);
  qW.premultiply(qD);
  if (bone.parent) bone.parent.getWorldQuaternion(qP); else qP.identity();
  bone.quaternion.copy(qP.invert().multiply(qW));
  bone.updateMatrixWorld(true);
}

const RIGHT = new THREE.Vector3(1, 0, 0);

/** Turns `bone` about the upright so the line from the rig's right point `b` to its left point `a` runs along the picture: the body faces the camera. */
function squareUp(bone: THREE.Object3D | undefined, a: THREE.Object3D | undefined, b: THREE.Object3D | undefined): void {
  if (!bone || !a || !b) return;
  a.getWorldPosition(vA);
  b.getWorldPosition(vB);
  const d = vA.sub(vB);
  d.y = 0;
  if (d.lengthSq() < 1e-8) return;
  d.normalize();
  qD.setFromUnitVectors(d, RIGHT);
  bone.getWorldQuaternion(qW);
  qW.premultiply(qD);
  if (bone.parent) bone.parent.getWorldQuaternion(qP); else qP.identity();
  bone.quaternion.copy(qP.invert().multiply(qW));
  bone.updateMatrixWorld(true);
}

function poseFigure(f: Posable, p: StoryPose): void {
  for (const [b, q] of f.rest) b.quaternion.copy(q);
  f.root.position.set(f.x, 0, 0);
  f.root.updateMatrixWorld(true);
  // the model's own pose is a stride of its run: hips and shoulders are squared to the camera first
  const B = (n: string): THREE.Object3D | undefined => f.bones.get(n);
  squareUp(B('Hips'), B('LeftUpLeg'), B('RightUpLeg'));
  squareUp(B('Spine2'), B('LeftArm'), B('RightArm'));
  for (const k of ORDER) {
    const [from, to] = LIMB_BONES[k];
    const a = f.bones.get(from);
    const b = f.bones.get(to);
    if (!a || !b) continue;
    aim(a, b, limbDirection(p.limbs[k], p.fwd[k] ?? 0, vT));
    if (k === 'neck' && p.twist !== 0) {
      // the twist turns the shoulders about the line of the spine
      const s = f.bones.get('Spine1');
      if (s) {
        const spine = f.bones.get('Spine');
        const neck = f.bones.get('Neck');
        if (spine && neck) {
          spine.getWorldPosition(vA); neck.getWorldPosition(vB);
          const axis = vB.sub(vA).normalize();
          qD.setFromAxisAngle(axis, (-p.twist * Math.PI) / 180);
          s.getWorldQuaternion(qW);
          qW.premultiply(qD);
          if (s.parent) s.parent.getWorldQuaternion(qP); else qP.identity();
          s.quaternion.copy(qP.invert().multiply(qW));
          s.updateMatrixWorld(true);
        }
      }
    }
  }
  // the soles flat, pointing ahead
  for (const foot of ['LeftFoot', 'RightFoot']) {
    const fb = f.bones.get(foot);
    const toe = fb?.children.find((c) => /Toe/.test(c.name));
    if (fb && toe) aim(fb, toe, vT.set(0, -0.35, 1).normalize());
  }
  // back on the ground: the lower ankle at its standing height, then the jump
  const l = f.bones.get('LeftFoot');
  const r = f.bones.get('RightFoot');
  let low = Infinity;
  for (const b of [l, r]) if (b) { b.getWorldPosition(vA); low = Math.min(low, vA.y); }
  const drop = Number.isFinite(low) ? ANKLE - low : 0;
  f.root.position.y = drop + Math.max(0, p.lift);
  f.root.updateMatrixWorld(true);
}

export interface StoryStage {
  readonly canvas: HTMLCanvasElement;
  /** Draws the figures in these poses (one per player); the picture is on `canvas` until the next call. */
  draw(poses: readonly StoryPose[]): void;
  dispose(): void;
}

/**
 * The stage of the vertical clip, or null where it cannot be drawn (no WebGL, the model could not be fetched): the clip then has the flat
 * figure instead. `players` figures stand side by side.
 */
export async function createStoryStage(doc: Document, o: { width: number; height: number; players: 1 | 2 }): Promise<StoryStage | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  const owned: { dispose(): void }[] = [];
  try {
    const asset = await loadFigure();
    const canvas = doc.createElement('canvas');
    canvas.width = o.width;
    canvas.height = o.height;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(o.width, o.height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const two = o.players === 2;
    // two players need room for both to reach out to the side
    const camera = new THREE.PerspectiveCamera(two ? 38 : 30, o.width / o.height, 0.1, 50);
    camera.position.set(0, 1.12, two ? 5.0 : 4.7);
    camera.lookAt(0, 0.98, 0);

    // a stage light: warm key from the front left, a cool rim from behind, a soft sky fill
    scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x2a1f55, 1.1));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(-2.2, 4, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2; key.shadow.camera.right = 2; key.shadow.camera.top = 3; key.shadow.camera.bottom = -1;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fc8ff, 1.8);
    rim.position.set(2.5, 2.6, -3);
    scene.add(rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.38 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    owned.push(ground.geometry, ground.material as THREE.Material);

    const figures: Posable[] = [];
    const colours = two ? [STORY_COLOURS.p1, STORY_COLOURS.p2] : [STORY_COLOURS.solo];
    colours.forEach((c, i) => {
      const fig = createFigure(asset, c, (r) => { if (r && typeof (r as { dispose?: unknown }).dispose === 'function') owned.push(r as unknown as { dispose(): void }); return r; });
      // the figure is made to run away from a camera behind it: turned round, it faces this one
      fig.root.rotation.y = Math.PI;
      scene.add(fig.root);
      const bones = new Map<string, THREE.Object3D>();
      const rest = new Map<THREE.Object3D, THREE.Quaternion>();
      fig.root.traverse((x) => { if (POSED.includes(x.name) || /Toe/.test(x.name)) { bones.set(x.name, x); rest.set(x, x.quaternion.clone()); } });
      // two players: Player 1 on the left of the picture, Player 2 on the right, as they stand in front of the camera
      figures.push({ root: fig.root, bones, rest, x: two ? (i === 0 ? -0.55 : 0.55) : 0, dispose: () => fig.dispose() });
    });
    if (figures.length === 0 || figures.some((f) => f.bones.size < 10)) throw new Error('the figure has no rig to pose');

    const r = renderer;
    return {
      canvas,
      draw(poses) {
        figures.forEach((f, i) => { const p = poses[i] ?? poses[0]; if (p) poseFigure(f, p); });
        r.render(scene, camera);
      },
      dispose() {
        for (const f of figures) f.dispose();
        for (const x of owned) { try { x.dispose(); } catch { /* already gone */ } }
        try { r.dispose(); r.forceContextLoss(); } catch { /* the context is gone */ }
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  } catch {
    for (const x of owned) { try { x.dispose(); } catch { /* already gone */ } }
    try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* the context is gone */ }
    return null;
  }
}
