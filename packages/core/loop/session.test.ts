// Session state machine: keyboard and camera runs, pauses and their reasons, B8, B9, B10, B12, local2, duel.
import { describe, expect, it } from 'vitest';
import type {
  AudioApi, CameraAcquireOptions, CameraErrorCode, CameraLease, CameraService, FrameSource, Game, GameContext, GameManifest,
  CalibrationStatus, DetectorSpec, GameMode, GameModule, InputEvent, InputFrame, LightGrid, PauseReason, PoseFrame, PoseLoadOptions, PoseService, SessionEvents,
  SessionOptions, SessionState, StartOptions,
} from '../types/index.ts';
import { FIXED_DT } from '../types/index.ts';
import { abortError, CameraError } from '../camera/camera.ts';
import { createCalibrator } from '../body/calibrator.ts';
import { createTwoPlayerCalibrator } from '../body/calibrator2.ts';
import { createPoseFeed } from '../input/pose-feed.ts';
import { jumpAt, synthPose, type BodyShape, type Motion } from '../pose/synth.ts';
import { gaussian, mulberry32 } from './rng.ts';
import { createSession } from './session.ts';

// ---- fakes ----

class FakeLease implements CameraLease {
  readonly kind = 'video' as const;
  readonly video = {} as HTMLVideoElement;
  readonly stream = {} as MediaStream;
  readonly info = { width: 640, height: 360 };
  alive = true;
  released = false;
  private ended = new Set<() => void>();
  async start(): Promise<void> {}
  stop(): void {}
  release(): void { this.alive = false; this.released = true; }
  onEnded(cb: () => void): () => void { this.ended.add(cb); return () => { this.ended.delete(cb); }; }
  /** The webcam is unplugged (B8). */
  end(): void { this.alive = false; for (const cb of [...this.ended]) cb(); }
}

function fakeCamera() {
  const leases: FakeLease[] = [];
  const signals: AbortSignal[] = [];
  const cam = {
    hold: false,
    failWith: null as CameraErrorCode | null,
    leases,
    signals,
    async acquire(o?: CameraAcquireOptions): Promise<CameraLease> {
      if (o?.signal) signals.push(o.signal);
      if (cam.hold) {
        await new Promise<void>((_res, rej) => {
          if (o?.signal?.aborted) rej(abortError());
          o?.signal?.addEventListener('abort', () => rej(abortError()));
        });
      }
      if (cam.failWith) throw new CameraError(cam.failWith, `camera: ${cam.failWith}`);
      const l = new FakeLease();
      leases.push(l);
      return l;
    },
    stats() {
      const released = leases.filter((l) => l.released).length;
      return { acquired: leases.length, released, live: leases.length - released };
    },
  } satisfies CameraService & Record<string, unknown>;
  return cam;
}

function fakePose() {
  const cbs = new Set<(f: PoseFrame) => void>();
  const p = {
    loads: [] as PoseLoadOptions[],
    numPoses: [] as number[],
    attached: null as FrameSource | null,
    loaded: false,
    async load(o: PoseLoadOptions) { p.loads.push(o); await Promise.resolve(); p.loaded = true; return { delegate: 'CPU' as const, worker: true, loadMs: 1 }; },
    async warmUp() {},
    attach(src: FrameSource) {
      if (src.kind === 'video' && !p.loaded) throw new Error('Call load() before attaching a camera.');
      p.attached = src;
    },
    detach() { p.attached = null; },
    onFrame(cb: (f: PoseFrame) => void) { cbs.add(cb); return () => { cbs.delete(cb); }; },
    setMaxHz() {},
    async setNumPoses(n: 1 | 2) {
      p.numPoses.push(n);
      if (!p.holdSwitch) return;
      // the model rebuilds for the new number of poses: no frame comes out until it is done (WebKit, a GPU delegate)
      p.switching = true;
      await new Promise<void>((resolve) => { p.finishSwitch = () => { p.switching = false; p.finishSwitch = () => {}; resolve(); }; });
    },
    /** setNumPoses() holds until finishSwitch() is called, and no frame comes out meanwhile. */
    holdSwitch: false,
    switching: false,
    finishSwitch: () => {},
    stats: { hz: 0, p50: 0, p95: 0, dropped: 0, frames: 0 },
    dispose() {},
    /** The camera picture freezes (iPhone: track muted) when true: no frames reach the session. */
    frozen: false,
    emit(f: PoseFrame) { if (p.attached && !p.frozen && !p.switching) for (const cb of [...cbs]) cb(f); },
    get listeners() { return cbs.size; },
  };
  return p satisfies PoseService & Record<string, unknown>;
}

interface GameLog {
  inits: number; starts: StartOptions[]; steps: number; dts: Set<number>; renders: number; disposed: number;
  events: InputEvent[]; frames: InputFrame[]; ctx: GameContext | null; course: number[];
}

function fakeGame(o: { modes?: GameMode[]; overAfter?: number; controls?: GameModule['controls']; manifest?: Partial<GameManifest>; detectorsFor?: (seated: boolean) => DetectorSpec[] } = {}) {
  const log: GameLog = { inits: 0, starts: [], steps: 0, dts: new Set(), renders: 0, disposed: 0, events: [], frames: [], ctx: null, course: [] };
  const manifest: GameManifest = {
    id: 'fake', template: 'runner', version: 1, title: 'Fake', regions: ['legs'], framing: 'full', seated: false, lowImpact: false,
    silentSafe: true, durationSec: 10, met: 5, detectors: [{ id: 'jump' }, { id: 'squat' }, { id: 'lean' }], free: true,
    modes: o.modes ?? ['solo', 'local2', 'duel'], seo: { slug: 'fake', keywords: [] },
    ...o.manifest,
  };
  const games: Game[] = [];
  const module: GameModule = {
    manifest,
    ...(o.controls ? { controls: o.controls } : {}),
    create(): Game {
      const g: Game = {
        manifest,
        async init(ctx) { log.inits++; log.ctx = ctx; },
        start(s) {
          log.starts.push(s);
          // a game that chooses its detectors for the way it is played writes them into the manifest the session reads
          if (o.detectorsFor) manifest.detectors = o.detectorsFor(s.seated);
        },
        step(dt, input) {
          log.steps++;
          log.dts.add(dt);
          log.events.push(...input.events);
          log.frames.push(input);
          if (log.steps % 30 === 0) log.course.push(log.ctx!.rng('course')());
          return { events: [], phase: o.overAfter && log.steps >= o.overAfter ? 'over' : 'running' };
        },
        render() { log.renders++; },
        snapshot: () => ({}),
        restore() {},
        summary: () => ({ score: log.steps, seconds: log.steps * FIXED_DT, metSeconds: 0, log: [] }),
        dispose() { log.disposed++; },
      };
      games.push(g);
      return g;
    },
  };
  return { module, log, games };
}

const UI = {
  hud: { set() {}, announce() {}, toast() {} },
  audio: { unlock() {}, play() {}, clock: () => ({}) } as unknown as AudioApi,
  store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
  t: (k: string) => k,
};

const ASPECT = 16 / 9;
const shape = (cx: number): BodyShape => ({ cx, hipY: 0.55, T: 0.18, W: 0.14, aspect: ASPECT });

interface Person { cx: number; present: boolean; motion?: Motion }

interface HarnessOptions {
  modes?: GameMode[]; overAfter?: number; local2?: boolean; people?: Person[]; controls?: GameModule['controls'];
  /** Changes to the fake game's manifest (a seated variant, headroom). */
  manifest?: Partial<GameManifest>;
  /** Changes to where the people stand (a desk: head and shoulders only). */
  shape?: Partial<BodyShape>;
  /** The brightness map that rides on the pose frames. */
  light?: (t: number) => LightGrid | undefined;
  /** The shell's scene factory throws this. */
  uiFails?: string;
  /** The game chooses its movement detectors by how it is played: it writes them into its manifest in start(). */
  detectorsFor?: (seated: boolean) => DetectorSpec[];
}

function harness(o: HarnessOptions = {}) {
  let t = 1000;
  const raf = new Map<number, () => void>();
  let rafSeq = 0;
  const cam = fakeCamera();
  const pose = fakePose();
  const game = fakeGame(o);
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const keys = new EventTarget();
  /** The screen wake lock: how many were asked for and how many are held now. */
  const wake = { asked: 0, held: 0, fail: false, sentinels: [] as { release(): Promise<void>; drop(): void }[] };
  const people: Person[] = o.people ?? [{ cx: 0.5, present: true }];
  /** The detector ids every call of PoseFeed.use gave the movement engines. */
  const uses: string[][] = [];
  const rng = mulberry32(5);
  let seq = 0;
  let lastPoseT = -Infinity;
  const session = createSession({
    games: (id) => (id === 'fake' ? game.module : null),
    ui: () => { if (o.uiFails) throw new Error(o.uiFails); return UI; },
    camera: cam,
    pose,
    capabilities: () => ({ device: 'desktop', local2: o.local2 ?? true, local2Reason: o.local2 === false ? 'phone' : 'ok' }),
    calibrator: () => createCalibrator({ now: () => 0 }),
    calibrator2: () => createTwoPlayerCalibrator({ now: () => 0 }),
    feed: (fo) => {
      const f = createPoseFeed(fo);
      const real = f.use.bind(f);
      f.use = (specs) => { uses.push(specs.map((s) => s.id)); real(specs); };
      return f;
    },
    raf: (cb) => { const id = ++rafSeq; raf.set(id, () => cb(t)); return id; },
    cancelRaf: (id) => { raf.delete(id); },
    now: () => t,
    doc,
    seed: () => 42,
    extraSources: ['test'],
    keyTarget: keys,
    wakeLock: async () => {
      wake.asked++;
      if (wake.fail) throw new Error('NotAllowedError');
      const cbs: (() => void)[] = [];
      let released = false;
      const sentinel = {
        release: async () => { if (!released) { released = true; wake.held--; } },
        addEventListener: (_t: 'release', cb: () => void) => { cbs.push(cb); },
        /** The browser drops the lock (page hidden). */
        drop: () => { if (!released) { released = true; wake.held--; cbs.forEach((cb) => cb()); } },
      };
      wake.held++;
      wake.sentinels.push(sentinel);
      return sentinel;
    },
  });
  const seen: { states: SessionState[]; pauses: PauseReason[]; countdown: number[]; over: SessionEvents['over'][]; errors: SessionEvents['error'][]; players: SessionEvents['player'][]; fps: number[] } =
    { states: [], pauses: [], countdown: [], over: [], errors: [], players: [], fps: [] };
  session.on('state', (s) => seen.states.push(s));
  session.on('pause', (r) => seen.pauses.push(r));
  session.on('countdown', (c) => seen.countdown.push(c.remaining));
  session.on('over', (s) => seen.over.push(s));
  session.on('error', (e) => seen.errors.push(e));
  session.on('player', (p) => seen.players.push(p));
  session.on('frame', (f) => seen.fps.push(f.fps));

  function poseFrame(): PoseFrame {
    const poses = people.filter((p) => p.present).map((p) => synthPose({ ...shape(p.cx), ...o.shape }, p.motion?.(t) ?? {}).map((l) => ({ ...l, x: l.x + gaussian(rng) * 0.001, y: l.y + gaussian(rng) * 0.001 })));
    const f: PoseFrame = { seq: seq++, t, landmarks: poses[0] ?? null, inferenceMs: 30, source: 'camera', aspect: ASPECT };
    if (people.length > 1) f.poses = poses;
    const light = o.light?.(t);
    if (light) f.light = light;
    return f;
  }

  /** Lets `ms` of time pass in display frames of `frameMs`; pose frames come at 30 Hz. */
  function pass(ms: number, frameMs = 1000 / 60): void {
    const end = t + ms;
    while (t < end - 1e-9) {
      t = Math.min(end, t + frameMs);
      if (t - lastPoseT >= 1000 / 30 - 1e-9) { lastPoseT = t; pose.emit(poseFrame()); }
      const due = [...raf.values()];
      raf.clear();
      for (const cb of due) cb();
    }
  }

  /** Until the state is `s` (at most `ms`). */
  function until(s: SessionState, ms = 10_000): void {
    const end = t + ms;
    while (session.state !== s && t < end) pass(1000 / 60);
    expect(session.state).toBe(s);
  }

  /** Presses a key on the page; true when the session's bindings took it (default prevented). */
  function press(k: string): boolean {
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key: k, repeat: false, metaKey: false, ctrlKey: false, altKey: false });
    keys.dispatchEvent(e);
    keys.dispatchEvent(Object.assign(new Event('keyup'), { key: k }));
    return e.defaultPrevented;
  }

  return { session, cam, pose, game, doc, people, seen, pass, until, press, wake, uses, get rafPending() { return raf.size; }, get now() { return t; } };
}

const KEYS: SessionOptions = { mode: 'solo', difficulty: 'normal', input: 'keyboard', seated: false };
const CAMERA: SessionOptions = { mode: 'solo', difficulty: 'normal', input: 'camera', seated: false };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---- tests ----

describe('Session, keyboard run', () => {
  it('setup, countdown 3-2-1-0, running with FIXED_DT steps, results with the summary; no camera is touched', async () => {
    const h = harness({ overAfter: 120 });
    await h.session.start('fake', KEYS);
    expect(h.seen.states).toEqual(['setup', 'countdown']);
    h.pass(2990);
    expect(h.game.log.steps).toBe(0);
    h.until('results', 4000);
    expect(h.seen.states).toEqual(['setup', 'countdown', 'running', 'results']);
    expect(h.seen.countdown).toEqual([3, 2, 1, 0]);
    expect([...h.game.log.dts]).toEqual([FIXED_DT]);
    expect(h.game.log.steps).toBe(120);
    expect(h.seen.over).toEqual([{ score: 120, seconds: 2, metSeconds: 0, log: [] }]);
    expect(h.game.log.starts).toEqual([{ seed: 42, difficulty: 'normal', seated: false, mode: 'solo', profile: null }]);
    expect(h.cam.stats().acquired).toBe(0);
    expect(h.pose.loads).toEqual([]);
    expect(h.rafPending).toBe(0);
  });

  it('input reaches the game once, stamped with simulation time; sources follow the mode (pose not allowed without a camera)', async () => {
    const h = harness();
    await h.session.start('fake', KEYS);
    h.until('running');
    const input = h.game.log.ctx!.input;
    expect(input.allowed('keyboard') && input.allowed('touch') && input.allowed('test')).toBe(true);
    expect(input.allowed('pose')).toBe(false);
    input.inject('keyboard', { events: [{ id: 'jump', kind: 'rep', t: 0 }] });
    h.pass(100);
    expect(h.game.log.events.map((e) => [e.id, e.source])).toEqual([['jump', 'keyboard']]);
    const ts = h.game.log.frames.map((f) => f.t);
    expect(ts.slice(0, 3)).toEqual([1000 / 60, 2000 / 60, 3000 / 60]);
  });

  it('same seed, same frames: the same course from ctx.rng', async () => {
    const run = async () => {
      const h = harness({ overAfter: 300 });
      await h.session.start('fake', KEYS);
      h.until('results', 10_000);
      return h.game.log.course;
    };
    const a = await run();
    expect(a.length).toBe(10);
    expect(await run()).toEqual(a);
  });

  it('a slow device slows the game down instead of skipping: at most 3 steps per frame', async () => {
    const h = harness();
    await h.session.start('fake', KEYS);
    h.until('running');
    const before = h.game.log.steps;
    h.pass(1000, 100); // 10 fps
    expect(h.game.log.steps - before).toBe(30);
  });

  it('pause stops the loop entirely (B12); resume counts down again; the paused time gives no burst of steps', async () => {
    const h = harness();
    await h.session.start('fake', KEYS);
    h.until('running');
    h.pass(500);
    h.session.pause('user');
    expect(h.session.state).toBe('paused');
    expect(h.session.pauseReason).toBe('user');
    const { steps, renders } = h.game.log;
    h.pass(5000);
    expect([h.game.log.steps, h.game.log.renders, h.rafPending]).toEqual([steps, renders, 0]);
    await h.session.resume();
    expect(h.session.state).toBe('countdown');
    h.until('running');
    h.pass(1000 / 60);
    expect(h.game.log.steps - steps).toBeLessThanOrEqual(1);
    expect(h.game.log.starts.length).toBe(1);
  });

  it("the game's keys are bound only while counting down and playing; on pause and results they work the page again", async () => {
    const h = harness({ overAfter: 400, controls: { keys: { ' ': { event: 'jump' }, ArrowLeft: { channel: 'lane', value: -1 } } } });
    expect(h.press(' ')).toBe(false);
    await h.session.start('fake', KEYS);
    expect(h.press(' ')).toBe(true);           // countdown: bound, but the event never reaches the game
    h.until('running');
    expect(h.press(' ')).toBe(true);
    h.pass(50);
    expect(h.game.log.events.map((e) => [e.id, e.source])).toEqual([['jump', 'keyboard']]);
    h.session.pause('user');
    expect(h.press(' ')).toBe(false);
    await h.session.resume();
    expect(h.press('ArrowLeft')).toBe(true);
    h.until('results', 10_000);
    expect(h.press(' ')).toBe(false);
  });

  it('the screen stays on from the countdown to the results, not on a pause by hand; a failing wake lock is harmless', async () => {
    const h = harness({ overAfter: 200 });
    await h.session.start('fake', KEYS);
    await flush();
    expect(h.wake).toMatchObject({ asked: 1, held: 1 });
    h.until('running');
    h.session.pause('user');
    await flush();
    expect(h.wake.held).toBe(0);
    await h.session.resume();
    await flush();
    expect(h.wake).toMatchObject({ asked: 2, held: 1 });
    h.until('results', 10_000);
    await flush();
    expect(h.wake.held).toBe(0);
    const h2 = harness();
    h2.wake.fail = true;
    await h2.session.start('fake', KEYS);
    await flush();
    h2.until('running');
    expect(h2.seen.errors).toEqual([]);
  });

  it('a hidden tab pauses with reason hidden and stays paused when visible again', async () => {
    const h = harness();
    await h.session.start('fake', KEYS);
    h.until('running');
    h.doc.hidden = true;
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.session.pauseReason).toBe('hidden');
    h.doc.hidden = false;
    h.doc.dispatchEvent(new Event('visibilitychange'));
    h.pass(1000);
    expect(h.session.state).toBe('paused');
  });

  it('quit() disposes the game and goes idle; start() again makes a new game (B5)', async () => {
    const h = harness();
    await h.session.start('fake', KEYS);
    h.until('running');
    h.session.quit();
    expect(h.session.state).toBe('idle');
    expect(h.game.log.disposed).toBe(1);
    await h.session.start('fake', KEYS);
    expect(h.game.games.length).toBe(2);
    h.session.quit();
    expect(h.game.log.disposed).toBe(2);
  });

  it('errors: unknown game, a mode the game does not list, duel or local2 without the camera', async () => {
    const h = harness({ modes: ['solo'] });
    await h.session.start('nope', KEYS);
    await h.session.start('fake', { ...KEYS, mode: 'ghost' });
    const h2 = harness();
    await h2.session.start('fake', { ...KEYS, mode: 'duel' });
    await h2.session.start('fake', { ...KEYS, mode: 'local2' });
    expect(h.seen.errors.map((e) => e.code)).toEqual(['game_not_found', 'mode_unavailable']);
    expect(h2.seen.errors.map((e) => e.code)).toEqual(['camera_required', 'camera_required']);
    expect(h2.session.state).toBe('error');
  });
});

describe('Session, camera run', () => {
  it('acquires, loads the model, calibrates, counts down and plays; pose events reach the game; results release the camera (B10)', async () => {
    const h = harness({ people: [{ cx: 0.5, present: true }] });
    const calib: number[] = [];
    h.session.on('calibration', (c) => calib.push(c.progress));
    const videos: (HTMLVideoElement | null)[] = [];
    h.session.on('video', (v) => videos.push(v.el));
    await h.session.start('fake', CAMERA);
    expect(h.session.state).toBe('calibrating');
    expect(h.pose.loads.map((l) => l.numPoses)).toEqual([1]);
    expect(h.pose.loads[0]!.modelUrl).toMatch(/pose_landmarker_lite/);
    expect(h.cam.signals.length).toBe(1);
    h.until('countdown', 4000);
    expect(calib.at(-1)).toBe(1);
    expect(h.game.log.starts[0]!.profile).not.toBeNull();
    h.until('running', 4000);
    const ctx = h.game.log.ctx!;
    expect(['pose', 'keyboard', 'touch'].every((s) => ctx.input.allowed(s as 'pose'))).toBe(true);
    const t0 = h.now;
    h.people[0]!.motion = jumpAt(t0 + 300);
    h.pass(1500);
    expect(h.game.log.events.map((e) => [e.id, e.source])).toEqual([['jump', 'pose']]);
    expect(h.cam.stats().live).toBe(1);
    // The run ends: the camera is released at once.
    h.game.log.ctx!.input.inject('test', {});
    (h.game.games[0] as Game).step = () => ({ events: [], phase: 'complete' });
    h.pass(100);
    expect(h.session.state).toBe('results');
    expect(h.cam.stats()).toEqual({ acquired: 1, released: 1, live: 0 });
    expect(videos).toEqual([h.cam.leases[0]!.video, null]);
    expect(h.pose.attached).toBeNull();
    expect(h.pose.listeners).toBe(0);
  });

  it('the browser drops the wake lock when the page is hidden; it is asked for again when the page is back', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    await flush();
    expect(h.session.state).toBe('calibrating');
    h.doc.hidden = true;
    h.wake.sentinels[0]!.drop();
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.wake.held).toBe(0);
    h.doc.hidden = false;
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(h.wake).toMatchObject({ asked: 2, held: 1 });
    h.session.quit();
    await flush();
    expect(h.wake.held).toBe(0);
  });

  it('quit() during the permission prompt leaves no camera on (B9)', async () => {
    const h = harness();
    h.cam.hold = true;
    const p = h.session.start('fake', CAMERA);
    await flush();
    expect(h.session.state).toBe('setup');
    h.session.quit();
    await p;
    expect(h.cam.signals[0]!.aborted).toBe(true);
    expect(h.cam.stats()).toEqual({ acquired: 0, released: 0, live: 0 });
    expect(h.session.state).toBe('idle');
    expect(h.seen.errors).toEqual([]);
    expect(h.game.log.disposed).toBe(1);
  });

  it('a refused camera is an error with its own code', async () => {
    const h = harness();
    h.cam.failWith = 'denied';
    await h.session.start('fake', CAMERA);
    expect(h.session.state).toBe('error');
    expect(h.seen.errors.map((e) => e.code)).toEqual(['denied']);
  });

  it('the person leaves: paused (person_lost) after 500 ms; back: calibrates again, counts down, plays on', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    await flush();
    expect(h.wake.held).toBe(1);                // calibrating: the player is away from the screen
    h.until('running', 6000);
    h.people[0]!.present = false;
    h.pass(450);
    expect(h.session.state).toBe('running');
    h.pass(200);
    expect(h.session.state).toBe('paused');
    expect(h.session.pauseReason).toBe('person_lost');
    await flush();
    expect(h.wake.held).toBe(1);                // waiting for the player to come back: the screen stays on
    const steps = h.game.log.steps;
    h.pass(3000);
    expect(h.game.log.steps).toBe(steps);
    h.people[0]!.present = true;
    h.pass(100);
    expect(h.session.state).toBe('calibrating');
    h.until('running', 6000);
    expect(h.game.log.starts.length).toBe(1);
  });

  it('pausing by hand while the person is away stops the automatic resume', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    h.until('running', 6000);
    h.people[0]!.present = false;
    h.pass(700);
    h.session.pause('user');
    expect(h.session.pauseReason).toBe('user');
    h.people[0]!.present = true;
    h.pass(1000);
    expect(h.session.state).toBe('paused');
    await h.session.resume();
    expect(h.session.state).toBe('calibrating');
  });

  it('the camera dies mid-run (B8): paused with camera_ended; resume() acquires a new lease, calibrates and continues', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    h.until('running', 6000);
    h.session.pause('user');
    h.cam.leases[0]!.end();
    expect(h.session.pauseReason).toBe('camera_ended');
    expect(h.game.log.ctx!.input.sample(0).tracking).toEqual({ ok: false, code: 'camera_ended' });
    await h.session.resume();
    expect(h.cam.stats()).toEqual({ acquired: 2, released: 1, live: 1 });
    expect(h.session.state).toBe('calibrating');
    expect(h.pose.attached).toBe(h.cam.leases[1]);
    h.until('running', 6000);
    expect(h.game.log.starts.length).toBe(1);
    h.session.quit();
    expect(h.cam.stats().live).toBe(0);
  });

  it('a camera that stops sending pictures without ending (muted track) pauses as camera_ended after 2.5 s; resume asks for it again', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    h.until('running', 6000);
    await flush();   // the model's switch back to one pose (after the calibration) has answered
    h.pass(100);     // and a frame came after it
    h.pose.frozen = true;
    h.pass(2400);
    expect(h.session.state).toBe('running');
    h.pass(200);
    expect(h.session.pauseReason).toBe('camera_ended');
    expect(h.game.log.ctx!.input.sample(0).tracking).toEqual({ ok: false, code: 'stalled' });
    expect(h.cam.stats()).toEqual({ acquired: 1, released: 1, live: 0 });
    h.pose.frozen = false;
    await h.session.resume();
    expect(h.cam.stats()).toEqual({ acquired: 2, released: 1, live: 1 });
    h.until('running', 6000);
    expect(h.game.log.starts.length).toBe(1);
  });

  it('the watchdog also covers calibration, but gives a new camera time for its first (cold) frame', async () => {
    const h = harness();
    h.pose.frozen = true;
    await h.session.start('fake', CAMERA);
    h.pass(10_000);
    expect(h.session.state).toBe('calibrating');
    h.pass(2500);
    expect(h.session.pauseReason).toBe('camera_ended');
  });

  it('the model going back to one pose after the calibration is not a stopped camera (WebKit on a phone, QA 25 Oct): no frame for seconds while it switches', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    expect(h.pose.numPoses).toEqual([1, 2]);
    h.pose.holdSwitch = true;
    h.until('countdown', 6000);
    expect(h.pose.numPoses).toEqual([1, 2, 1]);
    expect(h.pose.switching).toBe(true);
    h.pass(8000);   // the switch takes 8 s: the countdown ends and the round runs, with no frame at all
    expect(h.session.state).toBe('running');
    expect(h.seen.pauses).toEqual([]);
    expect(h.cam.stats().live).toBe(1);
    h.pose.finishSwitch();
    await flush();
    h.pass(1000);
    expect(h.session.state).toBe('running');
    expect(h.seen.pauses).toEqual([]);
    // once the switch is done and frames come again, a camera that really stops is said within the usual 2.5 s
    h.pose.frozen = true;
    h.pass(2600);
    expect(h.session.pauseReason).toBe('camera_ended');
    expect(h.game.log.ctx!.input.sample(0).tracking).toEqual({ ok: false, code: 'stalled' });
  });

  it('a switch of the model that never ends is still caught: after the first-frame time (12 s), not never', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    h.pose.holdSwitch = true;
    h.until('countdown', 6000);
    h.pass(11_000);
    expect(h.session.state).toBe('running');
    h.pass(1500);
    expect(h.session.pauseReason).toBe('camera_ended');
    expect(h.cam.stats().live).toBe(0);
  });

  it('recalibrate() mid-run keeps a live lease, calibrates and continues', async () => {
    const h = harness();
    await h.session.start('fake', CAMERA);
    h.until('running', 6000);
    await h.session.recalibrate();
    expect(h.seen.pauses).toEqual(['recalibrate']);
    expect(h.session.state).toBe('calibrating');
    expect(h.cam.stats().acquired).toBe(1);
    h.until('running', 6000);
  });

  it('"Run again" acquires a new lease; the old game is disposed first', async () => {
    const h = harness({ overAfter: 60 });
    await h.session.start('fake', CAMERA);
    h.until('results', 8000);
    expect(h.cam.stats().live).toBe(0);
    await h.session.start('fake', CAMERA);
    expect(h.game.log.disposed).toBe(1);
    expect(h.cam.stats()).toEqual({ acquired: 2, released: 1, live: 1 });
    expect(h.pose.loads.length).toBe(1);
  });

  it('duel accepts pose only, even with test sources configured', async () => {
    const h = harness();
    await h.session.start('fake', { ...CAMERA, mode: 'duel' });
    const input = h.game.log.ctx!.input;
    expect(['keyboard', 'touch', 'test', 'trace'].some((s) => input.allowed(s as 'pose'))).toBe(false);
    expect(input.allowed('pose')).toBe(true);
  });
});

describe("Session, mode 'local2'", () => {
  const two = (): Person[] => [{ cx: 0.72, present: true }, { cx: 0.28, present: true }];

  it('needs Capabilities.local2: off on phones and in the Android app', async () => {
    const h = harness({ local2: false, people: two() });
    await h.session.start('fake', { ...CAMERA, mode: 'local2' });
    expect(h.seen.errors.map((e) => e.code)).toEqual(['local2_unavailable']);
    expect(h.cam.stats().acquired).toBe(0);
  });

  it('two people: numPoses 2, both calibrated, the game gets both profiles and both streams', async () => {
    const h = harness({ people: two() });
    await h.session.start('fake', { ...CAMERA, mode: 'local2' });
    expect(h.pose.numPoses.at(-1)).toBe(2);
    expect(h.pose.loads[0]!.numPoses).toBe(2);
    h.until('countdown', 4000);
    const s = h.game.log.starts[0]!;
    expect(Object.keys(s.profiles ?? {})).toEqual(['1', '2']);
    expect(s.profile).toBe(s.profiles![1]);
    h.until('running', 4000);
    h.people[1]!.motion = jumpAt(h.now + 300);
    h.pass(1500);
    const p2 = h.game.log.frames.flatMap((f) => f.players![2].events.map((e) => [e.id, e.player]));
    const p1 = h.game.log.frames.flatMap((f) => f.players![1].events.map((e) => e.id));
    expect(p2).toEqual([['jump', 2]]);
    expect(p1).toEqual([]);
  });

  it('Player 2 steps out: player event and pause player_lost; back in: player event, calibration, play on', async () => {
    const h = harness({ people: two() });
    await h.session.start('fake', { ...CAMERA, mode: 'local2' });
    h.until('running', 6000);
    h.people[1]!.present = false;
    h.pass(800);
    expect(h.session.pauseReason).toBe('player_lost');
    expect(h.seen.players).toEqual([{ player: 2, present: false }]);
    h.people[1]!.present = true;
    h.pass(200);
    expect(h.seen.players).toEqual([{ player: 2, present: false }, { player: 2, present: true }]);
    expect(h.session.state).toBe('calibrating');
    h.until('running', 6000);
  });
});

// ---- the easy calibration of 24 Oct: profiles, the desk, light, a crowd, the hands overhead, words ----

/** Head and shoulders fill the picture, the hips and below are under its bottom edge (a person at a laptop). */
const DESK: Partial<BodyShape> = { hipY: 1.5, T: 0.95, W: 0.65 };
/** Closer than the hands-up check can use: the shoulders sit at y 0.22 and the hands go past the top edge. */
const CLOSE: Partial<BodyShape> = { hipY: 0.52, T: 0.3, W: 0.24 };
const grid = (v: number): LightGrid => ({ cols: 16, rows: 12, luma: new Array<number>(192).fill(v) });
const armsAfter = (ms: number) => (t: number) => (t > ms ? { armsUp: 1 } : {});

describe('Session, calibration profiles', () => {
  const upperOnly = { full: false, upper: true, seated: true, side: false };

  it('standing in full view: the profile event says measured, and every kind of game is supported', async () => {
    const h = harness();
    const events: SessionEvents['profile'][] = [];
    h.session.on('profile', (e) => events.push(e));
    await h.session.start('fake', CAMERA);
    h.until('countdown', 6000);
    expect(events).toEqual([{ profile: 'full', outcome: 'measured', seated: false, supports: { full: true, upper: true, seated: true, side: false } }]);
    expect(h.game.log.starts[0]).toMatchObject({ seated: false });
    expect(h.game.log.starts[0]!.profile).toMatchObject({ kind: 'full' });
    expect(h.game.log.starts[0]!.profile!.hipsEstimated).toBeUndefined();
  });

  it('at a desk, a full-body game with a seated variant waits about 3.5 s, then plays the seated variant (desk mode) with the desk profile', async () => {
    const h = harness({ manifest: { seated: true }, shape: DESK });
    const events: SessionEvents['profile'][] = [];
    const cal: CalibrationStatus[] = [];
    h.session.on('profile', (e) => events.push(e));
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', CAMERA);
    const t0 = h.now;
    h.until('countdown', 8000);
    expect(h.now - t0).toBeGreaterThanOrEqual(3400);
    expect(h.now - t0).toBeLessThan(4400);
    expect(events).toEqual([{ profile: 'upper', outcome: 'fallback', seated: true, supports: upperOnly }]);
    expect(h.game.log.starts[0]).toMatchObject({ seated: true, mode: 'solo' });
    expect(h.game.log.starts[0]!.profile).toMatchObject({ kind: 'upper', framing: 'upper', hipsEstimated: true });
    expect(h.game.log.ctx!.flags.seated).toBe(true);
    // while it waited the screen had something to say: a code, the measured advice, the profile it can already run, the time left
    const waiting = cal.filter((c) => !c.ready && c.samples > 20);
    expect(waiting.length).toBeGreaterThan(30);
    for (const c of waiting) {
      expect(c.hint).toMatchObject({ action: 'step_back' });
      expect(c.supports).toEqual(upperOnly);
      expect(c.fallbackInMs).toBeGreaterThanOrEqual(0);
    }
    // and the game then runs: the desk player is not lost for having no hips in view
    h.until('running', 4000);
    h.pass(2000);
    expect(h.session.state).toBe('running');
  });

  it('"play at the desk" ends the wait at once with the desk profile', async () => {
    const h = harness({ manifest: { seated: true }, shape: DESK });
    const events: SessionEvents['profile'][] = [];
    h.session.on('profile', (e) => events.push(e));
    await h.session.start('fake', CAMERA);
    h.pass(1500);
    expect(h.session.state).toBe('calibrating');
    h.session.playAtDesk!();
    expect(h.session.state).toBe('countdown');
    expect(events).toEqual([{ profile: 'upper', outcome: 'fallback', seated: true, supports: upperOnly }]);
    expect(h.game.log.starts[0]).toMatchObject({ seated: true });
  });

  it('"play at the desk" before there is a steady spell does nothing yet; the player is not failed', async () => {
    const h = harness({ manifest: { seated: true }, shape: DESK });
    await h.session.start('fake', CAMERA);
    h.pass(100);
    h.session.playAtDesk!();
    expect(h.session.state).toBe('calibrating');
    expect(h.seen.errors).toEqual([]);
    h.pass(600);
    h.session.playAtDesk!();   // pressed again a moment later: it takes
    expect(h.session.state).toBe('countdown');
  });

  it('a game without a seated variant is never taken at the desk: it waits, asks the screen to offer another way after 12 s, and play-at-desk does nothing', async () => {
    const h = harness({ manifest: { seated: false }, shape: DESK });
    const cal: CalibrationStatus[] = [];
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', CAMERA);
    h.pass(11_000);
    expect(h.session.state).toBe('calibrating');
    expect(cal.at(-1)!.escape).toBeUndefined();
    h.pass(1500);
    expect(cal.at(-1)!.escape).toBe(true);
    expect(cal.at(-1)!.fallbackInMs).toBeUndefined();
    h.session.playAtDesk!();
    expect(h.session.state).toBe('calibrating');
    expect(h.seen.errors).toEqual([]);
  });

  it('a game played seated asks for the upper body only: the desk is the measured profile, not a fallback', async () => {
    const h = harness({ manifest: { seated: true }, shape: DESK });
    const events: SessionEvents['profile'][] = [];
    h.session.on('profile', (e) => events.push(e));
    await h.session.start('fake', { ...CAMERA, seated: true });
    const t0 = h.now;
    h.until('countdown', 6000);
    expect(h.now - t0).toBeLessThan(1500);
    expect(events).toEqual([{ profile: 'upper', outcome: 'measured', seated: true, supports: upperOnly }]);
  });
});

describe('Session, a game that chooses its detectors by how it is played', () => {
  const STAND: DetectorSpec[] = [{ id: 'jump' }, { id: 'squat' }, { id: 'lean' }];
  const SIT: DetectorSpec[] = [{ id: 'lean' }];
  const pick = (seated: boolean): DetectorSpec[] => (seated ? SIT : STAND);

  it('at a desk the calibration turns the run seated: the seated detectors the game wrote in start() reach the engines before the countdown is over', async () => {
    const h = harness({ manifest: { seated: true }, shape: DESK, detectorsFor: pick });
    await h.session.start('fake', CAMERA);
    expect(h.uses).toEqual([['jump', 'squat', 'lean']]);          // from the manifest, before it is known how the run is played
    h.until('countdown', 8000);
    expect(h.uses).toEqual([['jump', 'squat', 'lean'], ['lean']]);
    expect(h.game.log.starts[0]).toMatchObject({ seated: true });
  });

  it('standing in full view: given again, the same standing set', async () => {
    const h = harness({ manifest: { seated: true }, detectorsFor: pick });
    await h.session.start('fake', CAMERA);
    h.until('countdown', 6000);
    expect(h.uses).toEqual([['jump', 'squat', 'lean'], ['jump', 'squat', 'lean']]);
  });

  it('once per run: a pause and a recalibration do not give them again (the way of playing stays)', async () => {
    const h = harness({ manifest: { seated: true }, shape: DESK, detectorsFor: pick });
    await h.session.start('fake', CAMERA);
    h.until('running', 10_000);
    const before = h.uses.length;
    h.session.pause('user');
    await h.session.resume();
    h.until('running', 10_000);
    expect(h.uses.length).toBe(before);
    expect(h.uses.at(-1)).toEqual(['lean']);
  });

  it('a game that does not rewrite its manifest gets the same detectors again, harmlessly', async () => {
    const h = harness({ manifest: { seated: true }, shape: DESK });
    await h.session.start('fake', CAMERA);
    h.until('countdown', 8000);
    expect(h.uses).toEqual([['jump', 'squat', 'lean'], ['jump', 'squat', 'lean']]);
  });
});

describe('Session, calibration with a crowd and with bad light', () => {
  const two = (): Person[] => [{ cx: 0.3, present: true }, { cx: 0.7, present: true }];

  it('one player calibrates with two poses running and plays with one', async () => {
    const h = harness({ people: two().slice(0, 1) });
    await h.session.start('fake', CAMERA);
    expect(h.pose.numPoses).toEqual([1, 2]);
    h.until('countdown', 6000);
    expect(h.pose.numPoses).toEqual([1, 2, 1]);
  });

  it('a second person in view is noticed (many_people), but never blocks for more than a few seconds', async () => {
    const h = harness({ people: two() });
    const cal: CalibrationStatus[] = [];
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', CAMERA);
    const t0 = h.now;
    h.until('countdown', 9000);
    expect(cal.some((c) => c.code === 'many_people' && c.hint?.action === 'one_person')).toBe(true);
    expect(h.now - t0).toBeGreaterThanOrEqual(3500);
    expect(h.now - t0).toBeLessThan(5500);
    expect(h.game.log.starts[0]!.profile).not.toBeNull();
  });

  it('the other person leaving ends it at once', async () => {
    const h = harness({ people: two() });
    await h.session.start('fake', CAMERA);
    h.pass(1500);
    expect(h.session.state).toBe('calibrating');
    const left = h.now;
    h.people[1]!.present = false;
    h.until('countdown', 2000);
    expect(h.now - left).toBeLessThan(1000);
  });

  it('a dark room is said (too_dark, with the advice) and the player is not calibrated on a black picture; light comes, calibration ends', async () => {
    const h = harness({ light: (t) => grid(t < 4000 ? 0.03 : 0.5) });
    const cal: CalibrationStatus[] = [];
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', CAMERA);
    h.pass(2000);
    expect(h.session.state).toBe('calibrating');
    expect(cal.at(-1)).toMatchObject({ code: 'too_dark', hint: { action: 'more_light' } });
    h.until('countdown', 5000);
    expect(cal.some((c) => c.code === 'too_dark')).toBe(true);
    expect(h.now).toBeGreaterThan(4000);
  });
});

describe('Session, a game that raises the hands overhead (manifest headroom)', () => {
  const HEADROOM_GAME = { headroom: 'arms-up' as const, seated: true };

  it('the player raises both hands once: the picture holds them, the profile and the event say ok, the reach height is recorded', async () => {
    const h = harness({ manifest: HEADROOM_GAME, people: [{ cx: 0.5, present: true, motion: armsAfter(2500) }] });
    const events: SessionEvents['profile'][] = [];
    const cal: CalibrationStatus[] = [];
    h.session.on('profile', (e) => events.push(e));
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', CAMERA);
    h.until('countdown', 8000);
    expect(cal.some((c) => c.code === 'raise_hands' && c.hint?.action === 'raise_hands')).toBe(true);
    expect(events).toEqual([{ profile: 'full', outcome: 'measured', seated: false, supports: { full: true, upper: true, seated: true, side: false }, headroom: 'ok' }]);
    const p = h.game.log.starts[0]!.profile!;
    expect(p.headroom).toBe('ok');
    expect(p.reachY).toBeGreaterThan(0);
    expect(p.reachY).toBeLessThan(p.rest.shoulderY);
  });

  it('a player who does not raise them is not held: the countdown starts after the wait, headroom unchecked', async () => {
    const h = harness({ manifest: HEADROOM_GAME });
    const events: SessionEvents['profile'][] = [];
    h.session.on('profile', (e) => events.push(e));
    await h.session.start('fake', CAMERA);
    const t0 = h.now;
    h.until('countdown', 12_000);
    expect(h.now - t0).toBeGreaterThanOrEqual(6500);
    expect(h.now - t0).toBeLessThan(8000);
    expect(events[0]).toMatchObject({ headroom: 'unchecked', outcome: 'measured' });
    expect(h.game.log.starts[0]!.profile!.headroom).toBe('unchecked');
  });

  it('too close for the hands: the code says headroom with the steps back, then the game goes on with headroom short', async () => {
    const h = harness({ manifest: HEADROOM_GAME, shape: CLOSE, people: [{ cx: 0.5, present: true, motion: armsAfter(2500) }] });
    const events: SessionEvents['profile'][] = [];
    const cal: CalibrationStatus[] = [];
    h.session.on('profile', (e) => events.push(e));
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', { ...CAMERA, seated: true });
    h.until('countdown', 12_000);
    const cut = cal.filter((c) => c.code === 'headroom');
    expect(cut.length).toBeGreaterThan(20);
    expect(cut.at(-1)!.hint).toMatchObject({ action: 'step_back' });
    expect(events[0]).toMatchObject({ headroom: 'short' });
    expect(h.game.log.starts[0]!.profile!.reachY).toBeUndefined();
  });

  it('"play on" during the hands step starts the countdown with headroom unchecked', async () => {
    const h = harness({ manifest: HEADROOM_GAME });
    const events: SessionEvents['profile'][] = [];
    h.session.on('profile', (e) => events.push(e));
    await h.session.start('fake', CAMERA);
    h.pass(2000);
    expect(h.session.state).toBe('calibrating');
    h.session.playAtDesk!();
    expect(h.session.state).toBe('countdown');
    expect(events[0]).toMatchObject({ headroom: 'unchecked' });
  });

  it('a game without the flag never asks', async () => {
    const h = harness();
    const events: SessionEvents['profile'][] = [];
    const cal: CalibrationStatus[] = [];
    h.session.on('profile', (e) => events.push(e));
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', CAMERA);
    h.until('countdown', 6000);
    expect(cal.some((c) => c.code === 'raise_hands')).toBe(false);
    expect(events[0]!.headroom).toBeUndefined();
  });
});

describe('Session, the platform says codes, never words', () => {
  it('every failure carries a code and an empty message; the developer detail is separate', async () => {
    const missing = harness();
    await missing.session.start('nope', KEYS);
    expect(missing.seen.errors).toEqual([{ code: 'game_not_found', message: '', detail: expect.stringContaining('nope') }]);

    const mode = harness({ modes: ['solo'] });
    await mode.session.start('fake', { ...KEYS, mode: 'ghost' });
    expect(mode.seen.errors).toEqual([{ code: 'mode_unavailable', message: '', detail: expect.any(String) }]);

    const denied = harness();
    denied.cam.failWith = 'denied';
    await denied.session.start('fake', CAMERA);
    expect(denied.seen.errors).toEqual([{ code: 'denied', message: '', detail: 'camera: denied' }]);

    const phone = harness({ local2: false });
    await phone.session.start('fake', { ...CAMERA, mode: 'local2' });
    expect(phone.seen.errors).toEqual([{ code: 'local2_unavailable', message: '', detail: expect.any(String) }]);
  });

  it('the shell text of a scene that cannot be drawn (already in the player language) is passed through as message', async () => {
    const h = harness({ uiFails: 'Dein Gerät kann die Szene nicht zeichnen.' });
    await h.session.start('fake', KEYS);
    expect(h.seen.errors).toEqual([{ code: 'unknown', message: 'Dein Gerät kann die Szene nicht zeichnen.', detail: 'Dein Gerät kann die Szene nicht zeichnen.' }]);
    expect(h.session.state).toBe('error');
  });

  it('a calibration status holds only codes, numbers and flags (no sentences)', async () => {
    const h = harness({ manifest: { seated: true, headroom: 'arms-up' }, shape: DESK });
    const cal: CalibrationStatus[] = [];
    h.session.on('calibration', (c) => cal.push(c as CalibrationStatus));
    await h.session.start('fake', CAMERA);
    h.until('countdown', 20_000);
    const words: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') words.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    cal.forEach(walk);
    expect(words.length).toBeGreaterThan(10);
    for (const w of words) expect(w).toMatch(/^[a-z_]+$/);
  });
});
