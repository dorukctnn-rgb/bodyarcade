// Players for tests and tools: scripted input for the strength games. A bot never looks at the simulation's state; it is
// given the plan (when the beats are, when a storm comes) and produces what a body and a camera would: channel values per
// step and detector events a little after the movement. 'perfect' moves exactly on the beat, 'sloppy' is off the beat by
// up to a quarter second, skips some and sometimes does not reach (the channels say what was missing), 'idle' stands.
import { mulberry32 } from '../../../core/loop/rng.ts';
import type { InputEvent, InputSourceId } from '../../../core/types/index.ts';
import type { PlayerIn } from '../../_shared/frame.ts';
import { msOf } from '../../_shared/util.ts';
import type { FjPlan } from '../fireworks.ts';

export type BotMode = 'perfect' | 'sloppy' | 'idle';

export interface Shot {
  /** Channel values for each step in [from, to]. */
  channels: Record<string, number>;
}

export interface JackBotOptions {
  mode: BotMode;
  /** How long after the movement the detector's event arrives (the camera's delay), ms. 'pose' events only. */
  delayMs?: number;
  source?: InputSourceId;
  seed?: number;
  /** Seated play (arms only): the channels carry no ankle gap. */
  armsOnly?: boolean;
  /** Where every shot lands relative to the beat, ms; overrides the mode's own (a fixed lateness for the grade tests). */
  offsetMs?: number;
  /** Stand in a set for these beats (0-based, after the count-in). */
  skip?: (set: number, beat: number) => boolean;
}

export interface JackBot {
  /** The input of the step k (1-based). */
  at(k: number): PlayerIn;
  /** The steps at which a jack event is delivered (for the tests to count). */
  events: readonly number[];
}

/** A scripted jumping jack player over a plan. Deterministic: the seed picks the sloppy offsets. */
export function jackBot(plan: FjPlan, o: JackBotOptions): JackBot {
  const rng = mulberry32((o.seed ?? 9) >>> 0);
  const source = o.source ?? 'pose';
  const camera = source === 'pose' || source === 'trace';
  const delay = o.delayMs ?? 100;
  const eventAt = new Map<number, InputEvent[]>();
  const opens: [number, number][] = [];        // [step the event lands at, how far the try got]
  const fails: [number, number, number][] = []; // a try that did not count: [first step, last step, kind 0 arms 1 feet]
  const steps: number[] = [];
  if (o.mode !== 'idle') {
    for (const seg of plan.segments) {
      if (seg.kind !== 'work') continue;
      const period = 3600 / seg.bpm;
      for (let n = 0; seg.startK + Math.round(n * period) < seg.endK - 30; n++) {
        const beatK = seg.startK + Math.round(n * period);
        const judged = n >= plan.timing.countIn;
        if (o.skip?.(seg.set, n)) continue;
        let off = o.offsetMs ?? 0;
        if (o.mode === 'sloppy' && o.offsetMs === undefined) {
          const r = rng(), r2 = rng();
          if (judged && r2 < 0.18) { fails.push([beatK - 6, beatK + 12, n % 2]); continue; }
          off = (r - 0.5) * 520;
        }
        const k = Math.max(1, beatK + Math.round(((off + (camera ? delay : 0)) * 60) / 1000));
        const e: InputEvent = { id: 'jumpingJack', kind: 'rep', t: msOf(k), source };
        const list = eventAt.get(k) ?? [];
        list.push(e);
        eventAt.set(k, list);
        opens.push([k, 1]);
        steps.push(k);
      }
    }
  }
  return {
    events: steps,
    at(k: number): PlayerIn {
      const events = eventAt.get(k) ?? [];
      const ch: Record<string, number> = {};
      if (camera) {
        let open = 0;
        for (const [ek] of opens) {
          if (k >= ek - 5 && k < ek) open = Math.max(open, 0.4 + 0.12 * (k - (ek - 5)));
          else if (k >= ek && k < ek + 9) open = 1;
        }
        let armsUp = -1, gap = 0.6;
        if (open > 0) { armsUp = 0.3; gap = o.armsOnly ? 0 : 1.7; }
        for (const [a, b, kind] of fails) {
          if (k >= a && k <= b) {
            open = Math.max(open, 0.5);
            if (kind === 0) { armsUp = -0.25; gap = o.armsOnly ? 0 : 1.7; } else { armsUp = 0.3; gap = 1.25; }
          }
        }
        ch['open'] = open; ch['armsUp'] = armsUp; ch['gap'] = gap;
      }
      return { ok: true, ch, events };
    },
  };
}
