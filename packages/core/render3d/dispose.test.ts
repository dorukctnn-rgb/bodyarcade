// ResourceTracker: what is handed to it is freed exactly once, shared resources are counted once, textures inside
// materials are found, and objects added after tracking are not forgotten (the old engine forgot all of this: B5).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addCounts, disposeTree, ResourceTracker, texturesOf } from './dispose.ts';

/** Counts 'dispose' events per object. */
function watch(...objs: { addEventListener(t: 'dispose', cb: () => void): void }[]): () => number[] {
  const n = objs.map(() => 0);
  objs.forEach((o, i) => o.addEventListener('dispose', () => { n[i] = (n[i] ?? 0) + 1; }));
  return () => [...n];
}

const tex = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array(4), 1, 1);

describe('ResourceTracker: counting and releasing', () => {
  it('counts what it is handed and frees each thing once', () => {
    const t = new ResourceTracker();
    const g = t.track(new THREE.BoxGeometry());
    const map = t.track(tex());
    const m = t.track(new THREE.MeshStandardMaterial({ map }));
    const disposed = watch(g, m, map);
    expect(t.counts()).toEqual({ geometries: 1, materials: 1, textures: 1, other: 0 });
    t.release();
    expect(disposed()).toEqual([1, 1, 1]);
    expect(t.counts()).toEqual({ geometries: 0, materials: 0, textures: 0, other: 0 });
    t.release();                              // twice is harmless
    expect(disposed()).toEqual([1, 1, 1]);
    expect(t.empty).toBe(true);
    expect(t.wasReleased).toBe(true);
  });

  it('track() returns what it was given, also null and undefined', () => {
    const t = new ResourceTracker();
    const g = new THREE.SphereGeometry();
    expect(t.track(g)).toBe(g);
    expect(t.track(null)).toBeNull();
    expect(t.track(undefined)).toBeUndefined();
    expect(t.counts().geometries).toBe(1);
  });

  it('a texture used by a material is found without being tracked by itself', () => {
    const t = new ResourceTracker();
    const map = tex(), emissive = tex();
    const m = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive });
    t.track(m);
    expect(t.counts().textures).toBe(2);
    const disposed = watch(map, emissive);
    t.release();
    expect(disposed()).toEqual([1, 1]);
  });

  it('finds textures in shader uniforms too (the sky and any custom material)', () => {
    const map = tex();
    const m = new THREE.ShaderMaterial({ uniforms: { uMap: { value: map }, uNumber: { value: 3 } } });
    expect(texturesOf(m)).toEqual([map]);
    const t = new ResourceTracker();
    t.track(m);
    const disposed = watch(map, m);
    t.release();
    expect(disposed()).toEqual([1, 1]);
  });

  it('a geometry or material shared by many meshes is one resource and is freed once', () => {
    const t = new ResourceTracker();
    const g = new THREE.BoxGeometry();
    const m = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    for (let i = 0; i < 20; i++) root.add(new THREE.Mesh(g, m));
    t.trackObject(root);
    expect(t.counts()).toMatchObject({ geometries: 1, materials: 1 });
    const disposed = watch(g, m);
    t.release();
    expect(disposed()).toEqual([1, 1]);
  });

  it('meshes with a list of materials are covered', () => {
    const t = new ResourceTracker();
    const a = new THREE.MeshBasicMaterial(), b = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [a, b]);
    t.trackObject(mesh);
    expect(t.counts().materials).toBe(2);
    const disposed = watch(a, b);
    t.release();
    expect(disposed()).toEqual([1, 1]);
  });

  it('objects added to a tracked tree AFTER tracking are counted and freed (the old engine forgot them)', () => {
    const t = new ResourceTracker();
    const root = new THREE.Group();
    t.trackObject(root);
    const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: tex() }));
    root.add(late);
    expect(t.counts()).toEqual({ geometries: 1, materials: 1, textures: 1, other: 0 });
    const disposed = watch(late.geometry, late.material as THREE.Material);
    t.release();
    expect(disposed()).toEqual([1, 1]);
  });

  it('instanced meshes release their instance buffers', () => {
    const t = new ResourceTracker();
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 10);
    t.trackObject(im);
    const disposed = watch(im);
    t.release();
    expect(disposed()).toEqual([1]);
  });

  it('shadow maps of lights are released and cleared', () => {
    const t = new ResourceTracker();
    const root = new THREE.Group();
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    sun.shadow.map = new THREE.WebGLRenderTarget(16, 16);
    const map = sun.shadow.map;
    root.add(sun);
    t.trackObject(root);
    const disposed = watch(map);
    t.release();
    expect(disposed()).toEqual([1]);
    expect(sun.shadow.map).toBeNull();
  });

  it('anything with dispose() is accepted and counted as "other"', () => {
    const t = new ResourceTracker();
    let n = 0;
    t.track({ dispose: () => { n++; } });
    expect(t.counts().other).toBe(1);
    t.release();
    expect(n).toBe(1);
  });

  it('can be used again after a release', () => {
    const t = new ResourceTracker();
    t.track(new THREE.BoxGeometry());
    t.release();
    expect(t.wasReleased).toBe(true);
    const g = t.track(new THREE.BoxGeometry());
    expect(t.wasReleased).toBe(false);
    expect(t.counts().geometries).toBe(1);
    const disposed = watch(g);
    t.release();
    expect(disposed()).toEqual([1]);
  });
});

describe('ResourceTracker: freeing parts', () => {
  it('free(material) frees the material and the textures only it used, and forgets both', () => {
    const t = new ResourceTracker();
    const map = tex();
    const m = t.track(new THREE.MeshStandardMaterial({ map }));
    const disposed = watch(m, map);
    t.free(m);
    expect(disposed()).toEqual([1, 1]);
    expect(t.counts()).toMatchObject({ materials: 0, textures: 0 });
    t.release();
    expect(disposed()).toEqual([1, 1]);       // not freed a second time
  });

  it('free(geometry) and free(texture) do the same', () => {
    const t = new ResourceTracker();
    const g = t.track(new THREE.BoxGeometry());
    const x = t.track(tex());
    const disposed = watch(g, x);
    t.free(g); t.free(x);
    expect(disposed()).toEqual([1, 1]);
    expect(t.empty).toBe(true);
  });

  it('disposeObject frees one subtree and leaves the rest of the tracker alone', () => {
    const t = new ResourceTracker();
    const keep = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const drop = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial({ map: tex() }));
    t.trackObject(keep); t.trackObject(drop);
    const dKeep = watch(keep.geometry, keep.material as THREE.Material);
    const dDrop = watch(drop.geometry, drop.material as THREE.Material);
    t.disposeObject(drop);
    expect(dDrop()).toEqual([1, 1]);
    expect(dKeep()).toEqual([0, 0]);
    expect(t.counts()).toMatchObject({ geometries: 1, materials: 1, textures: 0 });
  });

  it('disposeObject does not free what a clone shares with something this tracker never saw', () => {
    const t = new ResourceTracker();
    const g = new THREE.BoxGeometry();               // not tracked
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const disposed = watch(g);
    t.disposeObject(mesh);
    expect(disposed()).toEqual([0]);
  });
});

describe('helpers', () => {
  it('disposeTree frees a whole subtree without a tracker', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: tex() }));
    root.add(a);
    const disposed = watch(a.geometry, a.material as THREE.Material);
    disposeTree(root);
    expect(disposed()).toEqual([1, 1]);
  });

  it('addCounts sums two owners', () => {
    expect(addCounts({ geometries: 1, materials: 2, textures: 3, other: 4 }, { geometries: 10, materials: 20, textures: 30, other: 40 }))
      .toEqual({ geometries: 11, materials: 22, textures: 33, other: 44 });
  });
});
