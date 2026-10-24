// The bridge between a Session and the Room (session-bridge.ts), with a Session and a Room side made by hand.
import { describe, expect, it } from 'vitest';
import type { PauseReason, SessionEvents, SessionState, Unsubscribe } from '../types/index.ts';
import type { NetPauseReason } from '../types/net.ts';
import { NET_REASON, bridgeSession, type RaceSide } from './session-bridge.ts';

class FakeSession {
  state: SessionState = 'idle';
  private readonly ls = new Map<string, Set<(e: never) => void>>();
  on<K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): Unsubscribe {
    const set = this.ls.get(k) ?? this.ls.set(k, new Set()).get(k)!;
    set.add(cb as (e: never) => void);
    return () => { set.delete(cb as (e: never) => void); };
  }
  listeners(k: string): number { return this.ls.get(k)?.size ?? 0; }
  go(s: SessionState): void { this.state = s; for (const f of [...(this.ls.get('state') ?? [])]) (f as (e: SessionState) => void)(s); }
  pause(r: PauseReason): void { this.state = 'paused'; for (const f of [...(this.ls.get('state') ?? [])]) (f as (e: SessionState) => void)('paused'); for (const f of [...(this.ls.get('pause') ?? [])]) (f as (e: PauseReason) => void)(r); }
}

function side(): { s: RaceSide; log: string[]; held: Set<NetPauseReason> } {
  const log: string[] = [];
  const held = new Set<NetPauseReason>();
  return {
    log, held,
    s: {
      ready: (on) => { log.push(`ready ${on}`); },
      pause: (r) => { held.add(r); log.push(`pause ${r}`); },
      unpause: (r) => { held.delete(r); log.push(`unpause ${r}`); },
    },
  };
}

describe('the Session of a race talks to the Room', () => {
  it('names every pause reason of the Session in the Room\'s words', () => {
    const all: PauseReason[] = ['user', 'hidden', 'person_lost', 'player_lost', 'camera_ended', 'recalibrate'];
    expect(Object.keys(NET_REASON).sort()).toEqual([...all].sort());
    expect(all.map((r) => NET_REASON[r])).toEqual(['user', 'hidden', 'framing', 'framing', 'camera', 'calibrating']);
  });

  it('holds the match while the player calibrates, presses ready when calibration ends, and holds nothing after', () => {
    const se = new FakeSession();
    const { s, log, held } = side();
    bridgeSession(se, s);
    se.go('setup');
    se.go('calibrating');
    expect([...held]).toEqual(['calibrating']);
    se.go('countdown');
    expect(held.size).toBe(0);
    expect(log).toEqual(['pause calibrating', 'unpause calibrating', 'ready true']);
    se.go('running');
    expect(log.filter((x) => x.startsWith('ready'))).toHaveLength(1);              // once, not at every step of the Session
  });

  it('holds a pause for its reason and lets it go when the Session counts down again', () => {
    const se = new FakeSession();
    const { s, log, held } = side();
    bridgeSession(se, s);
    se.go('running');
    log.length = 0;
    se.pause('camera_ended');
    expect([...held]).toEqual(['camera']);
    se.go('calibrating');                                                          // the camera comes back: calibration again
    expect([...held]).toEqual(['calibrating']);
    se.go('countdown');
    expect(held.size).toBe(0);
    // the new reason was taken before the old one was given back, so the Room never woke up in between
    expect(log).toEqual(['pause camera', 'pause calibrating', 'unpause camera', 'unpause calibrating']);
  });

  it('says "framing" for a person out of the picture, "hidden" for a hidden tab and "user" for the pause button', () => {
    const se = new FakeSession();
    const { s, held } = side();
    bridgeSession(se, s);
    se.go('running');
    se.pause('person_lost');
    expect([...held]).toEqual(['framing']);
    se.go('running');
    se.pause('hidden');
    expect([...held]).toEqual(['hidden']);
    se.go('running');
    se.pause('user');
    expect([...held]).toEqual(['user']);
    se.go('results');
    expect(held.size).toBe(0);
  });

  it('gives every hold back when the stage is left, and stops listening', () => {
    const se = new FakeSession();
    const { s, held, log } = side();
    const off = bridgeSession(se, s);
    se.go('running');
    se.pause('user');
    expect(held.size).toBe(1);
    off();
    expect(held.size).toBe(0);
    expect(se.listeners('pause') + se.listeners('state')).toBe(0);
    log.length = 0;
    se.pause('hidden');
    se.go('calibrating');
    expect(log).toEqual([]);
    off();                                                                         // twice is harmless
  });

  it('can leave the ready button to the stage', () => {
    const se = new FakeSession();
    const { s, log } = side();
    bridgeSession(se, s, { autoReady: false });
    se.go('calibrating');
    se.go('countdown');
    expect(log.some((x) => x.startsWith('ready'))).toBe(false);
  });

  it('starts from the state the Session is in now', () => {
    const se = new FakeSession();
    se.state = 'calibrating';
    const { s, held } = side();
    bridgeSession(se, s);
    expect([...held]).toEqual(['calibrating']);
  });
});
