// Climb template, Summit Climb (game-design.md card 13): a wall climbed hand over hand. The player reaches a hand up above the
// nose, takes hold and pulls it down to the shoulder; each pull climbs the wall by its length. On a ledge the arms rest and the
// knees climb the steps; falling rocks ask for a lean out of their lane; a hard part is passed against a timer; a breather
// ledge stops the clock for a few seconds. A climb is 60 to 90 seconds, three of them make a round, with a real rest between.
// The seated and the quiet variants climb with the arms only (no ledges), so nothing is stamped and nobody has to stand.
//
// The simulation is pure and fixed-step, like the other templates': plain data in, plain data out, no clock, no DOM, no
// Math.random and no transcendental functions or powers (a ghost or a duel must replay identically on every device).
// Heights are in metres, time in seconds.
//
// What the movement library gives (core/moves/pull.ts, kneeLift.ts, lean.ts), and how it is used here:
//   pull rep events (side L or R): q.range = how far the hand travelled from its highest point to the shoulder line, in arm
//   lengths A; value 1, or 0.5 when the same hand pulled twice in a row; warn 'shrug'. The climb of a pull is its range x value
//   against the player's own reference pull (the warm-up measures it), so a short reach is a short climb and nothing is punished
//   twice. Channels reach.L/R (the hand above the nose, T), pull.L/R (the share of the stroke done), grab.L/R (holding on above
//   the nose) are used to name a miss. kneeLift rep events (alternate 0: every lift counts) climb a ledge. The lean detector's
//   lane channel (-1, 0, 1) is the column the climber hangs in.
import { clamp, median } from '../kit-g1/index.ts';
import type { Rng } from '../../core/types/index.ts';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

/**
 * What a level asks. Heights and the pace were tuned with the bots of testing/bot.ts (a perfect climber, a good one, a sloppy
 * one) so that a good climber reaches the top with a little time to spare on easy and normal and a perfect one on hard and
 * expert; none of it is measured on people yet.
 */
export interface Level {
  sets: number;
  /** Seconds of climbing in a climb (the breather does not count). */
  setSec: number;
  restSec: number;
  /** Metres to the top. */
  summit: number;
  /** Metres a pull of the reference length climbs. */
  pull: number;
  /** Seconds between two rock falls, and the share of the falls that close two of the three columns. */
  rockEvery: number;
  rockTwo: number;
  /** Ledges in a climb (standing only), the steps up one, and its height in metres. */
  ledges: number;
  ledgeSteps: number;
  ledgeLen: number;
  /** Hard parts in a climb, their height in metres and the seconds they give. */
  cruxes: number;
  cruxLen: number;
  cruxSec: number;
}

export const LEVELS: Readonly<Record<Difficulty, Level>> = {
  easy: { sets: 3, setSec: 60, restSec: 25, summit: 30, pull: 0.8, rockEvery: 15, rockTwo: 0, ledges: 1, ledgeSteps: 4, ledgeLen: 3, cruxes: 0, cruxLen: 0, cruxSec: 0 },
  normal: { sets: 3, setSec: 75, restSec: 25, summit: 42, pull: 0.78, rockEvery: 11, rockTwo: 0.15, ledges: 2, ledgeSteps: 5, ledgeLen: 4, cruxes: 1, cruxLen: 6, cruxSec: 9 },
  hard: { sets: 3, setSec: 90, restSec: 30, summit: 72, pull: 0.76, rockEvery: 8, rockTwo: 0.3, ledges: 2, ledgeSteps: 6, ledgeLen: 5, cruxes: 2, cruxLen: 7, cruxSec: 9 },
  expert: { sets: 3, setSec: 90, restSec: 30, summit: 82, pull: 0.74, rockEvery: 6.5, rockTwo: 0.45, ledges: 3, ledgeSteps: 7, ledgeLen: 5, cruxes: 3, cruxLen: 8, cruxSec: 10.5 },
};

export const levelOf = (d: string): Level => LEVELS[(DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : 'normal'];

/** Seconds of the three-two-one before a climb, of the hold on the result after it, of a breather, and the warning before a rock lands. */
export const READY_SEC = 3;
export const HOLD_SEC = 3;
export const BREATH_SEC = 4;
export const WARN_SEC = 1.6;
/** Metres a rock takes off the climb, and how far a failed hard part throws the climber back. */
export const SLIP = 1.5;
export const CRUX_SLIP = 2;
/** The warm-up: pulls to measure the player's own reference pull, and the longest it goes on. */
export const WARMUP = { pulls: 3, maxSec: 30 } as const;
/** The reference pull (arm lengths of hand travel) before the warm-up has measured one, and its limits. */
export const REF = { dflt: 0.85, lo: 0.55, hi: 1 } as const;
/** A key or a tap stands for a pull of the reference length; two without a side within this many seconds count half. */
export const KEY_GAP = 0.4;
/** After this many seconds without a pull or a step the climb is called off; two in a row end the run. */
export const QUIT = 12;
export const MAX_QUIT = 2;
/** Shares of the summit that make the stars. */
export const STARS = { two: 0.75, one: 0.5 } as const;

export const POINTS = { metre: 6, dodge: 8, ledge: 10, crux: 25, summit: 40, left: 2, clean: 25 } as const;

/** The reach (hand above the nose, T) where a hand is trying for a hold, where it has a grip, and where it is down again. */
const REACH = { tryFrom: -0.15, grip: 0.25, down: -0.4 } as const;

// ───────── the course ─────────

export interface Section { kind: 'ledge' | 'crux' | 'rest'; y0: number; len: number; steps: number; sec: number }
export interface RockPlan { t: number; /** Which of the left, middle and right columns the rock closes. */ closed: [boolean, boolean, boolean] }
export interface ClimbCourse { /** Raw draws, kept so that a variant never moves the course. */ u: number[] }

const MAX_SETS = 3;
const DRAWS = 72;

/** The random numbers of every climb, drawn once from the 'course' stream: the same seed gives the same wall in every variant. */
export function makeCourse(rng: Rng): ClimbCourse[] {
  const out: ClimbCourse[] = [];
  for (let k = 0; k < MAX_SETS; k++) {
    const u: number[] = [];
    for (let i = 0; i < DRAWS; i++) u.push(rng());
    out.push({ u });
  }
  return out;
}

/** The sections of a climb, from its draws and the level: ledges and hard parts in turn, a breather in the middle. */
export function sectionsOf(lv: Level, c: ClimbCourse, summit: number, ledges: boolean): Section[] {
  const kinds: Section['kind'][] = [];
  let l = ledges ? lv.ledges : 0, x = lv.cruxes;
  let turn = (c.u[0] as number) > 0.5 ? 'crux' : 'ledge';
  while (l > 0 || x > 0) {
    if ((turn === 'ledge' && l > 0) || x === 0) { kinds.push('ledge'); l--; turn = 'crux'; } else { kinds.push('crux'); x--; turn = 'ledge'; }
  }
  kinds.splice(Math.ceil(kinds.length / 2), 0, 'rest');
  const n = kinds.length;
  const from = summit * 0.1, slot = (summit * 0.8) / n;
  return kinds.map((kind, i): Section => {
    const len = kind === 'ledge' ? Math.min(lv.ledgeLen, slot * 0.9) : kind === 'crux' ? Math.min(lv.cruxLen, slot * 0.9) : 0;
    const y0 = from + i * slot + (slot - len) * (0.08 + 0.5 * (c.u[1 + i] as number));
    return { kind, y0: Math.round(y0 * 100) / 100, len, steps: kind === 'ledge' ? lv.ledgeSteps : 0, sec: kind === 'crux' ? lv.cruxSec : 0 };
  });
}

/** The rock falls of a climb: when each lands (climb clock) and which columns it closes. */
export function rocksOf(lv: Level, c: ClimbCourse, setSec: number): RockPlan[] {
  const out: RockPlan[] = [];
  let t = lv.rockEvery * 0.5 + (c.u[20] as number) * 3;
  let prev = '';
  for (let k = 0; k < 24 && t < setSec - 2.5; k++) {
    const a = c.u[24 + k * 2] as number, b = c.u[25 + k * 2] as number;
    let closed: [boolean, boolean, boolean];
    if (b < lv.rockTwo) {
      const open = Math.min(2, Math.floor(a * 3));
      closed = [open !== 0, open !== 1, open !== 2];
    } else {
      const col = a < 0.5 ? 1 : a < 0.75 ? 0 : 2;
      closed = [col === 0, col === 1, col === 2];
    }
    // Never the same pattern twice in a row: the next column over.
    if (closed.map((v) => (v ? 1 : 0)).join('') === prev) closed = [closed[2], closed[0], closed[1]];
    prev = closed.map((v) => (v ? 1 : 0)).join('');
    out.push({ t: Math.round(t * 100) / 100, closed });
    t += lv.rockEvery * (0.75 + 0.5 * (c.u[8 + (k % 10)] as number));
  }
  return out;
}

// ───────── the state ─────────

export type HintCode = 'grab_higher' | 'pull_through' | 'same_hand_twice' | 'shoulders_down' | 'rock_hit' | 'ledge_use_legs' | 'crux_slow' | 'move_more';
export type Medal = 'gold' | 'silver' | 'bronze' | 'none' | 'dnf';

export interface SetResult { height: number; time: number; left: number; medal: Medal; pts: number; clean: boolean; hits: number; dodged: number; pulls: number; steps: number; ledges: number; crux: number; slips: number }

export type Phase = 'warmup' | 'ready' | 'climb' | 'finish' | 'rest' | 'over' | 'complete';

/** One hand as the channels show it: for naming a miss and for the arms of the picture. */
interface HandTrack { phase: 'low' | 'try'; peak: number; grabbed: boolean; pending: { at: number; code: HintCode } | null }

export interface ClimberState {
  /** Metres up the wall in this climb; the checkpoint under it (the top of the last section passed, where a rock cannot throw it lower). */
  h: number;
  base: number;
  pulls: number;
  steps: number;
  lastSide: 'L' | 'R' | '';
  lastPullAt: number;
  /** Run clock of the last pull of each hand (the picture), and how high each arm is raised now (0 down, 1 up). */
  pullAt: [number, number];
  arm: [number, number];
  hands: HandTrack[];
  streak: number;
  bestStreak: number;
  score: number;
  /** The column the climber hangs in (-1 left, 0 middle, 1 right). */
  lane: -1 | 0 | 1;
  idleFor: number;
  hint: { code: HintCode; at: number } | null;
  /** Index of the next section not yet passed; the ledge being climbed or the breather being taken, and its progress. */
  sec: number;
  on: 'ledge' | 'rest' | null;
  /** Climb clock when the climber got onto it. */
  onAt: number;
  cruxT: number;
  cruxOn: boolean;
  breath: number;
  rock: number;
  clean: boolean;
  hits: number;
  dodged: number;
  /** Ledges climbed, hard parts passed and failed in this climb. */
  ledges: number;
  crux: number;
  slips: number;
  /** Whether the next rock was closing the climber's column when its warning came (a dodge is only a dodge then). */
  threat: boolean;
  /** Climb clock and column of the last rock that hit, for the picture's flinch. */
  hitAt: number;
  hitLane: -1 | 0 | 1;
  results: SetResult[];
  dnfStreak: number;
  /** For the quality of the run: the share of the reference pull of every counted pull, and how many; seconds spent climbing. */
  qSum: number;
  qN: number;
  ran: number;
}

export interface ClimbState {
  v: 1;
  difficulty: Difficulty;
  seated: boolean;
  /** The quiet way: no ledge to stamp up (the arms climb everything). */
  quiet: boolean;
  /** Run clock: all seconds since the start. */
  t: number;
  phase: Phase;
  /** 1-based number of the climb being made or just made. */
  set: number;
  sets: number;
  /** Seconds into the phase, and into the climb itself (the breather does not count). */
  hc: number;
  setT: number;
  setSec: number;
  summit: number;
  restSec: number;
  restLeft: number;
  ticked: number;
  warm: { t: number; ranges: number[] };
  /** The player's reference pull, arm lengths. */
  ref: number;
  course: ClimbCourse[];
  sections: Section[];
  rocks: RockPlan[];
  c: ClimberState;
}

export interface PullIn { side: 'L' | 'R' | ''; /** Range x value, arm lengths; 0 when the source has none (keys, taps). */ amp: number; shrug: boolean }
export interface StepIn { k: number; side: 'L' | 'R' | '' }
export interface HandIn { have: boolean; reach: number; prog: number; grab: boolean }

/** One step's input, as the game turns the movement channels and events into it. */
export interface ClimbIn {
  pulls: PullIn[];
  steps: StepIn[];
  lane: -1 | 0 | 1;
  hands: [HandIn, HandIn];
}

const NOHAND: HandIn = { have: false, reach: -1, prog: 0, grab: false };
export const IDLE: ClimbIn = { pulls: [], steps: [], lane: 0, hands: [NOHAND, NOHAND] };

export type ClimbEvent =
  | { type: 'pull'; side: 'L' | 'R'; gain: number; mult: number; h: number; pts: number }
  | { type: 'step'; k: number; gain: number; h: number; pts: number }
  | { type: 'warmup'; pulls: number }
  | { type: 'ready'; set: number }
  | { type: 'tick'; n: number }
  | { type: 'go'; set: number }
  | { type: 'warn'; closed: [boolean, boolean, boolean]; at: number; threat: boolean }
  | { type: 'rock'; hit: boolean; closed: [boolean, boolean, boolean]; pts: number }
  | { type: 'ledge'; phase: 'reach' | 'done'; pts: number }
  | { type: 'crux'; phase: 'start' | 'pass' | 'fail'; pts: number }
  | { type: 'breath'; phase: 'start' | 'end' }
  | { type: 'hint'; code: HintCode }
  | { type: 'summit'; set: number; left: number; pts: number }
  | { type: 'finish'; set: number; medal: Medal; height: number; pts: number }
  | { type: 'dnf'; set: number }
  | { type: 'rest'; set: number }
  | { type: 'out' }
  | { type: 'over' }
  | { type: 'complete' };

export interface ClimbOptions {
  difficulty: string;
  seated: boolean;
  quiet: boolean;
  /** The 'course' stream. */
  rng: Rng;
  /** Fewer or shorter climbs, a lower top, a shorter rest (tests and the end-to-end runs). */
  sets?: number;
  setSec?: number;
  summit?: number;
  restSec?: number;
}

const newClimber = (): ClimberState => ({
  h: 0, base: 0, pulls: 0, steps: 0, lastSide: '', lastPullAt: -99, pullAt: [-99, -99], arm: [0, 0],
  hands: [{ phase: 'low', peak: 0, grabbed: false, pending: null }, { phase: 'low', peak: 0, grabbed: false, pending: null }],
  streak: 0, bestStreak: 0, score: 0, lane: 0, idleFor: 0, hint: null, sec: 0, on: null, onAt: 0, cruxT: 0, cruxOn: false, breath: 0, rock: 0,
  clean: true, hits: 0, dodged: 0, ledges: 0, crux: 0, slips: 0, threat: false, hitAt: -99, hitLane: 0, results: [], dnfStreak: 0, qSum: 0, qN: 0, ran: 0,
});

export const levelFor = (s: ClimbState): Level => LEVELS[s.difficulty];

/** The wall of a level; with no ledge to climb (the seated and the quiet ways) it is lower by what the legs would have gained. */
export const summitOf = (lv: Level, ledges: boolean): number => (ledges ? lv.summit : lv.summit - Math.round(0.45 * lv.ledges * lv.ledgeLen));

export function createClimb(o: ClimbOptions): ClimbState {
  const difficulty = ((DIFFICULTIES as readonly string[]).includes(o.difficulty) ? o.difficulty : 'normal') as Difficulty;
  const lv = LEVELS[difficulty];
  const s: ClimbState = {
    v: 1, difficulty, seated: o.seated, quiet: o.quiet, t: 0, phase: 'warmup', set: 1, sets: Math.min(MAX_SETS, o.sets ?? lv.sets),
    hc: 0, setT: 0, setSec: o.setSec ?? lv.setSec, summit: o.summit ?? summitOf(lv, !o.seated && !o.quiet), restSec: o.restSec ?? lv.restSec, restLeft: 0, ticked: 99,
    warm: { t: 0, ranges: [] }, ref: REF.dflt, course: makeCourse(o.rng), sections: [], rocks: [], c: newClimber(),
  };
  placeSet(s);
  return s;
}

/** The wall of the climb about to begin. The climber starts at the foot. */
function placeSet(s: ClimbState): void {
  const lv = levelFor(s);
  const c = s.course[Math.min(s.set - 1, MAX_SETS - 1)] as ClimbCourse;
  s.sections = sectionsOf(lv, c, s.summit, !s.seated && !s.quiet);
  s.rocks = rocksOf(lv, c, s.setSec);
  s.setT = 0;
  const cl = s.c;
  cl.h = 0; cl.base = 0; cl.sec = 0; cl.on = null; cl.cruxT = 0; cl.cruxOn = false; cl.breath = 0; cl.rock = 0; cl.clean = true; cl.hits = 0; cl.dodged = 0; cl.ledges = 0; cl.crux = 0; cl.slips = 0; cl.threat = false;
  cl.idleFor = 0; cl.streak = 0; cl.lastSide = ''; cl.lane = 0;
  cl.pulls = 0; cl.steps = 0;
}

// ───────── the step ─────────

function hint(s: ClimbState, code: HintCode, out: ClimbEvent[]): void {
  const cl = s.c;
  if (cl.hint && cl.hint.code === code && s.t - cl.hint.at < 2) return;
  cl.hint = { code, at: s.t };
  out.push({ type: 'hint', code });
}

const multOf = (streak: number): number => 1 + Math.min(2, Math.floor(streak / 10));

/** The section the climber has yet to pass, or null. */
export const nextSection = (s: ClimbState): Section | null => s.sections[s.c.sec] ?? null;

/** The height the climber cannot pull past: the foot of the ledge or the breather ahead. */
function ceiling(s: ClimbState): number {
  const sec = nextSection(s);
  return sec && sec.kind !== 'crux' && s.c.on === null ? sec.y0 : s.summit;
}

/** Moves the climber into the section it has reached, and out of the one it has passed. */
function arrive(s: ClimbState, out: ClimbEvent[]): void {
  const cl = s.c;
  for (let guard = 0; guard < 6; guard++) {
    const sec = nextSection(s);
    if (!sec || cl.on !== null) return;
    if (sec.kind === 'crux') {
      if (!cl.cruxOn && cl.h >= sec.y0 - 1e-9) { cl.cruxOn = true; cl.cruxT = 0; out.push({ type: 'crux', phase: 'start', pts: 0 }); }
      if (cl.cruxOn && cl.h >= sec.y0 + sec.len - 1e-9) {
        cl.cruxOn = false; cl.base = cl.h; cl.sec++;
        cl.score += POINTS.crux;
        cl.crux++;
        out.push({ type: 'crux', phase: 'pass', pts: POINTS.crux });
        continue;
      }
      return;
    }
    if (cl.h < sec.y0 - 1e-9) return;
    cl.h = sec.y0;
    cl.on = sec.kind;
    cl.onAt = s.setT;
    if (sec.kind === 'rest') { cl.breath = BREATH_SEC; out.push({ type: 'breath', phase: 'start' }); } else out.push({ type: 'ledge', phase: 'reach', pts: 0 });
    return;
  }
}

function takePull(s: ClimbState, p: PullIn, out: ClimbEvent[]): void {
  const cl = s.c;
  const lv = levelFor(s);
  // A stroke that was under way when the ledge came is let go without a word.
  if (cl.on === 'ledge') { if (s.setT - cl.onAt > 0.7) hint(s, 'ledge_use_legs', out); return; }
  if (cl.on === 'rest') return;
  const keyed = p.side === '';
  const side: 'L' | 'R' = keyed ? (cl.lastSide === 'L' ? 'R' : 'L') : p.side as 'L' | 'R';
  const same = !keyed && side === cl.lastSide;
  let q = p.amp > 0 ? clamp(p.amp / s.ref, 0, 1.25) : 1;
  if (keyed && s.t - cl.lastPullAt < KEY_GAP) q *= 0.5;
  // A form hint is said, never punished (game-design.md 0.5): the climb is the same.
  if (p.shrug) hint(s, 'shoulders_down', out);
  const gain = lv.pull * q;
  cl.lastSide = side;
  cl.lastPullAt = s.t;
  cl.pullAt[side === 'L' ? 0 : 1] = s.t;
  cl.pulls++;
  cl.idleFor = 0;
  cl.qSum += clamp(q, 0, 1);
  cl.qN += 1;
  if (same) { cl.streak = 0; hint(s, 'same_hand_twice', out); } else { cl.streak++; cl.bestStreak = Math.max(cl.bestStreak, cl.streak); }
  const mult = multOf(cl.streak);
  const top = ceiling(s);
  const before = cl.h;
  cl.h = Math.min(top, cl.h + gain);
  const got = cl.h - before;
  const pts = Math.round(got * POINTS.metre * mult);
  cl.score += pts;
  out.push({ type: 'pull', side, gain: got, mult, h: cl.h, pts });
  arrive(s, out);
}

function takeStep(s: ClimbState, st: StepIn, out: ClimbEvent[]): void {
  const cl = s.c;
  if (cl.on !== 'ledge') return;
  const sec = nextSection(s) as Section;
  const per = sec.len / Math.max(1, sec.steps);
  cl.h = Math.min(sec.y0 + sec.len, cl.h + per);
  cl.steps++;
  cl.idleFor = 0;
  cl.qSum += clamp(st.k / 0.8, 0, 1);
  cl.qN += 1;
  const pts = Math.round(per * POINTS.metre * multOf(cl.streak));
  cl.score += pts;
  out.push({ type: 'step', k: st.k, gain: per, h: cl.h, pts });
  if (cl.h >= sec.y0 + sec.len - 1e-9) {
    cl.on = null; cl.base = cl.h; cl.sec++;
    cl.ledges++;
    cl.score += POINTS.ledge;
    out.push({ type: 'ledge', phase: 'done', pts: POINTS.ledge });
    arrive(s, out);
  }
}

/** Names what the hands did that did not count: a reach that stayed under the grip, a stroke given up. Channels only (the pose). */
function trackHands(s: ClimbState, ins: ClimbIn, dt: number, out: ClimbEvent[]): void {
  const cl = s.c;
  for (const i of [0, 1] as const) {
    const h = ins.hands[i];
    const t = cl.hands[i] as HandTrack;
    // The raised arm of the picture follows the real hand when there is one, else the last pull.
    const pulse = clamp(1 - (s.t - (cl.pullAt[i] as number)) / 0.45, 0, 1);
    const want = h.have ? clamp((h.reach + 0.55) / 0.95, 0, 1) : pulse;
    cl.arm[i] += (want - (cl.arm[i] as number)) * Math.min(1, dt * 14);
    if (t.pending && s.t - t.pending.at >= 0.3) {
      if ((cl.pullAt[i] as number) < t.pending.at - 0.6) hint(s, t.pending.code, out);
      t.pending = null;
    }
    if (!h.have) { t.phase = 'low'; continue; }
    if (t.phase === 'low') {
      if (h.reach >= REACH.tryFrom) { t.phase = 'try'; t.peak = h.reach; t.grabbed = h.grab; }
    } else {
      t.peak = Math.max(t.peak, h.reach);
      if (h.grab || h.reach >= REACH.grip) t.grabbed = true;
      if (h.reach < REACH.down) {
        t.phase = 'low';
        if (s.phase === 'climb' && cl.on === null && cl.breath <= 0) t.pending = { at: s.t, code: t.grabbed ? 'pull_through' : 'grab_higher' };
      }
    }
  }
}

function resolveRock(s: ClimbState, out: ClimbEvent[]): void {
  const cl = s.c;
  const r = s.rocks[cl.rock] as RockPlan;
  cl.rock++;
  const hit = r.closed[cl.lane + 1] as boolean;
  if (hit) {
    cl.hits++;
    cl.clean = false;
    cl.streak = 0;
    cl.hitAt = s.setT;
    cl.hitLane = cl.lane;
    const floor = cl.on === 'ledge' ? (nextSection(s) as Section).y0 : cl.base;
    cl.h = Math.max(floor, cl.h - SLIP);
    hint(s, 'rock_hit', out);
    out.push({ type: 'rock', hit: true, closed: r.closed, pts: 0 });
  } else {
    const pts = cl.threat ? POINTS.dodge : 0;
    if (cl.threat) cl.dodged++;
    cl.score += pts;
    out.push({ type: 'rock', hit: false, closed: r.closed, pts });
  }
  cl.threat = false;
}

/** The next rock to fall, or null; and whether its warning is showing. */
export function pendingRock(s: ClimbState): { rock: RockPlan; left: number; warned: boolean } | null {
  const r = s.rocks[s.c.rock];
  if (!r) return null;
  return { rock: r, left: r.t - s.setT, warned: r.t - s.setT <= WARN_SEC };
}

function climbStep(s: ClimbState, inp: ClimbIn, dt: number, out: ClimbEvent[]): void {
  const cl = s.c;
  cl.lane = inp.lane;
  if (cl.breath > 0) {
    cl.breath = Math.max(0, cl.breath - dt);
    if (cl.breath <= 0) {
      cl.on = null; cl.base = cl.h; cl.sec++;
      out.push({ type: 'breath', phase: 'end' });
      arrive(s, out);
    }
    cl.idleFor = 0;
  } else {
    s.setT += dt;
    cl.ran += dt;
    cl.idleFor += dt;
    for (const p of inp.pulls) takePull(s, p, out);
    for (const st of inp.steps) takeStep(s, st, out);
    // The hard part ticks while the climber is in it.
    if (cl.cruxOn) {
      cl.cruxT += dt;
      const sec = nextSection(s) as Section;
      if (cl.cruxT >= sec.sec && cl.h < sec.y0 + sec.len) {
        cl.cruxOn = false;
        cl.h = Math.max(cl.base, cl.h - CRUX_SLIP);
        cl.sec++;
        cl.slips++;
        cl.streak = 0;
        hint(s, 'crux_slow', out);
        out.push({ type: 'crux', phase: 'fail', pts: 0 });
      }
    }
    while (s.rocks[cl.rock] && (s.rocks[cl.rock] as RockPlan).t <= s.setT + 1e-9) resolveRock(s, out);
    if (cl.idleFor >= 5 && cl.idleFor - dt < 5) hint(s, 'move_more', out);
  }
}

/** Advances the run by one step. Returns what happened. */
export function stepClimb(s: ClimbState, dt: number, inp: ClimbIn): ClimbEvent[] {
  const out: ClimbEvent[] = [];
  if (s.phase === 'over' || s.phase === 'complete') return out;
  s.t += dt;
  const cl = s.c;
  trackHands(s, inp, dt, out);

  if (s.phase === 'warmup') {
    s.warm.t += dt;
    s.hc += dt;
    cl.lane = inp.lane;
    for (const p of inp.pulls) {
      if (p.amp > 0) s.warm.ranges.push(p.amp);
      else s.warm.ranges.push(s.ref);
      cl.pullAt[p.side === 'R' ? 1 : 0] = s.t;
      cl.pulls++;
      out.push({ type: 'warmup', pulls: s.warm.ranges.length });
    }
    if (s.warm.ranges.length >= WARMUP.pulls || s.warm.t >= WARMUP.maxSec) endWarmup(s, out);
    return out;
  }

  if (s.phase === 'ready') {
    s.hc += dt;
    cl.lane = inp.lane;
    const n = Math.ceil(READY_SEC - s.hc - 1e-9);
    if (n >= 1 && n < s.ticked) { s.ticked = n; out.push({ type: 'tick', n }); }
    if (s.hc >= READY_SEC - 1e-9) {
      s.phase = 'climb';
      s.hc = 0;
      cl.idleFor = 0;
      cl.lastPullAt = -99;
      out.push({ type: 'go', set: s.set });
    }
    return out;
  }

  if (s.phase === 'climb') {
    s.hc += dt;
    const warnedBefore = pendingRock(s);
    climbStep(s, inp, dt, out);
    const pr = pendingRock(s);
    if (pr && pr.warned && !(warnedBefore && warnedBefore.rock === pr.rock && warnedBefore.warned)) {
      cl.threat = pr.rock.closed[cl.lane + 1] as boolean;
      out.push({ type: 'warn', closed: pr.rock.closed, at: pr.rock.t, threat: cl.threat });
    }
    if (cl.h >= s.summit - 1e-9) finishSet(s, 'summit', out);
    else if (s.setT >= s.setSec - 1e-9) finishSet(s, 'time', out);
    else if (cl.idleFor >= QUIT) { cl.idleFor = 0; dnfSet(s, out); }
    return out;
  }

  if (s.phase === 'finish') {
    s.hc += dt;
    if (s.hc >= HOLD_SEC - 1e-9) {
      if (cl.dnfStreak >= MAX_QUIT) {
        s.phase = 'over';
        out.push({ type: 'out' });
        out.push({ type: 'over' });
      } else if (s.set >= s.sets) {
        s.phase = 'complete';
        out.push({ type: 'complete' });
      } else if (s.restSec > 0) {
        s.phase = 'rest';
        s.restLeft = s.restSec;
        s.hc = 0;
        out.push({ type: 'rest', set: s.set });
      } else toReady(s, out);
    }
    return out;
  }

  // rest
  s.hc += dt;
  s.restLeft = Math.max(0, s.restLeft - dt);
  if (s.restLeft <= 1e-9) toReady(s, out);
  return out;
}

function toReady(s: ClimbState, out: ClimbEvent[]): void {
  s.set++;
  s.phase = 'ready';
  s.hc = 0;
  s.ticked = 99;
  placeSet(s);
  out.push({ type: 'ready', set: s.set });
}

function endWarmup(s: ClimbState, out: ClimbEvent[]): void {
  if (s.warm.ranges.length >= 2) s.ref = clamp(median(s.warm.ranges) * 0.95, REF.lo, REF.hi);
  const cl = s.c;
  cl.pulls = 0; cl.qSum = 0; cl.qN = 0; cl.ran = 0;
  s.phase = 'ready';
  s.hc = 0;
  s.ticked = 99;
  out.push({ type: 'ready', set: 1 });
}

function finishSet(s: ClimbState, why: 'summit' | 'time', out: ClimbEvent[]): void {
  const cl = s.c;
  const top = why === 'summit';
  const left = Math.max(0, s.setSec - s.setT);
  const height = Math.min(s.summit, cl.h);
  const medal: Medal = top ? 'gold' : height >= s.summit * STARS.two ? 'silver' : height >= s.summit * STARS.one ? 'bronze' : 'none';
  let pts = 0;
  if (top) { pts += POINTS.summit + Math.round(left * POINTS.left); out.push({ type: 'summit', set: s.set, left, pts }); }
  if (cl.clean && height >= s.summit * STARS.one) pts += POINTS.clean;
  cl.score += pts;
  cl.dnfStreak = 0;
  cl.cruxOn = false;
  cl.on = null;
  cl.results.push({ height: Math.round(height * 10) / 10, time: Math.round(s.setT * 100) / 100, left: Math.round(left * 100) / 100, medal, pts, clean: cl.clean, hits: cl.hits, dodged: cl.dodged, pulls: cl.pulls, steps: cl.steps, ledges: cl.ledges, crux: cl.crux, slips: cl.slips });
  out.push({ type: 'finish', set: s.set, medal, height, pts });
  s.phase = 'finish';
  s.hc = 0;
}

function dnfSet(s: ClimbState, out: ClimbEvent[]): void {
  const cl = s.c;
  cl.dnfStreak++;
  cl.streak = 0;
  cl.cruxOn = false;
  cl.on = null;
  cl.results.push({ height: Math.round(cl.h * 10) / 10, time: Math.round(s.setT * 100) / 100, left: 0, medal: 'dnf', pts: 0, clean: cl.clean, hits: cl.hits, dodged: cl.dodged, pulls: cl.pulls, steps: cl.steps, ledges: cl.ledges, crux: cl.crux, slips: cl.slips });
  out.push({ type: 'dnf', set: s.set });
  s.phase = 'finish';
  s.hc = 0;
}

/** Seconds left in the climb, or the rest left, or the three-two-one: the number the plates show. */
export const clockOf = (s: ClimbState): number => (s.phase === 'rest' ? s.restLeft : s.phase === 'ready' ? Math.max(0, READY_SEC - s.hc) : s.phase === 'climb' ? Math.max(0, s.setSec - s.setT) : 0);

/** The share of the wall climbed, 0..1. */
export const progressOf = (s: ClimbState, h: number = s.c.h): number => clamp(h / s.summit, 0, 1);

export const totals = (s: ClimbState): { score: number; pulls: number; steps: number; hits: number; dodged: number; bestStreak: number; climbs: number } => {
  const r = s.c.results;
  return { score: s.c.score, pulls: r.reduce((n, x) => n + x.pulls, 0), steps: r.reduce((n, x) => n + x.steps, 0), hits: r.reduce((n, x) => n + x.hits, 0), dodged: r.reduce((n, x) => n + x.dodged, 0), bestStreak: s.c.bestStreak, climbs: r.filter((x) => x.medal !== 'dnf').length };
};
