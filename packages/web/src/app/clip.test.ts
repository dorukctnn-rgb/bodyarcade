// The highlight clip: two recorders that take turns so that the last seconds of a round are always in one of them, a clip only when
// there are seconds worth keeping, nothing while the round is paused, and no clip and no error where the browser cannot make one.
import { describe, expect, it } from 'vitest';
import { clipAllowed, clipKind, ClipRecorder, MIN_CLIP_MS, SEGMENT_MS, STAGGER_MS, type ClipDeps, type ClipSource, type RecorderLike } from './clip.ts';

class Fake implements RecorderLike {
  static made: Fake[] = [];
  static throwOnMake = false;
  static silentStop = false;
  state: RecorderLike['state'] = 'inactive';
  ondataavailable: RecorderLike['ondataavailable'] = null;
  onstop: RecorderLike['onstop'] = null;
  onerror: RecorderLike['onerror'] = null;
  readonly stream: unknown;
  readonly options: { mimeType: string; videoBitsPerSecond: number };
  constructor(stream: unknown, options: { mimeType: string; videoBitsPerSecond: number }) {
    if (Fake.throwOnMake) throw new Error('no encoder');
    this.stream = stream;
    this.options = options;
    Fake.made.push(this);
  }
  start(): void { this.state = 'recording'; }
  pause(): void { this.state = 'paused'; }
  resume(): void { this.state = 'recording'; }
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'.repeat(400)]) });
    if (!Fake.silentStop) this.onstop?.();
  }
  static isTypeSupported = (): boolean => true;
  get running(): boolean { return this.state !== 'inactive'; }
}

function rig(opts: { source?: boolean } = {}): { rec: ClipRecorder; advance(ms: number): void; closed: () => boolean; deps: ClipDeps } {
  Fake.made = [];
  Fake.throwOnMake = false;
  Fake.silentStop = false;
  let t = 1000;
  let closed = false;
  const timers: { fn: () => void; ms: number; next: number; on: boolean }[] = [];
  const deps: ClipDeps = {
    Recorder: Fake as unknown as ClipDeps['Recorder'],
    now: () => t,
    every: (fn, ms) => { const timer = { fn, ms, next: t + ms, on: true }; timers.push(timer); return () => { timer.on = false; }; },
    source: (): ClipSource | null => (opts.source === false ? null : { stream: {} as MediaStream, close: () => { closed = true; } }),
  };
  const rec = new ClipRecorder({} as HTMLCanvasElement, deps, { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' });
  const advance = (ms: number): void => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 100);
      for (const timer of timers) {
        if (timer.on && t >= timer.next) { timer.next += timer.ms; timer.fn(); }
      }
    }
  };
  return { rec, advance, closed: () => closed, deps };
}

const live = (): Fake[] => Fake.made.filter((f) => f.running);

describe('two recorders take turns', () => {
  it('the first starts at once, the second joins half a length later, and each starts again when it has run its length', () => {
    const { rec, advance } = rig();
    rec.start();
    expect(Fake.made).toHaveLength(1);
    advance(STAGGER_MS - 400);
    expect(Fake.made).toHaveLength(1);
    advance(600);
    expect(Fake.made).toHaveLength(2);
    expect(live()).toHaveLength(2);
    advance(SEGMENT_MS - STAGGER_MS);
    // the first one has run ten seconds: it was thrown away, and a new one took its place
    expect(Fake.made).toHaveLength(3);
    expect(Fake.made[0]?.running).toBe(false);
    expect(live()).toHaveLength(2);
    advance(STAGGER_MS);
    expect(Fake.made).toHaveLength(4);
    expect(live()).toHaveLength(2);
    // never more than the two, however long the round
    advance(60_000);
    expect(live().length).toBeLessThanOrEqual(2);
    rec.dispose();
  });

  it('records with the kind it was given and a bitrate a phone can carry', () => {
    const { rec } = rig();
    rec.start();
    expect(Fake.made[0]?.options).toEqual({ mimeType: 'video/mp4;codecs=avc1.42E01E', videoBitsPerSecond: 2_000_000 });
    rec.dispose();
  });
});

describe('the clip at the end of a round', () => {
  it('is the recorder that has run longest, the other thrown away, and everything is let go', async () => {
    const { rec, advance, closed } = rig();
    rec.start();
    advance(12_000);
    const file = await rec.finish();
    expect(file).not.toBeNull();
    // at twelve seconds: the first recorder was renewed at ten (two seconds), the second has run seven
    expect(file?.seconds).toBe(7);
    expect(file?.ext).toBe('mp4');
    expect(file?.mime).toBe('video/mp4');
    expect(file?.blob.size).toBeGreaterThan(0);
    expect(live()).toHaveLength(0);
    expect(closed()).toBe(true);
  });

  it('is at most the length of a segment, and at least half of it once the round is long enough', async () => {
    for (const total of [5_200, 7_000, 9_900, 10_300, 14_000, 25_000, 61_000]) {
      const { rec, advance } = rig();
      rec.start();
      advance(total);
      const file = await rec.finish();
      expect(file, `${total} ms`).not.toBeNull();
      expect(file!.seconds * 1000, `${total} ms`).toBeGreaterThanOrEqual(STAGGER_MS - 300);
      expect(file!.seconds * 1000, `${total} ms`).toBeLessThanOrEqual(SEGMENT_MS + 300);
    }
  });

  it('is none for a round shorter than the least worth keeping, and nothing is left running', async () => {
    const { rec, advance, closed } = rig();
    rec.start();
    advance(MIN_CLIP_MS - 600);
    expect(await rec.finish()).toBeNull();
    expect(live()).toHaveLength(0);
    expect(closed()).toBe(true);
  });

  it('does not wait for a recorder that never says it has stopped', async () => {
    const { rec, advance } = rig();
    rec.start();
    advance(6_000);
    Fake.silentStop = true;
    const pending = rec.finish();
    let done = false;
    void pending.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    advance(1_700);
    const file = await pending;
    expect(done).toBe(true);
    expect(file?.blob.size).toBeGreaterThan(0);
  });
});

describe('while the round is paused', () => {
  it('no time is recorded, the recorders pause and go on again, and the clip is as long as the play was', async () => {
    const { rec, advance } = rig();
    rec.start();
    advance(4_000);
    rec.pause();
    expect(live().every((f) => f.state === 'paused')).toBe(true);
    advance(60_000);
    expect(Fake.made).toHaveLength(1);
    rec.resume();
    expect(live().every((f) => f.state === 'recording')).toBe(true);
    advance(2_000);
    const file = await rec.finish();
    expect(file?.seconds).toBe(6);
  });

  it('a pause at the very end does not count either', async () => {
    const { rec, advance } = rig();
    rec.start();
    advance(5_000);
    rec.pause();
    advance(30_000);
    expect((await rec.finish())?.seconds).toBe(5);
  });
});

describe('where no clip can be made', () => {
  it('a canvas that cannot be recorded: nothing starts, no clip, no error', async () => {
    const { rec, advance } = rig({ source: false });
    rec.start();
    advance(10_000);
    expect(Fake.made).toHaveLength(0);
    expect(await rec.finish()).toBeNull();
  });

  it('an encoder that cannot start is tried a few times, then given up, with no error', async () => {
    const { rec, advance } = rig();
    Fake.throwOnMake = true;
    rec.start();
    advance(30_000);
    expect(Fake.made).toHaveLength(0);
    expect(await rec.finish()).toBeNull();
  });

  it('leaving the round lets everything go without a clip', () => {
    const { rec, advance, closed } = rig();
    rec.start();
    advance(8_000);
    rec.dispose();
    expect(live()).toHaveLength(0);
    expect(closed()).toBe(true);
    // a second call changes nothing
    rec.dispose();
  });
});

describe('when a round is kept for a clip', () => {
  const base = { clips: true, share: true, mirror: false };

  it('a game that does not draw the camera is kept when the switch is on and the profile may share', () => {
    expect(clipAllowed(base)).toBe(true);
    expect(clipAllowed({ ...base, clips: false })).toBe(false);
    expect(clipAllowed({ ...base, share: false })).toBe(false);
  });

  it('a mirror game draws the camera picture in its game view, and the camera video is never recorded: it makes no clip', () => {
    expect(clipAllowed({ ...base, mirror: true })).toBe(false);
  });
});

describe('what this browser can record', () => {
  const winWith = (types: string[], captures = true, recorder = true): Window & typeof globalThis => {
    const R = Object.assign(function Recorder() { /* never built here */ }, { isTypeSupported: (m: string) => types.some((t) => m.startsWith(t)) });
    return { ...(recorder ? { MediaRecorder: R } : {}), HTMLCanvasElement: { prototype: captures ? { captureStream: () => ({}) } : {} } } as unknown as Window & typeof globalThis;
  };

  it('prefers MP4, the file the apps that take a shared clip like best, then WebM', () => {
    expect(clipKind(winWith(['video/mp4', 'video/webm']))).toMatchObject({ ext: 'mp4' });
    expect(clipKind(winWith(['video/webm']))).toMatchObject({ ext: 'webm' });
    expect(clipKind(winWith(['video/webm;codecs=vp8']))?.mime).toBe('video/webm;codecs=vp8');
  });

  it('is nothing without a recorder, without a way to take a picture of a canvas, or with no kind it knows', () => {
    expect(clipKind(winWith(['video/mp4'], true, false))).toBeNull();
    expect(clipKind(winWith(['video/mp4'], false))).toBeNull();
    expect(clipKind(winWith(['audio/ogg']))).toBeNull();
  });
});
