// The 3D kit on a real (software) WebGL context, headless: no leak over sessions (audit B5), every world draws, a
// frame budget per tier, a lost context comes back, and dispose leaves the renderer empty.
// Set BA_SHOT_DIR to a folder to also write a picture of every world there (for looking at).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import type * as Harness from './pages/render3d-harness.ts';

type H = typeof Harness;
const WORLDS = ['alps', 'desert', 'forest', 'storm', 'sunset', 'arctic', 'jungle', 'city', 'volcano', 'coast'];

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto(`${DEV_URL}/tests/e2e/pages/render3d.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true, undefined, { timeout: 60_000 });
}

const errorsOf = (page: Page): string[] => (page as unknown as { errors: string[] }).errors;

function call<K extends keyof H>(page: Page, fn: K, arg: Parameters<H[K]>[0]): Promise<Awaited<ReturnType<H[K]>>> {
  return page.evaluate(async ([name, a]) => {
    const r3d = (window as unknown as { r3d: Record<string, (x: unknown) => unknown> }).r3d;
    return await r3d[name as string]!(a);
  }, [fn as string, arg] as const) as Promise<Awaited<ReturnType<H[K]>>>;
}

/** Budgets (draw calls and triangles per frame at 390x844; CPU milliseconds per frame at 4x throttling). */
const BUDGET = {
  // Measured on the ten worlds: 15 to 41 calls and 14k to 37k triangles at every tier (the old engine: 70 to 84 calls and
  // 23k to 114k triangles at its top level). Headroom is about one third, so a regression shows.
  calls: { 0: 55, 1: 55, 2: 55 },
  triangles: { 0: 50_000, 1: 50_000, 2: 50_000 },
  // CPU side at 4x throttling, measured over four runs (with other builds running on the machine, so the tails are noisy):
  // update p50 0.1-0.4 ms, p95 0.4-6.1 ms; submit p50 2.4-9 ms. p95 of the submit is not judged: software GL stalls the page
  // now and then (6 to 43 ms), a phone's GPU driver does not.
  updateP50Ms: 1.5,
  updateMs: 8,
  renderMs: 12,
} as const;

const within = (a: number, b: number, share: number): boolean => Math.abs(a - b) <= Math.max(1, Math.abs(a) * share);

test.describe.configure({ mode: 'serial' });

test('no leak: five sessions in the same world and in changing worlds leave the same GPU and CPU counts (B5)', async ({ page }) => {
  test.skip(!!process.env.CI, 'needs a hardware GPU and real CPU time; runs on the local release gate, not on GitHub runners');
  test.setTimeout(240_000);
  await open(page);
  for (const level of [2, 0] as const) {
    const same = await call(page, 'leakRun', { sessions: 5, worldIds: ['forest'], frames: 120, level, width: 390, height: 844 });
    const first = same[0]!;
    for (const s of same.slice(1)) {
      expect(within(s.stats.geometries, first.stats.geometries, 0.1), `geometries session ${s.session}: ${s.stats.geometries} vs ${first.stats.geometries}`).toBe(true);
      expect(within(s.stats.textures, first.stats.textures, 0.1), `textures session ${s.session}: ${s.stats.textures} vs ${first.stats.textures}`).toBe(true);
      expect(within(s.stats.drawCalls, first.stats.drawCalls, 0.1), `draw calls session ${s.session}`).toBe(true);
      expect(s.counts).toEqual(first.counts);
    }
    // the same world again must not even be rebuilt: after the first, a "build" is a reset
    expect(same[1]!.buildMs).toBeLessThan(Math.max(30, first.buildMs / 3));
    // obstacle clones come from a pool: a few dozen objects at most, however many spawned
    expect(same[4]!.protoCreated).toBeLessThan(20);
    expect(same[4]!.obstaclesSpawned).toBeGreaterThan(20);

    // changing worlds: the same world has the same numbers in both rounds
    const rotate = await call(page, 'leakRun', { sessions: 6, worldIds: ['alps', 'storm', 'city'], frames: 90, level, width: 390, height: 844 });
    for (let i = 0; i < 3; i++) {
      const a = rotate[i]!, b = rotate[i + 3]!;
      expect(a.world).toBe(b.world);
      expect(within(b.stats.geometries, a.stats.geometries, 0.1), `${a.world} geometries ${b.stats.geometries} vs ${a.stats.geometries}`).toBe(true);
      expect(within(b.stats.textures, a.stats.textures, 0.1), `${a.world} textures ${b.stats.textures} vs ${a.stats.textures}`).toBe(true);
      expect(b.counts).toEqual(a.counts);
    }
    console.log(`leak L${level}`, JSON.stringify({ same: same.map((s) => [s.stats.geometries, s.stats.textures, s.stats.drawCalls]), rotate: rotate.map((s) => [s.world, s.stats.geometries, s.stats.textures, Math.round(s.buildMs)]) }));
  }
  expect(errorsOf(page)).toEqual([]);
});

test('dispose leaves nothing in the renderer', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  const r = await call(page, 'disposeRun', { worldIds: ['alps', 'volcano', 'coast'], frames: 40, level: 2 });
  expect(r.before.geometries).toBeGreaterThan(8);
  expect(r.after.geometries).toBe(0);
  expect(r.after.textures).toBe(0);
  expect(r.counts).toEqual({ geometries: 0, materials: 0, textures: 0, other: 0 });
  expect(r.tracked).toEqual({ geometries: 0, materials: 0, textures: 0, other: 0 });
  expect(errorsOf(page)).toEqual([]);
});

test('every world draws a real picture at every tier, portrait and landscape, within its draw budget', async ({ page }) => {
  test.setTimeout(480_000);
  await open(page);
  const portrait = await call(page, 'shotRun', { worldIds: WORLDS, levels: [2, 1, 0], sizes: [[390, 844]], frames: 45 });
  const landscape = await call(page, 'shotRun', { worldIds: WORLDS, levels: [2], sizes: [[844, 390]], frames: 45 });
  const shots = [...portrait, ...landscape];
  console.log('draw load [world, tier, calls, triangles, slices, scenery calls]', JSON.stringify(portrait.map((s) => [s.world, s.level, s.calls, s.triangles, s.scenery?.visibleSlices, s.scenery?.drawCalls])));
  expect(shots.length).toBe(WORLDS.length * 4);
  const dir = process.env.BA_SHOT_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const s of shots) {
    const tag = `${s.world} T${s.level} ${s.width}x${s.height}`;
    expect(s.contrast, `${tag} is not blank`).toBeGreaterThan(0.12);
    expect(s.distinctColours, `${tag} colours`).toBeGreaterThan(14);
    expect(s.meanLuma, `${tag} is not black`).toBeGreaterThan(0.04);
    expect(s.meanLuma, `${tag} is not white`).toBeLessThan(0.96);
    // Draw budget: the old engine drew 70 to 84 calls per world at its top level and 45 to 56 at its lowest.
    expect(s.calls, `${tag} draw calls`).toBeGreaterThan(10);
    expect(s.calls, `${tag} draw calls`).toBeLessThanOrEqual(BUDGET.calls[s.level as 0 | 1 | 2]);
    expect(s.triangles, `${tag} triangles`).toBeLessThanOrEqual(BUDGET.triangles[s.level as 0 | 1 | 2]);
    if (dir) writeFileSync(join(dir, `${s.world}-T${s.level}-${s.width}x${s.height}.jpg`), Buffer.from(s.jpeg.split(',')[1]!, 'base64'));
  }
  for (const w of WORLDS) {
    const t = (l: number): (typeof shots)[number] => shots.find((x) => x.world === w && x.level === l && x.width === 390)!;
    expect(t(0).triangles, `${w}: T0 draws no more triangles than T2 (plus the blob shadows)`).toBeLessThanOrEqual(t(2).triangles + 12);
    expect(t(0).calls, `${w}: T0 has no more calls than T2 (plus the blob shadows)`).toBeLessThanOrEqual(t(2).calls + 2);
  }
  expect(errorsOf(page)).toEqual([]);
});

test('frame cost of the kit at 4x CPU throttling', async ({ page }) => {
  test.skip(!!process.env.CI, 'needs a hardware GPU and real CPU time; runs on the local release gate, not on GitHub runners');
  test.setTimeout(480_000);
  await open(page);
  const rows: Awaited<ReturnType<H['budgetRun']>>[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const worldId of ['alps', 'forest', 'storm', 'city']) {
    for (const level of [2, 1, 0] as const) rows.push(await call(page, 'budgetRun', { worldId, level, frames: 40, paced: 12, width: 390, height: 844 }));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('frame cost 4x CPU [world, tier, update p50, p95, submit p50, p95, gpu p50 (software), paced frame ms]', JSON.stringify(rows.map((r) => [r.world, r.level, +r.updateP50.toFixed(2), +r.updateP95.toFixed(2), +r.renderP50.toFixed(2), +r.renderP95.toFixed(2), Math.round(r.gpuP50), Math.round(r.frameMsP50)])));
  for (const w of ['alps', 'forest', 'storm', 'city']) {
    const t = (l: number): (typeof rows)[number] => rows.find((r) => r.world === w && r.level === l)!;
    // Software GL is slow and noisy, but the ratio between tiers is what the governor relies on (graphics-maps.md 3.2: T0 about 30 to 47 % of T2).
    expect(t(0).gpuP50, `${w}: T0 is clearly cheaper than T2 on the GPU side`).toBeLessThan(t(2).gpuP50 * 0.8);
  }
  for (const r of rows) {
    const tag = `${r.world} T${r.level}`;
    // The kit's own CPU work in one frame at 4x throttling must leave most of a 16.7 ms frame to the game and the pose model.
    expect(r.updateP50, `${tag} update (median)`).toBeLessThan(BUDGET.updateP50Ms);
    expect(r.updateP95, `${tag} update (p95)`).toBeLessThan(BUDGET.updateMs);
    expect(r.renderP50, `${tag} render submit (median)`).toBeLessThan(BUDGET.renderMs);
  }
  expect(errorsOf(page)).toEqual([]);
});

test('a lost WebGL context pauses drawing and the world comes back when it is restored', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const r = await call(page, 'contextRun', undefined);
  expect(r.lostEvents).toBe(1);
  expect(r.restoredEvents).toBe(1);
  expect(r.afterContrast).toBeGreaterThan(0.12);
  expect(r.statsAfter.drawCalls).toBeGreaterThan(10);
  expect(errorsOf(page).filter((e) => !/context/i.test(e))).toEqual([]);
});
