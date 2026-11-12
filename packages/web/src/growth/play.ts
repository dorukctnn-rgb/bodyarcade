// The games' side of the Today panel and the progress page (kol F): which games there are (the catalogue) and what the
// player did in them (the arcade of the active profile: rounds, seconds per day, bests). Read-only here; the games write
// it when a round ends. And the facts the panels are worked out from (core/growth/today/history.ts): the vault's sets,
// check-ins, photo and measurement days, plus these. Nothing leaves the device.
import type { Arcade } from '../../../core/store/arcade.ts';
import { dayOf, type Day } from '../../../core/store/date.ts';
import type { BodyRegion, LocalizedString } from '../../../core/types/index.ts';
import type { Lang } from '../../../core/ui/i18n/index.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import type { DailyCheckin } from '../../../core/growth/program/checkin.ts';
import { MOVE_META } from '../../../core/growth/program/moves-meta.ts';
import { setValue, type SetLog } from '../../../core/growth/program/session.ts';
import type { Facts, RunFact, SetFact } from '../../../core/growth/today/history.ts';
import type { GameCard } from '../../../core/growth/today/today.ts';
import type { Ctx } from './ctx.ts';

export interface GameInfo extends GameCard { title: LocalizedString; slug: string }

export interface PlayRead { runs: RunFact[]; gameSeconds: Record<Day, number>; gameBests: { game: string; best: number }[] }

export interface PlayFacts {
  games: readonly GameInfo[];
  /** what the arcade holds now (read each time a panel draws) */
  read(): PlayRead;
  /** the game's page on the site (its play button, calibration and Pro gate live there) */
  href(game: GameInfo, lang: Lang): string;
}

/** The catalogue's game entries (manifest + catalogue block) as the panel's game cards. */
export function gameInfos(games: readonly { id: string; free: boolean; regions: readonly BodyRegion[]; lowImpact: boolean; seated: boolean; durationSec: number; title: LocalizedString; seo: { slug: string } }[]): GameInfo[] {
  return games.map((g) => ({ id: g.id, free: g.free, regions: [...g.regions], lowImpact: g.lowImpact, seated: g.seated, durationSec: g.durationSec, title: g.title, slug: g.seo.slug }));
}

export const gameTitle = (g: GameInfo | undefined, lang: Lang, fallback: string): string => (g ? localized(g.title, lang) : fallback);

/** The arcade of the active profile as the panels' play facts. A game that throws (renamed, gone) is skipped. */
export function playFromArcade(arcade: Arcade, games: readonly GameInfo[], href: (g: GameInfo, lang: Lang) => string): PlayFacts {
  return {
    games,
    href,
    read() {
      const runs: RunFact[] = [];
      const gameSeconds: Record<Day, number> = {};
      const gameBests: { game: string; best: number }[] = [];
      for (const g of games) {
        try {
          const p = arcade.progress(g.id);
          for (const r of p.runs()) runs.push({ day: r.day, game: g.id, t: r.t, score: r.score, seconds: r.seconds });
          for (const [d, a] of Object.entries(p.activity())) gameSeconds[d] = (gameSeconds[d] ?? 0) + a.seconds;
          const best = p.best();
          if (best > 0) gameBests.push({ game: g.id, best });
        } catch { /* a game the arcade does not know: nothing to read */ }
      }
      return { runs, gameSeconds, gameBests };
    },
  };
}

interface StoredCheckin { date: string; a: DailyCheckin }

/** Every check-in kept: one per day ('day:YYYY-MM-DD'), and the program tab's latest one. */
export async function loadCheckins(c: Pick<Ctx, 'vault'>): Promise<{ day: Day; a: DailyCheckin }[]> {
  const out = new Map<Day, DailyCheckin>();
  for (const { id, value } of await c.vault.all<StoredCheckin>('program')) {
    if (id.startsWith('day:') && value?.date && value.a) out.set(value.date, value.a);
    else if (id === 'checkin' && value?.date && value.a && !out.has(value.date)) out.set(value.date, value.a);
  }
  return [...out].map(([day, a]) => ({ day, a })).sort((x, y) => (x.day < y.day ? -1 : 1));
}

/** Saves today's answers: the day's own record (the history) and the program tab's latest one. */
export async function saveCheckin(c: Pick<Ctx, 'vault'>, day: Day, a: DailyCheckin): Promise<void> {
  await c.vault.putJson('program', `day:${day}`, { date: day, a });
  await c.vault.putJson('program', 'checkin', { date: day, a });
}

export const todayDay = (): Day => dayOf(Date.now());

/** All the facts the panels are worked out from. */
export async function collectFacts(c: Pick<Ctx, 'vault' | 'play'>, today: Day = todayDay()): Promise<Facts> {
  const logs = await c.vault.all<SetLog>('logs');
  const sets: SetFact[] = [];
  for (const { value: l } of logs) {
    if (!l || !MOVE_META[l.moveId] || !Number.isFinite(l.startedAt)) continue;
    const s: SetFact = { day: dayOf(l.startedAt), sessionId: l.sessionId, move: l.moveId, value: setValue(l, MOVE_META[l.moveId].unit), startedAt: l.startedAt, endedAt: Number.isFinite(l.endedAt) ? l.endedAt : l.startedAt };
    if (l.loadKg !== undefined) s.loadKg = l.loadKg;
    sets.push(s);
  }
  const photoDays = (await c.vault.all<{ at: number }>('sessions')).map((x) => x.value?.at).filter((x): x is number => Number.isFinite(x)).map((x) => dayOf(x));
  const measureDays = (await c.vault.all<{ at: number }>('measures')).map((x) => x.value?.at).filter((x): x is number => Number.isFinite(x)).map((x) => dayOf(x));
  let play: PlayRead = { runs: [], gameSeconds: {}, gameBests: [] };
  try { if (c.play) play = c.play.read(); } catch { /* the games' record could not be read: the program's facts still count */ }
  return { today, sets, runs: play.runs, gameSeconds: play.gameSeconds, gameBests: play.gameBests, checkins: await loadCheckins(c), photoDays, measureDays };
}
