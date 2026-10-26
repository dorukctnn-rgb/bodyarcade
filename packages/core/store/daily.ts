// The daily goal as data. v1 picked a world and a target from a date seed (store.js:130-146); the same draw order is
// kept here, so a given date gives a given goal, but the worlds, the kinds and the number ranges are now a spec a
// game supplies instead of code.
import type { LocalizedString } from '../types/index.ts';
import { daySeed, type Day } from './date.ts';

export interface DailyGoalKind {
  /** Id shown to analytics and the UI ('score', 'cleared', 'coins'). */
  kind: string;
  /** The run stat that must reach the target ('score' and 'seconds' are always available). */
  stat: string;
  /** target = base + floor(random * count) * step */
  base: number;
  step: number;
  count: number;
  /** Text with {target}, per language. */
  text: LocalizedString;
}

export interface DailyGoalSpec {
  /** The variants (worlds) a goal may ask for; the game's free ones, so every player can reach it. */
  variants: string[];
  kinds: DailyGoalKind[];
}

export interface DailyGoal {
  day: Day;
  seed: number;
  variant: string;
  kind: string;
  stat: string;
  target: number;
}

/** The linear congruential generator v1 used for the goal (and copied into sim.js and engine.js). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The goal for a day. Draw order matches v1: one draw per kind for its target (in list order), then one to pick the
 * kind, then one to pick the variant.
 */
export function dailyGoalFor(day: Day, spec: DailyGoalSpec): DailyGoal {
  if (spec.kinds.length === 0 || spec.variants.length === 0) throw new RangeError('a daily goal spec needs kinds and variants');
  const seed = daySeed(day);
  const r = lcg(seed);
  const targets = spec.kinds.map((k) => k.base + Math.floor(r() * k.count) * k.step);
  const idx = Math.floor(r() * spec.kinds.length);
  const variant = spec.variants[Math.floor(r() * spec.variants.length)] as string;
  const kind = spec.kinds[idx] as DailyGoalKind;
  return { day, seed, variant, kind: kind.kind, stat: kind.stat, target: targets[idx] as number };
}

const pick = (t: LocalizedString, locale: string): string => {
  if (typeof t === 'string') return t;
  const short = locale.split('-')[0] ?? 'en';
  return t[locale] ?? t[short] ?? t.en ?? Object.values(t)[0] ?? '';
};

/** The goal sentence in a language, numbers formatted for that language. */
export function goalText(goal: DailyGoal, spec: DailyGoalSpec, locale = 'en'): string {
  const kind = spec.kinds.find((k) => k.kind === goal.kind);
  if (!kind) return '';
  let n: string;
  try { n = goal.target.toLocaleString(locale); } catch { n = String(goal.target); }
  return pick(kind.text, locale).replace('{target}', n);
}

/** The streak after finishing today's goal: it continues only if yesterday's goal was also finished. */
export function nextStreak(prev: { n: number; last: Day | null }, today: Day, yesterday: Day): number {
  return prev.last === yesterday ? prev.n + 1 : 1;
}
