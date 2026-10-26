// The highlight clip, on a real game and the real session in real time (a recorder runs on the browser's clock): a round of thirty
// seconds (the tour's first round, by keyboard) ends with a clip of its last seconds on the results, a video made on this device from
// the game view; it is shared as a file where the browser takes one and saved where it does not, and it is not made when the player
// turned it off. The two recorders that take turns, the lengths and the pauses are held in app/clip.test.ts with a stand-in recorder.
// A 2D game (Squat Flap) and Road Run's 3D stage make the same clip: the same size cap, and the score, the time and the name of the site
// written over the game view (the 3D stage is copied in the task that drew a frame: a copy on a timer is blank), packaged as avc3 for the
// 3D stage where the browser records it and as avc1 for a 2D one. Where copying the 3D picture is dear (the browser reads it back: headless
// Chromium draws WebGL in software, Firefox), the stage is recorded as it is, without the plates, and the round keeps its speed; the stage
// says which (data-clip: 'plates', or 'as-is', also when copies turned dear in the round and the recorders started again on the stage).
import { expect, test, type Page } from '@playwright/test';
import { CLIP_BRAND, CLIP_MAX_EDGE } from '../src/app/clip.ts';
import { collectErrors } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const ROUND = `${WEB_DEV_URL}/play/squat-flap/?first=1&input=keyboard`;
const ROAD_RUN = `${WEB_DEV_URL}/play/road-run/?input=keyboard`;

/** Presses keys through the round and waits for the results. */
async function playToResults(page: Page, ms = 75_000): Promise<void> {
  await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
  const keys = ['Space', 'ArrowDown', 'Space', 'Space'];
  const end = Date.now() + ms;
  let n = 0;
  while (Date.now() < end) {
    if (page.url().includes('/results/')) return;
    await page.keyboard.press(keys[n++ % keys.length] ?? 'Space');
    await page.waitForTimeout(700);
  }
  throw new Error('the round did not reach the results');
}

type Wrote = { text: string; w: number; h: number };

/** Notes every text a page writes on a 2D canvas and the size of that canvas: the clip's overlay is written on the canvas the clip is recorded from. */
async function watchWriting(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __wrote: Wrote[] };
    w.__wrote = [];
    const real = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, ...rest: [number, number, number?]): void {
      try { w.__wrote.push({ text: String(text), w: this.canvas.width, h: this.canvas.height }); } catch { /* a canvas that has no size to tell */ }
      return real.call(this, text, ...rest);
    } as typeof real;
  });
}

/** Notes how the clip of the round is made, as the stage says it (data-clip on its canvas), the last word before the stage goes. */
async function watchClipHow(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __clipHow?: string };
    new MutationObserver((list) => {
      for (const m of list) { const v = (m.target as Element).getAttribute('data-clip'); if (v) w.__clipHow = v; }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-clip'] });
  });
}

/** The size of the game view on the screen, read while the round is on (the results have no stage). */
const stageOf = (page: Page): Promise<{ w: number; h: number }> => page.locator('[data-scene] canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.clientWidth, h: c.clientHeight }));

/**
 * What a clip must be, whatever the stage: not larger than the cap on its long edge (and not the 300 by 150 of an unsized canvas), the shape of the
 * stage it was recorded from, the score, the time and the name of the site written over the game view on a canvas of the clip's size, a picture that
 * is not black, and the packaging of the codec: avc3 for a 3D stage where the browser records avc3, avc1 for a 2D one.
 */
async function expectTheClip(page: Page, stage: { w: number; h: number }, kind: '2d' | '3d', plates = true): Promise<{ size: number; type: string; src: string }> {
  const card = page.locator('[data-clip]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  const video = card.locator('video');
  const src = (await video.getAttribute('src')) as string;
  expect(src, 'a page address of the clip').toMatch(/^blob:/);
  const info = await page.evaluate(async (u) => {
    const b = await (await fetch(u)).blob();
    const bytes = new Uint8Array(await b.arrayBuffer());
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 400_000)));
    const R = (window as unknown as { MediaRecorder: { isTypeSupported(m: string): boolean } }).MediaRecorder;
    return { size: b.size, type: b.type, avc3: head.includes('avc3'), canAvc3: R.isTypeSupported('video/mp4;codecs=avc3') };
  }, src);
  expect(info.size, 'a clip with something in it').toBeGreaterThan(5_000);
  expect(info.type).toMatch(/^video\/(mp4|webm)$/);
  // the video decodes: it has a size and a first frame
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const dims = await video.evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight }));
  expect(Math.abs(dims.w / dims.h - stage.w / stage.h), `the ${kind} clip has the shape of the stage`).toBeLessThan(0.02);
  if (plates) {
    // the size cap: the stage's own long edge (the screen's pixel ratio is 1 here) up to the cap, never more, never the 300 by 150 of an unsized canvas
    const long = Math.max(dims.w, dims.h);
    expect(long, `the long edge of the ${kind} clip (${dims.w}x${dims.h})`).toBeLessThanOrEqual(CLIP_MAX_EDGE);
    expect(Math.abs(long - Math.min(CLIP_MAX_EDGE, Math.max(stage.w, stage.h))), `the long edge of the ${kind} clip (${dims.w}x${dims.h}) is the stage's (${stage.w}x${stage.h}) up to the cap`).toBeLessThanOrEqual(2);
    // the overlay, written on a canvas of the clip's size: a time, a score and the name of the site
    const wrote = (await page.evaluate(() => (window as unknown as { __wrote: Wrote[] }).__wrote)).filter((x) => x.w === dims.w && x.h === dims.h);
    const texts = [...new Set(wrote.map((x) => x.text))];
    expect(texts, `what was written over the ${kind} clip`).toContain(CLIP_BRAND);
    expect(texts.some((t) => /^\d{1,2}:\d\d$/.test(t)), `the time was written over the ${kind} clip (${texts.join(' | ')})`).toBe(true);
    expect(texts.some((t) => /^[\d.,\s]+$/.test(t)), `the score was written over the ${kind} clip (${texts.join(' | ')})`).toBe(true);
  }
  // the packaging of the codec
  if (info.type === 'video/mp4') {
    if (kind === '3d' && info.canAvc3) expect(info.avc3, 'the 3D clip is avc3 where the browser records it').toBe(true);
    if (kind === '2d') expect(info.avc3, 'a 2D clip is the avc1 every player knows').toBe(false);
  }
  // not a black picture with the plates over it: a frame half a second in, shrunk
  const blackShare = await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    v.pause();
    v.currentTime = Math.min(0.5, (Number.isFinite(v.duration) ? v.duration : 1) / 2);
    await new Promise<void>((res) => { v.addEventListener('seeked', () => res(), { once: true }); window.setTimeout(res, 3000); });
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(v, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i] as number, d[i + 1] as number, d[i + 2] as number) < 24) black++;
    return black / (64 * 36);
  });
  expect(blackShare, `the ${kind} clip shows the game view, not black with the plates over it`).toBeLessThan(0.85);
  // BA_CLIP_SHOTS=<folder> keeps a picture of the frame, to look at (the score, the time and the name of the site are on it)
  const shots = process.env['BA_CLIP_SHOTS'];
  if (shots) await video.screenshot({ path: `${shots}/clip-frame-${kind}${plates ? '' : '-as-is'}.png` });
  return { size: info.size, type: info.type, src };
}

test('a round ends with a clip of its last seconds: a video from the game view, to save, and to share as a file', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await watchWriting(page);
  // a share sheet that takes files, and a note of what it was given
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: { name: string; type: string; size: number; title?: string; text?: string; url?: string }[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: { files?: File[] }) => Array.isArray(d.files) && d.files.length === 1 });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: { files: File[]; title?: string; text?: string; url?: string }) => {
        const f = d.files[0] as File;
        w.__shared.push({ name: f.name, type: f.type, size: f.size, ...(d.title !== undefined ? { title: d.title } : {}), ...(d.text !== undefined ? { text: d.text } : {}), ...(d.url !== undefined ? { url: d.url } : {}) });
      },
    });
  });
  await page.goto(ROUND);
  await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await stageOf(page)).w, { timeout: 30_000 }).toBeGreaterThan(300);
  const stage = await stageOf(page);
  await playToResults(page);

  const card = page.locator('[data-clip]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Your highlight');
  await expect(card).toContainText('without your camera picture');
  const info = await expectTheClip(page, stage, '2d');

  // saving: a file with the name of the game and the score
  const download = page.waitForEvent('download');
  await card.getByRole('link', { name: 'Save clip' }).click();
  expect((await download).suggestedFilename()).toMatch(/^bodyarcade-squat-flap-\d+\.(mp4|webm)$/);

  // sharing: the share sheet gets one video file, the words and the game's address (and nothing of the player but the score)
  await card.getByRole('button', { name: 'Share clip' }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1);
  const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; size: number; title?: string; text?: string; url?: string }[] }).__shared[0]);
  expect(shared?.name).toMatch(/^bodyarcade-squat-flap-\d+\.(mp4|webm)$/);
  expect(shared?.type).toMatch(/^video\//);
  expect(shared?.size).toBe(info.size);
  expect(shared?.text).toContain('on BodyArcade');
  expect(shared?.url).toContain('/games/squat-flap/');

  // the clip is the results' own: it is let go when the page goes on
  await page.getByRole('link', { name: /Choose another game|See all games|All \d+ games|games/i }).first().click();
  await expect(page.locator('[data-clip]')).toHaveCount(0);
  expect(errors.filter((e) => !/MediaRecorder|captureStream/i.test(e))).toEqual([]);
});

test('Road Run, a 3D stage, makes the same clip as a 2D game where copying its picture is cheap, and records the stage as it is where it is dear: a picture of the road either way', async ({ page }) => {
  // the real game on the real 3D scene (headless Chromium draws it in software), in real time, to the end of the round or the last heart
  test.setTimeout(260_000);
  const errors = collectErrors(page);
  await watchWriting(page);
  await watchClipHow(page);
  await page.goto(ROAD_RUN);
  await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await stageOf(page)).w, { timeout: 30_000 }).toBeGreaterThan(300);
  const stage = await stageOf(page);
  // once the scene is built (the canvas names its world) it has a WebGL context, and asking it for a 2D one gives nothing
  await expect(page.locator('[data-scene] canvas')).toHaveAttribute('data-world', /^[a-z]+$/,{ timeout: 60_000 });
  const webgl = await page.locator('[data-scene] canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d') === null);
  expect(webgl, 'Road Run draws on a WebGL canvas (no 2D context)').toBe(true);
  // the recorder starts with the round and the stage says how its clip is made
  await expect(page.locator('[data-scene] canvas')).toHaveAttribute('data-clip', /^(plates|as-is)$/, { timeout: 60_000 });
  await playToResults(page, 220_000);
  const how = await page.evaluate(() => (window as unknown as { __clipHow?: string }).__clipHow);
  test.info().annotations.push({ type: 'clip', description: how ?? 'none' });
  await expectTheClip(page, stage, '3d', how === 'plates');
  // nothing in the console: not the "codec description is not supposed to change" of an avc1 recorder fed frames of two sizes
  expect(errors.filter((e) => !/MediaRecorder|captureStream/i.test(e))).toEqual([]);
});

test('where the browser has no share sheet for files, sharing saves the clip and says so', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await page.goto(ROUND);
  await playToResults(page);
  await expect(page.locator('[data-clip]')).toBeVisible({ timeout: 15_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Share clip' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.(mp4|webm)$/);
  await expect(page.locator('.ba-toast')).toContainText('The clip was saved to your downloads.');
});

test('with the clips switched off in the settings a round ends with no clip', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(`${WEB_DEV_URL}/settings/`);
  await expect(page.locator('#set-clips')).toBeChecked();
  await page.locator('label[for="set-clips"]').click();
  await expect(page.locator('#set-clips')).not.toBeChecked();
  await page.goto(ROUND);
  await playToResults(page);
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('[data-clip]')).toHaveCount(0);
});
