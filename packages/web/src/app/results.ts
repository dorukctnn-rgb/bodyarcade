// From the numbers a round ends with to what the results screen shows: calories as an honest estimate, the reasons
// moves missed (counted and put into words) and the per-player split. Personal bests are the arcade's (core/store).
import type { RunSummary } from '../../../core/types/index.ts';
import type { I18n } from '../../../core/ui/i18n/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { PlayerResult, ResultExtra, RoundResult } from '../views/results.ts';
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

/**
 * Reaction times: the log entries of kind 'tag' that were tapped in time carry the time in ms (Reaction Tag). The average
 * and the best are shown only when there is at least one; a round with no tap has no reaction time to talk about.
 */
export function reactionExtras(log: RunSummary['log'], i18n: I18n, player?: 1 | 2): ResultExtra[] {
  const times = log.filter((e) => e.kind === 'tag' && e.ok && typeof e.v === 'number' && e.v > 0 && (player === undefined || (e.player ?? 1) === player)).map((e) => e.v as number);
  if (times.length === 0) return [];
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const best = Math.round(Math.min(...times));
  return [
    { label: i18n.t('results.reaction.avg'), value: i18n.t('results.reaction.value', { n: i18n.number(avg) }) },
    { label: i18n.t('results.reaction.best'), value: i18n.t('results.reaction.value', { n: i18n.number(best) }) },
  ];
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
  /** Practice: nothing of the round is kept. Default: a round without the camera is practice. */
  practice?: boolean;
}

export function buildRoundResult(i: BuildInput): RoundResult {
  const s = i.summary;
  // A round played with the keyboard or by touch moved no body: no calories, no best (it is not kept), and the page says it is practice.
  const practice = i.practice ?? i.setup.input !== 'camera';
  const players: PlayerResult[] | undefined = s.players
    ? ([1, 2] as const).flatMap((slot) => {
      const p = s.players?.[slot];
      if (!p) return [];
      const extras = reactionExtras(s.log, i.i18n, slot);
      return [{ slot, score: p.score, ...(p.reps !== undefined ? { reps: p.reps } : {}), ...(p.hits !== undefined ? { hits: p.hits } : {}), ...(p.cleared !== undefined ? { cleared: p.cleared } : {}), ...(extras.length ? { extras } : {}) }];
    })
    : undefined;
  const extras = players ? [] : reactionExtras(s.log, i.i18n);
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
    calories: practice ? null : caloriesFor(s.metSeconds, i.weightKg),
    personalBest: !practice && i.previousBest !== null && s.score > i.previousBest && i.setup.players === 1,
    ...(practice ? { practice: true } : {}),
    reasons: reasonsFrom(s.log, i.i18n),
    ...(extras.length ? { extras } : {}),
    ...(players ? { players } : {}),
    replay: i.replay ?? null,
  };
}
