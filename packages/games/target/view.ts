// The mirror view of the target-hit games (design/LAYOUT.md section 6): the camera picture is the scene, whole and
// mirrored inside the play area, and stars, pads and lights hang in it where the player's own body puts them. Drawn on
// the Scene2D kit in the order the kit documents: begin, the picture, the player's body, the targets, the effects.
//
// This file is the thin adapter between the games and the kit. The games know the TargetView interface (game.ts) and
// nothing else; everything that touches the canvas is here, so the kit can change underneath without touching a rule.
//
// Colours are the design tokens: sun (the left hand and its stars), sky (the right hand), go (a hit, a green light),
// flush (a red light, a miss), chalk and ink. A colour is never the only signal: red lights are squares with a cross,
// green ones circles, and a foot light shows a footprint.
import type { BodyProfile, GameEvent, Landmark, PlayerSlot, PoseFrame, Side, Vec2 } from '../../core/types/index.ts';
import type { Scene2DKit } from '../../core/render2d/scene2d.ts';
import type { SpriteStyle } from '../../core/render2d/sprites.ts';
import { makeProjector, type Projector, type Rect } from '../../core/render2d/view.ts';
import { CAPTION_MS, callKind, type CallId, type CallKind } from './coach.ts';
import type { TargetView, ViewBegin, ViewFrame } from './game.ts';
import { STEP_MS } from './engine.ts';
import { readyVideo, videoSizeOf } from './video.ts';
import type { LightSpec } from './reaction-tag.ts';
import type { PadSpec } from './pad-work.ts';
import type { StarSpec } from './star-catch.ts';
import type { ViewLane, ViewState, ViewTarget } from './types.ts';
import { dropLayer, glowAt, glowSprite, makeLayer, rgba, seeded, type Layer } from '../_shared/paint.ts';
import type { Ctx2D } from '../../core/render2d/ctx.ts';

export const COLORS = {
  sun: '#FFC53A', sky: '#46B4FF', flush: '#FF4F6E', go: '#22C383', chalk: '#F4F2F8', ink: '#1C1433', night: '#1A1430',
} as const;
const FONT = '"National Park", ui-sans-serif, system-ui, sans-serif';
const EDGE = 'rgba(20, 15, 39, 0.55)';
const TAU = Math.PI * 2;

const handColor = (s: Side | undefined): string => (s === 'L' ? COLORS.sun : s === 'R' ? COLORS.sky : COLORS.chalk);
const starStyle = (s: Side | undefined): SpriteStyle => ({ fill: handColor(s), stroke: EDGE, glow: handColor(s) });

export interface MirrorViewOptions {
  /** The camera picture to draw as the scene; null (or no function) shows the stage and the player's silhouette only. */
  video?: () => CanvasImageSource | null;
  /** Pixel size of that picture so its aspect is kept; the picture's own size (video.videoWidth and videoHeight) when missing. */
  videoSize?: () => { w: number; h: number } | null;
  /** How much the picture is darkened so targets are the brightest things (default 0.25, the kit's). */
  dim?: number;
}

interface Floater { x: number; y: number; lane: number; text: string; color: string; age: number; life: number; big: boolean }
/** The words of the call being made, over the picture while it is spoken (and for players who play without sound). */
interface Caption { text: string; kind: CallKind; age: number; life: number }
interface Flash { x: number; y: number; lane: number; color: string; age: number; life: number; r: number }
interface Pt { x: number; y: number }

/** What a letter of the caption takes of its type size, at most (the face is a heavy proportional one): the width of a caption before it is drawn. */
export const CAPTION_EM = 0.62;

/**
 * Where the coach's caption goes on the mirror: its centre and its type size (px). High on the picture, under the command plate; large
 * for a number, a little smaller for words, and smaller still for words that would not fit across the picture at that size.
 */
export function captionLayout(rect: Rect, kind: CallKind, text = ''): { x: number; y: number; size: number } {
  const base = Math.max(22, Math.min(rect.h * (kind === 'number' ? 0.07 : 0.062), 64));
  const fit = text.length > 0 ? (rect.w * 0.92) / (text.length * CAPTION_EM) : base;
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h * 0.22, size: Math.max(14, Math.min(base, fit)) };
}

const MAX_FLOATERS = 18;
const MAX_FLASHES = 18;

/** Star Catch's night sky (no camera picture): its colours. */
const NIGHT_SKY = { zenith: '#060920', mid: '#121338', low: '#2B1B4E', dusk: '#FF7A6B', hills: '#0C0A1E', ridge: '#15122E', band: '#8FA8FF', bandWarm: '#FF9EC0', vignette: '#03020C' } as const;

/**
 * Star Catch's sky when there is no camera picture to catch the stars in (a keyboard round, or before the picture comes):
 * a deep night with the Milky Way across it, many stars and a few bright ones, dusk light low down behind a line of hills
 * and pines, and a vignette. `lean`: painted straight onto the screen (tests in Node), without the fine stars.
 */
export function paintNightSky(c: Ctx2D, w: number, h: number, lean: boolean): void {
  const unit = Math.min(1.5, Math.max(1, Math.sqrt(w * h) / 760));
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, NIGHT_SKY.zenith);
  g.addColorStop(0.6, NIGHT_SKY.mid);
  g.addColorStop(1, NIGHT_SKY.low);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const rand = seeded(0x57a2 + Math.round(w) * 3 + Math.round(h) * 5);
  // the Milky Way: soft clouds along a slanting band
  const n = lean ? 4 : 26;
  for (let i = 0; i < n; i++) {
    const u = (i + rand() * 0.6) / n;
    const x = w * (0.02 + 0.96 * u), y = h * (0.78 - 0.68 * u) + (rand() - 0.5) * h * 0.08;
    glowAt(c, x, y, Math.max(w, h) * (0.08 + rand() * 0.08), i % 4 === 0 ? NIGHT_SKY.bandWarm : NIGHT_SKY.band, 0.05 + rand() * 0.04);
  }
  if (!lean) {
    const count = Math.min(560, Math.round((w * h) / 1900));
    for (let i = 0; i < count; i++) {
      // half the stars crowd into the band
      const inBand = rand() < 0.5;
      const u = rand();
      const x = inBand ? w * (0.02 + 0.96 * u) + (rand() - 0.5) * w * 0.06 : rand() * w;
      const y = inBand ? h * (0.78 - 0.68 * u) + (rand() - 0.5) * h * 0.16 : rand() * h * 0.85;
      const r = (0.35 + Math.pow(rand(), 4) * 1.3) * unit;
      const t = rand();
      c.globalAlpha = 0.2 + 0.7 * Math.pow(rand(), 2);
      c.fillStyle = t < 0.1 ? COLORS.sky : t < 0.17 ? COLORS.sun : COLORS.chalk;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 12; i++) {
      const x = rand() * w, y = rand() * h * 0.7, r = (5 + rand() * 8) * unit;
      glowAt(c, x, y, r, i % 3 === 0 ? COLORS.sky : COLORS.chalk, 0.6);
      c.globalAlpha = 0.55;
      c.strokeStyle = COLORS.chalk;
      c.lineWidth = Math.max(0.6, 0.7 * unit);
      c.beginPath();
      c.moveTo(x - r, y); c.lineTo(x + r, y);
      c.moveTo(x, y - r); c.lineTo(x, y + r);
      c.stroke();
      c.globalAlpha = 1;
    }
  }
  // dusk light low down, behind the hills
  glowAt(c, w * 0.62, h, Math.max(w, h) * 0.55, NIGHT_SKY.dusk, 0.22, 0.35);
  // two lines of hills, the near one with pines along it
  const step = lean ? 40 : 6;
  for (const [base, height, col, seed] of [[0.9, 0.07, NIGHT_SKY.ridge, 2], [0.95, 0.05, NIGHT_SKY.hills, 7]] as const) {
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w + step; x += step) {
      const u = x / w;
      c.lineTo(x, h * base - h * height * (0.5 + 0.3 * Math.sin(u * 5.3 + seed) + 0.2 * Math.sin(u * 13.1 + seed * 1.7)));
    }
    c.lineTo(w + step, h);
    c.closePath();
    c.fillStyle = col;
    c.fill();
  }
  if (!lean) {
    c.fillStyle = NIGHT_SKY.hills;
    for (let x = rand() * 20; x < w; x += (8 + rand() * 26) * unit) {
      const u = x / w;
      const ground = h * 0.95 - h * 0.05 * (0.5 + 0.3 * Math.sin(u * 5.3 + 7) + 0.2 * Math.sin(u * 13.1 + 7 * 1.7));
      const tall = (10 + rand() * 26) * unit;
      c.beginPath();
      c.moveTo(x - tall * 0.22, ground + 2);
      c.lineTo(x, ground - tall);
      c.lineTo(x + tall * 0.22, ground + 2);
      c.closePath();
      c.fill();
    }
  }
  const R = Math.hypot(w, h) / 2;
  const vg = c.createRadialGradient(w / 2, h * 0.45, R * 0.5, w / 2, h * 0.45, R);
  vg.addColorStop(0, rgba(NIGHT_SKY.vignette, 0));
  vg.addColorStop(1, rgba(NIGHT_SKY.vignette, 0.5));
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
}

export function createMirrorView(kit: Scene2DKit, o: MirrorViewOptions = {}): TargetView {
  let game = '';
  let keyboard = false;
  let profiles: BodyProfile[] = [];
  let projectors: Projector[] = [];
  let projKey = '';
  let floaters: Floater[] = [];
  let flashes: Flash[] = [];
  let trails: Map<number, Pt[]>[] = [new Map(), new Map()];
  let lit: { lane: number; group: number; until: number }[] = [];
  let caption: Caption | null = null;
  let clock = 0;
  const tmp: Vec2 = { x: 0, y: 0 };
  // Star Catch's painted sky (once per screen size) and the soft glows of its stars (once per colour)
  let sky: Layer | null = null;
  let skyKey = '';
  const glows = new Map<string, Layer | null>();
  const glowOf = (color: string): Layer | null => {
    if (!glows.has(color)) glows.set(color, glowSprite(color, 96, 0.7));
    return glows.get(color) ?? null;
  };

  const ctx = kit.ctx;
  const canText = (): boolean => typeof (ctx as Partial<CanvasRenderingContext2D>).fillText === 'function' && typeof (ctx as Partial<CanvasRenderingContext2D>).strokeText === 'function';
  const dash = (a: number[]): void => { const c = ctx as Partial<CanvasRenderingContext2D>; if (typeof c.setLineDash === 'function') c.setLineDash(a); };

  function projectorsFor(rect: Rect): Projector[] {
    const key = `${rect.x}|${rect.y}|${rect.w}|${rect.h}|${profiles.length}`;
    if (key !== projKey || projectors.length !== profiles.length) {
      projKey = key;
      const aspect = rect.h > 0 ? rect.w / rect.h : 4 / 3;
      projectors = profiles.map((p) => makeProjector(p, rect, aspect));
    }
    return projectors;
  }

  const px = (pr: Projector, v: Vec2): Pt => { pr.into(v, tmp); return { x: tmp.x, y: tmp.y }; };

  // ───────── drawing helpers ─────────

  function arcRing(x: number, y: number, r: number, color: string, width: number, alpha: number, frac = 1): void {
    if (frac <= 0 || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, frac));
    ctx.stroke();
    ctx.restore();
  }

  function disc(x: number, y: number, r: number, fill: string, alpha = 1, stroke: string | null = EDGE): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.stroke(); }
    ctx.restore();
  }

  function label(text: string, x: number, y: number, size: number, color: string, alpha = 1): void {
    if (!canText()) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.18);
    ctx.strokeStyle = 'rgba(20, 15, 39, 0.65)';
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  const cross = (x: number, y: number, r: number, color: string, alpha: number): void => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, r * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 0.5, y + r * 0.5);
    ctx.moveTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x - r * 0.5, y + r * 0.5);
    ctx.stroke();
    ctx.restore();
  };

  function roundedSquare(x: number, y: number, r: number, fill: string, alpha: number): void {
    const h = r * 0.88, k = r * 0.3;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(x - h + k, y - h); ctx.lineTo(x + h - k, y - h); ctx.quadraticCurveTo(x + h, y - h, x + h, y - h + k);
    ctx.lineTo(x + h, y + h - k); ctx.quadraticCurveTo(x + h, y + h, x + h - k, y + h);
    ctx.lineTo(x - h + k, y + h); ctx.quadraticCurveTo(x - h, y + h, x - h, y + h - k);
    ctx.lineTo(x - h, y - h + k); ctx.quadraticCurveTo(x - h, y - h, x - h + k, y - h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function footprint(x: number, y: number, r: number, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.chalk;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.12, r * 0.26, r * 0.4, 0, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x - r * 0.2 + i * r * 0.2, y - r * 0.5 - (i === 1 ? r * 0.06 : 0), r * 0.09, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ───────── the picture and the body ─────────

  /** Star Catch with no camera picture: the night sky over the whole screen, with a few stars twinkling over it and now and then a shooting star. */
  function drawNightSky(tNow: number, reduced: boolean): void {
    const w = kit.rects.w, h = kit.rects.h;
    if (w <= 0 || h <= 0) return;
    const key = `${Math.round(w)}x${Math.round(h)}`;
    if (key !== skyKey) {
      skyKey = key;
      dropLayer(sky);
      const l = makeLayer(w, h);
      if (l) paintNightSky(l.ctx, w, h, false);
      sky = l ? l.canvas : null;
    }
    if (sky) ctx.drawImage(sky, 0, 0, w, h);
    else paintNightSky(ctx, w, h, true);
    if (reduced) return;
    ctx.save();
    ctx.fillStyle = COLORS.chalk;
    for (let i = 0; i < 18; i++) {
      const x = ((i * 0.6180339) % 1) * w, y = ((i * 0.4142135 + 0.07) % 1) * h * 0.7;
      ctx.globalAlpha = Math.max(0, 0.5 * Math.sin(tNow / 700 + i * 1.7));
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    // a shooting star every eight seconds, for half a second
    const cycle = 8000, k = (tNow % cycle) / 500;
    if (tNow > 0 && k < 1) {
      const n = Math.floor(tNow / cycle);
      const x0 = w * (0.2 + ((n * 0.37) % 0.6)), y0 = h * (0.08 + ((n * 0.23) % 0.25));
      const len = Math.min(w, h) * 0.22;
      const x1 = x0 + len * k, y1 = y0 + len * 0.45 * k;
      const g = ctx.createLinearGradient(x1 - len * 0.5, y1 - len * 0.22, x1, y1);
      g.addColorStop(0, 'rgba(244, 242, 248, 0)');
      g.addColorStop(1, 'rgba(244, 242, 248, 0.9)');
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1 - len * 0.5, y1 - len * 0.22);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Star Catch over the camera picture: night falls from the top of the picture so the stars stand out, the room still clear below. */
  function drawNightTint(rect: Rect): void {
    ctx.save();
    const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h * 0.55);
    g.addColorStop(0, 'rgba(8, 9, 32, 0.5)');
    g.addColorStop(1, 'rgba(8, 9, 32, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h * 0.55);
    ctx.restore();
  }

  /** Star Catch with the keyboard: the player as a constellation, joints as small stars on faint lines. */
  function drawConstellationFigure(lane: ViewLane, pr: Projector, torso: number): void {
    const head = px(pr, { x: 0, y: 1.5 });
    const sl = px(pr, { x: -0.4, y: 1 }), sr = px(pr, { x: 0.4, y: 1 });
    const neck = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 };
    const hip = px(pr, { x: 0, y: 0 });
    const hl = px(pr, { x: -0.22, y: 0 }), hr = px(pr, { x: 0.22, y: 0 });
    const joints: Pt[] = [neck, sl, sr, hip, hl, hr];
    const segs: [Pt, Pt][] = [[sl, sr], [neck, hip], [hl, hr]];
    for (const side of ['L', 'R'] as const) {
      const h = lane.hands[side];
      if (!h.seen) continue;
      const s = side === 'L' ? sl : sr;
      const hp = px(pr, { x: h.x, y: h.y });
      // the elbow: halfway, pushed out and down a little
      const el = { x: (s.x + hp.x) / 2 + (side === 'L' ? -1 : 1) * torso * 0.08, y: (s.y + hp.y) / 2 + torso * 0.06 };
      segs.push([s, el], [el, hp]);
      joints.push(el);
    }
    ctx.save();
    ctx.lineCap = 'round';
    for (const [width, a] of [[Math.max(8, torso * 0.12), 0.08], [Math.max(2, torso * 0.025), 0.42]] as const) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#B9C6FF';
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [p, q] of segs) { ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#B9C6FF';
    ctx.lineWidth = Math.max(2, torso * 0.025);
    ctx.beginPath();
    ctx.arc(head.x, head.y, torso * 0.2, 0, TAU);
    ctx.stroke();
    const glow = glowOf('#B9C6FF');
    const g = Math.max(18, torso * 0.34);
    for (const p of joints) {
      if (glow) { ctx.globalAlpha = 0.8; ctx.drawImage(glow, p.x - g / 2, p.y - g / 2, g, g); }
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = COLORS.chalk;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, torso * 0.025), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAvatar(lane: ViewLane, pr: Projector, torso: number): void {
    if (game === 'star-catch') { drawConstellationFigure(lane, pr, torso); return; }
    // No camera: a plain figure so the hands have a body to belong to.
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = COLORS.chalk;
    ctx.lineWidth = Math.max(4, torso * 0.07);
    ctx.lineCap = 'round';
    const head = px(pr, { x: 0, y: 1.5 });
    const sl = px(pr, { x: -0.4, y: 1 }), sr = px(pr, { x: 0.4, y: 1 });
    const hip = px(pr, { x: 0, y: 0 });
    ctx.beginPath();
    ctx.moveTo(sl.x, sl.y); ctx.lineTo(sr.x, sr.y);
    ctx.moveTo((sl.x + sr.x) / 2, (sl.y + sr.y) / 2); ctx.lineTo(hip.x, hip.y);
    for (const side of ['L', 'R'] as const) {
      const h = lane.hands[side];
      if (!h.seen) continue;
      const s = side === 'L' ? sl : sr;
      const hp = px(pr, { x: h.x, y: h.y });
      ctx.moveTo(s.x, s.y); ctx.lineTo(hp.x, hp.y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(head.x, head.y, torso * 0.2, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /** The landmarks that belong to a lane: all of them for one player; the left body is Player 1 and the right one Player 2. */
  function landmarksFor(pose: PoseFrame | null, i: number, players: number): Landmark[] | null {
    if (!pose) return null;
    if (players === 1) return pose.landmarks;
    const all = pose.poses && pose.poses.length > 0 ? pose.poses : pose.landmarks ? [pose.landmarks] : [];
    if (all.length === 0) return null;
    // mirrored view: a body further right in the raw picture is further left on screen
    const hipX = (l: Landmark[]): number => ((l[23]?.x ?? 0.5) + (l[24]?.x ?? 0.5)) / 2;
    const sorted = [...all].sort((a, b) => hipX(b) - hipX(a));
    if (sorted.length >= 2) return sorted[i] ?? null;
    const only = sorted[0] as Landmark[];
    // one body in view: it belongs to the player whose calibrated place is nearer
    const aspect = pose.aspect || 4 / 3;
    const view = (1 - hipX(only)) * aspect;
    const d = profiles.map((p) => Math.abs(p.rest.hipX - view));
    return d.indexOf(Math.min(...d)) === i ? only : null;
  }

  // ───────── targets ─────────

  function drawStar(t: ViewTarget, pr: Projector, torso: number, tNow: number, reduced: boolean): void {
    const s = t.spec as StarSpec;
    const c = px(pr, { x: t.x, y: t.y });
    const rad = Math.max(14, t.r * torso);
    const ageMs = t.age * s.life;
    const bob = reduced ? 0 : Math.sin(tNow / 420 + s.id) * rad * 0.07;
    const rot = reduced ? 0 : Math.sin(tNow / 900 + s.id) * 0.22;
    let alpha = Math.min(1, ageMs / 180);
    if (t.age > 0.78) alpha *= reduced ? 0.65 : 0.6 + 0.4 * Math.sin(tNow / 65);
    // a soft halo of the star's colour, breathing a little, and four slim rays of light
    const halo = glowOf(handColor(s.side));
    if (halo) {
      const hs = rad * (4.2 + (reduced ? 0 : 0.35 * Math.sin(tNow / 300 + s.id)));
      ctx.save();
      ctx.globalAlpha = 0.85 * alpha;
      ctx.drawImage(halo, c.x - hs / 2, c.y + bob - hs / 2, hs, hs);
      ctx.translate(c.x, c.y + bob);
      ctx.rotate(rot * 0.5 + Math.PI / 4);
      ctx.globalAlpha = 0.35 * alpha;
      ctx.fillStyle = COLORS.chalk;
      const L = rad * 1.6, Wd = Math.max(1, rad * 0.05);
      ctx.fillRect(-L, -Wd / 2, 2 * L, Wd);
      ctx.fillRect(-Wd / 2, -L, Wd, 2 * L);
      ctx.restore();
    }
    kit.sprites.stamp(ctx, 'star', c.x, c.y + bob, rad * 2, starStyle(s.side), { rot, alpha });
    arcRing(c.x, c.y, rad * 1.34, handColor(s.side), Math.max(2, rad * 0.11), 0.6 * alpha, 1 - t.age);
    if (s.low) {
      ctx.save();
      dash([5, 5]);
      arcRing(c.x, c.y, rad * 1.7, COLORS.chalk, Math.max(1.5, rad * 0.07), 0.7 * alpha);
      ctx.restore();
    }
  }

  function drawLinks(lane: ViewLane, i: number, pr: Projector): void {
    // Faint lines between the live stars of one constellation, and bright ones through the stars already caught.
    ctx.save();
    ctx.lineCap = 'round';
    const byGroup = new Map<number, ViewTarget[]>();
    for (const t of lane.targets) {
      const s = t.spec as StarSpec;
      const a = byGroup.get(s.group) ?? [];
      a.push(t);
      byGroup.set(s.group, a);
    }
    ctx.strokeStyle = COLORS.chalk;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 2;
    for (const list of byGroup.values()) {
      list.sort((a, b) => (a.spec as StarSpec).k - (b.spec as StarSpec).k);
      if (list.length < 2) continue;
      ctx.beginPath();
      list.forEach((t, k) => { const c = px(pr, { x: t.x, y: t.y }); if (k === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y); });
      ctx.stroke();
    }
    for (const [g, pts] of (trails[i] as Map<number, Pt[]>)) {
      if (pts.length < 2) continue;
      const flash = lit.some((l) => l.lane === i && l.group === g && l.until > clock);
      ctx.strokeStyle = flash ? COLORS.go : COLORS.sun;
      // a wide soft glow under the line itself
      for (const [width, a] of [[flash ? 14 : 10, flash ? 0.22 : 0.14], [flash ? 4 : 3, flash ? 0.95 : 0.6]] as const) {
        ctx.globalAlpha = a;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach((p, k) => { const c = px(pr, p); if (k === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y); });
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawPad(t: ViewTarget, pr: Projector, torso: number, tNow: number): void {
    const s = t.spec as PadSpec;
    if (s.kind === 'bag') { drawBag(s, pr, torso, tNow); return; }
    const c = px(pr, { x: t.x, y: t.y });
    const rad = Math.max(16, t.r * torso);
    const live = tNow >= s.from && tNow < s.until;
    const alpha = Math.min(1, ((t.age * s.life) / 160) || 0) * (tNow > s.beat + 120 ? 0.7 : 1);
    const color = handColor(s.hand);
    disc(c.x, c.y, rad, color, 0.92 * alpha);
    ctx.save();
    ctx.globalAlpha = 0.55 * alpha;
    ctx.strokeStyle = COLORS.chalk;
    ctx.lineWidth = Math.max(1.5, rad * 0.08);
    ctx.beginPath(); ctx.arc(c.x, c.y, rad * 0.64, 0, TAU); ctx.stroke();
    ctx.restore();
    label(String(s.k + 1), c.x, c.y + rad * 0.04, rad * 0.95, COLORS.ink, alpha);
    // the ring closes on the pad exactly at the beat
    const lead = Math.max(1, s.beat - s.at);
    const prog = Math.min(1, Math.max(0, (s.beat - tNow) / lead));
    if (tNow <= s.beat + 40) {
      const near = Math.abs(s.beat - tNow) < 120;
      arcRing(c.x, c.y, rad * (1 + 1.35 * prog), near ? COLORS.go : COLORS.chalk, Math.max(2, rad * 0.11), 0.9 * alpha);
    }
    if (live && Math.abs(s.beat - tNow) < 220) arcRing(c.x, c.y, rad * 1.18, COLORS.go, Math.max(2, rad * 0.1), 0.55);
  }

  function drawBag(s: PadSpec, pr: Projector, torso: number, tNow: number): void {
    // A bag swings in from one side: a slip leans away from it, a duck goes under it. It is at the head at the beat.
    const sign = s.swing === 'L' ? -1 : 1;
    const lead = 650;
    const d = (tNow - s.beat) / lead;
    if (d < -1 || d > 0.6) return;
    const x = s.need === 'duck' ? sign * 1.5 * -d : sign * 1.35 * Math.min(1, Math.abs(d) * (d < 0 ? 1 : 1.7));
    const c = px(pr, { x, y: 1.35 });
    const rad = torso * 0.3;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = COLORS.ink;
    ctx.strokeStyle = COLORS.flush;
    ctx.lineWidth = Math.max(2.5, rad * 0.14);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rad * 0.78, rad * 1.1, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const chain = px(pr, { x, y: 2.35 });
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = COLORS.chalk;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(c.x, c.y - rad * 1.1); ctx.lineTo(chain.x, chain.y); ctx.stroke();
    ctx.restore();
  }

  function drawLight(t: ViewTarget, pr: Projector, torso: number, tNow: number, reduced: boolean): void {
    const s = t.spec as LightSpec;
    const c = px(pr, { x: t.x, y: t.y });
    const rad = Math.max(15, t.r * torso);
    const ageMs = t.age * s.life;
    let alpha = Math.min(1, ageMs / 120);
    if (t.age > 0.72) alpha *= reduced ? 0.7 : 0.55 + 0.45 * Math.sin(tNow / 55);
    const frac = 1 - t.age;
    if (s.trap) {
      roundedSquare(c.x, c.y, rad, COLORS.flush, 0.95 * alpha);
      cross(c.x, c.y, rad, COLORS.ink, alpha);
      ctx.save(); dash([6, 5]); arcRing(c.x, c.y, rad * 1.4, COLORS.flush, Math.max(2, rad * 0.1), 0.75 * alpha, frac); ctx.restore();
    } else {
      disc(c.x, c.y, rad, COLORS.go, 0.95 * alpha);
      disc(c.x - rad * 0.22, c.y - rad * 0.24, rad * 0.26, COLORS.chalk, 0.55 * alpha, null);
      if (s.limb === 'foot') footprint(c.x, c.y + rad * 0.05, rad, 0.9 * alpha);
      arcRing(c.x, c.y, rad * 1.38, COLORS.go, Math.max(2.5, rad * 0.12), 0.85 * alpha, frac);
    }
  }

  function drawHands(lane: ViewLane, pr: Projector, torso: number): void {
    for (const side of ['L', 'R'] as const) {
      const h = lane.hands[side];
      if (!h.seen) continue;
      const c = px(pr, { x: h.x, y: h.y });
      const r = Math.max(10, torso * 0.16);
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = handColor(side);
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = handColor(side);
      ctx.lineWidth = Math.max(2.5, r * 0.18);
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  // ───────── effects from what happened ─────────

  function apply(events: readonly GameEvent[], v: ViewState, f: ViewFrame, rect: Rect, prs: Projector[]): void {
    const reduced = f.reducedMotion;
    for (const e of events) {
      const li = Math.max(0, Math.min(prs.length - 1, ((e['player'] as number | undefined) ?? 1) - 1));
      const pr = prs[li];
      const lane = v.lanes[li];
      if (!pr || !lane) continue;
      const torso = (profiles[li]?.T ?? 0.26) * rect.h;
      const at = (): Pt => ({ ...px(pr, { x: e['x'] as number, y: e['y'] as number }) });
      switch (e.type) {
        case 'hit': {
          const p = at();
          const side = e['side'] as Side | undefined;
          const col = e['kind'] === 'light' ? COLORS.go : e['grade'] === 'perfect' ? COLORS.go : handColor(side);
          kit.particles.burst(p.x, p.y, e['kind'] === 'star' ? 16 : 12, { colors: [col, COLORS.chalk, COLORS.sun], shape: ['star', 'spark', 'dot'], speed: [80, 260], life: [0.35, 0.8], size: [2, 5], gravity: 240 });
          const pts = e['pts'] as number;
          let text = `+${pts}`;
          if (e['kind'] === 'light') text = f.say('ms', { n: e['react'] as number });
          else if (e['kind'] === 'pad' && typeof e['grade'] === 'string') text = `${f.say(`grade.${e['grade']}`)} +${pts}`;
          addFloater({ x: p.x, y: p.y - torso * 0.2, lane: li, text, color: col, age: 0, life: 900, big: e['grade'] === 'perfect' });
          addFlash({ x: p.x, y: p.y, lane: li, color: col, age: 0, life: 320, r: Math.max(14, ((e['kind'] === 'light' ? 0.17 : 0.2) * torso)) });
          if (e['kind'] === 'star') {
            const g = e['group'] as number;
            const trail = (trails[li] as Map<number, Pt[]>);
            const pts2 = trail.get(g) ?? [];
            pts2.push({ x: e['x'] as number, y: e['y'] as number });
            trail.set(g, pts2);
            if (trail.size > 4) trail.delete(trail.keys().next().value as number);
          }
          break;
        }
        case 'miss': {
          if (e['kind'] === 'bag') break;
          const p = at();
          addFlash({ x: p.x, y: p.y, lane: li, color: COLORS.flush, age: 0, life: 420, r: Math.max(14, torso * 0.2) });
          break;
        }
        case 'trap': {
          const p = at();
          kit.particles.burst(p.x, p.y, 14, { colors: [COLORS.flush, COLORS.chalk], shape: ['square', 'spark'], speed: [90, 280], life: [0.3, 0.7], size: [2, 5], gravity: 300 });
          addFloater({ x: p.x, y: p.y - torso * 0.2, lane: li, text: String(e['pts'] as number).replace('-', '−'), color: COLORS.flush, age: 0, life: 900, big: false });
          addFlash({ x: p.x, y: p.y, lane: li, color: COLORS.flush, age: 0, life: 480, r: Math.max(18, torso * 0.26) });
          break;
        }
        case 'constellation': {
          const g = e['group'] as number;
          lit.push({ lane: li, group: g, until: clock + 900 });
          const pts = (trails[li] as Map<number, Pt[]>).get(g) ?? [];
          const mid = pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : { x: 0, y: 1.4 };
          const p = px(pr, mid);
          kit.particles.confetti(p.x - rect.w * 0.12, p.y - torso * 0.4, rect.w * 0.24, reduced ? 6 : 26, { colors: [COLORS.sun, COLORS.sky, COLORS.go, COLORS.chalk] });
          addFloater({ x: p.x, y: p.y, lane: li, text: `+${e['pts'] as number}`, color: COLORS.sun, age: 0, life: 1100, big: true });
          break;
        }
        case 'call': {
          const id = e['id'] as CallId;
          const kind = callKind(id);
          caption = { text: f.say(`call.${id}`), kind, age: 0, life: CAPTION_MS[kind] };
          break;
        }
        case 'combo': {
          kit.particles.confetti(rect.x + rect.w * 0.2, rect.y + rect.h * 0.3, rect.w * 0.6, reduced ? 6 : 22, { colors: [COLORS.sun, COLORS.sky, COLORS.go, COLORS.flush] });
          // the bonus of a clean combination is points like any other: say so, above the head where the eyes are
          const top = px(pr, { x: 0, y: 1.9 });
          addFloater({ x: top.x, y: Math.max(rect.y + torso * 0.3, top.y), lane: li, text: `+${e['pts'] as number}`, color: COLORS.sun, age: 0, life: 1100, big: true });
          break;
        }
        default: break;
      }
    }
    if (lit.length > 8) lit = lit.filter((l) => l.until > clock);
  }

  function addFloater(f: Floater): void { floaters.push(f); if (floaters.length > MAX_FLOATERS) floaters.shift(); }
  function addFlash(f: Flash): void { flashes.push(f); if (flashes.length > MAX_FLASHES) flashes.shift(); }

  function drawEffects(dtMs: number, reduced: boolean): void {
    flashes = flashes.filter((f) => (f.age += dtMs) < f.life);
    for (const f of flashes) {
      const u = f.age / f.life;
      arcRing(f.x, f.y, f.r * (1 + 1.2 * u), f.color, Math.max(2, f.r * 0.14), 0.9 * (1 - u));
    }
    floaters = floaters.filter((f) => (f.age += dtMs) < f.life);
    for (const f of floaters) {
      const u = f.age / f.life;
      const rise = reduced ? 0 : u * 38;
      label(f.text, f.x, f.y - rise, f.big ? 26 : 20, f.color, u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);
    }
  }

  /** The coach's caption: one line, high on the picture and clear of the command plate, in the colour of what it asks (sun for a slip or a duck). */
  function drawCaption(rect: Rect, dtMs: number, reduced: boolean): void {
    if (!caption) return;
    caption.age += dtMs;
    if (caption.age >= caption.life) { caption = null; return; }
    const u = caption.age / caption.life;
    const alpha = Math.min(1, caption.age / 90) * (u > 0.72 ? 1 - (u - 0.72) / 0.28 : 1);
    const at = captionLayout(rect, caption.kind, caption.text);
    const grow = reduced ? 1 : 0.88 + 0.12 * Math.min(1, caption.age / 110);
    label(caption.text, at.x, at.y, at.size * grow, caption.kind === 'defence' ? COLORS.sun : COLORS.chalk, alpha);
  }

  // ───────── the view ─────────

  return {
    begin(b: ViewBegin): void {
      game = b.game;
      keyboard = b.keyboard;
      profiles = b.profiles.slice();
      projKey = '';
      floaters = [];
      flashes = [];
      trails = [new Map(), new Map()];
      lit = [];
      caption = null;
      clock = 0;
      kit.particles.clear();
      // a mirror game has no self view window: when nobody set up the mirror layout, do it (never over a two-player layout)
      if (!kit.rects.lanes && kit.rects.pip) kit.setHud({ mode: 'mirror', pipCorner: 'hidden' });
      const first = profiles[0];
      if (first) { kit.setCamera(first.aspect); kit.setProfile(first); }
    },

    draw(v: ViewState, f: ViewFrame): void {
      clock += f.dtMs;
      const tNow = v.t - (1 - f.alpha) * STEP_MS;
      kit.begin();
      const rect = kit.rects.mirror;
      if (rect.w <= 0 || rect.h <= 0) return;
      const prs = projectorsFor(rect);
      const src = keyboard ? null : readyVideo(o.video?.() ?? null);
      if (src) kit.drawVideo(src, { size: o.videoSize?.() ?? videoSizeOf(src), ...(o.dim !== undefined ? { dim: o.dim } : {}) });
      if (game === 'star-catch') { if (src) drawNightTint(rect); else drawNightSky(tNow, f.reducedMotion); }
      // with the camera picture the player is in it; without one (no picture yet, or privacy) the body is a silhouette on the stage
      kit.mirror.show({ silhouette: !src && !keyboard, skeleton: false });

      const players = v.lanes.length;
      v.lanes.forEach((lane, i) => {
        const pr = prs[i];
        if (!pr) return;
        const torso = (lane.profile.T ?? 0.26) * rect.h;
        if (keyboard) drawAvatar(lane, pr, torso);
        else kit.drawBody({ landmarks: landmarksFor(f.pose, i, players), player: lane.slot as PlayerSlot }, f.dtMs);
      });

      if (players === 2) {
        ctx.save();
        dash([8, 8]);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = COLORS.chalk;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(rect.x + rect.w / 2, rect.y);
        ctx.lineTo(rect.x + rect.w / 2, rect.y + rect.h);
        ctx.stroke();
        ctx.restore();
      }

      v.lanes.forEach((lane, i) => {
        const pr = prs[i];
        if (!pr) return;
        const torso = (lane.profile.T ?? 0.26) * rect.h;
        if (game === 'star-catch') drawLinks(lane, i, pr);
        // the targets nearest to fading are drawn last, on top
        const order = [...lane.targets].sort((a, b) => a.age - b.age).reverse();
        for (const t of order) {
          if (game === 'star-catch') drawStar(t, pr, torso, tNow, f.reducedMotion);
          else if (game === 'pad-work') drawPad(t, pr, torso, tNow);
          else drawLight(t, pr, torso, tNow, f.reducedMotion);
        }
        drawHands(lane, pr, torso);
      });

      apply(f.events, v, f, rect, prs);
      kit.particles.update(Math.max(0, f.dtMs) / 1000);
      kit.particles.draw(ctx);
      drawEffects(f.dtMs, f.reducedMotion);
      drawCaption(rect, f.dtMs, f.reducedMotion);
    },

    dispose(): void {
      floaters = []; flashes = []; lit = []; caption = null; trails = [new Map(), new Map()];
      projectors = []; projKey = '';
      dropLayer(sky); sky = null; skyKey = '';
      for (const l of glows.values()) dropLayer(l);
      glows.clear();
      kit.particles.clear();
    },
  };
}
