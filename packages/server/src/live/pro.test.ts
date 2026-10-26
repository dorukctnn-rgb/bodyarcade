// The Pro check of live play: what the Worker makes of the token a player sends. A genuine token is believed until its own end;
// nothing else is: not a flag, not a token that was made up, cut, re-signed with another key, changed after signing, run out,
// from the future, or for a plan that is not Pro.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { b64urlEncode } from '../../../core/entitlements/token.ts';
import { generateSigningKeys } from '../../../core/entitlements/sign.ts';
import { NO_PRO, proKeys, resetProKeys, verifyProProof } from './pro.ts';
import { DAY_S, makeProKit, type ProKit } from './prokit.ts';

const NOW = Date.UTC(2026, 9, 24, 12);
const nowS = NOW / 1000;
let kit: ProKit;
let other: ProKit;

beforeAll(async () => { kit = await makeProKit(); other = await makeProKit(); });
beforeEach(() => { resetProKeys(); });

describe('a genuine Pro token', () => {
  it('is believed until its own end', async () => {
    const t = await kit.mint({}, NOW);
    expect(await verifyProProof(kit.env, t, NOW)).toEqual({ ok: true, until: (nowS + 3 * DAY_S) * 1000 });
  });

  it('is believed for every plan that is sold or was sold (all of them carry pro)', async () => {
    for (const [plan, feat] of [['pro-monthly', ['pro']], ['pro-yearly', ['pro']], ['family-yearly', ['pro', 'family6']], ['lifetime', ['pro']], ['legacy-monthly', ['pro']], ['founder', ['pro', 'family6']]] as const) {
      const t = await kit.mint({ plan, feat: [...feat] }, NOW);
      expect((await verifyProProof(kit.env, t, NOW)).ok, plan).toBe(true);
    }
  });

  it('stops being believed the moment it runs out', async () => {
    const t = await kit.mint({ iat: nowS - 3600, exp: nowS + 600 }, NOW);
    expect((await verifyProProof(kit.env, t, NOW)).ok).toBe(true);
    expect(await verifyProProof(kit.env, t, NOW + 601_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('is believed with the older key of a rotation (ENT_PUB_JWKS) and not without it', async () => {
    const old = await makeProKit();
    const t = await old.mint({}, NOW);
    const env = { ...kit.env, ENT_PUB_JWKS: JSON.stringify([old.publicKey]) };
    expect((await verifyProProof(env, t, NOW)).ok).toBe(true);
    expect(await verifyProProof(kit.env, t, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('is checked with the public half only: a key set made of ENT_PUB_JWKS alone works, and the private part of a listed key is never used', async () => {
    const t = await kit.mint({}, NOW);
    expect((await verifyProProof({ ENT_PRIV_JWK: '', ENT_PUB_JWKS: JSON.stringify([kit.publicKey]) }, t, NOW)).ok).toBe(true);
    const leaked = JSON.stringify([{ kid: kit.publicKey.kid, jwk: kit.privateJwk }]);
    const keys = proKeys({ ENT_PUB_JWKS: leaked });
    expect(keys).toHaveLength(1);
    expect(JSON.stringify(keys)).not.toContain(kit.privateJwk.d as string);
  });
});

describe('what is not believed', () => {
  it('no token at all is "none", whatever else is in the request', async () => {
    for (const x of [undefined, null, '']) expect(await verifyProProof(kit.env, x, NOW)).toEqual(NO_PRO);
    expect(NO_PRO).toEqual({ ok: false, reason: 'none' });
  });

  it('a flag or anything that is not a token text is "invalid"', async () => {
    for (const x of [true, 1, { pro: true }, ['x'], 'true', 'pro', 'a.b.c', 'a.b', '....', ' ', 'x'.repeat(5000)]) {
      expect(await verifyProProof(kit.env, x, NOW), JSON.stringify(x).slice(0, 30)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('a token signed with a key this Worker does not know is "invalid", also when it names the right key', async () => {
    const t = await other.mint({}, NOW);
    expect(await verifyProProof(kit.env, t, NOW)).toEqual({ ok: false, reason: 'invalid' });
    const [h, p, s] = t.split('.') as [string, string, string];
    const header = JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    const named = `${b64urlEncode(new TextEncoder().encode(JSON.stringify({ ...header, kid: kit.publicKey.kid })))}.${p}.${s}`;
    expect(await verifyProProof(kit.env, named, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a genuine token that was changed after signing is "invalid" (the plan, the end date, one letter of the signature)', async () => {
    const t = await kit.mint({ plan: 'pro-monthly', exp: nowS + 600, iat: nowS - 60 }, NOW);
    const [h, p, s] = t.split('.') as [string, string, string];
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    const reissue = (over: Record<string, unknown>): string => `${h}.${b64urlEncode(new TextEncoder().encode(JSON.stringify({ ...payload, ...over })))}.${s}`;
    expect(await verifyProProof(kit.env, reissue({ plan: 'lifetime' }), NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifyProProof(kit.env, reissue({ exp: nowS + 6 * DAY_S }), NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifyProProof(kit.env, reissue({ feat: ['pro', 'family6'] }), NOW)).toEqual({ ok: false, reason: 'invalid' });
    const flipped = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(await verifyProProof(kit.env, flipped, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect((await verifyProProof(kit.env, t, NOW)).ok).toBe(true);
  });

  it('a token with the signature taken off, or an "alg none" header, is "invalid"', async () => {
    const t = await kit.mint({}, NOW);
    const [h, p] = t.split('.') as [string, string, string];
    const none = `${b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'none', typ: 'JWT', kid: kit.publicKey.kid })))}.${p}.`;
    for (const x of [`${h}.${p}.`, `${h}.${p}`, none]) expect(await verifyProProof(kit.env, x, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('an expired token is "expired" (the app renews it when it is online), also long after', async () => {
    const t = await kit.mint({ iat: nowS - 5 * DAY_S, exp: nowS - 2 * DAY_S }, NOW);
    expect(await verifyProProof(kit.env, t, NOW)).toEqual({ ok: false, reason: 'expired' });
    expect(await verifyProProof(kit.env, t, NOW - 3 * DAY_S * 1000)).toEqual({ ok: true, until: (nowS - 2 * DAY_S) * 1000 });
  });

  it('a token issued in the future, or one that lives longer than seven days, is "invalid"', async () => {
    expect(await verifyProProof(kit.env, await kit.mint({ iat: nowS + 3600, exp: nowS + 2 * DAY_S }, NOW), NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifyProProof(kit.env, await kit.mint({ iat: nowS - 60, exp: nowS + 30 * DAY_S }, NOW), NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a token that does not carry pro opens nothing', async () => {
    for (const feat of [[], ['family6'], ['x']]) {
      expect(await verifyProProof(kit.env, await kit.mint({ feat }, NOW), NOW), JSON.stringify(feat)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('without a key on the Worker no token is believed (and it is said once in the log, never the key)', async () => {
    const t = await kit.mint({}, NOW);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      for (const env of [{}, { ENT_PRIV_JWK: '' }, { ENT_PRIV_JWK: 'not json' }, { ENT_PRIV_JWK: JSON.stringify({ kty: 'EC' }) }, { ENT_PUB_JWKS: '[]' }, { ENT_PUB_JWKS: 'nope' }]) {
        expect(await verifyProProof(env, t, NOW), JSON.stringify(env)).toEqual({ ok: false, reason: 'invalid' });
      }
      expect(log.mock.calls.filter((c) => String(c[0]).includes('pro_no_keys'))).toHaveLength(1);
      expect(log.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain(kit.privateJwk.d as string);
    } finally { log.mockRestore(); }
  });

  it('a new key on the Worker is picked up at once (the key set follows the settings, not the first call)', async () => {
    const t = await other.mint({}, NOW);
    expect((await verifyProProof(kit.env, t, NOW)).ok).toBe(false);
    expect((await verifyProProof(other.env, t, NOW)).ok).toBe(true);
    expect((await verifyProProof(kit.env, t, NOW)).ok).toBe(false);
    const fresh = await generateSigningKeys();
    expect(proKeys({ ENT_PRIV_JWK: JSON.stringify(fresh.privateJwk) })[0]?.kid).toBe(fresh.publicKey.kid);
  });
});
