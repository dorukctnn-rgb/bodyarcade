// Paddle Billing, from the Worker's side: its API (only what entitlements need), the Paddle key (our name for a purchase),
// the reading of a subscription or a transaction as an answer the engine understands, and the check of a webhook signature.
// Nothing here knows about seats or tokens; engine.ts does that, with the same rules as for Gumroad and Google Play (B2: only
// Paddle's own "no" takes Pro away, never a timeout or a 5xx).
import { PADDLE_KEY_RE, PADDLE_PRICES, planOfPaddlePrice } from '../../../core/entitlements/paddle.ts';
import { PLANS, type PlanId, type SoldPlanId } from '../../../core/entitlements/plans.ts';
import type { FetchFn } from './upstream/gumroad.ts';

// ───────── the API ─────────

export type PaddleAnswer<T> = { kind: 'found'; value: T } | { kind: 'not_found' } | { kind: 'unreadable' };

/** The fields of Paddle's entities that we read (Paddle sends more). Times are RFC 3339 text. */
export interface PaddleItem { price?: { id?: string } | null; price_id?: string }
export interface PaddleAdjustment { action?: string; status?: string; type?: string }
export interface PaddleTxn {
  id: string;
  status: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  origin?: string | null;
  items?: PaddleItem[];
  billed_at?: string | null;
  created_at?: string | null;
  adjustments?: PaddleAdjustment[] | null;
  details?: { totals?: { grand_total?: string; total?: string } } | null;
}
export interface PaddleSub {
  id: string;
  status: string;
  customer_id?: string | null;
  items?: PaddleItem[];
  started_at?: string | null;
  first_billed_at?: string | null;
  current_billing_period?: { starts_at?: string; ends_at?: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
}
export interface PaddlePortal { overview: string; subscriptions: { id: string; view: string; cancel: string; payment: string }[] }

export interface PaddleUpstream {
  transaction(id: string): Promise<PaddleAnswer<PaddleTxn>>;
  subscription(id: string): Promise<PaddleAnswer<PaddleSub>>;
  customersByEmail(email: string): Promise<PaddleAnswer<{ id: string }[]>>;
  /** Completed transactions of a customer, with their adjustments (refunds, chargebacks). */
  transactionsOf(customerId: string): Promise<PaddleAnswer<PaddleTxn[]>>;
  subscriptionsOf(customerId: string): Promise<PaddleAnswer<PaddleSub[]>>;
  portal(customerId: string, subscriptionIds: string[]): Promise<PaddleAnswer<PaddlePortal>>;
  /** A full refund of a transaction (Paddle reviews it, as every refund). */
  refund(txnId: string, reason: string): Promise<boolean>;
  cancelNow(subId: string): Promise<boolean>;
}

export const PADDLE_API = { production: 'https://api.paddle.com', sandbox: 'https://sandbox-api.paddle.com' } as const;
export const PADDLE_TIMEOUT_MS = 8_000;

export interface PaddleUpstreamOptions {
  apiKey: string;
  environment?: 'production' | 'sandbox';
  fetch?: FetchFn;
  timeoutMs?: number;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function createPaddleUpstream(o: PaddleUpstreamOptions): PaddleUpstream {
  const f: FetchFn = o.fetch ?? ((input, init) => fetch(input, init));
  const base = PADDLE_API[o.environment ?? 'production'];
  const timeout = o.timeoutMs ?? PADDLE_TIMEOUT_MS;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown } | null> {
    try {
      const res = await f(base + path, {
        method,
        headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Paddle-Version': '1' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeout),
      });
      let json: unknown;
      try { json = JSON.parse(await res.text()) as unknown; } catch { json = undefined; }
      return { status: res.status, json };
    } catch {
      return null;
    }
  }
  async function get<T>(path: string): Promise<PaddleAnswer<T>> {
    const r = await call('GET', path);
    if (!r) return { kind: 'unreadable' };
    if (r.status === 404) return { kind: 'not_found' };
    if (r.status !== 200 || !isRecord(r.json) || !('data' in r.json)) return { kind: 'unreadable' };
    return { kind: 'found', value: r.json['data'] as T };
  }
  const enc = encodeURIComponent;
  return {
    transaction: (id) => get<PaddleTxn>(`/transactions/${enc(id)}?include=adjustments`),
    subscription: (id) => get<PaddleSub>(`/subscriptions/${enc(id)}`),
    customersByEmail: (email) => get<{ id: string }[]>(`/customers?email=${enc(email)}&per_page=5`),
    transactionsOf: (c) => get<PaddleTxn[]>(`/transactions?customer_id=${enc(c)}&status=completed&include=adjustments&per_page=50`),
    subscriptionsOf: (c) => get<PaddleSub[]>(`/subscriptions?customer_id=${enc(c)}&per_page=50`),
    async portal(customerId, subscriptionIds) {
      const r = await call('POST', `/customers/${enc(customerId)}/portal-sessions`, subscriptionIds.length ? { subscription_ids: subscriptionIds } : {});
      if (!r) return { kind: 'unreadable' };
      if (r.status === 404) return { kind: 'not_found' };
      const d = isRecord(r.json) && isRecord(r.json['data']) ? r.json['data'] : null;
      const urls = d && isRecord(d['urls']) ? d['urls'] : null;
      const general = urls && isRecord(urls['general']) ? urls['general'] : null;
      if ((r.status !== 200 && r.status !== 201) || !general || typeof general['overview'] !== 'string') return { kind: 'unreadable' };
      const subs = Array.isArray(urls?.['subscriptions']) ? (urls['subscriptions'] as unknown[]).filter(isRecord) : [];
      return {
        kind: 'found',
        value: {
          overview: general['overview'],
          subscriptions: subs.map((s) => ({ id: String(s['id'] ?? ''), view: String(s['view_subscription'] ?? ''), cancel: String(s['cancel_subscription'] ?? ''), payment: String(s['update_subscription_payment_method'] ?? '') })),
        },
      };
    },
    async refund(txnId, reason) {
      const r = await call('POST', '/adjustments', { action: 'refund', transaction_id: txnId, reason, type: 'full' });
      return !!r && (r.status === 200 || r.status === 201);
    },
    async cancelNow(subId) {
      const r = await call('POST', `/subscriptions/${enc(subId)}/cancel`, { effective_from: 'immediately' });
      return !!r && r.status === 200;
    },
  };
}

// ───────── the Paddle key ─────────

export interface PaddleAnchor { kind: 's' | 't'; /** The Paddle id without its prefix (26 characters). */ id: string }

const utf8 = new TextEncoder();
async function mac(secret: string, anchor: PaddleAnchor): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(`bodyarcade-paddle:${anchor.kind}:${anchor.id}`)));
  let hex = '';
  for (const b of sig.subarray(0, 12)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** The purchase a transaction belongs to: its subscription (memberships) or itself (lifetime). */
export function anchorOfTxn(txn: Pick<PaddleTxn, 'id' | 'subscription_id'>): PaddleAnchor {
  return txn.subscription_id ? { kind: 's', id: txn.subscription_id.replace(/^sub_/, '') } : { kind: 't', id: txn.id.replace(/^txn_/, '') };
}

export async function paddleKeyFor(secret: string, anchor: PaddleAnchor): Promise<string> {
  return `pdl-${anchor.kind}-${anchor.id}-${await mac(secret, anchor)}`;
}

/** The purchase a Paddle key names, or null when it is not one of ours (wrong shape or wrong MAC). */
export async function readPaddleKey(secret: string, key: string): Promise<PaddleAnchor | null> {
  const k = key.trim().toLowerCase();
  if (!PADDLE_KEY_RE.test(k)) return null;
  const [, kind, id, given] = k.split('-') as [string, 's' | 't', string, string];
  const want = await mac(secret, { kind, id });
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0 ? { kind, id } : null;
}

export const paddleIdOf = (a: PaddleAnchor): string => `${a.kind === 's' ? 'sub' : 'txn'}_${a.id}`;

// ───────── reading Paddle's answers ─────────

/** What Paddle says about a purchase, in the engine's terms (epoch seconds). */
export interface PaddleFacts {
  plan: PlanId;
  price: string;
  /** Set only when Pro ends at a known time (a cancellation that takes effect at the end of the period). */
  paidUntil: number | null;
  startedAt: number | null;
  /** The end of the current period: with startedAt it tells a running trial (rules.ts: trialEndFor). */
  expiry: number | null;
  customer: string | null;
}
export type PaddleJudged =
  | { kind: 'active'; facts: PaddleFacts }
  | { kind: 'refused'; code: 'refunded' | 'ended' | 'not_found' }
  | { kind: 'pending' };

const toSec = (x: unknown): number | null => {
  if (typeof x !== 'string' || x === '') return null;
  const n = Date.parse(x);
  return Number.isFinite(n) ? Math.floor(n / 1000) : null;
};

/** Our plan among the items, or null when nothing in it is one of our prices. */
export function planOfItems(items: PaddleItem[] | undefined, prices: Readonly<Record<SoldPlanId, string>> = PADDLE_PRICES): { plan: PlanId; price: string } | null {
  for (const it of items ?? []) {
    const id = it.price?.id ?? it.price_id;
    const plan = planOfPaddlePrice(id, prices);
    if (plan && id) return { plan, price: id };
  }
  return null;
}

/** A refund of the whole payment that Paddle approved, or a chargeback: the payment is gone. */
export function wasRefunded(adjustments: PaddleAdjustment[] | null | undefined): boolean {
  let refunded = false;
  for (const a of adjustments ?? []) {
    if (a.action === 'refund' && a.status === 'approved' && a.type !== 'partial') refunded = true;
    if (a.action === 'chargeback' || a.action === 'chargeback_warning') refunded = true;
    if (a.action === 'chargeback_reverse') refunded = false;
  }
  return refunded;
}

export function judgeSubscription(sub: PaddleSub, prices: Readonly<Record<SoldPlanId, string>> = PADDLE_PRICES): PaddleJudged {
  const p = planOfItems(sub.items, prices);
  if (!p) return { kind: 'refused', code: 'not_found' };
  if (sub.status === 'canceled' || sub.status === 'paused') return { kind: 'refused', code: 'ended' };
  if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') return { kind: 'refused', code: 'ended' };
  // A cancellation at the end of the period: Pro runs until then and the token never outlives it. Past due: Paddle is
  // still trying the card, so nothing ends yet (B2); it says "canceled" itself when it gives up.
  const cancelAt = sub.scheduled_change && (sub.scheduled_change.action === 'cancel' || sub.scheduled_change.action === 'pause') ? toSec(sub.scheduled_change.effective_at) : null;
  return {
    kind: 'active',
    facts: {
      plan: p.plan, price: p.price, paidUntil: cancelAt,
      startedAt: toSec(sub.started_at) ?? toSec(sub.first_billed_at),
      expiry: toSec(sub.current_billing_period?.ends_at),
      customer: sub.customer_id ?? null,
    },
  };
}

export function judgeTransaction(txn: PaddleTxn, prices: Readonly<Record<SoldPlanId, string>> = PADDLE_PRICES): PaddleJudged {
  const p = planOfItems(txn.items, prices);
  if (!p) return { kind: 'refused', code: 'not_found' };
  if (txn.status === 'canceled') return { kind: 'refused', code: 'not_found' };
  if (txn.status !== 'completed' && txn.status !== 'paid') return { kind: 'pending' };
  if (wasRefunded(txn.adjustments)) return { kind: 'refused', code: 'refunded' };
  // A membership's first payment is "paid" a moment before its subscription exists; until then there is nothing to name.
  if (PLANS[p.plan].period !== 'once' && !txn.subscription_id) return { kind: 'pending' };
  return {
    kind: 'active',
    facts: { plan: p.plan, price: p.price, paidUntil: null, startedAt: toSec(txn.billed_at) ?? toSec(txn.created_at), expiry: null, customer: txn.customer_id ?? null },
  };
}

// ───────── webhooks ─────────

/** Seconds a signature's timestamp may be away from now (Paddle's SDKs allow 5; a retry carries a fresh timestamp). */
export const SIGNATURE_TOLERANCE_S = 300;

/**
 * Paddle-Signature: "ts=<unix seconds>;h1=<hex HMAC-SHA256 of `${ts}:${raw body}` with the destination's secret>" (more than
 * one h1 while a secret is rotated). The raw body as received: parsing and serialising it again breaks the signature.
 */
export async function verifyPaddleSignature(header: string | null, rawBody: string, secret: string, nowS: number, toleranceS = SIGNATURE_TOLERANCE_S): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' }> {
  if (!header || !secret) return { ok: false, reason: 'missing' };
  let ts: string | null = null;
  const h1: string[] = [];
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 'ts') ts = v;
    else if (k === 'h1' && /^[0-9a-f]{64}$/i.test(v)) h1.push(v.toLowerCase());
  }
  if (!ts || !/^\d{9,11}$/.test(ts) || h1.length === 0) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowS - Number(ts)) > toleranceS) return { ok: false, reason: 'stale' };
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(`${ts}:${rawBody}`)));
  let want = '';
  for (const b of sig) want += b.toString(16).padStart(2, '0');
  for (const got of h1) {
    let diff = 0;
    for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
    if (diff === 0) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}

/** The part of a Paddle notification we read. */
export interface PaddleEvent { event_id: string; event_type: string; occurred_at?: string; data: Record<string, unknown> }

export function parsePaddleEvent(raw: string): PaddleEvent | null {
  let j: unknown;
  try { j = JSON.parse(raw) as unknown; } catch { return null; }
  if (!isRecord(j) || typeof j['event_id'] !== 'string' || typeof j['event_type'] !== 'string' || !isRecord(j['data'])) return null;
  if (!/^evt_[0-9a-z]{26}$/.test(j['event_id']) || j['event_id'].length > 40) return null;
  return { event_id: j['event_id'], event_type: j['event_type'], ...(typeof j['occurred_at'] === 'string' ? { occurred_at: j['occurred_at'] } : {}), data: j['data'] };
}

/** The events the destination subscribes to (scripts set them up with the same list). */
export const PADDLE_EVENTS = [
  'transaction.completed',
  'subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.trialing',
  'subscription.past_due', 'subscription.paused', 'subscription.resumed', 'subscription.canceled',
  'adjustment.created', 'adjustment.updated',
] as const;

// ───────── the restore e-mail ─────────

interface RestoreCopy { subject: string; lines: string[] }
const RESTORE_COPY: Readonly<Record<string, RestoreCopy>> = {
  en: { subject: 'Your BodyArcade Pro link', lines: ['Hi,', '', 'Open this link on the device where you want Pro. It turns Pro on in that browser, with nothing to type:', '{links}', '', 'Each link works on as many devices as your plan allows. Keep this e-mail if you like; the link does not expire while your plan is active.', '', 'Did not ask for this? You can ignore it. Nothing changes.', '', 'BodyArcade', 'info@peakappsstudio.com'] },
  tr: { subject: 'BodyArcade Pro bağlantın', lines: ['Merhaba,', '', 'Pro’yu açmak istediğin cihazda bu bağlantıyı aç. Pro o tarayıcıda hemen açılır, bir şey yazman gerekmez:', '{links}', '', 'Bağlantı, planının izin verdiği sayıda cihazda çalışır. Bu e-postayı saklayabilirsin; planın sürdükçe bağlantı geçerlidir.', '', 'Bunu sen istemediysen e-postayı yok sayabilirsin. Hiçbir şey değişmez.', '', 'BodyArcade', 'info@peakappsstudio.com'] },
  de: { subject: 'Dein BodyArcade-Pro-Link', lines: ['Hallo,', '', 'Öffne diesen Link auf dem Gerät, auf dem du Pro haben möchtest. Pro wird in diesem Browser eingeschaltet, ohne dass du etwas eintippen musst:', '{links}', '', 'Der Link funktioniert auf so vielen Geräten, wie dein Tarif erlaubt. Du kannst diese E-Mail aufheben; der Link gilt, solange dein Tarif läuft.', '', 'Nicht angefordert? Dann ignoriere diese E-Mail einfach. Es ändert sich nichts.', '', 'BodyArcade', 'info@peakappsstudio.com'] },
  es: { subject: 'Tu enlace de BodyArcade Pro', lines: ['Hola:', '', 'Abre este enlace en el dispositivo donde quieras Pro. Pro se activa en ese navegador sin que tengas que escribir nada:', '{links}', '', 'El enlace funciona en tantos dispositivos como permita tu plan. Puedes guardar este correo; el enlace sirve mientras tu plan siga activo.', '', '¿No lo pediste? Puedes ignorar este correo. No cambia nada.', '', 'BodyArcade', 'info@peakappsstudio.com'] },
  fr: { subject: 'Votre lien BodyArcade Pro', lines: ['Bonjour,', '', 'Ouvrez ce lien sur l’appareil où vous voulez Pro. Pro s’active dans ce navigateur, sans rien à saisir :', '{links}', '', 'Le lien fonctionne sur autant d’appareils que votre formule le permet. Vous pouvez garder cet e-mail ; le lien reste valable tant que votre formule est active.', '', 'Vous n’avez rien demandé ? Ignorez simplement cet e-mail. Rien ne change.', '', 'BodyArcade', 'info@peakappsstudio.com'] },
};

export function restoreMail(lang: string, links: string[]): { subject: string; text: string } {
  const c = RESTORE_COPY[lang] ?? (RESTORE_COPY['en'] as RestoreCopy);
  return { subject: c.subject, text: c.lines.join('\n').replace('{links}', links.join('\n')) };
}
