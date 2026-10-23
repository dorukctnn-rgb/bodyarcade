// The bots of the tests: a perfect player, a sloppy one and an idle one, as the audit's simbot did for the runner. They steer a
// VirtualBody toward what the game shows (the targets of a lane's view), at a speed and with a reaction time, a wrong-hand
// habit and an aim error that belong to the kind of bot. Test support only; nothing in production imports it.
import type { Rng } from '../../../core/types/index.ts';
import { mulberry32 } from '../../../core/loop/rng.ts';
import type { Hand, VirtualBody } from './body.ts';

export type BotMode = 'perfect' | 'sloppy' | 'late' | 'idle';

export interface BotKind {
  /** Time between a target appearing and the hand setting off (ms). */
  react: number;
  /** Top hand speed, T per second. */
  speed: number;
  /** Aim error, T (uniform, per target). */
  aim: number;
  /** Chance of using the other hand than the one the target needs. */
  wrongHand: number;
  /** Chance of ignoring a target altogether. */
  skip: number;
  /** Does nothing at all. */
  idle: boolean;
}

export const BOTS: Record<BotMode, BotKind> = {
  perfect: { react: 160, speed: 9, aim: 0, wrongHand: 0, skip: 0, idle: false },
  sloppy: { react: 700, speed: 3, aim: 0.12, wrongHand: 0.2, skip: 0.2, idle: false },
  late: { react: 5000, speed: 4, aim: 0.03, wrongHand: 0, skip: 0, idle: false },
  idle: { react: 0, speed: 0, aim: 0, wrongHand: 0, skip: 0, idle: true },
};

export interface Seen {
  id: number;
  x: number;
  y: number;
  /** ms since it appeared. */
  age: number;
  life: number;
  /** The hand it needs; undefined: either. */
  side?: Hand;
  /** A red light: a good player leaves it alone. */
  avoid?: boolean;
}

/** Per-target decisions are made once and remembered, so a bot does not change its mind every step. */
export class Chaser {
  private readonly rng: Rng;
  private readonly choice = new Map<number, { skip: boolean; hand: Hand | null; dx: number; dy: number }>();
  readonly kind: BotKind;

  constructor(mode: BotMode, seed = 1) {
    this.kind = BOTS[mode];
    this.rng = mulberry32(seed * 7919 + 13);
  }

  private decide(t: Seen): { skip: boolean; hand: Hand | null; dx: number; dy: number } {
    let c = this.choice.get(t.id);
    if (!c) {
      const k = this.kind;
      const skip = this.rng() < k.skip;
      const wrong = this.rng() < k.wrongHand;
      const either: Hand = this.rng() < 0.5 ? 'L' : 'R';
      const need = t.side ?? either;
      const hand: Hand | null = wrong && t.side ? (t.side === 'L' ? 'R' : 'L') : need;
      c = { skip, hand, dx: (this.rng() - 0.5) * 2 * k.aim, dy: (this.rng() - 0.5) * 2 * k.aim };
      this.choice.set(t.id, c);
    }
    return c;
  }

  /** Sets the hands' goals for this step. Targets are those on the screen now. */
  steer(body: VirtualBody, targets: readonly Seen[]): void {
    const k = this.kind;
    body.rest();
    if (k.idle) return;
    const taken = new Set<number>();
    for (const hand of ['L', 'R'] as const) {
      let best: Seen | null = null;
      for (const t of targets) {
        if (t.avoid || taken.has(t.id) || t.age < k.react) continue;
        const c = this.decide(t);
        if (c.skip || c.hand !== hand) continue;
        if (!best || t.life - t.age < best.life - best.age) best = t;
      }
      if (!best) continue;
      taken.add(best.id);
      const c = this.decide(best);
      body.aim(hand, best.x + c.dx, best.y + c.dy, k.speed);
    }
  }
}
