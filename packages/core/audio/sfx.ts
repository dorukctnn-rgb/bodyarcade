// Sound effects as data, and the one function that turns a definition into Web Audio nodes (replaces the `sfx` synth of
// site/game/app.js:23). A definition is a list of short tones (an oscillator with a pitch sweep and an envelope) and noise
// bursts (a shared noise buffer through a filter). Because they are data, a test can check every sound for sane loudness,
// length and pitch without a sound card, and the same builder renders into an OfflineAudioContext to check the signal.
//
// What changed from the old synth: no new noise buffer per hit (one shared buffer per context), every envelope starts
// and ends at silence (no clicks), the loudest moment of any sound is capped, and sounds can be scheduled at an exact
// audio time (for rhythm games), not only "now".

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type NoiseFilter = 'lowpass' | 'highpass' | 'bandpass';

export interface ToneEvent {
  kind: 'tone';
  /** Seconds after the start of the sound. */
  at: number;
  dur: number;
  wave: Wave;
  /** Start and end pitch in Hz (a sweep when they differ, exponential). */
  f0: number;
  f1: number;
  /** Peak level, 0 to 1. */
  gain: number;
  /** Seconds to rise to the peak. Default 0.01. */
  attack?: number;
  /** A lowpass over the tone, in Hz, to take the edge off squares and saws. */
  lp?: number;
}

export interface NoiseEvent {
  kind: 'noise';
  at: number;
  dur: number;
  filter: NoiseFilter;
  /** Start and end cutoff in Hz. */
  f0: number;
  f1: number;
  q?: number;
  gain: number;
  attack?: number;
}

export type SfxEvent = ToneEvent | NoiseEvent;

export interface SfxDef {
  name: string;
  events: readonly SfxEvent[];
  /** Milliseconds during which the same sound is not played twice (a hit counted twice in one frame stays one sound). */
  cooldown: number;
  /** 2 is kept when many sounds play at once; 0 is the first to be cut. */
  priority: 0 | 1 | 2;
}

const tone = (at: number, dur: number, wave: Wave, f0: number, f1: number, gain: number, extra: { attack?: number; lp?: number } = {}): ToneEvent => ({ kind: 'tone', at, dur, wave, f0, f1, gain, ...extra });
const noise = (at: number, dur: number, filter: NoiseFilter, f0: number, f1: number, gain: number, extra: { q?: number; attack?: number } = {}): NoiseEvent => ({ kind: 'noise', at, dur, filter, f0, f1, gain, ...extra });
const def = (name: string, events: SfxEvent[], cooldown = 40, priority: 0 | 1 | 2 = 1): SfxDef => ({ name, events, cooldown, priority });

/** The library. The first seven are the sounds of the live game, with the same pitches and levels. */
export const SFX: Readonly<Record<string, SfxDef>> = Object.fromEntries([
  def('jump', [tone(0, 0.18, 'sine', 300, 700, 0.18)], 60),
  def('coin', [tone(0, 0.07, 'square', 1200, 1200, 0.08, { lp: 5000 }), tone(0.07, 0.12, 'square', 1600, 1600, 0.08, { lp: 5000 })], 30),
  def('pass', [tone(0, 0.12, 'triangle', 520, 880, 0.15)], 60),
  def('hit', [noise(0, 0.3, 'lowpass', 500, 500, 0.35), tone(0, 0.3, 'sawtooth', 140, 60, 0.2, { lp: 900 })], 120, 2),
  def('tick', [tone(0, 0.08, 'square', 660, 660, 0.1, { lp: 4000 })], 80),
  def('go', [tone(0, 0.25, 'square', 880, 1320, 0.12, { lp: 5000 }), tone(0.05, 0.2, 'sine', 1760, 2640, 0.05)], 200, 2),
  def('done', [523, 659, 784, 1046].map((f, i) => tone(i * 0.12, 0.35, 'triangle', f, f, 0.16)), 300, 2),

  def('ui-tap', [tone(0, 0.05, 'triangle', 880, 880, 0.12)], 40, 1),
  def('ui-back', [tone(0, 0.07, 'triangle', 660, 440, 0.12)], 40, 1),
  def('flap', [tone(0, 0.09, 'triangle', 380, 620, 0.16), noise(0, 0.06, 'bandpass', 1800, 2600, 0.07, { q: 1.2 })], 90),
  def('miss', [tone(0, 0.22, 'sawtooth', 220, 110, 0.12, { lp: 700 })], 100, 1),
  def('star', [1046, 1318, 1568].map((f, i) => tone(i * 0.06, 0.1, 'triangle', f, f, 0.13)), 50),
  def('pad', [tone(0, 0.12, 'sine', 520, 260, 0.22), noise(0, 0.05, 'lowpass', 900, 600, 0.1)], 50),
  def('tag', [tone(0, 0.1, 'triangle', 740, 1040, 0.15), tone(0.05, 0.08, 'sine', 1480, 1480, 0.07)], 50),
  def('rep', [tone(0, 0.1, 'sine', 440, 660, 0.14)], 60),
  def('rep-best', [tone(0, 0.1, 'sine', 523, 784, 0.14), tone(0.09, 0.18, 'triangle', 1046, 1046, 0.12)], 120, 2),
  def('perfect', [tone(0, 0.12, 'triangle', 1318, 1318, 0.16), tone(0.06, 0.2, 'triangle', 1976, 1976, 0.12)], 30, 2),
  def('good', [tone(0, 0.12, 'triangle', 988, 988, 0.13)], 30, 1),
  def('late', [tone(0, 0.1, 'sine', 330, 300, 0.1)], 30, 0),
  def('firework-launch', [noise(0, 0.35, 'bandpass', 400, 3000, 0.3, { q: 1 })], 80, 0),
  def('firework-burst', [noise(0, 0.3, 'highpass', 2500, 1800, 0.2), tone(0, 0.25, 'sine', 1800, 900, 0.08)], 40, 1),
  def('warn', [tone(0, 0.08, 'square', 600, 600, 0.1, { lp: 3000 }), tone(0.12, 0.08, 'square', 600, 600, 0.1, { lp: 3000 })], 400, 2),
  def('win', [659, 784, 988, 1318].map((f, i) => tone(i * 0.11, 0.4, i % 2 ? 'triangle' : 'sine', f, f, 0.15)), 400, 2),
  def('lose', [tone(0, 0.5, 'sawtooth', 392, 196, 0.14, { lp: 800, attack: 0.02 })], 400, 2),
  def('metronome', [noise(0, 0.025, 'highpass', 3000, 3000, 0.3, { attack: 0.001 }), tone(0, 0.03, 'sine', 1500, 1500, 0.2, { attack: 0.001 })], 0, 2),
].map((d) => [d.name, d]));

export const SFX_NAMES: readonly string[] = Object.keys(SFX);

/** When the last event of a sound ends, in seconds after its start. */
export function sfxDuration(d: SfxDef): number {
  return d.events.reduce((m, e) => Math.max(m, e.at + e.dur), 0);
}

/** The level of one event's envelope at time t (seconds after the sound starts): exponential up to the peak, exponential down. */
function envelopeAt(e: SfxEvent, t: number): number {
  const FLOOR_ = 0.0001;
  const u = t - e.at;
  if (u < 0 || u > e.dur) return 0;
  const attack = Math.min(e.attack ?? 0.01, e.dur * 0.5);
  if (u <= attack) return FLOOR_ * Math.pow(Math.max(FLOOR_ * 2, e.gain) / FLOOR_, u / attack);
  return e.gain * Math.pow(FLOOR_ / e.gain, (u - attack) / (e.dur - attack));
}

/**
 * An upper bound on how loud a sound gets: the largest value, over time, of the sum of its events' envelopes (as if every
 * tone were in phase, which real sounds never are). Sampled every millisecond.
 */
export function sfxPeakBound(d: SfxDef): number {
  const end = sfxDuration(d);
  let worst = 0;
  for (let t = 0; t <= end; t += 0.001) {
    let sum = 0;
    for (const e of d.events) sum += envelopeAt(e, t);
    if (sum > worst) worst = sum;
  }
  return worst;
}

// ───────────────────────── Web Audio ─────────────────────────

/** The part of an AudioParam the builder uses. */
export interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}

export interface NodeLike { connect(dest: unknown): unknown; disconnect(): void }
export interface SourceLike extends NodeLike { start(t?: number, offset?: number, dur?: number): void; stop(t?: number): void; onended: ((e?: unknown) => void) | null }
export interface OscLike extends SourceLike { type: string; frequency: ParamLike }
export interface GainLike extends NodeLike { gain: ParamLike }
export interface FilterLike extends NodeLike { type: string; frequency: ParamLike; Q: ParamLike }
export interface BufferSourceLike extends SourceLike { buffer: unknown; loop: boolean }

/** What the builder needs of a (real or offline) audio context. */
export interface GraphContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  createOscillator(): OscLike;
  createGain(): GainLike;
  createBiquadFilter(): FilterLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(c: number): Float32Array };
}

const FLOOR = 0.0001;
export const NOISE_SECONDS = 1;

/** One second of noise from a fixed seed, shared by every noise event of a context: identical sound on every run. */
export function makeNoiseBuffer(ctx: GraphContext): unknown {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x9e3779b9 >>> 0;
  for (let i = 0; i < d.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = (s / 2147483648) - 1;
  }
  return buf;
}

export interface SfxVoice {
  /** Audio-clock time at which the last event ends (and everything has been stopped). */
  readonly end: number;
  /** Fades the whole sound out over a few milliseconds from `at` and stops it. */
  stop(at: number): void;
}

/**
 * Builds the nodes of one sound and starts them at `when` (audio-clock seconds), into `out`. Every source is stopped by
 * itself after its envelope, and `onDone` is called once when the last one has ended.
 */
export function buildSfx(ctx: GraphContext, d: SfxDef, when: number, out: NodeLike, noise: unknown, onDone?: () => void): SfxVoice {
  const sources: SourceLike[] = [];
  const gains: GainLike[] = [];
  let open = 0;
  let end = when;
  const finished = (): void => { if (--open === 0) onDone?.(); };

  for (const e of d.events) {
    const t0 = when + e.at;
    const t1 = t0 + e.dur;
    const attack = Math.min(e.attack ?? 0.01, e.dur * 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(FLOOR * 2, e.gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(FLOOR, t1);
    let src: SourceLike;
    let tail: NodeLike;
    if (e.kind === 'tone') {
      const o = ctx.createOscillator();
      o.type = e.wave;
      o.frequency.setValueAtTime(e.f0, t0);
      if (e.f1 !== e.f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, e.f1), t1);
      src = o;
      tail = o;
      if (e.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(e.lp, t0);
        o.connect(f);
        tail = f;
      }
    } else {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = false;
      const f = ctx.createBiquadFilter();
      f.type = e.filter;
      f.Q.setValueAtTime(e.q ?? 0.7, t0);
      f.frequency.setValueAtTime(e.f0, t0);
      if (e.f1 !== e.f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, e.f1), t1);
      s.connect(f);
      src = s;
      tail = f;
    }
    tail.connect(g);
    g.connect(out);
    open++;
    src.onended = (): void => { try { src.disconnect(); g.disconnect(); } catch { /* already gone */ } finished(); };
    if (e.kind === 'noise') src.start(t0, 0, Math.min(e.dur + 0.02, NOISE_SECONDS)); else src.start(t0);
    src.stop(t1 + 0.02);
    sources.push(src);
    gains.push(g);
    end = Math.max(end, t1 + 0.02);
  }

  return {
    end,
    stop(at) {
      for (let i = 0; i < sources.length; i++) {
        const g = gains[i]!;
        try {
          g.gain.cancelScheduledValues(at);
          g.gain.setValueAtTime(Math.max(FLOOR, g.gain.value), at);
          g.gain.exponentialRampToValueAtTime(FLOOR, at + 0.008);
          sources[i]!.stop(at + 0.012);
        } catch { /* a source that never started cannot be stopped; it ends by itself */ }
      }
    },
  };
}
