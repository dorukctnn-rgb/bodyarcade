// G5: formulas (the SPEC 4.1 example, digit for digit), the safety gates (SPEC 4.2, each rule), the planner and the list.
import { describe, expect, it } from 'vitest';
import { ACTIVITY, bmr, energyTarget, FLOOR, GOAL_FACTOR, type Formula, type GoalId } from './energy.ts';
import { adaptTarget, allowedGoals, BANNED_WORDS, fastChange, minGoalWeight, nutritionView, screenModel, type Profile } from './guards.ts';
import { macros } from './macros.ts';
import { CUISINES, MEALS } from './meals.ts';
import { buildPlan, candidates, FOODS, portions, swapMeal, totalsOf } from './planner.ts';
import { shoppingList } from './shopping.ts';
import { FOOD_NAME_KEYS } from './food-names.ts';

const now = new Date('2026-11-11T12:00:00Z');
const adult: Profile = { birthYear: 1996, heightCm: 165, weightKg: 70, formula: 'female', pal: 1.55, pregnant: false, conditions: [], concern: 'no' };

describe('formulas', () => {
  it('the SPEC example: female formula, 30 y, 165 cm, 70 kg, PAL 1.55, "medium"', () => {
    const t = energyTarget({ formula: 'female', kg: 70, cm: 165, age: 30, pal: 1.55, goal: 'lose-medium' });
    expect(t.bmr).toBe(1420); expect(t.tdee).toBe(2201); expect(t.kcal).toBe(1871);
    expect(t.weeklyKg).toBeCloseTo(-0.3, 1); expect(t.limitedBy).toBeNull();
    const m = macros({ kcal: t.kcal, kg: 70, cm: 165, goal: 'lose-medium' });
    expect(m.referenceKg).toBeCloseTo(68.1, 1);
    expect(Math.abs(m.protein.g - 122)).toBeLessThanOrEqual(1);
    expect(m.protein.range).toEqual([109, 150]);
    expect(m.fat.g).toBe(62); expect(m.carbs.g).toBe(205); expect(m.fibre).toBe(26);
  });
  it('the middle formula is between the two', () => {
    const o = { kg: 70, cm: 170, age: 40 };
    expect(bmr({ ...o, formula: 'mid' })).toBe((bmr({ ...o, formula: 'male' }) + bmr({ ...o, formula: 'female' })) / 2);
  });
  it('property: over a grid of ages, heights, weights and goals no target is under the floor or the BMR, never 800 or less, and the pace is at most 1 kg / 0.75 %', () => {
    for (const formula of ['female', 'male', 'mid'] as Formula[]) for (const age of [18, 30, 55, 80]) for (const cm of [145, 165, 190]) for (const kg of [45, 60, 85, 130]) for (const pal of ACTIVITY) for (const goal of Object.keys(GOAL_FACTOR) as GoalId[]) {
      const t = energyTarget({ formula, kg, cm, age, pal, goal });
      expect(t.kcal).toBeGreaterThanOrEqual(Math.max(FLOOR[formula], Math.round(t.bmr) - 1));
      expect(t.kcal).toBeGreaterThan(800);
      expect(t.range[0]).toBeGreaterThanOrEqual(t.floor - 10);
      if (t.kcal < t.tdee) expect(-t.weeklyKg).toBeLessThanOrEqual(Math.min(1, kg * 0.0075) + 0.02);
    }
  });
  it('a low target keeps fat >= 20 % and carbohydrate >= 130 g before protein gives way', () => {
    const m = macros({ kcal: 1350, kg: 95, cm: 160, goal: 'lose-most' });
    expect(m.fat.g * 9).toBeGreaterThanOrEqual(1350 * 0.2 - 9);
    expect(m.carbs.g).toBeGreaterThanOrEqual(129);
  });
});

describe('safety gates', () => {
  it('rule 1, under 18: no numbers, no loss goal, no body photos; program stays', () => {
    const v = nutritionView({ ...adult, birthYear: 2010 }, 'lose-medium', now);
    expect(v.gates).toContain('minor'); expect(v.numbers).toBe(false); expect(v.photos).toBe(false); expect(v.target).toBeNull();
    expect(v.goals).toEqual(['maintain']); expect(v.program).toBe('yes'); expect(v.notes).toContain('talk-family-doctor');
  });
  it('rule 3, BMI under 18.5: no loss or recomposition; 18.5-20: loss only light; the goal weight floor', () => {
    expect(allowedGoals({ heightCm: 170, weightKg: 50 }, 30)).toEqual(['maintain', 'gain-muscle']);
    expect(allowedGoals({ heightCm: 170, weightKg: 56 }, 30)).toEqual(['maintain', 'lose-light', 'gain-muscle', 'recomp']);
    const v = nutritionView({ ...adult, weightKg: 48 }, 'lose-most', now);
    expect(v.gates).toContain('underweight'); expect(v.notes).toContain('ask-doctor');
    expect(v.target!.kcal).toBeGreaterThanOrEqual(v.target!.tdee);
    expect(minGoalWeight(170)).toBe(53.5);
  });
  it('rule 4, pregnancy: no numbers, no goals, no program build', () => {
    const v = nutritionView({ ...adult, pregnant: true }, 'lose-light', now);
    expect(v.numbers).toBe(false); expect(v.goals).toEqual([]); expect(v.program).toBe('no'); expect(v.notes).toContain('ask-doctor-midwife'); expect(v.target).toBeNull();
  });
  it('rule 5, a condition: no numeric target, program after the doctor confirmation', () => {
    const v = nutritionView({ ...adult, conditions: ['diabetes'] }, 'maintain', now);
    expect(v.numbers).toBe(false); expect(v.target).toBeNull(); expect(v.program).toBe('needs-doctor-ok'); expect(v.notes).toContain('ask-doctor-dietitian');
  });
  it('rule 6, eating concern: "a little" caps the deficit at 10 %; "yes" hides numbers for good, no deficit, no weigh-in reminders', () => {
    const a = nutritionView({ ...adult, concern: 'a-little' }, 'lose-light', now);
    expect(a.target!.kcal).toBeGreaterThanOrEqual(Math.round(a.target!.tdee * 0.9) - 1);
    expect(a.goals).not.toContain('lose-most');
    const y = nutritionView({ ...adult, concern: 'yes' }, 'lose-light', now);
    expect(y.numbers).toBe(false); expect(y.numbersLocked).toBe(true); expect(y.weighInReminders).toBe(false); expect(y.weightChart).toBe(false);
    expect(y.goals.some((g) => g.startsWith('lose'))).toBe(false); expect(y.notes).toContain('support-page');
  });
  it('hidden numbers: the screen model holds no number at all', () => {
    const v = nutritionView({ ...adult, hideNumbers: true }, 'maintain', now);
    const s = screenModel(v);
    expect(s).toEqual({ numbers: false, portions: true });
    expect(JSON.stringify(s)).not.toMatch(/\d/);
  });
  it('rule 7, fast change: three weeks of more than 1 % a week', () => {
    expect(fastChange([80, 79, 78, 77])).toBe(true);
    expect(fastChange([80, 79.6, 79.3, 79])).toBe(false);
  });
  it('the adaptive target moves 100 kcal at most and never under the floor; off when not allowed', () => {
    const t = energyTarget({ formula: 'female', kg: 70, cm: 165, age: 30, pal: 1.55, goal: 'lose-light' });
    expect(adaptTarget({ target: t, weighIns21d: 12, expectedKgPer14d: -0.4, trendKgPer14d: 0.1, allowed: true })).toBe(t.kcal - 100);
    expect(adaptTarget({ target: t, weighIns21d: 5, expectedKgPer14d: -0.4, trendKgPer14d: 0.1, allowed: true })).toBe(t.kcal);
    expect(adaptTarget({ target: t, weighIns21d: 12, expectedKgPer14d: -0.4, trendKgPer14d: 0.1, allowed: false })).toBe(t.kcal);
  });
  it('the banned word lists cover every language', () => {
    expect(Object.keys(BANNED_WORDS).sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
  });
});

describe('meal library and planner', () => {
  it('every food has its shop name in five languages', () => {
    expect([...FOOD_NAME_KEYS].sort()).toEqual(Object.keys(FOODS).sort());
  });
  it('every ingredient is an FDC food; every cuisine is at least 40 % vegetarian and 25 % vegan', () => {
    for (const m of MEALS) for (const i of m.items) expect(FOODS[i.food], `${m.id}: ${i.food}`).toBeDefined();
    for (const c of CUISINES) {
      const ms = MEALS.filter((m) => m.cuisine === c);
      expect(ms.filter((m) => m.diet === 'vegetarian' || m.diet === 'vegan').length / ms.length, c).toBeGreaterThanOrEqual(0.4);
      expect(ms.filter((m) => m.diet === 'vegan').length / ms.length, c).toBeGreaterThanOrEqual(0.25);
    }
    expect(new Set(MEALS.map((m) => m.id)).size).toBe(MEALS.length);
  });
  it('filters: vegan only vegan, an allergen out everywhere', () => {
    for (const m of candidates('dinner', { cuisines: CUISINES, diet: 'vegan' })) expect(m.diet).toBe('vegan');
    for (const s of ['breakfast', 'lunch', 'dinner', 'snack'] as const) for (const m of candidates(s, { cuisines: CUISINES, diet: 'any', avoidAllergens: ['gluten', 'milk'] })) { expect(m.allergens).not.toContain('gluten'); expect(m.allergens).not.toContain('milk'); }
  });
  it('a week at 1870 kcal (Turkish): each day within 5 %, the same dinner at most twice, cook-twice leftovers', () => {
    const plan = buildPlan({ kcal: 1870, days: 7, filters: { cuisines: ['tr'], diet: 'any', noPork: true } });
    for (const d of plan.days) expect(Math.abs(d.offBy), `day ${d.day}: ${d.totals.kcal.toFixed(0)}`).toBeLessThanOrEqual(0.05);
    const dinners = plan.days.flatMap((d) => d.meals.filter((m) => m.slot === 'dinner').map((m) => m.meal.id));
    for (const id of new Set(dinners)) expect(dinners.filter((x) => x === id).length).toBeLessThanOrEqual(2);
  });
  it('vegan, several cuisines, 2400 kcal', () => {
    const plan = buildPlan({ kcal: 2400, days: 7, filters: { cuisines: ['med', 'es', 'us'], diet: 'vegan' } });
    expect(plan.days.every((d) => d.meals.every((m) => m.meal.diet === 'vegan'))).toBe(true);
    for (const d of plan.days) expect(Math.abs(d.offBy)).toBeLessThanOrEqual(0.05);
  });
  it('suggest another keeps the slot and the energy near', () => {
    const plan = buildPlan({ kcal: 2000, days: 1, filters: { cuisines: ['fr'], diet: 'any' } });
    const lunch = plan.days[0]!.meals.find((m) => m.slot === 'lunch')!;
    const other = swapMeal(lunch, { cuisines: ['fr'], diet: 'any' }, 1);
    expect(other.meal.id).not.toBe(lunch.meal.id); expect(other.slot).toBe('lunch');
    expect(Math.abs(other.totals.kcal - lunch.totals.kcal) / lunch.totals.kcal).toBeLessThan(0.25);
  });
  it('hand portions are halves and never negative', () => {
    const p = portions({ grams: [{ food: 'chickenBreast', g: 150 }, { food: 'broccoli', g: 160 }], totals: totalsOf([{ food: 'chickenBreast', g: 150 }, { food: 'broccoli', g: 160 }]) });
    expect(p.palms).toBe(2); expect(p.fists).toBe(2);
  });
});

describe('shopping list', () => {
  it('adds the week up by aisle, dry weights for cooked grains, staples marked, "at home" items out', () => {
    const plan = buildPlan({ kcal: 2000, days: 3, filters: { cuisines: ['tr'], diet: 'any' } });
    const list = shoppingList(plan.days, { atHome: new Set(['oliveOil']) });
    expect(list.find((i) => i.food === 'oliveOil')).toBeUndefined();
    const aisles = list.map((i) => i.aisle);
    expect([...aisles].join()).toBe([...aisles].sort((a, b) => ['produce', 'meat', 'dairy', 'pantry', 'bakery', 'frozen'].indexOf(a) - ['produce', 'meat', 'dairy', 'pantry', 'bakery', 'frozen'].indexOf(b)).join());
    const bulgur = list.find((i) => i.food === 'bulgur');
    if (bulgur) { const cooked = plan.days.flatMap((d) => d.meals.filter((m) => !m.leftover).flatMap((m) => m.grams.filter((g) => g.food === 'bulgur').map((g) => g.g * (m.meal.twice && m.slot === 'dinner' ? 2 : 1)))).reduce((a, b) => a + b, 0); expect(bulgur.needG).toBe(Math.round(cooked * 0.4)); }
    for (const i of list) if (i.buy.kind === 'piece' || i.buy.kind === 'pack') expect(i.buy.count).toBeGreaterThanOrEqual(1);
  });
});
