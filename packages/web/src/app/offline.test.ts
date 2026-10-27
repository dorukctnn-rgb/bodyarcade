// Offline play: what is saved on the phone is told truthfully, saving fills the cache the service worker reads, and a failed save is
// said so and leaves the files that did arrive. Run against a small fake Cache Storage and a fake network.
import { describe, expect, it, vi } from 'vitest';
import { POSE_CACHE, POSE_OFFLINE_FILES } from '../../../core/pose/assets.ts';
import { OFFLINE_MB, OFFLINE_TOTAL_BYTES, OfflineController, browserPorts, missingFiles, saveEngine, type OfflinePorts, type OfflineView } from './offline.ts';

const ORIGIN = 'https://bodyarcade.com';

class FakeCache {
  readonly map = new Map<string, Response>();
  async put(req: string | { url: string }, res: Response): Promise<void> {
    // like the real thing, the whole body is read before put answers
    const body = await res.arrayBuffer();
    this.map.set(new URL(typeof req === 'string' ? req : req.url, ORIGIN).href, new Response(body, { status: res.status, headers: res.headers }));
  }
  async match(req: string | { url: string }): Promise<Response | undefined> { return this.map.get(new URL(typeof req === 'string' ? req : req.url, ORIGIN).href)?.clone(); }
  async delete(req: string): Promise<boolean> { return this.map.delete(new URL(req, ORIGIN).href); }
}

function fakes(net: (url: string) => Promise<Response> = async () => new Response(new Uint8Array(1000), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })) {
  const stores = new Map<string, FakeCache>();
  const opened: string[] = [];
  const fetched: string[] = [];
  const ports: OfflinePorts = {
    caches: { open: async (n: string) => { opened.push(n); if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n) as unknown as Cache; } },
    fetch: async (url: string) => { fetched.push(url); return net(url); },
  };
  const cache = (): FakeCache => { if (!stores.has(POSE_CACHE)) stores.set(POSE_CACHE, new FakeCache()); return stores.get(POSE_CACHE) as FakeCache; };
  return { ports, stores, opened, fetched, cache };
}

describe('what saving stores', () => {
  it('is the model and the WASM module build, in the cache the service worker reads, at the addresses a round loads', () => {
    expect(POSE_OFFLINE_FILES.map((f) => f.url)).toEqual([
      '/vendor/mediapipe/models/pose_landmarker_lite.f16.v1.task',
      '/vendor/mediapipe/1.1.1/wasm/vision_wasm_module_internal.js',
      '/vendor/mediapipe/1.1.1/wasm/vision_wasm_module_internal.wasm',
    ]);
    expect(POSE_CACHE).toBe('ba-lib-mediapipe-1.1.1');
  });
  it('the sentence says about 20 MB: 19.6 MB in decimal megabytes, rounded up', () => {
    expect(OFFLINE_TOTAL_BYTES).toBe(5_777_746 + 334_166 + 13_519_940);
    expect(OFFLINE_MB).toBe(20);
  });
});

describe('missingFiles', () => {
  it('lists every file when nothing is stored, and none when all are', async () => {
    const f = fakes();
    expect(await missingFiles(f.ports.caches)).toEqual(POSE_OFFLINE_FILES.map((x) => x.url));
    for (const x of POSE_OFFLINE_FILES) await f.cache().put(x.url, new Response('x'));
    expect(await missingFiles(f.ports.caches)).toEqual([]);
  });
  it('a stored model without the WASM is still missing the WASM', async () => {
    const f = fakes();
    await f.cache().put(POSE_OFFLINE_FILES[0]!.url, new Response('x'));
    expect(await missingFiles(f.ports.caches)).toEqual(POSE_OFFLINE_FILES.slice(1).map((x) => x.url));
  });
});

describe('saveEngine', () => {
  it('fetches the missing files, stores them in the library cache, and reports 0 to 100 in order', async () => {
    const f = fakes();
    const seen: number[] = [];
    await saveEngine(f.ports, (p) => seen.push(p));
    expect(f.fetched).toEqual(POSE_OFFLINE_FILES.map((x) => x.url));
    expect(f.opened.every((n) => n === POSE_CACHE)).toBe(true);
    expect(await missingFiles(f.ports.caches)).toEqual([]);
    expect(seen.at(-1)).toBe(100);
    expect(seen.every((p, i) => i === 0 || p >= (seen[i - 1] as number))).toBe(true);
    expect(Math.max(...seen.slice(0, -1))).toBeLessThanOrEqual(99);
  });

  it('keeps the content type, so the browser can compile the WASM as it arrives', async () => {
    const f = fakes(async (url) => new Response(new Uint8Array(10), { status: 200, headers: { 'Content-Type': url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' } }));
    await saveEngine(f.ports, () => undefined);
    const wasm = await f.cache().match('/vendor/mediapipe/1.1.1/wasm/vision_wasm_module_internal.wasm');
    expect(wasm?.headers.get('Content-Type')).toBe('application/wasm');
  });

  it('fetches only what is missing: files the worker already stored are not fetched again', async () => {
    const f = fakes();
    await f.cache().put(POSE_OFFLINE_FILES[0]!.url, new Response('model'));
    await saveEngine(f.ports, () => undefined);
    expect(f.fetched).toEqual(POSE_OFFLINE_FILES.slice(1).map((x) => x.url));
    // and the stored model was not replaced
    expect(await (await f.cache().match(POSE_OFFLINE_FILES[0]!.url))?.text()).toBe('model');
  });

  it('a 404 page or a server error is never stored as the file', async () => {
    for (const status of [404, 500, 503]) {
      const f = fakes(async () => new Response('<html>nope</html>', { status }));
      await expect(saveEngine(f.ports, () => undefined)).rejects.toThrow(`HTTP ${status}`);
      expect(f.cache().map.size).toBe(0);
    }
  });

  it('an answer that is a redirect or a partial answer is not stored either', async () => {
    const f = fakes(async () => new Response('part', { status: 206 }));
    await expect(saveEngine(f.ports, () => undefined)).rejects.toThrow('HTTP 206');
    expect(f.cache().map.size).toBe(0);
  });

  it('an empty answer is refused and removed', async () => {
    const f = fakes(async () => new Response(new Uint8Array(0), { status: 200 }));
    await expect(saveEngine(f.ports, () => undefined)).rejects.toThrow('empty');
    expect(f.cache().map.size).toBe(0);
  });

  it('a network that fails halfway leaves the files that came, and the next try fetches only the rest', async () => {
    let calls = 0;
    const f = fakes(async () => { calls += 1; if (calls === 2) throw new TypeError('Failed to fetch'); return new Response(new Uint8Array(100), { status: 200 }); });
    await expect(saveEngine(f.ports, () => undefined)).rejects.toThrow('Failed to fetch');
    expect(await missingFiles(f.ports.caches)).toEqual(POSE_OFFLINE_FILES.slice(1).map((x) => x.url));
    f.fetched.length = 0;
    await saveEngine(f.ports, () => undefined);
    expect(f.fetched).toEqual(POSE_OFFLINE_FILES.slice(1).map((x) => x.url));
    expect(await missingFiles(f.ports.caches)).toEqual([]);
  });
});

describe('saveEngine and persistent storage', () => {
  it('asks the browser to keep the files once they are all saved, and a refusal or an error changes nothing', async () => {
    for (const persist of [vi.fn(async () => true), vi.fn(async () => false), vi.fn(async () => { throw new Error('no'); })]) {
      const f = fakes();
      await saveEngine({ ...f.ports, persist }, () => undefined);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(await missingFiles(f.ports.caches)).toEqual([]);
    }
  });
  it('does not ask when the save failed', async () => {
    const persist = vi.fn(async () => true);
    const f = fakes(async () => new Response('x', { status: 500 }));
    await expect(saveEngine({ ...f.ports, persist }, () => undefined)).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  });
  it('browserPorts hands persist on only where the browser has it', () => {
    const base = { caches: { open: async () => ({}) as Cache } as unknown as CacheStorage, fetch: vi.fn() as unknown as typeof window.fetch };
    expect(browserPorts({ ...base, navigator: { storage: { persist: async () => true } } })?.persist).toBeTypeOf('function');
    expect(browserPorts({ ...base, navigator: {} })?.persist).toBeUndefined();
    expect(browserPorts(base)?.persist).toBeUndefined();
  });
});

describe('browserPorts', () => {
  it('is null without Cache Storage (an insecure page, blocked storage) so the row is not drawn', () => {
    expect(browserPorts({ caches: undefined as unknown as CacheStorage, fetch: vi.fn() })).toBeNull();
    const blocked = { get caches(): CacheStorage { throw new DOMException('denied', 'SecurityError'); }, fetch: vi.fn() };
    expect(browserPorts(blocked as unknown as Pick<Window, 'caches' | 'fetch'>)).toBeNull();
  });
  it('wraps fetch and the caches of a browser that has them', async () => {
    const fetch = vi.fn(async () => new Response('x'));
    const ports = browserPorts({ caches: { open: async () => ({}) as Cache } as unknown as CacheStorage, fetch: fetch as unknown as typeof window.fetch });
    expect(ports).not.toBeNull();
    await ports?.fetch('/a');
    expect(fetch).toHaveBeenCalledWith('/a');
  });
});

describe('OfflineController', () => {
  const host = () => ({ redraw: vi.fn(), progress: vi.fn(), announce: vi.fn() });

  it('without ports says nothing (the page has no row) and does nothing', async () => {
    const h = host();
    const c = new OfflineController(null, h);
    expect(c.get()).toBeNull();
    await c.refresh();
    expect(c.action('offline-save')).toBe(true);
    expect(h.redraw).not.toHaveBeenCalled();
  });

  it('starts as checking, then says missing, or saved when the worker already stored the engine', async () => {
    const f = fakes();
    const h = host();
    const c = new OfflineController(f.ports, h);
    expect(c.get()).toEqual({ kind: 'checking' });
    await c.refresh();
    expect(c.get()).toEqual({ kind: 'missing', mb: OFFLINE_MB });
    expect(h.redraw).toHaveBeenCalledTimes(1);
    for (const x of POSE_OFFLINE_FILES) await f.cache().put(x.url, new Response('x'));
    await c.refresh();
    expect(c.get()).toEqual({ kind: 'saved', mb: OFFLINE_MB });
    expect(h.redraw).toHaveBeenCalledTimes(2);
    // nothing changed: nothing is drawn again
    await c.refresh();
    expect(h.redraw).toHaveBeenCalledTimes(2);
  });

  it('ignores an action that is not its own', () => {
    expect(new OfflineController(fakes().ports, host()).action('mode')).toBe(false);
  });

  it('saving goes checking -> saving -> saved, patches the percent in place and announces the end', async () => {
    const f = fakes();
    const h = host();
    const c = new OfflineController(f.ports, h);
    const kinds: OfflineView['kind'][] = [];
    h.redraw.mockImplementation(() => { kinds.push(c.get()?.kind as OfflineView['kind']); });
    await c.refresh();
    expect(c.action('offline-save')).toBe(true);
    await vi.waitFor(() => expect(c.get()?.kind).toBe('saved'));
    expect(kinds).toEqual(['missing', 'saving', 'saved']);
    expect(h.progress).toHaveBeenCalled();
    expect(h.progress.mock.calls.at(-1)?.[0]).toBe(100);
    expect(h.announce).toHaveBeenCalledWith('saved');
    expect(await missingFiles(f.ports.caches)).toEqual([]);
  });

  it('a second press while saving does nothing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakes(async () => { await gate; return new Response(new Uint8Array(10), { status: 200 }); });
    const c = new OfflineController(f.ports, host());
    c.action('offline-save');
    await vi.waitFor(() => expect(c.get()?.kind).toBe('saving'));
    await vi.waitFor(() => expect(f.fetched).toHaveLength(1));
    c.action('offline-save');
    await new Promise((r) => setTimeout(r, 20));
    expect(f.fetched).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(c.get()?.kind).toBe('saved'));
  });

  it('a failure says failed, announces it, and the next press tries again', async () => {
    let fail = true;
    const f = fakes(async () => { if (fail) throw new TypeError('Failed to fetch'); return new Response(new Uint8Array(10), { status: 200 }); });
    const h = host();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = new OfflineController(f.ports, h);
    c.action('offline-save');
    await vi.waitFor(() => expect(c.get()?.kind).toBe('failed'));
    expect(h.announce).toHaveBeenCalledWith('failed');
    fail = false;
    c.action('offline-save');
    await vi.waitFor(() => expect(c.get()?.kind).toBe('saved'));
    warn.mockRestore();
  });

  it('refresh does not disturb a save that is running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakes(async () => { await gate; return new Response(new Uint8Array(10), { status: 200 }); });
    const c = new OfflineController(f.ports, host());
    c.action('offline-save');
    await vi.waitFor(() => expect(c.get()?.kind).toBe('saving'));
    await c.refresh();
    expect(c.get()?.kind).toBe('saving');
    release();
    await vi.waitFor(() => expect(c.get()?.kind).toBe('saved'));
  });
});

describe('OfflineController: the page is drawn again after a failure', () => {
  it('a refresh keeps "failed" while the files are still missing, and goes to "saved" when they turn up', async () => {
    const f = fakes(async () => { throw new TypeError('Failed to fetch'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = new OfflineController(f.ports, { redraw: vi.fn(), progress: vi.fn(), announce: vi.fn() });
    c.action('offline-save');
    await vi.waitFor(() => expect(c.get()?.kind).toBe('failed'));
    await c.refresh();
    expect(c.get()?.kind).toBe('failed');
    for (const x of POSE_OFFLINE_FILES) await f.cache().put(x.url, new Response('x'));
    await c.refresh();
    expect(c.get()?.kind).toBe('saved');
    warn.mockRestore();
  });
});

describe('the sentence when body tracking cannot load', () => {
  it('says the phone is offline when it is, and keeps the generic sentence otherwise and for every other code', async () => {
    const { playErrorKey } = await import('./play.ts');
    const { stringTables } = await import('../../../core/ui/i18n/index.ts');
    expect(playErrorKey('pose_load', true)).toBe('play.err.pose_offline');
    expect(playErrorKey('pose_load', false)).toBe('play.err.pose_load');
    expect(playErrorKey('game_init', true)).toBe('play.err.game_init');
    expect(playErrorKey('denied', false)).toBe('play.err.denied');
    for (const lang of ['en', 'tr'] as const) {
      expect(stringTables[lang][playErrorKey('pose_load', true) as keyof typeof stringTables.en]).toBeTruthy();
      expect(stringTables[lang][playErrorKey('pose_load', false) as keyof typeof stringTables.en]).toBeTruthy();
    }
  });
});
