// What the paywall and the trial notice get from the entitlements (core/entitlements). Three makers of a BillingPort:
//
//   realBilling       the real thing: the offers S's paywall model allows where the page runs (a plan with no real Gumroad
//                     address is not offered, and in Google Play the app shows no word about another shop), and the trial
//                     notice and the reminder e-mail box of trial.ts.
//   practiceBilling   development and test builds: made-up offers (marked as a preview, so the buy button says nothing can be
//                     bought) and a trial that tests can place anywhere in its last days.
//   pendingBilling    the moment before the real one has answered, and when it never does: nothing to buy, said honestly.
//
// In the Android app Google Play describes the products (createPlayDetails): the answer can be slow on a cold start, so the
// looks are repeated, the page says "checking" while they run, and a look is repeated when the Pro page opens and when the
// app comes back to the front. "Cannot be bought here" is only said once the looks ended with no products.
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
  /** Google's description of the products (the Android app only): what it holds now, or the loader that keeps asking until it has them. */
  details: (() => readonly PlayItemDetails[]) | PlayDetailsLoader;
}

export function realBilling(boot: Pick<BootResult, 'paywall' | 'trial'>, o: RealBillingOptions): BillingPort {
  const loader = typeof o.details === 'function' ? null : o.details;
  const held = typeof o.details === 'function' ? o.details : (): readonly PlayItemDetails[] => loader?.get() ?? [];
  return {
    paywall() {
      const m = boot.paywall({ family: o.family, details: held(), ...(loader ? { detailsPending: loader.status() === 'loading' } : {}) });
      return { plans: m.plans, info: infoOf(m, false) };
    },
    trial: boot.trial,
    ...(loader ? { refresh: () => loader.refresh(), onChange: (cb: () => void) => loader.onChange(cb) } : {}),
  };
}

/** Where the looks at Google Play's description of the products stand. */
export type PlayDetailsStatus = 'loading' | 'ready' | 'none';

export interface PlayDetailsLoader {
  /** The products as Google described them; [] until it has. */
  get(): readonly PlayItemDetails[];
  /** 'loading': asking (or about to ask again), the page says it is checking. 'ready': products are here. 'none': the looks ended with no products, or there is no Play to ask. */
  status(): PlayDetailsStatus;
  /** The Pro page opened or the app came back to the front: when there are no products and nobody is asking, look again. True when a look started (status is 'loading' now). */
  refresh(): boolean;
  /** Called when the page has something new to show: products arrived, or the looks ended without any. Not called by refresh itself. */
  onChange(cb: () => void): () => void;
  dispose(): void;
}

export interface PlayDetailsOptions {
  /** How long one question to Google waits before the next look starts (the late answer is still taken when it comes). Default 4000. */
  askMs?: number;
  /** The pauses before the second, third and later looks after a look without products. Default 1 s, 2.5 s, 5 s: four looks over about 20 seconds. */
  pausesMs?: readonly number[];
}

/**
 * Asks Google Play for the description of the products (price, currency and trial are Google's) and does not give up after one
 * slow or empty answer: a cold Play connection on a phone can take longer than any single wait, and an answer that comes after
 * its wait is taken all the same. Never throws. Where the page is not the Android app, or has no Digital Goods service, there is
 * nothing to ask: the status is 'none' at once and no timer runs.
 */
export function createPlayDetails(env: Pick<BootResult['env'], 'mode' | 'service'>, o: PlayDetailsOptions = {}): PlayDetailsLoader {
  const service = env.mode === 'play' ? env.service : null;
  const askMs = o.askMs ?? 4000;
  const pauses = o.pausesMs ?? [1000, 2500, 5000];
  const ids = SOLD_PLAN_IDS.map(playProductOf);
  const listeners = new Set<() => void>();
  let held: PlayItemDetails[] = [];
  let status: PlayDetailsStatus = service ? 'loading' : 'none';
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const wait = (ms: number): Promise<void> => new Promise((resolve) => {
    const t = setTimeout(() => { timers.delete(t); resolve(); }, ms);
    timers.add(t);
  });
  const emit = (): void => { for (const cb of [...listeners]) { try { cb(); } catch (e) { console.error(e); } } };
  const valid = (d: unknown): d is PlayItemDetails => {
    const x = d as Partial<PlayItemDetails> | null;
    return typeof x?.itemId === 'string' && ids.includes(x.itemId) && typeof x.price?.value === 'string' && typeof x.price.currency === 'string';
  };

  /** One question. A list with products is kept whenever it arrives, even after the wait ended; true when it had products. */
  function ask(): Promise<boolean> {
    let answer: Promise<unknown>;
    try { answer = Promise.resolve(service?.getDetails(ids)); } catch { answer = Promise.resolve([]); }
    const got = answer.then((list) => (Array.isArray(list) ? list.filter(valid) : []), () => [] as PlayItemDetails[]).then((list) => {
      if (list.length > 0 && !disposed && status !== 'ready') { held = list; status = 'ready'; emit(); }
      return list.length > 0;
    });
    return new Promise((resolve) => {
      const t = setTimeout(() => { timers.delete(t); resolve(false); }, askMs);
      timers.add(t);
      void got.then((had) => { clearTimeout(t); timers.delete(t); resolve(had); });
    });
  }

  /** Another look is pointless: the page is gone, or a late answer brought the products. */
  const done = (): boolean => disposed || status === 'ready';

  async function look(): Promise<void> {
    for (let i = 0; ; i++) {
      await ask();
      if (done()) return;
      if (i >= pauses.length) { status = 'none'; emit(); return; }
      await wait(pauses[i] as number);
      if (done()) return;
    }
  }

  if (service) void look();

  return {
    get: () => held,
    status: () => status,
    refresh() {
      if (!service || disposed || status !== 'none') return false;
      status = 'loading';
      void look();
      return true;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    dispose() {
      disposed = true;
      listeners.clear();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
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
    ...real,
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
