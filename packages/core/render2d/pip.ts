// The player's own camera as a small picture in a corner (design/LAYOUT.md section 3 and 4, BUILD-PLAN "Screen layout
// rule"). Where it goes and how big it is comes from ui/layout.ts (pipSize, placeHud); this file draws it: the frame
// mirrored, in a rounded window with a chalk edge, a small dot that says the camera is on, and optionally the skeleton
// on top. The camera aspect is kept: the picture is contained in its window, never stretched or cropped.
import { bodyScale, drawSkeleton, type BodyStyle } from './body.ts';
import type { Ctx2D } from './ctx.ts';
import { fitContain, type Rect } from './view.ts';

/** design/tokens/tokens.json hud.pip-frame, hud.camera-on and the night stage. */
export const PIP_STYLE = { frame: '#F4F2F8', cameraOn: '#FF4F6E', cameraOff: '#A79FBE', stage: '#1A1430', frameWidth: 2, radiusShare: 0.09, maxRadius: 18, dot: 4 } as const;

export interface PipDraw {
  /** The camera picture: a video element, a canvas or an image bitmap. null draws the empty window (camera off or not ready). */
  source: CanvasImageSource | null;
  /** Pixel size of the source; needed to keep its aspect (video.videoWidth and videoHeight). */
  sourceSize?: { w: number; h: number } | null;
  /** Mirror the picture (the player's own view is always a mirror). Default true. */
  mirrored?: boolean;
  /** Dim the picture a little so the game stays the brightest thing on the screen (0 none, 1 black). Default 0. */
  dim?: number;
  /** A skeleton drawn on top, from packed points already in this window's pixels. */
  skeleton?: { pts: Float32Array; style: BodyStyle } | null;
}

/** A path for a rounded rectangle, made of lines and quadratic corners (no roundRect: older phones lack it). */
export function roundedRectPath(ctx: Ctx2D, r: Rect, radius: number): void {
  const k = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + k, r.y);
  ctx.lineTo(r.x + r.w - k, r.y); ctx.quadraticCurveTo(r.x + r.w, r.y, r.x + r.w, r.y + k);
  ctx.lineTo(r.x + r.w, r.y + r.h - k); ctx.quadraticCurveTo(r.x + r.w, r.y + r.h, r.x + r.w - k, r.y + r.h);
  ctx.lineTo(r.x + k, r.y + r.h); ctx.quadraticCurveTo(r.x, r.y + r.h, r.x, r.y + r.h - k);
  ctx.lineTo(r.x, r.y + k); ctx.quadraticCurveTo(r.x, r.y, r.x + k, r.y);
  ctx.closePath();
}

export function pipRadius(r: Rect): number { return Math.min(PIP_STYLE.maxRadius, Math.round(Math.min(r.w, r.h) * PIP_STYLE.radiusShare)); }

/** Draws the self view into its window. Leaves the context's state as it was. */
export function drawPip(ctx: Ctx2D, win: Rect, d: PipDraw): void {
  if (win.w <= 0 || win.h <= 0) return;
  const radius = pipRadius(win);
  const mirrored = d.mirrored ?? true;
  ctx.save();
  roundedRectPath(ctx, win, radius);
  ctx.fillStyle = PIP_STYLE.stage;
  ctx.fill();
  ctx.clip();
  if (d.source) {
    const sw = d.sourceSize?.w ?? 0, sh = d.sourceSize?.h ?? 0;
    const into = sw > 0 && sh > 0 ? fitContain(sw / sh, win) : win;
    if (mirrored) {
      ctx.translate(into.x + into.w, into.y);
      ctx.scale(-1, 1);
      ctx.drawImage(d.source, 0, 0, into.w, into.h);
    } else {
      ctx.drawImage(d.source, into.x, into.y, into.w, into.h);
    }
  }
  ctx.restore();

  // Edge, overlay and camera dot are drawn outside the clip so the edge is not cut in half.
  if (d.source && d.dim && d.dim > 0) {
    ctx.save();
    roundedRectPath(ctx, win, radius);
    ctx.globalAlpha = Math.min(1, d.dim);
    ctx.fillStyle = PIP_STYLE.stage;
    ctx.fill();
    ctx.restore();
  }
  if (d.skeleton) {
    ctx.save();
    roundedRectPath(ctx, win, radius);
    ctx.clip();
    drawSkeleton(ctx, d.skeleton.pts, d.skeleton.style, bodyScale(d.skeleton.pts, win.h * 0.3));
    ctx.restore();
  }
  ctx.save();
  roundedRectPath(ctx, { x: win.x + 1, y: win.y + 1, w: win.w - 2, h: win.h - 2 }, radius);
  ctx.strokeStyle = PIP_STYLE.frame;
  ctx.lineWidth = PIP_STYLE.frameWidth;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.fillStyle = d.source ? PIP_STYLE.cameraOn : PIP_STYLE.cameraOff;
  ctx.beginPath();
  ctx.arc(win.x + radius * 0.5 + PIP_STYLE.dot + 2, win.y + radius * 0.5 + PIP_STYLE.dot + 2, PIP_STYLE.dot, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
