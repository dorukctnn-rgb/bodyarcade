// Entry of the entitlement module (who may use Pro: web purchases on Gumroad, Google Play purchases inside the Android
// app, signed tokens, device seats, the trial reminder). The Worker entry (src/index.ts) needs two things from here:
//
//   import { registerEntitlements } from './entitlements/index.ts';   registerEntitlements(router);
//   export { EntitlementsDO } from './entitlements/index.ts';          the Durable Object (binding ENTITLEMENTS, migration ent-v1)
//
// Settings (wrangler secret put ...): ENT_PRIV_JWK (required), PLAY_SA_JSON, ENT_MAIL_TOKEN with ENT_MAIL_FROM (optional);
// the variable GUMROAD_PRODUCTS and the older public keys in ENT_PUB_JWKS are optional too. See env.ts.
export { EntitlementsDO } from './durable.ts';
export { registerEntitlementRoutes, registerEntitlements } from './routes.ts';
export type { EntitlementsEnv } from './env.ts';
