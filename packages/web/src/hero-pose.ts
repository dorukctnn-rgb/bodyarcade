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
  /** 33: every point MediaPipe finds, in its own order (a picture that shows them all); absent: the 19 points of HERO_POINTS. */
  k?: 33;
  /** 'upper': the clip shows the upper body only, and no leg is drawn. */
  parts?: 'upper';
}

/** The points of the legs, left out of the line of a clip that shows the upper body only. */
export const LEG_POINTS: ReadonlySet<HeroPointName> = new Set<HeroPointName>(['kneeL', 'kneeR', 'ankleL', 'ankleR', 'heelL', 'heelR', 'toeL', 'toeR']);

const PER = HERO_POINTS.length * 2;
/** Numbers per frame of a file: two for each of its points. */
export const perFrame = (p: Pick<HeroPose, 'k'>): number => (p.k === 33 ? 66 : PER);
/** Where a point of the body line is in a frame of the file (its place in HERO_POINTS, or its MediaPipe number in a file of all 33). */
export const pointIndex = (p: Pick<HeroPose, 'k'>, name: HeroPointName): number => (p.k === 33 ? HERO_POINTS[IX[name]]!.mp : IX[name]);

/** A loose check of a fetched file, so a bad one draws nothing rather than lines across the picture. */
export function isHeroPose(v: unknown): v is HeroPose {
  const p = v as HeroPose;
  return !!p && p.v === 1 && typeof p.fps === 'number' && p.fps > 0 && Number.isInteger(p.n) && p.n > 1 && (p.k === undefined || p.k === 33) && (p.parts === undefined || p.parts === 'upper') && Array.isArray(p.f) && p.f.length === p.n * perFrame(p) && Array.isArray(p.pops);
}

/** How long the data lasts, in seconds. */
export const heroDuration = (p: HeroPose): number => (p.n - 1) / p.fps;

/**
 * The points at `t` seconds, as fractions of the picture (x, y pairs). Between two frames the points follow a Catmull-Rom curve
 * through the frames around them, so 15 frames a second follow a fast arm without corners. Outside the data the end frames hold.
 */
export function poseAt(p: HeroPose, t: number, into = new Float32Array(perFrame(p))): Float32Array {
  const per = perFrame(p);
  const raw = Math.max(0, Math.min(p.n - 1, t * p.fps));
  // a frame's own time (what requestVideoFrameCallback gives) lands on its pose exactly; only times between frames are interpolated
  const near = Math.round(raw);
  const pos = Math.abs(raw - near) < 0.02 ? near : raw;
  const i1 = Math.floor(pos);
  const u = pos - i1;
  const i0 = Math.max(0, i1 - 1), i2 = Math.min(p.n - 1, i1 + 1), i3 = Math.min(p.n - 1, i1 + 2);
  const u2 = u * u, u3 = u2 * u;
  for (let k = 0; k < per; k += 1) {
    const a = p.f[i0 * per + k]! / 1000, b = p.f[i1 * per + k]! / 1000, c = p.f[i2 * per + k]! / 1000, d = p.f[i3 * per + k]! / 1000;
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

/** A box in canvas pixels: left, top, right, bottom. */
export type Rect = readonly [number, number, number, number];
/** Where a clip's picture sits in a canvas, in its pixels (coverBox). */
export type PictureBox = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * The head of the pose at `t` in the canvas: the square round the head ring (from the nose, the eyes and the ears, so the face whatever
 * way it turns) with the hair, the chin and a margin. A head seen from the side has its ears together: the shoulders and the trunk then
 * give it its size.
 */
export function headBox(p: HeroPose, t: number, box: PictureBox, into = new Float32Array(perFrame(p))): Rect {
  const raw = poseAt(p, t, into);
  const xy = (k: number): [number, number] => [box.x + (raw[k * 2] ?? 0) * box.w, box.y + (raw[k * 2 + 1] ?? 0) * box.h];
  const at = (name: HeroPointName): [number, number] => xy(pointIndex(p, name));
  const [lx, ly] = at('earL'), [rx, ry] = at('earR'), [nx, ny] = at('nose');
  const cx = (lx + rx + nx) / 3, cy = (ly + ry + ny) / 3;
  // the face's own points: the nose and the ears, and in a file of all 33 the eyes and the mouth too (MediaPipe 0 to 10)
  const face: [number, number][] = p.k === 33 ? Array.from({ length: 11 }, (_, k) => xy(k)) : [[nx, ny], [lx, ly], [rx, ry]];
  const far = Math.max(...face.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const [s1x, s1y] = at('shoulderL'), [s2x, s2y] = at('shoulderR'), [h1x, h1y] = at('hipL'), [h2x, h2y] = at('hipR');
  const shoulders = Math.hypot(s1x - s2x, s1y - s2y);
  const trunk = Math.hypot((s1x + s2x - h1x - h2x) / 2, (s1y + s2y - h1y - h2y) / 2);
  const ring = Math.max(Math.hypot(lx - rx, ly - ry) * 0.85, far * 1.15, shoulders * 0.27, trunk * 0.2);
  const m = ring * 1.3;
  return [cx - m, cy - m, cx + m, cy + m];
}

/** Where a pop goes: its middle when it comes in, how far it rises over its life, its size and its words. */
export interface PopPlace { x: number; y: number; rise: number; size: number; text: string }

export interface PopLayout {
  /** The canvas, and where the clip's picture sits in it. */
  w: number;
  h: number;
  box: PictureBox;
  /** The size of a points pop (a combo or a perfect is drawn at 0.8 of it). */
  size: number;
  /** Room kept from the canvas's edges. */
  pad: number;
  /** The width of a text at a size (the display face's metrics). */
  measure: (text: string, size: number) => number;
  /** The words of a pop. */
  text: (pop: HeroPop) => string;
  /** What sits over the picture (a frame of the game, a badge, the bar of the tour): no pop goes under it. */
  avoid?: readonly Rect[];
}

/**
 * Where each pop of the clip goes, or null where none fits: never on the face. A pop keeps its place for its whole life (it rises a
 * little), placed clear of where the head is over that life, of what sits over the picture and of the pops on at the same time, inside
 * the canvas: above the head first (on the side the pops take turns on), then beside it, then above it in the middle or on the other
 * side, then under the chin; and if none fits, the same a size smaller.
 */
export function placePops(p: HeroPose, o: PopLayout): (PopPlace | null)[] {
  const scratch = new Float32Array(perFrame(p));
  const placed: { at: number; r: Rect }[] = [];
  return p.pops.map((pop, i) => {
    const [at, kind] = pop;
    let f: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    // every frame of the pop's life (the points between two frames follow a curve, so a little more than one sample a frame)
    const steps = Math.ceil(POP_LIFE * p.fps * 2);
    for (let k = 0; k <= steps; k += 1) {
      const b = headBox(p, at + (POP_LIFE * k) / steps, o.box, scratch);
      f = [Math.min(f[0], b[0]), Math.min(f[1], b[1]), Math.max(f[2], b[2]), Math.max(f[3], b[3])];
    }
    const blocked: Rect[] = [f, ...(o.avoid ?? []), ...placed.filter((q) => Math.abs(q.at - at) < POP_LIFE).map((q) => q.r)];
    const text = o.text(pop);
    const side = i % 2 === 0 ? 1 : -1;
    for (const shrink of [1, 0.82, 0.68]) {
      const size = o.size * (kind === 'pts' ? 1 : 0.8) * shrink;
      const half = o.measure(text, size) / 2, th = size * 0.9, edge = size * 0.08 + 1;
      const rise = size * 0.6, gap = size * 0.2;
      const fw = f[2] - f[0], fc = (f[0] + f[2]) / 2, fm = (f[1] + f[3]) / 2;
      const inX = (x: number): number => Math.max(o.pad + half + edge, Math.min(o.w - o.pad - half - edge, x));
      const above = f[1] - gap - th / 2 - edge;
      const beside = (s: number): number => (s > 0 ? f[2] + gap + half + edge : f[0] - gap - half - edge);
      const tries: [number, number][] = [
        [inX(fc + side * fw * 0.5), above],
        [beside(side), fm + rise / 2],
        [beside(-side), fm + rise / 2],
        [inX(fc), above],
        [inX(fc - side * fw * 0.5), above],
        [inX(fc + side * fw * 0.5), f[3] + gap + th / 2 + edge + rise],
      ];
      for (const [x, y] of tries) {
        // the room the pop takes over its life: from where it comes in up to where it has risen to
        const r: Rect = [x - half - edge, y - rise - th / 2 - edge, x + half + edge, y + th / 2 + edge];
        if (r[0] < o.pad || r[1] < o.pad || r[2] > o.w - o.pad || r[3] > o.h - o.pad) continue;
        if (blocked.some((b) => overlaps(r, b))) continue;
        placed.push({ at, r });
        return { x, y, rise, size, text };
      }
    }
    return null;
  });
}
