// PoseService without MediaPipe: a fake backend and a fake video drive the frame pump, the worker fallback, rate
// limiting, dropped-frame accounting and disposal. The real model runs in tests/e2e/pose.spec.ts.
import { describe, expect, it } from 'vitest';
import type { Landmark, PoseFrame, VideoFrameSource } from '../types/index.ts';
import { createPoseService, type DetectResult, type PoseBackend } from './service.ts';
import { DEFAULT_SHAPE, synthPose, synthTrace } from './synth.ts';
import { traceSource } from './trace.ts';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const LOAD = { modelUrl: '/m.task', wasmBase: '/wasm' };

class FakeBackend implements PoseBackend {
  readonly worker: boolean;
  loads = 0; disposed = 0; detects: number[] = [];
  failLoad: Error | null = null;
  /** When set, detect() waits for release(). */
  hold = false;
  private waiting: (() => void)[] = [];
  inferenceMs = 7;
  numPoses: 1 | 2 = 1;
  /** People in front of the fake camera. */
  people: Landmark[][] = [synthPose(DEFAULT_SHAPE)];
  constructor(kind: 'worker' | 'main') { this.worker = kind === 'worker'; }
  async load(o: { numPoses?: 1 | 2 }): Promise<'GPU' | 'CPU'> { this.loads++; this.numPoses = o.numPoses ?? 1; if (this.failLoad) throw this.failLoad; return 'GPU'; }
  async setNumPoses(n: 1 | 2): Promise<void> { this.numPoses = n; }
  async warmUp(): Promise<number> { return 3; }
  async detect(_v: HTMLVideoElement, ts: number): Promise<DetectResult> {
    this.detects.push(ts);
    if (this.hold) await new Promise<void>((r) => this.waiting.push(r));
    return { poses: this.people.slice(0, this.numPoses), inferenceMs: this.inferenceMs };
  }
  release(): void { const w = this.waiting; this.waiting = []; for (const r of w) r(); }
  dispose(): void { this.disposed++; }
}

/** A video whose frames the test presents by hand, through requestVideoFrameCallback. */
class ManualVideo {
  videoWidth = 640; videoHeight = 360; readyState = 4; currentTime = 0;
  private cbs = new Map<number, (now: number, meta: { presentedFrames: number }) => void>();
  private id = 0; private presented = 0;
  requestVideoFrameCallback(cb: (now: number, meta: { presentedFrames: number }) => void): number { this.cbs.set(++this.id, cb); return this.id; }
  cancelVideoFrameCallback(id: number): void { this.cbs.delete(id); }
  present(now: number): void {
    this.presented++;
    const cbs = [...this.cbs.values()]; this.cbs.clear();
    for (const cb of cbs) cb(now, { presentedFrames: this.presented });
  }
  get pendingCallbacks(): number { return this.cbs.size; }
}

const videoSource = (v: ManualVideo): VideoFrameSource => ({ kind: 'video', video: v as unknown as HTMLVideoElement, start: async () => {}, stop: () => {} });

function setup(o: { workerFails?: boolean; supported?: boolean } = {}) {
  const made: FakeBackend[] = [];
  const pose = createPoseService({
    workerSupported: () => o.supported ?? true,
    createBackend: (kind) => {
      const b = new FakeBackend(kind);
      if (kind === 'worker' && o.workerFails) b.failLoad = new Error('no WebGL in workers');
      made.push(b);
      return b;
    },
  });
  return { pose, made };
}

describe('load', () => {
  it('uses the worker when it loads', async () => {
    const { pose, made } = setup();
    const r = await pose.load(LOAD);
    expect(r).toMatchObject({ delegate: 'GPU', worker: true });
    expect(made.map((b) => b.worker)).toEqual([true]);
    expect(await pose.load(LOAD)).toBe(r);                 // loading twice is a no-op
  });

  it('falls back to the main thread when the worker fails, and releases the failed worker', async () => {
    const { pose, made } = setup({ workerFails: true });
    const r = await pose.load(LOAD);
    expect(r.worker).toBe(false);
    expect(made.map((b) => [b.worker, b.disposed])).toEqual([[true, 1], [false, 0]]);
  });

  it("worker: 'only' fails instead of falling back; 'never' skips the worker; no support means main thread", async () => {
    await expect(setup({ workerFails: true }).pose.load({ ...LOAD, worker: 'only' })).rejects.toThrow('no WebGL in workers');
    const never = setup();
    expect((await never.pose.load({ ...LOAD, worker: 'never' })).worker).toBe(false);
    expect(never.made.map((b) => b.worker)).toEqual([false]);
    const unsupported = setup({ supported: false });
    expect((await unsupported.pose.load(LOAD)).worker).toBe(false);
    await expect(setup({ supported: false }).pose.load({ ...LOAD, worker: 'only' })).rejects.toThrow(/cannot run the pose model in a worker/);
  });
});

describe('camera frames', () => {
  it('needs load() first', () => {
    const { pose } = setup();
    expect(() => pose.attach(videoSource(new ManualVideo()))).toThrow(/load\(\) before/);
  });

  it('one inference at a time: frames that arrive meanwhile are counted as dropped, and seq counts every frame', async () => {
    const { pose, made } = setup();
    await pose.load(LOAD);
    const b = made[0] as FakeBackend;
    b.hold = true;
    const v = new ManualVideo();
    const got: PoseFrame[] = [];
    pose.onFrame((f) => got.push(f));
    pose.attach(videoSource(v));
    v.present(1000);                 // starts inference for frame 0
    v.present(1033);                 // busy: dropped
    v.present(1066);                 // busy: dropped
    b.release();
    await wait(0);
    v.present(1100);                 // frame 3 is analysed
    b.release();
    await wait(0);
    expect(got.map((f) => f.seq)).toEqual([0, 3]);
    expect(got[0]).toMatchObject({ t: 1000, source: 'camera', inferenceMs: 7 });
    expect(got[0]?.aspect).toBeCloseTo(640 / 360);
    expect(got[0]?.landmarks?.length).toBe(33);
    expect(pose.stats.dropped).toBe(2);
    expect(pose.stats.frames).toBe(2);
    expect(b.detects).toEqual([1000, 1100]);
  });

  it('setMaxHz drops frames that come too soon', async () => {
    const { pose, made } = setup();
    await pose.load(LOAD);
    const v = new ManualVideo();
    let n = 0;
    pose.onFrame(() => { n++; });
    pose.attach(videoSource(v));
    pose.setMaxHz(10);               // at most one inference per 100 ms
    for (let i = 0; i < 30; i++) { v.present(1000 + i * 1000 / 30); await wait(0); }
    expect(n).toBe(10);
    expect(pose.stats.dropped).toBe(20);
    expect((made[0] as FakeBackend).detects.length).toBe(10);
  });

  it('detach stops the pump; dispose releases the backend once and refuses new work', async () => {
    const { pose, made } = setup();
    await pose.load(LOAD);
    const v = new ManualVideo();
    let n = 0;
    pose.onFrame(() => { n++; });
    pose.attach(videoSource(v));
    v.present(1); await wait(0);
    pose.detach();
    expect(v.pendingCallbacks).toBe(0);
    v.present(50); await wait(0);
    expect(n).toBe(1);
    pose.dispose();
    pose.dispose();
    expect((made[0] as FakeBackend).disposed).toBe(1);
    expect(() => pose.attach(videoSource(v))).toThrow(/disposed/);
    await expect(pose.load(LOAD)).rejects.toThrow(/disposed/);
  });

  it('stats report the inference time percentiles', async () => {
    const { pose, made } = setup();
    await pose.load(LOAD);
    const b = made[0] as FakeBackend;
    const v = new ManualVideo();
    pose.attach(videoSource(v));
    for (let i = 1; i <= 100; i++) { b.inferenceMs = i; v.present(i * 40); await wait(0); }
    expect(pose.stats.p50).toBe(51);
    expect(pose.stats.p95).toBe(96);
  });
});

describe('two people', () => {
  it('numPoses 2: every person found is in poses, landmarks is the first; switching back drops poses', async () => {
    const { pose, made } = setup();
    await pose.load({ ...LOAD, numPoses: 2 });
    const b = made[0] as FakeBackend;
    expect(b.numPoses).toBe(2);
    b.people = [synthPose({ ...DEFAULT_SHAPE, cx: 0.3 }), synthPose({ ...DEFAULT_SHAPE, cx: 0.7 })];
    const v = new ManualVideo();
    const got: PoseFrame[] = [];
    pose.onFrame((f) => got.push(f));
    pose.attach(videoSource(v));
    v.present(10); await wait(0);
    expect(got[0]?.poses?.length).toBe(2);
    expect(got[0]?.landmarks).toBe(got[0]?.poses?.[0]);
    await pose.setNumPoses(1);
    expect(b.numPoses).toBe(1);
    v.present(50); await wait(0);
    expect(got[1]?.poses).toBeUndefined();
    expect(got[1]?.landmarks?.[0]?.x).toBeCloseTo(got[0]!.poses![0]![0]!.x);
  });
});

describe('landmark sources', () => {
  it('trace frames pass straight through as source "trace", without a model', async () => {
    const { pose } = setup();
    const t = synthTrace({ id: 'pass-through', durationMs: 300, fps: 30, shape: { aspect: 16 / 9 } });
    const got: PoseFrame[] = [];
    pose.onFrame((f) => got.push(f));
    const src = traceSource(t, { speed: 20 });
    pose.attach(src);
    await src.start();
    await wait(80);
    expect(src.done).toBe(true);
    expect(got.length).toBe(t.frames.length);
    expect(got.map((f) => f.seq)).toEqual([...Array(t.frames.length).keys()]);
    expect(new Set(got.map((f) => f.source))).toEqual(new Set(['trace']));
    expect(got[0]?.aspect).toBeCloseTo(16 / 9);
    pose.detach();
  });
});
