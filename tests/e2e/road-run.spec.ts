// Road Run on the platform in headless Chromium (software WebGL): the Session drives the runner game and its 3D view
// on the render3d kit. Keyboard play from countdown to results, a pause draws nothing (B12), and runs in a row add
// no GPU resources once every obstacle kind has been drawn (B5). The run is 8 s here (seed fixed); the game is the same.
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

interface View {
  state: string;
  states: string[];
  over: { score: number; seconds: number }[];
  errors: unknown[];
  calls: number;
  frame: number;
  geometries: number;
  textures: number;
  x: number | null;
  hud: Record<string, unknown>;
}

const view = (page: Page): Promise<View> => page.evaluate(() => {
  const ba = (window as unknown as { ba: any }).ba;
  const game = ba.games.at(-1);
  return {
    state: ba.session.state, states: [...ba.seen.states], over: [...ba.seen.over], errors: [...ba.seen.errors],
    calls: ba.renderer.info.render.calls, frame: ba.renderer.info.render.frame,
    geometries: ba.renderer.info.memory.geometries, textures: ba.renderer.info.memory.textures,
    x: game?.run ? game.run.x : null, hud: { ...ba.hud },
  };
});

async function waitState(page: Page, want: string, timeout = 30_000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await view(page)).state === want) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`never reached '${want}': ${JSON.stringify(await view(page))}`);
}

const start = (page: Page) => page.evaluate(() => {
  void (window as unknown as { ba: any }).ba.session.start('road-run', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false, world: 'alps' });
});

test('keyboard run in 3D: countdown, play, lanes from the keys, results; a pause draws nothing; later runs add no GPU resources', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${DEV_URL}/tests/e2e/pages/road-run.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);

  await start(page);
  await waitState(page, 'running');
  await page.waitForTimeout(500);
  let v = await view(page);
  expect(v.frame).toBeGreaterThan(10);
  expect(v.hud).toMatchObject({ lives: 3 });

  // A held key moves the runner to the left lane.
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(700);
  v = await view(page);
  expect(v.x).toBeLessThan(-1.2);
  await page.keyboard.up('ArrowLeft');

  // Paused: no frame is drawn.
  await page.evaluate(() => (window as unknown as { ba: any }).ba.session.pause('user'));
  const paused = await view(page);
  await page.waitForTimeout(800);
  v = await view(page);
  expect(v.frame).toBe(paused.frame);
  await page.evaluate(() => (window as unknown as { ba: any }).ba.session.resume());
  await waitState(page, 'results', 30_000);
  v = await view(page);
  expect(v.over.length).toBe(1);
  expect(v.over[0]!.seconds).toBeGreaterThan(7.9);
  const after: { geometries: number; textures: number }[] = [{ geometries: v.geometries, textures: v.textures }];

  // Obstacle textures upload the first time each kind is drawn, so the first runs may add a few; after that a run
  // must not add anything (B5).
  for (let i = 0; i < 3; i++) {
    await start(page);
    await waitState(page, 'results', 40_000);
    const w = await view(page);
    after.push({ geometries: w.geometries, textures: w.textures });
  }
  v = await view(page);
  expect(v.over.length).toBe(4);
  expect(after[3]).toEqual(after[2]);
  expect(after[2]!.geometries).toBeLessThanOrEqual(after[0]!.geometries + 12);
  expect(after[2]!.textures).toBeLessThanOrEqual(after[0]!.textures + 6);
  expect(v.errors).toEqual([]);
  expect(errors).toEqual([]);
});
