// Where the device key of the passwordless profile lives in the browser. The private key is a non-extractable WebCrypto
// key, so it is stored as the CryptoKey object itself (structured clone) in IndexedDB: not even a script on the page can
// read its bytes, only ask it to sign. Without IndexedDB (some private windows) the key lives in memory and the profile
// is gone when the page closes: `persistent` tells the interface to say so.
import type { DeviceKeys } from './sign.ts';
import type { MyProfile } from './types.ts';

/** What the device keeps between visits. `me` is the last profile the server sent (shown at once, refreshed on start). */
export interface StoredIdentity {
  keys: DeviceKeys;
  /** True once the server has accepted this key (register answered). A key without a profile is reused for the next sign up. */
  registered: boolean;
  me?: MyProfile;
}

export interface KeyStore {
  /** False when the identity will not survive closing the page. */
  readonly persistent: boolean;
  load(): Promise<StoredIdentity | null>;
  save(identity: StoredIdentity): Promise<void>;
  clear(): Promise<void>;
}

/** In memory: tests, and the fallback when IndexedDB is not available. */
export class MemoryKeyStore implements KeyStore {
  readonly persistent = false;
  private value: StoredIdentity | null = null;
  async load(): Promise<StoredIdentity | null> { return this.value; }
  async save(identity: StoredIdentity): Promise<void> { this.value = identity; }
  async clear(): Promise<void> { this.value = null; }
}

const DB_NAME = 'bodyarcade-social';
const STORE = 'device';
const KEY = 'identity';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('indexeddb'));
  });
}

/** IndexedDB, one record. */
export class IdbKeyStore implements KeyStore {
  readonly persistent = true;
  private readonly open: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB, name = DB_NAME) {
    this.open = new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb'));
      req.onblocked = () => reject(new Error('indexeddb blocked'));
    });
    // A failed open is reported by the first call, not as an unhandled rejection here.
    this.open.catch(() => undefined);
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open).transaction(STORE, mode).objectStore(STORE);
  }

  async load(): Promise<StoredIdentity | null> {
    const v = await request((await this.store('readonly')).get(KEY));
    const rec = v as Partial<StoredIdentity> | undefined;
    if (!rec || !rec.keys || typeof rec.keys.kid !== 'string' || typeof rec.keys.publicRaw !== 'string' || !rec.keys.privateKey) return null;
    return { keys: rec.keys, registered: rec.registered === true, ...(rec.me ? { me: rec.me } : {}) };
  }

  async save(identity: StoredIdentity): Promise<void> {
    await request((await this.store('readwrite')).put(identity, KEY));
  }

  async clear(): Promise<void> {
    await request((await this.store('readwrite')).delete(KEY));
  }
}

/** IndexedDB when it works (checked by opening it), else memory. */
export async function openKeyStore(): Promise<KeyStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryKeyStore();
    const store = new IdbKeyStore();
    await store.load();
    return store;
  } catch {
    return new MemoryKeyStore();
  }
}
