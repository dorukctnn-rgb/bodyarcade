// The routes through the Worker's router and the real Durable Object class (on node:sqlite), with Gumroad as an HTTP
// service, and the app's own code (the server provider and the manager) as the client. What the app and the Worker
// say to each other is api.ts; this is where the two are proven to agree.
import { describe, expect, it } from 'vitest';
import { API, ERROR_STATUS } from '../../../core/entitlements/api.ts';
import { createEntitlements } from '../../../core/entitlements/manager.ts';
import { createServerProvider } from '../../../core/entitlements/providers/server.ts';
import { verifyToken } from '../../../core/entitlements/token.ts';
import { createStore, memoryStorage } from '../../../core/store/index.ts';
import { RECHECK_S } from './rules.ts';
import {
  DAY, DIDS, KEYS, LEGACY_LIFETIME, PRODUCT_FAMILY, PRODUCT_PRO_MONTHLY, PRODUCT_PRO_YEARLY, makeWorld, type World,
} from './testkit.ts';

const [KEY, KEY2] = KEYS as unknown as [string, string];
const [D0, D1, D2, D3] = DIDS as [string, string, string, string, string, string, string, string];
const body = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

// Gumroad's product ids of the release are not real yet (catalog.ts), so the tests tell the Worker about the ones they use.

describe('the HTTP surface', () => {
  it('answers an activation with JSON that is never cached', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: JSON.stringify({ [PRODUCT_PRO_YEARLY]: 'pro-yearly' }) } });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    const r = await w.call('POST', API.activate, { key: KEY, did: D0 });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await body(r)).toMatchObject({ plan: 'pro-yearly', devices: { used: 1, limit: 3 } });
  });

  it('routes refresh like activate, and says so in its log', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: JSON.stringify({ [PRODUCT_PRO_MONTHLY]: 'pro-monthly' }) } });
    w.gum.add(PRODUCT_PRO_MONTHLY, KEY);
    expect((await w.call('POST', API.refresh, { key: KEY, did: D0 })).status).toBe(200);
    expect(w.logs.find((l) => l.evt === 'grant')?.data).toMatchObject({ mode: 'refresh', src: 'gumroad', plan: 'pro-monthly' });
  });

  it.each([API.activate, API.refresh, API.play, API.deactivate, API.reset, API.reminder])('%s takes POST only', async (path) => {
    const w = await makeWorld();
    const r = await w.call('GET', path);
    expect(r.status).toBe(405);
    expect(r.headers.get('Allow')).toBe('POST');
    expect(await body(r)).toEqual({ error: 'method_not_allowed' });
  });

  it('the key list takes GET only', async () => {
    const w = await makeWorld();
    const r = await w.call('POST', API.key, {});
    expect(r.status).toBe(405);
    expect(r.headers.get('Allow')).toMatch(/GET/);
  });

  it('refuses what is not JSON, not valid JSON, too large, or not what the contract says', async () => {
    const w = await makeWorld();
    const post = (b: unknown, headers?: Record<string, string>) => w.call('POST', API.activate, b, headers);
    expect((await post('key=1', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect(await body(await post('key=1', { 'Content-Type': 'text/plain' }))).toEqual({ error: 'json_expected' });
    expect(await body(await post('{"key": '))).toEqual({ error: 'bad_json' });
    expect((await post(`{"key":"${'A'.repeat(6000)}","did":"${D0}"}`)).status).toBe(413);
    for (const bad of [{}, { key: KEY }, { did: D0 }, { key: 'short', did: D0 }, { key: KEY, did: 'xyz' }, { key: 'bad key with spaces', did: D0 }, { key: 5, did: D0 }, [], null, 'x']) {
      const r = await post(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect((await body(r))['error'], JSON.stringify(bad)).toMatch(/^(bad_request|bad_json)$/);
    }
  });

  it('ignores fields it does not know, and a caller cannot pass its own address', async () => {
    const w = await makeWorld({ limits: true, env: { GUMROAD_PRODUCTS: JSON.stringify({ [PRODUCT_PRO_YEARLY]: 'pro-yearly' }) } });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    for (let i = 0; i < 60; i++) expect((await w.call('POST', API.activate, { key: KEY, did: D0, ip: `9.9.9.${i}`, extra: true }, { 'CF-Connecting-IP': '203.0.113.5' })).status).toBe(200);
    const limited = await w.call('POST', API.activate, { key: KEY, did: D0, ip: '1.2.3.4' }, { 'CF-Connecting-IP': '203.0.113.5' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await body(limited)).toMatchObject({ error: 'rate_limited' });
    expect((await w.call('POST', API.activate, { key: KEY, did: D0 }, { 'CF-Connecting-IP': '203.0.113.6' })).status).toBe(200);
  });

  it('an unknown address under /api/entitlements is a 404 in JSON', async () => {
    const w = await makeWorld();
    const r = await w.call('POST', '/api/entitlements/nope', {});
    expect(r.status).toBe(404);
    expect(await body(r)).toEqual({ error: 'not_found' });
  });

  it('says "unavailable" when the Worker has no such Durable Object, and when the object cannot be reached', async () => {
    const unbound = await makeWorld({ bound: false });
    expect(await body(await unbound.call('POST', API.activate, { key: KEY, did: D0 }))).toEqual({ error: 'unavailable' });
    expect((await unbound.call('POST', API.activate, { key: KEY, did: D0 })).status).toBe(503);
    expect((await unbound.call('GET', API.key)).status).toBe(503);

    const broken = await makeWorld();
    (broken.env['ENTITLEMENTS'] as { get: () => unknown }).get = () => ({ fetch: async () => { throw new Error('Durable Object reset'); } });
    const r = await broken.call('POST', API.activate, { key: KEY, did: D0 });
    expect(r.status).toBe(503);
    expect(await body(r)).toEqual({ error: 'unavailable' });
  });

  it('serves the public key, and nothing private, to anyone', async () => {
    const w = await makeWorld();
    const r = await w.call('GET', API.key);
    expect(r.status).toBe(200);
    const b = (await body(r)) as { keys: { kid: string; jwk: Record<string, string> }[]; reminders: boolean };
    expect(b.keys.map((k) => k.kid)).toEqual([w.keys.pub.kid]);
    expect(JSON.stringify(b)).not.toContain(w.keys.privateJwk.d as string);
    expect(Object.keys(b.keys[0]?.jwk ?? {}).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(b.reminders).toBe(false);
    expect((await w.call('HEAD', API.key)).status).toBe(200);
  });

  it('keeps the older public keys during a rotation, and refuses to publish a private one', async () => {
    const other = await (await import('../../../core/entitlements/testkit.ts')).makeKeys();
    const w = await makeWorld({ env: { ENT_PUB_JWKS: JSON.stringify([{ kid: 'old-key-1', jwk: { ...other.privateJwk, kid: undefined } }, { kid: 'junk', jwk: { kty: 'RSA' } }]) } });
    const b = (await body(await w.call('GET', API.key))) as { keys: { kid: string; jwk: Record<string, string> }[] };
    expect(b.keys.map((k) => k.kid)).toEqual([w.keys.pub.kid, 'old-key-1']);
    expect(JSON.stringify(b)).not.toContain(other.privateJwk.d as string);
  });

  it('is unavailable, not wrong, without a signing key', async () => {
    const w = await makeWorld({ env: { ENT_PRIV_JWK: '' } });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    expect(await body(await w.call('POST', API.activate, { key: KEY, did: D0 }))).toEqual({ error: 'unavailable' });
    expect(w.logs.some((l) => l.evt === 'config' && JSON.stringify(l.data).includes('ENT_PRIV_JWK missing'))).toBe(true);
    expect(JSON.stringify(w.logs)).not.toContain('"d"');
  });

  it('the error statuses are the ones api.ts promises', () => {
    expect(ERROR_STATUS).toMatchObject({ not_found: 404, refunded: 403, ended: 403, limit: 409, rate_limited: 429, upstream: 502, unavailable: 503 });
  });
});

describe('the app and the Worker, with the real client code on one side', () => {
  const PRODUCTS = JSON.stringify({ [PRODUCT_PRO_YEARLY]: 'pro-yearly', [PRODUCT_PRO_MONTHLY]: 'pro-monthly', [PRODUCT_FAMILY]: 'family-yearly' });

  async function device(w: World, did: string) {
    const store = createStore({ storage: memoryStorage() });
    const service = createEntitlements({
      store, keys: [w.keys.pub], now: w.clock.now, autoRefresh: false, random: (n) => Uint8Array.from(did.slice(0, n * 2).match(/../g) ?? [], (h) => parseInt(h, 16)),
      providers: [createServerProvider({ fetch: w.fetch, did: () => service.deviceId(), keys: [w.keys.pub], now: w.clock.now })],
    });
    await service.ready();
    return service;
  }

  it('a purchased key gives the device Pro, and the token it holds is the Worker\'s', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: PRODUCTS } });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    const s = await device(w, D0);
    expect(s.deviceId()).toBe(D0);
    expect(s.current().plan).toBe('free');
    const r = await s.activateKey(KEY);
    expect(r.ok).toBe(true);
    expect(s.current()).toMatchObject({ plan: 'pro', source: 'server' });
    expect(s.can('game:limbo-bend')).toBe(true);
    expect(s.can('family')).toBe(false);
    expect(s.status()).toMatchObject({ planId: 'pro-yearly', standing: 'active', everPaid: true });
    const claims = await verifyToken(s.current().token as string, { keys: [w.keys.pub], now: w.clock.now(), did: D0 });
    expect(claims.ok).toBe(true);
    s.dispose();
  });

  it('a Family purchase gives the family features, and the fourth device is the last', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: PRODUCTS } });
    w.gum.add(PRODUCT_FAMILY, KEY);
    const devices = [D0, D1, D2, D3];
    for (const d of devices) {
      const s = await device(w, d);
      expect((await s.activateKey(KEY)).ok, d).toBe(true);
      expect(s.can('family')).toBe(true);
      s.dispose();
    }
    const fifth = await device(w, DIDS[4] as string);
    expect(await fifth.activateKey(KEY)).toMatchObject({ ok: false, code: 'limit' });
    expect(fifth.current().plan).toBe('free');
    fifth.dispose();
  });

  it('a Pro purchase stops at three devices, and a seat given back is taken by the next', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: PRODUCTS } });
    w.gum.add(PRODUCT_PRO_MONTHLY, KEY);
    const [a, b, c] = [await device(w, D0), await device(w, D1), await device(w, D2)];
    for (const s of [a, b, c]) expect((await s.activateKey(KEY)).ok).toBe(true);
    const d = await device(w, D3);
    expect(await d.activateKey(KEY)).toMatchObject({ ok: false, code: 'limit' });
    await b.deactivate();
    expect(b.current().plan).toBe('free');
    expect((await d.activateKey(KEY)).ok).toBe(true);
    for (const s of [a, b, c, d]) s.dispose();
  });

  it('the live site\'s old Founder key works, with six devices', async () => {
    const w = await makeWorld();
    w.gum.add(LEGACY_LIFETIME, KEY2);
    const first = await device(w, D0);
    expect((await first.activateKey(KEY2)).ok).toBe(true);
    expect(first.status()).toMatchObject({ founder: true, planId: 'founder' });
    expect(first.can('family')).toBe(true);
    first.dispose();
  });

  it('a refund reaches the device at its next renewal, and only then (B2)', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: PRODUCTS } });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    const s = await device(w, D0);
    await s.activateKey(KEY);
    w.clock.advance((RECHECK_S + 1) * 1000);
    w.gum.fault = 'down';                                                 // Gumroad is down: a renewal cannot be judged, and Pro stays
    expect(await s.refresh()).toBe('renewed');                            // our server still vouches for a purchase it checked ten minutes ago
    for (let day = 1; day <= 13; day++) {
      w.clock.advance(DAY);
      expect(await s.refresh(), `day ${day}`).toBe('renewed');           // a device that asks every day keeps Pro for two weeks of silence
      expect(s.current().plan).toBe('pro');
    }
    w.clock.advance(DAY);
    expect(await s.refresh()).toBe('kept');                               // the fortnight is over: no new token, and the last one has run out, but nothing was refused
    expect(s.current().plan).toBe('free');
    expect(s.status().standing).toBe('expired');
    w.gum.fault = null;
    w.clock.advance(61_000);                                              // the Worker left Gumroad alone for a minute after its last failed call
    w.gum.purchase(PRODUCT_PRO_YEARLY, KEY)['refunded'] = true;
    expect(await s.refresh()).toBe('revoked');                            // now the seller says no
    expect(s.current().plan).toBe('free');
    s.dispose();
  });

  it('a membership cancelled this week keeps Pro until the paid period ends', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: PRODUCTS } });
    const end = w.clock.now() + 4 * DAY;
    w.gum.add(PRODUCT_PRO_MONTHLY, KEY, { subscription_cancelled_at: new Date(end).toISOString() });
    const s = await device(w, D0);
    await s.activateKey(KEY);
    expect(s.status()).toMatchObject({ paidUntil: end, standing: 'active' });
    w.clock.advance(3 * DAY);
    expect(s.current().plan).toBe('pro');
    w.clock.advance(2 * DAY);
    expect(s.current().plan).toBe('free');
    expect(s.status().standing).toBe('period_over');
    s.dispose();
  });

  it('an unknown key is "not found" on the device', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: PRODUCTS } });
    const s = await device(w, D0);
    expect(await s.activateKey('NOPE0000-NOPE0000-NOPE0000-NOPE0000')).toMatchObject({ ok: false, code: 'not_found' });
    s.dispose();
  });

  it('the Worker keeps nothing that names the person: no key, no token, no address, no e-mail in storage or logs', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: PRODUCTS }, limits: true });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    const r = await w.call('POST', API.activate, { key: KEY, did: D0 }, { 'CF-Connecting-IP': '203.0.113.77' });
    const token = String((await body(r))['token']);
    const dump = JSON.stringify(['purchases', 'seats', 'reminders', 'meta'].map((t) => w.storage.db.all(`SELECT * FROM ${t}`))) + JSON.stringify(w.logs);
    for (const secret of [KEY, token, '203.0.113.77', 'buyer@example.com']) expect(dump).not.toContain(secret);
  });
});

describe('the Durable Object is restarted by the platform', () => {
  it('forgets nothing: seats, purchases and the address salt are in storage', async () => {
    const w = await makeWorld({ env: { GUMROAD_PRODUCTS: JSON.stringify({ [PRODUCT_PRO_YEARLY]: 'pro-yearly' }) }, limits: true });
    w.gum.add(PRODUCT_PRO_YEARLY, KEY);
    for (const d of [D0, D1, D2]) expect((await w.call('POST', API.activate, { key: KEY, did: d })).status).toBe(200);
    const salt = w.storage.db.one<{ v: string }>(`SELECT v FROM meta WHERE k = 'salt'`)?.v;
    w.restart();
    expect(await body(await w.call('POST', API.activate, { key: KEY, did: D3 }))).toMatchObject({ error: 'limit' });
    expect((await w.call('POST', API.refresh, { key: KEY, did: D1 })).status).toBe(200);
    expect(w.storage.db.one<{ v: string }>(`SELECT v FROM meta WHERE k = 'salt'`)?.v).toBe(salt);
  });
});
