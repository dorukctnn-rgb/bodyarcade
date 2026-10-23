// Test-only: a clock, signing keys, and fakes of the two outside services (our server, Gumroad) that speak the real wire
// formats, so the providers and the manager are tested against answers shaped like the real ones. Not exported by
// index.ts and never bundled into the app.
import { API, DID_RE, ERROR_STATUS, LICENSE_KEY_RE, type ErrorCode } from './api.ts';
import { PLANS, PLAY_PRODUCTS, bestPlan, type PlanId } from './plans.ts';
import { generateSigningKeys, importSigningKey, signToken, type PrivateKeyJwk } from './sign.ts';
import type { FetchLike } from './providers/shared.ts';
import { MAX_TOKEN_TTL_S, TOKEN_AUD, TOKEN_ISS, type TokenKey } from './token.ts';

export const KEY_A = 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD';
export const KEY_B = 'EEEEEEEE-FFFFFFFF-11111111-22222222';
export const DID_1 = '0123456789abcdef0123456789abcdef';
export const DID_2 = 'fedcba9876543210fedcba9876543210';
export const DAY = 86_400_000;
export const START = Date.UTC(2026, 9, 24, 12);

export class Clock {
  t: number;
  constructor(start = START) { this.t = start; }
  now = (): number => this.t;
  advance(ms: number): void { this.t += ms; }
}

export interface Keys { privateJwk: PrivateKeyJwk; pub: TokenKey; signing: CryptoKey }
export async function makeKeys(): Promise<Keys> {
  const k = await generateSigningKeys();
  return { privateJwk: k.privateJwk, pub: k.publicKey, signing: await importSigningKey(k.privateJwk) };
}

export const sha256Hex = async (text: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');

const reply = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' } });

export interface SeatRecord { plan: PlanId; status: 'active' | 'refunded' | 'ended'; paidUntil?: number; test?: boolean }

/** How the pretend service misbehaves. */
export type Fault = null | 'offline' | 'status500' | 'status503' | 'status429' | 'html200' | 'html404' | 'garbage' | 'forged' | 'empty200';

/** Our server, in memory: the wire contract of api.ts, tokens signed for real, seats counted, faults on demand. */
export class FakeServer {
  readonly licenses = new Map<string, SeatRecord>();
  readonly playPurchases = new Map<string, SeatRecord & { productId: string }>();
  readonly seats = new Map<string, Set<string>>();
  readonly calls: { path: string; body: Record<string, unknown> }[] = [];
  fault: Fault = null;
  keys: Keys;
  clock: Clock;
  other: Keys | null = null;
  constructor(keys: Keys, clock: Clock) { this.keys = keys; this.clock = clock; }

  fetch: FetchLike = async (input, init) => {
    const path = new URL(input, 'https://bodyarcade.test').pathname;
    const body = (typeof init?.body === 'string' ? JSON.parse(init.body) : {}) as Record<string, unknown>;
    this.calls.push({ path, body });
    switch (this.fault) {
      case 'offline': throw new TypeError('Failed to fetch');
      case 'status500': return reply(500, { error: 'internal' });
      case 'status503': return reply(503, { error: 'unavailable' });
      case 'status429': return reply(429, { error: 'rate_limited' });
      case 'html200': return reply(200, '<html>Sign in to the Wi-Fi</html>');
      case 'html404': return reply(404, '<html>Not found</html>');
      case 'garbage': return reply(200, '{"token": ');
      case 'empty200': return reply(200, {});
      case 'forged': return reply(200, { token: await this.mint('f'.repeat(64), String(body['did']), 'founder', 'gumroad', this.other ?? undefined) });
      default: break;
    }
    if (path === API.activate || path === API.refresh) return this.grantKey(body);
    if (path === API.play) return this.grantPlay(body);
    if (path === API.deactivate) return this.release(body);
    return reply(404, { error: 'not_found' });
  };

  async mint(sub: string, did: string, plan: PlanId, src: 'gumroad' | 'play', keys: Keys = this.keys, paidUntil?: number): Promise<string> {
    const nowS = Math.floor(this.clock.now() / 1000);
    const exp = Math.min(nowS + MAX_TOKEN_TTL_S - 60, paidUntil ? Math.floor(paidUntil / 1000) : Infinity);
    return signToken({
      iss: TOKEN_ISS, aud: TOKEN_AUD, sub, did: did as string, plan, src, feat: [...PLANS[plan].feat], chk: nowS, iat: nowS, exp,
      ...(paidUntil ? { pe: Math.floor(paidUntil / 1000) } : {}),
    }, keys.signing, keys.pub.kid);
  }

  private seat(sub: string, did: string, plan: PlanId): Response | null {
    const set = this.seats.get(sub) ?? new Set<string>();
    if (!set.has(did) && set.size >= PLANS[plan].devices) return reply(ERROR_STATUS.limit, { error: 'limit' satisfies ErrorCode });
    set.add(did);
    this.seats.set(sub, set);
    return null;
  }

  private async grantKey(body: Record<string, unknown>): Promise<Response> {
    const key = body['key']; const did = body['did'];
    if (typeof key !== 'string' || !LICENSE_KEY_RE.test(key) || typeof did !== 'string' || !DID_RE.test(did)) return reply(400, { error: 'bad_request' });
    const lic = this.licenses.get(key);
    if (!lic) return reply(404, { error: 'not_found' });
    if (lic.status !== 'active') return reply(403, { error: lic.status });
    const sub = await sha256Hex(key);
    const refused = this.seat(sub, did, lic.plan);
    if (refused) return refused;
    return reply(200, { token: await this.mint(sub, did, lic.plan, 'gumroad', this.keys, lic.paidUntil), plan: lic.plan, devices: { used: this.seats.get(sub)?.size ?? 1, limit: PLANS[lic.plan].devices } });
  }

  private async grantPlay(body: Record<string, unknown>): Promise<Response> {
    const did = body['did']; const purchases = body['purchases'];
    if (typeof did !== 'string' || !DID_RE.test(did) || !Array.isArray(purchases) || purchases.length === 0) return reply(400, { error: 'bad_request' });
    const good: { sub: string; rec: SeatRecord & { productId: string } }[] = [];
    let refusal: ErrorCode = 'not_found';
    for (const p of purchases as { productId: string; purchaseToken: string }[]) {
      const rec = this.playPurchases.get(p.purchaseToken);
      if (!rec || rec.productId !== p.productId || !Object.hasOwn(PLAY_PRODUCTS, p.productId)) continue;
      if (rec.status !== 'active') { refusal = rec.status; continue; }
      good.push({ sub: await sha256Hex(p.purchaseToken), rec });
    }
    if (good.length === 0) return reply(ERROR_STATUS[refusal], { error: refusal });
    const bestId = bestPlan(good.map((g) => g.rec.plan)) as PlanId;
    const best = good.find((g) => g.rec.plan === bestId) as (typeof good)[number];
    const refused = this.seat(best.sub, did, bestId);
    if (refused) return refused;
    return reply(200, { token: await this.mint(best.sub, did, bestId, 'play', this.keys, best.rec.paidUntil), plan: bestId, devices: { used: this.seats.get(best.sub)?.size ?? 1, limit: PLANS[bestId].devices } });
  }

  private release(body: Record<string, unknown>): Response {
    const token = body['token']; const did = body['did'];
    if (typeof token !== 'string' || typeof did !== 'string') return reply(400, { error: 'bad_request' });
    for (const set of this.seats.values()) set.delete(did);
    return reply(200, { ok: true });
  }
}

/** Gumroad's verify endpoint: per product id, the purchases it knows by licence key. */
export class FakeGumroad {
  /** product id -> key -> purchase fields */
  readonly products = new Map<string, Map<string, Record<string, unknown>>>();
  calls: URLSearchParams[] = [];
  fault: Fault = null;

  add(productId: string, key: string, purchase: Record<string, unknown> = {}): void {
    const m = this.products.get(productId) ?? new Map<string, Record<string, unknown>>();
    m.set(key, { email: 'buyer@example.com', subscription_ended_at: null, subscription_cancelled_at: null, subscription_failed_at: null, ...purchase });
    this.products.set(productId, m);
  }

  fetch: FetchLike = async (_input, init) => {
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    this.calls.push(form);
    switch (this.fault) {
      case 'offline': throw new TypeError('Failed to fetch');
      case 'status500': return reply(500, { success: false });
      case 'status429': return reply(429, { success: false, message: 'Too many requests' });
      case 'html200': return reply(200, '<html>Sign in</html>');
      default: break;
    }
    const purchase = this.products.get(form.get('product_id') ?? '')?.get(form.get('license_key') ?? '');
    if (!purchase) return reply(404, { success: false, message: 'That license does not exist for the provided product.' });
    return reply(200, { success: true, uses: 1, purchase });
  };
}
