// Runs a form-coach fixture trace through the coach, frame by frame, and compares the result with the hand labels
// (labels.json). Shared by the measurement CLI (measure.ts) and the real-trace tests (packages/core/form/form.real.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrace, traceFrames } from '../../packages/core/pose/trace.ts';
import { createFormCoach } from '../../packages/core/form/coach.ts';
import type { FormMoveId, MoveDef, RepSummary } from '../../packages/core/form/types.ts';
import type { PoseFrame, Trace } from '../../packages/core/types/index.ts';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export interface Fixture {
  id: string; move: FormMoveId; clip: string; angle: string; windows: [number, number][]; source: string;
  /** Another fixture's trace this one reuses (the same video measured with a variant of the move: a goblet squat is a squat). */
  trace?: string;
}
/** The id of the trace file a fixture is measured on. */
export const traceId = (f: Pick<Fixture, 'id' | 'trace'>): string => f.trace ?? f.id;

/** One labelled repetition: when it was deepest (fixture seconds) and what was wrong with it (rule ids; empty = good form). */
export interface LabelRep { t: number; wrong?: string[]; note?: string }
export interface FixtureLabel {
  /**
   * 'reps': every repetition is labelled; 'none': nothing may be counted (wrong camera angle, not this move); 'wrong': the
   * source shows a mistake without saying exactly which one: whatever is counted must be judged not clean.
   */
  kind: 'reps' | 'none' | 'wrong';
  reps?: LabelRep[];
  /** How the labels were made. */
  how: string;
  /** Rule ids that cannot be judged on this clip (e.g. depth on a deliberately half squat). */
  skipRules?: string[];
  /** 'perturbed': a real trace changed on purpose (semi-synthetic), never counted as real-world evidence. */
  origin?: 'real' | 'perturbed';
  /** A cue the coach must give at least once on this clip. */
  expectCue?: string;
}

export const fixtures = (): Fixture[] => (JSON.parse(readFileSync(join(root, 'tools/form-fixtures/fixtures.json'), 'utf8')) as { fixtures: Fixture[] }).fixtures;
export const labels = (): Record<string, FixtureLabel> => JSON.parse(readFileSync(join(root, 'tools/form-fixtures/labels.json'), 'utf8')) as Record<string, FixtureLabel>;
export const loadTrace = (id: string, dir = 'tests/traces/form'): Trace => parseTrace(JSON.parse(readFileSync(join(root, dir, `${id}.trace.json`), 'utf8')));

export interface RunResult {
  reps: RepSummary[];
  /** Frames where any part was red, and frames with a person. */
  redFrames: number;
  frames: number;
  views: Record<string, number>;
  /** Progress per frame (null where not measured), for plots. */
  progress: (number | null)[];
  times: number[];
  /** Every cue code shown during the run. */
  cues: Set<string>;
}

/** Feeds the frames (optionally resampled to `hz`) through a fresh coach. */
export function runFrames(move: FormMoveId | MoveDef, frames: PoseFrame[]): RunResult {
  const coach = createFormCoach(move);
  const reps: RepSummary[] = [];
  let red = 0, seen = 0;
  const views: Record<string, number> = {};
  const progress: (number | null)[] = [];
  const times: number[] = [];
  const cues = new Set<string>();
  for (const f of frames) {
    const s = coach.push(f);
    if (s.cue) cues.add(s.cue);
    if (s.repDone) reps.push(s.repDone);
    if (s.present) { seen++; if (Object.values(s.segments).includes('bad')) red++; }
    const v = s.view ?? 'none';
    views[v] = (views[v] ?? 0) + 1;
    progress.push(s.progress);
    times.push(f.t);
  }
  return { reps, redFrames: red, frames: seen, views, progress, times, cues };
}

export function runTrace(move: FormMoveId | MoveDef, trace: Trace, hz?: number): RunResult {
  return runFrames(move, traceFrames(trace, hz ? { hz } : {}));
}

export interface Score {
  truth: number;
  counted: number;
  /** Detected repetitions matched to a labelled one (within 1.2 s of its deepest moment). */
  matched: number;
  /** Labelled good-form repetitions, and how many of them the coach called not clean (a false alarm). */
  good: number;
  falseAlarm: number;
  /** Labelled wrong repetitions (per rule), and how many the coach flagged with that rule. */
  wrong: number;
  caught: number;
  /** Rule ids of the false alarms, for tuning. */
  alarmRules: Record<string, number>;
}

export function score(r: RunResult, label: FixtureLabel): Score {
  if (label.kind === 'wrong') {
    const flagged = r.reps.filter((x) => !x.clean).length;
    return { truth: 0, counted: r.reps.length, matched: 0, good: 0, falseAlarm: 0, wrong: r.reps.length, caught: flagged, alarmRules: {} };
  }
  const truth = label.kind === 'none' ? [] : label.reps ?? [];
  const skip = new Set(label.skipRules ?? []);
  const used = new Set<number>();
  let matched = 0, good = 0, falseAlarm = 0, wrong = 0, caught = 0;
  const alarmRules: Record<string, number> = {};
  for (const lab of truth) {
    // the detected repetition whose span contains the labelled bottom, or the nearest end within 1.2 s
    let best = -1, bestD = Infinity;
    r.reps.forEach((d, i) => {
      if (used.has(i)) return;
      const inside = lab.t * 1000 >= d.startT - 300 && lab.t * 1000 <= d.endT + 300;
      const dd = inside ? 0 : Math.min(Math.abs(d.startT - lab.t * 1000), Math.abs(d.endT - lab.t * 1000));
      if (dd < bestD) { bestD = dd; best = i; }
    });
    const det = best >= 0 && bestD <= 1200 ? r.reps[best] : undefined;
    if (det) { used.add(best); matched++; }
    const flagged = new Set([...(det?.errors ?? [])].filter((id) => !skip.has(id)));
    const want = (lab.wrong ?? []).filter((id) => !skip.has(id));
    if (want.length === 0) {
      good++;
      if (det && flagged.size > 0) { falseAlarm++; for (const id of flagged) alarmRules[id] = (alarmRules[id] ?? 0) + 1; }
    } else for (const id of want) { wrong++; if (det && flagged.has(id)) caught++; }
  }
  return { truth: truth.length, counted: r.reps.length, matched, good, falseAlarm, wrong, caught, alarmRules };
}

/** The frame of the start position: progress nearest `target` (standing, plank, rack), for the controlled faults. */
export function restIndex(move: FormMoveId, trace: Trace, target = move === 'dbShoulderPress' ? 0.15 : 0.03): number {
  const r = runTrace(move, trace);
  let best = -1, bestD = Infinity;
  r.progress.forEach((p, i) => { if (p !== null && trace.frames[i]?.lm && Math.abs(p - target) < bestD) { bestD = Math.abs(p - target); best = i; } });
  return best;
}
