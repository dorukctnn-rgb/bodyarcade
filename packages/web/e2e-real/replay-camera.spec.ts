// The one second replay on the real thing: the shell's real session, the real Squat Flap, the real pose model, and the browser's fake camera
// playing a recording of a person (tests/e2e/fixtures/standing-640x360.mjpeg: squat jumps, public domain). The round is the thirty seconds
// of the welcome tour's first game. Whatever the game judged a miss with a reason on the way, the results show the skeleton of it, drawn
// from the pose frames of the model, and leaving the screen lets the window go. Needs real CPU time (the model runs on software rendering),
// so it runs on the local release gate, not on the CI runners.
//   npx playwright test -c packages/web/playwright.real.config.ts packages/web/e2e-real/replay-camera.spec.ts
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { withFakeVideo } from '../../../tests/e2e/support/browser.ts';
import { collectErrors } from '../e2e/support/helpers.ts';
import { WEB_REAL_URL } from '../e2e/support/ports.ts';

test.skip(!!process.env['CI'], 'the real pose model on software rendering needs real CPU time; it runs on the local release gate, not on the CI runners');
test.use({ launchOptions: withFakeVideo('tests/e2e/fixtures/standing-640x360.mjpeg'), permissions: ['camera'] });

test('a thirty second round on the fake camera ends with the replay of a miss, drawn from the pose model\'s landmarks', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && r.method() !== 'HEAD' && !/localhost|127\.0\.0\.1/.test(new URL(r.url()).hostname)) sent.push(`${r.method()} ${r.url()}`); });
  await page.goto(`${WEB_REAL_URL}/play/squat-flap/?first=1&input=camera`);
  // the round: the model loads, the calibration finds the person, three, two, one, thirty seconds
  await page.waitForURL(/results/, { timeout: 240_000 });
  await expect(page.locator('main h1')).toBeVisible();
  const reasons = await page.locator('.k-misses li b').allTextContents();
  info.annotations.push({ type: 'reasons', description: JSON.stringify(reasons) });
  const debug = await page.evaluate(() => { const d = window.__BA__?.debug(); return { reasons: d?.result?.reasons.map((r) => `${r.text} x${r.count}`) ?? [], replay: d?.result?.replay ?? null, held: d?.replay }; });
  info.annotations.push({ type: 'debug', description: JSON.stringify(debug) });

  // the game missed something with a reason, and the replay is of the reason at the top of the list
  const card = page.locator('.k-replay');
  await expect(card, `the round had misses (${reasons.join(', ') || 'none'}) and a person in view`).toBeVisible();
  await expect(card.locator('[data-replay-reason]')).toHaveText(reasons[0] ?? '');
  await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
  const frames = Number(await page.locator('[data-replay]').getAttribute('data-frames'));
  expect(frames, 'frames the pose model gave in the window').toBeGreaterThanOrEqual(6);

  // the canvas has the skeleton: white bones and coral joints
  const ink = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-replay] canvas');
    const g = c?.getContext('2d');
    if (!c || !g) return { bone: 0, joint: 0 };
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let bone = 0, joint = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] as number, gr = d[i + 1] as number, b = d[i + 2] as number;
      if (Math.abs(r - 244) < 30 && Math.abs(gr - 242) < 30 && Math.abs(b - 248) < 30) bone++;
      else if (Math.abs(r - 255) < 50 && Math.abs(gr - 79) < 50 && Math.abs(b - 110) < 50) joint++;
    }
    return { bone, joint };
  });
  expect(ink.bone, 'white bones').toBeGreaterThan(200);
  expect(ink.joint, 'coral joints').toBeGreaterThan(30);

  const shots = process.env['BA_REPLAY_SHOTS'];
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${shots}/real-camera-replay.png` });
  }

  // again, with the button
  await card.getByRole('button', { name: 'Replay' }).click();
  await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'done', { timeout: 5_000 });

  // nothing of the camera was sent anywhere, and leaving the screen lets the window go
  expect(sent, 'requests to other sites').toEqual([]);
  await page.getByRole('link', { name: /Choose another game|See all games|All \d+ games|games/i }).first().click();
  await expect(page.locator('[data-replay]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__BA__?.debug().replay)).toEqual({ recording: false, kept: 0, clipFrames: 0, player: 'none' });
  expect(errors).toEqual([]);
});
