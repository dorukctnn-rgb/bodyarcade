// Test helpers for code that uses LiveClient without a browser: a scheduler whose time only moves when the test says.
import type { Scheduler } from './runtime.ts';

interface Timer { id: number; at: number; fn: () => void }

export class ManualScheduler implements Scheduler {
  t = 1_000_000;
  private timers: Timer[] = [];
  private nextId = 1;

  now(): number { return this.t; }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  /** Moves time forward, running timers in order (timers they set inside the window run too). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (let guard = 0; guard < 1_000_000; guard++) {
      let next: Timer | undefined;
      for (const x of this.timers) if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }

  get pending(): number { return this.timers.length; }
}
