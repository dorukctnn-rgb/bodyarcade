// The 30-second daily check-in and today's plan: the program engine's one door for the other screens (Today panel, kol F).
//   getTodayPlan({ program, date, checkin, states, week }) -> TodayPlan
// Five answers (sleep, energy 1-5, tiredness or pain, minutes today, priority) adapt today's session by fixed rules:
//   less time        -> a shorter plan (conditioning first, then sets, then moves; under 10 minutes a mini plan);
//   low energy/sleep -> lower intensity (one set less, the bottom of the range, no jumping, longer rests);
//   marked pain      -> the moves that load that area are left out today, with the note "if the pain goes on, ask a health
//                       professional" (a code here; no diagnosis, no treatment advice);
//   priority         -> strength drops the conditioning, cardio adds it, mobility swaps in the mobility session.
// Codes and numbers only; the page words them.
import type { FormMoveId } from '../../form/types.ts';
import { allowed, blockSeconds, fit, generateProgram, pickMove, type Block, type Prescription, type Program, type SessionTemplate, type Weekday } from './generate.ts';
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

export type Adjustment = 'short' | 'mini' | 'low-energy' | 'poor-sleep' | 'tired' | 'pain-skip' | 'priority-strength' | 'priority-cardio' | 'priority-mobility' | 'deload' | 'rest-day';
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

  // time
  let session: SessionTemplate = { ...tpl, blocks };
  const want = c?.minutes ?? program.input.minutes;
  if (want < 10) {
    const mm = main();
    blocks = blocks.filter((b) => b.kind !== 'conditioning').map((b) => b.kind === 'main' ? { ...b, items: b.items.slice(0, 2).map((p) => ({ ...p, sets: 1 })) } : b.kind === 'warmup' ? { ...b, items: b.items.slice(0, 1), game: false } : b);
    void mm;
    session = { ...session, blocks };
    adjustments.push('mini');
  } else {
    const before = blocks.reduce((a, b) => a + blockSeconds(b), 0);
    if (before > want * 60) { session = fit(session, want); adjustments.push('short'); }
  }
  const minutes = Math.max(1, Math.round(session.blocks.reduce((a, b) => a + blockSeconds(b), 0) / 60));
  return { date, sessionId: id, restDay: !id, focus: tpl.focus, blocks: session.blocks, minutes, intensity: low ? 'low' : 'normal', adjustments, skipped, notes };
}
