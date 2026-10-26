// Signed join tickets (tech.md 9.3): the Worker signs who may take a seat in which room, the Room trusts only that.
// Format: base64url(JSON claims) "." base64url(HMAC-SHA256(secret, first part)). The secret is the Worker secret
// TICKET_SECRET (at least 32 characters); it never leaves the server.
//
// The same secret also derives block keys: an opaque, stable id per player that a device can store to say "I
// blocked this player" without ever learning the other player's device id.
import type { AgeBand, RoomCode, TicketClaims } from '../../../core/types/net.ts';
import { isRoomCode } from '../../../core/net/codes.ts';

export const TICKET_TTL_S = 6 * 3600;
export const MIN_SECRET_CHARS = 32;

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, k);
  }
  return k;
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function checkSecret(secret: unknown): string {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_CHARS) {
    throw new Error(`TICKET_SECRET must be set to at least ${MIN_SECRET_CHARS} characters`);
  }
  return secret;
}

export interface TicketInput {
  code: RoomCode;
  pid: string;
  name: string;
  age: AgeBand;
  /** Free text muted until this epoch ms. */
  mutedUntil?: number;
  /** Epoch ms until which the Worker verified this player's signed Pro token (pro.ts); absent for a player with none. */
  proUntil?: number;
}

export async function signTicket(secret: string, input: TicketInput, nowMs: number, ttlS = TICKET_TTL_S): Promise<{ ticket: string; claims: TicketClaims }> {
  const claims: TicketClaims = { v: 1, c: input.code, p: input.pid, n: input.name, a: input.age, k: await blockKey(secret, input.pid), e: Math.floor(nowMs / 1000) + ttlS };
  if (input.mutedUntil && input.mutedUntil > nowMs) claims.m = Math.floor(input.mutedUntil);
  if (input.proUntil && input.proUntil > nowMs) claims.x = Math.floor(input.proUntil / 1000);
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return { ticket: `${body}.${b64url(sig)}`, claims };
}

export type TicketError = 'malformed' | 'signature' | 'expired' | 'wrong_room';

/** Verifies signature, expiry and (when given) the room; the claims are fully shape-checked before use. */
export async function verifyTicket(secret: string, ticket: unknown, nowMs: number, code?: RoomCode): Promise<{ ok: true; claims: TicketClaims } | { ok: false; error: TicketError }> {
  if (typeof ticket !== 'string' || ticket.length > 1024) return { ok: false, error: 'malformed' };
  const dot = ticket.indexOf('.');
  if (dot <= 0 || dot !== ticket.lastIndexOf('.')) return { ok: false, error: 'malformed' };
  const body = ticket.slice(0, dot);
  const sig = fromB64url(ticket.slice(dot + 1));
  if (!sig || sig.length !== 32) return { ok: false, error: 'malformed' };
  const good = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(body));
  if (!good) return { ok: false, error: 'signature' };
  const raw = fromB64url(body);
  let claims: unknown;
  try { claims = raw ? JSON.parse(new TextDecoder().decode(raw)) : null; } catch { claims = null; }
  if (!isClaims(claims)) return { ok: false, error: 'malformed' };
  if (claims.e * 1000 <= nowMs) return { ok: false, error: 'expired' };
  if (code !== undefined && claims.c !== code) return { ok: false, error: 'wrong_room' };
  return { ok: true, claims };
}

const AGES: readonly AgeBand[] = ['child', 'teen', 'adult'];

export function isClaims(x: unknown): x is TicketClaims {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Record<string, unknown>;
  return c.v === 1 && isRoomCode(c.c) && typeof c.p === 'string' && c.p.length >= 8 && c.p.length <= 64 &&
    typeof c.n === 'string' && c.n.length >= 1 && c.n.length <= 40 && AGES.includes(c.a as AgeBand) &&
    typeof c.k === 'string' && /^[A-Za-z0-9_-]{16,40}$/.test(c.k) &&
    Number.isInteger(c.e) && (c.m === undefined || (typeof c.m === 'number' && Number.isFinite(c.m))) &&
    (c.x === undefined || (typeof c.x === 'number' && Number.isInteger(c.x) && c.x > 0 && c.x < 4_102_444_800));
}

/** An opaque, stable key for "this player", safe to give other devices (block lists). 22 characters. */
export async function blockKey(secret: string, pid: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode('block:' + pid)));
  return b64url(sig.slice(0, 16));
}
