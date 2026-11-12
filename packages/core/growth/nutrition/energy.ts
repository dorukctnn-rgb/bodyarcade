// Energy targets (SPEC 4.1), general information only. Sources:
//   BMR: Mifflin MD, St Jeor ST et al. Am J Clin Nutr 1990;51(2):241-7, https://doi.org/10.1093/ajcn/51.2.241
//   PAL: FAO/WHO/UNU Human energy requirements (2001), table 5.3, https://www.fao.org/4/y5686e/y5686e07.htm
//   Pace: UK CAP Code 13.10 (about 1 kg a week at most), 13.7 (no 800 kcal diets), https://www.asa.org.uk/type/non_broadcast/code_section/13.html
// The person picks a FORMULA (female, male or the middle of both), not a sex. Every result is a range ("people differ by
// 10-15 %") and never goes under the floor.

export type Formula = 'female' | 'male' | 'mid';
export type Activity = 1.4 | 1.55 | 1.75 | 1.95;
export const ACTIVITY: readonly Activity[] = [1.4, 1.55, 1.75, 1.95];

export type GoalId = 'maintain' | 'lose-light' | 'lose-medium' | 'lose-most' | 'gain-muscle' | 'recomp';
export const GOAL_FACTOR: Record<GoalId, [number, number]> = {
  maintain: [1, 1], 'lose-light': [0.9, 0.9], 'lose-medium': [0.85, 0.85], 'lose-most': [0.8, 0.8], 'gain-muscle': [1.05, 1.1], recomp: [0.95, 1],
};

/** Floors: never under the BMR nor these (kcal). 800 and below is impossible by construction. */
export const FLOOR: Record<Formula, number> = { female: 1200, male: 1500, mid: 1350 };
export const KCAL_PER_KG = 7700;

export function bmr(o: { formula: Formula; kg: number; cm: number; age: number }): number {
  const common = 10 * o.kg + 6.25 * o.cm - 5 * o.age;
  return common + (o.formula === 'male' ? 5 : o.formula === 'female' ? -161 : -78);
}

export const tdee = (b: number, pal: Activity): number => b * pal;

export interface EnergyTarget {
  bmr: number;
  tdee: number;
  /** the target (kcal), and the range shown */
  kcal: number;
  range: [number, number];
  /** kg a week this target would change (negative = loss) */
  weeklyKg: number;
  /** what limited it: the pace cap (1 kg or 0.75 % of weight a week) or the floor */
  limitedBy: 'pace' | 'floor' | null;
  floor: number;
}

export function energyTarget(o: { formula: Formula; kg: number; cm: number; age: number; pal: Activity; goal: GoalId; maxDeficitShare?: number }): EnergyTarget {
  const B = bmr(o), T = tdee(B, o.pal);
  const [f0, f1] = GOAL_FACTOR[o.goal];
  let kcal = T * ((f0 + f1) / 2);
  let limitedBy: EnergyTarget['limitedBy'] = null;
  // a softer cap from the eating-concern answer ("a little": at most 10 %)
  if (o.maxDeficitShare !== undefined && kcal < T * (1 - o.maxDeficitShare)) kcal = T * (1 - o.maxDeficitShare);
  if (kcal < T) {
    const maxWeekly = Math.min(o.kg * 0.0075, 1);
    const maxDaily = (maxWeekly * KCAL_PER_KG) / 7;
    if (T - kcal > maxDaily) { kcal = T - maxDaily; limitedBy = 'pace'; }
  }
  const floor = Math.max(B, FLOOR[o.formula]);
  if (kcal < floor) { kcal = floor; limitedBy = 'floor'; }
  const round = (v: number): number => Math.round(v / 10) * 10;
  const k = Math.round(kcal);
  return {
    bmr: Math.round(B), tdee: Math.round(T), kcal: k,
    range: [Math.max(round(floor), round(k * 0.95)), round(k * 1.05)],
    weeklyKg: Math.round(((k - T) * 7) / KCAL_PER_KG * 100) / 100,
    limitedBy, floor: Math.round(floor),
  };
}

export const bmi = (kg: number, cm: number): number => kg / (cm / 100) ** 2;
