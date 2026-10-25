// The report-only Content-Security-Policy against the real code: every kind of page, then a camera round (pose
// worker, WASM, model) with a fake camera. A violation would show as a console message, a DOM event or a report sent
// to /api/csp-report; all three are collected and must stay empty. Evidence: tests/release/out/csp.json.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { withFakeVideo } from '../e2e/support/browser.ts';
import { BASE, OUT, ROOT } from './support.ts';

test('no page and no camera round breaks the policy', async () => {
  test.setTimeout(240_000);
  const browser = await chromium.launch(withFakeVideo(join(ROOT, 'tests/e2e/fixtures/standing-640x360.mjpeg')));
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const console: string[] = [];
  const reports: string[] = [];
  const pose: { url: string; status: number }[] = [];
  context.on('request', (r) => { if (r.url().includes('/api/csp-report')) reports.push(r.postData() ?? '(no body)'); });
  context.on('response', (r) => { if (r.url().includes('/vendor/mediapipe/')) pose.push({ url: new URL(r.url()).pathname, status: r.status() }); });
  await context.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
  });
  await context.route(/plausible\.io/, (r) => r.abort());
  const page = await context.newPage();
  page.on('console', (m) => { if (/Content.Security.Policy|\[Report Only\]/i.test(m.text())) console.push(m.text().slice(0, 300)); });
  page.on('worker', (w) => w.on('console', (m) => { if (/Content.Security.Policy|\[Report Only\]/i.test(m.text())) console.push(`worker: ${m.text().slice(0, 300)}`); }));
  const dom: string[] = [];
  const visited: string[] = [];
  for (const path of ['/', '/tr/', '/games/road-run/', '/games/star-catch/', '/pro/', '/settings/', '/welcome/', '/privacy', '/webcam-fitness-games', '/blog/', '/no-such-page']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(path === '/welcome/' ? 3000 : 800);
    dom.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).map((d) => `${path}: ${d}`));
    visited.push(path);
  }
  // A camera round: the explainer, the camera, the pose model in its worker, calibration.
  await page.goto(`${BASE}/play/road-run/`, { waitUntil: 'load' });
  const cont = page.locator('[data-action="camera-continue"]');
  // the explainer is drawn by the app after the page loaded: wait for it (isVisible() answers at once and never waits)
  if (await cont.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) await cont.click();
  await expect.poll(() => pose.filter((p) => p.url.endsWith('.task') || p.url.endsWith('.wasm')).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(8000);
  dom.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).map((d) => `/play/road-run/: ${d}`));
  visited.push('/play/road-run/ (camera round)');

  // Positive control, in a page of its own after the real checks: an inline script added on purpose must be seen by
  // the detectors (so "nothing seen" above means nothing happened, not that nothing was watched).
  const control = await context.newPage();
  const controlConsole: string[] = [];
  control.on('console', (m) => { if (/Content.Security.Policy|\[Report Only\]/i.test(m.text())) controlConsole.push(m.text().slice(0, 160)); });
  const before = reports.length;
  await control.goto(`${BASE}/`, { waitUntil: 'load' });
  await control.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__cspControl = 1'; document.head.append(s); });
  await control.waitForTimeout(3000);
  const controlDom = await control.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  const controlSeen = { console: controlConsole.length, dom: controlDom.length, reports: reports.length - before };
  writeFileSync(join(OUT, 'csp.json'), JSON.stringify({ visited, console, dom, reports: reports.slice(0, before), pose, controlSeen }, null, 1));
  await browser.close();
  expect(pose.every((p) => p.status === 200), JSON.stringify(pose)).toBe(true);
  expect({ console, dom, reports: reports.slice(0, before) }).toEqual({ console: [], dom: [], reports: [] });
  expect(controlSeen.console + controlSeen.dom, JSON.stringify(controlSeen)).toBeGreaterThan(0);
});
