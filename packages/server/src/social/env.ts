// What the social module reads from the Worker's env (each server module narrows the shared env object to its own
// bindings, nobody edits a shared Env type).
import type { DurableObjectNamespaceLike } from '../cf.ts';
import { HttpError } from '../http.ts';
import type { D1Like } from './db.ts';

export interface SocialEnv {
  /** The D1 database (wrangler.jsonc d1_databases binding "DB"; schema in packages/server/migrations). */
  DB: D1Like;
  /** Durable Object namespace of PlayerHub (binding "HUB"). */
  HUB: DurableObjectNamespaceLike;
  /** The same secret live play signs tickets with (at least 32 characters): here it only keys the address hash. */
  TICKET_SECRET: string;
  /** Origin of the public site for friend links (https://bodyarcade.com); the request's own origin when absent. */
  PUBLIC_ORIGIN?: string;
  /** Bearer token of the moderation API (a Worker secret). Without it /api/admin/social/* answers 404. */
  ADMIN_TOKEN?: string;
  /** Overrides the daily cap of new profiles (default 4000, the free-plan budget breaker). */
  SOCIAL_MAX_SIGNUPS_PER_DAY?: string;
  /** Tests: "1" lifts the per-address limits and the per-address request guard (a suite registers dozens of devices from one address). */
  SOCIAL_NO_LIMITS?: string;
}

/** True when the Worker has the bindings the social module needs (live play alone does not). */
export function hasSocial(raw: Record<string, unknown>): boolean {
  return typeof raw.DB === 'object' && raw.DB !== null && typeof raw.HUB === 'object' && raw.HUB !== null;
}

/** The env as SocialEnv, or 503 `unavailable` when the bindings are missing. */
export function socialEnv(raw: Record<string, unknown>): SocialEnv {
  if (!hasSocial(raw)) throw new HttpError(503, 'unavailable');
  return raw as unknown as SocialEnv;
}
