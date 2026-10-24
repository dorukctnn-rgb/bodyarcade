// The public site's own routes (release owner): the old game addresses of the live site, which now go to the new app
// with their query kept and routed by what the query asks for, and the sink for Content-Security-Policy reports.
// Registered with registerSiteRoutes(router) in src/index.ts.
//
//   GET  /bodyarcade (and the other old game addresses)   301 to /, /pro/ (?license=) or /games/road-run/ (?c=, ?world=)
//   POST /api/csp-report                                  204; logs a short line per report (sampled)
//
// The plain renames of the old content pages (.html to extensionless, /blog to /blog/, /uploads/*) stay in the static
// _redirects file (release/build.ts writes it); only these addresses need the query, so only they run the Worker first
// (assets.run_worker_first in the wrangler configs lists exactly GAME_ALIASES, a unit test keeps them equal).
import type { Router } from '../router.ts';

/** Every address the old game page answered on. The router ignores a trailing slash, so /bodyarcade/ is included. */
export const GAME_ALIASES: readonly string[] = ['/bodyarcade', '/BodyArcade', '/BodyArcade.html', '/bodyarcade.html', '/play', '/app', '/index.html'];

/** Query keys of the old game that mean nothing to the new app (the old live-race notice, the old Pro shortcut). */
const DROPPED = ['live', 'pro'];

/**
 * Where an old game address goes. A purchase receipt's activation link (?license=) opens the Pro page with the key;
 * a friend challenge (?c=) or a world chosen on the old landing (?world=) opens the running game that has them; any
 * other visit opens the app's home. The rest of the query (campaign tags and the like) is kept.
 */
export function legacyGameTarget(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of DROPPED) q.delete(k);
  const path = q.has('license') ? '/pro/' : q.has('c') || q.has('world') ? '/games/road-run/' : '/';
  const rest = q.toString();
  return rest ? `${path}?${rest}` : path;
}

/** A 301 to a same-origin path: an absolute Location built from the request, never cached by shared caches for long. */
function moved(req: Request, to: string): Response {
  return new Response(null, { status: 301, headers: { Location: new URL(to, req.url).toString(), 'Cache-Control': 'public, max-age=3600' } });
}

// ---- CSP reports ----------------------------------------------------------------------------------------------------

const REPORT_MAX_BYTES = 16_384;
/** At most this many report lines per isolate and minute, so a broken page cannot flood the logs. */
const REPORTS_PER_MINUTE = 30;
let windowStart = 0;
let windowCount = 0;

/** The parts of one violation worth a log line: the directive, what was blocked (origin only) and where (path only). */
export interface CspLine { directive: string; blocked: string; page: string; source: string }

const originOf = (v: unknown): string => {
  if (typeof v !== 'string' || !v) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) return v.slice(0, 40);          // 'inline', 'eval', 'self'
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'wss:' ? u.origin : u.protocol; } catch { return ''; }
};
const pathOf = (v: unknown): string => {
  if (typeof v !== 'string' || !v) return '';
  try { return new URL(v).pathname.slice(0, 120); } catch { return ''; }
};

/** Reads both report formats: the old `{"csp-report": {...}}` and the Reporting API's `[{type:"csp-violation", body}]`. */
export function parseCspReports(text: string): CspLine[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const bodies: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    for (const r of data) {
      if (r && typeof r === 'object' && (r as { type?: unknown }).type === 'csp-violation' && typeof (r as { body?: unknown }).body === 'object' && (r as { body?: unknown }).body) bodies.push((r as { body: Record<string, unknown> }).body);
    }
  } else if (data && typeof data === 'object' && typeof (data as Record<string, unknown>)['csp-report'] === 'object' && (data as Record<string, unknown>)['csp-report']) {
    bodies.push((data as Record<string, Record<string, unknown>>)['csp-report'] as Record<string, unknown>);
  }
  return bodies.slice(0, 10).map((b) => {
    const directive = String(b['effectiveDirective'] ?? b['effective-directive'] ?? b['violated-directive'] ?? '').split(' ')[0]?.slice(0, 40) ?? '';
    const blocked = originOf(b['blockedURL'] ?? b['blocked-uri']);
    const page = pathOf(b['documentURL'] ?? b['document-uri']);
    const file = pathOf(b['sourceFile'] ?? b['source-file']);
    const line = b['lineNumber'] ?? b['line-number'];
    return { directive, blocked, page, source: file ? `${file}${typeof line === 'number' ? `:${line}` : ''}` : '' };
  });
}

async function readCapped(req: Request): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REPORT_MAX_BYTES) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

export async function cspReport(req: Request, now = Date.now()): Promise<Response> {
  const text = await readCapped(req);
  if (text === null) return new Response(null, { status: 413 });
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  for (const l of parseCspReports(text)) {
    if (windowCount >= REPORTS_PER_MINUTE) break;
    windowCount++;
    console.log(JSON.stringify({ evt: 'csp', ...l }));
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function registerSiteRoutes(router: Router): void {
  for (const path of GAME_ALIASES) router.add('GET', path, (req) => moved(req, legacyGameTarget(new URL(req.url).search)));
  router.add('POST', '/api/csp-report', (req) => cspReport(req));
}
