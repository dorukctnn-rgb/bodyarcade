// Sprint template: Knee Sprint on the platform's Game contract.
// - start(): the course (the hurdles of every heat and the computer's pace) is made at once from ctx.rng('course'), so the
//   same seed gives the same race whatever happens in it. Mode 'local2' makes two lanes on that one course, without a computer.
// - step(FIXED_DT, input): turns the movement events and channels of each player into a LaneIn (the counted knee lifts with
//   their height and side, a jump, the knees now, the movement energy seated) and steps the pure simulation. No DOM, no clock,
//   no random.
// - render(alpha): the HUD, the sounds and the picture; everything cosmetic lives here, never in step().
// - snapshot()/restore(): plain data; restore(snapshot()) continues identically.
// - summary(): metSeconds = MET x the seconds spent running, with the MET between a march (4.0) and high knees (7.5) by how high
//   the knees really went (honest calories, game-design.md 6); `log` lets a room recompute the score (every finish with its
//   points, every hurdle) and names every miss in the body's words (a MissCode).
import type { Game, GameContext, GameEvent, GameManifest, InputFrame, RunSummary, StartOptions, StepResult } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { clamp, createSay, hudWriter, lanesOf, round, type HudWriter, type LaneInput, type Say } from '../kit-g1/index.ts';
import { createSelfView, type SelfView } from '../kit-g1/selfview.ts';
import { createStage, type Stage } from '../kit-g1/stage.ts';
import { en } from './strings.ts';
import { cadenceOf, clearedOf, clockOf, createSprint, hurdleIn, knockedOf, stepSprint, type HintCode, type LaneIn, type SprintEvent, type SprintState, type StepIn } from './sim.ts';
import { createSprintView, type SprintFrame, type SprintView } from './view.ts';

/** How long a reason stays on the strip after it was given. */
export const HINT_SEC = 2.6;

/** The lift a key or a tap stands for: a good stride, short of a hip-high knee. */
export const KEY_LIFT = 0.9;

/** MET of a march and of high knees, and of the seated ways (upper body, light to moderate), from the game-design.md calorie table. */
export const MET = { march: 4, high: 7.5, seated: 3 } as const;

interface Snapshot { v: 1; opts: StartOptions; quiet: boolean; state: SprintState; log: RunSummary['log'] }

export interface SprintGame extends Game {
  /** A read-only look at the simulation, for tools and tests. */
  readonly state: Readonly<SprintState> | null;
  readonly view: SprintView | null;
}

export interface SprintGameOptions {
  /** Left out: the game has no picture (tests, a shell without a canvas). Default: the 2D view when the context has a scene. */
  view?: false;
  /** Fewer or shorter heats (the end-to-end runs); the real ones come from the level. */
  heats?: number;
  dist?: number;
  restSec?: number;
}

/** One lane's movement frame as the simulation's input. */
export function readLane(l: LaneInput, o: { seated: boolean; quiet: boolean }): LaneIn {
  const steps: StepIn[] = [];
  let jumps = 0;
  for (const e of l.events) {
    if (e.kind !== 'rep') continue;
    if (e.id === 'kneeLift') steps.push({ k: e.q?.range ?? KEY_LIFT, side: e.side ?? '' });
    else if (e.id === 'jump' && !o.quiet && !o.seated) jumps++;
  }
  const c = l.channels;
  return { steps, jumps, effort: c['energy.avg'] ?? 0, knees: [c['knee.L'] ?? 0, c['knee.R'] ?? 0], torso: c['torso'] ?? 1 };
}

const SOUND: Partial<Record<SprintEvent['type'], string>> = { tick: 'tick', go: 'go', dnf: 'lose', rest: 'done', over: 'lose', complete: 'win', jump: 'jump' };

export function createSprintGame(manifest: GameManifest, o: SprintGameOptions = {}): SprintGame {
  let ctx: GameContext | null = null;
  let say: Say = createSay(undefined, en);
  let hud: HudWriter | null = null;
  let stage: Stage | null = null;
  let self: SelfView | null = null;
  let view: SprintView | null = null;
  let opts: StartOptions | null = null;
  let state: SprintState | null = null;
  let log: RunSummary['log'] = [];
  let players: 1 | 2 = 1;
  let seated = false;
  let quiet = false;
  let source: InputFrame['source'] = 'pose';
  let prevDist: number[] = [];
  let prevRival = 0;
  let prevT = 0;
  let lastRenderT = 0;
  let fx: SprintEvent[] = [];

  const need = (): SprintState => {
    if (!state) throw new Error('Call start() before step().');
    return state;
  };

  function play(name: string): void {
    try { ctx?.audio.play(name); } catch { /* sound is never worth a failed frame */ }
  }

  function buildView(): void {
    view?.dispose();
    self?.dispose();
    stage?.dispose();
    view = null; self = null; stage = null;
    if (o.view === false || !ctx?.scene2d) return;
    stage = createStage(ctx.scene2d, { rng: ctx.rng('fx'), reducedMotion: ctx.flags.reducedMotion, local2: players === 2 });
    self = createSelfView(ctx.pose, { players });
    view = createSprintView({ stage, self, say, rng: ctx.rng('fx'), reducedMotion: ctx.flags.reducedMotion, players });
  }

  const how = (): SprintFrame['how'] => (source === 'keyboard' ? 'keys' : source === 'touch' ? 'touch' : seated ? 'swing' : 'march');

  const reasonText = (code: HintCode): string => say(`miss.${code}`);

  /** What the command plate says: the move of the moment. */
  function command(s: SprintState): { icon: string; text: string } | string {
    if (s.phase === 'warmup') return seated && how() === 'swing' ? { icon: 'seated', text: say('cmd.swing') } : { icon: 'highKnee', text: say('cmd.march') };
    if (s.phase === 'ready') return say('ready.title');
    if (s.phase === 'rest') return say('cmd.rest');
    if (s.phase === 'play') {
      const soon = s.lanes.some((_, i) => hurdleIn(s, i) <= 2.2);
      if (soon) return quiet ? { icon: 'highKnee', text: say('cmd.knee') } : { icon: 'stand', text: say('cmd.jump') };
      if (s.hc < 1.2 && s.lanes.every((l) => l.dist < 6)) return say('cmd.go');
      return seated && how() === 'swing' ? { icon: 'seated', text: say('cmd.swing') } : { icon: 'highKnee', text: say('cmd.run') };
    }
    return '';
  }

  function drawHud(s: SprintState): void {
    const h = hud;
    if (!h) return;
    h.set('timer', s.duel ? Math.max(0, Math.ceil(s.duel.ms / 1000 - s.hc)) : Math.max(0, Math.floor(clockOf(s))));
    if (players === 1) {
      const l = s.lanes[0];
      if (l) {
        // In a race the score and the combo are the race's (the Room's formula, written by the shell).
        if (!s.duel) {
          h.set('score', l.score);
          const mult = 1 + Math.min(2, Math.floor(l.streak / 3));
          h.set('combo', mult > 1 ? mult : 0);
        }
        h.set('hint', l.hint && s.t - l.hint.at < HINT_SEC && s.phase === 'play' ? reasonText(l.hint.code) : '');
      }
    } else {
      s.lanes.forEach((l, i) => {
        h.player((i + 1) as 1 | 2, 'score', l.score);
        h.player((i + 1) as 1 | 2, 'hint', l.hint && s.t - l.hint.at < HINT_SEC && s.phase === 'play' ? reasonText(l.hint.code) : '');
      });
    }
    h.set('prompt', command(s));
  }

  function sounds(events: readonly SprintEvent[], s: SprintState): void {
    for (const e of events) {
      if (e.type === 'step') { if (s.phase === 'warmup') play('rep'); else if (!ctx?.flags.silent) play('metronome'); }
      else if (e.type === 'hurdle') play(e.cleared ? 'coin' : 'hit');
      else if (e.type === 'finish') play(e.medal === 'gold' ? 'win' : e.medal === 'dnf' ? 'lose' : 'done');
      else if (e.type === 'ready') play('tick');
      else { const n = SOUND[e.type]; if (n) play(n); }
    }
  }

  const medalWord = (m: string): string => say(`finish.${m}`);

  function announce(events: readonly SprintEvent[], s: SprintState): void {
    for (const e of events) {
      if (e.type === 'ready') { hud?.announce(say('announce.heat', { n: e.heat, total: s.heats, dist: s.dist })); hud?.announce(say('announce.ready')); }
      else if (e.type === 'go') hud?.announce(say('announce.go'));
      else if (e.type === 'rest') hud?.announce(say('announce.rest', { sec: Math.round(s.restLeft) }));
      else if (e.type === 'finish' && e.lane === 0) hud?.announce(say('announce.finish', { medal: medalWord(e.medal), time: e.time.toFixed(1) }));
      else if (e.type === 'hurdle' && !e.cleared && e.lane === 0) hud?.announce(reasonText(e.reason ?? 'hurdle_none'));
    }
  }

  function record(events: readonly SprintEvent[], t: number): void {
    for (const e of events) {
      const who = 'lane' in e && players === 2 ? { player: ((e.lane as number) + 1) as 1 | 2 } : {};
      if (e.type === 'finish') {
        log.push({ t, kind: 'finish', ok: true, v: e.pts, ...who });
        log.push({ t, kind: 'time', ok: true, v: round(e.time, 2), ...who });
      } else if (e.type === 'hurdle') {
        if (e.cleared) log.push({ t, kind: 'hurdle', ok: true, v: e.pts, ...who });
        else log.push({ t, kind: e.reason ?? 'hurdle_none', ok: false, ...who });
      } else if (e.type === 'dnf') log.push({ t, kind: 'dnf', ok: false, ...who });
    }
  }

  const game: SprintGame = {
    manifest,
    get state() { return state; },
    get view() { return view; },

    async init(c: GameContext): Promise<void> {
      ctx = c;
      say = createSay(c.t, en);
      hud = hudWriter(c.hud);
    },

    start(s: StartOptions): void {
      if (!ctx) throw new Error('Call init() before start().');
      opts = { ...s };
      const duel = s.mode === 'duel' ? s.duel : undefined;
      if (s.mode === 'duel' && !duel) throw new Error("Mode 'duel' needs the Room's course (StartOptions.duel).");
      players = s.mode === 'local2' ? 2 : 1;
      seated = s.seated || ctx.flags.seated;
      quiet = ctx.flags.silent;
      // A race is run on the match's seed: the Room's seed reaches the page after the session began, so the session's own
      // 'course' stream is not the one both players share.
      state = createSprint({
        difficulty: s.difficulty, players, seated, quiet, rng: duel ? rngStream(s.seed, 'course') : ctx.rng('course'),
        ...(duel ? { duel } : {
          ...(o.heats ? { heats: o.heats } : {}), ...(o.dist ? { dist: o.dist } : {}), ...(o.restSec !== undefined ? { restSec: o.restSec } : {}),
        }),
      });
      log = [];
      fx = [];
      source = 'pose';
      prevDist = state.lanes.map((l) => l.dist);
      prevRival = 0;
      prevT = lastRenderT = state.t;
      hud?.reset();
      buildView();
      drawHud(state);
    },

    step(dt: number, input: InputFrame): StepResult {
      const s = need();
      source = input.source;
      prevDist = s.lanes.map((l) => l.dist);
      prevRival = s.rival?.dist ?? 0;
      prevT = s.t;
      const ins = lanesOf(input, players).map((l) => readLane(l, { seated, quiet }));
      const events = stepSprint(s, dt, ins);
      record(events, input.t);
      fx.push(...events);
      const out: GameEvent[] = events.map((e) => ({ ...e, t: input.t }));
      return { events: out, phase: s.phase === 'over' ? 'over' : s.phase === 'complete' ? 'complete' : 'running' };
    },

    render(alpha: number): void {
      const s = state;
      if (!s) return;
      const a = clamp(alpha, 0, 1);
      const time = prevT + (s.t - prevT) * a;
      const f: SprintFrame = {
        s,
        dist: s.lanes.map((l, i) => (prevDist[i] ?? l.dist) + (l.dist - (prevDist[i] ?? l.dist)) * a),
        rival: prevRival + ((s.rival?.dist ?? 0) - prevRival) * a,
        fx,
        dt: Math.max(0, time - lastRenderT),
        time,
        reasons: s.lanes.map((l) => (l.hint && s.t - l.hint.at < HINT_SEC && s.phase === 'play' ? reasonText(l.hint.code) : null)),
        cadence: s.lanes.map((l) => cadenceOf(l, s.t)),
        how: how(),
      };
      lastRenderT = time;
      drawHud(s);
      sounds(fx, s);
      announce(fx, s);
      view?.render(f);
      fx = [];
    },

    snapshot(): Snapshot {
      const s = need();
      return { v: 1, opts: { ...(opts as StartOptions) }, quiet, state: JSON.parse(JSON.stringify(s)) as SprintState, log: log.map((e) => ({ ...e })) };
    },

    restore(snap: unknown): void {
      const p = snap as Snapshot;
      if (!p || p.v !== 1) throw new Error('Not a Knee Sprint snapshot.');
      opts = { ...p.opts };
      players = p.opts.mode === 'local2' ? 2 : 1;
      state = JSON.parse(JSON.stringify(p.state)) as SprintState;
      seated = state.seated;
      quiet = p.quiet;
      log = p.log.map((e) => ({ ...e }));
      fx = [];
      prevDist = state.lanes.map((l) => l.dist);
      prevRival = state.rival?.dist ?? 0;
      prevT = lastRenderT = state.t;
      hud?.reset();
    },

    summary(): RunSummary {
      const s = need();
      const lanes = s.lanes;
      const best = lanes.reduce((m, l) => Math.max(m, l.score), 0);
      const steps = lanes.reduce((n, l) => n + l.steps, 0);
      const cleared = lanes.reduce((n, l) => n + clearedOf(s, l), 0);
      const knocked = lanes.reduce((n, l) => n + knockedOf(s, l), 0);
      const quality = (l: SprintState['lanes'][number]): number => (l.qN > 0 ? clamp(l.qSum / l.qN, 0, 1) : 0);
      const met = (l: SprintState['lanes'][number]): number => (s.seated ? MET.seated : MET.march + (MET.high - MET.march) * quality(l));
      const metSeconds = (l: SprintState['lanes'][number]): number => round(met(l) * l.ran, 1);
      const q = lanes.reduce((m, l) => Math.max(m, quality(l)), 0);
      const sum: RunSummary = {
        score: best,
        seconds: round(s.t, 2),
        reps: steps,
        cleared,
        hits: knocked,
        bestStreak: lanes.reduce((m, l) => Math.max(m, l.bestStreak), 0),
        quality: round(q, 2),
        metSeconds: lanes.reduce((m, l) => Math.max(m, metSeconds(l)), 0),
        log: log.map((e) => ({ ...e })),
      };
      if (players === 2) {
        const per: NonNullable<RunSummary['players']> = {};
        lanes.forEach((l, i) => {
          per[(i + 1) as 1 | 2] = { score: l.score, reps: l.steps, hits: knockedOf(s, l), cleared: clearedOf(s, l), metSeconds: metSeconds(l) };
        });
        sum.players = per;
      }
      return sum;
    },

    dispose(): void {
      view?.dispose();
      self?.dispose();
      stage?.dispose();
      view = null; self = null; stage = null;
      state = null;
      ctx = null;
      hud = null;
    },
  };
  return game;
}
