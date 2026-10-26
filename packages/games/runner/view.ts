// Runner view: the runner, the obstacles, the coins and the camera on the render3d scene kit (site/game/engine.js
// 289-383 and 595-700, ported). The kit owns the world (sky, road, scenery, weather, lights); this file owns what
// the runner game puts on the stage.
// - Obstacles are kit prototypes (one shape per kind and world-independent, shared geometry), spawned and released
//   by obstacle id, so a run makes no geometry per obstacle and frees nothing it shares (B5).
// - Coins are one instanced draw call (kit.pickups).
// - Everything moves with the SIMULATION: positions are interpolated between the last two steps with alpha, the
//   animation phase comes from the distance run, and the camera shake draws from ctx.rng('fx'). Only the frame cap
//   reads the real clock, so a paused game draws nothing new and a replay looks the same.
// - The rig's own geometries, materials and textures belong to this view's tracker and are freed by dispose().
import * as THREE from 'three';
import type { Rng, ThemeData } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { ResourceTracker } from '../../core/render3d/dispose.ts';
import type { Scene3DKit } from '../../core/render3d/scene3d.ts';
import { arrowPixels, makeTexture, stripePixels } from '../../core/render3d/textures.ts';
import { LANE_W, type Obstacle, type Run } from './sim.ts';

/** Road width of today's engine (engine.js ROAD_W). */
export const ROAD_W = 5.6;

export const SKINS = {
  runner: { body: '#ff4f24', legs: '#15130f', skin: '#e8b68a', accent: '#ffc93c', head: 'cap' },
  ninja: { body: '#1c1c22', legs: '#15130f', skin: '#d9a77c', accent: '#ff4f24', head: 'band' },
  knight: { body: '#9aa2ad', legs: '#5b616b', skin: '#c9c9c9', accent: '#ffc93c', head: 'helm' },
  astronaut: { body: '#f0f2f5', legs: '#d5d9df', skin: '#1a2a44', accent: '#ff4f24', head: 'dome' },
  wizard: { body: '#6b3fb5', legs: '#2d1b4e', skin: '#e8b68a', accent: '#ffc93c', head: 'hat' },
  robot: { body: '#4a8ad8', legs: '#2a4a74', skin: '#b8c7dc', accent: '#5cdfff', head: 'box' },
  demon: { body: '#b8232b', legs: '#3a0f12', skin: '#d94a4a', accent: '#ffb347', head: 'horns' },
  angel: { body: '#fff7e0', legs: '#e8dcc0', skin: '#e8b68a', accent: '#ffd36b', head: 'halo' },
} as const;
export type SkinId = keyof typeof SKINS;

/** The runner between two steps (the view interpolates from this to the run's current state). */
export interface RunnerPose { x: number; y: number; crouch: number; lean: number; jumpU: number; dist: number }

export const poseOf = (r: Readonly<Run>): RunnerPose => ({ x: r.x, y: r.y, crouch: r.crouch, lean: r.lean, jumpU: r.jumpU, dist: r.dist });

export interface RunnerView {
  /** A new run in a world: the kit builds the world (or keeps it when it is the same); stage and coins start empty. */
  begin(world: ThemeData): void;
  render(run: Readonly<Run>, prev: RunnerPose, alpha: number): void;
  dispose(): void;
}

interface Limb { up: THREE.Group; low: THREE.Group }
interface Rig { root: THREE.Group; hips: THREE.Group; torso: THREE.Group; headG: THREE.Group; armL: Limb; armR: Limb; legL: Limb; legR: Limb; mats: THREE.MeshStandardMaterial[] }

function buildRunner(skinId: SkinId, track: ResourceTracker): Rig {
  const sk = SKINS[skinId] ?? SKINS.runner;
  const mat = (c: string, extra: THREE.MeshStandardMaterialParameters = {}) => track.track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05, ...extra }));
  const mBody = mat(sk.body), mLegs = mat(sk.legs), mSkin = mat(sk.skin), mAcc = mat(sk.accent);
  const root = new THREE.Group();
  root.name = 'runner';
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const mk = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(track.track(geo), m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  mk(new THREE.CapsuleGeometry(0.17, 0.08, 4, 10), mLegs, hips, 0, 0.02, 0).scale.set(1, 0.7, 0.8);
  const torso = new THREE.Group(); torso.position.y = 0.12; hips.add(torso);
  mk(new THREE.CapsuleGeometry(0.19, 0.3, 4, 12), mBody, torso, 0, 0.3, 0).scale.set(1, 1, 0.72);
  mk(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), mSkin, torso, 0, 0.6, 0);
  const headG = new THREE.Group(); headG.position.y = 0.78; torso.add(headG);
  const head = mk(new THREE.SphereGeometry(0.15, 14, 12), mSkin, headG, 0, 0, 0); head.scale.set(0.95, 1.05, 0.95);
  if (sk.head === 'cap') { mk(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mAcc, headG, 0, 0.02, 0); mk(new THREE.BoxGeometry(0.2, 0.03, 0.14), mAcc, headG, 0, 0.03, 0.16); }
  else if (sk.head === 'band') { mk(new THREE.TorusGeometry(0.15, 0.025, 6, 16), mAcc, headG, 0, 0.03, 0).rotation.x = Math.PI / 2; }
  else if (sk.head === 'helm') { mk(new THREE.SphereGeometry(0.18, 12, 10), mBody, headG, 0, 0.01, 0); mk(new THREE.BoxGeometry(0.03, 0.14, 0.2), mAcc, headG, 0, 0.17, 0); }
  else if (sk.head === 'dome') { mk(new THREE.SphereGeometry(0.2, 14, 12), mat('#9fd8ff', { transparent: true, opacity: 0.45, roughness: 0.2 }), headG, 0, 0, 0); }
  else if (sk.head === 'hat') { mk(new THREE.ConeGeometry(0.16, 0.42, 10), mBody, headG, 0, 0.3, 0).rotation.z = 0.15; mk(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 12), mBody, headG, 0, 0.1, 0); }
  else if (sk.head === 'box') { head.visible = false; mk(new THREE.BoxGeometry(0.26, 0.26, 0.24), mSkin, headG, 0, 0, 0); mk(new THREE.BoxGeometry(0.18, 0.05, 0.02), mat(sk.accent, { emissive: sk.accent, emissiveIntensity: 1.2 }), headG, 0, 0.01, 0.13); }
  else if (sk.head === 'horns') { for (const s of [-1, 1]) mk(new THREE.ConeGeometry(0.04, 0.16, 6), mAcc, headG, s * 0.1, 0.16, 0).rotation.z = -s * 0.5; }
  else if (sk.head === 'halo') { mk(new THREE.TorusGeometry(0.13, 0.018, 6, 20), mat(sk.accent, { emissive: sk.accent, emissiveIntensity: 1.5 }), headG, 0, 0.26, 0).rotation.x = Math.PI / 2; }

  const limb = (parent: THREE.Object3D, x: number, y: number, upperR: number, upperL: number, lowerR: number, lowerL: number, mUp: THREE.Material, mLow: THREE.Material, endGeo: THREE.BufferGeometry, endMat: THREE.Material): Limb => {
    const up = new THREE.Group(); up.position.set(x, y, 0); parent.add(up);
    mk(new THREE.CapsuleGeometry(upperR, upperL, 4, 8), mUp, up, 0, -upperL / 2 - upperR * 0.5, 0);
    const low = new THREE.Group(); low.position.y = -upperL - upperR * 0.9; up.add(low);
    mk(new THREE.CapsuleGeometry(lowerR, lowerL, 4, 8), mLow, low, 0, -lowerL / 2 - lowerR * 0.5, 0);
    mk(endGeo, endMat, low, 0, -lowerL - lowerR * 0.8, endGeo.type === 'BoxGeometry' ? 0.05 : 0);
    return { up, low };
  };
  const armL = limb(torso, -0.27, 0.5, 0.055, 0.24, 0.05, 0.22, mBody, mSkin, new THREE.SphereGeometry(0.055, 8, 6), mSkin);
  const armR = limb(torso, 0.27, 0.5, 0.055, 0.24, 0.05, 0.22, mBody, mSkin, new THREE.SphereGeometry(0.055, 8, 6), mSkin);
  const legL = limb(hips, -0.11, -0.02, 0.085, 0.36, 0.07, 0.34, mLegs, mLegs, new THREE.BoxGeometry(0.12, 0.07, 0.24), mAcc);
  const legR = limb(hips, 0.11, -0.02, 0.085, 0.36, 0.07, 0.34, mLegs, mLegs, new THREE.BoxGeometry(0.12, 0.07, 0.24), mAcc);
  return { root, hips, torso, headG, armL, armR, legL, legR, mats: [mBody, mLegs, mSkin, mAcc] };
}

/** Prototype keys per obstacle (a wall's free side is part of its shape). */
export const obstacleKey = (o: Pick<Obstacle, 'type' | 'side'>): string => (o.type === 'wall' ? (o.side < 0 ? 'runner.wallR' : 'runner.wallL') : `runner.${o.type}`);

/** Defines the five obstacle shapes once per kit (they live as long as the kit; every run reuses them). */
function defineObstacles(kit: Scene3DKit): void {
  if (kit.prototypes.has('runner.hurdle')) return;
  const tex = (px: ReturnType<typeof stripePixels>) => makeTexture(px);
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1917', roughness: 0.7, metalness: 0.2 });
  const stripeO = new THREE.MeshStandardMaterial({ map: tex(stripePixels('#f3eee5', '#ff4f24')), roughness: 0.6, side: THREE.DoubleSide });
  const stripeY = new THREE.MeshStandardMaterial({ map: tex(stripePixels('#15130f', '#ffc93c')), roughness: 0.6, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.8 });
  const arrow = (dir: number) => new THREE.MeshStandardMaterial({
    map: tex(arrowPixels(dir, '#15130f', '#ffc93c')), roughness: 0.6, emissive: '#ffc93c', emissiveMap: tex(arrowPixels(dir, '#000000', '#ffc93c')), emissiveIntensity: 0.6,
  });
  const arrowL = arrow(-1), arrowR = arrow(1);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = false; return o;
  };
  const W = ROAD_W - 0.4;
  kit.prototypes.define('runner.hurdle', () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(W, 0.1, 0.1), dark, 0, 0.58, 0));
    g.add(mesh(new THREE.PlaneGeometry(W, 0.34), stripeO, 0, 0.36, 0));
    for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) { g.add(mesh(new THREE.BoxGeometry(0.1, 0.62, 0.1), dark, x, 0.31, 0)); g.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.7), dark, x, 0.03, 0)); }
    return g;
  });
  kit.prototypes.define('runner.duck', () => {
    const g = new THREE.Group();
    for (const x of [-W / 2, W / 2]) g.add(mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), dark, x, 1.15, 0));
    g.add(mesh(new THREE.BoxGeometry(W + 0.3, 0.14, 0.14), dark, 0, 2.2, 0));
    g.add(mesh(new THREE.PlaneGeometry(W - 0.2, 0.62), stripeO, 0, 1.78, 0));
    return g;
  });
  kit.prototypes.define('runner.squat', () => {
    const g = new THREE.Group();
    for (const x of [-W / 2, W / 2]) g.add(mesh(new THREE.BoxGeometry(0.16, 1.9, 0.16), dark, x, 0.95, 0));
    g.add(mesh(new THREE.BoxGeometry(W + 0.3, 0.14, 0.14), dark, 0, 1.8, 0));
    g.add(mesh(new THREE.PlaneGeometry(W - 0.2, 0.72), stripeY, 0, 1.36, 0));
    return g;
  });
  // side -1: the wall covers centre and left (go right); +1: centre and right (go left).
  for (const side of [-1, 1]) {
    kit.prototypes.define(side < 0 ? 'runner.wallR' : 'runner.wallL', () => {
      const g = new THREE.Group();
      const cx = side * LANE_W * 0.5;
      g.add(mesh(new THREE.BoxGeometry(LANE_W * 2 + 0.3, 2.3, 0.5), wallMat, cx, 1.15, 0));
      g.add(mesh(new THREE.PlaneGeometry(LANE_W * 2 + 0.3, 0.4), stripeO, cx, 2.05, 0.26));
      g.add(mesh(new THREE.PlaneGeometry(0.9, 0.9), side < 0 ? arrowR : arrowL, cx, 1.2, 0.27));
      return g;
    });
  }
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export interface RunnerViewOptions {
  skin?: SkinId;
  /** ctx.rng('fx'): camera shake only. */
  fx: Rng;
  reducedMotion: boolean;
}

export function createRunnerView(kit: Scene3DKit, o: RunnerViewOptions): RunnerView {
  const tracker = new ResourceTracker();
  const rig = buildRunner(o.skin ?? 'runner', tracker);
  kit.stage.add(rig.root);
  const live = new Map<number, THREE.Object3D>();
  const seen = new Set<number>();
  let lastT: number | null = null;
  let lastDist = 0;
  let shake = 0;
  let lastHits = 0;
  let disposed = false;

  function releaseAll(): void {
    for (const obj of live.values()) kit.prototypes.release(obj);
    live.clear();
  }

  return {
    begin(world: ThemeData): void {
      releaseAll();
      kit.setTheme(world);
      defineObstacles(kit);
      lastT = null;
      lastDist = 0;
      shake = 0;
      lastHits = 0;
    },

    render(run: Readonly<Run>, prev: RunnerPose, alpha: number): void {
      if (disposed) return;
      const k = Math.max(0, Math.min(1, alpha));
      const back = (1 - k) * (run.t > 0 ? run.moveZ : 0);
      const t = Math.max(0, run.t - (1 - k) * FIXED_DT);
      const dist = lerp(prev.dist, run.dist, k);
      const dt = lastT === null ? 0 : Math.max(0, t - lastT);
      const moveZ = lastT === null ? 0 : Math.max(0, dist - lastDist);
      lastT = t;
      lastDist = dist;
      const x = lerp(prev.x, run.x, k), y = lerp(prev.y, run.y, k), crouch = lerp(prev.crouch, run.crouch, k), lean = lerp(prev.lean, run.lean, k);

      // obstacles follow the simulation (z interpolated back by the part of the last step not yet shown)
      seen.clear();
      for (const ob of run.obstacles) {
        seen.add(ob.id);
        let obj = live.get(ob.id);
        if (!obj) { obj = kit.prototypes.spawn(obstacleKey(ob)); kit.stage.add(obj); live.set(ob.id, obj); }
        obj.position.set(0, 0, ob.z - back);
        obj.visible = ob.z - back < 3.2;
      }
      for (const [id, obj] of live) if (!seen.has(id)) { kit.prototypes.release(obj); live.delete(id); }

      // coins: one instanced draw call
      const coins = kit.pickups;
      if (coins) {
        coins.begin();
        for (const c of run.coins) {
          if (c.taken || c.z - back > 0.2) continue;
          if (!coins.push(c.lane * LANE_W, 1.0 + Math.sin(t * 4 + c.id) * 0.06, c.z - back, t * 3 + c.id)) break;
        }
        coins.end();
      }

      // the runner (animation phase from the distance run: the same at any frame rate)
      const speed = Math.max(0.1, run.speed);
      const ph = dist * 1.15;
      rig.root.position.x = x;
      rig.root.position.y = y;
      rig.root.rotation.z = -lean * 0.18;
      rig.root.rotation.y = -lean * 0.12;
      rig.hips.position.y = 0.95 - crouch * 0.5 + (y > 0.01 ? 0 : Math.abs(Math.sin(ph)) * 0.035);
      rig.torso.rotation.x = 0.12 + crouch * 0.55 + (run.hitT > 0 ? Math.sin(run.hitT * 20) * 0.2 : 0);
      rig.headG.rotation.x = -0.1 - crouch * 0.3;
      const sw = Math.sin(ph), cw = Math.cos(ph);
      if (y > 0.01) {
        const u = lerp(prev.jumpU, run.jumpU, k);
        rig.legL.up.rotation.x = -0.9 + u * 0.4; rig.legR.up.rotation.x = -0.4 + u * 0.3;
        rig.legL.low.rotation.x = 1.3 - u * 0.6; rig.legR.low.rotation.x = 1.0 - u * 0.4;
        rig.armL.up.rotation.x = -2.2 + u * 0.8; rig.armR.up.rotation.x = -2.2 + u * 0.8;
        rig.armL.low.rotation.x = -0.6; rig.armR.low.rotation.x = -0.6;
      } else {
        const amp = 0.95 - crouch * 0.4;
        rig.legL.up.rotation.x = sw * amp - crouch; rig.legR.up.rotation.x = -sw * amp - crouch;
        rig.legL.low.rotation.x = Math.max(0, cw) * 1.2 + 0.1 + crouch * 1.4; rig.legR.low.rotation.x = Math.max(0, -cw) * 1.2 + 0.1 + crouch * 1.4;
        rig.armL.up.rotation.x = -sw * 0.9 - 0.2; rig.armR.up.rotation.x = sw * 0.9 - 0.2;
        rig.armL.low.rotation.x = -1.3; rig.armR.low.rotation.x = -1.3;
        rig.armL.up.rotation.z = 0.25; rig.armR.up.rotation.z = -0.25;
      }
      const hitK = run.hitT > 0 ? Math.min(1, run.hitT * 2) : 0;
      for (const m of rig.mats) m.emissive.setRGB(hitK * 0.9, hitK * 0.1, hitK * 0.05);
      rig.root.visible = run.invuln > 0 ? Math.floor(t * 14) % 2 === 0 : true;

      // camera: follows the runner sideways, a little bob, a shake on each hit
      if (run.hits > lastHits) shake = 1;
      lastHits = run.hits;
      const cam = kit.camera;
      const bob = o.reducedMotion ? 0 : Math.sin(ph * 2) * 0.025;
      shake *= Math.pow(0.001, dt);
      const sh = shake * (o.reducedMotion ? 0.3 : 1);
      cam.position.x += (x * 0.5 + (o.fx() - 0.5) * sh * 0.3 - cam.position.x) * Math.min(1, dt * 6);
      cam.position.y = 2.45 + bob + (o.fx() - 0.5) * sh * 0.25 + y * 0.22;
      cam.position.z = 5.4 - Math.min(0.5, Math.max(0, (speed - 8) * 0.03));
      cam.lookAt(x * 0.75, 1.1 + y * 0.3, -7);
      kit.setFovBoost(Math.min(10, Math.max(0, (speed - 9) * 0.9)));

      if (kit.tier.blobShadows) {
        kit.blobs.begin();
        kit.blobs.push(x, 0.02, 0, 0, 1 - Math.min(0.5, y * 0.3), 1, 1 - Math.min(0.5, y * 0.3));
        kit.blobs.end();
      }
      kit.update(dt, { moveZ, focusX: x });
      kit.sample(dt * 1000, { paused: false });
      // The frame cap of the lowest tier is about the display, so it runs on real time (the kit keeps its last
      // render time across runs; simulation time starts at 0 every run).
      if (kit.frameDue(performance.now())) kit.render();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseAll();
      kit.stage.remove(rig.root);
      tracker.release();
    },
  };
}
