// Scenery: the fog cut matches the measured table, placements are a pure function of (seed, prop, side, index), the
// ring of slices never leaves a gap in front of the camera, recycling only rewrites matrices, and releasing the
// kit frees everything it made (no leak per world).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ResourceTracker } from './dispose.ts';
import { QUALITY_TIERS } from './quality.ts';
import {
  CAMERA_Z, createScenery, fogAt, fogCutDistance, hash01, latticeRange, placement, ringSize, sliceCapacity, SLICE_LEN,
  type Placement,
} from './scenery.ts';
import { themeOrThrow, type PropDef, type Theme } from './theme.ts';

const worlds = (JSON.parse(readFileSync(new URL('./themes/classic-worlds.json', import.meta.url), 'utf8')) as Record<string, unknown>[]).map((w) => themeOrThrow(w));
const byId = (id: string): Theme => worlds.find((w) => w.id === id)!;
const T0 = QUALITY_TIERS[0], T1 = QUALITY_TIERS[1], T2 = QUALITY_TIERS[2];

describe('fog cut', () => {
  // graphics-maps.md 3.7: the distance from which the fog hides at least 98.5 % (rounded to metres in the report).
  const table: [string, number][] = [['jungle', 93], ['storm', 98], ['arctic', 103], ['volcano', 103], ['forest', 108], ['city', 128], ['alps', 158], ['sunset', 171], ['desert', 186], ['coast', 186]];
  it.each(table)('%s: %i m', (id, metres) => {
    expect(Math.abs(fogCutDistance(byId(id).fog.density) - metres)).toBeLessThanOrEqual(0.5 + 1e-6);   // the report rounds to whole metres
  });

  it('is where the fog passes 98.5 percent', () => {
    for (const w of worlds) {
      expect(fogAt(w.fog.density, fogCutDistance(w.fog.density))).toBeGreaterThan(0.984);
      expect(fogAt(w.fog.density, fogCutDistance(w.fog.density) * 0.9)).toBeLessThan(0.978);
    }
  });

  it('the ring is long enough to reach past the cut and no longer', () => {
    for (const w of worlds) {
      const n = ringSize(w);
      expect(n * SLICE_LEN).toBeGreaterThanOrEqual(fogCutDistance(w.fog.density));
      expect((n - 2) * SLICE_LEN).toBeLessThan(fogCutDistance(w.fog.density));
    }
  });
});

describe('hash01', () => {
  it('is the same for the same inputs and in [0, 1)', () => {
    expect(hash01(1, 2, 3, 4, 5)).toBe(hash01(1, 2, 3, 4, 5));
    for (let i = 0; i < 5000; i++) { const v = hash01(77, i, i * 3, i % 7, i % 5); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('spreads evenly and the five inputs are independent of each other', () => {
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) { const v = hash01(9, i, 1, 2, 3); sum += v; buckets[Math.min(9, Math.floor(v * 10))]!++; }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    for (const b of buckets) { expect(b).toBeGreaterThan(n / 10 * 0.9); expect(b).toBeLessThan(n / 10 * 1.1); }
    // the same index with different k must not repeat the number
    let same = 0;
    for (let i = 0; i < 2000; i++) if (Math.abs(hash01(9, 4, 1, i, 1) - hash01(9, 4, 1, i, 2)) < 1e-9) same++;
    expect(same).toBe(0);
  });
});

describe('placement', () => {
  const pine: PropDef = { kind: 'pine', every: 7, side: [4, 12], scale: [0.8, 1.4], tint: null, snow: false, fixed: false };
  const out = (): Placement => ({ dist: 0, x: 0, scale: 1, ry: 0, variant: 0 });

  it('is a pure function of its inputs', () => {
    expect(placement(pine, 0, 5, -1, 12, out())).toEqual(placement(pine, 0, 5, -1, 12, out()));
    expect(placement(pine, 0, 5, -1, 12, out())).not.toEqual(placement(pine, 0, 6, -1, 12, out()));
    expect(placement(pine, 0, 5, -1, 12, out())).not.toEqual(placement(pine, 0, 5, 1, 12, out()));
  });

  it('keeps every value inside the ranges of the theme', () => {
    const p = out();
    for (let j = 0; j < 400; j++) for (const side of [-1, 1] as const) {
      placement(pine, 0, 3, side, j, p);
      expect(p.dist).toBeGreaterThanOrEqual(j * 7);
      expect(p.dist).toBeLessThan(j * 7 + 0.6 * 7);
      expect(Math.sign(p.x)).toBe(side);
      expect(Math.abs(p.x)).toBeGreaterThanOrEqual(4);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(12);
      expect(p.scale).toBeGreaterThanOrEqual(0.8);
      expect(p.scale).toBeLessThanOrEqual(1.4);
      expect(p.ry).toBeGreaterThanOrEqual(0);
      expect(p.ry).toBeLessThan(Math.PI * 2);
    }
  });

  it('a fixed row stands in the middle of every interval, on a fixed side line, without turn or random scale', () => {
    const rail: PropDef = { kind: 'rail', every: 3, side: [3.1, 3.1], scale: [1, 1], tint: null, snow: false, fixed: true };
    const p = out();
    for (let j = 0; j < 50; j++) {
      placement(rail, 0, 1, 1, j, p);
      expect(p.dist).toBeCloseTo((j + 0.5) * 3, 9);
      expect(p.x).toBe(3.1);
      expect(p.ry).toBe(0);
      expect(p.scale).toBe(1);
    }
  });

  it('lamps face the road from both sides and buildings turn in quarter turns, with three variants', () => {
    const lamp: PropDef = { kind: 'lamp', every: 12, side: [3, 3.5], scale: [1, 1], tint: null, snow: false, fixed: false };
    const bld: PropDef = { kind: 'building', every: 9, side: [8, 20], scale: [0.9, 1.4], tint: null, snow: false, fixed: false };
    const p = out();
    expect(placement(lamp, 0, 1, -1, 3, p).ry).toBe(Math.PI);
    expect(placement(lamp, 0, 1, 1, 3, p).ry).toBe(0);
    const seen = [0, 0, 0];
    for (let j = 0; j < 600; j++) {
      placement(bld, 0, 1, 1, j, p);
      expect(Math.abs((p.ry / (Math.PI / 2)) - Math.round(p.ry / (Math.PI / 2)))).toBeLessThan(1e-9);
      seen[p.variant]!++;
    }
    for (const c of seen) expect(c).toBeGreaterThan(150);
  });

  it('a lattice range always contains every index that can land in the slice', () => {
    const p = out();
    for (const def of worlds.flatMap((w) => w.props)) {
      for (const start of [0, 40, 400, 12_000]) {
        const [lo, hi] = latticeRange(def, start, SLICE_LEN);
        for (let j = 0; j < Math.ceil((start + 200) / def.every) + 5; j++) {
          placement(def, 0, 11, -1, j, p);
          if (p.dist >= start && p.dist < start + SLICE_LEN) { expect(j).toBeGreaterThanOrEqual(lo); expect(j).toBeLessThanOrEqual(hi); }
        }
      }
    }
  });

  it('a slice never holds more than its capacity', () => {
    for (const def of worlds.flatMap((w) => w.props)) {
      for (let start = 0; start < 2000; start += 40) {
        let n = 0;
        const p = out();
        for (const side of [-1, 1] as const) {
          const [lo, hi] = latticeRange(def, start, SLICE_LEN);
          for (let j = lo; j <= hi; j++) { placement(def, 0, 2, side, j, p); if (p.dist >= start && p.dist < start + SLICE_LEN) n++; }
        }
        expect(n).toBeLessThanOrEqual(sliceCapacity(def));
      }
    }
  });
});

function matricesOf(root: THREE.Group): number[] {
  const out: number[] = [];
  root.children.forEach((slice) => slice.children.forEach((m) => {
    const im = m as THREE.InstancedMesh;
    out.push(im.count, ...Array.from(im.instanceMatrix.array.slice(0, im.count * 16)));
  }));
  return out;
}

/** Every instance as "name:worldZ:x", sorted: the content of the world at the current course distance. */
function worldContent(kit: ReturnType<typeof createScenery>): string[] {
  const out: string[] = [];
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  kit.root.children.forEach((slice) => {
    const base = slice.position.z;
    slice.children.forEach((mesh) => {
      const im = mesh as THREE.InstancedMesh;
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); p.setFromMatrixPosition(m); out.push(`${mesh.name}:${(base + p.z).toFixed(4)}:${p.x.toFixed(4)}`); }
    });
  });
  return out.sort();
}

describe.each(worlds.map((w) => [w.id, w] as const))('scenery of %s', (_id, theme) => {
  const make = (seed = 0, tier = T2): { kit: ReturnType<typeof createScenery>; tracker: ResourceTracker } => {
    const tracker = new ResourceTracker();
    return { kit: createScenery(theme, tracker, { seed, tier }), tracker };
  };

  it('builds a ring of slices, shows only those the fog allows, and has props beside the road', () => {
    const { kit, tracker } = make();
    const s = kit.stats();
    expect(s.slices).toBe(ringSize(theme));
    expect(s.visibleSlices).toBeGreaterThan(0);
    expect(s.visibleSlices).toBeLessThanOrEqual(s.slices);
    expect(s.instances).toBeGreaterThan(5);
    expect(s.drawCalls).toBeGreaterThan(0);
    expect(s.drawCalls).toBeLessThan(60);
    tracker.release();
  });

  it('puts every instance inside its slice', () => {
    const { kit, tracker } = make();
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    kit.root.children.forEach((slice) => slice.children.forEach((mesh) => {
      const im = mesh as THREE.InstancedMesh;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        expect(p.z).toBeLessThanOrEqual(0);
        expect(p.z).toBeGreaterThan(-SLICE_LEN - 1e-6);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(60);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }));
    tracker.release();
  });

  it('is the same world for the same seed, another for another seed', () => {
    const a = make(1), b = make(1), c = make(2);
    expect(matricesOf(a.kit.root)).toEqual(matricesOf(b.kit.root));
    expect(matricesOf(a.kit.root)).not.toEqual(matricesOf(c.kit.root));
    a.tracker.release(); b.tracker.release(); c.tracker.release();
  });

  it('shows the same trees at the same course distance however the camera got there', () => {
    const a = make(4), b = make(4);
    for (let d = 0; d <= 900; d += 0.25) a.kit.update(d);
    b.kit.update(900);
    expect(worldContent(a.kit)).toEqual(worldContent(b.kit));
    a.tracker.release(); b.tracker.release();
  });

  it('leaves no gap in front of the camera while the world scrolls (the far end is always beyond the fog)', () => {
    const { kit, tracker } = make();
    const cut = kit.cut;
    for (let d = 0; d < 2500; d += 0.7) {
      kit.update(d);
      // The slices on show must cover every metre from the camera to the fog cut.
      const ranges = kit.root.children.filter((g) => g.visible).map((g) => [g.position.z - SLICE_LEN, g.position.z] as const).sort((x, y) => y[1] - x[1]);
      let reach = Math.min(0, CAMERA_Z);   // the ground nearer than the first metres in front of the runner is out of sight
      for (const [lo, hi] of ranges) { if (hi >= reach - 1e-9 && lo < reach) reach = lo; }
      expect(CAMERA_Z - reach, `distance ${d}`).toBeGreaterThanOrEqual(cut - 1e-6);
    }
    tracker.release();
  });

  it('hides slices behind the camera and slices beyond the fog, and nothing else', () => {
    const { kit, tracker } = make();
    for (const d of [0, 17, 63.5, 410, 1999]) {
      kit.update(d);
      for (const g of kit.root.children) {
        const zMax = g.position.z, zMin = zMax - SLICE_LEN;
        const nearest = zMax <= CAMERA_Z ? CAMERA_Z - zMax : 0;
        const behind = zMin > CAMERA_Z;
        expect(g.visible, `d ${d} slice ${g.name}`).toBe(!behind && nearest < kit.cut);
      }
    }
    tracker.release();
  });

  it('recycling rewrites matrices only: geometries, materials and textures stay the same count', () => {
    const { kit, tracker } = make();
    const before = tracker.counts();
    for (let d = 0; d < 3000; d += 1.3) kit.update(d);
    expect(tracker.counts()).toEqual(before);
    tracker.release();
  });

  it('owns three materials, one geometry per prop shape (shared by every slice), no textures, and frees all of it', () => {
    const { tracker } = make();
    const c = tracker.counts();
    expect(c.materials).toBe(3);
    expect(c.textures).toBe(0);
    const shapes = theme.props.reduce((n, p) => n + (p.kind === 'building' ? 6 : p.kind === 'lamp' ? 2 : 1), 0);
    expect(c.geometries).toBe(shapes);
    tracker.release();
    expect(tracker.empty).toBe(true);
  });

  it('a new run in the same world starts from the same course', () => {
    const { kit, tracker } = make(3);
    const start = matricesOf(kit.root);
    for (let d = 0; d < 800; d += 2) kit.update(d);
    kit.reset();
    expect(matricesOf(kit.root)).toEqual(start);
    expect(kit.distance).toBe(0);
    tracker.release();
  });
});

describe('quality tiers', () => {
  it('T0 and T1 draw props with Lambert, T2 with Standard; the swap leaves the same three materials', () => {
    const tracker = new ResourceTracker();
    const kit = createScenery(byId('forest'), tracker, { tier: T0 });
    const kinds = (): Set<string> => new Set(kit.root.children.flatMap((s) => s.children.map((m) => ((m as THREE.Mesh).material as THREE.Material).type)));
    expect(kinds()).toEqual(new Set(['MeshLambertMaterial']));
    kit.applyTier(T2);
    expect(kinds()).toEqual(new Set(['MeshStandardMaterial']));
    expect(tracker.counts().materials).toBe(3);
    kit.applyTier(T1);
    expect(kinds()).toEqual(new Set(['MeshLambertMaterial']));
    expect(tracker.counts().materials).toBe(3);
    tracker.release();
    expect(tracker.empty).toBe(true);
  });

  it('lit windows and lamp heads are never lit by the scene (Basic material), at every tier', () => {
    const tracker = new ResourceTracker();
    const kit = createScenery(byId('city'), tracker, { tier: T2 });
    const meshes = kit.root.children.flatMap((s) => s.children) as THREE.Mesh[];
    const names = new Set(meshes.filter((m) => (m.material as THREE.Material).type === 'MeshBasicMaterial').map((m) => m.name.replace(/-\d+$/, '')));
    expect(names).toEqual(new Set(['windows', 'lampHead']));
    tracker.release();
  });

  it('only trees cast shadows, and only at the top tier', () => {
    const tracker = new ResourceTracker();
    const kit = createScenery(byId('forest'), tracker, { tier: T2 });
    const casters = (): string[] => [...new Set((kit.root.children.flatMap((s) => s.children) as THREE.Mesh[]).filter((m) => m.castShadow).map((m) => m.name))];
    expect(casters()).toEqual(['tree']);
    kit.applyTier(T1);
    expect(casters()).toEqual([]);
    kit.applyTier(T2);
    expect(casters()).toEqual(['tree']);
    tracker.release();
  });

  it('T0 and T1 thin the grass tufts to half, and the thinned tufts are a subset of the full set', () => {
    const tracker = new ResourceTracker();
    const kit = createScenery(byId('forest'), tracker, { tier: T2 });
    const tufts = (): string[] => {
      const out: string[] = [];
      const m = new THREE.Matrix4(), p = new THREE.Vector3();
      kit.root.children.forEach((slice, si) => slice.children.forEach((mesh) => {
        if (mesh.name !== 'tuft') return;
        const im = mesh as THREE.InstancedMesh;
        for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); p.setFromMatrixPosition(m); out.push(`${si}:${p.x.toFixed(4)}:${p.z.toFixed(4)}`); }
      }));
      return out;
    };
    const full = tufts();
    kit.applyTier(T0);
    const half = tufts();
    expect(half.length).toBeGreaterThan(full.length * 0.4);
    expect(half.length).toBeLessThan(full.length * 0.6);
    const set = new Set(full);
    for (const t of half) expect(set.has(t)).toBe(true);
    kit.applyTier(T2);
    expect(tufts()).toEqual(full);
    tracker.release();
  });
});

describe('triangles', () => {
  it('fog culling draws no more triangles than the whole ring would', () => {
    for (const w of worlds) {
      const tracker = new ResourceTracker();
      const kit = createScenery(w, tracker, { tier: T2 });
      kit.update(123);
      const shown = kit.stats().triangles;
      let all = 0;
      kit.root.children.forEach((s) => s.children.forEach((m) => { const im = m as THREE.InstancedMesh; all += im.count * (im.geometry.attributes['position']!.count / 3); }));
      expect(shown).toBeLessThanOrEqual(all);
      tracker.release();
    }
  });
});
