// The trace recorder dev page records a real person from the (fake) camera, takes labels by key, and downloads a
// valid trace file. Uses the public-domain standing clip as the camera.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseTrace } from '../../packages/core/pose/trace.ts';
import { withFakeVideo } from './support/browser.ts';
import { DEV_URL } from './support/ports.ts';

test.use({ launchOptions: withFakeVideo('tests/e2e/fixtures/standing-640x360.mjpeg') });

test('record from the camera, label, download a valid trace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${DEV_URL}/tools/trace-recorder/index.html`);
  await page.fill('#t-id', 'e2e-standing');
  await page.click('#b-camera');
  await expect(page.locator('#b-rec')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#stats')).toContainText('Hz', { timeout: 15_000 });
  await page.click('#b-rec');
  await page.waitForTimeout(1200);
  await page.keyboard.press('j');
  await page.waitForTimeout(1200);
  await page.click('#b-stop');
  await expect(page.locator('#status')).toContainText('Recorded');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#b-save')]);
  expect(download.suggestedFilename()).toBe('e2e-standing.trace.json');
  const trace = parseTrace(JSON.parse(readFileSync(await download.path(), 'utf8')));
  expect(trace.meta).toMatchObject({ id: 'e2e-standing', origin: 'recorded', framing: 'full', consent: 'own' });
  expect(trace.frames.length).toBeGreaterThan(10);
  expect(trace.frames.filter((f) => f.lm !== null).length / trace.frames.length).toBeGreaterThan(0.9);
  expect(trace.labels).toHaveLength(1);
  expect(trace.labels[0]).toMatchObject({ id: 'jump', kind: 'rep' });
  expect(trace.labels[0]!.t).toBeGreaterThan(900);
  expect(trace.aspect).toBeCloseTo(16 / 9, 2);
  expect(errors).toEqual([]);
});
