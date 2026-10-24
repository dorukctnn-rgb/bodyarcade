// What the social module reads from the Worker's env (each server module narrows the shared env object to its own
// bindings, nobody edits a shared Env type).
//
// Two views of the same module:
//   - the Worker and the Rooms see one binding, SOCIAL: the namespace of the SocialDirectory Durable Object, which holds every
//     social table and every player's socket (directory.ts). They only forward to it.
//   - inside the directory the handlers see SocialEnv: the object's own SQL as DB, its sockets as HUB, and the settings.
import type { DurableObjectNamespaceLike, Fetcher } from '../cf.ts';
import { HttpError } from '../http.ts';
import type { SqlLike } from './db.ts';

/** The directory is one object: a name that never changes, so every request reaches the same tables. */
export const DIRECTORY_NAME = 'main';

/** The host of the Worker's own calls to the directory (never a real host: nothing from the internet carries it). */
export const INTERNAL_HOST = 'directory.internal';

/** What the Worker and the Rooms hold. */
export interface DirectoryBinding {
  /** Durable Object namespace of SocialDirectory (wrangler.jsonc binding "SOCIAL", migration v4). */
  SOCIAL: DurableObjectNamespaceLike;
}

/** The settings both views read. */
export interface SocialSettings {
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

/** What the handlers inside the directory see. */
export interface SocialEnv extends SocialSettings {
  /** The directory's own SQL (its Durable Object storage). */
  DB: SqlLike;
  /** The directory's sockets, in the shape of a namespace of per-player objects (hub.ts `namespace()`). */
  HUB: DurableObjectNamespaceLike;
}

/** True when the Worker has the directory binding (live play alone does not). */
export function hasSocial(raw: Record<string, unknown>): boolean {
  const ns = raw.SOCIAL as { get?: unknown; idFromName?: unknown } | null | undefined;
  return typeof ns === 'object' && ns !== null && typeof ns.get === 'function' && typeof ns.idFromName === 'function';
}

/** The directory object, or 503 `unavailable` when the binding is missing. */
export function directoryOf(raw: Record<string, unknown>): Fetcher {
  if (!hasSocial(raw)) throw new HttpError(503, 'unavailable');
  const ns = (raw as unknown as DirectoryBinding).SOCIAL;
  return ns.get(ns.idFromName(DIRECTORY_NAME));
}

/** True inside the directory (and in the handler tests): the tables and the sockets are there. */
export function hasLocal(raw: Record<string, unknown>): boolean {
  return typeof raw.DB === 'object' && raw.DB !== null && typeof raw.HUB === 'object' && raw.HUB !== null;
}

/** The env as SocialEnv, or 503 `unavailable` when the tables and sockets are not there. */
export function socialEnv(raw: Record<string, unknown>): SocialEnv {
  if (!hasLocal(raw)) throw new HttpError(503, 'unavailable');
  return raw as unknown as SocialEnv;
}
