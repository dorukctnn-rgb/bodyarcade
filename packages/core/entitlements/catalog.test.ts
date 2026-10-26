import { describe, expect, it } from 'vitest';
import {
  GUMROAD_CATALOG, GUMROAD_CHECKOUT, GUMROAD_PRODUCTS, PRODUCT_ID_PATTERN, checkoutOf, isPlaceholder, placeholdersIn, productsOf, type GumroadListing,
} from './catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS, SOLD_PLAN_IDS, webPlans, type SoldPlanId } from './plans.ts';

type Catalog = Readonly<Record<SoldPlanId, GumroadListing>>;
const real = (n: number): Catalog => Object.fromEntries(SOLD_PLAN_IDS.map((id, i) => [id, { productId: `RealProduct${n}${i}Id==`, checkout: `https://dorukctn.gumroad.com/l/p${n}${i}` }])) as unknown as Catalog;

describe('the Gumroad catalog', () => {
  it('has one listing for each plan that is sold, and no other', () => {
    expect(Object.keys(GUMROAD_CATALOG).sort()).toEqual([...SOLD_PLAN_IDS].sort());
  });

  it('writes every value that is not real as a <PLACEHOLDER>, which the release check can find', () => {
    for (const [plan, l] of Object.entries(GUMROAD_CATALOG)) {
      for (const [field, v] of Object.entries(l)) {
        expect(isPlaceholder(v) || (field === 'productId' ? PRODUCT_ID_PATTERN.test(v) : /^https:\/\/[a-z0-9-]+\.gumroad\.com\/l\/[A-Za-z0-9_-]+$/.test(v)), `${plan}.${field} = ${v}`).toBe(true);
      }
    }
  });

  it('names its placeholders by plan and field', () => {
    expect(placeholdersIn(real(1))).toEqual([]);
    const half: Catalog = { ...real(1), lifetime: { productId: '<GUMROAD_PRODUCT_ID_LIFETIME>', checkout: 'https://dorukctn.gumroad.com/l/life' } };
    expect(placeholdersIn(half)).toEqual(['lifetime.productId']);
    const empty: Catalog = { ...real(1), 'pro-yearly': { productId: '', checkout: '' } };
    expect(placeholdersIn(empty)).toEqual(['pro-yearly.productId', 'pro-yearly.checkout']);
  });

  it('uses a placeholder for nothing: the tables derived from it hold real values only', () => {
    for (const [id, plan] of Object.entries(GUMROAD_PRODUCTS)) { expect(isPlaceholder(id)).toBe(false); expect(SOLD_PLAN_IDS).toContain(plan); }
    for (const url of Object.values(GUMROAD_CHECKOUT)) expect(isPlaceholder(url)).toBe(false);
    expect(productsOf(real(2))).toEqual({
      'RealProduct20Id==': 'pro-monthly', 'RealProduct21Id==': 'pro-yearly', 'RealProduct22Id==': 'family-yearly', 'RealProduct23Id==': 'lifetime',
    } satisfies Record<string, SoldPlanId>);
    expect(productsOf(GUMROAD_CATALOG)).toEqual(GUMROAD_PRODUCTS);
  });

  it('drops a product id that is not an id and a checkout that is not a link on gumroad.com', () => {
    const bad: Catalog = {
      'pro-monthly': { productId: 'short', checkout: 'http://dorukctn.gumroad.com/l/x' },
      'pro-yearly': { productId: 'has spaces in it', checkout: 'https://gumroad.com.evil.net/l/x' },
      'family-yearly': { productId: '<X>', checkout: 'javascript:alert(1)' },
      lifetime: { productId: 'GoodProductId01=', checkout: 'https://gumroad.com/l/ok' },
    };
    expect(productsOf(bad)).toEqual({ 'GoodProductId01=': 'lifetime' });
    expect(checkoutOf(bad)).toEqual({ lifetime: 'https://gumroad.com/l/ok' });
  });

  it('never lists a product id twice, nor one of the two sold before v2', () => {
    const ids = Object.values(GUMROAD_CATALOG).map((l) => l.productId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const legacy of Object.keys(GUMROAD_LEGACY_PRODUCTS)) expect(ids).not.toContain(legacy);
  });

  it('a placeholder checkout never reaches the paywall: the plan is simply not offered', () => {
    expect(webPlans({ checkout: GUMROAD_CHECKOUT, family: true }).offers.every((o) => o.checkout.web !== undefined && !isPlaceholder(o.checkout.web))).toBe(true);
    expect(webPlans({ checkout: { 'pro-yearly': '<GUMROAD_CHECKOUT_PRO_YEARLY>' } }).offers).toEqual([]);
    expect(webPlans({ checkout: checkoutOf(real(3)), family: true }).offers.map((o) => o.id)).toEqual(['pro-monthly', 'pro-yearly', 'family-yearly', 'lifetime']);
  });

  // The production check runs this with BA_RELEASE=1. While the Gumroad products do not exist, the test is listed as skipped.
  it.skipIf(process.env['BA_RELEASE'] !== '1')('RELEASE GATE: no Gumroad placeholder ships', () => {
    expect(placeholdersIn(), 'create these products in Gumroad and replace the placeholders in packages/core/entitlements/catalog.ts').toEqual([]);
  });
});
