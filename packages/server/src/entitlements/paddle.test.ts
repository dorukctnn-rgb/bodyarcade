// Paddle Billing end to end on the Worker's side: the Paddle key, the webhook signature, the reading of Paddle's answers,
// and the whole path over HTTP (router -> Durable Object on node:sqlite -> engine) with Paddle's API and the mail service
// played by a fake that speaks their HTTP. No test reaches Paddle or ForwardEmail.
import { describe, expect, it } from 'vitest';
import { API, PADDLE_WEBHOOK_PATH } from '../../../core/entitlements/api.ts';
import { PADDLE_KEY_RE, PADDLE_PRICES, RESTORE_HASH_RE, restoreLink } from '../../../core/entitlements/paddle.ts';
import { verifyToken } from '../../../core/entitlements/token.ts';
import { FORWARD_EMAIL_API } from './mail.ts';
import {
  anchorOfTxn, judgeSubscription, judgeTransaction, paddleKeyFor, readPaddleKey, verifyPaddleSignature, wasRefunded,
  type PaddleSub, type PaddleTxn,
} from './paddle.ts';
import { DAY, DIDS, makeWorld } from './testkit.ts';

const SECRET = 'k'.repeat(40);
const WEBHOOK_SECRET = 'pdl_ntfset_test_secret_value_0123456789';
const [D0, D1, D2, D3] = DIDS as unknown as [string, string, string, string];
const id26 = (c: string): string => c.repeat(26).slice(0, 26);
const iso = (ms: number): string => new Date(ms).toISOString();

// ───────── pure parts ─────────

describe('the Paddle key', () => {
  it('names a subscription or a transaction, checks its MAC and does not care about case', async () => {
    const s = await paddleKeyFor(SECRET, { kind: 's', id: id26('a') });
    const t = await paddleKeyFor(SECRET, { kind: 't', id: id26('b') });
    expect(s).toMatch(PADDLE_KEY_RE);
    expect(t).toMatch(/^pdl-t-b{26}-[0-9a-f]{24}$/);
    expect(await readPaddleKey(SECRET, s)).toEqual({ kind: 's', id: id26('a') });
    expect(await readPaddleKey(SECRET, s.toUpperCase())).toEqual({ kind: 's', id: id26('a') });     // the server hashes keys in capitals
    expect(await readPaddleKey(SECRET, ` ${t} `)).toEqual({ kind: 't', id: id26('b') });
  });
  it('refuses a key made with another secret, an edited key and anything that is not one', async () => {
    const s = await paddleKeyFor(SECRET, { kind: 's', id: id26('a') });
    expect(await readPaddleKey('x'.repeat(40), s)).toBeNull();
    expect(await readPaddleKey(SECRET, s.replace('-s-', '-t-'))).toBeNull();
    expect(await readPaddleKey(SECRET, s.slice(0, -1) + (s.endsWith('0') ? '1' : '0'))).toBeNull();
    for (const bad of ['', 'AAAAAAAA-11111111-BBBBBBBB-22222222', 'pdl-x-' + id26('a') + '-' + '0'.repeat(24), s + '0']) expect(await readPaddleKey(SECRET, bad)).toBeNull();
  });
  it('is the subscription for a membership and the transaction itself for lifetime', () => {
    expect(anchorOfTxn({ id: `txn_${id26('c')}`, subscription_id: `sub_${id26('d')}` })).toEqual({ kind: 's', id: id26('d') });
    expect(anchorOfTxn({ id: `txn_${id26('c')}`, subscription_id: null })).toEqual({ kind: 't', id: id26('c') });
  });
  it('travels in a restore link the app can read back', async () => {
    const k = await paddleKeyFor(SECRET, { kind: 't', id: id26('e') });
    expect(restoreLink('https://bodyarcade.com', 'en', k)).toBe(`https://bodyarcade.com/pro/#restore=${k}`);
    expect(restoreLink('https://bodyarcade.com/', 'tr', k)).toBe(`https://bodyarcade.com/tr/pro/#restore=${k}`);
    expect(RESTORE_HASH_RE.exec(`#restore=${k}`)?.[1]).toBe(k);
    expect(RESTORE_HASH_RE.exec(`#x=1&restore=${k}`)?.[1]).toBe(k);
    expect(RESTORE_HASH_RE.exec('#restore=nothing')).toBeNull();
  });
});

async function sign(body: string, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${body}`)));
  return `ts=${ts};h1=${Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

describe('the webhook signature', () => {
  const body = '{"event_id":"evt_01","event_type":"transaction.completed","data":{}}';
  const now = Math.floor(Date.now() / 1000);
  it('accepts Paddle\'s own signature, also next to a second h1 while a secret is rotated', async () => {
    const h = await sign(body);
    expect(await verifyPaddleSignature(h, body, WEBHOOK_SECRET, now)).toEqual({ ok: true });
    expect(await verifyPaddleSignature(`${h.split(';')[0]};h1=${'0'.repeat(64)};${h.split(';')[1]}`, body, WEBHOOK_SECRET, now)).toEqual({ ok: true });
  });
  it('refuses a changed body, another secret, an old or future timestamp and a malformed or missing header', async () => {
    const h = await sign(body);
    expect(await verifyPaddleSignature(h, body.replace('completed', 'canceled'), WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'mismatch' });
    expect(await verifyPaddleSignature(h, `${body} `, WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'mismatch' });
    expect(await verifyPaddleSignature(await sign(body, 'pdl_ntfset_other'), body, WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'mismatch' });
    expect(await verifyPaddleSignature(await sign(body, WEBHOOK_SECRET, now - 301), body, WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'stale' });
    expect(await verifyPaddleSignature(await sign(body, WEBHOOK_SECRET, now + 301), body, WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'stale' });
    expect(await verifyPaddleSignature('ts=abc;h1=zz', body, WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyPaddleSignature(`ts=${now}`, body, WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifyPaddleSignature(null, body, WEBHOOK_SECRET, now)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyPaddleSignature(h, body, '', now)).toEqual({ ok: false, reason: 'missing' });
  });
});

const T0 = Date.parse('2026-11-04T12:00:00Z');
const item = (plan: keyof typeof PADDLE_PRICES) => [{ price: { id: PADDLE_PRICES[plan] } }];
const subOf = (o: Partial<PaddleSub> & { plan?: keyof typeof PADDLE_PRICES }): PaddleSub => ({
  id: `sub_${id26('s')}`, status: 'active', customer_id: `ctm_${id26('u')}`, items: item(o.plan ?? 'pro-monthly'),
  started_at: iso(T0), current_billing_period: { starts_at: iso(T0), ends_at: iso(T0 + 30 * DAY) }, scheduled_change: null, ...o,
});
const txnOf = (o: Partial<PaddleTxn> & { plan?: keyof typeof PADDLE_PRICES }): PaddleTxn => ({
  id: `txn_${id26('t')}`, status: 'completed', customer_id: `ctm_${id26('u')}`, subscription_id: null, items: item(o.plan ?? 'lifetime'),
  billed_at: iso(T0), adjustments: [], details: { totals: { grand_total: '11999' } }, ...o,
});

describe('reading Paddle\'s answers', () => {
  it('a running membership is Pro with no end; a cancellation at the period end gives that end; past due keeps Pro', () => {
    expect(judgeSubscription(subOf({}))).toMatchObject({ kind: 'active', facts: { plan: 'pro-monthly', paidUntil: null } });
    expect(judgeSubscription(subOf({ scheduled_change: { action: 'cancel', effective_at: iso(T0 + 30 * DAY) } }))).toMatchObject({ kind: 'active', facts: { paidUntil: Math.floor((T0 + 30 * DAY) / 1000) } });
    expect(judgeSubscription(subOf({ status: 'past_due' })).kind).toBe('active');
    expect(judgeSubscription(subOf({ status: 'trialing', plan: 'pro-yearly', current_billing_period: { starts_at: iso(T0), ends_at: iso(T0 + 7 * DAY) } }))).toMatchObject({ kind: 'active', facts: { plan: 'pro-yearly', expiry: Math.floor((T0 + 7 * DAY) / 1000) } });
  });
  it('a cancelled or paused membership has ended; a price that is not ours is not found', () => {
    expect(judgeSubscription(subOf({ status: 'canceled' }))).toEqual({ kind: 'refused', code: 'ended' });
    expect(judgeSubscription(subOf({ status: 'paused' }))).toEqual({ kind: 'refused', code: 'ended' });
    expect(judgeSubscription(subOf({ items: [{ price: { id: `pri_${id26('z')}` } }] }))).toEqual({ kind: 'refused', code: 'not_found' });
  });
  it('a lifetime payment is Pro until Paddle approves a full refund or a chargeback arrives', () => {
    expect(judgeTransaction(txnOf({}))).toMatchObject({ kind: 'active', facts: { plan: 'lifetime', paidUntil: null } });
    expect(judgeTransaction(txnOf({ status: 'paid' })).kind).toBe('active');
    expect(judgeTransaction(txnOf({ status: 'billed' }))).toEqual({ kind: 'pending' });
    expect(judgeTransaction(txnOf({ adjustments: [{ action: 'refund', status: 'pending_approval', type: 'full' }] })).kind).toBe('active');
    expect(judgeTransaction(txnOf({ adjustments: [{ action: 'refund', status: 'approved', type: 'partial' }] })).kind).toBe('active');
    expect(judgeTransaction(txnOf({ adjustments: [{ action: 'refund', status: 'approved', type: 'full' }] }))).toEqual({ kind: 'refused', code: 'refunded' });
    expect(judgeTransaction(txnOf({ adjustments: [{ action: 'chargeback', status: 'approved' }] }))).toEqual({ kind: 'refused', code: 'refunded' });
    expect(wasRefunded([{ action: 'chargeback' }, { action: 'chargeback_reverse' }])).toBe(false);
  });
  it('the first payment of a membership waits for its subscription', () => {
    expect(judgeTransaction(txnOf({ plan: 'pro-monthly', status: 'paid', subscription_id: null }))).toEqual({ kind: 'pending' });
    expect(judgeTransaction(txnOf({ plan: 'pro-monthly', subscription_id: `sub_${id26('s')}` })).kind).toBe('active');
  });
});

// ───────── over HTTP ─────────

const PADDLE = 'https://api.paddle.com';
const j = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Paddle's API as the Worker sees it over HTTP, backed by plain maps. */
class FakePaddle {
  txns = new Map<string, PaddleTxn>();
  subs = new Map<string, PaddleSub>();
  customers = new Map<string, string>();   // email -> customer id
  down = false;
  calls: string[] = [];
  refunds: { transaction_id: string; reason: string }[] = [];
  cancels: string[] = [];
  mails: { auth: string; body: Record<string, unknown> }[] = [];
  auth: string[] = [];
  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === FORWARD_EMAIL_API) {
      this.mails.push({ auth: String((init?.headers as Record<string, string>)['Authorization']), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return j(200, { id: 'mail1' });
    }
    if (!input.startsWith(PADDLE)) return j(404, {});
    const u = new URL(input);
    this.calls.push(`${init?.method ?? 'GET'} ${u.pathname}`);
    this.auth.push(String((init?.headers as Record<string, string>)['Authorization']));
    if (this.down) return new Response('<html>busy</html>', { status: 503 });
    const p = u.pathname.split('/').filter(Boolean);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && p[0] === 'transactions' && p[1]) { const t = this.txns.get(p[1]); return t ? j(200, { data: t }) : j(404, { error: { code: 'not_found' } }); }
    if (method === 'GET' && p[0] === 'subscriptions' && p[1]) { const s = this.subs.get(p[1]); return s ? j(200, { data: s }) : j(404, { error: { code: 'not_found' } }); }
    if (method === 'GET' && p[0] === 'customers') { const c = this.customers.get(u.searchParams.get('email') ?? ''); return j(200, { data: c ? [{ id: c }] : [] }); }
    if (method === 'GET' && p[0] === 'transactions') return j(200, { data: [...this.txns.values()].filter((t) => t.customer_id === u.searchParams.get('customer_id') && t.status === 'completed') });
    if (method === 'GET' && p[0] === 'subscriptions') return j(200, { data: [...this.subs.values()].filter((s) => s.customer_id === u.searchParams.get('customer_id')) });
    if (method === 'POST' && p[0] === 'customers' && p[2] === 'portal-sessions') {
      const ids = (JSON.parse(String(init?.body)) as { subscription_ids?: string[] }).subscription_ids ?? [];
      return j(201, { data: { urls: { general: { overview: `https://customer-portal.paddle.com/cpl_x?action=overview&c=${p[1]}` }, subscriptions: ids.map((id) => ({ id, view_subscription: `https://customer-portal.paddle.com/view/${id}`, cancel_subscription: 'c', update_subscription_payment_method: 'u' })) } } });
    }
    if (method === 'POST' && p[0] === 'adjustments') { this.refunds.push(JSON.parse(String(init?.body)) as { transaction_id: string; reason: string }); return j(201, { data: { status: 'pending_approval' } }); }
    if (method === 'POST' && p[0] === 'subscriptions' && p[2] === 'cancel') { this.cancels.push(p[1] as string); const s = this.subs.get(p[1] as string); if (s) s.status = 'canceled'; return j(200, { data: s }); }
    return j(404, { error: { code: 'not_found' } });
  };
}

async function world(o: { limits?: boolean; mail?: boolean } = {}) {
  const paddle = new FakePaddle();
  const w = await makeWorld({
    fetch: paddle.fetch,
    limits: o.limits ?? false,
    env: {
      PADDLE_API_KEY: 'pdl_live_apikey_test', PADDLE_KEY_SECRET: SECRET, PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN: 'live_0123456789abcdefghijklmnopq',
      PUBLIC_ORIGIN: 'https://bodyarcade.com',
      ...(o.mail === false ? {} : { PADDLE_MAIL_TOKEN: 'info@peakappsstudio.com:alias-password-x', PADDLE_MAIL_FROM: 'BodyArcade <info@peakappsstudio.com>' }),
    },
  });
  // Paddle's times follow the test clock
  const now = () => w.clock.now();
  const post = async (path: string, body: unknown) => { const r = await w.call('POST', path, body); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
  // what the app does after checkout.completed: the transaction id gives the key, then the key is activated on this device
  const claim = async (txn: string, did: string) => {
    const c = await post(API.paddle, { txn });
    if (c.status !== 200) return c;
    const a = await post(API.activate, { key: c.body['key'], did });
    return { status: a.status, body: { ...a.body, key: c.body['key'], claimedPlan: c.body['plan'], ...(c.body['duplicate'] ? { duplicate: true } : {}) } };
  };
  const refresh = (key: string, did: string) => post(API.refresh, { key, did });
  const hook = async (evt: Record<string, unknown>, o2: { secret?: string; raw?: string } = {}) => {
    const raw = o2.raw ?? JSON.stringify(evt);
    const r = await w.call('POST', PADDLE_WEBHOOK_PATH, raw, { 'Content-Type': 'application/json', 'Paddle-Signature': await sign(raw, o2.secret) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const plan = async (token: unknown, did: string) => {
    const v = await verifyToken(String(token), { keys: [w.keys.pub], now: now(), did });
    return v.ok ? v.claims.plan : `invalid:${v.ok ? '' : v.reason}`;
  };
  return { w, paddle, now, post, claim, refresh, hook, plan };
}

let evtN = 0;
const evt = (type: string, data: unknown, occurred = new Date().toISOString()) => ({ event_id: `evt_${String(++evtN).padStart(26, '0')}`, event_type: type, occurred_at: occurred, data });

describe('a completed checkout turns Pro on with nothing to type', () => {
  it('lifetime: the transaction gives a Paddle key and a token; the same key works on a second device and on refresh', async () => {
    const { w, paddle, claim, refresh, plan } = await world();
    const t = txnOf({ billed_at: iso(w.clock.now()) });
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    expect(a.status).toBe(200);
    expect(a.body['key']).toMatch(PADDLE_KEY_RE);
    expect(a.body['plan']).toBe('lifetime');
    expect(await plan(a.body['token'], D0)).toBe('lifetime');
    expect(a.body['duplicate']).toBeUndefined();
    const b = await claim(t.id, D1);
    expect(b.body['key']).toBe(a.body['key']);
    expect(b.body['devices']).toEqual({ used: 2, limit: 3 });
    w.clock.advance(DAY);
    const r = await refresh(String(a.body['key']), D0);
    expect(r.status).toBe(200);
    expect(await plan(r.body['token'], D0)).toBe('lifetime');
    expect(paddle.auth.every((h) => h === 'Bearer pdl_live_apikey_test')).toBe(true);
  });

  it('membership: the key names the subscription; a trial shows as a trial in the token', async () => {
    const { w, paddle, claim, plan } = await world();
    const now = w.clock.now();
    const s = subOf({ status: 'trialing', plan: 'pro-yearly', started_at: iso(now), current_billing_period: { starts_at: iso(now), ends_at: iso(now + 7 * DAY) } });
    paddle.subs.set(s.id, s);
    const t = txnOf({ plan: 'pro-yearly', subscription_id: s.id, details: { totals: { grand_total: '0' } } });
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    expect(a.status).toBe(200);
    expect(String(a.body['key'])).toMatch(/^pdl-s-s{26}-/);
    expect(await plan(a.body['token'], D0)).toBe('pro-yearly');
    const v = await verifyToken(String(a.body['token']), { keys: [w.keys.pub], now, did: D0 });
    expect(v.ok && v.claims.src).toBe('paddle');
    expect(v.ok && v.claims.tr).toBe(Math.floor((now + 7 * DAY) / 1000));
  });

  it('family: four devices, and a fifth is told there is no seat', async () => {
    const { paddle, claim } = await world();
    const s = subOf({ plan: 'family-yearly' });
    paddle.subs.set(s.id, s);
    const t = txnOf({ plan: 'family-yearly', subscription_id: s.id });
    paddle.txns.set(t.id, t);
    for (const d of [D0, D1, D2, D3]) expect((await claim(t.id, d)).status).toBe(200);
    const fifth = await claim(t.id, (DIDS as unknown as string[])[4] as string);
    expect(fifth.status).toBe(409);
    expect(fifth.body['error']).toBe('limit');
  });

  it('waits while the payment is still going through, and says so instead of failing', async () => {
    const { paddle, claim } = await world();
    const t = txnOf({ plan: 'pro-monthly', status: 'paid', subscription_id: null });
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    expect(a.status).toBe(404);
    expect(a.body).toEqual({ error: 'not_found', pending: true });
    const b = await claim(`txn_${id26('9')}`, D0);
    expect(b.body).toEqual({ error: 'not_found' });
  });

  it('a transaction of another product is not ours; a malformed id never reaches Paddle', async () => {
    const { paddle, claim, post } = await world();
    const t = txnOf({ items: [{ price: { id: `pri_${id26('q')}` } }] });
    paddle.txns.set(t.id, t);
    expect((await claim(t.id, D0)).body['error']).toBe('not_found');
    const before = paddle.calls.length;
    expect((await post(API.paddle, { txn: 'txn_../../customers' })).status).toBe(400);
    expect((await post(API.paddle, { txn: 'nope' })).status).toBe(400);
    expect(paddle.calls.length).toBe(before);
  });

  it('Paddle being down is "try again", never a refusal; a purchase checked before still gets a token (B2)', async () => {
    const { w, paddle, claim, refresh } = await world();
    const t = txnOf({});
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    paddle.down = true;
    expect((await claim(t.id, D1)).body['error']).toBe('upstream');
    w.clock.advance(DAY);
    const r = await refresh(String(a.body['key']), D0);
    expect(r.status).toBe(200);                                    // the stale path: checked a day ago
  });
});

describe('a second purchase of a plan the buyer already has (double payment)', () => {
  it('lifetime: the new payment is refunded in full and the first purchase\'s key comes back', async () => {
    const { paddle, claim } = await world();
    const first = txnOf({ id: `txn_${id26('1')}` });
    const second = txnOf({ id: `txn_${id26('2')}` });
    paddle.txns.set(first.id, first);
    paddle.txns.set(second.id, second);
    const a = await claim(second.id, D0);
    expect(a.status).toBe(200);
    expect(a.body['duplicate']).toBe(true);
    expect(String(a.body['key'])).toMatch(/^pdl-t-1{26}-/);
    expect(paddle.refunds).toEqual([expect.objectContaining({ transaction_id: second.id, action: 'refund', type: 'full' })]);
  });

  it('membership: the second subscription is cancelled at once and its payment refunded; other plans are not duplicates', async () => {
    const { paddle, claim } = await world();
    const old = subOf({ id: `sub_${id26('1')}` });
    const dup = subOf({ id: `sub_${id26('2')}` });
    const yearly = subOf({ id: `sub_${id26('3')}`, plan: 'pro-yearly' });
    for (const s of [old, dup, yearly]) paddle.subs.set(s.id, s);
    const t = txnOf({ id: `txn_${id26('2')}`, plan: 'pro-monthly', subscription_id: dup.id, details: { totals: { grand_total: '799' } } });
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    expect(a.body['duplicate']).toBe(true);
    expect(String(a.body['key'])).toMatch(/^pdl-s-1{26}-/);
    expect(paddle.cancels).toEqual([dup.id]);
    expect(paddle.refunds.map((r) => r.transaction_id)).toEqual([t.id]);
    // an upgrade to yearly is a different plan: no refund
    const ty = txnOf({ id: `txn_${id26('3')}`, plan: 'pro-yearly', subscription_id: yearly.id });
    paddle.txns.set(ty.id, ty);
    const b = await claim(ty.id, D1);
    expect(b.body['duplicate']).toBeUndefined();
    expect(paddle.refunds).toHaveLength(1);
  });

  it('a second purchase that cost nothing (a 100% code) is the first one again: no refund, no "will be refunded" message', async () => {
    const { paddle, claim } = await world();
    const first = txnOf({ id: `txn_${id26('1')}`, details: { totals: { grand_total: '0' } } });
    const second = txnOf({ id: `txn_${id26('2')}`, details: { totals: { grand_total: '0' } } });
    paddle.txns.set(first.id, first);
    paddle.txns.set(second.id, second);
    const a = await claim(second.id, D0);
    expect(a.status).toBe(200);
    expect(a.body['duplicate']).toBeUndefined();
    expect(String(a.body['key'])).toMatch(/^pdl-t-1{26}-/);
    expect(paddle.refunds).toHaveLength(0);
  });

  it('a refunded earlier purchase does not count, and an unreadable list refunds nothing', async () => {
    const { paddle, claim } = await world();
    const refunded = txnOf({ id: `txn_${id26('1')}`, adjustments: [{ action: 'refund', status: 'approved', type: 'full' }] });
    const fresh = txnOf({ id: `txn_${id26('2')}` });
    paddle.txns.set(refunded.id, refunded);
    paddle.txns.set(fresh.id, fresh);
    const a = await claim(fresh.id, D0);
    expect(a.body['duplicate']).toBeUndefined();
    expect(paddle.refunds).toHaveLength(0);
  });
});

describe('Paddle\'s notifications keep the purchases current', () => {
  it('needs a valid signature: wrong secret 401, changed body 401, no secret configured 503', async () => {
    const { w, hook } = await world();
    const e = evt('subscription.canceled', subOf({ status: 'canceled' }));
    expect((await hook(e, { secret: 'pdl_ntfset_wrong' })).status).toBe(401);
    const raw = JSON.stringify(e);
    const r = await w.call('POST', PADDLE_WEBHOOK_PATH, raw.replace('canceled', 'active'), { 'Content-Type': 'application/json', 'Paddle-Signature': await sign(raw) });
    expect(r.status).toBe(401);
    const r2 = await w.call('POST', PADDLE_WEBHOOK_PATH, raw, { 'Content-Type': 'application/json' });
    expect(r2.status).toBe(401);
    delete w.env['PADDLE_WEBHOOK_SECRET'];
    expect((await hook(e)).status).toBe(503);
  });

  it('a cancellation ends Pro at the next check; the same event sent again changes nothing (replay)', async () => {
    const { paddle, claim, refresh, hook } = await world();
    const s = subOf({});
    paddle.subs.set(s.id, s);
    const t = txnOf({ plan: 'pro-monthly', subscription_id: s.id });
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    const key = String(a.body['key']);
    s.status = 'canceled';
    const e = evt('subscription.canceled', { ...s }, new Date(Date.now() + 60_000).toISOString());
    expect((await hook(e)).body).toEqual({ ok: true, applied: 'ended' });
    expect((await hook(e)).body).toEqual({ ok: true, duplicate: true });
    const r = await refresh(key, D0);
    expect(r.status).toBe(403);
    expect(r.body['error']).toBe('ended');
  });

  it('past due keeps Pro while Paddle retries the card', async () => {
    const { paddle, claim, refresh, hook } = await world();
    const s = subOf({});
    paddle.subs.set(s.id, s);
    const t = txnOf({ plan: 'pro-monthly', subscription_id: s.id });
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    s.status = 'past_due';
    expect((await hook(evt('subscription.past_due', { ...s }, new Date(Date.now() + 60_000).toISOString()))).body['applied']).toBe('active');
    expect((await refresh(String(a.body['key']), D0)).status).toBe(200);
  });

  it('an event older than our last look at Paddle is not applied (out of order)', async () => {
    const { paddle, claim, hook } = await world();
    const s = subOf({});
    paddle.subs.set(s.id, s);
    const t = txnOf({ plan: 'pro-monthly', subscription_id: s.id });
    paddle.txns.set(t.id, t);
    await claim(t.id, D0);
    const old = evt('subscription.canceled', { ...s, status: 'canceled' }, '2020-01-01T00:00:00Z');
    expect((await hook(old)).body['applied']).toBe('stale');
  });

  it('a full refund of a lifetime purchase ends it; a partial refund does not; a chargeback does', async () => {
    const { paddle, claim, refresh, hook } = await world();
    const t = txnOf({});
    paddle.txns.set(t.id, t);
    const a = await claim(t.id, D0);
    const key = String(a.body['key']);
    const later = new Date(Date.now() + 60_000).toISOString();
    expect((await hook(evt('adjustment.created', { action: 'refund', status: 'pending_approval', type: 'full', transaction_id: t.id }, later))).body['applied']).toBe('ignored');
    expect((await hook(evt('adjustment.updated', { action: 'refund', status: 'approved', type: 'partial', transaction_id: t.id }, later))).body['applied']).toBe('ignored');
    expect((await refresh(key, D0)).status).toBe(200);
    t.adjustments = [{ action: 'refund', status: 'approved', type: 'full' }];
    expect((await hook(evt('adjustment.updated', { action: 'refund', status: 'approved', type: 'full', transaction_id: t.id }, later))).body['applied']).toBe('refunded');
    const r = await refresh(key, D0);
    expect(r.status).toBe(403);
    expect(r.body['error']).toBe('refunded');
  });

  it('transaction.completed for a lifetime purchase is written down, so the first activation needs no extra call', async () => {
    const { paddle, claim, hook } = await world();
    const t = txnOf({});
    paddle.txns.set(t.id, t);
    expect((await hook(evt('transaction.completed', t, new Date(Date.now() + 1000).toISOString()))).body['applied']).toBe('active');
    expect((await hook(evt('transaction.completed', { ...t, id: `txn_${id26('q')}`, items: [{ price: { id: `pri_${id26('q')}` } }] }))).body['applied']).toBe('ignored');
    expect((await claim(t.id, D0)).status).toBe(200);
  });
});

describe('restore by e-mail and the customer portal', () => {
  it('mails the restore link of every running purchase of that address, in the page\'s language, from info@', async () => {
    const { paddle, post } = await world();
    paddle.customers.set('buyer@example.com', `ctm_${id26('u')}`);
    const s = subOf({});
    paddle.subs.set(s.id, s);
    const r = await post(API.paddleRestore, { email: ' Buyer@Example.com ', lang: 'tr' });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(paddle.mails).toHaveLength(1);
    const m = paddle.mails[0] as { auth: string; body: Record<string, unknown> };
    expect(m.body['to']).toBe('buyer@example.com');
    expect(m.body['from']).toBe('BodyArcade <info@peakappsstudio.com>');
    expect(m.auth).toBe(`Basic ${btoa('info@peakappsstudio.com:alias-password-x')}`);
    expect(m.body['subject']).toBe('BodyArcade Pro bağlantın');
    const link = /https:\/\/bodyarcade\.com\/tr\/pro\/#restore=(pdl-s-[^\s]+)/.exec(String(m.body['text']));
    expect(link).not.toBeNull();
    expect(String(m.body['text'])).not.toMatch(/\bAI\b|Antalya|Türkiye/);
  });

  it('answers the same for an address that bought nothing, and sends nothing', async () => {
    const { paddle, post } = await world();
    expect(await post(API.paddleRestore, { email: 'nobody@example.com', lang: 'en' })).toEqual({ status: 200, body: { ok: true } });
    expect(paddle.mails).toHaveLength(0);
    expect((await post(API.paddleRestore, { email: 'not an address', lang: 'en' })).status).toBe(400);
  });

  it('limits restore mails per address', async () => {
    const { paddle, post } = await world({ limits: true });
    paddle.customers.set('buyer@example.com', `ctm_${id26('u')}`);
    paddle.txns.set(txnOf({}).id, txnOf({}));
    for (let i = 0; i < 3; i++) expect((await post(API.paddleRestore, { email: 'buyer@example.com', lang: 'en' })).status).toBe(200);
    expect((await post(API.paddleRestore, { email: 'buyer@example.com', lang: 'en' })).status).toBe(429);
    expect(paddle.mails).toHaveLength(3);
  });

  it('the restore link from the mail turns Pro on on a new device', async () => {
    const { paddle, post, plan } = await world();
    paddle.customers.set('buyer@example.com', `ctm_${id26('u')}`);
    const t = txnOf({});
    paddle.txns.set(t.id, t);
    await post(API.paddleRestore, { email: 'buyer@example.com', lang: 'en' });
    const key = RESTORE_HASH_RE.exec(new URL(/https:\/\/\S+/.exec(String(paddle.mails[0]?.body['text']))?.[0] as string).hash)?.[1] as string;
    const a = await post(API.activate, { key, did: D2 });
    expect(a.status).toBe(200);
    expect(await plan(a.body['token'], D2)).toBe('lifetime');
  });

  it('without a mail sender the restore says it is unavailable', async () => {
    const { post } = await world({ mail: false });
    expect((await post(API.paddleRestore, { email: 'buyer@example.com', lang: 'en' })).body['error']).toBe('unavailable');
  });

  it('opens the portal on the subscription for a membership and on the overview for lifetime; a forged key gets nothing', async () => {
    const { paddle, claim, post } = await world();
    const s = subOf({});
    paddle.subs.set(s.id, s);
    const ts = txnOf({ id: `txn_${id26('m')}`, plan: 'pro-monthly', subscription_id: s.id });
    paddle.txns.set(ts.id, ts);
    const a = await claim(ts.id, D0);
    expect(await post(API.paddlePortal, { key: a.body['key'] })).toEqual({ status: 200, body: { url: `https://customer-portal.paddle.com/view/${s.id}` } });
    const tl = txnOf({ id: `txn_${id26('l')}` });
    paddle.txns.set(tl.id, tl);
    const b = await claim(tl.id, D1);
    expect(String((await post(API.paddlePortal, { key: b.body['key'] })).body['url'])).toContain('action=overview');
    const forged = String(a.body['key']).slice(0, -2) + (String(a.body['key']).endsWith('00') ? '11' : '00');
    expect((await post(API.paddlePortal, { key: forged })).body['error']).toBe('not_found');
  });
});

describe('the page\'s Paddle settings', () => {
  it('gives the client token and the price of each plan; without a token it is unavailable', async () => {
    const { w } = await world();
    const r = await w.call('GET', API.paddleConfig);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ token: 'live_0123456789abcdefghijklmnopq', environment: 'production', prices: PADDLE_PRICES });
    // the dashboard's current form, "ctkn_" + 26
    w.env['PADDLE_CLIENT_TOKEN'] = 'ctkn_01m6kxgnz85rydbf3fkzq0zc7a';
    expect(await (await w.call('GET', API.paddleConfig)).json()).toMatchObject({ token: 'ctkn_01m6kxgnz85rydbf3fkzq0zc7a', environment: 'production' });
    w.env['PADDLE_CLIENT_TOKEN'] = 'pdl_live_apikey_01abc';          // an API key is never handed to a page
    expect((await w.call('GET', API.paddleConfig)).status).toBe(503);
    delete w.env['PADDLE_CLIENT_TOKEN'];
    expect((await w.call('GET', API.paddleConfig)).status).toBe(503);
  });
  it('every sold plan has a Paddle price', () => {
    for (const plan of ['pro-monthly', 'pro-yearly', 'family-yearly', 'lifetime'] as const) expect(PADDLE_PRICES[plan]).toMatch(/^pri_[0-9a-z]{26}$/);
    expect(new Set(Object.values(PADDLE_PRICES)).size).toBe(4);
  });
});
