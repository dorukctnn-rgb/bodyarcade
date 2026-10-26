// The parent gate: a question an adult answers in a second and a young child does not, in front of every purchase screen,
// every change to the family's profiles and the way out of a child's profile. It is a gate, not a lock: a wrong answer
// asks something new, three wrong answers close it for a while, and the closing survives a reload of the page.
import { describe, expect, it } from 'vitest';
import { GATE, createParentGate, type GateQuestion } from './parent-gate.ts';
import { createStore, memoryStorage } from './store.ts';

function rig(o: { storage?: ReturnType<typeof memoryStorage>; randoms?: number[] } = {}) {
  const storage = o.storage ?? memoryStorage();
  const clock = { t: Date.UTC(2026, 9, 24, 12, 0, 0) };
  const store = createStore({ storage, now: () => clock.t, timeZone: 'UTC' });
  const queue = [...(o.randoms ?? [])];
  let drawn = 0;
  const random = (): number => { drawn++; return queue.length ? (queue.shift() as number) : (drawn * 0.37) % 1; };
  const make = () => createParentGate({ ns: store.ns('profiles'), now: () => clock.t, random });
  return { gate: make(), make, clock, storage, store };
}

const productOf = (q: GateQuestion): number => q.a * q.b;
const asked = (r: ReturnType<ReturnType<typeof rig>['gate']['ask']>): GateQuestion => {
  if (!r.ok) throw new Error(`asked for a question and got ${r.code}`);
  return r.question;
};

describe('the question', () => {
  it('is a multiplication of a number between 13 and 19 by a number between 6 and 9, whatever the dice say', () => {
    for (const roll of [0, 0.0001, 0.2, 0.5, 0.77, 0.9999]) {
      const { gate } = rig({ randoms: [roll, roll] });
      const q = asked(gate.ask());
      expect(q.a).toBeGreaterThanOrEqual(13);
      expect(q.a).toBeLessThanOrEqual(19);
      expect(q.b).toBeGreaterThanOrEqual(6);
      expect(q.b).toBeLessThanOrEqual(9);
      expect(Number.isInteger(q.a) && Number.isInteger(q.b)).toBe(true);
    }
  });

  it('survives a random number that is not between 0 and 1', () => {
    for (const roll of [-5, 1, 7, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { gate } = rig({ randoms: [roll, roll] });
      const q = asked(gate.ask());
      expect(q.a >= 13 && q.a <= 19 && q.b >= 6 && q.b <= 9, `roll ${roll}`).toBe(true);
    }
  });

  it('is a new one every time it is asked, and only the newest one can be answered', () => {
    const { gate } = rig({ randoms: [0.1, 0.1, 0.9, 0.9] });
    const first = asked(gate.ask());
    const second = asked(gate.ask());
    expect(second.id).not.toBe(first.id);
    expect(gate.answer(first.id, productOf(first))).toEqual({ ok: false, code: 'no_question' });
    expect(gate.isOpen()).toBe(false);
    expect(gate.answer(second.id, productOf(second))).toEqual({ ok: true });
  });
});

describe('answering', () => {
  it('opens the gate for a right answer, as a number or as the digits typed', () => {
    for (const typed of [(q: GateQuestion) => productOf(q), (q: GateQuestion) => String(productOf(q)), (q: GateQuestion) => ` ${productOf(q)} `]) {
      const { gate } = rig();
      const q = asked(gate.ask());
      expect(gate.isOpen()).toBe(false);
      expect(gate.answer(q.id, typed(q))).toEqual({ ok: true });
      expect(gate.isOpen()).toBe(true);
    }
  });

  it('a wrong answer is a wrong answer, and the next question comes with it', () => {
    const { gate } = rig();
    const q = asked(gate.ask());
    const r = gate.answer(q.id, productOf(q) + 1);
    expect(r).toMatchObject({ ok: false, code: 'wrong' });
    expect(gate.isOpen()).toBe(false);
    const next = (r as { next: GateQuestion }).next;
    expect(next.id).not.toBe(q.id);
    expect(gate.answer(q.id, productOf(q))).toEqual({ ok: false, code: 'no_question' });      // the old question is gone
    expect(gate.answer(next.id, productOf(next))).toEqual({ ok: true });
  });

  it('is not fooled by things that are not the number: words, signs, decimals, blanks, other types', () => {
    for (const bad of ['', ' ', 'abc', '1e2', '0x10', '12.0', '+99', '-99', '9'.repeat(12), null, undefined, {}, [], true, Number.NaN, 12.5]) {
      const { gate } = rig();
      const q = asked(gate.ask());
      const r = gate.answer(q.id, bad as never);
      expect(r, String(bad)).toMatchObject({ ok: false, code: 'wrong' });
      expect(gate.isOpen()).toBe(false);
    }
  });

  it('cannot be answered for a question that was never asked', () => {
    const { gate } = rig();
    expect(gate.answer('q1', 100)).toEqual({ ok: false, code: 'no_question' });
    expect(gate.answer('', 100)).toEqual({ ok: false, code: 'no_question' });
    expect(gate.answer(undefined as never, 100)).toEqual({ ok: false, code: 'no_question' });
  });

  it('tells whoever asked to hear it when a right answer opens the gate, and for nothing else', () => {
    const storage = memoryStorage();
    const clock = { t: Date.UTC(2026, 9, 24, 12, 0, 0) };
    const store = createStore({ storage, now: () => clock.t, timeZone: 'UTC' });
    let opened = 0;
    const gate = createParentGate({ ns: store.ns('profiles'), now: () => clock.t, onOpen: () => { opened += 1; } });
    const q = asked(gate.ask());
    const wrong = gate.answer(q.id, productOf(q) + 1) as { next: GateQuestion };
    expect(opened).toBe(0);
    gate.answer('nope', 1);
    expect(opened).toBe(0);
    expect(gate.answer(wrong.next.id, productOf(wrong.next))).toEqual({ ok: true });
    expect(opened).toBe(1);
  });

  it('opens even when the one who asked to hear it breaks', () => {
    const storage = memoryStorage();
    const clock = { t: Date.UTC(2026, 9, 24, 12, 0, 0) };
    const store = createStore({ storage, now: () => clock.t, timeZone: 'UTC' });
    const gate = createParentGate({ ns: store.ns('profiles'), now: () => clock.t, onOpen: () => { throw new Error('listener broke'); } });
    const q = asked(gate.ask());
    expect(gate.answer(q.id, productOf(q))).toEqual({ ok: true });
    expect(gate.isOpen()).toBe(true);
  });
});

describe('open and closed', () => {
  it('stays open for five minutes, then asks again', () => {
    const { gate, clock } = rig();
    const q = asked(gate.ask());
    gate.answer(q.id, productOf(q));
    expect(gate.openFor()).toBe(GATE.OPEN_MS);
    clock.t += GATE.OPEN_MS - 1;
    expect(gate.isOpen()).toBe(true);
    expect(gate.openFor()).toBe(1);
    clock.t += 1;
    expect(gate.isOpen()).toBe(false);
    expect(gate.openFor()).toBe(0);
  });

  it('closes when the screen that needed it is left', () => {
    const { gate } = rig();
    const q = asked(gate.ask());
    gate.answer(q.id, productOf(q));
    gate.close();
    expect(gate.isOpen()).toBe(false);
    gate.close();                                   // twice is harmless
    expect(gate.isOpen()).toBe(false);
  });

  it('is closed after a reload of the page: only the lockout is remembered, never the opening', () => {
    const r = rig();
    const q = asked(r.gate.ask());
    r.gate.answer(q.id, productOf(q));
    expect(r.gate.isOpen()).toBe(true);
    expect(r.make().isOpen()).toBe(false);
  });

  it('is shut when the clock of the device is turned back, and opens for no longer than five minutes', () => {
    const { gate, clock } = rig();
    const q = asked(gate.ask());
    gate.answer(q.id, productOf(q));
    clock.t -= 60_000;
    expect(gate.isOpen()).toBe(false);
    clock.t += 60_000;
    expect(gate.isOpen()).toBe(false);              // a gate that was seen shut by the clock stays shut
  });
});

describe('guessing', () => {
  const wrong = (g: ReturnType<typeof rig>['gate'], n: number) => {
    let last: ReturnType<typeof g.answer> | null = null;
    for (let i = 0; i < n; i++) {
      const q = asked(g.ask());
      last = g.answer(q.id, productOf(q) + 1);
    }
    return last as ReturnType<typeof g.answer>;
  };

  it('three wrong answers close it for a minute: no question, no answer', () => {
    const { gate, clock } = rig();
    const r = wrong(gate, 3);
    expect(r).toEqual({ ok: false, code: 'wait', retryAfterMs: GATE.LOCKOUTS_MS[0] });
    expect(gate.ask()).toEqual({ ok: false, code: 'wait', retryAfterMs: GATE.LOCKOUTS_MS[0] });
    clock.t += 30_000;
    expect(gate.ask()).toEqual({ ok: false, code: 'wait', retryAfterMs: GATE.LOCKOUTS_MS[0] - 30_000 });
    clock.t += GATE.LOCKOUTS_MS[0] - 30_000;
    expect(gate.ask().ok).toBe(true);
  });

  it('a right answer given during the lockout does not count', () => {
    const { gate } = rig();
    const q = asked(gate.ask());
    wrong(gate, 3);
    expect(gate.answer(q.id, productOf(q))).toMatchObject({ ok: false, code: 'wait' });
    expect(gate.isOpen()).toBe(false);
  });

  it('closes for longer each time it is guessed at again, up to a quarter of an hour', () => {
    const { gate, clock } = rig();
    const waits: number[] = [];
    for (let round = 0; round < 5; round++) {
      const r = wrong(gate, 3);
      waits.push((r as { retryAfterMs: number }).retryAfterMs);
      clock.t += waits[waits.length - 1] as number;
    }
    expect(waits).toEqual([GATE.LOCKOUTS_MS[0], GATE.LOCKOUTS_MS[1], GATE.LOCKOUTS_MS[2], GATE.LOCKOUTS_MS[2], GATE.LOCKOUTS_MS[2]]);
    expect(GATE.LOCKOUTS_MS[2]).toBe(15 * 60_000);
  });

  it('a right answer forgets the strikes', () => {
    const { gate, clock } = rig();
    wrong(gate, 2);
    const q = asked(gate.ask());
    expect(gate.answer(q.id, productOf(q))).toEqual({ ok: true });
    gate.close();
    clock.t += 1000;
    expect(wrong(gate, 2)).toMatchObject({ code: 'wrong' });         // two more are still not a lockout
    expect(gate.ask().ok).toBe(true);
  });

  it('is not undone by reloading the page: the strikes and the lockout are kept', () => {
    const r = rig();
    wrong(r.gate, 2);
    const reloaded = r.make();
    const q = asked(reloaded.ask());
    expect(reloaded.answer(q.id, productOf(q) + 1)).toMatchObject({ ok: false, code: 'wait' });   // the third strike
    const again = r.make();
    expect(again.ask()).toMatchObject({ ok: false, code: 'wait' });
  });

  it('forgets old strikes after a day, so one bad evening is not held against a parent for ever', () => {
    const { gate, clock } = rig();
    wrong(gate, 3);
    clock.t += 24 * 3_600_000 + GATE.LOCKOUTS_MS[0];
    expect(wrong(gate, 3)).toEqual({ ok: false, code: 'wait', retryAfterMs: GATE.LOCKOUTS_MS[0] });   // a first lockout again, not a second
  });

  it('is not locked longer than the longest lockout when the clock was turned back', () => {
    const { gate, clock } = rig();
    wrong(gate, 3);
    clock.t -= 10 * 24 * 3_600_000;
    const r = gate.ask();
    expect(r.ok).toBe(false);
    expect((r as { retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(GATE.LOCKOUTS_MS[2]);
  });

  it('survives damaged saved state: it is a gate that starts again from nothing, not a page that breaks', () => {
    const storage = memoryStorage({ 'ba2.profiles.gate': '{"v":1,"d":{"strikes":"many","until":-5}}' });
    const { gate } = rig({ storage });
    expect(gate.ask().ok).toBe(true);
  });
});
