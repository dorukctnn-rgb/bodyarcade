// Signing in to Google as the service account (the PLAY_SA_JSON secret): a signed JWT is exchanged for an access token,
// which is kept until shortly before it runs out. Pure WebCrypto (RS256), so it runs in the Worker and in Node alike.
// Nothing here is a verdict about a purchase: when no token can be had, the caller says "unreadable".
import { b64urlEncode } from '../../../../core/entitlements/token.ts';
import type { FetchFn } from './gumroad.ts';

export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/** The secret's text as a service account, or null when it is not one (or points the sign-in somewhere else). */
export function parseServiceAccount(text: unknown): ServiceAccount | null {
  if (typeof text !== 'string' || text.length < 50 || text.length > 20_000) return null;
  let j: unknown;
  try { j = JSON.parse(text) as unknown; } catch { return null; }
  if (typeof j !== 'object' || j === null) return null;
  const o = j as Record<string, unknown>;
  const email = o['client_email'];
  const key = o['private_key'];
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) return null;
  if (typeof key !== 'string' || !/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(key)) return null;
  const uri = typeof o['token_uri'] === 'string' ? o['token_uri'] : GOOGLE_TOKEN_URI;
  if (uri !== GOOGLE_TOKEN_URI) return null;
  return { client_email: email, private_key: key, token_uri: uri };
}

function pemToDer(pem: string): Uint8Array | null {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  try {
    const bin = atob(body);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const utf8 = new TextEncoder();

export interface GoogleAuth {
  /** A usable access token, or null. `force` ignores the kept one (after a 401). */
  token(force?: boolean): Promise<string | null>;
}

export interface GoogleAuthOptions {
  account: ServiceAccount;
  fetch?: FetchFn;
  now?: () => number;
  scope?: string;
  timeoutMs?: number;
}

/** A token is renewed when it has less than this left. */
const RENEW_BEFORE_S = 300;

export function createGoogleAuth(o: GoogleAuthOptions): GoogleAuth {
  const f: FetchFn = o.fetch ?? ((input, init) => fetch(input, init));
  const now = o.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string | null> | null = null;
  let signing: Promise<CryptoKey | null> | null = null;

  function key(): Promise<CryptoKey | null> {
    signing ??= (async () => {
      const der = pemToDer(o.account.private_key);
      if (!der) return null;
      try {
        return await crypto.subtle.importKey('pkcs8', der as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      } catch {
        return null;
      }
    })();
    return signing;
  }

  async function fetchToken(): Promise<string | null> {
    const k = await key();
    if (!k) return null;
    const iat = Math.floor(now() / 1000);
    const header = b64urlEncode(utf8.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claims = b64urlEncode(utf8.encode(JSON.stringify({ iss: o.account.client_email, scope: o.scope ?? PLAY_SCOPE, aud: o.account.token_uri, iat, exp: iat + 3600 })));
    let signature: Uint8Array;
    try {
      signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, utf8.encode(`${header}.${claims}`) as BufferSource));
    } catch {
      return null;
    }
    const assertion = `${header}.${claims}.${b64urlEncode(signature)}`;
    try {
      const res = await f(o.account.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
        signal: AbortSignal.timeout(o.timeoutMs ?? 8_000),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof j.access_token !== 'string' || j.access_token.length < 10) return null;
      const life = typeof j.expires_in === 'number' && j.expires_in > 0 ? Math.min(j.expires_in, 3600) : 1800;
      cached = { token: j.access_token, expiresAt: iat + life };
      return j.access_token;
    } catch {
      return null;
    }
  }

  return {
    async token(force = false) {
      const t = Math.floor(now() / 1000);
      if (!force && cached && cached.expiresAt - t > RENEW_BEFORE_S) return cached.token;
      if (force) cached = null;
      pending ??= fetchToken().finally(() => { pending = null; });
      return pending;
    },
  };
}
