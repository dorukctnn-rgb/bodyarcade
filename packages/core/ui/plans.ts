// The four plans the paywall shows (BUILD-PLAN: Pro monthly, Pro yearly with a trial, Family yearly, Lifetime) and the
// rules for what the paywall may say about them. Prices, trial length and checkout targets come from the entitlements
// (core/entitlements: paywallModel); STUB_PLANS below mirrors BUILD-PLAN for the pages that are drawn without a visitor
// (the page generator, tests) and has no checkout address at all.
import type { Plan } from '../types/index.ts';
import type { I18n } from './i18n/index.ts';

export type PlanId = 'pro-monthly' | 'pro-yearly' | 'family-yearly' | 'lifetime';
export type Period = 'month' | 'year' | 'once';

export interface PlanOffer {
  id: PlanId;
  /** The entitlement this plan grants. */
  plan: Exclude<Plan, 'free'>;
  period: Period;
  price: { amount: number; currency: string };
  /** Free trial length in days. Shown only when the trial really applies to this player (see trialApplies). */
  trialDays?: number;
  profiles?: number;
  devices?: number;
  featured?: boolean;
  /** Web: the Gumroad checkout URL. Android app: the Play product id, handled by the billing bridge. Never both. */
  checkout: { web?: string; play?: string };
}

/**
 * What the paywall may do where it runs, from the entitlements' paywall model. 'web': the plans with a real checkout
 * address and the licence key box. 'play': Google's own plans and no word about another shop. 'play-unsupported': the app
 * cannot sell here. 'neutral': the proof of where it runs is not in yet.
 */
export interface PaywallInfo {
  mode: 'web' | 'play' | 'play-unsupported' | 'neutral';
  /** Something honest to say instead of offers. */
  note: 'unavailable' | 'play-only' | 'checking' | null;
  keyEntry: { visible: boolean; wording: 'web' | 'neutral' };
  /** Play's own page for changing or cancelling a subscription (play mode only). */
  manageUrl: string | null;
  /** The offers are made up for a preview (development and test builds, or a build made for a design review): the buy button says so. */
  preview: boolean;
}

/** The paywall of a page that is drawn without a visitor: the web, with whatever plans the page was given. */
export const WEB_PAYWALL: PaywallInfo = { mode: 'web', note: null, keyEntry: { visible: true, wording: 'web' }, manageUrl: null, preview: false };

/** What a page drawn without a visitor says about buying: it does not know yet, and nothing on it can be pressed. */
export const CHECKING_PAYWALL: PaywallInfo = { mode: 'neutral', note: 'checking', keyEntry: { visible: false, wording: 'neutral' }, manageUrl: null, preview: false };

export interface PlansConfig {
  offers: readonly PlanOffer[];
  /** False when this player already used a trial (Gumroad allows one) or the provider offers none. */
  trialEligible: boolean;
  /** The app sends a reminder two days before a trial ends. Say so only when this is true. */
  trialReminder: boolean;
}

export const STUB_PLANS: PlansConfig = {
  trialEligible: true,
  trialReminder: true,
  offers: [
    { id: 'pro-monthly', plan: 'pro', period: 'month', price: { amount: 7.99, currency: 'USD' }, checkout: {} },
    { id: 'pro-yearly', plan: 'pro', period: 'year', price: { amount: 39.99, currency: 'USD' }, trialDays: 7, featured: true, checkout: {} },
    { id: 'family-yearly', plan: 'family', period: 'year', price: { amount: 59.99, currency: 'USD' }, profiles: 6, devices: 4, checkout: {} },
    { id: 'lifetime', plan: 'lifetime', period: 'once', price: { amount: 119.99, currency: 'USD' }, checkout: {} },
  ],
};

/** The plans that have a free trial. Pro yearly only: Family, monthly and Lifetime have none, whatever a config says. */
export const TRIAL_PLANS: readonly PlanId[] = ['pro-yearly'];

/**
 * "7 days free" and the sentence about the reminder appear together and only when the entitlements say a trial is on offer
 * (`trialReminder`: this player can still use one and a plan has it), the offer is one that has a trial and carries its length.
 */
export function trialApplies(offer: PlanOffer, cfg: Pick<PlansConfig, 'trialEligible' | 'trialReminder'>): boolean {
  return cfg.trialEligible && cfg.trialReminder && TRIAL_PLANS.includes(offer.id) && typeof offer.trialDays === 'number' && offer.trialDays > 0;
}

/** Price per month for a yearly plan, rounded to cents; null for other periods. */
export function perMonth(offer: PlanOffer): number | null {
  return offer.period === 'year' ? Math.round((offer.price.amount / 12) * 100) / 100 : null;
}

/** How much cheaper the yearly Pro plan is than twelve monthly payments, as a whole percent (a real figure, not a sale). */
export function yearlySavingsPercent(cfg: Pick<PlansConfig, 'offers'>): number | null {
  const m = cfg.offers.find((o) => o.id === 'pro-monthly');
  const y = cfg.offers.find((o) => o.id === 'pro-yearly');
  if (!m || !y || m.price.currency !== y.price.currency) return null;
  const pct = Math.round((1 - y.price.amount / (m.price.amount * 12)) * 100);
  return pct > 0 ? pct : null;
}

export interface OfferText {
  name: string;
  /** "$39.99 a year", "$119.99 once". */
  priceLine: string;
  /** The line under the price: per-month figure, profiles, or nothing. */
  detail: string;
  /** "7 days free, then $39.99 a year" only when the trial applies, else null. */
  trialLine: string | null;
  /** The label of the buy button for this offer. */
  cta: string;
}

const NAME_KEY = {
  'pro-monthly': 'paywall.plan.proMonthly',
  'pro-yearly': 'paywall.plan.proYearly',
  'family-yearly': 'paywall.plan.familyYearly',
  lifetime: 'paywall.plan.lifetime',
} as const;

export function describeOffer(offer: PlanOffer, i18n: I18n, cfg: Pick<PlansConfig, 'trialEligible' | 'trialReminder'>): OfferText {
  const money = i18n.currency(offer.price.amount, offer.price.currency);
  const priceLine = i18n.t(offer.period === 'month' ? 'paywall.price.month' : offer.period === 'year' ? 'paywall.price.year' : 'paywall.price.once', { price: money });
  const pm = perMonth(offer);
  const parts: string[] = [];
  if (offer.profiles) parts.push(i18n.t('paywall.profiles', { n: offer.profiles }));
  if (pm !== null) parts.push(i18n.t('paywall.perMonth', { price: i18n.currency(pm, offer.price.currency) }));
  const trial = trialApplies(offer, cfg);
  return {
    name: i18n.t(NAME_KEY[offer.id]),
    priceLine,
    detail: parts.join('. '),
    trialLine: trial ? i18n.t('paywall.trialLine', { days: offer.trialDays ?? 0, price: priceLine }) : null,
    cta: trial ? i18n.t('paywall.cta.trial', { days: offer.trialDays ?? 0 }) : i18n.t('paywall.cta.buy'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// When the paywall may appear on its own (game-design 4.6). Pure, so the rules have tests.

export interface PaywallContext {
  /** Epoch ms now. */
  now: number;
  entitlementPlan: Plan;
  /** Child profile: no prices, a grown-up asks (game-design 2.9). */
  child: boolean;
  /** The round that just ended. */
  round: { activeSeconds: number; completed: boolean; live: boolean } | null;
  /** Something good happened: a personal best, three stars, an achievement or a daily task. */
  good: boolean;
  /** Epoch ms of the last time the paywall appeared on its own, or null. */
  lastShownAt: number | null;
  /** Another round was already finished earlier (the first session is always full and free). */
  priorRounds: number;
}

export const QUIET_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * After the first good session, once; then three quiet days. Never during play, in a live match, after a poor round,
 * on a child profile, or for someone who already has Pro. Locked-game taps and the Pro tab open it on request instead.
 */
export function shouldShowPaywallAfterRound(c: PaywallContext): boolean {
  if (c.entitlementPlan !== 'free' || c.child || !c.round) return false;
  if (c.round.live || !c.round.completed || c.round.activeSeconds < 60 || !c.good) return false;
  if (c.priorRounds < 1) return false;
  if (c.lastShownAt !== null && c.now - c.lastShownAt < QUIET_DAYS * DAY_MS) return false;
  return true;
}
