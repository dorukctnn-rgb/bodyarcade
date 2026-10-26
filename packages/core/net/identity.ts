// The device identity of live play without an account: a random device id (never shown to anyone: inside a room
// everyone is a seat), the display name and the self-declared age band (BUILD-PLAN: asked once, at first social use).
// It lives in localStorage; every access is guarded because private windows and blocked site data throw, and then
// the identity lives in memory for this page only. Builder SO's signed profile replaces this later and hands the same
// `Identity` to LiveRace, so nothing else changes.
import type { AgeBand } from '../types/net.ts';
import type { Identity } from './api.ts';
import { checkName } from './chat-filter.ts';
import { MAX_BLOCKS } from './validate.ts';

const KEY_IDENTITY = 'ba.live.identity.v1';
const KEY_BLOCKS = 'ba.live.blocks.v1';
const PID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const AGES: readonly AgeBand[] = ['child', 'teen', 'adult'];

/** Where the identity is kept. The default is localStorage with a memory fallback; tests pass their own. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const memory = new Map<string, string>();

export const browserStore: KeyValueStore = {
  get(key) {
    try { const v = globalThis.localStorage?.getItem(key); if (v !== undefined) return v; } catch { /* blocked */ }
    return memory.get(key) ?? null;
  },
  set(key, value) {
    memory.set(key, value);
    try { globalThis.localStorage?.setItem(key, value); } catch { /* blocked or full: the memory copy still serves this page */ }
  },
};

/** A random device id: 24 URL-safe characters from 18 random bytes. */
export function newDeviceId(bytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = bytes(18);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type IdentityProblem = 'name_empty' | 'name_too_long' | 'name_not_allowed' | 'age_missing' | 'device_id';

export type IdentityResult = { ok: true; identity: Identity } | { ok: false; problem: IdentityProblem };

/** The stored identity, or null before the first social use (the UI then asks for a name and an age). */
export function loadIdentity(store: KeyValueStore = browserStore): Identity | null {
  const raw = store.get(KEY_IDENTITY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Identity>;
    if (typeof o.pid === 'string' && PID_RE.test(o.pid) && typeof o.name === 'string' && o.name && AGES.includes(o.age as AgeBand)) {
      return { pid: o.pid, name: o.name, age: o.age as AgeBand };
    }
  } catch { /* damaged: ask again */ }
  return null;
}

/**
 * Validates a name and an age and stores them with this device's id (kept when there is one, made when there is not).
 * The name goes through the same filter the Room applies, so a refusal here is the reason the player can fix.
 */
export function saveIdentity(input: { name: string; age: AgeBand | null | undefined }, store: KeyValueStore = browserStore): IdentityResult {
  const name = checkName(input.name);
  if (!name.ok) return { ok: false, problem: name.reason === 'empty' ? 'name_empty' : name.reason === 'too_long' ? 'name_too_long' : 'name_not_allowed' };
  if (!input.age || !AGES.includes(input.age)) return { ok: false, problem: 'age_missing' };
  const known = loadIdentity(store);
  const pid = known?.pid ?? newDeviceId();
  if (!PID_RE.test(pid)) return { ok: false, problem: 'device_id' };
  const identity: Identity = { pid, name: name.text, age: input.age };
  store.set(KEY_IDENTITY, JSON.stringify(identity));
  return { ok: true, identity };
}

/** Block keys this device holds (opaque, from `blocked` events); sent with every hello so a block survives new rooms. */
export function loadBlocks(store: KeyValueStore = browserStore): string[] {
  try {
    const a = JSON.parse(store.get(KEY_BLOCKS) ?? '[]') as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string').slice(0, MAX_BLOCKS) : [];
  } catch { return []; }
}

export function saveBlocks(keys: readonly string[], store: KeyValueStore = browserStore): void {
  store.set(KEY_BLOCKS, JSON.stringify(keys.slice(0, MAX_BLOCKS)));
}
