// M12 pose matching (game-design.md 0.5; card 34 Pose Wall): ten limb directions against a target pose.
//
// The ten limbs, each a direction in degrees in the mirrored picture (0 = screen right, 90 = up, -90 = down):
// armUpperL/R (shoulder to elbow), armLowerL/R (elbow to hand centre), thighL/R (hip to knee), shinL/R (knee to ankle),
// torso (hip midpoint to shoulder midpoint) and neck (shoulder midpoint to nose). A limb fits when its direction is within
// `tol` degrees of the target (30 easy, 22 normal, 15 hard); the pose fits when every limb the pose defines fits.
//
// Like the other target games, this is split in two (a detector is built from numbers; the wall is game state):
// 1. `createPoseMatchDetector` (id 'poseMatch') publishes the limb directions as channels `limb.<name>` (degrees), `drop`,
//    `pose.arms` / `pose.legs` (1 while that part is in view), `pose.t` (frame time). With the option `pose` (an index
//    into POSES, poses.ts) it also judges that one pose: channels `similarity` (0..1), `matched` (0 or 1) and the events
//    holdStart / holdEnd when the pose has been held for `holdMs` (300).
// 2. `fitPose` (one frame against one target) and `PoseWallJudge` (a wall: held for at least `holdMs` within the
//    `windowMs` (800 ms) before it arrives) for the game's step.
// similarity: each limb scores 1 at no error and falls to 0 at twice the tolerance; the pose is the mean of its limbs.
// Misses: limb_off (limb name, got = degrees off, need = tolerance), held_too_short, hips_not_low, hands_out_of_view,
// knees_out_of_view, feet_out_of_view.
import type { DetectorFactory, Features, MovementEvent } from '../types/index.ts';
import { PersonGate, Visibility, angleDiff, angleOf, clamp, ev, sub, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';
import { POSES, needsArms, needsLegs, type PoseTarget } from './poses.ts';

export const LIMBS = ['armUpperL', 'armUpperR', 'armLowerL', 'armLowerR', 'thighL', 'thighR', 'shinL', 'shinR', 'torso', 'neck'] as const;
export type LimbName = (typeof LIMBS)[number];
export type LimbAngles = Record<LimbName, number>;

export const POSE_MATCH_DEFAULTS = {
  pose: -1,           // index into POSES; -1: publish the limbs only
  tol: 22,            // degrees per limb (card 34: 30 / 22 / 15)
  holdMs: 300,        // card 34
  windowMs: 800,      // card 34: the hold counts within this long before the wall
  graceMs: 250,
  lostMs: 600,
} as const;

/** The ten limb directions of one frame, degrees, from the body-space joints. */
export function limbAngles(f: Features): LimbAngles {
  return {
    armUpperL: angleOf(sub(f.elbow[0], f.shoulders[0])), armUpperR: angleOf(sub(f.elbow[1], f.shoulders[1])),
    armLowerL: angleOf(sub(f.hand[0], f.elbow[0])), armLowerR: angleOf(sub(f.hand[1], f.elbow[1])),
    thighL: angleOf(sub(f.knee[0], f.hips[0])), thighR: angleOf(sub(f.knee[1], f.hips[1])),
    shinL: angleOf(sub(f.ankle[0], f.knee[0])), shinR: angleOf(sub(f.ankle[1], f.knee[1])),
    torso: angleOf(sub(f.shoulder, f.hip)), neck: angleOf(sub(f.head, f.shoulder)),
  };
}

/** The limb directions from a channel set published by the detector (limbs missing from it read as straight down). */
export function anglesFromChannels(ch: Readonly<Record<string, number>>): LimbAngles {
  const out = {} as LimbAngles;
  for (const l of LIMBS) out[l] = ch[`limb.${l}`] ?? -90;
  return out;
}

export interface PoseFit {
  /** 0..1: the mean score of the limbs the pose defines. */
  similarity: number;
  /** Every defined limb within the tolerance. */
  matched: boolean;
  /** Degrees off, per defined limb. */
  errors: Partial<Record<LimbName, number>>;
  /** The limb furthest from its target, and by how much (null for a pose with no limbs). */
  worst: LimbName | null;
  worstError: number;
}

export function fitPose(angles: Readonly<LimbAngles>, target: PoseTarget, tol: number = POSE_MATCH_DEFAULTS.tol): PoseFit {
  const errors: Partial<Record<LimbName, number>> = {};
  let sum = 0, n = 0, worst: LimbName | null = null, worstError = 0, matched = true;
  for (const l of LIMBS) {
    const want = target.limbs[l];
    if (want === undefined) continue;
    const e = angleDiff(angles[l], want);
    errors[l] = e;
    sum += clamp(1 - e / (2 * tol), 0, 1);
    n++;
    if (e > tol) matched = false;
    if (e >= worstError) { worstError = e; worst = l; }
  }
  return { similarity: n ? sum / n : 0, matched: n > 0 && matched, errors, worst, worstError };
}

export const createPoseMatchDetector: DetectorFactory = (_p, opts): ExplainingDetector => {
  const o = withDefaults(POSE_MATCH_DEFAULTS, opts);
  const target: PoseTarget | undefined = o.pose >= 0 ? POSES[Math.floor(o.pose)] : undefined;
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  let ch: Record<string, number> = {};
  let similarity = 0, matchedNow = false, nowT = 0, any = false;
  let runSince: number | null = null;
  let holding = false;
  let lastFit: PoseFit | null = null;
  let lastDrop = 0;

  function endHold(t: number, out: MovementEvent[]): void {
    if (holding) out.push(ev('poseMatch', 'holdEnd', t, { value: similarity }));
    holding = false; runSince = null;
  }

  return {
    id: 'poseMatch',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { endHold(f.t, out); ch = {}; matchedNow = false; similarity = 0; return out; }
      if (g !== 'ok') return out;
      const a = limbAngles(f);
      const armsSeen = vis.seen('hands', f.t, o.graceMs) && vis.seen('elbows', f.t, o.graceMs);
      const legsSeen = vis.seen('knees', f.t, o.graceMs) && vis.seen('ankles', f.t, o.graceMs);
      lastDrop = f.drop;
      ch = { 'pose.t': f.t, 'pose.arms': armsSeen ? 1 : 0, 'pose.legs': legsSeen ? 1 : 0, drop: f.drop };
      for (const l of LIMBS) ch[`limb.${l}`] = a[l];
      if (target) {
        const fit = fitPose(a, target, o.tol);
        const seenOk = (!needsArms(target) || armsSeen) && (!needsLegs(target) || legsSeen);
        const deep = target.minDrop === undefined || f.drop >= target.minDrop;
        lastFit = fit;
        similarity = seenOk ? fit.similarity : 0;
        matchedNow = seenOk && deep && fit.matched;
        ch.similarity = similarity; ch.matched = matchedNow ? 1 : 0;
        if (matchedNow) {
          runSince ??= f.t;
          if (!holding && f.t - runSince >= o.holdMs) { holding = true; out.push(ev('poseMatch', 'holdStart', f.t, { value: similarity })); }
        } else endHold(f.t, out);
        ch.held = holding && runSince !== null ? f.t - runSince : 0;
      }
      return out;
    },
    value: () => (target && any && Object.keys(ch).length ? similarity : undefined),
    channels: () => ch,
    explain(): Miss | null {
      if (!any || !target || !Object.keys(ch).length) return null;
      if (needsArms(target) && vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      if (needsLegs(target) && vis.unseenFor('knees', nowT) > 500) return { code: 'knees_out_of_view' };
      if (needsLegs(target) && vis.unseenFor('ankles', nowT) > 500) return { code: 'feet_out_of_view' };
      if (matchedNow || holding) return null;
      const fit = lastFit;
      if (!fit) return null;
      if (fit.matched && target.minDrop !== undefined && lastDrop < target.minDrop) return { code: 'hips_not_low', got: lastDrop, need: target.minDrop };
      if (fit.worst) return { code: 'limb_off', limb: fit.worst, got: fit.worstError, need: o.tol };
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); ch = {}; similarity = 0; matchedNow = false; nowT = 0; any = false; runSince = null; holding = false;
      lastFit = null; lastDrop = 0;
    },
  } satisfies ExplainingDetector;
};


// ───────── the game's side: a wall that has to be fitted ─────────

export interface PoseWall {
  id: number;
  pose: PoseTarget;
  /** Pose-clock time (ms) at which the wall arrives. */
  dueAt: number;
  /** Degrees per limb: 30 easy, 22 normal (default), 15 hard. */
  tol?: number;
  /** Default 300 ms. */
  holdMs?: number;
  /** Default 800 ms: only frames in this long before `dueAt` count. */
  windowMs?: number;
}

export interface WallJudgement {
  kind: 'pass';
  id: number;
  t: number;
  /** Mean similarity over the frames of the held run, 0..1: the wall's "uyum". */
  similarity: number;
  heldMs: number;
}

export interface WallResult {
  passed: boolean;
  /** The best similarity in the window, 0..1 (what a failed wall still scores). */
  fit: number;
  /** The longest run of a matching pose in the window, ms. */
  heldMs: number;
}

interface WallState {
  frames: number; run: number; runSince: number; runSum: number; longest: number; best: number; bestFit: PoseFit | null;
  seenBlock: Miss | null; deepBlocked: number; done: boolean;
}

export class PoseWallJudge {
  private walls = new Map<number, WallState>();
  private lastT = -Infinity;

  private state(id: number): WallState {
    let s = this.walls.get(id);
    if (!s) {
      if (this.walls.size >= 64) this.walls.delete(this.walls.keys().next().value as number);
      s = { frames: 0, run: 0, runSince: 0, runSum: 0, longest: 0, best: 0, bestFit: null, seenBlock: null, deepBlocked: -1, done: false };
      this.walls.set(id, s);
    }
    return s;
  }

  /** One pose frame (the channels of the detector) against the walls in play; returns the walls passed by this frame. */
  update(ch: Readonly<Record<string, number>>, walls: readonly PoseWall[]): WallJudgement[] {
    const t = ch['pose.t'];
    if (t === undefined || t === this.lastT) return [];
    this.lastT = t;
    const out: WallJudgement[] = [];
    const angles = anglesFromChannels(ch);
    for (const w of walls) {
      if (t < w.dueAt - (w.windowMs ?? POSE_MATCH_DEFAULTS.windowMs) || t > w.dueAt) continue;
      const s = this.state(w.id);
      if (s.done) continue;
      const tol = w.tol ?? POSE_MATCH_DEFAULTS.tol, hold = w.holdMs ?? POSE_MATCH_DEFAULTS.holdMs;
      s.frames++;
      const fit = fitPose(angles, w.pose, tol);
      const armsOk = !needsArms(w.pose) || ch['pose.arms'] === 1, legsOk = !needsLegs(w.pose) || ch['pose.legs'] === 1;
      if (!armsOk) s.seenBlock = { code: 'hands_out_of_view', target: w.id };
      else if (!legsOk) s.seenBlock = { code: 'knees_out_of_view', target: w.id };
      const deep = w.pose.minDrop === undefined || (ch.drop ?? 0) >= w.pose.minDrop;
      if (fit.matched && armsOk && legsOk && !deep) s.deepBlocked = Math.max(s.deepBlocked, ch.drop ?? 0);
      if (armsOk && legsOk && fit.similarity >= s.best) { s.best = fit.similarity; s.bestFit = fit; }
      if (fit.matched && armsOk && legsOk && deep) {
        if (s.run === 0) { s.runSince = t; s.runSum = 0; }
        s.run++; s.runSum += fit.similarity;
        s.longest = Math.max(s.longest, t - s.runSince);
        if (t - s.runSince >= hold) { s.done = true; out.push({ kind: 'pass', id: w.id, t, similarity: s.runSum / s.run, heldMs: t - s.runSince }); }
      } else s.run = 0;
    }
    return out;
  }

  /** How the wall went: call it when the wall arrives. */
  result(w: PoseWall): WallResult {
    const s = this.walls.get(w.id);
    return { passed: s?.done ?? false, fit: s?.best ?? 0, heldMs: s?.longest ?? 0 };
  }

  /** Why the wall was not passed (null when it was, or when nothing is known). */
  explain(w: PoseWall): Miss | null {
    const s = this.walls.get(w.id);
    if (!s || s.done) return null;
    const tol = w.tol ?? POSE_MATCH_DEFAULTS.tol, hold = w.holdMs ?? POSE_MATCH_DEFAULTS.holdMs;
    if (s.frames === 0) return { code: 'person_out', target: w.id };
    if (s.seenBlock && s.longest === 0) return s.seenBlock;
    if (s.deepBlocked >= 0 && s.longest === 0) return { code: 'hips_not_low', got: s.deepBlocked, need: w.pose.minDrop ?? 0, target: w.id };
    if (s.longest > 0) return { code: 'held_too_short', got: s.longest, need: hold, target: w.id };
    if (s.bestFit?.worst) return { code: 'limb_off', limb: s.bestFit.worst, got: s.bestFit.worstError, need: tol, target: w.id };
    return null;
  }

  forget(id: number): void { this.walls.delete(id); }
  reset(): void { this.walls.clear(); this.lastT = -Infinity; }
}
