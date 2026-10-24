// The bridge between a platform Session and the Room for one race (builder N). The Session knows the camera, the calibration and
// the pause button; the Room knows the match clock. This forwards what one has to tell the other, so the stage of a race does not
// have to know the Room's rules:
//
//   - the player is READY the moment calibration has ended (the Room starts its own 3-2-1 once everyone present is ready);
//   - the Session's pause reasons become the Room's (camera lost, person out of frame, tab hidden, the pause button, a recalibration
//     in the middle of the match), so the match is held for the friends for as long as this player's reason lasts, and goes on with
//     the Room's own 3-2-1 the moment it is gone. The Session's countdown after a pause is released at once: the game waits for the
//     Room's time either way (duelGame), and two countdowns one after the other would cost the friends six seconds, not three.
//
//   const off = bridgeSession(session, sideOfClient(client));   // or sideOfRace(race)
//   ...                                                          // the stage is left: off() gives every hold back
import type { PauseReason, Session, SessionState, Unsubscribe } from '../types/index.ts';
import type { NetPauseReason } from '../types/net.ts';
import type { LiveClient } from './client.ts';
import type { LiveRace } from './race.ts';

/** What the Session's pause reason is called in the Room. */
export const NET_REASON: Readonly<Record<PauseReason, NetPauseReason>> = {
  user: 'user',
  hidden: 'hidden',
  person_lost: 'framing',
  player_lost: 'framing',
  camera_ended: 'camera',
  recalibrate: 'calibrating',
};

/** The three things a stage tells the Room. */
export interface RaceSide {
  ready(on: boolean): void;
  pause(reason: NetPauseReason): void;
  unpause(reason: NetPauseReason): void;
}

export const sideOfClient = (c: Pick<LiveClient, 'setReady' | 'pause' | 'unpause'>): RaceSide => ({
  ready: (on) => c.setReady(on), pause: (r) => c.pause(r), unpause: (r) => c.unpause(r),
});

export const sideOfRace = (r: Pick<LiveRace, 'ready' | 'pause' | 'unpause'>): RaceSide => ({
  ready: (on) => r.ready(on), pause: (x) => r.pause(x), unpause: (x) => r.unpause(x),
});

export interface BridgeOptions {
  /** Press ready when calibration ends (default). Off: the stage presses it itself (a lobby that asks first). */
  autoReady?: boolean;
}

/** Returns the function that ends the bridge and gives back every hold it still has in the Room. */
export function bridgeSession(session: Pick<Session, 'on' | 'state'>, side: RaceSide, o: BridgeOptions = {}): Unsubscribe {
  /** The one reason the bridge holds in the Room for this Session: the last thing that stopped the player. */
  let held: NetPauseReason | null = null;
  let readySent = false;
  let off = false;

  const hold = (next: NetPauseReason): void => {
    if (off || held === next) return;
    const prev = held;
    held = next;
    side.pause(next);                    // the new reason first: the match must not wake up between two reasons
    if (prev) side.unpause(prev);
  };
  const release = (): void => {
    if (!held) return;
    const r = held;
    held = null;
    side.unpause(r);
  };
  const onState = (s: SessionState): void => {
    if (off) return;
    if (s === 'calibrating') hold('calibrating');
    else if (s === 'countdown' || s === 'running') {
      release();
      if (!readySent && o.autoReady !== false) { readySent = true; side.ready(true); }
    } else if (s === 'results' || s === 'idle' || s === 'error') release();
    // 'paused' says nothing by itself: its 'pause' event carries the reason
  };

  const offs: Unsubscribe[] = [
    session.on('pause', (r) => hold(NET_REASON[r])),
    session.on('state', onState),
  ];
  onState(session.state);
  return () => {
    if (off) return;
    release();
    off = true;
    for (const f of offs.splice(0)) f();
  };
}
