// What every provider needs: the provider shape the manager drives, and a POST that never throws.
import type { ActivateResult, Entitlement, EntitlementProvider } from '../../types/index.ts';
import { API } from '../api.ts';

/** What a renewal is given besides the entitlement: the input that activated it (a licence key) and the device. */
export interface RefreshContext {
  proof: string | null;
  did: string;
}

/**
 * The contract's provider, with the two things the manager needs on top: whether a renewal has to be given the
 * activating input again (the server stores no key), and the device in the refresh call. A function with an optional
 * extra parameter still satisfies the contract's `refresh(e)`.
 */
export interface ManagedProvider extends EntitlementProvider {
  readonly keepsProof: boolean;
  activate(input: string): Promise<ActivateResult>;
  refresh(e: Entitlement, ctx?: RefreshContext): Promise<Entitlement | 'keep' | 'revoked'>;
  /** Gives this device's seat back to the server. Best effort: false when it could not be done. */
  release?(e: Entitlement): Promise<boolean>;
}

/** The `message` of the failure that means the person cancelled a purchase: not an error, nothing to explain. */
export const CANCELLED = 'cancelled';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** `status` and the parsed JSON (undefined when the body was not JSON). */
export interface HttpAnswer {
  status: number;
  body: unknown;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** A request that gives back the answer, or null for a network error or a timeout. It never throws. */
async function send(f: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<HttpAnswer | null> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await f(url, { ...init, cache: 'no-store', credentials: 'omit', ...(ctl ? { signal: ctl.signal } : {}) });
    let body: unknown;
    try { body = JSON.parse(await res.text()) as unknown; } catch { body = undefined; }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** A POST that gives back the answer, or null for a network error or a timeout. It never throws. */
export const post = (f: FetchLike, url: string, init: { body: string; headers: Record<string, string> }, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HttpAnswer | null> =>
  send(f, url, { method: 'POST', headers: init.headers, body: init.body }, timeoutMs);

/** A GET with the same promise: the answer, or null. It never throws. */
export const getJson = (f: FetchLike, url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HttpAnswer | null> =>
  send(f, url, { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs);

export const postJson = (f: FetchLike, url: string, data: unknown, timeoutMs?: number): Promise<HttpAnswer | null> =>
  post(f, url, { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }, timeoutMs);

export const postForm = (f: FetchLike, url: string, fields: Record<string, string>, timeoutMs?: number): Promise<HttpAnswer | null> =>
  post(f, url, { body: new URLSearchParams(fields).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, timeoutMs);

/** The global fetch, bound so it can be called without its owner. */
export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** Tells the server this device no longer uses its seat. */
export async function releaseSeat(f: FetchLike, baseUrl: string, e: Entitlement, did: string, timeoutMs?: number): Promise<boolean> {
  if (typeof e.token !== 'string') return false;
  const a = await postJson(f, `${baseUrl}${API.deactivate}`, { token: e.token, did }, timeoutMs);
  return a !== null && a.status === 200;
}
