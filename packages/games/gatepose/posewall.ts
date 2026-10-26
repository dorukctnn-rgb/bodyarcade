// Pose Wall (card 34, template F gate and pose): a wall with a person-shaped hole flies toward you; make the shape before it
// reaches you, hold it, and pass through.
//
// The run (game-design.md card 34): three sets of 60 seconds with 15 seconds of rest between them (210 s), then a short outro.
// A wall asks for one shape (the pose library of core/moves, poses.ts, and a few upper body shapes of this game, pw-poses.ts),
// is first seen a few seconds before it arrives, and is passed when the body has made the shape, every limb the shape defines
// within the tolerance (30 degrees easy, 22 normal, 15 hard), for 0.3 s within the last 0.8 s before it arrives. The judging is
// core/moves PoseWallJudge, from the channels of the poseMatch detector (limb.*, pose.t, pose.arms, pose.legs, drop). A wall that
// was not passed says why in the words of the judge's explanation: a named arm or leg off the shape, hold it longer, hands or
// knees out of view, hips not low enough.
//
// The camera runs at its own pace and on its own clock (pose.t). A wall's arrival is put on that clock from the latest pose frame
// (the way the target games do it), and the verdict comes 0.1 s after the arrival, because a picture is about that old when it
// reaches the game: the frames up to the arrival have then all been judged. A pose frame is judged once.
//
// Keys and swipes have no limbs to read: they step through the shapes the level can ask for (and "rest", arms down). The avatar
// then makes the picked shape exactly and the same judge reads it, so a run without a camera is the same game with another way
// to choose the shape.
//
// Series: on the harder levels two or three walls follow each other 2.4 s apart (the next shape has to be found in a hurry).
// Two players on one camera (mode local2): both lanes get the same wall at the same moment, each judged on their own body (two
// people, one shape); a wall both pass is a team pass. Pure and fixed-step: plain-data state, seeded plan, snapshot and restore.
import type { RunSummary } from '../../core/types/index.ts';
import { angleDiff, type Miss } from '../../core/moves/kit.ts';
import { LIMBS, PoseWallJudge, type LimbAngles, type PoseWall } from '../../core/moves/poseMatch.ts';
import { needsArms, needsLegs, type PoseTarget } from '../../core/moves/poses.ts';
import type { FrameIn, PlayerIn } from '../_shared/frame.ts';
import type { HostSim, Phase, SimEvent, SimSetup } from '../_shared/host.ts';
import { dumpOwn, loadOwn } from '../_shared/judgesnap.ts';
import { STAND } from '../_shared/mover.ts';
import type { MissNote } from '../_shared/reasons.ts';
import { clamp, copyData, msOf, round, shuffled, stepsOf } from '../_shared/util.ts';
import { difficultyOf, logOf, type Difficulty, type LogEntry } from '../strength/kit.ts';
import { makeSegments, type GpSegment, type GpTiming } from './plan.ts';
import { poolFor, shapeOf } from './pw-poses.ts';

// ───────── the plan ─────────

/** Three sets of 60 s and two rests of 15 s are the 210 s of the manifest; the outro comes after. */
export const PW_TIMING: GpTiming = { sets: 3, workS: 60, restS: 15, finaleS: 4 };

export interface PwLevel {
  /** Seconds from the first sight of a wall to its arrival. */
  approachS: number;
  /** Mean seconds between walls (or between series). */
  gapS: number;
  /** The chance that a wall starts a series of two or three. */
  seriesChance: number;
  /** Of the series, the share that has three walls. */
  tripleShare: number;
  /** The tolerance of each limb, degrees (card 34: 30 easy, 22 normal, 15 hard). */
  tol: number;
}

/** Unmeasured (game-design.md "Dürüstlük notu"): the recording day sets the speeds and the tolerances. */
export const PW_LEVELS: Readonly<Record<Difficulty, PwLevel>> = {
  easy: { approachS: 4.4, gapS: 5.2, seriesChance: 0, tripleShare: 0, tol: 30 },
  normal: { approachS: 3.8, gapS: 4.5, seriesChance: 0.15, tripleShare: 0.25, tol: 22 },
  hard: { approachS: 3.3, gapS: 4.0, seriesChance: 0.25, tripleShare: 0.3, tol: 15 },
  expert: { approachS: 2.9, gapS: 3.6, seriesChance: 0.35, tripleShare: 0.4, tol: 15 },
};

/** Card 34: the shape has to be held for 0.3 s within the 0.8 s before the wall arrives. */
export const HOLD_MS = 300;
export const WINDOW_MS = 800;
/** The seconds between the walls of a series. */
export const SERIES_GAP_S = 2.4;
/** The verdict comes this many steps after the arrival (see the head of the file). */
export const LAG_K = 6;
const LAG_MS = msOf(LAG_K);
const PERFECT = 0.85;
const BASE_POINTS = 60;
const FIT_POINTS = 60;
export const TEAM_BONUS = 25;
export const SERIES_BONUS = 30;
const ACTIVE_STEPS = 150;
/** A limb that has moved this many degrees since the last look counts as movement. */
const MOVE_DEG = 14;
/** Variants move less than the standing wall (the seated MET is the table's upper body 3.0 of 4.0). */
export const PW_VARIANT_MET: Readonly<Record<'standing' | 'seated', number>> = { standing: 1, seated: 0.75 };

/** The names the keys and swipes step through: 'rest' (arms down) and the shapes the level can ask for. */
export function pickShapes(level: Difficulty, seated: boolean): string[] {
  return ['rest', ...poolFor(level, seated)];
}

export interface PwWall {
  id: number;
  lane: 0 | 1;
  arriveK: number;
  /** The first step it is judged. */
  fromK: number;
  /** The name of the shape in the library (pw-poses.ts). */
  pose: string;
  /** The place in a series (1 to `of`), or 0 for a wall on its own. */
  series: number;
  of: number;
}

export interface PwPlan {
  segments: GpSegment[];
  endK: number;
  walls: PwWall[];
  approachK: number;
  tol: number;
  timing: GpTiming;
  players: 1 | 2;
  seated: boolean;
  level: Difficulty;
}

export function makePwPlan(difficulty: Difficulty, seated: boolean, timing: GpTiming, rng: () => number, players: 1 | 2): PwPlan {
  const level = PW_LEVELS[difficulty];
  const { segments, endK } = makeSegments(timing);
  const approachK = stepsOf(level.approachS);
  const gapK = stepsOf(level.gapS);
  const seriesK = stepsOf(SERIES_GAP_S);
  const windowK = stepsOf(WINDOW_MS / 1000);
  const pool = poolFor(difficulty, seated);
  let bag: string[] = [];
  let lastName = '';
  /** Every shape of the level once, in a new order, before any comes again; the same shape never twice in a row. */
  const draw = (): string => {
    if (!bag.length) {
      bag = shuffled(rng, pool);
      if (bag.length > 1 && bag[0] === lastName) { const first = bag[0] as string; bag[0] = bag[bag.length - 1] as string; bag[bag.length - 1] = first; }
    }
    lastName = bag.shift() as string;
    return lastName;
  };
  const walls: PwWall[] = [];
  const lastK: number[] = [-1000, -1000];
  const add = (arriveK: number, series: number, of: number, pose: string): void => {
    for (let lane = 0; lane < players; lane++) {
      const l = lane as 0 | 1;
      walls.push({ id: walls.length, lane: l, arriveK, fromK: Math.max(arriveK - windowK - 6, (lastK[l] ?? -1000) + LAG_K + 1, 0), pose, series, of });
      lastK[l] = arriveK;
    }
  };
  for (const seg of segments) {
    if (seg.kind !== 'work') continue;
    let k = seg.startK + Math.round(approachK * 0.95);
    const end = seg.endK - stepsOf(0.9);
    while (k <= end) {
      const want = rng() < level.seriesChance ? (rng() < level.tripleShare ? 3 : 2) : 1;
      let n = 1;
      while (n < want && k + n * seriesK <= end) n++;
      for (let j = 0; j < n; j++) add(k + j * seriesK, n > 1 ? j + 1 : 0, n > 1 ? n : 1, draw());
      k += (n - 1) * seriesK + Math.round(gapK * (0.9 + 0.2 * rng()));
    }
  }
  return { segments, endK, walls, approachK, tol: level.tol, timing, players, seated, level: difficulty };
}

// ───────── state ─────────

/** 0 pending, 1 passed, 2 missed, 3 skipped (the player was not seen: nothing is won or lost). */
export type WallDone = 0 | 1 | 2 | 3;

export interface PwWallState {
  done: WallDone;
  /** The shape has been held long enough; the wall is passed when it arrives. */
  locked: boolean;
  /** The mean fit during the hold, 0..1. */
  fit: number;
}

export interface PwPlayer {
  score: number;
  passed: number;
  perfect: number;
  missed: number;
  streak: number;
  bestStreak: number;
  /** The ten limb directions the avatar shows (the detector's, or the picked shape's). */
  limbs: LimbAngles;
  /** How well the body fits the next wall now, 0..1. */
  live: number;
  seen: boolean;
  /** Hip drop now, in torso lengths (the squat shapes). */
  drop: number;
  /** The last pose frame time seen (the camera's clock) and the step it came in. */
  poseT: number | null;
  poseK: number;
  /** Keys and swipes: the shape picked (0 = rest) and which of the three inputs were down at the last step. */
  pick: number;
  nextHeld: boolean;
  prevHeld: boolean;
  restHeld: boolean;
  /** The limbs when the player last moved: a limb that moves from here counts as movement. */
  ref: LimbAngles;
  lastActK: number;
  activeSteps: number;
  fitSum: number;
  judged: number;
  miss: (MissNote & { k: number }) | null;
  lastMissK: number;
  /** The last wall passed: its fit, for "Fit 92 percent" on the strip. */
  note: { fit: number; k: number } | null;
  /** The shape of a series that is still all passed (the bonus), by lane. */
  seriesOk: boolean;
}

interface PwState {
  v: 1;
  k: number;
  phase: Phase;
  plan: PwPlan;
  seg: number;
  players: PwPlayer[];
  ws: PwWallState[];
  judges: unknown[];
  log: LogEntry[];
  teamPasses: number;
  /** The step of the last team pass (for the strip: "Both through"). */
  teamAt: number;
  seriesPassed: number;
}

export interface PwOptions {
  setup: Pick<SimSetup, 'start' | 'flags' | 'players' | 'audioLatencyMs' | 'rng'>;
  met: number;
  timing?: Partial<GpTiming>;
}

const standLimbs = (): LimbAngles => ({ ...STAND }) as LimbAngles;

const newPlayer = (): PwPlayer => ({
  score: 0, passed: 0, perfect: 0, missed: 0, streak: 0, bestStreak: 0, limbs: standLimbs(), live: 0, seen: false, drop: 0, poseT: null, poseK: 0,
  pick: 0, nextHeld: false, prevHeld: false, restHeld: false, ref: standLimbs(), lastActK: -100000, activeSteps: 0, fitSum: 0, judged: 0, miss: null, lastMissK: -100000,
  note: null, seriesOk: true,
});

/**
 * How close a body is to a wall's shape, 0..1, for the glow of the hole: 1 when every limb is inside the tolerance, falling to 0 at
 * three tolerances out. Only the limbs that the shape asks something of count (its legs and trunk, when they are just standing,
 * are met by standing still); a limb that is off elsewhere keeps the glow below 0.85, so a full glow is a real match.
 */
export function liveFit(limbs: Readonly<LimbAngles>, shape: PoseTarget, tol: number): number {
  let sum = 0, n = 0, sumAll = 0, nAll = 0, strayed = false;
  for (const l of LIMBS) {
    const want = shape.limbs[l];
    if (want === undefined) continue;
    const e = angleDiff(limbs[l], want);
    const q = e <= tol ? 1 : clamp(1 - (e - tol) / (2 * tol), 0, 1);
    sumAll += q;
    nAll++;
    if (angleDiff(want, STAND[l]) > tol) { sum += q; n++; } else if (e > tol) strayed = true;
  }
  const live = n ? sum / n : nAll ? sumAll / nAll : 0;
  return strayed ? Math.min(live, 0.85) : live;
}

/**
 * The judge says "limb off" for the best frame it saw. When that frame was inside the tolerance the shape was made, but not for long
 * enough (one picture of it is not a hold): that is what the player has to change, so that is what is said.
 */
export function reasonFor(why: Miss): Miss {
  if (why.code === 'limb_off' && why.got !== undefined && why.need !== undefined && why.got <= why.need) return { code: 'held_too_short', got: 0, need: HOLD_MS };
  return why;
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** The legs of a seated player are not under the hips: the avatar keeps the standing legs, and no wall judges them. */
const SEATED_LEGS = ['thighL', 'thighR', 'shinL', 'shinR'] as const;

// ───────── the simulation ─────────

export class PoseWallSim implements HostSim {
  private s: PwState;
  private judges: PoseWallJudge[];
  private readonly seated: boolean;
  private readonly met: number;
  private readonly count: 1 | 2;
  private readonly names: string[];
  private readonly shapes: (PoseTarget | null)[];
  private readonly cache = new Map<string, PoseTarget>();
  private lanes: PwWall[][] = [[], []];
  private verdicts = new Map<number, PwWall[]>();
  private cursor = [0, 0];

  constructor(o: PwOptions) {
    const { start, rng } = o.setup;
    this.seated = start.seated;
    this.met = o.met;
    this.count = o.setup.players;
    const level = difficultyOf(start.difficulty);
    const plan = makePwPlan(level, this.seated, { ...PW_TIMING, ...o.timing }, rng, this.count);
    this.names = pickShapes(level, this.seated);
    this.shapes = this.names.map((n, i) => (i === 0 ? null : this.shape(n)));
    this.s = {
      v: 1, k: 0, phase: 'running', plan, seg: 0,
      players: Array.from({ length: this.count }, newPlayer), ws: plan.walls.map(() => ({ done: 0, locked: false, fit: 0 })),
      judges: [], log: [], teamPasses: 0, teamAt: -100000, seriesPassed: 0,
    };
    this.judges = Array.from({ length: this.count }, () => new PoseWallJudge());
    this.index();
  }

  private index(): void {
    this.lanes = [[], []];
    this.verdicts = new Map();
    this.cursor = [0, 0];
    for (const w of this.s.plan.walls) {
      (this.lanes[w.lane] as PwWall[]).push(w);
      const at = w.arriveK + LAG_K;
      const list = this.verdicts.get(at);
      if (list) list.push(w); else this.verdicts.set(at, [w]);
    }
  }

  // ───── what the view, the HUD and the tests read ─────

  get phase(): Phase { return this.s.phase; }
  get k(): number { return this.s.k; }
  get plan(): Readonly<PwPlan> { return this.s.plan; }
  get playerCount(): 1 | 2 { return this.count; }
  get playerStates(): readonly Readonly<PwPlayer>[] { return this.s.players; }
  get wallStates(): readonly Readonly<PwWallState>[] { return this.s.ws; }
  get segment(): Readonly<GpSegment> { return this.s.plan.segments[Math.min(this.s.seg, this.s.plan.segments.length - 1)] as GpSegment; }
  get variant(): 'standing' | 'seated' { return this.seated ? 'seated' : 'standing'; }
  get leftS(): number { return Math.max(0, (this.segment.endK - this.s.k) / 60); }
  get teamPasses(): number { return this.s.teamPasses; }
  get teamAt(): number { return this.s.teamAt; }
  /** The last seconds of a rest: "Ready". */
  get gettingReady(): boolean { const seg = this.segment; return seg.kind === 'rest' && seg.endK - this.s.k <= 180; }
  /** The names the keys and swipes step through, 'rest' first. */
  get pickNames(): readonly string[] { return this.names; }
  wallsOf(lane: 0 | 1): readonly PwWall[] { return this.lanes[lane] ?? []; }

  /** The shape of a wall, as the level asks for it (a seated wall has no legs). */
  shape(name: string): PoseTarget {
    let p = this.cache.get(name);
    if (!p) { p = shapeOf(name, this.seated); this.cache.set(name, p); }
    return p;
  }

  /** The first wall of a lane that has not been decided yet (its verdict is still to come). */
  nextWall(lane: 0 | 1): PwWall | null {
    const list = this.lanes[lane] ?? [];
    let c = this.cursor[lane] ?? 0;
    while (c < list.length) {
      const w = list[c] as PwWall;
      if ((this.s.ws[w.id] as PwWallState).done === 0 && w.arriveK + LAG_K >= this.s.k) break;
      c++;
    }
    this.cursor[lane] = c;
    return list[c] ?? null;
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
    const camera = f.source === 'pose' || f.source === 'trace';

    const chs: (Readonly<Record<string, number>> | null)[] = [];
    for (let i = 0; i < this.count; i++) chs.push(this.read(i, f.players[i], k, camera));

    if (seg.kind !== 'work') for (const p of s.players) p.live = 0;
    if (seg.kind === 'work') {
      for (let i = 0; i < this.count; i++) {
        const ch = chs[i];
        const p = s.players[i] as PwPlayer;
        if (p.seen && k - p.lastActK <= ACTIVE_STEPS) p.activeSteps++;
        if (!ch || p.poseT === null) { p.live = 0; continue; }
        const live: PoseWall[] = [];
        for (const w of this.lanes[i] as PwWall[]) {
          if (w.fromK > k || w.arriveK + LAG_K < k) continue;
          if ((s.ws[w.id] as PwWallState).done !== 0) continue;
          live.push(this.judged(w, p));
        }
        const next = this.nextWall(i as 0 | 1);
        p.live = next ? this.fitOf(p, next) : 0;
        if (!live.length) continue;
        for (const j of (this.judges[i] as PoseWallJudge).update(ch, live)) {
          const ws = s.ws[j.id] as PwWallState;
          if (ws.locked) continue;
          ws.locked = true;
          ws.fit = j.similarity;
          p.lastActK = k;
          out.push({ type: 'lock', t, id: j.id, lane: i, fit: round(j.similarity, 3) });
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

  /** The wall as the judge wants it: on the player's own pose clock. */
  private judged(w: PwWall, p: PwPlayer): PoseWall {
    return {
      id: w.id, pose: this.shape(w.pose), tol: this.s.plan.tol, holdMs: HOLD_MS, windowMs: WINDOW_MS,
      dueAt: (p.poseT as number) + (msOf(w.arriveK) + LAG_MS - msOf(p.poseK)),
    };
  }

  /** How well the avatar fits a wall's shape now (0 when a part the shape needs is out of view). */
  private fitOf(p: PwPlayer, w: PwWall): number {
    return liveFit(p.limbs, this.shape(w.pose), this.s.plan.tol);
  }

  /** One player's input for this step: the detector's channels, or the shape the keys and swipes have picked. */
  private read(i: number, inp: PlayerIn | undefined, k: number, camera: boolean): Readonly<Record<string, number>> | null {
    const p = this.s.players[i] as PwPlayer;
    const seen = !!inp && inp.ok;
    p.seen = seen;
    if (!seen || !inp) return null;
    const ch = inp.ch;
    const pt = ch['pose.t'];
    if (finite(pt)) {
      for (const l of LIMBS) {
        const v = ch[`limb.${l}`];
        if (finite(v)) p.limbs[l] = round(v, 1);
      }
      if (this.seated) for (const l of SEATED_LEGS) p.limbs[l] = STAND[l];
      p.drop = finite(ch['drop']) ? round(ch['drop'], 3) : 0;
      if (pt !== p.poseT) { p.poseT = pt; p.poseK = k; }
      this.moved(p, k);
      return ch;
    }
    if (camera) return null;
    // keys and swipes: a pick that stays where it is left
    const next = (ch['pickNext'] ?? 0) > 0;
    const prev = (ch['pickPrev'] ?? 0) > 0;
    const rest = (ch['pickRest'] ?? 0) > 0;
    const n = this.names.length;
    if (next && !p.nextHeld) p.pick = mod(p.pick + 1, n);
    if (prev && !p.prevHeld) p.pick = mod(p.pick - 1, n);
    if (rest && !p.restHeld) p.pick = 0;
    p.nextHeld = next;
    p.prevHeld = prev;
    p.restHeld = rest;
    const shape = this.shapes[p.pick] ?? null;
    const target = { ...STAND, ...(shape?.limbs ?? {}) } as LimbAngles;
    for (const l of LIMBS) p.limbs[l] = target[l];
    p.drop = shape?.minDrop ?? 0;
    p.poseT = msOf(k);
    p.poseK = k;
    this.moved(p, k);
    const out: Record<string, number> = { 'pose.t': p.poseT, 'pose.arms': 1, 'pose.legs': this.seated ? 0 : 1, drop: p.drop };
    for (const l of LIMBS) out[`limb.${l}`] = p.limbs[l];
    return out;
  }

  /** Movement for the honest calories: a limb that has turned since the last look. */
  private moved(p: PwPlayer, k: number): void {
    for (const l of LIMBS) {
      if (angleDiff(p.limbs[l], p.ref[l]) >= MOVE_DEG) {
        for (const m of LIMBS) p.ref[m] = p.limbs[m];
        p.lastActK = k;
        return;
      }
    }
  }

  /** The walls whose verdict is due at this step. */
  private arrivals(k: number, t: number, out: SimEvent[]): void {
    const s = this.s;
    const due = this.verdicts.get(k);
    if (!due) return;
    const passedLanes: number[] = [];
    for (const w of due) {
      const ws = s.ws[w.id] as PwWallState;
      if (ws.done !== 0) continue;
      const p = s.players[w.lane] as PwPlayer;
      const judge = this.judges[w.lane] as PoseWallJudge;
      const seriesEnd = w.series > 0 && w.series === w.of;
      if (ws.locked) {
        ws.done = 1;
        p.passed++;
        p.streak++;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        p.judged++;
        p.fitSum += ws.fit;
        const perfect = ws.fit >= PERFECT;
        if (perfect) p.perfect++;
        p.lastActK = k;
        p.note = { fit: ws.fit, k };
        const pts = Math.round((BASE_POINTS + FIT_POINTS * ws.fit) * (1 + Math.min(0.5, (p.streak - 1) * 0.05)));
        p.score += pts;
        s.log.push(logOf(k, 'wall', true, { v: pts, ...(this.count === 2 ? { player: (w.lane + 1) as 1 | 2 } : {}) }));
        out.push({ type: 'wall', t, id: w.id, lane: w.lane, ok: true, fit: round(ws.fit, 3), pts, streak: p.streak, pose: w.pose, perfect, series: w.series, of: w.of });
        passedLanes.push(w.lane);
        if (seriesEnd && p.seriesOk) {
          p.score += SERIES_BONUS;
          s.seriesPassed++;
          s.log.push(logOf(k, 'series', true, { v: SERIES_BONUS, ...(this.count === 2 ? { player: (w.lane + 1) as 1 | 2 } : {}) }));
          out.push({ type: 'series', t, lane: w.lane, of: w.of, bonus: SERIES_BONUS });
        }
      } else {
        const asked = judge.explain(this.judged(w, p));
        const why: Miss | null = asked === null ? null : reasonFor(asked);
        if (!p.seen || why === null || why.code === 'person_out') {
          // nobody to judge: nothing is won, nothing is lost (and a series with a hole in it earns no bonus)
          ws.done = 3;
          if (w.series > 0) p.seriesOk = false;
          out.push({ type: 'wall', t, id: w.id, lane: w.lane, ok: false, skipped: true, pose: w.pose, series: w.series, of: w.of });
        } else {
          ws.done = 2;
          p.missed++;
          p.streak = 0;
          p.judged++;
          if (w.series > 0) p.seriesOk = false;
          const note: MissNote = {
            code: why.code, ...(why.got !== undefined ? { got: round(why.got, 2) } : {}), ...(why.need !== undefined ? { need: round(why.need, 2) } : {}),
            ...(why.limb !== undefined ? { limb: why.limb } : {}),
          };
          if (k - p.lastMissK >= 30) { p.lastMissK = k; p.miss = { ...note, k }; }
          s.log.push(logOf(k, why.code, false, { ...(why.got !== undefined ? { v: round(why.got, 2) } : {}), ...(this.count === 2 ? { player: (w.lane + 1) as 1 | 2 } : {}) }));
          out.push({
            type: 'wall', t, id: w.id, lane: w.lane, ok: false, code: why.code, pose: w.pose, series: w.series, of: w.of,
            ...(why.limb !== undefined ? { limb: why.limb } : {}), ...(why.got !== undefined ? { got: round(why.got, 2) } : {}), ...(why.need !== undefined ? { need: round(why.need, 2) } : {}),
          });
        }
      }
      if (w.series === 0 || seriesEnd) p.seriesOk = true;
      judge.forget(w.id);
    }
    // a wall that both players passed is a team pass
    if (this.count === 2 && passedLanes.length === 2) {
      for (const p of s.players) p.score += TEAM_BONUS;
      s.teamPasses++;
      s.teamAt = k;
      s.log.push(logOf(k, 'team', true, { v: TEAM_BONUS }));
      out.push({ type: 'team', t, bonus: TEAM_BONUS });
    }
  }

  // ───── results ─────

  /** The mean fit of the walls that were judged (a missed wall counts as 0), 0..1. */
  quality(): number {
    const judged = this.s.players.reduce((n, p) => n + p.judged, 0);
    return judged ? this.s.players.reduce((n, p) => n + p.fitSum, 0) / judged : 0;
  }

  summary(): RunSummary {
    const s = this.s;
    const met = (p: PwPlayer): number => round(this.met * PW_VARIANT_MET[this.variant] * (p.activeSteps / 60), 1);
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
      const one = (p: PwPlayer): { score: number; reps: number; hits: number; cleared: number; metSeconds: number } => ({ score: p.score, reps: p.passed, hits: p.perfect, cleared: p.passed, metSeconds: met(p) });
      base.players = { 1: one(s.players[0] as PwPlayer), 2: one(s.players[1] as PwPlayer) };
    }
    return base;
  }

  snapshot(): unknown {
    const snap: PwState = copyData({ ...this.s, judges: [] as unknown[] });
    snap.judges = this.judges.map((j) => dumpOwn(j));
    return snap;
  }

  restore(raw: unknown): void {
    const snap = raw as PwState;
    if (!snap || snap.v !== 1) throw new Error('Not a Pose Wall snapshot.');
    this.s = copyData(snap);
    this.judges = Array.from({ length: this.s.players.length }, (_, i) => {
      const j = new PoseWallJudge();
      if (this.s.judges[i] !== undefined) loadOwn(j, this.s.judges[i]);
      return j;
    });
    this.index();
  }
}

/** Does the shape need the arms, or the legs, in view? (for the view's words and the tests) */
export const shapeNeeds = (p: PoseTarget): { arms: boolean; legs: boolean } => ({ arms: needsArms(p), legs: needsLegs(p) });
