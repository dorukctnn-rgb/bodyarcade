// CameraService with a fake getUserMedia: the camera bugs B8, B9 and B10 (code-audit 10.3) and rule 3 of 11.4.
import { describe, expect, it } from 'vitest';
import { CameraError, createCameraService, isAbortError } from './camera.ts';
import { FakeVideo, fakeMediaDevices, type FakeTrack } from './fake-media.ts';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup(o: Parameters<typeof fakeMediaDevices>[0] = {}, firstFrameMs: number | null = 5) {
  const fake = fakeMediaDevices(o);
  const videos: FakeVideo[] = [];
  const cam = createCameraService({
    mediaDevices: fake.mediaDevices,
    createVideo: () => { const v = new FakeVideo(firstFrameMs); videos.push(v); return v as unknown as HTMLVideoElement; },
    startTimeoutMs: 100,
  });
  return { cam, fake, videos };
}

describe('B9: leaving while the permission prompt is open', () => {
  it('rejects at once with AbortError and stops the stream that arrives later', async () => {
    const { cam, fake } = setup({ delayMs: 60 });
    const ac = new AbortController();
    const p = cam.acquire({ signal: ac.signal });
    await wait(10);
    ac.abort();
    const t0 = performance.now();
    const err = await p.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(30);       // did not wait for the prompt
    await wait(80);                                        // the browser grants permission after the player left
    expect(fake.streams.length).toBe(1);
    expect(fake.liveTracks()).toBe(0);
    expect(cam.stats()).toEqual({ acquired: 0, released: 0, live: 0 });
  });

  it('an already aborted signal never asks for the camera', async () => {
    const { cam, fake } = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(cam.acquire({ signal: ac.signal })).rejects.toSatisfy(isAbortError);
    expect(fake.calls.length).toBe(0);
  });

  it('aborting after the lease was handed over does not touch it (the lease has an owner now)', async () => {
    const { cam, fake } = setup();
    const ac = new AbortController();
    const lease = await cam.acquire({ signal: ac.signal });
    ac.abort();
    expect(lease.alive).toBe(true);
    expect(fake.liveTracks()).toBe(1);
    lease.release();
  });
});

describe('B8: the camera dies mid-run', () => {
  it('marks the lease dead and tells every listener once', async () => {
    const { cam, fake } = setup();
    const lease = await cam.acquire();
    let a = 0, b = 0;
    lease.onEnded(() => { a++; });
    const offB = lease.onEnded(() => { b++; });
    offB();
    (fake.streams[0]!.tracks[0] as FakeTrack).unplug();
    expect(lease.alive).toBe(false);
    expect(a).toBe(1);
    expect(b).toBe(0);
    (fake.streams[0]!.tracks[0] as FakeTrack).unplug();
    expect(a).toBe(1);
  });

  it('recalibrate acquires a fresh live lease instead of reusing the dead stream', async () => {
    const { cam, fake } = setup();
    const first = await cam.acquire();
    (fake.streams[0]!.tracks[0] as FakeTrack).unplug();
    first.release();
    const second = await cam.acquire();
    expect(second).not.toBe(first);
    expect(second.stream).not.toBe(first.stream);
    expect(second.alive).toBe(true);
    expect(fake.calls.length).toBe(2);
    second.release();
    expect(cam.stats()).toEqual({ acquired: 2, released: 2, live: 0 });
  });

  it('a listener added after the end still hears about it', async () => {
    const { cam, fake } = setup();
    const lease = await cam.acquire();
    (fake.streams[0]!.tracks[0] as FakeTrack).unplug();
    let heard = false;
    lease.onEnded(() => { heard = true; });
    await wait(0);
    expect(heard).toBe(true);
  });

  it('a stream whose track already ended is never alive', async () => {
    const fake = fakeMediaDevices();
    const gum = fake.mediaDevices.getUserMedia.bind(fake.mediaDevices);
    fake.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); (s as unknown as { tracks: FakeTrack[] }).tracks[0]!.unplug(); return s; };
    const cam = createCameraService({ mediaDevices: fake.mediaDevices, createVideo: () => new FakeVideo() as unknown as HTMLVideoElement });
    const lease = await cam.acquire();
    let heard = 0;
    lease.onEnded(() => { heard++; });
    await wait(0);
    expect(lease.alive).toBe(false);
    expect(heard).toBe(1);
    lease.release();
  });
});

describe('B10: the results screen', () => {
  it('release() stops every track, detaches the video, and is idempotent', async () => {
    const { cam, fake, videos } = setup({ tracks: 2 });
    const lease = await cam.acquire();
    await lease.start();
    expect(videos[0]!.srcObject).toBe(lease.stream);
    let ended = 0;
    lease.onEnded(() => { ended++; });
    lease.release();
    lease.release();
    expect(fake.liveTracks()).toBe(0);
    expect(fake.streams[0]!.tracks.every((t) => t.stops === 1)).toBe(true);
    expect(videos[0]!.srcObject).toBeNull();
    expect(videos[0]!.paused).toBe(true);
    expect(lease.alive).toBe(false);
    expect(ended).toBe(0);                                 // releasing on purpose is not a camera failure
    expect(cam.stats()).toEqual({ acquired: 1, released: 1, live: 0 });
    await expect(lease.start()).rejects.toSatisfy(isAbortError);
  });

  it('rule 3: five runs, each released, leave no live track', async () => {
    const { cam, fake } = setup();
    for (let i = 0; i < 5; i++) {
      const lease = await cam.acquire();
      await lease.start();
      lease.release();
    }
    const ac = new AbortController();
    const late = cam.acquire({ signal: ac.signal });
    ac.abort();
    await late.catch(() => {});
    await wait(5);
    expect(fake.streams.length).toBe(6);
    expect(fake.liveTracks()).toBe(0);
    expect(cam.stats()).toEqual({ acquired: 5, released: 5, live: 0 });
  });
});

describe('start()', () => {
  it('resolves on the first frame', async () => {
    const { cam } = setup({}, 5);
    const lease = await cam.acquire();
    await expect(lease.start()).resolves.toBeUndefined();
    lease.release();
  });

  it('a camera that sends no picture fails with no_frames instead of waiting for ever', async () => {
    const { cam } = setup({}, null);
    const lease = await cam.acquire();
    await expect(lease.start()).rejects.toMatchObject({ name: 'CameraError', code: 'no_frames' });
    lease.release();
  });

  it('release during start rejects the start with AbortError', async () => {
    const { cam } = setup({}, 50);
    const lease = await cam.acquire();
    const p = lease.start();
    lease.release();
    await expect(p).rejects.toSatisfy(isAbortError);
  });
});

describe('errors the UI can explain', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'not_found'],
    ['NotReadableError', 'in_use'],
    ['AbortError', 'in_use'],
    ['OverconstrainedError', 'overconstrained'],
    ['TypeError', 'unknown'],
  ])('%s becomes %s', async (name, code) => {
    const { cam } = setup({ failWith: name });
    const err = await cam.acquire().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CameraError);
    expect((err as CameraError).code).toBe(code);
  });

  it('no getUserMedia: unsupported, or insecure on http', async () => {
    const a = createCameraService({ mediaDevices: undefined, isSecureContext: true });
    await expect(a.acquire()).rejects.toMatchObject({ code: 'unsupported' });
    const b = createCameraService({ mediaDevices: undefined, isSecureContext: false });
    await expect(b.acquire()).rejects.toMatchObject({ code: 'insecure' });
  });

  it('asks for the front camera at 640x480, at most 30 fps, no audio; deviceId wins over facingMode', async () => {
    const { cam, fake } = setup();
    (await cam.acquire()).release();
    (await cam.acquire({ deviceId: 'abc', width: 1280, height: 720 })).release();
    expect(fake.calls[0]).toEqual({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, facingMode: { ideal: 'user' } } });
    expect(fake.calls[1]).toEqual({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, deviceId: { exact: 'abc' } } });
  });

  it('reports the camera settings', async () => {
    const { cam } = setup();
    const lease = await cam.acquire();
    expect(lease.info).toEqual({ width: 640, height: 480, frameRate: 30, facingMode: 'user', deviceId: 'fake-1', label: 'Fake camera 1' });
    expect(lease.kind).toBe('video');
    lease.release();
  });
});
