// The thin adapter between a game's view and the 2D scene kit (core/render2d). A view draws through a Stage, never through
// the kit directly, so when the kit's surface moves only this file follows. A scene that is not the kit (a plain Scene2D
// of a test, or no scene at all) gives no stage, and the game then runs with the HUD only, like a headless simulation.
//
// Two things a Stage does that the kit does not, both found by looking at the games on every screen of design/LAYOUT.md:
//   - the play area holds still. The HUD gives the kit a new play area whenever a command takes one line or two (a long word on a
//     narrow phone wraps: "Lean left" is one line, "Lean right" two), so a scene laid out from it jumped at every gate. A Stage
//     answers with the smallest play area of the run so far (what has been seen is inside every later one, so nothing a game puts
//     in it is ever under a plate), and a new run starts again from what the HUD gives then;
//   - figures and effects grow with the screen (sceneUnit): the HUD does, and a firework that fills a phone is a speck on a TV.
import type { Ctx2D } from '../../core/render2d/ctx.ts';
import type { BurstOptions } from '../../core/render2d/particles.ts';
import type { Scene2DKit } from '../../core/render2d/scene2d.ts';
import type { SpriteKind, SpriteStyle } from '../../core/render2d/sprites.ts';
import type { Rect } from '../../core/render2d/view.ts';
import type { Scene2D } from '../../core/types/index.ts';
import { clamp } from './util.ts';

/** The camera as a picture: what the self view shows when the game draws it itself (the shell's DOM tile is the default). */
export interface SelfView {
  source: CanvasImageSource;
  /** Pixel size of the source, to keep its aspect. */
  size: { w: number; h: number };
}

/**
 * How much larger the figures and the effects of a scene are on a big screen than on a phone's (design/LAYOUT.md section 9: the HUD
 * grows with the screen, so the payoff has to, or a TV across the room shows specks). 1 up to a mean side of 760 px (every phone),
 * growing to 1.5 at 1140 px (a 1440 x 900 laptop and every bigger screen).
 */
export function sceneUnit(w: number, h: number): number {
  return clamp(Math.sqrt(Math.max(1, w) * Math.max(1, h)) / 760, 1, 1.5);
}

export interface Stage {
  /** The 2D context, in CSS pixels. Text is never drawn here: words are the HUD's (DOM, translated, readable). */
  readonly ctx: Ctx2D;
  readonly w: number;
  readonly h: number;
  /**
   * Where a game keeps its key objects (design/LAYOUT.md section 4): inside the plates and above the reason strip. The smallest play
   * area the HUD has given since the run began, so the scene does not move when a command wraps (see the head of this file).
   */
  readonly play: Rect;
  /** The self view window of a scene game, or null (hidden, or no self view in this mode). It may cover scenery, never the play area of the moment. */
  readonly pip: Rect | null;
  /** Mode 'local2': each player's half of the play area (held still like `play`). */
  readonly lanes: readonly [Rect, Rect] | null;
  /** 1 on a phone, up to 1.5 on a big screen: what figures and effects are multiplied by (sceneUnit). */
  readonly unit: number;
  /** A new run: the play area is taken from the HUD afresh. */
  resetLayout(): void;
  /** Starts a frame: the night stage colour over everything. */
  begin(): void;
  /** A burst of particles; speeds, sizes and gravity are given for a phone and grow with the screen (`unit`). */
  burst(x: number, y: number, count: number, o?: BurstOptions): void;
  /** Moves the particles on by a time in seconds (simulation time, so a replay looks the same). */
  advance(dtSeconds: number): void;
  drawParticles(): void;
  /** Drops every particle (a new run). */
  clearParticles(): void;
  stamp(kind: SpriteKind, x: number, y: number, size: number, st?: SpriteStyle, o?: { rot?: number; alpha?: number }): void;
  /** The camera picture in the self view window, when the game was given one. */
  drawSelfView(v: SelfView | null): void;
  readonly particlesAlive: number;
}

export function isScene2DKit(s: Scene2D | undefined | null): s is Scene2DKit {
  return !!s && typeof s === 'object' && 'rects' in s && 'particles' in s && 'begin' in s && typeof (s as { begin: unknown }).begin === 'function';
}

interface Span { top: number; bottom: number }
/** The smallest play area (and lanes) seen since the run began, with what the screen looked like then. */
interface Steady { key: string; play: Span; lanes: [Span, Span] | null }

/** One per kit, so that everything that asks a kit for its stage (the game, a test that looks over its shoulder) sees the same play area. */
const STEADY = new WeakMap<object, Steady>();

const spanOf = (r: Rect): Span => ({ top: r.y, bottom: r.y + r.h });
const keyOf = (kit: Scene2DKit): string => {
  const r = kit.rects;
  return `${r.w}x${r.h}|${r.pip ? `${r.pip.x},${r.pip.y},${r.pip.w},${r.pip.h}` : '-'}|${r.lanes ? 2 : 1}|${r.play.x},${r.play.w}`;
};

/** The play area now, narrowed by what has been seen before; a different screen, corner or mode starts again. */
function steadyOf(kit: Scene2DKit): Steady {
  const r = kit.rects;
  const key = keyOf(kit);
  let s = STEADY.get(kit);
  if (!s || s.key !== key) {
    s = { key, play: spanOf(r.play), lanes: r.lanes ? [spanOf(r.lanes[0]), spanOf(r.lanes[1])] : null };
    STEADY.set(kit, s);
    return s;
  }
  s.play.top = Math.max(s.play.top, r.play.y);
  s.play.bottom = Math.min(s.play.bottom, r.play.y + r.play.h);
  if (s.lanes && r.lanes) {
    for (let i = 0; i < 2; i++) {
      const l = r.lanes[i] as Rect, m = s.lanes[i] as Span;
      m.top = Math.max(m.top, l.y);
      m.bottom = Math.min(m.bottom, l.y + l.h);
    }
  }
  return s;
}

const rectOf = (x: number, w: number, s: Span): Rect => ({ x, y: s.top, w, h: Math.max(0, s.bottom - s.top) });

/** The same burst on a bigger screen: faster, bigger and heavier in the same proportion, so it looks the same in the picture. */
function grown(o: BurstOptions | undefined, u: number): BurstOptions | undefined {
  if (!o || u === 1) return o;
  const out: BurstOptions = { ...o };
  if (o.speed) out.speed = [o.speed[0] * u, o.speed[1] * u];
  if (o.size) out.size = [o.size[0] * u, o.size[1] * u];
  if (o.gravity !== undefined) out.gravity = o.gravity * u;
  return out;
}

export function stageOf(scene: Scene2D | undefined | null): Stage | null {
  if (!isScene2DKit(scene)) return null;
  const kit: Scene2DKit = scene;
  return {
    ctx: kit.ctx as unknown as Ctx2D,
    get w() { return kit.rects.w; },
    get h() { return kit.rects.h; },
    get play() { return rectOf(kit.rects.play.x, kit.rects.play.w, steadyOf(kit).play); },
    get pip() { return kit.rects.pip; },
    get lanes() {
      const s = steadyOf(kit);
      const l = kit.rects.lanes;
      return l && s.lanes ? ([rectOf(l[0].x, l[0].w, s.lanes[0]), rectOf(l[1].x, l[1].w, s.lanes[1])] as const) : null;
    },
    get unit() { return sceneUnit(kit.rects.w, kit.rects.h); },
    resetLayout: () => { STEADY.delete(kit); },
    begin: () => kit.begin(),
    burst: (x, y, count, o) => { kit.particles.burst(x, y, count, grown(o, sceneUnit(kit.rects.w, kit.rects.h))); },
    advance: (dt) => kit.particles.update(dt),
    drawParticles: () => kit.particles.draw(kit.ctx as unknown as Ctx2D),
    clearParticles: () => kit.particles.clear(),
    stamp: (kind, x, y, size, st, o) => kit.sprites.stamp(kit.ctx as unknown as Ctx2D, kind, x, y, size, st, o),
    drawSelfView: (v) => { if (v) kit.drawPip(v.source, { size: v.size, dim: 0 }); },
    get particlesAlive() { return kit.particles.alive; },
  };
}
