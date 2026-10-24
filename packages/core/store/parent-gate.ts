// The parent gate: what stands between a child and a purchase screen, between a child and the family's profiles, and between a
// child's profile and the profile of an adult. It asks one multiplication that an adult answers in a few seconds and a young
// child cannot (13 to 19 times 6 to 9). It is a gate, not a lock: nothing secret is protected, and a teenager who works it out
// has earned the screen. What matters is that a child does not get there by tapping.
//
//   ask()            a question, as numbers (the screen writes "17 x 8" in its own way, so the gate has no language)
//   answer(id, x)    right: the gate is open for five minutes. Wrong: a new question comes with the answer. Three wrong
//                    answers close it for a minute, then five, then fifteen (and fifteen from then on); that survives a
//                    reload of the page. A right answer, or a day without a wrong one, forgets all of it.
//   isOpen(), close()
//
// The gate is open in memory only: loading the page again closes it. The clock is the store's (B1): a clock turned back
// closes an open gate for good and never locks it for longer than the longest lockout.
import { p, schemaOf } from './schema.ts';
import type { StoreNamespace } from './store.ts';

export const GATE = {
  /** How long a right answer keeps the gate open. */
  OPEN_MS: 5 * 60_000,
  /** Wrong answers in a row that close it. */
  STRIKES: 3,
  /** How long it stays closed: the first time, the second time, from the third time on. */
  LOCKOUTS_MS: [60_000, 5 * 60_000, 15 * 60_000],
  /** A day without a wrong answer forgets the strikes and the lockouts. */
  FORGET_MS: 24 * 3_600_000,
} as const;

/** The question as numbers: `a` times `b`. */
export interface GateQuestion { id: string; a: number; b: number }

export type GateAsk = { ok: true; question: GateQuestion } | { ok: false; code: 'wait'; retryAfterMs: number };

export type GateAnswer =
  | { ok: true }
  /** Wrong; `next` is the question to show now. */
  | { ok: false; code: 'wrong'; next: GateQuestion }
  /** Closed for `retryAfterMs`. */
  | { ok: false; code: 'wait'; retryAfterMs: number }
  /** That question is not the one that was asked last (or none was). */
  | { ok: false; code: 'no_question' };

export interface ParentGate {
  /** A new question; the one before is gone. While the gate is closed for guessing it says for how long. */
  ask(): GateAsk;
  answer(questionId: string, value: string | number): GateAnswer;
  isOpen(): boolean;
  /** Milliseconds the gate stays open; 0 when it is shut. */
  openFor(): number;
  close(): void;
}

export interface ParentGateOptions {
  /** Where the strikes are kept (the device's 'profiles' namespace). */
  ns: StoreNamespace;
  now?: () => number;
  /** 0 up to (not including) 1. */
  random?: () => number;
  /** Called each time a right answer opens the gate (the profile book lifts its guard here). Whatever it does, it cannot fail the answer. */
  onOpen?: () => void;
}

interface Strikes { strikes: number; lockouts: number; until: number; last: number }

const STRIKES_SCHEMA = schemaOf(1, p.object({
  strikes: p.withDefault(p.number({ int: true, min: 0, max: GATE.STRIKES }), 0),
  lockouts: p.withDefault(p.number({ int: true, min: 0, max: 99 }), 0),
  until: p.withDefault(p.number({ int: true, min: 0, max: 4_102_444_800_000 }), 0),
  last: p.withDefault(p.number({ int: true, min: 0, max: 4_102_444_800_000 }), 0),
}));
const CALM: Strikes = { strikes: 0, lockouts: 0, until: 0, last: 0 };

const MAX_LOCKOUT_MS = GATE.LOCKOUTS_MS[GATE.LOCKOUTS_MS.length - 1] as number;

/** A random number turned into a whole number from `low` to `high`, whatever the random number was. */
function pick(random: () => number, low: number, high: number): number {
  let r = 0;
  try { r = random(); } catch { r = 0; }
  const unit = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0;
  return low + Math.floor(unit * (high - low + 1));
}

export function createParentGate(o: ParentGateOptions): ParentGate {
  const now = o.now ?? ((): number => Date.now());
  const random = o.random ?? Math.random;
  const slot = o.ns.slot<Strikes>('gate', STRIKES_SCHEMA, CALM);
  let counter = 0;
  let current: { id: string; answer: number } | null = null;
  let openedAt = 0;
  let openUntil = 0;

  /** The saved strikes, forgotten when the last one is a day old. */
  function state(t: number): Strikes {
    const s = slot.get();
    if (s.last > 0 && t - s.last >= GATE.FORGET_MS) return { ...CALM };
    return s;
  }

  const lockedFor = (s: Strikes, t: number): number => {
    if (s.until <= t) return 0;
    return Math.min(s.until - t, MAX_LOCKOUT_MS);                // a clock turned back cannot make it longer than the longest lockout
  };

  function question(): GateQuestion {
    const a = pick(random, 13, 19);
    const b = pick(random, 6, 9);
    counter += 1;
    const id = `q${counter}`;
    current = { id, answer: a * b };
    return { id, a, b };
  }

  function shut(): void { openedAt = 0; openUntil = 0; }

  function isOpen(): boolean {
    if (openUntil === 0) return false;
    const t = now();
    if (t < openedAt) { shut(); return false; }                  // the clock went back: a gate that was open is not open now, nor later
    if (t >= openUntil) { shut(); return false; }
    return true;
  }

  return {
    ask() {
      const t = now();
      const wait = lockedFor(state(t), t);
      if (wait > 0) { current = null; return { ok: false, code: 'wait', retryAfterMs: wait }; }
      return { ok: true, question: question() };
    },

    answer(questionId, value) {
      const t = now();
      const s = state(t);
      const wait = lockedFor(s, t);
      if (wait > 0) { current = null; return { ok: false, code: 'wait', retryAfterMs: wait }; }
      if (!current || typeof questionId !== 'string' || questionId !== current.id) return { ok: false, code: 'no_question' };

      const typed = typeof value === 'number' ? value : typeof value === 'string' ? (/^\s*\d{1,4}\s*$/.test(value) ? Number(value.trim()) : Number.NaN) : Number.NaN;
      if (Number.isInteger(typed) && typed === current.answer) {
        current = null;
        openedAt = t;
        openUntil = t + GATE.OPEN_MS;
        if (s.strikes !== 0 || s.lockouts !== 0 || s.until !== 0 || s.last !== 0) slot.set({ ...CALM });
        try { o.onOpen?.(); } catch { /* the gate is open either way */ }
        return { ok: true };
      }

      current = null;
      const strikes = s.strikes + 1;
      if (strikes >= GATE.STRIKES) {
        const lockouts = Math.min(s.lockouts + 1, 99);
        const ms = GATE.LOCKOUTS_MS[Math.min(lockouts, GATE.LOCKOUTS_MS.length) - 1] as number;
        slot.set({ strikes: 0, lockouts, until: t + ms, last: t });
        return { ok: false, code: 'wait', retryAfterMs: ms };
      }
      slot.set({ strikes, lockouts: s.lockouts, until: 0, last: t });
      return { ok: false, code: 'wrong', next: question() };
    },

    isOpen,
    openFor() { return isOpen() ? openUntil - now() : 0; },
    close() { shut(); current = null; },
  };
}
