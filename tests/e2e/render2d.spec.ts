// The 2D kit on a real canvas, headless, on the ten screens of the plan: the camera is mirrored (left stays left of the
// player), the self view is a small mirrored window that covers none of the HUD, the body is drawn where project() says,
// and the kit's own CPU cost per frame fits the budget at 4x throttling.
// Set BA_SHOT_DIR to a folder to also write a picture per screen (for looking at).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import type * as Harness from './pages/render2d-harness.ts';

type H = typeof Harness;

const SCREENS: [string, number, number][] = [
  ['phone-360', 360, 780], ['phone-390', 390, 844], ['phone-412', 412, 915], ['phone-land-844', 844, 390], ['phone-land-915', 915, 412],
  ['tablet-768', 768, 1024], ['tablet-land-1024', 1024, 768], ['laptop-1280', 1280, 800], ['laptop-1440', 1440, 900], ['tv-1920', 1920, 1080],
];

/**
 * Budget: the time the kit needs to issue one whole frame (video, body, 12 sprites, particles, self view with skeleton)
 * at 4x CPU throttling. The browser rasterises afterwards: on a phone that is the GPU's job, here it is software.
 */
const BUDGET = { frameP95Ms: 8, frameP50Ms: 4 } as const;   // measured idle: p50 0.8-1.4, p95 1.7-3.8; with other builds running on the machine p50 up to 2.2, p95 up to 5.1

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto(`${DEV_URL}/tests/e2e/pages/render2d.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true, undefined, { timeout: 60_000 });
}

const errorsOf = (page: Page): string[] => (page as unknown as { errors: string[] }).errors;

function call<K extends keyof H>(page: Page, fn: K, arg: Parameters<H[K]>[0]): Promise<Awaited<ReturnType<H[K]>>> {
  return page.evaluate(async ([name, a]) => {
    const r2d = (window as unknown as { r2d: Record<string, (x: unknown) => unknown> }).r2d;
    return await r2d[name as string]!(a);
  }, [fn as string, arg] as const) as Promise<Awaited<ReturnType<H[K]>>>;
}

const near = (c: { r: number; g: number; b: number } | null, hex: string, tol = 24): boolean => {
  if (!c) return false;
  const want = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  return Math.abs(c.r - want[0]!) <= tol && Math.abs(c.g - want[1]!) <= tol && Math.abs(c.b - want[2]!) <= tol;
};

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test.describe.configure({ mode: 'serial' });

for (const [name, w, h] of SCREENS) {
  test(`${name} (${w}x${h}): mirrored picture, small self view that covers no HUD plate, body where project() says`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    const dir = process.env.BA_SHOT_DIR;
    if (dir) mkdirSync(dir, { recursive: true });
    for (const camAspect of [4 / 3, 16 / 9]) {
      // mirror games: the mirror is the scene, no self view
      const m = await call(page, 'frameRun', { w, h, dpr: 2, mode: 'mirror', corner: 'bottom-right', camAspect, jpeg: Boolean(dir) && camAspect === 4 / 3 });
      // the card is red on the left, blue on the right: a mirror shows them swapped
      expect(near(m.mirrorLeft, '#2a4fd1'), `${name} mirror left is blue (mirrored): ${JSON.stringify(m.mirrorLeft)}`).toBe(true);
      expect(near(m.mirrorRight, '#d12a2a'), `${name} mirror right is red (mirrored): ${JSON.stringify(m.mirrorRight)}`).toBe(true);
      expect(m.pipLeft).toBeNull();
      if (m.stage) expect(near(m.stage, '#1A1430', 6), `${name} the stage around the mirror: ${JSON.stringify(m.stage)}`).toBe(true);
      expect(m.boneFound, `${name} skeleton visible`).toBe(true);
      expect(m.backing.w * m.backing.h).toBeLessThanOrEqual(2_400_000 * 1.01);
      const aspect = m.rects.mirror.w / m.rects.mirror.h;
      expect(Math.abs(aspect - camAspect) / camAspect, `${name} mirror keeps the camera aspect`).toBeLessThan(0.01);
      // the hip, projected, is inside the mirror
      expect(m.hip.x).toBeGreaterThan(m.rects.mirror.x);
      expect(m.hip.x).toBeLessThan(m.rects.mirror.x + m.rects.mirror.w);
      expect(m.hip.y).toBeGreaterThan(m.rects.mirror.y);
      expect(m.hip.y).toBeLessThan(m.rects.mirror.y + m.rects.mirror.h);
      if (dir && m.jpeg) writeFileSync(join(dir, `mirror-${name}.jpg`), Buffer.from(m.jpeg.split(',')[1]!, 'base64'));

      // scene games: the self view in every corner
      for (const corner of ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const) {
        const f = await call(page, 'frameRun', { w, h, dpr: 2, mode: 'scene', corner, camAspect, jpeg: Boolean(dir) && camAspect === 4 / 3 && corner === 'bottom-right' });
        const pip = f.rects.pip!;
        expect(pip, `${name} ${corner} has a window`).not.toBeNull();
        expect(near(f.pipLeft, '#2a4fd1', 40), `${name} ${corner} window left is blue: ${JSON.stringify(f.pipLeft)}`).toBe(true);
        expect(near(f.pipRight, '#d12a2a', 40), `${name} ${corner} window right is red: ${JSON.stringify(f.pipRight)}`).toBe(true);
        expect(Math.abs(pip.w / pip.h - camAspect) / camAspect).toBeLessThan(0.02);
        expect(pip.x).toBeGreaterThanOrEqual(0);
        expect(pip.y).toBeGreaterThanOrEqual(0);
        expect(pip.x + pip.w).toBeLessThanOrEqual(w);
        expect(pip.y + pip.h).toBeLessThanOrEqual(h);
        expect((pip.w * pip.h) / (w * h), `${name} the self view is small`).toBeLessThan(0.11);
        for (const [k, r] of Object.entries(f.rects.hud)) {
          if (k === 'pip' || k === 'own' || k === 'friend') continue;
          expect(overlap(pip, r), `${name} ${corner}: the self view touches ${k}`).toBe(false);
        }
        // and the markers painted where the plates are were not painted over
        for (const [k, c] of Object.entries(f.markers)) {
          const r = f.rects.hud[k]!;
          if (overlap(pip, r)) continue;
          expect(c.r >= 0, `${name} ${corner}: ${k} marker readable`).toBe(true);
        }
        if (dir && f.jpeg) writeFileSync(join(dir, `scene-${name}.jpg`), Buffer.from(f.jpeg.split(',')[1]!, 'base64'));
      }
    }
    expect(errorsOf(page)).toEqual([]);
  });
}

test('frame cost at 4x CPU throttling: the whole 2D frame of a mirror game and of a scene game', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const rows: [string, number, number, number, string, Awaited<ReturnType<H['costRun']>>][] = [];
  for (const [w, h, dpr] of [[390, 844, 3], [844, 390, 3], [1280, 800, 1], [1920, 1080, 1]] as const) {
    for (const mode of ['mirror', 'scene'] as const) rows.push([`${w}x${h}`, w, h, dpr, mode, await call(page, 'costRun', { w, h, dpr, frames: 90, mode })]);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('2D frame cost 4x CPU [screen, dpr, mode, issue p50, p95, max, with software raster p50, backing]', JSON.stringify(rows.map(([n, , , dpr, mode, r]) => [n, dpr, mode, +r.p50.toFixed(2), +r.p95.toFixed(2), +r.max.toFixed(1), +r.rasterP50.toFixed(1), `${r.backing.w}x${r.backing.h}`])));
  for (const [n, , , , mode, r] of rows) {
    expect(r.p50, `${n} ${mode} median`).toBeLessThan(BUDGET.frameP50Ms);
    expect(r.p95, `${n} ${mode} p95`).toBeLessThan(BUDGET.frameP95Ms);
  }
  expect(errorsOf(page)).toEqual([]);
});

test('sessions in a row leave nothing behind', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const r = await call(page, 'sessionsRun', { sessions: 5, w: 390, h: 844, dpr: 2 });
  for (const s of r) {
    expect(s.canvas).toEqual({ w: 0, h: 0 });
    expect(s.surfaces).toBe(r[0]!.surfaces);
  }
  expect(errorsOf(page)).toEqual([]);
});
