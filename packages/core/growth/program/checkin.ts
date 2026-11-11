// The 30-second daily check-in and today's plan: the program engine's one door for the other screens (Today panel, kol F).
//   getTodayPlan({ program, date, checkin, states, week }) -> TodayPlan
// Five answers (sleep, energy 1-5, tiredness or pain, minutes today, priority) adapt today's session by fixed rules:
//   less time        -> a shorter plan (conditioning first, then sets, then moves; under 10 minutes a mini plan);
//   low energy/sleep -> lower intensity (one set less, the bottom of the range, no jumping, longer rests);
//   marked pain      -> the moves that load that area are left out today, with the note "if the pain goes on, ask a health
//                       professional" (a code here; no diagnosis, no treatment advice);
//   priority         -> strength drops the conditioning, cardio adds it, mobility swaps in the mobility session;
//   pain + time      -> what was left out is made up (kol F, 11 Nov: knee pain on a 20-minute day left a 5-minute plan): one
//                       set more on the main moves that stay (not on a low day), a low-impact circuit of moves that do not
//                       load the sore area at all, and a few such stretches in the cool-down, up to the minutes of the day.
// Codes and numbers only; the page words them.
import type { FormMoveId } from '../../form/types.ts';
import { allowed, blockSeconds, fit, generateProgram, pickMove, RX, type Block, type Prescription, type Program, type ProgramInput, type SessionTemplate, type Weekday } from './generate.ts';
import { MOVE_META, type Area } from './moves-meta.ts';
import { beforeSession, deload, isDeloadWeek, type MoveState } from './progress.ts';

export interface DailyCheckin {
  sleep: 'good' | 'ok' | 'poor';
  energy: 1 | 2 | 3 | 4 | 5;
  /** how the body feels: fine, tired or sore all over, or a marked pain somewhere (then painAreas) */
  body: 'fine' | 'tired' | 'pain';
  painAreas?: readonly Area[];
  /** minutes the person has today */
  minutes: number;
  priority: 'strength' | 'cardio' | 'mobility' | 'any';
}

export type Adjustment = 'short' | 'mini' | 'low-energy' | 'poor-sleep' | 'tired' | 'pain-skip' | 'pain-fill' | 'priority-strength' | 'priority-cardio' | 'priority-mobility' | 'deload' | 'rest-day';
export type PlanNote = 'see-professional' | 'rest-is-fine';

export interface TodayPlan {
  date: string;
  /** the scheduled session's id, or null on a rest day */
  sessionId: string | null;
  restDay: boolean;
  focus: SessionTemplate['focus'];
  blocks: Block[];
  minutes: number;
  intensity: 'normal' | 'low';
  adjustments: Adjustment[];
  /** moves left out today (pain), each with the area it loads */
  skipped: { move: FormMoveId; area: Area }[];
  notes: PlanNote[];
}

export interface TodayInput {
  program: Program;
  /** YYYY-MM-DD */
  date: string;
  checkin?: DailyCheckin | null;
  /** the progression's state per move (progress.ts): targets, weights and harder moves replace the template's */
  states?: Partial<Record<FormMoveId, MoveState>>;
  /** program week, from 1 (planned deload weeks) */
  week?: number;
}

const weekday = (date: string): Weekday => new Date(`${date}T12:00:00Z`).getUTCDay() as Weekday;
const clone = (b: Block[]): Block[] => b.map((x) => ({ ...x, items: x.items.map((p) => ({ ...p, range: [...p.range] as [number, number] })) }));

export function getTodayPlan(o: TodayInput): TodayPlan {
  const { program, date } = o;
  const c = o.checkin ?? null;
  const adjustments: Adjustment[] = [];
  const notes: PlanNote[] = [];
  const skipped: { move: FormMoveId; area: Area }[] = [];
  const id = program.schedule[weekday(date)] ?? null;
  let tpl = id ? program.sessions.find((s) => s.id === id) ?? null : null;

  // priority mobility, or a rest day: the mobility session (optional on a rest day)
  if (!tpl || c?.priority === 'mobility') {
    const mob = generateProgram({ ...program.input, goal: 'mobility', days: [weekday(date)], minutes: program.input.minutes }).sessions[0]!;
    if (!tpl) adjustments.push('rest-day'); else adjustments.push('priority-mobility');
    tpl = mob;
  }
  let blocks = clone(tpl.blocks);
  const main = (): Block | undefined => blocks.find((b) => b.kind === 'main');

  // progression state: today's move, target and weight for each main move
  const m0 = main();
  if (m0 && o.states) m0.items = m0.items.map((p) => {
    const s = o.states?.[p.move];
    if (!s) return p;
    const st = beforeSession(s, date);
    const q: Prescription = { ...p, move: st.move, target: st.target, range: [...st.range], unit: st.unit };
    if (st.loadKg !== undefined) q.loadKg = st.loadKg;
    return q;
  });
  if (m0 && o.week && isDeloadWeek(o.week, program.deloadEvery)) { m0.items = m0.items.map(deload); adjustments.push('deload'); }

  // pain: leave out what loads the area (strictly: any load), try a same-pattern move that does not
  if (c?.body === 'pain' && c.painAreas?.length) {
    const areas = c.painAreas;
    const strict = { ...program.input, avoid: { ...(program.input.avoid ?? {}), areas: [...(program.input.avoid?.areas ?? []), ...areas], strict: true } };
    for (const b of blocks) {
      const keep: Prescription[] = [];
      const used = new Set(b.items.map((p) => p.move));
      for (const p of b.items) {
        const hit = areas.find((a) => (MOVE_META[p.move].load[a] ?? 0) >= 1);
        if (!hit) { keep.push(p); continue; }
        skipped.push({ move: p.move, area: hit });
        if (b.kind === 'main') {
          const alt = pickMove(MOVE_META[p.move].pattern, strict, used);
          if (alt && allowed(alt, strict)) { used.add(alt); keep.push({ ...p, move: alt, unit: MOVE_META[alt].unit, target: MOVE_META[alt].unit === 'seconds' ? 20 : p.range[0], range: MOVE_META[alt].unit === 'seconds' ? [20, 60] : p.range }); }
        }
      }
      b.items = keep;
    }
    blocks = blocks.filter((b) => b.kind !== 'conditioning' || b.items.length > 0);
    adjustments.push('pain-skip');
    notes.push('see-professional');
  }

  // low energy, poor sleep or a tired body: lower intensity
  const low = !!c && (c.energy <= 2 || c.sleep === 'poor' || c.body === 'tired');
  if (low && c) {
    if (c.energy <= 2) adjustments.push('low-energy');
    if (c.sleep === 'poor') adjustments.push('poor-sleep');
    if (c.body === 'tired') adjustments.push('tired');
    for (const b of blocks) {
      b.items = b.items.filter((p) => !MOVE_META[p.move].impact || b.kind === 'warmup');
      if (b.kind === 'main') b.items = b.items.map((p) => ({ ...p, sets: Math.max(1, p.sets - 1), target: p.range[0], restS: p.restS + 30 }));
      if (b.kind === 'conditioning') { b.rounds = 1; b.workS = Math.min(b.workS ?? 30, 30); }
    }
    blocks = blocks.filter((b) => b.kind !== 'conditioning' || b.items.length > 0);
    notes.push('rest-is-fine');
  }

  // priority
  if (c?.priority === 'strength') { blocks = blocks.filter((b) => b.kind !== 'conditioning'); adjustments.push('priority-strength'); }
  if (c?.priority === 'cardio' && !low) {
    if (!blocks.some((b) => b.kind === 'conditioning')) {
      const items = (['jumpingJack', 'highKnees', 'stepJack', 'marching'] as FormMoveId[]).filter((mv) => allowed(mv, program.input) && !skipped.some((s) => s.move === mv)).slice(0, 3)
        .map((mv) => ({ move: mv, sets: 1, target: 30, range: [30, 40] as [number, number], unit: 'seconds' as const, restS: 20 }));
      if (items.length) blocks.splice(blocks.length - 1, 0, { kind: 'conditioning', items, rounds: 2, workS: 30, restS: 20 });
    }
    const mm = main(); if (mm && mm.items.length > 2) mm.items.pop();
    adjustments.push('priority-cardio');
  }

  // pain: make up the time that the left-out moves took (never on a mini day; the time step below trims an overshoot)
  const want = c?.minutes ?? program.input.minutes;
  if (c?.body === 'pain' && c.painAreas?.length && skipped.length && want >= 10) {
    const spare: ProgramInput = { ...program.input, avoid: { ...(program.input.avoid ?? {}), areas: [...(program.input.avoid?.areas ?? []), ...c.painAreas], strict: true, noJumping: true } };
    const filled = fillPainDay(blocks, spare, want * 60, low);
    if (filled) { blocks = filled; adjustments.push('pain-fill'); }
  }

  // time
  let session: SessionTemplate = { ...tpl, blocks };
  if (want < 10) {
    blocks = blocks.filter((b) => b.kind !== 'conditioning').map((b) => b.kind === 'main' ? { ...b, items: b.items.slice(0, 2).map((p) => ({ ...p, sets: 1 })) } : b.kind === 'warmup' ? { ...b, items: b.items.slice(0, 1), game: false } : b);
    session = { ...session, blocks };
    adjustments.push('mini');
  } else {
    const before = blocks.reduce((a, b) => a + blockSeconds(b), 0);
    if (before > want * 60) { session = fit(session, want); adjustments.push('short'); }
  }
  const minutes = Math.max(1, Math.round(session.blocks.reduce((a, b) => a + blockSeconds(b), 0) / 60));
  return { date, sessionId: id, restDay: !id, focus: tpl.focus, blocks: session.blocks, minutes, intensity: low ? 'low' : 'normal', adjustments, skipped, notes };
}

/** Moves for the safe circuit, in the order they are tried: standing ones first, then floor ones; count-only and time-only
 *  moves (the form coach counts them, the progression does not need them). `allowed` with the pain areas strict leaves
 *  out every move that loads a sore area at all, and the jumping ones. */
export const SAFE_CIRCUIT: readonly FormMoveId[] = ['marching', 'calfRaise', 'armCircles', 'wallAngel', 'deadBug', 'superman', 'sidePlank', 'singleLegBridge', 'reverseCrunch', 'toeTouch', 'hollowHold', 'crunch', 'flutterKicks'];
/** Stretches for the cool-down of a pain day, tried in this order. */
export const SAFE_STRETCH: readonly FormMoveId[] = ['hamstringStretch', 'chestStretch', 'shoulderStretch', 'neckStretch', 'figureFour', 'butterflyStretch', 'childsPose'];

/**
 * A pain day's plan made up to `budgetS` seconds with moves that spare the sore area: one set more on each main move that
 * stays (not on a low day, at most the goal's top number of sets plus one), then a circuit of up to five safe moves (30 s
 * on, 15 s off; as many rounds as fit, one to six), then up to two safe stretches in the cool-down. Null when nothing
 * could be added (every move loads the area, or the plan already fills the time).
 */
export function fillPainDay(blocks: readonly Block[], spare: ProgramInput, budgetS: number, low: boolean): Block[] | null {
  const out: Block[] = blocks.map((b) => ({ ...b, items: b.items.map((p) => ({ ...p, range: [...p.range] as [number, number] })) }));
  const total = (): number => out.reduce((a, b) => a + blockSeconds(b), 0);
  const start = total();
  if (budgetS - start < 120) return null;
  const used = new Set(out.flatMap((b) => b.items.map((p) => p.move)));
  // 1. one set more on the main moves that stayed
  const main = out.find((b) => b.kind === 'main');
  if (main && !low) {
    const cap = RX[spare.goal].sets[1] + 1;
    for (const p of main.items) {
      const one = blockSeconds({ kind: 'main', items: [{ ...p, sets: 1 }] }) - 20 + p.restS;
      if (p.sets < cap && total() + one <= budgetS) p.sets++;
    }
  }
  // 2. the safe circuit
  const moves = SAFE_CIRCUIT.filter((m) => !used.has(m) && MOVE_META[m] && !MOVE_META[m].impact && allowed(m, spare)).slice(0, 5);
  if (moves.length) {
    const workS = 30, restS = 15;
    const round = moves.length * (workS + restS);
    const rounds = Math.max(1, Math.min(6, Math.floor((budgetS - total()) / round)));
    if (budgetS - total() >= round * 0.75) {
      const circuit: Block = { kind: 'conditioning', safe: true, rounds, workS, restS, items: moves.map((m) => ({ move: m, sets: 1, target: workS, range: [workS, workS + 10] as [number, number], unit: 'seconds' as const, restS })) };
      const at = out.findIndex((b) => b.kind === 'cooldown');
      out.splice(at < 0 ? out.length : at, 0, circuit);
      for (const m of moves) used.add(m);
    }
  }
  // 3. safe stretches in the cool-down
  let cool = out.find((b) => b.kind === 'cooldown');
  if (!cool) { cool = { kind: 'cooldown', items: [] }; out.push(cool); }
  let added = 0;
  for (const m of SAFE_STRETCH) {
    if (added >= 2 || budgetS - total() < 30) break;
    if (used.has(m) || !MOVE_META[m] || !allowed(m, spare)) continue;
    cool.items.push({ move: m, sets: 1, target: 30, range: [30, 45], unit: MOVE_META[m].unit, restS: 0 });
    used.add(m); added++;
  }
  return total() > start ? out.filter((b) => b.kind !== 'cooldown' || b.items.length > 0) : null;
}
