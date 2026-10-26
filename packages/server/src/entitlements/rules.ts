// The rules of the entitlement server that do not need a database or the network: how long things last, what a token
// says, when a free trial is running. Pure, so every one of them has a plain test (rules.test.ts).
import { PLANS, type PlanId } from '../../../core/entitlements/plans.ts';
import { MAX_TOKEN_TTL_S, TOKEN_AUD, TOKEN_ISS, type TokenClaims } from '../../../core/entitlements/token.ts';

export const DAY_S = 86_400;
/** A seat that nobody used for this long is free for another device (the app's manager says the same: 90 days of silence). */
export const SEAT_IDLE_S = 90 * DAY_S;
/** An answer from the seller that is younger than this is used as it is, so a family opening the app at once asks once. */
export const RECHECK_S = 600;
/**
 * While the seller cannot be reached, a purchase that was checked this recently still gets tokens, with the old check
 * time in them: a Gumroad or Google outage must not end anyone's Pro. After this the answer is "try again later" and the
 * token the person already holds runs out by itself.
 */
export const STALE_GRACE_S = 14 * DAY_S;
/** A failed call to a seller is not repeated for this long: the next requests go straight to the stale path. */
export const BREAKER_S = 60;
/** The trial reminder is sent this long before the trial ends. */
export const REMINDER_LEAD_S = 2 * DAY_S;
/** Purchases that ended and have no seat left are forgotten after this long. */
export const FORGET_AFTER_S = 180 * DAY_S;

export type PurchaseStatus = 'active' | 'refunded' | 'ended';

/** One row of the purchases table. Times are epoch seconds. */
export interface PurchaseRow {
  sub: string;
  src: 'gumroad' | 'play';
  plan: PlanId;
  product: string;
  status: PurchaseStatus;
  paid_until: number | null;
  checked_at: number;
  first_seen: number;
  started_at: number | null;
  trial_end: number | null;
  test: number;
}

export const sec = (ms: number): number => Math.floor(ms / 1000);

const utf8 = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)));
  let out = '';
  for (const b of d) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Gumroad matches keys without regard to case, so the purchase is named by the key in capitals. */
export const normalizeKey = (key: string): string => key.trim().toUpperCase();

/** A time from a seller (ISO 8601 text or epoch milliseconds as text or number) as epoch seconds; null when it is not one. */
export function timeToSec(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return x > 1e11 ? sec(x) : Math.floor(x);
  if (typeof x !== 'string' || x === '') return null;
  const n = /^\d{10,13}$/.test(x) ? Number(x) : Date.parse(x);
  return Number.isFinite(n) && n > 0 ? (n > 1e11 ? sec(n) : Math.floor(n)) : null;
}

export interface TrialInput {
  plan: PlanId;
  src: 'gumroad' | 'play';
  /** When the purchase began, epoch seconds, if the seller said. */
  startedAt: number | null;
  /** When the current period ends (Play), epoch seconds. */
  expiry: number | null;
  now: number;
  /** What an earlier check concluded (kept: a trial is never "forgotten" and re-discovered). */
  known: number | null;
}

/**
 * When a free trial ends, epoch seconds, or null when none is running. Only the plans that have a trial can have one.
 *   Gumroad  a product with a trial gives it to every first purchase of a buyer, so a purchase that began less than the trial
 *            length ago is in its trial. (A buyer who had the product before gets none and would be told wrongly; that is rare
 *            and the notice only says what the plan's terms say.)
 *   Play     the first period of a subscription that has a trial is the trial itself: a first period of about the trial's
 *            length that has not ended yet.
 */
export function trialEndFor(i: TrialInput): number | null {
  if (i.known !== null) return i.known;
  const days = PLANS[i.plan].trialDays;
  if (!days) return null;
  if (i.src === 'gumroad') {
    if (i.startedAt === null) return null;
    const end = i.startedAt + days * DAY_S;
    return end > i.now ? end : null;
  }
  if (i.startedAt === null || i.expiry === null) return null;
  if (i.expiry <= i.now || i.expiry - i.startedAt > (days + 1) * DAY_S) return null;
  return i.expiry;
}

export interface ClaimOptions {
  /** The latest the token may run to (the stale path: a fixed time after the last real check). */
  expCap?: number;
}

/** The claims of the token for one device. Throws when the purchase has nothing left to grant (the caller checked). */
export function claimsFor(p: PurchaseRow, did: string, now: number, o: ClaimOptions = {}): TokenClaims {
  const info = PLANS[p.plan];
  let exp = now + MAX_TOKEN_TTL_S;
  if (p.paid_until !== null) exp = Math.min(exp, p.paid_until);
  if (o.expCap !== undefined) exp = Math.min(exp, o.expCap);
  if (exp <= now) throw new RangeError('nothing to grant');
  const c: TokenClaims = {
    iss: TOKEN_ISS, aud: TOKEN_AUD, sub: p.sub, did, plan: p.plan, src: p.src, feat: [...info.feat],
    chk: Math.min(p.checked_at, now), iat: now, exp,
  };
  if (p.paid_until !== null) c.pe = p.paid_until;
  if (p.trial_end !== null && p.trial_end > now) c.tr = p.trial_end;
  if (p.test) c.test = true;
  return c;
}

/** The most devices one purchase may be active on. */
export const seatLimit = (plan: PlanId): number => PLANS[plan].devices;
