// Browser side of tests/e2e/render2d.spec.ts: the 2D kit on a real canvas, with a test card for a camera so left and right
// can be told apart, a synthetic body, and pixel reads. Nothing here asserts; the spec does.
import { mulberry32 } from '../../../packages/core/loop/rng.ts';
import { BODY_STYLES } from '../../../packages/core/render2d/body.ts';
import { createScene2D, STAGE_COLOR, type Scene2DKit } from '../../../packages/core/render2d/scene2d.ts';
import { DEFAULT_SHAPE, synthPose } from '../../../packages/core/pose/synth.ts';
import type { BodyProfile } from '../../../packages/core/types/index.ts';
import type { HudMode, PipPlacement } from '../../../packages/core/ui/layout.ts';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Rgb { r: number; g: number; b: number }

export interface FrameResult {
  ratio: number;
  backing: { w: number; h: number };
  rects: { mirror: Rect; pip: Rect | null; play: Rect; hud: Record<string, Rect> };
  /** Colour at a point a quarter in from the left edge of the mirror and a quarter in from the right, vertical middle. */
  mirrorLeft: Rgb | null;
  mirrorRight: Rgb | null;
  pipLeft: Rgb | null;
  pipRight: Rgb | null;
  /** The colour just outside the mirror (the stage), when there is room for one. */
  stage: Rgb | null;
  /** HUD marker colours after the frame, sampled at the centre of each plate: untouched means the picture did not cover it. */
  markers: Record<string, Rgb>;
  /** A pixel with the bone colour exists within the mirror. */
  boneFound: boolean;
  /** The projected rest hip is a pixel of the picture inside the mirror. */
  hip: { x: number; y: number };
  jpeg: string;
}

const CARD = { left: '#d12a2a', right: '#2a4fd1' };
const hex = (h: string): Rgb => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });

/** A camera stand-in: left half red, right half blue, a white square in the top left corner. */
function testCard(w = 640, h = 480): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = CARD.left; x.fillRect(0, 0, w / 2, h);
  x.fillStyle = CARD.right; x.fillRect(w / 2, 0, w / 2, h);
  x.fillStyle = '#ffffff'; x.fillRect(8, 8, 40, 40);
  return c;
}

function open(w: number, h: number, dpr: number, rng = mulberry32(5)): { s: Scene2DKit; canvas: HTMLCanvasElement } {
  document.getElementById('stage2d')?.remove();
  const canvas = document.createElement('canvas');
  canvas.id = 'stage2d';
  canvas.style.cssText = `display:block;width:${w}px;height:${h}px`;
  document.body.append(canvas);
  const s = createScene2D({ canvas, size: () => ({ width: w, height: h }), devicePixelRatio: () => dpr, rng });
  return { s, canvas };
}

const profile = (aspect: number): BodyProfile => ({
  v: 2, framing: 'full', capturedAt: 0, aspect, T: 0.2, W: 0.16, hz: 30,
  rest: { hipX: aspect / 2, hipY: DEFAULT_SHAPE.hipY, shoulderX: aspect / 2, shoulderY: DEFAULT_SHAPE.hipY - 0.2, noseY: DEFAULT_SHAPE.hipY - 0.3 },
});

function pixel(s: Scene2DKit, canvas: HTMLCanvasElement, x: number, y: number): Rgb | null {
  const r = s.ratio;
  const px = Math.round(x * r), py = Math.round(y * r);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  const d = canvas.getContext('2d')!.getImageData(px, py, 1, 1).data;
  return { r: d[0]!, g: d[1]!, b: d[2]! };
}

function measuredFor(w: number, h: number): { statusLeft: { w: number; h: number }; statusRight: { w: number; h: number }; command: { w: number; h: number }; reason: { w: number; h: number } } {
  const n = Math.max(28, Math.min(60, h * 0.042));
  const cmd = Math.max(h * 0.08, 44);
  return { statusLeft: { w: Math.round(n * 4), h: Math.round(n * 1.6) }, statusRight: { w: Math.round(n * 3.4), h: Math.round(n * 1.6) }, command: { w: Math.round(cmd * 3.2), h: Math.round(cmd * 1.25) }, reason: { w: Math.round(Math.min(w * 0.4, 300)), h: Math.round(Math.max(18, h * 0.03) * 2.4) } };
}

/** One full frame in the order a game draws it, and what the pixels say. */
export function frameRun(o: { w: number; h: number; dpr: number; mode: HudMode; corner: PipPlacement; camAspect: number; jpeg?: boolean }): FrameResult {
  const { s, canvas } = open(o.w, o.h, o.dpr);
  s.setCamera(o.camAspect);
  s.setProfile(profile(o.camAspect));
  s.setHud({ mode: o.mode, pipCorner: o.corner, measured: measuredFor(o.w, o.h) });
  s.mirror.show({ silhouette: true, skeleton: true });
  const ctx = canvas.getContext('2d')!;
  const card = testCard(Math.round(480 * o.camAspect), 480);
  const lm = synthPose({ ...DEFAULT_SHAPE, aspect: o.camAspect }, { armsUp: 0.4 });
  s.begin();
  if (o.mode === 'mirror') s.drawVideo(card, { size: { w: card.width, h: card.height }, dim: 0 });
  // the HUD plates are DOM in the product; here they are markers painted BEFORE the picture's own window so any covering shows
  const hud = s.rects.hud;
  const markerColor = ['#00ff00', '#ff00ff', '#00ffff', '#ffff00', '#ff8800', '#88ff00', '#0088ff'];
  const names = Object.keys(hud).filter((k) => k !== 'pip' && k !== 'own' && k !== 'friend');
  names.forEach((k, i) => { const r = hud[k]!; ctx.fillStyle = markerColor[i % markerColor.length]!; ctx.fillRect(r.x, r.y, r.w, r.h); });
  s.drawBody({ landmarks: lm }, 33);
  s.particles.burst(o.w / 2, o.h / 2, 60);
  s.particles.update(0.1);
  s.particles.draw(ctx);
  s.drawPip(card, { size: { w: card.width, h: card.height }, dim: 0 });
  const m = s.rects.mirror, p = s.rects.pip;
  const mid = m.y + m.h / 2;
  const markers: Record<string, Rgb> = {};
  names.forEach((k) => { const r = hud[k]!; markers[k] = pixel(s, canvas, r.x + 2, r.y + 2) ?? { r: -1, g: -1, b: -1 }; });
  // is there a bone-coloured pixel in the mirror?
  const bone = hex(BODY_STYLES[1].bone);
  let boneFound = false;
  const img = ctx.getImageData(Math.round(m.x * s.ratio), Math.round(m.y * s.ratio), Math.max(1, Math.round(m.w * s.ratio)), Math.max(1, Math.round(m.h * s.ratio))).data;
  for (let i = 0; i < img.length; i += 4) {
    if (Math.abs(img[i]! - bone.r) < 6 && Math.abs(img[i + 1]! - bone.g) < 6 && Math.abs(img[i + 2]! - bone.b) < 6) { boneFound = true; break; }
  }
  const hip = s.mirror.project({ x: 0, y: 0 });
  const result: FrameResult = {
    ratio: s.ratio, backing: { w: canvas.width, h: canvas.height },
    rects: { mirror: m, pip: p, play: s.rects.play, hud: Object.fromEntries(Object.entries(hud).map(([k, v]) => [k, { x: v.x, y: v.y, w: v.w, h: v.h }])) },
    mirrorLeft: pixel(s, canvas, m.x + m.w * 0.15, mid + m.h * 0.3),
    mirrorRight: pixel(s, canvas, m.x + m.w * 0.85, mid + m.h * 0.3),
    pipLeft: p ? pixel(s, canvas, p.x + p.w * 0.25, p.y + p.h * 0.8) : null,
    pipRight: p ? pixel(s, canvas, p.x + p.w * 0.75, p.y + p.h * 0.8) : null,
    stage: m.x > 6 ? pixel(s, canvas, m.x - 3, mid) : m.y > 6 ? pixel(s, canvas, m.x + m.w / 2, m.y - 3) : null,
    markers, boneFound, hip,
    jpeg: o.jpeg ? canvas.toDataURL('image/jpeg', 0.8) : '',
  };
  s.dispose();
  canvas.remove();
  void STAGE_COLOR;
  return result;
}

export interface CostResult {
  /** Time to issue the frame's drawing commands (what the kit itself costs on the page's thread). */
  p50: number; p95: number; max: number;
  /** Issue plus a read-back, which forces the browser to rasterise the frame on the CPU: software canvas here, a GPU on a phone. Informational. */
  rasterP50: number;
  frames: number; ratio: number; backing: { w: number; h: number };
}

/** CPU time of the 2D kit's own work per frame: video, body, particles, sprites, self view. */
export function costRun(o: { w: number; h: number; dpr: number; frames: number; mode: HudMode }): CostResult {
  const { s, canvas } = open(o.w, o.h, o.dpr);
  s.setCamera(4 / 3);
  s.setProfile(profile(4 / 3));
  s.setHud({ mode: o.mode, pipCorner: 'bottom-right', measured: measuredFor(o.w, o.h) });
  s.mirror.show({ silhouette: true, skeleton: true });
  const ctx = canvas.getContext('2d')!;
  const card = testCard();
  const lm = synthPose({ ...DEFAULT_SHAPE, aspect: 4 / 3 }, { armsUp: 0.5 });
  const times: number[] = [], raster: number[] = [];
  for (let f = 0; f < o.frames + 20; f++) {
    const t0 = performance.now();
    s.begin();
    s.drawVideo(card, { size: { w: 640, h: 480 } });
    s.drawBody({ landmarks: lm }, 16.7);
    if (f % 10 === 0) s.particles.burst(o.w * 0.5, o.h * 0.4, 30, { shape: ['dot', 'star', 'spark'] });
    s.particles.update(1 / 60);
    s.particles.draw(ctx);
    for (let i = 0; i < 12; i++) s.sprites.stamp(ctx, 'star', o.w * 0.1 + i * o.w * 0.07, o.h * 0.3 + Math.sin(f * 0.1 + i) * 20, Math.min(o.w, o.h) * 0.07);
    s.drawPip(card, { size: { w: 640, h: 480 }, frame: { landmarks: lm } });
    const issued = performance.now() - t0;
    // a tiny read-back forces the browser to rasterise the frame now (software here), so the cost of that can be seen too
    ctx.getImageData(0, 0, 1, 1);
    if (f >= 20) { times.push(issued); raster.push(performance.now() - t0); }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const sortedRaster = [...raster].sort((a, b) => a - b);
  const r: CostResult = { p50: sorted[Math.floor(sorted.length * 0.5)]!, p95: sorted[Math.floor(sorted.length * 0.95)]!, max: sorted[sorted.length - 1]!, rasterP50: sortedRaster[Math.floor(sortedRaster.length * 0.5)]!, frames: times.length, ratio: s.ratio, backing: { w: canvas.width, h: canvas.height } };
  s.dispose();
  canvas.remove();
  return r;
}

/** Sessions in a row: the kit makes and gives back the same things each time. */
export function sessionsRun(o: { sessions: number; w: number; h: number; dpr: number }): { surfaces: number; particles: number; canvas: { w: number; h: number } }[] {
  const out: { surfaces: number; particles: number; canvas: { w: number; h: number } }[] = [];
  for (let i = 0; i < o.sessions; i++) {
    const { s, canvas } = open(o.w, o.h, o.dpr, mulberry32(i + 1));
    s.setHud({ mode: 'scene', pipCorner: 'bottom-right' });
    const ctx = canvas.getContext('2d')!;
    for (let f = 0; f < 60; f++) { s.begin(); s.particles.burst(100, 100, 5); s.particles.update(1 / 60); s.particles.draw(ctx); s.sprites.stamp(ctx, 'heart', 60 + f, 100, 40, { fill: '#ff4f6e', stroke: null, glow: '#ff4f6e' }); }
    const st = s.stats();
    s.dispose();
    out.push({ surfaces: st.surfaces, particles: st.particlesAlive, canvas: { w: canvas.width, h: canvas.height } });
    canvas.remove();
  }
  return out;
}

export { hex };
