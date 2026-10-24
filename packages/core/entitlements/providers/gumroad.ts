// A licence key checked directly with Gumroad's public verify endpoint, as the live site does (store.js:62-93).
//
// This is the fallback of the web build for when our own server cannot be reached, and the only check there was before
// v2. It needs no secret. What it cannot do is limit devices or give a signed token, so the record it produces lives
// for 30 days without a new check (state.ts: directRecord) and the manager prefers the server whenever it answers.
// Never present in the Android (Play) build.
import type { ActivateFailureCode, ActivateResult, Entitlement } from '../../types/index.ts';
import { LICENSE_KEY_RE } from '../api.ts';
import { GUMROAD_VERIFY_URL, judgePurchase, readVerifyAnswer, type GumroadPurchase } from '../gumroad-rules.ts';
import { GUMROAD_PRODUCTS } from '../catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS, entitlementFor, isPlanId, type PlanId } from '../plans.ts';
import { defaultFetch, postForm, type FetchLike, type ManagedProvider, type RefreshContext } from './shared.ts';

export interface GumroadProviderOptions {
  fetch?: FetchLike;
  now?: () => number;
  /** Gumroad product id -> plan: the two old products are always there; new products are added here. */
  products?: Readonly<Record<string, PlanId>>;
  /** The products of this release (catalog.ts). Default: the catalog of the repository; a test passes its own and so does not move with it. */
  catalog?: Readonly<Record<string, PlanId>>;
  timeoutMs?: number;
}

const MESSAGES: Record<ActivateFailureCode, string> = {
  not_found: 'This licence key was not found.',
  refunded: 'This purchase was refunded.',
  ended: 'This membership has ended.',
  limit: 'This licence is already active on the most devices it allows.',
  network: 'The seller could not be reached.',
  server: 'The seller could not answer just now. Try again later.',
};
const fail = (code: ActivateFailureCode): ActivateResult => ({ ok: false, code, message: MESSAGES[code] });

type Checked =
  | { kind: 'found'; e: Entitlement }
  | { kind: 'refused'; code: 'refunded' | 'ended' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/** Which products to try: only plans that exist; the two old ones first, then the catalog's, then `extra`. */
export function productTable(extra: Readonly<Record<string, PlanId>> = {}, catalog: Readonly<Record<string, PlanId>> = GUMROAD_PRODUCTS): [string, PlanId][] {
  const table: Record<string, PlanId> = { ...GUMROAD_LEGACY_PRODUCTS, ...catalog };
  for (const [id, plan] of Object.entries(extra)) if (isPlanId(plan) && /^[A-Za-z0-9_=-]{8,64}$/.test(id)) table[id] = plan;
  return Object.entries(table);
}

export function createGumroadProvider(o: GumroadProviderOptions = {}): ManagedProvider {
  const f = o.fetch ?? defaultFetch;
  const now = o.now ?? Date.now;
  const products = productTable(o.products, o.catalog);

  async function check(key: string): Promise<Checked> {
    for (const [productId, plan] of products) {
      const a = await postForm(f, GUMROAD_VERIFY_URL, { product_id: productId, license_key: key, increment_uses_count: 'false' }, o.timeoutMs);
      if (!a) return { kind: 'unreachable' };
      const answer = readVerifyAnswer(a.status, a.body);
      if (answer.kind === 'unreadable') return { kind: 'unreachable' };
      if (answer.kind === 'not_found') continue;
      const verdict = judgePurchase(answer.purchase as GumroadPurchase, now());
      if (verdict.status !== 'active') return { kind: 'refused', code: verdict.status };
      return { kind: 'found', e: entitlementFor(plan, 'gumroad', verdict.paidUntil !== null ? { exp: verdict.paidUntil } : {}) };
    }
    return { kind: 'not_found' };
  }

  return {
    id: 'gumroad',
    keepsProof: true,

    async activate(input) {
      const key = typeof input === 'string' ? input.trim() : '';
      if (!LICENSE_KEY_RE.test(key)) return fail('not_found');
      const r = await check(key);
      if (r.kind === 'found') return { ok: true, e: r.e };
      if (r.kind === 'refused') return fail(r.code);
      return fail(r.kind === 'unreachable' ? 'network' : 'not_found');
    },

    async refresh(_e, ctx?: RefreshContext) {
      if (!ctx || !ctx.proof || !LICENSE_KEY_RE.test(ctx.proof)) return 'keep';
      const r = await check(ctx.proof);
      if (r.kind === 'found') return r.e;
      return r.kind === 'unreachable' ? 'keep' : 'revoked';          // B2: only Gumroad's own "no" ends it
    },
  };
}
