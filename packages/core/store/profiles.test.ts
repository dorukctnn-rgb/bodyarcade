// The family's profiles. Every rule has its test here: the list and where it comes from (a fresh device, the one-player version, a
// lost or newer list), capacity by plan, locking when a plan ends (read-only, nothing deleted), switching without mixing a key,
// kid profiles, the online identity that only the owner has, deleting with a confirmation, and what two tabs do to each other.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Entitlement } from '../types/index.ts';
import { canUse } from '../entitlements/features.ts';
import { entitlementFor } from '../entitlements/plans.ts';
import type { ArcadeGame } from './arcade.ts';
import {
  AVATARS, MAX_PROFILES, NAME_MAX, REMOVAL_VALID_MS, TOUCH_EVERY_MS, createProfileBook, defaultsFor, normalizeName, rulesFor, watchOnline,
  type ProfileEvent, type ProfileSpace,
} from './profiles.ts';
import { createProgress } from './progress.ts';
import { createStore, memoryStorage, type BodyArcadeStore, type StoreProblem } from './store.ts';
import { FakeSyncServer } from './testkit.ts';

const dir = fileURLToPath(new URL('../../games/', import.meta.url));
const GAMES: ArcadeGame[] = readdirSync(dir)
  .filter((d) => existsSync(`${dir}${d}/manifest.json`))
  .map((d) => JSON.parse(readFileSync(`${dir}${d}/manifest.json`, 'utf8')) as ArcadeGame);
const GAME = GAMES.find((g) => g.free)?.id as string;

type PlanKey = 'free' | 'pro' | 'lifetime' | 'family' | 'founder';
const FREE: Entitlement = { plan: 'free', source: 'none' };
const ENTITLEMENT: Record<PlanKey, Entitlement> = {
  free: FREE,
  pro: entitlementFor('pro-yearly', 'gumroad'),
  lifetime: entitlementFor('lifetime', 'gumroad'),
  family: entitlementFor('family-yearly', 'gumroad'),
  founder: entitlementFor('founder', 'gumroad'),
};

interface RigOptions {
  plan?: PlanKey;
  storage?: ReturnType<typeof memoryStorage>;
  known?: boolean;
  random?: () => number;
  /** Pages on one storage share the clock, as they share the device's. */
  clock?: { t: number };
}

function rig(o: RigOptions = {}) {
  const storage = o.storage ?? memoryStorage();
  const clock = o.clock ?? { t: Date.UTC(2026, 9, 24, 12, 0, 0) };
  const state = { plan: o.plan ?? 'free', known: o.known ?? true };
  const problems: StoreProblem[] = [];
  const store = createStore({ storage, now: () => clock.t, timeZone: 'UTC', onProblem: (x) => problems.push(x) });
  const watchers = new Set<() => void>();
  const book = createProfileBook({
    store,
    can: (f) => canUse(f, ENTITLEMENT[state.plan], { isFreeGame: (id) => GAMES.find((g) => g.id === id)?.free === true }),
    known: () => state.known,
    watch: (refresh) => { watchers.add(refresh); return () => { watchers.delete(refresh); }; },
    ownerName: 'Ayşe',
    recoveredName: (n) => `Profil ${n}`,
    games: () => GAMES.map((g) => g.id),
    ...(o.random ? { random: o.random } : {}),
  });
  const events: ProfileEvent[] = [];
  book.onChange((e) => events.push(e));
  return {
    book, storage, store, clock, problems, events, state, watchers,
    /** The plan changed: the entitlements tell the book. */
    setPlan(plan: PlanKey) { state.plan = plan; for (const w of [...watchers]) w(); },
    /** Another page on the same storage (a reload, a second tab). */
    page(extra: Partial<RigOptions> = {}) { return rig({ ...o, storage, clock, plan: state.plan, ...extra }); },
  };
}
type Rig = ReturnType<typeof rig>;

/** Opens the parent gate the way a parent does. */
function passGate(r: Rig): void {
  const asked = r.book.gate.ask();
  if (!asked.ok) throw new Error('the gate is closed for guessing');
  const res = r.book.gate.answer(asked.question.id, asked.question.a * asked.question.b);
  if (!res.ok) throw new Error('the gate did not open');
}

/** Switches the way a person does: by a tap, and through the parent gate when the profile asks for it. */
function go(r: Rig, id: string): ProfileSpace {
  let res = r.book.switchTo(id);
  if (!res.ok && res.code === 'parent_gate') { passGate(r); res = r.book.switchTo(id); }
  if (!res.ok) throw new Error(`could not switch to ${id}: ${res.code}`);
  return res.space;
}

const ANY = { version: 1, parse: (x: unknown) => x };
const round = (over: Partial<{ score: number; seconds: number; variant: string; difficulty: string }> = {}) => ({ score: 800, seconds: 200, complete: true, variant: 'standard', difficulty: 'normal', ...over });
const keysUnder = (r: Rig, prefix: string): string[] => Object.keys(r.storage.dump()).filter((k) => k.startsWith(`${prefix}.`)).sort();
const withoutList = (dump: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(dump).filter(([k]) => !k.startsWith('ba2.profiles.')));
const arcadeOf = (space: ProfileSpace, server?: FakeSyncServer) => space.arcade({ games: () => GAMES, ...(server ? { syncPort: () => server.port() } : {}) });
const bestIn = (store: BodyArcadeStore): number => createProgress(store, store.ns(GAME), { achievements: [] }).best();
const must = <T>(x: T | null | undefined): T => { if (x === null || x === undefined) throw new Error('expected a value'); return x; };
const created = (res: ReturnType<Rig['book']['create']>): string => { if (!res.ok) throw new Error(`create said ${res.code}`); return res.profile.id; };

/** A family device: the Family plan, the owner (p1), a kid (p2) and a grown-up (p3). */
function family(o: RigOptions = {}) {
  const r = rig({ plan: 'family', ...o });
  const kid = created(r.book.create({ name: 'Defne', kid: true, avatar: 'owl' }));
  const adult = created(r.book.create({ name: 'Emre', avatar: 'bear' }));
  return { ...r, kid, adult };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('names', () => {
  it('are kept as a person would write them: normalised, single spaces, at most twenty letters', () => {
    expect(normalizeName('  Ayşe   Nur ')).toEqual({ ok: true, name: 'Ayşe Nur' });
    expect(normalizeName('é'.repeat(NAME_MAX))).toMatchObject({ ok: true });
    expect(normalizeName('é'.repeat(NAME_MAX + 1))).toEqual({ ok: false, code: 'name_long' });
    for (const ok of ['Zoë', 'Mary-Jane', "O'Neil", 'Li Wei', 'İlker', 'Jean-Luc 2', '7', 'Ünal', 'Åsa', 'Дмитрий', '李雷']) expect(normalizeName(ok), ok).toMatchObject({ ok: true });
  });

  it('are refused when empty, too long, or made of anything but letters, digits, space and . \' - _', () => {
    for (const empty of ['', '   ', '\n\t', undefined, null, 5, {}, []]) expect(normalizeName(empty), String(empty)).toEqual({ ok: false, code: 'name_empty' });
    expect(normalizeName('a'.repeat(NAME_MAX + 1))).toEqual({ ok: false, code: 'name_long' });
    for (const bad of ['<b>x</b>', 'name!', 'a/b', '-leading', '.dot', 'smile \u{1F600}', 'a​b', 'a\u0007b', 'x@y', 'a\\b', '\u{1F600}']) {
      expect(normalizeName(bad), JSON.stringify(bad)).toEqual({ ok: false, code: 'name_chars' });
    }
  });
});

describe('what a profile may do (rules)', () => {
  it('the owner may do everything', () => {
    expect(rulesFor({ owner: true, kid: false, locked: false })).toEqual({
      record: true, online: true, purchase: 'open', autoPaywall: true, calories: true, ghosts: 'all', freeText: true, share: true,
    });
  });

  it('a grown-up who is not the owner plays and shops, but has no online identity: nothing of it reaches a server', () => {
    expect(rulesFor({ owner: false, kid: false, locked: false })).toEqual({
      record: true, online: false, purchase: 'open', autoPaywall: true, calories: true, ghosts: 'family', freeText: false, share: true,
    });
  });

  it('a kid has no online identity, no purchase without the parent gate, no calories, no sharing, no free text, family ghosts only', () => {
    expect(rulesFor({ owner: false, kid: true, locked: false })).toEqual({
      record: true, online: false, purchase: 'parent_gate', autoPaywall: false, calories: false, ghosts: 'family', freeText: false, share: false,
    });
  });

  it('a locked profile records nothing and is not online', () => {
    for (const kid of [true, false]) expect(rulesFor({ owner: false, kid, locked: true })).toMatchObject({ record: false, online: false });
  });

  it('a kid starts quiet, gentle, without a weight, on the kids break; a grown-up starts as asked', () => {
    expect(defaultsFor({ kid: true, seated: false })).toEqual({ seated: false, quiet: true, level: 'gentle', weightKg: null, plan: 'kids-break' });
    expect(defaultsFor({ kid: true, seated: true })).toMatchObject({ seated: true, quiet: true });
    expect(defaultsFor({ kid: false, seated: true })).toEqual({ seated: true });
    expect(defaultsFor({ kid: false, seated: false })).toEqual({ seated: false });
  });
});

describe('the list at the start', () => {
  it('makes the owner on a fresh device, and keeps nothing else', () => {
    const r = rig();
    expect(r.book.migration).toEqual({ kind: 'fresh', adopted: [] });
    expect(r.book.list()).toEqual([expect.objectContaining({
      id: 'p1', name: 'Ayşe', owner: true, kid: false, avatar: 'fox', state: 'ready', active: true, seated: false, createdAt: r.clock.t, lastUsedAt: null,
    })]);
    expect(r.book.active().id).toBe('p1');
    expect(r.book.needsPicker()).toBe(false);
    expect(Object.keys(r.storage.dump())).toEqual(['ba2.profiles.book']);
    expect(r.book.registryKey).toBe('ba2.profiles.book');
  });

  it('turns the record of the one-player version into the owner\'s where it stands: not one key moves, the entitlements are untouched', () => {
    const seeded = {
      'ba2.runner.runs': '{"v":1,"d":[]}', 'ba2.runner.totals': '{"v":1,"d":{"runs":4}}', 'ba2.shell.settings': '{"v":1,"d":{"sound":false}}',
      'ba2.habit.active': '{"v":1,"d":{}}', 'ba2.entitlements.did': '{"v":1,"d":"0123456789abcdef0123456789abcdef"}',
    };
    const r = rig({ storage: memoryStorage(seeded) });
    expect(r.book.migration).toEqual({ kind: 'single', adopted: [] });
    expect(r.storage.dump()).toEqual({ ...seeded, 'ba2.profiles.book': expect.any(String) });
    const owner = r.book.open();
    expect(owner.store.size()).toBe(4);                                   // theirs: everything except the device's entitlements
    expect(owner.store.ns('runner').get('totals', ANY, null)).toEqual({ runs: 4 });
    expect(() => owner.store.ns('entitlements')).toThrow(RangeError);
  });

  it('is the same on the next page: nothing is made twice', () => {
    const r = rig({ plan: 'family' });
    expect(r.book.create({ name: 'Defne', kid: true }).ok).toBe(true);
    const before = r.storage.dump();
    const again = r.page();
    expect(again.book.migration).toEqual({ kind: 'existing', adopted: [] });
    expect(again.book.list().map((v) => v.id)).toEqual(['p1', 'p2']);
    expect(again.storage.dump()).toEqual(before);
  });

  it('takes back the profiles still in storage when the list is lost, as kid profiles (the cautious reading), and loses none of their records', () => {
    const seeded = {
      'ba2.profiles.book': '{this is not json', 'ba2.runner.totals': '{"v":1,"d":{"runs":9}}',
      'ba2p2.runner.totals': '{"v":1,"d":{"runs":2}}', 'ba2p4.habit.active': '{"v":1,"d":{}}', 'ba2p4.shell.settings': '{"v":1,"d":{}}',
    };
    const r = rig({ plan: 'family', storage: memoryStorage(seeded) });
    expect(r.book.migration).toEqual({ kind: 'recovered', adopted: ['p2', 'p4'] });
    expect(r.book.list().map((v) => [v.id, v.name, v.kid, v.owner])).toEqual([['p1', 'Ayşe', false, true], ['p2', 'Profil 2', true, false], ['p4', 'Profil 4', true, false]]);
    for (const [k, v] of Object.entries(seeded)) if (!k.includes('profiles')) expect(r.storage.getItem(k), k).toBe(v);
    expect(r.book.create({ name: 'Yeni' })).toMatchObject({ ok: true, profile: { id: 'p5' } });   // a number that was ever used is not used again
  });

  it('takes back at most six profiles in all, and leaves the rest where they are, never deleted', () => {
    const seeded: Record<string, string> = { 'ba2.profiles.book': '[1,2,3]' };
    for (const n of [2, 3, 4, 5, 6, 7, 8]) seeded[`ba2p${n}.runner.totals`] = '{"v":1,"d":{}}';
    const r = rig({ plan: 'family', storage: memoryStorage(seeded) });
    expect(r.book.list().map((v) => v.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(r.storage.getItem('ba2p7.runner.totals')).not.toBeNull();
    expect(r.storage.getItem('ba2p8.runner.totals')).not.toBeNull();
  });

  it('a list without the owner is not a list: it is rebuilt from storage, owner first', () => {
    const noOwner = JSON.stringify({ v: 1, d: { seq: 2, active: 2, profiles: [{ seq: 2, name: 'Defne', avatar: 'owl', kid: true, seated: false, createdAt: 1, lastUsedAt: null }] } });
    const r = rig({ plan: 'family', storage: memoryStorage({ 'ba2.profiles.book': noOwner, 'ba2p2.runner.totals': '{"v":1,"d":{}}' }) });
    expect(r.book.list().map((v) => v.id)).toEqual(['p1', 'p2']);
    expect(r.book.active().id).toBe('p1');
    expect(r.book.migration.kind).toBe('recovered');
  });

  it('repairs a damaged record field by field: the cautious reading, a name that is not a name, a picture that is not one', () => {
    const broken = JSON.stringify({
      v: 1, d: {
        seq: 3, active: 9, askOnStart: 'yes',
        profiles: [
          { seq: 1, name: 'Ayşe', avatar: 'fox', kid: false, seated: false, createdAt: 5, lastUsedAt: null },
          { seq: 2, name: 'x'.repeat(200), avatar: 'dragon', kid: 'no', seated: 7, createdAt: 'then', lastUsedAt: 'now' },
          { seq: 2, name: 'Duplicate', avatar: 'owl', kid: false, seated: false, createdAt: 5, lastUsedAt: null },
          { seq: 'three', name: 'Lost' },
          'junk',
        ],
      },
    });
    const r = rig({ plan: 'family', storage: memoryStorage({ 'ba2.profiles.book': broken }) });
    expect(r.book.list()).toEqual([
      expect.objectContaining({ id: 'p1', name: 'Ayşe', owner: true, active: true }),
      expect.objectContaining({ id: 'p2', name: 'Profil 2', avatar: 'fox', kid: true, seated: false, createdAt: 0, lastUsedAt: null }),
    ]);
    expect(r.book.needsPicker()).toBe(true);                              // a damaged flag is the default: ask who is playing
  });

  it('never reads the owner as a kid, whatever the list says: that would only take their online identity away', () => {
    const damaged = JSON.stringify({ v: 1, d: { seq: 1, active: 1, profiles: [{ seq: 1, name: 'Ayşe', avatar: 'fox', kid: 'maybe', seated: false, createdAt: 5, lastUsedAt: null }] } });
    for (const kid of ['maybe', true]) {
      const r = rig({ plan: 'family', storage: memoryStorage({ 'ba2.profiles.book': damaged.replace('"maybe"', JSON.stringify(kid)) }) });
      expect(r.book.get('p1'), String(kid)).toMatchObject({ kid: false, rules: { online: true, purchase: 'open' } });
      expect(r.book.online()).toBe(true);
    }
  });

  it('leaves a list written by a newer version exactly as it is, shows the owner alone, and changes nothing', () => {
    const newer = '{"v":2,"d":{"profiles":"a shape this version does not know"}}';
    const r = rig({ plan: 'family', storage: memoryStorage({ 'ba2.profiles.book': newer, 'ba2.runner.totals': '{"v":1,"d":{"runs":3}}' }) });
    const before = JSON.stringify(r.storage.dump());
    expect(r.book.frozen).toBe(true);
    expect(r.book.migration).toEqual({ kind: 'frozen', adopted: [] });
    expect(r.book.list().map((v) => v.id)).toEqual(['p1']);
    expect(r.book.create({ name: 'Defne' })).toEqual({ ok: false, code: 'frozen' });
    expect(r.book.update('p1', { name: 'Zeynep' })).toEqual({ ok: false, code: 'frozen' });
    expect(r.book.planRemoval('p1')).toEqual({ ok: false, code: 'frozen' });
    expect(r.book.remove('p1', 'x')).toEqual({ ok: false, code: 'frozen' });
    expect(r.book.setAskOnStart(false)).toEqual({ ok: false, code: 'frozen' });
    expect(r.book.switchTo('p1')).toMatchObject({ ok: true, changed: false });
    r.book.refresh();
    r.book.open();
    expect(JSON.stringify(r.storage.dump())).toBe(before);
    expect(arcadeOf(r.book.open()).recordRun(GAME, round()).outcome.saved).toBe(true);   // and the owner still plays
    expect(r.storage.getItem('ba2.profiles.book')).toBe(newer);
  });

  it('says whether it will survive the page: not in a private window', () => {
    expect(createProfileBook({ can: () => false }).persistent).toBe(createStore({}).persistent);
    expect(rig().book.persistent).toBe(true);
  });
});

describe('how many profiles the plan allows', () => {
  const cases: [PlanKey, number][] = [['free', 1], ['pro', 1], ['lifetime', 1], ['family', MAX_PROFILES], ['founder', MAX_PROFILES]];
  for (const [plan, max] of cases) {
    it(`${plan}: ${max}`, () => {
      const r = rig({ plan });
      expect(r.book.capacity()).toEqual({ max, used: 1, ready: 1, canAdd: max > 1, why: max > 1 ? null : 'plan' });
    });
  }

  it('a free player, a Pro player and a lifetime buyer cannot add a profile, and are told what would let them: the plan', () => {
    for (const plan of ['free', 'pro', 'lifetime'] as const) {
      const r = rig({ plan });
      expect(r.book.create({ name: 'Defne' }), plan).toEqual({ ok: false, code: 'plan' });
      expect(r.book.list()).toHaveLength(1);
    }
  });

  it('the Family plan and a Founder fill six, and the seventh is refused as full, not as a matter of plan', () => {
    for (const plan of ['family', 'founder'] as const) {
      const r = rig({ plan });
      for (let i = 2; i <= MAX_PROFILES; i++) expect(r.book.create({ name: `Kişi ${i}` }), `${plan} ${i}`).toMatchObject({ ok: true, profile: { id: `p${i}` } });
      expect(r.book.capacity()).toEqual({ max: 6, used: 6, ready: 6, canAdd: false, why: 'full' });
      expect(r.book.create({ name: 'Yedinci' })).toEqual({ ok: false, code: 'full' });
    }
  });

  it('is asked of the entitlements every time: a plan bought later opens the room at once', () => {
    const r = rig({ plan: 'free' });
    expect(r.book.create({ name: 'Defne' })).toEqual({ ok: false, code: 'plan' });
    r.setPlan('family');
    expect(r.book.create({ name: 'Defne' })).toMatchObject({ ok: true });
  });

  it('survives an entitlements function that throws: that is no plan', () => {
    const book = createProfileBook({ store: createStore({ storage: memoryStorage() }), can: () => { throw new Error('no entitlements yet'); } });
    expect(book.capacity().max).toBe(1);
  });
});

describe('creating a profile', () => {
  it('gives it the next number, a picture nobody uses, and a place of its own in storage', () => {
    const r = rig({ plan: 'family' });
    expect(r.book.create({ name: '  Defne ', kid: true, seated: true })).toMatchObject({
      ok: true, profile: { id: 'p2', name: 'Defne', avatar: 'owl', kid: true, seated: true, owner: false, active: false, state: 'ready' },
    });
    expect(r.book.create({ name: 'Emre' })).toMatchObject({ ok: true, profile: { id: 'p3', avatar: 'bear' } });
    expect(r.events.map((e) => [e.kind, e.id])).toEqual([['created', 'p2'], ['created', 'p3']]);
    expect(r.book.list().map((v) => v.active)).toEqual([true, false, false]);   // it does not move the player
    expect(AVATARS).toContain('owl');
  });

  it('refuses a name that is empty, too long, odd, or already used (capitals, accents and the Turkish dotless i do not make a new name)', () => {
    const r = rig({ plan: 'family' });
    expect(r.book.create({ name: '' })).toEqual({ ok: false, code: 'name_empty' });
    expect(r.book.create({ name: 'x'.repeat(NAME_MAX + 1) })).toEqual({ ok: false, code: 'name_long' });
    expect(r.book.create({ name: 'a<b' })).toEqual({ ok: false, code: 'name_chars' });
    for (const twin of ['Ayşe', 'ayşe', 'AYŞE', 'Ayse', 'AYSE', ' ayse ']) expect(r.book.create({ name: twin }), twin).toEqual({ ok: false, code: 'name_taken' });
    expect(r.book.create({ name: 'ılgaz' })).toMatchObject({ ok: true });
    expect(r.book.create({ name: 'Ilgaz' })).toEqual({ ok: false, code: 'name_taken' });
    expect(r.book.list()).toHaveLength(2);
  });

  it('refuses a picture that is not one, and takes no garbage in place of the form', () => {
    const r = rig({ plan: 'family' });
    expect(r.book.create({ name: 'Defne', avatar: 'dragon' as never })).toEqual({ ok: false, code: 'avatar' });
    for (const junk of [undefined, null, 5, 'Defne', []]) expect(r.book.create(junk as never), String(junk)).toEqual({ ok: false, code: 'name_empty' });
    expect(r.book.list()).toHaveLength(1);
  });

  it('never uses a number twice: a profile made after another was deleted gets a new id and a new place', () => {
    const r = family();
    const plan = r.book.planRemoval(r.kid);
    expect(plan.ok).toBe(true);
    expect(r.book.remove(r.kid, (plan as { token: string }).token)).toMatchObject({ ok: true, action: 'delete' });
    expect(r.book.create({ name: 'Zeynep' })).toMatchObject({ ok: true, profile: { id: 'p4' } });
    expect(r.book.list().map((v) => v.id)).toEqual(['p1', 'p3', 'p4']);
  });

  it('wipes whatever is lying where the new profile will keep its record (a tab that wrote after a deletion)', () => {
    const r = rig({ plan: 'family' });
    r.book.create({ name: 'Defne' });
    r.storage.setItem('ba2p3.runner.totals', '{"v":1,"d":{"runs":99}}');
    r.storage.setItem('ba2p3.shell.settings', '{"v":1,"d":{}}');
    expect(r.book.create({ name: 'Emre' })).toMatchObject({ ok: true, profile: { id: 'p3' } });
    expect(keysUnder(r, 'ba2p3')).toEqual([]);
  });

  it('wants the owner, or the parent gate: a kid, or a grown-up who is not the owner, cannot add profiles by tapping', () => {
    const r = family();
    go(r, r.kid);
    expect(r.book.create({ name: 'Yeni' })).toEqual({ ok: false, code: 'parent_gate' });
    go(r, r.adult);
    expect(r.book.create({ name: 'Yeni' })).toEqual({ ok: false, code: 'parent_gate' });
    passGate(r);
    expect(r.book.create({ name: 'Yeni' })).toMatchObject({ ok: true, profile: { id: 'p4' } });
  });

  it('stops at the last number', () => {
    const stored = JSON.stringify({ v: 1, d: { seq: 999, active: 1, askOnStart: true, cap: 6, profiles: [{ seq: 1, name: 'Ayşe', avatar: 'fox', kid: false, seated: false, createdAt: 1, lastUsedAt: null }] } });
    const r = rig({ plan: 'family', storage: memoryStorage({ 'ba2.profiles.book': stored }) });
    expect(r.book.create({ name: 'Defne' })).toEqual({ ok: false, code: 'exhausted' });
  });
});

describe('switching', () => {
  it('moves the player, remembers it for the next page, and tells everybody', () => {
    const r = family();
    r.clock.t += 5000;
    expect(r.book.switchTo(r.kid)).toMatchObject({ ok: true, changed: true, space: { id: r.kid } });
    expect(r.book.active()).toMatchObject({ id: r.kid, lastUsedAt: r.clock.t, active: true });
    expect(r.book.list().filter((v) => v.active).map((v) => v.id)).toEqual([r.kid]);
    expect(r.events.at(-1)).toEqual({ kind: 'switched', id: r.kid, active: r.kid, online: false, guarded: false });
    expect(r.page().book.open().id).toBe(r.kid);
  });

  it('is nothing at all when the profile is the one playing', () => {
    const r = family();
    const before = r.events.length;
    expect(r.book.switchTo('p1')).toMatchObject({ ok: true, changed: false });
    expect(r.events).toHaveLength(before);
  });

  it('does not know a profile that is not in the list', () => {
    const r = family();
    for (const id of ['p9', 'p0', 'x', '', 'P2', 'p02', null, 2, undefined]) expect(r.book.switchTo(id as never), String(id)).toEqual({ ok: false, code: 'unknown' });
  });

  it('a kid does not leave a kid\'s profile for a grown-up\'s without the parent gate; everything else goes by a tap', () => {
    const r = family();
    r.book.switchTo(r.kid);
    expect(r.book.switchTo('p1')).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.switchTo(r.adult)).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.active().id).toBe(r.kid);
    passGate(r);
    expect(r.book.switchTo(r.adult)).toMatchObject({ ok: true, changed: true });
    expect(r.book.gate.isOpen()).toBe(false);                             // it closes behind a switch: the next profile starts shut
    expect(r.book.switchTo(r.kid)).toMatchObject({ ok: true });           // a grown-up goes to a kid by a tap
    expect(r.book.switchTo('p1')).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.switchTo(r.kid)).toMatchObject({ ok: true, changed: false });
  });

  it('a kid goes to another kid by a tap', () => {
    const r = family();
    r.book.create({ name: 'Mert', kid: true });
    r.book.switchTo(r.kid);
    expect(r.book.switchTo('p4')).toMatchObject({ ok: true, changed: true });
  });

  it('asks who is playing when two profiles can be played and the owner wants it asked', () => {
    const r = family();
    expect(r.book.needsPicker()).toBe(true);
    expect(r.book.setAskOnStart(false)).toEqual({ ok: true });
    expect(r.book.needsPicker()).toBe(false);
    expect(r.page().book.needsPicker()).toBe(false);
    expect(r.book.setAskOnStart(true)).toEqual({ ok: true });
    expect(r.book.needsPicker()).toBe(true);
    expect(rig({ plan: 'family' }).book.needsPicker()).toBe(false);       // one profile: nobody to ask
  });

  it('only the owner, or a parent at the gate, changes that', () => {
    const r = family();
    r.book.switchTo(r.kid);
    expect(r.book.setAskOnStart(false)).toEqual({ ok: false, code: 'parent_gate' });
    passGate(r);
    expect(r.book.setAskOnStart(false)).toEqual({ ok: true });
  });

  it('the space it hands out is the same one every time, and says who is playing', () => {
    const r = family();
    const a = go(r, r.adult);
    expect(go(r, r.kid).current()).toBe(true);
    expect(a.current()).toBe(false);
    expect(go(r, r.adult)).toBe(a);
    expect(r.book.open()).toBe(a);
  });
});

describe('the picker, in one read', () => {
  it('says what the screen shows for each plan and who is playing', () => {
    const free = rig({ plan: 'free' });
    expect(free.book.picker()).toEqual({
      ask: false, guarded: false, cards: free.book.list(), add: { show: true, why: 'plan' }, manage: true, askOnStart: true, notice: null,
    });
    const r = rig({ plan: 'family' });
    expect(r.book.picker()).toMatchObject({ ask: false, add: { show: true, why: null }, manage: true });
    for (let i = 2; i <= 6; i++) r.book.create({ name: `Kişi ${i}`, kid: i === 3 });
    expect(r.book.picker()).toMatchObject({ ask: true, add: { show: false, why: 'full' }, manage: true });
    expect(r.book.picker().cards.map((c) => c.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('asks for the parent gate before the profiles are changed from the profile of a kid, and not after it', () => {
    const r = family();
    go(r, r.kid);
    expect(r.book.picker().manage).toBe(false);
    passGate(r);
    expect(r.book.picker().manage).toBe(true);
  });

  it('shows locked cards and the Family plan offer when the plan has ended', () => {
    const r = family();
    r.setPlan('free');
    const model = r.book.picker();
    expect(model).toMatchObject({ ask: false, add: { show: true, why: 'plan' } });
    expect(model.cards.map((c) => c.state)).toEqual(['ready', 'locked', 'locked']);
  });

  it('has a notice when the list comes from a newer version, and when nothing is kept after the page closes', () => {
    const frozen = rig({ plan: 'family', storage: memoryStorage({ 'ba2.profiles.book': '{"v":2,"d":{"profiles":"?"}}' }) });
    expect(frozen.book.picker()).toMatchObject({ notice: 'frozen', manage: false, add: { show: false } });
    const volatile = createProfileBook({ can: () => true });
    expect(volatile.picker().notice).toBe(volatile.persistent ? null : 'memory');
    expect(volatile.persistent).toBe(false);
  });

  it('remembers that the owner does not want to be asked', () => {
    const r = family();
    r.book.setAskOnStart(false);
    expect(r.book.picker()).toMatchObject({ ask: false, askOnStart: false });
  });
});

describe('records that never mix', () => {
  it('six profiles write the same keys and read back their own, and every key is under exactly one prefix', () => {
    const r = rig({ plan: 'founder' });
    for (let i = 2; i <= 6; i++) r.book.create({ name: `Kişi ${i}` });
    const players = r.book.list().map((v) => { const space = go(r, v.id); return { id: v.id, space, arcade: arcadeOf(space) }; });
    for (const [i, a] of players.entries()) {
      a.arcade.recordRun(GAME, round({ score: 100 * (i + 1), seconds: 100 * (i + 1) }));
      a.space.store.ns('shell').set('settings', { who: a.id }, ANY);
    }
    for (const [i, a] of players.entries()) {
      expect(a.arcade.progress(GAME).best('standard', 'normal'), a.id).toBe(100 * (i + 1));
      expect(a.arcade.progress(GAME).runs(), a.id).toHaveLength(1);
      expect(a.space.store.ns('shell').get('settings', ANY, null), a.id).toEqual({ who: a.id });
      expect(a.arcade.habit.view().todaySeconds, a.id).toBe(100 * (i + 1));
    }
    const prefixes = new Set(Object.keys(withoutList(r.storage.dump())).map((k) => k.split('.')[0]));
    expect([...prefixes].sort()).toEqual(['ba2', 'ba2p2', 'ba2p3', 'ba2p4', 'ba2p5', 'ba2p6']);
    for (const a of players) expect(keysUnder(r, a.id === 'p1' ? 'ba2' : `ba2p${a.id.slice(1)}`).length, a.id).toBeGreaterThanOrEqual(3);
  });

  it('the streak, the daily challenge and the workout plans are each profile\'s own', () => {
    const r = family();
    const ownerArcade = arcadeOf(r.book.open());
    ownerArcade.recordRun(GAME, round({ seconds: 400 }));
    expect(ownerArcade.habit.view()).toMatchObject({ todayActive: true, dayStreak: 1 });
    expect(ownerArcade.plans.start('desk-break').ok).toBe(true);
    const kidArcade = arcadeOf(go(r, r.kid));
    expect(kidArcade.habit.view()).toMatchObject({ todayActive: false, dayStreak: 0, todaySeconds: 0 });
    expect(kidArcade.plans.active()).toBeNull();
    expect(kidArcade.progress(GAME).runs()).toEqual([]);
    kidArcade.recordRun(GAME, round({ score: 50, seconds: 10 }));
    expect(ownerArcade.progress(GAME).best('standard', 'normal')).toBe(800);
    expect(ownerArcade.habit.view().todaySeconds).toBe(400);
    expect(ownerArcade.plans.active()).not.toBeNull();
  });

  it('a profile\'s store does not open the device\'s namespaces, and the device\'s store opens nothing else', () => {
    const r = family();
    for (const v of r.book.list()) {
      const space = go(r, v.id);
      expect(() => space.store.ns('entitlements'), v.id).toThrow(RangeError);
      expect(() => space.store.ns('profiles'), v.id).toThrow(RangeError);
    }
    expect(() => r.book.device.ns('runner')).toThrow(RangeError);
    expect(() => r.book.device.ns('shell')).toThrow(RangeError);
    expect(() => r.book.device.ns('entitlements')).not.toThrow();
  });

  it('wiping the owner\'s store leaves what was bought, the list and every other profile', () => {
    const r = family();
    r.book.device.ns('entitlements').set('did', '0123456789abcdef0123456789abcdef');
    const owner = r.book.open();
    arcadeOf(owner).recordRun(GAME, round());
    arcadeOf(go(r, r.kid)).recordRun(GAME, round());
    const kidKeys = keysUnder(r, 'ba2p2');
    expect(owner.store.clearAll()).toBeGreaterThan(0);
    expect(keysUnder(r, 'ba2').filter((k) => !k.startsWith('ba2p'))).toEqual(['ba2.entitlements.did', 'ba2.profiles.book']);
    expect(keysUnder(r, 'ba2p2')).toEqual(kidKeys);
  });

  it('a space built earlier keeps writing to its own record after the player moved on, never to the new one', () => {
    const r = family();
    const owner = r.book.open();
    const ownerArcade = arcadeOf(owner);
    const kidArcade = arcadeOf(go(r, r.kid));
    expect(owner.current()).toBe(false);
    ownerArcade.recordRun(GAME, round({ score: 321 }));
    expect(ownerArcade.progress(GAME).best('standard', 'normal')).toBe(321);
    expect(kidArcade.progress(GAME).best('standard', 'normal')).toBe(0);
    expect(keysUnder(r, 'ba2p2').filter((k) => k.includes(`.${GAME}.`))).toEqual([]);
  });

  it('the next page opens on its own profile and sees only its own record', () => {
    const r = family();
    arcadeOf(r.book.open()).recordRun(GAME, round({ score: 700 }));
    arcadeOf(go(r, r.kid)).recordRun(GAME, round({ score: 40 }));
    const next = r.page();
    expect(next.book.open().id).toBe(r.kid);
    expect(arcadeOf(next.book.open()).progress(GAME).best('standard', 'normal')).toBe(40);
  });

  it('what a profile says about sitting is read live by its arcade\'s plans', () => {
    const r = family();
    const space = r.book.open();
    const arcade = arcadeOf(space);
    const seatedOf = (): boolean => {
      arcade.plans.abandon();
      const res = arcade.plans.start('full-body');
      if (!res.ok) throw new Error(res.code);
      return res.view.run.seated;
    };
    expect(seatedOf()).toBe(false);
    expect(r.book.update('p1', { seated: true })).toMatchObject({ ok: true });
    expect(seatedOf()).toBe(true);
  });
});

describe('when the plan ends', () => {
  function ended() {
    const r = family();
    for (const v of r.book.list()) {
      go(r, v.id);
      arcadeOf(r.book.open()).recordRun(GAME, round({ score: 100 + Number(v.id.slice(1)), seconds: 90 }));
    }
    go(r, 'p1');
    const before = r.storage.dump();
    r.setPlan('free');
    return { ...r, before };
  }

  it('locks every profile beyond the first and deletes nothing: not a key', () => {
    const r = ended();
    expect(r.book.list().map((v) => [v.id, v.state])).toEqual([['p1', 'ready'], ['p2', 'locked'], ['p3', 'locked']]);
    expect(r.book.capacity()).toEqual({ max: 1, used: 3, ready: 1, canAdd: false, why: 'plan' });
    expect(withoutList(r.storage.dump())).toEqual(withoutList(r.before));
  });

  it('is read by the next page the same way, however often it looks', () => {
    const r = ended();
    const keys = Object.keys(r.storage.dump()).length;
    for (let i = 0; i < 10; i++) { r.book.refresh(); r.book.open(); r.page().book.open(); }
    expect(Object.keys(r.storage.dump())).toHaveLength(keys);
    expect(r.page().book.list().map((v) => v.state)).toEqual(['ready', 'locked', 'locked']);
  });

  it('a locked profile cannot be played as or changed, but it can be looked at', () => {
    const r = ended();
    expect(r.book.switchTo('p2')).toEqual({ ok: false, code: 'locked' });
    expect(r.book.update('p2', { name: 'Başka' })).toEqual({ ok: false, code: 'locked' });
    expect(r.book.update('p2', { seated: true })).toEqual({ ok: false, code: 'locked' });
    const look = must(r.book.peek('p2'));
    expect(look.profile.state).toBe('locked');
    expect(bestIn(look.store)).toBe(102);
  });

  it('a handle to a locked profile that was kept refuses every write, and a round through it is answered as not saved', () => {
    const r = family();
    const space = go(r, r.kid);
    const arcade = arcadeOf(space);
    arcade.recordRun(GAME, round({ score: 100 }));
    go(r, 'p1');
    r.setPlan('free');
    const before = withoutList(r.storage.dump());
    expect(space.alive()).toBe(false);
    expect(space.store.readOnly).toBe(true);
    const report = arcade.recordRun(GAME, round({ score: 999 }));
    expect(report.outcome.saved).toBe(false);
    expect(report.play).toBeNull();
    expect(report.challenge).toBeNull();
    expect(arcade.finishPlanStep(round())).toBeNull();
    space.store.ns('shell').set('settings', { hacked: true }, ANY);
    arcade.habit.addPlay(500);
    expect(withoutList(r.storage.dump())).toEqual(before);
    expect(arcade.progress(GAME).best('standard', 'normal')).toBe(100);
    expect(r.problems.some((p) => p.kind === 'rejected')).toBe(true);
  });

  it('puts the player back on the owner when the active profile is locked, writes that down, and does not jump back when the plan returns', () => {
    const r = family();
    r.book.switchTo(r.kid);
    r.events.length = 0;
    r.setPlan('free');
    expect(r.book.active().id).toBe('p1');
    // It was a kid's profile that locked, so the owner's profile waits behind the parent gate (the guard, below): no online identity yet.
    expect(r.events).toEqual([{ kind: 'switched', id: 'p1', active: 'p1', online: false, guarded: true, reason: 'plan' }]);
    expect(r.page().book.open().id).toBe('p1');
    r.setPlan('family');
    expect(r.book.active().id).toBe('p1');
    expect(r.book.list().map((v) => v.state)).toEqual(['ready', 'ready', 'ready']);
    expect(r.book.switchTo(r.kid)).toMatchObject({ ok: true });
  });

  it('puts a grown-up whose profile locked on the owner, without a guard: nobody was a child', () => {
    const r = family();
    go(r, r.adult);
    r.events.length = 0;
    r.setPlan('free');
    expect(r.book.active().id).toBe('p1');
    expect(r.book.guarded).toBe(false);
    expect(r.events).toEqual([{ kind: 'switched', id: 'p1', active: 'p1', online: true, guarded: false, reason: 'plan' }]);
  });

  it('opens a page on the owner when the plan ended while a kid was the one playing, behind the gate', () => {
    const r = family();
    r.book.switchTo(r.kid);
    r.state.plan = 'free';                                                // the entitlements changed while no page was open
    const next = r.page();
    expect(next.book.open().id).toBe('p1');
    expect(next.book.active().id).toBe('p1');
    expect(next.book.guarded).toBe(true);
    expect(next.book.online()).toBe(false);
  });

  it('gives everything back when the plan returns: the records, the states, the right to play and to write', () => {
    const r = ended();
    r.setPlan('family');
    expect(r.book.list().map((v) => v.state)).toEqual(['ready', 'ready', 'ready']);
    const space = go(r, 'p2');
    const arcade = arcadeOf(space);
    expect(arcade.progress(GAME).best('standard', 'normal')).toBe(102);
    expect(arcade.recordRun(GAME, round({ score: 500 })).outcome.saved).toBe(true);
  });

  it('a locked profile still counts: no room is made for a new one until somebody deletes it, with a confirmation', () => {
    const r = ended();
    expect(r.book.create({ name: 'Yeni' })).toEqual({ ok: false, code: 'plan' });
    const plan = r.book.planRemoval('p3');
    expect(plan).toMatchObject({ ok: true, action: 'delete' });
    expect(r.book.remove('p3', (plan as { token: string }).token)).toMatchObject({ ok: true });
    expect(r.book.list().map((v) => v.id)).toEqual(['p1', 'p2']);
    expect(keysUnder(r, 'ba2p3')).toEqual([]);
    expect(keysUnder(r, 'ba2p2').length).toBeGreaterThan(0);              // the other one is still there
  });

  it('while the entitlements are still being read, what the plan allowed last time holds: no lock, no jump to the owner', () => {
    const r = family();
    r.book.switchTo(r.kid);
    const next = r.page({ known: false, plan: 'free' });                  // a page whose entitlements are not read yet (they would say free)
    expect(next.book.list().map((v) => v.state)).toEqual(['ready', 'ready', 'ready']);
    expect(next.book.open().id).toBe(r.kid);
    expect(next.book.active().id).toBe(r.kid);
    next.state.known = true;                                              // now they are read, and the plan really has ended
    next.book.refresh();
    expect(next.book.list().map((v) => v.state)).toEqual(['ready', 'locked', 'locked']);
    expect(next.book.active().id).toBe('p1');
    expect(next.events.at(-1)).toMatchObject({ kind: 'switched', reason: 'plan' });
  });

  it('while the entitlements are unknown after a plan that had ended, the profiles stay locked (what held last time)', () => {
    const r = ended();
    const next = r.page({ known: false, plan: 'family' });                // would say family, but is not to be believed yet
    expect(next.book.list().map((v) => v.state)).toEqual(['ready', 'locked', 'locked']);
    next.state.known = true;
    next.book.refresh();
    expect(next.book.list().map((v) => v.state)).toEqual(['ready', 'ready', 'ready']);
  });
});

describe('kid profiles', () => {
  it('start with the rules and the defaults of a kid, and a grown-up\'s profile has the ones of a grown-up', () => {
    const r = family();
    expect(r.book.get(r.kid)).toMatchObject({ kid: true, rules: rulesFor({ owner: false, kid: true, locked: false }), defaults: defaultsFor({ kid: true, seated: false }) });
    expect(r.book.get(r.adult)).toMatchObject({ kid: false, rules: rulesFor({ owner: false, kid: false, locked: false }) });
    expect(r.book.get('p1')).toMatchObject({ rules: rulesFor({ owner: true, kid: false, locked: false }) });
  });

  it('the owner cannot be made a kid', () => {
    const r = family();
    expect(r.book.update('p1', { kid: true })).toEqual({ ok: false, code: 'owner_kid' });
    expect(r.book.get('p1')?.kid).toBe(false);
  });

  it('cannot use anything that needs the online identity, with or without the Family plan, and the owner can', () => {
    const r = family();
    const features = ['live:ranked', 'friends:list', 'lobby:public', 'rooms:create', 'chat:send', 'board:weekly', 'social:profile', 'quickmatch:any'];
    const owner = r.book.open();
    for (const f of features) expect(owner.can(f), `owner ${f}`).toBe(true);
    for (const id of [r.kid, r.adult]) {
      const space = go(r, id);
      for (const f of features) expect(space.can(f), `${id} ${f}`).toBe(false);
      expect(space.can(`game:${GAME}`), id).toBe(true);
      expect(space.can('plan:kids-break'), id).toBe(true);
      expect(space.can('not a feature'), id).toBe(false);
    }
  });

  it('play locally: rounds, the streak, the daily challenge and the kids break all work', () => {
    const r = family();
    const arcade = arcadeOf(go(r, r.kid));
    const first = arcade.recordRun(GAME, round({ seconds: 300 }));
    expect(first.outcome.saved).toBe(true);
    expect(first.habit).toMatchObject({ todayActive: true, dayStreak: 1 });
    expect(arcade.today().challenge.challenge).not.toBeNull();
    expect(arcade.plans.start('kids-break').ok).toBe(true);
  });

  it('show no purchase screen without the parent gate, and the gate does not stay open for the next profile', () => {
    const r = family();
    expect(r.book.canPurchase()).toBe(true);
    expect(r.book.active().rules.autoPaywall).toBe(true);
    go(r, r.kid);
    expect(r.book.active().rules.autoPaywall).toBe(false);
    expect(r.book.canPurchase()).toBe(false);
    passGate(r);
    expect(r.book.canPurchase()).toBe(true);
    r.book.gate.close();
    expect(r.book.canPurchase()).toBe(false);
    passGate(r);
    go(r, r.adult);                                                       // a grown-up's profile asks for nothing
    expect(r.book.canPurchase()).toBe(true);
    go(r, r.kid);
    expect(r.book.canPurchase()).toBe(false);                             // and the gate that was open is shut
  });

  it('become grown-up profiles only through the parent gate, and are still not online', () => {
    const r = family();
    go(r, r.kid);
    expect(r.book.update(r.kid, { kid: false })).toEqual({ ok: false, code: 'parent_gate' });
    passGate(r);
    expect(r.book.update(r.kid, { kid: false })).toMatchObject({ ok: true, profile: { kid: false, rules: { purchase: 'open', calories: true, online: false } } });
    expect(r.book.online()).toBe(false);
  });
});

describe('the guard: a child is not handed to the owner\'s profile because a plan ended', () => {
  /** The Family plan ends (or drops to `to`) while the kid is the one playing. */
  function lapsed(to: PlanKey = 'free') {
    const r = family();
    go(r, r.kid);
    r.events.length = 0;
    r.setPlan(to);
    return r;
  }

  it('gives the owner\'s profile a kid\'s rules until the parent gate is passed', () => {
    const r = lapsed();
    expect(r.book.active()).toMatchObject({ id: 'p1', owner: true, kid: false, guarded: true, state: 'ready', rules: rulesFor({ owner: true, kid: true, locked: false }) });
    expect(r.book.guarded).toBe(true);
    expect(r.book.online()).toBe(false);
    expect(r.book.canPurchase()).toBe(false);
    expect(r.book.active().rules).toMatchObject({ online: false, purchase: 'parent_gate', autoPaywall: false, calories: false, share: false, freeText: false, ghosts: 'family' });
    expect(r.book.picker()).toMatchObject({ ask: true, guarded: true, manage: false });
    expect(r.book.needsPicker()).toBe(true);
  });

  it('keeps the online features and the sync port shut for it, even when the plan that is left would allow them', () => {
    const r = lapsed('pro');                                              // the Family plan became Pro: live play is paid for, the guard alone keeps it shut
    const owner = r.book.open();
    const server = new FakeSyncServer();
    expect(canUse('live:ranked', ENTITLEMENT.pro)).toBe(true);
    expect(owner.can('live:ranked')).toBe(false);
    expect(owner.can('friends:list')).toBe(false);
    expect(owner.can(`game:${GAME}`)).toBe(true);
    expect(owner.syncPort(() => server.port())()).toBeNull();
    expect(owner.rules.online).toBe(false);
  });

  it('manages nothing while it is on: no new profile, no change, no deletion, no setting; sitting is still the player\'s own', () => {
    const r = lapsed();
    expect(r.book.create({ name: 'Yeni' })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update('p1', { name: 'Anne' })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update('p1', { avatar: 'owl' })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.planRemoval('p1')).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.planRemoval(r.kid)).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.setAskOnStart(false)).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update('p1', { seated: true })).toMatchObject({ ok: true, profile: { seated: true } });
  });

  it('is not lifted by tapping the owner\'s card: that asks for the gate, and a right answer lifts it for good and says so', () => {
    const r = lapsed('pro');
    const calls: string[] = [];
    watchOnline(r.book, { open: () => { calls.push('open'); }, close: () => { calls.push('close'); } });
    expect(calls).toEqual(['close']);                                     // it was closed for the kid, and the guard keeps it closed
    expect(r.book.switchTo('p1')).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.guarded).toBe(true);
    r.events.length = 0;
    passGate(r);
    expect(r.book.guarded).toBe(false);
    expect(r.events).toEqual([{ kind: 'refreshed', id: null, active: 'p1', online: true, guarded: false }]);
    expect(calls).toEqual(['close', 'open']);                             // the online identity is the owner's again
    expect(r.book.switchTo('p1')).toMatchObject({ ok: true, changed: false });
    expect(r.book.online()).toBe(true);
    expect(r.book.canPurchase()).toBe(true);
    expect(r.book.open().can('live:ranked')).toBe(true);
    expect(r.book.update('p1', { name: 'Anne' })).toMatchObject({ ok: true });
  });

  it('is kept in the list: a page that opens later is guarded too, and a right answer in one page lifts it in the other', () => {
    const r = lapsed();
    const next = r.page();
    expect(next.book.guarded).toBe(true);
    expect(next.book.active().id).toBe('p1');
    expect(next.book.online()).toBe(false);
    passGate(next);
    expect(next.book.guarded).toBe(false);
    r.events.length = 0;
    r.book.refresh();                                                     // the first page hears of it from the browser's storage event
    expect(r.book.guarded).toBe(false);
    expect(r.events).toEqual([{ kind: 'refreshed', id: null, active: 'p1', online: true, guarded: false }]);
  });

  it('stays after the plan returns: the kid goes to a kid\'s profile by a tap, a grown-up\'s needs the gate, and so does the way back', () => {
    const r = lapsed();
    r.setPlan('family');
    expect(r.book.guarded).toBe(true);
    expect(r.book.switchTo(r.adult)).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.switchTo(r.kid)).toMatchObject({ ok: true, changed: true });
    expect(r.book.guarded).toBe(false);                                   // the owner is not the one playing now
    expect(r.book.switchTo('p1')).toEqual({ ok: false, code: 'parent_gate' });
    passGate(r);
    expect(r.book.switchTo('p1')).toMatchObject({ ok: true, changed: true });
    expect(r.book.guarded).toBe(false);
    expect(r.book.online()).toBe(true);
    expect(r.page().book.guarded).toBe(false);                            // lifted for good, not for a while
  });

  it('is not set for anybody else: a grown-up whose profile locked, a profile deleted in another page, the owner alone', () => {
    const a = family();
    go(a, a.adult);
    a.setPlan('free');
    expect(a.book.guarded).toBe(false);
    const b = family();
    go(b, b.kid);                                                         // this page is the kid's
    const other = b.page();                                               // a second page opens on the profile the list remembers (the kid's)...
    go(other, 'p1');                                                      // ...and a grown-up takes it to the owner, through the gate
    const plan = other.book.planRemoval(b.kid) as { token: string };
    expect(other.book.remove(b.kid, plan.token)).toMatchObject({ ok: true });
    b.book.refresh();
    expect(b.book.active().id).toBe('p1');
    expect(b.events.at(-1)).toMatchObject({ kind: 'switched', reason: 'removed', guarded: false });
    expect(b.book.guarded).toBe(false);
    expect(rig({ plan: 'free' }).book.guarded).toBe(false);
  });

  it('reads a damaged flag as off, and writes nothing when there is nothing to guard', () => {
    const damaged = JSON.stringify({ v: 1, d: { seq: 1, active: 1, guard: 'yes', profiles: [{ seq: 1, name: 'Ayşe', avatar: 'fox', kid: false, seated: false, createdAt: 5, lastUsedAt: null }] } });
    const r = rig({ plan: 'family', storage: memoryStorage({ 'ba2.profiles.book': damaged }) });
    expect(r.book.guarded).toBe(false);
    r.book.open();                                                        // the first look settles the damaged list once...
    expect(r.storage.getItem('ba2.profiles.book')).toContain('"guard":false');
    const before = r.storage.dump();
    for (let i = 0; i < 5; i++) { r.book.refresh(); r.book.open(); r.page().book.open(); }
    expect(r.storage.dump()).toEqual(before);                             // ...and never again
  });
});

describe('the online identity belongs to the owner', () => {
  it('the sync port goes to the owner only, and only while the owner is the one playing', () => {
    const r = family();
    const server = new FakeSyncServer();
    const port = () => server.port();
    const owner = r.book.open();
    expect(owner.syncPort(port)()).not.toBeNull();
    const kid = go(r, r.kid);
    expect(owner.syncPort(port)()).toBeNull();                            // the owner's old space, while a kid plays
    expect(kid.syncPort(port)()).toBeNull();
    go(r, 'p1');
    expect(owner.syncPort(port)()).not.toBeNull();
    expect(kid.syncPort(port)()).toBeNull();                              // not even while the owner plays
    const adult = go(r, r.adult);
    expect(adult.syncPort(port)()).toBeNull();
    expect(owner.syncPort(port)()).toBeNull();
    go(r, 'p1');
    expect(adult.syncPort(port)()).toBeNull();
  });

  it('a port that throws is no port', () => {
    const r = family();
    expect(r.book.open().syncPort(() => { throw new Error('client broke'); })()).toBeNull();
  });

  it('the owner\'s streak goes to the server; a kid\'s, and a grown-up\'s, never: the server is not even asked', async () => {
    const r = family();
    const server = new FakeSyncServer();
    const ownerArcade = arcadeOf(r.book.open(), server);
    const kidArcade = arcadeOf(go(r, r.kid), server);
    const adultArcade = arcadeOf(go(r, r.adult), server);
    go(r, 'p1');
    ownerArcade.recordRun(GAME, round({ seconds: 400 }));
    expect(await ownerArcade.sync.sync()).toMatchObject({ ok: true });
    expect(server.writes).toBeGreaterThan(0);
    const [loads, writes] = [server.loads, server.writes];
    for (const a of [kidArcade, adultArcade]) {
      a.recordRun(GAME, round({ seconds: 400 }));
      expect(await a.sync.sync()).toMatchObject({ ok: false, failure: 'no_port' });
    }
    expect([server.loads, server.writes]).toEqual([loads, writes]);
    go(r, r.kid);
    expect(await ownerArcade.sync.sync()).toMatchObject({ ok: false, failure: 'no_port' });   // the owner's old arcade, while a kid plays
    expect([server.loads, server.writes]).toEqual([loads, writes]);
  });

  it('book.online() and every event say whether the profile that plays has the online identity', () => {
    const r = family();
    expect(r.book.online()).toBe(true);
    r.book.switchTo(r.kid);
    expect(r.book.online()).toBe(false);
    go(r, 'p1');
    go(r, r.adult);
    expect(r.events.filter((e) => e.kind === 'switched').map((e) => [e.active, e.online])).toEqual([[r.kid, false], ['p1', true], [r.adult, false]]);
  });

  it('the social client is closed in a kid\'s profile and opened for the owner; one that was open when the page started is closed at once', () => {
    const r = family();
    r.book.switchTo(r.kid);
    const calls: string[] = [];
    const stop = watchOnline(r.book, { open: () => { calls.push('open'); }, close: () => { calls.push('close'); } });
    expect(calls).toEqual(['close']);
    go(r, 'p1');
    go(r, r.adult);
    go(r, 'p1');
    expect(calls).toEqual(['close', 'open', 'close', 'open']);
    stop();
    go(r, r.kid);
    expect(calls).toHaveLength(4);
  });

  it('the social client cannot break the app: a client that throws or whose promise fails is ignored', async () => {
    const r = family();
    watchOnline(r.book, { open: () => { throw new Error('open broke'); }, close: () => Promise.reject(new Error('close failed')) });
    expect(() => go(r, r.kid)).not.toThrow();
    expect(() => go(r, 'p1')).not.toThrow();
    await Promise.resolve();
  });

  it('the live site\'s old record is imported into the owner and into nobody else', () => {
    const r = family();
    r.storage.setItem('ba_runs', JSON.stringify([{ ts: Date.UTC(2026, 9, 1, 10), world: 'alps', diff: 'medium', score: 500, seconds: 60, complete: true }]));
    const kid = go(r, r.kid);
    const kidArcade = arcadeOf(kid);
    expect(kidArcade.importLegacy(r.storage)).toMatchObject({ status: 'nothing', runs: 0 });
    expect(kid.store.ns('runner').keys()).toEqual([]);
    expect(kid.store.ns('core').keys()).toEqual([]);
    const adultArcade = arcadeOf(go(r, r.adult));
    expect(adultArcade.importLegacy(r.storage).status).toBe('nothing');
    const owner = go(r, 'p1');
    expect(arcadeOf(owner).importLegacy(r.storage)).toMatchObject({ status: 'imported', runs: 1 });
    for (const prefix of ['ba2p2', 'ba2p3']) expect(keysUnder(r, prefix).filter((k) => /\.(runner|core)\./.test(k)), prefix).toEqual([]);
    expect(keysUnder(r, 'ba2').filter((k) => k.includes('.runner.')).length).toBeGreaterThan(0);
  });
});

describe('changing a profile', () => {
  it('takes a flag only as a true or a false: anything else is no request, and nothing is written for it', () => {
    const r = family();
    r.events.length = 0;
    const before = r.storage.getItem('ba2.profiles.book');
    expect(r.book.update(r.kid, { kid: 'no' as never, seated: 1 as never })).toMatchObject({ ok: true, profile: { kid: true, seated: false } });
    expect(r.book.update('p1', { kid: 'true' as never })).toMatchObject({ ok: true, profile: { kid: false } });
    expect(r.events).toEqual([]);
    expect(r.storage.getItem('ba2.profiles.book')).toBe(before);
    expect(r.book.update(r.kid, { name: 'Defne K.', kid: 'false' as never })).toMatchObject({ ok: true, profile: { name: 'Defne K.', kid: true } });
    expect(r.storage.getItem('ba2.profiles.book')).not.toContain('"false"');
  });

  it('the owner changes anybody\'s name, picture, sitting and kid flag, and the change is told and kept', () => {
    const r = family();
    r.events.length = 0;
    expect(r.book.update(r.kid, { name: 'Defne Su', avatar: 'whale', seated: true })).toMatchObject({ ok: true, profile: { name: 'Defne Su', avatar: 'whale', seated: true, kid: true } });
    expect(r.book.update(r.adult, { kid: true })).toMatchObject({ ok: true, profile: { kid: true, rules: { purchase: 'parent_gate' } } });
    expect(r.events.map((e) => [e.kind, e.id])).toEqual([['updated', r.kid], ['updated', r.adult]]);
    expect(r.page().book.get(r.kid)).toMatchObject({ name: 'Defne Su', avatar: 'whale', seated: true });
  });

  it('a grown-up who is not the owner changes their own name, picture and sitting, and nothing else', () => {
    const r = family();
    go(r, r.adult);
    expect(r.book.update(r.adult, { name: 'Emre K', avatar: 'robot', seated: true })).toMatchObject({ ok: true });
    expect(r.book.update(r.adult, { kid: true })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update(r.kid, { name: 'Başka' })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update('p1', { avatar: 'star' })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update(r.kid, { seated: true })).toEqual({ ok: false, code: 'parent_gate' });
    passGate(r);
    expect(r.book.update(r.kid, { name: 'Başka' })).toMatchObject({ ok: true });
  });

  it('a kid says whether they sit, and needs the parent gate for the rest', () => {
    const r = family();
    go(r, r.kid);
    expect(r.book.update(r.kid, { seated: true })).toMatchObject({ ok: true, profile: { seated: true } });
    expect(r.book.update(r.kid, { name: 'Başka' })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update(r.kid, { avatar: 'star' })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.update(r.kid, { kid: false })).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.get(r.kid)).toMatchObject({ name: 'Defne', avatar: 'owl', kid: true, seated: true });
    passGate(r);
    expect(r.book.update(r.kid, { name: 'Başka', avatar: 'star' })).toMatchObject({ ok: true, profile: { name: 'Başka', avatar: 'star' } });
  });

  it('keeps the same rules for names as creating does, and a profile may take its own name back in other letters', () => {
    const r = family();
    expect(r.book.update(r.kid, { name: '' })).toEqual({ ok: false, code: 'name_empty' });
    expect(r.book.update(r.kid, { name: 'x'.repeat(NAME_MAX + 1) })).toEqual({ ok: false, code: 'name_long' });
    expect(r.book.update(r.kid, { name: 'a<b' })).toEqual({ ok: false, code: 'name_chars' });
    expect(r.book.update(r.kid, { name: 'emre' })).toEqual({ ok: false, code: 'name_taken' });
    expect(r.book.update(r.kid, { avatar: 'dragon' as never })).toEqual({ ok: false, code: 'avatar' });
    expect(r.book.update(r.kid, { name: 'DEFNE' })).toMatchObject({ ok: true, profile: { name: 'DEFNE' } });
    expect(r.book.get(r.kid)?.name).toBe('DEFNE');
  });

  it('is nothing when nothing changes, and does not know a profile that is not there', () => {
    const r = family();
    r.events.length = 0;
    expect(r.book.update(r.kid, {})).toMatchObject({ ok: true });
    expect(r.book.update(r.kid, { name: 'Defne', seated: false })).toMatchObject({ ok: true });
    expect(r.events).toEqual([]);
    expect(r.book.update('p9', { name: 'X' })).toEqual({ ok: false, code: 'unknown' });
    expect(r.book.update('x', { name: 'X' })).toEqual({ ok: false, code: 'unknown' });
    expect(r.book.update(r.kid, null as never)).toMatchObject({ ok: true });
  });

  it('a profile\'s space shows the profile as it is now, and as it was when it is gone', () => {
    const r = family();
    const space = go(r, r.adult);
    r.book.update(r.adult, { name: 'Emre K' });
    expect(space.profile.name).toBe('Emre K');
    expect(space.alive()).toBe(true);
    go(r, 'p1');
    const plan = must(r.book.planRemoval(r.adult).ok ? (r.book.planRemoval(r.adult) as { token: string }) : null);
    r.book.remove(r.adult, plan.token);
    expect(space.alive()).toBe(false);
    expect(space.profile.name).toBe('Emre K');
  });
});

describe('what a profile uses last', () => {
  it('is written when a round is saved, at most every ten minutes, and never for a round that was not one', () => {
    const r = family();
    const arcade = arcadeOf(r.book.open());
    expect(r.book.get('p1')?.lastUsedAt).toBeNull();
    arcade.recordRun(GAME, null);
    expect(r.book.get('p1')?.lastUsedAt).toBeNull();
    const t0 = r.clock.t;
    arcade.recordRun(GAME, round());
    expect(r.book.get('p1')?.lastUsedAt).toBe(t0);
    r.clock.t += TOUCH_EVERY_MS - 1;
    arcade.recordRun(GAME, round());
    expect(r.book.get('p1')?.lastUsedAt).toBe(t0);
    r.clock.t += 1;
    arcade.recordRun(GAME, round());
    expect(r.book.get('p1')?.lastUsedAt).toBe(r.clock.t);
  });

  it('is the kid\'s own when a kid plays', () => {
    const r = family();
    const arcade = arcadeOf(go(r, r.kid));
    arcade.recordRun(GAME, round());
    expect(r.book.get(r.kid)?.lastUsedAt).toBe(r.clock.t);
    expect(r.book.get(r.adult)?.lastUsedAt).toBeNull();
  });
});

describe('deleting a profile', () => {
  it('asks first what it would cost, and deletes nothing without the answer it hands back', () => {
    const r = family();
    arcadeOf(go(r, r.kid)).recordRun(GAME, round());
    arcadeOf(r.book.open()).recordRun(GAME, round());
    go(r, 'p1');
    const keys = Object.keys(r.storage.dump());
    const plan = r.book.planRemoval(r.kid);
    expect(plan).toMatchObject({
      ok: true, action: 'delete', expiresAt: r.clock.t + REMOVAL_VALID_MS,
      summary: { id: r.kid, name: 'Defne', kid: true, owner: false, runs: 2, keys: keysUnder(r, 'ba2p2').length },
    });
    expect(Object.keys(r.storage.dump())).toEqual(keys);                  // asking changed nothing
    for (const wrong of [undefined, null, true, '', 'yes', 'delete', 'rm1', 7]) {
      expect(r.book.remove(r.kid, wrong as never), String(wrong)).toEqual({ ok: false, code: 'confirm_required' });
    }
    expect(Object.keys(r.storage.dump())).toEqual(keys);
    expect(r.book.list()).toHaveLength(3);
  });

  it('deletes the profile and every key it had, and not one key of anybody else', () => {
    const r = family();
    r.book.device.ns('entitlements').set('did', '0123456789abcdef0123456789abcdef');
    for (const id of ['p1', r.kid, r.adult]) arcadeOf(go(r, id)).recordRun(GAME, round({ score: 100 + Number(id.slice(1)) }));
    go(r, 'p1');
    const others = (dump: Record<string, string>) => Object.fromEntries(Object.entries(dump).filter(([k]) => !k.startsWith('ba2p2.') && !k.startsWith('ba2.profiles.')));
    const before = others(r.storage.dump());
    const plan = r.book.planRemoval(r.kid) as { token: string };
    expect(r.book.remove(r.kid, plan.token)).toEqual({ ok: true, action: 'delete', active: 'p1' });
    expect(keysUnder(r, 'ba2p2')).toEqual([]);
    expect(others(r.storage.dump())).toEqual(before);
    expect(r.book.list().map((v) => v.id)).toEqual(['p1', 'p3']);
    expect(r.book.get(r.kid)).toBeNull();
    expect(r.book.peek(r.kid)).toBeNull();
    expect(r.page().book.list().map((v) => v.id)).toEqual(['p1', 'p3']);
    expect(r.events.map((e) => e.kind).slice(-1)).toEqual(['removed']);
  });

  it('the answer is good for one profile, once, for two minutes', () => {
    const r = family();
    const plan = r.book.planRemoval(r.kid) as { token: string };
    expect(r.book.remove(r.adult, plan.token)).toEqual({ ok: false, code: 'confirm_required' });
    expect(r.book.list()).toHaveLength(3);
    expect(r.book.remove(r.kid, plan.token)).toMatchObject({ ok: true });
    expect(r.book.remove(r.kid, plan.token)).toEqual({ ok: false, code: 'unknown' });
    const second = r.book.planRemoval(r.adult) as { token: string };
    r.clock.t += REMOVAL_VALID_MS + 1;
    expect(r.book.remove(r.adult, second.token)).toEqual({ ok: false, code: 'confirm_required' });
    const third = r.book.planRemoval(r.adult) as { token: string };
    r.clock.t += REMOVAL_VALID_MS;
    expect(r.book.remove(r.adult, third.token)).toMatchObject({ ok: true });
  });

  it('a newer question replaces the older one: only the last answer counts', () => {
    const r = family();
    const first = r.book.planRemoval(r.kid) as { token: string };
    const second = r.book.planRemoval(r.adult) as { token: string };
    expect(first.token).not.toBe(second.token);
    expect(r.book.remove(r.kid, first.token)).toEqual({ ok: false, code: 'confirm_required' });
    expect(r.book.remove(r.adult, second.token)).toMatchObject({ ok: true });
  });

  it('puts the player on the owner when the profile that was playing is deleted', () => {
    const r = family();
    go(r, r.adult);
    passGate(r);
    r.events.length = 0;
    const plan = r.book.planRemoval(r.adult) as { token: string };
    expect(r.book.remove(r.adult, plan.token)).toEqual({ ok: true, action: 'delete', active: 'p1' });
    expect(r.book.active().id).toBe('p1');
    expect(r.events.map((e) => [e.kind, e.id, e.reason])).toEqual([['removed', r.adult, undefined], ['switched', 'p1', 'removed']]);
  });

  it('is not for a kid, or a grown-up who is not the owner, to do by tapping: it takes the parent gate', () => {
    const r = family();
    go(r, r.kid);
    expect(r.book.planRemoval(r.adult)).toEqual({ ok: false, code: 'parent_gate' });
    expect(r.book.planRemoval(r.kid)).toEqual({ ok: false, code: 'parent_gate' });
    passGate(r);
    const plan = r.book.planRemoval(r.adult) as { token: string };
    r.book.gate.close();
    expect(r.book.remove(r.adult, plan.token)).toEqual({ ok: false, code: 'parent_gate' });
    passGate(r);
    expect(r.book.remove(r.adult, plan.token)).toMatchObject({ ok: true });
  });

  it('does not know a profile that is not there', () => {
    const r = family();
    for (const id of ['p9', 'x', null, 4]) {
      expect(r.book.planRemoval(id as never), String(id)).toEqual({ ok: false, code: 'unknown' });
      expect(r.book.remove(id as never, 'rm1'), String(id)).toEqual({ ok: false, code: 'unknown' });
    }
  });

  it('the owner is never deleted: asked to, it is reset, and what was bought, the list and the others stay', () => {
    const r = family();
    r.book.device.ns('entitlements').set('did', '0123456789abcdef0123456789abcdef');
    r.storage.setItem('ba_runs', '[]');
    const owner = r.book.open();
    arcadeOf(owner).recordRun(GAME, round());
    owner.store.ns('core').set('legacy-v1', { at: 1, runs: 0, from: 'ba_*' }, ANY);
    arcadeOf(go(r, r.kid)).recordRun(GAME, round());
    go(r, 'p1');
    const kidKeys = keysUnder(r, 'ba2p2');
    const plan = r.book.planRemoval('p1');
    expect(plan).toMatchObject({ ok: true, action: 'reset', summary: { id: 'p1', owner: true, runs: 1 } });
    expect(r.book.remove('p1', (plan as { token: string }).token)).toEqual({ ok: true, action: 'reset', active: 'p1' });
    expect(keysUnder(r, 'ba2').filter((k) => !k.startsWith('ba2p'))).toEqual(['ba2.core.legacy-v1', 'ba2.entitlements.did', 'ba2.profiles.book']);
    expect(keysUnder(r, 'ba2p2')).toEqual(kidKeys);
    expect(r.book.list().map((v) => v.id)).toEqual(['p1', 'p2', 'p3']);
    expect(r.book.get('p1')).toMatchObject({ name: 'Ayşe', owner: true, lastUsedAt: null });
    expect(r.storage.getItem('ba_runs')).toBe('[]');                      // the live site's keys are not ours to touch
  });

  it('a handle to a deleted profile writes nothing any more: no key is left behind by a tab that did not know', () => {
    const r = family();
    const space = go(r, r.adult);
    const arcade = arcadeOf(space);
    go(r, 'p1');
    const plan = r.book.planRemoval(r.adult) as { token: string };
    r.book.remove(r.adult, plan.token);
    expect(arcade.recordRun(GAME, round()).outcome.saved).toBe(false);
    space.store.ns('shell').set('settings', { late: true }, ANY);
    expect(keysUnder(r, 'ba2p3')).toEqual([]);
  });

  it('counts rounds over the games it was told about, and counts none for a game that is not one', () => {
    const r = family();
    const arcade = arcadeOf(go(r, r.kid));
    arcade.recordRun(GAME, round());
    arcade.recordRun(GAME, round());
    go(r, 'p1');
    expect(r.book.planRemoval(r.kid)).toMatchObject({ summary: { runs: 2 } });
    const plain = createProfileBook({ store: r.store, can: () => true });
    expect(plain.planRemoval(r.kid)).toMatchObject({ summary: { runs: 0 } });
  });
});

describe('the family board and a look at somebody else\'s record', () => {
  it('lists everybody, best first, locked profiles included, and reads without writing', () => {
    const r = family();
    arcadeOf(r.book.open()).recordRun(GAME, round({ score: 300 }));
    arcadeOf(go(r, r.kid)).recordRun(GAME, round({ score: 900 }));
    arcadeOf(go(r, r.adult)).recordRun(GAME, round({ score: 100, variant: 'night' }));
    go(r, 'p1');
    const dump = r.storage.dump();
    expect(r.book.family(GAME).map((e) => [e.id, e.best])).toEqual([[r.kid, 900], ['p1', 300], [r.adult, 100]]);
    expect(r.book.family(GAME, { variant: 'standard' }).map((e) => [e.id, e.best])).toEqual([[r.kid, 900], ['p1', 300], [r.adult, 0]]);
    expect(r.book.family(GAME, { variant: 'night', difficulty: 'normal' }).map((e) => [e.id, e.best])).toEqual([[r.adult, 100], ['p1', 0], [r.kid, 0]]);
    expect(r.book.family(GAME)[0]).toMatchObject({ name: 'Defne', kid: true, state: 'ready', active: false });
    expect(r.book.family('Not A Game!')).toEqual([]);
    expect(r.storage.dump()).toEqual(dump);
    r.setPlan('free');
    expect(r.book.family(GAME).map((e) => [e.id, e.state, e.best])).toEqual([[r.kid, 'locked', 900], ['p1', 'ready', 300], [r.adult, 'locked', 100]]);
  });

  it('a look is a store that cannot write, for a profile that is locked or not', () => {
    const r = family();
    arcadeOf(go(r, r.kid)).recordRun(GAME, round({ score: 55 }));
    go(r, 'p1');
    const dump = r.storage.dump();
    const look = must(r.book.peek(r.kid));
    expect(look.profile.name).toBe('Defne');
    expect(look.store.readOnly).toBe(true);
    look.store.ns(GAME).set('bests', { 'x|y': 99999 }, ANY);
    look.store.clearAll();
    expect(r.storage.dump()).toEqual(dump);
    expect(bestIn(look.store)).toBe(55);
    expect(() => look.store.ns('entitlements')).toThrow(RangeError);
    expect(r.book.peek('p9')).toBeNull();
    expect(r.book.peek('x')).toBeNull();
  });
});

describe('two pages on one device', () => {
  it('the second sees what the first made when it looks again, and says so', () => {
    const a = rig({ plan: 'family' });
    const b = a.page();
    expect(b.book.list()).toHaveLength(1);
    a.book.create({ name: 'Defne', kid: true });
    expect(b.book.list().map((v) => v.id)).toEqual(['p1', 'p2']);        // every call reads the list afresh
    expect(b.events).toEqual([]);
    b.book.refresh();
    expect(b.events).toEqual([{ kind: 'refreshed', id: null, active: 'p1', online: true, guarded: false }]);
    b.book.refresh();
    expect(b.events).toHaveLength(1);                                     // nothing new, nothing said
  });

  it('two pages that both make a profile get two different ones', () => {
    const a = rig({ plan: 'family' });
    const b = a.page();
    expect(a.book.create({ name: 'Defne' })).toMatchObject({ ok: true, profile: { id: 'p2' } });
    expect(b.book.create({ name: 'Emre' })).toMatchObject({ ok: true, profile: { id: 'p3' } });
    expect(a.book.create({ name: 'Mert' })).toMatchObject({ ok: true, profile: { id: 'p4' } });
    expect(b.book.create({ name: 'Mert' })).toEqual({ ok: false, code: 'name_taken' });
    expect(a.book.list().map((v) => v.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('a profile deleted in one page moves the other page, which was playing it, to the owner; its old handle writes nothing', () => {
    const a = family();
    const b = a.page();
    const space = go(b, a.kid);
    const arcade = arcadeOf(space);
    const plan = a.book.planRemoval(a.kid) as { token: string };
    expect(a.book.remove(a.kid, plan.token)).toMatchObject({ ok: true });
    b.book.refresh();
    expect(b.book.active().id).toBe('p1');
    expect(b.events.at(-1)).toEqual({ kind: 'switched', id: 'p1', active: 'p1', online: true, guarded: false, reason: 'removed' });
    expect(arcade.recordRun(GAME, round()).outcome.saved).toBe(false);
    expect(keysUnder(a, 'ba2p2')).toEqual([]);
  });

  it('the list is made again, with the owner, if another page cleared it', () => {
    const a = rig({ plan: 'family' });
    a.storage.removeItem('ba2.profiles.book');
    expect(a.book.list().map((v) => v.id)).toEqual(['p1']);
    expect(a.storage.getItem('ba2.profiles.book')).not.toBeNull();
  });
});

describe('the plan\'s watcher and the end of the book', () => {
  it('looks again whenever the entitlements say something, and stops when the book is disposed', () => {
    const r = family();
    expect(r.watchers.size).toBe(1);
    r.events.length = 0;
    r.setPlan('free');
    expect(r.events.length).toBe(1);
    r.book.dispose();
    expect(r.watchers.size).toBe(0);
    r.setPlan('family');
    expect(r.events.length).toBe(1);
  });

  it('a listener that throws does not keep the others from hearing', () => {
    const r = rig({ plan: 'family' });
    const heard: string[] = [];
    r.book.onChange(() => { throw new Error('listener broke'); });
    const off = r.book.onChange((e) => heard.push(e.kind));
    r.book.create({ name: 'Defne' });
    expect(heard).toEqual(['created']);
    off();
    r.book.create({ name: 'Emre' });
    expect(heard).toEqual(['created']);
  });
});
