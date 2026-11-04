// The Paddle checkout of the web build (core/entitlements/paddle.ts says why Paddle). The buyer never leaves the page and
// the page never goes dark: Paddle's inline checkout runs inside a light panel of our own (a bottom sheet on a phone, a
// window in the middle on a wide screen) with the plan, the price in the buyer's currency, "taxes included" and one line
// of what the buyer can count on. When Paddle says `checkout.completed`, the transaction id goes to our Worker
// (POST /api/entitlements/paddle), which answers with the purchase's Paddle key; the key is then activated like any
// licence key (the entitlements port), so Pro turns on at once with nothing to type.
//
// Nothing here can lose a payment: a claim that cannot finish is kept (localStorage) and tried again at the next start,
// and the restore e-mail works for any device. Nothing here can lose a sale either: if Paddle's script or our settings do
// not load, open() says so and the caller falls back to the Gumroad page.
import { API, type PaddleClaim, type PaddleConfig } from '../../../core/entitlements/api.ts';
import { PADDLE_REFUND_DAYS, RESTORE_HASH_RE, isPaddleKey } from '../../../core/entitlements/paddle.ts';
import type { SoldPlanId } from '../../../core/entitlements/plans.ts';
import { html } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { StringKey } from '../../../core/ui/i18n/index.ts';

export const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';
/** Paddle's checkout languages that the app also speaks. */
const LOCALES: Readonly<Record<string, string>> = { en: 'en', tr: 'tr', de: 'de', es: 'es', fr: 'fr' };
const FRAME_CLASS = 'pdl-frame';
const KEY_SLOT = 'ba2.paddle.key';
const PENDING_SLOT = 'ba2.paddle.pending';

type ActivateAnswer = { ok: true; plan: string } | { ok: false; code: string };

export interface PaddleCheckoutOptions {
  win: Window & typeof globalThis;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  lang: () => string;
  /** The entitlements port's activate: a Paddle key becomes Pro on this device. */
  activate: (key: string) => Promise<ActivateAnswer>;
  /** Pro turned on (the app draws itself again and says so). */
  onPro?: (plan: string, via: 'checkout' | 'restore' | 'pending') => void;
  /** A restore link that did not work (the app says so, calmly). */
  onRestoreFailed?: () => void;
  /** Where the visit came from, for the sale's custom data (pro-source.ts). */
  source?: () => string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  scriptUrl?: string;
  /** Tests: shorter waits. */
  retryMs?: number;
}

export interface CheckoutOffer {
  id: SoldPlanId;
  name: string;
  /** The plan's price as the paywall states it, before Paddle answers with the buyer's own currency. */
  priceLine: string;
  trialLine: string | null;
  recurring: boolean;
}

interface PaddleTotals { total?: number | string; tax?: number | string }
interface PaddleEventData {
  transaction_id?: string;
  currency_code?: string;
  totals?: PaddleTotals;
  recurring_totals?: PaddleTotals | null;
}
interface PaddleJs {
  Initialize(o: Record<string, unknown>): void;
  Checkout: { open(o: Record<string, unknown>): void; close(): void };
}
type PaddleWindow = Window & typeof globalThis & { Paddle?: PaddleJs };

type Phase = 'idle' | 'loading' | 'ready' | 'paying' | 'claiming' | 'done';

const PREVIEW_SLOT = 'ba2.paddle.preview';

/**
 * Paddle for this one browser while the published switch is off (core/entitlements/paddle.ts): /pro/#paddle-preview turns it on
 * and remembers it, #paddle-preview-off forgets it. The hash leaves the address bar at once. Everyone else keeps the Gumroad pages.
 */
export function paddlePreview(win: Window & typeof globalThis): boolean {
  const ls = (): Storage | null => { try { return win.localStorage; } catch { return null; } };
  const hash = win.location.hash;
  const off = /(?:^#|&)paddle-preview-off(?:&|$)/.test(hash);
  const on = !off && /(?:^#|&)paddle-preview(?:&|$)/.test(hash);
  if (on || off) {
    try { if (on) ls()?.setItem(PREVIEW_SLOT, '1'); else ls()?.removeItem(PREVIEW_SLOT); } catch { /* private mode: this visit only */ }
    try { win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search); } catch { /* ignore */ }
    return on;
  }
  try { return ls()?.getItem(PREVIEW_SLOT) === '1'; } catch { return false; }
}

export interface PaddleCheckout {
  /** Opens the panel for a plan. False when Paddle cannot be used here right now (the caller then offers the Gumroad page). */
  open(offer: CheckoutOffer): Promise<boolean>;
  close(): void;
  /** The restore link of an e-mail (#restore=<key>), and a claim left unfinished by an earlier visit. Call once at start. */
  resume(): Promise<void>;
  restoreByEmail(email: string): Promise<'sent' | 'error'>;
  /** Opens Paddle's customer portal for the purchase on this device, in a new tab. */
  manage(): Promise<boolean>;
  /** This device holds a Paddle purchase (the portal makes sense). */
  hasPurchase(): boolean;
  /** Remembers a Paddle key the player activated by hand. */
  remember(key: string): void;
}

export function createPaddleCheckout(o: PaddleCheckoutOptions): PaddleCheckout {
  const win = o.win as PaddleWindow;
  const doc = win.document;
  const f = o.fetch ?? ((input: string, init?: RequestInit) => win.fetch(input, init));
  const wait = (ms: number) => new Promise<void>((r) => win.setTimeout(r, ms));
  const retryMs = o.retryMs ?? 1500;
  let config: PaddleConfig | null = null;
  let script: Promise<PaddleJs | null> | null = null;
  let initialized = false;
  let dialog: HTMLDialogElement | null = null;
  let phase: Phase = 'idle';
  let current: CheckoutOffer | null = null;

  const store = {
    get: (k: string): string | null => { try { return win.localStorage.getItem(k); } catch { return null; } },
    set: (k: string, v: string): void => { try { win.localStorage.setItem(k, v); } catch { /* private mode */ } },
    del: (k: string): void => { try { win.localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  async function postJson(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> } | null> {
    try {
      const r = await f(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let j: Record<string, unknown> = {};
      try { j = (await r.json()) as Record<string, unknown>; } catch { /* not json */ }
      return { status: r.status, body: j };
    } catch {
      return null;
    }
  }

  async function loadConfig(): Promise<PaddleConfig | null> {
    if (config) return config;
    try {
      const r = await f(API.paddleConfig, { method: 'GET' });
      if (!r.ok) return null;
      const j = (await r.json()) as PaddleConfig;
      if (typeof j.token !== 'string' || !j.prices) return null;
      config = j;
      return j;
    } catch {
      return null;
    }
  }

  function loadScript(): Promise<PaddleJs | null> {
    if (win.Paddle) return Promise.resolve(win.Paddle);
    script ??= new Promise((resolve) => {
      const s = doc.createElement('script');
      s.src = o.scriptUrl ?? PADDLE_JS;
      s.async = true;
      const timer = win.setTimeout(() => resolve(null), 15_000);
      s.onload = () => { win.clearTimeout(timer); resolve(win.Paddle ?? null); };
      s.onerror = () => { win.clearTimeout(timer); script = null; resolve(null); };
      doc.head.appendChild(s);
    });
    return script;
  }

  // ───────── the panel ─────────
  const $ = <T extends Element>(sel: string): T | null => (dialog ? dialog.querySelector<T>(sel) : null);
  function status(text: string, tone: 'info' | 'ok' | 'warn' = 'info'): void {
    const el = $<HTMLElement>('[data-pdl-status]');
    if (!el) return;
    el.textContent = text;
    el.dataset['tone'] = tone;
    el.hidden = text === '';
  }
  function setBusy(busy: boolean): void {
    const b = $<HTMLButtonElement>('[data-pdl-close]');
    if (b) b.disabled = busy;
  }

  function build(offer: CheckoutOffer): HTMLDialogElement {
    dialog?.remove();
    const d = doc.createElement('dialog');
    d.className = 'ba-modal pdl-sheet';
    d.setAttribute('aria-labelledby', 'pdl-title');
    d.dataset['pdl'] = offer.id;
    const trust = o.t(offer.recurring ? 'paddle.trust.sub' : 'paddle.trust.once', { days: PADDLE_REFUND_DAYS });
    d.innerHTML = (html`<div class="pdl-head">
        <div class="pdl-what"><p class="pdl-brand">BodyArcade</p><h2 id="pdl-title">${offer.name}</h2></div>
        <button type="button" class="ba-icon-btn pdl-close" data-pdl-close aria-label="${o.t('paddle.sheet.close')}">${icon('close')}</button>
      </div>
      <p class="pdl-price"><strong data-pdl-total>${offer.priceLine}</strong></p>
      ${offer.trialLine ? html`<p class="pdl-trial">${offer.trialLine}</p>` : ''}
      <p class="pdl-tax" data-pdl-tax>${o.t('paddle.sheet.taxIncluded')}</p>
      <p class="pdl-trust">${icon('lock', { size: 16 })}<span>${trust}</span></p>
      <p class="pdl-status" data-pdl-status role="status" aria-live="polite">${o.t('paddle.sheet.loading')}</p>
      <div class="${FRAME_CLASS}" data-pdl-frame></div>
      <div class="pdl-done" data-pdl-done hidden><button type="button" class="ba-btn ba-btn--primary ba-btn--lg" data-pdl-finish>${o.t('paddle.sheet.doneCta')}</button></div>`).value;
    d.querySelector('[data-pdl-close]')?.addEventListener('click', () => close());
    d.querySelector('[data-pdl-finish]')?.addEventListener('click', () => close());
    // Esc closes like the button, but never while a payment or the turning on of Pro is under way.
    d.addEventListener('cancel', (e) => { if (phase === 'paying' || phase === 'claiming') e.preventDefault(); else { e.preventDefault(); close(); } });
    doc.body.appendChild(d);
    return d;
  }

  const money = (amount: number | string | undefined, currency: string | undefined): string | null => {
    const n = typeof amount === 'string' ? Number(amount) : amount;
    if (n === undefined || !Number.isFinite(n) || !currency) return null;
    try { return new Intl.NumberFormat(o.lang(), { style: 'currency', currency }).format(n); } catch { return null; }
  };

  /** The price in the buyer's own currency once Paddle knows where they are (a trial shows what is charged after it). */
  function showTotals(d: PaddleEventData): void {
    const t = d.recurring_totals && current?.trialLine ? d.recurring_totals : d.totals;
    const total = money(t?.total, d.currency_code);
    const totalEl = $<HTMLElement>('[data-pdl-total]');
    if (total && totalEl && current) {
      const period = current.priceLine.replace(/^[^\d]*[\d.,\s]+[^\d\s]*\s*/, '');
      totalEl.textContent = current.recurring && period && period !== current.priceLine ? `${total} ${period}` : total;
    }
    const tax = Number(t?.tax ?? 0);
    const taxEl = $<HTMLElement>('[data-pdl-tax]');
    if (taxEl) taxEl.textContent = tax > 0 ? o.t('paddle.sheet.taxAmount', { tax: money(tax, d.currency_code) ?? '' }) : o.t('paddle.sheet.taxIncluded');
  }

  // ───────── after the payment ─────────
  /** Transaction id -> Paddle key -> Pro on this device. Retries while Paddle finishes the payment. */
  async function claim(txn: string, interactive: boolean): Promise<boolean> {
    store.set(PENDING_SLOT, txn);
    for (let i = 0; i < 20; i++) {
      const a = await postJson(API.paddle, { txn });
      if (a && a.status === 200 && typeof a.body['key'] === 'string' && isPaddleKey(a.body['key'])) {
        const c = a.body as unknown as PaddleClaim;
        const r = await o.activate(c.key);
        if (r.ok) {
          store.set(KEY_SLOT, c.key);
          store.del(PENDING_SLOT);
          if (interactive) {
            status(`${o.t('paddle.sheet.done')} ${c.duplicate ? o.t('paddle.sheet.duplicate') : o.t('paddle.sheet.receipt')}`, 'ok');
            const done = $<HTMLElement>('[data-pdl-done]');
            if (done) done.hidden = false;
            $<HTMLButtonElement>('[data-pdl-finish]')?.focus();
          }
          o.onPro?.(r.plan, interactive ? 'checkout' : 'pending');
          return true;
        }
        if (r.code === 'limit' || r.code === 'refunded' || r.code === 'ended') break;     // a clear answer: waiting changes nothing
      } else if (a && a.status !== 404 && a.status < 500 && a.status !== 429) {
        break;                                                                          // refused: not ours, or malformed
      } else if (a && a.status === 404 && a.body['pending'] !== true) {
        break;
      }
      await wait(Math.min(retryMs * (1 + i / 4), 6000));
    }
    if (interactive) status(o.t('paddle.sheet.slow'), 'warn');
    return false;
  }

  function onEvent(e: { name?: string; data?: PaddleEventData }): void {
    const name = e?.name ?? '';
    const data = e?.data ?? {};
    switch (name) {
      case 'checkout.loaded':
        phase = 'ready';
        status('');
        showTotals(data);
        break;
      // every change Paddle makes to the sum (a code, the buyer's country and its tax) is shown in our panel at once
      case 'checkout.updated':
      case 'checkout.items.updated':
      case 'checkout.discount.applied':
      case 'checkout.discount.removed':
      case 'checkout.customer.created':
      case 'checkout.customer.updated':
        showTotals(data);
        break;
      case 'checkout.payment.initiated':
        phase = 'paying';
        setBusy(true);
        status(o.t('paddle.sheet.processing'));
        break;
      case 'checkout.payment.failed':
      case 'checkout.payment.error':
        phase = 'ready';
        setBusy(false);
        status(o.t('paddle.sheet.failed'), 'warn');
        break;
      case 'checkout.error':
        if (phase === 'loading') { phase = 'ready'; status(o.t('paddle.sheet.error'), 'warn'); }
        break;
      case 'checkout.completed':
        if (phase === 'claiming' || phase === 'done' || !data.transaction_id) return;
        phase = 'claiming';
        setBusy(true);
        status(o.t('paddle.sheet.activating'));
        void claim(data.transaction_id, true).then(() => { phase = 'done'; setBusy(false); });
        break;
      default:
        break;
    }
  }

  async function open(offer: CheckoutOffer): Promise<boolean> {
    const cfg = await loadConfig();
    const priceId = cfg?.prices[offer.id];
    if (!cfg || !priceId) return false;
    const paddle = await loadScript();
    if (!paddle) return false;
    try {
      if (!initialized) {
        if (cfg.environment === 'sandbox') (paddle as unknown as { Environment?: { set(e: string): void } }).Environment?.set('sandbox');
        paddle.Initialize({ token: cfg.token, eventCallback: onEvent });
        initialized = true;
      }
    } catch {
      return false;
    }
    current = offer;
    phase = 'loading';
    dialog = build(offer);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    const root = doc.documentElement;
    const dark = root.dataset['theme'] === 'dark' || (root.dataset['theme'] !== 'light' && !!win.matchMedia?.('(prefers-color-scheme: dark)').matches);
    try {
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customData: { app: 'bodyarcade', plan: offer.id, lang: o.lang(), source: o.source?.() ?? 'direct' },
        settings: {
          displayMode: 'inline', variant: 'one-page', frameTarget: FRAME_CLASS, frameInitialHeight: 450,
          frameStyle: 'width:100%;min-width:286px;background-color:transparent;border:none;',
          locale: LOCALES[o.lang()] ?? 'en', theme: dark ? 'dark' : 'light', allowLogout: true, showAddDiscounts: true,
        },
      });
    } catch {
      close();
      return false;
    }
    return true;
  }

  function close(): void {
    if (phase === 'paying' || phase === 'claiming') return;
    try { if (phase !== 'idle' && win.Paddle) win.Paddle.Checkout.close(); } catch { /* already gone */ }
    phase = 'idle';
    current = null;
    if (dialog) { if (dialog.open) dialog.close(); dialog.remove(); dialog = null; }
  }

  async function resume(): Promise<void> {
    const m = RESTORE_HASH_RE.exec(win.location.hash);
    if (m && m[1]) {
      // the key leaves the address bar at once, so it is not kept in the history or shared by mistake
      try { win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search); } catch { /* ignore */ }
      const r = await o.activate(m[1]);
      if (r.ok) { store.set(KEY_SLOT, m[1]); o.onPro?.(r.plan, 'restore'); }
      else o.onRestoreFailed?.();
    }
    const pending = store.get(PENDING_SLOT);
    if (pending && /^txn_[0-9a-z]{26}$/.test(pending)) await claim(pending, false);
  }

  async function restoreByEmail(email: string): Promise<'sent' | 'error'> {
    const a = await postJson(API.paddleRestore, { email: email.trim(), lang: o.lang() });
    return a && a.status === 200 ? 'sent' : 'error';
  }

  async function manage(): Promise<boolean> {
    const key = store.get(KEY_SLOT);
    if (!key || !isPaddleKey(key)) return false;
    // the tab is opened inside the click (a pop-up blocker allows that), then sent to the portal
    const tab = win.open('', '_blank');
    const a = await postJson(API.paddlePortal, { key });
    const url = a && a.status === 200 && typeof a.body['url'] === 'string' ? a.body['url'] : null;
    if (!url || !/^https:\/\/([a-z0-9-]+\.)*paddle\.com\//.test(url)) { tab?.close(); return false; }
    if (tab) { try { tab.opener = null; } catch { /* ignore */ } tab.location.href = url; } else win.location.href = url;
    return true;
  }

  return {
    open, close, resume, restoreByEmail, manage,
    hasPurchase: () => isPaddleKey(store.get(KEY_SLOT)),
    remember: (key) => { if (isPaddleKey(key)) store.set(KEY_SLOT, key.trim()); },
  };
}
