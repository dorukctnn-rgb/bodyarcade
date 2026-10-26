// Test support: what a real movement detector said about a synthetic figure (core/moves/testing), handed to a game's simulation one
// step at a time, the way the session hands it the hub's latest channels and the events that came in since the step before. The
// pose frames are 30 a second and the game steps 60 a second, so a channel keeps its value between two pictures, and an event
// arrives `latencyK` steps after the moment of the body it is about (the camera, the model and the filter take that long).
// Nothing in production imports this.
import type { MovementEvent } from '../../../core/types/index.ts';
import type { Sample } from '../../../core/moves/testing/harness.ts';
import type { FrameIn, PlayerIn } from '../frame.ts';
import { msOf } from '../util.ts';

export interface Played { samples: readonly Sample[]; events: readonly MovementEvent[] }

export interface ChainOptions {
  /** Steps between the body and the game (default 6: 100 ms, the Firework Jacks pose latency). */
  latencyK?: number;
  /** The player is seen at this step (default: from the first picture on). */
  ok?: (k: number) => boolean;
}

/** One player's input over time. Call it with k = 1, 2, 3 ...: each event is handed over once, at the step where its time has come. */
export function chainPlayer(d: Played, o: ChainOptions = {}): (k: number) => PlayerIn {
  const lag = o.latencyK ?? 6;
  let si = -1;
  let ei = 0;
  return (k) => {
    const t = msOf(k - lag);
    while (si + 1 < d.samples.length && (d.samples[si + 1] as Sample).t <= t) si++;
    const ch = si >= 0 ? { ...(d.samples[si] as Sample).ch } : {};
    const events: PlayerIn['events'][number][] = [];
    while (ei < d.events.length && (d.events[ei] as MovementEvent).t <= t) { events.push({ ...(d.events[ei] as MovementEvent), source: 'pose' }); ei++; }
    return { ok: o.ok ? o.ok(k) : si >= 0, ch, events };
  };
}

/** The frame of the camera for one or two players (mode local2). */
export const chainInput = (...players: ((k: number) => PlayerIn)[]) => (k: number): FrameIn => ({ source: 'pose', players: players.map((p) => p(k)) });
