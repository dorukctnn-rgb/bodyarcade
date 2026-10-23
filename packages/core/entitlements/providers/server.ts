// Our own server as the entitlement provider (web). A licence key goes to /api/entitlements/activate; what comes back
// is a signed token for this device, which the app checks offline with the public key. The server stores only the
// SHA-256 of the key, so every renewal sends the key again.
//
// B2: a renewal that does not get a clear answer keeps what the player has. Only a well-formed refusal from the server
// (not found, refunded, ended, no seat left) returns 'revoked'; a network error, a timeout, a 5xx, a 429, a page from a
// proxy, or a token that does not check out are all 'keep' (api.ts: isExplicitRefusal).
import type { ActivateFailureCode, ActivateResult, Entitlement } from '../../types/index.ts';
import { API, LICENSE_KEY_RE, errorCodeOf, isExplicitRefusal, type RefusalCode } from '../api.ts';
import { entitlementFor } from '../plans.ts';
import { verifyToken, type TokenKey } from '../token.ts';
import { defaultFetch, postJson, releaseSeat, type FetchLike, type HttpAnswer, type ManagedProvider, type RefreshContext } from './shared.ts';

export interface ServerProviderOptions {
  fetch?: FetchLike;
  /** Origin of the API; empty for the page's own origin. */
  baseUrl?: string;
  /** This device's identifier (entitlements/device.ts). */
  did: () => string;
  keys: readonly TokenKey[];
  now?: () => number;
  timeoutMs?: number;
}

const MESSAGES: Record<ActivateFailureCode, string> = {
  not_found: 'This licence key was not found.',
  refunded: 'This purchase was refunded.',
  ended: 'This membership has ended.',
  limit: 'This licence is already active on the most devices it allows.',
  network: 'The licence service could not be reached.',
  server: 'The licence service could not answer just now. Try again later.',
};
const fail = (code: ActivateFailureCode): ActivateResult => ({ ok: false, code, message: MESSAGES[code] });

export function createServerProvider(o: ServerProviderOptions): ManagedProvider {
  const f = o.fetch ?? defaultFetch;
  const now = o.now ?? Date.now;
  const url = (path: string): string => `${o.baseUrl ?? ''}${path}`;

  /** The entitlement a good answer carries, or null when the answer is not a token that checks out for this device. */
  async function grantOf(a: HttpAnswer): Promise<Entitlement | null> {
    if (a.status !== 200 || typeof a.body !== 'object' || a.body === null) return null;
    const token = (a.body as Record<string, unknown>)['token'];
    if (typeof token !== 'string') return null;
    const r = await verifyToken(token, { keys: o.keys, now: now(), did: o.did() });
    if (!r.ok) return null;
    return entitlementFor(r.claims.plan, 'server', { token, ...(r.claims.pe ? { exp: r.claims.pe * 1000 } : {}) });
  }

  return {
    id: 'server',
    keepsProof: true,

    async activate(input) {
      const key = typeof input === 'string' ? input.trim() : '';
      if (!LICENSE_KEY_RE.test(key)) return fail('not_found');
      const a = await postJson(f, url(API.activate), { key, did: o.did() }, o.timeoutMs);
      if (!a) return fail('network');
      const e = await grantOf(a);
      if (e) return { ok: true, e };
      if (isExplicitRefusal(a.status, a.body)) return fail((a.body as { error: RefusalCode }).error);
      return fail(errorCodeOf(a.body) === 'upstream' ? 'network' : 'server');
    },

    async refresh(_e, ctx?: RefreshContext) {
      if (!ctx || !ctx.proof || !LICENSE_KEY_RE.test(ctx.proof)) return 'keep';
      const a = await postJson(f, url(API.refresh), { key: ctx.proof, did: o.did() }, o.timeoutMs);
      if (!a) return 'keep';
      const e = await grantOf(a);
      if (e) return e;
      return isExplicitRefusal(a.status, a.body) ? 'revoked' : 'keep';
    },

    release: (e) => releaseSeat(f, o.baseUrl ?? '', e, o.did(), o.timeoutMs),
  };
}
