// The audio kit: nothing exists until a gesture, sounds are skipped for honest reasons, the voice limit cuts the least
// important sound first, mute and volume reach the master gain, a hidden page suspends the context, and dispose closes it.
import { describe, expect, it } from 'vitest';
import { createAudio, type AudioContextLike, type AudioKit, type VisibilitySource } from './audio.ts';
import { SFX } from './sfx.ts';
import { FakeContext, FakeGain, FakeNode } from './testing/fake-context.ts';

class FakeVisibility extends EventTarget implements VisibilitySource {
  hidden = false;
  set(h: boolean): void { this.hidden = h; this.dispatchEvent(new Event('visibilitychange')); }
  override addEventListener(t: 'visibilitychange', cb: () => void): void { super.addEventListener(t, cb); }
  override removeEventListener(t: 'visibilitychange', cb: () => void): void { super.removeEventListener(t, cb); }
}

function setup(o: { state?: string; resume?: 'ok' | 'reject' | 'never'; volume?: number; maxVoices?: number; fail?: boolean } = {}): { audio: AudioKit; made: FakeContext[]; clockMs: { t: number }; vis: FakeVisibility; errors: unknown[] } {
  const made: FakeContext[] = [];
  const clockMs = { t: 1000 };
  const vis = new FakeVisibility();
  const errors: unknown[] = [];
  const audio = createAudio({
    createContext: () => {
      if (o.fail) throw new Error('no audio here');
      const c = new FakeContext({ state: o.state ?? 'suspended', resume: o.resume ?? 'ok' });
      made.push(c);
      return c as AudioContextLike;
    },
    now: () => clockMs.t,
    visibility: vis,
    ...(o.volume !== undefined ? { volume: o.volume } : {}),
    ...(o.maxVoices !== undefined ? { maxVoices: o.maxVoices } : {}),
    onError: (e) => errors.push(e),
  });
  return { audio, made, clockMs, vis, errors };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('lazy context', () => {
  it('makes nothing until unlock, and says why a sound did not play', () => {
    const { audio, made } = setup();
    expect(made.length).toBe(0);
    expect(audio.state).toBe('none');
    audio.play('jump');
    expect(audio.stats().skipped.locked).toBe(1);
    expect(made.length).toBe(0);
  });

  it('unlock makes the context once, resumes it, and plays an empty buffer inside the gesture', async () => {
    const { audio, made } = setup();
    audio.unlock();
    audio.unlock();
    await flush();
    expect(made.length).toBe(1);
    expect(made[0]!.resumes).toBeGreaterThanOrEqual(1);
    expect(audio.state).toBe('running');
    expect(audio.stats().contextsCreated).toBe(1);
    const unlockBuffer = made[0]!.buffers.find((b) => b.length === 1);
    expect(unlockBuffer).toBeDefined();
    expect(made[0]!.sources().length).toBe(1);
    expect(made[0]!.sources()[0]!.started!.t).toBe(0);
  });

  it('builds a master gain through a limiter into the destination', () => {
    const { audio, made } = setup();
    audio.unlock();
    const c = made[0]!;
    const master = c.nodes.find((n) => n instanceof FakeGain) as FakeGain;
    const limiter = c.nodes.find((n) => n.kind === 'compressor') as FakeNode;
    expect(master.out).toEqual([limiter]);
    expect(limiter.out).toEqual([c.destination]);
    expect(master.gain.events[0]).toMatchObject({ type: 'set', value: 0.8 });
  });

  it('a failing context does not throw into the game: the error is reported and sounds are skipped', () => {
    const { audio, errors } = setup({ fail: true });
    expect(() => audio.unlock()).not.toThrow();
    audio.play('coin');
    expect(errors.length).toBe(1);
    expect(audio.state).toBe('none');
  });

  it('a refused resume is reported, not thrown', async () => {
    const { audio, errors } = setup({ resume: 'reject' });
    audio.unlock();
    await flush();
    expect(errors.length).toBeGreaterThan(0);
    expect(audio.state).toBe('suspended');
  });
});

describe('playing', () => {
  const ready = async (o: Parameters<typeof setup>[0] = {}): Promise<ReturnType<typeof setup>> => { const s = setup(o); s.audio.unlock(); await flush(); return s; };

  it('plays a sound: nodes appear, the voice counts, and it leaves when its sources have ended', async () => {
    const { audio, made } = await ready();
    const before = made[0]!.nodes.length;
    audio.play('coin');
    expect(made[0]!.nodes.length).toBeGreaterThan(before);
    expect(audio.stats()).toMatchObject({ played: 1, voices: 1 });
    made[0]!.advance(1);
    expect(audio.stats().voices).toBe(0);
  });

  it('a sound asked for in the first moments after unlock is not lost (the context is still waking up)', () => {
    const s = setup();
    s.audio.unlock();                       // state is still 'suspended', resume pending
    s.audio.play('ui-tap');
    expect(s.audio.stats().played).toBe(1);
  });

  it('a suspended context with no resume pending plays nothing', async () => {
    const s = await ready();
    await s.audio.suspend();
    s.audio.play('coin');
    expect(s.audio.stats().skipped.notRunning).toBe(1);
    expect(s.audio.stats().played).toBe(0);
  });

  it('an unknown name is skipped and counted', async () => {
    const { audio } = await ready();
    audio.play('nope');
    expect(audio.stats().skipped.unknown).toBe(1);
    expect(audio.has('coin')).toBe(true);
    expect(audio.has('nope')).toBe(false);
  });

  it('the same sound twice inside its cooldown is one sound; after the cooldown, two', async () => {
    const { audio, clockMs } = await ready();
    audio.play('hit');
    clockMs.t += SFX['hit']!.cooldown - 1;
    audio.play('hit');
    clockMs.t += 2;
    audio.play('hit');
    expect(audio.stats()).toMatchObject({ played: 2, skipped: expect.objectContaining({ cooldown: 1 }) });
  });

  it('the metronome has no cooldown', async () => {
    const { audio } = await ready();
    for (let i = 0; i < 5; i++) audio.play('metronome');
    expect(audio.stats().played).toBe(5);
  });

  it('playAt schedules for an exact audio time, never in the past, and is not held back by cooldowns', async () => {
    const { audio, made } = await ready();
    made[0]!.currentTime = 10;
    expect(audio.playAt('perfect', 10.5)).toBe(true);
    expect(audio.playAt('perfect', 10.52)).toBe(true);
    expect(audio.playAt('perfect', 3)).toBe(true);
    const starts = made[0]!.sources().slice(1).filter((s) => s.started).map((s) => s.started!.t);   // the first source is the empty buffer of the unlock
    expect(starts).toContain(10.5);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(10);
  });

  it('mute and volume reach the master gain; a muted kit plays nothing and says so', async () => {
    const { audio, made } = await ready();
    const master = made[0]!.nodes.find((n) => n instanceof FakeGain) as FakeGain;
    audio.setVolume(0.3);
    expect(master.gain.events[master.gain.events.length - 1]).toMatchObject({ type: 'set', value: 0.3 });
    audio.setMuted(true);
    expect(master.gain.events[master.gain.events.length - 1]).toMatchObject({ type: 'set', value: 0 });
    audio.play('coin');
    expect(audio.stats().skipped.muted).toBe(1);
    audio.setMuted(false);
    audio.setVolume(5);
    expect(audio.volume).toBe(1);
    audio.setVolume(-2);
    expect(audio.volume).toBe(0);
    audio.play('coin');
    expect(audio.stats().skipped.muted).toBe(2);
  });

  it('starts muted or at a volume when asked to', async () => {
    const quiet = await ready({ volume: 0 });
    quiet.audio.play('coin');
    expect(quiet.audio.stats().played).toBe(0);
  });
});

describe('clips (recorded sounds such as a coach voice)', () => {
  const file = (seconds: number): ArrayBuffer => new Uint8Array(Math.round(seconds * 100)).fill(7).buffer;
  const ready = async (o: Parameters<typeof setup>[0] = {}): Promise<ReturnType<typeof setup>> => { const s = setup(o); s.audio.unlock(); await flush(); return s; };
  const started = (c: FakeContext): { t: number }[] => c.sources().slice(1).filter((x) => x.started).map((x) => x.started!);   // the first source is the unlock's empty buffer

  it('decodes a file once, keeps its length, and the caller keeps its bytes', async () => {
    const { audio, made } = await ready();
    const bytes = file(0.31);
    expect(await audio.addClip('en/n1', bytes)).toBe(true);
    expect(audio.hasClip('en/n1')).toBe(true);
    expect(audio.hasClip('en/n2')).toBe(false);
    expect(audio.clipDuration('en/n1')).toBeCloseTo(0.31, 5);
    expect(audio.clipDuration('nope')).toBe(0);
    expect(made[0]!.decoded.length).toBe(1);
    expect(made[0]!.decoded[0]).not.toBe(bytes);      // a copy went to the decoder
    expect(bytes.byteLength).toBe(31);
  });

  it('a file that cannot be decoded, or a context that cannot decode, is false and reported, not thrown', async () => {
    const { audio, errors } = await ready();
    expect(await audio.addClip('bad', new Uint8Array([0xff, 1, 2]).buffer)).toBe(false);
    expect(audio.hasClip('bad')).toBe(false);
    expect(errors.length).toBe(1);
    const none = setup({ fail: true });
    expect(await none.audio.addClip('x', file(0.2))).toBe(false);
  });

  it('plays through the same master gain and limiter as every sound, at the time and gain asked for', async () => {
    const { audio, made } = await ready();
    await audio.addClip('en/n2', file(0.3));
    made[0]!.currentTime = 4;
    expect(audio.playClip('en/n2', { when: 4.25, gain: 0.5 })).toBe(true);
    expect(audio.playClip('en/n2', { when: 1 })).toBe(true);          // never in the past
    expect(started(made[0]!).map((s) => s.t)).toEqual([4.25, 4]);
    const master = made[0]!.nodes.find((n) => n instanceof FakeGain) as FakeGain;
    const src = made[0]!.sources().filter((x) => x.kind === 'buffer-source').slice(1)[0]!;
    const gain = src.out[0] as FakeGain;
    expect(gain.gain.events[0]).toMatchObject({ type: 'set', value: 0.5, time: 4.25 });
    expect(gain.out).toEqual([master]);
    expect(audio.stats()).toMatchObject({ played: 2, voices: 2 });
    made[0]!.advance(1);
    expect(audio.stats().voices).toBe(0);
  });

  it('a clip is not held back by the cooldown of a sound with the same name, and two of them can overlap', async () => {
    const { audio } = await ready();
    await audio.addClip('en/n1', file(0.3));
    for (let i = 0; i < 4; i++) expect(audio.playClip('en/n1')).toBe(true);
    expect(audio.stats().played).toBe(4);
  });

  it('muted, at volume 0, locked, or with the context suspended: nothing plays and the reason is counted', async () => {
    const { audio } = await ready();
    await audio.addClip('en/n1', file(0.3));
    audio.setMuted(true);
    expect(audio.playClip('en/n1')).toBe(false);
    audio.setMuted(false);
    audio.setVolume(0);
    expect(audio.playClip('en/n1')).toBe(false);
    audio.setVolume(0.8);
    expect(audio.playClip('unknown')).toBe(false);
    await audio.suspend();
    expect(audio.playClip('en/n1')).toBe(false);
    expect(audio.stats().skipped).toMatchObject({ muted: 2, unknown: 1, notRunning: 1 });
    const locked = setup();
    expect(locked.audio.playClip('x')).toBe(false);
  });

  it('shares the voice limit with the sounds: it cuts a less important sound, and is dropped when everything matters more', async () => {
    const s = setup({ maxVoices: 2 });
    s.audio.unlock();
    await flush();
    await s.audio.addClip('en/n1', file(0.3));
    s.audio.play('late');          // priority 0
    s.audio.play('coin');          // 1
    expect(s.audio.playClip('en/n1')).toBe(true);
    expect(s.audio.stats().stolen).toBe(1);
    s.audio.play('go');            // 2 takes the coin's place
    expect(s.audio.playClip('en/n1')).toBe(true);      // both priority 2 now: the older one is cut
    const full = setup({ maxVoices: 1 });
    full.audio.unlock();
    await flush();
    await full.audio.addClip('en/n1', file(0.3));
    full.audio.play('go');
    expect(full.audio.playClip('en/n1')).toBe(true);   // equal priority: the oldest goes
    expect(full.audio.stats().stolen).toBe(1);
  });

  it('can be forgotten by prefix, and dispose forgets them all', async () => {
    const { audio } = await ready();
    await audio.addClip('en/n1', file(0.3));
    await audio.addClip('tr/n1', file(0.3));
    audio.removeClips('en/');
    expect(audio.hasClip('en/n1')).toBe(false);
    expect(audio.hasClip('tr/n1')).toBe(true);
    await audio.dispose();
    expect(audio.hasClip('tr/n1')).toBe(false);
    expect(audio.playClip('tr/n1')).toBe(false);
  });
});

describe('ready', () => {
  it('resolves true once the context runs and its clock has moved, false when it never does', async () => {
    const s = setup();
    s.audio.unlock();
    await flush();
    let result: boolean | null = null;
    const p = s.audio.ready(1000).then((r) => { result = r; });
    await flush();
    expect(result).toBeNull();                     // running, but the clock is still at 0 (the device is opening)
    s.made[0]!.currentTime = 0.02;
    await new Promise((r) => setTimeout(r, 60));
    await p;
    expect(result).toBe(true);
    const never = setup();
    never.audio.unlock();
    await flush();
    const p2 = never.audio.ready(80);
    never.clockMs.t += 200;
    await new Promise((r) => setTimeout(r, 60));
    expect(await p2).toBe(false);
  });

  it('is false for a kit that was never unlocked, and for one that is disposed while waiting', async () => {
    const s = setup();
    const p = s.audio.ready(50);
    s.clockMs.t += 100;
    expect(await p).toBe(false);
    const d = setup();
    d.audio.unlock();
    await flush();
    const q = d.audio.ready(5000);
    await d.audio.dispose();
    await new Promise((r) => setTimeout(r, 40));
    expect(await q).toBe(false);
  });
});

describe('voices', () => {
  it('cuts the oldest of the least important sounds when there are too many', async () => {
    const s = setup({ maxVoices: 4 });
    s.audio.unlock();
    await flush();
    s.audio.play('late');          // priority 0
    s.clockMs.t += 100;
    s.audio.play('coin');          // 1
    s.audio.play('tick');          // 1
    s.audio.play('jump');          // 1
    s.audio.play('go');            // 2: the fifth sound, so something must go; the priority 0 one first
    const st = s.audio.stats();
    expect(st.stolen).toBe(1);
    expect(st.voices).toBe(4);
    expect(st.peakVoices).toBe(4);
    const c = s.made[0]!;
    // the cut one was told to fade now
    expect(c.nodes.filter((n): n is FakeGain => n instanceof FakeGain).some((g) => g.gain.events.some((e) => e.type === 'cancel'))).toBe(true);
  });

  it('a less important sound is dropped, not allowed to cut more important ones', async () => {
    const s = setup({ maxVoices: 2 });
    s.audio.unlock();
    await flush();
    s.audio.play('go');
    s.audio.play('done');          // both priority 2
    s.audio.play('late');          // priority 0 must not cut either
    expect(s.audio.stats().played).toBe(2);
    expect(s.audio.stats().stolen).toBe(0);
  });

  it('finished sounds free their place', async () => {
    const s = setup({ maxVoices: 2 });
    s.audio.unlock();
    await flush();
    for (let i = 0; i < 20; i++) { s.audio.play('coin'); s.clockMs.t += 100; s.made[0]!.advance(0.5); }
    expect(s.audio.stats().stolen).toBe(0);
    expect(s.audio.stats().played).toBe(20);
  });
});

describe('page visibility and the system', () => {
  it('suspends while the page is hidden and comes back when it is shown', async () => {
    const s = setup();
    s.audio.unlock();
    await flush();
    s.vis.set(true);
    await flush();
    expect(s.audio.state).toBe('suspended');
    s.vis.set(false);
    await flush();
    expect(s.audio.state).toBe('running');
  });

  it('does not resume a context the game itself suspended', async () => {
    const s = setup();
    s.audio.unlock();
    await flush();
    await s.audio.suspend();
    s.vis.set(true); s.vis.set(false);
    await flush();
    expect(s.audio.state).toBe('suspended');
    await s.audio.resume();
    expect(s.audio.state).toBe('running');
  });

  it('tells listeners about state changes, including ones the system makes, until they leave', async () => {
    const s = setup();
    const seen: string[] = [];
    const off = s.audio.onState((x) => seen.push(x));
    s.audio.unlock();
    await flush();
    s.made[0]!.force('interrupted');
    expect(seen).toContain('running');
    expect(seen[seen.length - 1]).toBe('interrupted');
    off();
    s.made[0]!.force('running');
    expect(seen[seen.length - 1]).toBe('interrupted');
  });
});

describe('dispose', () => {
  it('stops every sound, closes the context, forgets listeners and refuses to start again', async () => {
    const s = setup();
    s.audio.unlock();
    await flush();
    s.audio.play('done');
    await s.audio.dispose();
    await s.audio.dispose();
    expect(s.made[0]!.closes).toBe(1);
    expect(s.audio.state).toBe('none');
    s.audio.unlock();
    s.audio.play('coin');
    expect(s.made.length).toBe(1);
    s.vis.set(true);
    expect(s.made[0]!.suspends).toBe(0);
  });

  it('five sessions in a row each make and close exactly one context', async () => {
    for (let i = 0; i < 5; i++) {
      const s = setup();
      s.audio.unlock();
      await flush();
      for (let k = 0; k < 20; k++) { s.audio.play('coin'); s.clockMs.t += 100; }
      await s.audio.dispose();
      expect(s.made.length).toBe(1);
      expect(s.made[0]!.closes).toBe(1);
    }
  });
});
