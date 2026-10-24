// The production check of the Gumroad catalog: it fails a release while a placeholder is left, whatever else is true, and it
// says which ones. The catalog in the repository changes the day the products exist, so nothing in the first half depends on its
// state. The second half is the online check (--online): what Gumroad's pages say about the four products, against a fake Gumroad.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUMROAD_CATALOG, placeholdersIn, type GumroadListing } from '../../packages/core/entitlements/catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS, SOLD_PLAN_IDS, type SoldPlanId } from '../../packages/core/entitlements/plans.ts';

type Catalog = Readonly<Record<SoldPlanId, GumroadListing>>;
interface Problems { placeholders: string[]; malformed: string[]; clashes: string[] }
interface Tool {
  problemsOf(c?: Catalog): Problems;
  report(p: Problems, o?: { release?: boolean }): { lines: string[]; fails: boolean };
}
const toolUrl = new URL('./check-catalog.mjs', import.meta.url);
const tool = (): Promise<Tool> => import(/* @vite-ignore */ toolUrl.href) as Promise<Tool>;

const real = (): Catalog => Object.fromEntries(SOLD_PLAN_IDS.map((id, i) => [id, { productId: `RealProductId${i}==`, checkout: `https://dorukctn.gumroad.com/l/real${i}` }])) as unknown as Catalog;
const with1 = (id: SoldPlanId, l: GumroadListing): Catalog => ({ ...real(), [id]: l });

describe('tools/entitlements/check-catalog.mjs', () => {
  it('finds nothing wrong with four real listings, and the release check passes them', async () => {
    const t = await tool();
    const p = t.problemsOf(real());
    expect(p).toEqual({ placeholders: [], malformed: [], clashes: [] });
    expect(t.report(p, { release: true })).toMatchObject({ fails: false });
    expect(t.report(p).lines.at(-1)).toContain('all four listings are real');
  });

  it('says out loud that the offline check does not know whether Gumroad has published the products', async () => {
    const t = await tool();
    const line = t.report(t.problemsOf(real()), { release: true }).lines.at(-1) ?? '';
    expect(line).toContain('not asked here');
    expect(line).toContain('--online');
  });

  it('fails a release for one placeholder, by plan and field, and does not fail a preview for it', async () => {
    const t = await tool();
    const p = t.problemsOf(with1('lifetime', { productId: '<GUMROAD_PRODUCT_ID_LIFETIME>', checkout: 'https://dorukctn.gumroad.com/l/life' }));
    expect(p.placeholders).toEqual(['lifetime.productId']);
    const release = t.report(p, { release: true });
    expect(release.fails).toBe(true);
    expect(release.lines.join('\n')).toContain('lifetime.productId');
    expect(t.report(p).fails).toBe(false);
  });

  it('counts an empty value as a placeholder', async () => {
    const t = await tool();
    expect(t.problemsOf(with1('pro-yearly', { productId: '', checkout: '' })).placeholders).toEqual(['pro-yearly.productId', 'pro-yearly.checkout']);
  });

  it('fails even a preview for a value that is filled in wrongly', async () => {
    const t = await tool();
    const p = t.problemsOf(with1('pro-monthly', { productId: 'has spaces', checkout: 'http://dorukctn.gumroad.com/l/x' }));
    expect(p.malformed).toEqual(['pro-monthly.productId', 'pro-monthly.checkout']);
    expect(t.report(p).fails).toBe(true);
    const evil = t.problemsOf(with1('family-yearly', { productId: 'RealProductId9==', checkout: 'https://gumroad.com.evil.net/l/x' }));
    expect(evil.malformed).toEqual(['family-yearly.checkout']);
  });

  it('fails for an id used twice and for an id of a product sold before v2', async () => {
    const t = await tool();
    const twice = t.problemsOf({ ...real(), 'pro-yearly': { ...real()['pro-monthly'], checkout: 'https://dorukctn.gumroad.com/l/other' } });
    expect(twice.clashes).toEqual(['pro-yearly.productId is the same as pro-monthly.productId']);
    const old = Object.keys(GUMROAD_LEGACY_PRODUCTS)[0] as string;
    const reused = t.problemsOf(with1('lifetime', { productId: old, checkout: 'https://dorukctn.gumroad.com/l/life' }));
    expect(reused.clashes).toEqual(['lifetime.productId is the id of a product sold before v2']);
    expect(t.report(reused).fails).toBe(true);
  });

  it('judges the catalog of the repository the same way as the release test of catalog.test.ts', async () => {
    const t = await tool();
    const mine = t.problemsOf(GUMROAD_CATALOG);
    expect(mine.placeholders).toEqual(placeholdersIn());
    expect(mine.malformed).toEqual([]);
    expect(mine.clashes).toEqual([]);
  });

  it('as a command: --release exits 1 exactly while a placeholder is left, a plain run exits 0 for a catalog that is not wrong', () => {
    const file = fileURLToPath(toolUrl);
    const run = (...args: string[]) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 30_000 });
    const open = placeholdersIn().length > 0;
    const release = run('--release');
    expect(release.status).toBe(open ? 1 : 0);
    expect(release.stdout).toContain('Gumroad catalog:');
    if (open) expect(release.stdout).toContain(placeholdersIn()[0]);
    expect(run().status).toBe(0);
    expect(release.stdout).not.toContain('read-only requests');                          // without --online it never goes near the network
  }, 40_000);
});

// ───────────────────────── asking Gumroad (--online) ─────────────────────────
// Nothing here goes to the network: Gumroad is a fake that answers with pages shaped like the real ones.

interface OnlineResult { plan: SoldPlanId; state: string; note: string; differences: string[] }
type Fetch = (url: string, init?: Record<string, unknown>) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;
interface OnlineTool {
  productOfPage(html: unknown): Record<string, unknown> | null;
  differencesOf(plan: SoldPlanId, product: Record<string, unknown>): string[];
  inspectListing(plan: SoldPlanId, listing: GumroadListing, o?: { fetch?: Fetch; timeoutMs?: number }): Promise<OnlineResult>;
  checkOnline(catalog?: Catalog, o?: { fetch?: Fetch; timeoutMs?: number }): Promise<OnlineResult[]>;
  onlineReport(results: OnlineResult[], o?: { requirePublished?: boolean }): { lines: string[]; fails: boolean };
}
type Answer = { status: number; body?: string } | Error;
const online = (): Promise<OnlineTool> => import(/* @vite-ignore */ toolUrl.href) as Promise<OnlineTool>;

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A checkout page the way Gumroad ships it: the data of the page as JSON in the data-page attribute. */
const pageOf = (product: unknown): string => `<!doctype html><html><body><div id="app" data-page="${escapeAttr(JSON.stringify({ component: 'Products/Show', props: { product } }))}"></div></body></html>`;

/** What Gumroad's four draft pages said on 24 Oct 2026 (the fields the check reads), keyed by plan. */
const DRAFTS: Record<SoldPlanId, Record<string, unknown>> = {
  'pro-monthly': {
    id: 'NjWhPyuanXYky8f4SZgeVA==', is_published: false, currency_code: 'usd', price_cents: 0, native_type: 'membership', is_tiered_membership: true, is_recurring_billing: true, is_licensed: true, free_trial: null,
    recurrences: { default: 'monthly', enabled: [{ recurrence: 'monthly', price_cents: 0 }] },
    options: [{ name: 'Pro', recurrence_price_values: { monthly: { price_cents: 799, suggested_price_cents: null } } }],
  },
  'pro-yearly': {
    id: 'vJlIu8u1WHv6S5isuCiWJA==', is_published: false, currency_code: 'usd', price_cents: 0, native_type: 'membership', is_tiered_membership: true, is_recurring_billing: true, is_licensed: true,
    free_trial: { duration: { unit: 'week', amount: 1 } },
    recurrences: { default: 'yearly', enabled: [{ recurrence: 'yearly', price_cents: 0 }] },
    options: [{ name: 'Pro', recurrence_price_values: { yearly: { price_cents: 3999, suggested_price_cents: null } } }],
  },
  'family-yearly': {
    id: 'XoCbwP9lkdun1UaDOStN6w==', is_published: false, currency_code: 'usd', price_cents: 0, native_type: 'membership', is_tiered_membership: true, is_recurring_billing: true, is_licensed: true, free_trial: null,
    recurrences: { default: 'yearly', enabled: [{ recurrence: 'yearly', price_cents: 0 }] },
    options: [{ name: 'Family', recurrence_price_values: { yearly: { price_cents: 5999, suggested_price_cents: null } } }],
  },
  lifetime: {
    id: 'HKSLtNdYrdDg7tlhRFmAGw==', is_published: false, currency_code: 'usd', price_cents: 11999, native_type: 'digital', is_tiered_membership: false, is_recurring_billing: false, is_licensed: true, free_trial: null,
    recurrences: null, options: [],
  },
};
const draftOf = (plan: SoldPlanId): Record<string, unknown> => DRAFTS[plan];
const published = (plan: SoldPlanId, over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...draftOf(plan), is_published: true, ...over });

/** A Gumroad that answers each address as told (an address it does not know answers 404) and records what it was asked. */
function gumroad(answers: Record<string, Answer>): { fetch: Fetch; asked: { url: string; init: Record<string, unknown> | undefined }[] } {
  const asked: { url: string; init: Record<string, unknown> | undefined }[] = [];
  const fetch: Fetch = async (url, init) => {
    asked.push({ url, init });
    const a = answers[url];
    if (a === undefined) return { status: 404, ok: false, text: async () => 'Page not found (404)' };
    if (a instanceof Error) throw a;
    return { status: a.status, ok: a.status >= 200 && a.status < 300, text: async () => a.body ?? '' };
  };
  return { fetch, asked };
}
/** Every listing of `catalog` answers with the page of its plan's product, as `of` makes it. */
const serving = (catalog: Catalog, of: (plan: SoldPlanId) => unknown): Record<string, Answer> =>
  Object.fromEntries(SOLD_PLAN_IDS.map((id) => [catalog[id].checkout, { status: 200, body: pageOf(of(id)) } as Answer]));

/** The four listings as they are in Gumroad now (what the catalog of the repository says today; kept here so this file does not move with it). */
const LISTED: Catalog = {
  'pro-monthly': { productId: 'NjWhPyuanXYky8f4SZgeVA==', checkout: 'https://dorukctn.gumroad.com/l/bodyarcade-pro-monthly' },
  'pro-yearly': { productId: 'vJlIu8u1WHv6S5isuCiWJA==', checkout: 'https://dorukctn.gumroad.com/l/bodyarcade-pro-yearly' },
  'family-yearly': { productId: 'XoCbwP9lkdun1UaDOStN6w==', checkout: 'https://dorukctn.gumroad.com/l/bodyarcade-family' },
  lifetime: { productId: 'HKSLtNdYrdDg7tlhRFmAGw==', checkout: 'https://dorukctn.gumroad.com/l/bodyarcade-pro-lifetime' },
};

describe('tools/entitlements/check-catalog.mjs --online: what Gumroad says about the four products', () => {
  it('reads the data a Gumroad page carries, with its HTML escapes, and nothing from a page without it', async () => {
    const t = await online();
    const product = { id: 'AbCdEfGh12==', name: 'Pro "monthly" & more <b>', is_published: true };
    expect(t.productOfPage(pageOf(product))).toEqual(product);
    expect(t.productOfPage('<html><body>no data here</body></html>')).toBeNull();
    expect(t.productOfPage('<div data-page="{not json"></div>')).toBeNull();
    expect(t.productOfPage('<div data-page="{&quot;props&quot;:{}}"></div>')).toBeNull();
    expect(t.productOfPage(undefined)).toBeNull();
  });

  it('the products Gumroad really had on 24 Oct match the ids of the catalog and what the paywall promises (price, period, key, trial)', async () => {
    const t = await online();
    for (const id of SOLD_PLAN_IDS) {
      expect(draftOf(id)['id'], id).toBe(LISTED[id].productId);
      expect(t.differencesOf(id, draftOf(id)), id).toEqual([]);
    }
    // and the same through the whole check: drafts are drafts, nothing is wrong with them
    const g = gumroad(serving(LISTED, draftOf));
    const results = await t.checkOnline(LISTED, { fetch: g.fetch });
    expect(results.map((r) => [r.plan, r.state])).toEqual(SOLD_PLAN_IDS.map((id) => [id, 'unpublished']));
  });

  it('the catalog of the repository is, once the products exist, the pair the drafts say (it is not allowed to drift from Gumroad)', () => {
    const real = placeholdersIn().length === 0;
    if (!real) return;                                                                  // while a placeholder is left there is nothing to compare
    expect(GUMROAD_CATALOG).toEqual(LISTED);
  });

  it('four published products that match are live: no warning, no failure, and the launch gate passes', async () => {
    const t = await online();
    const g = gumroad(serving(LISTED, (id) => published(id)));
    const results = await t.checkOnline(LISTED, { fetch: g.fetch });
    expect(results.map((r) => r.state)).toEqual(['live', 'live', 'live', 'live']);
    for (const gate of [false, true]) {
      const r = t.onlineReport(results, { requirePublished: gate });
      expect(r.fails).toBe(false);
      expect(r.lines.join('\n')).toContain('all four are live');
      expect(r.lines.join('\n')).not.toMatch(/WARNING|WRONG/);
    }
  });

  it('a product that is not published yet is a WARNING said out loud: never a failure, never a silent pass; only the launch gate fails it', async () => {
    const t = await online();
    const g = gumroad(serving(LISTED, (id) => (id === 'lifetime' ? published(id) : draftOf(id))));
    const results = await t.checkOnline(LISTED, { fetch: g.fetch });
    expect(results.map((r) => r.state)).toEqual(['unpublished', 'unpublished', 'unpublished', 'live']);
    const plain = t.onlineReport(results);
    expect(plain.fails).toBe(false);
    expect(plain.lines.filter((l) => l.includes('WARNING')).length).toBe(3);
    expect(plain.lines.join('\n')).toContain('is_published: false');
    expect(plain.lines.join('\n')).toContain('3 of 4 not live yet');
    const gate = t.onlineReport(results, { requirePublished: true });
    expect(gate.fails).toBe(true);
    expect(gate.lines.join('\n')).toContain('LAUNCH GATE: 3 of 4');
  });

  it('a link that answers "not found" is a warning too, and says what that can mean', async () => {
    const t = await online();
    const g = gumroad({ ...serving(LISTED, (id) => published(id)), [LISTED['pro-yearly'].checkout]: { status: 404, body: 'Page not found (404) - Gumroad' } });
    const results = await t.checkOnline(LISTED, { fetch: g.fetch });
    expect(results.map((r) => r.state)).toEqual(['live', 'not_found', 'live', 'live']);
    const r = t.onlineReport(results);
    expect(r.fails).toBe(false);
    expect(r.lines.join('\n')).toMatch(/pro-yearly\s+WARNING: the link answers 404 "not found"/);
    expect(r.lines.join('\n')).toContain('not published yet, or a wrong link');
    expect(t.onlineReport(results, { requirePublished: true }).fails).toBe(true);
  });

  it('nothing is passed in silence when Gumroad cannot be asked: no answer, an error status or a page that changed shape say so, and fail nothing', async () => {
    const t = await online();
    const g = gumroad({
      [LISTED['pro-monthly'].checkout]: new Error('fetch failed'),
      [LISTED['pro-yearly'].checkout]: { status: 503, body: 'try later' },
      [LISTED['family-yearly'].checkout]: { status: 200, body: '<html>a page without the data</html>' },
    });
    const results = await t.checkOnline(LISTED, { fetch: g.fetch });
    expect(results.map((r) => r.state)).toEqual(['unreachable', 'unreachable', 'unreadable', 'not_found']);
    const r = t.onlineReport(results);
    expect(r.fails).toBe(false);
    expect(r.lines.filter((l) => l.includes('WARNING')).length).toBe(4);
    expect(r.lines.join('\n')).toContain('nothing was checked');
    expect(r.lines.join('\n')).toContain('did Gumroad change its page?');
  });

  it('a page that does not say whether the product is published is not taken for a published one', async () => {
    const t = await online();
    const { is_published: _gone, ...noFlag } = draftOf('lifetime');
    const g = gumroad({ [LISTED.lifetime.checkout]: { status: 200, body: pageOf(noFlag) } });
    const r = await t.inspectListing('lifetime', LISTED.lifetime, { fetch: g.fetch });
    expect(r.state).toBe('unreadable');
    expect(r.note).toContain('does not say whether the product is published');
  });

  it('asks about nothing that is still a placeholder, and says so', async () => {
    const t = await online();
    const g = gumroad({});
    const c: Catalog = { ...LISTED, lifetime: { productId: '<GUMROAD_PRODUCT_ID_LIFETIME>', checkout: '<GUMROAD_CHECKOUT_LIFETIME>' } };
    const results = await t.checkOnline(c, { fetch: g.fetch });
    expect(results[3]?.state).toBe('placeholder');
    expect(g.asked.map((a) => a.url)).not.toContain('<GUMROAD_CHECKOUT_LIFETIME>');
    expect(g.asked).toHaveLength(3);
    const rep = t.onlineReport(results.slice(3));
    expect(rep.lines.join('\n')).toContain('nothing to ask');
    expect(t.onlineReport(results.slice(3), { requirePublished: true }).fails).toBe(true);
  });

  it('only reads: one GET of the checkout page of each listing, no body, no cookie, nothing else is asked, and it gives up', async () => {
    const t = await online();
    const g = gumroad(serving(LISTED, (id) => published(id)));
    await t.checkOnline(LISTED, { fetch: g.fetch });
    expect(g.asked.map((a) => a.url).sort()).toEqual(SOLD_PLAN_IDS.map((id) => LISTED[id].checkout).sort());
    for (const a of g.asked) {
      expect(a.init?.['method']).toBeUndefined();                                       // a GET
      expect(a.init?.['body']).toBeUndefined();
      expect(Object.keys((a.init?.['headers'] ?? {}) as object).map((k) => k.toLowerCase()).sort()).toEqual(['accept', 'user-agent']);
      expect(a.init?.['signal']).toBeInstanceOf(AbortSignal);
    }
  });

  describe('what is WRONG even before launch day (a failure, because it would sell or promise the wrong thing)', () => {
    const differencesWith = async (plan: SoldPlanId, over: Record<string, unknown>): Promise<string[]> => (await online()).differencesOf(plan, { ...draftOf(plan), ...over });

    it('another product behind the link: the id of the page is not the id of the catalog', async () => {
      const t = await online();
      const g = gumroad(serving(LISTED, (id) => (id === 'pro-yearly' ? { ...draftOf(id), id: 'SomeOtherProduct1==' } : draftOf(id))));
      const results = await t.checkOnline(LISTED, { fetch: g.fetch });
      const bad = results.find((r) => r.plan === 'pro-yearly');
      expect(bad?.state).toBe('wrong');
      expect(bad?.differences[0]).toContain('SomeOtherProduct1==');
      const rep = t.onlineReport(results);
      expect(rep.fails).toBe(true);
      expect(rep.lines.join('\n')).toMatch(/pro-yearly\s+WRONG/);
      expect(rep.lines.join('\n')).toContain('3 of 4 not live yet');
    });

    it('a finding wins over "not published": the page is readable, so what it says is believed', async () => {
      const t = await online();
      const g = gumroad({ [LISTED.lifetime.checkout]: { status: 200, body: pageOf({ ...draftOf('lifetime'), price_cents: 9900 }) } });
      const r = await t.inspectListing('lifetime', LISTED.lifetime, { fetch: g.fetch });
      expect(r.state).toBe('wrong');
      expect(r.differences).toEqual(['price is 99, the app says 119.99']);
    });

    it('a price that is not the paywall\'s, in a membership tier and in the one payment', async () => {
      expect(await differencesWith('pro-monthly', { options: [{ name: 'Pro', recurrence_price_values: { monthly: { price_cents: 899 } } }] })).toEqual(['tier "Pro" costs 8.99 monthly, the app says 7.99']);
      expect(await differencesWith('lifetime', { price_cents: 9900 })).toEqual(['price is 99, the app says 119.99']);
      expect(await differencesWith('family-yearly', { options: [] })).toEqual(['no tier with a price']);
    });

    it('a billing period the app does not sell: a yearly product that also bills monthly, a monthly one billed yearly', async () => {
      expect(await differencesWith('pro-yearly', { recurrences: { default: 'yearly', enabled: [{ recurrence: 'yearly' }, { recurrence: 'monthly' }] } })).toEqual(['billing periods are [yearly, monthly], the app sells yearly only']);
      expect(await differencesWith('pro-monthly', { recurrences: { default: 'yearly', enabled: [{ recurrence: 'yearly' }] } })).toEqual(['billing periods are [yearly], the app sells monthly only']);
    });

    it('a trial the app does not promise, a trial that is missing, a trial of another length', async () => {
      expect(await differencesWith('family-yearly', { free_trial: { duration: { unit: 'week', amount: 1 } } })).toEqual(['has a free trial, the app promises none for family-yearly']);
      expect(await differencesWith('pro-yearly', { free_trial: null })).toEqual(['free trial is off, the app promises 7 days']);
      expect(await differencesWith('pro-yearly', { free_trial: { duration: { unit: 'week', amount: 2 } } })).toEqual(['free trial is 14 days, the app promises 7 days']);
      expect(await differencesWith('pro-yearly', { free_trial: { duration: { unit: 'day', amount: 7 } } })).toEqual([]);   // 7 days is 7 days however Gumroad counts it
    });

    it('no licence key block, another currency, a membership where one payment is sold, a one-off where a membership is', async () => {
      expect(await differencesWith('lifetime', { is_licensed: false })).toEqual(['no licence key block (is_licensed is not true): a buyer would get no key to type into the app']);
      expect(await differencesWith('pro-monthly', { currency_code: 'eur' })).toEqual(['currency is eur, the app says USD']);
      expect(await differencesWith('lifetime', { native_type: 'membership', is_recurring_billing: true })).toEqual(['it is a membership that bills again, the app sells one payment']);
      expect(await differencesWith('pro-monthly', { native_type: 'digital' })).toEqual(['it is a digital, the app sells a membership']);
    });
  });
});
