import { describe, expect, it } from 'vitest';
import type { QaSnapshot } from './instrument.ts';
import { judge, type RoundState } from './judge.ts';
import { stats } from './stats.ts';

const qa = (o: Partial<{ gl: Record<string, number>; listeners: Record<string, number>; intervals: number; raf: number; workers: number; tracks: number; audio: [number, number] }> = {}): QaSnapshot => ({
  gl: { live: o.gl ?? { Texture: 10, Buffer: 20 }, created: 100, deleted: 70, contexts: 1, contextsLost: 0 },
  listeners: { total: Object.values(o.listeners ?? { 'window:keydown': 1 }).reduce((a, b) => a + b, 0), byKey: o.listeners ?? { 'window:keydown': 1 } },
  timers: { intervals: o.intervals ?? 0, timeouts: 0, raf: o.raf ?? 1 },
  workers: { live: o.workers ?? 1, created: 1 }, audio: { contexts: o.audio?.[0] ?? 1, closed: o.audio?.[1] ?? 0 }, tracks: { live: o.tracks ?? 0, opened: 3 },
  longTasks: { count: 0, totalMs: 0, maxMs: 0 }, frames: [], errors: [],
});
const round = (n: number, o: Partial<RoundState> = {}, q: Parameters<typeof qa>[0] = {}): RoundState => ({ round: n, heapMB: 20, nodes: 1000, listeners: 100, documents: 1, domNodes: 900, qa: qa(q), ...o });

describe('judge', () => {
  it('passes rounds that return to the same state', () => {
    expect(judge([round(1, { heapMB: 30 }), round(2), round(3), round(4, { heapMB: 21 })])).toEqual([]);
  });

  it('wants at least three rounds', () => {
    expect(judge([round(1), round(2)])).toEqual(['too few rounds to compare (need at least 3)']);
  });

  it('finds WebGL objects that are created and never deleted', () => {
    const p = judge([round(1), round(2), round(3, {}, { gl: { Texture: 14, Buffer: 20 } })]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('WebGL Textures alive 10 -> 14');
  });

  it('finds a listener left on the document and says which', () => {
    const p = judge([round(1), round(2), round(3, {}, { listeners: { 'window:keydown': 1, 'document:visibilitychange': 1 } })]);
    expect(p[0]).toContain('document:visibilitychange 0 -> 1');
  });

  it('finds a camera still on, a worker, an interval, an audio context and heap growth beyond the tolerance', () => {
    const p = judge([round(1), round(2), round(3, { heapMB: 40, nodes: 2500 }, { tracks: 1, workers: 2, intervals: 1, audio: [3, 0] })]);
    const text = p.join('\n');
    for (const part of ['camera track', 'workers alive 1 -> 2', 'intervals 0 -> 1', 'audio contexts open 3', 'heap 20 -> 40', 'DOM nodes 1000 -> 2500']) expect(text).toContain(part);
  });

  it('allows the heap to move by the tolerance and ignores the camera for keyboard rounds', () => {
    expect(judge([round(1), round(2), round(3, { heapMB: 22 }), round(4, { heapMB: 23.9 }, { tracks: 1 })], 0.1, 'keyboard')).toEqual([]);
  });
});

describe('stats', () => {
  it('gives percentiles of a list', () => {
    const s = stats(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s).toEqual({ p50: 51, p95: 96, p99: 100, max: 100 });
    expect(stats([])).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 });
  });
});
