// Test support: a GameContext that remembers what a game said (HUD writes, sounds, announcements), a real 2D scene kit on
// a fake canvas, and frame builders. Nothing in production imports this.
import { mulberry32 } from '../../../core/loop/rng.ts';
import { streamSeed } from '../../../core/loop/rng.ts';
import { createScene2D, type Scene2DKit } from '../../../core/render2d/scene2d.ts';
import { fakeSurfaces, recorder, type Recorder } from '../../../core/render2d/testing/recorder.ts';
import type { AudioApi, GameContext, Hud, HudSlot, Namespace, Rng } from '../../../core/types/index.ts';
import { FIXED_DT } from '../../../core/types/index.ts';
import type { PlayerInput, InputEvent, InputFrame, InputSourceId, PlayerSlot, MovementId } from '../../../core/types/index.ts';
import type { CanvasLike } from '../../../core/render2d/scene2d.ts';
import { msOf } from '../util.ts';

export { FIXED_DT };

export interface Spy {
  /** Every HUD write, in order: [slot, value]. */
  hudLog: [string, unknown][];
  /** Per-player HUD writes of the duo HUD: [player, slot, value]. */
  duoLog: [number, string, unknown][];
  played: string[];
  announced: string[];
  toasts: string[];
  /** The latest value of each slot (`score`, `hint2` for Player 2 of the duo HUD, ...). */
  last: Record<string, unknown>;
}

export interface TestContextOptions {
  seed?: number;
  /** Words: the default returns the key, so a game falls back to its English line. */
  t?: GameContext['t'];
  flags?: Partial<GameContext['flags']>;
  scene2d?: GameContext['scene2d'];
  /** A HUD with the duo plates (setPlayer), as the shell's PlayHud has. */
  duo?: boolean;
  /** The audio kit reports this output latency (ms). */
  latencyMs?: number;
}

export function testContext(o: TestContextOptions = {}): GameContext & Spy {
  const seed = o.seed ?? 1;
  const streams = new Map<string, Rng>();
  const spy: Spy = { hudLog: [], duoLog: [], played: [], announced: [], toasts: [], last: {} };
  const hud: Hud & { setPlayer?: (p: PlayerSlot, slot: string, v: unknown) => void } = {
    set: (slot: HudSlot, v) => { spy.hudLog.push([slot, v]); spy.last[slot] = v; },
    announce: (text) => { spy.announced.push(text); },
    toast: (text) => { spy.toasts.push(text); },
  };
  if (o.duo) hud.setPlayer = (p, slot, v) => { spy.duoLog.push([p, slot, v]); spy.last[`${slot}${p}`] = v; };
  const audio: AudioApi = {
    unlock() {},
    play: (name) => { spy.played.push(name); },
    clock: () => ({ now: () => 0, schedule() {}, latencyMs: o.latencyMs ?? 0 }),
  };
  const store: Namespace = { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} };
  const ctx = {
    pose: {} as GameContext['pose'],
    input: {} as GameContext['input'],
    hud, audio, store,
    rng: (name: 'course' | 'fx') => {
      let s = streams.get(name);
      if (!s) { s = mulberry32(streamSeed(seed, name)); streams.set(name, s); }
      return s;
    },
    flags: { reducedMotion: false, silent: false, seated: false, ...o.flags },
    t: o.t ?? ((k: string) => k),
    ...(o.scene2d ? { scene2d: o.scene2d } : {}),
    ...spy,
  } as unknown as GameContext & Spy;
  return ctx;
}

/** One frame of input at step k (1-based), as the session's hub would sample it. */
export function inputFrame(k: number, channels: Record<string, number> = {}, events: InputEvent[] = [], o: { source?: InputSourceId; ok?: boolean } = {}): InputFrame {
  return { t: msOf(k), source: o.source ?? 'test', tracking: o.ok === false ? { ok: false, code: 'no_person' } : { ok: true }, channels, events };
}

/** A two-player frame at step k. */
export function duoFrame(k: number, p1: Partial<PlayerInput> & { channels?: Record<string, number> }, p2: Partial<PlayerInput> & { channels?: Record<string, number> }, source: InputSourceId = 'test'): InputFrame {
  const one = (p: Partial<PlayerInput>): PlayerInput => ({ tracking: p.tracking ?? { ok: true }, channels: p.channels ?? {}, events: p.events ?? [] });
  const a = one(p1), b = one(p2);
  return { t: msOf(k), source, tracking: a.tracking, channels: a.channels, events: [...a.events], players: { 1: a, 2: b } };
}

export const repEvent = (id: MovementId, k: number, o: { side?: 'L' | 'R'; source?: InputSourceId; q?: InputEvent['q']; value?: number } = {}): InputEvent => ({
  id, kind: 'rep', t: msOf(k), source: o.source ?? 'pose', ...(o.side ? { side: o.side } : {}), ...(o.q ? { q: o.q } : {}), ...(o.value !== undefined ? { value: o.value } : {}),
});

// ───────── a real 2D kit on a fake canvas ─────────

export interface FakeCanvas extends CanvasLike { ctx: Recorder }

function fakeCanvas(w: number, h: number): FakeCanvas {
  const ctx = recorder();
  let width = 0, height = 0;
  return {
    ctx,
    get width() { return width; }, set width(v: number) { width = v; },
    get height() { return height; }, set height(v: number) { height = v; },
    clientWidth: w, clientHeight: h,
    getContext: () => ctx as unknown as CanvasRenderingContext2D,
  } as unknown as FakeCanvas;
}

export interface TestKit { kit: Scene2DKit; canvas: FakeCanvas; size: { width: number; height: number }; live(): number }

/** The 2D scene kit of the platform on a fake canvas of this size (CSS pixels), with the HUD placed as the shell would. */
export function testKit(w = 390, h = 844, o: { mode?: 'scene' | 'mirror'; corner?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'hidden'; seed?: number } = {}): TestKit {
  const canvas = fakeCanvas(w, h);
  const surf = fakeSurfaces();
  const size = { width: w, height: h };
  const kit = createScene2D({ canvas, size: () => size, devicePixelRatio: () => 1, surfaces: surf.factory, rng: mulberry32(o.seed ?? 5) });
  kit.setHud({ mode: o.mode ?? 'scene', pipCorner: o.corner ?? 'bottom-left' });
  return { kit, canvas, size, live: () => surf.live() };
}
