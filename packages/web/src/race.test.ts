// A race on the stage without a browser: what an address asks for, which recording it stands for, what a player may race, how a
// recording is told that the player is ready or held, and what a ghost race says when it ends. The stage itself (the plates, the
// 3-2-1, the result screen) is the end-to-end test's (e2e/race.spec.ts).
import { describe, expect, it, vi } from 'vitest';
import { GhostBook } from '../../core/net/ghost-book.ts';
import { courseOf, decodeRun, encodeRun, runFromResults, type GhostRun } from '../../core/net/ghost.ts';
import { GhostRace } from '../../core/net/ghost-race.ts';
import type { KeyValueStore } from '../../core/net/identity.ts';
import { ManualScheduler } from '../../core/net/testkit.ts';
import type { ObstacleResult } from '../../core/types/net.ts';
import { codeIn, ghostMenu, ghostParam, ghostRunOf, ghostSource, parseGhost, plateName, raceMsOf, sideOfGhost, specOfRun, type RaceWorld } from './app/race.ts';

const AT = Date.UTC(2026, 9, 24, 14, 0);
const memory = (): KeyValueStore => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } }; };
const GAME = { id: 'squat-flap', durationSec: 270 };
const MS = raceMsOf(GAME);

/** What a player did with each obstacle of a course: the first `pass` obstacles passed, the rest hit. */
function recording(pass: number, o: { source?: GhostRun['source']; name?: string; game?: string; durationMs?: number; at?: number } = {}): GhostRun {
  const base = { gameId: o.game ?? 'squat-flap', seed: 77, durationMs: o.durationMs ?? MS };
  const results: ObstacleResult[] = courseOf(base).map((ob, i) => ({ ob: ob.id, k: i < pass ? 'pass' : 'hit' }));
  return runFromResults({ ...base, results, name: o.name ?? 'Ada', at: o.at ?? AT, source: o.source ?? 'friend' });
}

function world(o: Partial<RaceWorld> = {}): RaceWorld {
  return { game: GAME, ghosts: new GhostBook(memory()), now: () => AT, seed: () => 4242, ...o };
}

describe('how long a race lasts', () => {
  it('is the round of the game within half a minute and a minute and a half', () => {
    expect(raceMsOf({ durationSec: 270 })).toBe(90_000);
    expect(raceMsOf({ durationSec: 60 })).toBe(60_000);
    expect(raceMsOf({ durationSec: 20 })).toBe(30_000);
  });
});

describe('what an address asks for', () => {
  it('reads each kind, and a bare code is what a friend\'s link carries', () => {
    const code = encodeRun(recording(6));
    expect(parseGhost('own')).toEqual({ kind: 'own' });
    expect(parseGhost('practice')).toEqual({ kind: 'practice', level: 'medium' });
    expect(parseGhost('practice:hard')).toEqual({ kind: 'practice', level: 'hard' });
    expect(parseGhost('family:p3')).toEqual({ kind: 'family', id: 'p3' });
    expect(parseGhost(`code:${code}`)).toEqual({ kind: 'code', text: code });
    expect(parseGhost(code)).toEqual({ kind: 'code', text: code });
    expect(parseGhost(` ${code} `)).toEqual({ kind: 'code', text: code });
  });

  it('says nothing for what it does not understand: no level, no profile, a short word, a script, nothing', () => {
    for (const bad of ['practice:extreme', 'practice:', 'family:', 'family:p0', 'family:x1', 'family:p1000', 'code:short', 'abc', '<script>', 'javascript:alert(1)', '', '   ', null, undefined, 'a'.repeat(401)]) {
      expect(parseGhost(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it('writes a spec back as the value the buttons put in the address, and the two agree', () => {
    const run = recording(5);
    for (const spec of [{ kind: 'own' as const }, { kind: 'practice' as const, level: 'easy' as const }, { kind: 'family' as const, id: 'p2' }, specOfRun(run)]) {
      expect(parseGhost(ghostParam(spec)), JSON.stringify(spec)).toEqual(spec);
    }
    expect(specOfRun(run)).toEqual({ kind: 'code', text: encodeRun(run) });
  });

  it('finds the code in a pasted code or in a pasted link, and nowhere else', () => {
    const code = encodeRun(recording(6));
    expect(codeIn(code)).toBe(code);
    expect(codeIn(`  ${code}\n`)).toBe(code);
    expect(codeIn(`https://bodyarcade.com/games/squat-flap/?ghost=${code}`)).toBe(code);
    expect(codeIn(`https://bodyarcade.com/play/squat-flap/?input=camera&ghost=code:${code}`)).toBe(code);
    for (const bad of ['', '   ', 'hello there', 'https://bodyarcade.com/games/squat-flap/', 'https://bodyarcade.com/?ghost=own', 'https://', 'not a link at all but long enough to look like a code']) {
      expect(codeIn(bad), bad).toBeNull();
    }
  });
});

describe('the recording an address stands for', () => {
  it('is the player\'s own best of this game and length, and nothing before there is one', () => {
    const w = world();
    expect(ghostRunOf({ kind: 'own' }, w)).toBeNull();
    const mine = recording(8, { source: 'own', name: 'Ayşe' });
    expect(w.ghosts.offer(mine)).toBe('best');
    expect(ghostRunOf({ kind: 'own' }, w)).toEqual(mine);
    // a best of another length is not this race's
    const other = world();
    other.ghosts.offer(recording(8, { source: 'own', durationMs: MS - 15_000 }));
    expect(ghostRunOf({ kind: 'own' }, other)).toBeNull();
  });

  it('is a practice partner on a new course at the level asked, labelled as a bot and with no name', () => {
    const w = world();
    const easy = ghostRunOf({ kind: 'practice', level: 'easy' }, w) as GhostRun;
    const hard = ghostRunOf({ kind: 'practice', level: 'hard' }, w) as GhostRun;
    expect(easy).toMatchObject({ source: 'bot', name: '', gameId: 'squat-flap', durationMs: MS, seed: 4242 });
    expect(easy.outcomes).toHaveLength(courseOf(easy).length);
    const passes = (r: GhostRun): number => [...r.outcomes].filter((c) => c === 'p').length;
    expect(passes(hard)).toBeGreaterThan(passes(easy));
    expect(ghostRunOf({ kind: 'practice', level: 'easy' }, world({ seed: () => 1 }))?.seed).toBe(1);
  });

  it('is the best of another player of this device when they have one', () => {
    const kid = new GhostBook(memory());
    kid.offer(recording(9, { source: 'own', name: 'Defne' }));
    const w = world({ family: (id) => (id === 'p2' ? kid : null) });
    expect(ghostRunOf({ kind: 'family', id: 'p2' }, w)?.name).toBe('Defne');
    expect(ghostRunOf({ kind: 'family', id: 'p3' }, w)).toBeNull();
    expect(ghostRunOf({ kind: 'family', id: 'p2' }, world())).toBeNull();
  });

  it('is the recording in a code, when it is of this game, and never one that is of another game or damaged', () => {
    const w = world();
    const theirs = recording(7, { name: 'Ada' });
    const run = ghostRunOf(specOfRun(theirs), w) as GhostRun;
    expect(run).toMatchObject({ name: 'Ada', source: 'friend', gameId: 'squat-flap' });
    expect(run.outcomes).toBe(theirs.outcomes);
    const knee = recording(7, { game: 'knee-sprint', durationMs: 60_000 });
    expect(ghostRunOf(specOfRun(knee), w)).toBeNull();
    const code = encodeRun(theirs);
    expect(ghostRunOf({ kind: 'code', text: `${code.slice(0, -3)}AAA` }, w)).toBeNull();
    expect(ghostRunOf({ kind: 'code', text: 'AAAAAAAAAAAAAAAAAAAAAAAA' }, w)).toBeNull();
  });
});

describe('what a player may race', () => {
  const kid = new GhostBook(memory());
  kid.offer(recording(9, { source: 'own', name: 'Defne' }));
  const others = [{ id: 'p2', name: 'Defne', avatar: 'fox' as const, ghosts: kid }, { id: 'p3', name: 'Mert', avatar: 'robot' as const, ghosts: new GhostBook(memory()) }];

  it('is, for the main player: their best, the recordings of friends of this length, the bests of the family, three practice levels and a code', () => {
    const mine = new GhostBook(memory());
    mine.offer(recording(6, { source: 'own', name: 'Ayşe' }));
    mine.addFriend(recording(5, { name: 'Ada' }));
    mine.addFriend(recording(5, { name: 'Bora', durationMs: MS - 15_000 }));
    mine.addFriend(recording(5, { name: 'Can', game: 'knee-sprint', durationMs: 60_000 }));
    const menu = ghostMenu({ game: GAME, ghosts: mine, rules: { ghosts: 'all' }, others });
    expect(menu.own?.name).toBe('Ayşe');
    expect(menu.friends.map((r) => r.name)).toEqual(['Ada']);
    expect(menu.family.map((f) => f.name)).toEqual(['Defne']);
    expect(menu.levels).toEqual(['easy', 'medium', 'hard']);
    expect(menu.code).toBe(true);
  });

  it('is, for a child: their best, the bests of the family and the practice partner, and no stranger\'s recording and no code', () => {
    const mine = new GhostBook(memory());
    mine.addFriend(recording(5, { name: 'Ada' }));
    const menu = ghostMenu({ game: GAME, ghosts: mine, rules: { ghosts: 'family' }, others });
    expect(menu.own).toBeNull();
    expect(menu.friends).toEqual([]);
    expect(menu.family).toHaveLength(1);
    expect(menu.levels).toHaveLength(3);
    expect(menu.code).toBe(false);
  });
});

describe('how a recording is told the player is ready or held', () => {
  it('starts when the player is ready, and ignores "not ready"', () => {
    const ghost = { start: vi.fn(), hold: vi.fn() };
    const side = sideOfGhost(ghost);
    side.ready(false);
    expect(ghost.start).not.toHaveBeenCalled();
    side.ready(true);
    expect(ghost.start).toHaveBeenCalledTimes(1);
  });

  it('is held for as long as any reason holds the player, and let go only when the last one is gone', () => {
    const ghost = { start: vi.fn(), hold: vi.fn() };
    const side = sideOfGhost(ghost);
    side.pause('camera');
    side.pause('framing');        // the bridge moves from one reason to the next: the new one first
    side.unpause('camera');
    expect(ghost.hold).toHaveBeenLastCalledWith(true);
    expect(ghost.hold).not.toHaveBeenCalledWith(false);
    side.unpause('framing');
    expect(ghost.hold).toHaveBeenLastCalledWith(false);
    side.unpause('framing');      // a reason that is not held changes nothing more
    expect(ghost.hold.mock.calls.filter((c) => c[0] === false)).toHaveLength(2);
  });
});

describe('a ghost race as the stage\'s other side', () => {
  const clock = (): ManualScheduler => new ManualScheduler();

  function run(o: { book?: GhostBook; share?: boolean; ghost?: GhostRun; you?: 'perfect' | 'none' } = {}) {
    const sched = clock();
    const ghost = new GhostRace(o.ghost ?? recording(6, { source: 'friend', name: 'Ada' }), { now: () => sched.now(), name: 'Ayşe', ...(o.book ? { book: o.book } : {}) });
    const source = ghostSource(ghost, { share: o.share ?? true });
    source.side.ready(true);
    sched.advance(3000);
    const g = ghost.run;
    const results: ObstacleResult[] = courseOf(g).map((ob) => ({ ob: ob.id, k: o.you === 'none' ? 'hit' : 'pass' }));
    for (const e of results) ghost.report(e.ob, e.k);
    ghost.finish(results);
    return { ghost, source, sched };
  }

  it('shows the recording as the one rival, with its name and a score that grows with the race', () => {
    const sched = clock();
    const ghost = new GhostRace(recording(20, { name: 'Ada' }), { now: () => sched.now() });
    const source = ghostSource(ghost, { share: true });
    const seen: number[][] = [];
    source.onRivals((r) => seen.push(r.map((x) => x.score)));
    expect(source.kind).toBe('ghost');
    expect(source.label).toMatchObject({ key: 'ghost.label.friend', name: 'Ada' });
    expect(source.rivals()).toEqual([{ seat: 'ghost', name: 'Ada', score: 0 }]);
    source.side.ready(true);
    sched.advance(3000 + 30_000);
    ghost.time();
    expect(source.rivals()[0]?.score).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('says who won and by how much when the race is over, and keeps the player\'s best in their book', () => {
    const book = new GhostBook(memory());
    const { source } = run({ book, ghost: recording(4, { name: 'Ada' }), you: 'perfect' });
    const out = source.outcome();
    expect(out).toMatchObject({ kind: 'ghost', won: true, lost: false, draw: false, best: 'best' });
    expect(out?.margin).toBeGreaterThan(0);
    expect(out?.you).toBeGreaterThan(out?.rivals[0]?.score ?? 0);
    expect(out?.rivals[0]).toMatchObject({ name: 'Ada' });
    expect(book.best('squat-flap', MS)).not.toBeNull();
    // the run to send decodes to the same course with the player's name
    const back = decodeRun(out?.code ?? '');
    expect(back).toMatchObject({ gameId: 'squat-flap', name: 'Ayşe' });
  });

  it('says the recording won when it did, and keeps the old best when this run is no better', () => {
    const book = new GhostBook(memory());
    book.offer(recording(8, { source: 'own', name: 'Ayşe' }));
    const { source } = run({ book, ghost: recording(8, { name: 'Ada' }), you: 'none' });
    const out = source.outcome();
    expect(out).toMatchObject({ won: false, lost: true, best: 'kept' });
    expect(out?.margin).toBeLessThan(0);
  });

  it('sends no code when sending is not allowed (a child\'s screens), and keeps nothing without a book', () => {
    const { source } = run({ share: false, you: 'perfect' });
    const out = source.outcome();
    expect(out?.code).toBeNull();
    expect(out?.best).toBe('none');
  });

  it('has no outcome before the race is over, and nothing more to call once it is left', () => {
    const sched = clock();
    const ghost = new GhostRace(recording(3), { now: () => sched.now() });
    const source = ghostSource(ghost, { share: true });
    expect(source.outcome()).toBeNull();
    source.leave();
    source.sendPose?.(null);
    expect(source.feed.phase()).toBe('over');
  });
});

describe('the name of a recording on a plate', () => {
  const t = { t: (k: string) => ({ 'race.plate.own': 'Your best', 'race.plate.bot': 'Practice bot', 'race.plate.recording': 'Recording' })[k] ?? k };

  it('is short, says "bot" for a bot and the friend\'s own name for a friend\'s run', () => {
    const label = (source: GhostRun['source'], name: string) => ({ key: source === 'own' ? 'ghost.label.own' : source === 'bot' ? 'ghost.label.bot' : name ? 'ghost.label.friend' : 'ghost.label.recording', name, at: AT, source }) as never;
    expect(plateName(label('own', 'Ayşe'), t)).toBe('Your best');
    expect(plateName(label('bot', ''), t)).toBe('Practice bot');
    expect(plateName(label('friend', 'Ada'), t)).toBe('Ada');
    expect(plateName(label('friend', ''), t)).toBe('Recording');
  });
});
