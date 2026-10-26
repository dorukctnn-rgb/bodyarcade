// A profile's namespace as the plain key-value shape of live play's books: the ghost book of a profile lives in that profile's record.
import { describe, expect, it } from 'vitest';
import { courseOf, runFromResults, type GhostRun } from '../net/ghost.ts';
import { GhostBook } from '../net/ghost-book.ts';
import { keyValueOf } from './keyvalue.ts';
import { createProfileBook } from './profiles.ts';
import { createStore, memoryStorage } from './store.ts';

const KEY = 'ba.ghosts.v1';            // the key live play's ghost book writes (core/net/ghost-book.ts)

function rig() {
  const storage = memoryStorage();
  const store = createStore({ storage, now: () => Date.UTC(2026, 9, 24, 12), timeZone: 'UTC' });
  return { storage, store };
}

describe('keyValueOf', () => {
  it('reads what it wrote, as the same text, and null for what is not there', () => {
    const { store } = rig();
    const kv = keyValueOf(store.ns('ghosts'));
    expect(kv.get(KEY)).toBeNull();
    const text = JSON.stringify({ v: 1, own: [{ n: 'x'.repeat(5000) }], friends: [] });
    kv.set(KEY, text);
    expect(kv.get(KEY)).toBe(text);
    kv.set(KEY, '');
    expect(kv.get(KEY)).toBeNull();                                       // text that is empty is nothing, as in localStorage's absence
  });

  it('writes under the namespace\'s own prefix and key, nowhere else', () => {
    const { storage, store } = rig();
    keyValueOf(store.ns('ghosts')).set(KEY, 'abc');
    expect(Object.keys(storage.dump())).toEqual(['ba2.ghosts.ba.ghosts.v1']);
    expect(store.withPrefix('ba2p2').ns('ghosts').keys()).toEqual([]);
  });

  it('never throws: a key the store does not take, a value that is not text, a damaged entry', () => {
    const { storage, store } = rig();
    const kv = keyValueOf(store.ns('ghosts'));
    expect(() => kv.set('not a key!', 'x')).not.toThrow();
    expect(kv.get('not a key!')).toBeNull();
    expect(() => kv.set(KEY, 42 as never)).not.toThrow();
    expect(kv.get(KEY)).toBeNull();
    storage.setItem('ba2.ghosts.ba.ghosts.v1', '{this is not json');
    expect(kv.get(KEY)).toBeNull();
  });

  it('a read-only namespace (a look at somebody else\'s record, a locked profile) keeps what it had', () => {
    const { store } = rig();
    keyValueOf(store.ns('ghosts')).set(KEY, 'mine');
    const look = keyValueOf(store.withPrefix('ba2', { readOnly: true }).ns('ghosts'));
    expect(look.get(KEY)).toBe('mine');
    look.set(KEY, 'changed');
    expect(look.get(KEY)).toBe('mine');
  });

  it('gives each profile a book of its own, and a look at another profile\'s book that cannot change it', () => {
    const { storage, store } = rig();
    const book = createProfileBook({ store, can: () => true, ownerName: 'Ayşe' });
    const kid = book.create({ name: 'Defne', kid: true });
    expect(kid.ok).toBe(true);
    keyValueOf(book.open().store.ns('ghosts')).set(KEY, 'owner recordings');
    const space = (book.switchTo('p2') as { space: ReturnType<typeof book.open> }).space;
    expect(keyValueOf(space.store.ns('ghosts')).get(KEY)).toBeNull();     // the kid does not see the owner's, nor friends' that came with it
    keyValueOf(space.store.ns('ghosts')).set(KEY, 'kid recordings');
    const look = book.peek('p1');
    expect(look).not.toBeNull();
    const ownerBook = keyValueOf((look as NonNullable<typeof look>).store.ns('ghosts'));
    expect(ownerBook.get(KEY)).toBe('owner recordings');                  // the family races each other's bests
    ownerBook.set(KEY, 'tampered');
    expect(ownerBook.get(KEY)).toBe('owner recordings');
    expect(Object.keys(storage.dump()).filter((k) => k.includes('.ghosts.')).sort()).toEqual(['ba2.ghosts.ba.ghosts.v1', 'ba2p2.ghosts.ba.ghosts.v1']);
    // deleting the kid's profile takes its recordings with it
    const plan = book.planRemoval('p2');
    expect(plan.ok).toBe(false);                                          // a kid asks the parent gate first
    const asked = book.gate.ask();
    if (!asked.ok) throw new Error('gate closed');
    book.gate.answer(asked.question.id, asked.question.a * asked.question.b);
    const again = book.planRemoval('p2');
    if (!again.ok) throw new Error('planRemoval refused');
    expect(book.remove('p2', again.token)).toMatchObject({ ok: true });
    expect(Object.keys(storage.dump()).filter((k) => k.includes('.ghosts.'))).toEqual(['ba2.ghosts.ba.ghosts.v1']);
  });
});

describe('live play\'s real ghost book on a profile\'s record', () => {
  const AT = Date.UTC(2026, 9, 24, 12);
  const bestOf = (name: string, pass: number): GhostRun => {
    const results = courseOf({ gameId: 'squat-flap', seed: 11, durationMs: 45_000 }).map((ob, i) => ({ ob: ob.id, k: i < pass ? ('pass' as const) : ('hit' as const) }));
    return runFromResults({ gameId: 'squat-flap', seed: 11, durationMs: 45_000, results, name, at: AT, source: 'own' });
  };

  it('keeps each profile\'s bests in that profile\'s record; the family races them through a look that cannot write', () => {
    const { store } = rig();
    const book = createProfileBook({ store, can: () => true, ownerName: 'Ayşe' });
    expect(book.create({ name: 'Defne', kid: true }).ok).toBe(true);
    const mine = bestOf('Ayşe', 8);
    const owner = new GhostBook(keyValueOf(book.open().store.ns('ghosts')));
    expect(owner.offer(mine)).toBe('best');
    // a new book on the same record (the next page) finds it
    expect(new GhostBook(keyValueOf(book.open().store.ns('ghosts'))).best('squat-flap', 45_000)?.outcomes).toBe(mine.outcomes);
    // the kid has a book of its own, empty, and races the owner's recording through a look
    const kidSpace = (book.switchTo('p2') as { space: ReturnType<typeof book.open> }).space;
    const kid = new GhostBook(keyValueOf(kidSpace.store.ns('ghosts')));
    expect(kid.bests()).toEqual([]);
    const look = book.peek('p1');
    if (!look) throw new Error('no look at the owner');
    const seen = new GhostBook(keyValueOf(look.store.ns('ghosts')));
    expect(seen.best('squat-flap', 45_000)?.outcomes).toBe(mine.outcomes);
    seen.clear();                                                           // a look cannot write: nothing of it reaches the owner's record
    seen.offer(bestOf('Ayşe', 1));
    const again = new GhostBook(keyValueOf((book.peek('p1') as NonNullable<ReturnType<typeof book.peek>>).store.ns('ghosts')));
    expect(again.best('squat-flap', 45_000)?.outcomes).toBe(mine.outcomes);
    expect(new GhostBook(keyValueOf(kidSpace.store.ns('ghosts'))).bests()).toEqual([]);   // and none of it reaches the kid's
  });
});
