// Signing side of the entitlement token. Only the Worker (and tests, and the key tool) imports this file; the app
// bundle needs token.ts alone. The private key is a Worker secret (ENT_PRIV_JWK) and never enters the repository.
import { b64urlEncode, type TokenClaims, type TokenKey } from './token.ts';

export type PrivateKeyJwk = JsonWebKey & { kid: string };

const utf8 = new TextEncoder();

/** RFC 7638 thumbprint of an EC public key, shortened: the key's name in token headers. */
export async function thumbprint(jwk: JsonWebKey): Promise<string> {
  const text = `{"crv":"P-256","kty":"EC","x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)));
  return b64urlEncode(digest).slice(0, 16);
}

/** A new ES256 key pair as JWKs. The private one goes to `wrangler secret put ENT_PRIV_JWK`, the public one to the app. */
export async function generateSigningKeys(): Promise<{ privateJwk: PrivateKeyJwk; publicKey: TokenKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const kid = await thumbprint(pub);
  return {
    privateJwk: { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d, kid },
    publicKey: { kid, jwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y } },
  };
}

/** The public half of a private JWK (what the app may know). */
export function publicKeyOf(privateJwk: PrivateKeyJwk): TokenKey {
  return { kid: privateJwk.kid, jwk: { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y } };
}

export async function importSigningKey(privateJwk: PrivateKeyJwk): Promise<CryptoKey> {
  const { kty, crv, x, y, d } = privateJwk;
  return crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Reads the secret's text; null for anything that is not a usable private ES256 key with a name. */
export function parsePrivateJwk(text: unknown): PrivateKeyJwk | null {
  if (typeof text !== 'string') return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j['kty'] !== 'EC' || j['crv'] !== 'P-256') return null;
    for (const f of ['x', 'y', 'd', 'kid'] as const) if (typeof j[f] !== 'string' || (j[f] as string).length === 0) return null;
    return { kty: 'EC', crv: 'P-256', x: j['x'] as string, y: j['y'] as string, d: j['d'] as string, kid: j['kid'] as string };
  } catch {
    return null;
  }
}

export async function signToken(claims: TokenClaims, key: CryptoKey, kid: string): Promise<string> {
  const header = b64urlEncode(utf8.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })));
  const payload = b64urlEncode(utf8.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8.encode(`${header}.${payload}`) as BufferSource));
  return `${header}.${payload}.${b64urlEncode(sig)}`;
}
