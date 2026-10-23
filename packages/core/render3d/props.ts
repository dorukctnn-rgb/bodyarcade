// Procedural scenery props: one merged, vertex-coloured geometry per kind (split from site/game/engine.js:49-186).
// No asset downloads; each prop is a few dozen to a few hundred triangles and is instanced wherever it repeats.
// Every random value comes from the seeded stream that is passed in, so the same theme and seed give the same
// geometry byte for byte (the old code used Math.random in colorize, rock and lava).
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';
import { between, colorize, merge, place } from './geometry.ts';
import type { PropKind } from './theme.ts';

/** Props that exist only as the second half of another (a lamp's head glows, a building's windows). */
export type ExtraPropKind = 'lampHead' | 'windows';
export type PropBuildKind = PropKind | ExtraPropKind;

export interface PropOptions {
  /** Colour override from the theme (pine needles, rock, grass), or null for the prop's own colours. */
  tint: string | null;
  /** Pines: snow on the top. */
  snow: boolean;
  /** Buildings: which of the three heights. */
  variant: number;
}

type Builder = (o: PropOptions, rng: Rng) => THREE.BufferGeometry;

const TAU = Math.PI * 2;

const BUILDERS: Record<PropBuildKind, Builder> = {
  pine(o, rng) {
    const trunk = colorize(place(new THREE.CylinderGeometry(0.12, 0.22, 2.2, 6), 0, 1.1, 0), '#4a3524', 0.1, rng);
    const tint = o.tint || '#2f5a3a';
    const t1 = colorize(place(new THREE.ConeGeometry(1.5, 2.4, 7), 0, 2.6, 0), tint, 0.12, rng);
    const t2 = colorize(place(new THREE.ConeGeometry(1.15, 2.0, 7), 0, 4.0, 0, 0, 0.4), tint, 0.12, rng);
    const t3 = colorize(place(new THREE.ConeGeometry(0.75, 1.6, 7), 0, 5.2, 0, 0, 0.8), tint, 0.12, rng);
    const parts = [trunk, t1, t2, t3];
    if (o.snow) parts.push(colorize(place(new THREE.ConeGeometry(0.78, 0.5, 7), 0, 5.75, 0, 0, 0.8), '#eef5fa', 0.03, rng));
    return merge(parts);
  },
  tree(_o, rng) {
    const trunk = colorize(place(new THREE.CylinderGeometry(0.18, 0.3, 4.2, 7), 0, 2.1, 0), '#4b3a2a', 0.1, rng);
    const c1 = colorize(place(new THREE.IcosahedronGeometry(1.7, 1), 0, 4.8, 0), '#3f7a3c', 0.14, rng);
    const c2 = colorize(place(new THREE.IcosahedronGeometry(1.3, 1), 0.9, 4.1, 0.4), '#4f8a44', 0.14, rng);
    const c3 = colorize(place(new THREE.IcosahedronGeometry(1.2, 1), -0.8, 4.3, -0.3), '#366f36', 0.14, rng);
    return merge([trunk, c1, c2, c3]);
  },
  jungletree(_o, rng) {
    const trunk = colorize(place(new THREE.CylinderGeometry(0.22, 0.4, 7, 7), 0, 3.5, 0), '#5a4634', 0.1, rng);
    const parts = [trunk];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      parts.push(colorize(place(new THREE.ConeGeometry(0.55, 3.2, 4), Math.cos(a) * 1.5, 6.4, Math.sin(a) * 1.5, Math.PI / 2 - 0.5, -a + Math.PI / 2, 0), '#4c9a4a', 0.16, rng));
    }
    parts.push(colorize(place(new THREE.IcosahedronGeometry(1.4, 1), 0, 7.2, 0), '#3f8a3e', 0.14, rng));
    return merge(parts);
  },
  bush(_o, rng) {
    return merge([
      colorize(place(new THREE.IcosahedronGeometry(0.8, 1), 0, 0.6, 0), '#4b7d3a', 0.15, rng),
      colorize(place(new THREE.IcosahedronGeometry(0.6, 1), 0.6, 0.45, 0.2), '#5a8c44', 0.15, rng),
    ]);
  },
  fern(_o, rng) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      parts.push(colorize(place(new THREE.ConeGeometry(0.28, 1.6, 3), Math.cos(a) * 0.5, 0.75, Math.sin(a) * 0.5, Math.PI / 2 - 0.9, -a + Math.PI / 2, 0), '#5ab35a', 0.18, rng));
    }
    return merge(parts);
  },
  rock(o, rng) {
    return colorize(place(new THREE.DodecahedronGeometry(1, 0), 0, 0.6, 0, between(rng, 0, 3), between(rng, 0, 3), between(rng, 0, 3)), o.tint || '#6b655c', 0.2, rng);
  },
  ice(_o, rng) {
    return merge([
      colorize(place(new THREE.DodecahedronGeometry(1, 0), 0, 0.7, 0, 0.3, 0.6, 0.2), '#bfe3f2', 0.1, rng),
      colorize(place(new THREE.DodecahedronGeometry(0.6, 0), 0.9, 0.35, 0.3, 0.8, 0.2, 0.5), '#d9f0f8', 0.1, rng),
    ]);
  },
  cactus(_o, rng) {
    const body = colorize(place(new THREE.CylinderGeometry(0.28, 0.34, 3.0, 8), 0, 1.5, 0), '#4f8a3e', 0.12, rng);
    const a1 = colorize(place(new THREE.CylinderGeometry(0.16, 0.18, 1.2, 7), 0.5, 1.9, 0, 0, 0, -0.2), '#55934a', 0.12, rng);
    const a2 = colorize(place(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 7), -0.5, 1.5, 0, 0, 0, 0.25), '#55934a', 0.12, rng);
    const j1 = colorize(place(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 7), 0.32, 1.35, 0, 0, 0, Math.PI / 2), '#4f8a3e', 0.12, rng);
    return merge([body, a1, a2, j1]);
  },
  dune(_o, rng) {
    const g = new THREE.SphereGeometry(3, 10, 6);
    g.scale(1.6, 0.42, 1);
    return colorize(g, '#d7a35e', 0.08, rng);
  },
  palm(_o, rng) {
    const parts: THREE.BufferGeometry[] = [];
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const y = i * 0.9 + 0.45, x = Math.pow(i / segs, 1.6) * 0.9;
      parts.push(colorize(place(new THREE.CylinderGeometry(0.13 - i * 0.008, 0.16 - i * 0.008, 0.95, 6), x, y, 0, 0, 0, -0.15 - i * 0.03), '#6b5134', 0.1, rng));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const g = new THREE.ConeGeometry(0.35, 2.4, 3);
      parts.push(colorize(place(g, 1.05 + Math.cos(a) * 1.0, 5.55 - Math.abs(Math.sin(a)) * 0.2, Math.sin(a) * 1.0, Math.PI / 2 + 0.55, -a + Math.PI / 2, 0), '#3f8a46', 0.16, rng));
    }
    return merge(parts);
  },
  lamp(_o, rng) {
    const pole = colorize(place(new THREE.CylinderGeometry(0.06, 0.09, 4.6, 7), 0, 2.3, 0), '#2a2b30', 0.05, rng);
    const arm = colorize(place(new THREE.BoxGeometry(1.0, 0.07, 0.07), -0.5, 4.55, 0), '#2a2b30', 0.05, rng);
    return merge([pole, arm]);
  },
  lampHead(_o, rng) {
    return colorize(place(new THREE.BoxGeometry(0.5, 0.14, 0.26), -0.95, 4.5, 0), '#ffe3a3', 0, rng);
  },
  building(o, rng) {
    const h = 7 + o.variant * 5;
    const body = colorize(place(new THREE.BoxGeometry(4, h, 4), 0, h / 2, 0), '#2b2f44', 0.08, rng);
    const roof = colorize(place(new THREE.BoxGeometry(1.4, 0.8, 1.2), 0.8, h + 0.4, -0.6), '#1f2236', 0.05, rng);
    return merge([body, roof]);
  },
  windows(o, rng) {
    const h = 7 + o.variant * 5;
    const parts: THREE.BufferGeometry[] = [];
    for (let f = 0; f < Math.floor(h / 1.6); f++) for (let c = 0; c < 3; c++) {
      if ((f * 7 + c * 3 + o.variant) % 5 < 2) continue;
      for (const side of [0, 1]) {
        const g = new THREE.PlaneGeometry(0.55, 0.7);
        if (side === 0) place(g, -1.1 + c * 1.1, 1.1 + f * 1.6, 2.01); else place(g, -2.01, 1.1 + f * 1.6, -1.1 + c * 1.1, 0, -Math.PI / 2, 0);
        parts.push(colorize(g, c % 2 ? '#ffd58a' : '#ffecc0', 0.1, rng));
      }
    }
    return merge(parts);
  },
  tuft(o, rng) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      parts.push(colorize(place(new THREE.ConeGeometry(0.06, 0.45, 3), Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35), o.tint || '#6f9a44', 0.25, rng));
    }
    return merge(parts);
  },
  post(_o, rng) { return colorize(place(new THREE.BoxGeometry(0.14, 1.0, 0.14), 0, 0.5, 0), '#8c8378', 0.08, rng); },
  rail(_o, rng) { return colorize(place(new THREE.BoxGeometry(0.08, 0.08, 3.0), 0, 0.95, 0), '#9a9186', 0.05, rng); },
  buoy(_o, rng) {
    return merge([
      colorize(place(new THREE.SphereGeometry(0.6, 10, 8), 0, 0.3, 0), '#ff4f24', 0.05, rng),
      colorize(place(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), 0, 1.2, 0), '#f3eee5', 0.05, rng),
    ]);
  },
  lava(_o, rng) {
    const g = new THREE.PlaneGeometry(3, 1.2, 4, 2);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + (rng() - 0.5) * 0.6);
    return colorize(place(g, 0, 0.02, 0), '#ff7a2a', 0.2, rng);
  },
};

/** How a prop kind is drawn: which material family and whether it may cast a shadow at the top quality tier. */
export interface PropStyle {
  /** 'lit' uses the tier's prop material (Lambert or Standard); 'unlit' is MeshBasic (lava glow, lit windows). */
  material: 'lit' | 'unlit' | 'ice';
  /** Trees and tall props cast shadows at T2 ("actors + nearby trees"); small ones never do. */
  shadow: 'tree' | 'never';
}

const STYLE: Record<PropBuildKind, PropStyle> = {
  pine: { material: 'lit', shadow: 'tree' },
  tree: { material: 'lit', shadow: 'tree' },
  jungletree: { material: 'lit', shadow: 'tree' },
  bush: { material: 'lit', shadow: 'never' },
  fern: { material: 'lit', shadow: 'never' },
  rock: { material: 'lit', shadow: 'never' },
  ice: { material: 'ice', shadow: 'never' },
  cactus: { material: 'lit', shadow: 'tree' },
  dune: { material: 'lit', shadow: 'never' },
  palm: { material: 'lit', shadow: 'tree' },
  lamp: { material: 'lit', shadow: 'tree' },
  lampHead: { material: 'unlit', shadow: 'never' },
  building: { material: 'lit', shadow: 'tree' },
  windows: { material: 'unlit', shadow: 'never' },
  tuft: { material: 'lit', shadow: 'never' },
  post: { material: 'lit', shadow: 'never' },
  rail: { material: 'lit', shadow: 'never' },
  buoy: { material: 'lit', shadow: 'never' },
  lava: { material: 'unlit', shadow: 'never' },
};

export function propStyle(kind: PropBuildKind): PropStyle { return STYLE[kind]; }

/** Builds the geometry of one prop kind. */
export function buildProp(kind: PropBuildKind, o: Partial<PropOptions>, rng: Rng): THREE.BufferGeometry {
  return BUILDERS[kind]({ tint: o.tint ?? null, snow: o.snow ?? false, variant: o.variant ?? 0 }, rng);
}

/** The extra geometry that rides along with a kind and shares its instance positions, if any. */
export function extraKind(kind: PropKind): ExtraPropKind | null {
  return kind === 'lamp' ? 'lampHead' : kind === 'building' ? 'windows' : null;
}

/** Number of height variants of a kind. */
export function variantsOf(kind: PropKind): number {
  return kind === 'building' ? 3 : 1;
}
