// The four games of builder G3 on every screen of design/LAYOUT.md (the ten breakpoints, one player; the four big ones also with two
// players), in headless Chromium through the same harness as g3-games.spec.ts (tests/e2e/pages/g3-game-harness.ts) but with the
// shell's self view tile opaque (?tile=1), so that a picture shows the layout as a player sees it. Each case plays a few seconds of a
// run, then checks what the layout rule asks (the HUD without a problem, the key objects of the game clear of every plate and of the
// self view, inside the screen, and in one lane each with two players) and, when BA_G3_SHOTS=<folder> is set, keeps pictures.
//   npx playwright test tests/e2e/g3-shots.spec.ts --workers=1                     (checks only)
//   BA_G3_SHOTS=<folder> npx playwright test tests/e2e/g3-shots.spec.ts --workers=1 (checks and pictures; add -g <game> or -g <size>)
// A real-time run in a software-rendered page is a local gate, like g3-games.spec.ts.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

test.skip(!!process.env['CI'], 'whole-chain runs in real time: the local release gate, not the CI runners');

interface Box { x: number; y: number; w: number; h: number }
interface Ba {
  start(): Promise<void>;
  state(): { session: string; game: { phase: string; k: number; segment: string } | null; seen: { errors: unknown[] } };
  keep(): Box[];
  plates(): ({ name: string } & Box)[];
  reasons(): string[];
  rects(): { w: number; h: number; play: Box; pip: Box | null; lanes?: [Box, Box] | null };
  problems(): string[];
  pixelCheck(): number;
}
const ba = <T>(page: Page, fn: (b: Ba) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.ba)`) as Promise<T>;

const SCREENS: Record<string, readonly [number, number]> = {
  '360x780': [360, 780], '390x844': [390, 844], '412x915': [412, 915], '844x390': [844, 390], '915x412': [915, 412],
  '768x1024': [768, 1024], '1024x768': [1024, 768], '1280x800': [1280, 800], '1440x900': [1440, 900], '1920x1080': [1920, 1080],
};
/** Two people on one camera: landscape screens at least 1000 px wide that are not phones (design/LAYOUT.md section 12). */
const BIG = ['1024x768', '1280x800', '1440x900', '1920x1080'];

type GameId = 'firework-jacks' | 'twist-turbine' | 'limbo-bend' | 'pose-wall';
const LEVEL: Record<GameId, string> = { 'firework-jacks': 'normal', 'twist-turbine': 'normal', 'limbo-bend': 'normal', 'pose-wall': 'easy' };
const TWO: readonly GameId[] = ['firework-jacks', 'limbo-bend', 'pose-wall'];
/** Seconds of the run (simulation time) at which a picture is kept: after the count-in, and when the game has something going on. */
const AT: Record<GameId, readonly number[]> = { 'firework-jacks': [7, 11], 'twist-turbine': [8, 15], 'limbo-bend': [7, 11], 'pose-wall': [7, 11] };

interface Case { game: GameId; screen: string; mode: 'solo' | 'local2'; seated?: boolean; quiet?: boolean }

const CASES: Case[] = [];
for (const game of Object.keys(LEVEL) as GameId[]) {
  for (const screen of Object.keys(SCREENS)) CASES.push({ game, screen, mode: 'solo' });
  if (TWO.includes(game)) for (const screen of BIG) CASES.push({ game, screen, mode: 'local2' });
}

// the ways of playing that look different: seated (the upper body, arm jacks) on a phone and on a laptop, and the quiet step jack
for (const game of Object.keys(LEVEL) as GameId[]) {
  CASES.push({ game, screen: '390x844', mode: 'solo', seated: true });
  CASES.push({ game, screen: '1280x800', mode: 'solo', seated: true });
}
CASES.push({ game: 'firework-jacks', screen: '390x844', mode: 'solo', quiet: true });

async function simSeconds(page: Page): Promise<number> {
  return ba(page, (b) => (b.state().game?.k ?? 0) / 60);
}

async function untilSim(page: Page, seconds: number, timeout = 60_000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await simSeconds(page)) >= seconds) return;
    const s = await ba(page, (b) => b.state().session);
    if (s === 'error' || s === 'results') throw new Error(`the session is '${s}' before ${seconds} s of play`);
    await page.waitForTimeout(100);
  }
  throw new Error(`the run never reached ${seconds} s of play (at ${await simSeconds(page)})`);
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box): boolean => a.x >= b.x - 1 && a.x + a.w <= b.x + b.w + 1 && a.y >= b.y - 1 && a.y + a.h <= b.y + b.h + 1;

for (const c of CASES) {
  const label = `${c.game}-${c.mode}${c.seated ? '-seated' : ''}${c.quiet ? '-quiet' : ''}-${c.screen}`;
  test(label, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    const [width, height] = SCREENS[c.screen] as readonly [number, number];
    await page.setViewportSize({ width, height });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console ${m.type()}: ${m.text()}`); });
    const params = new URLSearchParams({
      game: c.game, mode: c.mode, difficulty: LEVEL[c.game], seated: c.seated ? '1' : '0', quiet: c.quiet ? '1' : '0', body: 'perfect',
      workS: c.game === 'twist-turbine' ? '30' : '18', tile: '1',
    });
    await page.goto(`${DEV_URL}/tests/e2e/pages/g3-game.html?${params.toString()}`);
    await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
    await ba(page, (b) => b.start());

    const shots = process.env['BA_G3_SHOTS'];
    for (const [n, at] of AT[c.game].entries()) {
      await untilSim(page, at);
      // the read-back of the picture only once: a second one makes the browser warn about the page's own check
      const look = await ba(page, (b) => ({ problems: b.problems(), keep: b.keep(), plates: b.plates(), rects: b.rects(), colours: 0 }));
      if (n === 0) look.colours = await ba(page, (b) => b.pixelCheck());
      if (shots) await page.screenshot({ path: join(shots, `${label}-${String(at).padStart(2, '0')}s.png`) });
      expect(look.problems, `HUD problems at ${at} s`).toEqual([]);
      if (n === 0) expect(look.colours, 'colours on the canvas').toBeGreaterThan(5);
      expect(look.keep.length).toBeGreaterThan(0);
      const screen: Box = { x: 0, y: 0, w: width, h: height };
      // the plates of the HUD, and the self view as the picture the scene kit leaves a window for
      const plates = look.plates.filter((p) => p.name !== 'pip');
      if (look.rects.pip) plates.push({ name: 'pip picture', ...look.rects.pip });
      for (const k of look.keep) {
        expect(k.w, 'a key object has a size').toBeGreaterThan(10);
        expect(inside(k, screen), `a key object ${JSON.stringify(k)} inside the screen ${width}x${height}`).toBe(true);
        for (const p of plates) expect(overlaps(k, p), `a key object ${JSON.stringify(k)} under the ${p.name} plate ${JSON.stringify(p)} (rects ${JSON.stringify(look.rects)})`).toBe(false);
      }
      if (c.mode === 'local2') {
        const lanes = look.rects.lanes;
        expect(lanes, 'two lanes').toBeTruthy();
        for (const k of look.keep) expect(inside(k, (lanes as [Box, Box])[0]) || inside(k, (lanes as [Box, Box])[1]), `a key object ${JSON.stringify(k)} in one lane (lanes ${JSON.stringify(lanes)})`).toBe(true);
      }
    }
    await page.evaluate(() => (window as unknown as { ba: { chain: { session: { quit(): void } } } }).ba.chain.session.quit());
    expect((await ba(page, (b) => b.state())).seen.errors).toEqual([]);
    expect(errors).toEqual([]);
  });
}
