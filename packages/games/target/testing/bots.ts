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
  /** A light on the floor: tapped with a foot. */
  limb?: 'hand' | 'foot';
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
    body.shiftGoal = 0;
    body.footGoal = { L: null, R: null };
    body.rest();
    if (k.idle) return;
    const taken = new Set<number>();
    for (const hand of ['L', 'R'] as const) {
      let best: Seen | null = null;
      for (const t of targets) {
        if (t.avoid || t.limb === 'foot' || taken.has(t.id) || t.age < k.react) continue;
        const c = this.decide(t);
        if (c.skip || c.hand !== hand) continue;
        if (!best || t.life - t.age < best.life - best.age) best = t;
      }
      if (!best) continue;
      taken.add(best.id);
      const c = this.decide(best);
      const gx = best.x + c.dx, gy = best.y + c.dy;
      // out of reach standing still: take a step toward it first (and let the hand follow)
      const shoulder = body.shiftGoal + (hand === 'L' ? -0.4 : 0.4);
      const away = gx - shoulder;
      if (Math.abs(away) > body.arm * 0.85) body.shiftGoal = body.shiftGoal + away - Math.sign(away) * body.arm * 0.85;
      body.aim(hand, gx, gy, k.speed);
    }
    for (const t of targets) {
      if (t.avoid || t.limb !== 'foot' || t.age < k.react) continue;
      const c = this.decide(t);
      if (c.skip) continue;
      const foot: Hand = t.x < body.shift ? 'L' : 'R';
      body.footGoal[foot] = t.x;
      body.shiftGoal = body.shiftGoal;
      break;
    }
  }
}

export interface PadBotKind {
  /** When the hand arrives at the pad, relative to the beat (ms; the pipeline's own delay is added by the test). Positive = late. */
  offset: number;
  /** Top speed of a punch, T per second. */
  speed: number;
  /** Chance of using the wrong hand for a pad. */
  wrongHand: number;
  /** Chance of not punching a pad at all. */
  skip: number;
  /** Dodges bags. */
  dodge: boolean;
  idle: boolean;
}

export const PAD_BOTS: Record<'perfect' | 'sloppy' | 'slow' | 'early' | 'late' | 'idle', PadBotKind> = {
  perfect: { offset: 0, speed: 9, wrongHand: 0, skip: 0, dodge: true, idle: false },
  sloppy: { offset: 150, speed: 9, wrongHand: 0.2, skip: 0.2, dodge: false, idle: false },
  slow: { offset: 0, speed: 1.1, wrongHand: 0, skip: 0, dodge: false, idle: false },
  early: { offset: -245, speed: 9, wrongHand: 0, skip: 0, dodge: false, idle: false },
  late: { offset: 330, speed: 9, wrongHand: 0, skip: 0, dodge: false, idle: false },
  idle: { offset: 0, speed: 0, wrongHand: 0, skip: 0, dodge: false, idle: true },
};

export interface PadSeen { id: number; x: number; y: number; beat: number; hand: Hand; bag?: 'slipL' | 'slipR' | 'duck'; from: number; until: number }

/** A player who punches on the beat: waits with the hands by the chin and sets off so as to arrive at the beat (plus its offset). */
export class PadChaser {
  private readonly rng: Rng;
  readonly kind: PadBotKind;
  private readonly choice = new Map<number, { skip: boolean; hand: Hand }>();
  /** Delay between a motion and the game seeing it, ms: the bot aims early by this much so it is on the beat in the player's time. */
  readonly lag: number;

  constructor(mode: keyof typeof PAD_BOTS, seed = 1, lag = 70) {
    this.kind = PAD_BOTS[mode];
    this.lag = lag;
    this.rng = mulberry32(seed * 104729 + 7);
  }

  steer(body: VirtualBody, targets: readonly PadSeen[], t: number): void {
    const k = this.kind;
    // The hands come back to the guard no faster than the bot punches (a fast retreat through a pad is a fast hand in it too).
    const back = Math.min(6, Math.max(0.1, k.speed));
    body.aim('L', -0.3, 1.2, back);
    body.aim('R', 0.3, 1.2, back);
    body.lean = 0;
    body.drop = 0;
    if (k.idle) { body.rest(); return; }
    const taken = new Set<Hand>();
    for (const tg of [...targets].sort((a, b) => a.beat - b.beat)) {
      if (tg.bag) {
        if (k.dodge && t >= tg.from && t < tg.until) {
          if (tg.bag === 'duck') body.drop = 0.5;
          else body.lean = tg.bag === 'slipR' ? 0.5 : -0.5;
        }
        continue;
      }
      let c = this.choice.get(tg.id);
      if (!c) {
        const skip = this.rng() < k.skip;
        const wrong = this.rng() < k.wrongHand;
        c = { skip, hand: wrong ? (tg.hand === 'L' ? 'R' : 'L') : tg.hand };
        this.choice.set(tg.id, c);
      }
      if (c.skip || taken.has(c.hand)) continue;
      const h = body.hand[c.hand];
      const dist = Math.hypot(tg.x - h.x, tg.y - h.y);
      // The player reaches the pad's centre at beat + offset on their own clock; the game sees it `lag` later.
      const arrive = tg.beat + k.offset + this.lag;
      const travel = (dist / Math.max(0.1, k.speed)) * 1000;
      if (t >= arrive - travel - 40 && t < arrive + 220) {
        body.aim(c.hand, tg.x, tg.y, k.speed);
        taken.add(c.hand);
      }
    }
  }
}
