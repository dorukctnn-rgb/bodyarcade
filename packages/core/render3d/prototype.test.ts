// Prototype cache: any number of obstacles cost no new geometry, clones are reused, and disposing frees the shapes once.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ResourceTracker } from './dispose.ts';
import { createPrototypeCache } from './prototype.ts';

function hurdle(): THREE.Object3D {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1917' });
  const tex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  const striped = new THREE.MeshStandardMaterial({ map: tex });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 0.1), dark));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(5, 0.34), striped));
  return g;
}

function setup(): { scene: THREE.Group; tracker: ResourceTracker; cache: ReturnType<typeof createPrototypeCache> } {
  const scene = new THREE.Group();
  const tracker = new ResourceTracker();
  const cache = createPrototypeCache(scene, tracker);
  cache.define('hurdle', hurdle);
  cache.define('duck', hurdle);
  return { scene, tracker, cache };
}

describe('prototype cache', () => {
  it('defines each shape once and owns its resources', () => {
    const { tracker, cache } = setup();
    expect(cache.stats().prototypes).toBe(2);
    expect(tracker.counts()).toEqual({ geometries: 4, materials: 4, textures: 2, other: 0 });
    expect(() => cache.define('hurdle', hurdle)).toThrow(/twice/);
    tracker.release();
  });

  it('keeps the prototypes hidden so they are never drawn, but in the scene so they can be compiled', () => {
    const { scene, cache, tracker } = setup();
    const holder = scene.getObjectByName('prototypes')!;
    expect(holder.visible).toBe(false);
    expect(holder.children.length).toBe(2);
    expect(cache.has('hurdle')).toBe(true);
    expect(cache.has('nope')).toBe(false);
    tracker.release();
  });

  it('a spawn shares geometry and materials with its prototype and adds nothing to the resource counts', () => {
    const { cache, tracker } = setup();
    const before = tracker.counts();
    const a = cache.spawn('hurdle');
    for (let i = 0; i < 500; i++) cache.spawn('hurdle');
    expect(tracker.counts()).toEqual(before);
    const m = (a.children[0] as THREE.Mesh);
    expect(m.geometry.type).toBe('BoxGeometry');
    tracker.release();
  });

  it('shares by identity, and the clone is a separate object that can be moved', () => {
    const scene = new THREE.Group();
    const tracker = new ResourceTracker();
    const cache = createPrototypeCache(scene, tracker);
    cache.define('wall', hurdle);
    const protoMesh = scene.getObjectByName('prototypes')!.children[0]!.children[0] as THREE.Mesh;
    const a = cache.spawn('wall'), b = cache.spawn('wall');
    expect(a).not.toBe(b);
    expect((a.children[0] as THREE.Mesh).geometry).toBe(protoMesh.geometry);
    expect((a.children[0] as THREE.Mesh).material).toBe(protoMesh.material);
    a.position.set(0, 0, -30);
    expect(b.position.z).toBe(0);
    tracker.release();
  });

  it('release returns the clone for reuse, reset to the identity transform and visible', () => {
    const { scene, cache, tracker } = setup();
    const a = cache.spawn('hurdle');
    scene.add(a);
    a.position.set(1, 2, 3); a.rotation.y = 1; a.scale.setScalar(2); a.visible = false;
    cache.release(a);
    expect(a.parent).toBeNull();
    expect(cache.stats()).toMatchObject({ live: 0, pooled: 1, created: 1 });
    const b = cache.spawn('hurdle');
    expect(b).toBe(a);
    expect(b.position.toArray()).toEqual([0, 0, 0]);
    expect(b.rotation.y).toBe(0);
    expect(b.scale.toArray()).toEqual([1, 1, 1]);
    expect(b.visible).toBe(true);
    expect(cache.stats()).toMatchObject({ live: 1, pooled: 0, created: 1, reused: 1 });
    tracker.release();
  });

  it('forty obstacles over a long run make at most as many clones as are alive at once', () => {
    const { scene, cache, tracker } = setup();
    const alive: THREE.Object3D[] = [];
    for (let i = 0; i < 4000; i++) {
      const o = cache.spawn(i % 3 ? 'hurdle' : 'duck');
      scene.add(o);
      alive.push(o);
      if (alive.length > 6) cache.release(alive.shift()!);
    }
    const s = cache.stats();
    expect(s.created).toBeLessThanOrEqual(14);
    expect(s.reused).toBeGreaterThan(3900);
    expect(s.live).toBe(6);
    expect(tracker.counts().geometries).toBe(4);
    tracker.release();
  });

  it('releasing twice, or something it never made, is harmless', () => {
    const { cache, tracker } = setup();
    const a = cache.spawn('hurdle');
    cache.release(a); cache.release(a);
    expect(cache.stats().pooled).toBe(1);
    cache.release(new THREE.Group());
    expect(cache.stats()).toMatchObject({ live: 0, pooled: 1 });
    tracker.release();
  });

  it('releaseAll empties the stage for a new run', () => {
    const { scene, cache, tracker } = setup();
    for (let i = 0; i < 9; i++) scene.add(cache.spawn('hurdle'));
    expect(scene.children.length).toBe(10);   // nine clones and the hidden holder
    cache.releaseAll();
    expect(scene.children.length).toBe(1);
    expect(cache.stats()).toMatchObject({ live: 0, pooled: 9 });
    tracker.release();
  });

  it('an unknown shape is an error that names it', () => {
    const { cache, tracker } = setup();
    expect(() => cache.spawn('nope')).toThrow(/nope/);
    tracker.release();
  });

  it('dispose removes the holder and refuses new spawns; the tracker frees the shapes once', () => {
    const { scene, cache, tracker } = setup();
    scene.add(cache.spawn('hurdle'));
    cache.dispose();
    expect(scene.children.length).toBe(0);
    expect(() => cache.spawn('hurdle')).toThrow();
    tracker.release();
    expect(tracker.empty).toBe(true);
  });
});
