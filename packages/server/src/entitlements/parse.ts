// What a request body may say. The Worker's routes check bodies with these before the Durable Object sees them, and the
// engine checks again, so a body that reaches the database has always been through here. Unknown fields are ignored.
import {
  DID_RE, EMAIL_RE, LICENSE_KEY_RE, MAX_EMAIL_LENGTH, MAX_PURCHASES, PRODUCT_ID_RE, PURCHASE_TOKEN_RE, REMINDER_LANGS,
  type PlayPurchaseRef, type ReminderLang,
} from '../../../core/entitlements/api.ts';
import { PLAY_PRODUCTS } from '../../../core/entitlements/plans.ts';

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export type Parsed<T> = { ok: true; value: T } | { ok: false };
const no = { ok: false } as const;

const didOf = (x: unknown): string | null => (typeof x === 'string' && DID_RE.test(x) ? x : null);

export interface KeyBody { key: string; did: string }
export function parseKeyBody(x: unknown): Parsed<KeyBody> {
  if (!isRecord(x)) return no;
  const did = didOf(x['did']);
  const key = typeof x['key'] === 'string' ? x['key'].trim() : '';
  return did && LICENSE_KEY_RE.test(key) ? { ok: true, value: { key, did } } : no;
}

/** A list of Play purchases: malformed entries and products we do not sell are dropped, duplicates collapse, at most MAX_PURCHASES stay. */
export function parsePurchases(x: unknown): PlayPurchaseRef[] {
  if (!Array.isArray(x)) return [];
  const out: PlayPurchaseRef[] = [];
  const seen = new Set<string>();
  for (const p of x) {
    if (!isRecord(p)) continue;
    const productId = p['productId'];
    const purchaseToken = p['purchaseToken'];
    if (typeof productId !== 'string' || !PRODUCT_ID_RE.test(productId) || !Object.hasOwn(PLAY_PRODUCTS, productId)) continue;
    if (typeof purchaseToken !== 'string' || !PURCHASE_TOKEN_RE.test(purchaseToken) || seen.has(purchaseToken)) continue;
    seen.add(purchaseToken);
    out.push({ productId, purchaseToken });
    if (out.length >= MAX_PURCHASES) break;
  }
  return out;
}

export interface PlayBody { did: string; purchases: PlayPurchaseRef[] }
export function parsePlayBody(x: unknown): Parsed<PlayBody> {
  if (!isRecord(x)) return no;
  const did = didOf(x['did']);
  const purchases = parsePurchases(x['purchases']);
  return did && purchases.length > 0 ? { ok: true, value: { did, purchases } } : no;
}

export interface DeactivateBody { token: string; did: string }
export function parseDeactivateBody(x: unknown): Parsed<DeactivateBody> {
  if (!isRecord(x)) return no;
  const did = didOf(x['did']);
  const token = x['token'];
  return did && typeof token === 'string' && token.length >= 20 && token.length <= 2048 ? { ok: true, value: { token, did } } : no;
}

export type ResetBody = { did: string } & ({ key: string; purchases?: undefined } | { purchases: PlayPurchaseRef[]; key?: undefined });
export function parseResetBody(x: unknown): Parsed<ResetBody> {
  if (!isRecord(x)) return no;
  const did = didOf(x['did']);
  if (!did) return no;
  if (x['key'] !== undefined) {
    const key = typeof x['key'] === 'string' ? x['key'].trim() : '';
    return LICENSE_KEY_RE.test(key) ? { ok: true, value: { did, key } } : no;
  }
  const purchases = parsePurchases(x['purchases']);
  return purchases.length > 0 ? { ok: true, value: { did, purchases } } : no;
}

/** The address as it will be used: trimmed, with the domain in lower case. null: not an address. */
export function cleanEmail(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  if (t.length === 0 || t.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(t)) return null;
  const at = t.lastIndexOf('@');
  return `${t.slice(0, at)}@${t.slice(at + 1).toLowerCase()}`;
}

/** 'tr-TR' and 'TR' are Turkish; a language we have no mail in is English. */
export function reminderLang(x: unknown): ReminderLang {
  const l = typeof x === 'string' ? x.slice(0, 2).toLowerCase() : '';
  return (REMINDER_LANGS as readonly string[]).includes(l) ? (l as ReminderLang) : 'en';
}

export interface ReminderBody { token: string; did: string; email: string | null; lang: ReminderLang }
export function parseReminderBody(x: unknown): Parsed<ReminderBody> {
  if (!isRecord(x)) return no;
  const did = didOf(x['did']);
  const token = x['token'];
  if (!did || typeof token !== 'string' || token.length < 20 || token.length > 2048) return no;
  const lang = reminderLang(x['lang']);
  if (x['email'] === null) return { ok: true, value: { token, did, email: null, lang } };
  const email = cleanEmail(x['email']);
  return email ? { ok: true, value: { token, did, email, lang } } : no;
}
