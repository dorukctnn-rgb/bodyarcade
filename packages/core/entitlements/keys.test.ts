import { describe, expect, it } from 'vitest';
import { PUBLIC_KEYS, keysForHost, targetOfHost, type ReleaseTarget } from './keys.ts';
import { generateSigningKeys, importSigningKey, signToken } from './sign.ts';
import { MAX_TOKEN_TTL_S, TOKEN_AUD, TOKEN_ISS, verifyToken, type TokenClaims } from './token.ts';

const TARGETS: ReleaseTarget[] = ['preview', 'production'];

describe('the public keys of the two targets', () => {
  it('are public EC P-256 keys with a name, and carry nothing private', () => {
    for (const t of TARGETS) {
      expect(PUBLIC_KEYS[t].length, t).toBeGreaterThan(0);
      for (const k of PUBLIC_KEYS[t]) {
        expect(k.kid).toMatch(/^[A-Za-z0-9_-]{4,64}$/);
        expect(Object.keys(k.jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
        expect(k.jwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
      }
    }
  });

  it('can really be imported as verification keys', async () => {
    for (const t of TARGETS) {
      for (const { jwk } of PUBLIC_KEYS[t]) {
        await expect(crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])).resolves.toBeTruthy();
      }
    }
  });

  it('differ between preview and production, so a token of one is worthless on the other', () => {
    const kids = TARGETS.flatMap((t) => PUBLIC_KEYS[t].map((k) => k.kid));
    expect(new Set(kids).size).toBe(kids.length);
    const xs = TARGETS.flatMap((t) => PUBLIC_KEYS[t].map((k) => k.jwk.x));
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('do not verify a token that somebody else signed', async () => {
    const other = await generateSigningKeys();
    const nowS = Math.floor(Date.now() / 1000);
    const claims: TokenClaims = { iss: TOKEN_ISS, aud: TOKEN_AUD, sub: 'a'.repeat(64), did: 'b'.repeat(32), plan: 'founder', src: 'gumroad', feat: ['pro'], chk: nowS, iat: nowS, exp: nowS + MAX_TOKEN_TTL_S };
    for (const t of TARGETS) {
      // even when the forger names one of our keys, the signature does not fit
      const token = await signToken(claims, await importSigningKey(other.privateJwk), PUBLIC_KEYS[t][0]?.kid ?? 'x');
      expect((await verifyToken(token, { keys: PUBLIC_KEYS[t], now: Date.now() })).ok, t).toBe(false);
    }
  });
});

describe('which keys a page trusts', () => {
  it.each([
    ['bodyarcade.com', 'production'], ['www.bodyarcade.com', 'production'], ['app.bodyarcade.com', 'production'], ['BodyArcade.com', 'production'], ['bodyarcade.com.', 'production'],
    ['bodyarcade-v2-preview.railer-iot.workers.dev', 'preview'], ['localhost', 'preview'], ['127.0.0.1', 'preview'], ['', 'preview'],
    ['evilbodyarcade.com', 'preview'], ['bodyarcade.com.evil.net', 'preview'], ['bodyarcade.co', 'preview'],
  ] as const)('%s trusts the %s key', (host, target) => {
    expect(targetOfHost(host)).toBe(target);
    expect(keysForHost(host)).toBe(PUBLIC_KEYS[target]);
  });
});
