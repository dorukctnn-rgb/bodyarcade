// Star Catch, Pad Work and Reaction Tag through the REAL pipeline in headless Chromium, one person: the session (setup,
// calibration, countdown, running, results), the camera service on Chromium's fake device playing a recorded person, the
// pose model, the hand detector, the HUD, the 2D kit and the sound kit (tests/e2e/pages/target-camera-harness.ts). Nobody
// steers: the person in the clip stands where they stand. What is proved: every part of the chain is connected, the hand
// rings the game draws land on the hands in the picture (the mirror is the right way round), no target sits under a plate,
// a miss is explained in words, pause and resume work, and the camera is off at the results.
// The pose model on software rendering takes real time: this runs on the local release gate, not on the CI runners.
// Set BA_SHOT_DIR to a folder to also write a picture of each case (for looking at). Two players: target-camera-two.spec.ts.
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { alignment, call, errorsOf, GAMES, open, shot, SKIP_ON_CI, snap, STANDING, waitState } from './support/target-camera.ts';

test.skip(!!process.env.CI, SKIP_ON_CI);
test.use({ launchOptions: withFakeVideo(STANDING) });

for (const game of GAMES) {
  test(`${game} on a laptop: setup, calibration, countdown, play, results; the rings sit on the hands; misses are explained; the camera is off at the end`, async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, 1280, 800);
    await call(page, 'begin', { game, players: 1, level: 'normal', seconds: 24 });
    let s = await waitState(page, 'running', 75_000);
    expect(s.states.slice(0, 4), 'the session walks its states in order').toEqual(['setup', 'calibrating', 'countdown', 'running']);
    expect(s.countdown, 'the countdown was shown').toContain(1);
    expect(s.video, 'the camera picture reached the page').not.toBeNull();
    expect(s.video!.w, 'a real picture').toBeGreaterThan(100);
    expect(s.cameraLive, 'the camera is on while playing').toBeGreaterThan(0);

    const a = await alignment(page, 1, 12);
    s = await snap(page);
    expect(a.samples[0], 'the detector saw at least one hand in the picture').toBeGreaterThan(3);
    expect(a.median[0]!, `the hand rings sit on the hands (error as a share of the picture's width ${JSON.stringify(a)})`).toBeLessThan(0.1);

    expect(s.game!.t, 'the game ran').toBeGreaterThan(3000);
    expect(s.game!.lanes[0]!.aspect, "the calibration took the picture's aspect").toBeGreaterThan(1.5);
    expect(s.hudProblems, 'no plate overlaps another or leaves the screen').toEqual([]);
    expect(s.geometry.violations, 'no target outside the picture or under a plate').toEqual([]);
    expect(s.geometry.checked, 'targets were checked').toBeGreaterThan(5);
    expect(s.hudText['timer'] ?? s.hudText['statusRight'] ?? '', 'the timer plate').toMatch(/\d/);
    expect(s.audio.unknown, 'sounds the kit does not know').toBe(0);
    expect(s.errors).toEqual([]);
    await shot(page, `camera-${game}-laptop`);

    s = await waitState(page, ['results', 'error'], 80_000);
    expect(s.state).toBe('results');
    expect(s.over, 'the run ended with a summary').not.toBeNull();
    expect(s.over!.seconds).toBeGreaterThan(20);
    expect(s.over!.metSeconds, 'MET x seconds').toBeGreaterThan(20);
    expect(s.over!.misses, 'a person who plays no game misses').toBeGreaterThan(1);
    expect(s.reasons.length, 'the reason strip said something while they missed').toBeGreaterThan(0);
    for (const r of s.reasons) expect(r, 'a sentence, not a key').not.toMatch(/^[a-z_.]+$/);
    expect(s.cameraLive, 'the camera is off at the results').toBe(0);
    expect(s.states.slice(-1)[0]).toBe('results');
    expect(await call(page, 'quit')).toEqual({ cameraLive: 0, canvases: 0, surfaces: 0 });
    expect(errorsOf(page), 'console and page errors').toEqual([]);
  });
}

for (const game of GAMES) {
  test(`${game} on a phone (390 x 844): the same chain, nothing under a plate, no errors`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, 390, 844);
    await call(page, 'begin', { game, players: 1, level: 'easy', seconds: 40 });
    await waitState(page, 'running', 75_000);
    await page.waitForTimeout(6000);
    const a = await alignment(page, 1, 8);
    const s = await snap(page);
    expect(a.samples[0], 'hands seen').toBeGreaterThan(2);
    expect(a.median[0]!, `the hand rings sit on the hands (${JSON.stringify(a)})`).toBeLessThan(0.1);
    expect(s.hudProblems).toEqual([]);
    expect(s.geometry.violations).toEqual([]);
    expect(s.mirror.w, 'the picture fits the phone').toBeLessThanOrEqual(390);
    expect(s.errors).toEqual([]);
    await shot(page, `camera-${game}-phone`);
    expect(await call(page, 'quit')).toEqual({ cameraLive: 0, canvases: 0, surfaces: 0 });
    expect(errorsOf(page)).toEqual([]);
  });
}

test('pad-work: pause and resume stop and restart the game, and the camera stays on', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 1280, 800);
  await call(page, 'begin', { game: 'pad-work', players: 1, level: 'normal', seconds: 60 });
  await waitState(page, 'running', 75_000);
  await page.waitForTimeout(2500);
  await call(page, 'pause');
  let s = await waitState(page, 'paused', 5000);
  expect(s.pauseReason).toBe('user');
  const t0 = s.game!.t;
  await page.waitForTimeout(1200);
  s = await snap(page);
  expect(s.game!.t, 'the game does not move while paused').toBe(t0);
  expect(s.cameraLive, 'the camera stays on while paused').toBeGreaterThan(0);
  await call(page, 'resume');
  await waitState(page, 'running', 15_000);
  await page.waitForTimeout(1500);
  s = await snap(page);
  expect(s.game!.t, 'and goes on after resume').toBeGreaterThan(t0);
  expect(s.errors).toEqual([]);
  expect(await call(page, 'quit')).toEqual({ cameraLive: 0, canvases: 0, surfaces: 0 });
  expect(errorsOf(page)).toEqual([]);
});
