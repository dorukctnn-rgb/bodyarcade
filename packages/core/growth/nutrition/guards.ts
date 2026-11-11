// Safety gates (SPEC 4.2), in code and under test. They decide what the nutrition part may show at all; Pro never loosens
// them. Codes only; the page words them (every nutrition screen also says "general information, not medical advice").
//   1 age under 18: no calorie or macro target, no weight-loss goal, no body photos; the program stays (capped).
//   2 floors and pace: energy.ts (never under max(BMR, formula floor); at most 1 kg or 0.75 % of weight a week).
//   3 BMI under 18.5: no loss or recomposition goals; 18.5-20: loss only "light"; a goal weight never under BMI 18.5.
//   4 pregnant or breastfeeding: no numbers, no deficit, no program build; "ask your doctor or midwife".
//   5 a health condition on the list: no numeric nutrition target; program after "I talked with my doctor".
//   6 eating concern: "a little": numbers hidden by default, deficit at most 10 %; "yes": numbers hidden for good, no
//     deficit, no weigh-in reminders, weight chart hidden, a support page.
//   7 fast change: a weight trend dropping more than 1 % a week for 3 weeks slows the target and says so.
import { bmi, energyTarget, type Activity, type EnergyTarget, type Formula, type GoalId } from './energy.ts';
import { macros, type Macros } from './macros.ts';

export const CONDITIONS = ['diabetes', 'kidney', 'heart', 'blood-pressure', 'weight-medicine', 'surgery-6m', 'eating-disorder'] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Profile {
  birthYear: number;
  heightCm: number;
  weightKg: number;
  formula: Formula;
  pal: Activity;
  pregnant: boolean;
  conditions: readonly Condition[];
  /** "Do food or weight wear you out a lot these days?" */
  concern: 'no' | 'a-little' | 'yes';
  /** the person's own switch: hide every number */
  hideNumbers?: boolean;
}

export type Gate = 'minor' | 'pregnant' | 'condition' | 'concern' | 'underweight' | 'low-bmi';
export type Note = 'ask-doctor' | 'ask-doctor-midwife' | 'ask-doctor-dietitian' | 'talk-family-doctor' | 'support-page' | 'floor' | 'pace' | 'reference-weight' | 'general-info';

export interface NutritionView {
  /** numbers may be shown at all (false: hand portions only) */
  numbers: boolean;
  /** numbers hidden because the person chose so or a gate requires it (and whether the person may turn them back on) */
  numbersLocked: boolean;
  goals: GoalId[];
  target: EnergyTarget | null;
  macros: Macros | null;
  gates: Gate[];
  notes: Note[];
  /** the program may be built (pregnancy: no; conditions: after the doctor confirmation) */
  program: 'yes' | 'needs-doctor-ok' | 'no';
  photos: boolean;
  weighInReminders: boolean;
  weightChart: boolean;
  adaptive: boolean;
}

export const ageOf = (birthYear: number, now: Date): number => now.getUTCFullYear() - birthYear;

export function allowedGoals(p: Pick<Profile, 'heightCm' | 'weightKg'>, age: number): GoalId[] {
  const b = bmi(p.weightKg, p.heightCm);
  if (age < 18) return ['maintain'];
  if (b < 18.5) return ['maintain', 'gain-muscle'];
  if (b < 20) return ['maintain', 'lose-light', 'gain-muscle', 'recomp'];
  return ['maintain', 'lose-light', 'lose-medium', 'lose-most', 'gain-muscle', 'recomp'];
}

/** The lowest goal weight that may be entered (BMI 18.5). */
export const minGoalWeight = (heightCm: number): number => Math.ceil(18.5 * (heightCm / 100) ** 2 * 10) / 10;

export function nutritionView(p: Profile, goal: GoalId | null, now = new Date()): NutritionView {
  const age = ageOf(p.birthYear, now);
  const gates: Gate[] = [], notes: Note[] = ['general-info'];
  const b = bmi(p.weightKg, p.heightCm);
  const v: NutritionView = { numbers: true, numbersLocked: false, goals: allowedGoals(p, age), target: null, macros: null, gates, notes, program: 'yes', photos: true, weighInReminders: true, weightChart: true, adaptive: true };
  if (age < 18) { gates.push('minor'); notes.push('talk-family-doctor'); v.numbers = false; v.numbersLocked = true; v.photos = false; v.adaptive = false; v.weighInReminders = false; return v; }
  if (p.pregnant) { gates.push('pregnant'); notes.push('ask-doctor-midwife'); v.numbers = false; v.numbersLocked = true; v.goals = []; v.program = 'no'; v.adaptive = false; v.weighInReminders = false; return v; }
  if (p.conditions.length) { gates.push('condition'); notes.push('ask-doctor-dietitian'); v.numbers = false; v.numbersLocked = true; v.goals = []; v.program = 'needs-doctor-ok'; v.adaptive = false; return v; }
  if (b < 18.5) { gates.push('underweight'); notes.push('ask-doctor'); }
  else if (b < 20) gates.push('low-bmi');
  let maxDeficitShare: number | undefined;
  if (p.concern === 'yes') {
    gates.push('concern'); notes.push('support-page');
    v.numbers = false; v.numbersLocked = true; v.weighInReminders = false; v.weightChart = false; v.adaptive = false;
    v.goals = v.goals.filter((g) => !g.startsWith('lose') && g !== 'recomp');
  } else if (p.concern === 'a-little') {
    maxDeficitShare = 0.1;
    v.goals = v.goals.filter((g) => g !== 'lose-medium' && g !== 'lose-most');
  }
  if (p.hideNumbers) { v.numbers = false; v.adaptive = false; }
  const g: GoalId = goal && v.goals.includes(goal) ? goal : 'maintain';
  v.target = energyTarget({ formula: p.formula, kg: p.weightKg, cm: p.heightCm, age, pal: p.pal, goal: g, ...(maxDeficitShare !== undefined ? { maxDeficitShare } : {}) });
  v.macros = macros({ kcal: v.target.kcal, kg: p.weightKg, cm: p.heightCm, goal: g });
  if (v.target.limitedBy === 'floor') notes.push('floor');
  if (v.target.limitedBy === 'pace') notes.push('pace');
  if (b >= 25) notes.push('reference-weight');
  return v;
}

/** What a hidden-numbers view may hand to the screen: never a calorie, gram or kilo figure (tested). */
export function screenModel(v: NutritionView): { numbers: false; portions: true } | { numbers: true; kcal: [number, number]; protein: [number, number]; fat: number; carbs: number; fibre: number } {
  if (!v.numbers || !v.target || !v.macros) return { numbers: false, portions: true };
  return { numbers: true, kcal: v.target.range, protein: v.macros.protein.range, fat: v.macros.fat.g, carbs: v.macros.carbs.g, fibre: v.macros.fibre };
}

/** Rule 7: a 7-day smoothed weight trend that fell more than 1 % a week, three weeks running. */
export function fastChange(weeklyAverages: readonly number[]): boolean {
  if (weeklyAverages.length < 4) return false;
  const w = weeklyAverages.slice(-4);
  for (let i = 1; i < 4; i++) if ((w[i - 1]! - w[i]!) / w[i - 1]! <= 0.01) return false;
  return true;
}

/** The adaptive target (SPEC 4.1, MacroFactor's lesson, kept simple): at most +-100 kcal per 14 days, inside every limit. */
export function adaptTarget(o: { target: EnergyTarget; weighIns21d: number; expectedKgPer14d: number; trendKgPer14d: number; allowed: boolean }): number {
  if (!o.allowed || o.weighIns21d < 10) return o.target.kcal;
  const diff = o.trendKgPer14d - o.expectedKgPer14d;
  if (Math.abs(diff) < 0.2) return o.target.kcal;
  const step = diff > 0 ? -100 : 100;
  return Math.max(o.target.floor, o.target.kcal + step);
}

/** Words the nutrition texts never use, in every language (SPEC 4.2 rule 6, 6.3); the strings test reads them. */
export const BANNED_WORDS: Record<string, readonly string[]> = {
  en: ['good food', 'bad food', 'cheat', 'earned', 'earn it', 'guilt', 'detox', 'cleanse', 'burn fat', 'fat burning', 'cure', 'treat', 'guarantee', 'transformation'],
  tr: ['iyi yiyecek', 'kötü yiyecek', 'kaçamak', 'hak ettin', 'suçluluk', 'detoks', 'arınma', 'yağ yak', 'tedavi', 'iyileştir', 'garanti', 'dönüşüm'],
  de: ['gutes essen', 'schlechtes essen', 'cheat', 'verdient', 'schuld', 'detox', 'entgift', 'fett verbrenn', 'heilt', 'garantie', 'verwandlung'],
  es: ['comida buena', 'comida mala', 'trampa', 'te lo ganaste', 'culpa', 'detox', 'desintox', 'quema grasa', 'quemar grasa', 'cura', 'garantía', 'transformación'],
  fr: ['bonne nourriture', 'mauvaise nourriture', 'écart', 'mérité', 'culpabilité', 'détox', 'brûle les graisses', 'brûler les graisses', 'guérit', 'garantie', 'transformation'],
};
