// The program builder (SPEC 3.1-3.3): rule based and explainable. From the goal, level, equipment, days, minutes and the
// avoid list it builds a week of sessions from the form coach's catalogue. The main block takes only moves the form coach
// measures (labels F and H); count-only and time-only moves (S, T) go to the warm-up, conditioning and cool-down. A move not
// yet measured on real video is left out unless `allowUnchecked` (development only). Codes and numbers only.
import { FORM_MOVES, FORM_MOVE_IDS, REAL_VIDEO_CHECKED } from '../../form/moves/index.ts';
import type { FormMoveId } from '../../form/types.ts';
import { MOVE_META, type Area, type MoveMeta, type Pattern } from './moves-meta.ts';

export type Goal = 'strength' | 'conditioning' | 'general' | 'mobility';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Equip = 'chair' | 'wall' | 'step' | 'dumbbell';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ProgramInput {
  goal: Goal;
  level: Level;
  equipment: readonly Equip[];
  /** dumbbell weights at hand, kg (a pair of each) */
  dumbbellsKg?: readonly number[];
  days: readonly Weekday[];
  minutes: 15 | 20 | 30 | 45 | 60;
  avoid?: { areas?: readonly Area[]; noJumping?: boolean; noFloor?: boolean; noBalance?: boolean; strict?: boolean };
  /** a BodyArcade game as warm-up / conditioning */
  gameBlock?: boolean;
  allowUnchecked?: boolean;
  /** under 18: level at most intermediate, no high jumps (SPEC 4.2 rule 1) */
  minor?: boolean;
}

export interface Prescription {
  move: FormMoveId;
  sets: number;
  /** target per set: repetitions (per side for one-sided moves) or seconds */
  target: number;
  range: [number, number];
  unit: 'reps' | 'seconds';
  restS: number;
  loadKg?: number;
}

export type BlockKind = 'warmup' | 'main' | 'conditioning' | 'cooldown';
export interface Block { kind: BlockKind; items: Prescription[]; game?: boolean; rounds?: number; workS?: number; restS?: number }
export interface SessionTemplate { id: string; focus: 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'legs' | 'conditioning' | 'mobility'; blocks: Block[]; minutes: number }
export interface Program { input: ProgramInput; sessions: SessionTemplate[]; schedule: Partial<Record<Weekday, string>>; deloadEvery: number; missingPatterns: Pattern[] }

export const RX: Record<Goal, { sets: [number, number]; bw: [number, number]; db: [number, number]; rest: [number, number] }> = {
  strength: { sets: [3, 4], bw: [8, 20], db: [6, 12], rest: [60, 120] },
  conditioning: { sets: [2, 3], bw: [12, 20], db: [12, 20], rest: [20, 45] },
  general: { sets: [2, 3], bw: [8, 15], db: [8, 15], rest: [45, 90] },
  mobility: { sets: [1, 2], bw: [30, 45], db: [30, 45], rest: [15, 15] },
};

const LEVEL_DIFF: Record<Level, number> = { beginner: 2, intermediate: 3, advanced: 5 };

/** Can this move be used with this input at all? */
export function allowed(id: FormMoveId, i: ProgramInput): boolean {
  const def = FORM_MOVES[id], m = MOVE_META[id];
  if (!m) return false;
  if (!i.allowUnchecked && !REAL_VIDEO_CHECKED[id] && (def.label === 'F' || def.label === 'H')) return false;
  if (def.equipment?.some((e) => !i.equipment.includes(e))) return false;
  const a = i.avoid ?? {};
  for (const area of a.areas ?? []) { const l = m.load[area] ?? 0; if (l >= 2 || (a.strict && l >= 1)) return false; }
  if ((a.noJumping || i.minor) && m.impact && (i.minor ? m.difficulty >= 4 : true)) return false;
  if (a.noJumping && m.impact) return false;
  if (a.noFloor && m.floor) return false;
  if (a.noBalance && m.balance) return false;
  return true;
}

const isMain = (id: FormMoveId): boolean => FORM_MOVES[id].label === 'F' || FORM_MOVES[id].label === 'H';

/** The best main move for a pattern at a level: the hardest allowed one not above the level's difficulty. */
export function pickMove(pattern: Pattern, i: ProgramInput, used: ReadonlySet<FormMoveId> = new Set()): FormMoveId | null {
  const cap = Math.min(LEVEL_DIFF[i.minor ? (i.level === 'advanced' ? 'intermediate' : i.level) : i.level], 5);
  const cands = FORM_MOVE_IDS.filter((id) => MOVE_META[id]?.pattern === pattern && isMain(id) && allowed(id, i) && !used.has(id));
  if (!cands.length) return null;
  const under = cands.filter((id) => MOVE_META[id].difficulty <= cap);
  const pool = under.length ? under : cands;
  return pool.sort((a, b) => MOVE_META[b].difficulty - MOVE_META[a].difficulty || a.localeCompare(b))[0]!;
}

function prescribe(id: FormMoveId, i: ProgramInput, setsAdj = 0): Prescription {
  const m: MoveMeta = MOVE_META[id];
  const rx = RX[i.goal];
  const db = FORM_MOVES[id].equipment?.includes('dumbbell') ?? false;
  const held = m.unit === 'seconds';
  const range: [number, number] = held ? (i.goal === 'mobility' ? [30, 45] : [20, 60]) : db ? rx.db : rx.bw;
  const sets = Math.max(1, (i.level === 'beginner' ? rx.sets[0] : rx.sets[1]) + setsAdj);
  const restS = i.level === 'advanced' ? rx.rest[1] : i.level === 'intermediate' ? Math.round((rx.rest[0] + rx.rest[1]) / 2) : rx.rest[0];
  const p: Prescription = { move: id, sets, target: range[0], range, unit: m.unit, restS };
  if (db) { const w = [...(i.dumbbellsKg ?? [])].sort((a, b) => a - b); if (w.length) p.loadKg = w[0]!; }
  return p;
}

/** Seconds one prescription takes. */
export function secondsOf(p: Prescription): number {
  const m = MOVE_META[p.move];
  const work = p.unit === 'seconds' ? p.target : p.target * m.tempoS * (m.perSide ? 2 : 1);
  return p.sets * work + Math.max(0, p.sets - 1) * p.restS + 20;
}
export function blockSeconds(b: Block): number {
  if (b.kind === 'conditioning' && b.rounds && b.workS) return b.rounds * b.items.length * (b.workS + (b.restS ?? 20));
  if (b.kind === 'warmup' || b.kind === 'cooldown') return b.items.reduce((a, p) => a + (p.unit === 'seconds' ? p.target : p.target * MOVE_META[p.move].tempoS * (MOVE_META[p.move].perSide ? 2 : 1)), 0) + (b.game ? 180 : 0);
  return b.items.reduce((a, p) => a + secondsOf(p), 0);
}
export const sessionSeconds = (s: Pick<SessionTemplate, 'blocks'>): number => s.blocks.reduce((a, b) => a + blockSeconds(b), 0);

const FOCUS_PATTERNS: Record<SessionTemplate['focus'], readonly Pattern[]> = {
  full: ['squat', 'pushH', 'hinge', 'lunge', 'pushV', 'pull', 'coreAE'],
  upper: ['pushH', 'pushV', 'pull', 'coreAE'],
  lower: ['squat', 'lunge', 'hinge', 'calf'],
  push: ['pushH', 'pushV', 'coreAE'],
  pull: ['pull', 'hinge', 'coreAE'],
  legs: ['squat', 'lunge', 'hinge', 'calf'],
  conditioning: ['squat', 'lunge'],
  mobility: [],
};

function warmup(i: ProgramInput): Block {
  const items: Prescription[] = [];
  for (const id of ['armCircles', 'marching', 'stepJack'] as FormMoveId[]) if (allowed(id, i)) {
    const m = MOVE_META[id];
    items.push({ move: id, sets: 1, target: m.unit === 'seconds' ? 30 : 20, range: [20, 30], unit: m.unit, restS: 0 });
  }
  return { kind: 'warmup', items, ...(i.gameBlock ? { game: true } : {}) };
}

function cooldown(i: ProgramInput): Block {
  const items: Prescription[] = [];
  for (const id of ['wallAngel', 'inchworm'] as FormMoveId[]) if (allowed(id, i)) items.push({ move: id, sets: 1, target: 6, range: [6, 8], unit: 'reps', restS: 0 });
  return { kind: 'cooldown', items };
}

function conditioning(i: ProgramInput): Block {
  const pool = (['jumpingJack', 'highKnees', 'skater', 'buttKicks', 'stepJack', 'marching'] as FormMoveId[]).filter((id) => allowed(id, i)).slice(0, 3);
  return { kind: 'conditioning', items: pool.map((id) => ({ move: id, sets: 1, target: 30, range: [30, 40], unit: 'seconds' as const, restS: 20 })), rounds: i.goal === 'conditioning' ? 3 : 2, workS: i.goal === 'conditioning' ? 40 : 30, restS: 20, ...(i.gameBlock ? { game: true } : {}) };
}

function mobilitySession(i: ProgramInput, id: string): SessionTemplate {
  const items: Prescription[] = [];
  for (const mv of ['armCircles', 'wallAngel', 'inchworm', 'squatHold', 'cossackSquat', 'calfRaise'] as FormMoveId[]) if (allowed(mv, i)) {
    const m = MOVE_META[mv];
    items.push({ move: mv, sets: 2, target: m.unit === 'seconds' ? 30 : 8, range: m.unit === 'seconds' ? [30, 45] : [6, 10], unit: m.unit, restS: 15 });
  }
  const s: SessionTemplate = { id, focus: 'mobility', blocks: [warmup(i), { kind: 'main', items }, cooldown(i)], minutes: 0 };
  return fit(s, i.minutes);
}

/** Trims a session to its minutes: first the conditioning rounds, then the last main move's sets, then main moves. */
export function fit(s: SessionTemplate, minutes: number): SessionTemplate {
  const budget = minutes * 60;
  const blocks = s.blocks.map((b) => ({ ...b, items: b.items.map((p) => ({ ...p })) }));
  const total = (): number => blocks.reduce((a, b) => a + blockSeconds(b), 0);
  const cond = blocks.find((b) => b.kind === 'conditioning');
  while (total() > budget && cond && (cond.rounds ?? 0) > 1) cond.rounds = (cond.rounds ?? 1) - 1;
  if (total() > budget && cond) blocks.splice(blocks.indexOf(cond), 1);
  const main = blocks.find((b) => b.kind === 'main');
  let guard = 0;
  while (main && total() > budget && guard++ < 50) {
    const last = [...main.items].reverse().find((p) => p.sets > 1);
    if (last && main.items.length <= 2) last.sets--;
    else if (main.items.length > 2) main.items.pop();
    else if (last) last.sets--;
    else break;
  }
  const out = { ...s, blocks };
  out.minutes = Math.max(1, Math.round(total() / 60));
  return out;
}

function session(id: string, focus: SessionTemplate['focus'], i: ProgramInput, variant: 0 | 1, light = false): SessionTemplate {
  if (focus === 'mobility') return mobilitySession(i, id);
  const used = new Set<FormMoveId>();
  const items: Prescription[] = [];
  const patterns = [...FOCUS_PATTERNS[focus]];
  // the B session leads with the second pattern and picks second-best moves where it can, so A and B differ
  if (variant === 1 && patterns.length > 2) patterns.push(patterns.shift()!);
  for (const pat of patterns) {
    let id = pickMove(pat, i, used);
    if (variant === 1 && id) {
      const alt = pickMove(pat, i, new Set([...used, id]));
      if (alt) id = alt;
    }
    if (id) { used.add(id); items.push(prescribe(id, i, light ? -1 : 0)); }
  }
  const blocks: Block[] = [warmup(i), { kind: 'main', items }];
  if (focus === 'conditioning' || i.goal === 'conditioning' || i.minutes >= 30) blocks.push(conditioning(i));
  blocks.push(cooldown(i));
  return fit({ id, focus, blocks, minutes: 0 }, i.minutes);
}

/** Days: the order of the week's sessions (SPEC 3.3 table), heavy days of the same muscles at least 48 h apart. */
export function generateProgram(i: ProgramInput): Program {
  const days = [...new Set(i.days)].sort((a, b) => a - b) as Weekday[];
  const n = Math.max(1, Math.min(6, days.length));
  const db = i.equipment.includes('dumbbell') && (i.dumbbellsKg?.length ?? 0) > 0;
  let plan: [string, SessionTemplate['focus'], 0 | 1, boolean][];
  if (i.goal === 'mobility') plan = days.map((_, k) => [`M${k + 1}`, 'mobility', 0, false]);
  else if (n <= 3) plan = days.map((_, k) => [k % 2 ? 'B' : 'A', 'full', (k % 2) as 0 | 1, false]);
  else if (n === 4) plan = db ? [['U1', 'upper', 0, false], ['L1', 'lower', 0, false], ['U2', 'upper', 1, false], ['L2', 'lower', 1, false]] : [['A', 'full', 0, false], ['B', 'full', 1, true], ['A', 'full', 0, false], ['B', 'full', 1, true]];
  else if (n === 5) plan = [['U', 'upper', 0, false], ['L', 'lower', 0, false], ['C1', 'conditioning', 0, false], ['F', 'full', 1, false], ['M', 'mobility', 0, false]];
  else plan = db ? [['P1', 'push', 0, false], ['Q1', 'pull', 0, false], ['G1', 'legs', 0, false], ['P2', 'push', 1, false], ['Q2', 'pull', 1, false], ['G2', 'legs', 1, false]]
    : [['A', 'full', 0, false], ['C1', 'conditioning', 0, false], ['B', 'full', 1, false], ['M', 'mobility', 0, false], ['A2', 'full', 0, true], ['C2', 'conditioning', 1, false]];
  const sessions = new Map<string, SessionTemplate>();
  const schedule: Partial<Record<Weekday, string>> = {};
  plan.slice(0, days.length).forEach(([id, focus, variant, light], k) => {
    if (!sessions.has(id)) sessions.set(id, session(id, focus, i, variant, light));
    schedule[days[k]!] = id;
  });
  const found = new Set<Pattern>();
  for (const s of sessions.values()) for (const b of s.blocks) if (b.kind === 'main') for (const p of b.items) found.add(MOVE_META[p.move].pattern);
  const wanted: Pattern[] = i.goal === 'mobility' ? [] : ['squat', 'hinge', 'lunge', 'pushH', 'pull', 'coreAE'];
  return { input: i, sessions: [...sessions.values()], schedule, deloadEvery: i.level === 'beginner' ? 6 : 5, missingPatterns: wanted.filter((p) => !found.has(p)) };
}

/** Heavy-day spacing: two days that load the same muscles are at least 48 hours apart (true when the rule holds). */
export function spacingOk(p: Program): boolean {
  const days = (Object.keys(p.schedule).map(Number) as Weekday[]).sort((a, b) => a - b);
  const musclesOf = (id: string): Set<string> => {
    const s = p.sessions.find((x) => x.id === id);
    const out = new Set<string>();
    if (!s || s.focus === 'mobility' || s.focus === 'conditioning') return out;
    for (const b of s.blocks) if (b.kind === 'main') for (const it of b.items) for (const mu of MOVE_META[it.move].muscles) out.add(mu);
    return out;
  };
  for (let a = 0; a < days.length; a++) for (let b = a + 1; b < days.length; b++) {
    const gap = Math.min(days[b]! - days[a]!, 7 - (days[b]! - days[a]!));
    if (gap >= 2) continue;
    const ma = musclesOf(p.schedule[days[a]!]!), mb = musclesOf(p.schedule[days[b]!]!);
    // the light B day of a 4-day bodyweight week may follow (SPEC 3.3: "ikincisi hafif")
    const lightB = p.sessions.find((x) => x.id === p.schedule[days[b]!])?.id.startsWith('B') && p.sessions.length === 2 && days.length === 4;
    if ([...ma].some((m) => mb.has(m)) && !lightB) return false;
  }
  return true;
}

/** "Swap" (SPEC 3.4, the Freeletics complaint): the other main moves of the same pattern this input allows. */
export function alternatives(move: FormMoveId, i: ProgramInput): FormMoveId[] {
  const pat = MOVE_META[move].pattern;
  return FORM_MOVE_IDS.filter((id) => id !== move && MOVE_META[id]?.pattern === pat && isMain(id) && allowed(id, i))
    .sort((a, b) => MOVE_META[a].difficulty - MOVE_META[b].difficulty || a.localeCompare(b));
}

/** Replaces a move everywhere in the program (the change is kept when the week repeats: SPEC 3.4, the Fitbod complaint). */
export function swapInProgram(p: Program, from: FormMoveId, to: FormMoveId): Program {
  const fresh = prescribe(to, p.input);
  return {
    ...p,
    sessions: p.sessions.map((s) => ({ ...s, blocks: s.blocks.map((b) => b.kind !== 'main' ? b : { ...b, items: b.items.map((it) => (it.move === from ? { ...fresh, sets: it.sets } : it)) }) })),
  };
}
