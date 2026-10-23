// Test support: a fake camera and a fake pose service for the Session, and a Session driven by a hand-turned clock so a
// whole run (countdown, play, results) takes milliseconds. Nothing in production imports this.
import { abortError } from '../../../core/camera/camera.ts';
import { createInputHub } from '../../../core/input/hub.ts';
import { createSession, type SessionDeps } from '../../../core/loop/session.ts';
import type {
  AudioApi, CameraAcquireOptions, CameraLease, CameraService, FrameSource, GameModule, InputHub, PoseFrame, PoseLoadOptions, PoseService,
  Session, SessionOptions, Unsubscribe,
} from '../../../core/types/index.ts';

export class FakeLease implements CameraLease {
  readonly kind = 'video' as const;
  readonly video = {} as HTMLVideoElement;
  readonly stream = {} as MediaStream;
  readonly info = { width: 640, height: 360 };
  alive = true;
  released = false;
  async start(): Promise<void> {}
  stop(): void {}
  release(): void { this.alive = false; this.released = true; }
  onEnded(_cb: () => void): Unsubscribe { return () => {}; }
}

export function fakeCamera(): CameraService & { leases: FakeLease[] } {
  const leases: FakeLease[] = [];
  return {
    leases,
    async acquire(o?: CameraAcquireOptions): Promise<CameraLease> {
      if (o?.signal?.aborted) throw abortError();
      const l = new FakeLease();
      leases.push(l);
      return l;
    },
    stats() {
      const released = leases.filter((l) => l.released).length;
      return { acquired: leases.length, released, live: leases.length - released };
    },
  } as CameraService & { leases: FakeLease[] };
}

export function fakePose(): PoseService & { emit(f: PoseFrame): void } {
  const cbs = new Set<(f: PoseFrame) => void>();
  let attached: FrameSource | null = null;
  let loaded = false;
  const p = {
    async load(_o: PoseLoadOptions) { await Promise.resolve(); loaded = true; return { delegate: 'CPU' as const, worker: true, loadMs: 1 }; },
    async warmUp() {},
    attach(src: FrameSource) { if (src.kind === 'video' && !loaded) throw new Error('Call load() before attaching a camera.'); attached = src; },
    detach() { attached = null; },
    onFrame(cb: (f: PoseFrame) => void) { cbs.add(cb); return () => { cbs.delete(cb); }; },
    setMaxHz() {},
    async setNumPoses() {},
    stats: { hz: 0, p50: 0, p95: 0, dropped: 0, frames: 0 },
    dispose() {},
    emit(f: PoseFrame) { if (attached) for (const cb of [...cbs]) cb(f); },
  };
  return p as unknown as PoseService & { emit(f: PoseFrame): void };
}

export interface Clocked {
  session: Session;
  /** The input hub of the run in progress (for injecting a scripted player). */
  hub(): InputHub | null;
  /** The hand-turned clock, ms. */
  now(): number;
  /** Runs `ms` of frames at 60 per second, calling `each` before every frame. */
  tick(ms: number, each?: (t: number) => void): void;
  /** Frames until the session is in this state (or the time given runs out). */
  until(state: string, o?: { maxMs?: number; each?: (t: number) => void }): boolean;
  keys: EventTarget;
  hudWrites: [string, unknown][];
  played: string[];
}

/** A Session with a hand-turned clock and frame loop, over the given games, with keyboard and 'test' input allowed. */
export function clockedSession(games: Record<string, GameModule>, o: Partial<SessionDeps> & { scene2d?: unknown } = {}): Clocked {
  let t = 0;
  let id = 0;
  const raf = new Map<number, () => void>();
  const keys = new EventTarget();
  const hudWrites: [string, unknown][] = [];
  const played: string[] = [];
  let hub: InputHub | null = null;
  const { scene2d, ...rest } = o as Partial<SessionDeps> & { scene2d?: unknown };
  const audio: AudioApi = { unlock() {}, play: (n) => { played.push(n); }, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) };
  const session = createSession({
    games: (g) => games[g] ?? null,
    ui: () => ({
      hud: { set: (s, v) => { hudWrites.push([s, v]); }, announce() {}, toast() {} },
      audio,
      store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
      t: (k: string) => k,
      ...(scene2d ? { scene2d: scene2d as never } : {}),
    }),
    raf: (cb) => { raf.set(++id, () => cb(t)); return id; },
    cancelRaf: (i) => { raf.delete(i); },
    now: () => t,
    doc: Object.assign(new EventTarget(), { hidden: false }),
    seed: () => 4,
    keyTarget: keys,
    extraSources: ['test'],
    wakeLock: null,
    hub: (h) => { hub = createInputHub(h); return hub; },
    ...rest,
  });
  const frame = (): void => {
    t += 1000 / 60;
    const due = [...raf.values()];
    raf.clear();
    for (const cb of due) cb();
  };
  return {
    session, keys, hudWrites, played,
    hub: () => hub,
    now: () => t,
    tick(ms, each) { const end = t + ms; while (t < end) { each?.(t); frame(); } },
    until(state, u = {}) {
      const end = t + (u.maxMs ?? 600_000);
      while (session.state !== state && t < end) { u.each?.(t); frame(); }
      return session.state === state;
    },
  };
}

export type { SessionOptions };
