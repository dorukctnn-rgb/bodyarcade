// A scripted twisting player for Twist Turbine tests: it knows the plan (the band, the storms) and produces what the
// twist detector would give a body that does it: alternating repetitions at a steady pace, a fast run in a blackout, a held
// twist in an overload; the channels (tau, side, span, gap) that go with them, tau swinging from one side to the other
// between the repetitions; or, for 'sloppy', a half-hearted twist that does not reach, hands that drift apart, shoulders
// that do not turn, and a pace under the band.
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
interface Rep { k: number; side: -1 | 1 }

const smooth = (u: number): number => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

export function twistBot(plan: TtPlan, o: TwistBotOptions): TwistBot {
  const rng = mulberry32((o.seed ?? 5) >>> 0);
  const source = o.source ?? 'pose';
  const camera = source === 'pose' || source === 'trace';
  const withChannels = o.channels ?? camera;
  const keyed = source === 'keyboard' || source === 'touch';
  const events = new Map<number, InputEvent[]>();
  const holds: { k0: number; k1: number; side: -1 | 1 }[] = [];
  const tries: Try[] = [];
  const reps: Rep[] = [];
  const [lo, hi] = plan.band;
  const mid = (lo + hi) / 2;

  const push = (k: number, side: -1 | 1, range: number): void => {
    const e: InputEvent = { id: 'twist', kind: 'rep', t: msOf(k), source, ...(keyed ? {} : { side: side === -1 ? 'L' : 'R', q: { range, speed: 2 } }) };
    const list = events.get(k) ?? [];
    list.push(e);
    events.set(k, list);
    reps.push({ k, side });
  };

  if (o.mode !== 'idle') {
    let side: -1 | 1 = -1;
    let fails = 0;
    const handled = new Set<object>();
    for (const seg of plan.segments) {
      if (seg.kind !== 'work') continue;
      let k = seg.startK + 60;
      let lastRep = seg.startK;
      let n = 0;
      while (k < seg.endK - 30) {
        const storm = plan.storms.find((x) => x.startK <= k && k < x.endK);
        // an overload is answered once: hold the side shown, then go on with the pace
        if (storm && storm.kind === 'overload' && o.mode === 'perfect' && !handled.has(storm)) {
          handled.add(storm);
          holds.push({ k0: storm.startK + 20, k1: storm.startK + 20 + storm.holdSteps + 40, side: storm.side });
          side = storm.side;
          k = Math.max(k + 1, storm.startK + 20 + storm.holdSteps + 80);
          lastRep = k - 40;
          continue;
        }
        const fast = storm?.kind === 'blackout' && o.mode === 'perfect';
        const rate = fast ? hi : mid * (o.pace ?? (o.mode === 'sloppy' ? 0.55 : 1));
        const period = Math.round(3600 / rate);
        if (o.mode === 'sloppy' && n % 4 === 3) {
          // a try that does not count: it replaces the repetition; the body swings a little, or the hands come apart, or the shoulders stay
          const kind = fails++ % 3;
          tries.push({ k0: lastRep + 25, k1: k + 30, tau: kind === 0 ? 0.42 : 0.8, span: kind === 2 ? 0.96 : kind === 0 ? 0.97 : 0.8, gap: kind === 1 ? 0.9 : 0.2 });
        } else {
          side = side === 1 ? -1 : 1;
          push(k, side, o.mode === 'sloppy' ? 0.62 + 0.1 * rng() : 0.9);
          lastRep = k;
        }
        n++;
        k += Math.max(30, Math.round(period * (o.mode === 'sloppy' ? 0.7 + 0.6 * rng() : 1)));
      }
    }
  }

  const repSteps = reps.map((r) => r.k);

  /** The body's swing between the repetitions: it holds the side it reached, then moves over to the next one. */
  const swing = (k: number): number => {
    let a = 0, b = reps.length;           // the first repetition after k
    while (a < b) { const m = (a + b) >> 1; if ((reps[m] as Rep).k <= k) a = m + 1; else b = m; }
    const prev = a > 0 ? (reps[a - 1] as Rep) : null;
    const next = a < reps.length ? (reps[a] as Rep) : null;
    if (!prev && !next) return 0;
    if (!next) return (prev as Rep).side * 0.85;
    if (!prev) return next.side * 0.85 * smooth((k - (next.k - 60)) / 60);
    const gap = next.k - prev.k;
    return prev.side * 0.85 + (next.side - prev.side) * 0.85 * smooth((k - (prev.k + 0.3 * gap)) / (0.7 * gap));
  };

  const holdAt = (k: number): -1 | 0 | 1 => { const h = holds.find((x) => k >= x.k0 && k <= x.k1); return h ? h.side : 0; };

  return {
    repSteps,
    at(k: number): PlayerIn {
      if (o.mode === 'idle') return { ok: true, ch: withChannels ? { tau: 0, side: 0, span: 1, gap: 0.2 } : {}, events: [] };
      const ch: Record<string, number> = {};
      let tau = swing(k);
      let span = 1 - 0.25 * Math.min(1, Math.abs(tau) / 0.85), gap = 0.2;
      const hold = holdAt(k);
      if (hold) { tau = hold * 0.88; span = 0.78; }
      for (const t of tries) {
        if (k >= t.k0 && k <= t.k1) { tau = t.tau * Math.sin((2 * Math.PI * (k - t.k0)) / 90); span = t.span; gap = t.gap; }
      }
      const turned = Math.abs(tau) >= 0.6 && span <= 0.9 && gap <= 0.5;
      if (withChannels) { ch['tau'] = tau; ch['side'] = turned ? Math.sign(tau) : 0; ch['span'] = span; ch['gap'] = gap; }
      // keys: the key that is down is the side; the body's swing is not there
      if (keyed) ch['side'] = hold || (Math.abs(swing(k)) >= 0.84 ? Math.sign(swing(k)) : 0);
      return { ok: true, ch, events: events.get(k) ?? [] };
    },
  };
}
