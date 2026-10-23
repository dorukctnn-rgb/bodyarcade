// A stand-in for AudioContext that writes down what is built, so the audio kit can be tested in Node. Time only moves
// when a test moves it (advance), sources end when their stop time has passed, and state changes arrive as events.
// Not part of the kit.
import type { AudioContextLike, CompressorLike } from '../audio.ts';
import type { BufferSourceLike, FilterLike, GainLike, NodeLike, OscLike, ParamLike, SourceLike } from '../sfx.ts';

export interface ParamEvent { type: 'set' | 'exp' | 'lin' | 'cancel'; value: number; time: number }

export class FakeParam implements ParamLike {
  value = 0;
  events: ParamEvent[] = [];
  setValueAtTime(v: number, t: number): this { this.events.push({ type: 'set', value: v, time: t }); this.value = v; return this; }
  exponentialRampToValueAtTime(v: number, t: number): this { this.events.push({ type: 'exp', value: v, time: t }); return this; }
  linearRampToValueAtTime(v: number, t: number): this { this.events.push({ type: 'lin', value: v, time: t }); return this; }
  cancelScheduledValues(t: number): this { this.events.push({ type: 'cancel', value: 0, time: t }); return this; }
}

export class FakeNode implements NodeLike {
  readonly kind: string;
  readonly out: FakeNode[] = [];
  disconnected = false;
  constructor(kind: string) { this.kind = kind; }
  connect(dest: unknown): unknown { this.out.push(dest as FakeNode); return dest; }
  disconnect(): void { this.disconnected = true; }
}

export class FakeSource extends FakeNode implements SourceLike {
  started: { t: number; offset?: number; dur?: number } | null = null;
  stops: number[] = [];
  onended: ((e?: unknown) => void) | null = null;
  ended = false;
  start(t = 0, offset?: number, dur?: number): void {
    if (this.started) throw new Error('start called twice');
    this.started = { t, ...(offset !== undefined ? { offset } : {}), ...(dur !== undefined ? { dur } : {}) };
  }
  stop(t = 0): void { this.stops.push(t); }
  get stopTime(): number { return this.stops.length ? this.stops[this.stops.length - 1]! : Infinity; }
}

export class FakeOsc extends FakeSource implements OscLike {
  type = 'sine';
  frequency = new FakeParam();
  constructor() { super('oscillator'); }
}

export class FakeGain extends FakeNode implements GainLike {
  gain = new FakeParam();
  constructor() { super('gain'); }
}

export class FakeFilter extends FakeNode implements FilterLike {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  constructor() { super('filter'); }
}

export class FakeBufferSource extends FakeSource implements BufferSourceLike {
  buffer: unknown = null;
  loop = false;
  constructor() { super('buffer-source'); }
}

export class FakeCompressor extends FakeNode implements CompressorLike {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam(); attack = new FakeParam(); release = new FakeParam();
  constructor() { super('compressor'); }
}

export interface FakeContextOptions {
  state?: string;
  sampleRate?: number;
  baseLatency?: number | undefined;
  outputLatency?: number | undefined;
  /** Makes resume() fail or stay pending, to test the awkward cases. */
  resume?: 'ok' | 'reject' | 'never';
}

export class FakeContext implements AudioContextLike {
  currentTime = 0;
  state: string;
  readonly sampleRate: number;
  readonly baseLatency: number | undefined;
  readonly outputLatency: number | undefined;
  readonly destination = new FakeNode('destination');
  readonly nodes: FakeNode[] = [];
  readonly buffers: { channels: number; length: number; data: Float32Array }[] = [];
  perf = 1000;
  resumes = 0; suspends = 0; closes = 0;
  private readonly listeners = new Set<() => void>();
  private readonly resumeMode: 'ok' | 'reject' | 'never';

  constructor(o: FakeContextOptions = {}) {
    this.state = o.state ?? 'suspended';
    this.sampleRate = o.sampleRate ?? 48000;
    this.baseLatency = 'baseLatency' in o ? o.baseLatency : 0.01;
    this.outputLatency = 'outputLatency' in o ? o.outputLatency : 0.02;
    this.resumeMode = o.resume ?? 'ok';
  }

  private track<T extends FakeNode>(n: T): T { this.nodes.push(n); return n; }
  createOscillator(): FakeOsc { return this.track(new FakeOsc()); }
  createGain(): FakeGain { return this.track(new FakeGain()); }
  createBiquadFilter(): FakeFilter { return this.track(new FakeFilter()); }
  createBufferSource(): FakeBufferSource { return this.track(new FakeBufferSource()); }
  createDynamicsCompressor(): FakeCompressor { return this.track(new FakeCompressor()); }
  createBuffer(channels: number, length: number): { getChannelData(c: number): Float32Array } {
    const data = new Float32Array(length);
    this.buffers.push({ channels, length, data });
    return { getChannelData: () => data };
  }
  getOutputTimestamp(): { contextTime: number; performanceTime: number } { return { contextTime: this.currentTime, performanceTime: this.perf }; }

  private setState(s: string): void { this.state = s; for (const l of [...this.listeners]) l(); }
  async resume(): Promise<void> {
    this.resumes++;
    if (this.resumeMode === 'reject') throw new Error('resume refused');
    if (this.resumeMode === 'never') return new Promise<void>(() => undefined);
    await Promise.resolve();
    if (this.state !== 'closed') this.setState('running');
  }
  async suspend(): Promise<void> { this.suspends++; await Promise.resolve(); if (this.state !== 'closed') this.setState('suspended'); }
  async close(): Promise<void> { this.closes++; await Promise.resolve(); this.setState('closed'); }
  addEventListener(_t: 'statechange', cb: () => void): void { this.listeners.add(cb); }
  removeEventListener(_t: 'statechange', cb: () => void): void { this.listeners.delete(cb); }
  /** A change from outside (the system takes the audio away). */
  force(state: string): void { this.setState(state); }

  /** Moves time and ends every source whose stop time has passed. Also moves the page clock by the same amount. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    this.perf += seconds * 1000;
    for (const n of this.nodes) {
      if (n instanceof FakeSource && n.started && !n.ended && n.stopTime <= this.currentTime) {
        n.ended = true;
        n.onended?.();
      }
    }
  }

  sources(): FakeSource[] { return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource); }
  active(): FakeSource[] { return this.sources().filter((s) => s.started && !s.ended); }
}
