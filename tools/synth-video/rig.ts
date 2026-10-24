// Humanoid pose solver for the synthetic-person videos (tools/synth-video).
// A rigged human (any skeleton with the roles below) is posed from a PoseSpec: pelvis placement, a three-segment
// spine, head, and arms and legs by two-bone inverse kinematics. The same code poses
//   - the loaded model in the browser (to render it), and
//   - a virtual skeleton built from a committed rest-pose file (rigs/*.rest.json), in Node, with no mesh,
// and in both cases returns the exact 3D joint positions (ground truth for the detection-quality report and for
// the synthetic fallback traces).
//
// Lengths in a PoseSpec are in torso lengths T (shoulder-joint midpoint to hip-joint midpoint, vertical), the same
// unit the detectors use, so a spec reads the same for a child and a tall adult. Angles are degrees.
// World frame: +Y up, the camera sits on +Z looking toward -Z, a person with yaw 0 faces +Z, so the person's LEFT is
// +X and appears on the image RIGHT of an unmirrored camera frame (MediaPipe landmark 11 is on the image's right).
import * as THREE from 'three';

export type Role =
  | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'
  | 'clavL' | 'armL' | 'foreL' | 'handL' | 'clavR' | 'armR' | 'foreR' | 'handR'
  | 'upLegL' | 'lowLegL' | 'footL' | 'toesL' | 'upLegR' | 'lowLegR' | 'footR' | 'toesR';

/** Optional extra points on the figure (ground truth only). */
export type Extra = 'toesEndL' | 'toesEndR' | 'indexL' | 'indexR' | 'thumbL' | 'thumbR' | 'headEnd' | 'eyeL' | 'eyeR';

export type BoneMap = Record<Role, string> & Partial<Record<Extra, string>>;

const sides = (l: string, r: string, f: (s: 'Left' | 'Right') => string): [string, string] => [f('Left').replace('%', l), f('Right').replace('%', r)];
void sides;

function mapFor(prefix: string, names: { spine: string; chest: string; upperChest: string; toes: string; toesEnd?: string; index?: string; thumb?: string; headEnd?: string; eye?: string }): BoneMap {
  const m: Partial<BoneMap> = {
    hips: `${prefix}Hips`, spine: `${prefix}${names.spine}`, chest: `${prefix}${names.chest}`, upperChest: `${prefix}${names.upperChest}`,
    neck: `${prefix}Neck`, head: `${prefix}Head`,
  };
  for (const [S, k] of [['Left', 'L'], ['Right', 'R']] as const) {
    (m as Record<string, string>)[`clav${k}`] = `${prefix}${S}Shoulder`;
    (m as Record<string, string>)[`arm${k}`] = `${prefix}${S}Arm`;
    (m as Record<string, string>)[`fore${k}`] = `${prefix}${S}ForeArm`;
    (m as Record<string, string>)[`hand${k}`] = `${prefix}${S}Hand`;
    (m as Record<string, string>)[`upLeg${k}`] = `${prefix}${S}UpLeg`;
    (m as Record<string, string>)[`lowLeg${k}`] = `${prefix}${S}Leg`;
    (m as Record<string, string>)[`foot${k}`] = `${prefix}${S}Foot`;
    (m as Record<string, string>)[`toes${k}`] = `${prefix}${S}${names.toes}`;
    if (names.toesEnd) (m as Record<string, string>)[`toesEnd${k}`] = `${prefix}${S}${names.toesEnd}`;
    if (names.index) (m as Record<string, string>)[`index${k}`] = `${prefix}${S}${names.index}`;
    if (names.thumb) (m as Record<string, string>)[`thumb${k}`] = `${prefix}${S}${names.thumb}`;
    if (names.eye) (m as Record<string, string>)[`eye${k}`] = `${prefix}${S}${names.eye}`;
  }
  if (names.headEnd) m.headEnd = `${prefix}${names.headEnd}`;
  return m as BoneMap;
}

/** Kenney "Animated Characters Protagonists" (CC0). */
export const KENNEY_MAP: BoneMap = mapFor('', { spine: 'Spine', chest: 'Chest', upperChest: 'UpperChest', toes: 'Toes', toesEnd: 'Toes_end', index: 'HandIndex1', thumb: 'HandThumb1', headEnd: 'Head_end' });
/** Mixamo skeletons (three.js example models Xbot, Soldier, Michelle; local measurement only, never committed). */
export const MIXAMO_MAP: BoneMap = mapFor('mixamorig', { spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', toes: 'ToeBase', toesEnd: 'Toe_End', index: 'HandIndex1', thumb: 'HandThumb1', headEnd: 'HeadTop_End', eye: 'Eye' });

// ───────── pose description ─────────

export interface ArmCmd {
  /** Direction of the wrist from the shoulder in the chest frame: azimuth 0 = forward, 90 = straight out to the side
   *  (away from the body midline), 180 = backward; negative = across the body. */
  az: number;
  /** Elevation: 90 = straight up, 0 = horizontal, -90 = straight down. */
  el: number;
  /** Wrist distance from the shoulder as a fraction of arm length (default 0.97). */
  reach?: number;
  /** Rotation of the arm about its own axis, degrees. */
  roll?: number;
  /** Elbow pole in the chest frame (x = outward, y = up, z = forward); default out, down and slightly back. */
  pole?: readonly [number, number, number];
}

export interface FootCmd {
  /** Ankle offset from the standing rest position, in T, in the person's frame: x = toward the person's left,
   *  y = up, z = forward. */
  dx?: number; dy?: number; dz?: number;
  /** Toes down (plantar flexion), degrees. */
  pitch?: number;
  /** Toes turned outward, degrees. */
  out?: number;
  /** Knee pole in the person's frame (x = outward, z = forward); default forward and a little outward. */
  pole?: readonly [number, number];
}

export interface PoseSpec {
  /** Where the person stands: x toward the image right, z toward the camera, in T. */
  x?: number; z?: number;
  /** Whole-body turn about the vertical axis, degrees; + = toward the person's left. 90 shows the left... see notes. */
  yaw?: number;
  /** Pelvis up (jump) and down (squat), in T. */
  rise?: number; drop?: number;
  /** Pelvis shifted sideways (+ = toward the person's left) and forward, in T. */
  hipX?: number; hipZ?: number;
  /** Pelvis rotated about the vertical axis (+ = left) and tilted sideways (+ = toward the person's right), degrees. */
  pelvisYaw?: number; pelvisRoll?: number;
  /** Trunk side bend, + = toward the person's right (degrees). */
  side?: number;
  /** Trunk forward flexion (degrees). */
  flex?: number;
  /** Shoulders turned against the pelvis, + = toward the person's left (degrees). */
  twist?: number;
  headYaw?: number; headPitch?: number; headRoll?: number;
  armL?: ArmCmd; armR?: ArmCmd;
  footL?: FootCmd; footR?: FootCmd;
}

export const STAND: Required<Pick<PoseSpec, 'armL' | 'armR'>> = {
  armL: { az: 8, el: -88, reach: 0.985 },
  armR: { az: 8, el: -88, reach: 0.985 },
};

// ───────── geometry ─────────

const V3 = THREE.Vector3;
const Q4 = THREE.Quaternion;
const UP = new V3(0, 1, 0), LEFT_AXIS = new V3(1, 0, 0), FWD = new V3(0, 0, 1);
const rad = (d: number): number => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const qAxis = (axis: THREE.Vector3, deg: number): THREE.Quaternion => new Q4().setFromAxisAngle(axis, rad(deg));

/** Middle joint of a two-bone chain: root, target (wrist or ankle), lengths and a pole direction for the bend. */
export function twoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): { mid: THREE.Vector3; end: THREE.Vector3 } {
  const d = target.clone().sub(root);
  const dist = d.length();
  const max = (l1 + l2) * 0.9995, min = Math.abs(l1 - l2) * 1.0005 + 1e-6;
  const dc = clamp(dist, min, max);
  const u = dist > 1e-9 ? d.multiplyScalar(1 / dist) : new V3(0, -1, 0);
  const a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pp = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u)));
  if (pp.lengthSq() < 1e-10) pp.set(Math.abs(u.x) < 0.9 ? 1 : 0, Math.abs(u.x) < 0.9 ? 0 : 1, 0).cross(u);
  pp.normalize();
  return { mid: root.clone().add(u.clone().multiplyScalar(a)).add(pp.multiplyScalar(h)), end: root.clone().add(u.clone().multiplyScalar(dc)) };
}

// ───────── rest-pose file (Node, no mesh) ─────────

export interface RestNode { n: string; p: number; t: [number, number, number]; q: [number, number, number, number]; s: [number, number, number] }
export interface RestRig {
  id: string;
  /** Licence record for the model this rest pose was measured from. */
  license: string;
  map: 'kenney' | 'mixamo';
  /** Height of the mesh in the file's own units (so a scale to metres can be chosen). */
  heightUnits: number;
  /** Nodes in parent-first order; p = index of the parent or -1. */
  nodes: RestNode[];
}

/** Captures the node tree under `root` (parent-first) so a virtual skeleton can be rebuilt without the model file. */
export function captureRest(root: THREE.Object3D, meta: Pick<RestRig, 'id' | 'license' | 'map' | 'heightUnits'>): RestRig {
  const nodes: RestNode[] = [];
  const index = new Map<THREE.Object3D, number>();
  const visit = (o: THREE.Object3D, parent: number): void => {
    if ((o as THREE.Mesh).isMesh) return;
    const i = nodes.length;
    index.set(o, i);
    nodes.push({
      n: o.name, p: parent,
      t: [o.position.x, o.position.y, o.position.z].map(round6) as [number, number, number],
      q: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].map(round8) as [number, number, number, number],
      s: [o.scale.x, o.scale.y, o.scale.z].map(round6) as [number, number, number],
    });
    for (const c of o.children) visit(c, i);
  };
  for (const c of root.children) visit(c, -1);
  return { ...meta, nodes };
}
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const round8 = (v: number): number => Math.round(v * 1e8) / 1e8;

/** A skeleton of plain Object3D nodes from a rest file; it poses exactly like the loaded model. */
export function buildVirtualRoot(rest: RestRig): THREE.Object3D {
  const root = new THREE.Group();
  const made: THREE.Object3D[] = [];
  for (const n of rest.nodes) {
    const o = new THREE.Object3D();
    o.name = n.n;
    o.position.set(...n.t);
    o.quaternion.set(...n.q);
    o.scale.set(...n.s);
    made.push(o);
    (n.p < 0 ? root : (made[n.p] as THREE.Object3D)).add(o);
  }
  return root;
}

// ───────── the humanoid ─────────

export type JointName = Role | Extra | 'noseTip';
export type Joints = Partial<Record<JointName, THREE.Vector3>>;

interface Rest { pos: Record<string, THREE.Vector3>; quat: Record<string, THREE.Quaternion> }

export interface HumanoidOptions {
  /** Body height in metres (the mesh's own height is scaled to this). */
  height: number;
  /** Height of the mesh in the file's units (box of the skinned mesh in the rest pose). */
  heightUnits: number;
}

const SPINE_WEIGHTS: [Role, number][] = [['spine', 0.3], ['chest', 0.65], ['upperChest', 1]];

export class Humanoid {
  readonly holder = new THREE.Group();
  /** Torso length (shoulder-joint midpoint to hip-joint midpoint), shoulder width, arm and thigh length, metres. */
  readonly T: number; readonly W: number; readonly A: number; readonly U: number;
  readonly height: number;
  private readonly node = new Map<string, THREE.Object3D>();
  private readonly localRest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private readonly rest: Rest = { pos: {}, quat: {} };
  private readonly pivot = new V3();
  private readonly lens: Record<string, number> = {};
  private readonly dirs: Record<string, THREE.Vector3> = {};

  readonly map: BoneMap;

  constructor(root: THREE.Object3D, map: BoneMap, o: HumanoidOptions) {
    this.map = map;
    this.height = o.height;
    this.holder.add(root);
    root.traverse((n) => { if (n.name) this.node.set(n.name, n); this.localRest.set(n, { p: n.position.clone(), q: n.quaternion.clone() }); });
    for (const r of Object.keys(this.map) as (Role | Extra)[]) {
      const name = this.map[r];
      if (name && !this.node.has(name)) { if (isRole(r)) throw new Error(`The skeleton has no bone '${name}' (role ${r}).`); delete this.map[r]; }
    }
    // Facing: the toes point from the ankle toward the front. Turn the model so that front is +Z.
    this.holder.updateMatrixWorld(true);
    const fL = this.worldPos('footL'), tL = this.worldPos('toesL');
    const fwd = new V3(tL.x - fL.x, 0, tL.z - fL.z);
    const turn = Math.atan2(fwd.x, fwd.z);
    this.holder.rotation.y = -turn;
    this.holder.scale.setScalar(o.height / o.heightUnits);
    this.holder.updateMatrixWorld(true);
    for (const r of Object.keys(this.map) as (Role | Extra)[]) {
      this.rest.pos[r] = this.worldPos(r);
      this.rest.quat[r] = this.worldQuat(r);
    }
    const P = this.rest.pos as Record<Role, THREE.Vector3>;
    this.T = (P.armL.y + P.armR.y) / 2 - (P.upLegL.y + P.upLegR.y) / 2;
    this.W = P.armL.distanceTo(P.armR);
    this.lens.armUp = P.armL.distanceTo(P.foreL); this.lens.armLow = P.foreL.distanceTo(P.handL);
    this.lens.legUp = P.upLegL.distanceTo(P.lowLegL); this.lens.legLow = P.lowLegL.distanceTo(P.footL);
    this.A = this.lens.armUp + this.lens.armLow;
    this.U = this.lens.legUp;
    const dir = (a: Role, b: Role): THREE.Vector3 => P[b].clone().sub(P[a]).normalize();
    for (const s of ['L', 'R'] as const) {
      this.dirs[`arm${s}`] = dir(`arm${s}`, `fore${s}`); this.dirs[`fore${s}`] = dir(`fore${s}`, `hand${s}`);
      this.dirs[`upLeg${s}`] = dir(`upLeg${s}`, `lowLeg${s}`); this.dirs[`lowLeg${s}`] = dir(`lowLeg${s}`, `foot${s}`);
      this.dirs[`foot${s}`] = dir(`foot${s}`, `toes${s}`);
    }
    this.pivot.set((P.footL.x + P.footR.x) / 2, 0, (P.footL.z + P.footR.z) / 2);
  }

  private bone(r: Role | Extra): THREE.Object3D { return this.node.get(this.map[r] as string) as THREE.Object3D; }
  private worldPos(r: Role | Extra): THREE.Vector3 { return this.bone(r).getWorldPosition(new V3()); }
  private worldQuat(r: Role | Extra): THREE.Quaternion { return this.bone(r).getWorldQuaternion(new Q4()); }
  /** Rest-pose world position of a role (metres). */
  restPos(r: Role | Extra): THREE.Vector3 { return (this.rest.pos[r] as THREE.Vector3).clone(); }

  /** Sets a bone's world rotation (and position when given); the bone's parent must already be final. */
  private setWorld(r: Role, quat: THREE.Quaternion, pos?: THREE.Vector3): void {
    const b = this.bone(r), parent = b.parent as THREE.Object3D;
    if (pos) b.position.copy(parent.worldToLocal(pos.clone()));
    const pq = parent.getWorldQuaternion(new Q4());
    b.quaternion.copy(pq.invert().multiply(quat));
    b.updateMatrixWorld(true);
  }

  /** Back to the rest pose (every node's own local transform). */
  reset(): void {
    for (const [n, r] of this.localRest) { n.position.copy(r.p); n.quaternion.copy(r.q); }
    this.holder.updateMatrixWorld(true);
  }

  /** Poses the figure and returns the world positions of its joints (metres). */
  pose(s: PoseSpec): Joints {
    this.reset();
    const T = this.T;
    const P = this.rest.pos as Record<Role, THREE.Vector3>, R = this.rest.quat as Record<Role, THREE.Quaternion>;
    const yawQ = qAxis(UP, s.yaw ?? 0);
    const shift = new V3((s.x ?? 0) * T, 0, (s.z ?? 0) * T);
    // person frame -> world: rotate about the stance centre, then move to the spot
    const place = (rest: THREE.Vector3, off?: THREE.Vector3): THREE.Vector3 => rest.clone().sub(this.pivot).add(off ?? new V3()).applyQuaternion(yawQ).add(this.pivot).add(shift);
    const frame = (off: THREE.Vector3): THREE.Vector3 => off.clone().applyQuaternion(yawQ);

    // pelvis
    const hipsOff = new V3(-(s.hipX ?? 0) * -T, ((s.rise ?? 0) - (s.drop ?? 0)) * T, (s.hipZ ?? 0) * T);
    const pelvisRot = yawQ.clone().multiply(qAxis(UP, s.pelvisYaw ?? 0)).multiply(qAxis(FWD, s.pelvisRoll ?? 0));
    this.setWorld('hips', pelvisRot.clone().multiply(R.hips), place(P.hips, hipsOff));

    // spine: side bend about the forward axis, flexion about the left axis, twist about the up axis, shared out
    const seg = (c: number): THREE.Quaternion => pelvisRot.clone()
      .multiply(qAxis(FWD, (s.side ?? 0) * c)).multiply(qAxis(LEFT_AXIS, (s.flex ?? 0) * c)).multiply(qAxis(UP, (s.twist ?? 0) * c));
    for (const [r, c] of SPINE_WEIGHTS) this.setWorld(r, seg(c).multiply(R[r]));
    const chestRot = seg(1);
    const head = (c: number): THREE.Quaternion => chestRot.clone()
      .multiply(qAxis(UP, (s.headYaw ?? 0) * c)).multiply(qAxis(LEFT_AXIS, (s.headPitch ?? 0) * c)).multiply(qAxis(FWD, (s.headRoll ?? 0) * c));
    this.setWorld('neck', head(0.4).multiply(R.neck));
    this.setWorld('head', head(1).multiply(R.head));

    // clavicles rise a little with the arm
    for (const side of ['L', 'R'] as const) {
      const cmd = (side === 'L' ? s.armL : s.armR) ?? STAND.armL;
      const shrug = clamp(cmd.el, 0, 90) * 0.15;
      const roll = qAxis(FWD, side === 'L' ? shrug : -shrug);
      this.setWorld(`clav${side}`, chestRot.clone().multiply(roll).multiply(R[`clav${side}`]));
    }

    // arms: the wrist goes where the command says, the elbow follows by two-bone IK
    for (const side of ['L', 'R'] as const) {
      const cmd = (side === 'L' ? s.armL : s.armR) ?? STAND.armL;
      const out = side === 'L' ? 1 : -1;
      const shoulder = this.worldPos(`arm${side}`);
      const az = rad(cmd.az), el = rad(cmd.el);
      const dirC = new V3(out * Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const wristT = shoulder.clone().add(dirC.applyQuaternion(chestRot).multiplyScalar((cmd.reach ?? 0.97) * this.A));
      const pc = cmd.pole ?? [0.6, -0.8, -0.2];
      const pole = new V3(out * pc[0], pc[1], pc[2]).applyQuaternion(chestRot);
      const { mid, end } = twoBone(shoulder, wristT, this.lens.armUp as number, this.lens.armLow as number, pole);
      const dUp = mid.clone().sub(shoulder).normalize(), dLow = end.clone().sub(mid).normalize();
      const roll = cmd.roll ?? 0;
      const qUp = new Q4().setFromUnitVectors(this.dirs[`arm${side}`] as THREE.Vector3, dUp);
      const qLow = new Q4().setFromUnitVectors(this.dirs[`fore${side}`] as THREE.Vector3, dLow);
      this.setWorld(`arm${side}`, qAxis(dUp, roll).multiply(qUp).multiply(R[`arm${side}`]));
      this.setWorld(`fore${side}`, qAxis(dLow, roll).multiply(qLow).multiply(R[`fore${side}`]));
      this.setWorld(`hand${side}`, qAxis(dLow, roll).multiply(qLow).multiply(R[`hand${side}`]));
    }

    // legs: the ankle goes where the command says (default: stays where it stood), the knee follows
    for (const side of ['L', 'R'] as const) {
      const f = (side === 'L' ? s.footL : s.footR) ?? {};
      const hip = this.worldPos(`upLeg${side}`);
      const ankleT = place(P[`foot${side}`], new V3((f.dx ?? 0) * T, (f.dy ?? 0) * T, (f.dz ?? 0) * T));
      const outSign = side === 'L' ? 1 : -1;
      const pc = f.pole ?? [0.15, 1];
      const pole = frame(new V3(outSign * pc[0], 0, pc[1]));
      const { mid, end } = twoBone(hip, ankleT, this.lens.legUp as number, this.lens.legLow as number, pole);
      const dUp = mid.clone().sub(hip).normalize(), dLow = end.clone().sub(mid).normalize();
      this.setWorld(`upLeg${side}`, new Q4().setFromUnitVectors(this.dirs[`upLeg${side}`] as THREE.Vector3, dUp).multiply(R[`upLeg${side}`]));
      this.setWorld(`lowLeg${side}`, new Q4().setFromUnitVectors(this.dirs[`lowLeg${side}`] as THREE.Vector3, dLow).multiply(R[`lowLeg${side}`]));
      // foot: toes along the person's front, pitched down by `pitch`, turned out by `out`
      const restDir = this.dirs[`foot${side}`] as THREE.Vector3;
      const toeDir = restDir.clone().applyQuaternion(qAxis(UP, outSign * -(f.out ?? 0))).applyQuaternion(qAxis(LEFT_AXIS, f.pitch ?? 0)).applyQuaternion(yawQ);
      const qFoot = new Q4().setFromUnitVectors(restDir, toeDir);
      this.setWorld(`foot${side}`, qFoot.clone().multiply(R[`foot${side}`]));
      if (this.map[`toes${side}`]) this.setWorld(`toes${side}`, qFoot.clone().multiply(R[`toes${side}`]));
    }
    this.holder.updateMatrixWorld(true);
    return this.joints();
  }

  /** World positions of every mapped joint in the current pose. */
  joints(): Joints {
    const out: Joints = {};
    for (const r of Object.keys(this.map) as (Role | Extra)[]) out[r] = this.worldPos(r);
    return out;
  }
}

const ROLES: Role[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'clavL', 'armL', 'foreL', 'handL', 'clavR', 'armR', 'foreR', 'handR',
  'upLegL', 'lowLegL', 'footL', 'toesL', 'upLegR', 'lowLegR', 'footR', 'toesR'];
const isRole = (r: string): r is Role => (ROLES as string[]).includes(r);
