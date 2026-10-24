// Builds the context a page is drawn from. The browser app, the page generator and the tests all call this, each with
// what it knows; anything left out gets the neutral value (free plan, default settings, a laptop with a camera).
import type { Plan } from '../../core/types/index.ts';
import { SERVER_CAPABILITIES, type UiCapabilities } from '../../core/ui/capabilities.ts';
import { createI18n, type I18nOptions, type Lang } from '../../core/ui/i18n/index.ts';
import type { TrialNotice } from '../../core/entitlements/trial.ts';
import { CHECKING_PAYWALL, STUB_PLANS, WEB_PAYWALL, type PaywallInfo, type PlansConfig } from '../../core/ui/plans.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../core/ui/settings.ts';
import type { ShellGame } from '../catalogue/types.ts';
import { devAssets, type AssetResolver } from './assets.ts';
import type { PlayerFacts } from './app/profiles-model.ts';
import type { Flags, ViewContext } from './context.ts';
import { router } from './routes.ts';

export interface ContextInit {
  lang: Lang;
  games: readonly ShellGame[];
  /** The page's own path and query, in the page language. */
  url: string;
  settings?: Partial<Settings>;
  caps?: UiCapabilities;
  plan?: Plan;
  plans?: PlansConfig;
  paywall?: PaywallInfo;
  trial?: TrialNotice | null;
  player?: PlayerFacts | null;
  assets?: AssetResolver;
  flags?: Partial<Flags>;
  version?: string;
  server?: boolean;
  i18n?: I18nOptions;
}

const NO_OFFERS: PlansConfig = { offers: [], trialEligible: false, trialReminder: false };

export function makeContext(init: ContextInit): ViewContext {
  const lang = init.lang;
  return {
    i18n: createI18n(lang, init.i18n),
    lang,
    settings: { ...DEFAULT_SETTINGS, ...init.settings },
    caps: init.caps ?? SERVER_CAPABILITIES,
    games: init.games,
    plan: init.plan ?? 'free',
    // A page drawn without a visitor has no offers: what can be bought is only known in the browser, and a button in the
    // static page would do nothing until the script is there.
    plans: init.plans ?? (init.server ? NO_OFFERS : STUB_PLANS),
    paywall: init.paywall ?? (init.server ? CHECKING_PAYWALL : WEB_PAYWALL),
    trial: init.trial ?? null,
    player: init.player ?? null,
    assets: init.assets ?? devAssets,
    flags: { social: false, family: false, socialChild: false, ...init.flags },
    url: init.url,
    href: (id, o) => router.href(id, { ...o, lang }),
    version: init.version ?? '0.0.0',
    server: init.server ?? false,
  };
}
