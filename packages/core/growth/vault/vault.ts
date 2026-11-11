// The growth vault (SPEC 2.10): photos, measurements, weight, the program log and nutrition targets, sealed on this device.
// Nothing here talks to a network. The record ids are random and say nothing; every value is sealed with the data key and
// bound to its place (`<store>/<id>` as AES-GCM additional data), so a record moved to another id does not open.
//   state 'open'   : the data key is in memory, records can be read and written.
//   state 'locked' : a PIN guards the key; nothing opens until unlock(pin).
// Forgetting the PIN loses the data: the key is not with us (the page says so, and offers a backup first).
import { deriveKey, newDataKey, newDeviceKey, open, randomBytes, seal, unwrapDataKey, validSecret, wrapDataKey, PBKDF2_ITERATIONS, SALT_BYTES } from './crypto.ts';
import { STORES, type StoreName, type VaultBackend } from './db.ts';

export const VAULT_VERSION = 1;

interface KeyRecordDevice { v: number; mode: 'device'; deviceKey: CryptoKey; wrapped: Uint8Array<ArrayBuffer>; createdAt: number }
interface KeyRecordPin { v: number; mode: 'pin'; salt: Uint8Array<ArrayBuffer>; iter: number; wrapped: Uint8Array<ArrayBuffer>; createdAt: number }
type KeyRecord = KeyRecordDevice | KeyRecordPin;

export type VaultState = 'open' | 'locked';

const enc = new TextEncoder();
const dec = new TextDecoder();
const aad = (store: StoreName, id: string): string => `${store}/${id}`;

export const newId = (): string => [...randomBytes(9)].map((b) => b.toString(16).padStart(2, '0')).join('');

const isBytes = (v: unknown): v is Uint8Array<ArrayBuffer> => v instanceof Uint8Array;
/** Structured clone across realms can hand back an ArrayBuffer view from another global; normalise it. */
const asBytes = (v: unknown): Uint8Array<ArrayBuffer> | null => {
  if (isBytes(v)) return v;
  if (v && typeof v === 'object' && ArrayBuffer.isView(v)) return new Uint8Array((v as ArrayBufferView).buffer.slice(0) as ArrayBuffer);
  return null;
};

export class Vault {
  private key: CryptoKey | null = null;
  private record: KeyRecord | null = null;
  /** Called after lock() or a wipe, so the page can drop what it shows. */
  onLock: (() => void) | null = null;

  readonly backend: VaultBackend;
  private readonly iterations: number;
  private constructor(backend: VaultBackend, iterations: number) { this.backend = backend; this.iterations = iterations; }

  /** Opens (or creates) the vault in a backend. A new vault starts open, guarded by the device key. */
  static async open(backend: VaultBackend, opts: { iterations?: number } = {}): Promise<Vault> {
    const v = new Vault(backend, opts.iterations ?? PBKDF2_ITERATIONS);
    const rec = (await backend.get('meta', 'key')) as KeyRecord | undefined;
    if (rec && (rec.mode === 'device' || rec.mode === 'pin')) {
      v.record = { ...rec, wrapped: asBytes(rec.wrapped) ?? new Uint8Array(), ...(rec.mode === 'pin' ? { salt: asBytes(rec.salt) ?? new Uint8Array() } : {}) } as KeyRecord;
      if (rec.mode === 'device') v.key = await unwrapDataKey(v.record.wrapped, rec.deviceKey);
    } else {
      await v.create();
    }
    return v;
  }

  private async create(): Promise<void> {
    const key = await newDataKey();
    const deviceKey = await newDeviceKey();
    const record: KeyRecordDevice = { v: VAULT_VERSION, mode: 'device', deviceKey, wrapped: await wrapDataKey(key, deviceKey), createdAt: Date.now() };
    await this.backend.put('meta', 'key', record);
    this.record = record; this.key = key;
  }

  get state(): VaultState { return this.key ? 'open' : 'locked'; }
  get hasPin(): boolean { return this.record?.mode === 'pin'; }

  private need(): CryptoKey {
    if (!this.key) throw new Error('vault:locked');
    return this.key;
  }

  /** Puts a PIN (or password) on the vault, or changes it. Needs the vault open. */
  async setPin(pin: string): Promise<void> {
    if (!validSecret(pin)) throw new Error('vault:weak-pin');
    const key = this.need();
    const salt = randomBytes(SALT_BYTES);
    const by = await deriveKey(pin, salt, this.iterations);
    const record: KeyRecordPin = { v: VAULT_VERSION, mode: 'pin', salt, iter: this.iterations, wrapped: await wrapDataKey(key, by), createdAt: this.record?.createdAt ?? Date.now() };
    await this.backend.put('meta', 'key', record);
    this.record = record;
  }

  /** Takes the PIN off: only with the PIN (SPEC 2.10 "Kilidi kaldır yalnız PIN ile"). */
  async removePin(pin: string): Promise<boolean> {
    if (!(await this.unlock(pin))) return false;
    const key = this.need();
    const deviceKey = await newDeviceKey();
    const record: KeyRecordDevice = { v: VAULT_VERSION, mode: 'device', deviceKey, wrapped: await wrapDataKey(key, deviceKey), createdAt: this.record?.createdAt ?? Date.now() };
    await this.backend.put('meta', 'key', record);
    this.record = record;
    return true;
  }

  /** True when the PIN opened the vault. A wrong PIN changes nothing. */
  async unlock(pin: string): Promise<boolean> {
    const r = this.record;
    if (!r) return false;
    if (r.mode === 'device') { this.key ??= await unwrapDataKey(r.wrapped, r.deviceKey); return true; }
    try {
      this.key = await unwrapDataKey(r.wrapped, await deriveKey(pin, r.salt, r.iter));
      return true;
    } catch {
      return false;
    }
  }

  /** Forgets the key (PIN vaults only: a device-key vault opens itself again on the next visit). */
  lock(): void {
    if (this.record?.mode !== 'pin') return;
    this.key = null;
    this.onLock?.();
  }

  async putJson(store: StoreName, id: string, value: unknown): Promise<void> {
    if (store === 'meta') throw new Error('vault:reserved');
    await this.backend.put(store, id, await seal(this.need(), enc.encode(JSON.stringify(value)), aad(store, id)));
  }

  async getJson<T>(store: StoreName, id: string): Promise<T | null> {
    const raw = asBytes(await this.backend.get(store, id));
    if (!raw) return null;
    return JSON.parse(dec.decode(await open(this.need(), raw, aad(store, id)))) as T;
  }

  async putBytes(store: StoreName, id: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (store === 'meta') throw new Error('vault:reserved');
    await this.backend.put(store, id, await seal(this.need(), bytes, aad(store, id)));
  }

  async getBytes(store: StoreName, id: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const raw = asBytes(await this.backend.get(store, id));
    if (!raw) return null;
    return open(this.need(), raw, aad(store, id));
  }

  async list(store: StoreName): Promise<string[]> { return this.backend.keys(store); }

  /** Every JSON record of a store, opened. */
  async all<T>(store: StoreName): Promise<{ id: string; value: T }[]> {
    const out: { id: string; value: T }[] = [];
    for (const id of await this.list(store)) {
      const value = await this.getJson<T>(store, id);
      if (value !== null) out.push({ id, value });
    }
    return out;
  }

  async remove(store: StoreName, id: string): Promise<void> { await this.backend.delete(store, id); }

  /**
   * "Delete all my growth data": every record and the key. Without the key the bytes a browser may still hold on disk
   * cannot be opened (SPEC 2.10). The vault is new and empty afterwards.
   */
  async wipe(): Promise<void> {
    this.key = null; this.record = null;
    await this.backend.destroy();
    this.onLock?.();
    await this.create();
  }

  /** The sealed records as they are stored (for a backup file). Needs the vault open, so a locked vault cannot be copied out. */
  async sealedRecords(): Promise<{ store: StoreName; id: string; bytes: Uint8Array<ArrayBuffer> }[]> {
    this.need();
    const out: { store: StoreName; id: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
    for (const store of STORES) {
      if (store === 'meta') continue;
      for (const id of await this.backend.keys(store)) {
        const b = asBytes(await this.backend.get(store, id));
        if (b) out.push({ store, id, bytes: b });
      }
    }
    return out;
  }

  /** The data key wrapped by a key from the backup password. */
  async wrapForBackup(password: string, salt: Uint8Array<ArrayBuffer>, iterations = this.iterations): Promise<Uint8Array<ArrayBuffer>> {
    if (!validSecret(password)) throw new Error('vault:weak-pin');
    return wrapDataKey(this.need(), await deriveKey(password, salt, iterations));
  }

  /** Replaces this vault's content with a backup's records and key (the key is then wrapped by a new device key). */
  async replaceWith(key: CryptoKey, records: readonly { store: StoreName; id: string; bytes: Uint8Array<ArrayBuffer> }[]): Promise<void> {
    // check every record opens with the key before anything is deleted: a broken backup changes nothing
    for (const r of records) await open(key, r.bytes, aad(r.store, r.id));
    await this.backend.destroy();
    const deviceKey = await newDeviceKey();
    const record: KeyRecordDevice = { v: VAULT_VERSION, mode: 'device', deviceKey, wrapped: await wrapDataKey(key, deviceKey), createdAt: Date.now() };
    await this.backend.put('meta', 'key', record);
    for (const r of records) await this.backend.put(r.store, r.id, r.bytes);
    this.record = record; this.key = key;
  }
}
