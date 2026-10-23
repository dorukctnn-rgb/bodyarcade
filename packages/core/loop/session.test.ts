// Session state machine: keyboard and camera runs, pauses and their reasons, B8, B9, B10, B12, local2, duel.
import { describe, expect, it } from 'vitest';
import type {
  AudioApi, CameraAcquireOptions, CameraErrorCode, CameraLease, CameraService, FrameSource, Game, GameContext, GameManifest,
  GameMode, GameModule, InputEvent, InputFrame, PauseReason, PoseFrame, PoseLoadOptions, PoseService, SessionEvents,
  SessionOptions, SessionState, StartOptions,
} from '../types/index.ts';
import { FIXED_DT } from '../types/index.ts';
import { abortError, CameraError } from '../camera/camera.ts';
import { createCalibrator } from '../body/calibrator.ts';
import { createTwoPlayerCalibrator } from '../body/calibrator2.ts';
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
    async load(o: PoseLoadOptions) { p.loads.push(o); return { delegate: 'CPU' as const, worker: true, loadMs: 1 }; },
    async warmUp() {},
    attach(src: FrameSource) { p.attached = src; },
    detach() { p.attached = null; },
    onFrame(cb: (f: PoseFrame) => void) { cbs.add(cb); return () => { cbs.delete(cb); }; },
    setMaxHz() {},
    async setNumPoses(n: 1 | 2) { p.numPoses.push(n); },
    stats: { hz: 0, p50: 0, p95: 0, dropped: 0, frames: 0 },
    dispose() {},
    emit(f: PoseFrame) { if (p.attached) for (const cb of [...cbs]) cb(f); },
    get listeners() { return cbs.size; },
  };
  return p satisfies PoseService & Record<string, unknown>;
}

interface GameLog {
  inits: number; starts: StartOptions[]; steps: number; dts: Set<number>; renders: number; disposed: number;
  events: InputEvent[]; frames: InputFrame[]; ctx: GameContext | null; course: number[];
}

function fakeGame(o: { modes?: GameMode[]; overAfter?: number } = {}) {
  const log: GameLog = { inits: 0, starts: [], steps: 0, dts: new Set(), renders: 0, disposed: 0, events: [], frames: [], ctx: null, course: [] };
  const manifest: GameManifest = {
    id: 'fake', template: 'runner', version: 1, title: 'Fake', regions: ['legs'], framing: 'full', seated: false, lowImpact: false,
    silentSafe: true, durationSec: 10, met: 5, detectors: [{ id: 'jump' }, { id: 'squat' }, { id: 'lean' }], free: true,
    modes: o.modes ?? ['solo', 'local2', 'duel'], seo: { slug: 'fake', keywords: [] },
  };
  const games: Game[] = [];
  const module: GameModule = {
    manifest,
    create(): Game {
      const g: Game = {
        manifest,
        async init(ctx) { log.inits++; log.ctx = ctx; },
        start(s) { log.starts.push(s); },
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

function harness(o: { modes?: GameMode[]; overAfter?: number; local2?: boolean; people?: Person[] } = {}) {
  let t = 1000;
  const raf = new Map<number, () => void>();
  let rafSeq = 0;
  const cam = fakeCamera();
  const pose = fakePose();
  const game = fakeGame(o);
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const people: Person[] = o.people ?? [{ cx: 0.5, present: true }];
  const rng = mulberry32(5);
  let seq = 0;
  let lastPoseT = -Infinity;
  const session = createSession({
    games: (id) => (id === 'fake' ? game.module : null),
    ui: () => UI,
    camera: cam,
    pose,
    capabilities: () => ({ device: 'desktop', local2: o.local2 ?? true, local2Reason: o.local2 === false ? 'phone' : 'ok' }),
    calibrator: () => createCalibrator({ now: () => 0 }),
    calibrator2: () => createTwoPlayerCalibrator({ now: () => 0 }),
    raf: (cb) => { const id = ++rafSeq; raf.set(id, () => cb(t)); return id; },
    cancelRaf: (id) => { raf.delete(id); },
    now: () => t,
    doc,
    seed: () => 42,
    extraSources: ['test'],
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
    const poses = people.filter((p) => p.present).map((p) => synthPose(shape(p.cx), p.motion?.(t) ?? {}).map((l) => ({ ...l, x: l.x + gaussian(rng) * 0.001, y: l.y + gaussian(rng) * 0.001 })));
    const f: PoseFrame = { seq: seq++, t, landmarks: poses[0] ?? null, inferenceMs: 30, source: 'camera', aspect: ASPECT };
    if (people.length > 1) f.poses = poses;
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

  return { session, cam, pose, game, doc, people, seen, pass, until, get rafPending() { return raf.size; }, get now() { return t; } };
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
    expect(h.pose.attached).toBeNull();
    expect(h.pose.listeners).toBe(0);
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
    h.until('running', 6000);
    h.people[0]!.present = false;
    h.pass(450);
    expect(h.session.state).toBe('running');
    h.pass(200);
    expect(h.session.state).toBe('paused');
    expect(h.session.pauseReason).toBe('person_lost');
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
