// What the Worker's secrets and variables mean: each is optional, a broken one turns off its own capability and is named
// (never shown) in `problems`.
import { describe, expect, it } from 'vitest';
import { GUMROAD_PRODUCTS } from '../../../core/entitlements/catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS } from '../../../core/entitlements/plans.ts';
import { loadConfig, parseProducts, parsePublicKeys } from './config.ts';
import { GOOGLE_TOKEN_URI } from './upstream/google.ts';
import { makeKeys } from './testkit.ts';

const SA = JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n', token_uri: GOOGLE_TOKEN_URI });

describe('the signing key', () => {
  it('is the private JWK the release owner makes (with alg and use beside it), and its public half is published', async () => {
    const k = await makeKeys();
    const c = await loadConfig({ ENT_PRIV_JWK: JSON.stringify({ ...k.privateJwk, alg: 'ES256', use: 'sig' }) });
    expect(c.signer?.kid).toBe(k.pub.kid);
    expect(c.publicKeys).toEqual([k.pub]);
    expect(c.problems).not.toContain('ENT_PRIV_JWK missing');
    expect(JSON.stringify(c.publicKeys)).not.toContain(k.privateJwk.d as string);
  });

  it.each([[undefined], [''], ['not json'], [JSON.stringify({ kty: 'EC' })], [JSON.stringify({ kty: 'RSA', crv: 'P-256', x: 'a', y: 'b', d: 'c', kid: 'k' })], [5]])('without a usable one (%j) nothing can be signed, and the setting is named', async (value) => {
    const c = await loadConfig({ ENT_PRIV_JWK: value });
    expect(c.signer).toBeNull();
    expect(c.publicKeys).toEqual([]);
    expect(c.problems.some((p) => p.startsWith('ENT_PRIV_JWK'))).toBe(true);
    expect(JSON.stringify(c.problems)).not.toContain('not json');
  });

  it('keeps older public keys for tokens still on devices, and never lists the same key twice', async () => {
    const k = await makeKeys();
    const old = await makeKeys();
    const c = await loadConfig({
      ENT_PRIV_JWK: JSON.stringify(k.privateJwk),
      ENT_PUB_JWKS: JSON.stringify([{ kid: old.pub.kid, jwk: { ...old.pub.jwk, d: 'MUST-NOT-LEAK' } }, { kid: k.pub.kid, jwk: k.pub.jwk }, { kid: 'bad' }, { jwk: {} }, 'x', { kid: 'rsa', jwk: { kty: 'RSA' } }]),
    });
    expect(c.publicKeys.map((x) => x.kid)).toEqual([k.pub.kid, old.pub.kid]);
    expect(JSON.stringify(c.publicKeys)).not.toContain('MUST-NOT-LEAK');
  });

  it('public keys alone are read from a bad or empty list as nothing', () => {
    for (const v of [undefined, '', 'nope', '{}', '"x"', '[1,2]']) expect(parsePublicKeys(v)).toEqual([]);
  });
});

describe('the Gumroad products', () => {
  it('always include the two sold before v2, after the products of this release', async () => {
    // `catalog: {}`: the catalog of the repository is not part of this case (it changes the day the products exist).
    const c = await loadConfig({ GUMROAD_PRODUCTS: JSON.stringify({ NEWPRODUCT001: 'pro-yearly', NEWPRODUCT002: 'lifetime' }) }, { catalog: {} });
    const ids = [...c.products.keys()];
    expect(ids).toEqual(['NEWPRODUCT001', 'NEWPRODUCT002', ...Object.keys(GUMROAD_LEGACY_PRODUCTS)]);
    expect(c.products.get('NEWPRODUCT001')).toBe('pro-yearly');
    for (const [id, plan] of Object.entries(GUMROAD_LEGACY_PRODUCTS)) expect(c.products.get(id)).toBe(plan);
  });

  it('put the products of the catalog first, then the ones the variable names, then the two sold before v2', async () => {
    const c = await loadConfig(
      { GUMROAD_PRODUCTS: JSON.stringify({ VARIABLEPRODUCT1: 'pro-yearly' }) },
      { catalog: { CATALOGPRODUCT01: 'pro-monthly', CATALOGPRODUCT02: 'family-yearly' } },
    );
    expect([...c.products.keys()]).toEqual(['CATALOGPRODUCT01', 'CATALOGPRODUCT02', 'VARIABLEPRODUCT1', ...Object.keys(GUMROAD_LEGACY_PRODUCTS)]);
    expect(c.products.get('CATALOGPRODUCT02')).toBe('family-yearly');
  });

  it('with no catalog given are the catalog of the repository: once the products exist the Worker needs no GUMROAD_PRODUCTS variable', async () => {
    const c = await loadConfig({});
    expect([...c.products.keys()]).toEqual([...Object.keys(GUMROAD_PRODUCTS), ...Object.keys(GUMROAD_LEGACY_PRODUCTS)]);
    for (const [id, plan] of Object.entries(GUMROAD_PRODUCTS)) expect(c.products.get(id)).toBe(plan);
  });

  it('never lets the variable change what a legacy id means... except by naming it again, which is the owner\'s own setting', async () => {
    const legacy = Object.keys(GUMROAD_LEGACY_PRODUCTS)[0] as string;
    const c = await loadConfig({ GUMROAD_PRODUCTS: JSON.stringify({ [legacy]: 'pro-monthly' }) });
    expect(c.products.get(legacy)).toBe('pro-monthly');
  });

  it('drops an entry that is not a product id of a plan, and a variable that is not a JSON object', () => {
    expect(parseProducts(JSON.stringify({ NEWPRODUCT001: 'pro-yearly', short: 'pro-yearly', NEWPRODUCT002: 'gold', NEWPRODUCT003: 5, 'has space in id': 'lifetime', NEWPRODUCT004: 'founder' }))).toEqual({ NEWPRODUCT001: 'pro-yearly', NEWPRODUCT004: 'founder' });
    for (const v of [undefined, '', '  ', 'nope', '[]', '"x"', '5', null]) expect(parseProducts(v)).toEqual({});
  });
});

describe('Google Play access', () => {
  it('is on with a service account, and off (and named) with a broken one', async () => {
    expect((await loadConfig({ PLAY_SA_JSON: SA })).playAccount?.client_email).toBe('a@b.iam.gserviceaccount.com');
    const bad = await loadConfig({ PLAY_SA_JSON: 'x'.repeat(80) });
    expect(bad.playAccount).toBeNull();
    expect(bad.problems).toContain('PLAY_SA_JSON unusable');
    const absent = await loadConfig({});
    expect(absent.playAccount).toBeNull();
    expect(absent.problems).not.toContain('PLAY_SA_JSON unusable');
  });
});

describe('the reminder mail', () => {
  it('needs the token and the sender together', async () => {
    expect((await loadConfig({ ENT_MAIL_TOKEN: 'fe-token-12345', ENT_MAIL_FROM: 'BodyArcade <info@bodyarcade.com>' })).mail).toEqual({ token: 'fe-token-12345', from: 'BodyArcade <info@bodyarcade.com>' });
    const half = await loadConfig({ ENT_MAIL_TOKEN: 'fe-token-12345' });
    expect(half.mail).toBeNull();
    expect(half.problems).toContain('ENT_MAIL_TOKEN and ENT_MAIL_FROM go together');
    const none = await loadConfig({});
    expect(none.mail).toBeNull();
    expect(none.problems).not.toContain('ENT_MAIL_TOKEN and ENT_MAIL_FROM go together');
  });

  it('refuses a token that is too short to be one, or a sender that is not an address', async () => {
    expect((await loadConfig({ ENT_MAIL_TOKEN: 'abc', ENT_MAIL_FROM: 'info@bodyarcade.com' })).mail).toBeNull();
    expect((await loadConfig({ ENT_MAIL_TOKEN: 'fe-token-12345', ENT_MAIL_FROM: 'nobody' })).mail).toBeNull();
  });
});

describe('the limits switch', () => {
  it('is only the string "1"', async () => {
    expect((await loadConfig({ ENT_NO_LIMITS: '1' })).noLimits).toBe(true);
    for (const v of [undefined, '', '0', 'true', 1, true]) expect((await loadConfig({ ENT_NO_LIMITS: v })).noLimits).toBe(false);
  });
});
