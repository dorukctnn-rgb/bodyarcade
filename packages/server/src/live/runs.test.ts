// What the Room hands over at the end of a match so that a run can be kept as a recording (MatchResult.runs, LiveRace.runOf): in a
// private room every seat's run, in a public room nothing; the run a player keeps is the one the Room scored.
import { describe, expect, it } from 'vitest';
import { GhostBook } from '../../../core/net/ghost-book.ts';
import { GhostRace } from '../../../core/net/ghost-race.ts';
import { courseOf, decodeRun, encodeRun, outcomeString, resultsOf, runScore, standingAt } from '../../../core/net/ghost.ts';
import { ghostFrame } from '../../../core/net/pose-frame.ts';
import { LiveRace } from '../../../core/net/race.ts';
import { scoreOf } from '../../../core/net/schedule.ts';
import { LANDMARK_COUNT, type Landmark } from '../../../core/types/index.ts';
import type { Outcome } from '../../../core/types/net.ts';
import { Net, seeded } from './loopkit.ts';

const body = (k: number): Landmark[] => Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 0.3 + ((i + k) % 8) * 0.05, y: 0.1 + (i / LANDMARK_COUNT) * 0.8, z: 0, visibility: 1 }));

async function racer(net: Net, pid: string, name: string): Promise<LiveRace> {
  return LiveRace.attach(net.grant(pid, { n: name }), {
    who: { pid, name, age: 'adult' }, origin: 'http://loop', peers: 'none', pauseWhenHidden: false,
    blocks: { load: () => [], save: () => undefined }, client: { sched: net.sched, socket: net.factory, random: seeded(pid) },
  });
}

/** Both players race the whole course (each with their own pace of passes and hits) and the Room settles. */
async function raced(init: Parameters<typeof Net.make>[0]): Promise<{ net: Net; a: LiveRace; b: LiveRace }> {
  const net = await Net.make(init);
  const a = await racer(net, 'alice-device-01', 'Alice');
  const b = await racer(net, 'bob-device-0002', 'Bob');
  net.run(1500);
  a.ready(); b.ready();
  net.run(400);
  const m = a.match!;
  net.run(m.startAt - net.room.host.now());
  const pick = (seat: string, i: number): Outcome => (seat === 's1' ? (i % 5 === 4 ? 'hit' : 'pass') : (i % 2 === 0 ? 'pass' : 'hit'));
  // the clock runs in fifths of a second, the pages report each obstacle when it comes and Alice's page sends her body each time
  let next = 0;
  for (let ms = 0; ms < m.duration; ms += 200) {
    net.run(Math.max(0, m.startAt + ms - net.room.host.now()));
    while (next < a.course.length && (a.course[next] as { t: number }).t <= ms) {
      const o = a.course[next] as { id: number };
      a.report(o.id, pick('s1', next));
      b.report(o.id, pick('s2', next));
      next++;
    }
    a.sendPose(body(ms / 200));
  }
  net.run(Math.max(0, m.startAt + m.duration - net.room.host.now()) + 3000);
  return { net, a, b };
}

describe('the runs of a private room', () => {
  it('are in the result for every seat, as the Room scored them, and are the same on both devices', async () => {
    const { a, b } = await raced({ size: 2, config: { gameId: 'squat-flap', durationMs: 30_000, band: null } });
    const res = a.result!.result;
    expect(res.reason).toBe('complete');
    expect(res.runs).toBeTruthy();
    expect(b.result?.result.runs).toEqual(res.runs);
    const course = a.course;
    for (const seat of ['s1', 's2']) {
      const run = a.runOf(seat)!;
      expect(run).toBeTruthy();
      expect(run.outcomes).toBe((res.runs as Record<string, string>)[seat]);
      expect(run.outcomes).toHaveLength(course.length);
      expect(runScore(run)).toEqual(res.scores[seat]);
    }
  });

  it('give each player their own run (with their name and skeleton) and the friend\'s as a recording of the friend, by name', async () => {
    const { a, b } = await raced({ size: 2, config: { gameId: 'squat-flap', durationMs: 30_000, band: null } });
    const mine = a.lastRun!;
    expect(mine).toMatchObject({ source: 'own', name: 'Alice', gameId: 'squat-flap', seed: a.match!.seed, durationMs: 30_000 });
    expect(mine.track).toBeTruthy();                                                // the player's own skeleton, kept on this device
    const theirs = a.runOf('s2')!;
    expect(theirs).toMatchObject({ source: 'friend', name: 'Bob' });
    expect(theirs.track).toBeUndefined();
    // bob never sent a pose
    expect(b.lastRun?.track).toBeUndefined();
    expect(b.runOf('s1')).toMatchObject({ source: 'friend', name: 'Alice', outcomes: mine.outcomes });
    // what a friend sends as a code is what the other side keeps
    expect(decodeRun(encodeRun(mine))).toMatchObject({ source: 'friend', name: 'Alice', outcomes: mine.outcomes, seed: mine.seed });
  });

  it('become a ghost race on the spot: the friend\'s recording stands where the friend stood at every moment of the match', async () => {
    const { a } = await raced({ size: 2, config: { gameId: 'squat-flap', durationMs: 30_000, band: null } });
    const book = new GhostBook({ get: () => null, set: () => undefined });
    expect(book.addFriend(a.runOf('s2')!)).toBe(true);
    expect(book.offer(a.lastRun!)).toBe('best');
    const rec = book.friends()[0]!;
    const ghost = new GhostRace(rec, { now: () => 0 });
    expect(ghost.label).toMatchObject({ key: 'ghost.label.friend', name: 'Bob' });
    const course = courseOf(rec);
    expect(standingAt(rec, Infinity, course).score).toBe(a.result!.result.scores['s2']?.score);
    // the score of the friend in the live match, obstacle by obstacle, is the recording's standing at that obstacle's time
    const byOb = new Map(resultsOf(rec).map((e) => [e.ob, e.k]));
    let sofar = scoreOf(course, [...byOb].slice(0, 3).map(([ob, k]) => ({ ob, k }))).score;
    expect(standingAt(rec, (course[2] as { t: number }).t, course).score).toBe(sofar);
    sofar = scoreOf(course, [...byOb].slice(0, 7).map(([ob, k]) => ({ ob, k }))).score;
    expect(standingAt(rec, (course[6] as { t: number }).t, course).score).toBe(sofar);
    expect(outcomeString(course, resultsOf(rec))).toBe(rec.outcomes);
  });

  it('are only for the match that just ended, and a seat that is not in the room has none', async () => {
    const { a } = await raced({ size: 2, config: { gameId: 'squat-flap', durationMs: 30_000, band: null } });
    expect(a.runOf('s9')).toBeNull();
    expect(a.runOf('')).toBeNull();
  });

  it('give a seat that left in the middle the part it played, and nothing for the rest', async () => {
    const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs: 30_000, band: null } });
    const a = await racer(net, 'alice-device-01', 'Alice');
    const b = await racer(net, 'bob-device-0002', 'Bob');
    net.run(1500);
    a.ready(); b.ready();
    net.run(400);
    const m = a.match!;
    net.run(m.startAt - net.room.host.now());
    const played = a.course.slice(0, 4);
    for (const o of played) {
      net.run(Math.max(0, m.startAt + o.t - net.room.host.now()));
      a.report(o.id, 'pass'); b.report(o.id, 'pass');
    }
    net.run(500);
    b.leave();
    net.run(5000);
    const res = a.result!.result;
    expect(res.forfeited).toEqual(['s2']);
    const run = a.runOf('s2')!;
    expect(run.outcomes.slice(0, 4)).toBe('pppp');
    expect(/^\.+$/.test(run.outcomes.slice(4))).toBe(true);
    expect(runScore(run).passes).toBe(4);
  });
});

describe('a public room', () => {
  it('sends no runs, so a stranger\'s run is never kept, while the player still has their own score', async () => {
    const { a, b } = await raced({ kind: 'public', size: 2, audience: 'adult', config: { gameId: 'squat-flap', durationMs: 30_000, band: 'medium' } });
    expect(a.result!.result.runs).toBeUndefined();
    expect(b.result!.result.runs).toBeUndefined();
    expect(a.runOf('s2')).toBeNull();
    expect(a.lastRun).toBeNull();
    expect(a.result!.score?.score).toBeGreaterThan(0);
  });
});

describe('the frame a page sends keeps its shape', () => {
  it('is what the board of the other page reads (the check that the pose of a run and the pose of a frame are one thing)', () => {
    expect(ghostFrame(100, 5, body(1)).p).toHaveLength(26);
  });
});
