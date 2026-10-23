// Browser side of tests/e2e/render3d.spec.ts: drives the real 3D kit on a real (software) WebGL context the way a game
// does, and returns plain numbers for the spec to judge. Nothing here asserts; the spec does.
import * as THREE from 'three';
import { ResourceTracker } from '../../../packages/core/render3d/dispose.ts';
import { createScene3D, type Scene3DKit } from '../../../packages/core/render3d/scene3d.ts';
import { makeTexture, stripePixels } from '../../../packages/core/render3d/textures.ts';
import worldsJson from '../../../packages/core/render3d/themes/classic-worlds.json';
import type { QualityLevel, ThemeData } from '../../../packages/core/types/index.ts';

const worlds = worldsJson as unknown as ThemeData[];

export interface Stats { geometries: number; textures: number; drawCalls: number }
export interface Counts { geometries: number; materials: number; textures: number; other: number }

export interface SessionResult {
  session: number;
  world: string;
  buildMs: number;
  stats: Stats;
  counts: Counts;
  obstaclesSpawned: number;
  protoCreated: number;
}

export interface ShotResult {
  world: string;
  level: number;
  width: number;
  height: number;
  /** Share of sampled pixels that differ clearly from the most common colour. */
  contrast: number;
  distinctColours: number;
  meanLuma: number;
  calls: number;
  triangles: number;
  scenery: { visibleSlices: number; drawCalls: number; triangles: number } | null;
  jpeg: string;
}

export interface BudgetResult {
  world: string;
  level: number;
  updateP50: number; updateP95: number;
  renderP50: number; renderP95: number;
  calls: number;
  triangles: number;
  /** Time the GPU (software GL here) needs to finish a frame, median: a ratio between tiers, not a promise for phones. */
  gpuP50: number;
  frameMsP50: number;
  frameMsP95: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  document.getElementById('stage')?.remove();
  const c = document.createElement('canvas');
  c.id = 'stage';
  c.style.cssText = `display:block;width:${w}px;height:${h}px`;
  document.body.append(c);
  return c;
}

const pct = (a: number[], p: number): number => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };

function openKit(o: { width: number; height: number; level: QualityLevel; dpr?: number; seed?: number }): Scene3DKit {
  const canvas = makeCanvas(o.width, o.height);
  return createScene3D({ canvas, level: o.level, mode: o.level === 0 ? 'low' : o.level === 1 ? 'medium' : 'high', devicePixelRatio: () => o.dpr ?? 1, size: () => ({ width: o.width, height: o.height }), mobile: false, seed: o.seed ?? 11 });
}

const glOf = (kit: Scene3DKit): WebGL2RenderingContext => (kit.renderer as unknown as THREE.WebGLRenderer).getContext() as WebGL2RenderingContext;
const px1 = new Uint8Array(4);
/** Waits for the GPU: gl.finish() returns at once in Chromium, reading one pixel back does not. */
const sync = (kit: Scene3DKit): void => { const g = glOf(kit); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px1); };

/** What a game does with the kit: obstacle shapes made once, clones along the road, coins, blob shadows, the camera. */
class StandIn {
  readonly tracker = new ResourceTracker();
  spawned = 0;
  private live: THREE.Object3D[] = [];
  private t = 0;
  readonly kit: Scene3DKit;
  constructor(kit: Scene3DKit) {
    this.kit = kit;
    const dark = this.tracker.track(new THREE.MeshStandardMaterial({ color: '#1b1917', roughness: 0.7, metalness: 0.2 }));
    const stripes = this.tracker.track(new THREE.MeshStandardMaterial({ map: this.tracker.track(makeTexture(stripePixels('#f3eee5', '#ff4f24'))), roughness: 0.6, side: THREE.DoubleSide }));
    kit.prototypes.define('hurdle', () => {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.1), dark); bar.position.y = 0.58;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.34), stripes); plate.position.y = 0.36;
      g.add(bar, plate);
      return g;
    });
    kit.prototypes.define('wall', () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6, 2.3, 0.5), dark);
      m.position.y = 1.15;
      const g = new THREE.Group(); g.add(m);
      return g;
    });
  }

  newRun(): void { this.live = []; this.t = 0; this.kit.reset(); }

  frame(f: number): void {
    const kit = this.kit;
    this.t += 1 / 60;
    if (f % 25 === 0 && this.spawned < 4000) {
      const o = kit.prototypes.spawn(f % 50 === 0 ? 'wall' : 'hurdle');
      o.position.z = -90;
      kit.stage.add(o);
      this.live.push(o);
      this.spawned++;
    }
    for (const o of this.live) o.position.z += 0.22;
    while (this.live.length && this.live[0]!.position.z > 4) kit.prototypes.release(this.live.shift()!);
    const x = Math.sin(f * 0.05) * 1.2;
    kit.update(1 / 60, { moveZ: 0.22, focusX: x });
    kit.camera.position.x += (x * 0.5 - kit.camera.position.x) * 0.1;
    kit.camera.lookAt(x * 0.75, 1.1, -7);
    if (kit.pickups) {
      kit.pickups.begin();
      for (let i = 0; i < 24; i++) kit.pickups.push((i % 3 - 1) * 1.8, 1 + Math.sin(this.t * 4 + i) * 0.06, -8 - i * 3, this.t * 3 + i);
      kit.pickups.end();
    }
    kit.blobs.begin();
    kit.blobs.push(x, 0.02, 0, 0, 1);
    for (const o of this.live) kit.blobs.push(0, 0.02, o.position.z, 0, 3, 1, 0.6);
    kit.blobs.end();
    kit.render();
  }
}

/** Frames with no waiting; ends with a GPU sync so the numbers read afterwards belong to the last frame. */
function runFrames(s: StandIn, frames: number, from = 0): void {
  for (let f = from; f < from + frames; f++) s.frame(f);
  sync(s.kit);
}

/** The leak test: sessions in a row (one world each), numbers after each, as the game would leave them. */
export function leakRun(o: { sessions: number; worldIds: string[]; frames: number; level: QualityLevel; width: number; height: number }): SessionResult[] {
  const kit = openKit({ width: o.width, height: o.height, level: o.level });
  const stand = new StandIn(kit);
  const out: SessionResult[] = [];
  for (let s = 0; s < o.sessions; s++) {
    const id = o.worldIds[s % o.worldIds.length]!;
    const t0 = performance.now();
    kit.setTheme(worlds.find((w) => w.id === id)!);
    const buildMs = performance.now() - t0;
    stand.newRun();
    runFrames(stand, o.frames);
    kit.prototypes.releaseAll();
    kit.render();
    sync(kit);
    out.push({ session: s + 1, world: id, buildMs, stats: kit.stats(), counts: kit.counts(), obstaclesSpawned: stand.spawned, protoCreated: kit.prototypes.stats().created });
  }
  kit.dispose();
  return out;
}

/** After dispose the renderer must hold nothing. */
export function disposeRun(o: { worldIds: string[]; frames: number; level: QualityLevel }): { before: Stats; after: Stats; counts: Counts; tracked: Counts } {
  const kit = openKit({ width: 390, height: 844, level: o.level });
  const stand = new StandIn(kit);
  for (const id of o.worldIds) { kit.setTheme(worlds.find((w) => w.id === id)!); stand.newRun(); runFrames(stand, o.frames); }
  const before = kit.stats();
  stand.tracker.release();
  kit.dispose();
  return { before, after: kit.stats(), counts: kit.counts(), tracked: stand.tracker.counts() };
}

/** One picture of every world at every tier, with the numbers the budgets need. */
export function shotRun(o: { worldIds: string[]; levels: QualityLevel[]; sizes: [number, number][]; frames: number }): ShotResult[] {
  const out: ShotResult[] = [];
  for (const [width, height] of o.sizes) {
    for (const level of o.levels) {
      const kit = openKit({ width, height, level });
      const stand = new StandIn(kit);
      for (const id of o.worldIds) {
        kit.setTheme(worlds.find((w) => w.id === id)!);
        stand.newRun();
        for (let f = 0; f < o.frames; f++) stand.frame(f);
        // One more frame drawn and copied in the same task, before the browser presents (and clears) it.
        const probe = document.createElement('canvas');
        const tw = 96, th = Math.round((96 * height) / width);
        probe.width = tw; probe.height = th;
        const p = probe.getContext('2d', { willReadFrequently: true })!;
        stand.frame(o.frames);
        p.drawImage(kit.renderer.domElement as unknown as HTMLCanvasElement, 0, 0, tw, th);
        const px = p.getImageData(0, 0, tw, th).data;
        const hist = new Map<number, number>();
        let luma = 0;
        for (let i = 0; i < px.length; i += 4) {
          const key = ((px[i]! >> 4) << 8) | ((px[i + 1]! >> 4) << 4) | (px[i + 2]! >> 4);
          hist.set(key, (hist.get(key) ?? 0) + 1);
          luma += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
        }
        const n = px.length / 4;
        const top = Math.max(...hist.values());
        const sc = kit.sceneryStats();
        const big = document.createElement('canvas');
        big.width = Math.round(width / 2); big.height = Math.round(height / 2);
        big.getContext('2d')!.drawImage(probe, 0, 0, big.width, big.height);
        sync(kit);
        const calls = kit.stats().drawCalls;
        out.push({
          world: id, level, width, height, contrast: 1 - top / n, distinctColours: hist.size, meanLuma: luma / n / 255,
          calls, triangles: kit.renderer.info.render.triangles, scenery: sc ? { visibleSlices: sc.visibleSlices, drawCalls: sc.drawCalls, triangles: sc.triangles } : null,
          jpeg: probe.toDataURL('image/jpeg', 0.8),
        });
      }
      kit.dispose();
    }
  }
  return out;
}

/** Full-size picture of one world, for looking at. */
export function bigShot(o: { world: string; level: QualityLevel; width: number; height: number; frames: number; dpr: number }): string {
  const kit = openKit({ width: o.width, height: o.height, level: o.level, dpr: o.dpr });
  const stand = new StandIn(kit);
  kit.setTheme(worlds.find((w) => w.id === o.world)!);
  stand.newRun();
  for (let f = 0; f < o.frames; f++) stand.frame(f);
  const copy = document.createElement('canvas');
  const c = kit.renderer.domElement as unknown as HTMLCanvasElement;
  copy.width = c.width; copy.height = c.height;
  stand.frame(o.frames);
  copy.getContext('2d')!.drawImage(c, 0, 0);
  const url = copy.toDataURL('image/jpeg', 0.85);
  kit.dispose();
  return url;
}

/** Frame costs on the CPU side and the draw load of one world at one tier. */
export async function budgetRun(o: { worldId: string; level: QualityLevel; frames: number; paced: number; width: number; height: number }): Promise<BudgetResult> {
  const kit = openKit({ width: o.width, height: o.height, level: o.level, dpr: 2 });   // a phone's ratio: the tiers cap it differently
  const stand = new StandIn(kit);
  kit.setTheme(worlds.find((w) => w.id === o.worldId)!);
  stand.newRun();
  for (let f = 0; f < 30; f++) stand.frame(f);   // shaders are built and the first uploads are done
  sync(kit);
  const upd: number[] = [], ren: number[] = [], gpu: number[] = [];
  for (let f = 0; f < o.frames; f++) {
    const a = performance.now();
    // the same work as StandIn.frame, timed in parts; the GPU is drained each frame so the submit time is not backpressure
    kit.update(1 / 60, { moveZ: 0.22, focusX: Math.sin(f * 0.05) * 1.2 });
    const b = performance.now();
    kit.render();
    const c = performance.now();
    sync(kit);
    const d = performance.now();
    upd.push(b - a); ren.push(c - b); gpu.push(d - c);
  }
  const calls = kit.stats().drawCalls, triangles = kit.renderer.info.render.triangles;
  // Frame to frame time with the display's pacing: what the governor would see (software GL is slow, so this is a ratio, not a promise).
  const gaps: number[] = [];
  let last = 0;
  await new Promise<void>((resolve) => {
    let n = 0;
    const tick = (t: number): void => {
      if (last) gaps.push(t - last);
      last = t;
      stand.frame(1000 + n);
      if (++n < o.paced) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  kit.dispose();
  return { world: o.worldId, level: o.level, updateP50: pct(upd, 0.5), updateP95: pct(upd, 0.95), renderP50: pct(ren, 0.5), renderP95: pct(ren, 0.95), calls, triangles, gpuP50: pct(gpu, 0.5), frameMsP50: pct(gaps, 0.5), frameMsP95: pct(gaps, 0.95) };
}

/** Loses the WebGL context in the middle of a run and restores it. */
export async function contextRun(): Promise<{ lostEvents: number; restoredEvents: number; rendersWhileLost: number; before: number; after: number; afterContrast: number; statsAfter: Stats }> {
  const kit = openKit({ width: 390, height: 844, level: 2 });
  const stand = new StandIn(kit);
  kit.setTheme(worlds.find((w) => w.id === 'forest')!);
  stand.newRun();
  let lostEvents = 0, restoredEvents = 0;
  kit.on('contextlost', () => lostEvents++);
  kit.on('contextrestored', () => restoredEvents++);
  runFrames(stand, 40);
  const before = kit.stats().geometries;
  const ext = glOf(kit).getExtension('WEBGL_lose_context')!;
  ext.loseContext();
  await new Promise((r) => setTimeout(r, 150));
  const renderer = kit.renderer as unknown as THREE.WebGLRenderer;
  const callsBefore = renderer.info.render.calls + renderer.info.render.frame;
  for (let f = 0; f < 10; f++) kit.render();   // must neither throw nor draw
  const rendersWhileLost = renderer.info.render.frame - (callsBefore - renderer.info.render.calls);
  ext.restoreContext();
  await new Promise((r) => setTimeout(r, 400));
  for (let f = 100; f < 140; f++) stand.frame(f);
  const probe = document.createElement('canvas');
  probe.width = 96; probe.height = 208;
  const p = probe.getContext('2d', { willReadFrequently: true })!;
  stand.frame(141);
  p.drawImage(kit.renderer.domElement as unknown as HTMLCanvasElement, 0, 0, 96, 208);
  const px = p.getImageData(0, 0, 96, 208).data;
  const hist = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) { const k = ((px[i]! >> 4) << 8) | ((px[i + 1]! >> 4) << 4) | (px[i + 2]! >> 4); hist.set(k, (hist.get(k) ?? 0) + 1); }
  const afterContrast = 1 - Math.max(...hist.values()) / (px.length / 4);
  sync(kit);
  const statsAfter = kit.stats();
  const after = statsAfter.geometries;
  kit.dispose();
  return { lostEvents, restoredEvents, rendersWhileLost, before, after, afterContrast, statsAfter };
}
