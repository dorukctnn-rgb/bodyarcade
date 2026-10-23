// The self view window (design/LAYOUT.md section 4, BUILD-PLAN "Screen layout rule"): the player's own camera as a
// small picture in a corner, drawn here from the pieces of the 2D kit (rounded chalk edge, mirrored picture, skeleton,
// camera dot) so that one or two players can be shown and so that it runs in Node against a recording context.
// The camera aspect is kept (the window is sized for it); the skeleton of Player 1 is in the near colours, Player 2 in
// the sun colours, with a dashed line between them in mode 'local2'.
import type { Landmark, PlayerSlot } from '../../core/types/index.ts';
import { BODY_STYLES, bodyScale, createPoints, drawSkeleton, LandmarkSmoother, toCanvasPoints } from '../../core/render2d/body.ts';
import { PIP_STYLE, pipRadius, roundedRectPath } from '../../core/render2d/pip.ts';
import { fitContain, type Rect } from '../../core/render2d/view.ts';
import type { SelfImage } from './selfview.ts';

type Ctx = CanvasRenderingContext2D;

export interface PipPlayer { slot: PlayerSlot; landmarks: readonly Landmark[] | null }

export interface PipPainter {
  /** Draws the window. `dtMs` feeds the skeleton smoother. */
  draw(ctx: Ctx, win: Rect, o: { image: SelfImage | null; players: readonly PipPlayer[]; dtMs: number; divider?: boolean; on?: boolean }): void;
}

export function createPipPainter(): PipPainter {
  const pts: Record<PlayerSlot, Float32Array> = { 1: createPoints(), 2: createPoints() };
  const smooth: Record<PlayerSlot, LandmarkSmoother> = { 1: new LandmarkSmoother(), 2: new LandmarkSmoother() };
  return {
    draw(ctx, win, o) {
      if (win.w <= 0 || win.h <= 0) return;
      const radius = pipRadius(win);
      ctx.save();
      roundedRectPath(ctx, win, radius);
      ctx.fillStyle = PIP_STYLE.stage;
      ctx.fill();
      ctx.clip();
      if (o.image) {
        const into = o.image.w > 0 && o.image.h > 0 ? fitContain(o.image.w / o.image.h, win) : win;
        ctx.save();
        ctx.translate(into.x + into.w, into.y);
        ctx.scale(-1, 1);
        ctx.drawImage(o.image.source, 0, 0, into.w, into.h);
        ctx.restore();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = PIP_STYLE.stage;
        ctx.fillRect(win.x, win.y, win.w, win.h);
        ctx.globalAlpha = 1;
      }
      if (o.divider) {
        ctx.save();
        ctx.strokeStyle = 'rgba(244, 242, 248, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(win.x + win.w / 2, win.y + 4);
        ctx.lineTo(win.x + win.w / 2, win.y + win.h - 4);
        ctx.stroke();
        ctx.restore();
      }
      for (const p of o.players) {
        if (!toCanvasPoints(p.landmarks as Landmark[] | null, win, pts[p.slot], { smoother: smooth[p.slot], dtMs: o.dtMs })) { smooth[p.slot].reset(); continue; }
        drawSkeleton(ctx, pts[p.slot], BODY_STYLES[p.slot], bodyScale(pts[p.slot], win.h * 0.3));
      }
      ctx.restore();
      // The edge and the camera dot are drawn outside the clip so that the edge is not cut in half.
      ctx.save();
      roundedRectPath(ctx, { x: win.x + 1, y: win.y + 1, w: win.w - 2, h: win.h - 2 }, radius);
      ctx.strokeStyle = PIP_STYLE.frame;
      ctx.lineWidth = PIP_STYLE.frameWidth;
      ctx.stroke();
      ctx.fillStyle = o.on === false ? PIP_STYLE.cameraOff : PIP_STYLE.cameraOn;
      ctx.beginPath();
      ctx.arc(win.x + radius * 0.5 + PIP_STYLE.dot + 2, win.y + radius * 0.5 + PIP_STYLE.dot + 2, PIP_STYLE.dot, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };
}
