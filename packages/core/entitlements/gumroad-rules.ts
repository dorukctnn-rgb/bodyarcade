// What Gumroad's licence check means. Used by the app's direct check (providers/gumroad.ts) and by the Worker; the
// rules are the live site's (site/game/store.js:47-84) moved here unchanged in meaning, with the same tests.
//
// Gumroad keeps a key valid after a membership is cancelled and reports the END of the membership instead:
// subscription_cancelled_at (cancelled by the buyer or the seller), subscription_failed_at (a renewal could not be
// charged) and subscription_ended_at (a fixed-length membership ran out) all hold the end date, not the moment someone
// pressed cancel. So a cancelled plan shows a date in the future until the paid month is over. Renewing or restarting
// sets them back to null. https://gumroad.com/help/article/76-license-keys

export const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

export interface GumroadPurchase {
  refunded?: unknown;
  chargebacked?: unknown;
  disputed?: unknown;
  subscription_ended_at?: unknown;
  subscription_cancelled_at?: unknown;
  subscription_failed_at?: unknown;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * When a membership ends, as epoch milliseconds, or null while it simply renews. The earliest of the three dates wins,
 * and a date that cannot be read counts as already over (0).
 */
export function subscriptionEnd(purchase: GumroadPurchase): number | null {
  const stamps = [purchase.subscription_ended_at, purchase.subscription_cancelled_at, purchase.subscription_failed_at].filter(Boolean);
  if (stamps.length === 0) return null;
  return Math.min(...stamps.map((t) => { const n = Date.parse(String(t)); return Number.isNaN(n) ? 0 : n; }));
}

export type Verdict =
  | { status: 'active'; paidUntil: number | null }
  | { status: 'refunded' }
  | { status: 'ended' };

/** A refund, a chargeback or a dispute ends it for good; an end date in the past ends it; an end date ahead is the paid period. */
export function judgePurchase(purchase: GumroadPurchase, now: number): Verdict {
  if (purchase.refunded || purchase.chargebacked || purchase.disputed) return { status: 'refunded' };
  const end = subscriptionEnd(purchase);
  if (end !== null && end <= now) return { status: 'ended' };
  return { status: 'active', paidUntil: end };
}

export type VerifyAnswer =
  /** Gumroad knows this key for this product. */
  | { kind: 'found'; purchase: GumroadPurchase }
  /** Gumroad says this product has no such key (try the next product). */
  | { kind: 'not_found' }
  /** Anything else: Gumroad is down, rate-limiting, or did not answer in a way that can be read. Never a verdict on the key. */
  | { kind: 'unreadable' };

/** Reads one answer of the verify endpoint. `status` is the HTTP status, `body` the parsed JSON (undefined when it was not JSON). */
export function readVerifyAnswer(status: number, body: unknown): VerifyAnswer {
  if (status >= 500 || status === 429 || status === 408 || !isRecord(body)) return { kind: 'unreadable' };
  if (body['success'] === true) return { kind: 'found', purchase: isRecord(body['purchase']) ? (body['purchase'] as GumroadPurchase) : {} };
  if (body['success'] === false && typeof body['message'] === 'string') return { kind: 'not_found' };
  return { kind: 'unreadable' };
}
