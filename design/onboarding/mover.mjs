// The Mover: BodyArcade's 3D character, built from capsules so it matches the logo
// (ball head, capsule limbs). No external model, no licence to track, a handful of draw calls.
// Left wristband is sun, right is sky: the same left/right colours the HUD uses for hands.
import * as THREE from 'three';

export const BODY = {
  hipY: 0.93, torso: 0.5, torsoR: 0.17, headR: 0.2, neck: 0.25,
  shoulderX: 0.175, upperArm: 0.29, foreArm: 0.27, armR: 0.066,
  hipX: 0.1, thigh: 0.42, shin: 0.42, legR: 0.086,
};

export function createMover(colors) {
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.62, metalness: 0 }),
    head: new THREE.MeshStandardMaterial({ color: colors.head, roughness: 0.28, metalness: 0 }),
    left: new THREE.MeshStandardMaterial({ color: colors.left, roughness: 0.5 }),
    right: new THREE.MeshStandardMaterial({ color: colors.right, roughness: 0.5 }),
    shoe: new THREE.MeshStandardMaterial({ color: colors.shoe, roughness: 0.7 }),
    glow: new THREE.MeshStandardMaterial({ color: colors.highlight, roughness: 0.5, emissive: colors.highlight, emissiveIntensity: 0 }),
  };
  const B = BODY;
  const root = new THREE.Group();
  root.name = 'mover';
  const joints = {};
  const parts = {}; // meshes by segment, for region highlights and the skeleton view

  const capsule = (len, r, mat, name) => {
    // Bone capsule: the cap centres sit exactly on the two joints, so bent elbows and
    // knees stay closed instead of pinching to a point.
    const g = new THREE.CapsuleGeometry(r, len, 5, 12);
    g.translate(0, -len / 2, 0); // hangs down from its pivot
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.name = name;
    parts[name] = m;
    return m;
  };
  const pivot = (name, parent, x = 0, y = 0, z = 0) => {
    const o = new THREE.Object3D();
    o.name = name; o.position.set(x, y, z);
    parent.add(o); joints[name] = o; return o;
  };

  const pelvis = pivot('pelvis', root, 0, B.hipY, 0);
  const spine = pivot('spine', pelvis);
  const torso = capsule(B.torso - 0.06, B.torsoR, mats.body, 'torso');
  torso.geometry.translate(0, B.torso - 0.06, 0); // stands up from the pelvis
  torso.position.y = 0.03;
  spine.add(torso);
  const neck = pivot('neck', spine, 0, B.torso, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(B.headR, 28, 20), mats.head);
  head.position.y = B.neck; head.castShadow = true; head.name = 'head';
  neck.add(head); parts.head = head;

  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1; // the Mover faces +z, so its left is +x
    const sh = pivot(`shoulder${side}`, neck, sx * B.shoulderX, -0.07, 0);
    sh.add(capsule(B.upperArm, B.armR, mats.body, `upperArm${side}`));
    const el = pivot(`elbow${side}`, sh, 0, -B.upperArm, 0);
    el.add(capsule(B.foreArm, B.armR * 0.95, mats.body, `foreArm${side}`));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(B.armR * 1.25, B.armR * 1.25, 0.07, 14), side === 'L' ? mats.left : mats.right);
    band.position.y = -B.foreArm + 0.05; band.castShadow = true;
    el.add(band);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.082, 16, 12), mats.body);
    hand.position.y = -B.foreArm - 0.03; hand.castShadow = true; hand.name = `hand${side}`;
    el.add(hand); parts[`hand${side}`] = hand;
    joints[`hand${side}`] = hand;

    const hip = pivot(`hip${side}`, pelvis, sx * B.hipX, 0, 0);
    hip.add(capsule(B.thigh, B.legR, mats.body, `thigh${side}`));
    const knee = pivot(`knee${side}`, hip, 0, -B.thigh, 0);
    knee.add(capsule(B.shin, B.legR * 0.92, mats.body, `shin${side}`));
    const ankle = pivot(`ankle${side}`, knee, 0, -B.shin, 0);
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.13, 4, 10), mats.shoe);
    shoe.rotation.x = Math.PI / 2; shoe.position.set(0, -0.015, 0.06); shoe.castShadow = true; shoe.name = `shoe${side}`;
    ankle.add(shoe); parts[`shoe${side}`] = shoe;
  }

  return { root, joints, parts, mats };
}

// ---------------- Poses ----------------
// Angles in radians. x on limbs: negative swings forward (towards the camera).
// Shoulder z: positive raises the left arm sideways, negative raises the right arm.
const Z = { x: 0, y: 0, z: 0 };
const pose = (o) => ({
  pelvis: { y: 0, z: 0, x: 0, rx: 0, ry: 0, rz: 0, ...(o.pelvis || {}) },
  spine: { ...Z, ...(o.spine || {}) }, neck: { ...Z, ...(o.neck || {}) },
  shoulderL: { ...Z, ...(o.shoulderL || {}) }, shoulderR: { ...Z, ...(o.shoulderR || {}) },
  elbowL: { ...Z, ...(o.elbowL || {}) }, elbowR: { ...Z, ...(o.elbowR || {}) },
  hipL: { ...Z, ...(o.hipL || {}) }, hipR: { ...Z, ...(o.hipR || {}) },
  kneeL: { ...Z, ...(o.kneeL || {}) }, kneeR: { ...Z, ...(o.kneeR || {}) },
  ankleL: { ...Z, ...(o.ankleL || {}) }, ankleR: { ...Z, ...(o.ankleR || {}) },
  footsFlat: o.footsFlat ?? true,
});

export const POSES = {
  stand: pose({
    shoulderL: { z: 0.12, x: 0.05 }, shoulderR: { z: -0.12, x: 0.05 }, elbowL: { x: -0.18 }, elbowR: { x: -0.18 },
    hipL: { z: 0.04 }, hipR: { z: -0.04 },
  }),
  breathe: pose({
    pelvis: { y: -0.01 }, spine: { x: 0.03 },
    shoulderL: { z: 0.16, x: 0.0 }, shoulderR: { z: -0.16, x: 0.0 }, elbowL: { x: -0.24 }, elbowR: { x: -0.24 },
    hipL: { z: 0.04 }, hipR: { z: -0.04 },
  }),
  squat: pose({
    pelvis: { y: -0.36, z: -0.24 }, spine: { x: 0.62 }, neck: { x: -0.45 },
    shoulderL: { x: -1.62, z: 0.12 }, shoulderR: { x: -1.62, z: -0.12 }, elbowL: { x: -0.08 }, elbowR: { x: -0.08 },
    hipL: { x: -1.38, z: 0.24 }, hipR: { x: -1.38, z: -0.24 }, kneeL: { x: 1.55 }, kneeR: { x: 1.55 },
  }),
  dip: pose({
    pelvis: { y: -0.12, z: -0.04 }, spine: { x: 0.28 }, neck: { x: -0.15 },
    shoulderL: { x: 0.55, z: 0.12 }, shoulderR: { x: 0.55, z: -0.12 }, elbowL: { x: -0.2 }, elbowR: { x: -0.2 },
    hipL: { x: -0.55, z: 0.06 }, hipR: { x: -0.55, z: -0.06 }, kneeL: { x: 0.85 }, kneeR: { x: 0.85 },
  }),
  // The logo pose: tilted body, arms up in a Y, at the top of the jump.
  apex: pose({
    pelvis: { y: 0.34, rz: -0.16 }, spine: { x: -0.06 }, neck: { x: 0.08, z: -0.05 },
    shoulderL: { z: 2.55, x: -0.15 }, shoulderR: { z: -2.15, x: -0.25 }, elbowL: { x: -0.08 }, elbowR: { x: -0.1 },
    hipL: { x: 0.06, z: 0.08 }, hipR: { x: 0.22, z: -0.06 }, kneeL: { x: 0.25 }, kneeR: { x: 0.55 },
    ankleL: { x: 0.45 }, ankleR: { x: 0.55 }, footsFlat: false,
  }),
  land: pose({
    pelvis: { y: -0.16, z: -0.06 }, spine: { x: 0.3 }, neck: { x: -0.18 },
    shoulderL: { x: -0.5, z: 0.45 }, shoulderR: { x: -0.5, z: -0.45 }, elbowL: { x: -0.4 }, elbowR: { x: -0.4 },
    hipL: { x: -0.72, z: 0.1 }, hipR: { x: -0.72, z: -0.1 }, kneeL: { x: 1.05 }, kneeR: { x: 1.05 },
  }),
  guard: pose({
    pelvis: { y: -0.06, ry: 0.32 }, spine: { x: 0.08 }, neck: { y: -0.3 },
    shoulderL: { x: -0.95, z: 0.32 }, shoulderR: { x: -0.85, z: -0.38 }, elbowL: { x: -1.85 }, elbowR: { x: -2.0 },
    hipL: { x: -0.38, z: 0.1 }, hipR: { x: 0.3, z: -0.12 }, kneeL: { x: 0.38 }, kneeR: { x: 0.32 },
  }),
  jab: pose({
    pelvis: { y: -0.07, ry: 0.42 }, spine: { x: 0.12, y: 0.12 }, neck: { y: -0.45 },
    shoulderL: { x: -1.5, z: 0.12 }, shoulderR: { x: -0.85, z: -0.38 }, elbowL: { x: -0.05 }, elbowR: { x: -2.0 },
    hipL: { x: -0.4, z: 0.1 }, hipR: { x: 0.32, z: -0.12 }, kneeL: { x: 0.42 }, kneeR: { x: 0.3 },
  }),
  cross: pose({
    pelvis: { y: -0.08, ry: -0.18 }, spine: { x: 0.14, y: -0.32 }, neck: { y: 0.4 },
    shoulderL: { x: -0.95, z: 0.34 }, shoulderR: { x: -1.52, z: -0.1 }, elbowL: { x: -1.9 }, elbowR: { x: -0.04 },
    hipL: { x: -0.4, z: 0.1 }, hipR: { x: 0.3, z: -0.12 }, kneeL: { x: 0.42 }, kneeR: { x: 0.36 },
    ankleR: { x: 0.3 },
  }),
  tPose: pose({
    shoulderL: { z: 1.5 }, shoulderR: { z: -1.5 }, elbowL: { x: 0 }, elbowR: { x: 0 },
    hipL: { z: 0.12 }, hipR: { z: -0.12 },
  }),
};

// One loop of the hero: squat, jump (logo pose at the top), land, jab, cross, back to ready.
// [time in seconds, pose, easing into this key]
export const HERO_LOOP = {
  length: 5.2,
  keys: [
    [0.0, 'stand', 'inOut'],
    [0.55, 'squat', 'inOut'],
    [1.0, 'squat', 'linear'],
    [1.32, 'dip', 'out'],
    [1.58, 'apex', 'out'],
    [1.82, 'apex', 'linear'],
    [2.08, 'land', 'in'],
    [2.42, 'stand', 'inOut'],
    [2.8, 'guard', 'inOut'],
    [3.02, 'jab', 'out'],
    [3.22, 'guard', 'inOut'],
    [3.46, 'cross', 'out'],
    [3.7, 'guard', 'inOut'],
    [4.35, 'stand', 'inOut'],
    [5.2, 'stand', 'linear'],
  ],
  events: { flap: 1.2, jump: 1.58, jab: 3.02, cross: 3.46 },
};

const EASE = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

const lerp = (a, b, t) => a + (b - a) * t;
function mixPose(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 'footsFlat') { out[k] = t < 0.5 ? a[k] : b[k]; continue; }
    out[k] = {};
    for (const c of Object.keys(a[k])) out[k][c] = lerp(a[k][c], b[k][c], t);
  }
  return out;
}

/** Pose at time t (seconds) on a loop. */
export function sampleLoop(loop, t) {
  const tt = ((t % loop.length) + loop.length) % loop.length;
  const ks = loop.keys;
  for (let i = 0; i < ks.length - 1; i++) {
    const [t0, p0] = ks[i];
    const [t1, p1, ease] = ks[i + 1];
    if (tt >= t0 && tt <= t1) {
      const f = EASE[ease]((tt - t0) / Math.max(1e-6, t1 - t0));
      return mixPose(POSES[p0], POSES[p1], f);
    }
  }
  return POSES[ks[0][1]];
}

/** Apply a pose to the rig. Feet stay flat on the floor unless the pose points the toes. */
export function applyPose(mover, p) {
  const J = mover.joints;
  J.pelvis.position.set(p.pelvis.x, BODY.hipY + p.pelvis.y, p.pelvis.z);
  J.pelvis.rotation.set(p.pelvis.rx, p.pelvis.ry, p.pelvis.rz);
  for (const k of ['spine', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR', 'kneeL', 'kneeR']) {
    J[k].rotation.set(p[k].x, p[k].y, p[k].z);
  }
  for (const s of ['L', 'R']) {
    const a = p[`ankle${s}`];
    const flat = p.footsFlat ? -(p[`hip${s}`].x + p[`knee${s}`].x) : 0;
    J[`ankle${s}`].rotation.set(flat + a.x, 0, -p[`hip${s}`].z - p.pelvis.rz);
  }
}

/** Light up body regions (onboarding step 3). regions: Set of 'legs' | 'arms' | 'chest-back' | 'core' | 'cardio' | 'balance' */
export function highlightRegions(mover, regions, amount = 1) {
  const map = {
    legs: ['thighL', 'thighR', 'shinL', 'shinR'],
    arms: ['upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR'],
    'chest-back': ['torso', 'upperArmL', 'upperArmR'],
    core: ['torso'],
    cardio: ['torso', 'thighL', 'thighR', 'shinL', 'shinR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR'],
    balance: ['thighL', 'shinL', 'torso'],
  };
  const lit = new Set();
  for (const r of regions) for (const n of map[r] || []) lit.add(n);
  for (const [name, mesh] of Object.entries(mover.parts)) {
    if (name.startsWith('shoe') || name === 'head') continue;
    mesh.material = lit.has(name) && amount > 0 ? mover.mats.glow : mover.mats.body;
  }
  mover.mats.glow.emissiveIntensity = 0.18 * amount;
}
