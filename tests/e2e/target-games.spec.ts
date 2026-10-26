// Star Catch, Pad Work and Reaction Tag in a real headless browser: the real 2D kit on a real canvas, the real HUD on the
// shell's stylesheet, the real sound kit, a camera stand-in and a virtual player through the real hand detector
// (tests/e2e/pages/target-games-harness.ts). Phone and laptop sizes, one player and two, the keyboard, seated play, whole runs;
// no console error or page error in any of them, every target inside the picture and clear of every HUD plate.
// Set BA_SHOT_DIR to a folder to also write a picture of each case (for looking at).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import type * as Harness from './pages/target-games-harness.ts';

type H = Pick<typeof Harness, 'start' | 'stop' | 'state' | 'pixel' | 'key' | 'aim'>;
type State = NonNullable<Awaited<ReturnType<H['state']>>>;

const GAMES = ['star-catch', 'pad-work', 'reaction-tag'] as const;
const SCREENS: [string, number, number][] = [
  ['phone-360', 360, 780], ['phone-390', 390, 844], ['phone-412', 412, 915], ['phone-land-844', 844, 390], ['phone-land-915', 915, 412],
  ['tablet-768', 768, 1024], ['tablet-land-1024', 1024, 768], ['laptop-1280', 1280, 800], ['laptop-1440', 1440, 900], ['tv-1920', 1920, 1080],
];
const CORE = SCREENS.filter(([n]) => ['phone-390', 'phone-land-844', 'laptop-1280'].includes(n));
const STAGE = { r: 0x1a, g: 0x14, b: 0x30 };

const errorsOf = (page: Page): string[] => (page as unknown as { errors: string[] }).errors;

async function open(page: Page, w: number, h: number): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // the pixel read-back of this harness makes Chromium say so once; that is the test's own doing, any other warning is not
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/willReadFrequently/.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${DEV_URL}/tests/e2e/pages/target-games.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true, undefined, { timeout: 60_000 });
}

function call<K extends keyof H>(page: Page, fn: K, ...arg: Parameters<H[K]>): Promise<Awaited<ReturnType<H[K]>>> {
  return page.evaluate(async ([name, a]) => {
    const tg = (window as unknown as { tg: Record<string, (...x: unknown[]) => unknown> }).tg;
    return await tg[name as string]!(...(a as unknown[]));
  }, [fn as string, arg] as const) as Promise<Awaited<ReturnType<H[K]>>>;
}

const state = async (page: Page): Promise<State> => {
  const s = await call(page, 'state');
  expect(s, 'the harness has a running game').not.toBeNull();
  return s as State;
};

type RGB = { r: number; g: number; b: number };

/**
 * Two pixels of the picture, read in one animation frame together with the mirror rect that frame was drawn with: one inside the mirror
 * (near its bottom-left corner) and one 3 px left of it, half way down (null when the mirror leaves no room there). The mirror is fitted
 * inside the play area, so it moves when the command plate or the reason strip comes or goes (Pad Work's coach calls a command every beat
 * or two: at 1280 x 800 the mirror is 885 x 664 at x 197 without one and 859 x 644 at x 211 with one); a rect read in an earlier call can be
 * a command old, and 3 px left of the smaller mirror is then inside the larger one.
 */
async function mirrorPixels(page: Page): Promise<{ inside: RGB | null; beside: RGB | null }> {
  return page.evaluate(() => new Promise((done) => requestAnimationFrame(() => {
    const tg = (window as unknown as { tg: { state(): { mirror: { x: number; y: number; w: number; h: number } } | null; pixel(x: number, y: number): RGB | null } }).tg;
    const m = tg.state()?.mirror;
    if (!m) { done({ inside: null, beside: null }); return; }
    done({ inside: tg.pixel(m.x + m.w * 0.04, m.y + m.h * 0.96), beside: m.x > 6 ? tg.pixel(m.x - 3, m.y + m.h / 2) : null });
  })));
}

/** Waits until the game has simulated at least `ms` of play (its own clock), or has ended. */
async function playFor(page: Page, ms: number, timeout = 45_000): Promise<State> {
  await page.waitForFunction((t) => {
    const s = (window as unknown as { tg: { state(): { t: number; running: boolean } | null } }).tg.state();
    return !!s && (s.t >= t || !s.running);
  }, ms, { timeout, polling: 100 });
  return state(page);
}

/** What the harness saw while the game ran: every target (but a swinging bag, which comes in from the side by design) lay inside the picture and clear of every plate. */
function expectTargetsClear(s: State, label: string): number {
  expect(s.geometry.violations, `${label}: targets outside the picture or under a plate`).toEqual([]);
  return s.geometry.checked;
}

const expectClean = (page: Page, label: string): void => { expect(errorsOf(page), `${label}: console and page errors`).toEqual([]); };

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.BA_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

// ───────── one player, the camera: a perfect player scores, on phone and laptop ─────────

for (const game of GAMES) {
  for (const [name, w, h] of CORE) {
    test(`${game} at ${name} (${w}x${h}): a perfect player scores, the HUD shows it, nothing sits under a plate, no console errors`, async ({ page }) => {
      test.setTimeout(90_000);
      await open(page, w, h);
      await call(page, 'start', { game, bot: 'perfect', level: 'normal', seed: 4, seconds: 60, rounds: 1, speed: 4 });
      let last: State | null = null;
      for (let t = 3000; t <= 15_000; t += 2000) {
        last = await playFor(page, t);
        expect(last.hudProblems, `${game} ${name} HUD problems at t=${t}`).toEqual([]);
      }
      const s = last as State;
      expect(expectTargetsClear(s, `${game} ${name}`), 'targets were checked').toBeGreaterThan(10);
      expect(s.lanes[0]!.hits, 'a perfect player hits').toBeGreaterThan(2);
      expect(s.lanes[0]!.score).toBeGreaterThan(0);
      // the HUD shows what the game says
      expect(s.hudText['statusLeft'] ?? s.hudText['score'] ?? '', 'score plate').toMatch(/\d/);
      expect(s.hudText['statusRight'] ?? '', 'timer plate').toMatch(/\d/);
      // the picture: the stage colour around the mirror when there is room, the camera inside it
      const { inside: c, beside: o } = await mirrorPixels(page);
      expect(c, 'a pixel inside the mirror').not.toBeNull();
      expect(Math.abs(c!.r - STAGE.r) + Math.abs(c!.g - STAGE.g) + Math.abs(c!.b - STAGE.b), `${name} the camera picture is drawn inside the mirror`).toBeGreaterThan(20);
      if (o) expect(Math.abs(o.r - STAGE.r) + Math.abs(o.g - STAGE.g), `${name} stage colour beside the mirror`).toBeLessThan(10);
      // sound: every cue the game asked for exists in the sound kit
      expect(s.audio.unknown, 'sounds the kit does not know').toBe(0);
      expect(Object.keys(s.cues).length, 'the game played sounds').toBeGreaterThan(0);
      // the canvas has a sane size (the kit caps the pixels)
      expect(s.canvas.width * s.canvas.height).toBeLessThanOrEqual(2_400_000 * 1.01);
      await shot(page, `${game}-${name}`);
      const gone = (await call(page, 'stop')) as { canvases: number; surfaces: number; particles: number };
      expect(gone.surfaces, 'the kit gave every surface back').toBe(0);
      expect(gone.canvases, 'the game canvas is gone').toBe(0);
      expectClean(page, `${game} ${name}`);
    });
  }
}

// ───────── a player who does nothing: misses, and the reason strip says why ─────────

for (const game of GAMES) {
  test(`${game}: a player who does nothing misses, the reason strip says it in words, and the run goes on`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, 1280, 800);
    await call(page, 'start', { game, bot: 'idle', level: 'normal', seed: 6, seconds: 60, rounds: 1, speed: 4 });
    let said = '';
    for (let t = 3000; t <= 16_000; t += 700) {
      const s = await playFor(page, t);
      if (!said) said = s.hudText['reason'] ?? '';
    }
    const s = await state(page);
    expect(s.lanes[0]!.misses, 'misses are counted').toBeGreaterThan(1);
    expect(s.lanes[0]!.hits).toBe(0);
    expect(said.length, 'the reason strip had a sentence').toBeGreaterThan(5);
    expect(said, 'a sentence, not a key').not.toMatch(/^[a-z_.]+$/);
    expect(s.hudProblems).toEqual([]);
    await call(page, 'stop');
    expectClean(page, game);
  });
}

// ───────── the whole run, to the end: the summary ─────────

for (const game of GAMES) {
  test(`${game}: a whole short run ends with a summary (score, hits, MET x time)`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, 844, 390);
    await call(page, 'start', { game, bot: 'perfect', level: 'normal', seed: 9, seconds: 40, rounds: 2, speed: 8 });
    await page.waitForFunction(() => { const s = (window as unknown as { tg: { state(): { running: boolean } | null } }).tg.state(); return !!s && !s.running; }, undefined, { timeout: 100_000, polling: 200 });
    const s = await state(page);
    expect(s.phase === 'over' || s.phase === 'complete').toBe(true);
    expect(s.summary, 'a summary at the end').not.toBeNull();
    expect(s.summary!.score).toBeGreaterThan(0);
    expect(s.summary!.metSeconds).toBeGreaterThan(40 * 2);
    expect(s.announced.some((t) => /Round 1/i.test(t)), 'the round start is announced to a screen reader').toBe(true);
    expect(s.announced.some((t) => /rest/i.test(t)), 'the rest is announced').toBe(true);
    await shot(page, `${game}-end`);
    await call(page, 'stop');
    expectClean(page, game);
  });
}

// ───────── two players, one camera (big screens) ─────────

for (const game of GAMES) {
  for (const [name, w, h] of SCREENS.filter(([n]) => ['laptop-1280', 'laptop-1440'].includes(n))) {
    test(`${game} with two players at ${name}: each lane scores, two score plates, no target under a plate`, async ({ page }) => {
      test.setTimeout(90_000);
      await open(page, w, h);
      await call(page, 'start', { game, players: 2, bot: 'perfect', level: 'normal', seed: 3, seconds: 60, rounds: 1, speed: 4 });
      let s: State | null = null;
      for (let t = 4000; t <= 14_000; t += 2500) {
        s = await playFor(page, t);
        expect(s.hudProblems, `${game} two ${name} HUD problems`).toEqual([]);
      }
      const e = s as State;
      const checked = expectTargetsClear(e, `${game} two ${name}`);
      expect(e.lanes.length).toBe(2);
      expect(e.lanes[0]!.hits, 'player 1 hits').toBeGreaterThan(1);
      expect(e.lanes[1]!.hits, 'player 2 hits').toBeGreaterThan(1);
      expect(Object.keys(e.plates).filter((k) => /^statusP[12]$/.test(k)).length, 'a score plate for each player').toBe(2);
      // the two lanes keep to their own halves of the picture
      const mid = e.mirror.x + e.mirror.w / 2;
      for (const t of e.lanes[0]!.targets) if (t.kind !== 'bag') expect(t.x, 'player 1 targets are on the left half').toBeLessThanOrEqual(mid + t.r);
      for (const t of e.lanes[1]!.targets) if (t.kind !== 'bag') expect(t.x, 'player 2 targets are on the right half').toBeGreaterThanOrEqual(mid - t.r);
      expect(checked).toBeGreaterThan(3);
      await shot(page, `${game}-two-${name}`);
      await call(page, 'stop');
      expectClean(page, `${game} two ${name}`);
    });
  }
}

// ───────── the keyboard: no camera, two cursors ─────────

test('keyboard: the arrow keys move the right hand and W A S D the left, with no camera picture and no errors', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, 1280, 800);
  await call(page, 'start', { game: 'star-catch', keyboard: true, level: 'easy', seed: 2, seconds: 60, rounds: 1 });
  const before = await playFor(page, 1500);
  expect(before.hasPicture).toBe(false);
  const r0 = before.lanes[0]!.hands.R, l0 = before.lanes[0]!.hands.L;
  await call(page, 'key', 'ArrowRight', true); await call(page, 'key', 'ArrowUp', true);
  await call(page, 'key', 'a', true); await call(page, 'key', 'w', true);
  await page.waitForTimeout(500);
  await call(page, 'key', 'ArrowRight', false); await call(page, 'key', 'ArrowUp', false);
  await call(page, 'key', 'a', false); await call(page, 'key', 'w', false);
  const after = await state(page);
  const r1 = after.lanes[0]!.hands.R, l1 = after.lanes[0]!.hands.L;
  expect(r1.x, 'the right hand went right').toBeGreaterThan(r0.x + 0.1);
  expect(r1.y, 'the right hand went up').toBeGreaterThan(r0.y + 0.1);
  expect(l1.x, 'the left hand went left').toBeLessThan(l0.x - 0.1);
  expect(l1.y, 'the left hand went up').toBeGreaterThan(l0.y + 0.1);
  await shot(page, 'star-catch-keyboard');
  await call(page, 'stop');
  expectClean(page, 'keyboard');
});

// ───────── seated, reduced motion, Turkish ─────────

for (const game of GAMES) {
  test(`${game}: seated, reduced motion and Turkish words play without errors, and the HUD speaks Turkish`, async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, 390, 844);
    await call(page, 'start', { game, seated: true, reducedMotion: true, lang: 'tr', bot: 'perfect', level: 'easy', seed: 8, seconds: 60, rounds: 1, speed: 4 });
    const s = await playFor(page, 8000);
    expect(s.lanes[0]!.hits).toBeGreaterThan(0);
    expect(s.hudProblems).toEqual([]);
    expectTargetsClear(s, `${game} seated`);
    const words = Object.values(s.hudText).join(' | ');
    expect(words, 'Turkish prompt or labels').toMatch(/Tur 1|Yeşile dokun|Puan|Süre|Mola/i);
    await call(page, 'stop');
    expectClean(page, game);
  });
}

// ───────── every size of the plan, for the three games (the matrix is slow without a GPU) ─────────

test.describe('all ten screens', () => {
  test.skip(!!process.env.CI, 'ten sizes times three games on software rendering is too slow for the runners; it runs on the local release gate');
  for (const game of GAMES) {
    test(`${game} on every screen of the plan: nothing cut off, nothing under a plate, no errors`, async ({ page }) => {
      test.setTimeout(180_000);
      await open(page, 390, 844);
      for (const [name, w, h] of SCREENS) {
        await page.setViewportSize({ width: w, height: h });
        await call(page, 'start', { game, bot: 'perfect', level: 'expert', seed: 12, seconds: 60, rounds: 1, speed: 4 });
        let last: State | null = null;
        for (const t of [3000, 6000, 9000]) {
          last = await playFor(page, t);
          expect(last.hudProblems, `${game} ${name} HUD problems`).toEqual([]);
          expect(last.mirror.w, `${name} has a mirror`).toBeGreaterThan(100);
        }
        expect(expectTargetsClear(last as State, `${game} ${name}`), `${game} ${name}`).toBeGreaterThan(1);
        await shot(page, `${game}-all-${name}`);
        await call(page, 'stop');
      }
      expectClean(page, game);
    });
  }
});

test('starting and stopping again and again leaves nothing behind', async ({ page }) => {
  test.skip(!!process.env.CI, 'six sessions in a row on software rendering are too slow for the runners; it runs on the local release gate');
  test.setTimeout(120_000);
  await open(page, 844, 390);
  for (let i = 0; i < 6; i++) {
    await call(page, 'start', { game: GAMES[i % 3]!, bot: 'perfect', seed: i + 1, seconds: 30, rounds: 1, speed: 4 });
    await playFor(page, 2500);
    const gone = (await call(page, 'stop')) as { canvases: number; surfaces: number; particles: number };
    expect(gone, `session ${i}`).toEqual({ canvases: 0, surfaces: 0, particles: 0 });
  }
  expectClean(page, 'sessions');
});
