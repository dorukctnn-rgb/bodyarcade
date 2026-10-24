// The Gumroad products of the plans sold from v2 on: the ONE place where their product ids and checkout links are kept.
//
// They do not exist yet, so every value below is a placeholder written <LIKE_THIS>. A placeholder is never used:
//   - the server asks Gumroad only about products with a real id (the two sold before v2 are always asked, plans.ts),
//   - the paywall offers only plans with a real checkout link (webPlans drops the others),
// so shipping with a placeholder cannot sell or grant anything wrongly. It would however ship a paywall that lacks a plan, so
// catalog.test.ts has a RELEASE GATE: with BA_RELEASE=1 (the production check) it fails while any placeholder is left.
//
// To fill one in: create the product in Gumroad (settings below), copy its product id (shown with the licence key setting;
// Gumroad's licence check wants this id, not the short link) and its link (https://<seller>.gumroad.com/l/<slug>), and
// replace the two placeholders of that plan. Nothing else needs to change.
//
//   pro-monthly    membership, $7.99 every month, no trial
//   pro-yearly     membership, $39.99 every year, 7 day free trial
//   family-yearly  membership, $59.99 every year, 7 day free trial (shown only once the family profiles exist)
//   lifetime       one payment of $119.99
//   (all four: "generate a unique licence key per sale" on; the licence key is what the buyer types into the app)
import { PLANS, type PlanId, type SoldPlanId } from './plans.ts';

export interface GumroadListing {
  /** The product id Gumroad's licence check wants. */
  productId: string;
  /** Where the buyer pays: a link on gumroad.com. */
  checkout: string;
}

export const GUMROAD_CATALOG: Readonly<Record<SoldPlanId, GumroadListing>> = {
  'pro-monthly': { productId: '<GUMROAD_PRODUCT_ID_PRO_MONTHLY>', checkout: '<GUMROAD_CHECKOUT_PRO_MONTHLY>' },
  'pro-yearly': { productId: '<GUMROAD_PRODUCT_ID_PRO_YEARLY>', checkout: '<GUMROAD_CHECKOUT_PRO_YEARLY>' },
  'family-yearly': { productId: '<GUMROAD_PRODUCT_ID_FAMILY_YEARLY>', checkout: '<GUMROAD_CHECKOUT_FAMILY_YEARLY>' },
  lifetime: { productId: '<GUMROAD_PRODUCT_ID_LIFETIME>', checkout: '<GUMROAD_CHECKOUT_LIFETIME>' },
};

/** What Gumroad product ids look like. */
export const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_=-]{8,64}$/;

export const isPlaceholder = (v: string): boolean => /^<[A-Z0-9_]+>$/.test(v);

const SOLD = Object.keys(GUMROAD_CATALOG) as SoldPlanId[];

/** "plan.field" of every value that is still a placeholder (or empty). */
export function placeholdersIn(catalog: Readonly<Record<SoldPlanId, GumroadListing>> = GUMROAD_CATALOG): string[] {
  const out: string[] = [];
  for (const id of SOLD) {
    const l = catalog[id];
    if (l.productId === '' || isPlaceholder(l.productId)) out.push(`${id}.productId`);
    if (l.checkout === '' || isPlaceholder(l.checkout)) out.push(`${id}.checkout`);
  }
  return out;
}

/** Product id -> plan for the listings that have a real id. */
export function productsOf(catalog: Readonly<Record<SoldPlanId, GumroadListing>> = GUMROAD_CATALOG): Record<string, PlanId> {
  const out: Record<string, PlanId> = {};
  for (const id of SOLD) {
    const p = catalog[id].productId;
    if (PRODUCT_ID_PATTERN.test(p) && PLANS[id].sold) out[p] = id;
  }
  return out;
}

/** Plan -> checkout link for the listings that have a real link on gumroad.com. */
export function checkoutOf(catalog: Readonly<Record<SoldPlanId, GumroadListing>> = GUMROAD_CATALOG): Partial<Record<SoldPlanId, string>> {
  const out: Partial<Record<SoldPlanId, string>> = {};
  for (const id of SOLD) {
    const c = catalog[id].checkout;
    try {
      const u = new URL(c);
      if (u.protocol === 'https:' && (u.hostname === 'gumroad.com' || u.hostname.endsWith('.gumroad.com'))) out[id] = c;
    } catch { /* a placeholder or a typo is not a link */ }
  }
  return out;
}

/** The products of the catalog that exist (the paywall and the licence check use these). */
export const GUMROAD_PRODUCTS: Readonly<Record<string, PlanId>> = productsOf();
export const GUMROAD_CHECKOUT: Readonly<Partial<Record<SoldPlanId, string>>> = checkoutOf();
