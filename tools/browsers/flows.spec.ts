// The web app's main flows on every engine of the browser matrix (BUILD-PLAN "Browsers": Chromium, WebKit = the engine under Safari and
// every iPhone browser, Firefox), on a phone (390x844) and on a desktop (1440x900). One test is one flow of a real visitor; the same
// flows run in every project of playwright.config.ts, and run.ts turns the result into the table browser x flow.
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node tools/browsers/run.ts --engines webkit,firefox
//   (single flow:  ... run.ts --engines webkit --grep "camera")
//
// The camera: on every engine a person stands in front of it. Chromium plays a file as its fake camera; Firefox and WebKit get the same
// pictures through a page-side camera (support/camera.ts), so the app's camera code, the pose model and the games run on them for real.
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { checkPage } from '../../packages/web/tools/layout-check.ts';
import { useKeyboard, withHooks, type Hooks } from '../../packages/web/e2e/support/helpers.ts';
import { cameraState, installPersonCamera } from './support/camera.ts';
import { audioStarts, canvasStreamPlays, isPhone, look, settle, shot, watch } from './support/page.ts';
import { DEMO_URL, RELEASE_URL } from './support/ports.ts';
import { ROOT } from './support/sites.ts';

const FIXTURE = `${ROOT}/tests/e2e/fixtures/standing-640x360.mjpeg`;
const TWO_FIXTURE = `${ROOT}/tests/e2e/fixtures/two-standing-640x360.mjpeg`;
const FAST: Hooks = { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true };

test.describe.configure({ timeout: 150_000 });

/** A phase of a round on the camera, from the page (the same names the page-check tool uses). */
async function phase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const q = (s: string): Element | null => document.querySelector(s);
    const alert = (q('dialog [role=alert], .ba-explain [role=alert]')?.textContent ?? '').trim();
    if (alert && !q('.cal')) return `error: ${alert}`;
    if (q('#ov-title') && /could not start|ba\u015flat\u0131lamad\u0131/i.test(q('#ov-title')?.textContent ?? '')) return `error: ${alert}`;
    // the pause window (the camera stopped, the tab was hidden, the player paused): a start that ends here has not run
    const dlg = q('dialog[open], [role=dialog]');
    const heading = (dlg?.querySelector('h1, h2')?.textContent ?? '').trim();
    if (dlg && /^(paused|duraklat)/i.test(heading)) return `paused: ${(dlg.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)}`;
    if (q('[data-action="camera-continue"]')) return 'explainer';
    if (q('.cal')) return `calibrating ${document.querySelectorAll('[data-calib-check].is-ok').length}/${document.querySelectorAll('[data-calib-check]').length}`;
    if (q('.ba-countdown')) return 'countdown';
    if (q('.ba-loading')) return 'loading';
    if (q('[data-hud-root] [data-hud]')) return 'play';   // the HUD is up and nothing covers it: running, or the gap before the first overlay
    if (/\/results\//.test(location.pathname)) return 'results';
    return `other ${location.pathname}`;
  });
}

/** The order of the phases of a start (the round itself is `play`, wanted as "running"). */
const ORDER = ['explainer', 'loading', 'calibrating', 'countdown', 'play', 'results'];
const rank = (p: string): number => ORDER.findIndex((o) => p.startsWith(o));

/**
 * Waits for a phase (a prefix of the names above, "running" for the round) or a later one that proves it passed (a calibration that takes a blink is
 * not seen by a poll, the three seconds of the countdown are), remembering the phases on the way so a stuck run says where it stood.
 * The HUD with nothing over it is only a running round once the countdown has been seen: before it there is a gap with no overlay (the browser's own
 * permission window, the model loading) that looks the same.
 */
async function until(page: Page, want: string, ms: number, seen: string[] = []): Promise<void> {
  const t0 = Date.now();
  const target = want === 'running' ? 'play' : want;
  let last = '';
  const counted = (p: string): boolean => p.startsWith('countdown') || p.startsWith('results') || (p.startsWith('play') && seen.some((x) => x.startsWith('countdown')));
  while (Date.now() - t0 < ms) {
    last = await phase(page).catch(() => 'gone');
    if (seen[seen.length - 1] !== last) seen.push(last);
    if ((last.startsWith(target) && (target !== 'play' || counted(last))) || (counted(last) && rank(last) > rank(target) && rank(target) >= 0)) return;
    if (last.startsWith('error') || last.startsWith('paused')) break;
    await page.waitForTimeout(400);
  }
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 260)).catch(() => '');
  throw new Error(`waited ${(ms / 1000).toFixed(0)} s for "${want}", the page was at "${last}" (phases on the way: ${seen.join(' > ')}); the page said: ${text}`);
}

const problemsOfLayout = (page: Page): Promise<string[]> => checkPage(page);

/** The camera explainer shows until the browser has the camera allowed (the shell asks the permission API); a flow that goes on with the practice session clicks through it. */
async function passExplainer(page: Page): Promise<void> {
  const button = page.locator('[data-action="camera-continue"]');
  try { await button.waitFor({ state: 'visible', timeout: 4000 }); await button.click(); } catch { /* it did not come up: the permission is granted or the browser cannot tell */ }
}

/** What the page-side camera did, for the report of a camera flow (how often the page asked, how many are open, the error it hit). */
async function noteCamera(page: Page, info: TestInfo): Promise<void> {
  try { info.annotations.push({ type: 'camera', description: JSON.stringify(await cameraState(page)) }); } catch { /* the page is gone */ }
}

/** The camera flows run where the page-side camera can: the engine has the camera API and plays a stream made from a canvas. */
const cameraUsable = async (page: Page): Promise<boolean> => (await hasCameraApi(page)) && (await canvasStreamPlays(page));

/** Does this engine have a camera API at all? (Playwright's WebKit for Windows has none: no MediaStream, no WebRTC, no Web Audio.) */
const hasCameraApi = (page: Page): Promise<boolean> => page.evaluate(() => typeof navigator.mediaDevices?.getUserMedia === 'function');

/** What the HUD says is wrong with the round on screen (the shell's own check). */
const playProblems = (page: Page): Promise<string[]> => page.evaluate(() => window.__BA__?.debug().playProblems ?? ['the test hook window.__BA__ is missing']);

async function leaveRound(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  const paused = page.getByRole('dialog', { name: /Paused|Duraklat/i });
  await expect(paused).toBeVisible({ timeout: 10_000 });
  await paused.getByRole('button', { name: /Leave round|Turdan ayr/i }).click();
  await page.getByRole('button', { name: /^Leave$|^Ayr/i }).click();
}

// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * The whole start of a round on the camera: the explainer, the calibration on a person, the countdown, a running round, and the camera let go
 * when the player leaves. `cpuPose` makes the pose service use the CPU delegate (the built script is patched on its way to the page): Firefox's GPU delegate
 * stalls and the CPU delegate runs, so Firefox starts on the CPU by itself now (landmarker.ts gpuDelegateAdvised); this variant isolates the delegate when a round on an engine fails. `base` runs the same start on another
 * address: the release build, which has no test hooks and the headers of production (its Content-Security-Policy is report-only: an engine that does
 * not allow what the page does says so on its console, and the flow fails on a console error).
 */
async function cameraRoundFlow(page: Page, context: BrowserContext, info: TestInfo, o: { cpuPose?: boolean; base?: string } = {}): Promise<void> {
    const w = watch(page);
    await installPersonCamera(context, { file: FIXTURE, portrait: isPhone(page) });
    if (o.cpuPose) {
      await context.route('**/static/main-*.js', async (route) => {
        const r = await route.fetch();
        await route.fulfill({ response: r, body: (await r.text()).replace(/prefer:(\w+)\.prefer\?\?`GPU`/, 'prefer:$1.prefer??`CPU`') });
      });
    }
    const seen: string[] = [];
    await page.goto(`${o.base ?? DEMO_URL}/play/squat-flap/?input=camera`, { waitUntil: 'networkidle' });
    test.skip(!(await cameraUsable(page)), 'this engine has no camera API, or cannot play a stream made from a canvas (the page-side camera): see the tests "camera: where the engine has no camera API" and the engine probe');
    try {
      await until(page, 'explainer', 30_000, seen);
      await expect(page.getByRole('dialog').first()).toContainText(/never uploaded or saved|asla/i);
      await shot(page, info, 'camera-explainer');
      await page.locator('[data-action="camera-continue"]').click();
      await until(page, 'calibrating', 60_000, seen);
      await shot(page, info, 'camera-calibrating');
      expect(await problemsOfLayout(page), 'layout of the calibration screen').toEqual([]);
      await until(page, 'countdown', 90_000, seen);
      await until(page, 'running', 60_000, seen);
      await page.waitForTimeout(2500);
      await shot(page, info, 'camera-round');
      if (!o.base) expect(await playProblems(page), 'the HUD of the round').toEqual([]);   // the release build has no test hooks to ask
      const scene = await look(page.locator('[data-scene] canvas').first());
      expect(scene.blank, `nothing is drawn in the game scene (${scene.flatColour} over ${(scene.flatShare * 100).toFixed(1)} %)`).toBe(false);
      expect(await cameraState(page), 'the page-side camera is open while the round runs').toMatchObject({ installed: true, live: 1 });
      const video = await page.evaluate(() => { const v = document.querySelector('video'); return v ? { w: v.videoWidth, h: v.videoHeight, ready: v.readyState } : null; });
      expect(video, 'the self view has a picture').not.toBeNull();
      expect(video?.w ?? 0).toBeGreaterThan(0);
    } finally {
      info.annotations.push({ type: 'phases', description: seen.join(' > ') });
      await noteCamera(page, info);
    }
    await leaveRound(page);
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    await expect.poll(async () => (await cameraState(page)).live, { timeout: 10_000, message: 'the camera is still open on the game page' }).toBe(0);
    expect(w.errors).toEqual([]);
}

test.describe('the practice build (hooks, practice session, demo social)', () => {
  test('home: the tiles, a region chip, a game page', async ({ page }, info) => {
    const w = watch(page);
    await page.goto(`${DEMO_URL}/`, { waitUntil: 'networkidle' });
    await settle(page);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.locator('a.ba-tile').count(), 'game tiles on the home page').toBeGreaterThanOrEqual(11);
    expect(await problemsOfLayout(page), 'layout of the home page').toEqual([]);
    await shot(page, info, 'home');
    // a region chip filters without loading the page again
    await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });
    const chip = page.locator('.ba-filters a.ba-chip').nth(1);
    try {
      await chip.click({ timeout: 15_000 });
    } catch (e) {
      // a click that waits for "stable" forever: say what the page was doing (frames per second, where the chip was twice, the scroll) so the report can tell a frozen page from a moving chip
      const diag = await page.evaluate(async (sel) => {
        const box = (): string => { const r = document.querySelectorAll(sel)[1]?.getBoundingClientRect(); return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}` : 'none'; };
        const first = box();
        let frames = 0;
        const t0 = performance.now();
        await new Promise<void>((res) => { const step = (): void => { frames++; if (performance.now() - t0 > 1000) res(); else requestAnimationFrame(step); }; requestAnimationFrame(step); window.setTimeout(res, 2500); });
        return { first, second: box(), framesInASecond: frames, scrollY: Math.round(window.scrollY), inner: `${innerWidth}x${innerHeight}`, visible: document.visibilityState };
      }, '.ba-filters a.ba-chip').catch((err: unknown) => ({ failed: String(err) }));
      info.annotations.push({ type: 'home-chip-diagnosis', description: JSON.stringify(diag) });
      // a runner that draws no frames at all (WebKitGTK with no GPU: requestAnimationFrame does not fire) cannot show a click that the page has settled; the Safari engine on macOS answers for this flow
      if (typeof diag === 'object' && 'framesInASecond' in diag && diag.framesInASecond <= 1) test.skip(true, 'this runner draws no frames (a WebKit with no GPU): a click waits for the page to settle in vain; the macOS Safari engine answers for this flow');
      else throw e;
    }
    await expect(page).toHaveURL(/\/workouts\/[a-z]+\/$/);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker), 'the page was not reloaded').toBe(1);
    expect(await page.locator('a.ba-tile').count()).toBeGreaterThan(0);
    await shot(page, info, 'home-region');
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    // a mode chip (seated) keeps its state
    const seated = page.locator('button[data-mode="seated"]');
    await seated.click();
    await expect(seated).toHaveAttribute('aria-pressed', 'true');
    await seated.click();
    // a tile opens the game page
    await page.locator('a.ba-tile').first().click();
    await expect(page).toHaveURL(/\/games\/[a-z-]+\/$/);
    await expect(page.locator('h1')).toBeVisible();
    await settle(page);
    expect(await problemsOfLayout(page), 'layout of the game page').toEqual([]);
    await shot(page, info, 'game-page');
    expect(w.errors).toEqual([]);
  });

  test('welcome: the tour from its first page to the last', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    await page.goto(`${DEMO_URL}/welcome/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-welcome][data-ready="1"]', { timeout: 45_000 });
    await settle(page);
    const stage = await page.evaluate(() => ({ fallback: document.querySelector('.ob-stage')?.classList.contains('is-fallback') === true, canvas: !!document.querySelector('canvas[data-canvas]') }));
    info.annotations.push({ type: 'stage', description: stage.fallback ? 'pre-rendered pictures (the 3D stage stepped down)' : '3D stage' });
    if (!stage.fallback) {
      const rep = await look(page.locator('canvas[data-canvas]'));
      expect(rep.blank, `the 3D stage drew nothing (${rep.flatColour} over ${(rep.flatShare * 100).toFixed(1)} % of it)`).toBe(false);
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await problemsOfLayout(page), 'layout, step 1').toEqual([]);
    await shot(page, info, 'welcome-1');
    await page.getByRole('button', { name: 'Start' }).click();
    for (const n of [2, 3, 4, 5]) {
      await expect(page).toHaveURL(new RegExp(`/welcome/\\?step=${n}`));
      await expect(page.locator('.ob-progress span')).toHaveText(`Step ${n} of 7`);
      await settle(page);
      expect(await problemsOfLayout(page), `layout, step ${n}`).toEqual([]);
      await shot(page, info, `welcome-${n}`);
      if (n < 5) await page.getByRole('button', { name: n === 4 ? 'I have the space' : 'Next' }).click();
    }
    // the browser's own Back goes one page back
    await page.goBack();
    await expect(page).toHaveURL(/step=4/);
    expect(w.errors).toEqual([]);
  });

  test('welcome: the pictures that stand in for the 3D stage play (the loop is a video)', async ({ page, browserName }, info) => {
    const w = watch(page);
    await withHooks(page, { keyboard: true, tour: 'fallback' });
    await page.goto(`${DEMO_URL}/welcome/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-welcome][data-ready="1"]', { timeout: 45_000 });
    await expect(page.locator('.ob-stage')).toHaveClass(/is-fallback/);
    const loop = page.locator('video[data-loop]');
    await expect(loop).toBeVisible();
    const codecs = await page.evaluate(() => ['video/mp4; codecs="avc1.42E01E"', 'video/webm; codecs="vp8"', 'video/webm; codecs="vp9"'].map((t) => document.createElement('video').canPlayType(t)));
    test.skip(codecs.every((c) => c === ''), 'this engine build has no video codec at all (Playwright\'s WebKit for Windows), so no loop can play here');
    // the same build may answer "maybe" to a codec it cannot decode (canPlayType is a guess and the video's readyState stays 0): the Safari engine on macOS answers for Safari
    test.skip(process.platform === 'win32' && browserName === 'webkit', 'Playwright\'s WebKit for Windows lists codecs it cannot decode, the loop gets no picture there; the macOS runner has the real Safari engine');
    // a video that plays on this engine: it has a picture and its time moves (Safari plays a muted inline video, and only from a server that answers byte ranges)
    await expect.poll(() => loop.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000, message: 'the loop never got a picture (video.readyState)' }).toBeGreaterThanOrEqual(2);
    const t0 = await loop.evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.waitForTimeout(1200);
    const t1 = await loop.evaluate((v: HTMLVideoElement) => v.currentTime);
    info.annotations.push({ type: 'loop', description: `currentTime ${t0.toFixed(2)} -> ${t1.toFixed(2)}, src ${await loop.evaluate((v: HTMLVideoElement) => v.currentSrc.split('/').pop())}` });
    expect(t1, 'the loop video plays').toBeGreaterThan(t0);
    await shot(page, info, 'welcome-fallback');
    await page.getByRole('button', { name: 'Start' }).click();
    const still = page.locator('img[data-poster]');
    await expect(still).toBeVisible();
    await expect.poll(() => still.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 100)).toBe(true);
    expect(w.errors).toEqual([]);
  });

  test('camera: the explainer, the calibration on a person, the countdown and a running round, then the camera is let go', async ({ page, context }, info) => {
    await cameraRoundFlow(page, context, info);
  });

  test('camera: the same round with the pose service forced onto the CPU delegate (what Firefox runs by itself)', async ({ page, context, browserName }, info) => {
    test.skip(browserName !== 'firefox', 'only Firefox has the problem this variant isolates (its GPU delegate stalls); Chromium and Safari run the GPU on a real GPU');
    await cameraRoundFlow(page, context, info, { cpuPose: true });
  });

  test('camera: the tour\'s last page hands over to the real first game (the first win)', async ({ page, context }, info) => {
    test.setTimeout(240_000);
    const w = watch(page);
    await installPersonCamera(context, { file: FIXTURE, portrait: isPhone(page) });
    await withHooks(page, { tour: 'static' });
    const seen: string[] = [];
    await page.goto(`${DEMO_URL}/welcome/?step=5`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-welcome][data-ready="1"]', { timeout: 45_000 });
    test.skip(!(await cameraUsable(page)), 'this engine has no camera API, or cannot play a stream made from a canvas (the page-side camera): see the tests "camera: where the engine has no camera API" and the engine probe');
    try {
      await shot(page, info, 'first-win-camera-page');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL(/\/play\/squat-flap\//, { timeout: 30_000 });
      await passExplainer(page);
      await until(page, 'calibrating', 60_000, seen);
      await until(page, 'countdown', 90_000, seen);
      await until(page, 'running', 60_000, seen);
      await shot(page, info, 'first-win-round');
      // the first win is thirty seconds; it ends by itself
      await until(page, 'results', 90_000, seen);
      await expect(page.locator('h1')).toBeVisible();
      await shot(page, info, 'first-win-results');
    } finally {
      info.annotations.push({ type: 'phases', description: seen.join(' > ') });
      await noteCamera(page, info);
    }
    expect(w.errors).toEqual([]);
  });

  test('camera: where the engine has no camera API the app says so in words and leaves a way out', async ({ page }, info) => {
    const w = watch(page);
    await page.goto(`${DEMO_URL}/play/squat-flap/?input=camera`, { waitUntil: 'networkidle' });
    test.skip(await hasCameraApi(page), 'this engine has a camera API: the camera flows run instead');
    // Two kinds of game. Squat Flap has other ways to play (keys on a laptop, touch on a phone: a round without the camera is practice): the round may
    // go on at once, or the explainer / the panel says so. Star Catch is a mirror game: on a phone it has nothing else to be played with, so it has to say
    // in words that the camera cannot be had and leave a way out (Back, Try again).
    for (const [slug, mirror] of [['squat-flap', false], ['star-catch', true]] as const) {
      if (slug !== 'squat-flap') await page.goto(`${DEMO_URL}/play/${slug}/?input=camera`, { waitUntil: 'networkidle' });
      // the HUD is looked for where it can be seen (a hidden one behind a panel is not a round)
      await page.waitForSelector('[data-action="camera-continue"], #ov-title:visible, [data-hud-root] [data-hud]:visible', { timeout: 30_000 });
      if ((await page.locator('[data-action="camera-continue"]').count()) === 0 && (await page.locator('#ov-title:visible').count()) === 0) {
        info.annotations.push({ type: 'panel', description: `${slug}: no camera API, the round went on without the camera` });
        await shot(page, info, `camera-unsupported-${slug}-round`);
        expect(mirror && isPhone(page), `${slug} is a mirror game: a phone has nothing but the camera to play it with, so it has to say so in words`).toBe(false);
        continue;
      }
      if ((await page.locator('[data-action="camera-continue"]').count()) > 0) await page.locator('[data-action="camera-continue"]').click();
      await page.waitForSelector('#ov-title', { timeout: 30_000 });
      await settle(page);
      const panel = await page.evaluate(() => ({ title: document.querySelector('#ov-title')?.textContent?.trim() ?? '', alert: (document.querySelector('.ba-explain [role=alert]')?.textContent ?? '').trim(), buttons: [...document.querySelectorAll('.ba-explain button, .ba-explain a')].map((b) => (b.textContent ?? '').trim()).filter(Boolean) }));
      info.annotations.push({ type: 'panel', description: `${slug}: ${panel.title} | ${panel.alert} | ${panel.buttons.join(' / ')}` });
      await shot(page, info, `camera-unsupported-${slug}`);
      expect(panel.alert.length, `${slug}: the panel says why in words`).toBeGreaterThan(10);
      expect(panel.buttons.length, `${slug}: the panel has a way out`).toBeGreaterThan(0);
    }
    expect(w.errors).toEqual([]);
  });

  test('a round with the keyboard on a 2D game: the scene draws, the keys play, pause and leave work', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    await page.goto(`${DEMO_URL}/play/squat-flap/?input=keyboard`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
    await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60_000 });
    // Squat Flap holds its clock at the full round until the first squat (its warm-up): the keys squat, and the HUD stays whole.
    for (const k of ['ArrowDown', 'ArrowUp', 'Space', 'ArrowDown', 'ArrowUp']) { await page.keyboard.press(k); await page.waitForTimeout(400); }
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-ref="score"]').first()).toBeVisible();
    expect(await playProblems(page), 'the HUD of the round').toEqual([]);
    const scene = await look(page.locator('[data-scene] canvas').first());
    expect(scene.blank, `nothing is drawn in the game scene (${scene.flatColour})`).toBe(false);
    await shot(page, info, 'round-2d');
    await leaveRound(page);
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    expect(await page.locator('canvas').count(), 'the scene is released').toBe(0);
    expect(w.errors).toEqual([]);
  });

  test('sound: the tap on Play unlocks the audio of the page and it runs (Safari starts every audio context suspended)', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    // every audio context the page makes is remembered, so the test can look at what state it ends up in
    await page.addInitScript(() => {
      const made: AudioContext[] = [];
      (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts = made;
      for (const key of ['AudioContext', 'webkitAudioContext'] as const) {
        const Base = (window as unknown as Record<string, new (...a: unknown[]) => AudioContext>)[key];
        if (!Base) continue;
        (window as unknown as Record<string, unknown>)[key] = class extends Base { constructor(...a: unknown[]) { super(...a); made.push(this as unknown as AudioContext); } };
      }
    });
    await page.goto(`${DEMO_URL}/games/squat-flap/`, { waitUntil: 'networkidle' });
    const hasAudio = await page.evaluate(() => typeof AudioContext !== 'undefined' || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');
    test.skip(!hasAudio, 'this engine has no Web Audio at all (the WebKit build of Playwright for Windows): the page plays without sound, which the round flows check');
    // a machine with no sound device keeps even a bare audio context suspended (Firefox on GitHub's Linux runner: the same tap runs it on macOS)
    const probe = await page.context().newPage();
    const machineHasAudio = await audioStarts(probe).finally(() => probe.close());
    info.annotations.push({ type: 'audio-device', description: String(machineHasAudio) });
    test.skip(!machineHasAudio, 'this machine cannot start an audio context at all (no sound device): the tool cannot tell whether the app unlocks its sound here');
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const states = await page.evaluate(() => (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts.map((c) => c.state));
    info.annotations.push({ type: 'audio', description: `contexts: ${states.join(', ') || 'none'}` });
    expect(states.length, 'the page made an audio context for its sound').toBeGreaterThan(0);
    expect(states, 'the tap on Play unlocked it').toContain('running');
    expect(w.errors).toEqual([]);
  });

  test('a round with the keyboard on the 3D game (Road Run): WebGL draws, the keys steer, pause and leave work', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    await page.goto(`${DEMO_URL}/play/road-run/?input=keyboard`, { waitUntil: 'networkidle' });
    const webgl = await page.evaluate(() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } });
    info.annotations.push({ type: 'webgl2', description: String(webgl) });
    if (!webgl) {
      // a machine that cannot draw 3D (a headless Firefox on Linux without a software GL): the game says so in words and leaves a way out
      await page.waitForSelector('#ov-title', { timeout: 60_000 });
      const panel = await page.evaluate(() => ({ alert: (document.querySelector('.ba-explain [role=alert], dialog [role=alert]')?.textContent ?? '').trim(), buttons: [...document.querySelectorAll('.ba-explain button, .ba-explain a')].map((b) => (b.textContent ?? '').trim()).filter(Boolean) }));
      info.annotations.push({ type: 'panel', description: `${panel.alert} | ${panel.buttons.join(' / ')}` });
      await shot(page, info, 'round-3d-no-webgl');
      expect(panel.alert.length, 'the panel says why in words').toBeGreaterThan(10);
      expect(panel.buttons.length, 'the panel has a way out').toBeGreaterThan(0);
      return;
    }
    await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 90_000 });
    await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60_000 });
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']) { await page.keyboard.press(k); await page.waitForTimeout(250); }
    await page.waitForTimeout(1500);
    expect(await playProblems(page), 'the HUD of the round').toEqual([]);
    const scene = await look(page.locator('[data-scene] canvas').first());
    expect(scene.blank, `nothing is drawn in the 3D scene (${scene.flatColour} over ${(scene.flatShare * 100).toFixed(1)} %)`).toBe(false);
    await shot(page, info, 'round-3d');
    await leaveRound(page);
    await expect(page).toHaveURL(/\/games\/road-run\/$/);
    expect(w.errors).toEqual([]);
  });

  test('results: a round ends in its results, with the record and the ways on', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, FAST);
    await page.goto(`${DEMO_URL}/play/knee-sprint/?input=keyboard`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 60_000 });
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.k-score .n')).not.toHaveText('');
    await settle(page);
    expect(await problemsOfLayout(page), 'layout of the results').toEqual([]);
    await shot(page, info, 'results');
    await page.getByRole('link', { name: 'Play again' }).click();
    await expect(page).toHaveURL(/\/play\/knee-sprint\//);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 60_000 });
    expect(w.errors).toEqual([]);
  });

  test('results: the highlight clip is a real video that plays (what this engine\'s recorder made)', async ({ page }, info) => {
    const w = watch(page);
    // a round long enough to keep a clip (the recorder needs three seconds of play; the hooks run the clock forty times faster)
    await withHooks(page, { timeScale: 40, roundSeconds: 200, forceDemo: true, keyboard: true });
    // what the page hands to the share sheet (the sheet itself is the platform's: here it answers at once)
    await page.addInitScript(() => {
      const shared: { files: number; type: string }[] = [];
      (window as unknown as { __shared: typeof shared }).__shared = shared;
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (typeof nav.share === 'function') nav.share = (d: ShareData): Promise<void> => { shared.push({ files: d.files?.length ?? 0, type: d.files?.[0]?.type ?? '' }); return Promise.resolve(); };
    });
    await page.goto(`${DEMO_URL}/play/knee-sprint/?input=keyboard`, { waitUntil: 'networkidle' });
    const recorder = await page.evaluate(() => typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === 'function');
    test.skip(!recorder, 'this engine has no MediaRecorder (Playwright\'s WebKit for Windows): the results carry no clip here, which the app handles by leaving the card out');
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 90_000 });
    await settle(page);
    const card = page.locator('[data-clip]');
    if ((await card.count()) === 0) {
      // the recorder is there but made nothing (an encoder that failed): the app says nothing and the round is not hurt; the table notes it
      info.annotations.push({ type: 'clip', description: 'the engine has a recorder and the results carry no clip card' });
      expect(w.errors).toEqual([]);
      return;
    }
    const video = card.locator('video');
    const read = (): Promise<{ error: number | null; ready: number; w: number; h: number; duration: number; src: string }> =>
      video.evaluate((v: HTMLVideoElement) => ({ error: v.error?.code ?? null, ready: v.readyState, w: v.videoWidth, h: v.videoHeight, duration: v.duration, src: v.currentSrc.slice(0, 5) }));
    await expect.poll(async () => { const s = await read(); return s.error !== null || s.ready >= 1; }, { timeout: 15_000, message: 'the clip got no metadata and no error either' }).toBe(true);
    let state = await read();
    info.annotations.push({ type: 'clip', description: JSON.stringify(state) });
    await shot(page, info, 'results-clip', { locator: card });
    expect(state.error, 'the clip of this engine\'s own recorder cannot be played by the same engine').toBeNull();
    expect(state.w, 'the clip has a picture size').toBeGreaterThan(0);
    // 300 by 150 is the size of a canvas nobody has sized yet: a clip that small, shared to a phone's feed, is a blur (the stage canvas was read before its kit gave it its size)
    expect(`${state.w}x${state.h}`, 'the clip has the size of the game view, not the default size of a canvas').not.toBe('300x150');
    expect(Math.max(state.w, state.h), 'the long edge of the clip, in pixels').toBeGreaterThanOrEqual(480);
    // Share: the share sheet takes the file where the browser has one for files, anywhere else the clip is saved and the player is told (never silence)
    const downloaded = page.waitForEvent('download', { timeout: 6000 }).then(() => true, () => false);
    await card.locator('[data-action="clip-share"]').click();
    const saved = await downloaded;
    const sheet = await page.evaluate(() => (window as unknown as { __shared?: { files: number; type: string }[] }).__shared ?? []);
    info.annotations.push({ type: 'clip-share', description: saved ? 'saved as a download' : sheet.length > 0 ? `handed to the share sheet: ${JSON.stringify(sheet[0])}` : 'nothing happened' });
    expect(saved || sheet.length > 0, 'Share does something: the share sheet or a saved file').toBe(true);
    if (saved) await expect(page.getByText(/saved to your downloads|indirilenlere kaydedildi/i).last(), 'the player is told it was saved (the toast, after the hidden live region that reads it out)').toBeVisible();
    else expect(sheet[0]?.files, 'the share sheet got the clip as a file').toBe(1);
    // can this machine play what its own recorder made? (a virtual machine without a media engine cannot: the table says so, and it is not the app's to fail)
    const decodes = await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play().catch(() => undefined);
      const t0 = performance.now();
      while (performance.now() - t0 < 6000 && v.readyState < 2) await new Promise<void>((res) => window.setTimeout(res, 100));
      return v.readyState >= 2;
    });
    info.annotations.push({ type: 'clip-decodes', description: String(decodes) });
    test.skip(!decodes, 'this machine cannot decode the clip its own recorder made (readyState stays at metadata after play): a macOS runner without a media engine does that; the share button and the size were checked');
    // what is in the picture: a frame half a second in, shrunk, and how much of it is black (the game view is a sky, a track, a ball; a clip of nothing but
    // the score plates over black is a recorder that took a canvas with no picture in it)
    const blackShare = await video.evaluate(async (v: HTMLVideoElement) => {
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
    info.annotations.push({ type: 'clip-black-share', description: blackShare.toFixed(2) });
    expect(blackShare, 'the clip shows the game view, not black with the score plates over it').toBeLessThan(0.85);
    // it plays: muted and inline, the time moves (the player taps play)
    await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play().catch(() => undefined); });
    await expect.poll(async () => (await video.evaluate((v: HTMLVideoElement) => v.currentTime)), { timeout: 10_000, message: 'the clip does not move when played' }).toBeGreaterThan(0.05);
    state = await read();
    expect(state.error, 'the clip failed while playing').toBeNull();
    expect(w.errors).toEqual([]);
  });

  test('results: a mirror game makes no clip (the camera picture is drawn in its game view and is never recorded)', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { timeScale: 40, roundSeconds: 200, forceDemo: true, keyboard: true });
    await page.goto(`${DEMO_URL}/play/star-catch/?input=keyboard`, { waitUntil: 'networkidle' });
    const recorder = await page.evaluate(() => typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === 'function');
    test.skip(!recorder, 'this engine has no MediaRecorder: no game makes a clip here');
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 90_000 });
    await settle(page);
    info.annotations.push({ type: 'clip-cards', description: String(await page.locator('[data-clip]').count()) });
    await expect(page.locator('[data-clip]'), 'a mirror game has no clip card').toHaveCount(0);
    expect(await page.locator('video').count(), 'no video on the results of a mirror game').toBe(0);
    expect(w.errors).toEqual([]);
  });

  test('plans: the page of plans and the free desk break from its first game on', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { timeScale: 40, roundSeconds: 120, forceDemo: true, keyboard: true });
    await page.addInitScript(() => { localStorage.setItem('ba2.shell.cameraExplained', JSON.stringify({ v: 1, d: true })); });
    await page.goto(`${DEMO_URL}/plans/`, { waitUntil: 'networkidle' });
    await settle(page);
    await expect(page.locator('.k-plancard')).toHaveCount(5);
    expect(await problemsOfLayout(page), 'layout of the plans').toEqual([]);
    await shot(page, info, 'plans');
    await page.locator('[data-action="plan-start"]').first().click();
    await expect(page).toHaveURL(/\/play\/[a-z-]+\/\?.*plan=1/);
    await passExplainer(page);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 60_000 });
    await expect(page.locator('[data-plan-panel="next"]')).toBeVisible();
    await settle(page);
    await shot(page, info, 'plans-next');
    expect(w.errors).toEqual([]);
  });

  test('paywall: the offer, the plans switch the button, nothing is bought', async ({ page }, info) => {
    const w = watch(page);
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __opened: string[] }).__opened = opened;
      window.open = ((u: string) => { opened.push(u); return null; }) as typeof window.open;
    });
    await page.goto(`${DEMO_URL}/pro/`, { waitUntil: 'networkidle' });
    await settle(page);
    const plans = page.locator('input[name="plan"]');
    expect(await plans.count(), 'plans offered').toBeGreaterThanOrEqual(3);
    expect(await problemsOfLayout(page), 'layout of the paywall').toEqual([]);
    await shot(page, info, 'paywall');
    const buy = page.locator('button[data-action="buy"]');
    const first = (await buy.textContent())?.trim();
    // picking another plan moves the selection and the button follows it (a trial is offered on the yearly plan only)
    const labels = page.locator('label.k-plan');
    const n = await labels.count();
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) { await labels.nth(i).click(); await expect(plans.nth(i)).toBeChecked(); seen.add(((await buy.textContent()) ?? '').trim()); }
    expect(seen.size, `the button follows the plan (${first} / ${[...seen].join(' / ')})`).toBeGreaterThan(1);
    await page.locator('a[data-action="close-paywall"]').first().click();
    await expect(page).toHaveURL(/\/$/);
    // nothing was opened: no checkout was started
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([]);
    // a locked game opens the same offer on the way
    await page.goto(`${DEMO_URL}/pro/?game=pad-work`, { waitUntil: 'networkidle' });
    await settle(page);
    await shot(page, info, 'paywall-locked');
    expect(await problemsOfLayout(page), 'layout of the paywall for a locked game').toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('paywall: on a phone held sideways no plan card sits under the action bar', async ({ page }, info) => {
    const w = watch(page);
    // 915 by 412: two columns (900 px and wider) on a screen that is short. A sticky bar of the right column escapes its grid cell in Firefox and WebKit and lies on the plans.
    await page.setViewportSize({ width: 915, height: 412 });
    await page.goto(`${DEMO_URL}/pro/`, { waitUntil: 'networkidle' });
    await settle(page);
    await shot(page, info, 'paywall-sideways');
    const hidden = await page.evaluate(() => {
      const bar = document.querySelector('.k-actionbar');
      if (!bar) return ['no action bar'];
      const b = bar.getBoundingClientRect();
      const out: string[] = [];
      for (const plan of document.querySelectorAll('.k-plan')) {
        const r = plan.getBoundingClientRect();
        const w2 = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        const h2 = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        if (w2 > 4 && h2 > 4) out.push(`${(plan.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}: ${Math.round(w2)}x${Math.round(h2)} px under the bar`);
      }
      return out;
    });
    expect(hidden, 'plan cards under the action bar').toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('family: the players screen, a player added, a child chosen and the parent gate', async ({ page }, info) => {
    const w = watch(page);
    const hooks: Hooks = { ...FAST, plan: 'family', players: [{ name: 'Defne', kid: true, avatar: 'fox' }, { name: 'Mert', avatar: 'robot' }, { name: 'Elif', avatar: 'rocket' }] };
    await withHooks(page, hooks);
    await page.goto(`${DEMO_URL}/profiles/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main h1', { timeout: 15_000 });
    await settle(page);
    expect(await problemsOfLayout(page), 'layout of the players screen').toEqual([]);
    await shot(page, info, 'family-list');
    // a player is added through the form
    await page.locator('[data-action="profile-add"]').first().click();
    await page.waitForSelector('form[data-form="profile"]', { timeout: 10_000 });
    await page.locator('#pf-name').fill('Selin');
    await shot(page, info, 'family-add');
    await page.getByRole('button', { name: 'Add player' }).click();
    await expect(page.getByText('Selin').first()).toBeVisible();
    // a name that is taken is refused at the field
    await page.locator('[data-action="profile-add"]').first().click();
    await page.locator('#pf-name').fill('Selin');
    await page.getByRole('button', { name: 'Add player' }).click();
    await expect(page.locator('#pf-name')).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Escape');
    await settle(page);
    await shot(page, info, 'family-error');
    expect(w.errors).toEqual([]);
  });

  test('family: a child is chosen with a tap, the main player only through the parent gate (a dialog with a sum)', async ({ page }, info) => {
    const w = watch(page);
    const hooks: Hooks = { ...FAST, plan: 'family', players: [{ name: 'Defne', kid: true, avatar: 'fox' }, { name: 'Mert', avatar: 'robot' }] };
    await withHooks(page, hooks);
    await page.goto(`${DEMO_URL}/profiles/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main h1', { timeout: 15_000 });
    await page.getByRole('button', { name: /^Defne\b/ }).click();
    await page.waitForURL(`${DEMO_URL}/`);
    await expect(page.locator('.pf-switch').first()).toHaveAttribute('aria-label', 'Playing as Defne. Switch player');
    await settle(page);
    expect(await problemsOfLayout(page), 'layout of the home page of a child').toEqual([]);
    await shot(page, info, 'family-kid-home');
    if (isPhone(page)) {
      // a phone has the tab bar and no top bar: the way to the players is the row in the settings
      await page.goto(`${DEMO_URL}/settings/`, { waitUntil: 'networkidle' });
      await page.locator('main a[href*="/profiles/"]').first().click();
    } else await page.locator('.pf-switch').first().click();
    await page.waitForURL(/\/profiles\//);
    await page.getByRole('button', { name: /^Me\b/ }).click();
    const gate = page.locator('dialog.pf-gatebox');
    await expect(gate).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#gate-answer')).toBeFocused();
    await settle(page);
    expect(await problemsOfLayout(page), 'layout with the parent gate open').toEqual([]);
    await shot(page, info, 'family-gate', { full: false });
    const text = await page.locator('.pf-sum').innerText();
    const m = /(\d+)\s*×\s*(\d+)/.exec(text);
    if (!m) throw new Error(`no sum in the gate: "${text}"`);
    await page.locator('#gate-answer').fill(String(Number(m[1]) * Number(m[2])));
    await page.getByRole('button', { name: 'Go on' }).click();
    await expect(gate).toHaveCount(0);
    await page.waitForURL(`${DEMO_URL}/`);
    await expect(page.locator('.pf-switch').first()).toHaveAttribute('aria-label', 'Playing as Me. Switch player');
    expect(w.errors).toEqual([]);
  });

  test('two players on one camera (big screens): both stand in view, the calibration finds both, the round has a plate for each', async ({ page, context }, info) => {
    test.skip(isPhone(page), 'two players on one camera is offered on big screens only (a phone is not offered the choice: see the next test)');
    test.setTimeout(240_000);
    const w = watch(page);
    await installPersonCamera(context, { file: TWO_FIXTURE });
    const seen: string[] = [];
    await page.goto(`${DEMO_URL}/games/squat-flap/`, { waitUntil: 'networkidle' });
    test.skip(!(await cameraUsable(page)), 'this engine has no camera API, or cannot play a stream made from a canvas');
    await expect(page.locator('input[name="players"]')).toHaveCount(2);
    await page.locator('label:has(input[name="players"][value="2"])').click();
    await shot(page, info, 'two-setup');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/players=2/);
    try {
      await until(page, 'explainer', 30_000, seen);
      await page.locator('[data-action="camera-continue"]').click();
      await until(page, 'calibrating', 60_000, seen);
      await shot(page, info, 'two-calibrating');
      await until(page, 'countdown', 120_000, seen);
      await until(page, 'running', 60_000, seen);
      await page.waitForTimeout(2000);
      await shot(page, info, 'two-round');
      for (const slot of ['statusP1', 'statusP2', 'timer']) await expect(page.locator(`[data-hud="${slot}"]`)).toBeVisible();
      expect(await playProblems(page), 'the HUD of the two player round').toEqual([]);
      const scene = await look(page.locator('[data-scene] canvas').first());
      expect(scene.blank, `nothing is drawn in the game scene (${scene.flatColour})`).toBe(false);
    } finally {
      info.annotations.push({ type: 'phases', description: seen.join(' > ') });
    }
    expect(w.errors).toEqual([]);
  });

  test('two players: a phone is not offered the choice, and an address that asks for two plays one', async ({ page }, info) => {
    test.skip(!isPhone(page), 'the choice exists on big screens (see the test above)');
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    await page.goto(`${DEMO_URL}/games/squat-flap/`, { waitUntil: 'networkidle' });
    await expect(page.locator('input[name="players"]')).toHaveCount(0);
    await page.goto(`${DEMO_URL}/play/squat-flap/?players=2&input=keyboard`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
    await expect(page.locator('[data-hud="statusP2"]')).toHaveCount(0);
    await expect(page.locator('[data-hud="statusLeft"]')).toBeVisible();
    await shot(page, info, 'two-on-phone');
    expect(w.errors).toEqual([]);
  });

  test('turkish: the main pages keep the layout rule (longer words) and say they are Turkish', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { ...FAST, plan: 'family', players: [{ name: 'Defne', kid: true, avatar: 'fox' }, { name: 'Mert', avatar: 'robot' }] });
    const pages: [string, string][] = [['home', '/tr/'], ['game', '/tr/games/squat-flap/'], ['plans', '/tr/plans/'], ['pro', '/tr/pro/'], ['settings', '/tr/settings/'], ['players', '/tr/profiles/'], ['friends', '/tr/friends/?social=1'], ['tour', '/tr/welcome/?step=3']];
    const found: string[] = [];
    for (const [id, path] of pages) {
      await page.goto(`${DEMO_URL}${path}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('main h1, [data-welcome] h1', { timeout: 30_000 });
      await settle(page);
      if ((await page.locator('html').getAttribute('lang')) !== 'tr') found.push(`${id}: html lang is not tr`);
      for (const p of await problemsOfLayout(page)) found.push(`${id}: ${p}`);
      await shot(page, info, `tr-${id}`);
    }
    expect(found, 'layout problems of the Turkish pages').toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('a round can be paused, resumed and left (Escape, the pause button, a hidden tab, the browser Back button)', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    const inRound = async (): Promise<void> => {
      await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
      await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60_000 });
    };
    // from the game page, as a player comes (the Back button at the end has to land in the app, not before it)
    await page.goto(`${DEMO_URL}/games/squat-flap/`, { waitUntil: 'networkidle' });
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await inRound();
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await page.keyboard.press('Escape');
    await expect(paused).toBeVisible();
    await shot(page, info, 'pause', { full: false });
    await expect(paused.getByRole('button', { name: 'Resume' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(paused).toHaveCount(0);
    await page.keyboard.press('Escape');
    await paused.getByRole('button', { name: 'Leave round' }).click();
    const confirm = page.getByRole('dialog', { name: 'Leave this round?' });
    await expect(confirm).toBeVisible();
    await page.getByRole('button', { name: 'Keep playing' }).click();
    await expect(confirm).toBeHidden();
    await expect(paused).toBeVisible();
    await paused.getByRole('button', { name: 'Resume' }).click();
    // the pause button of the HUD, then a hidden tab
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(paused).toContainText('You paused the round.');
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(paused).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(paused).toContainText('The tab was hidden, so the round paused.');
    await page.evaluate(() => { delete (document as unknown as { hidden?: boolean }).hidden; document.dispatchEvent(new Event('visibilitychange')); });
    // the browser's Back button is a way out that asks first
    await page.goBack();
    await expect(page.getByRole('dialog', { name: /Leave this round\?|Paused/ }).first()).toBeVisible();
    await shot(page, info, 'back-asks', { full: false });
    expect(w.errors).toEqual([]);
  });

  test('rotating the phone during a round: the HUD and the scene follow, both ways', async ({ page }, info) => {
    test.skip(!isPhone(page), 'a phone is turned; the desktop windows are resized by the other flows');
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    await page.goto(`${DEMO_URL}/play/squat-flap/?input=keyboard`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
    await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60_000 });
    const upright = page.viewportSize() as { width: number; height: number };
    for (const [name, size] of [['sideways', { width: upright.height, height: upright.width }], ['upright again', upright]] as const) {
      await page.setViewportSize(size);
      await page.waitForTimeout(900);
      expect(await playProblems(page), `the HUD of the round, ${name}`).toEqual([]);
      const scene = await look(page.locator('[data-scene] canvas').first());
      expect(scene.blank, `nothing is drawn in the scene, ${name} (${scene.flatColour})`).toBe(false);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
      expect(wide, `no sideways scroll, ${name}`).toBe(true);
      await shot(page, info, `rotated-${name.replace(' ', '-')}`, { full: false });
    }
    expect(w.errors).toEqual([]);
  });

  test('dark theme: the main pages keep the layout rule', async ({ page }, info) => {
    const w = watch(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    const pages: [string, string][] = [['home', '/'], ['game', '/games/squat-flap/'], ['plans', '/plans/'], ['pro', '/pro/'], ['settings', '/settings/'], ['friends', '/friends/?social=1']];
    const found: string[] = [];
    for (const [id, path] of pages) {
      await page.goto(`${DEMO_URL}${path}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('main h1', { timeout: 30_000 });
      await settle(page);
      for (const p of await problemsOfLayout(page)) found.push(`${id}: ${p}`);
      await shot(page, info, `dark-${id}`);
    }
    expect(found, 'layout problems of the dark pages').toEqual([]);
    expect(w.errors).toEqual([]);
  });

  for (const [id, path] of [
    ['friends', '/friends/?social=1'], ['friends-new', '/friends/?social=fresh'], ['profile', '/friends/?view=profile&social=1'], ['boards', '/friends/?view=boards&social=1'],
    ['lobbies', '/lobbies/?social=1'], ['room', '/r/K7Q2MX/?social=1'], ['friend-link', '/f/BA-9PXMR3/?social=1'], ['safety', '/safety/?social=1'],
  ] as const) {
    test(`social (demo): ${id}`, async ({ page }, info) => {
      const w = watch(page, [/WebSocket|socket/i]);
      await withHooks(page, { keyboard: true });
      await page.goto(`${DEMO_URL}${path}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('main h1', { timeout: 20_000 });
      await settle(page);
      expect(await problemsOfLayout(page), `layout of ${path}`).toEqual([]);
      await shot(page, info, `social-${id}`);
      expect(w.errors).toEqual([]);
    });
  }

  test('social (demo): the sign-up window opens and closes, a room is made', async ({ page }, info) => {
    const w = watch(page);
    await withHooks(page, { keyboard: true });
    await page.goto(`${DEMO_URL}/friends/?social=fresh`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main h1', { timeout: 20_000 });
    await page.locator('[data-action="social.profile"]').first().click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await settle(page);
    expect(await problemsOfLayout(page), 'layout with the sign-up window open').toEqual([]);
    await shot(page, info, 'social-sheet', { full: false });
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.goto(`${DEMO_URL}/friends/?social=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main h1', { timeout: 20_000 });
    await page.locator('[data-action="room.new"]').first().click();
    await page.waitForURL(/\/r\//, { timeout: 15_000 });
    await page.waitForSelector('main h1', { timeout: 15_000 });
    await settle(page);
    await shot(page, info, 'social-room-host');
    expect(w.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
test.describe('the release build (content pages, service worker)', () => {
  test('release build with its production headers: a round on the camera (no test hooks, Content-Security-Policy as shipped)', async ({ page, context }, info) => {
    await cameraRoundFlow(page, context, info, { base: RELEASE_URL });
  });

  for (const [id, path, lang] of [
    ['privacy-en', '/privacy', 'en'], ['terms-en', '/terms', 'en'], ['faq-en', '/faq', 'en'],
    ['privacy-tr', '/tr/privacy', 'tr'], ['terms-tr', '/tr/terms', 'tr'], ['faq-tr', '/tr/faq', 'tr'],
  ] as const) {
    test(`legal: ${path}`, async ({ page }, info) => {
      const w = watch(page);
      const r = await page.goto(`${RELEASE_URL}${path}`, { waitUntil: 'networkidle' });
      expect(r?.status(), `HTTP status of ${path}`).toBe(200);
      await settle(page);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.lang)).toMatch(new RegExp(`^${lang}`));
      const body = await page.locator('body').innerText();
      if (lang === 'tr') expect(body, 'a Turkish page has Turkish letters').toMatch(/[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll').toBe(true);
      await shot(page, info, `legal-${id}`);
      expect(w.errors).toEqual([]);
    });
  }

  test('release: the real app opens (home, a game page), no hooks, no practice session', async ({ page }, info) => {
    const w = watch(page);
    await page.goto(`${RELEASE_URL}/`, { waitUntil: 'networkidle' });
    await settle(page);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.locator('a.ba-tile').count()).toBeGreaterThanOrEqual(11);
    expect(await page.evaluate(() => (window as unknown as { __BA__?: unknown }).__BA__), 'no test hook in the release').toBeUndefined();
    await shot(page, info, 'release-home');
    await page.goto(`${RELEASE_URL}/tr/`, { waitUntil: 'networkidle' });
    await settle(page);
    await expect(page.locator('html')).toHaveAttribute('lang', /^tr/);
    await shot(page, info, 'release-home-tr');
    expect(w.errors).toEqual([]);
  });

  test('service worker: installs, precaches the build and the app opens offline', async ({ page, context }, info) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await page.goto(`${RELEASE_URL}/version.json`);
    const stamp = JSON.parse(await page.locator('body').innerText()) as { build: string };
    await page.goto(`${RELEASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('ba-shell-')), null, { timeout: 60_000 });
    await expect.poll(() => page.evaluate(async () => {
      const name = (await caches.keys()).find((k) => k.startsWith('ba-shell-'));
      return name ? (await (await caches.open(name)).keys()).length : 0;
    }), { timeout: 60_000, message: 'the precache of the service worker' }).toBeGreaterThan(20);
    expect(await page.evaluate(() => caches.keys())).toContain(`ba-shell-${stamp.build}`);
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 30_000 }).catch(() => undefined);
    await page.reload({ waitUntil: 'networkidle' });
    await page.goto(`${RELEASE_URL}/games/road-run/`, { waitUntil: 'networkidle' });
    await expect(page.locator('main')).toBeVisible();
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator('main')).toBeVisible();
      info.annotations.push({ type: 'offline', description: `visited page: ${await page.title()}` });
      await shot(page, info, 'offline-visited');
      // a page that was never visited: the cached shell draws it
      await page.goto(`${RELEASE_URL}/games/star-catch/`);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('h1')).toBeVisible();
      await shot(page, info, 'offline-never-visited');
      await page.goto(`${RELEASE_URL}/`);
      await expect(page.locator('main')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
    expect(w.errors.filter((e) => !/offline|ERR_INTERNET_DISCONNECTED|NetworkError|Failed to fetch|WebKit encountered an internal error/i.test(e))).toEqual([]);
  });
});

