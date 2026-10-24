// Google Play purchases through the engine: what each answer of Google means for the device, the acknowledgement Play
// demands, several purchases at once, and the same B2 rule as Gumroad (a Google that cannot answer takes nothing away).
import { describe, expect, it } from 'vitest';
import type { PlayPurchaseRef } from '../../../core/entitlements/api.ts';
import { MAX_TOKEN_TTL_S, verifyToken, type TokenClaims } from '../../../core/entitlements/token.ts';
import { STALE_GRACE_S, sha256Hex } from './rules.ts';
import { DAY, DIDS, makeRig, type Rig } from './testkit.ts';
import type { PlayCheck } from './upstream/play.ts';

const [D0, D1, D2, D3, D4] = DIDS as [string, string, string, string, string, string, string, string];
const TOKEN_A = 'a'.repeat(40);
const TOKEN_B = 'b'.repeat(40);
const TOKEN_C = 'c'.repeat(40);
const YEARLY: PlayPurchaseRef = { productId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN_A };
const MONTHLY: PlayPurchaseRef = { productId: 'bodyarcade_pro_monthly', purchaseToken: TOKEN_B };
const LIFETIME: PlayPurchaseRef = { productId: 'bodyarcade_lifetime', purchaseToken: TOKEN_C };

const active = (over: Partial<Extract<PlayCheck, { kind: 'active' }>> = {}): PlayCheck => ({ kind: 'active', expiry: null, startedAt: null, cancelled: false, acknowledged: true, test: false, ...over });

const claimsOf = async (r: Rig, token: unknown, did: string): Promise<TokenClaims> => {
  const v = await verifyToken(String(token), { keys: r.publicKeys, now: r.clock.now(), did });
  if (!v.ok) throw new Error(`token does not verify: ${v.reason}`);
  return v.claims;
};
const grant = (r: Rig, purchases: PlayPurchaseRef[], did = D0) => r.engine.grantPlay({ did, purchases }, '');

describe('a Play purchase on a device', () => {
  it('gets a token for the plan Google reports, named by the hash of the purchase token', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active({ expiry: r.clock.now() / 1000 + 365 * 86_400, startedAt: r.clock.now() / 1000 - 40 * 86_400 }));
    const res = await grant(r, [YEARLY]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: 'pro-yearly', devices: { used: 1, limit: 3 } });
    const c = await claimsOf(r, res.body['token'], D0);
    expect(c).toMatchObject({ plan: 'pro-yearly', src: 'play', did: D0, feat: ['pro'] });
    expect(c.sub).toBe(await sha256Hex(TOKEN_A));
    expect(c.exp - c.iat).toBe(MAX_TOKEN_TTL_S);
    expect(c.pe).toBeUndefined();
    expect(c.test).toBeUndefined();
  });

  it('keeps only the hash of the purchase token', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    await grant(r, [YEARLY]);
    const dump = JSON.stringify(['purchases', 'seats', 'reminders', 'meta'].map((t) => r.db.all(`SELECT * FROM ${t}`))) + JSON.stringify(r.logs);
    expect(dump).not.toContain(TOKEN_A);
    expect(dump).toContain(await sha256Hex(TOKEN_A));
  });

  it('is the one-time Lifetime product, with no end', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_C, active());
    const res = await grant(r, [LIFETIME]);
    expect(res.body['plan']).toBe('lifetime');
    expect((await claimsOf(r, res.body['token'], D0)).pe).toBeUndefined();
  });

  it('a subscription the buyer cancelled works until the period Google says is paid', async () => {
    const r = await makeRig();
    const end = r.clock.now() / 1000 + 5 * 86_400;
    r.play.set(TOKEN_B, active({ expiry: end, cancelled: true }));
    const c = await claimsOf(r, (await grant(r, [MONTHLY])).body['token'], D0);
    expect(c.pe).toBe(end);
    expect(c.exp).toBe(end);
  });

  it('a purchase flagged as a licence-test purchase says so in the token', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_B, active({ test: true }));
    expect((await claimsOf(r, (await grant(r, [MONTHLY])).body['token'], D0)).test).toBe(true);
  });

  it('is told to Google as delivered when Google does not know it yet, and only then', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active({ acknowledged: false }));
    r.play.set(TOKEN_B, active({ acknowledged: true }));
    await grant(r, [YEARLY, MONTHLY]);
    expect(r.play.acks).toEqual([{ productId: 'bodyarcade_pro_yearly', token: TOKEN_A }]);
  });

  it('is still granted when the acknowledgement fails (the next check tries again)', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active({ acknowledged: false }));
    r.play.ackFails = true;
    expect((await grant(r, [YEARLY])).status).toBe(200);
    expect(r.logs.some((l) => l.evt === 'ack_failed')).toBe(true);
  });

  it('uses an answer from Google that is younger than ten minutes, without asking again', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    await grant(r, [YEARLY], D0);
    await grant(r, [YEARLY], D1);
    expect(r.play.checks).toHaveLength(1);
    r.clock.advance(11 * 60_000);
    await grant(r, [YEARLY], D1);
    expect(r.play.checks).toHaveLength(2);
  });
});

describe('what Google says that is a no', () => {
  it.each([
    ['ended', 403, 'ended'], ['refunded', 403, 'refunded'], ['not_found', 404, 'not_found'],
  ] as const)('%s is %i %s', async (code, status, error) => {
    const r = await makeRig();
    r.play.set(TOKEN_A, { kind: 'refused', code });
    const res = await grant(r, [YEARLY]);
    expect(res).toMatchObject({ status, body: { error } });
    expect(r.db.all('SELECT * FROM seats')).toHaveLength(0);
  });

  it('a purchase that is bought but not paid yet is neither granted nor refused for good', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, { kind: 'pending' });
    expect(await grant(r, [YEARLY])).toMatchObject({ status: 404, body: { error: 'not_found', pending: true } });
  });

  it('an ended subscription that was good before is refused at the next check, and written down', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    await grant(r, [YEARLY]);
    r.play.set(TOKEN_A, { kind: 'refused', code: 'ended' });
    r.clock.advance(11 * 60_000);
    expect((await grant(r, [YEARLY])).body).toEqual({ error: 'ended' });
    expect(r.db.one<{ status: string }>('SELECT status FROM purchases')?.status).toBe('ended');
  });

  it('with several purchases, the clearest refusal is told: ended before refunded before not found', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, { kind: 'refused', code: 'refunded' });
    r.play.set(TOKEN_B, { kind: 'refused', code: 'ended' });
    expect((await grant(r, [YEARLY, MONTHLY])).body).toEqual({ error: 'ended' });
    expect((await grant(r, [YEARLY, LIFETIME])).body).toEqual({ error: 'refunded' });
  });

  it('B2: a purchase Google is said to have no record of, which we have seen before, is not a refusal', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    await grant(r, [YEARLY]);
    r.play.purchases.delete(TOKEN_A);                                       // a wrong package name looks like this too
    r.clock.advance(11 * 60_000);
    const res = await grant(r, [YEARLY]);
    expect(res.status).toBe(200);
    expect(r.logs.some((l) => l.evt === 'known_missing')).toBe(true);
    r.clock.advance((STALE_GRACE_S + 1) * 1000);
    expect((await grant(r, [YEARLY])).status).toBe(502);
  });

  it('a purchase nobody has seen and Google does not know is "not found"', async () => {
    const r = await makeRig();
    expect((await grant(r, [YEARLY])).body).toEqual({ error: 'not_found' });
  });
});

describe('B2: a Google that cannot answer', () => {
  it('is "try later" for a first purchase, never a refusal', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    r.play.down = true;
    expect(await grant(r, [YEARLY])).toMatchObject({ status: 502, body: { error: 'upstream' } });
  });

  it('still gives a token for a purchase checked within two weeks, with the old check time', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    await grant(r, [YEARLY]);
    const t1 = r.clock.now();
    r.play.down = true;
    r.clock.advance(5 * DAY);
    const res = await grant(r, [YEARLY]);
    expect(res.status).toBe(200);
    expect((await claimsOf(r, res.body['token'], D0)).chk).toBe(t1 / 1000);
    r.clock.advance(10 * DAY);
    expect((await grant(r, [YEARLY])).status).toBe(502);
  });

  it('does not ask again for a minute after a failure', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    r.play.down = true;
    await grant(r, [YEARLY]);
    await grant(r, [YEARLY], D1);
    expect(r.play.checks).toHaveLength(1);
  });

  it('a good purchase is granted even when another one in the list cannot be checked', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_B, active());
    r.play.set(TOKEN_A, { kind: 'unreadable', outage: false });          // a subscription state this code does not know: no verdict, and no outage
    const res = await grant(r, [YEARLY, MONTHLY]);
    expect(res.status).toBe(200);
    expect(res.body['plan']).toBe('pro-monthly');
  });
});

describe('several purchases of one Google account', () => {
  it('the best plan is the one given', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    r.play.set(TOKEN_B, active());
    r.play.set(TOKEN_C, active());
    expect((await grant(r, [MONTHLY, YEARLY, LIFETIME])).body['plan']).toBe('lifetime');
    expect((await grant(r, [MONTHLY, YEARLY], D1)).body['plan']).toBe('pro-yearly');
  });

  it('writes down all of them, so each is known at the next check', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active());
    r.play.set(TOKEN_B, active());
    await grant(r, [YEARLY, MONTHLY]);
    expect(r.db.all('SELECT sub FROM purchases')).toHaveLength(2);
    expect(r.db.all('SELECT sub FROM seats')).toHaveLength(1);              // one seat, on the best one
  });

  it('a lesser purchase with a free seat is used when the best one has none left', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_C, active());
    r.play.set(TOKEN_B, active());
    for (const d of [D0, D1, D2]) expect((await grant(r, [LIFETIME], d)).body['plan']).toBe('lifetime');
    const res = await grant(r, [LIFETIME, MONTHLY], D3);
    expect(res.status).toBe(200);
    expect(res.body['plan']).toBe('pro-monthly');
    const full = await grant(r, [LIFETIME], D4);
    expect(full).toMatchObject({ status: 409, body: { error: 'limit' } });
  });
});

describe('a free trial on Google Play', () => {
  const now = (r: Rig): number => r.clock.now() / 1000;

  it('is the first period of a yearly subscription that has not ended yet', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active({ startedAt: now(r) - 86_400, expiry: now(r) - 86_400 + 7 * 86_400 }));
    const c = await claimsOf(r, (await grant(r, [YEARLY])).body['token'], D0);
    expect(c.tr).toBe(now(r) - 86_400 + 7 * 86_400);
  });

  it('is not claimed for a year-long first period (no trial was taken), for a monthly plan, or for a trial that is over', async () => {
    const r = await makeRig();
    r.play.set(TOKEN_A, active({ startedAt: now(r) - 86_400, expiry: now(r) + 364 * 86_400 }));
    r.play.set(TOKEN_B, active({ startedAt: now(r) - 86_400, expiry: now(r) + 6 * 86_400 }));
    expect((await claimsOf(r, (await grant(r, [YEARLY])).body['token'], D0)).tr).toBeUndefined();
    expect((await claimsOf(r, (await grant(r, [MONTHLY])).body['token'], D0)).tr).toBeUndefined();
  });

  it('a trial the buyer cancelled still ends where Google says, and the token ends there too', async () => {
    const r = await makeRig();
    const end = now(r) + 3 * 86_400;
    r.play.set(TOKEN_A, active({ startedAt: now(r) - 4 * 86_400, expiry: end, cancelled: true }));
    const c = await claimsOf(r, (await grant(r, [YEARLY])).body['token'], D0);
    expect(c).toMatchObject({ tr: end, pe: end, exp: end });
  });
});

describe('what is not configured', () => {
  it('without Google access, Play purchases are "unavailable" (and nothing is asked)', async () => {
    const r = await makeRig({ play: false });
    expect(await grant(r, [YEARLY])).toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(r.play.checks).toHaveLength(0);
  });
});
