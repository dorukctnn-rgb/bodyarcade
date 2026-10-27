// The plans: what is sold, what was sold before, what each one grants, and the offers the paywall shows.
//
// Four plans are for sale (Pro monthly, Pro yearly, Family yearly, Lifetime). Pro yearly is the only one with a free trial
// (7 days; BUILD-PLAN 24 Oct), so it is the only one whose trial the app reminds a person of. Two exist only for people who bought
// earlier and keep everything (game-design 4.5: "your price does not change, the new games are yours"): the $4.99
// monthly membership and the $99 lifetime purchase ("founder"). The ids of the four sold plans are the ids the
// paywall in core/ui already uses, so an offer id can be handed straight to activation and purchase code.
//
// Prices here are the web list prices in USD (BUILD-PLAN). On Google Play the price, currency and trial come from the
// store itself (playPlans below); nothing here is shown as a price in the Play build.
import type { Entitlement, Plan } from '../types/index.ts';

export type SoldPlanId = 'pro-monthly' | 'pro-yearly' | 'family-yearly' | 'lifetime';
export type PlanId = SoldPlanId | 'legacy-monthly' | 'founder';
export type Period = 'month' | 'year' | 'once';
export type EntitlementSource = Entitlement['source'];

export interface PlanInfo {
  id: PlanId;
  /** The contract's plan: what the interface and `can()` look at. */
  plan: Exclude<Plan, 'free'>;
  /** A $99 buyer: lifetime Pro, every future game, the family profiles. */
  founder: boolean;
  period: Period;
  /** Devices one purchase may be active on at the same time (Pro 3, Family 4, Founder 6). */
  devices: number;
  /** Player profiles on one device (Family and Founder: 6). */
  profiles: number;
  /** Feature words carried in the signed token. */
  feat: readonly string[];
  sold: boolean;
  /** Web list price in USD, or the historic price for a plan that is no longer sold. */
  price: number;
  trialDays?: number;
  /** Google Play product id (a subscription, or the one-time product for the lifetime plan). */
  play?: string;
  /** Position when a person holds several purchases: the highest wins. */
  rank: number;
}

export const PLAY_PACKAGE = 'com.peakapps.bodyarcade';

export const PLANS: Readonly<Record<PlanId, PlanInfo>> = {
  'pro-monthly': { id: 'pro-monthly', plan: 'pro', founder: false, period: 'month', devices: 3, profiles: 1, feat: ['pro'], sold: true, price: 7.99, play: 'bodyarcade_pro_monthly', rank: 2 },
  'pro-yearly': { id: 'pro-yearly', plan: 'pro', founder: false, period: 'year', devices: 3, profiles: 1, feat: ['pro'], sold: true, price: 39.99, trialDays: 7, play: 'bodyarcade_pro_yearly', rank: 3 },
  'family-yearly': { id: 'family-yearly', plan: 'family', founder: false, period: 'year', devices: 4, profiles: 6, feat: ['pro', 'family6'], sold: true, price: 59.99, play: 'bodyarcade_family_yearly', rank: 4 },
  lifetime: { id: 'lifetime', plan: 'lifetime', founder: false, period: 'once', devices: 3, profiles: 1, feat: ['pro'], sold: true, price: 119.99, play: 'bodyarcade_lifetime', rank: 5 },
  'legacy-monthly': { id: 'legacy-monthly', plan: 'pro', founder: false, period: 'month', devices: 3, profiles: 1, feat: ['pro'], sold: false, price: 4.99, rank: 2 },
  founder: { id: 'founder', plan: 'lifetime', founder: true, period: 'once', devices: 6, profiles: 6, feat: ['pro', 'family6'], sold: false, price: 99, rank: 6 },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
export const SOLD_PLAN_IDS: readonly SoldPlanId[] = ['pro-monthly', 'pro-yearly', 'family-yearly', 'lifetime'];

export const isPlanId = (x: unknown): x is PlanId => typeof x === 'string' && Object.hasOwn(PLANS, x);
export const isSoldPlanId = (x: unknown): x is SoldPlanId => typeof x === 'string' && (SOLD_PLAN_IDS as readonly string[]).includes(x);

/** The two Gumroad products sold before v2 stay valid for good (the product ids are what the licence check needs). */
export const GUMROAD_LEGACY_PRODUCTS: Readonly<Record<string, PlanId>> = {
  'tN-xTHwaZm8bOdcHHBaKbQ==': 'legacy-monthly',
  'xIio9_FPmjKjWkdZLQKVxA==': 'founder',
};

/** Play product id -> plan. */
export const PLAY_PRODUCTS: Readonly<Record<string, PlanId>> = Object.fromEntries(
  PLAN_IDS.flatMap((id) => { const p = PLANS[id].play; return p ? [[p, id] as const] : []; }),
);

export const playProductOf = (id: SoldPlanId): string => PLANS[id].play as string;

/** The Entitlement the app holds for a plan. Absent fields are left out, not set to undefined. */
export function entitlementFor(id: PlanId, source: EntitlementSource, extra: { exp?: number; token?: string } = {}): Entitlement {
  const info = PLANS[id];
  const e: Entitlement = { plan: info.plan, source };
  if (info.founder) e.founder = true;
  if (extra.exp !== undefined) e.exp = extra.exp;
  if (extra.token !== undefined) e.token = extra.token;
  return e;
}

/** The plan to give a person who holds several purchases. */
export function bestPlan(ids: readonly PlanId[]): PlanId | null {
  let best: PlanId | null = null;
  for (const id of ids) if (best === null || PLANS[id].rank > PLANS[best].rank) best = id;
  return best;
}

// ───────────────────────── the offers the paywall shows ─────────────────────────
// Shaped like core/ui's PlansConfig on purpose (that module may be swapped to import these); declared here so that
// entitlements never imports the interface layer.

export interface OfferShape {
  id: SoldPlanId;
  plan: Exclude<Plan, 'free'>;
  period: Period;
  price: { amount: number; currency: string };
  trialDays?: number;
  profiles?: number;
  devices?: number;
  featured?: boolean;
  /** Web: the Gumroad checkout address. Android app: the Play product id. Never both. */
  checkout: { web?: string; play?: string };
}

export interface PlansShape {
  offers: readonly OfferShape[];
  trialEligible: boolean;
  trialReminder: boolean;
}

export interface WebPlansOptions {
  /** Where each sold plan is bought (the Gumroad product pages). A plan without an address is not offered. */
  checkout: Partial<Record<SoldPlanId, string>>;
  /** Family stays hidden until the profiles feature exists. */
  family?: boolean;
  /** False once this person has used a trial (Gumroad allows one). */
  trialEligible?: boolean;
}

const WEB_ORDER: readonly SoldPlanId[] = ['pro-monthly', 'pro-yearly', 'family-yearly', 'lifetime'];

function shapeOf(id: SoldPlanId, price: { amount: number; currency: string }, checkout: OfferShape['checkout'], trialDays: number | undefined): OfferShape {
  const info = PLANS[id];
  const offer: OfferShape = { id, plan: info.plan as Exclude<Plan, 'free'>, period: info.period, price, checkout };
  if (trialDays) offer.trialDays = trialDays;
  if (info.profiles > 1) offer.profiles = info.profiles;
  if (id === 'family-yearly') offer.devices = info.devices;
  if (id === 'pro-yearly') offer.featured = true;
  return offer;
}

/**
 * The four plans at their web list prices, with no checkout address: what a page drawn without a visitor states (the home page as a
 * crawler reads it before the app runs). Nothing on such a page can be bought; the app draws the plans of where it runs instead.
 */
export function listPricePlans(): PlansShape {
  const offers = WEB_ORDER.map((id) => shapeOf(id, { amount: PLANS[id].price, currency: 'USD' }, {}, PLANS[id].trialDays));
  return { offers, trialEligible: true, trialReminder: true };
}

/** The web paywall: list prices in USD, one checkout address per plan. Only plans that can really be bought are listed. */
export function webPlans(o: WebPlansOptions): PlansShape {
  const offers: OfferShape[] = [];
  for (const id of WEB_ORDER) {
    if (id === 'family-yearly' && !o.family) continue;
    const url = o.checkout[id];
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) continue;
    offers.push(shapeOf(id, { amount: PLANS[id].price, currency: 'USD' }, { web: url }, PLANS[id].trialDays));
  }
  const trialEligible = o.trialEligible ?? true;
  // The reminder (trial.ts) is promised exactly where there is a trial to remind about.
  return { offers, trialEligible, trialReminder: trialEligible && offers.some((x) => x.trialDays !== undefined) };
}

/** What Google Play's Digital Goods service says about one product (a subset of ItemDetails). */
export interface PlayItemDetails {
  itemId: string;
  price: { currency: string; value: string };
  /** ISO 8601 period of a subscription ('P1M', 'P1Y'); absent for the one-time product. */
  subscriptionPeriod?: string;
  /** ISO 8601 length of the free trial ('P7D'); absent or empty when this buyer gets none. */
  freeTrialPeriod?: string;
}

export interface PlayPlansOptions {
  family?: boolean;
}

/** 'P7D' -> 7, 'P1W' -> 7, 'P1M' -> 30; null for anything else. Only used for a trial length. */
export function isoDays(period: string | undefined): number | null {
  if (typeof period !== 'string') return null;
  const m = /^P(?:(\d{1,3})W)?(?:(\d{1,3})D)?$/.exec(period);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 7 + Number(m[2] ?? 0);
  const mo = /^P(\d{1,2})M$/.exec(period);
  return mo ? Number(mo[1]) * 30 : null;
}

/**
 * The Play paywall: price, currency and trial are Google's, read from getDetails; there is no price in the code. A
 * product that Play did not describe is not offered, and a trial is mentioned only when Play reports one for this buyer.
 */
export function playPlans(details: readonly PlayItemDetails[], o: PlayPlansOptions = {}): PlansShape {
  const byId = new Map(details.map((d) => [d.itemId, d] as const));
  const offers: OfferShape[] = [];
  let anyTrial = false;
  for (const id of WEB_ORDER) {
    if (id === 'family-yearly' && !o.family) continue;
    const product = PLANS[id].play as string;
    const d = byId.get(product);
    const amount = d ? Number(d.price.value) : NaN;
    if (!d || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(d.price.currency)) continue;
    const trial = isoDays(d.freeTrialPeriod);
    if (trial) anyTrial = true;
    offers.push(shapeOf(id, { amount, currency: d.price.currency }, { play: product }, trial ?? undefined));
  }
  return { offers, trialEligible: anyTrial, trialReminder: anyTrial };
}
