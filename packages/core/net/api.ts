// The HTTP side of live play as the browser calls it (packages/server/src/live/routes.ts answers).
import type { AgeBand, IceGrant, JoinGrant, RoomPreview } from '../types/net.ts';

export class LiveApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The rest of the error body, when the Worker sent more than the code: for `pro_required` the `reason` (none, expired or invalid). */
  readonly info: Readonly<Record<string, unknown>> | undefined;
  constructor(status: number, code: string, info?: Readonly<Record<string, unknown>>) {
    super(code);
    this.status = status;
    this.code = code;
    this.info = info;
  }
}

/** Who is asking. Without signed profiles (builder SO) this is the anonymous device identity. */
export interface Identity {
  /** Random device id, 8-64 URL-safe characters, stored on the device and never shown to anyone. */
  pid: string;
  name: string;
  age: AgeBand;
}

export interface NewRoomRequest {
  kind?: 'private' | 'public';
  gameId: string;
  size?: number;
  durationMs?: number;
  band?: string | null;
}

/** A request that gets no answer at all (a network that swallows it) fails after this long instead of hanging for the browser's minutes. */
export const API_TIMEOUT_MS = 15_000;

async function call<T>(origin: string, method: 'GET' | 'POST', path: string, body?: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  const init: RequestInit = { method, cache: 'no-store' };
  if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), API_TIMEOUT_MS) : null;
  if (ctl) init.signal = ctl.signal;
  const timedOut = (): boolean => !!ctl && ctl.signal.aborted;
  try {
    let res: Response;
    try { res = await fetcher(origin + path, init); } catch { throw new LiveApiError(0, timedOut() ? 'timeout' : 'network'); }
    let data: unknown = null;
    try { data = await res.json(); } catch { if (timedOut()) throw new LiveApiError(0, 'timeout'); data = null; }
    if (!res.ok) {
      const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
      const { error, ...rest } = body ?? {};
      throw new LiveApiError(res.status, typeof error === 'string' ? error : 'http_' + res.status, Object.keys(rest).length ? rest : undefined);
    }
    return data as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `pro`: the player's signed entitlement token (core/entitlements: `entitlements.current().token`), or nothing for a free player. The
 * Worker checks it with the public key; a Pro game needs it from whoever creates the room (403 `pro_required`), while joining any room
 * never does. It rides in the body, so the signature of a signed call covers it.
 */
export const createRoom = (origin: string, who: Identity, room: NewRoomRequest, fetcher?: typeof fetch, pro?: string | null): Promise<JoinGrant> =>
  call<JoinGrant>(origin, 'POST', '/api/rooms', { ...room, ...who, ...(pro ? { pro } : {}) }, fetcher);

export const joinRoom = (origin: string, code: string, who: Identity, fetcher?: typeof fetch, pro?: string | null): Promise<JoinGrant> =>
  call<JoinGrant>(origin, 'POST', `/api/rooms/${encodeURIComponent(code)}/join`, { ...who, ...(pro ? { pro } : {}) }, fetcher);

export const previewRoom = (origin: string, code: string, fetcher?: typeof fetch): Promise<RoomPreview> =>
  call<RoomPreview>(origin, 'GET', `/api/rooms/${encodeURIComponent(code)}`, undefined, fetcher);

export const fetchIce = (origin: string, fetcher?: typeof fetch): Promise<IceGrant> =>
  call<IceGrant>(origin, 'POST', '/api/ice', undefined, fetcher);
