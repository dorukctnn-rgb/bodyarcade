// The three target games with TWO people in front of one camera (session mode 'local2', a big screen), through the real
// pipeline: the recorded pair in Chromium's fake camera, the pose model with numPoses 2, the stable left and right
// assignment, one hand detector per player, two lanes, two score plates. Each player's rings must sit on that player's own
// hands in the picture (player 1 on the left of the mirrored view). Runs on the local release gate, not on the CI runners.
// One person: target-camera.spec.ts.
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { alignment, call, errorsOf, GAMES, open, shot, SKIP_ON_CI, snap, TWO, waitState } from './support/target-camera.ts';

test.skip(!!process.env.CI, SKIP_ON_CI);
test.use({ launchOptions: withFakeVideo(TWO) });

for (const game of GAMES) {
  test(`${game} with two people at a laptop: both calibrated, two score plates, each ring on its own person, nothing under a plate`, async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, 1280, 800);
    await call(page, 'begin', { game, players: 2, level: 'normal', seconds: 40 });
    let s = await waitState(page, 'running', 90_000);
    expect(s.players.filter((p) => !p.present), 'nobody was lost').toEqual([]);
    await page.waitForTimeout(3500);
    const a = await alignment(page, 2, 10);
    s = await snap(page);
    expect(s.game!.lanes.length, 'two lanes').toBe(2);
    expect(a.samples[0]!, 'player 1 seen').toBeGreaterThan(2);
    expect(a.samples[1]!, 'player 2 seen').toBeGreaterThan(2);
    expect(a.median[0]!, `player 1's rings sit on player 1's hands (${JSON.stringify(a)})`).toBeLessThan(0.1);
    expect(a.median[1]!, `player 2's rings sit on player 2's hands (${JSON.stringify(a)})`).toBeLessThan(0.1);
    expect(Object.keys(s.hudText).filter((k) => /^statusP[12]$/.test(k)).length, 'a score plate for each player').toBe(2);
    expect(s.hudProblems).toEqual([]);
    expect(s.geometry.violations).toEqual([]);
    expect(s.errors).toEqual([]);
    await shot(page, `camera-${game}-two`);
    expect(await call(page, 'quit')).toEqual({ cameraLive: 0, canvases: 0, surfaces: 0 });
    expect(errorsOf(page)).toEqual([]);
  });
}
