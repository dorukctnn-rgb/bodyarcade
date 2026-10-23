// Prototype cache for things that appear many times (obstacles, pickups, ghosts).
//
// The old engine built every obstacle from new Box and Plane geometries: +170 geometries and 680 buffer uploads for
// 40 obstacles, 1.8 ms each and 33 ms at worst (a dropped frame), and the removed ones were never freed
// (graphics-maps.md fix 2, audit B5). Here a game defines each shape ONCE per world; spawn() hands out clones that
// share its geometry and materials, release() takes a clone back into a free list instead of disposing anything
// (it is shared), and the prototypes live (hidden) in the scene so that renderer.compile() can build their shaders
// before the first obstacle appears. Whoever owns the cache calls dispose() once, and the tracker frees the shapes.
import * as THREE from 'three';
import type { ResourceTracker } from './dispose.ts';

export interface PrototypeStats {
  /** Shapes defined. */
  prototypes: number;
  /** Clones in use. */
  live: number;
  /** Clones waiting for reuse. */
  pooled: number;
  /** Clones ever made (stays near the peak of `live`). */
  created: number;
  /** Spawns served from the free list. */
  reused: number;
}

export interface PrototypeCache {
  /** Builds the shape once. The object is kept hidden under `parent` and its resources go to the tracker. Throws on a repeated key. */
  define(key: string, build: () => THREE.Object3D): void;
  has(key: string): boolean;
  /** A ready object (visible, identity transform) that shares the prototype's geometry and materials. Not yet in the scene. */
  spawn(key: string): THREE.Object3D;
  /** Takes a spawned object out of its parent and keeps it for reuse. Releasing something twice, or not from here, is harmless. */
  release(o: THREE.Object3D): void;
  /** Releases every clone in use (a new run). */
  releaseAll(): void;
  stats(): PrototypeStats;
  /** Forgets the clones and removes the prototypes from the scene; the tracker frees the shapes. */
  dispose(): void;
}

export function createPrototypeCache(parent: THREE.Object3D, tracker: ResourceTracker): PrototypeCache {
  const protos = new Map<string, THREE.Object3D>();
  const pool = new Map<string, THREE.Object3D[]>();
  const live = new Set<THREE.Object3D>();
  const keyOf = new WeakMap<THREE.Object3D, string>();
  const holder = new THREE.Group();
  holder.name = 'prototypes';
  holder.visible = false;
  parent.add(holder);
  tracker.trackObject(holder);
  let created = 0, reused = 0, disposed = false;

  const reset = (o: THREE.Object3D): void => {
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
    o.visible = true;
  };

  return {
    define(key, build) {
      if (protos.has(key)) throw new Error(`prototype "${key}" is defined twice`);
      const o = build();
      o.visible = true;                 // the holder is the hidden one: clones copy `visible` and must be shown
      protos.set(key, o);
      pool.set(key, []);
      holder.add(o);
      tracker.trackObject(holder);      // scan again: the new shape's geometry, materials and textures
    },
    has: (key) => protos.has(key),
    spawn(key) {
      if (disposed) throw new Error('the prototype cache was disposed');
      const proto = protos.get(key);
      if (!proto) throw new Error(`unknown prototype "${key}"`);
      const free = pool.get(key)!;
      let o = free.pop();
      if (o) reused++;
      else { o = proto.clone(); keyOf.set(o, key); created++; }
      reset(o);
      live.add(o);
      return o;
    },
    release(o) {
      if (!live.delete(o)) return;
      o.parent?.remove(o);
      const key = keyOf.get(o);
      if (key !== undefined && !disposed) pool.get(key)?.push(o);
    },
    releaseAll() {
      for (const o of [...live]) this.release(o);
    },
    stats() {
      let pooled = 0;
      for (const l of pool.values()) pooled += l.length;
      return { prototypes: protos.size, live: live.size, pooled, created, reused };
    },
    dispose() {
      for (const o of live) o.parent?.remove(o);
      live.clear();
      pool.clear();
      protos.clear();
      parent.remove(holder);
      disposed = true;
    },
  };
}
