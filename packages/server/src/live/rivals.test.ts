// The friends' skeletons through the real Room: what a page sends with sendPose is what the other page's board holds, over the
// Room relay (no peer link here), checked on arrival, gone when the frames stop or the friend leaves.
import { describe, expect, it } from 'vitest';
import { LiveRace } from '../../../core/net/race.ts';
import { POSE_STALE_MS } from '../../../core/net/pose-frame.ts';
import { LANDMARK_COUNT, type Landmark } from '../../../core/types/index.ts';
import { Net, seeded } from './loopkit.ts';

const body = (shift = 0): Landmark[] => Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 0.3 + shift + (i % 5) * 0.05, y: 0.1 + (i / LANDMARK_COUNT) * 0.8, z: 0, visibility: 1 }));

async function racer(net: Net, pid: string): Promise<LiveRace> {
  return LiveRace.attach(net.grant(pid), {
    who: { pid, name: pid.slice(0, 5), age: 'adult' }, origin: 'http://loop', peers: 'none', pauseWhenHidden: false,
    blocks: { load: () => [], save: () => undefined }, client: { sched: net.sched, socket: net.factory, random: seeded(pid) },
  });
}

async function started(): Promise<{ net: Net; a: LiveRace; b: LiveRace }> {
  const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs: 30_000, band: null } });
  const a = await racer(net, 'alice-device-01');
  const b = await racer(net, 'bob-device-0002');
  net.run(1500);
  a.ready(); b.ready();
  net.run(4500);
  return { net, a, b };
}

describe('the skeleton of a friend', () => {
  it('arrives with the score and the match time, and is the body the friend\'s page saw', async () => {
    const { net, a, b } = await started();
    expect(b.rivals.pose('s1')).toBeNull();
    net.run(2000);
    expect(a.sendPose(body())).toBe(true);
    net.run(100);
    const pose = b.rivals.pose('s1') as Landmark[];
    expect(pose).toHaveLength(LANDMARK_COUNT);
    expect(Math.abs((pose[11] as Landmark).x - (body()[11] as Landmark).x)).toBeLessThan(0.01);
    expect(b.rivals.score('s1')).toBe(0);
    expect(b.rivals.matchTime('s1')).toBeGreaterThan(0);
    // the sender does not see itself
    expect(a.rivals.seats()).toEqual([]);
  });

  it('carries the score even when no body is seen, and a frame with a bad pose still gives its score', async () => {
    const { net, a, b } = await started();
    net.run(2000);
    a.client.sendState({ mt: 2000, sc: 300 });
    net.run(100);
    expect(b.rivals.score('s1')).toBe(300);
    expect(b.rivals.pose('s1')).toBeNull();
    a.client.sendState({ mt: 2100, sc: 400, p: [1, 2, 3] });
    net.run(100);
    expect(b.rivals.score('s1')).toBe(400);
    expect(b.rivals.pose('s1')).toBeNull();
  });

  it('ignores what is not a frame, and a frame that lies about itself', async () => {
    const { net, a, b } = await started();
    net.run(2000);
    a.sendPose(body());
    net.run(100);
    for (const junk of ['x', 7, null, [1, 2], { mt: 'a', sc: 1 }, { mt: 5, sc: -9 }, { mt: 5, sc: 2.5 }, { mt: 1e12, sc: 5 }]) {
      a.client.sendState(junk);
      net.run(100);
    }
    expect(b.rivals.score('s1')).toBe(0);                                          // the last good frame still stands
    expect(b.rivals.pose('s1')).not.toBeNull();
  });

  it('goes when the frames stop (no frozen figure), and when the friend leaves the room', async () => {
    const { net, a, b } = await started();
    net.run(2000);
    a.sendPose(body());
    net.run(100);
    expect(b.rivals.pose('s1')).not.toBeNull();
    net.run(POSE_STALE_MS + 100);
    expect(b.rivals.pose('s1')).toBeNull();
    a.sendPose(body());
    net.run(100);
    expect(b.rivals.pose('s1')).not.toBeNull();
    a.leave();
    net.run(300);
    expect(b.rivals.seats()).toEqual([]);
  });

  it('starts empty in the next match (the old scores and bodies are not carried over)', async () => {
    const { net, a, b } = await started();
    net.run(2000);
    a.sendPose(body());
    net.run(100);
    expect(b.rivals.seats()).toEqual(['s1']);
    net.run(60_000);                                                               // the match ends without either page finishing: the Room settles it
    expect(b.result).not.toBeNull();
    a.rematch(); b.rematch();
    net.run(4500);
    expect(b.match?.phase).toBe('running');
    expect(b.rivals.seats()).toEqual([]);
  });
});
