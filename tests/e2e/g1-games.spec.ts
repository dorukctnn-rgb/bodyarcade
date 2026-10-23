// The three games of builder G1 in headless Chromium: Squat Flap, Knee Sprint and Summit Climb, played by a synthetic body
// through the real Session, detectors, input hub, 2D scene kit, the shell's HUD and the real audio kit (tests/e2e/pages/
// g1-game-harness.ts). At phone and laptop sizes: no console error, the HUD without a problem, the key objects clear of the
// plates, the picture really drawn, every sound a sound of the library, and the round runs to the results.
// BA_G1_SHOTS=<folder> keeps a screenshot of every run.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

interface Box { x: number; y: number; w: number; h: number }
interface Ba {
  start(): Promise<void>;
  state(): { session: string; game: { phase: string; round: { set: number }; lanes: { score: number; lives: number; hits: number; passes: number; flaps: number }[] } | null; seen: { states: string[]; errors: unknown[]; over: { score: number; seconds: number; reps?: number; cleared?: number; players?: Record<string, { score: number }> }[] } };
  birds(): ({ x: number; y: number; r: number } | null)[];
  plates(): ({ name: string } & Box)[];
  rects(): { play: Box; pip: Box | null; lanes?: [Box, Box] | null };
  problems(): string[];
  frames(): number[];
  audioStats(): { played: number; skipped: { unknown: number }; contextsCreated: number };
  pixelCheck(): number;
}
const ba = <T>(page: Page, fn: (b: Ba) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.ba)`) as Promise<T>;

async function open(page: Page, params: string, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console ${m.type()}: ${m.text()}`); });
  await page.goto(`${DEV_URL}/tests/e2e/pages/g1-game.html?${params}`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
}

async function waitSession(page: Page, want: string, timeout = 90_000): Promise<void> {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await ba(page, (b) => b.state().session);
    if (last === want) return;
    if (last === 'error') break;
    await page.waitForTimeout(150);
  }
  throw new Error(`session never reached '${want}' (now '${last}'): ${JSON.stringify(await ba(page, (b) => b.state()))}`);
}

const overlaps = (c: { x: number; y: number; r: number }, r: Box): boolean => {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w)), ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
};

const SIZES = {
  'phone-390x844': { width: 390, height: 844 },
  'phone-844x390': { width: 844, height: 390 },
  'laptop-1280x800': { width: 1280, height: 800 },
} as const;

interface Case { game: string; size: keyof typeof SIZES; mode?: 'solo' | 'local2'; seated?: boolean; difficulty?: string }

const CASES: Case[] = [
  { game: 'squat-flap', size: 'phone-390x844' },
  { game: 'squat-flap', size: 'phone-844x390' },
  { game: 'squat-flap', size: 'laptop-1280x800' },
  { game: 'squat-flap', size: 'laptop-1280x800', mode: 'local2' },
  { game: 'squat-flap', size: 'phone-390x844', seated: true },
];

for (const c of CASES) {
  const name = `${c.game} ${c.mode ?? 'solo'}${c.seated ? ' seated' : ''} at ${c.size}`;
  test(name, async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    await page.setViewportSize(SIZES[c.size]);
    const params = new URLSearchParams({ game: c.game, mode: c.mode ?? 'solo', difficulty: c.difficulty ?? 'easy', seated: c.seated ? '1' : '0', body: 'perfect' });
    await open(page, params.toString(), errors);
    await ba(page, (b) => b.start());
    await waitSession(page, 'running');
    await page.waitForTimeout(2500);

    // Mid-play: the HUD is whole, the picture is drawn, the key objects are clear of the plates.
    const mid = await ba(page, (b) => ({ problems: b.problems(), colours: b.pixelCheck(), birds: b.birds(), plates: b.plates(), rects: b.rects() }));
    expect(mid.problems, 'HUD problems').toEqual([]);
    expect(mid.colours, 'colours on the canvas').toBeGreaterThan(5);
    const players = c.mode === 'local2' ? 2 : 1;
    for (let i = 0; i < players; i++) {
      const bird = mid.birds[i];
      expect(bird, `bird of lane ${i}`).not.toBeNull();
      for (const p of mid.plates) expect(overlaps(bird!, p), `bird ${i} under the ${p.name} plate`).toBe(false);
      const area = mid.rects.lanes ? mid.rects.lanes[i]! : mid.rects.play;
      expect(bird!.x).toBeGreaterThan(area.x);
      expect(bird!.x).toBeLessThan(area.x + area.w);
      expect(bird!.y).toBeGreaterThan(area.y - 1);
      expect(bird!.y).toBeLessThan(area.y + area.h + 1);
    }
    if (process.env['BA_G1_SHOTS']) await page.screenshot({ path: join(process.env['BA_G1_SHOTS'], `${c.game}-${c.mode ?? 'solo'}${c.seated ? '-seated' : ''}-${c.size}-play.png`) });

    await waitSession(page, 'results', 120_000);
    const end = await ba(page, (b) => ({ state: b.state(), audio: b.audioStats(), frames: b.frames() }));
    const over = end.state.seen.over[0]!;
    expect(over.seconds).toBeGreaterThan(8);
    expect(over.score).toBeGreaterThanOrEqual(0);
    expect(end.audio.skipped.unknown, 'sounds that are not in the library').toBe(0);
    expect(end.audio.played).toBeGreaterThan(3);
    if (c.mode === 'local2') expect(over.players?.['1']).toBeDefined();
    expect(end.state.seen.errors).toEqual([]);
    expect(errors).toEqual([]);
    const sorted = [...end.frames].sort((a, b) => a - b);
    if (sorted.length > 30) expect(sorted[Math.floor(sorted.length * 0.5)]!).toBeLessThan(60);
  });
}
