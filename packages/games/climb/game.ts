// Climb template: Summit Climb on the platform's Game contract.
// - start(): the walls of all three climbs (their ledges, hard parts and rock falls) are made at once from ctx.rng('course'),
//   so the same seed gives the same wall whatever happens on it. Solo only.
// - step(FIXED_DT, input): turns the movement events and channels into a ClimbIn (the counted pulls with their length and
//   side, the knee steps up a ledge, the column the player leans into, where the hands are) and steps the pure simulation.
//   No DOM, no clock, no random.
// - render(alpha): the HUD, the sounds and the picture; everything cosmetic lives here, never in step().
// - snapshot()/restore(): plain data; restore(snapshot()) continues identically.
// - summary(): metSeconds = MET x the seconds spent climbing (4.0 standing, 3.0 for the arms-only ways, game-design.md 6);
//   `log` lets a room recompute the score (every pull, step, dodge, ledge, hard part and finish with its points) and names
//   every miss in the body's words.
import type { Game, GameContext, GameEvent, GameManifest, InputFrame, RunSummary, StartOptions, StepResult } from '../../core/types/index.ts';
import { clamp, createSay, hudWriter, lanesOf, round, type HudValue, type HudWriter, type LaneInput, type Say } from '../kit-g1/index.ts';
import { createSelfView, type SelfView } from '../kit-g1/selfview.ts';
import { createStage, type Stage } from '../kit-g1/stage.ts';
import { en } from './strings.ts';
import { BREATH_SEC, clockOf, createClimb, pendingRock, stepClimb, type ClimbEvent, type ClimbIn, type ClimbState, type HandIn, type HintCode, type PullIn, type StepIn } from './sim.ts';
import { createClimbView, type ClimbFrame, type ClimbView } from './view.ts';

/** How long a reason stays on the strip after it was given. */
export const HINT_SEC = 2.6;

/** The lift a tap or a key stands for when stepping up a ledge. */
export const KEY_LIFT = 0.9;

/** MET of a standing climb and of the arms-only ways (game-design.md calorie table: whole body, moderate; upper body, light to moderate). */
export const MET = { standing: 4, seated: 3 } as const;

interface Snapshot { v: 1; opts: StartOptions; quiet: boolean; state: ClimbState; log: RunSummary['log'] }

export interface ClimbGame extends Game {
  /** A read-only look at the simulation, for tools and tests. */
  readonly state: Readonly<ClimbState> | null;
  readonly view: ClimbView | null;
}

export interface ClimbGameOptions {
  /** Left out: the game has no picture (tests, a shell without a canvas). Default: the 2D view when the context has a scene. */
  view?: false;
  /** Fewer or shorter climbs, a lower top, a shorter rest (the end-to-end runs); the real ones come from the level. */
  sets?: number;
  setSec?: number;
  summit?: number;
  restSec?: number;
}

/** The movement events and channels of one frame as the simulation's input. */
export function readIn(l: LaneInput, o: { seated: boolean; quiet: boolean }): ClimbIn {
  const pulls: PullIn[] = [];
  const steps: StepIn[] = [];
  for (const e of l.events) {
    if (e.kind !== 'rep') continue;
    if (e.id === 'pull') pulls.push({ side: e.side ?? '', amp: (e.q?.range ?? 0) * (e.value ?? 1), shrug: e.warn?.includes('shrug') === true });
    else if (e.id === 'kneeLift' && !o.seated && !o.quiet) steps.push({ k: e.q?.range ?? KEY_LIFT, side: e.side ?? '' });
  }
  const c = l.channels;
  const have = 'reach.L' in c || 'reach.R' in c;
  const hand = (side: 'L' | 'R'): HandIn => ({ have, reach: c[`reach.${side}`] ?? -1, prog: c[`pull.${side}`] ?? 0, grab: (c[`grab.${side}`] ?? 0) > 0.5 });
  const lane = (c['lane'] ?? 0) < -0.5 ? -1 : (c['lane'] ?? 0) > 0.5 ? 1 : 0;
  return { pulls, steps, lane, hands: [hand('L'), hand('R')] };
}

const SOUND: Partial<Record<ClimbEvent['type'], string>> = { tick: 'tick', go: 'go', dnf: 'lose', rest: 'done', over: 'lose', complete: 'win', summit: 'win' };

export function createClimbGame(manifest: GameManifest, o: ClimbGameOptions = {}): ClimbGame {
  let ctx: GameContext | null = null;
  let say: Say = createSay(undefined, en);
  let hud: HudWriter | null = null;
  let stage: Stage | null = null;
  let self: SelfView | null = null;
  let view: ClimbView | null = null;
  let opts: StartOptions | null = null;
  let state: ClimbState | null = null;
  let log: RunSummary['log'] = [];
  let seated = false;
  let quiet = false;
  let source: InputFrame['source'] = 'pose';
  let lastIn: ClimbIn | null = null;
  let prevH = 0;
  let prevT = 0;
  let lastRenderT = 0;
  let metres = 0;
  let lastMult = 1;
  let fx: ClimbEvent[] = [];

  const need = (): ClimbState => {
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
    stage = createStage(ctx.scene2d, { rng: ctx.rng('fx'), reducedMotion: ctx.flags.reducedMotion, local2: false });
    self = createSelfView(ctx.pose, { players: 1 });
    view = createClimbView({ stage, self, say, rng: ctx.rng('fx'), reducedMotion: ctx.flags.reducedMotion });
  }

  const how = (): ClimbFrame['how'] => (source === 'keyboard' ? 'keys' : source === 'touch' ? 'touch' : seated || quiet ? 'seated' : 'pose');

  const reasonText = (code: HintCode): string => say(`miss.${code}`);

  const multOf = (streak: number): number => 1 + Math.min(2, Math.floor(streak / 10));

  /** The lean the player is asked for, or null: only when a rock is coming down the column he hangs in. */
  function leanCommand(s: ClimbState): string | null {
    const pr = pendingRock(s);
    if (!pr || !pr.warned || !pr.rock.closed[s.c.lane + 1]) return null;
    const dirs = ([-1, 0, 1] as const).filter((k) => !pr.rock.closed[k + 1]).map((k) => Math.sign(k - s.c.lane));
    if (dirs.length === 0) return null;
    return dirs.every((d) => d < 0) ? say('cmd.leanLeft') : dirs.every((d) => d > 0) ? say('cmd.leanRight') : say('cmd.leanAside');
  }

  /** What the command plate says: the move of the moment. */
  function command(s: ClimbState): HudValue {
    const c = s.c;
    const handsUp = (): HudValue => {
      if (how() === 'keys' || how() === 'touch') return { icon: 'pull', text: say('cmd.pullkey') };
      const h = lastIn?.hands;
      return h && (h[0].grab || h[1].grab) ? { icon: 'pull', text: say('cmd.pull') } : { icon: 'reach', text: say('cmd.reach') };
    };
    if (s.phase === 'warmup') return handsUp();
    if (s.phase === 'ready') return say('ready.title');
    if (s.phase === 'rest') return say('cmd.rest');
    if (s.phase === 'climb') {
      if (c.breath > 0 || c.on === 'rest') return { icon: 'stand', text: say('cmd.breath'), progress: clamp(1 - c.breath / BREATH_SEC, 0, 1) };
      const lean = leanCommand(s);
      if (lean) return lean;
      if (c.on === 'ledge') return { icon: 'highKnee', text: say('cmd.step') };
      if (c.cruxOn) return { icon: 'pull', text: say('cmd.crux') };
      return handsUp();
    }
    return '';
  }

  function drawHud(s: ClimbState): void {
    const h = hud;
    if (!h) return;
    const c = s.c;
    h.set('timer', Math.max(0, Math.ceil(clockOf(s) - 1e-9)));
    h.set('score', c.score);
    const mult = multOf(c.streak);
    h.set('combo', mult > 1 ? mult : 0);
    h.set('hint', c.hint && s.t - c.hint.at < HINT_SEC && s.phase === 'climb' ? reasonText(c.hint.code) : '');
    h.set('prompt', command(s));
  }

  function sounds(events: readonly ClimbEvent[]): void {
    for (const e of events) {
      if (e.type === 'pull') { play(e.mult > lastMult ? 'rep-best' : 'rep'); lastMult = e.mult; }
      else if (e.type === 'warmup') play('rep');
      else if (e.type === 'step') play('pass');
      else if (e.type === 'warn') { if (e.threat) play('warn'); }
      else if (e.type === 'rock') { if (e.hit) play('hit'); else if (e.pts > 0) play('good'); }
      else if (e.type === 'ledge') play(e.phase === 'done' ? 'coin' : 'tick');
      else if (e.type === 'crux') play(e.phase === 'pass' ? 'perfect' : e.phase === 'fail' ? 'miss' : 'tick');
      else if (e.type === 'breath') play(e.phase === 'start' ? 'ui-back' : 'tick');
      else if (e.type === 'finish') play(e.medal === 'gold' ? 'win' : e.medal === 'dnf' ? 'lose' : 'done');
      else if (e.type === 'ready') play('tick');
      else { const n = SOUND[e.type]; if (n) play(n); }
    }
  }

  const medalWord = (m: string): string => say(`finish.${m}`);

  function announce(events: readonly ClimbEvent[], s: ClimbState): void {
    for (const e of events) {
      if (e.type === 'ready') { hud?.announce(say('announce.set', { n: e.set, total: s.sets, top: Math.round(s.summit) })); hud?.announce(say('announce.ready')); }
      else if (e.type === 'go') hud?.announce(say('announce.go'));
      else if (e.type === 'warn' && e.threat) {
        const safe = ([-1, 0, 1] as const).filter((k) => !e.closed[k + 1]).map((k) => Math.sign(k - s.c.lane));
        const dir = safe.every((d) => d < 0) ? say('announce.left') : safe.every((d) => d > 0) ? say('announce.right') : say('announce.aside');
        hud?.announce(say('announce.rock', { dir }), { assertive: true });
      }
      else if (e.type === 'ledge' && e.phase === 'reach') hud?.announce(say('announce.ledge'));
      else if (e.type === 'crux' && e.phase === 'start') hud?.announce(say('announce.crux'));
      else if (e.type === 'breath' && e.phase === 'start') hud?.announce(say('announce.breath'));
      else if (e.type === 'summit') hud?.announce(say('announce.summit', { sec: Math.round(e.left) }));
      else if (e.type === 'finish') hud?.announce(say('announce.finish', { medal: medalWord(e.medal), height: Math.round(e.height) }));
      else if (e.type === 'rest') hud?.announce(say('announce.rest', { sec: Math.round(s.restSec) }));
      else if ((e.type === 'pull' || e.type === 'step') && Math.floor(e.h / 10) > metres) { metres = Math.floor(e.h / 10); hud?.announce(say('announce.height', { h: metres * 10 })); }
      else if (e.type === 'hint' && e.code === 'rock_hit') hud?.announce(reasonText(e.code));
    }
  }

  function record(events: readonly ClimbEvent[], t: number): void {
    for (const e of events) {
      switch (e.type) {
        case 'pull': log.push({ t, kind: 'pull', ok: true, v: e.pts }); break;
        case 'step': log.push({ t, kind: 'step', ok: true, v: e.pts }); break;
        case 'rock': if (e.hit) log.push({ t, kind: 'rock_hit', ok: false }); else if (e.pts > 0) log.push({ t, kind: 'dodge', ok: true, v: e.pts }); break;
        case 'ledge': if (e.phase === 'done') log.push({ t, kind: 'ledge', ok: true, v: e.pts }); break;
        case 'crux': if (e.phase === 'pass') log.push({ t, kind: 'crux', ok: true, v: e.pts }); else if (e.phase === 'fail') log.push({ t, kind: 'crux_slow', ok: false }); break;
        case 'finish': log.push({ t, kind: 'finish', ok: true, v: e.pts }); log.push({ t, kind: 'height', ok: true, v: round(e.height, 1) }); break;
        case 'dnf': log.push({ t, kind: 'dnf', ok: false }); break;
        default: break;
      }
    }
  }

  const game: ClimbGame = {
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
      seated = s.seated || ctx.flags.seated;
      quiet = ctx.flags.silent;
      state = createClimb({
        difficulty: s.difficulty, seated, quiet, rng: ctx.rng('course'),
        ...(o.sets ? { sets: o.sets } : {}), ...(o.setSec ? { setSec: o.setSec } : {}), ...(o.summit ? { summit: o.summit } : {}), ...(o.restSec !== undefined ? { restSec: o.restSec } : {}),
      });
      log = [];
      fx = [];
      source = 'pose';
      lastIn = null;
      metres = 0;
      lastMult = 1;
      prevH = 0;
      prevT = lastRenderT = state.t;
      hud?.reset();
      buildView();
      drawHud(state);
    },

    step(dt: number, input: InputFrame): StepResult {
      const s = need();
      source = input.source;
      prevH = s.c.h;
      prevT = s.t;
      const lane = lanesOf(input, 1)[0] as LaneInput;
      const ins = readIn(lane, { seated, quiet });
      lastIn = ins;
      const events = stepClimb(s, dt, ins);
      if (s.phase === 'ready' || s.phase === 'warmup') metres = 0;
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
      const f: ClimbFrame = {
        s,
        h: prevH + (s.c.h - prevH) * a,
        fx,
        dt: Math.max(0, time - lastRenderT),
        time,
        reason: s.c.hint && s.t - s.c.hint.at < HINT_SEC && s.phase === 'climb' ? reasonText(s.c.hint.code) : null,
        how: how(),
      };
      lastRenderT = time;
      drawHud(s);
      sounds(fx);
      announce(fx, s);
      view?.render(f);
      fx = [];
    },

    snapshot(): Snapshot {
      const s = need();
      return { v: 1, opts: { ...(opts as StartOptions) }, quiet, state: JSON.parse(JSON.stringify(s)) as ClimbState, log: log.map((e) => ({ ...e })) };
    },

    restore(snap: unknown): void {
      const p = snap as Snapshot;
      if (!p || p.v !== 1) throw new Error('Not a Summit Climb snapshot.');
      opts = { ...p.opts };
      state = JSON.parse(JSON.stringify(p.state)) as ClimbState;
      seated = state.seated;
      quiet = p.quiet;
      log = p.log.map((e) => ({ ...e }));
      fx = [];
      lastIn = null;
      metres = Math.floor(state.c.h / 10);
      prevH = state.c.h;
      prevT = lastRenderT = state.t;
      hud?.reset();
    },

    summary(): RunSummary {
      const s = need();
      const c = s.c;
      const live = s.phase === 'climb' || s.phase === 'warmup' ? { pulls: c.pulls, steps: c.steps, hits: c.hits, dodged: c.dodged, ledges: c.ledges, crux: c.crux } : { pulls: 0, steps: 0, hits: 0, dodged: 0, ledges: 0, crux: 0 };
      const sum = (f: (r: ClimbState['c']['results'][number]) => number): number => c.results.reduce((n, r) => n + f(r), 0);
      const pulls = sum((r) => r.pulls) + live.pulls;
      const steps = sum((r) => r.steps) + live.steps;
      const hits = sum((r) => r.hits) + live.hits;
      const cleared = sum((r) => r.dodged + r.ledges + r.crux) + live.dodged + live.ledges + live.crux;
      const met = seated || quiet ? MET.seated : MET.standing;
      return {
        score: c.score,
        seconds: round(s.t, 2),
        reps: pulls + steps,
        cleared,
        hits,
        bestStreak: c.bestStreak,
        quality: round(c.qN > 0 ? clamp(c.qSum / c.qN, 0, 1) : 0, 2),
        metSeconds: round(met * c.ran, 1),
        log: log.map((e) => ({ ...e })),
      };
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

