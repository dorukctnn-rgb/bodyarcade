// The Mover: BodyArcade's one character (design/art/index.html "rules for every world"): a ball head in flush, an ink body
// (chalk on night worlds), a sun band on the left wrist and a sky band on the right. No face, no clothes. Drawn from the
// ten limb directions the movement library publishes (the same names and angles as core/moves/poseMatch.ts: degrees in the
// mirrored picture, 0 = screen right, 90 = up, -90 = down), so one drawing serves the player's avatar (from the channels)
// and a wall's target shape (from the pose library).
//
// Everything is measured in torso lengths T (the unit of the rest of the platform): the hip is the origin, the torso is
// 1 T, the shoulders 0.8 T wide, an arm 1.15 T and a leg 1.8 T (core/moves/testing/rig.ts BUILD).
import type { Ctx2D } from '../../core/render2d/ctx.ts';
import { lerp } from './util.ts';

export const LIMB_NAMES = ['armUpperL', 'armUpperR', 'armLowerL', 'armLowerR', 'thighL', 'thighR', 'shinL', 'shinR', 'torso', 'neck'] as const;
export type LimbKey = (typeof LIMB_NAMES)[number];
export type Limbs = Record<LimbKey, number>;

/** Standing easy: arms a little out from the sides, legs under the hips. */
export const STAND: Readonly<Limbs> = {
  armUpperL: -108, armUpperR: -72, armLowerL: -100, armLowerR: -80,
  thighL: -94, thighR: -86, shinL: -92, shinR: -88, torso: 90, neck: 90,
};

/** Arms and legs open, as the top of a jumping jack. */
export const JACK_OPEN: Readonly<Limbs> = {
  armUpperL: 125, armUpperR: 55, armLowerL: 118, armLowerR: 62,
  thighL: -118, thighR: -62, shinL: -112, shinR: -68, torso: 90, neck: 90,
};

export interface MoverStyle {
  body: string;
  head: string;
  /** A thin dark edge so the figure reads on a bright window too; null for none. */
  edge: string | null;
  bandL: string;
  bandR: string;
}

export const MOVER_DAY: MoverStyle = { body: '#1C1433', head: '#FF4F6E', edge: null, bandL: '#FFC53A', bandR: '#46B4FF' };
export const MOVER_NIGHT: MoverStyle = { body: '#F4F2F8', head: '#FF4F6E', edge: 'rgba(20, 15, 39, 0.6)', bandL: '#FFC53A', bandR: '#46B4FF' };

export const BUILD_T = { shoulder: 0.8, hip: 0.5, upperArm: 0.6, foreArm: 0.55, thigh: 0.9, shin: 0.9, neck: 0.42, head: 0.21, limb: 0.17, torso: 0.46 } as const;

export interface FigureDraw {
  /** The hip centre in pixels. */
  x: number;
  y: number;
  /** One torso length in pixels. */
  T: number;
  limbs?: Partial<Limbs>;
  /** Shoulder width over its resting width (the twist narrows it); 1 for none. */
  span?: number;
  alpha?: number;
  /** Stroke widths over the normal ones: 1 for the player's avatar, over 1 for the hole of a wall. */
  fat?: number;
  /** false: no head and no bands (a hole needs only the shape). */
  detail?: boolean;
}

export interface Point { x: number; y: number }

export interface FigureGeometry {
  hip: Point;
  hipL: Point; hipR: Point;
  shoulder: Point; shoulderL: Point; shoulderR: Point;
  elbowL: Point; elbowR: Point; wristL: Point; wristR: Point;
  kneeL: Point; kneeR: Point; ankleL: Point; ankleR: Point;
  head: Point;
}

const RAD = Math.PI / 180;

/** Where every joint is, in pixels. Pure; the drawing and the tests both read it. */
export function figureGeometry(d: FigureDraw): FigureGeometry {
  const L: Limbs = { ...STAND, ...d.limbs };
  const T = d.T;
  const at = (p: Point, deg: number, len: number): Point => ({ x: p.x + Math.cos(deg * RAD) * len, y: p.y - Math.sin(deg * RAD) * len });
  const hip: Point = { x: d.x, y: d.y };
  const shoulder = at(hip, L.torso, T);
  // across the trunk: the player's right is screen right when the trunk is upright
  const right: Point = { x: Math.sin(L.torso * RAD), y: Math.cos(L.torso * RAD) };
  const across = (c: Point, half: number, side: -1 | 1): Point => ({ x: c.x + right.x * half * side, y: c.y + right.y * half * side });
  const span = d.span ?? 1;
  const shoulderL = across(shoulder, (BUILD_T.shoulder / 2) * T * span, -1);
  const shoulderR = across(shoulder, (BUILD_T.shoulder / 2) * T * span, 1);
  const hipL = across(hip, (BUILD_T.hip / 2) * T, -1);
  const hipR = across(hip, (BUILD_T.hip / 2) * T, 1);
  const elbowL = at(shoulderL, L.armUpperL, BUILD_T.upperArm * T);
  const elbowR = at(shoulderR, L.armUpperR, BUILD_T.upperArm * T);
  const wristL = at(elbowL, L.armLowerL, BUILD_T.foreArm * T);
  const wristR = at(elbowR, L.armLowerR, BUILD_T.foreArm * T);
  const kneeL = at(hipL, L.thighL, BUILD_T.thigh * T);
  const kneeR = at(hipR, L.thighR, BUILD_T.thigh * T);
  const ankleL = at(kneeL, L.shinL, BUILD_T.shin * T);
  const ankleR = at(kneeR, L.shinR, BUILD_T.shin * T);
  const head = at(shoulder, L.neck, (BUILD_T.neck - 0.04) * T);
  return { hip, hipL, hipR, shoulder, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, kneeL, kneeR, ankleL, ankleR, head };
}

function line(ctx: Ctx2D, a: Point, b: Point, width: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Draws the figure. Leaves the context's state as it was (save and restore). */
export function drawFigure(ctx: Ctx2D, d: FigureDraw, style: MoverStyle): void {
  const g = figureGeometry(d);
  const T = d.T;
  const fat = d.fat ?? 1;
  const limbW = BUILD_T.limb * T * fat;
  const detail = d.detail ?? true;
  ctx.save();
  ctx.globalAlpha = d.alpha ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pass = (color: string, extra: number): void => {
    // legs, torso, arms: one colour, so the figure is one flat shape
    line(ctx, g.hipL, g.kneeL, limbW + extra, color); line(ctx, g.kneeL, g.ankleL, limbW * 0.92 + extra, color);
    line(ctx, g.hipR, g.kneeR, limbW + extra, color); line(ctx, g.kneeR, g.ankleR, limbW * 0.92 + extra, color);
    ctx.beginPath();
    ctx.moveTo(g.shoulderL.x, g.shoulderL.y); ctx.lineTo(g.shoulderR.x, g.shoulderR.y);
    ctx.lineTo(g.hipR.x, g.hipR.y); ctx.lineTo(g.hipL.x, g.hipL.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = BUILD_T.torso * T * 0.5 * fat + extra;
    ctx.strokeStyle = color;
    ctx.stroke();
    line(ctx, g.shoulderL, g.elbowL, limbW * 0.9 + extra, color); line(ctx, g.elbowL, g.wristL, limbW * 0.8 + extra, color);
    line(ctx, g.shoulderR, g.elbowR, limbW * 0.9 + extra, color); line(ctx, g.elbowR, g.wristR, limbW * 0.8 + extra, color);
  };
  if (style.edge && detail) pass(style.edge, Math.max(1.5, T * 0.05));
  pass(style.body, 0);
  if (detail) {
    // the wrist bands: the last third of the forearm
    const band = (e: Point, w: Point, color: string): void => line(ctx, { x: lerp(e.x, w.x, 0.66), y: lerp(e.y, w.y, 0.66) }, w, limbW * 0.8 + 0.5, color);
    band(g.elbowL, g.wristL, style.bandL);
    band(g.elbowR, g.wristR, style.bandR);
    ctx.beginPath();
    ctx.arc(g.head.x, g.head.y, BUILD_T.head * T, 0, Math.PI * 2);
    ctx.fillStyle = style.head;
    ctx.fill();
  }
  ctx.restore();
}

/** Mixes two sets of limb directions along the short way round each angle (for easing an avatar between poses). */
export function mixLimbs(a: Readonly<Limbs>, b: Readonly<Limbs>, u: number): Limbs {
  const out = {} as Limbs;
  for (const k of LIMB_NAMES) {
    let dlt = (((b[k] - a[k]) % 360) + 540) % 360 - 180;
    if (dlt === -180) dlt = 180;
    out[k] = a[k] + dlt * u;
  }
  return out;
}
