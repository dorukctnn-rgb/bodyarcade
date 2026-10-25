// What each engine of the matrix can do on THIS machine, from feature detection in an empty page: camera, WebRTC, Web Audio, WebGL,
// OffscreenCanvas, WebAssembly SIMD, module workers, service workers. Playwright's WebKit for Windows is a different build from
// Safari (no MediaStream, no WebRTC, no Web Audio, no OffscreenCanvas): the report says which flows an engine here can judge at all, and
// which belong to the runners that have the real thing (macOS: Safari's WebKit; Linux: WebKitGTK/WPE).
//   node tools/browsers/probe.ts [webkit] [firefox] [chromium] [--json file]
import { chromium, firefox, webkit, type Browser } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';

export interface EngineFacts {
  engine: string;
  ua: string;
  [k: string]: unknown;
}

/** Runs in the page: every fact is a plain value. */
async function facts(): Promise<Record<string, unknown>> {
  const r: Record<string, unknown> = {};
  const w = window as unknown as Record<string, unknown>;
  const has = (k: string): string => typeof w[k];
  r['secureContext'] = window.isSecureContext;
  r['crossOriginIsolated'] = window.crossOriginIsolated;
  r['mediaDevices'] = typeof navigator.mediaDevices;
  r['getUserMedia'] = typeof navigator.mediaDevices?.getUserMedia;
  r['MediaStream'] = has('MediaStream');
  r['RTCPeerConnection'] = has('RTCPeerConnection');
  r['canvasCaptureStream'] = 'captureStream' in HTMLCanvasElement.prototype;
  r['videoCaptureStream'] = 'captureStream' in HTMLVideoElement.prototype || 'mozCaptureStream' in HTMLVideoElement.prototype;
  r['requestVideoFrameCallback'] = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  r['AudioContext'] = has('AudioContext') !== 'undefined' ? 'AudioContext' : has('webkitAudioContext') !== 'undefined' ? 'webkitAudioContext' : 'none';
  r['OfflineAudioContext'] = has('OfflineAudioContext');
  r['AudioWorklet'] = typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype;
  r['OffscreenCanvas'] = has('OffscreenCanvas');
  r['createImageBitmap'] = typeof createImageBitmap;
  r['ImageBitmapRenderer'] = typeof ImageBitmapRenderingContext;
  r['VideoFrame'] = has('VideoFrame');
  r['WebSocket'] = has('WebSocket');
  r['indexedDB'] = has('indexedDB');
  r['subtle'] = typeof crypto?.subtle;
  r['serviceWorker'] = 'serviceWorker' in navigator;
  r['wakeLock'] = 'wakeLock' in navigator;
  r['fullscreen'] = !!(document.documentElement.requestFullscreen || (document.documentElement as unknown as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen);
  r['vibrate'] = 'vibrate' in navigator;
  r['share'] = 'share' in navigator;
  r['clipboardWrite'] = typeof navigator.clipboard?.writeText;
  r['speechSynthesis'] = 'speechSynthesis' in window;
  r['ResizeObserver'] = has('ResizeObserver');
  r['structuredClone'] = has('structuredClone');
  r['SharedArrayBuffer'] = has('SharedArrayBuffer');
  r['dialogShowModal'] = typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal;
  r['cssHas'] = CSS.supports('selector(:has(*))');
  r['cssDvh'] = CSS.supports('height', '100dvh');
  r['cssContainer'] = CSS.supports('container-type', 'inline-size');
  r['cssColorMix'] = CSS.supports('color', 'color-mix(in srgb, red, blue)');
  r['cssBackdropFilter'] = CSS.supports('backdrop-filter', 'blur(2px)') || CSS.supports('-webkit-backdrop-filter', 'blur(2px)');
  r['cssTextWrapBalance'] = CSS.supports('text-wrap', 'balance');
  r['hardwareConcurrency'] = navigator.hardwareConcurrency;
  r['deviceMemory'] = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;
  const gl = (kind: string): unknown => {
    try {
      const c = document.createElement('canvas');
      const g = c.getContext(kind) as WebGLRenderingContext | null;
      if (!g) return false;
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return { renderer: dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 80) : String(g.getParameter(g.RENDERER)).slice(0, 80), maxTexture: g.getParameter(g.MAX_TEXTURE_SIZE) };
    } catch (e) { return `error ${e}`; }
  };
  r['webgl1'] = gl('webgl');
  r['webgl2'] = gl('webgl2');
  try { r['offscreenWebgl2'] = typeof OffscreenCanvas !== 'undefined' ? !!new OffscreenCanvas(8, 8).getContext('webgl2') : false; } catch (e) { r['offscreenWebgl2'] = `error ${e}`; }
  try {
    // the smallest module with a SIMD instruction
    r['wasmSimd'] = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (e) { r['wasmSimd'] = `error ${e}`; }
  try {
    const worker = new Worker(URL.createObjectURL(new Blob(['postMessage("ok")'], { type: 'text/javascript' })), { type: 'module' });
    r['moduleWorker'] = await new Promise((res) => { worker.onmessage = () => res('ok'); worker.onerror = (e) => res(`error ${e.message ?? ''}`); setTimeout(() => res('timeout'), 4000); });
    worker.terminate();
  } catch (e) { r['moduleWorker'] = `throws ${e}`; }
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      const t = s.getVideoTracks()[0] as MediaStreamTrack;
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = s;
      await v.play().catch(() => undefined);
      await new Promise((res) => setTimeout(res, 700));
      r['engineCamera'] = { label: t.label, settings: t.getSettings(), videoSize: [v.videoWidth, v.videoHeight] };
      s.getTracks().forEach((x) => x.stop());
    } else r['engineCamera'] = 'no getUserMedia';
  } catch (e) { r['engineCamera'] = `error ${(e as Error).name}: ${(e as Error).message}`; }
  return r;
}

export async function probe(engines: string[]): Promise<EngineFacts[]> {
  const page = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><meta charset=utf-8><title>probe</title><body>probe'); });
  await new Promise<void>((ok) => page.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(page.address() as AddressInfo).port}/`;
  const out: EngineFacts[] = [];
  for (const engine of engines) {
    let browser: Browser | null = null;
    try {
      browser = engine === 'chromium' ? await chromium.launch(baseLaunchOptions)
        : engine === 'firefox' ? await firefox.launch({ headless: true, firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } })
          : await webkit.launch({ headless: true });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      await p.goto(base);
      const ua = await p.evaluate(() => navigator.userAgent);
      out.push({ engine, version: browser.version(), ua, ...(await p.evaluate(facts)) });
    } catch (e) {
      out.push({ engine, ua: '', error: String(e).split('\n')[0] ?? '' });
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
  await new Promise<void>((ok) => page.close(() => ok()));
  return out;
}

if (process.argv[1] && /probe\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
  const engines = args.filter((a, i) => !a.startsWith('--') && i !== jsonAt + 1);
  const list = await probe(engines.length ? engines : ['webkit', 'firefox', 'chromium']);
  for (const f of list) console.log(`=== ${f.engine} ${String(f['version'] ?? '')}\n${JSON.stringify(f, null, 1)}`);
  if (jsonFile) writeFileSync(jsonFile, JSON.stringify(list, null, 1));
}
