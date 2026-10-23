// Tests BodyArcade's Gumroad licence logic (site/game/store.js) with a fake localStorage, a fake
// clock and a fake Gumroad verify endpoint. Runs under Vitest: `npm test` (or `npx vitest run tests/legacy`).
// Moved from tests/store.test.mjs for v2; the cases are unchanged.
import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
let now = Date.parse('2026-10-11T12:00:00Z');
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])); }
  static now() { return now; }
};
Date.parse = RealDate.parse;

// Gumroad mock: the Pro (monthly) product answers with `purchase`; the Lifetime product says not found.
let purchase = {};
let networkDown = false;
let calls = 0;
globalThis.fetch = async (url, opts) => {
  calls++;
  if (networkDown) throw new Error('offline');
  const body = new URLSearchParams(opts.body);
  const isMonthly = body.get('product_id') === 'tN-xTHwaZm8bOdcHHBaKbQ==';
  if (!isMonthly) return { json: async () => ({ success: false, message: 'That license does not exist for the provided product.' }) };
  return { json: async () => ({ success: true, uses: 1, purchase: { email: 'buyer@example.com', ...purchase } }) };
};

const store = await import(process.env.STORE_URL || new URL('../../site/game/store.js', import.meta.url).href);
const KEY = 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD';
const DAY = 86400000;
const iso = ms => new RealDate(ms).toISOString();
const NULLS = { subscription_ended_at: null, subscription_cancelled_at: null, subscription_failed_at: null };

beforeEach(() => { mem.clear(); now = Date.parse('2026-10-11T12:00:00Z'); purchase = { ...NULLS }; networkDown = false; calls = 0; });

test('an active monthly plan is Pro with no end date', async () => {
  const r = await store.verifyLicense(KEY);
  assert.equal(r.ok, true);
  assert.equal(store.isPro(), true);
  assert.equal(store.license().endsAt, undefined);
});

test('a cancelled plan stays Pro until the paid period ends, then stops, even offline', async () => {
  purchase = { ...NULLS, subscription_cancelled_at: iso(now + 10 * DAY) };
  const r = await store.verifyLicense(KEY);
  assert.equal(r.ok, true, 'cancelling must not end Pro at once');
  assert.equal(store.isPro(), true);
  assert.equal(store.license().endsAt, now + 10 * DAY);
  now += 9 * DAY; // the daily check runs while the paid period lasts
  await store.refreshLicense();
  assert.equal(store.isPro(), true, 'still Pro on day 9');
  now += 1 * DAY + 1000; // just past the end of the paid month, no network needed
  networkDown = true;
  assert.equal(store.isPro(), false, 'Pro ends at the end of the paid period');
});

test('after the paid period the next check removes the key', async () => {
  purchase = { ...NULLS, subscription_cancelled_at: iso(now + 3 * DAY) };
  await store.verifyLicense(KEY);
  now += 3 * DAY + 60000;
  calls = 0;
  await store.refreshLicense();
  assert.equal(calls > 0, true, 'checks again as soon as the period is over');
  assert.equal(store.license(), null);
});

test('a plan restarted before the end keeps Pro and drops the end date', async () => {
  purchase = { ...NULLS, subscription_cancelled_at: iso(now + 2 * DAY) };
  await store.verifyLicense(KEY);
  purchase = { ...NULLS }; // the buyer restarted: Gumroad sets the fields back to null
  now += 2 * DAY + 1000;
  assert.equal(store.isPro(), false, 'past the stored end date until re-checked');
  await store.refreshLicense();
  assert.equal(store.isPro(), true);
  assert.equal(store.license().endsAt, undefined);
});

test('a membership whose end date has passed is refused', async () => {
  for (const field of ['subscription_cancelled_at', 'subscription_failed_at', 'subscription_ended_at']) {
    mem.clear();
    purchase = { ...NULLS, [field]: iso(now - DAY) };
    const r = await store.verifyLicense(KEY);
    assert.equal(r.ok, false, field);
    assert.match(r.error, /subscription has ended/);
    assert.equal(store.isPro(), false);
  }
});

test('the earliest end date wins and an unreadable one counts as over', async () => {
  assert.equal(store.subscriptionEnd({ subscription_cancelled_at: iso(now + 5 * DAY), subscription_failed_at: iso(now + 2 * DAY) }), now + 2 * DAY);
  assert.equal(store.subscriptionEnd(NULLS), null);
  assert.equal(store.subscriptionEnd({}), null);
  assert.equal(store.subscriptionEnd({ subscription_cancelled_at: 'not a date' }), 0);
});

test('refunded purchases are refused; network errors keep the key', async () => {
  purchase = { ...NULLS, refunded: true };
  assert.equal((await store.verifyLicense(KEY)).ok, false);
  purchase = { ...NULLS };
  await store.verifyLicense(KEY);
  now += 2 * DAY;
  networkDown = true;
  await store.refreshLicense();
  assert.notEqual(store.license(), null);
  assert.equal(store.isPro(), true);
});

test('the stored licence keeps only a masked email', async () => {
  await store.verifyLicense(KEY);
  assert.ok(!JSON.stringify(store.license()).includes('buyer@example.com'));
});

// Friend challenge links arrive in other people's URLs: only a plain name, a whole score and string ids get through.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
const readC = (c) => { globalThis.location = { search: '?c=' + c, origin: 'https://bodyarcade.com' }; return store.readChallenge(); };

test('a challenge link round-trips', () => {
  globalThis.location = { search: '', origin: 'https://bodyarcade.com' };
  const url = store.challengeLink({ name: 'Ayşe', score: 1234, world: 'alps', diff: 'hard' });
  assert.deepEqual(readC(url.split('?c=')[1]), { name: 'Ayşe', score: 1234, world: 'alps', diff: 'hard' });
});

test('a challenge whose score is not a whole positive number is ignored', () => {
  assert.equal(readC(b64({ n: 'x', s: '<img src=x onerror=alert(1)>', w: 'alps', d: 'medium' })), null);
  assert.equal(readC(b64({ n: 'x', s: 1.5 })), null);
  assert.equal(readC(b64({ n: 'x', s: -5 })), null);
  assert.equal(readC(b64({ n: 'x', s: 1e12 })), null);
});

test('a broken challenge link is ignored without throwing', () => {
  assert.equal(readC('%E0%A4%A'), null);
  assert.equal(readC('not-base64!!'), null);
  assert.equal(readC(b64('just a string')), null);
});

test('challenge names are cut to 20 characters and ids become strings', () => {
  assert.deepEqual(readC(b64({ n: 'A'.repeat(40), s: '250', w: 7, d: null })), { name: 'A'.repeat(20), score: 250, world: '7', diff: '' });
});
