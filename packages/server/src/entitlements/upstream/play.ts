// Google Play's purchase check (Google Play Developer API) and the acknowledgement that Play demands within three days.
//
// Subscriptions are read with purchases.subscriptionsv2, the one-time Lifetime product with purchases.products. What
// Google's answer means is decided by two pure functions (judgeSubscription, judgeProduct) that have a test for every
// state Google can report. A call that fails, or that Google answers for a reason that is about OUR setup (no permission,
// a wrong package), is `unreadable`: never a verdict about the buyer (B2).
import { PLANS, PLAY_PACKAGE, PLAY_PRODUCTS } from '../../../../core/entitlements/plans.ts';
import { timeToSec } from '../rules.ts';
import { createGoogleAuth, type GoogleAuth, type ServiceAccount } from './google.ts';
import type { FetchFn } from './gumroad.ts';

export const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

export type PlayCheck =
  /** The purchase gives access now. `cancelled`: the buyer stopped it, access lasts until `expiry`. */
  | { kind: 'active'; expiry: number | null; startedAt: number | null; cancelled: boolean; acknowledged: boolean; test: boolean }
  | { kind: 'refused'; code: 'not_found' | 'ended' | 'refunded' }
  /** Bought but not paid yet (a cash payment method): no access, and no verdict either. */
  | { kind: 'pending' }
  | { kind: 'unreadable' };

export interface PlayUpstream {
  check(productId: string, purchaseToken: string): Promise<PlayCheck>;
  /** Tells Google the purchase was delivered. Best effort: false when it could not be done. */
  acknowledge(productId: string, purchaseToken: string): Promise<boolean>;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Google's SubscriptionPurchaseV2 as a verdict. `nowS`: epoch seconds. */
export function judgeSubscription(body: unknown, productId: string, nowS: number): PlayCheck {
  if (!isRecord(body)) return { kind: 'unreadable' };
  const items = Array.isArray(body['lineItems']) ? body['lineItems'] : [];
  const item = items.find((i): i is Record<string, unknown> => isRecord(i) && i['productId'] === productId);
  const state = body['subscriptionState'];
  if (!item) return state === 'SUBSCRIPTION_STATE_PENDING' ? { kind: 'pending' } : { kind: 'refused', code: 'not_found' };
  const expiry = timeToSec(item['expiryTime']);
  const acknowledged = body['acknowledgementState'] === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
  const startedAt = timeToSec(body['startTime']);
  const test = isRecord(body['testPurchase']);
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
    // Google is retrying the payment and says access continues: the buyer keeps Pro, the next check will tell.
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return { kind: 'active', expiry, startedAt, cancelled: false, acknowledged, test };
    case 'SUBSCRIPTION_STATE_CANCELED':
      if (expiry === null || expiry <= nowS) return { kind: 'refused', code: 'ended' };
      return { kind: 'active', expiry, startedAt, cancelled: true, acknowledged, test };
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
    case 'SUBSCRIPTION_STATE_EXPIRED':
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return { kind: 'refused', code: 'ended' };
    case 'SUBSCRIPTION_STATE_PENDING':
      return { kind: 'pending' };
    default:
      // UNSPECIFIED or a state added after this code was written: not a verdict.
      return { kind: 'unreadable' };
  }
}

/** Google's ProductPurchase (the one-time Lifetime product) as a verdict. */
export function judgeProduct(body: unknown): PlayCheck {
  if (!isRecord(body)) return { kind: 'unreadable' };
  const startedAt = timeToSec(body['purchaseTimeMillis']);
  const acknowledged = body['acknowledgementState'] === 1;
  const test = body['purchaseType'] === 0;
  switch (body['purchaseState']) {
    case 0: return { kind: 'active', expiry: null, startedAt, cancelled: false, acknowledged, test };
    case 1: return { kind: 'refused', code: 'refunded' };            // cancelled: a refund or a chargeback voided it
    case 2: return { kind: 'pending' };
    default: return { kind: 'unreadable' };
  }
}

export interface PlayUpstreamOptions {
  account: ServiceAccount;
  packageName?: string;
  fetch?: FetchFn;
  now?: () => number;
  auth?: GoogleAuth;
  timeoutMs?: number;
}

export function createPlayUpstream(o: PlayUpstreamOptions): PlayUpstream {
  const f: FetchFn = o.fetch ?? ((input, init) => fetch(input, init));
  const now = o.now ?? Date.now;
  const pkg = o.packageName ?? PLAY_PACKAGE;
  const auth = o.auth ?? createGoogleAuth({ account: o.account, fetch: f, now });
  const timeout = o.timeoutMs ?? 8_000;

  /** One call with the access token; a 401 gets one more try with a new token. null: no answer at all. */
  async function call(method: 'GET' | 'POST', url: string): Promise<{ status: number; body: unknown } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await auth.token(attempt > 0);
      if (!token) return null;
      let status: number;
      let body: unknown;
      try {
        const res = await f(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
          ...(method === 'POST' ? { body: '{}' } : {}),
          signal: AbortSignal.timeout(timeout),
        });
        status = res.status;
        try { body = JSON.parse(await res.text()) as unknown; } catch { body = undefined; }
      } catch {
        return null;
      }
      if (status !== 401) return { status, body };
    }
    return null;
  }

  const enc = encodeURIComponent;
  const isOnce = (productId: string): boolean => {
    const plan = Object.hasOwn(PLAY_PRODUCTS, productId) ? PLAY_PRODUCTS[productId] : undefined;
    return plan !== undefined && PLANS[plan].period === 'once';
  };

  return {
    async check(productId, purchaseToken) {
      if (!Object.hasOwn(PLAY_PRODUCTS, productId)) return { kind: 'refused', code: 'not_found' };
      const url = isOnce(productId)
        ? `${PLAY_API}/${enc(pkg)}/purchases/products/${enc(productId)}/tokens/${enc(purchaseToken)}`
        : `${PLAY_API}/${enc(pkg)}/purchases/subscriptionsv2/tokens/${enc(purchaseToken)}`;
      const r = await call('GET', url);
      if (!r) return { kind: 'unreadable' };
      if (r.status === 200) return isOnce(productId) ? judgeProduct(r.body) : judgeSubscription(r.body, productId, Math.floor(now() / 1000));
      // 400 and 404: Google has no such purchase (or does not accept the token). The engine decides what that is worth for a
      // purchase it has seen before (a wrong package name looks the same).
      if (r.status === 400 || r.status === 404) return { kind: 'refused', code: 'not_found' };
      // 410: a subscription that has been expired for too long to be looked up.
      if (r.status === 410) return { kind: 'refused', code: 'ended' };
      // 403 (no permission: our setup), 429, 5xx, anything else: not a verdict.
      return { kind: 'unreadable' };
    },

    async acknowledge(productId, purchaseToken) {
      if (!Object.hasOwn(PLAY_PRODUCTS, productId)) return false;
      const url = isOnce(productId)
        ? `${PLAY_API}/${enc(pkg)}/purchases/products/${enc(productId)}/tokens/${enc(purchaseToken)}:acknowledge`
        : `${PLAY_API}/${enc(pkg)}/purchases/subscriptions/${enc(productId)}/tokens/${enc(purchaseToken)}:acknowledge`;
      const r = await call('POST', url);
      return r !== null && (r.status === 200 || r.status === 204);
    },
  };
}
