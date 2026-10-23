// The Worker's one router. Every server module registers its routes here at import time, with one line in
// src/index.ts (live play: registerLiveRoutes; store: entitlements; social: profiles, friends, lobbies).
//
//   router.add('POST', '/api/rooms/:code/join', handler)
//
// Patterns are literal segments and `:name` parameters (one path segment each, URI-decoded). A path that matches
// a pattern with another method answers 405 with an Allow header; an unknown /api/ path answers 404 JSON; any
// other path falls through to the static assets. A handler that throws HttpError answers its status and code;
// any other exception answers 500 `{ "error": "internal" }` and is logged without the request body.
import type { ExecutionContextLike } from './cf.ts';
import { HttpError, fail } from './http.ts';

export type Params = Readonly<Record<string, string>>;

/**
 * A route handler. `env` is the Worker's env object: each module narrows it to its own bindings
 * (for example `env as LiveEnv`), so modules never edit a shared Env type.
 */
export type Handler = (req: Request, env: Record<string, unknown>, ctx: ExecutionContextLike, params: Params) =>
  Response | Promise<Response>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    if (!pattern.startsWith('/')) throw new Error(`route pattern must start with '/': ${pattern}`);
    const m = method.toUpperCase();
    const parts = split(pattern);
    const clash = this.routes.find((r) => r.method === m && r.parts.join('/') === parts.join('/'));
    if (clash) throw new Error(`route registered twice: ${m} ${pattern}`);
    this.routes.push({ method: m, parts, handler });
    return this;
  }

  /** Every registered route as "METHOD /pattern" (for tests and the 405 Allow header). */
  list(): string[] {
    return this.routes.map((r) => `${r.method} /${r.parts.join('/')}`);
  }

  /** The matching route's response, or null when no route has this path (the caller serves assets). */
  async handle(req: Request, env: Record<string, unknown>, ctx: ExecutionContextLike): Promise<Response | null> {
    const url = new URL(req.url);
    const segs = split(url.pathname);
    const method = req.method.toUpperCase();
    const allowed: string[] = [];
    for (const r of this.routes) {
      const params = match(r.parts, segs);
      if (!params) continue;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) { allowed.push(r.method); continue; }
      try {
        return await r.handler(req, env, ctx, params);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.code, e.status, e.extra);
        console.error(JSON.stringify({ evt: 'route_error', route: `${r.method} /${r.parts.join('/')}`, error: String(e) }));
        return fail('internal', 500);
      }
    }
    if (allowed.length) return fail('method_not_allowed', 405, undefined, { Allow: [...new Set(allowed)].join(', ') });
    return url.pathname.startsWith('/api/') ? fail('not_found', 404) : null;
  }
}

function split(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function match(parts: readonly string[], segs: readonly string[]): Record<string, string> | null {
  if (parts.length !== segs.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as string;
    const s = segs[i] as string;
    if (p.startsWith(':')) {
      let v: string;
      try { v = decodeURIComponent(s); } catch { return null; }
      out[p.slice(1)] = v;
    } else if (p !== s) {
      return null;
    }
  }
  return out;
}

/** The Worker's router (src/index.ts registers every module on it). Tests make their own Router. */
export const router = new Router();
