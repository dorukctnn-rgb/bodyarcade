// Storage that lasts (SPEC 2.10 "Kalıcılık"): ask the browser to keep this site's data (navigator.storage.persist) on the
// first saved photo, and read how much space the growth data uses. The browser decides; the page shows the answer.

export interface StorageLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

export interface StorageInfo {
  /** true: kept; false: the browser may clear it; null: the browser does not say. */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export async function askPersist(s: StorageLike | undefined): Promise<boolean | null> {
  if (!s?.persist) return null;
  try {
    if (s.persisted && (await s.persisted())) return true;
    return await s.persist();
  } catch {
    return null;
  }
}

export async function storageInfo(s: StorageLike | undefined): Promise<StorageInfo> {
  let persisted: boolean | null = null, usage: number | null = null, quota: number | null = null;
  try { if (s?.persisted) persisted = await s.persisted(); } catch { /* unknown */ }
  try {
    const e = s?.estimate ? await s.estimate() : null;
    usage = typeof e?.usage === 'number' ? e.usage : null;
    quota = typeof e?.quota === 'number' ? e.quota : null;
  } catch { /* unknown */ }
  return { persisted, usage, quota };
}

/** iPhone and iPad Safari clears script-written data of sites unused for 7 days unless the site is installed (SPEC 2.10). */
export const isIosSafari = (ua: string, maxTouchPoints = 0): boolean =>
  /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

/** When to show the "take a backup" card: every 4 weeks or every 10 new photos; every 2 weeks without persistent storage. */
export function backupDue(o: { lastBackupAt: number | null; photosSinceBackup: number; persisted: boolean | null; now: number; firstPhotoAt: number | null }): boolean {
  if (o.firstPhotoAt === null) return false;
  if (o.photosSinceBackup >= 10) return true;
  const days = o.persisted === true ? 28 : 14;
  const since = o.lastBackupAt ?? o.firstPhotoAt;
  return o.now - since >= days * 86_400_000;
}
