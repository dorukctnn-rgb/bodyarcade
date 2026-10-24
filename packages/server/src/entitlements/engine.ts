// The entitlement engine: what the Worker answers when the app asks "may this device have Pro?". It knows nothing about
// HTTP or Cloudflare; it is given a SqlDb, a clock, the signing key and the two sellers, and returns { status, body }.
//
// The rules it keeps (each has tests in engine.test.ts):
//   - Only the SHA-256 of a licence key or Play purchase token is stored, never the key, the token or an address of a device's owner.
//   - A purchase is active on at most as many devices as its plan says (Pro 3, Family 4, Founder 6). The check and the
//     taking of a seat happen in one synchronous transaction after the seller has answered, so two requests cannot both
//     take the last seat. A seat nobody used for 90 days is free again.
//   - B2: only the seller's own "no" refuses (refunded, ended, not found, no seat). A seller that cannot be reached, a 5xx, a
//     429, a page that is not JSON, a purchase the seller denies knowing but we have seen before: none of these refuses anyone.
//     A purchase we checked within 14 days still gets a token while the seller is down (with the old check time in it).
//   - A token lives at most 7 days and never past the end of a paid period.
import { ERROR_STATUS, type ErrorCode, type PlayPurchaseRef } from '../../../core/entitlements/api.ts';
import { judgePurchase, type GumroadPurchase } from '../../../core/entitlements/gumroad-rules.ts';
import { PLANS, PLAY_PRODUCTS, type PlanId } from '../../../core/entitlements/plans.ts';
import { signToken } from '../../../core/entitlements/sign.ts';
import { verifyToken, type TokenKey } from '../../../core/entitlements/token.ts';
import { metaGet, metaSet, type SqlDb } from './db.ts';
import { reminderMail, type MailSender } from './mail.ts';
import type { DeactivateBody, KeyBody, PlayBody, ReminderBody, ResetBody } from './parse.ts';
import {
  BREAKER_S, DAY_S, FORGET_AFTER_S, RECHECK_S, REMINDER_LEAD_S, SEAT_IDLE_S, STALE_GRACE_S,
  claimsFor, normalizeKey, seatLimit, sec, sha256Hex, timeToSec, trialEndFor, type PurchaseRow, type PurchaseStatus,
} from './rules.ts';
import type { GumroadUpstream } from './upstream/gumroad.ts';
import type { PlayUpstream } from './upstream/play.ts';

export interface EngineResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface Signer { kid: string; key: CryptoKey }

export type LogFn = (evt: string, data: Record<string, unknown>) => void;

export interface EngineDeps {
  db: SqlDb;
  /** Epoch milliseconds. */
  now: () => number;
  /** Null: no signing key is configured, so nothing can be granted. */
  signer: Signer | null;
  /** The public keys that verify tokens (the signing key's own, and older ones still on devices). */
  publicKeys: readonly TokenKey[];
  /** Gumroad product id -> plan, in the order the products are tried. */
  products: ReadonlyMap<string, PlanId>;
  gumroad: GumroadUpstream;
  /** Null: Play purchases cannot be checked here. */
  play: PlayUpstream | null;
  /** Null: no reminder e-mails. */
  mail: MailSender | null;
  /** Tests: lifts the per-address limits. */
  noLimits?: boolean;
  log?: LogFn;
}

export interface SweepReport {
  seatsFreed: number;
  purchasesForgotten: number;
  remindersSent: number;
  remindersDropped: number;
  remindersRetried: number;
}

export interface Engine {
  /** A licence key on a device (the first time, and again at every renewal: the server keeps no key). */
  grantKey(body: KeyBody, ip: string, mode?: 'activate' | 'refresh'): Promise<EngineResult>;
  grantPlay(body: PlayBody, ip: string): Promise<EngineResult>;
  deactivate(body: DeactivateBody): Promise<EngineResult>;
  reset(body: ResetBody, ip: string): Promise<EngineResult>;
  reminder(body: ReminderBody, ip: string): Promise<EngineResult>;
  keys(): EngineResult;
  /** Housekeeping and the reminder mails that are due. Called from the Durable Object's alarm. */
  sweep(): Promise<SweepReport>;
  /** When the next reminder is due, epoch ms, or null. */
  nextDue(): number | null;
}

const ok = (body: Record<string, unknown>): EngineResult => ({ status: 200, body });
const fail = (code: ErrorCode, extra?: Record<string, unknown>, headers?: Record<string, string>): EngineResult =>
  ({ status: ERROR_STATUS[code], body: { error: code, ...extra }, ...(headers ? { headers } : {}) });

/** What the seller says about a purchase, in the engine's own terms (times in epoch seconds). */
interface Facts {
  plan: PlanId;
  product: string;
  paidUntil: number | null;
  startedAt: number | null;
  /** The end of the current period (Play); only used to tell a trial. */
  expiry: number | null;
  test: boolean;
}

type Judged =
  | { kind: 'active'; facts: Facts; ack: boolean }
  | { kind: 'refused'; code: 'refunded' | 'ended' | 'not_found' }
  | { kind: 'pending' }
  | { kind: 'unreadable' };

const factsOfRow = (r: PurchaseRow): Facts => ({ plan: r.plan, product: r.product, paidUntil: r.paid_until, startedAt: r.started_at, expiry: null, test: r.test === 1 });

interface Window { w: number; n: number }

const LIMITS = {
  /** activate, refresh and play together, per address. */
  grant: { windowS: 600, max: 60 },
  /** Unknown keys: each costs up to one call per product at the seller. */
  miss: { windowS: 600, max: 12 },
  reset: { windowS: 3600, max: 6 },
  reminder: { windowS: 3600, max: 10 },
} as const;
type Bucket = keyof typeof LIMITS;
/** One purchase may give its seats back this often. */
const RESETS_PER_DAY = 3;
const MAX_REMINDERS_PER_SWEEP = 25;
const REMINDER_RETRY_S = 3600;
const REMINDER_MAX_TRIES = 5;
const MAX_MEM_KEYS = 20_000;

export function createEngine(deps: EngineDeps): Engine {
  const { db } = deps;
  const log: LogFn = deps.log ?? ((evt, data) => console.log(JSON.stringify({ evt: `ent_${evt}`, ...data })));
  const windows = new Map<string, Window>();
  const breaker: Record<'gumroad' | 'play', number> = { gumroad: 0, play: 0 };

  // The salt that makes an address hash useless outside this database; made once and kept.
  let salt = metaGet(db, 'salt');
  if (!salt) {
    salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    metaSet(db, 'salt', salt);
  }

  // ───────── limits (in memory: one Durable Object serves everything, and a restart only forgives) ─────────
  async function ipKey(ip: string): Promise<string> {
    return ip ? (await sha256Hex(`${salt}:${ip}`)).slice(0, 16) : 'local';
  }

  /** Counts one more hit; the seconds to wait when the limit is used up, else 0. */
  function hit(bucket: Bucket, key: string, nowMs: number, count = true): number {
    if (deps.noLimits) return 0;
    const lim = LIMITS[bucket];
    const k = `${bucket}:${key}`;
    const e = windows.get(k);
    if (!e || nowMs - e.w >= lim.windowS * 1000) {
      if (count) {
        if (windows.size >= MAX_MEM_KEYS) windows.clear();
        windows.set(k, { w: nowMs, n: 1 });
      }
      return 0;
    }
    if (e.n >= lim.max) return Math.max(1, Math.ceil((e.w + lim.windowS * 1000 - nowMs) / 1000));
    if (count) e.n++;
    return 0;
  }

  const limited = (wait: number): EngineResult => fail('rate_limited', { retryAfter: wait }, { 'Retry-After': String(wait) });

  // ───────── database ─────────
  const getRow = (sub: string): PurchaseRow | null => db.one<PurchaseRow>('SELECT * FROM purchases WHERE sub = ?1', sub);

  function writeRow(p: PurchaseRow): void {
    db.run(
      `INSERT INTO purchases (sub, src, plan, product, status, paid_until, checked_at, first_seen, started_at, trial_end, test)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (sub) DO UPDATE SET src = excluded.src, plan = excluded.plan, product = excluded.product, status = excluded.status,
         paid_until = excluded.paid_until, checked_at = excluded.checked_at, started_at = COALESCE(excluded.started_at, started_at),
         trial_end = COALESCE(excluded.trial_end, trial_end), test = excluded.test`,
      p.sub, p.src, p.plan, p.product, p.status, p.paid_until, p.checked_at, p.first_seen, p.started_at, p.trial_end, p.test,
    );
  }

  const seatCount = (sub: string): number => db.one<{ n: number }>('SELECT COUNT(*) AS n FROM seats WHERE sub = ?1', sub)?.n ?? 0;

  /** Takes (or keeps) this device's seat. Inside a transaction; no awaits. */
  function claimSeat(sub: string, did: string, limit: number, nowS: number): { ok: boolean; used: number } {
    db.run('DELETE FROM seats WHERE sub = ?1 AND last_at < ?2', sub, nowS - SEAT_IDLE_S);
    const have = db.one('SELECT 1 AS x FROM seats WHERE sub = ?1 AND did = ?2', sub, did);
    if (have) {
      db.run('UPDATE seats SET last_at = ?3 WHERE sub = ?1 AND did = ?2 AND last_at < ?4', sub, did, nowS, nowS - 3600);
      return { ok: true, used: seatCount(sub) };
    }
    const used = seatCount(sub);
    if (used >= limit) return { ok: false, used };
    db.run('INSERT INTO seats (sub, did, first_at, last_at) VALUES (?1, ?2, ?3, ?3)', sub, did, nowS);
    return { ok: true, used: used + 1 };
  }

  function rowFrom(sub: string, src: 'gumroad' | 'play', f: Facts, prev: PurchaseRow | null, nowS: number): PurchaseRow {
    const trialEnd = trialEndFor({ plan: f.plan, src, startedAt: f.startedAt, expiry: f.expiry, now: nowS, known: prev?.trial_end ?? null });
    return {
      sub, src, plan: f.plan, product: f.product, status: 'active', paid_until: f.paidUntil, checked_at: nowS,
      first_seen: prev?.first_seen ?? nowS, started_at: f.startedAt ?? prev?.started_at ?? null, trial_end: trialEnd, test: f.test ? 1 : 0,
    };
  }

  /** A refusal from the seller is written down for purchases we know (so a restart of a membership is noticed). */
  function noteRefusal(prev: PurchaseRow | null, status: PurchaseStatus, nowS: number): void {
    if (prev) db.run('UPDATE purchases SET status = ?2, checked_at = ?3 WHERE sub = ?1', prev.sub, status, nowS);
  }

  // ───────── tokens ─────────
  async function issue(row: PurchaseRow, did: string, nowS: number, used: number, expCap?: number): Promise<EngineResult> {
    const signer = deps.signer as Signer;
    const claims = claimsFor(row, did, nowS, expCap !== undefined ? { expCap } : {});
    const token = await signToken(claims, signer.key, signer.kid);
    return ok({ token, plan: row.plan, devices: { used, limit: seatLimit(row.plan) } });
  }

  /** What the seller said is written and the seat taken in one step; then the token is signed. */
  async function grantRow(row: PurchaseRow, did: string, nowS: number, expCap?: number, write = false): Promise<EngineResult> {
    const seat = db.tx(() => {
      if (write) writeRow(row);
      return claimSeat(row.sub, did, seatLimit(row.plan), nowS);
    });
    if (!seat.ok) {
      log('refused', { code: 'limit', src: row.src, plan: row.plan, sub: row.sub.slice(0, 8) });
      return fail('limit', { devices: { used: seat.used, limit: seatLimit(row.plan) } });
    }
    return issue(row, did, nowS, seat.used, expCap);
  }

  /** The stale path: the seller cannot be reached, but this purchase was checked recently and is still good. */
  function staleRow(row: PurchaseRow | null, nowS: number): PurchaseRow | null {
    if (!row || row.status !== 'active') return null;
    if (nowS - row.checked_at > STALE_GRACE_S) return null;
    if (row.paid_until !== null && row.paid_until <= nowS) return null;
    return row;
  }

  async function grantStale(row: PurchaseRow, did: string, nowS: number): Promise<EngineResult> {
    log('stale_grant', { src: row.src, plan: row.plan, sub: row.sub.slice(0, 8), ageDays: Math.floor((nowS - row.checked_at) / DAY_S) });
    return grantRow(row, did, nowS, row.checked_at + STALE_GRACE_S);
  }

  const breakerOpen = (which: 'gumroad' | 'play'): boolean => deps.now() < breaker[which];
  const trip = (which: 'gumroad' | 'play'): void => { breaker[which] = deps.now() + BREAKER_S * 1000; log('upstream_down', { src: which }); };

  // ───────── Gumroad ─────────
  /** The products to try for a key: the one this purchase was last found in first, then the rest in order. */
  function productOrder(prev: PurchaseRow | null): [string, PlanId][] {
    const all = [...deps.products.entries()];
    if (!prev || prev.src !== 'gumroad') return all;
    const first = all.filter(([id]) => id === prev.product);
    return [...first, ...all.filter(([id]) => id !== prev.product)];
  }

  async function judgeGumroad(key: string, prev: PurchaseRow | null): Promise<Judged> {
    if (breakerOpen('gumroad')) return { kind: 'unreadable' };
    let disabled = false;
    let expired = false;
    for (const [productId, plan] of productOrder(prev)) {
      const a = await deps.gumroad.verify(productId, key);
      if (a.kind === 'unreadable') { trip('gumroad'); return { kind: 'unreadable' }; }
      if (a.kind === 'not_found') {
        if (a.reason === 'disabled') disabled = true;
        else if (a.reason === 'expired') expired = true;
        continue;
      }
      const nowMs = deps.now();
      const purchase = a.purchase as GumroadPurchase & Record<string, unknown>;
      const verdict = judgePurchase(purchase, nowMs);
      if (verdict.status === 'refunded') return { kind: 'refused', code: 'refunded' };
      if (verdict.status === 'ended') return { kind: 'refused', code: 'ended' };
      return {
        kind: 'active', ack: false,
        facts: {
          plan, product: productId, paidUntil: verdict.paidUntil !== null ? sec(verdict.paidUntil) : null,
          startedAt: timeToSec(purchase['sale_timestamp'] ?? purchase['created_at']), expiry: null, test: purchase['test'] === true,
        },
      };
    }
    // The seller turned the key off (a refund does that), or revoked access: its own verdict on a key it knows.
    if (disabled) return { kind: 'refused', code: 'refunded' };
    if (expired) return { kind: 'refused', code: 'ended' };
    return { kind: 'refused', code: 'not_found' };
  }

  async function grantKey(body: KeyBody, ip: string, mode: 'activate' | 'refresh' = 'activate'): Promise<EngineResult> {
    if (!deps.signer) return fail('unavailable');
    const nowMs = deps.now();
    const nowS = sec(nowMs);
    const who = await ipKey(ip);
    const wait = hit('grant', who, nowMs);
    if (wait) return limited(wait);
    const sub = await sha256Hex(normalizeKey(body.key));
    const prev = getRow(sub);

    // A recent answer from the seller is used as it is.
    if (prev && prev.src === 'gumroad' && prev.status === 'active' && nowS - prev.checked_at <= RECHECK_S && (prev.paid_until === null || prev.paid_until > nowS)) {
      const r = await grantRow(prev, body.did, nowS);
      if (r.status === 200) log('grant', { mode, src: 'gumroad', plan: prev.plan, sub: sub.slice(0, 8), cached: true });
      return r;
    }

    if (!prev) {
      const wait2 = hit('miss', who, nowMs, false);
      if (wait2) return limited(wait2);
    }

    let judged = await judgeGumroad(body.key, prev);
    if (judged.kind === 'refused' && judged.code === 'not_found' && prev && prev.status === 'active') {
      // A purchase the seller has told us about before cannot simply vanish: this is our setup (a product missing from the
      // list) or a hiccup, never a reason to take Pro away (B2).
      log('known_missing', { src: 'gumroad', sub: sub.slice(0, 8) });
      judged = { kind: 'unreadable' };
    }
    return finish(judged, prev, sub, 'gumroad', body.did, who, nowMs, mode);
  }

  /** What to answer for one judged purchase: a token, a refusal, or "try later". */
  async function finish(judged: Judged, prev: PurchaseRow | null, sub: string, src: 'gumroad' | 'play', did: string, who: string, nowMs: number, mode: string): Promise<EngineResult> {
    const nowS = sec(nowMs);
    switch (judged.kind) {
      case 'active': {
        const row = rowFrom(sub, src, judged.facts, prev, nowS);
        const r = await grantRow(row, did, nowS, undefined, true);
        if (r.status === 200) log('grant', { mode, src, plan: row.plan, sub: sub.slice(0, 8), cached: false, trial: row.trial_end !== null && row.trial_end > nowS });
        return r;
      }
      case 'refused': {
        if (judged.code === 'not_found') {
          hit('miss', who, nowMs);
          log('refused', { code: 'not_found', src });
          return fail('not_found');
        }
        db.tx(() => noteRefusal(prev, judged.code === 'refunded' ? 'refunded' : 'ended', nowS));
        log('refused', { code: judged.code, src, sub: sub.slice(0, 8) });
        return fail(judged.code);
      }
      case 'pending':
        return fail('not_found', { pending: true });
      case 'unreadable': {
        const stale = staleRow(prev, nowS);
        if (stale) return grantStale(stale, did, nowS);
        log('upstream_error', { src, mode });
        return fail('upstream');
      }
    }
  }

  // ───────── Google Play ─────────
  async function judgePlay(ref: PlayPurchaseRef, prev: PurchaseRow | null): Promise<Judged> {
    const play = deps.play;
    if (!play || breakerOpen('play')) return { kind: 'unreadable' };
    const c = await play.check(ref.productId, ref.purchaseToken);
    switch (c.kind) {
      case 'unreadable': trip('play'); return c;
      case 'pending': return c;
      case 'refused': return { kind: 'refused', code: c.code };
      case 'active': {
        const plan = PLAY_PRODUCTS[ref.productId] as PlanId;
        return {
          kind: 'active', ack: !c.acknowledged,
          facts: { plan, product: ref.productId, paidUntil: c.cancelled ? c.expiry : null, startedAt: c.startedAt ?? prev?.started_at ?? null, expiry: c.expiry, test: c.test },
        };
      }
    }
  }

  async function grantPlay(body: PlayBody, ip: string): Promise<EngineResult> {
    if (!deps.signer || !deps.play) return fail('unavailable');
    const nowMs = deps.now();
    const nowS = sec(nowMs);
    const who = await ipKey(ip);
    const wait = hit('grant', who, nowMs);
    if (wait) return limited(wait);

    interface Candidate { sub: string; ref: PlayPurchaseRef; prev: PurchaseRow | null; judged: Judged }
    const cands: Candidate[] = [];
    for (const ref of body.purchases) {
      const sub = await sha256Hex(ref.purchaseToken);
      const prev = getRow(sub);
      let judged: Judged;
      if (prev && prev.src === 'play' && prev.status === 'active' && prev.product === ref.productId && nowS - prev.checked_at <= RECHECK_S && (prev.paid_until === null || prev.paid_until > nowS)) {
        judged = { kind: 'active', facts: factsOfRow(prev), ack: false };
      } else {
        judged = await judgePlay(ref, prev);
        if (judged.kind === 'refused' && judged.code === 'not_found' && prev && prev.status === 'active') {
          log('known_missing', { src: 'play', sub: sub.slice(0, 8) });   // our package name or permissions, not the buyer
          judged = { kind: 'unreadable' };
        }
      }
      cands.push({ sub, ref, prev, judged });
    }

    // Write down what Google said about every purchase, then give the best of the active ones to this device.
    const actives = cands.filter((c): c is Candidate & { judged: Extract<Judged, { kind: 'active' }> } => c.judged.kind === 'active');
    const rows = new Map<string, PurchaseRow>();
    for (const c of actives) rows.set(c.sub, rowFrom(c.sub, 'play', c.judged.facts, c.prev, nowS));
    db.tx(() => {
      for (const r of rows.values()) writeRow(r);
      for (const c of cands) if (c.judged.kind === 'refused' && c.judged.code !== 'not_found') noteRefusal(c.prev, c.judged.code === 'refunded' ? 'refunded' : 'ended', nowS);
    });

    // Play wants every purchase acknowledged within three days or it refunds the buyer.
    const acks = actives.filter((c) => c.judged.ack).slice(0, 4);
    if (acks.length > 0) {
      const results = await Promise.allSettled(acks.map((c) => (deps.play as PlayUpstream).acknowledge(c.ref.productId, c.ref.purchaseToken)));
      results.forEach((r, i) => { if (r.status !== 'fulfilled' || !r.value) log('ack_failed', { sub: (acks[i] as Candidate).sub.slice(0, 8) }); });
    }

    // The best plan first; a purchase whose seats are all taken does not stop a lesser one that has a free seat.
    const byRank = (a: PurchaseRow, b: PurchaseRow): number => PLANS[b.plan].rank - PLANS[a.plan].rank;
    if (actives.length > 0) {
      let full: EngineResult | null = null;
      for (const row of actives.map((c) => rows.get(c.sub) as PurchaseRow).sort(byRank)) {
        const r = await grantRow(row, body.did, nowS);
        if (r.status === 200) { log('grant', { mode: 'play', src: 'play', plan: row.plan, sub: row.sub.slice(0, 8), trial: row.trial_end !== null && row.trial_end > nowS }); return r; }
        if (r.status !== ERROR_STATUS.limit) return r;
        full ??= r;
      }
      return full as EngineResult;
    }

    // Nothing is active. The seller being unreachable decides nothing; a purchase checked recently still counts.
    if (cands.some((c) => c.judged.kind === 'unreadable')) {
      const stale = cands.map((c) => staleRow(c.prev, nowS)).filter((r): r is PurchaseRow => r !== null && r.src === 'play').sort(byRank);
      let full: EngineResult | null = null;
      for (const row of stale) {
        const r = await grantStale(row, body.did, nowS);
        if (r.status !== ERROR_STATUS.limit) return r;
        full ??= r;
      }
      if (full) return full;
      log('upstream_error', { src: 'play', mode: 'play' });
      return fail('upstream');
    }
    if (cands.some((c) => c.judged.kind === 'pending')) return fail('not_found', { pending: true });
    const codes = cands.map((c) => (c.judged.kind === 'refused' ? c.judged.code : 'not_found'));
    const code = codes.includes('ended') ? 'ended' : codes.includes('refunded') ? 'refunded' : 'not_found';
    if (code === 'not_found') hit('miss', who, nowMs);
    log('refused', { code, src: 'play' });
    return fail(code);
  }

  // ───────── giving seats back ─────────
  async function deactivate(body: DeactivateBody): Promise<EngineResult> {
    const r = await verifyToken(body.token, { keys: deps.publicKeys, now: deps.now(), did: body.did });
    const claims = r.ok ? r.claims : r.claims && r.reason === 'expired' ? r.claims : null;       // an expired token still names its seat
    if (!claims || claims.did !== body.did) return fail('bad_request');
    db.run('DELETE FROM seats WHERE sub = ?1 AND did = ?2', claims.sub, body.did);
    return ok({ ok: true });
  }

  async function reset(body: ResetBody, ip: string): Promise<EngineResult> {
    const nowMs = deps.now();
    const who = await ipKey(ip);
    const wait = hit('reset', who, nowMs);
    if (wait) return limited(wait);
    const subs = body.key !== undefined
      ? [await sha256Hex(normalizeKey(body.key))]
      : await Promise.all(body.purchases.map((p) => sha256Hex(p.purchaseToken)));
    const known = subs.filter((s) => getRow(s) !== null);
    if (known.length === 0) return fail('not_found');
    // A shared key could be used to throw each other out all day; a few times a day is enough for losing a phone.
    if (!deps.noLimits) {
      for (const s of known) {
        const k = `resets:${s}`;
        const e = windows.get(k);
        if (!e || nowMs - e.w >= DAY_S * 1000) windows.set(k, { w: nowMs, n: 1 });
        else if (e.n >= RESETS_PER_DAY) return limited(Math.ceil((e.w + DAY_S * 1000 - nowMs) / 1000));
        else e.n++;
      }
    }
    const removed = db.tx(() => {
      let n = 0;
      for (const s of known) {
        n += db.one<{ n: number }>('SELECT COUNT(*) AS n FROM seats WHERE sub = ?1 AND did != ?2', s, body.did)?.n ?? 0;
        db.run('DELETE FROM seats WHERE sub = ?1 AND did != ?2', s, body.did);
      }
      return n;
    });
    log('reset', { removed });
    return ok({ ok: true, removed });
  }

  // ───────── the trial reminder ─────────
  async function reminder(body: ReminderBody, ip: string): Promise<EngineResult> {
    if (!deps.mail) return fail('unavailable');
    const nowMs = deps.now();
    const nowS = sec(nowMs);
    const who = await ipKey(ip);
    const wait = hit('reminder', who, nowMs);
    if (wait) return limited(wait);
    // Only a device that holds a valid token of a purchase may leave an address for it.
    const r = await verifyToken(body.token, { keys: deps.publicKeys, now: nowMs, did: body.did });
    if (!r.ok) return fail('bad_request');
    const sub = r.claims.sub;
    if (body.email === null) {
      db.run('DELETE FROM reminders WHERE sub = ?1', sub);
      return ok({ ok: true, sendAt: null });
    }
    const row = getRow(sub);
    if (!row) return fail('not_found');
    if (row.status !== 'active' || row.trial_end === null || row.trial_end <= nowS || row.paid_until !== null) return fail('no_trial');
    const sendAt = Math.max(nowS, row.trial_end - REMINDER_LEAD_S);
    db.run(
      `INSERT INTO reminders (sub, email, lang, send_at, trial_end, created_at, tries) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
       ON CONFLICT (sub) DO UPDATE SET email = excluded.email, lang = excluded.lang, send_at = excluded.send_at, trial_end = excluded.trial_end, tries = 0`,
      sub, body.email, body.lang, sendAt, row.trial_end, nowS,
    );
    log('reminder_set', { sub: sub.slice(0, 8), lang: body.lang });
    return ok({ ok: true, sendAt: sendAt * 1000 });
  }

  function nextDue(): number | null {
    const r = db.one<{ t: number | null }>('SELECT MIN(send_at) AS t FROM reminders');
    return r?.t != null ? r.t * 1000 : null;
  }

  async function sweep(): Promise<SweepReport> {
    const nowMs = deps.now();
    const nowS = sec(nowMs);
    const report: SweepReport = { seatsFreed: 0, purchasesForgotten: 0, remindersSent: 0, remindersDropped: 0, remindersRetried: 0 };
    db.tx(() => {
      report.seatsFreed = db.one<{ n: number }>('SELECT COUNT(*) AS n FROM seats WHERE last_at < ?1', nowS - SEAT_IDLE_S)?.n ?? 0;
      db.run('DELETE FROM seats WHERE last_at < ?1', nowS - SEAT_IDLE_S);
      report.purchasesForgotten = db.one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM purchases WHERE status != 'active' AND checked_at < ?1 AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.sub = purchases.sub)`, nowS - FORGET_AFTER_S)?.n ?? 0;
      db.run(`DELETE FROM purchases WHERE status != 'active' AND checked_at < ?1 AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.sub = purchases.sub)`, nowS - FORGET_AFTER_S);
      // An address whose trial is over, or that could not be reached five times, is not kept.
      db.run('DELETE FROM reminders WHERE trial_end < ?1 OR tries >= ?2', nowS, REMINDER_MAX_TRIES);
    });
    for (const [k, e] of windows) {
      const bucket = k.split(':')[0] as string;
      const span = bucket === 'resets' ? DAY_S : (LIMITS[bucket as Bucket]?.windowS ?? DAY_S);
      if (nowMs - e.w >= span * 1000) windows.delete(k);
    }

    if (!deps.mail) return report;
    const due = db.all<{ sub: string; email: string; lang: string; trial_end: number; tries: number }>(
      'SELECT sub, email, lang, trial_end, tries FROM reminders WHERE send_at <= ?1 ORDER BY send_at LIMIT ?2', nowS, MAX_REMINDERS_PER_SWEEP);
    for (const d of due) {
      const p = getRow(d.sub);
      // Cancelled, refunded or over: the mail would be wrong, so it is not sent and the address goes.
      if (!p || p.status !== 'active' || p.paid_until !== null || p.trial_end === null || p.trial_end <= nowS) {
        db.run('DELETE FROM reminders WHERE sub = ?1', d.sub);
        report.remindersDropped++;
        continue;
      }
      const lang = (['en', 'tr', 'de', 'es', 'fr'] as const).find((l) => l === d.lang) ?? 'en';
      const result = await deps.mail.send(reminderMail(d.email, lang, d.trial_end * 1000));
      if (result === 'retry' && d.tries + 1 < REMINDER_MAX_TRIES) {
        db.run('UPDATE reminders SET tries = tries + 1, send_at = ?2 WHERE sub = ?1', d.sub, nowS + REMINDER_RETRY_S);
        report.remindersRetried++;
        log('reminder_retry', { sub: d.sub.slice(0, 8) });
        continue;
      }
      db.run('DELETE FROM reminders WHERE sub = ?1', d.sub);               // sent, refused for good, or out of tries: the address goes either way
      if (result === 'sent') report.remindersSent++; else report.remindersDropped++;
      log('reminder', { result, sub: d.sub.slice(0, 8) });
    }
    return report;
  }

  return {
    grantKey, grantPlay, deactivate, reset, reminder, sweep, nextDue,
    keys: () => ok({ keys: deps.publicKeys.map((k) => ({ kid: k.kid, jwk: k.jwk })), reminders: deps.mail !== null }),
  };
}
