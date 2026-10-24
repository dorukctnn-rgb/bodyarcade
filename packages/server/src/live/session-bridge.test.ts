// A Session bridged to the real Room (session-bridge.ts): the friend's match is held while this player's camera, framing or
// calibration says so, and goes on with the Room's own 3-2-1 the moment it is clear.
import { describe, expect, it } from 'vitest';
import { LiveClient } from '../../../core/net/client.ts';
import { bridgeSession, sideOfClient } from '../../../core/net/session-bridge.ts';
import type { PauseReason, SessionEvents, SessionState, Unsubscribe } from '../../../core/types/index.ts';
import { Net, seeded } from './loopkit.ts';

class FakeSession {
  state: SessionState = 'idle';
  private readonly ls = new Map<string, Set<(e: never) => void>>();
  on<K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): Unsubscribe {
    const set = this.ls.get(k) ?? this.ls.set(k, new Set()).get(k)!;
    set.add(cb as (e: never) => void);
    return () => { set.delete(cb as (e: never) => void); };
  }
  private emit(k: string, e: unknown): void { for (const f of [...(this.ls.get(k) ?? [])]) (f as (x: unknown) => void)(e); }
  go(s: SessionState): void { this.state = s; this.emit('state', s); }
  pause(r: PauseReason): void { this.state = 'paused'; this.emit('state', 'paused'); this.emit('pause', r); }
}

/** The 3-2-1 left on the Room clock, in ms (0 when the match is on). */
function countdownLeft(c: LiveClient): number {
  const m = c.match;
  if (!m || m.phase !== 'running') return 0;
  const now = c.serverNow();
  return Math.max(0, m.startAt + m.pauseTotal - now, m.resumeAt !== null ? m.resumeAt - now : 0);
}

async function started() {
  const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs: 40_000, band: null } });
  const mk = (pid: string): LiveClient => {
    const c = new LiveClient({ grant: net.grant(pid), origin: 'http://loop', peers: 'none', sched: net.sched, socket: net.factory, random: seeded(pid) });
    void c.start();
    return c;
  };
  const a = mk('alice-device-01');
  const b = mk('bob-device-0002');
  const phases: string[] = [];
  b.on('phase', (d) => { phases.push(`${d.why}:${d.match.phase}`); });
  net.run(1500);
  const se = new FakeSession();
  const off = bridgeSession(se, sideOfClient(a));
  return { net, a, b, se, off, phases };
}

describe('a race with the Session bridged to the Room', () => {
  it('starts when this player has calibrated (not before) and the friend is ready', async () => {
    const { net, a, b, se } = await started();
    b.setReady(true);
    se.go('setup');
    se.go('calibrating');
    net.run(2000);
    expect(a.match).toBeNull();                                                      // the friend waits for a calibration
    se.go('countdown');
    net.run(500);
    expect(a.match?.phase).toBe('running');
    expect(b.match?.id).toBe(a.match?.id);
    se.go('running');
  });

  it('holds the friend\'s match for a lost camera, a recalibration and a hidden tab, and resumes it with the Room\'s 3-2-1 once', async () => {
    const { net, a, b, se, phases } = await started();
    b.setReady(true);
    se.go('calibrating');
    se.go('countdown');
    se.go('running');
    net.run(8000);                                                                   // well into the match
    expect(b.match?.phase).toBe('running');

    se.pause('camera_ended');
    net.run(300);
    expect(b.match?.phase).toBe('paused');
    expect(b.match?.reasons).toEqual({ s1: 'camera' });
    se.go('calibrating');                                                            // the camera is back, the Session calibrates again
    net.run(2000);
    expect(b.match?.phase).toBe('paused');
    expect(b.match?.reasons).toEqual({ s1: 'calibrating' });
    expect(phases.filter((p) => p === 'resumed:running')).toHaveLength(0);           // never woke up between the two reasons
    se.go('countdown');
    net.run(300);
    expect(b.match?.phase).toBe('running');
    expect(b.match?.resumeAt).not.toBeNull();                                        // the Room's own 3-2-1
    se.go('running');
    net.run(4000);
    expect(countdownLeft(b)).toBe(0);

    se.pause('hidden');
    net.run(300);
    expect(b.match?.reasons).toEqual({ s1: 'hidden' });
    se.go('countdown');
    net.run(4000);
    expect(b.match?.phase).toBe('running');
    expect(a.match?.pauseTotal).toBe(b.match?.pauseTotal);
  });

  it('gives the hold back when the stage is left, so the friend is not left waiting for a page that is gone', async () => {
    const { net, b, se, off } = await started();
    b.setReady(true);
    se.go('calibrating');
    se.go('countdown');
    se.go('running');
    net.run(6000);
    se.pause('user');
    net.run(300);
    expect(b.match?.phase).toBe('paused');
    off();
    net.run(300);
    expect(b.match?.phase).toBe('running');
  });
});
