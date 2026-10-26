// What the directory knows about where a request came from. The directory is reached only through the Worker (routes.ts
// `forwardToDirectory`), and a Durable Object is not given Cloudflare's view of the caller, so the Worker copies it into headers
// (replacing anything the caller sent under the same names) and the handlers read it from there. Tests, and the handlers run
// straight on a router, carry the standard headers instead (`CF-Connecting-IP`, `CF-IPCountry`) or a `cf` object.
import { clientIp } from '../http.ts';

/** The caller's address as the Worker saw it. */
export const CALLER_IP = 'X-BA-IP';
/** The caller's country (two letters): the header Cloudflare itself sets, which the Worker also fills from `request.cf`. */
export const GEO_COUNTRY = 'CF-IPCountry';
/** The caller's continent (two letters, `request.cf.continent`). */
export const GEO_CONTINENT = 'X-BA-Continent';

/** The caller's address: the one the Worker passed on, else the one Cloudflare reports ('' when there is none). */
export function callerIp(req: Request): string {
  return req.headers.get(CALLER_IP) ?? clientIp(req);
}

/** The continent of a request: the header the Worker set, else `request.cf.continent`; null when it is not known. */
export function continentOf(req: Request): string | null {
  const h = req.headers.get(GEO_CONTINENT);
  if (h && /^[A-Za-z]{2}$/.test(h)) return h.toUpperCase();
  const c = (req as unknown as { cf?: { continent?: unknown } }).cf?.continent;
  return typeof c === 'string' && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
}
