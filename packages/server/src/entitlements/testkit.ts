// Test kit of the entitlement module (never imported by production code): the real SQL on node:sqlite, a clock, signing
// keys, and fakes of the three outside services (Gumroad, Google Play, the mail service) that speak the same interfaces
// as the real upstreams. The Workers runtime itself (real Durable Object storage, alarms) is covered by the Miniflare test.
import { DatabaseSync } from 'node:sqlite';
import { GUMROAD_LEGACY_PRODUCTS, type PlanId } from '../../../core/entitlements/plans.ts';
import type { GumroadPurchase } from '../../../core/entitlements/gumroad-rules.ts';
import type { TokenKey } from '../../../core/entitlements/token.ts';
import { Clock, makeKeys, type Keys } from '../../../core/entitlements/testkit.ts';
import type { DoSqlStorage, SqlDb } from './db.ts';
import { clean, migrate } from './db.ts';
import { createEngine, type Engine, type LogFn } from './engine.ts';
import type { MailMessage, MailResult, MailSender } from './mail.ts';
import type { GumroadAnswer, GumroadUpstream } from './upstream/gumroad.ts';
import type { PlayCheck, PlayUpstream } from './upstream/play.ts';

export { Clock, makeKeys, type Keys };
export const DAY = 86_400_000;

/** A SqlDb on an in-memory node:sqlite database; `tx` nests with savepoints. */
export function sqliteDb(raw: DatabaseSync = new DatabaseSync(':memory:')): SqlDb & { raw: DatabaseSync; statements: string[] } {
  let depth = 0;
  const statements: string[] = [];
  const run = (sql: string, params: unknown[]): void => {
    if (!/^\s*(SELECT|WITH)/i.test(sql)) statements.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80));
    raw.prepare(sql).run(...(params.map(clean) as never[]));
  };
  return {
    raw,
    statements,
    all: <T>(sql: string, ...p: unknown[]): T[] => raw.prepare(sql).all(...(p.map(clean) as never[])).map((r) => ({ ...r })) as T[],
    one: <T>(sql: string, ...p: unknown[]): T | null => {
      const r = raw.prepare(sql).get(...(p.map(clean) as never[]));
      return r ? ({ ...r } as T) : null;
    },
    run: (sql, ...p) => run(sql, p),
    tx: (fn) => {
      const name = `sp${depth}`;
      raw.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
      depth++;
      try {
        const out = fn();
        depth--;
        raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return out;
      } catch (e) {
        depth--;
        raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
        throw e;
      }
    },
  };
}

/** A Durable Object's storage made of node:sqlite, with an alarm slot. */
export function fakeDoStorage(db = sqliteDb()): DoSqlStorage & { alarm: number | null; getAlarm(): Promise<number | null>; setAlarm(t: number): Promise<void>; deleteAlarm(): Promise<void>; db: ReturnType<typeof sqliteDb> } {
  const storage = {
    db,
    alarm: null as number | null,
    sql: { exec: (query: string, ...bindings: unknown[]) => ({ toArray: () => db.all(query, ...bindings) }) },
    transactionSync: <T>(fn: () => T): T => db.tx(fn),
    getAlarm: async (): Promise<number | null> => storage.alarm,
    setAlarm: async (t: number): Promise<void> => { storage.alarm = t; },
    deleteAlarm: async (): Promise<void> => { storage.alarm = null; },
  };
  return storage;
}

// ───────── Gumroad ─────────

export const PRODUCT_PRO_MONTHLY = 'PRODMONTH0001';
export const PRODUCT_PRO_YEARLY = 'PRODYEAR00001';
export const PRODUCT_LIFETIME = 'PRODLIFE00001';
export const PRODUCT_FAMILY = 'PRODFAMILY001';
export const [LEGACY_MONTHLY, LEGACY_LIFETIME] = Object.keys(GUMROAD_LEGACY_PRODUCTS) as [string, string];

/** Products of the release in the order the engine tries them, then the two sold before. */
export function testProducts(): Map<string, PlanId> {
  return new Map<string, PlanId>([
    [PRODUCT_PRO_YEARLY, 'pro-yearly'], [PRODUCT_PRO_MONTHLY, 'pro-monthly'], [PRODUCT_LIFETIME, 'lifetime'], [PRODUCT_FAMILY, 'family-yearly'],
    [LEGACY_MONTHLY, 'legacy-monthly'], [LEGACY_LIFETIME, 'founder'],
  ]);
}

export type GumroadFault = null | 'down' | 'disabled' | 'expired';

export class FakeGumroad implements GumroadUpstream {
  /** product id -> upper-case key -> purchase fields */
  readonly products = new Map<string, Map<string, Record<string, unknown>>>();
  readonly calls: { productId: string; key: string }[] = [];
  fault: GumroadFault = null;
  /** Keys whose answer is "disabled" / "expired" (the seller's own verdict on a key it knows). */
  readonly verdicts = new Map<string, 'disabled' | 'expired'>();
  /** Runs before an answer is given (a test uses it to interleave another request). */
  hook: (() => Promise<void>) | null = null;

  private readonly clock: Clock;
  constructor(clock: Clock) { this.clock = clock; }

  add(productId: string, key: string, purchase: Record<string, unknown> = {}): void {
    const m = this.products.get(productId) ?? new Map<string, Record<string, unknown>>();
    m.set(key.toUpperCase(), {
      email: 'buyer@example.com', sale_timestamp: new Date(this.clock.now()).toISOString(), created_at: new Date(this.clock.now()).toISOString(),
      subscription_ended_at: null, subscription_cancelled_at: null, subscription_failed_at: null, refunded: false, chargebacked: false, ...purchase,
    });
    this.products.set(productId, m);
  }

  purchase(productId: string, key: string): Record<string, unknown> {
    return this.products.get(productId)?.get(key.toUpperCase()) as Record<string, unknown>;
  }

  async verify(productId: string, key: string): Promise<GumroadAnswer> {
    this.calls.push({ productId, key });
    if (this.hook) await this.hook();
    if (this.fault === 'down') return { kind: 'unreadable' };
    const hit = this.products.get(productId)?.get(key.toUpperCase());
    if (!hit) return { kind: 'not_found', reason: 'missing' };
    const verdict = this.verdicts.get(key.toUpperCase());
    if (verdict) return { kind: 'not_found', reason: verdict };
    return { kind: 'found', purchase: hit as GumroadPurchase };
  }
}

// ───────── Google Play ─────────

export class FakePlay implements PlayUpstream {
  readonly purchases = new Map<string, PlayCheck>();
  readonly checks: { productId: string; token: string }[] = [];
  readonly acks: { productId: string; token: string }[] = [];
  down = false;
  ackFails = false;

  set(token: string, check: PlayCheck): void { this.purchases.set(token, check); }

  async check(productId: string, token: string): Promise<PlayCheck> {
    this.checks.push({ productId, token });
    if (this.down) return { kind: 'unreadable' };
    return this.purchases.get(token) ?? { kind: 'refused', code: 'not_found' };
  }

  async acknowledge(productId: string, token: string): Promise<boolean> {
    this.acks.push({ productId, token });
    return !this.ackFails;
  }
}

// ───────── mail ─────────

export class FakeMail implements MailSender {
  readonly sent: MailMessage[] = [];
  readonly attempts: MailMessage[] = [];
  result: MailResult = 'sent';
  async send(m: MailMessage): Promise<MailResult> {
    this.attempts.push(m);
    if (this.result === 'sent') this.sent.push(m);
    return this.result;
  }
}

// ───────── the engine, assembled ─────────

export interface Rig {
  engine: Engine;
  db: ReturnType<typeof sqliteDb>;
  clock: Clock;
  keys: Keys;
  gum: FakeGumroad;
  play: FakePlay;
  mail: FakeMail;
  logs: { evt: string; data: Record<string, unknown> }[];
  publicKeys: TokenKey[];
}

export interface RigOptions {
  play?: boolean;
  mail?: boolean;
  signer?: boolean;
  noLimits?: boolean;
  keys?: Keys;
  clock?: Clock;
  db?: ReturnType<typeof sqliteDb>;
}

export async function makeRig(o: RigOptions = {}): Promise<Rig> {
  const clock = o.clock ?? new Clock();
  const keys = o.keys ?? (await makeKeys());
  const db = o.db ?? sqliteDb();
  migrate(db);
  const gum = new FakeGumroad(clock);
  const play = new FakePlay();
  const mail = new FakeMail();
  const logs: Rig['logs'] = [];
  const log: LogFn = (evt, data) => { logs.push({ evt, data }); };
  const engine = createEngine({
    db, now: clock.now,
    signer: o.signer === false ? null : { kid: keys.pub.kid, key: keys.signing },
    publicKeys: [keys.pub],
    products: testProducts(),
    gumroad: gum,
    play: o.play === false ? null : play,
    mail: o.mail === false ? null : mail,
    noLimits: o.noLimits ?? true,
    log,
  });
  return { engine, db, clock, keys, gum, play, mail, logs, publicKeys: [keys.pub] };
}

export const KEYS = ['AAAAAAAA-11111111-BBBBBBBB-22222222', 'CCCCCCCC-33333333-DDDDDDDD-44444444', 'EEEEEEEE-55555555-FFFFFFFF-66666666', 'ABCDEF01-23456789-ABCDEF01-23456789'] as const;
export const DIDS = Array.from({ length: 8 }, (_, i) => String(i).repeat(32));

// ───────── over HTTP: the Worker's router, the real Durable Object class on node:sqlite, Gumroad as an HTTP service ─────────
import { GUMROAD_VERIFY_URL } from '../../../core/entitlements/gumroad-rules.ts';
import { Router } from '../router.ts';
import { EntitlementsDO, type DurableOptions } from './durable.ts';
import { registerEntitlementRoutes } from './routes.ts';
import type { FetchFn } from './upstream/gumroad.ts';
import type { DurableObjectNamespaceLike, DurableObjectIdLike, ExecutionContextLike, Fetcher } from '../cf.ts';

const json = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' } });

/** Gumroad's verify endpoint, as it answers over HTTP, backed by a FakeGumroad's data. */
export function gumroadFetch(gum: FakeGumroad, extra?: FetchFn): FetchFn {
  return async (input, init) => {
    if (input !== GUMROAD_VERIFY_URL) {
      if (extra) return extra(input, init);
      return json(404, { error: 'not a service of this test' });
    }
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    const productId = form.get('product_id') ?? '';
    const key = form.get('license_key') ?? '';
    gum.calls.push({ productId, key });
    if (gum.hook) await gum.hook();
    if (gum.fault === 'down') return json(503, '<html>Service unavailable</html>');
    const hit = gum.products.get(productId)?.get(key.toUpperCase());
    if (!hit) return json(404, { success: false, message: 'That license does not exist for the provided product.' });
    const verdict = gum.verdicts.get(key.toUpperCase());
    if (verdict === 'disabled') return json(404, { success: false, message: 'This license key has been disabled.' });
    if (verdict === 'expired') return json(404, { success: false, message: 'Access to the purchase associated with this license has expired.' });
    return json(200, { success: true, uses: 1, purchase: hit });
  };
}

export interface World {
  router: Router;
  env: Record<string, unknown>;
  storage: ReturnType<typeof fakeDoStorage>;
  durable: EntitlementsDO;
  clock: Clock;
  keys: Keys;
  gum: FakeGumroad;
  logs: { evt: string; data: Record<string, unknown> }[];
  /** A request through the router, as the app makes it. */
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  /** The same as a fetch the app's providers can use. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Rebuilds the Durable Object on the same storage, as the platform does after it evicted it. */
  restart(): EntitlementsDO;
}

export interface WorldOptions {
  env?: Record<string, unknown>;
  /** false: no binding at all. */
  bound?: boolean;
  fetch?: FetchFn;
  limits?: boolean;
}

export async function makeWorld(o: WorldOptions = {}): Promise<World> {
  const clock = new Clock();
  const keys = await makeKeys();
  const gum = new FakeGumroad(clock);
  const storage = fakeDoStorage();
  const logs: World['logs'] = [];
  const env: Record<string, unknown> = {
    ENT_PRIV_JWK: JSON.stringify({ ...keys.privateJwk, alg: 'ES256', use: 'sig' }),
    ...(o.limits ? {} : { ENT_NO_LIMITS: '1' }),
    ...o.env,
  };
  const options: DurableOptions = { now: clock.now, fetch: gumroadFetch(gum, o.fetch), log: (evt, data) => { logs.push({ evt, data }); } };
  let durable = new EntitlementsDO({ storage, blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn() } as never, env, options);
  const ns: DurableObjectNamespaceLike = {
    idFromName: (name): DurableObjectIdLike => ({ name, toString: () => name }),
    get: (): Fetcher => ({ fetch: (input, init) => durable.fetch(input instanceof Request ? input : new Request(input, init)) }),
  };
  if (o.bound !== false) env['ENTITLEMENTS'] = ns;
  const router = new Router();
  registerEntitlementRoutes(router);
  const ctx: ExecutionContextLike = { waitUntil: () => undefined };
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> => {
    const init: RequestInit = { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } };
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    return router.handle(new Request(`https://bodyarcade.test${path}`, init), env, ctx).then((r) => r ?? new Response('asset', { status: 200 }));
  };
  return {
    router, env, storage, get durable() { return durable; }, clock, keys, gum, logs, call,
    fetch: (input, init) => call(init?.method ?? 'GET', input, typeof init?.body === 'string' ? init.body : undefined, (init?.headers ?? {}) as Record<string, string>),
    restart: () => { durable = new EntitlementsDO({ storage, blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn() } as never, env, options); return durable; },
  } as World;
}
