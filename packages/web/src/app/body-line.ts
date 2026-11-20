// Our body line on a canvas, the one look of the site (the hero, the moving cards, the tour): a lime line on a dark edge with a lime
// glow, white joints with a lime ring, a ring round the head, and the score pops in the display face. Browser only (a 2D context);
// the maths of where the points are is hero-pose.ts.
import { coverBox, HERO_BONES, HERO_JOINTS, LEG_POINTS, placePops, pointIndex, popsAt, poseAt, type HeroPointName, type HeroPop, type HeroPose, type PictureBox, type PopPlace, type Rect } from '../hero-pose.ts';

export const LIME = '#d7ff1f';
export const WHITE = '#f5f5f5';
const POP_FONT = '"Anton", "Arial Narrow", sans-serif';

/** The box the clip's picture fills in a canvas of w x h (object-fit: cover at an object-position). */
export type Box = PictureBox;
export const pictureBox = (w: number, h: number, pose: Pick<HeroPose, 'aspect'>, pw: number, px = 0.5, py = 0.5): Box => coverBox(w, h, pw, pw / pose.aspect, px, py);

export interface LineStyle {
  /** The line's width in canvas pixels. */
  line: number;
  /** Draws every point the model finds (a file of all 33), small, besides the line. */
  allPoints?: boolean;
  /** 0 to 1: the line's opacity (a target shape is drawn faint). */
  alpha?: number;
  /** Dashed, white: the shape to match ("how it works", step 3). */
  ghost?: boolean;
}

/** The points of the pose at `t` in canvas pixels: a function from a point's name, plus the raw array for the 33 points. */
export function placePose(pose: HeroPose, t: number, box: Box, into?: Float32Array<ArrayBuffer>): { at: (name: HeroPointName) => [number, number]; raw: Float32Array } {
  const raw = poseAt(pose, t, into);
  const at = (name: HeroPointName): [number, number] => {
    const k = pointIndex(pose, name) * 2;
    return [box.x + (raw[k] ?? 0) * box.w, box.y + (raw[k + 1] ?? 0) * box.h];
  };
  return { at, raw };
}

/** The body line of the pose at `t`. */
export function drawBodyLine(g: CanvasRenderingContext2D, pose: HeroPose, t: number, box: Box, style: LineStyle, into?: Float32Array<ArrayBuffer>): (name: HeroPointName) => [number, number] {
  const { at, raw } = placePose(pose, t, box, into);
  const line = style.line;
  const upper = pose.parts === 'upper';
  const bones = upper ? HERO_BONES.filter(([a, b]) => !LEG_POINTS.has(a) && !LEG_POINTS.has(b)) : HERO_BONES;
  const joints = upper ? HERO_JOINTS.filter((j) => !LEG_POINTS.has(j)) : HERO_JOINTS;
  g.save();
  g.globalAlpha = style.alpha ?? 1;
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (style.ghost) g.setLineDash([line * 1.6, line * 1.8]);
  for (const pass of style.ghost ? [1] as const : [0, 1] as const) {
    g.strokeStyle = pass === 0 ? 'rgba(5,5,5,0.55)' : style.ghost ? WHITE : LIME;
    g.lineWidth = pass === 0 ? line * 2.2 : line;
    g.shadowColor = pass === 0 || style.ghost ? 'transparent' : 'rgba(215,255,31,0.55)';
    g.shadowBlur = pass === 0 || style.ghost ? 0 : line * 2;
    g.beginPath();
    for (const [a, b] of bones) { const [ax, ay] = at(a); const [bx, by] = at(b); g.moveTo(ax, ay); g.lineTo(bx, by); }
    // the head: a ring around the face, from the ears and the nose
    const [lx, ly] = at('earL'), [rx, ry] = at('earR'), [nx, ny] = at('nose');
    const hx = (lx + rx + nx) / 3, hy = (ly + ry + ny) / 3;
    const r = Math.max(line * 2, Math.hypot(lx - rx, ly - ry) * 0.85);
    g.moveTo(hx + r, hy);
    g.arc(hx, hy, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.setLineDash([]);
  if (!style.ghost) {
    const jr = line * 1.15;
    g.beginPath();
    for (const j of joints) { const [x, y] = at(j); g.moveTo(x + jr, y); g.arc(x, y, jr, 0, Math.PI * 2); }
    g.fillStyle = WHITE; g.fill();
    g.lineWidth = Math.max(1, line * 0.45); g.strokeStyle = LIME; g.stroke();
  }
  if (style.allPoints && pose.k === 33) {
    // every point the model finds: the face, the hands and the feet too (the tour's "33 points")
    g.beginPath();
    const pr = Math.max(1.5, line * 0.7);
    for (let i = 0; i < 33; i += 1) {
      const x = box.x + (raw[i * 2] ?? 0) * box.w, y = box.y + (raw[i * 2 + 1] ?? 0) * box.h;
      g.moveTo(x + pr, y); g.arc(x, y, pr, 0, Math.PI * 2);
    }
    g.fillStyle = LIME; g.fill();
  }
  g.restore();
  return at;
}

let popFontReady = false;
/** Loads the display face for the pops once; until it is in, the pops use the system's sans-serif. */
export function loadPopFont(doc: Document, then: () => void): void {
  if (popFontReady) return;
  void doc.fonts?.load(`400 48px ${POP_FONT}`).then(() => { popFontReady = true; then(); }).catch(() => undefined);
}

/** A score pop in the display face (uppercase): lime points, white words, a dark edge so it reads on the clip. */
export function drawPop(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, alpha: number, color: string): void {
  g.save();
  g.globalAlpha = alpha;
  g.font = `400 ${Math.round(size)}px ${popFontReady ? POP_FONT : 'sans-serif'}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, size * 0.14);
  g.strokeStyle = 'rgba(5,5,5,0.8)';
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}

export interface PopWords { combo: string; perfect: string; lang?: string }

export interface PopOptions {
  /** Sizes the pops to the picture: 1 on the hero; smaller cards pass less. */
  scale?: number;
  /** The smallest size of a points pop, in CSS pixels. */
  minPx?: number;
  /** What sits over the picture, in canvas pixels: no pop goes under it. */
  avoid?: readonly Rect[];
}

// the places of a clip's pops, per canvas (a clip can play in two cards of different sizes at once)
const layouts = new WeakMap<HeroPose, Map<string, (PopPlace | null)[]>>();

/**
 * The pops of the pose at `t` on a canvas of w x h: each where placePops (hero-pose.ts) puts it, clear of the face, of what sits over the
 * picture and of the canvas's edges; a pop with no room is left out. The places are worked out once for a canvas and kept.
 */
export function drawPops(g: CanvasRenderingContext2D, pose: HeroPose, t: number, box: Box, w: number, h: number, dpr: number, words: PopWords, o: PopOptions = {}): void {
  const active = popsAt(pose, t);
  if (!active.length) return;
  const size = Math.max((o.minPx ?? 26) * dpr, Math.min(64 * dpr * (o.scale ?? 1), box.h * 0.14, w * 0.09));
  const font = popFontReady ? POP_FONT : 'sans-serif';
  const avoid = o.avoid ?? [];
  const key = [w, h, box.x, box.y, box.w, box.h, size, font, words.combo, words.perfect, words.lang ?? '', ...avoid.flat().map(Math.round)].join(',');
  let byCanvas = layouts.get(pose);
  if (!byCanvas) { byCanvas = new Map(); layouts.set(pose, byCanvas); }
  let places = byCanvas.get(key);
  if (!places) {
    g.save();
    const measure = (text: string, px: number): number => { g.font = `400 ${Math.round(px)}px ${font}`; return g.measureText(text).width; };
    const text = ([, kind, n]: HeroPop): string => (kind === 'pts' ? `+${n}` : kind === 'combo' ? words.combo.replace('{n}', String(n)) : words.perfect).toLocaleUpperCase(words.lang || undefined);
    places = placePops(pose, { w, h, box, size, pad: 6 * dpr, measure, text, avoid });
    g.restore();
    if (byCanvas.size >= 8) byCanvas.clear();
    byCanvas.set(key, places);
  }
  for (const { pop, age } of active) {
    const place = places[pose.pops.indexOf(pop)];
    if (!place) continue;
    const grow = Math.min(1, age / 0.25);
    const alpha = age < 0.85 ? Math.min(1, age / 0.12) : (1 - age) / 0.15;
    drawPop(g, place.text, place.x, place.y - place.rise * age, place.size * (0.85 + 0.15 * grow), alpha, pop[1] === 'pts' ? LIME : WHITE);
  }
}
