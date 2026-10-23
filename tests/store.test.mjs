// Tests BodyArcade's Gumroad licence logic (site/game/store.js) with a fake localStorage, a fake
// clock and a fake Gumroad verify endpoint. Run from the repo root: node --test tests/store.test.mjs
import { test, beforeEach } from 'node:test';
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

// Gumroad mock, shaped like the real endpoint (status, ok, json()). By default the Pro (monthly) product
// answers with `purchase` and the Lifetime product says not found with a 404. `answer` switches it to a
// broken day: an HTML 503, a maintenance JSON, a 429, an empty 200, every product not found, and so on.
let purchase = {};
let networkDown = false;
let calls = 0;
let answer = 'normal';
const NOT_FOUND = { success: false, message: 'That license does not exist for the provided product.' };
const reply = (status, body, { html = false } = {}) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => { if (html) throw new SyntaxError('Unexpected token < in JSON at position 0'); return body; },
});
globalThis.fetch = async (url, opts) => {
  calls++;
  if (networkDown) throw new Error('offline');
  const body = new URLSearchParams(opts.body);
  const isMonthly = body.get('product_id') === 'tN-xTHwaZm8bOdcHHBaKbQ==';
  switch (answer) {
    case 'html503': return reply(503, null, { html: true });
    case 'html429': return reply(429, null, { html: true });
    case 'maintenance': return reply(503, { success: false, message: 'Gumroad is down for maintenance.' });
    case 'rate-limit': return reply(429, { success: false, message: 'Too many requests.' });
    case 'empty200': return reply(200, {});
    case 'null200': return reply(200, null);
    case 'odd200': return reply(200, { success: false, message: 'Something unexpected.' });
    case 'not-found-everywhere': return reply(404, NOT_FOUND);
    case 'not-found-then-503': return isMonthly ? reply(404, NOT_FOUND) : reply(503, null, { html: true });
    case 'forbidden': return reply(403, { success: false, message: 'Not allowed.' });
    default: break;
  }
  if (!isMonthly) return reply(404, NOT_FOUND);
  return reply(200, { success: true, uses: 1, purchase: { email: 'buyer@example.com', ...purchase } });
};

const store = await import(process.env.STORE_URL || new URL('../site/game/store.js', import.meta.url).href);
const KEY = 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD';
const DAY = 86400000;
const iso = ms => new RealDate(ms).toISOString();
const NULLS = { subscription_ended_at: null, subscription_cancelled_at: null, subscription_failed_at: null };

beforeEach(() => { mem.clear(); now = Date.parse('2026-10-11T12:00:00Z'); purchase = { ...NULLS }; networkDown = false; calls = 0; answer = 'normal'; });

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

// ── 23 Oct 2026 audit: B2 (a Gumroad hiccup removed a paid licence) ──
const activate = async () => { const r = await store.verifyLicense(KEY); assert.equal(r.ok, true); return r; };
const NOT_VERDICTS = ['html503', 'html429', 'maintenance', 'rate-limit', 'empty200', 'null200', 'odd200', 'not-found-then-503'];

test('B2: an answer that is not Gumroad\'s own verdict never removes a paid licence', async () => {
  for (const a of [...NOT_VERDICTS, 'forbidden']) {
    mem.clear(); answer = 'normal'; now = Date.parse('2026-10-11T12:00:00Z');
    await activate();
    now += 2 * DAY; answer = a; calls = 0;
    await store.refreshLicense();
    assert.ok(calls > 0, a + ': the daily check ran');
    assert.notEqual(store.license(), null, a + ': the key is still stored');
    assert.equal(store.isPro(), true, a + ': Pro stays on');
  }
});

test('B2: those answers are reported as unavailable, never as "key not found", and store nothing', async () => {
  for (const a of NOT_VERDICTS) {
    mem.clear(); answer = a;
    const r = await store.verifyLicense(KEY);
    assert.equal(r.ok, false, a);
    assert.equal(r.reason, 'unavailable', a);
    assert.equal(r.transient, true, a);
    assert.doesNotMatch(r.error, /not found/i, a);
    assert.equal(store.license(), null, a);
  }
});

test('B2: Gumroad saying "not found" for every product still removes the key at the daily check', async () => {
  await activate();
  now += 2 * DAY; answer = 'not-found-everywhere';
  await store.refreshLicense();
  assert.equal(store.license(), null);
});

test('B2: a wrong key typed into the box gets Gumroad\'s own message', async () => {
  answer = 'not-found-everywhere';
  const r = await store.verifyLicense(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
  assert.equal(r.error, NOT_FOUND.message);
});

test('B2: failure reasons are machine readable (refunded, ended, network)', async () => {
  purchase = { ...NULLS, refunded: true };
  assert.equal((await store.verifyLicense(KEY)).reason, 'refunded');
  purchase = { ...NULLS, subscription_ended_at: iso(now - DAY) };
  assert.equal((await store.verifyLicense(KEY)).reason, 'ended');
  networkDown = true;
  const r = await store.verifyLicense(KEY);
  assert.equal(r.reason, 'network');
  assert.equal(r.network, true);
});

test('B2: a refund seen at the daily check removes the key', async () => {
  await activate();
  purchase = { ...NULLS, refunded: true };
  now += 2 * DAY;
  await store.refreshLicense();
  assert.equal(store.license(), null);
});

// ── B1 (a future verifiedAt made Pro permanent) ──
test('B1: a licence dated far in the future is not Pro, and the next check removes a fake key', async () => {
  mem.set('ba_license', JSON.stringify({ key: 'AAAAAAAA-FAKE', product: 'pro', verifiedAt: now + 3.15e11 }));
  assert.equal(store.isPro(), false);
  assert.equal(store.runsLeft(), 5);
  answer = 'not-found-everywhere'; calls = 0;
  await store.refreshLicense();
  assert.ok(calls > 0, 'a future date triggers a re-check instead of being skipped');
  assert.equal(store.license(), null);
});

test('B1: a real key whose stored date drifted into the future is repaired by the next check', async () => {
  await activate();
  mem.set('ba_license', JSON.stringify({ ...store.license(), verifiedAt: now + 3 * DAY }));
  assert.equal(store.isPro(), false);
  await store.refreshLicense();
  assert.equal(store.isPro(), true);
  assert.equal(store.license().verifiedAt, now);
});

test('B1: a clock a few minutes behind is forgiven; the 30 day offline grace still ends', async () => {
  await activate();
  mem.set('ba_license', JSON.stringify({ ...store.license(), verifiedAt: now + 5 * 60000 }));
  calls = 0;
  await store.refreshLicense();
  assert.equal(store.isPro(), true);
  assert.equal(calls, 0, 'no network call for a small clock difference');
  mem.set('ba_license', JSON.stringify({ ...store.license(), verifiedAt: now - 29 * DAY }));
  assert.equal(store.isPro(), true);
  mem.set('ba_license', JSON.stringify({ ...store.license(), verifiedAt: now - 31 * DAY }));
  assert.equal(store.isPro(), false);
});

// ── B4 (a damaged localStorage value froze the results screen) ──
const RUN = { score: 1200, dist: 300, cleared: 9, hits: 1, bestCombo: 4, coins: 5, kcal: 12.5, seconds: 60, complete: true, diff: 'medium', world: 'alps', ts: 1 };
const JUNK = ['oops', 5, null, true, [], {}, [1, 2], { runs: 'x' }];
const KEYS = ['ba_profile', 'ba_settings', 'ba_daily', 'ba_license', 'ba_runs', 'ba_totals', 'ba_best', 'ba_achievements', 'ba_worlds', 'ba_daily_done', 'ba_daily_streak'];

test('B4: a damaged value under any key never throws at boot or at the end of a run', () => {
  for (const k of KEYS) for (const junk of JUNK) {
    mem.clear(); mem.set(k, JSON.stringify(junk));
    const where = `${k} = ${JSON.stringify(junk)}`;
    assert.doesNotThrow(() => {
      store.profile.get(); store.settings.get(); store.isPro(); store.runsLeft(); store.dailyGoal(); store.dailyDone(); store.dailyStreak();
      store.unlocked(); store.totals(); store.runs(); store.best(); store.best('alps'); store.worldsPlayed(); store.license();
    }, where + ' (boot)');
    let res;
    assert.doesNotThrow(() => { store.countRun(); res = store.afterRun({ ...RUN }); }, where + ' (end of run)');
    assert.ok(Array.isArray(res.news), where);
    assert.equal(store.runs().length, 1, where + ': the run was saved over the damaged value');
    assert.equal(store.totals().runs, 1, where);
    assert.equal(store.best('alps'), 1200, where);
  }
});

test('B4: the reproduction from the audit: ba_runs = "oops" no longer breaks recordRun', () => {
  mem.set('ba_runs', JSON.stringify('oops'));
  assert.deepEqual(store.runs(), []);
  assert.doesNotThrow(() => store.afterRun({ ...RUN }));
  assert.equal(store.runs().length, 1);
});

test('B4: bad entries inside a list are dropped and good ones kept', () => {
  mem.set('ba_runs', JSON.stringify([RUN, 'x', null, { score: '9', world: 'alps' }, { score: 5 }, { ...RUN, score: 7, dist: 'far' }]));
  const r = store.runs();
  assert.equal(r.length, 2);
  assert.equal(r[1].score, 7);
  assert.equal(r[1].dist, 0, 'a non-numeric field becomes 0');
  mem.set('ba_achievements', JSON.stringify(['first-run', 5, null, {}]));
  assert.deepEqual(store.unlocked(), ['first-run']);
  mem.set('ba_best', JSON.stringify({ alps: 100, desert: 'x', forest: null }));
  assert.equal(store.best(), 100);
  mem.set('ba_daily', JSON.stringify({ '2026-10-11': 'many', '2026-10-10': 2 }));
  assert.equal(store.dailyRuns(), 0);
});

test('B4: a damaged licence keeps its key and is simply due for a re-check', async () => {
  await activate();
  mem.set('ba_license', JSON.stringify({ ...store.license(), verifiedAt: 'yesterday', endsAt: 'soon' }));
  assert.equal(store.isPro(), false);
  assert.equal(store.license().key, KEY);
  assert.equal(store.license().endsAt, undefined);
  await store.refreshLicense();
  assert.equal(store.isPro(), true);
});

test('B4: a damaged value is left in place until the next save overwrites it', () => {
  mem.set('ba_runs', JSON.stringify('oops'));
  store.runs();
  assert.equal(mem.get('ba_runs'), '"oops"');
  store.afterRun({ ...RUN });
  assert.equal(JSON.parse(mem.get('ba_runs')).length, 1);
});

test('B4: afterRun swallows any failure so the results screen can always show', () => {
  assert.deepEqual(store.afterRun(null), { news: [], daily: null });
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  try {
    assert.doesNotThrow(() => { store.afterRun({ ...RUN }); store.countRun(); store.runsLeft(); });
  } finally { globalThis.localStorage = real; }
});
