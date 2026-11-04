// Paddle Billing on the web: the ONE place for its price ids, the switch of the web checkout and the shape of a Paddle key.
//
// Paddle is the seller of record on the web from 4 Nov 2026 (Gumroad stays for the keys it sold: they keep working).
// The buyer pays in an inline Paddle checkout inside our own panel on the page (packages/web/src/app/paddle-checkout.ts);
// on `checkout.completed` the app sends the transaction id to POST /api/entitlements/paddle, the Worker asks Paddle about
// it and answers with a Paddle key and a token, so Pro turns on with nothing to type. A Paddle key is our own
// licence-key-shaped name for the purchase ("pdl-" + s|t + the Paddle subscription or transaction id + a MAC), so every
// path the app already has for a key (refresh, seats, give a seat back, reset) works for it unchanged. The key is also
// what the one-click "restore" e-mail carries to another device.
//
// The catalog is made by peak-tools/pay-worker/scripts/catalog.mjs (prices = the plans' web list prices in plans.ts, USD,
// taxes included; Paddle shows each buyer the local currency). catalog.test.ts checks that every sold plan has a price id.
import type { PlanId, SoldPlanId } from './plans.ts';

/**
 * THE SWITCH. false: the web checkout stays on the Gumroad product pages and every page says what it said before Paddle (the Pro
 * page, its cancel line, the trial notice). true: the web checkout is Paddle's, in our own panel on the page. It stays false until
 * the Gumroad balance can be paid out (Doruk, 4 Nov 2026: products with Gumroad sales switch together once it is >= $100); the
 * switch is this one line. Before that, Paddle can be turned on for one browser only, to test it on bodyarcade.com itself:
 * open https://bodyarcade.com/pro/#paddle-preview (and #paddle-preview-off to end it; paddle-checkout.ts: paddlePreview), or
 * make a build with BA_PADDLE=1 (vite define __BA_PADDLE__).
 */
// ON since 5 Nov 2026: the Gumroad balance reached $100.52 (the condition above); old Gumroad keys keep working.
export const PADDLE_WEB_CHECKOUT: boolean = true;

/** Paddle price id of each sold plan (product pro_01m6kxtr4ryryyyxngdgny12q9 "BodyArcade", created 4 Nov 2026). */
export const PADDLE_PRICES: Readonly<Record<SoldPlanId, string>> = {
  'pro-monthly': 'pri_01m6kxtrpj5v4j4zdcar9d8rvy',
  'pro-yearly': 'pri_01m6kxtzx7g6p5m6tv3b1dadx0',
  'family-yearly': 'pri_01m6kxts5z321gm46eb76z19ej',
  lifetime: 'pri_01m6kxtscvqrzzs2fya6d8yw6f',
};

/** Days in which a payment is refunded on request (the terms say the same). */
export const PADDLE_REFUND_DAYS = 14;

export const PADDLE_PRICE_RE = /^pri_[0-9a-z]{26}$/;
export const PADDLE_TXN_RE = /^txn_[0-9a-z]{26}$/;
/** pdl-s-<subscription id without "sub_">-<mac> or pdl-t-<transaction id without "txn_">-<mac>. Case does not matter. */
export const PADDLE_KEY_RE = /^pdl-[st]-[0-9a-z]{26}-[0-9a-f]{24}$/i;

export const isPaddleKey = (key: unknown): key is string => typeof key === 'string' && PADDLE_KEY_RE.test(key.trim());

/** The plan a Paddle price sells, or null for a price that is not one of ours. */
export function planOfPaddlePrice(priceId: unknown, prices: Readonly<Record<SoldPlanId, string>> = PADDLE_PRICES): PlanId | null {
  if (typeof priceId !== 'string') return null;
  for (const [plan, id] of Object.entries(prices)) if (id === priceId) return plan as PlanId;
  return null;
}

/** The hash a restore e-mail's link carries: https://bodyarcade.com/pro/#restore=<key>. */
export const RESTORE_HASH_RE = /(?:^#|&)restore=(pdl-[st]-[0-9a-z]{26}-[0-9a-f]{24})(?:&|$)/i;

/** The page a restore link opens, in the reader's language (English has no prefix). */
export function restoreLink(site: string, lang: string, key: string): string {
  const prefix = lang && lang !== 'en' ? `/${lang}` : '';
  return `${site.replace(/\/+$/, '')}${prefix}/pro/#restore=${key}`;
}
