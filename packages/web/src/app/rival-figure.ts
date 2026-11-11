// The rival of a duel link on the stage (sprint arm E): a small 3D figure that takes the pose of the other player, made from the 13
// joints their page sends about fifteen times a second (core/net/pose-frame.ts). Their camera picture never comes: this is all there
// is of them, a lit mannequin of rounded limbs that turns a little to show its depth (it holds still when the player asked for
// reduced motion). One WebGL canvas per rival tile, drawn only when the stage draws the tile (ten times a second). three.js is
// loaded when the first figure is made; where WebGL is missing the tile keeps its flat skeleton.
import type { Landmark } from '../../../core/types/index.ts';

/** The joints the figure is made of (MediaPipe ids): nose, shoulders, elbows, wrists, hips, knees, ankles. */
const J = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28 } as const;
/** The limbs, from joint to joint. */
export const LIMBS: readonly (readonly [number, number])[] = [
  [J.lSh, J.lEl], [J.lEl, J.lWr], [J.rSh, J.rEl], [J.rEl, J.rWr],
  [J.lHip, J.lKn], [J.lKn, J.lAn], [J.rHip, J.rKn], [J.rKn, J.rAn],
  [J.lSh, J.rSh], [J.lHip, J.rHip],
];
const JOINTS: readonly number[] = Object.values(J);
const MIN_VIS = 0.5;
/** The figure's height in scene units, wherever the player stood in their picture. */
export const FIGURE_HEIGHT = 1.7;

export type Point3 = readonly [number, number, number];

export interface FigurePoints {
  /** Scene position of each seen joint (mirrored like a self view, centred, the body fitted to FIGURE_HEIGHT). */
  at: ReadonlyMap<number, Point3>;
  /** The middle of the shoulders and of the hips, when both of each are seen. */
  neck: Point3 | null;
  pelvis: Point3 | null;
  /** The body's scale: the shoulder width in scene units (a fallback when the shoulders are not both seen). */
  span: number;
}

const mid = (a: Point3, b: Point3): Point3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * Where each joint of a pose goes in the figure's scene. Pure. The picture's x is mirrored (the other player moves as in a mirror,
 * like the player's own self view), y points up, and the left side sits a little in front of the right so the figure has depth when
 * it turns. Null for a pose with too little of a body in it.
 */
export function figurePoints(pose: readonly Landmark[] | null, aspect = 4 / 3): FigurePoints | null {
  if (!pose) return null;
  const raw = new Map<number, [number, number]>();
  for (const i of JOINTS) {
    const p = pose[i];
    if (p && p.visibility >= MIN_VIS && Number.isFinite(p.x) && Number.isFinite(p.y)) raw.set(i, [(1 - p.x) * aspect, 1 - p.y]);
  }
  if (raw.size < 4) return null;
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const [x, y] of raw.values()) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  // a body that shows from the head to the ankles is about 0.9 of a person's height between the nose and the ankles
  const tall = Math.max(maxY - minY, 0.05);
  const k = (FIGURE_HEIGHT * 0.9) / tall;
  const cx = (minX + maxX) / 2;
  const at = new Map<number, Point3>();
  for (const [i, [x, y]] of raw) {
    const left = i === J.lSh || i === J.lEl || i === J.lWr || i === J.lHip || i === J.lKn || i === J.lAn;
    const right = i === J.rSh || i === J.rEl || i === J.rWr || i === J.rHip || i === J.rKn || i === J.rAn;
    at.set(i, [(x - cx) * k, (y - minY) * k, left ? 0.08 : right ? -0.08 : 0.04]);
  }
  const ls = at.get(J.lSh), rs = at.get(J.rSh), lh = at.get(J.lHip), rh = at.get(J.rHip);
  const neck = ls && rs ? mid(ls, rs) : null;
  const pelvis = lh && rh ? mid(lh, rh) : null;
  const span = ls && rs ? Math.hypot(ls[0] - rs[0], ls[1] - rs[1]) : lh && rh ? Math.hypot(lh[0] - rh[0], lh[1] - rh[1]) * 1.3 : FIGURE_HEIGHT * 0.22;
  return { at, neck, pelvis, span: Math.max(span, FIGURE_HEIGHT * 0.12) };
}

export interface RivalFigure {
  readonly canvas: HTMLCanvasElement;
  /** Draws the pose (null: the figure fades to nothing; a frozen figure would read as a live one). */
  draw(pose: readonly Landmark[] | null, nowMs: number): void;
  dispose(): void;
}

export interface RivalFigureOptions {
  width: number;
  height: number;
  reducedMotion(): boolean;
  /** The figure's colour (the rival's), as a CSS hex colour. */
  colour?: string;
}

type Three = typeof import('three');

/** Makes the figure on a canvas of its own, or null where three.js or WebGL is not there. */
export async function createRivalFigure(doc: Document, o: RivalFigureOptions): Promise<RivalFigure | null> {
  let T: Three;
  try { T = await import('three'); } catch { return null; }
  const canvas = doc.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'lr-figure';
  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  } catch {
    return null;
  }
  const ratio = Math.min(2, doc.defaultView?.devicePixelRatio ?? 1);
  renderer.setPixelRatio(ratio);
  renderer.setSize(o.width, o.height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, o.width / o.height, 0.1, 50);
  camera.position.set(0, FIGURE_HEIGHT * 0.52, 4.6);
  camera.lookAt(0, FIGURE_HEIGHT * 0.5, 0);
  scene.add(new T.HemisphereLight(0xf4f1ff, 0x2a2140, 1.6));
  const key = new T.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.6, 3, 2.4);
  scene.add(key);
  const rim = new T.DirectionalLight(0x9fd8ff, 1.1);
  rim.position.set(-2, 1.5, -2);
  scene.add(rim);

  const body = new T.Group();
  scene.add(body);
  const skin = new T.MeshStandardMaterial({ color: new T.Color(o.colour ?? '#46B4FF'), roughness: 0.45, metalness: 0.05 });
  const joint = new T.MeshStandardMaterial({ color: new T.Color('#F4F1FF'), roughness: 0.35, metalness: 0.02 });
  const shadowMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  const limbGeo = new T.CylinderGeometry(1, 1, 1, 14, 1);
  const ballGeo = new T.SphereGeometry(1, 18, 12);
  const discGeo = new T.CircleGeometry(1, 28);

  const limbs = LIMBS.map(() => { const m = new T.Mesh(limbGeo, skin); body.add(m); return m; });
  const torso = new T.Mesh(limbGeo, skin);
  const neckM = new T.Mesh(limbGeo, skin);
  const head = new T.Mesh(ballGeo, joint);
  const balls = JOINTS.filter((i) => i !== J.nose).map((i) => { const m = new T.Mesh(ballGeo, joint); body.add(m); return [i, m] as const; });
  body.add(torso, neckM, head);
  const shadow = new T.Mesh(discGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(0.55, 0.3, 1);
  scene.add(shadow);

  const up = new T.Vector3(0, 1, 0);
  const a = new T.Vector3();
  const b = new T.Vector3();
  const dir = new T.Vector3();
  /** Puts a unit cylinder between two points with this radius; false (hidden) when one is missing. */
  const span = (m: import('three').Mesh, p: Point3 | null | undefined, q: Point3 | null | undefined, r: number): void => {
    if (!p || !q) { m.visible = false; return; }
    a.set(p[0], p[1], p[2]);
    b.set(q[0], q[1], q[2]);
    dir.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) { m.visible = false; return; }
    m.visible = true;
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    m.scale.set(r, len, r);
  };

  let shown = 0;
  let lastPose: FigurePoints | null = null;
  let disposed = false;

  return {
    canvas,
    draw(pose, nowMs) {
      if (disposed) return;
      const fp = figurePoints(pose, o.width / o.height);
      if (fp) lastPose = fp;
      // a figure whose frames stopped fades out over a few draws instead of freezing
      shown = fp ? 1 : Math.max(0, shown - 0.25);
      const p = lastPose;
      body.visible = shown > 0 && !!p;
      shadow.visible = body.visible;
      if (p) {
        const limbR = p.span * 0.11;
        LIMBS.forEach(([i, k], n) => span(limbs[n] as import('three').Mesh, p.at.get(i), p.at.get(k), n >= 8 ? limbR * 0.9 : limbR));
        span(torso, p.neck, p.pelvis, p.span * 0.34);
        const nose = p.at.get(J.nose);
        const headAt: Point3 | null = nose ? [nose[0], nose[1] + p.span * 0.18, nose[2]] : p.neck ? [p.neck[0], p.neck[1] + p.span * 0.55, p.neck[2]] : null;
        span(neckM, p.neck, headAt, limbR * 0.9);
        if (headAt) { head.visible = true; head.position.set(headAt[0], headAt[1], headAt[2]); head.scale.setScalar(p.span * 0.32); } else head.visible = false;
        for (const [i, m] of balls) {
          const q = p.at.get(i);
          if (!q) { m.visible = false; continue; }
          m.visible = true;
          m.position.set(q[0], q[1], q[2]);
          m.scale.setScalar(limbR * 1.25);
        }
        const feet = [p.at.get(J.lAn), p.at.get(J.rAn)].filter((x): x is Point3 => !!x);
        const fx = feet.length ? feet.reduce((s, f) => s + f[0], 0) / feet.length : 0;
        shadow.position.set(fx, 0.002, 0);
      }
      skin.opacity = joint.opacity = shown;
      skin.transparent = joint.transparent = shown < 1;
      // a slow turn shows that the figure is round; reduced motion keeps it at a fixed three-quarter angle
      body.rotation.y = o.reducedMotion() ? 0.35 : 0.35 * Math.sin(nowMs / 1600);
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      limbGeo.dispose(); ballGeo.dispose(); discGeo.dispose();
      skin.dispose(); joint.dispose(); shadowMat.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* already lost */ }
      canvas.remove();
    },
  };
}
