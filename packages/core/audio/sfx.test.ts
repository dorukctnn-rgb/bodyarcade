// The sound library as data, and the graph builder: every sound is sane (quiet enough, short enough, audible pitches),
// the live game's seven sounds are all still there, and building a sound makes exactly the nodes it should, starts
// and ends at silence, ends by itself and can be cut short.
import { describe, expect, it } from 'vitest';
import { buildSfx, makeNoiseBuffer, NOISE_SECONDS, SFX, SFX_NAMES, sfxDuration, sfxPeakBound, type NoiseEvent, type ToneEvent } from './sfx.ts';
import { FakeContext, FakeGain, FakeNode, FakeOsc, FakeBufferSource, FakeFilter } from './testing/fake-context.ts';

describe('the library', () => {
  it('keeps the seven sounds of the live game', () => {
    for (const n of ['jump', 'coin', 'pass', 'hit', 'tick', 'go', 'done']) expect(SFX_NAMES).toContain(n);
  });

  it('has the sounds the first games need', () => {
    for (const n of ['flap', 'star', 'pad', 'tag', 'rep', 'perfect', 'good', 'late', 'firework-launch', 'firework-burst', 'win', 'lose', 'metronome', 'ui-tap']) expect(SFX_NAMES).toContain(n);
  });

  it.each(SFX_NAMES.map((n) => [n] as const))('%s: a sound with a name, events, sane times, pitches and levels', (name) => {
    const d = SFX[name]!;
    expect(d.name).toBe(name);
    expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(d.events.length).toBeGreaterThan(0);
    expect(d.events.length).toBeLessThanOrEqual(6);
    expect(sfxDuration(d)).toBeGreaterThan(0.02);
    expect(sfxDuration(d)).toBeLessThanOrEqual(1.6);
    expect(sfxPeakBound(d)).toBeLessThanOrEqual(0.6);    // as if every part were in phase; the limiter sits behind this and should never have to rescue a sound
    expect(d.cooldown).toBeGreaterThanOrEqual(0);
    expect([0, 1, 2]).toContain(d.priority);
    for (const e of d.events) {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.dur).toBeGreaterThanOrEqual(0.02);
      expect(e.dur).toBeLessThanOrEqual(0.6);
      expect(e.gain).toBeGreaterThan(0);
      expect(e.gain).toBeLessThanOrEqual(0.4);
      expect(e.f0).toBeGreaterThanOrEqual(20);
      expect(e.f1).toBeGreaterThanOrEqual(20);
      expect(Math.max(e.f0, e.f1)).toBeLessThanOrEqual(12000);
      if (e.kind === 'tone') expect(['sine', 'square', 'sawtooth', 'triangle']).toContain(e.wave);
      expect((e.attack ?? 0.01)).toBeLessThanOrEqual(e.dur * 0.5 + 1e-9);
    }
  });

  it('the sounds of the live game keep their pitches and levels', () => {
    const t = (n: string, i = 0): ToneEvent => SFX[n]!.events[i] as ToneEvent;
    expect([t('jump').f0, t('jump').f1, t('jump').dur, t('jump').gain]).toEqual([300, 700, 0.18, 0.18]);
    expect([t('coin').f0, t('coin', 1).f0, t('coin', 1).at]).toEqual([1200, 1600, 0.07]);
    expect([t('pass').f0, t('pass').f1]).toEqual([520, 880]);
    expect([t('tick').f0, t('tick').wave]).toEqual([660, 'square']);
    expect(SFX['done']!.events.map((e) => (e as ToneEvent).f0)).toEqual([523, 659, 784, 1046]);
    expect((SFX['hit']!.events[0] as NoiseEvent).kind).toBe('noise');
    expect(t('hit', 1).f0).toBe(140);
  });

  it('only the metronome may repeat without a cooldown, and its click is the loudest and sharpest of all', () => {
    expect(SFX['metronome']!.cooldown).toBe(0);
    expect(SFX['metronome']!.events.every((e) => (e.attack ?? 0.01) <= 0.002)).toBe(true);
    for (const n of SFX_NAMES) if (n !== 'metronome') expect(SFX[n]!.cooldown).toBeGreaterThan(0);
  });
});

describe('noise buffer', () => {
  it('is one second, filled, inside [-1, 1], and the same every time', () => {
    const a = new FakeContext({ sampleRate: 44100 }), b = new FakeContext({ sampleRate: 44100 });
    makeNoiseBuffer(a); makeNoiseBuffer(b);
    expect(a.buffers[0]!.length).toBe(44100 * NOISE_SECONDS);
    const d = a.buffers[0]!.data;
    let min = 1, max = -1, sum = 0;
    for (const v of d) { min = Math.min(min, v); max = Math.max(max, v); sum += v; }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThan(1);
    expect(max - min).toBeGreaterThan(1.9);
    expect(Math.abs(sum / d.length)).toBeLessThan(0.02);
    expect(Buffer.compare(Buffer.from(d.buffer), Buffer.from(b.buffers[0]!.data.buffer))).toBe(0);
  });
});

describe('buildSfx', () => {
  const build = (name: string, when = 1): { ctx: FakeContext; out: FakeNode; done: () => number; voice: ReturnType<typeof buildSfx> } => {
    const ctx = new FakeContext();
    const out = new FakeNode('out');
    let done = 0;
    const noise = makeNoiseBuffer(ctx);
    const voice = buildSfx(ctx, SFX[name]!, when, out, noise, () => { done++; });
    return { ctx, out, done: () => done, voice };
  };

  it('a tone is an oscillator through a gain into the output; a lowpass sits between when asked for', () => {
    const { ctx, out } = build('jump');
    const osc = ctx.nodes.find((n) => n instanceof FakeOsc) as FakeOsc;
    const g = ctx.nodes.find((n) => n instanceof FakeGain) as FakeGain;
    expect(osc.out).toEqual([g]);
    expect(g.out).toEqual([out]);
    const coin = build('coin');
    const o2 = coin.ctx.nodes.find((n) => n instanceof FakeOsc) as FakeOsc;
    expect(o2.out[0]).toBeInstanceOf(FakeFilter);
  });

  it('a noise event is the shared buffer through a filter and a gain, started at the right offset for its length', () => {
    const ctx = new FakeContext();
    const noise = makeNoiseBuffer(ctx);
    buildSfx(ctx, SFX['hit']!, 1, new FakeNode('out'), noise);
    const src = ctx.nodes.find((n) => n instanceof FakeBufferSource) as FakeBufferSource;
    expect(src.buffer).toBe(noise);
    expect(src.loop).toBe(false);
    expect(src.started!.offset).toBe(0);
    expect(src.started!.dur).toBeCloseTo(0.32, 9);
    expect(src.out[0]).toBeInstanceOf(FakeFilter);
    expect(ctx.buffers.length).toBe(1);   // only the shared noise buffer
  });

  it('every envelope starts at silence, rises to its level, and falls back to silence at its end', () => {
    for (const name of SFX_NAMES) {
      const { ctx } = build(name, 2);
      const gains = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain);
      const events = SFX[name]!.events;
      expect(gains.length).toBe(events.length);
      gains.forEach((g, i) => {
        const e = events[i]!;
        const ev = g.gain.events;
        expect(ev[0]).toMatchObject({ type: 'set', time: 2 + e.at });
        expect(ev[0]!.value).toBeLessThan(0.001);
        expect(ev[1]!.type).toBe('exp');
        expect(ev[1]!.value).toBeCloseTo(e.gain, 9);
        expect(ev[2]).toMatchObject({ type: 'exp', time: 2 + e.at + e.dur });
        expect(ev[2]!.value).toBeLessThan(0.001);
        expect(ev[1]!.time).toBeLessThanOrEqual(ev[2]!.time);
      });
    }
  });

  it('pitch sweeps are exponential from f0 to f1 over the length of the tone, and flat tones have no ramp', () => {
    const { ctx } = build('jump', 1);
    const osc = ctx.nodes.find((n) => n instanceof FakeOsc) as FakeOsc;
    expect(osc.frequency.events).toEqual([{ type: 'set', value: 300, time: 1 }, { type: 'exp', value: 700, time: 1.18 }]);
    const tick = build('tick');
    const o = tick.ctx.nodes.find((n) => n instanceof FakeOsc) as FakeOsc;
    expect(o.frequency.events.length).toBe(1);
  });

  it('sources start at their event time and are stopped by themselves a moment after their envelope', () => {
    const { ctx, voice } = build('done', 1);
    const oscs = ctx.nodes.filter((n): n is FakeOsc => n instanceof FakeOsc);
    expect(oscs.map((o) => o.started!.t)).toEqual([1, 1.12, 1.24, 1.36].map((x) => expect.closeTo(x, 9)));
    for (const o of oscs) expect(o.stopTime).toBeGreaterThan(o.started!.t + 0.34);
    expect(voice.end).toBeCloseTo(1.36 + 0.35 + 0.02, 9);
  });

  it('calls onDone once, after the last source has ended, and disconnects what it made', () => {
    const { ctx, done } = build('done', 0);
    ctx.advance(0.3);
    expect(done()).toBe(0);
    ctx.advance(1.0);
    expect(done()).toBe(1);
    ctx.advance(1.0);
    expect(done()).toBe(1);
    expect(ctx.sources().every((s) => s.ended && s.disconnected)).toBe(true);
  });

  it('stop() fades every part to silence within a few milliseconds and stops it', () => {
    const { ctx, voice } = build('done', 0);
    ctx.advance(0.1);
    voice.stop(0.1);
    for (const g of ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain)) {
      const ev = g.gain.events;
      expect(ev.some((e) => e.type === 'cancel' && e.time === 0.1)).toBe(true);
      const last = ev[ev.length - 1]!;
      expect(last.type).toBe('exp');
      expect(last.value).toBeLessThan(0.001);
      expect(last.time).toBeCloseTo(0.108, 9);
    }
    for (const s of ctx.sources()) expect(s.stopTime).toBeCloseTo(0.112, 9);
  });

  it('a very short event keeps its attack inside its length', () => {
    const { ctx } = build('metronome');
    const g = ctx.nodes.find((n) => n instanceof FakeGain) as FakeGain;
    expect(g.gain.events[1]!.time - g.gain.events[0]!.time).toBeLessThanOrEqual(0.0011);
  });
});
