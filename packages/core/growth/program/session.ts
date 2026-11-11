// One program session as it runs (SPEC 3.5), and the form coach adapter (SPEC 3.6). The form coach counts each set; this
// file only reads its SetSummary (reps, clean, sides, holdMs, top) and never changes form coach files. A set can also be
// typed by hand ("camera-free day") or corrected ("count wrong?": the clean share of a corrected set is unknown).
import type { FormMoveId, SetSummary } from '../../form/types.ts';
import { FORM_MOVES } from '../../form/moves/index.ts';
import type { Block, Prescription } from './generate.ts';
import type { MoveResult } from './progress.ts';

export interface SetLog {
  sessionId: string;
  moveId: FormMoveId;
  setNo: number;
  reps: number;
  clean: number | null;
  sides?: { L: number; R: number };
  holdMs?: number;
  bestHoldMs?: number;
  topError?: string | null;
  measured: string[];
  rir: 0 | 1 | 3;
  loadKg?: number;
  corrected: boolean;
  startedAt: number;
  endedAt: number;
  source: 'camera' | 'manual';
}

/** The form coach's set summary as a program log line. Count-only (S) and time-only (T) moves have no clean count. */
export function fromSummary(o: { sessionId: string; moveId: FormMoveId; setNo: number; sum: SetSummary; rir: 0 | 1 | 3; loadKg?: number; startedAt: number; endedAt: number }): SetLog {
  const formed = FORM_MOVES[o.moveId].label === 'F' || FORM_MOVES[o.moveId].label === 'H';
  const log: SetLog = {
    sessionId: o.sessionId, moveId: o.moveId, setNo: o.setNo, reps: o.sum.reps,
    clean: formed ? o.sum.clean : null, topError: o.sum.top?.id ?? null, measured: [...o.sum.measured], rir: o.rir,
    corrected: false, startedAt: o.startedAt, endedAt: o.endedAt, source: 'camera',
  };
  if (o.sum.sides) log.sides = { ...o.sum.sides };
  if (o.sum.holdMs !== undefined) log.holdMs = o.sum.holdMs;
  if (o.sum.bestHoldMs !== undefined) log.bestHoldMs = o.sum.bestHoldMs;
  if (o.loadKg !== undefined) log.loadKg = o.loadKg;
  return log;
}

/** "Count wrong?": the person fixes the number; the clean count is then unknown for the changed repetitions. */
export function correct(log: SetLog, reps: number): SetLog {
  const r = Math.max(0, Math.round(reps));
  return { ...log, reps: r, clean: log.clean === null ? null : Math.min(log.clean, r), corrected: true };
}

/** What one set counts as for its target: one-sided moves count the weaker side, held moves count seconds. */
export function setValue(log: SetLog, unit: 'reps' | 'seconds'): number {
  if (unit === 'seconds') return Math.floor((log.holdMs ?? 0) / 1000);
  return log.sides ? Math.min(log.sides.L, log.sides.R) : log.reps;
}

/** A session's logs folded into one result per move, for the progression. */
export function resultsOf(logs: readonly SetLog[], plan: readonly Prescription[], date: string): MoveResult[] {
  return plan.map((p) => {
    const mine = logs.filter((l) => l.moveId === p.move).sort((a, b) => a.setNo - b.setNo);
    const r: MoveResult = {
      move: p.move, date,
      done: mine.map((l) => setValue(l, p.unit)),
      clean: mine.map((l) => (l.clean === null || l.corrected ? null : l.reps > 0 ? l.clean / l.reps : 0)),
      rir: mine.map((l) => l.rir),
      topError: mine.map((l) => l.topError).find((e) => !!e) ?? null,
    };
    if (p.loadKg !== undefined) r.loadKg = p.loadKg;
    return r;
  }).filter((r) => r.done.length > 0);
}

/** The steps of a running session, in order: each set of each move, with its rest after it. */
export interface Step { block: Block['kind']; item: Prescription; setNo: number; restAfterS: number }

export function stepsOf(blocks: readonly Block[]): Step[] {
  const out: Step[] = [];
  for (const b of blocks) {
    const rounds = b.kind === 'conditioning' ? b.rounds ?? 1 : 1;
    for (let r = 0; r < rounds; r++) for (const it of b.items) {
      const sets = b.kind === 'main' ? it.sets : 1;
      for (let s = 1; s <= sets; s++) out.push({ block: b.kind, item: b.kind === 'conditioning' ? { ...it, target: b.workS ?? it.target, unit: 'seconds' } : it, setNo: b.kind === 'conditioning' ? r + 1 : s, restAfterS: b.kind === 'main' ? it.restS : b.kind === 'conditioning' ? b.restS ?? 20 : 0 });
    }
  }
  return out;
}

/** Has the set reached its target (the short sound)? One-sided moves need both sides. */
export function targetReached(state: { reps: number; holdMs: number; sides?: { L: number; R: number } }, p: Prescription): boolean {
  if (p.unit === 'seconds') return state.holdMs >= p.target * 1000;
  if (state.sides) return Math.min(state.sides.L, state.sides.R) >= p.target;
  return state.reps >= p.target;
}
