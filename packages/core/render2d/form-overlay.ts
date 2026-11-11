// The form coach's body line over the player's own camera picture: every part in its state, coded by colour AND pattern so it
// reads without colour vision (SPEC.md 6.2): ok = green solid, tip = amber dotted, bad = red dashed with a cross in the middle,
// unknown = thin grey dashes (a rule looks there but cannot measure it), none = thin neutral line. A dark outline under every
// line keeps it readable on a bright window and in a dark room. Points come in view space (mirrored, image heights).
import { LM } from '../types/index.ts';
import type { P, Side, View } from '../form/geometry.ts';
import { SEGMENTS, SEGMENT_IDS, type End } from '../form/segments.ts';
import type { SegState, SegmentId } from '../form/types.ts';
import type { Ctx2D } from './ctx.ts';

export type FormCtx = Ctx2D & Pick<CanvasRenderingContext2D, 'setLineDash'>;

/** design/tokens: go-400, sun-400, flush-600, ink-300, chalk, the HUD outline. */
export const FORM_COLORS: Record<SegState, string> = { ok: '#22C383', tip: '#FFC53A', bad: '#F23A5C', unknown: '#A79FBE', none: '#F4F2F8' };
export const FORM_OUTLINE = 'rgba(20, 15, 39, 0.6)';
const DRAW_VISIBILITY = 0.5;

/** Where the picture sits on the canvas: picture fraction (0..1, already mirrored) to canvas pixels. */
export interface PictureRect { x: number; y: number; w: number; h: number; aspect: number }

export interface Line { id: SegmentId; ax: number; ay: number; bx: number; by: number }

const sideOf = (id: SegmentId): Side | null => (id.endsWith('L') ? 'L' : id.endsWith('R') ? 'R' : null);

/**
 * The lines to draw, in canvas pixels. From the side the torso and the neck run to the near shoulder and hip (the far ones are
 * hidden behind the body), and a far limb that the model does not see is left out.
 */
export function formLines(pts: readonly P[], view: View | null, near: Side, r: PictureRect): Line[] {
  const side = view === 'side';
  const point = (e: End): { x: number; y: number } | null => {
    if (typeof e === 'number') {
      const p = pts[e];
      return p && p.v >= DRAW_VISIBILITY ? p : null;
    }
    const [a, b] = e;
    if (side) {
      const p = pts[near === 'L' ? a : b];
      return p && p.v >= DRAW_VISIBILITY ? p : null;
    }
    const p = pts[a], q = pts[b];
    return p && q && p.v >= DRAW_VISIBILITY && q.v >= DRAW_VISIBILITY ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : null;
  };
  const out: Line[] = [];
  for (const id of SEGMENT_IDS) {
    if (side && (id === 'shoulders' || id === 'hips')) continue;
    const s = sideOf(id);
    if (side && s && s !== near) {
      // the far limb: only when the model really sees it
      const [a, b] = SEGMENTS[id];
      if (typeof a === 'number' && typeof b === 'number' && ((pts[a]?.v ?? 0) < 0.8 || (pts[b]?.v ?? 0) < 0.8)) continue;
    }
    const [ea, eb] = SEGMENTS[id];
    const a = point(ea), b = point(eb);
    if (!a || !b) continue;
    out.push({ id, ax: r.x + (a.x / r.aspect) * r.w, ay: r.y + a.y * r.h, bx: r.x + (b.x / r.aspect) * r.w, by: r.y + b.y * r.h });
  }
  return out;
}

const JOINTS = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

/** Draws the body line. `width` is the main line width in pixels (about 1.2 % of the shorter side of the canvas). */
export function drawFormBody(ctx: FormCtx, pts: readonly P[], states: Readonly<Record<SegmentId, SegState>>, o: { view: View | null; near: Side; rect: PictureRect; width: number }): void {
  const w = o.width;
  const lines = formLines(pts, o.view, o.near, o.rect);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // outlines first, all solid, so patterns stay readable
  for (const l of lines) {
    const st = states[l.id];
    const lw = st === 'none' || st === 'unknown' ? w * 0.55 : st === 'bad' ? w * 1.2 : w;
    ctx.setLineDash([]);
    ctx.strokeStyle = FORM_OUTLINE;
    ctx.lineWidth = lw + Math.max(3, w * 0.45);
    ctx.beginPath(); ctx.moveTo(l.ax, l.ay); ctx.lineTo(l.bx, l.by); ctx.stroke();
  }
  for (const l of lines) {
    const st = states[l.id];
    ctx.strokeStyle = FORM_COLORS[st];
    ctx.globalAlpha = st === 'none' ? 0.8 : st === 'unknown' ? 0.7 : 1;
    if (st === 'none') { ctx.lineWidth = w * 0.55; ctx.setLineDash([]); }
    else if (st === 'unknown') { ctx.lineWidth = w * 0.55; ctx.setLineDash([w * 0.8, w * 0.9]); }
    else if (st === 'ok') { ctx.lineWidth = w; ctx.setLineDash([]); }
    else if (st === 'tip') { ctx.lineWidth = w; ctx.setLineDash([w * 0.05, w * 1.5]); }
    else { ctx.lineWidth = w * 1.2; ctx.setLineDash([w * 2.4, w * 1.2]); }
    ctx.beginPath(); ctx.moveTo(l.ax, l.ay); ctx.lineTo(l.bx, l.by); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  // joints
  const r = o.rect;
  for (const i of JOINTS) {
    const p = pts[i];
    if (!p || p.v < DRAW_VISIBILITY) continue;
    const x = r.x + (p.x / r.aspect) * r.w, y = r.y + p.y * r.h;
    ctx.fillStyle = FORM_OUTLINE;
    ctx.beginPath(); ctx.arc(x, y, w * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F4F2F8';
    ctx.beginPath(); ctx.arc(x, y, w * 0.38, 0, Math.PI * 2); ctx.fill();
  }
  // a cross in the middle of every red part (the shape says "wrong" without the colour)
  for (const l of lines) {
    if (states[l.id] !== 'bad') continue;
    const cx = (l.ax + l.bx) / 2, cy = (l.ay + l.by) / 2, s = w * 1.1;
    for (const [col, lw] of [[FORM_OUTLINE, w * 0.9], ['#FFFFFF', w * 0.45]] as const) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke();
    }
  }
  ctx.restore();
}
