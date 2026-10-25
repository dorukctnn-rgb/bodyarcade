// A race between two friends in a room, through the real web shell, in two browsers (two devices) against the production Worker in
// Miniflare (the real room Durable Object judges the race): Ada makes a room from a game's page and copies its invitation link, Bo
// opens the link on his own device (the age first, then the seat), they greet each other, both press Ready, and the same race starts
// on both stages (one match, one seed: one course), each stage drawing the other (the tile with the skeleton and the points) and the
// Room's 3-2-1; the results show both players with the same places and points on both pages; then a rematch (the room's next race),
// the way back to the room, and a clean leave the other side sees. A second test reloads a stage in the middle of a race: the page
// joins the room again and races on in the same race, and both pages end with the same result.
//
// The players are the practice session of test builds (a body that is not there passes three obstacles in four by the race's own
// clock, and the friends see a stand-in figure that moves), so no camera is needed; everything else is the real thing.
// Engines: Chromium and Firefox. WebKit on Windows has no RTCPeerConnection and no MediaStream (a core-only build, see
// tests/live/engines.spec.ts); its row runs the race over the Room alone and is only run where BA_RACE_WEBKIT=1.
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npx playwright test -c tests/social/playwright.config.ts tests/e2e/social-ui-race.spec.ts --workers=1
import { chromium, expect, firefox, test, webkit, type Browser, type BrowserContext, type BrowserType, type LaunchOptions, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import { startStack, type Stack } from '../../packages/server/src/social/stack.ts';
import { baseLaunchOptions } from './support/browser.ts';
import { buildShell, inspect, online, ready, shot, signUp } from './social-ui-support.ts';

let dist = '';
let stack: Stack;
test.beforeAll(async () => { test.setTimeout(300_000); dist = await buildShell(); stack = await startStack({ assetsDir: dist }); });
test.afterAll(async () => { await stack?.stop().catch(() => undefined); if (dist) rmSync(dist, { recursive: true, force: true }); });

type EngineId = 'chromium' | 'firefox' | 'webkit';
interface Engine { id: EngineId; type: BrowserType; launch: LaunchOptions }

/** Firefox and WebKit start without Chromium's launch options (its headless shell, its camera flags); Firefox is told the camera is allowed. */
const ENGINES: readonly Engine[] = [
  { id: 'chromium', type: chromium, launch: { ...baseLaunchOptions, headless: true } },
  {
    id: 'firefox', type: firefox,
    launch: { headless: true, executablePath: undefined, args: [], firefoxUserPrefs: { 'permissions.default.camera': 1, 'media.navigator.permission.disabled': true, 'media.navigator.streams.fake': true } } as unknown as LaunchOptions,
  },
  { id: 'webkit', type: webkit, launch: { headless: true, executablePath: undefined, args: [] } as unknown as LaunchOptions },
];

/** A race of fifteen seconds (the shortest a room allows), the practice session as the player, its own clock five times faster. */
const HOOKS = { keyboard: true, forceDemo: true, timeScale: 5, raceSeconds: 15 };

interface Person { label: string; ctx: BrowserContext; page: Page; problems: string[] }

async function person(browser: Browser, e: Engine, label: string, o: { phone?: boolean } = {}): Promise<Person> {
  // a phone (a touch screen of 390 by 844) where the engine has phones: Chromium here
  const phone = o.phone === true && e.id === 'chromium';
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, locale: 'en-US',
    ...(phone ? { deviceScaleFactor: 2, hasTouch: true, isMobile: true } : {}),
    ...(e.id === 'chromium' ? { permissions: ['camera', 'clipboard-read', 'clipboard-write'] } : {}),
  });
  await ctx.addInitScript((x) => { (window as unknown as { __BA_TEST__: unknown }).__BA_TEST__ = x; }, HOOKS);
  // the camera was explained on this device before (the first round of a device shows what it is for; that panel is tested elsewhere)
  await ctx.addInitScript(() => { try { localStorage.setItem('ba2.shell.cameraExplained', JSON.stringify({ v: 1, d: true })); } catch { /* no storage */ } });
  // What the page copies is what the person pastes into a message to a friend: the test keeps it (Firefox and WebKit give a test no
  // way to read the clipboard back). The page's own copy goes on unchanged.
  await ctx.addInitScript(() => {
    const c = navigator.clipboard as (Clipboard & { writeText(t: string): Promise<void> }) | undefined;
    if (!c || typeof c.writeText !== 'function') return;
    const real = c.writeText.bind(c);
    c.writeText = (t: string) => { (window as unknown as { __copied: string }).__copied = String(t); return real(t); };
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`${label} pageerror: ${err.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // a failed load is an answer of the API; WebKit on Windows has no WebRTC and says so once per peer it cannot make
    if (/Failed to load resource/.test(text) || (e.id === 'webkit' && /RTCPeerConnection|MediaStream/.test(text))) return;
    problems.push(`${label} console: ${text}`);
  });
  return { label, ctx, page, problems };
}

async function go(p: Person, path: string): Promise<void> {
  await p.page.goto(`${stack.origin}${path}`);
  await p.page.waitForSelector('main h1, main h2', { timeout: 30_000 });
}

const roomCode = (url: string): string => /\/r\/([A-Z0-9]{6})/.exec(url)?.[1] ?? '';

/** The stage of the race: the panel that says what the camera is for when this browser cannot tell that it is allowed, then the layer of the room. */
async function onStage(p: Person, code: string): Promise<void> {
  await expect(p.page).toHaveURL(new RegExp(`/play/squat-flap/\\?(.*&)?room=${code}`), { timeout: 30_000 });
  const layer = p.page.locator('[data-live-race]');
  const explainer = p.page.locator('[data-action="camera-continue"]');
  await expect(layer.or(explainer).first()).toBeAttached({ timeout: 30_000 });
  if (await explainer.isVisible().catch(() => false)) await explainer.click();
  await expect(layer).toHaveAttribute('data-room', code, { timeout: 30_000 });
}

/** What a stage says about the race now. */
async function stageOf(p: Person): Promise<{ phase: string; match: string; seed: string; status: string }> {
  const layer = p.page.locator('[data-live-race]');
  return {
    phase: (await layer.getAttribute('data-phase')) ?? '', match: (await layer.getAttribute('data-match')) ?? '', seed: (await layer.getAttribute('data-seed')) ?? '',
    status: ((await p.page.locator('[data-lr-status]').textContent()) ?? '').trim(),
  };
}

/**
 * What the layer of the room puts on the stage stays clear of what the HUD shows there: the line (who the start waits for) and the
 * row of reactions overlap no plate, no command and no self view. The overlaps found, in words.
 */
async function overHud(p: Person): Promise<string[]> {
  return p.page.evaluate(() => {
    const box = (el: Element): DOMRect => el.getBoundingClientRect();
    const shown = (el: Element): boolean => { const r = box(el); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const hud = [...document.querySelectorAll('.ba-hud .hud-plate, .ba-hud .hud-command, .ba-hud .tile')].filter(shown);
    const mine = [...document.querySelectorAll('[data-lr-status], [data-lr-reacts]')].filter(shown);
    const out: string[] = [];
    for (const a of mine) {
      for (const b of hud) {
        const ra = box(a); const rb = box(b);
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 1 && h > 1) out.push(`${a.className} over ${b.className} (${b.getAttribute('data-hud') ?? ''})`);
      }
    }
    return out;
  });
}

/** The players of the results, as a person reads them: name, place (or Left) and points, in order. */
async function standings(p: Person): Promise<string[]> {
  const rows = p.page.locator('[data-live-result] .lr-places li');
  return (await rows.allTextContents()).map((x) => x.replace(/\s+/g, ' ').replace(' (you)', '').trim());
}

const pointsOf = (row: string): number => Number(/(\d[\d,]*) points?/.exec(row)?.[1]?.replace(/,/g, '') ?? NaN);

/** Both pages race the same race: the same match and the same seed (the course follows from the seed), and the Room's clock running. */
async function sameRace(a: Person, b: Person): Promise<string> {
  await expect.poll(async () => (await stageOf(a)).match, { timeout: 30_000 }).not.toBe('');
  await expect.poll(async () => (await stageOf(b)).match, { timeout: 30_000 }).not.toBe('');
  const sa = await stageOf(a);
  const sb = await stageOf(b);
  expect(sa.match).toBe(sb.match);
  expect(sa.seed).not.toBe('');
  expect(sa.seed).toBe(sb.seed);
  return sa.match;
}

/** The other player is on this stage: their tile with their name, a skeleton that moves, points that grow, and a plate under the score. */
async function seesTheOther(p: Person, name: string): Promise<void> {
  const tile = p.page.locator('[data-lr-tiles] .lr-tile', { has: p.page.locator('.lr-name', { hasText: name }) });
  await expect(tile).toHaveCount(1, { timeout: 20_000 });
  await expect(tile).toHaveAttribute('data-skeleton', '1', { timeout: 20_000 });
  await expect.poll(async () => Number(await tile.getAttribute('data-score')), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(p.page.locator('.rivals li', { hasText: name })).toHaveCount(1, { timeout: 20_000 });
}

/** The race is over on this page: the results of a race in the room, with both players. */
async function results(p: Person, code: string): Promise<string[]> {
  await expect(p.page).toHaveURL(new RegExp(`/results/\\?(.*&)?room=${code}`), { timeout: 60_000 });
  await expect(p.page.locator('[data-live-result]')).toHaveAttribute('data-room', code);
  await expect(p.page.locator('[data-live-result] .lr-places li')).toHaveCount(2);
  await expect(p.page.locator('[data-race-verdict]')).not.toBeEmpty();
  return standings(p);
}

for (const e of ENGINES) {
  test(`${e.id}: two friends race the same race from Ready to the results, then a rematch, back to the room and a clean leave`, async () => {
    test.skip(e.id === 'webkit' && process.env['BA_RACE_WEBKIT'] !== '1', 'WebKit on Windows is a core-only build (no RTCPeerConnection, no MediaStream); BA_RACE_WEBKIT=1 runs its row over the Room alone');
    test.setTimeout(420_000);
    await stack.db.prepare('DELETE FROM soc_lobbies').run();
    const browser = await e.type.launch(e.launch);
    const people: Person[] = [];
    try {
      const ada = await person(browser, e, 'Ada');
      const bo = await person(browser, e, 'Bo', { phone: true });
      people.push(ada, bo);

      // ── Ada makes a room for a race from the game's page, and copies its link ──
      await go(ada, '/friends/');
      await ready(ada.page);
      await signUp(ada.page, { band: 'adult', name: 'Ada' });
      await online(ada.page);
      await go(ada, '/games/squat-flap/');
      await ada.page.locator('[data-action="race.new"]').click();
      await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 30_000 });
      const code = roomCode(ada.page.url());
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(1, { timeout: 20_000 });
      await expect(ada.page.locator('.k-gamepick')).toContainText('15 seconds round');
      await ada.page.locator('.k-invite [data-action="room.copy"][data-what="link"]').click();
      await expect(ada.page.locator('[data-toasts]')).toContainText('Invite link copied');
      const link = await ada.page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');
      expect(link).toContain(`/r/${code}`);
      if (e.id === 'chromium') expect(await ada.page.evaluate(() => navigator.clipboard.readText())).toBe(link);

      // ── Bo opens the link on his device: the age first (he has no profile), then his seat ──
      await bo.page.goto(link.replace(/^https?:\/\/[^/]+/, stack.origin));
      await expect(bo.page.locator('dialog h2')).toContainText('How old are you?', { timeout: 30_000 });
      await bo.page.locator('label:has(input[name="age"][value="adult"])').click();
      await bo.page.locator('[data-action="sheet.age.next"]').click();
      await bo.page.locator('#profile-name').fill('Bo');
      await bo.page.locator('[data-action="sheet.name.create"]').click();
      await bo.page.locator('[data-action="sheet.recovery.saved"]').click();
      await expect(bo.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 30_000 });
      await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });

      // they greet each other (a private room of two adults: presets, reactions and typed words)
      await bo.page.locator('[data-action="room.say"][data-id="hi"]').click();
      await expect(ada.page.locator('.k-feed')).toContainText('Hello', { timeout: 20_000 });

      // ── Ada is ready first: her stage says who the start waits for, and Bo's room page shows her ready ──
      await ada.page.locator('[data-action="room.ready"][data-ready="1"]').click();
      await onStage(ada, code);
      await expect(ada.page.locator('[data-lr-status]')).toHaveText('Waiting for Bo to get ready', { timeout: 30_000 });
      await expect(bo.page.locator('.k-seat[data-seat]', { hasText: 'Ada' }).locator('.k-state.ready')).toBeVisible({ timeout: 20_000 });
      // the others are on the stage before the race too: Bo's tile, and what he says from the room's page lands on it
      await expect(ada.page.locator('[data-lr-tiles] .lr-tile .lr-name', { hasText: 'Bo' })).toBeVisible({ timeout: 20_000 });
      await bo.page.locator('[data-action="room.say"][data-id="ready"]').click();
      await expect(ada.page.locator('[data-lr-tiles] .lr-tile', { hasText: 'Bo' }).locator('.lr-bubble')).toHaveText('Ready when you are', { timeout: 20_000 });
      // a reaction sent from the stage reaches the room's page
      await ada.page.locator('[data-lr-react="clap"]').click();
      await expect(bo.page.locator('.k-feed .k-react')).toHaveCount(1, { timeout: 20_000 });
      for (const x of await inspect(ada.page, { axe: false, crowding: false })) ada.problems.push(`stage layout: ${x}`);
      await expect.poll(() => overHud(ada), { timeout: 3_000 }).toEqual([]);
      await shot(ada.page, `race-${e.id}-stage-waiting`, { full: false });

      // ── Bo gets ready: one race starts for both, the same course, each sees the other ──
      await bo.page.locator('[data-action="room.ready"][data-ready="1"]').click();
      await onStage(bo, code);
      const first = await sameRace(ada, bo);
      await expect.poll(() => overHud(bo), { timeout: 3_000 }).toEqual([]);
      await expect.poll(async () => (await stageOf(ada)).phase, { timeout: 30_000 }).toBe('run');
      await seesTheOther(ada, 'Bo');
      await seesTheOther(bo, 'Ada');
      await shot(bo.page, `race-${e.id}-stage-running`, { full: false });

      // ── the results: both players on both pages, the same places and points ──
      const [ra, rb] = await Promise.all([results(ada, code), results(bo, code)]);
      expect(ra).toEqual(rb);
      for (const row of ra) expect(pointsOf(row)).toBeGreaterThan(0);
      await expect(ada.page.locator('[data-live-result] li[data-you]')).toContainText('Ada (you)');
      await expect(bo.page.locator('[data-live-result] li[data-you]')).toContainText('Bo (you)');
      await expect(ada.page.locator('[data-rematch-go]')).toHaveText('Rematch');
      await expect(ada.page.locator('[data-room-back]')).toHaveAttribute('href', new RegExp(`/r/${code}`));
      // (the crowding check stays off here: the big score of every results page touches the game's picture above it, the results
      // header's own matter, which the friends screens' check is not about)
      for (const x of await inspect(ada.page, { axe: false, crowding: false })) ada.problems.push(`results layout: ${x}`);
      for (const x of await inspect(bo.page, { axe: false, crowding: false })) bo.problems.push(`results layout: ${x}`);
      await shot(ada.page, `race-${e.id}-results`);
      await shot(bo.page, `race-${e.id}-results-phone`);

      // ── a rematch: Bo asks for it first (Ada's results say so), then Ada; a new race of the same room ──
      await bo.page.locator('[data-rematch-go]').click();
      await onStage(bo, code);
      await expect(ada.page.locator('[data-rematch]')).toHaveText('Bo wants a rematch', { timeout: 30_000 });
      await ada.page.locator('[data-rematch-go]').click();
      await onStage(ada, code);
      const second = await sameRace(ada, bo);
      expect(second).not.toBe(first);
      await seesTheOther(ada, 'Bo');
      const [ra2, rb2] = await Promise.all([results(ada, code), results(bo, code)]);
      expect(ra2).toEqual(rb2);

      // ── back to the room, and a clean leave: the one who stays sees it at once ──
      await bo.page.locator('[data-room-back]').click();
      await expect(bo.page).toHaveURL(new RegExp(`/r/${code}`));
      await expect(bo.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
      await bo.page.locator('[data-action="room.leave"]').click();
      await expect(bo.page).toHaveURL(/\/friends\//);
      await expect(ada.page.locator('[data-rematch]')).toHaveText('Everyone else left the room.', { timeout: 20_000 });
      await ada.page.locator('[data-room-back]').click();
      await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(1, { timeout: 20_000 });
      await expect(ada.page.locator('.k-actionbar .k-note')).toHaveText('Waiting for a second player. Share the code or the link.');
    } finally {
      const problems = people.flatMap((p) => p.problems);
      if (problems.length > 0 || test.info().status !== 'passed') console.log('WORKER LOG', stack.logs.slice(-15).join(' | '));
      await browser.close().catch(() => undefined);
      expect(problems).toEqual([]);
    }
  });
}

test('chromium: a stage that reloads in the middle of a race joins the room again and races on; both pages end with the same result', async () => {
  test.setTimeout(300_000);
  await stack.db.prepare('DELETE FROM soc_lobbies').run();
  const e = ENGINES[0] as Engine;
  const browser = await e.type.launch(e.launch);
  const people: Person[] = [];
  try {
    const ada = await person(browser, e, 'Ada');
    const bo = await person(browser, e, 'Bo');
    people.push(ada, bo);
    for (const [p, name] of [[ada, 'Ada'], [bo, 'Bo']] as const) {
      await go(p, '/friends/');
      await ready(p.page);
      await signUp(p.page, { band: 'adult', name });
      await online(p.page);
    }
    await go(ada, '/games/squat-flap/');
    await ada.page.locator('[data-action="race.new"]').click();
    await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 30_000 });
    const code = roomCode(ada.page.url());
    await go(bo, `/r/${code}`);
    await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 30_000 });
    await ada.page.locator('[data-action="room.ready"][data-ready="1"]').click();
    await onStage(ada, code);
    await expect(bo.page.locator('.k-seat[data-seat]', { hasText: 'Ada' }).locator('.k-state.ready')).toBeVisible({ timeout: 20_000 });
    await bo.page.locator('[data-action="room.ready"][data-ready="1"]').click();
    await onStage(bo, code);
    const match = await sameRace(ada, bo);
    await expect.poll(async () => (await stageOf(bo)).phase, { timeout: 30_000 }).toBe('run');
    await expect.poll(async () => Number(await ada.page.locator('[data-lr-tiles] .lr-tile').first().getAttribute('data-score')), { timeout: 30_000 }).toBeGreaterThan(0);

    // Bo's page reloads: the stage says it is joining the room, then it is in the same race again (the race waited for him)
    await bo.page.reload();
    await expect(bo.page.locator('[data-room-joining], [data-live-race]').first()).toBeAttached({ timeout: 30_000 });
    await onStage(bo, code);
    await expect.poll(async () => (await stageOf(bo)).match, { timeout: 30_000 }).toBe(match);
    const [ra, rb] = await Promise.all([results(ada, code), results(bo, code)]);
    expect(ra).toEqual(rb);
    for (const row of ra) expect(pointsOf(row)).toBeGreaterThan(0);
  } finally {
    const problems = people.flatMap((p) => p.problems);
    if (problems.length > 0 || test.info().status !== 'passed') console.log('WORKER LOG', stack.logs.slice(-15).join(' | '));
    await browser.close().catch(() => undefined);
    expect(problems).toEqual([]);
  }
});

test('chromium: two adults in a private room who both share their camera see each other\'s camera on the stage', async () => {
  test.setTimeout(300_000);
  await stack.db.prepare('DELETE FROM soc_lobbies').run();
  const e = ENGINES[0] as Engine;
  const browser = await e.type.launch(e.launch);
  const people: Person[] = [];
  try {
    const ada = await person(browser, e, 'Ada');
    const bo = await person(browser, e, 'Bo');
    people.push(ada, bo);
    for (const [p, name] of [[ada, 'Ada'], [bo, 'Bo']] as const) {
      await go(p, '/friends/');
      await ready(p.page);
      await signUp(p.page, { band: 'adult', name });
      await online(p.page);
    }
    await go(ada, '/games/squat-flap/');
    await ada.page.locator('[data-action="race.new"]').click();
    await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 30_000 });
    const code = roomCode(ada.page.url());
    await go(bo, `/r/${code}`);
    await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 30_000 });

    // both turn their camera on for the room (Chromium's fake camera); the seats say so on both pages
    for (const p of [ada, bo]) {
      await p.page.locator('label[for="room-share"]').click();
      await expect(p.page.locator('#room-share')).toBeChecked();
    }
    for (const p of [ada, bo]) await expect(p.page.locator('.k-seat[data-seat] .cam[aria-label="Shares camera with friends"]')).toHaveCount(2, { timeout: 20_000 });

    await ada.page.locator('[data-action="room.ready"][data-ready="1"]').click();
    await onStage(ada, code);
    await expect(bo.page.locator('.k-seat[data-seat]', { hasText: 'Ada' }).locator('.k-state.ready')).toBeVisible({ timeout: 20_000 });
    await bo.page.locator('[data-action="room.ready"][data-ready="1"]').click();
    await onStage(bo, code);
    await sameRace(ada, bo);
    // the other's camera on the tile, with frames in it
    for (const [p, other] of [[ada, 'Bo'], [bo, 'Ada']] as const) {
      const tile = p.page.locator('[data-lr-tiles] .lr-tile', { has: p.page.locator('.lr-name', { hasText: other }) });
      await expect(tile).toHaveAttribute('data-show', 'video', { timeout: 30_000 });
      await expect(tile.locator('video')).toBeVisible();
      await expect(tile.locator('canvas')).toBeHidden();
      await expect.poll(() => tile.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    }
    await shot(ada.page, 'race-chromium-stage-cameras', { full: false });

    // (the camera is the room's choice: the stage has no switch of its own) the race ends and both have their results
    const [ra, rb] = await Promise.all([results(ada, code), results(bo, code)]);
    expect(ra).toEqual(rb);
  } finally {
    const problems = people.flatMap((p) => p.problems);
    if (problems.length > 0 || test.info().status !== 'passed') console.log('WORKER LOG', stack.logs.slice(-15).join(' | '));
    await browser.close().catch(() => undefined);
    expect(problems).toEqual([]);
  }
});
