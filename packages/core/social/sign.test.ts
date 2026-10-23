import { describe, expect, it } from 'vitest';
import { toB64u } from './codes.ts';
import {
  AUTH_QUERY, MAX_SKEW_MS, bodyHash, canonicalJson, formatAuth, generateDeviceKey, importPublicKey, keyId, normalizePathQuery,
  parseAuth, signRequest, verifyRequest, type DeviceKeys,
} from './sign.ts';
import { seeded } from './test-utils.ts';

const NOW = 1_800_000_000_000;

async function setup(): Promise<{ keys: DeviceKeys; pub: CryptoKey }> {
  const keys = await generateDeviceKey();
  const pub = await importPublicKey(keys.publicRaw);
  if (!pub) throw new Error('public key did not import');
  return { keys, pub };
}

describe('canonical JSON and path', () => {
  it('sorts keys at every depth, drops undefined and keeps arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, { z: 1, y: undefined }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1,{"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson([undefined, null, true])).toBe('[null,null,true]');
    expect(canonicalJson('ş"\n')).toBe(JSON.stringify('ş"\n'));
    expect(() => canonicalJson({ a: NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(TypeError);
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow(TypeError);
  });

  it('hashes the same value the same way whatever the original spacing and key order', async () => {
    const a = JSON.parse('{ "x" : 1, "y": [1, 2],\n "z": {"q": "w"} }') as unknown;
    const b = JSON.parse('{"z":{"q":"w"},"y":[1,2],"x":1}') as unknown;
    expect(await bodyHash(a)).toBe(await bodyHash(b));
    expect(await bodyHash(undefined)).toBe('-');
    expect(await bodyHash({})).not.toBe(await bodyHash([]));
  });

  it('sorts the query and leaves the auth parameter out', () => {
    expect(normalizePathQuery('/api/x?b=2&a=1&a=0')).toBe('/api/x?a=0&a=1&b=2');
    expect(normalizePathQuery(`https://h.example/api/x?${AUTH_QUERY}=zzz&k=v`)).toBe('/api/x?k=v');
    expect(normalizePathQuery('/api/x')).toBe('/api/x');
    expect(normalizePathQuery('/api/x?q=a b&r=ş')).toBe('/api/x?q=a%20b&r=%C5%9F');
  });
});

describe('the auth header', () => {
  it('formats and parses exactly the v1 shape', async () => {
    const { keys } = await setup();
    const header = await signRequest(keys, { method: 'GET', url: '/api/social/me' }, NOW, seeded(1));
    const p = parseAuth(header);
    expect(p).not.toBeNull();
    expect(p?.kid).toBe(keys.kid);
    expect(p?.ts).toBe(NOW);
    expect(formatAuth(p!)).toBe(header);
  });

  it('rejects anything else', async () => {
    const { keys } = await setup();
    const good = await signRequest(keys, { method: 'GET', url: '/x' }, NOW);
    const f = good.split('.');
    const bad = [
      '', 'v1', good + '.x', 'v2.' + f.slice(1).join('.'), [f[0], f[1]!.slice(1), f[2], f[3], f[4]].join('.'),
      [f[0], f[1], 'abc', f[3], f[4]].join('.'), [f[0], f[1], f[2], 'short', f[4]].join('.'), [f[0], f[1], f[2], f[3], f[4]!.slice(2)].join('.'),
      [f[0], f[1], f[2], f[3], f[4]!.slice(0, 85) + '+'].join('.'), 'x'.repeat(400),
    ];
    for (const b of bad) expect(parseAuth(b), b).toBeNull();
    expect(parseAuth(null)).toBeNull();
    expect(parseAuth(undefined)).toBeNull();
  });
});

describe('signing and verifying', () => {
  it('accepts an untouched request, with or without a body', async () => {
    const { keys, pub } = await setup();
    const body = { code: 'BA-7K2Q4X', n: 1 };
    const h1 = parseAuth(await signRequest(keys, { method: 'post', url: '/api/social/friends/request', body }, NOW))!;
    expect(await verifyRequest(h1, pub, { method: 'POST', url: '/api/social/friends/request', body: { n: 1, code: 'BA-7K2Q4X' } }, NOW)).toBe('ok');
    const h2 = parseAuth(await signRequest(keys, { method: 'GET', url: '/api/social/lobbies?game=squat-flap&region=eu' }, NOW))!;
    expect(await verifyRequest(h2, pub, { method: 'GET', url: '/api/social/lobbies?region=eu&game=squat-flap' }, NOW + 1000)).toBe('ok');
  });

  it('refuses a changed method, path, query, body, timestamp or nonce', async () => {
    const { keys, pub } = await setup();
    const req = { method: 'POST', url: '/api/social/friends/respond?x=1', body: { fid: 'ABCDEFGHJK', accept: true } };
    const parts = parseAuth(await signRequest(keys, req, NOW))!;
    const check = (r: { method: string; url: string; body?: unknown }, p = parts) => verifyRequest(p, pub, r, NOW);
    expect(await check(req)).toBe('ok');
    expect(await check({ ...req, method: 'GET' })).toBe('bad_signature');
    expect(await check({ ...req, url: '/api/social/friends/remove?x=1' })).toBe('bad_signature');
    expect(await check({ ...req, url: '/api/social/friends/respond?x=2' })).toBe('bad_signature');
    expect(await check({ ...req, url: '/api/social/friends/respond' })).toBe('bad_signature');
    expect(await check({ ...req, body: { fid: 'ABCDEFGHJK', accept: false } })).toBe('bad_signature');
    expect(await check({ ...req, body: undefined })).toBe('bad_signature');
    expect(await check(req, { ...parts, ts: parts.ts + 1 })).toBe('bad_signature');
    expect(await check(req, { ...parts, nonce: toB64u(seeded(2)(16)) })).toBe('bad_signature');
  });

  it('refuses another device key and a damaged signature', async () => {
    const a = await setup();
    const b = await setup();
    const parts = parseAuth(await signRequest(a.keys, { method: 'GET', url: '/api/social/me' }, NOW))!;
    expect(await verifyRequest(parts, b.pub, { method: 'GET', url: '/api/social/me' }, NOW)).toBe('bad_signature');
    expect(await verifyRequest({ ...parts, sig: toB64u(new Uint8Array(64)) }, a.pub, { method: 'GET', url: '/api/social/me' }, NOW)).toBe('bad_signature');
    expect(await verifyRequest({ ...parts, sig: parts.sig.slice(0, 80) }, a.pub, { method: 'GET', url: '/api/social/me' }, NOW)).toBe('bad_signature');
  });

  it('keeps a five-minute window and says so when the clock is off', async () => {
    const { keys, pub } = await setup();
    const parts = parseAuth(await signRequest(keys, { method: 'GET', url: '/api/social/me' }, NOW))!;
    const r = { method: 'GET', url: '/api/social/me' };
    expect(await verifyRequest(parts, pub, r, NOW + MAX_SKEW_MS)).toBe('ok');
    expect(await verifyRequest(parts, pub, r, NOW - MAX_SKEW_MS)).toBe('ok');
    expect(await verifyRequest(parts, pub, r, NOW + MAX_SKEW_MS + 1)).toBe('clock_skew');
    expect(await verifyRequest(parts, pub, r, NOW - MAX_SKEW_MS - 1)).toBe('clock_skew');
  });

  it('treats a body that cannot be canonical as a bad signature, not a crash', async () => {
    const { keys, pub } = await setup();
    const parts = parseAuth(await signRequest(keys, { method: 'POST', url: '/x', body: { a: 1 } }, NOW))!;
    expect(await verifyRequest(parts, pub, { method: 'POST', url: '/x', body: { a: Infinity } }, NOW)).toBe('bad_signature');
  });
});

describe('device keys', () => {
  it('derives a stable 22-character key id from the public key', async () => {
    const { keys } = await setup();
    expect(keys.kid).toHaveLength(22);
    expect(await keyId(keys.publicRaw)).toBe(keys.kid);
    const other = await generateDeviceKey();
    expect(other.kid).not.toBe(keys.kid);
  });

  it('keeps the private key non-extractable', async () => {
    const { keys } = await setup();
    expect(keys.privateKey.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey)).rejects.toThrow();
  });

  it('only imports a valid uncompressed P-256 point', async () => {
    const { keys } = await setup();
    expect(await importPublicKey(keys.publicRaw)).not.toBeNull();
    expect(await importPublicKey('')).toBeNull();
    expect(await importPublicKey(42)).toBeNull();
    expect(await importPublicKey('AAAA')).toBeNull();
    expect(await importPublicKey(toB64u(new Uint8Array(65)))).toBeNull();
    const notOnCurve = new Uint8Array(65).fill(7);
    notOnCurve[0] = 4;
    expect(await importPublicKey(toB64u(notOnCurve))).toBeNull();
    expect(await importPublicKey('x'.repeat(200))).toBeNull();
  });
});
