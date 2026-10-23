// Achievements as data. v1 hard-wired fifteen of them into afterRun (store.js:184-208). Now each game ships a list of
// definitions (id, texts, a condition) and one small interpreter decides which are newly unlocked after a run, so a
// game adds achievements by editing JSON, not code, and the rules are testable without a game.
import type { LocalizedString } from '../types/index.ts';

export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  /** A stat of the run that just ended ('score' and 'seconds' are always there; others come from the game). */
  | { run: string; gte?: number; lte?: number; eq?: number }
  /** The run was finished, not ended by running out of lives. */
  | { complete: true }
  | { difficulty: string[] }
  /** A lifetime total: 'runs', 'seconds', 'kcal' or any stat the game sums. */
  | { total: string; gte: number }
  /** Variants (worlds, biomes) played so far: a count, and/or a list that must all be present. */
  | { variants: { gte?: number; includes?: string[] } }
  | { streak: { gte: number } }
  | { beatFriend: true };

export interface AchievementDef {
  id: string;
  name: LocalizedString;
  desc: LocalizedString;
  when: Cond;
}

export interface AchievementContext {
  run: { score: number; seconds: number; complete: boolean; difficulty: string; stats: Readonly<Record<string, number>> };
  totals: Readonly<Record<string, number>>;
  variants: readonly string[];
  /** The daily-goal streak counted through today; 0 while today's goal is not met (v1 only checked it on the run that met it). */
  streak: number;
  friend: { score: number } | null;
}

const runStat = (ctx: AchievementContext, name: string): number | undefined => {
  if (name === 'score') return ctx.run.score;
  if (name === 'seconds') return ctx.run.seconds;
  const v = ctx.run.stats[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/** True when the condition holds. A stat the game did not report never satisfies a condition. */
export function holds(c: Cond, ctx: AchievementContext): boolean {
  if ('all' in c) return c.all.every((x) => holds(x, ctx));
  if ('any' in c) return c.any.some((x) => holds(x, ctx));
  if ('run' in c) {
    const v = runStat(ctx, c.run);
    if (v === undefined) return false;
    return (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte) && (c.eq === undefined || v === c.eq);
  }
  if ('complete' in c) return ctx.run.complete;
  if ('difficulty' in c) return c.difficulty.includes(ctx.run.difficulty);
  if ('total' in c) return (ctx.totals[c.total] ?? 0) >= c.gte;
  if ('variants' in c) {
    const { gte, includes } = c.variants;
    return (gte === undefined || ctx.variants.length >= gte) && (includes === undefined || includes.every((v) => ctx.variants.includes(v)));
  }
  if ('streak' in c) return ctx.streak >= c.streak.gte;
  if ('beatFriend' in c) return ctx.friend !== null && ctx.run.score > ctx.friend.score;
  return false;
}

/** Ids newly unlocked by this run, in definition order. Already unlocked ones are never repeated. */
export function newlyUnlocked(defs: readonly AchievementDef[], ctx: AchievementContext, already: ReadonlySet<string>): AchievementDef[] {
  return defs.filter((d) => !already.has(d.id) && holds(d.when, ctx));
}

// ── validation of definitions that come from JSON ──
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const keys = (o: object): string[] => Object.keys(o);

export function isCond(x: unknown, depth = 0): x is Cond {
  if (depth > 8 || typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const k = keys(o);
  if (k.length === 0) return false;
  if ('all' in o || 'any' in o) {
    const list = (o.all ?? o.any) as unknown;
    return k.length === 1 && Array.isArray(list) && list.length > 0 && list.length <= 20 && list.every((c) => isCond(c, depth + 1));
  }
  if ('run' in o) {
    return typeof o.run === 'string' && o.run.length > 0 && k.every((x2) => ['run', 'gte', 'lte', 'eq'].includes(x2))
      && k.length > 1 && ['gte', 'lte', 'eq'].every((n) => o[n] === undefined || num(o[n]));
  }
  if ('complete' in o) return k.length === 1 && o.complete === true;
  if ('difficulty' in o) return k.length === 1 && Array.isArray(o.difficulty) && o.difficulty.length > 0 && o.difficulty.every((d) => typeof d === 'string');
  if ('total' in o) return k.length === 2 && typeof o.total === 'string' && num(o.gte);
  if ('variants' in o) {
    const v = o.variants as Record<string, unknown> | null;
    return k.length === 1 && typeof v === 'object' && v !== null && keys(v).length > 0
      && (v.gte === undefined || num(v.gte)) && (v.includes === undefined || (Array.isArray(v.includes) && v.includes.every((s) => typeof s === 'string')))
      && keys(v).every((n) => n === 'gte' || n === 'includes');
  }
  if ('streak' in o) {
    const s = o.streak as Record<string, unknown> | null;
    return k.length === 1 && typeof s === 'object' && s !== null && num(s.gte);
  }
  if ('beatFriend' in o) return k.length === 1 && o.beatFriend === true;
  return false;
}

const isText = (x: unknown): x is LocalizedString =>
  (typeof x === 'string' && x.length > 0 && x.length <= 200)
  || (typeof x === 'object' && x !== null && !Array.isArray(x) && keys(x).length > 0 && Object.values(x).every((v) => typeof v === 'string' && v.length <= 200));

/** Checks a definition list (for example a game's content/achievements.json). Returns the list or throws with the reason. */
export function assertAchievementDefs(raw: unknown): AchievementDef[] {
  if (!Array.isArray(raw)) throw new TypeError('achievements must be a list');
  const seen = new Set<string>();
  for (const d of raw as unknown[]) {
    const o = d as Record<string, unknown> | null;
    if (typeof o !== 'object' || o === null) throw new TypeError('achievement must be an object');
    if (typeof o.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(o.id)) throw new TypeError(`bad achievement id: ${String(o.id)}`);
    if (seen.has(o.id)) throw new TypeError(`duplicate achievement id: ${o.id}`);
    seen.add(o.id);
    if (!isText(o.name) || !isText(o.desc)) throw new TypeError(`achievement ${o.id} needs a name and a description`);
    if (!isCond(o.when)) throw new TypeError(`achievement ${o.id} has an invalid condition`);
  }
  return raw as AchievementDef[];
}
