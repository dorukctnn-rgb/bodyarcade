// The highlight clip: two recorders that take turns so that the last seconds of a round are always in one of them, a clip only when
// there are seconds worth keeping, nothing while the round is paused, and no clip and no error where the browser cannot make one.
import { describe, expect, it } from 'vitest';
import { CLIP_BRAND, CLIP_MAX_EDGE, clipAllowed, clipKind, ClipRecorder, clipSize, paintOverlay, MIN_CLIP_MS, recordedAsItIs, SEGMENT_MS, STAGGER_MS, type ClipDeps, type ClipSource, type RecorderLike } from './clip.ts';

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

describe('what the picture of the clip carries', () => {
  /** A pen that notes what is written and where, with a text as wide as its letters. */
  function pen(): { c: Parameters<typeof paintOverlay>[0]; texts: { text: string; x: number; y: number; font: string }[]; plates: { x: number; y: number; w: number; h: number }[] } {
    const texts: { text: string; x: number; y: number; font: string }[] = [];
    const plates: { x: number; y: number; w: number; h: number }[] = [];
    const c = {
      font: '', fillStyle: '', textBaseline: '', textAlign: '',
      save: () => undefined, restore: () => undefined, beginPath: () => undefined, fill: () => undefined,
      measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics,
      rect: (x: number, y: number, w: number, h: number) => { plates.push({ x, y, w, h }); },
      roundRect: (x: number, y: number, w: number, h: number) => { plates.push({ x, y, w, h }); },
      fillText: (text: string, x: number, y: number) => { texts.push({ text, x, y, font: c.font }); },
    } as unknown as Parameters<typeof paintOverlay>[0];
    return { c, texts, plates };
  }

  it('is the score at the top left, the time at the top right and the name of the site at the bottom, all inside the picture', () => {
    const { c, texts, plates } = pen();
    paintOverlay(c, 540, 960, { score: '12 840', time: '0:51' });
    expect(texts.map((t) => t.text)).toEqual(['12 840', '0:51', CLIP_BRAND]);
    const [score, time, brand] = texts;
    expect(score!.x).toBeLessThan(540 / 2);
    expect(time!.x).toBeGreaterThan(540 / 2);
    expect(score!.y).toBeLessThan(960 / 4);
    expect(brand!.y).toBeGreaterThan((960 * 3) / 4);
    for (const p of plates) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(540);
      expect(p.y + p.h).toBeLessThanOrEqual(960);
    }
    expect(texts.every((t) => /system-ui/.test(t.font))).toBe(true);
  });

  it('is only the name of the site when the HUD shows nothing, and a small picture still gets legible sizes', () => {
    const none = pen();
    paintOverlay(none.c, 540, 960, null);
    expect(none.texts.map((t) => t.text)).toEqual([CLIP_BRAND]);
    const half = pen();
    paintOverlay(half.c, 540, 960, { score: '', time: '1:02' });
    expect(half.texts.map((t) => t.text)).toEqual(['1:02', CLIP_BRAND]);
    const small = pen();
    paintOverlay(small.c, 120, 200, { score: '7', time: '0:09' });
    for (const t of small.texts) expect(Number(/(\d+)px/.exec(t.font)?.[1])).toBeGreaterThanOrEqual(11);
  });

  it('works where a context has no rounded rectangle', () => {
    const { c, plates } = pen();
    (c as unknown as { roundRect?: unknown }).roundRect = undefined;
    paintOverlay(c, 540, 960, { score: '5', time: '0:05' });
    expect(plates.length).toBe(3);
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

  it('records a canvas taken as it is (a WebGL stage, whose size changes when its quality steps) as avc3 where the browser can, else as any canvas', () => {
    expect(clipKind(winWith(['video/mp4']), { resizable: true })?.mime).toBe('video/mp4;codecs=avc3');
    // a browser that records avc1 and not avc3, and one that records no MP4
    expect(clipKind(winWith(['video/mp4;codecs=avc1', 'video/webm']), { resizable: true })?.mime).toBe('video/mp4;codecs=avc1');
    expect(clipKind(winWith(['video/webm']), { resizable: true })).toMatchObject({ ext: 'webm' });
    // a 2D stage is copied onto a canvas of a fixed size: avc1, the description every player knows
    expect(clipKind(winWith(['video/mp4']))?.mime).toBe('video/mp4;codecs=avc1');
  });

  it('takes a canvas with no 2D context (a WebGL stage) as it is, and a 2D one, or one that cannot say, as a copy', () => {
    expect(recordedAsItIs({ getContext: () => null } as unknown as HTMLCanvasElement)).toBe(true);
    expect(recordedAsItIs({ getContext: () => ({}) } as unknown as HTMLCanvasElement)).toBe(false);
    expect(recordedAsItIs({ getContext: () => { throw new Error('no context'); } } as unknown as HTMLCanvasElement)).toBe(false);
  });

  it('is nothing without a recorder, without a way to take a picture of a canvas, or with no kind it knows', () => {
    expect(clipKind(winWith(['video/mp4'], true, false))).toBeNull();
    expect(clipKind(winWith(['video/mp4'], false))).toBeNull();
    expect(clipKind(winWith(['audio/ogg']))).toBeNull();
  });
});

describe('the size of the clip', () => {
  it('follows the stage on the screen, not the 300 by 150 of a canvas the kit has not sized yet (Chromium starts the round before that)', () => {
    expect(clipSize({ width: 300, height: 150, clientWidth: 390, clientHeight: 844 })).toEqual({ width: 390, height: 844 });
    expect(clipSize({ width: 300, height: 150, clientWidth: 1280, clientHeight: 800 })).toEqual({ width: CLIP_MAX_EDGE, height: 600 });
  });
  it('is the same once the canvas is sized, and keeps both sides even', () => {
    expect(clipSize({ width: 780, height: 1688, clientWidth: 390, clientHeight: 844 }, 2)).toEqual({ width: 444, height: 960 });
    const odd = clipSize({ width: 300, height: 150, clientWidth: 391, clientHeight: 701 });
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
  });
  it('uses the canvas own size where it has no box on the screen, and never gets below 2', () => {
    expect(clipSize({ width: 640, height: 360, clientWidth: 0, clientHeight: 0 })).toEqual({ width: 640, height: 360 });
    expect(clipSize({ width: 1, height: 1, clientWidth: 0, clientHeight: 0 })).toEqual({ width: 2, height: 2 });
  });
});
