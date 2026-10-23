// Sky: gradient, sun, stars and aurora come from the theme; the sky follows the camera; lightning is a uniform, not a
// light; the day drifts a little in a run; and the sky frees everything it made.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../loop/rng.ts';
import { ResourceTracker } from './dispose.ts';
import { buildSky, CLOUD_COUNT, dayColor, dayDirection, DAY_SINK, HORIZON_Y, SKY_FRAG, SKY_RADIUS, sunDirection } from './sky.ts';
import { themeOrThrow, type Theme } from './theme.ts';

const worlds = (JSON.parse(readFileSync(new URL('./themes/classic-worlds.json', import.meta.url), 'utf8')) as Record<string, unknown>[]).map((w) => themeOrThrow(w));
const byId = (id: string): Theme => worlds.find((w) => w.id === id)!;

describe.each(worlds.map((w) => [w.id, w] as const))('sky of %s', (_id, theme) => {
  it('takes its gradient, sun, stars and aurora from the theme', () => {
    const tracker = new ResourceTracker();
    const sky = buildSky(theme, mulberry32(1), tracker);
    const u = sky.material.uniforms;
    expect((u['uTop']!.value as THREE.Color).getHexString()).toBe(new THREE.Color(theme.sky.top).getHexString());
    expect((u['uMid']!.value as THREE.Color).getHexString()).toBe(new THREE.Color(theme.sky.mid).getHexString());
    expect((u['uBot']!.value as THREE.Color).getHexString()).toBe(new THREE.Color(theme.sky.bot).getHexString());
    expect((u['uSunColor']!.value as THREE.Color).getHexString()).toBe(new THREE.Color(theme.sky.sunGlow).getHexString());
    expect(u['uStars']!.value).toBe(theme.sky.stars);
    expect(u['uAurora']!.value).toBe(theme.sky.aurora ? 1 : 0);
    expect((u['uSunDir']!.value as THREE.Vector3).length()).toBeCloseTo(1, 9);
    tracker.release();
  });

  it('has a dome, a horizon ring, and clouds only when the theme has them', () => {
    const tracker = new ResourceTracker();
    const sky = buildSky(theme, mulberry32(1), tracker);
    const names = sky.root.children.map((c) => c.name);
    expect(names).toContain('sky-dome');
    expect(names).toContain('horizon');
    expect(names.includes('clouds')).toBe(theme.sky.clouds !== null);
    const clouds = sky.root.getObjectByName('clouds') as THREE.Points | undefined;
    if (clouds) expect(clouds.geometry.getAttribute('position').count).toBe(CLOUD_COUNT);
    tracker.release();
  });

  it('owns what it builds (dome, ring, horizon texture; clouds add a geometry, a material and a texture) and frees it', () => {
    const tracker = new ResourceTracker();
    buildSky(theme, mulberry32(1), tracker);
    const c = tracker.counts();
    const clouds = theme.sky.clouds !== null ? 1 : 0;
    expect(c.geometries).toBe(2 + clouds);
    expect(c.materials).toBe(2 + clouds);
    expect(c.textures).toBe(1 + clouds);
    tracker.release();
    expect(tracker.empty).toBe(true);
  });

  it('draws the same horizon and clouds for the same seed', () => {
    const a = new ResourceTracker(), b = new ResourceTracker();
    const sa = buildSky(theme, mulberry32(8), a), sb = buildSky(theme, mulberry32(8), b);
    const tex = (k: ReturnType<typeof buildSky>): Uint8Array => ((k.root.getObjectByName('horizon') as THREE.Mesh).material as THREE.MeshBasicMaterial).map!.image.data as Uint8Array;
    expect(Buffer.compare(Buffer.from(tex(sa)), Buffer.from(tex(sb)))).toBe(0);
    a.release(); b.release();
  });
});

describe('sky behaviour', () => {
  it('follows the camera, turns the horizon a little with the runner and counts time for stars and aurora', () => {
    const tracker = new ResourceTracker();
    const sky = buildSky(byId('arctic'), mulberry32(1), tracker);
    const cam = new THREE.Vector3(3, 2.4, 5.4);
    sky.update(0.5, cam, 2);
    const dome = sky.root.getObjectByName('sky-dome')!;
    const ring = sky.root.getObjectByName('horizon')!;
    expect(dome.position.toArray()).toEqual([3, 2.4, 5.4]);
    expect(ring.rotation.y).toBeCloseTo(0.008, 9);
    expect(ring.position.y).toBe(HORIZON_Y);
    expect(sky.material.uniforms['uTime']!.value).toBeCloseTo(0.5, 9);
    sky.update(0.25, cam, 2);
    expect(sky.material.uniforms['uTime']!.value).toBeCloseTo(0.75, 9);
    expect(((dome as THREE.Mesh).geometry as THREE.SphereGeometry).parameters.radius).toBe(SKY_RADIUS);
    tracker.release();
  });

  it('lightning is a uniform (no light is added) and the shader reads it', () => {
    const tracker = new ResourceTracker();
    const sky = buildSky(byId('storm'), mulberry32(1), tracker);
    sky.setFlash(0.7);
    expect(sky.material.uniforms['uFlash']!.value).toBe(0.7);
    expect(SKY_FRAG).toContain('uFlash');
    let lights = 0;
    sky.root.traverse((o) => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
    tracker.release();
  });

  it('the day: the sun sinks and warms, never below the horizon plane by more than a hair, and k is clamped', () => {
    const t = byId('alps');
    const base = sunDirection(t, new THREE.Vector3());
    const dir = new THREE.Vector3();
    expect(dayDirection(t, 0, dir).toArray()).toEqual(base.toArray());
    dayDirection(t, 1, dir);
    expect(dir.y).toBeLessThan(base.y);
    expect(dir.y).toBeGreaterThan(base.y * (1 - DAY_SINK) - 0.05);
    expect(dir.length()).toBeCloseTo(1, 9);
    expect(dayDirection(t, 5, new THREE.Vector3()).toArray()).toEqual(dir.toArray());
    expect(dayDirection(t, -3, new THREE.Vector3()).toArray()).toEqual(base.toArray());
    const c0 = dayColor(t.sky.sunGlow, 0, new THREE.Color()), c1 = dayColor(t.sky.sunGlow, 1, new THREE.Color());
    expect(c0.getHexString()).toBe(new THREE.Color(t.sky.sunGlow).getHexString());
    expect(c1.r).toBeGreaterThanOrEqual(c0.r - 1e-9);
    expect(c1.b).toBeLessThanOrEqual(c0.b + 1e-9);
  });

  it('setDay moves the uniforms the shader reads', () => {
    const tracker = new ResourceTracker();
    const t = byId('sunset');
    const sky = buildSky(t, mulberry32(1), tracker);
    const y0 = sky.sunDir.y;
    sky.setDay(1);
    expect(sky.sunDir.y).toBeLessThanOrEqual(y0);
    expect(sky.material.uniforms['uSunDir']!.value).toBe(sky.sunDir);
    expect(sky.material.uniforms['uSunColor']!.value).toBe(sky.sunColor);
    tracker.release();
  });

  it('keeps the clouds level with the camera sideways', () => {
    const tracker = new ResourceTracker();
    const sky = buildSky(byId('alps'), mulberry32(1), tracker);
    sky.update(0.1, new THREE.Vector3(-4, 2, 5), 0);
    expect(sky.root.getObjectByName('clouds')!.position.x).toBe(-4);
    tracker.release();
  });
});
