// Server clock estimate for live play (tech.md 2.6, 9.2). Each ping gives an offset whose error is at most rtt / 2,
// so the best estimate comes from the samples with the smallest round trips: pings answered while either main thread
// was busy have long round trips and simply lose. A 60 s pool keeps recent samples; the estimate is the median
// offset of the three best. During play the offset never jumps: it slews towards a new estimate by at most 5 ms per
// second (a jump would move obstacles under the player's feet).

export interface ClockSample {
  /** Round trip of this ping (ms). */
  rtt: number;
  /** server time - local time, as this ping measured it (ms). */
  off: number;
  /** Local time the reply arrived (ms). */
  at: number;
}

export interface ClockInfo {
  offset: number;
  rtt: number;
  /** rtt / 2: the largest error the estimate can have. */
  err: number;
  samples: number;
  synced: boolean;
  good: boolean;
}

export const POOL_MS = 60_000;
export const POOL_MAX = 60;
export const MIN_SAMPLES = 3;
export const SLEW_MS_PER_S = 5;
/** A difference this large is not drift but a step (the device clock was set, a long sleep): adopt it at once. */
export const SNAP_MS = 250;

export class ClockFilter {
  private pool: ClockSample[] = [];
  private target = 0;
  private current = 0;
  private lastAt = 0;
  private rttBest = Infinity;
  private bestEver = Infinity;
  private isSynced = false;
  private slew = false;

  /** A provisional offset from a message that carries the server time but no round trip (the welcome). */
  provisional(serverTime: number, localNow: number): void {
    if (this.isSynced) return;
    this.current = this.target = serverTime - localNow;
    this.lastAt = localNow;
  }

  /** Slew mode: while a match runs the offset glides instead of jumping. */
  setSlew(on: boolean): void {
    this.slew = on;
  }

  /** Adds a ping result; returns true when the estimate moved by more than half a millisecond. */
  add(rtt: number, serverTime: number, localNow: number): boolean {
    if (!(rtt >= 0) || !Number.isFinite(rtt) || !Number.isFinite(serverTime)) return false;
    // the reply arrived `rtt` after the send; the server stamped its time about half way
    const off = serverTime + rtt / 2 - localNow;
    this.pool.push({ rtt, off, at: localNow });
    while (this.pool.length > POOL_MAX || (this.pool.length > 0 && localNow - (this.pool[0] as ClockSample).at > POOL_MS)) this.pool.shift();
    if (rtt < this.bestEver) this.bestEver = rtt;
    if (this.pool.length < MIN_SAMPLES) return false;
    const best = [...this.pool].sort((a, b) => a.rtt - b.rtt).slice(0, MIN_SAMPLES);
    const offs = best.map((s) => s.off).sort((a, b) => a - b);
    const target = offs[Math.floor(offs.length / 2)] as number;
    const moved = !this.isSynced || Math.abs(target - this.target) > 0.5;
    this.rttBest = (best[0] as ClockSample).rtt;
    this.advance(localNow);
    this.target = target;
    if (!this.isSynced || !this.slew || Math.abs(target - this.current) > SNAP_MS) { this.current = target; this.lastAt = localNow; }
    this.isSynced = true;
    return moved;
  }

  /** The offset to use at `localNow` (applies slewing for the time that passed). */
  offset(localNow: number): number {
    this.advance(localNow);
    return this.current;
  }

  private advance(localNow: number): void {
    const dt = localNow - this.lastAt;
    this.lastAt = localNow;
    if (dt <= 0 || this.current === this.target) return;
    const step = (SLEW_MS_PER_S * dt) / 1000;
    const d = this.target - this.current;
    this.current += Math.abs(d) <= step ? d : Math.sign(d) * step;
  }

  /**
   * Is the estimate trustworthy? Not when the best round trip is far above anything seen before (a busy main thread,
   * the first peer connection being created): that biases the offset by up to half of it, and the client asks for
   * another burst instead of starting a match on it.
   */
  get good(): boolean {
    return this.isSynced && this.rttBest <= Math.max(60, 3 * this.bestEver);
  }

  get synced(): boolean {
    return this.isSynced;
  }

  info(localNow: number): ClockInfo {
    return { offset: this.offset(localNow), rtt: this.rttBest === Infinity ? 0 : this.rttBest, err: this.rttBest === Infinity ? 0 : this.rttBest / 2, samples: this.pool.length, synced: this.isSynced, good: this.good };
  }
}
