// The record the app keeps of what it was granted, and the rules for how far that record can be trusted (B1, B2).
//
// B1: a record never proves more than what can be checked. A check time in the future is no check at all, a clock that
//     went backwards makes the record unproven until the next online check, and a signed token's own dates (not the
//     stored copies of them) decide when it runs out.
// B2: a failed check never takes Pro away. Only an explicit refusal does (api.ts, isExplicitRefusal). Everything else
//     keeps the record and tries again later.
import type { Entitlement } from '../types/index.ts';
import { isPlanId, type PlanId } from './plans.ts';

export const DAY_MS = 86_400_000;
/** A check made directly with Gumroad (no signed token) is good for 30 days without the network, as on the live site. */
export const DIRECT_GRACE_MS = 30 * DAY_MS;
/** The record is renewed when its last check is a day old. */
export const REFRESH_AFTER_MS = DAY_MS;
/** Device clocks differ a little; this much is not a rewind and not the future. */
export const CLOCK_SLACK_MS = 5 * 60_000;

export type Provider = 'server' | 'gumroad' | 'play';

export interface StoredEntitlement {
  e: Entitlement;
  provider: Provider;
  /** The plan, when the signed token said which. */
  planId: PlanId | null;
  /** Epoch ms of the last successful check with the seller (a signed token's `chk`). */
  verifiedAt: number;
  /** Epoch ms after which the record proves nothing without a new check (a signed token's `exp`). */
  validUntil: number;
  /** Epoch ms when a paid period ends (a cancelled membership), or null. */
  paidUntil: number | null;
  /** The highest clock reading seen while this record was held. */
  seenAt: number;
  /** What a renewal needs: the licence key (null for Google Play, which lists its purchases again). */
  proof: string | null;
}

export type Standing =
  /** Nothing was ever granted. */
  | 'none'
  | 'active'
  /** The last check is older than the record may be used without a new one. */
  | 'expired'
  /** A cancelled membership whose paid period is over. */
  | 'period_over'
  /** The record claims a check in the future (B1). */
  | 'unverified'
  /** The clock went back since the record was last used (B1). */
  | 'clock_back';

export function standingOf(rec: StoredEntitlement | null, now: number): Standing {
  if (!rec) return 'none';
  if (rec.verifiedAt > now + CLOCK_SLACK_MS) return 'unverified';
  if (rec.seenAt > now + CLOCK_SLACK_MS) return 'clock_back';
  if (rec.paidUntil !== null && now >= rec.paidUntil) return 'period_over';
  if (now >= rec.validUntil) return 'expired';
  return 'active';
}

export const isActive = (rec: StoredEntitlement | null, now: number): boolean => standingOf(rec, now) === 'active';

/** The record with the clock reading remembered (never lowered, so a rewound clock cannot erase the memory of it). */
export function noteClock(rec: StoredEntitlement, now: number): StoredEntitlement {
  return now > rec.seenAt ? { ...rec, seenAt: now } : rec;
}

/**
 * Whether to ask the seller again: the last check is a day old, or the record is not active (a cancelled membership
 * may have been restarted, a failed check may have been a hiccup, a clock may have been put right).
 */
export function needsRefresh(rec: StoredEntitlement | null, now: number): boolean {
  if (!rec) return false;
  const standing = standingOf(rec, now);
  if (standing !== 'active') return true;
  return now - rec.verifiedAt >= REFRESH_AFTER_MS;
}

/** The record for a check made directly with Gumroad: its end is the live site's 30 days, or the paid period. */
export function directRecord(e: Entitlement, proof: string, now: number): StoredEntitlement {
  return {
    e,
    provider: 'gumroad',
    planId: null,
    verifiedAt: now,
    validUntil: now + DIRECT_GRACE_MS,
    paidUntil: typeof e.exp === 'number' ? e.exp : null,
    seenAt: now,
    proof,
  };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 4_102_444_800_000;

/** A stored record read back, or null when anything in it is not what this code wrote. */
export function readStored(raw: unknown): StoredEntitlement | null {
  if (!isRecord(raw) || !isRecord(raw['e'])) return null;
  const e = raw['e'];
  const plan = e['plan'];
  if (plan !== 'pro' && plan !== 'family' && plan !== 'lifetime') return null;
  const source = e['source'];
  if (source !== 'gumroad' && source !== 'play' && source !== 'server') return null;
  const ent: Entitlement = { plan, source };
  if (e['founder'] === true) ent.founder = true;
  if (e['exp'] !== undefined) { if (!num(e['exp'])) return null; ent.exp = e['exp']; }
  if (e['token'] !== undefined) { if (typeof e['token'] !== 'string' || e['token'].length > 2048) return null; ent.token = e['token']; }
  const provider = raw['provider'];
  if (provider !== 'server' && provider !== 'gumroad' && provider !== 'play') return null;
  const { verifiedAt, validUntil, seenAt } = raw;
  if (!num(verifiedAt) || !num(validUntil) || !num(seenAt)) return null;
  const paidUntil = raw['paidUntil'];
  if (paidUntil !== null && !num(paidUntil)) return null;
  const proof = raw['proof'];
  if (proof !== null && (typeof proof !== 'string' || proof.length > 120)) return null;
  const planId = raw['planId'];
  return { e: ent, provider, planId: isPlanId(planId) ? planId : null, verifiedAt, validUntil, paidUntil, seenAt, proof };
}
