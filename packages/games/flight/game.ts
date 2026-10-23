// Flight template: Squat Flap on the platform's Game contract.
// - start(): the course is made at once from ctx.rng('course') (makeCourse), so the same seed gives the same columns
//   whatever happens in the run. Mode 'local2' makes two lanes on that one course.
// - step(FIXED_DT, input): turns the movement events and channels of each player into a LaneIn (flaps with their power
//   and depth, how deep the hips are, whether the glide is on) and steps the pure simulation. No DOM, no clock, no random.
// - render(alpha): the HUD, the sounds and the picture; everything cosmetic lives here, never in step().
// - snapshot()/restore(): plain data; restore(snapshot()) continues identically.
// - summary(): metSeconds = MET x the seconds spent flapping (warm-up and sets, not the rests); `log` lets a room recompute
//   the score (every pass with its points) and names every miss in the body's words (a MissCode).
import type { Game, GameContext, GameEvent, GameManifest, InputEvent, InputFrame, RunSummary, StartOptions, StepResult } from '../../core/types/index.ts';
import { clamp, createSay, hudWriter, lanesOf, round, type HudWriter, type LaneInput, type Say } from '../kit-g1/index.ts';
import { createSelfView, type SelfView } from '../kit-g1/selfview.ts';
import { createStage, type Stage } from '../kit-g1/stage.ts';
import { en } from './strings.ts';
import {
  createFlight, gapCentre, levelFor, nextPipe, planOf, stepFlight, timeLeft, type FlapIn, type FlightEvent, type FlightState, type HintCode, type LaneIn,
} from './sim.ts';
import { createFlightView, type FlightFrame, type FlightView } from './view.ts';

/** How long a reason stays on the strip after it was given. */
export const HINT_SEC = 2.6;

interface Snapshot { v: 1; opts: StartOptions; state: FlightState; log: RunSummary['log']; flapsDeep: number[]; flapsAll: number[] }

export interface FlightGame extends Game {
  /** A read-only look at the simulation, for tools and tests. */
  readonly state: Readonly<FlightState> | null;
  readonly view: FlightView | null;
}

export interface FlightGameOptions {
  /** Left out: the game has no picture (tests, a shell without a canvas). Default: the 2D view when the context has a scene. */
  view?: false;
}

/** Hands level at the shoulders and spread to the sides (armDirection's glide); its own channel names are used because
 *  'glide' is also the squat's and the later detector wins in the engine. */
const ARM_GLIDE = { level: 0.2, spread: 0.7 } as const;

/** One lane's movement frame as the simulation's input. */
export function readLane(l: LaneInput, seated: boolean): LaneIn {
  const flaps: FlapIn[] = [];
  for (const e of l.events as readonly InputEvent[]) {
    if (e.kind !== 'rep') continue;
    if (e.id === 'squat') flaps.push({ power: e.value ?? 1, depth: e.q?.depth });
    else if (e.id === 'armDirection' && seated) flaps.push({ power: e.value ?? 1, depth: undefined });
  }
  const c = l.channels;
  const armGlide = seated && (c['spread'] ?? 0) >= ARM_GLIDE.spread && Math.abs(c['wing'] ?? 9) <= ARM_GLIDE.level;
  return { flaps, drop: Math.max(0, c['drop'] ?? 0), glide: (c['glide'] ?? 0) >= 0.5 || armGlide, armed: (c['armed'] ?? 0) >= 0.5 };
}

const SOUND: Partial<Record<FlightEvent['type'], string>> = { hit: 'hit', out: 'lose', rest: 'done', complete: 'win', over: 'lose', ready: 'tick' };

export function createFlightGame(manifest: GameManifest, o: FlightGameOptions = {}): FlightGame {
  let ctx: GameContext | null = null;
  let say: Say = createSay(undefined, en);
  let hud: HudWriter | null = null;
  let stage: Stage | null = null;
  let self: SelfView | null = null;
  let view: FlightView | null = null;
  let opts: StartOptions | null = null;
  let state: FlightState | null = null;
  let log: RunSummary['log'] = [];
  let players: 1 | 2 = 1;
  let seated = false;
  let source: InputFrame['source'] = 'pose';
  let flapsAll = [0, 0];
  let flapsDeep = [0, 0];
  let prevScroll = 0;
  let prevY: number[] = [];
  let prevT = 0;
  let lastRenderT = 0;
  let fx: FlightEvent[] = [];
  let coach: { text: 'squat' | 'stand' | ''; until: number } = { text: '', until: 0 };

  const need = (): FlightState => {
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
    view = createFlightView({ stage, self, say, rng: ctx.rng('fx'), reducedMotion: ctx.flags.reducedMotion, players });
  }

  const how = (): FlightFrame['how'] => (source === 'keyboard' ? 'keys' : source === 'touch' ? 'touch' : seated ? 'arms' : 'squat');

  function reasonText(code: HintCode): string { return say(`miss.${code}`); }

  /** What the command plate says: the warm-up's two moves, the pauses, and on the easy level a coach. */
  function command(s: FlightState): { icon: string; text: string } | string {
    if (s.phase === 'warmup') {
      const l = s.lanes[0];
      const hold = !!l && (l.glide > 0.5 || l.armed);
      if (seated || how() === 'arms') return hold ? { icon: 'stand', text: say('cmd.armsDown') } : { icon: 'reach', text: say('cmd.armsUp') };
      return hold ? { icon: 'stand', text: say('cmd.stand') } : { icon: 'squat', text: say('cmd.squat') };
    }
    if (s.phase === 'rest') return say(s.ready > 0 ? 'ready.title' : 'rest.title');
    if (s.phase === 'play' && s.difficulty === 'easy' && players === 1) {
      if (s.t >= coach.until) {
        const l = s.lanes[0];
        const p = nextPipe(s, 0);
        const target = p ? gapCentre(p, s.active) : 0.5;
        const next = !l ? '' : l.glide > 0.5 || l.armed ? 'stand' : l.y > target + 0.05 ? 'squat' : '';
        if (next !== coach.text) coach = { text: next, until: s.t + 0.5 };
      }
      if (coach.text === 'squat') return { icon: 'squat', text: say('cmd.squat') };
      if (coach.text === 'stand') return { icon: 'stand', text: say('cmd.stand') };
    }
    return '';
  }

  function drawHud(s: FlightState): void {
    const h = hud;
    if (!h) return;
    h.set('timer', Math.max(0, Math.ceil(s.phase === 'warmup' ? planOf(levelFor(s)).setSec : timeLeft(s))));
    if (players === 1) {
      const l = s.lanes[0];
      if (l) {
        h.set('score', l.score);
        h.set('lives', l.lives);
        const mult = 1 + Math.min(2, Math.floor(l.streak / 5));
        h.set('combo', mult > 1 ? mult : 0);
        h.set('hint', l.hint && s.t - l.hint.at < HINT_SEC ? reasonText(l.hint.code) : '');
      }
    } else {
      s.lanes.forEach((l, i) => {
        h.player((i + 1) as 1 | 2, 'score', l.score);
        h.player((i + 1) as 1 | 2, 'hint', l.hint && s.t - l.hint.at < HINT_SEC ? reasonText(l.hint.code) : '');
      });
    }
    h.set('prompt', command(s));
  }

  function sounds(events: readonly FlightEvent[], s: FlightState): void {
    for (const e of events) {
      if (e.type === 'flap') play(s.phase === 'warmup' ? 'rep' : 'flap');
      else if (e.type === 'pass') { play(e.centre ? 'star' : 'pass'); if (e.streak % 5 === 0) play('rep-best'); }
      else if (e.type === 'start') play('go');
      else { const n = SOUND[e.type]; if (n) play(n); }
    }
  }

  function announce(events: readonly FlightEvent[], s: FlightState): void {
    const plan = planOf(levelFor(s));
    for (const e of events) {
      if (e.type === 'start' && plan.sets > 1) hud?.announce(say('announce.set', { n: e.set, total: plan.sets }));
      else if (e.type === 'rest') hud?.announce(say('announce.rest', { sec: plan.restSec }));
      else if (e.type === 'ready') hud?.announce(say('announce.ready'));
    }
  }

  const game: FlightGame = {
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
      players = s.mode === 'local2' ? 2 : 1;
      seated = s.seated || ctx.flags.seated;
      state = createFlight({ difficulty: s.difficulty, players, seated, rng: ctx.rng('course') });
      log = [];
      flapsAll = [0, 0];
      flapsDeep = [0, 0];
      fx = [];
      source = 'pose';
      coach = { text: '', until: 0 };
      prevScroll = state.scroll;
      prevY = state.lanes.map((l) => l.y);
      prevT = lastRenderT = state.t;
      hud?.reset();
      buildView();
      drawHud(state);
    },

    step(dt: number, input: InputFrame): StepResult {
      const s = need();
      source = input.source;
      prevScroll = s.scroll;
      prevY = s.lanes.map((l) => l.y);
      prevT = s.t;
      const ins = lanesOf(input, players).map((l) => readLane(l, seated));
      const events = stepFlight(s, dt, ins);
      const out: GameEvent[] = [];
      for (const e of events) {
        out.push({ ...e, t: input.t });
        const lane = 'lane' in e ? e.lane : 0;
        if (e.type === 'flap') { flapsAll[lane] = (flapsAll[lane] ?? 0) + 1; if (e.scale >= 0.85) flapsDeep[lane] = (flapsDeep[lane] ?? 0) + 1; }
        else if (e.type === 'pass') log.push({ t: input.t, kind: 'pass', ok: true, v: e.pts, ...(players === 2 ? { player: (lane + 1) as 1 | 2 } : {}) });
        else if (e.type === 'hit') log.push({ t: input.t, kind: e.reason, ok: false, ...(players === 2 ? { player: (lane + 1) as 1 | 2 } : {}) });
      }
      fx.push(...events);
      return { events: out, phase: s.phase === 'over' ? 'over' : s.phase === 'complete' ? 'complete' : 'running' };
    },

    render(alpha: number): void {
      const s = state;
      if (!s) return;
      const a = clamp(alpha, 0, 1);
      const time = prevT + (s.t - prevT) * a;
      const f: FlightFrame = {
        s,
        scroll: prevScroll + (s.scroll - prevScroll) * a,
        y: s.lanes.map((l, i) => (prevY[i] ?? l.y) + (l.y - (prevY[i] ?? l.y)) * a),
        fx,
        dt: Math.max(0, time - lastRenderT),
        time,
        reasons: s.lanes.map((l) => (l.hint && s.t - l.hint.at < HINT_SEC ? reasonText(l.hint.code) : null)),
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
      return { v: 1, opts: { ...(opts as StartOptions) }, state: JSON.parse(JSON.stringify(s)) as FlightState, log: log.map((e) => ({ ...e })), flapsDeep: [...flapsDeep], flapsAll: [...flapsAll] };
    },

    restore(snap: unknown): void {
      const p = snap as Snapshot;
      if (!p || p.v !== 1) throw new Error('Not a Squat Flap snapshot.');
      opts = { ...p.opts };
      players = p.opts.mode === 'local2' ? 2 : 1;
      state = JSON.parse(JSON.stringify(p.state)) as FlightState;
      seated = state.seated;
      log = p.log.map((e) => ({ ...e }));
      flapsAll = [...p.flapsAll];
      flapsDeep = [...p.flapsDeep];
      fx = [];
      prevScroll = state.scroll;
      prevY = state.lanes.map((l) => l.y);
      prevT = lastRenderT = state.t;
      hud?.reset();
    },

    summary(): RunSummary {
      const s = need();
      const lanes = s.lanes;
      const best = lanes.reduce((m, l) => Math.max(m, l.score), 0);
      const flaps = lanes.reduce((n, l) => n + l.flaps, 0);
      const passes = lanes.reduce((n, l) => n + l.passes, 0);
      const hits = lanes.reduce((n, l) => n + l.hits, 0);
      const deep = flapsDeep.reduce((n, v) => n + v, 0);
      const flown = s.active + s.warm.t;
      const sum: RunSummary = {
        score: best,
        seconds: round(s.t, 2),
        reps: flaps,
        cleared: passes,
        hits,
        bestStreak: lanes.reduce((m, l) => Math.max(m, l.bestStreak), 0),
        quality: flaps > 0 ? round(deep / flaps, 2) : 0,
        metSeconds: round(manifest.met * flown, 1),
        log: log.map((e) => ({ ...e })),
      };
      if (players === 2) {
        const per: NonNullable<RunSummary['players']> = {};
        lanes.forEach((l, i) => { per[(i + 1) as 1 | 2] = { score: l.score, reps: l.flaps, hits: l.hits, cleared: l.passes, metSeconds: round(manifest.met * flown, 1) }; });
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
