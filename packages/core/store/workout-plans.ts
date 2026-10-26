// Workout plans: ready sequences of games with a rest between them (BUILD-PLAN, extras of 24 Oct). A plan is data: which
// games, in which order, how hard, how long to rest. Everything else is worked out from the catalogue as it is now.
//
//   Pro, with ONE free plan (the desk break). Which plans may be started is the feature `plan:<id>` of the entitlements; the
//   free one is named in FREE_PLAN_ID and the entitlements read it from here, so the data and the rule cannot drift apart.
//   Seated versions: every step is played in the seated version when the player sits. The desk break is always seated (that is
//   what it is for); the gentle 60+ plan starts seated and the player may stand; the others follow the player's setting. A
//   game with no seated version is swapped for the step's `seatedAlt`, or left out and said so (never played standing for
//   somebody who asked to sit).
//   Length: worked out from the games' own durations plus the rests, never written in by hand, so it is true as the games change.
//   The free plan holds free games only, the plans for children and for people over 60 hold low-impact games only; a test
//   reads the real manifests and says which plan to change when a game is moved.
//
// What is kept: the run that is going (so a page that is reloaded in the middle goes on at the next step, the same day only)
// and the days on which each plan was done (dayset.ts), which two devices merge as a union.
import type { LocalizedString } from '../types/index.ts';
import { addDays, type Day } from './date.ts';
import { EMPTY_DAYS, countDays, daySetParser, dropAfter, lastDay, mergeDays, pruneDays, sameDays, withDay, type DaySet } from './dayset.ts';
import { BAD, p, schemaOf, type Parser } from './schema.ts';
import type { BodyArcadeStore } from './store.ts';

export type WorkoutPlanId = 'desk-break' | 'full-body' | 'legs-day' | 'kids-break' | 'easy-60';
export type StepDifficulty = 'easy' | 'normal' | 'hard';
export type PlanSeating = 'always' | 'default' | 'follow';
export type PlanAudience = 'desk' | 'everyone' | 'kids' | 'seniors';

/** The one plan that is free. The entitlements make `plan:<this id>` a free feature. */
export const FREE_PLAN_ID: WorkoutPlanId = 'desk-break';

export interface PlanStep {
  /** A game of the catalogue (its manifest id). */
  game: string;
  /** Free players have Easy and Normal; Hard is for Pro. */
  difficulty: StepDifficulty;
  /** Seconds to rest after this step (the last step has no rest). */
  restSec: number;
  /** What to play instead when the player sits and `game` has no seated version. */
  seatedAlt?: string;
}

export interface WorkoutPlan {
  id: WorkoutPlanId;
  title: LocalizedString;
  blurb: LocalizedString;
  audience: PlanAudience;
  seating: PlanSeating;
  steps: readonly PlanStep[];
}

const T = (en: string, tr: string, de: string, es: string, fr: string): Record<string, string> => ({ en, tr, de, es, fr });

export const WORKOUT_PLANS: readonly WorkoutPlan[] = [
  {
    id: 'desk-break',
    title: T('Desk break', 'Masa molası', 'Schreibtischpause', 'Pausa en la mesa', 'Pause au bureau'),
    blurb: T(
      'Two seated games for shoulders, back and waist. No space needed, no sweat.',
      'Omuzlar, sırt ve bel için oturarak iki oyun. Yer gerekmez, terletmez.',
      'Zwei Spiele im Sitzen für Schultern, Rücken und Taille. Kein Platz nötig, kein Schwitzen.',
      'Dos juegos sentado para hombros, espalda y cintura. Sin espacio, sin sudar.',
      'Deux jeux assis pour les épaules, le dos et la taille. Pas de place à prévoir, pas de sueur.',
    ),
    audience: 'desk',
    seating: 'always',
    steps: [
      { game: 'twist-turbine', difficulty: 'easy', restSec: 10 },
      { game: 'star-catch', difficulty: 'easy', restSec: 0 },
    ],
  },
  {
    id: 'full-body',
    title: T('Full body', 'Tüm vücut', 'Ganzer Körper', 'Cuerpo entero', 'Corps entier'),
    blurb: T(
      'Cardio, legs and waist in three games, with a short rest between them.',
      'Üç oyunda kardiyo, bacak ve bel; aralarda kısa dinlenme.',
      'Ausdauer, Beine und Taille in drei Spielen, dazwischen kurze Pausen.',
      'Cardio, piernas y cintura en tres juegos, con un descanso corto entre ellos.',
      'Cardio, jambes et taille en trois jeux, avec un court repos entre chacun.',
    ),
    audience: 'everyone',
    seating: 'follow',
    steps: [
      { game: 'firework-jacks', difficulty: 'normal', restSec: 20 },
      { game: 'squat-flap', difficulty: 'normal', restSec: 20 },
      { game: 'twist-turbine', difficulty: 'easy', restSec: 0 },
    ],
  },
  {
    id: 'legs-day',
    title: T('Legs day', 'Bacak günü', 'Beintag', 'Día de piernas', 'Jour des jambes'),
    blurb: T(
      'Warm up, squat, sprint, stretch.',
      'Isınma, çömelme, sprint, esneme.',
      'Aufwärmen, Kniebeugen, Sprint, Dehnen.',
      'Calentar, sentadillas, sprint, estirar.',
      'Échauffement, squats, sprint, étirements.',
    ),
    audience: 'everyone',
    seating: 'follow',
    steps: [
      { game: 'knee-sprint', difficulty: 'easy', restSec: 15 },
      { game: 'squat-flap', difficulty: 'normal', restSec: 15 },
      { game: 'road-run', difficulty: 'normal', restSec: 15 },
      { game: 'pose-wall', difficulty: 'easy', restSec: 0 },
    ],
  },
  {
    id: 'kids-break',
    title: T('Kids active break', 'Çocuklar için hareket arası', 'Bewegungspause für Kinder', 'Pausa activa para niños', 'Pause active pour enfants'),
    blurb: T(
      'Three short games with no jumping, for a break between lessons.',
      'Ders aralarına üç kısa oyun; zıplama yok.',
      'Drei kurze Spiele ohne Springen, für die Pause zwischen den Lektionen.',
      'Tres juegos cortos sin saltos, para el descanso entre clases.',
      'Trois jeux courts sans sauts, pour la pause entre les cours.',
    ),
    audience: 'kids',
    seating: 'follow',
    steps: [
      { game: 'star-catch', difficulty: 'easy', restSec: 10 },
      { game: 'reaction-tag', difficulty: 'easy', restSec: 10 },
      { game: 'limbo-bend', difficulty: 'easy', restSec: 0 },
    ],
  },
  {
    id: 'easy-60',
    title: T('Easy 60+', 'Rahat 60+', 'Sanft 60+', 'Suave 60+', 'Doux 60+'),
    blurb: T(
      'Slow, low impact moves. Starts seated; stand up whenever you feel steady.',
      'Yavaş, düşük etkili hareketler. Oturarak başlar; kendini dengede hissedince ayağa kalkabilirsin.',
      'Langsame Bewegungen ohne Belastung. Beginnt im Sitzen; steh auf, wenn du dich sicher fühlst.',
      'Movimientos lentos y de bajo impacto. Empieza sentado; ponte de pie cuando te sientas seguro.',
      'Mouvements lents et sans impact. Commence assis ; lève-toi quand tu te sens stable.',
    ),
    audience: 'seniors',
    seating: 'default',
    steps: [
      { game: 'pose-wall', difficulty: 'easy', restSec: 30 },
      { game: 'twist-turbine', difficulty: 'easy', restSec: 30 },
      { game: 'star-catch', difficulty: 'easy', restSec: 0 },
    ],
  },
];

export const WORKOUT_PLAN_IDS: readonly WorkoutPlanId[] = WORKOUT_PLANS.map((x) => x.id);
export const isWorkoutPlanId = (x: unknown): x is WorkoutPlanId => typeof x === 'string' && (WORKOUT_PLAN_IDS as readonly string[]).includes(x);
export const planById = (id: unknown): WorkoutPlan | null => WORKOUT_PLANS.find((x) => x.id === id) ?? null;

/** The feature name the entitlements decide on. */
export const planFeature = (id: string): string => `plan:${id}`;

// ───────── resolving a plan against the catalogue ─────────

/** What a plan needs to know of a game: the manifest's own fields. */
export interface PlanGame {
  id: string;
  free: boolean;
  seated: boolean;
  lowImpact: boolean;
  /** Seconds one round lasts. */
  durationSec: number;
}

export interface ResolvedStep {
  index: number;
  game: string;
  difficulty: StepDifficulty;
  /** Played in the seated version. */
  seated: boolean;
  /** The step's own game was replaced by its seated alternative. */
  swapped: boolean;
  restSec: number;
  durationSec: number;
  free: boolean;
  lowImpact: boolean;
}

export interface SkippedStep { game: string; reason: 'unknown-game' | 'no-seated-version' }

export interface ResolvedPlan {
  id: WorkoutPlanId;
  steps: ResolvedStep[];
  /** Games only, seconds. */
  playSec: number;
  /** Games and the rests between them, seconds. */
  totalSec: number;
  /** totalSec in whole minutes, never less than one for a plan that has a step. */
  minutes: number;
  seated: boolean;
  /** Every step is a low-impact game. */
  lowImpact: boolean;
  /** Every step is a free game. */
  allFree: boolean;
  /** Steps that could not be built: the plan runs without them. */
  skipped: SkippedStep[];
  /** Nothing was left out. */
  complete: boolean;
  /** At least one step is left. */
  playable: boolean;
}

/** Whether the plan is played seated, given what the player said (null: nothing said yet). */
export function seatedFor(plan: WorkoutPlan, preference: boolean | null | undefined): boolean {
  if (plan.seating === 'always') return true;
  if (plan.seating === 'default') return preference ?? true;
  return preference ?? false;
}

export function resolvePlan(plan: WorkoutPlan, catalog: readonly PlanGame[], o: { seated?: boolean | null } = {}): ResolvedPlan {
  const seated = seatedFor(plan, o.seated);
  const byId = new Map(catalog.map((g) => [g.id, g] as const));
  const steps: ResolvedStep[] = [];
  const skipped: SkippedStep[] = [];
  for (const s of plan.steps) {
    let game = byId.get(s.game);
    let swapped = false;
    if (!game) { skipped.push({ game: s.game, reason: 'unknown-game' }); continue; }
    if (seated && !game.seated) {
      const alt = s.seatedAlt === undefined ? undefined : byId.get(s.seatedAlt);
      if (!alt || !alt.seated) { skipped.push({ game: s.game, reason: 'no-seated-version' }); continue; }
      game = alt;
      swapped = true;
    }
    steps.push({
      index: steps.length, game: game.id, difficulty: s.difficulty, seated, swapped, restSec: s.restSec,
      durationSec: Number.isFinite(game.durationSec) ? Math.max(0, Math.round(game.durationSec)) : 0, free: game.free, lowImpact: game.lowImpact,
    });
  }
  const last = steps.at(-1);
  if (last) last.restSec = 0;                                   // after a step that was left out the rest of the one before it goes too
  const playSec = steps.reduce((n, s) => n + s.durationSec, 0);
  const totalSec = playSec + steps.reduce((n, s) => n + s.restSec, 0);
  return {
    id: plan.id,
    steps,
    playSec,
    totalSec,
    minutes: steps.length === 0 ? 0 : Math.max(1, Math.round(totalSec / 60)),
    seated,
    lowImpact: steps.length > 0 && steps.every((s) => s.lowImpact),
    allFree: steps.every((s) => s.free),
    skipped,
    complete: skipped.length === 0,
    playable: steps.length > 0,
  };
}

// ───────── what the screens list ─────────

export interface PlanCard extends ResolvedPlan {
  plan: WorkoutPlan;
  free: boolean;
  /** The player may not start it: it is Pro, or one of its games is not theirs to play. */
  locked: boolean;
  /** Days of the last seven (today included) on which it was done. */
  doneThisWeek: number;
  /** Days it was done in the months that are kept. */
  doneDays: number;
  lastDone: Day | null;
}

// ───────── a run of a plan ─────────

export interface PlanStepResult { game: string; score: number; seconds: number; skipped: boolean }

export interface PlanRun {
  plan: WorkoutPlanId;
  day: Day;
  startedAt: number;
  seated: boolean;
  steps: ResolvedStep[];
  /** The step to play next. */
  index: number;
  results: PlanStepResult[];
}

export interface PlanRunView {
  plan: WorkoutPlan;
  run: PlanRun;
  /** The step to play now, or null once the plan is over. */
  current: ResolvedStep | null;
  next: ResolvedStep | null;
  /** How long to rest before the current step (the rest that came after the step before it). */
  restSec: number;
  /** 1-based number of the current step, and how many there are. */
  number: number;
  total: number;
  /** Seconds that are left to play and rest, from the games' lengths. */
  remainingSec: number;
}

export type StartResult =
  | { ok: true; view: PlanRunView }
  | { ok: false; code: 'unknown' | 'locked' | 'empty' };

export interface PlanProgress {
  /** The plan is over (every step was played or skipped). */
  over: boolean;
  /** It was done: at least half of its steps were played, so the day counts for the plan. */
  done: boolean;
  played: number;
  skipped: number;
  seconds: number;
  /** The run as it stands (null once it is over or when there was none). */
  view: PlanRunView | null;
}

/** The part of the record that two devices exchange: for each plan, the days it was done. */
export interface PlansDoc { v: 1; done: Readonly<Record<string, DaySet>> }

export interface PlanBookOptions {
  /** The games of the catalogue right now. */
  games: () => readonly PlanGame[];
  /** The entitlements' can(): features 'plan:<id>' and 'game:<id>'. */
  can: (feature: string) => boolean;
  /** The seated setting of the player, when there is one (null: none yet). */
  seated?: () => boolean | null;
}

export interface PlanBook {
  /** Every plan as a card, in the order of WORKOUT_PLANS. */
  list(): PlanCard[];
  card(id: string): PlanCard | null;
  start(id: string): StartResult;
  /** The run that is going, if it began today (a run does not outlive its day). */
  active(): PlanRunView | null;
  /** The step that is being played has ended with this result: moves on. */
  finishStep(r: { score: number; seconds: number }): PlanProgress;
  /** The player leaves out the step that is next: moves on. */
  skipStep(): PlanProgress;
  abandon(): void;
  doc(): PlansDoc;
  merge(remote: unknown): boolean;
}

// ───────── the stored part ─────────

export const PLAN_KEEP_MONTHS = 14;
const MAX_SCORE = 1_000_000_000;
const stepP = p.object({
  index: p.number({ int: true, min: 0, max: 40 }),
  game: p.string({ pattern: /^[a-z0-9][a-z0-9-]{0,39}$/ }),
  difficulty: p.oneOf(['easy', 'normal', 'hard'] as const),
  seated: p.boolean(),
  swapped: p.withDefault(p.boolean(), false),
  restSec: p.number({ int: true, min: 0, max: 600 }),
  durationSec: p.number({ int: true, min: 0, max: 7200 }),
  free: p.boolean(),
  lowImpact: p.boolean(),
});
const resultP = p.object({
  game: p.string({ pattern: /^[a-z0-9][a-z0-9-]{0,39}$/ }),
  score: p.number({ min: 0, max: MAX_SCORE }),
  seconds: p.number({ min: 0, max: 86_400 }),
  skipped: p.boolean(),
});
const runP = p.nullable(p.object({
  plan: p.oneOf(WORKOUT_PLAN_IDS),
  day: p.day(),
  startedAt: p.epoch(),
  seated: p.boolean(),
  steps: p.array(stepP, { max: 12 }),
  index: p.number({ int: true, min: 0, max: 12 }),
  results: p.array(resultP, { max: 12 }),
}));
const runParser: Parser<PlanRun | null> = (raw) => {
  const r = runP(raw);
  if (r === BAD) return BAD;
  if (r === null) return null;
  // A run that does not add up (its steps do not match its place in them) is not trusted.
  if (r.steps.length === 0 || r.index > r.steps.length || r.results.length !== r.index || r.steps.some((st, i) => st.index !== i)) return BAD;
  return r as PlanRun;
};
const RunSchema = schemaOf<PlanRun | null>(1, runParser);

const DoneSchema = schemaOf<Record<string, DaySet>>(1, p.record(daySetParser(PLAN_KEEP_MONTHS + 2), { max: 24, key: /^[a-z0-9][a-z0-9-]{0,39}$/, lenient: true }));

const docParser: Parser<PlansDoc> = p.object({
  v: p.literal(1),
  done: p.withDefault(p.record(daySetParser(PLAN_KEEP_MONTHS + 2), { max: 24, key: /^[a-z0-9][a-z0-9-]{0,39}$/, lenient: true }), () => ({})),
}) as Parser<PlansDoc>;

export const emptyPlansDoc = (): PlansDoc => ({ v: 1, done: {} });

export function readPlansDoc(raw: unknown): PlansDoc | null {
  const r = docParser(raw);
  return typeof r === 'symbol' ? null : { v: 1, done: r.done };
}

/** The documents a synced document may hold: 3,000 characters. Months are dropped, oldest first, until it fits. */
export const PLANS_DOC_BUDGET = 2800;

/** For each plan the union of the days of both, the newest `keep` months of each. */
function unionDone(a: Readonly<Record<string, DaySet>>, b: Readonly<Record<string, DaySet>>, keep: number): Record<string, DaySet> {
  const out: Record<string, DaySet> = {};
  for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const merged = pruneDays(mergeDays(a[id] ?? EMPTY_DAYS, b[id] ?? EMPTY_DAYS), keep);
    if (Object.keys(merged).length > 0) out[id] = merged;
  }
  return out;
}

/** The union of two documents, cut to fit a synced document (oldest months go first). Commutative, associative and idempotent. */
export function mergePlansDocs(x: PlansDoc, y: PlansDoc): PlansDoc {
  for (let keep = PLAN_KEEP_MONTHS; ; keep--) {
    const done = unionDone(x.done, y.done, keep);
    if (keep <= 1 || JSON.stringify({ v: 1, done }).length <= PLANS_DOC_BUDGET) return { v: 1, done };
  }
}

export function createPlanBook(store: BodyArcadeStore, o: PlanBookOptions): PlanBook {
  const ns = store.ns('plans');
  const runSlot = ns.slot<PlanRun | null>('run', RunSchema, null);
  const doneSlot = ns.slot<Record<string, DaySet>>('done', DoneSchema, () => ({}));
  const games = (): readonly PlanGame[] => {
    try { return o.games(); } catch { return []; }
  };
  const preference = (): boolean | null => {
    try { return o.seated?.() ?? null; } catch { return null; }
  };
  const can = (feature: string): boolean => {
    try { return o.can(feature) === true; } catch { return false; }
  };
  const horizon = (): Day => addDays(store.day(), 1);

  /** The plan may be started: it is the player's by the entitlements, and so is every game it asks them to play. */
  const lockedFor = (r: ResolvedPlan): boolean => !can(planFeature(r.id)) || r.steps.some((s) => !s.free && !can(`game:${s.game}`));

  function cardOf(plan: WorkoutPlan): PlanCard {
    const r = resolvePlan(plan, games(), { seated: preference() });
    const days = doneSlot.get()[plan.id] ?? EMPTY_DAYS;
    const today = store.day();
    return {
      ...r, plan, free: plan.id === FREE_PLAN_ID, locked: lockedFor(r),
      doneThisWeek: countDays(days, addDays(today, -6), today),
      doneDays: Object.values(days).reduce((n, bits) => n + bitCount(bits), 0),
      lastDone: lastDay(dropAfter(days, today)),
    };
  }

  function viewOf(run: PlanRun): PlanRunView | null {
    const plan = planById(run.plan);
    if (!plan) return null;
    const current = run.steps[run.index] ?? null;
    const left = run.steps.slice(run.index);
    return {
      plan, run, current, next: run.steps[run.index + 1] ?? null,
      restSec: run.index > 0 ? (run.steps[run.index - 1] as ResolvedStep).restSec : 0,
      number: Math.min(run.index + 1, run.steps.length), total: run.steps.length,
      remainingSec: left.reduce((n, s) => n + s.durationSec + s.restSec, 0),
    };
  }

  function active(): PlanRunView | null {
    const run = runSlot.get();
    if (!run) return null;
    if (run.day !== store.day() || run.index >= run.steps.length) { runSlot.remove(); return null; }
    return viewOf(run);
  }

  function advance(make: (step: ResolvedStep) => PlanStepResult): PlanProgress {
    const run = runSlot.get();
    const view = active();
    if (!run || !view || !view.current) return { over: false, done: false, played: 0, skipped: 0, seconds: 0, view: null };
    const next: PlanRun = { ...run, index: run.index + 1, results: [...run.results, make(view.current)] };
    const played = next.results.filter((r) => !r.skipped).length;
    const skipped = next.results.length - played;
    const seconds = next.results.reduce((n, r) => n + r.seconds, 0);
    if (next.index < next.steps.length) {
      runSlot.set(next);
      return { over: false, done: false, played, skipped, seconds, view: viewOf(next) };
    }
    runSlot.remove();
    const done = played >= Math.ceil(next.steps.length / 2);
    if (done) {
      const all = doneSlot.get();
      doneSlot.set({ ...all, [next.plan]: pruneDays(withDay(all[next.plan] ?? EMPTY_DAYS, next.day), PLAN_KEEP_MONTHS) });
    }
    return { over: true, done, played, skipped, seconds, view: null };
  }

  const num = (x: unknown, max: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : 0);

  return {
    list: () => WORKOUT_PLANS.map(cardOf),
    card: (id) => { const plan = planById(id); return plan ? cardOf(plan) : null; },

    start(id) {
      const plan = planById(id);
      if (!plan) return { ok: false, code: 'unknown' };
      const resolved = resolvePlan(plan, games(), { seated: preference() });
      if (!resolved.playable) return { ok: false, code: 'empty' };
      if (lockedFor(resolved)) return { ok: false, code: 'locked' };
      const run: PlanRun = { plan: plan.id, day: store.day(), startedAt: store.now(), seated: resolved.seated, steps: resolved.steps, index: 0, results: [] };
      runSlot.set(run);
      return { ok: true, view: viewOf(run) as PlanRunView };
    },

    active,

    finishStep: (r) => advance((step) => ({ game: step.game, score: Math.round(num(r?.score, MAX_SCORE)), seconds: num(r?.seconds, 86_400), skipped: false })),
    skipStep: () => advance((step) => ({ game: step.game, score: 0, seconds: 0, skipped: true })),
    abandon: () => { runSlot.remove(); },

    doc() {
      const h = horizon();
      const done: Record<string, DaySet> = {};
      for (const [id, days] of Object.entries(doneSlot.get())) {
        const kept = dropAfter(days, h);
        if (Object.keys(kept).length > 0) done[id] = kept;
      }
      return mergePlansDocs({ v: 1, done }, emptyPlansDoc());       // cut to what a synced document may hold
    },

    merge(remote) {
      const doc = readPlansDoc(remote);
      if (!doc) return false;
      const h = horizon();
      const own = doneSlot.get();
      const incoming: Record<string, DaySet> = {};
      for (const [id, days] of Object.entries(doc.done)) {
        if (isWorkoutPlanId(id)) incoming[id] = dropAfter(days, h);       // a plan this build does not know is not kept
      }
      const merged = unionDone(own, incoming, PLAN_KEEP_MONTHS);          // what is kept here is not cut to the document's budget
      const ids = new Set([...Object.keys(own), ...Object.keys(merged)]);
      const changed = [...ids].some((id) => !sameDays(own[id] ?? EMPTY_DAYS, merged[id] ?? EMPTY_DAYS));
      if (changed) doneSlot.set(merged);
      return changed;
    },
  };
}

function bitCount(n: number): number {
  let c = 0;
  for (let x = n >>> 0; x !== 0; x &= x - 1) c++;
  return c;
}

