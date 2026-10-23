// Flight template, Squat Flap (game-design.md card 1): a bird that flies on squats. Standing makes it sink, a deep
// squat makes it glide (it sinks at a third of the speed), and the rise out of a squat is the flap. Columns come in
// pairs with a gap; each one passed scores; a hit costs a feather.
//
// The simulation is pure and fixed-step: plain data in, plain data out, no clock, no DOM, no Math.random and no
// transcendental functions (their last digits differ between engines; a ghost or a duel must replay identically on
// every device). Its units do not depend on the screen: y is measured in play-area heights U (0 top, 1 bottom), x in
// U along the course, time in seconds. The view maps that to pixels.
//
// What the platform's movement library gives (core/moves/squatFlap.ts), and how it is used here:
//   flap events ('squat' rep, or 'armDirection' rep in the seated variant): value = power 0.6..1.2, q.depth = the
//   deepest hip drop of the squat in T. The depth the difficulty asks for is applied HERE (the detector's threshold is
//   one low floor for everybody): a shallower squat still flaps, with less lift, and the player is told why.
//   channels: drop (hip drop, T), glide (deep enough), armed (a flap is coming), up (rise speed).
import { clamp, median, newRound, phaseLeft, smoothstep, stepRound, wave, type RoundPlan, type RoundState } from '../kit-g1/index.ts';
import type { Rng } from '../../core/types/index.ts';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

/**
 * What a level asks. Card 1 has the gap going from 36 percent of the screen height down to 24: here U is the play area,
 * about three quarters of the screen, so 0.42 U down to 0.29 U is the same range. Tuned with the bots of testing/bot.ts
 * (a perfect player, a good one and a sloppy one); none of it is measured on real people yet.
 */
export interface Level {
  /** Course speed, U per second. */
  speed: number;
  /** Gap height, U. */
  gapH: number;
  /** Hip drop (T) of a full squat. A shallower one flaps weaker. The warm-up can only lower it. */
  need: number;
  /** Fall speed while standing, U per second. */
  fall: number;
  lives: number;
  /** Share of the columns that slide up and down, and by how much (U). */
  moving: number;
  moveAmp: number;
  /** Gusts: vertical acceleration amplitude, U per second squared. */
  wind: number;
  /** Largest change of the gap's height between two columns, U. */
  maxStep: number;
  /** 0: no sets, one long run that ends on the last feather (the classic game). */
  sets: number;
  /** Seconds of one squat cycle assumed until the warm-up measured the player's. */
  tempo: number;
}

export const LEVELS: Readonly<Record<Difficulty, Level>> = {
  easy: { speed: 0.26, gapH: 0.42, need: 0.35, fall: 0.09, lives: 3, moving: 0, moveAmp: 0, wind: 0, maxStep: 0.1, sets: 3, tempo: 2.4 },
  normal: { speed: 0.3, gapH: 0.35, need: 0.5, fall: 0.105, lives: 3, moving: 0, moveAmp: 0, wind: 0, maxStep: 0.14, sets: 3, tempo: 2.2 },
  hard: { speed: 0.36, gapH: 0.31, need: 0.55, fall: 0.125, lives: 3, moving: 0.3, moveAmp: 0.05, wind: 0.03, maxStep: 0.17, sets: 3, tempo: 2.1 },
  expert: { speed: 0.4, gapH: 0.29, need: 0.6, fall: 0.12, lives: 1, moving: 0.3, moveAmp: 0.05, wind: 0.03, maxStep: 0.17, sets: 0, tempo: 2 },
};

export const levelOf = (d: string): Level => LEVELS[(DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : 'normal'];

/** 60 seconds of flying, 25 of rest, three times (card 1). */
export const ROUND: RoundPlan = { sets: 3, setSec: 60, restSec: 25 };
export const planOf = (lv: Level): RoundPlan => (lv.sets > 0 ? { ...ROUND, sets: lv.sets } : { sets: 1, setSec: 1e9, restSec: 0 });

/** The shape of the world. */
export const WORLD = {
  /** The ground starts here (U); touching it costs a feather. */
  floor: 0.92,
  /** Column width, U. */
  pipeW: 0.13,
  /** The bird's hit box (half sizes, U). The picture is bigger, on purpose. */
  birdRx: 0.03,
  birdRy: 0.034,
  /** Where the bird sits along the screen, as a share of the play width. */
  birdAt: 0.27,
  /** Seconds of empty sky before the first column of a set. */
  leadIn: 2.6,
  /** Gap between the edge of a gap and the bird's hit box counted as a clean centre pass: within this share of the gap height. */
  centre: 0.17,
} as const;

/** Squat cycle to column spacing: a column every 1.3 cycles (card 1). */
export const SPACING_PER_CYCLE = 1.3;
export const WARMUP = { flaps: 3, maxSec: 25, minTempo: 1.4, maxTempo: 3.8 } as const;

const FLAP = {
  /** Upward speed of a full flap, U per second (the lift is v squared over twice the deceleration). */
  v: 1.05,
  /** Deceleration while rising and acceleration while falling, U per second squared. */
  gUp: 2.6,
  /** How fast a glide takes the fall away, U per second squared. */
  brake: 4,
  /** The share of the fall speed that is left in a full glide (card 1: 35 percent). */
  glideShare: 0.3,
  /** Hip drop where the sinking starts to slow (the stand threshold of the detector is 0.12). */
  slowFrom: 0.12,
} as const;

export const INVULNERABLE_SEC = 1.5;
/** The pause between the warm-up and the first set. */
export const READY_SEC = 2.4;

export { wave };

// ───────── the course ─────────

export interface CourseEntry { y: number; amp: number; phase: number }

/** The columns of a whole run, made once at the start from the 'course' stream: three draws per column, always. */
export function makeCourse(rng: Rng, lv: Level, count = 360): CourseEntry[] {
  const lo = lv.gapH / 2 + 0.07 + lv.moveAmp;
  const hi = WORLD.floor - lv.gapH / 2 - 0.07 - lv.moveAmp;
  const out: CourseEntry[] = [];
  let c = 0.5;
  for (let i = 0; i < count; i++) {
    const d = (rng() * 2 - 1) * lv.maxStep;
    const slides = rng() < lv.moving;
    const phase = rng();
    c = clamp(c + d, lo, hi);
    out.push({ y: i < 2 ? 0.5 : c, amp: slides && i >= 2 ? lv.moveAmp : 0, phase });
  }
  return out;
}

export interface Pipe { x: number; y: number; h: number; amp: number; phase: number }

/** The gap centre of a column at active time `t`. */
export const gapCentre = (p: Pipe, t: number): number => p.y + p.amp * wave(p.phase + t / 6);

// ───────── state ─────────

export type HintCode = 'hips_not_low' | 'too_slow' | 'hips_not_up' | 'move_more' | 'too_fast';

export interface LaneState {
  y: number;
  vy: number;
  lives: number;
  invul: number;
  score: number;
  passes: number;
  centres: number;
  hits: number;
  flaps: number;
  streak: number;
  bestStreak: number;
  /** Index (in the placed columns) of the next column to pass. */
  next: number;
  /** The column the bird is inside right now, whether it was hit there, whether it crossed the middle of the gap, and how. */
  inside: number;
  insideHit: boolean;
  crossed: boolean;
  insideCentre: boolean;
  out: boolean;
  /** 0..1 how much of a glide the body is giving now (smoothed, for the picture). */
  glide: number;
  /** Seconds since the last flap (for the wing animation). */
  sinceFlap: number;
  // Why things went wrong:
  maxDrop: number;
  armed: boolean;
  /** Time (run clock) the player rose too slowly for a flap, or -1000. */
  slowAt: number;
  heldSince: number;
  lastDepth: number;
  hint: { code: HintCode; at: number } | null;
}

export type Phase = 'warmup' | 'play' | 'rest' | 'over' | 'complete';

export interface FlightState {
  v: 1;
  difficulty: Difficulty;
  players: 1 | 2;
  seated: boolean;
  /** Run clock: all seconds since the start. */
  t: number;
  /** Flying seconds (the course moves only then; sliding columns and gusts follow it). */
  active: number;
  /** Distance travelled along the course, U. */
  scroll: number;
  phase: Phase;
  round: RoundState;
  /** Seconds left of the get-ready pause between the warm-up and the first set (the bird floats back to the middle). */
  ready: number;
  warm: { t: number; flapTimes: number[]; depths: number[] };
  /** Seconds of one squat cycle, measured by the warm-up (or the level's own). */
  tempo: number;
  /** The depth asked, after the warm-up. */
  need: number;
  spacing: number;
  course: CourseEntry[];
  cursor: number;
  pipes: Pipe[];
  lanes: LaneState[];
}

export interface FlapIn { power: number; depth: number | undefined }

/** One lane's input for one step, as the game turns the movement channels and events into it. */
export interface LaneIn {
  flaps: FlapIn[];
  /** Hip drop, T (0 when the camera is not measuring it, e.g. keys or arms). */
  drop: number;
  /** A glide is on (a squat held deep, arms level, a key held). */
  glide: boolean;
  /** A flap is coming (the rise has begun). */
  armed: boolean;
}

export const IDLE: LaneIn = { flaps: [], drop: 0, glide: false, armed: false };

export type FlightEvent =
  | { type: 'flap'; lane: number; power: number; scale: number; y: number }
  | { type: 'glide'; lane: number; on: boolean }
  | { type: 'pass'; lane: number; pts: number; centre: boolean; streak: number; mult: number; y: number }
  | { type: 'hit'; lane: number; what: 'pipe' | 'floor'; reason: HintCode; lives: number; y: number }
  | { type: 'hint'; lane: number; code: HintCode }
  | { type: 'warmup'; flaps: number }
  | { type: 'ready'; tempo: number; need: number }
  | { type: 'start'; set: number; tempo: number; need: number }
  | { type: 'rest'; set: number }
  | { type: 'out'; lane: number }
  | { type: 'over' }
  | { type: 'complete' };

const newLane = (lv: Level): LaneState => ({
  y: 0.5, vy: 0, lives: lv.lives, invul: 0, score: 0, passes: 0, centres: 0, hits: 0, flaps: 0, streak: 0, bestStreak: 0,
  next: 0, inside: -1, insideHit: false, crossed: false, insideCentre: false, out: false, glide: 0, sinceFlap: 9,
  maxDrop: 0, armed: false, slowAt: -1000, heldSince: -1, lastDepth: 0, hint: null,
});

export interface FlightOptions {
  difficulty: string;
  players: 1 | 2;
  seated: boolean;
  /** The 'course' stream. */
  rng: Rng;
}

export function createFlight(o: FlightOptions): FlightState {
  const difficulty = ((DIFFICULTIES as readonly string[]).includes(o.difficulty) ? o.difficulty : 'normal') as Difficulty;
  const lv = LEVELS[difficulty];
  const s: FlightState = {
    v: 1, difficulty, players: o.players, seated: o.seated,
    t: 0, active: 0, scroll: 0, phase: o.players === 2 ? 'play' : 'warmup', round: newRound(), ready: 0,
    warm: { t: 0, flapTimes: [], depths: [] },
    tempo: lv.tempo, need: lv.need, spacing: lv.speed * SPACING_PER_CYCLE * lv.tempo,
    course: makeCourse(o.rng, lv), cursor: 0, pipes: [],
    lanes: Array.from({ length: o.players }, () => newLane(lv)),
  };
  if (s.phase === 'play') placeSet(s);
  return s;
}

export const levelFor = (s: FlightState): Level => LEVELS[s.difficulty];

/** The columns of the set that is about to begin, starting `leadIn` seconds ahead. */
function placeSet(s: FlightState): void {
  const lv = levelFor(s);
  const plan = planOf(lv);
  const span = Math.min(plan.setSec, 600);
  const n = Math.ceil((span * lv.speed) / s.spacing) + 3;
  s.pipes = [];
  for (let i = 0; i < n; i++) {
    const c = s.course[Math.min(s.cursor + i, s.course.length - 1)] as CourseEntry;
    // The first two columns of a run are wider apart in height tolerance: a kinder start.
    const easing = s.cursor + i < 2 ? 1.25 : 1;
    s.pipes.push({ x: s.scroll + WORLD.leadIn * lv.speed + i * s.spacing, y: c.y, h: lv.gapH * easing, amp: c.amp, phase: c.phase });
  }
  s.cursor += n;
  for (const l of s.lanes) { l.next = 0; l.inside = -1; l.insideHit = false; l.crossed = false; l.insideCentre = false; }
}

// ───────── the step ─────────

/** How much of a glide the body gives: a deep squat, a glide flag, or a rise in progress. 0..1. */
export function hoverOf(inp: LaneIn, need: number): number {
  if (inp.glide || inp.armed) return 1;
  return smoothstep((inp.drop - FLAP.slowFrom) / Math.max(0.1, need - FLAP.slowFrom));
}

function hint(s: FlightState, i: number, code: HintCode, out: FlightEvent[]): void {
  const l = s.lanes[i] as LaneState;
  if (l.hint && l.hint.code === code && s.t - l.hint.at < 1.2) return;
  l.hint = { code, at: s.t };
  out.push({ type: 'hint', lane: i, code });
}

function flapLane(s: FlightState, i: number, f: FlapIn, out: FlightEvent[]): void {
  const l = s.lanes[i] as LaneState;
  const power = clamp(f.power, 0.6, 1.2);
  // Depth: a squat as deep as asked gives the whole lift; down to half of it still gives three quarters.
  const ratio = f.depth === undefined ? 1 : clamp(f.depth / s.need, 0.5, 1);
  const scale = (0.7 + 0.3 * power) * (0.55 + 0.45 * ratio);
  l.vy = -FLAP.v * scale;
  l.flaps++;
  l.sinceFlap = 0;
  l.maxDrop = 0;
  l.slowAt = -1000;
  l.lastDepth = f.depth ?? 0;
  l.heldSince = -1;
  out.push({ type: 'flap', lane: i, power, scale, y: l.y });
  if (f.depth !== undefined && f.depth < s.need * 0.8) hint(s, i, 'hips_not_low', out);
}

/** Why a hit happened, in the body's terms. */
function reasonOf(s: FlightState, l: LaneState, what: 'high' | 'low'): HintCode {
  if (what === 'high') return 'too_fast';
  if (s.t - l.slowAt < 2.5) return 'too_slow';
  const depth = Math.max(l.maxDrop, l.lastDepth);
  if (depth >= 0.12 && depth < s.need * 0.85) return 'hips_not_low';
  if (l.heldSince >= 0 && s.t - l.heldSince > 1.4) return 'hips_not_up';
  return 'move_more';
}

function physics(s: FlightState, i: number, inp: LaneIn, dt: number, soft: boolean, out: FlightEvent[]): void {
  const lv = levelFor(s);
  const l = s.lanes[i] as LaneState;
  const hover = hoverOf(inp, s.need);
  const wasGliding = l.glide > 0.5;
  l.glide += (hover - l.glide) * Math.min(1, dt * 10);
  if (wasGliding !== l.glide > 0.5) out.push({ type: 'glide', lane: i, on: l.glide > 0.5 });

  // Reasons: the deepest squat since the last flap, a rise that did not become a flap, a squat that is not left.
  l.maxDrop = Math.max(l.maxDrop, inp.drop);
  if (l.armed && !inp.armed && inp.flaps.length === 0) l.slowAt = s.t;
  l.armed = inp.armed;
  if (inp.glide || inp.armed) { if (l.heldSince < 0) l.heldSince = s.t; } else l.heldSince = -1;

  for (const f of inp.flaps) flapLane(s, i, f, out);
  if (l.slowAt === s.t) hint(s, i, 'too_slow', out);

  // Vertical motion: the speed relaxes toward the sinking speed of the moment.
  const target = lv.fall * (1 - (1 - FLAP.glideShare) * hover);
  if (l.vy < target) l.vy = Math.min(target, l.vy + FLAP.gUp * dt);
  else l.vy = Math.max(target, l.vy - FLAP.brake * dt);
  if (lv.wind > 0) l.vy += lv.wind * wave(s.active / 7 + i * 0.37) * dt;
  l.y += l.vy * dt;
  l.sinceFlap += dt;
  l.invul = Math.max(0, l.invul - dt);

  const ceil = WORLD.birdRy;
  if (l.y < ceil) { l.y = ceil; if (l.vy < 0) l.vy = 0; }
  const ground = WORLD.floor - WORLD.birdRy;
  if (l.y > ground) {
    l.y = ground;
    if (soft) { l.vy = Math.min(l.vy, 0); }
    else if (l.invul <= 0) lose(s, i, 'floor', 'low', out);
    else l.vy = Math.min(l.vy, 0);
  }
}

function lose(s: FlightState, i: number, what: 'pipe' | 'floor', side: 'high' | 'low', out: FlightEvent[]): void {
  const l = s.lanes[i] as LaneState;
  l.lives--;
  l.hits++;
  l.streak = 0;
  l.invul = INVULNERABLE_SEC;
  const reason = reasonOf(s, l, side);
  l.hint = { code: reason, at: s.t };
  if (what === 'floor') { l.vy = -0.62; l.y = Math.min(l.y, WORLD.floor - WORLD.birdRy - 0.01); }
  else l.vy = side === 'low' ? -0.3 : 0.2;
  out.push({ type: 'hit', lane: i, what, reason, lives: Math.max(0, l.lives), y: l.y });
  if (l.lives <= 0) { l.out = true; out.push({ type: 'out', lane: i }); }
}

const multOf = (streak: number): number => 1 + Math.min(2, Math.floor(streak / 5));

function columns(s: FlightState, i: number, out: FlightEvent[]): void {
  const l = s.lanes[i] as LaneState;
  const half = WORLD.pipeW / 2 + WORLD.birdRx;
  const x = s.scroll;
  // The column the bird is inside: collide on the way in and while inside.
  for (let k = l.next; k < s.pipes.length; k++) {
    const p = s.pipes[k] as Pipe;
    if (p.x - half > x) break;
    const c = gapCentre(p, s.active);
    const inside = Math.abs(x - p.x) < half;
    if (inside) {
      if (l.inside !== k) { l.inside = k; l.insideHit = false; l.crossed = false; l.insideCentre = false; }
      const top = c - p.h / 2, bottom = c + p.h / 2;
      if (!l.crossed && x >= p.x) { l.crossed = true; l.insideCentre = Math.abs(l.y - c) <= p.h * WORLD.centre; }
      if (!l.insideHit && (l.y - WORLD.birdRy < top || l.y + WORLD.birdRy > bottom)) {
        // Inside the wall: no pass, and while the feather's protection lasts no feather is lost either.
        l.insideHit = true;
        if (l.invul <= 0) lose(s, i, 'pipe', l.y < c ? 'high' : 'low', out);
      }
    } else if (x - p.x >= half) {
      // Past it. A pass counts when the bird was never hit inside this column.
      if (l.inside === k && !l.insideHit) {
        l.passes++;
        const centre = l.insideCentre;
        if (centre) l.centres++;
        l.streak++;
        l.bestStreak = Math.max(l.bestStreak, l.streak);
        const mult = multOf(l.streak);
        const pts = (1 + (centre ? 1 : 0)) * mult;
        l.score += pts;
        out.push({ type: 'pass', lane: i, pts, centre, streak: l.streak, mult, y: l.y });
      }
      l.inside = -1;
      l.insideHit = false;
      l.crossed = false;
      l.insideCentre = false;
      l.next = k + 1;
    }
  }
}

/** Advances the run by one step. `ins` has one entry per lane. Returns what happened. */
export function stepFlight(s: FlightState, dt: number, ins: readonly LaneIn[]): FlightEvent[] {
  const out: FlightEvent[] = [];
  if (s.phase === 'over' || s.phase === 'complete') return out;
  const lv = levelFor(s);
  s.t += dt;

  if (s.phase === 'warmup') {
    s.warm.t += dt;
    for (let i = 0; i < s.lanes.length; i++) {
      const inp = ins[i] ?? IDLE;
      const before = (s.lanes[i] as LaneState).flaps;
      physics(s, i, inp, dt, true, out);
      if ((s.lanes[i] as LaneState).flaps > before) {
        for (const f of inp.flaps) { s.warm.flapTimes.push(s.t); if (f.depth !== undefined) s.warm.depths.push(f.depth); }
        out.push({ type: 'warmup', flaps: s.warm.flapTimes.length });
      }
    }
    if (s.warm.flapTimes.length >= WARMUP.flaps || s.warm.t >= WARMUP.maxSec) endWarmup(s, out);
    return out;
  }

  if (s.phase === 'rest') {
    for (let i = 0; i < s.lanes.length; i++) {
      const l = s.lanes[i] as LaneState;
      // The bird drifts back to the middle and floats; the legs rest.
      l.y += (0.5 - l.y) * Math.min(1, dt * 2.5);
      l.vy = 0;
      l.glide += (0 - l.glide) * Math.min(1, dt * 6);
      l.invul = 0;
    }
    if (s.ready > 0) {
      s.ready -= dt;
      if (s.ready <= 1e-9) { s.ready = 0; s.phase = 'play'; s.round = newRound(); placeSet(s); out.push({ type: 'start', set: 1, tempo: s.tempo, need: s.need }); }
      return out;
    }
    const ch = stepRound(planOf(lv), s.round, dt);
    if (ch === 'set') { placeSet(s); s.phase = 'play'; out.push({ type: 'start', set: s.round.set, tempo: s.tempo, need: s.need }); }
    return out;
  }

  // play
  s.active += dt;
  s.scroll += lv.speed * dt;
  for (let i = 0; i < s.lanes.length; i++) {
    const l = s.lanes[i] as LaneState;
    if (l.out) { l.y = Math.min(WORLD.floor - WORLD.birdRy, l.y + 0.5 * dt); l.glide = 0; continue; }
    physics(s, i, ins[i] ?? IDLE, dt, false, out);
    if (!l.out) columns(s, i, out);
  }
  if (s.lanes.every((l) => l.out)) { s.phase = 'over'; out.push({ type: 'over' }); return out; }
  const ch = stepRound(planOf(lv), s.round, dt);
  if (ch === 'rest') {
    s.phase = 'rest';
    s.pipes = [];
    out.push({ type: 'rest', set: s.round.set });
  } else if (ch === 'done') {
    s.phase = 'complete';
    out.push({ type: 'complete' });
  }
  return out;
}

function endWarmup(s: FlightState, out: FlightEvent[]): void {
  const lv = levelFor(s);
  const times = s.warm.flapTimes;
  if (times.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push((times[i] as number) - (times[i - 1] as number));
    s.tempo = clamp(median(gaps), WARMUP.minTempo, WARMUP.maxTempo);
  } else s.tempo = lv.tempo;
  // The depth asked is never more than 60 percent of the deepest squat of the warm-up (card 1), and never under the floor.
  if (s.warm.depths.length > 0) s.need = clamp(Math.min(lv.need, 0.6 * Math.max(...s.warm.depths)), 0.3, lv.need);
  s.spacing = lv.speed * SPACING_PER_CYCLE * s.tempo;
  s.phase = 'rest';
  s.ready = READY_SEC;
  out.push({ type: 'ready', tempo: s.tempo, need: s.need });
}

/** The next column a lane has to pass (or null), for bots, the coach and the view. */
export function nextPipe(s: FlightState, i: number): Pipe | null {
  const l = s.lanes[i] as LaneState | undefined;
  return l ? (s.pipes[l.next] ?? null) : null;
}

/** Seconds left in the set or the rest. */
export const timeLeft = (s: FlightState): number => phaseLeft(planOf(levelFor(s)), s.round);

/** The points of the whole run, per lane. */
export const totals = (s: FlightState): { score: number; passes: number; hits: number; flaps: number; bestStreak: number }[] =>
  s.lanes.map((l) => ({ score: l.score, passes: l.passes, hits: l.hits, flaps: l.flaps, bestStreak: l.bestStreak }));
