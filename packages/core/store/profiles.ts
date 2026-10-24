// The family's profiles: up to six players on one device, each with a record of their own (the Family plan and the Founders).
//
//   One record per profile.     Everything a player owns (progress, bests, streaks, the daily challenge, workout plans, settings,
//                               history) lives under a key prefix of its own: the first profile keeps today's 'ba2' (so a player
//                               of the one-player version needs no move of data and loses nothing), the others get 'ba2p2', 'ba2p3'...
//                               The device owns two namespaces that belong to no profile: 'entitlements' (what was bought) and
//                               'profiles' (this list). A profile's store refuses them; the device store accepts nothing else.
//   Capacity by entitlement.    can('profiles:6') gives six, everybody else has one. When a plan ends the profiles beyond the
//                               first become read-only: they stay in the list and keep every key, nothing is deleted, they just
//                               cannot be played as or changed (their store refuses writes, wherever a handle to it is held)
//                               until the plan is back. Only the person who asks, with a confirmation, deletes a profile.
//   Switching mixes nothing.    A space (switchTo, open) holds that profile's store and rules. Two spaces never share a key, and a
//                               space built earlier writes to its own profile whatever is playing now.
//   The owner.                  Profile 1 is the owner: it cannot be deleted (only reset), it holds the online identity of the
//                               device (friends, lobbies, the streak documents on the server), and it is where the live site's
//                               old record is imported. Every other profile is local to this device: nothing of it ever reaches
//                               a server, it has no online identity, and an old v1 record is never copied into it.
//   Kid profiles.               No online identity at all, no purchase screen without the parent gate, no calories and no weight,
//                               local play and races against the family's recordings, low-impact defaults. Leaving a kid
//                               profile for a profile that is not a kid's goes through the parent gate too.
//   The list can be lost.       If it is damaged, the profiles whose records are still in storage are taken back as kid
//                               profiles (the cautious reading). If it was written by a newer version it is left alone.
import type { Unsubscribe } from '../types/index.ts';
import { createArcade, namespaceOf, type Arcade, type ArcadeGame, type ArcadeOptions } from './arcade.ts';
import type { ImportReport } from './legacy.ts';
import { createParentGate, type ParentGate } from './parent-gate.ts';
import { TotalsSchema, createProgress } from './progress.ts';
import { BAD, p, schemaOf, type Parser } from './schema.ts';
import { createStore, type BodyArcadeStore, type StorageLike, type StoreProblem } from './store.ts';
import type { SyncPort } from './sync-docs.ts';

// ───────────────────────── constants ─────────────────────────

export const MAX_PROFILES = 6;
/** The entitlements' feature for the family profiles: the Family plan and the Founders have it. */
export const PROFILES_FEATURE = 'profiles:6';
export const OWNER_ID = 'p1';
/** The namespaces that belong to the device, not to any profile. */
export const DEVICE_NAMESPACES: readonly string[] = ['entitlements', 'profiles'];
/** The pictures to choose from (the art is the interface's; these are the names). */
export const AVATARS = ['fox', 'owl', 'bear', 'panda', 'tiger', 'frog', 'koala', 'whale', 'robot', 'rocket', 'star', 'bolt'] as const;
export type AvatarId = (typeof AVATARS)[number];
/** Letters of a name (counted as the player sees them, not as UTF-16 units). */
export const NAME_MAX = 20;
/** A removal is confirmed within this time of being asked for. */
export const REMOVAL_VALID_MS = 2 * 60_000;
/** The last time a profile played is written at most this often. */
export const TOUCH_EVERY_MS = 10 * 60_000;

const MAX_SEQ = 999;
const MAX_STORED = 12;

/** Kinds of feature that need the online identity of the device: a profile that is not online never gets them from can(). */
const ONLINE_KINDS: ReadonlySet<string> = new Set(['live', 'social', 'friends', 'lobby', 'lobbies', 'chat', 'board', 'boards', 'rooms', 'quickmatch']);

// ───────────────────────── what a profile may do ─────────────────────────

export interface ProfileRules {
  /** Rounds are saved. False while the profile is locked (its plan ended). */
  record: boolean;
  /**
   * The online identity of the device: friends, lobbies and rooms with other people, chat, the public and weekly boards, and the
   * streak, challenge and plan documents on the server. True only for the owner. A kid profile never registers online.
   */
  online: boolean;
  /** 'parent_gate': the parent gate comes before the paywall, the shop, the licence box and the Play purchase. */
  purchase: 'open' | 'parent_gate';
  /** The paywall may come up by itself after a good session. */
  autoPaywall: boolean;
  /** Calories are shown and the weight may be asked for. */
  calories: boolean;
  /** Which recordings the profile may race against: the family's on this device, or also the friends'. */
  ghosts: 'family' | 'all';
  /** Words the player types that other people can read (a name on a board, chat, a note on a report). */
  freeText: boolean;
  /** Sharing a clip of a round or the camera with anyone. */
  share: boolean;
}

export function rulesFor(who: { owner: boolean; kid: boolean; locked: boolean }): ProfileRules {
  const online = who.owner && !who.kid && !who.locked;
  return {
    record: !who.locked,
    online,
    purchase: who.kid ? 'parent_gate' : 'open',
    autoPaywall: !who.kid,
    calories: !who.kid,
    ghosts: online ? 'all' : 'family',
    freeText: online,
    share: !who.kid,
  };
}

/** What the settings of a new profile start with (applied once, when the profile has no settings yet). */
export interface ProfileDefaults {
  seated: boolean;
  /** No jumping or stamping. */
  quiet?: boolean;
  level?: 'gentle';
  /** A weight is never asked for or kept. */
  weightKg?: null;
  /** The workout plan the home screen suggests first. */
  plan?: 'kids-break';
}

export function defaultsFor(who: { kid: boolean; seated: boolean }): ProfileDefaults {
  return who.kid ? { seated: who.seated, quiet: true, level: 'gentle', weightKg: null, plan: 'kids-break' } : { seated: who.seated };
}

// ───────────────────────── names ─────────────────────────

export type NameFailure = 'name_empty' | 'name_long' | 'name_chars';

/** A name as it is kept: normalised, one space between words, at most NAME_MAX letters; letters, digits and . ' - _ only (no emoji). */
export function normalizeName(raw: unknown): { ok: true; name: string } | { ok: false; code: NameFailure } {
  if (typeof raw !== 'string') return { ok: false, code: 'name_empty' };
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name.length === 0) return { ok: false, code: 'name_empty' };
  if ([...name].length > NAME_MAX) return { ok: false, code: 'name_long' };
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’_-]*$/u.test(name)) return { ok: false, code: 'name_chars' };
  return { ok: true, name };
}

/** Two names that look the same to a person are the same: no capitals, no accents, dotless i is i. */
const foldName = (name: string): string => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i');

// ───────────────────────── the list, as stored ─────────────────────────

interface StoredProfile {
  seq: number;
  name: string;
  avatar: AvatarId;
  kid: boolean;
  seated: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

interface BookDoc {
  /** The highest sequence number ever handed out: ids are never used twice. */
  seq: number;
  /** The profile that is playing. */
  active: number;
  askOnStart: boolean;
  /** How many profiles the plan allowed the last time it was known (what holds while the entitlements are still being read). */
  cap: number;
  profiles: StoredProfile[];
}

const seqP = p.number({ int: true, min: 1, max: MAX_SEQ });
const storedProfileP = p.object({
  seq: seqP,
  name: p.withDefault(p.string({ min: 1, max: 80 }), ''),
  avatar: p.withDefault(p.oneOf(AVATARS), 'fox' as AvatarId),
  kid: p.withDefault(p.boolean(), true),                         // a damaged flag is read the cautious way
  seated: p.withDefault(p.boolean(), false),
  createdAt: p.withDefault(p.epoch(), 0),
  lastUsedAt: p.withDefault(p.nullable(p.epoch()), null),
});
const docShapeP = p.object({
  seq: p.withDefault(seqP, 1),
  active: p.withDefault(seqP, 1),
  askOnStart: p.withDefault(p.boolean(), true),
  cap: p.withDefault(p.number({ int: true, min: 1, max: MAX_PROFILES }), 1),
  profiles: p.array(storedProfileP, { max: MAX_STORED, lenient: true }),
});

/** No owner, no list: a list without the first profile cannot be trusted, and is rebuilt from what storage still holds. */
const bookP: Parser<BookDoc> = (raw) => {
  const r = docShapeP(raw);
  if (r === BAD) return BAD;
  const seen = new Set<number>();
  const profiles = r.profiles.filter((x) => (seen.has(x.seq) ? false : (seen.add(x.seq), true))).sort((a, b) => a.seq - b.seq);
  if (profiles[0]?.seq !== 1) return BAD;
  const highest = profiles.reduce((m, x) => Math.max(m, x.seq), 1);
  return {
    seq: Math.max(r.seq, highest),
    active: seen.has(r.active) ? r.active : 1,
    askOnStart: r.askOnStart,
    cap: r.cap,
    profiles,
  };
};
const BOOK_SCHEMA = schemaOf(1, bookP);
const NONE: BookDoc = { seq: 0, active: 1, askOnStart: true, cap: 1, profiles: [] };

// ───────────────────────── what the interface sees ─────────────────────────

export type ProfileState = 'ready' | 'locked';

export interface ProfileView {
  id: string;
  name: string;
  avatar: AvatarId;
  kid: boolean;
  seated: boolean;
  /** The first profile: the online identity, the live site's old record, the one that cannot be deleted. */
  owner: boolean;
  /** The one that is playing. */
  active: boolean;
  /** 'locked': the plan no longer allows it; it is read-only and nothing in it was deleted. */
  state: ProfileState;
  createdAt: number;
  /** Epoch ms of the last saved round (written at most every ten minutes) or the last switch to it; null before. */
  lastUsedAt: number | null;
  rules: ProfileRules;
  defaults: ProfileDefaults;
}

export interface Capacity {
  /** 1, or 6 with the Family plan or as a Founder. */
  max: number;
  /** Profiles in the list, locked ones included. */
  used: number;
  /** Profiles that can be played now. */
  ready: number;
  canAdd: boolean;
  /** Why not: the plan allows one ('plan': the Family plan is what to offer), or the six are used ('full'). */
  why: 'plan' | 'full' | null;
}

export interface MigrationReport {
  /**
   * fresh: nothing was here and the owner was made. single: the record of the one-player version became the owner's, where it
   * stands (no key moved). existing: the list was there. recovered: the list was lost and the profiles still in storage were
   * taken back. frozen: the list was written by a newer version and is left exactly as it is (only the owner is shown).
   */
  kind: 'fresh' | 'single' | 'existing' | 'recovered' | 'frozen';
  /** The ids taken back when the list was lost. */
  adopted: string[];
}

export type ProfileEventKind = 'switched' | 'created' | 'updated' | 'removed' | 'refreshed';

export interface ProfileEvent {
  kind: ProfileEventKind;
  /** The profile it is about; null when it is about the list as a whole. */
  id: string | null;
  /** The profile that is playing after it. */
  active: string;
  /** Whether that profile has the online identity: open the social client when true, close it when false. */
  online: boolean;
  /** 'switched' by itself: 'plan' (the active profile was locked), 'removed' (it was deleted in another tab). */
  reason?: 'plan' | 'removed';
}

type Failure<C extends string> = { ok: false; code: C };

export type SwitchFailure = 'unknown' | 'locked' | 'parent_gate';
export type SwitchResult = { ok: true; space: ProfileSpace; changed: boolean } | Failure<SwitchFailure>;

export interface NewProfile {
  name: string;
  /** Default: the first picture nobody uses. */
  avatar?: AvatarId;
  kid?: boolean;
  seated?: boolean;
}
export type CreateFailure = NameFailure | 'name_taken' | 'avatar' | 'parent_gate' | 'plan' | 'full' | 'frozen' | 'exhausted';
export type CreateResult = { ok: true; profile: ProfileView } | Failure<CreateFailure>;

export interface ProfilePatch { name?: string; avatar?: AvatarId; kid?: boolean; seated?: boolean }
export type UpdateFailure = NameFailure | 'name_taken' | 'avatar' | 'unknown' | 'locked' | 'parent_gate' | 'owner_kid' | 'frozen';
export type UpdateResult = { ok: true; profile: ProfileView } | Failure<UpdateFailure>;

export interface RemovalSummary {
  id: string;
  name: string;
  kid: boolean;
  owner: boolean;
  createdAt: number;
  lastUsedAt: number | null;
  /** Rounds played, over the games the book was told about (0 when it was told none). */
  runs: number;
  /** Everything stored for the profile, counted in keys. */
  keys: number;
}

export interface RemovalPlan {
  ok: true;
  /** 'delete': the profile and its record go. 'reset': the owner's record goes, the profile and what was bought stay. */
  action: 'delete' | 'reset';
  /** Handed back to remove(): without it nothing is deleted. */
  token: string;
  /** Epoch ms after which the token is no good. */
  expiresAt: number;
  summary: RemovalSummary;
}
export type RemovalFailure = 'unknown' | 'parent_gate' | 'frozen';
export type RemoveFailure = RemovalFailure | 'confirm_required';
export type RemoveResult = { ok: true; action: 'delete' | 'reset'; active: string } | Failure<RemoveFailure>;

export interface FamilyEntry {
  id: string;
  name: string;
  avatar: AvatarId;
  kid: boolean;
  state: ProfileState;
  active: boolean;
  /** The best score in that game (over everything, one world, or one world at one difficulty); 0 for none yet. */
  best: number;
}

export interface ProfileBookOptions {
  /** The device's store. Without it the book makes one on the browser's storage (the way to go: nothing else needs the base store). */
  store?: BodyArcadeStore;
  /** Used only when no store is given. */
  storage?: StorageLike | null;
  now?: () => number;
  timeZone?: string;
  onProblem?: (problem: StoreProblem) => void;
  /** The entitlements' can(). */
  can: (feature: string) => boolean;
  /** False while the entitlements are still being read: what the plan allowed last time holds until they answer. */
  known?: () => boolean;
  /** Called with refresh(); returns how to stop. Pass the entitlements' onChange here. */
  watch?: (refresh: () => void) => Unsubscribe | void;
  /** The owner's name when the book makes the first profile (the interface's word for "me"). */
  ownerName?: string;
  /** A name for a profile found in storage after the list was lost, or whose name was damaged. */
  recoveredName?: (seq: number) => string;
  /** The game ids, for the number of rounds in the summary of a removal and nothing else. */
  games?: () => readonly string[];
  /** For the questions of the parent gate. */
  random?: () => number;
}

/** What the interface gives an arcade of a profile; the store, the rules and the sync port come from the profile. */
export interface SpaceArcadeOptions {
  games: () => readonly ArcadeGame[];
  paid?: () => boolean;
  content?: ArcadeOptions['content'];
  /** The social client's sync port. The space hands it to the arcade only while the owner is playing. */
  syncPort?: () => SyncPort | null;
  /** Default: what the profile says about sitting. */
  seated?: () => boolean | null;
  now?: () => number;
}

export interface ProfileSpace {
  readonly id: string;
  /** Read afresh every time; after the profile is gone it is what it was last. */
  readonly profile: ProfileView;
  readonly rules: ProfileRules;
  /** The profile's own store. Refuses the device's namespaces; refuses every write once the profile is locked or gone. */
  readonly store: BodyArcadeStore;
  /** In the list and not locked. */
  alive(): boolean;
  /** This is the profile that is playing. */
  current(): boolean;
  /** The entitlements' can(), without the features that need an online identity for a profile that has none. */
  can(feature: string): boolean;
  /** `port` only while this profile is the owner and the profile that is playing is the owner; null otherwise (a kid never syncs). */
  syncPort(port: () => SyncPort | null): () => SyncPort | null;
  /** createArcade for this profile: its store, its can, its sync port, the sitting setting; the live site's record only for the owner. */
  arcade(o: SpaceArcadeOptions): Arcade;
}

export interface ProfileBook {
  /** Where the entitlements and the list live; it refuses every other namespace. Give this to bootEntitlements. */
  readonly device: BodyArcadeStore;
  readonly gate: ParentGate;
  readonly migration: MigrationReport;
  /** False in a private window: the profiles are gone when the page closes. */
  readonly persistent: boolean;
  /** The list was written by a newer version: only the owner is shown and nothing is changed. */
  readonly frozen: boolean;
  /** The storage key of the list, for the browser's 'storage' event (call refresh() when it is written in another tab). */
  readonly registryKey: string;

  /** In creation order; the owner first. */
  list(): ProfileView[];
  get(id: string): ProfileView | null;
  /** The profile that is playing: the one the list names, or the owner when that one is locked. */
  active(): ProfileView;
  capacity(): Capacity;
  /** Ask "who is playing?" now: two or more profiles can be played and the owner wants it asked. */
  needsPicker(): boolean;
  setAskOnStart(on: boolean): { ok: true } | Failure<'parent_gate' | 'frozen'>;

  /** The space of the active profile. Falls back to the owner (and says so in the list) when the active one is locked. */
  open(): ProfileSpace;
  switchTo(id: string): SwitchResult;
  create(input: NewProfile): CreateResult;
  update(id: string, patch: ProfilePatch): UpdateResult;
  /** Asks what a removal would cost; remove() needs the token it returns. */
  planRemoval(id: string): RemovalPlan | Failure<RemovalFailure>;
  remove(id: string, token: string): RemoveResult;

  /** A profile's record, to read and never to write: a family ghost, a look at a locked profile. */
  peek(id: string): { profile: ProfileView; store: BodyArcadeStore } | null;
  /** Who is best at a game in this family (all profiles, locked ones included), best first. */
  family(game: string, which?: { variant?: string; difficulty?: string }): FamilyEntry[];

  /** The active profile has the online identity. */
  online(): boolean;
  /** Look again: the plan changed, another tab wrote, the entitlements were read. Emits when something is different. */
  refresh(): void;
  onChange(listener: (e: ProfileEvent) => void): Unsubscribe;
  dispose(): void;
}

// ───────────────────────── the book ─────────────────────────

const idOf = (seq: number): string => `p${seq}`;
const seqOfId = (id: unknown): number | null => {
  if (typeof id !== 'string') return null;
  const m = /^p([1-9]\d{0,2})$/.exec(id);
  return m ? Number(m[1]) : null;
};

export function createProfileBook(o: ProfileBookOptions): ProfileBook {
  const base: BodyArcadeStore = o.store ?? createStore({
    ...(o.storage !== undefined ? { storage: o.storage } : {}),
    ...(o.now ? { now: o.now } : {}),
    ...(o.timeZone ? { timeZone: o.timeZone } : {}),
    ...(o.onProblem ? { onProblem: o.onProblem } : {}),
  });
  const now = (): number => base.now();
  const device = base.withPrefix(base.prefix, { allow: DEVICE_NAMESPACES });
  const registry = device.ns('profiles');
  const slot = registry.slot<BookDoc>('book', BOOK_SCHEMA, NONE);
  const gate = createParentGate({ ns: registry, now, ...(o.random ? { random: o.random } : {}) });
  const recoveredName = (seq: number): string => { try { return o.recoveredName?.(seq) || `Player ${seq}`; } catch { return `Player ${seq}`; } };
  const prefixOf = (seq: number): string => (seq === 1 ? base.prefix : `${base.prefix}p${seq}`);
  const can = (feature: string): boolean => { try { return o.can(feature) === true; } catch { return false; } };
  const known = (): boolean => { try { return o.known ? o.known() !== false : true; } catch { return true; } };

  let frozen = false;
  let memoryDoc: BookDoc | null = null;
  /** The profile THIS page plays as. The list also remembers one, for the next page; another page's switch never moves this one. */
  let current = 1;
  let migration: MigrationReport = { kind: 'existing', adopted: [] };
  const listeners = new Set<(e: ProfileEvent) => void>();
  const spaces = new Map<number, ProfileSpace>();
  const stores = new Map<number, BodyArcadeStore>();
  const looks = new Map<number, BodyArcadeStore>();
  let pending: { token: string; seq: number; action: 'delete' | 'reset'; expiresAt: number } | null = null;
  let tokens = 0;
  let disposed = false;
  let lastSignature = '';

  // ── the list ──

  const ownerRecord = (t: number): StoredProfile => ({
    seq: 1, name: (o.ownerName ?? '').trim() || 'Player', avatar: 'fox', kid: false, seated: false, createdAt: t, lastUsedAt: null,
  });

  /** The numbers of the profiles whose records are in storage but not in a list (a list that was lost). */
  function foundInStorage(): number[] {
    const escaped = base.prefix.replace(/[^a-z0-9]/g, '');
    const found = base.scanPrefixes(new RegExp(`^${escaped}p([1-9]\\d{0,2})$`));
    return found
      .map((pre) => Number(pre.slice(base.prefix.length + 1)))
      .filter((seq) => seq >= 2 && seq <= MAX_SEQ && base.withPrefix(prefixOf(seq), { deny: DEVICE_NAMESPACES }).size() > 0)
      .sort((a, b) => a - b);
  }

  /** Makes the list: the owner, and whoever is still in storage. */
  function ensure(): BookDoc {
    const t = now();
    const ownerHolds = base.withPrefix(base.prefix, { deny: DEVICE_NAMESPACES }).size() > 0;
    const back = foundInStorage().slice(0, MAX_PROFILES - 1);
    const profiles: StoredProfile[] = [ownerRecord(t)];
    for (const seq of back) {
      profiles.push({ seq, name: recoveredName(seq), avatar: AVATARS[(seq - 1) % AVATARS.length] as AvatarId, kid: true, seated: false, createdAt: t, lastUsedAt: null });
    }
    const doc: BookDoc = { seq: back.reduce((m, s) => Math.max(m, s), 1), active: 1, askOnStart: true, cap: 1, profiles };
    write(doc);
    migration = { kind: back.length > 0 ? 'recovered' : ownerHolds ? 'single' : 'fresh', adopted: back.map(idOf) };
    return doc;
  }

  /** The list as it is stored, or null when there is none. Never writes. */
  function peekDoc(): BookDoc | null {
    if (frozen) return memoryDoc;
    const d = slot.get();
    return d.profiles.length > 0 ? d : null;
  }

  function readDoc(): BookDoc {
    return peekDoc() ?? ensure();
  }

  /** Every write also notes what the plan allows, once the entitlements are read: it is what holds while a later page is still reading them. */
  function write(doc: BookDoc): void {
    if (frozen) return;
    if (known()) doc.cap = can(PROFILES_FEATURE) ? MAX_PROFILES : 1;
    slot.set(doc);
  }

  {
    const first = slot.get();
    if (first.profiles.length > 0) migration = { kind: 'existing', adopted: [] };
    else if (registry.has('book')) {
      // Something is stored under the key that this version cannot read: a newer version wrote it. Leave it exactly as it is.
      frozen = true;
      memoryDoc = { seq: 1, active: 1, askOnStart: false, cap: 1, profiles: [ownerRecord(now())] };
      migration = { kind: 'frozen', adopted: [] };
    } else ensure();
  }

  // ── capacity, states, rules ──

  /** How many profiles the plan allows: what the entitlements say, or what they said last time while they are still being read. */
  function maxFor(doc: BookDoc | null): number {
    if (!known()) return Math.max(1, Math.min(MAX_PROFILES, doc?.cap ?? 1));
    return can(PROFILES_FEATURE) ? MAX_PROFILES : 1;
  }

  const ordered = (doc: BookDoc): StoredProfile[] => [...doc.profiles].sort((a, b) => a.seq - b.seq);

  /** Whether the plan lets this profile be played: it is in the list and within the room the plan allows. */
  function usable(doc: BookDoc, seq: number): boolean {
    const i = ordered(doc).findIndex((r) => r.seq === seq);
    return i >= 0 && i < maxFor(doc);
  }

  /** The profile this page plays as: the one it chose, or the owner when that one is gone or locked. */
  function activeSeqOf(doc: BookDoc): number {
    return usable(doc, current) ? current : 1;
  }

  function viewOf(doc: BookDoc, rec: StoredProfile, locked: boolean, activeSeq: number): ProfileView {
    const owner = rec.seq === 1;
    return {
      id: idOf(rec.seq),
      name: rec.name || recoveredName(rec.seq),
      avatar: rec.avatar,
      kid: rec.kid,
      seated: rec.seated,
      owner,
      active: rec.seq === activeSeq,
      state: locked ? 'locked' : 'ready',
      createdAt: rec.createdAt,
      lastUsedAt: rec.lastUsedAt,
      rules: rulesFor({ owner, kid: rec.kid, locked }),
      defaults: defaultsFor({ kid: rec.kid, seated: rec.seated }),
    };
  }

  function viewsOf(doc: BookDoc): ProfileView[] {
    const max = maxFor(doc);
    const activeSeq = activeSeqOf(doc);
    return ordered(doc).map((rec, i) => viewOf(doc, rec, i >= max, activeSeq));
  }

  const viewById = (id: string): ProfileView | null => {
    const doc = peekDoc();
    return doc ? viewsOf(doc).find((v) => v.id === id) ?? null : null;
  };

  function activeViewOf(doc: BookDoc): ProfileView {
    const views = viewsOf(doc);
    return views.find((v) => v.active) ?? (views[0] as ProfileView);
  }

  function signature(doc: BookDoc | null): string {
    if (!doc) return '';
    return JSON.stringify([maxFor(doc), viewsOf(doc).map((v) => [v.id, v.state, v.name, v.avatar, v.kid, v.seated, v.active]), doc.askOnStart]);
  }

  /** What a profile's store asks at every write: is it still in the list, and not locked? The owner always is. */
  function writable(seq: number): boolean {
    if (seq === 1) return true;
    const doc = peekDoc();
    if (!doc) return false;
    const i = ordered(doc).findIndex((r) => r.seq === seq);
    return i >= 0 && i < maxFor(doc);
  }

  function storeOf(seq: number): BodyArcadeStore {
    let s = stores.get(seq);
    if (!s) {
      s = base.withPrefix(prefixOf(seq), { deny: DEVICE_NAMESPACES, readOnly: () => !writable(seq) });
      stores.set(seq, s);
    }
    return s;
  }

  function lookStore(seq: number): BodyArcadeStore {
    let s = looks.get(seq);
    if (!s) {
      s = base.withPrefix(prefixOf(seq), { deny: DEVICE_NAMESPACES, readOnly: true });
      looks.set(seq, s);
    }
    return s;
  }

  /** The book's own hands on a profile's keys (wiping it); the profile's store would refuse while the profile is not in the list. */
  const maintenance = (seq: number, keep: readonly string[] = []): BodyArcadeStore => base.withPrefix(prefixOf(seq), { deny: [...DEVICE_NAMESPACES, ...keep] });

  // ── events ──

  function emit(kind: ProfileEventKind, id: string | null, reason?: 'plan' | 'removed'): void {
    if (disposed) return;
    const doc = peekDoc();
    lastSignature = signature(doc);
    const active = doc ? activeViewOf(doc) : null;
    const ev: ProfileEvent = { kind, id, active: active?.id ?? OWNER_ID, online: active?.rules.online ?? false, ...(reason ? { reason } : {}) };
    for (const l of [...listeners]) { try { l(ev); } catch { /* a faulty listener must not stop the others */ } }
  }

  // ── who may do what ──

  /** The owner may manage the profiles; anybody else needs the parent gate open. */
  const mayManage = (doc: BookDoc): boolean => activeViewOf(doc).owner || gate.isOpen();

  function nameTaken(doc: BookDoc, name: string, except: number | null): boolean {
    const folded = foldName(name);
    return doc.profiles.some((r) => r.seq !== except && foldName(r.name || recoveredName(r.seq)) === folded);
  }

  function firstFreeAvatar(doc: BookDoc): AvatarId {
    const used = new Set(doc.profiles.map((r) => r.avatar));
    return AVATARS.find((a) => !used.has(a)) ?? (AVATARS[doc.profiles.length % AVATARS.length] as AvatarId);
  }

  /** A saved round makes the profile "used just now", written at most every ten minutes. */
  function touch(seq: number): void {
    if (frozen || disposed) return;
    const doc = peekDoc();
    const rec = doc?.profiles.find((r) => r.seq === seq);
    if (!doc || !rec) return;
    const t = now();
    if (rec.lastUsedAt !== null && t >= rec.lastUsedAt && t - rec.lastUsedAt < TOUCH_EVERY_MS) return;
    rec.lastUsedAt = t;
    write(doc);
  }

  // ── spaces ──

  function spaceOf(seq: number): ProfileSpace {
    const held = spaces.get(seq);
    if (held) return held;
    const id = idOf(seq);
    let last = viewById(id) as ProfileView;
    const profile = (): ProfileView => { const v = viewById(id); if (v) last = v; return last; };
    const onlineNow = (): boolean => { const doc = peekDoc(); return doc ? activeViewOf(doc).rules.online : false; };

    const space: ProfileSpace = {
      id,
      get profile() { return profile(); },
      get rules() { return profile().rules; },
      store: storeOf(seq),
      alive: () => viewById(id)?.state === 'ready',
      current: () => { const doc = peekDoc(); return doc ? activeViewOf(doc).id === id : false; },
      can(feature) {
        if (!can(feature)) return false;
        const kind = String(feature).split(':')[0] ?? '';
        return ONLINE_KINDS.has(kind) ? profile().rules.online : true;
      },
      syncPort(port) {
        return () => {
          try {
            const v = viewById(id);
            if (!v || !v.owner || !v.rules.online || !onlineNow()) return null;
            return port();
          } catch { return null; }
        };
      },
      arcade(a) {
        const inner = createArcade({
          store: space.store,
          games: a.games,
          can: (f) => space.can(f),
          ...(a.paid ? { paid: a.paid } : {}),
          seated: a.seated ?? ((): boolean | null => profile().seated),
          ...(a.content ? { content: a.content } : {}),
          syncPort: space.syncPort(a.syncPort ?? (() => null)),
          writable: () => space.alive(),
          ...(a.now ? { now: a.now } : {}),
        });
        const nothing: ImportReport = { status: 'nothing', runs: 0, achievements: 0, worlds: 0, bests: 0 };
        return {
          ...inner,
          recordRun(game, run) {
            const report = inner.recordRun(game, run);
            if (report.outcome.saved) touch(seq);
            return report;
          },
          finishPlanStep(run) {
            const step = inner.finishPlanStep(run);
            if (step?.report.outcome.saved) touch(seq);
            return step;
          },
          // The live site's record belongs to whoever played there: the owner. No other profile gets a copy of it.
          importLegacy: (storage) => (seq === 1 ? inner.importLegacy(storage) : nothing),
        };
      },
    };
    spaces.set(seq, space);
    return space;
  }

  // ── the book itself ──

  const toCapacity = (doc: BookDoc): Capacity => {
    const max = maxFor(doc);
    const used = doc.profiles.length;
    const canAdd = used < max;
    return { max, used, ready: Math.min(used, max), canAdd, why: canAdd ? null : max <= 1 ? 'plan' : 'full' };
  };

  /**
   * Writes what the plan allows into the list (once it is known), moves THIS page off a profile that is locked or gone, and makes
   * sure that the profile the list remembers for the next page is one that can be played.
   */
  function settle(doc: BookDoc): { reason: 'plan' | 'removed' | null } {
    if (frozen) return { reason: null };
    let changed = false;
    if (known() && doc.cap !== maxFor(doc)) changed = true;
    let reason: 'plan' | 'removed' | null = null;
    if (!usable(doc, current)) {
      reason = doc.profiles.some((r) => r.seq === current) ? 'plan' : 'removed';
      current = 1;
    }
    if (!usable(doc, doc.active)) { doc.active = 1; changed = true; }
    if (changed) write(doc);
    return { reason };
  }

  {
    // This page starts as the profile the list remembers, when it can be played.
    const doc = peekDoc();
    current = doc && usable(doc, doc.active) ? doc.active : 1;
  }
  lastSignature = signature(peekDoc());

  let unwatch: (() => void) | null = null;

  const book: ProfileBook = {
    device,
    gate,
    get migration() { return migration; },
    persistent: base.persistent,
    get frozen() { return frozen; },
    registryKey: `${base.prefix}.profiles.book`,

    list: () => viewsOf(readDoc()),
    get: (id) => viewsOf(readDoc()).find((v) => v.id === id) ?? null,
    active: () => activeViewOf(readDoc()),
    capacity: () => toCapacity(readDoc()),

    needsPicker() {
      const doc = readDoc();
      return doc.askOnStart && viewsOf(doc).filter((v) => v.state === 'ready').length >= 2;
    },

    setAskOnStart(on) {
      if (frozen) return { ok: false, code: 'frozen' };
      const doc = readDoc();
      if (!mayManage(doc)) return { ok: false, code: 'parent_gate' };
      if (doc.askOnStart !== (on === true)) { doc.askOnStart = on === true; write(doc); emit('updated', null); }
      return { ok: true };
    },

    open() {
      const doc = readDoc();
      const s = settle(doc);
      if (s.reason) emit('switched', OWNER_ID, s.reason);
      return spaceOf(activeSeqOf(doc));
    },

    switchTo(id) {
      const doc = readDoc();
      const seq = seqOfId(id);
      const target = seq === null ? undefined : doc.profiles.find((r) => r.seq === seq);
      if (!target) return { ok: false, code: 'unknown' };
      const view = viewsOf(doc).find((v) => v.id === id) as ProfileView;
      if (view.state === 'locked') return { ok: false, code: 'locked' };
      const from = activeViewOf(doc);
      if (from.id === id) return { ok: true, space: spaceOf(target.seq), changed: false };
      // A child does not walk out of a child's profile into a grown-up's by tapping.
      if (from.kid && !view.kid && !gate.isOpen()) return { ok: false, code: 'parent_gate' };
      current = target.seq;
      doc.active = target.seq;
      target.lastUsedAt = now();
      write(doc);
      gate.close();
      emit('switched', id);
      return { ok: true, space: spaceOf(target.seq), changed: true };
    },

    create(input) {
      if (frozen) return { ok: false, code: 'frozen' };
      const doc = readDoc();
      if (!mayManage(doc)) return { ok: false, code: 'parent_gate' };
      const cap = toCapacity(doc);
      if (!cap.canAdd) return { ok: false, code: cap.why === 'full' ? 'full' : 'plan' };
      const asks: Partial<NewProfile> = input && typeof input === 'object' ? input : {};
      const named = normalizeName(asks.name);
      if (!named.ok) return named;
      if (nameTaken(doc, named.name, null)) return { ok: false, code: 'name_taken' };
      const avatar = asks.avatar === undefined ? firstFreeAvatar(doc) : asks.avatar;
      if (!(AVATARS as readonly string[]).includes(avatar)) return { ok: false, code: 'avatar' };
      const seq = doc.seq + 1;
      if (seq > MAX_SEQ) return { ok: false, code: 'exhausted' };
      // Nothing may be left where the new profile will keep its record (a tab that wrote after a profile was deleted).
      maintenance(seq).clearAll();
      const rec: StoredProfile = { seq, name: named.name, avatar, kid: asks.kid === true, seated: asks.seated === true, createdAt: now(), lastUsedAt: null };
      doc.profiles.push(rec);
      doc.seq = seq;
      write(doc);
      emit('created', idOf(seq));
      return { ok: true, profile: viewsOf(doc).find((v) => v.id === idOf(seq)) as ProfileView };
    },

    update(id, patch) {
      if (frozen) return { ok: false, code: 'frozen' };
      const doc = readDoc();
      const seq = seqOfId(id);
      const rec = seq === null ? undefined : doc.profiles.find((r) => r.seq === seq);
      if (!rec) return { ok: false, code: 'unknown' };
      const views = viewsOf(doc);
      const view = views.find((v) => v.id === id) as ProfileView;
      if (view.state === 'locked') return { ok: false, code: 'locked' };
      const me = activeViewOf(doc);
      const manage = me.owner || gate.isOpen();
      const self = me.id === id;
      const asks = patch ?? {};
      if ((asks.name !== undefined || asks.avatar !== undefined) && !(manage || (self && !me.kid))) return { ok: false, code: 'parent_gate' };
      if (asks.seated !== undefined && !(manage || self)) return { ok: false, code: 'parent_gate' };
      if (asks.kid !== undefined && !manage) return { ok: false, code: 'parent_gate' };
      if (asks.kid === true && rec.seq === 1) return { ok: false, code: 'owner_kid' };
      let name = rec.name;
      if (asks.name !== undefined) {
        const named = normalizeName(asks.name);
        if (!named.ok) return named;
        if (nameTaken(doc, named.name, rec.seq)) return { ok: false, code: 'name_taken' };
        name = named.name;
      }
      if (asks.avatar !== undefined && !(AVATARS as readonly string[]).includes(asks.avatar)) return { ok: false, code: 'avatar' };
      const next: StoredProfile = {
        ...rec, name,
        avatar: asks.avatar ?? rec.avatar,
        kid: asks.kid ?? rec.kid,
        seated: asks.seated ?? rec.seated,
      };
      const changed = next.name !== rec.name || next.avatar !== rec.avatar || next.kid !== rec.kid || next.seated !== rec.seated;
      if (changed) {
        Object.assign(rec, next);
        write(doc);
        emit('updated', id);
      }
      return { ok: true, profile: viewsOf(doc).find((v) => v.id === id) as ProfileView };
    },

    planRemoval(id) {
      if (frozen) return { ok: false, code: 'frozen' };
      const doc = readDoc();
      const seq = seqOfId(id);
      const rec = seq === null ? undefined : doc.profiles.find((r) => r.seq === seq);
      if (!rec) return { ok: false, code: 'unknown' };
      if (!mayManage(doc)) return { ok: false, code: 'parent_gate' };
      const view = viewsOf(doc).find((v) => v.id === id) as ProfileView;
      const look = lookStore(rec.seq);
      let runs = 0;
      try {
        for (const game of o.games?.() ?? []) {
          try { runs += look.ns(namespaceOf(game)).get('totals', TotalsSchema, {})['runs'] ?? 0; } catch { /* not a game id */ }
        }
      } catch { /* a list of games that cannot be read is no reason to refuse */ }
      const action = rec.seq === 1 ? 'reset' : 'delete';
      const expiresAt = now() + REMOVAL_VALID_MS;
      tokens += 1;
      const token = `rm${tokens}-${now().toString(36)}`;
      pending = { token, seq: rec.seq, action, expiresAt };
      return {
        ok: true, action, token, expiresAt,
        summary: { id, name: view.name, kid: view.kid, owner: view.owner, createdAt: view.createdAt, lastUsedAt: view.lastUsedAt, runs, keys: look.size() },
      };
    },

    remove(id, token) {
      if (frozen) return { ok: false, code: 'frozen' };
      const doc = readDoc();
      const seq = seqOfId(id);
      const rec = seq === null ? undefined : doc.profiles.find((r) => r.seq === seq);
      if (!rec) return { ok: false, code: 'unknown' };
      if (!mayManage(doc)) return { ok: false, code: 'parent_gate' };
      const ask = pending;
      if (!ask || typeof token !== 'string' || ask.token !== token || ask.seq !== rec.seq || now() > ask.expiresAt) return { ok: false, code: 'confirm_required' };
      pending = null;
      const wasActive = activeViewOf(doc).id === id;
      if (rec.seq === 1) {
        // The owner stays; what is theirs goes. The marker of the live site's import stays too, or the old record would come back.
        maintenance(1, ['core']).clearAll();
        rec.lastUsedAt = null;
        write(doc);
        emit('updated', id);
        return { ok: true, action: 'reset', active: activeViewOf(doc).id };
      }
      maintenance(rec.seq).clearAll();
      doc.profiles = doc.profiles.filter((r) => r.seq !== rec.seq);
      if (doc.active === rec.seq) doc.active = 1;
      if (current === rec.seq) current = 1;
      write(doc);
      spaces.delete(rec.seq);
      stores.delete(rec.seq);
      looks.delete(rec.seq);
      emit('removed', id);
      if (wasActive) emit('switched', OWNER_ID, 'removed');
      return { ok: true, action: 'delete', active: activeViewOf(doc).id };
    },

    peek(id) {
      const seq = seqOfId(id);
      const view = seq === null ? null : viewById(id);
      return seq !== null && view ? { profile: view, store: lookStore(seq) } : null;
    },

    family(game, which = {}) {
      const doc = readDoc();
      let ns: string;
      try { ns = namespaceOf(game); lookStore(1).ns(ns); } catch { return []; }
      const out = viewsOf(doc).map((v): FamilyEntry => {
        const look = lookStore(seqOfId(v.id) as number);
        let best = 0;
        try { best = createProgress(look, look.ns(ns), { achievements: [] }).best(which.variant, which.difficulty); } catch { best = 0; }
        return { id: v.id, name: v.name, avatar: v.avatar, kid: v.kid, state: v.state, active: v.active, best };
      });
      return out.map((e, i) => ({ e, i })).sort((a, b) => b.e.best - a.e.best || a.i - b.i).map((x) => x.e);
    },

    online: () => activeViewOf(readDoc()).rules.online,

    refresh() {
      if (disposed) return;
      const doc = peekDoc();
      if (!doc) { ensure(); emit('refreshed', null); return; }
      const before = lastSignature;
      const s = settle(doc);
      if (s.reason) { emit('switched', OWNER_ID, s.reason); return; }
      if (signature(doc) !== before) emit('refreshed', null);
    },

    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    dispose() {
      disposed = true;
      listeners.clear();
      try { unwatch?.(); } catch { /* nothing to stop */ }
    },
  };
  try {
    const stop = o.watch?.(() => book.refresh());
    unwatch = typeof stop === 'function' ? stop : null;
  } catch { /* a watcher that cannot be set up leaves refresh() to the interface */ }
  return book;
}

// ───────────────────────── the online identity follows the profile ─────────────────────────

/** What of the social client this module needs: the client's own open() and close(). */
export interface OnlinePort {
  open(): unknown;
  close(): unknown;
}

/**
 * Keeps the social client connected exactly while a profile with the online identity is the one playing: open() when the owner
 * becomes the active profile, close() when a kid's (or any other) profile does. Called once straight away, so a client that was
 * already connected is closed when the app starts in a kid's profile. Nothing it calls may throw into the app.
 */
export function watchOnline(book: Pick<ProfileBook, 'online' | 'onChange'>, port: OnlinePort): Unsubscribe {
  let on: boolean | null = null;
  const apply = (): void => {
    let want = false;
    try { want = book.online(); } catch { want = false; }
    if (want === on) return;
    on = want;
    try {
      const r = (want ? port.open() : port.close()) as { catch?: (f: () => void) => unknown } | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => undefined);
    } catch { /* the client reports its own problems */ }
  };
  apply();
  return book.onChange(apply);
}
