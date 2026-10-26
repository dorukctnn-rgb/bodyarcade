// The one second replay of a missed move, on the results screen: a round with the camera (the practice session of this build, which
// gives the landmarks of a player who squats and misses three moves) ends with the skeleton of the miss drawn in the slot, played once
// as the screen opens and again with the button, and as one still picture for a player who asked for less motion. A round with the
// keyboard, or without a miss, has no slot. The picture is made of landmarks only and is gone when the screen is. The same flow on the
// real session, with the browser's fake camera and a real pose model, is e2e-real/replay-camera.spec.ts.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { checkPage } from '../tools/layout-check.ts';
import { collectErrors, withHooks, type Hooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

test.use({ permissions: ['camera'] });

// three misses in a round of fourteen seconds (at three, seven and eleven), played three times as fast as a person would
const CAMERA: Hooks = { timeScale: 3, roundSeconds: 14, forceDemo: true, keyboard: true };

declare global { interface Window { __replayStates?: string[]; __replayProgress?: number[] } }

/**
 * Notes every state the replay slot goes through and every value its track takes, from the moment it is on the page (a second of play is easy to miss
 * by polling, and a loaded machine makes it easier).
 */
async function watchStates(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__replayStates = [];
    window.__replayProgress = [];
    const note = (): void => {
      const s = document.querySelector<HTMLElement>('[data-replay]')?.dataset['state'];
      const list = window.__replayStates as string[];
      if (s && list[list.length - 1] !== s) list.push(s);
      const p = document.querySelector<HTMLElement>('[data-replay-track]')?.style.getPropertyValue('--p');
      const prog = window.__replayProgress as number[];
      if (p !== undefined && p !== '' && prog[prog.length - 1] !== Number(p)) prog.push(Number(p));
    };
    new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'style'] });
  });
}

async function states(page: Page): Promise<string[]> { return page.evaluate(() => window.__replayStates ?? []); }
async function progress(page: Page): Promise<number[]> { return page.evaluate(() => window.__replayProgress ?? []); }

/** The round is on: the HUD is up, and no countdown, calibration or loading covers it. */
async function inRound(page: Page): Promise<void> {
  await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60_000 });
}

async function toResults(page: Page, o: { path?: string; hooks?: Hooks } = {}): Promise<void> {
  await withHooks(page, o.hooks ?? CAMERA);
  await page.addInitScript(() => { try { localStorage.setItem('ba2.shell.cameraExplained', JSON.stringify({ v: 1, d: true })); } catch { /* no storage */ } });
  await page.goto(`${WEB_DEV_URL}${o.path ?? '/play/squat-flap/?input=camera'}`);
  await page.waitForURL(/results/, { timeout: 60_000 });
}

/** What the replay canvas holds: how much of it is the backdrop, bones (white), joints (coral), and the box the body stands in. */
async function ink(page: Page): Promise<{ w: number; h: number; bone: number; joint: number; other: number; box: { l: number; t: number; r: number; b: number } | null }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-replay] canvas');
    const g = c?.getContext('2d');
    if (!c || !g) return { w: 0, h: 0, bone: 0, joint: 0, other: 0, box: null };
    const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
    let bone = 0, joint = 0, other = 0;
    let l = width, t = height, r = -1, b = -1;
    const near = (i: number, R: number, G: number, B: number, d: number): boolean => Math.abs((data[i] as number) - R) < d && Math.abs((data[i + 1] as number) - G) < d && Math.abs((data[i + 2] as number) - B) < d;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (near(i, 26, 20, 48, 6)) continue; // the backdrop
        if (near(i, 244, 242, 248, 30)) bone++; else if (near(i, 255, 79, 110, 50)) joint++; else other++;
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
    return { w: width, h: height, bone, joint, other, box: r < 0 ? null : { l, t, r, b } };
  });
}

test.describe('a round with the camera that missed', () => {
  test('ends with the replay: the skeleton of the miss, played once on open and again with the button', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && r.method() !== 'HEAD') requests.push(`${r.method()} ${r.url()}`); });
    await watchStates(page);
    await toResults(page);

    const card = page.locator('.k-replay');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'One second replay' })).toBeVisible();
    // the reason it shows is the one the list says first (two of the three misses), in words
    await expect(card.locator('[data-replay-reason]')).toHaveText('Hips not low enough');
    await expect(page.locator('.k-misses li').first()).toContainText('Hips not low enough');
    await expect(card.getByRole('img', { name: /Skeleton replay of a missed move: Hips not low enough/ })).toBeVisible();
    await expect(card.locator('.k-fine')).toContainText('Only your skeleton is kept for this, never the video.');

    // played once as the screen opened, and it ended on the moment of the miss
    await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
    expect((await states(page)).filter((s) => s === 'playing').length).toBe(1);
    expect((await states(page))).toEqual(['playing', 'done']);
    const frames = Number(await page.locator('[data-replay]').getAttribute('data-frames'));
    // thirty a second, as a camera gives (the practice player makes up for a timer that a busy machine was late with)
    expect(frames, 'frames in the window').toBeGreaterThanOrEqual(24);
    expect(frames).toBeLessThanOrEqual(36);
    await expect(card.locator('[data-replay-length]')).toHaveText(/^(0\.9|1\.0) s$/);

    // a skeleton is on the canvas: white bones, coral joints, inside the picture with room around it, and nothing else
    const done = await ink(page);
    expect(done.w).toBeGreaterThan(200);
    expect(done.bone, 'white bones').toBeGreaterThan(300);
    expect(done.joint, 'coral joints').toBeGreaterThan(40);
    expect(done.box).not.toBeNull();
    const box = done.box as { l: number; t: number; r: number; b: number };
    expect(box.l).toBeGreaterThan(done.w * 0.05);
    expect(box.r).toBeLessThan(done.w * 0.95);
    expect(box.t).toBeGreaterThan(done.h * 0.05);
    expect(box.b).toBeLessThan(done.h * 0.95);
    // and that skeleton is the body that squatted: taller than wide, in the middle of the picture
    expect(box.b - box.t).toBeGreaterThan(box.r - box.l);

    // the button plays it again, from its start to its end, and the track follows
    const button = card.getByRole('button', { name: 'Replay' });
    await expect(button).toBeVisible();
    const before = await ink(page);
    const ran = (await progress(page)).length;
    await button.click();
    await expect.poll(async () => (await states(page)).length, { timeout: 10_000 }).toBe(4);
    expect(await states(page)).toEqual(['playing', 'done', 'playing', 'done']);
    // the track went from the start to the end, never back, and moved on the way
    const run = (await progress(page)).slice(ran);
    expect(run[0], 'the track starts at the beginning').toBe(0);
    expect(run.at(-1), 'and ends at the end').toBe(1);
    expect(run.length, 'it moves while it plays').toBeGreaterThan(3);
    for (let i = 1; i < run.length; i++) expect(run[i] as number).toBeGreaterThanOrEqual(run[i - 1] as number);
    expect(await page.locator('.k-replay .track').evaluate((el) => getComputedStyle(el).getPropertyValue('--p').trim())).toBe('1');
    // it ends on the same picture as before: the moment of the miss
    const after = await ink(page);
    expect(Math.abs(after.bone - before.bone)).toBeLessThan(before.bone * 0.05 + 5);

    // nothing but landmarks, and nothing sent anywhere
    expect(requests, 'requests that send something').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('at 390 and at 1440 pixels the card fits the screen, and the pictures are looked at', async ({ page }) => {
    test.setTimeout(180_000);
    const shots = process.env['BA_REPLAY_SHOTS'];
    if (shots) mkdirSync(shots, { recursive: true });
    for (const [w, h] of [[390, 844], [1440, 900]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await toResults(page);
      await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
      await page.locator('.k-replay').scrollIntoViewIfNeeded();
      expect(await checkPage(page), `layout at ${w}`).toEqual([]);
      const view = await page.locator('[data-replay]').boundingBox();
      expect(view?.width ?? 0).toBeGreaterThan(Math.min(w, 600) * 0.6);
      expect(view?.width ?? 0).toBeLessThanOrEqual(w);
      if (shots) {
        await page.locator('.k-replay').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${shots}/results-replay-${w}.png`, fullPage: true });
      }
    }
  });

  test('is one still picture for a player who asked for less motion: the pose of the miss with the poses before it faint, and no button to play', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watchStates(page);
    await toResults(page);
    await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'still');
    await expect(page.getByRole('button', { name: 'Replay' })).toBeHidden();
    await expect(page.locator('.k-replay .scrub')).toBeHidden();
    const first = await ink(page);
    expect(first.bone).toBeGreaterThan(300);
    // faint poses behind the pose of the miss: pixels that are neither bone nor joint nor backdrop (the poses before it, blended)
    expect(first.other, 'faint earlier poses').toBeGreaterThan(200);
    await page.waitForTimeout(1500);
    expect((await states(page)).includes('playing')).toBe(false);
    expect(await page.locator('[data-replay]').getAttribute('data-state')).toBe('still');
    expect((await ink(page)).bone).toBe(first.bone);
  });

  test('speaks Turkish with the reason in Turkish', async ({ page }) => {
    test.setTimeout(120_000);
    await toResults(page, { path: '/tr/play/squat-flap/?input=camera' });
    const card = page.locator('.k-replay');
    await expect(card.getByRole('heading', { name: 'Bir saniyelik tekrar' })).toBeVisible();
    await expect(card.locator('[data-replay-reason]')).toHaveText('Kalçan yeterince alçalmadı');
    await expect(card.getByRole('button', { name: 'Tekrar oynat' })).toBeVisible();
    await expect(card.locator('[data-replay-length]')).toHaveText(/^(0,9|1,0) sn$/);
    await expect(card.locator('.k-fine')).toContainText('görüntü asla saklanmaz');
  });

  test('is drawn again, as it was, when the screen is drawn again (the window changes its shape), and is not played again by that', async ({ page }) => {
    test.setTimeout(120_000);
    await watchStates(page);
    await toResults(page);
    await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
    const wide = await ink(page);
    expect(wide.bone).toBeGreaterThan(300);
    // from a laptop to a phone: the page is built again for the new class of screen (a moment after the window changed)
    await page.evaluate(() => document.querySelector('[data-replay]')?.setAttribute('data-old', '1'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => { const v = document.querySelector('[data-replay]'); return !!v && !v.hasAttribute('data-old') && v.getAttribute('data-state') === 'done'; }, undefined, { timeout: 10_000 });
    const narrow = await ink(page);
    expect(narrow.w, 'the canvas has the size of the new picture').not.toBe(wide.w);
    expect(narrow.bone, 'the skeleton is on the new canvas').toBeGreaterThan(300);
    await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'done');
    expect(await states(page)).toEqual(['playing', 'done']);
    // and the button still plays it
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect.poll(async () => (await states(page)).length, { timeout: 10_000 }).toBe(4);
    expect(await states(page)).toEqual(['playing', 'done', 'playing', 'done']);
  });
});

test.describe('where there is nothing to show', () => {
  test('a round with the keyboard has no replay, and a round that ended before it missed has none either', async ({ page }) => {
    test.setTimeout(120_000);
    // the keyboard: no body moved, nothing was recorded
    await toResults(page, { path: '/play/squat-flap/?input=keyboard', hooks: { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true } });
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('[data-replay]')).toHaveCount(0);
    await expect(page.getByText('One second replay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__BA__?.debug().replay)).toEqual({ recording: false, kept: 0, clipFrames: 0, player: 'none' });
    // the camera, and a round of two seconds: the first miss of the practice player comes at three
    await toResults(page, { hooks: { timeScale: 3, roundSeconds: 2, forceDemo: true, keyboard: true } });
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('[data-replay]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__BA__?.debug().replay)).toEqual({ recording: false, kept: 0, clipFrames: 0, player: 'none' });
  });
});

test.describe('nothing is kept', () => {
  test('the landmarks are the screen\'s: gone when it is left, none while the next round runs, none in the page\'s storage, none sent', async ({ page }) => {
    test.setTimeout(150_000);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && r.method() !== 'HEAD') requests.push(`${r.method()} ${r.url()}`); });
    await toResults(page);
    await expect(page.locator('[data-replay]')).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
    const held = await page.evaluate(() => window.__BA__?.debug().replay);
    expect(held?.clipFrames, 'the window is held for the screen').toBeGreaterThanOrEqual(20);
    expect(held?.recording, 'the recorder is let go of when the round ends').toBe(false);
    expect(held?.player).toBe('done');

    // the page's storage holds the player's record of the round (a score, a day), and no skeleton: no key about it, no run of numbers like a window of landmarks
    const stored = await page.evaluate(async () => {
      const all: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i) as string; all[k] = localStorage.getItem(k) ?? ''; }
      for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i) as string; all[`session:${k}`] = sessionStorage.getItem(k) ?? ''; }
      const dbs = (await indexedDB.databases?.()) ?? [];
      return { all, databases: dbs.map((d) => d.name ?? '') };
    });
    for (const [k, v] of Object.entries(stored.all)) {
      expect(k, `a key about the replay: ${k}`).not.toMatch(/replay|landmark|skeleton|pose/i);
      expect(v, `a window of numbers in ${k}`).not.toMatch(/(-?\d\.\d{3,}[,\s]+){40,}/);
    }
    expect(stored.databases.filter((n) => /replay|landmark|pose/i.test(n))).toEqual([]);

    // leaving the screen lets the window go, the player and the picture with it
    await page.getByRole('link', { name: 'Choose another game' }).click();
    await expect(page.locator('[data-replay]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__BA__?.debug().replay)).toEqual({ recording: false, kept: 0, clipFrames: 0, player: 'none' });

    // the next round starts with nothing of the last one: it records, and holds no window yet
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=camera`);
    await inRound(page);
    expect(await page.evaluate(() => window.__BA__?.debug().replay.recording)).toBe(true);
    expect(await page.evaluate(() => window.__BA__?.debug().replay.clipFrames)).toBe(0);
    // leaving that round (the camera lets go with it) lets its recorder go
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Leave round' }).click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    expect(await page.evaluate(() => window.__BA__?.debug().replay)).toEqual({ recording: false, kept: 0, clipFrames: 0, player: 'none' });
    expect(requests, 'requests that send something').toEqual([]);
  });
});
