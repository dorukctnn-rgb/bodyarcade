// Browser side of tests/e2e/audio.spec.ts: the audio kit on the browser's real Web Audio (headless, no sound card needed:
// sounds are rendered offline and read as numbers), plus clock timing and the tap-along calibration with simulated taps.
import { buildMaster, createAudio } from '../../../packages/core/audio/audio.ts';
import { createLatencyCalibrator } from '../../../packages/core/audio/clock.ts';
import { buildSfx, makeNoiseBuffer, SFX, SFX_NAMES, sfxDuration, type GraphContext, type NodeLike, type ToneEvent } from '../../../packages/core/audio/sfx.ts';

export interface RenderResult {
  name: string;
  seconds: number;
  peak: number;
  rms: number;
  firstMsPeak: number;
  lastMsPeak: number;
  nan: boolean;
  /** Zero-crossing estimate of the pitch of the first tone event, Hz, or 0 when it is not a plain tone. */
  pitch: number;
  expectedLow: number;
  expectedHigh: number;
}

const SR = 44100;

function crossingsHz(x: Float32Array, from: number, to: number): number {
  let n = 0;
  const a = Math.max(1, Math.floor(from * SR)), b = Math.min(x.length - 1, Math.floor(to * SR));
  for (let i = a; i < b; i++) if ((x[i - 1]! < 0 && x[i]! >= 0)) n++;
  return n / Math.max(1e-6, to - from);
}

/** Renders one sound offline through the real builder and measures it. */
async function renderOne(name: string): Promise<RenderResult> {
  const def = SFX[name]!;
  const dur = sfxDuration(def);
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * (dur + 0.25)), SR);
  const noise = makeNoiseBuffer(ctx as unknown as GraphContext);
  const start = 0.05;
  buildSfx(ctx as unknown as GraphContext, def, start, ctx.destination as unknown as NodeLike, noise);
  const buf = await ctx.startRendering();
  const x = buf.getChannelData(0);
  let peak = 0, sum = 0, nan = false;
  for (const v of x) { if (Number.isNaN(v)) nan = true; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  const win = (a: number, b: number): number => { let m = 0; for (let i = Math.floor(a * SR); i < Math.min(x.length, Math.floor(b * SR)); i++) m = Math.max(m, Math.abs(x[i]!)); return m; };
  const first = def.events[0]!;
  let pitch = 0, low = 0, high = 0;
  if (first.kind === 'tone') {
    // a tone alone in its time slot: measure its pitch
    const e = first as ToneEvent;
    const overlap = def.events.some((o) => o !== e && o.at < e.at + e.dur && e.at < o.at + o.dur);
    if (!overlap) {
      pitch = crossingsHz(x, start + e.at + e.dur * 0.15, start + e.at + e.dur * 0.85);
      low = Math.min(e.f0, e.f1) * 0.75; high = Math.max(e.f0, e.f1) * 1.3;
    }
  }
  return { name, seconds: dur, peak, rms: Math.sqrt(sum / x.length), firstMsPeak: win(0, start + 0.0003), lastMsPeak: win(dur + start + 0.1, dur + start + 0.2), nan, pitch, expectedLow: low, expectedHigh: high };
}

export async function renderAll(): Promise<RenderResult[]> {
  const out: RenderResult[] = [];
  for (const n of SFX_NAMES) out.push(await renderOne(n));
  return out;
}

/** Many loud sounds at once through the real master chain (gain and limiter), rendered offline: does it clip? */
export async function massRender(o: { names: string[]; copies: number; volume: number }): Promise<{ peak: number; clipped: number; samples: number; unlimitedPeak: number }> {
  const run = async (limited: boolean): Promise<Float32Array> => {
    const ctx = new OfflineAudioContext(1, SR * 2, SR);
    const g = ctx as unknown as GraphContext & { destination: unknown; createDynamicsCompressor(): never };
    const out = limited ? buildMaster(g as never, o.volume) : (() => { const m = ctx.createGain(); m.gain.value = o.volume; m.connect(ctx.destination); return m; })();
    const noise = makeNoiseBuffer(g);
    for (let c = 0; c < o.copies; c++) for (const n of o.names) buildSfx(g, SFX[n]!, 0.05 + c * 0.003, out as unknown as NodeLike, noise);
    return (await ctx.startRendering()).getChannelData(0);
  };
  const x = await run(true), raw = await run(false);
  let peak = 0, clipped = 0, rawPeak = 0;
  for (const v of x) { peak = Math.max(peak, Math.abs(v)); if (Math.abs(v) >= 0.999) clipped++; }
  for (const v of raw) rawPeak = Math.max(rawPeak, Math.abs(v));
  return { peak, clipped, samples: x.length, unlimitedPeak: rawPeak };
}

export interface RealResult {
  state: string;
  stateAfterUnlock: string;
  advanced: number;
  baseLatencyMs: number;
  outputLatencyMs: number | null;
  clockLatencyMs: number;
  played: number;
  skipped: number;
  perfPairingErrorMs: number;
  ready: boolean;
}

/** The real thing: unlock, play, and see the clock run. */
export async function realContext(): Promise<RealResult> {
  const audio = createAudio();
  const before = audio.state;
  audio.unlock();
  const ready = await audio.ready(4000);
  const state = audio.state;
  const clock = audio.clock();
  const t0 = clock.now();
  for (const n of ['ui-tap', 'coin', 'jump', 'star', 'perfect']) audio.play(n);
  await new Promise((r) => setTimeout(r, 400));
  const advanced = clock.now() - t0;
  const ctx = audio.context!;
  const pair = clock.fromPerformance(performance.now());
  const err = Math.abs(pair - ctx.currentTime) * 1000;
  const st = audio.stats();
  const out: RealResult = {
    state: before, stateAfterUnlock: state, advanced,
    baseLatencyMs: (ctx.baseLatency ?? 0) * 1000, outputLatencyMs: ctx.outputLatency === undefined ? null : ctx.outputLatency * 1000,
    clockLatencyMs: clock.latencyMs, ready, played: st.played, skipped: Object.values(st.skipped).reduce((a, b) => a + b, 0), perfPairingErrorMs: err,
  };
  await audio.dispose();
  return out;
}

export interface TimingResult { n: number; p50: number; p95: number; max: number; min: number }

/** How late callbacks of the audio clock run, in milliseconds, for callbacks 50 ms apart. */
export async function clockTiming(o: { count: number }): Promise<TimingResult> {
  const audio = createAudio();
  audio.unlock();
  await audio.ready(4000);
  const clock = audio.clock();
  const late: number[] = [];
  await new Promise<void>((resolve) => {
    const base = clock.now() + 0.2;
    for (let i = 0; i < o.count; i++) {
      const t = base + i * 0.05 + (i % 3) * 0.0137;
      clock.schedule(t, () => { late.push((clock.now() - t) * 1000); if (late.length === o.count) resolve(); });
    }
  });
  const s = [...late].sort((a, b) => a - b);
  await audio.dispose();
  return { n: s.length, p50: s[Math.floor(s.length * 0.5)]!, p95: s[Math.floor(s.length * 0.95)]!, max: s[s.length - 1]!, min: s[0]! };
}

/** The whole tap-along with a player who taps `offsetMs` after every click, on the real audio clock. */
export async function calibrationRun(o: { offsetMs: number; beats: number }): Promise<{ offsetMs: number; spreadMs: number; taps: number; ok: boolean; seconds: number }> {
  const audio = createAudio();
  audio.unlock();
  await audio.ready(4000);
  const clock = audio.clock();
  const cal = createLatencyCalibrator({ clock, beats: o.beats, click: (t) => { audio.playAt('metronome', t); } });
  const t0 = performance.now();
  const times = cal.start();
  await new Promise<void>((resolve) => {
    for (const t of times) clock.schedule(t + o.offsetMs / 1000, () => { cal.tap(performance.now()); });
    clock.schedule(times[times.length - 1]! + 0.8 + o.offsetMs / 1000, resolve);
  });
  const r = cal.result();
  await audio.dispose();
  return { offsetMs: r.offsetMs, spreadMs: r.spreadMs, taps: r.taps, ok: r.ok, seconds: (performance.now() - t0) / 1000 };
}

/** Sessions in a row: each makes a context, plays, and closes it. */
export async function sessions(o: { count: number }): Promise<{ states: string[]; created: number[]; played: number[] }> {
  const states: string[] = [], created: number[] = [], played: number[] = [];
  for (let i = 0; i < o.count; i++) {
    const audio = createAudio();
    audio.unlock();
    await new Promise((r) => setTimeout(r, 40));
    for (let k = 0; k < 30; k++) { audio.play(k % 2 ? 'coin' : 'star'); await new Promise((r) => setTimeout(r, 12)); }
    const ctx = audio.context!;
    const st = audio.stats();
    created.push(st.contextsCreated); played.push(st.played);
    await audio.dispose();
    states.push(ctx.state);
  }
  return { states, created, played };
}

/** Before any gesture: nothing exists and nothing throws. */
export function beforeGesture(): { state: string; stats: { locked: number; contexts: number } } {
  const audio = createAudio();
  audio.play('coin'); audio.play('hit');
  const st = audio.stats();
  return { state: audio.state, stats: { locked: st.skipped.locked, contexts: st.contextsCreated } };
}
