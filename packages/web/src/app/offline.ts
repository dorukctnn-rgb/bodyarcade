// "Play without a connection" in the Android app.
//
// What a player needs offline: the app's pages and scripts (the service worker stores them when the app is first opened, release/sw.template.js)
// and the body-tracking engine, the pose model and the WebAssembly that runs it (about 20 MB). The worker stores the engine the first time a round
// loads it, so a phone that has played once already has it. This file lets a player store it BEFORE the first round, for the flight or the cabin
// with no signal, and tells the truth about what is on the phone: saved, not saved, saving, or could not save.
//
// It writes into the same Cache Storage entry the worker reads (POSE_CACHE), under the same addresses, so the two never keep two copies. Nothing
// here is sent anywhere: the files come from bodyarcade.com, the same ones a round would fetch.
import { POSE_CACHE, POSE_OFFLINE_FILES } from '../../../core/pose/assets.ts';

export type OfflineView =
  | { kind: 'checking' }
  | { kind: 'saved'; mb: number }
  | { kind: 'missing'; mb: number }
  | { kind: 'saving'; pct: number }
  | { kind: 'failed'; mb: number };

/** What the work needs from the browser, so a test can hand it a small fake. */
export interface OfflinePorts {
  caches: Pick<CacheStorage, 'open'>;
  fetch: (url: string) => Promise<Response>;
  /** Asks the browser to keep this site's storage when the phone runs low (navigator.storage.persist). Optional; the answer does not change what is said. */
  persist?: () => Promise<boolean>;
}

export const OFFLINE_TOTAL_BYTES = POSE_OFFLINE_FILES.reduce((n, f) => n + f.bytes, 0);
/** "about N MB" in the decimal megabytes a phone shows in its storage settings, rounded up so the sentence never promises less than it takes. */
export const OFFLINE_MB = Math.ceil(OFFLINE_TOTAL_BYTES / 1_000_000);

/** The ports of this browser, or null where there is no Cache Storage (an insecure page, a private mode that blocks it). */
export function browserPorts(win: Pick<Window, 'caches' | 'fetch'> & { navigator?: { storage?: { persist?: () => Promise<boolean> } } }): OfflinePorts | null {
  try {
    if (!win.caches || typeof win.caches.open !== 'function') return null;
  } catch { return null; }
  const storage = win.navigator?.storage;
  return { caches: win.caches, fetch: (url) => win.fetch(url), ...(storage && typeof storage.persist === 'function' ? { persist: () => (storage.persist as () => Promise<boolean>)() } : {}) };
}

const has = async (cache: Cache, url: string): Promise<boolean> => (await cache.match(url, { ignoreVary: true })) !== undefined;

/** Which of the engine's files are not stored yet. */
export async function missingFiles(c: Pick<CacheStorage, 'open'>): Promise<string[]> {
  const cache = await c.open(POSE_CACHE);
  const out: string[] = [];
  for (const f of POSE_OFFLINE_FILES) if (!(await has(cache, f.url))) out.push(f.url);
  return out;
}

/**
 * Stores what is missing, reporting 0..100 as the bytes arrive. Throws when a file cannot be fetched or stored (the caller says so and the
 * player tries again: the files that did arrive stay, the next try fetches only the rest).
 */
export async function saveEngine(p: OfflinePorts, onProgress: (pct: number) => void): Promise<void> {
  const cache = await p.caches.open(POSE_CACHE);
  const have = new Set<string>();
  for (const f of POSE_OFFLINE_FILES) if (await has(cache, f.url)) have.add(f.url);
  let done = POSE_OFFLINE_FILES.filter((f) => have.has(f.url)).reduce((n, f) => n + f.bytes, 0);
  const report = (extra: number): void => onProgress(Math.min(99, Math.floor(((done + extra) / OFFLINE_TOTAL_BYTES) * 100)));
  report(0);
  for (const f of POSE_OFFLINE_FILES) {
    if (have.has(f.url)) continue;
    const res = await p.fetch(f.url);
    // A 404 page or an error is not the file: storing it would make the app believe it has the engine.
    if (!res.ok || res.status !== 200) throw new Error(`HTTP ${res.status} for ${f.url}`);
    const copy = res.clone();
    const stored = cache.put(f.url, copy);
    let loaded = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        loaded += value.length;
        report(Math.min(loaded, f.bytes));
      }
    } else {
      loaded = (await res.arrayBuffer()).byteLength;
    }
    await stored;
    if (loaded === 0) { await cache.delete(f.url); throw new Error(`empty answer for ${f.url}`); }
    done += f.bytes;
  }
  if ((await missingFiles(p.caches)).length > 0) throw new Error('the files did not stay in the cache');
  // What was saved is meant to stay: ask the browser not to clear it when the phone runs low on space (it may say no, and that is its right).
  try { await p.persist?.(); } catch { /* the browser decides */ }
  onProgress(100);
}

export interface OfflineHost {
  /** The settings page is drawn again (a change of state). */
  redraw(): void;
  /** The percentage of a running save, written into the page without drawing it again. */
  progress(pct: number): void;
  /** Said to assistive technology. */
  announce(kind: 'saved' | 'failed'): void;
}

/** The state of the engine on this phone and the one action that changes it. Null ports (no Cache Storage) mean the row is not drawn. */
export class OfflineController {
  private view: OfflineView = { kind: 'checking' };
  private saving = false;
  private disposed = false;
  private readonly ports: OfflinePorts | null;
  private readonly host: OfflineHost;

  constructor(ports: OfflinePorts | null, host: OfflineHost) {
    this.ports = ports;
    this.host = host;
  }

  /** What the settings page draws: null when this browser cannot keep files, so the page does not offer what it cannot do. */
  get(): OfflineView | null { return this.ports ? this.view : null; }

  /** Looks at the cache again (on starting, and each time the settings page opens: the worker may have stored the engine since). */
  async refresh(): Promise<void> {
    if (!this.ports || this.saving) return;
    let next: OfflineView;
    try {
      next = (await missingFiles(this.ports.caches)).length === 0 ? { kind: 'saved', mb: OFFLINE_MB } : { kind: 'missing', mb: OFFLINE_MB };
    } catch {
      next = { kind: 'missing', mb: OFFLINE_MB };
    }
    // A save that failed stays "failed" (with its button) until it is tried again or the files turn up: drawing the page again must not wipe the message.
    if (next.kind === 'missing' && this.view.kind === 'failed') return;
    this.set(next);
  }

  /** The buttons of the page. */
  action(name: string): boolean {
    if (name !== 'offline-save') return false;
    void this.save();
    return true;
  }

  private set(next: OfflineView): void {
    if (this.disposed) return;
    const same = this.view.kind === next.kind && JSON.stringify(this.view) === JSON.stringify(next);
    this.view = next;
    if (!same) this.host.redraw();
  }

  async save(): Promise<void> {
    if (!this.ports || this.saving) return;
    this.saving = true;
    this.set({ kind: 'saving', pct: 0 });
    let last = -1;
    try {
      await saveEngine(this.ports, (pct) => {
        // The view keeps the latest number (a redraw for another reason shows it), the page is patched in place.
        this.view = { kind: 'saving', pct };
        if (pct !== last) { last = pct; this.host.progress(pct); }
      });
      this.saving = false;
      this.set({ kind: 'saved', mb: OFFLINE_MB });
      this.host.announce('saved');
    } catch (e) {
      console.warn('offline save failed', e);
      this.saving = false;
      this.set({ kind: 'failed', mb: OFFLINE_MB });
      this.host.announce('failed');
    }
  }

  dispose(): void { this.disposed = true; }
}
