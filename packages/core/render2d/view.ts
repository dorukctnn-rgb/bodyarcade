// Where things are on the screen: the pure geometry of the mirror view (no canvas, no DOM).
//
// Three spaces meet here (types/body.ts has the long version):
// - landmarks are RAW image fractions: x from the left of the unmirrored camera image, y from the top;
// - VIEW space is what the player sees in the mirror: x = (1 - x_raw) * aspect, y = y_raw, both measured in image
//   heights, so a circle stays a circle;
// - BODY space hangs on the player: origin at the calibrated rest hip, unit = the torso length T, +x to the right of
//   the screen, +y UP. Games place targets in body space ("a star at 1.4 T above the hip"), so tall and short players
//   at any distance get the same game.
// The mirror rectangle is where the camera frame sits on the canvas: the whole frame, contained and centred inside the
// play area (design/LAYOUT.md section 6), never stretched or cropped.
import type { BodyProfile, Landmark, Vec2 } from '../types/index.ts';

export interface Rect { x: number; y: number; w: number; h: number }

/** The largest rectangle of this aspect (width / height) that fits inside the area, centred in it. */
export function fitContain(aspect: number, area: Rect): Rect {
  if (!(aspect > 0) || !(area.w > 0) || !(area.h > 0)) return { x: area.x, y: area.y, w: 0, h: 0 };
  let w = area.w, h = w / aspect;
  if (h > area.h) { h = area.h; w = h * aspect; }
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** A profile stand-in for before calibration: the hip in the middle of the frame, a torso a quarter of its height. */
export function defaultProfile(aspect: number): Pick<BodyProfile, 'T' | 'rest'> {
  return { T: 0.26, rest: { hipX: aspect / 2, hipY: 0.62, shoulderX: aspect / 2, shoulderY: 0.36, noseY: 0.26 } };
}

/** Body space to view space. Writes `out` and returns it. */
export function bodyToView(b: Vec2, p: Pick<BodyProfile, 'T' | 'rest'>, out: Vec2): Vec2 {
  out.x = p.rest.hipX + b.x * p.T;
  out.y = p.rest.hipY - b.y * p.T;
  return out;
}

export function viewToBody(v: Vec2, p: Pick<BodyProfile, 'T' | 'rest'>, out: Vec2): Vec2 {
  out.x = (v.x - p.rest.hipX) / p.T;
  out.y = (p.rest.hipY - v.y) / p.T;
  return out;
}

/** View space (image heights) to canvas pixels inside the mirror rectangle. */
export function viewToCanvas(v: Vec2, rect: Rect, out: Vec2): Vec2 {
  out.x = rect.x + v.x * rect.h;
  out.y = rect.y + v.y * rect.h;
  return out;
}

export function canvasToView(c: Vec2, rect: Rect, out: Vec2): Vec2 {
  out.x = (c.x - rect.x) / rect.h;
  out.y = (c.y - rect.y) / rect.h;
  return out;
}

/** A raw landmark to canvas pixels: mirrored, inside the rectangle. */
export function landmarkToCanvas(l: Pick<Landmark, 'x' | 'y'>, rect: Rect, out: Vec2): Vec2 {
  out.x = rect.x + (1 - l.x) * rect.w;
  out.y = rect.y + l.y * rect.h;
  return out;
}

export interface Projector {
  /** Body space to canvas pixels (CSS pixels of the canvas). Allocates a Vec2; use into() in a loop. */
  project(b: Vec2): Vec2;
  into(b: Vec2, out: Vec2): Vec2;
  /** The way back, for touch and mouse input on the canvas. */
  unproject(c: Vec2): Vec2;
  /** False while the numbers come from defaultProfile (not calibrated yet). */
  readonly calibrated: boolean;
}

/** Body space to canvas through a profile and the mirror rectangle. Nothing is kept: build a new one when either changes. */
export function makeProjector(profile: Pick<BodyProfile, 'T' | 'rest'> | null, rect: Rect, aspect: number): Projector {
  const p = profile ?? defaultProfile(aspect);
  const mid: Vec2 = { x: 0, y: 0 };
  const into = (b: Vec2, out: Vec2): Vec2 => viewToCanvas(bodyToView(b, p, mid), rect, out);
  return {
    calibrated: profile !== null,
    project: (b) => into(b, { x: 0, y: 0 }),
    into,
    unproject: (c) => viewToBody(canvasToView(c, rect, { x: 0, y: 0 }), p, { x: 0, y: 0 }),
  };
}

/** One torso length in canvas pixels: how big a body is on screen, for sizes that must follow the player. */
export function torsoPixels(profile: Pick<BodyProfile, 'T'> | null, rect: Rect): number {
  return (profile ? profile.T : defaultProfile(1).T) * rect.h;
}
