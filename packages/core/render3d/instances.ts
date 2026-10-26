// A batch of instances drawn in one call, rewritten every frame without allocating (the old engine made a new Euler
// per coin per frame, graphics-maps.md fix 6). Used for pickups (coins) and for the blob shadows of the lowest tier.
import * as THREE from 'three';

export interface InstanceBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  /** Instances written since begin(). */
  readonly count: number;
  /** Starts a frame: the batch is empty until something is pushed. */
  begin(): void;
  /** Adds one instance (position, turn about the vertical axis, scale per axis). False when the batch is full. */
  push(x: number, y: number, z: number, ry?: number, sx?: number, sy?: number, sz?: number): boolean;
  /** Ends the frame: only what was pushed is drawn. */
  end(): void;
}

export function createBatch(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], capacity: number, name: string): InstanceBatch {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;       // instances move every frame; one bounding sphere would have to be rebuilt
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  let n = 0;
  return {
    mesh, capacity,
    get count() { return n; },
    begin() { n = 0; },
    push(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) {
      if (n >= capacity) return false;
      p.set(x, y, z);
      q.setFromAxisAngle(axis, ry);
      s.set(sx, sy, sz);
      mesh.setMatrixAt(n++, m.compose(p, q, s));
      return true;
    },
    end() {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
