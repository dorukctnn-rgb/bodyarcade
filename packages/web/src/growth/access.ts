// Who may use what on the progress coach page: the same entitlements as the games (a paid plan opens every growth:*
// feature, core/entitlements/features.ts canUse) and the active player's profile, so a family plan's players each get
// their own vault. When the entitlements cannot start (offline first visit), the page runs on the free tier.
import { bootEntitlements, type BootWindow } from '../../../core/entitlements/boot.ts';
import { createProfileBook } from '../../../core/store/index.ts';
import type { GrowthAccess } from './ctx.ts';
import { gameInfos, playFromArcade, type PlayFacts } from './play.ts';
import { router } from '../routes.ts';

/** What stays free (SPEC 6.1): photos, compare, lock, backup, the basic program, targets and the sample menus. */
export const GROWTH_FREE: ReadonlySet<string> = new Set(['growth:photos', 'growth:compare', 'growth:lock', 'growth:backup', 'growth:program-basic', 'growth:targets', 'growth:meals-sample']);

export async function growthAccess(win: Window, games: readonly string[]): Promise<GrowthAccess> {
  try {
    let can: (f: string) => boolean = (f) => GROWTH_FREE.has(f);
    const book = createProfileBook({ can: (f) => can(f), known: () => true, ownerName: 'me', recoveredName: (n) => `#${n}`, games: () => [...games], onProblem: () => undefined });
    const boot = await bootEntitlements({ store: book.device, window: win as unknown as BootWindow, rules: { free: (f) => GROWTH_FREE.has(f) } });
    can = (f) => boot.service.can(f as never);
    return { can, profileId: book.active().id };
  } catch {
    return { can: (f) => GROWTH_FREE.has(f), profileId: 'me' };
  }
}

/**
 * The access above and the games' side of the Today panel (kol F): the active profile's arcade (its rounds, seconds and
 * bests; read only here) and the catalogue's games. Without either (an offline first visit), the panels show the program.
 */
export async function growthBoot(win: Window, games: readonly ShellGameLike[]): Promise<{ access: GrowthAccess; play: PlayFacts | null }> {
  const access = await growthAccess(win, games.map((g) => g.id));
  try {
    const book = createProfileBook({ can: (f) => access.can(f), known: () => true, ownerName: 'me', recoveredName: (n) => `#${n}`, games: () => games.map((g) => g.id), onProblem: () => undefined });
    const infos = gameInfos(games);
    const arcade = book.open().arcade({ games: () => games });
    const play = playFromArcade(arcade, infos, (g, lang) => router.href('game', { params: { slug: g.slug }, lang }));
    win.addEventListener('pagehide', () => book.dispose(), { once: true });
    return { access, play };
  } catch {
    return { access, play: null };
  }
}

type ShellGameLike = Parameters<typeof gameInfos>[0][number];
