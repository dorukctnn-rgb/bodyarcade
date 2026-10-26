// The recordings a player keeps (ghost-book.ts).
import { describe, expect, it } from 'vitest';
import type { ObstacleResult } from '../types/net.ts';
import { courseOf, runFromResults, runScore, type GhostRun } from './ghost.ts';
import { FRIENDS_MAX, GhostBook, OWN_MAX } from './ghost-book.ts';
import type { KeyValueStore } from './identity.ts';

const AT = Date.UTC(2026, 9, 24, 14, 0);

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

function run(o: { gameId?: string; seed?: number; durationMs?: number; pass?: number; name?: string; source?: GhostRun['source']; at?: number } = {}): GhostRun {
  const gameId = o.gameId ?? 'squat-flap', seed = o.seed ?? 11, durationMs = o.durationMs ?? 45_000;
  const results: ObstacleResult[] = courseOf({ gameId, seed, durationMs }).map((ob, i) => ({ ob: ob.id, k: i < (o.pass ?? 5) ? 'pass' : 'hit' }));
  return runFromResults({ gameId, seed, durationMs, results, name: o.name ?? 'Ada', at: o.at ?? AT, source: o.source ?? 'own' });
}

describe('your best runs', () => {
  it('keeps the best of each game and length, replaces it only with a better one, and says which happened', () => {
    const book = new GhostBook(memory());
    expect(book.best('squat-flap', 45_000)).toBeNull();
    expect(book.offer(run({ pass: 5 }))).toBe('best');
    expect(book.offer(run({ pass: 4, seed: 12 }))).toBe('kept');
    expect(book.offer(run({ pass: 5, seed: 13 }))).toBe('kept');                       // a tie keeps the older run
    expect(book.best('squat-flap', 45_000)?.seed).toBe(11);
    expect(book.offer(run({ pass: 9, seed: 14 }))).toBe('best');
    expect(book.best('squat-flap', 45_000)?.seed).toBe(14);
    // another length and another game have their own
    expect(book.best('squat-flap', 60_000)).toBeNull();
    expect(book.offer(run({ durationMs: 60_000, pass: 2 }))).toBe('best');
    expect(book.offer(run({ gameId: 'knee-sprint', pass: 1 }))).toBe('best');
    expect(book.bests()).toHaveLength(3);
  });

  it('is the same after a restart of the page, and a run that was kept is the run that comes back', () => {
    const store = memory();
    const a = new GhostBook(store);
    a.offer(run({ pass: 8 }));
    a.addFriend(run({ source: 'friend', name: 'Mert', seed: 5 }));
    const b = new GhostBook(store);
    expect(b.best('squat-flap', 45_000)).toEqual(a.best('squat-flap', 45_000));
    expect(b.friends()).toEqual(a.friends());
    expect(b.friends()[0]?.name).toBe('Mert');
  });

  it('refuses what is not a recording and lets nothing in as another kind', () => {
    const book = new GhostBook(memory());
    expect(book.offer({ ...run(), outcomes: 'zzz' })).toBe('invalid');
    expect(book.offer({ ...run(), seed: -3 })).toBe('invalid');
    expect(book.offer(run({ source: 'bot' }))).toBe('best');                         // taken as the player's own run, whatever it was called
    expect(book.best('squat-flap', 45_000)?.source).toBe('own');
    expect(book.addFriend({ ...run({ source: 'friend' }), outcomes: 'p' })).toBe(false);
    expect(book.addFriend(run({ source: 'own', name: 'Zed' }))).toBe(true);
    expect(book.friends()[0]?.source).toBe('friend');
  });

  it('keeps no more than OWN_MAX, the newest', () => {
    const book = new GhostBook(memory());
    for (let i = 0; i < OWN_MAX + 6; i++) book.offer(run({ gameId: `game-${String(i).padStart(2, '0')}`, at: AT + i * 60_000 }));
    expect(book.bests()).toHaveLength(OWN_MAX);
    expect(book.best('game-00', 45_000)).toBeNull();
    expect(book.best(`game-${OWN_MAX + 5}`, 45_000)).not.toBeNull();
  });
});

describe('your friends\' recordings', () => {
  it('are saved once, newest first, of one game when asked, and can be removed', () => {
    const book = new GhostBook(memory());
    const ada = run({ source: 'friend', name: 'Ada', seed: 1, at: AT });
    const mert = run({ source: 'friend', name: 'Mert', seed: 2, at: AT + 60_000 });
    const kneeAda = run({ source: 'friend', name: 'Ada', gameId: 'knee-sprint', seed: 3, at: AT + 120_000 });
    expect(book.addFriend(ada)).toBe(true);
    expect(book.addFriend(ada)).toBe(false);
    expect(book.addFriend(mert)).toBe(true);
    expect(book.addFriend(kneeAda)).toBe(true);
    expect(book.friends().map((r) => r.name + r.gameId)).toEqual(['Adaknee-sprint', 'Mertsquat-flap', 'Adasquat-flap']);
    expect(book.friends('squat-flap').map((r) => r.name)).toEqual(['Mert', 'Ada']);
    expect(book.removeFriend(mert)).toBe(true);
    expect(book.removeFriend(mert)).toBe(false);
    expect(book.friends()).toHaveLength(2);
  });

  it('keep no more than FRIENDS_MAX, the newest, and never a skeleton', () => {
    const book = new GhostBook(memory());
    for (let i = 0; i < FRIENDS_MAX + 5; i++) book.addFriend(run({ source: 'friend', seed: 100 + i, at: AT + i * 60_000, name: `F${i}` }));
    expect(book.friends()).toHaveLength(FRIENDS_MAX);
    expect(book.friends().at(-1)?.name).toBe('F5');
    expect(book.friends().every((r) => r.track === undefined)).toBe(true);
  });
});

describe('a store that cannot be trusted', () => {
  it('starts empty from damaged text, drops the entries that are not recordings and keeps the ones that are', () => {
    for (const raw of ['not json', '[]', '{"v":1}', '{"own":5,"friends":"x"}', '']) {
      const store = memory();
      store.data.set('ba.ghosts.v1', raw);
      const book = new GhostBook(store);
      expect(book.bests()).toEqual([]);
      expect(book.friends()).toEqual([]);
      expect(book.offer(run())).toBe('best');                                        // and it works from there
    }
    const store = memory();
    const good = run({ pass: 6 });
    store.data.set('ba.ghosts.v1', JSON.stringify({ v: 1, own: [{ junk: true }, good, { ...good, gameId: 'x' }, { ...good, source: 'friend', seed: 2 }], friends: [run({ source: 'friend' }), { ...run({ source: 'friend' }), outcomes: 'p' }, good] }));
    const book = new GhostBook(store);
    expect(book.bests()).toEqual([good]);
    expect(book.friends()).toHaveLength(1);
  });

  it('goes on in memory when the store refuses to read or to write', () => {
    const broken: KeyValueStore = { get: () => { throw new Error('blocked'); }, set: () => { throw new Error('full'); } };
    const book = new GhostBook(broken);
    expect(book.offer(run({ pass: 3 }))).toBe('best');
    expect(book.best('squat-flap', 45_000)).not.toBeNull();
    expect(book.addFriend(run({ source: 'friend', seed: 9 }))).toBe(true);
    expect(book.friends()).toHaveLength(1);
  });

  it('forgets everything on request, and the store with it', () => {
    const store = memory();
    const book = new GhostBook(store);
    book.offer(run());
    book.addFriend(run({ source: 'friend', seed: 4 }));
    book.clear();
    expect(book.bests()).toEqual([]);
    expect(new GhostBook(store).friends()).toEqual([]);
    expect(runScore(run()).score).toBeGreaterThan(0);
  });
});
