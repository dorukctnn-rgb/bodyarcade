// The audio kit: a lazily created AudioContext, the sound library, voice limits and the clock.
//
// Browsers only let a page make sound after a user gesture, so nothing is created at load: unlock() (called from a
// click or tap handler) creates the context, resumes it and plays an empty buffer (iOS Safari needs that inside the
// gesture). Until then play() does nothing and says so in stats(). Sounds go through one master gain and a limiter so
// that a burst of hits never clips; the number of sounds playing at once is limited, the least important cut first.
import type { AudioApi, Unsubscribe } from '../types/index.ts';
import { createAudioClock, type AudioClockKit } from './clock.ts';
import { buildSfx, makeNoiseBuffer, SFX, sfxDuration, type GainLike, type GraphContext, type NodeLike, type ParamLike, type SfxDef, type SfxVoice } from './sfx.ts';

export type AudioState = 'none' | 'suspended' | 'running' | 'interrupted' | 'closed';

export interface CompressorLike extends NodeLike {
  threshold: ParamLike; knee: ParamLike; ratio: ParamLike; attack: ParamLike; release: ParamLike;
}

/** The real AudioContext, or a stand-in with the same parts. */
export interface AudioContextLike extends GraphContext {
  readonly state: string;
  readonly destination: unknown;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  createDynamicsCompressor(): CompressorLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
  addEventListener(type: 'statechange', cb: () => void): void;
  removeEventListener(type: 'statechange', cb: () => void): void;
}

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
  removeEventListener(type: 'visibilitychange', cb: () => void): void;
}

export interface AudioOptions {
  /** Makes the context. Default: new AudioContext({ latencyHint: 'interactive' }) (webkit-prefixed on old Safari). */
  createContext?: () => AudioContextLike;
  /** performance.now, injectable. */
  now?: () => number;
  /** Suspends the context while the page is hidden, resumes it when it is back. Default: document, when there is one. */
  visibility?: VisibilitySource | null;
  /** 0 to 1. Default 0.8. */
  volume?: number;
  muted?: boolean;
  /** Sounds at once. Default 24. */
  maxVoices?: number;
  /** The sound library. Default: SFX. */
  library?: Readonly<Record<string, SfxDef>>;
  onError?: (e: unknown) => void;
}

export interface AudioStats {
  state: AudioState;
  played: number;
  /** Why sounds were not played. */
  skipped: { locked: number; muted: number; cooldown: number; unknown: number; notRunning: number };
  stolen: number;
  voices: number;
  peakVoices: number;
  contextsCreated: number;
}

export interface AudioKit extends AudioApi {
  readonly state: AudioState;
  readonly context: AudioContextLike | null;
  /** Plays a sound at an audio-clock time (seconds), sample-accurately. Returns false when it was not played. */
  playAt(name: string, when: number): boolean;
  /** The clock, backed by the lazily created context (before unlock it reports 0 and holds callbacks). */
  clock(): AudioClockKit;
  /**
   * Resolves true once the context is running AND its clock has started moving (the audio device takes a moment to open:
   * about 50 to 500 ms after unlock, longer on some Windows and Bluetooth setups), false after `timeoutMs`. Rhythm games wait for it
   * before the first beat; ordinary sound effects need not.
   */
  ready(timeoutMs?: number): Promise<boolean>;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  readonly volume: number;
  readonly muted: boolean;
  /** Sounds in the library. */
  has(name: string): boolean;
  /** A session pauses the sound with the game. */
  suspend(): Promise<void>;
  resume(): Promise<void>;
  onState(cb: (s: AudioState) => void): Unsubscribe;
  stats(): AudioStats;
  dispose(): Promise<void>;
}

interface Voice { name: string; priority: number; started: number; end: number; handle: SfxVoice }

function defaultContext(): AudioContextLike {
  const g = globalThis as unknown as { AudioContext?: new (o?: object) => AudioContextLike; webkitAudioContext?: new (o?: object) => AudioContextLike };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not available');
  return new Ctor({ latencyHint: 'interactive' });
}

/** What the master chain needs of a context: gain, compressor, destination. */
export interface MasterContext extends GraphContext {
  readonly destination: unknown;
  createDynamicsCompressor(): CompressorLike;
}

/**
 * The end of every sound's path: a master gain (volume, mute) into a limiter into the speakers. The limiter is a
 * compressor set to catch peaks (threshold -10 dB, ratio 10) so that a burst of hits never clips. Exported so that a
 * test can render the same chain offline.
 */
export function buildMaster(c: MasterContext, level: number): GainLike {
  const master = c.createGain();
  master.gain.setValueAtTime(level, c.currentTime);
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-10, c.currentTime);
  limiter.knee.setValueAtTime(8, c.currentTime);
  limiter.ratio.setValueAtTime(10, c.currentTime);
  limiter.attack.setValueAtTime(0.003, c.currentTime);
  limiter.release.setValueAtTime(0.12, c.currentTime);
  master.connect(limiter);
  limiter.connect(c.destination);
  return master;
}

export function createAudio(o: AudioOptions = {}): AudioKit {
  const library = o.library ?? SFX;
  const now = o.now ?? ((): number => performance.now());
  const maxVoices = o.maxVoices ?? 24;
  const make = o.createContext ?? defaultContext;
  const vis = o.visibility === undefined ? (typeof document !== 'undefined' ? (document as unknown as VisibilitySource) : null) : o.visibility;

  let ctx: AudioContextLike | null = null;
  let master: GainLike | null = null;
  let noise: unknown = null;
  let volume = Math.min(1, Math.max(0, o.volume ?? 0.8));
  let muted = o.muted ?? false;
  let resumePending = false;
  let silentPlayed = false;
  let heldBySystem = false;
  let disposed = false;
  const voices: Voice[] = [];
  const lastPlayed = new Map<string, number>();
  const stateListeners = new Set<(s: AudioState) => void>();
  const stats: AudioStats = { state: 'none', played: 0, skipped: { locked: 0, muted: 0, cooldown: 0, unknown: 0, notRunning: 0 }, stolen: 0, voices: 0, peakVoices: 0, contextsCreated: 0 };

  const stateOf = (): AudioState => (!ctx ? 'none' : (ctx.state as AudioState));

  function emit(): void {
    stats.state = stateOf();
    for (const cb of [...stateListeners]) { try { cb(stats.state); } catch (e) { o.onError?.(e); } }
  }

  const onStateChange = (): void => {
    if (ctx && ctx.state !== 'suspended') resumePending = false;
    emit();
  };

  const onVisibility = (): void => {
    if (!ctx || !vis) return;
    if (vis.hidden) {
      if (ctx.state === 'running') { heldBySystem = true; void ctx.suspend().catch((e) => o.onError?.(e)); }
    } else if (heldBySystem) {
      heldBySystem = false;
      void resume();
    }
  };
  vis?.addEventListener('visibilitychange', onVisibility);

  function ensure(): AudioContextLike | null {
    if (disposed) return null;
    if (ctx && ctx.state !== 'closed') return ctx;
    try {
      ctx = make();
    } catch (e) {
      o.onError?.(e);
      ctx = null;
      return null;
    }
    stats.contextsCreated++;
    silentPlayed = false;
    const c = ctx;
    master = buildMaster(c, muted ? 0 : volume);
    noise = makeNoiseBuffer(c);
    c.addEventListener('statechange', onStateChange);
    return c;
  }

  async function resume(): Promise<void> {
    const c = ctx;
    if (!c || c.state === 'closed' || c.state === 'running') return;
    resumePending = true;
    try { await c.resume(); } catch (e) { o.onError?.(e); } finally { if (c.state !== 'suspended') resumePending = false; }
    emit();
  }

  function prune(c: AudioContextLike): void {
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i]!.end <= c.currentTime) voices.splice(i, 1);
  }

  function start(name: string, when: number | null): boolean {
    const d = library[name];
    if (!d) { stats.skipped.unknown++; return false; }
    const c = ctx;
    if (!c) { stats.skipped.locked++; return false; }
    if (muted || volume <= 0) { stats.skipped.muted++; return false; }
    if (c.state !== 'running' && !(c.state === 'suspended' && resumePending)) { stats.skipped.notRunning++; return false; }
    const t = now();
    if (when === null) {
      const last = lastPlayed.get(name);
      if (last !== undefined && t - last < d.cooldown) { stats.skipped.cooldown++; return false; }
      lastPlayed.set(name, t);
    }
    prune(c);
    if (voices.length >= maxVoices) {
      // cut the least important sound, the oldest first
      let victim = 0;
      for (let i = 1; i < voices.length; i++) {
        const a = voices[i]!, b = voices[victim]!;
        if (a.priority < b.priority || (a.priority === b.priority && a.started < b.started)) victim = i;
      }
      if (voices[victim]!.priority > d.priority) { stats.skipped.cooldown++; return false; }   // everything playing matters more
      voices[victim]!.handle.stop(c.currentTime);
      voices.splice(victim, 1);
      stats.stolen++;
    }
    const at = Math.max(when ?? c.currentTime, c.currentTime);
    const voice: Voice = { name, priority: d.priority, started: at, end: at + sfxDuration(d) + 0.03, handle: null as unknown as SfxVoice };
    voice.handle = buildSfx(c, d, at, master!, noise, () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      stats.voices = voices.length;
    });
    voices.push(voice);
    stats.played++;
    stats.voices = voices.length;
    if (voices.length > stats.peakVoices) stats.peakVoices = voices.length;
    return true;
  }

  const clock = createAudioClock({ source: () => ctx, perfNow: now, ...(o.onError ? { onError: o.onError } : {}) });

  const kit: AudioKit = {
    get state() { return stateOf(); },
    get context() { return ctx; },
    get volume() { return volume; },
    get muted() { return muted; },
    unlock() {
      const had = ctx !== null && ctx.state !== 'closed';
      const c = ensure();
      if (!c) return;
      if (had && c.state === 'running') return;   // already awake: nothing to start inside this gesture
      if (c.state === 'suspended' || c.state === 'interrupted') {
        resumePending = true;
        c.resume().then(onStateChange, (e) => { resumePending = false; o.onError?.(e); });
      }
      // iOS Safari plays sound only after something has been started inside the gesture (once is enough)
      if (silentPlayed) { emit(); return; }
      silentPlayed = true;
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
      } catch (e) { o.onError?.(e); }
      emit();
    },
    play(name) { start(name, null); },
    playAt(name, when) { return start(name, when); },
    clock() { return clock; },
    has: (name) => name in library,
    ready(timeoutMs = 3000) {
      return new Promise<boolean>((resolve) => {
        const t0 = now();
        const check = (): void => {
          if (disposed) { resolve(false); return; }
          if (ctx && ctx.state === 'running' && ctx.currentTime > 0) { resolve(true); return; }
          if (now() - t0 >= timeoutMs) { resolve(false); return; }
          setTimeout(check, 20);
        };
        check();
      });
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      if (ctx && master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(muted ? 0 : volume, ctx.currentTime); }
    },
    setMuted(m) {
      muted = m;
      if (ctx && master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(muted ? 0 : volume, ctx.currentTime); }
    },
    async suspend() { const c = ctx; if (c && c.state === 'running') { heldBySystem = false; try { await c.suspend(); } catch (e) { o.onError?.(e); } emit(); } },
    resume,
    onState(cb) { stateListeners.add(cb); return () => { stateListeners.delete(cb); }; },
    stats() { prune(ctx ?? ({ currentTime: Infinity } as AudioContextLike)); stats.voices = voices.length; stats.state = stateOf(); return { ...stats, skipped: { ...stats.skipped } }; },
    async dispose() {
      if (disposed) return;
      disposed = true;
      vis?.removeEventListener('visibilitychange', onVisibility);
      clock.dispose();
      const c = ctx;
      if (c) {
        for (const v of voices) { try { v.handle.stop(c.currentTime); } catch { /* ignore */ } }
        voices.length = 0;
        c.removeEventListener('statechange', onStateChange);
        try { await c.close(); } catch (e) { o.onError?.(e); }
      }
      stateListeners.clear();
      ctx = null; master = null; noise = null;
    },
  };
  return kit;
}
