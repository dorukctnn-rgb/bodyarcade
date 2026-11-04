// The parts of the Paddle checkout that run without Paddle's own frame: the per-browser preview switch, a restore link, a claim
// left unfinished by the last visit (and its retries while Paddle finishes the payment), the restore e-mail and the portal.
// The panel and Paddle's frame are covered by the live run on bodyarcade.com (takip/devir/paddle-gecis/NOTLAR.md).
import { describe, expect, it } from 'vitest';
import { createPaddleCheckout, paddlePreview } from './paddle-checkout.ts';

const KEY = `pdl-t-${'a'.repeat(26)}-${'0'.repeat(24)}`;
const TXN = `txn_${'b'.repeat(26)}`;

function fakeWin(hash = '', store: Record<string, string> = {}) {
  const calls: { path: string; body: unknown }[] = [];
  const opened: { url: string; closed: boolean; location: { href: string }; opener: unknown; close(): void }[] = [];
  const w = {
    location: { hash, pathname: '/pro/', search: '' },
    history: { state: null, replaceState(_s: unknown, _t: string, url: string) { w.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } },
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] as string : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    setTimeout: (fn: () => void) => { fn(); return 0; },
    clearTimeout: () => {},
    open: () => { const t = { url: '', closed: false, location: { href: '' }, opener: {}, close() { t.closed = true; } }; opened.push(t); return t; },
    document: {},
  };
  return { w: w as unknown as Window & typeof globalThis, store, calls, opened };
}

function answer(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response);
}

describe('the preview switch for one browser', () => {
  it('#paddle-preview turns it on and remembers it, #paddle-preview-off forgets it; the hash leaves the address', () => {
    const a = fakeWin('#paddle-preview');
    expect(paddlePreview(a.w)).toBe(true);
    expect(a.w.location.hash).toBe('');
    expect(a.store['ba2.paddle.preview']).toBe('1');
    expect(paddlePreview(a.w)).toBe(true);                       // the next visit, no hash
    a.w.location.hash = '#paddle-preview-off';
    expect(paddlePreview(a.w)).toBe(false);
    expect(a.store['ba2.paddle.preview']).toBeUndefined();
    expect(paddlePreview(fakeWin('').w)).toBe(false);           // everyone else
    expect(paddlePreview(fakeWin('#restore=x').w)).toBe(false);
  });
});

describe('after the visit', () => {
  it('a restore link turns Pro on with the key and takes the key out of the address', async () => {
    const f = fakeWin(`#restore=${KEY}`);
    const seen: string[] = [];
    const pro: string[] = [];
    const c = createPaddleCheckout({ win: f.w, t: (k) => k, lang: () => 'en', activate: (k) => { seen.push(k); return Promise.resolve({ ok: true, plan: 'lifetime' }); }, onPro: (p, via) => pro.push(`${p}:${via}`), fetch: () => answer(500, {}) });
    await c.resume();
    expect(seen).toEqual([KEY]);
    expect(pro).toEqual(['lifetime:restore']);
    expect(f.w.location.hash).toBe('');
    expect(c.hasPurchase()).toBe(true);
  });

  it('a restore link that does not work says so and keeps nothing', async () => {
    const f = fakeWin(`#restore=${KEY}`);
    let failed = 0;
    const c = createPaddleCheckout({ win: f.w, t: (k) => k, lang: () => 'en', activate: () => Promise.resolve({ ok: false, code: 'not_found' }), onRestoreFailed: () => { failed++; }, fetch: () => answer(500, {}) });
    await c.resume();
    expect(failed).toBe(1);
    expect(c.hasPurchase()).toBe(false);
  });

  it('a payment whose Pro was not turned on last time is claimed at the next start, waiting while Paddle says "pending"', async () => {
    const f = fakeWin('', { 'ba2.paddle.pending': TXN });
    let n = 0;
    const c = createPaddleCheckout({
      win: f.w, t: (k) => k, lang: () => 'en', retryMs: 1,
      activate: () => Promise.resolve({ ok: true, plan: 'pro-monthly' }),
      fetch: (path) => { if (path.endsWith('/paddle')) { n++; return n < 3 ? answer(404, { error: 'not_found', pending: true }) : answer(200, { key: KEY, plan: 'pro-monthly' }); } return answer(500, {}); },
    });
    await c.resume();
    expect(n).toBe(3);
    expect(f.store['ba2.paddle.pending']).toBeUndefined();
    expect(f.store['ba2.paddle.key']).toBe(KEY);
  });

  it('a claim Paddle refuses (not ours) stops at once and keeps the transaction for nothing else', async () => {
    const f = fakeWin('', { 'ba2.paddle.pending': TXN });
    let n = 0;
    const c = createPaddleCheckout({ win: f.w, t: (k) => k, lang: () => 'en', retryMs: 1, activate: () => Promise.resolve({ ok: true, plan: 'x' }), fetch: () => { n++; return answer(404, { error: 'not_found' }); } });
    await c.resume();
    expect(n).toBe(1);
    expect(c.hasPurchase()).toBe(false);
  });

  it('the restore e-mail is asked for with the page language; the portal opens only on paddle.com', async () => {
    const f = fakeWin('', { 'ba2.paddle.key': KEY });
    const bodies: unknown[] = [];
    let portal = 'https://customer-portal.paddle.com/cpl_1';
    const c = createPaddleCheckout({
      win: f.w, t: (k) => k, lang: () => 'tr', activate: () => Promise.resolve({ ok: true, plan: 'x' }),
      fetch: (path, init) => { bodies.push(JSON.parse(String(init?.body ?? 'null'))); return path.endsWith('/restore') ? answer(200, { ok: true }) : answer(200, { url: portal }); },
    });
    expect(await c.restoreByEmail(' a@b.co ')).toBe('sent');
    expect(bodies[0]).toEqual({ email: 'a@b.co', lang: 'tr' });
    expect(await c.manage()).toBe(true);
    expect(f.opened[0]?.location.href).toBe(portal);
    portal = 'https://evil.example/paddle.com/';
    expect(await c.manage()).toBe(false);
    expect(f.opened[1]?.closed).toBe(true);
  });
});
