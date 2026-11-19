// The body line over the athlete in the home page hero ("live skeleton"): the data our pose model read from the hero clip
// (tools/hero-pose: extract.ts runs the model, compact.ts writes hero-pose/*.json), and the pure maths the page draws it with:
// the pose at any moment of the clip, where the clip's picture sits in its box (object-fit: cover) and which score pops show.
// No DOM here, so the tests run it as it is; app/hero-live.ts draws.

/** The points of the body line, in the order of the file; `mp` is the MediaPipe landmark number. */
export const HERO_POINTS = [
  { name: 'nose', mp: 0 }, { name: 'earL', mp: 7 }, { name: 'earR', mp: 8 },
  { name: 'shoulderL', mp: 11 }, { name: 'shoulderR', mp: 12 }, { name: 'elbowL', mp: 13 }, { name: 'elbowR', mp: 14 },
  { name: 'wristL', mp: 15 }, { name: 'wristR', mp: 16 }, { name: 'hipL', mp: 23 }, { name: 'hipR', mp: 24 },
  { name: 'kneeL', mp: 25 }, { name: 'kneeR', mp: 26 }, { name: 'ankleL', mp: 27 }, { name: 'ankleR', mp: 28 },
  { name: 'heelL', mp: 29 }, { name: 'heelR', mp: 30 }, { name: 'toeL', mp: 31 }, { name: 'toeR', mp: 32 },
] as const;
export type HeroPointName = (typeof HERO_POINTS)[number]['name'];
const IX = Object.fromEntries(HERO_POINTS.map((p, i) => [p.name, i])) as Record<HeroPointName, number>;
export const heroPoint = (name: HeroPointName): number => IX[name];

/** The lines of the body line, between two points each. */
export const HERO_BONES: readonly (readonly [HeroPointName, HeroPointName])[] = [
  ['shoulderL', 'shoulderR'], ['hipL', 'hipR'], ['shoulderL', 'hipL'], ['shoulderR', 'hipR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
  ['ankleL', 'heelL'], ['heelL', 'toeL'], ['ankleL', 'toeL'], ['ankleR', 'heelR'], ['heelR', 'toeR'], ['ankleR', 'toeR'],
];
/** The joints drawn as dots. */
export const HERO_JOINTS: readonly HeroPointName[] = ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];

export type HeroPopKind = 'pts' | 'combo' | 'perfect';
/** A score pop: seconds into the clip, its kind, its number (points or combo count) and the point it rises from. */
export type HeroPop = [number, HeroPopKind, number, number];

export interface HeroPose {
  v: 1;
  /** Frames a second of `f`. */
  fps: number;
  /** Frames. */
  n: number;
  /** Width over height of the clip's picture. */
  aspect: number;
  /** n frames of HERO_POINTS.length points, x then y, in thousandths of the picture's width and height. */
  f: number[];
  pops: HeroPop[];
}

const PER = HERO_POINTS.length * 2;

/** A loose check of a fetched file, so a bad one draws nothing rather than lines across the picture. */
export function isHeroPose(v: unknown): v is HeroPose {
  const p = v as HeroPose;
  return !!p && p.v === 1 && typeof p.fps === 'number' && p.fps > 0 && Number.isInteger(p.n) && p.n > 1 && Array.isArray(p.f) && p.f.length === p.n * PER && Array.isArray(p.pops);
}

/** How long the data lasts, in seconds. */
export const heroDuration = (p: HeroPose): number => (p.n - 1) / p.fps;

/**
 * The points at `t` seconds, as fractions of the picture (x, y pairs). Between two frames the points follow a Catmull-Rom curve
 * through the frames around them, so 15 frames a second follow a fast arm without corners. Outside the data the end frames hold.
 */
export function poseAt(p: HeroPose, t: number, into = new Float32Array(PER)): Float32Array {
  const pos = Math.max(0, Math.min(p.n - 1, t * p.fps));
  const i1 = Math.floor(pos);
  const u = pos - i1;
  const i0 = Math.max(0, i1 - 1), i2 = Math.min(p.n - 1, i1 + 1), i3 = Math.min(p.n - 1, i1 + 2);
  const u2 = u * u, u3 = u2 * u;
  for (let k = 0; k < PER; k += 1) {
    const a = p.f[i0 * PER + k]! / 1000, b = p.f[i1 * PER + k]! / 1000, c = p.f[i2 * PER + k]! / 1000, d = p.f[i3 * PER + k]! / 1000;
    into[k] = 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  }
  return into;
}

/** Where a picture of w x h sits in a box of bw x bh with object-fit: cover and an object-position of px, py (0 to 1). */
export function coverBox(bw: number, bh: number, w: number, h: number, px = 0.5, py = 0.5): { x: number; y: number; w: number; h: number } {
  const s = Math.max(bw / w, bh / h);
  const sw = w * s, sh = h * s;
  return { x: (bw - sw) * px, y: (bh - sh) * py, w: sw, h: sh };
}

/** Reads a computed object-position ("70% 50%", "right center", "50% 20px" on a box) into fractions; anything else is the middle. */
export function objectPosition(value: string): [number, number] {
  const words = value.trim().split(/\s+/);
  const one = (w: string | undefined): number => {
    if (!w) return 0.5;
    if (w.endsWith('%')) return Math.max(0, Math.min(1, Number.parseFloat(w) / 100));
    if (w === 'left' || w === 'top') return 0;
    if (w === 'right' || w === 'bottom') return 1;
    return 0.5;
  };
  return [one(words[0]), one(words[1])];
}

/** How long a pop stays, in seconds. */
export const POP_LIFE = 1.1;

/** The pops on the screen at `t`, with their age from 0 (just in) to 1 (gone). */
export function popsAt(p: HeroPose, t: number): { pop: HeroPop; age: number }[] {
  return p.pops.filter(([at]) => t >= at && t < at + POP_LIFE).map((pop) => ({ pop, age: (t - pop[0]) / POP_LIFE }));
}

/** The running score of the round at `t`: the points of the pops so far (a combo doubles or triples the 50 before it, a perfect is 150). */
export function scoreAt(p: HeroPose, t: number): number {
  let score = 0;
  for (const [at, kind, n] of p.pops) {
    if (at > t) break;
    score += kind === 'pts' ? n : kind === 'combo' ? 50 * n : 150;
  }
  return score;
}
