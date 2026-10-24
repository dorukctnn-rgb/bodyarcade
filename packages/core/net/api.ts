// The HTTP side of live play as the browser calls it (packages/server/src/live/routes.ts answers).
import type { AgeBand, IceGrant, JoinGrant, RoomPreview } from '../types/net.ts';

export class LiveApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
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
    if (!res.ok) throw new LiveApiError(res.status, typeof (data as { error?: unknown } | null)?.error === 'string' ? ((data as { error: string }).error) : 'http_' + res.status);
    return data as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const createRoom = (origin: string, who: Identity, room: NewRoomRequest, fetcher?: typeof fetch): Promise<JoinGrant> =>
  call<JoinGrant>(origin, 'POST', '/api/rooms', { ...room, ...who }, fetcher);

export const joinRoom = (origin: string, code: string, who: Identity, fetcher?: typeof fetch): Promise<JoinGrant> =>
  call<JoinGrant>(origin, 'POST', `/api/rooms/${encodeURIComponent(code)}/join`, who, fetcher);

export const previewRoom = (origin: string, code: string, fetcher?: typeof fetch): Promise<RoomPreview> =>
  call<RoomPreview>(origin, 'GET', `/api/rooms/${encodeURIComponent(code)}`, undefined, fetcher);

export const fetchIce = (origin: string, fetcher?: typeof fetch): Promise<IceGrant> =>
  call<IceGrant>(origin, 'POST', '/api/ice', undefined, fetcher);
