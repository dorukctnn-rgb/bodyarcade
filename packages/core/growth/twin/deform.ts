// Shapes the body twin from the person's own tape measures (SPEC: no measure from photos; the twin is only what the person
// typed). The whole body is scaled to their height; then each band's section is scaled about its own centre so its
// circumference (the convex hull a tape follows) equals the typed value, and the scale blends smoothly between bands:
//   torso:  hips -> waist -> chest along the height, easing to half the chest's change at the shoulders;
//   neck:   between the torso's top, the neck band and the head (unchanged);
//   limbs:  about the limb's own axis (hip-knee, knee-ankle, shoulder-elbow, elbow-wrist), easing toward the next joint;
//   legs and arms move outward with the hips and the chest, so wider hips do not swallow the thighs.
// Vertices on a seam use the two region weights of the rig. Missing values keep the base shape (one side's limb value is
// used for the other side when only one was typed).
import { TAPE_PARTS, TWIN_REGIONS, type Band, type JointName, type LimbBand, type Tape, type TapePart, type TorsoBand, type TwinModel, type TwinRegion } from './model.ts';

const RI = Object.fromEntries(TWIN_REGIONS.map((r, i) => [r, i])) as Record<TwinRegion, number>;
const K_MIN = 0.6, K_MAX = 1.9;

type V3 = [number, number, number];

/** Per-model facts the deformation needs, computed once. */
export interface TwinPrep {
  model: TwinModel;
  bands: Record<TapePart, Band>;
  /** z centre of the torso (with thigh tops) and neck sections, per 1 cm bin */
  torsoZ: Float32Array;
  neckZ: Float32Array;
  /** per vertex, for its limb regions: axis parameter t and closest axis point (base) */
  limbT: Float32Array;
  limbC: Float32Array;
  limbTB: Float32Array;
  limbCB: Float32Array;
}

const LIMBS: Partial<Record<TwinRegion, [JointName, JointName]>> = {
  thighL: ['hipL', 'kneeL'], thighR: ['hipR', 'kneeR'], calfL: ['kneeL', 'ankleL'], calfR: ['kneeR', 'ankleR'],
  upperArmL: ['shoulderL', 'elbowL'], upperArmR: ['shoulderR', 'elbowR'], forearmL: ['elbowL', 'wristL'], forearmR: ['elbowR', 'wristR'],
};

const binOf = (y: number): number => Math.max(0, Math.min(299, Math.floor(y * 100)));

export function prepare(model: TwinModel): TwinPrep {
  const n = model.header.vertexCount, P = model.positions;
  const bands = Object.fromEntries(model.header.bands.map((b) => [b.part, b])) as Record<TapePart, Band>;
  const zCentre = (pick: (i: number) => boolean): Float32Array => {
    const lo = new Float32Array(300).fill(Infinity), hi = new Float32Array(300).fill(-Infinity);
    for (let i = 0; i < n; i++) if (pick(i)) { const b = binOf(P[i * 3 + 1]!), z = P[i * 3 + 2]!; if (z < lo[b]!) lo[b] = z; if (z > hi[b]!) hi[b] = z; }
    const out = new Float32Array(300);
    let last = 0;
    for (let b = 0; b < 300; b++) { if (lo[b]! <= hi[b]!) last = (lo[b]! + hi[b]!) / 2; out[b] = last; }
    return out;
  };
  const w = (i: number, r: TwinRegion): number => (model.regA[i] === RI[r] ? model.wA[i]! : 0) + (model.regB[i] === RI[r] ? 1 - model.wA[i]! : 0);
  const torsoZ = zCentre((i) => w(i, 'torso') + w(i, 'thighL') + w(i, 'thighR') > 0.6);
  const neckZ = zCentre((i) => w(i, 'neck') > 0.5);
  const J = model.header.joints;
  const limbT = new Float32Array(n), limbC = new Float32Array(n * 3), limbTB = new Float32Array(n), limbCB = new Float32Array(n * 3);
  const axisPoint = (i: number, r: number, outT: Float32Array, outC: Float32Array): void => {
    const pair = LIMBS[TWIN_REGIONS[r]!];
    if (!pair) return;
    const a = J[pair[0]], b = J[pair[1]];
    const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
    const l2 = ax * ax + ay * ay + az * az;
    const t = ((P[i * 3]! - a[0]) * ax + (P[i * 3 + 1]! - a[1]) * ay + (P[i * 3 + 2]! - a[2]) * az) / l2;
    outT[i] = t;
    outC[i * 3] = a[0] + ax * t; outC[i * 3 + 1] = a[1] + ay * t; outC[i * 3 + 2] = a[2] + az * t;
  };
  for (let i = 0; i < n; i++) { axisPoint(i, model.regA[i]!, limbT, limbC); axisPoint(i, model.regB[i]!, limbTB, limbCB); }
  return { model, bands, torsoZ, neckZ, limbT, limbC, limbTB, limbCB };
}

/** The scale of each band against the base mesh at the person's height (1 = the base shape). */
export function bandScales(prep: TwinPrep, heightCm: number, tape: Tape): Record<TapePart, number> {
  const s = heightCm / 100 / prep.model.header.heightM;
  const val = (p: TapePart): number | undefined => {
    const v = tape[p];
    if (typeof v === 'number' && v > 0) return v;
    const other = p.endsWith('L') ? (p.slice(0, -1) + 'R') as TapePart : p.endsWith('R') ? (p.slice(0, -1) + 'L') as TapePart : null;
    const o = other ? tape[other] : undefined;
    return typeof o === 'number' && o > 0 ? o : undefined;
  };
  const out = {} as Record<TapePart, number>;
  for (const p of TAPE_PARTS) {
    const v = val(p);
    out[p] = v === undefined ? 1 : Math.max(K_MIN, Math.min(K_MAX, v / (prep.bands[p].cm * s)));
  }
  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t));
const smooth = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

export interface Shaped {
  positions: Float32Array;
  /** per-vertex local scale against the base (for the heat map: the ratio of two shapes) */
  scale: Float32Array;
  k: Record<TapePart, number>;
  heightScale: number;
}

export function shapeTwin(prep: TwinPrep, heightCm: number, tape: Tape, out?: Shaped): Shaped {
  const m = prep.model, n = m.header.vertexCount, P = m.positions, J = m.header.joints;
  const k = bandScales(prep, heightCm, tape);
  const s = heightCm / 100 / m.header.heightM;
  const B = prep.bands as unknown as Record<'hips' | 'waist' | 'chest' | 'neck', TorsoBand> & Record<'thighL', LimbBand>;
  const hipsY = B.hips.y, waistY = B.waist.y, chestY = B.chest.y, neckY = B.neck.y;
  const topY = J.neckLow[1], headY = J.neckHigh[1];
  // the hips' tape goes round the buttocks and the thigh tops: thigh vertices blend into the torso's scaling from the
  // thigh tape's height (below: the thigh's own scaling) up to the hips' tape (above: the torso's)
  const thighTapeY = J.hipL[1] - B.thighL.t * (J.hipL[1] - J.kneeL[1]);
  const kTop = 1 + (k.chest - 1) * 0.5;
  const torsoK = (y: number): number =>
    y <= hipsY ? k.hips : y <= waistY ? lerp(k.hips, k.waist, (y - hipsY) / (waistY - hipsY)) : y <= chestY ? lerp(k.waist, k.chest, (y - waistY) / (chestY - waistY)) : lerp(k.chest, kTop, (y - chestY) / Math.max(1e-3, topY - chestY));
  const neckK = (y: number): number => (y <= neckY ? lerp(kTop, k.neck, (y - topY) / Math.max(1e-3, neckY - topY)) : lerp(k.neck, 1, (y - neckY) / Math.max(1e-3, headY - neckY)));
  const mid = (a: number, b: number): number => (a + b) / 2;
  const limbK = (r: TwinRegion, t: number): number => {
    switch (r) {
      case 'thighL': return t <= 0.6 ? k.thighL : lerp(k.thighL, mid(k.thighL, k.calfL), (t - 0.6) / 0.4);
      case 'thighR': return t <= 0.6 ? k.thighR : lerp(k.thighR, mid(k.thighR, k.calfR), (t - 0.6) / 0.4);
      case 'calfL': return t <= 0.15 ? lerp(mid(k.thighL, k.calfL), k.calfL, t / 0.15) : t <= 0.6 ? k.calfL : lerp(k.calfL, 1 + (k.calfL - 1) * 0.35, (t - 0.6) / 0.4);
      case 'calfR': return t <= 0.15 ? lerp(mid(k.thighR, k.calfR), k.calfR, t / 0.15) : t <= 0.6 ? k.calfR : lerp(k.calfR, 1 + (k.calfR - 1) * 0.35, (t - 0.6) / 0.4);
      case 'upperArmL': return t <= 0.8 ? k.upperArmL : lerp(k.upperArmL, 1 + (k.upperArmL - 1) * 0.6, (t - 0.8) / 0.2);
      case 'upperArmR': return t <= 0.8 ? k.upperArmR : lerp(k.upperArmR, 1 + (k.upperArmR - 1) * 0.6, (t - 0.8) / 0.2);
      case 'forearmL': return lerp(1 + (k.upperArmL - 1) * 0.6, 1 + (k.upperArmL - 1) * 0.25, t);
      case 'forearmR': return lerp(1 + (k.upperArmR - 1) * 0.6, 1 + (k.upperArmR - 1) * 0.25, t);
      default: return 1;
    }
  };
  // whole legs and arms move out with the hips and the chest
  const legDx = { L: J.hipL[0] * (k.hips - 1) * 0.6, R: J.hipR[0] * (k.hips - 1) * 0.6 };
  const armDx = { L: J.shoulderL[0] * (k.chest - 1) * 0.7, R: J.shoulderR[0] * (k.chest - 1) * 0.7 };
  const follow = (r: TwinRegion): number => {
    if (r === 'thighL' || r === 'calfL' || r === 'footL') return legDx.L;
    if (r === 'thighR' || r === 'calfR' || r === 'footR') return legDx.R;
    if (r === 'upperArmL' || r === 'forearmL' || r === 'handL') return armDx.L;
    if (r === 'upperArmR' || r === 'forearmR' || r === 'handR') return armDx.R;
    return 0;
  };
  const res: Shaped = out ?? { positions: new Float32Array(n * 3), scale: new Float32Array(n), k, heightScale: s };
  res.k = k; res.heightScale = s;
  const tmp: V3 = [0, 0, 0];
  const place = (i: number, r: number, second: boolean): number => {
    const x = P[i * 3]!, y = P[i * 3 + 1]!, z = P[i * 3 + 2]!;
    const reg = TWIN_REGIONS[r]!;
    let kk = 1;
    if (reg === 'torso') {
      // the torso's part of the neck (above the neck's base) follows the neck tape
      kk = y > topY ? neckK(y) : torsoK(y);
      const cz = prep.torsoZ[binOf(y)]!;
      tmp[0] = x * kk; tmp[1] = y; tmp[2] = cz + (z - cz) * kk;
    } else if (reg === 'neck' || (reg === 'head' && y < headY)) {
      // the underside of the jaw belongs to the neck's section too
      kk = neckK(y);
      const cz = prep.neckZ[binOf(y)]!;
      tmp[0] = x * kk; tmp[1] = y; tmp[2] = cz + (z - cz) * kk;
    } else if (LIMBS[reg]) {
      const t = second ? prep.limbTB[i]! : prep.limbT[i]!;
      const C = second ? prep.limbCB : prep.limbC;
      kk = limbK(reg, t);
      const cx = C[i * 3]!, cy = C[i * 3 + 1]!, cz = C[i * 3 + 2]!;
      let px = cx + (x - cx) * kk + follow(reg), py = cy + (y - cy) * kk, pz = cz + (z - cz) * kk;
      if ((reg === 'thighL' || reg === 'thighR') && y > thighTapeY) {
        const b = smooth((y - thighTapeY) / Math.max(1e-3, hipsY - thighTapeY));
        const tk = torsoK(y), tz = prep.torsoZ[binOf(y)]!;
        px = lerp(px, x * tk, b); py = lerp(py, y, b); pz = lerp(pz, tz + (z - tz) * tk, b);
        kk = lerp(kk, tk, b);
      }
      tmp[0] = px; tmp[1] = py; tmp[2] = pz;
    } else {
      tmp[0] = x + follow(reg); tmp[1] = y; tmp[2] = z;
    }
    return kk;
  };
  const pos = res.positions;
  for (let i = 0; i < n; i++) {
    const wa = m.wA[i]!;
    const ka = place(i, m.regA[i]!, false);
    const ax = tmp[0], ay = tmp[1], az = tmp[2];
    let kb = ka, bx = ax, by = ay, bz = az;
    if (wa < 0.999) { kb = place(i, m.regB[i]!, true); bx = tmp[0]; by = tmp[1]; bz = tmp[2]; }
    pos[i * 3] = (ax * wa + bx * (1 - wa)) * s;
    pos[i * 3 + 1] = (ay * wa + by * (1 - wa)) * s;
    pos[i * 3 + 2] = (az * wa + bz * (1 - wa)) * s;
    res.scale[i] = ka * wa + kb * (1 - wa);
  }
  return res;
}

/** Heat per vertex between two shapes: + = more than before (a gain), - = less (SPEC 3D twin heat map). */
export function heat(then: Shaped, now: Shaped, out = new Float32Array(now.scale.length)): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = now.scale[i]! / Math.max(1e-6, then.scale[i]!) - 1;
  return out;
}

/** Blends two tapes (time-lapse between two sessions; parts missing in one keep the other's value). */
export function blendTape(a: Tape, b: Tape, t: number): Tape {
  const out: Tape = {};
  for (const p of TAPE_PARTS) {
    const va = a[p], vb = b[p];
    if (typeof va === 'number' && typeof vb === 'number') out[p] = va + (vb - va) * t;
    else if (typeof va === 'number' || typeof vb === 'number') out[p] = (va ?? vb)!;
  }
  return out;
}

// ---- measuring a shaped twin (tests and the "your twin matches your tape" check) ----
function hull(pts: [number, number][]): number {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return 0;
  const cr = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let s = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i]!, b = h[(i + 1) % h.length]!; s += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return s;
}

/** The shaped twin's circumference at a band (cm), measured like the build measured the base. */
export function measureShaped(prep: TwinPrep, shaped: Shaped, part: TapePart): number {
  const m = prep.model, n = m.header.vertexCount, P = shaped.positions, s = shaped.heightScale;
  const band = prep.bands[part];
  const w = (i: number, r: TwinRegion): number => (m.regA[i] === RI[r] ? m.wA[i]! : 0) + (m.regB[i] === RI[r] ? 1 - m.wA[i]! : 0);
  const pts: [number, number][] = [];
  if (band.kind === 'torso') {
    const y = band.y * s;
    for (let i = 0; i < n; i++) {
      const inside = part === 'neck' ? w(i, 'neck') + w(i, 'torso') + w(i, 'head') > 0.6 : w(i, 'torso') + w(i, 'thighL') + w(i, 'thighR') > 0.6;
      if (inside && Math.abs(P[i * 3 + 1]! - y) < 0.008 * s) pts.push([P[i * 3]!, P[i * 3 + 2]!]);
    }
  } else {
    // the limb's deformed axis: its two joints moved like their limb, at the band's own t
    const J = m.header.joints;
    const k = shaped.k;
    const side = band.part.endsWith('L') ? 'L' : 'R';
    const dx = band.region.startsWith('upperArm') ? J[`shoulder${side}` as JointName][0] * (k.chest - 1) * 0.7 : J[`hip${side}` as JointName][0] * (k.hips - 1) * 0.6;
    const a = J[band.from], b = J[band.to];
    const A: V3 = [(a[0] + dx) * s, a[1] * s, a[2] * s], Bv: V3 = [(b[0] + dx) * s, b[1] * s, b[2] * s];
    const ax: V3 = [Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]];
    const len = Math.hypot(...ax); const u: V3 = [ax[0] / len, ax[1] / len, ax[2] / len];
    const c: V3 = [A[0] + ax[0] * band.t, A[1] + ax[1] * band.t, A[2] + ax[2] * band.t];
    const h: V3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1r: V3 = [u[1] * h[2] - u[2] * h[1], u[2] * h[0] - u[0] * h[2], u[0] * h[1] - u[1] * h[0]];
    const l1 = Math.hypot(...e1r); const e1: V3 = [e1r[0] / l1, e1r[1] / l1, e1r[2] / l1];
    const e2: V3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    for (let i = 0; i < n; i++) {
      if (w(i, band.region) <= 0.6) continue;
      const d: V3 = [P[i * 3]! - c[0], P[i * 3 + 1]! - c[1], P[i * 3 + 2]! - c[2]];
      if (Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) < 0.008 * s) pts.push([d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2], d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2]]);
    }
  }
  return hull(pts) * 100;
}
