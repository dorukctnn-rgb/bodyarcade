// Entry of the social module (profiles, friends, presence, lobby directory, quick match, moderation).
// The Worker entry (src/index.ts) needs three things from here:
//
//   import { registerSocial } from './social/index.ts';        registerSocial(router);
//   export { SocialDirectory } from './social/index.ts';        the Durable Object that holds everything (binding SOCIAL, migration v4)
//   export { PlayerHub } from './social/index.ts';              an empty class, kept because migration v2 created it (see hub.ts)
//
// Nothing else is bound: the social tables are the SQLite storage of the SocialDirectory object (schema.ts), created by its first
// request. The Worker's routes forward to it; the hooks live play calls reach it through the same binding.
import type { Router } from '../router.ts';
import { installSocialHooks } from './hooks.ts';
import { registerSocialRoutes } from './routes.ts';

export { SocialDirectory } from './directory.ts';
export { PlayerHub } from './hub.ts';
export { installSocialHooks, socialHooks } from './hooks.ts';
export { registerDirectoryRoutes, registerSocialRoutes } from './routes.ts';
export type { SocialEnv } from './env.ts';

/** Routes on the Worker's router and the hooks live play calls (rooms, reports, the join gate). */
export function registerSocial(router: Router): void {
  registerSocialRoutes(router);
  installSocialHooks();
}
