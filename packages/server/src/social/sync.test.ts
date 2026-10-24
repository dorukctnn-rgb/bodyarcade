// Synced documents: writes from a revision, conflicts, limits, and what happens to them when a profile is erased.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY } from '../../../core/social/rules.ts';
import { SYNC_KEYS, SYNC_MAX_CHARS, SYNC_WRITES_PER_DAY, type DataExport, type SyncDoc } from '../../../core/social/types.ts';
import { createTestApp, type TestApp, type TestPlayer } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const T0 = Date.UTC(2026, 9, 21, 12);
let app: TestApp;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const put = (p: TestPlayer, key: string, baseRev: unknown, data: unknown) => p.api<{ rev: number; at: number; error?: string; current?: SyncDoc | null }>('PUT', `/api/social/sync/${key}`, { baseRev, data });
const docs = async (p: TestPlayer): Promise<Record<string, SyncDoc>> => (await p.get('/api/social/sync')).body.docs as Record<string, SyncDoc>;

describe('writing and reading', () => {
  it('a document is made from revision 0, read back, and changed from the revision that was read', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    expect(await docs(ada)).toEqual({});
    const first = await put(ada, 'daily', 0, { streak: 3, last: '2026-10-20' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ rev: 1, at: T0 });
    expect(await docs(ada)).toEqual({ daily: { rev: 1, at: T0, data: { streak: 3, last: '2026-10-20' } } });
    vi.setSystemTime(T0 + 60_000);
    const second = await put(ada, 'daily', 1, { streak: 4, last: '2026-10-21' });
    expect(second.body).toMatchObject({ rev: 2, at: T0 + 60_000 });
    expect((await docs(ada)).daily).toEqual({ rev: 2, at: T0 + 60_000, data: { streak: 4, last: '2026-10-21' } });
    // every kind of JSON value is kept as it is
    for (const [key, value] of [['habit', [1, 2, 3]], ['progress', { a: { b: [true, null, 'x', 1.5] } }], ['plans', 'text'], ['prefs', 0]] as const) {
      expect((await put(ada, key, 0, value)).status).toBe(200);
      expect((await docs(ada))[key]?.data).toEqual(value);
    }
    expect(Object.keys(await docs(ada)).sort()).toEqual([...SYNC_KEYS].sort());
  });

  it('is private to the player, and the first device and a recovered one see the same documents', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    const bo = await app.signup('adult', { name: 'Bo' });
    await put(ada, 'daily', 0, { streak: 9 });
    expect(await docs(bo)).toEqual({});
    const phone = await app.newDevice();
    await app.call('POST', '/api/social/recover', { dev: phone, body: { pub: phone.keys.publicRaw, code: ada.me.code, recovery: ada.recovery } });
    const there = await app.call<{ docs: Record<string, SyncDoc> }>('GET', '/api/social/sync', { dev: phone });
    expect(there.body.docs.daily?.data).toEqual({ streak: 9 });
    const wrote = await app.call('PUT', '/api/social/sync/daily', { dev: phone, body: { baseRev: 1, data: { streak: 10 } } });
    expect(wrote.status).toBe(200);
    expect((await docs(ada)).daily?.data).toEqual({ streak: 10 });
  });

  it('needs a signature', async () => {
    expect((await app.call('GET', '/api/social/sync')).status).toBe(401);
    expect((await app.call('PUT', '/api/social/sync/daily', { body: { baseRev: 0, data: {} } })).status).toBe(401);
  });
});

describe('conflicts', () => {
  it('a write from an old revision is refused with the document as it is now, a first write over an existing one too', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    await put(ada, 'daily', 0, { streak: 1 });
    await put(ada, 'daily', 1, { streak: 2 });
    const stale = await put(ada, 'daily', 1, { streak: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('conflict');
    expect(stale.body.current).toEqual({ rev: 2, at: T0, data: { streak: 2 } });
    const again = await put(ada, 'daily', 0, { streak: 99 });
    expect(again.status).toBe(409);
    expect(again.body.current).toMatchObject({ rev: 2 });
    // a revision from the future is no better, and a document that does not exist has no current one
    expect((await put(ada, 'daily', 7, { streak: 99 })).status).toBe(409);
    const none = await put(ada, 'habit', 3, { x: 1 });
    expect(none.status).toBe(409);
    expect(none.body.current).toBeNull();
    expect((await docs(ada)).daily?.data).toEqual({ streak: 2 });
    expect((await docs(ada)).habit).toBeUndefined();
  });

  it('two writes from the same revision at the same moment: one wins, the other is told', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    await put(ada, 'daily', 0, { streak: 1 });
    const [a, b] = await Promise.all([put(ada, 'daily', 1, { from: 'a' }), put(ada, 'daily', 1, { from: 'b' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? 'a' : 'b';
    expect((await docs(ada)).daily).toMatchObject({ rev: 2, data: { from: won } });
    const lost = a.status === 409 ? a : b;
    expect(lost.body.current).toMatchObject({ rev: 2, data: { from: won } });
  });
});

describe('what is refused', () => {
  it('a key that is not on the list, a bad revision and no data', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    for (const key of ['nope', 'Daily', '__proto__', 'daily2', 'me']) expect((await put(ada, key, 0, { a: 1 })).status, key).toBe(400);
    for (const bad of [-1, 1.5, '0', null, undefined, NaN, Number.MAX_VALUE]) expect((await put(ada, 'daily', bad, { a: 1 })).status, String(bad)).toBe(400);
    const noData = await app.call('PUT', '/api/social/sync/daily', { dev: ada.dev, body: { baseRev: 0 } });
    expect(noData.status).toBe(400);
    expect(Object.keys(await docs(ada))).toEqual([]);
  });

  it('a document of more than 3,000 characters, however it is packed', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    const fits = 'x'.repeat(SYNC_MAX_CHARS - 2);
    expect((await put(ada, 'daily', 0, fits)).status).toBe(200);
    const big = await put(ada, 'daily', 1, 'x'.repeat(SYNC_MAX_CHARS - 1));
    expect(big.status).toBe(413);
    expect(big.body.error).toBe('payload_too_large');
    expect((await put(ada, 'habit', 0, Array.from({ length: 1500 }, (_, i) => i))).status).toBe(413);
    expect((await docs(ada)).daily?.data).toBe(fits);
  });

  it('sixty writes a day for each document, then the day is over for it; another document has its own sixty', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    for (let i = 0; i < SYNC_WRITES_PER_DAY; i++) expect((await put(ada, 'daily', i, { i })).status, `write ${i}`).toBe(200);
    const over = await put(ada, 'daily', SYNC_WRITES_PER_DAY, { i: 'too many' });
    expect(over.status).toBe(429);
    expect(over.body.error).toBe('rate_limited');
    expect((await put(ada, 'habit', 0, { i: 0 })).status).toBe(200);
    vi.setSystemTime(T0 + DAY);
    expect((await put(ada, 'daily', SYNC_WRITES_PER_DAY, { i: 'next day' })).status).toBe(200);
    expect((await docs(ada)).daily?.rev).toBe(SYNC_WRITES_PER_DAY + 1);
  });

  it('costs one row for a write, and nothing for a refused one or a read', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    await ada.get('/api/social/me');
    app.db.resetCounters();
    await put(ada, 'daily', 0, { a: 1 });
    expect(app.db.counters.writes).toBe(1);
    app.db.resetCounters();
    await put(ada, 'daily', 0, { a: 2 });                    // a conflict
    await put(ada, 'nope', 0, {});
    await put(ada, 'daily', 1, 'x'.repeat(5000));
    await docs(ada);
    expect(app.db.counters.writes).toBe(0);
  });
});

describe('erasing and exporting', () => {
  it('the export lists the documents as they are stored, and erasing the profile removes them', async () => {
    const ada = await app.signup('adult', { name: 'Ada' });
    const bo = await app.signup('adult', { name: 'Bo' });
    await put(ada, 'daily', 0, { streak: 5 });
    await put(bo, 'daily', 0, { streak: 8 });
    const out = (await ada.get('/api/social/me/export')).body.export as DataExport;
    expect(out.sync).toEqual({ daily: { rev: 1, at: T0, data: { streak: 5 } } });
    const pid = ada.pid();
    expect((await ada.post('/api/social/me/delete', { confirm: 'delete' })).status).toBe(200);
    expect(app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_sync WHERE pid = ?').get(pid)).toEqual({ n: 0 });
    expect(app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_sync').get()).toEqual({ n: 1 });
  });
});
