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
// - Profiles (profiles.ts) stand on withPrefix(): the same storage, clock and problem log under another key prefix, one
//   store per profile. A store may be read-only (no write, no repair, no removal) and may refuse some namespaces or accept
//   only some (the device's own: the entitlements and the profile list). Restrictions only ever grow: a store made from a
//   restricted one is never freer than it.
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
  | { kind: 'read_failed'; key: string; detail: string }
  /** The caller handed over something that is not what the store needs (for example a null run) and it was not stored. */
  | { kind: 'rejected'; key: string; detail: string };

/** What a store may do. Every field only restricts. */
export interface StoreAccess {
  /**
   * Reads only: every write is refused and reported ('rejected'), and reading repairs, migrates and removes nothing. A function
   * is asked at every write, so a store can turn read-only later (a profile whose plan ended) wherever a handle to it is held.
   */
  readOnly?: boolean | (() => boolean);
  /** Only these namespaces can be opened (the device's own: 'entitlements', 'profiles'). */
  allow?: readonly string[];
  /** These namespaces cannot be opened (a profile's store never reaches the device's namespaces). */
  deny?: readonly string[];
}

export interface StoreOptions extends StoreAccess {
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
  /** True when no write goes through now (a look at a record, a profile whose plan ended). */
  readonly readOnly: boolean;
  ns(gameId: string): StoreNamespace;
  /**
   * The same storage, clock, time zone and problem log under another key prefix ('ba2p2': one profile's own store). The
   * restrictions of this store carry over and the ones asked for here are added: read-only stays read-only, a namespace
   * denied here stays denied, an allow list can only shrink.
   */
  withPrefix(prefix: string, access?: StoreAccess): BodyArcadeStore;
  /** Distinct key prefixes in the storage (the part before the first dot) that match, sorted; [] when the storage cannot be listed. */
  scanPrefixes(pattern: RegExp): string[];
  /** How many keys this store holds, in the namespaces it may open. */
  size(): number;
  /** The store's clock (epoch ms). */
  now(): number;
  /** Removes every key this store wrote, in every namespace. Returns how many were removed. */
  clearAll(): number;
  /** The most recent problems, oldest first (kept short; for diagnostics and tests). */
  problems(): readonly StoreProblem[];
  /** Lets modules built on the store (progress, legacy import, entitlements) log a problem next to the store's own. */
  report(p: StoreProblem): void;
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

/** A prefix is plain letters and digits: with no dot, no key of one prefix can ever start with another prefix and a dot. */
const PREFIX_RE = /^[a-z][a-z0-9]{1,19}$/;

/** StoreAccess settled: what one store may do. */
interface Access {
  /** Asked at every write; a function that throws counts as read-only. */
  readOnly: () => boolean;
  /** null: every namespace not denied. */
  allow: ReadonlySet<string> | null;
  deny: ReadonlySet<string>;
}

const accessOf = (a: StoreAccess | undefined): Access => ({
  readOnly: ((): (() => boolean) => {
    const r = a?.readOnly;
    if (typeof r !== 'function') return () => r === true;
    return () => { try { return r() === true; } catch { return true; } };
  })(),
  allow: a?.allow ? new Set(a.allow) : null,
  deny: new Set(a?.deny ?? []),
});

/** The restrictions of a store plus the ones asked for: read-only stays, a deny list only grows, an allow list only shrinks. */
function narrow(parent: Access, more: StoreAccess | undefined): Access {
  const extra = accessOf(more);
  return {
    readOnly: () => parent.readOnly() || extra.readOnly(),
    allow: parent.allow && extra.allow ? new Set([...parent.allow].filter((x) => (extra.allow as ReadonlySet<string>).has(x))) : parent.allow ?? extra.allow,
    deny: new Set([...parent.deny, ...extra.deny]),
  };
}

export function createStore(o: StoreOptions = {}): BodyArcadeStore {
  const storage: StorageLike = o.storage ?? browserStorage() ?? memoryStorage();
  const now = o.now ?? ((): number => Date.now());
  /** One log for a store and every store made from it; the key of a problem says whose it is. */
  const problemLog: StoreProblem[] = [];

  const report = (p: StoreProblem): void => {
    problemLog.push(p);
    if (problemLog.length > MAX_PROBLEMS) problemLog.shift();
    try { o.onProblem?.(p); } catch { /* a faulty listener must not break storage */ }
  };

  const make = (prefix: string, access: Access): BodyArcadeStore => {
    /** Values the storage refused to take this session. They win over whatever the storage holds. */
    const volatile = new Map<string, string>();
    /** Schema version each full key was last read or written with. */
    const versions = new Map<string, number>();
    const known = new Set<string>();

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
      if (access.readOnly()) return;
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
      if (access.readOnly()) return;
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

    /** A write a read-only store does not make is reported, so a caller's mistake shows up instead of vanishing. */
    function refuse(full: string): void {
      report({ kind: 'rejected', key: full, detail: 'read-only store' });
    }

    const permitted = (name: string): boolean => !access.deny.has(name) && (access.allow === null || access.allow.has(name));

    function namespace(name: string): StoreNamespace {
      if (!NS_RE.test(name)) throw new RangeError(`invalid storage namespace: ${JSON.stringify(name)}`);
      if (!permitted(name)) throw new RangeError(`storage namespace not available to this store: ${JSON.stringify(name)}`);
      const fullOf = (key: string): string => {
        if (!KEY_RE.test(key)) throw new RangeError(`invalid storage key: ${JSON.stringify(key)}`);
        return `${prefix}.${name}.${key}`;
      };
      const ns: StoreNamespace = {
        name,
        get: <T>(key: string, schema: Schema<T>, fallback: T | (() => T)): T => getValue(fullOf(key), schema, fallback),
        set: <T>(key: string, v: T, schema?: Schema<T>): void => {
          const full = fullOf(key);
          if (access.readOnly()) { refuse(full); return; }
          if (schema) versions.set(full, schema.version);
          writeEnvelope(full, v, versions.get(full));
        },
        remove: (key) => {
          const full = fullOf(key);
          if (access.readOnly()) { refuse(full); return; }
          removeRaw(full);
        },
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
            set: (v) => {
              if (access.readOnly()) { refuse(full); return; }
              writeEnvelope(full, v, schema.version);
            },
            update: (fn) => {
              const current = slot.get();
              if (access.readOnly()) { refuse(full); return current; }
              const next = fn(current);
              slot.set(next);
              return next;
            },
            remove: () => {
              if (access.readOnly()) { refuse(full); return; }
              removeRaw(full);
            },
          };
          return slot;
        },
      };
      return ns;
    }

    /** The keys this store owns: its prefix, in the namespaces it may open. */
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
      return [...out].filter((k) => k.startsWith(`${prefix}.`) && permitted(k.slice(prefix.length + 1).split('.')[0] ?? ''));
    }

    return {
      prefix,
      get readOnly() { return access.readOnly(); },
      ns: namespace,
      now,
      day: () => dayOf(now(), o.timeZone),
      clearAll: () => {
        if (access.readOnly()) { refuse(`${prefix}.*`); return 0; }
        const keys = allKeys();
        for (const k of keys) removeRaw(k);
        return keys.length;
      },
      withPrefix(next, more) {
        if (typeof next !== 'string' || !PREFIX_RE.test(next)) throw new RangeError(`invalid storage prefix: ${JSON.stringify(next)}`);
        return make(next, narrow(access, more));
      },
      scanPrefixes(pattern) {
        const found = new Set<string>();
        try {
          if (typeof storage.key === 'function' && typeof storage.length === 'number') {
            for (let i = 0; i < storage.length; i++) {
              const k = storage.key(i);
              const dot = k ? k.indexOf('.') : -1;
              if (k && dot > 0) {
                const head = k.slice(0, dot);
                pattern.lastIndex = 0;                      // a pattern with the global flag remembers where it stopped
                if (pattern.test(head)) found.add(head);
              }
            }
          }
        } catch { /* a storage that cannot be listed has nothing to show */ }
        return [...found].sort();
      },
      size: () => allKeys().length,
      problems: () => problemLog.slice(),
      report,
    };
  };

  return make(o.prefix ?? 'ba2', accessOf(o));
}
