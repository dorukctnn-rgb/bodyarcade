// Twist Turbine (card 18, template E strength): twist the body from side to side to spin a wind turbine and power a city.
//
// The run (game-design.md card 18): three sets of 50 seconds with 15 seconds of rest between them (180 s), then a short
// outro in which the city shows what it was given. Each twist from one side to the other is a repetition (the `twist`
// detector, core/moves/twist.ts, or the left and right keys). A repetition pushes the turbine; the turbine's speed fades
// by itself; the city's windows light block by block with the power the player keeps up. Points are given per repetition
// for the range of the twist and for keeping the pace inside a band of twists a minute that depends on the level
// ("hedef güç bandı"): below the band the repetition counts less, above it the extra is lost.
//
// Storms (card 18: "kesintilerde hızlı dön, aşırı yükte dönük pozisyonda tut"), one or more per set, seeded:
//   blackout  the lights go out: twist fast, a number of repetitions in eight seconds, and the lights come back (bonus);
//   overload  the turbine overheats: hold a twist to the side shown for a few seconds (bonus).
// A failed storm costs nothing but the bonus.
//
// Misses (the reason strip): from the channels the detector publishes (tau, span, gap) the way core/moves/twist.ts explains
// them: "Turn further", "Turn from the shoulders", "Hands too far apart". Keyboard and touch have no channels to explain.
//
// Pure and fixed-step, like fireworks.ts: plain-data state, seeded storms, snapshot and restore.
import type { RunSummary } from '../../core/types/index.ts';
import { TWIST_DEFAULTS } from '../../core/moves/twist.ts';
import type { FrameIn } from '../_shared/frame.ts';
import type { HostSim, Phase, SimEvent, SimSetup } from '../_shared/host.ts';
import type { MissNote } from '../_shared/reasons.ts';
import { clamp, copyData, median, msOf, randInt, round, stepsOf } from '../_shared/util.ts';
import { difficultyOf, logOf, type Difficulty, type LogEntry } from './kit.ts';

// ───────── the plan ─────────

export interface TtTiming { sets: number; workS: number; restS: number; finaleS: number }

/** Three sets of 50 s and two rests of 15 s are the 180 s of the manifest; the outro comes after. */
export const TT_TIMING: TtTiming = { sets: 3, workS: 50, restS: 15, finaleS: 4 };

export interface TtLevel {
  /** The band of twists a minute that gives full power. */
  band: readonly [number, number];
  /** Seconds to hold in an overload. */
  holdS: number;
  /** Storms per set. */
  storms: readonly [number, number];
}

/** Unmeasured (game-design.md "Dürüstlük notu"): the recording day sets the bands. */
export const TT_LEVELS: Readonly<Record<Difficulty, TtLevel>> = {
  easy: { band: [20, 34], holdS: 2, storms: [1, 1] },
  normal: { band: [28, 44], holdS: 3, storms: [1, 2] },
  hard: { band: [36, 54], holdS: 4, storms: [2, 2] },
  expert: { band: [44, 64], holdS: 5, storms: [2, 3] },
};

export type StormKind = 'blackout' | 'overload';

export interface Storm {
  kind: StormKind;
  startK: number;
  /** The step by which it must be answered. */
  endK: number;
  /** Overload: the side to hold (-1 left, +1 right) and for how many steps. */
  side: -1 | 1;
  holdSteps: number;
  /** Blackout: repetitions needed. */
  need: number;
}

interface Segment { kind: 'work' | 'rest' | 'finale'; startK: number; endK: number; set: number }

export interface TtPlan {
  segments: Segment[];
  endK: number;
  storms: Storm[];
  band: readonly [number, number];
  holdS: number;
  timing: TtTiming;
}

const BLACKOUT_S = 8;
const OVERLOAD_S = 8;
const STORM_BONUS = { blackout: 150, overload: 200 } as const;
const BASE_POINTS = 10;
/** A repetition counts toward the pace over this many seconds. */
const RATE_WINDOW_S = 6;
const HINT_STEPS = 90;
const IDLE_HINT_S = 8;
/** Seconds of movement for calories and the like: a twist within this long counts. */
const ACTIVE_STEPS = 240;
/** Variants move less than the full twist (unmeasured). */
export const TT_VARIANT_MET: Readonly<Record<'standing' | 'seated', number>> = { standing: 1, seated: 0.8 };
const POWER_EASE = 1 - Math.exp(-1 / 60 / 1.2);
const OMEGA_DECAY = 1 / (2 * 60);
const IMPULSE = 0.28;

export function makeTtPlan(difficulty: Difficulty, timing: TtTiming, rng: () => number): TtPlan {
  const level = TT_LEVELS[difficulty];
  const segments: Segment[] = [];
  const storms: Storm[] = [];
  let k = 0;
  for (let i = 0; i < timing.sets; i++) {
    const work = stepsOf(timing.workS);
    segments.push({ kind: 'work', startK: k, endK: k + work, set: i });
    // storms: spread over the set, never in the first ten seconds or the last six, at least 14 seconds apart
    const count = randInt(rng, level.storms[0], level.storms[1]);
    const from = stepsOf(Math.min(10, timing.workS * 0.25)), to = work - stepsOf(Math.min(6, timing.workS * 0.15));
    for (let j = 0; j < count; j++) {
      const slot = (to - from) / count;
      const startK = k + from + Math.floor(slot * j + rng() * slot * 0.5);
      const kind: StormKind = rng() < 0.5 ? 'blackout' : 'overload';
      const lenS = kind === 'blackout' ? BLACKOUT_S : OVERLOAD_S;
      const hi = level.band[1];
      storms.push({
        kind, startK, endK: Math.min(k + work - 1, startK + stepsOf(lenS)),
        side: rng() < 0.5 ? -1 : 1, holdSteps: stepsOf(level.holdS), need: clamp(Math.round(((hi * BLACKOUT_S) / 60) * 0.7), 3, 9),
      });
    }
    k += work;
    if (i < timing.sets - 1) {
      const rest = stepsOf(timing.restS);
      segments.push({ kind: 'rest', startK: k, endK: k + rest, set: i });
      k += rest;
    }
  }
  const fin = stepsOf(timing.finaleS);
  segments.push({ kind: 'finale', startK: k, endK: k + fin, set: timing.sets - 1 });
  return { segments, endK: k + fin, storms, band: level.band, holdS: level.holdS, timing };
}

// ───────── state ─────────

export interface TtPlayer {
  score: number;
  /** Repetitions: twists from one side to the other. */
  reps: number;
  inBand: number;
  streak: number;
  bestStreak: number;
  /** The side the last repetition ended on (-1 left, +1 right, 0 none yet). */
  side: -1 | 0 | 1;
  repKs: number[];
  /** Turbine: speed in turns a second and angle in turns. */
  omega: number;
  angle: number;
  /** Power the city is given, 0..1, and the share of its windows that are lit, 0..1. */
  power: number;
  lit: number;
  /** Quality of the last few repetitions, for the power. */
  recent: number[];
  lastRepK: number;
  activeSteps: number;
  /** The channels of the last two seconds at 10 Hz: [step, tau, span, gap]. */
  hist: [number, number, number, number][];
  miss: (MissNote & { k: number }) | null;
  lastMissK: number;
  /** The side the body is twisted to right now (the detector's `side` channel, or the keys). */
  held: -1 | 0 | 1;
}

interface StormState {
  /** Index into the plan's storms of the one on now, or -1. */
  on: number;
  /** Blackout: repetitions so far. Overload: steps held in a row. */
  progress: number;
  /** Overload: the last step the right side was seen (a short gap does not break the hold). */
  lastSeenK: number;
  done: boolean[];
  /** Per storm: 1 answered, 0 failed, -1 not decided yet. */
  result: number[];
}

interface TtState {
  v: 1;
  k: number;
  phase: Phase;
  plan: TtPlan;
  seg: number;
  player: TtPlayer;
  storm: StormState;
  log: LogEntry[];
  idleHintK: number;
}

export interface TtOptions {
  setup: Pick<SimSetup, 'start' | 'flags' | 'players' | 'audioLatencyMs' | 'rng'>;
  met: number;
  timing?: Partial<TtTiming>;
}

const newPlayer = (): TtPlayer => ({
  score: 0, reps: 0, inBand: 0, streak: 0, bestStreak: 0, side: 0, repKs: [], omega: 0, angle: 0, power: 0, lit: 0.08, recent: [], lastRepK: -100000, activeSteps: 0,
  hist: [], miss: null, lastMissK: -100000, held: 0,
});

// ───────── the simulation ─────────

export class TurbineSim implements HostSim {
  private s: TtState;
  private readonly seated: boolean;
  private readonly met: number;
  private readonly difficulty: Difficulty;

  constructor(o: TtOptions) {
    const { start, rng } = o.setup;
    this.seated = start.seated;
    this.met = o.met;
    this.difficulty = difficultyOf(start.difficulty);
    const plan = makeTtPlan(this.difficulty, { ...TT_TIMING, ...o.timing }, rng);
    this.s = {
      v: 1, k: 0, phase: 'running', plan, seg: 0, player: newPlayer(),
      storm: { on: -1, progress: 0, lastSeenK: 0, done: plan.storms.map(() => false), result: plan.storms.map(() => -1) },
      log: [], idleHintK: 0,
    };
  }

  // ───── what the view, the HUD and the tests read ─────

  get phase(): Phase { return this.s.phase; }
  get k(): number { return this.s.k; }
  get plan(): Readonly<TtPlan> { return this.s.plan; }
  get playerState(): Readonly<TtPlayer> { return this.s.player; }
  get segment(): Readonly<Segment> { return this.s.plan.segments[Math.min(this.s.seg, this.s.plan.segments.length - 1)] as Segment; }
  get variant(): 'standing' | 'seated' { return this.seated ? 'seated' : 'standing'; }
  /** The storm that is on now. */
  get storm(): Readonly<Storm> | null { const i = this.s.storm.on; return i >= 0 ? (this.s.plan.storms[i] as Storm) : null; }
  get stormProgress(): number { return this.s.storm.progress; }
  /** Seconds left in the current segment. */
  get leftS(): number { return Math.max(0, (this.segment.endK - this.s.k) / 60); }
  /** Twists a minute over the last few seconds. */
  get rate(): number { return this.rateAt(this.s.k); }
  /** The last seconds of a rest: "Ready". */
  get gettingReady(): boolean { const seg = this.segment; return seg.kind === 'rest' && seg.endK - this.s.k <= 180; }
  /** Seconds left for the storm that is on, 0 when none. */
  get stormLeftS(): number { const st = this.storm; return st ? Math.max(0, (st.endK - this.s.k) / 60) : 0; }

  private rateAt(k: number): number {
    const from = k - RATE_WINDOW_S * 60;
    let n = 0;
    for (const r of this.s.player.repKs) if (r > from) n++;
    return (n * 60) / RATE_WINDOW_S;
  }

  // ───── the step ─────

  step(f: FrameIn): SimEvent[] {
    const out: SimEvent[] = [];
    const s = this.s;
    if (s.phase !== 'running') return out;
    s.k++;
    const k = s.k;
    const t = round(msOf(k), 1);
    const last = s.plan.segments.length - 1;
    if (k === 1) this.enter(out, t);
    while (s.seg < last && k > (s.plan.segments[s.seg] as Segment).endK) { s.seg++; this.enter(out, t); }
    const seg = this.segment;
    const p = s.player;
    const inp = f.players[0];
    const seen = !!inp && inp.ok;
    p.held = seen ? (Math.sign(inp.ch['side'] ?? 0) as -1 | 0 | 1) : 0;

    if (seg.kind === 'work' && seen && inp) {
      this.reps(inp.events, inp.ch, k, t, out);
      this.watch(inp.ch, k, t, out);
      if (k - p.lastRepK <= ACTIVE_STEPS) p.activeSteps++;
      if (k - p.lastRepK > IDLE_HINT_S * 60 && k - s.idleHintK > IDLE_HINT_S * 60) { s.idleHintK = k; this.say({ code: 'move_more' }, k, t, out); }
    }
    if (seg.kind === 'work') this.storms(seg, k, t, out);
    this.turbine(seg, k);
    if (k >= s.plan.endK) { s.phase = 'complete'; out.push({ type: 'done', t }); }
    return out;
  }

  private enter(out: SimEvent[], t: number): void {
    const s = this.s;
    const seg = s.plan.segments[s.seg];
    if (!seg) return;
    if (seg.kind === 'work') {
      s.idleHintK = s.k;
      out.push({ type: 'set', t, set: seg.set, of: s.plan.timing.sets, lo: s.plan.band[0], hi: s.plan.band[1] });
    } else if (seg.kind === 'rest') out.push({ type: 'rest', t, set: seg.set, next: seg.set + 1, of: s.plan.timing.sets });
    else out.push({ type: 'finale', t, lit: round(s.player.lit, 2) });
  }

  /** The repetitions of this step. */
  private reps(events: FrameIn['players'][number]['events'], ch: Readonly<Record<string, number>>, k: number, t: number, out: SimEvent[]): void {
    const p = this.s.player;
    for (const e of events) {
      if (e.id !== 'twist' || e.kind !== 'rep') continue;
      const keyed = e.source === 'keyboard' || e.source === 'touch';
      let side: -1 | 1 = e.side === 'L' ? -1 : e.side === 'R' ? 1 : (Math.sign(ch['side'] ?? 0) as -1 | 0 | 1) || (p.side === 1 ? -1 : 1);
      if (!keyed && e.side === undefined) side = p.side === 1 ? -1 : 1;
      // a key that is pressed again on the same side is no twist
      if (keyed && side === p.side) { this.say({ code: 'wrong_side' }, k, t, out); continue; }
      const range = e.q?.range ?? 0.9;
      const rf = clamp((range - TWIST_DEFAULTS.turn) / 0.5, 0, 1);
      p.side = side;
      p.reps++;
      p.lastRepK = k;
      p.repKs.push(k);
      while (p.repKs.length && (p.repKs[0] as number) <= k - 12 * 60) p.repKs.shift();
      const rate = this.rateAt(k);
      const [lo, hi] = this.s.plan.band;
      // the pace needs two repetitions to be a pace: the first is judged on its own
      const known = p.repKs.length >= 2;
      const inBand = known && rate >= lo * 0.92 && rate <= hi * 1.08;
      const mult = !known ? 0.8 : rate < lo * 0.92 ? 0.4 + 0.6 * clamp(rate / lo, 0, 1) : rate > hi * 1.08 ? 0.7 : 1;
      if (inBand) { p.inBand++; p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak); } else if (known) p.streak = 0;
      const combo = 1 + Math.min(0.5, p.streak * 0.02);
      const pts = Math.round(BASE_POINTS * (0.6 + 0.4 * rf) * mult * combo);
      p.score += pts;
      p.omega += IMPULSE * (0.7 + 0.3 * rf);
      p.recent.push(0.55 + 0.45 * rf);
      if (p.recent.length > 4) p.recent.shift();
      this.s.log.push(logOf(k, 'twist', true, { v: pts }));
      out.push({ type: 'rep', t, side, pts, rate: round(rate, 1), inBand, range: round(range, 2), streak: p.streak });
      // a repetition answers a blackout
      if (this.s.storm.on >= 0 && (this.s.plan.storms[this.s.storm.on] as Storm).kind === 'blackout') this.s.storm.progress++;
    }
  }

  /** Why the last tries did not count, from the channels of the detector. */
  private watch(ch: Readonly<Record<string, number>>, k: number, t: number, out: SimEvent[]): void {
    const p = this.s.player;
    const tau = ch['tau'];
    if (tau === undefined) return;
    if (k % 6 === 0) {
      p.hist.push([k, tau, ch['span'] ?? 1, ch['gap'] ?? 0]);
      if (p.hist.length > 20) p.hist.shift();
    }
    if (k - p.lastRepK < 150 || k - p.lastMissK < 180 || p.hist.length < 8) return;
    const recent = p.hist.filter((h) => h[0] > k - 120);
    if (recent.length < 6) return;
    const tauMax = Math.max(...recent.map((h) => Math.abs(h[1])));
    const spanMin = Math.min(...recent.map((h) => h[2]));
    const gapMid = median(recent.map((h) => h[3]));
    if (tauMax < 0.25) return;       // not trying
    const turn = TWIST_DEFAULTS.turn;
    let note: MissNote | null = null;
    if (gapMid > TWIST_DEFAULTS.handsApart) note = { code: 'hands_apart', got: round(gapMid, 2), need: TWIST_DEFAULTS.handsApart };
    else if (tauMax >= turn && spanMin > TWIST_DEFAULTS.maxSpan) note = { code: 'turn_shoulders', got: round(spanMin, 2), need: TWIST_DEFAULTS.maxSpan };
    else if (tauMax < turn) note = { code: 'turn_more', got: round(tauMax, 2), need: turn };
    if (note) this.say(note, k, t, out);
  }

  private say(note: MissNote, k: number, t: number, out: SimEvent[]): void {
    const p = this.s.player;
    if (k - p.lastMissK < HINT_STEPS) return;
    p.lastMissK = k;
    p.miss = { ...note, k };
    this.s.log.push(logOf(k, note.code, false, note.got !== undefined ? { v: note.got } : {}));
    out.push({ type: 'miss', t, code: note.code, ...(note.got !== undefined ? { got: note.got } : {}), ...(note.need !== undefined ? { need: note.need } : {}) });
  }

  // ───── storms ─────

  private storms(seg: Segment, k: number, t: number, out: SimEvent[]): void {
    const s = this.s;
    const p = s.player;
    const st = s.storm;
    // start the one that is due
    if (st.on < 0) {
      const i = s.plan.storms.findIndex((x, j) => !st.done[j] && x.startK <= k && x.startK >= seg.startK && x.startK < seg.endK);
      if (i >= 0) {
        const storm = s.plan.storms[i] as Storm;
        st.on = i; st.progress = 0; st.lastSeenK = k; st.done[i] = true;
        out.push({ type: 'storm', t, kind: storm.kind, side: storm.side, need: storm.need, holdS: storm.holdSteps / 60, leftS: (storm.endK - k) / 60 });
      }
      return;
    }
    const storm = s.plan.storms[st.on] as Storm;
    let answered = false;
    if (storm.kind === 'blackout') answered = st.progress >= storm.need;
    else {
      // held: the body twisted to the side asked, with a short gap allowed (the detector flickers at the edge)
      if (p.held === storm.side) { st.lastSeenK = k; st.progress++; } else if (k - st.lastSeenK > 12) st.progress = 0;
      answered = st.progress >= storm.holdSteps;
    }
    if (answered || k >= storm.endK) {
      const bonus = answered ? STORM_BONUS[storm.kind] : 0;
      if (answered) { p.score += bonus; s.log.push(logOf(k, storm.kind, true, { v: bonus })); } else s.log.push(logOf(k, storm.kind === 'blackout' ? 'too_slow' : 'held_too_short', false));
      st.result[st.on] = answered ? 1 : 0;
      out.push({ type: 'stormEnd', t, kind: storm.kind, ok: answered, bonus });
      st.on = -1;
      st.progress = 0;
    }
  }

  // ───── the turbine and the city ─────

  private turbine(seg: Segment, k: number): void {
    const p = this.s.player;
    p.omega = Math.max(0, p.omega - p.omega * OMEGA_DECAY);
    p.angle += p.omega / 60;
    // power: how well the pace is kept, and how well the last repetitions were done
    let target = 0;
    if (seg.kind === 'work') {
      const lo = this.s.plan.band[0];
      const quality = p.recent.length ? p.recent.reduce((n, x) => n + x, 0) / p.recent.length : 0;
      target = clamp((this.rateAt(k) / lo) * quality, 0, 1);
    } else if (seg.kind === 'rest') target = 0.3 * p.power;
    else target = clamp(this.completion(), 0.1, 1);
    p.power += (target - p.power) * POWER_EASE;
    const blackout = this.s.storm.on >= 0 && (this.s.plan.storms[this.s.storm.on] as Storm).kind === 'blackout';
    const wanted = blackout ? 0.1 : seg.kind === 'finale' ? target : Math.max(0.08, p.power);
    p.lit += (wanted - p.lit) * (blackout ? 0.08 : 0.02);
  }

  /** How much of the possible score was made, 0..1, for the outro's city (not a score; the score is the points). */
  private completion(): number {
    const p = this.s.player;
    const mid = (this.s.plan.band[0] + this.s.plan.band[1]) / 2;
    const possible = Math.max(1, this.s.plan.timing.sets * (this.s.plan.timing.workS / 60) * mid);
    return clamp(p.reps / possible, 0, 1);
  }

  // ───── results ─────

  quality(): number {
    const p = this.s.player;
    return p.reps ? p.inBand / p.reps : 0;
  }

  summary(): RunSummary {
    const s = this.s;
    const p = s.player;
    const stormsOk = s.storm.result.filter((r) => r === 1).length;
    return {
      score: p.score,
      seconds: round(s.k / 60, 2),
      reps: p.reps,
      hits: p.inBand,
      cleared: stormsOk,
      bestStreak: p.bestStreak,
      quality: round(this.quality(), 3),
      metSeconds: round(this.met * TT_VARIANT_MET[this.variant] * (p.activeSteps / 60), 1),
      log: s.log.map((e) => ({ ...e })),
    };
  }

  snapshot(): unknown { return copyData(this.s); }

  restore(raw: unknown): void {
    const snap = raw as TtState;
    if (!snap || snap.v !== 1) throw new Error('Not a Twist Turbine snapshot.');
    this.s = copyData(snap);
  }
}
