// The optional friend camera, one state per rival (builder N). A match never depends on it: the Room relay carries the
// race state, the results and the chat, and the friend is drawn as a skeleton from the same state frames. So the camera is
// either on the screen or it is not, and when it is not the player is told why in one plain line and offered a retry:
//
//   off         nobody asked for it (one side has not opted in, no camera, the friend is away)
//   connecting  both opted in: the link to the friend is being made, the first picture has not come yet
//   live        the friend's picture is arriving
//   failed      no picture within VIDEO_CONNECT_MS, or the link broke for good. The skeleton stays on the screen, the
//               link keeps trying in the background (a picture that arrives later turns this back into 'live' by itself)
//               and the retry button makes a brand new attempt at once.
//
// There is no state that waits for ever: a link that has not produced a picture by the deadline is 'failed', whatever it was
// doing (still checking the network paths, connected but silent, or broken). Pure logic on a clock the caller provides, so every
// transition is tested without a browser.
import type { SeatId } from '../types/net.ts';

export type VideoState = 'off' | 'connecting' | 'live' | 'failed';

/**
 * Why there is no picture (only with state 'failed'):
 *   timeout      the link never came up in time (no path between the two devices: strict networks and no relay server)
 *   ice_failed   the browser gave up on every path
 *   no_track     the link is up but the friend's picture never started
 *   unsupported  this device cannot make peer links at all (nothing to retry)
 */
export type VideoReason = 'timeout' | 'ice_failed' | 'no_track' | 'unsupported';

export interface VideoStatus {
  seat: SeatId;
  state: VideoState;
  reason: VideoReason | null;
  /** A new attempt can be made now (false: no camera link is wanted, or this device cannot make one). */
  retryable: boolean;
  /** How many times the player asked for a new attempt for this friend. */
  attempts: number;
  /** Local time in ms at which this state began. */
  since: number;
}

/** What the client knows about one friend's camera link at this moment. */
export interface VideoProbe {
  /** Both sides opted in, this device has a camera on, and the friend is in the room and online. */
  wanted: boolean;
  /** This device can make peer links (WebRTC is there and has not failed). */
  supported: boolean;
  /** The friend's picture is arriving: a live video track that is not muted. */
  flowing: boolean;
  /** The ICE state of the link ('new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed'), or null with no link. */
  ice: string | null;
  /** The friend's video track has been negotiated (it may not carry a picture yet). */
  track: boolean;
}

/** How long a link may take to bring the first picture before the player is told it did not work. */
export const VIDEO_CONNECT_MS = 8000;
/** Retries for one friend are at least this far apart. */
export const VIDEO_RETRY_GAP_MS = 2000;
/** A picture that stops for less than this is still 'live' (a packet or two lost); a longer stop starts a new deadline. */
export const VIDEO_STALL_MS = 2500;

export const NO_VIDEO = (seat: SeatId, now: number): VideoStatus => ({ seat, state: 'off', reason: null, retryable: false, attempts: 0, since: now });

export class VideoTracker {
  private readonly now: () => number;
  private readonly onChange: (s: VideoStatus) => void;
  private readonly connectMs: number;
  private readonly by = new Map<SeatId, VideoStatus>();
  private readonly lastRetry = new Map<SeatId, number>();
  private readonly flowAt = new Map<SeatId, number>();

  constructor(now: () => number, onChange: (s: VideoStatus) => void, connectMs = VIDEO_CONNECT_MS) {
    this.now = now;
    this.onChange = onChange;
    this.connectMs = connectMs;
  }

  status(seat: SeatId): VideoStatus {
    return this.by.get(seat) ?? NO_VIDEO(seat, this.now());
  }

  /** Every friend with a camera link that is wanted or has been (state other than 'off'), in seat order. */
  all(): VideoStatus[] {
    return [...this.by.values()].filter((s) => s.state !== 'off').sort((a, b) => (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0));
  }

  /** Judges one friend's link from what the client sees now. Call it whenever something changes and on every tick. */
  update(seat: SeatId, p: VideoProbe): VideoStatus {
    const prev = this.by.get(seat);
    const now = this.now();
    let next: VideoStatus;
    if (!p.wanted) {
      if (!prev || prev.state === 'off') return prev ?? NO_VIDEO(seat, now);
      // The friend switched the camera off, left, or this player did: attempts start over with the next opt-in.
      next = NO_VIDEO(seat, now);
      this.lastRetry.delete(seat);
      this.flowAt.delete(seat);
    } else if (!p.supported) {
      next = prev && prev.state === 'failed' && prev.reason === 'unsupported' ? prev : { seat, state: 'failed', reason: 'unsupported', retryable: false, attempts: prev?.attempts ?? 0, since: now };
    } else if (p.flowing) {
      this.flowAt.set(seat, now);
      next = prev && prev.state === 'live' ? prev : { seat, state: 'live', reason: null, retryable: true, attempts: prev?.attempts ?? 0, since: now };
    } else if (prev && prev.state === 'live' && now - (this.flowAt.get(seat) ?? 0) < VIDEO_STALL_MS) {
      next = prev;                                             // a short stall is not a reason to take the picture away
    } else if (!prev || prev.state === 'off' || prev.state === 'live') {
      // Just wanted (or the picture stopped): a fresh deadline starts now.
      next = { seat, state: 'connecting', reason: null, retryable: true, attempts: prev && prev.state === 'live' ? prev.attempts : 0, since: now };
    } else if (prev.state === 'connecting') {
      const dead = p.ice === 'failed';
      if (dead || now - prev.since >= this.connectMs) {
        const reason: VideoReason = dead ? 'ice_failed' : p.track || p.ice === 'connected' || p.ice === 'completed' ? 'no_track' : 'timeout';
        next = { seat, state: 'failed', reason, retryable: true, attempts: prev.attempts, since: now };
      } else next = prev;
    } else if (prev.state === 'failed' && prev.reason === 'unsupported') {
      // The device can make links again (nothing changed it in practice, but the state must not stick): start over.
      next = { seat, state: 'connecting', reason: null, retryable: true, attempts: prev.attempts, since: now };
    } else {
      next = prev;                                             // still failed: stays so until a picture arrives or a retry
    }
    if (next !== prev) {
      this.by.set(seat, next);
      this.onChange(next);
    }
    return next;
  }

  /**
   * The player pressed "try again" for this friend (or the client does it for them). Returns false when there is nothing to
   * retry: no camera link is wanted, the device cannot make one, or the last attempt was a moment ago.
   */
  retry(seat: SeatId): boolean {
    const cur = this.by.get(seat);
    const now = this.now();
    if (!cur || (cur.state !== 'failed' && cur.state !== 'connecting') || !cur.retryable) return false;
    const last = this.lastRetry.get(seat);
    if (last !== undefined && now - last < VIDEO_RETRY_GAP_MS) return false;
    this.lastRetry.set(seat, now);
    const next: VideoStatus = { seat, state: 'connecting', reason: null, retryable: true, attempts: cur.attempts + 1, since: now };
    this.by.set(seat, next);
    this.onChange(next);
    return true;
  }

  /** A seat left the room: its state goes with it. */
  forget(seat: SeatId): void {
    const prev = this.by.get(seat);
    this.by.delete(seat);
    this.lastRetry.delete(seat);
    this.flowAt.delete(seat);
    if (prev && prev.state !== 'off') this.onChange(NO_VIDEO(seat, this.now()));
  }

  clear(): void {
    for (const seat of [...this.by.keys()]) this.forget(seat);
  }
}
