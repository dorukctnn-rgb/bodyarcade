import { describe, expect, it } from 'vitest';
import { MAX_TOKEN_TTL_S, verifyToken, type TokenClaims } from '../../../core/entitlements/token.ts';
import type { PlanId } from '../../../core/entitlements/plans.ts';
import { signToken } from '../../../core/entitlements/sign.ts';
import { RECHECK_S, SEAT_IDLE_S, STALE_GRACE_S, normalizeKey, sha256Hex } from './rules.ts';
import {
  DAY, DIDS, KEYS, LEGACY_LIFETIME, LEGACY_MONTHLY, PRODUCT_FAMILY, PRODUCT_LIFETIME, PRODUCT_PRO_MONTHLY, PRODUCT_PRO_YEARLY,
  makeRig, sqliteDb, type Rig,
} from './testkit.ts';

const iso = (ms: number): string => new Date(ms).toISOString();
const [KEY, KEY2, KEY3] = KEYS;
const [D0, D1, D2, D3, D4, D5, D6] = DIDS as [string, string, string, string, string, string, string, string];

const check = (r: Rig, token: string, did: string) => verifyToken(token, { keys: r.publicKeys, now: r.clock.now(), did });
const claimsOf = async (r: Rig, token: unknown, did: string): Promise<TokenClaims> => {
  const v = await check(r, String(token), did);
  if (!v.ok) throw new Error(`token does not verify: ${v.reason}`);
  return v.claims;
};
const seatsOf = (r: Rig, sub: string): number => r.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM seats WHERE sub = ?1', sub)?.n ?? 0;
const rowOf = (r: Rig, key: string) => sha256Hex(normalizeKey(key)).then((sub) => r.db.one<Record<string, unknown>>('SELECT * FROM purchases WHERE sub = ?1', sub));

describe('a licence key on a device', () => {
  const PLANS: [string, PlanId, number, string[]][] = [
    [PRODUCT_PRO_YEARLY, 'pro-yearly', 3, ['pro']],
    [PRODUCT_PRO_MONTHLY, 'pro-monthly', 3, ['pro']],
    [PRODUCT_LIFETIME, 'lifetime', 3, ['pro']],
    [PRODUCT_FAMILY, 'family-yearly', 4, ['pro', 'family6']],
    [LEGACY_MONTHLY, 'legacy-monthly', 3, ['pro']],
    [LEGACY_LIFETIME, 'founder', 6, ['pro', 'family6']],
  ];

  it.each(PLANS)('gets a signed token for product %s (%s: %i devices)', async (product, plan, limit, feat) => {
    const r = await makeRig();
    r.gum.add(product, KEY as string);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect(res.status).toBe(200);
    expect(res.body['plan']).toBe(plan);
    expect(res.body['devices']).toEqual({ used: 1, limit });
    const c = await claimsOf(r, res.body['token'], D0);
    expect(c).toMatchObject({ plan, src: 'gumroad', did: D0, feat, chk: r.clock.now() / 1000, iat: r.clock.now() / 1000 });
    expect(c.exp - c.iat).toBe(MAX_TOKEN_TTL_S);
    expect(c.sub).toBe(await sha256Hex(normalizeKey(KEY as string)));
    expect(c.pe).toBeUndefined();
  });

  it('is not a token for another device', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY as string);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect((await check(r, String(res.body['token']), D1)).ok).toBe(false);
  });

  it('tries the products in order, and next time asks the product it was found in first', async () => {
    const r = await makeRig();
    r.gum.add(LEGACY_LIFETIME, KEY as string);
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect(r.gum.calls.map((c) => c.productId)).toEqual([PRODUCT_PRO_YEARLY, PRODUCT_PRO_MONTHLY, PRODUCT_LIFETIME, PRODUCT_FAMILY, LEGACY_MONTHLY, LEGACY_LIFETIME]);
    r.gum.calls.length = 0;
    r.clock.advance((RECHECK_S + 1) * 1000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).status).toBe(200);
    expect(r.gum.calls.map((c) => c.productId)).toEqual([LEGACY_LIFETIME]);
  });

  it('is the same purchase typed in lower case or with spaces around it', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY as string);
    const a = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    const b = await r.engine.grantKey({ key: (KEY as string).toLowerCase(), did: D1 }, '');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await claimsOf(r, a.body['token'], D0)).sub).toBe((await claimsOf(r, b.body['token'], D1)).sub);
    expect(r.db.all('SELECT * FROM purchases')).toHaveLength(1);
    expect(b.body['devices']).toEqual({ used: 2, limit: 3 });
  });

  it('keeps only the hash: the key appears nowhere in the database', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '203.0.113.7');
    const dump = JSON.stringify(['purchases', 'seats', 'reminders', 'meta'].map((t) => r.db.all(`SELECT * FROM ${t}`)));
    expect(dump).not.toContain(KEY as string);
    expect(dump.toLowerCase()).not.toContain((KEY as string).toLowerCase());
    expect(dump).not.toContain('203.0.113.7');
    expect(dump).not.toContain('buyer@example.com');
    expect(dump).toContain(await sha256Hex(normalizeKey(KEY as string)));
  });

  it('is not logged either: no log line carries the key, the token or the address', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '203.0.113.7');
    await r.engine.grantKey({ key: KEY2 as string, did: D0 }, '203.0.113.7');
    const text = JSON.stringify(r.logs);
    expect(r.logs.length).toBeGreaterThan(0);
    for (const secret of [KEY as string, KEY2 as string, String(res.body['token']), '203.0.113.7', 'buyer@example.com']) expect(text).not.toContain(secret);
  });

  it('uses an answer from the seller that is younger than ten minutes without asking again', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY as string);
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect(r.gum.calls).toHaveLength(2);                                   // the yearly product does not know the key, the monthly one does
    r.clock.advance(5 * 60_000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D1 }, '')).status).toBe(200);
    expect(r.gum.calls).toHaveLength(2);
    r.clock.advance(6 * 60_000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D1 }, '', 'refresh')).status).toBe(200);
    expect(r.gum.calls).toHaveLength(3);                                   // eleven minutes: asked again, the monthly product only
  });

  it('a cached answer still ends with a paid period that has passed', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY as string, { subscription_cancelled_at: iso(r.clock.now() + 4 * 60_000) });
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).status).toBe(200);
    r.clock.advance(5 * 60_000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).body).toEqual({ error: 'ended' });
  });
});

describe('what the seller says about the purchase', () => {
  it('a cancelled membership gets a token that ends with the paid period', async () => {
    const r = await makeRig();
    const end = r.clock.now() + 5 * DAY;
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY as string, { subscription_cancelled_at: iso(end) });
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect(res.status).toBe(200);
    const c = await claimsOf(r, res.body['token'], D0);
    expect(c.pe).toBe(end / 1000);
    expect(c.exp).toBe(end / 1000);
  });

  it('a membership restarted before its end is an ordinary one again at the next check', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY as string, { subscription_cancelled_at: iso(r.clock.now() + 5 * DAY) });
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    r.gum.purchase(PRODUCT_PRO_MONTHLY, KEY as string)['subscription_cancelled_at'] = null;
    r.clock.advance((RECHECK_S + 1) * 1000);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh');
    const c = await claimsOf(r, res.body['token'], D0);
    expect(c.pe).toBeUndefined();
    expect(c.exp - c.iat).toBe(MAX_TOKEN_TTL_S);
    expect((await rowOf(r, KEY as string))?.['paid_until']).toBeNull();
  });

  it.each(['refunded', 'chargebacked', 'disputed'])('%s ends it for good, with no token', async (field) => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string, { [field]: true });
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'refunded' });
  });

  it('a membership whose end has passed is "ended"', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY as string, { subscription_failed_at: iso(r.clock.now() - DAY) });
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect(res).toMatchObject({ status: 403, body: { error: 'ended' } });
  });

  it('a purchase that was good and is refunded later is refused at the next check, and the refusal is written down', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).status).toBe(200);
    r.gum.purchase(PRODUCT_PRO_YEARLY, KEY as string)['refunded'] = true;
    r.clock.advance((RECHECK_S + 1) * 1000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).body).toEqual({ error: 'refunded' });
    expect((await rowOf(r, KEY as string))?.['status']).toBe('refunded');
    // and it is not "recent" any more, so a restart is noticed
    r.gum.purchase(PRODUCT_PRO_YEARLY, KEY as string)['refunded'] = false;
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).status).toBe(200);
    expect((await rowOf(r, KEY as string))?.['status']).toBe('active');
  });

  it('a key nobody has sold is "not found" after every product has been asked', async () => {
    const r = await makeRig();
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    expect(res).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(r.gum.calls).toHaveLength(6);
    expect(r.db.all('SELECT * FROM purchases')).toHaveLength(0);
  });

  it('a key the seller has turned off is its own refusal: disabled means refunded, expired means ended', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    r.gum.add(PRODUCT_PRO_YEARLY, KEY2 as string);
    r.gum.verdicts.set(KEY as string, 'disabled');
    r.gum.verdicts.set(KEY2 as string, 'expired');
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).body).toEqual({ error: 'refunded' });
    expect((await r.engine.grantKey({ key: KEY2 as string, did: D0 }, '')).body).toEqual({ error: 'ended' });
  });

  it('B2: a purchase we have seen cannot just vanish; "not found" for it is not a refusal', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    r.gum.products.clear();                                                // the seller no longer knows it under any product we ask
    r.clock.advance((RECHECK_S + 1) * 1000);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh');
    expect(res.status).toBe(200);                                          // the stale path: the old check time, not a refusal
    expect((await claimsOf(r, res.body['token'], D0)).chk).toBe((r.clock.now() - (RECHECK_S + 1) * 1000) / 1000);
    expect(r.logs.some((l) => l.evt === 'known_missing')).toBe(true);
    r.clock.advance((STALE_GRACE_S + 1) * 1000);
    expect(await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).toMatchObject({ status: 502, body: { error: 'upstream' } });
  });
});

describe('devices', () => {
  const grant = (r: Rig, key: string, did: string) => r.engine.grantKey({ key, did }, '');

  it('Pro is active on three devices; the fourth is told no, with the numbers', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    for (const [i, d] of [D0, D1, D2].entries()) expect((await grant(r, KEY as string, d)).body['devices']).toEqual({ used: i + 1, limit: 3 });
    const res = await grant(r, KEY as string, D3);
    expect(res).toMatchObject({ status: 409, body: { error: 'limit', devices: { used: 3, limit: 3 } } });
    expect(res.body['token']).toBeUndefined();
  });

  it('a device that already has a seat gets a new token without taking another', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    for (const d of [D0, D1, D2]) await grant(r, KEY as string, d);
    r.clock.advance(2 * DAY);
    const again = await r.engine.grantKey({ key: KEY as string, did: D1 }, '', 'refresh');
    expect(again.status).toBe(200);
    expect(again.body['devices']).toEqual({ used: 3, limit: 3 });
  });

  it('Family has four seats and a Founder six', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_FAMILY, KEY as string);
    r.gum.add(LEGACY_LIFETIME, KEY2 as string);
    const ok = async (key: string, dids: string[]) => Promise.all(dids.map((d) => grant(r, key, d))).then((rs) => rs.map((x) => x.status));
    expect(await ok(KEY as string, [D0, D1, D2, D3])).toEqual([200, 200, 200, 200]);
    expect((await grant(r, KEY as string, D4)).status).toBe(409);
    expect(await ok(KEY2 as string, [D0, D1, D2, D3, D4, D5])).toEqual([200, 200, 200, 200, 200, 200]);
    expect((await grant(r, KEY2 as string, D6)).status).toBe(409);
  });

  it('giving a seat back (deactivate) frees it for another device', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    const tokens: string[] = [];
    for (const d of [D0, D1, D2]) tokens.push(String((await grant(r, KEY as string, d)).body['token']));
    expect((await grant(r, KEY as string, D3)).status).toBe(409);
    expect((await r.engine.deactivate({ token: tokens[1] as string, did: D1 })).body).toEqual({ ok: true });
    expect((await grant(r, KEY as string, D3)).status).toBe(200);
  });

  it('a seat nobody used for 90 days is free again', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    for (const d of [D0, D1, D2]) await grant(r, KEY as string, d);
    r.clock.advance((SEAT_IDLE_S - 3600) * 1000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).status).toBe(200);       // D0 is in use, D1 and D2 are not
    r.clock.advance(7200 * 1000);
    expect((await grant(r, KEY as string, D3)).status).toBe(200);
    expect(seatsOf(r, await sha256Hex(normalizeKey(KEY as string)))).toBe(2);                                // D0 and D3
  });

  it('two requests for the last seat at the same moment: exactly one gets it', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    await grant(r, KEY as string, D0);
    await grant(r, KEY as string, D1);
    r.clock.advance((RECHECK_S + 1) * 1000);                               // the seller is asked again, so both requests wait for it
    r.gum.hook = async () => { await new Promise((res) => setTimeout(res, 5)); };
    const [a, b] = await Promise.all([grant(r, KEY as string, D2), grant(r, KEY as string, D3)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(seatsOf(r, await sha256Hex(normalizeKey(KEY as string)))).toBe(3);
  });

  it('a refused purchase takes no seat', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string, { refunded: true });
    await grant(r, KEY as string, D0);
    expect(r.db.all('SELECT * FROM seats')).toHaveLength(0);
  });

  describe('deactivate', () => {
    it('is not done with a token of another device, a token that is not ours, or nothing', async () => {
      const r = await makeRig();
      r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
      const t0 = String((await grant(r, KEY as string, D0)).body['token']);
      expect((await r.engine.deactivate({ token: t0, did: D1 })).status).toBe(400);
      expect((await r.engine.deactivate({ token: `${t0.slice(0, -4)}AAAA`, did: D0 })).status).toBe(400);
      expect((await r.engine.deactivate({ token: 'x'.repeat(40), did: D0 })).status).toBe(400);
      expect(r.db.all('SELECT * FROM seats')).toHaveLength(1);
    });

    it('works with a token that has run out (a device that was off for a month still gives its seat back)', async () => {
      const r = await makeRig();
      r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
      const t0 = String((await grant(r, KEY as string, D0)).body['token']);
      r.clock.advance(30 * DAY);
      expect((await r.engine.deactivate({ token: t0, did: D0 })).status).toBe(200);
      expect(r.db.all('SELECT * FROM seats')).toHaveLength(0);
    });

    it('twice is fine', async () => {
      const r = await makeRig();
      r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
      const t0 = String((await grant(r, KEY as string, D0)).body['token']);
      expect((await r.engine.deactivate({ token: t0, did: D0 })).status).toBe(200);
      expect((await r.engine.deactivate({ token: t0, did: D0 })).status).toBe(200);
    });
  });

  describe('reset', () => {
    it('gives every other seat back and keeps the one asking', async () => {
      const r = await makeRig();
      r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
      for (const d of [D0, D1, D2]) await grant(r, KEY as string, d);
      const res = await r.engine.reset({ did: D1, key: KEY as string }, '');
      expect(res).toMatchObject({ status: 200, body: { ok: true, removed: 2 } });
      expect(r.db.all<{ did: string }>('SELECT did FROM seats').map((s) => s.did)).toEqual([D1]);
    });

    it('needs the key: an unknown one is "not found" and nothing is removed', async () => {
      const r = await makeRig();
      r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
      await grant(r, KEY as string, D0);
      expect((await r.engine.reset({ did: D1, key: KEY2 as string }, '')).status).toBe(404);
      expect(r.db.all('SELECT * FROM seats')).toHaveLength(1);
    });

    it('is allowed three times a day for one purchase (a shared key cannot be used to throw each other out all day)', async () => {
      const r = await makeRig({ noLimits: false });
      r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
      await grant(r, KEY as string, D0);
      for (let i = 0; i < 3; i++) expect((await r.engine.reset({ did: D0, key: KEY as string }, `10.0.0.${i}`)).status).toBe(200);
      const fourth = await r.engine.reset({ did: D0, key: KEY as string }, '10.0.0.9');
      expect(fourth.status).toBe(429);
      expect(Number(fourth.headers?.['Retry-After'])).toBeGreaterThan(0);
      r.clock.advance(DAY + 1000);
      expect((await r.engine.reset({ did: D0, key: KEY as string }, '10.0.0.9')).status).toBe(200);
    });
  });
});

describe('B2: a seller that cannot answer never takes Pro away', () => {
  it('a first activation while Gumroad is down is "try later" (502), not "not found"', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    r.gum.fault = 'down';
    expect(await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).toMatchObject({ status: 502, body: { error: 'upstream' } });
  });

  it('a purchase checked recently still gets a token while Gumroad is down, with the old check time and a shorter life', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    const first = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    const t1 = r.clock.now();
    r.gum.fault = 'down';
    r.clock.advance(10 * DAY);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh');
    expect(res.status).toBe(200);
    const c = await claimsOf(r, res.body['token'], D0);
    expect(c.chk).toBe(t1 / 1000);
    expect(c.iat).toBe(r.clock.now() / 1000);
    expect(c.exp).toBe(t1 / 1000 + STALE_GRACE_S);                         // four days, not seven
    expect(first.status).toBe(200);
    r.clock.advance(5 * DAY);
    expect(await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).toMatchObject({ status: 502, body: { error: 'upstream' } });
  });

  it('the stale path also respects the seats and the end of a paid period', async () => {
    const r = await makeRig();
    const end = r.clock.now() + 3 * DAY;
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string, { subscription_cancelled_at: iso(end) });
    for (const d of [D0, D1, D2]) await r.engine.grantKey({ key: KEY as string, did: d }, '');
    r.gum.fault = 'down';
    r.clock.advance(DAY);
    expect((await r.engine.grantKey({ key: KEY as string, did: D3 }, '')).status).toBe(409);           // no fourth device because Gumroad is down
    const res = await r.engine.grantKey({ key: KEY as string, did: D1 }, '', 'refresh');
    expect((await claimsOf(r, res.body['token'], D1)).exp).toBe(end / 1000);
    r.clock.advance(3 * DAY);
    expect((await r.engine.grantKey({ key: KEY as string, did: D1 }, '', 'refresh')).status).toBe(502);  // the paid period is over: nothing to extend
  });

  it('after a failed call the seller is left alone for a minute', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    r.gum.fault = 'down';
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    await r.engine.grantKey({ key: KEY as string, did: D1 }, '');
    expect(r.gum.calls).toHaveLength(1);
    r.clock.advance(61_000);
    await r.engine.grantKey({ key: KEY as string, did: D1 }, '');
    expect(r.gum.calls).toHaveLength(2);
  });
});

describe('a free trial', () => {
  it('is in the token while it runs: a yearly purchase that began less than seven days ago', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string, { sale_timestamp: iso(r.clock.now() - 2 * DAY) });
    const c = await claimsOf(r, (await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).body['token'], D0);
    expect(c.tr).toBe((r.clock.now() - 2 * DAY) / 1000 + 7 * 86_400);
  });

  it('is not claimed for a purchase that began longer ago, or for plans that have none', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string, { sale_timestamp: iso(r.clock.now() - 8 * DAY) });
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY2 as string);
    r.gum.add(PRODUCT_LIFETIME, KEY3 as string);
    for (const [k, d] of [[KEY, D0], [KEY2, D1], [KEY3, D2]] as const) {
      expect((await claimsOf(r, (await r.engine.grantKey({ key: k, did: d }, '')).body['token'], d)).tr, k).toBeUndefined();
    }
  });

  it('is remembered, and ends with the claim when the week is over', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    const a = await claimsOf(r, (await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).body['token'], D0);
    expect(a.tr).toBe(r.clock.now() / 1000 + 7 * 86_400);
    r.clock.advance(5 * DAY);
    const b = await claimsOf(r, (await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).body['token'], D0);
    expect(b.tr).toBe(a.tr);
    r.clock.advance(3 * DAY);
    const c = await claimsOf(r, (await r.engine.grantKey({ key: KEY as string, did: D0 }, '', 'refresh')).body['token'], D0);
    expect(c.tr).toBeUndefined();
  });

  it('a trial that was cancelled still says when it ends, and the token ends there too', async () => {
    const r = await makeRig();
    const end = r.clock.now() + 4 * DAY;
    r.gum.add(PRODUCT_FAMILY, KEY as string, { subscription_cancelled_at: iso(end) });
    const c = await claimsOf(r, (await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).body['token'], D0);
    expect(c).toMatchObject({ pe: end / 1000, exp: end / 1000, plan: 'family-yearly' });
    expect(c.tr).toBe(r.clock.now() / 1000 + 7 * 86_400);
  });
});

describe('limits per address', () => {
  it('sixty grants in ten minutes, then "rate_limited" with the seconds to wait; another address is not affected', async () => {
    const r = await makeRig({ noLimits: false });
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    for (let i = 0; i < 60; i++) expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '198.51.100.1')).status).toBe(200);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '198.51.100.1');
    expect(res.status).toBe(429);
    expect(res.body['error']).toBe('rate_limited');
    expect(Number(res.headers?.['Retry-After'])).toBeGreaterThan(0);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '198.51.100.2')).status).toBe(200);
    r.clock.advance(601_000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '198.51.100.1')).status).toBe(200);
  });

  it('guessing keys is stopped after twelve misses in ten minutes, before the seller is asked again', async () => {
    const r = await makeRig({ noLimits: false });
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    r.gum.add(PRODUCT_PRO_YEARLY, KEY2 as string);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '198.51.100.1')).status).toBe(200);
    for (let i = 0; i < 12; i++) expect((await r.engine.grantKey({ key: `GUESS${String(i).padStart(3, '0')}-AAAA`, did: D0 }, '198.51.100.1')).status).toBe(404);
    const calls = r.gum.calls.length;
    expect((await r.engine.grantKey({ key: 'GUESS999-AAAA', did: D0 }, '198.51.100.1')).status).toBe(429);
    expect(r.gum.calls).toHaveLength(calls);
    // a key this server already knows is not a guess, and still works from the same address; a key it has never seen waits
    r.clock.advance(60_000);
    expect((await r.engine.grantKey({ key: KEY as string, did: D0 }, '198.51.100.1', 'refresh')).status).toBe(200);
    expect((await r.engine.grantKey({ key: KEY2 as string, did: D0 }, '198.51.100.1')).status).toBe(429);
    expect((await r.engine.grantKey({ key: KEY2 as string, did: D0 }, '198.51.100.2')).status).toBe(200);
    r.clock.advance(601_000);
    expect((await r.engine.grantKey({ key: KEY2 as string, did: D1 }, '198.51.100.1')).status).toBe(200);
  });

  it('keeps the address only as a salted hash', async () => {
    const r = await makeRig({ noLimits: false });
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '198.51.100.1');
    expect(JSON.stringify(r.db.all('SELECT * FROM meta'))).not.toContain('198.51.100.1');
  });
});

describe('what is not configured', () => {
  it('without a signing key nothing is granted: 503 "unavailable"', async () => {
    const r = await makeRig({ signer: false });
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    expect(await r.engine.grantKey({ key: KEY as string, did: D0 }, '')).toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(r.gum.calls).toHaveLength(0);
  });

  it('keys() lists only public keys', async () => {
    const r = await makeRig();
    const res = r.engine.keys();
    expect(res.status).toBe(200);
    const body = res.body as { keys: { kid: string; jwk: Record<string, unknown> }[]; reminders: boolean };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]?.kid).toBe(r.keys.pub.kid);
    expect(Object.keys(body.keys[0]?.jwk ?? {}).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(body.reminders).toBe(true);
    expect((await makeRig({ mail: false })).engine.keys().body['reminders']).toBe(false);
  });
});

describe('a token that was signed by someone else', () => {
  it('is never produced: the signature is checked by the app with our key only', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    const res = await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    const c = await claimsOf(r, res.body['token'], D0);
    const other = await (await import('../../../core/entitlements/testkit.ts')).makeKeys();
    const forged = await signToken(c, other.signing, r.keys.pub.kid);
    expect((await check(r, forged, D0)).ok).toBe(false);
  });
});

describe('housekeeping', () => {
  it('sweep frees seats unused for 90 days and forgets old ended purchases that have no seat', async () => {
    const r = await makeRig();
    r.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    r.gum.add(PRODUCT_PRO_MONTHLY, KEY3 as string);
    await r.engine.grantKey({ key: KEY as string, did: D0 }, '');
    const t1 = String((await r.engine.grantKey({ key: KEY3 as string, did: D1 }, '')).body['token']);
    r.gum.purchase(PRODUCT_PRO_MONTHLY, KEY3 as string)['refunded'] = true;
    r.clock.advance((RECHECK_S + 1) * 1000);
    expect((await r.engine.grantKey({ key: KEY3 as string, did: D1 }, '', 'refresh')).body).toEqual({ error: 'refunded' });
    expect((await r.engine.deactivate({ token: t1, did: D1 })).status).toBe(200);        // the second device gives its seat back
    r.clock.advance(181 * DAY);
    const report = await r.engine.sweep();
    expect(report.seatsFreed).toBe(1);                                                    // D0 did not come back for 181 days
    expect(report.purchasesForgotten).toBe(1);                                            // the refunded one has no seat and is old
    expect(r.db.all('SELECT * FROM seats')).toHaveLength(0);
    expect(r.db.all<{ status: string }>('SELECT status FROM purchases').map((p) => p.status)).toEqual(['active']);
  });

  it('an old ended purchase that still has a recently used seat is kept', async () => {
    const r = await makeRig();
    const nowS = r.clock.now() / 1000;
    r.db.run(`INSERT INTO purchases (sub, src, plan, product, status, paid_until, checked_at, first_seen, started_at, trial_end, test)
              VALUES ('s1', 'gumroad', 'pro-monthly', 'P', 'ended', NULL, ?1, ?1, NULL, NULL, 0)`, nowS - 200 * 86_400);
    r.db.run(`INSERT INTO seats (sub, did, first_at, last_at) VALUES ('s1', ?1, ?2, ?3)`, D0, nowS - 200 * 86_400, nowS - 86_400);
    const report = await r.engine.sweep();
    expect(report).toMatchObject({ seatsFreed: 0, purchasesForgotten: 0 });
    expect(r.db.all('SELECT * FROM purchases')).toHaveLength(1);
  });

  it('works without a mail service and with nothing to do', async () => {
    const r = await makeRig({ mail: false });
    expect(await r.engine.sweep()).toEqual({ seatsFreed: 0, purchasesForgotten: 0, remindersSent: 0, remindersDropped: 0, remindersRetried: 0 });
  });
});

describe('the database', () => {
  it('can be opened twice: the tables are made once and a second start changes nothing', async () => {
    const db = sqliteDb();
    const a = await makeRig({ db });
    a.gum.add(PRODUCT_PRO_YEARLY, KEY as string);
    await a.engine.grantKey({ key: KEY as string, did: D0 }, '');
    const b = await makeRig({ db, keys: a.keys, clock: a.clock });
    expect(b.db.all('SELECT * FROM purchases')).toHaveLength(1);
    expect(b.db.one<{ v: string }>(`SELECT v FROM meta WHERE k = 'schema'`)?.v).toBe('1');
  });
});
