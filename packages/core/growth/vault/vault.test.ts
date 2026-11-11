// G1: the vault in Node (WebCrypto is the same API as in browsers; IndexedDB itself runs in the browser spec,
// tests/e2e/growth-vault.spec.ts). The PIN tests use few PBKDF2 iterations to stay fast; the default is checked separately.
import { describe, expect, it } from 'vitest';
import { backupFileName, makeBackup, previewBackup, restoreBackup } from './backup.ts';
import { deriveKey, open, PBKDF2_ITERATIONS, randomBytes, seal, newDataKey, validSecret } from './crypto.ts';
import { MemoryBackend, dbName, openBackend } from './db.ts';
import { askPersist, backupDue, isIosSafari, storageInfo } from './persist.ts';
import { Vault, newId } from './vault.ts';
import { crc32, readZip, writeZip } from './zip.ts';

const FAST = { iterations: 1000 };
const bytes = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

describe('crypto', () => {
  it('uses the OWASP iteration count by default', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });
  it('seals and opens; a record moved to another place does not open', async () => {
    const k = await newDataKey();
    const s = await seal(k, bytes('waist 82'), 'measures/a');
    expect(new TextDecoder().decode(await open(k, s, 'measures/a'))).toBe('waist 82');
    await expect(open(k, s, 'measures/b')).rejects.toThrow('vault:corrupt');
    const bad = s.slice(); bad[20] = (bad[20]! ^ 1);
    await expect(open(k, bad, 'measures/a')).rejects.toThrow('vault:corrupt');
  });
  it('a fresh IV every time: the same value seals to different bytes', async () => {
    const k = await newDataKey();
    const a = await seal(k, bytes('x')), b = await seal(k, bytes('x'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
  it('derived keys cannot be exported', async () => {
    const k = await deriveKey('123456', randomBytes(16), 1000);
    expect(k.extractable).toBe(false);
  });
  it('PIN rules', () => {
    expect(validSecret('12345')).toBe(false);
    expect(validSecret('123456')).toBe(true);
  });
});

describe('vault', () => {
  it('a new vault is open; JSON and bytes round trip; nothing is stored in the clear', async () => {
    const be = new MemoryBackend();
    const v = await Vault.open(be, FAST);
    expect(v.state).toBe('open');
    await v.putJson('measures', 'm1', { waist: 82.5, at: '2026-11-11' });
    await v.putBytes('photos', 'p1', bytes('JPEGDATA'));
    expect(await v.getJson('measures', 'm1')).toEqual({ waist: 82.5, at: '2026-11-11' });
    expect(new TextDecoder().decode((await v.getBytes('photos', 'p1'))!)).toBe('JPEGDATA');
    const raw = (await be.get('measures', 'm1')) as Uint8Array;
    expect(Buffer.from(raw).toString('latin1')).not.toContain('82.5');
    expect(Buffer.from((await be.get('photos', 'p1')) as Uint8Array).toString('latin1')).not.toContain('JPEG');
  });

  it('reopens with the device key (no PIN) and keeps the records', async () => {
    const be = new MemoryBackend();
    const v = await Vault.open(be, FAST);
    await v.putJson('settings', 's', { hide: true });
    const again = await Vault.open(be, FAST);
    expect(again.state).toBe('open');
    expect(await again.getJson('settings', 's')).toEqual({ hide: true });
  });

  it('PIN: locked after reopening, a wrong PIN does not open, the right one does; removing needs the PIN', async () => {
    const be = new MemoryBackend();
    const v = await Vault.open(be, FAST);
    await v.putJson('measures', 'm', { hips: 98 });
    await v.setPin('482916');
    const again = await Vault.open(be, FAST);
    expect(again.state).toBe('locked');
    expect(again.hasPin).toBe(true);
    await expect(again.getJson('measures', 'm')).rejects.toThrow('vault:locked');
    expect(await again.unlock('000000')).toBe(false);
    expect(again.state).toBe('locked');
    expect(await again.unlock('482916')).toBe(true);
    expect(await again.getJson('measures', 'm')).toEqual({ hips: 98 });
    let locked = 0; again.onLock = () => { locked++; };
    again.lock();
    expect(again.state).toBe('locked');
    expect(locked).toBe(1);
    expect(await again.removePin('111111')).toBe(false);
    expect(await again.removePin('482916')).toBe(true);
    const third = await Vault.open(be, FAST);
    expect(third.state).toBe('open');
    expect(third.hasPin).toBe(false);
  });

  it('rejects a weak PIN and writes to the key store', async () => {
    const v = await Vault.open(new MemoryBackend(), FAST);
    await expect(v.setPin('12')).rejects.toThrow('vault:weak-pin');
    await expect(v.putJson('meta', 'x', 1)).rejects.toThrow('vault:reserved');
  });

  it('wipe deletes every record and the key; the old bytes no longer open', async () => {
    const be = new MemoryBackend();
    const v = await Vault.open(be, FAST);
    await v.putJson('measures', 'm', { waist: 80 });
    const old = (await be.get('measures', 'm')) as Uint8Array<ArrayBuffer>;
    await v.wipe();
    expect(await v.list('measures')).toEqual([]);
    expect(v.state).toBe('open');
    await be.put('measures', 'm', old);
    await expect(v.getJson('measures', 'm')).rejects.toThrow('vault:corrupt');
  });

  it('ids are random and say nothing', () => {
    const a = newId(), b = newId();
    expect(a).toMatch(/^[0-9a-f]{18}$/);
    expect(a).not.toBe(b);
  });

  it('db name is per profile and safe', () => {
    expect(dbName('kid 2/x')).toBe('ba-growth-kid_2_x');
    expect(dbName('')).toBe('ba-growth-me');
  });

  it('without IndexedDB the backend is memory and says so', async () => {
    const be = await openBackend('me', undefined);
    expect(be.persistent).toBe(false);
  });
});

describe('zip', () => {
  it('round trips and checks the checksum', () => {
    const z = writeZip([{ name: 'a.txt', data: bytes('hello') }, { name: 'r/0.bin', data: randomBytes(300) }]);
    const back = readZip(z);
    expect(back.map((e) => e.name)).toEqual(['a.txt', 'r/0.bin']);
    expect(new TextDecoder().decode(back[0]!.data)).toBe('hello');
    // a byte of the first entry's data (after its 30-byte header and 5-byte name)
    const bad = z.slice(); bad[36] = bad[36]! ^ 0xff;
    expect(() => readZip(bad)).toThrow('zip:checksum');
    expect(() => readZip(bytes('not a zip at all, sorry about that'))).toThrow('zip:not-zip');
  });
  it('crc32 of a known string', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });
});

describe('backup', () => {
  it('backs up and restores on another device with the password; the file holds no clear data', async () => {
    const a = await Vault.open(new MemoryBackend(), FAST);
    await a.putJson('measures', 'm1', { waist: 79.5 });
    await a.putBytes('photos', 'p1', bytes('JPEG-FRONT'));
    await a.setPin('246810');
    const file = await makeBackup(a, 'backup-pass', FAST);
    expect(Buffer.from(file).toString('latin1')).not.toContain('79.5');
    expect(Buffer.from(file).toString('latin1')).not.toContain('JPEG-FRONT');
    expect(previewBackup(file)).toEqual({ records: 2, byStore: { photos: 1, measures: 1 } });
    const b = await Vault.open(new MemoryBackend(), FAST);
    await b.putJson('measures', 'other', { waist: 1 });
    await expect(restoreBackup(b, file, 'wrong-pass')).rejects.toThrow('backup:wrong-password');
    expect(await b.getJson('measures', 'other')).toEqual({ waist: 1 });
    await restoreBackup(b, file, 'backup-pass');
    expect(await b.getJson('measures', 'm1')).toEqual({ waist: 79.5 });
    expect(await b.getJson('measures', 'other')).toBeNull();
    expect(new TextDecoder().decode((await b.getBytes('photos', 'p1'))!)).toBe('JPEG-FRONT');
    expect(b.hasPin).toBe(false);
  });

  it('a damaged backup changes nothing', async () => {
    const a = await Vault.open(new MemoryBackend(), FAST);
    await a.putJson('logs', 'l', { reps: 10 });
    const file = await makeBackup(a, 'backup-pass', FAST);
    const mid = Math.floor(file.length / 2);
    const bad = file.slice(); bad[mid] = bad[mid]! ^ 0xff;
    const b = await Vault.open(new MemoryBackend(), FAST);
    await b.putJson('logs', 'keep', { reps: 3 });
    await expect(restoreBackup(b, bad, 'backup-pass')).rejects.toThrow(/backup:(damaged|not-backup)/);
    await expect(restoreBackup(b, bytes('junk'), 'backup-pass')).rejects.toThrow('backup:damaged');
    expect(await b.getJson('logs', 'keep')).toEqual({ reps: 3 });
  });

  it('a locked vault cannot be copied out', async () => {
    const be = new MemoryBackend();
    const a = await Vault.open(be, FAST);
    await a.setPin('135790');
    const locked = await Vault.open(be, FAST);
    await expect(makeBackup(locked, 'backup-pass', FAST)).rejects.toThrow('vault:locked');
  });

  it('file name', () => {
    expect(backupFileName(new Date('2026-11-11T10:00:00Z'))).toBe('bodyarcade-gelisim-2026-11-11.bagelisim');
  });
});

describe('persistence', () => {
  it('asks once; answers what the browser says', async () => {
    let asked = 0;
    expect(await askPersist({ persisted: async () => false, persist: async () => { asked++; return true; } })).toBe(true);
    expect(asked).toBe(1);
    expect(await askPersist({ persisted: async () => true, persist: async () => { asked++; return true; } })).toBe(true);
    expect(asked).toBe(1);
    expect(await askPersist(undefined)).toBeNull();
    expect(await storageInfo({ estimate: async () => ({ usage: 10, quota: 100 }) })).toEqual({ persisted: null, usage: 10, quota: 100 });
  });
  it('the backup card', () => {
    const day = 86_400_000;
    expect(backupDue({ lastBackupAt: null, photosSinceBackup: 0, persisted: null, now: 0, firstPhotoAt: null })).toBe(false);
    expect(backupDue({ lastBackupAt: null, photosSinceBackup: 10, persisted: true, now: 0, firstPhotoAt: 0 })).toBe(true);
    expect(backupDue({ lastBackupAt: 0, photosSinceBackup: 2, persisted: true, now: 20 * day, firstPhotoAt: 0 })).toBe(false);
    expect(backupDue({ lastBackupAt: 0, photosSinceBackup: 2, persisted: false, now: 20 * day, firstPhotoAt: 0 })).toBe(true);
  });
  it('iOS detection (iPadOS reports a Mac)', () => {
    expect(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIosSafari('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });
});
