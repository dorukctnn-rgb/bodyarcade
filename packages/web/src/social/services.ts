// The real friends services of the shell: the social client on the device's key store, its port, and live play's room port
// signed as the same profile. Started when the page opens, in the background; the shell draws the Friends tab only when
// this answers with services.
//
// Whether the social service exists is asked once, with a plain unsigned GET: a Worker that has it answers 401 with a JSON
// error, a static host answers 404 or its start page. A device that already has a registered profile does not ask (it has
// talked to the service before; the page will say so if it is down), and a device that said "under 16" sends nothing at all.
//
// Room calls are signed: `createLiveRoomPort` gets the client's own `fetcher` and `roomIdentity()`, so the Worker knows which
// profile opens and joins a room (age band, name and the blocks of that profile) and never takes it from the page's say-so.
// They carry the player's signed Pro token too (`pro`): a Pro game starts in a room only while the host's token stands behind it.
import { SocialClient } from '../../../core/social/client.ts';
import { openKeyStore, type KeyStore } from '../../../core/social/keystore.ts';
import type { BodyArcadeStore } from '../../../core/store/store.ts';
import { detectLang } from '../../../core/ui/i18n/index.ts';
import { createLiveRoomPort } from '../app/live-room.ts';
import { router } from '../routes.ts';
import { createSocialPort, type SocialClientLike, type SocialPortHandle } from './adapter.ts';
import type { RoomPort, SocialServices } from './port.ts';

export type Probe = 'answers' | 'absent' | 'unreachable';

/** How long the question waits for an answer before the service counts as unreachable. */
export const PROBE_TIMEOUT_MS = 4000;

/**
 * Does this site have the social service? 'answers': a JSON error from the service itself (an unsigned call is refused with 401).
 * 'absent': an answer that is not the service's (a static host: 404, or the start page). 'unreachable': no answer at all.
 */
export async function probeSocial(fetchFn: typeof fetch = (i, n) => fetch(i, n), origin = ''): Promise<Probe> {
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(`${origin}/api/social/me`, { cache: 'no-store', credentials: 'omit', ...(ctl ? { signal: ctl.signal } : {}) });
    if (!/json/i.test(res.headers.get('content-type') ?? '')) return 'absent';
    const body: unknown = await res.json().catch(() => null);
    return typeof (body as { error?: unknown } | null)?.error === 'string' ? 'answers' : 'absent';
  } catch {
    return 'unreachable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The routes a visitor lands on from a link a friend sent: a room (/r/CODE) or a friend code (/f/BA-XXXXXX). */
export function isLinkEntry(url: string): boolean {
  const id = router.match(url)?.id;
  return id === 'friendlink' || id === 'room';
}

/** The name of the database of the device key (core/social/keystore.ts DB_NAME). */
const KEY_DATABASE = 'bodyarcade-social';

/**
 * The device's key store, opened only when something is saved or when its database exists already: a visitor who never makes a
 * profile, or who says they are under 16, never has a database made for them. `exists()` says whether one is there (when the
 * browser cannot tell, it is opened).
 */
export function lazyKeyStore(o: { open(): Promise<KeyStore>; exists(): Promise<boolean> }): KeyStore {
  let real: Promise<KeyStore> | null = null;
  let there: boolean | null = null;
  let persistent = typeof indexedDB !== 'undefined';
  const get = (): Promise<KeyStore> => (real ??= o.open().then((s) => { persistent = s.persistent; return s; }));
  const exists = async (): Promise<boolean> => (there ??= await o.exists().catch(() => true));
  return {
    get persistent() { return persistent; },
    async load() { return (real !== null || await exists()) ? (await get()).load() : null; },
    async save(identity) { there = true; await (await get()).save(identity); },
    async clear() { if (real !== null || await exists()) await (await get()).clear(); },
  };
}

/** Is there a database of the device key in this browser? */
async function keyDatabaseExists(): Promise<boolean> {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return false;
  if (typeof idb.databases !== 'function') return true;
  return (await idb.databases()).some((d) => d.name === KEY_DATABASE);
}

const FLAG = { version: 1, parse: (raw: unknown): boolean | null => (typeof raw === 'boolean' ? raw : null) } as const;
const KEYS = { version: 1, parse: (raw: unknown): string[] | null => (Array.isArray(raw) && raw.every((x) => typeof x === 'string') ? (raw as string[]).slice(0, 200) : null) } as const;

export interface StartSocialOptions {
  win: Window & typeof globalThis;
  store: BodyArcadeStore;
  /** The visitor came by a friend link or a room link: the services exist even when nothing answers yet, so the page can say so. */
  entry?: boolean;
  fetch?: typeof fetch;
  keys?: KeyStore;
  /** The profile in use is a kid profile of the Family plan (it never goes online). */
  kidProfile?: () => boolean;
  /** The player's signed Pro token as it is now (the entitlements' current().token), or null for a free player: asked at every room call. */
  pro?: () => string | null | undefined;
}

export interface RealSocial extends SocialServices {
  social: SocialPortHandle;
  client: SocialClient;
}

/**
 * The real services, or null when this site has no social service, or while a child's profile is playing (nothing is asked of the
 * service then, not even whether it exists: the page starts the services again when the main player plays). Never throws.
 */
export async function startSocial(o: StartSocialOptions): Promise<RealSocial | null> {
  try {
    if (o.kidProfile?.() === true) return null;
    const ns = o.store.ns('social');
    const tooYoung = (): boolean => ns.get('tooYoung', FLAG, false);
    const keys = o.keys ?? lazyKeyStore({ open: openKeyStore, exists: keyDatabaseExists });
    let known = tooYoung();
    if (!known) {
      const saved = await keys.load().catch(() => null);
      known = saved?.registered === true;
    }
    if (!known) {
      const probe = await probeSocial(o.fetch);
      if (probe === 'absent' || (probe === 'unreachable' && !o.entry)) return null;
    }
    const client = new SocialClient({ origin: '', keys, ...(o.fetch ? { fetch: o.fetch } : {}) });
    const checked: SocialClientLike = client;
    const kid = o.kidProfile ?? ((): boolean => false);
    const social = createSocialPort({
      client: checked,
      age: { tooYoung, remember: () => ns.set('tooYoung', true, FLAG) },
      kidProfile: kid,
      lang: () => detectLang(o.win.navigator.languages),
    });
    const live = createLiveRoomPort({
      origin: o.win.location.origin,
      identity: () => {
        if (kid()) return null;
        try { return client.roomIdentity(); } catch { return null; }
      },
      fetcher: client.fetcher,
      pro: () => (kid() ? null : o.pro?.() ?? null),
      blocks: { load: () => ns.get('roomBlocks', KEYS, []), save: (list) => ns.set('roomBlocks', list.slice(-200), KEYS) },
    });
    const rooms: RoomPort = {
      ...live,
      reportSeat: (seat, reason, block) => { live.client()?.reportPlayer(seat, reason, block); },
      blockSeat: (seat) => { live.client()?.block(seat); },
    };
    return { social, rooms, client };
  } catch (e) {
    console.error(e);
    return null;
  }
}
