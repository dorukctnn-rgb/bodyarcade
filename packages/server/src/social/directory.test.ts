// The directory object and the Worker in front of it, on fake Durable Object state whose SQL is node:sqlite: the tables it makes
// and keeps, the routes the Worker forwards (and what it adds on the way), the operations live play calls, and the sockets it holds
// for the players. The upgrade of a real WebSocket and the hibernation of real sockets are the Miniflare tests' business.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDeviceKey, signRequest, type DeviceKeys } from '../../../core/social/sign.ts';
import { HUB_CLOSE, type FriendEntry, type MyProfile } from '../../../core/social/types.ts';
import type { RoomSummary } from '../../../core/types/net.ts';
import type { LiveEnv } from '../live/env.ts';
import { SocialDirectory, METER_LOG_EVERY_MS } from './directory.ts';
import { INTERNAL_HOST } from './env.ts';
import { socialHooks } from './hooks.ts';
import { EDGE_PER_MINUTE } from './routes.ts';
import { SCHEMA_VERSION, VERSIONS, migrate } from './schema.ts';
import { createDirectoryHarness, FakeSocket, FakeState, TEST_ADMIN_TOKEN, TEST_ORIGIN, fakeDoStorage, type DirectoryHarness } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** The object with a way to its socket registry, as a test needs it. */
class Probe extends SocialDirectory {
  get registry() { return this.hub; }
  get sql() { return this.meter; }
}

let h: DirectoryHarness & { calls: Request[] };
let probe: Probe;

const SETTINGS = { TICKET_SECRET: 'test-secret-0123456789abcdef0123456789', PUBLIC_ORIGIN: TEST_ORIGIN, ADMIN_TOKEN: TEST_ADMIN_TOKEN };

function build(env: Record<string, unknown> = {}) {
  h = createDirectoryHarness({ env });
  probe = new Probe(h.state, { ...SETTINGS, ...env });
}

/**
 * A second object on the same state and storage, which the Worker's binding now talks to: what a request pushes to a socket is
 * pushed through the registry of this object, so a test can put sockets in it and look at what they were sent.
 */
function useProbe(): void {
  probe = new Probe(h.state, { ...SETTINGS });
  (h.env.SOCIAL as { get: unknown }).get = () => ({ fetch: async (input: Request | string) => probe.fetch(input instanceof Request ? input : new Request(input)) });
}

beforeEach(() => build());

interface Dev { keys: DeviceKeys }

/** A signature header of nobody the directory knows: well formed, which is all the Worker looks at. */
async function wellFormedAuth(): Promise<string> {
  return signRequest(await generateDeviceKey(), { method: 'GET', url: `${TEST_ORIGIN}/api/social/me` }, Date.now());
}

/** A signed request through the Worker's router and the directory. */
async function api(dev: Dev, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: Record<string, any>; res: Response }> {
  const hasBody = body !== undefined && method !== 'GET';
  const auth = await signRequest(dev.keys, { method, url: `${TEST_ORIGIN}${path}`, ...(hasBody ? { body } : {}) }, Date.now());
  const res = await h.call(method, path, { headers: { 'X-BA-Auth': auth, ...extra }, ...(hasBody ? { body } : {}) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, any>) : {}, res };
}

interface Player { dev: Dev; me: MyProfile; recovery: string; pid: string }

async function signUp(band: 'adult' | 'teen' | 'child' = 'adult', extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Player> {
  const dev = { keys: await generateDeviceKey() };
  const r = await api(dev, 'POST', '/api/social/register', { pub: dev.keys.publicRaw, band, ...extra }, headers);
  if (r.status !== 201) throw new Error(`register: ${r.status} ${JSON.stringify(r.body)}`);
  const me = r.body.me as MyProfile;
  const pid = (h.storage.raw.prepare('SELECT pid FROM soc_profiles WHERE fid = ?').get(me.fid) as { pid: string }).pid;
  return { dev, me, recovery: r.body.recovery as string, pid };
}

const friends = async (a: Player, b: Player): Promise<void> => {
  await api(a.dev, 'POST', '/api/social/friends/request', { code: b.me.code });
  await api(b.dev, 'POST', '/api/social/friends/respond', { fid: a.me.fid, accept: true });
};

// ───────── starting up ─────────

describe('starting up', () => {
  it('makes its tables, once, before it answers anything', () => {
    const storage = fakeDoStorage();
    const state = new FakeState(storage);
    expect((storage.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n).toBe(0);
    new SocialDirectory(state, SETTINGS);
    const names = (storage.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(['soc_audit', 'soc_blocks', 'soc_declines', 'soc_devices', 'soc_friends', 'soc_lobbies', 'soc_limits', 'soc_meta', 'soc_presence', 'soc_profiles', 'soc_reports', 'soc_requests', 'soc_scores', 'soc_sync'].sort());
    expect(state.blocked).toHaveLength(1);
    expect((storage.raw.prepare("SELECT v FROM soc_meta WHERE k = 'schema'").get() as { v: string }).v).toBe(String(SCHEMA_VERSION));
  });

  it('starts again on the same storage without making anything twice or losing anything', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const before = h.storage.executed.filter((q) => /^\s*CREATE/i.test(q)).length;
    const again = new Probe(new FakeState(h.storage), { TICKET_SECRET: 'test-secret-0123456789abcdef0123456789' });
    await Promise.resolve();
    expect(h.storage.executed.filter((q) => /^\s*CREATE/i.test(q)).length).toBe(before + 1);   // the meta table's IF NOT EXISTS, nothing else
    const me = await again.fetch(new Request(`${TEST_ORIGIN}/api/social/me`, { headers: { 'X-BA-Auth': await signRequest(a.dev.keys, { method: 'GET', url: `${TEST_ORIGIN}/api/social/me` }, Date.now()) } }));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { me: MyProfile }).me.name).toBe('Ada');
  });

  it('refuses storage that a newer version made, and says which versions', () => {
    const storage = fakeDoStorage();
    migrate(storage);
    storage.raw.prepare("UPDATE soc_meta SET v = ? WHERE k = 'schema'").run(String(SCHEMA_VERSION + 1));
    expect(() => migrate(storage)).toThrow(new RegExp(`newer version \\(${SCHEMA_VERSION + 1}, this code knows ${SCHEMA_VERSION}\\)`));
  });

  it('applies the versions it has not seen, in order, each in one transaction (and a failing one leaves the tables as they were)', () => {
    const storage = fakeDoStorage();
    expect(migrate(storage)).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(migrate(storage)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    // the versions are numbered 1, 2, 3 ... with no gap
    expect(VERSIONS.map((v) => v.version)).toEqual(VERSIONS.map((_, i) => i + 1));
    // a version that fails half way is rolled back as a whole
    const broken = fakeDoStorage();
    broken.sql.exec('CREATE TABLE soc_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT, WITHOUT ROWID');
    broken.sql.exec('CREATE TABLE soc_devices (kid TEXT)');   // the second table of version 1 now clashes
    expect(() => migrate(broken)).toThrow();
    const tables = (broken.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(tables).toEqual(['soc_devices', 'soc_meta']);
    expect(broken.raw.prepare('SELECT COUNT(*) AS n FROM soc_meta').get()).toEqual({ n: 0 });
  });
});

// ───────── the Worker in front of it ─────────

describe('the Worker in front of the directory', () => {
  it('forwards every social route to the one directory object, and answers the others itself', async () => {
    const a = await signUp();
    expect((await api(a.dev, 'GET', '/api/social/me')).body.me.fid).toBe(a.me.fid);
    expect(h.calls.length).toBeGreaterThanOrEqual(2);
    // a path that is not a route is not the directory's business: JSON 404 for the API, nothing for any other path (the assets)
    const before = h.calls.length;
    expect((await h.call('GET', '/api/social/nothing')).status).toBe(404);
    expect(h.calls.length).toBe(before);
    // a wrong method is answered by the Worker's router
    const wrong = await h.call('DELETE', '/api/social/me');
    expect(wrong.status).toBe(405);
    expect(h.calls.length).toBe(before);
  });

  it('every route of the table is on the Worker and in the directory, the same ones', () => {
    const w = h.worker.list().filter((r) => !r.endsWith('/f/:code'));
    // the directory's own router is the same table with the handlers in it
    const d = (probe as unknown as { router: { list(): string[] } }).router.list();
    expect(d.sort()).toEqual(w.sort());
    expect(w).toContain('GET /api/social/hub');
    expect(w).toContain('PUT /api/social/sync/:key');
    expect(w).toContain('GET /api/admin/social/stats');
  });

  it('passes on the caller\'s address, country and continent, replacing whatever the caller sent under those names', async () => {
    const dev = { keys: await generateDeviceKey() };
    await api(dev, 'POST', '/api/social/register', { pub: dev.keys.publicRaw, band: 'adult' }, { 'X-BA-IP': '6.6.6.6', 'X-BA-Continent': 'AF' });
    const seen = h.calls.at(-1) as Request;
    expect(seen.headers.get('X-BA-IP')).toBe('10.1.2.3');
    expect(seen.headers.get('X-BA-Continent')).toBeNull();
    // with Cloudflare's own view of the caller
    const res = await h.call('POST', '/api/social/register', { body: { pub: 'x', band: 'adult' }, cf: { country: 'tr', continent: 'as' }, headers: { 'X-BA-Continent': 'AF', 'X-BA-Auth': await wellFormedAuth() } });
    expect(res.status).toBeGreaterThanOrEqual(400);   // the key is not a key: only the headers matter here
    const cf = h.calls.at(-1) as Request;
    expect(cf.headers.get('CF-IPCountry')).toBe('TR');
    expect(cf.headers.get('X-BA-Continent')).toBe('AS');
    expect(cf.headers.get('X-BA-IP')).toBe('10.1.2.3');
  });

  it('a new profile starts in the region of the continent the Worker saw', async () => {
    const dev = { keys: await generateDeviceKey() };
    const auth = await signRequest(dev.keys, { method: 'POST', url: `${TEST_ORIGIN}/api/social/register`, body: { pub: dev.keys.publicRaw, band: 'adult' } }, Date.now());
    const res = await h.call('POST', '/api/social/register', { body: { pub: dev.keys.publicRaw, band: 'adult' }, headers: { 'X-BA-Auth': auth }, cf: { country: 'TR', continent: 'AS' } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { me: MyProfile }).me.region).toBe('as');
  });

  it('lets 600 calls a minute from one address through and stops the 601st at the Worker, before the directory', async () => {
    const before = h.calls.length;
    const auth = await wellFormedAuth();   // a signature of nobody: the directory says unknown_device, but it is asked
    let last = 0;
    for (let i = 0; i < EDGE_PER_MINUTE + 1; i++) last = (await h.call('GET', '/api/social/me', { headers: { 'X-BA-Auth': auth } })).status;
    expect(last).toBe(429);
    expect(h.calls.length - before).toBe(EDGE_PER_MINUTE);
    // another address is not affected
    expect((await h.call('GET', '/api/social/me', { headers: { 'CF-Connecting-IP': '10.9.9.9', 'X-BA-Auth': auth } })).status).toBe(401);
    expect(h.calls.length - before).toBe(EDGE_PER_MINUTE + 1);
  });

  it('refuses at the Worker what cannot succeed, so that it costs no call to the directory: no signature, a body that is not JSON or is too big, a moderation call without a token', async () => {
    const before = h.calls.length;
    const auth = await wellFormedAuth();
    const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
    // no signature, or one that cannot be a signature
    expect(await read(await h.call('GET', '/api/social/me'))).toMatchObject({ status: 401, body: { error: 'unauthorized', serverTime: expect.any(Number) } });
    expect((await h.call('GET', '/api/social/me', { headers: { 'X-BA-Auth': 'v1.nonsense' } })).status).toBe(401);
    expect((await h.call('GET', '/api/social/friends', { headers: { 'X-BA-Auth': auth.replace(/^v1/, 'v9') } })).status).toBe(401);
    // a write that is not JSON, or is more than the routes read
    expect(await read(await h.call('POST', '/api/social/me', { headers: { 'X-BA-Auth': auth } }))).toMatchObject({ status: 415, body: { error: 'json_expected' } });
    expect(await read(await h.call('POST', '/api/social/me', { headers: { 'X-BA-Auth': auth, 'Content-Type': 'text/plain' }, body: {} }))).toMatchObject({ status: 415 });
    expect(await read(await h.call('POST', '/api/social/me', { headers: { 'X-BA-Auth': auth, 'Content-Length': '5000' }, body: { name: 'x' } }))).toMatchObject({ status: 413, body: { error: 'too_large' } });
    // the moderation routes: not there without a token configured, and not for a call that carries none
    expect((await h.call('GET', '/api/admin/social/stats')).status).toBe(401);
    expect((await h.call('GET', '/api/admin/social/stats', { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
    expect(h.calls.length).toBe(before);
    const none = createDirectoryHarness({ env: { ADMIN_TOKEN: undefined } });
    expect((await none.call('GET', '/api/admin/social/stats', { headers: { Authorization: 'Bearer something-long-enough' } })).status).toBe(404);
    expect(none.calls).toHaveLength(0);
    // what is well formed does go through, the directory judges it
    expect((await h.call('GET', '/api/social/me', { headers: { 'X-BA-Auth': auth } })).status).toBe(401);
    expect((await h.call('GET', '/api/admin/social/stats', { headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` } })).status).toBe(200);
    expect(h.calls.length).toBe(before + 2);
  });

  it('answers 503 unavailable when the directory is not bound (live play alone)', async () => {
    const r = await h.worker.handle(new Request(`${TEST_ORIGIN}/api/social/me`, { headers: { 'CF-Connecting-IP': '10.5.5.5' } }), { TICKET_SECRET: 'x'.repeat(40) }, { waitUntil: () => undefined });
    expect(r?.status).toBe(503);
    expect(await r?.json()).toEqual({ error: 'unavailable' });
  });
});

// ───────── a request through both ─────────

describe('a request through the Worker and the directory', () => {
  it('registers a profile, reads it back signed, and refuses what is not signed', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    expect(a.me.name).toBe('Ada');
    expect(a.recovery).toMatch(/^([2-9A-HJ-NP-Z]{4}-){3}[2-9A-HJ-NP-Z]{4}$/);
    const me = await api(a.dev, 'GET', '/api/social/me');
    expect(me.status).toBe(200);
    expect(me.body.serverTime).toBeGreaterThan(0);
    expect((await h.call('GET', '/api/social/me')).status).toBe(401);
    const other = { keys: await generateDeviceKey() };
    expect((await api(other, 'GET', '/api/social/me')).body.error).toBe('unknown_device');
  });

  it('keeps the whole social state in the one storage: profiles, friends and their presence', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const b = await signUp('adult', { name: 'Bo' });
    await friends(a, b);
    const list = (await api(a.dev, 'GET', '/api/social/friends')).body.friends as FriendEntry[];
    expect(list.map((f) => f.name)).toEqual(['Bo']);
    expect(h.storage.raw.prepare('SELECT COUNT(*) AS n FROM soc_friends').get()).toEqual({ n: 2 });
    expect(h.calls.every((c) => c.url.startsWith(TEST_ORIGIN))).toBe(true);
  });
});

// ───────── the operations of live play ─────────

const summary = (code: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
  kind: 'public', gameId: 'jacks', band: 'easy', audience: 'adult', size: 2, players: 1, open: 1, names: ['Ada'], phase: 'lobby', updatedAt: Date.now(), code, ...over,
});

const env = (): LiveEnv => h.env as unknown as LiveEnv;
const op = (name: string, input: unknown, method = 'POST') => probe.fetch(new Request(`https://${INTERNAL_HOST}/op/${name}`, method === 'POST' ? { method, body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } } : { method }));

describe('the operations live play asks for', () => {
  it('a room the Room reports is in the lobby list, a seat in it is gated, and the room going away empties the list', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const b = await signUp('adult', { name: 'Bo' });
    await socialHooks.publishRoom?.(env(), summary('ABCDEF'), [a.pid]);
    await socialHooks.setPlaying?.(env(), { code: 'ABCDEF', pid: a.pid, inRoom: true, playing: false, gameId: 'jacks' });
    const list = await api(b.dev, 'GET', '/api/social/lobbies?game=jacks');
    expect(list.body.lobbies.map((l: { code: string }) => l.code)).toEqual(['ABCDEF']);
    expect(await socialHooks.gateJoin?.(env(), summary('ABCDEF'), { pid: b.pid, name: 'Bo', age: 'adult' })).toBe(true);
    // a teen is of another group: the same room is not for them
    const t = await signUp('teen');
    expect(await socialHooks.gateJoin?.(env(), summary('ABCDEF'), { pid: t.pid, name: t.me.name, age: 'teen' })).toBe(false);
    await socialHooks.removeRoom?.(env(), 'ABCDEF');
    expect((await api(b.dev, 'GET', '/api/social/lobbies?game=jacks')).body.lobbies).toEqual([]);
  });

  it('who is calling comes from the stored profile; a refusal carries the status, the code and the server time', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const body = { kind: 'private', gameId: 'jacks' };
    const url = `${TEST_ORIGIN}/api/rooms`;
    const signed = async (b: Record<string, unknown>, dev = a.dev): Promise<Request> => new Request(url, { method: 'POST', headers: { 'X-BA-Auth': await signRequest(dev.keys, { method: 'POST', url, body: b }, Date.now()), 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    expect(await socialHooks.verifyPlayer?.(await signed(body), env(), body)).toEqual({ pid: a.pid, name: 'Ada', age: 'adult' });
    // the body is part of what was signed
    await expect(socialHooks.verifyPlayer?.(await signed(body), env(), { ...body, gameId: 'other' })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    // no signature at all
    await expect(socialHooks.verifyPlayer?.(new Request(url, { method: 'POST' }), env(), body)).rejects.toMatchObject({ status: 401, code: 'unauthorized', extra: { serverTime: expect.any(Number) } });
    // suspended from public lobbies: no public room either, a private one is fine
    h.storage.raw.prepare('UPDATE soc_profiles SET public_blocked_until = ? WHERE pid = ?').run(Date.now() + 86_400_000, a.pid);
    const pub = { kind: 'public', gameId: 'jacks' };
    await expect(socialHooks.verifyPlayer?.(await signed(pub), env(), pub)).rejects.toMatchObject({ status: 403, code: 'public_suspended' });
    expect((await socialHooks.verifyPlayer?.(await signed(body), env(), body))?.pid).toBe(a.pid);
  });

  it('without the binding every hook does nothing and the identity is the anonymous one live play makes by itself', async () => {
    const bare = { TICKET_SECRET: 'x'.repeat(40) } as unknown as LiveEnv;
    const before = h.calls.length;
    await socialHooks.publishRoom?.(bare, summary('ABCDEF'), ['p']);
    await socialHooks.removeRoom?.(bare, 'ABCDEF');
    expect(await socialHooks.gateJoin?.(bare, summary('ABCDEF'), { pid: 'p', name: 'x', age: 'adult' })).toBe(true);
    const anon = await socialHooks.verifyPlayer?.(new Request(`${TEST_ORIGIN}/api/rooms`, { method: 'POST' }), bare, { pid: 'abcdefgh', name: 'Mia', age: 'adult' });
    expect(anon).toEqual({ pid: 'abcdefgh', name: 'Mia', age: 'adult' });
    expect(h.calls).toHaveLength(before);
  });

  it('a directory that cannot be reached is a 503 for the hook, never a crash', async () => {
    const broken = { SOCIAL: { idFromName: (n: string) => ({ name: n, toString: () => n }), get: () => ({ fetch: async () => { throw new Error('boom'); } }) } } as unknown as LiveEnv;
    await expect(socialHooks.publishRoom?.(broken, summary('ABCDEF'), ['p'])).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    const notJson = { SOCIAL: { idFromName: (n: string) => ({ name: n, toString: () => n }), get: () => ({ fetch: async () => new Response('<html>', { status: 502 }) }) } } as unknown as LiveEnv;
    await expect(socialHooks.removeRoom?.(notJson, 'ABCDEF')).rejects.toMatchObject({ status: 503 });
  });

  it('answers only the operations it has, only to a POST with JSON, and only on its internal host', async () => {
    expect((await op('nope', {})).status).toBe(404);
    expect((await op('remove', { code: 'ABCDEF' }, 'GET')).status).toBe(404);
    const badJson = await probe.fetch(new Request(`https://${INTERNAL_HOST}/op/remove`, { method: 'POST', body: '{' }));
    expect(badJson.status).toBe(400);
    expect(await (await op('remove', { code: 1 })).json()).toMatchObject({ ok: false, status: 400, code: 'bad_request' });
    expect(await (await op('remove', { code: 'ABCDEF' })).json()).toEqual({ ok: true, value: null });
    // the same path on the real host is not an operation: no route, so 404
    const outside = await probe.fetch(new Request(`${TEST_ORIGIN}/op/remove`, { method: 'POST', body: JSON.stringify({ code: 'ABCDEF' }) }));
    expect(outside.status).toBe(404);
  });

  it('a report from a room goes to the queue, once a day for the same reason, and a block from a room ends a friendship', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const b = await signUp('adult', { name: 'Bo' });
    await friends(a, b);
    await socialHooks.submitReport?.(env(), { code: 'ABCDEF', matchId: 'm1', reporterPid: a.pid, targetPid: b.pid, reporterSeat: 's1', targetSeat: 's2', reason: 'abuse', at: Date.now(), chat: [{ seat: 's2', name: 'Bo', text: 'rude', at: Date.now() }] });
    await socialHooks.submitReport?.(env(), { code: 'ABCDEF', matchId: 'm1', reporterPid: a.pid, targetPid: b.pid, reporterSeat: 's1', targetSeat: 's2', reason: 'abuse', at: Date.now(), chat: [] });
    expect(h.storage.raw.prepare('SELECT COUNT(*) AS n FROM soc_reports').get()).toEqual({ n: 1 });
    await socialHooks.blockByPid?.(env(), a.pid, b.pid);
    expect(h.storage.raw.prepare('SELECT COUNT(*) AS n FROM soc_friends').get()).toEqual({ n: 0 });
    expect(h.storage.raw.prepare('SELECT COUNT(*) AS n FROM soc_blocks WHERE pid = ?').get(a.pid)).toEqual({ n: 1 });
  });
});

// ───────── the sockets it holds ─────────

describe('the players\' sockets, held by the same object', () => {
  const identity = (p: Player) => ({ pid: p.pid, fid: p.me.fid, name: p.me.name, band: p.me.band });
  async function online(p: Player): Promise<FakeSocket> {
    const ws = new FakeSocket();
    probe.registry.accept(ws, identity(p));
    await h.state.settle();
    return ws;
  }

  beforeEach(() => useProbe());

  it('a friend request, its answer and a status change reach the other player\'s socket, with no call to another object', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const b = await signUp('adult', { name: 'Bo' });
    const wsA = await online(a);
    const wsB = await online(b);
    await api(a.dev, 'POST', '/api/social/friends/request', { code: b.me.code });
    expect(wsB.events().filter((e) => e.t === 'friend_request')).toEqual([{ t: 'friend_request', from: { fid: a.me.fid, name: 'Ada' }, at: expect.any(Number), via: 'code' }]);
    await api(b.dev, 'POST', '/api/social/friends/respond', { fid: a.me.fid, accept: true });
    expect(wsA.events().filter((e) => e.t === 'friend_added')).toEqual([{ t: 'friend_added', friend: { fid: b.me.fid, name: 'Bo', band: 'adult' } }]);
    wsB.sent.length = 0;
    await probe.webSocketMessage(wsA, JSON.stringify({ t: 'status', status: 'playing', game: 'jacks' }));
    await h.state.settle();
    expect(wsB.events()).toEqual([{ t: 'presence', fid: a.me.fid, name: 'Ada', presence: { status: 'playing', game: 'jacks' } }]);
    // the socket closing is the player leaving
    wsA.close(1000);
    probe.webSocketClose(wsA, 1000, 'bye');
    await h.state.settle();
    expect(wsB.events().at(-1)).toEqual({ t: 'presence', fid: a.me.fid, name: 'Ada', presence: { status: 'offline' } });
    expect(h.storage.raw.prepare('SELECT online FROM soc_presence WHERE pid = ?').get(a.pid)).toEqual({ online: 0 });
  });

  it('an invitation goes to the friend\'s socket, and "offline" when there is none', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const b = await signUp('adult', { name: 'Bo' });
    await friends(a, b);
    await online(a);
    await socialHooks.publishRoom?.(env(), summary('ABCDEF', { kind: 'private', audience: null }), [a.pid]);
    await socialHooks.setPlaying?.(env(), { code: 'ABCDEF', pid: a.pid, inRoom: true, playing: false, gameId: 'jacks' });
    const none = await api(a.dev, 'POST', '/api/social/invite', { fid: b.me.fid, room: 'ABCDEF' });
    expect(none.status).toBe(409);
    expect(none.body.error).toBe('offline');
    const wsB = await online(b);
    const sent = await api(a.dev, 'POST', '/api/social/invite', { fid: b.me.fid, room: 'ABCDEF' });
    expect(sent.status).toBe(200);
    expect(wsB.events().filter((e) => e.t === 'invite')).toEqual([{ t: 'invite', id: sent.body.id, from: { fid: a.me.fid, name: 'Ada' }, room: 'ABCDEF', game: 'jacks', exp: sent.body.exp }]);
  });

  it('a ban closes the player\'s sockets with the code the page acts on, and deleting the profile tells the friends', async () => {
    const a = await signUp('adult', { name: 'Ada' });
    const b = await signUp('adult', { name: 'Bo' });
    await friends(a, b);
    const wsA = await online(a);
    const wsB = await online(b);
    await api(b.dev, 'POST', '/api/social/report', { fid: a.me.fid, reason: 'abuse' });
    const id = (h.storage.raw.prepare('SELECT id FROM soc_reports').get() as { id: number }).id;
    const ban = await h.call('POST', `/api/admin/social/reports/${id}`, { headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` }, body: { action: 'ban', days: 1 } });
    expect(ban.status).toBe(200);
    expect(wsA.events().at(-1)).toEqual({ t: 'closing', reason: 'banned' });
    expect(wsA.closed?.code).toBe(HUB_CLOSE.BANNED);
    expect(wsB.closed).toBeNull();
    // the other way: Bo erases the profile, and Bo's friend hears it
    const cy = await signUp('adult', { name: 'Cy' });
    await friends(b, cy);
    const wsCy = await online(cy);
    const wsB2 = await online(b);
    wsCy.sent.length = 0;
    const del = await api(b.dev, 'POST', '/api/social/me/delete', { confirm: 'delete' });
    expect(del.status).toBe(200);
    expect(wsB2.events().at(-1)).toEqual({ t: 'closing', reason: 'deleted' });
    expect(wsB2.closed?.code).toBe(HUB_CLOSE.DELETED);
    expect(wsCy.events()).toEqual([{ t: 'friend_removed', fid: b.me.fid }]);
  });
});

// ───────── what the SQL did ─────────

describe('what its SQL did', () => {
  it('counts the statements and the rows they read and wrote, and logs the numbers once an hour (and starts counting again)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const t0 = Date.UTC(2026, 9, 24, 12, 0, 0);
      vi.setSystemTime(t0);
      build();
      useProbe();
      await signUp('adult', { name: 'Ada' });
      expect(probe.sql.statements).toBeGreaterThan(3);
      expect(probe.sql.rowsRead).toBeGreaterThan(0);
      expect(probe.sql.rowsWritten).toBeGreaterThan(2);   // the profile, its device and the counters, with their index entries
      const seen = { ...probe.sql };
      // nothing is logged before the hour is over
      await probe.fetch(new Request(`${TEST_ORIGIN}/api/social/nothing`));
      expect(log.mock.calls.some((c) => String(c[0]).includes('social_sql'))).toBe(false);
      vi.setSystemTime(t0 + METER_LOG_EVERY_MS + 1);
      await probe.fetch(new Request(`${TEST_ORIGIN}/api/social/nothing`));
      const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('social_sql'));
      expect(JSON.parse(line ?? '{}')).toEqual({ evt: 'social_sql', sinceMs: METER_LOG_EVERY_MS + 1, ...seen });
      expect(probe.sql).toEqual({ statements: 0, rowsRead: 0, rowsWritten: 0 });
    } finally {
      vi.useRealTimers();
      log.mockRestore();
    }
  });
});
