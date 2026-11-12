// A guest of duel links (sprint arm E): someone who opened a friend's duel link, or made one, without a profile. They answer the age
// question (under 16 has no online identity: the answer is remembered and nothing is sent), agree to the terms, and play under a
// generated name (never a typed one: nobody checks a guest's words). What is kept on this device is a random device id, that name and
// the age band, so a reload or the next duel link is the same guest. Nothing of it is sent anywhere but to the room the guest opens.
import type { Identity } from '../../../core/net/api.ts';
import type { AgeBand } from '../../../core/social/types.ts';

/** The storage a guest lives in (a namespace of the shell's store). */
export interface GuestSlot {
  load(): GuestRecord | null;
  save(r: GuestRecord): void;
}

export interface GuestRecord { pid: string; name: string; age: 'teen' | 'adult' }

const PID_RE = /^g_[A-Za-z0-9_-]{16,40}$/;
const NAME_RE = /^[\p{L}\p{N} ]{2,24}$/u;

/** A stored guest, checked: anything that is not one is no guest. */
export function parseGuest(raw: unknown): GuestRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o['pid'] !== 'string' || !PID_RE.test(o['pid'])) return null;
  if (typeof o['name'] !== 'string' || !NAME_RE.test(o['name'])) return null;
  if (o['age'] !== 'teen' && o['age'] !== 'adult') return null;
  return { pid: o['pid'], name: o['name'], age: o['age'] };
}

/** A random device id for a guest: "g_" and 22 URL-safe characters (the Worker takes 8 to 64). */
export function guestPid(bytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return `g_${[...bytes(22)].map((b) => A[b & 63]).join('')}`;
}

export interface Guests {
  /** The guest of this device, or null. */
  identity(): Identity | null;
  /** Keeps this device's guest (a new id the first time, the same id after). */
  become(age: Extract<AgeBand, 'teen' | 'adult'>, name: string): Identity;
}

export function guests(slot: GuestSlot, makePid: () => string = guestPid): Guests {
  return {
    identity() {
      const r = slot.load();
      return r ? { pid: r.pid, name: r.name, age: r.age } : null;
    },
    become(age, name) {
      const pid = slot.load()?.pid ?? makePid();
      const r: GuestRecord = { pid, name, age };
      slot.save(r);
      return { pid, name, age };
    },
  };
}
