// The one second replay of a missed move. While a round with the camera runs, the landmarks of the pose frames (the 33 points the
// pose model finds, never a picture) go into a small ring of the last second and a half, in memory. When the game's log says a move
// missed, and says why (a reason the results can put into words), the last second of the ring is copied out and kept with that reason;
// when the round is over the window of the reason that missed most is handed to the results screen, which draws it as a skeleton
// (replay-view.ts) and plays it once. Nothing here touches the camera picture, the storage or the network, and the clip lives
// only until the results screen is left: the app drops it then (app.ts), and dispose() empties the recorder.
import { LANDMARK_COUNT, POSE_CONNECTIONS, type Game, type GameModule, type Landmark, type RunSummary } from '../../../core/types/index.ts';

/** How long the replay is. */
export const REPLAY_MS = 1000;
/** How much the ring keeps, so that the window of a miss is whole even when the game's log is read a moment after the miss. */
export const RING_MS = 1500;
/** The most frames the ring holds (60 a second would need 90): a faster feed than that only fills it sooner. */
export const RING_FRAMES = 96;
/** A window with fewer frames than this, or covering less time, is not a movement worth showing (a person who was out of view, a phone that gave a frame a second). */
export const MIN_FRAMES = 6;
export const MIN_SPAN_MS = 500;
/** Bones that must be drawable in the last frame of a window: a skeleton of two joints says nothing. */
export const MIN_BONES = 5;
/** How often the game's log is read, in milliseconds of the game's own time. */
export const POLL_MS = 100;
/** The most kinds of miss kept at a time (there are 38 codes), each with its latest window. */
export const MAX_KINDS = 40;
/** A landmark that is less visible than this is not drawn (the HUD's skeleton uses the same). */
export const MIN_VISIBILITY = 0.5;

const STRIDE = 3;
const SIZE = LANDMARK_COUNT * STRIDE;

/** One frame of a window: when it was, counted from the first frame, and x, y and visibility of each of the 33 landmarks (x as the camera saw it, not mirrored). */
export interface ReplayFrame { t: number; p: Float32Array }

/** The window of one miss. */
export interface ReplayClip {
  /** The code of the miss: the reason the results give has the sentence `miss.<kind>`. */
  kind: string;
  /** How long the window is, in milliseconds (at most REPLAY_MS). */
  ms: number;
  /** Width over height of the camera picture the landmarks are fractions of. */
  aspect: number;
  frames: ReplayFrame[];
}

/** What a session puts the replay's material into. The real session (session.ts) and the practice session (demo-session.ts) both do. */
export interface ReplayTap {
  /** A pose frame of the person on the camera: its landmarks are copied at once (the caller may reuse them). `at` is when it was, on the recorder's clock (now, when it is not given). */
  frame(landmarks: readonly Landmark[], aspect: number, at?: number): void;
  /** The round is running (frames are kept) or is not (calibrating, counting down, paused, over: the ring is emptied). */
  running(on: boolean): void;
  /** The game's log as it is now; the new entries are read, and each miss with a reason keeps the last second. */
  log(log: RunSummary['log']): void;
  /** A new run begins: nothing of an earlier one is kept. */
  reset(): void;
}

interface Slot { at: number; p: Float32Array }

/** The last RING_MS of landmarks, in a ring of RING_FRAMES slots that are made once and written over. */
export class PoseRing {
  private readonly slots: Slot[] = [];
  private head = 0;
  private count = 0;

  get size(): number { return this.count; }

  push(at: number, lm: readonly Landmark[]): void {
    if (lm.length < LANDMARK_COUNT) return;
    let s = this.slots[this.head];
    if (!s) { s = { at: 0, p: new Float32Array(SIZE) }; this.slots[this.head] = s; }
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const l = lm[i] as Landmark;
      s.p[i * STRIDE] = l.x;
      s.p[i * STRIDE + 1] = l.y;
      s.p[i * STRIDE + 2] = l.visibility;
    }
    s.at = at;
    this.head = (this.head + 1) % RING_FRAMES;
    this.count = Math.min(this.count + 1, RING_FRAMES);
    // what is older than the ring keeps is forgotten (a pause, a slow phone): the oldest slots are given up
    while (this.count > 0 && this.at(0) < at - RING_MS) this.count--;
  }

  /** The slot `i` places after the oldest one. */
  private at(i: number): number { return (this.slots[(this.head - this.count + i + RING_FRAMES * 2) % RING_FRAMES] as Slot).at; }

  /** The frames of the `ms` that end at `end`, oldest first, copied (the ring goes on being written over), with times counted from the first. */
  window(end: number, ms: number): ReplayFrame[] {
    const out: ReplayFrame[] = [];
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[(this.head - this.count + i + RING_FRAMES * 2) % RING_FRAMES] as Slot;
      if (s.at > end || s.at <= end - ms) continue;
      out.push({ t: s.at, p: s.p.slice() });
    }
    const first = out[0]?.t ?? 0;
    for (const f of out) f.t -= first;
    return out;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

/** How many bones of the skeleton have both ends in view in a frame. */
export function boneCount(p: Float32Array): number {
  let n = 0;
  for (const [a, b] of POSE_CONNECTIONS) if ((p[a * STRIDE + 2] as number) >= MIN_VISIBILITY && (p[b * STRIDE + 2] as number) >= MIN_VISIBILITY) n++;
  return n;
}

/** Whether a window shows a movement: enough frames over enough time, with a body in the last of them. */
export function usable(frames: readonly ReplayFrame[]): boolean {
  const last = frames[frames.length - 1];
  if (!last || frames.length < MIN_FRAMES || last.t < MIN_SPAN_MS) return false;
  return boneCount(last.p) >= MIN_BONES;
}

export interface ReplayOptions {
  /** Milliseconds, from a clock that tests can move. */
  now(): number;
  /** Whether the results have a sentence for this code of a miss (`miss.<kind>`). */
  reason(kind: string): boolean;
}

/**
 * The most useful miss: the reason that missed most often in the round's log (ties go to the first in the alphabet, as the list of reasons on
 * the results screen has them, so the replay shows the reason at the top of that list), and of it the latest window kept. A reason that has
 * no window (the person was out of view when it happened) gives way to the next one.
 */
export function chooseReplay(log: RunSummary['log'], caught: ReadonlyMap<string, { clip: ReplayClip }>, reason: (kind: string) => boolean): ReplayClip | null {
  const counts = new Map<string, number>();
  for (const e of log) if (!e.ok && (e.player ?? 1) === 1 && reason(e.kind)) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [kind] of ranked) {
    const c = caught.get(kind);
    if (c) return c.clip;
  }
  return null;
}

export class ReplayRecorder implements ReplayTap {
  private readonly o: ReplayOptions;
  private readonly ring = new PoseRing();
  private readonly caught = new Map<string, { clip: ReplayClip }>();
  private seen = 0;
  private on = false;
  private aspect = 16 / 9;
  private disposed = false;

  constructor(o: ReplayOptions) { this.o = o; }

  frame(landmarks: readonly Landmark[], aspect: number, at?: number): void {
    if (!this.on || this.disposed) return;
    if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
    this.ring.push(at ?? this.o.now(), landmarks);
  }

  running(on: boolean): void {
    if (this.disposed) return;
    this.on = on;
    if (!on) this.ring.clear();
  }

  log(log: RunSummary['log']): void {
    if (this.disposed) return;
    if (log.length < this.seen) this.seen = 0; // a log that got shorter belongs to a new run
    let at = -1;
    for (let i = this.seen; i < log.length; i++) {
      const e = log[i];
      if (!e || e.ok || (e.player ?? 1) !== 1 || !this.o.reason(e.kind)) continue;
      if (at < 0) at = this.o.now();
      this.keep(e.kind, at);
    }
    this.seen = log.length;
  }

  private keep(kind: string, at: number): void {
    if (!this.caught.has(kind) && this.caught.size >= MAX_KINDS) return;
    const frames = this.ring.window(at, REPLAY_MS);
    // a window with no body in it leaves the window kept before it (an earlier miss of this reason) where it was
    if (!usable(frames)) return;
    this.caught.set(kind, { clip: { kind, ms: frames[frames.length - 1]?.t ?? 0, aspect: this.aspect, frames } });
  }

  /** How many windows are kept now (tests, and the app's check that nothing stays after the round). */
  get kept(): number { return this.caught.size; }

  reset(): void {
    this.ring.clear();
    this.caught.clear();
    this.seen = 0;
    this.on = false;
  }

  /** The round is over: reads the last of its log, and gives the window of the most useful miss (or null when there is none). The recorder is empty after it. */
  take(summary: RunSummary): ReplayClip | null {
    if (this.disposed) return null;
    this.log(summary.log);
    const clip = chooseReplay(summary.log, this.caught, this.o.reason);
    this.dispose();
    return clip;
  }

  /** Lets go of everything: the ring, the windows. */
  dispose(): void {
    this.reset();
    this.disposed = true;
  }
}

/** The words for the time of a replay: the seconds with one decimal ("0.9"). */
export const secondsOf = (ms: number): number => Math.round(Math.max(0, ms) / 100) / 10;

/**
 * The game, watched: after a step the game's own log is read (at most every POLL_MS of its own time, and at its end), so that the recorder
 * knows when a move missed and why. The game itself is not changed: every call goes through as it was, and a game that is not
 * watched plays the same.
 */
export function watchGame(game: Game, tap: Pick<ReplayTap, 'log'>): Game {
  let last = Number.NEGATIVE_INFINITY;
  return {
    get manifest() { return game.manifest; },
    init: (ctx) => game.init(ctx),
    start: (o) => { last = Number.NEGATIVE_INFINITY; game.start(o); },
    step(dt, input) {
      const r = game.step(dt, input);
      if (r.phase !== 'running' || input.t - last >= POLL_MS) {
        last = input.t;
        tap.log(game.summary().log);
      }
      return r;
    },
    render: (alpha) => game.render(alpha),
    snapshot: () => game.snapshot(),
    restore: (s) => game.restore(s),
    summary: () => game.summary(),
    dispose: () => game.dispose(),
  };
}

/** A game folder's module with every game it makes watched. */
export function watchModule(m: GameModule, tap: Pick<ReplayTap, 'log'>): GameModule {
  return { ...m, create: () => watchGame(m.create(), tap) };
}
