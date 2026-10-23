// Every GPU object has an owner that releases it (code-audit.md 11.1 rule 5). The old engine's setWorld left
// +6 textures and +31 geometries behind every run, and its obstacle factory +170 geometries per 40 obstacles (B5).
// A ResourceTracker remembers what it was handed and frees all of it in one call; the counts feed the counting tests.
//
// three.js frees nothing by itself: "These entities are only deleted if you call BufferGeometry.dispose()".
// Disposing is always safe (a resource that is used again is uploaded again), so the rule here is simple: whoever
// creates a resource tracks it, and whoever owns the tracker releases it.
import * as THREE from 'three';

type Disposable = { dispose(): void };

export interface ResourceCounts { geometries: number; materials: number; textures: number; other: number }

const isTexture = (v: unknown): v is THREE.Texture => typeof v === 'object' && v !== null && (v as THREE.Texture).isTexture === true;

/** Every texture a material points at: its own slots (map, emissiveMap, ...) and shader uniforms. */
export function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const k of Object.keys(m)) {
    const v = (m as unknown as Record<string, unknown>)[k];
    if (isTexture(v)) out.push(v);
  }
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const k of Object.keys(u)) { const v = u[k]?.value as unknown; if (isTexture(v)) out.push(v); }
  return out;
}

export class ResourceTracker {
  private readonly geos = new Set<THREE.BufferGeometry>();
  private readonly mats = new Set<THREE.Material>();
  private readonly texs = new Set<THREE.Texture>();
  private readonly other = new Set<Disposable>();
  private readonly roots = new Set<THREE.Object3D>();
  private released = false;

  /** Remembers a geometry, material, texture, object tree or anything with dispose(). Returns it, so it can wrap a constructor call. */
  track<T>(r: T): T {
    if (r === null || r === undefined) return r;
    this.released = false;
    if (r instanceof THREE.BufferGeometry) this.geos.add(r);
    else if (r instanceof THREE.Material) this.addMaterial(r);
    else if (isTexture(r)) this.texs.add(r);
    else if (r instanceof THREE.Object3D) this.trackObject(r);
    else if (typeof (r as unknown as Disposable).dispose === 'function') this.other.add(r as unknown as Disposable);
    return r;
  }

  /**
   * Remembers everything below an object: geometries, materials, their textures, instanced buffers, shadow maps.
   * Children added later are found when the tracker is released (it looks again).
   */
  trackObject(root: THREE.Object3D): void {
    this.released = false;
    this.roots.add(root);
    this.scanObject(root);
  }

  private addMaterial(m: THREE.Material): void {
    this.mats.add(m);
    for (const t of texturesOf(m)) this.texs.add(t);
  }

  private scanObject(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) this.geos.add(mesh.geometry);
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (m) for (const x of Array.isArray(m) ? m : [m]) this.addMaterial(x);
    });
  }

  /** Looks at every tracked tree again, so objects added after trackObject() are counted and freed too. */
  rescan(): void {
    for (const root of this.roots) this.scanObject(root);
    for (const m of this.mats) for (const t of texturesOf(m)) this.texs.add(t);
  }

  /**
   * Frees one resource now and forgets it (a material swapped for another, a texture replaced). Geometries and
   * textures that other tracked materials or meshes still use are the caller's business: pass only what is unused.
   */
  free(r: THREE.BufferGeometry | THREE.Material | THREE.Texture | Disposable): void {
    if (r instanceof THREE.BufferGeometry) { this.geos.delete(r); r.dispose(); return; }
    if (r instanceof THREE.Material) {
      this.mats.delete(r);
      for (const t of texturesOf(r)) if (this.texs.delete(t)) t.dispose();
      r.dispose();
      return;
    }
    if (isTexture(r)) { this.texs.delete(r); r.dispose(); return; }
    this.other.delete(r);
    r.dispose();
  }

  /**
   * Frees the resources of one object tree that nobody else uses (a clone that shares them must not call this).
   * Only resources this tracker knows are freed.
   */
  disposeObject(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && this.geos.delete(mesh.geometry)) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (m) for (const x of Array.isArray(m) ? m : [m]) {
        if (!this.mats.delete(x)) continue;
        for (const t of texturesOf(x)) if (this.texs.delete(t)) t.dispose();
        x.dispose();
      }
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.roots.delete(root);
  }

  /** Frees everything remembered. Safe to call twice; the tracker can be used again afterwards. */
  release(): void {
    this.rescan();
    for (const root of this.roots) {
      root.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        const light = o as THREE.Light;
        if (light.isLight && light.shadow && light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
      });
    }
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    for (const d of this.other) d.dispose();
    this.geos.clear(); this.mats.clear(); this.texs.clear(); this.other.clear(); this.roots.clear();
    this.released = true;
  }

  /** True when nothing is tracked. */
  get empty(): boolean {
    return this.geos.size + this.mats.size + this.texs.size + this.other.size + this.roots.size === 0;
  }

  /** True once release() has run and nothing has been tracked since. */
  get wasReleased(): boolean { return this.released; }

  counts(): ResourceCounts {
    this.rescan();
    return { geometries: this.geos.size, materials: this.mats.size, textures: this.texs.size, other: this.other.size };
  }
}

/** Frees a whole subtree without keeping a tracker (for code that builds an object and hands it away). */
export function disposeTree(root: THREE.Object3D): void {
  const t = new ResourceTracker();
  t.trackObject(root);
  t.release();
}

/** Sums two counts (a scene is several owners). */
export function addCounts(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  return { geometries: a.geometries + b.geometries, materials: a.materials + b.materials, textures: a.textures + b.textures, other: a.other + b.other };
}
