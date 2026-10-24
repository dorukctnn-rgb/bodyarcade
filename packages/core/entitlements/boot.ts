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
import type { PlanId } from './plans.ts';
import { toShellPort, type ShellEntitlementsPort } from './port.ts';
import { createGumroadProvider } from './providers/gumroad.ts';
import { createPlayProvider, type PaymentRequestLike } from './providers/play.ts';
import { createServerProvider } from './providers/server.ts';
import { createTrial, type TrialService } from './trial.ts';
import type { FetchLike, ManagedProvider } from './providers/shared.ts';
import type { TokenKey } from './token.ts';

export interface BootWindow extends WindowLike {
  location: { search: string; hostname?: string };
  PaymentRequest?: new (methods: unknown, details: unknown) => PaymentRequestLike;
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

  // The e-mail is for the browser only: in the Android app Google Play sends its own reminder.
  const trial = createTrial({ service, store: o.store, mode: env.mode === 'web' ? 'web' : 'play', ...common });

  return {
    service, env, hint, trial,
    port: toShellPort(service, { play: env.mode === 'play' }),
    paywall(inputs = {}) {
      return paywallModel(env.mode, { trialEligible: !service.status().everPaid, checkout: GUMROAD_CHECKOUT, ...inputs });
    },
  };
}
