// Entry of the social module (profiles, friends, presence, lobby directory, quick match, moderation).
// The Worker entry (src/index.ts) needs three things from here:
//
//   import { registerSocial } from './social/index.ts';     registerSocial(router);
//   export { PlayerHub } from './social/index.ts';           the Durable Object class (binding HUB, migration v2)
//
// plus the D1 database binding "DB" (packages/server/migrations/0001_social.sql) in wrangler.jsonc.
import type { Router } from '../router.ts';
import { installSocialHooks } from './hooks.ts';
import { registerSocialRoutes } from './routes.ts';

export { PlayerHub } from './hub.ts';
export { installSocialHooks, socialHooks } from './hooks.ts';
export { registerSocialRoutes } from './routes.ts';
export type { SocialEnv } from './env.ts';

/** Routes on the Worker's router and the hooks live play calls (rooms, reports, the join gate). */
export function registerSocial(router: Router): void {
  registerSocialRoutes(router);
  installSocialHooks();
}
