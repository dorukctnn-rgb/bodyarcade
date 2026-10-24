// The recovery code of a profile: the one way back onto a new device.
//
// The device key is a non-extractable WebCrypto key, so it cannot be copied to another device or restored after the browser
// cleared its data (Safari on an iPhone deletes a site's storage after a week without a visit). At sign-up the server makes a
// code, shows it once, and keeps only a hash. Typing the friend code and the recovery code on a new device adds that device's
// key to the profile (soc_devices has one row per key), and the code is replaced, so a code that was seen by somebody else is
// good for one use at most.
//
//   POST /api/social/recover       {pub, code: BA-XXXXXX, recovery}  signed with the NEW key   -> {me, recovery}
//   POST /api/social/me/recovery   {}                                signed by a device         -> {recovery}   (a new code)
//
// A wrong guess is counted against the profile (five an hour) and against the address (ten an hour); the answer is the same
// for a friend code nobody has and for a wrong recovery code.
import { formatRecoveryCode, randomRecoveryChars, toB64u } from '../../../core/social/codes.ts';

/** Devices one profile may hold; adding one more removes the oldest (the likeliest to be lost). */
export const MAX_DEVICES = 5;

const enc = new TextEncoder();

/** The stored form: a hash of the profile id and the code (the code alone is 80 bits, the id is a per-profile salt). */
export async function recoveryHash(pid: string, chars: string): Promise<string> {
  return toB64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`rec1|${pid}|${chars}`))));
}

/** A new code for a profile: what to show (BA-style groups of four) and what to store. */
export async function newRecovery(pid: string): Promise<{ shown: string; hash: string }> {
  const chars = randomRecoveryChars();
  return { shown: formatRecoveryCode(chars), hash: await recoveryHash(pid, chars) };
}

/** Compares two hashes without stopping at the first difference. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
