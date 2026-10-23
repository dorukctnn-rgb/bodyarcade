// Runs a simulation with scripted players: the loop every strength test uses.
import { frameFrom, type FrameIn, type PlayerIn } from '../../_shared/frame.ts';
import type { HostSim, SimEvent } from '../../_shared/host.ts';

export interface RunResult { events: SimEvent[]; k: number }

/** Steps `sim` until it is no longer running (or `steps` more steps), feeding it `input(k)` for step k (1-based, continuing from `from`). */
export function run(sim: HostSim, input: (k: number) => FrameIn, o: { from?: number; steps?: number } = {}): RunResult {
  const events: SimEvent[] = [];
  let k = o.from ?? 0;
  const end = o.steps !== undefined ? k + o.steps : Infinity;
  while (sim.phase === 'running' && k < end && k < 1_000_000) {
    k++;
    for (const e of sim.step(input(k))) events.push(e);
  }
  return { events, k };
}

/** The input of one or two scripted players: each bot gives what a body and a camera would give at step k. */
export const inputOf = (...bots: { at(k: number): PlayerIn }[]) => (k: number): FrameIn => frameFrom(bots.map((b) => b.at(k)));
