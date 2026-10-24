// Sprint template, Knee Sprint (game-design.md card 26): a race on the spot. Every counted knee lift is a stride; the
// pace of the strides and the height of the knees set the speed (card: speed = f(tempo) x (0.6 + 0.4 x mean k)). A heat is
// one sprint over a distance against the clock and a computer rival (or the second player); heats come with a real rest
// between them (the interval programme of the card); hurdles ask for a jump, or in the quiet and low-impact way for a knee
// lifted to the hip. The seated variant races on the swing of the arms and the march of the knees (movement energy).
//
// The simulation is pure and fixed-step, like the flight template's: plain data in, plain data out, no clock, no DOM, no
// Math.random and no transcendental functions or powers (their last digits differ between engines, and a ghost or a duel
// must replay identically on every device). Distances are in metres, time in seconds.
//
// What the movement library gives (core/moves/kneeLift.ts), and how it is used here:
//   rep events (id 'kneeLift', side L or R): q.range = the peak lift k of that knee (0 = at rest, 1 = at hip height). The
//   detector's own floor is one low line for everybody (a march, 0.5); the height the level asks for is applied HERE, as the
//   share of the speed the knees give, and the player is told why when the knees are low.
//   channels: knee.L, knee.R (k now), kneeMax, lifted, cadence, meanK, torso (the shoulder to hip line: shorter than 0.85
//   when leaning back), steps. The sim keeps its own cadence from the step events (so keys and touch work the same).
//   the jump detector (id 'jump') gives the hurdle jump; energy.avg (T/s) is the seated variant's effort.
import { clamp, median } from '../kit-g1/index.ts';
import type { Rng } from '../../core/types/index.ts';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

/**
 * What a level asks. Distances and the interval programme are the card's (100 m, 6 x 100 m with 40 s of rest, 400 m);
 * the speeds and medal times were tuned with the bots of testing/bot.ts (a perfect runner, a good one, a sloppy one) so
 * that a good runner at the level's pace lands on silver and beats the computer; none of it is measured on people yet.
 */
export interface Level {
  /** Metres of one heat. */
  dist: number;
  heats: number;
  /** Seconds of rest between heats. */
  restSec: number;
  hurdles: number;
  /** Steps per minute that give the full speed. */
  cadence: number;
  /** Top speed, m/s: the cadence above and a knee as high as `kFull`. */
  vmax: number;
  /** The peak lift that gives the knees' full share of the speed (k). */
  kFull: number;
  /** The computer rival's time for 100 m, seconds. */
  rival100: number;
  /** Medal times for 100 m, seconds (the longer heats get more time per metre). */
  gold100: number;
  silver100: number;
  bronze100: number;
  /** Seconds after which a heat is called off. */
  cap: number;
}

export const LEVELS: Readonly<Record<Difficulty, Level>> = {
  easy: { dist: 100, heats: 3, restSec: 25, hurdles: 0, cadence: 105, vmax: 5.4, kFull: 0.75, rival100: 27, gold100: 21, silver100: 25, bronze100: 30, cap: 50 },
  normal: { dist: 100, heats: 4, restSec: 25, hurdles: 2, cadence: 125, vmax: 5.9, kFull: 0.85, rival100: 22.5, gold100: 19, silver100: 22.5, bronze100: 27, cap: 45 },
  hard: { dist: 100, heats: 6, restSec: 40, hurdles: 3, cadence: 145, vmax: 6.3, kFull: 0.9, rival100: 19.5, gold100: 17.5, silver100: 20.5, bronze100: 24, cap: 40 },
  expert: { dist: 400, heats: 1, restSec: 0, hurdles: 8, cadence: 150, vmax: 6.4, kFull: 0.9, rival100: 18.5, gold100: 17.5, silver100: 20.5, bronze100: 24, cap: 130 },
};

export const levelOf = (d: string): Level => LEVELS[(DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : 'normal'];

/** Time for a heat of `dist` metres at `per100` seconds per 100 m: the longer ones are a little slower per metre. */
export const par = (per100: number, dist: number): number => per100 * (dist / 100) * (1 + 0.03 * (dist / 100 - 1));

export const WORLD = {
  /** Metres from the start line to the first and from the last hurdle to the finish. */
  hurdleFrom: 20,
  hurdleTo: 12,
  /** The runner passes the finish line past this many metres of run-out. */
  runOut: 6,
  /** The rival starts this many seconds after the gun (a computer has no reaction time to show). */
  rivalDelay: 0.5,
} as const;

/** Seconds of the three-two-one before a heat, of the hold on the result after it, and of the longest the warm-up goes on. */
export const READY_SEC = 3;
export const HOLD_SEC = 2.6;
export const WARMUP = { steps: 8, seatedSec: 8, maxSec: 25, comfort: 1.3 } as const;

const SPEED = {
  /** Cadence window and the pause after which the cadence reads zero. */
  window: 3,
  idle: 1.2,
  /** The speed relaxes toward its target with this time constant, seconds. */
  tau: 0.33,
  /** The share of the target speed during a stumble. */
  stumble: 0.35,
  stumbleSec: 0.9,
  /** Most of the full cadence that still adds speed. */
  over: 1.1,
  /** The speed of a heat run seated, as a share of the standing speed (fair scaling; its own ranking). */
  seated: 0.92,
  /** The effort that gives the full speed seated until the warm-up has measured the player's own (T/s). */
  effort: 0.7,
} as const;

const HURDLE = {
  /** Seconds a jump (or a high knee) keeps the runner over the ground. */
  air: 0.55,
  /** The knee lift that steps over a hurdle: at hip height. */
  highK: 0.95,
  /** A new action is not counted while the last one is still in the air. */
  rearm: 0.2,
  /** After this many seconds without a step the runner is told to keep moving; without anything at all, the heat is called off. */
  moveHint: 1.7,
  quit: 10,
  /** Two heats in a row called off end the run. */
  dnfs: 2,
} as const;

export const MEDAL_POINTS = { gold: 100, silver: 70, bronze: 45, finish: 25 } as const;
export const RIVAL_BONUS = 20;
export const WIN_BONUS = 30;
export const HURDLE_POINTS = 5;

// ───────── the course ─────────

/** What the 'course' stream decides: per heat, a jitter for every hurdle and the rival's pace. Always the same number of draws. */
export interface HeatCourse { jitter: number[]; pace: number }
const MAX_HURDLES = 8;
const MAX_HEATS = 6;

export function makeCourse(rng: Rng): HeatCourse[] {
  const out: HeatCourse[] = [];
  for (let h = 0; h < MAX_HEATS; h++) {
    const jitter: number[] = [];
    for (let i = 0; i < MAX_HURDLES; i++) jitter.push(rng());
    out.push({ jitter, pace: 0.97 + rng() * 0.06 });
  }
  return out;
}

/** The hurdle positions of a heat (metres from the start), spread over the middle of the course with a jitter. */
export function hurdlesOf(lv: Level, c: HeatCourse, dist: number = lv.dist): number[] {
  const span = dist - WORLD.hurdleFrom - WORLD.hurdleTo;
  const n = span < 8 ? 0 : Math.min(lv.hurdles, MAX_HURDLES, Math.floor(span / 8));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const cell = span / n;
    out.push(round1(WORLD.hurdleFrom + cell * i + cell * (0.25 + 0.5 * (c.jitter[i] as number))));
  }
  return out;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

// ───────── state ─────────

export type HintCode = 'knee_not_high' | 'same_leg_twice' | 'move_more' | 'body_not_straight' | 'hurdle_early' | 'hurdle_late' | 'hurdle_none';
export type Medal = 'gold' | 'silver' | 'bronze' | 'none' | 'dnf';

export interface HeatResult { time: number; medal: Medal; pts: number; beatRival: boolean; rank: number; cleared: number; knocked: number }

export interface LaneState {
  dist: number;
  v: number;
  steps: number;
  /** Times (run clock) of the recent steps and their peak lifts. */
  stepT: number[];
  kHist: number[];
  /** Run clock of the last step of each leg (the picture's legs), and which leg went last. */
  stepAt: [number, number];
  lastLeg: -1 | 0 | 1;
  /** Seconds the runner stumbles for yet. */
  stumble: number;
  /** Seconds since the last jump or high knee. */
  sinceAct: number;
  /** Run clock of the last knock, for naming a jump that came too late. */
  knockAt: number;
  next: number;
  streak: number;
  bestStreak: number;
  cleared: number;
  knocked: number;
  score: number;
  /** Seated effort, smoothed, T/s. */
  eff: number;
  /** In a heat. */
  finished: boolean;
  dnf: boolean;
  finishT: number;
  idleFor: number;
  sinceStep: number;
  /** The lift of each knee now (the picture's knee meters). */
  kneeNow: [number, number];
  /** Best lift of a knee since the last counted step, and whether each knee is up (for naming "same leg twice"). */
  lowPeak: number;
  up: [boolean, boolean];
  lastUp: -1 | 0 | 1;
  lastUpT: number;
  leanFor: number;
  dnfStreak: number;
  hint: { code: HintCode; at: number } | null;
  results: HeatResult[];
  /** For the quality of the run: the share of the full knee lift of every counted step (or of the full effort, seated), and how many. */
  qSum: number;
  qN: number;
  /** Seconds of the run spent running (the calories). */
  ran: number;
}

export type Phase = 'warmup' | 'ready' | 'play' | 'finish' | 'rest' | 'over' | 'complete';

export interface RivalState { dist: number; speed: number; finished: boolean; finishT: number }

export interface SprintState {
  v: 1;
  difficulty: Difficulty;
  players: 1 | 2;
  seated: boolean;
  /** The quiet way: no jumping and no stamping, so a hurdle is stepped over. */
  quiet: boolean;
  /** Run clock: all seconds since the start. */
  t: number;
  phase: Phase;
  /** 1-based number of the heat being run or just run. */
  heat: number;
  heats: number;
  /** Seconds into the phase (the heat clock in 'play'). */
  hc: number;
  /** Seconds of rest between the heats (the level's own; shorter in the end-to-end runs), seconds left in a rest, and the three-two-one's whole seconds already ticked. */
  restSec: number;
  restLeft: number;
  ticked: number;
  warm: { t: number; stepT: number[]; ks: number[]; eff: number[] };
  /** What the warm-up measured (or the level's own): the cadence and the lift that give the full speed, the seated effort. */
  cadFull: number;
  kFull: number;
  effFull: number;
  dist: number;
  hurdles: number[];
  course: HeatCourse[];
  rival: RivalState | null;
  lanes: LaneState[];
}

const newLane = (): LaneState => ({
  dist: 0, v: 0, steps: 0, stepT: [], kHist: [], stepAt: [-99, -99], lastLeg: -1, stumble: 0, sinceAct: 9, knockAt: -99, next: 0, streak: 0, bestStreak: 0,
  cleared: 0, knocked: 0, score: 0, eff: 0, finished: false, dnf: false, finishT: 0, idleFor: 0, sinceStep: 9, kneeNow: [0, 0], lowPeak: 0, up: [false, false],
  lastUp: -1, lastUpT: -99, leanFor: 0, dnfStreak: 0, hint: null, results: [], qSum: 0, qN: 0, ran: 0,
});

export interface StepIn { k: number; side: 'L' | 'R' | '' }

/** One lane's input for one step, as the game turns the movement channels and events into it. */
export interface LaneIn {
  steps: StepIn[];
  /** A jump (the jump detector; the game leaves it out in the quiet and the seated variants). */
  jumps: number;
  /** The movement energy of the player, T/s (seated). */
  effort: number;
  /** The lift of each knee now and the best of them (channels), for naming a low knee. */
  knees: [number, number];
  /** The torso line (shoulder to hip, in T). */
  torso: number;
}

export const IDLE: LaneIn = { steps: [], jumps: 0, effort: 0, knees: [0, 0], torso: 1 };

export type SprintEvent =
  | { type: 'step'; lane: number; k: number; leg: number; high: boolean }
  | { type: 'jump'; lane: number }
  | { type: 'hurdle'; lane: number; cleared: boolean; pts: number; streak: number; reason: HintCode | null; at: number }
  | { type: 'hint'; lane: number; code: HintCode }
  | { type: 'warmup'; steps: number }
  | { type: 'ready'; heat: number; cadence: number }
  | { type: 'tick'; n: number }
  | { type: 'go'; heat: number }
  | { type: 'finish'; lane: number; time: number; medal: Medal; pts: number; rank: number; beatRival: boolean }
  | { type: 'dnf'; lane: number }
  | { type: 'rest'; heat: number }
  | { type: 'out'; lane: number }
  | { type: 'over' }
  | { type: 'complete' };

export interface SprintOptions {
  difficulty: string;
  players: 1 | 2;
  seated: boolean;
  quiet: boolean;
  /** The 'course' stream. */
  rng: Rng;
  /** Fewer heats (tests and the end-to-end runs). */
  heats?: number;
  /** A shorter heat (tests and the end-to-end runs), metres. */
  dist?: number;
  /** A shorter rest between the heats (tests and the end-to-end runs), seconds. */
  restSec?: number;
}

export function createSprint(o: SprintOptions): SprintState {
  const difficulty = ((DIFFICULTIES as readonly string[]).includes(o.difficulty) ? o.difficulty : 'normal') as Difficulty;
  const lv = LEVELS[difficulty];
  const s: SprintState = {
    v: 1, difficulty, players: o.players, seated: o.seated, quiet: o.quiet,
    t: 0, phase: o.players === 2 ? 'ready' : 'warmup', heat: 1, heats: Math.min(MAX_HEATS, o.heats ?? lv.heats), hc: 0, restSec: o.restSec ?? lv.restSec, restLeft: 0, ticked: 99,
    warm: { t: 0, stepT: [], ks: [], eff: [] },
    cadFull: lv.cadence, kFull: lv.kFull, effFull: SPEED.effort, dist: o.dist ?? lv.dist,
    hurdles: [], course: makeCourse(o.rng), rival: null,
    lanes: Array.from({ length: o.players }, () => newLane()),
  };
  placeHeat(s);
  return s;
}

export const levelFor = (s: SprintState): Level => LEVELS[s.difficulty];

/** Hurdles of the heat about to begin; fewer when the distance was shortened. Seated runners have none. */
function placeHeat(s: SprintState): void {
  const lv = levelFor(s);
  const c = s.course[Math.min(s.heat - 1, MAX_HEATS - 1)] as HeatCourse;
  s.hurdles = s.seated ? [] : hurdlesOf(lv, c, s.dist);
  s.rival = s.players === 1 ? { dist: 0, speed: (s.dist / par(lv.rival100, s.dist)) * c.pace, finished: false, finishT: 0 } : null;
  for (const l of s.lanes) {
    l.dist = 0; l.v = 0; l.finished = false; l.dnf = false; l.finishT = 0; l.next = 0; l.stumble = 0; l.idleFor = 0; l.sinceStep = 9;
    l.stepT = []; l.kHist = []; l.lowPeak = 0; l.streak = 0; l.sinceAct = 9; l.leanFor = 0; l.up = [false, false]; l.cleared = 0; l.knocked = 0;
  }
}

// ───────── the step ─────────

/** The steps per minute over the recent steps; 0 after a pause. */
export function cadenceOf(l: Pick<LaneState, 'stepT'>, t: number): number {
  const ts = l.stepT;
  const n = ts.length;
  if (n < 2) return 0;
  const first = ts[0] as number, last = ts[n - 1] as number;
  if (t - last > SPEED.idle || last <= first) return 0;
  return ((n - 1) * 60) / (last - first);
}

export const meanLift = (l: Pick<LaneState, 'kHist'>, fallback: number): number => (l.kHist.length ? l.kHist.reduce((a, b) => a + b, 0) / l.kHist.length : fallback);

/** The speed a lane is heading for: from the strides, or from the effort seated (whichever is the greater). */
export function targetSpeed(s: SprintState, l: LaneState): number {
  const lv = levelFor(s);
  const c = cadenceOf(l, s.t);
  const kHat = clamp(meanLift(l, s.kFull) / s.kFull, 0, 1);
  const strides = lv.vmax * clamp(c / s.cadFull, 0, SPEED.over) * (0.6 + 0.4 * kHat);
  const seated = s.seated ? lv.vmax * SPEED.seated * clamp(l.eff / s.effFull, 0, SPEED.over) : 0;
  return Math.max(strides, seated) * (l.stumble > 0 ? SPEED.stumble : 1);
}

function hint(s: SprintState, i: number, code: HintCode, out: SprintEvent[]): void {
  const l = s.lanes[i] as LaneState;
  if (l.hint && l.hint.code === code && s.t - l.hint.at < 2) return;
  l.hint = { code, at: s.t };
  out.push({ type: 'hint', lane: i, code });
}

const LEG_ENTER = 0.5;
const LEG_LEAVE = 0.35;

/** Counts a step: the cadence, the knee's height, the leg that went, the strike for the picture. */
function takeStep(s: SprintState, i: number, st: StepIn, out: SprintEvent[]): void {
  const l = s.lanes[i] as LaneState;
  // A step without a side (keys, touch) is the other leg's.
  const leg = st.side === 'L' ? 0 : st.side === 'R' ? 1 : l.lastLeg === 0 ? 1 : 0;
  l.lastLeg = leg as 0 | 1;
  l.stepAt[leg] = s.t;
  l.steps++;
  l.sinceStep = 0;
  l.idleFor = 0;
  l.lowPeak = 0;
  l.stepT.push(s.t);
  while (l.stepT.length > 1 && (l.stepT[0] as number) < s.t - SPEED.window) l.stepT.shift();
  const k = clamp(st.k, 0, 1.4);
  l.kHist.push(k);
  if (l.kHist.length > 6) l.kHist.shift();
  l.qSum += clamp(k / s.kFull, 0, 1);
  l.qN += 1;
  const high = k >= HURDLE.highK;
  out.push({ type: 'step', lane: i, k, leg, high });
  // The way over a hurdle without leaving the ground: a knee at the hip.
  if (high) act(s, i, out);
  if (k < s.kFull * 0.8 && s.phase === 'play') hint(s, i, 'knee_not_high', out);
}

/** A jump or a very high knee: the runner is over the ground for a moment. */
function act(s: SprintState, i: number, out: SprintEvent[]): void {
  const l = s.lanes[i] as LaneState;
  if (l.sinceAct < HURDLE.rearm) return;
  l.sinceAct = 0;
  // A jump that comes just after a hurdle was knocked is the late one.
  if (s.t - l.knockAt < 0.6 && l.knockAt > 0) hint(s, i, 'hurdle_late', out);
}

function rank(s: SprintState, i: number): number {
  const mine = (s.lanes[i] as LaneState).finishT;
  let r = 1;
  s.lanes.forEach((o, k) => { if (k !== i && o.finished && !o.dnf && o.finishT < mine) r++; });
  return r;
}

function finishLane(s: SprintState, i: number, out: SprintEvent[]): void {
  const lv = levelFor(s);
  const l = s.lanes[i] as LaneState;
  l.finished = true;
  // The moment the line was crossed, between this step and the last.
  const over = l.dist - s.dist;
  l.finishT = Math.max(0.1, s.hc - (l.v > 0 ? over / l.v : 0));
  const per = (p: number): number => par(p, s.dist);
  const medal: Medal = l.finishT <= per(lv.gold100) ? 'gold' : l.finishT <= per(lv.silver100) ? 'silver' : l.finishT <= per(lv.bronze100) ? 'bronze' : 'none';
  const scale = s.dist / 100;
  const rivalT = s.rival ? s.dist / s.rival.speed + WORLD.rivalDelay : Infinity;
  const beatRival = s.rival !== null && l.finishT < rivalT;
  const medalPts = (medal === 'gold' ? MEDAL_POINTS.gold : medal === 'silver' ? MEDAL_POINTS.silver : medal === 'bronze' ? MEDAL_POINTS.bronze : MEDAL_POINTS.finish) * scale;
  const r = rank(s, i);
  const pts = Math.round(medalPts + (beatRival ? RIVAL_BONUS : 0) + (s.players === 2 && r === 1 && s.lanes.length === 2 ? WIN_BONUS : 0));
  l.score += pts;
  l.dnfStreak = 0;
  l.results.push({ time: Math.round(l.finishT * 100) / 100, medal, pts, beatRival, rank: r, cleared: l.cleared, knocked: l.knocked });
  out.push({ type: 'finish', lane: i, time: l.finishT, medal, pts, rank: r, beatRival });
}

function dnfLane(s: SprintState, i: number, out: SprintEvent[]): void {
  const l = s.lanes[i] as LaneState;
  l.finished = true;
  l.dnf = true;
  l.dnfStreak++;
  l.streak = 0;
  l.results.push({ time: 0, medal: 'dnf', pts: 0, beatRival: false, rank: 0, cleared: l.cleared, knocked: l.knocked });
  out.push({ type: 'dnf', lane: i });
}

/** Moves a lane for one step in a heat. */
function run(s: SprintState, i: number, inp: LaneIn, dt: number, racing: boolean, out: SprintEvent[]): void {
  const l = s.lanes[i] as LaneState;
  l.eff += (inp.effort - l.eff) * Math.min(1, dt * 4);
  l.kneeNow = [inp.knees[0], inp.knees[1]];
  l.sinceAct += dt;
  l.sinceStep += dt;
  l.stumble = Math.max(0, l.stumble - dt);
  // Legs: a knee over the line is up; a lift of one leg right after the same leg is named.
  for (const leg of [0, 1] as const) {
    const k = inp.knees[leg];
    if (!l.up[leg]) {
      if (k >= LEG_ENTER) {
        l.up[leg] = true;
        if (racing && l.lastUp === leg && s.t - l.lastUpT < 1.5 && !s.seated) hint(s, i, 'same_leg_twice', out);
        l.lastUp = leg;
        l.lastUpT = s.t;
      }
    } else if (k < LEG_LEAVE) l.up[leg] = false;
  }
  l.lowPeak = Math.max(l.lowPeak, inp.knees[0], inp.knees[1]);
  for (const st of inp.steps) takeStep(s, i, st, out);
  if (inp.jumps > 0 && !s.quiet && !s.seated) { out.push({ type: 'jump', lane: i }); act(s, i, out); }

  const target = targetSpeed(s, l);
  l.v += (target - l.v) * Math.min(1, dt / SPEED.tau);
  if (l.v < 0.02 && target === 0) l.v = 0;
  const moving = l.v > 0.3;
  if (moving) l.ran += dt;
  if (!racing) { l.dist += l.v * dt; return; }

  const before = l.dist;
  l.dist += l.v * dt;
  if (s.seated && moving) { l.qSum += clamp(l.eff / s.effFull, 0, 1) * dt; l.qN += dt; }
  // Why it is slow, in the body's words.
  const still = s.seated ? l.eff < s.effFull * 0.2 : l.sinceStep >= HURDLE.moveHint;
  l.idleFor = still ? l.idleFor + dt : 0;
  if (!s.seated) {
    if (l.sinceStep >= 1 && l.lowPeak >= 0.2 && l.lowPeak < LEG_ENTER) hint(s, i, 'knee_not_high', out);
    else if (l.sinceStep >= HURDLE.moveHint && s.hc >= 2) hint(s, i, 'move_more', out);
    l.leanFor = inp.torso < 0.85 && l.sinceStep < 1 ? l.leanFor + dt : 0;
    if (l.leanFor > 1) hint(s, i, 'body_not_straight', out);
  } else if (l.idleFor > 1.5) hint(s, i, 'move_more', out);

  // Hurdles: the runner has to be in the air when the hurdle comes.
  while (l.next < s.hurdles.length && l.dist >= (s.hurdles[l.next] as number) && before < (s.hurdles[l.next] as number) + 1e-9) {
    const at = s.hurdles[l.next] as number;
    if (l.sinceAct <= HURDLE.air) {
      l.streak++;
      l.bestStreak = Math.max(l.bestStreak, l.streak);
      l.cleared++;
      const mult = 1 + Math.min(2, Math.floor(l.streak / 3));
      const pts = HURDLE_POINTS * mult;
      l.score += pts;
      out.push({ type: 'hurdle', lane: i, cleared: true, pts, streak: l.streak, reason: null, at });
    } else {
      const reason: HintCode = l.sinceAct <= 1.1 ? 'hurdle_early' : 'hurdle_none';
      l.streak = 0;
      l.knocked++;
      l.stumble = SPEED.stumbleSec;
      l.knockAt = s.t;
      l.hint = { code: reason, at: s.t };
      out.push({ type: 'hurdle', lane: i, cleared: false, pts: 0, streak: 0, reason, at });
    }
    l.next++;
  }
  if (!l.finished && l.dist >= s.dist) finishLane(s, i, out);
  else if (!l.finished && l.idleFor >= HURDLE.quit) dnfLane(s, i, out);
}

/** Advances the run by one step. `ins` has one entry per lane. Returns what happened. */
export function stepSprint(s: SprintState, dt: number, ins: readonly LaneIn[]): SprintEvent[] {
  const out: SprintEvent[] = [];
  if (s.phase === 'over' || s.phase === 'complete') return out;
  const lv = levelFor(s);
  s.t += dt;

  if (s.phase === 'warmup') {
    s.warm.t += dt;
    s.hc += dt;
    const inp = ins[0] ?? IDLE;
    const l = s.lanes[0] as LaneState;
    const n0 = l.steps;
    run(s, 0, inp, dt, false, out);
    if (l.steps > n0) {
      for (const st of inp.steps) { s.warm.stepT.push(s.t); s.warm.ks.push(st.k); }
      out.push({ type: 'warmup', steps: s.warm.stepT.length });
    }
    if (s.seated && inp.effort > 0.15) s.warm.eff.push(inp.effort);
    const done = s.seated ? s.warm.t >= WARMUP.seatedSec && s.warm.eff.length >= 60 : s.warm.stepT.length >= WARMUP.steps;
    if (done || s.warm.t >= WARMUP.maxSec) endWarmup(s, out);
    return out;
  }

  if (s.phase === 'ready') {
    s.hc += dt;
    for (let i = 0; i < s.lanes.length; i++) run(s, i, IDLE, dt, false, out);
    // The track holds the runners still: no distance before the gun.
    for (const l of s.lanes) { l.dist = 0; }
    const n = Math.ceil(READY_SEC - s.hc - 1e-9);
    if (n >= 1 && n < s.ticked) { s.ticked = n; out.push({ type: 'tick', n }); }
    if (s.hc >= READY_SEC - 1e-9) {
      s.phase = 'play';
      s.hc = 0;
      for (const l of s.lanes) { l.v = 0; l.stepT = []; l.kHist = []; l.sinceStep = 0; l.idleFor = 0; }
      out.push({ type: 'go', heat: s.heat });
    }
    return out;
  }

  if (s.phase === 'play') {
    s.hc += dt;
    for (let i = 0; i < s.lanes.length; i++) {
      const l = s.lanes[i] as LaneState;
      if (l.finished && !l.dnf) {
        // After the line the runner jogs on and slows down.
        l.v = Math.max(0, l.v - 2.2 * dt);
        if (l.dist < s.dist + WORLD.runOut) l.dist += l.v * dt;
        continue;
      }
      if (l.dnf) { l.v = 0; continue; }
      run(s, i, ins[i] ?? IDLE, dt, true, out);
    }
    const r = s.rival;
    if (r && !r.finished && s.hc >= WORLD.rivalDelay) {
      r.dist += r.speed * dt;
      if (r.dist >= s.dist) { r.dist = s.dist; r.finished = true; r.finishT = s.hc; }
    }
    const capped = s.hc >= lv.cap;
    if (capped) for (let i = 0; i < s.lanes.length; i++) if (!(s.lanes[i] as LaneState).finished) dnfLane(s, i, out);
    if (s.lanes.every((l) => l.finished)) {
      s.phase = 'finish';
      s.hc = 0;
    }
    return out;
  }

  if (s.phase === 'finish') {
    s.hc += dt;
    for (const l of s.lanes) { if (!l.dnf) { l.v = Math.max(0, l.v - 2.2 * dt); if (l.dist < s.dist + WORLD.runOut) l.dist += l.v * dt; } }
    if (s.hc >= HOLD_SEC - 1e-9) {
      if (s.lanes.every((l) => l.dnfStreak >= HURDLE.dnfs)) {
        s.phase = 'over';
        for (let i = 0; i < s.lanes.length; i++) out.push({ type: 'out', lane: i });
        out.push({ type: 'over' });
      } else if (s.heat >= s.heats) {
        s.phase = 'complete';
        out.push({ type: 'complete' });
      } else if (s.restSec > 0) {
        s.phase = 'rest';
        s.restLeft = s.restSec;
        s.hc = 0;
        out.push({ type: 'rest', heat: s.heat });
      } else toReady(s, out);
    }
    return out;
  }

  // rest
  s.hc += dt;
  s.restLeft = Math.max(0, s.restLeft - dt);
  for (const l of s.lanes) { l.v = Math.max(0, l.v - 3 * dt); }
  if (s.restLeft <= 1e-9) toReady(s, out);
  return out;
}

function toReady(s: SprintState, out: SprintEvent[]): void {
  s.heat++;
  s.phase = 'ready';
  s.hc = 0;
  s.ticked = 99;
  placeHeat(s);
  out.push({ type: 'ready', heat: s.heat, cadence: s.cadFull });
}

function endWarmup(s: SprintState, out: SprintEvent[]): void {
  const lv = levelFor(s);
  const times = s.warm.stepT;
  if (times.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push((times[i] as number) - (times[i - 1] as number));
    const comfort = 60 / Math.max(0.25, median(gaps));
    s.cadFull = clamp(comfort * WARMUP.comfort, lv.cadence * 0.8, lv.cadence * 1.15);
  }
  if (s.warm.ks.length > 0) s.kFull = clamp(0.85 * Math.max(...s.warm.ks), 0.55, lv.kFull);
  if (s.seated && s.warm.eff.length >= 30) s.effFull = clamp(1.3 * median(s.warm.eff), 0.35, 1.5);
  for (const l of s.lanes) { l.kHist = []; l.stepT = []; l.v = 0; l.dist = 0; l.sinceStep = 0; l.steps = 0; l.qSum = 0; l.qN = 0; l.ran = 0; }
  s.phase = 'ready';
  s.hc = 0;
  s.ticked = 99;
  out.push({ type: 'ready', heat: 1, cadence: s.cadFull });
}

/** Seconds into a heat, or the rest left, or the three-two-one: the number the picture and the plates show. */
export const clockOf = (s: SprintState): number => (s.phase === 'rest' ? s.restLeft : s.phase === 'ready' ? Math.max(0, READY_SEC - s.hc) : s.hc);

/** The next hurdle ahead of a lane (metres from the start), or null. */
export function nextHurdle(s: SprintState, i: number): number | null {
  const l = s.lanes[i];
  return l ? (s.hurdles[l.next] ?? null) : null;
}

/** How soon, in seconds at the lane's own pace, the next hurdle comes (Infinity when none or standing). */
export function hurdleIn(s: SprintState, i: number): number {
  const l = s.lanes[i] as LaneState | undefined;
  const h = nextHurdle(s, i);
  if (!l || h === null) return Infinity;
  return l.v > 0.5 ? (h - l.dist) / l.v : Infinity;
}

/** The share of the heat run, 0..1 (rival and runner). */
export const progressOf = (s: SprintState, d: number): number => clamp(d / s.dist, 0, 1);

/** Medal times of a heat in seconds (gold, silver, bronze) for the level and the distance. */
export const medalTimes = (s: SprintState): [number, number, number] => {
  const lv = levelFor(s);
  return [par(lv.gold100, s.dist), par(lv.silver100, s.dist), par(lv.bronze100, s.dist)];
};

export const totals = (s: SprintState): { score: number; steps: number; cleared: number; knocked: number; bestStreak: number; heats: number }[] =>
  s.lanes.map((l) => ({ score: l.score, steps: l.steps, cleared: l.results.reduce((n, r) => n + r.cleared, 0), knocked: l.results.reduce((n, r) => n + r.knocked, 0), bestStreak: l.bestStreak, heats: l.results.filter((r) => r.medal !== 'dnf').length }));
