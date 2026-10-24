// The entitlements manager: holds what this device was granted, answers current() and can(), takes a key or a Play
// purchase through the providers, renews on its own schedule and tells the interface when the plan changes.
//
// What it guarantees:
//   - current() never says more than can be checked: a signed token is verified when it is loaded and again when it is
//     adopted; its own dates decide when it runs out; the stored copies of those dates are not trusted (B1).
//   - A failed renewal never takes Pro away (B2). Only a provider's explicit refusal removes it; everything else keeps the
//     record, which then lapses by itself when its token or its 30 days run out.
//   - The key the server asked for is stored only here, on this device, and sent again at every renewal.
//   - A damaged stored record is dropped alone (B4); nothing else in storage is touched.
import type { ActivateFailureCode, ActivateResult, Entitlement, EntitlementProvider, Entitlements, FeatureId, Plan, Unsubscribe } from '../types/index.ts';
import { p, schemaOf, BAD, type BodyArcadeStore, type LegacyLicense, type StoreNamespace } from '../store/index.ts';
import { loadDeviceId, type RandomBytes } from './device.ts';
import { canUse, type FeatureRules } from './features.ts';
import { entitlementFor, type PlanId } from './plans.ts';
import { CANCELLED, type ManagedProvider } from './providers/shared.ts';
import {
  CLOCK_SLACK_MS, REFRESH_AFTER_MS, directRecord, needsRefresh, noteClock, readStored, standingOf, type Provider, type Standing, type StoredEntitlement,
} from './state.ts';
import { legacyFallback } from './legacy-license.ts';
import { verifyToken, type TokenClaims, type TokenKey } from './token.ts';

const FREE: Entitlement = Object.freeze({ plan: 'free', source: 'none' }) as Entitlement;
const RECORD_SCHEMA = schemaOf<StoredEntitlement | null>(1, (raw) => readStored(raw) ?? BAD);
const FLAG_SCHEMA = schemaOf<boolean>(1, p.boolean());
const MAX_TIMER_MS = 2_147_000_000;
/** Between two failed renewals. */
const RETRY_AFTER_MS = 5 * 60_000;
/** The clock memory is written at most this often. */
const CLOCK_WRITE_MS = 60_000;

export type RefreshOutcome = 'none' | 'fresh' | 'renewed' | 'kept' | 'revoked';

export type PurchaseResult =
  | { ok: true; plan: Plan }
  | { ok: false; code: ActivateFailureCode | typeof CANCELLED };

export interface EntitlementStatus {
  plan: Plan;
  founder: boolean;
  source: Entitlement['source'];
  standing: Standing;
  planId: PlanId | null;
  /** The end of a cancelled membership's paid period, or null. */
  paidUntil: number | null;
  /** When the record stops proving anything without a new check, or null. */
  validUntil: number | null;
  verifiedAt: number | null;
  /** Epoch ms when a free trial ends, while the last check showed one running; null otherwise (trial.ts says what to do with it). */
  trialEnds: number | null;
  /** Pro was held on this device at some time (a trial is no longer offered). */
  everPaid: boolean;
  deviceId: string;
}

export interface EntitlementsOptions {
  store: BodyArcadeStore;
  /** The public keys that verify tokens. With none, no token can be accepted. */
  keys: readonly TokenKey[];
  providers?: readonly ManagedProvider[];
  now?: () => number;
  rules?: FeatureRules;
  /** Providers tried, in order, for a licence key typed in. Default: our server, then Gumroad direct. */
  keyOrder?: readonly Provider[];
  random?: RandomBytes;
  /** The live site's licence, read once on the first start (core/store: readLegacyV1). */
  legacy?: () => LegacyLicense | null;
  /** Renew by itself at start and when the record is about to lapse. Default on. */
  autoRefresh?: boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface EntitlementsService extends Entitlements {
  /** Reads and checks the stored record. current() is free until this has resolved. */
  ready(): Promise<void>;
  status(): EntitlementStatus;
  /** A licence key typed in (or the live site's, once). */
  activateKey(key: string): Promise<ActivateResult>;
  /** Android: buy a Play product by its Play product id. */
  purchase(productId: string): Promise<PurchaseResult>;
  /** Android: ask Google Play for this account's purchases again. */
  restore(): Promise<ActivateResult>;
  refresh(): Promise<RefreshOutcome>;
  refreshIfDue(): Promise<RefreshOutcome>;
  /** Gives this device's seat back and forgets the entitlement here. */
  deactivate(): Promise<void>;
  deviceId(): string;
  hasProvider(id: Provider): boolean;
  dispose(): void;
}

const EXPLICIT: readonly ActivateFailureCode[] = ['not_found', 'refunded', 'ended', 'limit'];

export function createEntitlements(o: EntitlementsOptions): EntitlementsService {
  const now = o.now ?? Date.now;
  const ns: StoreNamespace = o.store.ns('entitlements');
  const recSlot = ns.slot<StoredEntitlement | null>('current', RECORD_SCHEMA, null);
  const everSlot = ns.slot<boolean>('ever', FLAG_SCHEMA, false);
  const legacySlot = ns.slot<boolean>('legacy-done', FLAG_SCHEMA, false);
  const did = loadDeviceId(ns, o.random);
  const providers = new Map<string, ManagedProvider>();
  for (const pr of o.providers ?? []) providers.set(pr.id, pr);
  const listeners = new Set<(e: Entitlement) => void>();
  const setTimer = o.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; });
  const clearTimer = o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let rec: StoredEntitlement | null = null;
  let lastEmitted = JSON.stringify(FREE);
  let timer: unknown = null;
  let lastClockWrite = 0;
  let lastTryAt = 0;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();

  /** State-changing work runs one at a time, so a renewal never lands in the middle of an activation. */
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  }

  function current(): Entitlement {
    if (!rec) return FREE;
    const t = now();
    if (t > rec.seenAt + CLOCK_WRITE_MS && standingOf(rec, t) === 'active') remember(t);
    return standingOf(rec, t) === 'active' ? rec.e : FREE;
  }

  function remember(t: number): void {
    if (!rec) return;
    const noted = noteClock(rec, t);
    if (noted === rec) return;
    rec = noted;
    if (t - lastClockWrite >= CLOCK_WRITE_MS) { lastClockWrite = t; recSlot.set(rec); }
  }

  function emitIfChanged(): void {
    const e = current();
    const text = JSON.stringify(e);
    if (text === lastEmitted) return;
    lastEmitted = text;
    for (const cb of [...listeners]) { try { cb(e); } catch { /* a faulty listener must not stop the others */ } }
  }

  function schedule(): void {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (disposed || !rec) return;
    const t = now();
    const active = standingOf(rec, t) === 'active';
    const ends = Math.min(rec.validUntil, rec.paidUntil ?? Number.POSITIVE_INFINITY);
    const due = rec.verifiedAt + REFRESH_AFTER_MS;
    // Wake up when the record runs out or a renewal is due; when a renewal is overdue or the record has lapsed, try again later.
    let wake = active ? ends + 1000 : Number.POSITIVE_INFINITY;
    wake = Math.min(wake, due > t ? due : t + RETRY_AFTER_MS);
    if (!Number.isFinite(wake)) return;
    const wait = Math.min(Math.max(wake - t, 1000), MAX_TIMER_MS);
    timer = setTimer(() => {
      timer = null;
      emitIfChanged();
      void refreshIfDue();
      schedule();
    }, wait);
  }

  function setRecord(next: StoredEntitlement | null): void {
    rec = next;
    if (next) { recSlot.set(next); lastClockWrite = now(); } else recSlot.remove();
    if (next && next.e.plan !== 'free') everSlot.set(true);
    emitIfChanged();
    schedule();
  }

  function fromClaims(c: TokenClaims, provider: Provider, token: string, proof: string | null, seenAt: number): StoredEntitlement {
    const paidUntil = c.pe ? c.pe * 1000 : null;
    return {
      e: entitlementFor(c.plan, provider, { token, ...(paidUntil !== null ? { exp: paidUntil } : {}) }),
      provider, planId: c.plan, verifiedAt: c.chk * 1000, validUntil: c.exp * 1000, paidUntil, seenAt, proof,
      ...(c.tr ? { trialEnds: c.tr * 1000 } : {}),
    };
  }

  /** What a token says about its holder, or null when it is not a token for this device from our key. */
  async function checkToken(token: string): Promise<TokenClaims | null> {
    const r = await verifyToken(token, { keys: o.keys, now: now(), did });
    if (r.ok) return r.claims;
    // An expired token and one issued "in the future" (a wrong clock) are still our token: the record keeps them and
    // standingOf says what they are worth now.
    return r.claims && (r.reason === 'expired' || r.reason === 'not_yet_valid') ? r.claims : null;
  }

  /** Makes the record out of what a provider granted; null when it cannot be trusted. */
  async function adopt(provider: Provider, e: Entitlement, proof: string | null): Promise<StoredEntitlement | null> {
    const t = now();
    if (typeof e.token === 'string') {
      const c = await checkToken(e.token);
      return c ? fromClaims(c, provider, e.token, proof, t) : null;
    }
    // No token: only a direct Gumroad check may stand without one (30 days, then it must be checked again).
    return provider === 'gumroad' && proof ? directRecord(e, proof, t) : null;
  }

  async function ready(): Promise<void> {
    const stored = recSlot.get();
    if (stored) {
      if (typeof stored.e.token === 'string') {
        const c = await checkToken(stored.e.token);
        if (c) rec = fromClaims(c, stored.provider, stored.e.token, stored.proof, stored.seenAt);
        else { o.store.report({ kind: 'corrupt', key: 'entitlements.current', detail: 'stored token does not check out' }); recSlot.remove(); rec = null; }
      } else if (stored.provider === 'gumroad' && stored.proof) {
        rec = stored;
      } else {
        recSlot.remove(); rec = null;
      }
    }
    if (!rec) await serial(migrateLegacy);
    emitIfChanged();
    schedule();
    if (o.autoRefresh !== false) void refreshIfDue();
  }

  async function migrateLegacy(): Promise<void> {
    if (rec || legacySlot.get() || !o.legacy) return;
    let lic: LegacyLicense | null = null;
    try { lic = o.legacy(); } catch { lic = null; }
    if (!lic) { legacySlot.set(true); return; }
    const r = await activateKeyUnsafe(lic.key);
    if (r.ok) { legacySlot.set(true); return; }
    if (EXPLICIT.includes(r.code)) { legacySlot.set(true); return; }       // the seller said no: the old key is not valid any more
    // Nothing could be reached: the live site's own rule holds until the next start can try again.
    const fallback = legacyFallback(lic, now());
    if (fallback) setRecord(fallback);
  }

  async function activateKeyUnsafe(key: string): Promise<ActivateResult> {
    const order = (o.keyOrder ?? ['server', 'gumroad']).filter((id) => providers.has(id));
    if (order.length === 0) return { ok: false, code: 'server', message: 'No licence service is available in this build.' };
    let last: ActivateResult = { ok: false, code: 'network', message: 'The licence service could not be reached.' };
    for (const id of order) {
      const provider = providers.get(id) as ManagedProvider;
      const r = await provider.activate(key);
      if (r.ok) {
        const next = await adopt(id as Provider, r.e, provider.keepsProof ? key.trim() : null);
        if (!next) { last = { ok: false, code: 'server', message: 'The answer could not be checked.' }; continue; }
        setRecord(next);
        return { ok: true, e: next.e };
      }
      // A definite answer (even "not found") is kept over a mere failure to answer.
      if (EXPLICIT.includes(r.code) || !(!last.ok && EXPLICIT.includes(last.code))) last = r;
      if (r.code !== 'not_found' && EXPLICIT.includes(r.code)) return r;     // a clear no (refund, end, no seat): no second opinion
      // not_found: another provider may know a product this one does not
    }
    return last;
  }

  async function purchaseUnsafe(productId: string): Promise<PurchaseResult> {
    const play = providers.get('play');
    if (!play) return { ok: false, code: 'server' };
    const r = await play.activate(productId);
    if (!r.ok) return { ok: false, code: r.message === CANCELLED ? CANCELLED : r.code };
    const next = await adopt('play', r.e, null);
    if (!next) return { ok: false, code: 'server' };
    setRecord(next);
    return { ok: true, plan: next.e.plan };
  }

  async function restoreUnsafe(): Promise<ActivateResult> {
    const play = providers.get('play') as (ManagedProvider & { restore?: () => Promise<ActivateResult> }) | undefined;
    if (!play?.restore) return { ok: false, code: 'server', message: 'Restoring purchases is not available here.' };
    const r = await play.restore();
    if (!r.ok) return r;
    const next = await adopt('play', r.e, null);
    if (!next) return { ok: false, code: 'server', message: 'The answer could not be checked.' };
    setRecord(next);
    return { ok: true, e: next.e };
  }

  async function refreshUnsafe(): Promise<RefreshOutcome> {
    if (!rec) return 'none';
    const held = rec;
    lastTryAt = now();
    // A record made by the direct Gumroad check moves to our server as soon as the server answers.
    if (held.provider === 'gumroad' && held.proof && providers.has('server')) {
      const via = await (providers.get('server') as ManagedProvider).activate(held.proof);
      if (via.ok) {
        const next = await adopt('server', via.e, held.proof);
        if (next) { setRecord(next); return 'renewed'; }
      } else if (via.code !== 'not_found' && EXPLICIT.includes(via.code)) {
        setRecord(null);                                                    // the server saw the purchase and refuses it
        return 'revoked';
      }
    }
    const provider = providers.get(held.provider);
    if (!provider) return 'kept';
    const out = await provider.refresh(held.e, { proof: held.proof, did });
    if (out === 'keep') return 'kept';
    if (out === 'revoked') { setRecord(null); return 'revoked'; }
    const next = await adopt(held.provider, out, held.proof);
    if (!next) return 'kept';
    setRecord(next);
    return 'renewed';
  }

  async function refreshIfDue(): Promise<RefreshOutcome> {
    if (disposed || !rec) return 'none';
    const t = now();
    if (!needsRefresh(rec, t)) return 'fresh';
    if (t - lastTryAt < RETRY_AFTER_MS && lastTryAt !== 0 && t >= lastTryAt) return 'kept';
    return serial(refreshUnsafe);
  }

  const service: EntitlementsService = {
    current,
    can: (f: FeatureId) => canUse(f, current(), o.rules),
    use(provider: EntitlementProvider) { providers.set(provider.id, provider as ManagedProvider); },
    onChange(cb): Unsubscribe {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    ready,

    status() {
      const t = now();
      const standing = standingOf(rec, t);
      const e = current();
      return {
        plan: e.plan, founder: e.founder === true, source: e.source, standing, planId: rec?.planId ?? null,
        paidUntil: rec?.paidUntil ?? null, validUntil: rec?.validUntil ?? null, verifiedAt: rec?.verifiedAt ?? null,
        trialEnds: standing === 'active' ? rec?.trialEnds ?? null : null,
        everPaid: everSlot.get(), deviceId: did,
      };
    },

    activateKey: (key) => serial(() => (typeof key === 'string' ? activateKeyUnsafe(key) : Promise.resolve<ActivateResult>({ ok: false, code: 'not_found', message: 'That is not a licence key.' }))),
    purchase: (productId) => serial(() => purchaseUnsafe(productId)),
    restore: () => serial(restoreUnsafe),
    refresh: () => serial(refreshUnsafe),
    refreshIfDue,

    async deactivate() {
      await serial(async () => {
        const held = rec;
        if (held) {
          const provider = providers.get(held.provider) as (ManagedProvider & { release?: (e: Entitlement) => Promise<boolean> }) | undefined;
          try { await provider?.release?.(held.e); } catch { /* the seat frees itself after 90 days of silence */ }
        }
        setRecord(null);
      });
    },

    deviceId: () => did,
    hasProvider: (id) => providers.has(id),
    dispose() {
      disposed = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
      listeners.clear();
    },
  };
  return service;
}

export { CANCELLED };
