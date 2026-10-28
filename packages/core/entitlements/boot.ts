// One call that assembles the entitlements for the page that is running: finds out whether it is the browser or the
// Android app, registers the providers that belong there, and hands back the service, the shell's port and the paywall.
//
//   browser          our server (the key box) and, behind it, Gumroad checked directly when the server cannot be reached
//   Android app      our server (the key box, for people who bought elsewhere earlier) and Google Play; NEVER Gumroad,
//                    not even a network call to it
//   app without Play our server only: the paywall says purchases need the Play version
import { readLegacyV1, browserStorage, type BodyArcadeStore, type LegacyLicense, type StorageLike } from '../store/index.ts';
import { detectBilling, twaHint, PLAY_BILLING_URL, type BillingEnv, type Hint, type WindowLike } from './billing-env.ts';
import { GUMROAD_CHECKOUT } from './catalog.ts';
import { keysForHost } from './keys.ts';
import { createEntitlements, type EntitlementsService } from './manager.ts';
import { paywallModel, type PaywallInputs, type PaywallModel } from './paywall.ts';
import type { FeatureRules } from './features.ts';
import type { PlanId, SoldPlanId } from './plans.ts';
import { toShellPort, type ShellEntitlementsPort } from './port.ts';
import { createGumroadProvider } from './providers/gumroad.ts';
import { createPlayProvider, type PaymentRequestLike } from './providers/play.ts';
import { createServerProvider } from './providers/server.ts';
import { createTrial, type TrialService } from './trial.ts';
import type { FetchLike, ManagedProvider } from './providers/shared.ts';
import type { TokenKey } from './token.ts';

export interface BootWindow extends WindowLike {
  location: { search: string; hostname?: string };
  document: WindowLike['document'] & { visibilityState?: string; addEventListener?(type: 'visibilitychange', cb: () => void): void };
  PaymentRequest?: new (methods: unknown, details: unknown) => PaymentRequestLike;
}

/** The least time between two quiet looks at Google Play's list of this account's purchases (recoverPlayPurchases). */
export const PLAY_RECOVER_EVERY_MS = 60_000;

/**
 * A Play purchase that Google charged but our server could not confirm (Google unreachable, or the service account not yet
 * allowed to read this app's orders) leaves nothing on this device: no renewal ever looks at it again, the Pro screen's
 * "Restore purchases" button was the only way back, and Play refunds a purchase nobody acknowledges within three days.
 * So while this device has no Pro, the app asks Google Play's own list once at start and again each time it comes back to
 * the front, at most once a minute. An empty list costs no request to our server; a purchase found goes to the server,
 * which confirms and acknowledges it exactly as the Restore button would. Quiet: nothing is shown, a Pro that arrives
 * redraws the page through onChange.
 */
function recoverPlayPurchases(service: EntitlementsService, doc: BootWindow['document'] | undefined, now: () => number): void {
  let last: number | null = null;
  const look = (): void => {
    const t = now();
    if (last !== null && t >= last && t - last < PLAY_RECOVER_EVERY_MS) return;
    if (service.current().plan !== 'free') return;
    last = t;
    void service.restore().catch(() => undefined);
  };
  look();
  try {
    doc?.addEventListener?.('visibilitychange', () => { if (doc?.visibilityState !== 'hidden') look(); });
  } catch { /* a document without events: the start alone */ }
}

export interface BootOptions {
  store: BodyArcadeStore;
  /** The public key(s) that verify entitlement tokens. Default: the keys of the site the page runs on (keys.ts). */
  keys?: readonly TokenKey[];
  window?: BootWindow;
  fetch?: FetchLike;
  /** Origin of the API; empty for the page's own origin. */
  baseUrl?: string;
  /** Gumroad product ids added to the two old ones (id -> plan). */
  gumroadProducts?: Readonly<Record<string, PlanId>>;
  /** The checkout addresses the web paywall may offer, per sold plan. Default: the catalog of the repository (catalog.ts); a test passes its own, so it does not move with it. */
  checkout?: Readonly<Partial<Record<SoldPlanId, string>>>;
  now?: () => number;
  rules?: FeatureRules;
  /** Where the live site's licence is read from. Default: the browser's own storage. null: no migration. */
  legacyStorage?: StorageLike | null;
  autoRefresh?: boolean;
}

export interface BootResult {
  service: EntitlementsService;
  env: BillingEnv;
  port: ShellEntitlementsPort;
  /** What suggested the Android app before the proof came in (billing-env.ts). */
  hint: Hint;
  /** The notice in the last two days of a free trial and, on the web, the box for the one reminder e-mail (trial.ts). */
  trial: TrialService;
  /** The paywall for what is known now; pass the Play details and checkout addresses you have. */
  paywall(inputs?: PaywallInputs): PaywallModel;
}

export async function bootEntitlements(o: BootOptions): Promise<BootResult> {
  const w = o.window ?? (typeof window === 'undefined' ? undefined : (window as unknown as BootWindow));
  const keys = o.keys ?? keysForHost(w?.location.hostname ?? '');
  const hint: Hint = w ? twaHint(w) : 'none';
  const env: BillingEnv = w ? await detectBilling(w, hint) : { mode: 'web', hint: 'none', service: null };

  let didOf = (): string => '';
  const common = { ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.baseUrl !== undefined ? { baseUrl: o.baseUrl } : {}), ...(o.now ? { now: o.now } : {}) };
  const providers: ManagedProvider[] = [];
  const server = createServerProvider({ ...common, did: () => didOf(), keys });
  providers.push(server);

  if (env.mode === 'web') {
    providers.push(createGumroadProvider({ ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.now ? { now: o.now } : {}), ...(o.gumroadProducts ? { products: o.gumroadProducts } : {}) }));
  } else if (env.mode === 'play' && env.service && w?.PaymentRequest) {
    const Payment = w.PaymentRequest;
    providers.push(createPlayProvider({
      ...common, did: () => didOf(), keys, service: env.service,
      createPayment: (sku) => new Payment([{ supportedMethods: PLAY_BILLING_URL, data: { sku } }], { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }),
    }));
  }

  const legacyStorage = o.legacyStorage === undefined ? browserStorage() : o.legacyStorage;
  const legacy = legacyStorage && env.mode === 'web'
    ? (): LegacyLicense | null => readLegacyV1(legacyStorage, o.now ? { now: o.now() } : {})?.license ?? null
    : undefined;

  const service = createEntitlements({
    store: o.store, keys, providers,
    keyOrder: ['server', 'gumroad'],
    ...(o.now ? { now: o.now } : {}),
    ...(o.rules ? { rules: o.rules } : {}),
    ...(legacy ? { legacy } : {}),
    ...(o.autoRefresh !== undefined ? { autoRefresh: o.autoRefresh } : {}),
  });
  didOf = service.deviceId;
  await service.ready();
  if (service.hasProvider('play') && o.autoRefresh !== false) recoverPlayPurchases(service, w?.document, o.now ?? Date.now);

  // The e-mail is for the browser only: in the Android app Google Play sends its own reminder.
  const trial = createTrial({ service, store: o.store, mode: env.mode === 'web' ? 'web' : 'play', ...common });

  return {
    service, env, hint, trial,
    port: toShellPort(service, { play: env.mode === 'play' }),
    paywall(inputs = {}) {
      return paywallModel(env.mode, { trialEligible: !service.status().everPaid, checkout: o.checkout ?? GUMROAD_CHECKOUT, ...inputs });
    },
  };
}
