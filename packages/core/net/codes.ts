// Room codes and invite links (tech.md 2.10), shared by the client and the Worker.
// Six characters from a 32-letter alphabet without 0, O, 1 and I (32^6, about 1.07 billion codes), so a code read
// aloud or typed from a screen cannot be mistyped into another valid code by those look-alikes.
import type { RoomCode } from '../types/net.ts';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export function isRoomCode(s: unknown): s is RoomCode {
  return typeof s === 'string' && CODE_RE.test(s);
}

/**
 * What a person typed or pasted, as a room code: case and spaces, dashes and dots between characters are ignored
 * ("k7p 2qx", "K7P-2QX"). Returns null when it is not a valid code (look-alikes 0/O/1/I are not guessed).
 */
export function normalizeRoomCode(input: string): RoomCode | null {
  const s = String(input ?? '').normalize('NFKC').toUpperCase().replace(/[\s\-.·_]/g, '');
  return isRoomCode(s) ? s : null;
}

/** A random code from 6 unbiased draws (rejection sampling on bytes, 256 = 8 x 32 so no draw is ever rejected). */
export function randomRoomCode(bytes: (n: number) => Uint8Array = cryptoBytes): RoomCode {
  const b = bytes(ROOM_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[(b[i] ?? 0) % 32];
  return out;
}

function cryptoBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** The invite link for a room: `<origin>/r/<CODE>`. */
export function inviteLink(origin: string, code: RoomCode): string {
  return `${origin.replace(/\/+$/, '')}/r/${code}`;
}

/** The room code in an invite link (`.../r/K7P2QX`, any origin, case-insensitive), or in a bare typed code. */
export function codeFromInvite(text: string): RoomCode | null {
  const s = String(text ?? '').trim();
  const m = /\/r\/([A-Za-z0-9]{6})(?:[/?#]|$)/.exec(s);
  if (m && m[1]) return normalizeRoomCode(m[1]);
  return normalizeRoomCode(s);
}

/** "K7P 2QX": easier to read aloud and to type from a TV screen. */
export function formatRoomCode(code: RoomCode): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
