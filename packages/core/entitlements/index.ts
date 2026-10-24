// core/entitlements: the public surface. The shell and the games import from here; the token signer (sign.ts) and the
// server are not part of it.
//
//   bootEntitlements(...)   everything for the page that is running: service, shell port, paywall
//   createEntitlements(...) the manager on its own (tests, other shells)
//   webPlans / playPlans    the offers; paywallModel decides what the paywall may show where
//   verifyToken             the offline check of the signed token
export {
  PLANS, PLAN_IDS, SOLD_PLAN_IDS, GUMROAD_LEGACY_PRODUCTS, PLAY_PRODUCTS, PLAY_PACKAGE, isPlanId, isSoldPlanId, entitlementFor, bestPlan,
  webPlans, playPlans, isoDays, playProductOf,
  type OfferShape, type PlanId, type PlanInfo, type PlansShape, type PlayItemDetails, type SoldPlanId, type WebPlansOptions,
} from './plans.ts';
export { GUMROAD_CATALOG, GUMROAD_CHECKOUT, GUMROAD_PRODUCTS, placeholdersIn, type GumroadListing } from './catalog.ts';
export { PUBLIC_KEYS, keysForHost, targetOfHost, type ReleaseTarget } from './keys.ts';
export { canUse, hasFamilyFeatures, DEFAULT_FREE_FEATURES, type FeatureRules } from './features.ts';
export { verifyToken, type TokenClaims, type TokenKey, type TokenFailure, type VerifyResult } from './token.ts';
export { API, API_PREFIX, DID_RE, LICENSE_KEY_RE, isExplicitRefusal, type ErrorCode, type Grant, type RefusalCode } from './api.ts';
export {
  standingOf, needsRefresh, isActive, DAY_MS, DIRECT_GRACE_MS, REFRESH_AFTER_MS,
  type Provider, type Standing, type StoredEntitlement,
} from './state.ts';
export { subscriptionEnd, judgePurchase, type Verdict } from './gumroad-rules.ts';
export { twaHint, detectBilling, provisionalMode, PLAY_BILLING_URL, type BillingEnv, type BillingMode, type Hint, type WindowLike } from './billing-env.ts';
export { paywallModel, PLAY_MANAGE_URL, type PaywallInputs, type PaywallMode, type PaywallModel, type PaywallNote } from './paywall.ts';
export {
  createEntitlements,
  type EntitlementStatus, type EntitlementsOptions, type EntitlementsService, type PurchaseResult, type RefreshOutcome,
} from './manager.ts';
export { createServerProvider, type ServerProviderOptions } from './providers/server.ts';
export { createGumroadProvider, type GumroadProviderOptions } from './providers/gumroad.ts';
export { createPlayProvider, type DigitalGoodsService, type PaymentRequestLike, type PlayProvider, type PlayProviderOptions } from './providers/play.ts';
export { CANCELLED } from './providers/shared.ts';
export type { ManagedProvider, RefreshContext, FetchLike } from './providers/shared.ts';
export { loadDeviceId, newDeviceId } from './device.ts';
export { legacyFallback, planOfLegacy } from './legacy-license.ts';
export { toShellPort, type PortOptions, type ShellEntitlementsPort } from './port.ts';
export { bootEntitlements, type BootOptions, type BootResult, type BootWindow } from './boot.ts';
