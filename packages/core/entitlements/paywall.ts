// What the paywall may show, by where the page runs. The interface layer draws; this decides what exists to draw.
//
//   web                the plans with a real checkout address, the licence key box ("I bought Pro before")
//   play               the plans as Google describes them (price, currency, trial), buying inside Play, a neutral
//                      key box for people who bought elsewhere earlier, and the link to Play's subscription page
//   play-unsupported   the app cannot sell here (Chrome too old): no offers, an honest note, the key box
//   neutral            before the proof is in (billing-env.ts): nothing to buy, nothing named
//
// In every mode but `web` the model has no web address, no shop and not a word about Gumroad; a test walks the whole
// model to prove it.
import type { BillingMode } from './billing-env.ts';
import { PLAY_PACKAGE, playPlans, webPlans, type PlansShape, type PlayItemDetails, type SoldPlanId } from './plans.ts';

export type PaywallMode = BillingMode | 'neutral';
export type PaywallNote = 'unavailable' | 'play-only' | 'checking' | null;

export interface PaywallModel {
  mode: PaywallMode;
  plans: PlansShape;
  /** How buying works here. */
  purchase: 'web-shop' | 'play' | 'none';
  keyEntry: { visible: boolean; /** 'neutral' wording names no seller. */ wording: 'web' | 'neutral' };
  /** Something honest to say instead of offers. */
  note: PaywallNote;
  /** Play's own page for changing or cancelling a subscription; Play mode only. */
  manageUrl: string | null;
}

export interface PaywallInputs {
  /** The Gumroad product pages, per sold plan; plans without one are not offered on the web. */
  checkout?: Partial<Record<SoldPlanId, string>>;
  /** Google's description of the products (getDetails), once it has answered. */
  details?: readonly PlayItemDetails[];
  family?: boolean;
  /** False once this person used a trial. */
  trialEligible?: boolean;
}

export const PLAY_MANAGE_URL = `https://play.google.com/store/account/subscriptions?package=${PLAY_PACKAGE}`;

const EMPTY: PlansShape = { offers: [], trialEligible: false, trialReminder: false };

export function paywallModel(mode: PaywallMode, i: PaywallInputs = {}): PaywallModel {
  switch (mode) {
    case 'web': {
      const plans = webPlans({ checkout: i.checkout ?? {}, ...(i.family !== undefined ? { family: i.family } : {}), ...(i.trialEligible !== undefined ? { trialEligible: i.trialEligible } : {}) });
      const sells = plans.offers.length > 0;
      return { mode, plans, purchase: sells ? 'web-shop' : 'none', keyEntry: { visible: true, wording: 'web' }, note: sells ? null : 'unavailable', manageUrl: null };
    }
    case 'play': {
      const plans = playPlans(i.details ?? [], i.family !== undefined ? { family: i.family } : {});
      const sells = plans.offers.length > 0;
      return { mode, plans, purchase: sells ? 'play' : 'none', keyEntry: { visible: true, wording: 'neutral' }, note: sells ? null : 'unavailable', manageUrl: PLAY_MANAGE_URL };
    }
    case 'play-unsupported':
      return { mode, plans: EMPTY, purchase: 'none', keyEntry: { visible: true, wording: 'neutral' }, note: 'play-only', manageUrl: null };
    case 'neutral':
      return { mode, plans: EMPTY, purchase: 'none', keyEntry: { visible: false, wording: 'neutral' }, note: 'checking', manageUrl: null };
  }
}
