// The HTTP layer of live play against an in-process "Durable Object namespace" that runs real RoomEngines.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NET_PROTOCOL, type JoinGrant, type RoomPreview, type RoomSummary } from '../../../core/types/net.ts';
import { b64urlEncode } from '../../../core/entitlements/token.ts';
import type { DurableObjectNamespaceLike, Fetcher } from '../cf.ts';
import { Router } from '../router.ts';
import { clearLiveHooks, setLiveHooks } from './hooks.ts';
import { resetLimits } from './limits.ts';
import { resetProKeys, verifyProProof } from './pro.ts';
import { DAY_S, makeProKit, type ProKit } from './prokit.ts';
import { createRoomFor, issueJoin, registerLiveRoutes, roomSummary } from './routes.ts';
import { RoomEngine, type InitInput } from './room-engine.ts';
import { FakeHost, decodeTicketForTest } from './testkit.ts';
import type { LiveEnv } from './env.ts';

const SECRET = 'unit-test-ticket-secret-0123456789abcdef';

class FakeRooms implements DurableObjectNamespaceLike {
  readonly engines = new Map<string, Promise<RoomEngine>>();
  readonly hosts = new Map<string, FakeHost>();
  idFromName(name: string) { return { toString: () => name, name }; }
  get(id: { name?: string; toString(): string }): Fetcher {
    const name = id.name ?? id.toString();
    const engine = (): Promise<RoomEngine> => {
      let e = this.engines.get(name);
      if (!e) { const h = new FakeHost(); this.hosts.set(name, h); e = RoomEngine.create(h); this.engines.set(name, e); }
      return e;
    };
    return {
      fetch: async (req: Request | string): Promise<Response> => {
        const r = typeof req === 'string' ? new Request(req) : req;
        const e = await engine();
        const path = new URL(r.url).pathname;
        if (path === '/init') { const res = e.init((await r.json()) as InitInput); return Response.json(res, { status: res.ok ? 200 : res.error === 'exists' ? 409 : 400 }); }
        if (path === '/preview') { const p = e.preview(); return p ? Response.json(p) : Response.json({ error: 'no_room' }, { status: 404 }); }
        if (path === '/summary') { const s = e.summary(); return s ? Response.json(s) : Response.json({ error: 'no_room' }, { status: 404 }); }
        if (path === '/check') { const c = e.check((await r.json()) as { p: string; a: 'child' | 'teen' | 'adult'; k: string }); return Response.json(c, { status: c.ok ? 200 : 403 }); }
        return new Response('not found', { status: 404 });
      },
    };
  }
}

let rooms: FakeRooms;
let router: Router;
let env: LiveEnv;
const ctx = { waitUntil: () => undefined };

beforeEach(() => {
  rooms = new FakeRooms();
  router = new Router();
  registerLiveRoutes(router);
  env = { ROOMS: rooms, TICKET_SECRET: SECRET, PUBLIC_ORIGIN: 'https://bodyarcade.test' };
  clearLiveHooks();
  resetLimits();
});
afterEach(() => { clearLiveHooks(); });

const alice = { pid: 'alice-device-0001', name: 'Alice', age: 'adult' };
const post = (path: string, body: unknown, headers: Record<string, string> = {}, e: LiveEnv = env) =>
  router.handle(new Request(`http://site${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), e as unknown as Record<string, unknown>, ctx);
const get = (path: string, headers: Record<string, string> = {}) =>
  router.handle(new Request(`http://site${path}`, { headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers } }), env as unknown as Record<string, unknown>, ctx);

async function created(over: Record<string, unknown> = {}): Promise<JoinGrant> {
  const res = await post('/api/rooms', { gameId: 'squat-flap', ...alice, ...over });
  expect(res?.status).toBe(201);
  return (await res?.json()) as JoinGrant;
}

describe('POST /api/rooms', () => {
  it('creates a private room: code, invite link on the public origin, a signed ticket for the creator', async () => {
    const g = await created();
    expect(g.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(g.link).toBe(`https://bodyarcade.test/r/${g.code}`);
    expect(g.room).toEqual({ code: g.code, kind: 'private', gameId: 'squat-flap', size: 2, players: 0, phase: 'lobby' });
    const t = await decodeTicketForTest(SECRET, g.ticket, g.code);
    expect(t).toMatchObject({ c: g.code, p: alice.pid, n: 'Alice', a: 'adult' });
    expect(t.k).toMatch(/^[A-Za-z0-9_-]{16,40}$/);
    expect(g.exp).toBe(t.e);
  });

  it('takes a size of 2 to 4, a length and, for public rooms, a level band', async () => {
    const g = await created({ size: 4, durationMs: 45_000, kind: 'public', band: 'easy' });
    const s = await roomSummary(env, g.code);
    expect(s).toMatchObject({ kind: 'public', size: 4, band: 'easy', audience: 'adult', gameId: 'squat-flap' });
    expect(rooms.hosts.get(g.code)?.store.size).toBeGreaterThan(0);
  });

  it('refuses what is not valid, with a stable code each', async () => {
    const bad = async (over: Record<string, unknown>, status: number, error: string) => {
      const res = await post('/api/rooms', { gameId: 'squat-flap', ...alice, ...over });
      expect([res?.status, ((await res?.json()) as { error: string }).error]).toEqual([status, error]);
    };
    await bad({ pid: 'short' }, 400, 'bad_pid');
    await bad({ pid: 'has spaces in it' }, 400, 'bad_pid');
    await bad({ age: 'old' }, 400, 'bad_age');
    await bad({ name: 'http://spam.example' }, 400, 'bad_name');
    await bad({ name: '' }, 400, 'bad_name');
    await bad({ kind: 'secret' }, 400, 'bad_kind');
    await bad({ size: 1 }, 400, 'bad_size');
    await bad({ size: 5 }, 400, 'bad_size');
    await bad({ size: 2.5 }, 400, 'bad_size');
    await bad({ gameId: undefined }, 400, 'bad_config');
    await bad({ gameId: 'Bad Game' }, 400, 'bad_config');
    await bad({ durationMs: 500 }, 400, 'bad_config');
    await bad({ durationMs: '90000' }, 400, 'bad_config');
    await bad({ kind: 'public', age: 'child' }, 403, 'age_not_allowed');
  });

  it('refuses non-JSON, malformed JSON and oversized bodies', async () => {
    const bad = async (body: string, headers: Record<string, string>, status: number) => expect((await post('/api/rooms', body, headers))?.status).toBe(status);
    await bad('hello', { 'Content-Type': 'text/plain' }, 415);
    await bad('{nope', {}, 400);
    await bad(JSON.stringify({ gameId: 'squat-flap', pad: 'x'.repeat(6000) }), {}, 413);
    await bad('[1,2]', {}, 400);
  });

  it('limits room creation per address', async () => {
    for (let i = 0; i < 30; i++) expect((await post('/api/rooms', { gameId: 'squat-flap', ...alice }))?.status).toBe(201);
    const res = await post('/api/rooms', { gameId: 'squat-flap', ...alice });
    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({ error: 'rate_limited' });
    expect((await post('/api/rooms', { gameId: 'squat-flap', ...alice }, { 'CF-Connecting-IP': '9.9.9.9' }))?.status).toBe(201);
    resetLimits();
    expect((await post('/api/rooms', { gameId: 'squat-flap', ...alice }, {}, { ...env, LIVE_NO_LIMITS: '1' }))?.status).toBe(201);
  });
});

describe('GET /api/rooms/:code and POST /api/rooms/:code/join', () => {
  it('previews a room without names and accepts any spelling of the code', async () => {
    const g = await created();
    const p = (await (await get(`/api/rooms/${g.code.toLowerCase()}`))?.json()) as RoomPreview;
    expect(p).toEqual(g.room);
    expect((await get(`/api/rooms/${g.code.slice(0, 3)}-${g.code.slice(3)}`))?.status).toBe(200);
    expect((await get('/api/rooms/ABCDE'))?.status).toBe(400);
    expect((await get('/api/rooms/AAAAAA'))?.status).toBe(404);
    expect(await (await get('/api/rooms/AAAAAA'))?.json()).toEqual({ error: 'no_room' });
  });

  it('gives a joining player a ticket for that room only', async () => {
    const g = await created();
    const res = await post(`/api/rooms/${g.code}/join`, { pid: 'bob-device-00002', name: 'Bob', age: 'teen' });
    expect(res?.status).toBe(200);
    const j = (await res?.json()) as JoinGrant;
    const t = await decodeTicketForTest(SECRET, j.ticket, g.code);
    expect(t).toMatchObject({ p: 'bob-device-00002', n: 'Bob', a: 'teen', c: g.code });
    await expect(decodeTicketForTest(SECRET, j.ticket, 'AAAAAA')).rejects.toThrow(/wrong_room/);
    expect((await post('/api/rooms/AAAAAA/join', { pid: 'bob-device-00002', name: 'Bob', age: 'teen' }))?.status).toBe(404);
  });

  it('answers 409 full when every seat is taken, and 403 for a player the room does not take', async () => {
    const g = await created({ kind: 'public' });
    // fill the room through the engine: two adults say hello
    const host = rooms.hosts.get(g.code) as FakeHost;
    const engine = await (rooms.engines.get(g.code) as Promise<RoomEngine>);
    for (const pid of ['p1-device-000001', 'p2-device-000002']) {
      const c = host.newConn();
      engine.accept(c, { v: 1, c: g.code, p: pid, n: pid.slice(0, 2), a: 'adult', k: `bk_${pid}_0123456789`, e: 4_000_000_000 });
      engine.message(c, JSON.stringify({ t: 'hello', v: 1, tab: 't' + pid, sess: 's' + pid, video: false, reasons: [], blocks: [] }));
    }
    const full = await post(`/api/rooms/${g.code}/join`, { pid: 'p3-device-000003', name: 'Pat', age: 'adult' });
    expect(full?.status).toBe(409);
    expect(await full?.json()).toEqual({ error: 'full' });
    const teen = await post(`/api/rooms/${g.code}/join`, { pid: 'p4-device-000004', name: 'Tim', age: 'teen' });
    expect([teen?.status, ((await teen?.json()) as { error: string }).error]).toEqual([403, 'not_allowed']);
    // a member can always get a new ticket (a reload, a second device tab)
    expect((await post(`/api/rooms/${g.code}/join`, { pid: 'p1-device-000001', name: 'p1', age: 'adult' }))?.status).toBe(200);
  });
});

describe('hooks from the social module', () => {
  it('verifyPlayer replaces the identity of the body: 401 when it says no', async () => {
    setLiveHooks({ verifyPlayer: async (_req, _env, body) => (body.pid === 'known-device-0001' ? { pid: 'known-device-0001', name: 'From Profile', age: 'teen', mutedUntil: Date.now() + 60_000 } : null) });
    expect((await post('/api/rooms', { gameId: 'squat-flap', pid: 'unknown-device-01', name: 'x', age: 'adult' }))?.status).toBe(401);
    const res = await post('/api/rooms', { gameId: 'squat-flap', pid: 'known-device-0001', name: 'ignored', age: 'adult' });
    const g = (await res?.json()) as JoinGrant;
    const t = await decodeTicketForTest(SECRET, g.ticket, g.code);
    expect(t).toMatchObject({ n: 'From Profile', a: 'teen' });
    expect(t.m).toBeGreaterThan(Date.now());
  });

  it('gateJoin can refuse a join to a public room, never to a private one', async () => {
    const seen: RoomSummary[] = [];
    setLiveHooks({ gateJoin: async (_env, s) => { seen.push(s); return false; } });
    const pub = await created({ kind: 'public' });
    expect((await post(`/api/rooms/${pub.code}/join`, { pid: 'bob-device-00002', name: 'Bob', age: 'adult' }))?.status).toBe(403);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: pub.code, kind: 'public' });
    const priv = await created();
    expect((await post(`/api/rooms/${priv.code}/join`, { pid: 'bob-device-00002', name: 'Bob', age: 'adult' }))?.status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it('createRoomFor and issueJoin let the matchmaker build a room and hand out tickets in process', async () => {
    const { code, preview } = await createRoomFor(env, { kind: 'public', gameId: 'knee-sprint', size: 3, durationMs: 60_000, band: 'medium' }, { pid: 'maker-device-0001', name: 'Maker', age: 'teen' });
    expect(preview).toMatchObject({ code, kind: 'public', gameId: 'knee-sprint', size: 3 });
    const g = await issueJoin(env, 'https://bodyarcade.test', code, { pid: 'teen2-device-0002', name: 'Teen Two', age: 'teen' });
    expect(g.link).toBe(`https://bodyarcade.test/r/${code}`);
    await expect(issueJoin(env, 'https://x', code, { pid: 'adult-device-0003', name: 'Adult', age: 'adult' })).rejects.toMatchObject({ status: 403, code: 'not_allowed' });
    await expect(issueJoin(env, 'https://x', 'AAAAAA', { pid: 'adult-device-0003', name: 'Adult', age: 'adult' })).rejects.toMatchObject({ status: 404 });
    await expect(createRoomFor(env, { kind: 'public', gameId: 'squat-flap', size: 2, durationMs: 60_000, band: null }, { pid: 'kid-device-000001', name: 'Kid', age: 'child' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('the WebSocket route and ICE', () => {
  it('needs an upgrade, the same origin and a valid code before it looks at the ticket', async () => {
    const g = await created();
    expect((await get(`/api/rooms/${g.code}/ws?ticket=x`))?.status).toBe(426);
    const evil = await get(`/api/rooms/${g.code}/ws?ticket=x`, { Upgrade: 'websocket', Origin: 'https://evil.example' });
    expect(evil?.status).toBe(403);
    expect(await evil?.json()).toEqual({ error: 'origin' });
    expect((await get('/api/rooms/nope/ws?ticket=x', { Upgrade: 'websocket', Origin: 'http://site' }))?.status).toBe(400);
  });

  it('serves ICE servers on POST and GET, STUN only without a TURN key, and limits the rate', async () => {
    const p = await post('/api/ice', {});
    expect(p?.status).toBe(200);
    expect(await p?.json()).toMatchObject({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turn: false });
    expect((await get('/api/ice'))?.status).toBe(200);
    for (let i = 0; i < 40; i++) await get('/api/ice');
    expect((await get('/api/ice'))?.status).toBe(429);
  });

  it('answers unknown API paths with JSON 404 and leaves other paths to the assets', async () => {
    expect((await get('/api/rooms/AAAAAA/nothing'))?.status).toBe(404);
    expect(await get('/games/squat-flap')).toBeNull();
  });
});

describe('invite links', () => {
  const shell = new Response('<!doctype html><title>BodyArcade</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"x"' } });
  const withAssets = (fn: (req: Request) => Response | Promise<Response>): LiveEnv => ({ ...env, ASSETS: { fetch: async (r: Request | string) => fn(typeof r === 'string' ? new Request(r) : r) } });

  it('serves the start page under /r/<CODE>, kept out of search results and revalidated', async () => {
    const seen: string[] = [];
    const e = withAssets((r) => { seen.push(new URL(r.url).pathname); return shell.clone(); });
    const res = await router.handle(new Request('http://site/r/K7P2QX?utm=x'), e as unknown as Record<string, unknown>, ctx);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toContain('<title>BodyArcade</title>');
    expect(seen).toEqual(['/']);
    expect(res?.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res?.headers.get('Cache-Control')).toBe('no-cache');
    expect(res?.headers.get('Content-Type')).toContain('text/html');
  });

  it('serves the shell for any code (the page says what is wrong with a mistyped one), answers HEAD, and refuses other methods', async () => {
    const e = withAssets(() => shell.clone());
    expect((await router.handle(new Request('http://site/r/not-a-code'), e as unknown as Record<string, unknown>, ctx))?.status).toBe(200);
    expect((await router.handle(new Request('http://site/r/K7P2QX', { method: 'HEAD' }), e as unknown as Record<string, unknown>, ctx))?.status).toBe(200);
    expect((await router.handle(new Request('http://site/r/K7P2QX', { method: 'POST' }), e as unknown as Record<string, unknown>, ctx))?.status).toBe(405);
  });

  it('is a 404 without static assets, and a redirecting or failing start page never leaks a redirect', async () => {
    expect((await router.handle(new Request('http://site/r/K7P2QX'), env as unknown as Record<string, unknown>, ctx))?.status).toBe(404);
    const e = withAssets(() => new Response(null, { status: 301, headers: { Location: 'https://elsewhere.test/' } }));
    const res = await router.handle(new Request('http://site/r/K7P2QX'), e as unknown as Record<string, unknown>, ctx);
    expect(res?.status).toBe(503);
    expect(res?.headers.get('Location')).toBeNull();
  });
});

describe('Pro games: the signed Pro token of the host is checked with the public key before a Pro game can be made or started', () => {
  // The paywall says "rooms where everyone plays the Pro games the host picks". A page that says "I am Pro" has nothing to show; only a token that
  // the entitlement service signed (core/entitlements) counts, and the Worker writes what it proves into the ticket, never the page.
  let kit: ProKit;
  let other: ProKit;
  beforeAll(async () => { kit = await makeProKit(); other = await makeProKit(); });
  beforeEach(() => { resetProKeys(); });

  const proEnv = (): LiveEnv => ({ ...env, ...kit.env });
  const nowS = (): number => Math.floor(Date.now() / 1000);
  const createPro = (pro?: unknown, over: Record<string, unknown> = {}, e?: LiveEnv): Promise<Response | null> =>
    post('/api/rooms', { gameId: 'limbo-bend', ...alice, ...(pro === undefined ? {} : { pro }), ...over }, {}, e ?? proEnv());
  const said = async (res: Response | null | undefined): Promise<[number | undefined, unknown]> => [res?.status, await res?.json()];
  const refused = (reason: string): [number, unknown] => [403, { error: 'pro_required', reason }];
  const hasProof = async (g: JoinGrant): Promise<number | null> => { const c = await decodeTicketForTest(SECRET, g.ticket, g.code); return c.x ?? null; };
  const bob = { pid: 'bob-device-00002', name: 'Bob', age: 'adult' };

  it('a host with no token is refused a Pro game, with the reason, and no room is made', async () => {
    expect(await said(await createPro())).toEqual(refused('none'));
    expect(await said(await createPro(null))).toEqual(refused('none'));
    expect(await said(await createPro(''))).toEqual(refused('none'));
    expect(rooms.engines.size).toBe(0);
  });

  it('every Pro game of the catalogue is covered, and the free ones are not', async () => {
    for (const gameId of ['limbo-bend', 'pad-work', 'reaction-tag']) expect(await said(await createPro(undefined, { gameId })), gameId).toEqual(refused('none'));
    for (const gameId of ['squat-flap', 'knee-sprint', 'star-catch', 'jacks', 'road-run']) expect((await createPro(undefined, { gameId }))?.status, gameId).toBe(201);
  });

  it('a flag, a made-up token, a forged one (another key, or the right name with another key) or one that is not Pro is refused as invalid', async () => {
    const stranger = await other.mint();
    const [h, p, s] = stranger.split('.') as [string, string, string];
    const header = JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    const named = `${b64urlEncode(new TextEncoder().encode(JSON.stringify({ ...header, kid: kit.publicKey.kid })))}.${p}.${s}`;
    const noPro = await kit.mint({ feat: [] });
    for (const pro of [true, 1, 'true', 'pro', 'a.b.c', stranger, named, noPro, { pro: true }, ['x']]) {
      expect(await said(await createPro(pro)), JSON.stringify(pro).slice(0, 24)).toEqual(refused('invalid'));
    }
    expect(rooms.engines.size).toBe(0);
  });

  it('a genuine token that was changed after signing is refused (a longer end date, a better plan, another feature)', async () => {
    const t = await kit.mint({ plan: 'pro-monthly', iat: nowS() - 60, exp: nowS() + 600 });
    const [h, p, s] = t.split('.') as [string, string, string];
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    const reissue = (over: Record<string, unknown>): string => `${h}.${b64urlEncode(new TextEncoder().encode(JSON.stringify({ ...payload, ...over })))}.${s}`;
    for (const over of [{ exp: nowS() + 6 * DAY_S }, { plan: 'lifetime' }, { feat: ['pro', 'family6'] }]) {
      expect(await said(await createPro(reissue(over))), JSON.stringify(over)).toEqual(refused('invalid'));
    }
    expect((await createPro(t))?.status).toBe(201);
  });

  it('claims in the body that are not a token are never read: isPro, plan, free and the like leave the host free', async () => {
    const res = await createPro(undefined, { isPro: true, plan: 'lifetime', feat: ['pro'], proUntil: 4e12, x: 4_000_000_000, free: false, entitlement: { pro: true } });
    expect(await said(res)).toEqual(refused('none'));
  });

  it('an expired token is "expired" (the app renews it when it is online), also one that ended a second ago', async () => {
    const old = await kit.mint({ iat: nowS() - 5 * DAY_S, exp: nowS() - 2 * DAY_S });
    const justNow = await kit.mint({ iat: nowS() - 3600, exp: nowS() - 1 });
    for (const pro of [old, justNow]) expect(await said(await createPro(pro))).toEqual(refused('expired'));
    expect(rooms.engines.size).toBe(0);
  });

  it('a Worker with no entitlement key believes no token at all', async () => {
    const t = await kit.mint();
    expect(await said(await createPro(t, {}, env))).toEqual(refused('invalid'));
    expect(await said(await createPro(t, {}, { ...env, ENT_PRIV_JWK: 'not a key' }))).toEqual(refused('invalid'));
    // the older keys of a rotation are enough to verify
    expect((await createPro(t, {}, { ...env, ENT_PUB_JWKS: JSON.stringify([kit.publicKey]) }))?.status).toBe(201);
  });

  it('a genuine Pro token opens the Pro game: a room is made, the ticket carries the verified end of the token and the Room holds the authorisation', async () => {
    const exp = nowS() + 3 * DAY_S;
    const res = await createPro(await kit.mint({ iat: nowS() - 60, exp }));
    expect(res?.status).toBe(201);
    const g = (await res?.json()) as JoinGrant;
    expect(g.room).toMatchObject({ gameId: 'limbo-bend', phase: 'lobby' });
    expect(await hasProof(g)).toBe(exp);
    const engine = await (rooms.engines.get(g.code) as Promise<RoomEngine>);
    expect(engine.inspect().meta?.auth).toEqual({ game: 'limbo-bend', until: exp * 1000 });
  });

  it('every plan that is sold or was sold opens it (all of them carry pro)', async () => {
    for (const [plan, feat] of [['pro-monthly', ['pro']], ['pro-yearly', ['pro']], ['family-yearly', ['pro', 'family6']], ['lifetime', ['pro']], ['legacy-monthly', ['pro']], ['founder', ['pro', 'family6']]] as const) {
      expect((await createPro(await kit.mint({ plan, feat: [...feat] })))?.status, plan).toBe(201);
    }
  });

  it('free games are open to everybody and a bad token is no error there: only a verified token puts a proof in the ticket', async () => {
    const exp = nowS() + DAY_S;
    for (const [pro, proof] of [[undefined, null], ['junk', null], [await other.mint(), null], [await kit.mint({ exp: nowS() - 5, iat: nowS() - 600 }), null], [await kit.mint({ exp }), exp]] as const) {
      const res = await createPro(pro, { gameId: 'squat-flap' });
      expect(res?.status, String(pro).slice(0, 12)).toBe(201);
      expect(await hasProof((await res?.json()) as JoinGrant), String(pro).slice(0, 12)).toBe(proof);
    }
  });

  it('joining never needs a token: a free player takes a seat in a Pro room, a bad token changes nothing, a good one puts a proof in the ticket', async () => {
    const g = (await (await createPro(await kit.mint({ exp: nowS() + 3 * DAY_S })))?.json()) as JoinGrant;
    const join = async (extra: Record<string, unknown>): Promise<JoinGrant> => {
      const res = await post(`/api/rooms/${g.code}/join`, { ...bob, ...extra }, {}, proEnv());
      expect(res?.status).toBe(200);
      return (await res?.json()) as JoinGrant;
    };
    expect(await hasProof(await join({}))).toBeNull();
    expect(await hasProof(await join({ pro: 'junk' }))).toBeNull();
    expect(await hasProof(await join({ pro: await other.mint() }))).toBeNull();
    expect(await hasProof(await join({ pro: await kit.mint({ iat: nowS() - 5 * DAY_S, exp: nowS() - DAY_S }) }))).toBeNull();
    const exp = nowS() + 2 * DAY_S;
    expect(await hasProof(await join({ pro: await kit.mint({ exp }) }))).toBe(exp);
  });

  it('a hook cannot vouch for Pro: whatever verifyPlayer puts in `pro` is replaced by what the token proves', async () => {
    setLiveHooks({ verifyPlayer: async () => ({ pid: alice.pid, name: 'Alice', age: 'adult' as const, pro: { ok: true as const, until: Date.now() + 365 * 86_400_000 } }) });
    expect(await said(await createPro())).toEqual(refused('none'));
    expect(await said(await createPro('junk'))).toEqual(refused('invalid'));
    const exp = nowS() + DAY_S;
    const ok = await createPro(await kit.mint({ exp }));
    expect(ok?.status).toBe(201);
    expect(await hasProof((await ok?.json()) as JoinGrant)).toBe(exp);
  });

  it('createRoomFor (the matchmaker) needs the verdict of the creator for a Pro game, and takes the one verifyProProof gives', async () => {
    const player = { pid: 'maker-device-0001', name: 'Maker', age: 'adult' as const };
    const spec = { kind: 'public' as const, gameId: 'pad-work', size: 3, durationMs: 60_000, band: 'easy' };
    await expect(createRoomFor(proEnv(), spec, player)).rejects.toMatchObject({ status: 403, code: 'pro_required', extra: { reason: 'none' } });
    await expect(createRoomFor(proEnv(), spec, { ...player, pro: { ok: false, reason: 'expired' } })).rejects.toMatchObject({ status: 403, extra: { reason: 'expired' } });
    expect(rooms.engines.size).toBe(0);
    const pro = await verifyProProof(proEnv(), await kit.mint());
    const made = await createRoomFor(proEnv(), spec, { ...player, pro });
    expect(made.preview).toMatchObject({ gameId: 'pad-work', kind: 'public', size: 3 });
    await expect(createRoomFor(proEnv(), { ...spec, gameId: 'squat-flap' }, player)).resolves.toMatchObject({ preview: { gameId: 'squat-flap' } });
  });

  it('the ticket of a verified host lets the Room take a Pro game and start it, and the ticket of a free host does not', async () => {
    const hello = (pid: string): string => JSON.stringify({ t: 'hello', v: NET_PROTOCOL, tab: 't-' + pid, sess: 's-' + pid, video: false, reasons: [], blocks: [] });
    const play = async (token: string | undefined): Promise<{ engine: RoomEngine; errors: string[] }> => {
      const g = (await (await post('/api/rooms', { gameId: 'squat-flap', ...alice, ...(token ? { pro: token } : {}) }, {}, proEnv()))?.json()) as JoinGrant;
      const host = rooms.hosts.get(g.code) as FakeHost;
      const engine = await (rooms.engines.get(g.code) as Promise<RoomEngine>);
      const errors: string[] = [];
      const open = async (ticket: string, pid: string) => {
        const c = host.newConn();
        engine.accept(c, await decodeTicketForTest(SECRET, ticket, g.code));
        engine.message(c, hello(pid));
        return c;
      };
      const a = await open(g.ticket, alice.pid);
      const j = (await (await post(`/api/rooms/${g.code}/join`, bob, {}, proEnv()))?.json()) as JoinGrant;
      const b = await open(j.ticket, bob.pid);
      engine.message(a, JSON.stringify({ t: 'config', gameId: 'limbo-bend' }));
      for (const c of [a, b]) for (const m of c.inbox) if (m.t === 'error') errors.push(m.code);
      engine.message(a, JSON.stringify({ t: 'ready', ready: true }));
      engine.message(b, JSON.stringify({ t: 'ready', ready: true }));
      return { engine, errors };
    };
    const pro = await play(await kit.mint());
    expect(pro.errors).toEqual([]);
    expect(pro.engine.inspect().meta?.config.gameId).toBe('limbo-bend');
    expect(pro.engine.inspect().match?.gameId).toBe('limbo-bend');        // the friend with no token plays the game the Pro host picked
    const free = await play(undefined);
    expect(free.errors).toEqual(['pro_required']);
    expect(free.engine.inspect().meta?.config.gameId).toBe('squat-flap');
    expect(free.engine.inspect().match?.gameId).toBe('squat-flap');       // everybody was ready: the free game the room had goes on, the Pro one never starts
  });
});
