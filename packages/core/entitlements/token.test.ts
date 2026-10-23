import { beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKeys, importSigningKey, parsePrivateJwk, publicKeyOf, signToken, thumbprint, type PrivateKeyJwk } from './sign.ts';
import { CLOCK_SKEW_S, MAX_TOKEN_TTL_S, TOKEN_AUD, TOKEN_ISS, b64urlDecode, b64urlEncode, readClaims, verifyToken, type TokenClaims, type TokenKey } from './token.ts';

const NOW = Date.UTC(2026, 9, 24, 12);
const nowS = NOW / 1000;
const DID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SUB = 'f'.repeat(64);

let priv: PrivateKeyJwk;
let pub: TokenKey;
let signing: CryptoKey;
let otherPriv: PrivateKeyJwk;
let otherSigning: CryptoKey;
let otherPub: TokenKey;

beforeAll(async () => {
  const a = await generateSigningKeys();
  priv = a.privateJwk; pub = a.publicKey; signing = await importSigningKey(priv);
  const b = await generateSigningKeys();
  otherPriv = b.privateJwk; otherPub = b.publicKey; otherSigning = await importSigningKey(otherPriv);
});

const claims = (over: Partial<TokenClaims> = {}): TokenClaims => ({
  iss: TOKEN_ISS, aud: TOKEN_AUD, sub: SUB, did: DID, plan: 'pro-yearly', src: 'gumroad', feat: ['pro'],
  chk: nowS - 60, iat: nowS - 60, exp: nowS + MAX_TOKEN_TTL_S - 60, ...over,
});

const utf8 = new TextEncoder();
/** A token built by hand, so that a test can put anything into header and payload. */
async function raw(payload: unknown, o: { header?: Record<string, unknown>; key?: CryptoKey } = {}): Promise<string> {
  const header = b64urlEncode(utf8.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: pub.kid, ...o.header })));
  const body = b64urlEncode(utf8.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, o.key ?? signing, utf8.encode(`${header}.${body}`)));
  return `${header}.${body}.${b64urlEncode(sig)}`;
}
const verify = (t: string, over: { now?: number; did?: string | undefined; keys?: TokenKey[] } = {}) =>
  verifyToken(t, { keys: over.keys ?? [pub], now: over.now ?? NOW, ...('did' in over ? { did: over.did as string } : { did: DID }) });

describe('a good token', () => {
  it('verifies and gives back its claims', async () => {
    const t = await signToken(claims({ pe: nowS + 3 * 86_400, test: true }), signing, pub.kid);
    const r = await verify(t);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims).toEqual(claims({ pe: nowS + 3 * 86_400, test: true }));
  });

  it('is three base64url parts with a named ES256 header, and the signature is 64 bytes (r and s)', async () => {
    const t = await signToken(claims(), signing, pub.kid);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [h, , s] = t.split('.') as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h) as Uint8Array))).toEqual({ alg: 'ES256', typ: 'JWT', kid: pub.kid });
    expect(b64urlDecode(s)?.length).toBe(64);
    expect(t.length).toBeLessThan(600);
  });

  it('verifies without a device when none is asked for', async () => {
    const t = await signToken(claims(), signing, pub.kid);
    expect((await verifyToken(t, { keys: [pub], now: NOW })).ok).toBe(true);
  });

  it('names its key: the key list may hold several, so keys can be replaced without breaking tokens in the field', async () => {
    const t = await signToken(claims(), otherSigning, otherPub.kid);
    expect((await verify(t, { keys: [pub, otherPub] })).ok).toBe(true);
    expect((await verify(t, { keys: [pub] })).ok).toBe(false);
  });

  it('thumbprints are stable and short', async () => {
    expect(await thumbprint(pub.jwk)).toBe(pub.kid);
    expect(pub.kid).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(publicKeyOf(priv)).toEqual(pub);
    expect(JSON.stringify(pub)).not.toContain('"d"');
  });
});

describe('what is refused', () => {
  it('a changed payload, header or signature', async () => {
    const t = await signToken(claims(), signing, pub.kid);
    const [h, p, s] = t.split('.') as [string, string, string];
    const forged = b64urlEncode(utf8.encode(JSON.stringify(claims({ plan: 'founder' }))));
    expect((await verify(`${h}.${forged}.${s}`))).toMatchObject({ ok: false, reason: 'signature' });
    expect((await verify(`${b64urlEncode(utf8.encode(JSON.stringify({ alg: 'ES256', kid: pub.kid, x: 1 })))}.${p}.${s}`))).toMatchObject({ ok: false, reason: 'signature' });
    const flipped = s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA');
    expect((await verify(`${h}.${p}.${flipped}`))).toMatchObject({ ok: false, reason: 'signature' });
  });

  it('a token signed by another key under the same name', async () => {
    const t = await signToken(claims(), otherSigning, pub.kid);
    expect(await verify(t)).toMatchObject({ ok: false, reason: 'signature' });
  });

  it('an unknown key name, a missing one, and no keys at all', async () => {
    const t = await signToken(claims(), signing, 'nope');
    expect(await verify(t)).toMatchObject({ ok: false, reason: 'kid' });
    expect(await verify(await raw(claims(), { header: { kid: undefined } }))).toMatchObject({ ok: false, reason: 'kid' });
    expect(await verify(await signToken(claims(), signing, pub.kid), { keys: [] })).toMatchObject({ ok: false, reason: 'kid' });
  });

  it('any algorithm but ES256, including none', async () => {
    for (const alg of ['none', 'HS256', 'RS256', 'es256', 'ES384', '']) {
      expect(await verify(await raw(claims(), { header: { alg } })), alg).toMatchObject({ ok: false, reason: 'alg' });
    }
    expect(await verify(`${b64urlEncode(utf8.encode('{"alg":"none"}'))}.${b64urlEncode(utf8.encode(JSON.stringify(claims())))}.`)).toMatchObject({ ok: false });
  });

  it('a signature that is not r and s of 64 bytes (a DER one, a short one, an empty one)', async () => {
    const t = await signToken(claims(), signing, pub.kid);
    const [h, p] = t.split('.') as [string, string];
    for (const bad of [new Uint8Array(70).fill(7), new Uint8Array(63).fill(7), new Uint8Array(0), new Uint8Array(65).fill(7)]) {
      expect(await verify(`${h}.${p}.${b64urlEncode(bad)}`), String(bad.length)).toMatchObject({ ok: false });
    }
  });

  it('things that are not tokens at all', async () => {
    for (const t of ['', 'a', 'a.b', 'a.b.c.d', '...', 'a.b.c', 'not a token', '😀.😀.😀', 'e30.e30.e30', 'x'.repeat(3000), `${'a'.repeat(1000)}.${'b'.repeat(1000)}.${'c'.repeat(100)}`]) {
      expect((await verify(t)).ok, t.slice(0, 20)).toBe(false);
    }
    expect((await verify(undefined as unknown as string)).ok).toBe(false);
    expect((await verify(42 as unknown as string)).ok).toBe(false);
    expect(await verify(await raw('not json'))).toMatchObject({ ok: false, reason: 'claims' });
    expect(await verify(await raw([claims()]))).toMatchObject({ ok: false, reason: 'claims' });
  });

  it('claims of the wrong kind, even when the signature is good', async () => {
    const bad: [string, Partial<Record<keyof TokenClaims, unknown>>][] = [
      ['plan unknown', { plan: 'enterprise' }], ['plan inherited', { plan: 'toString' }], ['sub short', { sub: 'abc' }], ['sub upper', { sub: 'F'.repeat(64) }],
      ['did short', { did: 'abc' }], ['did upper', { did: DID.toUpperCase() }], ['src', { src: 'paypal' }], ['feat string', { feat: 'pro' }],
      ['feat item', { feat: [1] }], ['feat long', { feat: Array.from({ length: 9 }, () => 'pro') }], ['feat chars', { feat: ['<b>'] }],
      ['exp string', { exp: String(nowS + 100) }], ['exp float', { exp: nowS + 100.5 }], ['iat negative', { iat: -1 }], ['chk missing', { chk: undefined }],
      ['pe string', { pe: 'x' }], ['test string', { test: 'yes' }],
    ];
    for (const [name, over] of bad) expect(await verify(await raw({ ...claims(), ...over })), name).toMatchObject({ ok: false, reason: 'claims' });
    expect(await verify(await raw({ ...claims(), iss: 'someone' }))).toMatchObject({ ok: false, reason: 'issuer' });
    expect(await verify(await raw({ ...claims(), aud: 'other-app' }))).toMatchObject({ ok: false, reason: 'issuer' });
  });

  it('a token for another device', async () => {
    const t = await signToken(claims(), signing, pub.kid);
    expect(await verify(t, { did: '0'.repeat(32) })).toMatchObject({ ok: false, reason: 'wrong_device' });
  });

  it('a token that has run out, and says when', async () => {
    const t = await signToken(claims({ exp: nowS + 10 }), signing, pub.kid);
    expect((await verify(t, { now: NOW + 9_000 })).ok).toBe(true);
    const r = await verify(t, { now: NOW + 10_000 });
    expect(r).toMatchObject({ ok: false, reason: 'expired' });
    expect(r.ok === false && r.claims?.exp).toBe(nowS + 10);                // readable, never trusted
  });

  it('a token issued in the future (a clock that is far off, or a forgery), with a little clock drift allowed', async () => {
    const t = await signToken(claims({ iat: nowS + CLOCK_SKEW_S + 60, exp: nowS + 86_400 }), signing, pub.kid);
    expect(await verify(t)).toMatchObject({ ok: false, reason: 'not_yet_valid' });
    expect((await verify(await signToken(claims({ iat: nowS + CLOCK_SKEW_S - 5, exp: nowS + 86_400 }), signing, pub.kid))).ok).toBe(true);
  });

  it('a token that would live longer than a week, or ends before it begins', async () => {
    expect(await verify(await signToken(claims({ exp: nowS - 60 + MAX_TOKEN_TTL_S + 3600 }), signing, pub.kid))).toMatchObject({ ok: false, reason: 'too_long' });
    expect(await verify(await signToken(claims({ iat: nowS, exp: nowS }), signing, pub.kid))).toMatchObject({ ok: false, reason: 'too_long' });
    expect((await verify(await signToken(claims({ exp: nowS - 60 + MAX_TOKEN_TTL_S }), signing, pub.kid))).ok).toBe(true);
  });

  it('a public key that carries the private part does not make the private part count', async () => {
    const t = await signToken(claims(), signing, pub.kid);
    const withD: TokenKey = { kid: pub.kid, jwk: { ...pub.jwk, d: priv.d } };
    expect((await verify(t, { keys: [withD] })).ok).toBe(true);        // d is dropped before the key is imported
    const wrongCurve: TokenKey = { kid: pub.kid, jwk: { kty: 'EC', crv: 'P-384', x: pub.jwk.x, y: pub.jwk.y } };
    expect(await verify(t, { keys: [wrongCurve] })).toMatchObject({ ok: false });
    expect(await verify(t, { keys: [{ kid: pub.kid, jwk: { kty: 'oct' } }] })).toMatchObject({ ok: false });
  });
});

describe('readClaims and the helpers', () => {
  it('accepts exactly the claims a token may carry', () => {
    expect(readClaims(claims())).toEqual(claims());
    expect(readClaims({ ...claims(), extra: 1 })).toEqual(claims());              // unknown fields are dropped
    expect(readClaims(null)).toBeNull();
    expect(readClaims([])).toBeNull();
  });

  it('base64url round-trips every byte and refuses what is not base64url', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...(b64urlDecode(b64urlEncode(all)) as Uint8Array)]).toEqual([...all]);
    expect(b64urlEncode(new Uint8Array([251, 255, 254]))).toBe('-__-');
    for (const bad of ['a', 'abcde', 'a+b', 'a/b', 'a=b=', ' ', 'é']) expect(b64urlDecode(bad), bad).toBeNull();
    expect(b64urlDecode('')).toEqual(new Uint8Array(0));
  });

  it('reads the secret that holds the private key, and nothing else', () => {
    expect(parsePrivateJwk(JSON.stringify(priv))).toEqual(priv);
    for (const bad of [undefined, null, '', 'x', '{}', JSON.stringify({ ...priv, d: '' }), JSON.stringify({ ...priv, kid: undefined }), JSON.stringify({ ...priv, crv: 'P-384' }), JSON.stringify({ ...priv, kty: 'RSA' }), '[1]']) {
      expect(parsePrivateJwk(bad), String(bad)).toBeNull();
    }
  });
});
