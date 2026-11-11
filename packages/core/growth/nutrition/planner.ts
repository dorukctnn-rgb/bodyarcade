// The meal plan builder (SPEC 4.3), rule based. Each day's target splits over the meals (breakfast 25 %, lunch 35 %,
// dinner 30 %, snack 10 %); every slot takes a meal that passes the filters (cuisines, diet, allergens, no pork); the same
// dinner at most twice a week; "cook twice" puts the rest into tomorrow's lunch. Scalable ingredients move in 10 g steps
// (pieces in halves) until the day is within 5 % of its energy target; when no meal fits, the nearest plan is shown with
// the gap. With numbers hidden the same plan is built and shown as hand portions.
import FOODS_FILE from './foods.json';
import { MEALS, suits, type Allergen, type Cuisine, type Diet, type Meal, type Slot } from './meals.ts';

export interface Food { fdc: number; kcal: number; p: number; f: number; c: number; fib: number; na: number; aisle: string; pack: number; piece: number }
export const FOODS: Readonly<Record<string, Food>> = (FOODS_FILE as { foods: Record<string, Food> }).foods;
export const FOOD_SOURCE: string = (FOODS_FILE as { source: string }).source;

export interface Totals { kcal: number; p: number; f: number; c: number; fib: number }
export interface PlannedMeal { slot: Slot; meal: Meal; grams: { food: string; g: number }[]; totals: Totals; leftover?: boolean }
export interface PlanDay { day: number; meals: PlannedMeal[]; totals: Totals; target: number; offBy: number }

export interface PlanFilters {
  cuisines: readonly Cuisine[];
  diet: Diet;
  avoidAllergens?: readonly Allergen[];
  noPork?: boolean;
  snacks?: 0 | 1;
}

export const SPLIT: Record<Slot, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };

export function totalsOf(grams: readonly { food: string; g: number }[]): Totals {
  const t: Totals = { kcal: 0, p: 0, f: 0, c: 0, fib: 0 };
  for (const { food, g } of grams) {
    const f = FOODS[food];
    if (!f) throw new Error(`plan:unknown-food:${food}`);
    t.kcal += (f.kcal * g) / 100; t.p += (f.p * g) / 100; t.f += (f.f * g) / 100; t.c += (f.c * g) / 100; t.fib += (f.fib * g) / 100;
  }
  return t;
}

const add = (a: Totals, b: Totals): Totals => ({ kcal: a.kcal + b.kcal, p: a.p + b.p, f: a.f + b.f, c: a.c + b.c, fib: a.fib + b.fib });

export function candidates(slot: Slot, f: PlanFilters): Meal[] {
  return MEALS.filter((m) => m.slot === slot && f.cuisines.includes(m.cuisine) && suits(m, f.diet) && !(f.noPork && m.pork) && !m.allergens.some((a) => f.avoidAllergens?.includes(a)));
}

/** Scales a meal toward a kcal goal: scalable ingredients in 10 g steps (pieces by halves), from 0.5x to 2x. */
export function scaleMeal(meal: Meal, kcal: number): { grams: { food: string; g: number }[]; totals: Totals } {
  const fixed = meal.items.filter((i) => !i.scale).map((i) => ({ food: i.food, g: i.g }));
  const scal = meal.items.filter((i) => i.scale);
  const fixedK = totalsOf(fixed).kcal;
  const scalK = totalsOf(scal.map((i) => ({ food: i.food, g: i.g }))).kcal;
  const k = scalK > 0 ? Math.max(0.5, Math.min(2, (kcal - fixedK) / scalK)) : 1;
  const grams = [...fixed, ...scal.map((i) => {
    const piece = FOODS[i.food]?.piece ?? 0;
    const g = piece ? Math.max(piece / 2, Math.round((i.g * k) / (piece / 2)) * (piece / 2)) : Math.max(10, Math.round((i.g * k) / 10) * 10);
    return { food: i.food, g };
  })];
  // keep the meal's own order of ingredients
  const order = meal.items.map((i) => i.food);
  grams.sort((a, b) => order.indexOf(a.food) - order.indexOf(b.food));
  return { grams, totals: totalsOf(grams) };
}

export interface WeekPlan { days: PlanDay[]; complete: boolean }

/**
 * Builds `days` days. `pick` chooses among candidates (seeded, so "suggest another" is repeatable); the default picks in
 * turn. Returns the plan and whether every day is within 5 % of its target.
 */
export function buildPlan(o: { kcal: number; protein?: [number, number]; days: number; filters: PlanFilters; seed?: number; twice?: boolean }): WeekPlan {
  const slots: Slot[] = ['breakfast', 'lunch', 'dinner', ...((o.filters.snacks ?? 1) ? ['snack' as Slot] : [])];
  const share = slots.reduce((a, s) => a + SPLIT[s], 0);
  const used = new Map<string, number>();
  let rot = o.seed ?? 0;
  const days: PlanDay[] = [];
  let leftover: Meal | null = null;
  for (let d = 0; d < o.days; d++) {
    const meals: PlannedMeal[] = [];
    let tot: Totals = { kcal: 0, p: 0, f: 0, c: 0, fib: 0 };
    for (const slot of slots) {
      const want = (o.kcal * SPLIT[slot]) / share;
      let meal: Meal | undefined;
      let isLeft = false;
      if (slot === 'lunch' && leftover && o.twice !== false) { meal = leftover; isLeft = true; leftover = null; }
      if (!meal) {
        const c = candidates(slot, o.filters).filter((m) => slot !== 'dinner' || (used.get(m.id) ?? 0) < 2);
        if (!c.length) continue;
        meal = c[rot++ % c.length]!;
      }
      used.set(meal.id, (used.get(meal.id) ?? 0) + 1);
      const sc = scaleMeal(meal, want);
      meals.push({ slot, meal, grams: sc.grams, totals: sc.totals, ...(isLeft ? { leftover: true } : {}) });
      tot = add(tot, sc.totals);
      if (slot === 'dinner' && meal.twice && o.twice !== false) leftover = meal;
    }
    // one more pass: nudge the biggest scalable meal so the day lands within 5 %
    const off = (tot.kcal - o.kcal) / o.kcal;
    if (Math.abs(off) > 0.05 && meals.length) {
      const big = meals.reduce((a, b) => (b.totals.kcal > a.totals.kcal ? b : a));
      const sc = scaleMeal(big.meal, big.totals.kcal - (tot.kcal - o.kcal));
      tot = add({ kcal: tot.kcal - big.totals.kcal, p: tot.p - big.totals.p, f: tot.f - big.totals.f, c: tot.c - big.totals.c, fib: tot.fib - big.totals.fib }, sc.totals);
      big.grams = sc.grams; big.totals = sc.totals;
    }
    days.push({ day: d, meals, totals: tot, target: o.kcal, offBy: (tot.kcal - o.kcal) / o.kcal });
  }
  return { days, complete: days.every((d) => Math.abs(d.offBy) <= 0.05) };
}

/** "Suggest another": the same slot, a different meal, rescaled to the same energy. */
export function swapMeal(pm: PlannedMeal, filters: PlanFilters, seed: number): PlannedMeal {
  const c = candidates(pm.slot, filters).filter((m) => m.id !== pm.meal.id);
  if (!c.length) return pm;
  const meal = c[seed % c.length]!;
  const sc = scaleMeal(meal, pm.totals.kcal);
  return { slot: pm.slot, meal, grams: sc.grams, totals: sc.totals };
}

/** Hand portions for the hidden-numbers mode (palm protein, cupped hand carbs, thumb fats, fist vegetables). */
export interface Portions { palms: number; cupped: number; thumbs: number; fists: number }
const VEG = new Set(['tomato', 'greenPepper', 'redPepper', 'cucumber', 'greenBeans', 'spinach', 'onion', 'carrot', 'broccoli', 'lettuce', 'mushroom', 'zucchini', 'eggplant', 'cabbage', 'cauliflower', 'peas', 'parsley', 'dill', 'mint', 'tomatoSauce', 'sauerkraut', 'corn']);
export function portions(pm: Pick<PlannedMeal, 'grams' | 'totals'>): Portions {
  const half = (v: number): number => Math.max(0, Math.round(v * 2) / 2);
  const veg = pm.grams.filter((g) => VEG.has(g.food)).reduce((a, g) => a + g.g, 0);
  return { palms: half(pm.totals.p / 25), cupped: half(pm.totals.c / 25), thumbs: half(pm.totals.f / 10), fists: half(veg / 80) };
}
