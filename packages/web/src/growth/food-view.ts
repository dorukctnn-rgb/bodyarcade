// The food tab (SPEC 4): the questions that open or close the numbers (age, pregnancy, conditions, the eating-concern
// question), then targets as ranges or, with numbers hidden, hand portions; today's meals; the week plan and the shopping
// list (Pro). Every screen ends with "general information, not medical advice" and the USDA FoodData Central credit.
import { ACTIVITY, type Activity, type Formula, type GoalId } from '../../../core/growth/nutrition/energy.ts';
import { CONDITIONS, nutritionView, type Condition, type Profile } from '../../../core/growth/nutrition/guards.ts';
import { CUISINE_OF_LANG, CUISINES, type Allergen, type Cuisine, type Diet } from '../../../core/growth/nutrition/meals.ts';
import { buildPlan, portions, swapMeal, type PlannedMeal, type PlanFilters } from '../../../core/growth/nutrition/planner.ts';
import { AISLES, shoppingList, STAPLES } from '../../../core/growth/nutrition/shopping.ts';
import { foodName } from '../../../core/growth/nutrition/food-names.ts';
import { chips, field, fromCm, fromKg, numberInput, round1, toCm, toKg, type Ctx } from './ctx.ts';
import type { GrowthKey } from './strings.ts';
import { SUPPORT } from './strings.ts';
import { loadMeasures } from './twin-tab.ts';

interface FoodProfile { heightCm: number | null; weightKg: number | null; formula: Formula; pal: Activity; pregnant: boolean | null; conditions: Condition[]; concern: Profile['concern'] | null; goal: GoalId; cuisines: Cuisine[]; diet: Diet; noPork: boolean; allergens: Allergen[]; doctorOk?: boolean }

const ALLERGENS: Allergen[] = ['gluten', 'milk', 'egg', 'nuts', 'peanut', 'soy', 'fish', 'sesame'];

export async function foodTab(c: Ctx, host: HTMLElement): Promise<() => void> {
  const { el, btn, W } = c;
  const units = c.settings.units;
  const measures = await loadMeasures(c);
  const last = measures.at(-1);
  const saved = await c.vault.getJson<FoodProfile>('nutrition', 'profile');
  const fp: FoodProfile = saved ?? {
    heightCm: last?.heightCm ?? null, weightKg: last?.weightKg ?? null, formula: 'mid', pal: 1.55, pregnant: null, conditions: [], concern: null, goal: 'maintain',
    cuisines: [CUISINE_OF_LANG[c.lang]], diet: 'any', noPork: c.lang === 'tr', allergens: [],
  };
  const wrap = el('div', 'gc-wide'); host.append(wrap);
  const left = el('div', 'gc-grid'); left.style.gridTemplateColumns = '1fr';
  const right = el('div', 'gc-grid'); right.style.gridTemplateColumns = '1fr';
  wrap.append(left, right);
  const footer = (): HTMLElement => { const f = el('div'); f.append(el('p', 'gc-note', W.foodFooter), el('p', 'gc-note', W.fdc)); f.dataset.footer = ''; return f; };

  // under 18: no numbers, a plain note (SPEC 4.2 rule 1)
  if (c.minor()) {
    const m = el('section', 'gc-card'); m.dataset.gate = 'minor';
    m.append(el('h2', '', W.tabFood), el('p', '', W.gate_minor), footer());
    left.append(m);
    return () => undefined;
  }

  // ---- questions ----
  const qs = el('section', 'gc-card'); qs.dataset.foodSetup = '';
  qs.append(el('h2', '', W.foodSetup));
  const hUnit = units === 'imperial' ? W.unitIn : W.unitCm, wUnit = units === 'imperial' ? W.unitLb : W.unitKg;
  const h = numberInput(c, fp.heightCm ? round1(fromCm(fp.heightCm, units)) : null, { min: 50, max: 250, step: 0.5 }); h.dataset.fHeight = '';
  const w = numberInput(c, fp.weightKg ? round1(fromKg(fp.weightKg, units)) : null, { min: 25, max: 400, step: 0.1 }); w.dataset.fWeight = '';
  if (c.settings.hideNumbers) { h.type = 'password'; w.type = 'password'; }
  const form = el('div', 'gc-form'); form.append(field(c, `${W.height} (${hUnit})`, h), field(c, `${W.weight} (${wUnit})`, w)); qs.append(form);
  const q = (label: string, node: HTMLElement, name: string): void => { const p = el('p', 'gc-q', label); p.dataset.q = name; qs.append(p, node); };
  q(W.formula, chips(c, (['female', 'male', 'mid'] as Formula[]).map((f) => [f, W[`formula_${f}` as GrowthKey]] as [Formula, string]), [fp.formula], false, (v) => { fp.formula = v[0]!; }, 'formula'), 'formula');
  qs.append(el('p', 'gc-note', W.formulaNote));
  q(W.activity, chips(c, ACTIVITY.map((a) => [String(a), W[`act_${Math.round(a * 100)}` as GrowthKey]] as [string, string]), [String(fp.pal)], false, (v) => { fp.pal = Number(v[0]) as Activity; }, 'pal'), 'pal');
  q(W.pregnantQ, chips(c, [['yes', W.yes], ['no', W.no]] as const, fp.pregnant === null ? [] : [fp.pregnant ? 'yes' : 'no'], false, (v) => { fp.pregnant = v[0] === 'yes'; }, 'pregnant'), 'pregnant');
  q(W.conditionsQ, chips(c, CONDITIONS.map((k) => [k, W[`cond_${k}` as GrowthKey]] as [Condition, string]), fp.conditions, true, (v) => { fp.conditions = v; }, 'conditions'), 'conditions');
  q(W.concernQ, chips(c, [['no', W.concern_no], ['a-little', W['concern_a-little']], ['yes', W.concern_yes]] as const, fp.concern ? [fp.concern] : [], false, (v) => { fp.concern = v[0] as Profile['concern']; }, 'concern'), 'concern');
  q(W.foodGoal, chips(c, (['maintain', 'lose-light', 'lose-medium', 'lose-most', 'gain-muscle', 'recomp'] as GoalId[]).map((g) => [g, W[`fg_${g}` as GrowthKey]] as [GoalId, string]), [fp.goal], false, (v) => { fp.goal = v[0]!; }, 'goal'), 'goal');
  q(W.cuisine, chips(c, CUISINES.map((k) => [k, W[`cu_${k}` as GrowthKey] + (k !== CUISINE_OF_LANG[c.lang] && !c.access.can('growth:meals-week') ? ` · ${W.proTag}` : '')] as [Cuisine, string]), fp.cuisines, true, (v) => {
    fp.cuisines = c.access.can('growth:meals-week') ? v : v.filter((x) => x === CUISINE_OF_LANG[c.lang]);
    if (fp.cuisines.length !== v.length) c.toast(W.proLocked);
    if (!fp.cuisines.length) fp.cuisines = [CUISINE_OF_LANG[c.lang]];
  }, 'cuisine'), 'cuisine');
  q(W.diet, chips(c, (['any', 'pescatarian', 'vegetarian', 'vegan'] as Diet[]).map((d) => [d, W[`diet_${d}` as GrowthKey]] as [Diet, string]), [fp.diet], false, (v) => { fp.diet = v[0]!; }, 'diet'), 'diet');
  q(W.allergens, chips(c, [['noPork', W.noPork], ...ALLERGENS.map((a) => [a, a] as [string, string])], [...(fp.noPork ? ['noPork'] : []), ...fp.allergens], true, (v) => { fp.noPork = v.includes('noPork'); fp.allergens = v.filter((x) => x !== 'noPork') as Allergen[]; }, 'allergens'), 'allergens');
  qs.append(el('p', 'gc-note', W.allergenNote));
  const show = btn(W.showPlan, 'gc-btn gc-btn--primary', async () => {
    fp.heightCm = h.value ? round1(toCm(Number(h.value), units)) : null;
    fp.weightKg = w.value ? round1(toKg(Number(w.value), units)) : null;
    if (!fp.heightCm || !fp.weightKg || fp.pregnant === null || fp.concern === null) { (fp.heightCm ? (fp.weightKg ? qs.querySelector('[data-q=pregnant]') : w) : h)?.scrollIntoView({ block: 'center' }); c.toast(W.foodSetup); return; }
    await c.vault.putJson('nutrition', 'profile', fp);
    c.refresh();
  });
  show.dataset.showPlan = '';
  qs.append(show);
  left.append(qs);

  // ---- the result ----
  const ready = fp.heightCm && fp.weightKg && fp.pregnant !== null && fp.concern !== null && c.settings.birthYear;
  const res = el('section', 'gc-card'); res.dataset.foodResult = '';
  right.append(res);
  if (!ready) { res.append(el('p', 'gc-muted', c.settings.birthYear ? W.foodSetup : W.birthYear), footer()); return () => undefined; }
  const v = nutritionView({ birthYear: c.settings.birthYear!, heightCm: fp.heightCm!, weightKg: fp.weightKg!, formula: fp.formula, pal: fp.pal, pregnant: fp.pregnant!, conditions: fp.conditions, concern: fp.concern!, hideNumbers: c.settings.hideNumbers }, fp.goal);
  res.dataset.numbers = String(v.numbers);
  for (const g of v.gates) { const p = el('p', 'gc-note', W[`gate_${g}` as GrowthKey]); p.dataset.gate = g; res.append(p); }
  if (v.gates.includes('concern')) {
    const ul = el('ul', 'gc-list');
    for (const s of SUPPORT[c.lang]) { const li = el('li'); const a = el('a', '', s.name); a.href = s.url; a.rel = 'noopener'; a.target = '_blank'; li.append(a); ul.append(li); }
    res.append(el('h3', '', W.support), ul);
  }
  if (v.numbers && v.target && v.macros) {
    const t = el('p', '', c.t('targetLine', { a: v.target.range[0].toLocaleString(c.tag), b: v.target.range[1].toLocaleString(c.tag) })); t.dataset.kcal = String(v.target.kcal);
    res.append(t, el('p', 'gc-muted', c.t('proteinLine', { a: v.macros.protein.range[0], b: v.macros.protein.range[1], f: v.macros.fat.g, c: v.macros.carbs.g, fib: v.macros.fibre })));
    if (v.notes.includes('floor')) res.append(el('p', 'gc-note', W.floorNote));
    if (v.notes.includes('pace')) res.append(el('p', 'gc-note', W.paceNote));
    if (v.notes.includes('reference-weight')) res.append(el('p', 'gc-note', W.refNote));
  }

  // meals: no numeric target (pregnancy, conditions, minors) -> meal ideas without numbers, sized for maintenance
  const kcal = v.target?.kcal ?? 2000;
  const filters: PlanFilters = { cuisines: fp.cuisines, diet: fp.diet, avoidAllergens: fp.allergens, noPork: fp.noPork };
  const seed = Math.floor(Date.now() / 86_400_000) % 3;
  const week = c.access.can('growth:meals-week');
  const plan = buildPlan({ kcal, days: week ? 7 : 1, filters, seed });
  const mealLine = (pm: PlannedMeal): HTMLElement => {
    const li = el('li', 'gc-meal'); li.dataset.meal = pm.meal.id;
    li.append(el('b', '', `${W[`slot_${pm.slot}` as GrowthKey]}: ${pm.meal.name[c.lang]}`));
    if (pm.leftover) li.append(el('small', '', W.leftover));
    if (v.numbers) li.append(el('small', '', `${Math.round(pm.totals.kcal)} kcal · ${Math.round(pm.totals.p)} g`));
    else { const p = portions(pm); li.append(el('small', '', c.t('portionsLine', { palms: p.palms, fists: p.fists, cupped: p.cupped, thumbs: p.thumbs }))); }
    return li;
  };
  const meals = el('section', 'gc-card'); meals.dataset.meals = '';
  meals.append(el('h2', '', W.todayMeals));
  const ul = el('ul', 'gc-list');
  const day0 = plan.days[0]!;
  for (const [i, pm] of day0.meals.entries()) {
    const li = mealLine(pm);
    li.append(btn(`${W.another}${week ? '' : ` · ${W.proTag}`}`, 'gc-btn', () => {
      if (!week) { c.toast(W.proLocked); return; }
      const n = swapMeal(pm, filters, Date.now() % 97);
      day0.meals[i] = n; li.replaceWith(mealLine(n));
    }));
    ul.append(li);
  }
  meals.append(ul, el('p', 'gc-note', W.approxValues), footer());
  right.append(meals);

  // week and shopping (Pro)
  const wk = el('section', 'gc-card'); wk.dataset.weekPlan = '';
  wk.append(el('h2', '', `${W.weekPlan}${week ? '' : ` · ${W.proTag}`}`));
  if (!week) wk.append(el('p', 'gc-muted', W.proLocked));
  else {
    const dl = el('ul', 'gc-list');
    for (const d of plan.days) { const li = el('li'); li.append(el('b', '', new Intl.DateTimeFormat(c.tag, { weekday: 'long' }).format(new Date(Date.now() + d.day * 86_400_000))), c.doc.createTextNode(d.meals.map((m) => m.meal.name[c.lang]).join(' · '))); dl.append(li); }
    wk.append(dl);
    const sh = el('div'); sh.dataset.shopping = '';
    const items = shoppingList(plan.days, { atHome: new Set([...STAPLES]) });
    sh.append(el('h3', '', W.shopping));
    const lines: string[] = [];
    for (const a of AISLES) {
      const its = items.filter((i) => i.aisle === a);
      if (!its.length) continue;
      sh.append(el('p', 'gc-q', W[`aisle_${a}` as GrowthKey]));
      const l = el('ul', 'gc-list');
      for (const it of its) {
        const amount = it.buy.kind === 'pack' ? c.t('buyPack', { n: it.buy.count, g: it.buy.packG }) : it.buy.kind === 'piece' ? c.t('buyPiece', { n: it.buy.count }) : c.t('buyWeight', { g: it.buy.g });
        const li = el('li'); const cb = el('input'); cb.type = 'checkbox'; const lab = el('label', 'gc-row'); lab.append(cb, c.doc.createTextNode(`${foodName(it.food, c.lang)} · ${amount}`)); li.append(lab); l.append(li);
        lines.push(`- ${foodName(it.food, c.lang)}: ${amount}`);
      }
      sh.append(l);
    }
    const share = btn(W.copy, 'gc-btn', async () => { try { await c.win.navigator.clipboard.writeText(lines.join('\n')); c.toast(W.copy); } catch { /* no clipboard */ } });
    sh.append(share);
    wk.append(sh);
  }
  right.append(wk);
  return () => undefined;
}

/** What the Today panel shows of the food plan (kol F): the same answers, targets and today's menu as this tab. */
export type FoodToday =
  | { state: 'minor' }
  | { state: 'setup' }
  | { state: 'ready'; view: ReturnType<typeof nutritionView>; meals: PlannedMeal[]; concern: boolean };

export async function foodToday(c: Ctx): Promise<FoodToday> {
  if (c.minor()) return { state: 'minor' };
  const fp = await c.vault.getJson<FoodProfile>('nutrition', 'profile');
  if (!fp || !fp.heightCm || !fp.weightKg || fp.pregnant === null || fp.concern === null || !c.settings.birthYear) return { state: 'setup' };
  const view = nutritionView({ birthYear: c.settings.birthYear, heightCm: fp.heightCm, weightKg: fp.weightKg, formula: fp.formula, pal: fp.pal, pregnant: fp.pregnant, conditions: fp.conditions, concern: fp.concern, hideNumbers: c.settings.hideNumbers }, fp.goal);
  const plan = buildPlan({ kcal: view.target?.kcal ?? 2000, days: 1, filters: { cuisines: fp.cuisines, diet: fp.diet, avoidAllergens: fp.allergens, noPork: fp.noPork }, seed: Math.floor(Date.now() / 86_400_000) % 3 });
  return { state: 'ready', view, meals: plan.days[0]?.meals ?? [], concern: fp.concern === 'yes' };
}
