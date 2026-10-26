// What the paywall and the trial notice get from the entitlements (core/entitlements). Three makers of a BillingPort:
//
//   realBilling       the real thing: the offers S's paywall model allows where the page runs (a plan with no real Gumroad
//                     address is not offered, and in Google Play the app shows no word about another shop), and the trial
//                     notice and the reminder e-mail box of trial.ts.
//   practiceBilling   development and test builds: made-up offers (marked as a preview, so the buy button says nothing can be
//                     bought) and a trial that tests can place anywhere in its last days.
//   pendingBilling    the moment before the real one has answered, and when it never does: nothing to buy, said honestly.
//
// withPreviewOffers puts the made-up offers into the real billing where it has none, for a build made to look at the design
// before the Gumroad products exist (BA_PLACEHOLDER_PLANS=1 at build time). Without that flag a placeholder never reaches a player.
import { EMAIL_RE, MAX_EMAIL_LENGTH, REMINDER_LEAD_MS } from '../../../core/entitlements/api.ts';
import type { BootResult } from '../../../core/entitlements/boot.ts';
import type { PaywallModel } from '../../../core/entitlements/paywall.ts';
import { SOLD_PLAN_IDS, playProductOf, webPlans, type PlayItemDetails, type SoldPlanId } from '../../../core/entitlements/plans.ts';
import { maskEmail, trialNotice, type TrialResult, type TrialSubject, type TrialView } from '../../../core/entitlements/trial.ts';
import type { PaywallInfo, PlansConfig } from '../../../core/ui/plans.ts';
import type { BillingPort } from './ports.ts';

const DAY_MS = 86_400_000;

const infoOf = (m: PaywallModel, preview: boolean): PaywallInfo => ({ mode: m.mode, note: m.note, keyEntry: m.keyEntry, manageUrl: m.manageUrl, preview });

export interface RealBillingOptions {
  /** Family is sold only once the six profiles exist; until then it stays off the page. */
  family: boolean;
  /** Google's description of the products, once it has answered (the Android app only). */
  details: () => readonly PlayItemDetails[];
}

export function realBilling(boot: Pick<BootResult, 'paywall' | 'trial'>, o: RealBillingOptions): BillingPort {
  return {
    paywall() {
      const m = boot.paywall({ family: o.family, details: o.details() });
      return { plans: m.plans, info: infoOf(m, false) };
    },
    trial: boot.trial,
  };
}

/** Asks Google Play once for the description of the products (price, currency and trial are Google's). Never throws; [] when it cannot. */
export async function loadPlayDetails(env: Pick<BootResult['env'], 'mode' | 'service'>, timeoutMs = 2500): Promise<PlayItemDetails[]> {
  if (env.mode !== 'play' || !env.service) return [];
  const ask = env.service.getDetails(SOLD_PLAN_IDS.map(playProductOf)).catch(() => [] as PlayItemDetails[]);
  const late = new Promise<PlayItemDetails[]>((resolve) => { setTimeout(() => resolve([]), timeoutMs); });
  return Promise.race([ask, late]);
}

/** Checkout addresses that do not exist: for offers that only show what the page will look like. */
export const PREVIEW_CHECKOUT: Readonly<Record<SoldPlanId, string>> = {
  'pro-monthly': 'https://checkout.invalid/pro-monthly',
  'pro-yearly': 'https://checkout.invalid/pro-yearly',
  'family-yearly': 'https://checkout.invalid/family-yearly',
  lifetime: 'https://checkout.invalid/lifetime',
};

const previewPlans = (trialEligible: boolean): PlansConfig => webPlans({ checkout: PREVIEW_CHECKOUT, family: true, trialEligible });

const WEB_INFO: PaywallInfo = { mode: 'web', note: null, keyEntry: { visible: true, wording: 'web' }, manageUrl: null, preview: false };

/** The real billing, except that where it has no plan to offer (the Gumroad products are not made yet) the made-up ones stand in. */
export function withPreviewOffers(real: BillingPort): BillingPort {
  return {
    trial: real.trial,
    paywall() {
      const now = real.paywall();
      if (now.info.mode !== 'web' || now.plans.offers.length > 0) return now;
      return { plans: previewPlans(now.plans.trialEligible), info: { ...now.info, note: null, preview: true } };
    },
  };
}

/** Nothing can be bought yet, or at all: the paywall says so and keeps the licence key box and the way back. */
export function pendingBilling(note: 'checking' | 'unavailable'): BillingPort {
  return {
    paywall: () => ({
      plans: { offers: [], trialEligible: false, trialReminder: false },
      info: { ...WEB_INFO, mode: note === 'checking' ? 'neutral' : 'web', note, keyEntry: { visible: note === 'unavailable', wording: 'web' } },
    }),
    trial: {
      notice: () => null,
      view: async () => ({ trialEnds: null, notice: null, email: 'none', masked: null, sendAt: null }),
      setEmail: async () => ({ ok: false, code: 'not_offered' }),
      clearEmail: async () => ({ ok: true, sendAt: null }),
    },
  };
}

/** Where a practice trial stands: it ends this long from now, and whatever else a test wants to see. */
export interface PracticeTrial {
  endsInMs: number;
  where?: 'web' | 'play';
  /** The membership was cancelled already: the trial runs out and nothing is charged. */
  cancelled?: boolean;
  /** 'none': the server has no mail service, so no box is offered. */
  email?: 'offer' | 'none';
}

export interface PracticeBillingOptions {
  now?: () => number;
  /** IANA zone for "today" in the notice; default the device's own. */
  timeZone?: string;
  trial?: PracticeTrial;
  /** False: this player used a trial already, so none is offered. */
  trialEligible?: boolean;
}

/** The practice billing for development and test builds. Offers are made up; the trial is the real notice logic on a pretend purchase. */
export function practiceBilling(o: PracticeBillingOptions = {}): BillingPort {
  const now = o.now ?? Date.now;
  const trial = o.trial;
  const endsAt = trial ? now() + trial.endsInMs : null;
  let held: { masked: string; sendAt: number } | null = null;
  const subject = (): TrialSubject => ({
    source: trial?.where === 'play' ? 'play' : 'gumroad',
    paidUntil: trial?.cancelled && endsAt !== null ? endsAt + 30 * DAY_MS : null,
    trialEnds: endsAt,
    planId: 'pro-yearly',
  });
  const notice = () => (endsAt === null ? null : trialNotice(subject(), { now: now(), ...(o.timeZone ? { timeZone: o.timeZone } : {}) }));
  const fail = (code: Extract<TrialResult, { ok: false }>['code']): TrialResult => ({ ok: false, code });
  const mailOk = (): boolean => trial !== undefined && trial.where !== 'play' && trial.cancelled !== true && trial.email !== 'none';

  return {
    paywall: () => ({ plans: previewPlans(o.trialEligible ?? true), info: { ...WEB_INFO, preview: true } }),
    trial: {
      notice,
      async view(): Promise<TrialView> {
        if (endsAt === null || endsAt <= now()) return { trialEnds: null, notice: null, email: 'none', masked: null, sendAt: null };
        if (held) return { trialEnds: endsAt, notice: notice(), email: 'set', masked: held.masked, sendAt: held.sendAt };
        return { trialEnds: endsAt, notice: notice(), email: mailOk() ? 'offer' : 'none', masked: null, sendAt: null };
      },
      async setEmail(raw): Promise<TrialResult> {
        if (!mailOk() || endsAt === null) return fail('not_offered');
        const email = raw.trim();
        if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return fail('bad_email');
        held = { masked: maskEmail(email), sendAt: endsAt - REMINDER_LEAD_MS };
        return { ok: true, sendAt: held.sendAt };
      },
      async clearEmail(): Promise<TrialResult> {
        held = null;
        return { ok: true, sendAt: null };
      },
    },
  };
}
