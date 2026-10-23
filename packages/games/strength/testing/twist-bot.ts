// A scripted twisting player for Twist Turbine tests: it knows the plan (the band, the storms) and produces what the
// twist detector would give a body that does it: alternating repetitions at a steady pace, a fast run in a blackout, a held
// twist in an overload; the channels (tau, side, span, gap) that go with them; or, for 'sloppy', a half-hearted twist that
// does not reach, hands that drift apart, and a pace under the band.
import { mulberry32 } from '../../../core/loop/rng.ts';
import type { InputEvent, InputSourceId } from '../../../core/types/index.ts';
import type { PlayerIn } from '../../_shared/frame.ts';
import { msOf } from '../../_shared/util.ts';
import type { TtPlan } from '../turbine.ts';
import type { BotMode } from './bots.ts';

export interface TwistBotOptions {
  mode: BotMode;
  source?: InputSourceId;
  seed?: number;
  /** Pace over the middle of the band: 1 is the middle, 0.5 half of it. */
  pace?: number;
  /** Channels with the events (default: for the camera only). */
  channels?: boolean;
}

export interface TwistBot { at(k: number): PlayerIn; repSteps: readonly number[] }

interface Try { k0: number; k1: number; tau: number; span: number; gap: number }

export function twistBot(plan: TtPlan, o: TwistBotOptions): TwistBot {
  const rng = mulberry32((o.seed ?? 5) >>> 0);
  const source = o.source ?? 'pose';
  const camera = source === 'pose' || source === 'trace';
  const withChannels = o.channels ?? camera;
  const keyed = source === 'keyboard' || source === 'touch';
  const events = new Map<number, InputEvent[]>();
  const holds: { k0: number; k1: number; side: -1 | 1 }[] = [];
  const tries: Try[] = [];
  const repSteps: number[] = [];
  const [lo, hi] = plan.band;
  const mid = (lo + hi) / 2;

  const push = (k: number, side: -1 | 1, range: number): void => {
    const e: InputEvent = { id: 'twist', kind: 'rep', t: msOf(k), source, ...(keyed ? {} : { side: side === -1 ? 'L' : 'R', q: { range, speed: 2 } }) };
    const list = events.get(k) ?? [];
    list.push(e);
    events.set(k, list);
    repSteps.push(k);
  };

  if (o.mode !== 'idle') {
    let side: -1 | 1 = -1;
    let fails = 0;
    for (const seg of plan.segments) {
      if (seg.kind !== 'work') continue;
      let k = seg.startK + 60;
      let n = 0;
      while (k < seg.endK - 30) {
        const storm = plan.storms.find((x) => x.startK <= k && k < x.endK);
        if (storm && storm.kind === 'overload' && o.mode === 'perfect') {
          holds.push({ k0: storm.startK + 20, k1: storm.startK + 20 + storm.holdSteps + 40, side: storm.side });
          side = storm.side;
          k = storm.startK + 20 + storm.holdSteps + 80;
          continue;
        }
        const fast = storm?.kind === 'blackout' && o.mode === 'perfect';
        const rate = fast ? hi : mid * (o.pace ?? (o.mode === 'sloppy' ? 0.55 : 1));
        const period = Math.round(3600 / rate);
        if (o.mode === 'sloppy' && n % 4 === 3) {
          // a try that does not count: the body turns a little, or the hands come apart
          const kind = fails++ % 3;
          tries.push({ k0: k - 30, k1: k + 25, tau: kind === 0 ? 0.42 : 0.8, span: kind === 2 ? 0.96 : kind === 0 ? 0.97 : 0.8, gap: kind === 1 ? 0.9 : 0.2 });
        } else {
          side = side === 1 ? -1 : 1;
          push(k, side, o.mode === 'sloppy' ? 0.62 + 0.1 * rng() : 0.9);
        }
        n++;
        k += Math.max(30, Math.round(period * (o.mode === 'sloppy' ? 0.7 + 0.6 * rng() : 1)));
      }
    }
  }

  return {
    repSteps,
    at(k: number): PlayerIn {
      const ch: Record<string, number> = {};
      if (o.mode === 'idle') return { ok: true, ch: withChannels ? { tau: 0, side: 0, span: 1, gap: 0.2 } : {}, events: [] };
      const evs = events.get(k) ?? [];
      // the side the body is on: the last repetition's, or the hold's
      let last: -1 | 1 = 1;
      for (let i = repSteps.length - 1; i >= 0; i--) { if ((repSteps[i] as number) <= k) { const e = events.get(repSteps[i] as number)?.[0]; last = e?.side === 'L' ? -1 : e?.side === 'R' ? 1 : last; break; } }
      let tau = last * 0.85, span = 0.8, gap = 0.2, sideCh: number = last;
      for (const h of holds) if (k >= h.k0 && k <= h.k1) { tau = h.side * 0.88; sideCh = h.side; }
      for (const t of tries) if (k >= t.k0 && k <= t.k1) { tau = Math.sign(tau || 1) * t.tau; span = t.span; gap = t.gap; sideCh = Math.abs(tau) >= 0.6 && span <= 0.9 && gap <= 0.5 ? Math.sign(tau) : 0; }
      if (withChannels) { ch['tau'] = tau; ch['side'] = sideCh; ch['span'] = span; ch['gap'] = gap; }
      if (keyed) { ch['side'] = sideCh; }
      return { ok: true, ch, events: evs };
    },
  };
}
