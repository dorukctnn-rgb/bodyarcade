// The thin adapter between a game view and the platform's 2D scene (core/render2d). Views ask this for the canvas
// context, the rectangles of the screen and the particle pool, and nothing else, so a different renderer (or a
// scene that is only the contract's bare Scene2D) can be put behind it without touching a view.
//   - with the 2D kit (Scene2DKit): the rectangles come from the kit's layout (design/LAYOUT.md), the particles are the
//     kit's pool;
//   - with a bare Scene2D: the whole canvas is the play area, there is no self view window, the particles are our own.
// Mode 'local2': two lanes (the kit's when it laid them out, else the play area cut in two with a 6 px divider).
import type { Rng, Scene2D } from '../../core/types/index.ts';
import { createParticles, type Particles } from '../../core/render2d/particles.ts';
import type { Scene2DKit } from '../../core/render2d/scene2d.ts';

export interface Rect { x: number; y: number; w: number; h: number }

export interface StageRects {
  /** Canvas size in CSS pixels. */
  w: number;
  h: number;
  /** Where the game keeps its key objects (between the top row and the bottom row of the HUD). */
  play: Rect;
  /** The self view window, or null (hidden, or no kit). */
  pip: Rect | null;
  /** Mode 'local2': each player's half of the play area. */
  lanes: [Rect, Rect] | null;
  /** The HUD plates that nothing may cover, by name. */
  hud: Record<string, Rect>;
}

export interface Stage {
  readonly ctx: CanvasRenderingContext2D;
  readonly particles: Particles;
  /** The kit behind the stage, when there is one. */
  readonly kit: Scene2DKit | null;
  rects(): StageRects;
  /** Starts a frame: the stage colour over everything. */
  begin(): void;
  /** The camera frame's width / height, so the self view window has the right shape. */
  setCamera(aspect: number): void;
  dispose(): void;
}

export const STAGE_BG = '#1A1430';
export const DIVIDER_PX = 6;

export const isKit = (s: unknown): s is Scene2DKit => !!s && typeof s === 'object' && 'rects' in s && 'particles' in s && 'drawPip' in s && 'begin' in s;

export function splitLanes(play: Rect): [Rect, Rect] {
  const w = Math.max(1, Math.floor((play.w - DIVIDER_PX) / 2));
  return [{ x: play.x, y: play.y, w, h: play.h }, { x: play.x + play.w - w, y: play.y, w, h: play.h }];
}

export interface StageOptions {
  /** The game's 'fx' stream (particles never touch the course). */
  rng: Rng;
  reducedMotion: boolean;
  local2: boolean;
}

function canvasSize(ctx: CanvasRenderingContext2D): { w: number; h: number } {
  const c = ctx.canvas as Partial<HTMLCanvasElement> | undefined;
  const w = c?.clientWidth || c?.width || 800;
  const h = c?.clientHeight || c?.height || 600;
  return { w, h };
}

export function createStage(scene: Scene2D, o: StageOptions): Stage {
  if (isKit(scene)) {
    const kit = scene;
    return {
      ctx: kit.ctx,
      particles: kit.particles,
      kit,
      rects() {
        const r = kit.rects;
        const hud: Record<string, Rect> = {};
        for (const [k, v] of Object.entries(r.hud)) hud[k] = { x: v.x, y: v.y, w: v.w, h: v.h };
        return { w: r.w, h: r.h, play: { ...r.play }, pip: r.pip ? { ...r.pip } : null, lanes: o.local2 ? (r.lanes ? [{ ...r.lanes[0] }, { ...r.lanes[1] }] : splitLanes(r.play)) : null, hud };
      },
      begin() { kit.begin(); },
      setCamera(aspect) { kit.setCamera(aspect); },
      dispose() { /* the kit belongs to the shell */ },
    };
  }
  const particles = createParticles(o.rng, { amount: o.reducedMotion ? 0.25 : 1 });
  return {
    ctx: scene.ctx,
    particles,
    kit: null,
    rects() {
      const { w, h } = canvasSize(scene.ctx);
      const play: Rect = { x: 0, y: 0, w, h };
      return { w, h, play, pip: null, lanes: o.local2 ? splitLanes(play) : null, hud: {} };
    },
    begin() {
      const c = scene.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.fillStyle = STAGE_BG;
      const { w, h } = canvasSize(c);
      c.fillRect(0, 0, w, h);
    },
    setCamera() { /* no self view window without the kit */ },
    dispose() { particles.clear(); },
  };
}
