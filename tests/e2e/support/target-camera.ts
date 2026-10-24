// Shared steps of the real-pipeline specs for the target games (tests/e2e/target-camera*.spec.ts), written against
// tests/e2e/pages/target-camera.html.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { DEV_URL } from './ports.ts';
import type * as Harness from '../pages/target-camera-harness.ts';

export type H = Pick<typeof Harness, 'begin' | 'snap' | 'pause' | 'resume' | 'quit'>;
export type Snap = NonNullable<ReturnType<typeof Harness.snap>>;

export const GAMES = ['star-catch', 'pad-work', 'reaction-tag'] as const;
export const STANDING = 'tests/e2e/fixtures/standing-640x360.mjpeg';
export const TWO = 'tests/e2e/fixtures/two-standing-640x360.mjpeg';
export const SKIP_ON_CI = 'the real pose model on software rendering needs real CPU time; it runs on the local release gate, not on the CI runners';

export const errorsOf = (page: Page): string[] => (page as unknown as { errors: string[] }).errors;

export async function open(page: Page, w: number, h: number): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${DEV_URL}/tests/e2e/pages/target-camera.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true, undefined, { timeout: 60_000 });
}

export function call<K extends keyof H>(page: Page, fn: K, ...arg: Parameters<H[K]>): Promise<Awaited<ReturnType<H[K]>>> {
  return page.evaluate(async ([name, a]) => {
    const tc = (window as unknown as { tc: Record<string, (...x: unknown[]) => unknown> }).tc;
    return await tc[name as string]!(...(a as unknown[]));
  }, [fn as string, arg] as const) as Promise<Awaited<ReturnType<H[K]>>>;
}

export const snap = async (page: Page): Promise<Snap> => {
  const s = await call(page, 'snap');
  expect(s, 'a run exists').not.toBeNull();
  return s as Snap;
};

/** Waits for a session state; on a timeout the error says where the session stopped. */
export async function waitState(page: Page, want: string | string[], timeout: number): Promise<Snap> {
  const wants = Array.isArray(want) ? want : [want];
  const end = Date.now() + timeout;
  let s: Snap | null = null;
  while (Date.now() < end) {
    s = await snap(page);
    if (wants.includes(s.state)) return s;
    if (s.state === 'error') break;
    await page.waitForTimeout(150);
  }
  const brief = s && { state: s.state, pauseReason: s.pauseReason, states: s.states, errors: s.errors, calibrations: s.calibrations, players: s.players, video: s.video };
  throw new Error(`Session never reached ${wants.join(' or ')}: ${JSON.stringify(brief)}`);
}

export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.BA_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/** How far the game's hand rings are from the hands in the picture, as a share of the picture's width, over several moments. */
export async function alignment(page: Page, lanes: number, moments = 10): Promise<{ median: number[]; samples: number[] }> {
  const errs: number[][] = Array.from({ length: lanes }, () => []);
  for (let k = 0; k < moments; k++) {
    const s = await snap(page);
    s.game?.lanes.forEach((l, i) => {
      for (const side of ['L', 'R'] as const) {
        const h = l.hands[side];
        if (h.px && h.wrist) errs[i]!.push(Math.hypot(h.px.x - h.wrist.x, h.px.y - h.wrist.y) / s.mirror.w);
      }
    });
    await page.waitForTimeout(350);
  }
  const med = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)]! : Number.NaN; };
  return { median: errs.map(med), samples: errs.map((e) => e.length) };
}
