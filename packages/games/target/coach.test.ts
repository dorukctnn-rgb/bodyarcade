// The coach's schedule: which call, when, for each difficulty; that it lands before the pad does, never overlaps itself, is the same in every
// language, and that the engine makes each call on the first step at or after its time, over a whole run, without drifting.
import { describe, expect, it } from 'vitest';
import { rngStream } from '../../core/loop/rng.ts';
import {
  CALL_IDS, CAPTION_MS, DEFENCE_LEAD_MS, MAX_CLIP_MS, MIN_GAP_MS, NUMBER_LEAD_BEATS, REST_CALL_AFTER_MS, ROUND_CALL_AFTER_MS, WARN_LEFT_MS,
  callKind, noOverlap, numberId, roundId, warningHole, withRoundCalls, type Call, type CallId,
} from './coach.ts';
import { STEP_MS } from './engine.ts';
import { PAD_LEVELS, PAD_WINDOW, padCalls, padWorkRules, planPads, type PadSpec } from './pad-work.ts';
import { callText } from './strings.ts';
import { buildTimeline } from './timeline.ts';
import { frameOf } from './testing/body.ts';
import { play, setup, tick } from './testing/play.ts';
import type { Level, PlanInput } from './types.ts';

const LEVELS: Level[] = ['easy', 'normal', 'hard', 'expert'];
const FULL = buildTimeline(420, 3, 30);

const planInput = (o: Partial<PlanInput> = {}): PlanInput => ({
  level: 'normal', timeline: FULL, seated: false, quiet: false, feet: false, keyboard: false, players: 1, hz: 30, ...o,
});
const planOf = (seed: number, o: Partial<PlanInput> = {}): PadSpec[] => planPads(rngStream(seed, 'course'), planInput(o));
const callsOf = (seed: number, o: Partial<PlanInput> = {}): { plan: PadSpec[]; calls: Call[] } => {
  const plan = planOf(seed, o);
  return { plan, calls: padCalls(plan, o.timeline ?? FULL) };
};
const own = (calls: readonly Call[]): Call[] => calls.filter((c) => c.plan !== undefined);

describe('the words of the schedule', () => {
  it('has a kind for every call, and numbers only for the places of a pad in a combination (1 to 6)', () => {
    expect(CALL_IDS.length).toBe(15);
    for (const id of CALL_IDS) expect(['number', 'defence', 'round', 'warn', 'rest']).toContain(callKind(id));
    expect([0, 1, 2, 3, 4, 5].map((k) => numberId(k))).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect(numberId(6)).toBeNull();
    expect(numberId(-1)).toBeNull();
    expect(numberId(1.5)).toBeNull();
  });

  it('names the rounds: first, second, third, and the last of several is the final round', () => {
    expect([1, 2, 3].map((n) => roundId(n, 4))).toEqual(['round1', 'round2', 'round3']);
    expect(roundId(4, 4)).toBe('roundFinal');
    expect(roundId(3, 3)).toBe('roundFinal');
    expect(roundId(1, 1)).toBe('round1');
    expect(roundId(5, 7)).toBeNull();
  });

  it('every call has a caption in all five languages, and a length for its caption and its clip', () => {
    for (const lang of ['en', 'tr', 'de', 'es', 'fr'] as const) for (const id of CALL_IDS) expect(callText(lang, id), `${lang} ${id}`).toBeTruthy();
    for (const kind of ['number', 'defence', 'round', 'warn', 'rest'] as const) {
      expect(MAX_CLIP_MS[kind]).toBeGreaterThan(0);
      expect(CAPTION_MS[kind]).toBeGreaterThanOrEqual(MAX_CLIP_MS[kind] * 0.5);
    }
  });
});

describe('the numbers: one beat before the pad lights', () => {
  it('every pad has its number, called NUMBER_LEAD_BEATS beats before its beat, and before its window opens, at every level', () => {
    for (const level of LEVELS) {
      for (const seed of [1, 2, 3]) {
        const { plan, calls } = callsOf(seed, { level });
        const pads = plan.filter((s) => s.kind === 'pad');
        expect(pads.length, level).toBeGreaterThan(40);
        for (const s of pads) {
          const c = calls.find((x) => x.plan === s.id);
          expect(c, `${level} pad ${s.id}`).toBeDefined();
          expect(c!.id).toBe(`n${s.k + 1}`);
          expect(c!.t).toBe(Math.round(s.beat - NUMBER_LEAD_BEATS * s.per));
          expect(c!.t).toBeLessThan(s.from);                         // before the player may hit it
          expect(c!.t + MAX_CLIP_MS.number).toBeLessThan(s.beat);       // and the word is over before the beat
        }
      }
    }
  });

  it('a combination is called in order, a beat apart, at the tempo of its round', () => {
    for (const level of LEVELS) {
      const { plan, calls } = callsOf(4, { level });
      const byCombo = new Map<number, PadSpec[]>();
      for (const s of plan) if (s.kind === 'pad') byCombo.set(s.combo, [...(byCombo.get(s.combo) ?? []), s]);
      let checked = 0;
      for (const pads of byCombo.values()) {
        const ts = pads.map((p) => calls.find((c) => c.plan === p.id)!.t);
        expect(ts.map((_, i) => pads[i]!.k)).toEqual(pads.map((_, i) => i));
        for (let i = 1; i < ts.length; i++) { expect(ts[i]! - ts[i - 1]!).toBeCloseTo(pads[i]!.beat - pads[i - 1]!.beat, -1); checked++; }
      }
      expect(checked, level).toBeGreaterThan(5);
    }
  });

  it('the pad shows the number the coach says: the place in the combination, 1 to the size of it', () => {
    const { plan, calls } = callsOf(8, { level: 'expert' });
    const sizes = new Set(plan.filter((s) => s.kind === 'pad').map((s) => s.size));
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(5);
    for (const s of plan) if (s.kind === 'pad') expect(calls.find((c) => c.plan === s.id)!.id).toBe(numberId(s.k));
  });

  it('a number is short enough for the quickest beat of the game: a call is over before the next one begins', () => {
    const fastest = Math.min(...LEVELS.map((l) => 60000 / PAD_LEVELS[l].bpm[1]));
    expect(MAX_CLIP_MS.number + 40).toBeLessThan(fastest * NUMBER_LEAD_BEATS);
  });
});

describe('the defence calls', () => {
  it('a bag is called a good second before it swings in, in the words of the prompt (slip left, slip right, duck)', () => {
    let bags = 0;
    for (const level of ['normal', 'hard', 'expert'] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const { plan, calls } = callsOf(seed, { level });
        for (const s of plan) {
          if (s.kind !== 'bag') continue;
          bags++;
          const c = calls.find((x) => x.plan === s.id)!;
          expect(c.id).toBe(s.need);                                    // slipL = "Slip left" (the prompt's slip_left), slipR, duck
          expect(c.t).toBe(s.beat - DEFENCE_LEAD_MS);
          // the longest call is over before the player's window opens, on a device that judges at the normal rate
          expect(c.t + MAX_CLIP_MS.defence).toBeLessThanOrEqual(s.from);
        }
      }
    }
    expect(bags).toBeGreaterThan(8);
  });

  it('there are none on easy, none for a keyboard player, and no duck for a seated one', () => {
    const none = (c: Call[]): boolean => c.every((x) => callKind(x.id) !== 'defence');
    expect(none(callsOf(5, { level: 'easy' }).calls)).toBe(true);
    expect(none(callsOf(5, { level: 'expert', keyboard: true }).calls)).toBe(true);
    const seated = callsOf(5, { level: 'expert', seated: true }).calls;
    expect(seated.some((c) => c.id === 'slipL' || c.id === 'slipR')).toBe(true);
    expect(seated.some((c) => c.id === 'duck')).toBe(false);
    expect(callsOf(5, { level: 'expert' }).calls.some((c) => c.id === 'duck')).toBe(true);
  });
});

describe('the rounds', () => {
  it('names each round after its bell, warns ten seconds before its end and calls the rests', () => {
    const { calls } = callsOf(3);
    const rounds = FULL.segments.filter((s) => s.kind === 'play');
    expect(calls.filter((c) => callKind(c.id) === 'round').map((c) => c.id)).toEqual(['round1', 'round2', 'roundFinal']);
    rounds.forEach((seg, i) => {
      expect(calls.find((c) => callKind(c.id) === 'round' && c.t >= seg.start && c.t < seg.end)!.t).toBe(seg.start + ROUND_CALL_AFTER_MS);
      const w = calls.filter((c) => c.id === 'last10' && c.t >= seg.start && c.t < seg.end);
      expect(w.length, `round ${i + 1}`).toBe(1);
      // ten seconds before the end: the plan keeps that moment free, so the warning never has to move
      expect(w[0]!.t).toBe(seg.end - WARN_LEFT_MS);
    });
    const rests = FULL.segments.filter((s) => s.kind === 'rest');
    expect(calls.filter((c) => c.id === 'rest').map((c) => c.t)).toEqual(rests.map((s) => s.start + REST_CALL_AFTER_MS));
  });

  it('the warning is said exactly ten seconds before the end of every round, whatever the seed, the level and the variant: the plan keeps the moment free', () => {
    for (const level of LEVELS) for (let seed = 1; seed <= 12; seed++) for (const o of [{}, { seated: true }, { hz: 12 }] as Partial<PlanInput>[]) {
      const { plan, calls } = callsOf(seed, { level, ...o });
      for (const seg of FULL.segments.filter((s) => s.kind === 'play')) {
        const w = calls.filter((c) => c.id === 'last10' && c.t >= seg.start && c.t < seg.end);
        expect(w.map((c) => c.t), `${level} ${seed} ${JSON.stringify(o)} round ${seg.round + 1}`).toEqual([seg.end - WARN_LEFT_MS]);
        const hole = warningHole(seg)!;
        // and nothing else is called inside it
        expect(calls.filter((c) => c.id !== 'last10' && c.t < hole.to && c.t + MAX_CLIP_MS[callKind(c.id)] + MIN_GAP_MS > hole.from), `${level} ${seed}`).toEqual([]);
        // the plan is still a plan: pads of a combination stay together, in their round
        for (const s of plan) if (s.at >= seg.start && s.at < seg.end) expect(s.until).toBeLessThanOrEqual(seg.end);
      }
    }
  });

  it('a one round run has one name and the warning; a short round gets no warning; the third of four is "round three"', () => {
    const one = withRoundCalls([], buildTimeline(60, 1, 0));
    expect(one.map((c) => c.id)).toEqual(['round1', 'last10']);
    expect(one[1]!.t).toBe(50_000);
    expect(withRoundCalls([], buildTimeline(20, 1, 0)).map((c) => c.id)).toEqual(['round1']);
    const four = withRoundCalls([], buildTimeline(4 * 40 + 3 * 5, 4, 5));
    expect(four.filter((c) => callKind(c.id) === 'round').map((c) => c.id)).toEqual(['round1', 'round2', 'round3', 'roundFinal']);
    expect(withRoundCalls([], buildTimeline(7 * 30 + 6 * 5, 7, 5)).filter((c) => callKind(c.id) === 'round').map((c) => c.id)).toEqual(['round1', 'round2', 'round3', 'roundFinal']);
  });

  it('a breather too short to say "rest" in is left unnamed', () => {
    expect(withRoundCalls([], buildTimeline(2 * 30 + 2, 2, 2)).some((c) => c.id === 'rest')).toBe(false);
    expect(withRoundCalls([], buildTimeline(2 * 30 + 4, 2, 4)).some((c) => c.id === 'rest')).toBe(true);
  });

  it('leaves the warning out when no quiet moment is within four seconds', () => {
    const tl = buildTimeline(60, 1, 0);
    // a call every 400 ms through the end of the round
    const dense: Call[] = Array.from({ length: 100 }, (_, i) => ({ id: 'n1', t: 40_000 + i * 400, plan: i }));
    expect(withRoundCalls(dense, tl).some((c) => c.id === 'last10')).toBe(false);
  });
});

describe('a whole schedule', () => {
  it('is in order, no call is spoken over another, and nothing is called before the run or after its end, for every level, seed and variant', () => {
    for (const level of LEVELS) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        for (const o of [{}, { seated: true }, { keyboard: true }, { hz: 12 }, { hz: 60 }] as Partial<PlanInput>[]) {
          const { calls } = callsOf(seed, { level, ...o });
          expect(calls.length).toBeGreaterThan(100);
          expect(calls.every((c, i) => i === 0 || c.t >= (calls[i - 1] as Call).t), `${level} ${seed}`).toBe(true);
          expect(noOverlap(calls), `${level} ${seed} ${JSON.stringify(o)}`).toBe(true);
          expect(calls[0]!.t).toBeGreaterThan(0);
          expect(calls[calls.length - 1]!.t + MAX_CLIP_MS[callKind(calls[calls.length - 1]!.id)]).toBeLessThan(FULL.totalMs);
        }
      }
    }
  });

  it('is made from the plan alone: the same in every language, the same for two players and for one', () => {
    const a = callsOf(6, { level: 'hard' }).calls;
    expect(callsOf(6, { level: 'hard', players: 2 }).calls).toEqual(a);
    expect(callsOf(6, { level: 'hard' }).calls).toEqual(a);
    expect(callsOf(7, { level: 'hard' }).calls).not.toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);          // plain data, so a snapshot can carry it
  });

  it('grows with the level: more calls a minute, and a faster beat between the numbers', () => {
    const rate = (level: Level): number => callsOf(2, { level }).calls.filter((c) => callKind(c.id) === 'number').length;
    expect(rate('normal')).toBeGreaterThan(rate('easy'));
    expect(rate('hard')).toBeGreaterThan(rate('normal'));
    expect(rate('expert')).toBeGreaterThan(rate('hard'));
  });

  it('the first call of every round comes after the round has been named', () => {
    const { calls } = callsOf(9, { level: 'expert' });
    for (const seg of FULL.segments.filter((s) => s.kind === 'play')) {
      const inside = calls.filter((c) => c.t >= seg.start && c.t < seg.end);
      expect(callKind(inside[0]!.id)).toBe('round');
      expect(inside[1]!.t).toBeGreaterThan(inside[0]!.t + MAX_CLIP_MS.round);
    }
  });

  it('a call is made well inside the window of the pad it announces, for slow devices too', () => {
    for (const hz of [12, 18, 30]) {
      const { plan, calls } = callsOf(3, { level: 'normal', hz });
      for (const s of plan) if (s.kind === 'pad') expect(calls.find((c) => c.plan === s.id)!.t, `hz ${hz}`).toBeLessThan(s.beat - PAD_WINDOW.pre);
    }
  });
});

describe('on the engine', () => {
  const idle = (o: Parameters<typeof setup>[1] = {}) => setup(padWorkRules, { bots: 'idle', ...o });
  const callEvents = (events: readonly { type: string }[]): { type: string; t: number; id: CallId; at: number; plan?: number }[] => events.filter((e) => e.type === 'call') as never;

  it('makes every call on the first step at or after its time: at most one step late, on the 2 hundredth second as on the first', () => {
    for (const level of ['easy', 'expert'] as const) {
      const r = idle({ duration: 420, rounds: 3, restSec: 30, level, seed: 5 });
      play(r);
      const events = callEvents(r.events);
      expect(r.engine.phase).toBe('complete');
      expect(events.length).toBe(r.engine.calls.length);
      events.forEach((e, i) => {
        const c = r.engine.calls[i]!;
        expect(e.id).toBe(c.id);
        expect(e.at).toBe(c.t);
        expect(e.t).toBeGreaterThanOrEqual(c.t);
        expect(e.t - c.t, `${level} call ${i}`).toBeLessThan(STEP_MS + 1e-6);
      });
      // no drift: the lateness of the calls of the last minute is no worse than that of the first
      const late = events.map((e) => e.t - e.at);
      const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
      expect(mean(late.slice(-40))).toBeLessThan(STEP_MS);
      expect(Math.abs(mean(late.slice(-40)) - mean(late.slice(0, 40)))).toBeLessThan(STEP_MS / 2);
    }
  }, 120_000);

  it('calls once for two players, and the same calls as for one', () => {
    const one = idle({ duration: 45, rounds: 1, seed: 2, level: 'hard' });
    play(one);
    const two = setup(padWorkRules, { duration: 45, rounds: 1, seed: 2, level: 'hard', bots: ['idle', 'idle'] });
    play(two);
    const a = callEvents(one.events), b = callEvents(two.events);
    expect(a.length).toBeGreaterThan(15);
    expect(b.map((e) => [e.id, e.at])).toEqual(a.map((e) => [e.id, e.at]));
    expect(b.every((e) => !('player' in e))).toBe(true);
  });

  it('waits while a player cannot be seen, then makes the call that fell due, once', () => {
    const r = idle({ duration: 45, rounds: 1, seed: 2, level: 'hard' });
    const first = r.engine.calls.find((c) => c.plan !== undefined)!;
    let n = 0;
    while (r.engine.t < first.t - 100 && n++ < 60 * 60) tick(r);
    const before = callEvents(r.events).length;
    // nobody tracked for two seconds, across the time of the call: the clock stops, nothing is called
    for (let i = 0; i < 120; i++) { r.k++; r.engine.step(frameOf(r.k, {}, { ok: false })); }
    expect(callEvents(r.events).length).toBe(before);
    expect(r.engine.t).toBeLessThan(first.t);
    for (let i = 0; i < 20; i++) tick(r);
    const after = callEvents(r.events).filter((e) => e.id === first.id && e.at === first.t);
    expect(after.length).toBe(1);
  });

  it('a snapshot taken at any moment continues with the calls that were still to come, none twice, none lost', () => {
    const base = idle({ duration: 45, rounds: 1, seed: 7, level: 'expert' });
    play(base);
    const all = callEvents(base.events).map((e) => [e.id, e.at]);
    for (const at of [1800, 6000, 20_000]) {
      const r = idle({ duration: 45, rounds: 1, seed: 7, level: 'expert' });
      for (let i = 0; i < at; i++) tick(r);
      const snap = r.engine.snapshot();
      const seen = callEvents(r.events).map((e) => [e.id, e.at]);
      const copy = idle({ duration: 45, rounds: 1, seed: 7, level: 'expert' });
      copy.engine.restore(snap);
      copy.k = r.k;
      copy.bodies = r.bodies;
      play(copy);
      expect([...seen, ...callEvents(copy.events).map((e) => [e.id, e.at])]).toEqual(all);
    }
  });

  it('a snapshot from before the coach (no callI) works out how far it had got from the time', () => {
    const r = idle({ duration: 45, rounds: 1, seed: 7, level: 'normal' });
    for (let i = 0; i < 60 * 12; i++) tick(r);
    const snap = r.engine.snapshot() as unknown as { callI?: number };
    const made = snap.callI!;
    expect(made).toBeGreaterThan(3);
    delete snap.callI;
    const copy = idle({ duration: 45, rounds: 1, seed: 7, level: 'normal' });
    copy.engine.restore(snap);
    tick({ ...copy, k: r.k, bodies: r.bodies, engine: copy.engine } as never);
    expect(copy.engine.calls.filter((c) => c.t <= copy.engine.t).length).toBeGreaterThanOrEqual(made);
    expect(callEvents(copy.events).length).toBeLessThanOrEqual(1);
  });
});
