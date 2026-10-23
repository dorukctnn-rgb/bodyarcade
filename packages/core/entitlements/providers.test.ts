// The three providers against fakes that speak the real wire formats: our server (activate, refresh, release), Gumroad's
// verify endpoint (the live site's licence cases) and Google Play through the Digital Goods API.
import { beforeAll, describe, expect, it } from 'vitest';
import { API } from './api.ts';
import { entitlementFor } from './plans.ts';
import { createGumroadProvider, productTable } from './providers/gumroad.ts';
import { createPlayProvider, type DigitalGoodsService, type PaymentRequestLike } from './providers/play.ts';
import { createServerProvider } from './providers/server.ts';
import { CANCELLED, type FetchLike } from './providers/shared.ts';
import { DAY, DID_1, DID_2, FakeGumroad, FakeServer, KEY_A, KEY_B, START, Clock, makeKeys, type Fault, type Keys } from './testkit.ts';
import { verifyToken } from './token.ts';

let keys: Keys;
let other: Keys;
beforeAll(async () => { keys = await makeKeys(); other = await makeKeys(); });

function server(did = DID_1) {
  const clock = new Clock();
  const srv = new FakeServer(keys, clock);
  srv.other = other;
  const provider = createServerProvider({ fetch: srv.fetch, did: () => did, keys: [keys.pub], now: clock.now });
  return { clock, srv, provider };
}

describe('the server provider: activation', () => {
  it('turns a good key into a signed entitlement for this device', async () => {
    const { srv, provider } = server();
    srv.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const r = await provider.activate(KEY_A);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.e).toMatchObject({ plan: 'pro', source: 'server' });
    expect(r.e.exp).toBeUndefined();
    const v = await verifyToken(r.e.token as string, { keys: [keys.pub], now: START, did: DID_1 });
    expect(v.ok && v.claims.plan).toBe('pro-yearly');
  });

  it('knows a founder, a lifetime buyer and a family plan by what the token says', async () => {
    const { srv, provider } = server();
    srv.licenses.set(KEY_A, { plan: 'founder', status: 'active' });
    srv.licenses.set(KEY_B, { plan: 'family-yearly', status: 'active' });
    expect(await provider.activate(KEY_A)).toMatchObject({ ok: true, e: { plan: 'lifetime', founder: true } });
    expect(await provider.activate(KEY_B)).toMatchObject({ ok: true, e: { plan: 'family' } });
  });

  it('reports the end of a cancelled membership as the entitlement\'s end', async () => {
    const { srv, provider, clock } = server();
    srv.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active', paidUntil: clock.now() + 10 * DAY });
    const r = await provider.activate(KEY_A);
    expect(r.ok && r.e.exp).toBe(Math.floor((clock.now() + 10 * DAY) / 1000) * 1000);
  });

  it('passes on every clear no: unknown key, refund, end of membership, no seat left', async () => {
    const { srv, provider } = server();
    srv.licenses.set('REFUNDED-KEY-0001', { plan: 'pro-monthly', status: 'refunded' });
    srv.licenses.set('ENDED-KEY-0000001', { plan: 'pro-monthly', status: 'ended' });
    expect(await provider.activate('UNKNOWN-KEY-00001')).toMatchObject({ ok: false, code: 'not_found' });
    expect(await provider.activate('REFUNDED-KEY-0001')).toMatchObject({ ok: false, code: 'refunded' });
    expect(await provider.activate('ENDED-KEY-0000001')).toMatchObject({ ok: false, code: 'ended' });
    srv.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    for (const did of ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32)]) {
      expect((await createServerProvider({ fetch: srv.fetch, did: () => did, keys: [keys.pub], now: srv.clock.now }).activate(KEY_A)).ok).toBe(true);
    }
    expect(await provider.activate(KEY_A)).toMatchObject({ ok: false, code: 'limit' });
  });

  it('does not ask the network about something that cannot be a key', async () => {
    const { srv, provider } = server();
    for (const bad of ['', 'short', 'has spaces in it here', '<script>', 'A'.repeat(81), 5 as unknown as string, null as unknown as string]) {
      expect(await provider.activate(bad), String(bad)).toMatchObject({ ok: false, code: 'not_found' });
    }
    expect(srv.calls).toHaveLength(0);
  });

  it.each<[Fault, string]>([
    ['offline', 'network'], ['status500', 'server'], ['status503', 'server'], ['status429', 'server'], ['html200', 'server'], ['html404', 'server'],
    ['garbage', 'server'], ['empty200', 'server'], ['forged', 'server'],
  ])('a failure to answer (%s) is %s, never "not found"', async (fault, code) => {
    const { srv, provider } = server();
    srv.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    srv.fault = fault;
    expect(await provider.activate(KEY_A)).toMatchObject({ ok: false, code });
  });

  it('refuses a token made for another device', async () => {
    const { srv } = server();
    srv.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const tokenFor1 = await new Promise<string>((resolve) => {
      void (async () => { const r = await createServerProvider({ fetch: srv.fetch, did: () => DID_1, keys: [keys.pub], now: srv.clock.now }).activate(KEY_A); resolve(r.ok ? (r.e.token as string) : ''); })();
    });
    const replay: FetchLike = async () => new Response(JSON.stringify({ token: tokenFor1 }), { status: 200 });
    const p2 = createServerProvider({ fetch: replay, did: () => DID_2, keys: [keys.pub], now: srv.clock.now });
    expect(await p2.activate(KEY_A)).toMatchObject({ ok: false, code: 'server' });
  });

  it('sends the key and the device as JSON, without cookies, to the one route', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const spy: FetchLike = async (url, init) => { seen.push({ url, init: init ?? {} }); return new Response('{}', { status: 404 }); };
    const p = createServerProvider({ fetch: spy, did: () => DID_1, keys: [keys.pub], baseUrl: 'https://api.test' });
    await p.activate(`  ${KEY_A}  `);
    expect(seen[0]?.url).toBe(`https://api.test${API.activate}`);
    expect(seen[0]?.init.method).toBe('POST');
    expect(seen[0]?.init.credentials).toBe('omit');
    expect((seen[0]?.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(seen[0]?.init.body as string)).toEqual({ key: KEY_A, did: DID_1 });
  });
});

describe('the server provider: renewal (B2)', () => {
  const ctx = { proof: KEY_A, did: DID_1 };
  async function active() {
    const s = server();
    s.srv.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const first = await s.provider.activate(KEY_A);
    if (!first.ok) throw new Error('setup');
    return { ...s, held: first.e };
  }

  it('renews with a new token', async () => {
    const { provider, held, clock } = await active();
    clock.advance(2 * DAY);
    const r = await provider.refresh(held, ctx);
    expect(r).not.toBe('keep');
    expect(r).not.toBe('revoked');
    if (typeof r === 'object') expect(r.token).not.toBe(held.token);
  });

  it.each([['not_found'], ['refunded'], ['ended']] as const)('takes Pro away on a clear %s', async (status) => {
    const { srv, provider, held } = await active();
    if (status === 'not_found') srv.licenses.delete(KEY_A); else srv.licenses.set(KEY_A, { plan: 'pro-yearly', status });
    expect(await provider.refresh(held, ctx)).toBe('revoked');
  });

  it('takes Pro away when the seat is gone and no other is free', async () => {
    const { srv, provider, held } = await active();
    srv.seats.set(await (await import('./testkit.ts')).sha256Hex(KEY_A), new Set(['1'.repeat(32), '2'.repeat(32), '3'.repeat(32)]));
    expect(await provider.refresh(held, ctx)).toBe('revoked');
  });

  it.each<Fault>(['offline', 'status500', 'status503', 'status429', 'html200', 'html404', 'garbage', 'empty200', 'forged'])('keeps what it has on %s', async (fault) => {
    const { srv, provider, held } = await active();
    srv.fault = fault;
    expect(await provider.refresh(held, ctx)).toBe('keep');
  });

  it('keeps what it has when there is no key to renew with', async () => {
    const { provider, held, srv } = await active();
    const before = srv.calls.length;
    expect(await provider.refresh(held)).toBe('keep');
    expect(await provider.refresh(held, { proof: null, did: DID_1 })).toBe('keep');
    expect(await provider.refresh(held, { proof: 'bad key', did: DID_1 })).toBe('keep');
    expect(srv.calls.length).toBe(before);
  });

  it('keeps what it has on a 4xx that is not a clear refusal (an unknown word, a bad request, a gateway page)', async () => {
    const { provider, held } = await active();
    for (const [status, body] of [[400, '{"error":"bad_request"}'], [404, '{"error":"mystery"}'], [403, 'Forbidden'], [401, '{}'], [408, '{"error":"not_found"}'], [425, '{"error":"not_found"}'], [429, '{"error":"not_found"}']] as const) {
      const f: FetchLike = async () => new Response(body, { status });
      const p = createServerProvider({ fetch: f, did: () => DID_1, keys: [keys.pub] });
      expect(await p.refresh(held, ctx), `${status} ${body}`).toBe('keep');
    }
    expect(provider).toBeDefined();
  });

  it('gives the seat back, best effort', async () => {
    const { srv, provider, held } = await active();
    expect(await provider.release?.(held)).toBe(true);
    expect(srv.calls.at(-1)?.path).toBe(API.deactivate);
    srv.fault = 'offline';
    expect(await provider.release?.(held)).toBe(false);
    expect(await provider.release?.({ plan: 'pro', source: 'server' })).toBe(false);
  });
});

describe('the direct Gumroad provider (the live site\'s licence cases)', () => {
  const MONTHLY = 'tN-xTHwaZm8bOdcHHBaKbQ==';
  const LIFETIME = 'xIio9_FPmjKjWkdZLQKVxA==';
  const setup = () => {
    const clock = new Clock();
    const gr = new FakeGumroad();
    const provider = createGumroadProvider({ fetch: gr.fetch, now: clock.now });
    return { clock, gr, provider };
  };
  const iso = (ms: number): string => new Date(ms).toISOString();

  it('an active monthly plan is Pro with no end date, and nothing but the key leaves the device', async () => {
    const { gr, provider } = setup();
    gr.add(MONTHLY, KEY_A);
    const r = await provider.activate(KEY_A);
    expect(r).toEqual({ ok: true, e: { plan: 'pro', source: 'gumroad' } });
    expect(JSON.stringify(r)).not.toContain('buyer@example.com');
    const sent = gr.calls[0];
    expect([sent?.get('product_id'), sent?.get('license_key'), sent?.get('increment_uses_count')]).toEqual([MONTHLY, KEY_A, 'false']);
  });

  it('the lifetime purchase of before is a founder', async () => {
    const { gr, provider } = setup();
    gr.add(LIFETIME, KEY_B);
    expect(await provider.activate(KEY_B)).toEqual({ ok: true, e: { plan: 'lifetime', founder: true, source: 'gumroad' } });
  });

  it('a cancelled plan is Pro until the paid period ends, and says when', async () => {
    const { gr, provider, clock } = setup();
    gr.add(MONTHLY, KEY_A, { subscription_cancelled_at: iso(clock.now() + 10 * DAY) });
    const r = await provider.activate(KEY_A);
    expect(r).toMatchObject({ ok: true, e: { exp: clock.now() + 10 * DAY } });
  });

  it('a membership whose end date has passed is refused, whichever field says so', async () => {
    const { gr, provider, clock } = setup();
    for (const field of ['subscription_cancelled_at', 'subscription_failed_at', 'subscription_ended_at']) {
      gr.add(MONTHLY, KEY_A, { [field]: iso(clock.now() - DAY) });
      expect(await provider.activate(KEY_A), field).toMatchObject({ ok: false, code: 'ended' });
    }
  });

  it('refunded, chargebacked and disputed purchases are refused', async () => {
    const { gr, provider } = setup();
    for (const field of ['refunded', 'chargebacked', 'disputed']) {
      gr.add(MONTHLY, KEY_A, { [field]: true });
      expect(await provider.activate(KEY_A), field).toMatchObject({ ok: false, code: 'refunded' });
    }
  });

  it('an unknown key is not found after both old products were asked', async () => {
    const { gr, provider } = setup();
    expect(await provider.activate(KEY_A)).toMatchObject({ ok: false, code: 'not_found' });
    expect(gr.calls.map((c) => c.get('product_id'))).toEqual([MONTHLY, LIFETIME]);
  });

  it('renewal: after the paid period the next check removes the key', async () => {
    const { gr, provider, clock } = setup();
    gr.add(MONTHLY, KEY_A, { subscription_cancelled_at: iso(clock.now() + 3 * DAY) });
    const held = (await provider.activate(KEY_A)) as { ok: true; e: Parameters<typeof provider.refresh>[0] };
    clock.advance(3 * DAY + 60_000);
    expect(await provider.refresh(held.e, { proof: KEY_A, did: DID_1 })).toBe('revoked');
  });

  it('renewal: a plan restarted before the end keeps Pro and drops the end date', async () => {
    const { gr, provider, clock } = setup();
    gr.add(MONTHLY, KEY_A, { subscription_cancelled_at: iso(clock.now() + 2 * DAY) });
    const held = (await provider.activate(KEY_A)) as { ok: true; e: Parameters<typeof provider.refresh>[0] };
    gr.add(MONTHLY, KEY_A);                                         // Gumroad sets the fields back to null
    clock.advance(2 * DAY + 1000);
    const r = await provider.refresh(held.e, { proof: KEY_A, did: DID_1 });
    expect(r).toEqual({ plan: 'pro', source: 'gumroad' });
  });

  it('renewal: a refund revokes, and a key Gumroad no longer knows revokes', async () => {
    const { gr, provider } = setup();
    gr.add(MONTHLY, KEY_A);
    const held = (await provider.activate(KEY_A)) as { ok: true; e: Parameters<typeof provider.refresh>[0] };
    gr.add(MONTHLY, KEY_A, { refunded: true });
    expect(await provider.refresh(held.e, { proof: KEY_A, did: DID_1 })).toBe('revoked');
    gr.products.clear();
    expect(await provider.refresh(held.e, { proof: KEY_A, did: DID_1 })).toBe('revoked');
  });

  it.each<Fault>(['offline', 'status500', 'status429', 'html200'])('renewal: %s keeps the key (B2), and activation says it could not reach Gumroad', async (fault) => {
    const { gr, provider } = setup();
    gr.add(MONTHLY, KEY_A);
    const held = (await provider.activate(KEY_A)) as { ok: true; e: Parameters<typeof provider.refresh>[0] };
    gr.fault = fault;
    expect(await provider.refresh(held.e, { proof: KEY_A, did: DID_1 })).toBe('keep');
    expect(await provider.activate(KEY_A)).toMatchObject({ ok: false, code: 'network' });
  });

  it('renewal without a key keeps what it has', async () => {
    const { provider } = setup();
    expect(await provider.refresh({ plan: 'pro', source: 'gumroad' })).toBe('keep');
    expect(await provider.refresh({ plan: 'pro', source: 'gumroad' }, { proof: null, did: DID_1 })).toBe('keep');
  });

  it('does not ask about something that cannot be a key', async () => {
    const { gr, provider } = setup();
    expect(await provider.activate('nope')).toMatchObject({ ok: false, code: 'not_found' });
    expect(gr.calls).toHaveLength(0);
  });

  it('knows new products by id once they exist, and ignores nonsense in the table', async () => {
    const { gr, clock } = setup();
    const p = createGumroadProvider({ fetch: gr.fetch, now: clock.now, products: { 'newYearlyProduct==': 'pro-yearly', 'x': 'pro-monthly', 'okOkOkOk==': 'enterprise' as never } });
    gr.add('newYearlyProduct==', KEY_A);
    expect(await p.activate(KEY_A)).toEqual({ ok: true, e: entitlementFor('pro-yearly', 'gumroad') });
    expect(productTable({ 'x': 'pro-monthly', 'okOkOkOk==': 'enterprise' as never }).map(([id]) => id)).toEqual([MONTHLY, LIFETIME]);
  });
});

describe('the Google Play provider', () => {
  const TOKEN = 'purchase-token-aaaaaaaaaaaaaaaaaaaa';
  const TOKEN2 = 'purchase-token-bbbbbbbbbbbbbbbbbbbb';
  function play(listed: { itemId: string; purchaseToken: string }[] = [], over: { show?: () => Promise<unknown>; list?: () => Promise<unknown>; did?: string } = {}) {
    const clock = new Clock();
    const srv = new FakeServer(keys, clock);
    srv.other = other;
    srv.playPurchases.set(TOKEN, { productId: 'bodyarcade_pro_yearly', plan: 'pro-yearly', status: 'active' });
    srv.playPurchases.set(TOKEN2, { productId: 'bodyarcade_lifetime', plan: 'lifetime', status: 'active' });
    const log: string[] = [];
    const service: DigitalGoodsService = {
      getDetails: async (ids) => ids.filter((i) => i !== 'bodyarcade_family_yearly').map((itemId) => ({ itemId, price: { currency: 'EUR', value: '9.99' } })),
      listPurchases: (over.list ?? (async () => listed)) as DigitalGoodsService['listPurchases'],
    };
    let sku = '';
    const createPayment = (s: string): PaymentRequestLike => {
      sku = s;
      return {
        show: (over.show ?? (async () => ({ details: { purchaseToken: TOKEN }, complete: async (r?: string) => { log.push(`complete:${r}`); } }))) as PaymentRequestLike['show'],
      };
    };
    const provider = createPlayProvider({ service, createPayment, fetch: (u, i) => { log.push(`fetch:${new URL(u, 'https://x.test').pathname}`); return srv.fetch(u, i); }, did: () => over.did ?? DID_1, keys: [keys.pub], now: clock.now });
    return { clock, srv, provider, log, sku: () => sku };
  }

  it('describes the products as Google does, and never throws', async () => {
    const { provider } = play();
    expect((await provider.details()).map((d) => d.itemId).sort()).toEqual(['bodyarcade_lifetime', 'bodyarcade_pro_monthly', 'bodyarcade_pro_yearly']);
    const broken = createPlayProvider({ service: { getDetails: async () => { throw new Error('no'); }, listPurchases: async () => [] }, createPayment: () => ({ show: async () => { throw new Error('x'); } }), did: () => DID_1, keys: [keys.pub] });
    expect(await broken.details()).toEqual([]);
  });

  it('a purchase: Play pays, the server confirms, and only then is the payment completed', async () => {
    const { provider, log, sku } = play();
    const r = await provider.activate('bodyarcade_pro_yearly');
    expect(r).toMatchObject({ ok: true, e: { plan: 'pro', source: 'play' } });
    expect(sku()).toBe('bodyarcade_pro_yearly');
    expect(log).toEqual([`fetch:${API.play}`, 'complete:success']);
  });

  it('sends the purchase to the server with the device, and nothing else', async () => {
    const { provider, srv } = play();
    await provider.activate('bodyarcade_pro_yearly');
    expect(srv.calls[0]).toEqual({ path: API.play, body: { did: DID_1, purchases: [{ productId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN }] } });
  });

  it('a purchase the person cancels is not an error and costs no request', async () => {
    for (const name of ['AbortError', 'NotAllowedError']) {
      const { provider, srv } = play([], { show: async () => { throw Object.assign(new Error('x'), { name }); } });
      expect(await provider.activate('bodyarcade_pro_yearly')).toMatchObject({ ok: false, message: CANCELLED });
      expect(srv.calls).toHaveLength(0);
    }
    const { provider } = play([], { show: async () => { throw new Error('payment app crashed'); } });
    expect(await provider.activate('bodyarcade_pro_yearly')).toMatchObject({ ok: false, code: 'network' });
  });

  it('a product that is not ours starts no payment', async () => {
    const { provider, sku } = play();
    for (const bad of ['', 'pro', 'bodyarcade_gold', '__proto__', 'toString', 5 as unknown as string]) expect(await provider.activate(bad), String(bad)).toMatchObject({ ok: false, code: 'not_found' });
    expect(sku()).toBe('');
  });

  it('when the server says no (or cannot answer) the payment is completed as failed, never as success', async () => {
    for (const [fault, code] of [['offline', 'network'], ['status503', 'server'], ['html200', 'server']] as const) {
      const { provider, srv, log } = play();
      srv.fault = fault;
      expect(await provider.activate('bodyarcade_pro_yearly'), fault).toMatchObject({ ok: false, code });
      expect(log.at(-1), fault).toBe('complete:fail');
    }
    const { provider, srv, log } = play();
    srv.playPurchases.set(TOKEN, { productId: 'bodyarcade_pro_yearly', plan: 'pro-yearly', status: 'refunded' });
    expect(await provider.activate('bodyarcade_pro_yearly')).toMatchObject({ ok: false, code: 'refunded' });
    expect(log.at(-1)).toBe('complete:fail');
  });

  it('a response without a usable purchase token is failed without asking the server', async () => {
    for (const details of [null, {}, { purchaseToken: 5 }, { purchaseToken: 'short' }, { purchaseToken: '<script>alert(1)</script>xxxxxxxxxx' }]) {
      const log: string[] = [];
      const { provider, srv } = play([], { show: async () => ({ details, complete: async (r?: string) => { log.push(String(r)); } }) });
      expect(await provider.activate('bodyarcade_pro_yearly'), JSON.stringify(details)).toMatchObject({ ok: false, code: 'server' });
      expect(log).toEqual(['fail']);
      expect(srv.calls).toHaveLength(0);
    }
  });

  it('restoring lists the account\'s purchases and gets the best plan back', async () => {
    const { provider, srv } = play([{ itemId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN }, { itemId: 'bodyarcade_lifetime', purchaseToken: TOKEN2 }]);
    const r = await provider.restore();
    expect(r).toMatchObject({ ok: true, e: { plan: 'lifetime', source: 'play' } });
    expect((srv.calls[0]?.body['purchases'] as unknown[]).length).toBe(2);
  });

  it('restoring with nothing bought, with Play out of reach, and with foreign items', async () => {
    expect(await play([]).provider.restore()).toMatchObject({ ok: false, code: 'not_found' });
    expect(await play([], { list: async () => { throw new Error('offline'); } }).provider.restore()).toMatchObject({ ok: false, code: 'network' });
    expect(await play([], { list: async () => 'nonsense' }).provider.restore()).toMatchObject({ ok: false, code: 'network' });
    const foreign = play([{ itemId: 'someone_elses_product', purchaseToken: TOKEN }, { itemId: 'bodyarcade_pro_yearly', purchaseToken: 'short' }]);
    expect(await foreign.provider.restore()).toMatchObject({ ok: false, code: 'not_found' });
    expect(foreign.srv.calls).toHaveLength(0);
  });

  it('never sends more than ten purchases', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ itemId: 'bodyarcade_pro_yearly', purchaseToken: `purchase-token-${String(i).padStart(20, '0')}` }));
    const { provider, srv } = play(many);
    await provider.restore();
    expect((srv.calls[0]?.body['purchases'] as unknown[]).length).toBe(10);
  });

  it('renewal: a clear refusal revokes, anything else (an empty list, Play down, the server down) keeps', async () => {
    const held = { plan: 'pro' as const, source: 'play' as const };
    const refused = play([{ itemId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN }]);
    refused.srv.playPurchases.set(TOKEN, { productId: 'bodyarcade_pro_yearly', plan: 'pro-yearly', status: 'ended' });
    expect(await refused.provider.refresh(held)).toBe('revoked');
    expect(await play([]).provider.refresh(held)).toBe('keep');
    expect(await play([], { list: async () => { throw new Error('x'); } }).provider.refresh(held)).toBe('keep');
    for (const fault of ['offline', 'status500', 'html200', 'forged'] as const) {
      const p = play([{ itemId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN }]);
      p.srv.fault = fault;
      expect(await p.provider.refresh(held), fault).toBe('keep');
    }
    const ok = play([{ itemId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN }]);
    expect(await ok.provider.refresh(held)).toMatchObject({ plan: 'pro', source: 'play' });
  });

  it('does not keep a proof (Play lists its purchases again)', () => {
    expect(play().provider.keepsProof).toBe(false);
    expect(server().provider.keepsProof).toBe(true);
  });
});
