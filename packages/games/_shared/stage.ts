// The thin adapter between a game's view and the 2D scene kit (core/render2d). A view draws through a Stage, never through
// the kit directly, so when the kit's surface moves only this file follows. A scene that is not the kit (a plain Scene2D
// of a test, or no scene at all) gives no stage, and the game then runs with the HUD only, like a headless simulation.
import type { Ctx2D } from '../../core/render2d/ctx.ts';
import type { BurstOptions } from '../../core/render2d/particles.ts';
import type { Scene2DKit } from '../../core/render2d/scene2d.ts';
import type { SpriteKind, SpriteStyle } from '../../core/render2d/sprites.ts';
import type { Rect } from '../../core/render2d/view.ts';
import type { Scene2D } from '../../core/types/index.ts';

/** The camera as a picture: what the self view shows when the game draws it itself (the shell's DOM tile is the default). */
export interface SelfView {
  source: CanvasImageSource;
  /** Pixel size of the source, to keep its aspect. */
  size: { w: number; h: number };
}

export interface Stage {
  /** The 2D context, in CSS pixels. Text is never drawn here: words are the HUD's (DOM, translated, readable). */
  readonly ctx: Ctx2D;
  readonly w: number;
  readonly h: number;
  /** Where a game keeps its key objects (design/LAYOUT.md section 4): inside the plates and above the reason strip. */
  readonly play: Rect;
  /** The self view window of a scene game, or null (hidden, or no self view in this mode). It may cover scenery, never the play area of the moment. */
  readonly pip: Rect | null;
  /** Mode 'local2': each player's half of the play area. */
  readonly lanes: readonly [Rect, Rect] | null;
  /** Starts a frame: the night stage colour over everything. */
  begin(): void;
  burst(x: number, y: number, count: number, o?: BurstOptions): void;
  /** Moves the particles on by a time in seconds (simulation time, so a replay looks the same). */
  advance(dtSeconds: number): void;
  drawParticles(): void;
  stamp(kind: SpriteKind, x: number, y: number, size: number, st?: SpriteStyle, o?: { rot?: number; alpha?: number }): void;
  /** The camera picture in the self view window, when the game was given one. */
  drawSelfView(v: SelfView | null): void;
  readonly particlesAlive: number;
}

export function isScene2DKit(s: Scene2D | undefined | null): s is Scene2DKit {
  return !!s && typeof s === 'object' && 'rects' in s && 'particles' in s && 'begin' in s && typeof (s as { begin: unknown }).begin === 'function';
}

export function stageOf(scene: Scene2D | undefined | null): Stage | null {
  if (!isScene2DKit(scene)) return null;
  const kit: Scene2DKit = scene;
  return {
    ctx: kit.ctx as unknown as Ctx2D,
    get w() { return kit.rects.w; },
    get h() { return kit.rects.h; },
    get play() { return kit.rects.play; },
    get pip() { return kit.rects.pip; },
    get lanes() { return kit.rects.lanes ?? null; },
    begin: () => kit.begin(),
    burst: (x, y, count, o) => { kit.particles.burst(x, y, count, o); },
    advance: (dt) => kit.particles.update(dt),
    drawParticles: () => kit.particles.draw(kit.ctx as unknown as Ctx2D),
    stamp: (kind, x, y, size, st, o) => kit.sprites.stamp(kit.ctx as unknown as Ctx2D, kind, x, y, size, st, o),
    drawSelfView: (v) => { if (v) kit.drawPip(v.source, { size: v.size, dim: 0 }); },
    get particlesAlive() { return kit.particles.alive; },
  };
}
