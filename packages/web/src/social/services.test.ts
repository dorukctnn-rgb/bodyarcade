// The real services of the shell: when the page asks the service at all, what it does when the service is not there, and
// that the room calls of a signed-in player carry the signature of their profile (the preview's SOCIAL_ALLOW_UNSIGNED bridge
// goes away because of this).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY } from '../../../core/social/age.ts';
import { MemoryKeyStore, type KeyStore } from '../../../core/social/keystore.ts';
import { AUTH_HEADER } from '../../../core/social/sign.ts';
import { createStore, memoryStorage } from '../../../core/store/store.ts';
import type { ExecutionContextLike } from '../../../server/src/cf.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../../../server/src/social/testkit.ts';
import { isLinkEntry, lazyKeyStore, probeSocial, startSocial } from './services.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const WIN = { location: { origin: TEST_ORIGIN, href: `${TEST_ORIGIN}/` }, navigator: { languages: ['tr-TR', 'en'] } } as unknown as Window & typeof globalThis;

let app: TestApp;
beforeEach(() => { app = createTestApp(); });
afterEach(() => { POLICY.child.online = true; });

describe('probing the service', () => {
  it('a Worker that has the service answers 401 with a JSON error', async () => {
    expect(await probeSocial(async () => json(401, { error: 'unauthorized' }))).toBe('answers');
    expect(await probeSocial(async () => json(503, { error: 'unavailable' }))).toBe('answers');
  });

  it('a static host answers with its start page or a 404, which is not the service', async () => {
    expect(await probeSocial(async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))).toBe('absent');
    expect(await probeSocial(async () => new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }))).toBe('absent');
    expect(await probeSocial(async () => json(200, { hello: 'world' }))).toBe('absent');
  });

  it('no answer at all is unreachable, not absent', async () => {
    expect(await probeSocial(async () => { throw new TypeError('offline'); })).toBe('unreachable');
  });

  it('asks without credentials and without the cache, at the page\'s own origin', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    await probeSocial(async (url, init) => { seen.push({ url: String(url), init }); return json(401, { error: 'unauthorized' }); });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('/api/social/me');
    expect(seen[0]?.init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });
});

describe('links that open the app on a friend or a room', () => {
  it('a friend link and a room link are entries, in every language; nothing else is', () => {
    for (const url of ['/f/BA-7K2Q4X', '/f/BA-7K2Q4X/', '/r/K7Q2MX', '/tr/f/BA-7K2Q4X/', '/tr/r/K7Q2MX/?x=1']) expect(isLinkEntry(url), url).toBe(true);
    for (const url of ['/', '/friends/', '/lobbies/', '/games/squat-flap/', '/safety/']) expect(isLinkEntry(url), url).toBe(false);
  });
});

describe('the key store of the device', () => {
  const fake = (persistent = true) => {
    const calls: string[] = [];
    let saved: unknown = null;
    const store: KeyStore = {
      persistent,
      async load() { calls.push('load'); return saved as never; },
      async save(i) { calls.push('save'); saved = i; },
      async clear() { calls.push('clear'); saved = null; },
    };
    return { store, calls };
  };

  it('is not opened for a visitor who has no database: nothing is made until a profile is saved', async () => {
    const f = fake();
    let opened = 0;
    const lazy = lazyKeyStore({ open: async () => { opened++; return f.store; }, exists: async () => false });
    expect(await lazy.load()).toBeNull();
    await lazy.clear();
    expect(opened).toBe(0);
    expect(f.calls).toEqual([]);
    await lazy.save({ keys: {} as never, registered: false });
    expect(opened).toBe(1);
    await lazy.load();
    expect(opened).toBe(1);
    expect(f.calls).toEqual(['save', 'load']);
  });

  it('is opened at once when the database exists (a returning player)', async () => {
    const f = fake();
    const lazy = lazyKeyStore({ open: async () => f.store, exists: async () => true });
    await lazy.load();
    expect(f.calls).toEqual(['load']);
  });

  it('opens when the browser cannot say whether a database exists, and says whether the profile will stay once it is open', async () => {
    const f = fake(false);
    const lazy = lazyKeyStore({ open: async () => f.store, exists: async () => { throw new Error('no databases()'); } });
    await lazy.load();
    expect(f.calls).toEqual(['load']);
    expect(lazy.persistent).toBe(false);
  });
});

describe('starting the services', () => {
  const store = () => createStore({ storage: memoryStorage() });

  it('a site without the service has no friends services at all', async () => {
    const fetchFn = vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const s = await startSocial({ win: WIN, store: store(), fetch: fetchFn as unknown as typeof fetch, keys: new MemoryKeyStore() });
    expect(s).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a page that nothing answers has none either, unless the visitor came by a friend link or a room link', async () => {
    const down = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    expect(await startSocial({ win: WIN, store: store(), fetch: down, keys: new MemoryKeyStore() })).toBeNull();
    const entry = await startSocial({ win: WIN, store: store(), fetch: down, keys: new MemoryKeyStore(), entry: true });
    expect(entry).not.toBeNull();
    await entry?.social.open();
    expect(entry?.social.state().status).toBe('ready');                 // no profile: nothing was asked
    const added = await entry?.social.addByCode('BA-7K2Q4X');
    expect(added).toMatchObject({ ok: false });
  });

  it('a player who said under 16 sends nothing: the service is not even asked', async () => {
    const st = store();
    st.ns('social').set('tooYoung', true, { version: 1, parse: (r: unknown) => (typeof r === 'boolean' ? r : null) });
    const fetchFn = vi.fn(async () => json(401, { error: 'unauthorized' }));
    const s = await startSocial({ win: WIN, store: st, fetch: fetchFn as unknown as typeof fetch, keys: new MemoryKeyStore() });
    expect(s).not.toBeNull();
    await s?.social.open();
    expect(s?.social.state()).toMatchObject({ noOnline: 'young', profile: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('saying under 16 is kept in the store of the page', async () => {
    const st = store();
    const s = await startSocial({ win: WIN, store: st, fetch: (async () => json(401, { error: 'unauthorized' })) as unknown as typeof fetch, keys: new MemoryKeyStore() });
    s?.social.declareTooYoung();
    expect(st.ns('social').get('tooYoung', { version: 1, parse: (r: unknown) => (typeof r === 'boolean' ? r : null) }, false)).toBe(true);
  });

  it('a device that already has a profile does not ask whether the service exists', async () => {
    const keys: KeyStore = new MemoryKeyStore();
    const { generateDeviceKey } = await import('../../../core/social/sign.ts');
    await keys.save({ keys: await generateDeviceKey(), registered: true });
    const fetchFn = vi.fn(async () => json(401, { error: 'unauthorized' }));
    const s = await startSocial({ win: WIN, store: store(), fetch: fetchFn as unknown as typeof fetch, keys });
    expect(s).not.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a signed-in player opens and joins rooms signed with their own profile: the signature, the device id, the name and the age band', async () => {
    const roomCalls: { path: string; auth: string | null; body: unknown }[] = [];
    const pending: Promise<unknown>[] = [];
    const ctx: ExecutionContextLike = { waitUntil: (p) => { pending.push(p); } };
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const full = url.startsWith('http') ? url : `${TEST_ORIGIN}${url}`;
      const req = new Request(full, init);
      req.headers.set('CF-Connecting-IP', '10.80.0.1');
      const path = new URL(full).pathname;
      if (path.startsWith('/api/rooms')) {
        roomCalls.push({ path, auth: req.headers.get(AUTH_HEADER), body: init?.body ? JSON.parse(String(init.body)) : null });
        return json(404, { error: 'no_room' });
      }
      const res = await app.router.handle(req, app.env, ctx);
      while (pending.length > 0) await Promise.allSettled(pending.splice(0));
      return res ?? json(404, { error: 'no_route' });
    }) as typeof fetch;
    const s = await startSocial({ win: WIN, store: store(), fetch: fetchFn, keys: new MemoryKeyStore() });
    expect(s).not.toBeNull();
    if (!s) return;
    await s.social.open();

    // before a profile exists a room cannot be opened at all: nothing is sent
    expect(await s.rooms.create({ game: 'squat-flap', kind: 'private', size: 2, band: null })).toEqual({ ok: false, code: 'not_allowed' });
    expect(roomCalls).toEqual([]);

    const made = await s.social.createProfile({ band: 'adult', name: 'Mia' });
    expect(made.ok).toBe(true);
    const res = await s.rooms.create({ game: 'squat-flap', kind: 'private', size: 2, band: null });
    expect(res.ok).toBe(false);                      // the stand-in answers 404: what matters is what was sent
    expect(roomCalls).toHaveLength(1);
    expect(roomCalls[0]?.path).toBe('/api/rooms');
    expect(roomCalls[0]?.auth).toMatch(/^v1\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(roomCalls[0]?.body).toMatchObject({ kind: 'private', gameId: 'squat-flap', name: 'Mia', age: 'adult', pid: s.client.roomIdentity().pid });

    // joining a room is signed the same way
    await s.rooms.join('K7Q2MX');
    expect(roomCalls[1]?.path).toBe('/api/rooms/K7Q2MX/join');
    expect(roomCalls[1]?.auth).toMatch(/^v1\./);
    expect(roomCalls[1]?.body).toMatchObject({ name: 'Mia', age: 'adult' });
  });

  it('the room port carries what the room page needs besides rooms: the live client of the open room, report and block by seat', async () => {
    const s = await startSocial({ win: WIN, store: store(), fetch: (async () => json(401, { error: 'unauthorized' })) as unknown as typeof fetch, keys: new MemoryKeyStore() });
    expect(typeof s?.rooms.client).toBe('function');
    expect(s?.rooms.client?.()).toBeNull();
    expect(typeof s?.rooms.reportSeat).toBe('function');
    expect(typeof s?.rooms.blockSeat).toBe('function');
    expect(() => s?.rooms.reportSeat?.('s2', 'abuse', true)).not.toThrow();      // no room open: nothing happens
  });

  it('the language of a new profile is the page\'s own', async () => {
    const seen: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    const ctx: ExecutionContextLike = { waitUntil: (p) => { pending.push(p); } };
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const req = new Request(url.startsWith('http') ? url : `${TEST_ORIGIN}${url}`, init);
      req.headers.set('CF-Connecting-IP', '10.80.0.2');
      if (init?.body) seen.push(JSON.parse(String(init.body)));
      const res = await app.router.handle(req, app.env, ctx);
      while (pending.length > 0) await Promise.allSettled(pending.splice(0));
      return res ?? json(404, { error: 'no_route' });
    }) as typeof fetch;
    const s = await startSocial({ win: WIN, store: store(), fetch: fetchFn, keys: new MemoryKeyStore() });
    await s?.social.createProfile({ band: 'adult', name: 'Mia' });
    expect(seen[0]).toMatchObject({ band: 'adult', name: 'Mia', lang: 'tr' });
  });
});
