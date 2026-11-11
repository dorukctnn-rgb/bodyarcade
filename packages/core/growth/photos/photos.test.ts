// G2 on synthetic turns (geometry only; the real-video measurement is angle.real.test.ts on landmark traces from stock clips).
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../loop/rng.ts';
import { alignTransform, ghostLines, postureDiffers } from './align.ts';
import { angleDiff, features, rawClass, TurnTracker, type Bucket } from './angle.ts';
import { Capture } from './capture.ts';
import { lightDiffers, lightStats, sharpness } from './image-stats.ts';
import { decodeLzw, encodeGif, indexOf } from './gif.ts';
import { turnBody, turnFrames } from './synth-turn.ts';

const nearestMain = (deg: number): number => (Math.round(deg / 90) * 90) % 360;

function run(frames: ReturnType<typeof turnFrames>, aspect = 16 / 9): { deg: number; bucket: Bucket | null; approximate: boolean }[] {
  const tr = new TurnTracker();
  return frames.map((f) => ({ deg: f.deg, ...tr.push(features(f.lm, aspect), f.t) }));
}

describe('features and one-frame classes', () => {
  it('front is wide with a face; a side is narrow with the nose pointing its way', () => {
    const rng = mulberry32(1);
    expect(rawClass(features(turnBody(0, rng), 16 / 9)!)).toEqual({ kind: 'wide', faceUp: true });
    expect(rawClass(features(turnBody(180, rng), 16 / 9)!)).toEqual({ kind: 'wide', faceUp: false });
    expect(rawClass(features(turnBody(90, rng), 16 / 9)!)).toEqual({ kind: 'narrow', dir: 1 });
    expect(rawClass(features(turnBody(270, rng), 16 / 9)!)).toEqual({ kind: 'narrow', dir: -1 });
    expect(rawClass(features(turnBody(45, rng), 16 / 9)!).kind).toBe('mid');
  });
  it('no person, no features', () => {
    expect(features(null, 1)).toBeNull();
  });
});

describe('turn tracker', () => {
  for (const [name, degPerS] of [['one way', 24], ['the other way', -24]] as const) {
    it(`a slow turn ${name}: every main direction lands in the right bucket (>= 95 %), never two buckets off`, () => {
      const out = run(turnFrames({ seconds: 17, degPerS, seed: 3 }));
      const main = out.filter((o) => angleDiff(o.deg, nearestMain(o.deg)) <= 15 && o.bucket !== null);
      const right = main.filter((o) => o.bucket === nearestMain(o.deg));
      expect(right.length / main.length).toBeGreaterThanOrEqual(0.95);
      const all = out.filter((o) => o.bucket !== null);
      expect(all.every((o) => angleDiff(o.deg, o.bucket!) <= 60)).toBe(true);
    });
  }

  it('a face "seen" on the back does not turn the back into the front: the turn order decides', () => {
    const out = run(turnFrames({ seconds: 17, degPerS: 24, seed: 4, backFace: 0.8 }));
    const back = out.filter((o) => angleDiff(o.deg, 180) <= 15);
    expect(back.filter((o) => o.bucket === 180).length / back.length).toBeGreaterThanOrEqual(0.9);
  });

  it('turning back the way one came is noticed', () => {
    const fwd = turnFrames({ seconds: 6, degPerS: 30, seed: 5 });
    const tr = new TurnTracker();
    let reversed = false;
    for (const f of fwd) tr.push(features(f.lm, 16 / 9), f.t);
    // now back from ~150 degrees to the front
    for (let k = 0; k < 150; k++) {
      const deg = 150 - k;
      reversed = tr.push(features(turnBody(deg, mulberry32(k)), 16 / 9), 6000 + k * 33).reversed || reversed;
    }
    expect(reversed).toBe(true);
  });
});

describe('capture', () => {
  it('a slow turn fills the four directions with frames near their angle', () => {
    const cap = new Capture('quick');
    const frames = turnFrames({ seconds: 20, degPerS: 18, seed: 9 });
    let filled = 0;
    for (const f of frames) { const s = cap.push({ t: f.t, lm: f.lm, aspect: 16 / 9, sharp: 1 }); if (s.justFilled !== null) filled++; }
    expect(filled).toBe(4);
    expect(cap.isDone()).toBe(true);
    for (const s of cap.result) {
      const at = frames.find((f) => f.t === s.t)!;
      expect(angleDiff(at.deg, s.bucket)).toBeLessThanOrEqual(25);
    }
  });

  it('the 360 mode fills eight buckets', () => {
    const cap = new Capture('full');
    for (const f of turnFrames({ seconds: 26, degPerS: 15, seed: 10 })) cap.push({ t: f.t, lm: f.lm, aspect: 16 / 9, sharp: 1 });
    expect(cap.result.map((s) => s.bucket).sort((a, b) => a - b)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it('too far away: it says "closer" and fills nothing; take it anyway fills the current one', () => {
    const cap = new Capture('quick');
    let cue = null;
    for (const f of turnFrames({ seconds: 3, degPerS: 0, seed: 11, fill: 0.5 })) cue = cap.push({ t: f.t, lm: f.lm, aspect: 16 / 9 }).cue;
    expect(cue).toBe('closer');
    expect(cap.result).toEqual([]);
    expect(cap.force()).toBe(0);
    expect(cap.result[0]!.forced).toBe(true);
  });

  it('too close: "farther"', () => {
    const cap = new Capture('quick');
    let cue = null;
    for (const f of turnFrames({ seconds: 3, degPerS: 0, seed: 12, fill: 0.95 })) cue = cap.push({ t: f.t, lm: f.lm, aspect: 16 / 9 }).cue;
    expect(cue).toBe('farther');
  });

  it('a fast turn leaves directions empty and asks to go slower', () => {
    const cap = new Capture('quick');
    const cues = new Set<string | null>();
    for (const f of turnFrames({ seconds: 6, degPerS: 120, seed: 13, stillS: 0.2 })) cues.add(cap.push({ t: f.t, lm: f.lm, aspect: 16 / 9 }).cue);
    expect(cap.isDone()).toBe(false);
    expect(cues.has('slower')).toBe(true);
  });

  it('the sharpest good frame of a bucket wins', () => {
    const cap = new Capture('quick');
    const frames = turnFrames({ seconds: 3, degPerS: 0, seed: 14 });
    frames.forEach((f, i) => cap.push({ t: f.t, lm: f.lm, aspect: 16 / 9, sharp: i === 40 ? 99 : 1 }));
    expect(cap.result[0]!.sharp).toBe(99);
  });
});

describe('alignment', () => {
  const pose = (fill: number, cx: number, w = 1080, h = 1920) => ({ lm: turnBody(0, mulberry32(2), { fill, cx, aspect: w / h, noise: 0 }), w, h });
  it('two photos of different size and place land the hips on the same spot at the same torso length', () => {
    const a = pose(0.8, 0.5), b = pose(0.6, 0.35, 720, 1280);
    const ta = alignTransform(a, 600, 800)!, tb = alignTransform(b, 600, 800)!;
    const hip = (p: typeof a, t: typeof ta): [number, number] => [t.x + ((p.lm[23]!.x + p.lm[24]!.x) / 2) * p.w * t.scale, t.y + ((p.lm[23]!.y + p.lm[24]!.y) / 2) * p.h * t.scale];
    const sh = (p: typeof a, t: typeof ta): number => t.y + ((p.lm[11]!.y + p.lm[12]!.y) / 2) * p.h * t.scale;
    expect(hip(a, ta)[0]).toBeCloseTo(300, 3); expect(hip(a, ta)[1]).toBeCloseTo(440, 3);
    expect(hip(b, tb)[0]).toBeCloseTo(300, 3); expect(hip(b, tb)[1]).toBeCloseTo(440, 3);
    expect(hip(a, ta)[1] - sh(a, ta)).toBeCloseTo(hip(b, tb)[1] - sh(b, tb), 3);
    expect(ghostLines(a, 600, 800).length).toBeGreaterThan(8);
  });
  it('the same body at another distance is not "a different posture"; legs that shrink are', () => {
    expect(postureDiffers(pose(0.8, 0.5), pose(0.6, 0.4))).toBe(false);
    const b = pose(0.8, 0.5);
    const lm = b.lm.map((p, i) => (i >= 25 ? { ...p, y: p.y - 0.08 } : p));
    expect(postureDiffers(pose(0.8, 0.5), { ...b, lm })).toBe(true);
  });
  it('a saved phone tilt is undone, nothing else rotates', () => {
    expect(alignTransform({ ...pose(0.8, 0.5), tilt: 4 }, 600, 800)!.rot).toBeCloseTo((-4 * Math.PI) / 180);
    expect(alignTransform(pose(0.8, 0.5), 600, 800)!.rot).toBe(0);
  });
});

describe('image stats', () => {
  const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); data.set([r, g, b, 255], (y * w + x) * 4); }
    return { data, width: w, height: h };
  };
  it('a sharp checkerboard beats a blurred ramp', () => {
    expect(sharpness(img(40, 40, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])))).toBeGreaterThan(sharpness(img(40, 40, (x) => [x * 6, x * 6, x * 6])));
  });
  it('light differences over 15 % are named', () => {
    const box = { x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.9 };
    const a = lightStats(img(20, 20, () => [180, 170, 160]), box);
    const b = lightStats(img(20, 20, () => [110, 100, 95]), box);
    const c = lightStats(img(20, 20, () => [150, 170, 220]), box);
    expect(lightDiffers(a, a)).toBeNull();
    expect(lightDiffers(a, b)).toBe('darker');
    expect(lightDiffers(a, c)).toBe('colour');
  });
});

describe('gif', () => {
  it('a looping GIF89a whose pixels decode back to the palette colours', () => {
    const w = 37, h = 23, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([(i * 7) % 256, (i * 13) % 256, (i * 3) % 256, 255], i * 4);
    const g = encodeGif([{ data, width: w, height: h }, { data, width: w, height: h }]);
    expect(String.fromCharCode(...g.slice(0, 6))).toBe('GIF89a');
    expect(g[g.length - 1]).toBe(0x3b);
    let p = 808;
    expect(g[p]).toBe(0x2c);
    p += 10;
    const min = g[p++]!;
    const bytes: number[] = [];
    while (p < g.length && g[p] !== 0) { const n = g[p++]!; for (let k = 0; k < n; k++) bytes.push(g[p++]!); }
    const idx = decodeLzw(bytes, min, w * h);
    expect(idx.length).toBe(w * h);
    for (let i = 0; i < w * h; i++) expect(idx[i]).toBe(indexOf(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!));
  });
});
