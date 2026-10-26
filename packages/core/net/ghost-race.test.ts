// A race against a recording (ghost-race.ts): its clock, its holds, the rival of the plates, the result and the run that is kept.
import { describe, expect, it } from 'vitest';
import type { Landmark } from '../types/index.ts';
import type { ObstacleResult } from '../types/net.ts';
import { courseOf, decodeRun, encodeRun, runFromResults, runScore, standingAt, trackPoseAt, type GhostRun } from './ghost.ts';
import { GhostBook } from './ghost-book.ts';
import { GHOST, GhostRace, YOU } from './ghost-race.ts';
import type { KeyValueStore } from './identity.ts';
import { LANDMARK_COUNT } from '../types/index.ts';
import { scoreOf } from './schedule.ts';
import { ManualScheduler } from './testkit.ts';

const AT = Date.UTC(2026, 9, 24, 14, 0);
const memory = (): KeyValueStore => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } }; };

function recording(pass: number, o: { source?: GhostRun['source']; name?: string } = {}): GhostRun {
  const base = { gameId: 'squat-flap', seed: 2024, durationMs: 45_000 };
  const results: ObstacleResult[] = courseOf(base).map((ob, i) => ({ ob: ob.id, k: i < pass ? 'pass' : 'hit' }));
  return runFromResults({ ...base, results, name: o.name ?? 'Ada', at: AT, source: o.source ?? 'friend' });
}

function race(run: GhostRun, o: ConstructorParameters<typeof GhostRace>[1] = {}): { r: GhostRace; clock: ManualScheduler } {
  const clock = new ManualScheduler();
  return { r: new GhostRace(run, { now: () => clock.now(), ...o }), clock };
}

const bodyAt = (k: number): Landmark[] => Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 0.3 + ((i + k) % 8) * 0.05, y: 0.1 + (i / LANDMARK_COUNT) * 0.8, z: 0, visibility: 1 }));

describe('the clock of a race against a recording', () => {
  it('waits for the player, then counts 3-2-1, then runs on its own clock with negative time before zero', () => {
    const { r, clock } = race(recording(5));
    expect(r.phase()).toBe('wait');
    expect(r.match()).toBeNull();
    expect(r.countdownMs()).toBe(0);
    r.start();
    expect(r.phase()).toBe('count');
    expect(r.countdownMs()).toBe(3000);
    expect(r.time()).toBe(-3000);
    expect(r.match()).toEqual({ id: expect.any(String), seed: 2024, durationMs: 45_000, gameId: 'squat-flap', results: [] });
    clock.advance(1000);
    expect(r.time()).toBe(-2000);
    expect(r.countdownMs()).toBe(2000);
    clock.advance(2000);
    expect(r.phase()).toBe('run');
    expect(r.time()).toBe(0);
    clock.advance(12_345);
    expect(r.time()).toBe(12_345);
    expect(r.countdownMs()).toBe(0);
  });

  it('starts once, however often it is asked', () => {
    const { r, clock } = race(recording(5));
    r.start();
    clock.advance(500);
    r.start();
    expect(r.time()).toBe(-2500);
  });

  it('stands still while the player is held, and gives a new 3-2-1 before it goes on from where it stood', () => {
    const { r, clock } = race(recording(5));
    r.start();
    clock.advance(3000 + 10_000);
    expect(r.time()).toBe(10_000);
    r.hold(true);
    expect(r.phase()).toBe('hold');
    clock.advance(25_000);                                                      // a long pause: the camera was gone
    expect(r.time()).toBe(10_000);
    r.hold(false);
    expect(r.phase()).toBe('count');
    expect(r.countdownMs()).toBe(3000);
    clock.advance(1500);
    expect(r.time()).toBe(10_000);                                              // the game stands still during the 3-2-1
    clock.advance(1500);
    expect(r.phase()).toBe('run');
    clock.advance(2000);
    expect(r.time()).toBe(12_000);
    r.hold(false);                                                              // freeing a player who is not held does nothing
    expect(r.time()).toBe(12_000);
  });

  it('begins the first 3-2-1 again when the player is held before time zero', () => {
    const { r, clock } = race(recording(5));
    r.start();
    clock.advance(1000);
    r.hold(true);
    clock.advance(9000);
    r.hold(false);
    expect(r.countdownMs()).toBe(3000);
    clock.advance(3000);
    expect(r.time()).toBe(0);
    expect(r.phase()).toBe('run');
  });

  it('cannot be held before it is started or after it is over', () => {
    const { r, clock } = race(recording(5));
    r.hold(true);
    expect(r.phase()).toBe('wait');
    r.start();
    clock.advance(10_000);
    r.finish([]);
    r.hold(true);
    expect(r.phase()).toBe('over');
    expect(r.match()).toBeNull();
    expect(r.time()).toBe(45_000);
  });
});

describe('the recording as the rival of the plates', () => {
  it('has the score the recording had at that moment, tells when it changes, and is labelled', () => {
    const run = recording(12);
    const course = courseOf(run);
    const { r, clock } = race(run);
    const seen: number[] = [];
    r.onRivals((list) => seen.push(list[0]?.score ?? -1));
    expect(r.label).toMatchObject({ key: 'ghost.label.friend', name: 'Ada', source: 'friend' });
    expect(r.rivals()).toEqual([{ seat: GHOST, name: 'Ada', score: 0 }]);
    r.start();
    clock.advance(3000);
    for (const o of course.slice(0, 14)) {
      clock.advance(Math.max(0, o.t - r.time()) + 10);
      expect(r.time()).toBeGreaterThanOrEqual(o.t);
      expect(r.rivals()[0]?.score).toBe(standingAt(run, o.t, course).score);
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);                               // told once per change, not at every frame
    expect(r.standing().passes).toBe(12);
    expect(r.standing().hits).toBe(2);
  });

  it('stops telling after the plates are dropped', () => {
    const { r, clock } = race(recording(12));
    const seen: number[] = [];
    const off = r.onRivals((list) => seen.push(list[0]?.score ?? -1));
    r.start();
    clock.advance(8000);
    r.time();
    const n = seen.length;
    expect(n).toBeGreaterThan(0);
    off();
    clock.advance(20_000);
    r.time();
    expect(seen).toHaveLength(n);
  });

  it('is a bot when it is one: no name, never a person', () => {
    const { r } = race({ ...recording(5, { source: 'bot' }), name: '' });
    expect(r.label).toMatchObject({ key: 'ghost.label.bot', name: '' });
    expect(r.rivals()[0]?.name).toBe('');
  });
});

describe('the end of the race', () => {
  const play = (r: GhostRace, clock: ManualScheduler, pass: number): ObstacleResult[] => {
    r.start();
    clock.advance(3000);
    const results = courseOf(r.run).map((o, i): ObstacleResult => ({ ob: o.id, k: i < pass ? 'pass' : 'hit' }));
    for (const e of results) { clock.advance(500); r.report(e.ob, e.k); }
    return results;
  };

  it('scores you and the recording by the Room\'s own rules and says who won, by how much', () => {
    const better = race(recording(8));
    const a = play(better.r, better.clock, 14);
    better.r.finish(a);
    const res = better.r.result()!;
    expect(res.reason).toBe('complete');
    expect(res.winner).toBe(YOU);
    expect(res.places).toEqual({ [YOU]: 1, [GHOST]: 2 });
    expect(res.scores[YOU]).toEqual(scoreOf(courseOf(better.r.run), a));
    expect(res.scores[GHOST]).toEqual(runScore(better.r.run));
    const out = better.r.outcome()!;
    expect(out).toMatchObject({ won: true, lost: false, draw: false, best: 'none' });
    expect(out.margin).toBe(out.you.score - out.ghost.score);
    expect(out.margin).toBeGreaterThan(0);

    const worse = race(recording(14));
    const b = play(worse.r, worse.clock, 6);
    worse.r.finish(b);
    expect(worse.r.outcome()).toMatchObject({ won: false, lost: true, draw: false });
    expect(worse.r.result()?.winner).toBe(GHOST);

    const same = race(recording(9));
    const c = play(same.r, same.clock, 9);
    same.r.finish(c);
    expect(same.r.outcome()).toMatchObject({ won: false, lost: false, draw: true, margin: 0 });
    expect(same.r.result()?.winner).toBeNull();
    expect(same.r.result()?.places).toEqual({ [YOU]: 1, [GHOST]: 1 });
  });

  it('counts the first outcome of an obstacle, ignores one that is not on the course, and ends once', () => {
    const { r, clock } = race(recording(5));
    r.start();
    clock.advance(4000);
    const first = courseOf(r.run)[0]!;
    r.report(first.id, 'pass');
    r.report(first.id, 'hit');
    r.report(9999, 'pass');
    r.finish([{ ob: first.id, k: 'hit' }, { ob: 9999, k: 'pass' }]);
    expect(r.outcome()?.you).toMatchObject({ passes: 1, hits: 0 });
    r.finish([{ ob: courseOf(r.run)[1]!.id, k: 'pass' }]);
    expect(r.outcome()?.you.passes).toBe(1);
    r.report(courseOf(r.run)[2]!.id, 'pass');
    expect(r.outcome()?.you.passes).toBe(1);
  });

  it('shows the whole recording on the plates when it is over, and tells the plates once more', () => {
    const run = recording(10);
    const { r, clock } = race(run);
    const seen: number[] = [];
    r.onRivals((l) => seen.push(l[0]?.score ?? -1));
    r.start();
    clock.advance(3000 + 5000);
    r.time();
    r.finish([]);
    expect(r.rivals()[0]?.score).toBe(runScore(run).score);
    expect(seen.at(-1)).toBe(runScore(run).score);
  });

  it('gives you the run you made, as your own: kept when it is your best, sendable as a code, never carrying the friend\'s name', () => {
    const book = new GhostBook(memory());
    const { r, clock } = race(recording(5, { name: 'Ada' }), { book, name: 'Doruk' });
    const results = play(r, clock, 12);
    r.finish(results);
    const out = r.outcome()!;
    expect(out.best).toBe('best');
    expect(out.run).toMatchObject({ source: 'own', name: 'Doruk', gameId: 'squat-flap', seed: 2024, durationMs: 45_000 });
    expect(runScore(out.run)).toEqual(out.you);
    expect(book.best('squat-flap', 45_000)).toEqual(out.run);
    expect(decodeRun(encodeRun(out.run))).toMatchObject({ source: 'friend', name: 'Doruk', outcomes: out.run.outcomes });
    // a worse run next time does not take the place
    const again = race(recording(5), { book, name: 'Doruk' });
    again.r.finish(play(again.r, again.clock, 3));
    expect(again.r.outcome()?.best).toBe('kept');
    expect(book.best('squat-flap', 45_000)).toEqual(out.run);
  });

  it('is left without a trace when the stage is closed in the middle', () => {
    const book = new GhostBook(memory());
    const { r, clock } = race(recording(5), { book });
    r.start();
    clock.advance(9000);
    r.report(courseOf(r.run)[0]!.id, 'pass');
    r.dispose();
    expect(r.outcome()).toBeNull();
    expect(r.result()).toBeNull();
    expect(r.phase()).toBe('over');
    expect(book.bests()).toEqual([]);
  });
});

describe('the skeleton', () => {
  it('your own is kept at five a second while you play, and comes back in the next race against that run', () => {
    const book = new GhostBook(memory());
    const first = race(recording(5), { book, name: 'Me' });
    first.r.start();
    first.clock.advance(3000);
    first.r.sendPose(bodyAt(0));                                                // during the 3-2-1 nothing is kept
    for (let i = 0; i < 400; i++) { first.clock.advance(100); first.r.sendPose(bodyAt(i)); }
    const results = courseOf(first.r.run).map((o): ObstacleResult => ({ ob: o.id, k: 'pass' }));
    first.r.finish(results);
    const mine = first.r.outcome()!.run;
    expect(mine.track).toBeTruthy();
    expect(trackPoseAt(mine.track, 1000)).not.toBeNull();

    const second = race(mine);
    expect(second.r.pose()).not.toBeNull();                                     // before the start the ghost stands in its first pose
    second.r.start();
    second.clock.advance(3000 + 2000);
    const pose = second.r.pose();
    expect(pose).toHaveLength(LANDMARK_COUNT);
    expect(pose?.filter((p) => p.visibility > 0).length).toBe(13);
  });

  it('is missing for a friend\'s recording and for a bot (they carry none)', () => {
    const { r, clock } = race(recording(5));
    r.start();
    clock.advance(9000);
    expect(r.pose()).toBeNull();
  });

  it('is not kept from a body that was seen for less than three seconds', () => {
    const { r, clock } = race(recording(5));
    r.start();
    clock.advance(3000);
    for (let i = 0; i < 8; i++) { clock.advance(200); r.sendPose(bodyAt(i)); }
    r.sendPose(null);
    r.finish([]);
    expect(r.outcome()?.run.track).toBeUndefined();
  });
});
