import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { PoseFrame, PoseService, Trace } from '../types/index.ts';
import { recordTrace, parseTrace, serializeTrace, traceFrames, traceSource, TraceFormatError } from './trace.ts';
import { DEFAULT_SHAPE, synthPose, synthTrace } from './synth.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const schema = read('../types/trace.schema.json') as object;
const example = read('../types/trace.example.json');
const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema);

const steady = (n: number, fps = 30): Trace => synthTrace({ id: 'steady', durationMs: ((n - 1) * 1000) / fps, fps, seed: 3 });

describe('trace file format', () => {
  it('the example trace passes the JSON schema and the parser', () => {
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    const t = parseTrace(example);
    expect(t.meta.origin).toBe('synthetic');
    expect(t.frames.length).toBe(22);
    expect(t.frames[0]?.lm?.length).toBe(33);
    expect(t.frames.at(-1)?.lm).toBeNull();
    expect(t.labels.map((l) => l.id)).toEqual(['still', 'jump', 'leave']);
  });

  it('serialise then parse keeps every value within the rounding', () => {
    const t = synthTrace({ id: 'round-trip', durationMs: 500, seed: 9 });
    const file = serializeTrace(t);
    expect(validate(file), JSON.stringify(validate.errors)).toBe(true);
    const back = parseTrace(JSON.parse(JSON.stringify(file)));
    expect(back.frames.length).toBe(t.frames.length);
    t.frames.forEach((f, i) => {
      const g = back.frames[i];
      expect(g?.t).toBeCloseTo(f.t, 1);
      f.lm?.forEach((p, j) => {
        expect(g?.lm?.[j]?.x).toBeCloseTo(p.x, 4);
        expect(g?.lm?.[j]?.y).toBeCloseTo(p.y, 4);
        expect(g?.lm?.[j]?.visibility).toBeCloseTo(p.visibility, 3);
      });
    });
  });

  it('the parser and the schema refuse the same broken files', () => {
    const good = JSON.parse(JSON.stringify(example)) as Record<string, unknown> & { frames: { t: number; lm: number[] | null }[] };
    const broken: [string, (f: typeof good) => void][] = [
      ['wrong format', (f) => { f.format = 'something-else'; }],
      ['newer version', (f) => { f.version = 2; }],
      ['short landmark list', (f) => { f.frames[0]!.lm = [0.5, 0.5, 0, 1]; }],
      ['text in landmarks', (f) => { (f.frames[0]!.lm as unknown[])[5] = '0.5'; }],
      ['unknown field', (f) => { f.extra = 1; }],
      ['bad meta id', (f) => { (f.meta as Record<string, unknown>).id = 'Has Spaces'; }],
      ['unknown label', (f) => { f.labels = [{ t: 0, id: 'dance', kind: 'rep' }]; }],
      ['no frames', (f) => { f.frames = []; }],
    ];
    for (const [name, breakIt] of broken) {
      const f = JSON.parse(JSON.stringify(good)) as typeof good;
      breakIt(f);
      expect(validate(f), `schema should refuse: ${name}`).toBe(false);
      expect(() => parseTrace(f), `parser should refuse: ${name}`).toThrow(TraceFormatError);
    }
    // Only the parser checks that frame times never go back (the schema cannot).
    const back = JSON.parse(JSON.stringify(good)) as typeof good;
    back.frames[3]!.t = 1;
    expect(() => parseTrace(back)).toThrow(/must not go back/);
  });
});

describe('traceFrames (slow-device resampling)', () => {
  it('without hz it returns every frame with the trace times and source frame numbers', () => {
    const t = steady(31);
    const f = traceFrames(t, { t0: 1000 });
    expect(f.length).toBe(31);
    expect(f[0]?.t).toBe(1000);
    expect(f.map((x) => x.seq)).toEqual([...Array(31).keys()]);
    expect(f[0]?.source).toBe('trace');
    expect(f[0]?.aspect).toBeCloseTo(DEFAULT_SHAPE.aspect);
  });

  it.each([[10, 11], [4, 5]])('at %i Hz a 30 fps second gives %i distinct frames, spaced like the device', (hz, n) => {
    const f = traceFrames(steady(31), { hz });
    expect(f.length).toBe(n);
    expect(new Set(f.map((x) => x.seq)).size).toBe(n);
    for (let i = 1; i < f.length; i++) expect((f[i] as PoseFrame).t - (f[i - 1] as PoseFrame).t).toBeCloseTo(1000 / hz, 6);
  });

  it('a rate at or above the trace rate changes nothing', () => {
    expect(traceFrames(steady(31), { hz: 60 }).length).toBe(31);
  });

  it('returned landmarks are copies', () => {
    const t = steady(2);
    const f = traceFrames(t);
    f[0]!.landmarks![0]!.x = 99;
    expect(t.frames[0]!.lm![0]!.x).not.toBe(99);
  });
});

describe('traceSource', () => {
  it('plays every frame in order, then reports done', async () => {
    const t = steady(16);
    const src = traceSource(t, { speed: 20 });
    const got: (number | null)[] = [];
    src.onFrame((f) => got.push(f.landmarks ? f.landmarks[0]!.x : null));
    expect(src.kind).toBe('landmarks');
    expect(src.source).toBe('trace');
    await src.start();
    await new Promise((r) => setTimeout(r, 200));
    expect(src.done).toBe(true);
    expect(got).toEqual(t.frames.map((f) => f.lm![0]!.x));
  });

  it('stop() halts playback and unsubscribe stops delivery', async () => {
    const t = steady(60);
    const src = traceSource(t, { speed: 1 });
    let n = 0;
    const off = src.onFrame(() => { n++; });
    await src.start();
    await new Promise((r) => setTimeout(r, 120));
    src.stop();
    const atStop = n;
    expect(atStop).toBeGreaterThan(0);
    expect(atStop).toBeLessThan(60);
    await new Promise((r) => setTimeout(r, 120));
    expect(n).toBe(atStop);
    off();
    expect(src.done).toBe(false);
  });

  it('loop replays from the start', async () => {
    const src = traceSource(steady(4), { speed: 20, loop: true });
    let n = 0;
    src.onFrame(() => { n++; });
    await src.start();
    await new Promise((r) => setTimeout(r, 150));
    src.stop();
    expect(n).toBeGreaterThan(4);
    expect(src.done).toBe(false);
  });
});

describe('recordTrace', () => {
  it('records what the pose service delivers, relative to the first frame', () => {
    const listeners = new Set<(f: PoseFrame) => void>();
    const pose = {
      onFrame(cb: (f: PoseFrame) => void) { listeners.add(cb); return () => listeners.delete(cb); },
    } as unknown as PoseService;
    const rec = recordTrace(pose, { id: 'rec-test', framing: 'full' });
    const lm = synthPose(DEFAULT_SHAPE);
    for (let i = 0; i < 31; i++) for (const cb of listeners) cb({ seq: i, t: 5000 + i * 33.4, landmarks: i === 10 ? null : lm, inferenceMs: 7, source: 'camera', aspect: 16 / 9 });
    expect(rec.frames).toBe(31);
    const t = rec.stop();
    expect(listeners.size).toBe(0);
    expect(t.meta).toEqual({ id: 'rec-test', framing: 'full', origin: 'recorded' });
    expect(t.frames[0]?.t).toBe(0);
    expect(t.frames[10]?.lm).toBeNull();
    expect(t.aspect).toBeCloseTo(16 / 9);
    expect(t.fps).toBeCloseTo(29.9, 1);
    expect(parseTrace(serializeTrace(t)).frames.length).toBe(31);
  });
});
