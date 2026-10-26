// Where is this page running: in the browser, or inside the Android app (a Trusted Web Activity) where Google Play is
// the only way to buy? The answer decides what the paywall may show: in the app there is no web shop, no price in the
// code and not a word about Gumroad (Play payments policy).
//
//   strong hint  the page was opened by the app: ?src=twa (the app's start address), a referrer of android-app://<package>,
//                or a flag the app's first page left in sessionStorage (not localStorage: the app and the phone's own
//                Chrome share storage, and a lasting flag would break the web shop for that person)
//   weak hint    getDigitalGoodsService exists on window (plain Chrome on Android may have it too)
//   proof        getDigitalGoodsService('https://play.google.com/billing') answers
//
// With a hint the page is drawn neutral (no shop) until the proof comes in. A strong hint without proof is an app that
// cannot sell (an old Chrome): it says so and never falls back to a web shop. A weak hint without proof is just a browser.
import { PLAY_PACKAGE } from './plans.ts';
import type { DigitalGoodsService } from './providers/play.ts';

export const PLAY_BILLING_URL = 'https://play.google.com/billing';
export const SESSION_FLAG = 'ba_twa';
export const TWA_REFERRER = `android-app://${PLAY_PACKAGE}`;

export interface WindowLike {
  location: { search: string };
  document: { referrer: string };
  sessionStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null;
  getDigitalGoodsService?: (url: string) => Promise<unknown>;
}

export type Hint = 'strong' | 'weak' | 'none';
export type BillingMode = 'web' | 'play' | 'play-unsupported';

export interface BillingEnv {
  mode: BillingMode;
  hint: Hint;
  service: DigitalGoodsService | null;
}

function session(w: WindowLike): NonNullable<WindowLike['sessionStorage']> | null {
  try { return w.sessionStorage ?? null; } catch { return null; }
}

/** Synchronous, before anything is drawn. Remembers a strong hint for the rest of the session. */
export function twaHint(w: WindowLike): Hint {
  let strong = false;
  try { strong = /[?&]src=twa(?:&|$)/.test(w.location.search); } catch { /* no location */ }
  try { if (!strong && typeof w.document.referrer === 'string' && w.document.referrer.startsWith(TWA_REFERRER)) strong = true; } catch { /* no document */ }
  const ss = session(w);
  try { if (!strong && ss?.getItem(SESSION_FLAG) === '1') strong = true; } catch { /* storage blocked */ }
  if (strong) {
    try { ss?.setItem(SESSION_FLAG, '1'); } catch { /* storage blocked */ }
    return 'strong';
  }
  return typeof w.getDigitalGoodsService === 'function' ? 'weak' : 'none';
}

/** What to draw before the proof is in: the browser's paywall only when nothing suggests the app. */
export const provisionalMode = (hint: Hint): 'web' | 'neutral' => (hint === 'none' ? 'web' : 'neutral');

function looksLikeService(x: unknown): x is DigitalGoodsService {
  return typeof x === 'object' && x !== null && typeof (x as DigitalGoodsService).getDetails === 'function' && typeof (x as DigitalGoodsService).listPurchases === 'function';
}

export async function detectBilling(w: WindowLike, hint: Hint = twaHint(w)): Promise<BillingEnv> {
  if (hint === 'none' || typeof w.getDigitalGoodsService !== 'function') {
    return { mode: hint === 'strong' ? 'play-unsupported' : 'web', hint, service: null };
  }
  let service: DigitalGoodsService | null = null;
  try {
    const got = await w.getDigitalGoodsService(PLAY_BILLING_URL);
    service = looksLikeService(got) ? got : null;
  } catch {
    service = null;
  }
  if (service) return { mode: 'play', hint, service };
  return { mode: hint === 'strong' ? 'play-unsupported' : 'web', hint, service: null };
}
