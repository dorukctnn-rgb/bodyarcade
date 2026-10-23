// Google Play Billing through the Digital Goods API, in the Trusted Web Activity (the Android app). The app starts the
// purchase with the Payment Request API, hands the purchase token to our server, which checks it with Google,
// acknowledges it and returns a signed entitlement token for this device. Nothing here knows a price: prices come from
// getDetails (plans.ts: playPlans). Never a word about another way to pay (Play payments policy).
//
// Restoring is the same call again: listPurchases() gives the purchases of this Google account, the server checks
// them (idempotent), and a reinstall or a second phone finds its Pro again.
import type { ActivateFailureCode, ActivateResult, Entitlement } from '../../types/index.ts';
import { API, MAX_PURCHASES, PRODUCT_ID_RE, PURCHASE_TOKEN_RE, errorCodeOf, isExplicitRefusal, type PlayPurchaseRef, type RefusalCode } from '../api.ts';
import { PLAY_PRODUCTS, entitlementFor, type PlayItemDetails } from '../plans.ts';
import { verifyToken, type TokenKey } from '../token.ts';
import { CANCELLED, defaultFetch, postJson, releaseSeat, type FetchLike, type HttpAnswer, type ManagedProvider, type RefreshContext } from './shared.ts';

/** The part of the Digital Goods service this app uses. */
export interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<PlayItemDetails[]>;
  listPurchases(): Promise<{ itemId: string; purchaseToken: string }[]>;
}

/** The part of the Payment Request API a Play purchase uses. */
export interface PaymentResponseLike {
  details: unknown;
  complete(result?: 'success' | 'fail' | 'unknown'): Promise<void>;
}
export interface PaymentRequestLike {
  show(): Promise<PaymentResponseLike>;
}

export interface PlayProviderOptions {
  service: DigitalGoodsService;
  /** `new PaymentRequest([{ supportedMethods: 'https://play.google.com/billing', data: { sku } }], { total: ... })`. */
  createPayment(sku: string): PaymentRequestLike;
  fetch?: FetchLike;
  baseUrl?: string;
  did: () => string;
  keys: readonly TokenKey[];
  now?: () => number;
  timeoutMs?: number;
}

export interface PlayProvider extends ManagedProvider {
  /** The products' prices, currencies and trials, from Google. */
  details(): Promise<PlayItemDetails[]>;
  /** Asks Google Play for this account's purchases again and has the server confirm them. */
  restore(): Promise<ActivateResult>;
}

const MESSAGES: Record<ActivateFailureCode, string> = {
  not_found: 'No purchase was found on this Google account.',
  refunded: 'This purchase was refunded.',
  ended: 'This subscription has ended.',
  limit: 'This purchase is already active on the most devices it allows.',
  network: 'Google Play or the licence service could not be reached.',
  server: 'The licence service could not answer just now. Try again later.',
};
const fail = (code: ActivateFailureCode, message?: string): ActivateResult => ({ ok: false, code, message: message ?? MESSAGES[code] });

function tokenOf(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  const t = (details as Record<string, unknown>)['purchaseToken'];
  return typeof t === 'string' && PURCHASE_TOKEN_RE.test(t) ? t : null;
}

export function createPlayProvider(o: PlayProviderOptions): PlayProvider {
  const f = o.fetch ?? defaultFetch;
  const now = o.now ?? Date.now;

  async function grantOf(a: HttpAnswer): Promise<Entitlement | null> {
    if (a.status !== 200 || typeof a.body !== 'object' || a.body === null) return null;
    const token = (a.body as Record<string, unknown>)['token'];
    if (typeof token !== 'string') return null;
    const r = await verifyToken(token, { keys: o.keys, now: now(), did: o.did() });
    if (!r.ok) return null;
    return entitlementFor(r.claims.plan, 'play', { token, ...(r.claims.pe ? { exp: r.claims.pe * 1000 } : {}) });
  }

  async function verifyWithServer(purchases: PlayPurchaseRef[]): Promise<{ answer: HttpAnswer | null; e: Entitlement | null }> {
    const answer = await postJson(f, `${o.baseUrl ?? ''}${API.play}`, { did: o.did(), purchases }, o.timeoutMs);
    return { answer, e: answer ? await grantOf(answer) : null };
  }

  function refusalOrFailure(answer: HttpAnswer | null): ActivateResult {
    if (!answer) return fail('network');
    if (isExplicitRefusal(answer.status, answer.body)) return fail((answer.body as { error: RefusalCode }).error);
    return fail(errorCodeOf(answer.body) === 'upstream' ? 'network' : 'server');
  }

  async function listed(): Promise<PlayPurchaseRef[] | null> {
    try {
      const all = await o.service.listPurchases();
      if (!Array.isArray(all)) return null;
      const out: PlayPurchaseRef[] = [];
      for (const p of all) {
        if (typeof p?.itemId === 'string' && PRODUCT_ID_RE.test(p.itemId) && Object.hasOwn(PLAY_PRODUCTS, p.itemId) && typeof p.purchaseToken === 'string' && PURCHASE_TOKEN_RE.test(p.purchaseToken)) {
          out.push({ productId: p.itemId, purchaseToken: p.purchaseToken });
          if (out.length >= MAX_PURCHASES) break;
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  return {
    id: 'play',
    keepsProof: false,

    async details() {
      try {
        const ids = Object.keys(PLAY_PRODUCTS);
        const got = await o.service.getDetails(ids);
        return Array.isArray(got) ? got.filter((d) => d && typeof d.itemId === 'string' && ids.includes(d.itemId)) : [];
      } catch {
        return [];
      }
    },

    /** `input` is the Play product id to buy. A purchase the person cancels is { ok: false, code: 'not_found', message: CANCELLED }. */
    async activate(input) {
      if (typeof input !== 'string' || !Object.hasOwn(PLAY_PRODUCTS, input)) return fail('not_found', 'That product does not exist.');
      let response: PaymentResponseLike;
      try {
        response = await o.createPayment(input).show();
      } catch (e) {
        const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
        return name === 'AbortError' || name === 'NotAllowedError' ? fail('not_found', CANCELLED) : fail('network', 'The purchase could not be started.');
      }
      const token = tokenOf(response.details);
      if (!token) { await response.complete('fail').catch(() => undefined); return fail('server', 'Google Play did not return a purchase token.'); }
      const { answer, e } = await verifyWithServer([{ productId: input, purchaseToken: token }]);
      if (e) {
        await response.complete('success').catch(() => undefined);      // after the server has confirmed; a subscription is never consumed
        return { ok: true, e };
      }
      await response.complete('fail').catch(() => undefined);
      return refusalOrFailure(answer);
    },

    async restore() {
      const purchases = await listed();
      if (purchases === null) return fail('network', 'Google Play could not be reached.');
      if (purchases.length === 0) return fail('not_found');
      const { answer, e } = await verifyWithServer(purchases);
      return e ? { ok: true, e } : refusalOrFailure(answer);
    },

    async refresh() {
      // Google's own list is the proof; an empty or failed list is not a verdict (B2), the token simply lapses if it stays that way.
      const purchases = await listed();
      if (!purchases || purchases.length === 0) return 'keep';
      const { answer, e } = await verifyWithServer(purchases);
      if (e) return e;
      return answer && isExplicitRefusal(answer.status, answer.body) ? 'revoked' : 'keep';
    },

    release: (e) => releaseSeat(f, o.baseUrl ?? '', e, o.did(), o.timeoutMs),
  };
}
