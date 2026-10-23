// HTTP and WebSocket routes of live play. Registered on the Worker's router with registerLiveRoutes(router).
//
//   POST /api/rooms                 create a room (private: invite link; public: lobby)      -> JoinGrant
//   GET  /api/rooms/:code           what an invite link points at (no names)                  -> RoomPreview
//   POST /api/rooms/:code/join      take a seat: signs a ticket                               -> JoinGrant
//   GET  /api/rooms/:code/ws        WebSocket, ?ticket=...                                    (the Room protocol)
//   POST /api/ice (GET too)         STUN and TURN credentials                                 -> IceGrant
//
// Builder SO (social) and S (store) do not call these: SO uses the Room through the hooks in hooks.ts and the
// summary stream they get from publishRoom; creating a room for a matchmade group goes through createRoomFor().
import { CLOSE, DEFAULT_DURATION_MS, MAX_SEATS, MIN_SEATS, type AgeBand, type JoinGrant, type RoomCode, type RoomPreview, type RoomSummary } from '../../../core/types/net.ts';
import { inviteLink, normalizeRoomCode, randomRoomCode } from '../../../core/net/codes.ts';
import { checkName } from '../../../core/net/chat-filter.ts';
import type { Fetcher } from '../cf.ts';
import { workersRuntime } from '../cf.ts';
import { HttpError, clientIp, fail, isRecord, json, publicOrigin, readJson } from '../http.ts';
import type { Router } from '../router.ts';
import { iceGrant } from './ice.ts';
import { LIMITS, allow } from './limits.ts';
import { CLAIMS_HEADER, encodeClaims } from './room.ts';
import { blockKey, checkSecret, signTicket, verifyTicket } from './tickets.ts';
import { liveHooks, type LivePlayer } from './hooks.ts';
import type { LiveEnv } from './env.ts';
import type { CheckResult, InitInput, InitResult } from './room-engine.ts';

const AGES: readonly AgeBand[] = ['child', 'teen', 'adult'];
const PID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function liveEnv(env: Record<string, unknown>): LiveEnv {
  return env as unknown as LiveEnv;
}

function roomStub(env: LiveEnv, code: RoomCode): Fetcher {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

async function roomCall<T>(env: LiveEnv, code: RoomCode, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const init: RequestInit = body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await roomStub(env, code).fetch(new Request(`https://room.internal${path}`, init));
  return { status: res.status, data: (await res.json()) as T };
}

function limited(req: Request, env: LiveEnv, what: string, max: number, windowMs: number): void {
  if (env.LIVE_NO_LIMITS === '1') return;
  if (!allow(`${what}:${clientIp(req)}`, max, windowMs)) throw new HttpError(429, 'rate_limited');
}

function codeParam(raw: string | undefined): RoomCode {
  const code = normalizeRoomCode(raw ?? '');
  if (!code) throw new HttpError(400, 'bad_code');
  return code;
}

/**
 * Who is calling. SO's verifyPlayer hook (signed device requests, stored profile) when registered; otherwise the
 * anonymous device identity of the body: a random device id (8-64 URL-safe characters), a display name that passes
 * the name filter and a self-declared age band.
 */
async function identify(req: Request, env: LiveEnv, body: Record<string, unknown>): Promise<LivePlayer> {
  const hook = liveHooks().verifyPlayer;
  if (hook) {
    const p = await hook(req, env, body);
    if (!p) throw new HttpError(401, 'auth');
    return p;
  }
  const pid = body.pid;
  if (typeof pid !== 'string' || !PID_RE.test(pid)) throw new HttpError(400, 'bad_pid');
  const age = body.age;
  if (typeof age !== 'string' || !AGES.includes(age as AgeBand)) throw new HttpError(400, 'bad_age');
  const name = checkName(typeof body.name === 'string' ? body.name : '');
  if (!name.ok) throw new HttpError(400, 'bad_name', { reason: name.reason });
  return { pid, name: name.text, age: age as AgeBand };
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await readJson(req, 4096);
  if (!isRecord(b)) throw new HttpError(400, 'bad_json');
  return b;
}

async function grant(env: LiveEnv, req: Request, code: RoomCode, player: LivePlayer, room: RoomPreview): Promise<JoinGrant> {
  const secret = checkSecret(env.TICKET_SECRET);
  const { claims, ticket } = await signTicket(secret, { code, pid: player.pid, name: player.name, age: player.age, ...(player.mutedUntil ? { mutedUntil: player.mutedUntil } : {}) }, Date.now());
  return { code, link: inviteLink(publicOrigin(req, env.PUBLIC_ORIGIN), code), ticket, exp: claims.e, room };
}

export interface NewRoom {
  kind: 'private' | 'public';
  gameId: string;
  size: number;
  durationMs: number;
  band: string | null;
}

/**
 * Creates a room and returns its code (retrying on the rare collision). Used by POST /api/rooms; SO's matchmaker
 * calls it too, through the same route, so every room is created one way.
 */
export async function createRoomFor(env: LiveEnv, room: NewRoom, creator: LivePlayer): Promise<{ code: RoomCode; preview: RoomPreview }> {
  if (room.kind === 'public' && creator.age === 'child') throw new HttpError(403, 'age_not_allowed');
  for (let i = 0; i < 6; i++) {
    const code = randomRoomCode();
    const input: InitInput = {
      code, kind: room.kind, size: room.size, config: { gameId: room.gameId, durationMs: room.durationMs, band: room.band },
      audience: room.kind === 'public' ? creator.age : null, creator: creator.pid,
    };
    const r = await roomCall<InitResult>(env, code, '/init', input);
    if (r.data.ok) {
      const pv = await roomCall<RoomPreview>(env, code, '/preview');
      return { code, preview: pv.data };
    }
    if (r.data.error !== 'exists') throw new HttpError(400, r.data.error);
  }
  throw new HttpError(503, 'no_code');
}

const createRoom = async (req: Request, rawEnv: Record<string, unknown>): Promise<Response> => {
  const env = liveEnv(rawEnv);
  limited(req, env, 'create', LIMITS.createPerHour, 3600_000);
  const b = await body(req);
  const kind = b.kind === undefined || b.kind === 'private' ? 'private' : b.kind === 'public' ? 'public' : null;
  if (!kind) throw new HttpError(400, 'bad_kind');
  const size = b.size === undefined ? 2 : b.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < MIN_SEATS || size > MAX_SEATS) throw new HttpError(400, 'bad_size');
  if (typeof b.gameId !== 'string') throw new HttpError(400, 'bad_config');
  const durationMs = b.durationMs === undefined ? DEFAULT_DURATION_MS : b.durationMs;
  if (typeof durationMs !== 'number') throw new HttpError(400, 'bad_config');
  const band = b.band === undefined || b.band === null ? null : b.band;
  if (band !== null && typeof band !== 'string') throw new HttpError(400, 'bad_config');
  const player = await identify(req, env, b);
  const { code, preview } = await createRoomFor(env, { kind, gameId: b.gameId, size, durationMs, band }, player);
  return json(await grant(env, req, code, player, preview), 201);
};

const previewRoom = async (req: Request, rawEnv: Record<string, unknown>, _ctx: unknown, params: Readonly<Record<string, string>>): Promise<Response> => {
  const env = liveEnv(rawEnv);
  limited(req, env, 'preview', LIMITS.previewPerMin, 60_000);
  const code = codeParam(params.code);
  const r = await roomCall<RoomPreview>(env, code, '/preview');
  if (r.status !== 200) throw new HttpError(404, 'no_room');
  return json(r.data);
};

const joinRoom = async (req: Request, rawEnv: Record<string, unknown>, _ctx: unknown, params: Readonly<Record<string, string>>): Promise<Response> => {
  const env = liveEnv(rawEnv);
  limited(req, env, 'join', LIMITS.joinPer10Min, 600_000);
  const code = codeParam(params.code);
  const b = await body(req);
  const player = await identify(req, env, b);
  const sum = await roomCall<RoomSummary>(env, code, '/summary');
  if (sum.status !== 200) throw new HttpError(404, 'no_room');
  const gate = liveHooks().gateJoin;
  if (sum.data.kind === 'public' && gate && !(await gate(env, sum.data, player))) throw new HttpError(403, 'not_allowed');
  const k = await blockKey(checkSecret(env.TICKET_SECRET), player.pid);
  const chk = await roomCall<CheckResult>(env, code, '/check', { p: player.pid, a: player.age, k });
  if (!chk.data.ok) {
    const e = chk.data.error;
    throw new HttpError(e === 'no_room' ? 404 : e === 'full' ? 409 : 403, e);
  }
  return json(await grant(env, req, code, player, chk.data.preview));
};

/** Accepts the upgrade and closes at once with `code`, so the page gets a close code instead of a bare failure. */
function closedSocket(code: number, reason: string): Response {
  const rt = workersRuntime();
  const pair = new rt.WebSocketPair();
  const server = pair[1];
  server.accept?.();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
}

const connectRoom = async (req: Request, rawEnv: Record<string, unknown>, _ctx: unknown, params: Readonly<Record<string, string>>): Promise<Response> => {
  const env = liveEnv(rawEnv);
  if (req.headers.get('Upgrade') !== 'websocket') return fail('expected_websocket', 426);
  const origin = req.headers.get('Origin');
  if (origin) {
    let sameHost = false;
    try { sameHost = new URL(origin).host === new URL(req.url).host; } catch { sameHost = false; }
    if (!sameHost) return fail('origin', 403);
  }
  const code = codeParam(params.code);
  const v = await verifyTicket(checkSecret(env.TICKET_SECRET), new URL(req.url).searchParams.get('ticket'), Date.now(), code);
  if (!v.ok) return closedSocket(CLOSE.TICKET, v.error);
  const headers = new Headers({ Upgrade: 'websocket', [CLAIMS_HEADER]: encodeClaims(v.claims) });
  return roomStub(env, code).fetch(new Request('https://room.internal/ws', { headers }));
};

const iceRoute = async (req: Request, rawEnv: Record<string, unknown>): Promise<Response> => {
  const env = liveEnv(rawEnv);
  limited(req, env, 'ice', LIMITS.icePer10Min, 600_000);
  return json(await iceGrant(env, Date.now()));
};

export function registerLiveRoutes(router: Router): void {
  router.add('POST', '/api/rooms', createRoom);
  router.add('GET', '/api/rooms/:code', previewRoom);
  router.add('POST', '/api/rooms/:code/join', joinRoom);
  router.add('GET', '/api/rooms/:code/ws', connectRoom);
  router.add('POST', '/api/ice', iceRoute);
  router.add('GET', '/api/ice', iceRoute);
}
