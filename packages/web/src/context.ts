// Everything a view needs to draw itself. Views are plain functions of this context, so the browser app and the page
// generator draw exactly the same markup, and a test can draw any screen in any state without a browser.
import type { BodyRegion, Plan } from '../../core/types/index.ts';
import { localized } from '../../core/ui/i18n/localized.ts';
import type { I18n, Lang } from '../../core/ui/i18n/index.ts';
import type { UiCapabilities } from '../../core/ui/capabilities.ts';
import type { TrialNotice } from '../../core/entitlements/trial.ts';
import type { PaywallInfo, PlansConfig } from '../../core/ui/plans.ts';
import type { HrefOptions } from '../../core/ui/router.ts';
import type { Settings } from '../../core/ui/settings.ts';
import type { ShellGame } from '../catalogue/types.ts';
import type { AssetResolver } from './assets.ts';
import type { PlayerFacts } from './app/profiles-model.ts';
import type { RouteId } from './routes.ts';

export interface Flags {
  /** Friends, lobbies and rooms. Off until the social server exists, and for a player who has no online identity (a child); the tab and the page stay hidden. */
  social: boolean;
  /** The Family plan is sold: the players screen may offer to add players to someone who has none to add yet. */
  family: boolean;
  /** The friends side exists in this build but the player has no online identity (a child): its pages say so and lead to the main player. */
  socialChild: boolean;
  /** The Room checks the host's signed Pro before a Pro game starts, so the paywall may say that a room plays the host's Pro games. */
  roomsPro: boolean;
}

export interface ViewContext {
  i18n: I18n;
  lang: Lang;
  settings: Readonly<Settings>;
  caps: UiCapabilities;
  games: readonly ShellGame[];
  /** What the player owns. 'free' until Pro is active. */
  plan: Plan;
  plans: PlansConfig;
  /** What the paywall may do where this page runs (the web shop, Google Play, neither). */
  paywall: PaywallInfo;
  /** The last two days of a free trial: the notice shown on every open. Null otherwise (and for a player whose purchases need a grown-up). */
  trial: TrialNotice | null;
  /** Who is playing on this device and what their rules allow; null where there is no player (the page generator). */
  player: PlayerFacts | null;
  assets: AssetResolver;
  flags: Flags;
  /** The page being drawn: its path and query in the page language, for the language links and the current tab. */
  url: string;
  /** A link to a page, in the page language. */
  href(id: RouteId, o?: Omit<HrefOptions, 'lang'>): string;
  /** Shown on the settings page. */
  version: string;
  /** True in the page generator: nothing may depend on this visitor, and nothing claims to know their device. */
  server: boolean;
}

export const titleOf = (ctx: Pick<ViewContext, 'lang'>, g: ShellGame): string => localized(g.title, ctx.lang);
export const taglineOf = (ctx: Pick<ViewContext, 'lang'>, g: ShellGame): string => localized(g.catalogue.tagline, ctx.lang);
export const aboutOf = (ctx: Pick<ViewContext, 'lang'>, g: ShellGame): string => localized(g.catalogue.about, ctx.lang);
/** What the game is, in the words of the page's language ("a boxing workout game"); null when the game has none in that language (never another language's words). */
export const kindOf = (ctx: Pick<ViewContext, 'lang'>, g: ShellGame): string | null => {
  const k = g.catalogue.kind;
  return k && typeof k !== 'string' && k[ctx.lang] ? k[ctx.lang] ?? null : null;
};

export const regionLabel = (ctx: Pick<ViewContext, 'i18n'>, r: BodyRegion): string => ctx.i18n.tx(`region.${r}`);

/** The first region a game lists, for its tile. */
export const mainRegion = (g: ShellGame): BodyRegion => g.regions[0] ?? 'cardio';

/** Does this player have the whole catalogue? */
export const hasPro = (ctx: Pick<ViewContext, 'plan'>): boolean => ctx.plan !== 'free';

/** What a player may do with a game right now. */
export type Access = 'free' | 'pro' | 'once' | 'locked';

/**
 * 'free': a free game; 'pro': Pro is active; 'once': a Pro game this player has not tried yet (one free round);
 * 'locked': a Pro game already tried once.
 */
export function accessOf(ctx: Pick<ViewContext, 'plan' | 'settings'>, g: ShellGame): Access {
  if (g.free) return 'free';
  if (hasPro(ctx)) return 'pro';
  return ctx.settings.playedOnce.includes(g.id) ? 'locked' : 'once';
}

/** Round length for a tile: "5 min", "90 sec". */
export function durationLabel(ctx: Pick<ViewContext, 'i18n'>, seconds: number): string {
  return seconds >= 90 ? ctx.i18n.t('duration.min', { n: Math.round(seconds / 60) }) : ctx.i18n.t('duration.sec', { n: Math.round(seconds) });
}
