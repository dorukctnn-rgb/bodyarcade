// What the entitlement module reads from the Worker's env (each server module narrows the shared env object to its own
// bindings, nobody edits a shared Env type).
import type { DurableObjectNamespaceLike } from '../cf.ts';
import { HttpError } from '../http.ts';

export interface EntitlementsEnv {
  /** The Durable Object namespace of EntitlementsDO (binding "ENTITLEMENTS", migration "ent-v1"). */
  ENTITLEMENTS: DurableObjectNamespaceLike;
  /** Secret: the ES256 private key (a JWK with a `kid`) that signs entitlement tokens. Without it nothing can be granted. */
  ENT_PRIV_JWK?: string;
  /** Optional variable: a JSON array of older public keys ({ kid, jwk }) that devices still hold, kept while a key is rotated. */
  ENT_PUB_JWKS?: string;
  /** Secret: the Google Play service account (JSON) that checks purchases. Without it Play purchases answer "unavailable". */
  PLAY_SA_JSON?: string;
  /** Optional variable: JSON { "<Gumroad product id>": "<plan id>" } for products added after the code was released. */
  GUMROAD_PRODUCTS?: string;
  /** Secret: API token of the mail service that sends the trial reminder (ForwardEmail). Without it the reminder box is not offered. */
  ENT_MAIL_TOKEN?: string;
  /** The sender of the reminder e-mail, for example "BodyArcade <info@bodyarcade.com>". */
  ENT_MAIL_FROM?: string;
  /** Tests: "1" lifts the per-address limits. */
  ENT_NO_LIMITS?: string;
}

/** True when the Worker has the binding this module needs. */
export function hasEntitlements(raw: Record<string, unknown>): boolean {
  const ns = raw.ENTITLEMENTS;
  return typeof ns === 'object' && ns !== null && typeof (ns as { idFromName?: unknown }).idFromName === 'function';
}

/** The env as EntitlementsEnv, or 503 `unavailable` when the binding is missing (a Worker without this module's migration). */
export function entitlementsEnv(raw: Record<string, unknown>): EntitlementsEnv {
  if (!hasEntitlements(raw)) throw new HttpError(503, 'unavailable');
  return raw as unknown as EntitlementsEnv;
}
