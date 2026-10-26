// The 3D scene kit: renderer, camera, lights, and the world a theme describes (split from site/game/engine.js:386-528,
// 598-716). It implements the contract's Scene3D (setTheme, resize, applyLevel, dispose, stats) and adds what the
// games need: a stage to put their own objects on, a prototype cache for obstacles, instanced pickups and blob
// shadows, a quality governor, lightning, a gently drifting day, and a frame cap per tier.
//
// Ownership: everything a THEME makes (sky, lights, ground, road, scenery, weather, pickups) belongs to one
// ResourceTracker that is released when the theme changes or the kit is disposed. Everything that lives as long as
// the kit (prototype shapes, the blob shadow) belongs to another. Games own what they put on the stage.
// "Same world again" (a replay, a rematch) is detected by the theme's signature and only resets the run state: no
// geometry, texture or shader is rebuilt (graphics-maps.md fix 1, shortcut).
import * as THREE from 'three';
import type { QualityLevel, Scene3D, ThemeData, Unsubscribe } from '../types/index.ts';
import { rngStream } from '../loop/rng.ts';
import { addCounts, ResourceTracker, type ResourceCounts } from './dispose.ts';
import { buildGround, type GroundKit } from './ground.ts';
import { createBatch, type InstanceBatch } from './instances.ts';
import { createPrototypeCache, type PrototypeCache } from './prototype.ts';
import { createQualityGovernor, tierFor, type QualityGovernorKit, type QualityTier } from './quality.ts';
import { CAMERA_Z, createScenery, type SceneryKit, type SceneryStats } from './scenery.ts';
import { frameDrawn } from './frames.ts';
import { buildSky, dayColor, dayDirection, type SkyKit } from './sky.ts';
import { blobPixels, makeTexture } from './textures.ts';
import { themeOrThrow, themeSignature, type Theme } from './theme.ts';
import { createWeather, type WeatherKit } from './weather.ts';

export const DAY_SECONDS = 420;
export const PICKUP_CAPACITY = 80;
export const BLOB_CAPACITY = 16;
export const CAMERA_START = { x: 0, y: 2.45, z: CAMERA_Z } as const;
export const CAMERA_LOOK = { x: 0, y: 1.1, z: -7 } as const;
export const FOV_PORTRAIT = 72;
export const FOV_LANDSCAPE = 60;

/** What the kit needs of a renderer. THREE.WebGLRenderer is one; tests pass a fake with the same shape. */
export interface RendererLike {
  readonly domElement: EventTarget & { clientWidth: number; clientHeight: number };
  readonly shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
  readonly info: { memory: { geometries: number; textures: number }; render: { calls: number; triangles: number } };
  readonly capabilities: { getMaxAnisotropy(): number };
  toneMappingExposure: number;
  setPixelRatio(r: number): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  compile(scene: THREE.Object3D, camera: THREE.Camera): unknown;
  dispose(): void;
  forceContextLoss?(): void;
}

export type QualityMode = 'auto' | 'low' | 'medium' | 'high';

export interface Scene3DOptions {
  canvas?: HTMLCanvasElement;
  /** A ready renderer (tests, or a shell that owns the context). Without one the kit makes a WebGLRenderer on `canvas`. */
  renderer?: RendererLike;
  /** First level (use initialQualityLevel from quality.ts). Default 2. */
  level?: QualityLevel;
  mode?: QualityMode;
  /** Seed of the world's scenery, weather and lightning. A live room shares it. Default 0. */
  seed?: number;
  reducedMotion?: boolean;
  /** Phones cap the pixel ratio lower. Default: a mobile user agent or a screen under 700 px. */
  mobile?: boolean;
  devicePixelRatio?: () => number;
  /** Where the size comes from. Default: the canvas, else the window. */
  size?: () => { width: number; height: number };
  /** On dispose: 'lose' also gives the WebGL context back at once (when the canvas is not reused), 'keep' (default) does not. */
  releaseContext?: 'lose' | 'keep';
}

export class RenderUnavailableError extends Error {
  readonly code = 'webgl_unavailable';
  constructor(cause?: unknown) {
    super('WebGL could not be started on this device');
    this.name = 'RenderUnavailableError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface WorldFrame {
  /** Metres the world scrolled toward the camera since the last frame (the simulation's move). */
  moveZ: number;
  /** Sideways position of the runner, for the horizon and the sun's shadow. */
  focusX?: number;
}

export interface Scene3DStats {
  geometries: number;
  textures: number;
  drawCalls: number;
}

export interface Scene3DEvents { contextlost: undefined; contextrestored: undefined }

export interface Scene3DKit extends Scene3D {
  readonly renderer: RendererLike;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Parent for the game's own objects (runner, obstacles). It stays when the theme changes. */
  readonly stage: THREE.Group;
  readonly prototypes: PrototypeCache;
  /** Coins and the like: one draw call, rewritten every frame. Belongs to the theme (coin colour). Null before setTheme. */
  readonly pickups: InstanceBatch | null;
  /** Soft round shadows for the lowest tier (no shadow map). Visible only at tiers that ask for blobs. */
  readonly blobs: InstanceBatch;
  readonly theme: Theme | null;
  readonly level: QualityLevel;
  readonly tier: QualityTier;
  readonly governor: QualityGovernorKit;
  readonly mode: QualityMode;
  readonly disposed: boolean;
  /** Base field of view for the current shape of the screen (wider in portrait); games add a boost with setFovBoost. */
  readonly baseFov: number;
  /** Is a render due at this time (ms) under the tier's frame cap? Call once per display frame. */
  frameDue(nowMs: number): boolean;
  /** Advances the world: scenery, road and ground scroll, sky, weather, lightning, glow, day. Call once per frame. */
  update(dt: number, f: WorldFrame): void;
  render(): void;
  /** Starts a new run in the same world: scenery back to the start, textures and pickups cleared. No rebuilds. */
  reset(): void;
  /** Builds the shaders of the world and of the prototypes now, behind a loading screen, instead of in the first frames. */
  warm(): void;
  flashLightning(): void;
  setFovBoost(deg: number): void;
  setReducedMotion(r: boolean): void;
  /** 0 (as the theme says) to 1 (late in the day). `update` advances it by itself; this sets it. */
  setDay(k: number): void;
  /** A frame time for the quality governor. Applies the level it decides on. Returns the new level or null. */
  sample(frameMs: number, o: { paused: boolean }): QualityLevel | null;
  /** Auto follows the governor; the others pin a level (Settings). */
  setQualityMode(m: QualityMode): void;
  on<K extends keyof Scene3DEvents>(type: K, cb: () => void): Unsubscribe;
  /** CPU-side counts of what the kit owns (the renderer's own numbers are in stats()). */
  counts(): ResourceCounts;
  sceneryStats(): SceneryStats | null;
}

interface World {
  theme: Theme;
  sig: string;
  tracker: ResourceTracker;
  root: THREE.Group;
  sky: SkyKit;
  ground: GroundKit;
  scenery: SceneryKit;
  weather: WeatherKit | null;
  pickups: InstanceBatch;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  baseHemi: number;
  baseAmbient: number;
  ambientColor: THREE.Color;
  sunBase: THREE.Color;
  glowColor: THREE.Color | null;
  lightningRng: () => number;
  flash: number;
  elapsed: number;
}

const levelOfMode = (m: QualityMode): QualityLevel | null => (m === 'low' ? 0 : m === 'medium' ? 1 : m === 'high' ? 2 : null);

function defaultMobile(): boolean {
  try { return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || innerWidth < 700; } catch { return false; }
}

function makeRenderer(canvas: HTMLCanvasElement): RendererLike {
  try {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    return r;
  } catch (e) {
    throw new RenderUnavailableError(e);
  }
}

export function createScene3D(options: Scene3DOptions): Scene3DKit {
  const canvas = options.canvas;
  const renderer: RendererLike = options.renderer ?? (canvas ? makeRenderer(canvas) : (() => { throw new RenderUnavailableError('no canvas'); })());
  const seed = options.seed ?? 0;
  const mobile = options.mobile ?? defaultMobile();
  const dpr = options.devicePixelRatio ?? ((): number => { try { return devicePixelRatio || 1; } catch { return 1; } });
  const sizeOf = options.size ?? ((): { width: number; height: number } => {
    const el = renderer.domElement;
    return { width: el.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 800), height: el.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 600) };
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_LANDSCAPE, 1, 0.1, 420);
  camera.position.set(CAMERA_START.x, CAMERA_START.y, CAMERA_START.z);
  camera.lookAt(CAMERA_LOOK.x, CAMERA_LOOK.y, CAMERA_LOOK.z);
  const stage = new THREE.Group();
  stage.name = 'stage';
  scene.add(stage);

  const kitTracker = new ResourceTracker();
  const prototypes = createPrototypeCache(scene, kitTracker);
  const blobTexture = kitTracker.track(makeTexture(blobPixels(), { wrap: 'clamp' }));
  const blobGeometry = kitTracker.track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const blobMaterial = kitTracker.track(new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const blobs = createBatch(blobGeometry, blobMaterial, BLOB_CAPACITY, 'blob-shadows');
  blobs.mesh.renderOrder = 1;
  stage.add(blobs.mesh);
  kitTracker.trackObject(blobs.mesh);

  let mode: QualityMode = options.mode ?? 'auto';
  const startLevel: QualityLevel = levelOfMode(mode) ?? options.level ?? 2;
  const governor = createQualityGovernor({ level: startLevel });
  let level: QualityLevel = startLevel;
  let tier: QualityTier = tierFor(level);

  let world: World | null = null;
  let reduced = options.reducedMotion ?? false;
  let disposed = false;
  let lost = false;
  let fovBoost = 0;
  let baseFov = FOV_LANDSCAPE;
  let distance = 0;
  let lastRenderMs = -Infinity;
  const listeners: Record<keyof Scene3DEvents, Set<() => void>> = { contextlost: new Set(), contextrestored: new Set() };
  const sunDir = new THREE.Vector3();

  const onLost = (): void => { lost = true; for (const cb of [...listeners.contextlost]) cb(); };
  const onRestored = (): void => { lost = false; for (const cb of [...listeners.contextrestored]) cb(); };
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);

  function buildWorld(theme: Theme, sig: string): World {
    const tracker = new ResourceTracker();
    const root = new THREE.Group();
    root.name = `world-${theme.id}`;
    scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);
    renderer.toneMappingExposure = theme.exposure;

    const sky = buildSky(theme, rngStream(seed, `sky:${theme.id}`), tracker);
    root.add(sky.root);

    const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity * 1.6);
    const ambient = new THREE.AmbientLight(theme.ambient, theme.ambientIntensity);
    const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity * 0.85);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -9; sun.shadow.camera.right = 9; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -16;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    root.add(hemi, ambient, sun, sun.target);

    const ground = buildGround(theme, tracker, rngStream(seed, `road:${theme.id}`), rngStream(seed, `ground:${theme.id}`), renderer.capabilities.getMaxAnisotropy());
    root.add(ground.group);

    const scenery = createScenery(theme, tracker, { seed, tier });
    root.add(scenery.root);

    let weather: WeatherKit | null = null;
    if (theme.weather) {
      weather = createWeather(theme.weather, tracker, rngStream(seed, `weather:${theme.id}`), tier);
      weather.points.visible = !reduced;
      root.add(weather.points);
    }

    const coinMaterial = tracker.track(new THREE.MeshStandardMaterial({ color: theme.coin, emissive: theme.coin, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.6 }));
    const pickups = createBatch(tracker.track(new THREE.TorusGeometry(0.3, 0.09, 8, 18)), coinMaterial, PICKUP_CAPACITY, 'pickups');
    root.add(pickups.mesh);

    tracker.trackObject(root);
    scene.add(root);
    const w: World = {
      theme, sig, tracker, root, sky, ground, scenery, weather, pickups, hemi, ambient, sun,
      baseHemi: hemi.intensity, baseAmbient: ambient.intensity, ambientColor: new THREE.Color(theme.ambient), sunBase: new THREE.Color(theme.sun.color),
      glowColor: theme.glow ? new THREE.Color(theme.glow) : null,
      lightningRng: rngStream(seed, `fx:lightning:${theme.id}`), flash: 0, elapsed: 0,
    };
    applyTierToWorld(w);
    applyDay(w, 0);
    return w;
  }

  function disposeWorld(): void {
    if (!world) return;
    scene.remove(world.root);
    world.tracker.release();
    scene.fog = null;
    world = null;
  }

  function applyTierToWorld(w: World): void {
    const shadowsOn = tier.shadows !== 'off';
    renderer.shadowMap.enabled = shadowsOn;
    w.sun.castShadow = shadowsOn;
    if (shadowsOn && w.sun.shadow.mapSize.x !== tier.shadowMapSize) {
      w.sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
      if (w.sun.shadow.map) { w.sun.shadow.map.dispose(); w.sun.shadow.map = null; }
    }
    if (!shadowsOn && w.sun.shadow.map) { w.sun.shadow.map.dispose(); w.sun.shadow.map = null; }
    w.scenery.applyTier(tier);
    w.weather?.applyTier(tier);
  }

  function applyDay(w: World, k: number): void {
    w.sky.setDay(k);
    dayColor(w.sunBase, k, w.sun.color);
  }

  function pixelRatio(): number {
    const cap = mobile ? tier.pixelRatioCap.mobile : tier.pixelRatioCap.desktop;
    return Math.min(dpr(), cap);
  }

  function resize(): void {
    if (disposed) return;
    const { width, height } = sizeOf();
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = w < h ? FOV_PORTRAIT : FOV_LANDSCAPE;
    camera.fov = baseFov + fovBoost;
    camera.updateProjectionMatrix();
  }

  function applyLevel(l: QualityLevel): void {
    if (disposed) return;
    level = l;
    tier = tierFor(l);
    blobs.mesh.visible = tier.blobShadows;
    if (world) applyTierToWorld(world);
    resize();
  }
  blobs.mesh.visible = tier.blobShadows;

  function reset(): void {
    distance = 0;
    prototypes.releaseAll();
    blobs.begin(); blobs.end();
    if (!world) return;
    world.scenery.reset();
    world.ground.reset();
    world.pickups.begin(); world.pickups.end();
    world.flash = 0;
    world.sky.setFlash(0);
    world.elapsed = 0;
    applyDay(world, 0);
  }

  function warm(): void {
    if (disposed) return;
    renderer.compile(scene, camera);
  }

  function updateWorld(w: World, dt: number, moveZ: number, focusX: number): void {
    w.elapsed += dt;
    distance += moveZ;
    w.scenery.update(distance);
    w.ground.scroll(moveZ);
    w.sky.update(dt, camera.position, focusX);
    if (w.weather && !reduced) w.weather.update(dt, moveZ);

    applyDay(w, Math.min(1, w.elapsed / DAY_SECONDS));

    // Lightning and glow move light values, they add no light: a dynamic light costs every fragment.
    if (w.theme.lightning && !reduced) {
      w.flash *= Math.pow(0.02, dt);
      if (w.lightningRng() < dt * 0.12) w.flash = 1;
    } else w.flash = 0;
    w.sky.setFlash(w.flash * 0.6);
    let glow = 0;
    if (w.glowColor) glow = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(w.elapsed * 7);
    w.hemi.intensity = w.baseHemi * (1 + 0.15 * glow) + w.flash * 2.2;
    w.ambient.intensity = w.baseAmbient + w.flash * 0.9;
    if (w.glowColor) w.ambient.color.copy(w.ambientColor).lerp(w.glowColor, 0.3 * glow);

    // The sun's light follows the camera sideways and keeps the runner in its shadow box.
    sunDir.copy(w.sky.sunDir).multiplyScalar(40);
    w.sun.position.set(camera.position.x + sunDir.x, sunDir.y, sunDir.z);
    w.sun.target.position.set(focusX, 0, -4);
  }

  const api: Scene3DKit = {
    renderer, scene, camera, stage, prototypes, blobs, governor,
    get pickups() { return world ? world.pickups : null; },
    get theme() { return world ? world.theme : null; },
    get level() { return level; },
    get tier() { return tier; },
    get mode() { return mode; },
    get disposed() { return disposed; },
    get baseFov() { return baseFov; },

    setTheme(t: ThemeData) {
      if (disposed) throw new Error('the scene was disposed');
      const theme = themeOrThrow(t);
      const sig = themeSignature(theme);
      if (world && world.sig === sig) { reset(); return; }
      disposeWorld();
      world = buildWorld(theme, sig);
      reset();
      warm();
    },
    resize,
    applyLevel,
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      prototypes.dispose();
      disposeWorld();
      scene.remove(stage);
      kitTracker.release();
      renderer.dispose();
      if (options.releaseContext === 'lose') renderer.forceContextLoss?.();
      listeners.contextlost.clear(); listeners.contextrestored.clear();
    },
    stats() {
      return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, drawCalls: renderer.info.render.calls };
    },

    frameDue(nowMs) {
      const gap = 1000 / tier.fpsCap;
      if (nowMs - lastRenderMs < gap - 3) return false;   // 3 ms of slack: a 60 Hz display delivers frames 16.7 ms apart, not 16.0
      lastRenderMs = nowMs;
      return true;
    },
    update(dt, f) {
      if (disposed || !world) return;
      updateWorld(world, dt, f.moveZ, f.focusX ?? 0);
    },
    render() {
      if (disposed || lost) return;
      renderer.render(scene, camera);
      frameDrawn(renderer.domElement);   // the one moment a copy of the picture (the highlight clip) can be taken, see frames.ts
    },
    reset,
    warm,
    flashLightning() { if (world && world.theme.lightning && !reduced) world.flash = 1; },
    setFovBoost(deg) {
      if (Math.abs(deg - fovBoost) < 0.01) return;
      fovBoost = deg;
      camera.fov = baseFov + fovBoost;
      camera.updateProjectionMatrix();
    },
    setReducedMotion(r) {
      reduced = r;
      if (world?.weather) world.weather.points.visible = !r;
    },
    setDay(k) { if (world) { world.elapsed = Math.min(1, Math.max(0, k)) * DAY_SECONDS; applyDay(world, k); } },
    sample(frameMs, o) {
      if (disposed || mode !== 'auto') return null;
      const next = governor.sample(frameMs, o);
      if (next !== null) applyLevel(next);
      return next;
    },
    setQualityMode(m) {
      mode = m;
      const fixed = levelOfMode(m);
      if (fixed !== null) { governor.set(fixed); applyLevel(fixed); }
      else governor.reset(level);
    },
    on(type, cb) {
      listeners[type].add(cb);
      return () => { listeners[type].delete(cb); };
    },
    counts() {
      return addCounts(kitTracker.counts(), world ? world.tracker.counts() : { geometries: 0, materials: 0, textures: 0, other: 0 });
    },
    sceneryStats() { return world ? world.scenery.stats() : null; },
  };

  resize();
  return api;
}
