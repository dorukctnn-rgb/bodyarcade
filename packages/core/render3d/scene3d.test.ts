// The scene kit, in Node with a fake renderer: world changes free what they made, "same world again" rebuilds nothing,
// tiers change shadows, pixel ratio, weather and frame cap, lightning and glow add no light, the day drifts, a lost
// context pauses drawing, and dispose gives everything back. The real GPU run is tests/e2e/render3d.spec.ts.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY_TIERS } from './quality.ts';
import { createScene3D, DAY_SECONDS, FOV_LANDSCAPE, FOV_PORTRAIT, type RendererLike, type Scene3DKit } from './scene3d.ts';
import { ThemeError } from './theme.ts';
import type { ThemeData } from '../types/index.ts';

const worlds = JSON.parse(readFileSync(new URL('./themes/classic-worlds.json', import.meta.url), 'utf8')) as ThemeData[];
const world = (id: string): ThemeData => worlds.find((w) => w.id === id)!;

class FakeCanvas extends EventTarget { clientWidth = 390; clientHeight = 844; }

interface Fake extends RendererLike {
  canvas: FakeCanvas;
  pixelRatio: number;
  size: [number, number];
  renders: number;
  compiles: number;
  disposed: number;
  lost: number;
}

function fakeRenderer(): Fake {
  const canvas = new FakeCanvas();
  const r: Fake = {
    canvas,
    domElement: canvas,
    shadowMap: { enabled: true, type: THREE.PCFShadowMap },
    info: { memory: { geometries: 0, textures: 0 }, render: { calls: 0, triangles: 0 } },
    capabilities: { getMaxAnisotropy: () => 16 },
    toneMappingExposure: 1,
    pixelRatio: 0, size: [0, 0], renders: 0, compiles: 0, disposed: 0, lost: 0,
    setPixelRatio(v) { r.pixelRatio = v; },
    setSize(w, h) { r.size = [w, h]; },
    render() { r.renders++; },
    compile() { r.compiles++; },
    dispose() { r.disposed++; },
    forceContextLoss() { r.lost++; },
  };
  return r;
}

function make(o: { level?: 0 | 1 | 2; mobile?: boolean; dpr?: number; reduced?: boolean; seed?: number; release?: 'lose' | 'keep'; size?: [number, number] } = {}): { kit: Scene3DKit; r: Fake } {
  const r = fakeRenderer();
  if (o.size) { r.canvas.clientWidth = o.size[0]; r.canvas.clientHeight = o.size[1]; }
  const kit = createScene3D({
    renderer: r, level: o.level ?? 2, mobile: o.mobile ?? false, devicePixelRatio: () => o.dpr ?? 2,
    reducedMotion: o.reduced ?? false, seed: o.seed ?? 0, releaseContext: o.release ?? 'keep',
  });
  return { kit, r };
}

const lightsIn = (scene: THREE.Scene): string[] => { const out: string[] = []; scene.traverse((o) => { if ((o as THREE.Light).isLight) out.push(o.type); }); return out.sort(); };

describe('size and field of view', () => {
  it('a portrait screen gets the wide field of view, a landscape one the normal', () => {
    const p = make({ size: [390, 844] });
    expect(p.kit.camera.fov).toBe(FOV_PORTRAIT);
    expect(p.kit.camera.aspect).toBeCloseTo(390 / 844, 9);
    expect(p.r.size).toEqual([390, 844]);
    const l = make({ size: [844, 390] });
    expect(l.kit.camera.fov).toBe(FOV_LANDSCAPE);
    l.r.canvas.clientWidth = 390; l.r.canvas.clientHeight = 844;
    l.kit.resize();
    expect(l.kit.camera.fov).toBe(FOV_PORTRAIT);
  });

  it('a boost widens the view and a new size keeps it', () => {
    const { kit, r } = make({ size: [844, 390] });
    kit.setFovBoost(6);
    expect(kit.camera.fov).toBe(FOV_LANDSCAPE + 6);
    r.canvas.clientWidth = 1280; r.canvas.clientHeight = 800;
    kit.resize();
    expect(kit.camera.fov).toBe(FOV_LANDSCAPE + 6);
  });

  it('pixel ratio is the device ratio capped by the tier (and lower on phones)', () => {
    const d = make({ level: 2, dpr: 3, mobile: false });
    expect(d.r.pixelRatio).toBe(QUALITY_TIERS[2].pixelRatioCap.desktop);
    const m = make({ level: 2, dpr: 3, mobile: true });
    expect(m.r.pixelRatio).toBe(QUALITY_TIERS[2].pixelRatioCap.mobile);
    const low = make({ level: 0, dpr: 3 });
    expect(low.r.pixelRatio).toBe(1);
    const plain = make({ level: 2, dpr: 1.25 });
    expect(plain.r.pixelRatio).toBe(1.25);
  });
});

describe('themes', () => {
  it('sets a world: fog, exposure, lights, sky and a compile', () => {
    const { kit, r } = make();
    kit.setTheme(world('alps'));
    expect(kit.theme?.id).toBe('alps');
    expect(kit.scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect((kit.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.013, 9);
    expect(r.toneMappingExposure).toBeCloseTo(kit.theme!.exposure, 9);
    expect(lightsIn(kit.scene)).toEqual(['AmbientLight', 'DirectionalLight', 'HemisphereLight']);
    expect(r.compiles).toBeGreaterThan(0);
    expect(kit.pickups).not.toBeNull();
    kit.dispose();
  });

  it('every one of the ten worlds loads, draws and frees', () => {
    const { kit } = make();
    for (const w of worlds) {
      kit.setTheme(w);
      for (let i = 0; i < 30; i++) { kit.update(1 / 60, { moveZ: 0.2 }); kit.render(); }
      expect(kit.theme?.id).toBe(w.id);
    }
    kit.dispose();
    expect(kit.counts()).toEqual({ geometries: 0, materials: 0, textures: 0, other: 0 });
  }, 60_000);

  it('five rounds through all ten worlds leave exactly as much as one round (no leak per world change)', () => {
    const { kit } = make();
    const after: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const w of worlds) kit.setTheme(w);
      const c = kit.counts();
      after.push(c.geometries * 1000 + c.materials * 100 + c.textures);
    }
    expect(new Set(after).size).toBe(1);
    const last = kit.counts();
    kit.setTheme(world('alps'));
    const alps = kit.counts();
    expect(alps.textures).toBeLessThanOrEqual(last.textures + 8);
    kit.dispose();
  }, 60_000);

  it('the same world again rebuilds nothing: same objects, scenery back at the start', () => {
    const { kit, r } = make();
    kit.setTheme(world('forest'));
    const root = kit.scene.children.find((c) => c.name === 'world-forest');
    const counts = kit.counts();
    const compiles = r.compiles;
    for (let i = 0; i < 200; i++) kit.update(1 / 60, { moveZ: 0.3 });
    kit.setTheme(JSON.parse(JSON.stringify(world('forest'))) as ThemeData);
    expect(kit.scene.children.find((c) => c.name === 'world-forest')).toBe(root);
    expect(kit.counts()).toEqual(counts);
    expect(r.compiles).toBe(compiles);
    expect(kit.sceneryStats()!.visibleSlices).toBeGreaterThan(0);
    kit.dispose();
  });

  it('a change that only touches the name or the free flag is still the same world', () => {
    const { kit } = make();
    kit.setTheme(world('alps'));
    const root = kit.scene.children.find((c) => c.name === 'world-alps');
    kit.setTheme({ ...world('alps'), name: 'Alps, renamed', free: false });
    expect(kit.scene.children.find((c) => c.name === 'world-alps')).toBe(root);
    kit.dispose();
  });

  it('a different look under the same id is a new world', () => {
    const { kit } = make();
    kit.setTheme(world('alps'));
    const root = kit.scene.children.find((c) => c.name === 'world-alps');
    kit.setTheme({ ...world('alps'), fog: { color: '#101820', density: 0.02 } });
    expect(kit.scene.children.find((c) => c.name === 'world-alps')).not.toBe(root);
    expect((kit.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.02, 9);
    kit.dispose();
  });

  it('a bad theme is refused with a readable error and the world stays as it was', () => {
    const { kit } = make();
    kit.setTheme(world('alps'));
    const counts = kit.counts();
    expect(() => kit.setTheme({ id: 'broken', sky: 5 })).toThrow(ThemeError);
    expect(kit.theme?.id).toBe('alps');
    expect(kit.counts()).toEqual(counts);
    kit.dispose();
  });

  it('prototype shapes and the stage survive a world change; the obstacles of the last run do not', () => {
    const { kit } = make();
    kit.setTheme(world('alps'));
    kit.prototypes.define('hurdle', () => new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 0.1), new THREE.MeshBasicMaterial()));
    const o = kit.prototypes.spawn('hurdle');
    kit.stage.add(o);
    kit.setTheme(world('city'));
    expect(kit.prototypes.has('hurdle')).toBe(true);
    expect(kit.scene.children).toContain(kit.stage);
    expect(kit.stage.children).not.toContain(o);                 // a new world is a new run: the clone went back to the pool
    expect(kit.prototypes.stats()).toMatchObject({ live: 0, pooled: 1 });
    expect(kit.prototypes.spawn('hurdle')).toBe(o);
    kit.dispose();
  });
});

describe('the world in motion', () => {
  it('scrolls the road and ground textures and keeps their offsets inside [0, 1)', () => {
    const { kit } = make();
    kit.setTheme(world('alps'));
    const road = kit.scene.getObjectByName('road') as THREE.Mesh;
    const tex = (road.material as THREE.MeshStandardMaterial).map!;
    kit.update(1 / 60, { moveZ: 1 });
    expect(tex.offset.y).toBeCloseTo(1 - 1 / (320 / 12), 9);
    for (let i = 0; i < 20000; i++) kit.update(1 / 60, { moveZ: 0.37 });
    expect(tex.offset.y).toBeGreaterThanOrEqual(0);
    expect(tex.offset.y).toBeLessThan(1);
    kit.dispose();
  });

  it('moves the scenery with the world and recycles slices without new resources', () => {
    const { kit } = make();
    kit.setTheme(world('forest'));
    const before = kit.counts();
    for (let i = 0; i < 6000; i++) kit.update(1 / 60, { moveZ: 0.25 });
    expect(kit.counts()).toEqual(before);
    expect(kit.sceneryStats()!.visibleSlices).toBeGreaterThan(0);
    kit.dispose();
  });

  it('the sky follows the camera and the sun follows the runner sideways', () => {
    const { kit } = make();
    kit.setTheme(world('alps'));
    kit.camera.position.x = 2;
    kit.update(1 / 60, { moveZ: 0.1, focusX: 1.5 });
    expect(kit.scene.getObjectByName('sky-dome')!.position.x).toBe(2);
    const sun = kit.scene.children.flatMap((c) => c.children).find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(sun.target.position.x).toBe(1.5);
    expect(sun.position.x).toBeGreaterThan(2 - 40);
    kit.dispose();
  });

  it('lightning flashes the sky and the fill light, decays, and never adds a light', () => {
    const { kit } = make({ seed: 3 });
    kit.setTheme(world('storm'));
    const base = lightsIn(kit.scene);
    const hemi = kit.scene.getObjectByName('world-storm')!.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
    const rest = hemi.intensity;
    kit.flashLightning();
    kit.update(1 / 60, { moveZ: 0 });
    expect(hemi.intensity).toBeGreaterThan(rest + 1);
    expect(kit.scene.getObjectByName('sky-dome')).toBeTruthy();
    for (let i = 0; i < 400; i++) kit.update(1 / 60, { moveZ: 0.2 });
    expect(lightsIn(kit.scene)).toEqual(base);
    let flashes = 0, prev = 0;
    for (let i = 0; i < 60 * 600; i++) { kit.update(1 / 60, { moveZ: 0 }); const hi = hemi.intensity - rest > 1.5 ? 1 : 0; if (hi && !prev) flashes++; prev = hi; }
    expect(flashes).toBeGreaterThan(20);         // about one every 8 s over ten minutes
    expect(flashes).toBeLessThan(150);
    kit.dispose();
  });

  it('the same seed gives the same lightning', () => {
    const run = (seed: number): number[] => {
      const { kit } = make({ seed });
      kit.setTheme(world('storm'));
      const hemi = kit.scene.getObjectByName('world-storm')!.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
      const out: number[] = [];
      for (let i = 0; i < 6000; i++) { kit.update(1 / 60, { moveZ: 0.1 }); out.push(hemi.intensity); }
      kit.dispose();
      return out;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('volcano glow pulses the ambient colour and intensity with no extra light', () => {
    const { kit } = make();
    kit.setTheme(world('volcano'));
    const ambient = kit.scene.getObjectByName('world-volcano')!.children.find((c) => (c as THREE.AmbientLight).isAmbientLight) as THREE.AmbientLight;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) { kit.update(1 / 60, { moveZ: 0 }); seen.add(ambient.color.getHexString()); }
    expect(seen.size).toBeGreaterThan(20);
    expect(lightsIn(kit.scene)).toEqual(['AmbientLight', 'DirectionalLight', 'HemisphereLight']);
    kit.dispose();
  });

  it('reduced motion hides the weather and stops lightning', () => {
    const { kit } = make({ reduced: true });
    kit.setTheme(world('storm'));
    const points = kit.scene.getObjectByName('weather-rain')!;
    expect(points.visible).toBe(false);
    kit.flashLightning();
    const sky = kit.scene.getObjectByName('sky-dome') as THREE.Mesh;
    kit.update(1 / 60, { moveZ: 0 });
    expect((sky.material as THREE.ShaderMaterial).uniforms['uFlash']!.value).toBe(0);
    kit.setReducedMotion(false);
    expect(points.visible).toBe(true);
    kit.dispose();
  });

  it('the day: late in a run the sun is lower than at the start, and a restart brings the morning back', () => {
    const { kit } = make();
    kit.setTheme(world('sunset'));
    const sky = kit.scene.getObjectByName('sky-dome') as THREE.Mesh;
    const dir = (sky.material as THREE.ShaderMaterial).uniforms['uSunDir']!.value as THREE.Vector3;
    const y0 = dir.y;
    for (let i = 0; i < 60 * DAY_SECONDS; i++) kit.update(1 / 60, { moveZ: 0 });
    expect(dir.y).toBeLessThan(y0);
    kit.reset();
    expect(dir.y).toBeCloseTo(y0, 9);
    kit.setDay(1);
    expect(dir.y).toBeLessThan(y0);
    kit.dispose();
  });

  it('pickups and blob shadows are batches that can be rewritten every frame with no new resources', () => {
    const { kit } = make();
    kit.setTheme(world('alps'));
    const before = kit.counts();
    const pick = kit.pickups!;
    for (let f = 0; f < 500; f++) {
      pick.begin();
      for (let i = 0; i < 100; i++) pick.push(i * 0.1, 1, -i, f * 0.1);
      pick.end();
      kit.blobs.begin(); kit.blobs.push(0, 0.02, 0, 0, 0.9); kit.blobs.end();
    }
    expect(pick.mesh.count).toBe(80);   // capacity
    expect(kit.blobs.mesh.count).toBe(1);
    expect(kit.counts()).toEqual(before);
    kit.dispose();
  });
});

describe('quality', () => {
  it('T0 has no shadow map and uses blob shadows and thin weather; T2 has shadows and everything', () => {
    const { kit, r } = make({ level: 0 });
    kit.setTheme(world('storm'));
    const sun = kit.scene.getObjectByName('world-storm')!.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(r.shadowMap.enabled).toBe(false);
    expect(sun.castShadow).toBe(false);
    expect(kit.blobs.mesh.visible).toBe(true);
    const rain = kit.scene.getObjectByName('weather-rain') as THREE.Points;
    expect(rain.geometry.drawRange.count).toBeLessThan(250);
    kit.applyLevel(2);
    expect(r.shadowMap.enabled).toBe(true);
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(1024);
    expect(kit.blobs.mesh.visible).toBe(false);
    expect(rain.geometry.drawRange.count).toBe(900);
    expect(kit.level).toBe(2);
    kit.dispose();
  });

  it('a level change keeps the resource counts (materials swap, nothing piles up)', () => {
    const { kit } = make({ level: 2 });
    kit.setTheme(world('forest'));
    const before = kit.counts();
    for (let i = 0; i < 12; i++) kit.applyLevel(([0, 1, 2] as const)[i % 3]!);
    kit.applyLevel(2);
    expect(kit.counts()).toEqual(before);
    kit.dispose();
  });

  it('the frame cap: 30 fps at T0 renders every second frame of a 60 Hz display, 60 fps tiers every frame', () => {
    const t0 = make({ level: 0 }), t2 = make({ level: 2 });
    let a = 0, b = 0;
    for (let i = 0; i < 600; i++) { const now = 1000 + i * (1000 / 60); if (t0.kit.frameDue(now)) a++; if (t2.kit.frameDue(now)) b++; }
    expect(a).toBe(300);
    expect(b).toBe(600);
  });

  it('the governor drops the level when frames are slow and applies it', () => {
    const { kit } = make({ level: 2 });
    kit.setTheme(world('alps'));
    let changed: number | null = null;
    for (let i = 0; i < 400 && changed === null; i++) changed = kit.sample(40, { paused: false });
    expect(changed).toBe(1);
    expect(kit.level).toBe(1);
    expect(kit.tier.label).toBe('T1');
    kit.dispose();
  });

  it('paused frames do not count', () => {
    const { kit } = make({ level: 2 });
    for (let i = 0; i < 2000; i++) expect(kit.sample(1000, { paused: true })).toBeNull();
    expect(kit.level).toBe(2);
  });

  it('a pinned level (Settings) ignores the governor, and auto goes back to following it', () => {
    const { kit } = make({ level: 2 });
    kit.setQualityMode('low');
    expect(kit.level).toBe(0);
    for (let i = 0; i < 500; i++) expect(kit.sample(8, { paused: false })).toBeNull();
    expect(kit.level).toBe(0);
    kit.setQualityMode('high');
    expect(kit.level).toBe(2);
    kit.setQualityMode('auto');
    let n: number | null = null;
    for (let i = 0; i < 400 && n === null; i++) n = kit.sample(40, { paused: false });
    expect(n).toBe(1);
  });
});

describe('the context and the end', () => {
  it('a lost context pauses drawing and tells the listeners; a restored one resumes', () => {
    const { kit, r } = make();
    kit.setTheme(world('alps'));
    let lost = 0, back = 0;
    kit.on('contextlost', () => lost++);
    const off = kit.on('contextrestored', () => back++);
    kit.render();
    expect(r.renders).toBe(1);
    r.canvas.dispatchEvent(new Event('webglcontextlost'));
    kit.render();
    expect(lost).toBe(1);
    expect(r.renders).toBe(1);
    r.canvas.dispatchEvent(new Event('webglcontextrestored'));
    kit.render();
    expect(back).toBe(1);
    expect(r.renders).toBe(2);
    off();
    r.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(back).toBe(1);
    kit.dispose();
  });

  it('stats come from the renderer', () => {
    const { kit, r } = make();
    r.info.memory.geometries = 31; r.info.memory.textures = 6; r.info.render.calls = 72;
    expect(kit.stats()).toEqual({ geometries: 31, textures: 6, drawCalls: 72 });
  });

  it('dispose frees every resource, stops listening, is safe twice, and gives the context back only on request', () => {
    const { kit, r } = make({ release: 'keep' });
    kit.setTheme(world('city'));
    kit.dispose();
    kit.dispose();
    expect(kit.disposed).toBe(true);
    expect(r.disposed).toBe(1);
    expect(r.lost).toBe(0);
    expect(kit.counts()).toEqual({ geometries: 0, materials: 0, textures: 0, other: 0 });
    expect(() => kit.setTheme(world('alps'))).toThrow();
    let calls = 0;
    kit.on('contextlost', () => calls++);
    r.canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(calls).toBe(0);
    kit.render();
    expect(r.renders).toBe(0);
    const lose = make({ release: 'lose' });
    lose.kit.dispose();
    expect(lose.r.lost).toBe(1);
  });

  it('without a canvas or a renderer it says WebGL is unavailable', () => {
    expect(() => createScene3D({})).toThrowError(/WebGL/);
  });
});
