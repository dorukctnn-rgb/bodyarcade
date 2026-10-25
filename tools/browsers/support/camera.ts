// A person in front of the camera, on any engine. Chromium has a fake camera that plays a file (--use-file-for-fake-video-capture);
// Firefox and WebKit have only a test pattern and no way to hand them a file. So the page itself is given a camera: navigator.mediaDevices
// is replaced by an object whose getUserMedia returns a stream drawn, picture by picture, from an MJPEG fixture on a canvas
// (canvas.captureStream, which every engine has but Playwright's WebKit for Windows), and the app's camera code, the pose service and the
// games run on it exactly as on a real camera. The same page-side camera runs in Chromium too, so every engine sees the same pictures.
//
//   await installPersonCamera(context, { file: 'tests/e2e/fixtures/standing-640x360.mjpeg' });         // a laptop: the picture as it is
//   await installPersonCamera(context, { file: ..., portrait: true });                                  // a phone held upright: the middle of the picture, 9:16
//
// What it does not test: the engine's own permission prompt and device picker (the engine's fake device does that: see
// `engineCamera` below) and constraints the engine really applies (a real phone camera gives its own size and frame rate).
// An engine that cannot make a camera from a canvas gets nothing here: the page sees the engine's own (missing) camera API.
import type { BrowserContext, LaunchOptions, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PersonCameraOptions {
  /** An MJPEG file (JPEG pictures one after the other, as ffmpeg writes with `-f mjpeg`); played in a loop. */
  file: string;
  /** Pictures per second the file was made for (tests/e2e/fixtures: 15). */
  fps?: number;
  /** A phone held upright gives a 9:16 picture: the middle of the file's pictures is cut out and scaled up. */
  portrait?: boolean;
}

/** The address the fixture is served at, inside the page's own origin (a route answers it; nothing else is asked for). */
export const CAMERA_PATH = '/__fake-camera.mjpeg';

interface ShimConfig { url: string; fps: number; portrait: boolean }

/** What the page-side camera tells about itself (window.__fakeCamera). */
export interface CameraInfo { installed: boolean; asked: number; live: number; drawn: number; error: string | null }

/** Runs in the page before any of its scripts (addInitScript), so it must be self-contained. */
function shim(cfg: ShimConfig): void {
  const canMake = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && typeof MediaStream === 'function' && typeof createImageBitmap === 'function';
  if (!canMake) return;
  const info: CameraInfo = { installed: true, asked: 0, live: 0, drawn: 0, error: null };
  (window as unknown as { __fakeCamera: CameraInfo }).__fakeCamera = info;
  let blobs: Blob[] | null = null;
  const load = async (): Promise<Blob[]> => {
    if (blobs) return blobs;
    const bytes = new Uint8Array(await (await fetch(cfg.url, { cache: 'no-store' })).arrayBuffer());
    const out: Blob[] = [];
    let start = -1;
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        if (start >= 0) out.push(new Blob([bytes.subarray(start, i)], { type: 'image/jpeg' }));
        start = i;
      }
    }
    if (start >= 0) out.push(new Blob([bytes.subarray(start)], { type: 'image/jpeg' }));
    blobs = out;
    return out;
  };
  async function getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream> {
    info.asked += 1;
    try {
      if (constraints && !constraints.video) throw new DOMException('Only the camera is faked', 'NotFoundError');
      const frames = await load();
      const first = await createImageBitmap(frames[0] as Blob);
      // The picture the camera gives: the file's size, or its middle cut to 9:16 for a phone held upright.
      const W = cfg.portrait ? 360 : first.width;
      const H = cfg.portrait ? 640 : first.height;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const draw = (bmp: ImageBitmap): void => {
        if (cfg.portrait) {
          const sw = Math.round((bmp.height * 9) / 16);
          ctx.drawImage(bmp, Math.round((bmp.width - sw) / 2), 0, sw, bmp.height, 0, 0, W, H);
        } else ctx.drawImage(bmp, 0, 0, W, H);
        info.drawn += 1;
      };
      draw(first);
      const stream = canvas.captureStream(cfg.fps);
      const track = stream.getVideoTracks()[0] as MediaStreamTrack;
      const settings = { width: W, height: H, frameRate: cfg.fps, facingMode: 'user', deviceId: 'fake-person-camera' };
      try { Object.defineProperty(track, 'getSettings', { value: () => ({ ...settings }) }); } catch { /* the engine's own settings stand */ }
      try { Object.defineProperty(track, 'label', { value: 'Fake person camera' }); } catch { /* the engine's own label stands */ }
      const t0 = performance.now();
      let busy = false;
      const timer = window.setInterval(() => {
        if (busy || track.readyState === 'ended') return;
        busy = true;
        const i = Math.floor(((performance.now() - t0) / 1000) * cfg.fps) % frames.length;
        createImageBitmap(frames[i] as Blob).then((bmp) => { draw(bmp); bmp.close?.(); }).catch((e) => { info.error = `frame: ${String(e)}`; }).finally(() => { busy = false; });
      }, Math.round(1000 / cfg.fps));
      info.live += 1;
      const stop = track.stop.bind(track);
      track.stop = (): void => { if (track.readyState !== 'ended') info.live -= 1; window.clearInterval(timer); stop(); };
      return stream;
    } catch (e) {
      info.error = `${(e as Error)?.name}: ${(e as Error)?.message}`;
      throw e;
    }
  }
  // The camera of the page: an object of its own, in place of the engine's (which may not exist yet, may be replaced later, and in
  // Safari only ever says "not allowed" in a headless run).
  const fake = new EventTarget() as EventTarget & Record<string, unknown>;
  fake['getUserMedia'] = getUserMedia;
  fake['enumerateDevices'] = async (): Promise<MediaDeviceInfo[]> => [{ deviceId: 'fake-person-camera', groupId: 'fake', kind: 'videoinput', label: 'Fake person camera', toJSON() { return this; } } as MediaDeviceInfo];
  fake['getSupportedConstraints'] = (): MediaTrackSupportedConstraints => ({ width: true, height: true, frameRate: true, facingMode: true, deviceId: true });
  fake['ondevicechange'] = null;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => fake });
}

/** Gives every page of the context a camera that shows the person of the file. Call before the first page is opened. */
export async function installPersonCamera(context: BrowserContext, o: PersonCameraOptions): Promise<void> {
  const body = readFileSync(resolve(o.file));
  await context.route((u) => u.pathname === CAMERA_PATH, (route) => route.fulfill({ status: 200, body, contentType: 'video/x-motion-jpeg', headers: { 'cache-control': 'no-store' } }));
  await context.addInitScript(shim, { url: CAMERA_PATH, fps: o.fps ?? 15, portrait: o.portrait === true });
}

/** What the page-side camera did: how often the page asked for it, how many are open, how many pictures were drawn, and the error it hit (null when none). installed false: the engine cannot make a camera from a canvas. */
export async function cameraState(page: Page): Promise<CameraInfo> {
  return page.evaluate(() => (window as unknown as { __fakeCamera?: CameraInfo }).__fakeCamera ?? { installed: false, asked: 0, live: 0, drawn: 0, error: null });
}

/**
 * Launch options for an engine's own fake device (no person: a test picture), to try the real getUserMedia path of that engine.
 * Chromium: its fake device flags (tests/e2e/support/browser.ts); Firefox: the media.navigator.streams.fake preference;
 * WebKit: nothing to set (Playwright's build serves mock devices once the context grants the camera).
 */
export function engineCamera(engine: 'chromium' | 'firefox' | 'webkit'): LaunchOptions {
  if (engine === 'firefox') return { headless: true, firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } };
  return { headless: true };
}
