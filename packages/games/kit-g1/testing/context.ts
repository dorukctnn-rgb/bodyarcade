// Test support: a GameContext whose HUD, audio and pose are stand-ins that write down what they were asked, and input
// frames made by hand. Nothing here is imported by production code.
import type {
  AudioApi, GameContext, Hud, InputEvent, InputFrame, MovementEvent, PlayerInput, PlayerSlot, PoseFrame, PoseService, Rng, Scene2D, Tracking,
} from '../../../core/types/index.ts';
import { stepTime } from '../../../core/loop/clock.ts';
import { rngStream } from '../../../core/loop/rng.ts';

export interface TestCtx {
  ctx: GameContext;
  /** [slot, value] in the order set. */
  hud: [string, unknown][];
  /** Per-player plates: [player, slot, value]. */
  plates: [number, string, unknown][];
  sounds: string[];
  announced: string[];
  toasts: string[];
  /** Delivers a pose frame to the subscribers (the self view). */
  emitPose(f: PoseFrame): void;
  subscribers(): number;
  lastHud(slot: string): unknown;
}

export interface TestCtxOptions {
  seed?: number;
  seated?: boolean;
  silent?: boolean;
  reducedMotion?: boolean;
  /** Replace the strings (default: every key comes back as itself, so a game falls back to its English). */
  t?: GameContext['t'];
  scene2d?: Scene2D;
  /** The HUD has the shell's per-player plates (mode 'local2'). */
  duoHud?: boolean;
}

export function testContext(o: TestCtxOptions = {}): TestCtx {
  const seed = o.seed ?? 1;
  const hudLog: [string, unknown][] = [];
  const plates: [number, string, unknown][] = [];
  const sounds: string[] = [];
  const announced: string[] = [];
  const toasts: string[] = [];
  const subs = new Set<(f: PoseFrame) => void>();
  const streams = new Map<string, Rng>();
  const hud: Hud & { setPlayer?: (p: PlayerSlot, slot: string, v: unknown) => void } = {
    set: (slot, v) => { hudLog.push([slot, v]); },
    announce: (t) => { announced.push(t); },
    toast: (t) => { toasts.push(t); },
  };
  if (o.duoHud) hud.setPlayer = (p, slot, v) => { plates.push([p, slot, v]); };
  const pose = {
    onFrame: (cb: (f: PoseFrame) => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
  } as unknown as PoseService;
  const audio: AudioApi = { unlock() {}, play: (name) => { sounds.push(name); }, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) };
  const ctx: GameContext = {
    pose,
    input: {} as GameContext['input'],
    hud,
    audio,
    store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
    rng: (name) => {
      let s = streams.get(name);
      if (!s) { s = rngStream(seed, name); streams.set(name, s); }
      return s;
    },
    flags: { reducedMotion: o.reducedMotion ?? false, silent: o.silent ?? false, seated: o.seated ?? false },
    t: o.t ?? ((k) => k),
  };
  if (o.scene2d) ctx.scene2d = o.scene2d;
  return {
    ctx, hud: hudLog, plates, sounds, announced, toasts,
    emitPose: (f) => { for (const cb of [...subs]) cb(f); },
    subscribers: () => subs.size,
    lastHud: (slot) => [...hudLog].reverse().find(([s]) => s === slot)?.[1],
  };
}

// ───────── input frames ─────────

/** An event as the hub delivers it. */
export function evt(id: MovementEvent['id'], kind: MovementEvent['kind'], k: number, rest: Omit<Partial<InputEvent>, 'id' | 'kind' | 't' | 'source'> = {}): InputEvent {
  return { id, kind, t: stepTime(k), source: 'test', ...rest };
}

/** The input of step k (1-based): channels and the events of that step. */
export function frame(k: number, channels: Record<string, number> = {}, events: InputEvent[] = [], tracking: Tracking = { ok: true }): InputFrame {
  return { t: stepTime(k), source: 'test', tracking, channels, events };
}

export type PlayerFrame = { channels?: Record<string, number>; events?: InputEvent[]; tracking?: Tracking };

/** Mode 'local2': two streams; the top level mirrors Player 1. */
export function duoFrame(k: number, a: PlayerFrame = {}, b: PlayerFrame = {}): InputFrame {
  const mk = (p: PlayerFrame, slot: PlayerSlot): PlayerInput => ({
    tracking: p.tracking ?? { ok: true },
    channels: p.channels ?? {},
    events: (p.events ?? []).map((e) => ({ ...e, player: slot })),
  });
  const p1 = mk(a, 1), p2 = mk(b, 2);
  return { t: stepTime(k), source: 'test', tracking: p1.tracking, channels: p1.channels, events: p1.events, players: { 1: p1, 2: p2 } };
}
