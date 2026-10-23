// Codes and ids of the social layer: the friend code (BA-7K2Q4X), the friend-visible id and base64url helpers.
//
// The alphabet has 32 characters without 0, O, 1 and I (the same one the room code uses, tech.md 2.10), so one random
// byte maps to one character without bias (256 is a multiple of 32). A six-character code has 32^6 = 1.07 billion
// values: a guesser who tries a code per second needs decades per hit, which matters because a hit can reach a child.
// (Four characters, about a million values, would be guessable; see the lookup limits in rules.ts as well.)

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const FRIEND_CODE_LEN = 6;
export const FRIEND_CODE_PREFIX = 'BA-';
export const FID_LEN = 10;

/** Where random bytes come from; tests pass a seeded source. */
export type RandomBytes = (n: number) => Uint8Array;

export const cryptoRandomBytes: RandomBytes = (n) => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

/** `len` characters from the code alphabet. */
export function randomChars(len: number, rb: RandomBytes = cryptoRandomBytes): string {
  const bytes = rb(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[(bytes[i] ?? 0) & 31];
  return out;
}

/** A new friend code without its prefix: six characters. */
export const randomFriendChars = (rb?: RandomBytes): string => randomChars(FRIEND_CODE_LEN, rb);

/** A new friend-visible id: ten characters (50 bits). */
export const randomFid = (rb?: RandomBytes): string => randomChars(FID_LEN, rb);

/** The written form of a code: BA-7K2Q4X. */
export const formatFriendCode = (chars: string): string => FRIEND_CODE_PREFIX + chars;

// Characters people put between groups, plus the invisible ones that copy and paste adds.
const SEPARATORS = /[\s\-_.·• ​-‏⁠﻿]/gu;

/**
 * The six code characters of whatever a person typed or pasted ("ba-7k2q4x", " BA 7K2Q4X ", "7K2Q4X", the full-width
 * form), or null when it is not a valid friend code. The prefix is optional.
 */
export function parseFriendCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  let s = input.normalize('NFKC').toUpperCase().replace(SEPARATORS, '');
  if (s.startsWith('BA') && s.length === FRIEND_CODE_LEN + 2) s = s.slice(2);
  if (s.length !== FRIEND_CODE_LEN) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** True for six valid characters exactly as stored (no prefix, upper case). */
export function isFriendChars(s: unknown): s is string {
  return typeof s === 'string' && s.length === FRIEND_CODE_LEN && [...s].every((c) => CODE_ALPHABET.includes(c));
}

export const isFid = (s: unknown): s is string =>
  typeof s === 'string' && s.length === FID_LEN && [...s].every((c) => CODE_ALPHABET.includes(c));

/** https://bodyarcade.com/f/BA-7K2Q4X. `origin` may have trailing slashes. (Rooms use /r/CODE: core/net/codes.ts.) */
export const friendLink = (origin: string, chars: string): string => `${origin.replace(/\/+$/, '')}/f/${formatFriendCode(chars)}`;

/**
 * The code in a friend link: /f/BA-7K2Q4X on any host, or a bare code. A malformed link gives null (the app opens
 * normally and says nothing, as the challenge links do).
 */
export function parseFriendLink(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 300) return null;
  const text = input.trim();
  let tail = text;
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const m = /^\/f\/([^/]+)\/?$/.exec(u.pathname);
    if (!m) return null;
    tail = decodeURIComponent(m[1] ?? '');
  } catch {
    if (/[/?#]/.test(text)) return null;
  }
  return parseFriendCode(tail);
}

// ───────── base64url ─────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toB64u(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]!;
  }
  return out;
}

/** Decodes base64url; null for anything that is not canonical base64url (no padding, no other characters). */
export function fromB64u(s: string): Uint8Array | null {
  if (typeof s !== 'string' || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  // The leftover bits of a canonical encoding are zero.
  if (acc !== 0) return null;
  return out.subarray(0, o);
}

/** A random identifier as base64url: 16 bytes give 22 characters (128 bits). */
export const randomToken = (bytes = 16, rb: RandomBytes = cryptoRandomBytes): string => toB64u(rb(bytes));
