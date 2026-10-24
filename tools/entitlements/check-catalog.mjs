// The production check of the Gumroad catalog (packages/core/entitlements/catalog.ts): are the four plans that are sold
// really in Gumroad, and are they the products the app thinks they are?
//
//   node tools/entitlements/check-catalog.mjs                      offline: print the state of the four listings; exit 1 only for a
//                                                                  listing that is wrong (a malformed id or link, an id used twice, an
//                                                                  old product reused)
//   node tools/entitlements/check-catalog.mjs --release            the same, and exit 1 while ANY placeholder is left: the line the
//                                                                  production deploy runs before it replaces the live site
//   node tools/entitlements/check-catalog.mjs --online             also ask Gumroad, read-only, about each checkout page: does the
//                                                                  id belong to the link, are the price, the billing period, the
//                                                                  licence key block and the trial the ones the app promises, and is
//                                                                  the product published yet?
//   node tools/entitlements/check-catalog.mjs --require-published  --online, and exit 1 for a product that is not published: the
//                                                                  launch-day gate (never part of CI)
//
// What a state means online (checked against the real pages on 24 Oct 2026):
//   live          the page loads, says is_published: true and everything matches.
//   unpublished   the page loads but says is_published: false (how Gumroad shows a draft). A WARNING, never a failure: until launch
//                 day that is the expected state, and CI does not ask Gumroad at all.
//   not found     the link answers 404 (a draft that is not reachable, or a wrong link). A WARNING for the same reason.
//   unreachable / unreadable   Gumroad did not answer, or its page changed shape: nothing was checked, and it says so. A WARNING.
//   WRONG         the page is readable and differs from the catalog or the app (another product id behind that link, a price that is
//                 not the paywall's, a trial the app does not promise, no licence key block): exit 1, because that would sell the
//                 wrong thing or leave a buyer with no key to type in.
//
// A placeholder never sells or grants anything (the server asks Gumroad only about real ids, the paywall offers only plans with a
// real link), so shipping one cannot go wrong quietly; it ships a paywall that lacks a plan. That is what --release stops.
// The same gate lives in catalog.test.ts (BA_RELEASE=1 npx vitest run packages/core/entitlements/catalog.test.ts).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GUMROAD_CATALOG, PRODUCT_ID_PATTERN, checkoutOf, isPlaceholder, placeholdersIn } from '../../packages/core/entitlements/catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS, PLANS, SOLD_PLAN_IDS } from '../../packages/core/entitlements/plans.ts';

/**
 * What is wrong with a catalog, in three lists of "plan.field" (or a sentence for the duplicates):
 *   placeholders  still <LIKE_THIS> or empty: Doruk has not created the product yet
 *   malformed     filled in but not what Gumroad gives (the id's characters, a link that is not on gumroad.com over https)
 *   clashes       an id used for two plans, or one of the two products sold before v2
 */
export function problemsOf(catalog = GUMROAD_CATALOG) {
  const placeholders = placeholdersIn(catalog);
  const malformed = [];
  const clashes = [];
  const links = checkoutOf(catalog);
  for (const id of SOLD_PLAN_IDS) {
    const l = catalog[id];
    if (!placeholders.includes(`${id}.productId`) && !PRODUCT_ID_PATTERN.test(l.productId)) malformed.push(`${id}.productId`);
    if (!placeholders.includes(`${id}.checkout`) && links[id] === undefined) malformed.push(`${id}.checkout`);
  }
  const seen = new Map();
  for (const id of SOLD_PLAN_IDS) {
    const v = catalog[id].productId;
    if (v === '' || isPlaceholder(v)) continue;
    if (Object.hasOwn(GUMROAD_LEGACY_PRODUCTS, v)) clashes.push(`${id}.productId is the id of a product sold before v2`);
    if (seen.has(v)) clashes.push(`${id}.productId is the same as ${seen.get(v)}.productId`);
    else seen.set(v, id);
  }
  return { placeholders, malformed, clashes };
}

/** The lines the command prints and whether it fails. */
export function report(problems, { release = false } = {}) {
  const lines = [];
  const { placeholders, malformed, clashes } = problems;
  for (const id of SOLD_PLAN_IDS) {
    const state = [`${id}.productId`, `${id}.checkout`].map((f) => (placeholders.includes(f) ? 'placeholder' : malformed.includes(f) ? 'malformed' : 'ok'));
    lines.push(`  ${id.padEnd(14)} product id: ${state[0]}, checkout link: ${state[1]}`);
  }
  for (const m of malformed) lines.push(`  malformed: ${m}`);
  for (const c of clashes) lines.push(`  clash: ${c}`);
  const wrong = malformed.length + clashes.length > 0;
  const open = placeholders.length > 0;
  let fails = wrong;
  if (open && release) {
    fails = true;
    lines.push(`  RELEASE: ${placeholders.length} placeholder(s) left (${placeholders.join(', ')}). Create the products in Gumroad and replace them in packages/core/entitlements/catalog.ts.`);
  } else if (open) {
    lines.push(`  ${placeholders.length} placeholder(s) left; fine for a preview, not for production (--release fails on them).`);
  }
  if (!wrong && !open) lines.push('  all four listings are real (whether Gumroad has published them is not asked here: add --online)');
  return { lines, fails };
}

// ───────────────────────── asking Gumroad ─────────────────────────

const ONLINE_TIMEOUT_MS = 15_000;
const ENTITIES = { quot: '"', '#39': "'", '#x27': "'", lt: '<', gt: '>', amp: '&' };
const TRIAL_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

/** The `product` of a Gumroad checkout page: the page carries its data as JSON in the data-page attribute. Null when it is not there. */
export function productOfPage(html) {
  if (typeof html !== 'string') return null;
  const m = /data-page="([^"]*)"/.exec(html);
  if (!m) return null;
  try {
    const page = JSON.parse(m[1].replace(/&(quot|#39|#x27|lt|gt|amp);/g, (_, e) => ENTITIES[e]));
    const product = page?.props?.product;
    return product !== null && typeof product === 'object' ? product : null;
  } catch {
    return null;
  }
}

const trialDaysOf = (t) => {
  const unit = TRIAL_UNIT_DAYS[t?.duration?.unit];
  const amount = t?.duration?.amount;
  return unit !== undefined && Number.isFinite(amount) ? unit * amount : null;
};

/** Where the page differs from what the app promises about the plan (plans.ts): a list of sentences, empty when it matches. */
export function differencesOf(plan, product) {
  const info = PLANS[plan];
  const out = [];
  const cents = Math.round(info.price * 100);
  if (String(product.currency_code ?? '').toLowerCase() !== 'usd') out.push(`currency is ${product.currency_code}, the app says USD`);
  if (product.is_licensed !== true) out.push('no licence key block (is_licensed is not true): a buyer would get no key to type into the app');
  if (info.period === 'once') {
    if (product.native_type !== 'digital' || product.is_recurring_billing === true) out.push(`it is a ${product.native_type} that bills again, the app sells one payment`);
    if (product.price_cents !== cents) out.push(`price is ${Number(product.price_cents) / 100}, the app says ${info.price}`);
  } else {
    const recurrence = info.period === 'month' ? 'monthly' : 'yearly';
    if (product.native_type !== 'membership') out.push(`it is a ${product.native_type}, the app sells a membership`);
    const enabled = Array.isArray(product.recurrences?.enabled) ? product.recurrences.enabled.map((e) => e?.recurrence) : [];
    if (enabled.length !== 1 || enabled[0] !== recurrence) out.push(`billing periods are [${enabled.join(', ')}], the app sells ${recurrence} only`);
    const tiers = Array.isArray(product.options) ? product.options : [];
    if (tiers.length === 0) out.push('no tier with a price');
    for (const tier of tiers) {
      const c = tier?.recurrence_price_values?.[recurrence]?.price_cents;
      if (c !== cents) out.push(`tier "${tier?.name}" costs ${c === undefined ? 'nothing set' : c / 100} ${recurrence}, the app says ${info.price}`);
    }
  }
  const trial = trialDaysOf(product.free_trial);
  const promised = info.trialDays ?? null;
  if (promised === null && product.free_trial) out.push(`has a free trial, the app promises none for ${plan}`);
  if (promised !== null && trial !== promised) out.push(`free trial is ${trial === null ? 'off' : `${trial} days`}, the app promises ${promised} days`);
  return out;
}

/**
 * Asks Gumroad about one listing (a read-only GET of its checkout page). Never throws.
 * state: 'live' | 'unpublished' | 'not_found' | 'unreachable' | 'unreadable' | 'wrong' | 'placeholder'
 */
export async function inspectListing(plan, listing, { fetch: get = globalThis.fetch, timeoutMs = ONLINE_TIMEOUT_MS } = {}) {
  if (isPlaceholder(listing.productId) || isPlaceholder(listing.checkout) || listing.productId === '' || listing.checkout === '') {
    return { plan, state: 'placeholder', note: 'still a placeholder: nothing to ask', differences: [] };
  }
  let res;
  try {
    res = await get(listing.checkout, { headers: { 'user-agent': 'BodyArcade-catalog-check/1', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { plan, state: 'unreachable', note: `no answer from Gumroad (${e instanceof Error ? e.message : String(e)}); nothing was checked`, differences: [] };
  }
  if (res.status === 404) return { plan, state: 'not_found', note: 'the link answers 404 "not found" (a draft that is not published yet, or a wrong link)', differences: [] };
  if (!res.ok) return { plan, state: 'unreachable', note: `Gumroad answers HTTP ${res.status}; nothing was checked`, differences: [] };
  let html;
  try { html = await res.text(); } catch (e) {
    return { plan, state: 'unreachable', note: `the page could not be read (${e instanceof Error ? e.message : String(e)}); nothing was checked`, differences: [] };
  }
  const product = productOfPage(html);
  if (!product) return { plan, state: 'unreadable', note: 'the page has no product data this check can read (did Gumroad change its page?); look at it by hand', differences: [] };
  const differences = [];
  if (product.id !== listing.productId) differences.push(`the catalog says product id ${listing.productId}, the page behind that link says ${String(product.id)}`);
  differences.push(...differencesOf(plan, product));
  if (differences.length > 0) return { plan, state: 'wrong', note: 'the page is not the product the app expects', differences };
  if (product.is_published === true) return { plan, state: 'live', note: 'published; id, price, billing period, licence key block and trial match the app', differences: [] };
  if (product.is_published === false) return { plan, state: 'unpublished', note: 'not published yet (the page says is_published: false); the id, price, billing period, licence key block and trial match the app', differences: [] };
  return { plan, state: 'unreadable', note: 'the page does not say whether the product is published', differences: [] };
}

/** One result per sold plan, in the plans' order. */
export function checkOnline(catalog = GUMROAD_CATALOG, options = {}) {
  return Promise.all(SOLD_PLAN_IDS.map((id) => inspectListing(id, catalog[id], options)));
}

/** The lines for the results and whether the command fails: only for a page that is WRONG, or for anything not live with `requirePublished`. */
export function onlineReport(results, { requirePublished = false } = {}) {
  const lines = [];
  let wrong = 0;
  let notLive = 0;
  for (const r of results) {
    const head = `  ${r.plan.padEnd(14)}`;
    if (r.state === 'live') { lines.push(`${head} live: ${r.note}`); continue; }
    notLive += 1;
    if (r.state === 'wrong') {
      wrong += 1;
      lines.push(`${head} WRONG: ${r.note}`);
      for (const d of r.differences) lines.push(`                   - ${d}`);
    } else if (r.state === 'placeholder') {
      lines.push(`${head} ${r.note}`);
    } else {
      lines.push(`${head} WARNING: ${r.note}`);
    }
  }
  let fails = wrong > 0;
  const open = notLive - wrong;                                  // not live, and nothing wrong with them: the expected state before launch day
  if (notLive === 0) lines.push('  all four are live and match the app');
  else if (open > 0) lines.push(`  ${open} of ${results.length} not live yet or not checked: a warning until launch day (publish each product in Gumroad before the production deploy); --require-published makes it a failure`);
  if (requirePublished && notLive > 0) {
    fails = true;
    lines.push(`  LAUNCH GATE: ${notLive} of ${results.length} product(s) are not live. Publish them in Gumroad, then run this again.`);
  }
  return { lines, fails };
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(here).href) {
  const args = process.argv.slice(2);
  const requirePublished = args.includes('--require-published');
  const online = requirePublished || args.includes('--online');
  const out = report(problemsOf(), { release: args.includes('--release') });
  console.log('Gumroad catalog:');
  for (const line of out.lines) console.log(line);
  let fails = out.fails;
  if (online) {
    console.log('Gumroad checkout pages (read-only requests):');
    const on = onlineReport(await checkOnline(), { requirePublished });
    for (const line of on.lines) console.log(line);
    fails = fails || on.fails;
  }
  process.exit(fails ? 1 : 0);
}
