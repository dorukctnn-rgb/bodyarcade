// core/store: namespaced, versioned, schema-checked storage on top of localStorage (or any StorageLike).
//
// What changed against v1 (site/game/store.js, `LS()` and `SET()`):
// - Every key lives under 'ba2.<namespace>.<key>' as {"v": schemaVersion, "d": data}; v1's flat 'ba_*' keys are
//   only ever read, by legacy.ts, and never modified (the live site keeps working next to v2).
// - A stored value is accepted only if the key's schema parses it (B4). A damaged or foreign value is removed and
//   the fallback is returned; no other key is touched (rule 5 of code-audit 11.4).
// - An older schema version is migrated once and written back; a newer version (a downgrade) is read best-effort
//   and never deleted.
// - Storage that throws (private mode, quota, blocked) never throws into the game: writes that fail are kept in
//   memory for the session, reads fall back, and the problem is reported through onProblem.
// - One date rule (B13): day() is the local calendar date, from the injected clock and optional time zone.
import type { Namespace, Schema, Store } from '../types/index.ts';
import { dayOf } from './date.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Optional: with these clearAll() can remove exactly the keys this store wrote. */
  key?(index: number): string | null;
  readonly length?: number;
}

export type StoreProblem =
  | { kind: 'corrupt'; key: string; detail: string }
  | { kind: 'migration_failed'; key: string; detail: string }
  | { kind: 'write_failed'; key: string; detail: string }
  | { kind: 'read_failed'; key: string; detail: string };

export interface StoreOptions {
  /** Defaults to window.localStorage when it works, else memory. Pass memoryStorage() in tests. */
  storage?: StorageLike | null;
  /** Epoch milliseconds. Defaults to Date.now. */
  now?: () => number;
  /** IANA zone for day(); defaults to the device's own zone. */
  timeZone?: string;
  /** Key prefix, default 'ba2'. */
  prefix?: string;
  onProblem?: (p: StoreProblem) => void;
}

/** A key bound to its schema and fallback once, so callers never repeat them and set() always knows the version. */
export interface Slot<T> {
  readonly key: string;
  get(): T;
  set(v: T): void;
  update(fn: (current: T) => T): T;
  remove(): void;
}

export interface StoreNamespace extends Namespace {
  readonly name: string;
  /** Like Namespace.get; the fallback may also be a factory, called each time it is needed. */
  get<T>(key: string, schema: Schema<T>, fallback: T | (() => T)): T;
  /** Like Namespace.set, with the schema optional: it registers the version this key is written with. */
  set<T>(key: string, v: T, schema?: Schema<T>): void;
  slot<T>(key: string, schema: Schema<T>, fallback: T | (() => T)): Slot<T>;
  has(key: string): boolean;
  keys(): string[];
}

export interface BodyArcadeStore extends Store {
  readonly prefix: string;
  ns(gameId: string): StoreNamespace;
  /** The store's clock (epoch ms). */
  now(): number;
  /** Removes every key this store wrote, in every namespace. Returns how many were removed. */
  clearAll(): number;
  /** The most recent problems, oldest first (kept short; for diagnostics and tests). */
  problems(): readonly StoreProblem[];
}

const NS_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,59}$/;
const MAX_PROBLEMS = 20;

/** localStorage held in a Map, for tests, private windows and server-side rendering. */
export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
  };
}

/** window.localStorage if it exists and accepts a write, else null. Never throws. */
export function browserStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!ls) return null;
    const probe = '__ba2_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

type Envelope = { v?: number; d: unknown };

const describe = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export function createStore(o: StoreOptions = {}): BodyArcadeStore {
  const storage: StorageLike = o.storage ?? browserStorage() ?? memoryStorage();
  const now = o.now ?? ((): number => Date.now());
  const prefix = o.prefix ?? 'ba2';
  const problemLog: StoreProblem[] = [];
  /** Values the storage refused to take this session. They win over whatever the storage holds. */
  const volatile = new Map<string, string>();
  /** Schema version each full key was last read or written with. */
  const versions = new Map<string, number>();
  const known = new Set<string>();

  const report = (p: StoreProblem): void => {
    problemLog.push(p);
    if (problemLog.length > MAX_PROBLEMS) problemLog.shift();
    try { o.onProblem?.(p); } catch { /* a faulty listener must not break storage */ }
  };

  function readRaw(full: string): string | null {
    const held = volatile.get(full);
    if (held !== undefined) return held;
    try {
      return storage.getItem(full);
    } catch (e) {
      report({ kind: 'read_failed', key: full, detail: describe(e) });
      return null;
    }
  }

  function writeRaw(full: string, text: string): void {
    known.add(full);
    try {
      storage.setItem(full, text);
      volatile.delete(full);
    } catch (e) {
      volatile.set(full, text);
      report({ kind: 'write_failed', key: full, detail: describe(e) });
    }
  }

  function removeRaw(full: string): void {
    volatile.delete(full);
    known.delete(full);
    try { storage.removeItem(full); } catch { /* nothing to remove from a storage that throws */ }
  }

  function writeEnvelope(full: string, data: unknown, version: number | undefined): void {
    let text: string;
    try {
      text = JSON.stringify(version === undefined ? { d: data } : { v: version, d: data });
    } catch (e) {
      report({ kind: 'write_failed', key: full, detail: `not serialisable: ${describe(e)}` });
      return;
    }
    writeRaw(full, text);
  }

  function resetCorrupt(full: string, detail: string): void {
    report({ kind: 'corrupt', key: full, detail });
    removeRaw(full);
  }

  function readEnvelope(full: string, text: string): Envelope | null {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { resetCorrupt(full, 'not JSON'); return null; }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !('d' in parsed)) {
      resetCorrupt(full, 'not a stored envelope');
      return null;
    }
    const env = parsed as { v?: unknown; d: unknown };
    if (env.v !== undefined && (typeof env.v !== 'number' || !Number.isInteger(env.v) || env.v < 0)) {
      resetCorrupt(full, 'bad version');
      return null;
    }
    return env.v === undefined ? { d: env.d } : { v: env.v, d: env.d };
  }

  function getValue<T>(full: string, schema: Schema<T>, fallback: T | (() => T)): T {
    const fb = (): T => (typeof fallback === 'function' ? (fallback as () => T)() : structuredClone(fallback));
    versions.set(full, schema.version);
    const text = readRaw(full);
    if (text === null) return fb();
    const env = readEnvelope(full, text);
    if (!env) return fb();

    if (env.v !== undefined && env.v < schema.version) {
      // Older data: migrate once, check the result, write it back in the current format.
      let migrated: unknown = env.d;
      try {
        if (schema.migrate) migrated = schema.migrate(env.d, env.v);
      } catch (e) {
        report({ kind: 'migration_failed', key: full, detail: describe(e) });
        removeRaw(full);
        return fb();
      }
      const parsed = schema.parse(migrated);
      if (parsed === null) {
        report({ kind: 'migration_failed', key: full, detail: `v${env.v} data did not fit v${schema.version}` });
        removeRaw(full);
        return fb();
      }
      writeEnvelope(full, parsed, schema.version);
      return parsed;
    }

    const parsed = schema.parse(env.d);
    if (parsed !== null) return parsed;
    if (env.v !== undefined && env.v > schema.version) {
      // Written by a newer build (the player went back to an older one). Keep it for the newer build.
      report({ kind: 'corrupt', key: full, detail: `v${env.v} data is newer than v${schema.version} and does not fit` });
      return fb();
    }
    resetCorrupt(full, 'did not match its schema');
    return fb();
  }

  function namespace(name: string): StoreNamespace {
    if (!NS_RE.test(name)) throw new RangeError(`invalid storage namespace: ${JSON.stringify(name)}`);
    const fullOf = (key: string): string => {
      if (!KEY_RE.test(key)) throw new RangeError(`invalid storage key: ${JSON.stringify(key)}`);
      return `${prefix}.${name}.${key}`;
    };
    const ns: StoreNamespace = {
      name,
      get: <T>(key: string, schema: Schema<T>, fallback: T | (() => T)): T => getValue(fullOf(key), schema, fallback),
      set: <T>(key: string, v: T, schema?: Schema<T>): void => {
        const full = fullOf(key);
        if (schema) versions.set(full, schema.version);
        writeEnvelope(full, v, versions.get(full));
      },
      remove: (key) => { removeRaw(fullOf(key)); },
      has: (key) => readRaw(fullOf(key)) !== null,
      keys: () => {
        const head = `${prefix}.${name}.`;
        return allKeys().filter((k) => k.startsWith(head)).map((k) => k.slice(head.length));
      },
      slot: <T>(key: string, schema: Schema<T>, fallback: T | (() => T)): Slot<T> => {
        const full = fullOf(key);
        versions.set(full, schema.version);
        const slot: Slot<T> = {
          key,
          get: () => getValue(full, schema, fallback),
          set: (v) => { writeEnvelope(full, v, schema.version); },
          update: (fn) => { const next = fn(slot.get()); slot.set(next); return next; },
          remove: () => { removeRaw(full); },
        };
        return slot;
      },
    };
    return ns;
  }

  function allKeys(): string[] {
    const out = new Set<string>(known);
    for (const k of volatile.keys()) out.add(k);
    try {
      if (typeof storage.key === 'function' && typeof storage.length === 'number') {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(`${prefix}.`)) out.add(k);
        }
      }
    } catch { /* enumeration is best effort */ }
    return [...out].filter((k) => k.startsWith(`${prefix}.`));
  }

  return {
    prefix,
    ns: namespace,
    now,
    day: () => dayOf(now(), o.timeZone),
    clearAll: () => {
      const keys = allKeys();
      for (const k of keys) removeRaw(k);
      return keys.length;
    },
    problems: () => problemLog.slice(),
  };
}
