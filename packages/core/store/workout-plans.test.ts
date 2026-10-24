// Workout plans: the data is sound against the real games, the plan is built for the player who sits or stands, a run of a plan
// goes on after a reload, and the days a plan was done merge across devices.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addDays, type Day } from './date.ts';
import { daysOf, withDay, EMPTY_DAYS } from './dayset.ts';
import { createStore, memoryStorage } from './store.ts';
import {
  FREE_PLAN_ID, PLANS_DOC_BUDGET, WORKOUT_PLANS, WORKOUT_PLAN_IDS, createPlanBook, emptyPlansDoc, isWorkoutPlanId, mergePlansDocs, planById, planFeature,
  readPlansDoc, resolvePlan, seatedFor, type PlanBook, type PlanGame, type PlansDoc, type WorkoutPlan,
} from './workout-plans.ts';

// ───────── the real games ─────────

const gamesDir = fileURLToPath(new URL('../../games/', import.meta.url));
const REAL: PlanGame[] = readdirSync(gamesDir)
  .filter((d) => existsSync(`${gamesDir}${d}/manifest.json`))
  .map((d) => JSON.parse(readFileSync(`${gamesDir}${d}/manifest.json`, 'utf8')) as { id: string; free: boolean; seated: boolean; lowImpact: boolean; durationSec: number })
  .map((m) => ({ id: m.id, free: m.free, seated: m.seated, lowImpact: m.lowImpact, durationSec: m.durationSec }));
const real = (id: string): PlanGame | undefined => REAL.find((g) => g.id === id);

describe('the plans as data', () => {
  it('are five, each with its own id, and one of them is the free one', () => {
    expect(WORKOUT_PLAN_IDS).toEqual(['desk-break', 'full-body', 'legs-day', 'kids-break', 'easy-60']);
    expect(new Set(WORKOUT_PLAN_IDS).size).toBe(WORKOUT_PLANS.length);
    expect(isWorkoutPlanId(FREE_PLAN_ID)).toBe(true);
    expect(FREE_PLAN_ID).toBe('desk-break');
    expect(planById('legs-day')?.id).toBe('legs-day');
    expect(planById('made-up')).toBeNull();
    expect(planById(undefined)).toBeNull();
    expect(planFeature('legs-day')).toBe('plan:legs-day');
  });

  it('say their name and what they are in the five languages of the app, in plain words', () => {
    for (const plan of WORKOUT_PLANS) {
      for (const field of [plan.title, plan.blurb] as Record<string, string>[]) {
        expect(Object.keys(field).sort(), plan.id).toEqual(['de', 'en', 'es', 'fr', 'tr']);
        for (const [lang, text] of Object.entries(field)) {
          expect(text.length, `${plan.id} ${lang}`).toBeGreaterThan(3);
          expect(text, `${plan.id} ${lang}`).not.toMatch(/[—–→←]|!!|\p{Extended_Pictographic}/u);   // no dash, arrow or emoji in interface text
          expect(text, `${plan.id} ${lang}`).toBe(text.trim());
        }
      }
      expect((plan.title as Record<string, string>)['en']?.length, plan.id).toBeLessThanOrEqual(28);
      expect((plan.blurb as Record<string, string>)['en']?.length, plan.id).toBeLessThanOrEqual(110);
    }
  });

  it('have two to five steps, a rest between them and none after the last, and nothing harder than Normal for the free plan', () => {
    for (const plan of WORKOUT_PLANS) {
      expect(plan.steps.length, plan.id).toBeGreaterThanOrEqual(2);
      expect(plan.steps.length, plan.id).toBeLessThanOrEqual(5);
      plan.steps.forEach((s, i) => {
        if (i === plan.steps.length - 1) expect(s.restSec, `${plan.id} last`).toBe(0);
        else expect(s.restSec, `${plan.id} ${i}`).toBeGreaterThanOrEqual(5);
        expect(['easy', 'normal', 'hard']).toContain(s.difficulty);
      });
    }
    for (const s of (planById(FREE_PLAN_ID) as WorkoutPlan).steps) expect(['easy', 'normal']).toContain(s.difficulty);
  });

  it('never name the same game twice in a row', () => {
    for (const plan of WORKOUT_PLANS) plan.steps.forEach((s, i) => expect(s.game, `${plan.id} ${i}`).not.toBe(plan.steps[i + 1]?.game));
  });
});

describe('the plans against the games that exist', () => {
  it('find every game they name', () => {
    expect(REAL.length, 'the manifests of packages/games').toBeGreaterThanOrEqual(11);
    for (const plan of WORKOUT_PLANS) for (const s of plan.steps) expect(real(s.game), `${plan.id}: ${s.game} is not a game in packages/games`).toBeDefined();
  });

  it('give a free player the free plan with free games only, so it never stops at a lock', () => {
    const r = resolvePlan(planById(FREE_PLAN_ID) as WorkoutPlan, REAL, {});
    expect(r.complete).toBe(true);
    for (const s of r.steps) expect(real(s.game)?.free, `the free plan has the Pro game ${s.game}: change the plan, or mark the game free`).toBe(true);
    expect(r.allFree).toBe(true);
  });

  it('keep the plan for children and the plan for people over sixty to games with no jumping', () => {
    for (const id of ['kids-break', 'easy-60'] as const) {
      const r = resolvePlan(planById(id) as WorkoutPlan, REAL, {});
      for (const s of r.steps) expect(real(s.game)?.lowImpact, `${id} has ${s.game}, which is no longer a low impact game`).toBe(true);
      expect(r.lowImpact, id).toBe(true);
    }
  });

  it('can be played seated from the first step to the last, in every plan', () => {
    for (const plan of WORKOUT_PLANS) {
      const r = resolvePlan(plan, REAL, { seated: true });
      expect(r.complete, `${plan.id} has a game with no seated version`).toBe(true);
      expect(r.steps.every((s) => s.seated)).toBe(true);
    }
  });

  it('last about as long as a person expects of a break or a workout, from the games\' own lengths', () => {
    const minutes = Object.fromEntries(WORKOUT_PLANS.map((p) => [p.id, resolvePlan(p, REAL, {}).minutes]));
    expect(minutes['desk-break']).toBeGreaterThanOrEqual(4);
    expect(minutes['desk-break']).toBeLessThanOrEqual(8);
    for (const id of ['full-body', 'legs-day', 'kids-break', 'easy-60']) {
      expect(minutes[id], id).toBeGreaterThanOrEqual(8);
      expect(minutes[id], id).toBeLessThanOrEqual(16);
    }
  });
});

describe('resolving a plan', () => {
  const g = (id: string, over: Partial<PlanGame> = {}): PlanGame => ({ id, free: true, seated: true, lowImpact: true, durationSec: 180, ...over });
  const plan = (over: Partial<WorkoutPlan> = {}): WorkoutPlan => ({
    id: 'full-body', title: 't', blurb: 'b', audience: 'everyone', seating: 'follow',
    steps: [{ game: 'a', difficulty: 'normal', restSec: 20 }, { game: 'b', difficulty: 'easy', restSec: 30 }, { game: 'c', difficulty: 'easy', restSec: 0 }], ...over,
  });
  const cat = [g('a', { durationSec: 240 }), g('b'), g('c', { durationSec: 100 })];

  it('adds up the games and the rests, and rounds to whole minutes', () => {
    const r = resolvePlan(plan(), cat, {});
    expect(r.steps.map((s) => s.game)).toEqual(['a', 'b', 'c']);
    expect(r.playSec).toBe(520);
    expect(r.totalSec).toBe(570);
    expect(r.minutes).toBe(10);                                  // 9.5 minutes
    expect(r.steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(r.complete && r.playable).toBe(true);
  });

  it('follows the player\'s seat unless the plan decides: always, by default, or as told', () => {
    const p = (seating: WorkoutPlan['seating']) => plan({ seating });
    expect(seatedFor(p('always'), false)).toBe(true);
    expect(seatedFor(p('always'), null)).toBe(true);
    expect(seatedFor(p('default'), null)).toBe(true);
    expect(seatedFor(p('default'), undefined)).toBe(true);
    expect(seatedFor(p('default'), false)).toBe(false);          // somebody who chose to stand is not made to sit
    expect(seatedFor(p('follow'), null)).toBe(false);
    expect(seatedFor(p('follow'), true)).toBe(true);
    expect(resolvePlan(p('always'), cat, { seated: false }).seated).toBe(true);
  });

  it('swaps a game with no seated version for the step\'s alternative, and says it did', () => {
    const catalog = [g('a', { seated: false }), g('alt', { durationSec: 90 }), g('b'), g('c')];
    const withAlt = plan({ steps: [{ game: 'a', difficulty: 'normal', restSec: 20, seatedAlt: 'alt' }, { game: 'b', difficulty: 'easy', restSec: 0 }] });
    const sitting = resolvePlan(withAlt, catalog, { seated: true });
    expect(sitting.steps.map((s) => [s.game, s.swapped, s.seated])).toEqual([['alt', true, true], ['b', false, true]]);
    expect(sitting.complete).toBe(true);
    const standing = resolvePlan(withAlt, catalog, { seated: false });
    expect(standing.steps.map((s) => [s.game, s.swapped, s.seated])).toEqual([['a', false, false], ['b', false, false]]);
  });

  it('leaves out, and names, a step it cannot play seated, and never plays it standing for somebody who sits', () => {
    const catalog = [g('a', { seated: false }), g('b'), g('c')];
    const r = resolvePlan(plan(), catalog, { seated: true });
    expect(r.steps.map((s) => s.game)).toEqual(['b', 'c']);
    expect(r.skipped).toEqual([{ game: 'a', reason: 'no-seated-version' }]);
    expect(r.complete).toBe(false);
    expect(r.playable).toBe(true);
    const noAlt = resolvePlan(plan({ steps: [{ game: 'a', difficulty: 'easy', restSec: 0, seatedAlt: 'missing' }] }), catalog, { seated: true });
    expect(noAlt.playable).toBe(false);
    const altNotSeated = resolvePlan(plan({ steps: [{ game: 'a', difficulty: 'easy', restSec: 0, seatedAlt: 'a2' }] }), [...catalog, g('a2', { seated: false })], { seated: true });
    expect(altNotSeated.playable).toBe(false);
  });

  it('leaves out a game that is not in this build, and takes the rest after the last step that is left', () => {
    const r = resolvePlan(plan(), [g('a'), g('b')], {});
    expect(r.steps.map((s) => s.game)).toEqual(['a', 'b']);
    expect(r.skipped).toEqual([{ game: 'c', reason: 'unknown-game' }]);
    expect(r.steps.at(-1)?.restSec).toBe(0);
    expect(r.totalSec).toBe(r.playSec + 20);
  });

  it('is not playable with an empty catalogue, and says nothing about minutes', () => {
    const r = resolvePlan(plan(), [], {});
    expect(r).toMatchObject({ playable: false, minutes: 0, totalSec: 0, lowImpact: false, allFree: true });
  });

  it('knows when a plan is all free and when it is low impact', () => {
    const r = resolvePlan(plan(), [g('a'), g('b', { free: false }), g('c', { lowImpact: false })], {});
    expect(r).toMatchObject({ allFree: false, lowImpact: false });
  });

  it('turns a game length that is not a number into zero', () => {
    const r = resolvePlan(plan({ steps: [{ game: 'a', difficulty: 'easy', restSec: 0 }] }), [g('a', { durationSec: Number.NaN })], {});
    expect(r.steps[0]?.durationSec).toBe(0);
    expect(r.minutes).toBe(1);
  });
});

// ───────── the book ─────────

const clock = (start: Day = '2026-10-24') => {
  const c = { t: Date.parse(`${start}T12:00:00Z`) };
  return { c, at: (d: Day) => { c.t = Date.parse(`${d}T12:00:00Z`); } };
};

function rig(o: { can?: (f: string) => boolean; seated?: boolean | null; storage?: ReturnType<typeof memoryStorage>; start?: Day; games?: () => readonly PlanGame[] } = {}) {
  const k = clock(o.start);
  const storage = o.storage ?? memoryStorage();
  const store = createStore({ storage, now: () => k.c.t, timeZone: 'UTC' });
  const book = createPlanBook(store, {
    games: o.games ?? (() => REAL), can: o.can ?? (() => true), seated: () => o.seated ?? null,
  });
  return { book, store, storage, at: k.at };
}
const freeOnly = (f: string): boolean => f === planFeature(FREE_PLAN_ID);

describe('the list of plans', () => {
  it('has a card for every plan with its length, its seat and what it asks of the player', () => {
    const { book } = rig({ can: freeOnly });
    const cards = book.list();
    expect(cards.map((c) => c.id)).toEqual(WORKOUT_PLAN_IDS);
    const desk = cards[0];
    expect(desk).toMatchObject({ free: true, locked: false, seated: true, allFree: true, playable: true, complete: true, doneThisWeek: 0, doneDays: 0, lastDone: null });
    expect(desk?.minutes).toBeGreaterThan(0);
    for (const c of cards.slice(1)) expect(c, c.id).toMatchObject({ free: false, locked: true });
  });

  it('unlocks every plan for a paid player', () => {
    const { book } = rig({ can: () => true });
    expect(book.list().every((c) => !c.locked)).toBe(true);
  });

  it('locks a plan whose game the player may not play, even when the plan itself is theirs', () => {
    const noReaction = (f: string): boolean => f !== 'game:reaction-tag';
    const { book } = rig({ can: noReaction });
    expect(book.card('kids-break')?.locked).toBe(true);          // reaction-tag is a Pro game
    expect(book.card('full-body')?.locked).toBe(false);
    expect(book.card('made-up')).toBeNull();
  });

  it('is seated when the player is, and for the plans that say so', () => {
    const standing = rig({ seated: false }).book.list();
    expect(standing.find((c) => c.id === 'desk-break')?.seated).toBe(true);
    expect(standing.find((c) => c.id === 'legs-day')?.seated).toBe(false);
    expect(standing.find((c) => c.id === 'easy-60')?.seated).toBe(false);
    const sitting = rig({ seated: true }).book.list();
    expect(sitting.every((c) => c.seated)).toBe(true);
    const unsaid = rig({ seated: null }).book.list();
    expect(unsaid.find((c) => c.id === 'easy-60')?.seated).toBe(true);
    expect(unsaid.find((c) => c.id === 'full-body')?.seated).toBe(false);
  });

  it('copes with a catalogue that fails to answer', () => {
    const { book } = rig({ games: () => { throw new Error('not loaded'); } });
    expect(book.list().every((c) => !c.playable)).toBe(true);
    expect(book.start('desk-break')).toEqual({ ok: false, code: 'empty' });
  });
});

describe('starting a plan', () => {
  it('refuses a plan nobody has heard of, a plan that is not the player\'s, and a plan with nothing to play', () => {
    const free = rig({ can: freeOnly });
    expect(free.book.start('made-up')).toEqual({ ok: false, code: 'unknown' });
    expect(free.book.start('legs-day')).toEqual({ ok: false, code: 'locked' });
    expect(free.book.active()).toBeNull();
    expect(rig({ games: () => [] }).book.start('desk-break')).toEqual({ ok: false, code: 'empty' });
  });

  it('starts the free plan for a free player, at its first step, with the whole plan in view', () => {
    const { book } = rig({ can: freeOnly });
    const r = book.start('desk-break');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view).toMatchObject({ number: 1, total: 2, restSec: 0, current: { game: 'twist-turbine', difficulty: 'easy', seated: true }, next: { game: 'star-catch' } });
    expect(r.view.remainingSec).toBe(180 + 10 + 196);
    expect(book.active()?.run.plan).toBe('desk-break');
  });
});

describe('a run of a plan', () => {
  function started(id = 'full-body') {
    const x = rig();
    const r = x.book.start(id);
    if (!r.ok) throw new Error('did not start');
    return { ...x, view: r.view };
  }

  it('goes from step to step with the rest that comes after each, and ends with the last', () => {
    const { book } = started();
    const one = book.finishStep({ score: 1200, seconds: 238 });
    expect(one).toMatchObject({ over: false, done: false, played: 1, skipped: 0, seconds: 238 });
    expect(one.view).toMatchObject({ number: 2, total: 3, restSec: 20, current: { game: 'squat-flap' }, next: { game: 'twist-turbine' } });
    const two = book.finishStep({ score: 900, seconds: 270 });
    expect(two.view).toMatchObject({ number: 3, restSec: 20, next: null });
    const three = book.finishStep({ score: 400, seconds: 180 });
    expect(three).toMatchObject({ over: true, done: true, played: 3, skipped: 0, seconds: 688, view: null });
    expect(book.active()).toBeNull();
    expect(book.card('full-body')).toMatchObject({ doneThisWeek: 1, doneDays: 1, lastDone: '2026-10-24' });
  });

  it('lets the player leave a step out, and counts the plan as done when at least half of it was played', () => {
    const { book } = started();
    expect(book.skipStep()).toMatchObject({ over: false, played: 0, skipped: 1 });
    book.finishStep({ score: 10, seconds: 100 });
    const end = book.skipStep();
    expect(end).toMatchObject({ over: true, done: false, played: 1, skipped: 2 });
    expect(book.card('full-body')?.doneDays).toBe(0);
    const again = rig();
    again.book.start('full-body');
    again.book.finishStep({ score: 1, seconds: 1 });
    again.book.finishStep({ score: 1, seconds: 1 });
    expect(again.book.skipStep()).toMatchObject({ over: true, done: true, played: 2, skipped: 1 });
  });

  it('goes on after the page was closed and opened again, at the step it had reached', () => {
    const first = rig();
    first.book.start('legs-day');
    first.book.finishStep({ score: 100, seconds: 170 });
    const reopened = rig({ storage: first.storage });
    expect(reopened.book.active()).toMatchObject({ number: 2, total: 4, current: { game: 'squat-flap' } });
    expect(reopened.book.finishStep({ score: 1, seconds: 1 }).view).toMatchObject({ number: 3 });
  });

  it('does not outlive its day', () => {
    const { book, at } = started();
    book.finishStep({ score: 1, seconds: 100 });
    at('2026-10-25');
    expect(book.active()).toBeNull();
    expect(book.finishStep({ score: 1, seconds: 1 })).toMatchObject({ over: false, played: 0, view: null });
  });

  it('is kept as it was started, whatever the catalogue does in the meantime', () => {
    let list: readonly PlanGame[] = REAL;
    const x = rig({ games: () => list });
    x.book.start('legs-day');
    list = REAL.filter((g) => g.id !== 'squat-flap');
    expect(x.book.active()?.total).toBe(4);
    expect(x.book.active()?.run.steps.map((s) => s.game)).toContain('squat-flap');
  });

  it('can be left, and a new run replaces an old one', () => {
    const { book } = started();
    book.abandon();
    expect(book.active()).toBeNull();
    book.start('full-body');
    book.finishStep({ score: 1, seconds: 1 });
    book.start('desk-break');
    expect(book.active()).toMatchObject({ number: 1, plan: { id: 'desk-break' } });
  });

  it('does nothing when there is no run, and clamps what a game hands over', () => {
    const none = rig();
    expect(none.book.finishStep({ score: 5, seconds: 5 })).toEqual({ over: false, done: false, played: 0, skipped: 0, seconds: 0, view: null });
    expect(none.book.skipStep()).toMatchObject({ over: false, view: null });
    const { book } = started('desk-break');
    const weird = book.finishStep({ score: Number.NaN, seconds: -4 });
    expect(weird.seconds).toBe(0);
    const end = book.finishStep({ score: 1e15, seconds: 1e15 });
    expect(end.seconds).toBeLessThanOrEqual(86_400);
    expect(() => book.finishStep(null as unknown as { score: number; seconds: number })).not.toThrow();
  });

  it('counts the days a plan was done, over a week', () => {
    const x = rig();
    for (const d of ['2026-10-22', '2026-10-24', '2026-10-24', '2026-10-17']) {
      x.at(d);
      x.book.start('desk-break');
      x.book.finishStep({ score: 1, seconds: 100 });
      x.book.finishStep({ score: 1, seconds: 100 });
    }
    x.at('2026-10-24');
    expect(x.book.card('desk-break')).toMatchObject({ doneThisWeek: 2, doneDays: 3, lastDone: '2026-10-24' });   // the 24th once, however often it was done
  });

  it('survives a stored run that is damaged or does not add up', () => {
    const x = rig();
    x.book.start('full-body');
    x.storage.setItem('ba2.plans.run', JSON.stringify({ v: 1, d: { plan: 'full-body', day: '2026-10-24', startedAt: 1, seated: false, steps: [], index: 0, results: [] } }));
    expect(x.book.active()).toBeNull();
    x.storage.setItem('ba2.plans.run', 'not json');
    expect(x.book.active()).toBeNull();
    expect(x.book.start('full-body').ok).toBe(true);
  });
});

describe('two devices', () => {
  const doc = (done: Record<string, string[]>): PlansDoc => ({ v: 1, done: Object.fromEntries(Object.entries(done).map(([id, ds]) => [id, ds.reduce((s, d) => withDay(s, d), EMPTY_DAYS)])) });

  it('merge the days each plan was done into a union that does not depend on the order', () => {
    const a = doc({ 'desk-break': ['2026-10-20', '2026-10-22'], 'legs-day': ['2026-10-21'] });
    const b = doc({ 'desk-break': ['2026-10-22', '2026-10-23'], 'full-body': ['2026-10-19'] });
    expect(mergePlansDocs(a, b)).toEqual(mergePlansDocs(b, a));
    expect(mergePlansDocs(mergePlansDocs(a, b), b)).toEqual(mergePlansDocs(a, b));
    const m = mergePlansDocs(a, b);
    expect(daysOf(m.done['desk-break'] as never)).toEqual(['2026-10-20', '2026-10-22', '2026-10-23']);
    expect(Object.keys(m.done).sort()).toEqual(['desk-break', 'full-body', 'legs-day']);
  });

  it('a phone and a laptop end with the same days, and a second merge changes nothing', () => {
    const phone = rig();
    const laptop = rig();
    phone.at('2026-10-22'); laptop.at('2026-10-23');
    phone.book.start('desk-break'); phone.book.finishStep({ score: 1, seconds: 1 }); phone.book.finishStep({ score: 1, seconds: 1 });
    laptop.book.start('desk-break'); laptop.book.finishStep({ score: 1, seconds: 1 }); laptop.book.finishStep({ score: 1, seconds: 1 });
    phone.at('2026-10-24'); laptop.at('2026-10-24');
    expect(phone.book.merge(laptop.book.doc())).toBe(true);
    expect(laptop.book.merge(phone.book.doc())).toBe(true);
    expect(phone.book.merge(laptop.book.doc())).toBe(false);
    expect(phone.book.doc()).toEqual(laptop.book.doc());
    expect(phone.book.card('desk-break')).toMatchObject({ doneDays: 2, doneThisWeek: 2 });
  });

  it('keep no plan this build does not know, no day of the future, and read nothing that is not a document', () => {
    const x = rig();
    x.book.merge({ v: 1, done: { 'desk-break': { '2026-10': 1 << 29, '2031-01': 1 }, 'from-the-future': { '2026-10': 1 } } });
    expect(x.book.doc()).toEqual(emptyPlansDoc());
    for (const raw of [null, undefined, 5, 'x', [], { v: 2, done: {} }, { v: 1, done: 'x' }]) expect(() => x.book.merge(raw), JSON.stringify(raw)).not.toThrow();
    expect(readPlansDoc({ v: 1 })).toEqual({ v: 1, done: {} });
    expect(readPlansDoc({ v: 3 })).toBeNull();
  });

  it('keep a document inside what a synced document may hold, however long the plans were used', () => {
    let d: PlansDoc = emptyPlansDoc();
    for (const id of WORKOUT_PLAN_IDS) {
      let set = EMPTY_DAYS;
      for (let i = 0; i < 500; i++) set = withDay(set, addDays('2025-01-01', i));
      d = { v: 1, done: { ...d.done, [id]: set } };
    }
    const merged = mergePlansDocs(d, emptyPlansDoc());
    expect(JSON.stringify(merged).length).toBeLessThanOrEqual(PLANS_DOC_BUDGET);
    expect(JSON.stringify(merged).length).toBeLessThan(3000);
  });
});

describe('what the player sees for the free plan with the real entitlements rule', () => {
  it('is the same function the book uses to lock the others (see entitlements/features.test.ts for the rule itself)', () => {
    const { book } = rig({ can: freeOnly });
    const unlocked = book.list().filter((c) => !c.locked).map((c) => c.id);
    expect(unlocked).toEqual([FREE_PLAN_ID]);
  });

  it('exposes the card of a plan the way a screen needs it, without the book\'s insides', () => {
    const { book } = rig();
    const card = book.card('kids-break') as ReturnType<PlanBook['card']> & object;
    expect(card.plan.audience).toBe('kids');
    expect(card.steps.map((s) => s.game)).toEqual(['star-catch', 'reaction-tag', 'limbo-bend']);
    expect(card.lowImpact).toBe(true);
  });
});
