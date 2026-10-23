// Small HTTP helpers shared by every route module (live, entitlements, social).
// API answers are JSON, never cached, and same-origin only (no CORS headers: only our own pages call the API).

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(NO_STORE)) if (!h.has(k)) h.set(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}

/** `{ "error": code }` with the given status. Codes are stable machine words; the client translates them. */
export function fail(code: string, status: number, extra?: Record<string, unknown>, headers?: HeadersInit): Response {
  return json({ error: code, ...extra }, status, headers);
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown> | undefined;
  constructor(status: number, code: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Reads a JSON body of at most `maxBytes` (counted on the bytes actually received, not on Content-Length).
 * Throws HttpError 413 when too large, 415 when not JSON, 400 when malformed.
 */
export async function readJson(req: Request, maxBytes = 4096): Promise<unknown> {
  const type = req.headers.get('Content-Type') ?? '';
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'json_expected');
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'too_large');
  if (!req.body) throw new HttpError(400, 'bad_json');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new HttpError(413, 'too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

/** The client's IP as Cloudflare reports it (CF-Connecting-IP); '' when absent (local tests without it). */
export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? '';
}

/** Origin for links the server hands out (invite links): the PUBLIC_ORIGIN var, else the request's own origin. */
export function publicOrigin(req: Request, configured?: unknown): string {
  if (typeof configured === 'string' && /^https?:\/\/[^/]+$/.test(configured)) return configured;
  return new URL(req.url).origin;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
