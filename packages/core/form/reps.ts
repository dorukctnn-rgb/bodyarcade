// Repetition counter for the form coach: a two-threshold state machine on the move's progress (0 at the start position,
// 1 at the target). A repetition starts when the progress passes `countAt` and ends when it comes back to `upAt` or below;
// one that never reached `fullAt` is counted but not clean (the move's depth rule judges it). Movements that stay under
// `countAt` are fidgeting and never count. A person who disappears for `lostMs` cancels the repetition in progress. A
// repetition can only begin after the start position was seen (a set starts standing, arms locked, lying flat), so a person
// who walks into the picture already squatting does not get a free repetition.
import type { Phase, RepOpts } from './types.ts';

export interface RepEvent {
  kind: 'start' | 'end' | 'cancel' | 'notReturned' | 'shallow';
  t: number;
  /** For 'end': when the repetition left the start position, when it was deepest, and how deep it went. */
  startT?: number;
  bottomT?: number;
  maxP?: number;
}

export class RepMachine {
  private readonly o: RepOpts;
  private readonly lostMs: number;
  phase: Phase = 'top';
  private armed = false;
  private maxP = 0;
  private bottomT = 0;
  private leftTopT = 0;
  private lastSeenT = -Infinity;
  private localMin = Infinity;
  private warned = false;
  private prevP = 0;
  private sawTop = false;
  /** Deepest progress since the last start position, while not in a repetition (for the 'shallow' event). */
  private peakOut = 0;

  constructor(o: RepOpts, lostMs = 600) { this.o = o; this.lostMs = lostMs; }

  reset(): void {
    this.phase = 'top'; this.armed = false; this.maxP = 0; this.localMin = Infinity; this.warned = false; this.prevP = 0; this.sawTop = false; this.peakOut = 0;
  }

  /** One frame. `p` null = the move cannot be measured this frame (the person is away or turned). */
  push(p: number | null, t: number): RepEvent[] {
    const out: RepEvent[] = [];
    const away = t - this.lastSeenT > this.lostMs;
    if (p === null) {
      if (away) { if (this.armed) out.push({ kind: 'cancel', t }); this.reset(); }
      return out;
    }
    if (away) { if (this.armed) out.push({ kind: 'cancel', t }); this.reset(); }
    this.lastSeenT = t;
    const o = this.o;
    if (!this.armed) {
      // the repetition's start is the last moment at the start position (between upAt and countAt it is on its way)
      if (p <= o.upAt) {
        // a dip that went past 0.3 but not to countAt and came back: too small to count, worth saying so
        if (this.sawTop && this.peakOut >= 0.3 && this.peakOut < o.countAt) out.push({ kind: 'shallow', t, maxP: this.peakOut });
        this.peakOut = 0; this.leftTopT = t; this.sawTop = true;
      } else if (p > this.peakOut) this.peakOut = p;
      if (p >= o.countAt && this.sawTop) {
        this.peakOut = 0;
        this.armed = true; this.maxP = p; this.bottomT = t; this.localMin = Infinity; this.warned = false;
        this.phase = 'down';
        out.push({ kind: 'start', t: this.leftTopT });
      } else this.phase = 'top';
      this.prevP = p;
      return out;
    }
    if (p > this.maxP) { this.maxP = p; this.bottomT = t; }
    if (p <= o.upAt) {
      const dur = t - this.leftTopT;
      if (dur >= o.minMs) out.push({ kind: 'end', t, startT: this.leftTopT, bottomT: this.bottomT, maxP: this.maxP });
      else out.push({ kind: 'cancel', t });
      this.armed = false; this.phase = 'top'; this.leftTopT = t; this.prevP = p;
      return out;
    }
    // where in the repetition: still going towards the target, near the deepest point, or on the way back
    const nearBottom = p >= this.maxP - 0.08;
    if (nearBottom) this.phase = this.maxP >= o.fullAt || p < this.prevP + 0.002 ? 'bottom' : 'down';
    else {
      this.phase = 'up';
      // a new repetition began without coming back to the start: the player stopped short of it
      if (p < this.localMin) this.localMin = p;
      if (!this.warned && p > this.localMin + 0.15 && this.localMin > o.upAt) { out.push({ kind: 'notReturned', t }); this.warned = true; }
    }
    this.prevP = p;
    return out;
  }
}
