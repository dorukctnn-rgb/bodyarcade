// The backup file `.bagelisim` (SPEC 2.10 b): a ZIP with manifest.json and the vault's records exactly as they are sealed,
// plus the data key wrapped by a key from the backup password (PBKDF2 600 000). It opens on this or another device with
// the password. The manifest holds no photo, number or date of the user's data; only counts, the format and the salt.
import { deriveKey, fromB64, PBKDF2_ITERATIONS, randomBytes, SALT_BYTES, toB64, unwrapDataKey } from './crypto.ts';
import { STORES, type StoreName } from './db.ts';
import type { Vault } from './vault.ts';
import { readZip, writeZip } from './zip.ts';

export const BACKUP_FORMAT = 'bagelisim';
export const BACKUP_VERSION = 1;
export const BACKUP_EXT = '.bagelisim';

interface Manifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  kdf: { name: 'PBKDF2-SHA256'; iter: number; salt: string };
  key: string;
  records: { store: StoreName; id: string; file: string }[];
}

export async function makeBackup(vault: Vault, password: string, opts: { iterations?: number; now?: Date } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const iter = opts.iterations ?? PBKDF2_ITERATIONS;
  const salt = randomBytes(SALT_BYTES);
  const key = await vault.wrapForBackup(password, salt, iter);
  const recs = await vault.sealedRecords();
  const manifest: Manifest = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION,
    kdf: { name: 'PBKDF2-SHA256', iter, salt: toB64(salt) },
    key: toB64(key),
    records: recs.map((r, i) => ({ store: r.store, id: r.id, file: `r/${i}.bin` })),
  };
  const te = new TextEncoder();
  return writeZip([
    { name: 'manifest.json', data: te.encode(JSON.stringify(manifest)) as Uint8Array<ArrayBuffer> },
    ...recs.map((r, i) => ({ name: `r/${i}.bin`, data: r.bytes })),
  ], opts.now);
}

/** What a backup file holds before it is restored (shown on the confirm screen). */
export interface BackupPreview { records: number; byStore: Partial<Record<StoreName, number>> }

function parseManifest(entries: ReturnType<typeof readZip>): Manifest {
  const m = entries.find((e) => e.name === 'manifest.json');
  if (!m) throw new Error('backup:not-backup');
  let man: Manifest;
  try { man = JSON.parse(new TextDecoder().decode(m.data)) as Manifest; } catch { throw new Error('backup:not-backup'); }
  if (man.format !== BACKUP_FORMAT || typeof man.key !== 'string' || !Array.isArray(man.records)) throw new Error('backup:not-backup');
  if (man.version > BACKUP_VERSION) throw new Error('backup:newer');
  for (const r of man.records) if (!(STORES as readonly string[]).includes(r.store) || r.store === 'meta') throw new Error('backup:not-backup');
  return man;
}

export function previewBackup(file: Uint8Array): BackupPreview {
  let entries: ReturnType<typeof readZip>;
  try { entries = readZip(file); } catch { throw new Error('backup:damaged'); }
  const man = parseManifest(entries);
  const byStore: Partial<Record<StoreName, number>> = {};
  for (const r of man.records) byStore[r.store] = (byStore[r.store] ?? 0) + 1;
  return { records: man.records.length, byStore };
}

/**
 * Restores a backup into the vault (replacing what it holds). Errors: backup:damaged (bad ZIP or checksum),
 * backup:not-backup, backup:newer, backup:wrong-password. Nothing in the vault changes when it fails.
 */
export async function restoreBackup(vault: Vault, file: Uint8Array, password: string): Promise<BackupPreview> {
  let entries: ReturnType<typeof readZip>;
  try { entries = readZip(file); } catch { throw new Error('backup:damaged'); }
  const man = parseManifest(entries);
  let key: CryptoKey;
  try { key = await unwrapDataKey(fromB64(man.key), await deriveKey(password, fromB64(man.kdf.salt), man.kdf.iter)); }
  catch { throw new Error('backup:wrong-password'); }
  const files = new Map(entries.map((e) => [e.name, e.data]));
  const records = man.records.map((r) => {
    const bytes = files.get(r.file);
    if (!bytes) throw new Error('backup:damaged');
    return { store: r.store, id: r.id, bytes };
  });
  try { await vault.replaceWith(key, records); } catch { throw new Error('backup:damaged'); }
  return previewBackup(file);
}

export const backupFileName = (d: Date): string => `bodyarcade-gelisim-${d.toISOString().slice(0, 10)}${BACKUP_EXT}`;
