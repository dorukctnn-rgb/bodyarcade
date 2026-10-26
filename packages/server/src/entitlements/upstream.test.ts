// The two sellers as the Worker calls them: Gumroad's licence check, and Google's sign-in and purchase check. Their servers
// are pretended with the answers (and the failures) the real ones give; the Google one also checks the signature of the
// sign-in assertion, so the JWT the Worker builds is proven to be one Google would accept.
import { beforeAll, describe, expect, it } from 'vitest';
import { GUMROAD_VERIFY_URL } from '../../../core/entitlements/gumroad-rules.ts';
import { b64urlDecode } from '../../../core/entitlements/token.ts';
import { GOOGLE_TOKEN_URI, PLAY_SCOPE, createGoogleAuth, parseServiceAccount, type ServiceAccount } from './upstream/google.ts';
import { createGumroadUpstream, type FetchFn } from './upstream/gumroad.ts';
import { PLAY_API, createPlayUpstream, judgeProduct, judgeSubscription } from './upstream/play.ts';

const NOW = Date.UTC(2026, 9, 24, 12);
const nowS = NOW / 1000;
const iso = (s: number): string => new Date(s * 1000).toISOString();

const reply = (status: number, body: unknown): Response => new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' } });

// ───────── Gumroad ─────────

describe('Gumroad: the licence check', () => {
  const one = (status: number, body: unknown, seen?: { url: string; init?: RequestInit }[]): FetchFn => async (url, init) => { seen?.push({ url, ...(init ? { init } : {}) }); return reply(status, body); };

  it('asks with the product id and the key, and does not use the key up', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    await createGumroadUpstream({ fetch: one(200, { success: true, purchase: {} }, seen) }).verify('PRODUCTID0001', 'KEY-ONE-1234');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(GUMROAD_VERIFY_URL);
    expect(seen[0]?.init?.method).toBe('POST');
    const form = new URLSearchParams(String(seen[0]?.init?.body));
    expect(Object.fromEntries(form)).toEqual({ product_id: 'PRODUCTID0001', license_key: 'KEY-ONE-1234', increment_uses_count: 'false' });
    expect((seen[0]?.init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('carries the purchase of a success', async () => {
    const purchase = { email: 'x@example.com', refunded: false, subscription_cancelled_at: null };
    expect(await createGumroadUpstream({ fetch: one(200, { success: true, uses: 3, purchase }) }).verify('P', 'K')).toEqual({ kind: 'found', purchase });
  });

  it.each([
    ['That license does not exist for the provided product.', 'missing'],
    ['This license key has been disabled.', 'disabled'],
    ['Access to the purchase associated with this license has expired.', 'expired'],
  ])('tells the three kinds of "no" apart: %s', async (message, reason) => {
    expect(await createGumroadUpstream({ fetch: one(404, { success: false, message }) }).verify('P', 'K')).toEqual({ kind: 'not_found', reason });
  });

  it.each([
    [500, { success: false, message: 'oops' }], [502, '<html>bad gateway</html>'], [503, ''], [429, { success: false, message: 'Too many requests' }],
    [408, {}], [200, '<html>captive portal</html>'], [200, { success: 'yes' }], [404, '<html>not found</html>'], [404, { success: false }],
  ])('is no verdict for %i %j', async (status, body) => {
    expect(await createGumroadUpstream({ fetch: one(status, body) }).verify('P', 'K')).toEqual({ kind: 'unreadable' });
  });

  it('is no verdict when the network fails or the answer is too slow, and it never throws', async () => {
    expect(await createGumroadUpstream({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).verify('P', 'K')).toEqual({ kind: 'unreadable' });
    const slow: FetchFn = (_u, init) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
    expect(await createGumroadUpstream({ fetch: slow, timeoutMs: 20 }).verify('P', 'K')).toEqual({ kind: 'unreadable' });
  });
});

// ───────── Google Play: what an answer means ─────────

const sub = (state: string, over: Record<string, unknown> = {}, item: Record<string, unknown> = {}): unknown => ({
  kind: 'androidpublisher#subscriptionPurchaseV2', startTime: iso(nowS - 3 * 86_400), subscriptionState: state, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  lineItems: [{ productId: 'bodyarcade_pro_yearly', expiryTime: iso(nowS + 20 * 86_400), ...item }], ...over,
});

describe('Google Play: what a subscription answer means', () => {
  const judge = (b: unknown, product = 'bodyarcade_pro_yearly') => judgeSubscription(b, product, nowS);

  it('ACTIVE is access, with the end of the period and when it began', () => {
    expect(judge(sub('SUBSCRIPTION_STATE_ACTIVE'))).toEqual({ kind: 'active', expiry: nowS + 20 * 86_400, startedAt: nowS - 3 * 86_400, cancelled: false, acknowledged: true, test: false });
  });

  it('IN_GRACE_PERIOD is access (Google is retrying the payment and says access continues), even with the period over', () => {
    expect(judge(sub('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', {}, { expiryTime: iso(nowS - 3600) }))).toMatchObject({ kind: 'active', cancelled: false });
  });

  it('CANCELED is access until the end of the period it has left, and no more', () => {
    expect(judge(sub('SUBSCRIPTION_STATE_CANCELED'))).toMatchObject({ kind: 'active', cancelled: true, expiry: nowS + 20 * 86_400 });
    expect(judge(sub('SUBSCRIPTION_STATE_CANCELED', {}, { expiryTime: iso(nowS - 1) }))).toEqual({ kind: 'refused', code: 'ended' });
    expect(judge(sub('SUBSCRIPTION_STATE_CANCELED', {}, { expiryTime: undefined }))).toEqual({ kind: 'refused', code: 'ended' });
  });

  it.each(['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'])('%s is "ended"', (state) => {
    expect(judge(sub(state))).toEqual({ kind: 'refused', code: 'ended' });
  });

  it('PENDING is neither access nor a refusal', () => {
    expect(judge(sub('SUBSCRIPTION_STATE_PENDING'))).toEqual({ kind: 'pending' });
    expect(judge(sub('SUBSCRIPTION_STATE_PENDING', { lineItems: [] }))).toEqual({ kind: 'pending' });
  });

  it('a state nobody knows is no verdict, and not an outage', () => {
    expect(judge(sub('SUBSCRIPTION_STATE_UNSPECIFIED'))).toEqual({ kind: 'unreadable', outage: false });
    expect(judge(sub('SUBSCRIPTION_STATE_FROM_THE_FUTURE'))).toEqual({ kind: 'unreadable', outage: false });
    expect(judge(sub(undefined as unknown as string))).toEqual({ kind: 'unreadable', outage: false });
  });

  it('a purchase of another product, or with no line item, is "not found"', () => {
    expect(judge(sub('SUBSCRIPTION_STATE_ACTIVE'), 'bodyarcade_pro_monthly')).toEqual({ kind: 'refused', code: 'not_found' });
    expect(judge(sub('SUBSCRIPTION_STATE_ACTIVE', { lineItems: [] }))).toEqual({ kind: 'refused', code: 'not_found' });
    expect(judge(sub('SUBSCRIPTION_STATE_ACTIVE', { lineItems: 'x' }))).toEqual({ kind: 'refused', code: 'not_found' });
  });

  it('reads the acknowledgement and the test flag; a body that is not an object is no verdict', () => {
    expect(judge(sub('SUBSCRIPTION_STATE_ACTIVE', { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING', testPurchase: {} }))).toMatchObject({ acknowledged: false, test: true });
    for (const bad of [null, 'x', 5, [], undefined]) expect(judge(bad)).toEqual({ kind: 'unreadable', outage: true });
  });
});

describe('Google Play: what a one-time product answer means', () => {
  it('purchased is access with no end; cancelled (a refund or a chargeback) is "refunded"; pending waits', () => {
    expect(judgeProduct({ purchaseState: 0, acknowledgementState: 1, purchaseTimeMillis: String(NOW) })).toEqual({ kind: 'active', expiry: null, startedAt: nowS, cancelled: false, acknowledged: true, test: false });
    expect(judgeProduct({ purchaseState: 0, acknowledgementState: 0, purchaseType: 0 })).toMatchObject({ acknowledged: false, test: true, startedAt: null });
    expect(judgeProduct({ purchaseState: 1 })).toEqual({ kind: 'refused', code: 'refunded' });
    expect(judgeProduct({ purchaseState: 2 })).toEqual({ kind: 'pending' });
  });

  it('anything else is no verdict', () => {
    expect(judgeProduct({ purchaseState: 7 })).toEqual({ kind: 'unreadable', outage: false });
    expect(judgeProduct({})).toEqual({ kind: 'unreadable', outage: false });
    expect(judgeProduct('x')).toEqual({ kind: 'unreadable', outage: true });
  });
});

// ───────── Google: signing in and asking ─────────

interface FakeGoogle {
  account: ServiceAccount;
  fetch: FetchFn;
  tokenRequests: number;
  /** Every call to the Play API: method, path and the token it came with. */
  api: { method: string; path: string; bearer: string }[];
  /** path (after /applications/<package>/) -> status and body */
  answers: Map<string, { status: number; body: unknown }>;
  /** The next API call is refused as unauthorised (an access token that Google dropped early). */
  rejectNext: boolean;
  tokenStatus: number;
  clock: { t: number };
  verified: { iss: string; scope: string; aud: string; iat: number; exp: number }[];
}

let rsa: { account: ServiceAccount; publicKey: CryptoKey };

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  rsa = {
    publicKey: pair.publicKey,
    account: { client_email: 'play-checker@bodyarcade.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, token_uri: GOOGLE_TOKEN_URI },
  };
});

function fakeGoogle(): FakeGoogle {
  const g: FakeGoogle = {
    account: rsa.account, tokenRequests: 0, api: [], answers: new Map(), rejectNext: false, tokenStatus: 200, clock: { t: NOW }, verified: [],
    fetch: async (url, init) => {
      if (url === GOOGLE_TOKEN_URI) {
        g.tokenRequests++;
        if (g.tokenStatus !== 200) return reply(g.tokenStatus, { error: 'invalid_grant' });
        const form = new URLSearchParams(String(init?.body));
        if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return reply(400, { error: 'unsupported_grant_type' });
        const [h, c, s] = String(form.get('assertion')).split('.') as [string, string, string];
        const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', rsa.publicKey, b64urlDecode(s) as BufferSource, new TextEncoder().encode(`${h}.${c}`));
        if (!ok) return reply(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
        expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h) as Uint8Array))).toEqual({ alg: 'RS256', typ: 'JWT' });
        g.verified.push(JSON.parse(new TextDecoder().decode(b64urlDecode(c) as Uint8Array)));
        return reply(200, { access_token: `ya29.token-${g.tokenRequests}`, expires_in: 3599, token_type: 'Bearer' });
      }
      const path = url.slice(PLAY_API.length + 1);
      const bearer = String((init?.headers as Record<string, string>)['Authorization']);
      g.api.push({ method: init?.method ?? 'GET', path, bearer });
      if (g.rejectNext) { g.rejectNext = false; return reply(401, { error: { code: 401 } }); }
      if (bearer !== `Bearer ya29.token-${g.tokenRequests}`) return reply(401, { error: { code: 401 } });
      const hit = g.answers.get(path.replace(/^[^/]+\//, ''));
      return hit ? reply(hit.status, hit.body) : reply(404, { error: { code: 404, message: 'No purchase' } });
    },
  };
  return g;
}

describe('Google: signing in as the service account', () => {
  it('sends a JWT that Google verifies with the account\'s key, for the Play scope, for an hour', async () => {
    const g = fakeGoogle();
    const token = await createGoogleAuth({ account: g.account, fetch: g.fetch, now: () => g.clock.t }).token();
    expect(token).toBe('ya29.token-1');
    expect(g.verified).toEqual([{ iss: g.account.client_email, scope: PLAY_SCOPE, aud: GOOGLE_TOKEN_URI, iat: nowS, exp: nowS + 3600 }]);
  });

  it('keeps the token until five minutes before it runs out, then asks again; two callers at once ask once', async () => {
    const g = fakeGoogle();
    const auth = createGoogleAuth({ account: g.account, fetch: g.fetch, now: () => g.clock.t });
    const [a, b] = await Promise.all([auth.token(), auth.token()]);
    expect(a).toBe(b);
    expect(g.tokenRequests).toBe(1);
    g.clock.t += 3200 * 1000;
    expect(await auth.token()).toBe('ya29.token-1');
    g.clock.t += 200 * 1000;                                              // 3400 s of 3599: less than five minutes left
    expect(await auth.token()).toBe('ya29.token-2');
  });

  it('is "no token" (never an exception) when Google refuses the sign-in, or cannot be reached, or the key is unusable', async () => {
    const g = fakeGoogle();
    g.tokenStatus = 400;
    expect(await createGoogleAuth({ account: g.account, fetch: g.fetch }).token()).toBeNull();
    expect(await createGoogleAuth({ account: g.account, fetch: async () => { throw new TypeError('offline'); } }).token()).toBeNull();
    expect(await createGoogleAuth({ account: { ...g.account, private_key: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----' }, fetch: fakeGoogle().fetch }).token()).toBeNull();
    expect(await createGoogleAuth({ account: g.account, fetch: async () => reply(200, { access_token: 5 }) }).token()).toBeNull();
  });

  describe('the secret', () => {
    const base = { client_email: 'a@b.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n', token_uri: GOOGLE_TOKEN_URI, project_id: 'x'.repeat(30) };

    it('is read from the JSON Google hands out', () => {
      expect(parseServiceAccount(JSON.stringify(base))).toEqual({ client_email: base.client_email, private_key: base.private_key, token_uri: GOOGLE_TOKEN_URI });
      expect(parseServiceAccount(JSON.stringify({ ...base, token_uri: undefined }))).toMatchObject({ token_uri: GOOGLE_TOKEN_URI });
    });

    it.each([
      ['not JSON', 'x'.repeat(100)], ['no key', JSON.stringify({ ...base, private_key: undefined })], ['a key that is not PKCS8 PEM', JSON.stringify({ ...base, private_key: 'secret' })],
      ['a mail address that is not one', JSON.stringify({ ...base, client_email: 'nope' })], ['a sign-in address that is not Google\'s', JSON.stringify({ ...base, token_uri: 'https://evil.example/token' })],
      ['nothing', ''], ['not text', 5],
    ])('refuses %s', (_name, text) => {
      expect(parseServiceAccount(text)).toBeNull();
    });
  });
});

describe('Google Play: asking about a purchase', () => {
  const upstream = (g: FakeGoogle) => createPlayUpstream({ account: g.account, fetch: g.fetch, now: () => g.clock.t });
  const TOKEN = 'abcDEF123.AO-J1Oz_x/y+z=';
  const enc = encodeURIComponent(TOKEN);

  it('reads a subscription with the v2 call, signed in, with the token written safely into the path', async () => {
    const g = fakeGoogle();
    g.answers.set(`purchases/subscriptionsv2/tokens/${enc}`, { status: 200, body: sub('SUBSCRIPTION_STATE_ACTIVE') });
    expect(await upstream(g).check('bodyarcade_pro_yearly', TOKEN)).toMatchObject({ kind: 'active', cancelled: false });
    expect(g.api).toEqual([{ method: 'GET', path: `com.peakapps.bodyarcade/purchases/subscriptionsv2/tokens/${enc}`, bearer: 'Bearer ya29.token-1' }]);
    expect(g.api[0]?.path).toContain('%2F');
  });

  it('reads the one-time Lifetime product with the products call', async () => {
    const g = fakeGoogle();
    g.answers.set(`purchases/products/bodyarcade_lifetime/tokens/${enc}`, { status: 200, body: { purchaseState: 0, acknowledgementState: 1 } });
    expect(await upstream(g).check('bodyarcade_lifetime', TOKEN)).toMatchObject({ kind: 'active', expiry: null });
  });

  it('signs in once for many calls, and a 401 gets one new sign-in and one more try', async () => {
    const g = fakeGoogle();
    g.answers.set(`purchases/subscriptionsv2/tokens/${enc}`, { status: 200, body: sub('SUBSCRIPTION_STATE_ACTIVE') });
    const up = upstream(g);
    await up.check('bodyarcade_pro_yearly', TOKEN);
    await up.check('bodyarcade_pro_yearly', TOKEN);
    expect(g.tokenRequests).toBe(1);
    g.rejectNext = true;
    expect(await up.check('bodyarcade_pro_yearly', TOKEN)).toMatchObject({ kind: 'active' });
    expect(g.tokenRequests).toBe(2);
  });

  it.each([[400, 'not_found'], [404, 'not_found'], [410, 'ended']] as const)('%i is the refusal "%s"', async (status, code) => {
    const g = fakeGoogle();
    g.answers.set(`purchases/subscriptionsv2/tokens/${enc}`, { status, body: { error: { code: status } } });
    expect(await upstream(g).check('bodyarcade_pro_yearly', TOKEN)).toEqual({ kind: 'refused', code });
  });

  it.each([403, 429, 500, 503])('%i is an outage, never a verdict (403 is our own permissions)', async (status) => {
    const g = fakeGoogle();
    g.answers.set(`purchases/subscriptionsv2/tokens/${enc}`, { status, body: { error: { code: status } } });
    expect(await upstream(g).check('bodyarcade_pro_yearly', TOKEN)).toEqual({ kind: 'unreadable', outage: true });
  });

  it('is an outage when Google cannot be signed in to, cannot be reached, or answers slowly', async () => {
    const g = fakeGoogle();
    g.tokenStatus = 500;
    expect(await upstream(g).check('bodyarcade_pro_yearly', TOKEN)).toEqual({ kind: 'unreadable', outage: true });
    const down = createPlayUpstream({ account: g.account, fetch: async () => { throw new TypeError('offline'); } });
    expect(await down.check('bodyarcade_pro_yearly', TOKEN)).toEqual({ kind: 'unreadable', outage: true });
  });

  it('does not ask Google about a product it does not sell', async () => {
    const g = fakeGoogle();
    expect(await upstream(g).check('some_other_product', TOKEN)).toEqual({ kind: 'refused', code: 'not_found' });
    expect(await upstream(g).check('__proto__', TOKEN)).toEqual({ kind: 'refused', code: 'not_found' });
    expect(g.api).toHaveLength(0);
    expect(await upstream(g).acknowledge('toString', TOKEN)).toBe(false);
  });

  it('acknowledges a subscription and a one-time product on their own addresses', async () => {
    const g = fakeGoogle();
    g.answers.set(`purchases/subscriptions/bodyarcade_pro_yearly/tokens/${enc}:acknowledge`, { status: 200, body: {} });
    g.answers.set(`purchases/products/bodyarcade_lifetime/tokens/${enc}:acknowledge`, { status: 204, body: '' });
    const up = upstream(g);
    expect(await up.acknowledge('bodyarcade_pro_yearly', TOKEN)).toBe(true);
    expect(await up.acknowledge('bodyarcade_lifetime', TOKEN)).toBe(true);
    expect(g.api.map((c) => c.method)).toEqual(['POST', 'POST']);
  });

  it('says false (and does not throw) when Google refuses the acknowledgement or cannot be reached', async () => {
    const g = fakeGoogle();
    g.answers.set(`purchases/subscriptions/bodyarcade_pro_yearly/tokens/${enc}:acknowledge`, { status: 400, body: { error: { code: 400 } } });
    expect(await upstream(g).acknowledge('bodyarcade_pro_yearly', TOKEN)).toBe(false);
    expect(await createPlayUpstream({ account: g.account, fetch: async () => { throw new TypeError('offline'); } }).acknowledge('bodyarcade_pro_yearly', TOKEN)).toBe(false);
  });
});
