// Firework Jacks (card 25, templates E strength + D rhythm): every jumping jack sends a firework over the city, a jack on
// the beat sends a bigger one, and at the end all of them burst again as a finale.
//
// The run (game-design.md card 25): four sets of 45 seconds with 20 seconds of rest between them (interval training), then
// a ten second finale. Each set has a tempo (a metronome tick) from 60 up to 124 jacks a minute depending on the level,
// and four count-in beats before the scoring starts. A jack is judged against the nearest beat of its set:
// Perfect within 120 ms, Good within 220 ms (core/moves/rhythm.ts; easier levels have wider windows), later than that it
// is a plain jack ("off"). The camera's delay is taken off first, so a player on the beat reads about zero.
// Two players on one camera (mode 'local2', "co-op sky"): both play the same beats; when both players' jacks fall on the
// same beat (each at least Good) the two fireworks make one double firework and both get a bonus. The match is made on the
// beat grid, never between the two players, so a slow camera on one side cannot spoil it.
//
// Input: the 'rep' events of the jumpingJack detector (core/moves/jumpingJack.ts), or Space and taps (keyboard and touch
// bind the same event). Its channels (open, armsUp, gap) only explain why a try did not count ("Feet not wide enough").
// Variants: seated plays arm jacks (the detector with armsOnly), quiet plays step jacks (one foot out, no hop).
//
// Pure and fixed-step: the simulation reads only the frame and its own plain-data state; positions of fireworks are a
// function of the seed and the index of the jack, so a replay, a ghost and a duel see the same sky.
import { judgeOnGrid, type BEAT_WINDOWS, type BeatGrid } from '../../core/moves/rhythm.ts';
import { JUMPING_JACK_DEFAULTS } from '../../core/moves/jumpingJack.ts';
import type { RunSummary } from '../../core/types/index.ts';
import { isCamera, type FrameIn } from '../_shared/frame.ts';
import type { HostSim, Phase, SimEvent, SimSetup } from '../_shared/host.ts';
import type { MissNote } from '../_shared/reasons.ts';
import { clamp, copyData, msOf, randInt, round, stepsOf } from '../_shared/util.ts';
import { difficultyOf, logOf, unit, type Difficulty, type LogEntry } from './kit.ts';

// ───────── the plan: levels and timing ─────────

export interface FjTiming {
  sets: number;
  workS: number;
  restS: number;
  finaleS: number;
  /** Beats of metronome before the scoring of a set starts. */
  countIn: number;
}

/** Four sets of 45 s and three rests of 20 s make the 240 s of the manifest; the finale comes after. */
export const FJ_TIMING: FjTiming = { sets: 4, workS: 45, restS: 20, finaleS: 10, countIn: 4 };

export interface FjLevel {
  /** Jacks per minute of each set; a set past the end of the list keeps the last one. */
  bpm: readonly number[];
  windows: { perfect: number; good: number };
}

/** "Dakikada 60'tan 120 jack'e" (card 25). The windows are 120 / 220 ms at normal (M5, rhythm.ts); unmeasured on real bodies. */
export const FJ_LEVELS: Readonly<Record<Difficulty, FjLevel>> = {
  easy: { bpm: [60, 64, 68, 72], windows: { perfect: 160, good: 280 } },
  normal: { bpm: [72, 80, 88, 96], windows: { perfect: 120, good: 220 } },
  hard: { bpm: [84, 96, 108, 116], windows: { perfect: 100, good: 180 } },
  expert: { bpm: [96, 108, 116, 124], windows: { perfect: 85, good: 150 } },
};

/** From the body's movement to the detector's event: camera frame, pose model and filter (unmeasured; the recording day sets it). */
export const POSE_LATENCY_MS = 100;

export type Grade = 'perfect' | 'good' | 'off';
const GRADE_MULT: Record<Grade, number> = { perfect: 2, good: 1.5, off: 1 };
const SIZE: Record<Grade, 1 | 2 | 3> = { perfect: 3, good: 2, off: 1 };
const BASE_POINTS = 10;
/** Both players on the same beat: a double firework. */
const DOUBLE_BONUS = 30;
/** After this many seconds of standing still in a set the strip says "Move more" (and repeats every so often). */
const IDLE_HINT_S = 8;
const HINT_STEPS = 90;
const FINALE_BURSTS = 72;
/** The energy of the sky follows its target with a time constant of 1.5 s (per step). */
const ENERGY_EASE = 1 - Math.exp(-1 / 60 / 1.5);

/** Seconds a try counts as moving for calories and the summary. */
const ACTIVE_STEPS = 150;
/** Variants move less than the full jack (unmeasured estimates of the share of the full MET). */
export const VARIANT_MET: Readonly<Record<'standard' | 'step' | 'arms', number>> = { standard: 1, step: 0.55, arms: 0.4 };

// ───────── state ─────────

interface Segment { kind: 'work' | 'rest' | 'finale'; startK: number; endK: number; set: number; bpm: number }

export interface FjPlan {
  segments: Segment[];
  endK: number;
  windows: { perfect: number; good: number };
  timing: FjTiming;
}

interface Attempt { on: boolean; k0: number; armsMax: number; gapMax: number; rep: boolean }

export interface FjPlayer {
  score: number;
  /** Every jack the detector counted, count-in and rest included (the exercise done). */
  jacks: number;
  /** Jacks that were judged (after the count-in, in a set). */
  judged: number;
  perfect: number;
  good: number;
  off: number;
  streak: number;
  bestStreak: number;
  /** Beat index of the player's last jack in this set and its grade, for the double match. */
  lastBeat: number;
  lastGrade: Grade | null;
  /** The next beat of the set whose window has not been checked for a missing jack yet. */
  checked: number;
  lastJackK: number;
  activeSteps: number;
  energy: number;
  /** The jacks of the last four seconds: [step, how good it was 0..1], for the energy of the sky. */
  recent: [number, number][];
  /** How open the body is now, 0..1 (the detector's `open` channel; 0 without a camera), for the avatar. */
  open: number;
  att: Attempt;
  /** The latest sentence for the strip: the miss and the step it was said at. */
  miss: (MissNote & { k: number }) | null;
  lastMissK: number;
}

/** A firework of the show: step, x across the sky (0..1), size 1..3, colour index, player (1 or 2). */
export type ShowEntry = [k: number, x: number, size: number, hue: number, player: number];

interface FjState {
  v: 1;
  k: number;
  phase: Phase;
  plan: FjPlan;
  seg: number;
  nextBeat: number;
  players: FjPlayer[];
  show: ShowEntry[];
  /** Finale: the show entries to burst again, with the step each bursts at. */
  finale: { k: number; i: number; grand: boolean }[];
  finaleNext: number;
  doubles: number;
  /** Fireworks launched so far (every grade): the index their positions come from. */
  fired: number;
  log: LogEntry[];
  idleHintK: number[];
}

export interface FjOptions {
  setup: Pick<SimSetup, 'start' | 'flags' | 'players' | 'audioLatencyMs' | 'rng'>;
  /** MET of the full jack (the manifest's). */
  met: number;
  timing?: Partial<FjTiming>;
}

const newPlayer = (): FjPlayer => ({
  score: 0, jacks: 0, judged: 0, perfect: 0, good: 0, off: 0, streak: 0, bestStreak: 0, lastBeat: -1, lastGrade: null, checked: 0, lastJackK: -100000,
  activeSteps: 0, energy: 0, recent: [], open: 0, att: { on: false, k0: 0, armsMax: -1, gapMax: 0, rep: false }, miss: null, lastMissK: -100000,
});

export function makePlan(difficulty: Difficulty, timing: FjTiming, rng: () => number): FjPlan {
  const level = FJ_LEVELS[difficulty];
  const segments: Segment[] = [];
  let k = 0;
  for (let i = 0; i < timing.sets; i++) {
    const base = level.bpm[Math.min(i, level.bpm.length - 1)] as number;
    const bpm = clamp(base + randInt(rng, -2, 2), 50, 130);
    const work = stepsOf(timing.workS);
    segments.push({ kind: 'work', startK: k, endK: k + work, set: i, bpm });
    k += work;
    if (i < timing.sets - 1) {
      const rest = stepsOf(timing.restS);
      segments.push({ kind: 'rest', startK: k, endK: k + rest, set: i, bpm });
      k += rest;
    }
  }
  const fin = stepsOf(timing.finaleS);
  segments.push({ kind: 'finale', startK: k, endK: k + fin, set: timing.sets - 1, bpm: 0 });
  return { segments, endK: k + fin, windows: { ...level.windows }, timing };
}

// ───────── the simulation ─────────

export class FireworkSim implements HostSim {
  private s: FjState;
  private readonly seed: number;
  private readonly players: 1 | 2;
  private readonly armsOnly: boolean;
  private readonly stepJack: boolean;
  private readonly latency: { pose: number; keys: number };
  private readonly met: number;
  private readonly difficulty: Difficulty;

  constructor(o: FjOptions) {
    const { start, flags, players, audioLatencyMs, rng } = o.setup;
    this.seed = start.seed >>> 0;
    this.players = players;
    this.armsOnly = start.seated;
    this.stepJack = flags.silent && !start.seated;
    this.latency = { pose: POSE_LATENCY_MS + audioLatencyMs, keys: audioLatencyMs };
    this.met = o.met;
    this.difficulty = difficultyOf(start.difficulty);
    const timing: FjTiming = { ...FJ_TIMING, ...o.timing };
    this.s = {
      v: 1, k: 0, phase: 'running', plan: makePlan(this.difficulty, timing, rng), seg: 0, nextBeat: 0,
      players: Array.from({ length: players }, newPlayer), show: [], finale: [], finaleNext: 0, doubles: 0, fired: 0, log: [], idleHintK: Array.from({ length: players }, () => 0),
    };
  }

  // ───── what the view, the HUD and the tests read ─────

  get phase(): Phase { return this.s.phase; }
  get k(): number { return this.s.k; }
  get plan(): Readonly<FjPlan> { return this.s.plan; }
  get playerStates(): readonly Readonly<FjPlayer>[] { return this.s.players; }
  get show(): readonly Readonly<ShowEntry>[] { return this.s.show; }
  get doubles(): number { return this.s.doubles; }
  get playerCount(): 1 | 2 { return this.players; }
  get variant(): 'standard' | 'step' | 'arms' { return this.armsOnly ? 'arms' : this.stepJack ? 'step' : 'standard'; }

  /** The segment the simulation is in now (the last one once the run is over). */
  get segment(): Readonly<Segment> { return this.s.plan.segments[Math.min(this.s.seg, this.s.plan.segments.length - 1)] as Segment; }

  /** Seconds left in the current segment. */
  get leftS(): number {
    const seg = this.segment;
    return Math.max(0, (seg.endK - this.s.k) / 60);
  }

  /** Are the beats of the set still the count-in? */
  get countingIn(): boolean {
    const seg = this.segment;
    return seg.kind === 'work' && this.s.k < seg.startK + (this.s.plan.timing.countIn * 3600) / seg.bpm;
  }

  /** Time of beat n of a set in ms (the grid the jacks are judged on). */
  beatMs(set: number, n: number): number {
    const seg = this.s.plan.segments.find((x) => x.kind === 'work' && x.set === set);
    if (!seg) return NaN;
    return msOf(seg.startK) + (n * 60000) / seg.bpm;
  }

  /** Position inside the current beat, 0..1 (for a pulse), with the render alpha between steps. */
  beatPhase(alpha = 0): number {
    const seg = this.segment;
    if (seg.kind !== 'work') return 0;
    const into = (this.s.k + alpha - seg.startK) / (3600 / seg.bpm);
    return into - Math.floor(into);
  }

  // ───── the step ─────

  step(f: FrameIn): SimEvent[] {
    const out: SimEvent[] = [];
    const s = this.s;
    if (s.phase !== 'running') return out;
    s.k++;
    const k = s.k;
    const t = round(msOf(k), 1);
    // Step k ends at k/60 s and belongs to the segment whose end it has not passed: steps 1..2700 are the first 45 seconds.
    const last = s.plan.segments.length - 1;
    if (k === 1) this.enter(out, t);
    while (s.seg < last && k > (s.plan.segments[s.seg] as Segment).endK) {
      s.seg++;
      this.enter(out, t);
    }
    const seg = this.segment;
    for (let i = 0; i < this.players; i++) {
      const inp = f.players[i];
      (s.players[i] as FjPlayer).open = inp && inp.ok ? clamp(inp.ch['open'] ?? 0, 0, 1) : 0;
    }

    if (seg.kind === 'work') this.work(f, seg, k, t, out);
    else if (seg.kind === 'rest') this.rest(f, k, t, out);
    else this.finale(k, t, out);

    for (let i = 0; i < this.players; i++) {
      const p = s.players[i] as FjPlayer;
      p.energy += (this.energyTarget(p, seg, k) - p.energy) * ENERGY_EASE;
    }
    if (k >= s.plan.endK) {
      s.phase = 'complete';
      out.push({ type: 'done', t });
    }
    return out;
  }

  private enter(out: SimEvent[], t: number): void {
    const s = this.s;
    const seg = s.plan.segments[s.seg];
    if (!seg) return;
    if (seg.kind === 'work') {
      s.nextBeat = 0;
      for (const p of s.players) { p.lastBeat = -1; p.lastGrade = null; p.checked = s.plan.timing.countIn; p.att.on = false; }
      s.idleHintK = s.idleHintK.map(() => s.k);
      out.push({ type: 'set', t, set: seg.set, of: s.plan.timing.sets, bpm: Math.round(seg.bpm) });
    } else if (seg.kind === 'rest') {
      out.push({ type: 'rest', t, set: seg.set, next: seg.set + 1, of: s.plan.timing.sets });
    } else {
      this.planFinale(seg);
      out.push({ type: 'finale', t, fireworks: s.show.length });
    }
  }

  private work(f: FrameIn, seg: Segment, k: number, t: number, out: SimEvent[]): void {
    const s = this.s;
    const period = 3600 / seg.bpm;
    // the metronome: one event per beat, the first of each four is the strong one
    for (;;) {
      const at = seg.startK + Math.round(s.nextBeat * period);
      if (k < at || at >= seg.endK) break;
      out.push({ type: 'beat', t, set: seg.set, n: s.nextBeat, count: s.nextBeat < s.plan.timing.countIn, strong: s.nextBeat % 4 === 0 });
      s.nextBeat++;
    }
    const grid: BeatGrid = { firstMs: msOf(seg.startK), periodMs: 60000 / seg.bpm };
    const maxBeat = Math.floor((msOf(seg.endK) - grid.firstMs) / grid.periodMs);
    const judgeFrom = s.plan.timing.countIn;
    for (let i = 0; i < this.players; i++) {
      const p = s.players[i] as FjPlayer;
      const slot = (i + 1) as 1 | 2;
      const inp = f.players[i];
      if (!inp || !inp.ok) continue;
      this.watch(p, inp.ch, k, t, slot, out);
      // a beat whose window has closed without a jack of this player ends the streak (no points are taken away)
      const closed = Math.floor((msOf(k) - this.latency.pose - s.plan.windows.good - 40 - grid.firstMs) / grid.periodMs);
      while (p.checked <= closed && p.checked <= maxBeat) {
        if (p.lastBeat < p.checked) p.streak = 0;
        p.checked++;
      }
      for (const e of inp.events) {
        if (e.id !== 'jumpingJack' || e.kind !== 'rep') continue;
        const delay = isCamera(e) ? this.latency.pose : this.latency.keys;
        // (judgeOnGrid infers the literal 120 / 220 for its windows; any numbers do)
        const j = judgeOnGrid(msOf(k), grid, delay, s.plan.windows as typeof BEAT_WINDOWS, maxBeat);
        p.att.rep = true;
        p.jacks++;
        p.lastJackK = k;
        if (j.beat < judgeFrom) { this.launch(p, slot, k, t, 'warmup', 1, 0, j.beat, out); continue; }
        p.judged++;
        const used = j.beat === p.lastBeat;
        const grade: Grade = used ? 'off' : j.grade === 'miss' ? 'off' : j.grade;
        p.lastBeat = j.beat;
        p.lastGrade = grade;
        if (grade === 'off') { p.off++; p.streak = 0; } else {
          if (grade === 'perfect') p.perfect++; else p.good++;
          p.streak++;
          p.bestStreak = Math.max(p.bestStreak, p.streak);
        }
        const combo = grade === 'off' ? 1 : Math.min(3, 1 + 0.25 * Math.floor(p.streak / 4));
        const pts = Math.round(BASE_POINTS * GRADE_MULT[grade] * combo);
        p.score += pts;
        p.recent.push([k, grade === 'perfect' ? 1 : grade === 'good' ? 0.75 : 0.3]);
        this.launch(p, slot, k, t, grade, SIZE[grade], pts, j.beat, out, j.offsetMs);
        if (this.players === 2 && grade !== 'off') this.matchDouble(i, j.beat, k, t, out);
      }
      // standing still
      if (k - p.lastJackK > IDLE_HINT_S * 60 && k - (s.idleHintK[i] as number) > IDLE_HINT_S * 60 && !this.countingIn) {
        s.idleHintK[i] = k;
        this.say(p, slot, { code: 'move_more' }, k, t, out);
      }
      if (k - p.lastJackK <= ACTIVE_STEPS) p.activeSteps++;
    }
  }

  private rest(f: FrameIn, k: number, t: number, out: SimEvent[]): void {
    for (let i = 0; i < this.players; i++) {
      const p = this.s.players[i] as FjPlayer;
      const inp = f.players[i];
      if (!inp || !inp.ok) continue;
      for (const e of inp.events) {
        if (e.id !== 'jumpingJack' || e.kind !== 'rep') continue;
        p.jacks++;
        p.lastJackK = k;
        this.launch(p, (i + 1) as 1 | 2, k, t, 'rest', 1, 0, -1, out);
      }
      p.att.on = false;
    }
  }

  /** One firework into the sky. Grades 'warmup' and 'rest' score nothing and are not part of the finale. */
  private launch(p: FjPlayer, slot: 1 | 2, k: number, t: number, grade: Grade | 'warmup' | 'rest', size: number, pts: number, beat: number, out: SimEvent[], offsetMs = 0): void {
    const s = this.s;
    const index = s.fired++;
    const u = unit(this.seed, 'fj.x', index);
    const x = this.players === 2 ? (slot === 1 ? 0.08 + 0.42 * u : 0.5 + 0.42 * u) : 0.12 + 0.76 * u;
    const hue = Math.floor(unit(this.seed, 'fj.hue', index) * 5) % 5;
    const scored = grade !== 'warmup' && grade !== 'rest';
    const star = scored && grade === 'perfect' && p.streak > 0 && p.streak % 8 === 0;
    if (scored) {
      s.show.push([k, round(x, 3), size, hue, slot]);
      s.log.push(logOf(k, 'jack', true, { v: pts, ...(this.players === 2 ? { player: slot } : {}) }));
    }
    out.push({ type: 'jack', t, player: slot, grade, pts, size, x: round(x, 3), hue, beat, streak: p.streak, star, offsetMs: Math.round(offsetMs) });
  }

  /** Two players, one beat: the double firework. Called after the second of the two jacks on a beat. */
  private matchDouble(i: number, beat: number, k: number, t: number, out: SimEvent[]): void {
    const other = this.s.players[1 - i] as FjPlayer | undefined;
    const mine = this.s.players[i] as FjPlayer;
    if (!other || other.lastBeat !== beat || !other.lastGrade || other.lastGrade === 'off') return;
    // the pair is counted once: by the player whose jack came second on this beat
    if (mine.lastJackK < other.lastJackK) return;
    mine.score += DOUBLE_BONUS;
    other.score += DOUBLE_BONUS;
    this.s.doubles++;
    this.s.log.push(logOf(k, 'double', true, { v: DOUBLE_BONUS * 2 }));
    const x = (unit(this.seed, 'fj.dx', this.s.doubles) * 0.4) + 0.3;
    out.push({ type: 'double', t, beat, x: round(x, 3), pts: DOUBLE_BONUS });
  }

  /** Why a try did not count, from the channels of the detector (the detector's own explain() is not reachable from a game). */
  private watch(p: FjPlayer, ch: Readonly<Record<string, number>>, k: number, t: number, slot: 1 | 2, out: SimEvent[]): void {
    const open = ch['open'];
    if (open === undefined) return;       // keyboard and touch: no channels, nothing to explain
    const armsUp = ch['armsUp'] ?? -1, gap = ch['gap'] ?? 0;
    const a = p.att;
    if (!a.on) {
      if (open >= 0.35) { a.on = true; a.k0 = k; a.armsMax = armsUp; a.gapMax = gap; a.rep = false; }
      return;
    }
    a.armsMax = Math.max(a.armsMax, armsUp);
    a.gapMax = Math.max(a.gapMax, gap);
    if (open < 0.12 || k - a.k0 > 84) {
      a.on = false;
      if (!a.rep && k - a.k0 >= 6) {
        const need = this.stepJack ? JUMPING_JACK_DEFAULTS.stepGap : JUMPING_JACK_DEFAULTS.openGap;
        const armsOk = a.armsMax >= 0, feetOk = this.armsOnly || a.gapMax >= need;
        let note: MissNote | null = null;
        if (!armsOk && (feetOk || a.armsMax > -0.5)) note = { code: 'arms_not_up', got: round(a.armsMax, 2), need: 0 };
        else if (armsOk && !feetOk) note = { code: 'feet_not_wide', got: round(a.gapMax, 2), need };
        else if (!armsOk && !feetOk && a.gapMax > JUMPING_JACK_DEFAULTS.closedGap) note = { code: 'feet_not_wide', got: round(a.gapMax, 2), need };
        if (note) this.say(p, slot, note, k, t, out);
      }
    }
  }

  private say(p: FjPlayer, slot: 1 | 2, note: MissNote, k: number, t: number, out: SimEvent[]): void {
    if (k - p.lastMissK < HINT_STEPS) return;
    p.lastMissK = k;
    p.miss = { ...note, k };
    this.s.log.push(logOf(k, note.code, false, { ...(note.got !== undefined ? { v: note.got } : {}), ...(this.players === 2 ? { player: slot } : {}) }));
    out.push({ type: 'miss', t, player: slot, code: note.code, ...(note.got !== undefined ? { got: note.got } : {}), ...(note.need !== undefined ? { need: note.need } : {}) });
  }

  // ───── the finale: every firework of the show bursts again ─────

  private planFinale(seg: Segment): void {
    const s = this.s;
    const n = Math.min(s.show.length, FINALE_BURSTS);
    const steps = seg.endK - seg.startK;
    const first = 30, last = Math.max(first + 1, steps - 150);
    s.finale = [];
    for (let i = 0; i < n; i++) {
      const at = seg.startK + first + Math.floor((i * (last - first)) / Math.max(1, n));
      s.finale.push({ k: at, i: Math.floor((i * s.show.length) / n), grand: false });
    }
    // the grand shell, two seconds before the end
    s.finale.push({ k: seg.endK - 120, i: -1, grand: true });
    s.finaleNext = 0;
  }

  private finale(k: number, t: number, out: SimEvent[]): void {
    const s = this.s;
    while (s.finaleNext < s.finale.length && (s.finale[s.finaleNext] as { k: number }).k <= k) {
      const f = s.finale[s.finaleNext] as { k: number; i: number; grand: boolean };
      s.finaleNext++;
      if (f.grand) {
        const q = this.quality();
        out.push({ type: 'burst', t, grand: true, x: 0.5, size: 4, hue: 1, shells: 3 + Math.round(q * 6) });
      } else {
        const e = s.show[f.i];
        if (e) out.push({ type: 'burst', t, grand: false, x: e[1], size: e[2], hue: e[3], player: e[4] });
      }
    }
  }

  // ───── results ─────

  /** Where the energy of the sky is heading: how many of the last four seconds' jacks there were and how good they were. */
  private energyTarget(p: FjPlayer, seg: Segment, k: number): number {
    if (seg.kind === 'finale') return 1;
    if (seg.kind === 'rest') return 0.25;
    while (p.recent.length && (p.recent[0] as [number, number])[0] <= k - 240) p.recent.shift();
    if (!p.recent.length) return 0;
    const quality = p.recent.reduce((n, r) => n + r[1], 0) / p.recent.length;
    const wanted = ((4 * seg.bpm) / 60) * 0.8;
    return clamp(quality * Math.min(1, p.recent.length / wanted), 0, 1);
  }

  /** The share of judged jacks that were on the beat, 0..1. */
  quality(): number {
    let judged = 0, on = 0;
    for (const p of this.s.players) { judged += p.judged; on += p.perfect + p.good; }
    return judged ? on / judged : 0;
  }

  summary(): RunSummary {
    const s = this.s;
    const seconds = round(s.k / 60, 2);
    const factor = VARIANT_MET[this.variant];
    const met = (p: FjPlayer): number => round(this.met * factor * (p.activeSteps / 60), 1);
    const total = s.players.reduce((n, p) => n + p.score, 0);
    const jacks = s.players.reduce((n, p) => n + p.jacks, 0);
    const hits = s.players.reduce((n, p) => n + p.perfect + p.good, 0);
    const base: RunSummary = {
      score: total,
      seconds,
      reps: jacks,
      hits,
      bestStreak: Math.max(0, ...s.players.map((p) => p.bestStreak)),
      quality: round(this.quality(), 3),
      metSeconds: Math.max(0, ...s.players.map(met)),
      log: s.log.map((e) => ({ ...e })),
    };
    if (this.players === 2) {
      base.players = {
        1: { score: (s.players[0] as FjPlayer).score, reps: (s.players[0] as FjPlayer).jacks, hits: (s.players[0] as FjPlayer).perfect + (s.players[0] as FjPlayer).good, metSeconds: met(s.players[0] as FjPlayer) },
        2: { score: (s.players[1] as FjPlayer).score, reps: (s.players[1] as FjPlayer).jacks, hits: (s.players[1] as FjPlayer).perfect + (s.players[1] as FjPlayer).good, metSeconds: met(s.players[1] as FjPlayer) },
      };
    }
    return base;
  }

  snapshot(): unknown { return copyData(this.s); }

  restore(raw: unknown): void {
    const snap = raw as FjState;
    if (!snap || snap.v !== 1) throw new Error('Not a Firework Jacks snapshot.');
    this.s = copyData(snap);
  }
}
