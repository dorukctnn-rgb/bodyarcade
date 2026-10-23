// Session: one game from setup to results (code-audit 11.4, WP6). It owns the camera lease, the pose feed, calibration,
// the countdown and the fixed-step loop; the UI listens to its events and calls start, pause, resume, recalibrate, quit.
//
// States: idle -> setup -> calibrating (camera runs) -> countdown -> running <-> paused -> results. A failure goes to
// error; quit() goes back to idle from anywhere.
// - Camera runs acquire a lease with an abort signal: quit() during the permission prompt leaves no live track (B9).
//   The lease is released at results and on quit (B10); "Run again" is a new start() with a new lease.
// - Every resume of a camera run calibrates again (tech.md 4.1 item 5: the player may now stand elsewhere), then
//   counts down. Keyboard and touch runs only count down.
// - Pause reasons: 'user' and 'hidden' wait for resume(); 'person_lost' and 'player_lost' come from the gate in
//   PoseFeed and resume by themselves once everyone is back; 'camera_ended' (B8) needs a new lease, so resume() runs
//   recalibrate(), which acquires one; 'recalibrate' while recalibrate() works. 'camera_ended' replaces any other
//   reason, and 'user' replaces a lost player (no automatic resume after the player chose to pause).
// - Paused, results and error states run no frame loop at all: nothing renders and nothing measures the frame rate
//   (B12).
// - Input sources: solo, ghost and local2 accept pose, keyboard and touch (accessibility, tech.md 4.5); duel accepts
//   pose only (code-audit rule 7). Mode 'local2' needs Capabilities.local2, a game that lists it, and the camera.
// - Determinism: the game only sees FIXED_DT steps, and InputHub frames stamped with simulation time.
// - A camera that stops delivering pictures without ending (iPhone: the track is muted by a call or another app; a
//   stuck pose worker) is caught by a watchdog: no pose frame for stallMs (2.5 s) while calibrating, counting down or
//   playing pauses with 'camera_ended' and gives the lease back, so resume() asks for the camera again.
// - The screen stays on (Wake Lock) while calibrating, counting down, playing and waiting for a lost player: a camera
//   player never touches the phone, which would otherwise dim and lock mid-run. A pause by hand, the results and
//   errors let the screen sleep again.
import {
  FIXED_DT,
  type BodyProfile, type CalibrationStatus, type Calibrator, type CameraAcquireOptions, type CameraLease, type CameraService,
  type Capabilities, type Game, type GameContext, type GameManifest, type GameModule, type InputHub, type InputSourceId,
  type PauseReason, type PlayerFrame, type PlayerSlot, type PoseFrame, type PoseLoadOptions, type PoseService, type Rng,
  type RunSummary, type Session, type SessionEvents, type SessionOptions, type SessionState, type StepResult,
  type TwoPlayerCalibrationStatus, type TwoPlayerCalibrator, type Unsubscribe,
} from '../types/index.ts';
import { createCalibrator } from '../body/calibrator.ts';
import { createTwoPlayerCalibrator } from '../body/calibrator2.ts';
import { isAbortError } from '../camera/camera.ts';
import { createInputHub, type InputHubOptions } from '../input/hub.ts';
import { POSE_MODEL, WASM_BASE } from '../pose/assets.ts';
import { createPoseFeed, type PoseFeed, type PoseFeedOptions, type PresenceChange } from '../input/pose-feed.ts';
import { createFixedStepClock, stepTime, type FixedStepClock } from './clock.ts';
import { rngStream } from './rng.ts';

export const SESSION_DEFAULTS = { countdownMs: 3000, fpsEveryMs: 1000, stallMs: 2500 } as const;

/** The first pose frame of a new camera may take this long (the first GPU inference took 3.1 s cold). */
const FIRST_FRAME_MS = 12_000;

export type SessionErrorCode =
  | 'game_not_found' | 'game_init' | 'game_step' | 'mode_unavailable' | 'local2_unavailable' | 'camera_required'
  | 'pose_load' | 'denied' | 'not_found' | 'in_use' | 'overconstrained' | 'no_frames' | 'insecure' | 'unsupported' | 'unknown';

/** The parts of GameContext the UI owns. */
export type SessionUi = Pick<GameContext, 'hud' | 'audio' | 'store' | 'scene2d' | 'scene3d' | 't'>;

export interface SessionDeps {
  /** Game modules by id (lazy imports); null when there is no such game. */
  games(id: string): GameModule | null | Promise<GameModule | null>;
  /** HUD, audio, store, scenes and strings for one game. */
  ui(m: GameManifest, o: SessionOptions): SessionUi | Promise<SessionUi>;
  /** Camera runs only. */
  camera?: CameraService;
  pose?: PoseService;
  /** Model and WASM locations (numPoses and signal are set by the session). */
  poseLoad?: Omit<PoseLoadOptions, 'numPoses' | 'signal'>;
  cameraOptions?: Omit<CameraAcquireOptions, 'signal'>;
  /** Mode 'local2' needs `local2: true`. */
  capabilities?: () => Capabilities;
  calibrator?: () => Calibrator;
  calibrator2?: () => TwoPlayerCalibrator;
  feed?: (o: PoseFeedOptions) => PoseFeed;
  hub?: (o: InputHubOptions) => InputHub;
  raf?: (cb: (t: number) => void) => number;
  cancelRaf?: (id: number) => void;
  now?: () => number;
  /** Where visibilitychange comes from (default document). */
  doc?: EventTarget & { readonly hidden: boolean };
  seed?: () => number;
  flags?: () => { reducedMotion: boolean; silent: boolean };
  countdownMs?: number;
  /** The gate: a player not seen for this long is lost (default 500 ms, tech.md 4.1). */
  lostMs?: number;
  /** No pose frame for this long in a camera run counts as a stopped camera (default 2500 ms). */
  stallMs?: number;
  /** Extra input sources for tests and tools ('test', 'trace'); never added in duel. */
  extraSources?: InputSourceId[];
  /** Where the game's keys are bound (default window, when there is one). */
  keyTarget?: EventTarget;
  /** The play area for the game's swipes (none: no touch controls). */
  touchTarget?: () => HTMLElement | null;
  /** Keeps the screen on (default navigator.wakeLock.request('screen') where it exists; null turns it off). */
  wakeLock?: (() => Promise<WakeLockLike | null>) | null;
}

/** The part of WakeLockSentinel the session uses. */
export interface WakeLockLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', cb: () => void): void;
}

interface Run {
  options: SessionOptions;
  module: GameModule | null;
  offControls: Unsubscribe[];
  /** The 'video' event said a picture is showing. */
  videoShown: boolean;
  /** now() of the last pose frame (or of the camera start), for the stall watchdog. */
  lastFrameAt: number;
  /** Pose frames since the lease was attached: the first one may take long (a cold GPU model, tech.md 3.1). */
  leaseFrames: number;
  players: 1 | 2;
  manifest: GameManifest | null;
  game: Game | null;
  started: boolean;
  hub: InputHub;
  feed: PoseFeed | null;
  lease: CameraLease | null;
  offLease: Unsubscribe | null;
  offPose: Unsubscribe | null;
  offPresence: Unsubscribe | null;
  abort: AbortController;
  calibrator: Calibrator | null;
  calibrator2: TwoPlayerCalibrator | null;
  clock: FixedStepClock;
  rafId: number | null;
  alpha: number;
  countdownEnd: number;
  countdownShown: number;
  fpsFrames: number;
  fpsSince: number;
  seed: number;
}

type Listeners = { [K in keyof SessionEvents]?: Set<(e: SessionEvents[K]) => void> };

const CAMERA_CODES = new Set(['denied', 'not_found', 'in_use', 'overconstrained', 'no_frames', 'insecure', 'unsupported', 'unknown']);

function randomSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) return (c.getRandomValues(new Uint32Array(1))[0] as number) >>> 0;
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A pose service for runs without a camera: games never read pose directly, they read the InputHub. */
const NO_POSE: PoseService = {
  load: () => Promise.reject(new Error('No pose service in this run.')),
  warmUp: () => Promise.resolve(),
  attach: () => {},
  detach: () => {},
  onFrame: () => () => {},
  setMaxHz: () => {},
  setNumPoses: () => Promise.resolve(),
  stats: { hz: 0, p50: 0, p95: 0, dropped: 0, frames: 0 },
  dispose: () => {},
};

export function createSession(deps: SessionDeps): Session {
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const cancelRaf = deps.cancelRaf ?? ((id: number) => cancelAnimationFrame(id));
  const countdownMs = deps.countdownMs ?? SESSION_DEFAULTS.countdownMs;
  const stallMs = deps.stallMs ?? SESSION_DEFAULTS.stallMs;
  const listeners: Listeners = {};
  let state: SessionState = 'idle';
  let reason: PauseReason | null = null;
  let run: Run | null = null;
  let poseReady: Promise<unknown> | null = null;

  function emit<K extends keyof SessionEvents>(k: K, e: SessionEvents[K]): void {
    const set = listeners[k] as Set<(e: SessionEvents[K]) => void> | undefined;
    if (!set) return;
    for (const cb of [...set]) {
      try { cb(e); } catch (err) { queueMicrotask(() => { throw err; }); }
    }
  }

  function setState(s: SessionState): void {
    if (s !== 'paused') reason = null;
    if (s === state) return;
    state = s;
    syncWakeLock();
    emit('state', s);
  }

  // ---- screen wake lock ----

  const requestLock = deps.wakeLock === undefined
    ? (typeof navigator !== 'undefined' && (navigator as { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock
      ? () => (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock.request('screen')
      : null)
    : deps.wakeLock;
  let lock: WakeLockLike | null = null;
  let lockPending = false;

  const lockWanted = (): boolean =>
    state === 'calibrating' || state === 'countdown' || state === 'running'
    || (state === 'paused' && (reason === 'person_lost' || reason === 'player_lost' || reason === 'recalibrate'));

  function syncWakeLock(): void {
    if (!requestLock) return;
    if (lockWanted()) {
      if (lock || lockPending || doc?.hidden) return;
      lockPending = true;
      requestLock().then((l) => {
        lockPending = false;
        if (!l) return;
        if (!lockWanted()) { l.release().catch(() => {}); return; }
        lock = l;
        // The browser drops the lock when the page is hidden; it is asked for again when the page is back.
        l.addEventListener?.('release', () => { if (lock === l) lock = null; });
      }, () => { lockPending = false; });
    } else if (lock) {
      const l = lock;
      lock = null;
      l.release().catch(() => {});
    }
  }

  const live = (r: Run): boolean => run === r;
  const slots = (r: Run): PlayerSlot[] => (r.players === 2 ? [1, 2] : [1]);
  const cameraRun = (r: Run): boolean => r.options.input === 'camera';

  function sourcesFor(o: SessionOptions): InputSourceId[] {
    if (o.mode === 'duel') return ['pose'];
    const base: InputSourceId[] = o.input === 'camera' ? ['pose', 'keyboard', 'touch'] : ['keyboard', 'touch'];
    return [...base, ...(deps.extraSources ?? []).filter((s) => !base.includes(s))];
  }

  // ---- frame loop: countdown and running only (B12) ----

  function schedule(r: Run): void {
    if (r.rafId !== null || !live(r)) return;
    r.rafId = raf(() => { r.rafId = null; tick(r); });
  }

  function stopLoop(r: Run): void {
    if (r.rafId !== null) cancelRaf(r.rafId);
    r.rafId = null;
  }

  function tick(r: Run): void {
    if (!live(r) || !r.game) return;
    const t = now();
    const limit = r.leaseFrames > 0 ? stallMs : Math.max(stallMs, FIRST_FRAME_MS);
    if (r.lease && (state === 'calibrating' || state === 'countdown' || state === 'running') && t - r.lastFrameAt > limit) {
      stalled(r);
      return;
    }
    if (state === 'calibrating') { schedule(r); return; }   // only the watchdog runs: nothing is drawn
    if (state === 'countdown') {
      const left = Math.max(0, Math.ceil((r.countdownEnd - t) / 1000));
      if (t >= r.countdownEnd) {
        r.hub.sample(r.clock.simMs); // events made during the countdown never reach the game
        r.clock.resync(t);
        r.fpsFrames = 0;
        r.fpsSince = t;
        setState('running');
        if (r.countdownShown !== 0) { r.countdownShown = 0; emit('countdown', { remaining: 0 }); }
      } else if (left !== r.countdownShown) {
        r.countdownShown = left;
        emit('countdown', { remaining: left });
      }
      if (!live(r) || (state !== 'countdown' && state !== 'running')) return;
      r.game.render(r.alpha);
      schedule(r);
      return;
    }
    if (state !== 'running') return;
    const { steps, alpha } = r.clock.advance(t);
    const first = r.clock.steps - steps;
    for (let i = 1; i <= steps; i++) {
      let res: StepResult;
      try {
        res = r.game.step(FIXED_DT, r.hub.sample(stepTime(first + i)));
      } catch (e) {
        fail(r, 'game_step', message(e));
        return;
      }
      if (!live(r) || state !== 'running') return;
      if (res.phase !== 'running') { finish(r); return; }
    }
    r.alpha = alpha;
    r.game.render(alpha);
    r.fpsFrames++;
    if (t - r.fpsSince >= SESSION_DEFAULTS.fpsEveryMs) {
      emit('frame', { fps: Math.round((r.fpsFrames * 1000) / (t - r.fpsSince)) });
      r.fpsFrames = 0;
      r.fpsSince = t;
    }
    schedule(r);
  }

  // ---- camera, pose and calibration ----

  function releaseCamera(r: Run): void {
    r.offPose?.();
    r.offPose = null;
    const had = r.lease !== null;
    if (had) deps.pose?.detach();
    r.offLease?.();
    r.offLease = null;
    r.lease?.release();
    r.lease = null;
    if (had && r.videoShown) { r.videoShown = false; emit('video', { el: null }); }
  }

  /** Asks for the camera (the permission prompt); the lease belongs to the run from here on. */
  async function acquireLease(r: Run): Promise<boolean> {
    const lease = await (deps.camera as CameraService).acquire({ ...deps.cameraOptions, signal: r.abort.signal });
    if (!live(r)) { lease.release(); return false; }
    r.lease = lease;
    r.offLease = lease.onEnded(() => onCameraEnded(r));
    return true;
  }

  /** Starts the video and hands it to the pose service (which must have its model by now). */
  async function connectLease(r: Run): Promise<boolean> {
    const lease = r.lease;
    if (!lease) return false;
    const pose = deps.pose as PoseService;
    await lease.start();
    if (!live(r) || r.lease !== lease) return false;
    for (const s of slots(r)) r.hub.setTracking({ ok: true }, s);
    r.offPose = pose.onFrame((f) => onPoseFrame(r, f));
    r.lastFrameAt = now();
    r.leaseFrames = 0;
    pose.attach(lease);
    r.videoShown = true;
    emit('video', { el: lease.video });
    return true;
  }

  function cameraFailure(r: Run, e: unknown): void {
    if (!live(r) || isAbortError(e)) return;
    const code = (e as { code?: string }).code;
    fail(r, (code && CAMERA_CODES.has(code) ? code : 'unknown') as SessionErrorCode, message(e));
  }

  /**
   * The model loads once per session and is never aborted: quitting during the download keeps it for the next start,
   * and a second run never waits on a load that the first run cancelled. A failed load is tried again next time.
   */
  function loadPose(r: Run): Promise<unknown> {
    const pose = deps.pose as PoseService;
    if (!poseReady) {
      const p = pose.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, ...deps.poseLoad, numPoses: r.players });
      poseReady = p;
      p.catch(() => { if (poseReady === p) poseReady = null; });
    }
    return poseReady.then(() => pose.setNumPoses(r.players));
  }

  function beginCalibration(r: Run): void {
    const m = r.manifest as GameManifest;
    const framing = r.options.seated ? 'upper' : m.framing;
    if (r.players === 2) {
      r.calibrator2 ??= (deps.calibrator2 ?? (() => createTwoPlayerCalibrator()))();
      r.calibrator2.begin(framing);
    } else {
      r.calibrator ??= (deps.calibrator ?? (() => createCalibrator()))();
      r.calibrator.begin(framing);
    }
    setState('calibrating');
    // A camera that ended while starting up: say so (B8) instead of waiting for frames that never come.
    if (live(r) && r.lease && !r.lease.alive) { pauseRun(r, 'camera_ended'); return; }
    r.lastFrameAt = Math.max(r.lastFrameAt, now() - stallMs / 2);   // a fresh calibration gets time for its first frame
    if (live(r) && state === 'calibrating') schedule(r);
  }

  /** The camera stopped delivering pictures without ending: treat it as ended, so resume() acquires a new one. */
  function stalled(r: Run): void {
    for (const s of slots(r)) r.hub.setTracking({ ok: false, code: 'stalled' }, s);
    pauseRun(r, 'camera_ended');
    releaseCamera(r);
  }

  function onPoseFrame(r: Run, f: PoseFrame): void {
    if (!live(r) || !r.feed) return;
    r.lastFrameAt = now();
    r.leaseFrames++;
    if (state === 'calibrating') {
      const frames = r.feed.push(f, { engines: false });
      let status: CalibrationStatus | TwoPlayerCalibrationStatus;
      if (r.calibrator2) status = r.calibrator2.push(frames as unknown as readonly [PlayerFrame, PlayerFrame]);
      else status = (r.calibrator as Calibrator).push(frames[0] as PlayerFrame);
      emit('calibration', status);
      if (status.ready && live(r) && state === 'calibrating') onCalibrated(r);
    } else if (state === 'countdown' || state === 'running') {
      r.feed.push(f);
    } else if (state === 'paused') {
      r.feed.push(f, { engines: false }); // the gate still sees who is back
    }
  }

  function onCalibrated(r: Run): void {
    const feed = r.feed as PoseFeed;
    let profiles: Partial<Record<PlayerSlot, BodyProfile>> | null;
    if (r.calibrator2) profiles = r.calibrator2.profiles();
    else {
      const p = (r.calibrator as Calibrator).profile();
      profiles = p ? { 1: p } : null;
    }
    if (!profiles) return;
    feed.setProfiles(profiles);
    feed.reset();
    beginCountdown(r, profiles);
  }

  function onPresence(r: Run, e: PresenceChange): void {
    if (!live(r)) return;
    if (r.players === 2) emit('player', { player: e.player, present: e.present });
    if (!e.present && (state === 'running' || state === 'countdown')) {
      pauseRun(r, r.players === 2 ? 'player_lost' : 'person_lost');
    } else if (e.present && state === 'paused' && (reason === 'person_lost' || reason === 'player_lost') && r.feed?.allPresent()) {
      beginCalibration(r);
    }
  }

  function onCameraEnded(r: Run): void {
    if (!live(r)) return;
    for (const s of slots(r)) r.hub.setTracking({ ok: false, code: 'camera_ended' }, s);
    if (state === 'running' || state === 'countdown' || state === 'calibrating' || state === 'paused') pauseRun(r, 'camera_ended');
  }

  // ---- countdown, pause, results ----

  function beginCountdown(r: Run, profiles: Partial<Record<PlayerSlot, BodyProfile>> | null): void {
    const game = r.game as Game;
    if (!r.started) {
      const o = r.options;
      const start: Parameters<Game['start']>[0] = { seed: r.seed, difficulty: o.difficulty, seated: o.seated, mode: o.mode, profile: profiles?.[1] ?? null };
      if (r.players === 2 && profiles) start.profiles = profiles;
      if (o.world !== undefined) start.world = o.world;
      game.start(start);
      r.started = true;
      r.clock.reset();
    }
    bindControls(r);
    r.countdownEnd = now() + countdownMs;
    r.countdownShown = Math.ceil(countdownMs / 1000);
    setState('countdown');
    emit('countdown', { remaining: r.countdownShown });
    if (live(r) && state === 'countdown') schedule(r);
  }

  /** Higher wins when a paused session gets another reason. */
  const RANK: Record<PauseReason, number> = { person_lost: 0, player_lost: 0, hidden: 1, user: 2, recalibrate: 3, camera_ended: 4 };

  function pauseRun(r: Run, why: PauseReason): void {
    if (state === 'paused') {
      if (reason !== null && RANK[why] <= RANK[reason]) return;
      reason = why;
      syncWakeLock();
      emit('pause', why);
      return;
    }
    if (state !== 'running' && state !== 'countdown' && state !== 'calibrating') return;
    stopLoop(r);
    unbindControls(r);
    r.hub.reset();
    reason = why;
    emit('pause', why);
    if (live(r)) setState('paused');
    syncWakeLock();
  }

  function finish(r: Run): void {
    stopLoop(r);
    const summary: RunSummary = (r.game as Game).summary();
    releaseCamera(r); // B10: the camera light goes off on the results screen
    unbindControls(r);
    r.hub.reset();
    emit('over', summary);
    if (live(r)) setState('results');
  }

  function teardown(r: Run): void {
    r.abort.abort();
    stopLoop(r);
    unbindControls(r);
    releaseCamera(r);
    r.offPresence?.();
    r.offPresence = null;
    r.feed?.dispose();
    r.hub.dispose();
    const g = r.game;
    r.game = null;
    if (g) {
      try { g.dispose(); } catch (e) { queueMicrotask(() => { throw e; }); }
    }
  }

  function fail(r: Run, code: SessionErrorCode, msg: string): void {
    if (!live(r)) return;
    run = null;
    teardown(r);
    emit('error', { code, message: msg });
    setState('error');
  }

  /**
   * The game's keys and swipes, bound only while counting down or playing: on pause and results screens the same
   * keys (Space, arrows) must work the buttons and scroll the page again.
   */
  function bindControls(r: Run): void {
    const c = r.module?.controls;
    if (!c || r.offControls.length) return;
    const keyTarget = deps.keyTarget ?? (typeof window !== 'undefined' ? window : undefined);
    if (c.keys && keyTarget) r.offControls.push(r.hub.bindKeyboard(c.keys, keyTarget));
    const el = c.touch ? deps.touchTarget?.() : null;
    if (c.touch && el) r.offControls.push(r.hub.bindTouch(el, c.touch));
  }

  function unbindControls(r: Run): void {
    for (const off of r.offControls.splice(0)) off();
  }

  // ---- visibility ----

  const doc = deps.doc ?? (typeof document !== 'undefined' ? (document as EventTarget & { hidden: boolean }) : undefined);
  doc?.addEventListener('visibilitychange', () => {
    if (doc.hidden && run && (state === 'running' || state === 'countdown')) pauseRun(run, 'hidden');
    else if (!doc.hidden) syncWakeLock();
  });

  // ---- the public surface ----

  const session: Session = {
    get state() { return state; },
    get pauseReason() { return state === 'paused' ? reason : null; },

    async start(gameId: string, o: SessionOptions): Promise<void> {
      if (run) { const old = run; run = null; teardown(old); }
      const players: 1 | 2 = o.mode === 'local2' ? 2 : 1;
      const hub = (deps.hub ?? createInputHub)({ players, now: () => r.clock.simMs });
      const r: Run = {
        options: { ...o }, module: null, offControls: [], videoShown: false, lastFrameAt: 0, leaseFrames: 0, players, manifest: null, game: null, started: false, hub, feed: null, lease: null, offLease: null,
        offPose: null, offPresence: null, abort: new AbortController(), calibrator: null, calibrator2: null,
        clock: createFixedStepClock(), rafId: null, alpha: 0, countdownEnd: 0, countdownShown: -1, fpsFrames: 0, fpsSince: 0,
        seed: (o.seed ?? deps.seed?.() ?? randomSeed()) >>> 0,
      };
      run = r;
      reason = null;
      setState('setup');
      if (!live(r)) return;
      hub.allow(sourcesFor(o));
      try {
        const module = await deps.games(gameId);
        if (!live(r)) return;
        if (!module) return fail(r, 'game_not_found', `There is no game '${gameId}'.`);
        const m = module.manifest;
        r.manifest = m;
        r.module = module;
        if (!m.modes.includes(o.mode)) return fail(r, 'mode_unavailable', `${m.id} has no '${o.mode}' mode.`);
        if ((o.mode === 'duel' || o.mode === 'local2') && o.input !== 'camera') return fail(r, 'camera_required', `Mode '${o.mode}' is played with the camera.`);
        if (o.mode === 'local2') {
          const caps = deps.capabilities?.();
          if (!caps?.local2) return fail(r, 'local2_unavailable', `Two players on one camera are not offered here (${caps?.local2Reason ?? 'unknown'}).`);
        }
        if (o.input === 'camera' && (!deps.camera || !deps.pose)) return fail(r, 'camera_required', 'This session has no camera or pose service.');

        // The model loads while the permission prompt is open.
        const posePromise = o.input === 'camera' ? loadPose(r) : null;
        posePromise?.catch(() => {});

        const ui = await deps.ui(m, o);
        if (!live(r)) return;
        const game = module.create();
        r.game = game;
        const streams = new Map<string, Rng>();
        const flags = deps.flags?.() ?? { reducedMotion: false, silent: false };
        const ctx: GameContext = {
          pose: deps.pose ?? NO_POSE,
          input: hub,
          hud: ui.hud,
          audio: ui.audio,
          store: ui.store,
          rng: (name) => {
            let s = streams.get(name);
            if (!s) { s = rngStream(r.seed, name); streams.set(name, s); }
            return s;
          },
          flags: { reducedMotion: flags.reducedMotion, silent: flags.silent, seated: o.seated },
          t: ui.t,
        };
        if (ui.scene2d) ctx.scene2d = ui.scene2d;
        if (ui.scene3d) ctx.scene3d = ui.scene3d;
        try {
          await game.init(ctx);
        } catch (e) {
          return fail(r, 'game_init', message(e));
        }
        if (!live(r)) return;

        if (!posePromise) {
          beginCountdown(r, null);
          return;
        }
        try {
          if (!(await acquireLease(r))) return;
        } catch (e) {
          return cameraFailure(r, e);
        }
        try {
          await posePromise;
        } catch (e) {
          if (!live(r) || isAbortError(e)) return;
          return fail(r, 'pose_load', message(e));
        }
        if (!live(r)) return;
        const feedOptions: PoseFeedOptions = { hub, players };
        if (deps.lostMs !== undefined) feedOptions.lostMs = deps.lostMs;
        const feed = (deps.feed ?? createPoseFeed)(feedOptions);
        feed.use(m.detectors);
        r.feed = feed;
        r.offPresence = feed.onPresence((e) => onPresence(r, e));
        try {
          if (!(await connectLease(r))) return;
        } catch (e) {
          return cameraFailure(r, e);
        }
        beginCalibration(r);
      } catch (e) {
        if (!live(r) || isAbortError(e)) return;
        fail(r, 'unknown', message(e));
      }
    },

    pause(why: PauseReason): void {
      if (run) pauseRun(run, why);
    },

    async resume(): Promise<void> {
      const r = run;
      if (!r || state !== 'paused') return;
      if (reason === 'recalibrate') return;
      if (cameraRun(r)) {
        if (reason === 'camera_ended' || !r.lease || !r.lease.alive) return session.recalibrate();
        beginCalibration(r);
        return;
      }
      beginCountdown(r, null);
    },

    async recalibrate(): Promise<void> {
      const r = run;
      if (!r || !cameraRun(r) || !r.feed) return;
      if (state !== 'paused' && state !== 'running' && state !== 'countdown' && state !== 'calibrating') return;
      if (state !== 'paused') pauseRun(r, 'recalibrate');
      else if (reason !== 'camera_ended') { reason = 'recalibrate'; syncWakeLock(); emit('pause', 'recalibrate'); }
      if (!r.lease || !r.lease.alive) {
        releaseCamera(r);
        try {
          if (!(await acquireLease(r)) || !(await connectLease(r))) return;
        } catch (e) {
          return cameraFailure(r, e);
        }
      }
      if (!live(r)) return;
      beginCalibration(r);
    },

    quit(): void {
      const r = run;
      run = null;
      if (r) teardown(r);
      setState('idle');
    },

    on<K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): Unsubscribe {
      let set = listeners[k] as Set<(e: SessionEvents[K]) => void> | undefined;
      if (!set) { set = new Set(); (listeners as Record<string, unknown>)[k] = set; }
      set.add(cb);
      return () => { set.delete(cb); };
    },
  };
  return session;
}
