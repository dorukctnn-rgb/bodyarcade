import { describe, expect, it } from 'vitest';
import { contentArgs, leaderArgs } from './convert.ts';
import { findStart, LEADER_FRAMES, leaderWhiteAt, pageScript, type Sample } from './cam.ts';

/** What the page would see: one look per frame from frame `firstLook`, with a little timing noise, then dull content. */
function looks(t0: number, fps: number, firstLook: number, count: number, noise = 3): Sample[] {
  const out: Sample[] = [];
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let f = firstLook; f < firstLook + count; f++) {
    const t = t0 + (f / fps) * 1000 + (rnd() - 0.5) * 2 * noise;
    out.push([t, f < LEADER_FRAMES ? (leaderWhiteAt(f) ? 0.96 : 0.03) : 0.3 + 0.1 * rnd()]);
  }
  return out;
}

describe('sync leader', () => {
  it('has pictures of different lengths: white 6, black 9, white 12, black 15', () => {
    expect(LEADER_FRAMES).toBe(42);
    expect([0, 5, 6, 14, 15, 26, 27, 41, 42].map(leaderWhiteAt)).toEqual([true, true, false, false, true, true, false, false, false]);
  });

  it('finds the start of the video within one frame, also when the first frames were missed', () => {
    for (const first of [0, 1, 3, 7, 14]) {
      const found = findStart(looks(51234.5, 30, first, 120), 30);
      expect(found, `first look at frame ${first}`).not.toBeNull();
      expect(Math.abs((found?.t0 ?? 0) - 51234.5)).toBeLessThan(22);
      expect(found?.playbackFps).toBe(30);
      expect(found?.disagree ?? 99).toBeLessThanOrEqual(1);
    }
  });

  it('notices a stream that plays at another rate than the file was made for', () => {
    const found = findStart(looks(9000, 15, 1, 120), 30);
    expect(found?.playbackFps).toBe(15);
    expect(Math.abs((found?.t0 ?? 0) - 9000)).toBeLessThan(40);
  });

  it('says nothing when the leader was not seen', () => {
    expect(findStart(looks(1000, 30, 60, 100), 30)).toBeNull();
    const flat: Sample[] = Array.from({ length: 60 }, (_, i) => [1000 + i * 33.3, 0.3] as const);
    expect(findStart(flat, 30)).toBeNull();
    expect(findStart(looks(1000, 30, 0, 4), 30)).toBeNull();
  });
});

describe('page script', () => {
  it('is valid code and says what it does', () => {
    const code = pageScript({ seed: 5, lookFrames: 90 });
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain('getUserMedia');
    expect(code).toContain('requestVideoFrameCallback');
    expect(pageScript({ seed: null, lookFrames: 10 })).toContain('const seed = null');
  });

  it('makes random numbers repeatable for a seed and gives each round its own seed', () => {
    const run = (): { r: number[]; seeds: number[] } => {
      const fakeWindow: Record<string, unknown> = {};
      const crypto = { getRandomValues: <T extends ArrayBufferView>(a: T): T => a };
      const math = Object.assign(Object.create(Math) as Math, { random: Math.random });
      new Function('window', 'crypto', 'Math', 'navigator', 'document', 'performance', pageScript({ seed: 99, lookFrames: 10 }))(fakeWindow, crypto, math, {}, {}, { now: () => 0 });
      const seeds = [0, 1, 2].map(() => (crypto.getRandomValues(new Uint32Array(1)) as Uint32Array)[0] as number);
      return { r: [math.random(), math.random(), math.random()], seeds };
    };
    const a = run();
    const b = run();
    expect(a.r).toEqual(b.r);
    expect(a.seeds).toEqual([99, 100, 101]);
    expect(a.r.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('ffmpeg arguments', () => {
  const base = { width: 640, height: 360, fps: 30, quality: 4, out: 'out.mjpeg' };
  it('makes the leader of four pictures with exact frame counts', () => {
    const args = leaderArgs(base);
    const graph = args[args.indexOf('-filter_complex') + 1] as string;
    for (const n of [6, 9, 12, 15]) expect(graph).toContain(`trim=end_frame=${n},`);
    expect(graph).toContain('concat=n=4:v=1:a=0[out]');
    expect(graph).toContain('s=640x360:r=30');
    expect(args.slice(-3)).toEqual(['-f', 'mjpeg', 'out.mjpeg']);
  });
  it('fits the content into the picture with bars, at the rate asked for', () => {
    const args = contentArgs({ ...base, input: 'in.mp4', fit: 'contain', mirror: false });
    const vf = args[args.indexOf('-vf') + 1] as string;
    expect(vf).toContain('fps=30');
    expect(vf).toContain('pad=640:360');
    expect(vf).not.toContain('hflip');
    expect(args).not.toContain('-ss');
  });
  it('can fill the picture, flip it, take a part of the source and read a raw file at its rate', () => {
    const args = contentArgs({ ...base, input: 'in.mjpeg', fit: 'cover', mirror: true, from: 2, to: 10, inputFps: 15 });
    const vf = args[args.indexOf('-vf') + 1] as string;
    expect(vf).toContain('hflip');
    expect(vf).toContain('crop=640:360');
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '2']);
    expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '8']);
    expect(args.slice(args.indexOf('-framerate'), args.indexOf('-framerate') + 2)).toEqual(['-framerate', '15']);
    expect(args.indexOf('-framerate')).toBeLessThan(args.indexOf('-i'));
  });
});
