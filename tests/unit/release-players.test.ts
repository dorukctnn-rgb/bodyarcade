// The signed players of the release checks (tests/release/players.ts), against a stand-in server that verifies every signature with the
// Worker's own function (core/social/sign.ts verifyRequest). tests/unit/release-players.worker.test.ts runs the same helper against the
// production Worker in Miniflare.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_HEADER, importPublicKey, parseAuth, verifyRequest } from '../../packages/core/social/sign.ts';
import { createRoom } from '../../packages/core/net/api.ts';
import { chooseMode, identitiesDir, openPlayers, signedFetcher, signRoomCalls, SignedPlayer, type RacePlayer } from '../release/players.ts';

const BASE = 'https://deployed.test';
const MIN = 60_000;

interface Call { url: string; method: string; auth: string | null; body: unknown }

/** A server that knows profiles by key id, checks every signature the way the Worker does, and can run a clock of its own. */
function fakeServer(o: { skewMs?: number; registerStatus?: number; deleteStatus?: number } = {}) {
  const calls: Call[] = [];
  const profiles = new Map<string, { pub: string; deleted: boolean }>();
  const clock = (): number => Date.now() + (o.skewMs ?? 0);
  const answer = (status: number, data: unknown): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', Date: new Date(clock()).toUTCString() } });
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers).get(AUTH_HEADER);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, auth, body });
    const parts = parseAuth(auth);
    if (!parts) return answer(401, { error: 'unauthorized', serverTime: clock() });
    const path = new URL(url).pathname;
    const rec = body as Record<string, unknown>;
    let pub: string | undefined;
    if (path === '/api/social/register') pub = typeof rec.pub === 'string' ? rec.pub : undefined;
    else { const p = profiles.get(parts.kid); pub = p && !p.deleted ? p.pub : undefined; if (!pub) return answer(401, { error: 'unknown_device', serverTime: clock() }); }
    const key = pub ? await importPublicKey(pub) : null;
    if (!key) return answer(400, { error: 'bad_request' });
    const verdict = await verifyRequest(parts, key, { method, url, body }, clock());
    if (verdict === 'clock_skew') return answer(401, { error: 'clock_skew', serverTime: clock() });
    if (verdict !== 'ok') return answer(401, { error: 'unauthorized', serverTime: clock() });
    if (path === '/api/social/register') {
      if (o.registerStatus) return answer(o.registerStatus, { error: o.registerStatus === 429 ? 'rate_limited' : 'closed' });
      const known = profiles.has(parts.kid);
      profiles.set(parts.kid, { pub: pub as string, deleted: false });
      return answer(known ? 200 : 201, { created: !known, me: { name: rec.name } });
    }
    if (path === '/api/social/me/delete') {
      if (o.deleteStatus) return answer(o.deleteStatus, { error: 'internal' });
      (profiles.get(parts.kid) as { deleted: boolean }).deleted = true;
      return answer(200, {});
    }
    if (path === '/api/rooms') return answer(201, { code: 'ABC234' });
    return answer(404, { error: 'not_found' });
  };
  return { fetchFn, calls, profiles, clock };
}

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ba-players-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('chooseMode', () => {
  const answering = (status: number): typeof fetch => vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;

  it('is signed when the deployed Worker has the social module (it refuses an unsigned call with 401)', async () => {
    const v = await chooseMode(BASE, { fetch: answering(401) });
    expect(v.mode).toBe('signed');
  });

  it('is guest on a build from before the social module, and the reason names what it answered', async () => {
    for (const status of [404, 500, 503]) {
      const v = await chooseMode(BASE, { fetch: answering(status) });
      expect(v.mode).toBe('guest');
      expect(v.why).toContain(String(status));
    }
  });

  it('is always signed on bodyarcade.com, without asking: a missing social module there must fail the run, not be played around', async () => {
    const f = answering(404);
    expect((await chooseMode('https://bodyarcade.com', { production: true, fetch: f })).mode).toBe('signed');
    expect(f).not.toHaveBeenCalled();
  });

  it('obeys BA_RELEASE_SIGNING', async () => {
    const f = answering(401);
    expect((await chooseMode(BASE, { want: 'guest', fetch: f })).mode).toBe('guest');
    expect((await chooseMode(BASE, { want: 'signed', fetch: answering(404) })).mode).toBe('signed');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('guests', () => {
  it('have an id of their own, say their name and sign nothing', async () => {
    const [a, b] = await openPlayers(BASE, ['Release Ana', 'Release Ben'], { mode: 'guest' }) as [RacePlayer, RacePlayer];
    expect(a.pid).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(a.pid).not.toBe(b.pid);
    expect(a.identity()).toEqual({ pid: a.pid, name: 'Release Ana', age: 'adult' });
    expect(await a.authFor('POST', `${BASE}/api/rooms`, {})).toBeNull();
  });
});

describe('signed players', () => {
  it('sign up with a key whose signature the server accepts, and keep the key for the next run', async () => {
    const server = fakeServer();
    const first = await openPlayers(BASE, ['Release Ana', 'Release Ben'], { mode: 'signed', dir, fetch: server.fetchFn });
    expect(server.calls.map((c) => c.url)).toEqual([`${BASE}/api/social/register`, `${BASE}/api/social/register`]);
    expect(server.profiles.size).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['release-ana.json', 'release-ben.json']);

    // the next run: the same keys, the same profiles (a server that knows the key answers 200 created:false and makes nothing new)
    const second = await openPlayers(BASE, ['Release Ana', 'Release Ben'], { mode: 'signed', dir, fetch: server.fetchFn });
    expect(second.map((p) => p.pid)).toEqual(first.map((p) => p.pid));
    expect(server.profiles.size).toBe(2);
    const header = await (second[0] as RacePlayer).authFor('POST', `${BASE}/api/rooms`, { gameId: 'squat-flap' });
    const pub = (JSON.parse(readFileSync(join(dir, 'release-ana.json'), 'utf8')) as { pub: string }).pub;
    expect(await verifyRequest(parseAuth(header) as NonNullable<ReturnType<typeof parseAuth>>, (await importPublicKey(pub)) as CryptoKey, { method: 'POST', url: `${BASE}/api/rooms`, body: { gameId: 'squat-flap' } }, Date.now())).toBe('ok');
  });

  it('keep no key on disk when there is no folder (a local stack dies with its profiles)', async () => {
    const server = fakeServer();
    await openPlayers(BASE, ['Release Ana'], { mode: 'signed', dir: null, fetch: server.fetchFn });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('do not reuse a key that was made for another deployment', async () => {
    const server = fakeServer();
    const [preview] = await openPlayers('https://preview.test', ['Release Ana'], { mode: 'signed', dir, fetch: server.fetchFn });
    const [prod] = await openPlayers(BASE, ['Release Ana'], { mode: 'signed', dir, fetch: server.fetchFn });
    expect((preview as RacePlayer).pid).not.toBe((prod as RacePlayer).pid);
  });

  it('sign the method, the address, the body and the time: a changed request does not verify', async () => {
    const server = fakeServer();
    const [p] = await openPlayers(BASE, ['Release Ana'], { mode: 'signed', fetch: server.fetchFn }) as [SignedPlayer];
    const body = { kind: 'private', gameId: 'squat-flap', size: 2, durationMs: 25_000, ...p.identity() };
    const key = (await importPublicKey(p.pub)) as CryptoKey;
    const header = (await p.authFor('POST', `${BASE}/api/rooms`, body)) as string;
    const parts = parseAuth(header) as NonNullable<ReturnType<typeof parseAuth>>;
    expect(parts.kid).toBe(p.pid);
    const check = (req: { method: string; url: string; body?: unknown }, now = Date.now()) => verifyRequest(parts, key, req, now);
    expect(await check({ method: 'POST', url: `${BASE}/api/rooms`, body })).toBe('ok');
    // key order and the host do not matter (the server canonicalises the parsed body and reads path and query only)
    expect(await check({ method: 'POST', url: 'https://other.test/api/rooms', body: { ...body, size: 2 } })).toBe('ok');
    expect(await check({ method: 'POST', url: `${BASE}/api/rooms`, body: { ...body, size: 4 } })).toBe('bad_signature');
    expect(await check({ method: 'POST', url: `${BASE}/api/rooms/ABC234/join`, body })).toBe('bad_signature');
    expect(await check({ method: 'GET', url: `${BASE}/api/rooms`, body })).toBe('bad_signature');
    expect(await check({ method: 'POST', url: `${BASE}/api/rooms`, body }, Date.now() + 6 * MIN)).toBe('clock_skew');
  });

  it('put the key id where the page sends its device id, and a name the profile has', async () => {
    const server = fakeServer();
    const [p] = await openPlayers(BASE, ['Release Cem'], { mode: 'signed', fetch: server.fetchFn }) as [SignedPlayer];
    expect(p.identity()).toEqual({ pid: p.kid, name: 'Release Cem', age: 'adult' });
    expect(p.pid).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('correct a device clock that is ten minutes off, once, from the server time the refusal carries; the next player needs no second try', async () => {
    const server = fakeServer({ skewMs: -10 * MIN });
    await openPlayers(BASE, ['Release Ana', 'Release Ben'], { mode: 'signed', fetch: server.fetchFn });
    // Ana: refused for the clock, then accepted; Ben signs with the corrected clock
    expect(server.calls.length).toBe(3);
    expect(server.profiles.size).toBe(2);
  });

  it('say why a sign-up was refused, and that the limit is the address\'s', async () => {
    const server = fakeServer({ registerStatus: 429 });
    await expect(openPlayers(BASE, ['Release Ana'], { mode: 'signed', fetch: server.fetchFn })).rejects.toThrow(/429 rate_limited.*20 profiles an hour/);
  });

  it('retire the profile and the saved key; a profile the server already forgot counts as deleted; a failed delete keeps the key', async () => {
    const server = fakeServer();
    const [a, b] = await openPlayers(BASE, ['Release Ana', 'Release Ben'], { mode: 'signed', dir, fetch: server.fetchFn }) as [RacePlayer, RacePlayer];
    await a.retire();
    expect(existsSync(join(dir, 'release-ana.json'))).toBe(false);
    expect([...server.profiles.values()].filter((p) => p.deleted).length).toBe(1);
    await a.retire();                                                 // unknown_device: nothing left to delete, no error
    const failing = fakeServer({ deleteStatus: 500 });
    const [c] = await openPlayers(BASE, ['Release Cem'], { mode: 'signed', dir, fetch: failing.fetchFn }) as [RacePlayer];
    await expect(c.retire()).rejects.toThrow(/answered 500/);
    expect(existsSync(join(dir, 'release-cem.json'))).toBe(true);
    expect(existsSync(join(dir, 'release-ben.json'))).toBe(true);
    void b;
  });
});

describe('signedFetcher (the live smoke test of a deployed Worker, tests/live/support/smoke-remote.ts)', () => {
  it('signs what core/net sends as the player: createRoom with it is accepted by a server that checks every signature', async () => {
    const server = fakeServer();
    const [p] = await openPlayers(BASE, ['Smoke A'], { mode: 'signed', fetch: server.fetchFn }) as [SignedPlayer];
    const grant = await createRoom(BASE, p.identity(), { gameId: 'squat-flap', durationMs: 15_000 }, signedFetcher(p, server.fetchFn));
    expect(grant).toMatchObject({ code: 'ABC234' });
    const call = server.calls.at(-1) as Call;
    expect(call.url).toBe(`${BASE}/api/rooms`);
    expect(parseAuth(call.auth)?.kid).toBe(p.pid);
    expect(call.body).toMatchObject({ gameId: 'squat-flap', durationMs: 15_000, pid: p.pid, name: 'Smoke A', age: 'adult' });
  });

  it('the plain fetch of a guest is refused by the same server (what the old unsigned smoke test got from the preview: 401)', async () => {
    const server = fakeServer();
    const [g] = await openPlayers(BASE, ['Smoke A'], { mode: 'guest' }) as [RacePlayer];
    await expect(createRoom(BASE, g.identity(), { gameId: 'squat-flap' }, signedFetcher(g, server.fetchFn))).rejects.toMatchObject({ status: 401 });
    expect(server.calls.at(-1)?.auth).toBeNull();
  });

  it('keeps the headers the caller set and signs the body it sends', async () => {
    const server = fakeServer();
    const [p] = await openPlayers(BASE, ['Smoke A'], { mode: 'signed', fetch: server.fetchFn }) as [SignedPlayer];
    const seen: Headers[] = [];
    const spy: typeof fetch = async (input, init) => { seen.push(new Headers(init?.headers)); return server.fetchFn(input, init); };
    const res = await signedFetcher(p, spy)(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: 'knee-sprint', ...p.identity() }) });
    expect(res.status).toBe(201);
    expect(seen[0]?.get('content-type')).toBe('application/json');
    expect(seen[0]?.get(AUTH_HEADER)).toMatch(/\S/);
  });
});

describe('identitiesDir', () => {
  it('keeps the keys of a deployed origin under its host, and none for a local stack', () => {
    expect(identitiesDir('https://bodyarcade-v2-preview.railer-iot.workers.dev', join('x', 'out'))).toBe(join('x', 'out', 'identities', 'bodyarcade-v2-preview.railer-iot.workers.dev'));
    expect(identitiesDir('https://bodyarcade.com', 'out')).toBe(join('out', 'identities', 'bodyarcade.com'));
    expect(identitiesDir('http://127.0.0.1:8787', 'out')).toBeNull();
    expect(identitiesDir('http://localhost:5173', 'out')).toBeNull();
  });
});

describe('signRoomCalls', () => {
  interface Handler { matcher: (url: URL) => boolean; handler: (route: unknown) => Promise<unknown> }
  const contextFake = (): { ctx: Pick<BrowserContext, 'route'>; got: Handler[] } => {
    const got: Handler[] = [];
    return { got, ctx: { route: async (matcher: unknown, handler: unknown) => { got.push({ matcher: matcher as Handler['matcher'], handler: handler as Handler['handler'] }); } } as unknown as Pick<BrowserContext, 'route'> };
  };
  const routeFor = (method: string, url: string, body?: unknown, rawPost?: string) => {
    const sent: { headers?: Record<string, string> }[] = [];
    const route = {
      request: () => ({ method: () => method, url: () => url, postData: () => rawPost ?? (body === undefined ? null : JSON.stringify(body)), headers: () => ({ 'content-type': 'application/json', accept: '*/*' }) }),
      fallback: vi.fn(async () => undefined),
      continue: vi.fn(async (o: { headers?: Record<string, string> }) => { sent.push(o); }),
    };
    return { route, sent };
  };

  it('takes the room calls of the deployed origin and nothing else', async () => {
    const server = fakeServer();
    const [p] = await openPlayers(BASE, ['Release Ana'], { mode: 'signed', fetch: server.fetchFn }) as [RacePlayer];
    const { ctx, got } = contextFake();
    await signRoomCalls(ctx, BASE, p);
    expect(got.length).toBe(1);
    const takes = (u: string): boolean => (got[0] as Handler).matcher(new URL(u));
    expect(takes(`${BASE}/api/rooms`)).toBe(true);
    expect(takes(`${BASE}/api/rooms/ABC234/join`)).toBe(true);
    expect(takes(`${BASE}/api/rooms/ABC234`)).toBe(false);          // the invite page's lookup
    expect(takes(`${BASE}/api/rooms/ABC234/ws`)).toBe(false);       // the socket carries its ticket
    expect(takes(`${BASE}/api/social/me`)).toBe(false);
    expect(takes(`${BASE}/api/ice`)).toBe(false);
    expect(takes(`https://elsewhere.test/api/rooms`)).toBe(false);
  });

  it('adds the header the server checks to a create and a join, and leaves the rest of the request as the page made it', async () => {
    const server = fakeServer();
    const [p] = await openPlayers(BASE, ['Release Ana'], { mode: 'signed', fetch: server.fetchFn }) as [SignedPlayer];
    const { ctx, got } = contextFake();
    await signRoomCalls(ctx, BASE, p);
    const handler = (got[0] as Handler).handler;
    const join = { pid: p.pid, name: 'Release Ana', age: 'adult' };
    const { route, sent } = routeFor('POST', `${BASE}/api/rooms/ABC234/join`, join);
    await handler(route);
    expect(route.fallback).not.toHaveBeenCalled();
    const headers = (sent[0] as { headers: Record<string, string> }).headers;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['accept']).toBe('*/*');
    const auth = headers[AUTH_HEADER.toLowerCase()] as string;
    expect(await verifyRequest(parseAuth(auth) as NonNullable<ReturnType<typeof parseAuth>>, (await importPublicKey(p.pub)) as CryptoKey, { method: 'POST', url: `${BASE}/api/rooms/ABC234/join`, body: join }, Date.now())).toBe('ok');
  });

  it('passes a request it cannot sign (not a POST, a body that is not JSON) on untouched, and a guest registers nothing', async () => {
    const server = fakeServer();
    const [p] = await openPlayers(BASE, ['Release Ana'], { mode: 'signed', fetch: server.fetchFn }) as [RacePlayer];
    const { ctx, got } = contextFake();
    await signRoomCalls(ctx, BASE, p);
    const handler = (got[0] as Handler).handler;
    const get = routeFor('GET', `${BASE}/api/rooms`);
    await handler(get.route);
    expect(get.route.fallback).toHaveBeenCalledTimes(1);
    expect(get.route.continue).not.toHaveBeenCalled();
    const bad = routeFor('POST', `${BASE}/api/rooms`, undefined, 'not json');
    await handler(bad.route);
    expect(bad.route.fallback).toHaveBeenCalledTimes(1);

    const [g] = await openPlayers(BASE, ['Release Ben'], { mode: 'guest' }) as [RacePlayer];
    const guest = contextFake();
    await signRoomCalls(guest.ctx, BASE, g);
    expect(guest.got.length).toBe(0);
  });
});
