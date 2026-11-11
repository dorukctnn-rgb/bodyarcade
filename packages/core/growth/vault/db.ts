// Where the growth vault keeps its sealed records: one IndexedDB database per profile (`ba-growth-<profileId>`; the six
// profiles of a family plan never see each other's photos), or memory (tests, and private windows that refuse IndexedDB).
// The backend stores what it is given; it never sees a picture, a number or a date in the clear: the vault seals every
// record before it reaches here (vault.ts). Only the key record (`meta`/`key`) holds CryptoKey objects and wrapped bytes.

export const STORES = ['meta', 'sessions', 'photos', 'thumbs', 'measures', 'program', 'logs', 'nutrition', 'settings'] as const;
export type StoreName = (typeof STORES)[number];

export interface VaultBackend {
  /** False when the data will be gone when the page closes (memory). */
  readonly persistent: boolean;
  get(store: StoreName, key: string): Promise<unknown>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  keys(store: StoreName): Promise<string[]>;
  /** Deletes every record and the database itself. */
  destroy(): Promise<void>;
}

export class MemoryBackend implements VaultBackend {
  readonly persistent = false;
  private data = new Map<StoreName, Map<string, unknown>>();
  private m(store: StoreName): Map<string, unknown> {
    let s = this.data.get(store);
    if (!s) { s = new Map(); this.data.set(store, s); }
    return s;
  }
  async get(store: StoreName, key: string): Promise<unknown> { return this.m(store).get(key); }
  async put(store: StoreName, key: string, value: unknown): Promise<void> { this.m(store).set(key, value); }
  async delete(store: StoreName, key: string): Promise<void> { this.m(store).delete(key); }
  async keys(store: StoreName): Promise<string[]> { return [...this.m(store).keys()].sort(); }
  async destroy(): Promise<void> { this.data.clear(); }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('vault:idb'));
  });
}

export const dbName = (profileId: string): string => `ba-growth-${profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'me'}`;

export class IdbBackend implements VaultBackend {
  readonly persistent = true;
  private db: Promise<IDBDatabase>;
  private readonly factory: IDBFactory;
  private readonly name: string;
  constructor(factory: IDBFactory, name: string) {
    this.factory = factory; this.name = name;
    this.db = IdbBackend.openDb(factory, name);
    this.db.catch(() => undefined);
  }
  private static openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const r = factory.open(name, 1);
      r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('vault:idb'));
      r.onblocked = () => reject(new Error('vault:idb-blocked'));
    });
  }
  private async os(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db).transaction(store, mode).objectStore(store);
  }
  async get(store: StoreName, key: string): Promise<unknown> { return req((await this.os(store, 'readonly')).get(key)); }
  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    try { await req((await this.os(store, 'readwrite')).put(value, key)); }
    catch (e) { throw new Error((e as { name?: string })?.name === 'QuotaExceededError' ? 'vault:quota' : 'vault:idb'); }
  }
  async delete(store: StoreName, key: string): Promise<void> { await req((await this.os(store, 'readwrite')).delete(key)); }
  async keys(store: StoreName): Promise<string[]> { return ((await req((await this.os(store, 'readonly')).getAllKeys())) as IDBValidKey[]).map(String).sort(); }
  async destroy(): Promise<void> {
    try { (await this.db).close(); } catch { /* not open */ }
    await new Promise<void>((resolve, reject) => {
      const r = this.factory.deleteDatabase(this.name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error ?? new Error('vault:idb'));
      r.onblocked = () => resolve();
    });
    this.db = IdbBackend.openDb(this.factory, this.name);
    this.db.catch(() => undefined);
  }
}

/** IndexedDB when it opens (checked with a read), else memory: `persistent` tells the page to say "closing the tab deletes them". */
export async function openBackend(profileId: string, factory: IDBFactory | undefined = globalThis.indexedDB): Promise<VaultBackend> {
  if (!factory) return new MemoryBackend();
  try {
    const b = new IdbBackend(factory, dbName(profileId));
    await b.keys('meta');
    return b;
  } catch {
    return new MemoryBackend();
  }
}
