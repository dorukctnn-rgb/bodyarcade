// The Durable Object class itself, on a fake state made of node:sqlite: its tables, its small protocol, the alarm that
// sends the reminder mails, and what happens when many requests arrive at once. (The Workers runtime is the Miniflare test.)
import { describe, expect, it } from 'vitest';
import { API } from '../../../core/entitlements/api.ts';
import type { DurableObjectStateLike } from '../cf.ts';
import { EntitlementsDO } from './durable.ts';
import { FORWARD_EMAIL_API } from './mail.ts';
import { DAY, DIDS, KEYS, PRODUCT_PRO_YEARLY, FakeGumroad, Clock, fakeDoStorage, gumroadFetch, makeKeys } from './testkit.ts';

const [KEY, KEY2] = KEYS as unknown as [string, string];
const [D0] = DIDS as [string, string, string, string, string, string, string, string];
const PRODUCTS = JSON.stringify({ [PRODUCT_PRO_YEARLY]: 'pro-yearly' });

async function make(env: Record<string, unknown> = {}, mailStatus = 200) {
  const clock = new Clock();
  const keys = await makeKeys();
  const gum = new FakeGumroad(clock);
  const storage = fakeDoStorage();
  const logs: { evt: string; data: Record<string, unknown> }[] = [];
  const mails: Record<string, unknown>[] = [];
  const fetchFn = gumroadFetch(gum, async (url, init) => {
    if (url !== FORWARD_EMAIL_API) return new Response('{}', { status: 404 });
    mails.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response('{}', { status: mailStatus });
  });
  const e = { ENT_PRIV_JWK: JSON.stringify(keys.privateJwk), ENT_NO_LIMITS: '1', GUMROAD_PRODUCTS: PRODUCTS, ENT_MAIL_TOKEN: 'fe-token-12345', ENT_MAIL_FROM: 'BodyArcade <info@bodyarcade.com>', ...env };
  let blocked = 0;
  const state = { storage, blockConcurrencyWhile: async (fn: () => Promise<unknown>) => { blocked++; return fn(); } } as unknown as DurableObjectStateLike;
  const build = () => new EntitlementsDO(state, e, { now: clock.now, fetch: fetchFn, log: (evt, data) => { logs.push({ evt, data }); } });
  const durable = build();
  const post = (op: string, body: unknown, method = 'POST') => durable.fetch(new Request(`https://entitlements.internal/${op}`, { method, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }));
  return { durable, build, post, clock, keys, gum, storage, logs, mails, blocked: () => blocked };
}

const json = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

describe('starting up', () => {
  it('makes its tables, once, before it answers anything', async () => {
    const w = await make();
    const names = w.storage.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).map((t) => t.name);
    expect(names).toEqual(['meta', 'purchases', 'reminders', 'seats']);
    expect(w.blocked()).toBe(1);
  });

  it('starts again on the same storage without losing or changing anything', async () => {
    const w = await make();
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    expect((await w.post('activate', { key: KEY, did: D0 })).status).toBe(200);
    const salt = w.storage.db.one<{ v: string }>(`SELECT v FROM meta WHERE k = 'salt'`)?.v;
    const again = w.build();
    expect((await again.fetch(new Request('https://entitlements.internal/key'))).status).toBe(200);
    expect(w.storage.db.all('SELECT * FROM purchases')).toHaveLength(1);
    expect(w.storage.db.all('SELECT * FROM seats')).toHaveLength(1);
    expect(w.storage.db.one<{ v: string }>(`SELECT v FROM meta WHERE k = 'schema'`)?.v).toBe('1');
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('says what is wrong with its settings once, by name, and then works with what it has', async () => {
    const w = await make({ ENT_PRIV_JWK: undefined, ENT_MAIL_TOKEN: undefined, ENT_MAIL_FROM: undefined, PLAY_SA_JSON: 'x'.repeat(80) });
    await w.post('activate', { key: KEY, did: D0 });
    await w.post('activate', { key: KEY2, did: D0 });
    const config = w.logs.filter((l) => l.evt === 'config');
    expect(config).toHaveLength(1);
    expect(config[0]?.data['problems']).toEqual(['ENT_PRIV_JWK missing', 'PLAY_SA_JSON unusable']);
    expect(await json(await w.post('key', null, 'GET'))).toEqual({ keys: [], reminders: false });
  });
});

describe('its protocol', () => {
  it('answers only the calls it has: an unknown one is 404, a GET where a POST is wanted is 405, bad JSON is 400', async () => {
    const w = await make();
    expect(await json(await w.post('nope', {}))).toEqual({ error: 'not_found' });
    expect((await w.post('nope', {})).status).toBe(404);
    const get = await w.post('activate', null, 'GET');
    expect(get.status).toBe(405);
    expect(await json(get)).toEqual({ error: 'method_not_allowed' });
    expect(await json(await w.post('activate', '{"key": '))).toEqual({ error: 'bad_json' });
    expect((await w.post('activate', {})).status).toBe(400);
  });

  it('takes the caller\'s address from the body, shortened, and never from anywhere else', async () => {
    const w = await make({ ENT_NO_LIMITS: undefined });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    const long = 'x'.repeat(5000);
    expect((await w.post('activate', { key: KEY, did: D0, ip: long })).status).toBe(200);
    expect(JSON.stringify(w.storage.db.all('SELECT * FROM meta'))).not.toContain(long.slice(0, 100));
  });

  it('every answer is JSON that is not cached', async () => {
    const w = await make();
    for (const r of [await w.post('activate', {}), await w.post('key', null, 'GET'), await w.post('nope', {})]) {
      expect(r.headers.get('Content-Type')).toMatch(/^application\/json/);
      expect(r.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('a failure inside is "internal", with no detail in the answer and a line in the log', async () => {
    const w = await make();
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    w.storage.db.raw.exec('DROP TABLE seats');
    const r = await w.post('activate', { key: KEY, did: D0 });
    expect(r.status).toBe(500);
    expect(await json(r)).toEqual({ error: 'internal' });
    expect(w.logs.some((l) => l.evt === 'error' && l.data['where'] === 'fetch')).toBe(true);
  });
});

describe('many requests at once', () => {
  it('twelve devices, one Pro purchase, the seller slow: three seats, nine refusals, never four', async () => {
    const w = await make();
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    await w.post('activate', { key: KEY, did: DIDS[7] });
    w.clock.advance(601_000);                                              // every request has to ask the seller
    w.gum.hook = () => new Promise((res) => setTimeout(res, Math.random() * 8));
    const dids = Array.from({ length: 12 }, (_, i) => `${(i + 1).toString(16).padStart(2, '0')}`.repeat(16));
    const results = await Promise.all(dids.map((did) => w.post('activate', { key: KEY, did })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(2);             // one seat was already taken
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);
    expect(w.storage.db.all('SELECT * FROM seats')).toHaveLength(3);
  });
});

describe('the alarm', () => {
  async function withTrial(w: Awaited<ReturnType<typeof make>>) {
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    const token = String((await json(await w.post('activate', { key: KEY, did: D0 })))['token']);
    return token;
  }

  it('is set when an address is left: the due time if that is within a day, else a day from now', async () => {
    const w = await make();
    const token = await withTrial(w);
    expect(w.storage.alarm).toBeNull();                                      // an activation sets none
    const r = await w.post('reminder', { token, did: D0, email: 'a@example.com', lang: 'en' });
    expect(r.status).toBe(200);
    expect(w.storage.alarm).toBe(w.clock.now() + DAY);                      // due in five days: look again in a day
  });

  it('sends the mail when it fires, and looks again in a day (nothing is left to wait for)', async () => {
    const w = await make();
    const token = await withTrial(w);
    await w.post('reminder', { token, did: D0, email: 'a@example.com', lang: 'fr' });
    w.clock.advance(5 * DAY + 1000);
    await w.durable.alarm();
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0]).toMatchObject({ from: 'BodyArcade <info@bodyarcade.com>', to: 'a@example.com', subject: 'Votre essai gratuit de BodyArcade se termine dans 2 jours' });
    expect(w.storage.alarm).toBe(w.clock.now() + DAY);
    expect(w.storage.db.all('SELECT * FROM reminders')).toHaveLength(0);
  });

  it('is set to the moment of the next mail when one is due sooner than a day', async () => {
    const w = await make();
    const token = await withTrial(w);
    await w.post('reminder', { token, did: D0, email: 'a@example.com', lang: 'en' });
    w.clock.advance(4.5 * DAY);                                              // the mail is due in twelve hours
    await w.durable.alarm();
    expect(w.mails).toHaveLength(0);
    expect(w.storage.alarm).toBe(w.clock.now() + 0.5 * DAY);
  });

  it('does not move an alarm that is already sooner', async () => {
    const w = await make();
    const token = await withTrial(w);
    w.storage.alarm = w.clock.now() + 1000;
    await w.post('reminder', { token, did: D0, email: 'a@example.com', lang: 'en' });
    expect(w.storage.alarm).toBe(w.clock.now() + 1000);
  });

  it('survives a sweep that fails: it logs, sets the next alarm and does not throw (the platform would retry at once)', async () => {
    const w = await make();
    await withTrial(w);
    w.storage.db.raw.exec('DROP TABLE reminders');
    await expect(w.durable.alarm()).resolves.toBeUndefined();
    expect(w.logs.some((l) => l.evt === 'error' && l.data['where'] === 'sweep')).toBe(true);
    expect(w.storage.alarm).not.toBeNull();
  });

  it('frees idle seats and writes down what it did', async () => {
    const w = await make();
    await withTrial(w);
    w.clock.advance(91 * DAY);
    await w.durable.alarm();
    expect(w.storage.db.all('SELECT * FROM seats')).toHaveLength(0);
    expect(w.logs.find((l) => l.evt === 'sweep')?.data).toMatchObject({ seatsFreed: 1 });
  });

  it('does nothing noisy when there is nothing to do', async () => {
    const w = await make();
    await w.durable.alarm();
    expect(w.logs.filter((l) => l.evt === 'sweep')).toHaveLength(0);
    expect(w.storage.alarm).toBe(w.clock.now() + DAY);
  });
});

describe('the contract path the Worker uses', () => {
  it('is the one api.ts names, minus its prefix', () => {
    expect(Object.values(API).map((p) => p.replace('/api/entitlements/', '')).sort()).toEqual(['activate', 'deactivate', 'key', 'play', 'refresh', 'reminder', 'reset']);
  });
});
