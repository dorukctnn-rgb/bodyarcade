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

/** Saves a picture of the page for the report (qa-out/browsers/shots/<project>/<name>.jpg) and notes it on the test. Returns the path relative to the repository. */
export async function shot(page: Page, info: TestInfo, name: string, o: { full?: boolean; locator?: Locator } = {}): Promise<string | null> {
  const dir = join(OUT, 'shots', info.project.name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name.replace(/[^a-z0-9._-]+/gi, '-')}.jpg`);
  try {
    if (o.locator) await o.locator.screenshot({ path: file, type: 'jpeg', quality: 72, scale: 'css', timeout: 15_000 });
    else await page.screenshot({ path: file, type: 'jpeg', quality: 72, scale: 'css', fullPage: o.full !== false, timeout: 20_000 });
  } catch {
    try { await page.screenshot({ path: file, type: 'jpeg', quality: 72, scale: 'css', timeout: 20_000 }); } catch { return null; }
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

/** What a canvas (or any element) shows, from a screenshot of it: how many colours, and how flat. A canvas nobody drew on is one colour. */
export async function look(el: Locator): Promise<SceneReport & { blank: boolean }> {
  const png = await el.screenshot({ type: 'png', scale: 'css', timeout: 15_000 });
  const img = decodePng(png);
  const rep = analyseScene(img, { x: 0, y: 0, w: img.width, h: img.height }, []);
  return { ...rep, blank: isBlank(rep) };
}

/** True on a phone-sized viewport (the layouts and the capabilities differ there). */
export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 700;
