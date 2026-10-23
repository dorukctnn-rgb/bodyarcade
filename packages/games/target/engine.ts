// The round engine the three target-hit games share (template C, game-design.md 0.6): a plan made from the seed once,
// a lane for each player, and one fixed step that spawns what is due, asks the judge what the hands touched and lets the
// game's rules say what that was worth. It knows nothing of stars, pads or lights: those are the rules objects
// (star-catch.ts, pad-work.ts, reaction-tag.ts).
//
// Pure: the only inputs are the InputFrame and the plan, the only clock is the step counter (step k happens at
// stepTime(k)), and everything that changes is plain data, so `restore(snapshot())` continues exactly. Randomness is
// used once, in `start`, by `rules.plan` (the course stream); the run itself never draws a random number, so the same
// seed and the same input log give the same result on any machine, and two players (or a duel) get the same plan.
import type { BodyProfile, GameEvent, InputFrame, PlayerSlot, RunSummary } from '../../core/types/index.ts';
import type { HitJudgement } from '../../core/moves/handHit.ts';
import type { Miss } from '../../core/moves/kit.ts';
import { cursorChannels, newCursor, stepCursor } from './cursor.ts';
import { envelopeOf, nominalProfile, type Envelope } from './envelope.ts';
import { Judge } from './judge.ts';
import { buildTimeline, segmentAt, timeOfStep, type Timeline } from './timeline.ts';
import {
  newStats, type BaseSpec, type LaneApi, type LaneState, type Level, type Live, type LogEntry, type Out, type Phase, type Prompt, type Rules,
  type StartInput, type StepOut, type ViewState,
} from './types.ts';

export interface EngineConfig {
  durationSec: number;
  /** Default: the rules' own. */
  rounds?: number;
  restSec?: number;
  /** MET for the honest calorie estimate. */
  met: number;
  /** System latency taken off reaction times and beat offsets, ms (camera, pose model, filter, screen). */
  latencyMs?: number;
}

export const STEP_MS = 1000 / 60;
/** A reason stays under the picture this long (ms). */
export const HINT_MS = 2400;
/** Standing still between rounds is about this much work. */
export const REST_MET = 1.5;
/** Nobody tracked for this many steps (40 s) ends the round instead of waiting for ever; the Session pauses long before. */
export const MAX_FROZEN_STEPS = 60 * 40;
/** Latency the judge and the beat grading take off, ms: camera frame to screen, until the real devices are measured. */
export const DEFAULT_LATENCY_MS = 70;

interface Lane { state: LaneState; judge: Judge; env: Envelope; ch: Readonly<Record<string, number>> }

interface Snapshot {
  v: 1;
  rules: string;
  level: Level;
  seated: boolean;
  quiet: boolean;
  keyboard: boolean;
  steps: number;
  next: number;
  frozen: number;
  plan: BaseSpec[];
  lanes: LaneState[];
  log: LogEntry[];
  phase: Phase;
}

export class TargetEngine<S extends BaseSpec> {
  readonly rules: Rules<S>;
  readonly config: EngineConfig;
  readonly timeline: Timeline;
  plan: S[] = [];
  level: Level = 'normal';
  seated = false;
  quiet = false;
  keyboard = false;
  steps = 0;
  phase: Phase = 'running';
  log: LogEntry[] = [];

  private lanes: Lane[] = [];
  private next = 0;
  private frozen = 0;
  private segIndex = -1;
  private events: GameEvent[] = [];
  private cueQueue: string[] = [];

  constructor(rules: Rules<S>, config: EngineConfig) {
    this.rules = rules;
    this.config = config;
    this.timeline = buildTimeline(config.durationSec, config.rounds ?? rules.rounds, config.restSec ?? rules.restSec);
  }

  /** Simulation time of the last step (ms). */
  get t(): number { return timeOfStep(this.steps); }
  get players(): 1 | 2 { return this.lanes.length === 2 ? 2 : 1; }
  get laneCount(): number { return this.lanes.length; }
  get latencyMs(): number { return this.config.latencyMs ?? DEFAULT_LATENCY_MS; }

  // ───────── start ─────────

  start(si: StartInput): void {
    this.level = si.level;
    this.seated = si.seated;
    this.quiet = si.quiet;
    this.keyboard = si.profiles[0] === null;
    this.steps = 0;
    this.next = 0;
    this.frozen = 0;
    this.segIndex = -1;
    this.phase = 'running';
    this.log = [];
    this.events = [];
    this.cueQueue = [];
    const given = si.profiles.length > 1 && si.profiles[1] !== undefined ? 2 : 1;
    this.lanes = [];
    for (let i = 0; i < given; i++) {
      const slot = (i + 1) as PlayerSlot;
      const p: BodyProfile = si.profiles[i] ?? nominalProfile({ seated: si.seated });
      const env = envelopeOf(p, { seated: si.seated });
      this.lanes.push({ state: this.laneState(slot, p, env), judge: new Judge({ latencyMs: this.latencyMs }), env, ch: {} });
    }
    const feet = !si.seated && !si.quiet && !this.keyboard && this.lanes.every((l) => l.env.floorY !== null);
    this.plan = this.rules.plan(si.rng, {
      level: si.level, timeline: this.timeline, seated: si.seated, quiet: si.quiet, feet, keyboard: this.keyboard,
      players: this.players, hz: Math.min(...this.lanes.map((l) => l.state.profile.hz || 30)),
    });
  }

  private laneState(slot: PlayerSlot, profile: BodyProfile, env: Envelope): LaneState {
    const unseen = { x: 0, y: 0, speed: 0, seen: false };
    return {
      slot, profile, live: [], stats: newStats(), hint: null, poseT: null, poseSeen: 0,
      cursor: this.keyboard ? newCursor() : null, x: {}, hands: { L: { ...unseen }, R: { ...unseen } }, shoulder: { x: 0, y: env.shoulderY },
    };
  }

  // ───────── one step ─────────

  step(input: InputFrame): StepOut {
    this.events = [];
    if (this.phase !== 'running') return { events: [], phase: this.phase };
    // Nobody is judged while somebody cannot be seen: the clock waits for them (the Session pauses the round anyway).
    if (!this.lanes.every((l) => trackingOf(input, l.state.slot))) {
      this.frozen++;
      if (this.frozen > MAX_FROZEN_STEPS) this.phase = 'over';
      return { events: [], phase: this.phase };
    }
    this.frozen = 0;
    this.steps++;
    const t = this.t;
    const seg = segmentAt(this.timeline, t);
    const idx = this.timeline.segments.indexOf(seg);
    if (idx !== this.segIndex) {
      if (this.segIndex >= 0) this.closeSegment();
      this.segIndex = idx;
      this.openSegment(idx);
    }
    const play = seg.kind === 'play';

    while (this.next < this.plan.length && (this.plan[this.next] as S).at <= t) {
      const spec = this.plan[this.next++] as S;
      if (!play) continue;
      for (const l of this.lanes) {
        const live = this.rules.open(spec, this.api(l), this.out(l));
        if (live) l.state.live.push(live);
      }
    }

    for (const l of this.lanes) this.stepLane(l, input, t, play);

    if (t >= this.timeline.totalMs - 1e-6) {
      this.closeSegment();
      this.phase = 'complete';
      this.cueQueue.push('done');
      this.events.push({ type: 'end', t });
    }
    return { events: this.events, phase: this.phase };
  }

  private stepLane(l: Lane, input: InputFrame, t: number, play: boolean): void {
    const s = l.state;
    l.ch = this.channelsOf(l, input, t);
    const pt = l.ch['hit.t'];
    if (pt !== undefined && Number.isFinite(pt) && pt !== s.poseT) { s.poseT = pt; s.poseSeen = t; }
    this.trackHands(l);
    if (s.hint && t >= s.hint.until) s.hint = null;
    if (!play) return;
    s.stats.playMs += STEP_MS;
    const api = this.api(l);
    const out = this.out(l);
    this.rules.tick?.(api, this.plan, out);

    const on: Live[] = [];
    for (const live of s.live) {
      const spec = this.plan[live.id] as S;
      this.rules.follow?.(spec, live, api);
      const w = this.rules.span(spec, live);
      if (t >= w.from && t < w.until) on.push(live);
    }
    if (on.length > 0) {
      for (const j of l.judge.update(l.ch, on.map((x) => x.crit))) {
        const live = s.live.find((x) => x.id === j.id);
        if (!live) continue;
        this.rules.hit(this.plan[live.id] as S, live, j as HitJudgement, api, out);
        this.drop(l, live);
      }
    }
    for (const live of [...s.live]) {
      const spec = this.plan[live.id] as S;
      if (t < this.rules.span(spec, live).until) continue;
      this.rules.expire(spec, live, l.judge.explain(live.crit), api, out);
      this.drop(l, live);
    }
  }

  private drop(l: Lane, live: Live): void {
    const i = l.state.live.indexOf(live);
    if (i >= 0) l.state.live.splice(i, 1);
    l.judge.forget(live.id);
  }

  private openSegment(idx: number): void {
    const seg = this.timeline.segments[idx] as { kind: string; round: number };
    if (seg.kind === 'play') {
      this.events.push({ type: 'round', t: this.t, n: seg.round + 1, of: this.timeline.rounds });
      this.cueQueue.push('go');
    } else {
      this.events.push({ type: 'rest', t: this.t, after: seg.round + 1 });
      this.cueQueue.push('done');
      for (const l of this.lanes) l.state.hint = null;
    }
  }

  /** Whatever is still on the screen when a round ends is over: it expires like any other target. */
  private closeSegment(): void {
    for (const l of this.lanes) {
      const api = this.api(l);
      const out = this.out(l);
      for (const live of [...l.state.live]) {
        this.rules.expire(this.plan[live.id] as S, live, l.judge.explain(live.crit), api, out);
        this.drop(l, live);
      }
      l.judge.reset();
    }
  }

  // ───────── input ─────────

  private channelsOf(l: Lane, input: InputFrame, t: number): Readonly<Record<string, number>> {
    const raw = input.players?.[l.state.slot]?.channels ?? input.channels;
    const c = l.state.cursor;
    if (!c) return raw;
    stepCursor(c, l.env, raw, 1 / 60);
    return cursorChannels(c, l.env, t);
  }

  private trackHands(l: Lane): void {
    const ch = l.ch;
    for (const side of ['L', 'R'] as const) {
      const x = ch[`hand.${side}.x`], y = ch[`hand.${side}.y`];
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      const h = l.state.hands[side];
      h.x = x; h.y = y; h.speed = ch[`hand.${side}.speed`] ?? 0; h.seen = ch[`hand.${side}.seen`] === 1;
    }
    const sx = ch['body.sx'], sy = ch['body.sy'];
    if (sx !== undefined && sy !== undefined && Number.isFinite(sx) && Number.isFinite(sy)) { l.state.shoulder.x = sx; l.state.shoulder.y = sy; }
  }

  // ───────── what the rules are given ─────────

  private api(l: Lane): LaneApi {
    const s = l.state;
    const t = this.t;
    return {
      slot: s.slot, state: s, env: l.env, stats: s.stats, x: s.x, ch: l.ch, level: this.level, seated: this.seated, quiet: this.quiet,
      keyboard: s.cursor !== null, t, seg: segmentAt(this.timeline, t),
      poseNow: () => (s.poseT === null ? t : s.poseT + (t - s.poseSeen)),
      simOf: (p) => (s.poseT === null ? p : s.poseSeen + (p - s.poseT)),
    };
  }

  private out(l: Lane): Out {
    const two = this.lanes.length === 2;
    const t = this.t;
    return {
      event: (e) => { this.events.push({ ...e, t, ...(two ? { player: l.state.slot } : {}) } as GameEvent); },
      log: (kind, ok, v) => { this.log.push({ t, kind, ok, ...(v !== undefined ? { v } : {}), ...(two ? { player: l.state.slot } : {}) }); },
      cue: (name) => { this.cueQueue.push(name); },
      hint: (code, o = {}) => {
        l.state.hint = { code, ...(o.side ? { side: o.side } : {}), ...(o.n !== undefined ? { n: o.n } : {}), at: t, until: t + (o.ms ?? HINT_MS) };
      },
    };
  }

  // ───────── read side ─────────

  /** The sounds queued by the steps since the last call; the game plays them while it draws. */
  takeCues(): string[] {
    const c = this.cueQueue;
    this.cueQueue = [];
    return c;
  }

  lane(slot: PlayerSlot): { state: LaneState; env: Envelope } | null {
    const l = this.lanes.find((x) => x.state.slot === slot);
    return l ? { state: l.state, env: l.env } : null;
  }

  /** The command plate: a rest says so, play asks the rules. */
  prompt(slot: PlayerSlot = 1): Prompt | null {
    const l = this.lanes.find((x) => x.state.slot === slot) ?? this.lanes[0];
    if (!l || this.phase === 'complete') return null;
    const seg = segmentAt(this.timeline, this.t);
    if (seg.kind === 'rest') return { key: 'rest' };
    return this.rules.prompt(this.api(l), this.plan);
  }

  view(): ViewState {
    const t = this.t;
    const seg = segmentAt(this.timeline, t);
    return {
      t,
      phase: this.phase === 'complete' ? 'done' : seg.kind,
      round: seg.round,
      rounds: this.timeline.rounds,
      left: Math.max(0, seg.end - t),
      lanes: this.lanes.map((l) => ({
        slot: l.state.slot, env: l.env, profile: l.state.profile, hands: l.state.hands, score: l.state.stats.score, streak: l.state.stats.streak,
        keyboard: l.state.cursor !== null,
        targets: l.state.live.map((live) => {
          const spec = this.plan[live.id] as S;
          return { id: live.id, x: live.x, y: live.y, r: live.r, age: Math.min(1, Math.max(0, (t - live.born) / Math.max(1, spec.life))), spec, v: live.v };
        }),
      })),
    };
  }

  summary(): RunSummary {
    const lanes = this.lanes.map((l) => l.state);
    const best = lanes.reduce((a, b) => (b.stats.score > a.stats.score ? b : a), lanes[0] as LaneState);
    const rest = Math.max(0, this.t - lanes.reduce((m, l) => Math.max(m, l.stats.playMs), 0));
    const met = (l: LaneState): number => Math.round((this.config.met * (l.stats.playMs / 1000) + REST_MET * (rest / 1000)) * 10) / 10;
    const accuracy = (l: LaneState): number => {
      const n = l.stats.hits + l.stats.misses;
      return n > 0 ? l.stats.hits / n : 0;
    };
    const sum: RunSummary = {
      score: best.stats.score,
      seconds: Math.round(this.t) / 1000,
      hits: best.stats.hits,
      cleared: best.stats.cleared,
      bestStreak: best.stats.bestStreak,
      quality: Math.round(accuracy(best) * 1000) / 1000,
      metSeconds: met(best),
      log: this.log.map((e) => ({ ...e })),
    };
    if (lanes.length === 2) {
      sum.players = {};
      for (const l of lanes) sum.players[l.slot] = { score: l.stats.score, hits: l.stats.hits, cleared: l.stats.cleared, metSeconds: met(l) };
    }
    return sum;
  }

  // ───────── snapshot ─────────

  snapshot(): Snapshot {
    return JSON.parse(JSON.stringify({
      v: 1, rules: this.rules.id, level: this.level, seated: this.seated, quiet: this.quiet, keyboard: this.keyboard,
      steps: this.steps, next: this.next, frozen: this.frozen, plan: this.plan, log: this.log, phase: this.phase,
      lanes: this.lanes.map((l) => ({ ...l.state, judge: l.judge.dump() })),
    })) as Snapshot;
  }

  restore(raw: unknown): void {
    const s = raw as Snapshot;
    if (!s || s.v !== 1 || s.rules !== this.rules.id) throw new Error(`Not a ${this.rules.id} snapshot.`);
    const copy = JSON.parse(JSON.stringify(s)) as Snapshot;
    this.level = copy.level;
    this.seated = copy.seated;
    this.quiet = copy.quiet;
    this.keyboard = copy.keyboard;
    this.steps = copy.steps;
    this.next = copy.next;
    this.frozen = copy.frozen;
    this.plan = copy.plan as S[];
    this.log = copy.log;
    this.phase = copy.phase;
    this.events = [];
    this.cueQueue = [];
    this.segIndex = this.steps > 0 ? this.timeline.segments.indexOf(segmentAt(this.timeline, this.t)) : -1;
    this.lanes = copy.lanes.map((st) => {
      const judgeState = st.judge;
      delete st.judge;
      const judge = new Judge({ latencyMs: this.latencyMs });
      judge.load(judgeState);
      return { state: st, judge, env: envelopeOf(st.profile, { seated: copy.seated }), ch: {} };
    });
  }
}

function trackingOf(input: InputFrame, slot: PlayerSlot): boolean {
  const t = input.players?.[slot]?.tracking ?? input.tracking;
  return t.ok;
}

export type { Miss };
