// The highlight clip: two recorders that take turns so that the last seconds of a round are always in one of them, a clip only when
// there are seconds worth keeping, nothing while the round is paused, and no clip and no error where the browser cannot make one.
import { describe, expect, it } from 'vitest';
import { frameDrawn } from '../../../core/render3d/frames.ts';
import { browserDeps, CLIP_BRAND, CLIP_FPS, CLIP_MAX_EDGE, clipAllowed, clipKind, ClipRecorder, clipSize, isWebGLStage, paintOverlay, MIN_CLIP_MS, SEGMENT_MS, STAGGER_MS, type ClipDeps, type ClipSource, type RecorderLike } from './clip.ts';

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

  it('records a WebGL stage (whose buffer changes size when its quality steps) as avc3 where the browser can, else as any canvas', () => {
    expect(clipKind(winWith(['video/mp4']), { webgl: true })?.mime).toBe('video/mp4;codecs=avc3');
    // a browser that records avc1 and not avc3, and one that records no MP4
    expect(clipKind(winWith(['video/mp4;codecs=avc1', 'video/webm']), { webgl: true })?.mime).toBe('video/mp4;codecs=avc1');
    expect(clipKind(winWith(['video/webm']), { webgl: true })).toMatchObject({ ext: 'webm' });
    // a 2D stage is the description every player knows
    expect(clipKind(winWith(['video/mp4']))?.mime).toBe('video/mp4;codecs=avc1');
  });

  it('takes a canvas with no 2D context for a WebGL stage, and a 2D one, or one that cannot say, for a 2D one', () => {
    expect(isWebGLStage({ getContext: () => null } as unknown as HTMLCanvasElement)).toBe(true);
    expect(isWebGLStage({ getContext: () => ({}) } as unknown as HTMLCanvasElement)).toBe(false);
    expect(isWebGLStage({ getContext: () => { throw new Error('no context'); } } as unknown as HTMLCanvasElement)).toBe(false);
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

describe('the picture of the clip of a 2D stage and of a WebGL stage', () => {
  /** A canvas that notes what is drawn on it; `webgl` has no 2D context, as a WebGL canvas has none. */
  function stage(o: { webgl: boolean; w: number; h: number; fail?: boolean }): { canvas: HTMLCanvasElement; made: { w: number; h: number; draws: string[]; texts: string[]; captured: number }[] } {
    const made: { w: number; h: number; draws: string[]; texts: string[]; captured: number }[] = [];
    const copy = (): { out: unknown; rec: (typeof made)[number] } => {
      const rec = { w: 0, h: 0, draws: [] as string[], texts: [] as string[], captured: 0 };
      made.push(rec);
      const ctx = {
        font: '', fillStyle: '', textBaseline: '', textAlign: '',
        save: () => undefined, restore: () => undefined, beginPath: () => undefined, fill: () => undefined, rect: () => undefined, roundRect: () => undefined,
        measureText: (t: string) => ({ width: t.length * 8 }) as TextMetrics,
        drawImage: (_src: unknown, _x: number, _y: number, w: number, h: number) => { if (o.fail) throw new Error('the buffer is gone'); rec.draws.push(`${w}x${h}`); },
        fillText: (t: string) => { rec.texts.push(t); },
      };
      const out = {
        get width() { return rec.w; }, set width(v: number) { rec.w = v; }, get height() { return rec.h; }, set height(v: number) { rec.h = v; },
        getContext: () => ctx,
        captureStream: () => { rec.captured++; return { getTracks: () => [] } as unknown as MediaStream; },
      };
      return { out, rec };
    };
    const canvas = {
      width: o.w, height: o.h, clientWidth: o.w, clientHeight: o.h,
      ownerDocument: { createElement: () => copy().out },
      getContext: () => (o.webgl ? null : {}),
      captureStream: () => { throw new Error('the stage itself is never recorded'); },
    } as unknown as HTMLCanvasElement;
    return { canvas, made };
  }

  function win(clock: { t: number }, timers: { fn: () => void; ms: number; on: boolean }[]): Window & typeof globalThis {
    return {
      MediaRecorder: Fake,
      devicePixelRatio: 1,
      performance: { now: () => clock.t },
      setInterval: (fn: () => void, ms: number) => { timers.push({ fn, ms, on: true }); return timers.length; },
      clearInterval: (id: number) => { const t = timers[id - 1]; if (t) t.on = false; },
    } as unknown as Window & typeof globalThis;
  }

  const overlay = (): { score: string; time: string } => ({ score: '420', time: '0:37' });

  it('a 2D stage is copied onto a canvas of the size of the clip on a timer, with the score, the time and the name of the site', () => {
    const clock = { t: 0 };
    const timers: { fn: () => void; ms: number; on: boolean }[] = [];
    const deps = browserDeps(win(clock, timers), overlay) as ClipDeps;
    const { canvas, made } = stage({ webgl: false, w: 1920, h: 1080 });
    const src = deps.source(canvas) as ClipSource;
    expect(made).toHaveLength(1);
    expect(`${made[0]!.w}x${made[0]!.h}`).toBe(`${CLIP_MAX_EDGE}x540`);
    const first = made[0]!.draws.length;
    for (const t of timers.filter((x) => x.on)) { t.fn(); t.fn(); }
    expect(made[0]!.draws.length).toBe(first + 2);
    expect(made[0]!.texts).toEqual(expect.arrayContaining(['420', '0:37', CLIP_BRAND]));
    expect(timers.filter((x) => x.on).map((x) => x.ms)).toEqual([1000 / CLIP_FPS]);
    src.close();
    expect(timers.some((x) => x.on)).toBe(false);
  });

  it('a WebGL stage is copied the same way (the same size, the same score, time and name of the site) in the task in which its kit has drawn a frame, never on a timer', () => {
    const clock = { t: 0 };
    const timers: { fn: () => void; ms: number; on: boolean }[] = [];
    const deps = browserDeps(win(clock, timers), overlay) as ClipDeps;
    const { canvas, made } = stage({ webgl: true, w: 1920, h: 1080 });
    const src = deps.source(canvas) as ClipSource;
    // the clip is a picture of the same size as a 2D stage's, and the stage itself is not what is recorded
    expect(`${made[0]!.w}x${made[0]!.h}`).toBe(`${CLIP_MAX_EDGE}x540`);
    expect(made[0]!.captured).toBe(1);
    // nothing is copied on a timer: a WebGL canvas copied outside the task that drew it is blank
    expect(timers.filter((x) => x.on)).toHaveLength(0);
    expect(made[0]!.draws).toHaveLength(0);
    // a frame drawn by the kit is copied, scaled to the clip's size, with the overlay
    frameDrawn(canvas);
    expect(made[0]!.draws).toEqual([`${CLIP_MAX_EDGE}x540`]);
    expect(made[0]!.texts).toEqual(expect.arrayContaining(['420', '0:37', CLIP_BRAND]));
    // at the clip's rate: frames that come faster than that are not all copied
    clock.t += 5;
    frameDrawn(canvas);
    expect(made[0]!.draws).toHaveLength(1);
    clock.t += 1000 / CLIP_FPS;
    frameDrawn(canvas);
    expect(made[0]!.draws).toHaveLength(2);
    // the quality steps change the stage's own buffer: the clip's picture does not follow it
    (canvas as unknown as { width: number }).width = 800;
    clock.t += 100;
    frameDrawn(canvas);
    expect(`${made[0]!.w}x${made[0]!.h}`).toBe(`${CLIP_MAX_EDGE}x540`);
    // after the round no frame is copied
    src.close();
    clock.t += 100;
    frameDrawn(canvas);
    expect(made[0]!.draws).toHaveLength(3);
  });

  it('a small stage keeps its size, a WebGL one as a 2D one, and a stage with nothing on the screen gives no picture to record', () => {
    const clock = { t: 0 };
    const deps = browserDeps(win(clock, []), overlay) as ClipDeps;
    for (const webgl of [false, true]) {
      const { canvas, made } = stage({ webgl, w: 390, h: 844 });
      expect(deps.source(canvas)).not.toBeNull();
      expect(`${made[0]!.w}x${made[0]!.h}`).toBe('390x844');
      expect(deps.source(stage({ webgl, w: 1, h: 1 }).canvas)).toBeNull();
    }
  });

  it('a copy that fails is a frame less, never an error in the round', () => {
    const clock = { t: 0 };
    const deps = browserDeps(win(clock, []), overlay) as ClipDeps;
    const { canvas, made } = stage({ webgl: true, w: 640, h: 360, fail: true });
    deps.source(canvas);
    expect(() => frameDrawn(canvas)).not.toThrow();
    expect(made[0]!.texts).toEqual([]);
  });
});
