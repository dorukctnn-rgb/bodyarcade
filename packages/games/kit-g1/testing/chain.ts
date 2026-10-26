// The whole chain from a body to the game, with nothing faked in between except the camera and the pose model: a
// synthetic body (the movement library's articulated rig) is turned into pose frames at the pose rate, and those go through
// the real Session: calibration, the pose feed, feature extraction, the movement detectors, the input hub, the game.
// The body can be closed-loop: it is a function of the time and of the game, so a bot can look at the screen. Test support:
// runs in Node with a fake clock (`pass`) and in a page in real time (`realtime`). Synthetic bodies show that the parts fit
// together and what the thresholds do; they are not evidence about real people.
import type {
  AudioApi, CameraAcquireOptions, CameraLease, CameraService, FrameSource, Game, GameContext, GameModule, PoseFrame, PoseService, Scene2D, Session,
  SessionEvents, SessionOptions, SessionState,
} from '../../../core/types/index.ts';
import { createCalibrator } from '../../../core/body/calibrator.ts';
import { createTwoPlayerCalibrator } from '../../../core/body/calibrator2.ts';
import { createSession } from '../../../core/loop/session.ts';
import { gaussian, mulberry32 } from '../../../core/loop/rng.ts';
import { landmarksOf, type FigureSpec, type RigShape } from '../../../core/moves/testing/rig.ts';

export interface ChainPerson {
  /** Where the person stands in the camera image and how big they are. */
  shape: RigShape;
  /** The figure at time t (ms on the chain's clock); `game` is the game the session made, or null before it exists. */
  body(t: number, game: Game | null, state: SessionState): FigureSpec;
  /** False: nobody is in the picture for this person. */
  present?: () => boolean;
}

export interface ChainOptions {
  module: GameModule;
  mode: 'solo' | 'local2';
  difficulty?: string;
  seated?: boolean;
  /** The quiet variant (no jumping and no stamping): the context's `silent` flag. */
  quiet?: boolean;
  seed?: number;
  people: ChainPerson[];
  /** Pose frames per second (default 30). */
  hz?: number;
  /** Length of the 3-2-1 (default 600 ms: the tests do not wait for ceremony). */
  countdownMs?: number;
  scene2d?: Scene2D;
  /** The HUD of the context (default: a recorder). */
  hud?: GameContext['hud'];
  audio?: AudioApi;
  /** The game's strings (default: every key comes back as itself, so the game speaks its English). */
  t?: GameContext['t'];
  /** Run in the page's own time: requestAnimationFrame and performance.now (default: a fake clock driven by `pass`). */
  realtime?: boolean;
  /** Landmark noise in image heights (default 0.001). */
  noise?: number;
  world?: string;
}

export interface Chain {
  readonly session: Session;
  /** The game instance of the latest run, with its context. */
  game(): Game | null;
  ctx(): GameContext | null;
  readonly seen: { states: SessionState[]; pauses: string[]; over: SessionEvents['over'][]; errors: SessionEvents['error'][]; countdown: number[]; calibration: number };
  now(): number;
  start(): Promise<void>;
  /** Fake clock: lets `ms` pass in display frames of 1000/60 (pose frames come at `hz`). */
  pass(ms: number): void;
  /** Passes time until `done()` or `maxMs`; true when it came about. */
  until(done: () => boolean, maxMs: number): boolean;
  /** Real time: starts the display frame pump for the pose frames (the session has its own rAF loop). */
  pump(): void;
  stop(): void;
  hudLog: [string, unknown][];
  plates: [number, string, unknown][];
  sounds: string[];
}

class FakeLease implements CameraLease {
  readonly kind = 'video' as const;
  readonly video = {} as HTMLVideoElement;
  readonly stream = {} as MediaStream;
  readonly info = { width: 640, height: 360 };
  alive = true;
  private ended = new Set<() => void>();
  async start(): Promise<void> {}
  stop(): void {}
  release(): void { this.alive = false; }
  onEnded(cb: () => void): () => void { this.ended.add(cb); return () => { this.ended.delete(cb); }; }
}

export function createChain(o: ChainOptions): Chain {
  const realtime = o.realtime === true;
  const hz = o.hz ?? 30;
  let fake = 1000;
  const raf = new Map<number, () => void>();
  let rafSeq = 0;
  const rng = mulberry32((o.seed ?? 5) + 1);
  const noise = o.noise ?? 0.001;
  const listeners = new Set<(f: PoseFrame) => void>();
  let attached: FrameSource | null = null;
  let seq = 0;
  let lastPoseT = -Infinity;
  let game: Game | null = null;
  let ctx: GameContext | null = null;
  let pumping = false;
  let timer = 0;
  const hudLog: [string, unknown][] = [];
  const plates: [number, string, unknown][] = [];
  const sounds: string[] = [];

  const now = (): number => (realtime ? performance.now() : fake);

  const camera: CameraService = { acquire: async (_o?: CameraAcquireOptions) => new FakeLease(), stats: () => ({ acquired: 1, released: 0, live: 1 }) };
  const pose: PoseService = {
    async load() { return { delegate: 'CPU' as const, worker: false, loadMs: 1 }; },
    async warmUp() {},
    attach(src: FrameSource) { attached = src; },
    detach() { attached = null; },
    onFrame(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    setMaxHz() {},
    async setNumPoses() {},
    stats: { hz, p50: 30, p95: 40, dropped: 0, frames: 0 },
    dispose() {},
  };

  const hud: GameContext['hud'] & { setPlayer?: (p: number, slot: string, v: unknown) => void } = o.hud ?? {
    set: (slot, v) => { hudLog.push([slot, v]); }, announce() {}, toast() {},
  };
  if (!o.hud) hud.setPlayer = (p, slot, v) => { plates.push([p, slot, v]); };
  const audio: AudioApi = o.audio ?? { unlock() {}, play: (n) => { sounds.push(n); }, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) };

  const { module } = o;
  const wrapped: GameModule = {
    ...module,
    create: () => {
      const g = module.create();
      const init = g.init.bind(g);
      g.init = async (c) => { ctx = c; game = g; return init(c); };
      return g;
    },
  };

  const session = createSession({
    games: () => wrapped,
    ui: () => ({ hud, audio, store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} }, t: o.t ?? ((k) => k), ...(o.scene2d ? { scene2d: o.scene2d } : {}) }),
    camera,
    pose,
    capabilities: () => ({ device: 'desktop', local2: true, local2Reason: 'ok' }),
    calibrator: () => createCalibrator({ now: () => 0 }),
    calibrator2: () => createTwoPlayerCalibrator({ now: () => 0 }),
    raf: realtime ? (cb) => requestAnimationFrame(cb) : (cb) => { const id = ++rafSeq; raf.set(id, () => cb(fake)); return id; },
    cancelRaf: realtime ? (id) => cancelAnimationFrame(id) : (id) => { raf.delete(id); },
    now,
    doc: realtime ? undefined : Object.assign(new EventTarget(), { hidden: false }),
    seed: () => o.seed ?? 42,
    countdownMs: o.countdownMs ?? 600,
    wakeLock: null,
    flags: () => ({ reducedMotion: false, silent: o.quiet === true }),
    extraSources: ['test'],
  });

  const seen: Chain['seen'] = { states: [], pauses: [], over: [], errors: [], countdown: [], calibration: 0 };
  session.on('state', (s) => seen.states.push(s));
  session.on('pause', (r) => seen.pauses.push(r));
  session.on('over', (s) => seen.over.push(s));
  session.on('error', (e) => seen.errors.push(e));
  session.on('countdown', (c) => seen.countdown.push(c.remaining));
  session.on('calibration', () => { seen.calibration++; });

  function frame(t: number): PoseFrame {
    const aspect = (o.people[0] as ChainPerson).shape.aspect;
    const poses = o.people.filter((p) => p.present?.() !== false).map((p) => {
      const lm = landmarksOf(p.body(t, game, session.state), p.shape);
      return lm ? lm.map((l) => ({ ...l, x: l.x + (gaussian(rng) * noise) / aspect, y: l.y + gaussian(rng) * noise })) : null;
    }).filter((l): l is NonNullable<typeof l> => l !== null);
    const f: PoseFrame = { seq: seq++, t, landmarks: poses[0] ?? null, inferenceMs: 30, source: 'camera', aspect };
    if (o.people.length > 1) f.poses = poses;
    return f;
  }

  function emitPose(t: number): void {
    if (t - lastPoseT < 1000 / hz - 1e-9) return;
    lastPoseT = t;
    if (!attached) return;
    const f = frame(t);
    for (const cb of [...listeners]) cb(f);
  }

  const chain: Chain = {
    session,
    game: () => game,
    ctx: () => ctx,
    seen,
    now,
    hudLog, plates, sounds,
    async start() {
      const opts: SessionOptions = { mode: o.mode, difficulty: o.difficulty ?? 'normal', input: 'camera', seated: o.seated ?? false, ...(o.world ? { world: o.world } : {}) };
      await session.start(o.module.manifest.id, opts);
    },
    pass(ms) {
      if (realtime) throw new Error('pass() is for the fake clock; the page runs in real time.');
      const end = fake + ms;
      while (fake < end - 1e-9) {
        fake = Math.min(end, fake + 1000 / 60);
        emitPose(fake);
        const due = [...raf.values()];
        raf.clear();
        for (const cb of due) cb();
      }
    },
    until(done, maxMs) {
      const end = fake + maxMs;
      while (!done() && fake < end) chain.pass(1000 / 60);
      return done();
    },
    pump() {
      if (!realtime || pumping) return;
      pumping = true;
      const loop = (): void => {
        if (!pumping) return;
        emitPose(performance.now());
        timer = requestAnimationFrame(loop);
      };
      timer = requestAnimationFrame(loop);
    },
    stop() { pumping = false; if (timer) cancelAnimationFrame(timer); session.quit(); },
  };
  return chain;
}
