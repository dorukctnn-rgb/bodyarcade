// Limbo Bend (card 19, template F gate and pose): tilted gates fly toward you; lean from the hips to the tilt of the gate, arms
// up for the tall ones, and slip through.
//
// The run (game-design.md card 19): three sets of 50 seconds with 15 seconds of rest between them (180 s), then a short outro.
// A gate asks for an angle (the tilt of the doorway, plus = toward the player's right as seen in the mirror, 12 to 35
// degrees by level) and arrives a few seconds after it is first seen. The player passes it by keeping the angle within the
// tolerance (7 degrees, 10 on easy) for 0.3 s in the last 0.9 s before it arrives, with the hips still (the lean comes from the
// trunk, not from sliding sideways) and, for a tall gate, both hands above the nose. The judging is core/moves BendTester,
// from the channels of the sideBend detector (bend, bend.t, hipShift, torso, armsUp). At the arrival the gate is passed or it
// is not, and a gate that was not passed says why in the words of the detector's explanation (bend more, bend less,
// wrong side, hips moved sideways, leaning forward, arms not up, hold it longer).
//
// Keyboard and touch have no angle to read: the left and right keys turn a lever (the angle keeps where it was left, the
// opposite key brings it back, Down or Space centres it), a swipe moves it a step, Up holds the arms up. The game then gives
// the tester the same channels, with its own clock.
//
// Two players on one camera (mode local2): every gate arrives in both lanes at the same moment, each with its own angle; a gate
// both players pass is a team pass (a bonus for both). Pure and fixed-step: plain-data state, seeded plan, snapshot and restore.
import type { RunSummary } from '../../core/types/index.ts';
import { BendTester, type BendGate } from '../../core/moves/sideBend.ts';
import type { FrameIn, PlayerIn } from '../_shared/frame.ts';
import type { HostSim, Phase, SimEvent, SimSetup } from '../_shared/host.ts';
import { dumpOwn, loadOwn } from '../_shared/judgesnap.ts';
import type { MissNote } from '../_shared/reasons.ts';
import { clamp, copyData, msOf, round, stepsOf } from '../_shared/util.ts';
import { difficultyOf, logOf, type Difficulty, type LogEntry } from '../strength/kit.ts';
import { makeSegments, type GpSegment, type GpTiming } from './plan.ts';

// ───────── the plan ─────────

/** Three sets of 50 s and two rests of 15 s are the 180 s of the manifest; the outro comes after. */
export const LB_TIMING: GpTiming = { sets: 3, workS: 50, restS: 15, finaleS: 4 };

export interface LbLevel {
  /** Seconds from the first sight of a gate to its arrival. */
  approachS: number;
  /** Mean seconds between gates. */
  gapS: number;
  /** The chance that a gate is followed by a quick one to the other side. */
  pairChance: number;
  /** The tilt of a gate, degrees (absolute). */
  angle: readonly [number, number];
  /** The tolerance, degrees. */
  tol: number;
  /** The chance that a gate is tall (both hands above the nose). */
  tallChance: number;
}

/** Unmeasured (game-design.md "Dürüstlük notu"): the recording day sets the angles and the tolerances. */
export const LB_LEVELS: Readonly<Record<Difficulty, LbLevel>> = {
  easy: { approachS: 3.6, gapS: 3.6, pairChance: 0, angle: [12, 20], tol: 10, tallChance: 0 },
  normal: { approachS: 3.0, gapS: 3.0, pairChance: 0.12, angle: [14, 26], tol: 7, tallChance: 0.25 },
  hard: { approachS: 2.5, gapS: 2.5, pairChance: 0.2, angle: [16, 31], tol: 6, tallChance: 0.35 },
  expert: { approachS: 2.1, gapS: 2.1, pairChance: 0.28, angle: [18, 35], tol: 5, tallChance: 0.45 },
};

/** A gate is judged in the last 0.9 s before it arrives (and not before the gate ahead of it has gone by). */
export const WINDOW_S = 0.9;
/** The seconds between the two gates of a quick pair. */
export const PAIR_GAP_S = 1.5;
const HOLD_MS = 300;
const HINT_STEPS = 90;
const PERFECT = 0.8;
const TEAM_BONUS = 25;
const BASE_POINTS = 60;
const ACTIVE_STEPS = 150;
/** The keyboard lever moves this many degrees a step (66 degrees a second) and stops at this angle. */
const LEVER_STEP = 1.1;
const LEVER_MAX = 42;
/** A swipe level of 1 is this many degrees. */
const TOUCH_DEG = 40;
/** Variants move less than the full bend (unmeasured). */
export const LB_VARIANT_MET: Readonly<Record<'standing' | 'seated', number>> = { standing: 1, seated: 0.8 };

export interface LbGate {
  id: number;
  lane: 0 | 1;
  arriveK: number;
  /** The first step it is judged. */
  fromK: number;
  /** The tilt, degrees: plus = toward the player's right. */
  target: number;
  tall: boolean;
  /** The second gate of a quick pair. */
  pair: boolean;
}

export interface LbPlan {
  segments: GpSegment[];
  endK: number;
  gates: LbGate[];
  approachK: number;
  tol: number;
  timing: GpTiming;
  players: 1 | 2;
}

export function makeLbPlan(difficulty: Difficulty, timing: GpTiming, rng: () => number, players: 1 | 2): LbPlan {
  const level = LB_LEVELS[difficulty];
  const { segments, endK } = makeSegments(timing);
  const approachK = stepsOf(level.approachS);
  const gapK = stepsOf(level.gapS);
  const pairK = stepsOf(PAIR_GAP_S);
  const windowK = stepsOf(WINDOW_S);
  const gates: LbGate[] = [];
  const last: (LbGate | null)[] = [null, null];
  const sign: (1 | -1)[] = [1, -1];
  const add = (arriveK: number, pair: boolean, flip: boolean): void => {
    for (let lane = 0; lane < players; lane++) {
      const l = lane as 0 | 1;
      sign[l] = flip || rng() < 0.65 ? (sign[l] === 1 ? -1 : 1) : sign[l];
      const mag = level.angle[0] + rng() * (level.angle[1] - level.angle[0]);
      const prev = last[l];
      const g: LbGate = {
        id: gates.length, lane: l, arriveK, fromK: Math.max(arriveK - windowK, prev ? prev.arriveK + 6 : 0), target: round(sign[l] * mag, 1),
        tall: rng() < level.tallChance, pair,
      };
      gates.push(g);
      last[l] = g;
    }
  };
  for (const seg of segments) {
    if (seg.kind !== 'work') continue;
    let k = seg.startK + Math.round(approachK * 0.9);
    const end = seg.endK - stepsOf(0.6);
    while (k <= end) {
      add(k, false, false);
      if (rng() < level.pairChance && k + pairK <= end) { add(k + pairK, true, true); k += pairK; }
      k += Math.round(gapK * (0.9 + 0.2 * rng()));
    }
  }
  return { segments, endK, gates, approachK, tol: level.tol, timing, players };
}

// ───────── state ─────────

/** 0 pending, 1 passed, 2 missed, 3 skipped (the player was not seen: nothing is won or lost). */
export type GateDone = 0 | 1 | 2 | 3;

export interface LbGateState { done: GateDone; locked: boolean; precision: number; error: number }

export interface LbPlayer {
  score: number;
  passed: number;
  perfect: number;
  missed: number;
  streak: number;
  bestStreak: number;
  /** The angle now, degrees (the detector's, or the lever's). */
  theta: number;
  /** The keyboard lever, degrees. */
  keyTheta: number;
  /** Hands above the nose now (the tall gates). */
  armsUp: boolean;
  seen: boolean;
  lastTheta: number;
  lastActK: number;
  activeSteps: number;
  precisionSum: number;
  judged: number;
  miss: (MissNote & { k: number }) | null;
  lastMissK: number;
}

interface LbState {
  v: 1;
  k: number;
  phase: Phase;
  plan: LbPlan;
  seg: number;
  players: LbPlayer[];
  gs: LbGateState[];
  testers: unknown[];
  log: LogEntry[];
  teamPasses: number;
}

export interface LbOptions {
  setup: Pick<SimSetup, 'start' | 'flags' | 'players' | 'audioLatencyMs' | 'rng'>;
  met: number;
  timing?: Partial<GpTiming>;
}

const newPlayer = (): LbPlayer => ({
  score: 0, passed: 0, perfect: 0, missed: 0, streak: 0, bestStreak: 0, theta: 0, keyTheta: 0, armsUp: false, seen: false, lastTheta: 0, lastActK: -100000,
  activeSteps: 0, precisionSum: 0, judged: 0, miss: null, lastMissK: -100000,
});

export const bendGateOf = (g: LbGate, tol: number): BendGate => ({ id: g.id, target: g.target, tol, holdMs: HOLD_MS, tall: g.tall });

// ───────── the simulation ─────────

export class LimboSim implements HostSim {
  private s: LbState;
  private testers: BendTester[];
  private readonly seated: boolean;
  private readonly met: number;
  private readonly count: 1 | 2;
  private lanes: LbGate[][] = [[], []];

  constructor(o: LbOptions) {
    const { start, rng } = o.setup;
    this.seated = start.seated;
    this.met = o.met;
    this.count = o.setup.players;
    const plan = makeLbPlan(difficultyOf(start.difficulty), { ...LB_TIMING, ...o.timing }, rng, this.count);
    this.s = {
      v: 1, k: 0, phase: 'running', plan, seg: 0,
      players: Array.from({ length: this.count }, newPlayer), gs: plan.gates.map(() => ({ done: 0, locked: false, precision: 0, error: 0 })),
      testers: [], log: [], teamPasses: 0,
    };
    this.testers = Array.from({ length: this.count }, () => new BendTester());
    this.index();
  }

  private index(): void {
    this.lanes = [[], []];
    for (const g of this.s.plan.gates) (this.lanes[g.lane] as LbGate[]).push(g);
  }

  // ───── what the view, the HUD and the tests read ─────

  get phase(): Phase { return this.s.phase; }
  get k(): number { return this.s.k; }
  get plan(): Readonly<LbPlan> { return this.s.plan; }
  get playerCount(): 1 | 2 { return this.count; }
  get playerStates(): readonly Readonly<LbPlayer>[] { return this.s.players; }
  get gateStates(): readonly Readonly<LbGateState>[] { return this.s.gs; }
  get segment(): Readonly<GpSegment> { return this.s.plan.segments[Math.min(this.s.seg, this.s.plan.segments.length - 1)] as GpSegment; }
  get variant(): 'standing' | 'seated' { return this.seated ? 'seated' : 'standing'; }
  get leftS(): number { return Math.max(0, (this.segment.endK - this.s.k) / 60); }
  /** The last seconds of a rest: "Ready". */
  get gettingReady(): boolean { const seg = this.segment; return seg.kind === 'rest' && seg.endK - this.s.k <= 180; }
  gatesOf(lane: 0 | 1): readonly LbGate[] { return this.lanes[lane]; }

  /** The first gate of a lane that has not arrived yet. */
  nextGate(lane: 0 | 1): LbGate | null {
    const k = this.s.k;
    for (const g of this.lanes[lane]) if (g.arriveK >= k && (this.s.gs[g.id] as LbGateState).done === 0) return g;
    return null;
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
    while (s.seg < last && k > (s.plan.segments[s.seg] as GpSegment).endK) { s.seg++; this.enter(out, t); }
    const seg = this.segment;

    const chs: (Readonly<Record<string, number>> | null)[] = [];
    for (let i = 0; i < this.count; i++) chs.push(this.read(i, f.players[i], k));

    if (seg.kind === 'work') {
      for (let i = 0; i < this.count; i++) {
        const ch = chs[i];
        const p = s.players[i] as LbPlayer;
        if (p.seen && k - p.lastActK <= ACTIVE_STEPS) p.activeSteps++;
        if (!ch) continue;
        const live: BendGate[] = [];
        for (const g of this.lanes[i] as LbGate[]) {
          if (g.fromK > k || g.arriveK < k) continue;
          if ((s.gs[g.id] as LbGateState).done !== 0) continue;
          live.push(bendGateOf(g, s.plan.tol));
        }
        if (!live.length) continue;
        for (const j of (this.testers[i] as BendTester).update(ch, live)) {
          const gs = s.gs[j.id] as LbGateState;
          if (gs.locked) continue;
          gs.locked = true;
          gs.precision = j.precision;
          gs.error = j.error;
          out.push({ type: 'lock', t, id: j.id, lane: i, precision: round(j.precision, 2) });
        }
      }
      this.arrivals(k, t, out);
    }
    if (k >= s.plan.endK) { s.phase = 'complete'; out.push({ type: 'done', t }); }
    return out;
  }

  private enter(out: SimEvent[], t: number): void {
    const s = this.s;
    const seg = s.plan.segments[s.seg];
    if (!seg) return;
    if (seg.kind === 'work') out.push({ type: 'set', t, set: seg.set, of: s.plan.timing.sets, tol: s.plan.tol });
    else if (seg.kind === 'rest') out.push({ type: 'rest', t, set: seg.set, next: seg.set + 1, of: s.plan.timing.sets });
    else out.push({ type: 'finale', t, passed: s.players.reduce((n, p) => n + p.passed, 0) });
  }

  /** One player's input for this step: the detector's channels, or the lever of the keys and swipes. */
  private read(i: number, inp: PlayerIn | undefined, k: number): Readonly<Record<string, number>> | null {
    const p = (this.s.players[i]) as LbPlayer;
    const seen = !!inp && inp.ok;
    p.seen = seen;
    if (!seen || !inp) return null;
    let ch = inp.ch;
    if (ch['bend.t'] !== undefined) {
      p.theta = ch['bend'] ?? p.theta;
      p.armsUp = (ch['armsUp'] ?? 0) >= 0.3;
    } else {
      // keys and swipes: a lever that stays where it is left
      if ((ch['center'] ?? 0) > 0) p.keyTheta = 0;
      p.keyTheta = clamp(p.keyTheta + clamp(ch['leanKey'] ?? 0, -1, 1) * LEVER_STEP, -LEVER_MAX, LEVER_MAX);
      p.theta = clamp(p.keyTheta + clamp(ch['lean'] ?? 0, -1, 1) * TOUCH_DEG, -LEVER_MAX - 3, LEVER_MAX + 3);
      p.armsUp = (ch['up'] ?? 0) > 0;
      ch = { bend: p.theta, 'bend.t': msOf(k), hipShift: 0, torso: 1, armsUp: p.armsUp ? 0.6 : 0 };
    }
    if (Math.abs(p.theta - p.lastTheta) >= 3) { p.lastTheta = p.theta; p.lastActK = k; }
    return ch;
  }

  /** The gates that reach the player at this step. */
  private arrivals(k: number, t: number, out: SimEvent[]): void {
    const s = this.s;
    const due = s.plan.gates.filter((g) => g.arriveK === k);
    if (!due.length) return;
    const passedLanes: number[] = [];
    for (const g of due) {
      const gs = s.gs[g.id] as LbGateState;
      if (gs.done !== 0) continue;
      const p = s.players[g.lane] as LbPlayer;
      const tester = this.testers[g.lane] as BendTester;
      if (gs.locked) {
        gs.done = 1;
        p.passed++;
        p.streak++;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        p.judged++;
        p.precisionSum += gs.precision;
        if (gs.precision >= PERFECT) p.perfect++;
        p.lastActK = k;
        const pts = Math.round((BASE_POINTS + 40 * gs.precision) * (1 + Math.min(0.5, (p.streak - 1) * 0.05)));
        p.score += pts;
        s.log.push(logOf(k, 'gate', true, { v: pts, ...(this.count === 2 ? { player: (g.lane + 1) as 1 | 2 } : {}) }));
        out.push({ type: 'gate', t, id: g.id, lane: g.lane, ok: true, precision: round(gs.precision, 2), error: round(gs.error, 1), pts, streak: p.streak, target: g.target, tall: g.tall });
        passedLanes.push(g.lane);
      } else {
        const why = tester.explain(bendGateOf(g, s.plan.tol));
        if (!p.seen || why === null || why.code === 'person_out') {
          // nobody to judge: nothing is won, nothing is lost
          gs.done = 3;
          out.push({ type: 'gate', t, id: g.id, lane: g.lane, ok: false, skipped: true, target: g.target, tall: g.tall });
        } else {
          gs.done = 2;
          p.missed++;
          p.streak = 0;
          p.judged++;
          const note: MissNote = { code: why.code, ...(why.got !== undefined ? { got: round(why.got, 2) } : {}), ...(why.need !== undefined ? { need: round(why.need, 2) } : {}) };
          if (k - p.lastMissK >= 30) { p.lastMissK = k; p.miss = { ...note, k }; }
          s.log.push(logOf(k, why.code, false, { ...(why.got !== undefined ? { v: round(why.got, 2) } : {}), ...(this.count === 2 ? { player: (g.lane + 1) as 1 | 2 } : {}) }));
          out.push({ type: 'gate', t, id: g.id, lane: g.lane, ok: false, code: why.code, target: g.target, tall: g.tall, ...(why.got !== undefined ? { got: round(why.got, 2) } : {}), ...(why.need !== undefined ? { need: round(why.need, 2) } : {}) });
        }
      }
      tester.forget(g.id);
    }
    // a gate that both players passed is a team pass
    if (this.count === 2 && passedLanes.length === 2) {
      for (const p of s.players) p.score += TEAM_BONUS;
      s.teamPasses++;
      s.log.push(logOf(k, 'team', true, { v: TEAM_BONUS }));
      out.push({ type: 'team', t, bonus: TEAM_BONUS });
    }
  }

  // ───── results ─────

  /** The mean precision of the gates that were judged (a missed gate counts as 0), 0..1. */
  quality(): number {
    const judged = this.s.players.reduce((n, p) => n + p.judged, 0);
    return judged ? this.s.players.reduce((n, p) => n + p.precisionSum, 0) / judged : 0;
  }

  summary(): RunSummary {
    const s = this.s;
    const met = (p: LbPlayer): number => round(this.met * LB_VARIANT_MET[this.variant] * (p.activeSteps / 60), 1);
    const base: RunSummary = {
      score: s.players.reduce((n, p) => n + p.score, 0),
      seconds: round(s.k / 60, 2),
      reps: s.players.reduce((n, p) => n + p.passed, 0),
      cleared: s.players.reduce((n, p) => n + p.passed, 0),
      hits: s.players.reduce((n, p) => n + p.perfect, 0),
      bestStreak: Math.max(0, ...s.players.map((p) => p.bestStreak)),
      quality: round(this.quality(), 3),
      metSeconds: Math.max(0, ...s.players.map(met)),
      log: s.log.map((e) => ({ ...e })),
    };
    if (this.count === 2) {
      const one = (p: LbPlayer): { score: number; reps: number; hits: number; cleared: number; metSeconds: number } => ({ score: p.score, reps: p.passed, hits: p.perfect, cleared: p.passed, metSeconds: met(p) });
      base.players = { 1: one(s.players[0] as LbPlayer), 2: one(s.players[1] as LbPlayer) };
    }
    return base;
  }

  snapshot(): unknown {
    const snap = copyData({ ...this.s, testers: [] });
    snap.testers = this.testers.map((t) => dumpOwn(t));
    return snap;
  }

  restore(raw: unknown): void {
    const snap = raw as LbState;
    if (!snap || snap.v !== 1) throw new Error('Not a Limbo Bend snapshot.');
    this.s = copyData(snap);
    this.testers = Array.from({ length: this.s.players.length }, (_, i) => {
      const t = new BendTester();
      if (this.s.testers[i] !== undefined) loadOwn(t, this.s.testers[i]);
      return t;
    });
    this.index();
  }
}
