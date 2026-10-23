// The BodyArcade Worker: one router for every server module, then the static assets (the web app).
//
// Adding a module (builder S for entitlements, builder SO for social) takes two lines here:
//   1. an import and one `registerXxxRoutes(router)` call in the block below (routes are registered on the shared
//      router at import time; each module narrows `env` to its own bindings, nobody edits a shared Env type);
//   2. `export { Xxx } from './xxx/...'` for each Durable Object class the module adds, plus its binding and
//      migration in wrangler.jsonc.
import type { Fetcher, ExecutionContextLike } from './cf.ts';
import { router } from './router.ts';
import { registerLiveRoutes } from './live/routes.ts';

export { Room } from './live/room.ts';

// ───────── modules (one line each) ─────────
registerLiveRoutes(router);

export default {
  async fetch(req: Request, env: Record<string, unknown>, ctx: ExecutionContextLike): Promise<Response> {
    const res = await router.handle(req, env, ctx);
    if (res) return res;
    const assets = env.ASSETS as Fetcher | undefined;
    if (!assets) return new Response('not found', { status: 404 });
    try {
      return await assets.fetch(req);
    } catch (e) {
      console.log(JSON.stringify({ evt: 'assets_error', error: String(e) }));
      return new Response('unavailable', { status: 503 });
    }
  },
};
