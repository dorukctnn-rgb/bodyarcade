// What every flow of the cross-browser run does with a page: listen for what goes wrong, take the picture that goes in the report,
// and look at the pixels of a canvas or a scene (an engine that cannot draw gives a page that passes every layout check).
import type { Locator, Page, TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyseScene, decodePng, isBlank, type SceneReport } from '../../page-check/scene.ts';
import { OUT, ROOT } from './sites.ts';

/** Console messages of the engines and of the pose runtime that are not the page's doing (the page-check tool allows the same ones). */
const NOISE: RegExp[] = [
  /GPU stall due to ReadPixels/, /Autofocus processing was blocked/, /OpenGL error checking is disabled/, /inference_feedback_manager/, /XNNPACK/,
  /Created TensorFlow Lite/, /Failed to load resource/,   // a failed request is reported with its address by the response listener below
  /WEBGL_debug_renderer_info/, /GL_INVALID_FRAMEBUFFER_OPERATION/,
  // a machine with no WebGL (headless Firefox on a Linux runner): three.js says so on the console and the app steps down to its pictures or says it in words
  /A WebGL context could not be created/, /Error creating WebGL context/, /WebGL creation failed/,
];

export interface Watch {
  /** Everything the page did wrong since the watch began: uncaught errors, console errors, failed or 4xx/5xx requests of the page's own address. */
  errors: string[];
  /** Console errors left out as the engine's own noise (kept so a report can show them). */
  noise: string[];
  /** The page's console warnings. */
  warnings: string[];
}

export function watch(page: Page, allow: RegExp[] = []): Watch {
  const w: Watch = { errors: [], noise: [], warnings: [] };
  const skip = (s: string): boolean => allow.some((r) => r.test(s));
  const origin = (): string => { try { return new URL(page.url()).origin; } catch { return ''; } };
  page.on('pageerror', (e) => { const m = `pageerror: ${e.message.split('\n')[0]}`; if (!skip(m)) w.errors.push(m); });
  page.on('console', (m) => {
    const text = m.text().split('\n')[0] ?? '';
    if (m.type() === 'error') { if (NOISE.some((r) => r.test(text)) || skip(text)) w.noise.push(text); else w.errors.push(`console: ${text}`); }
    else if (m.type() === 'warning') w.warnings.push(text);
  });
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() >= 400 && url.startsWith(origin())) { const m = `HTTP ${r.status()}: ${url.slice(origin().length)}`; if (!skip(m)) w.errors.push(m); }
  });
  page.on('requestfailed', (r) => {
    const url = r.url();
    const why = r.failure()?.errorText ?? '';
    if (url.startsWith(origin()) && !/abort|cancel/i.test(why)) { const m = `request failed: ${url.slice(origin().length)} (${why})`; if (!skip(m)) w.errors.push(m); }
  });
  return w;
}

/** Lazy pictures below the first screen load when the page is scrolled past them; a full-page picture taken before that shows grey boxes. */
export async function loadPictures(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(300, Math.round(innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map((i) => (i.complete && i.naturalWidth > 0 ? null : new Promise<void>((r) => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); setTimeout(r, 4000); }))));
  });
}

/**
 * Saves a picture of the page for the report (qa-out/browsers/shots/<project>/<name>.jpg) and notes it on the test. Returns the path relative to the
 * repository. A full-page picture is taken with the pictures loaded and with the fixed bars (the tab bar, the action bar) laid in the page, as the
 * shell's own screenshot tool does: a fixed bar in a full-page capture sits over the middle of the page and hides what is under it.
 */
export async function shot(page: Page, info: TestInfo, name: string, o: { full?: boolean; locator?: Locator } = {}): Promise<string | null> {
  const dir = join(OUT, 'shots', info.project.name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name.replace(/[^a-z0-9._-]+/gi, '-')}.jpg`);
  const full = !o.locator && o.full !== false;
  let bars: import('@playwright/test').ElementHandle | null = null;
  try {
    if (full) {
      await loadPictures(page).catch(() => undefined);
      bars = await page.addStyleTag({ content: '.k-actionbar, .ba-tabbar { position: static !important; }' }).catch(() => null);
    }
    if (o.locator) await o.locator.screenshot({ path: file, type: 'jpeg', quality: 72, scale: 'css', timeout: 15_000 });
    else await page.screenshot({ path: file, type: 'jpeg', quality: 72, scale: 'css', fullPage: full, timeout: 20_000 });
  } catch {
    try { await page.screenshot({ path: file, type: 'jpeg', quality: 72, scale: 'css', timeout: 20_000 }); } catch { return null; }
  } finally {
    await bars?.evaluate((el) => (el as Element).remove()).catch(() => undefined);
  }
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  info.annotations.push({ type: 'shot', description: rel });
  return rel;
}

/** Fonts loaded, finite animations finished (or 2.5 s), a beat for the layout to settle. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2500))]);
  });
  await page.waitForTimeout(150);
}

/** What a canvas (or any element) shows, from a screenshot of its rectangle: how many colours, and how flat. A canvas nobody drew on is one colour. */
export async function look(el: Locator): Promise<SceneReport & { blank: boolean }> {
  const box = await el.boundingBox({ timeout: 15_000 });
  if (!box) throw new Error('the element has no box to look at');
  const page = el.page();
  const png = await page.screenshot({ type: 'png', scale: 'css', timeout: 30_000, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.max(1, box.width), height: Math.max(1, box.height) } });
  const img = decodePng(png);
  const rep = analyseScene(img, { x: 0, y: 0, w: img.width, h: img.height }, []);
  return { ...rep, blank: isBlank(rep) };
}

/**
 * Can this engine play a stream made from a canvas in a video element (a picture arrives within 4 s)? The page-side camera is exactly that.
 * Playwright's WebKit for Linux has the API and no pictures: the camera flows are the tool's to skip there, not the app's to fail.
 */
export async function canvasStreamPlays(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    try {
      if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      let n = 0;
      const timer = window.setInterval(() => { g.fillStyle = `hsl(${(n++ * 20) % 360} 80% 50%)`; g.fillRect(0, 0, 64, 48); }, 50);
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = c.captureStream(15);
      const ok = await new Promise<boolean>((res) => { v.addEventListener('loadeddata', () => res(true), { once: true }); window.setTimeout(() => res(false), 4000); void v.play().catch(() => undefined); });
      window.clearInterval(timer);
      v.srcObject = null;
      return ok;
    } catch { return false; }
  });
}

/** True on a phone-sized viewport (the layouts and the capabilities differ there). */
export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 700;
