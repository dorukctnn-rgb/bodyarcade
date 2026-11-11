// Macro ranges (SPEC 4.1), general information. Sources:
//   protein: Jäger R et al. ISSN position stand, JISSN 2017;14:20 (1.4-2.0 g/kg for exercising people),
//            https://doi.org/10.1186/s12970-017-0177-8 ; Morton RW et al. 2018 (benefit levels off near 1.6 g/kg),
//            https://pubmed.ncbi.nlm.nih.gov/28698222/
//   fat, carbohydrate (130 g/day), fibre (14 g per 1000 kcal): US National Academies, Dietary Reference Intakes for
//            macronutrients (2005), https://nap.nationalacademies.org/catalog/10490
// Reference weight: the current weight under BMI 25, else the weight at BMI 25 for the height (protein does not swell
// with a high weight). Order when a low target cannot hold all three: fat >= 20 %, then carbohydrate >= 130 g, then
// protein down to the bottom of its range.
import type { GoalId } from './energy.ts';

export interface Macros {
  referenceKg: number;
  protein: { g: number; range: [number, number] };
  fat: { g: number; range: [number, number] };
  carbs: { g: number };
  fibre: number;
}

const PROTEIN: Record<'keep' | 'muscle' | 'lose', [number, number, number]> = { keep: [1.2, 1.6, 1.4], muscle: [1.6, 2.2, 1.8], lose: [1.6, 2.2, 1.8] };

export function macros(o: { kcal: number; kg: number; cm: number; goal: GoalId }): Macros {
  const h = o.cm / 100;
  const bmiNow = o.kg / (h * h);
  const ref = bmiNow < 25 ? o.kg : 25 * h * h;
  const kind = o.goal === 'gain-muscle' ? 'muscle' : o.goal.startsWith('lose') || o.goal === 'recomp' ? 'lose' : 'keep';
  const [pLo, pHi, pDef] = PROTEIN[kind];
  let p = pDef * ref;
  let fat = Math.max((o.kcal * 0.3) / 9, 0.6 * o.kg);
  const fatMin = Math.max((o.kcal * 0.2) / 9, 0.6 * ref);
  let carbs = (o.kcal - p * 4 - fat * 9) / 4;
  if (carbs < 130) {
    // first fat down to its floor, then protein down to the bottom of its range
    fat = Math.max(fatMin, (o.kcal - p * 4 - 130 * 4) / 9);
    carbs = (o.kcal - p * 4 - fat * 9) / 4;
    if (carbs < 130) { p = Math.max(pLo * ref, (o.kcal - fat * 9 - 130 * 4) / 4); carbs = (o.kcal - p * 4 - fat * 9) / 4; }
  }
  const r = (v: number): number => Math.round(v);
  return {
    referenceKg: Math.round(ref * 10) / 10,
    protein: { g: r(p), range: [r(pLo * ref), r(Math.min(pHi, 2.2) * ref)] },
    fat: { g: r(fat), range: [r(Math.max(fatMin, (o.kcal * 0.25) / 9)), r((o.kcal * 0.35) / 9)] },
    carbs: { g: r(Math.max(0, carbs)) },
    fibre: r((o.kcal / 1000) * 14),
  };
}
