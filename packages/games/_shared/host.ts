// The Game contract around a pure simulation (the same shape as the runner's game.ts): a game here is
//   - a simulation (HostSim): plain data in, plain data out, one fixed step at a time, seeded content, snapshot and restore;
//   - a view (HostView): draws the simulation on the 2D scene, never changes it;
//   - a HUD function and a reaction function (sounds, announcements) that read the simulation and its events.
// The host keeps the rest: the context, the HUD cache, the events between two frames, snapshot/restore and dispose.
//
// step() is pure (the simulation reads only the frame and its own state). Sounds, announcements and drawing happen in
// render(), from the events of the steps since the last frame, so a simulation can run a thousand steps in a test with
// no audio, no HUD and no canvas.
import type {
  AudioApi, DetectorSpec, Game, GameContext, GameEvent, GameManifest, InputFrame, RunSummary, StartOptions, StepResult,
} from '../../core/types/index.ts';
import type { Rng } from '../../core/types/index.ts';
import { frameOf, type FrameIn } from './frame.ts';
import { HudWriter } from './hudcache.ts';
import { MISS_EN } from './reasons.ts';
import { stageOf, type Stage } from './stage.ts';
import { makeSay, type Say, type Table } from './text.ts';
import { copyData } from './util.ts';

export type SimEvent = GameEvent;
export type Phase = 'running' | 'over' | 'complete';

export interface HostSim {
  readonly phase: Phase;
  /** One fixed step (FIXED_DT). Returns the events of the step. */
  step(f: FrameIn): SimEvent[];
  /** Plain data: no class instances, no functions, JSON-safe. */
  snapshot(): unknown;
  /** After restore(snapshot()) the simulation continues exactly as the original did. */
  restore(s: unknown): void;
  summary(): RunSummary;
}

/** What a simulation is built from. Everything in it is also in the snapshot, so a restored run is built the same. */
export interface SimSetup {
  /** The start options of the run: seed, difficulty, seated, mode. */
  start: Pick<StartOptions, 'seed' | 'difficulty' | 'seated' | 'mode'>;
  /** The 'course' stream: all the content of a run comes from here and from nowhere else. */
  rng: Rng;
  /** Quiet mode (no jumping, no stamping) and reduced motion of the shell. */
  flags: { reducedMotion: boolean; silent: boolean; seated: boolean };
  players: 1 | 2;
  /** How long after a sound is scheduled the player hears it, ms (measured by the audio kit; 0 when unknown). */
  audioLatencyMs: number;
}

export interface HostView<S> {
  /** Draws one frame: `events` are the simulation events since the previous frame, `alpha` is 0..1 between the last two steps. */
  draw(sim: S, events: readonly SimEvent[], alpha: number): void;
  /** A new run or a restore: forget what was flying. */
  reset(): void;
  dispose(): void;
}

export interface Reaction<S> {
  audio: AudioApi;
  hud: HudWriter;
  say: Say;
  sim: S;
  /** Plays a sound by name; never throws (an audio kit that is not there is silence). */
  play(name: string): void;
}

export interface HostSpec<S extends HostSim> {
  manifest: GameManifest;
  /** The game's English lines (and the miss sentences of core/moves, added by the host). */
  english: Table;
  makeSim(o: SimSetup): S;
  makeView?(ctx: GameContext, stage: Stage, o: { reducedMotion: boolean }): HostView<S> | null;
  /** The HUD slots for the state of the simulation; called once per frame, writes only what changed. */
  hud(sim: S, hud: HudWriter, say: Say, players: 1 | 2): void;
  /** Sounds and announcements for the events since the last frame. */
  react?(events: readonly SimEvent[], io: Reaction<S>): void;
  /**
   * The movement detectors the engine runs for this way of playing (seated, quiet). The session reads `manifest.detectors` after init(),
   * so the host writes the answer there, and writes it again at start(), when the way of playing is known for sure (a full-body game that
   * got head and shoulders at a desk is played seated, which the session decides after init). For the engine to take the second answer the
   * session has to ask the manifest again at the start of a run: one line, asked of the platform builder (NOTLAR-platform.md,
   * PATCH-session-redetect-seated.diff); a platform hook for per-run detector options would replace all of this.
   */
  detectors?(o: { seated: boolean; silent: boolean }): DetectorSpec[];
}

export interface HostedGame<S extends HostSim> extends Game {
  /** The simulation of the current run, for the view, tests and tools. */
  readonly sim: S | null;
  readonly players: 1 | 2;
}

interface Snapshot {
  v: 1;
  setup: Omit<SimSetup, 'rng'>;
  sim: unknown;
}

/** Events kept for the next frame at most (a test that steps without rendering must not grow memory). */
const PENDING_MAX = 256;

function safeLatency(audio: AudioApi | undefined): number {
  try {
    const ms = audio?.clock?.().latencyMs;
    return typeof ms === 'number' && Number.isFinite(ms) ? Math.min(400, Math.max(0, ms)) : 0;
  } catch {
    return 0;
  }
}

export function createHostedGame<S extends HostSim>(spec: HostSpec<S>): HostedGame<S> {
  const { manifest } = spec;
  const english: Table = { ...MISS_EN, ...spec.english };
  let ctx: GameContext | null = null;
  let stage: Stage | null = null;
  let hud: HudWriter | null = null;
  let say: Say = makeSay(null, english);
  let sim: S | null = null;
  let view: HostView<S> | null = null;
  let setup: Omit<SimSetup, 'rng'> | null = null;
  let pending: SimEvent[] = [];

  const need = (): S => {
    if (!sim) throw new Error('Call start() before step().');
    return sim;
  };

  function build(s: Omit<SimSetup, 'rng'>): S {
    const c = ctx as GameContext;
    return spec.makeSim({ ...s, rng: c.rng('course') });
  }

  /** A fresh view for a new run or a restored one (a view keeps cosmetic state that must not leak from run to run). */
  function freshView(): void {
    view?.dispose();
    stage?.clearParticles();
    stage?.resetLayout();
    const c = ctx as GameContext;
    view = stage && spec.makeView ? spec.makeView(c, stage, { reducedMotion: c.flags.reducedMotion }) : null;
  }

  const game: HostedGame<S> = {
    manifest,

    get sim() { return sim; },
    get players() { return setup?.players ?? 1; },

    async init(c: GameContext): Promise<void> {
      ctx = c;
      hud = new HudWriter(c.hud);
      say = makeSay(c, english);
      stage = stageOf(c.scene2d);
      if (spec.detectors) manifest.detectors = spec.detectors({ seated: c.flags.seated, silent: c.flags.silent });
    },

    start(o: StartOptions): void {
      if (!ctx || !hud) throw new Error('Call init() before start().');
      // The way of playing is known for sure only now (a full-body game that got head and shoulders at a desk is played seated, which the
      // session decides after init): the detectors follow it, for a session that asks the manifest again before the countdown.
      if (spec.detectors) manifest.detectors = spec.detectors({ seated: o.seated, silent: ctx.flags.silent });
      setup = {
        start: { seed: o.seed, difficulty: o.difficulty, seated: o.seated, mode: o.mode },
        flags: { reducedMotion: ctx.flags.reducedMotion, silent: ctx.flags.silent, seated: o.seated },
        players: o.mode === 'local2' ? 2 : 1,
        audioLatencyMs: safeLatency(ctx.audio),
      };
      sim = build(setup);
      freshView();
      hud.setPlayers(setup.players);
      hud.reset();
      pending = [];
    },

    step(_dt: number, input: InputFrame): StepResult {
      const s = need();
      const events = s.step(frameOf(input, setup?.players ?? 1));
      if (events.length) {
        for (const e of events) pending.push(e);
        if (pending.length > PENDING_MAX) pending.splice(0, pending.length - PENDING_MAX);
      }
      return { events, phase: s.phase };
    },

    render(alpha: number): void {
      const s = sim;
      if (!s || !ctx || !hud) return;
      const events = pending;
      pending = [];
      const audio = ctx.audio;
      spec.react?.(events, {
        audio, hud, say, sim: s,
        play: (name) => { try { (audio as Partial<AudioApi>).play?.(name); } catch { /* silence is fine */ } },
      });
      view?.draw(s, events, alpha);
      spec.hud(s, hud, say, setup?.players ?? 1);
    },

    snapshot(): Snapshot {
      const s = need();
      return { v: 1, setup: copyData(setup as Omit<SimSetup, 'rng'>), sim: s.snapshot() };
    },

    restore(raw: unknown): void {
      const snap = raw as Snapshot;
      if (!ctx || !hud) throw new Error('Call init() before restore().');
      if (!snap || snap.v !== 1) throw new Error('Not a snapshot of this game.');
      setup = copyData(snap.setup);
      sim = build(setup);
      sim.restore(snap.sim);
      freshView();
      hud.setPlayers(setup.players);
      hud.reset();
      pending = [];
    },

    summary(): RunSummary {
      return need().summary();
    },

    dispose(): void {
      view?.dispose();
      view = null;
      sim = null;
      stage = null;
      hud = null;
      ctx = null;
      pending = [];
    },
  };
  return game;
}
