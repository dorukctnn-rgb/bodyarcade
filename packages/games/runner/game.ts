// Runner, template A (code-audit WP10): today's run (sim.ts) on the platform's Game contract.
// - start(): the course is made in advance from ctx.rng('course') (buildCourse), so the same seed gives the same
//   course whatever happens in the run. Seated runs swap jumps and squats for ducks (lean and duck from a chair).
// - step(FIXED_DT, input): lane from the 'lane' channel (lean, keys or swipes), crouch from 'crouch', a jump from a
//   'jump' event in that frame. Pure: no DOM, no clock, no Math.random.
// - snapshot()/restore(): plain data; restore(snapshot()) continues identically.
// - summary(): metSeconds = MET x simulated seconds (B22: calories are derived from it, never invented here); `log`
//   lets a room recompute the score.
// - render(alpha): the HUD (score, time, lives, combo, the next move) and, when there is a 3D scene, the view.
import type { Game, GameContext, GameEvent, GameManifest, InputFrame, RunSummary, StartOptions, StepResult, ThemeData } from '../../core/types/index.ts';
import { buildCourse, DIFFS, MOVES, Run, type Course, type MoveId, type ObstacleType, type RunInput } from './sim.ts';
import { poseOf, type RunnerPose, type RunnerView } from './view.ts';

/** Seated variant: what each obstacle becomes (no jumping, no deep squat). */
export const SEATED_SWAP: Partial<Record<ObstacleType, ObstacleType>> = { hurdle: 'duck', squat: 'duck' };

/** The next move is shown this many seconds before the obstacle reaches the player. */
export const PROMPT_LEAD_S = 1.6;

export function seatedCourse(c: Course): Course {
  return { obstacles: c.obstacles.map((o) => ({ ...o, type: SEATED_SWAP[o.type] ?? o.type })), coins: c.coins.map((r) => ({ ...r })) };
}

export interface RunnerOptions {
  /** Builds the 3D view when the context has a scene (left out: HUD only). */
  view?: (ctx: GameContext) => RunnerView | null;
  /** The worlds a run can take place in; start() uses StartOptions.world, else a free world picked by the seed. */
  worlds?: readonly ThemeData[];
}

/** The world of a run: the one asked for when it exists, else a free world chosen by the seed. */
export function pickWorld(worlds: readonly ThemeData[], seed: number, wanted?: string): ThemeData | null {
  const asked = wanted ? worlds.find((w) => w.id === wanted) : undefined;
  if (asked) return asked;
  const free = worlds.filter((w) => w['free'] === true);
  const pool = free.length ? free : worlds;
  return pool.length ? (pool[(seed >>> 0) % pool.length] as ThemeData) : null;
}

interface Snapshot { v: 1; opts: StartOptions; course: Course; run: Record<string, unknown>; log: RunSummary['log'] }

const TRANSIENT = new Set(['rand', 'diff', 'events', 'course']);

function runState(run: Run): Record<string, unknown> {
  return JSON.parse(JSON.stringify(run, (k, v: unknown) => (TRANSIENT.has(k) ? undefined : v))) as Record<string, unknown>;
}

/** The Game plus a read-only look at the simulation for the 3D view, tools and tests. */
export interface RunnerGame extends Game {
  readonly run: Readonly<Run> | null;
}

export function createRunnerGame(manifest: GameManifest, o: RunnerOptions = {}): RunnerGame {
  let ctx: GameContext | null = null;
  let view: RunnerView | null = null;
  let run: Run | null = null;
  let opts: StartOptions | null = null;
  let course: Course | null = null;
  let log: RunSummary['log'] = [];
  let prev: RunnerPose | null = null;
  const shown = new Map<string, string | number>();

  const need = (): Run => {
    if (!run) throw new Error('Call start() before step().');
    return run;
  };

  const diffOf = (d: string): string => (d in DIFFS ? d : 'medium');

  function makeRun(o2: StartOptions, c: Course): Run {
    return new Run({ diff: diffOf(o2.difficulty), duration: manifest.durationSec, seed: 0, course: c });
  }

  function say(key: string, fallback: string, vars?: Record<string, string | number>): string {
    const s = ctx?.t(key, vars);
    return s && s !== key ? s : fallback;
  }

  function hud(slot: Parameters<GameContext['hud']['set']>[0], v: string | number): void {
    if (!ctx || shown.get(slot) === v) return;
    shown.set(slot, v);
    ctx.hud.set(slot, v);
  }

  const game: RunnerGame = {
    manifest,

    get run() { return run; },

    async init(c: GameContext): Promise<void> {
      ctx = c;
      view = o.view?.(c) ?? null;
    },

    start(s: StartOptions): void {
      if (!ctx) throw new Error('Call init() before start().');
      opts = { ...s };
      const made = buildCourse(ctx.rng('course'), diffOf(s.difficulty), manifest.durationSec);
      course = s.seated ? seatedCourse(made) : made;
      run = makeRun(s, course);
      prev = poseOf(run);
      log = [];
      shown.clear();
      const world = view ? pickWorld(o.worlds ?? [], s.seed, s.world) : null;
      if (view && world) view.begin(world);
    },

    step(dt: number, input: InputFrame): StepResult {
      const r = need();
      let jump = !opts?.seated && input.events.some((e) => e.id === 'jump' && e.kind !== 'holdEnd');
      const lane = Math.max(-1, Math.min(1, Math.round(input.channels.lane ?? 0)));
      const crouch = Math.max(0, Math.min(1, input.channels.crouch ?? 0));
      const ri: RunInput = { lane, crouch, consumeJump: () => { const j = jump; jump = false; return j; } };
      const out: GameEvent[] = [];
      prev = poseOf(r);
      for (const e of r.update(dt, ri)) {
        switch (e.type) {
          case 'pass':
            out.push({ type: 'pass', t: input.t, move: e.ob.move, pts: e.pts, combo: e.combo });
            log.push({ t: input.t, kind: e.ob.move, ok: true, v: e.pts });
            break;
          case 'hit':
            out.push({ type: 'hit', t: input.t, move: e.ob.move, hearts: e.hearts });
            log.push({ t: input.t, kind: e.ob.move, ok: false });
            break;
          case 'coin':
            out.push({ type: 'coin', t: input.t, lane: e.coin.lane });
            log.push({ t: input.t, kind: 'coin', ok: true, v: 25 });
            break;
          case 'spawn':
            out.push({ type: 'spawn', t: input.t, id: e.ob.id, move: e.ob.move });
            break;
          case 'skip':
            out.push({ type: 'skip', t: input.t, move: e.ob.move });
            break;
          default:
            out.push({ type: e.type, t: input.t });
        }
      }
      return { events: out, phase: r.phase };
    },

    render(alpha: number): void {
      const r = run;
      if (!r) return;
      view?.render(r, prev ?? poseOf(r), alpha);
      hud('score', Math.round(r.score));
      hud('timer', Math.max(0, Math.ceil(r.duration - r.t)));
      hud('lives', r.hearts);
      hud('combo', r.combo);
      const n = r.next();
      const move: MoveId | null = n && n.eta <= PROMPT_LEAD_S ? n.move : null;
      hud('prompt', move ? say(`runner.move.${move}`, MOVES[move].label) : '');
    },

    snapshot(): Snapshot {
      const r = need();
      return { v: 1, opts: { ...(opts as StartOptions) }, course: course as Course, run: runState(r), log: log.map((e) => ({ ...e })) };
    },

    restore(s: unknown): void {
      const snap = s as Snapshot;
      if (!snap || snap.v !== 1) throw new Error('Not a runner snapshot.');
      opts = { ...snap.opts };
      course = snap.course;
      const r = makeRun(opts, course);
      Object.assign(r, JSON.parse(JSON.stringify(snap.run)) as Partial<Run>);
      run = r;
      prev = poseOf(r);
      log = snap.log.map((e) => ({ ...e }));
      shown.clear();
    },

    summary(): RunSummary {
      const r = need();
      const s = r.summary();
      const seconds = Math.round(r.t * 100) / 100;
      return {
        score: s.score, seconds, cleared: s.cleared, hits: s.hits, bestStreak: s.bestCombo,
        metSeconds: Math.round(manifest.met * r.t * 10) / 10, log: log.map((e) => ({ ...e })),
      };
    },

    dispose(): void {
      view?.dispose();
      view = null;
      run = null;
      ctx = null;
    },
  };
  return game;
}
