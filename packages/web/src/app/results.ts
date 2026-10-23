// From the numbers a round ends with to what the results screen shows: calories as an honest estimate, the reasons
// moves missed (counted and put into words), personal bests kept per game and difficulty, and the per-player split.
import type { RunSummary, Schema } from '../../../core/types/index.ts';
import type { I18n } from '../../../core/ui/i18n/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { PlayerResult, RoundResult } from '../views/results.ts';
import type { SetupState } from '../views/setup.ts';

/**
 * Calories from the game's MET value, the player's weight and the time spent moving:
 * kcal = MET x 3.5 x kg / 200 per minute, so with metSeconds = MET x seconds it is metSeconds x 3.5 x kg / 12000.
 * Without a weight there is no number: a made-up one would not be an estimate.
 */
export function caloriesFor(metSeconds: number, weightKg: number | null): number | null {
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg < 25 || weightKg > 300) return null;
  if (!Number.isFinite(metSeconds) || metSeconds <= 0) return 0;
  return (metSeconds * 3.5 * weightKg) / 12000;
}

/** The misses of a run, most frequent first, each in the player's words (a string per code: `miss.<code>`). */
export function reasonsFrom(log: RunSummary['log'], i18n: I18n): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of log) if (!e.ok) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, count]) => ({ text: i18n.has(`miss.${kind}`) ? i18n.tx(`miss.${kind}`) : i18n.t('results.why.other'), count }));
}

export interface BuildInput {
  game: ShellGame;
  setup: SetupState;
  summary: RunSummary;
  weightKg: number | null;
  i18n: I18n;
  /** The best score before this round for this game and difficulty, or null when there was none. */
  previousBest: number | null;
  /** The one second skeleton replay of a miss, when the session recorded one (it does not yet). */
  replay?: { reason: string } | null;
}

export function buildRoundResult(i: BuildInput): RoundResult {
  const s = i.summary;
  const players: PlayerResult[] | undefined = s.players
    ? ([1, 2] as const).flatMap((slot) => {
      const p = s.players?.[slot];
      if (!p) return [];
      return [{ slot, score: p.score, ...(p.reps !== undefined ? { reps: p.reps } : {}), ...(p.hits !== undefined ? { hits: p.hits } : {}), ...(p.cleared !== undefined ? { cleared: p.cleared } : {}) }];
    })
    : undefined;
  return {
    gameId: i.game.id,
    setup: i.setup,
    score: s.score,
    seconds: s.seconds,
    ...(s.reps !== undefined ? { reps: s.reps } : {}),
    ...(s.hits !== undefined ? { hits: s.hits } : {}),
    ...(s.cleared !== undefined ? { cleared: s.cleared } : {}),
    ...(s.bestStreak !== undefined ? { bestStreak: s.bestStreak } : {}),
    ...(s.quality !== undefined ? { quality: s.quality } : {}),
    calories: caloriesFor(s.metSeconds, i.weightKg),
    personalBest: i.previousBest !== null && s.score > i.previousBest && i.setup.players === 1,
    reasons: reasonsFrom(s.log, i.i18n),
    ...(players ? { players } : {}),
    replay: i.replay ?? null,
  };
}

// ---- personal bests ------------------------------------------------------------------------------------------------

/** game id -> difficulty -> best score. */
export type Bests = Record<string, Record<string, number>>;

export const BESTS_SCHEMA: Schema<Bests> = {
  version: 1,
  parse(raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const out: Bests = {};
    for (const [game, byLevel] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof byLevel !== 'object' || byLevel === null || Array.isArray(byLevel)) continue;
      const clean: Record<string, number> = {};
      for (const [level, v] of Object.entries(byLevel as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[level] = v;
      out[game] = clean;
    }
    return out;
  },
};

export const bestOf = (b: Bests, game: string, difficulty: string): number | null => b[game]?.[difficulty] ?? null;

/** Returns the new set of bests; a lower or equal score changes nothing. */
export function withBest(b: Bests, game: string, difficulty: string, score: number): Bests {
  const prev = bestOf(b, game, difficulty);
  if (prev !== null && score <= prev) return b;
  return { ...b, [game]: { ...(b[game] ?? {}), [difficulty]: score } };
}
