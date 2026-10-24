// The HTTP layer of live play against an in-process "Durable Object namespace" that runs real RoomEngines.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JoinGrant, RoomPreview, RoomSummary } from '../../../core/types/net.ts';
import type { DurableObjectNamespaceLike, Fetcher } from '../cf.ts';
import { Router } from '../router.ts';
import { clearLiveHooks, setLiveHooks } from './hooks.ts';
import { resetLimits } from './limits.ts';
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
