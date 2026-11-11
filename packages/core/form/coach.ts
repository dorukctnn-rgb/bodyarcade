// The form coach: pose frames in, repetitions, part colours and one cue out (SPEC.md section 9).
//
// Per frame: smooth the points, read the camera angle and the near side (both with hysteresis), keep the player's own lengths,
// measure the move's progress, step the repetition machine, check the live rules of this phase (each with its own hysteresis:
// bad for holdMs before it shows, clear for clearMs before it goes), judge the repetition rules when a repetition ends, colour
// the parts (bad > tip > ok > unknown > none) and pick one cue. A rule whose points are not seen well enough is 'unknown': its
// parts turn grey and it never shows red. No allocation-heavy work per frame beyond a few small objects.
import { LM, type PoseFrame } from '../types/index.ts';
import { COUNT_VISIBILITY, dist, mid, nearSideScore, seen, viewOf, type P, type Side, type View } from './geometry.ts';
import { checkPlacement } from './guide.ts';
import { FORM_MOVES } from './moves/index.ts';
import { RepMachine } from './reps.ts';
import { emptySegments, worse } from './segments.ts';
import { PointSmoother } from './smooth.ts';
import type {
  BodyCtx, CoachState, FormMoveId, LiveRule, MoveDef, Phase, RepRule, RepSummary, SegState, SegmentId, SetSummary, Severity,
} from './types.ts';

class Hyst {
  bad = false;
  badSince = -1;
  private clearSince = -1;
  step(isBad: boolean, isClear: boolean, t: number, holdMs: number, clearMs: number): boolean {
    if (!this.bad) {
      if (isBad) { if (this.badSince < 0) this.badSince = t; if (t - this.badSince >= holdMs) { this.bad = true; this.clearSince = -1; } } else this.badSince = -1;
    } else if (isClear) {
      if (this.clearSince < 0) this.clearSince = t;
      if (t - this.clearSince >= clearMs) { this.bad = false; this.badSince = -1; }
    } else this.clearSince = -1;
    return this.bad;
  }
  reset(): void { this.bad = false; this.badSince = -1; this.clearSince = -1; }
}

/** A length that follows the largest recent value (the limb seen straight on), decaying slowly, robust to a single bad frame. */
class RunningLength {
  value = 0;
  private readonly ring: number[] = [];
  private lastT = -Infinity;
  push(v: number | null, t: number): void {
    if (this.lastT > -Infinity && this.value > 0) this.value *= Math.max(0, 1 - 0.01 * Math.max(0, t - this.lastT) / 1000);
    this.lastT = t;
    if (v === null || !(v > 0)) return;
    this.ring.push(v);
    if (this.ring.length > 5) this.ring.shift();
    const sorted = [...this.ring].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] as number;
    if (med > this.value) this.value = med;
  }
  reset(): void { this.value = 0; this.ring.length = 0; this.lastT = -Infinity; }
}

interface Flash { segments: readonly SegmentId[]; state: SegState; until: number }
interface CueCand { code: string; severity: Severity; since: number }

export interface FormCoach {
  readonly move: MoveDef;
  push(f: PoseFrame): CoachState;
  summary(): SetSummary;
  reset(): void;
}

export interface FormCoachOptions {
  /** A person gone for this long cancels the repetition in progress (ms). */
  lostMs?: number;
  /** A cue stays at least this long (ms). */
  cueMinMs?: number;
}

const DEFAULT_PHASES: readonly Phase[] = ['down', 'bottom', 'up'];

export function createFormCoach(m: MoveDef | FormMoveId, o: FormCoachOptions = {}): FormCoach {
  const move = typeof m === 'string' ? FORM_MOVES[m] : m;
  const cueMinMs = o.cueMinMs ?? 1500;
  const smoother = new PointSmoother();
  const reps = new RepMachine(move.rep, o.lostMs ?? 600);
  const len = { thigh: new RunningLength(), shin: new RunningLength(), upperArm: new RunningLength(), forearm: new RunningLength(), torso: new RunningLength(), shoulders: new RunningLength() };
  const hyst = new Map<string, Hyst>();
  const live = move.rules.filter((r): r is LiveRule => r.kind === 'live');
  const repRules = move.rules.filter((r): r is RepRule => r.kind === 'rep');
  const progressRules = new Set(repRules.filter((r) => r.id.endsWith('.depth') || r.id.endsWith('.top') || r.id.endsWith('.height')).map((r) => r.id));

  let view: View | null = null, viewCand: View | null = null, viewCandSince = 0;
  let near: Side = 'L';
  let lastSeenT = -Infinity;
  let flashes: Flash[] = [];
  let cueFlash: (CueCand & { until: number }) | null = null;
  let cue: { code: string; severity: Severity; shownAt: number } | null = null;
  let armed = false;
  let hits = { errors: new Set<string>(), tips: new Set<string>() };
  const list: RepSummary[] = [];
  const viewsSeen = new Set<View>();

  const h = (key: string): Hyst => { let x = hyst.get(key); if (!x) { x = new Hyst(); hyst.set(key, x); } return x; };

  function updateLengths(pts: readonly P[], t: number): void {
    const sides: Side[] = view === 'side' ? [near] : ['L', 'R'];
    const pairLen = (iL: number, jL: number, iR: number, jR: number): number | null => {
      let out: number | null = null;
      for (const s of sides) {
        const p = pts[s === 'L' ? iL : iR], q = pts[s === 'L' ? jL : jR];
        if (seen(p, COUNT_VISIBILITY) && seen(q, COUNT_VISIBILITY)) { const d = dist(p, q); out = out === null ? d : Math.max(out, d); }
      }
      return out;
    };
    len.thigh.push(pairLen(LM.leftHip, LM.leftKnee, LM.rightHip, LM.rightKnee), t);
    len.shin.push(pairLen(LM.leftKnee, LM.leftAnkle, LM.rightKnee, LM.rightAnkle), t);
    len.upperArm.push(pairLen(LM.leftShoulder, LM.leftElbow, LM.rightShoulder, LM.rightElbow), t);
    len.forearm.push(pairLen(LM.leftElbow, LM.leftWrist, LM.rightElbow, LM.rightWrist), t);
    const ls = pts[LM.leftShoulder]!, rs = pts[LM.rightShoulder]!, lh = pts[LM.leftHip]!, rh = pts[LM.rightHip]!;
    if (view === 'side') {
      const sh = near === 'L' ? ls : rs, hp = near === 'L' ? lh : rh;
      len.torso.push(seen(sh, COUNT_VISIBILITY) && seen(hp, COUNT_VISIBILITY) ? dist(sh, hp) : null, t);
    } else {
      const ok = [ls, rs, lh, rh].every((p) => seen(p, COUNT_VISIBILITY));
      len.torso.push(ok ? dist(mid(ls, rs), mid(lh, rh)) : null, t);
      len.shoulders.push(seen(ls, COUNT_VISIBILITY) && seen(rs, COUNT_VISIBILITY) ? dist(ls, rs) : null, t);
    }
  }

  function lengths(): BodyCtx['len'] {
    return { thigh: len.thigh.value, shin: len.shin.value, upperArm: len.upperArm.value, forearm: len.forearm.value, torso: len.torso.value, shoulders: len.shoulders.value };
  }

  function chooseCue(cands: CueCand[], t: number): void {
    if (cueFlash && t > cueFlash.until) cueFlash = null;
    const all = cueFlash ? [...cands, cueFlash] : cands;
    const rank = (c: CueCand): number => (c.severity === 'error' ? 0 : 1);
    all.sort((a, b) => rank(a) - rank(b) || a.since - b.since);
    const best = all[0] ?? null;
    if (cue && t - cue.shownAt < cueMinMs) {
      // keep the cue on screen, unless an error comes while a tip shows
      if (best && cue.severity === 'tip' && best.severity === 'error') cue = { code: best.code, severity: best.severity, shownAt: t };
      return;
    }
    if (!best) { cue = null; return; }
    if (!cue || cue.code !== best.code) cue = { code: best.code, severity: best.severity, shownAt: t };
  }

  function blank(t: number, present: boolean, pts: readonly P[], guideAspect: number): CoachState {
    const segs = emptySegments();
    chooseCue([], t);
    return {
      t, present, view, near, guide: checkPlacement(move, present ? pts : null, present ? view : null, near, guideAspect),
      phase: reps.phase, progress: null, reps: list.length, clean: list.filter((r) => r.clean).length, segments: segs,
      cue: cue?.code ?? null, cueSeverity: cue?.severity ?? null, repDone: null, pts,
    };
  }

  function reset(): void {
    smoother.reset(); reps.reset(); for (const l of Object.values(len)) l.reset(); hyst.clear();
    view = null; viewCand = null; near = 'L'; flashes = []; cueFlash = null; cue = null; armed = false;
    hits = { errors: new Set(), tips: new Set() };
    list.length = 0; viewsSeen.clear(); lastSeenT = -Infinity;
  }

  function push(f: PoseFrame): CoachState {
    const t = f.t;
    if (!f.landmarks) {
      const ev = reps.push(null, t);
      if (ev.some((e) => e.kind === 'cancel')) { armed = false; hits = { errors: new Set(), tips: new Set() }; }
      if (t - lastSeenT > 3000) { for (const l of Object.values(len)) l.reset(); view = null; }
      return blank(t, false, smoother.pts, f.aspect);
    }
    lastSeenT = t;
    const pts = smoother.push(f.landmarks, t, f.aspect);

    // camera angle and near side, both held against flicker
    // the camera angle is read at the start position and held through a repetition (a squat changes the torso's length)
    const raw = reps.phase === 'top' ? viewOf(pts) : null;
    if (raw !== null) {
      if (view === null) view = raw;
      else if (raw !== view) {
        if (viewCand !== raw) { viewCand = raw; viewCandSince = t; }
        else if (t - viewCandSince >= 500) { view = raw; viewCand = null; }
      } else viewCand = null;
    }
    if (view) viewsSeen.add(view);
    const score = nearSideScore(pts);
    if (near === 'L' && score < -0.5) near = 'R';
    else if (near === 'R' && score > 0.5) near = 'L';

    updateLengths(pts, t);
    const base = { t, pts, view: (view ?? 'front') as View, near, len: lengths() };
    const usable = view !== null && move.views.includes(view);
    const p = usable ? move.progress(base) : null;
    const events = reps.push(p, t);
    const phase = reps.phase;
    const ctx: BodyCtx = { ...base, p: p ?? 0, phase };

    const segs = emptySegments();
    const paint = (ids: readonly SegmentId[], s: SegState): void => { for (const id of ids) segs[id] = worse(segs[id], s); };
    const cands: CueCand[] = [];

    for (const r of live) {
      // a rule written for another camera angle says nothing here (its parts stay neutral, not grey: grey means "cannot see")
      if (!view || !r.views.includes(view)) { h(r.id).reset(); h(`${r.id}:L`).reset(); h(`${r.id}:R`).reset(); continue; }
      const phases = r.phases ?? DEFAULT_PHASES;
      const active = p !== null && phases.includes(phase) && (r.minP === undefined || p >= r.minP);
      if (!active) { h(r.id).reset(); h(`${r.id}:L`).reset(); h(`${r.id}:R`).reset(); continue; }
      const m = r.measure(ctx);
      const one = (v: number | null, key: string, side?: Side): void => {
        const ids = r.segments(ctx, side);
        if (v === null) { paint(ids, 'unknown'); return; }
        const x = h(key);
        const bad = x.step(r.bad(v), r.clear(v), t, r.holdMs ?? 150, r.clearMs ?? 100);
        if (!bad) { paint(ids, 'ok'); return; }
        paint(ids, r.severity === 'error' ? 'bad' : 'tip');
        const code = typeof r.cue === 'function' ? r.cue(v) : r.cue;
        cands.push({ code, severity: r.severity, since: x.badSince });
        if (armed) (r.severity === 'error' ? hits.errors : hits.tips).add(r.id);
      };
      if (m !== null && typeof m === 'object') { one(m.L, `${r.id}:L`, 'L'); one(m.R, `${r.id}:R`, 'R'); }
      else one(m, r.id);
    }

    let repDone: RepSummary | null = null;
    for (const e of events) {
      if (e.kind === 'start') {
        armed = true;
        // what is wrong in the start position as the repetition begins belongs to it (hands placed too far forward, hips piked)
        hits = { errors: new Set(), tips: new Set() };
        for (const r of live) {
          if (!(r.phases ?? DEFAULT_PHASES).includes('top')) continue;
          if (h(r.id).bad || h(`${r.id}:L`).bad || h(`${r.id}:R`).bad) (r.severity === 'error' ? hits.errors : hits.tips).add(r.id);
        }
      } else if (e.kind === 'cancel') {
        armed = false; hits = { errors: new Set(), tips: new Set() };
      } else if (e.kind === 'shallow') {
        // too small to count: say what the depth rule says, as a tip
        const depthRule = repRules.find((r) => progressRules.has(r.id) && view !== null && r.views.includes(view));
        if (depthRule && !cueFlash) cueFlash = { code: depthRule.cue, severity: 'tip', since: t, until: t + 1500 };
      } else if (e.kind === 'notReturned') {
        cueFlash = { code: move.returnCue, severity: 'tip', since: t, until: t + 1500 };
      } else if (e.kind === 'end') {
        armed = false;
        const stats = { startT: e.startT ?? t, bottomT: e.bottomT ?? t, endT: t, maxP: e.maxP ?? 0, at: {} };
        for (const r of repRules) {
          if (!view || !r.views.includes(view)) continue;
          const bad = r.judge(stats, ctx);
          if (bad === null) continue;
          if (bad) {
            (r.severity === 'error' ? hits.errors : hits.tips).add(r.id);
            flashes.push({ segments: r.segments(ctx), state: r.severity === 'error' ? 'bad' : 'tip', until: t + 1200 });
            if (!cueFlash || r.severity === 'error') cueFlash = { code: r.cue, severity: r.severity, since: t, until: t + 1500 };
          } else if (progressRules.has(r.id)) flashes.push({ segments: r.segments(ctx), state: 'ok', until: t + 600 });
        }
        repDone = {
          n: list.length + 1, startT: stats.startT, endT: t, maxP: stats.maxP,
          errors: [...hits.errors], tips: [...hits.tips], clean: hits.errors.size === 0,
        };
        list.push(repDone);
        hits = { errors: new Set(), tips: new Set() };
      }
    }

    // depth reached during the repetition: its parts turn green (the player sees the target is met)
    if (armed && p !== null && p >= move.rep.fullAt) for (const r of repRules) if (progressRules.has(r.id) && view && r.views.includes(view)) paint(r.segments(ctx), 'ok');
    flashes = flashes.filter((x) => x.until >= t);
    for (const x of flashes) paint(x.segments, x.state);

    chooseCue(cands, t);
    return {
      t, present: true, view, near, guide: checkPlacement(move, pts, view, near, f.aspect), phase, progress: p,
      reps: list.length, clean: list.filter((r) => r.clean).length, segments: segs,
      cue: cue?.code ?? null, cueSeverity: cue?.severity ?? null, repDone, pts,
    };
  }

  function summary(): SetSummary {
    const counts = new Map<string, number>();
    for (const r of list) for (const id of r.errors) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.size === 0) for (const r of list) for (const id of r.tips) counts.set(id, (counts.get(id) ?? 0) + 1);
    let top: SetSummary['top'] = null;
    for (const [id, count] of counts) if (!top || count > top.count) top = { id, count };
    const measured = move.rules.filter((r) => r.views.some((v) => viewsSeen.has(v))).map((r) => r.id);
    return { reps: list.length, clean: list.filter((r) => r.clean).length, top, list: [...list], measured };
  }

  return { move, push, summary, reset };
}
