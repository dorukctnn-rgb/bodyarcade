// The profile book under a long, random life: two pages on one storage (two tabs), a plan that comes and goes, profiles made,
// changed, switched to, deleted, the parent gate answered right and wrong, pages loaded again. After EVERY step the rules that
// must never break are checked on both pages and in the storage itself. Fixed seeds, so a failure is the same failure every time
// (the seed and the step are in the message). It looks for what the single-case tests did not think of.
import { describe, expect, it } from 'vitest';
import { createProfileBook, type ProfileBook, type ProfileView } from './profiles.ts';
import { createStore, memoryStorage } from './store.ts';

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Page { name: string; book: ProfileBook; known: { v: boolean }; /** told about the latest change of plan */ fresh: boolean }
interface World {
  storage: ReturnType<typeof memoryStorage>;
  t: number;
  plan: 'free' | 'family';
  pages: Page[];
  random: () => number;
  log: string[];
  removed: Set<string>;
  /** The stored guard at the last check, and whether the last step was a right answer at the gate. */
  guard: boolean;
  gateOpened: boolean;
  /** What each locked profile held at the last check (to see that a locked profile is never written to). */
  lockedSnap: Map<string, string>;
}

const NAMES = ['Ayşe', 'Defne', 'Emre', 'Zeynep', 'Mert', 'Elif', 'Can', 'Selin', 'Deniz', 'Ada', 'Bora', 'Işık', 'ışık', 'AYŞE', 'a', 'x'.repeat(30), '', '  ', '🙂', 'Ok Name'];

function newPage(w: World, name: string, known: boolean): Page {
  const k = { v: known };
  const store = createStore({ storage: w.storage, now: () => w.t, timeZone: 'UTC' });
  const book = createProfileBook({
    store,
    // what a paid plan does: everything; the free plan: one game. The family room is the Family plan's alone.
    can: (f) => (w.plan === 'family' ? true : f === 'game:squat-flap'),
    known: () => k.v, ownerName: 'Owner', recoveredName: (n) => `P${n}`, games: () => ['squat-flap'], random: w.random,
  });
  return { name, book, known: k, fresh: true };
}

const pick = <T,>(w: World, xs: readonly T[]): T => xs[Math.floor(w.random() * xs.length)] as T;

interface Stored { keyed: Map<number, Record<string, string>>; guard: boolean; listed: { seq: number; kid: boolean; createdAt: number }[] }

/** What the storage holds, read straight from it: keys by profile number, and the stored list. */
function storedState(w: World): Stored {
  const keyed = new Map<number, Record<string, string>>();
  for (const [key, value] of Object.entries(w.storage.dump())) {
    const m = /^ba2(?:p([1-9]\d{0,2}))?\.([a-z0-9_-]+)\./.exec(key);
    if (!m) throw new Error(`a key that is none of the book's: ${key}`);
    const seq = m[1] === undefined ? 1 : Number(m[1]);
    if (seq > 1 && (m[2] === 'entitlements' || m[2] === 'profiles')) throw new Error(`a profile wrote a device namespace: ${key}`);
    (keyed.get(seq) ?? keyed.set(seq, {}).get(seq) as Record<string, string>)[key] = value;
  }
  const raw = w.storage.getItem('ba2.profiles.book');
  if (raw === null) return { keyed, guard: false, listed: [] };
  const doc = (JSON.parse(raw) as { d: { guard?: boolean; profiles: { seq: number; kid: boolean; createdAt: number }[] } }).d;
  return { keyed, guard: doc.guard === true, listed: doc.profiles };
}

const shape = (list: readonly ProfileView[]): string => JSON.stringify(list.map((v) => [v.id, v.name, v.avatar, v.kid, v.seated, v.state]));

/** The rules that must hold after every step. */
function check(w: World, step: number, seed: number): void {
  const where = `seed ${seed}, step ${step} (${w.log.slice(-3).join(' | ')})`;
  const state = storedState(w);
  const listedSeqs = state.listed.map((p) => p.seq);
  for (const seq of state.keyed.keys()) if (seq > 1) expect(listedSeqs, `${where}: keys of profile p${seq} outlive it`).toContain(seq);
  expect(state.listed.find((p) => p.seq === 1)?.kid, `${where}: the stored owner is not a kid`).toBe(false);
  for (const p of state.listed) expect(w.removed.has(`p${p.seq}`), `${where}: p${p.seq} was deleted and a profile came back under the same number`).toBe(false);

  // A locked profile is never written to: what it held at the last check is what it holds now.
  const lockedNow = new Map<string, string>();
  const first = w.pages[0] as Page;
  for (const v of first.book.list()) {
    if (v.state !== 'locked') continue;
    const seq = Number(v.id.slice(1));
    const snap = JSON.stringify([v.createdAt, state.keyed.get(seq) ?? {}]);
    lockedNow.set(v.id, snap);
    const before = w.lockedSnap.get(v.id);
    if (before !== undefined && JSON.parse(before)[0] === v.createdAt) expect(snap, `${where}: the locked profile ${v.id} was written to`).toBe(before);
  }
  w.lockedSnap = lockedNow;

  // The stored guard is lifted only by a right answer at the gate.
  if (w.guard && !state.guard) expect(w.gateOpened, `${where}: the guard was lifted without the gate`).toBe(true);
  w.guard = state.guard;
  w.gateOpened = false;

  const shapes = new Set<string>();
  for (const page of w.pages) {
    const { book } = page;
    const list = book.list();
    const tag = `${where} page ${page.name}`;
    shapes.add(shape(list));
    expect(list[0]?.id, `${tag}: the owner is first`).toBe('p1');
    expect(list[0]?.owner, tag).toBe(true);
    expect(list[0]?.kid, `${tag}: the owner is never a kid`).toBe(false);
    expect(list.length, tag).toBeLessThanOrEqual(6);
    expect(new Set(list.map((v) => v.id)).size, `${tag}: ids are unique`).toBe(list.length);
    expect(list.filter((v) => v.active).length, `${tag}: exactly one profile is playing`).toBe(1);
    const active = book.active();
    expect(active.state, `${tag}: the one that plays can be played`).toBe('ready');
    const cap = book.capacity();
    expect(cap.max, tag).toBe(w.plan === 'family' ? 6 : 1);
    list.forEach((v, i) => expect(v.state, `${tag}: ${v.id} is locked exactly beyond the plan's room`).toBe(i >= cap.max ? 'locked' : 'ready'));
    for (const v of list) {
      // The online identity: the owner's, never a kid's, never a locked or guarded profile's.
      expect(v.rules.online, `${tag}: online of ${v.id}`).toBe(v.owner && !v.kid && !v.guarded && v.state === 'ready');
      if (!v.owner) expect(v.rules.online, `${tag}: only the owner is online (${v.id})`).toBe(false);
      if (v.kid || v.guarded) {
        expect(v.rules.purchase, `${tag}: ${v.id} buys behind the gate`).toBe('parent_gate');
        expect(v.rules.autoPaywall, tag).toBe(false);
        expect(v.rules.calories, tag).toBe(false);
        expect(v.rules.share, tag).toBe(false);
        expect(v.rules.freeText, tag).toBe(false);
        expect(v.rules.online, tag).toBe(false);
      }
      if (v.kid) expect(v.defaults.weightKg, `${tag}: a kid's weight is never asked`).toBeNull();
      expect(v.rules.record, `${tag}: ${v.id} records exactly while it is not locked`).toBe(v.state === 'ready');
    }
    if (state.guard) expect(!active.owner || active.guarded, `${tag}: the owner's profile is guarded while the guard is stored`).toBe(true);
    expect(book.online(), `${tag}: online() is the active profile's`).toBe(active.rules.online);
    expect(book.canPurchase(), `${tag}: purchases of a kid wait for the gate`).toBe(active.rules.purchase === 'open' || book.gate.isOpen());
    expect(book.picker().cards.map((c) => c.id), tag).toEqual(list.map((v) => v.id));
    for (const v of list) {
      const peek = book.peek(v.id);
      expect(peek, `${tag}: a look at ${v.id}`).not.toBeNull();
      expect(peek?.store.readOnly, `${tag}: a look cannot write`).toBe(true);
    }
    // The space of the page (what the interface builds everything from, as it does after every event).
    const space = book.open();
    expect(space.id, tag).toBe(book.active().id);
    const reached = space.syncPort(() => ({ marker: true }) as never)();
    expect(reached !== null, `${tag}: the sync port goes to the owner only, while the owner plays and is not a kid`).toBe(book.active().rules.online);
    expect(space.can('live:ranked'), `${tag}: no online feature without the online identity`).toBe(w.plan === 'family' && book.active().rules.online);
    expect(space.can('game:squat-flap'), `${tag}: the device's plan is the profile's plan`).toBe(true);
  }
  // Both pages see the same list (they differ only in who is playing).
  expect(shapes.size, `${where}: two pages, two lists`).toBe(1);
}

function step(w: World): void {
  const page = pick(w, w.pages);
  const { book } = page;
  const ids = [...book.list().map((v) => v.id), 'p99'];
  const op = Math.floor(w.random() * 16);
  w.t += Math.floor(w.random() * 90_000);
  switch (op) {
    case 0: case 1: {
      const r = book.create({ name: pick(w, NAMES), kid: w.random() < 0.6, seated: w.random() < 0.3 });
      w.log.push(`create ${page.name} -> ${r.ok ? r.profile.id : r.code}`);
      break;
    }
    case 2: {
      const id = pick(w, ids);
      const r = book.update(id, { ...(w.random() < 0.5 ? { name: pick(w, NAMES) } : {}), ...(w.random() < 0.4 ? { kid: w.random() < 0.5 } : {}), ...(w.random() < 0.3 ? { seated: w.random() < 0.5 } : {}) });
      w.log.push(`update ${page.name} ${id} -> ${r.ok ? 'ok' : r.code}`);
      break;
    }
    case 3: case 4: case 5: {
      const id = pick(w, ids);
      const r = book.switchTo(id);
      w.log.push(`switch ${page.name} ${id} -> ${r.ok ? 'ok' : r.code}`);
      break;
    }
    case 6: {
      const id = pick(w, ids);
      const plan = book.planRemoval(id);
      if (plan.ok) {
        const token = w.random() < 0.85 ? plan.token : 'rm-wrong';
        const r = book.remove(id, token);
        if (r.ok && r.action === 'delete') w.removed.add(id);
        w.log.push(`remove ${page.name} ${id} ${token === plan.token ? 'token' : 'wrong'} -> ${r.ok ? r.action : r.code}`);
      } else w.log.push(`planRemoval ${page.name} ${id} -> ${plan.code}`);
      break;
    }
    case 7: {
      // The plan comes or goes. Every page is told (the entitlements' onChange calls refresh()), most of the time at once.
      const kidPlaying = w.pages.map((p) => { const a = p.book.active(); return a.kid && !a.owner && a.state === 'ready'; });
      const prior = w.plan;
      w.plan = w.plan === 'family' ? 'free' : 'family';
      const everybody = w.random() < 0.6;
      w.pages.forEach((p) => { if (everybody || p === page) { p.book.refresh(); p.fresh = true; } else p.fresh = false; });
      w.log.push(`plan ${prior} -> ${w.plan} (${everybody ? 'everybody told' : `${page.name} only`})`);
      if (w.plan === 'free') {
        w.pages.forEach((p, i) => {
          if (!kidPlaying[i]) return;                                   // told or not: the answer of every read is already the guarded one
          const a = p.book.active();
          // THE rule: a child whose profile the plan locked is not handed to the owner's online identity.
          expect(a.owner && a.guarded && !p.book.online() && p.book.canPurchase() === p.book.gate.isOpen(), `a kid was handed to the owner's profile (${p.name}): ${JSON.stringify(a.rules)}`).toBe(true);
        });
      }
      break;
    }
    case 8: case 9: {
      const asked = book.gate.ask();
      if (asked.ok) {
        const right = w.random() < 0.7;
        const r = book.gate.answer(asked.question.id, right ? asked.question.a * asked.question.b : asked.question.a * asked.question.b + 1);
        if (r.ok) w.gateOpened = true;
        w.log.push(`gate ${page.name} ${right ? 'right' : 'wrong'} -> ${r.ok ? 'open' : r.code}`);
      } else {
        w.t += asked.retryAfterMs + 1;
        w.log.push(`gate ${page.name} waits`);
      }
      break;
    }
    case 10: {
      const r = book.setAskOnStart(w.random() < 0.5);
      w.log.push(`askOnStart ${page.name} -> ${r.ok ? 'ok' : r.code}`);
      break;
    }
    case 11: case 12: {
      // a round: a write through whatever space the page plays in
      const space = book.open();
      space.store.ns('shell').set('rounds', Math.floor(w.random() * 1000));
      w.log.push(`write ${page.name} ${space.id}`);
      break;
    }
    case 13: {
      // the page is loaded again: the entitlements are not read yet, then they are (the shell's own order)
      const i = w.pages.indexOf(page);
      const fresh = newPage(w, page.name, false);
      w.pages[i] = fresh;
      const before = fresh.book.list().map((v) => `${v.id}:${v.state}`).join(',');
      fresh.known.v = true;
      fresh.book.refresh();
      fresh.fresh = true;
      w.log.push(`reload ${page.name} [${before}]`);
      break;
    }
    case 14: {
      book.refresh();
      page.fresh = true;
      w.log.push(`refresh ${page.name}`);
      break;
    }
    default: {
      w.t += 6 * 60_000;
      w.log.push('time passes');
    }
  }
}

describe('the profile book under a long random life (two tabs, a plan that comes and goes)', () => {
  const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
  for (const seed of SEEDS) {
    it(`seed ${seed}: the rules hold after every one of 120 steps`, () => {
      const w: World = {
        storage: memoryStorage(), t: Date.UTC(2026, 9, 24, 9), plan: 'family', pages: [], random: rng(seed * 7919), log: [], removed: new Set(),
        guard: false, gateOpened: false, lockedSnap: new Map(),
      };
      w.pages.push(newPage(w, 'A', true), newPage(w, 'B', true));
      check(w, 0, seed);
      for (let s = 1; s <= 120; s++) {
        step(w);
        check(w, s, seed);
      }
    });
  }
});
