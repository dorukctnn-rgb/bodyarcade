// Gumroad's licence check, called from the Worker. The rules of reading its answers are the app's own
// (core/entitlements/gumroad-rules.ts, from the live site); this file only makes the call. No secret is needed: the
// verify endpoint takes the product id and the key. `increment_uses_count=false`: a check must not use up the key.
//
// Never a verdict from a failed call: a timeout, a 5xx, a 429, a page that is not JSON, all come back as `unreadable`.
import {
  GUMROAD_VERIFY_URL, notFoundReason, readVerifyAnswer, type GumroadPurchase, type NotFoundReason,
} from '../../../../core/entitlements/gumroad-rules.ts';

export type GumroadAnswer =
  | { kind: 'found'; purchase: GumroadPurchase }
  /** The seller has no such purchase for this product (`missing`), or had one and turned it off (`disabled`, `expired`). */
  | { kind: 'not_found'; reason: NotFoundReason }
  | { kind: 'unreadable' };

export interface GumroadUpstream {
  verify(productId: string, key: string): Promise<GumroadAnswer>;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface GumroadUpstreamOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
}

export const UPSTREAM_TIMEOUT_MS = 8_000;

export function createGumroadUpstream(o: GumroadUpstreamOptions = {}): GumroadUpstream {
  const f: FetchFn = o.fetch ?? ((input, init) => fetch(input, init));
  const timeout = o.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  return {
    async verify(productId, key) {
      const body = new URLSearchParams({ product_id: productId, license_key: key, increment_uses_count: 'false' });
      let status: number;
      let parsed: unknown;
      try {
        const res = await f(GUMROAD_VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: AbortSignal.timeout(timeout),
        });
        status = res.status;
        try { parsed = JSON.parse(await res.text()) as unknown; } catch { parsed = undefined; }
      } catch {
        return { kind: 'unreadable' };
      }
      const answer = readVerifyAnswer(status, parsed);
      if (answer.kind === 'not_found') return { kind: 'not_found', reason: notFoundReason(parsed) };
      if (answer.kind === 'found') return { kind: 'found', purchase: answer.purchase as GumroadPurchase };
      return { kind: 'unreadable' };
    },
  };
}
